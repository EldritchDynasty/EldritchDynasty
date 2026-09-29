import type { ChronicleEntry } from './world.js';

/**
 * WHAT A RUN'S ECHOES CAME TO, ACROSS EVERY SYSTEM THAT WRITES ONE (issue #326).
 *
 * Bearing echoes old acts, `relationships.ts` echoes old quarrels, and each
 * tags its line with the sentence frame it used (`ChronicleEntry.echoFrame`, e.g.
 * `bearing:took_the_cousin:1`, `grudge:2`). This counts those tags, so the
 * repetition instrument reads structure and never the chronicle's words — a
 * reworded or translated line counts the same (issue #276).
 */
export interface EchoTally {
  /** Echo lines written. */
  written: number;
  /** The most times any ONE sentence frame appears in the run. */
  maxCopies: number;
  /** Lines per writing system: `bearing`, `grudge`. */
  bySystem: Record<string, number>;
}

export function echoLineTally(chronicle: readonly ChronicleEntry[]): EchoTally {
  const byFrame = new Map<string, number>();
  const bySystem: Record<string, number> = {};
  for (const entry of chronicle) {
    if (!entry.echoFrame) continue;
    byFrame.set(entry.echoFrame, (byFrame.get(entry.echoFrame) ?? 0) + 1);
    const system = entry.echoFrame.split(':')[0]!;
    bySystem[system] = (bySystem[system] ?? 0) + 1;
  }
  return {
    written: [...byFrame.values()].reduce((a, b) => a + b, 0),
    maxCopies: Math.max(0, ...byFrame.values()),
    bySystem,
  };
}
