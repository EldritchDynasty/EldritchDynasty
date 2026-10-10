import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, proseOriginalHash, type EventTemplate } from '@ed/schema';
import { makeRng } from './rng.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { place, testWorld } from './testing.js';
import { stepYear } from './year/step.js';
import { coreMessageAddress } from './messages.js';
import { evalCondition } from './events/conditions.js';
import { resolveSlots } from './events/slots.js';
import {
  applyRecord, autoResolveAll, queueChoice, queueMatch, queueRecord, resolveChoice, resolveMatch, resolveRecord,
} from './events/decisions.js';

const content = indexContent(loadContent());

function fixture(seed: number) {
  const ctx = testWorld(content, seed);
  place(ctx, { sex: 'male', age: 22, name: `Decision Young Man ${seed}` });
  place(ctx, { sex: 'male', age: 41, name: `Decision Older Man ${seed}` });
  place(ctx, { sex: 'female', age: 27, name: `Decision Woman ${seed}` });
  return ctx;
}

/**
 * Turn one already-fillable narration into the smallest possible player
 * choice. This tests the docket/commit mechanism without seed-mining a played
 * century for whichever authored choice happens to fire first.
 */
function playerChoiceFixture(seed: number) {
  const ctx = fixture(seed);

  for (const [index, source] of content.events.entries()) {
    if (
      source.arc
      || source.record
      || source.tier === 'frame'
      || source.interaction.kind !== 'narration'
      || source.interaction.outcomes.length !== 1
      || !evalCondition(source.conditions, ctx)
    ) continue;

    const slots = resolveSlots(source, ctx, makeRng(seed + index + 1));
    if (!slots.ok || slots.playerCast.length) continue;

    const event = structuredClone(source);
    if (event.interaction.kind !== 'narration') continue;
    const outcome = event.interaction.outcomes[0]!;
    const choiceId = 'decision_witness_choice';
    event.interaction = {
      kind: 'choice',
      decidedBy: 'player',
      choices: [{
        id: choiceId,
        label: 'Take the witnessed choice',
        requires: [],
        outcomes: [outcome],
      }],
    };

    const pending = queueChoice(ctx, event, event.body, slots.fill, []);
    return { ctx, event, pending, choiceId };
  }

  throw new Error('fixture has no fillable single-outcome narration for a choice witness');
}

function recordFixture(seed: number) {
  const ctx = fixture(seed);

  for (const [index, event] of content.events.entries()) {
    if (!event.record || event.arc) continue;
    const slots = resolveSlots(event, ctx, makeRng(seed + index + 1));
    if (!slots.ok || slots.playerCast.length) continue;

    const entryId = `decision_record_witness_${seed}`;
    ctx.world.chronicle.push({
      id: entryId,
      year: ctx.world.year,
      weight: 'paragraph',
      text: 'The event happened.',
      eventId: event.id,
      named: false,
    });
    const pending = queueRecord(ctx, event, entryId, slots.fill);
    if (pending) return { ctx, event, entryId, pending };
  }

  throw new Error('fixture has no fillable Record event');
}

describe('the decision docket mechanism', () => {
  it('keeps an invalid choice standing and spends one ration only on the valid commit', () => {
    const { ctx, event, pending, choiceId } = playerChoiceFixture(451);
    const tier = event.frequency;
    const before = ctx.world.frequency.firedThisRun[tier];

    expect(pending.body).not.toMatch(/\{[A-Z_]+\}/);

    const refused = resolveChoice(ctx, pending.id, 'not_an_authored_choice', makeRng(1));
    expect(refused.ok).toBe(false);
    expect(ctx.world.pendingDecisions.some((decision) => decision.id === pending.id)).toBe(true);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before);

    const accepted = resolveChoice(ctx, pending.id, choiceId, makeRng(2));
    expect(accepted.ok, accepted.reason).toBe(true);
    expect(ctx.world.pendingDecisions.some((decision) => decision.id === pending.id)).toBe(false);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);

    // Retrying an answer to a decision that has already committed is a refusal,
    // not a second spend of the tier ration.
    expect(resolveChoice(ctx, pending.id, choiceId, makeRng(3)).ok).toBe(false);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);
  });

  it('stops the clock on an open decision and lets it move after the docket clears', () => {
    const { ctx, pending, choiceId } = playerChoiceFixture(452);
    const year = ctx.world.year;

    const blocked = stepYear(ctx, false);
    expect(blocked.year).toBe(year);
    expect(blocked.blocked?.length).toBeGreaterThan(0);
    expect(ctx.world.year).toBe(year);

    expect(resolveChoice(ctx, pending.id, choiceId, makeRng(4)).ok).toBe(true);
    stepYear(ctx, false);
    expect(ctx.world.year).toBe(year + 1);
  });

  it('drains the same production choice through the chronicler path', () => {
    const { ctx, event } = playerChoiceFixture(453);
    const tier = event.frequency;
    const before = ctx.world.frequency.firedThisRun[tier];

    autoResolveAll(ctx, makeRng(5));

    expect(ctx.world.pendingDecisions).toHaveLength(0);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);
    expect(ctx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      choiceId: 'decision_witness_choice',
    });
  });
});

