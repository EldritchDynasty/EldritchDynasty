/**
 * WHEN DOES THE FIRST ALTERED PAGE COME BACK? (issue #1987, step 1).
 *
 *   npm run gate:record-returns -- [runs] --campaign=short --policy=chronicler
 *   npm run gate:record-returns -- 200 --campaign=short --policy=embellish --output=rows.json
 *   npm run gate:record-returns -- --summarise rows-a.json rows-b.json
 *
 * Read-only measurement. Nothing here changes a rule, a constant or a piece of
 * content, and no number here is a CI threshold. The question is the one the
 * issue says nothing measures: after a house's FIRST Omit or Embellish, how
 * long until the player meets a later scene or page that points back at that
 * exact page? If the wait spans generations, a first session can end before
 * the Record verb is ever seen to matter.
 *
 * ─── What counts as a return ───────────────────────────────────────────────
 *
 * A return must identify the exact altered entry through state the player can
 * see. Mentioning lies, moving standing, or sharing the source's template or
 * year is not enough. Five kinds qualify:
 *
 * - `followup`: a later Chronicle page that the shipped `causeOf` resolves to
 *   the altered page, which is the backlink the Chronicle draws (#269). These
 *   are scheduled follow-ups and arc continuations of the ACT. They would cite
 *   the page whichever Record option was taken. No Omit or Embellish option in
 *   the shipped content schedules anything of its own.
 * - `echo`: a bearing echo line (`echoFrame`) whose cause is the page.
 *   Embellish's `wrote_it_larger` writes one a generation later, unless
 *   `ECHO_SPACING` holds it back behind an earlier echo of that kind.
 * - `discrepancy_page`: a page carrying the source's own Discrepancy (written
 *   by `people/secrets.ts` or `people/papers.ts`) that `causeOf` resolves to
 *   the altered page once the Discrepancy is settled.
 * - `dispute`: the altered page's own Discrepancy leaves `open`, proven or
 *   buried. Recorded Life shows that state on that page. This is Embellish
 *   only: no read model ties an Omit's Discrepancy to its blank.
 * - `interlude`: an interlude whose declared `reads` name a Discrepancy the
 *   altered choice opened. A `FrameEntry` stores no source page, so the
 *   template's reads are the only page-level evidence an interlude has.
 *
 * The last four exist only because the page was altered. The report keeps
 * `followup` apart from them because it measures the act returning, not the
 * lie.
 *
 * Two observations are reported beside the returns and never counted as one.
 * A `themed` callback is an interlude after the choice whose reads concern
 * the book (a count of records, omissions or lies, a different lie, or a page
 * of the source's template) but do not name this page's lie. An `unlinked`
 * settlement is a Discrepancy the Omit opened that was later proven or buried,
 * with nothing on the page or in `causeOf` to say so.
 *
 * ─── What is recorded per house ───────────────────────────────────────────
 *
 * The first Record block answered Omit or Embellish: decision id, entry id,
 * template, mode, year, and the prompts and Record blocks answered before it.
 * Then the first return of each kind, in game years, reigns (Heads who took
 * the seal between) and docket prompts answered after the choice. A house
 * with no return is censored at its run's end, broken line or term. A house
 * that never altered a page keeps that status.
 *
 * ─── The three policies ────────────────────────────────────────────────────
 *
 * `chronicler` is `playToTheEnd`'s chronicler loop: the same salt
 * (`'ending-batch'`), the same nested docket loop that `autoResolveAll` runs,
 * and the same naming-queue clear. `record-return-report.test.ts` pins that
 * the same seed plays the same house.
 *
 * `embellish` and `omit` answer EVERY Record block with that option and
 * everything else as the chronicler does, on the chronicler's own streams. A
 * house is identical to its chronicler twin until the first block where the
 * answers differ, which the test pins on a seed whose shared stretch crosses a
 * Record block. A player who learns the verb uses it more than once, so the
 * policy does too.
 *
 * All columns play with the authored founder, no Table orders and the default
 * Library inputs.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { assertNever, indexContent, type CampaignId, type Content, type ContentBundle, type EndingId, type FrameRead } from '@ed/schema';
import { clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { makeRng, hashSeed, type Rng } from '../rng.js';
import { autoRecordOption, autoResolveDecision, resolveRecord, type PendingDecision } from '../events/decisions.js';
import { closeTheLedger } from '../ending.js';
import { campaignDef } from '../campaign.js';
import { causeOf } from '../cause.js';
import { bootstrapRun } from '../run-setup.js';
import type { SimCtx } from '../world.js';
import { binomialInterval } from './story-route-report.js';
import { medianInterval, quantile } from './line-break-report.js';
import {
  gatePartitionWorkerCount,
  partitionGateInputs,
  reduceGatePartitions,
  runGatePartitionsInWorkers,
  type GatePartition,
  type GatePartitionResult,
} from './gate-partition.js';

type Source = ContentBundle | Content;

export const RECORD_RETURN_POLICIES = ['chronicler', 'embellish', 'omit'] as const;
export type RecordReturnPolicy = typeof RECORD_RETURN_POLICIES[number];

/** Declared on #1987 before the first batch: seed `i` of a column is this plus `i`. */
export const RECORD_RETURN_SEED_START = 198_700;
export const RECORD_RETURN_DEFAULT_RUNS = 200;

