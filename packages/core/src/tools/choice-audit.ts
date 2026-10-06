/**
 * What every authored choice can change (issue #266).
 *
 *   npm run audit:choices
 *   npm run audit:choices -- --json   # #334's deterministic debt worklist
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * PHASE-B WORKLIST (#334).
 *
 * The audit can prove that a memory key is unread; it cannot decide whether
 * the story should later read it or whether the write should disappear. That
 * is a content decision, so this worklist records provenance rather than
 * guessing a classification. A later content slice can make the choice with
 * the exact event/outcome and source file in hand.
 */
export interface ChoiceWorklistWriter {
  where: string;
  file: string;
}

export type ChoiceDebtDisposition = 'read' | 'delete' | 'self_expression';

export interface ChoiceMemoryDecision {
  kind: ChoiceAudit['writeOnly'][number]['kind'];
  key: string;
  disposition: ChoiceDebtDisposition;
  reason: string;
}

export interface ChoiceDecisionFile {
  version: 1;
  memory: ChoiceMemoryDecision[];
}

export interface ChoiceWorklistMemory {
  kind: ChoiceAudit['writeOnly'][number]['kind'];
  key: string;
  writers: ChoiceWorklistWriter[];
  decision?: Pick<ChoiceMemoryDecision, 'disposition' | 'reason'>;
}

export interface ChoiceWorklistProseOnly {
  event: string;
  choice: string;
  decider: ChoiceRow['decider'];
  file: string;
}

export interface ChoiceWorklistFile {
  file: string;
  memory: {
    kind: ChoiceAudit['writeOnly'][number]['kind'];
    key: string;
    writers: string[];
    decision?: Pick<ChoiceMemoryDecision, 'disposition' | 'reason'>;
  }[];
  proseOnly: {
    event: string;
    choice: string;
    decider: ChoiceRow['decider'];
  }[];
}

export interface ChoiceWorklist {
  version: 1;
  summary: {
    writeOnlyKeys: number;
    writeOnlyWrites: number;
    classifiedWriteOnlyKeys: number;
    unclassifiedWriteOnlyKeys: number;
    proseOnly: number;
    files: number;
  };
  /** One row per unread memory key, with every writer and its source file. */
  memory: ChoiceWorklistMemory[];
  /** The untagged choices whose only consequence is prose/write-only memory. */
  proseOnly: ChoiceWorklistProseOnly[];
  /** The same debt regrouped for one-file-at-a-time content slices. */
  files: ChoiceWorklistFile[];
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

const EMPTY_DECISIONS: ChoiceDecisionFile = { version: 1, memory: [] };

function decisionKey(kind: ChoiceMemoryDecision['kind'], key: string): string {
  return `${kind}\u0000${key}`;
}

function decisionMapFor(audit: ChoiceAudit, decisions: ChoiceDecisionFile) {
  if (decisions === null || typeof decisions !== 'object') {
    throw new Error('invalid choice decision file: expected an object');
  }
  if (decisions.version !== 1) throw new Error(`unsupported choice decision file version: ${String(decisions.version)}`);
  if (!Array.isArray(decisions.memory)) {
    throw new Error('invalid choice decision file: memory must be an array');
  }

  const current = new Set(audit.writeOnly.map((item) => decisionKey(item.kind, item.key)));
  const out = new Map<string, Pick<ChoiceMemoryDecision, 'disposition' | 'reason'>>();
  for (const [index, raw] of decisions.memory.entries()) {
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`invalid choice decision at index ${index}: expected an object`);
    }
    const decision = raw as ChoiceMemoryDecision;
    if (typeof decision.kind !== 'string' || typeof decision.key !== 'string' || !decision.key.trim()) {
      throw new Error(`invalid choice decision at index ${index}: kind and key must be non-empty strings`);
    }
    if (!['read', 'delete', 'self_expression'].includes(decision.disposition)) {
      throw new Error(`invalid choice disposition for ${decision.kind}:${decision.key}: ${String(decision.disposition)}`);
    }
    if (typeof decision.reason !== 'string' || !decision.reason.trim()) {
      throw new Error(`choice decision lacks a reason: ${decision.kind}:${decision.key}`);
    }

