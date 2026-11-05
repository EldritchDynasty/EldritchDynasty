import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  READING_LOG_FORMAT,
  READING_LOG_MAX_EVENTS,
  summarize,
  tableWorkloadWindows,
  type ReadingLogArtifact,
  type ReadingLogEvent,
  type TableActionCounts,
} from '../packages/client/src/lib/reading-log.js';

/**
 * Read-only research reduction for #1945 and #1992.
 * It uses exactly the same observation arithmetic as the opt-in client log.
 * Input files never leave the machine; stdout contains aggregates, not raw
 * page identifiers, typed names, seed values, or action arguments.
 */
export interface ActionTotals {
  attempts: number;
  accepted: number;
  refused: number;
  threw: number;
  returned: number;
  unfinished: number;
}

interface WorkloadWindow {
  source: 'initial' | 'begin' | 'pickup';
  endedBy: 'begin' | 'pickup' | 'end' | 'open' | 'cap';
  campaign: 'short' | 'long' | 'demo' | 'unknown';
  observedYearDelta: number | null;
  foregroundMs: number;
  tableForegroundMs: number;
  tableForegroundShare: number | null;
  /** Null for unknown/zero observed game-year span; never a generation rate. */
  ordersPerObservedYear: number | null;
  orders: ActionTotals;
  muster: ActionTotals;
  delegation: ActionTotals;
}

interface EvidenceLog {
  index: number;
  buildSha: string;
  truncated: boolean;
  foregroundMs: number;
  answers: number;
  /** Only gaps starting at an observed answer, not initial exposure. */
  answerIntervals: { completed: number; censored: number; maxCompletedForegroundMs: number | null };
  entries: { completed: number; censored: number };
  windows: WorkloadWindow[];
}

export interface ReaderEvidenceReport {
  format: 'ed-reader-evidence-report/1';
  sourceFormat: typeof READING_LOG_FORMAT;
  inputLogs: number;
  totals: {
    windows: number;
    foregroundMsInWindows: number;
    tableForegroundMs: number;
    tableForegroundShare: number | null;
    orders: ActionTotals;
    muster: ActionTotals;
    delegation: ActionTotals;
    completedAnswerIntervals: number;
    censoredAnswerIntervals: number;
    completedEntries: number;
    censoredEntries: number;
  };
  logs: EvidenceLog[];
  caveats: string[];
}

const ZERO = (): ActionTotals => ({
  attempts: 0, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 0,
});

function sumCounts(rows: readonly TableActionCounts[]): ActionTotals {
  const total = ZERO();
  for (const row of rows) {
    total.attempts += row.attempts;
    total.accepted += row.accepted;
    total.refused += row.refused;
    total.threw += row.threw;
    total.returned += row.returned;
    total.unfinished += row.unfinished;
  }
  return total;
}

