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
  const scratch = `${target}.${randomUUID()}.writing`;
  try {
    writeFileSync(scratch, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    renameSync(scratch, target);
  } finally {
    // A failed write or rename must not leave an unusable temporary file.
    // After a successful rename, this path no longer exists.
    rmSync(scratch, { force: true });
  }
  return target;
}