export type AlteredMode = 'omit' | 'embellish';

export const RETURN_KINDS = ['followup', 'echo', 'discrepancy_page', 'dispute', 'interlude'] as const;
export type ReturnKind = typeof RETURN_KINDS[number];

/** The kinds that exist only because the page was altered. */
export const ALTERATION_KINDS: readonly ReturnKind[] = ['echo', 'discrepancy_page', 'dispute', 'interlude'];

export interface AlteredSource {
  decision: string;
  entry: string;
  event: string;
  mode: AlteredMode;
  year: number;
  elapsed: number;
  /** Docket prompts answered before this one, of every kind. */
  promptsBefore: number;
  /** Record blocks answered truthfully before this one. */
  truthfulBefore: number;
  /** Discrepancies the chosen option opened: Embellish's own, or any an Omit's effects created. */
  discrepancies: string[];
}

export interface RecordReturn {
  kind: ReturnKind;
  year: number;
  afterYears: number;
  /** Heads who took the seal between the choice and the return. */
  afterReigns: number;
  /** Docket prompts answered after the choice, up to the one that wrote it. */
  afterPrompts: number;
  /** A Chronicle entry id, a frame event id, or a Discrepancy id. */
  ref: string;
  /** Structure, never prose: the event id, echo frame or settled state. */
  detail?: string;
}

/**
 * What a `reads` entry says about one altered page. Only `names_lie` points at
 * it. The rest are about the book: a page of the same template, another lie,
 * or a count of omissions, lies or truthful records. `frame_the_page_he_does_
 * not_turn` reads `omitted` and names no page, year or person.
 */
export type ReadBearing =
  | 'names_lie' | 'same_template' | 'omitted_count' | 'other_lie' | 'lie_count' | 'recorded_count' | 'none';

export interface ThemedCallback {
  year: number;
  afterYears: number;
  afterPrompts: number;
  event: string;
  read: Exclude<ReadBearing, 'names_lie' | 'none'>;
}

export interface UnlinkedSettlement {
  year: number;
  afterYears: number;
  discrepancy: string;
  state: 'proven' | 'buried';
}

export interface RecordReturnRun {
  seed: number;
  campaign: CampaignId;
  policy: RecordReturnPolicy;
  /** Undefined only when a short `years` stopped the loop before the term. */
  ending?: EndingId;
  broke: boolean;
  /** Elapsed years played; the censoring point for a house with no return. */
  playedElapsed: number;
  /** Record blocks the docket held, and when the first stood there. */
  recordOffers: number;
  firstOfferElapsed?: number;
  prompts: number;
  interludes: number;
  firstInterludeElapsed?: number;
  source?: AlteredSource;
  /** The first return of any kind. */
  first?: RecordReturn;
  firstByKind: Partial<Record<ReturnKind, RecordReturn>>;
  /** The first interlude of any kind after the choice, in years after it. */
  firstInterludeAfterYears?: number;
  themed?: ThemedCallback;
  unlinked?: UnlinkedSettlement;
}

/** Exhaustive over `FrameRead`: a new read kind is a decision here, not a silent `none`. */
export function readBearing(read: FrameRead, source: Pick<AlteredSource, 'event' | 'discrepancies'>): ReadBearing {
  if ('discrepancy' in read) return source.discrepancies.includes(read.discrepancy) ? 'names_lie' : 'other_lie';
  if ('anyDiscrepancy' in read) return 'lie_count';
  if ('recorded' in read) return 'recorded_count';
  if ('chronicled' in read) return read.chronicled === source.event ? 'same_template' : 'none';
  if ('omitted' in read) return 'omitted_count';
  return assertNever(read);
}