    const key = decisionKey(decision.kind, decision.key);
    if (out.has(key)) throw new Error(`duplicate choice decision: ${decision.kind}:${decision.key}`);
    if (!current.has(key)) {
      throw new Error(`stale choice decision: ${decision.kind}:${decision.key} is not a current write-only key`);
    }
    out.set(key, { disposition: decision.disposition, reason: decision.reason.trim() });
  }
  return out;
}

export function loadChoiceDecisions(
  path = join(import.meta.dirname, 'choice-decisions.json'),
): ChoiceDecisionFile {
  return JSON.parse(readFileSync(path, 'utf8')) as ChoiceDecisionFile;
}

export function choiceWorklist(
  content: Content,
  decisions: ChoiceDecisionFile = EMPTY_DECISIONS,
): ChoiceWorklist {
  const audit = auditChoices(content);
  const decisionMap = decisionMapFor(audit, decisions);

  const memory: ChoiceWorklistMemory[] = audit.writeOnly.map((item) => ({
    kind: item.kind,
    key: item.key,
    writers: item.writers
      .map((where) => ({ where, file: fileOf(where, content) }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.where.localeCompare(b.where)),
    ...(decisionMap.has(decisionKey(item.kind, item.key))
      ? { decision: decisionMap.get(decisionKey(item.kind, item.key))! }
      : {}),
  }));

  const proseOnly: ChoiceWorklistProseOnly[] = audit.rows
    .filter(isProseOnly)
    .map((row) => ({
      event: row.event,
      choice: row.choice,
      decider: row.decider,
      file: fileOf(`event:${row.event}`, content),
    }))
    .sort((a, b) => a.file.localeCompare(b.file)
      || a.event.localeCompare(b.event)
      || a.choice.localeCompare(b.choice));

  const byFile = new Map<string, ChoiceWorklistFile>();
  const fileRow = (file: string): ChoiceWorklistFile => {
    const existing = byFile.get(file);
    if (existing) return existing;
    const made: ChoiceWorklistFile = { file, memory: [], proseOnly: [] };
    byFile.set(file, made);
    return made;
  };

  for (const item of memory) {
    const writers = groupBy(item.writers, (writer) => writer.file);
    for (const [file, sourceWriters] of writers) {
      fileRow(file).memory.push({
        kind: item.kind,
        key: item.key,
        writers: sourceWriters.map((writer) => writer.where).sort(),
        ...(item.decision ? { decision: item.decision } : {}),
      });
    }
  }
  for (const row of proseOnly) {
    fileRow(row.file).proseOnly.push({
      event: row.event,
      choice: row.choice,
      decider: row.decider,
    });
  }

  const files = [...byFile.values()]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((row) => ({
      ...row,
      memory: row.memory.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
      proseOnly: row.proseOnly.sort((a, b) => a.event.localeCompare(b.event) || a.choice.localeCompare(b.choice)),
    }));

  return {
    version: 1,
    summary: {
      writeOnlyKeys: memory.length,
      writeOnlyWrites: memory.reduce((sum, item) => sum + item.writers.length, 0),
      classifiedWriteOnlyKeys: memory.filter((item) => item.decision !== undefined).length,
      unclassifiedWriteOnlyKeys: memory.filter((item) => item.decision === undefined).length,
      proseOnly: proseOnly.length,
      files: files.length,
    },
    memory,
    proseOnly,
    files,
  };
}

/** Byte-stable JSON for agents and one-file-at-a-time #334 content slices. */
export function renderChoiceWorklistJson(
  content: Content,
  decisions: ChoiceDecisionFile = EMPTY_DECISIONS,
): string {
  return JSON.stringify(choiceWorklist(content, decisions), null, 2) + '\n';
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
  const content = loadContent(undefined, sources);
  process.stdout.write(process.argv.includes('--json')
    ? renderChoiceWorklistJson(content, loadChoiceDecisions())
    : renderChoiceAudit(content));
}
