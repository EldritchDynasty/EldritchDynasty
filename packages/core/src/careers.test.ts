import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { isLadderRole, validateBundle, type Filter } from '@ed/schema';
import {
  applyEffect, bootstrap, canTakePost, careerMortality, effectiveStudyYears, evalFilter,
  inBreedingPool, madnessCoverOf, order, phase, place, runStandingOrders, tableView, testRng,
  tickCareers,
} from '@ed/core';

const bundle = loadContent();

/**
 * THE DOOR THAT WAS NEVER CUT.
 *
 * Everything above the last four suites in this file passed on the day issue
 * #16 was closed, and every one of them was testing a mechanism that worked.
 * The mechanism was never the bug. Nothing anywhere in the authored content
 * used the `career` effect, so `Person.career` was written by nothing: six
 * thousand-year runs, six and a half thousand people, not one post ever held.
 * A suite that reaches for `applyEffect` directly cannot see that, because it
 * is the caller the game did not have.
 *
 * `a run can reach every career` is the one that would have said so, and it
 * says it the cheap way — by reading the content rather than simulating a
 * millennium.
 */

describe('the careers content', () => {
  it('validates', () => {
    expect(validateBundle(bundle).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('authors the five rows the brief names', () => {
    const ids = bundle.careers.map((c) => c.id);
    for (const id of ['military', 'clergy', 'court', 'merchant', 'scholar']) {
      expect(ids).toContain(id);
    }
  });

  it('the careers that pay Respect cost either the body or the bloodline', () => {
    const military = bundle.careers.find((c) => c.id === 'military')!;
    const clergy = bundle.careers.find((c) => c.id === 'clergy')!;
    expect(military.extraMortality).toBeGreaterThan(0);
    expect(clergy.removesFromBreedingPool).toBe(true);
  });
});

describe('the career effect writes Person.career', () => {
  it('assign sets it, leave clears it', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'merchant' }, ctx, { X: p.id });
    expect(String(p.career?.career)).toBe('merchant');
    expect(p.career?.from).toBe(ctx.world.year);

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'leave' }, ctx, { X: p.id });
    expect(p.career).toBeUndefined();
  });
});

describe('tickCareers', () => {
  it('pays income into the treasury', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.career = { career: 'merchant' as never, from: ctx.world.year };
    const before = ctx.world.treasury;

    tickCareers(ctx, testRng('careers'));
    expect(ctx.world.treasury).toBeGreaterThan(before);
  });

  it('grows Charm for a courtier over the years', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.career = { career: 'court' as never, from: ctx.world.year };

    for (let i = 0; i < 10; i++) { tickCareers(ctx, testRng('careers', i)); ctx.world.year += 1; }
    expect(p.acquired.charm ?? 0).toBeGreaterThan(0);
  });

  it('lights up the career TraitAcquisition kind: a long-served soldier is hardened by the line', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.career = { career: 'military' as never, from: ctx.world.year - 10 };

    tickCareers(ctx, testRng('careers'));
    expect([...p.traits].map(String)).toContain('hardened_by_the_line');
  });

  it('does not grant the career trait early', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.career = { career: 'military' as never, from: ctx.world.year - 2 };

    tickCareers(ctx, testRng('careers'));
    expect([...p.traits].map(String)).not.toContain('hardened_by_the_line');
  });
});

