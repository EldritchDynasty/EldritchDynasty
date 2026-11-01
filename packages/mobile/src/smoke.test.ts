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
import type { Directory, Encoding } from '@capacitor/filesystem';
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

  it('keeps default smoke parameters but rejects ambiguous numeric spellings (#2179)', () => {
    expect(parseSmokeCommand('eldritchdynasty-smoke://save'))
      .toEqual({ kind: 'save', seed: 1042, years: 40 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=-42&years=0'))
      .toEqual({ kind: 'save', seed: -42, years: 0 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=9007199254740991&years=1'))
      .toEqual({ kind: 'save', seed: Number.MAX_SAFE_INTEGER, years: 1 });
    // Native smoke URLs are externally invoked; accepting an enormous but
    // safe integer would queue pathological simulation work in the client.
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?years=500'))
      .toEqual({ kind: 'save', seed: 1042, years: 500 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?years=501')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?years=9007199254740991')).toBeNull();

    for (const query of [
      'seed=', 'seed=%20', 'years=', 'years=%20',
      'seed=0x10', 'seed=1e3', 'seed=1.0', 'seed=+23',
      'years=0x10', 'years=1e2', 'years=1.0', 'years=-1',
      'seed=9007199254740992', 'years=9007199254740992',
    ]) {
      expect(parseSmokeCommand(`eldritchdynasty-smoke://save?${query}`), query).toBeNull();
    }
  });

  it('rejects ambiguous duplicate native smoke parameters (#2194)', () => {
    for (const query of [
      'seed=1042&seed=9000&years=40',
      'seed=1042&seed=1042',
      'seed=1042&seed=',
      'years=40&years=0',
      'years=40&years=40',
      'years=40&years=',
    ]) {
      expect(parseSmokeCommand(`eldritchdynasty-smoke://save?${query}`), query).toBeNull();
    }
    for (const query of [
      'path=smoke.json&path=other.json',
      'path=smoke.json&path=smoke.json',
      'path=smoke.json&path=',
    ]) {
      expect(parseSmokeCommand(`eldritchdynasty-smoke://import?${query}`), query).toBeNull();
    }

    // Ordinary single-value links still work, including the default and
    // signed decimal seed and a single Documents basename.
    expect(parseSmokeCommand('eldritchdynasty-smoke://save'))
      .toEqual({ kind: 'save', seed: 1042, years: 40 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=-42&years=0'))
      .toEqual({ kind: 'save', seed: -42, years: 0 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=smoke.json'))
      .toEqual({ kind: 'import', path: 'smoke.json' });
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


describe('native Data persistence rejects unreadable root JSON (#1374, #1408)', () => {
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

    // JSON serialization can turn an apparent object into an array or scalar.
    // Those roots must not replace durable Data bytes or clear legacy keys.
    const badRoots: unknown[] = [
      null, undefined, () => 1, Symbol('missing'),
      [], [1], 'text', 0, false,
      { toJSON: () => null },
      { toJSON: () => [] },
      { toJSON: () => ['unexpected'] },
      { toJSON: () => 'text' },
      { toJSON: () => 0 },
      { toJSON: () => false },
    ];
    for (const bad of badRoots) {
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
    // Custom serializers that still produce objects remain readable, and
    // normal objects must continue to be accepted without a second schema.
    await host.writeSave('autosave', { toJSON: () => nextSave });
    await host.writeLibrary({ toJSON: () => nextLibrary });
    expect(files.writeFile).toHaveBeenCalledTimes(4);
    expect(preferences.remove).toHaveBeenCalledTimes(4);
    await expect(host.readSave('autosave')).resolves.toEqual(nextSave);
    await expect(host.readLibrary()).resolves.toEqual(nextLibrary);
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

  it('keeps an unreadable legacy slot visible without migrating its unknown bytes (#2259)', async () => {
    const oldSave = { format: 28, year: 1250, savedAt: '2026-10-03T00:00:00.000Z' };
    const writes: string[] = [];
    const removals: string[] = [];
    const nativeFiles = {
      ...files,
      async writeFile({ path }: { path: string }) { writes.push(path); },
    };
    const unreliablePreferences = {
      async keys() { return { keys: ['ed:save:damaged', 'ed:save:older'] }; },
      async get({ key }: { key: string }) {
        if (key === 'ed:save:damaged') throw new Error('legacy key denied');
        return { value: JSON.stringify(oldSave) };
      },
      async remove({ key }: { key: string }) { removals.push(key); },
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mobileStorage(nativeFiles, unreliablePreferences).listSaves()).resolves.toEqual([
        { slot: 'older', ...oldSave },
        { slot: 'healthy', format: 28, year: 1234, savedAt },
        { slot: 'damaged' },
        { slot: 'unreadable' },
      ]);
      expect(writes).toEqual(['eldritch/saves/older.json']);
      expect(removals).toEqual(['ed:save:older']);
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


describe('native Library bytes are never mistaken for an absent profile (#1241)', () => {
  const intact = { format: 1, runs: [] };

  it('rejects malformed JSON, null JSON, and binary native data without reading or replacing legacy history', async () => {
    for (const data of ['{invalid JSON', 'null', new Blob(['opaque file'])]) {
      const wrote: string[] = [];
      const removed: string[] = [];
      const legacyReads: string[] = [];
      const files = {
        async readdir() { return { files: [] }; },
        async readFile() { return { data }; },
        async writeFile({ path }: { path: string }) { wrote.push(path); },
        async deleteFile() {},
      };
      const prefs = {
        async keys() { return { keys: [] }; },
        async get({ key }: { key: string }) {
          legacyReads.push(key);
          return { value: JSON.stringify(intact) };
        },
        async remove({ key }: { key: string }) { removed.push(key); },
      };
      await expect(mobileStorage(files, prefs).readLibrary())
        .rejects.toThrow('the native Library of Houses file is unreadable');
      expect(legacyReads).toEqual([]);
      expect(wrote).toEqual([]);
      expect(removed).toEqual([]);
    }
  });

  it('returns a valid native Library unchanged without touching old Preferences', async () => {
    const files = {
      async readdir() { return { files: [] }; },
      async readFile() { return { data: JSON.stringify(intact) }; },
      async writeFile() { throw new Error('no native write needed'); },
      async deleteFile() {},
    };
    const prefs = {
      async keys() { return { keys: [] }; },
      async get() { throw new Error('native Library must win over Preferences'); },
      async remove() {},
    };
    await expect(mobileStorage(files, prefs).readLibrary()).resolves.toEqual(intact);
  });

  it('still distinguishes genuinely missing native data from a damaged native file', async () => {
    const files = {
      async readdir() { return { files: [] }; },
      async readFile(): Promise<never> {
        throw Object.assign(new Error('not found'), { code: 'OS-PLUG-FILE-0008' });
      },
      async writeFile() {},
      async deleteFile() {},
    };
    const prefs = {
      async keys() { return { keys: [] }; },
      async get() { return { value: null }; },
      async remove() {},
    };
    await expect(mobileStorage(files, prefs).readLibrary()).resolves.toBeNull();
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
      expect(native.sharedUrls).toHaveLength(1);
      const sharedUrl = native.sharedUrls[0]!;
      expect(sharedUrl).toMatch(/^native:\/\/eldritch-\d+-[0-9a-f]{32}\.json$/);
      const name = sharedUrl.slice('native://'.length);
      expect(name.startsWith(`eldritch-${mobileSnapshot.year}-`)).toBe(true);
      const exportedBytes = native.documents.get(name);
      expect(exportedBytes).toBeDefined();
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
type NativeState = 'invalid-json' | 'unreadable' | 'object-not-save' | 'valid' | 'absent';
type LegacyState = 'older' | 'same' | 'invalid' | 'denied';

function fixture(native: NativeState, legacy: LegacyState = 'older') {
  const writes: string[] = [];
  const removed: string[] = [];
  const oldSave = { format: 28, year: 1045, savedAt: '2026-09-01T00:00:00Z' };
  const currentSave = { format: 28, year: 1196, savedAt: '2026-10-11T00:00:00Z' };
  const files = {
    readdir: async () => ({
      files: native === 'absent' ? [] : [{ name: 'autosave.json', type: 'file' as const }],
    }),
    readFile: async () => {
      if (native === 'absent') throw Object.assign(new Error('not found'), { code: 'OS-PLUG-FILE-0008' });
      if (native === 'unreadable') throw new Error('Data file temporarily inaccessible');
      return { data: native === 'invalid-json' ? '{bad json'
        : native === 'object-not-save' ? JSON.stringify({ unrelated: true })
          : JSON.stringify(currentSave) };
    },
    writeFile: async ({ path }: { path: string }) => { writes.push(path); },
    deleteFile: async () => undefined,
  };
  const preferences = {
    keys: async () => ({ keys: ['ed:save:autosave'] }),
    get: async () => {
      if (legacy === 'denied') throw new Error('Preferences read unavailable');
      return { value: legacy === 'invalid' ? '{broken JSON'
        : legacy === 'same'
          // Deliberately reorder keys: semantic equality ignores object order.
          ? JSON.stringify({ savedAt: currentSave.savedAt, year: currentSave.year, format: currentSave.format })
          : JSON.stringify(oldSave) };
    },
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

  it('preserves a different legacy backup while listing the native snapshot (#2338)', async () => {
    const { store, writes, removed, currentSave } = fixture('valid');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...currentSave }]);
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('keeps a different backup even when the native bytes parse as an invalid save-shaped object', async () => {
    const { store, writes, removed } = fixture('object-not-save');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave' }]);
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('retires a truly redundant backup even if JSON object keys have different orders', async () => {
    const { store, writes, removed, currentSave } = fixture('valid', 'same');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...currentSave }]);
    expect(writes).toEqual([]);
    expect(removed).toEqual(['ed:save:autosave']);
  });

  it('retains unreadable or temporarily unavailable legacy backups', async () => {
    for (const legacy of ['invalid', 'denied'] as const) {
      const { store, writes, removed, currentSave } = fixture('valid', legacy);
      expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...currentSave }]);
      expect(writes).toEqual([]);
      expect(removed).toEqual([]);
    }
  });

  it('still migrates a legacy save whose native filename is genuinely absent', async () => {
    const { store, writes, removed, oldSave } = fixture('absent');
    expect(await store.listSaves()).toEqual([{ slot: 'autosave', ...oldSave }]);
    expect(writes).toEqual(['eldritch/saves/autosave.json']);
    expect(removed).toEqual(['ed:save:autosave']);
  });
});


describe('native save read presence is not lost to invalid JSON (#1256)', () => {
  it('rejects malformed, empty, null and binary native save bytes without consulting legacy data', async () => {
    for (const data of ['{broken JSON', '', 'null', new Blob(['not text'])]) {
      const writes: string[] = [];
      const removals: string[] = [];
      const legacyReads: string[] = [];
      const files = {
        async readdir() { return { files: [] }; },
        async readFile() { return { data }; },
        async writeFile({ path }: { path: string }) { writes.push(path); },
        async deleteFile() {},
      };
      const prefs = {
        async keys() { return { keys: [] }; },
        async get({ key }: { key: string }) {
          legacyReads.push(key);
          return { value: '{"format":28,"year":1045}' };
        },
        async remove({ key }: { key: string }) { removals.push(key); },
      };
      const store = mobileStorage(files, prefs);
      await expect(store.readSave('autosave')).rejects.toThrow('the native save file is unreadable');
      expect(legacyReads).toEqual([]);
      expect(writes).toEqual([]);
      expect(removals).toEqual([]);
    }
  });

  it('reads an intact native run without replacing it with an older Preferences snapshot', async () => {
    const { store, writes, removed, currentSave } = fixture('valid');
    await expect(store.readSave('autosave')).resolves.toEqual(currentSave);
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('propagates a native read failure rather than claiming the run is absent', async () => {
    const { store, writes, removed } = fixture('unreadable');
    await expect(store.readSave('autosave')).rejects.toThrow('Data file temporarily inaccessible');
    expect(writes).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('still reads and migrates a legacy snapshot when the native file is genuinely missing', async () => {
    const { store, writes, removed, oldSave } = fixture('absent');
    await expect(store.readSave('autosave')).resolves.toEqual(oldSave);
    expect(writes).toEqual(['eldritch/saves/autosave.json']);
    expect(removed).toEqual(['ed:save:autosave']);
  });
});


describe('legacy Preferences corruption is not absence (#1259)', () => {
  function legacyOnly(entries: Record<string, string>) {
    const data = new Map(Object.entries(entries));
    const writes: Array<{ path: string; data: string }> = [];
    const removals: string[] = [];
    const files = {
      async readdir() { return { files: [] }; },
      async readFile(): Promise<never> {
        throw Object.assign(new Error('native file missing'), { code: 'OS-PLUG-FILE-0008' });
      },
      async writeFile({ path, data: bytes }: { path: string; data: string }) {
        writes.push({ path, data: bytes });
      },
      async deleteFile() {},
    };
    const preferences = {
      async keys() { return { keys: [...data.keys()] }; },
      async get({ key }: { key: string }) { return { value: data.get(key) ?? null }; },
      async remove({ key }: { key: string }) {
        removals.push(key);
        data.delete(key);
      },
    };
    return { store: mobileStorage(files, preferences), data, writes, removals };
  }

  it('rejects each present unreadable legacy save without destroying its Preferences bytes', async () => {
    for (const bytes of ['{broken', '', 'null']) {
      const { store, data, writes, removals } = legacyOnly({ 'ed:save:autosave': bytes });
      await expect(store.readSave('autosave'))
        .rejects.toThrow('the legacy save file is unreadable');
      expect(data.get('ed:save:autosave')).toBe(bytes);
      expect(writes).toEqual([]);
      expect(removals).toEqual([]);
    }
    const absent = legacyOnly({});
    await expect(absent.store.readSave('autosave')).resolves.toBeNull();
    expect(absent.writes).toEqual([]);
    expect(absent.removals).toEqual([]);
  });

  it('lists unreadable legacy slots without metadata or migration and keeps healthy entries', async () => {
    const healthy = JSON.stringify({
      format: 28, year: 1250, savedAt: '2026-10-11T00:00:00Z',
    });
    for (const bytes of ['{broken', '', 'null']) {
      const { store, data, writes, removals } = legacyOnly({
        'ed:save:damaged': bytes,
        'ed:save:healthy': healthy,
      });
      await expect(store.listSaves()).resolves.toEqual([
        { slot: 'healthy', format: 28, year: 1250, savedAt: '2026-10-11T00:00:00Z' },
        { slot: 'damaged' },
      ]);
      expect(data.get('ed:save:damaged')).toBe(bytes);
      expect(data.has('ed:save:healthy')).toBe(false);
      expect(writes).toEqual([{ path: 'eldritch/saves/healthy.json', data: healthy }]);
      expect(removals).toEqual(['ed:save:healthy']);
    }
  });

  it('rejects unreadable legacy Library records without overwriting them', async () => {
    for (const bytes of ['{broken', '', 'null']) {
      const { store, data, writes, removals } = legacyOnly({ 'ed:library': bytes });
      await expect(store.readLibrary())
        .rejects.toThrow('the legacy Library of Houses file is unreadable');
      expect(data.get('ed:library')).toBe(bytes);
      expect(writes).toEqual([]);
      expect(removals).toEqual([]);
    }
    await expect(legacyOnly({}).store.readLibrary()).resolves.toBeNull();

    const healthy = JSON.stringify({ format: 1, runs: [{ seed: 7 }] });
    const { store, data, writes, removals } = legacyOnly({ 'ed:library': healthy });
    await expect(store.readLibrary()).resolves.toEqual({ format: 1, runs: [{ seed: 7 }] });
    expect(data.has('ed:library')).toBe(false);
    expect(writes).toEqual([{ path: 'eldritch/library.json', data: healthy }]);
    expect(removals).toEqual(['ed:library']);
  });
});


describe('native save filenames are canonical slot identities (#2109)', () => {
  const canonical = JSON.stringify({ format: 41, year: 1450, savedAt: '2026-10-31T00:00:00Z' });
  const alias = JSON.stringify({ format: 41, year: 1200 });
  const legacy = JSON.stringify({ format: 41, year: 1100 });

  it('does not let an alias mask an intact autosave, regardless of directory order', async () => {
    for (const entries of [
      ['auto%73ave.json', 'autosave.json'],
      ['autosave.json', 'auto%73ave.json'],
    ]) {
      const reads: string[] = [];
      const removals: string[] = [];
      const files = {
        async readdir() { return { files: entries.map(name => ({ name, type: 'file' as const })) }; },
        async readFile({ path }: { path: string }) {
          reads.push(path);
          const name = path.split('/').at(-1);
          return { data: name === 'autosave.json' ? canonical : alias };
        },
        async writeFile() { throw new Error('native autosave already exists'); },
        async deleteFile() {},
      };
      const prefs = {
        async keys() { return { keys: ['ed:save:autosave'] }; },
        async get() { return { value: legacy }; },
        async remove({ key }: { key: string }) { removals.push(key); },
      };
      const store = mobileStorage(files, prefs);
      await expect(store.listSaves()).resolves.toEqual([
        { slot: 'autosave', format: 41, year: 1450, savedAt: '2026-10-31T00:00:00Z' },
      ]);
      await expect(store.readSave('autosave')).resolves.toEqual(JSON.parse(canonical));
      expect(reads).toEqual(['eldritch/saves/autosave.json', 'eldritch/saves/autosave.json']);
      // A native autosave and a different legacy snapshot are not redundant.
      expect(removals).toEqual([]);
    }
  });

  it('does not let a noncanonical alias suppress migration of a real legacy slot', async () => {
    const bytes = new Map([['eldritch/saves/auto%73ave.json', alias]]);
    const writes: string[] = [];
    const removals: string[] = [];
    const files = {
      async readdir() { return { files: [{ name: 'auto%73ave.json', type: 'file' as const }] }; },
      async readFile({ path }: { path: string }) {
        const data = bytes.get(path);
        if (data === undefined) throw Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' });
        return { data };
      },
      async writeFile({ path, data }: { path: string; data: string }) {
        writes.push(path);
        bytes.set(path, data);
      },
      async deleteFile() {},
    };
    const prefs = {
      async keys() { return { keys: ['ed:save:autosave'] }; },
      async get() { return { value: legacy }; },
      async remove({ key }: { key: string }) { removals.push(key); },
    };
    const store = mobileStorage(files, prefs);
    await expect(store.listSaves()).resolves.toEqual([{ slot: 'autosave', format: 41, year: 1100 }]);
    expect(writes).toEqual(['eldritch/saves/autosave.json']);
    expect(removals).toEqual(['ed:save:autosave']);
    expect(bytes.get('eldritch/saves/auto%73ave.json')).toBe(alias);
    await expect(store.readSave('autosave')).resolves.toEqual(JSON.parse(legacy));
  });

  it('retains canonical encodings for spaces, literal percent, slashes and Unicode', async () => {
    const slot = 'A %/世';
    const name = encodeURIComponent(slot) + '.json';
    const path = 'eldritch/saves/' + name;
    const reads: string[] = [];
    const files = {
      async readdir() { return { files: [{ name, type: 'file' as const }, { name: 'A%20%25%2f%e4%b8%96.json', type: 'file' as const }] }; },
      async readFile({ path: file }: { path: string }) {
        reads.push(file);
        if (file !== path) throw new Error('unexpected alias read');
        return { data: canonical };
      },
      async writeFile() {},
      async deleteFile() {},
    };
    const prefs = {
      async keys() { return { keys: [] as string[] }; },
      async get() { return { value: null }; },
      async remove() {},
    };
    const store = mobileStorage(files, prefs);
    await expect(store.listSaves()).resolves.toEqual([
      { slot, format: 41, year: 1450, savedAt: '2026-10-31T00:00:00Z' },
    ]);
    await expect(store.readSave(slot)).resolves.toEqual(JSON.parse(canonical));
    expect(reads).toEqual([path, path]);
  });
});
