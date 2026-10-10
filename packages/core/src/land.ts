import type { ParcelDef, ParcelKind, ParcelState, RentPolicy, RespectTier, Year } from '@ed/schema';
import { assertNever, isActiveBranch, RESPECT_ORDER } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { Rng } from './rng.js';
import type { OrderResult } from './table.js';
import { DEBT_FLOOR } from './economy.js';
import { addGrudge, relate } from './people/relationships.js';
import { head } from './world.js';
import { noteBearing } from './bearing.js';
import { msg } from './messages.js';
import { proseForContentField } from './prose.js';

/**
 * LAND INCOME (concept §13, world §5/§12; issue #91, Phase A — issue #93).
 *
 * `economy.ts:219` said "Income derives from holdings, modified by the
 * Head's Charm and standing" over a five-row lookup on the Respect tier —
 * true of the comment and false of the code. This is what makes it true:
 * income is the sum of what the house currently holds (`ctx.content.parcel`
 * for the definition, `heldSince` on `WorldState.parcels` for whether it
 * counts yet), not a number read off a table.
 *
 * THE CALIBRATION (Phase A's whole acceptance bar): the 1042 endowment's
 * `baseYield` sums to exactly `TOTAL_1042_YIELD`, and this function scales
 * that sum by `INCOME_BY_RESPECT[tier] / TOTAL_1042_YIELD` — so for as long
 * as nothing is bought, sold or lost, `landIncome` returns EXACTLY what the
 * old lookup did, at every tier, every year. `npm run digest -- 8 400` is
 * the proof: the block must not move. The moment a parcel changes hands
 * (issue #91, Phase B on), the held sum diverges from 1042's and income
 * starts actually depending on what the house has, which is the entire
 * point of building this substrate now.
 */
const INCOME_BY_RESPECT: Record<RespectTier, number> = {
  unknown: 16,
  known: 32,
  regarded: 62,
  eminent: 108,
  exalted: 175,
};

/** The sum of every `baseYield` in the 1042 endowment (`parcels.yaml`). Fixed; not recomputed from content. */
const TOTAL_1042_YIELD = 140;

/**
 * THE CAPUT (issue #91, Stage H, ruled 2026-09-07): the part of a holding
 * that goes with the seal and is never alienable, historically exact rather
 * than invented for this purpose. `parcels/wiring` (`schema/src/rules.ts`)
 * already refuses a second `mill`, `woodland`, `common` or `demesne` — the
 * house's singular, defining ground rather than the ordinary fee land it
 * happens to hold several of. Every other kind, `tenant_farm` included, is
 * fee: ordinary ground a Head may endow to a cadet branch exactly as freely
 * as he may sell it. The four caput kinds may be sold — Ardwen goes to
 * Sarrow like any other lot, if a Head is desperate enough — they may simply
 * never leave the seat FOR a branch.
 */
const CAPUT_KINDS: ReadonlySet<ParcelKind> = new Set(['mill', 'woodland', 'common', 'demesne']);

export function isCaput(def: ParcelDef): boolean {
  return CAPUT_KINDS.has(def.kind);
}

/**
 * The parcels the house currently holds, detached from the map — the same
 * shape `heldHeirlooms` returns for the same reason: once pulled out of
 * `WorldState.parcels`, a `ParcelState` needs its own `id` to still say which
 * parcel it is, which is exactly why that field duplicates the map key
 * rather than leaning on it.
 */
export function heldParcels(ctx: SimCtx): ParcelState[] {
  const w = ctx.world;
  return [...w.parcels.values()].filter((state) => state.heldSince <= w.year);
}

/**
 * Total acreage the house currently holds — the one place this sum is
 * computed, read by the `acreage` `Condition` (`events/conditions.ts`) and by
 * `tickPlatIllumination` below. `ParcelDef.acres` is descriptive (issue #91,
 * Phase A) and this is the first thing that measures it moving (Phase F).
 */
export function heldAcres(ctx: SimCtx): number {
  return heldParcels(ctx).reduce((sum, state) => {
    const def = state.defId ? ctx.content.parcel(state.defId) : undefined;
    return sum + (def?.acres ?? 0);
  }, 0);
}

