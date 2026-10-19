/**
 * WHERE DOES THE LADDER STALL, AND FOR WHOM? (issue #1801's instrument)
 *
 *   npm run gate:stall -- [runs] [years] [policies]
 *   npm run gate:stall -- 24 500 chronicler,ascendant
 *   npm run gate:stall -- 96 500 chronicler,ascendant --population --output=long.json
 *   npm run gate:stall -- 24 300 chronicler,ascendant --campaign=short --population
 *   npm run gate:stall -- 24 500 chronicler,bid,ascendant --forcing --output=forcing.json
 *
 * The ladder froze for 30-34% of a Long Line's years when this was first
 * measured (17 Oct 2026, `Suggestions.md` G1): no living man of the house who
 * can express had woken, so nobody stood on the ladder at all. That figure
 * came from a scratch diagnostic that was never committed, and four issues
 * (#1801, #1802, #1817, #1818) each said "re-run the same 72-run
 * diagnostic". This is that diagnostic, in the repository, so a balance
 * change to who wakes can be measured on the seeds it was first measured on.
 *
 * The default is read-only. `--forcing` adds one deliberate full forcing
 * attempt per year, selected from the public Table, and records direct costs.
 * It plays the same houses `gate:endings` plays — `chronicler`
 * with the `'ending-batch'` salt, `ascendant` through `configureAscendant`
 * and its two per-year helpers — plus `bid`, the chronicler with a 600-crown
 * auction ceiling. Every reading goes through the engine's own functions
 * (`foremostOf`, `phenotypeOf`); nothing here decides anything or draws from
 * a simulation stream.
 *
 * A FROZEN YEAR is one in which the house has no living, woken man who can
 * express. It is split three ways, because the three want different fixes:
 *   - `grownWaiting`: a man of twenty or more who can express has not woken
 *     (and was not declared mundane). The awakening odds are the lever — but
 *     only for a man under LATE_WAKING_AGE. Past it only the Late Waking can
 *     reach him, so `pastWindow` counts the years in which every grown man
 *     waiting is already past it: men the odds failed decades earlier.
 *   - `noExpresser`: no living man of the house can express at all. Only
 *     the Match is a lever.
 *   - `onlyBoys`: every unwoken expresser is a boy still inside the common
 *     window. That is the wait §7 asks for.
 *
 * NEVER (§11) is measured too: of the expressing men of the blood who died
 * at thirty or older, how many died never having woken. Raising the odds
 * must leave that above zero — "Never" is a real outcome.
 */
import { loadContent } from '@ed/content';
import { writeFileSync } from 'node:fs';
import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { makeRng, hashSeed } from '../rng.js';
import { autoResolveAll, type DecisionObservation } from '../events/decisions.js';
import { campaignDef } from '../campaign.js';
import type { CampaignId } from '@ed/schema';
import { closeTheLedger } from '../ending.js';
import { foremostOf, rungIndex, standingOf, type Rung } from '../ascension.js';
import { phenotypeOf, LATE_WAKING_AGE } from '../people/factory.js';
import type { SimCtx } from '../world.js';
import { configureAscendant, prepareAscendantYear, resolveAscendantYear, type PolicyOrderVisit } from './ending-gate.js';
import type { YearReport } from '../year/report.js';
import { emptyForcingStats, observeForcingCosts, tryForcingRite, type ForcingStats } from './forcing-policy.js';
import { resolveYear } from './ladder-policy.js';
import {
  gatePartitionWorkerCount,
  partitionGateInputs,
  reduceGatePartitions,
  runGatePartitionsInWorkers,
  type GatePartition,
  type GatePartitionResult,
} from './gate-partition.js';

type Source = ContentBundle | Content;

export type StallPolicy = 'chronicler' | 'bid' | 'ascendant';
export const STALL_POLICIES: readonly StallPolicy[] = ['chronicler', 'bid', 'ascendant'];

/** The seeds the 17 Oct 2026 figures were published on. */
export const STALL_SEED_START = 5100;
export const STALL_DEFAULT_RUNS = 24;

/** A grown man, for the frozen-year split. */
const GROWN = 20;

