import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyEffect, bootstrap, expectRate, phenotypeOf, place, runYears, testWorld, viewOf,
} from '@ed/core';
import { CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();
// 1042, 909 and 5150 replaced: under the corrected blood-membership count
// (issue #42) each of their own lines breaks in the founding century (1136,
// 1074 and 1109), which a batch this small cannot absorb. 910, 912 and 5151
// are confirmed to survive the full thousand years.
const SEEDS = [910, 77, 912, 5151, 8080, 31];

/**
 * THE EXPRESSION GATE (issue #2, phase 0).
 *
 * `harness.ts` computed `madWomen` and `madIncapable` and printed them with
 * "(both must be 0)" — a claim nobody enforced. Three later phases (checks,
 * careers, the Library) each add a new path by which Madness can move, and
 * this has to be a gate before them or it is documenting a regression rather
 * than preventing one.
 *
 * `canExpress` is computed in exactly one place — `eldritch()` in
 * `genetics/expression.ts` — and is capability, not sex: male AND nonzero
 * X-linked font. There is deliberately no `if (female) madness = 0` clamp
 * anywhere, so this is the only thing that would catch a new Madness source
 * written without the gate.
 */
describe('the expression gate holds over full runs', () => {
  it('no incapable character ever holds Madness or expressed Power', () => {
    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, CAMPAIGN_YEARS);
      const w = ctx.world;

      for (const p of w.people.all()) {
        const ph = phenotypeOf(p, ctx.genetics, w.year);
        if (ph.eldritch.canExpress) continue;

        expect(p.madness, `seed ${seed}, person ${p.id} (${p.sex}, incapable) carries Madness`).toBe(0);
        expect(
          ph.eldritch.expressedPower,
          `seed ${seed}, person ${p.id} (${p.sex}, incapable) has expressed Power`,
        ).toBe(0);
      }
    }
  });

  /**
   * The full-run assertion above holds today because every authored `madness`
   * effect targets a slot already filtered to `canExpress: true` — enforced
   * separately, at content-authoring time, by `madness/gate` in
   * `schema/src/rules.ts`. That means a full random run cannot exercise the
   * RUNTIME half of the gate, in `applyEffect`'s `madness` case, without a
   * second bug in content validation to let it through.
   *
   * This calls `applyEffect` directly, the way a slot-cast event does
   * internally, bypassing content validation entirely — so it is this test,
   * not the one above, that fails if the `canExpress` check named in the
   * issue is removed from `effects.ts`.
   */
  it('applyEffect refuses madness on an incapable target even off authored content', () => {
    const ctx = testWorld(bundle, 1042, 1042);
    const woman = place(ctx, { sex: 'female', age: 30 });
    const mundaneSon = place(ctx, { sex: 'male', age: 20, name: 'MundaneSonTest' });

    applyEffect({ kind: 'madness', target: { slot: 'TARGET' }, delta: 40 }, ctx, { TARGET: woman.id });
    expect(woman.madness).toBe(0);

    if (!phenotypeOf(mundaneSon, ctx.genetics, ctx.world.year).eldritch.canExpress) {
      applyEffect({ kind: 'madness', target: { slot: 'TARGET' }, delta: 40 }, ctx, { TARGET: mundaneSon.id });
      expect(mundaneSon.madness).toBe(0);
    }
  });
});

/**
 * WOMEN AWAKEN, AND THAT IS THE DESIGN (issue #78).
 *
 * `rollAwakening` gates on `carriedFont`, not `canExpress`, so roughly six
 * awakenings in ten in this game happen to women. That ratio was filed as a
 * suspected invariant-4 violation and it is not one: §11 asks for it in as
 * many words — *"In daughters, Awakening is timed by what they carry rather
 * than by what they can use"* — because an early-waking girl is the only
 * unfakeable signal in a marriage market otherwise built on forged papers.
 *
 * The reason this is a test and not a comment is that the ratio LOOKS like the
 * bug every time somebody meets it, and the fix that suggests itself — narrow
 * the gate to `canExpress` — is one word, passes typecheck, passes the whole
 * existing suite, and silently deletes a designed mechanic that nothing else
 * measures. So it fails the build instead.
 *
 * The second half is the containment: the ratio is only safe because an
 * awakened woman gains nothing she can express and nothing she can overflow.
 * The suite above proves that of every incapable person; this proves it of
 * the awakened ones specifically, which is the population the fear is about.
 */