export function landIncome(ctx: SimCtx): number {
  const w = ctx.world;
  let held = 0;
  for (const state of heldParcels(ctx)) {
    // Invariant 15: a hall is not a house. The economy books the main hall;
    // a parcel endowed to a branch (issue #91, Stage H) feeds that branch's
    // own people instead — the branch tithe (`economy.ts`) already prices
    // what its adults bring in, so this is the one line that keeps land
    // endowed away from the seat from paying the seat twice.
    if (state.holder !== undefined) continue;
    if (!state.defId) continue;
    const def = ctx.content.parcel(state.defId);
    // `yieldBonus` (issue #94) is nought on every parcel a fresh world seeds,
    // so this changes nothing for the Phase A calibration above — it only
    // ever moves once an `improve` order has completed. Floored at zero
    // (issue #98's `damage` can now push it negative): a flooded farm can
    // stop paying, never pay the house to hold it.
    if (def) {
      let contribution = Math.max(0, def.baseYield + (state.yieldBonus ?? 0)) * (state.yieldFactor ?? 1);
      if (def.kind === 'tenant_farm' || def.kind === 'mill') contribution *= RENT_MULTIPLIER[w.rentsPolicy];
      held += contribution;
    }
  }
  return held * (INCOME_BY_RESPECT[w.respect] / TOTAL_1042_YIELD);
}

// ── Phase B: buying, selling, rents and improvement (issue #91, #94) ───────

/**
 * WHAT A PARCEL IS WORTH, bought or sold. §11's price table has nothing
 * priced this way, so this is calibrated against its scale rather than
 * quoted from it: "a gift of 60 crowns and a farm is customary" puts a farm
 * in the same order of magnitude as a warhorse (60) and a minor spellbook
 * (60-200), not in the thousands, and a typical farm here (`baseYield` 6-8)
 * prices at 72-96.
 */
const PRICE_PER_YIELD = 12;
/** Selling nets less than buying costs — transaction friction, and a guard against buy-then-sell arbitrage. */
const SELL_FACTOR = 0.75;

export function parcelPrice(def: ParcelDef): number {
  return def.marketPrice ?? Math.round(def.baseYield * PRICE_PER_YIELD);
}

/** The live `ParcelState` behind a `ParcelDef` id, if the house currently holds one. */
function liveStateOf(ctx: SimCtx, defId: string): [string, ParcelState] | undefined {
  return [...ctx.world.parcels.entries()].find(([, s]) => s.defId === defId && s.heldSince <= ctx.world.year);
}

/** How many lots the market carries at once. Not a shop: a permanent catalogue makes land a savings account. */
const MAX_OPEN_LOTS = 2;
/** The chance, per unlisted and unheld parcel, per year, that it comes onto the market. */
const LAND_MARKET_CHANCE = 0.06;
/** How long a lot stands before it is gone. Urgent lots are gone almost at once; a fair's lot stands a season or two longer. */
const FAIR_WINDOW = 3;
const URGENT_WINDOW = 1;
/** The share of new lots that are a neighbour short before Michaelmas, rather than one at the Bramme fairs. */
const URGENT_SHARE = 0.25;
/** A motivated seller prices under the going rate. */
const URGENT_DISCOUNT = 0.85;

/**
 * OPEN AND EXPIRE THE MARKET, once a year, from the `land` phase. Draws from
 * that phase's own stream (issue #93's reservation, cashed in). Gone if the
 * house does not take it: a lot that outlives its window is removed, not
 * carried forward, so the closing window is a real one.
 */
export function tickLandMarket(ctx: SimCtx, rng: Rng): void {
  const w = ctx.world;
  w.landMarket.lots = w.landMarket.lots.filter((l) => l.closesYear > w.year);
  if (w.landMarket.lots.length >= MAX_OPEN_LOTS) return;

  const listed = new Set(w.landMarket.lots.map((l) => l.parcel));
  for (const def of ctx.content.parcels) {
    if (w.landMarket.lots.length >= MAX_OPEN_LOTS) break;
    if (!def.marketable) continue;
    if (listed.has(def.id) || liveStateOf(ctx, def.id)) continue;
    if (!rng.bool(LAND_MARKET_CHANCE)) continue;

    const urgent = rng.bool(URGENT_SHARE);
    w.landMarket.lots.push({
      parcel: def.id,
      price: Math.round(parcelPrice(def) * (urgent ? URGENT_DISCOUNT : 1)),
      closesYear: w.year + (urgent ? URGENT_WINDOW : FAIR_WINDOW),
      reason: urgent ? 'neighbour_short' : 'fair',
    });
  }
}