/** One year's reading of the house, before it is folded into a run. */
export interface StallYear {
  /** Living men of the house who can express. */
  expressers: number;
  /** ...of whom have woken. */
  awake: number;
  /** Of the unwoken expressers, how many are grown and not declared mundane. */
  grownWaiting: number;
  /** ...of whom are still under LATE_WAKING_AGE, so a natural waking can reach them. */
  inWindow: number;
  /** The foremost man's first unmet gate, or 'no-expresser'. */
  blocker: string;
  rung?: Rung;
}

export interface StallRun {
  seed: number;
  policy: StallPolicy;
  years: number;
  frozen: number;
  /** Frozen years split by what the house was waiting on. */
  grownWaiting: number;
  /** Of `grownWaiting`: every grown man waiting is past LATE_WAKING_AGE. */
  pastWindow: number;
  noExpresser: number;
  onlyBoys: number;
  stretches: number;
  longest: number;
  /** Summed over years, so a batch mean is `expresserYears / years`. */
  expresserYears: number;
  awakeYears: number;
  blockers: Record<string, number>;
  best: Rung;
  ending?: string;
  /** Expressing men of the blood who died at LATE_WAKING_AGE or older... */
  diedGrown: number;
  /** ...and how many of those never woke. */
  diedNeverWoke: number;
  /** Optional #1802 diagnostic; default stall reports retain their old shape. */
  population?: StallPopulation;
  /** The saved annual high-water mark, distinct from the post-resolution reading `best`. */
  attainedBest?: Rung;
  /** Optional public forcing policy; absent in the original baseline. */
  forcing?: ForcingStats;
}

export interface StallPopulation {
  campaign: CampaignId;
  maxPower: number;
  /** Every living household expresser-year, including unwoken men and boys. */
  raw: number[];
  awakeRaw: number[];
  /** The subset currently standing at Adept or above. */
  adeptRaw: number[];
  /** Excludes the two rites which directly widen expressed power. */
  preRiteRaw: number[];
  shelfPeak: number;
  /** Best-read living HOUSEHOLD member, including women and mundane men. */
  readerPeak: number;
  expresserReaderPeak: number;
}

export function emptyStallPopulation(ctx: SimCtx): StallPopulation {
  return {
    campaign: ctx.world.campaign, maxPower: ctx.genetics.maxPower,
    raw: [], awakeRaw: [], adeptRaw: [], preRiteRaw: [], shelfPeak: 0, readerPeak: 0,
    expresserReaderPeak: 0,
  };
}

/** Read after annual decisions, at the same boundary as the frozen-year tally. */
export function observeStallPopulation(ctx: SimCtx, sample: StallPopulation): void {
  const w = ctx.world;
  sample.shelfPeak = Math.max(sample.shelfPeak, w.library.size);
  for (const p of w.people.household(w.playerHouse, w.year)) {
    sample.readerPeak = Math.max(sample.readerPeak, p.spellsKnown.length);
    const ph = phenotypeOf(p, ctx.genetics, w.year);
    if (!ph.eldritch.canExpress) continue;
    sample.raw.push(ph.eldritch.expressedPower);
    sample.expresserReaderPeak = Math.max(sample.expresserReaderPeak, p.spellsKnown.length);
    if (p.awakening.awakened) sample.awakeRaw.push(ph.eldritch.expressedPower);
    if (!p.rites.includes('great_rite') && !p.rites.includes('unmaking')) {
      sample.preRiteRaw.push(ph.eldritch.expressedPower);
    }
    if (rungIndex(standingOf(ctx, p).rung) >= rungIndex('adept')) {
      sample.adeptRaw.push(ph.eldritch.expressedPower);
    }
  }
}

/** Empirical order statistics, preserving input order for paired raw reports. */
export function populationStats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { n: sorted.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: sorted.at(-1) ?? null };
}

/** Reads the house as it stands. Pure: no stream is drawn, nothing is written. */
export function readStallYear(ctx: SimCtx): StallYear {
  const w = ctx.world;
  let expressers = 0;
  let awake = 0;
  let grownWaiting = 0;
  let inWindow = 0;
  for (const p of w.people.household(w.playerHouse, w.year)) {
    if (!phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress) continue;
    expressers++;
    if (p.awakening.awakened) awake++;
    else if (w.year - p.born >= GROWN && !p.awakening.declaredMundane) {
      grownWaiting++;
      if (w.year - p.born < LATE_WAKING_AGE) inWindow++;
    }
  }
  const top = foremostOf(ctx);
  return top
    ? { expressers, awake, grownWaiting, inWindow, blocker: top.standing.blocker, rung: top.standing.rung }
    : { expressers, awake, grownWaiting, inWindow, blocker: 'no-expresser' };
}

