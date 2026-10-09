import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  applyEffect, attr, bootstrap, DEBT_FLOOR, place, setProseMode, setProseVariants, testWorld, tickEconomy,
  tickRespect,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

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

describe('the Respect-slip page speaks the reader\'s setting (#741)', () => {
  const TAIL = ' Nobody announced it. It was simply the case by the following spring.';
  const ORIGINALS: Record<string, [string, string]> = {
    'respect.slip_title': ['They Were Spoken Of Differently', 'The Family Lost Standing'],
    'respect.slip.madness': [
      'The house was {TIER} and then it was not, because of what people had started to say about the son in the east rooms.' + TAIL,
      'The family stopped being {TIER} because of rumours about the mad son kept in the east rooms.',
    ],
    'respect.slip.quiet': [
      'The house was {TIER} and then it was not, because nothing had been done in thirty years worth telling anyone about.' + TAIL,
      'The family stopped being {TIER} because it had done nothing worth talking about for thirty years.',
    ],
    'respect.slip.broke': [
      'The house was {TIER} and then it was not, because the house was visibly broke, and everybody could see it.' + TAIL,
      'The family stopped being {TIER} because everyone could see it had no money.',
    ],
  };

  /** An eminent house given one reason to slip, then ticked. */
  function slipFor(cause: 'madness' | 'quiet' | 'broke', mode: 'original' | 'plainenglish') {
    const ctx = testWorld(bundle);
    setProseVariants(ctx, Object.entries(ORIGINALS).map(([key, [original, plain]]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
    })));
    setProseMode(ctx, mode);
    const w = ctx.world;
    w.year = Math.ceil(w.year / 5) * 5;
    w.respect = 'eminent';
    w.respectChanged = cause === 'quiet' ? w.year - 100 : w.year;
    if (cause === 'madness') place(ctx, { sex: 'male', age: 30, name: 'Oswin' }).madness = 90;
    if (cause === 'broke') {
      w.treasury = DEBT_FLOOR - 500;
      tickEconomy(ctx);
    } else {
      tickRespect(ctx);
    }
    const pages = w.chronicle.filter((e) => e.title === ORIGINALS['respect.slip_title']![mode === 'original' ? 0 : 1]);
    expect(pages).toHaveLength(1);
    return { ctx, page: pages[0]! };
  }

  for (const cause of ['madness', 'quiet', 'broke'] as const) {
    it(`renders the ${cause} page in both settings, Original byte for byte`, () => {
      const original = slipFor(cause, 'original');
      expect(original.page.text).toBe(ORIGINALS[`respect.slip.${cause}`]![0].replace('{TIER}', 'eminent'));
      expect(original.ctx.world.respect).toBe('regarded');

      const plain = slipFor(cause, 'plainenglish');
      expect(plain.page.text).toBe(ORIGINALS[`respect.slip.${cause}`]![1].replace('{TIER}', 'eminent'));
      expect(plain.ctx.world.respect).toBe(original.ctx.world.respect);
      expect(plain.ctx.world.respectChanged).toBe(original.ctx.world.respectChanged);
      expect(plain.ctx.world.discontent).toBe(original.ctx.world.discontent);

      setProseMode(plain.ctx, 'original');
      expect(plain.page.title).toBe('The Family Lost Standing');
    });
  }
});
