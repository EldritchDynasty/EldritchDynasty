import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { RESPECT_ORDER } from '@ed/schema';
import {
  ambientPool, beginImprovement, buyParcel, damageParcel, encroachParcel, endowParcel, grantParcel,
  heldParcels, isCaput, landIncome, landView, recallParcel,
  grudgeAgainstUs, parcelPrice, restoreParcel, seizeParcel, sellParcel,
  setRentsPolicy, testWorld, tickLandImprovements, tickLandMarket, tickLandRisks,
  type Rng,
} from '@ed/core';

const bundle = loadContent();

/**
 * A deterministic stand-in for the RNG `tickLandMarket` draws from — only
 * `bool` is ever called, so it is the only method that has to mean anything.
 * A sequence rather than a single boolean because opening one lot spends TWO
 * calls (whether a lot opens, then whether it is urgent), so the tests below
 * can be exact about what each call decides instead of trusting a live
 * seeded RNG to line up.
 */
function scriptedRng(sequence: boolean[]): Rng {
  let i = 0;
  const unused = (): never => { throw new Error('scriptedRng: this method was not scripted'); };
  return {
    next: unused,
    int: unused,
    range: unused,
    bool: () => sequence[i++ % sequence.length]!,
    pick: (xs) => xs[0]!,
    weighted: () => undefined,
    normal: unused,
    poisson: unused,
    fork: () => scriptedRng(sequence),
  };
}

function riskRng(normals: number[], bools: boolean[] = [false]): Rng {
  let ni = 0;
  let bi = 0;
  const unused = (): never => { throw new Error('riskRng: this method was not scripted'); };
  return {
    next: unused,
    int: unused,
    range: unused,
    bool: () => bools[bi++ % bools.length]!,
    pick: (xs) => xs[0]!,
    weighted: () => undefined,
    normal: () => normals[ni++ % normals.length]!,
    poisson: unused,
    fork: () => riskRng(normals, bools),
  };
}

/**
 * PHASE A'S WHOLE ACCEPTANCE BAR (issue #93): the house owns the same 1,400
 * acres either way — the only question is whether the number is looked up
 * or added up. The 1042 endowment's `baseYield` sums to exactly what the old
 * five-row lookup returned at each tier, scaled by the same fraction, so for
 * as long as nothing is bought, sold or lost `landIncome` must reproduce the
 * old table byte for byte. `npm run digest -- 8 400` is the same claim
 * proved over a played run; this is the claim proved directly, at every
 * tier, without waiting on the simulation to visit one.
 */
describe('landIncome', () => {
  const OLD_LOOKUP = { unknown: 16, known: 32, regarded: 62, eminent: 108, exalted: 175 } as const;

  it('reproduces the old flat Respect-tier lookup exactly, at every tier, in 1042', () => {
    for (const tier of RESPECT_ORDER) {
      const ctx = testWorld(bundle);
      ctx.world.respect = tier;
      expect(landIncome(ctx), `tier ${tier}`).toBeCloseTo(OLD_LOOKUP[tier], 10);
    }
  });

  it('scales down when the house no longer holds a parcel it started with', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    const before = landIncome(ctx);

    const [firstId, firstState] = [...ctx.world.parcels.entries()][0]!;
    ctx.world.parcels.set(firstId, { ...firstState, heldSince: ctx.world.year + 1 });

    expect(landIncome(ctx), 'losing a parcel must lower income, not leave it flat').toBeLessThan(before);
  });

  it('gives every held parcel its own id, detached from the map', () => {
    // The same guarantee `heldHeirlooms` makes: pulled out of the map, a
    // `ParcelState` still says which parcel it is.
    const ctx = testWorld(bundle);
    const held = heldParcels(ctx);
    expect(held.length).toBeGreaterThan(0);
    expect(new Set(held.map((p) => p.id)).size).toBe(held.length);
  });

  it('ignores a parcel not yet held this year', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    const [firstId, firstState] = [...ctx.world.parcels.entries()][0]!;
    ctx.world.parcels.set(firstId, { ...firstState, heldSince: ctx.world.year + 5 });
    const held = landIncome(ctx);

    ctx.world.parcels.set(firstId, { ...firstState, heldSince: ctx.world.year });
    const alsoHeld = landIncome(ctx);

    expect(held).toBeLessThan(alsoHeld);
  });

  it('adds an improvement bonus into income in exact proportion to the sum (issue #94)', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    const before = landIncome(ctx);
    const [, state] = [...ctx.world.parcels.entries()][0]!;
    state.yieldBonus = 10;
    const after = landIncome(ctx);
    expect(after - before).toBeCloseTo(10 * (OLD_LOOKUP.known / 140), 10);
  });
});