/** Buy a lot currently on the market. Mints a fresh `ParcelState` off `counters.parcel`, the way every instance id in this codebase is minted. */
export function buyParcel(ctx: SimCtx, parcel: string): OrderResult {
  const w = ctx.world;
  const lot = w.landMarket.lots.find((l) => l.parcel === parcel);
  if (!lot) {
    return { ok: false, reason: msg(ctx, 'land.refuse.buy_not_listed', 'nothing of that name is on the market') };
  }
  const def = ctx.content.parcel(parcel);
  if (!def) return { ok: false, reason: msg(ctx, 'land.refuse.buy_unknown', 'no such parcel') };
  if (w.treasury - lot.price < DEBT_FLOOR) {
    return {
      ok: false,
      reason: msg(ctx, 'land.refuse.buy_cost', 'the house cannot raise {PRICE} crowns', { PRICE: String(lot.price) }),
    };
  }

  w.treasury -= lot.price;
  w.landMarket.lots = w.landMarket.lots.filter((l) => l !== lot);
  const id = `prc_${(w.counters.parcel += 1).toString(36)}`;
  w.parcels.set(id, { id, defId: def.id, heldSince: w.year });
  if (def.kind === 'wetland') {
    const standing = RESPECT_ORDER.indexOf(w.respect);
    w.respect = RESPECT_ORDER[Math.max(0, standing - 1)]!;
    w.respectChanged = w.year;
  }
  w.chronicle.push({
    year: w.year, weight: 'line',
    text: msg(ctx, 'land.bought', '{PARCEL} was bought outright, for {PRICE} crowns.',
      { PARCEL: parcelProse(ctx, def, 'name', def.name), PRICE: String(lot.price) }),
    named: false,
  });
  return { ok: true };
}

/** A parcel's authored words, in the reader's chosen wording (#876). */
function parcelProse(ctx: SimCtx, def: ParcelDef, field: 'name' | 'place' | 'provenance', original: string): string {
  return proseForContentField(ctx, 'parcels', def.id, field, original);
}

/**
 * The name the plat shows: the player's own word for it, if there is one, over
 * the authored name. The player's word is never re-worded.
 */
function displayName(ctx: SimCtx, state: ParcelState, def: ParcelDef | undefined): string {
  if (state.name !== undefined) return state.name;
  return def ? parcelProse(ctx, def, 'name', def.name) : 'the ground';
}

/**
 * Note ground the house no longer holds (issue #96) — called from both
 * `sellParcel` and `seizeParcel`, just before the live `ParcelState` is
 * dropped. `by` is the sitting Head's name: the house's own record of who let
 * it go, not the buyer's — the plat is a document about THIS house's ground.
 */
function recordLoss(ctx: SimCtx, state: ParcelState, def: ParcelDef | undefined): void {
  const w = ctx.world;
  const sitting = head(w);
  w.lostParcels.push({
    defId: state.defId ?? state.id,
    // Saved state keeps the Original; `lostView` words it for the reader.
    name: state.name ?? def?.name ?? 'the ground',
    place: def?.place ?? 'unknown ground',
    year: w.year,
    by: sitting?.name ?? msg(ctx, 'land.loss.nobody', 'nobody left to say'),
  });
}

/** Sell a held parcel. The home demesne is the one kind that is not for sale — "let to nobody" (`parcels.yaml`). */
export function sellParcel(ctx: SimCtx, parcel: string): OrderResult {
  const w = ctx.world;
  const def = ctx.content.parcel(parcel);
  if (!def) return { ok: false, reason: msg(ctx, 'land.refuse.sell_unknown', 'no such parcel') };
  if (def.kind === 'demesne') {
    return { ok: false, reason: msg(ctx, 'land.refuse.sell_demesne', 'the home ground is not for sale') };
  }
  const found = liveStateOf(ctx, parcel);
  if (!found) return { ok: false, reason: msg(ctx, 'land.refuse.sell_not_held', 'the house does not hold it') };
  const [id, state] = found;

  const price = Math.round(parcelPrice(def) * SELL_FACTOR);
  recordLoss(ctx, state, def);
  w.parcels.delete(id);
  w.landImprovements = w.landImprovements.filter((imp) => imp.parcel !== id);
  w.treasury += price;
  w.chronicle.push({
    year: w.year, weight: 'line',
    text: msg(ctx, 'land.sold', '{PARCEL} was sold, for {PRICE} crowns.', { PARCEL: parcelProse(ctx, def, 'name', def.name), PRICE: String(price) }),
    named: false,
  });
  return { ok: true };
}

export function setRentsPolicy(ctx: SimCtx, policy: RentPolicy): OrderResult {
  const w = ctx.world;
  if (w.rentsPolicy === policy) return { ok: true };
  w.rentsPolicy = policy;

  // The tenants are an institution as well as the named family an eviction
  // scene casts. A standing rent order therefore makes one house-wide edge
  // against the Head who set it; the relationship system deliberately lets
  // house-wide edges survive a year in which one endpoint is not a minted
  // person. Severity is duration here, so even hard terms outlive a Head and
  // rack terms last longer still.
  if (policy !== 'customary') {
    const h = head(w);
    if (h) {
      const tenants = `tenants:${w.playerHouse}`;
      relate(w, tenants, h.id, policy === 'rack' ? -18 : -10);
      addGrudge(
        ctx, tenants, h.id,
        { severity: policy === 'rack' ? 48 : 36, inheritance: 'house_wide' },
        `rents_${policy}`,
      );
    }
  }
  return { ok: true };
}

