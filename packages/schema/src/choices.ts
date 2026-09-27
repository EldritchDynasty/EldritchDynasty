import type { Content } from './content-index.js';
import type { Effect, EventTemplate, Outcome } from './event.js';
import { deciderKind, type DeciderKind } from './decider.js';
import { assertNever } from './exhaustive.js';
import { isInlineArcId } from './desugar.js';

/**
 * WHAT A CHOICE CAN CHANGE (issue #266).
 *
 * The audience this game is for notices when it offers a decision and then
 * ignores it, and that failure is silent: a choice whose effect nothing reads
 * still validates, still fires, and still looks like a working decision. This
 * is the instrument that counts them — pure static analysis over the indexed
 * content, so inline `next` chains are already compiled into real arcs and no
 * game is played.
 *
 * It lives in `schema` rather than `core/tools` because the rule that enforces
 * it (`choices/consequence`, in `rules.ts`) lives here, and `schema` cannot
 * import `core`.
 */

/** What an effect, or a choice, can touch. A choice's set is the union over its outcomes. */
export type ChoiceCategory =
  | 'persistent'       // changes a person, a holding or a lineage for good
  | 'people'           // changes who is in the house, or who is cast
  | 'relationship'     // sentiment and grudges
  | 'record'           // the chronicle, Discrepancies, rumours, the Ledger
  | 'resources'        // treasury and Respect
  | 'eligibility'      // memory that some condition somewhere reads
  | 'callback'         // a later beat depends on this choice
  | 'write_only'       // memory that nothing reads (invariant 11)
  | 'self_expression'; // declared prose-only on purpose, by outcome tag

/**
 * The outcome tag that says "this option changes nothing, and that is the
 * point". A tag rather than a schema field so the closed `ChoiceS` shape does
 * not move; a choice is self-expression only when EVERY outcome carries it.
 */
export const SELF_EXPRESSION_TAG = 'self_expression';

export interface ChoiceRow {
  event: string;
  choice: string;
  decider: DeciderKind;
  categories: ChoiceCategory[];
  signature: string;
}

export type MemoryKind = 'flag' | 'knowledge' | 'arc_flag';

export interface WriteOnlyKey {
  key: string;
  kind: MemoryKind;
  /** `event:<id>/<outcome>`, or `event:<id>/record` for a Record block's grant. Sorted. */
  writers: string[];
}

export interface ChoiceAudit {
  rows: ChoiceRow[];
  converging: { event: string; choices: string[] }[];
  writeOnly: WriteOnlyKey[];
  /** Every memory key some condition reads, by kind. */
  read: Record<MemoryKind, string[]>;
  /** Every memory key some content writes, by kind. */
  written: Record<MemoryKind, string[]>;
  /** Knowledge keys a Record block grants, apart from those a `knowledge` effect grants. */
  knowledgeSources: { record: string[]; effect: string[] };
}

/**
 * THE CATEGORY MAP, over every `Effect` kind.
 *
 * Exhaustive by construction: a thirtieth kind fails to compile here until
 * somebody says what it changes. `memory` is not a category of its own — it
 * resolves to `eligibility` or `write_only` depending on whether anything reads
 * the key, which only the whole bundle can say.
 */
export function categoryOf(kind: Effect['kind']): ChoiceCategory | 'memory' {
  switch (kind) {
    case 'attribute':
    case 'trait':
    case 'status':
    case 'madness':
    case 'career':
    case 'bond':
    case 'marriage':
    case 'heirloom':
    case 'spellbook':
    case 'land':
    case 'muster':
    case 'rite':
    case 'forge_lineage':
    case 'tutor':
      return 'persistent';
    case 'branch':
    case 'recast':
    case 'priorityMatch':
      return 'people';
    case 'relationship':
      return 'relationship';
    case 'chronicle':
    case 'discrepancy':
    case 'rumour':
    case 'clause':
      return 'record';
    case 'treasury':
    case 'respect':
      return 'resources';
    case 'schedule':
    case 'arc':
      return 'callback';
    case 'flag':
    case 'knowledge':
    case 'arc_flag':
      return 'memory';
    default:
      return assertNever(kind, 'effect kind');
  }
}

/** Keys sorted at every depth, so two equal values always serialise the same way. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** An arc successor, as the engine consults it: where it goes, under what guard, at what odds. */
export interface SuccessorShape { to: string; when?: unknown; weight: number }

