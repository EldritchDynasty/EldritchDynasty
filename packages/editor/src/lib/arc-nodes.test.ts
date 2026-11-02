import { describe, expect, it } from 'vitest';
import type { ArcDef } from '@ed/schema';
import { removeAuthoredArcNode } from './arc-nodes';

function fixture(): ArcDef {
  return {
    id: 'debt',
    title: 'The Debt',
    entry: 'entry',
    bindings: [],
    maxConcurrentInstances: 1,
    inline: false,
    nodes: [
      { id: 'entry', event: 'old_event', selection: 'first_match', schedule: 'immediate',
        successors: [{ to: 'middle', weight: 100 }, { to: 'end', weight: 50 }] },
      { id: 'middle', event: 'middle_event', selection: 'weighted', schedule: 'next_generation',
        successors: [{ to: 'end', weight: 100 }] },
      { id: 'other', event: 'other_event', selection: 'first_match', schedule: 'next_generation',
        successors: [{ to: 'entry', weight: 70 }, { to: 'middle', weight: 30 }] },
    ],
  };
}

describe('remove authored arc beat (#2437)', () => {
  it('returns the removed beat for event-side binding cleanup and repairs entry and incoming successors', () => {
    const arc = fixture();
    const removed = removeAuthoredArcNode(arc, 'entry');
    expect(removed).toMatchObject({ id: 'entry', event: 'old_event' });
    expect(arc.nodes.map((node) => node.id)).toEqual(['middle', 'other']);
    expect(arc.entry).toBe('middle');
    expect(arc.nodes[1]!.successors).toEqual([
      { to: 'end', weight: 70 },
      { to: 'middle', weight: 30 },
    ]);
  });

  it('leaves unrelated links alone while redirecting references to an internal beat', () => {
    const arc = fixture();
    expect(removeAuthoredArcNode(arc, 'middle')?.event).toBe('middle_event');
    expect(arc.entry).toBe('entry');
    expect(arc.nodes[0]!.successors).toEqual([
      { to: 'end', weight: 100 },
      { to: 'end', weight: 50 },
    ]);
    expect(arc.nodes[1]!.successors).toEqual([
      { to: 'entry', weight: 70 },
      { to: 'end', weight: 30 },
    ]);
  });

  it('refuses an absent beat, the last remaining beat, and compiled inline arcs', () => {
    const arc = fixture();
    const before = structuredClone(arc);
    expect(removeAuthoredArcNode(arc, 'absent')).toBeUndefined();
    expect(arc).toEqual(before);

    arc.nodes = arc.nodes.slice(0, 1);
    expect(removeAuthoredArcNode(arc, 'entry')).toBeUndefined();
    expect(arc.nodes).toHaveLength(1);
    expect(arc.entry).toBe('entry');

    const inline = fixture();
    inline.inline = true;
    const original = structuredClone(inline);
    expect(removeAuthoredArcNode(inline, 'entry')).toBeUndefined();
    expect(inline).toEqual(original);
  });
});
