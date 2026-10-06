/**
 * RUN-TWO DIVERGENCE — issue #272.
 *
 * Two readings of the same question — how much of run two has the player
 * already met in run one:
 *
 *   1. by EVENT ID, the literal repeat;
 *   2. by #271's category SHAPE (`shapeOf`), the repeat a player recognises
 *      even when the prose, pounds and event id all differ.
 *
 * Both come off one player: `measureDensity`, through its `onChoice`
 * observer, on a real Short Line. The shape key only exists while a choice is
 * pending — it reads which options are available — so a saved decision log
 * cannot supply it, and a second play loop here would be a second copy of the
 * density player's answer policy for the two columns to disagree about.
 *
 * The Library table reads a finished Short Line through `playedRun`, the
 * deterministic run corpus. Its mechanical neutrality is not reimplemented
 * here: `gateLibraryNeutrality` remains the authority and this delegates to it.
 */
import { loadContent } from '@ed/content';
import type { Content, ContentBundle } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { playedRun } from '../corpus.js';
import { libraryRunOf } from '../run-library.js';
import { newGame } from '../session.js';
import { measureDensity } from './density-gate.js';
import { gateLibraryNeutrality } from './library-gate.js';

type Source = ContentBundle | Content;

export interface DecisionVisit {
  /** Stable event-level identity. Match/name forms have no event id and are not fabricated here. */
  id: string;
  year: number;
  /** #271's category shape, when the stream was read off a live player. */
  shape?: string;
}

export interface DivergenceReading {
  compared: number;
  repeatedIds: number;
  idOverlap: number;
  /** Zero-based index in B, or -1 when every B decision already occurred in A. */
  firstNewIndex: number;
  firstNewYear?: number;
  shapeOverlap?: number;
}

/**
 * Compare B against everything A has already shown.
 *
 * The shape reader is injected rather than imported so this statistic stays a
 * pure function over two lists, testable without playing a run; #271's
 * `shapeOf` is still the only thing that decides what a shape is.
 */
export function compareDecisionStreams(
  a: readonly DecisionVisit[],
  b: readonly DecisionVisit[],
  shapeOf?: (decision: DecisionVisit) => string,
): DivergenceReading {
  const ids = new Set(a.map((decision) => decision.id));
  const repeatedIds = b.filter((decision) => ids.has(decision.id)).length;
  const firstNewIndex = b.findIndex((decision) => !ids.has(decision.id));
  const firstNew = firstNewIndex >= 0 ? b[firstNewIndex] : undefined;

  let shapeOverlap: number | undefined;
  if (shapeOf) {
    const shapes = new Set(a.map(shapeOf));
    shapeOverlap = b.length
      ? b.filter((decision) => shapes.has(shapeOf(decision))).length / b.length
      : 0;
  }

  return {
    compared: b.length,
    repeatedIds,
    idOverlap: b.length ? repeatedIds / b.length : 0,
    firstNewIndex,
    ...(firstNew ? { firstNewYear: firstNew.year } : {}),
    ...(shapeOverlap === undefined ? {} : { shapeOverlap }),
  };
}

export interface ReplayPair {
  a: number;
  b: number;
  opening: DivergenceReading;
  overall: DivergenceReading;
}

export interface LibraryReading {
  sourceEntries: number;
  inheritedMemories: number;
  since: number | undefined;
  surfaced: string;
}

