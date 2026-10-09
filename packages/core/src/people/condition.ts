import type { Person } from '@ed/schema';
import { standingCostPerHead } from '../economy.js';
import { hashSeed } from '../rng.js';
import type { SimCtx } from '../world.js';
import { msg } from '../messages.js';
import { ACQUIRED_NUTRITION, ACQUIRED_SPACING } from './factory.js';
import { MOTHER_SHARE } from './vitality.js';

/** A generation is long enough to feel a fortune compound, not a stat flip. */
const NUTRITION_RESPONSE = 0.05;
const NUTRITION_MIN = -10;
const NUTRITION_MAX = 3;
const SPACING_RESPONSE = 0.7;
const SPACING_TOLL = 45;

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const toward = (at: number, target: number, response: number): number => at + (target - at) * response;

/**
 * The body's reading of the purse, in acquired Health points.
 *
 * Treasury is a stock, so divide it by both the mouths it must support and
 * their annual cost. The result is years of visible living held in reserve.
 * One year is neutral; debt is lean; wealth beyond two years can help only a
 * little. The asymmetric cap is deliberate: hunger can do more than plenty.
 */
export function nutritionTarget(ctx: SimCtx): number {
  const w = ctx.world;
  const living = w.people.household(w.playerHouse, w.year).length;
  const reservePerHead = w.treasury / Math.max(1, living);
  const costPerHead = standingCostPerHead(w.respect, living);
  const reserveYears = reservePerHead / costPerHead;
  return clamp((reserveYears - 1) * 4, NUTRITION_MIN, NUTRITION_MAX);
}

/** Move every living member slowly toward this year's nutritional weather. */
export function nutrition(ctx: SimCtx): number {
  const w = ctx.world;
  const target = nutritionTarget(ctx);
  for (const p of w.people.household(w.playerHouse, w.year)) {
    const at = p.acquired[ACQUIRED_NUTRITION] ?? 0;
    p.acquired[ACQUIRED_NUTRITION] = toward(at, target, NUTRITION_RESPONSE);
    if (p.phenotype) p.phenotype.dirty = true;
  }

  // Once a decade is enough to make a condition legible without making the
  // chronicle an account book. The fixed title lets the client group the years.
  if (target <= -4 && w.year % 10 === 0) {
    w.chronicle.push({
      year: w.year,
      weight: 'line',
      title: msg(ctx, 'condition.lean_years_title', 'The Lean Years'),
      text: msg(ctx, 'condition.lean_years',
        'The kitchen fires burned low. By spring, the children had stopped asking why.'),
      named: false,
    });
  }
  return target;
}

/**
 * Recover from a birth over three or four years, chosen once for this mother,
 * father and next child. Setting a target is the important part: adding the
 * toll every winter would run into fertility's clamp and become inert.
 */
export function spacing(ctx: SimCtx, mother: Person): number {
  const w = ctx.world;
  const children = w.people.children(mother.id);
  const last = children.reduce((year, child) => Math.max(year, child.born), -Infinity);
  let target = 0;

  if (Number.isFinite(last)) {
    const ordinal = children.length + 1;
    const father = mother.marriages.find((m) => m.to === undefined)?.spouse ?? 'none';
    const restYears = 3 + (hashSeed(w.seed, 'spacing', String(mother.id), String(father), String(ordinal)) % 2);
    const since = Math.max(0, w.year - last);
    const remaining = clamp(1 - since / restYears, 0, 1);
    target = -SPACING_TOLL * remaining * remaining;
  }

  const at = mother.acquired[ACQUIRED_SPACING] ?? 0;
  mother.acquired[ACQUIRED_SPACING] = toward(at, target, SPACING_RESPONSE);
  if (mother.phenotype) mother.phenotype.dirty = true;
  return target;
}

/**
 * What acquired bodily condition is worth to a completed family.
 *
 * Annual fertility already reads these values, but an annual chance alone is
 * invisible whenever a couple reaches its inherited cap. Health therefore
 * moves capacity as well as timing. The temporary spacing toll is excluded:
 * rest delays the next child; it does not permanently make the family smaller.
 */
export function acquiredFamilySize(mother: Person, father: Person): number {
  const health = (mother.acquired.health ?? 0) * MOTHER_SHARE
    + (father.acquired.health ?? 0) * (1 - MOTHER_SHARE);
  const nutrition = (mother.acquired[ACQUIRED_NUTRITION] ?? 0) * MOTHER_SHARE
    + (father.acquired[ACQUIRED_NUTRITION] ?? 0) * (1 - MOTHER_SHARE);
  const fertility = (mother.acquired.fertility ?? 0) * MOTHER_SHARE
    + (father.acquired.fertility ?? 0) * (1 - MOTHER_SHARE);
  return health / 7 + nutrition / 4 + fertility / 40;
}

/** Existing economy phase hook: close the books, then let bodies read them. */
export function tickCondition(ctx: SimCtx): void {
  nutrition(ctx);
  for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
    if (p.sex === 'female') spacing(ctx, p);
  }
}
