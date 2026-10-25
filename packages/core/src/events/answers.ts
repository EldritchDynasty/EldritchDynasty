import { outcomesOf } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { proseForClause } from '../prose.js';

/**
 * WHAT COUNTS AS AN ANSWER (#1897).
 *
 * An answer is a place where the run tells the player something new about the
 * bargain. There are three kinds, and this file is the one definition of all
 * three, so the frame's answer ceiling and `gate:long`'s silence line cannot
 * come to disagree about what silence is:
 *
 *   an interlude   the frame's own page, `world.frame.entries`;
 *   a clause       a recovered Ledger clause's illuminated page in the
 *                  chronicle, matched through `proseForClause`;
 *   a glimpse      an ordinary outcome an author tagged `glimpse` — a scene
 *                  that shows the debt once, in the event register, without
 *                  explaining it. Read off the decision log, which
 *                  `commitOutcome` writes for every outcome it applies.
 *
 * A glimpse is a tag rather than a field because it is a claim about what the
 * outcome's TEXT does, the same kind of claim `WARNING_TAG` makes. It changes
 * no draw: nothing weights on it and no successor routes on it.
 */
export const GLIMPSE_TAG = 'glimpse';

/** Was this outcome of this event written as a glimpse? Unknown ids are not. */
export function isGlimpse(ctx: SimCtx, event: string, outcomeId: string): boolean {
  const e = ctx.content.event(event);
  if (!e) return false;
  return outcomesOf(e, true).some((o) => o.id === outcomeId && o.tags.includes(GLIMPSE_TAG));
}

/**
 * The years a glimpse was shown, newest last, keeping only those after
 * `after`. The decision log is chronological, so this walks back from the end
 * and stops at the first entry not newer than `after`.
 */
export function glimpseYears(ctx: SimCtx, after = -Infinity): number[] {
  const log = ctx.world.decisionLog;
  const years: number[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const d = log[i]!;
    if (d.year <= after) break;
    if (d.kind === 'outcome' && isGlimpse(ctx, d.event, d.outcomeId)) years.push(d.year);
  }
  return years.reverse();
}

/**
 * The years a recovered clause's own page was written, keeping only those
 * after `after`. The opening clause the house always had writes no page, so
 * it is not here; nor is any other illuminated page that happens to share a
 * clause's title.
 */
export function clauseYears(ctx: SimCtx, after = -Infinity): number[] {
  const w = ctx.world;
  let pages: Map<string, string> | undefined;
  const years: number[] = [];
  for (const entry of w.chronicle) {
    if (entry.year <= after || entry.weight !== 'illuminated' || entry.title === undefined) continue;
    pages ??= new Map(ctx.content.clauses
      .filter((c) => w.clausesRecovered.has(c.id))
      .map((c) => { const prose = proseForClause(ctx, c); return [prose.name, prose.text]; }));
    if (pages.get(entry.title) === entry.text) years.push(entry.year);
  }
  return years;
}

/** Every answer the run has given, of all three kinds, in year order. */
export function answerYears(ctx: SimCtx): number[] {
  return [
    ...ctx.world.frame.entries.map((e) => e.year),
    ...clauseYears(ctx),
    ...glimpseYears(ctx),
  ].sort((a, b) => a - b);
}

/**
 * The year the run last told the player something new about the bargain: the
 * last interlude, a later clause page, a later glimpse, or the signing if
 * none of them.
 */
export function lastAnswerYear(ctx: SimCtx): number {
  const w = ctx.world;
  const floor = w.frame.lastFired ?? w.assize.openedAt;
  return Math.max(floor, ...clauseYears(ctx, floor), ...glimpseYears(ctx, floor));
}
