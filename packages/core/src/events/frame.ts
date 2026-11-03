import type { EventTemplate, FrameEntry, FrameRead } from '@ed/schema';
import { assertNever, eventInCampaign, FRAME_PAGE_TOKENS, frameReadBindsPage, slotTokenPattern } from '@ed/schema';
import type { FramePageToken } from '@ed/schema';
import type { ChronicleEntry, SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { evalCondition } from './conditions.js';
import { autoCast, renderBody, resolveSlots } from './slots.js';
import { pickOutcome } from './effects.js';
import { proseForEventBody, proseForEventTitle, proseForOutcome, proseForRecordSubject } from '../prose.js';
import { advanceArc, type ArcStep } from './arcs.js';
import { lastAnswerYear } from './answers.js';

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
 * AND NO LONGER THAN THIS WITHOUT AN ANSWER (#1904, option (a) of #1897).
 *
 * The ceiling above counts interludes only. A recovered Ledger clause also
 * tells the player something new about the bargain, and #1897 measured the
 * two together: the longest stretch with neither averaged 72 years and ran to
 * 104, because 108 almost never binds once a clause has landed in between.
 * Most of those silences sat in the midgame, where no generation's choices
 * reach the debt at all.
 *
 * So the frame is also overdue once this many years have passed since the
 * last answer of any kind (`events/answers.ts`: an interlude, a clause page,
 * or an authored glimpse). The minimum gap between interludes still holds,
 * and so do their `reads`; a clause or glimpse that landed recently keeps the
 * frame on its ordinary roll.
 *
 * Sixty is §5's expected gap from the note on the minimum above. Measured on
 * 24 Long Lines (`gate:long`, chronicler): mean longest answer silence 74.0
 * -> 64.7, interludes per run 6.5 -> 6.9, clauses and endings unchanged.
 * What still runs long opens at the signing, where no interlude's `reads`
 * hold yet and an overdue frame has nothing it may show; that stretch is
 * #1897's authored half, not a cadence.
 */
export const FRAME_ANSWER_GAP_YEARS = 60;

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

export { readHolds as frameReadHolds };

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
    if (e.arc || !eventInCampaign(e, w.campaign)) return false;
    const last = w.frame.firedAt[e.id];
    if (last !== undefined) {
      if (!e.repeatable) return false;
      if (w.year - last < e.cooldownYears) return false;
    }
    return e.reads.every((r) => readHolds(ctx, r));
  });
}

export { lastAnswerYear };

/** The cadence check alone, with no regard to what is actually in the pool. */
export function frameDue(ctx: SimCtx, rng: Rng): boolean {
  const w = ctx.world;
  const since = w.year - (w.frame.lastFired ?? w.assize.openedAt);
  if (w.frame.lastFired !== null && since < FRAME_MIN_GAP_YEARS) return false;
  if (frameOverdue(ctx)) return true;
  return rng.next() < FRAME_CHANCE_PER_YEAR;
}

/** Whether the frame has been silent long enough to take what it can get. */
export function frameOverdue(ctx: SimCtx): boolean {
  const w = ctx.world;
  const since = w.year - (w.frame.lastFired ?? w.assize.openedAt);
  if (since >= FRAME_MAX_GAP_YEARS) return true;
  if (since < FRAME_ANSWER_GAP_YEARS) return false;
  return w.year - lastAnswerYear(ctx) >= FRAME_ANSWER_GAP_YEARS;
}

/** One frame template, weighted, or none if this is not a frame year. */
export function selectFrame(ctx: SimCtx, rng: Rng): EventTemplate | undefined {
  ctx.observeSelection?.({ kind: 'before_frame', year: ctx.world.year });
  const due = frameDue(ctx, rng);
  ctx.observeSelection?.({ kind: 'frame_due', year: ctx.world.year, due });
  if (!due) return undefined;

  const pool = framePool(ctx);
  if (pool.length) {
    const chosen = rng.weighted(pool, (e) => e.weight);
    if (chosen) ctx.observeSelection?.({ kind: 'selected', year: ctx.world.year,
      candidates: [{ event: String(chosen.id), source: 'frame' }] });
    return chosen;
  }

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
    && !e.arc && eventInCampaign(e, ctx.world.campaign)
    && e.repeatable
    && e.reads.every((r) => readHolds(ctx, r)));
  if (!relaxed.length) return undefined;
  const stalest = relaxed.reduce((best, e) => (
    (ctx.world.frame.firedAt[e.id] ?? -Infinity) < (ctx.world.frame.firedAt[best.id] ?? -Infinity)
      ? e : best
  ));
  ctx.observeSelection?.({ kind: 'selected', year: ctx.world.year,
    candidates: [{ event: String(stalest.id), source: 'frame' }] });
  return stalest;
}

/**
 * THE BLANK A SCENE NAMES (#1987).
 *
 * The owner's target: a house's first Omit comes back as that omission,
 * identifiably, in the first stretch of play. The omission scene already
 * reached about 94% of Omit houses a median 16 years on, and named no page,
 * year or person, so the player could not tell it was about theirs.
 *
 * The earliest blank no interlude has named yet, so the first time the scene
 * plays it points at the house's FIRST omission, and a later return points at
 * the next. Once every blank has been named it returns to the newest one:
 * still true, and the guardian has had the longest to think about it.
 * Deterministic: it reads the book and the frame, and draws nothing.
 */
