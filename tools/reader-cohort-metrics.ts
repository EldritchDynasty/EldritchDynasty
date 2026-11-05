import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  summarize, type EntryTiming, type ReadingLogArtifact, type ReadingLogEvent,
} from '../packages/client/src/lib/reading-log.js';
import { reportReadingLogs } from './reader-evidence-report.js';

/**
 * Research-only reductions of existing consented reading logs (#1945, #1984, #1992).
 * No client wiring, instrumentation, persistence or network calls.
 * Every input goes through the evidence report's format/timeline validation first.
 * Unlike a player study, these are observation windows, NOT independent people.
 */

export interface Distribution {
  count: number;
  min: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
}

export interface TimingMetrics {
  completed: number;
  censored: number;
  completedWallMs: Distribution;
  completedForegroundMs: Distribution;
  /** Elapsed exposure only up to observation end; not failed/completed time. */
  censoredForegroundLowerBoundMs: Distribution;
}

export type KnownCampaign = 'short' | 'long' | 'demo' | 'unknown';

export interface CampaignMetrics {
  campaign: KnownCampaign;
  /** A window may be partial or may include no observed gameplay year. */
  observedWindows: number;
  entries: TimingMetrics;
  foregroundMs: number;
  tableForegroundMs: number;
  tableForegroundShare: number | null;
  manualTableAttempts: number;
  manualTableAccepted: number;
  manualTableRefused: number;
  manualTableUnfinished: number;
  delegationAttempts: number;
  /** Attempts per hour of exposure to the Table pane, not per hour of play. */
  attemptsPerTableForegroundHourEstimate: number | null;
}

export interface ReaderCohortMetrics {
  format: 'ed-reader-cohort-metrics/1';
  inputFormat: 'ed-reading-log/12';
  inputLogs: number;
  /** Hex build SHAs are retained to identify incompatible builds; no file names or seeds. */
  builds: string[];
  mixedBuilds: boolean;
  entries: TimingMetrics;
  answerGaps: TimingMetrics & {
    completedGameYears: Distribution;
  };
  campaigns: CampaignMetrics[];
  caveats: string[];
}

function distribution(values: readonly number[]): Distribution {
  const sorted = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, min: null, median: null, p90: null, max: null };
  // The interpolated empirical quantile is explicit and deterministic even
  // with two observations. Never infer a percentile from censored intervals.
  const quantile = (p: number): number => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  };
  return {
    count: sorted.length, min: sorted[0]!, median: quantile(0.5),
    p90: quantile(0.9), max: sorted[sorted.length - 1]!,
  };
}

function timing<T extends {
  censored: boolean;
  wallMs: number;
  foregroundMs: number;
}>(rows: readonly T[]): TimingMetrics {
  const complete = rows.filter((row) => !row.censored);
  const censored = rows.filter((row) => row.censored);
  return {
    completed: complete.length,
    censored: censored.length,
    completedWallMs: distribution(complete.map((row) => row.wallMs)),
    completedForegroundMs: distribution(complete.map((row) => row.foregroundMs)),
    censoredForegroundLowerBoundMs: distribution(censored.map((row) => row.foregroundMs)),
  };
}

function campaignOf(value: string | null): KnownCampaign {
  return value === 'short' || value === 'long' || value === 'demo' ? value : 'unknown';
}

