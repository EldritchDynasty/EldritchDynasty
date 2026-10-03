import type { EventTemplate, FrameEntry, FrameRead } from '@ed/schema';
import { assertNever } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { evalCondition } from './conditions.js';
import { autoCast, renderBody, resolveSlots } from './slots.js';
import { pickOutcome } from './effects.js';
import { proseForOutcome } from '../prose.js';

/**
 * THE FRAME (concept §2, Layer 1; issue #13).
 *
 * Everything else in a year draws from `ambientPool` and answers to the
 * shared Frequency ledger. The frame does neither: it is filtered out of
 * `ambientPool` on the first line, and every gate after that line assumes an
 * ambient event, so this module is the frame's own small, separate copy of
 * "what can fire, and did it."
 *
 *   framePool    everything currently eligible: tier `frame`, not fired yet,
 *                every declared `reads` currently true — a named Discrepancy
 *                in a given state, read straight off `world.discrepancies`,
 *                or a page one named event left in `world.chronicle`.
 *   frameDue     the cadence — "every third or fourth generation" as a
 *                minimum gap plus a yearly roll, not a Frequency tier shared
 *                with anything ambient (invariant 7's shape: rationing that
 *                shares a ledger with an unrelated system steals from it).
 *   selectFrame  due, and something in the pool — the two checked together,
 *                because a due year with an empty pool is not a firing.
 *   presentFrame resolves the two listener slots, picks an outcome the same
 *                way ambient narration does, and writes the interlude to
 *                `world.frame.entries` — NOT `world.chronicle`. The frame is
 *                1542 reacting to the record; it is not part of the record.
 */

/**
 * No two interludes closer than this.
 *
 * Raised from 28 with the ceiling below. The pair of them are now the whole
 * cadence and they are set together: at 28 and a 0.16 roll the frame cut
 * roughly every thirty-eight years once it could no longer starve, which is
 * nearly twice what §5 asks for. A generation is about twenty-seven years and
 * §5 wants "every third or fourth", so the expected gap wants to be around
 * sixty and the worst case around a hundred.
 */
export const FRAME_MIN_GAP_YEARS = 45;

/** Rolled once per eligible year, once the minimum gap has passed. */
export const FRAME_CHANCE_PER_YEAR = 0.07;

/**
 * AND NO GAP LONGER THAN THIS. The cadence was a minimum plus a yearly roll,
 * which is a floor on how OFTEN the frame may cut and no ceiling at all on how
 * long it may go silent.
 *
 * Measured across four runs of one build, driven through the docket as a
 * player would answer it: 2, 13, 15 and 3 interludes. Two of those players get
 * essentially no frame — no creditor, no rising dread in the present, and no
 * reason for the last night to land on anything. The frame is the promise the
 * whole tale is read against (§2), and a promise delivered on a coin flip is
 * not one.
 *
 * §5 asks for "every third or fourth generation". A generation is about
 * twenty-seven years, so four of them is the point at which the frame is
 * overdue and cuts regardless of the roll.
 */
export const FRAME_MAX_GAP_YEARS = 108;

/**
 * Does one `reads` entry hold? Reuses `evalCondition`'s own `discrepancy`
 * branch rather than a second copy of it — a read is exactly that condition,
 * just asked from a different tier for a different reason.
 */
function readHolds(ctx: SimCtx, r: FrameRead): boolean {
  const w = ctx.world;
  if ('discrepancy' in r) {
    return evalCondition(
      { discrepancy: r.discrepancy, ...(r.state !== undefined ? { state: r.state } : {}) },
      ctx,
    );
  }
  if ('anyDiscrepancy' in r) {
    const want = r.anyDiscrepancy.state;
    const n = [...w.discrepancies.values()]
      .filter((d) => want === undefined || d.state === want).length;
    return n >= r.anyDiscrepancy.atLeast;
  }
  if ('recorded' in r) {
    return w.decisionLog.filter((d) => d.kind === 'record' && d.option === 'record').length
      >= r.recorded.atLeast;
  }
  if ('chronicled' in r) {
    // The entry survives every Record option — `applyRecord` rewrites what the
    // page SAYS and never removes it, so an omission is a dated blank with the
    // event id still on it. That is the point: the guardian reads the blank.
    return w.chronicle.some((c) => c.eventId === r.chronicled);
  }
  if ('omitted' in r) {
    return w.decisionLog.filter((d) => d.kind === 'record' && d.option === 'omit').length
      >= r.omitted.atLeast;
  }
  return assertNever(r);
}