/**
 * PHASE B (issue #91, #94): buying, selling, rents and improvement. `hallowfield`
 * is a real founding farm and `sowerhay` a real market-only one — every test here
 * exercises content an author could actually have written, the same discipline
 * `rules.test.ts` holds itself to.
 */
describe('parcelPrice', () => {
  it('scales with baseYield', () => {
    const sowerhay = bundle.parcels.find((p) => p.id === 'sowerhay')!;
    const westerholt = bundle.parcels.find((p) => p.id === 'westerholt')!;
    expect(westerholt.baseYield).toBeGreaterThan(sowerhay.baseYield);
    expect(parcelPrice(westerholt)).toBeGreaterThan(parcelPrice(sowerhay));
  });
});

describe('buyParcel', () => {
  it('refuses a parcel nothing has listed', () => {
    const ctx = testWorld(bundle);
    expect(buyParcel(ctx, 'sowerhay').ok).toBe(false);
  });

  it('refuses when the house cannot raise the price', () => {
    const ctx = testWorld(bundle);
    ctx.world.landMarket.lots.push({ parcel: 'sowerhay', price: 84, closesYear: ctx.world.year + 3, reason: 'fair' });
    ctx.world.treasury = -200;
    const result = buyParcel(ctx, 'sowerhay');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot raise/);
  });

  it('mints a held parcel, spends the price, and empties the lot', () => {
    const ctx = testWorld(bundle);
    ctx.world.landMarket.lots.push({ parcel: 'sowerhay', price: 84, closesYear: ctx.world.year + 3, reason: 'fair' });
    const before = ctx.world.treasury;

    const result = buyParcel(ctx, 'sowerhay');

    expect(result.ok).toBe(true);
    expect(ctx.world.treasury).toBeCloseTo(before - 84, 5);
    expect(ctx.world.landMarket.lots.some((l) => l.parcel === 'sowerhay')).toBe(false);
    const held = heldParcels(ctx).find((s) => s.defId === 'sowerhay');
    expect(held).toBeDefined();
    expect(held!.heldSince).toBe(ctx.world.year);
  });
});

describe('sellParcel', () => {
  it('refuses a parcel the house does not hold', () => {
    const result = sellParcel(testWorld(bundle), 'sowerhay');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not hold/);
  });

  it('refuses to sell the home demesne — "let to nobody" (parcels.yaml)', () => {
    const result = sellParcel(testWorld(bundle), 'the_home_demesne');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not for sale/);
  });

  it('sells a held farm, crediting the treasury and dropping it from the map', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.treasury;

    const result = sellParcel(ctx, 'hallowfield');

    expect(result.ok).toBe(true);
    expect(ctx.world.treasury).toBeGreaterThan(before);
    expect(heldParcels(ctx).some((s) => s.defId === 'hallowfield')).toBe(false);
  });

  it('drops an unfinished improvement along with the parcel it was on', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    expect(ctx.world.landImprovements).toHaveLength(1);

    sellParcel(ctx, 'hallowfield');

    expect(ctx.world.landImprovements).toHaveLength(0);
  });
});

// Issue #91, Phase D (#98) — the `land` Effect's four ops, tested directly:
// `applyEffect`'s own `case 'land'` is a bare pass-through to these, so this
// is the level "returns" and "actually acts" are different claims at.
describe('grantParcel', () => {
  it('leaves Sowerhay eligible for its authored acquisition route', () => {
    const ctx = testWorld(bundle);
    ctx.world.generation = 1;
    expect(ambientPool(ctx).some((e) => e.id === 'a_neighbour_short_before_michaelmas')).toBe(true);
  });

  it('mints a held parcel for one the house does not yet hold', () => {
    const ctx = testWorld(bundle);
    expect(heldParcels(ctx).some((s) => s.defId === 'sowerhay')).toBe(false);

    grantParcel(ctx, 'sowerhay');

    expect(heldParcels(ctx).some((s) => s.defId === 'sowerhay')).toBe(true);
  });

  it('is a no-op on a parcel the house already holds — not a second grant', () => {
    const ctx = testWorld(bundle);
    const before = heldParcels(ctx).filter((s) => s.defId === 'hallowfield').length;

    grantParcel(ctx, 'hallowfield');

    expect(heldParcels(ctx).filter((s) => s.defId === 'hallowfield')).toHaveLength(before);
  });

  it('is a no-op on a parcel id nothing authored', () => {
    const ctx = testWorld(bundle);
    expect(() => grantParcel(ctx, 'no_such_parcel')).not.toThrow();
    expect(heldParcels(ctx).some((s) => s.defId === 'no_such_parcel')).toBe(false);
  });

  it('delists a market lot for the same parcel, so it cannot also be bought', () => {
    const ctx = testWorld(bundle);
    ctx.world.landMarket.lots.push({ parcel: 'sowerhay', price: 100, closesYear: ctx.world.year + 3, reason: 'fair' });

    grantParcel(ctx, 'sowerhay');

    expect(ctx.world.landMarket.lots.some((l) => l.parcel === 'sowerhay')).toBe(false);
  });
});

