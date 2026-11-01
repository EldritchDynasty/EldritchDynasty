import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, indexContent, proseOriginalHash, type ActiveAge, type HouseId } from '@ed/schema';
import {
  COLLATERAL_BILL, COLLATERAL_KEPT, FOUNDING_YEARS, KEEP_AT, KEEP_FROM, KEEP_YEARS,
  collateralDue, collateralKept, collateralKeeps, keepTheCollateral,
} from './assize.js';
import { afterimageEvidence } from './afterimage.js';
import { DEBT_FLOOR } from './economy.js';
import { rollDeath, thinBloodMortality } from './people/demography.js';
import { coreMessageAddress } from './messages.js';
import { loadGame, saveGame } from './save.js';
import { phase, place, testWorld } from './testing.js';
import { setProseMode, setProseVariants } from './prose.js';
import type { Rng } from './rng.js';
import type { SimCtx } from './world.js';

const content = indexContent(loadContent());

/**
 * THE COLLATERAL KEPT (#1993, option (a)).
 *
 * Once in a run, before the player has met the frame, a grown line that has
 * fallen to its last few is kept out of the Age and off the thin-line
 * amplifier for a window, and the house is billed for it. These witnesses build
 * each state the rule distinguishes rather than hoping a seed reaches it. The
 * rate the rule buys is a batch statistic, and lives in `docs/BALANCE-LOG.md`
 * under #1993 with the `gate:line-breaks` command that reproduces it.
 */

/** A Short Line whose blood is exactly `n` grown people, and once stood at `was`. */
function lineOf(n: number, was = 12, campaign: SimCtx['world']['campaign'] = 'short'): SimCtx {
  const ctx = testWorld(content);
  ctx.world.campaign = campaign;
  for (const p of [...ctx.world.people.living()]) {
    if (p.membership.some((m) => m.house === ctx.world.playerHouse && m.kind === 'blood')) {
      ctx.world.people.kill(p.id, ctx.world.year, 'making room for the fixture');
    }
  }
  for (let i = 0; i < n; i++) {
    place(ctx, { sex: i % 2 ? 'male' : 'female', age: 24 + 4 * i, name: `Kept ${i}` });
  }
  ctx.world.bloodHighWater = Math.max(n, was);
  return ctx;
}

const blood = (ctx: SimCtx) =>
  ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive');

/** A die that always rolls the same number, so a hazard can be read off a single death roll. */
function fixedRoll(value: number): Rng {
  const rng: Rng = {
    next: () => value,
    int: (max) => Math.floor(value * max),
    range: (min, max) => min + value * (max - min),
    bool: (p) => value < p,
    pick: (xs) => xs[Math.floor(value * xs.length)]!,
    weighted: (xs) => xs[0],
    normal: (mean) => mean,
    poisson: () => 0,
    fork: () => rng,
  };
  return rng;
}

const plague = (ctx: SimCtx): ActiveAge => ({ age: 'the_plague', began: ctx.world.year, named: true, paid: { standing: false } });

