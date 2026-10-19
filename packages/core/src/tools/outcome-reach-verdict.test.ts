import { describe, expect, it } from 'vitest';
import type { DeclaredOutcome, Reach } from '../events/reach.js';
import {
  judgeZeroReach,
  judgeOutcomeReachZero,
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
  it('judges guarded outcomes from eligible casts rather than every parent firing', () => {
    const key = 'rite|try|woke';
    const outcome: DeclaredOutcome = { label: 'woke', choice: 'rite|try', share: 0.5, guarded: true };
    const observed = reach({}, { 'rite|try': 1000 });
    observed.guarded = { opportunities: new Map([[key, 2]]), expected: new Map([[key, 1]]) };
    expect(judgeOutcomeReachZero(key, outcome, observed, 200).kind).toBe('unproven');
    observed.guarded.opportunities.set(key, 20);
    observed.guarded.expected.set(key, 10);
    expect(judgeOutcomeReachZero(key, outcome, observed, 200).kind).toBe('dead');
  });

  it('distinguishes absent guarded observations from a cast that never qualified', () => {
    const key = 'rite|try|woke';
    const outcome: DeclaredOutcome = { label: 'woke', choice: 'rite|try', share: 0.5, guarded: true };
    const observed = reach({}, { 'rite|try': 50 });
    expect(judgeOutcomeReachZero(key, outcome, observed, 200).why).toMatch(/no pre-effect/);
    observed.guarded = { opportunities: new Map([[key, 0]]), expected: new Map([[key, 0]]) };
    expect(judgeOutcomeReachZero(key, outcome, observed, 200)).toEqual({ kind: 'dead', why: 'no eligible cast in 50 firings of its choice' });
  });

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

  it('distinguishes six available but unselected answers from an unavailable answer', () => {
    const zero = judgeZeroReach(0, 1, 800, { offered: 6, expectedSelections: 3 });
    expect(zero.kind).toBe('unproven');
    expect(zero.why).toContain('offered 6 times');
    expect(zero.why).toContain('~3.0 selections');
    expect(zero.why).toContain('would need ~1334 runs');
    expect(judgeZeroReach(0, 1, 800, { offered: 0, expectedSelections: 0 }).kind).toBe('dead');
  });

  it('keeps the same five-expected proof boundary for an unselected answer', () => {
    expect(judgeZeroReach(0, 0.01, 800, { offered: 10, expectedSelections: 5 }).kind).toBe('dead');
    expect(judgeZeroReach(0, 1, 800, { offered: 9, expectedSelections: 4.5 }).kind).toBe('unproven');
  });

  it('uses actual firings for outcome rarity once the answer has been selected', () => {
    expect(judgeZeroReach(7, 0.2, 250, { offered: 100, expectedSelections: 50 }).kind).toBe('unproven');
  });

  it('uses the same available-choice evidence in the scoped verdict', () => {
    const sampled = Object.assign(reach(), { choiceOffers: {
      counts: new Map([['visitation|lent', 6]]),
      expectedSelections: new Map([['visitation|lent', 3]]),
    } });
    const verdict = scopedOutcomeReachVerdict(
      declared('visitation|lent|said', 'visitation/lent -> said', 'visitation|lent'),
      sampled, new Set(), 800,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.dead).toEqual([]);
    expect(verdict.unproven[0]).toContain('offered 6 times');
  });
});
