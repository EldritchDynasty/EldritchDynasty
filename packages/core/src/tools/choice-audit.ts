/**
 * What every authored choice can change (issue #266).
 *
 *   npm run audit:choices
 *
 * Static analysis only — `auditChoices` in `@ed/schema` reads the indexed
 * content, so inline `next` chains are compiled in, and no game is played (so
 * `lanes.test.ts` has nothing to declare). Deterministic: every list is sorted
 * and nothing is timestamped, so two runs on one commit are byte-identical and
 * two commits can be diffed.
 *
 * `choices/consequence` in `schema/src/rules.ts` turns the same audit into
 * validation issues; this prints the whole picture those issues are drawn from.
 */
import { loadContent } from '@ed/content';
import {
  auditChoices, isProseOnly, type ChoiceAudit, type ChoiceRow, type Content, type ContentSources,
} from '@ed/schema';

/**
 * What a choice changes that LASTS: its categories without write-only memory,
 * which changes nothing anyone reads, and without the self-expression
 * declaration, which is a statement about the choice rather than an effect of
 * it. The category-set and resource-only counts are taken over this, so
 * `treasury` plus an unread flag is a resource-only choice.
 */
const lasting = (r: ChoiceRow) => r.categories.filter((c) => c !== 'write_only' && c !== 'self_expression');
const setOf = (r: ChoiceRow) => lasting(r).join('+') || '(none)';
const withoutResources = (r: ChoiceRow) => r.categories.filter((c) => c !== 'resources');
const isResourceOnly = (r: ChoiceRow) => setOf(r) === 'resources';

/** Where an `event:<id>/...` reference was authored, or `(unknown)`. */
function fileOf(where: string, content: Content): string {
  const id = where.replace(/^event:/, '').split('/')[0]!;
  return content.sourceOf(id) ?? '(unknown)';
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
}

export interface ChoiceBaseline {
  events: number;
  choices: number;
  byDecider: Record<string, number>;
  converging: number;
  proseOnly: number;
  writeOnlyFlagOnly: number;
  resourceOnly: number;
  eventsAllResourceOrNothing: number;
  eventsOneCategorySet: number;
}

/** The numbers issue #266's baseline table states, in the same order. */
export function baseline(audit: ChoiceAudit): ChoiceBaseline {
  const byEvent = groupBy(audit.rows, (r) => r.event);
  const byDecider: Record<string, number> = {};
  for (const r of audit.rows) byDecider[r.decider] = (byDecider[r.decider] ?? 0) + 1;
  const events = [...byEvent.values()];
  return {
    events: byEvent.size,
    choices: audit.rows.length,
    byDecider,
    converging: audit.converging.length,
    proseOnly: audit.rows.filter(isProseOnly).length,
    writeOnlyFlagOnly: audit.rows.filter((r) => {
      const rest = withoutResources(r);
      return rest.length === 1 && rest[0] === 'write_only';
    }).length,
    resourceOnly: audit.rows.filter(isResourceOnly).length,
    eventsAllResourceOrNothing: events.filter((rs) => rs.every((r) => isResourceOnly(r) || lasting(r).length === 0)).length,
    eventsOneCategorySet: events.filter((rs) => new Set(rs.map(setOf)).size === 1).length,
  };
}

export function renderChoiceAudit(content: Content): string {
  const audit = auditChoices(content);
  const b = baseline(audit);
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const row = (label: string, n: number | string) => line(`  ${label.padEnd(66)} ${String(n).padStart(5)}`);

  line('CHOICE AUDIT (issue #266) — static, no games played');
  line();
  const deciders = Object.entries(b.byDecider).sort(([x], [y]) => x.localeCompare(y))
    .map(([k, n]) => `${n} ${k}`).join(', ');
  row('choice / dispatch events (frame excluded)', b.events);
  row(`choices on them (${deciders})`, b.choices);
  row('converging pairs: identical effects and callbacks', b.converging);
  row('prose-only: no effect, or only write-only memory', b.proseOnly);
  row('only non-resource effect is write-only memory', b.writeOnlyFlagOnly);
  row('resource-only: treasury / respect and nothing else', b.resourceOnly);
  row('events where every choice is resource-only or nothing', b.eventsAllResourceOrNothing);
  row('events whose choices all touch the same category set', b.eventsOneCategorySet);

  line();
  line('CATEGORY SETS — what a choice changes that lasts (write-only memory left out)');
  const sets = groupBy(audit.rows, setOf);
  for (const [set, rs] of [...sets].sort(([x, a], [y, c]) => c.length - a.length || x.localeCompare(y))) {
    row(set, rs.length);
  }

  line();
  line('MEMORY — written by content / read by any condition');
  const readSet = {
    flag: new Set(audit.read.flag),
    knowledge: new Set(audit.read.knowledge),
    arc_flag: new Set(audit.read.arc_flag),
  };
  const readOf = (kind: keyof typeof readSet, keys: string[]) => keys.filter((k) => readSet[kind].has(k));
  const mem = (label: string, kind: keyof typeof readSet, keys: string[]) => {
    const r = readOf(kind, keys);
    line(`  ${label.padEnd(38)} ${String(keys.length).padStart(4)} written  ${String(r.length).padStart(3)} read${r.length ? `  (${r.join(', ')})` : ''}`);
  };
  mem('world flag', 'flag', audit.written.flag);
  mem('knowledge via Record grantsKnowledge', 'knowledge', audit.knowledgeSources.record);
  mem('knowledge via effect', 'knowledge', audit.knowledgeSources.effect);
  mem('arc_flag', 'arc_flag', audit.written.arc_flag);

  line();
  line('PER FILE — choices · prose-only · resource-only · write-only keys first written here');
  const writeOnlyByFile = groupBy(audit.writeOnly, (w) => fileOf(w.writers[0]!, content));
  const files = groupBy(audit.rows, (r) => fileOf(`event:${r.event}`, content));
  const allFiles = [...new Set([...files.keys(), ...writeOnlyByFile.keys()])].sort();
  for (const f of allFiles) {
    const rs = files.get(f) ?? [];
    line(`  ${f.padEnd(48)} ${String(rs.length).padStart(4)} ${String(rs.filter(isProseOnly).length).padStart(4)} ${String(rs.filter(isResourceOnly).length).padStart(4)} ${String(writeOnlyByFile.get(f)?.length ?? 0).padStart(4)}`);
  }

  line();
  line(`CONVERGING (${audit.converging.length})`);
  for (const c of audit.converging) line(`  ${c.event}: ${c.choices.join(' = ')}`);

  line();
  const prose = audit.rows.filter(isProseOnly);
  line(`PROSE-ONLY (${prose.length}) — give each a cost or a remembered consequence, or tag it self_expression`);
  for (const r of prose) line(`  ${r.event}/${r.choice}${r.decider === 'player' ? '' : `  [${r.decider}]`}`);

  line();
  line(`WRITE-ONLY MEMORY (${audit.writeOnly.length}) — author a reader, or delete the write`);
  for (const [f, ws] of writeOnlyByFile) {
    line(`  ${f}`);
    for (const w of ws) line(`    ${w.kind.padEnd(9)} ${w.key}  ← ${w.writers.join(', ')}`);
  }
  return out.join('\n') + '\n';
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('choice-audit.ts');
if (isMain) {
  const sources: ContentSources = new Map();
  process.stdout.write(renderChoiceAudit(loadContent(undefined, sources)));
}
