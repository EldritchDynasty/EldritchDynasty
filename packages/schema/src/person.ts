import { z } from 'zod';
import {
  PersonIdS, HouseIdS, TraitIdS, AttributeIdS, CareerIdS, SpellbookIdS,
  YearS, FlagIdS,
} from './ids.js';
import { SexS } from './attributes.js';
import type { Rite } from './rung.js';
import type { AttributeId, HouseId, PersonId, TraitId, Year, SpellbookId, FlagId, CareerId } from './ids.js';
import type { EldritchProfile, GenomeRef } from './genome.js';
import type { Sex } from './attributes.js';

/**
 * ONE Person type for everyone: family, dead, hirelings, lifetime servants,
 * enemies, rival houses, a name in a forged pedigree. Not five types with five
 * code paths — in this game a hireling marries in, an enemy's sister becomes
 * the matriarch, and a dead man keeps voting through inherited grudges. Any
 * boundary drawn between person-types gets crossed by generation nine.
 */

export const PersonStatusS = z.enum([
  'alive',
  'dead',
  'vessel_consumed',   // greyed, but not the mark for death (concept §22)
  'missing',
  'given_to_church',
  'ascended',
  /**
   * The Narrator. Daveed Gearithy does not die when death is triggered for
   * him — he becomes the house's guardian spirit and makes its decisions from
   * that day forward. He is the player's own voice: the thing that persists
   * while individuals are born, ruined and buried.
   */
  'guardian',
]);
export type PersonStatus = z.infer<typeof PersonStatusS>;

/** hot = living and query-fast. archived = dead or inert. shade = never met. */
export const StorageTierS = z.enum(['hot', 'archived', 'shade']);
export type StorageTier = z.infer<typeof StorageTierS>;

export const MembershipKindS = z.enum([
  'blood', 'married_in', 'retainer', 'ward', 'hostage', 'clergy', 'cadet', 'none',
]);
export type MembershipKind = z.infer<typeof MembershipKindS>;

export const MembershipRecordS = z.object({
  house: HouseIdS,
  kind: MembershipKindS,
  from: YearS,
  to: YearS.optional(),
  branch: z.string().optional(),
});
export type MembershipRecord = z.infer<typeof MembershipRecordS>;

export const RetainerRoleS = z.enum([
  'tutor', 'steward', 'guard', 'midwife', 'archivist', 'singer', 'physician', 'chronicler',
]);
export type RetainerRole = z.infer<typeof RetainerRoleS>;

export const RetainerContractS = z.object({
  role: RetainerRoleS,
  term: z.enum(['seasonal', 'yearly', 'lifetime', 'bonded', 'hereditary']),
  wage: z.number(),                       // in marks per year
  loyalty: z.number().min(0).max(100).default(50),
  boundTo: z.string(),
  onEmployerDeath: z.enum(['released', 'passes_to_heir', 'freed', 'follows_named']).default('passes_to_heir'),
  /**
   * THE BOND, in marks (world §12).
   *
   * *"Nobody in this world is a slave and there is no serfdom in Aubren.
   * People are held by debt, custom, contract and having nowhere else to go,
   * which is sufficient."* This is the debt. `term: 'bonded'` was declared
   * from the schema's first draft and meant nothing — it read as `lifetime`
   * everywhere it was tested — because there was no sum for it to be about.
   *
   * A bonded servant is not paid: the wage services the debt instead, and
   * while it stands they cannot leave for arrears, for destitution, or on the
   * death of the man who signed it. See `core/src/people/bond.ts`.
   */
  debt: z.number().default(0),
  /**
   * Whom `onEmployerDeath: 'follows_named'` names.
   *
   * The enum has offered that option since the schema's first draft with
   * nothing anywhere to say who was followed, so the branch resolved to the
   * Head and was indistinguishable from `passes_to_heir` — four options doing
   * the work of two. An unresolvable name falls through to the heir, which is
   * what happens when the person you were promised to is already dead.
   */
  follows: z.string().optional(),
  /**
   * What leaves with them, and to whom. A dismissed archivist who knows a
   * Discrepancy is a Discrepancy with legs.
   */
  knowsSecrets: z.array(FlagIdS).default([]),
});
export type RetainerContract = z.infer<typeof RetainerContractS>;

