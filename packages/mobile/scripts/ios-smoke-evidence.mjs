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
