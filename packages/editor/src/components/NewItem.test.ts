import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Node-lane source contracts for the editor's pending new-item write.
 * This form is reused by events and arcs, while the write itself is covered
 * by the real YAML store tests.
 */
const source = readFileSync(new URL('./NewItem.vue', import.meta.url), 'utf8');
const create = source.slice(source.indexOf('async function create()'), source.indexOf('</script>'));

describe('new item async write controls (#2428)', () => {
  it('does not offer cancellation or change submitted inputs while a write is pending', () => {
    expect(source).toContain('v-model="id" :disabled="busy"');
    expect(source).toContain('<select v-model="path" :disabled="busy">');
    expect(source).toContain(':disabled="busy || !cleanId || !path"');
    expect(source).toContain('<button class="btn" :disabled="busy" @click="open = false">cancel</button>');
    expect(create.indexOf('busy.value = true;')).toBeLessThan(create.indexOf('await createItem('));
  });

  it('clears a stale error and always unlocks after resolved or rejected writes', () => {
    const clear = create.indexOf("error.value = '';");
    const start = create.indexOf('busy.value = true;');
    const awaitWrite = create.indexOf('await createItem(');
    const catchRejected = create.indexOf('} catch (cause) {');
    const finallyCleanup = create.indexOf('} finally {');
    const unlock = create.indexOf('busy.value = false;', finallyCleanup);
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(clear);
    expect(awaitWrite).toBeGreaterThan(start);
    expect(catchRejected).toBeGreaterThan(awaitWrite);
    expect(finallyCleanup).toBeGreaterThan(catchRejected);
    expect(unlock).toBeGreaterThan(finallyCleanup);
    expect(create).toContain('error.value = cause instanceof Error ? cause.message : String(cause);');
  });

  it('preserves the written id after the input is reset', () => {
    const idCapture = create.indexOf('const createdId = cleanId.value;');
    const write = create.indexOf('await createItem(');
    const reset = create.indexOf("id.value = '';", write);
    const emit = create.indexOf("emit('created', createdId);");
    expect(idCapture).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(idCapture);
    expect(reset).toBeGreaterThan(write);
    expect(emit).toBeGreaterThan(reset);
  });
});
