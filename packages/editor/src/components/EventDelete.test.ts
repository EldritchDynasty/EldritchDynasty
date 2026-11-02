import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-level contracts for the editor's destructive confirmation.
 * Vue DOM suites run in the isolated client pool; these checks keep the
 * editor's async selection/confirmation guards inside the ordinary Node lane.
 */
const source = readFileSync(new URL('./EventDelete.vue', import.meta.url), 'utf8');
const review = source.slice(source.indexOf('async function review()'), source.indexOf('function cancel()'));
const cancel = source.slice(source.indexOf('function cancel()'), source.indexOf('async function remove()'));
const remove = source.slice(source.indexOf('async function remove()'), source.indexOf('</script>'));

describe('event deletion review identity (#2424)', () => {
  it('captures the event and request generation before starting an async disk check', () => {
    const captureId = review.indexOf('const reviewedId = props.id;');
    const captureRevision = review.indexOf('const revision = ++reviewRevision;');
    const preview = review.indexOf('pendingDeleteEvent(reviewedId)');
    const awaitRead = review.indexOf('await externalChange(result.path)');
    expect(captureId).toBeGreaterThanOrEqual(0);
    expect(captureRevision).toBeGreaterThan(captureId);
    expect(preview).toBeGreaterThan(captureRevision);
    expect(awaitRead).toBeGreaterThan(preview);
  });

  it('discards late results after a selection change, cancellation or newer review', () => {
    const awaitRead = review.indexOf('await externalChange(result.path)');
    const guard = review.indexOf('if (revision !== reviewRevision || props.id !== reviewedId) return;');
    const published = review.indexOf('preview.value = { id: reviewedId,');
    expect(awaitRead).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(awaitRead);
    expect(published).toBeGreaterThan(guard);

    // Changing the current event calls the same cancel path as the button.
    expect(source).toContain('watch(() => props.id, () => cancel());');
    expect(cancel).toContain('++reviewRevision;');
    expect(cancel).toContain('reviewing.value = false;');
    expect(cancel).toContain('preview.value = undefined;');
    expect(source).toContain('@click="cancel"');
  });

  it('binds the destructive action to the exact event whose diff was reviewed', () => {
    const identityGuard = remove.indexOf('preview.value?.id !== props.id');
    const capturedId = remove.indexOf('const removedId = props.id;');
    const deletion = remove.indexOf('await deleteEvent(removedId)');
    expect(identityGuard).toBeGreaterThanOrEqual(0);
    expect(capturedId).toBeGreaterThan(identityGuard);
    expect(deletion).toBeGreaterThan(capturedId);
    expect(source).toContain('confirmation.value !== props.id');
  });
});

describe('event deletion rejected host operations (#2483)', () => {
  it('keeps a failed or pending source check from authorizing the confirmation', () => {
    const pendingGuard = review.indexOf('if (checking.value || working.value) return;');
    const awaitRead = review.indexOf('await externalChange(result.path)');
    const success = review.indexOf('reviewing.value = true;');
    const catchBlock = review.indexOf('} catch (cause) {');
    expect(pendingGuard).toBeGreaterThanOrEqual(0);
    expect(awaitRead).toBeGreaterThan(pendingGuard);
    expect(success).toBeGreaterThan(awaitRead);
    expect(catchBlock).toBeGreaterThan(success);
    expect(review).toContain('checking.value = true;');
    expect(review).toContain('if (revision === reviewRevision) checking.value = false;');
    expect(source).toContain(':disabled="checking || working"');
  });

  it('only reports a disk-check exception for the same selection and request revision', () => {
    const catchBlock = review.slice(review.indexOf('} catch (cause) {'));
    expect(catchBlock).toContain('revision === reviewRevision && props.id === reviewedId');
    expect(catchBlock).toContain("error.value = 'Could not check the source file: '");
    expect(catchBlock).not.toContain('reviewing.value = true;');
    expect(cancel).toContain('checking.value = false;');
    expect(cancel).toContain('++reviewRevision;');
  });

  it('reports a rejected delete without pretending it succeeded or clearing its preview', () => {
    const awaitDelete = remove.indexOf('await deleteEvent(removedId)');
    const failedWrite = remove.indexOf('} catch (cause) {');
    expect(awaitDelete).toBeGreaterThanOrEqual(0);
    expect(failedWrite).toBeGreaterThan(awaitDelete);
    const catchBlock = remove.slice(failedWrite, remove.indexOf('} finally {', failedWrite));
    expect(catchBlock).toContain('revision === reviewRevision && props.id === removedId');
    expect(catchBlock).toContain("error.value = 'Deletion failed;");
    expect(catchBlock).not.toContain('cancel()');
    expect(remove).toContain('if (!result.ok) error.value = result.error');
    expect(remove).toContain('else cancel()');
    expect(remove).toContain('working.value = false;');
  });
});