function addCounts(a: ActionTotals, b: ActionTotals): void {
  a.attempts += b.attempts;
  a.accepted += b.accepted;
  a.refused += b.refused;
  a.threw += b.threw;
  a.returned += b.returned;
  a.unfinished += b.unfinished;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Only known campaign identifiers cross the reducer's output boundary. */
function campaignOf(value: string | null): WorkloadWindow['campaign'] {
  return value === 'short' || value === 'long' || value === 'demo' ? value : 'unknown';
}

/**
 * Reject unsupported, partial and temporally invalid exports rather than
 * emitting deceptively precise findings. The stored summary is NOT trusted:
 * all numbers below are recomputed from observed events.
 */
function validatedEvents(input: unknown, index: number): {
  events: ReadingLogEvent[];
  truncated: boolean;
  buildSha: string;
} {
  const fail = (reason: string): never => { throw new Error('Reading log ' + index + ': ' + reason); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');
  const artifact = input as Partial<ReadingLogArtifact>;
  if (artifact.format !== READING_LOG_FORMAT) fail('unsupported format; ed-reading-log/12 required');
  if (typeof artifact.truncated !== 'boolean') fail('missing cap state');
  if (!Array.isArray(artifact.events) || artifact.events.length < 3
    || artifact.events.length > READING_LOG_MAX_EVENTS + 1) fail('invalid event count');
  let previous = 0;
  for (const event of artifact.events) {
    if (!event || typeof event !== 'object' || typeof event.kind !== 'string'
      || !Number.isFinite(event.at) || event.at < previous) fail('invalid event timeline');
    previous = event.at;
  }
  const events = artifact.events as ReadingLogEvent[];
  const final = events.at(-1);
  if (!final || final.kind !== 'end' || !['exported', 'stopped', 'unloaded'].includes(final.reason)) {
    fail('missing terminal event; cannot infer exposure after the last event');
  }
  if (events.slice(0, -1).some((e) => e.kind === 'end')) fail('multiple terminal events');
  const rawSha = artifact.build?.sha;
  const buildSha = typeof rawSha === 'string' && /^[0-9a-f]{7,40}$/i.test(rawSha)
    ? rawSha : 'unknown';
  return { events, truncated: artifact.truncated, buildSha };
}

/**
 * Analyze one or more locally supplied exports. Each log is an observation
 * window, not necessarily a distinct person or a completed house/generation.
 * No individual event, page text, id, seed or filename is returned.
 */
export function reportReadingLogs(inputs: readonly unknown[]): ReaderEvidenceReport {
  if (inputs.length === 0) throw new Error('At least one exported reading log is required');
  const totals: ReaderEvidenceReport['totals'] = {
    windows: 0, foregroundMsInWindows: 0, tableForegroundMs: 0, tableForegroundShare: null,
    orders: ZERO(), muster: ZERO(), delegation: ZERO(),
    completedAnswerIntervals: 0, censoredAnswerIntervals: 0,
    completedEntries: 0, censoredEntries: 0,
  };
  const logs = inputs.map((input, i): EvidenceLog => {
    const { events, truncated, buildSha } = validatedEvents(input, i + 1);
    const end = events[events.length - 1] as Extract<ReadingLogEvent, { kind: 'end' }>;
    const summary = summarize(events, end.at, truncated);
    const windowRows = tableWorkloadWindows(events, end.at, truncated).map((window): WorkloadWindow => {
      const orders = sumCounts(window.actions.orders);
      const muster = sumCounts(window.actions.muster);
      const delegation = sumCounts(window.actions.delegation);
      totals.windows++;
      totals.foregroundMsInWindows += window.foregroundMs;
      totals.tableForegroundMs += window.tableForegroundMs;
      addCounts(totals.orders, orders);
      addCounts(totals.muster, muster);
      addCounts(totals.delegation, delegation);
      return {
        source: window.source,
        endedBy: window.endedBy,
        campaign: campaignOf(window.campaign),
        observedYearDelta: window.observedYearDelta,
        foregroundMs: window.foregroundMs,
        tableForegroundMs: window.tableForegroundMs,
        tableForegroundShare: ratio(window.tableForegroundMs, window.foregroundMs),
        ordersPerObservedYear: window.observedYearDelta && window.observedYearDelta > 0
          ? orders.attempts / window.observedYearDelta : null,
        orders, muster, delegation,
      };
    });
    const answerIntervals = summary.gaps.filter((gap) => gap.from.kind !== 'start');
    const complete = answerIntervals.filter((gap) => !gap.censored);
    const censored = answerIntervals.length - complete.length;
    const completedEntries = summary.entries.filter((entry) => !entry.censored).length;
    totals.completedAnswerIntervals += complete.length;
    totals.censoredAnswerIntervals += censored;
    totals.completedEntries += completedEntries;
    totals.censoredEntries += summary.entries.length - completedEntries;
    return {
      index: i + 1, buildSha, truncated, foregroundMs: summary.foregroundMs,
      answers: summary.answers,
      answerIntervals: {
        completed: complete.length, censored,
        maxCompletedForegroundMs: complete.length
          ? Math.max(...complete.map((gap) => gap.foregroundMs)) : null,
      },
      entries: { completed: completedEntries, censored: summary.entries.length - completedEntries },
      windows: windowRows,
    };
  });
  totals.tableForegroundShare = ratio(totals.tableForegroundMs, totals.foregroundMsInWindows);
  return {
    format: 'ed-reader-evidence-report/1',
    sourceFormat: READING_LOG_FORMAT,
    inputLogs: logs.length,
    totals,
    logs,
    caveats: [
      'An input log is not a distinct participant or a full campaign; repeated sessions must be linked by the researcher outside this report.',
      'Foreground is visible, focused, unbroken exposure, not attention, comprehension, enjoyment or reading.',
      'Table exposure uses only observed house windows; title-screen time is excluded from its denominator.',
      'Observed year delta is a span between two seen markers, not exposure-years or a completed Head tenure. Null rates are intentionally not inferred.',
      'Censored answer intervals and entry timings are separately counted, never treated as completed or failed.',
      'Attempted, accepted, refused, thrown and unfinished actions are distinct. Delegation returning does not prove a change.',
      'These observations alone do not justify an automation/default policy or assert a player-study outcome.',
    ],
  };
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0 || files.some((x) => x.startsWith('-'))) {
    throw new Error('Usage: npx tsx --tsconfig tsconfig.base.json tools/reader-evidence-report.ts <export1.json> [export2.json ...]');
  }
  const inputs: unknown[] = [];
  for (const file of files) inputs.push(JSON.parse(await readFile(file, 'utf8')) as unknown);
  process.stdout.write(JSON.stringify(reportReadingLogs(inputs), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? error.message + '\n' : 'Reader evidence report failed\n');
    process.exitCode = 1;
  });
}
