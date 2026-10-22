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
]);
export type MysticBenefit = z.infer<typeof MysticBenefitS>;
export type MysticBenefitKind = MysticBenefit['kind'];

export const MysticWorkingDefS = z.object({
  id: z.string(),
  name: z.string(),
  affinity: z.enum(ALL_AFFINITIES),
  /** ALL named books must be completed by the practitioner; a shelf copy or a raw score is not enough. */
  books: z.array(z.string()).min(1),
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
  'unlearned', 'target_lost', 'unpaid', 'too_young',
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
}).strict();
export type MysticService = z.infer<typeof MysticServiceS>;

export const MysticAssignmentS = z.object({
  id: z.string(),
  practitioner: z.string(),
  working: z.string(),
  /**
   * One shared site vocabulary with #1868. B accepts `hall` (life care) and
   * `parcel` (estate protection); `bindings` resolves the site's slots to the
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

export const MysticStateS = z.object({
  assignments: z.array(MysticAssignmentS),
  pauses: z.array(MysticStudyPauseS),
}).strict();
export type MysticState = z.infer<typeof MysticStateS>;
export const emptyMysticState = (): MysticState => ({ assignments: [], pauses: [] });
