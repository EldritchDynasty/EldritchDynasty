import { createHash } from 'node:crypto';

/** Stable JSON transport evidence, matching the iOS native smoke contract. */
function orderedJson(value) {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, orderedJson(value[key])]));
}

export function nativeSnapshotSha256(snapshot) {
  // Hash the actual JSON transport value, never the in-memory wrapper. Date,
  // toJSON and other object types may serialize as a scalar or array, and
  // orderedJson() would otherwise turn a Date into a misleading {} digest.
  const serialized = JSON.stringify(snapshot);
  if (typeof serialized !== 'string') throw new Error('native smoke snapshot must be a JSON object');
  const parsed = JSON.parse(serialized);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('native smoke snapshot must be a JSON object');
  }

  const value = orderedJson(parsed);
  // A cold resume writes a fresh timestamp. Every other persisted field,
  // including nested timestamps and array order, remains part of the proof.
  delete value.savedAt;
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
