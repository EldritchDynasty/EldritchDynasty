/** Inclusive seed-span validation for independent report samples (#2196).
 * A safe base and count alone do not ensure that every seedBase + i is distinct:
 * numbers beyond the safe-integer boundary can round to the same seed.
 * Call before loading content, reading checkpoints or running campaigns.
 */
export function sampleSeedEnd(runs: number, seedBase: number): number {
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) {
    throw new Error('Expected positive runs and integer seed base');
  }
  // Subtract first: an exclusive upper bound (seedBase + runs) can already
  // be unsafe when the final included seed is exactly MAX_SAFE_INTEGER.
  const lastSeed = seedBase + (runs - 1);
  if (!Number.isSafeInteger(lastSeed)) {
    throw new Error('Sample seed range exceeds safe integer precision');
  }
  return lastSeed;
}