describe('the costs that make the rule true (issue #16)', () => {
  it('clergy are excluded from the breeding pool', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 25 });
    expect(inBreedingPool(ctx, p)).toBe(true);
    p.career = { career: 'clergy' as never, from: ctx.world.year };
    expect(inBreedingPool(ctx, p)).toBe(false);
  });

  it('clergy do not marry through autoMarry', () => {
    const ctx = bootstrap(bundle, 3, 1044);
    const p = place(ctx, { sex: 'female', age: 22, name: 'Ordained' });
    p.career = { career: 'clergy' as never, from: ctx.world.year };
    place(ctx, { sex: 'male', age: 24, name: 'Suitor' });

    for (let i = 0; i < 6; i++) phase('marriage', ctx);
    expect(p.marriages.length).toBe(0);
  });

  it('military service adds its own extra annual death hazard, read by rollDeath', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const soldier = place(ctx, { sex: 'male', age: 30 });
    expect(careerMortality(ctx, soldier)).toBe(0);

    soldier.career = { career: 'military' as never, from: ctx.world.year };
    expect(careerMortality(ctx, soldier)).toBeGreaterThan(0);
    expect(careerMortality(ctx, soldier)).toBe(ctx.content.mustCareer('military').extraMortality);
  });

  it('a soldier with the same body dies more often than his unplaced twin, holding the RNG draw fixed', () => {
    // Same name and age on both sides — an identical lazy genome and an
    // identical rng stream position — so the only thing that can move the
    // outcome is `extraMortality` itself.
    let soldierDeaths = 0;
    let civilianDeaths = 0;

    for (let seed = 1; seed <= 40; seed++) {
      const a = bootstrap(bundle, seed, 1042);
      const soldier = place(a, { sex: 'male', age: 90, name: 'Twin' });
      soldier.career = { career: 'military' as never, from: a.world.year };
      phase('lifecycle', a);
      if (soldier.status === 'dead') soldierDeaths += 1;

      const b = bootstrap(bundle, seed, 1042);
      const civilian = place(b, { sex: 'male', age: 90, name: 'Twin' });
      phase('lifecycle', b);
      if (civilian.status === 'dead') civilianDeaths += 1;
    }

    expect(soldierDeaths).toBeGreaterThanOrEqual(civilianDeaths);
    expect(soldierDeaths).toBeGreaterThan(0);
  });
});

describe('a placement is refused when it should be', () => {
  /**
   * `minAge` was declared with a default of 16 and referenced by nothing in
   * `core` or the editor. It is the only reason a commission cannot be bought
   * for a five-year-old, and it was not a reason, because nothing asked.
   */
  it('will not place a child under the career minAge', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = place(ctx, { sex: 'male', age: 5, name: 'Too Young' });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'military' }, ctx, { X: child.id });

    expect(ctx.content.mustCareer('military').minAge).toBe(16);
    expect(child.career).toBeUndefined();
  });

  it('places the same person the year they reach it', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const minAge = ctx.content.mustCareer('military').minAge;
    const grown = place(ctx, { sex: 'male', age: minAge, name: 'Old Enough' });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'military' }, ctx, { X: grown.id });

    expect(String(grown.career?.career)).toBe('military');
  });

  /**
   * A typo used to write a `Person.career` that every reader resolved to
   * `undefined` — a post held for fifty years that paid no income, no Respect
   * and no cost. `refs/known` now refuses the content; this is the runtime half.
   */
  it('will not write a career nothing can look up', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 24, name: 'No Such Post' });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'militarry' }, ctx, { X: p.id });

    expect(p.career).toBeUndefined();
  });
});

/**
 * The `career` filter exists because `op: leave` could not be aimed. Content
 * could ask whether a person held a TRAIT, so the only way to find a man in a
 * post was the one a soldier earns after ten years of surviving a 3% annual
 * hazard — which made leaving a post reachable in 3% of runs.
 */
describe('content can ask who holds a post', () => {
  it('matches the named career and nothing else', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const soldier = place(ctx, { sex: 'male', age: 30, name: 'In Post', career: { career: 'military' } });
    const priest = place(ctx, { sex: 'male', age: 30, name: 'In Orders', career: { career: 'clergy' } });
    const idle = place(ctx, { sex: 'male', age: 30, name: 'In Nothing' });

    const holdsMilitary: Filter = { career: ['military'] };
    expect(evalFilter(holdsMilitary, soldier, ctx, {})).toBe(true);
    expect(evalFilter(holdsMilitary, priest, ctx, {})).toBe(false);
    expect(evalFilter(holdsMilitary, idle, ctx, {})).toBe(false);
  });

  it('takes a list, and negates through not', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const priest = place(ctx, { sex: 'male', age: 30, name: 'Listed', career: { career: 'clergy' } });

    expect(evalFilter({ career: ['military', 'clergy'] }, priest, ctx, {})).toBe(true);
    expect(evalFilter({ not: { career: ['military'] } }, priest, ctx, {})).toBe(true);
  });
});

