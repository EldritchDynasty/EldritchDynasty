import { describe, expect, it } from 'vitest';
import { nativeSnapshotSha256 } from './native-snapshot.mjs';

/**
 * Native smoke proofs compare opaque JSON saves. Hashing a Date, scalar, or
 * a custom object that serializes to another root is false success, not proof
 * that the real persisted run survived a cold restart (#2465).
 */
describe('Windows native smoke JSON snapshot evidence', () => {
  it('rejects non-object serialized roots instead of producing a success digest', () => {
    for (const invalid of [
      null, undefined, true, 'missing game', 1054, [],
      new Date('2026-11-02T00:00:00Z'),
      { year: 1054, toJSON: () => null },
      { year: 1054, toJSON: () => ['not a save'] },
      { year: 1054, toJSON: () => 'not a save' },
      { year: 1054, toJSON: () => undefined },
    ]) {
      expect(() => nativeSnapshotSha256(invalid), String(invalid)).toThrow(/JSON object/);
    }

    const circular: { year: number; self?: unknown } = { year: 1054 };
    circular.self = circular;
    expect(() => nativeSnapshotSha256(circular)).toThrow();
  });

  it('canonicalizes valid JSON with insertion-order invariance and top-level timestamp exclusion', () => {
    const saved = { year: 1054, savedAt: 'first', state: { savedAt: 'state', z: 1, A: 2 }, people: ['a', 'b'] };
    const resumed = { people: ['a', 'b'], state: { A: 2, z: 1, savedAt: 'state' }, savedAt: 'later', year: 1054 };
    expect(nativeSnapshotSha256(saved)).toBe(nativeSnapshotSha256(resumed));
    expect(nativeSnapshotSha256({ ...resumed, state: { ...resumed.state, savedAt: 'changed' } }))
      .not.toBe(nativeSnapshotSha256(saved));
    expect(nativeSnapshotSha256({ ...resumed, people: ['b', 'a'] })).not.toBe(nativeSnapshotSha256(saved));
    expect(saved.savedAt).toBe('first');
  });

  it('hashes the actual JSON representation of an object with toJSON', () => {
    const custom = { toJSON: () => ({ year: 1054, savedAt: 'first', state: { savedAt: 'original' } }) };
    const native = { state: { savedAt: 'original' }, savedAt: 'later', year: 1054 };
    expect(nativeSnapshotSha256(custom)).toBe(nativeSnapshotSha256(native));
    expect(nativeSnapshotSha256({ ...native, state: { savedAt: 'modified' } }))
      .not.toBe(nativeSnapshotSha256(custom));
  });
});
