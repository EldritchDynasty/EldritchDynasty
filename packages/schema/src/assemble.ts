import { ContentBundleS, type ContentBundle } from './content.js';

/**
 * WHERE THE CONTENT LIVES, declared once.
 *
 * There were two loaders — a node one walking the filesystem for the tests and
 * the harness, and a browser one over `import.meta.glob` for the editor — and
 * each carried its own copy of this table. When they drifted the symptom was
 * not an error. It was the editor quietly simulating a different game: a
 * missing `characterTemplates` line meant no spouses were minted, the line died
 * out, and the preview disagreed with the harness for reasons no one could see.
 *
 * Now both loaders do one job — hand over the files as text — and the layout
 * itself is here, next to the schema that gives those files meaning. A new
 * collection is one row in this table and it appears in both loaders at once,
 * because there is only one.
 *
 *   file       exactly this path; take `key` from it.
 *   dir        every .yaml under this prefix, recursively; concatenate `key`
 *              from each. Order follows the file listing, so authors can split
 *              a collection across as many files as they like.
 */
export type CollectionSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'dir'; readonly prefix: string };

export interface CollectionSpec {
  /** The document key inside the YAML, and the bundle field it fills. */
  readonly key: keyof ContentBundle;
  readonly source: CollectionSource;
  /**
   * Most shipped collections being empty means the checkout is broken.
   * Migration/catalogue collections may deliberately begin empty before their
   * authored pass has populated them.
   */
  readonly allowEmpty?: boolean;
}

export const CONTENT_LAYOUT: readonly CollectionSpec[] = [
  { key: 'attributes', source: { kind: 'file', path: 'attributes.yaml' } },
  { key: 'loci', source: { kind: 'file', path: 'loci.yaml' } },
  { key: 'traits', source: { kind: 'file', path: 'traits.yaml' } },
  { key: 'houses', source: { kind: 'file', path: 'houses.yaml' } },
  { key: 'heirlooms', source: { kind: 'file', path: 'heirlooms.yaml' } },
  { key: 'spellbooks', source: { kind: 'file', path: 'spellbooks.yaml' } },
  { key: 'careers', source: { kind: 'file', path: 'careers.yaml' } },
  { key: 'clauses', source: { kind: 'file', path: 'clauses.yaml' } },
  { key: 'prologue', source: { kind: 'file', path: 'prologue.yaml' } },
  { key: 'endings', source: { kind: 'file', path: 'endings.yaml' } },
  { key: 'tales', source: { kind: 'file', path: 'tales.yaml' } },
  { key: 'parcels', source: { kind: 'file', path: 'parcels.yaml' } },
  { key: 'positions', source: { kind: 'file', path: 'positions.yaml' } },
  // A counterpart lives beside the Original prose it answers. Scanning every
  // YAML file keeps #415 batches independent instead of funnelling 127k words
  // through one global catalogue file.
  { key: 'proseVariants', source: { kind: 'dir', prefix: '' }, allowEmpty: true },
  { key: 'ages', source: { kind: 'dir', prefix: 'ages/' } },
  { key: 'events', source: { kind: 'dir', prefix: 'events/' } },
  { key: 'arcs', source: { kind: 'dir', prefix: 'arcs/' } },
  { key: 'characters', source: { kind: 'dir', prefix: 'characters/' } },
  { key: 'characterTemplates', source: { kind: 'dir', prefix: 'characters/' } },
];

/** Every collection the bundle carries, derived rather than restated. */
export const BUNDLE_KEYS = CONTENT_LAYOUT.map((c) => c.key);

export type YamlParser = (text: string) => unknown;

/**
 * WHICH FILE AN ID CAME FROM.
 *
 * A validation issue names `event:the_drowning`, which is a token to grep for
 * rather than a place to go. This map turns it into one. It is filled by
 * `assembleBundle` as it walks, rather than by a second pass over
 * `CONTENT_LAYOUT` — the two loaders each carrying their own copy of that
 * table is the bug this file exists to have fixed, and a third copy for
 * bookkeeping would be the same bug wearing a hat.
 *
 * Keyed by bare id. Ids are `snake_case` and unique in practice; where one is
 * somehow claimed by two files the FIRST wins, because a wrong file is worse
 * than none and the first is at least stable across runs.
 */
