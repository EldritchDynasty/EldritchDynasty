import { parse, parseDocument, type Document } from 'yaml';
import { reactive } from 'vue';
import type { ContentBundle, ProseVariant } from '@ed/schema';
import { assembleBundle, CONTENT_LAYOUT } from '@ed/schema';
import { isWritableContentPath, rawFiles, readFile, writeFile } from './content.js';

/**
 * THE WRITE-BACK STORE (issue #20).
 *
 * `writeFile` and `toYaml` existed with zero callers. Every editing surface
 * kept its own local `ref` copy of its slice of content, rebuilt fresh from
 * `props.content` on every mount — which is exactly what `App.vue`'s
 * `v-if`/`v-else-if` tab chain does to a component on every switch. An edit
 * therefore survived until the next click.
 *
 * The fix is a module-level singleton. `reactive(bundle)` hands every
 * importer the SAME proxy, so `EventEditor` and `CharacterEditor` read and
 * write one shared model instead of three private ones, and `App.vue`'s
 * `content` (built by `indexContent`-ing this same `bundle`) sees every edit
 * immediately because it is the identical array, not a snapshot of it.
 *
 * SAVING is comment-preserving AT THE FILE LEVEL. Each content file is
 * parsed once into a `yaml.Document` — not just plain JSON — kept alongside
 * the reactive model. A save patches ONLY the changed item's node
 * (`doc.setIn`) rather than re-stringifying the whole file, so the file's
 * header comments and every OTHER entry in it survive untouched.
 *
 * The edited item itself re-serializes from its live, Zod-parsed state —
 * which means every field on it, not just the one a click actually changed:
 * optional fields Zod filled in with their schema default become explicit,
 * and arrays that were authored in flow style (`tags: [a, b]`) come back
 * block-style. The diff view (issue #21) exists largely BECAUSE of this —
 * it shows the author the real write, including the reformatting, before
 * anything reaches disk, rather than promising a minimal diff this design
 * cannot honestly make. A surgical single-field patch would need the live
 * model to track original source order and style per field; that is a
 * larger change than write-back itself and is left for a later pass.
 */

interface FileEntry {
  path: string;
  doc: Document;
  /** The text this file had the moment the editor loaded it — the base a diff (issue #21) is drawn against. */
  loadedText: string;
}

const files = new Map<string, FileEntry>();
for (const [path, text] of Object.entries(rawFiles)) {
  files.set(path, { path, doc: parseDocument(text), loadedText: text });
}

/** Which collections (bundle key -> YAML top-level key) a file can hold an editable item in. */
const COLLECTION_YAML_KEY: Record<string, string> = {
  events: 'events',
  arcs: 'arcs',
  characterTemplates: 'characterTemplates',
};

type StoreItem = { id?: string; address?: string };

function identityField(collectionKey: string): 'id' | 'address' {
  return collectionKey === 'proseVariants' ? 'address' : 'id';
}

function identityOf(collectionKey: string, item: StoreItem): string | undefined {
  return item[identityField(collectionKey)];
}

function itemsOf(collectionKey: string): StoreItem[] | undefined {
  return (store.bundle as unknown as Record<string, StoreItem[]>)[collectionKey];
}

function locate(collectionKey: string, id: string): { path: string; index: number } | undefined {
  const yamlKey = COLLECTION_YAML_KEY[collectionKey] ?? collectionKey;
  const field = identityField(collectionKey);
  for (const [path, f] of files) {
    const seq = f.doc.get(yamlKey, true) as { items?: unknown[] } | undefined;
    if (!seq?.items) continue;
    for (let i = 0; i < seq.items.length; i++) {
      if (f.doc.getIn([yamlKey, i, field]) === id) return { path, index: i };
    }
  }
  return undefined;
}

/** Which file an item lives in, for display (issue #20's `fileOfEvent`, generalised). */
export function fileOf(collectionKey: string, id: string): string | undefined {
  return locate(collectionKey, id)?.path;
}

/**
 * Locate any authored id without keeping a second copy of the content layout.
 *
 * Validation issues can name more than editor-writable events/arcs/templates,
 * and Vue's reactive bundle is a proxy rather than the WeakMap key assembled
 * by @ed/schema. The YAML documents are the editor's source of truth, and this
 * walk also sees an item immediately after `createItem` adds its node.
 */