const BEARING_RANK: Record<ReadBearing, number> = {
  names_lie: 6, same_template: 5, omitted_count: 4, other_lie: 3, lie_count: 2, recorded_count: 1, none: 0,
};

/** The strongest bearing any of an interlude's reads has on the page. */
export function interludeBearing(reads: readonly FrameRead[], source: Pick<AlteredSource, 'event' | 'discrepancies'>): ReadBearing {
  return reads.map((r) => readBearing(r, source))
    .reduce<ReadBearing>((best, b) => BEARING_RANK[b] > BEARING_RANK[best] ? b : best, 'none');
}

/**
 * Everything the detector has read so far about one altered page. Cursors, so
 * each Chronicle page and interlude is classified once; `pending` holds the
 * pages that carry the source's Discrepancy and resolve only once it settles.
 */
export interface ReturnWatch {
  source: AlteredSource;
  page: number;
  frame: number;
  prompts: number;
  reigns: number;
  pending: Set<string>;
  first?: RecordReturn;
  firstByKind: Partial<Record<ReturnKind, RecordReturn>>;
  firstInterludeAfterYears?: number;
  themed?: ThemedCallback;
  unlinked?: UnlinkedSettlement;
}

export function watchFrom(ctx: SimCtx, source: AlteredSource, page: number, frame: number, prompts: number): ReturnWatch {
  return { source, page, frame, prompts, reigns: ctx.world.succession.length, pending: new Set(), firstByKind: {} };
}

/**
 * Read what changed since the last look. `prompts` is the run's running count
 * of answered docket prompts, so `afterPrompts` includes the one that wrote
 * the return when the docket wrote it.
 */
export function lookForReturns(ctx: SimCtx, watch: ReturnWatch, prompts: number): void {
  const w = ctx.world;
  const { source } = watch;
  const note = (kind: ReturnKind, ref: string, detail?: string) => {
    if (watch.firstByKind[kind]) return;
    const found: RecordReturn = {
      kind,
      year: w.year,
      afterYears: w.year - source.year,
      afterReigns: w.succession.length - watch.reigns,
      afterPrompts: prompts - watch.prompts,
      ref,
      ...(detail ? { detail } : {}),
    };
    watch.firstByKind[kind] = found;
    watch.first ??= found;
  };

  for (; watch.page < w.chronicle.length; watch.page++) {
    const page = w.chronicle[watch.page]!;
    if (!page.id || page.id === source.entry) continue;
    if (page.discrepancyId && source.discrepancies.includes(page.discrepancyId)) {
      watch.pending.add(page.id);
    } else if (causeOf(ctx, page.id)?.page === source.entry) {
      if (page.echoFrame) note('echo', page.id, page.echoFrame);
      else note('followup', page.id, page.eventId);
    }
  }
  for (const id of watch.pending) {
    if (causeOf(ctx, id)?.page !== source.entry) continue;
    note('discrepancy_page', id, w.chronicle.find((c) => c.id === id)?.eventId);
    watch.pending.delete(id);
  }

  for (const id of source.discrepancies) {
    const state = w.discrepancies.get(id)?.state;
    if (!state || state === 'open') continue;
    if (source.mode === 'embellish') note('dispute', id, state);
    else watch.unlinked ??= { year: w.year, afterYears: w.year - source.year, discrepancy: id, state };
  }

  for (; watch.frame < w.frame.entries.length; watch.frame++) {
    const entry = w.frame.entries[watch.frame]!;
    watch.firstInterludeAfterYears ??= entry.year - source.year;
    const bearing = interludeBearing(ctx.content.event(entry.eventId)?.reads ?? [], source);
    if (bearing === 'names_lie') note('interlude', entry.eventId);
    else if (bearing !== 'none') {
      watch.themed ??= {
        year: entry.year, afterYears: entry.year - source.year, afterPrompts: prompts - watch.prompts,
        event: entry.eventId, read: bearing,
      };
    }
  }
}

