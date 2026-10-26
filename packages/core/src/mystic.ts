import type {
  Commitment, MysticAssignment, MysticFieldBenefit, MysticGap, MysticWorkingDef, ParcelDef, ParcelKind, ParcelState, Person, SceneSite,
} from '@ed/schema';
import { asId, assertNever, canLearn, currentMembership, isActiveBranch, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { OrderResult } from './table.js';
import { DEBT_FLOOR } from './economy.js';
import { attendsHall, covertReservation, deployedPeople, dutyPlaceOf, dutyPlaces, isCurrentFamily, isFamilyOf, resolvePresence, serviceReservation } from './presence.js';
import { msg } from './messages.js';
import { ordinaryRisk } from './people/demography.js';
import { proseForContentField } from './prose.js';
import { streamFor } from './rng.js';
import { captureContractor, captureFamily } from './people/captivity.js';
import { relate } from './people/relationships.js';

/**
 * MYSTIC DUTIES (#1866 B / #1873) — learn, assign, pay, serve, answer for it.
 *
 * A learned reader can be named to ONE standing duty for one real place: a
 * carer for a hall, a warden for a parcel, or a specialist for one commitment. The duty is a Table order; nothing
 * renews it and nothing asks about it again. Each year the `mystic` phase
 * re-reads whether the practitioner can still do it and reserves the upkeep
 * before any benefit is possible. The benefit itself is read where the outcome
 * happens — `rollDeath`, `tickLandRisks`, `damageParcel` — and asks again,
 * at that moment, whether the person is still alive and still there. A cached
 * morning cannot employ somebody who died at noon.
 *
 * INVARIANT 4: nothing in this file reads or writes Madness or Eldritch Power.
 * A practitioner is anybody `canLearn` admits who has finished the books; a
 * woman's Threshold working is exactly as good as a man's.
 * INVARIANT 16: practice is not a post. `canHoldPost` is never asked.
 * INVARIANT 2: field deaths use PersonStore.kill. Household care only prevents deaths.
 * INVARIANT 8: the reservation phase draws no dice. Field risks/opportunities
 * use separate named streams; Life care reuses the existing mortality draw.
 */

/** The youngest a reader can be trusted alone with somebody else's life or land. */
export const MYSTIC_DUTY_AGE = 16;

/**
 * What the ground ordinarily yields, by kind — the line a warden holds the
 * year's roll up to. The means `tickLandRisks` draws around; a warden never
 * lifts a good year and has nothing to hold on ground without seasons.
 */
const ORDINARY_YIELD: Record<ParcelKind, number> = {
  tenant_farm: 1, mill: 1.8, woodland: 1, common: 1, demesne: 1,
  slate_work: 2.6, sarrow_bottom: 3.4, town_house: 0, wetland: 0.7,
};

/** Gaps that end a duty outright; every other gap suspends it until it closes. */
const ENDS: ReadonlySet<MysticGap> = new Set(['dead', 'left_house', 'unlearned', 'target_lost']);

export function workingDef(ctx: SimCtx, id: string): MysticWorkingDef | undefined {
  return ctx.content.mysticWorking(id);
}

/** Finished every book the working needs, and is somebody those books admit. */
export function hasLearned(p: Person, w: MysticWorkingDef): boolean {
  return canLearn(p.sex, w.affinity) && w.books.every((b) => p.spellsKnown.some((k) => String(k) === b));
}

export function isFieldWorking(w: MysticWorkingDef): w is MysticWorkingDef & { benefit: MysticFieldBenefit } {
  switch (w.benefit.kind) {
    case 'field_care': case 'field_supply': case 'field_watch': case 'field_concealment': return true;
    case 'life_care': case 'estate_protection': case 'household_protection': case 'covert_support': case 'project_support':
    case 'library_care': case 'household_provision': case 'convalescence': case 'teaching': case 'commission': return false;
    default: return assertNever(w.benefit, 'field working');
  }
}

type DutyContext = { house?: string; target?: SceneSite; contract?: string; outside?: boolean };
function dutyHouse(ctx: SimCtx, a?: DutyContext): string { return a?.house ?? ctx.world.playerHouse; }

export function hasWarrant(p: Person): boolean { return p.traits.has(asId('colleges_warrant')); }
export function knownProfessional(ctx: SimCtx, p: Person): boolean {
  return ctx.world.mystic.contacts.includes(p.id) && hasWarrant(p) && !p.contract;
}

export function dutyFunds(ctx: SimCtx, house: string): number {
  return house === ctx.world.playerHouse ? ctx.world.treasury - DEBT_FLOOR
    : Math.max(0, (ctx.world.houses.get(house)?.wealth ?? 0) - (ctx.world.mystic.foreignSpent?.[house] ?? 0));
}

export function spendForeign(ctx: SimCtx, house: string, crowns: number): void {
  const ledger = ctx.world.mystic.foreignSpent ??= {};
  ledger[house] = (ledger[house] ?? 0) + crowns;
}

/**
 * THE ONE AVAILABILITY READER. The quote, the yearly reservation and every
 * benefit ask it, so the Table cannot promise somebody the phase would refuse.
 */
export function practitionerGap(ctx: SimCtx, p: Person | undefined, working: MysticWorkingDef,
  assignment?: DutyContext): MysticGap | undefined {
  const w = ctx.world;
  if (!p || (p.status !== 'alive' && p.status !== 'missing')) return 'dead';
  if (currentMembership(p, w.year)?.kind === 'hostage') return 'hostage';
  const house = dutyHouse(ctx, assignment);
  const membership = currentMembership(p, w.year);
  const service = assignment?.contract && w.mystic.contracts.find(c => c.id === assignment.contract && c.practitioner === p.id && c.stage !== 'closed');
  const outside = house === w.playerHouse && (assignment?.outside || service) && knownProfessional(ctx, p);
  if (!outside && (house === w.playerHouse ? !isCurrentFamily(ctx, p) : membership?.house !== house
    || !['blood', 'cadet', 'married_in'].includes(membership.kind))) return 'left_house';
  if (p.status === 'missing') return 'missing';
  if (!hasLearned(p, working)) return 'unlearned';
  if (w.year - p.born < MYSTIC_DUTY_AGE) return 'too_young';
  if ((p.fieldRecoveryUntil ?? -Infinity) > w.year) return 'wounded';
  if ((p.acquired.health ?? 0) <= -20) return 'wounded';
  const site = assignment?.target;
  const serviceID = serviceReservation(ctx, p.id);
  if (serviceID && serviceID !== assignment?.contract) return 'deployed';
  if (service && service.stage === 'returning') return 'not_resident';
  const ownServiceDuty = service && serviceID === service.id;
  const reserved = covertReservation(ctx, p.id);
  const ownCovertDuty = reserved !== undefined && site?.kind === 'covert' && site.operation === reserved;
  if (reserved && !ownCovertDuty) return 'deployed';
  const ownFieldDuty = site?.kind === 'muster' && isFieldWorking(working)
    && w.muster.commitments.some(c => c.id === site.commitment && c.status === 'in_the_field');
  if (deployedPeople(ctx).has(p.id) && !ownFieldDuty && !ownCovertDuty && !ownServiceDuty) return 'deployed';
  if (p.career && ctx.content.career(p.career.career)?.resident !== 'home') return 'away_post';
  return undefined;
}

/** Can this working be done for this place at all, today? */
export function targetGap(
  ctx: SimCtx, working: MysticWorkingDef, site: SceneSite, bindings: Record<string, string>, house = ctx.world.playerHouse, practitioner?: Person,
): MysticGap | undefined {
  const b = working.benefit;
  switch (b.kind) {
    case 'commission': {
      if (site.kind !== 'service' || house !== ctx.world.playerHouse) return 'target_lost';
      if (practitioner && !hasWarrant(practitioner)) return 'target_lost';
      const c = ctx.world.mystic.contracts.find(c => c.id === site.contract && c.kind === 'commission' && c.stage !== 'closed' && c.working === working.id);
      if (!c || practitioner && c.practitioner !== practitioner.id) return 'target_lost';
      return c.stage === 'returning' ? 'not_resident' : undefined;
    }
    case 'library_care': {
      if (house !== ctx.world.playerHouse || site.kind !== 'book' || !ctx.world.library.has(site.book)) return 'target_lost';
      return ctx.world.library.get(site.book)?.restoresAt === undefined ? undefined : 'not_resident';
    }
    case 'convalescence': case 'teaching': {
      if (site.kind !== 'person') return 'target_lost';
      const p = ctx.world.people.get(site.person);
      if (!p || p.status !== 'alive' || !isFamilyOf(ctx, p, house)) return 'target_lost';
      if (!resolvePresence(ctx, site, {}).people.includes(p.id)) return 'not_resident';
      if (b.kind === 'convalescence') return (p.acquired.health ?? 0) < 0 || (p.fieldRecoveryUntil ?? 0) > ctx.world.year ? undefined : 'no_need';
      const study = ctx.world.studies.find(s => s.person === p.id);
      if (!study) return 'no_need';
      return practitioner && !practitioner.spellsKnown.some(id => String(id) === study.book) ? 'unlearned' : undefined;
    }
    case 'project_support': {
      if (house !== ctx.world.playerHouse || site.kind !== 'parcel') return 'target_lost';
      const held = heldParcel(ctx, site.parcel);
      return held && b.parcelKinds.includes(held.def.kind) ? undefined : 'target_lost';
    }
    case 'covert_support': {
      if (site.kind !== 'covert') return 'target_lost';
      const o = ctx.world.covert.operations.find(o => o.plan.id === site.operation && o.stage !== 'closed');
      return !o || house !== ctx.world.playerHouse ? 'target_lost' : o.stage === 'returning' ? 'not_resident' : undefined;
    }
    case 'household_protection': {
      if (site.kind !== b.scope) return 'target_lost';
      if (site.kind === 'hall') {
        const anchor = typeof site.hall === 'string' ? undefined : ctx.world.people.get(bindings[site.hall.slot] ?? '');
        if (typeof site.hall === 'string' ? house !== ctx.world.playerHouse
          : !anchor || currentMembership(anchor, ctx.world.year)?.house !== house) return 'target_lost';
      }
      if (site.kind === 'person') {
        const p = ctx.world.people.get(site.person);
        if (!p || p.status !== 'alive' || p.becomesGuardian || !isFamilyOf(ctx, p, house)) return 'target_lost';
        if (!resolvePresence(ctx, site, {}).people.includes(p.id)) return 'not_resident';
      }
      const place = dutyPlaceOf(ctx, site, bindings);
      return place && 'hall' in place ? undefined : 'target_lost';
    }
    case 'life_care': case 'household_provision': {
      if (site.kind !== 'hall') return 'target_lost';
      const place = dutyPlaceOf(ctx, site, bindings);
      if (!place || !('hall' in place)) return 'target_lost';
      if (place.hall !== MAIN_BRANCH) {
        const branch = ctx.world.branches.get(place.hall);
        if (!branch || !isActiveBranch(branch)) return 'target_lost';
      }
      return undefined;
    }
    case 'estate_protection': {
      if (site.kind !== 'parcel') return 'target_lost';
      const held = heldParcel(ctx, site.parcel);
      if (!held) return 'target_lost';
      if (!b.parcelKinds.includes(held.def.kind) || held.def.acres > b.maxAcres) return 'target_lost';
      return undefined;
    }
    case 'field_care': case 'field_supply': case 'field_watch': case 'field_concealment':
      return site.kind === 'muster' && ctx.world.muster.commitments.some(c =>
        c.id === site.commitment && c.status === 'in_the_field') ? undefined : 'target_lost';
    default: return assertNever(b, 'mystic benefit');
  }
}

function heldParcel(ctx: SimCtx, defId: string): { state: ParcelState; def: ParcelDef } | undefined {
  const def = ctx.content.parcel(defId);
  if (!def) return undefined;
  for (const state of ctx.world.parcels.values()) {
    if (state.defId === defId && state.heldSince <= ctx.world.year) return { state, def };
  }
  return undefined;
}

export interface MysticQuote {
  ok: boolean;
  reason?: string;
  gap?: MysticGap;
  /** Crowns paid on the day the order is given. */
  preparation: number;
  /** The first year the duty can serve. */
  ready: number;
  upkeep: number;
  /** The study this order sets down, and how much of it is left. */
  pauses?: { book: string; remainingYears: number };
}

export interface MysticOrder { person: string; working: string; target: SceneSite; bindings?: Record<string, string>; contract?: string; outside?: boolean }

export function dutyTerms(ctx: SimCtx, working: MysticWorkingDef) {
  return { preparation: working.preparation.crowns, ready: ctx.world.year + 1 + working.preparation.years, upkeep: working.upkeep };
}

function coverageKey(ctx: SimCtx, working: MysticWorkingDef, target: SceneSite, bindings: Record<string, string>): string {
  const b = working.benefit;
  return JSON.stringify({ place: dutyPlaceOf(ctx, target, bindings), kind: b.kind,
    ...(target.kind === 'book' ? { book: target.book } : target.kind === 'person' ? { person: target.person } : {}),
    ...(working.collaborator ? { role: working.id } : {}),
    ...(b.kind === 'covert_support' ? { role: b.role } : {}),
    ...(b.kind === 'household_protection' ? { stage: b.stage, scope: b.scope,
      person: target.kind === 'person' ? target.person : undefined } : {}) });
}

/** Everything an order would cost and whether it can be given, before it is. */
export function quoteDuty(ctx: SimCtx, o: MysticOrder, house = ctx.world.playerHouse): MysticQuote {
  const w = ctx.world;
  const working = workingDef(ctx, o.working);
  const blank = { preparation: 0, ready: w.year + 1, upkeep: 0 };
  if (!working) return { ...blank, ok: false, reason: msg(ctx, 'mystic.refuse.no_working', 'no such working') };
  const quote: MysticQuote = {
    ok: true,
    ...dutyTerms(ctx, working),
  };
  const study = w.studies.find((s) => s.person === o.person);
  if (study) quote.pauses = { book: study.book, remainingYears: Math.max(1, study.completes - w.year) };

  const p = w.people.get(o.person);
  const context = { house, contract: o.contract, outside: o.outside,
    ...(working.benefit.kind === 'covert_support' || o.contract ? { target: o.target } : {}) };
  const gap = practitionerGap(ctx, p, working, context) ?? targetGap(ctx, working, o.target, o.bindings ?? {}, house, p);
  if (gap) return { ...quote, ok: false, gap, reason: gapReason(ctx, gap) };
  if (w.mystic.assignments.some((a) => a.practitioner === o.person)) {
    return { ...quote, ok: false, reason: msg(ctx, 'mystic.refuse.one_duty', 'they already keep a duty') };
  }
  const place = coverageKey(ctx, working, o.target, o.bindings ?? {});
  if (w.mystic.assignments.some((a) => dutyHouse(ctx, a) === house
    && (() => { const def = workingDef(ctx, a.working); return def && coverageKey(ctx, def, a.target, a.bindings) === place; })())) {
    return { ...quote, ok: false, reason: msg(ctx, 'mystic.refuse.covered', 'somebody already keeps that duty there') };
  }
  if (dutyFunds(ctx, house) < quote.preparation) {
    return {
      ...quote, ok: false,
      reason: msg(ctx, 'mystic.refuse.cost', 'the house cannot raise {PRICE} crowns', { PRICE: String(quote.preparation) }),
    };
  }
  return quote;
}

/** The Table's door. Pays the preparation, sets the reader's book down, and records the duty. */
export function assignDuty(ctx: SimCtx, o: MysticOrder): OrderResult {
  const result = commitDuty(ctx, o, ctx.world.playerHouse);
  if (result.ok && o.target.kind === 'muster') prepareFieldOpposition(ctx, o.target.commitment!);
  return result;
}

export function commitDuty(ctx: SimCtx, o: MysticOrder, house: string): OrderResult {
  const w = ctx.world;
  const quote = quoteDuty(ctx, o, house);
  if (!quote.ok) return { ok: false, reason: quote.reason };
  const working = workingDef(ctx, o.working)!;
  const p = w.people.get(o.person)!;
  const id = `mys_${(w.counters.mystic += 1).toString(36)}`;

  if (house === w.playerHouse) w.treasury -= quote.preparation;
  else spendForeign(ctx, house, quote.preparation);
  w.mystic.assignments.push({
    id,
    practitioner: p.id,
    ...(house !== w.playerHouse ? { house } : {}),
    working: working.id,
    target: structuredClone(o.target),
    bindings: { ...(o.bindings ?? {}) },
    started: w.year,
    ready: quote.ready,
    paidPreparation: quote.preparation,
    paidThrough: w.year,
    status: 'preparing',
    ...(o.contract ? { contract: o.contract } : {}),
    service: { servedYears: 0, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: quote.preparation },
  });
  if (o.target.kind === 'covert') {
    const operation = o.target.operation;
    const expedition = w.covert.operations.find(x => x.plan.id === operation)!;
    if (!expedition.crew.includes(p.id)) expedition.crew.push(p.id);
  }

  // Intensive duty sets the book down by what is left of it, never by forfeit.
  pauseDutyStudy(ctx, p.id, id);

  if (house === w.playerHouse) w.chronicle.push({
    year: w.year, weight: 'line', named: false, people: [p.id],
    text: msg(ctx, 'mystic.assigned',
      '{PERSON} took up {WORKING} for {PLACE}. The house paid {FEE} crowns to make ready, and will pay {UPKEEP} a year while it is kept.',
      {
        PERSON: p.name, WORKING: workingName(ctx, working), PLACE: placeName(ctx, o.target, o.bindings ?? {}),
        FEE: String(quote.preparation), UPKEEP: String(working.upkeep),
      }),
  });
  return { ok: true };
}

/** Release a duty by the player's word. The paused book resumes if the copy is still on the shelf. */
export function releaseDuty(ctx: SimCtx, assignment: string): OrderResult {
  const w = ctx.world;
  const a = w.mystic.assignments.find((x) => x.id === assignment && dutyHouse(ctx, x) === w.playerHouse);
  if (!a) return { ok: false, reason: msg(ctx, 'mystic.refuse.no_duty', 'there is no such duty') };
  const p = w.people.get(a.practitioner);
  const working = workingDef(ctx, a.working);
  finishFieldDuty(ctx, a, w.year, true);
  if (p && working) {
    w.chronicle.push({
      year: w.year, weight: 'line', named: false, people: [p.id],
      text: msg(ctx, 'mystic.released', '{PERSON} set down {WORKING} at the word of the house.',
        { PERSON: p.name, WORKING: workingName(ctx, working) }),
    });
  }
  return { ok: true };
}

/**
 * Remove the duty and pick the book back up. `lastTurned` is the last year
 * whose phases have run: a book with two years left resumes with two years
 * left, whether the release came at the Table or mid-year.
 */
function endDuty(ctx: SimCtx, a: MysticAssignment, lastTurned: number, withdrawn = false): void {
  const w = ctx.world;
  const contract = a.contract && w.mystic.contracts.find(c => c.id === a.contract && c.stage !== 'closed');
  if (contract) {
    contract.stage = 'returning'; contract.returnsAt = w.year + 1;
    contract.result ??= withdrawn ? 'withdrawn' : 'failed';
  }
  if (!w.mystic.services.some(s => s.id === a.id)) {
    const person = w.people.get(a.practitioner);
    const working = workingDef(ctx, a.working);
    w.mystic.services.push({ ...structuredClone(a), ended: w.year,
      account: msg(ctx, 'mystic.service.closed', '{PERSON}’s service keeping {WORKING} ended after {YEARS} paid years, with {PRICE} crowns spent.',
        { PERSON: person?.name ?? a.practitioner, WORKING: working ? workingName(ctx, working) : a.working,
          YEARS: String(a.service.servedYears), PRICE: String(Math.round(a.service.spent * 100) / 100) }),
    });
  }
  w.mystic.assignments = w.mystic.assignments.filter((x) => x !== a);
  resumeDutyStudies(ctx, a.id, lastTurned, dutyHouse(ctx, a));
}

/** Intensive work shares one remaining-term ledger, including an operative's journey. */
export function pauseDutyStudy(ctx: SimCtx, person: string, assignment: string): void {
  const w = ctx.world;
  const study = w.studies.find(s => s.person === person);
  if (!study) return;
  w.studies = w.studies.filter(s => s !== study);
  w.mystic.pauses.push({ person, book: study.book, remainingYears: Math.max(1, study.completes - w.year), pausedAt: w.year, assignment });
}

export function resumeDutyStudies(ctx: SimCtx, assignment: string, lastTurned: number, house = ctx.world.playerHouse): void {
  const w = ctx.world;
  const paused = w.mystic.pauses.filter(x => x.assignment === assignment);
  w.mystic.pauses = w.mystic.pauses.filter(x => x.assignment !== assignment);
  for (const pause of paused) {
    const p = w.people.get(pause.person);
    const def = ctx.content.spellbook(pause.book);
    if (!p || p.status !== 'alive' || !def) continue;
    // Ending a duty while its reader is captive must not resume home study
    // abroad or discard the years already read. Return owns the copy check.
    if (p.captivity) {
      const studies = p.captivity.studies ??= [];
      if (!studies.some(study => study.book === pause.book)) {
        studies.push({ book: pause.book, remainingYears: pause.remainingYears });
      }
      continue;
    }
    const reservation = covertReservation(ctx, p.id);
    if (reservation) {
      w.mystic.pauses.push({ ...pause, assignment: reservation });
      continue;
    }
    const service = serviceReservation(ctx, p.id);
    if (service) { w.mystic.pauses.push({ ...pause, assignment: service }); continue; }
    if (house !== w.playerHouse) continue;
    if (!w.library.has(pause.book) || w.library.get(pause.book)?.restoresAt !== undefined) {
      w.chronicle.push({
        year: w.year, weight: 'line', named: false, people: [p.id],
        text: msg(ctx, 'mystic.study_lost',
          '{PERSON} went back to the shelf for {BOOK} and it was not there. The years already read are not lost, but there is nothing to finish them from.',
          { PERSON: p.name, BOOK: proseForContentField(ctx, 'spellbooks', def.id, 'name', def.name) }),
      });
      continue;
    }
    if (p.spellsKnown.some((k) => String(k) === pause.book) || w.studies.some((s) => s.person === p.id)) continue;
    w.studies.push({ person: p.id, book: pause.book, completes: lastTurned + pause.remainingYears });
  }
}

/**
 * THE `mystic` PHASE. Runs before anything that can benefit, with no dice.
 * Every duty is re-read; a gap is reported once when it opens and once when
 * it closes, and never as a question — there is no renewal to answer.
 */
export function tickMystic(ctx: SimCtx): void {
  const w = ctx.world;
  delete w.mystic.reservedUpkeep;
  let reserved = 0;
  for (const c of w.muster.commitments) if (c.status === 'in_the_field') prepareFieldOpposition(ctx, c.id);
  for (const a of [...w.mystic.assignments]) {
    const working = workingDef(ctx, a.working);
    const p = w.people.get(a.practitioner);
    const gap = !working ? 'target_lost'
      : practitionerGap(ctx, p, working, a) ?? targetGap(ctx, working, a.target, a.bindings, dutyHouse(ctx, a), p);

    if (gap && ENDS.has(gap)) {
      if (p && working) lapseLine(ctx, a, p, working, gap);
      // The year that ended it has started but the library has not read yet.
      finishFieldDuty(ctx, a, w.year - 1);
      continue;
    }
    if (gap) {
      if (a.status !== 'suspended' || a.reason !== gap) lapseLine(ctx, a, p!, working!, gap);
      a.status = 'suspended';
      a.reason = gap;
      continue;
    }
    const wasSuspended = a.status === 'suspended';
    if (w.year < a.ready) {
      a.status = 'preparing';
      delete a.reason;
      continue;
    }
    // Reserve the year's upkeep BEFORE any benefit; the economy collects it.
    const house = dutyHouse(ctx, a);
    if (dutyFunds(ctx, house) - (house === w.playerHouse ? reserved : 0) < working!.upkeep) {
      if (a.status !== 'suspended' || a.reason !== 'unpaid') lapseLine(ctx, a, p!, working!, 'unpaid');
      a.status = 'suspended';
      a.reason = 'unpaid';
      continue;
    }
    a.status = 'serving';
    delete a.reason;
    a.paidThrough = w.year;
    a.service.servedYears += 1;
    a.service.spent += working!.upkeep;
    if (house !== w.playerHouse) spendForeign(ctx, house, working!.upkeep);
    else {
      reserved += working!.upkeep;
      w.mystic.reservedUpkeep = { year: w.year, crowns: reserved };
    }
    if (working!.benefit.kind === 'life_care') {
      const place = dutyPlaceOf(ctx, a.target, a.bindings);
      a.attended = place && 'hall' in place ? hallWards(ctx, place.hall, a.practitioner, working!.benefit.maxWards, working!.benefit.maxWardAge) : [];
    }
    if (wasSuspended && dutyHouse(ctx, a) === w.playerHouse) {
      w.chronicle.push({
        year: w.year, weight: 'line', named: false, people: [p!.id],
        text: msg(ctx, 'mystic.resumed', '{PERSON} took up {WORKING} again.',
          { PERSON: p!.name, WORKING: workingName(ctx, working!) }),
      });
    }
  }
}

/**
 * WHOSE BED THE CARER SITS BY THIS YEAR: the residents at greatest ordinary
 * risk, by the formula `rollDeath` itself reads, up to the working's
 * `maxWards`. A reader cannot sit up with eighteen people; they choose the
 * cradle and the old man's room, which is what anybody would.
 */
function hallWards(ctx: SimCtx, hall: string, carer: string, max: number, maxAge = Infinity): string[] {
  const w = ctx.world;
  const deployed = deployedPeople(ctx);
  const duty = dutyPlaces(ctx);
  return w.people.household(w.playerHouse, w.year)
    .filter((p) => p.id !== carer && w.year - p.born <= maxAge && attendsHall(ctx, hall, p, deployed, duty))
    .map((p) => ({ id: p.id, risk: ordinaryRisk(ctx, p) }))
    .sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id))
    .slice(0, max)
    .map((x) => x.id);
}

