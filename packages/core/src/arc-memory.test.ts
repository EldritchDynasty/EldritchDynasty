import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import type { ArcDef, ArcInstance, ContentBundle, EventTemplate, Outcome } from '@ed/schema';
import { evalCondition } from '@ed/core';
import { advanceArc, applyEffect, chooseSuccessor, dueArcSteps, startArc, testRng, testWorld } from '@ed/core';

// The BUNDLE, not the indexed content: these tests add an arc, and `indexContent`
// hands an already-indexed `Content` straight back — so spreading one would give
// an object whose `arcs` array had the new arc in it and whose `arc()` lookup
// did not.
const base = loadBundle();

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