export type ContentSources = Map<string, string>;

/**
 * Provenance belongs to the assembled bundle, but not to its authored wire
 * shape. Keep it beside the object rather than inventing a second field in
 * ContentBundleS: callers that need to write the YAML back must still see
 * exactly the authored data.
 */
const BUNDLE_SOURCES = new WeakMap<ContentBundle, ReadonlyMap<string, string>>();

/** Which file each authored id came from, when this bundle was assembled from files. */
export function contentSourcesOf(bundle: ContentBundle): ReadonlyMap<string, string> {
  return BUNDLE_SOURCES.get(bundle) ?? new Map();
}

/**
 * Files in, validated bundle out. `files` is keyed by path relative to
 * `packages/content` — the node loader gets them from the filesystem, the
 * editor from `import.meta.glob`, and a test from an object literal, which is
 * the third reason this function exists.
 *
 * The YAML parser is passed in so this file, and therefore `@ed/schema`, keeps
 * its single dependency.
 *
 * Pass `sources` to learn which file each id came from. It is an out-param
 * rather than a second return value so that every existing caller — the
 * editor's loader included — is untouched by it.
 */
export function assembleBundle(
  files: Record<string, string>,
  parse: YamlParser,
  sources?: ContentSources,
): ContentBundle {
  const paths = Object.keys(files).sort();
  const raw: Record<string, unknown[]> = {};
  // Always collect provenance. The optional out-param is for diagnostics; the
  // WeakMap below is what lets a SavedGame remember the files its live content
  // references without putting filesystem metadata into ContentBundleS.
  const foundSources: ContentSources = new Map();

  for (const spec of CONTENT_LAYOUT) {
    let matching: string[];
    if (spec.source.kind === 'file') {
      const wanted = spec.source.path;
      // A named file that is not there is a broken checkout, not an empty
      // collection. Zod accepts `attributes: []` quite happily, and a game with
      // no attributes runs — badly, silently, and for a thousand years.
      if (!(wanted in files)) throw new Error(`content: ${wanted} is missing (holds '${spec.key}')`);
      matching = [wanted];
    } else {
      const { prefix } = spec.source;
      matching = paths.filter((p) => p.startsWith(prefix) && p.endsWith('.yaml'));
    }

    const out: unknown[] = [];
    for (const path of matching) {
      const doc = parse(files[path]!) as Record<string, unknown> | null;
      const value = doc?.[spec.key as string];
      if (!Array.isArray(value)) continue;

      // The browser's precompiled docs use compact per-file tuples for Plain
      // English counterparts. Node/editor YAML still supplies full objects.
      // Reconstitute the canonical shape before source checks and Zod, so the
      // simulation, save and editor never see a second variant representation.
      const entries: unknown[] = spec.key === 'proseVariants'
        ? value.map((item: unknown) => {
          if (!Array.isArray(item) || item.length !== 3 || typeof item[0] !== 'string') return item;
          const [suffix, of, plainenglish] = item;
          return {
            address: `content:${path}#${suffix}`,
            ...(of === null ? {} : { of }),
            plainenglish,
          };
        })
        : value;

      if (spec.key === 'proseVariants') {
        for (const item of entries) {
          const address = (item as { address?: unknown } | null)?.address;
          if (typeof address !== 'string' || !address.startsWith('content:')) continue;
          const hash = address.indexOf('#');
          const originalFile = hash < 0 ? '' : address.slice('content:'.length, hash);
          if (originalFile !== path) {
            throw new Error(
              `prose variant '${address}' is in '${path}', but its Original is in '${originalFile}'`,
            );
          }
        }
      }

      out.push(...entries);
      for (const item of entries) {
        const row = item as { id?: unknown; key?: unknown } | null;
        const id = typeof row?.id === 'string' ? row.id : typeof row?.key === 'string' ? row.key : undefined;
        if (id === undefined) continue;
        if (!foundSources.has(id)) foundSources.set(id, path);
        if (sources && !sources.has(id)) sources.set(id, path);
      }
    }
    raw[spec.key as string] = out;
  }

  const bundle = ContentBundleS.parse(raw);
  BUNDLE_SOURCES.set(bundle, foundSources);
  return bundle;
}
