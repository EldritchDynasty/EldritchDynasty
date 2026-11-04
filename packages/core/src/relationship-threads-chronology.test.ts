import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { activeRelationshipThreadHouses, addGrudge, bootstrap, digestOf, externalThreadFor, growRivalLineage, place } from '@ed/core';

const bundle = loadContent();

describe('external relationship threads respect present-year evidence (#2687, #2723)', () => {
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
    expect(future.originYear).toBe(1052);

    ctx.world.year = 1052;
    expect(grievances().map((fact) => fact.ref)).toEqual([future.id, present.id]);
    expect(grievances().map((fact) => fact.year)).toEqual([1052, 1042]);
  });
});

describe('recovered external relationship facts are only active in their own year (#2890–#2892)', () => {
  it('does not recall a rival courtship before the saved offer or the rival\'s birth (#2890)', () => {
    const ctx = bootstrap(bundle, 289001, 1042);
    growRivalLineage(ctx, 'house_hesk');
    const rival = ctx.world.rivalLineages.get('house_hesk')!.people[0]!;
    rival.born = 1020;
    rival.died = undefined;
    rival.left = undefined;
    rival.spouse = undefined;
    rival.courtship = { template: 'suitor_of_hesk', name: 'A future introduction', seed: 1, offered: 1052 };

    expect(activeRelationshipThreadHouses(ctx).has('house_hesk')).toBe(false);
    const before = digestOf(ctx);
    expect(externalThreadFor(ctx, 'house_hesk')).toBeUndefined();
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = 1052;
    expect(externalThreadFor(ctx, 'house_hesk')?.pressures.some((f) => f.kind === 'courtship' && f.year === 1052)).toBe(true);
    rival.born = 1053;
    expect(externalThreadFor(ctx, 'house_hesk')).toBeUndefined();
    ctx.world.year = 1053;
    expect(externalThreadFor(ctx, 'house_hesk')?.pressures.some((f) => f.kind === 'courtship')).toBe(true);

    // A recovered future death or departure must not erase today's Match memory.
    rival.born = 1020;
    rival.died = 1055;
    ctx.world.year = 1054;
    expect(externalThreadFor(ctx, 'house_hesk')?.pressures.some((f) => f.kind === 'courtship')).toBe(true);
    ctx.world.year = 1055;
    expect(externalThreadFor(ctx, 'house_hesk')).toBeUndefined();
    rival.died = undefined;
    rival.left = 1057;
    ctx.world.year = 1056;
    expect(externalThreadFor(ctx, 'house_hesk')?.pressures.some((f) => f.kind === 'courtship')).toBe(true);
    ctx.world.year = 1057;
    expect(externalThreadFor(ctx, 'house_hesk')).toBeUndefined();
  });

  it('does not name an unjoined or unborn married-in relative until the boundary (#2890)', () => {
    const ctx = bootstrap(bundle, 289002, 1042);
    const spouse = place(ctx, { sex: 'female', age: 27, name: 'Future spouse', house: 'house_marrow' });
    spouse.membership.push({ house: asId(ctx.world.playerHouse), kind: 'married_in', from: 1052 });
    const family = () => externalThreadFor(ctx, 'house_marrow')?.pressures.some((f) => f.kind === 'family') ?? false;

    expect(family()).toBe(false);
    ctx.world.year = 1052;
    expect(family()).toBe(true);

    spouse.born = 1057; // inconsistent recovered row: alive before its birth
    expect(family()).toBe(false);
    ctx.world.year = 1057;
    expect(family()).toBe(true);
    expect(spouse.membership.at(-1)?.from).toBe(1052);

    // Saved death status can refer to a loss later than the year now being read.
    spouse.born = 1020;
    spouse.status = 'dead';
    spouse.died = 1060;
    ctx.world.year = 1059;
    expect(family()).toBe(true);
    ctx.world.year = 1060;
    expect(family()).toBe(false);
  });

  it('waits for a carried secret, then retains pressure until an actual telling (#2891)', () => {
    const ctx = bootstrap(bundle, 289101, 1042);
    ctx.world.looseSecrets = [{
      secret: 'what_the_archive_holds', carrier: 'p_gone', carrierName: 'Ilsabet',
      house: 'house_marrow', since: 1052, severity: 'minor', told: 1062,
    }];
    const carried = () => externalThreadFor(ctx, 'house_marrow')?.pressures.some((f) => f.kind === 'secret') ?? false;
    const before = digestOf(ctx);
    expect(carried()).toBe(false);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = 1052;
    expect(carried()).toBe(true);
    ctx.world.year = 1061;
    expect(carried()).toBe(true);
    ctx.world.year = 1062;
    expect(carried()).toBe(false);
    expect(ctx.world.looseSecrets[0]).toMatchObject({ since: 1052, told: 1062 });
  });

  it('does not recall an auction before its announcement, even if persisted early (#2892)', () => {
    const ctx = bootstrap(bundle, 289201, 1042);
    ctx.world.auction.upcoming = [{
      id: 'future_lot', kind: 'heirloom', refId: 'portion_of_agelessness',
      house: 'house_marrow', announcedYear: 1052, saleYear: 1055, reserveCoin: 800,
    }];
    const auction = () => externalThreadFor(ctx, 'house_marrow')?.pressures.find((f) => f.kind === 'auction');
    const before = digestOf(ctx);
    expect(auction()).toBeUndefined();
    expect(digestOf(ctx)).toBe(before);
    ctx.world.year = 1052;
    expect(auction()?.year).toBe(1052);
    ctx.world.year = 1055;
    expect(auction()?.year).toBe(1052);
    ctx.world.year = 1056;
    expect(auction()).toBeUndefined();
    expect(ctx.world.auction.upcoming).toHaveLength(1);
  });

  it('does not count a saved marriage promise until it has been pledged (#2892)', () => {
    const ctx = bootstrap(bundle, 289202, 1042);
    const head = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.castSlots.includes('head'))!;
    ctx.world.marriagePromises = [{
      toHouse: 'house_marrow', year: 1052, lot: 'portion_of_agelessness', pledgedBy: head.id,
    }];
    const promise = () => externalThreadFor(ctx, 'house_marrow')?.pressures.find((f) => f.kind === 'marriage_promise');
    expect(promise()).toBeUndefined();
    ctx.world.year = 1052;
    expect(promise()?.year).toBe(1052);
    ctx.world.year = 1053;
    expect(promise()?.year).toBe(1052);
  });
});
