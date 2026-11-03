import { describe, expect, it, vi } from 'vitest';
import type { ArcDef, ArcNode } from '@ed/schema';
import { advanceArc, CAMPAIGNS, END_YEAR, minimumArcYears, scheduleNext, startArc, testRng, testWorld } from '@ed/core';
import { loadContent } from '@ed/content';

const content = loadContent();

function node(id: string, schedule: ArcNode['schedule'], to: string[] = []): ArcNode {
  return {
    id,
    event: `test_${id}`,
    selection: 'first_match',
    schedule,
    successors: to.map((target) => ({ to: target, weight: 100 })),
  };
}

function arc(nodes: ArcNode[]): ArcDef {
  return {
    id: 'test_term_arc',
    title: 'A Term Test',
    entry: nodes[0]!.id,
    nodes,
    bindings: [],
    maxConcurrentInstances: 1,
    inline: false,
  };
}

describe('arc start windows (#133)', () => {
  it.each(['short', 'long'] as const)('includes the inline entry delay in the %s campaign start window (#1278)', (campaign) => {
    const a = arc([node('entry', { minYears: 40, maxYears: 40 }, ['end'])]);
    a.inline = true;
    expect(minimumArcYears(a)).toBe(40);
    const end = CAMPAIGNS[campaign].endYear;
    const exact = testWorld(content, 1, end - 40);
    exact.world.campaign = campaign;
    expect(startArc(a, exact, testRng())?.dueYear).toBe(end);
    const late = testWorld(content, 1, end - 39);
    late.world.campaign = campaign;
    const counter = late.world.counters.arc;
    expect(startArc(a, late, testRng())).toBeUndefined();
    expect(late.world.counters.arc).toBe(counter);
    expect(late.world.arcs.size).toBe(0);
  });

  it('derives the shortest possible route through a branched graph', () => {
    const a = arc([
      node('entry', 'immediate', ['slow', 'fast']),
      node('slow', { minYears: 30, maxYears: 50 }, ['end']),
      node('fast', { minYears: 5, maxYears: 10 }, ['end']),
    ]);
    expect(minimumArcYears(a)).toBe(5);
  });

  it('counts a generation as twenty years at its structural minimum', () => {
    const a = arc([
      node('entry', 'immediate', ['child']),
      node('child', 'next_generation', ['end']),
    ]);
    expect(minimumArcYears(a)).toBe(20);
  });

  it('allows an arc that fits exactly and refuses it one year too late', () => {
    const a = arc([
      node('entry', 'immediate', ['last']),
      node('last', { minYears: 10, maxYears: 20 }, ['end']),
    ]);

    const exact = testWorld(content, 1, END_YEAR - 10);
    expect(startArc(a, exact, testRng())).toBeDefined();

    const late = testWorld(content, 1, END_YEAR - 9);
    const counter = late.world.counters.arc;
    expect(startArc(a, late, testRng())).toBeUndefined();
    expect(late.world.counters.arc).toBe(counter);
    expect(late.world.arcs.size).toBe(0);
  });

  it('uses the Short-Line term when deciding whether an arc can still finish', () => {
    const a = arc([
      node('entry', 'immediate', ['last']),
      node('last', { minYears: 10, maxYears: 20 }, ['end']),
    ]);

    const exact = testWorld(content, 3, CAMPAIGNS.short.endYear - 10);
    exact.world.campaign = 'short';
    expect(startArc(a, exact, testRng())).toBeDefined();

    const late = testWorld(content, 3, CAMPAIGNS.short.endYear - 9);
    late.world.campaign = 'short';
    expect(startArc(a, late, testRng())).toBeUndefined();
    expect(late.world.arcs.size).toBe(0);
  });

  it('can see an exit beside a cycle, and refuses a graph with no terminal route', () => {
    const withExit = arc([
      node('entry', 'immediate', ['loop', 'end']),
      node('loop', { minYears: 2, maxYears: 2 }, ['entry']),
    ]);
    expect(minimumArcYears(withExit)).toBe(0);

    const closedLoop = arc([
      node('entry', 'immediate', ['loop']),
      node('loop', { minYears: 2, maxYears: 2 }, ['entry']),
    ]);
    expect(minimumArcYears(closedLoop)).toBe(Number.POSITIVE_INFINITY);
    expect(startArc(closedLoop, testWorld(content, 2, 1200), testRng())).toBeUndefined();
  });
});

