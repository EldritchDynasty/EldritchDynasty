import { z } from 'zod';
import { AttributeDefS, TraitDefS } from './attributes.js';
import { LocusDefS } from './genome.js';
import { EventTemplateS } from './event.js';
import { AgeDefS } from './age.js';
import { ArcDefS } from './arc.js';
import { HouseDefS } from './house.js';
import { SexS } from './attributes.js';
import { RetainerContractS } from './person.js';
import { CharacterTemplateS } from './character.js';
import { HeirloomDefS } from './heirloom.js';
import { SpellbookDefS } from './spellbook.js';
import { CareerDefS } from './career.js';
import { ClauseDefS } from './clause.js';
import { PrologueDefS } from './prologue.js';
import { EndingDefS } from './ending.js';
import { TaleDefS } from './tale.js';
import { ParcelDefS } from './parcel.js';
import { PositionDefS } from './position.js';

/** Authored starting cast. Genomes are rolled from the seed, never authored. */
export const SeedPersonS = z.object({
  key: z.string(),
  name: z.string(),
  /** The founder is never named. He is "the man" (concept §3). */
  epithet: z.string().optional(),
  sex: SexS,
  born: z.number(),
  /** Where they were BORN. Drives which gene pool rolls their genome. */
  house: z.string(),
  /**
   * Which household they live in. Defaults to `house` for blood and cadets,
   * and to the player house for anyone married in, retained, warded or held —
   * because a wife of House Ilm who married into the Eldritch House is a member
   * of that household and a daughter of Ilm at the same time.
   */
  household: z.string().optional(),
  membership: z.enum(['blood', 'married_in', 'retainer', 'ward', 'hostage', 'clergy', 'cadet', 'none']).default('blood'),
  motherKey: z.string().optional(),
  fatherKey: z.string().optional(),
  contract: RetainerContractS.optional(),
  castSlots: z.array(z.string()).default([]),
  /**
   * The Narrator's exemption. Death is redirected to `guardian` rather than
   * applied. Exactly one seed character should carry this.
   */
  becomesGuardian: z.boolean().default(false),
  traits: z.array(z.string()).default([]),
  /** Nudges the rolled genome toward an authored intent, without pinning it. */
  bias: z.record(z.string(), z.number()).default({}),
  isHead: z.boolean().default(false),
  note: z.string().optional(),
});
export type SeedPerson = z.infer<typeof SeedPersonS>;

export const CharacterFileS = z.object({ characters: z.array(SeedPersonS) });

export const ContentBundleS = z.object({
  attributes: z.array(AttributeDefS),
  loci: z.array(LocusDefS),
  traits: z.array(TraitDefS),
  houses: z.array(HouseDefS),
  ages: z.array(AgeDefS),
  events: z.array(EventTemplateS),
  arcs: z.array(ArcDefS),
  /** The twelve authored individuals who exist in 1042. */
  characters: z.array(SeedPersonS),
  /** Recipes for everyone the next five centuries produce. */
  characterTemplates: z.array(CharacterTemplateS).default([]),
  /** Things the house owns and applies to a person. */
  heirlooms: z.array(HeirloomDefS).default([]),
  /** The Library (concept §12): spellbooks the house may own and study. */
  spellbooks: z.array(SpellbookDefS).default([]),
  /** Purchased placements — Respect is bought with descendants (issue #16). */
  careers: z.array(CareerDefS).default([]),
  /** The nine clauses of the 1042 contract (concept §18). */
  clauses: z.array(ClauseDefS).default([]),
  /** The signing itself (concept §3, issue #38). Exactly one, and the run opens on it. */
  prologue: z.array(PrologueDefS).default([]),
  /** Where the Long Line lands (concept §23, issue #39). All five, always. */
  endings: z.array(EndingDefS).default([]),
  /** Nested tales: at least two contradicting accounts of any event of consequence (issue #14). */
  tales: z.array(TaleDefS).default([]),
  /** The house's land (concept §13, world §5/§12; issue #91). The 1042 endowment as of Phase A. */
  parcels: z.array(ParcelDefS).default([]),
  /** What a war can buy the house in writing, separate from what it costs in men (issue #89, Stage 3). */
  positions: z.array(PositionDefS).default([]),
});
export type ContentBundle = z.infer<typeof ContentBundleS>;
