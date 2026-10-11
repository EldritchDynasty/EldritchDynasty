import { basename, isAbsolute, relative, resolve } from 'node:path';

/**
 * THE GUARD ON THE SAVE DIRECTORY.
 *
 * `saveGame`/`loadGame` have round-tripped a run exactly for as long as the
 * save format has existed, and nothing has ever written one to disk: choosing
 * a slot and a directory is the shell's job, and the shell did not do it
 * (AGENTS.md, "Known gaps"). This is the half of that job that has to be
 * right, kept separate from the fs calls and from Electron so it can be tested
 * without either.
 *
 * A slot name is typed by a player, which makes it the second untrusted string
 * this application takes from outside itself. `content-path.mjs` guards the
 * first one and is the model here, with one difference that matters: a content
 * path is a PATH, and may name a subdirectory, so it is checked after
 * resolution. A slot is a NAME. Nothing about "the autumn run" wants a
 * separator in it, so the name is checked before it is ever joined to
 * anything, and the containment check afterwards is the belt to that braces.
 *
 * The extension is ours, not the player's. A slot called `notes.txt` is a save
 * file called `notes.txt.edsave.json`, which is the only way a listing can
 * tell its own files from whatever else is in the directory.
 */

export const SAVE_EXTENSION = '.edsave.json';

/** The longest slot name that still fits a file name on every platform we care about. */
const MAX_SLOT = 64;

/**
 * Letters, digits, space, dash, underscore. No dot, which is what makes `..`
 * unreachable rather than merely refused; no separator on either platform; no
 * leading space, so a slot cannot be named something a listing renders as
 * nothing.
 */
const SLOT_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/** Thrown for anything that is not a slot. Callers turn it into their transport's error. */
export class SaveSlotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveSlotError';
  }
}

/**
 * The absolute path of one save slot, or throw.
 *
 * @param {string} root absolute path of the save directory
 * @param {unknown} slot the untrusted slot name, as the transport received it
 * @returns {string} the absolute path, guaranteed a direct child of `root`
 */
export function resolveSavePath(root, slot) {
  if (typeof slot !== 'string' || slot === '') throw new SaveSlotError('a save slot name is required');
  if (slot.length > MAX_SLOT) throw new SaveSlotError(`a save slot name is at most ${MAX_SLOT} characters`);
  if (slot !== slot.trim()) throw new SaveSlotError('a save slot name may not begin or end with a space');
  if (!SLOT_SHAPE.test(slot)) {
    throw new SaveSlotError('a save slot name is letters, digits, spaces, dashes and underscores');
  }

  const target = resolve(root, slot + SAVE_EXTENSION);
  const rel = relative(root, target);

  // The braces. `SLOT_SHAPE` already makes this unreachable; it stays because
  // the shape is the kind of thing that gets loosened by somebody adding one
  // character to a character class, and this line does not care what the shape
  // allows. A slot is a direct child of the save directory or it is nothing.
  if (rel !== basename(target) || isAbsolute(rel)) throw new SaveSlotError('a save slot is a name, not a path');

  return target;
}

/**
 * The slot a file name belongs to, or undefined if the file is not ours.
 * A listing runs over whatever is in the directory, including whatever the
 * player put there.
 */
export function slotOfFile(fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith(SAVE_EXTENSION)) return undefined;
  const slot = fileName.slice(0, -SAVE_EXTENSION.length);
  // Directory enumeration must use the same slot-name rules as read/delete:
  // an otherwise plausible filename ending with a space before the extension
  // must not become an unopenable, undeletable save-list entry.
  return SLOT_SHAPE.test(slot) && slot.length <= MAX_SLOT && slot === slot.trim() ? slot : undefined;
}
