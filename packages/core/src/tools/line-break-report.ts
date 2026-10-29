/**
 * WHEN DOES THE LINE BREAK? (issue #1993, steps 1–2).
 *
 *   npm run gate:line-breaks -- [runs] --campaign=short --policy=chronicler
 *   npm run gate:line-breaks -- 200 --campaign=short --policy=heir_match --output=rows.json
 *   npm run gate:line-breaks -- --summarise rows-a.json rows-b.json
 *
 * Read-only measurement. Nothing here changes a rule, a constant or a piece of
 * content, and no number here is a CI threshold. The question is the one the
 * issue says is not known today: a first-time player most likely plays the
 * Short Line, and if their line ends before the first interlude they never meet
 * the frame, the Ledger or the reading. This reports WHEN lines break, against
 * what the player had been shown by then.
 *
 * ─── What is recorded per run ───────────────────────────────────────────────
 *
 * - The terminal `broken_line` year, in calendar and elapsed years. Elapsed is
 *   `year - campaign.startYear`; #132's "median 76 years after founding" was
 *   elapsed too (both campaigns found in 1042).
 * - The first interlude ACTUALLY DELIVERED: the first `world.frame.entries`
 *   row, which is what `presentFrame` writes when it shows one. A run with no
 *   interlude keeps that status: no year is substituted for a missing one.
 * - Every `the_last_of_the_line` offer (the Head's docket held it) with the
 *   living blood at the time and how it was answered. That event declares no
 *   `bloodCount` condition, so it is a rare Head scene that may fire at any
 *   size of family: an offer is reported with its blood count, never read as
 *   "the one-survivor rescue was offered".
 * - The thin window before a break: years ending with one or two of the blood.
 *
 * Surviving runs are right-censored at their term. They are counted in every
 * all-run denominator and never in a conditional break-year quantile.
 *
 * ─── The two policies ──────────────────────────────────────────────────────
 *
 * `chronicler` is `playToTheEnd`'s chronicler loop, byte for byte: the same
 * salt (`'ending-batch'`), the same docket loop, the same naming-queue clear.
 * `line-break-report.test.ts` pins that the same seed plays the same house.
 *
 * `heir_match` answers the Match for the sitting Head and the heir apparent
 * itself. The chronicler already takes an open card whenever a hand has one
 * (`autoTakeCard` declines only when nothing is takeable), so this policy does
 * not differ by taking MORE Matches: it differs by WHICH card. It takes the
 * open card the card's own face reads as best for continuity — `matchFuture`
 * with continuity as the priority, then the line read, then lower kinship,
 * then the smaller dowry — through the public `resolveMatch` verb. A hand it
 * cannot answer that way, every other Match and every other decision fall
 * back to the chronicler's own `autoResolveDecision`. Card faces only: no
 * genome, no Fecundity, nothing a player could not read.
 *
 * Both columns play with no Table orders and the default Library inputs:
 * `bidCeiling` 0 (no auction purchases), the starting shelf, no Scion.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { indexContent, MAIN_BRANCH, type CampaignId, type Content, type ContentBundle, type EndingId } from '@ed/schema';
import { clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { makeRng, hashSeed } from '../rng.js';
import { autoResolveAll, autoResolveDecision, resolveMatch } from '../events/decisions.js';
import { closeTheLedger, livingBlood } from '../ending.js';
import { campaignDef } from '../campaign.js';
import { matchFuture, type LineRead, type MatchCard } from '../people/match.js';
import { heirApparent } from '../people/succession.js';
import { speakerOf } from '../people/branches.js';
import { bootstrapRun } from '../run-setup.js';
import type { SimCtx } from '../world.js';
import { binomialInterval } from './story-route-report.js';
import {
  gatePartitionWorkerCount,
  partitionGateInputs,
  reduceGatePartitions,
  runGatePartitionsInWorkers,
  type GatePartition,
  type GatePartitionResult,
} from './gate-partition.js';

type Source = ContentBundle | Content;

export const LINE_BREAK_POLICIES = ['chronicler', 'heir_match'] as const;
export type LineBreakPolicy = typeof LINE_BREAK_POLICIES[number];

/** Declared on #1993 before the first batch: seed `i` of a column is this plus `i`. */
export const LINE_BREAK_SEED_START = 199_300;
export const LINE_BREAK_DEFAULT_RUNS = 200;

