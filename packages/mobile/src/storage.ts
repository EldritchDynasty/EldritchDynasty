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

/** Only a JSON object is a readable native save or Library record (#1593).
 * Corrupt/scalar roots still count as present bytes: they must not be treated
 * as absent and must never trigger migration over a newer native file.
 * Full game and Library schema validation belongs to core.
 */
function parsed(text: string | Blob): unknown | null {
  if (typeof text !== 'string') return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
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

/** Keep native records opaque but require a JSON object at their root.
 * Check the serialized result: toJSON() may turn an apparent object into a
 * scalar or array. Compact JSON.stringify emits '{' first for object roots.
 * Reject other shapes before writing Data or retiring any legacy key.
 * The actual saved-game and Library schemas remain core's responsibility.
 */
function readableNativeJSON(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || !serialized.startsWith('{')) {
    throw new TypeError('the native host cannot persist a non-object JSON record');
  }
  return serialized;
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

  // Preferences.get returns null only for an absent key. Malformed, empty or
  // literal-null JSON is a *present* record whose bytes must survive recovery.
  async function readLegacy(key: string): Promise<
    { present: true; value: unknown | null } | { present: false; value: null }
  > {
    const { value } = await preferences.get({ key });
    return value === null
      ? { present: false, value: null }
      : { present: true, value: parsed(value) };
  }

  async function writeSave(slot: string, save: unknown): Promise<void> {
    await files.writeFile({
      path: savePath(slot),
      data: readableNativeJSON(save),
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
    if (durable.present) {
      // A present unreadable Data file is not an absent slot. Preserve its
      // bytes and reject instead of offering an invented missing run (#1256).
      // Full saved-game validation still belongs to core.
      if (durable.value === null) throw new TypeError('the native save file is unreadable');
      return durable.value;
    }

    const legacy = await readLegacy(LEGACY_SAVE_PREFIX + slot);
    if (!legacy.present) return null;
    if (legacy.value === null) {
      throw new TypeError('the legacy save file is unreadable');
    }
    try {
      await writeSave(slot, legacy.value);
    } catch {
      // A migration failure must not turn an existing Android save into a
      // missing save. The next read will retry while the legacy key remains.
    }
    return legacy.value;
  }

  async function listSaves(): Promise<SaveSummary[]> {
    const saves = new Map<string, SaveSummary>();
    const nativeSlots = new Set<string>();
    // A parseable native file may retire its legacy backup; a directory entry
    // that cannot be read must NOT. It still owns the slot and blocks migration.
    const readableNativeSlots = new Set<string>();
    try {
      const { files: entries } = await files.readdir({
        path: SAVE_DIR,
        directory: Directory.Data,
      });
      for (const entry of entries) {
        if (entry.type === 'directory') continue;
        const slot = slotFromFile(entry.name);
        if (!slot) continue;
        // Directory membership is evidence of an existing native save even if
        // a subsequent read throws or its JSON will not parse. Never migrate
        // an older Preferences snapshot over those bytes.
        nativeSlots.add(slot);
        saves.set(slot, { slot });
        try {
          const native = await readFile(`${SAVE_DIR}/${entry.name}`);
          if (native.present && native.value !== null) {
            readableNativeSlots.add(slot);
            saves.set(slot, saveSummary(slot, native.value));
          }
        } catch (error) {
          // Preserve the slot in the list, without inventing metadata, so a
          // transient read error cannot make the run disappear from the UI.
          console.warn(`[mobile] could not read save slot ${slot}:`, error);
        }
      }
    } catch (error) {
      if (!missingFile(error)) throw error;
    }

    // Legacy Preferences are a fallback, not a prerequisite for listing the
    // authoritative Data files. A failed Preferences read must not hide them.
    let keys: string[] = [];
    try {
      keys = (await preferences.keys()).keys;
    } catch (error) {
      // Native Data entries are authoritative and must remain listable when
      // the optional legacy store is unavailable (#1230). With no native
      // entries, however, a failed legacy scan says nothing about whether old
      // Android saves exist. Surface Retry rather than declaring zero runs.
      if (nativeSlots.size === 0) throw error;
      console.warn('[mobile] could not enumerate legacy save slots:', error);
    }
    for (const key of keys.filter((candidate) => candidate.startsWith(LEGACY_SAVE_PREFIX))) {
      const slot = key.slice(LEGACY_SAVE_PREFIX.length);
      if (!slot) continue;

      if (nativeSlots.has(slot)) {
        // Even a malformed native file is authoritative for migration: leave
        // its bytes and the old Preferences key intact for explicit recovery.
        // Only valid files can safely complete the legacy-key cleanup.
        if (readableNativeSlots.has(slot)) {
          try {
            await preferences.remove({ key });
          } catch {
            // The valid native file already wins; retry cleanup later.
          }
        }
        continue;
      }

      let legacy: Awaited<ReturnType<typeof readLegacy>>;
      try {
        legacy = await readLegacy(key);
      } catch (error) {
        // One denied Preferences key must not hide Data saves or later
        // legacy keys which can still be migrated.
        console.warn(`[mobile] could not read legacy save slot ${slot}:`, error);
        continue;
      }
      if (!legacy.present) continue;
      if (legacy.value === null) {
        // A corrupt Preferences record owns its slot just like a corrupt Data
        // file. Keep it visible but do not migrate or remove its only bytes.
        saves.set(slot, { slot });
        continue;
      }
      saves.set(slot, saveSummary(slot, legacy.value));
      try {
        await writeSave(slot, legacy.value);
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
      data: readableNativeJSON(library),
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
    if (durable.present) {
      // A present native Library file with invalid JSON or unreadable bytes
      // is not an absent Library. Returning null here would let the client
      // overwrite the player's existing history with an invented empty one.
      // Never fall back to an older Preferences snapshot over those bytes.
      if (durable.value === null) {
        throw new TypeError('the native Library of Houses file is unreadable');
      }
      return durable.value;
    }

    const legacy = await readLegacy(LEGACY_LIBRARY_KEY);
    if (!legacy.present) return null;
    if (legacy.value === null) {
      throw new TypeError('the legacy Library of Houses file is unreadable');
    }
    try {
      await writeLibrary(legacy.value);
    } catch {
      // Same migration rule as saves: read the old value and retry later.
    }
    return legacy.value;
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
