import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import type { Decider, EventTemplate, Person } from '@ed/schema';
import { proseOriginalHash } from '@ed/schema';
import { decideBranch, missingPlainEnglish, place, setProseMode, setProseVariants, testRng, testWorld, wantsPlayerCast } from '@ed/core';
import { coreMessageAddress } from './messages.js';
import { queueChoice, resolveChoice, type PendingChoice, type PendingDecision, type PendingRecord } from './events/decisions.js';
import { delegatedRecord, markDelegated, mustSurface, resolveDelegated } from './delegation.js';
import { streamFor } from './rng.js';
import { GameSession } from './session.js';

const bundle = loadContent();

/**
 * WHO TAKES THE BRANCH (`schema/src/decider.ts`, `core/src/events/deciders.ts`).
 *
 * These are direct tests of the evaluator. The properties that matter are not
 * "the right rung fires" — that is arithmetic — but the two that make the
 * feature safe to author against: EVERY PATH RESOLVES, because a decision with
 * no answer stops the clock permanently (invariant 9); and the player's path
 * and the chronicler's use the same evaluator, so a delegated decision cannot
 * mean one thing in the game and another in the harness.
 */

/** INVARIANT 6: a direct write to `acquired` has to dirty the cached phenotype. */
function setAcquired(p: Person, key: string, value: number): void {
  p.acquired[key] = value;
  if (p.phenotype) p.phenotype.dirty = true;
}

/** A two-branch event, with everything but the decider held constant. */
function twoBranch(decidedBy: Decider): EventTemplate {
  return {
    id: 'test_two_branch',
    title: 'Two Ways About It',
    tier: 'family',
    frequency: 'uncommon',
    weight: 100,
    repeatable: true,
    cooldownYears: 0,
    tags: [],
    purposes: ['change_standing', 'change_relationship', 'buy_patience'],
    slots: {},
    checks: [],
    reads: [],
    body: 'A body long enough to be a body and not a note, which the shape rule asks for.',
    accounts: [],
    interaction: {
      kind: 'choice',
      decidedBy,
      choices: [
        { id: 'pay', label: 'Pay it', requires: [], outcomes: [{ id: 'paid', weight: 100, text: 'Paid.', tags: ['costly'], effects: [] }] },
        { id: 'refuse', label: 'Refuse', requires: [], outcomes: [{ id: 'refused', weight: 100, text: 'Refused.', tags: [], effects: [] }] },
      ],
    },
  } as EventTemplate;
}


/**
 * The user-facing originals in decideBranch are a reviewed, keyed surface.
 * Match the literal call sites to this inventory so deleting a key or silently
 * rewording Original fails before a translation can become stale.
 */
const DECIDER_ORIGINALS: Record<string, string> = {
  'deciders.narration': 'narration — nothing is being decided',
  'deciders.player': 'the house decides',
  'deciders.chance': 'as it fell out',
  'deciders.state.condition': "the house's condition: {LABEL}",
  'deciders.state.none': 'no rung of the ladder held',
  'deciders.party.cast': 'the house names who goes; what they are between them decides the rest',
  'deciders.party.missing': "check '{CHECK}' is not declared",
  'deciders.party.unavailable': "the check named '{CHOICE}', but that branch is unavailable",
  'deciders.party.unknown': "the check named '{CHOICE}', which is not one of the branches",
  'deciders.party.roll': '{ROLL} against {DIFFICULTY} — {LABEL}',
};

