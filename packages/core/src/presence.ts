import { assertNever, currentMembership, MAIN_BRANCH, type Person, type SceneSite } from '@ed/schema';
import type { SimCtx } from './world.js';
import { castIn, soleCast, type SlotFill } from './events/slots.js';
import { branchOf, halls } from './people/branches.js';

export interface SceneAttendance {
  site: SceneSite;
  /** Resolved physical hall, when known; absence is never a global pool. */
  hall?: string;
  people: string[];
}

export function isCurrentFamily(ctx: SimCtx, person: Person): boolean {
  return isFamilyOf(ctx, person, ctx.world.playerHouse);
}

export function isFamilyOf(ctx: SimCtx, person: Person, house: string): boolean {
  const m = currentMembership(person, ctx.world.year);
  return m?.house === house
    && (m.kind === 'blood' || m.kind === 'cadet' || m.kind === 'married_in');
}

/** The same hall identity for a resident, an anchored scene and a maintained ward. */
export function homeHall(ctx: SimCtx, person: Person): string | undefined {
  const house = currentMembership(person, ctx.world.year)?.house;
  return house === undefined ? undefined : house === ctx.world.playerHouse
    ? branchOf(ctx.world, person, ctx.world.year) : `foreign:${house}`;
}

/** Restored future operations cannot reserve people or establish attendance yet. */
function activeCovert(ctx: SimCtx, operation: string) {
  return ctx.world.covert.operations.find(o => o.plan.id === operation
    && o.stage !== 'closed' && o.plan.preparedAt <= ctx.world.year);
}

/** The deployment is a present commitment only after its recorded beginning. */
function activeMuster(ctx: SimCtx) {
  return ctx.world.muster.commitments.filter(c =>
    c.status === 'in_the_field' && c.began <= ctx.world.year);
}

export function covertParticipants(ctx: SimCtx, operation: string): string[] {
  const o = activeCovert(ctx, operation);
  return o ? [...new Set([o.plan.operative, ...o.crew, ...ctx.world.mystic.assignments
    .filter(a => a.target.kind === 'covert' && a.target.operation === operation).map(a => a.practitioner)])] : [];
}

export function covertReservation(ctx: SimCtx, person: string): string | undefined {
  return ctx.world.covert.operations.find(o => o.stage !== 'closed'
    && o.plan.preparedAt <= ctx.world.year
    && covertParticipants(ctx, o.plan.id).includes(person))?.plan.id;
}

/** Future-dated outside service cannot take a reader away before it starts. */
function activeService(ctx: SimCtx, contract: string) {
  return ctx.world.mystic.contracts.find(c => c.id === contract
    && c.stage !== 'closed' && c.started <= ctx.world.year);
}

export function serviceReservation(ctx: SimCtx, person: string): string | undefined {
  return ctx.world.mystic.contracts.find(c => c.practitioner === person
    && c.stage !== 'closed' && c.started <= ctx.world.year)?.id;
}

/**
 * WHERE A STANDING DUTY PUTS SOMEBODY (#1873) — the one piece of persisted
 * whereabouts. A warden on a parcel is at the parcel; a carer sent to a hall
 * is in that hall, whichever hall they sleep in otherwise. A duty that is
 * suspended household duty places nobody. A field reader remains deployed
 * during travel and suspension until that commitment returns or releases them.
 */
export type DutyPlace = { hall: string } | { parcel: string } | { commitment: string } | { operation: string } | { service: string };

export function dutyPlaces(ctx: SimCtx): Map<string, DutyPlace> {
  const w = ctx.world;
  const out = new Map<string, DutyPlace>();
  for (const a of w.mystic.assignments) {
    if (a.status === 'suspended') continue;
    const place = dutyPlaceOf(ctx, a.target, a.bindings);
    if (place) out.set(a.practitioner, place);
  }
  return out;
}

