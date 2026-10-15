import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, BidCurrencyS, proseOriginalHash, type AuctionLot } from '@ed/schema';
import {
  announceAuction, auctionCandidateWeight, bidAtAuction, bootstrap, commissionBook, DEBT_FLOOR, grantHeirloom, grantParcel,
  order, resolveDueLots, setProseMode, setProseVariants, tableView, testRng, tickAuction,
  beget, digestOf, expectHealthyWorld, loadGame, matchSubjects, onTheMarket, phase, place, saveGame, wed,
  ECHO_AFTER, bitterestAgainst, grudgeAgainstUs, grudgesAgainst, relationshipThreads, tickRelationships, viewOf,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { coreMessageAddress } from './messages.js';
import { missingPlainEnglish } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

describe('a granddaughter pays an auction pledge (#1449)', () => {
  function wonPledge() {
    const ctx = bootstrap(bundle, 1449, 1042);
    const head = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.castSlots.includes('head'))!;
    const lot: AuctionLot = {
      id: 'pledge_lot', kind: 'heirloom', refId: 'portion_of_agelessness', house: 'house_marrow',
      announcedYear: 1042, saleYear: 1045, reserveCoin: 800,
    };
    ctx.world.auction.upcoming = [lot];
    expect(order(ctx, { kind: 'lotBid', lot: lot.id, bid: { currency: 'marriage_promise' } })).toEqual({ ok: true });
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);
    expect(ctx.world.auction.history[0]!.winner).toBe('player');
    return { ctx, head, lot, promise: ctx.world.marriagePromises[0]! };
  }
  function granddaughter(ctx: SimCtx, head: ReturnType<typeof place>, name = 'Alys') {
    const parent = place(ctx, { sex: 'male', age: 25, name: `${name}'s father` });
    beget(ctx, parent, undefined, head);
    const girl = place(ctx, { sex: 'female', age: 0, name });
    beget(ctx, girl, undefined, parent);
    return { girl, parent };
  }

  it('records the signer, prices by the reserve, and permits only one outstanding pledge', () => {
    const { ctx, head, lot, promise } = wonPledge();
    expect(promise).toEqual({ toHouse: lot.house, year: lot.saleYear, lot: lot.refId, pledgedBy: head.id });
    expect(ctx.world.chronicle.some((e) => e.text?.includes(head.name) && e.text.includes('future granddaughter'))).toBe(true);
    const next = { ...lot, id: 'second_pledge', saleYear: ctx.world.year + 3, playerBid: undefined };
    ctx.world.auction.upcoming = [next];
    expect(bidAtAuction(ctx, next.id, 'marriage_promise', 0).ok).toBe(false);
  });

  it('keeps the original signer through succession and refuses a second registered promise bid', () => {
    const ctx = bootstrap(bundle, 1449, 1042);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const lot: AuctionLot = { id: 'signed', kind: 'heirloom', refId: 'portion_of_agelessness',
      house: 'house_marrow', announcedYear: 1042, saleYear: 1045, reserveCoin: 800 };
    const next = { ...lot, id: 'second' };
    ctx.world.auction.upcoming = [lot, next];
    expect(bidAtAuction(ctx, lot.id, 'marriage_promise', 0).ok).toBe(true);
    expect(bidAtAuction(ctx, next.id, 'marriage_promise', 0).ok).toBe(false);
    ctx.world.people.kill(head.id, ctx.world.year, 'test');
    phase('succession', ctx);
    ctx.world.year = 1045;
    resolveDueLots(ctx, false);
    expect(ctx.world.marriagePromises[0]!.pledgedBy).toBe(head.id);
  });

  it('a rival winning the lot creates no marriage debt', () => {
    const ctx = bootstrap(bundle, 1449, 1042);
    const lot: AuctionLot = { id: 'lost', kind: 'chronicle_page', refId: 'pledge_test_lie',
      house: 'house_marrow', announcedYear: 1042, saleYear: 1045, reserveCoin: 900 };
    ctx.world.discrepancies.set(lot.refId, { state: 'open', severity: 'total', provableBy: ['house_marrow'] });
    ctx.world.auction.upcoming = [lot];
    expect(bidAtAuction(ctx, lot.id, 'marriage_promise', 0).ok).toBe(true);
    ctx.world.year = 1045;
    resolveDueLots(ctx, false);
    expect(ctx.world.auction.history[0]!.winner).toBe('rival');
    expect(ctx.world.marriagePromises).toEqual([]);
  });

  it('resumes an unsold signed bid and keeps a page name public throughout its pledge', () => {
    const ctx = bootstrap(bundle, 1449, 1042);
    const lot: AuctionLot = { id: 'page_pledge', kind: 'chronicle_page', refId: 'private_discrepancy_key',
      house: 'house_marrow', announcedYear: 1042, saleYear: 1045, reserveCoin: 220 };
    ctx.world.discrepancies.set(lot.refId, { state: 'open', severity: 'minor', provableBy: ['house_marrow'] });
    ctx.world.auction.upcoming = [lot];
    expect(bidAtAuction(ctx, lot.id, 'marriage_promise', 0).ok).toBe(true);
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(loaded.world.auction.upcoming[0]!.playerBid).toEqual(lot.playerBid);
    loaded.world.year = lot.saleYear;
    resolveDueLots(loaded, false);
    expect(viewOf(loaded).marriagePromises[0]!.lotName).toBe('a page that names the family');
    expect(relationshipThreads(loaded, 10).flatMap((thread) => thread.pressures)
      .find((fact) => fact.kind === 'marriage_promise')?.detail).toContain('a page that names the family');
    loaded.world.year += 1;
    const head = loaded.world.people.mustGet(lot.playerBid!.pledgedBy!);
    const { girl } = granddaughter(loaded, head);
    phase('promises', loaded);
    loaded.world.year = girl.born + 18;
    expect(order(loaded, { kind: 'withhold', person: girl.id, hold: true }).ok).toBe(true);
    phase('promises', loaded);
    const lines = loaded.world.chronicle.filter((entry) => entry.text?.includes('pledge'));
    expect(lines.every((entry) => !entry.text!.includes(lot.refId))).toBe(true);
    expect(lines.some((entry) => entry.text!.endsWith('The pledge was broken.'))).toBe(true);
  });

  it('reserves only a future granddaughter named by claimed parentage', () => {
    const { ctx, head, promise } = wonPledge();
    const { girl: sameYear } = granddaughter(ctx, head, 'Before the pledge');
    ctx.world.year += 1;
    const { girl: biological, parent } = granddaughter(ctx, head, 'Biological only');
    parent.claimedParents = {};
    const { girl: recorded, parent: recordedParent } = granddaughter(ctx, head, 'Recorded granddaughter');
    ctx.world.people.setParents(recordedParent.id, {});
    const daughter = place(ctx, { sex: 'female', age: 0, name: 'Daughter' });
    beget(ctx, daughter, undefined, head);
    phase('promises', ctx);
    expect(promise.girl).toBe(recorded.id);
    expect([sameYear.id, biological.id, daughter.id]).not.toContain(promise.girl);
    expect(onTheMarket(ctx, recorded)).toBe(false);
  });

  it('blocks the ordinary draft and direct weddings, then sends her to the creditor with her knowledge', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    phase('promises', ctx);
    ctx.world.year = girl.born + 18;
    const ordinary = place(ctx, { sex: 'male', age: 23, name: 'Ordinary match' });
    const groom = place(ctx, { sex: 'male', age: 25, name: 'Marrow husband', house: promise.toHouse });
    const book = ctx.content.spellbooks[0]!;
    girl.spellsKnown.push(asId(book.id));
    ctx.world.library.set(book.id, { id: book.id, acquiredYear: ctx.world.year, condition: 73 });
    expect(matchSubjects(ctx).some((p) => p.id === girl.id)).toBe(false);
    wed(ctx, ordinary, girl);
    wed(ctx, girl, ordinary);
    expect(girl.marriages).toEqual([]);
    phase('promises', ctx);
    expect(ctx.world.people.householdOf(girl.id, ctx.world.year)).toBe(promise.toHouse);
    expect(girl.marriages).toEqual([{ spouse: groom.id, from: ctx.world.year }]);
    expect(groom.marriages).toEqual([{ spouse: girl.id, from: ctx.world.year }]);
    expect(girl.spellsKnown).toContain(book.id);
    expect(ctx.world.library.get(book.id)?.condition).toBe(73);
    expect(ctx.world.marriagePromises).toEqual([]);
    expect(ctx.world.chronicle.some((e) => e.text?.includes(girl.name) && e.text.includes(groom.name)
      && e.text.includes(head.name) && e.text.includes(String(promise.year)))).toBe(true);
    expectHealthyWorld(ctx);
  });

  it('mints a creditor groom through the existing template door only when she can marry', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    const count = ctx.world.people.all().length;
    phase('promises', ctx);
    expect(ctx.world.people.all()).toHaveLength(count);
    ctx.world.year = girl.born + 18;
    ctx.world.generation = 1;
    phase('promises', ctx);
    const spouse = ctx.world.people.mustGet(girl.marriages[0]!.spouse);
    expect(spouse.mintedFrom).toBeDefined();
    expect(spouse.houseOfOrigin).toBe(promise.toHouse);
    expect(ctx.world.people.householdOf(girl.id, ctx.world.year)).toBe(promise.toHouse);
    expectHealthyWorld(ctx);
  });

  it('gives the Table one adult turn to keep her back before collection', () => {
    const { ctx, head } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    phase('promises', ctx);
    ctx.world.year = girl.born + 17;
    phase('promises', ctx);
    expect(girl.marriages).toEqual([]);
    expect(tableView(ctx).market.some((row) => row.person === girl.id && row.age === 17)).toBe(true);
    expect(ctx.world.chronicle.some((entry) => entry.text?.includes(girl.name)
      && entry.text.includes('next year'))).toBe(true);
    expect(order(ctx, { kind: 'withhold', person: girl.id, hold: true }).ok).toBe(true);
    ctx.world.year += 1;
    phase('promises', ctx);
    expect(girl.marriages).toEqual([]);
    expect(ctx.world.marriagePromises).toEqual([]);
    expect(ctx.world.chronicle.some((entry) => entry.text?.endsWith('The pledge was broken.'))).toBe(true);
  });

  it('bills withholding once and preserves the girl and main seal', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    phase('promises', ctx);
    ctx.world.year = girl.born + 18;
    ctx.world.respect = 'regarded';
    expect(order(ctx, { kind: 'withhold', person: girl.id, hold: true }).ok).toBe(true);
    phase('promises', ctx);
    expect(ctx.world.respect).toBe('known');
    expect(ctx.world.people.householdOf(girl.id, ctx.world.year)).toBe(ctx.world.playerHouse);
    expect(girl.marriages).toEqual([]);
    const grudges = [...ctx.world.relationships.values()].flatMap((rel) => rel.grudges);
    expect(grudges).toHaveLength(1);
    expect(grudges[0]).toMatchObject({ severity: 50, inheritance: 'all_blood' });
    expect(grudgeAgainstUs(ctx.world)).toBe(50);
    expect(grudgesAgainst(ctx.world, girl.id)).toHaveLength(1);
    const claimant = ctx.world.people.mustGet(bitterestAgainst(ctx.world, ctx.world.playerHouse)!);
    expect(ctx.world.people.householdOf(claimant.id, ctx.world.year)).toBe(promise.toHouse);
    expect(claimant.status).toBe('alive');
    ctx.world.year += 1;
    tickRelationships(ctx);
    expect(grudgeAgainstUs(ctx.world)).toBeGreaterThan(49);
    expect(relationshipThreads(ctx, 10).find((thread) => thread.house === promise.toHouse)
      ?.pressures.some((fact) => fact.kind === 'grudge')).toBe(true);
    expect(grudges[0]!.originPage).toBeDefined();
    expect(ctx.world.chronicle.find((entry) => entry.id === grudges[0]!.originPage)?.text)
      .toContain('The pledge was broken.');
    expect(ctx.world.marriagePromises).toEqual([]);
    const lines = ctx.world.chronicle.length;
    phase('promises', ctx);
    expect(ctx.world.respect).toBe('known');
    expect(ctx.world.chronicle).toHaveLength(lines);
    expectHealthyWorld(ctx);
    ctx.world.year += ECHO_AFTER;
    tickRelationships(ctx);
    expect(ctx.world.chronicle.filter((entry) => entry.cause?.page === grudges[0]!.originPage)).toHaveLength(1);
    expect(grudgeAgainstUs(ctx.world)).toBeGreaterThan(49);
  });

  it('skips a pledged Head/Regent and collects the next eligible granddaughter instead', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl: first } = granddaughter(ctx, head, 'First');
    phase('promises', ctx);
    expect(promise.girl).toBe(first.id);
    const { girl: second } = granddaughter(ctx, head, 'Second');
    // A seated woman is the Regent. She cannot be transferred away or billed
    // for taking the main seal. The outstanding pledge moves to the next girl.
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    first.castSlots.push('head');
    ctx.world.year = second.born + 18;
    const groom = place(ctx, { sex: 'male', age: 25, name: 'Second creditor groom', house: promise.toHouse });
    ctx.world.respect = 'regarded';
    phase('promises', ctx);
    expect(ctx.world.people.householdOf(first.id, ctx.world.year)).toBe(ctx.world.playerHouse);
    expect(first.marriages).toEqual([]);
    expect(ctx.world.people.householdOf(second.id, ctx.world.year)).toBe(promise.toHouse);
    expect(second.marriages).toEqual([{ spouse: groom.id, from: ctx.world.year }]);
    expect(ctx.world.marriagePromises).toEqual([]);
    expect(ctx.world.respect).toBe('regarded');
    expect(grudgeAgainstUs(ctx.world)).toBe(0);
    expectHealthyWorld(ctx);
  });

  it('defaults exactly forty years after signing if no eligible granddaughter can be collected', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head, 'Next Regent');
    phase('promises', ctx);
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    girl.castSlots.push('head');
    ctx.world.year = promise.year + 39;
    ctx.world.respect = 'regarded';
    phase('promises', ctx);
    expect(ctx.world.marriagePromises).toHaveLength(1);
    expect(ctx.world.people.householdOf(girl.id, ctx.world.year)).toBe(ctx.world.playerHouse);
    ctx.world.year += 1;
    phase('promises', ctx);
    expect(ctx.world.marriagePromises).toEqual([]);
    expect(ctx.world.respect).toBe('known');
    expect(ctx.world.chronicle.some((e) => e.text?.includes('Forty years had passed'))).toBe(true);
    const before = ctx.world.chronicle.length;
    phase('promises', ctx);
    expect(ctx.world.chronicle).toHaveLength(before);
  });

  it('replaces a dead reservation without renewing the deadline, then bills an unfulfilled pledge once', () => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    phase('promises', ctx);
    ctx.world.people.kill(girl.id, ctx.world.year, 'test');
    const { girl: replacement } = granddaughter(ctx, head, 'Replacement');
    phase('promises', ctx);
    expect(promise.girl).toBe(replacement.id);
    expect(promise.year).toBe(1045);
    ctx.world.people.kill(replacement.id, ctx.world.year, 'test');
    ctx.world.year = promise.year + 40;
    ctx.world.respect = 'regarded';
    phase('promises', ctx);
    expect(ctx.world.respect).toBe('known');
    expect(ctx.world.marriagePromises).toEqual([]);
    const lines = ctx.world.chronicle.length;
    phase('promises', ctx);
    expect(ctx.world.chronicle).toHaveLength(lines);
  });

  it.each(['fulfill', 'withhold'] as const)('resumes a signed bid and reserved girl with the same %s result', (route) => {
    const { ctx, head, promise } = wonPledge();
    ctx.world.year += 1;
    const { girl } = granddaughter(ctx, head);
    phase('promises', ctx);
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(loaded.world.marriagePromises).toEqual([promise]);
    expect(loaded.world.auction.history[0]!.lot.playerBid?.pledgedBy).toBe(head.id);
    for (const world of [ctx, loaded]) {
      world.world.year = girl.born + 18;
      if (route === 'withhold') expect(order(world, { kind: 'withhold', person: girl.id, hold: true }).ok).toBe(true);
      phase('promises', world);
    }
    expect(digestOf(loaded)).toBe(digestOf(ctx));
    expectHealthyWorld(loaded);
  });
});