export function emptyStallRun(seed: number, policy: StallPolicy): StallRun {
  return {
    seed, policy, years: 0, frozen: 0, grownWaiting: 0, pastWindow: 0, noExpresser: 0, onlyBoys: 0,
    stretches: 0, longest: 0, expresserYears: 0, awakeYears: 0, blockers: {}, best: 'none',
    diedGrown: 0, diedNeverWoke: 0,
  };
}

/**
 * Folds one year into a run. `streak` is the length of the frozen stretch the
 * previous year ended on, and the return value is this year's.
 */
export function foldStallYear(run: StallRun, year: StallYear, streak: number): number {
  run.years++;
  run.expresserYears += year.expressers;
  run.awakeYears += year.awake;
  run.blockers[year.blocker] = (run.blockers[year.blocker] ?? 0) + 1;
  if (year.rung && rungIndex(year.rung) > rungIndex(run.best)) run.best = year.rung;
  if (year.awake > 0) return 0;

  run.frozen++;
  if (year.expressers === 0) run.noExpresser++;
  else if (year.grownWaiting > 0) {
    run.grownWaiting++;
    if (year.inWindow === 0) run.pastWindow++;
  }
  else run.onlyBoys++;
  if (streak === 0) run.stretches++;
  run.longest = Math.max(run.longest, streak + 1);
  return streak + 1;
}

/** §11's "Never", read off the dead at the end of a run. */
export function countNever(ctx: SimCtx, run: StallRun): void {
  const w = ctx.world;
  for (const p of w.people.blood(w.playerHouse)) {
    if (p.sex !== 'male' || p.died === undefined || p.died - p.born < LATE_WAKING_AGE) continue;
    if (!phenotypeOf(p, ctx.genetics, p.died).eldritch.canExpress) continue;
    run.diedGrown++;
    if (!p.awakening.awakened) run.diedNeverWoke++;
  }
}

/** One played run, by the same policies `gate:endings` plays. */
export interface StallObserver {
  beforeYear?: (ctx: SimCtx) => void;
  afterStep?: (ctx: SimCtx, report: YearReport) => void;
  decision?: (ctx: SimCtx, answer: DecisionObservation) => void;
  order?: (ctx: SimCtx, visit: PolicyOrderVisit) => void;
  afterYear?: (ctx: SimCtx) => void;
  finish?: (ctx: SimCtx) => void;
}

export function playStallRun(
  source: Source,
  seed: number,
  years: number,
  policy: StallPolicy,
  campaign: CampaignId = 'long',
  population = false,
  observer?: StallObserver,
  forcing = false,
): StallRun {
  const def = campaignDef(campaign);
  const ctx = bootstrap(indexContent(source), seed, def.startYear, campaign);
  const w = ctx.world;
  if (observer?.decision) ctx.observeDecision = (answer) => observer.decision!(ctx, answer);
  const observeOrder = observer?.order ? (visit: PolicyOrderVisit) => observer.order!(ctx, visit) : undefined;
  if (policy === 'ascendant') configureAscendant(ctx);
  if (policy === 'bid') w.bidCeiling = 600;
  const tally = { asked: 0, paid: 0 };
  const run = emptyStallRun(seed, policy);
  if (forcing) {
    run.forcing = emptyForcingStats();
    observeForcingCosts(ctx, run.forcing);
  }
  if (population) run.population = emptyStallPopulation(ctx);
  let streak = 0;

  for (let y = 0; y < years; y++) {
    if (w.year >= def.endYear || w.ending) break;
    observer?.beforeYear?.(ctx);
    if (policy === 'ascendant') prepareAscendantYear(ctx, observeOrder);
    const report = stepYear(ctx, false);
    observer?.afterStep?.(ctx, report);
    if (policy === 'ascendant') resolveAscendantYear(ctx, seed, tally, observeOrder);
    else {
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        autoResolveAll(ctx, makeRng(hashSeed(seed, 'ending-batch', w.year, guard)));
      }
    }
    if (run.forcing && !w.ending && w.year < def.endYear && tryForcingRite(ctx, seed, run.forcing)) {
      // Resolve only the new docket, without trying the upper rites a second time.
      if (policy === 'ascendant') resolveYear(ctx, seed, 'ascendant', tally);
      else autoResolveAll(ctx, makeRng(hashSeed(seed, 'forcing-record', w.year)));
    }
    clearNamingQueue(ctx);
    streak = foldStallYear(run, readStallYear(ctx), streak);
    if (run.population) observeStallPopulation(ctx, run.population);
    observer?.afterYear?.(ctx);
  }
  // `closeTheLedger` runs inside `stepYear` on the year AFTER the term, which
  // this loop never takes — `playToTheEnd` reads the ending the same way.
  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  countNever(ctx, run);
  if (w.ending) run.ending = w.ending.id;
  if (population) run.attainedBest = w.ascension.best;
  observer?.finish?.(ctx);
  return run;
}

