import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { canBeTaught, type SlotSpec } from '@ed/schema';
import {
  applyEffect, autoMarry, candidatesFor, DEBT_FLOOR, DEMIGOD_AGEING_STOPPED, expectRate, LEDGER_SEARCH_FEE,
  resolveSlots, TUTOR_FEE, TUTOR_GAIN, TUTOR_YEARS, loadGame, newGame, onTheMarket, order, phase, place,
  resumeGame, saveGame, tableView, testRng, testWorld,
  type TableOrder,
} from '@ed/core';

const bundle = loadContent();

describe('searching the old contracts for a Ledger clause', () => {
  const waitingHouse = () => {
    const ctx = testWorld(bundle, 7110, 1400);
    const ascendant = place(ctx, { sex: 'male', age: 35, name: 'The Waiting Man', awakened: true });
    ascendant.rites.push('unmaking');
    ascendant.acquired[DEMIGOD_AGEING_STOPPED] = 1;
    place(ctx, {
      sex: 'male',
      age: 50,
      name: 'The Archivist',
      contract: {
        role: 'archivist',
        term: 'lifetime',
        wage: 3,
        loyalty: 70,
        boundTo: ascendant.id,
        onEmployerDeath: 'passes_to_heir',
        debt: 0,
        knowsSecrets: [],
      },
    });
    ctx.world.treasury = 500;
    return ctx;
  };

  it('recovers one unrecovered clause per year for a waiting Demigod', () => {
    const ctx = waitingHouse();
    const first = [...ctx.content.clauses]
      .filter((clause) => !ctx.world.clausesRecovered.has(clause.id))
      .sort((a, b) => a.weight - b.weight)[0]!;

    const before = ctx.world.clausesRecovered.size;
    const result = order(ctx, { kind: 'seekClause' });
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(LEDGER_SEARCH_FEE);
    expect(ctx.world.clausesRecovered.size).toBe(before + 1);
    expect(ctx.world.clausesRecovered.has(first.id)).toBe(true);
    expect(ctx.world.chronicle.some((entry) => entry.title === first.name)).toBe(true);

    // One deliberate search per year: no same-year button mashing.
    expect(tableView(ctx).ledgerSearch.ready).toBe(false);
    expect(order(ctx, { kind: 'seekClause' }).ok).toBe(false);

    ctx.world.year += 1;
    expect(order(ctx, { kind: 'seekClause' }).ok).toBe(true);
    expect(ctx.world.clausesRecovered.size).toBe(before + 2);
  });

  it('exists only for the Demigod wait and stops at the existing seven-clause gate', () => {
    const notWaiting = testWorld(bundle, 7111, 1400);
    notWaiting.world.treasury = 500;
    const keeper = place(notWaiting, { sex: 'male', age: 50, name: 'Keeper' });
    keeper.contract = {
      role: 'archivist',
      term: 'lifetime',
      wage: 3,
      loyalty: 70,
      boundTo: keeper.id,
      onEmployerDeath: 'passes_to_heir',
      debt: 0,
      knowsSecrets: [],
    };
    expect(order(notWaiting, { kind: 'seekClause' }).ok).toBe(false);

    const enough = waitingHouse();
    for (const clause of enough.content.clauses.slice(0, 7)) enough.world.clausesRecovered.add(clause.id);
    expect(enough.world.clausesRecovered.size).toBeGreaterThanOrEqual(7);
    expect(order(enough, { kind: 'seekClause' }).ok).toBe(false);
  });

  it('does not borrow a rival house record-keeper for the search', () => {
    const ctx = waitingHouse();
    for (const p of ctx.world.people.living()) {
      if (p.contract?.role === 'archivist' || p.contract?.role === 'chronicler') {
        p.contract = undefined;
      }
    }

    const outsider = place(ctx, {
      sex: 'male',
      age: 50,
      name: 'The Marrow Archivist',
      house: 'house_marrow',
    });
    outsider.contract = {
      role: 'archivist',
      term: 'lifetime',
      wage: 3,
      loyalty: 70,
      boundTo: outsider.id,
      onEmployerDeath: 'passes_to_heir',
      debt: 0,
      knowsSecrets: [],
    };

    expect(tableView(ctx).ledgerSearch.ready).toBe(false);
    expect(order(ctx, { kind: 'seekClause' }).ok).toBe(false);
  });

  it('does not borrow a rival house Demigod to unlock the search', () => {
    const ctx = waitingHouse();
    const ours = ctx.world.people.living().find((p) => p.name === 'The Waiting Man')!;
    delete ours.acquired[DEMIGOD_AGEING_STOPPED];

    const outsider = place(ctx, {
      sex: 'male',
      age: 35,
      name: 'The Marrow Demigod',
      house: 'house_marrow',
      awakened: true,
    });
    outsider.rites.push('unmaking');
    outsider.acquired[DEMIGOD_AGEING_STOPPED] = 1;

    expect(tableView(ctx).ledgerSearch.ready).toBe(false);
    expect(order(ctx, { kind: 'seekClause' }).ok).toBe(false);
  });
});

describe('asking a broker for a missing affinity', () => {
  it('pays a search fee now and schedules a named common book for a later sale', () => {
    const ctx = testWorld(bundle, 7109);
    const book = ctx.content.spellbooks.find((b) => b.id === 'lesser_workings_of_aero')!;
    ctx.world.treasury = 500;
    const before = ctx.world.treasury;

    const result = order(ctx, { kind: 'seekBook', book: book.id });
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(25);
    expect(ctx.world.treasury).toBe(before - 25);
    const lot = ctx.world.auction.upcoming.find((l) => l.refId === book.id)!;
    expect(lot.kind).toBe('spellbook');
    expect(lot.saleYear).toBe(ctx.world.year + 12);
    expect(lot.reserveCoin).toBe(book.price.max + 100);
    expect(tableView(ctx).missingPrimers.find((b) => b.book === book.id)?.queued).toBe(true);
    expect(order(ctx, { kind: 'seekBook', book: book.id }).ok).toBe(false);
    expect(ctx.world.chronicle.some((line) => line.text?.includes(book.name))).toBe(true);
  });
});

