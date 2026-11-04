import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  NAMESAKE_EXPECTATION, assizePressure, beget, ensureHead, headNamesake, nameWorthAsking,
  namesakeBurden, phenotypeOf, place, testRng, testWorld,
} from '@ed/core';
import { asId, proseOriginalHash, type PersonId } from '@ed/schema';
import type { SimCtx } from '@ed/core';
import { readFileSync } from 'node:fs';
import { coreMessageAddress } from './messages.js';
import { setProseMode, setProseVariants } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

/**
 * NAMING IS A REWARD, NOT A FORM (issue #62).
 *
 * Measured through the client over five seeds, naming was 188.8 stops a run —
 * **37.1% of everything the player was ever asked** — and the single most
 * frequent act in the game was typing a name into a text field for somebody
 * who died unremarked. It is now 23.8, and every survivor carries a reason.
 *
 * These assert the RULES rather than the rate: the rate is one measurement in
 * `naming-worth.slow.test.ts`, and a rule that can never fire is invisible in
 * it either way. That is not hypothetical here — #62 asks for a twin rule and
 * this simulation cannot bear twins, which the rate would never have said.
 */
function withHead(seed = 6262) {
  const ctx = testWorld(bundle, seed, 1042);
  // The SEEDED head, not a second one. `testWorld` seats Daveed, and placing
  // another man with the seal puts two heads in the house at once — which
  // `nameWorthAsking` reads exactly as the engine does, by taking the first,
  // so the test would have been asking about somebody else's son.
  const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
  const wife = place(ctx, { sex: 'female', age: 34, name: 'His Wife' });
  return { ctx, head, wife };
}

/** A child of that couple, born this year, not yet asked about. */
function bear(
  ctx: SimCtx,
  father: { id: string },
  mother: { id: string },
  sex: 'male' | 'female',
  name: string,
  branch?: string,
) {
  const child = place(ctx, { sex, age: 0, name, ...(branch ? { branch } : {}) });
  beget(ctx, child, ctx.world.people.get(mother.id), ctx.world.people.get(father.id));
  return child;
}

describe('who is worth naming', () => {
  it('asks for the Head\'s first son, and not for his second', () => {
    const { ctx, head, wife } = withHead();
    // Daveed is seeded with a son. The rule is about a LIVING one — the heir
    // died and the house has another, which is the case worth asking about
    // and is also the clause a careless version of this would drop.
    for (const c of ctx.world.people.children(head.id)) {
      if (c.sex === 'male') c.status = 'dead';
    }

    const first = bear(ctx, head, wife, 'male', 'First Son');
    expect(nameWorthAsking(ctx, first)).toBe('the Head has a son, and had none before today');

    const second = bear(ctx, head, wife, 'male', 'Second Son');
    // The claim is the whole point of the rule: the house already has one.
    expect(nameWorthAsking(ctx, second)).not.toBe('the Head has a son, and had none before today');
  });

  it('asks when a run of one sex is broken, and not before', () => {
    const { ctx, head, wife } = withHead(6263);
    for (let i = 0; i < 4; i += 1) bear(ctx, head, wife, 'female', `Daughter ${i}`);

    const fourth = ctx.world.people.children(wife.id)[3]!;
    expect(nameWorthAsking(ctx, fourth)).toBeUndefined();

    const son = bear(ctx, head, wife, 'male', 'At Last');
    expect(nameWorthAsking(ctx, son)).toBe('the first son after 4 daughters');
  });

  /**
   * The rule fires for the founder's own first child and for nobody else in
   * the hall. Any child born under that roof caught 17.6 a run — most of them
   * to cousins who merely live there, which is the category the earlier cut
   * removed for being no decision at all.
   */
  it('asks for the founder\'s first child in a new hall, and not a cousin\'s', () => {
    const ctx = testWorld(bundle, 6264, 1042);
    const founder = place(ctx, { sex: 'male', age: 30, name: 'Took The East Rooms', branch: 'branch_east' });
    const wife = place(ctx, { sex: 'female', age: 28, name: 'His Wife', branch: 'branch_east' });
    const cousin = place(ctx, { sex: 'male', age: 30, name: 'Lives There Too', branch: 'branch_east' });
    ctx.world.branches.set('branch_east', {
      id: 'branch_east' as never, name: 'The East Rooms', house: ctx.world.playerHouse,
      founder: founder.id, splitFrom: 'main', foundedYear: 1040,
      grievance: 0, contentment: 0, extinct: false,
    } as never);

    const theirs = bear(ctx, founder, wife, 'male', 'Of The East', 'branch_east');
    expect(nameWorthAsking(ctx, theirs)).toBe('the first child of a new cadet branch');

    const cousins = bear(ctx, cousin, wife, 'female', 'Also Of The East', 'branch_east');
    expect(nameWorthAsking(ctx, cousins)).toBeUndefined();
  });

  /**
   * Everybody else. This is the whole of the fix — 189 prompts became 24
   * because the answer to this question is almost always nothing.
   */
  it('says nothing about an ordinary child of the seat', () => {
    const { ctx } = withHead(6265);
    const mother = place(ctx, { sex: 'female', age: 30, name: 'A Cousin' });
    const father = place(ctx, { sex: 'male', age: 32, name: 'Her Husband' });
    const child = place(ctx, { sex: 'female', age: 0, name: 'Nobody In Particular' });
    beget(ctx, child, mother, father);

    expect(nameWorthAsking(ctx, child)).toBeUndefined();
  });
});