/** Upkeep the economy collects this year: only what the phase actually reserved. */
export function mysticUpkeep(ctx: SimCtx): number {
  const w = ctx.world;
  if (w.mystic.reservedUpkeep?.year === w.year) return w.mystic.reservedUpkeep.crowns;
  let total = 0;
  for (const a of w.mystic.assignments) {
    if (dutyHouse(ctx, a) === w.playerHouse && a.status === 'serving' && a.paidThrough === w.year) total += workingDef(ctx, a.working)?.upkeep ?? 0;
  }
  return total;
}

/** A serving, paid duty whose maintainer is still able to do it at this moment. */
export function liveDuties(ctx: SimCtx, kind: MysticWorkingDef['benefit']['kind']) {
  const w = ctx.world;
  const out: { a: MysticAssignment; working: MysticWorkingDef; p: Person }[] = [];
  for (const a of w.mystic.assignments) {
    if (a.status !== 'serving' || a.paidThrough !== w.year) continue;
    const working = workingDef(ctx, a.working);
    if (!working) continue;
    const p = w.people.get(a.practitioner);
    if (practitionerGap(ctx, p, working, a) || targetGap(ctx, working, a.target, a.bindings, dutyHouse(ctx, a), p)) continue;
    out.push({ a, working, p: p! });
  }
  return out.filter(({ a, working, p }) => working.benefit.kind === kind && (!working.collaborator || out.some(partner =>
    partner.working.id === working.collaborator && partner.working.collaborator === working.id && partner.p.id !== p.id
    && dutyHouse(ctx, partner.a) === dutyHouse(ctx, a)
    && JSON.stringify(dutyPlaceOf(ctx, partner.a.target, partner.a.bindings)) === JSON.stringify(dutyPlaceOf(ctx, a.target, a.bindings)))));
}