/**
 * WHAT ONE OUTCOME DOES, by its mechanics and never by its identity.
 *
 * In: everything the engine acts on. `weight`, because `pickOutcome` draws on
 * it. `tags`, because outcome-weight modifiers and successors' `fromTag` read
 * them. `effects` IN AUTHORED ORDER, because `applyOutcome` applies them in
 * that order and `flag x=true; flag x=false` is not its own reverse. `next` as
 * event + schedule + kept slots. An authored `triggers`, and the successors
 * this outcome would take, each as target + guard + weight, with multiplicity.
 *
 * Out: the outcome's id and text, and the trigger `desugar.ts` adds for an
 * inline `next` — its arc id is `inline_<event>__<outcome>`, which is the
 * outcome's identity again, and the `next` already says what it does.
 * (Review of #281: including it made two identical callbacks differ by name,
 * and reducing successors to their target made a guarded route and an
 * unguarded one look the same.)
 */
export function outcomeSignature(o: Outcome, routes: readonly SuccessorShape[] = []): string {
  return stable({
    weight: o.weight,
    tags: [...o.tags].sort(),
    effects: o.effects.map(stable),
    next: o.next && { event: o.next.event, after: o.next.after, keep: [...o.next.keep].sort() },
    triggers: o.triggers && !isInlineArcId(o.triggers.arc) ? o.triggers : undefined,
    routes: routes.map((r) => stable({ to: r.to, when: r.when, weight: r.weight })).sort(),
  });
}

/**
 * WHAT A SET OF OUTCOMES DOES, as one comparable string: `outcomeSignature`
 * over each, order-free across outcomes because they are alternatives, not a
 * sequence. Exported for #271. That issue wants a coarser grain (effect kinds,
 * odds ignored), and should build it on top of this rather than loosen it,
 * because the convergence error needs exact.
 */
export function effectSignature(outcomes: readonly Outcome[], routesOf: (o: Outcome) => readonly SuccessorShape[] = () => []): string {
  return stable(outcomes.map((o) => outcomeSignature(o, routesOf(o))).sort());
}

/**
 * Every condition-shaped object in the bundle — no `kind` key, which is what
 * separates `{ flag: x }` the condition from `{ kind: 'flag', flag: x }` the
 * effect. Walking structurally rather than listing the fields that carry
 * conditions means a condition added somewhere new (a clause, a character
 * template, a successor) is counted without this file having to hear about it.
 */
function collectReaders(roots: unknown[]): Record<MemoryKind, Set<string>> {
  const read: Record<MemoryKind, Set<string>> = { flag: new Set(), knowledge: new Set(), arc_flag: new Set() };
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (!('kind' in o)) {
      if (typeof o.flag === 'string') read.flag.add(o.flag);
      if (typeof o.knowledge === 'string') read.knowledge.add(o.knowledge);
      if (typeof o.arcFlag === 'string') read.arc_flag.add(o.arcFlag);
    }
    for (const x of Object.values(o)) walk(x);
  };
  roots.forEach(walk);
  return read;
}

function memoryOf(eff: Effect): { kind: MemoryKind; key: string } | undefined {
  if (eff.kind === 'flag') return { kind: 'flag', key: eff.flag };
  if (eff.kind === 'knowledge') return { kind: 'knowledge', key: eff.flag };
  if (eff.kind === 'arc_flag') return { kind: 'arc_flag', key: eff.flag };
  return undefined;
}

/** The effects an event can apply outside its choices: narration outcomes and its Record block. */
function everyWrite(e: EventTemplate, fn: (eff: Effect, where: string) => void): void {
  const outcomes = e.interaction.kind === 'narration'
    ? e.interaction.outcomes
    : e.interaction.choices.flatMap((c) => c.outcomes);
  for (const o of outcomes) for (const eff of o.effects) fn(eff, `event:${e.id}/${o.id}`);
  if (e.record) {
    for (const key of ['record', 'omit', 'embellish'] as const) {
      for (const eff of e.record.options[key].effects) fn(eff, `event:${e.id}/record`);
    }
  }
}

const CATEGORY_ORDER: readonly ChoiceCategory[] = [
  'persistent', 'people', 'relationship', 'record', 'resources',
  'eligibility', 'callback', 'write_only', 'self_expression',
];