/** One run to the term or the break, recording only what the report reads. */
export function playRecordReturnRun(
  source: Source,
  seed: number,
  campaign: CampaignId,
  policy: RecordReturnPolicy,
  years = campaignDef(campaign).years,
  /** Reads the finished world; the parity test compares it with `playToTheEnd`. */
  onEnd?: (ctx: SimCtx) => void,
): RecordReturnRun {
  const def = campaignDef(campaign);
  const ctx = bootstrapRun(indexContent(source), seed, { campaign });
  const w = ctx.world;
  let prompts = 0;
  let recordOffers = 0;
  let firstOfferElapsed: number | undefined;
  let truthful = 0;
  let watch: ReturnWatch | undefined;

  const answer = (d: PendingDecision, rng: Rng) => {
    const page = w.chronicle.length;
    const frame = w.frame.entries.length;
    const before = d.kind === 'record' && !watch
      ? new Map([...w.discrepancies].map(([id, x]) => [id, x.state])) : undefined;
    if (d.kind === 'record' && policy !== 'chronicler') {
      // Draw and discard the chronicler's own answer, so a forced answer never
      // moves the draws of decisions queued behind it in the same batch.
      autoRecordOption(rng);
      resolveRecord(ctx, d.id, policy);
    } else {
      autoResolveDecision(ctx, d, rng);
    }
    prompts++;
    if (d.kind !== 'record') return;
    recordOffers++;
    firstOfferElapsed ??= d.year - def.startYear;
    if (watch) return;
    const entry = w.chronicle.find((c) => c.id === d.entryId);
    const mode = entry?.record;
    if (mode !== 'omit' && mode !== 'embellish') {
      truthful++;
      return;
    }
    // The page's own Discrepancy even if an outcome had already opened that id.
    const opened = new Set(entry!.discrepancyId ? [entry!.discrepancyId] : []);
    for (const [id, x] of w.discrepancies) if (x.state === 'open' && before!.get(id) !== 'open') opened.add(id);
    watch = watchFrom(ctx, {
      decision: d.id,
      entry: d.entryId,
      event: String(d.event.id),
      mode,
      year: d.year,
      elapsed: d.year - def.startYear,
      promptsBefore: prompts - 1,
      truthfulBefore: truthful,
      discrepancies: [...opened],
    }, page, frame, prompts);
  };

  for (let y = 0; y < years; y++) {
    if (w.year >= def.endYear || w.ending) break;
    stepYear(ctx, false);
    if (watch) lookForReturns(ctx, watch, prompts);
    // `playToTheEnd`'s loop, with `autoResolveAll` unrolled so each answer
    // can be read as it lands. The salt and the guards are unchanged.
    let guard = 0;
    while (w.pendingDecisions.length && guard++ < 200) {
      const rng = makeRng(hashSeed(seed, 'ending-batch', w.year, guard));
      let inner = 0;
      while (w.pendingDecisions.length && inner++ < 200) {
        answer(w.pendingDecisions[0]!, rng);
        if (watch) lookForReturns(ctx, watch, prompts);
      }
    }
    clearNamingQueue(ctx);
  }
  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  if (watch) lookForReturns(ctx, watch, prompts);
  onEnd?.(ctx);

  const first = w.frame.entries[0];
  return {
    seed,
    campaign,
    policy,
    ...(w.ending ? { ending: w.ending.id } : {}),
    broke: w.ending?.id === 'broken_line',
    playedElapsed: (w.ending?.year ?? w.year) - def.startYear,
    recordOffers,
    ...(firstOfferElapsed !== undefined ? { firstOfferElapsed } : {}),
    prompts,
    interludes: w.frame.entries.length,
    ...(first ? { firstInterludeElapsed: first.year - def.startYear } : {}),
    ...(watch ? { source: watch.source } : {}),
    ...(watch?.first ? { first: watch.first } : {}),
    firstByKind: watch?.firstByKind ?? {},
    ...(watch?.firstInterludeAfterYears !== undefined ? { firstInterludeAfterYears: watch.firstInterludeAfterYears } : {}),
    ...(watch?.themed ? { themed: watch.themed } : {}),
    ...(watch?.unlinked ? { unlinked: watch.unlinked } : {}),
  };
}

export interface RecordReturnInput { seed: number; policy: RecordReturnPolicy }

export function recordReturnInputs(runs: number, policies: readonly RecordReturnPolicy[], offset = 0): RecordReturnInput[] {
  return policies.flatMap((policy) =>
    Array.from({ length: runs }, (_, i) => ({ seed: RECORD_RETURN_SEED_START + offset + i, policy })));
}

