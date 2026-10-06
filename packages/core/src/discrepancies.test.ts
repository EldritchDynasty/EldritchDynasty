import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { BranchId, BranchState } from '@ed/schema';
import { asId, RESPECT_ORDER } from '@ed/schema';
import {
  applyEffect, evalCondition, grantHeirloom, place, selectEvents, testRng, testWorld,
} from '@ed/core';

const bundle = loadContent();

describe('the discrepancy condition', () => {
  it('checks existence, exact state, and the open aggregate', () => {
    const ctx = testWorld(bundle);
    expect(evalCondition({ discrepancy: 'x' }, ctx)).toBe(false);
    expect(evalCondition({ openDiscrepancies: { op: 'gte', value: 1 } }, ctx)).toBe(false);

    ctx.world.discrepancies.set('x', { severity: 'minor', provableBy: [], state: 'open' });
    ctx.world.discrepancies.set('y', { severity: 'minor', provableBy: [], state: 'proven' });

    expect(evalCondition({ discrepancy: 'x' }, ctx)).toBe(true);
    expect(evalCondition({ discrepancy: 'x', state: 'open' }, ctx)).toBe(true);
    expect(evalCondition({ discrepancy: 'x', state: 'proven' }, ctx)).toBe(false);
    expect(evalCondition({ openDiscrepancies: { op: 'gte', value: 1 } }, ctx)).toBe(true);
    expect(evalCondition({ openDiscrepancies: { op: 'gte', value: 2 } }, ctx)).toBe(false);
  });
});

describe('proving and burying a Discrepancy', () => {
  it('proving costs one Respect tier and records the change year', () => {
    const ctx = testWorld(bundle);
    ctx.world.discrepancies.set('x', { severity: 'minor', provableBy: [], state: 'open' });
    ctx.world.respect = 'eminent';

    applyEffect({ kind: 'discrepancy', op: 'prove', id: 'x' }, ctx, {});

    expect(ctx.world.discrepancies.get('x')?.state).toBe('proven');
    expect(RESPECT_ORDER.indexOf(ctx.world.respect)).toBe(RESPECT_ORDER.indexOf('eminent') - 1);
    expect(ctx.world.respectChanged).toBe(ctx.world.year);
  });

  it('never drops below the Respect floor', () => {
    const ctx = testWorld(bundle);
    ctx.world.discrepancies.set('x', { severity: 'minor', provableBy: [], state: 'open' });
    ctx.world.respect = 'unknown';

    applyEffect({ kind: 'discrepancy', op: 'prove', id: 'x' }, ctx, {});
    expect(ctx.world.respect).toBe('unknown');
  });

  it('burying changes state without moving Respect', () => {
    const ctx = testWorld(bundle);
    ctx.world.discrepancies.set('x', { severity: 'minor', provableBy: [], state: 'open' });
    ctx.world.respect = 'eminent';

    applyEffect({ kind: 'discrepancy', op: 'bury', id: 'x' }, ctx, {});

    expect(ctx.world.discrepancies.get('x')?.state).toBe('buried');
    expect(ctx.world.respect).toBe('eminent');
  });

  it('does nothing to an id that was never created', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'eminent';

    applyEffect({ kind: 'discrepancy', op: 'prove', id: 'never_created' }, ctx, {});

    expect(ctx.world.discrepancies.has('never_created')).toBe(false);
    expect(ctx.world.respect).toBe('eminent');
  });
});

describe('heirloom transfer', () => {
  it('removes a held heirloom and tolerates one the house never held', () => {
    const ctx = testWorld(bundle);
    const id = bundle.heirlooms[0]!.id;
    grantHeirloom(ctx, id);

    applyEffect({ kind: 'heirloom', op: 'transfer', heirloom: id }, ctx, {});
    expect(ctx.world.heirlooms.has(id)).toBe(false);

    expect(() =>
      applyEffect({ kind: 'heirloom', op: 'transfer', heirloom: 'nothing_the_house_owns' }, ctx, {}),
    ).not.toThrow();
  });
});

describe('the PRESSURE selection pass', () => {
  it('draws state-gated content ahead of the ambient lottery once the state holds', () => {
    let sawPressure = 0;
    for (let trial = 0; trial < 12; trial++) {
      const ctx = testWorld(bundle, 2000 + trial, 1042);
      ctx.world.generation = 1;
      const head = place(ctx, { sex: 'male', age: 45, castSlots: ['head'] });
      const cousin = place(ctx, { sex: 'male', age: 30 });
      cousin.membership[0]!.kind = 'cadet';

      const branchId = asId<BranchId>(`br_test_${trial}`);
      const branch: BranchState = {
        id: branchId,
        name: 'Test Branch',
        house: head.houseOfOrigin,
        founder: cousin.id,
        splitFrom: 'main',
        foundedYear: ctx.world.year - 10,
        grievance: 60,
      };
      ctx.world.branches.set(branchId, branch);

      const candidates = selectEvents(ctx, testRng('pressure', trial), 1);
      if (candidates.some((c) =>
        c.event.id === 'the_accounts_of_the_smaller_house' && c.source === 'pressure'
      )) sawPressure += 1;
    }

    expect(sawPressure, 'never drew the grievance-gated event as pressure in 12 deterministic trials')
      .toBeGreaterThan(0);
  });
});
