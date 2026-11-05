import { reportReaderCohort } from '../../../../tools/reader-cohort-metrics.js';
import { describe, expect, it } from 'vitest';
import { reportReadingLogs } from '../../../../tools/reader-evidence-report.js';

const log = (events: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) => ({
  format: 'ed-reading-log/12',
  build: { sha: 'abcdef012345', platform: 'test' },
  truncated: false,
  events,
  // A forged/stale summary must not be used as the report's numerical source.
  summary: { foregroundMs: 99_999_999, answers: 999_999 },
  ...overrides,
});

const first = () => [
  { at: 0, kind: 'visible', visible: true },
  { at: 0, kind: 'focus', focused: true },
  { at: 100, kind: 'action', verb: 'begin', act: 'start' },
  { at: 100, kind: 'run', campaign: 'short', seed: 987654321 },
  { at: 100, kind: 'pane', pane: 'table' },
  { at: 150, kind: 'year', year: 1042 },
  { at: 200, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
  { at: 201, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' },
  { at: 250, kind: 'break', on: true },
  { at: 350, kind: 'break', on: false },
  { at: 400, kind: 'year', year: 1045 },
  { at: 420, kind: 'page', page: 'private-page', year: 1045, event: 'private-event', answer: 'glimpse' },
  { at: 480, kind: 'page', page: 'private-page-2', year: 1045, answer: 'clause' },
  { at: 500, kind: 'end', reason: 'exported' },
];

describe('offline reading and Table evidence report (#1945, #1992)', () => {
  it('reads both historic /12 and failed-pickup /13 logs without mislabelling mixed input', () => {
    const legacy = log(first());
    const current = log([
      ...first().slice(0, -1),
      { at: 485, kind: 'action', verb: 'load', act: 'start' },
      { at: 486, kind: 'pickup-failed' },
      { at: 500, kind: 'end', reason: 'exported' },
    ], { format: 'ed-reading-log/13' });
    expect(reportReadingLogs([legacy]).sourceFormat).toBe('ed-reading-log/12');
    expect(reportReadingLogs([current]).sourceFormat).toBe('ed-reading-log/13');
    const combined = reportReadingLogs([legacy, current]);
    expect(combined.sourceFormat).toBe('mixed');
    expect(combined.totals.windows).toBe(2);
    expect(reportReaderCohort([legacy, current]).inputFormat).toBe('mixed');
    expect(reportReaderCohort([current]).inputFormat).toBe('ed-reading-log/13');

    const mislabeled = log([
      ...first().slice(0, -1),
      { at: 490, kind: 'pickup-failed' },
      { at: 500, kind: 'end', reason: 'exported' },
    ]);
    expect(() => reportReadingLogs([mislabeled])).toThrow('marker requires ed-reading-log/13');
  });

  it('recomputes exposure and answers, excludes title time, and keeps censored intervals distinct', () => {
    const report = reportReadingLogs([log(first())]);
    expect(report.format).toBe('ed-reader-evidence-report/1');
    expect(report.inputLogs).toBe(1);
    expect(report.logs[0]?.foregroundMs).toBe(400);
    expect(report.totals.foregroundMsInWindows).toBe(300);
    expect(report.totals.tableForegroundMs).toBe(300);
    expect(report.totals.tableForegroundShare).toBe(1);
    expect(report.logs[0]?.windows).toMatchObject([{
      source: 'begin',
      endedBy: 'end',
      campaign: 'short',
      observedYearDelta: 3,
      tableForegroundMs: 300,
      ordersPerObservedYear: 1 / 3,
      orders: { attempts: 1, accepted: 1, refused: 0, unfinished: 0 },
    }]);
    expect(report.logs[0]?.answers).toBe(2);
    expect(report.logs[0]?.answerIntervals).toEqual({
      completed: 1, censored: 1, maxCompletedForegroundMs: 60,
    });
    // Raw page/event identifiers, player-entered strings and seed values never
    // cross the aggregate output boundary even when input contains them.
    const text = JSON.stringify(report);
    for (const privateValue of ['private-page', 'private-event', '987654321', '99999999']) {
      expect(text).not.toContain(privateValue);
    }
  });

  it('sums denominators rather than averaging per-log shares, and separates incomplete calls', () => {
    const second = [
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 0, kind: 'action', verb: 'begin', act: 'start' },
      { at: 0, kind: 'run', campaign: 'demo', seed: 5 },
      { at: 0, kind: 'pane', pane: 'house' },
      { at: 80, kind: 'pane', pane: 'table' },
      { at: 90, kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'attempted' },
      { at: 100, kind: 'end', reason: 'stopped' },
    ];
    const report = reportReadingLogs([log(first()), log(second)]);
    expect(report.totals.windows).toBe(2);
    expect(report.totals.foregroundMsInWindows).toBe(400);
    expect(report.totals.tableForegroundMs).toBe(320);
    expect(report.totals.tableForegroundShare).toBe(0.8);
    expect(report.totals.orders).toMatchObject({ attempts: 1, accepted: 1, unfinished: 0 });
    expect(report.totals.muster).toMatchObject({ attempts: 1, accepted: 0, unfinished: 1 });
    expect(report.logs[1]?.windows[0]).toMatchObject({
      observedYearDelta: null, ordersPerObservedYear: null, campaign: 'demo',
    });
  });

  it('refuses unsupported or incomplete exports rather than inventing time', () => {
    expect(() => reportReadingLogs([])).toThrow(/At least one/);
    expect(() => reportReadingLogs([log(first(), { format: 'ed-reading-log/11' })])).toThrow(/unsupported format/);
    expect(() => reportReadingLogs([log(first().slice(0, -1))])).toThrow(/terminal event/);
    const disorder = first();
    disorder[5] = { at: 10, kind: 'year', year: 1042 };
    expect(() => reportReadingLogs([log(disorder)])).toThrow(/timeline/);
    expect(() => reportReadingLogs([log(first(), { truncated: 'false' })])).toThrow(/cap state/);
  });

  it('never emits unknown campaign text, build identifiers or source filenames', () => {
    const untrusted = first();
    untrusted[3] = { at: 100, kind: 'run', campaign: 'private-campaign', seed: 123 };
    const report = reportReadingLogs([log(untrusted, {
      build: { sha: 'private-build-token', platform: 'private-platform' },
    })]);
    expect(report.logs[0]?.windows[0]?.campaign).toBe('unknown');
    expect(report.logs[0]?.buildSha).toBe('unknown');
    expect(JSON.stringify(report)).not.toContain('private-');
  });
});


describe('cohort timing and Table rate reductions (#1945, #1984, #1992)', () => {
  function completedHouse() {
    return log([
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 100, kind: 'action', verb: 'begin', act: 'start' },
      { at: 100, kind: 'run', campaign: 'short', seed: 612345789 },
      { at: 100, kind: 'year', year: 1042 },
      { at: 200, kind: 'action', verb: 'found', act: 'signing', status: 'accepted' },
      { at: 300, kind: 'action', verb: 'enter', act: 'signing', status: 'returned' },
      { at: 400, kind: 'pane', pane: 'table' },
      { at: 500, kind: 'action', verb: 'order', act: 'table', category: 'unknown', status: 'attempted' },
      { at: 500, kind: 'action', verb: 'order', act: 'table', category: 'unknown', status: 'accepted' },
      { at: 600, kind: 'action', verb: 'choose', act: 'answer', status: 'attempted' },
      { at: 600, kind: 'action', verb: 'choose', act: 'answer', status: 'accepted' },
      { at: 600, kind: 'page', year: 1042, page: 'private-first-page', answer: 'glimpse' },
      { at: 800, kind: 'year', year: 1045 },
      { at: 800, kind: 'page', year: 1045, page: 'private-second-page', answer: 'clause' },
      { at: 1100, kind: 'end', reason: 'exported' },
    ]);
  }

  it('quantifies completed entry and answer exposure separately from censored waits', () => {
    const result = reportReaderCohort([completedHouse()]);
    expect(result.format).toBe('ed-reader-cohort-metrics/1');
    expect(result.entries).toMatchObject({ completed: 1, censored: 0 });
    expect(result.entries.completedForegroundMs).toEqual({
      // Entry starts at Begin (100ms), not at log start (0ms). The first
      // accepted family/Table command is at 500ms: 500 - 100 = 400ms.
      count: 1, min: 400, median: 400, p90: 400, max: 400,
    });
    expect(result.answerGaps).toMatchObject({
      completed: 1, censored: 1,
      completedForegroundMs: { count: 1, median: 200 },
      censoredForegroundLowerBoundMs: { count: 1, median: 300 },
      completedGameYears: { count: 1, median: 3 },
    });
    const short = result.campaigns.find((row) => row.campaign === 'short');
    expect(short).toMatchObject({
      observedWindows: 1, entries: { completed: 1, censored: 0 },
      manualTableAttempts: 1, manualTableAccepted: 1,
      manualTableRefused: 0, manualTableUnfinished: 0, delegationAttempts: 0,
    });
    expect(short?.tableForegroundMs).toBeGreaterThan(0);
    expect(short?.attemptsPerTableForegroundHourEstimate).toBeGreaterThan(0);

    const text = JSON.stringify(result);
    for (const privateValue of ['private-first-page', 'private-second-page', '612345789']) {
      expect(text).not.toContain(privateValue);
    }
  });

  it('preserves censored entry exposure and null Table rates without a denominator', () => {
    const partial = log([
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 200, kind: 'action', verb: 'begin', act: 'start' },
      { at: 200, kind: 'run', campaign: 'demo', seed: 4 },
      { at: 280, kind: 'action', verb: 'found', act: 'signing', status: 'refused' },
      { at: 430, kind: 'end', reason: 'exported' },
    ]);
    const result = reportReaderCohort([partial]);
    expect(result.entries).toMatchObject({
      completed: 0, censored: 1,
      completedForegroundMs: { count: 0, median: null, p90: null },
      censoredForegroundLowerBoundMs: { count: 1, median: 230 },
    });
    expect(result.campaigns.find((row) => row.campaign === 'demo')).toMatchObject({
      tableForegroundMs: 0, attemptsPerTableForegroundHourEstimate: null,
      entries: { completed: 0, censored: 1 },
    });
  });

  it('marks multiple builds but never invents a distinct-person sample size', () => {
    const a = completedHouse();
    const b = log(completedHouse().events, { build: { sha: '1234567abcdef', platform: 'test' } });
    const result = reportReaderCohort([a, b]);
    expect(result.inputLogs).toBe(2);
    expect(result.builds).toEqual(['1234567abcdef', 'abcdef012345']);
    expect(result.mixedBuilds).toBe(true);
    expect(result.entries.completed).toBe(2);
    expect(result.caveats.join(' ')).toMatch(/participant/);
  });

  it('retains evidence-report validation instead of interpreting malformed exports', () => {
    expect(() => reportReaderCohort([])).toThrow(/At least one/);
    expect(() => reportReaderCohort([log(completedHouse().events, { format: 'ed-reading-log/11' })]))
      .toThrow(/unsupported format/);
    expect(() => reportReaderCohort([log(completedHouse().events.slice(0, -1))]))
      .toThrow(/terminal event/);
  });
});
