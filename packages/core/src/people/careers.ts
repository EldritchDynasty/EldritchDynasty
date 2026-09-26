import type { CareerDef, Person } from '@ed/schema';
import { canHoldPost } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { applyEffect } from '../events/effects.js';

/**
 * CAREERS — Respect is bought with descendants (issue #16).
 *
 * `Person.career` was declared, saved, and read by nothing. This is the one
 * place it is read: income into `tickEconomy`'s treasury, a per-year chance of
 * moving Respect through the same `respect` effect every other system uses,
 * and the costs that make the rule true — read by `demography.ts` directly
 * rather than duplicated here.
 */

export function careerDefOf(ctx: SimCtx, p: Person): CareerDef | undefined {
  return p.career ? ctx.content.career(p.career.career) : undefined;
}

/**
 * INVARIANT `canHoldPost` (schema) is the only placement gate; this is the
 * refusal a client can read, shaped like `canStudySpellbook`'s.
 *
 * Every post in the game is a man's — §18's careers are real institutions and
 * every one of them is closed to a woman in Aubren: a commission in the Warden's levy, ordination
 * at the Bramme chapter house, a place in the King's household, a share in a
 * Sarrow venture, a bench at Cawdry, a bed at the Colleges.
 *
 * Three doors write `Person.career` — the player's `career` order, the
 * steward's `placePosts`, and the authored `career` effect — and before this
 * function each of them asked only for an age. So the steward bought
 * commissions for daughters, the table offered them, and the events narrated
 * them in prose that had already decided otherwise: "ordination is not a post
 * a man leaves", "He is very good at it", "Two sons, and one place". A woman
 * held the family's clergy cover and was out of the breeding pool for it.
 *
 * The gate is one function rather than a clamp at each of the three, for the reason
 * invariant 1 gives about Madness: a clamp is a thing a fourth door bypasses
 * by accident. A woman's exclusion from the posts is not her exclusion from
 * the game — the tutor's term, the library, the Match and the Record are all
 * hers, and the Threshold four are hers to practise (invariant 4).
 */
export function canTakePost(p: Person): { ok: true } | { ok: false; reason: string } {
  if (!canHoldPost(p.sex)) return { ok: false, reason: 'no post in Aubren is open to a woman' };
  return { ok: true };
}

/** Clergy: taken out of the breeding pool entirely. No marriage, no children. */
export function inBreedingPool(ctx: SimCtx, p: Person): boolean {
  return !careerDefOf(ctx, p)?.removesFromBreedingPool;
}

/** Military: kills people. Read by `rollDeath`, added straight into the annual hazard. */
export function careerMortality(ctx: SimCtx, p: Person): number {
  return careerDefOf(ctx, p)?.extraMortality ?? 0;
}

/** Clergy: grants Madness cover. The largest cover held anywhere in `roster`. */
export function madnessCoverOf(ctx: SimCtx, roster: Person[]): number {
  let cover = 0;
  for (const p of roster) cover = Math.max(cover, careerDefOf(ctx, p)?.madnessCover ?? 0);
  return cover;
}

/** How strongly a per-year Respect roll succeeds, by the career's qualitative yield. */
const RESPECT_CHANCE: Record<CareerDef['respectYield'], number> = {
  none: 0,
  low: 0.008,
  moderate: 0.02,
  high: 0.05,
};

/**
 * Income, Respect accrual, Charm growth, and lighting up the one dead branch
 * of `TraitAcquisitionS` this phase owns: a trait whose acquisition names a
 * career grants itself once the holder has served it long enough. Called once
 * a year, for the whole household — see `year/phases.ts`.
 */
export function tickCareers(ctx: SimCtx, rng: Rng): void {
  const w = ctx.world;

  // THE HOUSE'S STANDING FOLLOWS ITS MOST PROMINENT PLACEMENT, not the sum of
  // them. Rolled once for the whole house rather than once per holder.
  //
  // Per-holder was harmless while only three people a run were ever placed at
  // all — placement came solely from authored `career` effects. The moment the
  // steward started filling posts (`table.ts`), six simultaneous holders at
  // 0.05 a year drove five of six runs to exalted and flattened exactly the
  // standing spread the Assize had just opened. Standing is what the world
  // says about the family, and the world talks about the son at court, not
  // about all six of them at once.
  let bestYield: CareerDef['respectYield'] = 'none';
  for (const p of w.people.household(w.playerHouse, w.year)) {
    if (!p.career) continue;
    const def = ctx.content.career(p.career.career);
    if (!def) continue;

    const income = def.income.base + (def.income.variance ? rng.range(-def.income.variance, def.income.variance) : 0);
    w.treasury += income;
    if (RESPECT_CHANCE[def.respectYield] > RESPECT_CHANCE[bestYield]) bestYield = def.respectYield;

    if (def.attributeGrowth) {
      const { attr, perYear } = def.attributeGrowth;
      p.acquired[attr] = (p.acquired[attr] ?? 0) + perYear;
      if (p.phenotype) p.phenotype.dirty = true;
    }

    const heldYears = w.year - p.career.from;
    for (const trait of ctx.content.traits) {
      if (trait.acquisition.kind !== 'career') continue;
      if (trait.acquisition.career !== p.career.career) continue;
      if (heldYears < trait.acquisition.afterYears) continue;
      p.traits.add(trait.id);
    }
  }

  const chance = RESPECT_CHANCE[bestYield];
  if (chance > 0 && rng.bool(chance)) applyEffect({ kind: 'respect', delta: 1 }, ctx, {});
}