describe('an inline chain promises one beat at a time (#1980)', () => {
  const chain = (inline: boolean) => {
    const a = arc([
      node('first', 'immediate', ['later']),
      node('later', { minYears: 8, maxYears: 16 }, ['end']),
    ]);
    a.inline = inline;
    return a;
  };

  it('floors an inline chain at its first beat, and an authored arc at its whole graph', () => {
    expect(minimumArcYears(chain(true))).toBe(0);
    expect(minimumArcYears(chain(false))).toBe(8);
    const delayed = arc([
      node('first', { minYears: 3, maxYears: 5 }, ['later']),
      node('later', { minYears: 8, maxYears: 16 }, ['end']),
    ]);
    delayed.inline = true;
    expect(minimumArcYears(delayed)).toBe(3);
  });

  it('starts an inline chain whose later beat cannot fit, so the first beat is not lost', () => {
    const ctx = testWorld(content, 1, END_YEAR - 5);
    expect(startArc(chain(true), ctx, testRng())?.dueYear).toBe(END_YEAR - 5);
    expect(startArc(chain(false), testWorld(content, 1, END_YEAR - 5), testRng())).toBeUndefined();
  });

  it('ends the story at the last beat that fit, without drawing for the one that cannot', () => {
    const a = chain(true);
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, END_YEAR - 5);
    const instance = startArc(a, ctx, testRng())!;
    const rng = testRng();
    const draw = vi.spyOn(rng, 'range');
    advanceArc({ instance, node: a.nodes[0]!, fill: {}, playerCast: [], absent: false }, {
      id: 'done', weight: 100, text: 'Done.', tags: [], effects: [],
    }, undefined, ctx, rng);
    expect(instance.status).toBe('ended');
    expect(instance.node).toBe('first');
    expect(instance.history.map((h) => h.node)).toEqual(['first']);
    expect(draw).not.toHaveBeenCalled();
  });

  it('keeps the later beat when it still fits exactly', () => {
    const a = chain(true);
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, END_YEAR - 8);
    const instance = startArc(a, ctx, testRng())!;
    advanceArc({ instance, node: a.nodes[0]!, fill: {}, playerCast: [], absent: false }, {
      id: 'done', weight: 100, text: 'Done.', tags: [], effects: [],
    }, undefined, ctx, testRng());
    expect(instance.status).toBe('active');
    expect(instance.node).toBe('later');
    expect(instance.dueYear).toBe(END_YEAR);
  });

  it('leaves an authored arc waiting on its schedule, as #133 already decided', () => {
    const a = chain(false);
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, END_YEAR - 16);
    const instance = startArc(a, ctx, testRng())!;
    ctx.world.year = END_YEAR - 5;
    advanceArc({ instance, node: a.nodes[0]!, fill: {}, playerCast: [], absent: false }, {
      id: 'done', weight: 100, text: 'Done.', tags: [], effects: [],
    }, undefined, ctx, testRng());
    expect(instance.status).toBe('active');
    expect(instance.node).toBe('later');
  });
});

