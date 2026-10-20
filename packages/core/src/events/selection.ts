import type { Condition, EventTemplate, Frequency, Modifier } from '@ed/schema';
import { FREQUENCY_PROFILES, assertNever, canTemplateFire, eventInCampaign, frequencyWeight, templateRationAllows } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { evalCondition } from './conditions.js';
import { resolveSlots, type SlotFill } from './slots.js';
import type { Rng } from '../rng.js';
import { activeAgeIds } from '../ages/scheduler.js';

export interface Candidate {
  event: EventTemplate;
  fill: SlotFill;
  playerCast: string[];
  source: 'forced' | 'pressure' | 'ambient';
}

export type SelectionObservation = { readonly year: number } & (
  | { readonly kind: 'before_draw'; readonly budget: number; readonly forced: readonly string[] }
  | { readonly kind: 'before_frame' }
  | { readonly kind: 'frame_due'; readonly due: boolean }
  | { readonly kind: 'choice_offered'; readonly event: string; readonly choices: readonly string[] }
  | { readonly kind: 'before_arc_steps'; readonly layer?: 'tale' | 'frame' }
  | { readonly kind: 'cast_failure'; readonly event: string; readonly source: Candidate['source'] | 'arc' | 'frame'; readonly missing?: string }
  | { readonly kind: 'selected'; readonly candidates: readonly { readonly event: string; readonly source: Candidate['source'] | 'arc' | 'frame' }[] }
);

/**
 * SELECTION
 * =========
 * Three passes, in order:
 *
 *   1. FORCED   arc continuations that are due, scheduled follow-ups, and
 *               clause reveals owed by the current Age. These consume the
 *               generation's event budget before anything else is considered.
 *   2. PRESSURE state-driven demands — high discontent, madness near overflow,
 *               an open Discrepancy near proof. Weighted, but drawn from a pool
 *               that only exists because the family is in that state.
 *   3. AMBIENT  weighted random from everything eligible, gated by FREQUENCY.
 *
 * Eligibility is two-phase for cost. The condition prefilter is cheap and runs
 * over the whole pool; slot resolution is expensive and runs only on sampled
 * candidates. A candidate whose slots cannot fill is discarded and the sample
 * is redrawn.
 */
export function selectEvents(ctx: SimCtx, rng: Rng, budget: number): Candidate[] {
  // FORCED MEANS FORCED. These used to be truncated to the year's budget,
  // having already been removed from `world.scheduled` — so a year that came
  // due with two follow-ups fired one and dropped the other permanently, and
  // the only symptom was a scene that was scheduled and never arrived.
  const out: Candidate[] = forcedCandidates(ctx, rng);
  ctx.observeSelection?.({
    kind: 'before_draw', year: ctx.world.year, budget,
    forced: out.map((candidate) => String(candidate.event.id)),
  });

  // PRESSURE. Content gated on discontent, an angry branch, a grudge against
  // the house or an open Discrepancy only enters this pool because the
  // family is CURRENTLY in that state — drawn before ambient can spend the
  // year's one slot on something that merely happened to come up.
  const pressurePool = ambientPool(ctx).filter((e) => referencesPressureSignal(e.conditions));
  let pguard = 0;
  while (out.length < budget && pguard < 60) {
    pguard += 1;
    const remaining = pressurePool.filter((e) => !out.some((c) => c.event.id === e.id));
    if (!remaining.length) break;

    const chosen = drawOne(remaining, ctx, rng);
    if (!chosen) break;

    const res = resolveSlots(chosen, ctx, rng);
    if (!res.ok) {
      ctx.observeSelection?.({ kind: 'cast_failure', year: ctx.world.year, event: String(chosen.id), source: 'pressure', missing: res.missing });
      pressurePool.splice(pressurePool.indexOf(chosen), 1);
      continue;
    }
    out.push({ event: chosen, fill: res.fill, playerCast: res.playerCast, source: 'pressure' });
  }

  const pool = ambientPool(ctx);
  let guard = 0;
  // Forced candidates still CONSUME the year's budget, which is the original
  // intent — they simply are no longer discarded by it.
  while (out.length < budget && guard < 60) {
    guard += 1;
    const remaining = pool.filter((e) => !out.some((c) => c.event.id === e.id));
    if (!remaining.length) break;

    const chosen = drawOne(remaining, ctx, rng);
    if (!chosen) break;

    const res = resolveSlots(chosen, ctx, rng);
    if (!res.ok) {
      ctx.observeSelection?.({ kind: 'cast_failure', year: ctx.world.year, event: String(chosen.id), source: 'ambient', missing: res.missing });
      // Unfillable: discard and redraw. This is the single largest source of
      // between-run variety, so it must be cheap and it must be silent.
      pool.splice(pool.indexOf(chosen), 1);
      continue;
    }
    out.push({ event: chosen, fill: res.fill, playerCast: res.playerCast, source: 'ambient' });
  }

  ctx.observeSelection?.({
    kind: 'selected', year: ctx.world.year,
    candidates: out.map((candidate) => ({ event: String(candidate.event.id), source: candidate.source })),
  });
  return out;
}

