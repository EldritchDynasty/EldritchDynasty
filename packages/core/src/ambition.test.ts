import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { EventTemplate } from '@ed/schema';
import { newGame, resumeGame } from '@ed/core';
import { MAIN_BRANCH, asId, proseOriginalHash, type BranchId, type HouseAmbitionId } from '@ed/schema';
import { ambitionOptions, ambitionRelevance, ambitionView, recommendAmbition } from './ambition.js';
import { bootstrap } from './sim.js';
import { campaignDef } from './campaign.js';
import { place, testWorld } from './testing.js';
import { ensureHead } from './people/succession.js';
import { makeRng } from './rng.js';
import { loadGame, saveGame } from './save.js';
import { relevantPeople } from './people/relevance.js';
import { setProseMode, setProseVariants } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';
import { mustSurface } from './delegation.js';
import { queueChoice, type PendingMatch, type PendingRecord } from './events/decisions.js';
import type { SimCtx } from './world.js';

const content = loadContent();

function oneSubject(ctx: SimCtx) {
  const subject = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0];
  if (!subject) throw new Error('the bootstrap world has no household subject');
  return subject;
}

function bloodMatch(ctx: SimCtx, outward: boolean): PendingMatch {
  const subject = oneSubject(ctx);
  return {
    kind: 'match',
    id: outward ? 'outward_hand' : 'inward_hand',
    year: ctx.world.year,
    subject: {
      id: subject.id,
      name: subject.name,
      sex: subject.sex,
      age: ctx.world.year - subject.born,
    },
    cards: [{
      id: outward ? 'outward_card' : 'inward_card',
      kind: outward ? 'outsider' : 'household',
      name: outward ? 'Mara of the Vale' : 'Mara of the Hall',
      sex: subject.sex === 'male' ? 'female' : 'male',
      age: 22,
      house: outward ? 'house_vale' : ctx.world.playerHouse,
      houseName: outward ? 'House Vale' : 'the household',
      blurb: 'The same visible line, from a different distance.',
      dowry: 20,
      kinship: outward ? 0 : 0.0625,
      line: 'ordinary',
      lineSeen: 3,
      words: 'an ordinary watched line',
      papersAsked: 0,
      papersShown: 0,
      panel: { issue: [], woken: [], said: [], ourBook: [] },
      available: true,
    }],
  };
}

function quietRecord(ctx: SimCtx): PendingRecord {
  const source = content.bundle.events[0];
  if (!source) throw new Error('content has no event to use as a record shell');
  const event = {
    ...source,
    id: 'quiet_account_page',
    title: 'A Quiet Account',
    tier: 'record',
    frequency: 'common',
    tags: [],
    purposes: ['change_relationship', 'worldbuild_through_action', 'force_record_choice'],
    conditions: undefined,
    slots: {},
    interaction: {
      kind: 'narration',
      outcomes: [{
        id: 'quiet',
        weight: 100,
        text: 'The steward counted what was on the shelf.',
        tags: [],
        effects: [],
      }],
    },
    record: {
      subject: 'the ordinary household account',
      options: {
        record: { chronicle: 'The shelf was counted.', effects: [], claims: [] },
        omit: { chronicle: null, effects: [] },
        embellish: {
          chronicle: 'The shelf was finer than it was.',
          effects: [],
          claims: [],
          discrepancy: { id: 'quiet_account_lie', severity: 'minor', provableBy: ['household_account'] },
        },
      },
    },
  } as unknown as EventTemplate;

  return {
    kind: 'record',
    id: 'quiet_record',
    year: ctx.world.year,
    event,
    subject: 'the ordinary household account',
    entryId: 'chr_quiet',
    fill: {},
    options: [
      { option: 'record', chronicle: 'The shelf was counted.' },
      { option: 'omit', chronicle: null },
      { option: 'embellish', chronicle: 'The shelf was finer than it was.' },
    ],
  };
}