describe('when the collateral is kept', () => {
  it('keeps a grown line that has fallen to its last few, before any interlude', () => {
    for (let n = 1; n <= KEEP_AT; n++) {
      const ctx = lineOf(n);
      expect(collateralDue(ctx), `${n} of the blood`).toBe(true);
    }
  });

  it('names every condition that refuses it', () => {
    // A line with more than the last few left is not failing yet.
    expect(collateralDue(lineOf(KEEP_AT + 1))).toBe(false);
    // Nobody of the blood left: there is nothing to keep.
    expect(collateralDue(lineOf(0))).toBe(false);
    // A founding house of three is young, not failing.
    expect(collateralDue(lineOf(2, KEEP_FROM - 1))).toBe(false);
    expect(collateralDue(lineOf(2, KEEP_FROM))).toBe(true);
    // A house still that small once its founding generation has passed is failing.
    const stunted = lineOf(2, KEEP_FROM - 1);
    stunted.world.year += FOUNDING_YEARS - 1;
    expect(collateralDue(stunted)).toBe(false);
    stunted.world.year += 1;
    expect(collateralDue(stunted)).toBe(true);
    // The Demonstration's authored death stays outside this rule.
    expect(collateralDue(lineOf(2, 12, 'demo'))).toBe(false);
    expect(collateralDue(lineOf(2, 12, 'long'))).toBe(true);

    // Once the player has met the frame, the window has closed.
    const heard = lineOf(2);
    heard.world.frame.entries.push({ year: heard.world.year, eventId: 'frame_x', outcomeId: 'o', text: 'An interlude.' });
    expect(collateralDue(heard)).toBe(false);

    // A run that has ended is not kept.
    const ended = lineOf(2);
    ended.world.ending = { id: 'forgotten', year: ended.world.year };
    expect(collateralDue(ended)).toBe(false);
  });

  it('happens once in a run, however often the line falls again', () => {
    const ctx = lineOf(2);
    expect(keepTheCollateral(ctx)).toBe(true);
    const at = ctx.world.year;
    expect(ctx.world.assize.fired[COLLATERAL_KEPT]).toBe(at);
    for (let i = 0; i < KEEP_YEARS * 3; i++) {
      ctx.world.year++;
      expect(keepTheCollateral(ctx)).toBe(false);
    }
    expect(ctx.world.assize.fired[COLLATERAL_KEPT]).toBe(at);
    expect(ctx.world.chronicle.filter((page) => page.text?.includes('weighers'))).toHaveLength(1);
  });

  it('fires from the Assize phase in the year the line falls, without waiting for a sitting', () => {
    const ctx = lineOf(1);
    // A sitting was held last year, so the twelve-year interval has not passed.
    ctx.world.assize.lastSitting = ctx.world.year - 1;
    const report = phase('assize', ctx);
    expect(report.assize?.kept).toBe(true);
    expect(ctx.world.assize.fired[COLLATERAL_KEPT]).toBe(ctx.world.year);
    // And the sitting cadence is untouched by it.
    expect(ctx.world.assize.lastSitting).toBe(ctx.world.year - 1);
  });
});

describe('what the keeping does', () => {
  it('holds for the window after the firing year, then lets go', () => {
    const ctx = lineOf(2);
    const at = ctx.world.year;
    keepTheCollateral(ctx);
    // Mortality for the firing year has already been rolled; it starts next year.
    expect(collateralKept(ctx)).toBe(false);
    for (let y = at + 1; y <= at + KEEP_YEARS; y++) {
      ctx.world.year = y;
      expect(collateralKept(ctx), `year ${y - at}`).toBe(true);
    }
    ctx.world.year = at + KEEP_YEARS + 1;
    expect(collateralKept(ctx)).toBe(false);
  });

  it('covers the blood and nobody else', () => {
    const ctx = lineOf(2);
    const steward = place(ctx, { sex: 'male', age: 40, name: 'A Steward' });
    steward.membership = [{ house: asId<HouseId>(ctx.world.playerHouse), kind: 'retainer', from: ctx.world.year }];
    const stranger = place(ctx, { sex: 'female', age: 30, name: 'A Stranger', house: 'house_marrow' });
    keepTheCollateral(ctx);
    ctx.world.year++;
    for (const p of blood(ctx)) expect(collateralKeeps(ctx, p)).toBe(true);
    expect(collateralKeeps(ctx, steward)).toBe(false);
    expect(collateralKeeps(ctx, stranger)).toBe(false);
  });

  it('keeps the blood out of the plague and off the thin-line amplifier', () => {
    // The same person, the same Age and the same die: the only thing that
    // differs is whether the keeping is in force.
    const roll = 0.05;
    const unkept = lineOf(2, 20);
    unkept.world.age.active = [plague(unkept)];
    const kept = lineOf(2, 20);
    kept.world.age.active = [plague(kept)];
    keepTheCollateral(kept);
    unkept.world.year++;
    kept.world.year++;

    const [a] = blood(unkept);
    const [b] = blood(kept);
    expect(thinBloodMortality(unkept, a!), 'the fixture is in the thin-line regime').toBeGreaterThan(5);
    expect(rollDeath(a!, unkept, fixedRoll(roll)), 'a plague year at two of the blood kills at this roll').toBe(true);
    expect(rollDeath(b!, kept, fixedRoll(roll)), 'the kept line survives the same roll').toBe(false);
    expect(b!.status).toBe('alive');
  });

  it('does not set aside the max-age wall: nobody is made immortal', () => {
    const ctx = lineOf(1);
    keepTheCollateral(ctx);
    ctx.world.year++;
    const [last] = blood(ctx);
    last!.born = ctx.world.year - 400;
    expect(rollDeath(last!, ctx, fixedRoll(0.99))).toBe(true);
    // Through the one death gate: the person is dead, not removed.
    expect(last!.status).toBe('dead');
  });

  it('holds the physician for the same window', () => {
    const ctx = lineOf(2);
    keepTheCollateral(ctx);
    expect(ctx.world.assize.mercy).toBe(ctx.world.year + KEEP_YEARS);
  });
});

