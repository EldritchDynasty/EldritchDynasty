import { describe, expect, it, vi } from 'vitest';
import { loadBundle } from '@ed/content';
import type { ArcDef, ArcInstance, ContentBundle, EventTemplate, Outcome } from '@ed/schema';
import { asId } from '@ed/schema';
import { evalCondition } from '@ed/core';
import { advanceArc, applyEffect, CAMPAIGNS, chooseSuccessor, dueArcSteps, genomeOf, place, startArc, testRng, testWorld } from '@ed/core';
import { executeOutcomeWitness } from './events/reach.js';
import { applyRecord, queueChoice, resolveChoice } from './events/decisions.js';
import { canonical, loadGame, saveGame } from './save.js';

// The BUNDLE, not the indexed content: these tests add an arc, and `indexContent`
// hands an already-indexed `Content` straight back — so spreading one would give
// an object whose `arcs` array had the new arc in it and whose `arc()` lookup
// did not.
const base = loadBundle();

describe('the ring does not reveal an unknown replacement through a binding (#1824)', () => {
  function ringHeir(expresses: boolean, awakened: boolean, originalSurvives = false) {
    const ctx = testWorld(base, 18241);
    for (const person of ctx.world.people.living()) person.awakening.awakened = false;
    const wearer = place(ctx, { sex: 'male', age: 50, name: 'The known wearer', awakened: true });
    const heir = place(ctx, { sex: 'male', age: 25, name: 'His heir', awakened });
    for (const [person, capacity] of [[wearer, true], [heir, expresses]] as const) {
      const genome = genomeOf(person, ctx.genetics);
      for (const index of ctx.genetics.table.fontIndices) {
        const allele = ctx.genetics.table.xAlleles[index]!.findIndex((entry) => capacity ? entry.effect > 0 : entry.effect === 0);
        if (allele < 0) throw new Error('ring witness lacks a font allele');
        genome.sex[0][index] = allele;
      }
      person.phenotype = undefined;
    }
    ctx.world.people.setParents(heir.id, { father: wearer.id });
    const instance = startArc(ctx.content.mustArc('arc_the_two_it_fitted'), ctx, testRng('ring-heir'), { WEARER: wearer.id });
    if (!instance) throw new Error('ring witness did not start');
    if (!originalSurvives) ctx.world.people.kill(wearer.id, ctx.world.year, 'before the household decides');
    return { ctx, wearer, heir, instance };
  }

  it.each([[false, false], [true, false], [true, true]] as const)('does not substitute an heir (capacity %s, awakened %s) before the first price', (capacity, awakened) => {
    const { ctx, heir, instance } = ringHeir(capacity, awakened);
    const steps = dueArcSteps(ctx, testRng('ring-replacement'));
    expect(steps.some((step) => step.fill.WEARER === heir.id)).toBe(false);
    expect(instance.status).toBe('cancelled');
  });

  it('keeps the original living wearer bound to the first household choice', () => {
    const { ctx, wearer, instance } = ringHeir(false, false, true);
    const step = dueArcSteps(ctx, testRng('ring-original')).find((entry) => entry.instance.id === instance.id);
    expect(step?.fill.WEARER).toBe(wearer.id);
    expect(instance.status).toBe('active');
  });

  it('keeps the paid consequence bound to the dead wearer', () => {
    const { ctx, wearer, instance } = ringHeir(false, false);
    instance.node = 'what_it_costs';
    instance.dueYear = ctx.world.year;
    const step = dueArcSteps(ctx, testRng('ring-dead-wearer')).find((entry) => entry.instance.id === instance.id);
    expect(step?.fill.WEARER).toBe(wearer.id);
    expect(step?.absent).toBe(true);
    if (!step) throw new Error('the paid consequence lost its bound wearer');
    const madness = wearer.madness;
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('ring_what_it_costs'), {
      choiceId: 'keep_him_close', expectedOutcomeId: 'kept', arcStep: step, rng: testRng('ring-paid-cost'),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(wearer.status).toBe('dead');
    expect(wearer.madness).toBe(madness + 18);
  });
});

describe('inline follow-up entry delays (#1278)', () => {
  it.each([false, true])('retains only declared persistent slots when inline is %s (#1285)', (inline) => {
    const arc = { ...structuredClone(TWO_BEAT), inline, bindings: ['MENTOR'] };
    const ctx = testWorld(bundleWith(arc, [node('first'), node('second')]));
    const mentor = place(ctx, { sex: 'male', age: 40 });
    const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'))!;
    const instance = startArc(ctx.content.mustArc(arc.id), ctx, testRng(), {
      MENTOR: mentor.id, HEAD: head.id,
    });
    expect(instance?.bindings).toEqual({ MENTOR: mentor.id });
  });

  it.each([
    { after: 'immediate' as const, min: 0, max: 0 },
    { after: 'next_generation' as const, min: 20, max: 31 },
    { after: { minYears: 7, maxYears: 7 }, min: 7, max: 7 },
    { after: { minYears: 40, maxYears: 50 }, min: 40, max: 50 },
  ])('waits for the authored $after before presenting the first follow-up', ({ after, min, max }) => {
    const root = {
      ...node('test_delayed_parent'),
      interaction: {
        kind: 'narration',
        outcomes: [{
          ...outcome('sent'),
          next: { event: 'test_delayed_child', after, keep: [] },
        }],
      },
    } as EventTemplate;
    const child = node('test_delayed_child');
    const ctx = testWorld({ ...base, events: [...base.events, root, child] });
    const year = ctx.world.year;
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent(root.id), {
      expectedOutcomeId: 'sent', rng: testRng(),
    });
    expect(result.ok, result.reason).toBe(true);
    const instance = [...ctx.world.arcs.values()].find((entry) =>
      ctx.content.arc(entry.arc)?.inline);
    expect(instance).toBeDefined();
    if (!instance) throw new Error('the parent did not start its compiled follow-up');
    expect(instance.dueYear).toBeGreaterThanOrEqual(year + min);
    expect(instance.dueYear).toBeLessThanOrEqual(year + max);
    const due = instance.dueYear!;
    if (min > 0) {
      expect(dueArcSteps(ctx, testRng())).toHaveLength(0);
      ctx.world.year = due - 1;
      expect(dueArcSteps(ctx, testRng())).toHaveLength(0);
    }
    ctx.world.year = due;
    expect(dueArcSteps(ctx, testRng()).map((step) => step.node.event)).toEqual([child.id]);
  });

  it('keeps authored arc entries immediate even when they declare a schedule', () => {
    const arc = structuredClone(TWO_BEAT);
    arc.nodes[0]!.schedule = { minYears: 40, maxYears: 50 };
    const { ctx, instance } = running(arc, [node('first'), node('second')]);
    expect(instance.dueYear).toBe(ctx.world.year);
    expect(dueArcSteps(ctx, testRng())[0]?.node.id).toBe('first');
  });
});