/** What each rent book pays now, and what the tenants charge the house later. */
const RENT_MULTIPLIER: Record<RentPolicy, number> = { customary: 1, hard: 1.12, rack: 1.28 };
const RENT_DISCONTENT: Record<RentPolicy, number> = { customary: 0, hard: 0.25, rack: 0.65 };

const IMPROVE_YEARS = 4;
const IMPROVE_YIELD_GAIN = 2;

/** Start a term of improvement — drainage, mostly, world §5's own word for what half these farms need. */
export function beginImprovement(ctx: SimCtx, parcel: string): OrderResult {
  const w = ctx.world;
  const def = ctx.content.parcel(parcel);
  if (!def) return { ok: false, reason: msg(ctx, 'land.refuse.improve_unknown', 'no such parcel') };
  if (def.kind === 'town_house') {
    return {
      ok: false,
      reason: msg(ctx, 'land.refuse.improve_town_house', 'a town house is presence, not producing ground'),
    };
  }
  const found = liveStateOf(ctx, parcel);
  if (!found) return { ok: false, reason: msg(ctx, 'land.refuse.improve_not_held', 'the house does not hold it') };
  const [id] = found;
  if (w.landImprovements.some((imp) => imp.parcel === id)) {
    return { ok: false, reason: msg(ctx, 'land.refuse.improve_underway', 'already being improved') };
  }

  const cost = parcelPrice(def);
  if (w.treasury - cost < DEBT_FLOOR) {
    return {
      ok: false,
      reason: msg(ctx, 'land.refuse.improve_cost', 'the house cannot raise {PRICE} crowns', { PRICE: String(cost) }),
    };
  }
  w.treasury -= cost;
  w.landImprovements.push({ parcel: id, completes: w.year + IMPROVE_YEARS });
  return { ok: true };
}

/** Terms of improvement come due, and hard rents cost what they cost. Run once a year from the `land` phase. */
export function tickLandImprovements(ctx: SimCtx): void {
  const w = ctx.world;
  for (const imp of [...w.landImprovements]) {
    if (w.year < imp.completes) continue;
    w.landImprovements = w.landImprovements.filter((x) => x !== imp);
    const state = w.parcels.get(imp.parcel);
    if (!state) continue; // sold mid-improvement (`sellParcel` already dropped the term); the work is simply gone
    state.yieldBonus = (state.yieldBonus ?? 0) + IMPROVE_YIELD_GAIN;
    const def = state.defId ? ctx.content.parcel(state.defId) : undefined;
    w.chronicle.push({
      year: w.year, weight: 'line',
      text: def
        ? msg(ctx, 'land.drained', 'The drainage at {PARCEL} was finished, and it yields better for it.',
          { PARCEL: parcelProse(ctx, def, 'name', def.name) })
        : msg(ctx, 'land.drained_unnamed', 'The drainage at the holding was finished, and it yields better for it.'),
      named: false,
    });
  }

  w.discontent = Math.min(100, w.discontent + RENT_DISCONTENT[w.rentsPolicy]);
}

// ── Phase E: six holdings, six risk shapes (issue #100) ──────────────────

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/**
 * A loss the ground dealt the house this year, by what it was and where.
 *
 * Structured because something has to count these that is not a reader: the
 * land gate once found both routes by searching the chronicle for
 * `'black water off Sarrow'` and `'Blight took hold in'`, so rewording either
 * sentence — or translating it (issue #276) — would have silently dropped a
 * loss route from the gate while the sentence still read perfectly well.
 */
export const LAND_RISK_ROUTES = ['sarrow_sink', 'blight'] as const;
export type LandRiskRoute = (typeof LAND_RISK_ROUTES)[number];

export interface LandRiskStrike {
  route: LandRiskRoute;
  /** The `ParcelDef` id the risk struck. */
  parcel: string;
}

export interface LandRiskResult {
  villageHarvest: number;
  sarrowSank: boolean;
  /** Every loss this tick dealt, in the order it was dealt. */
  struck: LandRiskStrike[];
}

