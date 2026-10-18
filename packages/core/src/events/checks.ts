import type {
  Check, ChronicleQuery, Choice, EventTemplate, Outcome, PoolSpec,
} from '@ed/schema';
import { assertNever, RESPECT_ORDER } from '@ed/schema';
import type { SimCtx, ChronicleEntry } from '../world.js';
import type { Rng } from '../rng.js';
import { pickOutcome } from './effects.js';
import { influencedAttr } from './influence.js';
import { knowsAffinity } from '../people/library.js';
import { castPeople, soleCast, type SlotFill } from './slots.js';

/**
 * CHECKS — one structure for all four challenge tiers (concept §21, issue #10).
 *
 * `CheckS` and `PoolSpecS` were declared, referenced by `Choice.check`, and
 * evaluated nowhere: a choice carrying a check resolved by outcome weight
 * exactly as if it had none, and nothing said so. This is that evaluator.
 *
 * A check reduces to three questions, asked in order:
 *   1. `poolScore`   — what can the family bring to this?
 *   2. `evalDifficulty` — what does the world demand?
 *   3. `evalCheck`   — roll the pool against the difficulty (variance is a
 *      Box-Muller draw centred on the pool score) and pick the band the
 *      margin clears.
 */

// ── The pool: what the family can bring ─────────────────────────────────────

/**
 * `event` is optional and used only to look up a named slot's cast ROLE, so
 * an `attribute` modifier's `slot` target (issue #11) can apply — a trait
 * that only strengthens someone once they are actually cast into a part.
 * Every other target (`self`, `household`, `children`) needs no role at all.
 */
export function poolScore(ctx: SimCtx, spec: PoolSpec, fill: SlotFill, event?: EventTemplate): number {
  const w = ctx.world;
  switch (spec.kind) {
    case 'family_knows':
      return w.people.household(w.playerHouse, w.year)
        .some((p) => knowsAffinity(ctx, p, spec.affinity)) ? 1 : 0;
    case 'slot': {
      const p = w.people.get(soleCast(fill, spec.slot) ?? '');
      if (!p) return 0;
      const role = event?.slots[spec.slot]?.role;
      return spec.attrs.reduce((sum, a) => sum + influencedAttr(ctx, p, a.attr, role) * a.weight, 0);
    }
    /**
     * Every man in every named slot. A counted slot contributes its WHOLE
     * party here — which is the point of counting one, and the reason three
     * shipped events had to declare `SENT_A/B/C` by hand to sum a party of
     * three (issue #90).
     */
    case 'party_sum': {
      return spec.slots.reduce((sum, slotId) => {
        const role = event?.slots[slotId]?.role;
        return castPeople(fill, slotId, ctx)
          .reduce((acc, p) => acc + influencedAttr(ctx, p, spec.attr, role), sum);
      }, 0);
    }
    case 'family_sum': {
      const roster = w.people.household(w.playerHouse, w.year);
      return roster.reduce((sum, p) => sum + influencedAttr(ctx, p, spec.attr), 0);
    }
    case 'family_max': {
      const roster = w.people.household(w.playerHouse, w.year);
      return roster.reduce((m, p) => Math.max(m, influencedAttr(ctx, p, spec.attr)), 0);
    }
    // The anti-specialisation check: forty generations chasing Death, and
    // then a fire, and nobody can call water. 1 if anyone clears the bar, 0
    // if not — the pass/fail shape a `family_any` check is calibrated for.
    case 'family_any': {
      const roster = w.people.household(w.playerHouse, w.year);
      return roster.some((p) => influencedAttr(ctx, p, spec.attr) >= spec.atLeast) ? 1 : 0;
    }
    case 'record':
      return chronicleScore(ctx, spec.against);
    default:
      return assertNever(spec, 'pool spec');
  }
}

/** Does one chronicle entry match a `ChronicleQuery`? */
function matchesQuery(ctx: SimCtx, c: ChronicleEntry, q: ChronicleQuery): boolean {
  if (q.eventId !== undefined && c.eventId !== q.eventId) return false;
  if (q.eventTag !== undefined) {
    const tags = c.eventId ? ctx.content.event(c.eventId)?.tags ?? [] : [];
    if (!tags.includes(q.eventTag)) return false;
  }
  if (q.record !== undefined && c.record !== q.record) return false;
  if (q.greyed !== undefined && Boolean(c.greyed) !== q.greyed) return false;
  if (q.discrepancyState !== undefined) {
    const d = c.discrepancyId ? ctx.world.discrepancies.get(c.discrepancyId) : undefined;
    if (d?.state !== q.discrepancyState) return false;
  }
  if (q.hasClaim !== undefined) {
    const claims = c.claims ?? [];
    const found = claims.some((claim) => {
      if (claim.kind !== q.hasClaim!.kind) return false;
      if (q.hasClaim!.attr !== undefined && (claim.kind !== 'attr' || claim.attr !== q.hasClaim!.attr)) return false;
      if (q.hasClaim!.trait !== undefined && (claim.kind !== 'trait' || claim.trait !== q.hasClaim!.trait)) return false;
      return true;
    });
    if (!found) return false;
  }
  return true;
}

/**
 * A Record challenge is resolved against the chronicle rather than against a
 * person: an archivist requests the family's papers, a rival produces a
 * page, a Church inquest compares your account of 1341 with three others.
 */
