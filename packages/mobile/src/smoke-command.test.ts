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

  it('preserves the successful hashed snapshot evidence', async () => {
    const result = { snapshot: { format: 41, year: 1243 }, year: 1243 };
    const expected = await smokeEvidence(command, result);
    await expect(settleSmokeCommand(command, async () => result)).resolves.toEqual(expected);
  });
});