describe('announcing an auction', () => {
  it('makes a held Sarrow bottom a real road to spellbook lots', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    expect(auctionCandidateWeight(ctx, 'spellbook')).toBe(1);
    grantParcel(ctx, 'sarrow_bottom');
    expect(auctionCandidateWeight(ctx, 'spellbook')).toBe(3);
    expect(auctionCandidateWeight(ctx, 'heirloom')).toBe(1);
  });

  it('puts lots on the calendar, years ahead of the sale', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lots = announceAuction(ctx, testRng('auction'));
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) {
      expect(lot.saleYear).toBeGreaterThan(ctx.world.year);
      expect(ctx.world.auction.upcoming).toContainEqual(lot);
    }
  });

  it('never offers a spellbook already on the shelf', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.spellbooks[0]!;
    ctx.world.library.set(def.id, { id: def.id, acquiredYear: ctx.world.year, condition: 100 });

    for (let seed = 1; seed <= 20; seed++) {
      const lots = announceAuction(ctx, testRng('auction', seed));
      expect(lots.some((l) => l.kind === 'spellbook' && l.refId === def.id)).toBe(false);
    }
  });
});

describe('bidding at auction', () => {
  it('refuses a bid on a lot that does not exist', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    expect(bidAtAuction(ctx, 'nothing', 'coin', 500).ok).toBe(false);
  });

  it('refuses an heirloom bid the house does not hold', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const [lot] = announceAuction(ctx, testRng('auction'));
    expect(bidAtAuction(ctx, lot!.id, 'heirloom', 0, 'nothing_the_house_owns').ok).toBe(false);
  });

  it('a winning coin bid grants a spellbook and charges the treasury', () => {
    const ctx = bootstrap(bundle, 4242, 1042);
    ctx.world.treasury = 5000;
    let lot;
    for (let i = 0; i < 200 && !lot; i++) {
      const lots = announceAuction(ctx, testRng('auction-find', i));
      lot = lots.find((l) => l.kind === 'spellbook');
      if (!lot) ctx.world.auction.upcoming = [];
    }
    expect(lot, 'never rolled a spellbook lot to test against').toBeTruthy();

    /**
     * A WINNING bid, computed rather than assumed.
     *
     * This was `reserveCoin + 500`, which is a winning bid against some books
     * and not others: `bestRivalBid` lets any house whose `motives` name the
     * lot's affinity pay up to its `bidsUpTo`, and the Church's is 2,000. The
     * test passed for as long as this seed happened to draw a book nobody
     * wanted, and the first content drop that shifted the stream drew
     * `greater_workings_of_light` at a reserve of 429 instead — so a 929-crown
     * bid lost to the Church and "a winning coin bid grants a spellbook"
     * failed on a mechanism that was working perfectly.
     *
     * Third time this repo has learned it (CLAUDE.md, Tests): assert the
     * mechanism, not a seed reaching a state. The ceiling comes off the
     * content, so a house given a richer motive tomorrow cannot re-break it.
     */
    const rivalCeiling = Math.max(0, ...bundle.houses.flatMap((h) => h.motives.map((m) => m.bidsUpTo)));
    const before = ctx.world.treasury;
    bidAtAuction(ctx, lot!.id, 'coin', Math.max(lot!.reserveCoin + 500, rivalCeiling + 1));
    ctx.world.year = lot!.saleYear;
    resolveDueLots(ctx, false);

    expect(ctx.world.library.has(lot!.refId)).toBe(true);
    expect(ctx.world.treasury).toBeLessThan(before);
    expect(ctx.world.auction.history.some((h) => h.lot.id === lot!.id && h.winner === 'player')).toBe(true);
  });

  it('an heirloom bid removes the traded heirloom rather than spending coin', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    // An HEIRLOOM lot by preference. This used to take a chronicle page as a
    // fallback, from when heirloom lots were scarce; a page's reserve is set by
    // the Discrepancy's severity rather than by the portion's worth, so the
    // fallback quietly turned "does an heirloom bid trade the heirloom" into
    // "is one portion worth a major Discrepancy", which it is not.
    // An heirloom lot the heirloom currency can actually win. `bidValue` puts a
    // flat 450 on any traded heirloom and an heirloom lot reserves between 250
    // and 650, so half of them are unwinnable with a portion however good it
    // is — which is a real thing about the currency and not what this test is
    // about. It is about whether winning trades the object instead of coin.
    let lot;
    for (let i = 0; i < 200 && !lot; i++) {
      const lots = announceAuction(ctx, testRng('auction-h', i));
      lot = lots.find((l) => l.kind === 'heirloom' && l.reserveCoin <= 450);
      if (!lot) ctx.world.auction.upcoming = [];
    }
    expect(lot, 'never rolled an heirloom lot a portion could win').toBeTruthy();

    // ONE LOT ON THE TABLE, which this test used to get for free. An
    // announcement is one to three lots and the loop above kept whichever one
    // it wanted, leaving its siblings on the calendar; the steward now bids in
    // a PLAYED year as well as a chronicler-driven one, so those siblings sold
    // too and the treasury moved for reasons that have nothing to do with the
    // heirloom currency. This test is about what winning CHARGES.
    ctx.world.auction.upcoming = [lot!];

    const treasuryBefore = ctx.world.treasury;
    bidAtAuction(ctx, lot!.id, 'heirloom', 0, 'portion_of_fertility');
    ctx.world.year = lot!.saleYear;
    resolveDueLots(ctx, false);

    expect(ctx.world.treasury).toBe(treasuryBefore);
    expect(ctx.world.heirlooms.has('portion_of_fertility')).toBe(false);
  });

  it('a lot with no bid and no interested rival sells to nobody', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    // A heirloom lot draws no rival competition at all (issue #17 scope: rival
    // bidding is modelled for spellbook affinities only).
    const lot = {
      id: 'test_lot_nobody', kind: 'heirloom' as const, refId: 'portion_of_agelessness',
      house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3,
      reserveCoin: 400,
    };
    ctx.world.auction.upcoming = [lot];
    // AND THE HOUSE CANNOT PAY. The steward bids in every year now, played or
    // not, so "nobody bid" is a house with nothing to bid WITH rather than a
    // flag on the call — which is what it always meant, and now says.
    ctx.world.treasury = 0;
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);
    expect(ctx.world.auction.history.some((h) => h.lot.id === lot.id && h.winner === 'nobody')).toBe(true);
  });
});