function percent(value: number): string {
  return `${(100 * value).toFixed(0)}%`;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function replayLines(rows: readonly ReplayPair[]): string[] {
  // The shape columns appear only when every reading carries one: a row
  // without shapes printed as 0% would read as "nothing repeats".
  const shaped = rows.length > 0 && rows.every((row) =>
    row.opening.shapeOverlap !== undefined && row.overall.shapeOverlap !== undefined);
  const head = [
    'pair', 'B first 30 in A', 'B overall in A',
    ...(shaped ? ['shape first 30', 'shape overall'] : []),
    'first new B decision',
  ];
  const body = rows.map((row) => [
    `${row.a}→${row.b}`,
    percent(row.opening.idOverlap),
    percent(row.overall.idOverlap),
    ...(shaped ? [percent(row.opening.shapeOverlap!), percent(row.overall.shapeOverlap!)] : []),
    row.overall.firstNewIndex < 0
      ? 'none'
      : `#${row.overall.firstNewIndex + 1} (${row.overall.firstNewYear ?? '?'})`,
  ]);
  if (rows.length) {
    body.push([
      'mean',
      percent(mean(rows.map((row) => row.opening.idOverlap))),
      percent(mean(rows.map((row) => row.overall.idOverlap))),
      ...(shaped
        ? [
          percent(mean(rows.map((row) => row.opening.shapeOverlap!))),
          percent(mean(rows.map((row) => row.overall.shapeOverlap!))),
        ]
        : []),
      '',
    ]);
  }
  return table(head, body);
}

/** Left-aligned columns under a rule, as every table this gate prints is laid out. */
function table(head: readonly string[], body: readonly (readonly string[])[]): string[] {
  const widths = head.map((label, i) => Math.max(label.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
  return [line(head), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)];
}

export function libraryLines(reading: LibraryReading): string[] {
  return [
    'Library visibility',
    `  finished-run entries: ${reading.sourceEntries}`,
    `  inherited memories at founding: ${reading.inheritedMemories}`,
    `  first since: ${reading.since ?? 'none'}`,
    `  surfaced: ${reading.surfaced}`,
  ];
}

/**
 * WHAT THE PLAYER IS ASKED MOST, AND WHAT MAKES A NEW SCENE FEEL OLD (#341).
 *
 * The divergence table says how much of run two run one already showed; this
 * says which questions carry that overlap. A pure reduction over choice
 * streams already read off the density player, so its test builds streams by
 * hand and plays nothing.
 *
 * - `top`: the most common category shapes across every stream, each with how
 *   many distinct events carry it and the events that carry it most.
 * - `familiar`: for each pair (A, B), B's choices whose EVENT A never showed
 *   but whose SHAPE A did — a new scene asking a question already asked —
 *   and the shapes that make up that share.
 * - `moneyInTop`: how many of the top shapes have money on at least one side,
 *   by the shape key's own `money` token.
 */
export interface ShapeCount {
  shape: string;
  count: number;
  share: number;
}

export interface FamiliarEventCount {
  id: string;
  count: number;
  share: number;
  shapes: ShapeCount[];
}

export interface ShapeConcentration {
  choices: number;
  shapes: number;
  events: number;
  top: (ShapeCount & { events: number; heaviest: { id: string; fires: number }[] })[];
  familiar: {
    compared: number;
    count: number;
    share: number;
    top: ShapeCount[];
    events: FamiliarEventCount[];
  };
  moneyInTop: number;
}

export function shapeConcentration(
  streams: readonly (readonly DecisionVisit[])[],
  pairs: readonly (readonly [number, number])[],
  topN = 10,
): ShapeConcentration {
  const all = streams.flat();
  const byShape = new Map<string, Map<string, number>>();
  for (const visit of all) {
    const shape = shapeOfVisit(visit);
    const events = byShape.get(shape) ?? new Map<string, number>();
    events.set(visit.id, (events.get(visit.id) ?? 0) + 1);
    byShape.set(shape, events);
  }
  const total = (events: Map<string, number>) => [...events.values()].reduce((a, n) => a + n, 0);
  // Ties break on the key, so the table is the same table every time it is printed.
  const ranked = [...byShape].sort(([sa, a], [sb, b]) => total(b) - total(a) || sa.localeCompare(sb));
  const top = ranked.slice(0, topN).map(([shape, events]) => ({
    shape,
    count: total(events),
    share: all.length ? total(events) / all.length : 0,
    events: events.size,
    heaviest: [...events]
      .sort(([ia, a], [ib, b]) => b - a || ia.localeCompare(ib))
      .slice(0, 3)
      .map(([id, fires]) => ({ id, fires })),
  }));

  let compared = 0;
  const familiarByShape = new Map<string, number>();
  const familiarByEvent = new Map<string, Map<string, number>>();
  for (const [ia, ib] of pairs) {
    const a = streams[ia] ?? [];
    const b = streams[ib] ?? [];
    const ids = new Set(a.map((visit) => visit.id));
    const shapes = new Set(a.map(shapeOfVisit));
    compared += b.length;
    for (const visit of b) {
      const shape = shapeOfVisit(visit);
      if (ids.has(visit.id) || !shapes.has(shape)) continue;
      familiarByShape.set(shape, (familiarByShape.get(shape) ?? 0) + 1);

      const eventShapes = familiarByEvent.get(visit.id) ?? new Map<string, number>();
      eventShapes.set(shape, (eventShapes.get(shape) ?? 0) + 1);
      familiarByEvent.set(visit.id, eventShapes);
    }
  }
  const familiarCount = [...familiarByShape.values()].reduce((a, n) => a + n, 0);

  return {
    choices: all.length,
    shapes: byShape.size,
    events: new Set(all.map((visit) => visit.id)).size,
    top,
    familiar: {
      compared,
      count: familiarCount,
      share: compared ? familiarCount / compared : 0,
      top: [...familiarByShape]
        .sort(([sa, a], [sb, b]) => b - a || sa.localeCompare(sb))
        .slice(0, 5)
        .map(([shape, count]) => ({ shape, count, share: familiarCount ? count / familiarCount : 0 })),
      events: [...familiarByEvent]
        .sort(([ia, a], [ib, b]) => total(b) - total(a) || ia.localeCompare(ib))
        .map(([id, shapes]) => {
          const count = total(shapes);
          return {
            id,
            count,
            share: familiarCount ? count / familiarCount : 0,
            shapes: [...shapes]
              .sort(([sa, a], [sb, b]) => b - a || sa.localeCompare(sb))
              .map(([shape, shapeCount]) => ({
                shape,
                count: shapeCount,
                share: count ? shapeCount / count : 0,
              })),
          };
        }),
    },
    moneyInTop: top.filter(({ shape }) => /\bmoney\b/.test(shape)).length,
  };
}

export function concentrationLines(c: ShapeConcentration): string[] {
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  let cumulative = 0;
  const rows = c.top.map((row) => {
    cumulative += row.share;
    return [
      pct(row.share), pct(cumulative), row.shape, String(row.events),
      row.heaviest.map(({ id, fires }) => `${id} x${fires}`).join(', '),
    ];
  });
  return [
    `Shape concentration: ${c.choices} choices, ${c.shapes} distinct shapes, ${c.events} distinct events`,
    ...table(['share', 'cumulative', 'shape', 'events', 'heaviest'], rows).map((line) => `  ${line}`),
    `  money on one side of ${c.moneyInTop} of the top ${c.top.length} shapes`,
    `  new event, familiar shape: ${pct(c.familiar.share)} of B's choices (${c.familiar.count} of ${c.familiar.compared})`,
    ...c.familiar.top.map((row) => `    ${pct(row.share)} of that  ${row.shape}`),
    ...(c.familiar.events.length
      ? [
        '  ranked familiar-event worklist',
        ...(() => {
          let cumulative = 0;
          const rows = c.familiar.events.map((row) => {
            cumulative += row.share;
            return [
              String(row.count),
              pct(row.share),
              pct(cumulative),
              row.id,
              row.shapes.map(({ shape, count }) => `${shape} x${count}`).join(', '),
            ];
          });
          return table(
            ['choices', 'share', 'cumulative', 'event', 'familiar shapes'],
            rows,
          ).map((line) => `    ${line}`);
        })(),
      ]
      : []),
  ];
}

/**
 * A whole Short Line, read through the corpus.
 *
 * The campaign has to be passed, not implied by the length. A Long Line cut at
 * 1343 is a different game: nine clauses instead of three, no `settled`, and
 * every `campaignProgress` condition reading a smaller fraction in the same
 * year. This gate measured exactly that for its first day, while
 * `measureLibraryVisibility` seeded its second run as a real Short Line.
 */
function shortLine(source: Source, seed: number) {
  return playedRun(source, seed, CAMPAIGNS.short.years + 1, CAMPAIGNS.short.startYear, 'short');
}

/**
 * Every choice a Short Line puts to the density player, in order, with its
 * category shape.
 */
export function shortLineChoices(source: Source, seed: number): DecisionVisit[] {
  const out: DecisionVisit[] = [];
  measureDensity(source, seed, CAMPAIGNS.short.years, {
    campaign: 'short',
    onChoice: (visit) => out.push({ id: visit.id, year: visit.year, shape: visit.category }),
  });
  return out;
}

function shapeOfVisit(visit: DecisionVisit): string {
  if (visit.shape === undefined) throw new Error(`decision ${visit.id} (${visit.year}) was read without a shape`);
  return visit.shape;
}

export function measureReplayPair(source: Source, a: number, b: number): ReplayPair {
  return replayPairOf(a, b, shortLineChoices(source, a), shortLineChoices(source, b));
}

function replayPairOf(a: number, b: number, first: DecisionVisit[], second: DecisionVisit[]): ReplayPair {
  return {
    a,
    b,
    opening: compareDecisionStreams(first, second.slice(0, 30), shapeOfVisit),
    overall: compareDecisionStreams(first, second, shapeOfVisit),
  };
}

export function measureLibraryVisibility(source: Source, seed: number, nextSeed: number): LibraryReading {
  const ctx = shortLine(source, seed);
  const run = libraryRunOf(ctx);
  if (!run) {
    return {
      sourceEntries: 0,
      inheritedMemories: 0,
      since: undefined,
      surfaced: 'Abroad / SessionView.tales',
    };
  }

  const next = newGame(source, {
    seed: nextSeed,
    campaign: 'short',
    decider: 'chronicler',
    libraryRuns: [run],
  });
  const memories = next.ctx.world.libraryMemories;
  return {
    sourceEntries: run.entries.length,
    inheritedMemories: memories.length,
    since: memories.length ? Math.min(...memories.map((memory) => memory.since)) : undefined,
    surfaced: 'Abroad / SessionView.tales',
  };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('replay-divergence.ts');
if (isMain) {
  const pairs = Math.max(1, Number(process.argv[2] ?? 12));
  const source = loadContent();
  // Each Short Line is played once and read twice: by the pair table and by
  // the concentration table, which must describe the same choices.
  const seeds = Array.from({ length: pairs * 2 }, (_, i) => 901 + i);
  const streams = seeds.map((seed) => shortLineChoices(source, seed));
  const pairIndex = Array.from({ length: pairs }, (_, i) => [i * 2, i * 2 + 1] as const);
  const rows = pairIndex.map(([ia, ib]) => replayPairOf(seeds[ia]!, seeds[ib]!, streams[ia]!, streams[ib]!));

  console.log(`replay divergence: ${pairs} paired Short Lines`);
  for (const line of replayLines(rows)) console.log(line);
  console.log('');
  for (const line of concentrationLines(shapeConcentration(streams, pairIndex))) console.log(line);
  console.log('');
  for (const line of libraryLines(measureLibraryVisibility(source, rows[0]!.a, rows[0]!.b))) console.log(line);
  console.log('');
  const neutrality = gateLibraryNeutrality(source);
  console.log('Library mechanical identity (delegated to gate: library-neutrality)');
  for (const line of neutrality.lines.slice(1)) console.log(line);
  process.exit(neutrality.ok ? 0 : 1);
}
