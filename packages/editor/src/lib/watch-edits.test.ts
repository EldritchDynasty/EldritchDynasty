import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed, effectScope, nextTick, reactive, ref } from 'vue';

const marked = vi.hoisted(() => [] as string[]);
vi.mock('./store.js', () => ({
  markDirty: (collectionKey: string, id: string) => { marked.push(`${collectionKey}:${id}`); },
}));
const { watchEdits } = await import('./watch-edits.js');

/**
 * SELECTION IS NOT AN EDIT (#1891). Clicking five events with no edits used
 * to report five files unsaved, because a deep watcher on the selected item
 * also fires when the selection changes.
 */
function editor(editable?: (item: { id: string; title: string }) => boolean) {
  const items = reactive([
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
  ]);
  const selected = ref('a');
  const current = computed(() => items.find((x) => x.id === selected.value));
  const scope = effectScope();
  scope.run(() => watchEdits(current, 'events', editable));
  return { items, selected, current, stop: () => scope.stop() };
}

describe('watchEdits (#1891)', () => {
  it('marks nothing when only the selection changes', async () => {
    marked.length = 0;
    const e = editor();
    try {
      for (const id of ['b', 'c', 'a', 'c', 'b']) { e.selected.value = id; await nextTick(); }
      expect(marked).toEqual([]);
    } finally { e.stop(); }
  });

  it('marks the selected item when it is edited in place', async () => {
    marked.length = 0;
    const e = editor();
    try {
      e.selected.value = 'b'; await nextTick();
      e.current.value!.title = 'B, edited'; await nextTick();
      expect(marked).toEqual(['events:b']);
    } finally { e.stop(); }
  });

  it('marks an edit even when the item is replaced rather than mutated', async () => {
    marked.length = 0;
    const e = editor();
    try {
      e.items.splice(0, 1, { id: 'a', title: 'A, replaced' }); await nextTick();
      expect(marked).toEqual(['events:a']);
    } finally { e.stop(); }
  });

  it('refuses items the caller says have nothing to write to', async () => {
    marked.length = 0;
    const e = editor((x) => x.id !== 'c');
    try {
      e.selected.value = 'c'; await nextTick();
      e.current.value!.title = 'C, edited'; await nextTick();
      expect(marked).toEqual([]);
    } finally { e.stop(); }
  });

  it('is what all three editors use, with no deep watcher of their own marking dirty', () => {
    const components = join(import.meta.dirname, '..', 'components');
    for (const name of ['EventEditor.vue', 'ArcEditor.vue', 'CharacterEditor.vue']) {
      const source = readFileSync(join(components, name), 'utf8');
      expect(source, name).toContain('watchEdits(');
      expect(source, name).not.toMatch(/watch\([^\n]*markDirty[^\n]*deep: true/);
    }
  });
});
