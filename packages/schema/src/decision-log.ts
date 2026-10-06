import { z } from 'zod';
import { SlotFillS } from './slot-fill.js';
import { SexS } from './attributes.js';
import { SigningIdS } from './signing.js';

/**
 * THE DECISION LOG (issue #8, phase 1).
 *
 * `saveGame` / `loadGame` make a run a SNAPSHOT — loading is O(1), but a
 * snapshot says nothing about how the house got there. This is the
 * append-only record beside it: which choice, which outcome, who was cast,
 * which Record option, which child got which name. It is what lets the
 * harness bisect a balance change and what makes a bug reported eleven hours
 * into somebody's playthrough reproducible at all.
 *
 * A closed union ending in `assertNever`, on the same discipline `EffectS`
 * runs under: a new kind of decision is a compile error at its one consumer,
 * not a silent gap in the record.
 *
 * Deliberately NARROW. Only decisions with a genuinely EXTERNAL answer are
 * logged — one a human chose, or the chronicler chose on their behalf at a
 * specific moment. Everything else in a run (mortality, marriages, births,
 * the whole shape of a year) is already reproducible from the seed alone;
 * logging it too would make the log a second copy of the save rather than
 * the thing the snapshot is missing.
 */
export const LoggedDecisionS = z.discriminatedUnion('kind', [
  /**
   * A narration outcome or an answered choice. `choiceId` is absent for
   * narration, which has nothing to choose — the outcome still rolls, and
   * still gets a line, but nobody decided anything. `fill` is the full slot
   * assignment the effects actually ran against, so a player-cast slot
   * replays as what was cast rather than being re-rolled.
   */
  z.object({
    kind: z.literal('outcome'),
    year: z.number(),
    event: z.string(),
    choiceId: z.string().optional(),
    outcomeId: z.string(),
    fill: SlotFillS,
  }),
  /** Record / Omit / Embellish. Not a choice outcome — `applyRecord` never runs through `commitOutcome`. */
  z.object({
    kind: z.literal('record'),
    year: z.number(),
    event: z.string(),
    option: z.enum(['record', 'omit', 'embellish']),
  }),
  /**
   * A suitor drafted (concept §5). The seed decides which three cards the
   * house is dealt; nothing but the player decides which one it takes, and
   * the marriage decides the next generation's genome — so this is the
   * log's business in the strictest sense of the word.
   *
   * `card: null` is a hand declined, which is a real answer and has to be
   * distinguishable from a hand never dealt.
   */
  z.object({
    kind: z.literal('match'),
    year: z.number(),
    subject: z.string(),
    card: z.string().nullable(),
    spouse: z.string(),
  }),
  /**
   * The Examination answer (#343), which changes bootstrap inputs before the
   * existing founding verb runs. Kept separate from `founding`: this is the
   * founder/name + bargain input needed to rebuild the opening cast, while the
   * next entry records the house/gift/grudge/friends chosen after bootstrap.
   */
  z.object({
    kind: z.literal('signing'),
    year: z.number(),
    founderName: z.string().optional(),
    answers: z.record(SigningIdS, SigningIdS),
  }),
  /**
   * The founding answer (issue #391): the house name, gift, first grudge and
   * the finite friend-name roster. These are external player answers just as
   * surely as a later Match choice; without them replay can only rebuild an
   * unsigned/headless world.
   *
   * Kept separate from #343's bootstrap-time `signing` decision. The
   * Examination changes inputs to bootstrap; this entry records the existing
   * post-bootstrap `foundHouse` answer.
   */
  z.object({
    kind: z.literal('founding'),
    year: z.number(),
    houseName: z.string(),
    heirloom: z.string(),
    grudge: z.string(),
    friends: z.array(z.object({ name: z.string(), sex: SexS })),
  }),
  /** A newborn renamed. `renameChild` mutates `takenNames`, which feeds every later name roll. */
  z.object({
    kind: z.literal('name'),
    year: z.number(),
    person: z.string(),
    name: z.string(),
  }),
]);
export type LoggedDecision = z.infer<typeof LoggedDecisionS>;
