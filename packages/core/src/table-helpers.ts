import type { Person } from '@ed/schema';
import type { SimCtx } from './world.js';

/** Everyone of the house, alive, this year — the people orders may name. */
export function ours(ctx: SimCtx, id: string): Person | undefined {
  const w = ctx.world;
  const p = w.people.get(id);
  if (!p || p.status !== 'alive') return undefined;
  return w.people.household(w.playerHouse, w.year).some((q) => q.id === p.id) ? p : undefined;
}

