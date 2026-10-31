/**
 * An exported native interchange file is an opaque JSON object, not a game
 * schema validated by the Capacitor host. Check the actual serialized root:
 * toJSON() can turn an apparent object into null, an array, or a scalar.
 *
 * Serialize exactly once so a stateful toJSON() cannot change what is checked
 * between validation and the durable Documents write.
 */
export function serializeInterchange(save: unknown): string {
  const serialized = JSON.stringify(save, null, 2);
  if (typeof serialized !== 'string' || !serialized.startsWith('{')) {
    throw new TypeError('mobile interchange must serialize to a JSON object');
  }
  return serialized;
}

/**
 * A share export is a new Documents file, not a save slot. Including only
 * the year silently overwrote an earlier export from another house (or an
 * earlier version of the same house) at the same year. The caller supplies
 * a fresh crypto.randomUUID() per export; unlike the smoke interchange path,
 * user exports must never reuse a fixed basename.
 */
export function exportInterchangeFilename(year: number | undefined, exportId: string): string {
  return `eldritch-${year ?? 'run'}-${exportId}.json`;
}