export function auditChoices(content: Content): ChoiceAudit {
  // ── Memory: who writes each key, and whether anything reads it ──────────
  const readers = collectReaders([content.bundle, content.events, content.arcs]);
  const writers: Record<MemoryKind, Map<string, Set<string>>> = {
    flag: new Map(), knowledge: new Map(), arc_flag: new Map(),
  };
  const grantedByRecord = new Set<string>();
  const grantedByEffect = new Set<string>();
  const wrote = (kind: MemoryKind, key: string, where: string) => {
    const m = writers[kind];
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(where);
  };
  for (const e of content.events) {
    everyWrite(e, (eff, where) => {
      const mem = memoryOf(eff);
      if (!mem) return;
      wrote(mem.kind, mem.key, where);
      if (mem.kind === 'knowledge') grantedByEffect.add(mem.key);
    });
    const granted = e.record?.options.record.grantsKnowledge;
    if (granted) {
      wrote('knowledge', granted, `event:${e.id}/record`);
      grantedByRecord.add(granted);
    }
  }
  const isRead = (kind: MemoryKind, key: string) => readers[kind].has(key);

  // ── Callbacks: arc successors that branch on this event's choices ───────
  // A successor with no `from*` fires whatever was chosen, so it makes no
  // choice matter more than another and is not counted.
  const successorsOf = new Map<string, (SuccessorShape & { fromChoice?: string; fromOutcome?: string; fromTag?: string })[]>();
  for (const arc of content.arcs) {
    for (const n of arc.nodes) {
      const list = successorsOf.get(n.event) ?? [];
      for (const s of n.successors) {
        if (s.fromChoice || s.fromOutcome || s.fromTag) list.push(s);
      }
      successorsOf.set(n.event, list);
    }
  }

  const rows: ChoiceRow[] = [];
  const converging: ChoiceAudit['converging'] = [];

  for (const e of content.events) {
    if (e.tier === 'frame' || e.interaction.kind === 'narration') continue;
    const decider = deciderKind(e.interaction.decidedBy);
    const succ = successorsOf.get(e.id) ?? [];
    const bySignature = new Map<string, string[]>();

    for (const c of e.interaction.choices) {
      const cats = new Set<ChoiceCategory>();
      const routes = new Map<Outcome, SuccessorShape[]>();
      for (const o of c.outcomes) {
        for (const eff of o.effects) {
          const cat = categoryOf(eff.kind);
          if (cat !== 'memory') { cats.add(cat); continue; }
          const mem = memoryOf(eff)!;
          cats.add(isRead(mem.kind, mem.key) ? 'eligibility' : 'write_only');
        }
        if (o.next || o.triggers) cats.add('callback');
        const taken: SuccessorShape[] = [];
        for (const s of succ) {
          if (s.fromChoice !== undefined && s.fromChoice !== c.id) continue;
          if (s.fromOutcome !== undefined && s.fromOutcome !== o.id) continue;
          if (s.fromTag !== undefined && !o.tags.includes(s.fromTag)) continue;
          cats.add('callback');
          taken.push(s);
        }
        routes.set(o, taken);
      }
      if (c.outcomes.every((o) => o.tags.includes(SELF_EXPRESSION_TAG))) cats.add('self_expression');

      // `requires` decides whether the option can be taken at all, and `check`
      // which of its outcomes lands, so both are part of what it does.
      const signature = stable({
        outcomes: effectSignature(c.outcomes, (o) => routes.get(o) ?? []),
        requires: c.requires.map(stable).sort(),
        check: c.check,
      });
      rows.push({
        event: e.id,
        choice: c.id,
        decider,
        categories: CATEGORY_ORDER.filter((k) => cats.has(k)),
        signature,
      });
      const same = bySignature.get(signature) ?? [];
      same.push(c.id);
      bySignature.set(signature, same);
    }

    for (const ids of bySignature.values()) {
      if (ids.length > 1) converging.push({ event: e.id, choices: ids });
    }
  }

  const writeOnly: WriteOnlyKey[] = [];
  const kinds: MemoryKind[] = ['flag', 'knowledge', 'arc_flag'];
  for (const kind of kinds) {
    for (const [key, where] of writers[kind]) {
      if (!isRead(kind, key)) writeOnly.push({ key, kind, writers: [...where].sort() });
    }
  }
  const byKey = (a: { key: string; kind: string }, b: { key: string; kind: string }) =>
    a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key);
  writeOnly.sort(byKey);
  // By event; choices keep their authored order (the sort is stable).
  rows.sort((a, b) => a.event.localeCompare(b.event));
  converging.sort((a, b) => a.event.localeCompare(b.event));

  const sortedKeys = (m: Map<string, unknown> | Set<string>) => [...m.keys()].sort();
  return {
    rows,
    converging,
    writeOnly,
    read: { flag: sortedKeys(readers.flag), knowledge: sortedKeys(readers.knowledge), arc_flag: sortedKeys(readers.arc_flag) },
    written: { flag: sortedKeys(writers.flag), knowledge: sortedKeys(writers.knowledge), arc_flag: sortedKeys(writers.arc_flag) },
    knowledgeSources: { record: sortedKeys(grantedByRecord), effect: sortedKeys(grantedByEffect) },
  };
}

/**
 * No effect at all, or only memory nothing reads — and not declared
 * self-expression. The prose differs and the Chronicle page differs
 * (`applyOutcome` writes one per outcome), but nothing else does.
 */
export function isProseOnly(row: ChoiceRow): boolean {
  return row.categories.every((c) => c === 'write_only');
}
