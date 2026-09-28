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