describe('the Hall letter before collection (#1971)', () => {
  function letter(campaign: 'short' | 'long' = 'long', gated = false) {
    const source = { ...base, events: base.events.map(event => gated && event.id === 'the_hall_is_answered'
      ? { ...event, conditions: { flag: 'hall_ready' } } as EventTemplate : event) };
    const end = CAMPAIGNS[campaign].endYear;
    const ctx = testWorld(source, 1971, end - 16);
    ctx.world.campaign = campaign;
    ctx.world.discontent = 40;
    const branch = 'term_test_hall';
    const cousin = place(ctx, { sex: 'male', age: 30, name: 'The letter writer', branch });
    cousin.membership.find(entry => entry.to === undefined)!.kind = 'cadet';
    ctx.world.branches.set(branch, {
      id: asId(branch), name: 'The third hall', house: asId(ctx.world.playerHouse), founder: cousin.id,
      splitFrom: 'main', foundedYear: ctx.world.year - 10, speaker: cousin.id, grievance: 0,
    });
    const rng = testRng('late-letter');
    vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.99 * (max - min));
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_that_waited'), {
      expectedOutcomeId: 'somebody_reads_it_properly', targetWeightedOutcome: true, rng,
    });
    expect(result.ok, result.reason).toBe(true);
    const instance = [...ctx.world.arcs.values()].find(entry => entry.arc === 'inline_the_hall_that_waited__somebody_reads_it_properly');
    if (!instance) throw new Error('the letter did not start its promised continuation');
    expect(instance.dueYear).toBe(end);
    expect(instance.bindings.COUSIN).toBe(cousin.id);
    const page = ctx.world.chronicle.find(entry => entry.eventId === 'the_hall_that_waited')!;
    expect(instance.cause).toEqual({ year: page.year, page: page.id });
    return { ctx, instance, cousin, page };
  }

  it.each(['short', 'long'] as const)('keeps the people and launching page through a saved %s continuation and choice', (campaign) => {
    const { ctx, instance, page } = letter(campaign);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), ctx.content);
    expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
    resumed.world.year = instance.dueYear!;
    const step = dueArcSteps(resumed, testRng()).find(entry => entry.instance.id === instance.id)!;
    expect(step.fill).toEqual(instance.bindings);
    const event = resumed.content.mustEvent(step.node.event);
    const pending = queueChoice(resumed, event, event.body, step.fill, step.playerCast, step);
    const answered = loadGame(JSON.parse(JSON.stringify(saveGame(resumed))), resumed.content);
    expect(canonical(saveGame(answered))).toBe(canonical(saveGame(resumed)));
    expect(resolveChoice(answered, pending.id, 'give_them_something_real', testRng()).ok).toBe(true);
    const continuation = answered.world.chronicle.find(entry => entry.eventId === 'the_hall_is_answered')!;
    expect(continuation.year).toBe(CAMPAIGNS[campaign].endYear);
    expect(continuation.cause).toEqual({ year: page.year, page: page.id });
    expect(answered.world.arcs.get(instance.id)?.status).toBe('ended');
    expect(dueArcSteps(answered, testRng())).toHaveLength(0);
  });

  it('still cancels when the kept writer dies instead of substituting another cousin', () => {
    const { ctx, instance, cousin } = letter();
    ctx.world.people.kill(cousin.id, ctx.world.year, 'before the promised return');
    place(ctx, { sex: 'male', age: 30, name: 'Another cousin', branch: 'term_test_hall' })
      .membership.find(entry => entry.to === undefined)!.kind = 'cadet';
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, testRng())).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
    expect(instance.bindings.COUSIN).toBe(cousin.id);
  });

  it('still retries unmet conditions past collection instead of overriding the premise', () => {
    const { ctx, instance } = letter('long', true);
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, testRng())).toHaveLength(0);
    expect(instance.status).toBe('active');
    expect(instance.dueYear).toBe(CAMPAIGNS.long.endYear + 5);
  });
});