/**
 * THE TABLE (`table.ts`) — the verbs a player uses on a turn of their own
 * choosing.
 *
 * Every other verb on the session answers a prompt the simulation raised, and
 * the auction, careers and library phases docketed nothing at all. That
 * deleted §13's headline tension by having the simulation decide both halves
 * of it, and it starved the Ascension Ladder four systems upstream: the most
 * books anybody in a thousand-year run ever finished was ONE, because
 * `beginStudy` was reachable only from an authored effect.
 */
/**
 * THE RECEIPT (issue #59).
 *
 * A 120-crown pedigree out of a treasury of 252 was one click with nothing
 * before it and nothing after — the button simply stopped being disabled some
 * time later. §13 means these to hurt ("the money is gone the day it is spent,
 * and the auction is in eleven years"), and a spend the player cannot feel
 * landing does not hurt: it makes the number smaller for reasons they will
 * reconstruct later, wrongly.
 *
 * The receipt is measured around the whole order rather than declared by each
 * case, so what this really guards is that no order can spend the house's
 * money silently — including the ones nobody has written yet.
 */
describe('what an order says it cost', () => {
  it('reports the price and what is left, on an order that charges', () => {
    const ctx = testWorld(bundle, 7101);
    ctx.world.treasury = 500;
    const child = place(ctx, { sex: 'female', age: 12 });

    const result = order(ctx, { kind: 'tutor', person: child.id, attr: 'mind' });
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(TUTOR_FEE);
    expect(result.left).toBe(500 - TUTOR_FEE);
    expect(result.left).toBe(Math.round(ctx.world.treasury));
  });

  it('says nothing about an order that costs nothing', () => {
    const ctx = testWorld(bundle, 7102);
    ctx.world.treasury = 500;
    const daughter = place(ctx, { sex: 'female', age: 19 });

    const result = order(ctx, { kind: 'withhold', person: daughter.id, hold: true });
    expect(result.ok).toBe(true);
    // Not zero — absent. A table decorated with receipts for free things is
    // the noise a receipt is supposed to cut through.
    expect(result.spent).toBeUndefined();
    expect(result.left).toBeUndefined();
  });

  it('says nothing about an order it refused', () => {
    const ctx = testWorld(bundle, 7103);
    // Under the debt floor, not merely empty: the house is allowed to borrow
    // down to DEBT_FLOOR, so a treasury of zero still affords a tutor.
    ctx.world.treasury = DEBT_FLOOR;
    const child = place(ctx, { sex: 'female', age: 12 });

    const result = order(ctx, { kind: 'tutor', person: child.id, attr: 'mind' });
    expect(result.ok).toBe(false);
    expect(result.spent).toBeUndefined();
    expect(Math.round(ctx.world.treasury)).toBe(DEBT_FLOOR);
  });

  /**
   * The claim that matters, over every order the table offers: money never
   * moves without the result saying so. This is the one that catches an order
   * added later that charges quietly.
   */
  it('never moves the treasury without reporting it', () => {
    const ctx = testWorld(bundle, 7104);
    ctx.world.treasury = 5000;
    const child = place(ctx, { sex: 'female', age: 12, name: 'Receipted' });
    const grown = place(ctx, { sex: 'male', age: 20, name: 'Grown' });

    // Typed, NOT cast. An `as never` here let a grade of 'yeoman' and a career
    // of 'soldier' through on the first draft of this test — neither exists,
    // `PEDIGREE_PRICE['yeoman']` came back undefined, and `treasury -=
    // undefined` made the house's money NaN. A real client cannot post either
    // one, and the cast was the only thing that could.
    const orders: TableOrder[] = [
      { kind: 'tutor', person: child.id, attr: 'mind' },
      { kind: 'pedigree', person: grown.id, grade: 'caster' },
      { kind: 'bid', ceiling: 60 },
      { kind: 'withhold', person: child.id, hold: true },
      { kind: 'career', person: grown.id, career: 'military' },
    ];

    let charged = 0;
    for (const o of orders) {
      const before = ctx.world.treasury;
      const result = order(ctx, o);
      const moved = Math.round(before - ctx.world.treasury);
      if (moved !== 0) {
        expect(result.spent, `${o.kind} moved ${moved} crowns and said nothing`).toBe(moved);
        expect(result.left).toBe(Math.round(ctx.world.treasury));
        charged += 1;
      } else {
        expect(result.spent, `${o.kind} charged nothing and issued a receipt`).toBeUndefined();
      }
    }
    expect(charged, 'no order in the list actually charged, so this proved nothing').toBeGreaterThan(0);
  });
});

describe('Age-valued player commissions (#216)', () => {
  it('makes the favoured post cheaper at the Table and charges that displayed price', () => {
    const neutral = testWorld(bundle, 7160);
    neutral.world.treasury = 5_000;
    place(neutral, { sex: 'male', age: 20, name: 'Neutral Son' });
    const ordinary = tableView(neutral).posts.find((post) => post.career === 'military')!;

    const wars = testWorld(bundle, 7160);
    wars.world.treasury = 5_000;
    const son = place(wars, { sex: 'male', age: 20, name: 'War Son' });
    wars.world.age.active = [{
      age: 'the_wars',
      began: wars.world.year,
      named: false,
      paid: { standing: false },
    }];

    const favoured = tableView(wars).posts.find((post) => post.career === 'military')!;
    expect(favoured.fee).toBeLessThan(ordinary.fee);
    expect(favoured.usualFee).toBe(ordinary.fee);

    const result = order(wars, { kind: 'career', person: son.id, career: 'military' });
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(favoured.fee);
    expect(Math.round(wars.world.treasury)).toBe(5_000 - favoured.fee);
  });
});