/**
 * A SECRET THAT LEFT THE HOUSE.
 *
 * `knowsSecrets` and `loyalty` were declared on every authored contract and
 * read by nothing (AGENTS.md, "Known gaps"). This is the state that makes them
 * mean something: when service ends, what a retainer knows is tested against
 * how loyal they were and how badly they were let go, and what fails the test
 * walks out with them.
 *
 * A loose secret is not yet a told one. It sits with whoever took them on, for
 * as long as it takes to be asked in the friendly way, and the year it is told
 * it becomes an open Discrepancy under its own id — provable by the house that
 * now holds it, which is what puts it in the auction's stock and lets the
 * family buy its own secret back. That is the whole of "a Discrepancy with
 * legs", and none of it is new machinery.
 */
export interface LooseSecret {
  /** The secret's id, and the id of the Discrepancy it becomes when told. */
  secret: string;
  /** Who carried it out. Dead or alive: a copy does not need anyone living. */
  carrier: string;
  carrierName: string;
  /** The house that took them on, and can therefore prove it. */
  house: string;
  /** The year service ended, which is the year the clock starts. */
  since: Year;
  /** Nineteen years of knowing where things are is worth more than two. */
  severity: 'minor' | 'major';
  /** The year it was finally told. Undefined while it is still only walking. */
  told?: Year;
  /**
   * The Chronicle page that saw them go (issue #326), so the page that tells
   * it can link back to the act that let it out.
   */
  page?: string;
}

export const AwakeningStateS = z.object({
  awakened: z.boolean().default(false),
  year: YearS.optional(),
  age: z.number().optional(),
  forced: z.boolean().default(false),
  declaredMundane: z.boolean().default(false),
});
export type AwakeningState = z.infer<typeof AwakeningStateS>;

/**
 * Dowry currency (concept §7, world §13): three generations of maternal
 * record, notarised. Forgeable, and forging them is an industry with published
 * rates. Read by `core/src/people/papers.ts`, which is what a match asks for.
 */
export const LineageDocumentS = z.object({
  generations: z.number().int(),
  notarisedBy: z.string(),
  forged: z.boolean().default(false),
  claims: z.string().optional(),
  /**
   * The year somebody set this beside the parish roll and asked whose seal it
   * was (world §16's standard tell). An exposed document is repudiated rather
   * than deleted: it stops counting as papers, and it stays on the person,
   * because the house's problem afterwards is not that it has no pedigree but
   * that everybody has seen the one it used to have.
   */
  exposed: z.number().optional(),
});
export type LineageDocument = z.infer<typeof LineageDocumentS>;

export interface PhenotypeCache {
  /**
   * Keyed by plain attribute id, and plain on purpose. The attribute list is
   * OPEN — an attribute is six loci and a row of YAML, and nothing in the
   * engine counts them — so every reader here holds a string that came out of
   * content. Branding the key bought nothing and cost a cast at every single
   * read site, which is how `as unknown as Map<string, number>` ended up in the
   * hot path of the phenotype accessor.
   */
  attrs: Map<string, number>;
  eldritch: EldritchProfile;
  computedAtYear: Year;
  dirty: boolean;
}

export interface Person {
  id: PersonId;
  name: string;
  /** Some people are deliberately unnamed. The founder is "the man". */
  epithet?: string;
  sex: Sex;
  sigilSeed: number;
  houseOfOrigin: HouseId;

  born: Year;
  died?: Year;
  status: PersonStatus;
  causeOfDeath?: string;

  /** Two lineages, deliberately. The documents may not match the blood. */
  trueParents: { mother?: PersonId; father?: PersonId };
  claimedParents: { mother?: PersonId; father?: PersonId };
  lineageDocuments: LineageDocument[];

  genome: GenomeRef;
  phenotype?: PhenotypeCache;

  traits: Set<TraitId>;
  awakening: AwakeningState;
  spellsKnown: SpellbookId[];
  career?: { career: CareerId; from: Year };

  membership: MembershipRecord[];
  contract?: RetainerContract;
  marriages: { spouse: PersonId; from: Year; to?: Year }[];

  /** Madness, accrued. Only ever nonzero where canExpress is true. */
  madness: number;

