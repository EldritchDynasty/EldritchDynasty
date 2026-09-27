import { z } from 'zod';
import { GenePoolS } from './genome.js';
import { RespectTierS } from './conditions.js';

export const HouseDefS = z.object({
  id: z.string(),
  name: z.string(),
  isPlayerHouse: z.boolean().default(false),
  genePool: GenePoolS,
  respect: RespectTierS.default('known'),
  wealth: z.number().default(0),
  /**
   * What this house already owns in 1042, by heirloom id. There was nowhere to
   * say this, so the Regalia — three named objects that four content files and
   * the Age One script all talk about, and that Demigod requires held at once
   * — were owned by nobody: `world.heirlooms` started empty and the only ways
   * in were an auction lot and three authored `grant` effects. A house's
   * founding possessions are content, and this is where content says so.
   * Honoured for the player house at `bootstrap`; ignored elsewhere, because
   * `HeirloomState` has no owner field and a rival house holding a thing is
   * that thing's own story to tell.
   */
  heirlooms: z.array(z.string()).default([]),
  /**
   * BOOKS THE HOUSE ALREADY HOLDS IN 1042 (issue #41).
   *
   * Measured before this existed: the shelf was empty until about 1250 and
   * held one book until about 1450, while the blood was at its deepest in the
   * first two centuries and gone by the third. Every rung above Touched wants
   * reading, so the two halves of the same gate were never available in the
   * same century — at 1142 the house had a man past Adept's power gate and
   * nothing for him to read, and by the time the shelf filled there was nobody
   * left who could express anything.
   *
   * A house that signed what this one signed owns books. Seeding them is not a
   * gift of power: the ladder still wants the blood, the Madness and the
   * standing, and a book on the shelf is only a book somebody has to be put in
   * front of (§13's table).
   */
  library: z.array(z.string()).default([]),
  /** Drives auction bidding, marriage terms and hostility (concept §14). */
  motives: z.array(z.object({
    wants: z.array(z.string()).default([]),
    refuses: z.array(z.string()).default([]),
    bidsUpTo: z.number().default(0),
  })).default([]),
  blurb: z.string().optional(),
});
export type HouseDef = z.infer<typeof HouseDefS>;

export const HouseFileS = z.object({ houses: z.array(HouseDefS) });

/** Enemies are not a type. Hostility is an edge. */
export interface Relationship {
  from: string;
  to: string;
  sentiment: number;
  kinds: ('rival' | 'debt' | 'obligation' | 'affection' | 'fear' | 'patronage')[];
  grudges: Grudge[];
}

export interface Grudge {
  id: string;
  originEvent: string;
  originYear: number;
  /** The Chronicle page where this quarrel began, when the book wrote one. */
  originPage?: string;
  severity: number;
  /** One enum is why the prologue's grudge echoes for a thousand years. */
  inheritance: 'none' | 'heir_only' | 'all_blood' | 'house_wide';
  decayPerYear: number;
}