describe('decider explanation prose (#795)', () => {
  it('pins every stable key to the exact Original at its msg call site', () => {
    const source = readFileSync(new URL('./events/deciders.ts', import.meta.url), 'utf8');
    // The literals at these call sites use single or double quotes. This is
    // deliberately source-based: a removed message cannot pass by just never
    // being exercised by a fixture.
    const found = [...source.matchAll(/msg\(ctx,\s*'([^']+)',\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)]
      .map(([, key, literal]) => [key, literal!.slice(1, -1)]);
    expect(Object.fromEntries(found)).toEqual(DECIDER_ORIGINALS);
    expect(found).toHaveLength(Object.keys(DECIDER_ORIGINALS).length);
  });

  it('renders the state ladder in Plain English without changing its branch', () => {
    const ctx = testWorld(bundle);
    const event = twoBranch({ state: [{ take: 'pay' }] });
    const original = decideBranch(ctx, event, {}, testRng('state-prose'));
    expect(original.why).toBe("the house's condition: Pay it");

    setProseVariants(ctx, [{
      address: coreMessageAddress('deciders.state.condition'),
      of: proseOriginalHash(DECIDER_ORIGINALS['deciders.state.condition']!),
      plainenglish: 'Because of the circumstances, the family chooses {LABEL}.',
    }]);
    setProseMode(ctx, 'plainenglish');
    const translated = decideBranch(ctx, event, {}, testRng('state-prose'));
    expect(translated.why).toBe('Because of the circumstances, the family chooses Pay it.');
    expect({ asks: translated.asks, choice: translated.choice?.id })
      .toEqual({ asks: original.asks, choice: original.choice?.id });
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });

  it('renders the party roll in Plain English without changing its branch', () => {
    const ctx = testWorld(bundle);
    const person = place(ctx, { sex: 'male', age: 30 });
    setAcquired(person, 'strength', 400);
    const event = twoBranch({ party: { check: 'party_roll' } });
    event.slots = { COMPANION: { role: 'family_member', castBy: 'player', optional: false, filters: [], bind: 'event' } };
    event.checks = [{
      id: 'party_roll',
      pool: { kind: 'party_sum', slots: ['COMPANION'], attr: 'strength' },
      difficulty: 40,
      variance: 'none',
      bands: [{ atLeast: 0, outcome: 'pay' }, { atLeast: -999, outcome: 'refuse' }],
    }];
    const fill = { COMPANION: person.id };
    const original = decideBranch(ctx, event, fill, testRng('party-prose'), { castReady: true });
    const parts = /^(\d+) against (\d+) — (.+)$/.exec(original.why);
    expect(parts).not.toBeNull();

    setProseVariants(ctx, [{
      address: coreMessageAddress('deciders.party.roll'),
      of: proseOriginalHash(DECIDER_ORIGINALS['deciders.party.roll']!),
      plainenglish: 'The result for {LABEL} was {ROLL}, against a difficulty of {DIFFICULTY}.',
    }]);
    setProseMode(ctx, 'plainenglish');
    const translated = decideBranch(ctx, event, fill, testRng('party-prose'), { castReady: true });
    expect(translated.why)
      .toBe(`The result for ${parts![3]} was ${parts![1]}, against a difficulty of ${parts![2]}.`);
    expect({ asks: translated.asks, choice: translated.choice?.id })
      .toEqual({ asks: original.asks, choice: original.choice?.id });
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});

describe('the player decides', () => {
  it('asks, and names no branch itself', () => {
    const ctx = testWorld(bundle);
    const d = decideBranch(ctx, twoBranch('player'), {}, testRng());
    expect(d.asks).toBe(true);
    expect(d.choice).toBeUndefined();
  });
});

describe('chance decides', () => {
  it('takes a branch without asking', () => {
    const ctx = testWorld(bundle);
    const d = decideBranch(ctx, twoBranch('chance'), {}, testRng());
    expect(d.asks).toBe(false);
    expect(['pay', 'refuse']).toContain(d.choice?.id);
  });
});

describe('the family\'s condition decides', () => {
  it('takes the first rung whose guard holds', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 5;
    const e = twoBranch({
      state: [
        { when: { treasury: { op: 'lt', value: 100 } }, take: 'refuse', because: 'the coffer is empty' },
        { take: 'pay' },
      ],
    });
    const d = decideBranch(ctx, e, {}, testRng());
    expect(d.choice?.id).toBe('refuse');
    expect(d.why).toBe('the coffer is empty');
    expect(d.asks).toBe(false);
  });

  it('falls past a rung whose guard fails, to the unguarded else', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 5000;
    const e = twoBranch({
      state: [
        { when: { treasury: { op: 'lt', value: 100 } }, take: 'refuse' },
        { take: 'pay' },
      ],
    });
    expect(decideBranch(ctx, e, {}, testRng()).choice?.id).toBe('pay');
  });

  it('still resolves when no rung holds at all', () => {
    // A ladder every rung of which is guarded, and none of which holds. This
    // must not return nothing: invariant 9 means an unanswered decision stops
    // the clock for good, so the fallback is a weighted draw, not a stall.
    const ctx = testWorld(bundle);
    ctx.world.treasury = 5000;
    const e = twoBranch({ state: [{ when: { treasury: { op: 'lt', value: 100 } }, take: 'refuse' }] });
    const d = decideBranch(ctx, e, {}, testRng());
    expect(d.asks).toBe(false);
    expect(d.choice).toBeDefined();
    expect(d.why).toContain('no rung');
  });

  it('skips a rung naming a branch the house is not able to take', () => {
    // The ladder says what the house WOULD do. It cannot do what `requires`
    // bars it from, so that rung is not an answer — the next one is.
    const ctx = testWorld(bundle);
    const weakling = place(ctx, { sex: 'male', age: 30 });
    setAcquired(weakling, 'strength', -200);

    const e = twoBranch({ state: [{ take: 'pay' }, { take: 'refuse' }] });
    e.slots = { CHAMPION: { role: 'family_member', castBy: 'engine', optional: false, filters: [], bind: 'event' } };
    if (e.interaction.kind === 'choice') {
      e.interaction.choices[0]!.requires = [{ slot: 'CHAMPION', attr: 'strength', op: 'gte', value: 500 }];
    }
    expect(decideBranch(ctx, e, { CHAMPION: weakling.id }, testRng()).choice?.id).toBe('refuse');
  });
});

describe('the party the player names decides', () => {
  /** A dispatch event: the player casts COMPANION, and a check over him picks the branch. */
  function partyEvent(): EventTemplate {
    const e = twoBranch({ party: { check: 'the_pull' } });
    e.slots = { COMPANION: { role: 'family_member', castBy: 'player', optional: false, filters: [], bind: 'event' } };
    e.checks = [{
      id: 'the_pull',
      pool: { kind: 'party_sum', slots: ['COMPANION'], attr: 'strength' },
      difficulty: 40,
      variance: 'none',
      // Bands name BRANCHES here, not outcomes. That is the whole difference
      // between a check that decides and a check that resolves.
      bands: [{ atLeast: 0, outcome: 'pay' }, { atLeast: -999, outcome: 'refuse' }],
    }];
    return e;
  }

  it('asks for the cast before it will decide anything', () => {
    const ctx = testWorld(bundle);
    const e = partyEvent();
    expect(wantsPlayerCast(e)).toBe(true);
    const d = decideBranch(ctx, e, {}, testRng());
    expect(d.asks).toBe(true);
    expect(d.choice).toBeUndefined();
  });

  it('picks the band the party clears, once the party is named', () => {
    const ctx = testWorld(bundle);
    const strong = place(ctx, { sex: 'male', age: 30 });
    setAcquired(strong, 'strength', 400);
    const d = decideBranch(ctx, partyEvent(), { COMPANION: strong.id }, testRng(), { castReady: true });
    expect(d.choice?.id).toBe('pay');
    expect(d.asks).toBe(false);
  });

  it('picks the lower band when the party cannot clear the bar', () => {
    const ctx = testWorld(bundle);
    const weak = place(ctx, { sex: 'female', age: 70 });
    setAcquired(weak, 'strength', -400);
    expect(decideBranch(ctx, partyEvent(), { COMPANION: weak.id }, testRng(), { castReady: true }).choice?.id)
      .toBe('refuse');
  });

  it('does not let the party check bypass a branch requirement', () => {
    const ctx = testWorld(bundle);
    const strong = place(ctx, { sex: 'male', age: 30 });
    setAcquired(strong, 'strength', 400);
    const e = partyEvent();
    if (e.interaction.kind === 'narration') throw new Error('expected a choice event');
    e.interaction.choices[0]!.requires = [
      { slot: 'COMPANION', attr: 'strength', op: 'gte', value: 10_000 },
    ];

    const d = decideBranch(ctx, e, { COMPANION: strong.id }, testRng(), { castReady: true });

    expect(d.choice?.id).toBe('refuse');
    expect(d.why).toContain('unavailable');
  });

  it('still resolves if every party-decided branch is unavailable', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    const e = partyEvent();
    if (e.interaction.kind === 'narration') throw new Error('expected a choice event');
    for (const choice of e.interaction.choices) {
      choice.requires = [{ slot: 'COMPANION', attr: 'strength', op: 'gte', value: 10_000 }];
    }

    const d = decideBranch(ctx, e, { COMPANION: p.id }, testRng(), { castReady: true });

    expect(d.asks).toBe(false);
    expect(d.choice).toBeDefined();
  });

  it('resolves rather than stalling when the check names nothing real', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    const e = partyEvent();
    e.checks[0]!.bands = [{ atLeast: -999, outcome: 'a_branch_that_is_not_here' }];
    const d = decideBranch(ctx, e, { COMPANION: p.id }, testRng(), { castReady: true });
    expect(d.choice).toBeDefined();
    expect(d.why).toContain('not one of the branches');
  });

  it('resolves rather than stalling when the check was never declared', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    const e = partyEvent();
    e.checks = [];
    const d = decideBranch(ctx, e, { COMPANION: p.id }, testRng(), { castReady: true });
    expect(d.choice).toBeDefined();
    expect(d.why).toContain('not declared');
  });
});

