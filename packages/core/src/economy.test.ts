import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyEffect, attr, bootstrap, place, tickEconomy,
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