describe('promised follow-ups near collection (#1971)', () => {
  it.each(['short', 'long', 'demo'] as const)('draws the inline entry inside the remaining %s campaign', (campaign) => {
    const a = arc([node('entry', { minYears: 6, maxYears: 18 }, ['end'])]);
    a.inline = true;
    const end = CAMPAIGNS[campaign].endYear;
    const ctx = testWorld(content, 1, end - 16);
    ctx.world.campaign = campaign;
    const rng = testRng();
    // Exercise the upper end of whichever legal interval production passes.
    const draw = vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.99 * (max - min));
    const instance = startArc(a, ctx, rng);
    expect(instance?.dueYear).toBeGreaterThanOrEqual(ctx.world.year + 6);
    expect(instance?.dueYear).toBeLessThanOrEqual(end);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it.each([
    { schedule: { minYears: 6, maxYears: 18 }, remaining: 6 },
    { schedule: { minYears: 6.4, maxYears: 18 }, remaining: 6 },
    { schedule: 'next_generation' as const, remaining: 20 },
    { schedule: 'next_generation' as const, remaining: 24 },
    { schedule: 'immediate' as const, remaining: 0 },
  ])('respects the last legal year for $schedule with $remaining years left', ({ schedule, remaining }) => {
    const a = arc([node('entry', schedule, ['end'])]);
    a.inline = true;
    const ctx = testWorld(content, 1, END_YEAR - remaining);
    const rng = testRng();
    vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.99 * (max - min));
    vi.spyOn(rng, 'int').mockImplementation((max) => max - 1);
    expect(startArc(a, ctx, rng)?.dueYear).toBe(END_YEAR);
  });

  it.each([
    { minYears: 6, maxYears: 6 },
    { minYears: 6.5, maxYears: 18 },
    'next_generation' as const,
  ])('refuses an impossible inline start without drawing or consuming an id: %s', (schedule) => {
    const a = arc([node('entry', schedule, ['end'])]);
    a.inline = true;
    const ctx = testWorld(content, 1, END_YEAR - 5);
    const before = ctx.world.counters.arc;
    const rng = testRng();
    const draw = vi.spyOn(rng, 'range');
    const generation = vi.spyOn(rng, 'int');
    expect(startArc(a, ctx, rng)).toBeUndefined();
    expect(ctx.world.counters.arc).toBe(before);
    expect(ctx.world.arcs.size).toBe(0);
    expect(draw).not.toHaveBeenCalled();
    expect(generation).not.toHaveBeenCalled();
  });

  // #1971 bounded inline chains only; an authored arc's later beat is the
  // same kind of promise and takes the same rule (#1946, below).
  it.each([false, true])('bounds later nodes for inline and authored arcs alike (inline: %s)', (inline) => {
    const a = arc([
      node('entry', 'immediate', ['last']),
      node('last', { minYears: 6, maxYears: 18 }, ['end']),
    ]);
    a.inline = inline;
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, END_YEAR - 16);
    const instance = startArc(a, ctx, testRng())!;
    const rng = testRng();
    vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.99 * (max - min));
    advanceArc({ instance, node: a.nodes[0]!, fill: {}, playerCast: [], absent: false }, {
      id: 'done', weight: 100, text: 'Done.', tags: [], effects: [],
    }, undefined, ctx, rng);
    expect(instance.node).toBe('last');
    expect(instance.dueYear).toBe(END_YEAR);
  });

  it.each([
    'immediate' as const,
    'next_generation' as const,
    { minYears: 6, maxYears: 18 },
    { minYears: 6, maxYears: 6 },
  ])('preserves the due year and RNG stream when the whole interval fits: %s', (schedule) => {
    const ctx = testWorld(content, 1, END_YEAR - 50);
    const bounded = testRng('fitting');
    const original = testRng('fitting');
    const next = node('entry', schedule);
    expect(scheduleNext(next, ctx, bounded, true)).toBe(scheduleNext(next, ctx, original));
    expect(bounded.next()).toBe(original.next());
  });

  it('preserves a fractional interval whose rounded calendar years already fit', () => {
    const ctx = testWorld(content, 1, END_YEAR - 18);
    const bounded = testRng('rounded');
    const original = testRng('rounded');
    for (const rng of [bounded, original]) {
      vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.93 * (max - min));
    }
    const next = node('entry', { minYears: 6.4, maxYears: 18.4 });
    expect(scheduleNext(next, ctx, bounded, true)).toBe(scheduleNext(next, ctx, original));
  });

  it.each([
    'next_generation' as const,
    { minYears: 6, maxYears: 18 },
    { minYears: 6, maxYears: 6 },
  ])('does not shorten an impossible later delay or add a random draw: %s', (schedule) => {
    const ctx = testWorld(content, 1, END_YEAR - 5);
    const bounded = testRng('impossible');
    const original = testRng('impossible');
    const next = node('entry', schedule);
    const due = scheduleNext(next, ctx, bounded, true);
    expect(due).toBeGreaterThan(END_YEAR);
    expect(due).toBe(scheduleNext(next, ctx, original));
    expect(bounded.next()).toBe(original.next());
  });

  it.each(['next_generation' as const, { minYears: 6, maxYears: 18 }])('consumes the same single draw in a narrowed interval: %s', (schedule) => {
    const ctx = testWorld(content, 1, END_YEAR - (schedule === 'next_generation' ? 24 : 10));
    const bounded = testRng('narrowed');
    const original = testRng('narrowed');
    const next = node('entry', schedule);
    const due = scheduleNext(next, ctx, bounded, true);
    expect(due).toBeLessThanOrEqual(END_YEAR);
    scheduleNext(next, ctx, original);
    expect(bounded.next()).toBe(original.next());
  });
});

/**
 * #1946: an authored arc is admitted only when its fastest whole graph can
 * finish before collection (#133), and then drew every later beat over its
 * entire authored range. A beat whose range straddled collection could land
 * after the book closed although an authored delay that arrived in time
 * existed — `arc_the_eight_days`'s clause reveal, 150–320 years after the
 * ruling, most often. Each beat now takes #1971's rule: one draw, inside the
 * overlap of its range and the remaining campaign. A beat is bounded on its
 * own; the bound neither shortens a range that fits nor rescues a fixed or
 * already impossible delay, and the beat after it keeps its own rule.
 */
