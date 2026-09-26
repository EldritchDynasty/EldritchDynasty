import type { AuctionBid, AuctionLot, BidCurrency, HouseDef } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { Rng } from './rng.js';
import { DEBT_FLOOR } from './economy.js';
import { applyEffect } from './events/effects.js';
import { acquireLibraryCopy } from './people/library.js';
import { grantHeirloom, transferHeirloom } from './people/heirlooms.js';
import { relationshipThreads } from './relationship-threads.js';

/**
 * THE AUCTION (issue #17) — the largest single subsystem in the tracker, and
 * how a Discrepancy gets proven by purchase.
 *
 * Rare — every 40-90 years, announced 3-8 years ahead so the player can
 * liquidate, borrow, or start planning something regrettable. Stock is
 * generated at runtime from three sources:
 *
 *   spellbook       affinities the house does not have. `announceLots` never
 *                   offers one already on the shelf.
 *   heirloom        anything not `cannotBeSold` and not already held.
 *   chronicle_page  one per OPEN Discrepancy per house named in its
 *                   `provableBy` — buying it proves the Discrepancy outright,
 *                   through the same `discrepancy` effect content already uses.
 *
 * Rival houses bid only on spellbooks, and only when their `motives` (content,
 * `houses.yaml`) name the affinity: House Marrow always wants Death texts, the
 * Church wants Light and refuses Death. Heirlooms and chronicle pages go to
 * whoever bids the reserve; there is no third party fighting the player for a
 * page that incriminates a house not their own.
 */

const LEAD_YEARS = { min: 3, max: 8 };
const REANNOUNCE_YEARS = { min: 45, max: 90 }; // "once every two or three generations"
const LOTS_PER_AUCTION = { min: 1, max: 3 };
export const BOOK_SEARCH_FEE = 25;
export const BOOK_SEARCH_YEARS = 12;

const SEVERITY_PRICE: Record<string, number> = { minor: 220, major: 500, total: 900 };

function sellableSpellbooks(ctx: SimCtx): string[] {
  return ctx.content.spellbooks
    .filter((s) => !ctx.world.library.has(s.id))
    .map((s) => s.id);
}

function sellableHeirlooms(ctx: SimCtx): string[] {
  return ctx.content.heirlooms
    .filter((h) => !h.cannotBeSold && !ctx.world.heirlooms.has(h.id))
    .map((h) => h.id);
}

function rivalHouses(ctx: SimCtx): HouseDef[] {
  return ctx.content.houses.filter((h) => h.id !== ctx.world.playerHouse);
}

/** One `chronicle_page` candidate per (open Discrepancy, house that can prove it). */
function chroniclePageCandidates(ctx: SimCtx): { discrepancy: string; house: string; severity: string }[] {
  const out: { discrepancy: string; house: string; severity: string }[] = [];
  for (const [id, d] of ctx.world.discrepancies) {
    if (d.state !== 'open') continue;
    for (const house of d.provableBy) out.push({ discrepancy: id, house, severity: d.severity });
  }
  return out;
}

function lotId(ctx: SimCtx): string {
  return `lot_${(ctx.world.counters.lot += 1).toString(36)}`;
}

/** Ask a Sarrow broker to bring one common manuscript to a dated sale. */
export function commissionBook(ctx: SimCtx, id: string): { ok: boolean; reason?: string } {
  const w = ctx.world;
  const book = ctx.content.spellbook(id);
  if (!book || book.tier !== 'minor') return { ok: false, reason: 'the broker can seek only a common working' };
  if (w.library.has(id)) return { ok: false, reason: 'the house has this book already' };
  if (w.auction.upcoming.some((lot) => lot.kind === 'spellbook' && lot.refId === id)) {
    return { ok: false, reason: 'a copy is already due at auction' };
  }
  if (w.treasury - BOOK_SEARCH_FEE < DEBT_FLOOR) {
    return { ok: false, reason: `the broker asks ${BOOK_SEARCH_FEE} crowns before he leaves` };
  }
  const saleYear = w.year + BOOK_SEARCH_YEARS;
  const reserveCoin = book.price.max + 100;
  w.treasury -= BOOK_SEARCH_FEE;
  w.auction.upcoming.push({
    id: lotId(ctx), kind: 'spellbook', refId: id,
    house: rivalHouses(ctx)[0]?.id ?? w.playerHouse,
    announcedYear: w.year, saleYear, reserveCoin,
  });
  w.chronicle.push({
    year: w.year, weight: 'line', named: false,
    text: `The house paid a Sarrow broker ${BOOK_SEARCH_FEE} crowns to seek ${book.name}. He promised a sale in ${saleYear}, at a reserve of ${reserveCoin}.`,
  });
  return { ok: true };
}

