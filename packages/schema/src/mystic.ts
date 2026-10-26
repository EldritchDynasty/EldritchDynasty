import { z } from 'zod';
import { ALL_AFFINITIES } from './attributes.js';
import { ParcelKindS } from './parcel.js';
import { SceneSiteS } from './primordial.js';

/**
 * MYSTIC DUTIES (#1866 B / #1873) — learned practice as a standing household
 * service, not a check that fires once.
 *
 * A working is authored; an assignment is the house's standing order naming
 * one learned, physically available person to do it for one real place. The
 * benefit is read by the system it changes — mortality in `demography.ts`, the
 * harvest in `land.ts` — and only on a use where the maintainer is still there
 * and the year's upkeep was actually reserved.
 *
 * INVARIANT 4: nothing here reads or writes Madness or Eldritch Power. The
 * only gate on who may practise is `canLearn` plus the learned books.
 * INVARIANT 16: practice is not a post. Nothing here calls `canHoldPost`.
 */

/** Annual risks for a physically deployed reader, before concealment and tide. */
const FieldRiskS = z.object({
  death: z.number().min(0).max(0.05),
  capture: z.number().min(0).max(0.1),
  injury: z.number().min(0).max(0.15),
  ransom: z.number().int().nonnegative(),
}).strict();

export const MysticFieldBenefitS = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field_care'), risk: FieldRiskS,
    casualtyReduction: z.number().min(0).max(0.5),
    officerReduction: z.number().min(0).max(0.5),
  }).strict(),
  z.object({
    kind: z.literal('field_supply'), risk: FieldRiskS,
    crownsPerMan: z.number().min(0).max(0.6),
    maxMen: z.number().int().positive().max(30),
  }).strict(),
  z.object({
    kind: z.literal('field_watch'), risk: FieldRiskS,
    opportunityChance: z.number().min(0).max(0.5),
    credit: z.number().positive().max(2),
  }).strict(),
  z.object({
    kind: z.literal('field_concealment'), risk: FieldRiskS,
    captureReduction: z.number().min(0).max(0.6),
    observationReduction: z.number().min(0).max(0.6),
  }).strict(),
]);
export type MysticFieldBenefit = z.infer<typeof MysticFieldBenefitS>;

export const CovertSupportRoleS = z.enum(['approach', 'breach', 'escape', 'recovery', 'hostile']);
export type CovertSupportRole = z.infer<typeof CovertSupportRoleS>;

export const MysticCommissionDomainS = z.enum(['waterworks', 'workshop', 'journey', 'funeral', 'inspection', 'confidence', 'medicine', 'survey']);
export type MysticCommissionDomain = z.infer<typeof MysticCommissionDomainS>;

export const MysticBenefitS = z.discriminatedUnion('kind', [
  /**
   * A carer posted to one hall. Each year they attend the `maxWards`
   * residents at greatest ordinary risk (the infants and the frail, by the
   * same formula `rollDeath` reads) and reduce the ORDINARY part of those
   * people's death hazard: age, frailty and infancy, never violence, Madness
   * or the max-age wall. Everyone else in the hall gets nothing from them,
   * and two carers in one hall do not stack (the better one counts).
   */
  z.object({
    kind: z.literal('life_care'),
    mortalityReduction: z.number().min(0).max(0.5),
    infantReduction: z.number().min(0).max(0.75),
    maxWards: z.number().int().positive(),
    maxWardAge: z.number().int().nonnegative().max(16).optional(),
  }).strict(),
  /**
   * A warden on one held parcel. When the year's risk roll falls below the
   * kind's ordinary yield, `lossPrevented` of the shortfall is made good. It
   * never raises a good year and never applies to a kind not listed here.
   */
  z.object({
    kind: z.literal('estate_protection'),
    lossPrevented: z.number().min(0).max(1),
    parcelKinds: z.array(ParcelKindS).min(1),
    maxAcres: z.number().positive(),
  }).strict(),
  ...MysticFieldBenefitS.options,
  z.object({
    kind: z.literal('household_protection'),
    stage: z.enum(['warning', 'prevention', 'survival']),
    scope: z.enum(['hall', 'person']),
    bonus: z.number().positive().max(0.5),
  }).strict(),
  z.object({
    kind: z.literal('covert_support'),
    role: CovertSupportRoleS,
    bonus: z.number().positive().max(0.3),
  }).strict(),
  /** One real improvement project; the strongest qualified team sets its price. */
  z.object({
    kind: z.literal('project_support'),
    costReduction: z.number().positive().max(0.35),
    parcelKinds: z.array(ParcelKindS).min(1),
  }).strict(),
  z.object({
    kind: z.literal('library_care'),
    wearReduction: z.number().min(0).max(0.75),
    restorationReduction: z.number().min(0).max(0.35),
  }).strict(),
  z.object({
    kind: z.literal('household_provision'),
    crownsPerPerson: z.number().positive().max(0.4),
    maxPeople: z.number().int().positive().max(10),
  }).strict(),
  z.object({
    kind: z.literal('convalescence'),
    healthPerYear: z.number().positive().max(4),
    recoveryYears: z.number().int().nonnegative().max(1),
  }).strict(),
  z.object({ kind: z.literal('teaching') }).strict(),
  z.object({
    kind: z.literal('commission'), domain: MysticCommissionDomainS,
    years: z.number().int().min(1).max(3),
    annualCrowns: z.number().min(0).max(12),
    favour: z.number().int().min(0).max(10),
  }).strict(),
]);
export type MysticBenefit = z.infer<typeof MysticBenefitS>;
export type MysticBenefitKind = MysticBenefit['kind'];