/**
 * WHAT A GREAT NAME COSTS (issue #62, second half).
 *
 * Bynames and dynastic ordinals shipped and nothing happened because of a
 * name. A Head the player deliberately named after a Head before him is now
 * measured against that man: the bar `assizePressure` grades the house on
 * rises, and the chronicle says so the year he takes the seal.
 */
describe('a name the player chose costs something', () => {
  /** A house with a former Head called Edric, and a sitting Head the player named Edric. */
  function withNamesake(chosen: boolean) {
    const ctx = testWorld(bundle, 6266, 1200);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    head.name = 'Edric the second';
    ctx.world.succession = [
      { person: asId<PersonId>('p_dead'), name: 'Edric', from: 1100, to: 1199 },
      { person: head.id, name: head.name, from: 1200 },
    ];
    if (chosen) {
      ctx.world.decisionLog.push({ kind: 'name', year: 1170, person: head.id, name: head.name });
    }
    return { ctx, head };
  }

  it('does not charge a Head for a naming decision written in a future year (#2691)', () => {
    const { ctx, head } = withNamesake(false);
    const presentYear = ctx.world.year;
    const futureYear = presentYear + 1;
    ctx.world.decisionLog.push({ kind: 'name', year: futureYear, person: head.id, name: head.name });

    expect(headNamesake(ctx), 'the future decision must not count as a present choice').toBeUndefined();
    expect(namesakeBurden(ctx)).toBe(0);

    // At the decision's own year it becomes evidence, with no extra saved flag.
    ctx.world.year = futureYear;
    expect(headNamesake(ctx)).toEqual({ name: 'Edric', before: 1 });
    expect(namesakeBurden(ctx)).toBeCloseTo(NAMESAKE_EXPECTATION);

    // An already-made decision is still a valid namesake in a later year.
    ctx.world.year += 1;
    expect(headNamesake(ctx)).toEqual({ name: 'Edric', before: 1 });
    expect(namesakeBurden(ctx)).toBeCloseTo(NAMESAKE_EXPECTATION);
  });

  it('ignores future succession histories until their year (#2745)', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      const { ctx, head } = withNamesake(true);
      setProseMode(ctx, mode);
      const year = ctx.world.year;

      // A recovered future namesake is not an earlier Head today.
      ctx.world.succession = [
        { person: asId<PersonId>('p_future'), name: 'Edric', from: year + 1, to: year + 2 },
        { person: head.id, name: head.name, from: year },
      ];
      const untouched = structuredClone(ctx.world.succession);
      expect(headNamesake(ctx)).toBeUndefined();
      expect(namesakeBurden(ctx)).toBe(0);
      expect(ctx.world.succession).toEqual(untouched);

      // An actual earlier bearer still counts, but the future bearer does not.
      ctx.world.succession.unshift({
        person: asId<PersonId>('p_past'), name: 'Edric', from: year - 100, to: year - 1,
      });
      expect(headNamesake(ctx)).toEqual({ name: 'Edric', before: 1 });
      expect(namesakeBurden(ctx)).toBeCloseTo(NAMESAKE_EXPECTATION);

      // Once the saved future reign's date arrives it becomes historical evidence.
      ctx.world.year = year + 1;
      expect(headNamesake(ctx)).toEqual({ name: 'Edric', before: 2 });
      expect(namesakeBurden(ctx)).toBeCloseTo(2 * NAMESAKE_EXPECTATION);
    }
  });

  it('measures a Head the player named after a Head', () => {
    const { ctx } = withNamesake(true);
    expect(headNamesake(ctx)).toEqual({ name: 'Edric', before: 1 });
    expect(namesakeBurden(ctx)).toBeCloseTo(NAMESAKE_EXPECTATION);
  });

  /**
   * And NOT one the chronicler produced. `dynasticNames` reuses a Head's name
   * constantly and by design, so grading those would be a tax on the naming
   * system rather than a consequence of a decision — and it would move every
   * number in the harness. It is also why `npm run digest` does not move.
   */
  it('ignores a name the house arrived at on its own', () => {
    const { ctx } = withNamesake(false);
    expect(headNamesake(ctx)).toBeUndefined();
    expect(namesakeBurden(ctx)).toBe(0);
  });

  it('grades the same house harder for carrying the name', () => {
    const plain = withNamesake(false);
    const named = withNamesake(true);

    // Same seed, same year, same house — the only difference is that a player
    // reached for the name, and the world expects the difference back.
    expect(assizePressure(named.ctx)).toBeLessThan(assizePressure(plain.ctx));
  });

  it('says so in the book the year the seal changes hands', () => {
    const ctx = testWorld(bundle, 6267, 1200);
    const w = ctx.world;

    // Vacate the seat and leave exactly one man who can take it, so this is a
    // test of what `ensureHead` SAYS rather than of who it picks.
    for (const p of w.people.all()) {
      p.castSlots = p.castSlots.filter((s) => s !== 'head');
      if (p.status === 'alive') p.status = 'dead';
    }
    const heir = place(ctx, { sex: 'male', age: 30, name: 'Edric the second' });
    w.succession = [{ person: asId<PersonId>('p_dead'), name: 'Edric', from: 1100, to: 1199 }];
    w.decisionLog.push({ kind: 'name', year: 1170, person: heir.id, name: heir.name });

    ensureHead(ctx, testRng());

    expect(heir.castSlots, 'he never took the seal, so this asserts nothing').toContain('head');
    const said = w.chronicle.some((e) => e.title === 'Edric, again');
    expect(said, 'the bar moved and the book said nothing').toBe(true);
  });
});

