/**
 * Fail-closed checks for the macOS simulator's terminal evidence.
 * A missing digest compared to another missing digest is NOT persistence proof:
 * undefined === undefined would otherwise allow save/resume and export/import
 * to pass after a broken bridge change.
 */
export function assertFinalEvidence(kind, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`${kind} smoke produced no structured evidence`);
  }
  if (evidence.command !== kind) {
    throw new Error(`expected ${kind} evidence, found ${evidence.command}`);
  }
  if (evidence.stage !== undefined) {
    throw new Error(`${kind} smoke evidence is not a final result (stage: ${evidence.stage})`);
  }
  if (evidence.ok !== true) {
    throw new Error(
      typeof evidence.error === 'string' && evidence.error
        ? evidence.error
        : `${kind} smoke command failed`,
    );
  }
  if (typeof evidence.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.sha256)) {
    throw new Error(`${kind} smoke evidence has no valid sha256 digest`);
  }
  if (kind === 'export' && (typeof evidence.path !== 'string' || !evidence.path.trim())) {
    throw new Error('export smoke evidence has no valid interchange path');
  }
  return evidence;
}


/**
 * Name differences between two JSON snapshots without printing the player's
 * actual data. The iOS simulator compares hashes across process boundaries;
 * a mismatch otherwise says nothing about which saved subsystem changed.
 *
 * Only the root savedAt field is ignored, exactly like smoke.ts's hash.
 * Paths are stable, bounded and suitable for public CI logs.
 */
export function changedSnapshotPaths(before, after, limit = 12) {
  const maxPaths = Math.max(1, Math.min(100, Math.trunc(limit) || 12));
  const found = [];
  const record = (at) => {
    if (found.length <= maxPaths) found.push(at);
  };

  function walk(left, right, at) {
    if (found.length > maxPaths || Object.is(left, right)) return;

    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) record(`${at}.length`);
      for (let i = 0; i < Math.min(left.length, right.length) && found.length <= maxPaths; i++) {
        walk(left[i], right[i], `${at}[${i}]`);
      }
      return;
    }

    const objects = left !== null && right !== null
      && typeof left === 'object' && typeof right === 'object'
      && !Array.isArray(left) && !Array.isArray(right);
    if (objects) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        if (found.length > maxPaths) break;
        // saveGame intentionally refreshes this metadata on every save.
        if (at === '$' && key === 'savedAt') continue;
        const childPath = `${at}[${JSON.stringify(key)}]`;
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
          record(childPath);
        } else {
          walk(left[key], right[key], childPath);
        }
      }
      return;
    }
    record(at);
  }

  walk(before, after, '$');
  return { paths: found.slice(0, maxPaths), truncated: found.length > maxPaths };
}