/**
 * The signals that make a demand "state-driven" rather than a calendar or
 * history gate.
 *
 * `ascension` joined them for issue #41, and the omission was the reason
 * ladder content could not be authored into the game rather than merely into
 * the library. A house that has a man standing at Adept is in a state it was
 * not in last generation and will not be in after he dies — which is the
 * whole definition above — and the content that charges him for climbing was
 * measured at three firings in a thousand years while it sat in the ambient
 * pool behind two hundred templates about weather and pantry. The one
 * decision the fourth rung waits on cannot be a coin flip against the price
 * of cloth.
 *
 * Note what this cannot see: `{ ascension: { best: true } }` is a HIGH-WATER
 * MARK, which is history rather than state, and reads as pressure here all
 * the same. Nothing authored uses it yet. When something does, the fix is a
 * shape test rather than a name test.
 *
 * `bloodCount` joined for issue #132's Stage 2, the same reasoning as
 * `ascension` word for word: a house down to one or two of its own blood is
 * in a state it was not in a generation ago and, most of the time, will not
 * be in a generation from now — measured, the two events gated on it (both
 * common, weight 500) sat behind the ambient pool's several hundred other
 * common templates and fired in 2 of 14 windows where the condition held and
 * a candidate existed to cast. The one decision this issue exists to put on
 * the docket cannot be a coin flip against the price of cloth either.
 */
const PRESSURE_SIGNALS = [
  'discontent', 'branchGrievance', 'grudgeAgainstUs', 'discrepancy', 'openDiscrepancies', 'ascension', 'bloodCount',
] as const;

/** Walks `all`/`any`/`not` to ask whether a template's own conditions reference a pressure signal. */
function referencesPressureSignal(c: Condition | undefined): boolean {
  if (!c) return false;
  if ('all' in c) return c.all.some(referencesPressureSignal);
  if ('any' in c) return c.any.some(referencesPressureSignal);
  if ('not' in c) return referencesPressureSignal(c.not);
  return PRESSURE_SIGNALS.some((k) => k in c);
}

/** Everything that passes the cheap gates. Slots are NOT resolved here. */
export function ambientPool(ctx: SimCtx): EventTemplate[] {
  const active = activeAgeIds(ctx);
  return ctx.content.events.filter((event) => ambientExclusionReason(event, ctx, active) === undefined);
}

export type AmbientExclusion = 'campaign' | 'frame' | 'arc' | 'tier_cap' | 'template_ration' | 'age' | 'frequency' | 'condition';

/** The production prefilter's first refusal. An absent refusal means only
 * state eligibility: required slots and the weighted draw still lie ahead.
 * Diagnostic callers that inspect additional templates must use a private
 * context, so lazy genetic reads cannot change the saved representation. */
