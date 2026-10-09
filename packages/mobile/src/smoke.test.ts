import { describe, expect, it, vi } from 'vitest';
import { mobileStorage } from './storage.js';
import { parseSmokeCommand, smokeEvidence } from './smoke.js';

describe('iOS runtime smoke protocol', () => {
  it('accepts only the private smoke scheme and well-formed commands', () => {
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=1042&years=40'))
      .toEqual({ kind: 'save', seed: 1042, years: 40 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://resume')).toEqual({ kind: 'resume' });
    expect(parseSmokeCommand('eldritchdynasty-smoke://export')).toEqual({ kind: 'export' });
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=smoke.json'))
      .toEqual({ kind: 'import', path: 'smoke.json' });
    expect(parseSmokeCommand('https://save?seed=1042&years=40')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?years=-1')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://import')).toBeNull();
  });

  it('hashes canonical snapshot data and carries host evidence', async () => {
    await expect(smokeEvidence(
      { kind: 'export' },
      { snapshot: { format: 28, year: 1082 }, year: 1082, path: 'smoke.json' },
    )).resolves.toEqual({
      command: 'export',
      ok: true,
      sha256: '0efd2b23500ee0241d74680d35ac523cdbdca304aeaabec765bc9102856d5021',
      year: 1082,
      path: 'smoke.json',
    });
  });

  it('ignores JSON representation noise, key order, and the refreshed save timestamp', async () => {
    const first = await smokeEvidence(
      { kind: 'save', seed: 7, years: 1 },
      {
        snapshot: {
          format: 28,
          year: 1043,
          savedAt: 'first',
          absent: undefined,
          world: { people: [{ name: 'Daveed', born: 1042 }], counters: { person: 1, branch: 0 } },
        },
      },
    );
    const second = await smokeEvidence(
      { kind: 'resume' },
      {
        snapshot: {
          world: { counters: { branch: 0, person: 1 }, people: [{ born: 1042, name: 'Daveed' }] },
          savedAt: 'second',
          year: 1043,
          format: 28,
        },
      },
    );

    expect(second.sha256).toBe(first.sha256);
  });
});


describe('mobile native save-list read failures', () => {
  const savedAt = '2026-10-02T00:00:00.000Z';
  const good = JSON.stringify({ format: 28, year: 1234, savedAt });
  const preferences = {
    async keys() { return { keys: [] as string[] }; },
    async get() { return { value: null }; },
    async remove() {},
  };
  const files = {
    async readdir() {
      return { files: [
        { name: 'unreadable.json', type: 'file' as const },
        { name: 'healthy.json', type: 'file' as const },
      ] };
    },
    async readFile({ path }: { path: string }) {
      if (path.endsWith('/unreadable.json')) throw new Error('one file denied');
      return { data: good };
    },
    async writeFile() {},
    async deleteFile() {},
  };

  it('keeps healthy saves visible when a different enumerated file rejects on read', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mobileStorage(files, preferences).listSaves()).resolves.toEqual([
        { slot: 'healthy', format: 28, year: 1234, savedAt },
      ]);
      expect(warning).toHaveBeenCalledWith(
        '[mobile] could not read save slot unreadable:',
        expect.any(Error),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('still reports whole-store directory access failures', async () => {
    const denied = {
      ...files,
      async readdir(): Promise<never> { throw new Error('directory denied'); },
    };
    await expect(mobileStorage(denied, preferences).listSaves())
      .rejects.toThrow('directory denied');
  });
});