/** The Sarrow deed is a road to books, not a decorative parcel blurb. */
export function auctionCandidateWeight(
  ctx: SimCtx,
  kind: AuctionLot['kind'],
): number {
  return kind === 'chronicle_page'
    ? 0.7
    : kind === 'spellbook' && [...ctx.world.parcels.values()]
      .some((p) => p.defId === 'sarrow_bottom' && p.heldSince <= ctx.world.year)
      ? 3
      : 1;
}

/**
 * Reuse an active outside name as the keeper/seller of an already-selected lot.
 *
 * This deliberately runs AFTER stock selection. Relationship recurrence should
 * change who the house meets again, not whether a spellbook exists at all:
 * weighting candidate stock by relationship house moved the Library and ladder
 * on fixed seeds even though #217 is a social-memory feature.
 */
export function relationshipThreadAuctionSeller(
  ctx: SimCtx,
  originalHouse: string,
  ordinal = 0,
): string {
  const threads = relationshipThreads(ctx);
  if (!threads.length) return originalHouse;
  return threads[Math.abs(ordinal) % threads.length]!.house;
}

/**
 * Build 1-3 lots and put them on the calendar. Called from `tickAuction` once
 * `nextAnnounceYear` arrives; reschedules itself.
 */
export function announceAuction(ctx: SimCtx, rng: Rng): AuctionLot[] {
  const w = ctx.world;
  const rivals = rivalHouses(ctx);
  const spellbooks = sellableSpellbooks(ctx);
  const heirlooms = sellableHeirlooms(ctx);
  const pages = chroniclePageCandidates(ctx);

  type Candidate = { kind: AuctionLot['kind']; refId: string; house: string; reserve: number };
  const pool: Candidate[] = [
    ...spellbooks.map((id) => ({
      kind: 'spellbook' as const,
      refId: id,
      house: rng.pick(rivals)?.id ?? w.playerHouse,
      reserve: Math.round(rng.range(
        ctx.content.mustSpellbook(id).price.min,
        ctx.content.mustSpellbook(id).price.max,
      )),
    })),
    ...heirlooms.map((id) => ({
      kind: 'heirloom' as const,
      refId: id,
      house: rng.pick(rivals)?.id ?? w.playerHouse,
      reserve: Math.round(rng.range(250, 650)),
    })),
    ...pages.map((p) => ({
      kind: 'chronicle_page' as const,
      refId: p.discrepancy,
      house: p.house,
      reserve: SEVERITY_PRICE[p.severity] ?? 400,
    })),
  ];
  if (!pool.length) return [];

  // Weighted, not uniform: a chronicle page is the rarest and most consequential
  // thing on the table, so it does not crowd out ordinary spellbook and
  // heirloom stock just for existing. Frame content reacts to a Discrepancy
  // while it stands OPEN (issue #13) — the auction is a second way to close
  // that window, not the primary one, and must not race ahead of it.
  //
  // 0.7, and the number is a SHARE rather than a taste: this constant was 0.35
  // when the game held eleven spellbooks, and the library drop took that to
  // twenty-one. A page's weight is fixed while the pool it competes with
  // doubles, so its share of each pick halved, and issue #17's own acceptance
  // test — a purchased rival chronicle proving a Discrepancy — stopped finding
  // a page to buy in a thousand years of auctions. Anything that adds
  // spellbooks in bulk has to come back here.
  // A bottom out of Sarrow is the one dependable road by which Anvarine
  // books enter this country (world §22; issue #100). It does not mint stock
  // or guarantee a sale, but it makes a spellbook three times as likely to
  // occupy one of the scarce announced lots. The deed can still sink in the
  // land phase, taking this access with it.
  const candidateWeight = (c: Candidate) => auctionCandidateWeight(ctx, c.kind);

  const n = Math.min(pool.length, Math.round(rng.range(LOTS_PER_AUCTION.min, LOTS_PER_AUCTION.max + 1)));
  const chosen: Candidate[] = [];
  const remaining = [...pool];
  for (let i = 0; i < n && remaining.length; i++) {
    const pick = rng.weighted(remaining, candidateWeight);
    if (!pick) break;
    chosen.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }

  const saleYear = w.year + Math.round(rng.range(LEAD_YEARS.min, LEAD_YEARS.max));
  let recurringSeller = 0;
  const lots: AuctionLot[] = chosen.map((c) => ({
    id: lotId(ctx),
    kind: c.kind,
    refId: c.refId,
    // A chronicle page belongs to the specific house that can prove it.
    // Generic books/heirlooms may instead recur through one of the active
    // relationship threads, without changing which item the auction stocked.
    house: c.kind === 'chronicle_page'
      ? c.house
      : relationshipThreadAuctionSeller(ctx, c.house, recurringSeller++),
    announcedYear: w.year,
    saleYear,
    reserveCoin: c.reserve,
  }));

  w.auction.upcoming.push(...lots);
  w.chronicle.push({
    year: w.year,
    weight: 'paragraph',
    title: 'A Sale Announced',
    text: `Word came that there would be an auction in ${saleYear}, and that it was worth the family's attention.`,
    named: false,
  });

  return lots;
}

