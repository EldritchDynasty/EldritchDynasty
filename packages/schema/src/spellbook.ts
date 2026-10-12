import { z } from 'zod';
import { SpellbookIdS } from './ids.js';
import { ALL_AFFINITIES } from './attributes.js';

/**
 * THE LIBRARY (concept §12) — spellbooks as real content.
 *
 * A spellbook is bought once and pays out for centuries: it is a physical copy
 * the HOUSE owns (`LibraryBookState`, on `WorldState.library`, exactly the
 * shape `HeirloomState` uses for the same reason), separate from who has
 * actually STUDIED it (`Person.spellsKnown`). A great-grandfather's purchase
 * outlives him because the copy does; his descendants still have to spend the
 * years learning it.
 *
 * Mystic magic — everything taught from a book — shares NO code with the
 * Eldritch font. `canLearn` (invariant 4) gates who may study an affinity;
 * nothing here ever touches `madness` or `eldritch`, and it must not.
 */
export const SpellbookTierS = z.enum(['minor', 'notable', 'foreign', 'named']);
export type SpellbookTier = z.infer<typeof SpellbookTierS>;

export const SpellbookDefS = z.object({
  id: SpellbookIdS,
  name: z.string(),
  affinity: z.enum(ALL_AFFINITIES),
  tier: SpellbookTierS,
  /** Years of study before it is truly learned. Content schedules the `gain`. */
  studyYears: z.number().int().positive(),
  /** Condition lost, 0-100 scale, per `degrade` effect application. */
  degradesBy: z.number().min(0).max(100).default(20),
  /**
   * Minimum value of the matching affinity attribute a student needs before
   * they may begin. Zero for ordinary stock; a Named Art sets a real floor —
   * the affinity threshold a descendant has to meet to take up the canon a
   * foremother founded.
   */
  threshold: z.number().default(0),
  /** Crowns. 60-200 minor, 400-1200 foreign or high-tier (concept §13). */
  price: z.object({ min: z.number(), max: z.number() }),
  blurb: z.string().optional(),
});
export type SpellbookDef = z.infer<typeof SpellbookDefS>;

export const SpellbookFileS = z.object({ spellbooks: z.array(SpellbookDefS) });

/**
 * What the world remembers about one physical copy the house holds — the
 * shelf, not the reader. Degrades with use and neglect; restoring it is its
 * own expense (left to content: an event or a career effect may raise
 * `condition` back up, the same way `spellbook` effects lower it).
 */
export interface LibraryBookState {
  id: string;
  acquiredYear: number;
  /**
   * 0-100, and it is READ: `conditionDrag` in `core/src/people/library.ts`
   * multiplies `effectiveStudyYears` by 1 at pristine and 2 at ruin, so a
   * damaged copy costs the man reading it real years.
   *
   * This docstring used to say the engine left the arithmetic to content, and
   * content had no way to do it — no `Condition` kind exposes a book's
   * condition, so no author could branch on one. `op: 'degrade'` spent this
   * number in five authored outcomes across three files and bought nothing
   * with it.
   */
  condition: number;
  /** Return year while this physical copy is away with the binder. */
  restoresAt?: number;
  /**
   * A Named Art (tier `named`) is permanently recorded under the name of its
   * first holder the moment anyone first gains it. Undefined for ordinary
   * stock, and never cleared once set — the canon does not forget who founded it.
   */
  namedFor?: { person: string; name: string; year: number };
}
