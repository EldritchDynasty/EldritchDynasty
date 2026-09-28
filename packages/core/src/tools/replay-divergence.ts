/**
 * RUN-TWO DIVERGENCE — issue #272.
 *
 * The returning-player question is deliberately split in two:
 *
 *   1. event-id freshness can be measured now from the decision log;
 *   2. interaction-shape freshness belongs to #271's canonical `shapeOf`.
 *
 * This file does not invent a second shape vocabulary while #271 is open.
 * The pure comparator accepts a shape reader, so #271 can plug its one source
 * of truth in without changing the statistic or the tests below.
 *
 * Whole campaigns are read through `playedRun`, the repository's deterministic
 * run corpus. The Library's mechanical neutrality is not reimplemented here:
 * `gateLibraryNeutrality` remains the authority and this report delegates to it.
 */
import { loadContent } from '@ed/content';
import type { Content, ContentBundle, LoggedDecision } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { playedRun } from '../corpus.js';
import { libraryRunOf } from '../run-library.js';
import { newGame } from '../session.js';
import { gateLibraryNeutrality } from './library-gate.js';

type Source = ContentBundle | Content;

export interface DecisionVisit {
  /** Stable event-level identity. Match/name forms have no event id and are not fabricated here. */
  id: string;
  year: number;
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
 * The stable event-level decisions a second run can literally meet again.
 *
 * An outcome without `choiceId` is narration, not a decision. Match and name
 * answers are real decisions, but their log entries carry person/card identity
 * rather than a stable interaction id; treating every match as "match" would
 * manufacture overlap, while comparing person ids across seeds would manufacture
 * novelty. #271's shape layer is the right home for those forms.
 */
export function eventDecisionStream(log: readonly LoggedDecision[]): DecisionVisit[] {
  const out: DecisionVisit[] = [];
  for (const decision of log) {
    if (decision.kind === 'outcome') {
      if (decision.choiceId !== undefined) out.push({ id: decision.event, year: decision.year });
      continue;
    }
    if (decision.kind === 'record') {
      out.push({ id: `record:${decision.event}`, year: decision.year });
    }
  }
  return out;
}

/**
 * Compare B against everything A has already shown.
 *
 * The optional shape reader is dependency injection on purpose: #272 may ship
 * its ID/corpus/library instrument without copying #271's interaction taxonomy.
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
  const head = ['pair', 'B first 30 in A', 'B overall in A', 'first new B decision'];
  const body = rows.map((row) => [
    `${row.a}→${row.b}`,
    percent(row.opening.idOverlap),
    percent(row.overall.idOverlap),
    row.overall.firstNewIndex < 0
      ? 'none'
      : `#${row.overall.firstNewIndex + 1} (${row.overall.firstNewYear ?? '?'})`,
  ]);
  if (rows.length) {
    body.push([
      'mean',
      percent(mean(rows.map((row) => row.opening.idOverlap))),
      percent(mean(rows.map((row) => row.overall.idOverlap))),
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

export function measureReplayPair(source: Source, a: number, b: number): ReplayPair {
  const years = CAMPAIGNS.short.years + 1;
  const first = eventDecisionStream(playedRun(source, a, years).world.decisionLog);
  const second = eventDecisionStream(playedRun(source, b, years).world.decisionLog);
  return {
    a,
    b,
    opening: compareDecisionStreams(first, second.slice(0, 30)),
    overall: compareDecisionStreams(first, second),
  };
}

export function measureLibraryVisibility(source: Source, seed: number, nextSeed: number): LibraryReading {
  const ctx = playedRun(source, seed, CAMPAIGNS.short.years + 1);
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
  console.log('  shape overlap: awaiting #271 canonical shapeOf (not duplicated here)');
  console.log('');
  for (const line of libraryLines(measureLibraryVisibility(source, rows[0]!.a, rows[0]!.b))) console.log(line);
  console.log('');
  const neutrality = gateLibraryNeutrality(source);
  console.log('Library mechanical identity (delegated to gate: library-neutrality)');
  for (const line of neutrality.lines.slice(1)) console.log(line);
  process.exit(neutrality.ok ? 0 : 1);
}
