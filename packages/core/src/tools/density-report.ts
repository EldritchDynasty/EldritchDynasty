import type { HouseAmbitionId } from '@ed/schema';
import { LADDER_BLOCKERS, type LadderBlocker } from '../ascension.js';
import type { ShapeGrain } from './shapes.js';
import { blockerLevers } from './stall.js';

export interface ShapeRepeat {
  run: number;
  age: number;
  runWithoutPredetermined: number;
  ageWithoutPredetermined: number;
}

export interface ShapeFrequency {
  shape: string;
  count: number;
  share: number;
}

export interface ShapeTops {
  /** Complete category-shape frequencies for this run; reporting truncates only after batch aggregation. */
  campaign: ShapeFrequency[];
  /** Complete category-shape frequencies keyed by the authored Age id. */
  ages: Record<string, ShapeFrequency[]>;
}

export function shapeFrequencies(
  counts: Iterable<readonly [string, number]>,
  total: number,
): ShapeFrequency[] {
  return [...counts]
    .map(([shape, count]) => ({ shape, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));
}

export interface FailureStreaks {
  check: number;
  order: number;
}

export interface RepeatedFailure {
  campaign: FailureStreaks;
  ages: Record<string, FailureStreaks>;
}

export interface AmbitionFlat {
  years: number;
  decisions: number;
}

export interface StallSpans {
  blockerSpan: Record<LadderBlocker, number>;
  actionableGap: Record<LadderBlocker, number>;
}

export interface DensityRun {
  seed: number;
  /** The term, or the line running out before it (issue #42). */
  years: number;
  generations: number;
  ages: number;
  choices: number;
  matches: number;
  records: number;
  names: number;
  /** The campaign-invariant pair, which is what a 300 and a 500 can be compared on. */
  perGeneration: number;
  perAge: number;
  repeatRun: number;
  repeatAge: number;
  /** Repetition by interaction mechanics rather than template identity (#271). */
  shapeRepeat: Record<ShapeGrain, ShapeRepeat>;
  /** Largest share held by one category shape in any complete 20-choice window. */
  shapeWindow: number;
  /** Longest uninterrupted years behind the same structured ladder blocker (#270). */
  blockerSpan: Record<LadderBlocker, number>;
  /** Longest same-blocker span with no currently offered verb that can move its predicate. */
  actionableGap: Record<LadderBlocker, number>;
  /** The same two readings scoped to each authored Age that was active in the sampled years. */
  stallAges: Record<string, StallSpans>;
  /** Longest unchanged ambition reading; raise_ascendant also moves when its foremost blocker changes. */
  ambitionFlat: Partial<Record<HouseAmbitionId, AmbitionFlat>>;
  /** The same flat-reading clock scoped to each authored Age. */
  ambitionFlatAges: Record<string, Partial<Record<HouseAmbitionId, AmbitionFlat>>>;
  /** Longest real failed-attempt streak for the same check/order and person. */
  repeatedFailure: RepeatedFailure;
  /** Choice presentations already settled by availability, shape or #219's guard. */
  predeterminedShare: number;
  /**
   * Complete category-shape frequencies for the campaign and each active Age.
   * The name is historical: the printed report takes the top ten only after
   * frequencies have been aggregated across the whole batch.
   */
  topShapes: ShapeTops;
  ordinary: number;
  reach: number;
  /** Surfaced choices the interruption guard classified as consequential. */
  meaningfulChoices: number;
  /** Surfaced Record questions the interruption guard classified as consequential. */
  meaningfulRecords: number;
  /** Diagnostic-only Regency and unwoken spans; absent from older fixtures. */
  diagnosticIntervals?: DiagnosticInterval[];
}

/** Before/after rows for #219, paired on the same seeds and answer policy. */
export function delegationDensityLines(rows: {
  term: number;
  before: DensityRun[];
  after: DensityRun[];
}[]): string[] {
  const out: string[] = [];
  const head = ['term', 'mode', 'choice', 'record', 'meaningful choice', 'meaningful record', 'interruptions'];
  const body: string[][] = [];
  for (const row of rows) {
    for (const [mode, runs] of [['before', row.before], ['delegated', row.after]] as const) {
      body.push([
        String(row.term),
        mode,
        mean(runs.map((x) => x.choices)).toFixed(1),
        mean(runs.map((x) => x.records)).toFixed(1),
        mean(runs.map((x) => x.meaningfulChoices)).toFixed(1),
        mean(runs.map((x) => x.meaningfulRecords)).toFixed(1),
        mean(runs.map((x) => x.choices + x.records + x.matches + x.names)).toFixed(1),
      ]);
    }
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
  out.push(line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line));
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * A row per term, so the two campaigns are read against each other rather than
 * from two printouts nobody put side by side. `± 2 se` is quoted on the two
 * numbers a band would be written from, because a band set inside its own
 * error bars is the failure `expectMean` exists to prevent.
 */
export function densityLines(rows: { term: number; runs: DensityRun[] }[]): string[] {
  const out: string[] = [];
  const head = ['term', 'runs', 'lived', 'gens', 'ages', 'choice', 'per gen', 'per age',
    'repeat run', 'repeat age', 'ordinary', 'reach', 'match', 'record', 'name'];
  const body = rows.map(({ term, runs }) => {
    const per = runs.map((r) => r.perGeneration);
    return [
      String(term),
      String(runs.length),
      mean(runs.map((r) => r.years)).toFixed(0),
      mean(runs.map((r) => r.generations)).toFixed(1),
      mean(runs.map((r) => r.ages)).toFixed(1),
      mean(runs.map((r) => r.choices)).toFixed(0),
      `${mean(per).toFixed(1)} ±${(2 * sd(per) / Math.sqrt(runs.length)).toFixed(1)}`,
      mean(runs.map((r) => r.perAge)).toFixed(1),
      `${(100 * mean(runs.map((r) => r.repeatRun))).toFixed(0)}%`,
      `${(100 * mean(runs.map((r) => r.repeatAge))).toFixed(0)}%`,
      mean(runs.map((r) => r.ordinary)).toFixed(1),
      mean(runs.map((r) => r.reach)).toFixed(0),
      mean(runs.map((r) => r.matches)).toFixed(0),
      mean(runs.map((r) => r.records)).toFixed(0),
      mean(runs.map((r) => r.names)).toFixed(0),
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  out.push(line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line));

  out.push('');
  const shapeHead = ['term', 'grain', 'repeat run', 'repeat age', 'run excl pred', 'age excl pred', 'window 20', 'predetermined'];
  const shapeBody: string[][] = [];
  for (const { term, runs } of rows) {
    for (const grain of ['kind', 'category'] as const) {
      shapeBody.push([
        String(term),
        grain,
        `${(100 * mean(runs.map((r) => r.shapeRepeat[grain].run))).toFixed(1)}%`,
        `${(100 * mean(runs.map((r) => r.shapeRepeat[grain].age))).toFixed(1)}%`,
        `${(100 * mean(runs.map((r) => r.shapeRepeat[grain].runWithoutPredetermined))).toFixed(1)}%`,
        `${(100 * mean(runs.map((r) => r.shapeRepeat[grain].ageWithoutPredetermined))).toFixed(1)}%`,
        grain === 'category'
          ? `${(100 * mean(runs.map((r) => r.shapeWindow))).toFixed(1)}%`
          : '-',
        `${(100 * mean(runs.map((r) => r.predeterminedShare))).toFixed(1)}%`,
      ]);
    }
  }
  const shapeWidths = shapeHead.map((h, i) => Math.max(h.length, ...shapeBody.map((b) => (b[i] ?? '').length)));
  const shapeLine = (cells: string[]) => cells.map((c, i) => c.padEnd(shapeWidths[i]!)).join('  ');
  out.push(shapeLine(shapeHead), shapeLine(shapeWidths.map((w) => '-'.repeat(w))), ...shapeBody.map(shapeLine));

  out.push('');
  const stallHead = ['term', 'scope', 'owner', 'blocker', 'span mean', 'span max', 'no-verb mean', 'no-verb max'];
  const stallBody: string[][] = [];
  for (const { term, runs } of rows) {
    const scopes: [string, ((run: DensityRun) => StallSpans | undefined)][] = [
      ['campaign', (run) => ({ blockerSpan: run.blockerSpan, actionableGap: run.actionableGap })],
    ];
    const ages = [...new Set(runs.flatMap((run) => Object.keys(run.stallAges)))].sort();
    for (const age of ages) scopes.push([`age:${age}`, (run) => run.stallAges[age]]);

    for (const [scope, pick] of scopes) {
      for (const blocker of LADDER_BLOCKERS) {
        if (blocker === 'clear' || blocker === 'other') continue;
        const readings = runs.map(pick).filter((x): x is StallSpans => x !== undefined);
        if (!readings.length) continue;
        const spans = readings.map((x) => x.blockerSpan[blocker]);
        const gaps = readings.map((x) => x.actionableGap[blocker]);
        if (!spans.some(Boolean) && !gaps.some(Boolean)) continue;
        const owners = [...new Set(blockerLevers(blocker).map((l) => l.owner))].join('+') || 'ladder';
        stallBody.push([
          String(term),
          scope,
          owners,
          blocker,
          mean(spans).toFixed(1),
          String(Math.max(...spans)),
          mean(gaps).toFixed(1),
          String(Math.max(...gaps)),
        ]);
      }
    }
  }
  if (stallBody.length) {
    const stallWidths = stallHead.map((h, i) => Math.max(h.length, ...stallBody.map((b) => (b[i] ?? '').length)));
    const stallLine = (cells: string[]) => cells.map((c, i) => c.padEnd(stallWidths[i]!)).join('  ');
    out.push(stallLine(stallHead), stallLine(stallWidths.map((w) => '-'.repeat(w))), ...stallBody.map(stallLine));
  }

  out.push('');
  const ambitionHead = ['term', 'scope', 'owner', 'ambition', 'flat years mean', 'flat years max', 'decisions mean', 'decisions max'];
  const ambitionBody: string[][] = [];
  for (const { term, runs } of rows) {
    const ageIds = [...new Set(runs.flatMap((run) => Object.keys(run.ambitionFlatAges)))].sort();
    const scopes: [string, ((run: DensityRun) => Partial<Record<HouseAmbitionId, AmbitionFlat>> | undefined)][] = [
      ['campaign', (run) => run.ambitionFlat],
      ...ageIds.map((age): [string, (run: DensityRun) => Partial<Record<HouseAmbitionId, AmbitionFlat>> | undefined] =>
        [`age:${age}`, (run) => run.ambitionFlatAges[age]]),
    ];

    for (const [scope, pick] of scopes) {
      const readingsByRun = runs.map(pick).filter(
        (x): x is Partial<Record<HouseAmbitionId, AmbitionFlat>> => x !== undefined,
      );
      const ids = [...new Set(readingsByRun.flatMap((reading) => Object.keys(reading)))].sort() as HouseAmbitionId[];
      for (const id of ids) {
        const readings = readingsByRun.flatMap((reading) => reading[id] ? [reading[id]!] : []);
        if (!readings.length) continue;
        const years = readings.map((x) => x.years);
        const decisions = readings.map((x) => x.decisions);
        ambitionBody.push([
          String(term),
          scope,
          'ambition',
          id,
          mean(years).toFixed(1),
          String(Math.max(...years)),
          mean(decisions).toFixed(1),
          String(Math.max(...decisions)),
        ]);
      }
    }
  }
  if (ambitionBody.length) {
    const ambitionWidths = ambitionHead.map((h, i) => Math.max(h.length, ...ambitionBody.map((b) => (b[i] ?? '').length)));
    const ambitionLine = (cells: string[]) => cells.map((c, i) => c.padEnd(ambitionWidths[i]!)).join('  ');
    out.push(ambitionLine(ambitionHead), ambitionLine(ambitionWidths.map((w) => '-'.repeat(w))), ...ambitionBody.map(ambitionLine));
  }

  out.push('');
  const failureHead = ['term', 'scope', 'owner', 'attempt', 'streak mean', 'streak max'];
  const failureBody: string[][] = [];
  for (const { term, runs } of rows) {
    const ageIds = [...new Set(runs.flatMap((run) => Object.keys(run.repeatedFailure.ages)))].sort();
    const scopes: [string, ((run: DensityRun) => FailureStreaks | undefined)][] = [
      ['campaign', (run) => run.repeatedFailure.campaign],
      ...ageIds.map((age): [string, (run: DensityRun) => FailureStreaks | undefined] =>
        [`age:${age}`, (run) => run.repeatedFailure.ages[age]]),
    ];
    for (const [scope, pick] of scopes) {
      const readings = runs.map(pick).filter((x): x is FailureStreaks => x !== undefined);
      if (!readings.length) continue;
      for (const [attempt, owner] of [['check', 'events/checks'], ['order', 'table']] as const) {
        const values = readings.map((x) => x[attempt]);
        failureBody.push([
          String(term),
          scope,
          owner,
          attempt,
          mean(values).toFixed(2),
          String(Math.max(...values)),
        ]);
      }
    }
  }
  if (failureBody.length) {
    const failureWidths = failureHead.map((h, i) => Math.max(h.length, ...failureBody.map((b) => (b[i] ?? '').length)));
    const failureLine = (cells: string[]) => cells.map((c, i) => c.padEnd(failureWidths[i]!)).join('  ');
    out.push(failureLine(failureHead), failureLine(failureWidths.map((w) => '-'.repeat(w))), ...failureBody.map(failureLine));
  }

  // These are diagnostic readings, not an additional balance threshold.
  out.push(...diagnosticIntervalLines(rows));

  out.push('');
  const topHead = ['term', 'scope', 'share', 'category shape'];
  const topBody: string[][] = [];
  for (const { term, runs } of rows) {
    for (const [scope, shapes] of aggregateTopShapes(runs)) {
      for (const shape of shapes) {
        topBody.push([String(term), scope, `${(100 * shape.share).toFixed(1)}%`, shape.shape]);
      }
    }
  }
  const topWidths = topHead.map((h, i) => Math.max(h.length, ...topBody.map((b) => (b[i] ?? '').length)));
  const topLine = (cells: string[]) => cells.map((c, i) => c.padEnd(topWidths[i]!)).join('  ');
  out.push(topLine(topHead), topLine(topWidths.map((w) => '-'.repeat(w))), ...topBody.map(topLine));
  return out;
}

function aggregateTopShapes(runs: DensityRun[]): [string, ShapeFrequency[]][] {
  const scopes = new Map<string, Map<string, number>>();

  const add = (scope: string, shapes: ShapeFrequency[]) => {
    const counts = scopes.get(scope) ?? new Map<string, number>();
    for (const shape of shapes) {
      counts.set(shape.shape, (counts.get(shape.shape) ?? 0) + shape.count);
    }
    scopes.set(scope, counts);
  };

  for (const run of runs) {
    add('campaign', run.topShapes.campaign);
    for (const [age, shapes] of Object.entries(run.topShapes.ages)) add(`age:${age}`, shapes);
  }

  return [...scopes.entries()]
    .sort(([a], [b]) => a === 'campaign' ? -1 : b === 'campaign' ? 1 : a.localeCompare(b))
    .map(([scope, counts]) => {
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
      return [scope, shapeFrequencies(counts, total).slice(0, 10)];
    });
}

/** #1814: only witnessed awakening is used; no hidden genetic capacity is reported. */
export type DiagnosticPeriod = 'regency' | 'unwoken';

export interface DiagnosticYear {
  year: number;
  period?: DiagnosticPeriod;
  blocker: LadderBlocker;
  actionable: boolean;
  /** A player-visible decision that changes the direction of the house. */
  spine: boolean;
  choices: number;
  matches: number;
  records: number;
  auctions: number;
  orders: number;
  /** Non-consequential choice/record presentations, including predetermined ones. */
  routine: number;
}

export interface DiagnosticInterval {
  period: DiagnosticPeriod;
  from: number;
  to: number;
  years: number;
  longestQuiet: number;
  choices: number;
  matches: number;
  records: number;
  auctions: number;
  orders: number;
  routine: number;
  actionableYears: number;
  blockedYears: number;
  blockers: Partial<Record<LadderBlocker, number>>;
}

/** A pure reader of the session's observed years; no RNG or simulation mutations. */
export function traceDiagnosticIntervals(samples: readonly DiagnosticYear[]): DiagnosticInterval[] {
  const intervals: DiagnosticInterval[] = [];
  let current: DiagnosticInterval | undefined;
  let quiet = 0;
  for (const sample of samples) {
    if (!sample.period) {
      current = undefined;
      quiet = 0;
      continue;
    }
    if (!current || current.period !== sample.period || sample.year !== current.to + 1) {
      current = {
        period: sample.period, from: sample.year, to: sample.year, years: 0,
        longestQuiet: 0, choices: 0, matches: 0, records: 0,
        auctions: 0, orders: 0, routine: 0,
        actionableYears: 0, blockedYears: 0, blockers: {},
      };
      intervals.push(current);
      quiet = 0;
    }
    current.to = sample.year;
    current.years += 1;
    current.choices += sample.choices;
    current.matches += sample.matches;
    current.records += sample.records;
    current.auctions += sample.auctions;
    current.orders += sample.orders;
    current.routine += sample.routine;
    current.blockers[sample.blocker] = (current.blockers[sample.blocker] ?? 0) + 1;
    if (sample.actionable) current.actionableYears += 1;
    else current.blockedYears += 1;
    quiet = sample.spine ? 0 : quiet + 1;
    current.longestQuiet = Math.max(current.longestQuiet, quiet);
  }
  return intervals;
}

export function diagnosticIntervalLines(rows: { term: number; runs: DensityRun[] }[]): string[] {
  const output = ['', 'REGENCY / UNWOKEN PACING (diagnostic; not a gate)'];
  output.push('regency = woman holding the seal; unwoken = seated non-regent Head, no WITNESSED awake expresser in the house');
  output.push('only blocking choice/Record counts as meaningful; forms and automatic resolutions excluded');
  output.push('Table orders and bid decisions count only when the supplied policy actually sends a successful order; default policy sends none');
  const header = ['term', 'scope', 'seed', 'year range', 'years', 'quiet max', 'choice (per y)', 'match (per y)', 'record (per y)', 'auction (per y)', 'orders (per y)', 'routine (per y)', 'actionable', 'no route', 'blocker years'];
  const data: string[][] = [];
  const sums = (rs: DiagnosticInterval[], key: 'choices' | 'matches' | 'records' | 'auctions' | 'orders' | 'routine' | 'actionableYears' | 'blockedYears') =>
    rs.reduce((total, r) => total + r[key], 0);
  for (const { term, runs } of rows) {
    for (const period of ['regency', 'unwoken'] as const) {
      const readings = runs.flatMap((r) => (r.diagnosticIntervals ?? [])
        .filter((interval) => interval.period === period)
        .map((interval) => ({ seed: r.seed, interval })))
        .sort((a, b) => a.seed - b.seed || a.interval.from - b.interval.from);
      const intervals = readings.map((r) => r.interval);
      const totalYears = intervals.reduce((total, r) => total + r.years, 0);
      const blockerCounts: Partial<Record<LadderBlocker, number>> = {};
      for (const interval of intervals) {
        for (const [blocker, years] of Object.entries(interval.blockers)) {
          const key = blocker as LadderBlocker;
          blockerCounts[key] = (blockerCounts[key] ?? 0) + years;
        }
      }
      const topBlockers = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1])
        .slice(0, 3).map(([name, years]) => `${name}:${years}`).join(',');
      const row = (seed: string, range: string, n: number, quiet: number, subset: DiagnosticInterval[], blockers: string) => [
        String(term), period, seed, range, String(n), String(quiet),
        ...(['choices', 'matches', 'records', 'auctions', 'orders', 'routine'] as const)
          .map((key) => `${sums(subset, key)} (${(sums(subset, key) / (n || 1)).toFixed(2)}/y)`),
        String(sums(subset, 'actionableYears')), String(sums(subset, 'blockedYears')),
        blockers,
      ];
      data.push(row('ALL', `${intervals.length} intervals / ${runs.length} runs`, totalYears,
        Math.max(0, ...intervals.map((r) => r.longestQuiet)), intervals, topBlockers));
      for (const { seed, interval } of readings) {
        const blockers = Object.entries(interval.blockers).filter(([, years]) => years > 0)
          .sort((a, b) => b[1] - a[1]).map(([name, years]) => `${name}:${years}`).join(',');
        data.push(row(String(seed), `${interval.from}–${interval.to}`, interval.years,
          interval.longestQuiet, [interval], blockers));
      }
    }
  }
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
  output.push(line(header), line(widths.map((width) => '-'.repeat(width))), ...data.map(line));
  return output;
}
