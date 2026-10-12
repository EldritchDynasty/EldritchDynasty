import {
  mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentYamlParser, parseContentYaml, type ParsedContentYaml } from './yaml.js';
import {
  assembleBundle, indexContent,
  type Content, type ContentBundle, type ContentSources,
} from '@ed/schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Node-side content loader, for tests and the headless harness.
 *
 * Its whole job is to hand the files over as text. What a bundle IS — which
 * collection lives in which file, under which key — is declared once in
 * `@ed/schema`'s `CONTENT_LAYOUT`, which the editor's browser loader reads
 * from too. The two loaders used to carry a copy each, and when they drifted
 * the editor simply simulated a different game.
 */
export function contentFiles(root = ROOT): Record<string, string> {
  const out: Record<string, string> = {};

  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(join(root, dir)); } catch { return; }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry}` : entry;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.yaml')) out[rel] = readFileSync(join(root, rel), 'utf8');
    }
  };

  walk('');
  return out;
}

/**
 * THE YAML IS PARSED ONCE PER CONTENT REVISION, NOT ONCE PER CALLER.
 *
 * `loadContent()` has 77 call sites across 54 test files and used to cost
 * 730ms every time. Profiled, 670ms of that was `yaml.parse` over the 74
 * files; Zod validation was 60ms and indexing 3ms. Vitest forks a worker per
 * test file, so an in-process memo alone would have bought almost nothing —
 * the repeat is ACROSS processes.
 *
 * So the parsed documents are cached to disk under a key that is a hash of
 * every file's text. Reading them back is ~10ms. Change a byte of content and
 * the key changes with it, so there is no staleness to reason about and
 * nothing to invalidate by hand.
 *
 * What is NOT cached is as important. `assembleBundle` still runs on every
 * load, which means `ContentBundleS.parse` — the Zod pass, and therefore all
 * 25 content rules downstream of it — still validates every time. The cache
 * holds parsed YAML and never a validated bundle: skipping validation would
 * save 60ms and let a bad edit reach the simulation looking fine.
 *
 * This is a module-level cache, which invariant 8 forbids for SIMULATION
 * state. It is not simulation state: it holds only the authored documents,
 * which are immutable by construction, and every caller still gets its own
 * bundle back because Zod rebuilds each object it parses. Nothing here is
 * reachable from a `WorldState`.
 *
 * `ED_CONTENT_CACHE=off` bypasses it entirely.
 */
const CACHE_DIR = join(ROOT, '..', '..', 'node_modules', '.cache', 'ed-content');

let memo: { key: string; docs: Record<string, ParsedContentYaml> } | undefined;

function cacheKey(files: Record<string, string>): string {
  const h = createHash('sha1');
  // Old cache entries contain values without the source-node diagnostics.
  h.update('flow-prose-ast-v1\0');
  for (const path of Object.keys(files).sort()) {
    h.update(path);
    h.update('\0');
    h.update(files[path]!);
    h.update('\0');
  }
  return h.digest('hex');
}

function parseAll(files: Record<string, string>): Record<string, ParsedContentYaml> {
  const docs: Record<string, ParsedContentYaml> = {};
  // Empty YAML becomes a null document inside the envelope, so it survives
  // the cache's JSON round trip together with its source diagnostics.
  for (const [path, text] of Object.entries(files)) docs[path] = parseContentYaml(text);
  return docs;
}

/** Read the cache, parse on a miss, and write the result back. Never throws. */
function parsedDocs(files: Record<string, string>): Record<string, ParsedContentYaml> {
  if (process.env.ED_CONTENT_CACHE === 'off') return parseAll(files);

  const key = cacheKey(files);
  if (memo?.key === key) return memo.docs;

  const file = join(CACHE_DIR, `${key}.json`);
  try {
    const docs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ParsedContentYaml>;
    if (Object.keys(files).some((path) => !docs[path] || !('document' in docs[path]!)
      || !Array.isArray(docs[path]!.flowProseIssues))) throw new Error('stale parsed YAML cache');
    memo = { key, docs };
    return docs;
  } catch {
    // A miss, a corrupt entry, or a read-only checkout — all the same answer.
  }

  const docs = parseAll(files);
  memo = { key, docs };

  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    // Write elsewhere and rename, because vitest runs these workers in
    // parallel and a half-written file read by a sibling is the one failure
    // mode a cache must not have. Rename is atomic within a filesystem.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(docs));
    renameSync(tmp, file);
    for (const stale of readdirSync(CACHE_DIR)) {
      if (stale !== `${key}.json`) { try { unlinkSync(join(CACHE_DIR, stale)); } catch { /* raced */ } }
    }
  } catch {
    // Caching is an optimisation. Failing to cache is not failing to load.
  }

  return docs;
}

/**
 * Pass `sources` to learn which file each content id came from — what turns a
 * validation issue from a token to grep for into a place to go. See
 * `ContentSources` in `@ed/schema`.
 */
export function loadBundle(root = ROOT, sources?: ContentSources): ContentBundle {
  const files = contentFiles(root);
  const docs = parsedDocs(files);
  // `assembleBundle` reads each file's text through the parser it is handed.
  // Ours answers from the documents already parsed above; the fallback covers
  // a caller that passes files the cache was not built from.
  const byText = new Map<string, ParsedContentYaml>();
  for (const [path, text] of Object.entries(files)) {
    if (path in docs) byText.set(text, docs[path]!);
  }
  return assembleBundle(files, contentYamlParser(byText), sources);
}

/** The bundle with its indexes built. What the simulation actually wants. */
export function loadContent(root = ROOT, sources?: ContentSources): Content {
  return indexContent(loadBundle(root, sources));
}

export { ROOT as CONTENT_ROOT, CACHE_DIR as CONTENT_CACHE_DIR };
