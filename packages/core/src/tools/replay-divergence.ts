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
  const first = shortLineChoices(source, a);
  const second = shortLineChoices(source, b);
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
  const rows = Array.from({ length: pairs }, (_, i) => {
    const a = 901 + i * 2;
    return measureReplayPair(source, a, a + 1);
  });

  console.log(`replay divergence: ${pairs} paired Short Lines`);
  for (const line of replayLines(rows)) console.log(line);
  console.log('');
  for (const line of libraryLines(measureLibraryVisibility(source, rows[0]!.a, rows[0]!.b))) console.log(line);
  console.log('');
  const neutrality = gateLibraryNeutrality(source);
  console.log('Library mechanical identity (delegated to gate: library-neutrality)');
  for (const line of neutrality.lines.slice(1)) console.log(line);
  process.exit(neutrality.ok ? 0 : 1);
}
