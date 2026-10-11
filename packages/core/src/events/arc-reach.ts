import type { ArcDef, ArcNode } from '@ed/schema';

/**
 * THE FASTEST AN ARC CAN POSSIBLY FINISH, walked ignoring guards, outcomes
 * and weights.
 *
 * Split out of `arcs.ts` so `conditions.ts` can read the same walk `startArc`
 * already refuses on (issue #91, Stage H's `arcCanFinish` condition) without
 * `conditions.ts` importing `arcs.ts` and `arcs.ts` importing `conditions.ts`
 * back — `arcs.ts` calls `evalCondition` (`chooseSuccessor`'s own `when`
 * guard), so the two would otherwise be circular. This file depends on
 * neither.
 */

/** Minimum calendar years before a scheduled node can be due. */
function minimumScheduleYears(schedule: ArcNode['schedule']): number {
  if (schedule === 'immediate') return 0;
  if (schedule === 'next_generation') return 20;
  return Math.max(0, Math.round(schedule.minYears));
}

/**
 * The fastest structurally possible route from the entry beat to an ending.
 *
 * Guards, outcomes and weights are deliberately ignored: this is a LOWER
 * bound used only to refuse an arc that cannot possibly finish before the
 * campaign does. If a guarded short exit later proves unavailable, the story
 * may still run long; what this refuses is offering (or starting) one that
 * was impossible at the moment it began.
 *
 * Authored arcs open immediately; their entry schedule contributes nothing.
 * Inline arcs begin after an ambient parent, so their entry schedule is the
 * parent's Outcome.next.after and DOES contribute. Every successor's own
 * delay is counted in both forms, mirroring scheduleNext in advanceArc.
 *
 * Cycles contribute Infinity until an alternate exit is found. A story whose
 * graph has no terminal route is therefore not startable near (or before) the
 * term; content validation is still responsible for diagnosing the malformed
 * graph itself.
 */
export function minimumArcYears(arc: ArcDef): number {
  const nodes = new Map(arc.nodes.map((n) => [n.id, n]));

  const from = (nodeId: string, visiting: ReadonlySet<string>): number => {
    const node = nodes.get(nodeId);
    if (!node) return 0; // Runtime treats a missing successor as an ending.
    if (!node.successors.length) return 0;
    if (visiting.has(nodeId)) return Number.POSITIVE_INFINITY;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);

    let best = Number.POSITIVE_INFINITY;
    for (const successor of node.successors) {
      if (successor.to === 'end') {
        best = Math.min(best, 0);
        continue;
      }
      const next = nodes.get(successor.to);
      if (!next) {
        best = Math.min(best, 0);
        continue;
      }
      const tail = from(next.id, nextVisiting);
      best = Math.min(best, minimumScheduleYears(next.schedule) + tail);
    }
    return best;
  };

  const entry = nodes.get(arc.entry);
  const entryDelay = arc.inline && entry ? minimumScheduleYears(entry.schedule) : 0;
  return entryDelay + from(arc.entry, new Set());
}