describe('named rival bidders (issue #17)', () => {
  it('House Marrow outbids a modest player offer for a Death spellbook', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot = {
      id: 'test_lot', kind: 'spellbook' as const, refId: 'the_marrow_codex',
      house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3,
      reserveCoin: ctx.content.mustSpellbook('the_marrow_codex').price.min,
    };
    ctx.world.auction.upcoming = [lot];
    ctx.world.treasury = 5000;

    bidAtAuction(ctx, lot.id, 'coin', 50); // far under House Marrow's bidsUpTo: 800
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);

    const outcome = ctx.world.auction.history.find((h) => h.lot.id === lot.id)!;
    expect(outcome.winner).toBe('rival');
    expect(outcome.winningHouse).toBe('house_marrow');
    expect(ctx.world.library.has('the_marrow_codex')).toBe(false);
  });

  it('a player bid above every rival motive wins it outright', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot = {
      id: 'test_lot_2', kind: 'spellbook' as const, refId: 'the_marrow_codex',
      house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3,
      reserveCoin: ctx.content.mustSpellbook('the_marrow_codex').price.min,
    };
    ctx.world.auction.upcoming = [lot];
    ctx.world.treasury = 5000;

    bidAtAuction(ctx, lot.id, 'coin', 1200); // above House Marrow's bidsUpTo: 800
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);

    expect(ctx.world.library.has('the_marrow_codex')).toBe(true);
  });
});