export function markUseful(a: MysticAssignment, year: number): void {
  const s = a.service;
  if (s.lastUseful === year) return;
  s.lastUseful = year;
  s.usefulYears += 1;
  s.firstUsefulAt ??= s.servedYears;
}

export interface HouseholdProtection {
  stage: 'warning' | 'prevention' | 'survival';
  bonus: number;
  assignment: MysticAssignment;
  practitioner: Person;
}

export interface CovertSupport {
  role: Extract<MysticWorkingDef['benefit'], { kind: 'covert_support' }>['role'];
  bonus: number;
  assignment: MysticAssignment;
  practitioner: Person;
}

/** A role's strongest actual paid specialist, read at this expedition's physical scene. */
export function covertSupport(ctx: SimCtx, site: SceneSite): CovertSupport[] {
  if (site.kind !== 'covert') return [];
  const attendance = resolvePresence(ctx, site, {});
  const best = new Map<CovertSupport['role'], CovertSupport>();
  for (const { a, working, p } of liveDuties(ctx, 'covert_support')) {
    const b = working.benefit;
    if (b.kind !== 'covert_support' || a.target.kind !== 'covert' || a.target.operation !== site.operation
      || !attendance.people.includes(p.id)) continue;
    const old = best.get(b.role);
    if (!old || b.bonus > old.bonus || b.bonus === old.bonus && a.id < old.assignment.id) {
      best.set(b.role, { role: b.role, bonus: b.bonus, assignment: a, practitioner: p });
    }
  }
  return [...best.values()];
}