export function ambientExclusionReason(e: EventTemplate, ctx: SimCtx, active: readonly string[] = activeAgeIds(ctx)): AmbientExclusion | undefined {
  const w = ctx.world;
  if (!eventInCampaign(e, w.campaign)) return 'campaign';
  if (e.tier === 'frame') return 'frame';
  if (e.arc) return 'arc';                       // arc nodes fire via the arc
  if (!canTemplateFire(e.id, e.frequency, w.frequency)) return 'tier_cap';
  // The author's own ration, next to the tier's. See `templateRationAllows`.
  if (!templateRationAllows(e, w.frequency, w.year)) return 'template_ration';

  // Age scoping is a declarative field precisely so it can be checked first:
  // it is the cheapest possible prefilter and it skips whole buckets.
  if (e.ages?.only && !e.ages.only.some((a) => active.includes(a))) return 'age';
  if (e.ages?.never && e.ages.never.some((a) => active.includes(a))) return 'age';
  if (e.ages?.register) {
    const regs = active.map((a) => ctx.content.age(a)?.register);
    if (!e.ages.register.some((r) => regs.includes(r))) return 'age';
  }

  if (frequencyWeight(e.frequency, w.frequency, w.year, w.generation) <= 0) return 'frequency';
  if (!evalCondition(e.conditions, ctx)) return 'condition';
  return undefined;
}

/**
 * One weighted draw. `rng.weighted` asks for every weight twice, and nothing
 * moves between those two passes, so the household's presence modifiers are
 * read once per draw rather than once per template per pass — which is what
 * made a household scan the hottest loop in a batch run (#1641).
 */
function drawOne(pool: readonly EventTemplate[], ctx: SimCtx, rng: Rng): EventTemplate | undefined {
  const presence = presenceModifiers(ctx);
  return rng.weighted(pool, (e) => weightWith(e, ctx, presence));
}

/**
 * Final draw weight. Frequency is the heavy lifter; the per-template `weight`
 * is a nudge WITHIN its tier, not across tiers.
 */
export function drawWeight(e: EventTemplate, ctx: SimCtx): number {
  return weightWith(e, ctx, presenceModifiers(ctx));
}

function weightWith(e: EventTemplate, ctx: SimCtx, presence: readonly DrawModifier[]): number {
  const w = ctx.world;
  let weight = frequencyWeight(e.frequency, w.frequency, w.year, w.generation) * (e.weight / 100);

  // An Age's own scenes are the entire reason it has a name. Without this
  // boost, a twenty-year Age never shows the player anything specific to it.
  if (e.ages?.only?.length) weight *= AGE_EXCLUSIVE_BOOST;

  // Presence influence: traits held by living members reweight the pool.
  weight *= presenceMultiplier(e, presence);
  return weight;
}

export const AGE_EXCLUSIVE_BOOST = 4;

/** The two `Modifier` kinds that reach the draw. */
type DrawModifier = Extract<Modifier, { kind: 'suppress' | 'event_weight' }>;

/**
 * Presence influence on the draw: every draw-relevant modifier carried by a
 * trait of a living household member, in household order.
 *
 * `Modifier` was the one closed union in the game with no `assertNever`
 * consumer: this function used to be a pair of `if`s over `m.kind` with no
 * default and no compiler pressure at all. That is how six of the eight kinds
 * came to be declared in the schema, authored in `traits.yaml`, and read by
 * nothing — invariant 5 with the enforcement missing.
 *
 * Two kinds decide which event is DRAWN. The other six are listed anyway, and
 * that is the point of the switch: this is the only place the whole vocabulary
 * is visible at once, so a kind with no consumer is visible as a gap rather
 * than absent from a chain of `if`s. A ninth kind is now a compiler error here.
 */
function presenceModifiers(ctx: SimCtx): DrawModifier[] {
  const out: DrawModifier[] = [];
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);

  for (const p of household) {
    for (const tid of p.traits) {
      const trait = ctx.content.trait(tid);
      if (!trait) continue;
      for (const pres of trait.presence) {
        for (const m of pres.modifiers) {
          switch (m.kind) {
            case 'suppress':
            case 'event_weight':
              out.push(m);
              break;

            // Not about the draw — each of the other five now has its own
            // consumer elsewhere (issue #11): `unlock` in `evalCondition`'s
            // `unlocked` branch, `check_bonus` in `events/checks.ts`,
            // `outcome_weight` in `pickOutcome`, `attribute` in
            // `influencedAttr`, `resource` in `tickEconomy`. `reveal_signs`
            // stays unbuilt on purpose — no consumer until the record layer
            // exists to read it.
            case 'unlock':
            case 'check_bonus':
            case 'outcome_weight':
            case 'attribute':
            case 'resource':
            case 'reveal_signs':
              break;

            default:
              assertNever(m, 'modifier');
          }
        }
      }
    }
  }
  return out;
}

