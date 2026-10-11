import { z } from 'zod';

/**
 * THE ENDINGS (concept §23, issues #39 and #66).
 *
 * Where the whole Long Line lands. A closed union, because the one thing
 * that must never happen here is a permissive default: a fall-through in the
 * condition evaluator once made an event fire unconditionally for a thousand
 * years, and a fall-through here would pick the same ending forever — which
 * would look exactly like a game with one ending.
 *
 * Three of the five cannot fire yet, for reasons outside this file: the rites
 * are not built (#43) and the ladder does not reach God in a measured run
 * (#41). They are authored anyway. An ending that cannot fire yet is a target
 * for those issues; an ending nobody wrote is not.
 */
export const ENDING_ORDER = [
  'apotheosis',
  'unmade',
  'broken_line',
  'settled',
  'forgotten',
  'devoured',
] as const;

/** World flag set by a failed final God rite; read by ending selection. */
export const GOD_RITE_FAILED = 'god_rite_failed';

export const EndingIdS = z.enum(ENDING_ORDER);
export type EndingId = z.infer<typeof EndingIdS>;

/**
 * THE RING. Every ending replays the prologue's three beats with exactly one
 * element changed — same cadence, same three parts, one substitution.
 *
 * `beat` is 1-based into the prologue's triad, and exactly one of `given` or
 * `owed` is the replacement. Two substitutions is not a ring, it is a rewrite,
 * and the `ending/ring` rule fails the build over it.
 */
export const EndingRingS = z.object({
  beat: z.number().int().min(1).max(3),
  given: z.string().optional(),
  owed: z.string().optional(),
});
export type EndingRing = z.infer<typeof EndingRingS>;

export const EndingDefS = z.object({
  id: EndingIdS,
  /** What the family's own descendants would call it, if any were left to. */
  title: z.string(),
  /** The last night, in the frame's register. Dunsanian — see `prologue.ts`. */
  opening: z.string(),
  ring: EndingRingS,
  /**
   * The last thing on screen: short, plain, reaching back to the prologue's
   * thesis. This is the one place the frame drops its elevated register, and
   * the drop is the effect.
   */
  closing: z.string(),
});
export type EndingDef = z.infer<typeof EndingDefS>;

export const EndingFileS = z.object({ endings: z.array(EndingDefS) });