describe('the Record docket mechanism', () => {
  it('offers all three answers and rewrites the event page in place', () => {
    const { ctx, entryId, pending } = recordFixture(461);
    const before = ctx.world.chronicle.length;

    expect(pending.options.map((option) => option.option)).toEqual(['record', 'omit', 'embellish']);
    expect(resolveRecord(ctx, pending.id, 'record').ok).toBe(true);
    expect(ctx.world.chronicle).toHaveLength(before);
    expect(ctx.world.chronicle.find((entry) => entry.id === entryId)?.record).toBe('record');
  });

  it('keeps an omission as a dated blank page', () => {
    const { ctx, entryId, pending } = recordFixture(462);

    expect(resolveRecord(ctx, pending.id, 'omit').ok).toBe(true);
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === entryId);
    expect(entry?.text).toBeNull();
    expect(entry?.record).toBe('omit');
    expect(entry?.year).toBe(pending.year);
  });

  it('opens the authored discrepancy when the house embellishes', () => {
    const { ctx, entryId, pending } = recordFixture(463);
    const discrepancy = pending.options.find((option) => option.option === 'embellish')?.discrepancy;
    if (!discrepancy) throw new Error('Record witness has no embellishment discrepancy');

    expect(resolveRecord(ctx, pending.id, 'embellish').ok).toBe(true);
    expect(ctx.world.discrepancies.get(discrepancy)?.state).toBe('open');
    expect(ctx.world.chronicle.find((entry) => entry.id === entryId)?.discrepancyId).toBe(discrepancy);
  });

  it('grants knowledge through an honest Record answer', () => {
    const ctx = testWorld(content, 464);
    const event = content.events.find((candidate) => candidate.record?.options.record.grantsKnowledge);
    expect(event, 'no event grants knowledge through its Record block').toBeDefined();

    applyRecord(ctx, event!, 'decision_knowledge_witness', 'record');

    expect(ctx.world.knowledge.has(event!.record!.options.record.grantsKnowledge!)).toBe(true);
  });
});

describe('Record-option Chronicle-effect prose (#806)', () => {
  it('selects reviewed wording at commit time and never rewrites earlier pages', () => {
    const source = content.events.find((item) => item.id === 'a_second_hand_that_agrees')!;
    if (!source?.record) throw new Error('Cawdry fixture has no Record block');

    const original = 'The notary recorded another copy of the supporting document.';
    const plain = 'The notary wrote down another copy of the supporting document.';
    const event: EventTemplate = {
      ...source,
      record: {
        ...source.record,
        options: {
          ...source.record.options,
          record: {
            ...source.record.options.record,
            effects: [{ kind: 'chronicle', text: original }],
          },
        },
      },
    };
    const address = 'content:events/burying.yaml#events[id=a_second_hand_that_agrees].record.options.record.effects[0].text';
    const ctx = testWorld(content);
    setProseVariants(ctx, [{ address, of: proseOriginalHash(original), plainenglish: plain }]);
    const written = () => ctx.world.chronicle.filter((page) => page.weight === 'line').map((page) => page.text);

    applyRecord(ctx, event, 'fixture-original', 'record');
    expect(written()).toEqual([original]);

    setProseMode(ctx, 'plainenglish');
    applyRecord(ctx, event, 'fixture-plain', 'record');
    expect(written()).toEqual([original, plain]);
    expect(missingPlainEnglish(ctx)).not.toContain(address);

    setProseVariants(ctx, [{ address, of: '0000000000000000', plainenglish: plain }]);
    applyRecord(ctx, event, 'fixture-stale', 'record');
    expect(written()).toEqual([original, plain, original]);
    expect(missingPlainEnglish(ctx)).toContain(address);

    setProseMode(ctx, 'original');
    expect(written()).toEqual([original, plain, original]);
  });
});


