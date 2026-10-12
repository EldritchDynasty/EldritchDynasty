import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, indexContent, type ActiveAge, type HouseId } from '@ed/schema';
import { place, testWorld } from './testing.js';
import { ageMortality, thinBloodFertility, thinBloodMortality, wed } from './people/demography.js';
import { conceiveChild } from './people/factory.js';
import type { SimCtx } from './world.js';

const content = indexContent(loadContent());

/**
 * A SMALL LINE HAS NO BUFFER (issue #42).
 *
 * `broken_line` is one of §23's five endings and fired in 0 of 60 runs. The
 * reason was not that the game is kind: it is that it had no tail. The blood's
 * low-water mark is 3 at the worst and 4 at the median, both at the FOUNDING,
 * and from there it climbs to about 46 — one window in a thousand years, and
 * nothing sharpened it.
 *
 * A large family absorbs a bad year. A family of four has nobody else. These
 * assert the mechanism rather than a rate, because the rate is a batch
 * statistic and lives in `gate:endings`.
 */
describe('a line with nobody left to lose', () => {
  /**
   * A house that HAS n of its blood alive, and once had `was`.
   *
   * The two are different questions and the whole point of the mechanism: a
   * founding house of three is not in trouble, and a house of three that used
   * to be thirty is the thing §23's `broken_line` is about. `bloodHighWater`
   * is what tells them apart, so a fixture that did not set it measured a
   * brand-new house every time.
   */
  function lineOf(n: number, was = 20): SimCtx {
    const ctx = testWorld(content);
    // Clear the founding blood, then build the line the test means.
    for (const p of [...ctx.world.people.living()]) {
      if (p.membership.some((m) => m.kind === 'blood')) {
        ctx.world.people.kill(p.id, ctx.world.year, 'making room for the fixture');
      }
    }
    for (let i = 0; i < n; i++) {
      place(ctx, { sex: i % 2 ? 'male' : 'female', age: 30, name: `Line ${i}` });
    }
    ctx.world.bloodHighWater = Math.max(n, was);
    return ctx;
  }

  it('leaves a house with a buffer completely alone', () => {
    const ctx = lineOf(20);
    const p = ctx.world.people.living().find((q) => q.name === 'Line 1')!;
    expect(thinBloodMortality(ctx, p)).toBe(1);
    expect(thinBloodFertility(ctx)).toBe(1);
  });

  /**
   * A YOUNG LINE IS NOT A DYING ONE. Against a flat threshold this was the
   * founding century of every run in the game, and the measured cost was the
   * middle of the distribution rather than the tail — the batch lost a fifth
   * of its grudges and an already-marginal outcome stopped firing at all.
   */
  it('does not press a house that is small because it is new', () => {
    const young = lineOf(3, 3);
    const p = young.world.people.living().find((q) => q.name === 'Line 1')!;
    expect(thinBloodMortality(young, p)).toBe(1);
    expect(thinBloodFertility(young)).toBe(1);

    // The same three people, in a house that used to be thirty.
    const fallen = lineOf(3, 30);
    const q = fallen.world.people.living().find((r) => r.name === 'Line 1')!;
    expect(thinBloodMortality(fallen, q)).toBeGreaterThan(1);
    expect(thinBloodFertility(fallen)).toBeLessThan(1);
  });

  it('presses harder the fewer of the blood are left', () => {
    const wide = lineOf(9);
    const narrow = lineOf(2);
    const pw = wide.world.people.living().find((q) => q.name === 'Line 1')!;
    const pn = narrow.world.people.living().find((q) => q.name === 'Line 1')!;
    expect(thinBloodMortality(narrow, pn)).toBeGreaterThan(thinBloodMortality(wide, pw));
    expect(thinBloodMortality(wide, pw)).toBeGreaterThan(1);
  });

  /**
   * THE REGIME THE ORIGINAL SUITE NEVER TESTED (issue #132). Every fixture
   * above sets `was` to 20 or 30, which pins `threshold` at
   * `MORTALITY_BUFFER_LINE`'s cap of ten regardless of the house's real
   * size — the mature-house crash `MORTALITY_NO_BUFFER` was swept against.
   * A FOUNDING house never reaches that cap: its high-water mark is 3-9 for
   * decades, and a graduated reading of "the house's own high-water" against
   * that small a number turned its first ordinary death into real hazard —
   * measured, 33-39% of runs broke their line, the median one 76 years after
   * founding, and 0 of 37 surviving runs ever passed through 1 or 2 living
   * blood. A house that has never held more than its founding few has
   * nothing established to have declined FROM, so the mechanism is a no-op
   * until a house has actually proven it can hold the full ten.
   */
  it('does not press a house that has never reached the buffer scale, however thin its own peak', () => {
    // A founding house of four that has lost one — the exact shape of a
    // founding household's first ordinary death, `was` well under the cap.
    const four = lineOf(3, 4);
    const p4 = four.world.people.living().find((q) => q.name === 'Line 1')!;
    expect(thinBloodMortality(four, p4)).toBe(1);

    // Down to its very last, still never having reached the cap.
    const one = lineOf(1, 9);
    const p1 = one.world.people.living().find((q) => q.name === 'Line 0')!;
    expect(thinBloodMortality(one, p1)).toBe(1);

    // The instant a house HAS reached the cap, the same shortfall presses —
    // this is the line the mechanism now draws.
    const proven = lineOf(1, 10);
    const pp = proven.world.people.living().find((q) => q.name === 'Line 0')!;
    expect(thinBloodMortality(proven, pp)).toBeGreaterThan(1);
  });

  /**
   * A retainer dying is a sad thing that happens to a household, not a thing
   * that can end a family — and the household is floored near ten forever by
   * a recurring cast that is re-minted, so reading it would make this inert.
   */
  it('is a fact about the blood, not about the household', () => {
    const ctx = lineOf(2);
    const hired = place(ctx, { sex: 'male', age: 30, name: 'The Cook' });
    hired.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'retainer', from: ctx.world.year }];
    expect(thinBloodMortality(ctx, hired)).toBe(1);
  });

  // Killing the last of a line does nothing if the last of a line breeds back
  // at full rate: measured, low-water reached 1 in 40 runs and none ended.
  it('also makes a dying house a poor match, which is the half that closes it', () => {
    expect(thinBloodFertility(lineOf(2))).toBeLessThan(1);
    expect(thinBloodFertility(lineOf(2))).toBeLessThan(thinBloodFertility(lineOf(3)));
  });
});

