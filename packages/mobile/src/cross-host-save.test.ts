import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, digestOf, loadGame, runYears, saveGame } from '@ed/core';
import type { Platform } from '../../client/src/platform.js';
import { writeJsonAtomically } from '../../shell/src/atomic-json.mjs';
import { readSave, saveRoot, writeSave } from '../../shell/src/saves.mjs';

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
