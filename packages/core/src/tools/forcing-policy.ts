/** Public forcing policy and direct engine cost observations for #1817. */
import type { OutcomeObservation } from '../events/decisions.js';
import { resolveChoice } from '../events/decisions.js';
import { hashSeed, makeRng } from '../rng.js';
import { order, tableView, type TableView } from '../table.js';
import type { SimCtx } from '../world.js';

export interface ForcingStats {
  /** Boy/rite offers, sampled once after the ordinary annual decisions. */
  offered: Record<string, number>;
  taken: Record<string, number>;
  /** Includes ambient and called outcomes, including an aborted ritual. */
  resolved: Record<string, number>;
  madness: Record<string, number>;
  deaths: Record<string, number>;
}

export function emptyForcingStats(): ForcingStats {
  return { offered: {}, taken: {}, resolved: {}, madness: {}, deaths: {} };
}

/** Selection reads only the public Table: oldest boy, then rotate known rites. */
export function forcingSelection(rows: TableView['forcing'], seed: number, year: number) {
  const open = rows.filter((row) => row.ready && row.boys.length);
  const boys = open.flatMap((row) => row.boys).sort((a, b) => b.age - a.age || a.person.localeCompare(b.person));
  const boy = boys[0];
  if (!boy) return undefined;
  const rites = open.filter((row) => row.boys.some((candidate) => candidate.person === boy.person));
  return { rite: rites[(seed + year) % rites.length]!.rite, person: boy.person };
}

/** One deliberate full attempt per year; the caller resolves its Record normally. */
export function tryForcingRite(ctx: SimCtx, seed: number, stats: ForcingStats): boolean {
  const rows = tableView(ctx).forcing;
  for (const row of rows) if (row.ready) stats.offered[row.rite] = (stats.offered[row.rite] ?? 0) + row.boys.length;
  const selected = forcingSelection(rows, seed, ctx.world.year);
  if (!selected || !order(ctx, { kind: 'forcingRite', ...selected }).ok) return false;
  const pending = ctx.world.pendingDecisions.find((decision) => decision.kind === 'choice' && decision.event.id === selected.rite);
  if (!pending || pending.kind !== 'choice' || pending.event.interaction.kind !== 'choice') {
    throw new Error('accepted forcing order did not raise a choice');
  }
  const full = pending.event.interaction.choices[0]!;
  const result = resolveChoice(ctx, pending.id, full.id,
    makeRng(hashSeed(seed, 'forcing-policy', ctx.world.year, selected.person)));
  if (!result.ok) throw new Error('public forcing policy could not answer its rite');
  stats.taken[selected.rite] = (stats.taken[selected.rite] ?? 0) + 1;
  return true;
}

/** Paired reads around the sole commit path; no predicted effects or extra RNG. */
export function observeForcingCosts(ctx: SimCtx, stats: ForcingStats): void {
  const before = new Map<OutcomeObservation, { id: string; madness: number; alive: boolean }>();
  ctx.observeOutcome = (observation) => {
    const forcing = observation.event.forcing;
    if (!forcing) return;
    const id = observation.fill[forcing.slot];
    const boy = typeof id === 'string' ? ctx.world.people.get(id) : undefined;
    if (boy) before.set(observation, { id: boy.id, madness: boy.madness, alive: boy.status === 'alive' });
  };
  ctx.observeAppliedOutcome = (observation) => {
    const previous = before.get(observation);
    if (!previous) return;
    before.delete(observation);
    const boy = ctx.world.people.get(previous.id)!;
    const rite = observation.event.id;
    stats.resolved[rite] = (stats.resolved[rite] ?? 0) + 1;
    stats.madness[rite] = (stats.madness[rite] ?? 0) + Math.max(0, boy.madness - previous.madness);
    stats.deaths[rite] = (stats.deaths[rite] ?? 0) + Number(previous.alive && boy.status === 'dead');
  };
}
