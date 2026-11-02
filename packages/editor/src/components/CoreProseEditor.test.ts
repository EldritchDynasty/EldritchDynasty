import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Contract checks for the async core-prose review; store writes have separate behavioral tests. */
const source = readFileSync(new URL('./CoreProseEditor.vue', import.meta.url), 'utf8');
const edit = source.slice(source.indexOf('function edit('), source.indexOf('async function review()'));
const review = source.slice(source.indexOf('async function review()'), source.indexOf('async function save()'));
const saveStart = source.indexOf('async function save()');
const save = source.slice(saveStart, source.indexOf('</script>', saveStart));

describe('core prose async review identity (#2439)', () => {
  it('marks edits and component unmounts as invalidating pending reviews', () => {
    expect(source).toContain('let reviewEpoch = 0;');
    expect(source).toContain('onBeforeUnmount(() => { reviewEpoch += 1; });');
    expect(edit).toContain('reviewEpoch += 1;');
    expect(edit).toContain('reviewing.value = false;');
    expect(edit).toContain('if (!writable.value || saving.value) return;');
  });

  it('does not stage or clear drafts when the asynchronous disk check is stale', () => {
    const start = review.indexOf('const epoch = ++reviewEpoch;');
    const beginCheck = review.indexOf('checking.value = true;', start);
    const awaitDisk = review.indexOf('await externalChange(FILE)', beginCheck);
    const stale = review.indexOf('if (epoch !== reviewEpoch) return;', awaitDisk);
    const revalidate = review.indexOf('if (badDrafts.value.length) return;', stale);
    const stage = review.indexOf('applyCoreProseEdits(edits)', revalidate);
    const clear = review.indexOf('drafts.clear();', stage);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(beginCheck).toBeGreaterThan(start);
    expect(awaitDisk).toBeGreaterThan(beginCheck);
    expect(stale).toBeGreaterThan(awaitDisk);
    expect(revalidate).toBeGreaterThan(stale);
    expect(stage).toBeGreaterThan(revalidate);
    expect(clear).toBeGreaterThan(stage);
    expect(review).toContain('if (epoch === reviewEpoch)');
    expect(review).toContain('} finally {\n    checking.value = false;');
  });

  it('blocks competing reviews, writing before check completes, and cancelling an active write', () => {
    expect(review).toContain('checking.value || saving.value');
    expect(review).toContain('reviewing.value = false;');
    expect(save).toContain('saving.value || checking.value');
    expect(source).toContain(':disabled="!writable || !dirty || !!badDrafts.length || saving || checking"');
    expect(source).toContain(':disabled="saving || checking || externalConflict || !!badDrafts.length"');
    expect(source).toContain('<button class="btn" :disabled="saving" @click="reviewing = false">Cancel</button>');
    expect(source).toContain(':disabled="!writable || saving"');
  });
});
