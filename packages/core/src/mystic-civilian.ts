import type { SimCtx } from './world.js';
import { liveDuties, markUseful } from './mystic.js';

/** A real paid team at this holding, capped by its strongest role rather than summed. */
export function improvementSupport(ctx: SimCtx, parcel: string) {
  const candidates = liveDuties(ctx, 'project_support').filter(({ a }) => a.target.kind === 'parcel' && a.target.parcel === parcel);
  const best = candidates.sort((a, b) => {
    const left = a.working.benefit.kind === 'project_support' ? a.working.benefit.costReduction : 0;
    const right = b.working.benefit.kind === 'project_support' ? b.working.benefit.costReduction : 0;
    return right - left || a.a.id.localeCompare(b.a.id);
  })[0];
  if (!best || best.working.benefit.kind !== 'project_support') return undefined;
  const partner = best.working.collaborator && candidates.find(c => c.working.id === best.working.collaborator);
  return { reduction: best.working.benefit.costReduction, assignments: [best.a, ...(partner ? [partner.a] : [])] };
}

export function improvementPrice(ctx: SimCtx, parcel: string, ordinary: number): number {
  return Math.max(1, Math.ceil(ordinary * (1 - (improvementSupport(ctx, parcel)?.reduction ?? 0))));
}

export function noteImprovementSupport(ctx: SimCtx, parcel: string, saved: number): void {
  if (saved <= 0) return;
  const support = improvementSupport(ctx, parcel);
  if (!support) return;
  for (const a of support.assignments) markUseful(a, ctx.world.year);
  // Coin is counted once for the joint work; each role still records its useful year.
  const a = support.assignments[0]!;
  a.service.crownsKept = (a.service.crownsKept ?? 0) + saved;
}
