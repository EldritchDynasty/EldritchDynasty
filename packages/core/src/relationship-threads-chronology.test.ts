import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { activeRelationshipThreadHouses, addGrudge, bootstrap, externalThreadFor, place } from '@ed/core';

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
  it('does not activate an external house from a grudge whose origin is still in the future', () => {
    const ctx = bootstrap(bundle, 272301, 1042);
    const us = place(ctx, { sex: 'male', age: 40, name: 'A house member' });
    const rival = place(ctx, { sex: 'male', age: 40, name: 'A future rival', house: 'house_marrow' });
    const grudge = addGrudge(ctx, rival.id, us.id, { severity: 90, inheritance: 'none' }, 'ev_seal_feud');
    grudge.originYear = 1052;

    expect(externalThreadFor(ctx, 'house_marrow')).toBeUndefined();
    expect(activeRelationshipThreadHouses(ctx).has('house_marrow')).toBe(false);

    ctx.world.year = 1052;
    const thread = externalThreadFor(ctx, 'house_marrow');
    expect(thread?.pressures.filter((fact) => fact.kind === 'grudge').map((fact) => fact.ref)).toEqual([grudge.id]);
    expect(activeRelationshipThreadHouses(ctx).has('house_marrow')).toBe(true);
  });

  it('retains present grudge pressure and lets a stronger later grudge take precedence only at its origin', () => {
    const ctx = bootstrap(bundle, 272302, 1042);
    const us = place(ctx, { sex: 'male', age: 40, name: 'A house member' });
    const rival = place(ctx, { sex: 'male', age: 40, name: 'A rival', house: 'house_marrow' });
    const present = addGrudge(ctx, rival.id, us.id, { severity: 30, inheritance: 'none' }, 'ev_seal_feud');
    const future = addGrudge(ctx, rival.id, us.id, { severity: 90, inheritance: 'none' }, 'ev_seal_feud');
    future.originYear = 1052;

    const grievances = () => externalThreadFor(ctx, 'house_marrow')!.pressures.filter((fact) => fact.kind === 'grudge');
    expect(grievances().map((fact) => fact.ref)).toEqual([present.id]);
    expect(grievances()[0]?.year).toBe(1042);

    ctx.world.year = 1052;
    expect(grievances().map((fact) => fact.ref)).toEqual([future.id, present.id]);
    expect(grievances().map((fact) => fact.year)).toEqual([1052, 1042]);
  });

});