describe('the chronicle page, and who reads it (issues #17, #74)', () => {
  /**
   * Issue #17's acceptance test, re-pointed by issue #74's decision.
   *
   * It used to assert that the HOUSE buying its own incriminating page proved
   * the lie. That was the only path by which a lie was ever proven, and a
   * rival winning the same lot was a no-op — so the incentive ran backwards:
   * with §29.3's third bite billing a STANDING lie at the term and excluding
   * proven ones, buying the evidence against yourself was a way to launder it,
   * and letting a rival take it was free.
   *
   * The two branches now mean two different things, which is #74's acceptance
   * clause in one sentence: the house buries, a rival proves.
   */
  it('the house buys its own page and buries it', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.discrepancies.set('test_discrepancy', {
      severity: 'major', provableBy: ['house_marrow'], state: 'open',
    });
    ctx.world.treasury = 5000;

    // 200 announcements, not 20. This loop is looking for a FIXTURE — one lot
    // of the right kind to run the assertions against — and a page is a few
    // per cent of each pick, so twenty was about two expected hits and landed
    // on zero the first time the lot pool changed shape underneath it.
    let lot;
    for (let i = 0; i < 200 && !lot; i++) {
      const lots = announceAuction(ctx, testRng('proof', i));
      lot = lots.find((l) => l.kind === 'chronicle_page' && l.refId === 'test_discrepancy');
      if (!lot) ctx.world.auction.upcoming = [];
    }
    expect(lot, 'never rolled the discrepancy-proving lot').toBeTruthy();

    // Comfortably over `PAGE_MOTIVE` — the house named in `provableBy` now
    // bids for this page too, so buying your own evidence is a thing you have
    // to actually win rather than a formality.
    bidAtAuction(ctx, lot!.id, 'coin', lot!.reserveCoin * 3);
    ctx.world.year = lot!.saleYear;
    resolveDueLots(ctx, false);

    expect(ctx.world.discrepancies.get('test_discrepancy')?.state).toBe('buried');
    expect(ctx.world.auction.history.some((h) => h.lot.id === lot!.id && h.winner === 'player')).toBe(true);
  });

  it('a rival buys the same page and proves it, and the house pays a Respect tier', () => {
    // THE BRANCH THAT DID NOTHING AT ALL (issue #74). Same fixture, same lot,
    // one difference: the house is outbid. §6 — "A Discrepancy that is proven
    // costs a full Respect tier and seeds a scandal event chain."
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.discrepancies.set('test_discrepancy', {
      severity: 'major', provableBy: ['house_marrow'], state: 'open',
    });
    ctx.world.treasury = 5000;

    let lot;
    for (let i = 0; i < 200 && !lot; i++) {
      const lots = announceAuction(ctx, testRng('proof', i));
      lot = lots.find((l) => l.kind === 'chronicle_page' && l.refId === 'test_discrepancy');
      if (!lot) ctx.world.auction.upcoming = [];
    }
    expect(lot, 'never rolled the discrepancy-proving lot').toBeTruthy();

    const respectBefore = ctx.world.respect;
    // No player bid, no standing order, and no money for the steward's floor
    // to bid with — `autoBid` bids on any lot the house can afford, so a
    // solvent house takes this page every time and the rival branch is
    // unreachable. Broke is how a rival gets one.
    ctx.world.bidCeiling = 0;
    ctx.world.treasury = 0;
    ctx.world.year = lot!.saleYear;
    resolveDueLots(ctx, false);

    const outcome = ctx.world.auction.history.find((h) => h.lot.id === lot!.id)!;
    expect(outcome.winner, 'the rival did not take the lot').toBe('rival');
    expect(ctx.world.discrepancies.get('test_discrepancy')?.state).toBe('proven');
    expect(ctx.world.respect, 'a proven lie costs a full Respect tier').not.toBe(respectBefore);

    // And it is findable. "A consequence a player can find in the chronicle"
    // is #74's own acceptance clause, and a state change nobody is told about
    // is the thing this repository fails by.
    expect(ctx.world.chronicle.some((e) => e.title === 'Read By Somebody Else')).toBe(true);
  });

  /**
   * The property is "the page RESOLVES with nobody at the wheel", and one seed
   * cannot carry it. The great sale comes round every sixty to ninety years,
   * so a run offers about thirteen auctions; a page is a few per cent of each
   * pick; the expectation over one seed is close to one. That is a coin flip,
   * and it read as a passing test for as long as the coin kept landing — it
   * stopped the first time the lot pool changed shape under it.
   *
   * What "resolves" means changed with issue #74, and the assertion changed
   * with it. Before, the only terminal state a page could reach was `proven`,
   * because the house was the only bidder that existed for it. Now the lot has
   * two ways out — the house buries it, or the rival named in `provableBy`
   * proves it — and BOTH are asserted to occur across the batch, which is
   * #74's acceptance clause in the only form worth having it: the two branches
   * do not resolve to the same effect, measured in real runs rather than
   * argued about.
   */
  it('the page resolves either way with nobody at the wheel (tickAuction)', () => {
    const seeds = [4242, 1042, 77, 909, 5150, 31, 606, 1234];

    /** Play one headless run holding exactly one open lie, and see how it ends. */
    const settle = (seed: number, severity: 'minor' | 'major') => {
      const ctx = bootstrap(bundle, seed, 1042);
      ctx.world.discrepancies.set('test_discrepancy_2', {
        severity, provableBy: ['house_marrow'], state: 'open',
      });

      for (let y = 0; y < 1000; y++) {
        // Topped up every year on purpose. `autoBid` bids on ANY lot it can
        // afford down to the debt floor, so across fifteen sales it buys
        // whatever is on the table — and the library drop took the spellbook
        // pool from eleven to twenty-one, which doubled what the chronicler
        // spends before a chronicle page ever comes up. The page lots did
        // appear in every seed; the house was broke by then. This test is
        // about who WINS the page, so it holds solvency still and lets the
        // motive be the only variable.
        ctx.world.treasury = 5000;
        ctx.world.year += 1;
        // The seed goes into the auction's RNG salt, and that is the whole
        // reason this is eight samples rather than one run written out eight
        // times: `tickAuction` is driven entirely by the rng it is handed, so
        // salting on the year alone gave every "seed" here an identical
        // sequence of sales. A page is a few per cent of each pick and about
        // one expected hit per run, so a single sample was a coin flip wearing
        // the shape of a deterministic test.
        tickAuction(ctx, testRng('auction', seed, ctx.world.year), true);
        const state = ctx.world.discrepancies.get('test_discrepancy_2')?.state;
        if (state && state !== 'open') return state;
      }
      return 'open';
    };

    const minor = seeds.map((s) => settle(s, 'minor'));
    const major = seeds.map((s) => settle(s, 'major'));

    // The page reaches the table at all — the control, and the thing that
    // broke the last time the lot pool changed shape.
    expect(
      [...minor, ...major].filter((o) => o !== 'open').length,
      'the page never came up for sale in any run of either batch',
    ).toBeGreaterThan(0);

    // And the two branches are not the same effect, which is #74's acceptance
    // clause. A minor embarrassment is inside the steward's standing
    // willingness and he buries it without troubling anybody; a major one is
    // over it, and a house with nobody at the wheel loses the page to the
    // rival who can prove it.
    expect(minor, 'the steward stopped burying the small ones').toContain('buried');
    expect(minor, 'a rival took a minor page — the severity split is not biting').not.toContain('proven');
    expect(major, 'a rival never took a major page — the branch is unreachable again').toContain('proven');
  });
});

/**
 * THE STANDING ORDER, WHICH NOTHING READ (issue #41; invariant 11).
 *
 * `world.bidCeiling` was set by the `bid` table order, printed by the client
 * as "the house will bid up to N at the next auction", saved and loaded — and
 * never once looked at by this file. The player's whole lever on the Library
 * was wired to nothing, and rivals took eleven to sixteen of the twenty-odd
 * book lots in a thousand-year run.
 */
