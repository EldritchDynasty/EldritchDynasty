import type { ArcDef, ArcNode } from './arc.js';
import type { EventTemplate, Outcome } from './event.js';

/**
 * INLINE FOLLOW-UPS, COMPILED TO ARCS.
 *
 * There are two ways to author a tree of events and there is exactly one thing
 * that runs one.
 *
 * An `ArcDef` is the full instrument: named nodes, guarded successors, a cast
 * that outlives the people in it, three hundred years of it. It is also a
 * two-file binding maintained by hand — the node table in `arcs/*.yaml` and an
 * `arc: { of, node }` block on every event that is one of its nodes — and for
 * the very common case of "and then, forty years later, this" it is far more
 * ceremony than the scene is worth. Authors were writing two unrelated events
 * and a `schedule` effect instead, which loses the cast: the follow-up recast
 * itself from scratch and the man the first scene was about was not in it.
 *
 * So `Outcome.next` is sugar, and this is where the sugar dissolves. Each chain
 * of `next` links becomes a real `ArcDef` with real nodes, and the root outcome
 * gains the `triggers: { arc, op: 'start' }` that `commitOutcome` already knows
 * how to honour — seeding the new instance's bindings from the cast the root
 * event actually resolved against, which is the whole point of `keep`.
 *
 * The root event is deliberately NOT a node of the arc it starts. It keeps
 * drawing from the ambient pool like any other event; only the follow-ups leave
 * it, and they leave it because `ambientPool` skips anything carrying an `arc`
 * block. That asymmetry is the design: the first beat is an event, and
 * everything after it is a consequence.
 *
 * WHERE THIS RUNS. `indexContent`, which every consumer goes through —
 * `bootstrap`, `validateBundle`, and the editor's `App.vue`. It writes into
 * `Content.arcs` and `Content.events` and never into `Content.bundle`, so the
 * authored bundle stays authored: the editor's write-back cannot serialise a
 * compiled arc back to YAML, and the arc editor can render compiled arcs
 * read-only by asking one field.
 */

/** Compiled arcs and their nodes wear this, so a second pass can recognise its own work. */
export const INLINE_ARC_PREFIX = 'inline_';

/** Stable id for an inline arc compiled from one root outcome. */
export function inlineArcId(rootEventId: string, outcomeId: string): string {
  return `${INLINE_ARC_PREFIX}${rootEventId}__${outcomeId}`;
}

export function isInlineArcId(id: string): boolean {
  return id.startsWith(INLINE_ARC_PREFIX);
}

export interface Desugared {
  events: EventTemplate[];
  arcs: ArcDef[];
}

/**
 * IDEMPOTENT. `indexContent` is called on already-indexed content in a dozen
 * places (`validateBundle(content)`, `bootstrap(content)`, the editor on every
 * render), and compiling the same chain twice would produce two arcs racing to
 * tell one story. Recognising its own output by prefix is cheaper and more
 * honest than asking callers to remember which shape they hold.
 */
export function desugarInline(events: EventTemplate[], arcs: ArcDef[]): Desugared {
  // A chain has ONE root, and it is the beat nothing else leads to. Every event
  // in `a -> b -> c` carries a `next`, so "has a next" is not the test — it
  // would compile three overlapping arcs for one three-beat story, and `b`
  // would be a node of two of them.
  //
  // A chain that is wholly a cycle (`a -> b -> a`) has no root and compiles to
  // nothing, which is correct: there is no beat the ambient pool could ever
  // start it from.
  const followUps = new Set(events.flatMap((e) => outcomesOf(e, true).flatMap((o) => (o.next ? [o.next.event] : []))));
  const roots = events.filter((e) => !followUps.has(e.id) && outcomesOf(e, true).some((o) => o.next));
  if (!roots.length) return { events, arcs };

  const already = new Set(arcs.filter((a) => a.inline).map((a) => a.id));
  const byId = new Map(events.map((e) => [e.id, e]));
  /** Event id -> the `arc` block it must carry. Applied in one pass at the end. */
  const nodeOf = new Map<string, { of: string; node: string }>();
  /** Root event id -> outcome id -> the arc that outcome starts. */
  const starts = new Map<string, Map<string, string>>();
  const compiled: ArcDef[] = [];

  for (const root of roots) {
    for (const outcome of outcomesOf(root, true)) {
      if (!outcome.next) continue;
      const normal = outcomesOf(root).find(o => o.primordial?.id === outcome.id
        && o.next && JSON.stringify(o.next) === JSON.stringify(outcome.next));
      const arcId = inlineArcId(root.id, normal?.id ?? outcome.id);
      if (normal) {
        const perOutcome = starts.get(root.id) ?? new Map<string, string>();
        perOutcome.set(outcome.id, arcId);
        starts.set(root.id, perOutcome);
        continue;
      }
      if (already.has(arcId)) continue;

      const chain = walk(root, outcome, byId);
      if (!chain.nodes.length) continue;      // a `next` naming nothing; `arcs/wiring` says so

      compiled.push({
        id: arcId,
        title: `${root.title} — what came of it`,
        entry: chain.nodes[0]!.id,
        nodes: chain.nodes,
        bindings: [...chain.bindings],
        maxConcurrentInstances: 1,
        inline: true,
      });
      for (const [eventId, nodeId] of chain.nodeOf) nodeOf.set(eventId, { of: arcId, node: nodeId });

      const perOutcome = starts.get(root.id) ?? new Map<string, string>();
      perOutcome.set(outcome.id, arcId);
      starts.set(root.id, perOutcome);
    }
  }

  if (!compiled.length) return { events, arcs };

  const rewritten = events.map((e) => {
    const asNode = nodeOf.get(e.id);
    const rootStarts = starts.get(e.id);
    if (!asNode && !rootStarts) return e;
    return {
      ...e,
      ...(asNode ? { arc: asNode } : {}),
      ...(rootStarts ? { interaction: withTriggers(e, rootStarts) } : {}),
    };
  });

  return { events: rewritten, arcs: [...arcs, ...compiled] };
}