describe('encroachParcel', () => {
  it('mints a held parcel, exactly as grantParcel does', () => {
    const ctx = testWorld(bundle);
    expect(heldParcels(ctx).some((s) => s.defId === 'the_farthing')).toBe(false);

    encroachParcel(ctx, 'the_farthing');

    expect(heldParcels(ctx).some((s) => s.defId === 'the_farthing')).toBe(true);
  });

  it('writes a bearing act — the cost `grant` alone does not have', () => {
    const ctx = testWorld(bundle);
    expect(ctx.world.bearing.acts).toHaveLength(0);

    encroachParcel(ctx, 'the_farthing');

    expect(ctx.world.bearing.acts).toEqual([{ year: ctx.world.year, kind: 'bit_the_common', about: 'The Farthing' }]);
  });

  it('takes no payment — treasury is untouched', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.treasury;
    encroachParcel(ctx, 'the_farthing');
    expect(ctx.world.treasury).toBe(before);
  });

  it('is a no-op, bearing act included, on a parcel the house already holds', () => {
    const ctx = testWorld(bundle);
    const before = heldParcels(ctx).filter((s) => s.defId === 'hallowfield').length;

    encroachParcel(ctx, 'hallowfield');

    expect(heldParcels(ctx).filter((s) => s.defId === 'hallowfield')).toHaveLength(before);
    expect(ctx.world.bearing.acts).toHaveLength(0);
  });
});

/** A minimal active (or extinct) branch, the same shape `branches.test.ts` constructs by hand. */
function makeBranch(ctx: ReturnType<typeof testWorld>, id: string, extinct = false) {
  ctx.world.branches.set(id as never, {
    id, name: `${id} Hall`, house: ctx.world.playerHouse, founder: 'nobody' as never,
    splitFrom: 'main', foundedYear: ctx.world.year - 30, grievance: 0,
    ...(extinct ? { extinct: ctx.world.year } : {}),
  } as never);
}