export function noteCovertSupport(ctx: SimCtx, assignment: string): void {
  const a = ctx.world.mystic.assignments.find(a => a.id === assignment);
  if (!a) return;
  markUseful(a, ctx.world.year);
  a.service.covertUses = (a.service.covertUses ?? 0) + 1;
}

/** The strongest paid, learned, present maintainer per stage; neither hall nor person wards cover travel. */
export function householdProtection(ctx: SimCtx, target: string, site: SceneSite, bindings: Record<string, string | string[]>): HouseholdProtection[] {
  const attendance = resolvePresence(ctx, site, bindings);
  if (!attendance.hall || !attendance.people.includes(target)) return [];
  const best = new Map<HouseholdProtection['stage'], HouseholdProtection>();
  for (const { a, working, p } of liveDuties(ctx, 'household_protection')) {
    const b = working.benefit;
    if (b.kind !== 'household_protection' || !attendance.people.includes(p.id)) continue;
    if (a.target.kind === 'person' && a.target.person !== target) continue;
    const place = dutyPlaceOf(ctx, a.target, a.bindings);
    if (!place || !('hall' in place) || place.hall !== attendance.hall) continue;
    const old = best.get(b.stage);
    if (!old || b.bonus > old.bonus || b.bonus === old.bonus && a.id < old.assignment.id) {
      best.set(b.stage, { stage: b.stage, bonus: b.bonus, assignment: a, practitioner: p });
    }
  }
  return [...best.values()];
}

/** Account only for an attributed change, once per incident use; the caller freezes the receipt. */
export function noteHouseholdProtection(ctx: SimCtx, assignment: string): void {
  const a = ctx.world.mystic.assignments.find(a => a.id === assignment);
  if (!a) return;
  markUseful(a, ctx.world.year);
  a.service.protections = (a.service.protections ?? 0) + 1;
}

export interface LifeCare {
  assignment: MysticAssignment;
  carer: Person;
  mortality: number;
  infant: number;
}

/**
 * THE CARE A PERSON HAS THIS MOMENT, read by `rollDeath`. Only a resident the
 * carer chose to attend this year, still in the hall, with the carer still
 * able. Nonstacking: the best single carer counts.
 */
export function lifeCareFor(ctx: SimCtx, ward: Person): LifeCare | undefined {
  if (!ctx.world.mystic.assignments.length) return undefined;
  let best: LifeCare | undefined;
  const duties = liveDuties(ctx, 'life_care');
  if (!duties.length) return undefined;
  const deployed = deployedPeople(ctx);
  const duty = dutyPlaces(ctx);
  for (const { a, working, p } of duties) {
    if (p.id === ward.id || working.benefit.kind !== 'life_care') continue;
    const place = dutyPlaceOf(ctx, a.target, a.bindings);
    if (!a.attended?.includes(ward.id)) continue;
    if (!place || !('hall' in place) || !attendsHall(ctx, place.hall, ward, deployed, duty)) continue;
    const care = {
      assignment: a, carer: p,
      mortality: working.benefit.mortalityReduction,
      infant: working.benefit.infantReduction,
    };
    if (!best || care.mortality + care.infant > best.mortality + best.infant) best = care;
  }
  return best;
}