describe('why a name is worth asking, in the reader\'s setting (#779)', () => {
  const ORIGINALS: Record<string, string> = {
    'naming.worth.first_cadet_child': 'the first child of a new cadet branch',
    'naming.worth.heads_first_son': 'the Head has a son, and had none before today',
    'naming.worth.blood_returns': 'the first of the blood to carry it in three generations',
    'naming.worth.daughter_after_sons': 'the first daughter after {COUNT} sons',
    'naming.worth.son_after_daughters': 'the first son after {COUNT} daughters',
    'naming.worth.born_to_new_head': 'born to the new Head in the year he took the seal',
    'naming.worth.throwback': '{ATTRIBUTE} well outside anything the line has produced',
  };
  const PLAIN: Record<string, string> = {
    'naming.worth.first_cadet_child': 'first child of the new branch',
    'naming.worth.heads_first_son': "the Head's first living son",
    'naming.worth.son_after_daughters': 'a son after {COUNT} daughters',
  };
  function plain(ctx: SimCtx): SimCtx {
    setProseVariants(ctx, Object.entries(PLAIN).map(([key, plainenglish]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(ORIGINALS[key]!), plainenglish,
    })));
    setProseMode(ctx, 'plainenglish');
    return ctx;
  }

  it('keeps every reason\'s Original as its keyed message', () => {
    const source = readFileSync(new URL('./people/naming.ts', import.meta.url), 'utf8');
    const keyed = Object.fromEntries(coreMessageEntries(source)
      .filter((entry) => entry.address.includes('#naming.worth.'))
      .map((entry) => [entry.address, entry.text]));
    expect(keyed).toEqual(Object.fromEntries(
      Object.entries(ORIGINALS).map(([key, text]) => [coreMessageAddress(key), text]),
    ));
  });

  it('gives the reviewed Plain English reason, and chooses the same reason', () => {
    const { ctx, head, wife } = withHead();
    plain(ctx);
    for (const c of ctx.world.people.children(head.id)) if (c.sex === 'male') c.status = 'dead';
    expect(nameWorthAsking(ctx, bear(ctx, head, wife, 'male', 'First Son'))).toBe("the Head's first living son");

    const run = withHead(6263);
    plain(run.ctx);
    for (let i = 0; i < 4; i += 1) bear(run.ctx, run.head, run.wife, 'female', `Daughter ${i}`);
    expect(nameWorthAsking(run.ctx, bear(run.ctx, run.head, run.wife, 'male', 'At Last'))).toBe('a son after 4 daughters');

    const hall = testWorld(bundle, 6264, 1042);
    plain(hall);
    const founder = place(hall, { sex: 'male', age: 30, name: 'Founder', branch: 'branch_east' });
    const mother = place(hall, { sex: 'female', age: 28, name: 'His Wife', branch: 'branch_east' });
    hall.world.branches.set('branch_east', {
      id: 'branch_east' as never, name: 'The East Rooms', house: hall.world.playerHouse,
      founder: founder.id, splitFrom: 'main', foundedYear: 1040, grievance: 0,
    } as never);
    expect(nameWorthAsking(hall, bear(hall, founder, mother, 'male', 'Of The East', 'branch_east')))
      .toBe('first child of the new branch');
  });
});