describe('how high the house will go', () => {
  const contested = (ctx: ReturnType<typeof bootstrap>) => ({
    id: 'test_lot_ceiling', kind: 'spellbook' as const, refId: 'the_marrow_codex',
    house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3,
    reserveCoin: ctx.content.mustSpellbook('the_marrow_codex').price.min,
  });

  it('loses a contested lot when the house has said nothing', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.treasury = 5000;
    ctx.world.bidCeiling = 0;
    const lot = contested(ctx);
    ctx.world.auction.upcoming = [lot];
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);

    // The steward pays the reserve and a fifth, which is under House Marrow's
    // 800. A floor is not a strategy.
    expect(ctx.world.auction.history.find((h) => h.lot.id === lot.id)!.winner).toBe('rival');
    expect(ctx.world.library.has('the_marrow_codex')).toBe(false);
  });

  it('wins the same lot when the player has raised the ceiling over the rival', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.treasury = 5000;
    const rivalCeiling = Math.max(0, ...bundle.houses.flatMap((h) => h.motives.map((m) => m.bidsUpTo)));
    expect(order(ctx, { kind: 'bid', ceiling: rivalCeiling + 200 }).ok).toBe(true);
    const lot = contested(ctx);
    ctx.world.auction.upcoming = [lot];
    ctx.world.year = lot.saleYear;
    const before = ctx.world.treasury;
    resolveDueLots(ctx, false);

    expect(ctx.world.auction.history.find((h) => h.lot.id === lot.id)!.winner).toBe('player');
    expect(ctx.world.library.has('the_marrow_codex')).toBe(true);
    // A ceiling is a LIMIT, not a price: the house pays what the lot took, and
    // never the whole of what it said it would go to.
    expect(before - ctx.world.treasury).toBeLessThanOrEqual(rivalCeiling + 200);
    expect(before - ctx.world.treasury).toBeGreaterThanOrEqual(lot.reserveCoin);
  });

  it('never bids past what the house holds, however high the order', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.treasury = 50;
    expect(order(ctx, { kind: 'bid', ceiling: 9000 }).ok).toBe(true);
    const lot = contested(ctx);
    ctx.world.auction.upcoming = [lot];
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);

    expect(ctx.world.library.has('the_marrow_codex')).toBe(false);
    expect(ctx.world.treasury).toBe(50);
  });
});

