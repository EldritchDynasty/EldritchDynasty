import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash, type AuctionLot } from '@ed/schema';
import {
  announceAuction, auctionCandidateWeight, bidAtAuction, bootstrap, commissionBook, grantHeirloom, grantParcel,
  order, resolveDueLots, setProseMode, setProseVariants, testRng, tickAuction,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

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

  function world(mode: Mode): SimCtx {
    const ctx = bootstrap(bundle, 1042, 1042);
    setProseVariants(ctx, Object.entries(PAGES).map(([key, [original, plain]]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
    })));
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