describe('authored arcs promise each beat inside the term (#1946)', () => {
  const advance = (a: ArcDef, instance: ReturnType<typeof startArc>, from: string, ctx: ReturnType<typeof testWorld>, rng = testRng()) => {
    advanceArc({ instance: instance!, node: a.nodes.find((n) => n.id === from)!, fill: {}, playerCast: [], absent: false }, {
      id: 'done', weight: 100, text: 'Done.', tags: [], effects: [],
    }, undefined, ctx, rng);
  };
  const high = () => {
    const rng = testRng();
    const draw = vi.spyOn(rng, 'range').mockImplementation((min, max) => min + 0.99 * (max - min));
    return { rng, draw };
  };

  it.each(['short', 'long', 'demo'] as const)('draws a straddling later beat inside the remaining %s campaign', (campaign) => {
    const a = arc([
      node('entry', 'immediate', ['last']),
      node('last', { minYears: 6, maxYears: 18 }, ['end']),
    ]);
    const end = CAMPAIGNS[campaign].endYear;
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, end - 16);
    ctx.world.campaign = campaign;
    const instance = startArc(a, ctx, testRng());
    const { rng, draw } = high();
    advance(a, instance, 'entry', ctx, rng);
    expect(instance!.status).toBe('active');
    expect(instance!.dueYear).toBe(end);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('bounds one beat at a time: a later fixed delay past collection still waits, undrawn and unshortened', () => {
    const a = arc([
      node('entry', 'immediate', ['middle']),
      node('middle', { minYears: 6, maxYears: 18 }, ['last']),
      node('last', { minYears: 10, maxYears: 10 }, ['end']),
    ]);
    const ctx = testWorld({ ...content.bundle, arcs: [...content.bundle.arcs, a] }, 1, END_YEAR - 16);
    const instance = startArc(a, ctx, testRng());
    expect(instance).toBeDefined();
    advance(a, instance, 'entry', ctx, high().rng);
    expect(instance!.dueYear).toBe(END_YEAR);

    ctx.world.year = END_YEAR;
    const { rng, draw } = high();
    advance(a, instance, 'middle', ctx, rng);
    // An authored arc is not ended for an impossible beat (#133's rule,
    // unchanged); the fixed delay is drawn exactly as authored.
    expect(instance!.status).toBe('active');
    expect(instance!.node).toBe('last');
    expect(instance!.dueYear).toBe(END_YEAR + 10);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('keeps a fitting authored draw and its RNG stream exactly', () => {
    const a = arc([
      node('entry', 'immediate', ['last']),
      node('last', { minYears: 6, maxYears: 18 }, ['end']),
    ]);
    const bundle = { ...content.bundle, arcs: [...content.bundle.arcs, a] };
    const due = (bounded: boolean) => {
      const ctx = testWorld(bundle, 1, END_YEAR - 40);
      const instance = startArc(a, ctx, testRng());
      const rng = testRng('authored-fits');
      if (bounded) advance(a, instance, 'entry', ctx, rng);
      else instance!.dueYear = scheduleNext(a.nodes[1]!, ctx, rng);
      return { due: instance!.dueYear, next: rng.next() };
    };
    expect(due(true)).toEqual(due(false));
  });

  it("delivers the eight days' clause beat before collection when the ruling leaves room", () => {
    const eight = content.mustArc('arc_the_eight_days');
    expect(eight.inline).toBe(false);
    const ctx = testWorld(content, 1, 1300);
    const instance = startArc(eight, ctx, testRng());
    expect(instance?.node).toBe('two_hands');
    advance(eight, instance, 'two_hands', ctx, high().rng);
    // The ruling's own 25–90 years fit whole, so its draw is the authored one.
    expect(instance!.node).toBe('which_one_we_keep');
    expect(instance!.dueYear).toBe(1300 + Math.round(25 + 0.99 * 65));

    ctx.world.year = instance!.dueYear!;
    const ruling = ctx.world.year;
    const { rng, draw } = high();
    advance(eight, instance, 'which_one_we_keep', ctx, rng);
    expect(instance!.node).toBe('and_then_it_did');
    // 150–320 years from a 1389 ruling straddles 1542: the reveal lands inside.
    expect(instance!.dueYear).toBeGreaterThanOrEqual(ruling + 150);
    expect(instance!.dueYear).toBeLessThanOrEqual(END_YEAR);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