/**
 * The yearly chance a held woodland catches blight — canker in the standing
 * timber, the same order of magnitude as `sarrow_bottom`'s own 0.018 sink
 * chance below, and the loss route `docs/BALANCE-LOG.md`'s land table names
 * (issue #91, Stage G) that `tickLandRisks` did not yet cover: `woodland` was
 * one of three kinds (with `common` and `demesne`) carrying a flat
 * `yieldFactor = 1` and no risk of its own at all.
 */
const BLIGHT_CHANCE = 0.03;

/**
 * Roll the ground before economy reads it. Tenant farms share one quiet
 * harvest; the Wend mill is coupled to that same crop because empty sacks do
 * not pay a mill toll. Four more kinds own their stated risk instead of
 * inheriting a single generic variance, and `woodland` now owns a fifth —
 * `common` and `demesne` are the two kinds left with none, deliberately: a
 * common has nothing seasonal to lose and the demesne is the house's own
 * table, never rented out to have a season at all.
 */
export function tickLandRisks(ctx: SimCtx, rng: Rng): LandRiskResult {
  const w = ctx.world;
  const villageHarvest = clamp(rng.normal(1, 0.07), 0.78, 1.22);
  let sarrowSank = false;
  const struck: LandRiskStrike[] = [];

  for (const state of [...heldParcels(ctx)]) {
    if (!state.defId) continue;
    const def = ctx.content.parcel(state.defId);
    if (!def) continue;

    switch (def.kind) {
      case 'tenant_farm':
        state.yieldFactor = villageHarvest;
        break;
      case 'mill':
        // Three quarters of the mill's business is the village crop; the
        // remainder is its fixed wheel and crossing trade.
        state.yieldFactor = 1.8 * (0.25 + villageHarvest * 0.75);
        break;
      case 'woodland':
        state.yieldFactor = 1;
        if (rng.bool(BLIGHT_CHANCE)) {
          damageParcel(ctx, def.id);
          struck.push({ route: 'blight', parcel: def.id });
          w.chronicle.push({
            year: w.year, weight: 'line', named: false,
            text: msg(ctx, 'land.blight',
              'Blight took hold in {PARCEL} this year, and the timber that would have paid for it did not.',
              { PARCEL: parcelProse(ctx, def, 'name', def.name) }),
          });
        }
        break;
      case 'common':
      case 'demesne':
        state.yieldFactor = 1;
        break;
      case 'slate_work':
        state.yieldFactor = clamp(rng.normal(2.6, 1), 0.2, 5);
        break;
      case 'sarrow_bottom':
        state.yieldFactor = clamp(rng.normal(3.4, 2.1), 0, 8);
        if (rng.bool(0.018)) {
          seizeParcel(ctx, def.id);
          sarrowSank = true;
          struck.push({ route: 'sarrow_sink', parcel: def.id });
          w.chronicle.push({
            year: w.year, weight: 'line', named: false,
            text: msg(ctx, 'land.sarrow_sank',
              '{PARCEL} went down in black water off Sarrow, with its cargo and every crown laid into it.',
              { PARCEL: parcelProse(ctx, def, 'name', def.name) }),
          });
        }
        break;
      case 'town_house':
        state.yieldFactor = 0;
        // The house pays no rent. What it buys is a door in Bramme, so merely
        // keeping it prevents the quiet standing decay from treating the
        // family as absent from the town this year.
        w.respectChanged = w.year;
        break;
      case 'wetland':
        state.yieldFactor = clamp(rng.normal(0.7, 0.25), 0.2, 1.2);
        break;
      default:
        assertNever(def.kind, 'parcel kind');
    }
  }

  return { villageHarvest, sarrowSank, struck };
}

// ── Phase D: the `land` Effect (issue #91, #98) ─────────────────────────────

/** How much a bare `damage`/`restore` effect moves `yieldBonus` when content does not say. Matches `IMPROVE_YIELD_GAIN`'s own granularity — a flood costs about what one term of drainage buys. */
export const LAND_DAMAGE_DEFAULT = 2;

/** Mint a `ParcelState` for a parcel the house does not yet hold, at no cost. A no-op if it already holds one — see the `land` Effect's own doc in `event.ts` for why that is correct rather than a stub. */
export function grantParcel(ctx: SimCtx, parcel: string): void {
  const w = ctx.world;
  if (liveStateOf(ctx, parcel)) return;
  const def = ctx.content.parcel(parcel);
  if (!def) return;
  const id = `prc_${(w.counters.parcel += 1).toString(36)}`;
  w.parcels.set(id, { id, defId: def.id, heldSince: w.year });
  // Hygiene `buyParcel` also does: a parcel granted out from under the market cannot still be listed on it.
  w.landMarket.lots = w.landMarket.lots.filter((l) => l.parcel !== def.id);
}

