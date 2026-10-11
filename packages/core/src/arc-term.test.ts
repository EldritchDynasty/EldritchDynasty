import { describe, expect, it } from 'vitest';
import type { ArcDef, ArcNode } from '@ed/schema';
import { CAMPAIGNS, END_YEAR, minimumArcYears, startArc, testRng, testWorld } from '@ed/core';
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
