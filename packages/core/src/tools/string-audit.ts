/**
 * WHERE THE PLAYER'S WORDS COME FROM (issue #276, step 3).
 *
 *   npm run audit:strings                           # the totals, by source and by voice
 *   npm run audit:strings -- --files                # and every file, largest first
 *   npm run audit:strings -- --plainenglish-worklist # #410's machine-readable narrative worklist
 *   npm run audit:strings -- --plainenglish-coverage # #615's actionable missing/stale/invalid counts
 *
 * An inventory, never a gate: it prints and exits 0. Localisation is not
 * scheduled and no language is chosen; what this answers is how much text
 * there is, where it lives, and which REGISTER each piece is written in —
 * because the register split (AGENTS.md → Skills: plain events, Dunsanian
 * frame) is the real cost driver of any translation, whatever the language.
 *
 * Every function here is pure over file text handed to it, so the test can
 * plant a file and the counts are deterministic: no clock, no RNG, no world.
 *
 * Code strings are found by a small tokenizer, not a parser. It is a count
 * that has to be stable, not a proof; what it is guaranteed not to do is
 * count a comment, an import path or an identifier as prose.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { CONTENT_PROSE_KEYS, contentInterpolationTokens, contentProseEntries, proseOriginalHash, ProseVariantS, type ProseVariant } from '@ed/schema';

export { CONTENT_PROSE_KEYS } from '@ed/schema';

/** The register a string is written in, derived from where it lives. */
export type Voice =
  | 'event'        // plain, Rothfuss: event bodies, outcomes, blurbs (rothfuss-prose)
  | 'interlude'    // a `tier: frame` event, the 1542 cut-away (lovecraftian-prose)
  | 'frame'        // endings: the frame's own closing pages
  | 'prologue'     // the signing
  | 'ledger'       // a clause, in the contract's own hand
  | 'tale'         // a nested tale, always a named and biased teller
  | 'age'          // an Age's opening blurb
  | 'adviser'      // what the advisers say at the table (`advisers.ts`)
  | 'chronicler'   // every other sentence the engine writes
  | 'interface';   // the client's own chrome

export const VOICES: readonly Voice[] = [
  'event', 'interlude', 'frame', 'prologue', 'ledger', 'tale', 'age', 'adviser', 'chronicler', 'interface',
];

export type Source = 'content' | 'core' | 'client-template' | 'client-attribute' | 'client-script';

export interface StringCount {
  source: Source;
  file: string;
  voice: Voice;
  strings: number;
  words: number;
  /** `{HEAD}`-style slots a translation has to carry across intact. */
  interpolations: number;
}

/**
 * One narrative string that needs an authored Plain English counterpart (#410).
 *
 * The address is identity, not wording. Content prefers authored `id` / `key`
 * fields over array positions so rewording a sentence cannot orphan its
 * counterpart. Code prose has no authored message ids yet, so its address is
 * the deterministic ordinal among player-facing sentence literals in that
 * source file; #412 owns the eventual runtime message-id seam.
 */
export interface PlainEnglishWorkItem {
  source: 'content' | 'core';
  file: string;
  voice: Voice;
  address: string;
  text: string;
  words: number;
  interpolations: string[];
}

/**
 * Content keys whose string values reach a player.
 *
 * `CONTENT_NOT_PROSE` is the other half, and the pair is what keeps this
 * honest: `string-audit.test.ts` fails when a content key carries multi-word
 * text and sits in neither, so a new prose field cannot join the game without
 * this inventory being told whether it counts.
 */
export const CONTENT_NOT_PROSE: ReadonlyMap<string, string> = new Map([
  ['note', 'a founding character\'s designer note (`SeedPersonS.note`); never rendered'],
  ['effect', 'a clause\'s designer note on what it changes at 1542; clauses.yaml says it is never shown'],
  ['bias', 'a tale\'s bias is an enum, and a character\'s a record of numbers'],
  ['plainenglish', 'the authored counterpart itself; it answers a work item and must not recursively create another'],
]);

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A string that reads as language rather than as an id: two words or more. */
const isProse = (s: string) => /[A-Za-z]/.test(s) && words(s) >= 2;