/** The roll would have taken them without the carer, and did not with one. */
export function noteLifeKept(ctx: SimCtx, care: LifeCare, ward: Person): void {
  const w = ctx.world;
  care.assignment.service.livesKept += 1;
  markUseful(care.assignment, w.year);
  w.chronicle.push({
    year: w.year, weight: 'line', named: true, people: [care.carer.id, ward.id],
    text: msg(ctx, 'mystic.life_kept',
      '{WARD} was very ill this year. {PERSON} sat up with {WARD} through the worst of it, and {WARD} lived.',
      { PERSON: care.carer.name, WARD: ward.name }),
  });
}

function wardenFor(ctx: SimCtx, defId: string, kind: ParcelKind) {
  if (!ctx.world.mystic.assignments.length) return undefined;
  for (const d of liveDuties(ctx, 'estate_protection')) {
    const b = d.working.benefit;
    if (b.kind !== 'estate_protection' || d.a.target.kind !== 'parcel' || d.a.target.parcel !== defId) continue;
    if (!b.parcelKinds.includes(kind)) continue;
    return { ...d, lossPrevented: b.lossPrevented };
  }
  return undefined;
}

/**
 * A WARDEN HOLDS A BAD YEAR UP, read by `tickLandRisks` after the year's roll.
 * The draw is untouched; only its shortfall below the kind's ordinary yield is
 * part made good. A good year is left alone.
 */
export function wardedYieldFactor(ctx: SimCtx, def: ParcelDef, state: ParcelState, raw: number): number {
  const warden = wardenFor(ctx, def.id, def.kind);
  if (!warden) return raw;
  const ordinary = ORDINARY_YIELD[def.kind];
  if (raw >= ordinary) return raw;
  const kept = (ordinary - raw) * warden.lossPrevented;
  if (kept <= 0) return raw;
  warden.a.service.yieldKept += kept * Math.max(0, def.baseYield + (state.yieldBonus ?? 0));
  markUseful(warden.a, ctx.world.year);
  return raw + kept;
}

/**
 * AND HOLDS THE GROUND ITSELF, read by `damageParcel`: blight, flood, a
 * dug-out bank. Returns the damage that still lands. Rare, so it is written.
 */
export function wardedDamage(ctx: SimCtx, def: ParcelDef, magnitude: number): number {
  const warden = wardenFor(ctx, def.id, def.kind);
  if (!warden || magnitude <= 0) return magnitude;
  const kept = magnitude * warden.lossPrevented;
  warden.a.service.yieldKept += kept;
  markUseful(warden.a, ctx.world.year);
  ctx.world.chronicle.push({
    year: ctx.world.year, weight: 'line', named: true, people: [warden.p.id],
    text: msg(ctx, 'mystic.ground_kept',
      '{PARCEL} would have been spoiled this year. {PERSON} had been keeping it, and most of it held.',
      { PARCEL: proseForContentField(ctx, 'parcels', def.id, 'name', def.name), PERSON: warden.p.name }),
  });
  return magnitude - kept;
}

function workingName(ctx: SimCtx, w: MysticWorkingDef): string {
  return proseForContentField(ctx, 'mysticWorkings', w.id, 'name', w.name);
}

function fieldPlaceName(ctx: SimCtx, year: number): string {
  return msg(ctx, 'mystic.place.field', 'the levy raised in {YEAR}', { YEAR: String(year) });
}

export function fieldTerms(ctx: SimCtx, working: MysticWorkingDef): string | undefined {
  if (working.benefit.kind === 'covert_support') return msg(ctx, 'mystic.covert.terms',
    'The reader joins this expedition and provides no home coverage. Setting down the working does not end the return journey. Their book waits by its remaining term until they return; captivity keeps it waiting.');
  if (!isFieldWorking(working)) return undefined;
  const risk = working.benefit.risk;
  const range = (n: number) => `${Math.round(n * 1000) / 10}–${Math.round(n * 2000) / 10}%`;
  return msg(ctx, 'mystic.field.terms',
    'One year on the road. No home duty while away. Each field year, before concealment: death {DEATH}, capture {CAPTURE}, injury {INJURY}, according to the tide. Capture requires an opposing house able to hold the reader. An injury stops service for two years; ransom costs {RANSOM} crowns.',
    { DEATH: range(risk.death), CAPTURE: range(risk.capture), INJURY: range(risk.injury), RANSOM: String(risk.ransom) });
}

function placeName(ctx: SimCtx, site: SceneSite, bindings: Record<string, string>): string {
  const w = ctx.world;
  switch (site.kind) {
    case 'service': return msg(ctx, 'mystic.place.service', 'the agreed outside service');
    case 'book': {
      const book = ctx.content.spellbook(site.book);
      return book ? proseForContentField(ctx, 'spellbooks', book.id, 'name', book.name) : site.book;
    }
    case 'covert': {
      const o = w.covert.operations.find(o => o.plan.id === site.operation);
      return msg(ctx, 'mystic.place.covert', 'the expedition concerning {PERSON}',
        { PERSON: o ? w.people.get(o.plan.target)?.name ?? o.plan.target : '' });
    }
    case 'person': return w.people.get(site.person)?.name ?? site.person;
    case 'parcel': {
      const def = ctx.content.parcel(site.parcel);
      return def ? proseForContentField(ctx, 'parcels', def.id, 'name', def.name) : site.parcel;
    }
    case 'hall': {
      const place = dutyPlaceOf(ctx, site, bindings);
      if (!place || !('hall' in place) || place.hall === MAIN_BRANCH) return msg(ctx, 'mystic.place.seat', 'the seat');
      const anchor = w.people.get(bindings[typeof site.hall === 'string' ? '' : site.hall.slot] ?? '');
      return msg(ctx, 'mystic.place.branch', 'the hall where {PERSON} lives', { PERSON: anchor?.name ?? '' });
    }
    case 'party': case 'elsewhere': case 'muster': {
      const c = site.kind === 'muster' ? w.muster.commitments.find(c => c.id === site.commitment) : undefined;
      return c ? fieldPlaceName(ctx, c.began)
        : msg(ctx, 'mystic.place.elsewhere', 'elsewhere');
    }
    default: return assertNever(site, 'duty place');
  }
}

function lapseLine(ctx: SimCtx, a: MysticAssignment, p: Person, working: MysticWorkingDef, gap: MysticGap): void {
  if (dutyHouse(ctx, a) !== ctx.world.playerHouse) return;
  ctx.world.chronicle.push({
    year: ctx.world.year, weight: 'line', named: false, people: [p.id],
    text: gapLine(ctx, gap, { PERSON: p.name, WORKING: workingName(ctx, working) }),
  });
}

/** Why the Table refuses, in a clause a client shows beside the greyed option. */
export function gapReason(ctx: SimCtx, gap: MysticGap): string {
  switch (gap) {
    case 'dead': return msg(ctx, 'mystic.gap.reason.dead', 'they are not living');
    case 'left_house': return msg(ctx, 'mystic.gap.reason.left_house', 'they are no longer of this house');
    case 'hostage': return msg(ctx, 'mystic.gap.reason.hostage', 'they are held hostage');
    case 'missing': return msg(ctx, 'mystic.gap.reason.missing', 'nobody knows where they are');
    case 'deployed': return msg(ctx, 'mystic.gap.reason.deployed', 'they are with the levy');
    case 'away_post': return msg(ctx, 'mystic.gap.reason.away_post', 'their post keeps them away');
    case 'not_resident': return msg(ctx, 'mystic.gap.reason.not_resident', 'they are not there');
    case 'unlearned': return msg(ctx, 'mystic.gap.reason.unlearned', 'they have not finished the books it needs');
    case 'target_lost': return msg(ctx, 'mystic.gap.reason.target_lost', 'the working cannot reach that place');
    case 'unpaid': return msg(ctx, 'mystic.gap.reason.unpaid', 'the house cannot pay its upkeep');
    case 'too_young': return msg(ctx, 'mystic.gap.reason.too_young', 'they are too young to keep it');
    case 'wounded': return msg(ctx, 'mystic.gap.reason.wounded', 'they are recovering from a field injury');
    case 'no_need': return msg(ctx, 'mystic.gap.reason.no_need', 'there is no current work of that kind here');
    default: return assertNever(gap, 'mystic gap');
  }
}

