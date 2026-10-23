import { watch, type Ref } from 'vue';
import { markDirty } from './store.js';

/**
 * SELECTION IS NOT AN EDIT (issue #1891).
 *
 * Each editor watched its selected item deeply and marked its file dirty on
 * every callback. A deep watcher also fires when the SELECTION changes — a
 * new item is a new value — so clicking five events with no edits reported
 * five files unsaved, and an unsaved count that is always wrong is one an
 * author learns to ignore.
 *
 * An edit mutates the item in place, so the watcher sees the same item before
 * and after. A different id is a different selection. `editable` lets a
 * caller refuse items that have no YAML to write to.
 */
export function watchEdits<T extends { id: string }>(
  current: Ref<T | undefined>,
  collectionKey: string,
  editable: (item: T) => boolean = () => true,
): void {
  watch(current, (next, prev) => {
    if (next && prev && next.id === prev.id && editable(next)) markDirty(collectionKey, next.id);
  }, { deep: true });
}
