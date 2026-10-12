import { randomUUID } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Atomically replace an opaque JSON file without trusting a predictable
 * scratch path. Default write flags follow pre-planted symlinks, so writes
 * must use both an unpredictable sibling name and exclusive creation (#870).
 *
 * Keep this shared between save slots and the installation Library of Houses.
 * Parsing and validation remain in the core/schema layers, not in the shell.
 */
export function writeJsonAtomically(target, value) {
  // The input can be an object even when its toJSON() turns the document
  // into null, an array or a scalar. Readers reject those roots; refusing
  // them before creating scratch preserves the previous readable file.
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string' || !serialized.startsWith('{')) {
    throw new TypeError('atomic JSON document must serialize to an object');
  }

  const scratch = `${target}.${randomUUID()}.writing`;
  try {
    writeFileSync(scratch, serialized, { encoding: 'utf8', flag: 'wx' });
    renameSync(scratch, target);
  } finally {
    // A failed write or rename must not leave an unusable temporary file.
    // After a successful rename, this path no longer exists.
    rmSync(scratch, { force: true });
  }
  return target;
}