/**
 * WHAT A STORY REMEMBERS.
 *
 * `ArcInstance.localFlags` was declared, saved, initialised to `{}` and read by
 * nothing — invariant 11 in its purest form: a field that looks like a working
 * feature which has not come up yet. These tests are the reason it is not that
 * any more, and they check the property that makes it worth having: a guard
 * three beats downstream can ask what the first beat decided, and the answer
 * does not leak into any other run of any other story.
 */

function outcome(id: string, tags: string[] = []): Outcome {
  return { id, weight: 100, text: `${id}.`, tags, effects: [] };
}

/** Two branches, four endings — enough for `fromChoice` and `fromTag` to differ. */
function node(id: string): EventTemplate {
  return {
    id,
    title: id,
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
      decidedBy: 'player',
      choices: [
        { id: 'pay', label: 'Pay', requires: [], outcomes: [outcome('paid_well', ['smooth']), outcome('paid_badly', ['ugly'])] },
        { id: 'refuse', label: 'Refuse', requires: [], outcomes: [outcome('refused', ['ugly'])] },
      ],
    },
  } as EventTemplate;
}

function bundleWith(arc: ArcDef, events: EventTemplate[]): ContentBundle {
  return {
    ...base,
    arcs: [...base.arcs, arc],
    events: [
      ...base.events,
      ...events.map((e) => ({ ...e, arc: { of: arc.id, node: e.id } })),
    ],
  } as ContentBundle;
}