/** A duty's site, resolved against its own bindings. Undefined when the anchor is gone. */
export function dutyPlaceOf(ctx: SimCtx, site: SceneSite, bindings: Record<string, string>): DutyPlace | undefined {
  const w = ctx.world;
  switch (site.kind) {
    case 'service': return activeService(ctx, site.contract) ? { service: site.contract } : undefined;
    case 'book': return w.library.has(site.book) ? { hall: MAIN_BRANCH } : undefined;
    case 'covert': return activeCovert(ctx, site.operation) ? { operation: site.operation } : undefined;
    case 'person': {
      const p = w.people.get(site.person);
      const hall = aliveAtYear(ctx, p) ? homeHall(ctx, p) : undefined;
      return hall ? { hall } : undefined;
    }
    case 'parcel': return { parcel: site.parcel };
    case 'hall': {
      if (typeof site.hall === 'string') return { hall: MAIN_BRANCH };
      const anchor = w.people.get(bindings[site.hall.slot] ?? '');
      const hall = aliveAtYear(ctx, anchor) ? homeHall(ctx, anchor) : undefined;
      return hall ? { hall } : undefined;
    }
    case 'muster': {
      const c = activeMuster(ctx).find(c => c.id === site.commitment);
      return c ? { commitment: c.id } : undefined;
    }
    case 'party': case 'elsewhere': return undefined;
    default: return assertNever(site, 'duty site');
  }
}

/** Named officers and assigned specialists, including those travelling or recovering. */
export function deployedPeople(ctx: SimCtx): Set<string> {
  const active = activeMuster(ctx);
  const commitments = new Set(active.map(c => c.id));
  return new Set([
    ...active.flatMap(c => c.officers),
    // Travel, unpaid service and recovery do not teleport somebody home.
    ...ctx.world.mystic.assignments.filter(a => a.target.kind === 'muster'
      && commitments.has(a.target.commitment ?? '')).map(a => a.practitioner),
    ...ctx.world.covert.operations.filter(o =>
      o.stage !== 'closed' && o.plan.preparedAt <= ctx.world.year)
      .flatMap(o => covertParticipants(ctx, o.plan.id)),
    ...ctx.world.mystic.contracts.filter(c => c.stage !== 'closed' && c.started <= ctx.world.year
      && (c.kind === 'commission' || c.stage !== 'working')).map(c => c.practitioner),
  ]);
}

/** An imported status can precede birth or outlive a recorded death. */
function aliveAtYear(ctx: SimCtx, p: Person | undefined): p is Person {
  return p !== undefined && p.status === 'alive'
    && p.born <= ctx.world.year && (p.died === undefined || p.died > ctx.world.year);
}

function free(ctx: SimCtx, p: Person | undefined): p is Person {
  return aliveAtYear(ctx, p)
    && currentMembership(p, ctx.world.year)?.kind !== 'hostage';
}

/**
 * Is this one person physically in this hall this year? The per-person form
 * of the hall branch below, so a reader asking about one ward does not walk
 * every hall in the house. Both answer from the same rules.
 */
export function attendsHall(
  ctx: SimCtx, hall: string, p: Person,
  deployed: ReadonlySet<string> = deployedPeople(ctx),
  duty: ReadonlyMap<string, DutyPlace> = dutyPlaces(ctx),
): boolean {
  const w = ctx.world;
  if (!free(ctx, p) || deployed.has(p.id)) return false;
  const posted = duty.get(p.id);
  if (posted) return 'hall' in posted && posted.hall === hall;
  if (homeHall(ctx, p) !== hall) return false;
  // Unknown career residence is an absence, not permission to teleport.
  return !p.career || ctx.content.career(p.career.career)?.resident === 'home';
}

