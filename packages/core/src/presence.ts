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
  const m = currentMembership(person, ctx.world.year);
  return m?.house === ctx.world.playerHouse
    && (m.kind === 'blood' || m.kind === 'cadet' || m.kind === 'married_in');
}

/**
 * WHERE A STANDING DUTY PUTS SOMEBODY (#1873) — the one piece of persisted
 * whereabouts. A warden on a parcel is at the parcel; a carer sent to a hall
 * is in that hall, whichever hall they sleep in otherwise. A duty that is
 * suspended household duty places nobody. A field reader remains deployed
 * during travel and suspension until that commitment returns or releases them.
 */
export type DutyPlace = { hall: string } | { parcel: string } | { commitment: string };

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
    case 'parcel': return { parcel: site.parcel };
    case 'hall': {
      if (typeof site.hall === 'string') return { hall: MAIN_BRANCH };
      const anchor = w.people.get(bindings[site.hall.slot] ?? '');
      if (!anchor || currentMembership(anchor, w.year)?.house !== w.playerHouse) return undefined;
      return { hall: branchOf(w, anchor, w.year) };
    }
    case 'muster': {
      const c = w.muster.commitments.find(c => c.id === site.commitment && c.status === 'in_the_field');
      return c ? { commitment: c.id } : undefined;
    }
    case 'party': case 'elsewhere': return undefined;
    default: return assertNever(site, 'duty site');
  }
}

/** Named officers and assigned specialists, including those travelling or recovering. */
export function deployedPeople(ctx: SimCtx): Set<string> {
  const active = ctx.world.muster.commitments.filter(c => c.status === 'in_the_field');
  const commitments = new Set(active.map(c => c.id));
  return new Set([
    ...active.flatMap(c => c.officers),
    // Travel, unpaid service and recovery do not teleport somebody home.
    ...ctx.world.mystic.assignments.filter(a => a.target.kind === 'muster'
      && commitments.has(a.target.commitment ?? '')).map(a => a.practitioner),
  ]);
}

function free(ctx: SimCtx, p: Person | undefined): p is Person {
  return p !== undefined && p.status === 'alive'
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
  if (w.people.householdOf(p.id, w.year) !== w.playerHouse || branchOf(w, p, w.year) !== hall) return false;
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
    case 'party': case 'elsewhere': case 'parcel': return { site, people: distinct(named(site.slots)) };
    case 'muster': {
      if (site.commitment !== undefined && !w.muster.commitments.some(c =>
        c.id === site.commitment && c.status === 'in_the_field')) return { site, people: [] };
      return { site, people: distinct([...deployed]) };
    }
    case 'hall': {
      const anchor = typeof site.hall === 'string' ? undefined : w.people.get(soleCast(fill, site.hall.slot) ?? '');
      if (typeof site.hall !== 'string' && (!anchor || currentMembership(anchor, w.year)?.house !== w.playerHouse)) {
        return { site, people: [] };
      }
      const hall = anchor ? branchOf(w, anchor, w.year) : MAIN_BRANCH;
      const duty = dutyPlaces(ctx);
      const residents = (halls(w, w.year).get(hall) ?? []).filter(p => attendsHall(ctx, hall, p, deployed, duty));
      const posted = [...duty].filter(([, place]) => 'hall' in place && place.hall === hall).map(([id]) => id)
        .filter(id => !deployed.has(id));
      const visitors = named(site.visitors ?? []).filter(id => !deployed.has(id));
      return { site, hall, people: distinct([...residents.map(p => p.id), ...posted, ...visitors]) };
    }
    default: return assertNever(site, 'scene site');
  }
}
