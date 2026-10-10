import type { Commitment, Person, PositionDef, RespectTier } from '@ed/schema';
import { assertNever, musterEscalation, RESPECT_ORDER } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { Rng } from './rng.js';
import { activeBranches } from './people/branches.js';
import { DEBT_FLOOR } from './economy.js';
import { msg } from './messages.js';

/**
 * THE MUSTER'S NUMBERS (concept §6, world §10; issue #89, Stage 2 — #95).
 *
 * Anchored on the economy as it stands (issue #89's own table): income by
 * tier 16/32/62/108/175, the levy commutation at 120 crowns as the
 * canonical "a war costs about this much" price. First guesses, to be
 * swept in the harness rather than believed — `docs/BALANCE-LOG.md`
 * carries what the sweep found.
 */
const LEVY_BY_RESPECT: Record<RespectTier, number> = {
  unknown: 4, known: 8, regarded: 14, eminent: 22, exalted: 34,
};
const MEN_PER_ACTIVE_BRANCH = 4;

/** How many men a house can put in the field — derivable from state that already exists, no tenant model. */
export function maxMen(ctx: SimCtx): number {
  return LEVY_BY_RESPECT[ctx.world.respect] + MEN_PER_ACTIVE_BRANCH * activeBranches(ctx.world).length;
}

/** ~48/yr on a 40-man commitment against an eminent house's 108 income: crushing. ~13/yr on 11: a nuisance. */
const PER_MAN_PER_YEAR = 1.2;
/** ~38% of a cohort gone over a 12-year war, worse on a bad tide. */
const BASE_ATTRITION = 0.04;
/** A serjeanty, 11 men, 12 years ≈ 13 credit. */
const CREDIT_RATE = 0.10;
/** Sits beside `military`'s 0.03 — recognisably the same order. Tide-scaled up to double at the worst tide. */
const OFFICER_HAZARD_BASE = 0.02;
const OFFICER_HAZARD_TIDE_SPAN = 0.02;

/** The tide's own yearly walk — small, so a war does not flip from triumphant to catastrophic in one spring. */
const TIDE_WALK_MAX = 8;
const TIDE_MIN = 0;
const TIDE_MAX = 100;