/** One whole sentence per gap, so a translation never fits a reason into a clause. */
function gapLine(ctx: SimCtx, gap: MysticGap, v: Record<string, string>): string {
  switch (gap) {
    case 'dead': return msg(ctx, 'mystic.gap.dead', '{WORKING} ended with {PERSON}. Nobody else in the house was keeping it.', v);
    case 'left_house': return msg(ctx, 'mystic.gap.left_house', '{PERSON} is no longer of the house, and {WORKING} went with {PERSON}.', v);
    case 'hostage': return msg(ctx, 'mystic.gap.hostage', '{WORKING} lapsed this year. {PERSON} is held hostage and cannot keep it.', v);
    case 'missing': return msg(ctx, 'mystic.gap.missing', '{WORKING} lapsed this year. Nobody knows where {PERSON} is.', v);
    case 'deployed': return msg(ctx, 'mystic.gap.deployed', '{WORKING} lapsed this year. {PERSON} went with the levy, and nobody was left to keep it at home.', v);
    case 'away_post': return msg(ctx, 'mystic.gap.away_post', '{WORKING} lapsed this year. {PERSON} took a post that keeps {PERSON} away.', v);
    case 'not_resident': return msg(ctx, 'mystic.gap.not_resident', '{WORKING} lapsed this year. {PERSON} was not there to keep it.', v);
    case 'unlearned': return msg(ctx, 'mystic.gap.unlearned', '{WORKING} ended. {PERSON} no longer has the learning it needs.', v);
    case 'target_lost': return msg(ctx, 'mystic.gap.target_lost', '{WORKING} ended. What {PERSON} was keeping is no longer the house\'s to keep.', v);
    case 'unpaid': return msg(ctx, 'mystic.gap.unpaid', '{WORKING} lapsed this year. The house could not pay for it, and {PERSON} could not keep it on nothing.', v);
    case 'too_young': return msg(ctx, 'mystic.gap.too_young', '{WORKING} lapsed this year. {PERSON} is too young to keep it.', v);
    case 'wounded': return msg(ctx, 'mystic.gap.wounded', '{PERSON} is recovering from a field injury. {WORKING} cannot be kept until the wound has healed.', v);
    case 'no_need': return msg(ctx, 'mystic.gap.no_need', '{PERSON} kept the place for {WORKING}, but there was no current work of that kind. The duty waits without charging upkeep.', v);
    default: return assertNever(gap, 'mystic gap line');
  }
}

// Field service stays on the existing assignment lifecycle and upkeep ledger.
function fieldDuty(ctx: SimCtx, c: Commitment, kind: MysticFieldBenefit['kind'], house = ctx.world.playerHouse) {
  return liveDuties(ctx, kind).find(d => dutyHouse(ctx, d.a) === house
    && d.a.target.kind === 'muster' && d.a.target.commitment === c.id);
}

export function fieldCareFor(ctx: SimCtx, c: Commitment) {
  const d = fieldDuty(ctx, c, 'field_care');
  return d?.working.benefit.kind === 'field_care' ? { ...d, benefit: d.working.benefit } : undefined;
}

export function fieldSupplySaving(ctx: SimCtx, c: Commitment): number {
  const d = fieldDuty(ctx, c, 'field_supply');
  const b = d?.working.benefit;
  return b?.kind === 'field_supply' ? Math.min(c.men, b.maxMen) * b.crownsPerMan : 0;
}

function fieldReceipt(ctx: SimCtx, people: string[], text: string): void {
  ctx.world.chronicle.push({ year: ctx.world.year, weight: 'line', named: true, people,
    text });
}

/** Called only when the unchanged mortality draw falls between the two hazards. */
export function noteFieldOfficerKept(ctx: SimCtx, c: Commitment, officer: Person): void {
  const care = fieldCareFor(ctx, c);
  if (!care) return;
  care.a.service.livesKept += 1;
  markUseful(care.a, ctx.world.year);
  fieldReceipt(ctx, [care.p.id, officer.id], msg(ctx, 'mystic.field.officer_kept', '{PERSON} dressed {OFFICER}’s wound in the camp. {OFFICER}’s name stayed on the roll.', { PERSON: care.p.name, OFFICER: officer.name }));
}

/** Fractional recoverable losses are carried forward, bounded by this year's actual loss. */
export function fieldCasualties(ctx: SimCtx, c: Commitment, ordinaryLost: number): number {
  const care = fieldCareFor(ctx, c);
  if (!care || ordinaryLost <= 0) return ordinaryLost;
  const accumulated = (care.a.service.recoverable ?? 0) + ordinaryLost * care.benefit.casualtyReduction;
  const saved = Math.min(ordinaryLost, Math.floor(accumulated));
  care.a.service.recoverable = accumulated - Math.floor(accumulated);
  if (!saved) return ordinaryLost;
  care.a.service.menKept = (care.a.service.menKept ?? 0) + saved;
  markUseful(care.a, ctx.world.year);
  fieldReceipt(ctx, [care.p.id], msg(ctx, 'mystic.field.men_kept', '{PERSON} kept {MEN} of the levy alive through the camp sickness and the wounds. Their names stayed on the roll.', { PERSON: care.p.name, MEN: String(saved) }));
  return ordinaryLost - saved;
}

/** Account after attrition, using exactly the supply quote the economy will collect. */
export function tickFieldAccount(ctx: SimCtx, c: Commitment): void {
  const supply = fieldDuty(ctx, c, 'field_supply');
  const saved = fieldSupplySaving(ctx, c);
  if (supply && saved > 0) {
    supply.a.service.crownsKept = (supply.a.service.crownsKept ?? 0) + saved;
    markUseful(supply.a, ctx.world.year);
    fieldReceipt(ctx, [supply.p.id], msg(ctx, 'mystic.field.supplies', '{PERSON} kept the camp’s water and stores fit to use. The levy’s account came to {CROWNS} crowns less this year.', { PERSON: supply.p.name, CROWNS: String(Math.round(saved * 100) / 100) }));
  }
  const watch = fieldDuty(ctx, c, 'field_watch');
  if (!watch || watch.working.benefit.kind !== 'field_watch') return;
  const enemy = c.opponent ? fieldDuty(ctx, c, 'field_concealment', c.opponent) : undefined;
  const hidden = enemy?.working.benefit.kind === 'field_concealment' ? enemy.working.benefit.observationReduction : 0;
  const chance = watch.working.benefit.opportunityChance;
  const roll = streamFor(ctx.world, 'mystic-field-opportunity', c.id).next();
  if (roll < chance * (1 - hidden)) {
    c.credit += watch.working.benefit.credit;
    watch.a.service.opportunities = (watch.a.service.opportunities ?? 0) + 1;
    markUseful(watch.a, ctx.world.year);
    fieldReceipt(ctx, [watch.p.id], msg(ctx, 'mystic.field.opportunity', '{PERSON} found a way past the hidden approach. The Warden’s clerk entered {CREDIT} more credit against the house’s name.', { PERSON: watch.p.name, CREDIT: String(watch.working.benefit.credit) }));
  } else if (enemy && roll < chance) {
    markUseful(enemy.a, ctx.world.year);
    fieldReceipt(ctx, [watch.p.id, enemy.p.id], msg(ctx, 'mystic.field.contested_watch', '{PERSON} could not read the enemy’s movement. {ENEMY} had been keeping it out of sight.', { PERSON: watch.p.name, ENEMY: enemy.p.name }));
  }
}

