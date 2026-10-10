import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomically } from './atomic-json.mjs';

/**
 * The Library of Houses is installation/profile data, not a save slot. The
 * shell treats it as opaque JSON exactly as it treats saves; schema validation
 * belongs above this transport boundary.
 */
export function readRunLibrary(userData) {
  const path = join(userData, 'library.json');
  let entry;
  try {
    // lstat does not follow links. A planted library.json symlink must not
    // read an arbitrary JSON document outside the Library of Houses (#883).
    entry = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!entry.isFile()) throw new TypeError('library is not a regular file');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Atomic for the same reason save writes are atomic. */
export function writeRunLibrary(userData, library) {
  if (library === null || typeof library !== 'object' || Array.isArray(library)) {
    throw new TypeError('the library is a JSON object');
  }
  return writeJsonAtomically(join(userData, 'library.json'), library);
}
