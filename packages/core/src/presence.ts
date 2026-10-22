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

/** No RNG and no stored whereabouts. Explicit visits/parties establish attendance. */
export function resolvePresence(ctx: SimCtx, site: SceneSite, fill: SlotFill): SceneAttendance {
  const w = ctx.world;
  const deployed = new Set(w.muster.commitments
    .filter(c => c.status === 'in_the_field').flatMap(c => c.officers));
  const free = (p: Person | undefined): p is Person => p !== undefined && p.status === 'alive'
    && currentMembership(p, w.year)?.kind !== 'hostage';
  const named = (slots: readonly string[]) => slots.flatMap(slot => castIn(fill, slot));
  const distinct = (ids: readonly string[]) => [...new Set(ids)].filter(id => free(w.people.get(id))).sort();
  switch (site.kind) {
    case 'party': case 'elsewhere': return { site, people: distinct(named(site.slots)) };
    case 'muster': return { site, people: distinct([...deployed]) };
    case 'hall': {
      const anchor = typeof site.hall === 'string' ? undefined : w.people.get(soleCast(fill, site.hall.slot) ?? '');
      if (typeof site.hall !== 'string' && (!anchor || currentMembership(anchor, w.year)?.house !== w.playerHouse)) {
        return { site, people: [] };
      }
      const hall = anchor ? branchOf(w, anchor, w.year) : MAIN_BRANCH;
      const residents = (halls(w, w.year).get(hall) ?? []).filter(p => free(p) && !deployed.has(p.id)
        // Unknown career residence is an absence, not permission to teleport.
        && (!p.career || ctx.content.career(p.career.career)?.resident === 'home'));
      const visitors = named(site.visitors ?? []).filter(id => !deployed.has(id));
      return { site, hall, people: distinct([...residents.map(p => p.id), ...visitors]) };
    }
    default: return assertNever(site, 'scene site');
  }
}
