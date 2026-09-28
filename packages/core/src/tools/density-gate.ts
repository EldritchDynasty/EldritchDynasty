/**
 * WHAT THE PLAYER IS ASKED, AND HOW OFTEN THE SAME THING TWICE (issue #88).
 *
 *   npm run gate:density -- [runs] [years]
 *   npm run gate:density -- 12 500 300
 *
 * ─── The finding this exists to settle ──────────────────────────────────────
 *
 * `choice` is about three-quarters of every decision in the game, and always
 * was. The ceiling that was supposed to catch a kind eating the run passed for
 * years only because naming — a form, 37% of the budget, a prompt per child —
 * was padding the denominator. Take the form out (#62) and `choice` reads 75%
 * without one extra event firing.
 *
 * #88 asks whether that is the intended density or an artefact of every phase
 * being allowed to present, and it names one dial: `EVENT_BUDGET_PER_YEAR` in
 * `year/phases.ts`, spent once a year in the `ambient` phase. Nothing else in
 * the game rations choice — arc steps present their due nodes outside the
 * budget, and `selectEvents` returns forced candidates before it spends any.
 *
 * ─── Why the count is the wrong instrument, and what this measures instead ──
 *
 * The complaint underneath a density complaint is almost never the count. It
 * is repetition: 300 draws over a pool of 454 templates is #86's rota and
 * #85's flat century arriving from a third direction, and lowering the budget
 * would make a thin game shorter rather than a repetitive game varied.
 *
 * So this measures the thing the player HAS rather than the thing the engine
 * spends:
 *
 *   `repeatRun`   the share of choice presentations whose template has already
 *                 fired in this run. The treadmill, as one number.
 *   `repeatAge`   the same question inside the current Age, which is the unit
 *                 a session is now (#65) and the scale repetition is felt at.
 *                 `the_plague` medians six years and `the_long_peace` 98, so
 *                 these two numbers are different questions.
 *   `ordinary`    the longest span of consecutive years carrying no Match, no
 *                 Record block and no Age boundary — how long the game can go
 *                 presenting nothing but ambient choice panels. If the density
 *                 problem is really a DISTRIBUTION problem, it is here.
 *   `reach`       distinct choice templates the run actually reached. A pool
 *                 that grew 12% buys nothing if the draw never gets to it.
 *
 * And the campaign-invariant counts beside them — per generation and per Age —
 * because #133 has moved the Long Line from 1,000 years to 500 and a raw count
 * per campaign is a product-load figure, not a balance target. Per generation
 * is the same number in both campaigns if the design is the same design.
 *
 * ─── It prints; it does not judge ───────────────────────────────────────────
 *
 * The regression band lives in `attention.slow.test.ts`, where the rest of the
 * attention budget is guarded, because that file already pays for a played
 * batch and a second one in `tools/gates.ts` would play the same years twice
 * for the same answer. This is the sweep rig that produced the band.
 */
import { loadContent } from '@ed/content';
import type { Content, ContentBundle } from '@ed/schema';
import { newGame } from '../session.js';
import { mustSurface } from '../delegation.js';
import type { PendingRecord } from '../events/decisions.js';
import { CAMPAIGN_YEARS, START_YEAR } from '../campaign.js';
import { isPredetermined, shapeOf, type ShapeGrain } from './shapes.js';

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

export interface DensityOptions {
  /** Learn exact routine preferences from the first answer, then delegate repeats. */
  delegateRoutine?: boolean;
}

/**
 * MEASURED THROUGH THE SESSION, AND ANSWERED THE WAY `attention.slow.test.ts`
 * ANSWERS — first choice, always record, first card.
 *
 * Not the chronicler, and this is not a preference. A Record block is raised
 * by `answerChoice`, the PLAYER's path: when the chronicler takes a branch it
 * applies the record itself and nothing is ever docketed. Measured with
 * `autoResolveAll` this read **one** Record block per 500-year run against the
 * 27 that file measures — an instrument that reported the thesis of the game
 * as happening once a millennium, and reported it in a table that otherwise
 * looked entirely reasonable.
 *
 * So the two instruments answer identically on purpose. The band this tool
 * produces is written into that file, and a band derived from a different
 * player than the one the test plays is a band that fails for a reason nobody
 * can find.
 */
