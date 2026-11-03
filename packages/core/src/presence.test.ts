import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { place, testWorld } from './testing.js';
import { covertParticipants, covertReservation, deployedPeople, dutyPlaceOf, resolvePresence } from './presence.js';

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

});
