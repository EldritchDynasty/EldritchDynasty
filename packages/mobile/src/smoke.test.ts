import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, digestOf, loadGame, runYears, saveGame } from '@ed/core';
import type { Platform } from '../../client/src/platform.js';
import { writeJsonAtomically } from '../../shell/src/atomic-json.mjs';
import { readSave, saveRoot, writeSave } from '../../shell/src/saves.mjs';

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

  it('keeps healthy saves and the unreadable slot visible when a file rejects on read', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mobileStorage(files, preferences).listSaves()).resolves.toEqual([
        { slot: 'healthy', format: 28, year: 1234, savedAt },
        { slot: 'unreadable' },
      ]);
      expect(warning).toHaveBeenCalledWith(
        '[mobile] could not read save slot unreadable:',
        expect.any(Error),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps native saves visible if legacy Preferences enumeration fails (#1230)', async () => {
    const deniedPreferences = {
      ...preferences,
      async keys(): Promise<never> { throw new Error('Preferences unavailable'); },
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mobileStorage(files, deniedPreferences).listSaves()).resolves.toEqual([
        { slot: 'healthy', format: 28, year: 1234, savedAt },
        { slot: 'unreadable' },
      ]);
      expect(warning).toHaveBeenCalledWith(
        '[mobile] could not enumerate legacy save slots:',
        expect.objectContaining({ message: 'Preferences unavailable' }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('reports a failed legacy-only enumeration instead of showing no saved runs (#1236)', async () => {
    const nativeEmpty = {
      ...files,
      async readdir() { return { files: [] }; },
    };
    const older = { format: 28, year: 1100, savedAt: '2026-09-30T00:00:00.000Z' };
    let unavailable = true;
    const legacyOnly = {
      ...preferences,
      async keys() {
        if (unavailable) throw new Error('legacy enumeration temporarily unavailable');
        return { keys: ['ed:save:ancestral'] };
      },
      async get() { return { value: JSON.stringify(older) }; },
    };
    const store = mobileStorage(nativeEmpty, legacyOnly);

    // No native files does not mean an unmigrated install has no saves.
    // A failed Preferences scan must reach Start's Retry path.
    await expect(store.listSaves()).rejects.toThrow('legacy enumeration temporarily unavailable');

    unavailable = false;
    await expect(store.listSaves()).resolves.toEqual([{ slot: 'ancestral', ...older }]);
  });

  it('skips a damaged legacy key without losing native or later legacy saves (#1230)', async () => {
    const oldSave = { format: 28, year: 1250, savedAt: '2026-10-03T00:00:00.000Z' };
    const unreliablePreferences = {
      async keys() { return { keys: ['ed:save:damaged', 'ed:save:older'] }; },
      async get({ key }: { key: string }) {
        if (key === 'ed:save:damaged') throw new Error('legacy key denied');
        return { value: JSON.stringify(oldSave) };
      },
      async remove() {},
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mobileStorage(files, unreliablePreferences).listSaves()).resolves.toEqual([
        { slot: 'older', ...oldSave },
        { slot: 'healthy', format: 28, year: 1234, savedAt },
        { slot: 'unreadable' },
      ]);
      expect(warning).toHaveBeenCalledWith(
        '[mobile] could not read legacy save slot damaged:',
        expect.objectContaining({ message: 'legacy key denied' }),
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


// Exercise the ACTUAL Capacitor bridge's import/export methods. The existing
// shell save test covers mobileStorage, but used JSON.stringify in place of
// the public mobile share and file-picker paths; that can miss a broken bridge.
const native = vi.hoisted(() => ({
  documents: new Map<string, string>(),
  sharedUrls: [] as string[],
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    async writeFile({ path, data, directory }: { path: string; data: string; directory: string }) {
      if (directory !== 'DOCUMENTS') throw new Error('interchange was not written to Documents');
      native.documents.set(path, data);
    },
    async readFile({ path, directory }: { path: string; directory: string }) {
      if (directory !== 'DOCUMENTS') throw new Error('interchange was not read from Documents');
      const data = native.documents.get(path);
      if (data === undefined) throw new Error('missing interchange file');
      return { data };
    },
    async getUri({ path }: { path: string }) {
      return { uri: `native://${path}` };
    },
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: { async share({ url }: { url: string }) { native.sharedUrls.push(url); } },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    async keys() { return { keys: [] }; },
    async get() { return { value: null }; },
    async remove() {},
  },
}));
vi.mock('@capacitor/app', () => ({
  App: { async addListener() { return { async remove() {} }; } },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  native.documents.clear();
  native.sharedUrls.length = 0;
});

describe('Windows / Android / iOS host interchange (#322)', () => {
  it('imports a real Electron JSON export, shares it from Capacitor, and continues identically on desktop', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ed-native-transfer-'));
    try {
      const bundle = loadContent();
      const original = bootstrap(bundle, 1042, 1042);
      runYears(original, 25);
      const saved = saveGame(original);

      // The Electron export IPC uses the atomic writer. Feed those exact file
      // bytes to the mobile browser's input/FileReader path, not a parsed object.
      const electronExport = join(directory, 'windows-export.json');
      writeJsonAtomically(electronExport, saved);
      const input = {
        type: '',
        accept: '',
        files: [{ contents: readFileSync(electronExport, 'utf8') }],
        onchange: null as null | (() => void),
        addEventListener() {},
        click() { this.onchange?.(); },
      };
      class NativeFileReader {
        result: string | null = null;
        onload: null | (() => void) = null;
        onerror: null | (() => void) = null;
        onabort: null | (() => void) = null;
        readAsText(file: { contents: string }) {
          this.result = file.contents;
          this.onload?.();
        }
      }
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { createElement: () => input });
      vi.stubGlobal('FileReader', NativeFileReader);

      await import('./platform-bridge.js');
      const mobile = (globalThis as { window?: { edPlatform?: Platform } }).window?.edPlatform;
      expect(mobile).toBeDefined();

      const importedSave = await mobile!.importSave();
      expect(importedSave).toEqual(saved);
      const onMobile = loadGame(importedSave, bundle);
      runYears(onMobile, 10);
      const mobileSnapshot = saveGame(onMobile);

      // The real public mobile export writes Documents and passes its URI to
      // Share, unlike a test that simply calls JSON.stringify itself.
      await mobile!.exportSave(mobileSnapshot);
      const name = `eldritch-${mobileSnapshot.year}.json`;
      const exportedBytes = native.documents.get(name);
      expect(exportedBytes).toBeDefined();
      expect(native.sharedUrls).toEqual([`native://${name}`]);
      expect(JSON.parse(exportedBytes!)).toEqual(mobileSnapshot);

      // The iOS simulator's existing private interchange seam must agree with
      // the player-facing share bytes (it never ships as a Release URL scheme).
      const smokePath = await mobile!.writeSmokeInterchange!(mobileSnapshot);
      expect(await mobile!.readSmokeInterchange!(smokePath)).toEqual(mobileSnapshot);

      // Import into the Electron save adapter, then advance all three worlds
      // to the same year. Comparing digests checks simulation, not just JSON.
      const desktopRoot = saveRoot(directory);
      writeSave(desktopRoot, 'mobile-return', JSON.parse(exportedBytes!));
      const onDesktop = loadGame(readSave(desktopRoot, 'mobile-return'), bundle);
      runYears(original, 20);
      runYears(onMobile, 10);
      runYears(onDesktop, 10);
      expect(digestOf(onMobile)).toBe(digestOf(original));
      expect(digestOf(onDesktop)).toBe(digestOf(original));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/**
 * A name returned by native readdir is not an empty slot merely because the
 * native bytes cannot be decoded today. An older Preferences copy must not
 * overwrite it on a "helpful" migration pass (#1196).
 */
type NativeState = 'invalid-json' | 'unreadable' | 'valid' | 'absent';

function fixture(native: NativeState) {
  const writes: string[] = [];
  const removed: string[] = [];
  const oldSave = { format: 28, year: 1045, savedAt: '2026-09-01T00:00:00Z' };
  const currentSave = { format: 28, year: 1196, savedAt: '2026-10-11T00:00:00Z' };
  const files = {
    readdir: async () => ({
      files: native === 'absent' ? [] : [{ name: 'autosave.json', type: 'file' as const }],
    }),
    readFile: async () => {
      if (native === 'unreadable') throw new Error('Data file temporarily inaccessible');
      return { data: native === 'invalid-json' ? '{bad json' : JSON.stringify(currentSave) };
    },
    writeFile: async ({ path }: { path: string }) => { writes.push(path); },
    deleteFile: async () => undefined,
  };
  const preferences = {
    keys: async () => ({ keys: ['ed:save:autosave'] }),
    get: async () => ({ value: JSON.stringify(oldSave) }),
    remove: async ({ key }: { key: string }) => { removed.push(key); },
  };
  return { store: mobileStorage(files, preferences), writes, removed, oldSave, currentSave };
}

describe('native mobile save listing never overwrites unreadable data (#1196)', () => {
  it('lists a malformed Data file without migrating or deleting its older Preferences backup', async () => {
    const { store, writes, removed } = fixture('invalid-json');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave' }]);
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('does not treat a transient read error as proof that the native file is absent', async () => {
    const { store, writes, removed } = fixture('unreadable');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await store.listSaves()).toEqual([{ slot: 'autosave' }]);
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('keeps native metadata and may retire a legacy backup after successfully parsing the native file', async () => {
    const { store, writes, removed, currentSave } = fixture('valid');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...currentSave }]);
    expect(writes).toEqual([]);
    expect(removed).toEqual(['ed:save:autosave']);
  });

  it('still migrates a legacy save whose native filename is genuinely absent', async () => {
    const { store, writes, removed, oldSave } = fixture('absent');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...oldSave }]);
    expect(writes).toEqual(['eldritch/saves/autosave.json']);
    expect(removed).toEqual(['ed:save:autosave']);
  });
});