function clamp(lo: number, hi: number, n: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** At most one commitment is ever `in_the_field` — `arc_the_muster`'s own `maxConcurrentInstances: 1`. */
export function activeCommitment(ctx: SimCtx): Commitment | undefined {
  return ctx.world.muster.commitments.find((c) => c.status === 'in_the_field');
}

/**
 * THE ESCALATION READ FRESH (issue #95 comment). Only a `settled`
 * commitment counts — a house that withdrew did not finish what the Crown
 * is measuring, so it does not raise the ask for the next one either.
 */
function escalationNow(ctx: SimCtx): number {
  return musterEscalation(ctx.world.muster.commitments.filter((c) => c.status === 'settled').length);
}

/**
 * WORD GETS AROUND, AND IT ISN'T IN WRITING (issue #89, `positions.yaml`).
 * The trickle a commitment with no position bought still earns — deliberately
 * not zero, so the choice is "buy in or be underpaid for your dead" rather
 * than "buy in or don't play". Mirrors `none`'s own `multiplier` in
 * `positions.yaml`, which exists for an author to read; a commitment that
 * never bought anything is not obligated to have set `position: 'none'` to
 * get the same rate.
 */
const NO_POSITION_MULTIPLIER = 0.15;

/** Half price for a house with a man already serving — the two systems talking without merging (issue #97). */
const DISCOUNT_WITH_CAREER_SERVING = 0.5;

function positionOf(ctx: SimCtx, c: Commitment) {
  return c.position ? ctx.content.position(c.position) : undefined;
}

/** Read by `tickMuster`'s credit accrual. `NO_POSITION_MULTIPLIER` for no position, or one nothing can resolve. */
function creditMultiplier(ctx: SimCtx, c: Commitment): number {
  return positionOf(ctx, c)?.multiplier ?? NO_POSITION_MULTIPLIER;
}

/** `war` in `tickEconomy`'s tally. Money moves in ONE place — `economy.ts` reads this, never `muster.ts` itself. */
export function musterUpkeep(ctx: SimCtx): number {
  const c = activeCommitment(ctx);
  if (!c) return 0;
  return c.men * PER_MAN_PER_YEAR + (positionOf(ctx, c)?.perYear ?? 0);
}

/**
 * OFFICER MORTALITY DODGES INVARIANT 2 RATHER THAN COMPLYING WITH IT (#89).
 * A term in `rollDeath`'s hazard sum, beside `careerMortality` — `kill()`
 * stays the one gate, and this never calls it. Zero for anyone not an
 * officer of the commitment standing, which is nearly everybody nearly
 * always: the whole point of the dormancy rule is that this function costs
 * nothing to call on a house that has never mustered.
 */
export function musterMortality(ctx: SimCtx, p: Person): number {
  const c = activeCommitment(ctx);
  if (!c || !c.officers.includes(p.id)) return 0;
  const tideWorseness = (TIDE_MAX - ctx.world.muster.tide) / TIDE_MAX;
  return OFFICER_HAZARD_BASE + OFFICER_HAZARD_TIDE_SPAN * tideWorseness;
}

/** A line the player can feel and name — invariant 13 generalised past the Assize to any standing, quiet pressure. */
function chronicleLine(ctx: SimCtx, c: Commitment, lost: number, tide: number): string {
  // Whole sentences, one key per shape, so a translation never has to stitch
  // a tide phrase into somebody else's clause.
  const v = { MEN: String(c.men), LOST: String(lost) };
  if (lost > 0) {
    return tide >= 60
      ? msg(ctx, 'muster.war_line.favour_lost', "The war goes on. {MEN} of the house's men remain in the field, {LOST} lost this year, and the tide runs in the house's favour.", v)
      : tide <= 40
        ? msg(ctx, 'muster.war_line.against_lost', "The war goes on. {MEN} of the house's men remain in the field, {LOST} lost this year, and the tide runs against the house.", v)
        : msg(ctx, 'muster.war_line.holding_lost', "The war goes on. {MEN} of the house's men remain in the field, {LOST} lost this year, and the tide runs holding, for now.", v);
  }
  return tide >= 60
    ? msg(ctx, 'muster.war_line.favour', "The war goes on. {MEN} of the house's men remain in the field, and the tide runs in the house's favour.", v)
    : tide <= 40
      ? msg(ctx, 'muster.war_line.against', "The war goes on. {MEN} of the house's men remain in the field, and the tide runs against the house.", v)
      : msg(ctx, 'muster.war_line.holding', "The war goes on. {MEN} of the house's men remain in the field, and the tide runs holding, for now.", v);
}

/**
 * THE YEARLY TICK, run from the `muster` phase. FULLY DORMANT with no
 * commitment standing — no draw, no write, no chronicle line — which is
 * the free regression test issue #95 names: a run that never musters must
 * produce a bit-identical `npm run digest` block.
 *
 * Settlement is not this function's job. `the_settlement` is a docketed
 * choice event with its own Record block, reached through `arc_the_muster`'s
 * own successor graph (`ageActive: the_wars` on the edges) — existing
 * engine machinery. This only keeps the books between beats.
 */
export function tickMuster(ctx: SimCtx, rng: Rng): void {
  const w = ctx.world;
  const c = activeCommitment(ctx);
  if (!c) return;

  w.muster.tide = clamp(TIDE_MIN, TIDE_MAX, w.muster.tide + rng.range(-TIDE_WALK_MAX, TIDE_WALK_MAX));

  const tideWorseness = (TIDE_MAX - w.muster.tide) / TIDE_MAX;
  const escalation = escalationNow(ctx);
  const attritionRate = BASE_ATTRITION * (1 + tideWorseness) * escalation;
  const lost = Math.min(c.men, Math.round(c.men * attritionRate));
  c.men -= lost;

  c.credit += CREDIT_RATE * c.men * escalation * creditMultiplier(ctx, c);

  w.chronicle.push({
    year: w.year,
    weight: 'line',
    text: chronicleLine(ctx, c, lost, w.muster.tide),
    named: false,
  });
}

// ── The `muster` effect's operations (issue #95, `events/effects.ts`'s `case 'muster'`) ──

/** Opens a commitment. `men` is clamped to `maxMen` — an authored levy asking for more than the house can field asks for what it can. */
export function beginCommitment(ctx: SimCtx, men: number, age: string): Commitment {
  const w = ctx.world;
  const id = `must_${(w.counters.muster += 1).toString(36)}`;
  const commitment: Commitment = {
    id,
    began: w.year,
    age,
    men: clamp(0, maxMen(ctx), men),
    from: {},
    officers: [],
    credit: 0,
    status: 'in_the_field',
  };
  w.muster.commitments.push(commitment);
  return commitment;
}

/** More men into the standing commitment, attributed to whichever hall sent them, if named. */
export function reinforceCommitment(ctx: SimCtx, men: number, from?: string): boolean {
  const c = activeCommitment(ctx);
  if (!c || men <= 0) return false;
  c.men += men;
  if (from) c.from[from] = (c.from[from] ?? 0) + men;
  return true;
}

/** Real family, never a second one twice. */
export function addOfficer(ctx: SimCtx, personId: string): boolean {
  const c = activeCommitment(ctx);
  if (!c) return false;
  if (!c.officers.includes(personId)) c.officers.push(personId);
  return true;
}

/**
 * SETS THE POSITION WITHOUT CHARGING FOR IT. For content: an authored event
 * already prices its own choices (`the_position_offered`'s own `requires`
 * and `treasury` effects) and only needs the state to agree with the fiction
 * afterward. The player's own buy, with the affordability, Respect and
 * officer-age gates and the discount, is `buyPosition` below.
 */
export function setPosition(ctx: SimCtx, position: string): boolean {
  const c = activeCommitment(ctx);
  if (!c) return false;
  c.position = position;
  return true;
}

/** What a house with an officer already in `discountWithCareer` actually pays. Independent of the other gates, so the panel can show it even where one of those refuses the buy. */
function priceOf(ctx: SimCtx, c: Commitment, def: PositionDef): number | undefined {
  if (def.price === undefined) return undefined;
  const serving = def.discountWithCareer !== undefined
    && c.officers.some((id) => ctx.world.people.get(id)?.career?.career === def.discountWithCareer);
  return serving ? def.price * (1 - DISCOUNT_WITH_CAREER_SERVING) : def.price;
}

/** The three gates a buy must clear, shared by `buyPosition` and `positionOptions` so a preview cannot say yes to a buy that then refuses. */
function checkPosition(ctx: SimCtx, position: string): MusterOrderResult {
  const c = activeCommitment(ctx);
  if (!c) return { ok: false, reason: msg(ctx, 'muster.refuse.buy_no_commitment', 'no commitment is standing') };
  const def = ctx.content.position(position);
  if (!def) return { ok: false, reason: msg(ctx, 'muster.refuse.buy_no_position', 'no such position') };

  if (def.minRespect !== undefined) {
    const have = RESPECT_ORDER.indexOf(ctx.world.respect);
    const need = RESPECT_ORDER.indexOf(def.minRespect as RespectTier);
    if (have < need) {
      return {
        ok: false,
        reason: msg(ctx, 'muster.refuse.respect', 'the house is not {RESPECT} enough yet', { RESPECT: def.minRespect }),
      };
    }
  }

  if (def.requiresOfficerAged !== undefined) {
    const aged = c.officers.some((id) => {
      const p = ctx.world.people.get(id);
      return p !== undefined && ctx.world.year - p.born >= def.requiresOfficerAged!;
    });
    if (!aged) {
      return {
        ok: false,
        reason: msg(ctx, 'muster.refuse.officer_age', 'needs an officer at least {AGE} years old',
          { AGE: String(def.requiresOfficerAged) }),
      };
    }
  }

  const price = priceOf(ctx, c, def);
  if (price !== undefined && ctx.world.treasury - price < DEBT_FLOOR) {
    return {
      ok: false,
      reason: msg(ctx, 'muster.refuse.cost',
        'the house cannot raise {PRICE} crowns', { PRICE: String(Math.round(price)) }),
    };
  }
  return { ok: true };
}

/**
 * THE PLAYER'S OWN BUY (issue #97). `none` is a real, free purchase here —
 * "a choice and not an absence" (#97's acceptance) — since it has no `price`
 * and clears every gate by construction.
 */
export function buyPosition(ctx: SimCtx, position: string): MusterOrderResult {
  const check = checkPosition(ctx, position);
  if (!check.ok) return check;
  const c = activeCommitment(ctx)!;
  const def = ctx.content.position(position)!;
  const price = priceOf(ctx, c, def);
  if (price !== undefined) ctx.world.treasury -= price;
  c.position = def.id;
  return { ok: true };
}

/** What a client draws for "buy a position" — every position, priced today, and whether the house could actually buy it right now. */
export interface PositionOption {
  id: string;
  name: string;
  price?: number;
  perYear: number;
  current: boolean;
  canBuy: boolean;
  reason?: string;
}

export function positionOptions(ctx: SimCtx): PositionOption[] {
  const c = activeCommitment(ctx);
  if (!c) return [];
  return ctx.content.positions.map((def) => {
    const check = checkPosition(ctx, def.id);
    const price = priceOf(ctx, c, def);
    return {
      id: def.id,
      name: def.name,
      ...(price !== undefined ? { price: Math.round(price) } : {}),
      perYear: def.perYear,
      current: c.position === def.id,
      canBuy: check.ok,
      ...(check.reason !== undefined ? { reason: check.reason } : {}),
    };
  });
}

/** `status: 'settled'` — spends the credit, or not; the calling event's Record block decides what that means. */
export function settleCommitment(ctx: SimCtx): boolean {
  const c = activeCommitment(ctx);
  if (!c) return false;
  c.status = 'settled';
  ctx.world.muster.lastSettled = ctx.world.year;
  return true;
}

/** Keeps the men, forfeits the credit. Available every year — the good decision (#89). */
export function withdrawCommitment(ctx: SimCtx): boolean {
  const c = activeCommitment(ctx);
  if (!c) return false;
  c.status = 'withdrawn';
  return true;
}

// ── The player's own verb (issue #89's interaction table, "Changing it") ──

/**
 * WHAT A PLAYER CAN TELL A STANDING COMMITMENT, ANY YEAR, NO DOCKET (#89).
 * Narrower than the full `muster` Effect: `begin`, `add_officer` and
 * `settle` are scripted moments an authored event reaches, not something a
 * player free-picks off a panel. `buy` is stage 3's addition (#97), now that
 * `positions.yaml` has real prices to show and check against.
 */
export type MusterOrder =
  | { op: 'reinforce'; men: number }
  | { op: 'buy'; position: string }
  | { op: 'withdraw' };

export interface MusterOrderResult {
  ok: boolean;
  reason?: string;
}

export function musterOrder(ctx: SimCtx, order: MusterOrder): MusterOrderResult {
  switch (order.op) {
    case 'reinforce': {
      if (!activeCommitment(ctx)) {
        return { ok: false, reason: msg(ctx, 'muster.refuse.reinforce_no_commitment', 'no commitment is standing') };
      }
      if (order.men <= 0) {
        return { ok: false, reason: msg(ctx, 'muster.refuse.reinforce_no_men', 'not a number of men') };
      }
      return reinforceCommitment(ctx, order.men)
        ? { ok: true }
        : { ok: false, reason: msg(ctx, 'muster.refuse.reinforce_lost_commitment', 'no commitment is standing') };
    }
    case 'buy': {
      return buyPosition(ctx, order.position);
    }
    case 'withdraw': {
      return withdrawCommitment(ctx)
        ? { ok: true }
        : { ok: false, reason: msg(ctx, 'muster.refuse.withdraw_no_commitment',
          'no commitment is standing to call home') };
    }
    default:
      return assertNever(order, 'muster order');
  }
}
