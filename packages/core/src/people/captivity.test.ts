import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, currentMembership } from '@ed/schema';
import { DEBT_FLOOR } from '../economy.js';
import { livingBlood } from '../ending.js';
import { lifeCareFor } from '../mystic.js';
import { addOfficer, beginCommitment, musterMortality, positionOptions } from '../muster.js';
import { resolvePresence } from '../presence.js';
import { createProseRuntime, missingPlainEnglish } from '../prose.js';
import { canonical, digestOf, loadGame, saveGame } from '../save.js';
import { GameSession } from '../session.js';
import { beginTutoring, order, tableView } from '../table.js';
import { phase, place, testRng, testWorld } from '../testing.js';
import { captureFamily, quoteRansom, releaseCaptive } from './captivity.js';
import { canTakePost, careerMortality, inBreedingPool } from './careers.js';
import { beginStudy } from './library.js';
import { ensureHead } from './succession.js';

// Built state: no search through simulated generations for a captured reader.
const content = loadContent();
const CAPTOR = 'house_marrow';
const BOOK = 'lesser_workings_of_life';
const snapshot = (ctx: ReturnType<typeof testWorld>) => canonical(saveGame(ctx));

describe('named family captivity (#1908)', () => {
  it.each(['male', 'female'] as const)('keeps %s family alive and in the blood history, away from home', sex => {
    for (const kind of ['blood', 'cadet', 'married_in'] as const) {
      const ctx = testWorld(content);
      const p = place(ctx, { sex, age: 30, name: 'Linn' });
      p.membership[0]!.kind = kind;
      const blood = livingBlood(ctx.world);
      expect(captureFamily(ctx, p.id, CAPTOR, 70)).toBe(true);
      expect(p.status).toBe('alive');
      expect(livingBlood(ctx.world)).toBe(blood);
      expect(ctx.world.people.living()).toContain(p);
      expect(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)).not.toContain(p);
      expect(currentMembership(p, ctx.world.year)).toMatchObject({ house: CAPTOR, kind: 'hostage' });
      expect(p.membership.filter(m => m.to === undefined)).toHaveLength(1);
      expect(p.captivity?.home).toMatchObject({ house: ctx.world.playerHouse, kind });
      expect(p.captivity?.home.to).toBeUndefined();
      expect(resolvePresence(ctx, { kind: 'hall', hall: 'main', visitors: ['HELD'] }, { HELD: p.id }).people).not.toContain(p.id);
      expect(inBreedingPool(ctx, p)).toBe(false);
      expect(releaseCaptive(ctx, p.id)).toBe(true);
      expect(currentMembership(p, ctx.world.year)).toMatchObject({ house: ctx.world.playerHouse, kind });
      expect(p.membership.filter(m => m.to === undefined)).toHaveLength(1);
      expect(p.captivity).toBeUndefined();
    }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses malformed price %s without touching the save', price => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 25 });
    const before = snapshot(ctx);
    expect(captureFamily(ctx, p.id, CAPTOR, price)).toBe(false);
    expect(snapshot(ctx)).toBe(before);
  });

  it('refuses unknown, departed, non-family, dead, guardian and already-held people atomically', () => {
    const ctx = testWorld(content);
    const departed = place(ctx, { sex: 'male', age: 30, house: CAPTOR });
    const retainer = place(ctx, { sex: 'male', age: 30 });
    retainer.membership[0]!.kind = 'retainer';
    const dead = place(ctx, { sex: 'female', age: 30 });
    ctx.world.people.kill(dead.id, ctx.world.year, 'test');
    const guardian = ctx.world.people.all().find(p => p.castSlots.includes('head'))!;
    ctx.world.people.kill(guardian.id, ctx.world.year, 'test');
    expect(guardian.status).toBe('guardian');
    const held = place(ctx, { sex: 'female', age: 30 });
    expect(captureFamily(ctx, held.id, CAPTOR, 20)).toBe(true);
    for (const id of ['absent', departed.id, retainer.id, dead.id, guardian.id, held.id]) {
      const before = snapshot(ctx);
      expect(captureFamily(ctx, id, CAPTOR, 20)).toBe(false);
      expect(snapshot(ctx)).toBe(before);
    }
    const p = place(ctx, { sex: 'female', age: 25 });
    for (const captor of [ctx.world.playerHouse, 'absent']) {
      const before = snapshot(ctx);
      expect(captureFamily(ctx, p.id, captor, 20)).toBe(false);
      expect(snapshot(ctx)).toBe(before);
    }
  });

  it('quotes without mutation and pays the fixed price exactly once through the Table', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 20, awakened: true });
    expect(captureFamily(ctx, p.id, CAPTOR, 60)).toBe(true);
    ctx.world.treasury = DEBT_FLOOR + 59;
    const before = snapshot(ctx);
    expect(quoteRansom(ctx, p.id)).toMatchObject({ ok: false, price: 60 });
    expect(tableView(ctx).captives).toMatchObject([{ person: p.id, since: ctx.world.year, price: 60, ok: false }]);
    expect(order(ctx, { kind: 'ransom', person: p.id }).ok).toBe(false);
    expect(order(ctx, { kind: 'tutor', person: p.id, attr: 'mind' }).ok).toBe(false);
    expect(beginTutoring(ctx, p, 'mind', false).ok).toBe(false);
    expect(beginStudy(ctx, p, ctx.content.spellbook(BOOK)!)).toBe(false);
    expect(canTakePost(ctx, p).ok).toBe(false);
    expect(snapshot(ctx)).toBe(before);
    ctx.world.treasury += 1;
    const session = new GameSession(ctx);
    expect(session.order({ kind: 'ransom', person: p.id })).toMatchObject({ ok: true, spent: 60, left: DEBT_FLOOR });
    expect(session.table().captives).toEqual([]);
    const returned = snapshot(ctx);
    expect(session.order({ kind: 'ransom', person: p.id }).ok).toBe(false);
    expect(releaseCaptive(ctx, p.id)).toBe(false);
    expect(snapshot(ctx)).toBe(returned);
  });

  it('releases freely, and a zero-price ransom needs no payment', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'male', age: 25 });
    captureFamily(ctx, p.id, CAPTOR, 100);
    const money = ctx.world.treasury;
    expect(releaseCaptive(ctx, p.id)).toBe(true);
    expect(ctx.world.treasury).toBe(money);
    captureFamily(ctx, p.id, CAPTOR, 0);
    ctx.world.treasury = DEBT_FLOOR - 100;
    expect(order(ctx, { kind: 'ransom', person: p.id })).toMatchObject({ ok: true, price: 0 });
    expect(ctx.world.treasury).toBe(DEBT_FLOOR - 100);
  });

  it('preserves every active study and a paid tutoring term by their remaining years', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 15, awakened: true });
    const books = [BOOK, 'lesser_workings_of_terra'];
    for (const [i, book] of books.entries()) {
      ctx.world.library.set(book, { id: book, acquiredYear: ctx.world.year, condition: 100 });
      ctx.world.studies.push({ person: p.id, book, completes: ctx.world.year + 2 + i });
    }
    expect(beginTutoring(ctx, p, 'mind').ok).toBe(true);
    const remaining = ctx.world.tutoring[0]!.completes - ctx.world.year;
    captureFamily(ctx, p.id, CAPTOR, 10);
    expect(ctx.world.studies.filter(s => s.person === p.id)).toEqual([]);
    expect(ctx.world.tutoring.filter(s => s.person === p.id)).toEqual([]);
    ctx.world.year += 8;
    phase('library', ctx);
    expect(p.spellsKnown).toEqual([]);
    releaseCaptive(ctx, p.id);
    expect(ctx.world.studies).toEqual(books.map((book, i) => ({ person: p.id, book, completes: ctx.world.year + 2 + i })));
    expect(ctx.world.tutoring).toEqual([{ person: p.id, attr: 'mind', completes: ctx.world.year + remaining }]);
  });

  it.each([false, true])('does not keep a home Mystic benefit while held; release duty while held=%s', endWhileHeld => {
    const ctx = testWorld(content);
    ctx.world.treasury = 500;
    const carer = place(ctx, { sex: 'female', age: 30, awakened: true });
    carer.spellsKnown.push(asId(BOOK));
    const ward = place(ctx, { sex: 'male', age: 0 });
    const nextBook = 'lesser_workings_of_terra';
    ctx.world.library.set(nextBook, { id: nextBook, acquiredYear: ctx.world.year, condition: 100 });
    ctx.world.studies.push({ person: carer.id, book: nextBook, completes: ctx.world.year + 3 });
    expect(order(ctx, { kind: 'mysticAssign', person: carer.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
    ctx.world.year += 1;
    phase('mystic', ctx);
    const duty = ctx.world.mystic.assignments[0]!;
    expect(lifeCareFor(ctx, ward)).toBeDefined();
    const paused = structuredClone(ctx.world.mystic.pauses);
    captureFamily(ctx, carer.id, CAPTOR, 30);
    expect(lifeCareFor(ctx, ward)).toBeUndefined();
    expect(ctx.world.mystic.pauses).toEqual(paused);
    phase('mystic', ctx);
    expect(duty).toMatchObject({ status: 'suspended', reason: 'hostage' });
    if (endWhileHeld) {
      expect(order(ctx, { kind: 'mysticRelease', assignment: duty.id }).ok).toBe(true);
      expect(ctx.world.studies).toEqual([]);
      expect(carer.captivity?.studies).toEqual([{ book: nextBook, remainingYears: 3 }]);
    }
    ctx.world.year += 2;
    releaseCaptive(ctx, carer.id);
    if (endWhileHeld) {
      expect(ctx.world.studies).toEqual([{ person: carer.id, book: nextBook, completes: ctx.world.year + 3 }]);
    } else {
      phase('mystic', ctx);
      expect(duty.status).toBe('serving');
      expect(ctx.world.studies).toEqual([]);
      expect(order(ctx, { kind: 'mysticRelease', assignment: duty.id }).ok).toBe(true);
      expect(ctx.world.studies[0]!.completes).toBe(ctx.world.year + 3);
    }
  });

  it('ordinary succession replaces a captive Head, and the returning Head does not take the seal back', () => {
    const ctx = testWorld(content);
    const head = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).find(p => p.castSlots.includes('head'))!;
    place(ctx, { sex: 'male', age: 30, awakened: true });
    captureFamily(ctx, head.id, CAPTOR, 20);
    const successor = ensureHead(ctx, testRng('captive-succession')).newHead;
    expect(successor).toBeDefined();
    expect(successor!.id).not.toBe(head.id);
    releaseCaptive(ctx, head.id);
    expect(head.castSlots).not.toContain('head');
    expect(ensureHead(ctx, testRng('captive-return')).newHead).toBeUndefined();
    expect(successor!.castSlots).toContain('head');
  });

  it.each([false, true])('restores a cadet home, using the seat only if its branch ended=%s', ended => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 25, branch: 'cadet-test' });
    p.membership[0]!.kind = 'cadet';
    ctx.world.branches.set('cadet-test', { id: asId('cadet-test'), name: 'Linn Hall', house: asId(ctx.world.playerHouse),
      founder: p.id, splitFrom: 'main', foundedYear: ctx.world.year, grievance: 0 });
    captureFamily(ctx, p.id, CAPTOR, 10);
    if (ended) ctx.world.branches.get('cadet-test')!.extinct = ctx.world.year;
    releaseCaptive(ctx, p.id);
    expect(currentMembership(p, ctx.world.year)?.branch).toBe(ended ? 'main' : 'cadet-test');
  });

  it('normal mortality still reaches a captive, with no resurrection or payment after death', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 300 });
    const blood = livingBlood(ctx.world);
    captureFamily(ctx, p.id, CAPTOR, 10);
    phase('lifecycle', ctx);
    expect(p.status).toBe('dead');
    expect(livingBlood(ctx.world)).toBeLessThan(blood);
    const after = snapshot(ctx);
    expect(quoteRansom(ctx, p.id).ok).toBe(false);
    expect(order(ctx, { kind: 'ransom', person: p.id }).ok).toBe(false);
    expect(releaseCaptive(ctx, p.id)).toBe(false);
    expect(snapshot(ctx)).toBe(after);
  });

  it('retains the officer history but loses field exposure, age qualification and career discount while held', () => {
    const ctx = testWorld(content);
    ctx.world.treasury = 500;
    const p = place(ctx, { sex: 'male', age: 40, career: { career: 'military' } });
    beginCommitment(ctx, 5, 'the_wars');
    expect(addOfficer(ctx, p.id)).toBe(true);
    expect(musterMortality(ctx, p)).toBeGreaterThan(0);
    expect(careerMortality(ctx, p)).toBeGreaterThan(0);
    const before = positionOptions(ctx).find(o => o.id === 'a_captaincy')!;
    captureFamily(ctx, p.id, CAPTOR, 10);
    expect(musterMortality(ctx, p)).toBe(0);
    expect(careerMortality(ctx, p)).toBe(0);
    expect(addOfficer(ctx, p.id)).toBe(false);
    const held = positionOptions(ctx).find(o => o.id === 'a_captaincy')!;
    expect(held.canBuy).toBe(false);
    expect(held.price).toBeGreaterThan(before.price!);
    releaseCaptive(ctx, p.id);
    expect(positionOptions(ctx).find(o => o.id === 'a_captaincy')).toEqual(before);
  });

  it('round-trips the captor, fixed price, home and progress; the same saved state and order produce the same result', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 15 });
    ctx.world.tutoring.push({ person: p.id, attr: 'mind', completes: ctx.world.year + 2 });
    captureFamily(ctx, p.id, CAPTOR, 37);
    const saved = saveGame(ctx);
    const after = loadGame(JSON.parse(JSON.stringify(saved)), content);
    expect(digestOf(after)).toBe(digestOf(ctx));
    expect(after.world.people.mustGet(p.id).captivity).toEqual(p.captivity);
    const again = loadGame(saved, content);
    expect(new GameSession(after).order({ kind: 'ransom', person: p.id })).toEqual(new GameSession(again).order({ kind: 'ransom', person: p.id }));
    expect(digestOf(after)).toBe(digestOf(again));
    expect(saved.people.find(person => person.id === p.id)?.captivity).toBeDefined();
  });

  it.each(['original', 'plainenglish'] as const)('names the people, money and missing study copy in %s receipts', mode => {
    const ctx = testWorld(content);
    ctx.prose = createProseRuntime(mode, ctx.content.bundle.proseVariants);
    const p = place(ctx, { sex: 'female', age: 25, name: 'Linn' });
    ctx.world.studies.push({ person: p.id, book: BOOK, completes: ctx.world.year + 2 });
    captureFamily(ctx, p.id, CAPTOR, 37);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('Linn');
    ctx.world.library.delete(BOOK);
    const before = ctx.world.chronicle.length;
    expect(order(ctx, { kind: 'ransom', person: p.id }).ok).toBe(true);
    const text = ctx.world.chronicle.slice(before).map(e => e.text).join('\n');
    expect(text).toContain('Linn');
    expect(text).toContain('37');
    expect(text).toContain('no copy');
    expect(ctx.world.studies).toEqual([]);
    expect(missingPlainEnglish(ctx)).toEqual([]);
    captureFamily(ctx, p.id, CAPTOR, 0);
    releaseCaptive(ctx, p.id);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('Linn');
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});
