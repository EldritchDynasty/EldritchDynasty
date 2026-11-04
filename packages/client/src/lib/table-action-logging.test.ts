import { describe, expect, it } from 'vitest';
import { tableWorkloadWindows, type ReadingLogEvent } from './reading-log.js';

const action = (
  at: number, verb: 'order' | 'muster', category: 'study' | 'marriages' | 'withdraw',
  status: 'attempted' | 'accepted' | 'refused',
): ReadingLogEvent => verb === 'order'
  ? { at, kind: 'action', verb, act: 'table', category: category as 'study' | 'marriages', status }
  : { at, kind: 'action', verb, act: 'muster', category: 'withdraw', status };

describe('Table workload observation windows (#1992)', () => {
  it('splits successful new starts and displayed pickups, attributing orders to their own house', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 0, kind: 'pane', pane: 'house' },
      { at: 10, kind: 'action', verb: 'begin', act: 'start' },
      { at: 10, kind: 'run', campaign: 'short', seed: 41 },
      { at: 10, kind: 'year', year: 1042 },
      { at: 20, kind: 'pane', pane: 'table' },
      action(30, 'order', 'study', 'attempted'),
      action(31, 'order', 'study', 'accepted'),
      { at: 40, kind: 'break', on: true },
      { at: 50, kind: 'break', on: false },
      { at: 60, kind: 'pane', pane: 'house' },
      { at: 70, kind: 'year', year: 1048 },
      { at: 80, kind: 'pickup' },
      { at: 81, kind: 'run', campaign: 'long', seed: 42 },
      { at: 81, kind: 'year', year: 1110 },
      { at: 85, kind: 'pane', pane: 'table' },
      action(90, 'muster', 'withdraw', 'attempted'),
      action(91, 'muster', 'withdraw', 'refused'),
      { at: 95, kind: 'visible', visible: false },
      { at: 100, kind: 'visible', visible: true },
      { at: 105, kind: 'pane', pane: 'house' },
    ];
    const windows = tableWorkloadWindows(events, 110);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      source: 'begin', endedBy: 'pickup', campaign: 'short', seed: 41,
      startedAt: 10, endedAt: 80, firstObservedYear: 1042, lastObservedYear: 1048,
      observedYearDelta: 6, foregroundMs: 60, tableForegroundMs: 30,
    });
    expect(windows[0]!.actions.orders).toMatchObject([
      { category: 'study', attempts: 1, accepted: 1, refused: 0, unfinished: 0 },
    ]);
    expect(windows[0]!.actions.muster).toEqual([]);
    expect(windows[1]).toMatchObject({
      source: 'pickup', endedBy: 'open', campaign: 'long', seed: 42,
      startedAt: 80, endedAt: 110, firstObservedYear: 1110, lastObservedYear: 1110,
      observedYearDelta: 0, foregroundMs: 25, tableForegroundMs: 15,
    });
    expect(windows[1]!.actions.orders).toEqual([]);
    expect(windows[1]!.actions.muster).toMatchObject([
      { category: 'withdraw', attempts: 1, refused: 1, unfinished: 0 },
    ]);
  });

  it('does not treat an unconfirmed load as a new house and preserves unfinished attempts', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'year', year: 1100 },
      action(1, 'order', 'study', 'attempted'),
      { at: 2, kind: 'action', verb: 'load', act: 'start' },
      action(3, 'order', 'marriages', 'attempted'),
      action(4, 'order', 'marriages', 'refused'),
      { at: 5, kind: 'action', verb: 'begin', act: 'start' },
      { at: 6, kind: 'year', year: 1100 },
      action(7, 'order', 'study', 'attempted'),
      action(8, 'order', 'study', 'accepted'),
    ];
    const windows = tableWorkloadWindows(events, 9);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.actions.orders).toMatchObject([
      { category: 'marriages', attempts: 1, refused: 1, unfinished: 0 },
      { category: 'study', attempts: 1, accepted: 0, unfinished: 1 },
    ]);
    expect(windows[1]!.actions.orders).toMatchObject([
      { category: 'study', attempts: 1, accepted: 1, unfinished: 0 },
    ]);
    expect(windows[0]!.endedBy).toBe('begin');
    expect(windows[1]!.source).toBe('begin');
  });

  it('uses the same event-cap/end boundary as export, without counting later activity', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 0, kind: 'pane', pane: 'table' },
      { at: 5, kind: 'run', campaign: 'short', seed: 19 },
      action(10, 'order', 'study', 'attempted'),
      { at: 20, kind: 'visible', visible: false },
      { at: 30, kind: 'visible', visible: true },
      { at: 40, kind: 'end', reason: 'exported' },
      action(50, 'order', 'study', 'accepted'),
    ];
    const eventsBefore = JSON.stringify(events);
    const windows = tableWorkloadWindows(events, 500, true);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      source: 'initial', endedBy: 'cap', startedAt: 0, endedAt: 40,
      foregroundMs: 30, tableForegroundMs: 30,
    });
    expect(windows[0]!.actions.orders).toMatchObject([
      { category: 'study', attempts: 1, accepted: 0, unfinished: 1 },
    ]);
    expect(tableWorkloadWindows(events, 15)[0]).toMatchObject({
      endedBy: 'open', endedAt: 15, foregroundMs: 15, tableForegroundMs: 15,
    });
    // An explicitly exported, untruncated log ends normally; truncation
    // describes the observation limit even when the terminal reason is export.
    expect(tableWorkloadWindows(events, 500, false)[0]!.endedBy).toBe('end');
    expect(JSON.stringify(events)).toBe(eventsBefore);
  });
});
