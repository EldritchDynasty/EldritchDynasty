import { acquireLibraryCopy, attr, beginStudy, completeStudies, degradeLibraryCopy, evalFilter, gainSpellbook, knowsAffinity, loseLibraryCopy, loseSpellbookKnowledge, makeRng, autoCast } from '@ed/core';
import { ALL_AFFINITIES, THRESHOLD_AFFINITIES, EventTemplateS, FilterS, PoolSpecS, asId, runRule } from '@ed/schema';
import type { SlotSpec } from '@ed/schema';
import type { SimCtx } from './world.js';
import { executeOutcomeWitness } from './events/reach.js';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Check, PoolSpec, Person } from '@ed/schema';
import {
  evalCheck, evalDifficulty, fillOrder, place, poolScore, resolveChoiceOutcome, testRng, testWorld,
} from '@ed/core';

const bundle = loadContent();

/**
 * CHECKS (issue #10, phase 3). `CheckS`/`PoolSpecS` were declared, referenced
 * by `Choice.check`, and evaluated nowhere — a choice carrying a check
 * resolved by outcome weight exactly as if it had none. These are direct
 * tests of the evaluator; `age_scoped.yaml`'s `what_came_up_the_river_road`
 * is the first authored choice to actually carry one, and its real-run
 * behaviour (a genuine three-way spread of bands over a sample of runs) was
 * confirmed by hand before this suite was written.
 */

// INVARIANT 6: `acquired` is a write-only layer re-applied on every recompute
// of a cached phenotype (people/factory.ts `phenotypeOf`) — a direct write
// has to invalidate the cache the same way `applyEffect`'s `attribute` case
// does, or a second read in the same year returns the first read's answer.
function setAcquired(p: Person, key: string, value: number): void {
  p.acquired[key] = value;
  if (p.phenotype) p.phenotype.dirty = true;
}
describe('poolScore', () => {
  it('slot: the weighted sum of one cast person\'s attributes', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    setAcquired(p, 'strength', 40);
    setAcquired(p, 'charm', 10);
    const spec: PoolSpec = {
      kind: 'slot', slot: 'X', attrs: [{ attr: 'strength', weight: 2 }, { attr: 'charm', weight: 1 }],
    };
    // strength and charm both start from a genome baseline; only the acquired
    // delta is controlled, so assert the RELATIVE effect of the weights
    // rather than an exact number pinned to genetics.
    const withBoth = poolScore(ctx, spec, { X: p.id });
    setAcquired(p, 'strength', 0);
    setAcquired(p, 'charm', 0);
    const withNeither = poolScore(ctx, spec, { X: p.id });
    expect(withBoth).toBeGreaterThan(withNeither);
  });

  it('slot: an unfilled slot scores zero', () => {
    const ctx = testWorld(bundle);
    const spec: PoolSpec = { kind: 'slot', slot: 'X', attrs: [{ attr: 'strength', weight: 1 }] };
    expect(poolScore(ctx, spec, {})).toBe(0);
  });

  it('party_sum: sums the named slots, skipping any unfilled', () => {
    const ctx = testWorld(bundle);
    const a = place(ctx, { sex: 'male', age: 30 });
    const b = place(ctx, { sex: 'male', age: 30 });
    a.acquired.strength = 20;
    b.acquired.strength = 20;
    const spec: PoolSpec = { kind: 'party_sum', slots: ['A', 'B', 'C'], attr: 'strength' };
    const both = poolScore(ctx, spec, { A: a.id, B: b.id });
    const oneOnly = poolScore(ctx, spec, { A: a.id });
    expect(both).toBeGreaterThan(oneOnly);
  });

  it('family_max: the household\'s single best, not the sum', () => {
    const ctx = testWorld(bundle);
    const a = place(ctx, { sex: 'male', age: 30 });
    const b = place(ctx, { sex: 'male', age: 30 });
    a.acquired.strength = 1000;
    b.acquired.strength = -1000;
    const spec: PoolSpec = { kind: 'family_max', attr: 'strength' };
    const max = poolScore(ctx, spec, {});
    const sumSpec: PoolSpec = { kind: 'family_sum', attr: 'strength' };
    const sum = poolScore(ctx, sumSpec, {});
    expect(max).toBeGreaterThan(sum);
  });

  it('family_any: 1 if anyone clears the bar, 0 if nobody does — the anti-specialisation check', () => {
    const ctx = testWorld(bundle);
    // Bootstrap seeds a founding cast into the household roster this pool
    // scans, so the bar has to be cleared (or not) by the WHOLE roster, not
    // just the one person this test places.
    const roster = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    for (const person of roster) setAcquired(person, 'strength', -1000);
    const p = place(ctx, { sex: 'male', age: 30 });
    setAcquired(p, 'strength', -1000);
    const spec: PoolSpec = { kind: 'family_any', attr: 'strength', atLeast: 30 };
    expect(poolScore(ctx, spec, {})).toBe(0);
    setAcquired(p, 'strength', 1000);
    expect(poolScore(ctx, spec, {})).toBe(1);
  });

  it('record: counts or ratios chronicle entries matching a ChronicleQuery', () => {
    const ctx = testWorld(bundle, 1042, 1042);
    // Bootstrap seeds one founding chronicle entry; clear it so the ratio
    // below is over exactly the three entries this test controls.
    ctx.world.chronicle.length = 0;
    ctx.world.chronicle.push(
      { year: 1040, weight: 'line', text: 'a', named: false, eventId: 'x', record: 'embellish' },
      { year: 1041, weight: 'line', text: 'b', named: false, eventId: 'y', record: 'omit' },
      { year: 1042, weight: 'line', text: 'c', named: false, eventId: 'x', record: 'record' },
    );
    const count = poolScore(ctx, { kind: 'record', against: { eventId: 'x', measure: 'count' } }, {});
    expect(count).toBe(2);
    const ratio = poolScore(ctx, { kind: 'record', against: { record: 'embellish', measure: 'ratio' } }, {});
    expect(ratio).toBeCloseTo(1 / 3);
  });

  it('record: discrepancyState follows the entry\'s linked Discrepancy, not a guess', () => {
    const ctx = testWorld(bundle, 1042, 1042);
    ctx.world.discrepancies.set('lie_a', { severity: 'minor', provableBy: [], state: 'proven' });
    ctx.world.chronicle.push(
      { year: 1042, weight: 'line', text: 'a', named: false, record: 'embellish', discrepancyId: 'lie_a' },
      { year: 1042, weight: 'line', text: 'b', named: false, record: 'embellish', discrepancyId: 'lie_b_never_proven' },
    );
    const proven = poolScore(ctx, { kind: 'record', against: { discrepancyState: 'proven', measure: 'count' } }, {});
    expect(proven).toBe(1);
  });
});

