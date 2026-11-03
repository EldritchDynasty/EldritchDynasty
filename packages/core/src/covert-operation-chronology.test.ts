import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { addGrudge } from './people/relationships.js';
import { covertOpportunities, quoteCovertOperation } from './covert-operations.js';
import { place, testWorld } from './testing.js';

const content = loadContent();

describe('covert operative willingness follows grudge origin dates (#2727)', () => {
  function scene() {
    const ctx = testWorld(content, 272701);
    ctx.world.relationships.clear();
    ctx.world.treasury = 1000;
    const target = ctx.world.people.living().find(p => p.castSlots.includes('rival'))!;
    const operative = place(ctx, { sex: 'female', age: 30, name: 'The prospective operative' });
    addGrudge(ctx, ctx.world.playerHouse, target.id, { severity: 75, inheritance: 'house_wide' });
    const opportunity = covertOpportunities(ctx).find(o => o.target.id === target.id)!;
    expect(opportunity).toBeDefined();
    const order = {
      opportunity: opportunity.id, operative: operative.id,
      purpose: 'settle_grudge' as const, preparation: 'hasty' as const,
    };
    expect(quoteCovertOperation(ctx, order).ok).toBe(true);
    return { ctx, operative, order };
  }

  it('ignores a stronger future grievance until it originates, without mutating that grievance', () => {
    const { ctx, operative, order } = scene();
    const weak = addGrudge(ctx, operative.id, ctx.world.playerHouse,
      { severity: 30, inheritance: 'none' });
    const future = addGrudge(ctx, operative.id, ctx.world.playerHouse,
      { severity: 80, inheritance: 'none' });
    const origin = ctx.world.year + 10;
    future.originYear = origin;

    expect(quoteCovertOperation(ctx, order).ok).toBe(true);
    expect(quoteCovertOperation(ctx, order).ok).toBe(true);
    expect(future.originYear).toBe(origin);
    expect(weak.originYear).toBe(ctx.world.year);

    ctx.world.year = origin;
    const quote = quoteCovertOperation(ctx, order);
    expect(quote.ok).toBe(false);
    expect(quote.reason).toBeDefined();
    expect(future.originYear).toBe(origin);
  });

  it('still refuses an operative who holds a present-year severe grievance', () => {
    const { ctx, operative, order } = scene();
    addGrudge(ctx, operative.id, ctx.world.playerHouse,
      { severity: 70, inheritance: 'none' });
    expect(quoteCovertOperation(ctx, order).ok).toBe(false);
  });
});
