import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { parse } from 'yaml';
import type { Plugin } from 'vite';

/**
 * THE CONTENT, PARSED AT BUILD TIME (issue #109).
 *
 * The client used to glob 83 YAML files as raw text and run `parse()` over
 * 1.6 MB of them at module scope — 328 ms on a warm four-core container,
 * ahead of first paint, on the critical path, every single boot. On a
 * mid-range Android WebView that is seconds. It bought nothing: content is
 * loaded once and never changes again during a run, so the parse can happen
 * on the build machine instead of on the player's phone.
 *
 * The seam it goes through is the one `assembleBundle` already had. That
 * function takes its parser as an argument, so this is not a second way to
 * build a bundle — it is the same walk over the same `CONTENT_LAYOUT`, handed
 * a cheaper parser. Nothing here knows which file holds which collection, and
 * nothing here may learn: two loaders each carrying a copy of that table is
 * the bug `@ed/schema`'s assemble.ts exists to have fixed, and a build-time
 * third copy would be the same bug wearing a hat.
 *
 * The emitted values are JSON TEXT rather than object literals. `JSON.parse`
 * of one big string is the fastest way a JS engine can be handed structured
 * data — measurably faster than evaluating the equivalent literal — and it
 * keeps `assembleBundle(files, parse)` typed exactly as it already is.
 */
export const CONTENT_MODULE = 'virtual:ed-content';
export const PROSE_CONTENT_MODULE = 'virtual:ed-prose-variants';
const RESOLVED = `\0${CONTENT_MODULE}`;
const PROSE_RESOLVED = `\0${PROSE_CONTENT_MODULE}`;

/** Every `.yaml` under `dir`, keyed by its path relative to it, posix-style. */
export function contentFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at).sort()) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.yaml')) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/**
 * Path → the document's JSON, ready for `JSON.parse`.
 *
 * A file that parses to nothing becomes `null` rather than vanishing:
 * `assembleBundle` reads `doc?.[key]` and skips it, which is what the runtime
 * parse did with the same file. Dropping the key instead would make an empty
 * file and a missing file the same thing, and a missing named file is a broken
 * checkout that must still throw.
 */
/**
 * Prose variants repeat the name of their own YAML file on every address, as
 * well as three JSON property names. A migration of thousands of passages
 * otherwise consumes the cold-start byte budget with redundant metadata.
 *
 * Store each reviewed row as [path-within-file, Original hash or null, wording].
 * assembleBundle reconstructs the unchanged canonical object BEFORE Zod and
 * file-provenance validation. Keep malformed/unrecognised rows intact so the
 * normal validator still rejects them instead of this optimiser hiding them.
 */
function compactProseVariants(doc: unknown, file: string): unknown {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const row = doc as Record<string, unknown>;
  if (!Array.isArray(row.proseVariants)) return doc;

  const prefix = `content:${file}#`;
  row.proseVariants = row.proseVariants.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const variant = candidate as Record<string, unknown>;
    if (typeof variant.address !== 'string' || !variant.address.startsWith(prefix)
      || typeof variant.plainenglish !== 'string'
      || (variant.of !== undefined && typeof variant.of !== 'string')
      || Object.keys(variant).some((key) => !['address', 'of', 'plainenglish'].includes(key))) {
      return candidate;
    }
    return [variant.address.slice(prefix.length), variant.of ?? null, variant.plainenglish];
  });
  return doc;
}

export function readContentDocs(dir: string): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const path of contentFiles(dir)) {
    const key = path.slice(dir.length + 1).split(sep).join(posix.sep);
    docs[key] = JSON.stringify(compactProseVariants(parse(readFileSync(path, 'utf8')) ?? null, key));
  }
  return docs;
}

/**
 * All reviewed Plain English sentences live in an optional Vite chunk.
 * Keep the Original gameplay text in the initial payload, but do not parse
 * thousands of unrequested counterpart strings before the first frame.
 *
 * The two projections come from the same precompiled documents. Node/editor
 * loaders still consume the complete authoring representation unchanged.
 */
export function readStartupDocs(dir: string): Record<string, string> {
  return Object.fromEntries(Object.entries(readContentDocs(dir)).map(([file, text]) => {
    const doc = JSON.parse(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.proseVariants)) return [file, text];
    const { proseVariants: _variants, ...original } = doc;
    return [file, JSON.stringify(original)];
  }));
}

export function readProseDocs(dir: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [file, text] of Object.entries(readContentDocs(dir))) {
    const doc = JSON.parse(text) as Record<string, unknown> | null;
    if (doc && Array.isArray(doc.proseVariants) && doc.proseVariants.length) {
      out[file] = doc.proseVariants;
    }
  }
  return out;
}

/**
 * A Vite plugin serving `virtual:ed-content`.
 *
 * In dev the docs are re-read on every load and the module is invalidated when
 * any content file changes, so authoring in the editor on 5173 and playing on
 * 5174 still works the way it did when the client read the directory itself.
 */
export function edContent(dir: string): Plugin {
  return {
    name: 'ed:content',
    resolveId(id) {
      if (id === CONTENT_MODULE) return RESOLVED;
      if (id === PROSE_CONTENT_MODULE) return PROSE_RESOLVED;
      return null;
    },
    load(id) {
      if (id !== RESOLVED && id !== PROSE_RESOLVED) return null;
      for (const path of contentFiles(dir)) this.addWatchFile(path);
      const docs = id === RESOLVED ? readStartupDocs(dir) : readProseDocs(dir);
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(docs))});\n`;
    },
    handleHotUpdate({ file, server, modules }) {
      if (!file.endsWith('.yaml') || !file.startsWith(dir)) return;
      const watched = [RESOLVED, PROSE_RESOLVED]
        .map((id) => server.moduleGraph.getModuleById(id))
        .filter((mod) => mod !== undefined);
      for (const mod of watched) server.moduleGraph.invalidateModule(mod);
      return [...modules, ...watched];
    },
  };
}
