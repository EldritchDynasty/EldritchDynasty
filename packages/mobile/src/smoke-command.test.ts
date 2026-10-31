import { describe, expect, it } from 'vitest';
import { parseSmokeCommand } from './smoke.js';

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
