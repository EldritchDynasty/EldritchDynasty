import { outcomesOf, type LoggedDecision } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { proseForClause } from '../prose.js';
import { chronicleReading } from '../people/generation-changes.js';

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

type OutcomeDecision = Extract<LoggedDecision, { kind: 'outcome' }>;

/**
 * The glimpses shown after `after`, oldest first. The decision log is
 * chronological, so this walks back from the end and stops at the first entry
 * not newer than `after` — the frame asks this every year, so it must not
 * read the whole log to learn about the last decade.
 */
function glimpseDecisions(ctx: SimCtx, after: number): OutcomeDecision[] {
  const log = ctx.world.decisionLog;
  const shown: OutcomeDecision[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const d = log[i]!;
    if (d.year <= after) break;
    if (d.kind === 'outcome' && isGlimpse(ctx, d.event, d.outcomeId)) shown.push(d);
  }
  return shown.reverse();
}

/** The years a glimpse was shown, newest last, keeping only those after `after`. */
export function glimpseYears(ctx: SimCtx, after = -Infinity): number[] {
  return glimpseDecisions(ctx, after).map((d) => d.year);
}

/**
 * Where in the chronicle each recovered clause's own page sits, keeping only
 * those after `after`. The opening clause the house always had writes no page,
 * so it is not here; nor is any other illuminated page that happens to share
 * a clause's title.
 */
function clausePages(ctx: SimCtx, after: number): { year: number; index: number }[] {
  const w = ctx.world;
  let pages: Map<string, string> | undefined;
  const found: { year: number; index: number }[] = [];
  for (const [index, entry] of w.chronicle.entries()) {
    if (entry.year <= after || entry.weight !== 'illuminated' || entry.title === undefined) continue;
    pages ??= new Map(ctx.content.clauses
      .filter((c) => w.clausesRecovered.has(c.id))
      .map((c) => { const prose = proseForClause(ctx, c); return [prose.name, prose.text]; }));
    if (pages.get(entry.title) === entry.text) found.push({ year: entry.year, index });
  }
  return found;
}

/** The years a recovered clause's own page was written, keeping only those after `after`. */
export function clauseYears(ctx: SimCtx, after = -Infinity): number[] {
  return clausePages(ctx, after).map((p) => p.year);
}

export type AnswerKind = 'interlude' | 'clause' | 'glimpse';

/**
 * One answer, and where the player read it (#1945). `page` is the chronicle
 * page that carries it, under the id `chronicleReading` gives it — the id a
 * client sees on `book()` and the view. An interlude is the frame's page, not
 * the chronicle's, so it has none; it and a glimpse name their `event`.
 */
export interface Answer {
  year: number;
  kind: AnswerKind;
  event?: string;
  page?: string;
}

/**
 * The page each glimpse was written on. The decision log does not keep the
 * page, and must not start to: this is derived on read, never stored.
 *
 * `applyOutcome` writes exactly one page per outcome, under a fresh id, with
 * the event's id and the year on it, immediately before `commitOutcome` logs
 * the decision. So the k-th outcome of an event in a year is the k-th
 * distinct page of that event in that year. A Record block that rewrites the
 * page keeps its id, so it is not a second page.
 */
function glimpsePage(
  ctx: SimCtx, reading: readonly { id?: string; year: number; eventId?: string }[], after: number,
): (d: OutcomeDecision) => string | undefined {
  const pages = new Map<string, string[]>();
  for (const entry of reading) {
    if (entry.year <= after || entry.eventId === undefined) continue;
    const key = `${entry.year}:${entry.eventId}`;
    const ids = pages.get(key) ?? [];
    if (!ids.includes(entry.id!)) ids.push(entry.id!);
    pages.set(key, ids);
  }
  const ordinals = new Map<string, number>();
  const ordinalOf = new Map<OutcomeDecision, number>();
  for (const d of ctx.world.decisionLog) {
    if (d.year <= after || d.kind !== 'outcome') continue;
    const key = `${d.year}:${d.event}`;
    const nth = ordinals.get(key) ?? 0;
    ordinals.set(key, nth + 1);
    ordinalOf.set(d, nth);
  }
  return (d) => pages.get(`${d.year}:${d.event}`)?.[ordinalOf.get(d) ?? -1];
}

/**
 * Every answer the run has given after `after`, of all three kinds, in year
 * order. This is the definition; `answerYears` is only its dates.
 */
export function answers(ctx: SimCtx, after = -Infinity): Answer[] {
  const w = ctx.world;
  const reading = chronicleReading(w.chronicle);
  const pageOf = glimpsePage(ctx, reading, after);
  const all: Answer[] = [
    ...w.frame.entries
      .filter((e) => e.year > after)
      .map((e): Answer => ({ year: e.year, kind: 'interlude', event: e.eventId })),
    ...clausePages(ctx, after)
      .map((p): Answer => ({ year: p.year, kind: 'clause', page: reading[p.index]!.id! })),
    ...glimpseDecisions(ctx, after).map((d): Answer => {
      const page = pageOf(d);
      return { year: d.year, kind: 'glimpse', event: d.event, ...(page !== undefined ? { page } : {}) };
    }),
  ];
  return all.sort((a, b) => a.year - b.year);
}

/** Every answer the run has given, of all three kinds, in year order. */
export function answerYears(ctx: SimCtx): number[] {
  return answers(ctx).map((a) => a.year);
}

/**
 * Which chronicle pages after `after` are answers, by page id. What a client
 * is told about a page it is shown: `book()` and the view decorate the entries
 * they return with it rather than the saved book carrying it.
 */
export function answerPages(ctx: SimCtx, after = -Infinity): Map<string, Exclude<AnswerKind, 'interlude'>> {
  const kinds = new Map<string, Exclude<AnswerKind, 'interlude'>>();
  for (const a of answers(ctx, after)) if (a.page !== undefined && a.kind !== 'interlude') kinds.set(a.page, a.kind);
  return kinds;
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
