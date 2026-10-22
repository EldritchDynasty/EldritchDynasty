import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type AuctionLot } from '@ed/schema';
import { resolveDueLots } from '../auction.js';
import { saveGame } from '../save.js';
import { place, testWorld } from '../testing.js';
import { observeFamilyChallenge } from './challenge-observation.js';
import { attachMysticLedger, emptyMysticLedger, mysticPayback, noteMysticOrder, noteMysticOutcome, sampleMysticYear } from './mystic-accounting.js';

const content = loadContent();
const snapshot = (ctx: ReturnType<typeof testWorld>) => ({ ...saveGame(ctx), savedAt: '' });

describe('Mystic baseline accounting (#1872)', () => {
  it('keeps the selected learned check distinct from a later primordial response', () => {
    const ctx = testWorld(content);
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    reader.spellsKnown = [asId('lesser_workings_of_fluid')];
    const event = content.event('the_smoke_above_the_store')!;
    if (event.interaction.kind === 'narration') throw new Error('expected choices');
    const choice = event.interaction.choices.find(c => c.id === 'use_fluid')!;
    const selectedOutcome = choice.outcomes.find(o => o.id === 'held')!;
    const observation = { event, choiceId: choice.id, selectedOutcome,
      outcome: { ...selectedOutcome, id: 'held_primordial', effects: selectedOutcome.primordial!.effects },
      fill: { WATER: reader.id } };
    const before = snapshot(ctx);
    const row = observeFamilyChallenge(ctx, observation)!;
    expect(row).toMatchObject({ passed: true, selectedOutcome: 'held', outcome: 'held_primordial',
      intervened: true, selectedTreasury: -10, treasury: -5 });
    const ledger = emptyMysticLedger();
    noteMysticOutcome(ctx, ledger, observation);
    expect(ledger).toMatchObject({ learnedSuccesses: 1, intervenedLearnedAttempts: 1,
      normalCheckAvoidedLoss: 25, unintervenedAvoidedLoss: 0, primordialCoinDifference: 5 });
    expect(snapshot(ctx)).toEqual(before);
  });

  it('charges a preparation bundle once when it also acquires and studies its primer', () => {
    const ctx = testWorld(content);
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const event = content.event('the_wind_under_the_slates')!;
    if (event.interaction.kind === 'narration') throw new Error('expected choices');
    const choice = event.interaction.choices.find(c => c.outcomes.some(o => o.effects.some(e =>
      e.kind === 'spellbook' && e.op === 'acquire_copy')))!;
    const outcome = choice.outcomes[0]!;
    const ledger = emptyMysticLedger();
    noteMysticOutcome(ctx, ledger, { event, choiceId: choice.id, selectedOutcome: outcome, outcome, fill: { APPRENTICE: reader.id } });
    expect(ledger.costs).toMatchObject({ preparationCoin: 115, eventBookCoin: 0, auctionCoin: 0 });
    expect(mysticPayback(ledger)).toMatchObject({ pricedCoinCosts: 115, normalCheckNetCoin: -115 });
  });

  it('counts actual cash book wins, including automatic bids, but never lost bids', () => {
    const run = (observed: boolean) => {
      const ctx = testWorld(content);
      ctx.world.treasury = 20_000;
      // No rival motives for this named art: force the automatic floor to win.
      const book = content.spellbooks.find(b => b.tier === 'named')!;
      const lot: AuctionLot = { id: 'auto_book', kind: 'spellbook', refId: book.id,
        house: 'house_marrow', announcedYear: ctx.world.year - 3, saleYear: ctx.world.year, reserveCoin: 1500 };
      const lost: AuctionLot = { ...lot, id: 'lost_book', reserveCoin: 100_000,
        playerBid: { house: ctx.world.playerHouse, currency: 'coin', amount: 1 } };
      ctx.world.auction.upcoming = [lot, lost];
      const ledger = emptyMysticLedger();
      if (observed) attachMysticLedger(ctx, ledger);
      const before = ctx.world.treasury;
      resolveDueLots(ctx, false);
      return { save: snapshot(ctx), ledger, charged: before - ctx.world.treasury };
    };
    const plain = run(false);
    const measured = run(true);
    expect(measured.save).toEqual(plain.save);
    expect(measured.charged).toBe(1800);
    expect(measured.ledger.costs.auctionCoin).toBe(measured.charged);
    expect(measured.ledger.bookPurchases).toHaveLength(1);
    expect(measured.ledger.bookPurchases[0]).toMatchObject({ lot: 'auto_book', coin: 1800, currency: 'coin' });
  });

  it('retains noncoin book prices as unpriced obligations', () => {
    const ctx = testWorld(content);
    ctx.world.treasury = 20_000;
    const head = ctx.world.people.living().find(p => p.castSlots.includes('head'))!;
    const book = content.spellbooks.find(b => b.tier === 'named')!;
    const ledger = emptyMysticLedger();
    attachMysticLedger(ctx, ledger);
    ctx.world.auction.upcoming = [{ id: 'pledged_book', kind: 'spellbook', refId: book.id, house: 'house_marrow',
      announcedYear: ctx.world.year - 3, saleYear: ctx.world.year, reserveCoin: 1500,
      playerBid: { house: ctx.world.playerHouse, currency: 'marriage_promise', amount: 0, pledgedBy: head.id } }];
    resolveDueLots(ctx, false);
    expect(ctx.world.marriagePromises).toHaveLength(1);
    expect(ledger).toMatchObject({ nonCoinPurchases: 1, costs: { auctionCoin: 0 } });
    expect(mysticPayback(ledger).unpricedNonCoinPurchases).toBe(1);
  });

  it('counts a person once per year and affinity, keeping parallel study years separate', () => {
    const ctx = testWorld(content);
    for (const p of ctx.world.people.all()) p.spellsKnown = [];
    const reader = place(ctx, { sex: 'female', age: 30, awakened: true });
    const life = content.spellbooks.filter(b => b.affinity === 'life');
    reader.spellsKnown = life.slice(0, 2).map(b => b.id);
    expect(reader.spellsKnown).toHaveLength(2);
    const dead = place(ctx, { sex: 'female', age: 30, awakened: true });
    dead.spellsKnown = [life[0]!.id];
    ctx.world.people.kill(dead.id, ctx.world.year, 'fixture');
    ctx.world.studies = life.slice(0, 2).map(b => ({ person: reader.id, book: b.id, completes: ctx.world.year + 4 }));
    const before = snapshot(ctx);
    const ledger = emptyMysticLedger();
    sampleMysticYear(ctx, ledger);
    expect(ledger).toMatchObject({ sampledYears: 1, trainedHouseYears: 1, practitionerYears: 1,
      practitionerYearsByAffinity: { life: 1 }, studyingPersonYears: 1, studyCommitmentYears: 2 });
    expect(snapshot(ctx)).toEqual(before);
  });

  it('counts successful paid orders without treating bid promises or refusals as spending', () => {
    const ledger = emptyMysticLedger();
    noteMysticOrder(ledger, { kind: 'seekBook', book: 'x' }, { ok: false }, 99);
    noteMysticOrder(ledger, { kind: 'seekBook', book: 'x' }, { ok: true }, 15);
    noteMysticOrder(ledger, { kind: 'restore', book: 'x' }, { ok: true }, 40);
    noteMysticOrder(ledger, { kind: 'lotBid', lot: 'x', bid: { currency: 'coin', amount: 200 } }, { ok: true }, 0);
    expect(ledger.costs).toEqual({ brokerCoin: 15, restorationCoin: 40, auctionCoin: 0, eventBookCoin: 0, preparationCoin: 0 });
    expect(mysticPayback(ledger).normalCheckNetCoin).toBe(-55);
  });
});