describe('what it costs, and what the book says', () => {
  it('bills the house in crowns, and the bill can run into debt', () => {
    const ctx = lineOf(2);
    ctx.world.treasury = 300;
    keepTheCollateral(ctx);
    expect(ctx.world.treasury).toBe(300 - COLLATERAL_BILL);

    const broke = lineOf(2);
    broke.world.treasury = DEBT_FLOOR;
    broke.world.respect = 'regarded';
    keepTheCollateral(broke);
    expect(broke.world.treasury).toBe(DEBT_FLOOR - COLLATERAL_BILL);
    // The economy's ordinary broke-house rule turns the shortfall into standing.
    phase('economy', broke);
    expect(broke.world.treasury).toBe(DEBT_FLOOR);
    expect(broke.world.respect).toBe('known');
  });

  it('writes one named page naming the actors and the bill, and citing the blood', () => {
    const ctx = lineOf(3);
    const from = ctx.world.chronicle.length;
    keepTheCollateral(ctx);
    const pages = ctx.world.chronicle.slice(from);
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(page!.weight).toBe('paragraph');
    expect(page!.named).toBe(true);
    expect(page!.id).toBeDefined();
    expect(page!.text).toContain('physician');
    expect(page!.text).toContain('weighers');
    expect(page!.text).toContain(String(COLLATERAL_BILL));
    const youngest = [...blood(ctx)].sort((a, b) => b.born - a.born)[0]!;
    expect(page!.text).toContain(youngest.name);
    expect(new Set(page!.people)).toEqual(new Set(blood(ctx).map((p) => p.id)));
  });

  it('reaches the Afterimage as the page itself, cited for each of the blood it kept', () => {
    // The end-of-run account quotes recorded pages; it never paraphrases the
    // bill. So the rescue reads the same there as it did in the book.
    const ctx = lineOf(2);
    keepTheCollateral(ctx);
    const page = ctx.world.chronicle.at(-1)!;
    const cited = afterimageEvidence(ctx).people;
    for (const p of blood(ctx)) {
      const reading = cited.find((entry) => entry.person === p.id);
      expect(reading?.sources.some((source) => source.page === page.id && source.text === page.text)).toBe(true);
    }
  });

  it('speaks the reader\'s setting, and the page keeps its words', () => {
    const original = lineOf(1);
    keepTheCollateral(original);
    const said = original.world.chronicle.at(-1)!.text!;
    const [kept] = blood(original);
    const template = said.replace(kept!.name, '{PERSON}').replace(String(COLLATERAL_BILL), '{PRICE}');

    const plain = lineOf(1);
    setProseVariants(plain, [{
      address: coreMessageAddress('assize.the_collateral_kept'),
      of: proseOriginalHash(template),
      plainenglish: 'A doctor nobody sent for came to look after {PERSON}. The bill was {PRICE} crowns.',
    }]);
    setProseMode(plain, 'plainenglish');
    keepTheCollateral(plain);
    const page = plain.world.chronicle.at(-1)!;
    expect(page.text).toBe(`A doctor nobody sent for came to look after ${blood(plain)[0]!.name}. The bill was ${COLLATERAL_BILL} crowns.`);
    setProseMode(plain, 'original');
    expect(page.text).toContain('A doctor nobody sent for');
    // Identical mechanics in both settings.
    expect(plain.world.treasury).toBe(original.world.treasury);
  });
});

describe('save and resume around the keeping', () => {
  it('resumes mid-window still kept, and still spent', () => {
    const ctx = lineOf(2);
    keepTheCollateral(ctx);
    ctx.world.year += 5;
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(collateralKept(resumed)).toBe(true);
    expect(resumed.world.assize.fired[COLLATERAL_KEPT]).toBe(ctx.world.assize.fired[COLLATERAL_KEPT]);
    expect(keepTheCollateral(resumed)).toBe(false);
    resumed.world.year += KEEP_YEARS;
    expect(collateralKept(resumed)).toBe(false);
  });

  it('resumes just before it is due and fires exactly as an unbroken run would', () => {
    const ctx = lineOf(2);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(keepTheCollateral(ctx)).toBe(true);
    expect(keepTheCollateral(resumed)).toBe(true);
    expect(resumed.world.treasury).toBe(ctx.world.treasury);
    expect(resumed.world.chronicle.at(-1)!.text).toBe(ctx.world.chronicle.at(-1)!.text);
    expect(resumed.world.assize.fired).toEqual(ctx.world.assize.fired);
  });
});
