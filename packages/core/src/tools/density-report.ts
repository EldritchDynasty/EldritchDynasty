import type { ShapeGrain } from './shapes.js';

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
  campaign: ShapeFrequency[];
  /** Category-shape top tens keyed by the authored Age id. */
  ages: Record<string, ShapeFrequency[]>;
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
  /** Choice presentations already settled by availability, shape or #219's guard. */
  predeterminedShare: number;
  /** Most common category shapes for the campaign and each active authored Age. */
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
  const scopes = new Map<string, { samples: number; shares: Map<string, number> }>();

  const add = (scope: string, shapes: ShapeFrequency[]) => {
    const row = scopes.get(scope) ?? { samples: 0, shares: new Map<string, number>() };
    row.samples += 1;
    for (const shape of shapes) {
      row.shares.set(shape.shape, (row.shares.get(shape.shape) ?? 0) + shape.share);
    }
    scopes.set(scope, row);
  };

  for (const run of runs) {
    add('campaign', run.topShapes.campaign);
    for (const [age, shapes] of Object.entries(run.topShapes.ages)) add(`age:${age}`, shapes);
  }

  return [...scopes.entries()]
    .sort(([a], [b]) => a === 'campaign' ? -1 : b === 'campaign' ? 1 : a.localeCompare(b))
    .map(([scope, row]) => [
      scope,
      [...row.shares]
        .map(([shape, sum]) => ({ shape, count: 0, share: sum / row.samples }))
        .sort((a, b) => b.share - a.share || a.shape.localeCompare(b.shape))
        .slice(0, 10),
    ]);
}