/** The voice of a content file's strings before any per-event override. */
export function contentVoice(file: string): Voice {
  const path = file.split(sep).join('/');
  if (path === 'prologue.yaml') return 'prologue';
  if (path === 'clauses.yaml') return 'ledger';
  if (path === 'tales.yaml') return 'tale';
  if (path === 'endings.yaml') return 'frame';
  if (path.startsWith('ages/')) return 'age';
  return 'event';
}

/**
 * Every player-facing string in one content file, grouped by voice. An event
 * carrying `tier: frame` is an interlude wherever it is filed —
 * `the_long_gallery.yaml` holds some — so the tier decides, not the file.
 */
export function auditContentFile(file: string, text: string): StringCount[] {
  const out = new Map<Voice, StringCount>();
  const add = (voice: Voice, prose: string, interpolations: number) => {
    const row = out.get(voice) ?? { source: 'content' as const, file, voice, strings: 0, words: 0, interpolations: 0 };
    row.strings++;
    row.words += words(prose);
    row.interpolations += interpolations;
    out.set(voice, row);
  };

  for (const entry of contentProseEntries(file, parse(text) as unknown)) {
    add(entry.frameTier ? 'interlude' : contentVoice(file), entry.text, entry.interpolations.length);
  }

  return VOICES.flatMap((voice) => (out.has(voice) ? [out.get(voice)!] : []));
}

/**
 * The authored-content half of #410's worklist.
 *
 * Identity is generated by @ed/schema's shared prose walker so the migration
 * audit and #414 editor cannot disagree about which field a variant answers.
 */
export function plainEnglishContentWorkItems(file: string, text: string): PlainEnglishWorkItem[] {
  return contentProseEntries(file, parse(text) as unknown).map((entry) => ({
    source: 'content' as const,
    file,
    voice: entry.frameTier ? 'interlude' : contentVoice(file),
    address: entry.address,
    text: entry.text,
    words: entry.words,
    interpolations: entry.interpolations,
  }));
}


/** Multi-word content keys the two lists above do not account for. */
export function unclassifiedContentKeys(text: string): string[] {
  const found = new Set<string>();
  const visit = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (isProse(v) && !CONTENT_PROSE_KEYS.has(key) && !CONTENT_NOT_PROSE.has(key)) found.add(key);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) visit(x, key); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(parse(text) as unknown, '');
  return [...found].sort();
}

// ── Code ────────────────────────────────────────────────────────────────────

export interface Literal {
  /** Text normalized for counting: each template interpolation is one `X`. */
  text: string;
  /** Source wording as authored between the quotes/backticks. */
  sourceText: string;
  /** Exact template interpolation tokens, in source order. */
  interpolations: string[];
  before: string;
}

/**
 * Every string and template literal in a TypeScript source, comments skipped.
 * A template's `${…}` holes become a single `X`, so `'${name} died'` is two
 * words. Nested templates inside a hole are skipped with the hole.
 */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const start = i;
      let text = '';
      let sourceText = '';
      const interpolations: string[] = [];
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          text += src[i + 1] ?? '';
          sourceText += src.slice(i, Math.min(n, i + 2));
          i += 2;
          continue;
        }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          const interpolationStart = i;
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          const interpolation = src.slice(interpolationStart, i);
          interpolations.push(interpolation);
          sourceText += interpolation;
          text += 'X';
          continue;
        }
        if (c !== '`' && src[i] === '\n') break; // an unterminated quote: a regex or a stray apostrophe
        text += src[i];
        sourceText += src[i];
        i++;
      }
      i++;
      out.push({
        text,
        sourceText,
        interpolations,
        before: src.slice(Math.max(0, start - 40), start),
      });
      continue;
    }
    i++;
  }
  return out;
}