export function pageToCite(ctx: SimCtx, e: EventTemplate): ChronicleEntry | undefined {
  if (!e.reads.some(frameReadBindsPage)) return undefined;
  const w = ctx.world;
  const cited = new Set(w.frame.entries.flatMap((f) => (f.cites ? [f.cites.page] : [])));
  const blanks = w.chronicle.filter((c) => c.record === 'omit' && c.id !== undefined);
  return blanks.find((c) => !cited.has(c.id!)) ?? blanks.at(-1);
}

/**
 * `{PAGE_YEAR}` and `{PAGE_SUBJECT}`, after the people are rendered. A page
 * saved before #1987 kept no subject, so it falls back to its Record block's
 * own subject when that names nobody, and otherwise to the act's title: both
 * have Plain English rows, and either is truer than a bare year.
 */
function namePage(ctx: SimCtx, text: string, page: ChronicleEntry): { text: string; named: boolean } {
  let named = false;
  const out = text.replace(slotTokenPattern(), (m, name: string, form: string | undefined) => {
    if (form !== undefined || !isPageToken(name)) return m;
    named = true;
    return pageWords(ctx, page, name);
  });
  return { text: out, named };
}

const isPageToken = (name: string): name is FramePageToken =>
  (FRAME_PAGE_TOKENS as readonly string[]).includes(name);

function pageWords(ctx: SimCtx, page: ChronicleEntry, token: FramePageToken): string {
  switch (token) {
    case 'PAGE_YEAR': return String(page.year);
    case 'PAGE_SUBJECT': return page.subject ? inline(page.subject) : subjectOf(ctx, page);
    default: return assertNever(token);
  }
}

/** Any page token left unrendered: a scene that names a blank, with none to name. */
const namesAPage = (text: string): boolean =>
  [...text.matchAll(slotTokenPattern())].some((m) => m[2] === undefined && isPageToken(m[1]!));

function subjectOf(ctx: SimCtx, page: ChronicleEntry): string {
  const source = page.eventId === undefined ? undefined : ctx.content.event(page.eventId);
  if (!source) return String(page.year);
  const subject = source.record?.subject;
  return subject && !/[{}]/.test(subject)
    ? inline(proseForRecordSubject(ctx, source, subject))
    : proseForEventTitle(ctx, source);
}

/**
 * A docket subject set inside the scene's sentence. 53 of the 212 authored
 * subjects are sentences of their own ("The account of Aldous at the
 * incident."), written to head the Record prompt, so the full stop goes and
 * a leading article drops to lower case. Anything else is left as written.
 */
export function inline(subject: string): string {
  return subject.trim().replace(/[.!?]+$/, '').replace(/^(The|A|An) /, (m) => m.toLowerCase());
}

/**
 * Show one interlude. `resolveSlots` and `renderBody` are the same functions
 * every other tier uses — the frame narrows its own two roles in
 * `events/slots.ts`, not here — so this is genuinely the whole of what
 * showing a frame scene requires beyond selection.
 */
export function presentFrame(ctx: SimCtx, e: EventTemplate, rng: Rng, arcStep?: ArcStep): FrameEntry | undefined {
  const w = ctx.world;
  if (e.interaction.kind !== 'narration') return undefined;
  if (!eventInCampaign(e, w.campaign) || !e.reads.every((read) => readHolds(ctx, read))) return undefined;

  const res = arcStep
    ? { ok: true as const, fill: arcStep.fill, playerCast: arcStep.playerCast }
    : resolveSlots(e, ctx, rng);
  if (!res.ok) {
    ctx.observeSelection?.({ kind: 'cast_failure', year: w.year, event: String(e.id), source: 'frame', missing: res.missing });
    return undefined;
  }
  const fill = autoCast(e, ctx, res.fill, res.playerCast, rng);

  const outcome = pickOutcome(e.interaction.outcomes, rng, ctx, fill);
  const text = renderBody(proseForOutcome(ctx, e, outcome), fill, ctx);
  // THE SCENE, THEN ITS LINE (#2615). `proseForOutcome` falls back to the body
  // only when the outcome has no text, and every frame outcome has text, so
  // for as long as interludes existed the player read the punchline alone:
  // "A good lunch, that afternoon." with no heralds before it. The body is
  // rendered here, once, with the same fill and prose mode as the line.
  let scene = outcome.text ? renderBody(proseForEventBody(ctx, e, e.body), fill, ctx).trim() : '';
  let line = text;
  const page = pageToCite(ctx, e);
  let cites: FrameEntry['cites'];
  if (page) {
    const named = [namePage(ctx, scene, page), namePage(ctx, line, page)] as const;
    [scene, line] = [named[0].text, named[1].text];
    if (named[0].named || named[1].named) cites = { page: page.id!, year: page.year };
  }
  // A scene written to name a blank, with no blank in the book to name (a
  // save whose pages carry no ids), is a cast that did not fill. Show nothing
  // rather than `{PAGE_YEAR}`.
  if (namesAPage(scene) || namesAPage(line)) {
    ctx.observeSelection?.({ kind: 'cast_failure', year: w.year, event: String(e.id), source: 'frame', missing: 'PAGE' });
    return undefined;
  }
  const entry: FrameEntry = {
    year: w.year, eventId: e.id, outcomeId: outcome.id, ...(scene ? { body: scene } : {}), text: line,
    ...(cites ? { cites } : {}),
  };

  w.frame.entries.push(entry);
  w.frame.lastFired = w.year;
  w.frame.firedAt[e.id] = w.year;
  w.decisionLog.push({
    kind: 'outcome', year: w.year, event: e.id, outcomeId: outcome.id, fill: { ...fill },
  });
  if (arcStep) advanceArc(arcStep, outcome, undefined, ctx, rng);

  return entry;
}