function bloodChoice(ctx: SimCtx) {
  const source = content.bundle.events.find((event) => event.interaction.kind === 'choice');
  if (!source) throw new Error('content has no choice event to use as a decision shell');
  const event = {
    ...source,
    id: 'bloodward_choice',
    title: 'Which Marriage Is Opened',
    frequency: 'common',
    tags: [],
    purposes: ['change_relationship', 'worldbuild_through_action', 'buy_patience'],
    conditions: undefined,
    slots: {},
    record: undefined,
    interaction: {
      kind: 'choice',
      decidedBy: 'player',
      choices: [
        {
          id: 'open_the_match',
          label: 'Open the match',
          requires: [],
          outcomes: [{
            id: 'opened',
            weight: 100,
            text: 'The house sends one of its own to market.',
            tags: [],
            effects: [{ kind: 'priorityMatch', target: 'head' }],
          }],
        },
        {
          id: 'leave_it',
          label: 'Leave it',
          requires: [],
          outcomes: [{
            id: 'left',
            weight: 100,
            text: 'Nothing is changed.',
            tags: [],
            effects: [],
          }],
        },
      ],
    },
  } as unknown as EventTemplate;
  const pending = queueChoice(ctx, event, event.body, {}, []);
  ctx.world.delegation.choices[event.id] = 'open_the_match';
  return pending;
}