/** The rare Head scene the issue names. */
export const LAST_OF_THE_LINE = 'the_last_of_the_line';

/** Elapsed-year cut the issue asks about; elapsed, not calendar. */
export const EARLY_BREAK_ELAPSED = 100;

export interface LastOfLineOffer {
  year: number;
  elapsed: number;
  /** Living blood when the scene stood on the docket. */
  blood: number;
  /** The choice taken; null when the docket dropped it unanswered. */
  answer: string | null;
}

export interface LineBreakRun {
  seed: number;
  campaign: CampaignId;
  policy: LineBreakPolicy;
  /** Undefined only when a short `years` stopped the loop before the term. */
  ending?: EndingId;
  broke: boolean;
  breakYear?: number;
  breakElapsed?: number;
  /** Elapsed years played; the censoring point for a survivor. */
  playedElapsed: number;
  firstInterludeYear?: number;
  firstInterludeElapsed?: number;
  interludes: number;
  offers: LastOfLineOffer[];
  /** Elapsed year of the first year that ended with one or two of the blood. */
  firstThinElapsed?: number;
  /** Years ending with one or two living blood. */
  thinYears: number;
  /** Years ending with exactly one living blood. */
  oneBloodYears: number;
  /** Living blood, and everyone under the roof, when the run stopped. */
  bloodAtEnd: number;
  householdAtEnd: number;
  /** Match hands the policy itself answered for the Head or heir apparent. */
  heirMatchesTaken: number;
  matchesTaken: number;
  matchesDeclined: number;
}

const LINE_RANK: Record<LineRead, number> = { fertile: 3, ordinary: 2, unknown: 1, thin: 0 };

/**
 * The open card whose own face reads best for continuity. Returns undefined
 * when nothing is takeable, so the caller falls back to the chronicler.
 */
export function continuityCard(cards: readonly MatchCard[]): MatchCard | undefined {
  const open = cards.filter((c) => c.available);
  const reads = (c: MatchCard) => matchFuture(c, ['continuity']).kind === 'continuity' ? 1 : 0;
  return [...open].sort((a, b) =>
    reads(b) - reads(a)
    || LINE_RANK[b.line] - LINE_RANK[a.line]
    || a.kinship - b.kinship
    || a.dowry - b.dowry
    || a.id.localeCompare(b.id))[0];
}

function heirSubject(ctx: SimCtx, subject: string): boolean {
  return speakerOf(ctx, MAIN_BRANCH)?.id === subject || heirApparent(ctx)?.id === subject;
}

/** One run to the term or the break, recording only what the report reads. */
export function playLineBreakRun(
  source: Source,
  seed: number,
  campaign: CampaignId,
  policy: LineBreakPolicy,
  years = campaignDef(campaign).years,
  /** Reads the finished world; the parity test compares it with `playToTheEnd`. */
  onEnd?: (ctx: SimCtx) => void,
): LineBreakRun {
  const def = campaignDef(campaign);
  const ctx = bootstrapRun(indexContent(source), seed, { campaign });
  const w = ctx.world;
  const offers = new Map<string, LastOfLineOffer>();
  let matchesTaken = 0;
  let matchesDeclined = 0;
  ctx.observeDecision = ({ decision, answer }) => {
    if (decision.kind === 'match') {
      if (answer === null) matchesDeclined++;
      else matchesTaken++;
    } else if (decision.kind === 'choice' && decision.event.id === LAST_OF_THE_LINE) {
      const offer = offers.get(decision.id);
      if (offer) offer.answer = answer;
    }
  };

  let firstThinElapsed: number | undefined;
  let thinYears = 0;
  let oneBloodYears = 0;
  let heirMatchesTaken = 0;
  for (let y = 0; y < years; y++) {
    if (w.year >= def.endYear || w.ending) break;
    stepYear(ctx, false);

    const blood = livingBlood(w);
    for (const d of w.pendingDecisions) {
      if (d.kind === 'choice' && d.event.id === LAST_OF_THE_LINE && !offers.has(d.id)) {
        offers.set(d.id, { year: w.year, elapsed: w.year - def.startYear, blood, answer: null });
      }
    }
    if (blood > 0 && blood <= 2) {
      thinYears++;
      firstThinElapsed ??= w.year - def.startYear;
      if (blood === 1) oneBloodYears++;
    }

    if (policy === 'chronicler') {
      // `playToTheEnd`'s loop exactly, so the column is the shipped default.
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        autoResolveAll(ctx, makeRng(hashSeed(seed, 'ending-batch', w.year, guard)));
      }
    } else {
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 400) {
        const d = w.pendingDecisions[0]!;
        if (d.kind === 'match' && heirSubject(ctx, d.subject.id)) {
          const card = continuityCard(d.cards);
          if (card && resolveMatch(ctx, d.id, card.id).ok) {
            heirMatchesTaken++;
            continue;
          }
        }
        autoResolveDecision(ctx, d, makeRng(hashSeed(seed, 'line-break-heir', w.year, guard)));
      }
    }
    clearNamingQueue(ctx);
  }
  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  onEnd?.(ctx);

  const broke = w.ending?.id === 'broken_line';
  const first = w.frame.entries[0];
  return {
    seed,
    campaign,
    policy,
    ...(w.ending ? { ending: w.ending.id } : {}),
    broke,
    ...(broke ? { breakYear: w.ending!.year, breakElapsed: w.ending!.year - def.startYear } : {}),
    playedElapsed: (w.ending?.year ?? w.year) - def.startYear,
    ...(first ? { firstInterludeYear: first.year, firstInterludeElapsed: first.year - def.startYear } : {}),
    interludes: w.frame.entries.length,
    offers: [...offers.values()],
    ...(firstThinElapsed !== undefined ? { firstThinElapsed } : {}),
    thinYears,
    oneBloodYears,
    bloodAtEnd: livingBlood(w),
    householdAtEnd: w.people.household(w.playerHouse, w.year).length,
    heirMatchesTaken,
    matchesTaken,
    matchesDeclined,
  };
}

