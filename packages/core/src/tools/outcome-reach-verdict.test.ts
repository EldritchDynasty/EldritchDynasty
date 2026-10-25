import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, type Person } from '@ed/schema';
import {
  declaredOutcomes, emptyReach, observeCheckedOutcome, observeGuardedOutcome, type DeclaredOutcome, type Reach,
} from '../events/reach.js';
import { bandChances, checkReading } from '../events/checks.js';
import { candidatesFor } from '../events/slots.js';
import { genomeOf, phenotypeOf } from '../people/factory.js';
import { place, testWorld } from '../testing.js';
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
    observed.choiceOffers = {
      counts: new Map([['rite|try', 2000]]),
      expectedSelections: new Map([['rite|try', 1000]]),
    };
    observed.guarded = { opportunities: new Map([[key, 2]]), expected: new Map([[key, 1]]) };
    expect(judgeOutcomeReachZero(key, outcome, observed, 200).kind).toBe('unproven');
    observed.guarded.opportunities.set(key, 20);
    observed.guarded.expected.set(key, 10);
    expect(judgeOutcomeReachZero(key, outcome, observed, 200).kind).toBe('dead');
  });

  it('retains thin offer evidence when a guarded answer has no selections', () => {
    const key = 'rite|try|woke';
    const outcome: DeclaredOutcome = { label: 'woke', choice: 'rite|try', share: 0.5, guarded: true };
    const observed = reach();
    observed.choiceOffers = {
      counts: new Map([['rite|try', 6]]),
      expectedSelections: new Map([['rite|try', 3]]),
    };
    const verdict = scopedOutcomeReachVerdict(new Map([[key, outcome]]), observed, new Set(), 800);
    expect(verdict.ok).toBe(true);
    expect(verdict.dead).toEqual([]);
    expect(verdict.unproven[0]).toContain('offered 6 times');
    expect(verdict.unproven[0]).toContain('expected ~3.0 selections');
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

describe('the denominator a zero is judged on (#1917)', () => {
  const content = indexContent(loadContent());

  it('judges a checked outcome by what the actual casts could roll, not by its weight share', () => {
    const key = 'slates|use_terra|lost';
    const outcome: DeclaredOutcome = { label: 'slates/use_terra -> lost', choice: 'slates|use_terra', share: 0.5, checked: true };
    const observed = reach({}, { 'slates|use_terra': 12 });
    // The weight share alone would claim ~6 of 12 and convict.
    expect(judgeZeroReach(12, 0.5, 800).kind).toBe('dead');
    expect(judgeOutcomeReachZero(key, outcome, observed, 800).why).toMatch(/no pre-effect check observation/);
    observed.checked = { expected: new Map([[key, 0]]) };
    expect(judgeOutcomeReachZero(key, outcome, observed, 800))
      .toEqual({ kind: 'dead', why: 'no actual check reading reached its band in 12 firings' });
    observed.checked.expected.set(key, 1);
    expect(judgeOutcomeReachZero(key, outcome, observed, 800)).toEqual({
      kind: 'unproven', why: 'check readings: only ~1.0 expected of 12 firings; would need ~4000 runs to prove' });
    observed.checked.expected.set(key, 6);
    expect(judgeOutcomeReachZero(key, outcome, observed, 800).kind).toBe('dead');
  });

  it('credits a guarded outcome with its whole pool when the actual pick missed the eligible boy', () => {
    const key = 'fast|keep|woke';
    const outcome: DeclaredOutcome = { label: 'fast/keep -> woke', choice: 'fast|keep', share: 0.52, guarded: true };
    const observed = reach({}, { 'fast|keep': 22 });
    observed.guarded = { opportunities: new Map([[key, 0]]), expected: new Map([[key, 0]]), poolExpected: new Map([[key, 0.52]]) };
    expect(judgeOutcomeReachZero(key, outcome, observed, 800)).toEqual({
      kind: 'unproven', why: 'eligible pools: only ~0.5 expected of 22 firings; would need ~7693 runs to prove' });
    observed.guarded.poolExpected!.set(key, 0);
    expect(judgeOutcomeReachZero(key, outcome, observed, 800))
      .toEqual({ kind: 'dead', why: 'no eligible cast in any pool across 22 firings of its choice' });
    observed.guarded.poolExpected!.set(key, 5);
    expect(judgeOutcomeReachZero(key, outcome, observed, 800).kind).toBe('dead');
  });

  it('declares every outcome under a checked choice as checked, and no other', () => {
    const declaredAll = declaredOutcomes(content);
    expect(declaredAll.get('the_wind_under_the_slates|use_terra|lost')?.checked).toBe(true);
    for (const event of content.events) {
      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) for (const o of choice.outcomes) {
        expect(declaredAll.get(`${event.id}|${choice.id}|${o.id}`)?.checked === true).toBe(choice.check !== undefined);
      }
    }
  });

  it('reads a variance-free check as certain, and a random one as chances that sum to one', () => {
    const ctx = testWorld(content, 19170, 1200);
    const event = content.mustEvent('the_wind_under_the_slates');
    const check = event.checks.find((c) => c.id === 'practised_working')!;
    const reader = place(ctx, { sex: 'female', age: 30, name: 'The Stone Reader' });
    const fill = { STONE: reader.id };
    const reading = checkReading(ctx, check, event, fill);
    const passes = reading.score + reading.bonus >= reading.difficulty;
    expect(bandChances(ctx, check, event, fill)).toEqual(new Map([[passes ? 'held' : 'lost', 1]]));

    const narrow = { ...check, variance: 'narrow' as const };
    const chances = bandChances(ctx, narrow, event, fill);
    expect([...chances.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(chances.get('held')! > 0 && chances.get('lost')! > 0).toBe(true);
    // Centred on the threshold, a symmetric draw splits evenly.
    const centred = { ...narrow, difficulty: reading.score + reading.bonus };
    expect(bandChances(ctx, centred, event, fill).get('held')).toBeCloseTo(0.5, 6);
  });

  it('observes a checked firing under its actual cast and draws nothing', () => {
    const ctx = testWorld(content, 19171, 1200);
    const event = content.mustEvent('the_wind_under_the_slates');
    const reader = place(ctx, { sex: 'female', age: 30, name: 'The Other Stone Reader' });
    const into = emptyReach();
    const seed = ctx.world.seed;
    observeCheckedOutcome(ctx, { event, outcome: event.interaction.kind === 'choice' ? event.interaction.choices[1]!.outcomes[0]! : undefined!,
      selectedOutcome: undefined!, fill: { STONE: reader.id }, choiceId: 'use_terra' }, into);
    const held = into.checked!.expected.get('the_wind_under_the_slates|use_terra|held')!;
    const lost = into.checked!.expected.get('the_wind_under_the_slates|use_terra|lost')!;
    expect(held + lost).toBe(1);
    expect(ctx.world.seed).toBe(seed);
  });

  it('credits the fast\'s expressive branches with the share of its pool that can express', () => {
    const ctx = testWorld(content, 5180, 1200);
    const event = content.mustEvent('the_dark_year_fast');
    for (const person of ctx.world.people.living()) person.born = ctx.world.year - 40;
    const expresses = (p: Person) => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress;
    // `childOfEitherKind`'s way (reach.test.ts): borrow a grown man's blood.
    const donorOf = (kind: boolean) => {
      let donor = ctx.world.people.living().find((p) => p.sex === 'male' && expresses(p) === kind);
      for (let i = 0; !donor && i < 100; i++) {
        const p = place(ctx, { sex: 'male', age: 40, name: `Pool donor ${kind} ${i}` });
        if (expresses(p) === kind) donor = p;
      }
      if (!donor) throw new Error(`no donor with canExpress ${kind}`);
      return donor;
    };
    const [blooded, plain] = [donorOf(true), donorOf(false)];
    for (const p of ctx.world.people.living()) p.born = ctx.world.year - 40;
    // One boy of three carries the blood; the pick below goes to one who does not.
    const boys = ['First Boy', 'Second Boy', 'Third Boy'].map((name, i) => {
      const boy = place(ctx, { sex: 'male', age: 12, name });
      boy.genome = { kind: 'materialized', genome: genomeOf(i === 0 ? blooded : plain, ctx.genetics) };
      boy.phenotype = undefined;
      return boy;
    });
    const pool = candidatesFor(event.slots.CHILD!, ctx, {});
    expect(pool.map((p) => p.id).sort()).toEqual(boys.map((b) => b.id).sort());
    expect(pool.filter(expresses)).toEqual([boys[0]]);
    const cast = boys[1]!;
    const into = emptyReach();
    const keep = event.interaction.kind === 'choice' ? event.interaction.choices.find((c) => c.id === 'keep_the_fast')! : undefined!;
    observeGuardedOutcome(ctx, { event, outcome: keep.outcomes[0]!, selectedOutcome: keep.outcomes[0]!,
      fill: { CHILD: cast.id }, choiceId: 'keep_the_fast' }, into);
    const woke = 'the_dark_year_fast|keep_the_fast|woke';
    expect(into.guarded!.opportunities.get(woke)).toBe(0);
    expect(into.guarded!.poolExpected!.get(woke)).toBeCloseTo((1 / 3) * (52 / 100), 9);
  });
});