describe('giving the house an order', () => {
  it('pays for a term of tutoring now, and delivers it in eight years', () => {
    const ctx = testWorld(bundle, 7001);
    ctx.world.treasury = 500;
    const child = place(ctx, { sex: 'female', age: 12 });

    const before = ctx.world.treasury;
    expect(order(ctx, { kind: 'tutor', person: child.id, attr: 'mind' }).ok).toBe(true);
    // §13's tension is that the money is gone and the auction is in eleven
    // years. Spent on the day it is ordered, not on completion.
    expect(ctx.world.treasury).toBe(before - TUTOR_FEE);

    const start = ctx.world.year;
    for (let i = 0; i <= TUTOR_YEARS; i++) {
      phase('table', ctx);
      ctx.world.year += 1;
    }
    // Invariant 6: life's changes go in `acquired`. Writing into the phenotype
    // cache looks like it worked until spring.
    expect(child.acquired.mind).toBe(TUTOR_GAIN);
    expect(ctx.world.year).toBeGreaterThan(start);
  });

  it('refuses what the house cannot pay for, and says why', () => {
    const ctx = testWorld(bundle, 7002);
    ctx.world.treasury = -119;
    const child = place(ctx, { sex: 'male', age: 10 });
    const r = order(ctx, { kind: 'tutor', person: child.id, attr: 'mind' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('crowns');
  });

  it('will not teach a grown man, or a person of another house', () => {
    const ctx = testWorld(bundle, 7003);
    ctx.world.treasury = 900;
    const grown = place(ctx, { sex: 'male', age: 40 });
    expect(order(ctx, { kind: 'tutor', person: grown.id, attr: 'mind' }).ok).toBe(false);
    expect(order(ctx, { kind: 'tutor', person: 'nobody', attr: 'mind' }).ok).toBe(false);
  });

  /**
   * WHAT FORTY CROWNS MAY BE SPENT ON.
   *
   * The order asked only whether the attribute existed, and the client drew
   * its list from `SessionView.attributes` — all nineteen rows — so a house
   * could buy an eight-year term in Madness. Two ways for that to be wrong
   * and both were live: `madness` and `eldritch_power` are read from nothing
   * in the acquired layer, so the term ran and delivered a number nobody
   * consults; `health`, `fertility` and `max_age` ARE read there, by
   * `applyVitality`, so a tutor was a thing you could hire to make a child
   * live longer, and it worked.
   */
  describe('a term is bought in something teachable', () => {
    const teachable = bundle.attributes.filter((a) => canBeTaught(a.kind));
    const not = bundle.attributes.filter((a) => !canBeTaught(a.kind));

    it('refuses every attribute a tutor cannot teach, by name, and charges nothing', () => {
      expect(not.map((a) => String(a.id)).sort())
        .toEqual(['eldritch_power', 'fertility', 'health', 'madness', 'max_age']);

      for (const a of not) {
        const ctx = testWorld(bundle, 7010);
        ctx.world.treasury = 900;
        const child = place(ctx, { sex: 'female', age: 9 });

        const r = order(ctx, { kind: 'tutor', person: child.id, attr: String(a.id) });

        expect(r.ok, String(a.id)).toBe(false);
        expect(r.reason, String(a.id)).toContain(a.name);
        expect(ctx.world.treasury, `${String(a.id)} was refused and still charged`).toBe(900);
        expect(ctx.world.tutoring).toHaveLength(0);
      }
    });

    it('and still teaches every attribute that can be taught', () => {
      expect(teachable.length, 'nothing was teachable, so this proved nothing').toBeGreaterThan(10);
      for (const a of teachable) {
        const ctx = testWorld(bundle, 7011);
        ctx.world.treasury = 900;
        const child = place(ctx, { sex: 'female', age: 9 });
        expect(order(ctx, { kind: 'tutor', person: child.id, attr: String(a.id) }).ok, String(a.id))
          .toBe(true);
      }
    });

    /**
     * The list the client actually draws. Pointing the select at the session's
     * nineteen was the whole bug, and a view that agrees with the order is the
     * only thing that stops it coming back through the other door.
     */
    it('the table offers exactly what the order accepts', () => {
      const ctx = testWorld(bundle, 7012);
      const offered = tableView(ctx).teachable.map((t) => t.attr).sort();
      expect(offered).toEqual(teachable.map((a) => String(a.id)).sort());
      expect(offered).not.toContain('madness');
    });
  });

  it('keeps a daughter off the market when told to, and puts her back', () => {
    // §7: every daughter married outward is power leaving the blood forever,
    // and there was no way to decline to spend her.
    const ctx = testWorld(bundle, 7004);
    const daughter = place(ctx, { sex: 'female', age: 18 });
    expect(order(ctx, { kind: 'withhold', person: daughter.id, hold: true }).ok).toBe(true);
    expect(onTheMarket(ctx, daughter)).toBe(false);
    expect(order(ctx, { kind: 'withhold', person: daughter.id, hold: false }).ok).toBe(true);
    expect(onTheMarket(ctx, daughter)).toBe(true);
  });

  it('takes a standing order on marriage, and keeps it across a save', () => {
    const g = newGame(loadContent(), { seed: 7008 });
    expect(g.table().marriagePolicy).toBe('as_it_falls');

    expect(g.order({ kind: 'marriages', policy: 'in' }).ok).toBe(true);
    expect(g.table().marriagePolicy).toBe('in');

    // A field the save format forgets resets silently on load, which looks
    // exactly like a standing order the house stopped obeying two centuries in.
    const resumed = resumeGame(g.save(), loadContent());
    expect(resumed.table().marriagePolicy).toBe('in');

    expect(g.order({ kind: 'marriages', policy: 'as_it_falls' }).ok).toBe(true);
    expect(g.table().marriagePolicy).toBe('as_it_falls');
  });

  it('names a scion, and keeps it across a save', () => {
    const g = newGame(loadContent(), { seed: 7013 });
    expect(g.table().scion).toBeUndefined();

    const head = g.ctx.world.people.household(g.ctx.world.playerHouse, g.year)
      .find((p) => p.castSlots.includes('head'))!;
    expect(g.table().programmeCandidates).toContainEqual({
      person: head.id,
      name: head.name,
      age: g.year - head.born,
    });
    expect(g.order({ kind: 'scion', person: head.id }).ok).toBe(true);
    expect(g.table().scion).toEqual({ person: head.id, name: head.name });

    // A field the save format forgets resets silently on load, which looks
    // exactly like a programme the house quietly abandoned two centuries in.
    const resumed = resumeGame(g.save(), loadContent());
    expect(resumed.table().scion).toEqual({ person: head.id, name: head.name });

    expect(g.order({ kind: 'scion', person: null }).ok).toBe(true);
    expect(g.table().scion).toBeUndefined();
  });

  it('refuses to name somebody not of the house', () => {
    const ctx = testWorld(bundle, 7014);
    const result = order(ctx, { kind: 'scion', person: 'nobody_at_all' });
    expect(result.ok).toBe(false);
    expect(ctx.world.scion).toBeNull();
  });

  it('marries the scion in, regardless of the house policy on everyone else', () => {
    // Neither candidate's own font matters to this test — `ours` alone is a
    // thousand-point swing in `preferred`'s ranking, which dwarfs anything a
    // font difference could contribute. So this isolates the override itself
    // rather than depending on which of two freshly-generated genomes happens
    // to carry more.
    const ctx = testWorld(bundle, 7015);
    const scion = place(ctx, { sex: 'male', age: 20, name: 'The Named Scion' });
    const insider = place(ctx, { sex: 'female', age: 18, name: 'A Cousin Of The House' });
    const outsider = place(ctx, {
      sex: 'female', age: 18, name: 'A Stranger Entirely', house: 'some_other_house',
    });

    // The house's own policy says marry OUT — the opposite of what the scion
    // is about to do — so this is not the scion coasting on a policy that
    // would have picked the insider anyway.
    ctx.world.marriagePolicy = 'out';
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);

    autoMarry(ctx, testRng('scion-marries-in'));

    expect(scion.marriages).toHaveLength(1);
    expect(scion.marriages[0]!.spouse).toBe(insider.id);
    expect(outsider.marriages).toEqual([]);
  });

  it('does not let the house marry off the daughter it was told to keep', () => {
    // The order used to stop the PLAYER being asked and let `autoMarry` answer
    // in the same spring, which is the order doing the opposite of what it
    // says. Nothing reported it: she was married, correctly, by the code that
    // marries everybody the player is not asked about.
    const ctx = testWorld(bundle, 7005);
    const daughter = place(ctx, { sex: 'female', age: 20, name: 'A Withheld Daughter' });
    order(ctx, { kind: 'withhold', person: daughter.id, hold: true });

    for (let i = 0; i < 12; i++) {
      phase('marriage', ctx);
      ctx.world.year += 1;
    }

    expect(daughter.marriages).toEqual([]);
  });
});
describe('what the table shows', () => {
  it('survives a save and a load with its orders intact', () => {
    const g = newGame(loadContent(), { seed: 7006 });
    g.advance(60);
    const someone = g.ctx.world.people.household(g.ctx.world.playerHouse, g.year)
      .find((p) => g.year - p.born < 20);
    g.ctx.world.treasury = 400;
    if (someone) expect(g.order({ kind: 'tutor', person: someone.id, attr: 'mind' }).ok).toBe(true);
    expect(g.order({ kind: 'bid', ceiling: 350 }).ok).toBe(true);

    const back = resumeGame(g.save(), loadContent());
    expect(back.ctx.world.bidCeiling).toBe(350);
    expect(back.ctx.world.tutoring).toEqual(g.ctx.world.tutoring);
  });
});

/**
 * WHERE THE BOOKS GO (issue #41, the ladder's second half).
 *
 * The steward handed books to `hall(MAIN_BRANCH)` and the ladder paid for it
 * for as long as cadet halls have existed. Measured over six thousand-year
 * runs: the strongest men in the family were living and dying in branch
 * households with nothing to read — power 71.6 and no books in eighty-four
 * years — while the seat's best-read man stood at power 0 with eight of them.
 * §22 wants power and books on the SAME MAN.
 */
describe('the steward and the shelf', () => {
  it('puts a book in front of a reader in a cadet hall', () => {
    const ctx = testWorld(bundle, 7301);
    const book = ctx.content.spellbooks.find((s) => s.threshold === 0)!;
    ctx.world.library.set(book.id, { id: book.id, acquiredYear: ctx.world.year, condition: 100 });

    // Woken: §11's learning gate (issue #79) means an unwoken cousin is not a
    // candidate for a book at all, and this test is about WHICH HALL the
    // steward reaches into, not about who may read.
    const cousin = place(ctx, { sex: 'male', age: 30, branch: 'branch_test', awakened: true });
    expect(cousin.membership[0]!.branch).toBe('branch_test');

    // The steward's diligence is a yearly roll, so this asks whether he is
    // ever offered a book at all, not whether he is offered one this spring.
    for (let i = 0; i < 60 && !ctx.world.studies.length; i++) {
      phase('table', ctx);
      ctx.world.year += 1;
    }
    expect(
      ctx.world.studies.some((s) => s.person === cousin.id),
      'nobody in a cadet hall was ever given a book',
    ).toBe(true);
  });
});

/**
 * THE SCION AT THE SHELF, THE TUTOR AND THE TABLE (issue #61, Stage B).
 *
 * Stage A named a man and biased his marriage. This is the rest of §22's own
 * sentence — power AND books AND mind on the SAME MAN — pointed at whoever
 * that marriage was for, through the doors the steward already had open.
 */
describe('the scion, at the shelf and the table (issue #61, Stage B)', () => {
  it('reads the longest useful book on the shelf, not the shortest, and does not wait for a coin toss', () => {
    const ctx = testWorld(bundle, 7106);
    const zero = ctx.content.spellbooks.filter((s) => s.threshold === 0).sort((a, b) => a.studyYears - b.studyYears);
    const shortest = zero[0]!;
    const longest = zero[zero.length - 1]!;
    // Sanity: the shelf actually offers a real choice, or this proves nothing.
    expect(shortest.studyYears).toBeLessThan(longest.studyYears);
    for (const b of [shortest, longest]) {
      ctx.world.library.set(b.id, { id: b.id, acquiredYear: ctx.world.year, condition: 100 });
    }

    const scion = place(ctx, { sex: 'male', age: 30, name: 'The Scion', awakened: true });
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);

    phase('table', ctx);

    expect(ctx.world.studies.find((s) => s.person === scion.id)?.book).toBe(longest.id);
  });

  it('is bought a term in mind, not whatever the die names, and does not wait for a coin toss', () => {
    const ctx = testWorld(bundle, 7107);
    ctx.world.treasury = 100_000;
    const scion = place(ctx, { sex: 'male', age: 20, name: 'The Scion' });
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);

    phase('table', ctx);

    expect(ctx.world.tutoring.find((t) => t.person === scion.id)?.attr).toBe('mind');
  });

  it('holds no post across his whole career-eligible window, though an identical bystander sometimes does', () => {
    const RUNS = 20;
    const YEARS = 29; // the whole window a post can be bought in: CAREER_AGE to CAREER_AGE_LIMIT
    let scionPlaced = 0;
    let bystanderPlaced = 0;
    for (let i = 0; i < RUNS; i++) {
      const ctx = testWorld(bundle, 7601 + i * 7);
      ctx.world.treasury = 1_000_000;
      const scion = place(ctx, { sex: 'male', age: 16, name: 'The Scion' });
      const bystander = place(ctx, { sex: 'male', age: 16, name: 'A Bystander' });
      expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);

      for (let y = 0; y < YEARS; y++) {
        phase('table', ctx);
        ctx.world.year += 1;
      }
      if (scion.career) scionPlaced += 1;
      if (bystander.career) bystanderPlaced += 1;
    }

    // A hard zero, not a rate: the refusal is `if (p.id === w.scion) continue`,
    // so any placement across twenty seeds is the exclusion failing rather
    // than noise.
    expect(scionPlaced, 'the scion was placed in a post despite the order').toBe(0);
    expectRate({
      what: 'an identical bystander is placed in a post somewhere across the same career-eligible window',
      n: RUNS, hits: bystanderPlaced, floor: 0.5,
    });
  });
});

