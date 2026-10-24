import { z } from 'zod';
import { MysticServiceS } from './mystic.js';

/**
 * THE MUSTER (concept §6, world §10; issue #89, Stage 2 — #95).
 *
 * War exists in this game as texture: the Wars Age is a hazard process, the
 * `military` career is a bought commission, and `the_levy_in_earnest` says
 * "eleven men" as prose — there are no eleven men, and nothing in
 * `WorldState` knows the house has anyone in a field anywhere. Stage 1 (#92)
 * proved the fiction with an arc and five events and NO state of its own —
 * `arc_flag`s only — and found that the beats which most want a system
 * underneath them are exactly the ones a content-only stage cannot write:
 * `the_position_offered` prices a fiction nothing later reads, and
 * `the_withdrawal` is a scene rather than a standing choice.
 *
 * This is the state that makes both true. THE THESIS: *the house that bled
 * and the house that is remembered for bleeding are two separate
 * purchases.* Men are spent in the field (`men`, `from`) — Credit is earned
 * by the position the house bought (`position`, `credit`) — and a house can
 * do one without the other.
 *
 * `men` ARE ABSTRACT TENANTRY, never `Person` records. Minting eleven
 * tenants per levy across forty generations puts thousands of rows in the
 * store for a game whose people are the family, not the parish, and it
 * never goes near `people/minting.ts`. `officers` are the real family, cast
 * by the player (`who_leads_them`'s `OFFICER` slot) — they are the only
 * part of a commitment that is a `Person`.
 */
export const CommitmentStatusS = z.enum(['in_the_field', 'settled', 'withdrawn']);
export type CommitmentStatus = z.infer<typeof CommitmentStatusS>;

export const CommitmentS = z.object({
  /** Counter-generated, off `counters.muster` — the same shape every instance id in this codebase takes. */
  id: z.string(),
  began: z.number(),
  /** The Wars instance this commitment belongs to (`ActiveAge.age`). */
  age: z.string(),
  men: z.number(),
  /** Which hall supplied how many — the branch that lost them and did not get their officer back feels it as grievance. */
  from: z.record(z.string(), z.number()),
  /** Real family, cast by the player. Never emptied on death — a dead officer stays named on the commitment that sent him. */
  officers: z.array(z.string()),
  /** Bought, or not — `positions.yaml` is Stage 3's (#97). */
  position: z.string().optional(),
  /** Accrues yearly; spent — or not — at settlement. */
  credit: z.number(),
  status: CommitmentStatusS,
  /** Bound when field practice first needs an actual opposing house. */
  opponent: z.string().optional(),
  /** Returned/disabled duties keep their paid service in this commitment's account. */
  fieldService: z.array(z.object({
    practitioner: z.string(), working: z.string(), service: MysticServiceS,
    ended: z.number(), fate: z.enum(['returned', 'captured', 'dead', 'departed']),
  }).strict()).optional(),
});
export type Commitment = z.infer<typeof CommitmentS>;

export interface MusterState {
  commitments: Commitment[];
  /**
   * 0-100, a slow yearly walk. How the war is going, and the one piece of
   * this state that is NOT per-commitment: it is the Wars instance's own
   * fortune, read by whichever commitment is active and unaffected by how
   * many the house has run before it.
   */
  tide: number;
  lastSettled?: number;
}

/** Starts at the middle of the walk — a house has heard nothing yet, for or against. */
export const MUSTER_TIDE_START = 50;

export function emptyMusterState(): MusterState {
  return { commitments: [], tide: MUSTER_TIDE_START };
}

/**
 * THE ESCALATION LEVER (issue #95 comment, 2026-09-07): "the Crown asks more
 * of a house that has come before." Each SETTLED commitment raises what the
 * next one asks — more men, a harder field — because the record that
 * remembers is the Roll of Houses (world §10), a written one, not anybody's
 * institutional memory across the ~250-year median gap between Wars (#90).
 *
 * DERIVED, NEVER STORED (invariant 6). `maxConcurrentInstances: 1` on the
 * arc means at most one commitment is ever `in_the_field`, so at the moment
 * ANY commitment begins, every other one already carries its final status —
 * "settled so far" and "settled before this one, specifically" are the same
 * count, and reading the whole list fresh is exactly as correct as reading
 * a value cached at open time would have been, with nothing to keep in sync.
 *
 * WITHDRAWN does not count. Forfeiting the credit is the whole point of the
 * good decision (#89) — a house that pulled out did not finish what the
 * Crown is measuring, so it does not raise the ask for the next one either.
 *
 * A pure function of the settled count. No RNG, no other world read — so
 * a non-committing run's digest cannot move because of it, and a test can
 * assert it at 0, 1 and 6 prior commitments without building a world at all.
 */
export const MUSTER_ESCALATION_STEP = 0.12;

export function musterEscalation(settledCommitments: number): number {
  return (1 + MUSTER_ESCALATION_STEP) ** settledCommitments;
}