export const MysticWorkingDefS = z.object({
  id: z.string(),
  name: z.string(),
  affinity: z.enum(ALL_AFFINITIES),
  /** ALL named books must be completed by the practitioner; a shelf copy or a raw score is not enough. */
  books: z.array(z.string()).min(1),
  /** Reciprocal named role: another learned, paid reader must keep it at this place. */
  collaborator: z.string().min(1).optional(),
  /** What the working covers and what it does not, in the player's terms. */
  description: z.string(),
  preparation: z.object({
    crowns: z.number().int().nonnegative(),
    years: z.number().int().nonnegative(),
  }).strict(),
  /** Crowns a year, reserved before any benefit and paid in the economy's tally. */
  upkeep: z.number().nonnegative(),
  benefit: MysticBenefitS,
}).strict();
export type MysticWorkingDef = z.infer<typeof MysticWorkingDefS>;

export const MysticFileS = z.object({ mysticWorkings: z.array(MysticWorkingDefS) });

export const MYSTIC_STATUSES = ['preparing', 'serving', 'suspended'] as const;
export const MysticStatusS = z.enum(MYSTIC_STATUSES);
export type MysticStatus = z.infer<typeof MysticStatusS>;

/**
 * Why a duty is not serving this year. Closed, so a client can say it in the
 * reader's words and a test can ask for one without parsing prose.
 */
export const MysticGapS = z.enum([
  'dead', 'left_house', 'hostage', 'missing', 'deployed', 'away_post', 'not_resident',
  'unlearned', 'target_lost', 'unpaid', 'too_young', 'wounded',
  'no_need',
]);
export type MysticGap = z.infer<typeof MysticGapS>;

/** What an assignment has actually done, kept for the player's account and for the pilot's measurement. */
export const MysticServiceS = z.object({
  /** Years the duty was serving and paid — the eligible denominator. */
  servedYears: z.number().int().nonnegative(),
  /** Years in which it changed an outcome. */
  usefulYears: z.number().int().nonnegative(),
  /** `servedYears` at the first useful year; absent until there is one. */
  firstUsefulAt: z.number().int().positive().optional(),
  /** The last year counted in `usefulYears`, so two saved lives in one winter count once. */
  lastUseful: z.number().optional(),
  livesKept: z.number().int().nonnegative(),
  /** Parcel yield units made good, before the standing-to-crowns scale. */
  yieldKept: z.number().nonnegative(),
  /** Crowns: preparation plus every reserved upkeep. */
  spent: z.number().nonnegative(),
  /** Field-only counters stay absent on historical household duties. */
  menKept: z.number().int().nonnegative().optional(),
  crownsKept: z.number().nonnegative().optional(),
  opportunities: z.number().int().nonnegative().optional(),
  protections: z.number().int().nonnegative().optional(),
  covertUses: z.number().int().nonnegative().optional(),
  bookWearKept: z.number().nonnegative().optional(),
  healthRestored: z.number().nonnegative().optional(),
  studyYearsKept: z.number().int().nonnegative().optional(),
  /** Fractions accumulate, so small levies neither lose all benefit nor become immune. */
  recoverable: z.number().min(0).max(1).optional(),
}).strict();
export type MysticService = z.infer<typeof MysticServiceS>;

