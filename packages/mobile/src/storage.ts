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
  // Absence alone permits a legacy Preferences migration. A present file
  // with invalid JSON is not an absent file: migrating over it would erase the
  // only surviving bytes of a newer dynasty or Library of Houses.
  async function readFile(path: string): Promise<
    { present: true; value: unknown | null } | { present: false; value: null }
  > {
    try {
      const result = await files.readFile({
        path,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return { present: true, value: parsed(result.data) };
    } catch (error) {
      if (missingFile(error)) return { present: false, value: null };
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
    if (durable.present) return durable.value;

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
    const nativeSlots = new Set<string>();
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
          const native = await readFile(`${SAVE_DIR}/${entry.name}`);
          if (native.present) {
            nativeSlots.add(slot);
            if (native.value !== null) saves.set(slot, saveSummary(slot, native.value));
          }
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

      if (nativeSlots.has(slot)) {
        // Even a malformed native file is authoritative for migration: leave
        // its bytes and the old Preferences key intact for explicit recovery.
        // Only valid files can safely complete the legacy-key cleanup.
        if (saves.has(slot)) {
          try {
            await preferences.remove({ key });
          } catch {
            // The valid native file already wins; retry cleanup later.
          }
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
    // Remove the legacy copy first: if Preferences cleanup fails, keep the
    // authoritative Data file. Deleting it first lets a stale legacy snapshot
    // migrate back and resurrect a run the player just deleted.
    await preferences.remove({ key: LEGACY_SAVE_PREFIX + slot });
    await removeFile(savePath(slot));
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
    if (durable.present) return durable.value;

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