export interface LineBreakInput { seed: number; policy: LineBreakPolicy }

export function lineBreakInputs(runs: number, policies: readonly LineBreakPolicy[], offset = 0): LineBreakInput[] {
  return policies.flatMap((policy) =>
    Array.from({ length: runs }, (_, i) => ({ seed: LINE_BREAK_SEED_START + offset + i, policy })));
}

/** Raw observations for one worker's slice; the reducer restores the order. */
export function runLineBreakPartition(
  source: Source,
  partition: GatePartition<LineBreakInput>,
  campaign: CampaignId,
): GatePartitionResult<LineBreakRun> {
  const content = indexContent(source);
  return {
    id: partition.id,
    observations: partition.items.map(({ index, input }) => ({
      index,
      value: playLineBreakRun(content, input.seed, campaign, input.policy),
    })),
  };
}

export function measureLineBreaks(
  source: Source,
  runs: number,
  campaign: CampaignId,
  policies: readonly LineBreakPolicy[],
  offset = 0,
): LineBreakRun[] {
  const content = indexContent(source);
  const plan = partitionGateInputs(lineBreakInputs(runs, policies, offset), gatePartitionWorkerCount());
  const results = plan.length === 1
    ? plan.map((partition) => runLineBreakPartition(content, partition, campaign))
    : runGatePartitionsInWorkers<LineBreakInput, LineBreakRun>(plan, {
      moduleUrl: import.meta.url,
      exportName: 'runLineBreakPartition',
      argsBefore: [content.bundle],
      argsAfter: [campaign],
    });
  return reduceGatePartitions(plan, results);
}

// ─── The reduction ──────────────────────────────────────────────────────────

/** Linear-interpolation quantile (type 7) over sorted values. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * Distribution-free ~95% interval for the median from order statistics
 * (normal approximation to the binomial ranks). Null below six values, where
 * the interval is the whole range and claiming one would be decoration.
 */
export function medianInterval(sorted: readonly number[]): { lower: number; upper: number } | null {
  const n = sorted.length;
  if (n < 6) return null;
  const half = 0.98 * Math.sqrt(n);
  const lo = Math.max(1, Math.floor(n / 2 - half));
  const hi = Math.min(n, Math.ceil(n / 2 + 1 + half));
  return { lower: sorted[lo - 1]!, upper: sorted[hi - 1]! };
}

export const BREAK_BUCKETS: readonly [number, number][] = [
  [0, 25], [25, 50], [50, 100], [100, 150], [150, 200], [200, 300], [300, 500],
];