/** Arguments to these are for a developer, not a player. */
const DEVELOPER_CALL = /(?:\bError|\bassert\w*|\bconsole\.\w+|\bdescribe|\bit|\btest|\bexpect)\s*\(\s*$/;

interface IndexedLiteral {
  literal: Literal;
  /** 1-based position among every source literal, before prose filtering. */
  ordinal: number;
}

/**
 * A literal a player could read: three words or more, and not import plumbing.
 *
 * Preserve the ordinal from the complete literal stream before filtering.
 * Otherwise rewording an earlier narrative literal so it no longer meets the
 * heuristic would renumber every later Plain English work item, even though
 * none of those later strings moved.
 */
function sentenceLiteralEntries(src: string): IndexedLiteral[] {
  return literals(src)
    .map((literal, index) => ({ literal, ordinal: index + 1 }))
    .filter(({ literal }) => /[a-z]/.test(literal.text) && words(literal.text) >= 3)
    .filter(({ literal }) => !/\b(?:import|from|require)\s*\(?\s*$/.test(literal.before))
    .filter(({ literal }) => !DEVELOPER_CALL.test(literal.before));
}

function sentenceLiteralDetails(src: string): Literal[] {
  return sentenceLiteralEntries(src).map(({ literal }) => literal);
}

export function sentenceLiterals(src: string): string[] {
  return sentenceLiteralDetails(src).map((l) => l.text);
}

export function auditCoreFile(file: string, text: string): StringCount[] {
  const found = sentenceLiterals(text);
  if (!found.length) return [];
  const voice: Voice = /(^|\/)advisers\.ts$/.test(file.split(sep).join('/')) ? 'adviser' : 'chronicler';
  return [{
    source: 'core', file, voice,
    strings: found.length,
    words: found.reduce((sum, s) => sum + words(s), 0),
    interpolations: 0,
  }];
}


/**
 * Generated narrative prose still needs a Plain English counterpart. Until the
 * runtime acquires explicit message ids (#412), identify those literals by
 * their order among player-facing sentence literals in the source file. The
 * ordinal is independent of the sentence wording itself.
 */
export function plainEnglishCoreWorkItems(file: string, text: string): PlainEnglishWorkItem[] {
  const voice: Voice = /(^|\/)advisers\.ts$/.test(file.split(sep).join('/')) ? 'adviser' : 'chronicler';
  return sentenceLiteralEntries(text).map(({ literal, ordinal }) => ({
    source: 'core',
    file,
    voice,
    address: `core:${file}#literal[${ordinal}]`,
    text: literal.sourceText,
    words: words(literal.text),
    interpolations: literal.interpolations,
  }));
}

const STATIC_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt', 'label'];

/**
 * A Vue single-file component, three ways: text between tags in the template,
 * static human-readable attributes, and sentence literals in the script.
 */
export function auditVueFile(file: string, text: string): StringCount[] {
  const template = /<template>([\s\S]*)<\/template>/.exec(text)?.[1] ?? '';
  const script = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const row = (source: Source, found: string[]): StringCount[] => (found.length
    ? [{ source, file, voice: 'interface', strings: found.length, words: found.reduce((s, x) => s + words(x), 0), interpolations: 0 }]
    : []);

  const markup = template.replace(/<!--[\s\S]*?-->/g, '');
  const nodes = [...markup.matchAll(/>([^<>]+)</g)]
    .map((m) => m[1]!.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/&[a-z]+;/g, ' ').trim())
    .filter((s) => /[A-Za-z]/.test(s));
  const attrs = [...markup.matchAll(new RegExp(`(?<![:@\\w-])(?:${STATIC_ATTRIBUTES.join('|')})="([^"]*)"`, 'g'))]
    .map((m) => m[1]!)
    .filter((s) => /[A-Za-z]/.test(s));

  return [
    ...row('client-template', nodes),
    ...row('client-attribute', attrs),
    ...row('client-script', sentenceLiterals(script)),
  ];
}

// ── The walk ────────────────────────────────────────────────────────────────

const isTest = (f: string) => /\.test\.ts$|(^|\/)testing\.ts$/.test(f);

function walk(root: string, dir: string, keep: (rel: string) => boolean, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(join(root, dir)).sort(); } catch { return out; }
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry}` : entry;
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, keep, out);
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

/** Every row the repository has, in a fixed order. `repo` is the checkout root. */
export function auditRepository(repo: string): StringCount[] {
  const content = join(repo, 'packages/content');
  const core = join(repo, 'packages/core/src');
  const client = join(repo, 'packages/client/src');
  const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
  return [
    // loci.yaml is generated genetics, not prose.
    ...walk(content, '', (f) => f.endsWith('.yaml') && f !== 'loci.yaml')
      .flatMap((f) => auditContentFile(f, read(content, f))),
    ...walk(core, '', (f) => f.endsWith('.ts') && !f.startsWith('tools/') && !f.startsWith('fixtures/') && !isTest(f))
      .flatMap((f) => auditCoreFile(f, read(core, f))),
    ...walk(client, '', (f) => f.endsWith('.vue'))
      .flatMap((f) => auditVueFile(f, read(client, f))),
    ...walk(client, '', (f) => f.endsWith('.ts') && !isTest(f))
      .flatMap((f) => auditCoreFile(f, read(client, f)).map((r) => ({ ...r, source: 'client-script' as const, voice: 'interface' as const }))),
  ];
}


/**
 * Every non-interface narrative string currently covered by `audit:strings`.
 * Kept beside `auditRepository` so the summary and the #410 migration list
 * cannot silently walk different source sets.
 */
export function plainEnglishWorklist(repo: string): PlainEnglishWorkItem[] {
  const content = join(repo, 'packages/content');
  const core = join(repo, 'packages/core/src');
  const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
  return [
    ...walk(content, '', (f) => f.endsWith('.yaml') && f !== 'loci.yaml')
      .flatMap((f) => plainEnglishContentWorkItems(f, read(content, f))),
    ...walk(core, '', (f) => f.endsWith('.ts') && !f.startsWith('tools/') && !f.startsWith('fixtures/') && !isTest(f))
      .flatMap((f) => plainEnglishCoreWorkItems(f, read(core, f))),
  ];
}


/**
 * Actionable #415 migration queue. The old --plainenglish-worklist inventory
 * remains unchanged; this report separates work still owed from reviewed
 * counterparts. A changed Original invalidates its previously reviewed text.
 */
export type PlainEnglishCoverageStatus = 'missing' | 'stale' | 'invalid';

export interface PlainEnglishCoverageRow extends PlainEnglishWorkItem {
  status: PlainEnglishCoverageStatus;
  /** Expected fingerprint to put in the next reviewed content variant's of field. */
  expectedOf?: string;
}

export interface PlainEnglishCoverage {
  total: number;
  current: number;
  missing: number;
  stale: number;
  invalid: number;
  remaining: PlainEnglishCoverageRow[];
}

function equalInterpolationTokens(original: string, alternate: string): boolean {
  const a = [...contentInterpolationTokens(original)].sort();
  const b = [...contentInterpolationTokens(alternate)].sort();
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/** Pure accounting, so a changed Original is caught without a filesystem fixture. */
export function plainEnglishCoverageFor(
  items: readonly PlainEnglishWorkItem[],
  variants: readonly ProseVariant[],
): PlainEnglishCoverage {
  const byAddress = new Map(variants.map((variant) => [variant.address, variant]));
  const result: PlainEnglishCoverage = {
    total: items.length, current: 0, missing: 0, stale: 0, invalid: 0, remaining: [],
  };
  for (const item of items) {
    const variant = byAddress.get(item.address);
    const expectedOf = item.source === 'content' ? proseOriginalHash(item.text) : undefined;
    let status: PlainEnglishCoverageStatus | 'current';
    if (!variant) status = 'missing';
    else if (expectedOf !== undefined && variant.of !== expectedOf) status = 'stale';
    else if (variant.plainenglish === item.text
      || !equalInterpolationTokens(item.text, variant.plainenglish)) status = 'invalid';
    else status = 'current';

    result[status]++;
    if (status !== 'current') {
      result.remaining.push({
        ...item, status,
        ...(expectedOf === undefined ? {} : { expectedOf }),
      });
    }
  }
  return result;
}

/**
 * Count only variants physically stored in the YAML file named by the address.
 * The assembly validator rejects misplaced/orphaned variants; the worklist
 * must never credit one as done before that validation succeeds.
 */
export function plainEnglishCoverage(repo: string): PlainEnglishCoverage {
  const content = join(repo, 'packages/content');
  const variants: ProseVariant[] = [];
  for (const file of walk(content, '', (f) => f.endsWith('.yaml') && f !== 'loci.yaml')) {
    const document = parse(readFileSync(join(content, file), 'utf8')) as
      | { proseVariants?: unknown }
      | null;
    const rows = document?.proseVariants;
    if (!Array.isArray(rows)) continue;
    for (const candidate of rows) {
      const parsed = ProseVariantS.safeParse(candidate);
      if (parsed.success && parsed.data.address.startsWith('content:' + file + '#')) {
        variants.push(parsed.data);
      }
    }
  }
  return plainEnglishCoverageFor(plainEnglishWorklist(repo), variants);
}

export interface Totals { strings: number; words: number; interpolations: number; files: number }

export function totalBy<K extends keyof StringCount>(rows: StringCount[], key: K): Map<StringCount[K], Totals> {
  const out = new Map<StringCount[K], Totals & { seen: Set<string> }>();
  for (const r of rows) {
    const t = out.get(r[key]) ?? { strings: 0, words: 0, interpolations: 0, files: 0, seen: new Set<string>() };
    t.strings += r.strings;
    t.words += r.words;
    t.interpolations += r.interpolations;
    t.seen.add(`${r.source}:${r.file}`);
    t.files = t.seen.size;
    out.set(r[key], t);
  }
  return new Map([...out].map(([k, { seen: _seen, ...t }]) => [k, t]));
}

export function report(rows: StringCount[], opts: { files?: boolean } = {}): string[] {
  const lines: string[] = [];
  const fmt = (label: string, t: Totals) =>
    `  ${label.padEnd(18)} ${String(t.strings).padStart(6)} strings ${String(t.words).padStart(8)} words`
    + `${t.interpolations ? `  ${t.interpolations} {SLOT}s` : ''}  in ${t.files} file(s)`;

  lines.push('STRING SOURCES (issue #276) — an inventory, never a gate');
  lines.push('by source');
  for (const [k, t] of totalBy(rows, 'source')) lines.push(fmt(k, t));
  lines.push('by voice');
  const byVoice = totalBy(rows, 'voice');
  for (const v of VOICES) if (byVoice.has(v)) lines.push(fmt(v, byVoice.get(v)!));
  const all = [...totalBy(rows, 'source').values()].reduce(
    (a, t) => ({ strings: a.strings + t.strings, words: a.words + t.words, interpolations: a.interpolations + t.interpolations, files: a.files + t.files }),
    { strings: 0, words: 0, interpolations: 0, files: 0 },
  );
  lines.push(fmt('ALL', all));

  if (opts.files) {
    lines.push('by file, largest first');
    const sorted = [...rows].sort((a, b) => b.words - a.words || a.file.localeCompare(b.file) || a.voice.localeCompare(b.voice));
    for (const r of sorted) {
      lines.push(`  ${String(r.words).padStart(7)} words ${String(r.strings).padStart(5)} strings  ${r.source.padEnd(16)} ${r.voice.padEnd(10)} ${r.file}`);
    }
  }
  return lines;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('string-audit.ts');
if (isMain) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  if (process.argv.includes('--plainenglish-coverage')) {
    console.log(JSON.stringify(plainEnglishCoverage(repo), null, 2));
  } else if (process.argv.includes('--plainenglish-worklist')) {
    console.log(JSON.stringify(plainEnglishWorklist(repo), null, 2));
  } else {
    for (const line of report(auditRepository(repo), { files: process.argv.includes('--files') })) console.log(line);
  }
}
