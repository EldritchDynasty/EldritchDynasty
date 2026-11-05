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