/**
 * Everything a frame event's own `reads` currently allows, and not shown too
 * recently. `repeatable` and `cooldownYears` get their first real reader
 * here — most interludes are one specific beat (`repeatable: false`); a few
 * are written to return for as long as the thing they react to stays true,
 * on their own cooldown, same as a rare ambient event's.
 */
export function framePool(ctx: SimCtx): EventTemplate[] {
  const w = ctx.world;
  return ctx.content.events.filter((e) => {
    if (e.tier !== 'frame') return false;
    const last = w.frame.firedAt[e.id];
    if (last !== undefined) {
      if (!e.repeatable) return false;
      if (w.year - last < e.cooldownYears) return false;
    }
    return e.reads.every((r) => readHolds(ctx, r));
  });
}

/** The cadence check alone, with no regard to what is actually in the pool. */
export function frameDue(ctx: SimCtx, rng: Rng): boolean {
  const w = ctx.world;
  const since = w.year - (w.frame.lastFired ?? w.assize.openedAt);
  if (w.frame.lastFired !== null && since < FRAME_MIN_GAP_YEARS) return false;
  if (since >= FRAME_MAX_GAP_YEARS) return true;
  return rng.next() < FRAME_CHANCE_PER_YEAR;
}

/** Whether the frame has been silent long enough to take what it can get. */
export function frameOverdue(ctx: SimCtx): boolean {
  const w = ctx.world;
  return w.year - (w.frame.lastFired ?? w.assize.openedAt) >= FRAME_MAX_GAP_YEARS;
}

/** One frame template, weighted, or none if this is not a frame year. */
export function selectFrame(ctx: SimCtx, rng: Rng): EventTemplate | undefined {
  if (!frameDue(ctx, rng)) return undefined;

  const pool = framePool(ctx);
  if (pool.length) return rng.weighted(pool, (e) => e.weight);

  // OVERDUE, AND THE POOL IS EMPTY. This is the case that produced runs of two
  // interludes: the cadence came due and every eligible scene was inside its
  // own cooldown, so nothing fired and nothing said so. Rather than go silent
  // for another century, the frame repeats the scene it has gone longest
  // without — a creditor who says a version of the same thing twice in four
  // hundred years is the register anyway.
  //
  // `reads` are still honoured. Those are the narrative preconditions, not a
  // ration, and cutting to a scene whose premise is not yet true is worse than
  // cutting to nothing.
  if (!frameOverdue(ctx)) return undefined;
  const relaxed = ctx.content.events.filter((e) => e.tier === 'frame'
    && e.repeatable
    && e.reads.every((r) => readHolds(ctx, r)));
  if (!relaxed.length) return undefined;
  const stalest = relaxed.reduce((best, e) => (
    (ctx.world.frame.firedAt[e.id] ?? -Infinity) < (ctx.world.frame.firedAt[best.id] ?? -Infinity)
      ? e : best
  ));
  return stalest;
}

/**
 * Show one interlude. `resolveSlots` and `renderBody` are the same functions
 * every other tier uses — the frame narrows its own two roles in
 * `events/slots.ts`, not here — so this is genuinely the whole of what
 * showing a frame scene requires beyond selection.
 */
export function presentFrame(ctx: SimCtx, e: EventTemplate, rng: Rng): FrameEntry | undefined {
  const w = ctx.world;
  if (e.interaction.kind !== 'narration') return undefined;

  const res = resolveSlots(e, ctx, rng);
  if (!res.ok) return undefined;
  const fill = autoCast(e, ctx, res.fill, res.playerCast, rng);

  const outcome = pickOutcome(e.interaction.outcomes, rng, ctx);
  const text = renderBody(proseForOutcome(ctx, e, outcome), fill, ctx);
  const entry: FrameEntry = { year: w.year, eventId: e.id, outcomeId: outcome.id, text };

  w.frame.entries.push(entry);
  w.frame.lastFired = w.year;
  w.frame.firedAt[e.id] = w.year;
  w.decisionLog.push({
    kind: 'outcome', year: w.year, event: e.id, outcomeId: outcome.id, fill: { ...fill },
  });

  return entry;
}