/** Drop a held parcel with no payment — the loss-route counterpart to `sellParcel`. A no-op if the house does not hold it. */
export function seizeParcel(ctx: SimCtx, parcel: string): void {
  const w = ctx.world;
  const found = liveStateOf(ctx, parcel);
  if (!found) return;
  const [id, state] = found;
  recordLoss(ctx, state, ctx.content.parcel(parcel));
  w.parcels.delete(id);
  w.landImprovements = w.landImprovements.filter((imp) => imp.parcel !== id);
}

/** Knock a held parcel's yield down. Floored so its contribution to `landIncome` cannot go negative — see that function's own clamp. A no-op if the house does not hold it. */
export function damageParcel(ctx: SimCtx, parcel: string, magnitude = LAND_DAMAGE_DEFAULT): void {
  const found = liveStateOf(ctx, parcel);
  if (!found) return;
  const [, state] = found;
  state.yieldBonus = (state.yieldBonus ?? 0) - magnitude;
}

/** Repair a held parcel's yield. Not capped at the undamaged baseline — see the `land` Effect's own doc for why. A no-op if the house does not hold it. */
export function restoreParcel(ctx: SimCtx, parcel: string, magnitude = LAND_DAMAGE_DEFAULT): void {
  const found = liveStateOf(ctx, parcel);
  if (!found) return;
  const [, state] = found;
  state.yieldBonus = (state.yieldBonus ?? 0) + magnitude;
}

/**
 * TAKE A BITE OF THE COMMON — the ninth acquisition route (issue #91, Stage
 * G). Exactly `grantParcel`, plus the write `grantParcel` alone cannot make:
 * this is the one route that costs nothing on the day it is taken, and §29's
 * whole design is that nothing which costs nothing on the day is actually
 * free (`bearing.ts`'s own header). The record of it is not kept anywhere a
 * player can read — that is rule 1, never name it — it is kept in
 * `world.bearing.acts`, and the market thins fifty years on for a reason
 * nobody living was there to see.
 */
export function encroachParcel(ctx: SimCtx, parcel: string, page?: string): void {
  if (liveStateOf(ctx, parcel)) return; // already held — see `grantParcel`'s own no-op
  grantParcel(ctx, parcel);
  const def = ctx.content.parcel(parcel);
  noteBearing(ctx, 'bit_the_common', def?.name ?? parcel, page);
}

// ── Stage H: cadet-branch land holding (issue #91, ruled 2026-09-07) ───────

/**
 * ENDOW A HELD PARCEL TO A CADET BRANCH. The seat's own identity-holdings
 * (`isCaput`) may not go this way, the same reason `canHoldPost` is the one
 * gate every door writing `Person.career` has to ask — a caput check here
 * and nowhere else would be a second gate that can drift from the first.
 * The branch must be a living hall of THIS house: an extinct one cannot be
 * endowed to (there is no speaker left to answer for it), and a name from
 * outside `world.branches` is not a branch at all.
 */
export function endowParcel(ctx: SimCtx, parcel: string, branch: string): OrderResult {
  const w = ctx.world;
  const found = liveStateOf(ctx, parcel);
  if (!found) return { ok: false, reason: msg(ctx, 'land.refuse.endow_not_held', 'the house does not hold it') };
  const [, state] = found;
  const def = ctx.content.parcel(parcel);
  if (def && isCaput(def)) {
    return {
      ok: false,
      reason: msg(ctx, 'land.refuse.endow_caput', "{PARCEL} is the seat's own ground and cannot be endowed away",
        { PARCEL: parcelProse(ctx, def, 'name', def.name) }),
    };
  }
  const b = w.branches.get(branch);
  if (!b || !isActiveBranch(b)) {
    return { ok: false, reason: msg(ctx, 'land.refuse.endow_no_hall', 'no such hall stands to hold it') };
  }
  if (state.holder === branch) return { ok: true }; // already endowed there

  state.holder = branch;
  w.chronicle.push({
    year: w.year, weight: 'line', named: false,
    text: msg(ctx, 'land.endowed', '{PARCEL} was endowed to {BRANCH}.',
      { PARCEL: displayName(ctx, state, def), BRANCH: b.name }),
  });
  return { ok: true };
}

