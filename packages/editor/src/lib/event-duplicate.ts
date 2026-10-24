import type { ContentBundle, EventTemplate, Outcome } from '@ed/schema';
import { EventTemplateS, validateBundle } from '@ed/schema';

/**
 * A duplicate is a NEW standalone authored event, never a silent edit to a
 * linked arc or an inline follow-up. Use authored data, not the compiled
 * `Content.events` view, which synthesises arc bindings.
 */
export function eventBackreferences(bundle: ContentBundle, id: string): string[] {
  const references: string[] = [];
  for (const arc of bundle.arcs) {
    for (const node of arc.nodes) {
      if (node.event === id) references.push(`arc ${arc.id}/${node.id}`);
    }
  }
  for (const event of bundle.events) {
    const groups = event.interaction.kind === 'narration'
      ? [{ id: 'narration', outcomes: event.interaction.outcomes }]
      : event.interaction.choices;
    for (const group of groups) for (const outcome of group.outcomes) {
      const from = `event ${event.id}/${group.id}/${outcome.id}`;
      if (outcome.next?.event === id) references.push(`${from}: next`);
      if (outcome.primordial?.next?.event === id) references.push(`${from}: primordial next`);
    }
  }
  // Schema-backed references can occur in more than the two familiar
  // authoring shapes above: effects such as `schedule` also name an event,
  // including in Record choices and primordial bundles. Traverse the authored
  // object tree and recognise literal `event` fields, instead of keeping a
  // second hand-maintained list of effect kinds and nested locations.
  const seen = new Set<object>();
  function scan(value: unknown, path: string): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, nested] of Object.entries(value)) {
      const at = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (key === 'event' && nested === id) {
        // The arc node and next links above have a friendlier explanation.
        if (!/\\.nodes\\[\\d+\\]$/.test(path) && !path.endsWith('.next')) {
          references.push(`event reference ${at}`);
        }
      } else {
        scan(nested, at);
      }
    }
  }
  scan(bundle, 'bundle');
  return [...new Set(references)];
}

/**
 * A deletion must not tear a hole in the authored graph, including the
 * source's own outgoing substory links and prose counterparts.
 * `recordByChoice` and `recordByOutcome` are owned BY this event; they are
 * removed with it rather than being dangling references from another event.
 */
export function eventDeletionBlockers(bundle: ContentBundle, id: string): string[] {
  const source = bundle.events.find((event) => event.id === id);
  if (!source) return [`Unknown event '${id}'`];
  const blocked = eventBackreferences(bundle, id);
  if (source.arc) blocked.push(`arc binding ${source.arc.of}/${source.arc.node}`);
  const groups = source.interaction.kind === 'narration'
    ? [{ id: 'narration', outcomes: source.interaction.outcomes }]
    : source.interaction.choices;
  for (const group of groups) for (const outcome of group.outcomes) {
    const path = `${group.id}/${outcome.id}`;
    if (outcome.next) blocked.push(`inline follow-up ${path}`);
    if (outcome.primordial?.next) blocked.push(`primordial follow-up ${path}`);
    if (outcome.triggers) blocked.push(`arc trigger ${path}`);
    if (outcome.primordial?.triggers) blocked.push(`primordial arc trigger ${path}`);
  }
  for (const variant of bundle.proseVariants) {
    if (variant.address.includes(id)) blocked.push(`Plain English counterpart ${variant.address}`);
  }
  return [...new Set(blocked)];
}

export function suggestedDuplicateId(bundle: ContentBundle, source: EventTemplate): string {
  const existing = new Set(bundle.events.map((e) => e.id));
  const stem = `${source.id}_copy`;
  let proposed = stem;
  let n = 2;
  while (existing.has(proposed)) proposed = `${stem}_${n++}`;
  return proposed;
}

export type DraftDuplicateResult = { ok: true; event: EventTemplate } | { ok: false; error: string };

export function duplicateEventDraft(bundle: ContentBundle, source: EventTemplate, rawId: string): DraftDuplicateResult {
  const id = rawId.trim();
  if (!/^[a-z0-9_]+$/.test(id)) return { ok: false, error: 'Use a new snake_case event ID.' };
  if (bundle.events.some((event) => event.id === id)) return { ok: false, error: `Event '${id}' already exists.` };

  const refs = eventBackreferences(bundle, source.id);
  if (refs.length) return { ok: false, error: `This event is referenced by ${refs.join(', ')}. Review those links before duplicating.` };
  if (source.arc) return { ok: false, error: 'An arc-bound event must be duplicated as part of its substory.' };

  const groups = source.interaction.kind === 'narration'
    ? [{ outcomes: source.interaction.outcomes }] : source.interaction.choices;
  if (groups.some((group) => group.outcomes.some((o: Outcome) => o.next || o.primordial?.next))) {
    return { ok: false, error: 'This event has an inline follow-up; duplicate its whole substory instead.' };
  }

  // Plain JSON is intentional: no Vue proxies, shared references or runtime
  // Zod metadata should be carried into the new independently editable event.
  const event = JSON.parse(JSON.stringify(source)) as EventTemplate;
  event.id = id;
  event.title = `${source.title} (copy)`;
  if (event.rumour) event.rumour.id = `${id}_rumour`;

  const renameDiscrepancy = (record: EventTemplate['record']) => {
    if (record) record.options.embellish.discrepancy.id = `${id}_${record.options.embellish.discrepancy.id}`;
  };
  renameDiscrepancy(event.record);
  for (const record of event.recordByChoice ?? []) renameDiscrepancy(record);
  for (const record of event.recordByOutcome ?? []) renameDiscrepancy(record);

  const parsed = EventTemplateS.safeParse(event);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid event copy.' };

  // Also enforce cross-document rules BEFORE createItem writes the copy.
  // Compare newly introduced diagnostics, not existing authored warnings.
  const before = new Set(validateBundle(bundle).filter((issue) => issue.level === 'error')
    .map((issue) => JSON.stringify([issue.rule, issue.where, issue.message])));
  const candidate = { ...bundle, events: [...bundle.events, parsed.data] };
  const added = validateBundle(candidate).filter((issue) => issue.level === 'error'
    && !before.has(JSON.stringify([issue.rule, issue.where, issue.message])));
  if (added.length) return { ok: false, error: `Copy fails ${added[0]!.rule}: ${added[0]!.message}` };
  return { ok: true, event: parsed.data };
}
