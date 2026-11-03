import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { addGrudge, bootstrap, externalThreadFor, place } from '@ed/core';

const bundle = loadContent();

describe('external relationship threads respect Chronicle page dates (#2687)', () => {
  it('does not name a grudge from future testimony before the page exists', () => {
    const ctx = bootstrap(bundle, 268701, 1042);
    const us = place(ctx, { sex: 'male', age: 40, name: 'One of ours' });
    const rival = place(ctx, { sex: 'male', age: 40, name: 'A rival', house: 'house_marrow' });
    const grudge = addGrudge(ctx, rival.id, us.id, { severity: 70, inheritance: 'none' }, 'ev_seal_feud');
    grudge.originPage = 'future-quarrel';
    ctx.world.chronicle.push({
      id: 'future-quarrel', year: 1052, weight: 'paragraph', named: false,
      title: 'The Unwritten Accusation', text: 'An allegation not made yet.',
    });

    const read = () => externalThreadFor(ctx, 'house_marrow')!.pressures
      .find((fact) => fact.kind === 'grudge')!.detail;
    expect(read()).toContain('the quarrel');
    expect(read()).not.toContain('The Unwritten Accusation');

    ctx.world.year = 1052;
    expect(read()).toContain('The Unwritten Accusation');
  });

  it('does not disclose the title or future date of an open disputed page', () => {
    const ctx = bootstrap(bundle, 268702, 1042);
    ctx.world.discrepancies.set('future-account', {
      severity: 'minor', state: 'open', provableBy: ['house_marrow'],
    });
    ctx.world.chronicle.push({
      id: 'future-dispute', year: 1052, weight: 'paragraph', named: false,
      title: 'The Accusation Not Yet Written', text: 'A later accusation.',
      discrepancyId: 'future-account',
    });

    const read = () => externalThreadFor(ctx, 'house_marrow')!.pressures
      .find((fact) => fact.kind === 'record')!;
    expect(read().detail).toContain('a disputed 1042 entry');
    expect(read().detail).not.toContain('The Accusation Not Yet Written');
    expect(read().year).toBe(1042);

    ctx.world.year = 1052;
    expect(read().detail).toContain('The Accusation Not Yet Written');
    expect(read().year).toBe(1052);
  });
});