describe('naming honours respect the current world year (#2797, #2798)', () => {
  it('does not let an unborn son hide the Head’s first living son', () => {
    const { ctx, head, wife } = withHead(279701);
    for (const sibling of ctx.world.people.children(head.id)) {
      if (sibling.sex === 'male') sibling.status = 'dead';
    }
    const unborn = bear(ctx, head, wife, 'male', 'Son of next spring');
    unborn.born = ctx.world.year + 1;
    const newborn = bear(ctx, head, wife, 'male', 'First living son');

    expect(nameWorthAsking(ctx, unborn), 'an unborn child cannot be named yet').toBeUndefined();
    expect(nameWorthAsking(ctx, newborn)).toBe('the Head has a son, and had none before today');

    unborn.born = ctx.world.year;
    expect(nameWorthAsking(ctx, newborn)).not.toBe('the Head has a son, and had none before today');
  });

  it('does not let an unborn carrier end today’s blood drought', () => {
    const ctx = testWorld(bundle, 279702, 1042);
    const w = ctx.world;
    // The founding generation is historical at this restored year.
    w.year += 100;
    const carrier = (name: string) => {
      for (let n = 0; n < 96; n += 1) {
        const p = place(ctx, { sex: 'female', age: 0, name: name + n });
        if (phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont !== null) return p;
        p.born = w.year - 100;
      }
      throw new Error('no deterministic female carrier in the player house');
    };
    const unborn = carrier('Later carrier');
    unborn.born = w.year + 1;
    const newborn = carrier('Current carrier');

    expect(nameWorthAsking(ctx, newborn))
      .toBe('the first of the blood to carry it in three generations');
    unborn.born = w.year;
    expect(nameWorthAsking(ctx, newborn))
      .not.toBe('the first of the blood to carry it in three generations');
  });

  it('does not name a hall before founding or let unborn siblings steal its first child', () => {
    const ctx = testWorld(bundle, 279801, 1042);
    const w = ctx.world;
    const founder = place(ctx, { sex: 'male', age: 30, name: 'Founder of Tomorrow', branch: 'branch_tomorrow' });
    const mother = place(ctx, { sex: 'female', age: 28, name: 'Mother of Tomorrow', branch: 'branch_tomorrow' });
    w.branches.set('branch_tomorrow' as never, {
      id: 'branch_tomorrow', name: 'Tomorrow Hall', house: w.playerHouse,
      founder: founder.id, splitFrom: 'main', foundedYear: w.year + 1,
      grievance: 0, contentment: 0, extinct: false,
    } as never);
    const preFounding = bear(ctx, founder, mother, 'female', 'Before the roof', 'branch_tomorrow');
    expect(nameWorthAsking(ctx, preFounding)).toBeUndefined();

    w.year += 1;
    // A previously born child cannot retroactively become a post-founding child.
    expect(nameWorthAsking(ctx, preFounding)).toBeUndefined();
    const futureSibling = bear(ctx, founder, mother, 'female', 'Next year’s child', 'branch_tomorrow');
    futureSibling.born = w.year + 1;
    const first = bear(ctx, founder, mother, 'female', 'First under the roof', 'branch_tomorrow');
    expect(nameWorthAsking(ctx, first)).toBe('the first child of a new cadet branch');

    futureSibling.born = w.year;
    expect(nameWorthAsking(ctx, first))
      .not.toBe('the first child of a new cadet branch');
  });

  it('requires a past headship before naming a new Head’s child', () => {
    const { ctx, head, wife } = withHead(279802);
    const w = ctx.world;
    // Already having a son keeps the first-son reason from masking this rule.
    bear(ctx, head, wife, 'male', 'Earlier son');
    const newborn = bear(ctx, head, wife, 'male', 'Child of this reign');
    w.headSince = w.year;
    const current = { person: head.id, name: head.name, from: w.year };
    w.succession = [
      current,
      { person: asId<PersonId>('future_head'), name: 'A future Head', from: w.year + 1 },
    ];

    expect(nameWorthAsking(ctx, newborn))
      .not.toBe('born to the new Head in the year he took the seal');
    w.succession = [
      { person: asId<PersonId>('former_head'), name: 'The former Head', from: w.year - 1, to: w.year },
      current,
    ];
    expect(nameWorthAsking(ctx, newborn))
      .toBe('born to the new Head in the year he took the seal');
  });

  it('measures a newborn’s exceptional attribute against born relatives, not future outliers', () => {
    const ctx = testWorld(bundle, 279703, 1042);
    for (let i = 0; i < 8; i += 1) {
      place(ctx, { sex: 'female', age: 30, name: 'Earlier family ' + i });
    }
    const newborn = place(ctx, { sex: 'female', age: 0, name: 'Exceptional child' });
    newborn.acquired.strength = 10000;
    newborn.phenotype = undefined;
    const baseline = nameWorthAsking(ctx, newborn);
    expect(baseline).toBe('strength well outside anything the line has produced');

    const unborn = place(ctx, { sex: 'female', age: 0, name: 'Future prodigy' });
    unborn.born = ctx.world.year + 1;
    unborn.acquired.strength = 100000;
    unborn.phenotype = undefined;
    expect(nameWorthAsking(ctx, newborn)).toBe(baseline);

    unborn.born = ctx.world.year;
    expect(nameWorthAsking(ctx, newborn)).not.toBe(baseline);
  });
});
