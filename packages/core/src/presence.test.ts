import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { place, testWorld } from './testing.js';
import { resolvePresence } from './presence.js';

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
    expect(resolvePresence(ctx, { kind: 'hall', hall: { slot: 'FOREIGN' } }, fill).people).toEqual([]);
    expect(resolvePresence(ctx, { kind: 'elsewhere', slots: [] }, fill).people).toEqual([]);
  });
});