describe('the two costs nothing had ever measured', () => {
  it('hides Madness behind a cassock, and only behind a cassock', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const priest = place(ctx, { sex: 'male', age: 30, name: 'In Orders' });
    const layman = place(ctx, { sex: 'male', age: 30, name: 'Not In Orders' });
    expect(madnessCoverOf(ctx, [priest, layman])).toBe(0);

    priest.career = { career: 'clergy' as never, from: ctx.world.year };

    expect(madnessCoverOf(ctx, [priest, layman])).toBe(ctx.content.mustCareer('clergy').madnessCover);
    expect(madnessCoverOf(ctx, [layman])).toBe(0);
  });

  it('buys years off a book for a Scholar and leaves the book alone for everyone else', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const book = ctx.content.spellbooks[0]!;
    const reader = place(ctx, { sex: 'male', age: 30, name: 'Cold Room' });
    const plain = place(ctx, { sex: 'male', age: 30, name: 'Kitchen Table' });
    reader.career = { career: 'scholar' as never, from: ctx.world.year };

    expect(ctx.content.mustCareer('scholar').studySpeed).toBeLessThan(1);
    expect(effectiveStudyYears(ctx, reader, book))
      .toBeLessThan(effectiveStudyYears(ctx, plain, book));
  });
});

/**
 * THE ONE THAT WOULD HAVE CAUGHT IT.
 *
 * Not a simulation — a read of the authored content, which is where the
 * absence actually lived. Before `events/careers.yaml` this assertion reported
 * `expected [] to deeply equal ['clergy', 'court', 'merchant', ...]`, and the
 * empty set is the whole bug report.
 */
describe('a run can reach every career', () => {
  it('the content assigns all five, and gives at least one of them back', () => {
    const assigned = new Set<string>();
    let leaves = 0;

    for (const e of bundle.events) {
      // `narration` carries no choices; `choice` and `dispatch` both spell them
      // the same way. Reading only one kind would let a career effect move into
      // the other and take this assertion quietly with it.
      const choices = e.interaction.kind === 'narration' ? [] : e.interaction.choices;
      for (const o of choices.flatMap((c) => c.outcomes)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'career') continue;
          if (eff.op === 'leave') leaves += 1;
          else if (eff.career) assigned.add(eff.career);
        }
      }
    }

    expect([...assigned].sort()).toEqual(bundle.careers.map((c) => String(c.id)).sort());
    expect(leaves, 'op: leave is authored by nothing, so a post can never be given up').toBeGreaterThan(0);
  });
});

/**
 * EVERY POST IS A MAN'S (§18).
 *
 * Three doors write `Person.career` — the player's order, the steward, and the
 * authored effect — and all three asked only for an age. The steward bought
 * commissions for daughters out of a treasury that has six of them to spend,
 * the table offered them, and the clergy's Madness cover and breeding-pool
 * exclusion both landed on women. The gate is `canHoldPost` in the schema,
 * and this suite is one test per door, because a gate nobody has watched
 * refuse is indistinguishable from no gate.
 */
