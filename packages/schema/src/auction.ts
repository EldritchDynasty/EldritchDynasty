import { z } from 'zod';

/**
 * THE AUCTION (issue #17) — how a Discrepancy gets proven by purchase.
 *
 * Rare, announced years ahead so the player can liquidate, borrow, or start
 * planning something regrettable. Lots are GENERATED AT RUNTIME rather than
 * authored — there is no `AuctionLotDef` in content, on the same bargain
 * `ArcInstance` makes with `ArcDef`: the shape is declared here, the content
 * that feeds it is the Library, the heirlooms and the open Discrepancies.
 *
 * `House.chronicle: ChronicleId` was the original sketch for how a rival's
 * pages become buyable. It is not built that way: a `chronicle_page` lot's
 * `refId` names the Discrepancy it can prove directly, and `house` is drawn
 * from that Discrepancy's own `provableBy` list — the wiring issue #9/#10
 * already built. A second, parallel per-house chronicle document would be a
 * second source of truth for the same fact.
 */
/** Retain the retired currency when loading historical bids and sale records. */
export const StoredBidCurrencyS = z.enum(['coin', 'favour', 'heirloom', 'marriage_promise']);
/** A new bid may spend only currencies that the game actually supplies. */
export const BidCurrencyS = StoredBidCurrencyS.exclude(['favour']);
export type BidCurrency = z.infer<typeof BidCurrencyS>;

export const AuctionLotKindS = z.enum(['spellbook', 'heirloom', 'chronicle_page']);
export type AuctionLotKind = z.infer<typeof AuctionLotKindS>;

export interface AuctionBid {
  house: string;
  currency: z.infer<typeof StoredBidCurrencyS>;
  /** Coins, or the original amount on a legacy favour bid. Ignored for other currencies. */
  amount: number;
  /** The heirloom traded away, when `currency` is `heirloom`. */
  heirloomOffered?: string;
  /** The Head who signed a marriage bid; succession does not replace him. */
  pledgedBy?: string;
}

export interface AuctionLot {
  id: string;
  kind: AuctionLotKind;
  /**
   * A spellbook id, a heirloom id, or — for `chronicle_page` — the id of the
   * Discrepancy this page can prove. THIS IS HOW DISCREPANCIES GET PROVEN.
   */
  refId: string;
  /** The rival house selling it. */
  house: string;
  announcedYear: number;
  saleYear: number;
  reserveCoin: number;
  /** Registered ahead of the sale by a real bid. Auto-resolve bids at sale time when this is absent. */
  playerBid?: AuctionBid;
}

export interface AuctionHistoryEntry {
  lot: AuctionLot;
  year: number;
  winner: 'player' | 'rival' | 'nobody';
  winningHouse?: string;
}

export interface AuctionState {
  upcoming: AuctionLot[];
  history: AuctionHistoryEntry[];
  nextAnnounceYear: number;
  /** Legacy save data; favours have no earning source and cannot fund new bids. */
  favours: number;
}

export function emptyAuctionState(startYear: number): AuctionState {
  // "Rare — once every two or three generations" (~25yr/generation): the
  // first is well out, so the mechanism never fires before the house has
  // anything worth bidding for.
  return { upcoming: [], history: [], nextAnnounceYear: startYear + 40, favours: 0 };
}

/** A pledge of marriage, spent as a bid currency — "the blood will come", sometimes. */
export interface MarriagePromise {
  toHouse: string;
  year: number;
  lot: string;
  pledgedBy: string;
  /** Reserved by claimed descent; a dead reservation may be replaced. */
  girl?: string;
}