export interface LineBreakSummary {
  campaign: CampaignId;
  policy: LineBreakPolicy;
  runs: number;
  broke: ReturnType<typeof binomialInterval>;
  /** All-run shares: hits over every run in the column. */
  brokeBeforeInterlude: ReturnType<typeof binomialInterval>;
  brokeBeforeElapsed100: ReturnType<typeof binomialInterval>;
  /** Conditional on breaking. */
  beforeInterludeGivenBreak: ReturnType<typeof binomialInterval>;
  beforeElapsed100GivenBreak: ReturnType<typeof binomialInterval>;
  /** Runs, broken or not, that never delivered an interlude. */
  noInterlude: number;
  survivorsCensored: number;
  breakElapsed: { n: number; min: number | null; q25: number | null; median: number | null; q75: number | null; max: number | null; medianCi: { lower: number; upper: number } | null };
  breakBuckets: { from: number; to: number; count: number }[];
  firstInterludeElapsed: { n: number; median: number | null; q75: number | null; max: number | null };
  /** Broken runs that had a `the_last_of_the_line` offer before the break. */
  offeredBeforeBreak: number;
  offers: { total: number; atOneBlood: number; answers: Record<string, number> };
  /** Broken runs that spent any year with exactly one of the blood. */
  brokeAfterOneBloodYear: number;
  thinYearsBeforeBreak: { median: number | null; q75: number | null };
  endings: Record<string, number>;
}

export function summariseLineBreaks(rows: readonly LineBreakRun[]): LineBreakSummary[] {
  const keys = [...new Set(rows.map((r) => `${r.campaign}/${r.policy}`))];
  return keys.map((key) => {
    const col = rows.filter((r) => `${r.campaign}/${r.policy}` === key);
    const broken = col.filter((r) => r.broke);
    const beforeInterlude = broken.filter((r) => r.interludes === 0);
    const early = broken.filter((r) => r.breakElapsed! < EARLY_BREAK_ELAPSED);
    const sorted = broken.map((r) => r.breakElapsed!).sort((a, b) => a - b);
    const interludeAt = col.filter((r) => r.firstInterludeElapsed !== undefined)
      .map((r) => r.firstInterludeElapsed!).sort((a, b) => a - b);
    const thin = broken.map((r) => r.thinYears).sort((a, b) => a - b);
    const offers = col.flatMap((r) => r.offers);
    const answers: Record<string, number> = {};
    for (const o of offers) answers[o.answer ?? 'unanswered'] = (answers[o.answer ?? 'unanswered'] ?? 0) + 1;
    const endings: Record<string, number> = {};
    for (const r of col) endings[r.ending ?? 'unfinished'] = (endings[r.ending ?? 'unfinished'] ?? 0) + 1;
    return {
      campaign: col[0]!.campaign,
      policy: col[0]!.policy,
      runs: col.length,
      broke: binomialInterval(broken.length, col.length),
      brokeBeforeInterlude: binomialInterval(beforeInterlude.length, col.length),
      brokeBeforeElapsed100: binomialInterval(early.length, col.length),
      beforeInterludeGivenBreak: binomialInterval(beforeInterlude.length, broken.length),
      beforeElapsed100GivenBreak: binomialInterval(early.length, broken.length),
      noInterlude: col.filter((r) => r.interludes === 0).length,
      survivorsCensored: col.length - broken.length,
      breakElapsed: {
        n: sorted.length,
        min: sorted[0] ?? null,
        q25: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        q75: quantile(sorted, 0.75),
        max: sorted.at(-1) ?? null,
        medianCi: medianInterval(sorted),
      },
      breakBuckets: BREAK_BUCKETS.map(([from, to]) => ({
        from, to, count: sorted.filter((v) => v >= from && v < to).length,
      })),
      firstInterludeElapsed: {
        n: interludeAt.length,
        median: quantile(interludeAt, 0.5),
        q75: quantile(interludeAt, 0.75),
        max: interludeAt.at(-1) ?? null,
      },
      offeredBeforeBreak: broken.filter((r) => r.offers.some((o) => o.year <= r.breakYear!)).length,
      offers: { total: offers.length, atOneBlood: offers.filter((o) => o.blood === 1).length, answers },
      brokeAfterOneBloodYear: broken.filter((r) => r.oneBloodYears > 0).length,
      thinYearsBeforeBreak: { median: quantile(thin, 0.5), q75: quantile(thin, 0.75) },
      endings,
    };
  });
}

