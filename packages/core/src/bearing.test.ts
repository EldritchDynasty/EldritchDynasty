import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  ECHO_AFTER, REMEMBERED_AFTER, answeredBy, bearingOf, causeOf, dealMatch, makeRng, marketAppetite, noteBearing, place,
  testWorld, tickBearing, type BearingAct,
} from '@ed/core';

const content = loadContent();

/**
 * BEARING (concept §29, issue #45) — how the house carries what it has.
 *
 * Every test here is about one of the five rules the design is built to keep,
 * because those are the things that make it a moral rather than a difficulty
 * setting, and every one of them is invisible from outside if it breaks.
 */
describe('bearing is read off acts, not off fortune', () => {
  it('reads zero for a house that has done nothing', () => {
    const ctx = testWorld(content, 7001);
    expect(bearingOf(ctx).score).toBe(0);
  });

  it('rises with the acts the world remembers', () => {
    const ctx = testWorld(content, 7002);
    ctx.world.year = 1042;
    for (let i = 0; i < 12; i++) noteBearing(ctx, 'refused_a_hand');
    ctx.world.year = 1042 + REMEMBERED_AFTER + 50;
    const after = bearingOf(ctx);
    expect(after.carriage).toBeGreaterThan(0);
    expect(after.score).toBeGreaterThan(0);
  });

  /**
   * RULE 3, and the one that makes this a moral rather than a rule the player
   * learns. A consequence that lands in the same decade as its cause is a
   * price tag; two generations later it is a thing the house inherited.
   */
  it('charges nothing at all for an act taken this year', () => {
    const ctx = testWorld(content, 7003);
    for (let i = 0; i < 40; i++) noteBearing(ctx, 'refused_a_hand');
    expect(bearingOf(ctx).carriage).toBe(0);

    // And still nothing the year before it is remembered.
    ctx.world.year += REMEMBERED_AFTER - 1;
    expect(bearingOf(ctx).carriage).toBe(0);
    ctx.world.year += 1;
    expect(bearingOf(ctx).carriage).toBeGreaterThan(0);
  });

  /**
   * RULE 5: reversible by act, never by apology. A house that stops does not
   * atone — the ledger simply stops growing while the run's length does, and
   * the reading falls out from under it.
   */
  it('falls when the house stops, without anything being undone', () => {
    const ctx = testWorld(content, 7004);
    for (let i = 0; i < 16; i++) noteBearing(ctx, 'refused_a_hand');
    ctx.world.year = 1042 + REMEMBERED_AFTER + 100;
    const proud = bearingOf(ctx).carriage;

    // Three more centuries, and not one more act.
    ctx.world.year += 300;
    expect(bearingOf(ctx).carriage).toBeLessThan(proud);
    expect(ctx.world.bearing.acts).toHaveLength(16);
  });

  it('weighs a refused hand heavier than a page written larger', () => {
    const loud = testWorld(content, 7005);
    const quiet = testWorld(content, 7006);
    for (const [ctx, kind] of [[loud, 'refused_a_hand'], [quiet, 'wrote_it_larger']] as const) {
      for (let i = 0; i < 10; i++) noteBearing(ctx, kind);
      ctx.world.year = 1042 + REMEMBERED_AFTER + 50;
    }
    expect(bearingOf(loud).carriage).toBeGreaterThan(bearingOf(quiet).carriage);
  });


  it('echoes concrete record, match, and land acts before any of them are billed', () => {
    const ctx = testWorld(content, 7008);
    ctx.world.year = 1042;
    noteBearing(ctx, 'wrote_it_larger', 'the claim recorded as black_stair_account');
    noteBearing(ctx, 'refused_a_hand', 'the hand offered to Ysabel');
    noteBearing(ctx, 'bit_the_common', 'West Mere');

    const before = ctx.world.chronicle.length;
    ctx.world.year += ECHO_AFTER - 1;
    tickBearing(ctx);
    expect(ctx.world.chronicle).toHaveLength(before);
    expect(ctx.world.bearing.score).toBe(0);

    ctx.world.year += 1;
    tickBearing(ctx);
    const echoes = ctx.world.chronicle.slice(before).map((e) => e.text ?? '');
    expect(echoes).toHaveLength(3);
    expect(echoes.some((e) => e.includes('black_stair_account'))).toBe(true);
    expect(echoes.some((e) => e.includes('Ysabel'))).toBe(true);
    expect(echoes.some((e) => e.includes('West Mere'))).toBe(true);
    expect(ctx.world.bearing.score, 'the echo is presentation, not the bill').toBe(0);

    tickBearing(ctx);
    expect(ctx.world.chronicle, 'an origin echoes only once').toHaveLength(before + 3);

    ctx.world.year = 1042 + REMEMBERED_AFTER;
    tickBearing(ctx);
    expect(ctx.world.bearing.score, 'the existing bearing owner still resolves the bill').toBeGreaterThan(0);
  });

  it('links every delayed echo back to the act it answers, exhaustively', () => {
    const ctx = testWorld(content, 7009);
    ctx.world.year = 1042;

    const acts: { kind: BearingAct; about: string; page?: string }[] = [
      { kind: 'wrote_it_larger', about: 'the claim recorded as salt_account', page: 'chr_source_lie' },
      { kind: 'refused_a_hand', about: 'the hand offered to Agnes' },
      { kind: 'kept_her_back', about: 'Ysabel' },
      { kind: 'took_the_cousin', about: 'Margery marrying Thomas' },
      { kind: 'bit_the_common', about: 'West Mere', page: 'chr_source_common' },
    ];

    ctx.world.chronicle.push(
      { id: 'chr_source_lie', year: 1042, weight: 'paragraph', text: 'The book made it larger.', named: false },
      { id: 'chr_source_common', year: 1042, weight: 'paragraph', text: 'The common was taken.', named: false },
    );
    for (const act of acts) noteBearing(ctx, act.kind, act.about, act.page);

    const before = ctx.world.chronicle.length;
    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    const echoes = ctx.world.chronicle.slice(before);
    expect(echoes).toHaveLength(acts.length);

    const expectedPage = (kind: BearingAct): string | undefined => {
      switch (kind) {
        case 'wrote_it_larger': return 'chr_source_lie';
        case 'bit_the_common': return 'chr_source_common';
        case 'refused_a_hand':
        case 'kept_her_back':
        case 'took_the_cousin':
          return undefined;
        default: {
          const exhaustive: never = kind;
          throw new Error(`unhandled Bearing act: ${String(exhaustive)}`);
        }
      }
    };

    for (let i = 0; i < acts.length; i++) {
      const act = acts[i]!;
      const echo = echoes[i]!;
      expect(echo.id, act.kind).toBeTruthy();
      expect(echo.cause?.year, act.kind).toBe(1042);
      expect(echo.cause?.page, act.kind).toBe(expectedPage(act.kind));
      expect(causeOf(ctx, echo.id!), act.kind).toEqual({
        year: 1042,
        ...(expectedPage(act.kind) ? { page: expectedPage(act.kind) } : {}),
        blank: false,
      });
    }
    expect(echoes[2]!.text).toContain('Ysabel');
    expect(answeredBy(ctx, 'chr_source_lie')).toEqual([1042 + ECHO_AFTER]);
    expect(answeredBy(ctx, 'chr_source_common')).toEqual([1042 + ECHO_AFTER]);
  });

  it('keeps an omitted source linkable without revealing words it does not contain', () => {
    const ctx = testWorld(content, 7014);
    ctx.world.year = 1100;
    ctx.world.chronicle.push({
      id: 'chr_omitted_origin',
      year: 1100,
      weight: 'paragraph',
      text: null,
      named: false,
      record: 'omit',
    });
    noteBearing(ctx, 'wrote_it_larger', 'a claim the house later omitted', 'chr_omitted_origin');

    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    const echo = ctx.world.chronicle.at(-1)!;
    expect(causeOf(ctx, echo.id!)).toEqual({
      year: 1100,
      page: 'chr_omitted_origin',
      blank: true,
    });
  });

  it('is stored as one reading the year, a client and a condition all share', () => {
    const ctx = testWorld(content, 7007);
    for (let i = 0; i < 20; i++) noteBearing(ctx, 'refused_a_hand');
    ctx.world.year = 1042 + REMEMBERED_AFTER + 100;
    expect(ctx.world.bearing.score).toBe(0);
    const read = tickBearing(ctx);
    expect(ctx.world.bearing.score).toBe(read.score);
  });
});