/** No RNG. Explicit visits, parties and standing duties establish attendance. */
export function resolvePresence(ctx: SimCtx, site: SceneSite, fill: SlotFill): SceneAttendance {
  const w = ctx.world;
  const deployed = deployedPeople(ctx);
  const named = (slots: readonly string[]) => slots.flatMap(slot => castIn(fill, slot));
  const distinct = (ids: readonly string[]) => [...new Set(ids)].filter(id => free(ctx, w.people.get(id))).sort();
  switch (site.kind) {
    case 'service': {
      const c = activeService(ctx, site.contract);
      if (!c) return { site, people: [] };
      const party = distinct([c.practitioner]);
      if (c.stage !== 'working' || !c.patron) return { site, people: party };
      const anchor = w.people.household(c.patron, w.year).find(p => free(ctx, p));
      if (!anchor) return { site, people: party };
      const hall = resolvePresence(ctx, { kind: 'hall', hall: { slot: 'CLIENT' } }, { CLIENT: anchor.id });
      return { ...hall, site, people: distinct([...hall.people, ...party]) };
    }
    case 'book': return w.library.has(site.book) && w.library.get(site.book)?.restoresAt === undefined
      ? { ...resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}), site } : { site, people: [] };
    case 'covert': {
      const o = activeCovert(ctx, site.operation);
      if (!o) return { site, people: [] };
      const party = covertParticipants(ctx, o.plan.id);
      // A preparing or returning expedition is away, but has not become a
      // visitor at a foreign hall merely because an order named that target.
      if (w.year < o.plan.attemptYear - 1 || o.stage === 'returning') return { site, people: distinct(party) };
      const attendance = resolvePresence(ctx, { kind: 'hall', hall: { slot: 'DESTINATION' } }, { DESTINATION: o.plan.target });
      return { ...attendance, site, people: distinct([...attendance.people, ...party]) };
    }
    case 'person': {
      const p = w.people.get(site.person);
      const hall = p && homeHall(ctx, p);
      if (!p || !hall || !attendsHall(ctx, hall, p)) return { site, people: [] };
      const attendance = resolvePresence(ctx, { kind: 'hall', hall: { slot: 'WARD' } }, { WARD: p.id });
      return { ...attendance, site };
    }
    case 'party': case 'elsewhere': case 'parcel': return { site, people: distinct(named(site.slots)) };
    case 'muster': {
      // A muster scene is not a global deployment roster. Covert teams and
      // outside service have their own scene sites, and an explicitly named
      // commitment cannot import officers from another field.
      const commitments = activeMuster(ctx).filter(c =>
        site.commitment === undefined || c.id === site.commitment);
      const ids = new Set(commitments.map(c => c.id));
      return { site, people: distinct([
        ...commitments.flatMap(c => c.officers),
        ...w.mystic.assignments.filter(a => a.target.kind === 'muster'
          && ids.has(a.target.commitment ?? '')).map(a => a.practitioner),
      ]) };
    }
    case 'hall': {
      const anchor = typeof site.hall === 'string' ? undefined : w.people.get(soleCast(fill, site.hall.slot) ?? '');
      if (typeof site.hall !== 'string' && (!aliveAtYear(ctx, anchor) || !homeHall(ctx, anchor))) {
        return { site, people: [] };
      }
      const hall = anchor ? homeHall(ctx, anchor)! : MAIN_BRANCH;
      const house = anchor ? currentMembership(anchor, w.year)!.house : w.playerHouse;
      const duty = dutyPlaces(ctx);
      const residents = (house === w.playerHouse ? halls(w, w.year).get(hall) ?? [] : w.people.household(house, w.year))
        .filter(p => attendsHall(ctx, hall, p, deployed, duty));
      const posted = [...duty].filter(([, place]) => 'hall' in place && place.hall === hall).map(([id]) => id)
        .filter(id => !deployed.has(id));
      const visitors = named(site.visitors ?? []).filter(id => !deployed.has(id));
      return { site, hall, people: distinct([...residents.map(p => p.id), ...posted, ...visitors]) };
    }
    default: return assertNever(site, 'scene site');
  }
}
