import { MAIN_BRANCH, type Grudge, type Person, type Relationship } from '@ed/schema';
import type { SimCtx } from './world.js';
import { HOUSEHOLD_THREAT_COOLDOWN, HOUSEHOLD_THREAT_FAMILY, HOUSEHOLD_THREAT_SEVERITY,
  householdThreatCandidates, threatExclusion, type ThreatStage } from './covert-lifecycle.js';
import { COVERT_OPERATION_COOLDOWN, COVERT_OPERATION_SEVERITY, covertOpportunities, operationExclusion,
  type OperationStage } from './covert-operations.js';
import { isCurrentFamily } from './presence.js';
import { branchOf } from './people/branches.js';

/**
 * WHY NOBODY ATTACKS ANYBODY (#1943). A read-only funnel over the two covert
 * directions, counted with the PRODUCTION predicates — the candidate and
 * opportunity functions report each relationship's first failing rule through
 * their `tally`, and this file only adds up what they say. A second copy of
 * either filter here would be a second set of rules, and the first thing it
 * would explain is itself.
 *
 * One sample is one year. Every count is relationship-years or grudge-years,
 * so a single feud held for a century is a hundred rows, not one. Only
 * relationships carrying a grudge are staged; sentiment alone motivates nothing.
 */

/** Who wrote a grudge, from its `originEvent`. An unknown origin is an authored event. */
export type GrudgeWriter = 'prologue' | 'rent' | 'assize' | 'hall_quarrel' | 'service_promise'
  | 'marriage_pledge' | 'answer_attack' | 'operation_exposed' | 'authored';

export function grudgeWriter(ctx: SimCtx, g: Grudge): GrudgeWriter {
  const o = g.originEvent;
  if (o === ctx.content.prologue?.id) return 'prologue';
  if (o.startsWith('rents_')) return 'rent';
  if (o === 'a_retainer_courted_away' || o === 'a_ward_is_requested' || o === 'an_older_claim') return 'assize';
  if (o === 'grievance') return 'hall_quarrel';
  if (o === 'mystic_service_promise') return 'service_promise';
  if (o === 'auction_marriage_pledge') return 'marriage_pledge';
  if (o === 'covert_household_attempt') return 'answer_attack';
  if (o === 'covert_operation_attempt') return 'operation_exposed';
  return 'authored';
}

/** Which way a relationship points, as the two covert directions read it. */
export type Direction = 'incoming' | 'outgoing' | 'internal' | 'elsewhere';
/** What the far end of a relationship is, from the player house's side. */
export type EndRole = 'house' | 'guardian' | 'head' | 'family' | 'outsider' | 'gone';

type Row = { grudgeYears: number; incomingLive: number; outgoingLive: number; peak: number };
type Tally<K extends string> = Partial<Record<K, number>>;

export type CovertExposure = {
  years: number;
  /** Grudge-years by `writer:direction:target role`. `incomingLive` counts years at ≥ 60, `outgoingLive` at ≥ 40. */
  grudges: Record<string, Row>;
  incoming: {
    smallFamilyYears: number;
    /** Incoming relationship-years by the first rule they fail. */
    stages: Tally<ThreatStage>;
    /** Of `no_target`, what the target was. */
    noTarget: Tally<string>;
    candidateYears: number;
    /** Candidate years spent waiting on an open plot or the cooldown. */
    blockedYears: number;
    /** Candidate years the 8% roll could actually be drawn in. */
    rollYears: number;
  };
  outgoing: {
    stages: Tally<OperationStage>;
    noTarget: Tally<string>;
    opportunityYears: number;
    /** Opportunity years blocked by an open expedition or the cooldown. */
    blockedYears: number;
  };
};

export function createCovertExposure(): CovertExposure {
  return {
    years: 0, grudges: {},
    incoming: { smallFamilyYears: 0, stages: {}, noTarget: {}, candidateYears: 0, blockedYears: 0, rollYears: 0 },
    outgoing: { stages: {}, noTarget: {}, opportunityYears: 0, blockedYears: 0 },
  };
}

const bump = <K extends string>(t: Tally<K>, k: K) => { t[k] = (t[k] ?? 0) + 1; };

function ours(ctx: SimCtx, id: string): Person | 'house' | undefined {
  if (id === ctx.world.playerHouse) return 'house';
  const p = ctx.world.people.get(id);
  return p && (p.status === 'guardian' || p.status === 'alive' && isCurrentFamily(ctx, p)) ? p : undefined;
}

function role(ctx: SimCtx, id: string): EndRole {
  const mine = ours(ctx, id);
  if (mine === 'house') return 'house';
  // The living founder sits in the chair; only the dead one is the guardian.
  if (mine) return mine.status === 'guardian' ? 'guardian' : mine.castSlots.includes('head') ? 'head' : 'family';
  if (ctx.world.houses.has(id)) return 'house';
  const p = ctx.world.people.get(id);
  return p?.status === 'alive' ? 'outsider' : 'gone';
}