export function measureDensity(source: ContentBundle | Content, seed: number, years: number, opts: DensityOptions = {}): DensityRun {
  const g = newGame(source, { seed });
  const w = g.ctx.world;
  const end = START_YEAR + years;

  const seenInRun = new Set<string>();
  const seenInAge = new Set<string>();
  const shapeSeenRun: Record<ShapeGrain, Set<string>> = { kind: new Set(), category: new Set() };
  const shapeSeenAge: Record<ShapeGrain, Set<string>> = { kind: new Set(), category: new Set() };
  const shapeSeenRunWithoutPredetermined: Record<ShapeGrain, Set<string>> = { kind: new Set(), category: new Set() };
  const shapeSeenAgeWithoutPredetermined: Record<ShapeGrain, Set<string>> = { kind: new Set(), category: new Set() };
  const shapeRepeatsRun: Record<ShapeGrain, number> = { kind: 0, category: 0 };
  const shapeRepeatsAge: Record<ShapeGrain, number> = { kind: 0, category: 0 };
  const shapeRepeatsRunWithoutPredetermined: Record<ShapeGrain, number> = { kind: 0, category: 0 };
  const shapeRepeatsAgeWithoutPredetermined: Record<ShapeGrain, number> = { kind: 0, category: 0 };
  const campaignShapeCounts = new Map<string, number>();
  const ageShapeCounts = new Map<string, Map<string, number>>();
  const ageShapeChoices = new Map<string, number>();
  const categoryWindow: string[] = [];
  let shapeWindow = 0;
  let predeterminedChoices = 0;
  let nonPredeterminedChoices = 0;
  let choices = 0;
  let matches = 0;
  let records = 0;
  let names = 0;
  let meaningfulChoices = 0;
  let meaningfulRecords = 0;
  let repeatsRun = 0;
  let repeatsAge = 0;
  let ages = 0;
  let ordinary = 0;
  let span = 0;
  let lived = 0;
  let guard = 0;

  while (g.year < end && !w.ending && guard++ < 100_000) {
    const turned = g.advance(1).years[0];
    let landmark = false;
    if (turned) {
      lived += 1;
      // An Age boundary resets the within-Age question and is a landmark, so
      // it also breaks the ordinary span.
      if (turned.agesBegan.length || turned.agesEnded.length) {
        landmark = true;
        seenInAge.clear();
        shapeSeenAge.kind.clear();
        shapeSeenAge.category.clear();
        shapeSeenAgeWithoutPredetermined.kind.clear();
        shapeSeenAgeWithoutPredetermined.category.clear();
      }
      ages += turned.agesEnded.length;
    }

    let inner = 0;
    while (w.pendingDecisions.length && inner++ < 500) {
      const d = w.pendingDecisions[0]!;
      if (d.kind === 'match') {
        matches += 1;
        landmark = true;
        if (d.cards[0]) g.match(d.id, d.cards[0].id);
        else g.declineHand(d.id);
      } else if (d.kind === 'record') {
        records += 1;
        landmark = true;

        // Ask whether a plain Record policy would be safe without leaving that
        // temporary policy behind in the baseline run.
        const eventId = d.event.id;
        const previous = w.delegation.records[eventId];
        w.delegation.records[eventId] = 'record';
        const guard = mustSurface(g.ctx, d as PendingRecord);
        if (previous === undefined) delete w.delegation.records[eventId];
        else w.delegation.records[eventId] = previous;
        if (guard) meaningfulRecords += 1;

        const result = g.record(d.id, 'record');
        // Match the real client: a standing preference is learned only after
        // the ordinary answer succeeds, never before its resolver/drain runs.
        if (opts.delegateRoutine && !guard && result.ok) g.delegateRecord(eventId, 'record');
      } else {
        choices += 1;
        const guard = mustSurface(g.ctx, d);
        if (guard) meaningfulChoices += 1;

        const predetermined = isPredetermined(g.ctx, d);
        if (predetermined) predeterminedChoices += 1;
        else nonPredeterminedChoices += 1;

        const shapes: Record<ShapeGrain, string> = {
          kind: shapeOf(d, 'kind'),
          category: shapeOf(d, 'category'),
        };
        for (const grain of ['kind', 'category'] as const) {
          const shape = shapes[grain];
          if (shapeSeenRun[grain].has(shape)) shapeRepeatsRun[grain] += 1;
          else shapeSeenRun[grain].add(shape);
          if (shapeSeenAge[grain].has(shape)) shapeRepeatsAge[grain] += 1;
          else shapeSeenAge[grain].add(shape);

          if (!predetermined) {
            if (shapeSeenRunWithoutPredetermined[grain].has(shape)) {
              shapeRepeatsRunWithoutPredetermined[grain] += 1;
            } else {
              shapeSeenRunWithoutPredetermined[grain].add(shape);
            }
            if (shapeSeenAgeWithoutPredetermined[grain].has(shape)) {
              shapeRepeatsAgeWithoutPredetermined[grain] += 1;
            } else {
              shapeSeenAgeWithoutPredetermined[grain].add(shape);
            }
          }
        }

        const categoryShape = shapes.category;
        bump(campaignShapeCounts, categoryShape);
        for (const active of w.age.active) {
          const counts = ageShapeCounts.get(active.age) ?? new Map<string, number>();
          bump(counts, categoryShape);
          ageShapeCounts.set(active.age, counts);
          ageShapeChoices.set(active.age, (ageShapeChoices.get(active.age) ?? 0) + 1);
        }

        categoryWindow.push(categoryShape);
        if (categoryWindow.length > 20) categoryWindow.shift();
        if (categoryWindow.length === 20) {
          const counts = new Map<string, number>();
          for (const shape of categoryWindow) bump(counts, shape);
          shapeWindow = Math.max(shapeWindow, Math.max(...counts.values()) / 20);
        }

        const id = d.event.id;
        if (seenInRun.has(id)) repeatsRun += 1; else seenInRun.add(id);
        if (seenInAge.has(id)) repeatsAge += 1; else seenInAge.add(id);
        if (!d.choicesAreOpen) g.send(d.id, {});
        else {
          // Preserve #88's existing player exactly: first authored choice,
          // with the chronicler fallback below if that answer is unavailable.
          const choice = d.choices[0];
          if (choice) {
            const result = g.choose(d.id, choice.id);
            // The measurement uses the same learn-after-success order as the
            // Docket. Installing the policy first would let this very answer's
            // post-resolution drain benefit from a preference the player had
            // not actually established yet.
            if (opts.delegateRoutine && !guard && choice.available && result.ok) {
              g.delegateChoice(id, choice.id);
            }
          }
        }
      }
      // Never leave the docket standing: a decision with no answer stops the
      // clock for good (invariant 9), and this loop would spin on it.
      if (w.pendingDecisions[0] === d) g.letHimDecide();
    }

    // The span is years BETWEEN landmarks, so a landmark year ends it without
    // being counted into it.
    if (landmark) { ordinary = Math.max(ordinary, span); span = 0; } else span += 1;

    names += w.pendingNames.length;
    for (const n of [...w.pendingNames]) g.name(n.person, n.suggested);
  }
  ordinary = Math.max(ordinary, span);

  // Generations, never years: a broken line lives fewer of both, and dividing
  // by the term would read a short life as a thin game.
  const generations = Math.max(1, w.generation);
  return {
    seed,
    years: lived,
    generations,
    ages,
    choices,
    matches,
    records,
    names,
    perGeneration: choices / generations,
    perAge: choices / Math.max(1, ages),
    repeatRun: choices ? repeatsRun / choices : 0,
    repeatAge: choices ? repeatsAge / choices : 0,
    shapeRepeat: {
      kind: {
        run: choices ? shapeRepeatsRun.kind / choices : 0,
        age: choices ? shapeRepeatsAge.kind / choices : 0,
        runWithoutPredetermined: nonPredeterminedChoices
          ? shapeRepeatsRunWithoutPredetermined.kind / nonPredeterminedChoices : 0,
        ageWithoutPredetermined: nonPredeterminedChoices
          ? shapeRepeatsAgeWithoutPredetermined.kind / nonPredeterminedChoices : 0,
      },
      category: {
        run: choices ? shapeRepeatsRun.category / choices : 0,
        age: choices ? shapeRepeatsAge.category / choices : 0,
        runWithoutPredetermined: nonPredeterminedChoices
          ? shapeRepeatsRunWithoutPredetermined.category / nonPredeterminedChoices : 0,
        ageWithoutPredetermined: nonPredeterminedChoices
          ? shapeRepeatsAgeWithoutPredetermined.category / nonPredeterminedChoices : 0,
      },
    },
    shapeWindow,
    predeterminedShare: choices ? predeterminedChoices / choices : 0,
    topShapes: {
      campaign: topShapeCounts(campaignShapeCounts, choices),
      ages: Object.fromEntries([...ageShapeCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([age, counts]) => [age, topShapeCounts(counts, ageShapeChoices.get(age) ?? 0)])),
    },
    ordinary,
    reach: seenInRun.size,
    meaningfulChoices,
    meaningfulRecords,
  };
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

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function topShapeCounts(counts: Map<string, number>, total: number): ShapeFrequency[] {
  return [...counts]
    .sort(([aShape, a], [bShape, b]) => b - a || aShape.localeCompare(bShape))
    .slice(0, 10)
    .map(([shape, count]) => ({ shape, count, share: total ? count / total : 0 }));
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

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('density-gate.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const args = argv.filter((a) => !a.startsWith('--'));
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  // `--seeds` exists so the band written into `attention.slow.test.ts` can be
  // re-derived from that file's own pool rather than from a pool this tool
  // picked. A batch statistic measured on different seeds than the ones the
  // test plays is a band nobody can reproduce when it goes red.
  const chosen = flag('seeds')?.split(',').map(Number);
  const runs = chosen?.length ?? Number(args[0] ?? 12);
  const terms = args.slice(chosen ? 0 : 1).map(Number);
  const bundle = loadContent().bundle;
  // The same seeds at both terms, so the 300 and the 500 rows are the same
  // worlds asked to stop at two different pages.
  const seeds = chosen ?? Array.from({ length: runs }, (_, i) => 4100 + i);
  const selectedTerms = terms.length ? terms : [CAMPAIGN_YEARS, 300];
  if (argv.includes('--delegation')) {
    const rows = selectedTerms.map((term) => ({
      term,
      before: seeds.map((seed) => measureDensity(bundle, seed, term)),
      after: seeds.map((seed) => measureDensity(bundle, seed, term, { delegateRoutine: true })),
    }));
    console.log(`${seeds.length} paired runs, ${rows.map((r) => `${r.term}y`).join(' and ')}, delegation before/after`);
    for (const l of delegationDensityLines(rows)) console.log(l);
  } else {
    const rows = selectedTerms.map((term) => ({
      term,
      runs: seeds.map((seed) => measureDensity(bundle, seed, term)),
    }));
    console.log(`${seeds.length} runs, ${rows.map((r) => `${r.term}y`).join(' and ')}`);
    for (const l of densityLines(rows)) console.log(l);
  }
}