/** An enemy is an existing hostile house with an actual learned reader, never a generated counter-score. */
function prepareFieldOpposition(ctx: SimCtx, commitment: string): void {
  const w = ctx.world;
  const c = w.muster.commitments.find(c => c.id === commitment && c.status === 'in_the_field');
  if (!c || !w.mystic.assignments.some(a => dutyHouse(ctx, a) === w.playerHouse
    && a.target.kind === 'muster' && a.target.commitment === c.id)) return;
  if (!c.opponent) {
    const houseOf = (endpoint: string): string | undefined => {
      if (w.houses.has(endpoint)) return endpoint;
      const p = w.people.get(endpoint);
      if (!p) return undefined;
      const membership = currentMembership(p, w.year);
      return membership?.kind === 'hostage' ? p.captivity?.home.house : membership?.house;
    };
    const hostile = new Set<string>();
    for (const relationship of w.relationships.values()) {
      if (relationship.sentiment >= 0 && !relationship.grudges.some(g => g.severity > 0)) continue;
      const from = houseOf(relationship.from);
      const to = houseOf(relationship.to);
      const other = from === w.playerHouse ? to : to === w.playerHouse ? from : undefined;
      if (other && other !== w.playerHouse && w.houses.has(other)) hostile.add(other);
    }
    const opponent = [...hostile].sort()[0];
    if (opponent) c.opponent = opponent;
  }
  const house = c.opponent;
  if (!house || w.mystic.assignments.some(a => a.house === house && a.target.kind === 'muster'
    && a.target.commitment === c.id)) return;
  // Pick independently of the player's chosen role. No matching counter is invented.
  for (const p of w.people.all().filter(p => currentMembership(p, w.year)?.house === house)
    .sort((a, b) => a.born - b.born || a.id.localeCompare(b.id))) {
    for (const working of [...ctx.content.mysticWorkings].sort((a, b) => a.id.localeCompare(b.id))) {
      if (working.benefit.kind !== 'field_watch' && working.benefit.kind !== 'field_concealment') continue;
      const o = { person: String(p.id), working: working.id, target: { kind: 'muster' as const, commitment: c.id } };
      if (quoteDuty(ctx, o, house).ok) { commitDuty(ctx, o, house); return; }
    }
  }
}

/** Separate keyed streams preserve the ordinary war-tide draw and every paired control. */
export function tickFieldRisks(ctx: SimCtx, c: Commitment): void {
  const w = ctx.world;
  for (const a of [...w.mystic.assignments]) {
    if (a.target.kind !== 'muster' || a.target.commitment !== c.id) continue;
    const working = workingDef(ctx, a.working);
    const p = w.people.get(a.practitioner);
    if (!working || !isFieldWorking(working) || practitionerGap(ctx, p, working, a)) continue;
    if (w.year < a.ready) continue;
    const house = dutyHouse(ctx, a);
    const conceal = fieldDuty(ctx, c, 'field_concealment', house);
    const otherHouse = house === w.playerHouse ? c.opponent : w.playerHouse;
    const observer = otherHouse ? fieldDuty(ctx, c, 'field_watch', otherHouse) : undefined;
    const hidden = conceal?.working.benefit.kind === 'field_concealment' ? conceal.working.benefit.captureReduction : 0;
    const protection = hidden * (observer ? 0.5 : 1);
    const risk = working.benefit.risk;
    const exposure = 1 + (100 - w.muster.tide) / 100;
    const death = risk.death * exposure;
    const capture = risk.capture * exposure;
    const roll = streamFor(w, 'mystic-field-risk', c.id, p!.id).next();
    if (roll < death) {
      w.people.kill(p!.id, w.year, msg(ctx, 'mystic.field.cause', 'while keeping a working with the levy'));
      fieldReceipt(ctx, [p!.id], msg(ctx, 'mystic.field.lost', '{PERSON} did not come back from the field working. The duty ended there.', { PERSON: p!.name }));
      finishFieldDuty(ctx, a, w.year - 1);
    } else if (roll < death + capture * (1 - protection)) {
      if (conceal && observer && roll >= death + capture * (1 - hidden)) {
        markUseful(observer.a, w.year);
        fieldReceipt(ctx, [p!.id, observer.p.id], msg(ctx, 'mystic.field.screen_broken', '{ENEMY} found the covered path. {PERSON}’s concealment did not hold.', { ENEMY: observer.p.name, PERSON: p!.name }));
      }
      if (house !== w.playerHouse) {
        // An opposing observer can abandon the field. Family captivity/ransom
        // remains the player's established lifecycle; this creates no enemy prisoner model.
        finishFieldDuty(ctx, a, w.year - 1);
      } else if (c.opponent && (captureFamily(ctx, p!.id, c.opponent, risk.ransom)
        || captureContractor(ctx, p!.id, c.opponent, risk.ransom))) finishFieldDuty(ctx, a, w.year - 1);
    } else if (conceal && roll < death + capture) {
      markUseful(conceal.a, w.year);
      fieldReceipt(ctx, [p!.id, conceal.p.id], msg(ctx, 'mystic.field.hidden_return', '{PERSON} came back by a covered path. {READER} kept the pursuers from finding it.', { PERSON: p!.name, READER: conceal.p.name }));
    } else if (roll < death + capture + risk.injury * exposure) {
      p!.fieldRecoveryUntil = w.year + 2;
      a.status = 'suspended';
      a.reason = 'wounded';
      fieldReceipt(ctx, [p!.id], msg(ctx, 'mystic.field.wounded', '{PERSON} was hurt while keeping the field working. The duty will wait until {YEAR}.', { PERSON: p!.name, YEAR: String(p!.fieldRecoveryUntil) }));
    }
  }
}

function finishFieldDuty(ctx: SimCtx, a: MysticAssignment, lastTurned: number, withdrawn = false): void {
  const w = ctx.world;
  if (a.target.kind === 'covert') {
    const id = a.target.operation;
    const o = w.covert.operations.find(o => o.plan.id === id);
    if (o && !o.supportService.some(s => s.id === a.id)) o.supportService.push({
      id: a.id, practitioner: a.practitioner, working: a.working, ended: w.year, service: structuredClone(a.service),
    });
  }
  if (a.target.kind === 'muster') {
    const commitment = a.target.commitment;
    const c = w.muster.commitments.find(c => c.id === commitment);
    const p = w.people.get(a.practitioner);
    if (c) {
      (c.fieldService ??= []).push({ id: a.id, practitioner: a.practitioner, working: a.working,
        ...(a.house ? { house: a.house } : {}),
        service: { ...a.service }, ended: w.year,
        fate: p?.captivity ? 'captured' : p?.status === 'dead' ? 'dead' : p && isCurrentFamily(ctx, p) ? 'returned' : 'departed' });
    }
  }
  endDuty(ctx, a, lastTurned, withdrawn);
}

/** Settlement and withdrawal return every specialist; a later war cannot inherit their old orders. */
export function finishFieldService(ctx: SimCtx, c: Commitment): void {
  for (const a of [...ctx.world.mystic.assignments]) {
    if (a.target.kind !== 'muster' || a.target.commitment !== c.id) continue;
    if (dutyHouse(ctx, a) === ctx.world.playerHouse) {
      const p = ctx.world.people.get(a.practitioner);
      if (p) {
        if (a.service.usefulYears) relate(ctx.world, ctx.world.playerHouse, p.id, Math.min(10, a.service.usefulYears), ['obligation']);
        fieldReceipt(ctx, [p.id], msg(ctx, 'mystic.field.returned', '{PERSON}’s field account closed: {MEN} levy men kept, {LIVES} officers kept, {CROWNS} crowns saved on stores, and {SPENT} crowns spent on the duty.', { PERSON: p.name, MEN: String(a.service.menKept ?? 0), LIVES: String(a.service.livesKept),
            CROWNS: String(Math.round((a.service.crownsKept ?? 0) * 100) / 100), SPENT: String(a.service.spent) }));
      }
    }
    finishFieldDuty(ctx, a, ctx.world.year);
  }
}

/** Called after the expedition closes, so neither the people nor their books teleport home early. */
export function finishCovertService(ctx: SimCtx, operation: string, lastTurned: number): void {
  for (const a of [...ctx.world.mystic.assignments]) {
    if (a.target.kind === 'covert' && a.target.operation === operation) finishFieldDuty(ctx, a, lastTurned);
  }
  resumeDutyStudies(ctx, operation, lastTurned);
}

export function finishContractService(ctx: SimCtx, contract: string): void {
  for (const a of [...ctx.world.mystic.assignments]) if (a.contract === contract) finishFieldDuty(ctx, a, ctx.world.year - 1);
  resumeDutyStudies(ctx, contract, ctx.world.year - 1);
}

// ── What the Table shows ────────────────────────────────────────────────────

export interface MysticTarget { target: SceneSite; bindings: Record<string, string>; name: string }