export const MysticAssignmentS = z.object({
  id: z.string(),
  practitioner: z.string(),
  /** Omitted for the player's house; foreign field duties use the same evaluator. */
  house: z.string().optional(),
  working: z.string(),
  contract: z.string().optional(),
  /**
   * One shared site vocabulary with #1868. Household duties accept `hall` and
   * `parcel`; field duties require the actual `muster.commitment` id.
   * `bindings` resolves the site's slots to the
   * actual people they name, so the same presence resolver answers both.
   */
  target: SceneSiteS,
  bindings: z.record(z.string(), z.string()),
  started: z.number(),
  ready: z.number(),
  paidPreparation: z.number().nonnegative(),
  /** The last year whose upkeep was reserved. Benefits read this, never a cached morning. */
  paidThrough: z.number(),
  status: MysticStatusS,
  reason: MysticGapS.optional(),
  /** The residents a carer attends this year, chosen at the reservation by ordinary risk. */
  attended: z.array(z.string()).optional(),
  /** Three actual lesson years earn one year of study; changing books starts a new term. */
  lesson: z.object({ book: z.string(), years: z.number().int().nonnegative(), lastYear: z.number() }).strict().optional(),
  service: MysticServiceS,
}).strict();
export type MysticAssignment = z.infer<typeof MysticAssignmentS>;

/** A study set down for a duty. Resumes by remaining time; never completes or vanishes while serving. */
export const MysticStudyPauseS = z.object({
  person: z.string(),
  book: z.string(),
  remainingYears: z.number().int().nonnegative(),
  pausedAt: z.number(),
  assignment: z.string(),
}).strict();
export type MysticStudyPause = z.infer<typeof MysticStudyPauseS>;

export const MysticContractS = z.object({
  id: z.string(), kind: z.enum(['hire', 'commission']), practitioner: z.string(), working: z.string(),
  patron: z.string().optional(), patronActor: z.string().optional(),
  satisfiesPromise: z.string().optional(),
  stage: z.enum(['preparing', 'working', 'returning', 'closed']),
  started: z.number(), ready: z.number(), ends: z.number(), returnsAt: z.number().optional(),
  providerFee: z.number().nonnegative(), escrow: z.number().nonnegative(), worked: z.number().int().nonnegative(),
  lastWorked: z.number().optional(),
  payments: z.array(z.object({ year: z.number(), amount: z.number().nonnegative() }).strict()),
  result: z.enum(['fulfilled', 'withdrawn', 'failed']).optional(), receipt: z.string().optional(),
  renewBy: z.number().optional(), promiseAnswered: z.boolean().optional(), promiseBrokenAt: z.number().optional(),
}).strict();
export type MysticContract = z.infer<typeof MysticContractS>;

export const MysticStateS = z.object({
  assignments: z.array(MysticAssignmentS),
  contracts: z.array(MysticContractS).default([]),
  contacts: z.array(z.string()).default([]),
  search: z.object({ asked: z.number(), due: z.number(), paid: z.number().nonnegative() }).strict().optional(),
  lastSearch: z.number().optional(),
  brokerSpent: z.number().nonnegative().optional(),
  /** Historical paid service is retained after its maintainer leaves or dies. */
  services: z.array(MysticAssignmentS.extend({ ended: z.number(), account: z.string() })).default([]),
  pauses: z.array(MysticStudyPauseS),
  /** Foreign practice spends from the house's authored wealth once, without replenishment. */
  foreignSpent: z.record(z.string(), z.number().nonnegative()).optional(),
  /** The economy still collects a reserved year if its reader dies or returns before the tally. */
  reservedUpkeep: z.object({ year: z.number(), crowns: z.number().nonnegative() }).strict().optional(),
}).strict();
export type MysticState = z.infer<typeof MysticStateS>;
export const emptyMysticState = (): MysticState => ({ assignments: [], services: [], contracts: [], contacts: [], pauses: [] });