describe('evalDifficulty', () => {
  it('passes a flat number through unchanged', () => {
    const ctx = testWorld(bundle);
    expect(evalDifficulty(ctx, 42)).toBe(42);
  });

  it('adds each active Age\'s own term, respect tier, and centuries elapsed', () => {
    const ctx = testWorld(bundle, 1042, 1242); // two centuries in
    ctx.world.age.active.push({ age: 'the_wars', began: 1240, named: true, paid: { standing: false } });
    ctx.world.respect = 'eminent'; // index 3
    const d = evalDifficulty(ctx, {
      base: 10, perActiveAge: { the_wars: 5 }, perRespectTier: 2, perCentury: 1,
    });
    expect(d).toBe(10 + 5 + 3 * 2 + 2 * 1);
  });
});

describe('evalCheck', () => {
  const flatCheck = (): Check => ({
    id: 'c1',
    pool: { kind: 'family_max', attr: 'strength' },
    difficulty: 20,
    variance: 'none',
    bands: [
      { atLeast: 10, outcome: 'great' },
      { atLeast: -10, outcome: 'ok' },
      { atLeast: -1000, outcome: 'bad' },
    ],
  });

  it('with no variance, the roll is exactly the pool score and the band is deterministic', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.acquired.strength = 1000; // guaranteed to clear the top band
    const result = evalCheck(ctx, flatCheck(), bundle.events[0]!, {}, testRng('x'));
    expect(result.roll).toBe(result.score + result.bonus);
    expect(result.outcomeId).toBe('great');
  });

  it('picks the worst band when nothing clears any threshold', () => {
    const ctx = testWorld(bundle);
    // family_max scans the whole household roster, so the founding cast
    // bootstrap seeds has to be driven down too, not just the placed person.
    const roster = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    for (const person of roster) setAcquired(person, 'strength', -1000);
    const p = place(ctx, { sex: 'male', age: 30 });
    setAcquired(p, 'strength', -1000);
    const result = evalCheck(ctx, flatCheck(), bundle.events[0]!, {}, testRng('x'));
    expect(result.outcomeId).toBe('bad');
  });
});