/** Recall an endowed parcel back to the seat. A no-op, not a refusal, on ground already the seat's own — the same shape `grantParcel` gives an already-held parcel. */
export function recallParcel(ctx: SimCtx, parcel: string): OrderResult {
  const w = ctx.world;
  const found = liveStateOf(ctx, parcel);
  if (!found) return { ok: false, reason: msg(ctx, 'land.refuse.recall_not_held', 'the house does not hold it') };
  const [, state] = found;
  if (state.holder === undefined) return { ok: true };

  const b = w.branches.get(state.holder);
  const def = ctx.content.parcel(parcel);
  state.holder = undefined;
  w.chronicle.push({
    year: w.year, weight: 'line', named: false,
    text: b
      ? msg(ctx, 'land.recalled_from', '{PARCEL} was recalled to the seat from {BRANCH}.',
        { PARCEL: displayName(ctx, state, def), BRANCH: b.name })
      : msg(ctx, 'land.recalled', '{PARCEL} was recalled to the seat.', { PARCEL: displayName(ctx, state, def) }),
  });
  return { ok: true };
}

/**
 * ESCHEAT ON EXTINCTION — the acquisition route Stage H gets for free.
 * "A neighbour runs out of sons" is Escheat's own premise, and a cadet
 * branch going extinct is the same event, come home: the hall's endowed
 * ground has nobody left to answer for it and returns to the house that
 * granted it, through the ordinary recall rather than a second mechanism.
 * Called from `people/branches.ts`'s `reapExtinct`, the one place a
 * branch's extinction is actually noticed.
 */
export function escheatBranchLand(ctx: SimCtx, branch: string): void {
  for (const parcel of heldParcels(ctx)) {
    if (parcel.holder !== branch) continue;
    if (!parcel.defId) continue;
    recallParcel(ctx, parcel.defId);
  }
}

// ── Phase C: the plat (issue #96) ───────────────────────────────────────────

/**
 * Name a parcel the house holds — a nickname for an authored one, or the only
 * name a def-less parcel (an assart, a drained strip) will ever have. The
 * same shape as `renameChild` (`sim.ts`): trim, refuse empty, write, tell the
 * book. `session.nameParcel` is where a client reaches this.
 */
export function nameParcel(ctx: SimCtx, parcel: string, name: string): OrderResult {
  const w = ctx.world;
  const found = liveStateOf(ctx, parcel) ?? (w.parcels.has(parcel) ? [parcel, w.parcels.get(parcel)!] as const : undefined);
  if (!found) return { ok: false, reason: msg(ctx, 'land.refuse.rename_not_held', 'the house does not hold it') };
  const [, state] = found;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: msg(ctx, 'land.refuse.rename_empty', 'a name cannot be empty') };

  const def = state.defId ? ctx.content.parcel(state.defId) : undefined;
  // Decide on the Original words; only the page is in the reader's wording.
  const same = (state.name ?? def?.name ?? 'the ground') === trimmed;
  const was = displayName(ctx, state, def);
  state.name = trimmed;
  w.chronicle.push({
    year: w.year, weight: 'line',
    text: same
      ? msg(ctx, 'land.renamed_same', '{PARCEL} was named, again.', { PARCEL: trimmed })
      : msg(ctx, 'land.renamed', '{WAS} was named {PARCEL}.', { WAS: was, PARCEL: trimmed }),
    named: false,
  });
  return { ok: true };
}

/**
 * ACREAGE IS A NUMBER WITH A NAME (issue #96). `weight: 'illuminated'` has
 * existed on `ChronicleEntry` since the chronicle did and had never had a
 * reason to fire — this is that reason. Run once a year from the `land`
 * phase, after the market and improvements settle. The threshold is derived
 * from the founding endowment rather than authored, so it moves if the
 * endowment ever does (invariant 10): a house that has grown by half again
 * over what it started with has grown enough to be worth a page.
 */
const ACREAGE_MILESTONE_MULTIPLIER = 1.5;

export function tickPlatIllumination(ctx: SimCtx): void {
  const w = ctx.world;
  if (w.platIlluminated) return;
  const founding = ctx.content.parcels
    .filter((p) => p.foundingHolding)
    .reduce((sum, p) => sum + p.acres, 0);
  if (founding <= 0) return;
  if (heldAcres(ctx) < founding * ACREAGE_MILESTONE_MULTIPLIER) return;

  w.platIlluminated = true;
  w.chronicle.push({
    year: w.year, weight: 'illuminated',
    title: msg(ctx, 'land.terrier_title', 'The House Has Grown Its Ground'),
    text: msg(ctx, 'land.terrier',
      'The terrier was drawn again, and it no longer fits the page it was first written on.'),
    named: false,
  });
}