describe('the auction pages speak the reader\'s setting (#745)', () => {
  const PAGES: Record<string, [string, string]> = {
    'auction.book_search': [
      'The house paid a Sarrow broker {FEE} crowns to seek {BOOK}. He promised a sale in {YEAR}, at a reserve of {RESERVE}.',
      'The family paid a broker in Sarrow {FEE} crowns to find {BOOK}. He promised it would be sold in {YEAR}, starting at {RESERVE}.',
    ],
    'auction.announced_title': ['A Sale Announced', 'An Auction Is Coming'],
    'auction.announced': [
      "Word came that there would be an auction in {YEAR}, and that it was worth the family's attention.",
      'The family heard there would be an auction worth watching in {YEAR}.',
    ],
    'auction.bought_book': ['The house bought a copy of {BOOK} at auction.', 'The family bought a copy of {BOOK} at auction.'],
    'auction.bought_heirloom': ['The house bought {HEIRLOOM} at auction.', 'The family bought {HEIRLOOM} at auction.'],
    'auction.buried_title': ['Bought and Buried', 'Bought and Hidden'],
    'auction.buried': [
      'A page came up for sale that named the family directly, and the house bought it before anyone else could. Nobody else read it. Nobody else ever will.',
      'A page about the family went up for sale, and the family bought it first. No one else will ever read it.',
    ],
    'auction.read_elsewhere_title': ['Read By Somebody Else', 'Someone Else Read It'],
    'auction.read_elsewhere': [
      '{SELLER} outbid the house for a page that named the family directly, and took it home to read at leisure. What it proved could no longer be unproved.',
      '{SELLER} paid more for a page about the family and took it home. What it proved can no longer be denied.',
    ],
    'auction.outbid': [
      '{SELLER} outbid the house for the lot, and took it home instead.',
      '{SELLER} paid more than the family and took the lot.',
    ],
  };
  type Mode = 'original' | 'plainenglish';
  const say = (mode: Mode, key: string, v: Record<string, string> = {}) =>
    PAGES[key]![mode === 'original' ? 0 : 1].replace(/\{([A-Z]+)\}/g, (_, k: string) => v[k]!);

  function world(mode: Mode, names: { address: string; of: string; plainenglish: string }[] = []): SimCtx {
    const ctx = bootstrap(bundle, 1042, 1042);
    setProseVariants(ctx, [
      ...Object.entries(PAGES).map(([key, [original, plain]]) => ({
        address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
      })),
      ...names,
    ]);
    setProseMode(ctx, mode);
    ctx.world.treasury = 10_000;
    return ctx;
  }

  /** One hand-built lot to its sale year, with or without a bid on it. */
  function sell(ctx: SimCtx, lot: Omit<AuctionLot, 'announcedYear' | 'saleYear'>, bid?: number) {
    const full = { ...lot, announcedYear: ctx.world.year, saleYear: ctx.world.year + 3 } as AuctionLot;
    ctx.world.auction.upcoming = [full];
    if (bid !== undefined) bidAtAuction(ctx, full.id, 'coin', bid);
    ctx.world.year = full.saleYear;
    resolveDueLots(ctx, false);
    return ctx.world.chronicle.at(-1)!;
  }

  const ceiling = Math.max(0, ...bundle.houses.flatMap((h) => h.motives.map((m) => m.bidsUpTo)));
  const marrow = bundle.houses.find((h) => h.id === 'house_marrow')!.name;
  const codex = { id: 'lot_codex', kind: 'spellbook' as const, refId: 'the_marrow_codex', house: 'house_marrow', reserveCoin: 50 };
  const page = { id: 'lot_page', kind: 'chronicle_page' as const, refId: 'test_discrepancy', house: 'house_marrow', reserveCoin: 100 };
  const withLie = (ctx: SimCtx) => {
    ctx.world.discrepancies.set('test_discrepancy', { severity: 'major', provableBy: ['house_marrow'], state: 'open' });
    return ctx;
  };

  for (const mode of ['original', 'plainenglish'] as const) {
    it(`renders every auction page in ${mode}`, () => {
      const searching = world(mode);
      const minor = bundle.spellbooks.find((b) => b.tier === 'minor' && !searching.world.library.has(b.id))!;
      const year = searching.world.year;
      expect(commissionBook(searching, minor.id).ok).toBe(true);
      const due = searching.world.auction.upcoming.at(-1)!;
      expect(searching.world.chronicle.at(-1)!.text).toBe(say(mode, 'auction.book_search', {
        FEE: '25', BOOK: minor.name, YEAR: String(due.saleYear), RESERVE: String(due.reserveCoin),
      }));
      expect(due.saleYear).toBeGreaterThan(year);

      const announcing = world(mode);
      const lots = announceAuction(announcing, testRng('pages', mode));
      const notice = announcing.world.chronicle.at(-1)!;
      expect(lots.length).toBeGreaterThan(0);
      expect(notice.title).toBe(say(mode, 'auction.announced_title'));
      expect(notice.text).toBe(say(mode, 'auction.announced', { YEAR: String(lots[0]!.saleYear) }));

      expect(sell(world(mode), codex, ceiling + 1).text)
        .toBe(say(mode, 'auction.bought_book', { BOOK: bundle.spellbooks.find((b) => b.id === 'the_marrow_codex')!.name }));
      expect(sell(world(mode), { ...codex, id: 'lot_h', kind: 'heirloom', refId: 'portion_of_agelessness', reserveCoin: 400 }, 1000).text)
        .toBe(say(mode, 'auction.bought_heirloom', { HEIRLOOM: bundle.heirlooms.find((h) => h.id === 'portion_of_agelessness')!.name }));
      expect(sell(world(mode), codex, 50).text).toBe(say(mode, 'auction.outbid', { SELLER: marrow }));

      const buried = sell(withLie(world(mode)), page, 5000);
      expect([buried.title, buried.text]).toEqual([say(mode, 'auction.buried_title'), say(mode, 'auction.buried')]);

      const lost = withLie(world(mode));
      lost.world.treasury = 0;
      lost.world.bidCeiling = 0;
      const read = sell(lost, page);
      expect([read.title, read.text])
        .toEqual([say(mode, 'auction.read_elsewhere_title'), say(mode, 'auction.read_elsewhere', { SELLER: marrow })]);
      expect(lost.world.discrepancies.get('test_discrepancy')?.state).toBe('proven');

      setProseMode(lost, mode === 'original' ? 'plainenglish' : 'original');
      expect(read.text).toBe(say(mode, 'auction.read_elsewhere', { SELLER: marrow }));
    });
  }


  it.each(['original', 'plainenglish'] as const)(
    'records a renamed rival instead of its authored name in %s mode (#1122)',
    (mode) => {
      const rivalHouse = bundle.houses.find((h) => h.id === 'house_marrow')!;
      const row = {
        address: `content:${bundle.sourceOf(rivalHouse.id)}#houses[id=${encodeURIComponent(rivalHouse.id)}].name`,
        of: proseOriginalHash(rivalHouse.name),
        plainenglish: 'Marrow Family',
      };
      const renamed = 'Marrow House by the River';
      const outbidWorld = world(mode, [row]);
      const live = outbidWorld.world.houses.get(rivalHouse.id);
      if (!live) throw new Error('Expected Marrow house in the world');
      live.name = renamed;
      const outbid = sell(outbidWorld, codex, 50);
      expect(outbid.text).toBe(say(mode, 'auction.outbid', { SELLER: renamed }));
      expect(missingPlainEnglish(outbidWorld)).not.toContain(row.address);
      setProseMode(outbidWorld, mode === 'original' ? 'plainenglish' : 'original');
      expect(outbid.text).toBe(say(mode, 'auction.outbid', { SELLER: renamed }));

      const evidenceWorld = withLie(world(mode, [row]));
      const evidenceHouse = evidenceWorld.world.houses.get(rivalHouse.id);
      if (!evidenceHouse) throw new Error('Expected Marrow house in the world');
      evidenceHouse.name = renamed;
      evidenceWorld.world.treasury = 0;
      evidenceWorld.world.bidCeiling = 0;
      const evidence = sell(evidenceWorld, page);
      expect(evidence.text).toBe(say(mode, 'auction.read_elsewhere', { SELLER: renamed }));
      expect(evidenceWorld.world.discrepancies.get('test_discrepancy')?.state).toBe('proven');
      setProseMode(evidenceWorld, mode === 'original' ? 'plainenglish' : 'original');
      expect(evidence.text).toBe(say(mode, 'auction.read_elsewhere', { SELLER: renamed }));
    },
  );

  it('selects reviewed names in auction Chronicle consumers (#928)', () => {
    const book = bundle.spellbooks.find((b) => b.id === 'the_marrow_codex')!;
    const heirloom = bundle.heirlooms.find((h) => h.id === 'portion_of_agelessness')!;
    const rivalHouse = bundle.houses.find((h) => h.id === 'house_marrow')!;
    const available = world('original');
    const minor = bundle.spellbooks.find((b) => b.tier === 'minor' && !available.world.library.has(b.id))!;

    const reviewed = (collection: string, id: string, original: string, plainenglish: string) => {
      const source = bundle.sourceOf(id);
      expect(source).toBeDefined();
      return {
        address: `content:${source}#${collection}[id=${encodeURIComponent(id)}].name`,
        of: proseOriginalHash(original),
        plainenglish,
      };
    };
    const bookName = 'The Marrow Book in Plain English';
    const heirloomName = 'An Everlasting Potion';
    const houseName = 'Marrow Family';
    const searchName = 'An Ordinary Working in Plain English';
    const rows = [
      reviewed('spellbooks', book.id, book.name, bookName),
      reviewed('spellbooks', minor.id, minor.name, searchName),
      reviewed('heirlooms', heirloom.id, heirloom.name, heirloomName),
      reviewed('houses', rivalHouse.id, rivalHouse.name, houseName),
    ];

    // Each consumer renders selected text when the relevant event occurs.
    const search = world('plainenglish', rows);
    expect(commissionBook(search, minor.id).ok).toBe(true);
    const upcoming = search.world.auction.upcoming.at(-1)!;
    expect(search.world.chronicle.at(-1)!.text).toBe(say('plainenglish', 'auction.book_search', {
      FEE: '25', BOOK: searchName, YEAR: String(upcoming.saleYear), RESERVE: String(upcoming.reserveCoin),
    }));
    expect(missingPlainEnglish(search)).toEqual([]);

    const boughtBook = world('plainenglish', rows);
    const bookPage = sell(boughtBook, codex, ceiling + 1);
    expect(bookPage.text).toBe(say('plainenglish', 'auction.bought_book', { BOOK: bookName }));

    const boughtHeirloom = world('plainenglish', rows);
    const heirloomPage = sell(boughtHeirloom,
      { ...codex, id: 'lot_h', kind: 'heirloom', refId: heirloom.id, reserveCoin: 400 }, 1000);
    expect(heirloomPage.text).toBe(say('plainenglish', 'auction.bought_heirloom', { HEIRLOOM: heirloomName }));

    const rival = world('plainenglish', rows);
    expect(sell(rival, codex, 50).text).toBe(say('plainenglish', 'auction.outbid', { SELLER: houseName }));

    const evidence = withLie(world('plainenglish', rows));
    evidence.world.treasury = 0;
    evidence.world.bidCeiling = 0;
    const evidencePage = sell(evidence, page);
    expect(evidencePage.text).toBe(say('plainenglish', 'auction.read_elsewhere', { SELLER: houseName }));
    expect(evidence.world.discrepancies.get('test_discrepancy')?.state).toBe('proven');

    // Selected wording must never affect lots, bids, the house's holdings or saved Chronicle pages.
    const original = world('original', rows);
    expect(sell(original, codex, ceiling + 1).text)
      .toBe(say('original', 'auction.bought_book', { BOOK: book.name }));
    expect(boughtBook.world.auction.history).toEqual(original.world.auction.history);
    expect(boughtBook.world.library).toEqual(original.world.library);
    setProseMode(boughtBook, 'original');
    setProseMode(evidence, 'original');
    expect(bookPage.text).toBe(say('plainenglish', 'auction.bought_book', { BOOK: bookName }));
    expect(evidencePage.text).toBe(say('plainenglish', 'auction.read_elsewhere', { SELLER: houseName }));

    const stale = world('plainenglish', [{ ...rows[0]!, of: proseOriginalHash(book.name + ' (changed)') }]);
    expect(sell(stale, codex, ceiling + 1).text)
      .toBe(say('plainenglish', 'auction.bought_book', { BOOK: book.name }));
    expect(missingPlainEnglish(stale)).toContain(rows[0]!.address);
  });

  it('changes words only: the same sale moves the same state in both settings', () => {
    const run = (mode: Mode) => {
      const ctx = withLie(world(mode));
      ctx.world.treasury = 0;
      ctx.world.bidCeiling = 0;
      sell(ctx, page);
      return { respect: ctx.world.respect, d: ctx.world.discrepancies.get('test_discrepancy'), h: ctx.world.auction.history };
    };
    expect(run('plainenglish')).toEqual(run('original'));
  });
});

