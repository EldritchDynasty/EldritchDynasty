import { assertNever, effectHarmPolicy, RESPECT_ORDER, type HarmAssessment, type HarmCategory, type Outcome, type ParcelState } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { SlotFill } from './slots.js';
import { openLie, resolveTargets } from './effects.js';
import { isCurrentFamily } from '../presence.js';
import { LAND_DAMAGE_DEFAULT, parcelRecurringYield } from '../land.js';
import { recurringGrossIncome } from '../economy.js';
import { canStudySpellbook } from '../people/library.js';

export type { HarmAssessment } from '@ed/schema';

/**
 * Read pending consequences without applying them. No kill(), roll, temporary
 * world mutation or undo. The same assessor supplies runtime, previews and
 * receipts. Projection follows the order of the engine's typed effects.
 */
export function assessHarm(ctx: SimCtx, outcome: Pick<Outcome, 'effects' | 'agreedPrices'>, fill: SlotFill, includePrices = false): HarmAssessment {
  const w = ctx.world;
  const people = w.people.all().filter(p => p.status === 'alive' && !p.becomesGuardian && isCurrentFamily(ctx, p));
  const family = new Set(people.map(p => String(p.id)));
  const statuses = new Map(people.map(p => [String(p.id), String(p.status)]));
  const known = new Map(people.map(p => [String(p.id), new Set(p.spellsKnown.map(String))]));
  const parcels = new Map([...w.parcels].filter(([, s]) => s.heldSince <= w.year).map(([id, s]) => [id, { ...s }]));
  const books = new Map([...w.library].map(([id, copy]) => [id, copy.condition]));
  const regalia = new Set([...w.heirlooms.keys()].filter(id => ctx.content.heirloom(id)?.kind === 'regalia'));
  const discrepancies = new Map([...w.discrepancies].map(([id, d]) => [id, { ...d }]));
  const prices = new Set(includePrices ? [] : outcome.agreedPrices?.map(p => p.effect));
  let cash = w.treasury;
  let respect = RESPECT_ORDER.indexOf(w.respect);
  for (const [i, e] of outcome.effects.entries()) {
    // Calling the exhaustive policy also makes unrelated effects an explicit
    // decision in the classifier when the closed Effect union grows.
    effectHarmPolicy(e);
    if (prices.has(i)) continue;
    switch (e.kind) {
      case 'treasury': cash += e.delta; break;
      case 'respect': respect = Math.max(0, Math.min(RESPECT_ORDER.length - 1, respect + e.delta)); break;
      case 'discrepancy': {
        if (e.op === 'create') {
          if (e.id) discrepancies.set(e.id, { severity: e.severity ?? 'minor', provableBy: e.provableBy ?? [], state: 'open' });
          break;
        }
        const lie = e.id ? discrepancies.get(e.id) : openLie(ctx, e.provableBy, discrepancies);
        if (lie) {
          lie.state = e.op === 'prove' ? 'proven' : 'buried';
          if (e.op === 'prove') respect = Math.max(0, respect - 1);
        }
        break;
      }
      case 'status':
        for (const p of resolveTargets(e.target, ctx, fill)) {
          if (!family.has(p.id)) continue;
          if (!e.captivity || e.status === 'missing' && p.status === 'alive' && !p.captivity
            && ctx.content.house(e.captivity.captor) && e.captivity.captor !== w.playerHouse) statuses.set(p.id, e.status);
        }
        break;
      case 'heirloom':
        if (e.op === 'transfer') regalia.delete(e.heirloom);
        if (e.op === 'grant' && ctx.content.heirloom(e.heirloom)?.kind === 'regalia') regalia.add(e.heirloom);
        break;
      case 'spellbook': {
        const def = ctx.content.spellbook(e.book);
        if (e.op === 'remove_copy') books.delete(e.book);
        if (e.op === 'degrade' && books.has(e.book)) books.set(e.book, Math.max(0, books.get(e.book)! - (def?.degradesBy ?? 20)));
        if (e.op === 'acquire_copy' && def && !books.has(e.book)) books.set(e.book, 100);
        if (e.op === 'lose' && def) for (const p of resolveTargets(e.target, ctx, fill)) known.get(p.id)?.delete(e.book);
        if (e.op === 'gain' && def) {
          for (const p of resolveTargets(e.target, ctx, fill)) if (statuses.get(p.id) === 'alive' && canStudySpellbook(ctx, p, def).ok) {
            known.get(p.id)?.add(e.book);
            if (!books.has(e.book)) books.set(e.book, 100);
          }
        }
        break;
      }
      case 'land': {
        const entry = [...parcels].find(([, s]) => s.defId === e.parcel);
        if (entry) {
          if (e.op === 'seize') parcels.delete(entry[0]);
          if (e.op === 'damage') entry[1].yieldBonus = (entry[1].yieldBonus ?? 0) - (e.magnitude ?? LAND_DAMAGE_DEFAULT);
          if (e.op === 'restore') entry[1].yieldBonus = (entry[1].yieldBonus ?? 0) + (e.magnitude ?? LAND_DAMAGE_DEFAULT);
        } else if ((e.op === 'grant' || e.op === 'encroach') && ctx.content.parcel(e.parcel)) {
          const id = `assessed:${e.parcel}`;
          parcels.set(id, { id, defId: e.parcel, heldSince: w.year });
        }
        break;
      }
    }
  }
  const deaths = [...statuses].filter(([, status]) => status === 'dead').map(([id]) => id);
  const missing = [...statuses].filter(([, status]) => status === 'missing').map(([id]) => id);
  const yieldOf = (states: Iterable<ParcelState>) => [...states].reduce((sum, s) => sum + parcelRecurringYield(ctx, s), 0);
  const beforeParcels = [...w.parcels.values()].filter(s => s.heldSince <= w.year);
  const beforeYield = yieldOf(beforeParcels);
  const estateLoss = Math.max(0, beforeYield - yieldOf(parcels.values()));
  const estateShare = beforeYield > 0 ? estateLoss / beforeYield : 0;
  const seatLost = beforeParcels.filter(s => s.defId && ctx.content.parcel(s.defId)?.kind === 'demesne'
    && ![...parcels.values()].some(after => after.defId === s.defId)).map(s => s.defId!);
  const titlesLost = [...w.library].filter(([id, copy]) => !books.has(id) || (ctx.content.spellbook(id)?.tier === 'named' && copy.condition > 0 && books.get(id) === 0)).map(([id]) => id);
  const knowledgeLost = [...known].flatMap(([id, after]) => {
    const p = w.people.get(id)!;
    return p.spellsKnown.filter(book => !after.has(book)).map(book => `${id}:${book}`);
  });
  const regaliaLost = [...w.heirlooms.keys()].filter(id => ctx.content.heirloom(id)?.kind === 'regalia' && !regalia.has(id));
  const cashLoss = Math.max(0, w.treasury - cash);
  const respectDrop = Math.max(0, RESPECT_ORDER.indexOf(w.respect) - respect);
  const categories: HarmCategory[] = [];
  if (deaths.length) categories.push('life');
  if (missing.length) categories.push('liberty');
  if (cashLoss >= Math.max(50, recurringGrossIncome(ctx) * .5) || (cashLoss > 0 && w.treasury >= 0 && cash < 0)) categories.push('financial');
  if (seatLost.length || estateShare >= .25) categories.push('estate');
  // A ruined ordinary copy remains readable (at greater cost); it is not a
  // destroyed title. A Named Art's unique manuscript reaching zero qualifies.
  const removed = [...w.library.keys()].filter(id => !books.has(id));
  if (regaliaLost.length || titlesLost.some(id => ctx.content.spellbook(id)?.tier === 'named')
    || (w.library.size > 0 && removed.length / w.library.size >= 1 / 3)) categories.push('inheritance');
  if (respectDrop >= 2) categories.push('political');
  return { categories, deaths, missing, cashLoss, estateLoss, estateShare, seatLost, titlesLost, knowledgeLost, regaliaLost, respectDrop };
}

/** At least one qualifying harm must materially improve. No cosmetic rescues. */
export function mitigates(normal: HarmAssessment, final: HarmAssessment): boolean {
  return normal.categories.some(category => {
    switch (category) {
      case 'life': return normal.deaths.some(id => !final.deaths.includes(id));
      case 'liberty': return normal.missing.some(id => !final.missing.includes(id));
      case 'financial': return final.cashLoss < normal.cashLoss;
      case 'estate': return final.estateLoss < normal.estateLoss || normal.seatLost.some(id => !final.seatLost.includes(id));
      case 'inheritance': return normal.titlesLost.some(id => !final.titlesLost.includes(id))
        || normal.knowledgeLost.some(id => !final.knowledgeLost.includes(id)) || normal.regaliaLost.some(id => !final.regaliaLost.includes(id));
      case 'political': return final.respectDrop < normal.respectDrop;
      default: return assertNever(category, 'harm category');
    }
  });
}
