import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type MysticContract } from '@ed/schema';
import { commissionIncome, outsideServicesView, prepareMysticContracts, quoteCommission, quoteHire, settleMysticContracts } from './mystic-contracts.js';
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

function futureService(year: number, overrides: Partial<MysticContract> = {}): MysticContract {
  return {
    id: 'msc_future', kind: 'commission', practitioner: 'reader_future',
    working: 'the_funeral_contract', patron: 'house_marrow',
    stage: 'preparing', started: year + 7, ready: year + 8, ends: year + 10,
    providerFee: 8, escrow: 0, worked: 0, payments: [],
    ...overrides,
  };
}

function warrantedOutsideScene() {
  const ctx = testWorld(content, 282101);
  ctx.world.treasury = 1000;
  const p = place(ctx, { sex: 'female', age: 30, name: 'The outside reader', awakened: true });
  p.spellsKnown = [asId('lesser_workings_of_death'), asId('greater_workings_of_death')];
  p.membership = [{ house: asId('house_calder'), kind: 'blood', from: ctx.world.year }];
  p.traits.add(asId('colleges_warrant'));
  ctx.world.mystic.contacts.push(p.id);
  ctx.world.library.set('lesser_workings_of_death', {
    id: 'lesser_workings_of_death', acquiredYear: ctx.world.year, condition: 80,
  });
  return {
    ctx, person: p.id,
    hire: { person: p.id, working: 'the_still_binding',
      target: { kind: 'book' as const, book: 'lesser_workings_of_death' } },
    commission: () => quoteCommission(ctx, p.id, 'the_funeral_contract', 'house_marrow'),
  };
}

describe('outside Mystic contract start-year boundaries (#2821, #2822, #2823)', () => {
  it('does not count a future-started contract as occupied or show it as an active service', () => {
    const { ctx, hire, commission } = warrantedOutsideScene();
    const start = ctx.world.year + 9;
    const future = futureService(ctx.world.year, {
      kind: 'hire', stage: 'working', started: start, ready: start, ends: start + 2,
    });
    ctx.world.mystic.contracts.push(future);
    const before = structuredClone(ctx.world.mystic.contracts);

    expect(quoteHire(ctx, hire).ok).toBe(true);
    expect(commission().ok).toBe(true);
    expect(outsideServicesView(ctx).contracts).toEqual([]);
    expect(ctx.world.mystic.contracts).toEqual(before);

    ctx.world.year = start;
    expect(quoteHire(ctx, hire).ok).toBe(false);
    expect(commission().ok).toBe(false);
    expect(outsideServicesView(ctx).contracts.map(c => c.id)).toEqual([future.id]);
  });

  it('does not prepare, pay, close, refund or break a future-started service early', () => {
    const ctx = testWorld(content, 282201);
    const year = ctx.world.year;
    const start = year + 9;
    const rows: MysticContract[] = [
      futureService(year, { id: 'future_preparing', kind: 'hire', started: start,
        ready: year - 1, ends: start + 2 }),
      futureService(year, { id: 'future_returning', stage: 'returning', started: start,
        ready: year - 5, ends: year - 4, returnsAt: year - 1, escrow: 7 }),
      futureService(year, { id: 'future_working', stage: 'working', started: start,
        ready: year - 3, ends: year - 1, payments: [{ year, amount: 17 }] }),
      futureService(year, { id: 'future_closed', stage: 'closed', started: start,
        ready: year - 5, ends: year - 4, result: 'fulfilled', renewBy: year - 1 }),
    ];
    ctx.world.mystic.contracts.push(...rows);
    const saved = structuredClone(ctx.world.mystic.contracts);
    const treasury = ctx.world.treasury;
    const chronicle = structuredClone(ctx.world.chronicle);

    prepareMysticContracts(ctx);
    settleMysticContracts(ctx);
    expect(commissionIncome(ctx)).toBe(0);
    expect(ctx.world.mystic.contracts).toEqual(saved);
    expect(ctx.world.treasury).toBe(treasury);
    expect(ctx.world.chronicle).toEqual(chronicle);

    ctx.world.year = start;
    prepareMysticContracts(ctx);
    expect(rows[0]!.stage).toBe('working');
    expect(rows[1]!.stage).toBe('closed');
  });

  it('ignores future patron histories and chooses the latest eligible cooldown regardless of array order', () => {
    const { ctx, person, commission } = warrantedOutsideScene();
    const year = ctx.world.year;
    const future = futureService(year, {
      id: 'future_promise', stage: 'closed', started: year + 5, ready: year + 6,
      ends: year + 8, result: 'fulfilled', renewBy: year + 25,
    });
    ctx.world.mystic.contracts.push(future);
    expect(commission().ok).toBe(true);
    expect(quoteCommission(ctx, person, 'the_funeral_contract', 'house_marrow', future.id).ok).toBe(false);
    expect(outsideServicesView(ctx).history).toEqual([]);
    expect(outsideServicesView(ctx).promises).toEqual([]);

    const old = futureService(year, {
      id: 'past_promise', stage: 'closed', started: year - 18, ready: year - 17,
      ends: year - 15, result: 'fulfilled', renewBy: year + 2,
    });
    ctx.world.mystic.contracts.push(old);
    expect(quoteCommission(ctx, person, 'the_funeral_contract', 'house_marrow', old.id).ok).toBe(true);
    expect(outsideServicesView(ctx).promises.map(p => p.id)).toEqual([old.id]);
    expect(outsideServicesView(ctx).history.map(c => c.id)).toEqual([old.id]);

    // A recent contract inserted before old history still owns the present cooldown.
    const recent = futureService(year, {
      id: 'recent_contract', stage: 'closed', started: year - 2,
      ready: year - 1, ends: year, result: 'failed',
    });
    ctx.world.mystic.contracts.unshift(recent);
    expect(commission().ok).toBe(false);
    expect(ctx.world.mystic.contracts.map(c => c.id)).toEqual([
      recent.id, future.id, old.id,
    ]);

    ctx.world.year = future.started;
    expect(outsideServicesView(ctx).promises.some(p => p.id === future.id)).toBe(true);
    expect(outsideServicesView(ctx).history.some(c => c.id === future.id)).toBe(true);
  });
});