describe('the broker and the bidding table refuse in the reader\'s setting (#800)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./auction.ts', import.meta.url), 'utf8'))
    .filter((entry) => /#auction\.refuse\./.test(entry.address));

  it('keys every refusal', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual({
      'auction.refuse.search_not_minor': 'the broker can seek only a common working',
      'auction.refuse.search_shelved': 'the house has this book already',
      'auction.refuse.search_due': 'a copy is already due at auction',
      'auction.refuse.search_fee': 'the broker asks {FEE} crowns before he leaves',
      'auction.refuse.bid_amount': 'not a valid bid amount',
      'auction.refuse.bid_closed': 'that sale has been held',
      'auction.refuse.bid_favours': 'the house is not owed that many favours',
      'auction.refuse.bid_heirloom_burden': 'a Burden cannot be traded away',
      'auction.refuse.bid_heirloom_pledged': 'that heirloom is already offered for another lot',
      'auction.refuse.bid_heirloom_spent': 'that heirloom is spent',
      'auction.refuse.bid_no_lot': 'no such lot',
      'auction.refuse.bid_no_heirloom': 'the house does not hold that heirloom',
      'auction.refuse.bid_purse': 'the house cannot raise {AMOUNT} crowns',
      'auction.refuse.pledge_head': 'the sitting Head must sign the pledge',
      'auction.refuse.pledge_outstanding': 'the house has already promised a granddaughter',
      'auction.refuse.withdraw_no_lot': 'no such lot',
    });
  });

  it('gives a refused search or bid its Plain English reason, and refuses it all the same', () => {
    const refuse = (mode: 'original' | 'plainenglish') => {
      const ctx = bootstrap(bundle, 1042, 1042);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      ctx.world.treasury = 10_000;
      const minor = bundle.spellbooks.find((b) => b.tier === 'minor' && !ctx.world.library.has(b.id))!;
      const commissioned = commissionBook(ctx, minor.id);
      const due = commissionBook(ctx, minor.id);
      ctx.world.treasury = -10_000;
      const other = bundle.spellbooks.find((b) => b.tier === 'minor' && b.id !== minor.id && !ctx.world.library.has(b.id))!;
      return [
        commissioned, due, commissionBook(ctx, other.id), commissionBook(ctx, 'no_such_book'),
        bidAtAuction(ctx, 'no_such_lot', 'coin', 500), { treasury: ctx.world.treasury, lots: ctx.world.auction.upcoming.length },
      ];
    };
    const original = refuse('original');
    expect(original.map((r) => ('reason' in r ? r.reason : undefined))).toEqual([
      undefined, 'a copy is already due at auction', 'the broker asks 25 crowns before he leaves',
      'the broker can seek only a common working', 'no such lot', undefined,
    ]);
    expect(refuse('plainenglish')).toEqual(original.map((r) => ('reason' in r && r.reason ? { ...r, reason: `plain: ${r.reason}` } : r)));
  });
});

describe('auction bids store only valid numeric amounts (#1057)', () => {
  const invalid = [
    ['empty input', '' as unknown as number],
    ['nonnumeric input', 'not-a-number' as unknown as number],
    ['numeric string', '100' as unknown as number],
    ['negative coins', -1],
    ['fractional coins', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ] as const;

  it.each(invalid)('refuses %s without mutating the scheduled auction or treasury', (_label, amount) => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const [lot] = announceAuction(ctx, testRng('invalid-auction-amount'));
    expect(lot).toBeDefined();
    const beforeAuction = JSON.stringify(ctx.world.auction);
    const beforeChronicle = JSON.stringify(ctx.world.chronicle);
    const beforeTreasury = ctx.world.treasury;

    expect(bidAtAuction(ctx, lot!.id, 'coin', amount).ok).toBe(false);
    expect(JSON.stringify(ctx.world.auction)).toBe(beforeAuction);
    expect(JSON.stringify(ctx.world.chronicle)).toBe(beforeChronicle);
    expect(ctx.world.treasury).toBe(beforeTreasury);
    expect(lot!.playerBid).toBeUndefined();
  });

  it('preserves zero for a valid offered heirloom and integer coin bids', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    const [lot] = announceAuction(ctx, testRng('valid-auction-amount'));
    expect(lot).toBeDefined();

    expect(bidAtAuction(ctx, lot!.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);
    expect(lot!.playerBid).toMatchObject({
      currency: 'heirloom', amount: 0, heirloomOffered: 'portion_of_fertility',
    });
    // A purse that can pay it: since #1183 a coin bid past the debt floor is
    // refused, and this test is about the integer, not the treasury.
    ctx.world.treasury = 1_000;
    expect(bidAtAuction(ctx, lot!.id, 'coin', 500).ok).toBe(true);
    expect(lot!.playerBid).toMatchObject({ currency: 'coin', amount: 500 });
  });
});