/**
 * STAGE 2, and the only bite there is meant to be yet: the world stops
 * offering.
 */
describe('the market answers it', () => {
  it('offers as it always did to a house that has kept its head down', () => {
    const ctx = testWorld(content, 7010);
    expect(marketAppetite(ctx)).toBe(1);
  });

  it('offers less as the house is remembered for more', () => {
    const ctx = testWorld(content, 7011);
    for (let i = 0; i < 40; i++) noteBearing(ctx, 'refused_a_hand');
    ctx.world.year = 1042 + REMEMBERED_AFTER + 100;
    tickBearing(ctx);
    expect(marketAppetite(ctx)).toBeLessThan(1);
  });

  /**
   * RULE 2: pride must usually be CORRECT. A hand with nothing on it is not a
   * decision, and a system that can empty the table is a tax the player will
   * find and route around. The house that has carried itself this way still
   * marries — it stops getting to choose.
   */
  it('never empties the table, however the house has carried itself', () => {
    const ctx = testWorld(content, 7012);
    // Straight to the worst reading there is. The acts alone cannot get here —
    // they are 0.6 of the weight — and that is deliberate: a house is read on
    // what it did AND on the halls it left angry and the seat it sat on.
    ctx.world.bearing.score = 1;
    expect(marketAppetite(ctx)).toBe(0);

    const her = place(ctx, { sex: 'female', age: 20, name: 'A Daughter To Marry' });
    const hand = dealMatch(ctx, her, makeRng(7012));
    expect(hand.cards.length, 'a hand with nothing on it is not a decision').toBeGreaterThan(0);
  });

  it('deals a full hand to a house nobody has anything to remember about', () => {
    const ctx = testWorld(content, 7013);
    const her = place(ctx, { sex: 'female', age: 20, name: 'A Daughter To Marry' });
    const open = dealMatch(ctx, her, makeRng(7013));

    ctx.world.bearing.score = 1;
    const thin = dealMatch(ctx, her, makeRng(7013));
    expect(thin.cards.length, 'the world offers a proud house no less than a modest one')
      .toBeLessThan(open.cards.length);
  });
});
