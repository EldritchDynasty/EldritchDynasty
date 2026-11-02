import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ArcEditor.vue', import.meta.url), 'utf8');
const remove = source.slice(source.indexOf('function removeNode('), source.indexOf('function setNodeEvent('));

describe('arc removal keeps the authoring editor consistent (#2437)', () => {
  it('marks the reverse event binding dirty only when it refers to the removed beat', () => {
    const mutation = remove.indexOf('const removed = removeAuthoredArcNode(arc.value, id);');
    const skip = remove.indexOf('if (!removed) return;', mutation);
    const lookup = remove.indexOf('const event = authoredEvent(removed.event);', skip);
    const check = remove.indexOf('event?.arc?.of === arc.value.id && event.arc.node === removed.id', lookup);
    const clear = remove.indexOf('delete event.arc;', check);
    const dirty = remove.indexOf("markDirty('events', event.id);", clear);
    const touch = remove.indexOf('touch();', dirty);
    expect(mutation).toBeGreaterThanOrEqual(0);
    expect(skip).toBeGreaterThan(mutation);
    expect(lookup).toBeGreaterThan(skip);
    expect(check).toBeGreaterThan(lookup);
    expect(clear).toBeGreaterThan(check);
    expect(dirty).toBeGreaterThan(clear);
    expect(touch).toBeGreaterThan(dirty);
  });

  it('disables removing the last beat in addition to the runtime guard', () => {
    expect(source).toContain('import { removeAuthoredArcNode }');
    expect(source).toContain(':disabled="arc.nodes.length <= 1" @click="removeNode(node.id)"');
  });
});