/** Register a bid ahead of the sale. Returns false for a lot that no longer exists or has already sold. */
export interface BidResult {
  ok: boolean;
  reason?: string;
}

export function bidAtAuction(ctx: SimCtx, lotId_: string, currency: BidCurrency, amount: number, heirloomOffered?: string): BidResult {
  const w = ctx.world;
  const lot = w.auction.upcoming.find((l) => l.id === lotId_);
  if (!lot) return { ok: false, reason: 'no such lot' };

  if (currency === 'heirloom') {
    if (!heirloomOffered || !w.heirlooms.has(heirloomOffered)) {
      return { ok: false, reason: 'the house does not hold that heirloom' };
    }
  }

  const bid: AuctionBid = { house: w.playerHouse, currency, amount };
  if (heirloomOffered) bid.heirloomOffered = heirloomOffered;
  lot.playerBid = bid;
  return { ok: true };
}

/** What a `bid` is worth, for comparing against a coin reserve and a rival's coin bid. */
function bidValue(bid: AuctionBid): number {
  switch (bid.currency) {
    case 'coin':
    case 'favour':
      return bid.amount;
    // Flavour currencies. Generous, flat estimates — a promised granddaughter
    // or a favour bank the seller trusts is not priced by the crown, but it
    // has to be worth SOMETHING or the currency is decorative.
    case 'heirloom': return 450;
    case 'marriage_promise': return 600;
  }
}

/** The best a rival house will pay for a spellbook whose affinity its `motives` name. */
/**
 * What the house named in `provableBy` will pay for the page that proves it
 * (issue #74), as a multiple of the reserve.
 *
 * THE NUMBERS ARE PLACED EITHER SIDE OF THE STEWARD'S 1.25, and that is the
 * whole design here rather than a tuning taste. `willingness` is what `autoBid`
 * pays unprompted, so a rival priced under it loses the page to the
 * chronicler's floor every year the house is solvent — which is what the
 * simulation did for its whole history, since no rival bid on a page at all —
 * and a rival priced over it takes every page from a house whose player never
 * opens the table, which measured out at eight seeds in eight and is just the
 * old dead branch inverted.
 *
 * Split by severity, both branches are live and which one fires means
 * something:
 *
 *   minor  1.0   under the floor. The steward quietly buys up the small
 *                embarrassments, and the player never hears about it. This is
 *                what a household officer is FOR.
 *   major  1.4   over it. A rival takes this unless the player bids.
 *   total  1.8   well over. The page that could ruin the house is the page
 *                somebody else wants most, and it costs real money to keep.
 *
 * The reserve is already severity-priced by `SEVERITY_PRICE`, so severity
 * lands twice: once in what the page costs and once in how badly a rival wants
 * it. That is deliberate — the premium OVER the reserve is what decides who
 * walks away with it, and a flat premium says a minor lie and a total one are
 * equally worth having, which is the opposite of what §6 says about them.
 */