const TWO_BEAT: ArcDef = {
  id: 'test_arc',
  title: 'A Test of Two Beats',
  entry: 'first',
  nodes: [
    { id: 'first', event: 'first', selection: 'first_match', schedule: 'immediate', successors: [] },
    { id: 'second', event: 'second', selection: 'first_match', schedule: 'immediate', successors: [] },
  ],
  bindings: [],
  maxConcurrentInstances: 1,
  inline: false,
};

function running(arc: ArcDef, events: EventTemplate[]) {
  const bundle = bundleWith(arc, events);
  const ctx = testWorld(bundle);
  const instance = startArc(ctx.content.mustArc(arc.id), ctx, testRng())!;
  return { ctx, instance };
}

describe('the launching page of an inline story (#1946)', () => {
  function inline() {
    const herald = base.events.find(event => event.id === 'the_heralds_visitation')!;
    const first = node('test_inline_first');
    if (first.interaction.kind === 'choice') first.interaction.choices[1]!.outcomes[0]!.next = {
      event: 'test_inline_second', after: { minYears: 2, maxYears: 2 }, keep: [],
    };
    const parent = {
      ...node('test_inline_parent'), frequency: 'common', slots: structuredClone(herald.slots),
      record: structuredClone(herald.record),
      interaction: { kind: 'narration', outcomes: [{ ...outcome('sent'),
        next: { event: first.id, after: { minYears: 3, maxYears: 3 }, keep: [] } }] },
    } as EventTemplate;
    return testWorld({ ...base, events: [...base.events, parent, first, node('test_inline_second')] });
  }
  function launch(ctx: ReturnType<typeof inline>) {
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('test_inline_parent'), {
      expectedOutcomeId: 'sent', rng: testRng('launch'),
    });
    expect(result.ok, result.reason).toBe(true);
    return ctx.world.chronicle.at(-1)!;
  }
  function next(ctx: ReturnType<typeof inline>, instance: ArcInstance) {
    ctx.world.year = instance.dueYear!;
    return dueArcSteps(ctx, testRng('next')).find(step => step.instance.id === instance.id)!;
  }
  function answer(ctx: ReturnType<typeof inline>, instance: ArcInstance) {
    const step = next(ctx, instance);
    expect(step).toBeDefined();
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent(step.node.event), {
      choiceId: 'refuse', expectedOutcomeId: 'refused', arcStep: step, rng: testRng('refuse'),
    });
    expect(result.ok, result.reason).toBe(true);
    return ctx.world.chronicle.at(-1)!;
  }

  it.each([1, 2])('keeps exact same-year page identities with %s concurrent instance(s)', (maximum) => {
    const ctx = inline();
    const origin = launch(ctx);
    const first = [...ctx.world.arcs.values()][0]!;
    ctx.content.mustArc(first.arc).maxConcurrentInstances = maximum;
    const other = launch(ctx);
    const instances = [...ctx.world.arcs.values()];
    expect(instances).toHaveLength(maximum);
    expect(first.cause).toEqual({ year: origin.year, page: origin.id });
    expect(answer(ctx, first).cause).toEqual(first.cause);
    if (maximum === 2) expect(answer(ctx, instances[1]!).cause).toEqual({ year: other.year, page: other.id });
  });

  it('cites an omitted launching page after saving a pending continuation', () => {
    const ctx = inline();
    const origin = launch(ctx);
    applyRecord(ctx, ctx.content.mustEvent('test_inline_parent'), origin.id!, 'omit');
    expect(origin.text).toBeNull();
    const instance = [...ctx.world.arcs.values()][0]!;
    const step = next(ctx, instance);
    const event = ctx.content.mustEvent(step.node.event);
    const pending = queueChoice(ctx, event, event.body, step.fill, step.playerCast, step);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), ctx.content);
    expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
    const decision = resumed.world.pendingDecisions[0]!;
    if (decision.kind !== 'choice') throw new Error('inline continuation must be a choice');
    expect(decision.arcStep?.instance).toBe(resumed.world.arcs.get(instance.id));
    expect(resolveChoice(resumed, pending.id, 'refuse', testRng('saved')).ok).toBe(true);
    expect(resumed.world.chronicle.at(-1)?.cause).toEqual({ year: origin.year, page: origin.id });
  });

  it('uses the immediate preceding node for later beats', () => {
    const ctx = inline();
    const origin = launch(ctx);
    const instance = [...ctx.world.arcs.values()][0]!;
    const first = answer(ctx, instance);
    expect(first.cause?.page).toBe(origin.id);
    const second = answer(ctx, instance);
    expect(second.cause).toEqual({ year: first.year, page: first.id });
    expect(instance.status).toBe('ended');
  });

  it('does not invent a launcher for a legacy active arc', () => {
    const ctx = inline();
    launch(ctx);
    const saved = saveGame(ctx);
    delete saved.arcs[0]![1].cause;
    const resumed = loadGame(JSON.parse(JSON.stringify(saved)), ctx.content);
    const instance = [...resumed.world.arcs.values()][0]!;
    expect(instance.cause).toBeUndefined();
    expect(answer(resumed, instance).cause).toBeUndefined();
  });
});