/** Raw observations for one worker's slice; the reducer restores the order. */
export function runRecordReturnPartition(
  source: Source,
  partition: GatePartition<RecordReturnInput>,
  campaign: CampaignId,
): GatePartitionResult<RecordReturnRun> {
  const content = indexContent(source);
  return {
    id: partition.id,
    observations: partition.items.map(({ index, input }) => ({
      index,
      value: playRecordReturnRun(content, input.seed, campaign, input.policy),
    })),
  };
}

export function measureRecordReturns(
  source: Source,
  runs: number,
  campaign: CampaignId,
  policies: readonly RecordReturnPolicy[],
  offset = 0,
): RecordReturnRun[] {
  const content = indexContent(source);
  const plan = partitionGateInputs(recordReturnInputs(runs, policies, offset), gatePartitionWorkerCount());
  const results = plan.length === 1
    ? plan.map((partition) => runRecordReturnPartition(content, partition, campaign))
    : runGatePartitionsInWorkers<RecordReturnInput, RecordReturnRun>(plan, {
      moduleUrl: import.meta.url,
      exportName: 'runRecordReturnPartition',
      argsBefore: [content.bundle],
      argsAfter: [campaign],
    });
  return reduceGatePartitions(plan, results);
}

// ─── The reduction ──────────────────────────────────────────────────────────

/** Years-after cuts for the "within" shares; inclusive, so a 25-year echo is within 25. */
export const WITHIN_YEARS = [25, 50, 100] as const;

export const AFTER_BUCKETS: readonly [number, number][] = [
  [0, 10], [10, 25], [25, 26], [26, 50], [50, 100], [100, 200], [200, Infinity],
];

type Interval = ReturnType<typeof binomialInterval>;

interface Spread {
  n: number;
  q25: number | null;
  median: number | null;
  q75: number | null;
  max: number | null;
  medianCi: { lower: number; upper: number } | null;
}

function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    q25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q75: quantile(sorted, 0.75),
    max: sorted.at(-1) ?? null,
    medianCi: medianInterval(sorted),
  };
}

export interface RecordReturnSummary {
  campaign: CampaignId;
  policy: RecordReturnPolicy;
  /** `any` is every altered house; `omit` and `embellish` split it by the first altered mode. */
  mode: AlteredMode | 'any';
  runs: number;
  offered: number;
  altered: number;
  /** Over altered houses. */
  returned: Interval;
  alterationReturned: Interval;
  /**
   * `share` is over every altered house, so a house censored early counts as
   * no return: a lower bound. `observed` drops the houses whose run ended
   * fewer than `years` after the choice without a return.
   */
  within: { years: number; share: Interval; observed: Interval }[];
  /** First returns only, conditional on a return. */
  afterYears: Spread;
  afterReigns: Spread;
  afterPrompts: Spread;
  /** Docket prompts from the signing to the return, the choice's own included. */
  fromSigning: Spread;
  afterBuckets: { from: number; to: number; count: number }[];
  firstKinds: Record<string, number>;
  /** Houses with each kind at any point, not only first. */
  anyKind: Record<string, number>;
  censored: { broken: number; term: number; unfinished: number; yearsAtRisk: Spread };
  themed: { count: number; afterYears: Spread; reads: Record<string, number> };
  unlinked: number;
  /** Interlude delivered after the choice, of any kind. */
  interludeAfter: number;
  source: { elapsed: Spread; promptsBefore: Spread; truthfulBefore: Spread };
  /** The commonest first altered templates, most first. */
  sources: [string, number][];
  firstOfferElapsed: Spread;
  /** Over the whole column, altered or not. */
  noInterlude: number;
  firstInterludeElapsed: Spread;
}

/** How many of the commonest first altered templates the report names. */
export const TOP_SOURCES = 3;

const tally = (keys: readonly string[]) => {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
};