describe('what awakening means, and what it does not', () => {
  it('wakes daughters by what they carry, and gives them nothing to overflow', () => {
    let awakened = 0;
    let women = 0;

    for (const seed of [1042, 909, 8080]) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, 400);
      const w = ctx.world;

      for (const p of w.people.all()) {
        if (!p.awakening.awakened) continue;
        awakened += 1;
        const ph = phenotypeOf(p, ctx.genetics, w.year);
        if (ph.eldritch.canExpress) continue;
        women += 1;

        // §10, on the people the ratio is about: the risk was never hers.
        expect(p.madness, `seed ${seed}: ${p.name} woke and carries Madness`).toBe(0);
        expect(
          ph.eldritch.expressedPower,
          `seed ${seed}: ${p.name} woke and expresses Power`,
        ).toBe(0);
        // She woke because she carries. Anyone waking on nothing would mean
        // the timing had stopped reading the font it is supposed to read.
        expect(
          ph.eldritch.carriedFont,
          `seed ${seed}: ${p.name} woke carrying nothing`,
        ).toBeGreaterThan(0);
      }
    }

    // Narrowing the gate to `canExpress` takes this to exactly zero. The floor
    // is well under the ~57% observed on purpose: the claim is that women wake
    // at all and in numbers, not that the ratio holds to a point.
    expectRate({
      hits: women, n: awakened, floor: 0.3,
      what: 'awakenings that happen to someone who will never express (issue #78)',
    });
  });

  /**
   * And the client can tell them apart, which is the half that was actually
   * broken. `Member.vue` drew one `◈` for both states, so a tree of seventy
   * people marked forty-five women as though the Power had manifested in them
   * — §7 stated backwards, in a game whose whole subject is who expresses.
   *
   * `expresses` is carried on the view rather than derived in the client
   * because `sex === 'male' && awakened` is a second copy of a closed rule
   * that invariant 4 gives exactly one home.
   */
  /**
   * FOUR SEEDS, AND IT USED TO BE ONE.
   *
   * The per-member assertion below is about a GATE and holds in every hall of
   * every run; the two `some` calls are about a STATE, and one seed at one
   * instant either has a woken non-expresser standing in the hall or does not.
   * This broke twice in one week on changes that touched neither expression
   * nor genetics — a content drop and a weight — because adding any template
   * re-rolls which scene wins every draw for four hundred years, and the house
   * that came out the other end had a different nine people in it.
   *
   * CLAUDE.md's rule, which this was the counter-example to: never pin a test
   * to one seed reaching one state. The mechanism is what is being asserted,
   * so the mechanism is asked of a batch and the gate is asked of everybody.
   */
  it('hands the client both facts, so the tree can draw two marks', () => {
    let carried = 0;
    let expressing = 0;
    let checked = 0;

    for (const seed of [1042, 909, 77, 4242]) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, 400);

      const members = viewOf(ctx).halls.flatMap((h) => h.members);
      for (const m of members) {
        const p = ctx.world.people.get(m.id)!;
        checked += 1;
        // #1820: the house learns whether the Power comes through somebody
        // when they wake, and not before — so the field is absent until then,
        // and the true gate after.
        expect(m.expresses, `seed ${seed}: ${m.name} is drawn against the wrong gate`)
          .toBe(p.awakening.awakened ? phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress : undefined);
      }

      // Nobody female is ever drawn as expressing. Invariant 4, asked through
      // the client's own surface rather than through the genetics — and it is
      // asked of every seed, because it is a rule and not a state.
      expect(members.filter((m) => m.sex === 'female' && m.expresses), `seed ${seed}`).toEqual([]);

      carried += members.filter((m) => m.awakened && !m.expresses).length;
      expressing += members.filter((m) => m.expresses).length;
    }

    // Not a vacuum: four houses at year 1442 have people in them.
    expect(checked).toBeGreaterThan(20);
    // Both states reach the tree — the thing a single mark hid.
    expect(carried, 'nobody woke without it coming through, in four runs').toBeGreaterThan(0);
    expect(expressing, 'nobody expressed, in four runs').toBeGreaterThan(0);
  });
});
