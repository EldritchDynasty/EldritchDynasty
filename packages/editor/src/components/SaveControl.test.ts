import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-contract tests keep editor write controls in the Node test lane.
 * The store's independent disk conflict/write checks have behavioral tests
 * in store.test.ts; this suite guards the UI review-to-selection handshake.
 */
const source = readFileSync(new URL('./SaveControl.vue', import.meta.url), 'utf8');
const review = source.slice(source.indexOf('async function review()'), source.indexOf('async function confirmSave()'));
const confirm = source.slice(source.indexOf('async function confirmSave()'), source.indexOf('</script>'));
const cancel = source.slice(source.indexOf('function cancelReview()'), source.indexOf('async function review()'));

describe('Save Control selection and disk-check fencing (#2426)', () => {
  it('invalidates an open review when the item or collection changes or Cancel is pressed', () => {
    expect(source).toContain('watch([() => props.collectionKey, () => props.id], cancelReview');
    expect(cancel).toContain('++reviewRevision;');
    expect(cancel).toContain('checkedSelection.value = null;');
    expect(cancel).toContain('reviewing.value = false;');
    expect(source).toContain('@click="cancelReview">Cancel');
  });

  it('waits for the disk check before authorizing the exact selected item', () => {
    const capture = review.indexOf('const revision = ++reviewRevision;');
    const read = review.indexOf('await externalChange(p)');
    const rejectStale = review.indexOf('if (revision !== reviewRevision || props.collectionKey !== collectionKey || props.id !== id) return;');
    const allow = review.indexOf('checkedSelection.value = { collectionKey, id };');
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(capture);
    expect(rejectStale).toBeGreaterThan(read);
    expect(allow).toBeGreaterThan(rejectStale);
    expect(source).toContain('reviewing.value && !checking.value && !saving.value');
    expect(source).toContain('checkedSelection.value?.collectionKey === props.collectionKey');
    expect(source).toContain('checkedSelection.value?.id === props.id');
    expect(source).toContain(':disabled="!canWrite" @click="confirmSave"');
    expect(source).toContain('checking.value = true;');
  });

  it('blocks an empty-file conflict and cannot write a different selection', () => {
    expect(review).toContain("conflictText.value = check.text || '(the source file is empty)';");
    expect(confirm).toContain('if (!canWrite.value) return;');
    expect(confirm).toContain('const collectionKey = props.collectionKey;');
    expect(confirm).toContain('const id = props.id;');
    const write = confirm.indexOf('await saveItem(collectionKey, id)');
    const late = confirm.indexOf('if (revision !== reviewRevision || props.collectionKey !== collectionKey || props.id !== id) return;');
    expect(write).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(write);
    expect(source).toContain(':disabled="saving" @click="cancelReview"');
  });
});