/**
 * THE PROGRAMME LAPSES OUT LOUD (issue #61, Stage C).
 *
 * `preferred` and the Match both test identity against `w.scion`, so a dead
 * man's id would otherwise just stop matching anybody, silently, and the
 * house would read as though it had never named one at all.
 */
describe('the scion, when he is gone (issue #61, Stage C)', () => {
  it('clears the order, notes when, and writes it down, the year he dies', () => {
    const ctx = testWorld(bundle, 7801);
    const w = ctx.world;
    const scion = place(ctx, { sex: 'male', age: 30, name: 'The Doomed Scion' });
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);

    w.people.kill(scion.id, w.year, 'test');
    const before = w.chronicle.length;
    phase('table', ctx);

    expect(w.scion, 'the stale order was not cleared').toBeNull();
    expect(w.scionVacant).toEqual({ was: scion.id, wasName: scion.name, since: w.year });
    expect(tableView(ctx).scionVacant).toEqual({ was: scion.id, wasName: scion.name, since: w.year });
    expect(w.chronicle.length, 'the lapse was not written down').toBeGreaterThan(before);

    // A field the save format forgets resets silently on load, which looks
    // exactly like a notice the house quietly stopped caring about.
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(resumed.world.scionVacant).toEqual(w.scionVacant);
  });

  it('is silent when nobody was ever named, and silent again once the year is quiet', () => {
    const ctx = testWorld(bundle, 7802);
    const w = ctx.world;
    place(ctx, { sex: 'male', age: 30 }); // a bystander; never named

    const before = w.chronicle.length;
    phase('table', ctx);
    phase('table', ctx);

    expect(w.scionVacant, 'a house that never named anyone has nothing to lapse').toBeUndefined();
    expect(w.chronicle.length).toBe(before);
  });

  it('is answered, either way, by the table giving a new order', () => {
    const ctx = testWorld(bundle, 7803);
    const w = ctx.world;
    const first = place(ctx, { sex: 'male', age: 30, name: 'First' });
    const second = place(ctx, { sex: 'male', age: 25, name: 'Second' });
    order(ctx, { kind: 'scion', person: first.id });
    w.people.kill(first.id, w.year, 'test');
    phase('table', ctx);
    expect(w.scionVacant).toBeDefined();

    expect(order(ctx, { kind: 'scion', person: second.id }).ok).toBe(true);
    expect(w.scionVacant, 'naming a successor did not answer the notice').toBeUndefined();

    // And declining is an answer too — the player is allowed to say "not yet"
    // without the notice standing forever.
    order(ctx, { kind: 'scion', person: second.id }); // stand up a scion again
    w.people.kill(second.id, w.year, 'test');
    phase('table', ctx);
    expect(w.scionVacant).toBeDefined();
    expect(order(ctx, { kind: 'scion', person: null }).ok).toBe(true);
    expect(w.scionVacant, 'explicitly declining did not answer the notice either').toBeUndefined();
  });
});