/**
 * A NEWBORN'S BLOOD IS DERIVED, NOT DEFAULTED (issue #42).
 *
 * `makePerson` defaults a fresh membership to `kind: 'blood'` when nothing
 * else is passed, which is right for a founder and wrong for a newborn.
 * Every birth used to inherit that default unless BOTH parents held a
 * contract, so a retainer mother and a father who married into the house
 * from elsewhere — himself not of THIS house's blood — produced an heir to a
 * line neither of them belonged to. Measured over 24 played runs: 4 houses
 * whose line had gone fully extinct kept having children anyway, two of them
 * for centuries, and `broken_line` never once fired for it.
 */
describe('a newborn is of the blood only through a parent who is', () => {
  function bear(ctx: SimCtx, mother: ReturnType<typeof place>, father: ReturnType<typeof place>) {
    const born = conceiveChild(
      mother, father, 1, ctx.world.year, ctx.genetics, ctx.takenNames, undefined, ctx.world.playerHouse, ctx.world,
    );
    if (!born.child) throw new Error('the fixture needs a live birth');
    return born.child;
  }

  it('is not of the blood when neither parent is', () => {
    const ctx = testWorld(content);
    const mother = place(ctx, { sex: 'female', age: 24, name: 'The Retainer' });
    mother.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'retainer', from: ctx.world.year }];
    const father = place(ctx, { sex: 'male', age: 26, name: 'The Widower' });
    father.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'married_in', from: ctx.world.year }];

    const child = bear(ctx, mother, father);
    expect(child.membership[0]?.kind).toBe('retainer');
  });

  it('is of the blood through the mother alone', () => {
    const ctx = testWorld(content);
    const mother = place(ctx, { sex: 'female', age: 24, name: 'The Heiress' });
    // `place` defaults to blood; asserted rather than assumed.
    expect(mother.membership[0]?.kind).toBe('blood');
    const father = place(ctx, { sex: 'male', age: 26, name: 'The Groom' });
    father.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'married_in', from: ctx.world.year }];

    const child = bear(ctx, mother, father);
    expect(child.membership[0]?.kind).toBe('blood');
  });

  it('is of the blood through the father alone', () => {
    const ctx = testWorld(content);
    const mother = place(ctx, { sex: 'female', age: 24, name: 'The Bride' });
    mother.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'married_in', from: ctx.world.year }];
    const father = place(ctx, { sex: 'male', age: 26, name: 'The Heir' });
    expect(father.membership[0]?.kind).toBe('blood');

    const child = bear(ctx, mother, father);
    expect(child.membership[0]?.kind).toBe('blood');
  });

  it('is not of the blood when a servant family has two contracted parents', () => {
    // The narrower case `phases.ts` used to check by hand for `servants`,
    // still exercised so nothing regresses when it stopped being special.
    const ctx = testWorld(content);
    const mother = place(ctx, { sex: 'female', age: 24, name: 'The Cook' });
    mother.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'retainer', from: ctx.world.year }];
    const father = place(ctx, { sex: 'male', age: 26, name: 'The Steward' });
    father.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'retainer', from: ctx.world.year }];

    const child = bear(ctx, mother, father);
    expect(child.membership[0]?.kind).toBe('retainer');
  });
});

/**
 * WHAT AN AGE DOES TO PEOPLE DYING (issue #42).
 *
 * The Plague's blurb has read *"Mortality catastrophic, weighted against low
 * Strength. Life affinity becomes the most valuable thing in the world. Small
 * families die out"* since the Ages were authored, and none of it was
 * implemented: an Age was a condition content could gate on and nothing else.
 * `AgeDef.modifiers` is declared, authored by no Age in the content directory,
 * and read by nothing in `core` — every reader of that field belongs to
 * traits. Invariant 11, three times over.
 */