describe('endowParcel and recallParcel (issue #91, Stage H)', () => {
  it('moves a held, non-caput parcel to an active branch', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');

    const result = endowParcel(ctx, 'hallowfield', 'branch_a');

    expect(result.ok).toBe(true);
    expect(heldParcels(ctx).find((p) => p.defId === 'hallowfield')?.holder).toBe('branch_a');
  });

  it('is a no-op, not a refusal, when the parcel already sits with that branch', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    endowParcel(ctx, 'hallowfield', 'branch_a');

    expect(endowParcel(ctx, 'hallowfield', 'branch_a').ok).toBe(true);
  });

  it('refuses the caput — the mill, the woodland, the common, the demesne', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    for (const id of ['the_wend_mill', 'ardwen_wood', 'wick_common', 'the_home_demesne']) {
      expect(endowParcel(ctx, id, 'branch_a').ok, id).toBe(false);
      expect(heldParcels(ctx).find((p) => p.defId === id)?.holder, id).toBeUndefined();
    }
  });

  it('leaves an ordinary tenant farm endowable — caput is a kind check, not a blanket refusal', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    expect(endowParcel(ctx, 'hallowfield', 'branch_a').ok).toBe(true);
  });

  it('refuses a branch that does not exist', () => {
    const ctx = testWorld(bundle);
    expect(endowParcel(ctx, 'hallowfield', 'no_such_hall').ok).toBe(false);
    expect(heldParcels(ctx).find((p) => p.defId === 'hallowfield')?.holder).toBeUndefined();
  });

  it('refuses an extinct branch — nobody is left to answer for it', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a', true);
    expect(endowParcel(ctx, 'hallowfield', 'branch_a').ok).toBe(false);
  });

  it('refuses a parcel the house does not hold', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    expect(endowParcel(ctx, 'sowerhay', 'branch_a').ok).toBe(false);
  });

  it('excludes an endowed parcel from landIncome — the branch feeds itself (invariant 15)', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    const before = landIncome(ctx);

    endowParcel(ctx, 'hallowfield', 'branch_a');

    expect(landIncome(ctx)).toBeLessThan(before);
  });

  it('recall restores it to the seat\'s income exactly', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    const before = landIncome(ctx);
    endowParcel(ctx, 'hallowfield', 'branch_a');

    const result = recallParcel(ctx, 'hallowfield');

    expect(result.ok).toBe(true);
    expect(heldParcels(ctx).find((p) => p.defId === 'hallowfield')?.holder).toBeUndefined();
    expect(landIncome(ctx)).toBeCloseTo(before, 10);
  });

  it('recall is a no-op, not a refusal, on ground already the seat\'s own', () => {
    const ctx = testWorld(bundle);
    expect(recallParcel(ctx, 'hallowfield').ok).toBe(true);
  });

  it('recall refuses a parcel the house does not hold', () => {
    const ctx = testWorld(bundle);
    expect(recallParcel(ctx, 'sowerhay').ok).toBe(false);
  });

  it('landView reports caput, and holder/holderName only when endowed', () => {
    const ctx = testWorld(bundle);
    makeBranch(ctx, 'branch_a');
    endowParcel(ctx, 'hallowfield', 'branch_a');

    const view = landView(ctx);
    const hallowfield = view.held.find((p) => p.parcel === 'hallowfield')!;
    const mill = view.held.find((p) => p.parcel === 'the_wend_mill')!;

    expect(hallowfield.holder).toBe('branch_a');
    expect(hallowfield.holderName).toBe('branch_a Hall');
    expect(hallowfield.caput).toBe(false);
    expect(mill.holder).toBeUndefined();
    expect(mill.caput).toBe(true);
  });

  it('isCaput is true for the four singular kinds and false for tenant_farm', () => {
    const mill = bundle.parcels.find((p) => p.id === 'the_wend_mill')!;
    const woodland = bundle.parcels.find((p) => p.id === 'ardwen_wood')!;
    const common = bundle.parcels.find((p) => p.id === 'wick_common')!;
    const demesne = bundle.parcels.find((p) => p.id === 'the_home_demesne')!;
    const farm = bundle.parcels.find((p) => p.id === 'hallowfield')!;
    for (const def of [mill, woodland, common, demesne]) expect(isCaput(def), def.id).toBe(true);
    expect(isCaput(farm)).toBe(false);
  });
});

describe('seizeParcel', () => {
  it('actually removes a held parcel from the map, not merely returns', () => {
    const ctx = testWorld(bundle);
    expect(heldParcels(ctx).some((s) => s.defId === 'hallowfield')).toBe(true);

    seizeParcel(ctx, 'hallowfield');

    expect(heldParcels(ctx).some((s) => s.defId === 'hallowfield')).toBe(false);
  });

  it('drops an unfinished improvement along with the parcel it was on', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    expect(ctx.world.landImprovements).toHaveLength(1);

    seizeParcel(ctx, 'hallowfield');

    expect(ctx.world.landImprovements).toHaveLength(0);
  });

  it('is a no-op on a parcel the house does not hold', () => {
    const ctx = testWorld(bundle);
    expect(() => seizeParcel(ctx, 'sowerhay')).not.toThrow();
    expect(heldParcels(ctx).some((s) => s.defId === 'sowerhay')).toBe(false);
  });

  it('takes no payment — treasury is untouched, unlike sellParcel', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.treasury;
    seizeParcel(ctx, 'hallowfield');
    expect(ctx.world.treasury).toBe(before);
  });
});

