import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSavePath, slotOfFile, SaveSlotError, SAVE_EXTENSION } from '../tools/save-slot.mjs';
import { writeJsonAtomically } from './atomic-json.mjs';

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
  // Recursive mkdir accepts an existing symlink to a directory. A later
  // atomic write would then rename a real save into the link's destination,
  // even though the slot itself is a safe basename. Recheck on each call:
  // Electron obtains this root lazily for every IPC operation, so a directory
  // replaced between operations must not silently redirect the next save.
  if (!lstatSync(root).isDirectory()) {
    throw new TypeError('save root is not a regular directory');
  }
  return root;
}

/**
 * Keep the native read, list and write boundaries symmetrical. A present
 * non-save JSON value must stay visible as unreadable, never turn into a
 * missing slot in the preload. Core remains the save-schema authority.
 */
export function requireSaveEnvelope(save) {
  if (save === null || typeof save !== 'object' || Array.isArray(save) || !Number.isFinite(save.format)) {
    throw new TypeError('a save is an object with a numeric format');
  }
  return save;
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
      const save = withVerifiedSave(path, (fd, stat) => {
        entry.bytes = stat.size;
        return requireSaveEnvelope(JSON.parse(readFileSync(fd, 'utf8')));
      });
      entry.format = save.format;
      entry.year = typeof save?.year === 'number' ? save.year : undefined;
      entry.savedAt = typeof save?.savedAt === 'string' ? save.savedAt : undefined;
    } catch (e) {
      entry.unreadable = String(e);
    }
    out.push(entry);
  }
  return out.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || a.slot.localeCompare(b.slot));
}

/**
 * Verify the file we actually read, not only the pathname checked before it.
 * A slot can be replaced between lstat() and open(); a later path-based read
 * could follow a replacement symlink outside the save directory.
 *
 * O_NOFOLLOW rejects a link swapped in before open on POSIX. Windows does not
 * provide it: compare the opened descriptor with both pathname observations
 * there as well. Once validated, only the descriptor is read. Always close it,
 * including on malformed JSON and failed envelope validation.
 */
function withVerifiedSave(path, read) {
  const before = lstatSync(path);
  if (!before.isFile()) throw new TypeError('save slot is not a regular file');
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const fd = openSync(path, flags);
  try {
    const opened = fstatSync(fd);
    const after = lstatSync(path);
    if (!opened.isFile() || !after.isFile()
      || opened.dev !== before.dev || opened.ino !== before.ino
      || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new TypeError('save slot changed while being read');
    }
    return read(fd, opened);
  } finally {
    closeSync(fd);
  }
}

export function readSave(root, slot) {
  const target = resolveSavePath(root, slot);
  // The same slot must not address a different saved filename when a profile
  // moves from a case-sensitive system to Windows.
  rejectCaseAlias(root, slot);
  return withVerifiedSave(target,
    (fd) => requireSaveEnvelope(JSON.parse(readFileSync(fd, 'utf8'))));
}

/**
 * Check complete filenames, including extension spelling. A profile created on
 * a case-sensitive system must behave safely when later opened on Windows.
 * This is a name-ambiguity guard, not a lock against concurrent filesystem edits.
 */
function rejectCaseAlias(root, slot) {
  const fileName = slot + SAVE_EXTENSION;
  const caseAlias = readdirSync(root).find((existing) =>
    existing !== fileName && existing.toLowerCase() === fileName.toLowerCase());
  if (caseAlias !== undefined) {
    throw new SaveSlotError(`save slot "${slot}" conflicts with existing filename "${caseAlias}" on Windows`);
  }
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
  requireSaveEnvelope(save);
  const target = resolveSavePath(root, slot);

  // Windows resolves save filenames case-insensitively. Apply the same
  // portable alias rule to writes AND deletions: otherwise removing "house"
  // could erase an existing "House" run even though writing it is refused.
  rejectCaseAlias(root, slot);
  return writeJsonAtomically(target, save, requireSaveEnvelope);
}

export function deleteSave(root, slot) {
  const target = resolveSavePath(root, slot);
  // A case-only alias deletes another slot on Windows even though writeSave
  // rejects it. Refuse it before the filesystem performs a case-folded lookup.
  rejectCaseAlias(root, slot);
  rmSync(target, { force: true });
  return target;
}

export { SAVE_EXTENSION };