export function summariseRecordReturns(rows: readonly RecordReturnRun[]): RecordReturnSummary[] {
  const keys = [...new Set(rows.map((r) => `${r.campaign}/${r.policy}`))];
  return keys.flatMap((key) => {
    const col = rows.filter((r) => `${r.campaign}/${r.policy}` === key);
    const modes: (AlteredMode | 'any')[] = ['any', 'omit', 'embellish'];
    return modes.flatMap((mode): RecordReturnSummary[] => {
      const houses = col.filter((r) => r.source && (mode === 'any' || r.source.mode === mode));
      if (mode !== 'any' && !houses.length) return [];
      const returned = houses.filter((r) => r.first);
      const alteration = houses.filter((r) => ALTERATION_KINDS.some((k) => r.firstByKind[k]));
      const censored = houses.filter((r) => !r.first);
      const themed = houses.filter((r) => r.themed);
      return [{
        campaign: col[0]!.campaign,
        policy: col[0]!.policy,
        mode,
        runs: col.length,
        offered: col.filter((r) => r.recordOffers > 0).length,
        altered: houses.length,
        returned: binomialInterval(returned.length, houses.length),
        alterationReturned: binomialInterval(alteration.length, houses.length),
        within: WITHIN_YEARS.map((years) => {
          const hits = returned.filter((r) => r.first!.afterYears <= years).length;
          const observed = houses.filter((r) => r.first || r.playedElapsed - r.source!.elapsed >= years).length;
          return { years, share: binomialInterval(hits, houses.length), observed: binomialInterval(hits, observed) };
        }),
        afterYears: spread(returned.map((r) => r.first!.afterYears)),
        afterReigns: spread(returned.map((r) => r.first!.afterReigns)),
        afterPrompts: spread(returned.map((r) => r.first!.afterPrompts)),
        fromSigning: spread(returned.map((r) => r.source!.promptsBefore + 1 + r.first!.afterPrompts)),
        afterBuckets: AFTER_BUCKETS.map(([from, to]) => ({
          from, to, count: returned.filter((r) => r.first!.afterYears >= from && r.first!.afterYears < to).length,
        })),
        firstKinds: tally(returned.map((r) => r.first!.kind)),
        anyKind: tally(houses.flatMap((r) => RETURN_KINDS.filter((k) => r.firstByKind[k]))),
        censored: {
          broken: censored.filter((r) => r.broke).length,
          term: censored.filter((r) => r.ending && !r.broke).length,
          unfinished: censored.filter((r) => !r.ending).length,
          yearsAtRisk: spread(censored.map((r) => r.playedElapsed - r.source!.elapsed)),
        },
        themed: {
          count: themed.length,
          afterYears: spread(themed.map((r) => r.themed!.afterYears)),
          reads: tally(themed.map((r) => r.themed!.read)),
        },
        unlinked: houses.filter((r) => r.unlinked).length,
        interludeAfter: houses.filter((r) => r.firstInterludeAfterYears !== undefined).length,
        source: {
          elapsed: spread(houses.map((r) => r.source!.elapsed)),
          promptsBefore: spread(houses.map((r) => r.source!.promptsBefore)),
          truthfulBefore: spread(houses.map((r) => r.source!.truthfulBefore)),
        },
        sources: Object.entries(tally(houses.map((r) => r.source!.event)))
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_SOURCES),
        firstOfferElapsed: spread(col.filter((r) => r.firstOfferElapsed !== undefined).map((r) => r.firstOfferElapsed!)),
        noInterlude: col.filter((r) => r.interludes === 0).length,
        firstInterludeElapsed: spread(col.filter((r) => r.firstInterludeElapsed !== undefined).map((r) => r.firstInterludeElapsed!)),
      }];
    });
  });
}

const pct = (x: number | null) => x === null ? '—' : `${(100 * x).toFixed(1)}%`;
const share = (b: Interval) => `${b.hits}/${b.n} = ${pct(b.rate)} [${pct(b.lower)}, ${pct(b.upper)}]`;
const num = (x: number | null) => x === null ? '—' : String(Math.round(x * 10) / 10);
const quartiles = (s: Spread) => `${s.n} · ${num(s.q25)} / ${num(s.median)} / ${num(s.q75)} / ${num(s.max)}`;
const counts = (r: Record<string, number>) => Object.entries(r).sort().map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
const bucket = ([from, to]: readonly [number, number]) =>
  to === Infinity ? `${from}+` : to === from + 1 ? `${from}` : `${from}–${to - 1}`;