describe('damageParcel and restoreParcel', () => {
  it('damage lowers a held parcel\'s contribution to income, and restore raises it back', () => {
    const ctx = testWorld(bundle);
    const before = landIncome(ctx);

    damageParcel(ctx, 'hallowfield');
    expect(landIncome(ctx)).toBeLessThan(before);

    restoreParcel(ctx, 'hallowfield');
    expect(landIncome(ctx)).toBeCloseTo(before, 10);
  });

  it('does not push a parcel\'s contribution below zero, however much damage it takes', () => {
    const ctx = testWorld(bundle);
    const def = bundle.parcels.find((p) => p.id === 'hallowfield')!;

    damageParcel(ctx, 'hallowfield', def.baseYield * 10);

    const [, state] = [...ctx.world.parcels.entries()].find(([, s]) => s.defId === 'hallowfield')!;
    expect(def.baseYield + (state.yieldBonus ?? 0)).toBeLessThan(0); // the state itself may go negative...
    expect(landIncome(ctx)).toBeGreaterThanOrEqual(0); // ...but landIncome floors this parcel's share at zero
  });

  it('restore is not capped at the undamaged baseline — an improved parcel stays improved once repaired', () => {
    const ctx = testWorld(bundle);
    const [id] = [...ctx.world.parcels.entries()].find(([, s]) => s.defId === 'hallowfield')!;
    ctx.world.parcels.set(id, { ...ctx.world.parcels.get(id)!, yieldBonus: 4 }); // two improvements' worth

    damageParcel(ctx, 'hallowfield', 2);
    restoreParcel(ctx, 'hallowfield', 2);

    expect(ctx.world.parcels.get(id)!.yieldBonus).toBe(4);
  });

  it('both are a no-op on a parcel the house does not hold', () => {
    const ctx = testWorld(bundle);
    expect(() => damageParcel(ctx, 'sowerhay')).not.toThrow();
    expect(() => restoreParcel(ctx, 'sowerhay')).not.toThrow();
    expect(heldParcels(ctx).some((s) => s.defId === 'sowerhay')).toBe(false);
  });
});

describe('setRentsPolicy', () => {
  it('defaults to customary, and exposes hard and rack terms', () => {
    const ctx = testWorld(bundle);
    expect(ctx.world.rentsPolicy).toBe('customary');
    setRentsPolicy(ctx, 'hard');
    expect(ctx.world.rentsPolicy).toBe('hard');
    setRentsPolicy(ctx, 'rack');
    expect(ctx.world.rentsPolicy).toBe('rack');
  });

  it('raises income now and leaves a house-wide grudge against the Head', () => {
    const ctx = testWorld(bundle);
    const before = landIncome(ctx);
    setRentsPolicy(ctx, 'rack');
    expect(landIncome(ctx)).toBeGreaterThan(before);
    expect(grudgeAgainstUs(ctx.world)).toBe(48);
  });
});

describe('beginImprovement', () => {
  it('refuses a parcel the house does not hold', () => {
    expect(beginImprovement(testWorld(bundle), 'sowerhay').ok).toBe(false);
  });

  it('refuses a second term on a parcel already being improved', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    const second = beginImprovement(ctx, 'hallowfield');
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already/);
  });

  it('refuses when the house cannot raise the cost', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = -200;
    expect(beginImprovement(ctx, 'hallowfield').ok).toBe(false);
  });

  it('spends the cost and schedules a completion year in the future', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.treasury;

    const result = beginImprovement(ctx, 'hallowfield');

    expect(result.ok).toBe(true);
    expect(ctx.world.treasury).toBeLessThan(before);
    expect(ctx.world.landImprovements).toHaveLength(1);
    expect(ctx.world.landImprovements[0]!.completes).toBeGreaterThan(ctx.world.year);
  });
});

describe('tickLandImprovements', () => {
  it('does nothing before the term completes', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');

    tickLandImprovements(ctx);

    expect(ctx.world.landImprovements).toHaveLength(1);
    const [, state] = [...ctx.world.parcels.entries()].find(([, s]) => s.defId === 'hallowfield')!;
    expect(state.yieldBonus ?? 0).toBe(0);
  });

  it('applies the yield bonus once the term completes, and clears the entry', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    ctx.world.year = ctx.world.landImprovements[0]!.completes;

    tickLandImprovements(ctx);

    expect(ctx.world.landImprovements).toHaveLength(0);
    const [, state] = [...ctx.world.parcels.entries()].find(([, s]) => s.defId === 'hallowfield')!;
    expect(state.yieldBonus).toBeGreaterThan(0);
  });

  it('does not throw on a term whose parcel is gone — the work is simply gone with it', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    const completes = ctx.world.landImprovements[0]!.completes;
    // Bypasses `sellParcel`'s own cleanup on purpose, so this exercises
    // `tickLandImprovements`' OWN guard rather than the one upstream of it.
    const [id] = [...ctx.world.parcels.entries()].find(([, s]) => s.defId === 'hallowfield')!;
    ctx.world.parcels.delete(id);
    ctx.world.year = completes;

    expect(() => tickLandImprovements(ctx)).not.toThrow();
    expect(ctx.world.landImprovements).toHaveLength(0);
  });

  it('raises discontent on hard terms, more on rack, and leaves it alone while customary', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.discontent;
    tickLandImprovements(ctx);
    expect(ctx.world.discontent).toBe(before);

    setRentsPolicy(ctx, 'hard');
    tickLandImprovements(ctx);
    const hard = ctx.world.discontent;
    setRentsPolicy(ctx, 'rack');
    tickLandImprovements(ctx);
    expect(hard).toBeGreaterThan(before);
    expect(ctx.world.discontent - hard).toBeGreaterThan(hard - before);
  });
});