/**
 * Follow the `next` links from one outcome to the end of the chain, one node
 * per event. Guarded against a cycle (`a.next -> b`, `b.next -> a`) by refusing
 * to place an event twice: the second reference becomes a successor pointing at
 * the node that is already there, which is a loop the arc runtime handles
 * perfectly well and an author may even have meant.
 */
function walk(
  root: EventTemplate,
  from: Outcome,
  byId: Map<string, EventTemplate>,
): { nodes: ArcNode[]; bindings: Set<string>; nodeOf: Map<string, string> } {
  const nodes: ArcNode[] = [];
  const bindings = new Set<string>();
  const nodeOf = new Map<string, string>();

  /** [the outcome carrying the `next`, the node that outcome belongs to (or null for the root)]. */
  let frontier: [Outcome, ArcNode | null][] = [[from, null]];
  let guard = 0;

  while (frontier.length && guard++ < 32) {
    const nextFrontier: [Outcome, ArcNode | null][] = [];

    for (const [outcome, parent] of frontier) {
      const link = outcome.next;
      if (!link) continue;
      const target = byId.get(link.event);
      if (!target) continue;                  // `arcs/wiring` reports it; do not compile a dangling node

      for (const slot of link.keep) bindings.add(slot);

      const existing = nodeOf.get(target.id);
      if (existing !== undefined) {
        // A loop, or two branches converging on the same scene. Point at the
        // node already placed rather than placing a second copy of it.
        if (parent) parent.successors.push(successorFor(outcome, existing));
        continue;
      }

      const node: ArcNode = {
        id: target.id,
        event: target.id,
        selection: 'first_match',
        successors: [],
        schedule: link.after,
      };
      nodes.push(node);
      nodeOf.set(target.id, node.id);
      if (parent) parent.successors.push(successorFor(outcome, node.id));

      for (const o of outcomesOf(target, true)) if (o.next) nextFrontier.push([o, node]);
    }
    frontier = nextFrontier;
  }

  // Anything with no successor of its own ends the story, explicitly. An empty
  // `successors` list already means `end` in `chooseSuccessor`; saying it out
  // loud is what makes the compiled arc readable in the editor's graph.
  for (const n of nodes) if (!n.successors.length) n.successors.push({ to: 'end', weight: 100 });

  void root;
  return { nodes, bindings, nodeOf };
}

/**
 * The link's own guard. `fromOutcome` is what carried the `next`, so a scene
 * with four endings and a follow-up on one of them advances on that one only.
 */
function successorFor(outcome: Outcome, to: string) {
  return { to, fromOutcome: outcome.id, weight: 100 };
}

/** Every outcome an event can produce, across every branch. */
export function outcomesOf(e: EventTemplate, includePrimordial = false): Outcome[] {
  const ordinary = e.interaction.kind === 'narration' ? e.interaction.outcomes : e.interaction.choices.flatMap((c) => c.outcomes);
  return includePrimordial ? [...ordinary, ...ordinary.flatMap(o => o.primordial ? [{ ...o.primordial, weight: o.weight, onlyIf: o.onlyIf }] : [])] : ordinary;
}

/**
 * Give each root outcome the `triggers` that starts its compiled arc.
 *
 * An outcome that already declares `triggers` keeps them: an author who wrote
 * both meant both, and the authored arc is the one that would be silently lost.
 * `arcs/wiring` reports the collision rather than this pass resolving it in
 * a direction nobody asked for.
 */
function withTriggers(e: EventTemplate, starts: Map<string, string>): EventTemplate['interaction'] {
  const patch = (o: Outcome): Outcome => {
    const arc = starts.get(o.id);
    const rescueArc = o.primordial ? starts.get(o.primordial.id) : undefined;
    const primordial = o.primordial && rescueArc && !o.primordial.triggers
      ? { ...o.primordial, triggers: { arc: rescueArc, op: 'start' as const } } : o.primordial;
    return { ...o, ...(primordial ? { primordial } : {}), ...(!arc || o.triggers ? {} : { triggers: { arc, op: 'start' as const } }) };
  };
  const i = e.interaction;
  if (i.kind === 'narration') return { ...i, outcomes: i.outcomes.map(patch) };
  return { ...i, choices: i.choices.map((c) => ({ ...c, outcomes: c.outcomes.map(patch) })) };
}
