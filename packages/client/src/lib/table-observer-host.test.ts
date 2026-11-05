import { describe, expect, it } from 'vitest';
import { ReadingLog, recordActions, tableWorkloadWindows } from './reading-log.js';

function log(): ReadingLog {
  return new ReadingLog(
    () => 1_000,
    { sha: 'test-commit', platform: 'test' },
    '2026-11-05T00:00:00.000Z',
    { visible: true, focused: true },
  );
}

describe('fail-open Table research and window-safe outcomes (#1992)', () => {
  it('forwards the exact input and return even when their getters throw', () => {
    const l = log();
    const privateError = new Error('private getter exception');
    const unreadableOrder = Object.defineProperty({ privateName: 'private-order' }, 'kind', {
      get() { throw privateError; },
    });
    const unreadableMuster = Object.defineProperty({ privateName: 'private-muster' }, 'op', {
      get() { throw privateError; },
    });
    const unreadableReturn = Object.defineProperty({}, 'ok', {
      get() { throw privateError; },
    });
    const accepted = { ok: true };
    const seen: unknown[][] = [];
    const bare = {
      order(payload: unknown) {
        expect(this).toBe(bare);
        seen.push(['order', payload]);
        return payload === unreadableOrder ? accepted : unreadableReturn;
      },
      muster(payload: unknown) {
        expect(this).toBe(bare);
        seen.push(['muster', payload]);
        return unreadableReturn;
      },
    } as unknown as Parameters<typeof recordActions>[0];
    const actions = recordActions(bare, l);
    const study = { kind: 'study', person: 'private-student' };

    expect(actions.order(unreadableOrder as unknown as Parameters<typeof actions.order>[0])).toBe(accepted);
    expect(actions.order(study as Parameters<typeof actions.order>[0])).toBe(unreadableReturn);
    expect(actions.muster(unreadableMuster as unknown as Parameters<typeof actions.muster>[0])).toBe(unreadableReturn);
    expect(seen).toEqual([
      ['order', unreadableOrder], ['order', study], ['muster', unreadableMuster],
    ]);
    expect(l.events.filter(e => e.kind === 'action').map(({ at: _at, ...e }) => e)).toEqual([
      { kind: 'action', verb: 'order', act: 'table', category: 'unknown', status: 'attempted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'unknown', status: 'accepted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
      { kind: 'action', verb: 'muster', act: 'muster', category: 'unknown', status: 'attempted' },
    ]);
    expect(l.artifact().summary.tableActions).toEqual({
      orders: [
        { category: 'study', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
        { category: 'unknown', attempts: 1, accepted: 1, refused: 0, threw: 0, returned: 0, unfinished: 0 },
      ],
      muster: [
        { category: 'unknown', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
      ],
      delegation: [],
    });
    const exported = JSON.stringify(l.artifact());
    for (const secret of ['private getter', 'private-order', 'private-student', 'private-muster']) {
      expect(exported).not.toContain(secret);
    }
  });

  it('does not treat an orphan terminal as work accepted by this window', () => {
    const l = log();
    l.note({ kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' });
    l.note({ kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' });
    l.note({ kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'refused' });
    l.note({ kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'threw' });
    expect(l.artifact().summary.tableActions).toEqual({
      orders: [
        { category: 'study', attempts: 1, accepted: 0, refused: 1, threw: 0, returned: 0, unfinished: 0 },
      ],
      muster: [],
      delegation: [],
    });
  });

  it('does not match a previous house result to a new same-category attempt', () => {
    const l = log();
    const earlier = { kind: 'study', person: 'old' };
    const later = { kind: 'study', person: 'new' };
    const unreadableReturn = Object.defineProperty({}, 'ok', {
      get() { throw new Error('unreadable result'); },
    });
    const bare = {
      order(payload: unknown) {
        if (payload === earlier) {
          // Model a host re-entering a successful Begin while the earlier
          // verb has not returned. A new-house attempt in the SAME category
          // must not consume the previous house's eventual accepted result.
          l.note({ kind: 'action', verb: 'begin', act: 'start' });
          expect(actions.order(later as unknown as Parameters<typeof actions.order>[0]))
            .toBe(unreadableReturn);
          return { ok: true };
        }
        return unreadableReturn;
      },
    } as unknown as Parameters<typeof recordActions>[0];
    const actions = recordActions(bare, l);
    expect(actions.order(earlier as unknown as Parameters<typeof actions.order>[0]))
      .toEqual({ ok: true });

    const windows = tableWorkloadWindows(l.events, 1_000);
    expect(windows).toHaveLength(2);
    for (const window of windows) {
      expect(window.actions.orders).toEqual([
        { category: 'study', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
      ]);
    }
    expect(windows[0]!.endedBy).toBe('begin');
    expect(windows[1]!.source).toBe('begin');
  });

  it('censors a cross-house attempt without crediting its late result to the new house', () => {
    const events = [
      { at: 0, kind: 'pane', pane: 'table' },
      { at: 1, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
      { at: 2, kind: 'action', verb: 'begin', act: 'start' },
      { at: 3, kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' },
      { at: 4, kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'attempted' },
      { at: 5, kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'threw' },
    ] as const;
    const windows = tableWorkloadWindows(events, 6);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.endedBy).toBe('begin');
    expect(windows[0]!.actions.orders).toEqual([
      { category: 'study', attempts: 1, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 1 },
    ]);
    expect(windows[1]!.source).toBe('begin');
    expect(windows[1]!.actions.orders).toEqual([]);
    expect(windows[1]!.actions.muster).toEqual([
      { category: 'withdraw', attempts: 1, accepted: 0, refused: 0, threw: 1, returned: 0, unfinished: 0 },
    ]);
    // No mutation or compensating game command is needed for this observer-only correction.
    expect(events).toHaveLength(6);
  });
});