describe('the six land risk shapes', () => {
  it('couples the Wend mill to the same village harvest as the tenant farms', () => {
    const ctx = testWorld(bundle);
    tickLandRisks(ctx, riskRng([0.8]));
    const farm = heldParcels(ctx).find((p) => p.defId === 'hallowfield')!;
    const mill = heldParcels(ctx).find((p) => p.defId === 'the_wend_mill')!;
    expect(farm.yieldFactor).toBeCloseTo(0.8, 10);
    expect(mill.yieldFactor).toBeCloseTo(1.8 * (0.25 + 0.8 * 0.75), 10);

    tickLandRisks(ctx, riskRng([1.2]));
    expect(farm.yieldFactor).toBeCloseTo(1.2, 10);
    expect(mill.yieldFactor).toBeCloseTo(1.8 * (0.25 + 1.2 * 0.75), 10);
  });

  it('gives slate high variance, Sarrow severe variance, and the Lag medium variance', () => {
    const ctx = testWorld(bundle);
    grantParcel(ctx, 'hesk_slate_work');
    grantParcel(ctx, 'sarrow_bottom');
    grantParcel(ctx, 'lag_eels_and_peat');

    tickLandRisks(ctx, riskRng([1, 4.1, 6.7, 0.45]));

    expect(heldParcels(ctx).find((p) => p.defId === 'hesk_slate_work')?.yieldFactor).toBe(4.1);
    expect(heldParcels(ctx).find((p) => p.defId === 'sarrow_bottom')?.yieldFactor).toBe(6.7);
    expect(heldParcels(ctx).find((p) => p.defId === 'lag_eels_and_peat')?.yieldFactor).toBe(0.45);
  });

  it('can lose the Sarrow bottom outright to the Grey', () => {
    const ctx = testWorld(bundle);
    grantParcel(ctx, 'sarrow_bottom');

    const result = tickLandRisks(ctx, riskRng([1, 3.4], [true]));

    expect(result.sarrowSank).toBe(true);
    expect(result.blighted).toEqual([]);
    expect(heldParcels(ctx).some((p) => p.defId === 'sarrow_bottom')).toBe(false);
    expect(ctx.world.chronicle.at(-1)?.text).toMatch(/black water off Sarrow/);
  });

  it('can strike Ardwen Wood with blight (issue #91, Stage G) — yield, not the acres', () => {
    const ctx = testWorld(bundle);
    // Settle every kind's real yieldFactor first (the mill's own 1.8x among
    // them), so `before` compares apples to apples rather than to the
    // pre-tick default of 1 every kind reads until `tickLandRisks` runs once.
    tickLandRisks(ctx, riskRng([1], [false]));
    const before = landIncome(ctx);

    const result = tickLandRisks(ctx, riskRng([1], [true]));

    expect(result.blighted).toEqual(['ardwen_wood']);
    expect(heldParcels(ctx).some((p) => p.defId === 'ardwen_wood')).toBe(true);
    expect(landIncome(ctx)).toBeLessThan(before);
    expect(ctx.world.chronicle.at(-1)?.text).toMatch(/[Bb]light took hold in Ardwen Wood/);
  });

  it('leaves the woodland untouched when the blight roll fails, unlike a guaranteed hazard', () => {
    const ctx = testWorld(bundle);
    const chronicleBefore = ctx.world.chronicle.length;

    const result = tickLandRisks(ctx, riskRng([1], [false]));

    expect(result.blighted).toEqual([]);
    expect(ctx.world.chronicle).toHaveLength(chronicleBefore);
    expect(heldParcels(ctx).find((p) => p.defId === 'ardwen_wood')?.yieldBonus ?? 0).toBe(0);
  });

  it('makes the Bramme house a zero-yield presence rather than producing ground', () => {
    const ctx = testWorld(bundle);
    grantParcel(ctx, 'bramme_house');
    delete ctx.world.respectChanged;

    tickLandRisks(ctx, riskRng([1]));

    const house = heldParcels(ctx).find((p) => p.defId === 'bramme_house')!;
    expect(house.yieldFactor).toBe(0);
    expect(ctx.world.respectChanged).toBe(ctx.world.year);
    expect(beginImprovement(ctx, 'bramme_house').ok).toBe(false);
  });

  it('prices the Lag cheaply and costs standing when the house buys it', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'regarded';
    ctx.world.landMarket.lots.push({ parcel: 'lag_eels_and_peat', price: 42, closesYear: ctx.world.year + 2, reason: 'fair' });

    expect(buyParcel(ctx, 'lag_eels_and_peat').ok).toBe(true);
    expect(ctx.world.respect).toBe('known');
    expect(parcelPrice(bundle.parcels.find((p) => p.id === 'lag_eels_and_peat')!)).toBe(42);
  });
});

