import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolveSavePath, slotOfFile, SAVE_EXTENSION } from '../tools/save-slot.mjs';

/**
 * WRITING A RUN TO DISK.
 *
 * `saveGame` produces a versioned, validated snapshot and `loadGame` rebuilds
 * a run from it that continues bit-identically. Neither has ever touched a
 * file: the shell owns the disk, and this is the part of the shell that was
 * missing. It owns no rules — a save is opaque JSON here, and `loadGame`
 * remains the only thing that decides whether a given blob is a run.
 *
 * Saves live under Electron's `userData`, never in the repository. A save
 * written into `packages/content` would be picked up by the next content
 * validation, and a save written next to the source would not survive
 * installing the application anywhere.
 */

/** Ensure the save directory exists and hand back its path. */
export function saveRoot(userData) {
  const root = join(userData, 'saves');
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Every slot in the directory, newest first, with enough of the save read back
 * to draw a list: what year the run stands at, and when it was written.
 *
 * A file that will not parse is REPORTED, not skipped. A save list that
 * silently omits the run somebody spent nine hours on is the exact failure
 * this codebase keeps having — nothing throws, and the slot is simply not
 * there any more.
 */
export function listSaves(root) {
  const out = [];
  for (const fileName of readdirSync(root)) {
    const slot = slotOfFile(fileName);
    if (slot === undefined) continue;
    const path = join(root, fileName);
    // A bad entry must never hide a healthy run. Preserve the listing row even
    // when metadata lookup fails, with an explicit unreadable reason.
    const entry = { slot, bytes: 0, savedAt: undefined, year: undefined, format: undefined };
    try {
      const stat = regularSaveStat(path);
      entry.bytes = stat.size;
      const save = JSON.parse(readFileSync(path, 'utf8'));
      entry.format = typeof save?.format === 'number' ? save.format : undefined;
      entry.year = typeof save?.year === 'number' ? save.year : undefined;
      entry.savedAt = typeof save?.savedAt === 'string' ? save.savedAt : undefined;
    } catch (e) {
      entry.unreadable = String(e);
    }
    out.push(entry);
  }
  return out.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || a.slot.localeCompare(b.slot));
}

/** No entry named like a slot may redirect file reads outside the save root. */
function regularSaveStat(path) {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new TypeError('save slot is not a regular file');
  return stat;
}

export function readSave(root, slot) {
  const path = resolveSavePath(root, slot);
  regularSaveStat(path);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write one slot, atomically.
 *
 * A Long Line is a few megabytes of JSON, and a `writeFileSync` that
 * is interrupted half way leaves a file that exists, has the right name, and
 * will never parse again — which the player finds out about the next time they
 * try to load the only copy of a nine-hour game. Write beside it and rename;
 * rename is the one filesystem operation that is atomic on every platform.
 */
export function writeSave(root, slot, save) {
  // The one thing the shell checks about a save, and it is a TRANSPORT check
  // rather than a rule: `format` is what `loadGame` reads first, and a blob
  // without one cannot be a save from this application at all. Everything else
  // about whether this is a real run is `SavedGameS`'s business, in core,
  // where the schema lives.
  if (save === null || typeof save !== 'object' || Array.isArray(save) || typeof save.format !== 'number') {
    throw new TypeError('a save is an object with a numeric format');
  }

  const target = resolveSavePath(root, slot);
  // A fixed .writing name can already be a symlink, making writeFileSync
  // overwrite a file outside userData/saves before the safe rename (#870).
  // Use a fresh sibling and exclusive creation to refuse even a raced link.
  const scratch = `${target}.${randomUUID()}.writing`;
  try {
    writeFileSync(scratch, JSON.stringify(save), { encoding: 'utf8', flag: 'wx' });
    renameSync(scratch, target);
  } finally {
    // Interrupted/failed serialization and renames must never leave a
    // half-written scratch beside the slot in a running process.
    rmSync(scratch, { force: true });
  }
  return target;
}

export function deleteSave(root, slot) {
  const target = resolveSavePath(root, slot);
  rmSync(target, { force: true });
  return target;
}

export { SAVE_EXTENSION };