/**
 * THE HEIR (issue #61, Stage E4). A second name beside the Scion's, so the
 * house is building a PAIR — every rule the Scion gets, one priority tier
 * behind, checked here where the two can actually compete for the same
 * finite thing: the tutor's floor and the season's one dealt hand. The
 * shelf is not one of those (multiple readers can take the same title), so
 * it is tested for reach, not for precedence.
 */
describe('the heir (issue #61, Stage E4)', () => {
  it('names an heir, keeps it across a save, and cannot be the Scion himself', () => {
    const g = newGame(loadContent(), { seed: 7110 });
    expect(g.table().scionHeir).toBeUndefined();

    const household = g.ctx.world.people.household(g.ctx.world.playerHouse, g.year);
    const head = household.find((p) => p.castSlots.includes('head'))!;
    const other = household.find((p) => p.id !== head.id)!;
    expect(g.order({ kind: 'scion', person: head.id }).ok).toBe(true);

    const refused = g.order({ kind: 'scionHeir', person: head.id });
    expect(refused.ok).toBe(false);
    expect(g.table().scionHeir).toBeUndefined();

    expect(g.order({ kind: 'scionHeir', person: other.id }).ok).toBe(true);
    expect(g.table().scionHeir).toEqual({ person: other.id, name: other.name });

    const resumed = resumeGame(g.save(), loadContent());
    expect(resumed.table().scionHeir).toEqual({ person: other.id, name: other.name });

    expect(g.order({ kind: 'scionHeir', person: null }).ok).toBe(true);
    expect(g.table().scionHeir).toBeUndefined();
  });

  it('refuses to name somebody not of the house', () => {
    const ctx = testWorld(bundle, 7111);
    const result = order(ctx, { kind: 'scionHeir', person: 'nobody_at_all' });
    expect(result.ok).toBe(false);
    expect(ctx.world.scionHeir).toBeNull();
  });

  it('vacates the heir\'s slot when he is promoted to Scion, rather than standing as his own heir', () => {
    const ctx = testWorld(bundle, 7112);
    const a = place(ctx, { sex: 'male', age: 30, name: 'First' });
    const b = place(ctx, { sex: 'male', age: 25, name: 'Second' });
    expect(order(ctx, { kind: 'scion', person: a.id }).ok).toBe(true);
    expect(order(ctx, { kind: 'scionHeir', person: b.id }).ok).toBe(true);

    expect(order(ctx, { kind: 'scion', person: b.id }).ok).toBe(true);
    expect(ctx.world.scion).toBe(b.id);
    expect(ctx.world.scionHeir, 'the promoted heir was left standing as his own heir').toBeNull();
  });

  it('marries in too, regardless of the house policy on everyone else', () => {
    const ctx = testWorld(bundle, 7113);
    const heir = place(ctx, { sex: 'male', age: 20, name: 'The Named Heir' });
    const insider = place(ctx, { sex: 'female', age: 18, name: 'A Cousin Of The House' });
    place(ctx, { sex: 'female', age: 18, name: 'A Stranger Entirely', house: 'some_other_house' });

    ctx.world.marriagePolicy = 'out';
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    autoMarry(ctx, testRng('heir-marries-in'));

    expect(heir.marriages).toHaveLength(1);
    expect(heir.marriages[0]!.spouse).toBe(insider.id);
  });

  it('reads too — the longest useful book, not the shortest', () => {
    const ctx = testWorld(bundle, 7114);
    const zero = ctx.content.spellbooks.filter((s) => s.threshold === 0).sort((a, b) => a.studyYears - b.studyYears);
    const shortest = zero[0]!;
    const longest = zero[zero.length - 1]!;
    for (const b of [shortest, longest]) {
      ctx.world.library.set(b.id, { id: b.id, acquiredYear: ctx.world.year, condition: 100 });
    }

    const heir = place(ctx, { sex: 'male', age: 30, name: 'The Heir', awakened: true });
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    phase('table', ctx);

    expect(ctx.world.studies.find((s) => s.person === heir.id)?.book).toBe(longest.id);
  });

  it('holds no post across his whole career-eligible window', () => {
    const ctx = testWorld(bundle, 7115);
    ctx.world.treasury = 1_000_000;
    const heir = place(ctx, { sex: 'male', age: 16, name: 'The Heir' });
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    for (let y = 0; y < 29; y++) { // CAREER_AGE to CAREER_AGE_LIMIT, same window the Scion's own test uses
      phase('table', ctx);
      ctx.world.year += 1;
    }

    expect(heir.career, 'the heir was placed in a post despite the order').toBeUndefined();
  });

  it('reads and is tutored second — the Scion spends the shared floor first', () => {
    // TUTOR_FEE (40) + STEWARD_TUTOR_FLOOR (150): exactly enough for the
    // Scion's own term and no more. If the heir got one too, this is not a
    // tier, it is two Scions.
    const ctx = testWorld(bundle, 7116);
    ctx.world.treasury = 190;
    const scion = place(ctx, { sex: 'male', age: 18, name: 'The Scion' });
    const heir = place(ctx, { sex: 'male', age: 18, name: 'The Heir' });
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    phase('table', ctx);

    expect(ctx.world.tutoring.find((t) => t.person === scion.id)?.attr).toBe('mind');
    expect(ctx.world.tutoring.some((t) => t.person === heir.id), 'the heir was tutored on the Scion\'s own floor').toBe(false);
  });

  it('lapses out loud too, and is answered by a new order, independent of the Scion\'s own', () => {
    const ctx = testWorld(bundle, 7802);
    const w = ctx.world;
    const scion = place(ctx, { sex: 'male', age: 30, name: 'The Scion' });
    const heir = place(ctx, { sex: 'male', age: 25, name: 'The Doomed Heir' });
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    w.people.kill(heir.id, w.year, 'test');
    const before = w.chronicle.length;
    phase('table', ctx);

    // The Scion's own order was never touched by his heir's death.
    expect(w.scion, 'the Scion\'s own order was disturbed by his heir\'s death').toBe(scion.id);
    expect(w.scionHeir, 'the stale heir order was not cleared').toBeNull();
    expect(w.scionHeirVacant).toEqual({ was: heir.id, wasName: heir.name, since: w.year });
    expect(tableView(ctx).scionHeirVacant).toEqual({ was: heir.id, wasName: heir.name, since: w.year });
    expect(w.chronicle.length, 'the lapse was not written down').toBeGreaterThan(before);

    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(resumed.world.scionHeirVacant).toEqual(w.scionHeirVacant);

    expect(order(ctx, { kind: 'scionHeir', person: null }).ok).toBe(true);
    expect(w.scionHeirVacant, 'explicitly declining did not answer the notice').toBeUndefined();
  });
});

