import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { quoteCommission, quoteHire } from './mystic-contracts.js';
import { addGrudge } from './people/relationships.js';
import { place, testWorld } from './testing.js';

const content = loadContent();

describe('outside Mystic willingness respects grudge origin years (#2729)', () => {
  function scene() {
    const ctx = testWorld(content, 272901);
    ctx.world.treasury = 1000;
    const p = place(ctx, { sex: 'female', age: 30, name: 'The warranted reader', awakened: true });
    p.spellsKnown = [asId('lesser_workings_of_death'), asId('greater_workings_of_death')];
    p.membership = [{ house: asId('house_calder'), kind: 'blood', from: ctx.world.year }];
    p.traits.add(asId('colleges_warrant'));
    ctx.world.mystic.contacts.push(p.id);

    const book = 'lesser_workings_of_death';
    ctx.world.library.set(book, { id: book, acquiredYear: ctx.world.year, condition: 80 });
    const hire = { person: p.id, working: 'the_still_binding', target: { kind: 'book' as const, book } };
    const commission = () => quoteCommission(ctx, p.id, 'the_funeral_contract', 'house_marrow');
    expect(quoteHire(ctx, hire).ok).toBe(true);
    expect(commission().ok).toBe(true);
    return { ctx, p, hire, commission };
  }

  it('keeps hire and commission offers available until a severe future grudge actually begins', () => {
    const { ctx, p, hire, commission } = scene();
    const weak = addGrudge(ctx, p.id, ctx.world.playerHouse,
      { severity: 25, inheritance: 'none' });
    const future = addGrudge(ctx, p.id, ctx.world.playerHouse,
      { severity: 70, inheritance: 'none' });
    const origin = ctx.world.year + 10;
    future.originYear = origin;
    const treasury = ctx.world.treasury;

    expect(quoteHire(ctx, hire).ok).toBe(true);
    expect(commission().ok).toBe(true);
    expect(quoteHire(ctx, hire).ok).toBe(true);
    expect(weak.originYear).toBe(ctx.world.year);
    expect(future.originYear).toBe(origin);
    expect(ctx.world.treasury).toBe(treasury);

    ctx.world.year = origin;
    expect(quoteHire(ctx, hire).ok).toBe(false);
    expect(commission().ok).toBe(false);
    expect(future.originYear).toBe(origin);
  });

  it('still refuses a reader who already holds severe hostility to the house', () => {
    const { ctx, p, hire, commission } = scene();
    addGrudge(ctx, p.id, ctx.world.playerHouse, { severity: 75, inheritance: 'none' });
    expect(quoteHire(ctx, hire).ok).toBe(false);
    expect(commission().ok).toBe(false);
  });
});