export function recordReturnReport(summaries: readonly RecordReturnSummary[]): string[] {
  const label = (s: RecordReturnSummary) => `${s.campaign} / ${s.policy} / ${s.mode}`;
  const lines: string[] = [];
  lines.push('| Campaign / policy / first mode | Houses · offered a Record · altered | Any return | Return the alteration made | '
    + WITHIN_YEARS.map((y) => `Within ${y} years`).join(' | ') + ' |');
  lines.push('| --- | --- | --- | --- | ' + WITHIN_YEARS.map(() => '---').join(' | ') + ' |');
  for (const s of summaries) {
    lines.push(`| ${label(s)} | ${s.runs} · ${s.offered} · ${s.altered} | ${share(s.returned)} | ${share(s.alterationReturned)} | `
      + s.within.map((w) => share(w.share)).join(' | ') + ' |');
  }
  lines.push('');
  lines.push('| Campaign / policy / first mode | '
    + WITHIN_YEARS.map((y) => `Within ${y} years, of houses observed ${y} years`).join(' | ') + ' |');
  lines.push('| --- | ' + WITHIN_YEARS.map(() => '---').join(' | ') + ' |');
  for (const s of summaries) lines.push(`| ${label(s)} | ` + s.within.map((w) => share(w.observed)).join(' | ') + ' |');
  lines.push('');
  lines.push('| Campaign / policy / first mode | Years after, n · q25 / median / q75 / max | Median ~95% CI | Reigns after | Prompts after | Prompts from the signing | First kind | Any kind |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    const ci = s.afterYears.medianCi ? `${s.afterYears.medianCi.lower}–${s.afterYears.medianCi.upper}` : '—';
    lines.push(`| ${label(s)} | ${quartiles(s.afterYears)} | ${ci} | ${quartiles(s.afterReigns)} | ${quartiles(s.afterPrompts)} | ${quartiles(s.fromSigning)} | ${counts(s.firstKinds)} | ${counts(s.anyKind)} |`);
  }
  lines.push('');
  lines.push(`| Campaign / policy / first mode | First returns by years after (${AFTER_BUCKETS.map(bucket).join(', ')}) | Censored: broken · term · unfinished | Years at risk, censored | Themed callback · median years after · reads | Unlinked Omit settlement | Any interlude after |`);
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    lines.push(`| ${label(s)} | ${s.afterBuckets.map((b) => b.count).join(', ')} | ${s.censored.broken} · ${s.censored.term} · ${s.censored.unfinished} | ${quartiles(s.censored.yearsAtRisk)} | ${s.themed.count} · ${num(s.themed.afterYears.median)} · ${counts(s.themed.reads)} | ${s.unlinked} | ${s.interludeAfter} |`);
  }
  lines.push('');
  lines.push('| Campaign / policy / first mode | First altered page, elapsed q25 / median / q75 | Prompts before it | Truthful Records before it | First Record offer, elapsed median | Commonest first altered templates | Column: runs with no interlude · first interlude elapsed q25 / median / q75 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    const e = s.source.elapsed;
    const f = s.firstInterludeElapsed;
    const top = s.sources.map(([id, n]) => `${id}: ${n}`).join(', ') || '—';
    lines.push(`| ${label(s)} | ${num(e.q25)} / ${num(e.median)} / ${num(e.q75)} | ${num(s.source.promptsBefore.median)} | ${num(s.source.truthfulBefore.median)} | ${num(s.firstOfferElapsed.median)} | ${top} | ${s.noInterlude} · ${num(f.q25)} / ${num(f.median)} / ${num(f.q75)} |`);
  }
  return lines;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('record-return-report.ts');
if (isMain) {
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const files = process.argv.slice(process.argv.indexOf('--summarise') + 1).filter((a) => !a.startsWith('--'));
  let rows: RecordReturnRun[];
  if (process.argv.includes('--summarise')) {
    rows = files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as RecordReturnRun[]);
  } else {
    const campaign = flag('campaign') ?? 'short';
    if (campaign !== 'short' && campaign !== 'long') throw new Error(`unknown campaign ${campaign}; one of short, long`);
    const policies = (flag('policy')?.split(',') ?? [...RECORD_RETURN_POLICIES]) as RecordReturnPolicy[];
    for (const p of policies) {
      if (!RECORD_RETURN_POLICIES.includes(p)) throw new Error(`unknown policy ${p}; one of ${RECORD_RETURN_POLICIES.join(', ')}`);
    }
    const runs = Number(process.argv.slice(2).find((a) => !a.startsWith('--'))) || RECORD_RETURN_DEFAULT_RUNS;
    rows = measureRecordReturns(loadContent(), runs, campaign, policies, Number(flag('offset') ?? 0));
    const output = flag('output');
    if (output) writeFileSync(output, JSON.stringify(rows, null, 2) + '\n');
  }
  console.log(recordReturnReport(summariseRecordReturns(rows)).join('\n'));
}
