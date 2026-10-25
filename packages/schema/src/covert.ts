import { z } from 'zod';
import { SceneSiteS } from './primordial.js';
import { SlotFillS } from './slot-fill.js';
import { MysticServiceS } from './mystic.js';

/**
 * #1914 / #1875: the incident resolver's input, not saved threat state or a
 * player command. The later threat lifecycle must mint the id, pay the quote,
 * retain the preparation and commit the result through the event path.
 * There is deliberately no annual attack generator in this contract.
 */
export const CovertPreparationS = z.enum(['hasty', 'careful']);
export type CovertPreparation = z.infer<typeof CovertPreparationS>;

export const CovertAttemptS = z.object({
  id: z.string().min(1),
  /** A living stored person with an actual directed grievance. */
  sponsor: z.string().min(1),
  operative: z.string().min(1),
  target: z.string().min(1),
  motive: z.object({ kind: z.literal('grudge'), grudge: z.string().min(1) }).strict(),
  /** Explicit attendance uses the same site and bindings as ordinary events. */
  site: SceneSiteS,
  bindings: SlotFillS,
  preparation: CovertPreparationS,
  preparedAt: z.number().int().finite(),
  attemptYear: z.number().int().finite(),
  /** A trusted payment receipt, supplied by the lifecycle after spending. */
  paidCrowns: z.number().finite().nonnegative(),
}).strict();
export type CovertAttempt = z.infer<typeof CovertAttemptS>;

export const CovertResponseS = z.enum(['ordinary', 'safe_lodging', 'escort']);
export type CovertResponse = z.infer<typeof CovertResponseS>;

export const COVERT_GUARD_LIMIT = 3;
export const CovertGuardCountS = z.number().finite().int().min(0).max(COVERT_GUARD_LIMIT);

export const CovertDefenceS = z.object({
  /** At most three named, present, adult household guards; duplicates are invalid. */
  guards: z.array(z.string().min(1)).max(COVERT_GUARD_LIMIT),
  response: CovertResponseS,
  /** Total paid for this incident, including its watch. A response pays only the outstanding difference. */
  paidCrowns: z.number().finite().nonnegative(),
}).strict();
export type CovertDefence = z.infer<typeof CovertDefenceS>;

/** Separate stage draws permit same-roll counterplay and branch-independent RNG. */
const draw = z.number().finite().min(0).lt(1);
export const CovertDrawsS = z.object({
  warning: draw, prevention: draw, strike: draw, survival: draw, escape: draw, evidence: draw,
}).strict();
export type CovertDraws = z.infer<typeof CovertDrawsS>;

export const CovertRefusalS = z.enum([
  'malformed', 'not_due', 'unprepared', 'unpaid', 'invalid_sponsor',
  'invalid_operative', 'invalid_target', 'no_motive', 'no_opportunity',
  'invalid_guard', 'no_warning', 'wrong_place',
]);
export type CovertRefusal = z.infer<typeof CovertRefusalS>;

/** Public projections omit the sponsor, hidden odds and undiscovered evidence. */
export const CovertWarningS = z.object({
  occurrence: z.string(), year: z.number(), target: z.string(),
  trace: z.literal('observed_approach'),
}).strict();
export type CovertWarning = z.infer<typeof CovertWarningS>;

export const CovertObservationS = z.object({
  occurrence: z.string(), year: z.number(), target: z.string(),
  result: z.enum(['prevented', 'missed', 'wounded', 'dead']),
  /** Identifying an operative is not identifying their sponsor. */
  identifiedOperative: z.string().optional(),
  witnesses: z.array(z.string()),
  capturedOperative: z.string().optional(),
}).strict();
export type CovertObservation = z.infer<typeof CovertObservationS>;

/** A paid, staged incident. Secrets stay here, outside the public Table view. */
export const HouseholdThreatS = z.object({
  plan: CovertAttemptS,
  stage: z.enum(['preparing', 'approach', 'resolved', 'cancelled']),
  defence: CovertDefenceS,
  warned: z.boolean(),
  observation: CovertObservationS.optional(),
  /** Frozen rendered text is history; changing prose preference does not rewrite it. */
  receipt: z.string().optional(),
  page: z.string().optional(),
  closedAt: z.number().int().optional(),
  /** True only while the intruder is still actually held. */
  prisoner: z.string().optional(),
}).strict();
export type HouseholdThreat = z.infer<typeof HouseholdThreatS>;
export const CovertPurposeS = z.enum(['settle_grudge', 'answer_attack']);
export type CovertPurpose = z.infer<typeof CovertPurposeS>;

/** A copied statement may outlive its witness. It identifies an operative,
 * not an omniscient account of who privately ordered the act. */
export const CovertExposureS = z.object({
  year: z.number().int(), actor: z.string(), witnesses: z.array(z.string()),
  basis: z.enum(['capture', 'testimony']),
  heardAt: z.number().int().optional(),
  receipt: z.string().optional(),
}).strict();

export const CovertOperationS = z.object({
  /** A specific known grievance/access opportunity is consumed once. */
  opportunity: z.string().min(1),
  targetHouse: z.string(), targetMembershipFrom: z.number(),
  purpose: CovertPurposeS,
  plan: CovertAttemptS,
  stage: z.enum(['preparing', 'approach', 'returning', 'closed']),
  defence: CovertDefenceS,
  enemyWarned: z.boolean(),
  /** Named people remain with the journey even after setting down a working. */
  crew: z.array(z.string()),
  supportService: z.array(z.object({
    id: z.string(), practitioner: z.string(), working: z.string(), ended: z.number(), service: MysticServiceS,
  }).strict()),
  returnsAt: z.number().int().optional(),
  resolvedAt: z.number().int().optional(),
  result: z.enum(['success', 'partial', 'failed', 'withdrawn', 'cancelled']).optional(),
  operativeFate: z.enum(['escaped', 'captured', 'rescued', 'injured']).optional(),
  observation: CovertObservationS.optional(),
  exposure: CovertExposureS.optional(),
  /** Rendered accounts are saved artefacts, never translated again on load. */
  receipt: z.string().optional(), page: z.string().optional(),
}).strict();
export type CovertOperation = z.infer<typeof CovertOperationS>;
export const CovertStateS = z.object({
  threats: z.array(HouseholdThreatS),
  operations: z.array(CovertOperationS).default([]),
}).strict();
export type CovertState = z.infer<typeof CovertStateS>;
export const emptyCovertState = (): CovertState => ({ threats: [], operations: [] });