/**
 * THE STEWARD'S YEAR REACHES CASTING (issue #127).
 *
 * `runStandingOrders` always knew exactly who it acted on; nothing could ask
 * before `world.stewardYear` existed, so `the_commission_bought` cast any
 * living adult and named a placement scene about a man who, four times in
 * five, held no post. These prove the wiring rather than the fiction: that
 * the three new roles read exactly what the phase wrote, and nothing else.
 */
describe('the steward\'s year (issue #127)', () => {
  const spec = (role: SlotSpec['role']): SlotSpec =>
    ({ role, castBy: 'engine', optional: false, filters: [], bind: 'event' });

  it('newly_placed, newly_taught and set_to_a_book each cast exactly who the phase named', () => {
    const ctx = testWorld(bundle, 7401);
    const placed = place(ctx, { sex: 'male', age: 30, name: 'Placed' });
    const taught = place(ctx, { sex: 'male', age: 15, name: 'Taught' });
    const opened = place(ctx, { sex: 'male', age: 15, name: 'Opened' });
    const bystander = place(ctx, { sex: 'male', age: 40, name: 'Bystander' });
    ctx.world.stewardYear = { placed: [placed.id], taught: [taught.id], opened: [opened.id] };

    expect(candidatesFor(spec('newly_placed'), ctx, {}).map((p) => p.id)).toEqual([placed.id]);
    expect(candidatesFor(spec('newly_taught'), ctx, {}).map((p) => p.id)).toEqual([taught.id]);
    expect(candidatesFor(spec('set_to_a_book'), ctx, {}).map((p) => p.id)).toEqual([opened.id]);

    // And the negative: a role finds nobody at all when the year named nobody
    // for it, rather than falling back to the household the way `family_member`
    // does — a bystander must never read as "newly" anything.
    for (const role of ['newly_placed', 'newly_taught', 'set_to_a_book'] as const) {
      expect(candidatesFor(spec(role), ctx, {}).map((p) => p.id)).not.toContain(bystander.id);
    }
  });

  it('is overwritten wholesale by the table phase, not merged with what a prior year left', () => {
    const ctx = testWorld(bundle, 7402);
    ctx.world.stewardYear = { placed: ['a_ghost'], taught: ['a_ghost'], opened: ['a_ghost'] };

    phase('table', ctx);

    expect(ctx.world.stewardYear.placed, 'last year\'s placement leaked into this year').not.toContain('a_ghost');
    expect(ctx.world.stewardYear.taught, 'last year\'s term leaked into this year').not.toContain('a_ghost');
    expect(ctx.world.stewardYear.opened, 'last year\'s study leaked into this year').not.toContain('a_ghost');
  });

  it('the table phase actually writes who it placed, not merely who it might have', () => {
    const ctx = testWorld(bundle, 7403);
    ctx.world.treasury = 100_000;

    let placed: ReturnType<typeof place> | undefined;
    for (let i = 0; i < 150 && !placed; i++) {
      phase('table', ctx);
      const id = ctx.world.stewardYear.placed[0];
      if (id) placed = ctx.world.people.get(id);
      else ctx.world.year += 1;
    }

    expect(placed, 'the steward never placed anybody in a hundred and fifty years of trying').toBeDefined();
    // The man `world.stewardYear.placed` names actually holds the post, from
    // this exact year — not a guess, and not somebody merely idle nearby.
    expect(placed!.career).toBeDefined();
    expect(placed!.career!.from).toBe(ctx.world.year);
    expect(candidatesFor(spec('newly_placed'), ctx, {}).map((p) => p.id)).toEqual([placed!.id]);
  });

  /**
   * THE ONE CLAIM THE WHOLE #125 EPIC TURNS ON (issue #125, Stage 5).
   *
   * Finding 3 of the epic was that `the_commission_bought` cast ANY adult
   * `family_member` over 17 rather than the man the steward actually bought a
   * place for — a placement scene about nobody in particular. It was fixed by
   * casting SON from `newly_placed` instead (`table.yaml`'s own comment names
   * issue #127). This is the assertion that proves it against the REAL
   * authored event, through the same `resolveSlots` call `ambient`/`docket`
   * use to cast a template for real — not the synthetic `spec()` helper the
   * tests above use, which would stay green even if the shipped content
   * regressed to a bare `family_member`.
   */
  it('the_commission_bought casts SON as the man the steward actually placed, not any adult standing near', () => {
    const ctx = testWorld(bundle, 7405);
    ctx.world.treasury = 200_000;

    let placed: ReturnType<typeof place> | undefined;
    for (let i = 0; i < 150 && !placed; i++) {
      phase('table', ctx);
      const id = ctx.world.stewardYear.placed[0];
      if (id) placed = ctx.world.people.get(id);
      else ctx.world.year += 1;
    }
    expect(placed, 'the steward never placed anybody in a hundred and fifty years of trying').toBeDefined();

    const event = bundle.mustEvent('the_commission_bought');
    const resolved = resolveSlots(event, ctx, testRng(1));

    expect(resolved.ok, resolved.missing).toBe(true);
    expect(resolved.fill.SON).toBe(placed!.id);
    expect(ctx.world.stewardYear.placed).toContain(resolved.fill.SON);
  });
});

