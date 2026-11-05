import { describe, expect, it } from 'vitest';
import { ReadingLog, recordActions, summarize, tableWorkloadWindows, type ReadingLogEvent } from './reading-log.js';
import type { GameActions } from './game.js';

const action = (
  at: number, verb: 'order' | 'muster', category: 'study' | 'marriages' | 'withdraw',
  status: 'attempted' | 'accepted' | 'refused',
): ReadingLogEvent => verb === 'order'
  ? { at, kind: 'action', verb, act: 'table', category: category as 'study' | 'marriages', status }
  : { at, kind: 'action', verb, act: 'muster', category: 'withdraw', status };

describe('Table workload observation windows (#1992)', () => {
  it('does not let a throwing native then getter break a saved-run action', () => {
    const log = new ReadingLog(
      () => 0,
      { sha: 'local', platform: 'native' },
      '2026-11-05T00:00:00.000Z',
      { visible: true, focused: true },
    );
    // A native adapter can return a foreign thenable; its throwing accessor
    // is not a refusal by the game and must not be probed by the observer twice.
    let inspected = 0;
    const opaque = {
      get then(): never {
        inspected++;
        throw new Error('host Promise proxy invalidated');
      },
    };
    const actions = recordActions({
      resume: () => opaque,
    } as unknown as GameActions, log);
    expect(actions.resume()).toBe(opaque);
    expect(inspected).toBe(1);
    log.chronicle([{ id: 'p1', year: 1042, eventId: 'scene_1' }]);
    const page = log.events.find((event) => event.kind === 'page');
    expect(page).toBeDefined();
    if (page?.kind === 'page') expect(page.carried).toBeUndefined();
  });

  it('ignores stale Table-pane exposure before a successful Begin or pickup', () => {
    const titleOnly: ReadingLogEvent[] = [
      { at: 0, kind: 'visible', visible: true },
      { at: 0, kind: 'focus', focused: true },
      { at: 2, kind: 'pane', pane: 'table' },
      { at: 10, kind: 'action', verb: 'resume', act: 'start' },
      // The save picker is cancelled; no Chronicle pickup or public run.
      { at: 45, kind: 'pane', pane: 'house' },
    ];
    expect(tableWorkloadWindows(titleOnly, 50)).toEqual([]);

    const started: ReadingLogEvent[] = [
      ...titleOnly.slice(0, -1),
      { at: 25, kind: 'action', verb: 'begin', act: 'start' },
      { at: 25, kind: 'pane', pane: 'house' },
      { at: 30, kind: 'run', campaign: 'short', seed: 62 },
      { at: 30, kind: 'year', year: 1042 },
      { at: 40, kind: 'pane', pane: 'table' },
      { at: 55, kind: 'pane', pane: 'house' },
    ];
    const windows = tableWorkloadWindows(started, 60);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      source: 'begin', startedAt: 25, endedAt: 60,
      campaign: 'short', seed: 62, foregroundMs: 35, tableForegroundMs: 15,
    });
  });

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
      // Real App.vue order: load action -> pre-flush run -> Chronicle pickup.
      { at: 75, kind: 'action', verb: 'load', act: 'start' },
      { at: 79, kind: 'run', campaign: 'long', seed: 42 },
      { at: 80, kind: 'pickup' },
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

  it('defers a tentative loaded year alongside its run identity until the pickup boundary', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'run', campaign: 'short', seed: 41 },
      { at: 1, kind: 'year', year: 1042 },
      { at: 10, kind: 'year', year: 1090 },
      { at: 20, kind: 'action', verb: 'load', act: 'start' },
      // App.vue emits the incoming run and year before Chronicle confirms pickup.
      { at: 21, kind: 'run', campaign: 'long', seed: 91 },
      { at: 22, kind: 'year', year: 1330 },
      { at: 23, kind: 'pickup' },
      { at: 24, kind: 'year', year: 1331 },
    ];
    const before = JSON.stringify(events);
    const windows = tableWorkloadWindows(events, 30);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      campaign: 'short', seed: 41, firstObservedYear: 1042,
      lastObservedYear: 1090, observedYearDelta: 48, endedBy: 'pickup',
    });
    expect(windows[1]).toMatchObject({
      source: 'pickup', campaign: 'long', seed: 91,
      firstObservedYear: 1330, lastObservedYear: 1331, observedYearDelta: 1,
    });
    expect(JSON.stringify(events)).toBe(before);
  });

  it('does not fabricate a title-screen house from a tentative pickup year', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'pane', pane: 'house' },
      { at: 1, kind: 'action', verb: 'resume', act: 'start' },
      { at: 2, kind: 'run', campaign: 'long', seed: 41 },
      { at: 3, kind: 'year', year: 1200 },
      { at: 4, kind: 'pickup' },
    ];
    const windows = tableWorkloadWindows(events, 10);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      source: 'pickup', campaign: 'long', seed: 41,
      firstObservedYear: 1200, lastObservedYear: 1200, observedYearDelta: 0,
    });
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

  it('inherits the public run marker when a same-seed load produces no new run event', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'run', campaign: 'short', seed: 17 },
      { at: 1, kind: 'year', year: 1042 },
      { at: 2, kind: 'action', verb: 'resume', act: 'start' },
      { at: 3, kind: 'pickup' },
      { at: 4, kind: 'year', year: 1050 },
    ];
    const windows = tableWorkloadWindows(events, 5);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      campaign: 'short', seed: 17, source: 'initial', endedBy: 'pickup',
    });
    expect(windows[1]).toMatchObject({
      campaign: 'short', seed: 17, source: 'pickup', firstObservedYear: 1050,
    });
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

