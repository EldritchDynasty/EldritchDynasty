import { describe, expect, it } from 'vitest';
import { Directory, Encoding } from '@capacitor/filesystem';
import { mobileStorage } from './storage.js';

const MISSING = { code: 'OS-PLUG-FILE-0008' };

function fileStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: Array<{ path: string; directory: Directory; encoding: Encoding; recursive?: boolean }> = [];
  return {
    data,
    writes,
    async readdir({ path, directory }: { path: string; directory: Directory }) {
      const prefix = `${path}/`;
      const files = [...data.keys()]
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .filter((candidate) => candidate && !candidate.includes('/'))
        .map((name) => ({ name, type: 'file' as const }));
      if (!files.length && ![...data.keys()].some((candidate) => candidate.startsWith(prefix))) {
        throw MISSING;
      }
      expect(directory).toBe(Directory.Data);
      return { files };
    },
    async readFile({ path, directory, encoding }: {
      path: string;
      directory: Directory;
      encoding: Encoding;
    }) {
      expect(directory).toBe(Directory.Data);
      expect(encoding).toBe(Encoding.UTF8);
      const value = data.get(path);
      if (value === undefined) throw MISSING;
      return { data: value };
    },
    async writeFile({ path, data: value, directory, encoding, recursive }: {
      path: string;
      data: string;
      directory: Directory;
      encoding: Encoding;
      recursive?: boolean;
    }) {
      writes.push({ path, directory, encoding, recursive });
      data.set(path, value);
      return { uri: path };
    },
    async deleteFile({ path, directory }: { path: string; directory: Directory }) {
      expect(directory).toBe(Directory.Data);
      if (!data.delete(path)) throw MISSING;
    },
  };
}

function preferenceStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async keys() { return { keys: [...data.keys()] }; },
    async get({ key }: { key: string }) { return { value: data.get(key) ?? null }; },
    async remove({ key }: { key: string }) { data.delete(key); },
  };
}

describe('mobile durable storage', () => {
  it('stores opaque saves and the Library in the app-owned Data directory', async () => {
    const files = fileStore();
    const preferences = preferenceStore();
    const store = mobileStorage(files, preferences);
    const save = { format: 27, year: 1201, nested: { exact: ['opaque', 7] } };
    const library = { format: 1, runs: [{ seed: 19 }] };

    await store.writeSave('autosave', save);
    await store.writeLibrary(library);

    expect(files.data.get('eldritch/saves/autosave.json')).toBe(JSON.stringify(save));
    expect(files.data.get('eldritch/library.json')).toBe(JSON.stringify(library));
    expect(files.writes).toEqual([
      expect.objectContaining({ path: 'eldritch/saves/autosave.json', directory: Directory.Data, recursive: true }),
      expect.objectContaining({ path: 'eldritch/library.json', directory: Directory.Data, recursive: true }),
    ]);
    await expect(store.readSave('autosave')).resolves.toEqual(save);
    await expect(store.readLibrary()).resolves.toEqual(library);
  });

  it('round-trips arbitrary slot names without turning them into paths', async () => {
    const files = fileStore();
    const store = mobileStorage(files, preferenceStore());

    await store.writeSave('old house / 2', { format: 27, year: 1300 });

    expect(files.data.has('eldritch/saves/old%20house%20%2F%202.json')).toBe(true);
    await expect(store.listSaves()).resolves.toMatchObject([
      { slot: 'old house / 2', year: 1300, format: 27 },
    ]);
  });

  it('migrates existing Android Preference saves only after a durable write succeeds', async () => {
    const files = fileStore();
    const preferences = preferenceStore({
      'ed:save:autosave': JSON.stringify({
        format: 27,
        year: 1199,
        savedAt: '2026-09-30T00:00:00.000Z',
      }),
      'ed:library': JSON.stringify({ format: 1, runs: [{ seed: 91 }] }),
    });
    const store = mobileStorage(files, preferences);

    await expect(store.listSaves()).resolves.toMatchObject([
      { slot: 'autosave', year: 1199, format: 27 },
    ]);
    expect(preferences.data.has('ed:save:autosave')).toBe(false);
    expect(files.data.has('eldritch/saves/autosave.json')).toBe(true);

    await expect(store.readLibrary()).resolves.toEqual({ format: 1, runs: [{ seed: 91 }] });
    expect(preferences.data.has('ed:library')).toBe(false);
    expect(files.data.has('eldritch/library.json')).toBe(true);
  });

  it('keeps a legacy save readable when migration cannot write the file', async () => {
    const base = fileStore();
    const preferences = preferenceStore({
      'ed:save:autosave': JSON.stringify({ format: 27, year: 1177 }),
    });
    const files = {
      ...base,
      async writeFile() { throw new Error('disk unavailable'); },
    };
    const store = mobileStorage(files, preferences);

    await expect(store.readSave('autosave')).resolves.toEqual({ format: 27, year: 1177 });
    expect(preferences.data.has('ed:save:autosave')).toBe(true);
  });

  it('ignores malformed snapshots without making the whole save list unreadable', async () => {
    const files = fileStore({
      'eldritch/saves/bad.json': '{',
      'eldritch/saves/good.json': JSON.stringify({
        format: 27,
        year: 1234,
        savedAt: '2026-10-01T00:00:00.000Z',
      }),
    });
    const store = mobileStorage(files, preferenceStore());

    await expect(store.listSaves()).resolves.toEqual([
      { slot: 'good', format: 27, year: 1234, savedAt: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('deletes both durable and pre-migration copies of a slot', async () => {
    const files = fileStore({
      'eldritch/saves/autosave.json': JSON.stringify({ format: 27, year: 1200 }),
    });
    const preferences = preferenceStore({
      'ed:save:autosave': JSON.stringify({ format: 27, year: 1199 }),
    });
    const store = mobileStorage(files, preferences);

    await store.deleteSave('autosave');

    expect(files.data.has('eldritch/saves/autosave.json')).toBe(false);
    expect(preferences.data.has('ed:save:autosave')).toBe(false);
    await expect(store.readSave('autosave')).resolves.toBeNull();
  });
});