export function fileOfId(id: string): string | undefined {
  for (const [path, file] of files) {
    for (const spec of CONTENT_LAYOUT) {
      const key = spec.key as string;
      const seq = file.doc.get(key, true) as { items?: unknown[] } | undefined;
      if (!seq?.items) continue;
      for (let i = 0; i < seq.items.length; i++) {
        const itemId = file.doc.getIn([key, i, 'id']) ?? file.doc.getIn([key, i, 'key']);
        if (itemId === id) return path;
      }
    }
  }
  return undefined;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export const store = reactive({
  bundle: assembleBundle(rawFiles, parse) as ContentBundle,
  /** File paths with edits not yet written to disk. */
  dirty: new Set<string>(),
  saving: new Set<string>(),
  errors: {} as Record<string, string>,
});

/**
 * Strip Vue's reactive proxy so `yaml`'s Document gets a plain value, then turn
 * that value into real YAML NODES.
 *
 * `createNode` is not decoration. `doc.setIn(path, plainObject)` stores the raw
 * JS object in the sequence, and it SERIALISES correctly — the written file is
 * byte-for-byte what it should be, which is why this survived unnoticed. But
 * `doc.getIn([key, i, 'id'])` walks YAML nodes, and a raw object is not one, so
 * it returns `undefined` from that moment on. `locate` is built on `getIn`, so
 * the item becomes invisible to the store the instant it is first written:
 * the second save of an event fails with "is not in any loaded file", and
 * `createItem` — which appends and then calls `saveItem` — never wrote to disk
 * at all. Both looked like they had worked, because the live model updates
 * either way and the UI reads the live model.
 */
function node<T>(doc: Document, x: T): unknown {
  return doc.createNode(JSON.parse(JSON.stringify(x)) as T);
}

const STRINGIFY_OPTS = { lineWidth: 78, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' } as const;

function syncProseVariants(doc: Document): void {
  const seq = doc.get('proseVariants', true) as { items?: unknown[] } | undefined;
  if (!seq?.items) return;
  for (let i = 0; i < seq.items.length; i++) {
    const address = doc.getIn(['proseVariants', i, 'address']);
    if (typeof address !== 'string') continue;
    const live = store.bundle.proseVariants.find((variant) => variant.address === address);
    if (live) doc.setIn(['proseVariants', i], node(doc, live));
  }
}

/**
 * Stage a missing Plain English counterpart in the same YAML file as Original.
 * The normal item SaveControl writes both columns together; staging alone never
 * writes to disk.
 */
export function stageProseVariant(
  path: string,
  address: string,
  plainenglish: string,
): ProseVariant | undefined {
  const existing = store.bundle.proseVariants.find((variant) => variant.address === address);
  if (existing) return existing;

  const file = files.get(path);
  if (!file || !isWritableContentPath(path)) return undefined;

  const variant: ProseVariant = { address, plainenglish };
  store.bundle.proseVariants.push(variant);

  const seq = file.doc.get('proseVariants', true) as { items?: unknown[] } | undefined;
  if (!seq?.items) file.doc.set('proseVariants', node(file.doc, []));
  file.doc.addIn(['proseVariants'], node(file.doc, variant));
  store.dirty.add(path);
  return store.bundle.proseVariants.find((candidate) => candidate.address === address);
}

/** The text a save WOULD write, without writing it — what the diff view (issue #21) renders. */
export function pendingText(collectionKey: string, id: string): { path: string; before: string; after: string } | undefined {
  const located = locate(collectionKey, id);
  if (!located) return undefined;
  const file = files.get(located.path)!;
  const yamlKey = COLLECTION_YAML_KEY[collectionKey] ?? collectionKey;
  const items = itemsOf(collectionKey);
  const item = items?.find((x) => identityOf(collectionKey, x) === id);
  if (!item) return undefined;

  // Clone the document so previewing a diff never mutates the file the way a
  // save does — the whole point of a preview is that looking at it costs nothing.
  const preview = file.doc.clone();
  preview.setIn([yamlKey, located.index], node(preview, item));
  syncProseVariants(preview);
  return { path: located.path, before: file.loadedText, after: preview.toString(STRINGIFY_OPTS) };
}

/**
 * Has the file on disk moved since the editor loaded it? Checked against
 * `loadedText`, not against `writeFile`'s own read-before-write guard, which
 * only protects the instant of the write itself — this is what lets the UI
 * say so BEFORE a save is even attempted (issue #21, "git-adjacent").
 */
export async function externalChange(path: string): Promise<{ changed: boolean; text?: string }> {
  const file = files.get(path);
  if (!file) return { changed: false };
  const res = await readFile(path);
  if (!res.ok || res.text === undefined) return { changed: false };
  return { changed: res.text !== file.loadedText, text: res.text };
}

/** Mark an item's file dirty. Called on every edit; cheap enough (files × items) at content-directory scale. */
export function markDirty(collectionKey: string, id: string): void {
  const located = locate(collectionKey, id);
  if (located) store.dirty.add(located.path);
}

export function isDirty(collectionKey: string, id: string): boolean {
  const located = locate(collectionKey, id);
  return located ? store.dirty.has(located.path) : false;
}

/** Write one item's current state back to its file, preserving everything around it. */
export async function saveItem(collectionKey: string, id: string): Promise<WriteResult> {
  const located = locate(collectionKey, id);
  if (!located) return { ok: false, error: `'${id}' is not in any loaded file` };
  const file = files.get(located.path)!;
  if (!isWritableContentPath(located.path)) {
    return { ok: false, error: `'${located.path}' is shipped content and is read-only in Mod Editor` };
  }
  const yamlKey = COLLECTION_YAML_KEY[collectionKey] ?? collectionKey;
  const items = itemsOf(collectionKey);
  const item = items?.find((x) => identityOf(collectionKey, x) === id);
  if (!item) return { ok: false, error: `'${id}' is not in the live model` };

  file.doc.setIn([yamlKey, located.index], node(file.doc, item));
  syncProseVariants(file.doc);
  const text = file.doc.toString(STRINGIFY_OPTS);

  store.saving.add(located.path);
  const res = await writeFile(located.path, text);
  store.saving.delete(located.path);

  if (res.ok) {
    file.loadedText = text;
    store.dirty.delete(located.path);
    delete store.errors[located.path];
  } else {
    store.errors[located.path] = res.error ?? 'write failed';
  }
  return res;
}

export function saveEvent(id: string): Promise<WriteResult> {
  return saveItem('events', id);
}

export function saveCharacterTemplate(id: string): Promise<WriteResult> {
  return saveItem('characterTemplates', id);
}

export function saveArc(id: string): Promise<WriteResult> {
  return saveItem('arcs', id);
}

/**
 * CREATING SOMETHING NEW, by appending to a file that already exists.
 *
 * Both write transports read before they write — the dev server's middleware
 * and the Electron main process both do, deliberately, so the tool can never
 * conjure a file somewhere it should not. A brand-new FILE therefore needs new
 * plumbing at both ends and a widened path check at both ends, which is a
 * larger and more security-shaped change than creating an event needs to be.
 *
 * Appending to a file the author picks needs none of that, and is how content
 * is actually organised anyway: events live in files by subject, not one per
 * file. The author chooses which one it joins.
 */
export function filesHolding(collectionKey: string): string[] {
  const yamlKey = COLLECTION_YAML_KEY[collectionKey] ?? collectionKey;
  const out: string[] = [];
  for (const [path, f] of files) {
    const seq = f.doc.get(yamlKey, true) as { items?: unknown[] } | undefined;
    if (seq?.items && isWritableContentPath(path)) out.push(path);
  }
  return out.sort();
}

export interface CreateResult extends WriteResult {
  path?: string;
}

/**
 * Append `item` to `path`'s collection and to the live model, then save. The
 * live model is updated FIRST and unconditionally: a new item the author can
 * see and keep editing after a failed write is recoverable, and one that
 * vanished because the disk said no is not.
 */
export async function createItem(collectionKey: string, path: string, item: { id: string }): Promise<CreateResult> {
  const file = files.get(path);
  if (!file) return { ok: false, error: `no loaded file '${path}'` };

  const items = itemsOf(collectionKey);
  if (!items) return { ok: false, error: `no collection '${collectionKey}'` };
  if (items.some((x) => identityOf(collectionKey, x) === item.id)) {
    return { ok: false, error: `'${item.id}' already exists` };
  }

  const yamlKey = COLLECTION_YAML_KEY[collectionKey] ?? collectionKey;
  items.push(item);
  file.doc.addIn([yamlKey], node(file.doc, item));
  store.dirty.add(path);

  const res = await saveItem(collectionKey, item.id);
  return { ...res, path };
}