export function directionOf(ctx: SimCtx, r: Relationship): Direction {
  const from = ours(ctx, r.from) !== undefined, to = ours(ctx, r.to) !== undefined;
  return from && to ? 'internal' : to ? 'incoming' : from ? 'outgoing' : 'elsewhere';
}

/** Why an incoming relationship found nobody to attack: the rule its `to` fails. */
function incomingMiss(ctx: SimCtx, r: Relationship, family: Person[]): string {
  const end = ours(ctx, r.to);
  if (end === 'house') return family.some(p => !threatExclusion(ctx, p)) ? 'house:unmatched' : 'house:nobody_eligible';
  // A grudge against the seat reaches the main hall, so its miss is the hall's, not the
  // chair's. `unreached` means somebody there was eligible and the rule did not let it reach.
  if (end && (end.status === 'guardian' || end.becomesGuardian || end.castSlots.includes('head'))) {
    return family.some(p => p.id !== end.id && !threatExclusion(ctx, p) && branchOf(ctx.world, p, ctx.world.year) === MAIN_BRANCH)
      ? 'seat:unreached' : 'seat:nobody_eligible';
  }
  return end ? threatExclusion(ctx, end) ?? 'unmatched' : 'gone';
}

function outgoingMiss(ctx: SimCtx, r: Relationship): string {
  if (ctx.world.houses.has(r.to)) return 'house:nobody_known';
  const p = ctx.world.people.get(r.to);
  if (!p || p.status !== 'alive') return 'gone';
  return operationExclusion(ctx, p) ?? 'unmatched';
}

/** One year's look, taken after the year has run. Reads only; the observer-neutrality
 * test holds it to that. The plot and cooldown are judged for the year about to be
 * drawn (`w.year + 1`), which is the roll this state decides. Judged for the year just
 * ended, they miscounted the year each cooldown runs out. Keyed this way, every draw
 * under 8% in 266 roll-years became a preparation, and no preparation fell outside them. */
export function sampleCovertExposure(ctx: SimCtx, f: CovertExposure): void {
  const w = ctx.world;
  f.years++;

  for (const r of w.relationships.values()) {
    const direction = directionOf(ctx, r);
    if (direction === 'elsewhere') continue;
    const target = role(ctx, r.to);
    for (const g of r.grudges) {
      if (g.originYear > w.year) continue;
      const row = f.grudges[`${grudgeWriter(ctx, g)}:${direction}:${target}`] ??= { grudgeYears: 0, incomingLive: 0, outgoingLive: 0, peak: 0 };
      row.grudgeYears++;
      if (g.severity >= HOUSEHOLD_THREAT_SEVERITY) row.incomingLive++;
      if (g.severity >= COVERT_OPERATION_SEVERITY) row.outgoingLive++;
      row.peak = Math.max(row.peak, Math.round(g.severity));
    }
  }

  const family = w.people.household(w.playerHouse, w.year).filter(p => isCurrentFamily(ctx, p));
  if (family.length < HOUSEHOLD_THREAT_FAMILY) f.incoming.smallFamilyYears++;
  const held = (r: Relationship) => r.grudges.some(g => g.originYear <= w.year);
  const threats = householdThreatCandidates(ctx, (r, stage) => {
    if (!held(r) || directionOf(ctx, r) !== 'incoming') return;
    bump(f.incoming.stages, stage);
    if (stage === 'no_target') bump(f.incoming.noTarget, incomingMiss(ctx, r, family));
  });
  if (threats.length) {
    f.incoming.candidateYears++;
    const open = w.covert.threats.some(t => t.stage === 'preparing' || t.stage === 'approach');
    const last = w.covert.threats.at(-1)?.plan.preparedAt ?? -Infinity;
    if (open || w.year + 1 - last < HOUSEHOLD_THREAT_COOLDOWN) f.incoming.blockedYears++;
    else f.incoming.rollYears++;
  }

  const operations = covertOpportunities(ctx, (r, stage) => {
    if (!held(r)) return;
    bump(f.outgoing.stages, stage);
    if (stage === 'no_target') bump(f.outgoing.noTarget, outgoingMiss(ctx, r));
  });
  if (operations.length) {
    f.outgoing.opportunityYears++;
    const open = w.covert.operations.some(o => o.stage !== 'closed');
    const last = w.covert.operations.at(-1)?.plan.preparedAt ?? -Infinity;
    if (open || w.year + 1 - last < COVERT_OPERATION_COOLDOWN) f.outgoing.blockedYears++;
  }
}
