import { describe, expect, it } from 'vitest';
import type { DeclaredOutcome, Reach } from '../events/reach.js';
import {
  judgeZeroReach,
  scopedOutcomeReachVerdict,
} from './outcome-reach-verdict.js';

function declared(
  key: string,
  label: string,
  choice: string,
  share = 1,
): ReadonlyMap<string, DeclaredOutcome> {
  return new Map([[key, { label, choice, share }]]);
}

function reach(
  runs: Record<string, number> = {},
  firings: Record<string, number> = {},
): Reach {
  return {
    runs: new Map(Object.entries(runs)),
    firings: new Map(Object.entries(firings)),
  };
}

describe('scoped blocking outcome reach (#502)', () => {
  it('keeps a witnessed outcome green when the fixture batch never resolves it', () => {
    const key = 'event_seen|take|quiet';
    const verdict = scopedOutcomeReachVerdict(
      declared(key, 'event_seen/take -> quiet', 'event_seen|take'),
      reach(),
      new Set([key]),
      20,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.witnessed).toBe(1);
    expect(verdict.blocking).toBe(0);
    expect(verdict.witnessedMisses).toEqual([
      'event_seen/take -> quiet  — deterministic witness exists; sampled miss is telemetry only',
    ]);
    expect(verdict.dead).toEqual([]);
  });

  it('fails an unwitnessed outcome whose choice never fires and names the authored branch', () => {
    const key = 'event_owed|take|missing';
    const verdict = scopedOutcomeReachVerdict(
      declared(key, 'event_owed/take -> missing', 'event_owed|take'),
      reach(),
      new Set(),
      20,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.witnessed).toBe(0);
    expect(verdict.blocking).toBe(1);
    expect(verdict.lines.join('\n')).toContain(
      'FAIL: 1 unwitnessed outcome(s) never resolve',
    );
    expect(verdict.lines.join('\n')).toContain(
      'event_owed/take -> missing  — its choice never fired in 20 runs',
    );
  });

  it('treats a newly declared outcome as blocking until the manifest proves it', () => {
    const key = 'event_new||first';
    const verdict = scopedOutcomeReachVerdict(
      declared(key, 'event_new -> first', 'event_new|'),
      reach(),
      new Set(['some_old_event||outcome']),
      12,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toBe(1);
  });

  it('reports but does not convict an under-powered unwitnessed zero', () => {
    const key = 'event_rare|try|rare';
    const verdict = scopedOutcomeReachVerdict(
      declared(key, 'event_rare/try -> rare', 'event_rare|try', 0.2),
      reach({}, { 'event_rare|try': 7 }),
      new Set(),
      250,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.dead).toEqual([]);
    expect(verdict.unproven[0]).toContain('would need ~893 runs to prove');
  });

  it('keeps the historical zero-proof boundary exact', () => {
    expect(judgeZeroReach(10, 0.5, 250).kind).toBe('dead');
    expect(judgeZeroReach(10, 0.49, 250).kind).toBe('unproven');
  });
});