describe('narration', () => {
  it('is not a decision and does not pretend to be one', () => {
    const ctx = testWorld(bundle);
    const e = twoBranch('player');
    e.interaction = { kind: 'narration', outcomes: [{ id: 'only', weight: 100, text: 'It happened.', tags: [], effects: [] }] };
    const d = decideBranch(ctx, e, {}, testRng());
    expect(d.asks).toBe(false);
    expect(d.choice).toBeUndefined();
  });
});

describe('standing-delegation interruption guard (#219)', () => {
  function pending(e = twoBranch('player')): PendingChoice {
    return {
      kind: 'choice', id: 'dec_guard', year: 1200, event: e, body: e.body, fill: {},
      choices: e.interaction.kind === 'narration' ? [] : e.interaction.choices.map((x) => ({
        id: x.id, label: x.label, available: true,
      })),
      cast: [], decidedBy: 'player', choicesAreOpen: true,
    };
  }

  function recordPending(e = twoBranch('player')): PendingRecord {
    return {
      kind: 'record',
      id: 'dec_record_guard',
      year: 1200,
      event: e,
      subject: 'the ordinary account',
      options: [
        { option: 'record', chronicle: 'It was written plainly.' },
        { option: 'omit', chronicle: null },
        { option: 'embellish', chronicle: 'It was improved.', discrepancy: 'test_lie' },
      ],
      entryId: 'chronicle_test',
      fill: {},
    };
  }

  it('lets an ordinary remembered branch stay routine', () => {
    expect(mustSurface(testWorld(bundle), pending())).toBeUndefined();
  });

  it('checks only the remembered branch and still surfaces protected content in that branch', () => {
    const ctx = testWorld(bundle);
    const event = twoBranch('player');
    if (event.interaction.kind !== 'choice') throw new Error('expected a choice event');

    event.interaction.choices[1]!.label = 'Sacrifice a cadet';

    ctx.world.delegation.choices[event.id] = 'pay';
    expect(mustSurface(ctx, pending(event))).toBeUndefined();

    ctx.world.delegation.choices[event.id] = 'refuse';
    expect(mustSurface(ctx, pending(event))).toBe('sacrifice');
  });

  it('surfaces every named importance class before a remembered choice can fire', () => {
    const ctx = testWorld(bundle);
    ctx.world.houseAmbition = 'deepen_blood';
    const cases: [string, EventTemplate, string][] = [
      ['rare', { ...twoBranch('player'), frequency: 'rare' }, 'rare'],
      ['mythic', { ...twoBranch('player'), frequency: 'mythic' }, 'rare'],
      ['major rite', { ...twoBranch('player'), id: 'the_great_rite' }, 'rite'],
      ['sacrifice', { ...twoBranch('player'), title: 'The sacrifice of a cadet' }, 'sacrifice'],
      ['Discrepancy', { ...twoBranch('player'), tags: ['discrepancy'] }, 'discrepancy'],
      ['House Ambition', { ...twoBranch('player'), tags: ['house_ambition'] }, 'ambition'],
      ['ending state', { ...twoBranch('player'), tags: ['ascension'] }, 'ending'],
    ];
    for (const [name, e, reason] of cases) {
      expect(mustSurface(ctx, pending(e)), name).toBe(reason);
    }

    const cast = pending();
    cast.cast = [{ slot: 'CHILD', optional: false, candidates: [] }];
    expect(mustSurface(ctx, cast)).toBe('cast');

    const arc = pending();
    arc.arcStep = {} as NonNullable<PendingChoice['arcStep']>;
    expect(mustSurface(ctx, arc)).toBe('arc');
  });

  it('surfaces principal involvement without making the Head block routine Record pages', () => {
    const ctx = testWorld(bundle);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'));
    expect(head, 'test world has no sitting Head').toBeDefined();

    const scion = place(ctx, { sex: 'male', age: 24 });
    const heir = place(ctx, { sex: 'male', age: 20 });
    ctx.world.scion = scion.id;
    ctx.world.scionHeir = heir.id;

    for (const [name, id] of [['Head', head!.id], ['Scion', scion.id], ['heir', heir.id]] as const) {
      const d = pending();
      d.fill = { SUBJECT: id };
      expect(mustSurface(ctx, d), name).toBe('heir');
    }

    for (const [name, id] of [['Scion', scion.id], ['heir', heir.id]] as const) {
      const d = recordPending();
      d.fill = { SUBJECT: id };
      ctx.world.delegation.records[d.event.id] = 'record';
      expect(mustSurface(ctx, d), `${name} Record`).toBe('heir');
    }

    const ordinaryHeadPage = recordPending();
    ordinaryHeadPage.fill = { HEAD: head!.id };
    ctx.world.delegation.records[ordinaryHeadPage.event.id] = 'record';
    expect(mustSurface(ctx, ordinaryHeadPage)).toBeUndefined();
    expect(delegatedRecord(ctx, ordinaryHeadPage)).toBe('record');
  });

  it('fails safe on a decision category it does not delegate', () => {
    const ctx = testWorld(bundle);
    expect(mustSurface(ctx, { kind: 'match' } as PendingDecision)).toBe('ambiguous');
  });

  it('delegates only the plain Record answer, and surfaces omission or embellishment', () => {
    const ctx = testWorld(bundle);
    const d = recordPending();

    ctx.world.delegation.records[d.event.id] = 'record';
    expect(mustSurface(ctx, d)).toBeUndefined();
    expect(delegatedRecord(ctx, d)).toBe('record');

    ctx.world.delegation.records[d.event.id] = 'omit';
    expect(mustSurface(ctx, d)).toBe('ambiguous');
    expect(delegatedRecord(ctx, d)).toBeUndefined();

    ctx.world.delegation.records[d.event.id] = 'embellish';
    expect(mustSurface(ctx, d)).toBe('ambiguous');
    expect(delegatedRecord(ctx, d)).toBeUndefined();
  });

  it('surfaces Record when the active House Ambition says Record is consequential', () => {
    const ctx = testWorld(bundle);
    const d = recordPending();
    d.event.purposes = ['advance_clause', 'worldbuild_through_action', 'force_record_choice'];
    ctx.world.houseAmbition = 'restore_ledger';
    ctx.world.delegation.records[d.event.id] = 'record';

    // #327 reads stable event structure rather than translated Record prose.
    // No generic ambition tag and no magic Ledger wording are needed.
    expect(JSON.stringify(d.event).toLowerCase()).not.toContain('ambition');
    expect(d.subject.toLowerCase()).not.toMatch(/ledger|clause|discrep/);
    expect(mustSurface(ctx, d)).toBe('ambition');
    expect(delegatedRecord(ctx, d)).toBeUndefined();
  });

  it('keeps both delegated policies when a choice and its Record share one Chronicle page', () => {
    const ctx = testWorld(bundle, 219, 1200);
    ctx.world.chronicle.push({
      id: 'chronicle_delegated_pair',
      year: ctx.world.year,
      weight: 'paragraph',
      text: 'The page both decisions belong to.',
      eventId: 'test_two_branch',
      named: false,
    });

    markDelegated(ctx, 'test_two_branch', 'choice:pay');
    markDelegated(ctx, 'test_two_branch', 'record:record');
    markDelegated(ctx, 'test_two_branch', 'record:record');

    expect(ctx.world.chronicle.at(-1)?.delegated).toBe('choice:pay|record:record');
  });
  it('drains a remembered plain Record queued by a manual choice immediately', () => {
    const ctx = testWorld(bundle, 219, 1200);
    const event = twoBranch('player');
    event.record = {
      subject: 'what the house writes',
      options: {
        record: { chronicle: 'It was paid.', effects: [], claims: [] },
        omit: { chronicle: null, effects: [] },
        embellish: {
          chronicle: 'It was paid gladly.',
          effects: [],
          claims: [],
          discrepancy: { id: 'test_record_lie', severity: 'minor', provableBy: ['the_book'] },
        },
      },
    };

    const asked = queueChoice(ctx, event, event.body, {}, []);
    ctx.world.delegation.records[event.id] = 'record';

    const result = new GameSession(ctx).choose(asked.id, 'pay');

    expect(result.ok).toBe(true);
    expect(ctx.world.pendingDecisions).toEqual([]);
    const entry = [...ctx.world.chronicle].reverse().find((row) => row.eventId === event.id);
    expect(entry?.record).toBe('record');
    expect(entry?.delegated).toContain('record:record');
  });

  it('does not treat every Record block as a Discrepancy merely because Embellish can create one', () => {
    const ctx = testWorld(bundle);
    const event = twoBranch('player');
    event.record = {
      subject: 'an ordinary account',
      options: {
        record: { chronicle: 'It was written plainly.', effects: [], claims: [] },
        omit: { chronicle: null, effects: [] },
        embellish: {
          chronicle: 'It was improved.',
          effects: [],
          claims: [],
          discrepancy: { id: 'test_optional_lie', severity: 'minor', provableBy: ['the_book'] },
        },
      },
    };
    const d = recordPending(event);
    ctx.world.delegation.records[event.id] = 'record';
    expect(mustSurface(ctx, d)).toBeUndefined();
    expect(delegatedRecord(ctx, d)).toBe('record');
  });

  it('uses the same choice resolver and commit path as a manual answer', () => {
    const manual = testWorld(bundle, 219, 1200);
    const delegated = testWorld(bundle, 219, 1200);
    const event = twoBranch('player');

    const asked = queueChoice(manual, event, event.body, {}, []);
    const remembered = queueChoice(delegated, event, event.body, {}, []);
    delegated.world.delegation.choices[event.id] = 'pay';

    const result = resolveChoice(
      manual,
      asked.id,
      'pay',
      streamFor(manual.world, 'decision', asked.id),
    );
    expect(result.ok).toBe(true);

    resolveDelegated(delegated);

    expect(delegated.world.pendingDecisions).toEqual([]);
    expect(delegated.world.decisionLog).toEqual(manual.world.decisionLog);
    expect(delegated.world.frequency.templateFires[event.id])
      .toBe(manual.world.frequency.templateFires[event.id]);
    expect(delegated.world.chronicle.at(-1)?.delegated).toBe('choice:pay');
  });
});

