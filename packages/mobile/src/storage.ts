import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const STORE_ROOT = 'eldritch';
const SAVE_DIR = `${STORE_ROOT}/saves`;
const LIBRARY_PATH = `${STORE_ROOT}/library.json`;
const LEGACY_SAVE_PREFIX = 'ed:save:';
const LEGACY_LIBRARY_KEY = 'ed:library';

export type SaveSummary = { slot: string; year?: number; savedAt?: string; format?: number };

interface FileStore {
  readdir(options: { path: string; directory: Directory }): Promise<{
    files: Array<{ name: string; type?: 'file' | 'directory' }>;
  }>;
  readFile(options: {
    path: string;
    directory: Directory;
    encoding: Encoding;
  }): Promise<{ data: string | Blob }>;
  writeFile(options: {
    path: string;
    data: string;
    directory: Directory;
    encoding: Encoding;
    recursive?: boolean;
  }): Promise<unknown>;
  deleteFile(options: { path: string; directory: Directory }): Promise<void>;
}

interface PreferenceStore {
  keys(): Promise<{ keys: string[] }>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
}

export function saveSummary(slot: string, save: unknown): SaveSummary {
  const data = save !== null && typeof save === 'object' ? save as Record<string, unknown> : {};
  return {
    slot,
    year: typeof data.year === 'number' ? data.year : undefined,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
    format: typeof data.format === 'number' ? data.format : undefined,
  };
}

function savePath(slot: string): string {
  return `${SAVE_DIR}/${encodeURIComponent(slot)}.json`;
}

function slotFromFile(name: string): string | null {
  if (!name.endsWith('.json')) return null;
  try {
    const slot = decodeURIComponent(name.slice(0, -'.json'.length));
    return slot || null;
  } catch {
    return null;
  }
}

function parsed(text: string | Blob): unknown | null {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function missingFile(error: unknown): boolean {
  return errorCode(error) === 'OS-PLUG-FILE-0008';
}

/**
 * Native saves are opaque JSON files in Capacitor's app-owned Data directory.
 *
 * #349 adds iOS to the same bridge Android already uses. Filesystem Data maps
 * to persistent app storage on both platforms, so a WebView cache eviction
 * cannot take a dynasty with it. Existing Android installs used Preferences;
 * the fallback below migrates those keys only after the file write succeeds.
 */
export function mobileStorage(
  files: FileStore = Filesystem,
  preferences: PreferenceStore = Preferences,
) {
  async function readFile(path: string): Promise<unknown | null> {
    try {
      const result = await files.readFile({
        path,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return parsed(result.data);
    } catch (error) {
      if (missingFile(error)) return null;
      throw error;
    }
  }

  async function removeFile(path: string): Promise<void> {
    try {
      await files.deleteFile({ path, directory: Directory.Data });
    } catch (error) {
      if (!missingFile(error)) throw error;
    }
  }

  async function readLegacy(key: string): Promise<unknown | null> {
    const { value } = await preferences.get({ key });
    return value === null ? null : parsed(value);
  }

  async function writeSave(slot: string, save: unknown): Promise<void> {
    await files.writeFile({
      path: savePath(slot),
      data: JSON.stringify(save),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    // Cleanup is opportunistic after the durable write: if Preferences is
    // temporarily unavailable the file is still the authoritative successful
    // save, and listSaves will retry removing the stale key later.
    try {
      await preferences.remove({ key: LEGACY_SAVE_PREFIX + slot });
    } catch {
      // Keep the successful file write successful.
    }
  }

  async function readSave(slot: string): Promise<unknown | null> {
    const durable = await readFile(savePath(slot));
    if (durable !== null) return durable;

    const legacy = await readLegacy(LEGACY_SAVE_PREFIX + slot);
    if (legacy === null) return null;
    try {
      await writeSave(slot, legacy);
    } catch {
      // A migration failure must not turn an existing Android save into a
      // missing save. The next read will retry while the legacy key remains.
    }
    return legacy;
  }

  async function listSaves(): Promise<SaveSummary[]> {
    const saves = new Map<string, SaveSummary>();
    try {
      const { files: entries } = await files.readdir({
        path: SAVE_DIR,
        directory: Directory.Data,
      });
      for (const entry of entries) {
        if (entry.type === 'directory') continue;
        const slot = slotFromFile(entry.name);
        if (!slot) continue;
        try {
          const save = await readFile(`${SAVE_DIR}/${entry.name}`);
          if (save !== null) saves.set(slot, saveSummary(slot, save));
        } catch (error) {
          // A single inaccessible native file must not hide healthy saves.
          // Keep directory-level failures fatal, but report this one slot.
          console.warn(`[mobile] could not read save slot ${slot}:`, error);
        }
      }
    } catch (error) {
      if (!missingFile(error)) throw error;
    }

    const { keys } = await preferences.keys();
    for (const key of keys.filter((candidate) => candidate.startsWith(LEGACY_SAVE_PREFIX))) {
      const slot = key.slice(LEGACY_SAVE_PREFIX.length);
      if (!slot) continue;

      if (saves.has(slot)) {
        // The file is authoritative once it exists. Finish a prior migration
        // that wrote successfully but was interrupted before key cleanup.
        try {
          await preferences.remove({ key });
        } catch {
          // The durable file already wins; stale-key cleanup can retry later.
        }
        continue;
      }

      const legacy = await readLegacy(key);
      if (legacy === null) continue;
      saves.set(slot, saveSummary(slot, legacy));
      try {
        await writeSave(slot, legacy);
      } catch {
        // Still list the old save. It remains intact and a later call retries.
      }
    }

    return [...saves.values()]
      .sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? ''))
        || a.slot.localeCompare(b.slot));
  }

  async function deleteSave(slot: string): Promise<void> {
    await removeFile(savePath(slot));
    await preferences.remove({ key: LEGACY_SAVE_PREFIX + slot });
  }

  async function writeLibrary(library: unknown): Promise<void> {
    await files.writeFile({
      path: LIBRARY_PATH,
      data: JSON.stringify(library),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    try {
      await preferences.remove({ key: LEGACY_LIBRARY_KEY });
    } catch {
      // The durable Library file is already authoritative.
    }
  }

  async function readLibrary(): Promise<unknown | null> {
    const durable = await readFile(LIBRARY_PATH);
    if (durable !== null) return durable;

    const legacy = await readLegacy(LEGACY_LIBRARY_KEY);
    if (legacy === null) return null;
    try {
      await writeLibrary(legacy);
    } catch {
      // Same migration rule as saves: read the old value and retry later.
    }
    return legacy;
  }

  return {
    listSaves,
    readSave,
    writeSave,
    deleteSave,
    readLibrary,
    writeLibrary,
  };
}