describe('keyed docket refusals (#833)', () => {
  // Every literal is frozen here so an Original edit requires review of its hash.
  const MESSAGES = [
    ['decision.choice.missing', 'no such decision', 'That decision is no longer available.'],
    ['decision.choice.narration', 'narration takes no choice', 'This scene does not ask you to choose.'],
    ['decision.cast.at_most', '{SLOT} takes at most {MAX}', 'Choose no more than {MAX} people for {SLOT}.'],
    ['decision.cast.at_least', '{SLOT} takes at least {MIN}', 'Choose at least {MIN} people for {SLOT}.'],
    ['decision.cast.missing', 'nobody cast as {SLOT}', 'Choose someone for {SLOT}.'],
    ['decision.choice.player_required', "this decision is the house's to take", 'You must choose for the family.'],
    ['decision.choice.unknown', "no choice '{CHOICE}'", "The choice '{CHOICE}' is not available."],
    ['decision.match.missing', 'no such match', 'That marriage offer is no longer available.'],
    ['decision.match.unknown_card', 'no such card', 'That marriage card is not in the offer.'],
  ] as const;

  function run(mode: 'original' | 'plainenglish') {
    const { ctx, pending, choiceId } = playerChoiceFixture(8833);
    setProseVariants(ctx, MESSAGES.map(([key, original, plainenglish]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish,
    })));
    setProseMode(ctx, mode);
    const rng = makeRng(833);
    const refused: Array<{ ok: boolean; reason?: string }> = [];
    refused.push(resolveChoice(ctx, 'does-not-exist', choiceId, rng));

    // A narration is not an authored branch even if a stale client attempts one.
    const actualInteraction = pending.event.interaction;
    pending.event.interaction = { kind: 'narration', outcomes: [] };
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng));
    pending.event.interaction = actualInteraction;

    pending.cast = [{
      slot: 'party', optional: false,
      count: { min: 2, max: 2 },
      candidates: [
        { id: 'c1', name: 'First', age: 20 },
        { id: 'c2', name: 'Second', age: 22 },
        { id: 'c3', name: 'Third', age: 24 },
      ],
    }];
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng, { party: ['c1', 'c2', 'c3'] }));
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng, { party: ['c1'] }));
    pending.cast = [{ slot: 'witness', optional: false, candidates: [{ id: 'c1', name: 'First', age: 20 }] }];
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng));

    pending.cast = [];
    refused.push(resolveChoice(ctx, pending.id, undefined, rng));
    refused.push(resolveChoice(ctx, pending.id, 'unknown_choice', rng));
    refused.push(resolveMatch(ctx, 'does-not-exist', 'missing'));
    const match = queueMatch(ctx, {
      subject: { id: 'c1', name: 'First', sex: 'male', age: 20 }, cards: [],
    });
    refused.push(resolveMatch(ctx, match.id, 'missing'));

    const beforeSuccess = structuredClone(ctx.world.pendingDecisions);
    const accepted = resolveChoice(ctx, pending.id, choiceId, rng);
    return {
      refused, beforeSuccess,
      accepted: accepted.ok,
      pending: structuredClone(ctx.world.pendingDecisions),
      decisions: structuredClone(ctx.world.decisionLog),
      frequency: structuredClone(ctx.world.frequency),
    };
  }

  it('keeps all nine Originals and translates the same refusals without moving the docket', () => {
    expect(MESSAGES).toHaveLength(9);
    expect(new Set(MESSAGES.map(([key]) => key)).size).toBe(9);
    const original = run('original');
    const plain = run('plainenglish');
    expect(original.refused.map((result) => result.reason)).toEqual([
      'no such decision',
      'narration takes no choice',
      'party takes at most 2',
      'party takes at least 2',
      'nobody cast as witness',
      "this decision is the house's to take",
      "no choice 'unknown_choice'",
      'no such match',
      'no such card',
    ]);
    expect(plain.refused.map((result) => result.reason)).toEqual([
      'That decision is no longer available.',
      'This scene does not ask you to choose.',
      'Choose no more than 2 people for party.',
      'Choose at least 2 people for party.',
      'Choose someone for witness.',
      'You must choose for the family.',
      "The choice 'unknown_choice' is not available.",
      'That marriage offer is no longer available.',
      'That marriage card is not in the offer.',
    ]);
    expect(original.refused.map((result) => result.ok)).toEqual(Array(9).fill(false));
    expect(plain.refused.map((result) => result.ok)).toEqual(Array(9).fill(false));
    expect(plain.beforeSuccess).toEqual(original.beforeSuccess);
    expect(plain.accepted).toBe(true);
    expect(plain.accepted).toBe(original.accepted);
    expect(plain.pending).toEqual(original.pending);
    expect(plain.decisions).toEqual(original.decisions);
    expect(plain.frequency).toEqual(original.frequency);
  });

  it('falls back to the Original if a host supplies a stale fingerprint', () => {
    const ctx = fixture(8834);
    setProseVariants(ctx, [{
      address: coreMessageAddress('decision.choice.missing'),
      of: '0000000000000000',
      plainenglish: 'The decision is missing.',
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(resolveChoice(ctx, 'missing', undefined, makeRng(834)).reason).toBe('no such decision');
    expect(missingPlainEnglish(ctx)).toContain(coreMessageAddress('decision.choice.missing'));
  });
});