  /**
   * THE RITES THIS PERSON HAS TAKEN (concept §22, issue #43).
   *
   * Three rungs of the ladder are gated on an act rather than on a quantity,
   * and an act is a thing that happened once to one man — so it is recorded on
   * him, not on the house. `gateFor` reads this as the LAST requirement of
   * rungs four, five and six, which is what stops those rungs pretending to be
   * measurements of blood and books.
   *
   * Never cleared. A man who consumed a relative is a man who consumed a
   * relative, and the ladder does not forget it when he dies — `world.ascension`
   * keeps its high-water mark for the same reason.
   */
  rites: Rite[];

  /**
   * ACQUIRED modifiers — education, injury, event effects, career. Kept apart
   * from the phenotype cache because that cache is DERIVED and gets recomputed
   * from the genome whenever the year changes. Writing an effect into the
   * cache looks like it works and is gone by next spring, which silently made
   * every `attribute` effect in the game inert.
   */
  acquired: Record<string, number>;

  /**
   * ATTRIBUTES A TUTOR'S TERM HAS ACTUALLY FINISHED ON THIS PERSON (issue
   * #126). `acquired` cannot stand in for this: an event effect writes there
   * too, so a child who got +2 mind from a scene would read as taught. Set
   * once, in `runStandingOrders`, the moment `world.tutoring` completes for
   * them — whichever door opened the term. Never cleared; a term finished is
   * a term finished.
   */
  taught: string[];

  castSlots: string[];

  /*
   * NOT JSDoc on purpose — this documents a field that is ABSENT, and a `/**`
   * block here would attach itself to `tier` and describe the wrong thing.
   *
   * There is no `arcBindings` here, and there was: an `ArcId[]` initialised by
   * the factory, written into the save format and read back out of it, that
   * nothing ever pushed to and nothing ever read (invariant 11).
   *
   * It should not come back. Which arcs a person is bound into is
   * `ArcInstance.bindings` in `world.arcs`, and that is the only copy there
   * can be — `dueArcSteps` recasts and INHERITS bindings as its cast dies off,
   * rewriting them without touching any Person, so a mirror on the person
   * would be wrong by the second beat of any arc that outlived its own cast.
   * Derived state is not storage (invariant 6). Anyone wanting the person-to-
   * arc direction scans `world.arcs`; it is a dozen instances, not a table.
   */
  tier: StorageTier;

  /**
   * Death is redirected rather than applied. Set only for the Narrator, and
   * checked inside PersonStore.kill so that EVERY death path routes through
   * one gate — plague, duel, madness overflow, an authored `status` effect.
   * A second place that kills people is a second place that can kill him.
   */
  becomesGuardian?: boolean;

  /** Which CharacterTemplate produced them, if they were not authored. */
  mintedFrom?: string;
}

export function isAlive(p: Person): boolean {
  return p.status === 'alive';
}

/**
 * NOT LIVING, AND STILL SOMEBODY A SCENE CAN BE ABOUT.
 *
 * Two people in the game are neither `alive` nor gone, and both by design.
 * The Narrator crosses over and keeps deciding for a thousand years
 * (invariant 3); §22's Vessel is consumed and stays on the tree with a mark
 * that is not the mark for death (issue #43).
 *
 * Anything that asks "is this person still available to me" has to mean this
 * rather than `isAlive`, and one of them did not: an arc repairs its bindings
 * by checking `status === 'alive'` and cancels the whole substory when the
 * check fails. The Vessel rite's own second beat — the scene where the house
 * decides what the book will say about the person it just consumed — was
 * cancelled by that line every single time, which is a mandatory Record
 * choice that could not happen and a Discrepancy that could not be created.
 *
 * Not the same question as whether they can marry, bear, inherit or be
 * counted in a hall. Those all mean `isAlive` and still say so.
 */
export function stillCastable(p: Person): boolean {
  return p.status === 'alive' || p.status === 'guardian' || p.status === 'vessel_consumed';
}

export function ageAt(p: Person, year: Year): number {
  return (p.died ?? year) - p.born;
}

export function currentMembership(p: Person, year: Year): MembershipRecord | undefined {
  return p.membership.find((m) => m.from <= year && (m.to === undefined || m.to > year));
}