describe('a post is a man\'s, at all three doors', () => {
  it('the predicate answers for the sex and nothing else', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    expect(canTakePost(ctx, place(ctx, { sex: 'male', age: 30 })).ok).toBe(true);
    const her = canTakePost(ctx, place(ctx, { sex: 'female', age: 30 }));
    expect(her.ok).toBe(false);
    expect(her.ok === false && her.reason).toMatch(/woman/);
  });

  it('the table refuses the order, with the reason, and takes no money', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const daughter = place(ctx, { sex: 'female', age: 26, name: 'Refused' });
    const before = ctx.world.treasury;

    const result = order(ctx, { kind: 'career', person: daughter.id, career: 'clergy' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/woman/);
    expect(daughter.career).toBeUndefined();
    // A refusal that has already spent the commission is the worse bug.
    expect(ctx.world.treasury).toBe(before);
  });

  it('the table does not list her as eligible for any post', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const daughter = place(ctx, { sex: 'female', age: 26, name: 'Not Offered' });
    const son = place(ctx, { sex: 'male', age: 26, name: 'Offered' });

    const posts = tableView(ctx).posts;
    const named = (id: string) => posts.some((post) => post.eligible.some((e) => e.person === id));

    expect(named(son.id), 'no post offered a grown son, so this proved nothing').toBe(true);
    expect(named(daughter.id)).toBe(false);
  });

  it('the steward places men and only men, over a century with a full purse', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    // A household with far more grown daughters than the six seats can hold,
    // so a steward who did not ask would fill it with them.
    for (let i = 0; i < 8; i += 1) place(ctx, { sex: 'female', age: 20 + i, name: `Daughter ${i}` });
    for (let i = 0; i < 2; i += 1) place(ctx, { sex: 'male', age: 20 + i, name: `Son ${i}` });
    ctx.world.treasury = 5000;

    const placed: string[] = [];
    for (let y = 0; y < 100; y += 1) {
      ctx.world.year += 1;
      placed.push(...runStandingOrders(ctx, testRng('steward', y)).placed);
    }

    expect(placed.length, 'the steward placed nobody at all, so this proved nothing').toBeGreaterThan(0);
    for (const id of placed) expect(ctx.world.people.get(id)!.sex, ctx.world.people.get(id)!.name).toBe('male');
    expect(ctx.world.people.all().filter((p) => p.sex === 'female' && p.career)).toHaveLength(0);
  });

  it('the authored effect declines her, and the same effect places her brother', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const her = place(ctx, { sex: 'female', age: 26, name: 'Her' });
    const him = place(ctx, { sex: 'male', age: 26, name: 'Him' });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'clergy' }, ctx, { X: her.id });
    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'clergy' }, ctx, { X: him.id });

    expect(her.career).toBeUndefined();
    expect(String(him.career?.career)).toBe('clergy');
  });

  /**
   * The costs are read off `Person.career` by three other modules. A woman who
   * cannot be placed cannot be reached by any of them — which is the point:
   * the clergy's cover and its breeding-pool exclusion are a son spent.
   */
  it('so no woman is ever out of the breeding pool for a post she cannot hold', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const her = place(ctx, { sex: 'female', age: 26, name: 'Still Marriageable' });

    applyEffect({ kind: 'career', target: { slot: 'X' }, op: 'assign', career: 'clergy' }, ctx, { X: her.id });

    expect(inBreedingPool(ctx, her)).toBe(true);
    expect(madnessCoverOf(ctx, [her])).toBe(0);
    expect(careerMortality(ctx, her)).toBe(0);
  });

  /**
   * The engine gate makes a mis-cast placement do NOTHING, which is this
   * codebase's signature failure — the outcome text still says "He is very
   * good at it". `careers/gate` is the half that refuses the bundle; this
   * asserts the shipped content actually carries the filters, so the rule is
   * not passing on an empty set.
   */
  it('and every authored placement casts from a slot filtered to men', () => {
    let checked = 0;
    for (const e of bundle.events) {
      const choices = e.interaction.kind === 'narration' ? [] : e.interaction.choices;
      for (const o of choices.flatMap((c) => c.outcomes)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'career' || eff.op !== 'assign') continue;
          const named = typeof eff.target === 'object' && 'slot' in eff.target ? eff.target.slot : undefined;
          expect(named, `${e.id}/${o.id} assigns a career to something that is not a slot`).toBeDefined();
          const slot = e.slots[named!]!;
          expect(
            slot.filters.some((f) => 'sex' in f && f.sex === 'male') || isLadderRole(slot.role),
            `${e.id}/${o.id}: slot ${named} can cast a woman`,
          ).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked, 'no authored placement was examined, so this proved nothing').toBeGreaterThan(4);
  });
});