const pct = (x: number | null) => x === null ? '—' : `${(100 * x).toFixed(1)}%`;
const share = (b: ReturnType<typeof binomialInterval>) =>
  `${b.hits}/${b.n} = ${pct(b.rate)} [${pct(b.lower)}, ${pct(b.upper)}]`;
const num = (x: number | null) => x === null ? '—' : String(Math.round(x * 10) / 10);

export function lineBreakReport(summaries: readonly LineBreakSummary[]): string[] {
  const lines: string[] = [];
  lines.push('| Campaign / policy | Broke (all runs) | Broke before first interlude (all runs) | Broke before elapsed 100 (all runs) | Before interlude, given break | Before elapsed 100, given break |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    lines.push(`| ${s.campaign} / ${s.policy} | ${share(s.broke)} | ${share(s.brokeBeforeInterlude)} | ${share(s.brokeBeforeElapsed100)} | ${share(s.beforeInterludeGivenBreak)} | ${share(s.beforeElapsed100GivenBreak)} |`);
  }
  lines.push('');
  lines.push('| Campaign / policy | Break elapsed n · min / q25 / median / q75 / max | Median ~95% CI | Survivors censored at term | Runs with no interlude | First interlude elapsed n · median / q75 / max |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    const b = s.breakElapsed;
    const ci = b.medianCi ? `${b.medianCi.lower}–${b.medianCi.upper}` : '—';
    const f = s.firstInterludeElapsed;
    lines.push(`| ${s.campaign} / ${s.policy} | ${b.n} · ${num(b.min)} / ${num(b.q25)} / ${num(b.median)} / ${num(b.q75)} / ${num(b.max)} | ${ci} | ${s.survivorsCensored} | ${s.noInterlude} | ${f.n} · ${num(f.median)} / ${num(f.q75)} / ${num(f.max)} |`);
  }
  lines.push('');
  lines.push(`| Campaign / policy | Breaks by elapsed year (${BREAK_BUCKETS.map(([a, b]) => `${a}–${b}`).join(', ')}) |`);
  lines.push('| --- | --- |');
  for (const s of summaries) {
    lines.push(`| ${s.campaign} / ${s.policy} | ${s.breakBuckets.map((b) => b.count).join(', ')} |`);
  }
  lines.push('');
  lines.push(`| Campaign / policy | \`${LAST_OF_THE_LINE}\` offers · at one blood · answers | Broken runs offered it first | Broken runs with a one-blood year | Thin (≤2 blood) years before break, median / q75 | Endings |`);
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of summaries) {
    const answers = Object.entries(s.offers.answers).sort().map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
    const endings = Object.entries(s.endings).sort().map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`| ${s.campaign} / ${s.policy} | ${s.offers.total} · ${s.offers.atOneBlood} · ${answers} | ${s.offeredBeforeBreak}/${s.broke.hits} | ${s.brokeAfterOneBloodYear}/${s.broke.hits} | ${num(s.thinYearsBeforeBreak.median)} / ${num(s.thinYearsBeforeBreak.q75)} | ${endings} |`);
  }
  return lines;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('line-break-report.ts');
if (isMain) {
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const files = process.argv.slice(process.argv.indexOf('--summarise') + 1).filter((a) => !a.startsWith('--'));
  let rows: LineBreakRun[];
  if (process.argv.includes('--summarise')) {
    rows = files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as LineBreakRun[]);
  } else {
    const campaign = flag('campaign') ?? 'short';
    if (campaign !== 'short' && campaign !== 'long') throw new Error(`unknown campaign ${campaign}; one of short, long`);
    const policies = (flag('policy')?.split(',') ?? [...LINE_BREAK_POLICIES]) as LineBreakPolicy[];
    for (const p of policies) {
      if (!LINE_BREAK_POLICIES.includes(p)) throw new Error(`unknown policy ${p}; one of ${LINE_BREAK_POLICIES.join(', ')}`);
    }
    const runs = Number(process.argv.slice(2).find((a) => !a.startsWith('--'))) || LINE_BREAK_DEFAULT_RUNS;
    rows = measureLineBreaks(loadContent(), runs, campaign, policies, Number(flag('offset') ?? 0));
    const output = flag('output');
    if (output) writeFileSync(output, JSON.stringify(rows, null, 2) + '\n');
  }
  console.log(lineBreakReport(summariseLineBreaks(rows)).join('\n'));
}
