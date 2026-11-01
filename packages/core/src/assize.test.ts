import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, indexContent, proseOriginalHash, type ActiveAge, type HouseId } from '@ed/schema';
import {
  ASSIZE_RESPONSES, armOf, assizeFavour, assizePressure, measureFortune,
  newGame, phase, place, resumeGame, setProseMode, setProseVariants, testWorld,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import {
  COLLATERAL_BILL, COLLATERAL_KEPT, FOUNDING_YEARS, KEEP_AT, KEEP_FROM, KEEP_YEARS,
  collateralDue, collateralKept, collateralKeeps, keepTheCollateral,
} from './assize.js';
import { afterimageEvidence } from './afterimage.js';
import { DEBT_FLOOR } from './economy.js';
import { rollDeath, thinBloodMortality } from './people/demography.js';
import { coreMessageAddress } from './messages.js';
import { loadGame, saveGame } from './save.js';
import type { Rng } from './rng.js';

const bundle = loadContent();

/**
 * THE ASSIZE (`assize.ts`) — the world's opinion of the house, and what it
 * does about it.
 *
 * The failure it answers: across fourteen thousand-year runs of the shipped
 * game, no house died out, none fell below ten people, every player-driven run
 * recovered nine of nine clauses, and standing landed on exalted almost every
 * time. Nothing in the world reacted to the house, so the run had feedback of
 * neither sign.
 */
describe('how the world reads the house', () => {
  it('reads a rich, respected, populous house as ahead', () => {
    const ctx = testWorld(bundle, 4242);
    ctx.world.treasury = 6000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 24; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 20 + i });

    expect(measureFortune(ctx).score).toBeGreaterThan(0.6);
    expect(assizePressure(ctx)).toBeGreaterThan(0.4);
  });

  it('reads a broke, unknown, dwindling house as behind', () => {
    const ctx = testWorld(bundle, 4243);
    ctx.world.treasury = -100;
    ctx.world.respect = 'unknown';
    // A house with a living expresser and a hall of people is never at the
    // floor, however empty the strongbox. What matters is that it is far
    // enough under for the steadying arm to reach it — see `STEADIES_AT`.
    expect(assizePressure(ctx)).toBeLessThan(-0.26);
  });

  it('raises the bar across a complete Long Line', () => {
    const early = testWorld(bundle, 4244);
    early.world.treasury = 700;
    const late = testWorld(bundle, 4244);
    late.world.treasury = 700;
    late.world.year = 1542;

    expect(assizePressure(late)).toBeLessThan(assizePressure(early));
  });

  it('reads equivalent progress the same way in Short and Long campaigns', () => {
    // #133: this used to divide by a literal 1000, so Short at its term and
    // Long at its term had different world expectations despite both being
    // 100% through their bargain.
    const short = testWorld(bundle, 42441);
    short.world.campaign = 'short';
    short.world.year = 1342;
    short.world.treasury = 700;

    const long = testWorld(bundle, 42441);
    long.world.campaign = 'long';
    long.world.year = 1542;
    long.world.treasury = 700;

    expect(assizePressure(short)).toBeCloseTo(assizePressure(long), 10);
  });
});

describe('what the world does about it', () => {
  it('says so out loud, every time', () => {
    // A hidden rubber band is a lie the player can feel and cannot name. Every
    // response writes a line naming who did what.
    const ctx = testWorld(bundle);
    for (const r of ASSIZE_RESPONSES) {
      expect(r.line(ctx).length, `${r.id} acts silently`).toBeGreaterThan(30);
      expect(armOf(r)).toBe(r.arm);
    }
  });

  it('offers both arms, and enough of each to not be read by the fourth century', () => {
    const resents = ASSIZE_RESPONSES.filter((r) => r.arm === 'resents');
    const steadies = ASSIZE_RESPONSES.filter((r) => r.arm === 'steadies');
    expect(resents.length).toBeGreaterThanOrEqual(6);
    expect(steadies.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ASSIZE_RESPONSES.map((r) => r.id)).size).toBe(ASSIZE_RESPONSES.length);
  });

  it('charges a house that is plainly doing well', () => {
    const ctx = testWorld(bundle, 4245);
    ctx.world.treasury = 9000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 26; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 22 + (i % 30) });
    ctx.world.assize.lastSitting = ctx.world.year - 40;

    const before = ctx.world.treasury;
    // Long enough for a sitting to land; the interval is twelve years.
    for (let i = 0; i < 30; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
    }
    expect(ctx.world.treasury, 'nothing was ever asked of a house with nine thousand crowns')
      .toBeLessThan(before);
  });

  it('steadies a house that is plainly failing', () => {
    const ctx = testWorld(bundle, 4246);
    ctx.world.treasury = -110;
    ctx.world.respect = 'unknown';
    ctx.world.assize.lastSitting = ctx.world.year - 40;

    let helped = false;
    for (let i = 0; i < 40 && !helped; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
      helped = ctx.world.treasury > -110
        || assizeFavour(ctx, 'favour')
        || assizeFavour(ctx, 'mercy');
    }
    expect(helped, 'the world watched a house starve and did nothing').toBe(true);
  });
});