describe('resolveChoiceOutcome', () => {
  it('falls back to weighted pickOutcome when the choice carries no check', () => {
    const ctx = testWorld(bundle);
    const event = bundle.events.find((e) => e.interaction.kind === 'choice')!;
    if (event.interaction.kind !== 'choice') throw new Error('unreachable');
    const choice = event.interaction.choices[0]!;
    const outcome = resolveChoiceOutcome(ctx, event, choice, {}, testRng('x'));
    expect(choice.outcomes.map((o) => o.id)).toContain(outcome.id);
  });

  it('resolves the real authored check to one of its declared bands', () => {
    const ctx = testWorld(bundle, 1042, 1042);
    const event = bundle.events.find((e) => e.id === 'what_came_up_the_river_road')!;
    if (event.interaction.kind !== 'choice') throw new Error('unreachable');
    const choice = event.interaction.choices.find((c) => c.check)!;
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });

    const outcome = resolveChoiceOutcome(ctx, event, choice, { HEAD: head.id }, testRng('x'));
    expect(['driven_off', 'held', 'broken_through']).toContain(outcome.id);
  });
});

/**
 * SLOT FILL ORDER (`events/slots.ts` → `fillOrder`).
 *
 * A `relation` filter compares its candidate against whoever is already cast
 * in another slot, and passes when that slot is empty. Filling alphabetically
 * therefore made four authored constraints inert — the ones whose author
 * happened not to name the slots in alphabetical order.
 */