/**
 * THE TUTOR EFFECT (issue #128).
 *
 * Before this, no authored event could ever put a child in a term or take
 * one away — `spellbook op: study` was a real verb and the tutor had none,
 * so five templates narrated a system that fired zero times in sixteen
 * played thousand-year runs.
 */
describe('the tutor effect (issue #128)', () => {
  it('begin starts a term and charges the fee, exactly like the player order', () => {
    const ctx = testWorld(bundle, 7501);
    ctx.world.treasury = 500;
    const child = place(ctx, { sex: 'male', age: 12 });

    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'mind', op: 'begin' }, ctx, { X: child.id });

    expect(ctx.world.tutoring).toEqual([{ person: child.id, attr: 'mind', completes: ctx.world.year + TUTOR_YEARS }]);
    expect(ctx.world.treasury).toBe(500 - TUTOR_FEE);
  });

  /**
   * THE TRAP THE ISSUE NAMED BY LINE NUMBER: a second copy of `canBeTaught`
   * is how a term in `madness` shipped once already. This calls the effect,
   * not the order, so it is actually exercising the gate the effect uses.
   */
  it('refuses a body attribute, Madness and Eldritch Power through the SAME gate the order uses', () => {
    const ctx = testWorld(bundle, 7502);
    const child = place(ctx, { sex: 'male', age: 12 });

    for (const attr of ['health', 'madness', 'eldritch_power']) {
      applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr, op: 'begin' }, ctx, { X: child.id });
    }
    expect(ctx.world.tutoring, 'a body attribute, Madness or Eldritch Power was bought a term').toEqual([]);
  });

  it('cancel drops whatever term the target is in, with no refund', () => {
    const ctx = testWorld(bundle, 7503);
    ctx.world.treasury = 500;
    const child = place(ctx, { sex: 'male', age: 12 });
    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'mind', op: 'begin' }, ctx, { X: child.id });
    const afterBegin = ctx.world.treasury;

    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'mind', op: 'cancel' }, ctx, { X: child.id });

    expect(ctx.world.tutoring).toEqual([]);
    expect(ctx.world.treasury, 'cancelling refunded the fee — it never does').toBe(afterBegin);
  });

  it('is a silent no-op on an unknown attribute, or a target already in a term', () => {
    const ctx = testWorld(bundle, 7504);
    const child = place(ctx, { sex: 'male', age: 12 });
    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'no_such_attribute', op: 'begin' }, ctx, { X: child.id });
    expect(ctx.world.tutoring).toEqual([]);

    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'mind', op: 'begin' }, ctx, { X: child.id });
    const before = [...ctx.world.tutoring];
    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'charm', op: 'begin' }, ctx, { X: child.id });
    expect(ctx.world.tutoring, 'a second term opened over the first').toEqual(before);
  });

  it('a term completed through the effect marks `taught`, exactly like one bought at the table', () => {
    const ctx = testWorld(bundle, 7505);
    const child = place(ctx, { sex: 'male', age: 12 });
    applyEffect({ kind: 'tutor', target: { slot: 'X' }, attr: 'mind', op: 'begin' }, ctx, { X: child.id });

    for (let i = 0; i <= TUTOR_YEARS; i++) {
      phase('table', ctx);
      ctx.world.year += 1;
    }

    expect(child.taught).toEqual(['mind']);
  });
});

