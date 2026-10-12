import type { MarriagePromise, Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { eligibleToMarry, wed } from './demography.js';
import { eligibleTemplates, mintRecipe, rollRecipe } from './minting.js';
import { addGrudge } from './relationships.js';
import { applyEffect } from '../events/effects.js';
import { marriagePromiseLotName, sellerName } from '../auction.js';
import { msg } from '../messages.js';

export const PLEDGE_TERM = 50;
// stepYear increments before running phases. The Table first shows her at
// seventeen, so collection at eighteen leaves one turn to withhold her.
export const PLEDGE_COLLECTION_AGE = 18;

/** A reservation blocks every ordinary marriage door, including a direct wedding. */
export function marriagePledge(ctx: SimCtx, person: Person): MarriagePromise | undefined {
  return ctx.world.marriagePromises.find((promise) => promise.girl === person.id);
}

function claimedGranddaughter(ctx: SimCtx, girl: Person, promise: MarriagePromise): boolean {
  if (girl.sex !== 'female' || girl.status !== 'alive' || girl.born <= promise.year
    || girl.marriages.some((m) => m.to === undefined)
    || girl.houseOfOrigin !== ctx.world.playerHouse
    || ctx.world.people.householdOf(girl.id, ctx.world.year) !== ctx.world.playerHouse) return false;
  // The contract reads the same documents as the Match. Biological descent
  // and carried font have no part in deciding whom the creditor may collect.
  return Object.values(girl.claimedParents).some((parentId) => {
    const parent = ctx.world.people.get(parentId);
    return parent && Object.values(parent.claimedParents).some((id) => id === promise.pledgedBy);
  });
}

function breakPledge(ctx: SimCtx, promise: MarriagePromise, reason: string): void {
  const w = ctx.world;
  applyEffect({ kind: 'respect', delta: -1 }, ctx, {});
  addGrudge(ctx, promise.toHouse, w.playerHouse,
    { severity: 50, inheritance: 'all_blood' }, 'auction_marriage_pledge');
  w.chronicle.push({
    year: w.year, weight: 'paragraph', named: true,
    text: msg(ctx, 'auction.pledge_broken',
      '{HOUSE} called in the granddaughter {HEAD} promised for {LOT} in {YEAR}. {REASON} The house lost a tier of Respect, and the creditor held the debt against its blood. The pledge was broken.',
      { HOUSE: sellerName(ctx, promise.toHouse), HEAD: w.people.get(promise.pledgedBy)?.name ?? promise.pledgedBy,
        LOT: marriagePromiseLotName(ctx, promise), YEAR: String(promise.year), REASON: reason }),
  });
}

function creditorGroom(ctx: SimCtx, promise: MarriagePromise, rng: Rng): Person | undefined {
  const w = ctx.world;
  const present = w.people.living().filter((p) => p.sex === 'male'
    && w.people.householdOf(p.id, w.year) === promise.toHouse
    && eligibleToMarry(ctx, p) && !p.castSlots.includes('head')
    && w.withheld[p.id] === undefined && !marriagePledge(ctx, p))
    .sort((a, b) => a.born - b.born || a.id.localeCompare(b.id))[0];
  if (present) return present;
  const templates = eligibleTemplates(ctx, 'groom').filter((t) => t.sex === 'male'
    && t.ageAtArrival.min >= 17 && t.ageAtArrival.max <= 45
    && !t.castSlots.includes('head') && !t.castSlots.includes('the_match')
    && t.houses.some((h) => h.house === promise.toHouse && h.weight > 0))
    .sort((a, b) => a.id.localeCompare(b.id));
  const template = templates[0];
  if (!template) return undefined;
  // Restrict the existing template's house draw before rolling. No recipe
  // is retargeted after a rival lineage or a name has already been chosen.
  const forCreditor = { ...template, houses: template.houses.filter((h) => h.house === promise.toHouse) };
  return mintRecipe(rollRecipe(forCreditor, ctx, rng), template, ctx,
    { household: promise.toHouse, membership: 'blood' });
}

/** Reserve after births, then collect at adulthood or bill the original deadline. */
export function tickMarriagePledges(ctx: SimCtx, rng: Rng): void {
  const w = ctx.world;
  if (!w.marriagePromises.length) return;
  for (const promise of [...w.marriagePromises]) {
    if (w.year >= promise.year + PLEDGE_TERM) {
      breakPledge(ctx, promise, msg(ctx, 'auction.pledge_expired', 'Fifty years had passed without the marriage.'));
      w.marriagePromises = w.marriagePromises.filter((p) => p !== promise);
      continue;
    }
    let girl = promise.girl ? w.people.get(promise.girl) : undefined;
    if (!girl || girl.status !== 'alive') {
      delete promise.girl;
      girl = w.people.living().filter((p) => claimedGranddaughter(ctx, p, promise))
        .sort((a, b) => a.born - b.born || a.id.localeCompare(b.id))[0];
      if (!girl) continue;
      promise.girl = girl.id;
      w.chronicle.push({
        year: w.year, weight: 'line', named: true,
        text: msg(ctx, 'auction.pledge_reserved',
          '{HOUSE} named {GIRL} as the granddaughter {HEAD} promised for {LOT} in {YEAR}. Her marriage was reserved.',
          { HOUSE: sellerName(ctx, promise.toHouse), GIRL: girl.name,
            HEAD: w.people.get(promise.pledgedBy)?.name ?? promise.pledgedBy,
            LOT: marriagePromiseLotName(ctx, promise), YEAR: String(promise.year) }),
      });
    }
    const age = w.year - girl.born;
    if (age < PLEDGE_COLLECTION_AGE) {
      if (age === 17) w.chronicle.push({
        year: w.year, weight: 'line', named: true,
        text: msg(ctx, 'auction.pledge_notice',
          '{HOUSE} asked the family to send {GIRL} for the promised marriage next year. The Table could still keep her back.',
          { HOUSE: sellerName(ctx, promise.toHouse), GIRL: girl.name }),
      });
      continue;
    }
    const reason = girl.castSlots.includes('head')
      ? msg(ctx, 'auction.pledge_head_kept', '{GIRL} held the seal and could not leave the main hall.', { GIRL: girl.name })
      : w.withheld[girl.id] !== undefined
        ? msg(ctx, 'auction.pledge_withheld', 'The house kept {GIRL} back from the marriage.', { GIRL: girl.name })
        : undefined;
    if (reason) {
      breakPledge(ctx, promise, reason);
      w.marriagePromises = w.marriagePromises.filter((p) => p !== promise);
      continue;
    }
    if (!eligibleToMarry(ctx, girl)) continue;
    const groom = creditorGroom(ctx, promise, rng);
    if (!groom) continue;
    // He is the receiving side. Calling wed with her first would make this
    // a matrilineal match and bring the creditor INTO the player's house.
    wed(ctx, groom, girl, promise);
    w.chronicle.push({
      year: w.year, weight: 'paragraph', named: true,
      text: msg(ctx, 'auction.pledge_paid',
        '{GIRL} married {GROOM} and left for {HOUSE}, paying the granddaughter {HEAD} promised for {LOT} in {YEAR}. What she had learned went with her. The pledge was paid.',
        { GIRL: girl.name, GROOM: groom.name, HOUSE: sellerName(ctx, promise.toHouse),
          HEAD: w.people.get(promise.pledgedBy)?.name ?? promise.pledgedBy,
          LOT: marriagePromiseLotName(ctx, promise), YEAR: String(promise.year) }),
    });
    w.marriagePromises = w.marriagePromises.filter((p) => p !== promise);
  }
}