describe('arc-local memory', () => {
  it('an arc_flag effect writes onto the instance in scope, and only that one', () => {
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    const other: ArcInstance = { ...instance, id: 'other', localFlags: {} };

    applyEffect({ kind: 'arc_flag', flag: 'paid', set: true }, ctx, {}, { arc: instance });

    expect(instance.localFlags.paid).toBe(true);
    expect(other.localFlags.paid).toBeUndefined();
  });

  it('an arc_flag effect with no arc in scope writes nowhere, and does not throw', () => {
    // `arcs/flags` fails the build on one authored outside a substory. If one
    // reaches the engine anyway it must be inert rather than fatal — an event
    // that crashes the year is worse than an effect that does nothing.
    const { ctx } = running(TWO_BEAT, [node('first'), node('second')]);
    expect(() => applyEffect({ kind: 'arc_flag', flag: 'paid', set: true }, ctx, {})).not.toThrow();
  });

  it('arcFlag reads it back, and is FALSE with no arc in scope', () => {
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    instance.localFlags.paid = true;

    expect(evalCondition({ arcFlag: 'paid' }, ctx, { arc: instance })).toBe(true);
    expect(evalCondition({ arcFlag: 'unpaid' }, ctx, { arc: instance })).toBe(false);
    // The expensive default, refused. A story-local memory has no answer for
    // the ambient pool, and answering `true` would fire every event gated on a
    // substory's progress in runs where that substory never started.
    expect(evalCondition({ arcFlag: 'paid' }, ctx)).toBe(false);
  });

  it('arcFlag compares a value, not only presence', () => {
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    instance.localFlags.owed = 400;
    expect(evalCondition({ arcFlag: 'owed', is: 400 }, ctx, { arc: instance })).toBe(true);
    expect(evalCondition({ arcFlag: 'owed', is: 300 }, ctx, { arc: instance })).toBe(false);
  });

  it('the combinators forward the scope', () => {
    // A nested `all` that dropped the scope would make `{all:[{arcFlag}]}` mean
    // something different from `{arcFlag}` — the kind of bug that reads as
    // flaky content rather than as a bug.
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    instance.localFlags.paid = true;
    expect(evalCondition({ all: [{ any: [{ not: { arcFlag: 'nope' } }, { arcFlag: 'paid' }] }] }, ctx, { arc: instance })).toBe(true);
  });

  it('arcVisited knows which beats this run has already played', () => {
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    expect(evalCondition({ arcVisited: 'first' }, ctx, { arc: instance })).toBe(false);

    advanceArc({ instance, node: TWO_BEAT.nodes[0]!, fill: {}, playerCast: [], absent: false }, outcome('paid_well'), 'pay', ctx, testRng());
    expect(evalCondition({ arcVisited: 'first' }, ctx, { arc: instance })).toBe(true);
  });
});