describe('fillOrder', () => {
  const slot = (filters: never[] = []) =>
    ({ role: 'family_member', castBy: 'engine', optional: false, filters, bind: 'event' }) as never;

  const rel = (of: string) => ({ relation: 'not', of }) as never;

  it('fills a slot before the one that compares against it', () => {
    // CHALLENGER not HEAD: alphabetically CHALLENGER comes first, and used to.
    const order = fillOrder({ CHALLENGER: slot([rel('HEAD')]), HEAD: slot() }).map(([n]) => n);
    expect(order).toEqual(['HEAD', 'CHALLENGER']);
  });

  it('breaks every tie alphabetically, so resolution stays reproducible', () => {
    const order = fillOrder({ ZED: slot(), ALPHA: slot(), MIDDLE: slot() }).map(([n]) => n);
    expect(order).toEqual(['ALPHA', 'MIDDLE', 'ZED']);
  });

  it('orders a chain of three', () => {
    const order = fillOrder({
      C: slot([rel('B')]),
      B: slot([rel('A')]),
      A: slot(),
    }).map(([n]) => n);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('still returns every slot when the filters form a cycle', () => {
    // No order satisfies it, so one filter is inert — which is what a cycle
    // means, and `slots/references` fails the build on it. What must NOT
    // happen is a slot going missing from the resolution entirely.
    const order = fillOrder({ A: slot([rel('B')]), B: slot([rel('A')]) }).map(([n]) => n);
    expect(order.sort()).toEqual(['A', 'B']);
  });

  it('ignores a filter naming a slot the event does not declare', () => {
    const order = fillOrder({ ONLY: slot([rel('NOT_HERE')]) }).map(([n]) => n);
    expect(order).toEqual(['ONLY']);
  });
});


describe('specialist-slots regressions (#1796)', () => {

  const content = loadContent();
  const slot = (extra: Partial<SlotSpec> = {}): SlotSpec => ({ role: 'family_member', castBy: 'engine', filters: [{ status: ['alive'] }], optional: false, bind: 'event', ...extra });
  const eventWith = (spec: SlotSpec) => EventTemplateS.parse({ id: 'specialist_test', title: 'Specialist', tier: 'family', frequency: 'common', body: 'A test.', purposes: ['test_magic_rule', 'worldbuild_through_action', 'change_relationship'], slots: { WORKER: spec }, interaction: { kind: 'narration', outcomes: [{ id: 'done', text: 'Done.' }] } });
  function set(ctx: SimCtx, p: Person, attribute: string, value: number) {
    p.acquired[attribute] = (p.acquired[attribute] ?? 0) + value - attr(p, attribute, ctx.genetics, ctx.world.year);
    if (p.phenotype) p.phenotype.dirty = true;
  }

  describe('completed affinity knowledge (#1796)', () => {
    it.each(ALL_AFFINITIES)('%s is learned by a man independently of a later missing physical copy', (affinity) => {
      const ctx = testWorld(content);
      const p = place(ctx, { sex: 'male', age: 30, awakened: true });
      const book = content.spellbook(`lesser_workings_of_${affinity}`)!;
      acquireLibraryCopy(ctx, book.id);
      expect(knowsAffinity(ctx, p, affinity)).toBe(false);
      expect(beginStudy(ctx, p, book)).toBe(true);
      expect(knowsAffinity(ctx, p, affinity)).toBe(false);
      ctx.world.year = ctx.world.studies.find((s) => s.person === p.id)!.completes;
      completeStudies(ctx);
      expect(knowsAffinity(ctx, p, affinity)).toBe(true);
      const copy = ctx.world.library.get(book.id)!;
      copy.restoresAt = ctx.world.year + 2;
      degradeLibraryCopy(ctx, book.id);
      expect(knowsAffinity(ctx, p, affinity)).toBe(true);
      loseLibraryCopy(ctx, book.id);
      expect(knowsAffinity(ctx, p, affinity)).toBe(true);
      loseSpellbookKnowledge(ctx, p, book.id);
      expect(knowsAffinity(ctx, p, affinity)).toBe(false);
    });

    it.each(ALL_AFFINITIES)('a woman may practise only Threshold knowledge: %s', (affinity) => {
      const ctx = testWorld(content);
      const p = place(ctx, { sex: 'female', age: 30, awakened: true });
      const allowed = THRESHOLD_AFFINITIES.some((a) => a === affinity);
      expect(gainSpellbook(ctx, p, content.spellbook(`lesser_workings_of_${affinity}`)!)).toBe(allowed);
      expect(evalFilter({ knows: { affinity } }, p, ctx, {})).toBe(allowed);
      // Even a malformed manually supplied knowledge id cannot open Elemental practice.
      p.spellsKnown.push(asId(`lesser_workings_of_${affinity}`));
      expect(knowsAffinity(ctx, p, affinity)).toBe(allowed);
      expect(evalFilter({ all: [{ knows: { affinity } }, { not: { knows: { affinity: 'fluid' } } }] }, p, ctx, {})).toBe(allowed);
    });

    it('counts living spouses and cadets, but not a guardian, dead, departed or foreign reader', () => {
      const ctx = testWorld(content);
      for (const p of ctx.world.people.all()) p.spellsKnown = [];
      const spec = { kind: 'family_knows', affinity: 'life' } as const;
      expect(poolScore(ctx, spec, {})).toBe(0);
      const p = place(ctx, { sex: 'female', age: 30, branch: 'reader_hall' });
      p.membership[0]!.kind = 'married_in';
      p.spellsKnown.push(asId('lesser_workings_of_life'));
      expect(poolScore(ctx, spec, {})).toBe(1);
      expect(poolScore(ctx, { kind: 'family_knows', affinity: 'death' }, {})).toBe(0);
      p.status = 'guardian';
      expect(poolScore(ctx, spec, {})).toBe(0);
      p.status = 'dead';
      expect(poolScore(ctx, spec, {})).toBe(0);
      p.status = 'alive';
      p.membership[0]!.to = ctx.world.year;
      expect(poolScore(ctx, spec, {})).toBe(0);
      const outsider = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
      outsider.spellsKnown.push(asId('lesser_workings_of_life'));
      expect(poolScore(ctx, spec, {})).toBe(0);
      for (const q of ctx.world.people.all()) q.membership = [];
      expect(poolScore(ctx, spec, {})).toBe(0);
    });
  });

  describe('a specialist is one eligible person (#1796)', () => {
    it('ranks after filtering, breaks ties by stable id, and reselects after a death', () => {
      const ctx = testWorld(content);
      const a = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
      const b = place(ctx, { sex: 'male', age: 30, name: 'Gyles' });
      const outsider = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
      for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) set(ctx, p, 'life', -1000);
      for (const p of [a, b, outsider]) {
        p.spellsKnown.push(asId('lesser_workings_of_life'));
        set(ctx, p, 'life', 1000); // clamped identically, so the ids resolve the tie
      }
      const e = eventWith(slot({ select: { bestBy: 'life' }, filters: [{ knows: { affinity: 'life' } }] }));
      const first = [a, b].sort((x, y) => x.id < y.id ? -1 : 1)[0]!;
      const other = first.id === a.id ? b : a;
      expect(resolveSlots(e, ctx, makeRng(1)).fill.WORKER).toBe(first.id);
      expect(resolveSlots(e, ctx, makeRng(999)).fill.WORKER).toBe(first.id);
      // A stronger non-reader is never allowed to replace a qualified reader.
      const unqualified = place(ctx, { sex: 'male', age: 30 });
      set(ctx, unqualified, 'life', 1000);
      first.status = 'dead';
      expect(resolveSlots(e, ctx, makeRng(2)).fill.WORKER).toBe(other.id);
      other.membership[0]!.to = ctx.world.year;
      expect(resolveSlots(e, ctx, makeRng(2)).ok).toBe(false);
    });

    it('preserves the random default and leaves player casting to the player', () => {
      const ctx = testWorld(content);
      const e = eventWith(slot());
      const rng = makeRng(177);
      const expected = makeRng(177).pick(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year))!;
      expect(resolveSlots(e, ctx, rng).fill.WORKER).toBe(expected.id);
      e.slots.WORKER!.castBy = 'player';
      const resolution = resolveSlots(e, ctx, makeRng(177));
      expect(resolution.playerCast).toEqual(['WORKER']);
      expect(resolution.fill.WORKER).toBeUndefined();
      expect(autoCast(e, ctx, {}, resolution.playerCast, makeRng(177)).WORKER).toBe(expected.id);
    });

    it('scores all attributes on the selected person, without borrowing from another relative', () => {
      const ctx = testWorld(content);
      const a = place(ctx, { sex: 'female', age: 30 });
      const b = place(ctx, { sex: 'male', age: 30 });
      a.spellsKnown.push(asId('lesser_workings_of_life'));
      set(ctx, a, 'life', 30);
      const e = eventWith(slot({ filters: [{ knows: { affinity: 'life' } }], select: { bestBy: 'life' } }));
      const fill = resolveSlots(e, ctx, makeRng(8)).fill;
      const spec = { kind: 'slot', slot: 'WORKER', attrs: [{ attr: 'life', weight: .7 }, { attr: 'mind', weight: .3 }] } as const;
      const score = () => poolScore(ctx, { ...spec, attrs: [...spec.attrs] }, fill, e);
      const initial = score();
      set(ctx, b, 'mind', 1000);
      expect(score()).toBe(initial);
      set(ctx, a, 'mind', 1000);
      expect(score()).toBeGreaterThan(initial);
    });
  });

  describe('specialist authoring validation (#1796)', () => {
    it.each([{ castBy: 'player' }, { role: 'head' }, { count: { min: 2, max: 3 } }])('rejects unsupported automatic selection: %j', (extra) => {
      const e = eventWith(slot({ select: { bestBy: 'mind' }, ...extra } as Partial<SlotSpec>));
      const bundle = { ...content.bundle, events: [e] };
      expect(runRule('refs/known', bundle).some((i) => i.message.includes('bestBy requires'))).toBe(true);
    });

    it('rejects an unknown selection attribute and missing affinity definitions, including nested heirloom filters', () => {
      const e = eventWith(slot({ select: { bestBy: 'typo' }, filters: [{ not: { knows: { affinity: 'life' } } }] }));
      e.checks.push({ id: 'knowledge', pool: { kind: 'family_knows', affinity: 'life' }, difficulty: 1, variance: 'none', bands: [{ atLeast: 0, outcome: 'done' }] });
      const heirloom = structuredClone(content.bundle.heirlooms[0]!);
      heirloom.target = [{ any: [{ knows: { affinity: 'life' } }] }];
      const issues = runRule('refs/known', { ...content.bundle, events: [e], heirlooms: [heirloom], attributes: content.bundle.attributes.filter((a) => a.id !== 'life') });
      expect(issues.filter((i) => i.message.includes('unknown affinity')).length).toBe(3);
      expect(issues.some((i) => i.message.includes("unknown attribute 'typo'"))).toBe(true);
      expect(FilterS.safeParse({ knows: { affinity: 'mind' } }).success).toBe(false);
      expect(PoolSpecS.safeParse({ kind: 'family_knows', affinity: 'typo' }).success).toBe(false);
    });
  });
});


