import { createHash } from 'node:crypto';

/** Stable JSON transport evidence, matching the iOS native smoke contract. */
function orderedJson(value) {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, orderedJson(value[key])]));
}

export function nativeSnapshotSha256(snapshot) {
  const value = orderedJson(snapshot);
  // A cold resume writes a fresh timestamp. Every other persisted field,
  // including nested timestamps and array order, remains part of the proof.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) delete value.savedAt;
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