describe('house ambition (issue #210)', () => {
  it('chooses, replaces, clears, and derives progress from the world', () => {
    const g = newGame(content, { seed: 210, campaign: 'short', decider: 'chronicler' });
    expect(g.view().ambition).toBeUndefined();

    expect(g.setAmbition('restore_ledger')).toBe(true);
    const before = g.view().ambition!;
    expect(before.id).toBe('restore_ledger');
    expect(before.progress.current).toBe(g.ctx.world.clausesRecovered.size);

    g.ctx.world.clausesRecovered.add('test_clause');
    const after = g.view().ambition!;
    expect(after.progress.current).toBe(before.progress.current + 1);

    expect(g.setAmbition('secure_branches')).toBe(true);
    expect(g.view().ambition?.id).toBe('secure_branches');
    expect(g.setAmbition(null)).toBe(true);
    expect(g.view().ambition).toBeUndefined();
  });


  it('counts family members, not staff, when securing cadet halls (#1201)', () => {
    const g = newGame(content, { seed: 1201, campaign: 'short', decider: 'chronicler' });
    const w = g.ctx.world;
    const [blood, resident] = w.people.household(w.playerHouse, w.year);
    if (!blood || !resident) throw new Error('the founded household needs two residents');

    const branchId = asId<BranchId>('br_ambition_viability_test');
    w.branches.set(branchId, {
      id: branchId,
      name: 'The younger hall',
      house: asId(w.playerHouse),
      founder: blood.id,
      splitFrom: MAIN_BRANCH,
      foundedYear: w.year,
      speaker: blood.id,
      grievance: 0,
    });
    const inBranch = (p: typeof blood, kind: typeof p.membership[number]['kind']) => {
      const membership = p.membership.find((m) => m.to === undefined);
      if (!membership) throw new Error('a living resident needs an open membership');
      membership.branch = branchId;
      membership.kind = kind;
    };
    inBranch(blood, 'cadet');
    inBranch(resident, 'retainer');
    g.setAmbition('secure_branches');

    // A relative and a servant do not make a viable family hall.
    expect(ambitionView(g.ctx)?.progress).toMatchObject({ current: 0, target: 1 });
    expect(relevantPeople(g.ctx).get(blood.id)).toContain('keeps a thin cadet hall alive');
    expect(relevantPeople(g.ctx).get(resident.id) ?? []).not.toContain('keeps a thin cadet hall alive');

    // A married-in spouse does: the same two residents can continue the line.
    inBranch(resident, 'married_in');
    expect(ambitionView(g.ctx)?.progress.current).toBe(1);
    expect(relevantPeople(g.ctx).get(blood.id) ?? []).not.toContain('keeps a thin cadet hall alive');

    // Two non-blood residents cannot earn a bloodline ambition either.
    inBranch(blood, 'retainer');
    expect(ambitionView(g.ctx)?.progress.current).toBe(0);
  });

  it('persists only the selected ambition and resumes it', () => {
    const g = newGame(content, { seed: 211, campaign: 'long', decider: 'chronicler' });
    g.setAmbition('raise_ascendant');
    const saved = JSON.parse(JSON.stringify(g.save()));

    expect(saved.houseAmbition).toBe('raise_ascendant');
    expect(saved.ambitionProgress).toBeUndefined();

    const resumed = resumeGame(saved, content, { decider: 'chronicler' });
    expect(resumed.view().ambition?.id).toBe('raise_ascendant');
  });

  it('does not alter simulation outcomes', () => {
    const withAmbition = newGame(content, { seed: 212, campaign: 'short', decider: 'chronicler' });
    const without = newGame(content, { seed: 212, campaign: 'short', decider: 'chronicler' });
    withAmbition.setAmbition('deepen_blood');

    withAmbition.advance(60);
    without.advance(60);

    const a = JSON.parse(JSON.stringify(withAmbition.save()));
    const b = JSON.parse(JSON.stringify(without.save()));
    delete a.savedAt; delete b.savedAt;
    delete a.houseAmbition; delete b.houseAmbition;
    // The one other trace a tracked ambition leaves is its reading at each
    // handover (#1867 §5): words kept as history, never an input to a roll.
    for (const reign of a.succession) delete reign.ambition;
    expect(b.succession.some((reign: { ambition?: string }) => reign.ambition !== undefined)).toBe(false);
    expect(a).toEqual(b);
  });

  it('reads the actual Match hand rather than one fixed blood blurb', () => {
    const g = newGame(content, { seed: 3271, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');

    const inward = ambitionRelevance(g.ctx, bloodMatch(g.ctx, false));
    const outward = ambitionRelevance(g.ctx, bloodMatch(g.ctx, true));

    expect(inward?.effect).toBe('endanger');
    expect(outward?.effect).toBe('advance');
    expect(inward?.reason).not.toBe(outward?.reason);
  });

  it('leaves an unrelated Record page irrelevant to restore_ledger and delegatable', () => {
    const g = newGame(content, { seed: 3272, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('restore_ledger');
    const pending = quietRecord(g.ctx);
    g.ctx.world.delegation.records[pending.event.id] = 'record';

    expect(ambitionRelevance(g.ctx, pending)).toBeUndefined();
    expect(mustSurface(g.ctx, pending)).toBeUndefined();
  });

  it('derives Ledger Record relevance from structure, not localisable wording', () => {
    const g = newGame(content, { seed: 3276, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('restore_ledger');
    const pending = quietRecord(g.ctx);
    pending.event.purposes = ['advance_clause', 'worldbuild_through_action', 'force_record_choice'];

    const before = ambitionRelevance(g.ctx, pending);
    expect(before).toEqual(expect.objectContaining({ surface: 'record', effect: 'advance' }));

    pending.subject = 'a differently worded household account';
    pending.options = [
      { option: 'record', chronicle: 'A different sentence was written.' },
      { option: 'omit', chronicle: null },
      { option: 'embellish', chronicle: 'Another different sentence was written.' },
    ];

    expect(ambitionRelevance(g.ctx, pending)).toEqual(before);
  });

  it('finds an Ascension Record participant by a slot named on the page', () => {
    const g = newGame(content, { seed: 3277, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('raise_ascendant');
    const scion = oneSubject(g.ctx);
    g.ctx.world.scion = scion.id;

    const pending = quietRecord(g.ctx);
    pending.fill = { SUBJECT: scion.id };
    pending.event.record!.options.record.chronicle = 'The book names {SUBJECT}.';
    pending.subject = 'an ordinary page with no programme words';

    expect(ambitionRelevance(g.ctx, pending)).toEqual(expect.objectContaining({
      surface: 'record',
      effect: 'advance',
    }));

    // Being in the event cast is not enough: the Record page itself has to
    // carry that slot. This is what keeps an off-page Scion from surfacing it.
    pending.event.record!.options.record.chronicle = 'The book names nobody.';
    expect(ambitionRelevance(g.ctx, pending)).toBeUndefined();
  });

  it('reads only the exact remembered choice branch when it changes the bloodline', () => {
    const g = newGame(content, { seed: 3273, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');
    const pending = bloodChoice(g.ctx);

    delete g.ctx.world.delegation.choices[pending.event.id];
    expect(ambitionRelevance(g.ctx, pending)).toBeUndefined();

    g.ctx.world.delegation.choices[pending.event.id] = 'open_the_match';
    expect(ambitionRelevance(g.ctx, pending)).toEqual(expect.objectContaining({
      surface: 'choice',
      effect: 'advance',
    }));
  });

  it('puts the derived reading on the session docket and omits it when irrelevant', () => {
    const g = newGame(content, { seed: 3274, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');
    g.ctx.world.pendingDecisions.length = 0;
    g.ctx.world.pendingDecisions.push(bloodMatch(g.ctx, true));

    expect(g.view().docket[0]?.ambition).toEqual(expect.objectContaining({
      surface: 'match',
      effect: 'advance',
    }));

    g.setAmbition('restore_ledger');
    g.ctx.world.pendingDecisions.length = 0;
    g.ctx.world.pendingDecisions.push(quietRecord(g.ctx));
    expect(g.view().docket[0]?.ambition).toBeUndefined();
  });

  it('reports current Ascension standing as progress and keeps the best rung as history', () => {
    const g = newGame(content, { seed: 3275, campaign: 'long', decider: 'chronicler' });
    g.setAmbition('raise_ascendant');
    g.ctx.world.ascension.rung = 'hierophant';
    g.ctx.world.ascension.best = 'hierophant';
    const before = ambitionView(g.ctx)!;

    g.ctx.world.ascension.rung = 'adept';
    const after = ambitionView(g.ctx)!;

    expect(after.progress.current).toBeLessThan(before.progress.current);
    expect(after.progress.label).toContain('Adept');
    expect(after.progress.label).toContain('Hierophant');
    expect(after.progress.label).toContain('reached before');
  });

  it('keeps the ambition reader out of hidden genetics, Bearing, RNG and checks', () => {
    const source = readFileSync(new URL('./ambition.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imports).toEqual([
      '@ed/schema',
      './world.js',
      // #1867 §4: the thin-line threshold the generation question already
      // reads. `generation.ts` is itself a pure reader of public pressures.
      './generation.js',
      './people/branches.js',
      './ascension.js',
      './campaign.js',
      './messages.js',
      './events/decisions.js',
    ]);
    expect(imports.some((path) => (path ?? '').includes('genetics/') || /bearing|rng|checks/i.test(path ?? ''))).toBe(false);
  });

  it('adapts campaign horizons without changing the catalogue', () => {
    const short = newGame(content, { seed: 213, campaign: 'short', decider: 'chronicler' });
    const long = newGame(content, { seed: 213, campaign: 'long', decider: 'chronicler' });
    short.setAmbition('raise_ascendant');
    long.setAmbition('raise_ascendant');

    expect(short.ambitionOptions()).toHaveLength(4);
    expect(long.ambitionOptions()).toHaveLength(4);
    expect(short.view().ambition?.progress.target).toBeLessThan(long.view().ambition!.progress.target);
  });
});

describe('the House Ambition speaks the reader\'s setting (#818, #819, #820)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./ambition.ts', import.meta.url), 'utf8'));
  const texts = (pattern: RegExp): Record<string, string> => Object.fromEntries(keyed
    .filter((entry) => pattern.test(entry.address))
    .map((entry) => [entry.address.split('#')[1], entry.text]));

  type Mode = 'original' | 'plainenglish';
  function world(mode: Mode, ambition: HouseAmbitionId) {
    const g = newGame(content, { seed: 818, campaign: 'short', decider: 'chronicler' });
    g.setAmbition(ambition);
    setProseVariants(g.ctx, keyed.map((entry) => ({
      address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
    })));
    setProseMode(g.ctx, mode);
    return g.ctx;
  }
  /** The Plain reading of an Original result: every prose field prefixed, everything else the same. */
  const plain = <T extends object>(value: T, fields: (keyof T)[]): T =>
    ({ ...value, ...Object.fromEntries(fields.map((f) => [f, `plain: ${String(value[f])}`])) });

  it('keys every Match and Record reason (#818)', () => {
    expect(texts(/#ambition\.(match|record)\./)).toEqual({
      'ambition.match.thin_line':
        "{NAME}'s watched line is thin; this hand does not simply add resilience because it reaches outward.",
      'ambition.match.outward_one': '{NAME} brings an outward line with {COUNT} completed life behind the reading.',
      'ambition.match.outward_many': '{NAME} brings an outward line with {COUNT} completed lives behind the reading.',
      'ambition.match.close_kin': 'Every open card folds the living blood back into close kin instead of widening the line.',
      'ambition.match.cadet_outward':
        'An outward spouse can join this cadet hall instead of drawing another useful relative out of it.',
      'ambition.match.cadet_draw_away':
        '{NAME} is carrying a cadet hall; marrying her into the seat would draw one of its living members away.',
      'ambition.match.cadet_new_household':
        '{NAME} stands in a cadet hall; this marriage can put another household into that branch.',
      'ambition.match.programme_kin':
        '{NAME} is in the programme, and this hand contains blood the family papers already join to the line.',
      'ambition.match.programme_outward':
        '{NAME} is in the programme, and every open line here is outward in the family papers.',
      'ambition.record.clause': 'This page belongs to an event authored to advance a missing Ledger clause.',
      'ambition.record.discrepancy':
        'This page is tied to a named disputed part of the family record the Ledger is already carrying.',
      'ambition.record.programme':
        'This page includes the Scion, his heir, or the man the house can already see foremost on the ladder.',
    });
  });

  it('reads a Match hand and a Record page in Plain English, and judges them the same (#818)', () => {
    const read = (mode: Mode) => {
      const blood = world(mode, 'deepen_blood');
      const ledger = world(mode, 'restore_ledger');
      const page = quietRecord(ledger);
      return [
        ambitionRelevance(blood, bloodMatch(blood, true)),
        ambitionRelevance(blood, bloodMatch(blood, false)),
        ambitionRelevance(ledger, {
          ...page, event: { ...page.event, purposes: [...page.event.purposes, 'advance_clause'] },
        }),
      ];
    };
    const original = read('original');
    expect(original.map((r) => r?.reason)).toEqual([
      'Mara of the Vale brings an outward line with 3 completed lives behind the reading.',
      'Every open card folds the living blood back into close kin instead of widening the line.',
      'This page belongs to an event authored to advance a missing Ledger clause.',
    ]);
    expect(read('plainenglish')).toEqual(original.map((r) => plain(r!, ['reason'])));
  });

  it('keys every choice-branch reason, and reads one in Plain English (#819)', () => {
    const branch = texts(/#ambition\.branch\./);
    expect(Object.keys(branch)).toHaveLength(21);
    expect(branch['ambition.branch.priority_match'])
      .toBe('The branch sends a living member of the line to the marriage market next.');
    expect(Object.values(branch).every((text) => text.startsWith('The branch '))).toBe(true);

    const read = (mode: Mode) => {
      const ctx = world(mode, 'deepen_blood');
      return ambitionRelevance(ctx, bloodChoice(ctx));
    };
    const original = read('original')!;
    expect(original).toMatchObject({
      surface: 'choice', effect: 'advance',
      reason: 'The branch sends a living member of the line to the marriage market next.',
    });
    expect(read('plainenglish')).toEqual(plain(original, ['reason']));
  });

  it('keys the ambition panel, and renders every ambition in Plain English (#820)', () => {
    expect(Object.keys(texts(/#ambition\.(name|purpose)\./))).toHaveLength(8);
    expect(texts(/#ambition\.view\./)).toMatchObject({
      'ambition.view.ledger_progress': '{CURRENT} of {TARGET} clauses recovered',
      'ambition.view.ledger_missing_one': '{COUNT} clause still missing.',
      'ambition.view.ledger_missing_many': '{COUNT} clauses still missing.',
      'ambition.view.ascent_progress': '{HELD} held now; {HORIZON} is the campaign horizon',
      'ambition.view.ascent_progress_fallen': '{HELD} held now; {BEST} was reached before; {HORIZON} is the campaign horizon',
    });

    const ids: HouseAmbitionId[] = ['deepen_blood', 'raise_ascendant', 'restore_ledger', 'secure_branches'];
    const read = (mode: Mode) => ids.map((id) => {
      const ctx = world(mode, id);
      return { view: ambitionView(ctx)!, options: ambitionOptions(ctx) };
    });
    const original = read('original');
    expect(original.map((r) => r.view.name))
      .toEqual(['Deepen the blood', 'Prepare the ascent', 'Restore the Ledger', 'Secure the branches']);
    expect(read('plainenglish')).toEqual(original.map(({ view, options }) => ({
      view: { ...plain(view, ['name', 'purpose', 'status', 'next']), progress: plain(view.progress, ['label']) },
      options: options.map((o) => plain(o, ['name', 'purpose'])),
    })));
  });
});

describe('the opening hands the player a recommended ambition (#1867 §4)', () => {
  it('opens both full campaigns, under both founding configurations, on a plan with a reason', () => {
    for (const campaign of ['short', 'long'] as const) {
      for (const configuration of ['blood_father', 'blood_mother'] as const) {
        const gender = configuration === 'blood_mother' ? 'woman' as const : 'man' as const;
        const ctx = bootstrap(content, 1867, campaignDef(campaign).startYear, campaign, [],
          { founder: { gender, configuration } });
        expect(recommendAmbition(ctx), `${campaign} · ${configuration}`).toEqual({
          id: 'deepen_blood',
          name: 'Deepen the blood',
          reason: 'Only 4 of the blood are living. Every other plan depends on the line outlasting this generation.',
        });
        // Advice, not a choice made for the player.
        expect(ctx.world.houseAmbition).toBeNull();
      }
    }
  });

  it('reaches the session view, and the demo, which offers no ambitions, recommends none', () => {
    const game = newGame(content, { seed: 1867, campaign: 'short', decider: 'chronicler' });
    const recommended = game.view().ambitionRecommendation;
    expect(recommended?.id).toBe('deepen_blood');
    expect(game.setAmbition(recommended!.id)).toBe(true);
    expect(game.view().ambition?.id).toBe('deepen_blood');

    const demo = newGame(content, { seed: 1867, campaign: 'demo', decider: 'chronicler' });
    expect(demo.view().ambitionOptions).toEqual([]);
    expect(demo.view().ambitionRecommendation).toBeUndefined();
  });

  it('follows the house: a Ledger in reach, then a hall about to break, then the bargain itself', () => {
    const ctx = testWorld(content);
    const w = ctx.world;
    for (let i = 0; i < 8; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 20 + i, name: `Broadline${i}` });
    const target = campaignDef(w.campaign).clauses;
    const recovered = new Set(w.clausesRecovered);

    expect(recommendAmbition(ctx)).toMatchObject({
      id: 'restore_ledger',
      reason: `Nothing presses harder than the bargain itself. ${target - recovered.size} clauses of it are still unread.`,
    });

    const branchId = asId<BranchId>('br_ambition_recommend_test');
    const speaker = w.people.living().find((p) => p.name === 'Broadline1')!;
    w.branches.set(branchId, {
      id: branchId, name: 'The river hall', house: asId(w.playerHouse), founder: speaker.id,
      splitFrom: MAIN_BRANCH, foundedYear: w.year, speaker: speaker.id, grievance: 75,
    });
    expect(recommendAmbition(ctx)).toMatchObject({
      id: 'secure_branches', reason: 'The river hall is close to breaking with the seat.',
    });
    // A hall that has died out cannot break away.
    w.branches.get(branchId)!.extinct = w.year;
    expect(recommendAmbition(ctx)?.id).toBe('restore_ledger');
    w.branches.get(branchId)!.extinct = undefined;

    for (let i = 0; w.clausesRecovered.size < target - 1; i++) w.clausesRecovered.add(asId(`test_clause_${i}`));
    expect(recommendAmbition(ctx)).toMatchObject({ id: 'restore_ledger', reason: 'The Ledger is one clause from whole.' });

    // A thin line outranks everything else the house can see.
    for (const p of w.people.living().filter((p) => p.name.startsWith('Broadline'))) p.status = 'dead';
    expect(recommendAmbition(ctx)?.id).toBe('deepen_blood');
  });

  it('gives a Regency something to do while nobody climbs', () => {
    const ctx = testWorld(content);
    const w = ctx.world;
    const founder = w.people.get(w.narrator!)!;
    founder.castSlots = founder.castSlots.filter((s) => s !== 'head');
    const regent = place(ctx, { sex: 'female', age: 40, name: 'Maud the Regent', castSlots: ['head'] });
    w.houseAmbition = 'raise_ascendant';

    const view = ambitionView(ctx)!;
    expect(view.next).toContain('While Maud the Regent keeps the seal, nobody climbs.');
    regent.castSlots = [];
    founder.castSlots.push('head');
    expect(ambitionView(ctx)!.next).not.toContain('keeps the seal');
  });

  it('keys every recommendation, and reads one in Plain English', () => {
    const keyed = coreMessageEntries(readFileSync(new URL('./ambition.ts', import.meta.url), 'utf8'));
    expect(keyed.filter((e) => /#ambition\.recommend\./.test(e.address))).toHaveLength(8);
    const read = (mode: 'original' | 'plainenglish') => {
      const ctx = testWorld(content);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      return recommendAmbition(ctx)!;
    };
    const original = read('original');
    expect(read('plainenglish')).toEqual({
      ...original, name: `plain: ${original.name}`, reason: `plain: ${original.reason}`,
    });
  });
});

describe('a handover reads the outgoing generation against the plan (#1867 §5)', () => {
  function handover(ambition: HouseAmbitionId | null) {
    const ctx = bootstrap(content, 1867, 1042, 'long');
    const w = ctx.world;
    w.houseAmbition = ambition;
    w.year = 1070;
    w.people.kill(w.narrator!, w.year, 'a test');
    expect(w.people.get(w.narrator!)!.status).toBe('guardian');
    expect(ensureHead(ctx, makeRng(1)).newHead).toBeDefined();
    return ctx;
  }

  it('keeps what the tracked ambition read the year the seal passed, and shows it with the answer', () => {
    const ctx = handover('deepen_blood');
    const closed = ctx.world.succession.at(-2)!;
    expect(closed.to).toBe(1070);
    expect(closed.ambition).toMatch(/^Ambition — Deepen the blood: \d+ living of the blood; 14 is a resilient line\. /);

    // History, not a reading: a later change to the house does not rewrite it.
    const kept = closed.ambition;
    ctx.world.houseAmbition = 'restore_ledger';
    expect(ctx.world.succession.at(-2)!.ambition).toBe(kept);

    // It survives the save, and the session shows it beside the generation's answer.
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(resumed.world.succession.at(-2)!.ambition).toBe(kept);
    const game = resumeGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(game.view().generationArc?.previous?.ambition).toBe(kept);
  });

  it('records nothing when no ambition was kept', () => {
    expect(handover(null).world.succession.at(-2)!.ambition).toBeUndefined();
  });
});

describe('the ascent says what its last step will ask, in time (#1867 §6)', () => {
  function house(campaign: 'short' | 'long') {
    const ctx = testWorld(content);
    ctx.world.campaign = campaign;
    ctx.world.houseAmbition = 'raise_ascendant';
    return ctx;
  }

  it('warns the Long Line once an elder has taken both rites, naming him', () => {
    const ctx = house('long');
    expect(ambitionView(ctx)!.ahead).toBeUndefined();
    const elder = place(ctx, { sex: 'male', age: 58, name: 'Aldren the Elder' });
    elder.rites.push('vessel');
    expect(ambitionView(ctx)!.ahead, 'one rite is not yet the elder the last step spends').toBeUndefined();
    elder.rites.push('great_rite');
    expect(ambitionView(ctx)!.ahead).toBe(
      'Aldren the Elder has taken both rites. The last step spends a two-rite elder to raise a younger descendant of the blood, so one great climber is not enough: prepare the next now.',
    );

    // Once the Unmaking has been done, there is nothing left to prepare for.
    const raised = place(ctx, { sex: 'male', age: 30, name: 'The Raised' });
    raised.rites.push('unmaking');
    expect(ambitionView(ctx)!.ahead).toBeUndefined();
  });

  it('says nothing on the Short Line, whose horizon is not the God rung', () => {
    const ctx = house('short');
    const elder = place(ctx, { sex: 'male', age: 58, name: 'Aldren the Elder' });
    elder.rites.push('vessel', 'great_rite');
    expect(ambitionView(ctx)!.ahead).toBeUndefined();
  });
});
