import { describe, expect, it } from 'vitest';
import { parseSmokeCommand, settleSmokeCommand, smokeEvidence } from './smoke.js';

describe('Debug-only iOS smoke import filenames (#2111)', () => {
  const importCommand = (path: string) =>
    parseSmokeCommand(`eldritchdynasty-smoke://import?path=${encodeURIComponent(path)}`);

  it('rejects traversal, absolute paths and names the native reader must not open', () => {
    for (const invalid of [
      '', '.', '..',
      '../save.json', './save.json', 'folder/save.json',
      '/private/save.json', 'folder\\save.json', '..\\save.json',
      'C:\\private\\save.json', 'C:save.json',
      ' save.json', 'save.json ',
      'name\u0000.json', 'name\u001f.json',
    ]) {
      expect(importCommand(invalid), JSON.stringify(invalid)).toBeNull();
    }
  });

  it('accepts only a single decoded basename, including normal non-ASCII and percent text', () => {
    for (const valid of [
      'eldritch-smoke-export.json',
      'the family % chronicle.json',
      '王朝の記録.json',
    ]) {
      expect(importCommand(valid)).toEqual({ kind: 'import', path: valid });
    }
    // Escaped path separators must not sneak past the URL boundary.
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=..%2Fsave.json')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=..%5Csave.json')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=')).toBeNull();
  });

  it('does not alter the other simulator commands', () => {
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=1042&years=40'))
      .toEqual({ kind: 'save', seed: 1042, years: 40 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://resume')).toEqual({ kind: 'resume' });
    expect(parseSmokeCommand('eldritchdynasty-smoke://export')).toEqual({ kind: 'export' });
  });

  it('rejects control characters in raw deep links before URL normalizes them (#2506)', () => {
    const invalid = [
      'eldritchdynasty-smoke://sa\nve?seed=1042',
      'eldritchdynasty-smoke://re\tsume',
      'eldritchdynasty-smoke://imp\rort?path=house.json',
      '\teldritchdynasty-smoke://save',
      'eldritchdynasty-smoke://export ',
      'eldritchdynasty-smoke://import?path=house.json\u007f',
      '\u0000eldritchdynasty-smoke://save',
      'eldritchdynasty-smoke://save?seed=1042\n&years=40',
      '\u00a0eldritchdynasty-smoke://resume',
    ];
    for (const raw of invalid) {
      expect(parseSmokeCommand(raw), JSON.stringify(raw)).toBeNull();
    }
    // Percent-encoded spaces in an ordinary Documents basename remain legal.
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=the%20family.json'))
      .toEqual({ kind: 'import', path: 'the family.json' });
  });
});

describe('native smoke callback evidence settles even on synchronous failures (#2324)', () => {
  const command = { kind: 'resume' } as const;

  it('turns a synchronous callback throw into a terminal error rather than leaving received pending', async () => {
    await expect(settleSmokeCommand(command, () => {
      throw new Error('client smoke listener unavailable');
    })).resolves.toEqual({
      command: 'resume',
      ok: false,
      error: 'client smoke listener unavailable',
    });
  });

  it('also handles rejected Promises and non-Error values', async () => {
    await expect(settleSmokeCommand(command, async () => {
      throw new Error('resume refused');
    })).resolves.toEqual({
      command: 'resume',
      ok: false,
      error: 'resume refused',
    });
    await expect(settleSmokeCommand(command, () => Promise.reject('native callback failed')))
      .resolves.toEqual({ command: 'resume', ok: false, error: 'native callback failed' });
  });

  it.each([
    { name: 'null', snapshot: null },
    { name: 'undefined', snapshot: undefined },
    { name: 'array', snapshot: [{ format: 41 }] },
    { name: 'string', snapshot: 'not a saved game' },
    { name: 'number', snapshot: 41 },
    { name: 'boolean', snapshot: false },
  ])('reports a $name snapshot as a failed smoke, never a successful hash', async ({ snapshot }) => {
    await expect(settleSmokeCommand(command, async () => ({ snapshot }))).resolves.toEqual({
      command: 'resume',
      ok: false,
      error: 'native smoke snapshot must be a JSON object',
    });
  });

  it('rejects roots changed by JSON serialization, rather than hashing a misleading object', async () => {
    for (const snapshot of [
      new Date('2026-11-02T00:00:00Z'),
      { toJSON: () => null },
      { toJSON: () => ['not a saved game'] },
      { toJSON: () => 'not a saved game' },
      { toJSON: () => 41 },
      { toJSON: () => undefined },
    ]) {
      await expect(settleSmokeCommand(command, async () => ({ snapshot }))).resolves.toEqual({
        command: 'resume',
        ok: false,
        error: 'native smoke snapshot must be a JSON object',
      });
    }

    const circular: { year: number; self?: unknown } = { year: 1243 };
    circular.self = circular;
    const failed = await settleSmokeCommand(command, async () => ({ snapshot: circular }));
    expect(failed.ok).toBe(false);
  });

  it('hashes the persisted JSON form of valid toJSON objects, preserving nested evidence', async () => {
    const custom = {
      toJSON: () => ({
        year: 1243, format: 41, savedAt: 'old',
        world: { z: 1, A: 2, nestedSavedAt: 'unchanged' },
      }),
    };
    const persisted = {
      world: { nestedSavedAt: 'unchanged', A: 2, z: 1 },
      savedAt: 'new', format: 41, year: 1243,
    };
    const expected = await smokeEvidence(command, { snapshot: persisted });
    const actual = await smokeEvidence(command, { snapshot: custom });
    expect(actual.sha256).toBe(expected.sha256);
    expect((await smokeEvidence(command, {
      snapshot: { ...persisted, world: { ...persisted.world, nestedSavedAt: 'changed' } },
    })).sha256).not.toBe(actual.sha256);
    expect((await smokeEvidence(command, {
      snapshot: { ...persisted, world: { ...persisted.world, z: 9 } },
    })).sha256).not.toBe(actual.sha256);
  });

  it('ignores only the transport savedAt timestamp for a valid snapshot', async () => {
    const snapshot = { format: 41, year: 1243, savedAt: '2026-10-31T12:00:00.000Z' };
    const refreshed = { ...snapshot, savedAt: '2026-11-02T04:00:00.000Z' };
    const first = await smokeEvidence(command, { snapshot });
    const second = await smokeEvidence(command, { snapshot: refreshed });
    expect(first.sha256).toBe(second.sha256);
  });

  it('preserves the successful hashed snapshot evidence', async () => {
    const result = { snapshot: { format: 41, year: 1243 }, year: 1243 };
    const expected = await smokeEvidence(command, result);
    await expect(settleSmokeCommand(command, async () => result)).resolves.toEqual(expected);
  });
});
