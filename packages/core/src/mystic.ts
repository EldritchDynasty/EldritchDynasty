import type {
  MysticAssignment, MysticGap, MysticWorkingDef, ParcelDef, ParcelKind, ParcelState, Person, SceneSite,
} from '@ed/schema';
import { assertNever, canLearn, currentMembership, isActiveBranch, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { OrderResult } from './table.js';
import { DEBT_FLOOR } from './economy.js';
import { attendsHall, deployedPeople, dutyPlaceOf, dutyPlaces, isCurrentFamily } from './presence.js';
import { msg } from './messages.js';
import { ordinaryRisk } from './people/demography.js';
import { proseForContentField } from './prose.js';

/**
 * MYSTIC DUTIES (#1866 B / #1873) — learn, assign, pay, serve, answer for it.
 *
 * A learned reader can be named to ONE standing duty for one real place: a
 * carer for a hall, a warden for a parcel. The duty is a Table order; nothing
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
 * INVARIANT 2: the system only prevents deaths. It never causes one.
 * INVARIANT 8: the phase draws no dice. The life-care reader reuses the one
 * mortality draw `rollDeath` was already making.
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

/**
 * THE ONE AVAILABILITY READER. The quote, the yearly reservation and every
 * benefit ask it, so the Table cannot promise somebody the phase would refuse.
 */
export function practitionerGap(ctx: SimCtx, p: Person | undefined, working: MysticWorkingDef): MysticGap | undefined {
  const w = ctx.world;
  if (!p || (p.status !== 'alive' && p.status !== 'missing')) return 'dead';
  if (currentMembership(p, w.year)?.kind === 'hostage') return 'hostage';
  if (!isCurrentFamily(ctx, p)) return 'left_house';
  if (p.status === 'missing') return 'missing';
  if (!hasLearned(p, working)) return 'unlearned';
  if (w.year - p.born < MYSTIC_DUTY_AGE) return 'too_young';
  if (deployedPeople(ctx).has(p.id)) return 'deployed';
  if (p.career && ctx.content.career(p.career.career)?.resident !== 'home') return 'away_post';
  return undefined;
}

/** Can this working be done for this place at all, today? */
export function targetGap(
  ctx: SimCtx, working: MysticWorkingDef, site: SceneSite, bindings: Record<string, string>,
): MysticGap | undefined {
  const b = working.benefit;
  switch (b.kind) {
    case 'life_care': {
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

export interface MysticOrder { person: string; working: string; target: SceneSite; bindings?: Record<string, string> }

/** Everything an order would cost and whether it can be given, before it is. */
export function quoteDuty(ctx: SimCtx, o: MysticOrder): MysticQuote {
  const w = ctx.world;
  const working = workingDef(ctx, o.working);
  const blank = { preparation: 0, ready: w.year + 1, upkeep: 0 };
  if (!working) return { ...blank, ok: false, reason: msg(ctx, 'mystic.refuse.no_working', 'no such working') };
  const quote: MysticQuote = {
    ok: true,
    preparation: working.preparation.crowns,
    ready: w.year + 1 + working.preparation.years,
    upkeep: working.upkeep,
  };
  const study = w.studies.find((s) => s.person === o.person);
  if (study) quote.pauses = { book: study.book, remainingYears: Math.max(1, study.completes - w.year) };

  const p = w.people.get(o.person);
  const gap = practitionerGap(ctx, p, working) ?? targetGap(ctx, working, o.target, o.bindings ?? {});
  if (gap) return { ...quote, ok: false, gap, reason: gapReason(ctx, gap) };
  if (w.mystic.assignments.some((a) => a.practitioner === o.person)) {
    return { ...quote, ok: false, reason: msg(ctx, 'mystic.refuse.one_duty', 'they already keep a duty') };
  }
  const place = JSON.stringify(dutyPlaceOf(ctx, o.target, o.bindings ?? {}));
  if (w.mystic.assignments.some((a) => workingDef(ctx, a.working)?.benefit.kind === working.benefit.kind
    && JSON.stringify(dutyPlaceOf(ctx, a.target, a.bindings)) === place)) {
    return { ...quote, ok: false, reason: msg(ctx, 'mystic.refuse.covered', 'somebody already keeps that duty there') };
  }
  if (w.treasury - quote.preparation < DEBT_FLOOR) {
    return {
      ...quote, ok: false,
      reason: msg(ctx, 'mystic.refuse.cost', 'the house cannot raise {PRICE} crowns', { PRICE: String(quote.preparation) }),
    };
  }
  return quote;
}

/** The Table's door. Pays the preparation, sets the reader's book down, and records the duty. */
export function assignDuty(ctx: SimCtx, o: MysticOrder): OrderResult {
  const w = ctx.world;
  const quote = quoteDuty(ctx, o);
  if (!quote.ok) return { ok: false, reason: quote.reason };
  const working = workingDef(ctx, o.working)!;
  const p = w.people.get(o.person)!;
  const id = `mys_${(w.counters.mystic += 1).toString(36)}`;

  w.treasury -= quote.preparation;
  w.mystic.assignments.push({
    id,
    practitioner: p.id,
    working: working.id,
    target: structuredClone(o.target),
    bindings: { ...(o.bindings ?? {}) },
    started: w.year,
    ready: quote.ready,
    paidPreparation: quote.preparation,
    paidThrough: w.year,
    status: 'preparing',
    service: { servedYears: 0, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: quote.preparation },
  });

  // Intensive duty sets the book down by what is left of it, never by forfeit.
  const study = w.studies.find((s) => s.person === p.id);
  if (study) {
    w.studies = w.studies.filter((s) => s !== study);
    w.mystic.pauses.push({
      person: p.id, book: study.book, remainingYears: Math.max(1, study.completes - w.year), pausedAt: w.year, assignment: id,
    });
  }

  w.chronicle.push({
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
  const a = w.mystic.assignments.find((x) => x.id === assignment);
  if (!a) return { ok: false, reason: msg(ctx, 'mystic.refuse.no_duty', 'there is no such duty') };
  const p = w.people.get(a.practitioner);
  const working = workingDef(ctx, a.working);
  endDuty(ctx, a, w.year);
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
function endDuty(ctx: SimCtx, a: MysticAssignment, lastTurned: number): void {
  const w = ctx.world;
  w.mystic.assignments = w.mystic.assignments.filter((x) => x !== a);
  const paused = w.mystic.pauses.filter((x) => x.assignment === a.id);
  w.mystic.pauses = w.mystic.pauses.filter((x) => x.assignment !== a.id);
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
  for (const a of [...w.mystic.assignments]) {
    const working = workingDef(ctx, a.working);
    const p = w.people.get(a.practitioner);
    const gap = !working ? 'target_lost'
      : practitionerGap(ctx, p, working) ?? targetGap(ctx, working, a.target, a.bindings);

    if (gap && ENDS.has(gap)) {
      if (p && working) lapseLine(ctx, a, p, working, gap);
      // The year that ended it has started but the library has not read yet.
      endDuty(ctx, a, w.year - 1);
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
    if (w.treasury - working!.upkeep < DEBT_FLOOR) {
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
    if (working!.benefit.kind === 'life_care') {
      const place = dutyPlaceOf(ctx, a.target, a.bindings);
      a.attended = place && 'hall' in place ? hallWards(ctx, place.hall, a.practitioner, working!.benefit.maxWards) : [];
    }
    if (wasSuspended) {
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
function hallWards(ctx: SimCtx, hall: string, carer: string, max: number): string[] {
  const w = ctx.world;
  const deployed = deployedPeople(ctx);
  const duty = dutyPlaces(ctx);
  return w.people.household(w.playerHouse, w.year)
    .filter((p) => p.id !== carer && attendsHall(ctx, hall, p, deployed, duty))
    .map((p) => ({ id: p.id, risk: ordinaryRisk(ctx, p) }))
    .sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id))
    .slice(0, max)
    .map((x) => x.id);
}

/** Upkeep the economy collects this year: only what the phase actually reserved. */
export function mysticUpkeep(ctx: SimCtx): number {
  const w = ctx.world;
  let total = 0;
  for (const a of w.mystic.assignments) {
    if (a.status === 'serving' && a.paidThrough === w.year) total += workingDef(ctx, a.working)?.upkeep ?? 0;
  }
  return total;
}

/** A serving, paid duty whose maintainer is still able to do it at this moment. */
function liveDuties(ctx: SimCtx, kind: MysticWorkingDef['benefit']['kind']) {
  const w = ctx.world;
  const out: { a: MysticAssignment; working: MysticWorkingDef; p: Person }[] = [];
  for (const a of w.mystic.assignments) {
    if (a.status !== 'serving' || a.paidThrough !== w.year) continue;
    const working = workingDef(ctx, a.working);
    if (!working || working.benefit.kind !== kind) continue;
    const p = w.people.get(a.practitioner);
    if (practitionerGap(ctx, p, working)) continue;
    out.push({ a, working, p: p! });
  }
  return out;
}

function markUseful(a: MysticAssignment, year: number): void {
  const s = a.service;
  if (s.lastUseful === year) return;
  s.lastUseful = year;
  s.usefulYears += 1;
  s.firstUsefulAt ??= s.servedYears;
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

function placeName(ctx: SimCtx, site: SceneSite, bindings: Record<string, string>): string {
  const w = ctx.world;
  switch (site.kind) {
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
    case 'party': case 'elsewhere': case 'muster': return msg(ctx, 'mystic.place.elsewhere', 'elsewhere');
    default: return assertNever(site, 'duty place');
  }
}

function lapseLine(ctx: SimCtx, a: MysticAssignment, p: Person, working: MysticWorkingDef, gap: MysticGap): void {
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
    default: return assertNever(gap, 'mystic gap line');
  }
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
  /** Learned, available, and keeping no other duty — the people the order would accept. */
  practitioners: { person: string; name: string; studying?: { book: string; remainingYears: number } }[];
  /** Places this working can actually reach today. */
  targets: MysticTarget[];
}

export interface MysticView {
  duties: MysticDutyView[];
  offers: MysticOfferView[];
}

/** Every place a working can be sent this year, already bound to the people its site names. */
export function mysticTargets(ctx: SimCtx, working: MysticWorkingDef): MysticTarget[] {
  const w = ctx.world;
  const out: MysticTarget[] = [];
  const b = working.benefit;
  switch (b.kind) {
    case 'life_care': {
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
    default: return assertNever(b, 'mystic targets');
  }
}

export function mysticView(ctx: SimCtx): MysticView {
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);
  const duties = w.mystic.assignments.map((a): MysticDutyView => {
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
  const offers = ctx.content.mysticWorkings.map((working): MysticOfferView => ({
    working: working.id,
    name: workingName(ctx, working),
    description: proseForContentField(ctx, 'mysticWorkings', working.id, 'description', working.description),
    affinity: working.affinity,
    benefit: working.benefit.kind,
    preparation: working.preparation.crowns,
    preparationYears: working.preparation.years,
    upkeep: working.upkeep,
    practitioners: household
      .filter((p) => !practitionerGap(ctx, p, working) && !w.mystic.assignments.some((a) => a.practitioner === p.id))
      .map((p) => {
        const study = w.studies.find((s) => s.person === p.id);
        return {
          person: p.id, name: p.name,
          ...(study ? { studying: { book: study.book, remainingYears: Math.max(1, study.completes - w.year) } } : {}),
        };
      }),
    targets: mysticTargets(ctx, working),
  }));
  return { duties, offers };
}