const PAGE_MOTIVE: Record<string, number> = { minor: 1.0, major: 1.4, total: 1.8 };

function bestRivalBid(ctx: SimCtx, lot: AuctionLot): { house: string; amount: number } | undefined {
  // A PAGE THAT NAMES THE FAMILY HAS A BUYER (issue #74).
  //
  // This returned `undefined` for everything but a spellbook, so no rival
  // ever bid on a chronicle page in the history of the game, and the "a rival
  // won it" branch below could not be reached at all — the lot went to the
  // house or to nobody, always. The issue's complaint was that a rival taking
  // the page did nothing; underneath it, a rival could never take the page.
  //
  // `lot.house` for a page IS the house out of `provableBy` — see
  // `chroniclePageCandidates` — so the bidder is not picked here, it is the
  // one party the record layer already says holds the fragment.
  if (lot.kind === 'chronicle_page') {
    const d = ctx.world.discrepancies.get(lot.refId);
    if (!d || d.state !== 'open') return undefined;
    return { house: lot.house, amount: Math.round(lot.reserveCoin * (PAGE_MOTIVE[d.severity] ?? 1.4)) };
  }
  if (lot.kind !== 'spellbook') return undefined;
  const def = ctx.content.spellbook(lot.refId);
  if (!def) return undefined;

  let best: { house: string; amount: number } | undefined;
  for (const house of rivalHouses(ctx)) {
    for (const m of house.motives) {
      if (m.refuses.includes(def.affinity)) continue;
      if (!m.wants.includes(def.affinity)) continue;
      if (!best || m.bidsUpTo > best.amount) best = { house: house.id, amount: m.bidsUpTo };
    }
  }
  return best;
}

/** Never bid the house into the debt floor outright. */
const BID_BUFFER = 60;

/** What the house is willing to pay over the reserve, by what the lot is. */
function willingness(lot: AuctionLot): number {
  return lot.kind === 'chronicle_page' ? 1.25 : lot.kind === 'spellbook' ? 1.2 : 1.05;
}

/**
 * The steward's standing offer, used when nobody registered a real bid — the
 * same role `autoRecordOption` plays for Record. Chronicle pages carry a
 * premium: proving a rival wrong is worth more to the house than the crowns.
 *
 * It runs in a PLAYED year too, and that is a change with a measurement
 * behind it. It used to run only under `autoResolve`, so a house whose player
 * never opened the table never bid on anything, ever: measured over six
 * played thousand-year runs the shelf held the two books the family was
 * founded with in five of the six, against seven to thirteen in the same
 * runs driven by the chronicler. `table.ts` states the doctrine this file was
 * breaking — the steward is a FLOOR, and "a house whose player never opens
 * the table still reads its books", which it cannot do if nobody ever buys
 * one.
 */
function autoBid(ctx: SimCtx, lot: AuctionLot): AuctionBid | undefined {
  const w = ctx.world;
  const headroom = w.treasury - DEBT_FLOOR - BID_BUFFER;
  if (headroom < lot.reserveCoin) return undefined;

  const amount = Math.min(headroom, Math.round(lot.reserveCoin * willingness(lot)));
  return { house: w.playerHouse, currency: 'coin', amount };
}

