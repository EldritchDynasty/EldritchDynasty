import { describe, expect, it, vi } from 'vitest';
import { Directory, Encoding } from '@capacitor/filesystem';
import { mobileStorage } from './storage.js';

describe('native Data persistence rejects unreadable root JSON (#1374)', () => {
  it('preserves existing save and Library bytes and legacy keys on rejected writes', async () => {
    const oldSave = { format: 28, year: 1220 };
    const oldLibrary = { format: 1, runs: [] };
    const bytes = new Map<string, string>([
      ['eldritch/saves/autosave.json', JSON.stringify(oldSave)],
      ['eldritch/library.json', JSON.stringify(oldLibrary)],
    ]);
    const files = {
      readdir: async () => ({ files: [] }),
      readFile: async ({ path }: { path: string; directory: Directory; encoding: Encoding }) => {
        const data = bytes.get(path);
        if (data === undefined) throw Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' });
        return { data };
      },
      writeFile: vi.fn(async ({ path, data }: { path: string; data: string; directory: Directory; encoding: Encoding; recursive?: boolean }) => {
        bytes.set(path, data);
      }),
      deleteFile: async () => undefined,
    };
    const preferences = {
      keys: async () => ({ keys: [] as string[] }),
      get: async () => ({ value: null }),
      remove: vi.fn(async () => undefined),
    };
    const host = mobileStorage(files, preferences);

    // Even JSON root null is not a readable snapshot on this host.
    for (const bad of [null, undefined, () => 1, Symbol('missing'), { toJSON: () => null }]) {
      await expect(host.writeSave('autosave', bad)).rejects.toThrow(TypeError);
      await expect(host.writeLibrary(bad)).rejects.toThrow(TypeError);
    }
    expect(files.writeFile).not.toHaveBeenCalled();
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(bytes.get('eldritch/saves/autosave.json')).toBe(JSON.stringify(oldSave));
    expect(bytes.get('eldritch/library.json')).toBe(JSON.stringify(oldLibrary));
    await expect(host.readSave('autosave')).resolves.toEqual(oldSave);
    await expect(host.readLibrary()).resolves.toEqual(oldLibrary);

    const nextSave = { format: 28, year: 1221 };
    const nextLibrary = { format: 1, runs: [{ id: 'second-house' }] };
    await host.writeSave('autosave', nextSave);
    await host.writeLibrary(nextLibrary);
    expect(files.writeFile).toHaveBeenCalledTimes(2);
    expect(preferences.remove).toHaveBeenCalledTimes(2);
    await expect(host.readSave('autosave')).resolves.toEqual(nextSave);
    await expect(host.readLibrary()).resolves.toEqual(nextLibrary);
  });
});