const pct = (n: number, d: number) => (d ? `${(100 * n / d).toFixed(1)}%` : '—');
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The tables `Suggestions.md` G1 quotes, for one policy's runs. */
export function stallReport(runs: readonly StallRun[]): string[] {
  if (!runs.length) return [];
  const sum = (f: (r: StallRun) => number) => runs.reduce((n, r) => n + f(r), 0);
  const years = sum((r) => r.years);
  const frozen = sum((r) => r.frozen);
  const lines = [
    `${runs[0]!.policy}: ${runs.length} runs, ${years} years`,
    `  frozen ${pct(frozen, years)} of years · ${(frozen / runs.length).toFixed(1)} per run`
    + ` · ${(sum((r) => r.stretches) / runs.length).toFixed(1)} stretches per run`,
    `  longest stretch: median ${median(runs.map((r) => r.longest))}`
    + ` · worst ${Math.max(...runs.map((r) => r.longest))}`,
    `  within frozen years: grown man waiting ${pct(sum((r) => r.grownWaiting), frozen)}`
    + ` (all past ${LATE_WAKING_AGE}: ${pct(sum((r) => r.pastWindow), frozen)})`
    + ` · no expresser ${pct(sum((r) => r.noExpresser), frozen)}`
    + ` · only boys ${pct(sum((r) => r.onlyBoys), frozen)}`,
    `  expressers alive ${(sum((r) => r.expresserYears) / years).toFixed(2)}`
    + ` · awake ${(sum((r) => r.awakeYears) / years).toFixed(2)}`,
    `  never (§11): ${sum((r) => r.diedNeverWoke)} of ${sum((r) => r.diedGrown)}`
    + ` expressing men dead at ${LATE_WAKING_AGE}+ never woke`
    + ` (${pct(sum((r) => r.diedNeverWoke), sum((r) => r.diedGrown))})`,
  ];
  const blockers: Record<string, number> = {};
  for (const r of runs) for (const [k, n] of Object.entries(r.blockers)) blockers[k] = (blockers[k] ?? 0) + n;
  lines.push('  foremost blocker: ' + Object.entries(blockers)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${pct(n, years)}`)
    .join(' · '));
  const best: Record<string, number> = {};
  for (const r of runs) best[r.best] = (best[r.best] ?? 0) + 1;
  lines.push('  best rung: ' + Object.entries(best)
    .sort((a, b) => rungIndex(b[0] as Rung) - rungIndex(a[0] as Rung))
    .map(([k, n]) => `${k} ${n}`)
    .join(' · '));
  const endings: Record<string, number> = {};
  for (const r of runs) endings[r.ending ?? 'none'] = (endings[r.ending ?? 'none'] ?? 0) + 1;
  lines.push('  endings: ' + Object.entries(endings).map(([k, n]) => `${k} ${n}`).join(' · '));
  if (runs.some((run) => run.forcing)) {
    const totals = emptyForcingStats();
    for (const run of runs) if (run.forcing) {
      for (const field of ['offered', 'taken', 'resolved', 'madness', 'deaths'] as const) {
        for (const [rite, n] of Object.entries(run.forcing[field])) totals[field][rite] = (totals[field][rite] ?? 0) + n;
      }
    }
    lines.push('  forcing (boy/rite offers, calls, all resolutions and direct costs): ' + JSON.stringify(totals));
  }
  const samples = runs.flatMap((r) => r.population ? [r.population] : []);
  if (samples.length) {
    lines.push('  population (n/p50/p90/p99/max): ' + JSON.stringify({
      raw: populationStats(samples.flatMap((p) => p.raw)),
      awakeRaw: populationStats(samples.flatMap((p) => p.awakeRaw)),
      preRiteRaw: populationStats(samples.flatMap((p) => p.preRiteRaw)),
      adeptRaw: populationStats(samples.flatMap((p) => p.adeptRaw)),
      shelfPeak: populationStats(samples.map((p) => p.shelfPeak)),
      householdReaderPeak: populationStats(samples.map((p) => p.readerPeak)),
      expresserReaderPeak: populationStats(samples.map((p) => p.expresserReaderPeak)),
    }));
    const reach = Object.fromEntries((['adept', 'hierophant', 'vessel', 'demigod', 'god'] as const)
      .map((rung) => [rung, runs.filter((r) => r.attainedBest !== undefined
        && rungIndex(r.attainedBest) >= rungIndex(rung)).length]));
    lines.push('  saved best at least: ' + JSON.stringify(reach));
  }
  return lines;
}

export interface StallInput { seed: number; policy: StallPolicy }

export function stallInputs(runs: number, policies: readonly StallPolicy[]): StallInput[] {
  return policies.flatMap((policy) =>
    Array.from({ length: runs }, (_, i) => ({ seed: STALL_SEED_START + i, policy })));
}

/** Raw observations for one worker's slice; the reducer restores the order. */
export function runStallPartition(
  source: Source,
  partition: GatePartition<StallInput>,
  years: number,
  campaign: CampaignId = 'long',
  population = false,
  forcing = false,
): GatePartitionResult<StallRun> {
  const content = indexContent(source);
  return {
    id: partition.id,
    observations: partition.items.map(({ index, input }) => ({
      index,
      value: playStallRun(content, input.seed, years, input.policy, campaign, population, undefined, forcing),
    })),
  };
}

export function measureStall(
  source: Source,
  runs: number,
  years: number,
  policies: readonly StallPolicy[],
  campaign: CampaignId = 'long',
  population = false,
  forcing = false,
): StallRun[] {
  const content = indexContent(source);
  const plan = partitionGateInputs(stallInputs(runs, policies), gatePartitionWorkerCount());
  const results = plan.length === 1
    ? plan.map((partition) => runStallPartition(content, partition, years, campaign, population, forcing))
    : runGatePartitionsInWorkers<StallInput, StallRun>(plan, {
      moduleUrl: import.meta.url,
      exportName: 'runStallPartition',
      argsBefore: [content.bundle],
      argsAfter: [years, campaign, population, forcing],
    });
  return reduceGatePartitions(plan, results);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('ladder-stall.ts');
if (isMain) {
  const campaignArg = process.argv.find((a) => a.startsWith('--campaign='))?.split('=')[1] ?? 'long';
  if (campaignArg !== 'short' && campaignArg !== 'long' && campaignArg !== 'demo') {
    throw new Error(`unknown campaign ${campaignArg}; one of demo, short, long`);
  }
  const campaign: CampaignId = campaignArg;
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const runs = Number(args[0]) || STALL_DEFAULT_RUNS;
  const years = Number(args[1]) || campaignDef(campaign).years;
  const policies = (args[2]?.split(',') ?? ['chronicler', 'ascendant']) as StallPolicy[];
  for (const p of policies) {
    if (!STALL_POLICIES.includes(p)) throw new Error(`unknown policy ${p}; one of ${STALL_POLICIES.join(', ')}`);
  }
  const played = measureStall(loadContent(), runs, years, policies, campaign, process.argv.includes('--population'), process.argv.includes('--forcing'));
  for (const p of policies) console.log(stallReport(played.filter((r) => r.policy === p)).join('\n'));
  if (process.argv.includes('--json')) console.log(JSON.stringify(played));
  const output = process.argv.find((a) => a.startsWith('--output='))?.slice('--output='.length);
  if (output) writeFileSync(output, JSON.stringify(played, null, 2) + '\n');
}
