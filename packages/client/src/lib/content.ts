import docs from 'virtual:ed-content';
import { assembleBundle, MusterOrderS, ProseCatalogueS, TableOrderS, type ContentBundle, type ProseVariant } from '@ed/schema';
import type { MusterOrder, TableOrder } from '@ed/core';
import type { Platform } from '../platform.js';

/** Bounded order categories for the opt-in reading log. Keep runtime schema
 * validation in this module, one of the client's permitted schema seams. */
const TABLE_ORDER_KINDS: ReadonlySet<string> = new Set(TableOrderS.options.map((o) => o.shape.kind.value));
const MUSTER_ORDER_OPS: ReadonlySet<string> = new Set(MusterOrderS.options.map((o) => o.shape.op.value));

function boundedCategory<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | 'unknown' {
  return typeof value === 'string' && allowed.has(value) ? value as T : 'unknown';
}

export function readingLogTableCategory(value: unknown): TableOrder['kind'] | 'unknown' {
  return boundedCategory<TableOrder['kind']>(value, TABLE_ORDER_KINDS);
}

export function readingLogMusterCategory(value: unknown): MusterOrder['op'] | 'unknown' {
  return boundedCategory<MusterOrder['op']>(value, MUSTER_ORDER_OPS);
}

/**
 * The shipped content is pre-parsed at build time (#109). The normal path
 * still does exactly one JSON assembly and never imports the YAML parser.
 * #75 deliberately makes user-authored desktop content the sole exception.
 */
let current: ContentBundle = assembleBundle(docs, JSON.parse);
let cataloguePromise: Promise<readonly ProseVariant[]> | undefined;
let catalogueInstalled = false;

/**
 * Fetch reviewed alternatives only when the reader requests Plain English.
 * Original-mode startup never imports or parses the optional chunk.
 * Validation and source-relative identities are the same as in the Node
 * loader, and installing a catalogue does not alter a saved world.
 */
export function unpackProseDocs(packed: Record<string, unknown[]>): ProseVariant[] {
  const variants: unknown[] = [];
  for (const [file, rows] of Object.entries(packed)) {
    for (const row of rows) {
      // Build-time packing only changes content: addresses. A catalogue may
      // also carry a core:messages# entry, which remains a canonical object.
      if (!Array.isArray(row)) { variants.push(row); continue; }
      if (row.length !== 3 || typeof row[0] !== 'string') {
        throw new Error(`Invalid precompiled prose variant in ${file}`);
      }
      const [suffix, of, plainenglish] = row;
      variants.push({
        address: `content:${file}#${suffix}`,
        ...(of === null ? {} : { of }),
        plainenglish,
      });
    }
  }
  return ProseCatalogueS.parse(variants);
}

export async function installPlainEnglishCatalogue(): Promise<readonly ProseVariant[]> {
  cataloguePromise ??= import('virtual:ed-prose-variants').then(({ default: packed }) => unpackProseDocs(packed))
    .catch((error: unknown) => {
    cataloguePromise = undefined; // A failed chunk download may be retried.
    throw error;
  });

  const shipped = await cataloguePromise;
  if (!catalogueInstalled) {
    // User-authored desktop counterparts, if present, were installed first.
    // The full uniqueness check must catch collisions instead of replacing
    // one variant behind the author's back.
    current.proseVariants = ProseCatalogueS.parse([...current.proseVariants, ...shipped]);
    catalogueInstalled = true;
  }
  return current.proseVariants;
}

/** Compose optional user files before Vue mounts. The host is read-only here. */
export async function installUserContent(platform: Platform): Promise<ContentBundle> {
  const files = await platform.readUserContent();
  if (Object.keys(files).length === 0) return current;

  // Vite emits this as a separate chunk. An unmodded game never fetches it.
  const [{ parse }, { bundleWithUserContent }] = await Promise.all([
    import('yaml'),
    import('@ed/schema'),
  ]);
  const bundled = bundleWithUserContent(docs, files, parse);
  if (catalogueInstalled) {
    // Reapply already-loaded shipped variants after a user-content refresh.
    const loaded = await cataloguePromise!;
    bundled.proseVariants = ProseCatalogueS.parse([...bundled.proseVariants, ...loaded]);
  }
  current = bundled;
  return current;
}

export function loadBundle(): ContentBundle {
  return current;
}