describe('the Age the house is living through', () => {
  const running = (age: string, began: number): ActiveAge => (
    { age, began, named: true, paid: { standing: false } }
  );

  it('is 1 in a quiet century, so most Ages cost nothing', () => {
    const ctx = testWorld(content);
    ctx.world.age.active = [];
    expect(ageMortality(ctx)).toBe(1);
  });

  it('reads the number off the Age, rather than knowing a plague by name', () => {
    const ctx = testWorld(content);
    const plague = content.ages.find((a) => a.id === 'the_plague')!;
    expect(plague.mortalityMultiplier, 'the Age that says it kills people must say how much')
      .toBeGreaterThan(1);

    ctx.world.age.active = [running(plague.id, ctx.world.year)];
    expect(ageMortality(ctx)).toBeCloseTo(plague.mortalityMultiplier);
  });

  // Two catastrophes at once are worse than either, which is why
  // `world.age.active` is a list and this is a product.
  it('stacks, because Ages do', () => {
    const ctx = testWorld(content);
    const plague = content.ages.find((a) => a.id === 'the_plague')!;
    const wars = content.ages.find((a) => a.id === 'the_wars')!;
    ctx.world.age.active = [running(plague.id, ctx.world.year), running(wars.id, ctx.world.year)];
    expect(ageMortality(ctx)).toBeCloseTo(plague.mortalityMultiplier * wars.mortalityMultiplier);
    expect(ageMortality(ctx)).toBeGreaterThan(plague.mortalityMultiplier);
  });
});

/**
 * One wedding gate must commit the marriage and the household move together.
 * A person without a current household must never become a recorded spouse
 * while the other person is left in the old hall (#1523).
 */
describe('wedding records and residence agree', () => {
  it('does not record a marriage when the intended stayer has no destination', () => {
    const ctx = testWorld(content);
    const groom = place(ctx, { sex: 'male', age: 25, name: 'Homeless Groom' });
    const bride = place(ctx, { sex: 'female', age: 23, name: 'Foreign Bride', house: 'foreign_wed_test' });
    groom.membership = [];
    const before = bride.membership.map((m) => ({ ...m }));

    wed(ctx, groom, bride);

    expect(groom.marriages).toEqual([]);
    expect(bride.marriages).toEqual([]);
    expect(groom.membership).toEqual([]);
    expect(bride.membership).toEqual(before);
    expect(ctx.world.people.householdOf(bride.id, ctx.world.year)).toBe(asId<HouseId>('foreign_wed_test'));
  });

  it('records both spouses and moves an ordinary bride into the groom\'s house', () => {
    const ctx = testWorld(content);
    const groom = place(ctx, { sex: 'male', age: 26, name: 'House Groom' });
    const bride = place(ctx, { sex: 'female', age: 22, name: 'Joining Bride', house: 'foreign_wed_test' });

    wed(ctx, groom, bride);

    expect(groom.marriages).toEqual([{ spouse: bride.id, from: ctx.world.year }]);
    expect(bride.marriages).toEqual([{ spouse: groom.id, from: ctx.world.year }]);
    expect(groom.membership).toHaveLength(1);
    expect(bride.membership).toHaveLength(2);
    expect(bride.membership[0]?.to).toBe(ctx.world.year);
    expect(bride.membership[1]).toMatchObject({
      house: asId<HouseId>(ctx.world.playerHouse),
      kind: 'married_in',
      from: ctx.world.year,
    });
    expect(ctx.world.people.householdOf(bride.id, ctx.world.year)).toBe(ctx.world.playerHouse);
  });

  it('keeps a cadet bride in her hall when an outsider groom marries in', () => {
    const ctx = testWorld(content);
    const bride = place(ctx, {
      sex: 'female', age: 23, name: 'Cadet Bride', branch: 'cadet_wed_test',
    });
    const groom = place(ctx, {
      sex: 'male', age: 25, name: 'Cadet Groom', house: 'foreign_wed_test',
    });

    wed(ctx, bride, groom);

    expect(bride.marriages).toEqual([{ spouse: groom.id, from: ctx.world.year }]);
    expect(groom.marriages).toEqual([{ spouse: bride.id, from: ctx.world.year }]);
    expect(bride.membership).toHaveLength(1);
    expect(bride.membership[0]?.branch).toBe('cadet_wed_test');
    expect(groom.membership[0]?.to).toBe(ctx.world.year);
    expect(groom.membership[1]).toMatchObject({
      house: asId<HouseId>(ctx.world.playerHouse),
      kind: 'married_in',
      branch: 'cadet_wed_test',
      from: ctx.world.year,
    });
    expect(ctx.world.people.householdOf(groom.id, ctx.world.year)).toBe(ctx.world.playerHouse);
  });
});
