import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { ALL_AFFINITIES, asId, type AuctionLot, type TableOrder } from '@ed/schema';
import { GameSession } from '../session.js';
import { order } from '../table.js';
import { grantParcel } from '../land.js';
import { completeStudies } from '../people/library.js';
import { createPracticePolicy, practiceChanges, PRACTICE_VARIANTS } from './mystic-practice-policy.js';
import { createPracticeFunnel, samplePracticeFunnel } from './mystic-practice-funnel.js';
import { resolveDueLots } from '../auction.js';
import { saveGame } from '../save.js';
import { place, testWorld } from '../testing.js';
import { observeFamilyChallenge } from './challenge-observation.js';
import { attachMysticLedger, emptyMysticLedger, firstUseHouseMeans, mysticPayback, noteMysticOrder, noteMysticOutcome, sampleMysticYear, usefulDomainsPerGeneration } from './mystic-accounting.js';
import { meanEvidence, rateEvidence } from './mystic-baseline.js';

const content = loadContent();
const snapshot = (ctx: ReturnType<typeof testWorld>) => ({ ...saveGame(ctx), savedAt: '' });

describe('public Mystic practice experiments (#1942)', () => {
  it('weights observed first-use time by house instead of by its number of duties, keeping censored houses out of the conditional mean', () => {
    const runs = [
      { metrics: { records: { one: { service: { firstUsefulAt: 1 } } } } },
      { metrics: { records: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), { service: { firstUsefulAt: 9 } }])) } },
      { metrics: { records: { censored: { service: {} } } } },
    ];
    const values = firstUseHouseMeans(runs);
    expect(values).toEqual([1, 9]);
    expect(meanEvidence(values)).toMatchObject({ n: 2, mean: 5, standardError: 4 });
  });
  it('keeps idle trained generations in the primary denominator and treats estate scope as one domain', () => {
    const metrics = { trainedGenerations: [0, 1, 2], usefulDomains: { 0: ['estate:small', 'estate:large', 'library_care'], 2: ['conflict'] } };
    const before = JSON.stringify(metrics);
    expect(usefulDomainsPerGeneration({ metrics })).toBe(1);
    expect(JSON.stringify(metrics)).toBe(before);
    expect(usefulDomainsPerGeneration({ metrics: { trainedGenerations: [], usefulDomains: {} } })).toBe(0);
  });
  const make = () => {
    const ctx = testWorld(content);
    ctx.world.treasury = 10_000;
    for (const p of ctx.world.people.all()) { p.spellsKnown = []; p.acquired.health = 0; }
    return { ctx, session: new GameSession(ctx) };
  };
  const learned = (ctx: ReturnType<typeof testWorld>, books: readonly string[]) => {
    const person = place(ctx, { sex: 'male', age: 30, awakened: true });
    person.spellsKnown = books.map(book => asId<typeof person.spellsKnown[number]>(book));
    for (const id of books) ctx.world.library.set(id, { id, condition: 100, acquiredYear: ctx.world.year });
    return person;
  };
  const orders = (session: GameSession, variant: typeof PRACTICE_VARIANTS[number], elapsed = 1) => {
    const sent: TableOrder[] = [];
    createPracticePolicy(variant)(session, content, ALL_AFFINITIES, elapsed, o => { sent.push(o); return true; });
    return sent;
  };

  it('keeps the four single-factor changes separate from the strict-budget control', () => {
    const base = practiceChanges('budgeted_broad');
    expect(Object.values(base).filter(Boolean)).toHaveLength(0);
    for (const variant of PRACTICE_VARIANTS.filter(v => v !== 'budgeted_broad' && v !== 'demand_aware' && v !== 'quoted_demand')) {
      const changed = Object.entries(practiceChanges(variant)).filter(([key, value]) => value !== base[key as keyof typeof base]);
      expect(changed, variant).toHaveLength(1);
    }
    expect(Object.values(practiceChanges('demand_aware')).every(Boolean)).toBe(true);
    expect(practiceChanges('quoted_demand')).toEqual(practiceChanges('demand_aware'));
  });

  it('releases only a five-paid-year duty with no use, without erasing its account', () => {
    const { ctx, session } = make();
    const person = learned(ctx, ['lesser_workings_of_life']);
    expect(order(ctx, { kind: 'mysticAssign', person: person.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
    const duty = ctx.world.mystic.assignments[0]!;
    ctx.world.treasury = 0;
    duty.service.servedYears = 4;
    expect(orders(session, 'release_idle')).toEqual([]);
    duty.service.servedYears = 5;
    expect(orders(session, 'budgeted_broad')).toEqual([]);
    const release = orders(session, 'release_idle');
    expect(release).toEqual([{ kind: 'mysticRelease', assignment: duty.id }]);
    duty.service.usefulYears = 1;
    expect(orders(session, 'release_idle')).toEqual([]);
    duty.service.usefulYears = 0;
    expect(session.order(release[0]!).ok).toBe(true);
    expect(ctx.world.mystic.services[0]!.service.servedYears).toBe(5);
  });

  it('lets an independently trained third reader take a real third duty', () => {
    const { ctx, session } = make();
    grantParcel(ctx, 'hallowfield');
    const carer = learned(ctx, ['lesser_workings_of_life']);
    const warden = learned(ctx, ['lesser_workings_of_terra']);
    learned(ctx, ['lesser_workings_of_light']);
    expect(order(ctx, { kind: 'mysticAssign', person: carer.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
    expect(order(ctx, { kind: 'mysticAssign', person: warden.id, working: 'shoring_the_banks', target: { kind: 'parcel', parcel: 'hallowfield', slots: ['WARDEN'] } }).ok).toBe(true);
    expect(orders(session, 'budgeted_broad')).toEqual([]);
    const sent = orders(session, 'uncapped');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe('mysticAssign');
    expect(session.order(sent[0]!).ok).toBe(true);
    expect(session.table().mystic.duties).toHaveLength(3);
  });

  it('uses the public accepted pairing rather than spending its one attempt on a covered book', () => {
    const { ctx, session } = make();
    const year = session.year;
    ctx.world.library.clear();
    const keeper = learned(ctx, ['lesser_workings_of_light']);
    const spare = learned(ctx, ['lesser_workings_of_light']);
    ctx.world.library.set('lesser_workings_of_life', { id: 'lesser_workings_of_life', condition: 80, acquiredYear: ctx.world.year });
    expect(session.order({ kind: 'mysticAssign', person: keeper.id, working: 'the_copyists_light',
      target: { kind: 'book', book: 'lesser_workings_of_light' } }).ok).toBe(true);
    const photograph = session.table();
    photograph.mystic.offers = photograph.mystic.offers.filter(o => o.working === 'the_copyists_light');
    const facade = { table: () => photograph, view: () => ({ ages: [] }) } as unknown as GameSession;
    const original = orders(facade, 'demand_aware');
    expect(original).toHaveLength(1);
    expect(session.order(original[0]!).ok).toBe(false);
    const quoted = orders(facade, 'quoted_demand');
    expect(quoted).toHaveLength(1);
    expect(quoted[0]).toMatchObject({ kind: 'mysticAssign', person: spare.id, target: { kind: 'book', book: 'lesser_workings_of_life' } });
    expect(session.order(quoted[0]!).ok).toBe(true);
    expect(session.year).toBe(year);
  });

  it('considers an already learned construction working outside the old four-year window', () => {
    const { ctx, session } = make();
    grantParcel(ctx, 'hallowfield');
    const working = content.mysticWorking('the_foundation_line')!;
    learned(ctx, working.books);
    // Isolate this public offer so the difference is the project window alone.
    const photograph = session.table();
    photograph.mystic.offers = photograph.mystic.offers.filter(o => o.working === working.id);
    const facade = { table: () => photograph, view: () => ({ ages: [] }) } as unknown as GameSession;
    expect(orders(facade, 'budgeted_broad', 1)).toEqual([]);
    const sent = orders(facade, 'projects_yearly', 1);
    expect(sent).toHaveLength(1);
    expect(session.order(sent[0]!).ok).toBe(true);
  });

  it('ranks from previously seen public use after an account leaves the six-row history', () => {
    const { ctx, session } = make();
    learned(ctx, ['lesser_workings_of_life', 'greater_workings_of_life', 'lesser_workings_of_light']);
    const patient = place(ctx, { sex: 'female', age: 30, awakened: true });
    patient.acquired.health = -8;
    const table = session.table();
    table.mystic.offers = table.mystic.offers.filter(o => ['the_mending_watch', 'the_copyists_light'].includes(o.working));
    expect(table.mystic.offers.every(o => o.practitioners.length && o.targets.length)).toBe(true);
    const facade = { table: () => table, view: () => ({ ages: [] }), get ctx(): never { throw Error('policy read private state'); } } as unknown as GameSession;
    const policy = createPracticePolicy('observed_rank');
    const observed = { id: 'old', person: 'old-reader', name: 'Former reader', place: 'The hall', status: 'serving' as const,
      ready: 1042, upkeep: 1, working: 'the_mending_watch', workingName: 'The Mending Watch',
      service: { servedYears: 15, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: 20 } };
    table.treasury = 0;
    table.mystic.duties = [observed];
    policy(facade, content, ALL_AFFINITIES, 1, () => true);
    table.mystic.duties = [{ ...observed, id: 'other', working: 'the_copyists_light', workingName: 'The Copyist’s Light',
      service: { ...observed.service, usefulYears: 15 } }];
    policy(facade, content, ALL_AFFINITIES, 2, () => true);
    table.mystic.duties = []; table.mystic.history = []; table.treasury = 1000;
    const sent: TableOrder[] = [];
    policy(facade, content, ALL_AFFINITIES, 3, o => { sent.push(o); return true; });
    expect(sent[0]).toMatchObject({ kind: 'mysticAssign', working: 'the_copyists_light' });
    expect(orders(facade, 'budgeted_broad', 3)[0]).toMatchObject({ kind: 'mysticAssign', working: 'the_mending_watch' });
  });

  it('counts observed starts and completed study separately from pre-existing knowledge', () => {
    const { ctx } = make();
    const reader = learned(ctx, []), book = content.spellbook('lesser_workings_of_life')!;
    ctx.world.library.set(book.id, { id: book.id, condition: 100, acquiredYear: ctx.world.year });
    const funnel = createPracticeFunnel(ctx);
    ctx.world.studies.push({ person: reader.id, book: book.id, completes: ctx.world.year + 1 });
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byAffinity.life).toMatchObject({ initialKnownBooks: 0, studyStarts: 1, studyCompletions: 0 });
    ctx.world.year++;
    completeStudies(ctx);
    expect(reader.spellsKnown).toContain(book.id);
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byAffinity.life).toMatchObject({ studyStarts: 1, studyCompletions: 1 });
    expect(funnel.byWorking.sickroom_watch).toMatchObject({ studyStarts: 1, studyCompletions: 1, readerYears: 1 });
    const arrival = learned(ctx, ['lesser_workings_of_life']);
    expect(arrival.spellsKnown).toContain(book.id);
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byAffinity.life).toMatchObject({ studyCompletions: 1, newlyKnownWithoutObservedStudy: 1 });
  });

  it('distinguishes an absent collaborator from a second book known by the same occupied body', () => {
    const { ctx } = make();
    grantParcel(ctx, 'hallowfield');
    const working = content.mysticWorking('setting_the_culverts')!;
    const partner = content.mysticWorking(working.collaborator!)!;
    learned(ctx, [...new Set([...working.books, ...partner.books])]);
    const funnel = createPracticeFunnel(ctx);
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byWorking[working.id]).toMatchObject({ freeReaderYears: 1, missingCollaboratorYears: 1, targetYears: 1 });
    const colleague = learned(ctx, partner.books);
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byWorking[working.id]!.missingCollaboratorYears).toBe(1);
    colleague.acquired.health = -25;
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byWorking[working.id]!.missingCollaboratorYears).toBe(2);
  });

  it('keeps free readers, absent targets, occupied readers and affordability separate without changing a save', () => {
    const { ctx } = make();
    const reader = learned(ctx, ['lesser_workings_of_life', 'greater_workings_of_life']);
    const occupied = learned(ctx, ['lesser_workings_of_life', 'greater_workings_of_life']);
    expect(order(ctx, { kind: 'mysticAssign', person: occupied.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
    const funnel = createPracticeFunnel(ctx), before = snapshot(ctx);
    samplePracticeFunnel(ctx, funnel);
    expect(snapshot(ctx)).toEqual(before);
    const recovery = content.mysticWorkings.find(w => w.benefit.kind === 'convalescence' && w.books.every(b => reader.spellsKnown.includes(asId(b))))!;
    expect(funnel.byWorking[recovery.id]).toMatchObject({ bookAccessYears: 1, occupiedReaderYears: 1, freeReaderYears: 1, targetYears: 0, affordableReaderYears: 0 });
    expect(funnel.byWorking.sickroom_watch).toMatchObject({ freeWithTargetYears: 1, affordableReaderYears: 0, assignedYears: 1 });
    reader.acquired.health = -25;
    samplePracticeFunnel(ctx, funnel);
    expect(funnel.byWorking[recovery.id]!.unavailableReaderYears).toBe(1);
  });
});

describe('Mystic baseline accounting (#1872)', () => {
  it('does not report certainty when a sample sees zero or all exposed houses', () => {
    expect(rateEvidence(0, 64)).toEqual({ hits: 0, n: 64, rate: 0, standardError: 1 / 64 });
    expect(rateEvidence(64, 64)).toEqual({ hits: 64, n: 64, rate: 1, standardError: 1 / 64 });
    expect(rateEvidence(0, 0)).toEqual({ hits: 0, n: 0, rate: null, standardError: null });
  });
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
