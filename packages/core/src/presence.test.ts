import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { place, testWorld } from './testing.js';
import { covertParticipants, covertReservation, deployedPeople, dutyPlaceOf, resolvePresence, serviceReservation } from './presence.js';

const content = loadContent();
describe('physical attendance (#1868)', () => {
  it('separates halls, named visitors, deployed officers and away careers', () => {
    const ctx = testWorld(content);
    const home = place(ctx, { sex: 'male', age: 30 });
    const cadet = place(ctx, { sex: 'male', age: 30, branch: 'cadet_hall' });
    const court = place(ctx, { sex: 'male', age: 30, career: { career: 'court' } });
    const officer = place(ctx, { sex: 'male', age: 30 });
    ctx.world.muster.commitments.push({ id: 'field', began: ctx.world.year, age: 'the_wars', men: 10, from: {}, officers: [officer.id], credit: 0, status: 'in_the_field' });
    const fill = { VISITOR: cadet.id, COURT: court.id, OFFICER: officer.id };
    const main = resolvePresence(ctx, { kind: 'hall', hall: 'main' }, fill).people;
    expect(main).toContain(home.id);
    expect(main).not.toContain(cadet.id);
    expect(main).not.toContain(court.id);
    expect(main).not.toContain(officer.id);
    expect(resolvePresence(ctx, { kind: 'hall', hall: 'main', visitors: ['VISITOR'] }, fill).people).toContain(cadet.id);
    expect(resolvePresence(ctx, { kind: 'hall', hall: { slot: 'VISITOR' } }, fill).people).toEqual([cadet.id]);
    expect(resolvePresence(ctx, { kind: 'muster' }, fill).people).toEqual([officer.id]);
    expect(resolvePresence(ctx, { kind: 'elsewhere', slots: ['COURT'] }, fill).people).toEqual([court.id]);
  });

  it('uses exactly a declared party, deduplicates it, and never falls back on missing locations', () => {
    const ctx = testWorld(content);
    const a = place(ctx, { sex: 'male', age: 30 });
    const b = place(ctx, { sex: 'male', age: 30 });
    const hostage = place(ctx, { sex: 'male', age: 30 });
    hostage.membership[0]!.kind = 'hostage';
    const missing = place(ctx, { sex: 'male', age: 30 }); missing.status = 'missing';
    const foreign = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
    const fill = { PARTY: [a.id, a.id, b.id, hostage.id, missing.id], AGAIN: b.id, FOREIGN: foreign.id };
    expect(resolvePresence(ctx, { kind: 'party', slots: ['PARTY', 'AGAIN'] }, fill).people).toEqual([a.id, b.id].sort());
    expect(resolvePresence(ctx, { kind: 'hall', hall: { slot: 'ABSENT' } }, fill).people).toEqual([]);
    const foreignHall = resolvePresence(ctx, { kind: 'hall', hall: { slot: 'FOREIGN' } }, fill);
    expect(foreignHall.people).toContain(foreign.id);
    expect(foreignHall.people).not.toContain(a.id);
    expect(foreignHall.people).not.toContain(b.id);
    expect(resolvePresence(ctx, { kind: 'elsewhere', slots: [] }, fill).people).toEqual([]);
  });
  it('keeps future muster and covert commitments out of present attendance and reservations', () => {
    const ctx = testWorld(content);
    const w = ctx.world;
    const departure = w.year + 8;
    const operative = place(ctx, { sex: 'male', age: 30 });
    const crew = place(ctx, { sex: 'female', age: 30 });
    const officer = place(ctx, { sex: 'male', age: 30 });
    const expedition = 'future_expedition';
    const muster = 'future_muster';
    w.covert.operations.push({
      opportunity: 'future_opportunity', targetHouse: 'house_marrow',
      targetMembershipFrom: w.year, purpose: 'settle_grudge',
      plan: {
        id: expedition, sponsor: operative.id, operative: operative.id, target: officer.id,
        motive: { kind: 'grudge', grudge: 'future_grudge' },
        site: { kind: 'covert', operation: expedition }, bindings: {},
        preparation: 'hasty', preparedAt: departure, attemptYear: departure + 2,
        paidCrowns: 20,
      },
      stage: 'preparing',
      defence: { guards: [], response: 'ordinary', paidCrowns: 0 },
      enemyWarned: false, crew: [crew.id], supportService: [],
    });
    w.muster.commitments.push({
      id: muster, began: departure, age: 'the_wars', men: 10,
      from: {}, officers: [officer.id], credit: 0, status: 'in_the_field',
    });
    const home = () => resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people;
    const covertSite = { kind: 'covert', operation: expedition } as const;
    const musterSite = { kind: 'muster', commitment: muster } as const;
    const persons = [operative.id, crew.id, officer.id];

    // A restored future record is retained but cannot occupy today's people.
    expect(deployedPeople(ctx).size).toBe(0);
    expect(covertParticipants(ctx, expedition)).toEqual([]);
    expect(covertReservation(ctx, operative.id)).toBeUndefined();
    expect(covertReservation(ctx, crew.id)).toBeUndefined();
    expect(resolvePresence(ctx, covertSite, {}).people).toEqual([]);
    expect(resolvePresence(ctx, musterSite, {}).people).toEqual([]);
    expect(dutyPlaceOf(ctx, covertSite, {})).toBeUndefined();
    expect(dutyPlaceOf(ctx, musterSite, {})).toBeUndefined();
    for (const id of persons) expect(home()).toContain(id);

    // On the recorded departure year, the same saved rows become live.
    w.year = departure;
    expect([...deployedPeople(ctx)].sort()).toEqual([...persons].sort());
    expect(covertParticipants(ctx, expedition).sort()).toEqual([operative.id, crew.id].sort());
    expect(covertReservation(ctx, operative.id)).toBe(expedition);
    expect(covertReservation(ctx, crew.id)).toBe(expedition);
    expect(resolvePresence(ctx, covertSite, {}).people).toEqual([operative.id, crew.id].sort());
    expect(resolvePresence(ctx, musterSite, {}).people).toContain(officer.id);
    expect(dutyPlaceOf(ctx, covertSite, {})).toEqual({ operation: expedition });
    expect(dutyPlaceOf(ctx, musterSite, {})).toEqual({ commitment: muster });
    for (const id of persons) expect(home()).not.toContain(id);

    // Current and earlier departures remain active until their ordinary closure.
    w.year += 1;
    for (const id of persons) expect(deployedPeople(ctx).has(id)).toBe(true);
    w.covert.operations[0]!.stage = 'closed';
    w.muster.commitments[0]!.status = 'settled';
    expect([...deployedPeople(ctx)]).toEqual([]);
    expect(covertReservation(ctx, operative.id)).toBeUndefined();
    for (const id of persons) expect(home()).toContain(id);
  });

  it('does not deploy a future outside service or expose its scene before its start', () => {
    const ctx = testWorld(content);
    const w = ctx.world;
    const practitioner = place(ctx, { sex: 'male', age: 30 });
    const began = w.year + 6;
    const contract = 'future_commission';
    w.mystic.contracts.push({
      id: contract, kind: 'commission', practitioner: practitioner.id,
      working: 'the_still_binding', stage: 'preparing',
      started: began, ready: began + 1, ends: began + 3,
      providerFee: 0, escrow: 0, worked: 0, payments: [],
    });
    const site = { kind: 'service', contract } as const;
    const atHome = () => resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people.includes(practitioner.id);
    const atService = () => resolvePresence(ctx, site, {}).people;

    // The stored contract is real saved data, but this service has not started.
    expect(serviceReservation(ctx, practitioner.id)).toBeUndefined();
    expect(deployedPeople(ctx).has(practitioner.id)).toBe(false);
    expect(dutyPlaceOf(ctx, site, {})).toBeUndefined();
    expect(atService()).toEqual([]);
    expect(atHome()).toBe(true);

    w.year = began - 1;
    expect(serviceReservation(ctx, practitioner.id)).toBeUndefined();
    expect(atService()).toEqual([]);
    w.year = began;
    expect(serviceReservation(ctx, practitioner.id)).toBe(contract);
    expect(deployedPeople(ctx).has(practitioner.id)).toBe(true);
    expect(dutyPlaceOf(ctx, site, {})).toEqual({ service: contract });
    expect(atService()).toEqual([practitioner.id]);
    expect(atHome()).toBe(false);

    w.year++;
    w.mystic.contracts[0]!.stage = 'working';
    expect(deployedPeople(ctx).has(practitioner.id)).toBe(true);
    w.mystic.contracts[0]!.stage = 'closed';
    expect(serviceReservation(ctx, practitioner.id)).toBeUndefined();
    expect(deployedPeople(ctx).has(practitioner.id)).toBe(false);
    expect(atService()).toEqual([]);
    expect(atHome()).toBe(true);
  });

  it('admits scene participants only between their birth and effective death', () => {
    const ctx = testWorld(content);
    const current = place(ctx, { sex: 'male', age: 30 });
    const unborn = place(ctx, { sex: 'female', age: 30 });
    const deceased = place(ctx, { sex: 'male', age: 30 });
    const year = ctx.world.year;
    // Recovered data may disagree with status; life dates still govern the scene.
    unborn.born = year + 2;
    deceased.died = year;
    const fill = { PARTY: [current.id, unborn.id, deceased.id] };
    const party = { kind: 'party', slots: ['PARTY'] } as const;
    const visitors = { kind: 'hall', hall: 'main', visitors: ['PARTY'] } as const;

    expect(resolvePresence(ctx, party, fill).people).toEqual([current.id]);
    expect(resolvePresence(ctx, visitors, fill).people).not.toContain(unborn.id);
    expect(resolvePresence(ctx, visitors, fill).people).not.toContain(deceased.id);
    expect(resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people).not.toContain(unborn.id);
    expect(resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people).not.toContain(deceased.id);

    ctx.world.year = year + 2;
    expect(resolvePresence(ctx, party, fill).people).toEqual([current.id, unborn.id].sort());
    // A death recorded in the future is not an earlier absence.
    deceased.died = year + 3;
    expect(resolvePresence(ctx, party, fill).people).toEqual([current.id, unborn.id, deceased.id].sort());
    ctx.world.year = year + 3;
    expect(resolvePresence(ctx, party, fill).people).not.toContain(deceased.id);
  });

  it('does not expose a hall through an unborn or effectively deceased anchor', () => {
    const ctx = testWorld(content);
    const year = ctx.world.year;
    const resident = place(ctx, { sex: 'male', age: 30 });
    const unborn = place(ctx, { sex: 'female', age: 30 });
    const deceased = place(ctx, { sex: 'male', age: 30 });
    unborn.born = year + 1;
    deceased.died = year;

    const hall = { kind: 'hall', hall: { slot: 'ANCHOR' } } as const;
    for (const anchor of [unborn, deceased]) {
      expect(resolvePresence(ctx, hall, { ANCHOR: anchor.id })).toEqual({ site: hall, people: [] });
      expect(dutyPlaceOf(ctx, hall, { ANCHOR: anchor.id })).toBeUndefined();
      expect(dutyPlaceOf(ctx, { kind: 'person', person: anchor.id }, {})).toBeUndefined();
    }
    expect(resolvePresence(ctx, hall, { ANCHOR: resident.id }).people).toContain(resident.id);
    expect(dutyPlaceOf(ctx, hall, { ANCHOR: resident.id })).toEqual({ hall: 'main' });
    expect(dutyPlaceOf(ctx, { kind: 'person', person: resident.id }, {})).toEqual({ hall: 'main' });

    ctx.world.year = year + 1;
    expect(resolvePresence(ctx, hall, { ANCHOR: unborn.id }).people).toContain(unborn.id);
    expect(dutyPlaceOf(ctx, { kind: 'person', person: unborn.id }, {})).toEqual({ hall: 'main' });
  });

  it('scopes muster attendance to the named active field, excluding other deployments', () => {
    const ctx = testWorld(content);
    const w = ctx.world;
    const first = place(ctx, { sex: 'male', age: 30 });
    const second = place(ctx, { sex: 'male', age: 30 });
    const operative = place(ctx, { sex: 'male', age: 30 });
    const contractor = place(ctx, { sex: 'male', age: 30 });
    const readerFirst = place(ctx, { sex: 'male', age: 30 });
    const readerSecond = place(ctx, { sex: 'female', age: 30 });
    w.muster.commitments.push(
      { id: 'first', began: w.year, age: 'the_wars', men: 10, from: {}, officers: [first.id], credit: 0, status: 'in_the_field' },
      { id: 'second', began: w.year, age: 'the_wars', men: 10, from: {}, officers: [second.id], credit: 0, status: 'in_the_field' },
    );
    w.covert.operations.push({
      opportunity: 'other_place', targetHouse: 'house_marrow',
      targetMembershipFrom: w.year, purpose: 'settle_grudge',
      plan: {
        id: 'elsewhere', sponsor: operative.id, operative: operative.id, target: first.id,
        motive: { kind: 'grudge', grudge: 'old_quarrel' },
        site: { kind: 'covert', operation: 'elsewhere' }, bindings: {},
        preparation: 'hasty', preparedAt: w.year, attemptYear: w.year + 2, paidCrowns: 20,
      },
      stage: 'preparing', defence: { guards: [], response: 'ordinary', paidCrowns: 0 },
      enemyWarned: false, crew: [], supportService: [],
    });
    w.mystic.contracts.push({
      id: 'outside', kind: 'commission', practitioner: contractor.id,
      working: 'the_still_binding', stage: 'preparing',
      started: w.year, ready: w.year + 1, ends: w.year + 3,
      providerFee: 0, escrow: 0, worked: 0, payments: [],
    });
    // Recovered standing Mystic field duties must travel with their own field.
    const fieldDuty = (id: string, practitioner: string, commitment: string) => ({
      id, practitioner, working: 'the_still_binding',
      target: { kind: 'muster' as const, commitment }, bindings: {},
      started: w.year, ready: w.year, paidPreparation: 0, paidThrough: w.year,
      status: 'serving' as const,
      service: { servedYears: 0, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: 0 },
    });
    w.mystic.assignments.push(
      fieldDuty('watch_first', readerFirst.id, 'first'),
      fieldDuty('watch_second', readerSecond.id, 'second'),
    );
    expect([...deployedPeople(ctx)].sort()).toEqual([
      first.id, second.id, operative.id, contractor.id, readerFirst.id, readerSecond.id,
    ].sort());
    expect(resolvePresence(ctx, { kind: 'muster' }, {}).people).toEqual([
      first.id, second.id, readerFirst.id, readerSecond.id,
    ].sort());
    expect(resolvePresence(ctx, { kind: 'muster', commitment: 'first' }, {}).people)
      .toEqual([first.id, readerFirst.id].sort());
    expect(resolvePresence(ctx, { kind: 'muster', commitment: 'second' }, {}).people)
      .toEqual([second.id, readerSecond.id].sort());
    expect(resolvePresence(ctx, { kind: 'muster', commitment: 'missing' }, {}).people).toEqual([]);

    w.muster.commitments[1]!.began = w.year + 1;
    expect(resolvePresence(ctx, { kind: 'muster' }, {}).people).toEqual([first.id, readerFirst.id].sort());
    expect(resolvePresence(ctx, { kind: 'muster', commitment: 'second' }, {}).people).toEqual([]);
    w.muster.commitments[0]!.status = 'settled';
    expect(resolvePresence(ctx, { kind: 'muster' }, {}).people).toEqual([]);
  });

});