/** Applies `presenceModifiers` to one template, in the order they were read. */
function presenceMultiplier(e: EventTemplate, presence: readonly DrawModifier[]): number {
  let mult = 1;
  for (const m of presence) {
    switch (m.kind) {
      // A veto, not a weight. The trait closes the door on the tier.
      case 'suppress':
        if (matches(m.match, e)) return 0;
        break;

      case 'event_weight':
        if (matches(m.match, e)) {
          if (m.multiply !== undefined) mult *= m.multiply;
          if (m.add !== undefined) mult += m.add;
        }
        break;

      default:
        assertNever(m, 'modifier');
    }
  }
  return Math.max(0, mult);
}

function matches(match: { tags?: unknown[]; ids?: string[]; tier?: string[]; frequency?: string[] }, e: EventTemplate): boolean {
  if (match.ids?.length && !match.ids.includes(e.id)) return false;
  if (match.tier?.length && !match.tier.includes(e.tier)) return false;
  if (match.frequency?.length && !match.frequency.includes(e.frequency)) return false;
  if (match.tags?.length) {
    const tags = match.tags as string[];
    if (!tags.some((t) => e.tags.includes(t))) return false;
  }
  return true;
}

/** How long a scheduled event keeps waiting for a cast before giving up. */
const SCHEDULE_PATIENCE = 40;

function forcedCandidates(ctx: SimCtx, rng: Rng): Candidate[] {
  const w = ctx.world;
  const out: Candidate[] = [];

  for (const s of [...w.scheduled]) {
    if (s.year > w.year) continue;
    const e = ctx.content.event(s.event);
    w.scheduled = w.scheduled.filter((x) => x !== s);
    if (!e) continue;
    if (!eventInCampaign(e, w.campaign)) continue;

    // Scheduling guarantees that a promised scene is *considered*, not that a
    // one-shot scene may recur. The same template might already have fired
    // through ambient selection (or another schedule), so retire stale copies.
    // Multiple entries due together must not queue the same nonrepeatable scene.
    if (!e.repeatable && (
      (w.frequency.templateFires[e.id] ?? 0) > 0
      || out.some((candidate) => candidate.event.id === e.id)
    )) continue;

    // A schedule guarantees another opportunity, not permission to bypass the
    // author's conditions. In particular, a follow-up due in generation three
    // must not skip a declared fourth-generation gate. Preserve the pending
    // promise while its conditions or cast are unavailable.
    if (evalCondition(e.conditions, ctx)) {
      const res = resolveSlots(e, ctx, rng);
      if (res.ok) {
        out.push({ event: e, fill: res.fill, playerCast: res.playerCast, source: 'forced' });
        continue;
      }
      ctx.observeSelection?.({ kind: 'cast_failure', year: w.year, event: String(e.id), source: 'forced', missing: res.missing });
    }
    // Reconsider in five years, with the original due year as the patience
    // anchor so an unreachable event cannot be postponed indefinitely.
    const first = s.first ?? s.year;
    if (w.year - first < SCHEDULE_PATIENCE) w.scheduled.push({ event: s.event, year: w.year + 5, first });
  }

  return out;
}

/** Diagnostics for the editor: what does each tier actually look like? */
export function frequencyReport(ctx: SimCtx): Record<Frequency, { pool: number; fired: number; barred: boolean; weight: number }> {
  const w = ctx.world;
  const out = {} as Record<Frequency, { pool: number; fired: number; barred: boolean; weight: number }>;
  for (const f of Object.keys(FREQUENCY_PROFILES) as Frequency[]) {
    const weight = frequencyWeight(f, w.frequency, w.year, w.generation);
    out[f] = {
      pool: ctx.content.events.filter((e) => e.frequency === f).length,
      fired: w.frequency.firedThisRun[f],
      barred: weight <= 0,
      weight,
    };
  }
  return out;
}