function rate(count: number, ms: number): number | null {
  return ms > 0 ? count / (ms / 3_600_000) : null;
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

interface CampaignAccumulator {
  entries: EntryTiming[];
  windows: number;
  foreground: number;
  table: number;
  manualAttempts: number;
  manualAccepted: number;
  manualRefused: number;
  manualUnfinished: number;
  delegationAttempts: number;
}

function campaignAccumulator(): CampaignAccumulator {
  return {
    entries: [], windows: 0, foreground: 0, table: 0,
    manualAttempts: 0, manualAccepted: 0, manualRefused: 0,
    manualUnfinished: 0, delegationAttempts: 0,
  };
}

/**
 * Reduce independently exported sessions, preserving censoring and campaign
 * boundaries. Validation is delegated to reportReadingLogs: it rejects
 * unsupported formats, nonmonotonic time and incomplete terminal markers.
 *
 * Do not treat separate files as distinct participants or infer unobserved
 * Head tenures. The only denominators are observed foreground milliseconds,
 * observed Table foreground milliseconds and explicitly completed intervals.
 */
export function reportReaderCohort(inputs: readonly unknown[]): ReaderCohortMetrics {
  const validated = reportReadingLogs(inputs);
  const entryRows: EntryTiming[] = [];
  const answerRows: ReturnType<typeof summarize>['gaps'] = [];
  const campaigns = new Map<KnownCampaign, CampaignAccumulator>();

  const ensure = (campaign: KnownCampaign): CampaignAccumulator => {
    let acc = campaigns.get(campaign);
    if (!acc) {
      acc = campaignAccumulator();
      campaigns.set(campaign, acc);
    }
    return acc;
  };

  for (const [i, input] of inputs.entries()) {
    // This cast follows successful input validation above, not a trust in the
    // artifact's stored summary. Recompute from the event stream itself.
    const artifact = input as ReadingLogArtifact;
    const events: ReadingLogEvent[] = artifact.events;
    const last = events[events.length - 1] as Extract<ReadingLogEvent, { kind: 'end' }>;
    const summary = summarize(events, last.at, artifact.truncated);
    entryRows.push(...summary.entries);
    answerRows.push(...summary.gaps.filter((gap) => gap.from.kind !== 'start'));

    for (const entry of summary.entries) {
      ensure(campaignOf(entry.campaign)).entries.push(entry);
    }

    for (const window of validated.logs[i]!.windows) {
      const bucket = ensure(window.campaign);
      bucket.windows++;
      bucket.foreground += window.foregroundMs;
      bucket.table += window.tableForegroundMs;
      bucket.manualAttempts += window.orders.attempts + window.muster.attempts;
      bucket.manualAccepted += window.orders.accepted + window.muster.accepted;
      bucket.manualRefused += window.orders.refused + window.muster.refused;
      bucket.manualUnfinished += window.orders.unfinished + window.muster.unfinished;
      bucket.delegationAttempts += window.delegation.attempts;
    }
  }

  const builds = [...new Set(validated.logs.map((log) => log.buildSha))].sort();
  const completeAnswerRows = answerRows.filter((gap) => !gap.censored);
  return {
    format: 'ed-reader-cohort-metrics/1',
    inputFormat: 'ed-reading-log/12',
    inputLogs: validated.inputLogs,
    builds,
    mixedBuilds: builds.length > 1,
    entries: timing(entryRows),
    answerGaps: {
      ...timing(answerRows),
      // A missing or reversed year is not a duration. Do not estimate it.
      completedGameYears: distribution(completeAnswerRows.map((gap) => gap.years).filter(
        (year): year is number => year !== null,
      )),
    },
    campaigns: [...campaigns.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([campaign, bucket]) => ({
      campaign,
      observedWindows: bucket.windows,
      entries: timing(bucket.entries),
      foregroundMs: bucket.foreground,
      tableForegroundMs: bucket.table,
      tableForegroundShare: share(bucket.table, bucket.foreground),
      manualTableAttempts: bucket.manualAttempts,
      manualTableAccepted: bucket.manualAccepted,
      manualTableRefused: bucket.manualRefused,
      manualTableUnfinished: bucket.manualUnfinished,
      delegationAttempts: bucket.delegationAttempts,
      attemptsPerTableForegroundHourEstimate: rate(bucket.manualAttempts, bucket.table),
    })),
    caveats: [
      'One exported log is one observation window, not one participant or a full run. Link sittings externally.',
      'Split mixed builds, campaigns and recruitment cohorts before interpreting comparative distributions.',
      'Completed-only quantiles use linear interpolation. Censored exposure is a lower bound, not a completed wait or a failure.',
      'A first accepted command marks a candidate family action; an observer must determine if it was consequential.',
      'Foreground means visible, focused, unbroken exposure, not comprehension, reading or active attention.',
      'Table rates use attempted manual order/muster commands per Table-pane foreground hour, not per generation or player hour.',
      'Some Table commands may be issued outside the Table pane. Zero exposure produces a null rate, not zero burden.',
      'Delegation returning is not proof of an actual setting change or automatic work. No bot proxy or reader study was run.',
      'No Head tenure, exposure-year, participant count, source name or unobserved decision is inferred.',
    ],
  };
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (!paths.length || paths.some((path) => path.startsWith('-'))) {
    throw new Error('Usage: npx tsx --tsconfig tsconfig.base.json tools/reader-cohort-metrics.ts <export1.json> [export2.json ...]');
  }
  const inputs: unknown[] = [];
  for (const path of paths) inputs.push(JSON.parse(await readFile(path, 'utf8')) as unknown);
  process.stdout.write(JSON.stringify(reportReaderCohort(inputs), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? error.message + '\n' : 'Reader cohort metrics failed\n');
    process.exitCode = 1;
  });
}