/**
 * THE STEWARD BUYS TERMS (issue #128). Zero in sixteen played thousand-year
 * runs before this — the only door open was the player's own order, and a
 * harness run gives no orders. `expectRate` is the instrument the rest of
 * this codebase uses for exactly this shape of claim: not "it can happen",
 * but "it happens in most runs, at a rate somebody chose and measured".
 *
 * A household of ten young pupils is BUILT, rather than bred over centuries
 * of `lifecycle`/`births` — this is a claim about the `table` phase's own
 * roll, and simulating a whole population's growth to reach one is a wait
 * that would obscure the thing being measured (`AGENTS.md`: "build the state
 * you mean").
 */
describe('the steward buys a term (issue #128)', () => {
  it('starts at least one term in most runs, over a batch large enough to carry the claim', () => {
    const RUNS = 30;
    const YEARS = 40;
    let hit = 0;
    for (let i = 0; i < RUNS; i++) {
      const ctx = testWorld(bundle, 8100 + i * 7);
      ctx.world.treasury = 100_000;
      for (let c = 0; c < 10; c++) place(ctx, { sex: c % 2 ? 'male' : 'female', age: 5 + c, name: `Pupil${c}` });

      for (let y = 0; y < YEARS && !ctx.world.tutoring.length; y++) {
        phase('table', ctx);
        ctx.world.year += 1;
      }
      if (ctx.world.tutoring.length) hit += 1;
    }
    expectRate({
      what: 'a run with a full household of pupils and no debt ceiling sees a term start within 40 years',
      n: RUNS, hits: hit, floor: 0.5,
    });
  });
});
