import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import type { SimCtx } from '@ed/core';
import { coreMessageAddress } from './messages.js';
import {
  applyEffect, attr, bootstrap, place, setProseMode, setProseVariants, tickEconomy, tickRespect,
} from '@ed/core';

const bundle = loadContent();

describe('acquired attributes are durable state', () => {
  it('survives a year boundary and accumulates', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const person = ctx.world.people.living()[0]!;
    const before = attr(person, 'strength', ctx.genetics, ctx.world.year);

    applyEffect({ kind: 'attribute', target: 'household', attr: 'strength', delta: 5 }, ctx, {});
    applyEffect({ kind: 'attribute', target: 'household', attr: 'strength', delta: 7 }, ctx, {});
    expect(attr(person, 'strength', ctx.genetics, ctx.world.year)).toBeCloseTo(before + 12, 5);

    ctx.world.year += 1;
    expect(attr(person, 'strength', ctx.genetics, ctx.world.year)).toBeCloseTo(before + 12, 5);
  });
});

describe('annual economy rules', () => {
  it('produces both income and upkeep', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const report = tickEconomy(ctx);
    expect(report.income).toBeGreaterThan(0);
    expect(report.upkeep).toBeGreaterThan(0);
  });

  it('diverts land income during an unbought Wardship and restores it after buyback', () => {
    const normal = bootstrap(bundle, 1042, 1042);
    expect(tickEconomy(normal).income).toBeGreaterThan(0);

    const warded = bootstrap(bundle, 1042, 1042);
    warded.world.wardship = {
      ward: warded.world.people.living()[0]!.id,
      since: warded.world.year,
    };
    expect(tickEconomy(warded).income).toBe(0);

    warded.world.wardship.boughtBack = true;
    expect(tickEconomy(warded).income).toBeGreaterThan(0);
  });

  it('makes extra working adults productive while still increasing upkeep', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const before = tickEconomy(ctx);

    for (let i = 0; i < 10; i++) {
      place(ctx, {
        sex: i % 2 === 0 ? 'male' : 'female',
        age: 30,
        name: `Worker ${i}`,
      });
    }
    const after = tickEconomy(ctx);

    expect(after.labour).toBeGreaterThan(before.labour);
    expect(after.upkeep).toBeGreaterThan(before.upkeep);
    expect((before.net - after.net) / 10).toBeLessThan(1);
  });

  it('charges more upkeep at higher Respect', () => {
    const ordinary = bootstrap(bundle, 1042, 1042);
    const grand = bootstrap(bundle, 1042, 1042);
    grand.world.respect = 'exalted';

    expect(tickEconomy(grand).upkeep).toBeGreaterThan(tickEconomy(ordinary).upkeep);
  });
});

/**
 * A Respect slip is a Chronicle artefact: the words must be selected when
 * written, not read back using the player's current prose preference.
 */
describe('Respect-slip Chronicle messages', () => {
  const reasons = {
    madness: 'of what people had started to say about the son in the east rooms',
    quiet: 'nothing had been done in thirty years worth telling anyone about',
    debt: 'the house was visibly broke, and everybody could see it',
  } as const;
  const plainReasons = {
    madness: 'People were talking about the son in the east rooms, so the house lost standing.',
    quiet: 'The house had done nothing worth reporting in thirty years, so it lost standing.',
    debt: 'Everyone could see the house had no money, so it lost standing.',
  } as const;
  type Cause = keyof typeof reasons;

  function atTheEdge(cause: Cause): SimCtx {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'regarded';
    ctx.world.respectChanged = ctx.world.year;
    if (cause === 'madness') {
      // The visible-Madness check fires on years divisible by five.
      ctx.world.year = 1045;
      ctx.world.respectChanged = ctx.world.year;
      ctx.world.people.living()[0]!.madness = 100;
    } else if (cause === 'quiet') {
      ctx.world.respectChanged = ctx.world.year - 45;
    } else {
      ctx.world.treasury = -1_000;
    }
    return ctx;
  }

  for (const cause of ['madness', 'quiet', 'debt'] as const) {
    it(`preserves Original and freezes Plain English for ${cause} without changing the economy`, () => {
      const original = atTheEdge(cause);
      const plain = atTheEdge(cause);
      const template = `The house was {TIER} and then it was not, because ${reasons[cause]}. Nobody announced it. It was simply the case by the following spring.`;
      const alternative = `The house used to be {TIER}. ${plainReasons[cause]} By the following spring, everyone knew.`;

      setProseVariants(plain, [
        {
          address: coreMessageAddress('respect.slip.title'),
          of: proseOriginalHash('They Were Spoken Of Differently'),
          plainenglish: 'The House Lost Respect',
        },
        {
          address: coreMessageAddress(`respect.slip.${cause}`),
          of: proseOriginalHash(template),
          plainenglish: alternative,
        },
      ]);
      setProseMode(plain, 'plainenglish');

      if (cause === 'debt') {
        tickEconomy(original);
        tickEconomy(plain);
      } else {
        tickRespect(original);
        tickRespect(plain);
      }

      const originalPage = original.world.chronicle.at(-1);
      const plainPage = plain.world.chronicle.at(-1);
      expect(originalPage).toMatchObject({
        title: 'They Were Spoken Of Differently',
        text: template.replace('{TIER}', 'regarded'),
        weight: 'paragraph',
        named: false,
      });
      expect(plainPage).toMatchObject({
        title: 'The House Lost Respect',
        text: alternative.replace('{TIER}', 'regarded'),
        weight: 'paragraph',
        named: false,
      });
      expect(original.world.respect).toBe('known');
      expect(plain.world.respect).toBe(original.world.respect);
      expect(plain.world.respectChanged).toBe(original.world.respectChanged);
      expect(plain.world.discontent).toBe(original.world.discontent);
      expect(plain.world.treasury).toBe(original.world.treasury);

      setProseMode(plain, 'original');
      expect(plain.world.chronicle.at(-1)).toEqual(plainPage);
      expect(plain.world.chronicle.at(-1)?.text).toBe(alternative.replace('{TIER}', 'regarded'));
    });
  }

  it('does not slip below the Known floor or write a new page', () => {
    const ctx = atTheEdge('quiet');
    ctx.world.respect = 'known';
    tickRespect(ctx);
    expect(ctx.world.respect).toBe('known');
    expect(ctx.world.chronicle.at(-1)?.title).not.toBe('They Were Spoken Of Differently');
  });
});
