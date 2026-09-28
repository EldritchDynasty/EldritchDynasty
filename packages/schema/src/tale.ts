import { z } from 'zod';
import { ClaimS } from './claim.js';

/**
 * NESTED TALES (issue #14, ~5% of the text).
 *
 * The rule that governs this whole file: **no nested tale is neutral.** A
 * tale is always performed by someone with a motive, and the game never
 * adjudicates between two contradicting accounts in its own voice — there is
 * no narrator who knows the truth, only Daveed, and he is not neutral either
 * (AGENTS.md, "Do not"). `teller` and `bias` are therefore required, not
 * optional colour.
 *
 * An event of consequence names two or more tales in its `accounts`, and
 * `tales/accounts` (CI gate 8, `rules.ts`) fails the build if a pair of them
 * do not contradict on at least one field. Differing `bias` is the minimum
 * bar; the record layer's claim vocabulary (issue #19) raises it to
 * field-level contradiction once it exists.
 */
export const TaleFormS = z.enum(['song', 'doctrine', 'rival_chronicle', 'rhyme', 'play', 'footnote', 'charm']);
export type TaleForm = z.infer<typeof TaleFormS>;

export const TaleDefS = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  form: TaleFormS,
  /** Always named — see the file comment. */
  teller: z.string().min(1),
  /** What the teller wants the listener to believe. Never neutral. */
  bias: z.string().min(1),
  /** The event this tale is about. Its circulation clock starts the year that event actually fires. */
  about: z.string(),
  /**
   * Houses this account concerns, independent of how the teller or prose names
   * them. Match panels read these ids; wording is presentation and may change.
   */
  houses: z.array(z.string()).default([]),
  /** How much of it is true, 0..1. The simulation's actual outcome is often neither this account nor its rival's. */
  accuracy: z.number().min(0).max(1),
  /** Years after `about` fires before this tale starts circulating. */
  circulatesFrom: z.object({ yearsAfterEvent: z.number().int().nonnegative() }),
  /** Years between retellings drifting further from the last telling. */
  mutatesEveryYears: z.number().int().positive(),
  text: z.string(),
  /**
   * What the tale itself asserts, in the closed vocabulary (issue #19) — a
   * ballad can claim a Strength the record never did. Declared here so the
   * vocabulary genuinely extends to tales; NOT folded into `RecordView`,
   * which is deliberately narrower and reads only the family's own
   * chronicle (`world.chronicle`) — a rival ballad is a contradicting
   * account, not the record sigil drift renders against.
   */
  claims: z.array(ClaimS).default([]),
});
export type TaleDef = z.infer<typeof TaleDefS>;

export const TaleFileS = z.object({ tales: z.array(TaleDefS) });

/**
 * What the world remembers about one tale's circulation. Runtime-only — the
 * stored mirror lives in `save.ts` as `TaleCirculationStateS`, held to this
 * shape by `SAVE_SHAPES_AGREE`.
 */
export interface TaleCirculationState {
  /** The year the event this tale is `about` actually fired. */
  bornYear: number;
  /** `bornYear` + the def's `circulatesFrom.yearsAfterEvent`. */
  circulatesFrom: number;
  circulating: boolean;
  /** How many `mutatesEveryYears` windows have elapsed since circulation began. */
  mutations: number;
  lastMutated?: number;
}
