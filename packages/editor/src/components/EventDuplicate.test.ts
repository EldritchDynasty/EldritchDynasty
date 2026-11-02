import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-contract coverage for the event duplicate control's asynchronous
 * host write. The underlying content-store write is tested in store.test.ts.
 */
const source = readFileSync(new URL('./EventDuplicate.vue', import.meta.url), 'utf8');
const start = source.slice(source.indexOf('function start()'), source.indexOf('watch(() => props.event.id'));
const duplicate = source.slice(source.indexOf('async function duplicate()'), source.indexOf('</script>'));

describe('event duplicate pending-write behavior (#2435)', () => {
  it('locks the submitted ID and cancel/reopen actions until the write settles', () => {
    expect(source).toContain('v-model="newId" :disabled="busy"');
    expect(source).toContain(':disabled="busy || blockedByEdit || !writable || !newId.trim()"');
    expect(source).toContain('<button class="btn" type="button" :disabled="busy" @click="open = false">Cancel</button>');
    expect(source).toContain('class="btn" :disabled="busy || !writable" @click="start"');
    expect(start).toContain('if (busy.value) return;');
    expect(duplicate.indexOf('busy.value = true;')).toBeLessThan(duplicate.indexOf('await createItem('));
    expect(duplicate.indexOf('busy.value = false;', duplicate.indexOf('} finally {'))).toBeGreaterThan(duplicate.indexOf('} finally {'));
  });

  it('keeps the submitted destination and old completion scoped to the originating event', () => {
    const captureId = duplicate.indexOf('const sourceId = props.event.id;');
    const capturePath = duplicate.indexOf('const destination = sourcePath.value;');
    const write = duplicate.indexOf("await createItem('events', destination, result.event)");
    const staleSuccessGuard = duplicate.indexOf('if (props.event.id !== sourceId) return;', write);
    const successReceipt = duplicate.indexOf('created.value = result.event.id;', write);
    expect(captureId).toBeGreaterThanOrEqual(0);
    expect(capturePath).toBeGreaterThan(captureId);
    expect(write).toBeGreaterThan(capturePath);
    expect(staleSuccessGuard).toBeGreaterThan(write);
    expect(successReceipt).toBeGreaterThan(staleSuccessGuard);
  });

  it('shows rejected writes only on the still-selected event and always unlocks', () => {
    const write = duplicate.indexOf('await createItem(');
    const catchRejected = duplicate.indexOf('} catch (cause) {', write);
    const staleErrorGuard = duplicate.indexOf('if (props.event.id === sourceId)', catchRejected);
    const visibleError = duplicate.indexOf('error.value = cause instanceof Error ? cause.message : String(cause);', staleErrorGuard);
    const cleanup = duplicate.indexOf('} finally {', visibleError);
    const unlock = duplicate.indexOf('busy.value = false;', cleanup);
    expect(catchRejected).toBeGreaterThan(write);
    expect(staleErrorGuard).toBeGreaterThan(catchRejected);
    expect(visibleError).toBeGreaterThan(staleErrorGuard);
    expect(cleanup).toBeGreaterThan(visibleError);
    expect(unlock).toBeGreaterThan(cleanup);
    expect(source).toContain('<p v-if="error" role="alert"');
  });
});