describe('historical reading summary cutoffs (#2894)', () => {
  const events: ReadingLogEvent[] = [
    { at: 0, kind: 'year', year: 1042 },
    { at: 10, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
    { at: 15, kind: 'page', page: 'chr_1', year: 1043, answer: 'glimpse' },
    { at: 20, kind: 'decision', year: 1044, decision: 'dec_1', event: 'scene', seen: false },
    { at: 25, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' },
    { at: 30, kind: 'interlude', year: 1045, event: 'frame', answer: 'interlude' },
    { at: 40, kind: 'end', reason: 'exported' },
  ];

  it('includes the cutoff instant but excludes later answers, decisions, outcomes and end reasons', () => {
    const before = JSON.stringify(events);
    const summary = summarize(events, 15);
    expect(summary.wallMs).toBe(15);
    expect(summary.foregroundMs).toBe(15);
    expect(summary.answers).toBe(1);
    expect(summary.decisions).toBe(0);
    expect(summary.tableActions.orders).toEqual([
      { category: 'study', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
    ]);
    expect(summary.gaps.at(-1)?.to).toEqual({ at: 15, year: 1042, kind: 'open' });
    expect(summarize(events, 15, true).gaps.at(-1)?.to.kind).toBe('open');
    expect(summarize(events, 15)).toEqual(summary);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('keeps the real end boundary and clamps a negative requested duration to zero', () => {
    const complete = summarize(events, 100);
    expect(complete.wallMs).toBe(40);
    expect(complete.answers).toBe(2);
    expect(complete.decisions).toBe(1);
    expect(complete.tableActions.orders[0]?.accepted).toBe(1);
    expect(complete.gaps.at(-1)?.to.kind).toBe('exported');
    const zero = summarize(events, -5);
    expect(zero.wallMs).toBe(0);
    expect(zero.foregroundMs).toBe(0);
    expect(zero.answers).toBe(0);
    expect(zero.gaps.at(-1)?.to.kind).toBe('open');
  });
});

describe('pickup attempts are not workload houses (#2895)', () => {
  it.each(['load', 'resume', 'importSave'] as const)('does not invent a house for an unconfirmed %s', (verb) => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'pane', pane: 'house' },
      { at: 2, kind: 'action', verb, act: 'start' },
    ];
    expect(tableWorkloadWindows(events, 5)).toEqual([]);

    const begun = tableWorkloadWindows([
      ...events,
      { at: 10, kind: 'action', verb: 'begin', act: 'start' },
      { at: 10, kind: 'run', campaign: 'short', seed: 41 },
    ], 20);
    expect(begun).toHaveLength(1);
    expect(begun[0]?.source).toBe('begin');
    expect(begun[0]?.foregroundMs).toBe(10);

    const pickedUp = tableWorkloadWindows([
      ...events,
      { at: 9, kind: 'run', campaign: 'long', seed: 42 },
      { at: 10, kind: 'pickup' },
    ], 20);
    expect(pickedUp).toHaveLength(1);
    expect(pickedUp[0]?.source).toBe('pickup');
    expect(pickedUp[0]?.campaign).toBe('long');
    expect(pickedUp[0]?.foregroundMs).toBe(10);
  });

  it('preserves an observed house and its unfinished Table work through a canceled pickup', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'run', campaign: 'short', seed: 41 },
      { at: 0, kind: 'pane', pane: 'table' },
      { at: 1, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
      { at: 2, kind: 'action', verb: 'load', act: 'start' },
    ];
    const before = JSON.stringify(events);
    const windows = tableWorkloadWindows(events, 5);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.source).toBe('initial');
    expect(windows[0]?.campaign).toBe('short');
    expect(windows[0]?.tableForegroundMs).toBe(5);
    expect(windows[0]?.actions.orders).toEqual([
      { category: 'study', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
    ]);
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe('full-screen frame Table exposure (#2898)', () => {
  it('excludes interludes and the last night while preserving all foreground and Table outcomes', () => {
    const events: ReadingLogEvent[] = [
      { at: 0, kind: 'action', verb: 'begin', act: 'start' },
      { at: 0, kind: 'pane', pane: 'table' },
      { at: 10, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
      { at: 10, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' },
      { at: 20, kind: 'interlude', year: 1100, event: 'frame', answer: 'interlude' },
      { at: 30, kind: 'visible', visible: false },
      { at: 40, kind: 'visible', visible: true },
      { at: 50, kind: 'action', verb: 'dismissInterlude', act: 'dismiss' },
      { at: 60, kind: 'break', on: true },
      { at: 70, kind: 'break', on: false },
      { at: 80, kind: 'ended' },
      { at: 90, kind: 'focus', focused: false },
      { at: 100, kind: 'focus', focused: true },
      { at: 110, kind: 'end', reason: 'exported' },
    ];
    const before = JSON.stringify(events);
    const windows = tableWorkloadWindows(events, 200);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.foregroundMs).toBe(80);
    expect(windows[0]?.tableForegroundMs).toBe(40);
    expect(windows[0]?.actions).toEqual(summarize(events, 200).tableActions);
    expect(windows[0]?.actions.orders[0]?.accepted).toBe(1);
    expect(tableWorkloadWindows(events, 45)[0]?.tableForegroundMs).toBe(20);
    expect(JSON.stringify(events)).toBe(before);
  });

  it.each(['begin', 'pickup'] as const)('clears a prior frame at a successful %s boundary', (boundary) => {
    for (const frame of [
      { at: 5, kind: 'interlude', year: 1100, event: 'frame', answer: 'interlude' },
      { at: 5, kind: 'ended' },
    ] as const) {
      const events: ReadingLogEvent[] = [
        { at: 0, kind: 'run', campaign: 'short', seed: 41 },
        { at: 0, kind: 'pane', pane: 'table' },
        frame,
        ...(boundary === 'begin'
          ? [{ at: 10, kind: 'action', verb: 'begin', act: 'start' } as const]
          : [{ at: 9, kind: 'action', verb: 'load', act: 'start' } as const,
            { at: 10, kind: 'pickup' } as const]),
      ];
      const windows = tableWorkloadWindows(events, 20);
      expect(windows).toHaveLength(2);
      expect(windows[0]?.tableForegroundMs).toBe(5);
      expect(windows[1]?.tableForegroundMs).toBe(10);
      expect(windows[1]?.source).toBe(boundary);
    }
  });
});


/**
 * A saved run's public identity is watched before its Chronicle confirms the
 * pickup. The first-session observer must not assign that tentative identity
 * to a different house's signing or invent a title-screen house (#2905).
 */
function observer() {
  let time = 0;
  const log = new ReadingLog(
    () => time,
    { sha: 'test', platform: 'browser' },
    '2026-11-05T00:00:00.000Z',
    { visible: true, focused: true },
  );
  return { log, at(value: number) { time = value; } };
}

describe('first-session entry boundaries across tentative pickups (#2905)', () => {
  it('does not invent a previous house from a title-screen pickup run marker', () => {
    const { log, at } = observer();
    at(100);
    log.note({ kind: 'action', verb: 'resume', act: 'start' });
    at(150);
    // App observes the new identity ahead of the Chronicle's pickup marker.
    log.note({ kind: 'run', campaign: 'long', seed: 91 });
    at(200);
    log.chronicle([]);
    at(250);
    log.end('exported');

    const artifact = log.artifact();
    expect(artifact.events.filter((event) => event.kind === 'run')).toHaveLength(1);
    expect(artifact.events.some((event) => event.kind === 'pickup')).toBe(true);
    expect(artifact.summary.entries).toEqual([]);
    expect(artifact.summary.gaps.some((gap) => gap.to.kind === 'new-run')).toBe(false);
  });

  it('censors the abandoned signing under its original campaign, not the loaded one', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 4 });
    at(50);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(75);
    log.note({ kind: 'action', verb: 'enter', act: 'signing', status: 'returned' });
    at(100);
    log.note({ kind: 'action', verb: 'load', act: 'start' });
    at(125);
    log.note({ kind: 'run', campaign: 'long', seed: 8 });
    at(150);
    log.chronicle([]);
    at(200);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([{
      startedAt: 0, campaign: 'short', foundedAt: 50, enteredAt: 75,
      firstAcceptedCommand: null, wallMs: 150, foregroundMs: 150, censored: true,
    }]);
    // The prior house existed, so a real pickup *does* close its unfinished gap.
    expect(log.artifact().summary.gaps.filter((gap) => gap.to.kind === 'new-run')).toHaveLength(1);
  });

  it('does not rewrite the prior entry when an attempted pickup never confirms', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 12 });
    at(20);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(30);
    log.note({ kind: 'action', verb: 'resume', act: 'start' });
    at(40);
    log.note({ kind: 'run', campaign: 'long', seed: 17 });
    // No successful Chronicle pickup. No old-house completion can be inferred.
    at(70);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([{
      startedAt: 0, campaign: 'short', foundedAt: 20, enteredAt: null,
      firstAcceptedCommand: null, wallMs: 70, foregroundMs: 70, censored: true,
    }]);
    expect(log.artifact().summary.gaps.some((gap) => gap.to.kind === 'new-run')).toBe(false);
  });

  it('restarts identity normally when a new Begin supersedes a pending pickup', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 12 });
    at(20);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(30);
    log.note({ kind: 'action', verb: 'importSave', act: 'start' });
    at(40);
    log.note({ kind: 'run', campaign: 'long', seed: 17 });
    at(50);
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    at(55);
    log.note({ kind: 'run', campaign: 'demo', seed: 99 });
    at(60);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(70);
    log.note({ kind: 'action', verb: 'enter', act: 'signing', status: 'returned' });
    at(90);
    log.note({ kind: 'action', verb: 'match', act: 'answer', status: 'accepted' });
    at(100);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([
      {
        startedAt: 0, campaign: 'short', foundedAt: 20, enteredAt: null,
        firstAcceptedCommand: null, wallMs: 50, foregroundMs: 50, censored: true,
      },
      {
        startedAt: 50, campaign: 'demo', foundedAt: 60, enteredAt: 70,
        firstAcceptedCommand: { at: 90, verb: 'match' },
        wallMs: 40, foregroundMs: 40, censored: false,
      },
    ]);
  });
});
