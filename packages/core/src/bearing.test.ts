import { describe, expect, it } from 'vitest';
import { proseOriginalHash } from '@ed/schema';
import { loadContent } from '@ed/content';
import { bearingWordsIn } from '@ed/schema';
import {
  ECHO_AFTER, ECHO_SPACING, ECHO_VARIANTS, setProseMode, setProseVariants, REMEMBERED_AFTER, answeredBy, echoTally, echoText, bearingOf, causeOf, dealMatch, makeRng, marketAppetite, noteBearing, place,
  testWorld, tickBearing, type BearingAct,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

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
    noteBearing(ctx, 'wrote_it_larger', 'the page headed "The Black Stair"');
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
    expect(echoes.some((e) => e.includes('The Black Stair'))).toBe(true);
    expect(echoes.some((e) => e.includes('Ysabel'))).toBe(true);
    expect(echoes.some((e) => e.includes('West Mere'))).toBe(true);
    expect(ctx.world.bearing.score, 'the echo is presentation, not the bill').toBe(0);

    tickBearing(ctx);
    expect(ctx.world.chronicle, 'an origin echoes only once').toHaveLength(before + 3);

    ctx.world.year = 1042 + REMEMBERED_AFTER;
    tickBearing(ctx);
    expect(ctx.world.bearing.score, 'the existing bearing owner still resolves the bill').toBeGreaterThan(0);
  });

  /**
   * AN ECHO SAYS ONLY WHAT IS TRUE THE YEAR IT IS WRITTEN (issue #326).
   * It comes a generation before the act enters the reading, so no echo may
   * claim a consequence — the refused hand's once said the letters had
   * thinned, twenty-five years before the market dealt one card fewer.
   */
  it('writes its echo before the bill, and claims no consequence the bill has not paid', () => {
    expect(ECHO_AFTER).toBeLessThan(REMEMBERED_AFTER);
    const ctx = testWorld(content, 7011);
    ctx.world.year = 1042;
    noteBearing(ctx, 'refused_a_hand', 'the hand offered to Ysabel');
    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    const echo = ctx.world.chronicle.at(-1)!.text ?? '';
    expect(echo).toContain('Ysabel');
    expect(ctx.world.bearing.score, 'the refusal is not in the reading yet').toBe(0);
    for (let v = 0; v < ECHO_VARIANTS; v++) {
      const line = echoText(ctx, { year: 1042, kind: 'refused_a_hand', about: 'x' }, v);
      expect(line, 'an echo reports a thinner market the engine has not dealt').not.toMatch(/fewer|less|thinn|no longer/i);
    }
  });

  /**
   * ONE SENTENCE, NOT TWELVE (issue #326). A house that takes the cousin card
   * for every child of a generation used to hear "People still spoke of…"
   * once per marriage. A kind echoes at most once a generation, and its lines
   * rotate; an act held back is still billed, because the bill reads acts.
   */
  it('holds a cluster of one kind to one echo a generation, and still bills every act', () => {
    const ctx = testWorld(content, 7013);
    ctx.world.year = 1042;
    for (const who of ['Ysabel', 'Corran', 'Maud', 'Edric']) noteBearing(ctx, 'took_the_cousin', `${who} marrying a cousin`);
    const before = ctx.world.chronicle.length;
    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    expect(ctx.world.chronicle.length - before).toBe(1);
    expect(ctx.world.bearing.acts.every((a) => a.echoed), 'every act is acknowledged, held or written').toBe(true);
    expect(echoTally(ctx.world.bearing.acts)).toEqual({ written: 1, maxCopies: 1 });

    ctx.world.year = 1042 + REMEMBERED_AFTER;
    tickBearing(ctx);
    const one = testWorld(content, 7013);
    one.world.year = 1042;
    noteBearing(one, 'took_the_cousin', 'Ysabel marrying a cousin');
    one.world.year = 1042 + REMEMBERED_AFTER;
    expect(bearingOf(ctx).carriage, 'a held-back echo is not a forgiven act').toBeGreaterThan(bearingOf(one).carriage);
  });

  it('rotates a kind\'s lines across the generations it echoes in', () => {
    const ctx = testWorld(content, 7014);
    const lines: string[] = [];
    for (let i = 0; i < ECHO_VARIANTS + 1; i++) {
      ctx.world.year = 1042 + i * ECHO_SPACING;
      noteBearing(ctx, 'took_the_cousin', `marriage ${i}`);
      ctx.world.year += ECHO_AFTER;
      tickBearing(ctx);
      lines.push((ctx.world.chronicle.at(-1)!.text ?? '').replace(`marriage ${i}`, '*'));
    }
    expect(new Set(lines.slice(0, ECHO_VARIANTS)).size, 'each generation hears a different line').toBe(ECHO_VARIANTS);
    expect(lines[ECHO_VARIANTS], 'and the rotation comes round').toBe(lines[0]);
    expect(echoTally(ctx.world.bearing.acts)).toEqual({ written: ECHO_VARIANTS + 1, maxCopies: 2 });
  });

  it('never names bearing in an echo (concept §29 rule 1, the prose/bearing vocabulary)', () => {
    // A Record keyed by the union, so the compiler holds this to every act kind.
    const every: Record<BearingAct, true> = {
      wrote_it_larger: true, refused_a_hand: true, kept_her_back: true, took_the_cousin: true, bit_the_common: true,
    };
    const ctx = testWorld(content);
    for (const kind of Object.keys(every) as BearingAct[]) {
      for (let v = 0; v < ECHO_VARIANTS; v++) {
        expect(bearingWordsIn(echoText(ctx, { year: 1100, kind, about: 'the matter' }, v)), `${kind} #${v}`).toEqual([]);
      }
    }
  });

  it('names the year, never a generic "old decision", when an act carries no subject', () => {
    const ctx = testWorld(content, 7012);
    ctx.world.year = 1077;
    noteBearing(ctx, 'bit_the_common');
    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    const echo = ctx.world.chronicle.at(-1)!.text ?? '';
    expect(echo).toContain('1077');
    expect(echo).not.toMatch(/old decision/);
  });

  it('links every delayed echo back to the act it answers, exhaustively', () => {
    const ctx = testWorld(content, 7009);
    ctx.world.year = 1042;

    const acts: { kind: BearingAct; about: string; page?: string }[] = [
      { kind: 'wrote_it_larger', about: 'the page headed "The Salt Account"', page: 'chr_source_lie' },
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

describe('the echo lines speak the reader\'s setting (#756)', () => {
  const KINDS: BearingAct[] = ['wrote_it_larger', 'refused_a_hand', 'took_the_cousin', 'bit_the_common', 'kept_her_back'];
  const ORIGINAL: Record<string, string> = {
    'bearing.echo.wrote_it_larger.0': 'A copy kept elsewhere still named the page, and did not tell it quite as the house had.',
    'bearing.echo.wrote_it_larger.1': "A clerk from another house asked about the page, and wrote down an answer that was not the house's.",
    'bearing.echo.wrote_it_larger.2': "The page was read aloud at somebody else's table, from somebody else's copy.",
    'bearing.echo.refused_a_hand.0': 'A matchmaker remembered the page, and said as much to the next house that asked.',
    'bearing.echo.refused_a_hand.1': 'The page was still told in the market towns, by people who had not been in the room.',
    'bearing.echo.refused_a_hand.2': "An old broker's book still had a line against the page.",
    'bearing.echo.took_the_cousin.0': 'People still spoke of the page: the outside hand had been there, and the house had chosen its own blood.',
    'bearing.echo.took_the_cousin.1': "At a wedding in another hall somebody's aunt brought up the page, and nobody changed the subject.",
    'bearing.echo.took_the_cousin.2': 'The page was the example a priest reached for, a generation on, when a family asked him about cousins.',
    'bearing.echo.bit_the_common.0': "At the page, old boundary stones were still pointed out in the village, though the house's map had moved on.",
    'bearing.echo.bit_the_common.1': 'Children at the page still walked the old line on feast days, the way their grandparents had.',
    'bearing.echo.bit_the_common.2': "A tenant's widow at the page still called the field by the name it had before the house took it.",
    'bearing.echo.kept_her_back.0': 'The market had not forgotten the page, who had been kept from it when a hand might still have been made.',
    'bearing.echo.kept_her_back.1': 'A broker asked after the page a generation late, as if the offer might still stand.',
    'bearing.echo.kept_her_back.2': 'The page came up in a letter from another house, as the daughter this one had kept at home.',
  };

  it('keeps every echo Original byte for byte, in both casings of its subject', () => {
    const ctx = testWorld(content);
    for (const kind of KINDS) {
      for (let v = 0; v < ECHO_VARIANTS; v++) {
        expect(echoText(ctx, { year: 1100, kind, about: 'the page' }, v)).toBe(ORIGINAL[`bearing.echo.${kind}.${v}`]);
      }
    }
    expect(echoText(ctx, { year: 1100, kind: 'refused_a_hand' }, 0))
      .toBe('A matchmaker remembered what the house did in 1100, and said as much to the next house that asked.');
  });

  it('renders the reviewed Plain English for the chosen line, and keeps it', () => {
    const ctx = testWorld(content, 7015);
    // Every variant keeps its tokens: the plain line names the subject the same way the Original does.
    const original = (kind: BearingAct, v: number) => ORIGINAL[`bearing.echo.${kind}.${v}`]!
      .replace('The page', '{ABOUT_CAP}').replace('the page', '{ABOUT}');
    setProseVariants(ctx, [
      ...KINDS.flatMap((kind) => [0, 1, 2].map((v) => ({
        address: coreMessageAddress(`bearing.echo.${kind}.${v}`),
        of: proseOriginalHash(original(kind, v)),
        plainenglish: original(kind, v).includes('{ABOUT_CAP}')
          ? `{ABOUT_CAP} was still talked about (${kind} ${v}).`
          : `People still talked about {ABOUT} (${kind} ${v}).`,
      }))),
      { address: coreMessageAddress('bearing.about_year'), of: proseOriginalHash('what the house did in {YEAR}'), plainenglish: "the family's actions in {YEAR}" },
    ]);
    setProseMode(ctx, 'plainenglish');
    expect(echoText(ctx, { year: 1100, kind: 'took_the_cousin', about: 'the page' }, 2))
      .toBe('The page was still talked about (took_the_cousin 2).');
    expect(echoText(ctx, { year: 1100, kind: 'refused_a_hand' }, 0))
      .toBe("People still talked about the family's actions in 1100 (refused_a_hand 0).");

    ctx.world.year = 1042;
    noteBearing(ctx, 'kept_her_back', 'Ysabel');
    ctx.world.year += ECHO_AFTER;
    tickBearing(ctx);
    const page = ctx.world.chronicle.at(-1)!;
    expect(page.text).toBe('People still talked about Ysabel (kept_her_back 0).');
    expect(page.echoFrame).toBe('bearing:kept_her_back:0');
    setProseMode(ctx, 'original');
    expect(page.text).toBe('People still talked about Ysabel (kept_her_back 0).');
  });
});
