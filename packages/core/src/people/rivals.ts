import type { RivalLineageState, RivalPerson, Sex } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { streamFor } from '../rng.js';
import { conceive, meiosis, randomGenome } from '../genetics/meiosis.js';
import { relationshipThreadRecallMultiplier } from '../relationship-threads.js';

/**
 * RIVAL-HOUSE DESCENT (issue #24 item 6).
 *
 * Every person's genome has always been materialized from their OWN house's
 * real `genePool` (`people/factory.ts`'s `materialize`), so a rival's
 * daughter already draws faithfully from her house's font and deleterious
 * frequencies. What this file adds is DESCENT: for the houses named below, a
 * new rival character is a child of a previously-materialized rival ancestor
 * through real `meiosis`, not an independent draw from a static frequency
 * table every time the Match deals a card.
 *
 * Deliberately shallow, per the issue's own scope guard: a genealogical
 * source for future brides, not six AI opponents. No rival docket, careers,
 * economy, chronicle or event loop — a `RivalPerson` carries only what
 * descent needs, and the only readers are `growRivalLineage` (which grows
 * it) and `people/minting.ts`'s `mintRecipe` (which spends her into the
 * player's world when a card built from her is taken).
 */

/**
 * WHICH HOUSES GROW ONE — issue #149 Stage 2.
 *
 * Stage 1 proved the shape with `house_marrow` alone. Stage 2 keeps the five
 * other named houses in the same shallow model and leaves the non-house pools
 * (`the_church`, `commons`, `the_marches`, `the_lag`, `the_fell`) as
 * fresh pool draws.
 *
 * MEASURED BEFORE THIS SWITCH WAS KEPT: the same eight seeds x 1,000 years on
 * the same GitHub Ubuntu runner class took 13.080s with Marrow alone and 17.396s
 * with all six — 1.33x, inside #149's ~2x ceiling. The existing 40-living
 * per-house soft cap therefore stays; reducing it without evidence would change the
 * genealogy this feature exists to model for no measured benefit.
 */
export const RIVAL_LINEAGE_HOUSES: readonly string[] = [
  'house_marrow',
  'house_calder',
  'house_ilm',
  'house_bracc',
  'house_hesk',
  'house_yssanne',
];

/** Bounds on the shadow demography. Not §7's world — a much smaller, cheaper one. */
const MARRY_FROM = 16;
const MARRIAGEABLE_TO = 55;
const CHILDBEARING_TO = 45;
/** A soft cap so an unconstrained lineage cannot grow forever over a thousand years. */
const MAX_LIVING = 40;
const ANNUAL_DEATH_BASE = 0.01;
const ANNUAL_DEATH_GROWTH = 1.045;
const ANNUAL_MARRY_CHANCE = 0.25;
const ANNUAL_BIRTH_CHANCE = 0.18;

function nextRivalId(w: { counters: { rival: number } }): string {
  w.counters.rival += 1;
  return `riv_${w.counters.rival.toString(36)}`;
}

/** Two founding couples, already of an age to marry, so the lineage need not wait a generation to breed. */
function seedFounders(ctx: SimCtx, houseId: string, rng: Rng): RivalPerson[] {
  const w = ctx.world;
  const pool = ctx.genetics.pools.get(houseId);
  const people: RivalPerson[] = [];
  for (let i = 0; i < 2; i++) {
    const father: RivalPerson = {
      id: nextRivalId(w), house: houseId, sex: 'male', born: w.year - 30,
      genome: randomGenome(ctx.genetics.table, pool, 'male', rng),
    };
    const mother: RivalPerson = {
      id: nextRivalId(w), house: houseId, sex: 'female', born: w.year - 28,
      genome: randomGenome(ctx.genetics.table, pool, 'female', rng),
    };
    father.spouse = mother.id;
    mother.spouse = father.id;
    people.push(father, mother);
  }
  return people;
}

function livingRival(p: RivalPerson): boolean {
  return p.died === undefined && p.left === undefined;
}

/**
 * Grow one house's shadow lineage by one year. Draws only from this house's
 * own stream (`streamFor(world, 'rivals', houseId)`), so adding, removing or
 * growing a rival house can never move any other stream's numbers — not the
 * player's, and not another rival house's.
 */