describe('successors', () => {
  const guarded = (extra: Partial<{ fromOutcome: string; fromChoice: string; fromTag: string }>) => ({
    ...TWO_BEAT,
    nodes: [
      {
        ...TWO_BEAT.nodes[0]!,
        successors: [{ to: 'second', weight: 100, ...extra }],
      },
      TWO_BEAT.nodes[1]!,
    ],
  });

  it('fromChoice matches the branch, whoever took it', () => {
    const arc = guarded({ fromChoice: 'pay' });
    const { ctx, instance } = running(arc, [node('first'), node('second')]);
    // Both endings hang off the same branch. `fromOutcome` could not express
    // "the house paid, however it went"; `fromChoice` is exactly that.
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_well'), 'pay', instance, ctx, testRng())).toBe('second');
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_badly'), 'pay', instance, ctx, testRng())).toBe('second');
    expect(chooseSuccessor(arc.nodes[0]!, outcome('refused'), 'refuse', instance, ctx, testRng())).toBe('end');
  });

  it('fromTag covers a family of endings without naming each', () => {
    const arc = guarded({ fromTag: 'ugly' });
    const { ctx, instance } = running(arc, [node('first'), node('second')]);
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_badly', ['ugly']), 'pay', instance, ctx, testRng())).toBe('second');
    expect(chooseSuccessor(arc.nodes[0]!, outcome('refused', ['ugly']), 'refuse', instance, ctx, testRng())).toBe('second');
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_well', ['smooth']), 'pay', instance, ctx, testRng())).toBe('end');
  });

  it('the guards AND together', () => {
    const arc = guarded({ fromChoice: 'pay', fromTag: 'smooth' });
    const { ctx, instance } = running(arc, [node('first'), node('second')]);
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_well', ['smooth']), 'pay', instance, ctx, testRng())).toBe('second');
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_badly', ['ugly']), 'pay', instance, ctx, testRng())).toBe('end');
  });

  it('a `when` can read the story\'s own memory', () => {
    const arc = {
      ...TWO_BEAT,
      nodes: [
        { ...TWO_BEAT.nodes[0]!, successors: [{ to: 'second', weight: 100, when: { arcFlag: 'paid' } }] },
        TWO_BEAT.nodes[1]!,
      ],
    };
    const { ctx, instance } = running(arc, [node('first'), node('second')]);
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_well'), 'pay', instance, ctx, testRng())).toBe('end');
    instance.localFlags.paid = true;
    expect(chooseSuccessor(arc.nodes[0]!, outcome('paid_well'), 'pay', instance, ctx, testRng())).toBe('second');
  });

  it('history records which branch was taken, not only how it ended', () => {
    const { ctx, instance } = running(TWO_BEAT, [node('first'), node('second')]);
    advanceArc({ instance, node: TWO_BEAT.nodes[0]!, fill: {}, playerCast: [], absent: false }, outcome('paid_badly'), 'pay', ctx, testRng());
    expect(instance.history[0]).toMatchObject({ node: 'first', outcome: 'paid_badly', choice: 'pay' });
  });
});

describe('a due step waits for its event\'s conditions (#996)', () => {
  // `dueArcSteps` used to present a due node without reading its event's
  // `conditions` at all, so every `Outcome.next` follow-up's premise was inert.
  // A promise of a scene waits for its premise, as it waits for a missing cast.
  const isDue = (ctx: ReturnType<typeof running>['ctx'], instance: ArcInstance) =>
    dueArcSteps(ctx, testRng()).find((step) => step.instance.id === instance.id);

  it('defers a due step whose premise does not hold, and fires it once it does', () => {
    const gated = { ...node('first'), conditions: { all: [{ flag: 'premise_kept', is: true }] } } as EventTemplate;
    const { ctx, instance } = running(TWO_BEAT, [gated, node('second')]);
    const year = ctx.world.year;

    expect(isDue(ctx, instance)).toBeUndefined();
    expect(instance.status).toBe('active');
    expect(instance.dueYear).toBe(year + 5);

    ctx.world.flags.set('premise_kept', true);
    ctx.world.year = instance.dueYear!;
    expect(isDue(ctx, instance)?.node.id).toBe('first');
  });

  it('lets a node\'s own condition read this instance\'s arc-local flags', () => {
    const gated = { ...node('first'), conditions: { arcFlag: 'promised', is: true } } as EventTemplate;
    const { ctx, instance } = running(TWO_BEAT, [gated, node('second')]);

    expect(isDue(ctx, instance)).toBeUndefined();
    instance.localFlags.promised = true;
    ctx.world.year = instance.dueYear!;
    expect(isDue(ctx, instance)?.node.id).toBe('first');
  });
});