describe('the Assize speaks the reader\'s setting (#757)', () => {
  const plainFor = (id: string) => `The world acted (${id}).`;
  function speak(ctx: SimCtx, mode: 'original' | 'plainenglish'): SimCtx {
    const original = testWorld(bundle);
    setProseVariants(ctx, ASSIZE_RESPONSES.map((r) => ({
      address: coreMessageAddress(`assize.${r.id}`), of: proseOriginalHash(r.line(original)), plainenglish: plainFor(r.id),
    })));
    setProseMode(ctx, mode);
    return ctx;
  }

  it('gives every response its own reviewed Plain English line', () => {
    const ctx = speak(testWorld(bundle), 'plainenglish');
    for (const r of ASSIZE_RESPONSES) expect(r.line(ctx)).toBe(plainFor(r.id));
  });

  /** A rich house, ticked until the world charges it; the same draws either way. */
  function sitting(mode: 'original' | 'plainenglish') {
    const ctx = speak(testWorld(bundle, 4245), mode);
    ctx.world.treasury = 9000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 26; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 22 + (i % 30) });
    ctx.world.assize.lastSitting = ctx.world.year - 40;
    const from = ctx.world.chronicle.length;
    for (let i = 0; i < 30 && Object.keys(ctx.world.assize.fired).length === 0; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
    }
    const [id] = Object.keys(ctx.world.assize.fired);
    expect(id, 'no sitting landed').toBeDefined();
    return { ctx, id: id!, page: ctx.world.chronicle.slice(from).at(-1)! };
  }

  it('writes the same sitting in both settings, and the page keeps its words', () => {
    const original = sitting('original');
    const plain = sitting('plainenglish');
    expect(plain.id).toBe(original.id);
    expect(original.page.text).toBe(ASSIZE_RESPONSES.find((r) => r.id === original.id)!.line(testWorld(bundle)));
    expect(plain.page.text).toBe(plainFor(plain.id));
    expect(plain.ctx.world.treasury).toBe(original.ctx.world.treasury);
    expect(plain.ctx.world.discontent).toBe(original.ctx.world.discontent);
    setProseMode(plain.ctx, 'original');
    expect(plain.page.text).toBe(plainFor(plain.id));
  });
});

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
  const interlude = (ctx: SimCtx) =>
    ctx.world.frame.entries.push({ year: ctx.world.year, eventId: 'frame_x', outcomeId: 'o', text: 'An interlude.' });

  it('holds for at least the window after the firing year, even if the frame speaks early', () => {
    const ctx = lineOf(2);
    const at = ctx.world.year;
    keepTheCollateral(ctx);
    // Mortality for the firing year has already been rolled; it starts next year.
    expect(collateralKept(ctx)).toBe(false);
    ctx.world.year = at + 1;
    interlude(ctx);
    for (let y = at + 1; y <= at + KEEP_YEARS; y++) {
      ctx.world.year = y;
      expect(collateralKept(ctx), `year ${y - at}`).toBe(true);
    }
    ctx.world.year = at + KEEP_YEARS + 1;
    expect(collateralKept(ctx), 'the frame has spoken and the window is spent').toBe(false);
  });

  it('holds past the window until the first interlude, then lets go', () => {
    const ctx = lineOf(2);
    const at = ctx.world.year;
    keepTheCollateral(ctx);
    // No interlude yet: the keeping outlasts its minimum.
    for (let y = at + KEEP_YEARS + 1; y <= at + 3 * KEEP_YEARS; y++) {
      ctx.world.year = y;
      expect(collateralKept(ctx), `year ${y - at}`).toBe(true);
    }
    // The frame speaks; from the next mortality pass the blood is on its own.
    interlude(ctx);
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
    expect(collateralKept(resumed), 'no interlude yet, so still kept').toBe(true);
    resumed.world.frame.entries.push({ year: resumed.world.year, eventId: 'frame_x', outcomeId: 'o', text: 'An interlude.' });
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