describe('tickLandMarket', () => {
  it('leaves a deed owned by an authored acquisition route off the ordinary market', () => {
    const ctx = testWorld(bundle);
    tickLandMarket(ctx, scriptedRng([true, false]));
    expect(ctx.world.landMarket.lots.some((l) => l.parcel === 'sowerhay')).toBe(false);
  });

  it('never lists a parcel the house already holds', () => {
    const ctx = testWorld(bundle);
    tickLandMarket(ctx, scriptedRng([true]));
    const heldIds = new Set(heldParcels(ctx).map((s) => s.defId));
    expect(ctx.world.landMarket.lots.some((l) => heldIds.has(l.parcel))).toBe(false);
  });

  it('opens lots up to the cap and no further, even when every roll succeeds', () => {
    const ctx = testWorld(bundle);
    tickLandMarket(ctx, scriptedRng([true, false]));
    const opened = ctx.world.landMarket.lots.length;
    expect(opened).toBeGreaterThan(0);
    expect(opened).toBeLessThanOrEqual(2);

    // A second tick against an already-full market must not grow it further.
    tickLandMarket(ctx, scriptedRng([true, false]));
    expect(ctx.world.landMarket.lots.length).toBe(opened);
  });

  it('expires a lot once its window has passed, and does not carry it forward', () => {
    const ctx = testWorld(bundle);
    ctx.world.landMarket.lots.push({ parcel: 'sowerhay', price: 84, closesYear: ctx.world.year, reason: 'fair' });

    tickLandMarket(ctx, scriptedRng([false]));

    expect(ctx.world.landMarket.lots.some((l) => l.parcel === 'sowerhay')).toBe(false);
  });
});

describe('landView', () => {
  it('lists every held parcel, with the demesne marked unsellable and a farm sellable', () => {
    const view = landView(testWorld(bundle));
    expect(view.held.length).toBeGreaterThan(0);
    expect(view.held.find((p) => p.parcel === 'the_home_demesne')?.sellable).toBe(false);
    expect(view.held.find((p) => p.kind === 'tenant_farm')?.sellable).toBe(true);
  });

  it('draws the open market, with canBuy reflecting the treasury', () => {
    const ctx = testWorld(bundle);
    ctx.world.landMarket.lots.push({ parcel: 'sowerhay', price: 84, closesYear: ctx.world.year + 2, reason: 'fair' });

    ctx.world.treasury = 1000;
    expect(landView(ctx).market.find((l) => l.parcel === 'sowerhay')?.canBuy).toBe(true);

    ctx.world.treasury = -200;
    expect(landView(ctx).market.find((l) => l.parcel === 'sowerhay')?.canBuy).toBe(false);
  });

  it('shows a term of improvement in progress, and refuses a second one through canImprove', () => {
    const ctx = testWorld(bundle);
    beginImprovement(ctx, 'hallowfield');
    const row = landView(ctx).held.find((p) => p.parcel === 'hallowfield');
    expect(row?.improving).toBeDefined();
    expect(row?.canImprove).toBe(false);
  });
});