/**
 * HOW HIGH THE HOUSE WILL GO — `world.bidCeiling`, the `bid` standing order,
 * and until now a DECLARED FIELD NOTHING READ (invariant 11).
 *
 * The player set it at the table, the client printed "the house will bid up
 * to 400 at the next auction", it round-tripped through the save, and the
 * auction never once looked at it. The money the player had said to spend was
 * the one lever they had on the Library, and it was wired to nothing: rivals
 * took eleven to sixteen of the twenty-odd book lots in a run and the house's
 * answer was whatever the steward could afford that morning.
 *
 * A ceiling is a LIMIT, not a price: the house bids what the lot takes — over
 * the rival where it can, since that is what "we will go to four hundred"
 * means at a sale — and never a crown past what it said or what it holds.
 */
function standingBid(ctx: SimCtx, lot: AuctionLot): AuctionBid | undefined {
  const w = ctx.world;
  if (w.bidCeiling <= 0) return undefined;
  const headroom = w.treasury - DEBT_FLOOR - BID_BUFFER;
  const rival = bestRivalBid(ctx, lot);
  const needed = Math.max(Math.round(lot.reserveCoin * willingness(lot)), rival ? rival.amount : 0);
  const amount = Math.min(needed, w.bidCeiling, headroom);
  if (amount < lot.reserveCoin) return undefined;
  return { house: w.playerHouse, currency: 'coin', amount };
}

/** Apply what winning the lot actually gets the house. */
function grantLot(ctx: SimCtx, lot: AuctionLot): void {
  const w = ctx.world;
  if (lot.kind === 'spellbook') {
    acquireLibraryCopy(ctx, lot.refId);
    w.chronicle.push({
      year: w.year, weight: 'line',
      text: `The house bought a copy of ${ctx.content.spellbook(lot.refId)?.name ?? lot.refId} at auction.`,
      named: false,
    });
    return;
  }
  if (lot.kind === 'heirloom') {
    grantHeirloom(ctx, lot.refId);
    w.chronicle.push({
      year: w.year, weight: 'line',
      text: `The house bought ${ctx.content.heirloom(lot.refId)?.name ?? lot.refId} at auction.`,
      named: false,
    });
    return;
  }
  // chronicle_page, WON BY THE HOUSE: the lie is BURIED, not proven (issue
  // #74).
  //
  // This applied `prove` for as long as the lot had existed, which made buying
  // the evidence against yourself the only way a lie ever got proven — and,
  // since §29.3's third bite bills a STANDING lie at the term and excludes
  // proven ones, it made your own purchase the cheap branch:
  //
  //     the house buys its own page   -1 Respect tier now, and the lie leaves
  //                                   the standing pool, so it costs nothing
  //                                   at the term
  //     a rival buys it               nothing at all, ever
  //
  // Paying a tier to launder a lie you were going to be billed for anyway is
  // not a decision, and it read backwards against the prose sitting directly
  // underneath it: *bought it before anyone else could* is a description of
  // burying something, not of proving it. `bury` is what the sentence already
  // said, it is what #71 needs sites for, and it leaves the player's purchase
  // and a rival's meaning two different things — which is the whole of what
  // was wrong here.
  applyEffect({ kind: 'discrepancy', op: 'bury', id: lot.refId }, ctx, {});
  w.chronicle.push({
    year: w.year, weight: 'paragraph', title: 'Bought and Buried',
    text: `A page came up for sale that named the family directly, and the house bought it before anyone else could. `
      + 'Nobody else read it. Nobody else ever will.',
    named: false,
  });
}

/** Pay for it, in whichever currency won. */
function chargeBid(ctx: SimCtx, bid: AuctionBid, lot: AuctionLot): void {
  const w = ctx.world;
  if (bid.currency === 'coin') { w.treasury -= bid.amount; return; }
  if (bid.currency === 'favour') { w.auction.favours -= bid.amount; return; }
  if (bid.currency === 'heirloom' && bid.heirloomOffered) { transferHeirloom(ctx, bid.heirloomOffered); return; }
  if (bid.currency === 'marriage_promise') {
    // WHAT SHE WAS PROMISED FOR. `lot` was written empty here, which made
    // `MarriagePromise.lot` a declared field nothing ever filled — and it is
    // the whole of what makes this record legible: an unborn granddaughter
    // pledged for a book, with no way to say which book, is a line of
    // bookkeeping rather than the thing a house has to explain in 1512.
    w.marriagePromises.push({ toHouse: bid.house, year: w.year, lot: lot.refId });
  }
}