describe('family-challenges regressions (#1796)', () => {

  const content = loadContent();
  function set(ctx: SimCtx, p: Person, key: string, value: number) {
    p.acquired[key] = (p.acquired[key] ?? 0) + value - attr(p, key, ctx.genetics, ctx.world.year);
    if (p.phenotype) p.phenotype.dirty = true;
  }
  function fixture() {
    const ctx = testWorld(content);
    for (const p of ctx.world.people.all()) p.spellsKnown = [];
    return ctx;
  }

  describe('ordinary family challenges (#1796)', () => {
    it.each([
      ['the_smoke_above_the_store', 'fluid'], ['the_wind_under_the_slates', 'aero'],
      ['the_fever_and_the_vigil', 'life'], ['the_cawdry_copy', 'light'],
    ])('%s changes a committed outcome only when the matching book was learned', (id, affinity) => {
      const event = content.event(id)!;
      for (const learned of [false, true]) {
        const ctx = fixture();
        const p = place(ctx, { sex: affinity === 'life' || affinity === 'light' ? 'female' : 'male', age: 30, awakened: true, name: 'Amice the Reader' });
        const book = content.spellbook(`lesser_workings_of_${affinity}`)!;
        if (learned) expect(gainSpellbook(ctx, p, book)).toBe(true);
        else ctx.world.library.set(book.id, { id: book.id, condition: 100, acquiredYear: ctx.world.year });
        const before = ctx.world.treasury;
        const result = executeOutcomeWitness(ctx, event, { choiceId: `use_${affinity}`, expectedOutcomeId: learned ? 'held' : 'lost', rng: makeRng(9) });
        expect(result.ok, result.reason).toBe(true);
        expect(ctx.world.treasury - before).toBe(learned ? -10 : -35);
        if (learned) expect(ctx.world.chronicle.some((entry) => entry.eventId === id && entry.text?.includes(p.name))).toBe(true);
      }
    });

    it('a woman completing normal Life study changes the same ordinary scene', () => {
      const ctx = fixture();
      const p = place(ctx, { sex: 'female', age: 30, awakened: true, name: 'Amice' });
      const book = content.spellbook('lesser_workings_of_life')!;
      expect(beginStudy(ctx, p, book)).toBe(true);
      const e = content.event('the_fever_and_the_vigil')!;
      expect(executeOutcomeWitness(ctx, e, { choiceId: 'use_life', expectedOutcomeId: 'lost', rng: makeRng(1) }).ok).toBe(true);
      ctx.world.year = ctx.world.studies.find((study) => study.person === p.id)!.completes;
      completeStudies(ctx);
      const result = executeOutcomeWitness(ctx, e, { choiceId: 'use_life', expectedOutcomeId: 'held', rng: makeRng(2) });
      expect(result.ok, result.reason).toBe(true);
      expect(ctx.world.chronicle.some((entry) => entry.eventId === e.id && entry.text?.includes('Amice'))).toBe(true);
    });

    it('the strongest Darkness reader uses that reader\'s Mind, not the household maximum', () => {
      const event = content.event('the_cawdry_copy')!;
      for (const improve of ['neither', 'other', 'reader'] as const) {
        const ctx = fixture();
        const reader = place(ctx, { sex: 'female', age: 30, awakened: true, name: 'Amice' });
        const other = place(ctx, { sex: 'male', age: 30, name: 'The Scholar' });
        expect(gainSpellbook(ctx, reader, content.spellbook('lesser_workings_of_darkness')!)).toBe(true);
        set(ctx, reader, 'darkness', 20);
        set(ctx, reader, 'mind', improve === 'reader' ? 60 : 20);
        set(ctx, other, 'mind', improve === 'other' ? 100 : 20);
        set(ctx, other, 'darkness', 100); // high affinity alone is not a working
        const fill = resolveSlots(event, ctx, makeRng(3)).fill;
        expect(fill.COVER).toBe(reader.id);
        const check = event.checks.find((c) => c.id === 'practised_working')!;
        expect(poolScore(ctx, check.pool, fill, event)).toBe(improve === 'reader' ? 32 : 20);
        const result = executeOutcomeWitness(ctx, event, { choiceId: 'use_darkness', expectedOutcomeId: improve === 'reader' ? 'held' : 'lost', rng: makeRng(3) });
        expect(result.ok, result.reason).toBe(true);
      }
    });

    it('a nonmagical specialist also uses one person\'s combined attributes', () => {
      const e = content.event('the_smoke_above_the_store')!;
      for (const improve of ['other', 'rescuer'] as const) {
        const ctx = fixture();
        for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) set(ctx, p, 'strength', 0);
        const rescuer = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
        const other = place(ctx, { sex: 'male', age: 30 });
        set(ctx, rescuer, 'strength', 60);
        set(ctx, rescuer, 'agility', improve === 'rescuer' ? 30 : 10);
        set(ctx, other, 'strength', 30);
        set(ctx, other, 'agility', 100);
        expect(resolveSlots(e, ctx, makeRng(4)).fill.EXPERT).toBe(rescuer.id);
        const result = executeOutcomeWitness(ctx, e, { choiceId: 'send_specialist', expectedOutcomeId: improve === 'rescuer' ? 'held' : 'lost', rng: makeRng(4) });
        expect(result.ok, result.reason).toBe(true);
      }
    });

    it('the player sends either relative, and the outcome and injury belong to that participant', () => {
      const event = content.event('the_wick_bridge_load')!;
      for (const strong of [false, true]) {
        const ctx = fixture();
        const weak = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
        const sturdy = place(ctx, { sex: 'male', age: 30, name: 'Gyles' });
        for (const key of ['strength', 'agility']) { set(ctx, weak, key, 20); set(ctx, sturdy, key, 70); }
        const sent = strong ? sturdy : weak;
        const original = sent.acquired.health ?? 0;
        const result = executeOutcomeWitness(ctx, event, { choiceId: strong ? 'lifted' : 'paid', expectedOutcomeId: strong ? 'clear' : 'wet', cast: { SENT: sent.id }, rng: makeRng(5) });
        expect(result.ok, result.reason).toBe(true);
        expect(sent.acquired.health).toBe(original - (strong ? 1 : 3));
        expect(ctx.world.chronicle.some((entry) => entry.eventId === event.id && entry.text?.includes(sent.name))).toBe(true);
        expect((strong ? weak : sturdy).acquired.health ?? 0).toBe(0);
      }
    });

    it('uses every family primitive and each affinity in reachable authored checks or filters', () => {
      const events = content.events.filter((e) => e.tags.includes('family_challenge'));
      expect(events).toHaveLength(5);
      const kinds = new Set(events.flatMap((e) => e.checks.map((c) => c.pool.kind)));
      for (const kind of ['family_sum', 'family_max', 'family_any', 'family_knows']) expect(kinds.has(kind as never)).toBe(true);
      expect(events.some((e) => e.conditions && 'familyAny' in e.conditions)).toBe(true);
      const affinities = new Set(events.flatMap((e) => Object.values(e.slots).flatMap((s) => s.filters.flatMap((f) => 'knows' in f ? [f.knows.affinity] : []))));
      expect(affinities.size).toBe(8);
    });
  });
});
