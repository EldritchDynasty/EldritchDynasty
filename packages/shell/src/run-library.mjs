import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomically } from './atomic-json.mjs';

/**
 * The Library of Houses is installation/profile data, not a save slot. The
 * shell treats it as opaque JSON exactly as it treats saves; schema validation
 * belongs above this transport boundary.
 */
function requireLibraryObject(library) {
  if (library === null || typeof library !== 'object' || Array.isArray(library)) {
    throw new TypeError('the library is a JSON object');
  }
  return library;
}

export function readRunLibrary(userData) {
  const path = join(userData, 'library.json');
  let entry;
  try {
    // A planted library.json symlink must not read an arbitrary document
    // outside the Library of Houses (#883).
    entry = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!entry.isFile()) throw new TypeError('library is not a regular file');

  // lstat followed by readFileSync(path) permits a symlink to be substituted
  // between those calls. Open once, then read only from that descriptor:
  // even a later pathname swap cannot redirect the bytes we read (#2285).
  // O_NOFOLLOW blocks swaps before open on POSIX; Windows lacks this flag,
  // so verify both the opened file and the still-named entry on every host.
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const fd = openSync(path, flags);
  try {
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    if (!opened.isFile() || !named.isFile()
      || opened.dev !== entry.dev || opened.ino !== entry.ino
      || named.dev !== opened.dev || named.ino !== opened.ino) {
      throw new TypeError('library changed while being read');
    }
    // A present JSON null is not absence: allowing it through would make the
    // client's empty-Library fallback eligible to replace the original bytes.
    return requireLibraryObject(JSON.parse(readFileSync(fd, 'utf8')));
  } finally {
    closeSync(fd);
  }
}

/** Atomic for the same reason save writes are atomic. */
export function writeRunLibrary(userData, library) {
  requireLibraryObject(library);
  return writeJsonAtomically(join(userData, 'library.json'), library);
}