/** Resolve every lot whose sale year has arrived. */
export function resolveDueLots(ctx: SimCtx, autoResolve: boolean): void {
  const w = ctx.world;
  const due = w.auction.upcoming.filter((l) => l.saleYear <= w.year);
  if (!due.length) return;
  w.auction.upcoming = w.auction.upcoming.filter((l) => l.saleYear > w.year);

  for (const lot of due) {
    // The player's own bid on this lot first, then the standing order they
    // gave the table, then the steward's floor. `autoResolve` no longer gates
    // the floor — see `autoBid`.
    void autoResolve;
    const bid = lot.playerBid ?? standingBid(ctx, lot) ?? autoBid(ctx, lot);
    const rival = bestRivalBid(ctx, lot);

    const playerValue = bid ? bidValue(bid) : -1;
    const playerWins = bid !== undefined
      && playerValue >= lot.reserveCoin
      && (!rival || playerValue >= rival.amount);

    if (playerWins && bid) {
      chargeBid(ctx, bid, lot);
      grantLot(ctx, lot);
      w.auction.history.push({ lot, year: w.year, winner: 'player' });
      continue;
    }

    if (rival && rival.amount >= lot.reserveCoin) {
      w.auction.history.push({ lot, year: w.year, winner: 'rival', winningHouse: rival.house });
      const seller = ctx.content.house(rival.house)?.name ?? rival.house;

      // A RIVAL WITH THE EVIDENCE IS HOW A LIE GETS PROVEN (issue #74).
      //
      // §6 names this threat directly: "Rival houses, the Church, and the
      // auction's archivists all hold fragments of the truth. A Discrepancy
      // that is proven costs a full Respect tier and seeds a scandal event
      // chain." The fragments were modelled — `provableBy` is authored on 23
      // discrepancies and is what generates these lots — and at the exact
      // moment a rival actually got one, the model stopped: one chronicle
      // line, the Discrepancy left open, no standing hit, no grievance, no
      // flag. `provableBy` on a rival was decoration.
      //
      // It goes through `applyEffect` rather than touching
      // `w.discrepancies` here, so the Respect tier is charged in the ONE
      // place that charges it and this is not a second site applying an
      // outcome.
      if (lot.kind === 'chronicle_page') {
        applyEffect({ kind: 'discrepancy', op: 'prove', id: lot.refId }, ctx, {});
        w.chronicle.push({
          year: w.year, weight: 'paragraph', title: 'Read By Somebody Else',
          text: `${seller} outbid the house for a page that named the family directly, and took it home to read at leisure. `
            + 'What it proved could no longer be unproved.',
          named: false,
        });
        continue;
      }

      w.chronicle.push({
        year: w.year, weight: 'line',
        text: `${seller} outbid the house for the lot, and took it home instead.`,
        named: false,
      });
      continue;
    }

    w.auction.history.push({ lot, year: w.year, winner: 'nobody' });
  }
}

/** Called once a year — see `year/phases.ts`. */
export function tickAuction(ctx: SimCtx, rng: Rng, autoResolve: boolean): void {
  const w = ctx.world;
  if (w.year >= w.auction.nextAnnounceYear) {
    announceAuction(ctx, rng);
    w.auction.nextAnnounceYear = w.year + Math.round(rng.range(REANNOUNCE_YEARS.min, REANNOUNCE_YEARS.max));
  }
  resolveDueLots(ctx, autoResolve);
}

/** Diagnostics and the editor: lots on the calendar right now. */
export function upcomingLots(ctx: SimCtx): AuctionLot[] {
  return [...ctx.world.auction.upcoming];
}