export interface MysticDutyView {
  id: string;
  person: string;
  name: string;
  working: string;
  workingName: string;
  place: string;
  status: MysticAssignment['status'];
  /** Why it is not serving, in the reader's words; absent while it serves. */
  reason?: string;
  gap?: MysticGap;
  ready: number;
  upkeep: number;
  service: MysticAssignment['service'];
  /** The book this duty set down, and how much of it waits. */
  paused?: { book: string; name: string; remainingYears: number };
  /** Whom a carer is sitting with this year. */
  attended?: { person: string; name: string }[];
  fieldTerms?: string;
}

export interface MysticOfferView {
  working: string;
  name: string;
  description: string;
  affinity: string;
  benefit: MysticWorkingDef['benefit']['kind'];
  preparation: number;
  preparationYears: number;
  upkeep: number;
  known: boolean;
  books: string[];
  collaborator?: string;
  fieldTerms?: string;
  /** Learned, available, and keeping no other duty — the people the order would accept. */
  practitioners: { person: string; name: string; studying?: { book: string; remainingYears: number } }[];
  /** Places this working can actually reach today. */
  targets: MysticTarget[];
}

export interface MysticView {
  duties: MysticDutyView[];
  offers: MysticOfferView[];
  history: { id: string; account: string; service: MysticAssignment['service'] }[];
}

/** Every place a working can be sent this year, already bound to the people its site names. */
export function mysticTargets(ctx: SimCtx, working: MysticWorkingDef): MysticTarget[] {
  const w = ctx.world;
  const out: MysticTarget[] = [];
  const b = working.benefit;
  switch (b.kind) {
    case 'commission': return [];
    case 'library_care':
      return [...w.library.keys()].map(book => ({ target: { kind: 'book' as const, book }, bindings: {}, name: placeName(ctx, { kind: 'book', book }, {}) }));
    case 'convalescence': case 'teaching':
      return w.people.household(w.playerHouse, w.year).flatMap(p => {
        const target: SceneSite = { kind: 'person', person: p.id };
        return targetGap(ctx, working, target, {}) ? [] : [{ target, bindings: {}, name: p.name }];
      });
    case 'covert_support':
      return w.covert.operations.filter(o => o.stage === 'preparing' || o.stage === 'approach').map(o => {
        const target: SceneSite = { kind: 'covert', operation: o.plan.id };
        return { target, bindings: {}, name: placeName(ctx, target, {}) };
      });
    case 'household_protection': {
      if (b.scope === 'person') {
        for (const p of w.people.household(w.playerHouse, w.year)) {
          if (p.becomesGuardian || !isCurrentFamily(ctx, p)) continue;
          const target: SceneSite = { kind: 'person', person: p.id };
          if (!targetGap(ctx, working, target, {})) out.push({ target, bindings: {}, name: p.name });
        }
        return out;
      }
      // Hall protection uses the same concrete halls as household care.
      return mysticTargets(ctx, { ...working, benefit: { kind: 'life_care', mortalityReduction: 0, infantReduction: 0, maxWards: 1 } });
    }
    case 'life_care': case 'household_provision': {
      out.push({ target: { kind: 'hall', hall: 'main' }, bindings: {}, name: placeName(ctx, { kind: 'hall', hall: 'main' }, {}) });
      for (const branch of w.branches.values()) {
        if (!isActiveBranch(branch)) continue;
        const anchor = w.people.household(w.playerHouse, w.year)
          .filter((p) => p.status === 'alive' && p.membership.some((m) => m.branch === branch.id && m.to === undefined))
          .sort((x, y) => x.born - y.born || x.id.localeCompare(y.id))[0];
        if (!anchor) continue;
        const target: SceneSite = { kind: 'hall', hall: { slot: 'HALL' } };
        const bindings = { HALL: anchor.id };
        if (targetGap(ctx, working, target, bindings)) continue;
        out.push({ target, bindings, name: placeName(ctx, target, bindings) });
      }
      return out;
    }
    case 'project_support':
    case 'estate_protection': {
      const seen = new Set<string>();
      for (const state of w.parcels.values()) {
        if (!state.defId || seen.has(state.defId)) continue;
        seen.add(state.defId);
        const target: SceneSite = { kind: 'parcel', parcel: state.defId, slots: ['WARDEN'] };
        if (targetGap(ctx, working, target, {})) continue;
        out.push({ target, bindings: {}, name: placeName(ctx, target, {}) });
      }
      return out.sort((x, y) => x.name.localeCompare(y.name));
    }
    case 'field_care': case 'field_supply': case 'field_watch': case 'field_concealment': {
      for (const c of w.muster.commitments) {
        if (c.status !== 'in_the_field') continue;
        const target: SceneSite = { kind: 'muster', commitment: c.id };
        out.push({ target, bindings: {}, name: fieldPlaceName(ctx, c.began) });
      }
      return out;
    }
    default: return assertNever(b, 'mystic targets');
  }
}

export function mysticView(ctx: SimCtx): MysticView {
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);
  const duties = w.mystic.assignments.filter(a => dutyHouse(ctx, a) === w.playerHouse).map((a): MysticDutyView => {
    const working = workingDef(ctx, a.working);
    const p = w.people.get(a.practitioner);
    const pause = w.mystic.pauses.find((x) => x.assignment === a.id);
    const book = pause ? ctx.content.spellbook(pause.book) : undefined;
    return {
      id: a.id,
      person: a.practitioner,
      name: p?.name ?? a.practitioner,
      working: a.working,
      workingName: working ? workingName(ctx, working) : a.working,
      place: placeName(ctx, a.target, a.bindings),
      status: a.status,
      ...(a.reason ? { reason: gapReason(ctx, a.reason), gap: a.reason } : {}),
      ready: a.ready,
      upkeep: working?.upkeep ?? 0,
      ...(working && isFieldWorking(working) ? { fieldTerms: fieldTerms(ctx, working) } : {}),
      service: { ...a.service },
      ...(a.attended ? { attended: a.attended.map((id) => ({ person: id, name: w.people.get(id)?.name ?? id })) } : {}),
      ...(pause ? {
        paused: {
          book: pause.book,
          name: book ? proseForContentField(ctx, 'spellbooks', book.id, 'name', book.name) : pause.book,
          remainingYears: pause.remainingYears,
        },
      } : {}),
    };
  });
  const offers = ctx.content.mysticWorkings.filter(working => working.benefit.kind !== 'commission').map((working): MysticOfferView => ({
    working: working.id,
    name: workingName(ctx, working),
    description: proseForContentField(ctx, 'mysticWorkings', working.id, 'description', working.description),
    affinity: working.affinity,
    benefit: working.benefit.kind,
    preparation: working.preparation.crowns,
    preparationYears: working.preparation.years,
    upkeep: working.upkeep,
    known: household.some(p => hasLearned(p, working)),
    books: working.books.map(id => {
      const book = ctx.content.spellbook(id);
      return book ? proseForContentField(ctx, 'spellbooks', id, 'name', book.name) : id;
    }),
    ...(working.collaborator ? { collaborator: workingName(ctx, workingDef(ctx, working.collaborator)!) } : {}),
    ...(isFieldWorking(working) || working.benefit.kind === 'covert_support' ? { fieldTerms: fieldTerms(ctx, working) } : {}),
    practitioners: household
      .filter((p) => {
        const expedition = working.benefit.kind === 'covert_support'
          ? w.covert.operations.find(o => o.stage === 'preparing' || o.stage === 'approach') : undefined;
        const context = expedition ? { target: { kind: 'covert' as const, operation: expedition.plan.id } } : undefined;
        return !practitionerGap(ctx, p, working, context) && !w.mystic.assignments.some(a => a.practitioner === p.id);
      })
      .map((p) => {
        const study = w.studies.find((s) => s.person === p.id);
        return {
          person: p.id, name: p.name,
          ...(study ? { studying: { book: study.book, remainingYears: Math.max(1, study.completes - w.year) } } : {}),
        };
      }),
    targets: mysticTargets(ctx, working),
  }));
  return { duties, offers, history: w.mystic.services.filter(a => !a.house || a.house === w.playerHouse).slice(-6).reverse()
    .map(a => ({ id: a.id, account: a.account, service: structuredClone(a.service) })) };
}