function chronicleScore(ctx: SimCtx, q: ChronicleQuery): number {
  const w = ctx.world;
  const cutoff = q.withinYears !== undefined ? w.year - q.withinYears : -Infinity;
  const considered = w.chronicle.filter((c) => c.year >= cutoff);
  const matched = considered.filter((c) => matchesQuery(ctx, c, q));
  if (q.measure === 'ratio') return considered.length ? matched.length / considered.length : 0;
  return matched.length;
}

// ── check_bonus: the dispatch half of the influence system (issue #11) ─────

function matchesCheckBonus(match: { tags?: string[]; id?: string }, check: Check, event: EventTemplate): boolean {
  if (match.id !== undefined) return match.id === check.id;
  if (match.tags?.length) return match.tags.some((t) => event.tags.includes(t));
  return true;
}

/**
 * A trait's `dispatch` modifiers apply only once the person carrying them
 * was actually CAST into a matching role — `whenCastAs` — which is why this
 * reads the event's own slot definition rather than the person directly.
 * Only meaningful for a `slot` pool: nothing else in a check is "one person
 * cast into one role".
 */
function checkBonus(ctx: SimCtx, check: Check, event: EventTemplate, fill: SlotFill): number {
  if (check.pool.kind !== 'slot') return 0;
  const role = event.slots[check.pool.slot]?.role;
  const person = ctx.world.people.get(soleCast(fill, check.pool.slot) ?? '');
  if (!role || !person) return 0;

  let bonus = 0;
  for (const tid of person.traits) {
    const trait = ctx.content.trait(tid);
    if (!trait) continue;
    for (const dispatch of trait.dispatch) {
      if (!dispatch.whenCastAs?.includes(role)) continue;
      for (const m of dispatch.modifiers) {
        if (m.kind === 'check_bonus' && matchesCheckBonus(m.match, check, event)) bonus += m.delta;
      }
    }
  }
  return bonus;
}

// ── Difficulty: a number, or one that moves with the world ─────────────────

export function evalDifficulty(ctx: SimCtx, difficulty: Check['difficulty']): number {
  if (typeof difficulty === 'number') return difficulty;
  const w = ctx.world;
  let total = difficulty.base;
  if (difficulty.perActiveAge) {
    for (const a of w.age.active) total += difficulty.perActiveAge[a.age] ?? 0;
  }
  if (difficulty.perRespectTier) total += RESPECT_ORDER.indexOf(w.respect) * difficulty.perRespectTier;
  if (difficulty.perCentury) total += Math.floor((w.year - 1042) / 100) * difficulty.perCentury;
  return total;
}

// ── The roll ─────────────────────────────────────────────────────────────

const VARIANCE_SD: Record<Check['variance'], number> = { none: 0, narrow: 8, wide: 20 };

export interface CheckResult {
  score: number;
  bonus: number;
  difficulty: number;
  roll: number;
  outcomeId: string;
}

/** The deterministic inputs to a check, shared with read-only instruments. */
export function checkReading(ctx: SimCtx, check: Check, event: EventTemplate, fill: SlotFill): Pick<CheckResult, 'score' | 'bonus' | 'difficulty'> {
  return { score: poolScore(ctx, check.pool, fill, event),
    bonus: checkBonus(ctx, check, event, fill), difficulty: evalDifficulty(ctx, check.difficulty) };
}

/**
 * The pool becomes a roll (variance is a `rng.normal` draw centred on the
 * score; `none` skips the draw entirely, so a `family_any` pass/fail check
 * is not left to jitter it across the line), and the margin over difficulty
 * picks a band. Bands are meant to be authored highest-`atLeast`-first, and
 * the sort here is defensive rather than load-bearing — `checks/bands`
 * validates the authored order so this never has to matter in practice.
 */
export function evalCheck(ctx: SimCtx, check: Check, event: EventTemplate, fill: SlotFill, rng: Rng): CheckResult {
  const { score, bonus, difficulty } = checkReading(ctx, check, event, fill);
  const sd = VARIANCE_SD[check.variance];
  const roll = sd > 0 ? rng.normal(score + bonus, sd) : score + bonus;
  const margin = roll - difficulty;

  const sorted = [...check.bands].sort((a, b) => b.atLeast - a.atLeast);
  const band = sorted.find((b) => margin >= b.atLeast) ?? sorted[sorted.length - 1];
  return { score, bonus, difficulty, roll, outcomeId: band!.outcome };
}

/**
 * The single point where a Choice's outcome is chosen — checked or not.
 * `resolveChoice` and `present` both come through here, the same discipline
 * `commitOutcome` holds for applying one (invariant 9).
 */
export function resolveChoiceOutcome(
  ctx: SimCtx,
  event: EventTemplate,
  choice: Choice,
  fill: SlotFill,
  rng: Rng,
): Outcome {
  const check = choice.check ? event.checks.find((c) => c.id === choice.check) : undefined;
  if (!check) return pickOutcome(choice.outcomes, rng, ctx, event);

  const result = evalCheck(ctx, check, event, fill, rng);
  return choice.outcomes.find((o) => o.id === result.outcomeId) ?? pickOutcome(choice.outcomes, rng, ctx, event);
}