/** What a client draws for the land panel — held ground, the open market, and what each thing there costs today. */
export interface LandView {
  treasury: number;
  rentsPolicy: RentPolicy;
  held: {
    parcel: string; name: string; kind?: ParcelKind; place: string;
    acres: number; provenance: string; heldSince: Year;
    baseYield: number; yieldBonus: number; yieldFactor: number;
    sellable: boolean; sellPrice: number;
    improving?: Year;
    improveCost: number; canImprove: boolean;
    /** Backed by the notary's book. True unless a drawn doubt has marked it otherwise (issue #96). */
    titleProved: boolean;
    /** Somebody else's terrier claims this ground too, named — absent means uncontested (issue #96). */
    contestedBy?: string;
    /** The seat's own identity-holdings never leave it (issue #91, Stage H) — a client's endow action refuses this before the order does. */
    caput: boolean;
    /** Which hall holds it, by id and name — absent means the seat (issue #91, Stage H). */
    holder?: string;
    holderName?: string;
  }[];
  market: {
    parcel: string; name: string; kind: ParcelKind; place: string;
    price: number; closesYear: Year; reason: 'neighbour_short' | 'fair'; canBuy: boolean;
  }[];
  /** Ground the house once held and does not (issue #96) — the plat's `lost` state. */
  lost: { defId: string; name: string; place: string; year: Year; by: string }[];
}

/**
 * `world.lostParcels` keeps the words written the year the ground went. Where
 * those are still the parcel's authored Original, show them in the reader's
 * wording; a name the player gave the ground stays theirs. The save is untouched.
 */
function lostView(ctx: SimCtx, l: LandView['lost'][number]): LandView['lost'][number] {
  const def = ctx.content.parcel(l.defId);
  if (!def) return { ...l };
  return {
    ...l,
    name: l.name === def.name ? parcelProse(ctx, def, 'name', def.name) : l.name,
    place: l.place === def.place ? parcelProse(ctx, def, 'place', def.place) : l.place,
  };
}

export function landView(ctx: SimCtx): LandView {
  const w = ctx.world;
  const improving = new Map(w.landImprovements.map((imp) => [imp.parcel, imp.completes]));

  const held: LandView['held'] = [];
  for (const [id, state] of w.parcels) {
    if (state.heldSince > w.year) continue;
    const def = state.defId ? ctx.content.parcel(state.defId) : undefined;
    if (state.defId && !def) continue; // a def that vanished from content — nothing sane to draw
    const cost = def ? parcelPrice(def) : 0;
    const completes = improving.get(id);
    held.push({
      // `def.id` when there is one, matching what `sell`/`improve` orders and
      // `liveStateOf` key on — never the runtime state id, which those
      // functions do not search by. A def-less parcel has no other name for
      // it, so it falls back to its own state id.
      parcel: def?.id ?? id,
      name: displayName(ctx, state, def),
      kind: def?.kind,
      place: def ? parcelProse(ctx, def, 'place', def.place)
        : msg(ctx, 'land.view.made_place', 'ground the house cleared itself'),
      acres: def?.acres ?? 0,
      provenance: def ? parcelProse(ctx, def, 'provenance', def.provenance)
        : msg(ctx, 'land.view.made_provenance', "made, not bought — no deed but the house's own word"),
      heldSince: state.heldSince,
      baseYield: def?.baseYield ?? 0,
      yieldBonus: state.yieldBonus ?? 0,
      yieldFactor: state.yieldFactor ?? 1,
      sellable: def !== undefined && def.kind !== 'demesne',
      sellPrice: Math.round(cost * SELL_FACTOR),
      ...(completes !== undefined ? { improving: completes } : {}),
      improveCost: cost,
      canImprove: def !== undefined && def.kind !== 'town_house'
        && completes === undefined && w.treasury - cost >= DEBT_FLOOR,
      titleProved: state.titleProved ?? true,
      ...(state.contestedBy ? { contestedBy: state.contestedBy } : {}),
      caput: def !== undefined && isCaput(def),
      ...(state.holder ? { holder: state.holder, holderName: w.branches.get(state.holder)?.name ?? state.holder } : {}),
    });
  }

  const market: LandView['market'] = [];
  for (const lot of w.landMarket.lots) {
    const def = ctx.content.parcel(lot.parcel);
    if (!def) continue;
    market.push({
      parcel: lot.parcel,
      name: parcelProse(ctx, def, 'name', def.name),
      kind: def.kind,
      place: parcelProse(ctx, def, 'place', def.place),
      price: lot.price,
      closesYear: lot.closesYear,
      reason: lot.reason,
      canBuy: w.treasury - lot.price >= DEBT_FLOOR,
    });
  }

  return {
    treasury: Math.round(w.treasury), rentsPolicy: w.rentsPolicy, held, market,
    lost: w.lostParcels.map((l) => lostView(ctx, l)),
  };
}