describe('the house bids on a lot of its own choosing (#1183)', () => {
  const heirloomLot = (ctx: SimCtx, id = 'test_lot_h'): AuctionLot => ({
    id, kind: 'heirloom', refId: 'portion_of_agelessness',
    house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3, reserveCoin: 400,
  });
  const sell = (ctx: SimCtx, lot: AuctionLot) => {
    ctx.world.year = lot.saleYear;
    resolveDueLots(ctx, false);
    return ctx.world.auction.history.find((h) => h.lot.id === lot.id);
  };

  it('a coin order registers the bid, outbids the rival at the sale, and charges the treasury', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot: AuctionLot = {
      id: 'test_lot_book', kind: 'spellbook', refId: 'the_marrow_codex',
      house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 3,
      reserveCoin: ctx.content.mustSpellbook('the_marrow_codex').price.min,
    };
    ctx.world.auction.upcoming = [lot];
    ctx.world.treasury = 5_000;
    const rivalCeiling = Math.max(0, ...bundle.houses.flatMap((h) => h.motives.map((m) => m.bidsUpTo)));
    const amount = rivalCeiling + 1;

    expect(order(ctx, { kind: 'lotBid', lot: lot.id, bid: { currency: 'coin', amount } })).toEqual({ ok: true });
    expect(lot.playerBid).toMatchObject({ currency: 'coin', amount, house: ctx.world.playerHouse });

    expect(sell(ctx, lot)?.winner).toBe('player');
    expect(ctx.world.library.has('the_marrow_codex')).toBe(true);
    expect(ctx.world.treasury).toBe(5_000 - amount);
  });

  it('an heirloom order trades the heirloom for the lot and spends no coin', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    const lot = heirloomLot(ctx);
    ctx.world.auction.upcoming = [lot];
    const treasury = ctx.world.treasury;

    expect(order(ctx, { kind: 'lotBid', lot: lot.id, bid: { currency: 'heirloom', heirloom: 'portion_of_fertility' } }).ok).toBe(true);
    expect(sell(ctx, lot)?.winner).toBe('player');
    expect(ctx.world.heirlooms.has('portion_of_fertility')).toBe(false);
    expect(ctx.world.heirlooms.has('portion_of_agelessness')).toBe(true);
    expect(ctx.world.treasury).toBe(treasury);
  });

  it('withdrawing hands the lot back to the ceiling and the steward', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot = heirloomLot(ctx);
    ctx.world.auction.upcoming = [lot];
    ctx.world.treasury = 1_000;
    expect(order(ctx, { kind: 'lotBid', lot: lot.id, bid: { currency: 'coin', amount: 500 } }).ok).toBe(true);
    expect(order(ctx, { kind: 'lotBid', lot: lot.id, bid: null }).ok).toBe(true);
    expect(lot.playerBid).toBeUndefined();
    expect(order(ctx, { kind: 'lotBid', lot: 'no_such_lot', bid: null }).ok).toBe(false);
  });

  it('refuses what the house cannot honour, and mutates nothing', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    grantHeirloom(ctx, 'portion_of_agelessness');
    grantHeirloom(ctx, 'the_ring');
    const lot = heirloomLot(ctx, 'test_lot_a');
    const other = { ...heirloomLot(ctx, 'test_lot_b'), refId: 'the_unmirrored_eye' };
    const closed = { ...heirloomLot(ctx, 'test_lot_c'), refId: 'the_forty_leaves', saleYear: ctx.world.year };
    ctx.world.auction.upcoming = [lot, other, closed];
    expect(bidAtAuction(ctx, other.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);
    ctx.world.heirlooms.get('portion_of_agelessness')!.spent = true;

    const before = JSON.stringify({ auction: ctx.world.auction, treasury: ctx.world.treasury, chronicle: ctx.world.chronicle });
    const reasons = [
      bidAtAuction(ctx, closed.id, 'coin', 10),
      bidAtAuction(ctx, lot.id, 'coin', ctx.world.treasury - DEBT_FLOOR + 1),
      // @ts-expect-error retired currency is not a supported new bid
      bidAtAuction(ctx, lot.id, 'favour', 1),
      bidAtAuction(ctx, lot.id, 'heirloom', 0, 'portion_of_agelessness'),
      bidAtAuction(ctx, lot.id, 'heirloom', 0, 'portion_of_fertility'),
      bidAtAuction(ctx, lot.id, 'heirloom', 0, 'the_ring'),
    ].map((r) => (r.ok ? 'ACCEPTED' : r.reason));
    expect(reasons).toEqual([
      'that sale has been held',
      `the house cannot raise ${ctx.world.treasury - DEBT_FLOOR + 1} crowns`,
      'the house is not owed that many favours',
      'that heirloom is spent',
      'that heirloom is already offered for another lot',
      'a Burden cannot be traded away',
    ]);
    expect(JSON.stringify({ auction: ctx.world.auction, treasury: ctx.world.treasury, chronicle: ctx.world.chronicle })).toBe(before);
    // Re-offering the same heirloom on the lot it is already pledged to is a change of mind, not a second pledge.
    expect(bidAtAuction(ctx, other.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);
  });

  it('offers a signed marriage bid at the Table and keeps eligibility consistent across lots (#1184)', () => {
    const ctx = bootstrap(bundle, 1184, 1042);
    const first = heirloomLot(ctx, 'promise_at_table');
    const second = { ...first, id: 'other_promise_at_table' };
    ctx.world.auction.upcoming = [first, second];
    const signer = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.castSlots.includes('head'))!;
    const item = (id: string) => tableView(ctx).auction!.items.find((l) => l.id === id)!;
    expect(item(first.id).marriagePromise).toMatchObject({ available: true, signer: signer.name, term: 40 });
    expect(order(ctx, { kind: 'lotBid', lot: first.id, bid: { currency: 'marriage_promise' } })).toEqual({ ok: true });
    expect(first.playerBid).toEqual({ house: ctx.world.playerHouse, currency: 'marriage_promise', amount: 0, pledgedBy: signer.id });
    expect(item(first.id).bid).toEqual({ currency: 'marriage_promise' });
    expect(item(first.id).marriagePromise!.available).toBe(true);
    const blocked = item(second.id).marriagePromise!;
    expect(blocked.available).toBe(false);
    expect(order(ctx, { kind: 'lotBid', lot: second.id, bid: { currency: 'marriage_promise' } }))
      .toEqual({ ok: false, reason: blocked.reason });
    expect(order(ctx, { kind: 'lotBid', lot: first.id, bid: null })).toEqual({ ok: true });
    expect(item(second.id).marriagePromise!.available).toBe(true);
  });

  it('refuses new favour bids and voids a saved one without spending its legacy balance (#1184)', () => {
    const ctx = bootstrap(bundle, 1184, 1042);
    const lot = heirloomLot(ctx, 'retired_favour_bid');
    ctx.world.auction.upcoming = [lot];
    ctx.world.auction.favours = 10_000;
    expect(BidCurrencyS.options).not.toContain('favour');
    for (const amount of [0, 1, 10_000]) {
      // @ts-expect-error exercise old or untyped callers at the runtime boundary
      expect(bidAtAuction(ctx, lot.id, 'favour', amount).ok).toBe(false);
      expect(lot.playerBid).toBeUndefined();
    }

    // Stored bids and history keep their schema, so existing saves still load.
    lot.playerBid = { house: ctx.world.playerHouse, currency: 'favour', amount: 10_000 };
    const saved = saveGame(ctx);
    const loaded = loadGame(saved, bundle);
    expect(digestOf(loaded)).toBe(digestOf(ctx));
    expect(loaded.world.auction.upcoming[0]!.playerBid?.currency).toBe('favour');
    const treasury = loaded.world.treasury;
    loaded.world.bidCeiling = 0;
    loaded.world.year = lot.saleYear;
    resolveDueLots(loaded, false);
    expect(loaded.world.auction.history[0]!.winner).not.toBe('player');
    expect(loaded.world.auction.favours).toBe(10_000);
    expect(loaded.world.treasury).toBe(treasury);
  });

  it('only real heirloom bids reserve a portion across lots (#1269)', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    ctx.world.treasury = 1_000;
    const coinLot = heirloomLot(ctx, 'test_coin_with_extra_heirloom');
    const otherLot = heirloomLot(ctx, 'test_genuine_heirloom_bid');
    ctx.world.auction.upcoming = [coinLot, otherLot];

    // An extra field from a caller cannot convert a coin bid into a pledge.
    expect(bidAtAuction(ctx, coinLot.id, 'coin', 100, 'portion_of_fertility').ok).toBe(true);
    expect(coinLot.playerBid).toEqual({
      house: ctx.world.playerHouse, currency: 'coin', amount: 100,
    });
    expect(bidAtAuction(ctx, otherLot.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);

    // Nor may an older/external noncanonical bid claim a pledge on load.
    coinLot.playerBid = {
      house: ctx.world.playerHouse, currency: 'favour', amount: 0,
      heirloomOffered: 'portion_of_fertility',
    };
    delete otherLot.playerBid;
    expect(bidAtAuction(ctx, otherLot.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);

    // A second *actual* heirloom pledge is still refused.
    expect(bidAtAuction(ctx, coinLot.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(false);
  });

  it('voids a bid the treasury can no longer cover at the sale, says so, and lets the ceiling bid instead', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot = heirloomLot(ctx);
    ctx.world.auction.upcoming = [lot];
    ctx.world.treasury = 1_000;
    expect(bidAtAuction(ctx, lot.id, 'coin', 900).ok).toBe(true);
    ctx.world.bidCeiling = 500;
    ctx.world.treasury = 600; // 900 is now past the debt floor

    const lines = ctx.world.chronicle.length;
    expect(sell(ctx, lot)?.winner).toBe('player');
    const voided = ctx.world.chronicle.slice(lines).find((e) => /struck the bid out/.test(e.text ?? ''));
    expect(voided, 'a voided bid writes its own line').toBeDefined();
    // The ceiling paid what the lot took (reserve × 1.05), not the void 900.
    expect(ctx.world.treasury).toBe(600 - Math.round(400 * 1.05));
    expect(ctx.world.treasury).toBeGreaterThan(DEBT_FLOOR);
  });

  it('voids an heirloom offer the house no longer holds on the day', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    const lot = heirloomLot(ctx);
    ctx.world.auction.upcoming = [lot];
    expect(bidAtAuction(ctx, lot.id, 'heirloom', 0, 'portion_of_fertility').ok).toBe(true);
    ctx.world.heirlooms.delete('portion_of_fertility');
    ctx.world.treasury = 0; // nor can the steward pay

    expect(sell(ctx, lot)?.winner).toBe('nobody');
    expect(ctx.world.heirlooms.has('portion_of_agelessness')).toBe(false);
  });

  it('a won marriage promise is owed to the house that sold the lot, not to the bidder', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const lot = heirloomLot(ctx);
    ctx.world.auction.upcoming = [lot];
    expect(bidAtAuction(ctx, lot.id, 'marriage_promise', 0).ok).toBe(true);
    expect(sell(ctx, lot)?.winner).toBe('player');
    expect(ctx.world.marriagePromises).toEqual([{ toHouse: 'house_marrow', year: lot.saleYear, lot: lot.refId,
      pledgedBy: lot.playerBid!.pledgedBy }]);
    expect(ctx.world.marriagePromises[0]!.toHouse).not.toBe(ctx.world.playerHouse);
  });

  it('the Table names every upcoming lot and the house\'s bid on it, and never a page\'s Discrepancy', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.treasury = 1_000;
    grantHeirloom(ctx, 'portion_of_fertility');
    grantHeirloom(ctx, 'the_ring');
    const lot = heirloomLot(ctx);
    const page: AuctionLot = {
      id: 'test_lot_page', kind: 'chronicle_page', refId: 'secret_discrepancy_id',
      house: 'house_marrow', announcedYear: ctx.world.year, saleYear: ctx.world.year + 5, reserveCoin: 500,
    };
    ctx.world.auction.upcoming = [page, lot];
    expect(bidAtAuction(ctx, lot.id, 'coin', 450).ok).toBe(true);

    const view = tableView(ctx).auction!;
    expect(view.items.map((i) => i.id)).toEqual([lot.id, page.id]);
    expect(view.items[0]).toMatchObject({
      kind: 'heirloom', name: ctx.content.heirloom('portion_of_agelessness')!.name,
      saleYear: lot.saleYear, reserve: 400, bid: { currency: 'coin', amount: 450 },
    });
    expect(view.items[0]!.seller.length).toBeGreaterThan(0);
    expect(view.items[1]!.name).toBe('a page that names the family');
    expect(JSON.stringify(view)).not.toContain('secret_discrepancy_id');
    // A Burden is held but not offered.
    expect(view.heirlooms.map((h) => h.id)).toEqual(['portion_of_fertility']);
  });
});