export function growRivalLineage(ctx: SimCtx, houseId: string): void {
  const w = ctx.world;
  const rng = streamFor(w, 'rivals', houseId);

  let lineage = w.rivalLineages.get(houseId);
  if (!lineage) {
    lineage = { house: houseId, people: seedFounders(ctx, houseId, rng) };
    w.rivalLineages.set(houseId, lineage);
    // The founders' own arrival. Nothing else happens the year they do.
    return;
  }

  const living = lineage.people.filter(livingRival);

  // MORTALITY. A flat, age-rising hazard rather than the player's own
  // vitality model: this population owns no attributes and no health, and
  // does not need them — it exists to grow a family tree, not to be played.
  for (const p of living) {
    const age = w.year - p.born;
    if (age < 40) continue;
    const hazard = ANNUAL_DEATH_BASE * ANNUAL_DEATH_GROWTH ** (age - 40);
    if (rng.bool(Math.min(0.9, hazard))) p.died = w.year;
  }

  const survivors = living.filter((p) => p.died === undefined);

  // MARRIAGE. Cousins first, in effect: an unmarried man and woman already IN
  // the lineage are paired before anyone reaches outside it. A lineage with
  // only one sex eligible reaches into the house's own pool for the other —
  // an ordinary, un-descended spouse, exactly as `mintRecipe` draws one for
  // everybody else in the world.
  const unmarried = survivors.filter((p) => !p.spouse
    && w.year - p.born >= MARRY_FROM && w.year - p.born <= MARRIAGEABLE_TO);
  const men = unmarried.filter((p) => p.sex === 'male');
  const women = unmarried.filter((p) => p.sex === 'female');
  const pairs = Math.min(men.length, women.length);
  for (let i = 0; i < pairs; i++) {
    if (!rng.bool(ANNUAL_MARRY_CHANCE)) continue;
    const groom = men[i]!;
    const bride = women[i]!;
    groom.spouse = bride.id;
    bride.spouse = groom.id;
  }

  if (survivors.length < MAX_LIVING) {
    const pool = ctx.genetics.pools.get(houseId);
    for (const p of unmarried) {
      if (p.spouse) continue;
      if (!rng.bool(ANNUAL_MARRY_CHANCE)) continue;
      const outsideSex: Sex = p.sex === 'male' ? 'female' : 'male';
      const spouse: RivalPerson = {
        id: nextRivalId(w), house: houseId, sex: outsideSex,
        born: w.year - Math.round(rng.range(MARRY_FROM, MARRY_FROM + 12)),
        genome: randomGenome(ctx.genetics.table, pool, outsideSex, rng),
        spouse: p.id,
      };
      p.spouse = spouse.id;
      lineage.people.push(spouse);
    }
  }

  // BIRTHS, THROUGH REAL MEIOSIS — the whole point of the feature. A child
  // born here traces to two named `RivalPerson` ancestors rather than being a
  // fresh, unrelated draw from the pool the day the Match deals her.
  if (survivors.length < MAX_LIVING) {
    const byId = new Map(lineage.people.map((p) => [p.id, p]));
    for (const mother of survivors) {
      if (mother.sex !== 'female' || !mother.spouse) continue;
      const father = byId.get(mother.spouse);
      if (!father || father.died !== undefined) continue;
      const age = w.year - mother.born;
      if (age < MARRY_FROM || age > CHILDBEARING_TO) continue;
      if (!rng.bool(ANNUAL_BIRTH_CHANCE)) continue;

      const motherGamete = meiosis(mother.genome, ctx.genetics.table, 'female', rng, w.year);
      const fatherGamete = meiosis(father.genome, ctx.genetics.table, 'male', rng, w.year);
      const { genome, sex } = conceive(motherGamete, fatherGamete, ctx.genetics.table);
      lineage.people.push({
        id: nextRivalId(w), house: houseId, sex, born: w.year,
        mother: mother.id, father: father.id, genome,
      });
    }
  }
}

/** Grow every configured rival house by one year. Called from the `rivals` year phase. */
export function tickRivals(ctx: SimCtx, houses: readonly string[] = RIVAL_LINEAGE_HOUSES): void {
  for (const houseId of houses) {
    if (!ctx.world.houses.has(houseId)) continue;
    growRivalLineage(ctx, houseId);
  }
}

/** A rejected rival is not put straight back on the next hand. */
export const RIVAL_REOFFER_AFTER = 6;
/** Remembered people are callbacks, not a standing fourth source of Match cards. */
export const RIVAL_REOFFER_CHANCE = 0.2;

/** An active external thread is allowed to recur more often, without becoming mandatory. */
export function rivalReofferChance(ctx: SimCtx, houseId: string): number {
  return Math.min(1, RIVAL_REOFFER_CHANCE * relationshipThreadRecallMultiplier(ctx, houseId));
}
/**
 * A living, unmarried, of-age member of this house's shadow lineage who could
 * stand in for a fresh pool draw on a Match card — or `undefined` where there
 * is no lineage, or nobody in it fits.
 */
export function pickRivalCandidate(
  ctx: SimCtx,
  houseId: string,
  sex: Sex,
  ageRange: { min: number; max: number },
  rng: Rng,
  templateId?: string,
): RivalPerson | undefined {
  const lineage = ctx.world.rivalLineages.get(houseId);
  if (!lineage) return undefined;
  const w = ctx.world;
  const candidates = lineage.people.filter((p) => {
    if (p.sex !== sex || p.spouse || !livingRival(p)) return false;
    const age = w.year - p.born;
    return age >= Math.max(MARRY_FROM, ageRange.min) && age <= ageRange.max;
  });
  if (!candidates.length) return undefined;

  // Callers that only need a genealogical candidate keep the original
  // behaviour. The Match supplies a template id because a person first met as
  // one authored proposition must not come back wearing a different dossier.
  if (templateId === undefined) return rng.pick(candidates);

  const remembered = candidates.filter((p) => p.courtship?.template === templateId
    && w.year - p.courtship.offered >= RIVAL_REOFFER_AFTER);
  if (remembered.length && rng.bool(rivalReofferChance(ctx, houseId))) return rng.pick(remembered);

  // Once the house has met somebody, they are no longer an anonymous fresh
  // draw. If the callback coin does not land, use somebody genuinely new or
  // fall back to an ordinary pool recipe.
  const fresh = candidates.filter((p) => p.courtship === undefined);
  return fresh.length ? rng.pick(fresh) : undefined;
}

/** Look a rival person up directly, by house and id, without filtering on eligibility. */
export function findRivalPerson(ctx: SimCtx, houseId: string, rivalId: string): RivalPerson | undefined {
  return ctx.world.rivalLineages.get(houseId)?.people.find((p) => p.id === rivalId);
}
