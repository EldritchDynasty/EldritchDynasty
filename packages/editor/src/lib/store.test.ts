import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isProxy } from 'vue';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBundle, EventTemplateS, RecordBlockS } from '@ed/schema';

/**
 * THE WRITE-BACK STORE — the code that touches the author's files.
 *
 * `store.ts` was the largest node-testable module in the repo with no tests at
 * all (docs/TEST-COVERAGE.md, "Still open"). What it does is write YAML back
 * over content a human wrote by hand, so its failure mode is not an exception
 * — it is an author losing a header comment, a sibling event, or an edit they
 * watched the UI accept.
 *
 * Every assertion here is about something that would look fine from the
 * outside if it broke:
 *
 *   - a save that patches the whole file instead of one node silently eats
 *     the comments and the other entries, and the diff view would show it
 *     only if someone happened to look;
 *   - a preview that mutates the document it previews poisons the NEXT
 *     preview, and the first one still looks correct;
 *   - a failed write that rolls the live model back loses an edit the author
 *     has already been shown.
 *
 * The fixtures are the REAL content directory, handed over the same way the
 * editor's `import.meta.glob` hands it over. Only the two transport functions
 * are faked, so nothing here writes to disk — but everything here parses,
 * patches and re-serialises the files the game actually ships.
 */

const h = vi.hoisted(() => ({
  /** The fake disk: path -> current text. Seeded from the real content dir. */
  disk: new Map<string, string>(),
  /** Paths `writeFile` was asked to write, in order. */
  writes: [] as { path: string; text: string }[],
  /** Flip to make the transport refuse, the way a read-before-write guard does. */
  refuse: { value: false },
  throwWrite: { value: false },
  writable: { value: true },
  /** Hold a transport response until a second edit arrives. */
  holdWrite: { value: false },
  releaseWrite: { current: null as null | (() => void) },
}));

vi.mock('./content.js', async () => {
  const { contentFiles } = await import('@ed/content');
  const rawFiles = contentFiles();
  for (const [path, text] of Object.entries(rawFiles)) h.disk.set(path, text);

  return {
    rawFiles,
    isWritableContentPath: () => h.writable.value,
    writeFile: async (path: string, text: string) => {
      if (h.refuse.value) return { ok: false, error: 'refused by the path guard' };
      if (h.throwWrite.value) throw new Error('transport unavailable');
      if (h.holdWrite.value) {
        await new Promise<void>((resolve) => { h.releaseWrite.current = resolve; });
      }
      h.writes.push({ path, text });
      h.disk.set(path, text);
      return { ok: true };
    },
    readFile: async (path: string) => {
      const text = h.disk.get(path);
      return text === undefined ? { ok: false, error: 'no such file' } : { ok: true, text };
    },
    toYaml: (v: unknown) => JSON.stringify(v),
    shell: () => undefined,
    loadBundle: () => { throw new Error('not used by store.ts'); },
    loadContent: () => { throw new Error('not used by store.ts'); },
    fileOfEvent: () => undefined,
  };
});

const {
  store, fileOf, fileOfId, filesHolding, isDirty, markDirty,
  pendingText, saveItem, saveEvent, saveArc, saveCharacterTemplate,
  createItem, deleteEvent, pendingDeleteEvent, externalChange, removeProseVariant, stageProseVariant,
  applyCoreProseEdits, pendingCoreProseText, saveCoreProseCatalogue,
  markCoreProseDraftDirty, rawContent,
} = await import('./store.js');
const { duplicateEventDraft, eventBackreferences, eventDeletionBlockers, suggestedDuplicateId } = await import('./event-duplicate.js');
const { eventIssueId } = await import('./event-issues.js');

describe('authoring-store load validation', () => {
  it('refuses truncated effect prose before creating the live authoring bundle', async () => {
    const { rawFiles } = await import('./content.js');
    const path = 'events/flow_guard.yaml';
    rawFiles[path] = 'events:\n  - effects:\n      - { kind: chronicle, text: The debt stood, unpaid. }';
    vi.resetModules();
    try {
      await expect(import('./store.js')).rejects.toThrow(/events\/flow_guard.yaml:3 .*yaml\/flow-comma/);
    } finally {
      delete rawFiles[path];
      vi.resetModules();
    }
  });
});

/** A file with a long header comment block and four events in it. */
const CRUSADE = 'events/age_crusade.yaml';
const EVENT = 'the_shelf_that_has_to_go';
const SIBLING = 'the_priest_in_the_west_wing';

function event(id: string) {
  const found = store.bundle.events.find((e) => e.id === id);
  if (!found) throw new Error(`fixture drift: no event '${id}'`);
  return found;
}

beforeEach(() => {
  // Tests share the real parsed-document store. Reset the fake disk to each
  // file's current successful-save baseline, not the original import snapshot:
  // external-change tests intentionally diverge disk from loadedText.
  for (const [collection, id] of [
    ['events', EVENT],
    ['arcs', 'arc_the_eight_days'],
    ['characterTemplates', 'suitor_of_ilm'],
  ] as const) {
    const preview = pendingText(collection, id);
    if (preview) h.disk.set(preview.path, preview.before);
  }
  const coreProse = pendingCoreProseText();
  if (coreProse) h.disk.set(coreProse.path, coreProse.before);
  h.writes.length = 0;
  h.refuse.value = false;
  h.throwWrite.value = false;
  h.writable.value = true;
  h.holdWrite.value = false;
  h.releaseWrite.current = null;
  store.dirty.clear();
  store.saving.clear();
  for (const k of Object.keys(store.errors)) delete store.errors[k];
});

describe('finding where an item lives', () => {
  it('locates an item by id across the whole content directory', () => {
    expect(fileOf('events', EVENT)).toBe(CRUSADE);
    expect(fileOf('events', SIBLING)).toBe(CRUSADE);
  });

  it('looks in the right collection, not merely the right file', () => {
    // An event id is not an arc id. Asking the wrong collection must miss,
    // or a save writes an event into the `arcs:` sequence of some file.
    expect(fileOf('arcs', EVENT)).toBeUndefined();
    expect(fileOf('characterTemplates', EVENT)).toBeUndefined();
    expect(fileOf('arcs', 'arc_the_eight_days')).toBe('arcs/eight_days.yaml');
    expect(fileOf('characterTemplates', 'suitor_of_ilm')).toBe('characters/templates.yaml');
  });

  it('says nothing at all about an id that is not there', () => {
    expect(fileOf('events', 'no_such_event_anywhere')).toBeUndefined();
  });

  it('locates validation ids across collection kinds without a second layout table', () => {
    expect(fileOfId(EVENT)).toBe(CRUSADE);
    expect(fileOfId('arc_the_eight_days')).toBe('arcs/eight_days.yaml');
    expect(fileOfId('suitor_of_ilm')).toBe('characters/templates.yaml');
    expect(fileOfId('mind')).toBe('attributes.yaml');
    // Prose counterparts use `address`, unlike the id/key collections. The
    // provenance lookup must resolve their real authored YAML file too.
    expect(fileOfId('core:messages#assize.the_assessors_call')).toBe('messages.yaml');
    expect(fileOfId('core:messages#missing_prose_counterpart')).toBeUndefined();
    expect(fileOfId('no_such_content_id')).toBeUndefined();
  });

  it('lists only files that actually hold the collection', () => {
    const holders = filesHolding('events');
    expect(holders).toContain(CRUSADE);
    expect(holders.every((p) => p.startsWith('events/') || p.startsWith('arcs/'))).toBe(true);
    // `filesHolding` is what the new-item form offers as a destination. A file
    // with no `events:` key in it is not a place an event can be appended to.
    expect(holders).not.toContain('attributes.yaml');
    expect(filesHolding('characterTemplates')).toEqual(['characters/templates.yaml']);
  });

  it('returns a sorted list, so the destination picker does not reshuffle', () => {
    const holders = filesHolding('events');
    expect(holders).toEqual([...holders].sort());
  });

  it('does not offer reference-only files as new-item destinations', () => {
    h.writable.value = false;
    expect(filesHolding('events')).toEqual([]);
    expect(filesHolding('arcs')).toEqual([]);
  });
});

describe('the dirty set', () => {
  it('marks the file an item lives in, not the item', () => {
    expect(isDirty('events', EVENT)).toBe(false);
    markDirty('events', EVENT);
    expect(store.dirty.has(CRUSADE)).toBe(true);
    // Its siblings share the file, so they are dirty too — that is what a
    // file-level save means, and the UI has to say so.
    expect(isDirty('events', SIBLING)).toBe(true);
  });

  it('ignores an id it cannot place, rather than inventing a path', () => {
    markDirty('events', 'no_such_event_anywhere');
    expect(store.dirty.size).toBe(0);
    expect(isDirty('events', 'no_such_event_anywhere')).toBe(false);
  });
});

describe('pre-existing unsaved sibling edits (#1387)', () => {
  it('leaves a second edited event dirty after saving only the first event', async () => {
    const firstEvent = event(EVENT);
    const sibling = event(SIBLING);
    const firstOriginal = firstEvent.title;
    const siblingOriginal = sibling.title;

    try {
      // Both changes exist before either save. A file-only dirty generation
      // previously cleared both indicators after writing just the first row.
      firstEvent.title = 'First Preexisting Unsaved Title';
      markDirty('events', EVENT);
      sibling.title = 'Second Preexisting Unsaved Title';
      markDirty('events', SIBLING);

      expect(pendingText('events', EVENT)!.after).toContain('First Preexisting Unsaved Title');
      expect(pendingText('events', EVENT)!.after).not.toContain('Second Preexisting Unsaved Title');

      expect((await saveEvent(EVENT)).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('First Preexisting Unsaved Title');
      expect(h.disk.get(CRUSADE)).not.toContain('Second Preexisting Unsaved Title');
      expect(isDirty('events', SIBLING), 'the unwritten sibling must still need a save').toBe(true);
      expect(pendingText('events', SIBLING)!.after).toContain('Second Preexisting Unsaved Title');

      expect((await saveEvent(SIBLING)).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('First Preexisting Unsaved Title');
      expect(h.disk.get(CRUSADE)).toContain('Second Preexisting Unsaved Title');
      expect(isDirty('events', SIBLING)).toBe(false);
    } finally {
      firstEvent.title = firstOriginal;
      sibling.title = siblingOriginal;
      markDirty('events', EVENT);
      markDirty('events', SIBLING);
      await saveEvent(EVENT);
      await saveEvent(SIBLING);
    }
  });
});

describe('per-file save serialization (#1384)', () => {
  it('refuses a second item save in the same YAML file while its first write is pending', async () => {
    const firstEvent = event(EVENT);
    const secondEvent = event(SIBLING);
    const originalFirst = firstEvent.title;
    const originalSecond = secondEvent.title;
    let pending: ReturnType<typeof saveEvent> | undefined;

    try {
      firstEvent.title = 'First Concurrent Save Snapshot';
      markDirty('events', EVENT);
      h.holdWrite.value = true;
      pending = saveEvent(EVENT);
      await vi.waitFor(() => expect(h.releaseWrite.current).toBeTypeOf('function'));

      secondEvent.title = 'Second Concurrent Save Snapshot';
      markDirty('events', SIBLING);
      expect(await saveEvent(SIBLING)).toEqual({
        ok: false,
        error: `'${CRUSADE}' is already being saved. Try again when it finishes.`,
      });
      expect(h.writes, 'overlapping save must never reach disk').toHaveLength(0);
      expect(store.saving.has(CRUSADE)).toBe(true);

      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      expect((await pending).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('First Concurrent Save Snapshot');
      expect(h.disk.get(CRUSADE)).not.toContain('Second Concurrent Save Snapshot');
      expect(isDirty('events', SIBLING), 'the refused newer edit must remain dirty').toBe(true);

      expect((await saveEvent(SIBLING)).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('First Concurrent Save Snapshot');
      expect(h.disk.get(CRUSADE)).toContain('Second Concurrent Save Snapshot');
      expect(store.saving.has(CRUSADE)).toBe(false);
    } finally {
      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      if (pending) await pending;
      firstEvent.title = originalFirst;
      secondEvent.title = originalSecond;
      markDirty('events', EVENT);
      markDirty('events', SIBLING);
      await saveEvent(EVENT);
      await saveEvent(SIBLING);
    }
  });

  it('does not start a second core prose catalogue write while one is pending', async () => {
    h.holdWrite.value = true;
    const first = saveCoreProseCatalogue();
    try {
      expect(store.saving.has('messages.yaml')).toBe(true);
      expect(await saveCoreProseCatalogue()).toEqual({
        ok: false,
        error: "'messages.yaml' is already being saved. Try again when it finishes.",
      });
      expect(h.writes.filter((write) => write.path === 'messages.yaml')).toHaveLength(0);
      expect(store.saving.has('messages.yaml')).toBe(true);
    } finally {
      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      expect((await first).ok).toBe(true);
    }
    expect(h.writes.filter((write) => write.path === 'messages.yaml')).toHaveLength(1);
    expect(store.saving.has('messages.yaml')).toBe(false);
  });
});

describe('editing during an in-flight save (#947)', () => {
  it('keeps the new version dirty after an earlier snapshot has been written', async () => {
    const target = event(EVENT);
    const original = target.title;
    let pending: ReturnType<typeof saveEvent> | undefined;

    try {
      target.title = 'Snapshot Before Delay';
      markDirty('events', EVENT);

      h.holdWrite.value = true;
      pending = saveEvent(EVENT);
      expect(store.saving.has(CRUSADE)).toBe(true);

      // The user keeps typing while the first save is waiting on IPC/disk.
      target.title = 'Unsaved After Delay';
      markDirty('events', EVENT);

      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      expect((await pending).ok).toBe(true);
      expect(store.saving.has(CRUSADE)).toBe(false);
      expect(h.disk.get(CRUSADE)).toContain('Snapshot Before Delay');
      expect(h.disk.get(CRUSADE)).not.toContain('Unsaved After Delay');
      expect(isDirty('events', EVENT)).toBe(true);
      expect(pendingText('events', EVENT)!.after).toContain('Unsaved After Delay');

      expect((await saveEvent(EVENT)).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('Unsaved After Delay');
      expect(isDirty('events', EVENT)).toBe(false);
    } finally {
      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      if (pending) await pending;
      target.title = original;
      markDirty('events', EVENT);
      await saveEvent(EVENT);
    }
  });

  it('recovers from a rejected host write without stranding the saving indicator', async () => {
    const target = event(EVENT);
    const original = target.title;
    try {
      target.title = 'Edited Before Transport Failure';
      markDirty('events', EVENT);
      h.throwWrite.value = true;

      const result = await saveEvent(EVENT);
      expect(result).toEqual({ ok: false, error: 'transport unavailable' });
      expect(store.saving.has(CRUSADE)).toBe(false);
      expect(store.errors[CRUSADE]).toBe('transport unavailable');
      expect(isDirty('events', EVENT)).toBe(true);
      expect(h.disk.get(CRUSADE)).not.toContain('Edited Before Transport Failure');

      h.throwWrite.value = false;
      expect((await saveEvent(EVENT)).ok).toBe(true);
      expect(h.disk.get(CRUSADE)).toContain('Edited Before Transport Failure');
      expect(store.errors[CRUSADE]).toBeUndefined();
      expect(store.dirty.has(CRUSADE)).toBe(false);
    } finally {
      h.throwWrite.value = false;
      target.title = original;
      markDirty('events', EVENT);
      await saveEvent(EVENT);
    }
  });

  it('does not lose a sibling edit during a save of another item in the same file', async () => {
    const target = event(EVENT);
    const sibling = event(SIBLING);
    const targetOriginal = target.title;
    const siblingOriginal = sibling.title;
    let pending: ReturnType<typeof saveEvent> | undefined;

    try {
      target.title = 'Old File Snapshot';
      markDirty('events', EVENT);
      h.holdWrite.value = true;
      pending = saveEvent(EVENT);
      sibling.title = 'Sibling Changed During Save';
      markDirty('events', SIBLING);

      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      expect((await pending).ok).toBe(true);
      expect(isDirty('events', SIBLING)).toBe(true);
      expect(h.disk.get(CRUSADE)).not.toContain('Sibling Changed During Save');
      expect(pendingText('events', SIBLING)!.after).toContain('Sibling Changed During Save');

      expect((await saveEvent(SIBLING)).ok).toBe(true);
      expect(isDirty('events', EVENT)).toBe(false);
      expect(h.disk.get(CRUSADE)).toContain('Sibling Changed During Save');
    } finally {
      h.holdWrite.value = false;
      h.releaseWrite.current?.();
      if (pending) await pending;
      target.title = targetOriginal;
      sibling.title = siblingOriginal;
      markDirty('events', EVENT);
      markDirty('events', SIBLING);
      await saveEvent(EVENT);
      await saveEvent(SIBLING);
    }
  });
});

describe('a save patches one node and leaves the file alone', () => {
  it('keeps the header comments and every other entry', async () => {
    const before = h.disk.get(CRUSADE)!;
    const target = event(EVENT);
    target.title = 'A Shelf, Reconsidered';

    const res = await saveEvent(EVENT);
    expect(res.ok).toBe(true);

    const after = h.disk.get(CRUSADE)!;
    expect(after).not.toBe(before);
    expect(after).toContain('A Shelf, Reconsidered');

    // The file's header comment block is the thing a whole-file re-stringify
    // eats first, and nothing downstream would ever notice.
    expect(after).toContain('# THE CRUSADE — institutional register.');
    expect(after).toContain('Threshold rule, from the world file §14');

    // And the siblings are all still there.
    for (const id of [SIBLING, 'what_the_chapel_is_for', 'the_registrar_asks_for_the_book']) {
      expect(after, `${id} was lost by a save of ${EVENT}`).toContain(`id: ${id}`);
    }
  });

  it('leaves the sibling entries byte-for-byte untouched', async () => {
    const before = h.disk.get(CRUSADE)!;
    event(EVENT).weight = 61;
    await saveEvent(EVENT);
    const after = h.disk.get(CRUSADE)!;

    // The edited item re-serialises from its Zod-parsed state and may reformat
    // (the diff view exists to show exactly that). Everything ABOVE it in the
    // file must be identical, or the save is not the surgical patch it claims.
    const sliceTo = (text: string) => text.slice(0, text.indexOf(`  - id: ${EVENT}`));
    expect(sliceTo(after)).toBe(sliceTo(before));
  });

  it('clears the file from dirty and records nothing in errors', async () => {
    markDirty('events', EVENT);
    expect(store.dirty.has(CRUSADE)).toBe(true);

    await saveEvent(EVENT);

    expect(store.dirty.has(CRUSADE)).toBe(false);
    expect(store.errors[CRUSADE]).toBeUndefined();
    expect(store.saving.has(CRUSADE), 'the saving flag was left raised').toBe(false);
  });

  it('writes exactly one file, whatever else is dirty', async () => {
    markDirty('events', EVENT);
    markDirty('arcs', 'arc_the_eight_days');
    await saveEvent(EVENT);

    expect(h.writes.map((w) => w.path)).toEqual([CRUSADE]);
    // The other dirty file is still dirty. A save is per-item, not "save all".
    expect(store.dirty.has('arcs/eight_days.yaml')).toBe(true);
  });

  it('saves arcs and character templates through the same door', async () => {
    event(SIBLING); // fixture guard
    expect((await saveArc('arc_the_eight_days')).ok).toBe(true);
    expect((await saveCharacterTemplate('suitor_of_ilm')).ok).toBe(true);
    expect(h.writes.map((w) => w.path))
      .toEqual(['arcs/eight_days.yaml', 'characters/templates.yaml']);
  });

  it('refuses a stale disk snapshot after review without losing the draft (#1307)', async () => {
    const target = event(EVENT);
    const previousTitle = target.title;
    const originalDisk = h.disk.get(CRUSADE)!;
    try {
      target.title = 'A Draft After Review';
      markDirty('events', EVENT);
      expect(pendingText('events', EVENT)!.after).toContain('A Draft After Review');

      // An external editor or git changes the file AFTER the diff was shown.
      const externalDisk = `# outside edit after review\n${originalDisk}`;
      h.disk.set(CRUSADE, externalDisk);

      const res = await saveEvent(EVENT);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed on disk.*reload/i);
      expect(h.writes, 'the newer disk version must never be overwritten').toHaveLength(0);
      expect(h.disk.get(CRUSADE)).toBe(externalDisk);
      expect(store.dirty.has(CRUSADE), 'the unsaved draft must remain visible').toBe(true);
      expect(pendingText('events', EVENT)!.after).toContain('A Draft After Review');
    } finally {
      // Restore both sides so the shared real-content fixture remains valid.
      h.disk.set(CRUSADE, originalDisk);
      target.title = previousTitle;
      markDirty('events', EVENT);
      await saveEvent(EVENT);
    }
  });

  it('refuses to write when the current disk file cannot be read (#1307)', async () => {
    const originalDisk = h.disk.get(CRUSADE)!;
    try {
      markDirty('events', EVENT);
      h.disk.delete(CRUSADE);

      const res = await saveEvent(EVENT);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/cannot verify.*no such file/i);
      expect(h.writes).toHaveLength(0);
      expect(store.dirty.has(CRUSADE)).toBe(true);
    } finally {
      h.disk.set(CRUSADE, originalDisk);
    }
  });

  it('refuses shipped content when the host marks it reference-only', async () => {
    h.writable.value = false;
    markDirty('events', EVENT);
    const res = await saveEvent(EVENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shipped content.*read-only/i);
    expect(h.writes).toHaveLength(0);
    expect(store.dirty.has(CRUSADE)).toBe(true);
  });

  it('refuses an id it cannot place, and says which half is missing', async () => {
    const gone = await saveItem('events', 'no_such_event_anywhere');
    expect(gone.ok).toBe(false);
    expect(gone.error).toMatch(/not in any loaded file/);
    expect(h.writes).toHaveLength(0);
  });

  it('refuses an item that is in a file but not in the live model', async () => {
    // The file still holds it; the model no longer does. Writing here would
    // serialise `undefined` over a real entry.
    const idx = store.bundle.events.findIndex((e) => e.id === EVENT);
    const [removed] = store.bundle.events.splice(idx, 1);
    try {
      const res = await saveItem('events', EVENT);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not in the live model/);
      expect(h.writes).toHaveLength(0);
    } finally {
      store.bundle.events.splice(idx, 0, removed!);
    }
  });
});

describe('a save the disk refuses', () => {
  it('keeps the file dirty and records the error', async () => {
    h.refuse.value = true;
    markDirty('events', EVENT);
    const before = h.disk.get(CRUSADE)!;

    const res = await saveEvent(EVENT);

    expect(res.ok).toBe(false);
    expect(store.errors[CRUSADE]).toBe('refused by the path guard');
    // Still dirty: the edit is unwritten, and the UI must keep saying so.
    expect(store.dirty.has(CRUSADE)).toBe(true);
    expect(store.saving.has(CRUSADE), 'the saving flag was left raised on failure').toBe(false);
    expect(h.disk.get(CRUSADE)).toBe(before);
  });

  it('does not advance the diff baseline, so the next diff is still honest', async () => {
    h.refuse.value = true;
    event(EVENT).title = 'Refused Title';
    await saveEvent(EVENT);

    // `loadedText` must NOT have moved to the text that failed to land, or the
    // diff view would show an empty diff for an edit that is not on disk.
    const pending = pendingText('events', EVENT)!;
    expect(pending.before).not.toContain('Refused Title');
    expect(pending.after).toContain('Refused Title');
  });

  it('clears the error once a later save succeeds', async () => {
    h.refuse.value = true;
    await saveEvent(EVENT);
    expect(store.errors[CRUSADE]).toBeDefined();

    h.refuse.value = false;
    await saveEvent(EVENT);
    expect(store.errors[CRUSADE]).toBeUndefined();
  });
});

describe('previewing a save costs nothing', () => {
  it('shows the current file as `before` and the patched file as `after`', () => {
    event(EVENT).title = 'Previewed Only';
    const preview = pendingText('events', EVENT)!;

    expect(preview.path).toBe(CRUSADE);
    expect(preview.before).not.toContain('Previewed Only');
    expect(preview.after).toContain('Previewed Only');
    expect(preview.after).toContain('# THE CRUSADE — institutional register.');
  });

  it('does not write anything', () => {
    event(EVENT).title = 'Still Only A Preview';
    pendingText('events', EVENT);
    expect(h.writes).toHaveLength(0);
    expect(h.disk.get(CRUSADE)).not.toContain('Still Only A Preview');
  });

  /**
   * The one this file exists for. `pendingText` clones the document on
   * purpose; without the clone the preview PATCHES the shared document, and
   * the damage shows up on the next preview of a DIFFERENT item in the same
   * file — which still renders, still looks plausible, and now contains an
   * edit the author never made to an event they are not looking at.
   */
  it('does not leak one item\'s pending edit into another item\'s diff', () => {
    const siblingBefore = pendingText('events', SIBLING)!.after;

    event(EVENT).title = 'Contamination Check';
    expect(pendingText('events', EVENT)!.after).toContain('Contamination Check');

    const siblingAfter = pendingText('events', SIBLING)!;
    expect(siblingAfter.after).toBe(siblingBefore);
    expect(siblingAfter.after, "a preview mutated the document it was previewing")
      .not.toContain('Contamination Check');
    expect(siblingAfter.before).not.toContain('Contamination Check');
  });

  it('is repeatable — the same preview twice is the same text', () => {
    event(EVENT).title = 'Idempotent';
    expect(pendingText('events', EVENT)!.after).toBe(pendingText('events', EVENT)!.after);
  });

  it('has nothing to show for an id it cannot place', () => {
    expect(pendingText('events', 'no_such_event_anywhere')).toBeUndefined();
  });

  it('moves its baseline forward once the save lands', async () => {
    event(EVENT).title = 'Now Committed';
    expect(pendingText('events', EVENT)!.before).not.toContain('Now Committed');

    await saveEvent(EVENT);

    const after = pendingText('events', EVENT)!;
    expect(after.before).toContain('Now Committed');
    // Nothing pending any more: before and after agree.
    expect(after.after).toBe(after.before);
  });
});

describe('noticing that the file moved underneath us', () => {
  it('says no when the file on disk still matches what was loaded', async () => {
    expect(await externalChange(CRUSADE)).toEqual({ changed: false, text: h.disk.get(CRUSADE) });
  });

  it('says yes, and hands back the newer text, when something else wrote it', async () => {
    const originalDisk = h.disk.get(CRUSADE)!;
    try {
      h.disk.set(CRUSADE, `# touched by git\n${originalDisk}`);
      const res = await externalChange(CRUSADE);
      expect(res.changed).toBe(true);
      expect(res.text).toContain('# touched by git');
    } finally {
      h.disk.set(CRUSADE, originalDisk);
    }
  });

  it('goes quiet on a file it never loaded, rather than claiming a change', async () => {
    expect(await externalChange('events/not_a_file.yaml')).toEqual({ changed: false });
  });

  it('stops reporting a change once our own save is the newest thing on disk', async () => {
    event(EVENT).title = 'Ours Now';
    await saveEvent(EVENT);
    expect((await externalChange(CRUSADE)).changed).toBe(false);
  });
});

describe('creating something new by appending to a file', () => {
  const NEW_ID = 'a_brand_new_test_event';

  function draft(id = NEW_ID) {
    // A structurally valid event, cloned off a real one so it stays valid as
    // the schema grows. Only the identity changes.
    return { ...JSON.parse(JSON.stringify(event(EVENT))), id, title: 'A New Thing' };
  }

  function removeDraft(id = NEW_ID) {
    const i = store.bundle.events.findIndex((e) => e.id === id);
    if (i >= 0) store.bundle.events.splice(i, 1);
  }

  it('appends to the live model and to the file, and reports where it went', async () => {
    try {
      const res = await createItem('events', CRUSADE, draft());
      expect(res.ok).toBe(true);
      expect(res.path).toBe(CRUSADE);

      expect(store.bundle.events.some((e) => e.id === NEW_ID)).toBe(true);
      expect(fileOf('events', NEW_ID)).toBe(CRUSADE);
      expect(h.disk.get(CRUSADE)).toContain(`id: ${NEW_ID}`);
      // And it joined a file that still has everything it started with.
      expect(h.disk.get(CRUSADE)).toContain('# THE CRUSADE — institutional register.');
      expect(h.disk.get(CRUSADE)).toContain(`id: ${SIBLING}`);
    } finally {
      removeDraft();
    }
  });

  it('refuses a duplicate id instead of writing a second one', async () => {
    const res = await createItem('events', CRUSADE, draft(EVENT));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/);
    expect(h.writes).toHaveLength(0);
    expect(store.bundle.events.filter((e) => e.id === EVENT)).toHaveLength(1);
  });

  it('refuses a file it never loaded', async () => {
    const res = await createItem('events', 'events/nowhere.yaml', draft());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no loaded file/);
    expect(store.bundle.events.some((e) => e.id === NEW_ID)).toBe(false);
  });

  it('refuses a collection the bundle does not have', async () => {
    const res = await createItem('nonesuch', CRUSADE, draft());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no collection/);
    expect(h.writes).toHaveLength(0);
  });

  /**
   * Deliberate, and documented in `store.ts`: the live model is updated FIRST
   * and unconditionally. A new item the author can still see and keep editing
   * after a failed write is recoverable; one that vanished because the disk
   * said no is a lost draft that looks like a UI bug.
   */
  it('keeps the draft in the live model even when the write fails', async () => {
    h.refuse.value = true;
    try {
      const res = await createItem('events', CRUSADE, draft());
      expect(res.ok).toBe(false);
      expect(res.path).toBe(CRUSADE);

      expect(store.bundle.events.some((e) => e.id === NEW_ID), 'the draft was lost').toBe(true);
      expect(store.dirty.has(CRUSADE), 'the unsaved draft is not flagged unsaved').toBe(true);
      expect(store.errors[CRUSADE]).toBe('refused by the path guard');
    } finally {
      removeDraft();
    }
  });
});


describe('authored Plain English variants (#414)', () => {
  it('round-trips civilian applications, learned collaboration and outside training (#1877)', async () => {
    for (const id of ['setting_the_culverts', 'the_still_binding', 'the_mending_watch', 'the_readers_lamp', 'the_kiln_contract']) {
      const working = store.bundle.mysticWorkings.find(w => w.id === id)!;
      working.upkeep += .05;
      const expected = JSON.parse(JSON.stringify(working));
      markDirty('mysticWorkings', id);
      expect((await saveItem('mysticWorkings', id)).ok).toBe(true);
      const loaded = assembleBundle(Object.fromEntries(h.disk), parse);
      expect(loaded.mysticWorkings.find(w => w.id === id)).toEqual(expected);
    }
    const template = store.bundle.characterTemplates.find(p => p.id === 'warranted_life_reader')!;
    template.spellsKnown = [...template.spellsKnown!, 'lesser_workings_of_light'];
    markDirty('characterTemplates', template.id);
    expect((await saveCharacterTemplate(template.id)).ok).toBe(true);
    const loaded = assembleBundle(Object.fromEntries(h.disk), parse);
    expect(loaded.characterTemplates.find(p => p.id === template.id)?.spellsKnown).toEqual(template.spellsKnown);
  });
  it('round-trips an expedition support role without changing another working', async () => {
    const working = store.bundle.mysticWorkings.find(w => w.id === 'the_covered_approach')!;
    const sibling = structuredClone(rawContent().mysticWorking('the_returning_wind'));
    if (working.benefit.kind !== 'covert_support') throw new Error('expected expedition support');
    working.benefit.bonus = 0.12;
    working.preparation.crowns = 9;
    markDirty('mysticWorkings', working.id);
    expect((await saveItem('mysticWorkings', working.id)).ok).toBe(true);
    const reloaded = assembleBundle(Object.fromEntries(h.disk), parse);
    expect(reloaded.mysticWorkings.find(w => w.id === working.id)).toMatchObject({
      preparation: { crowns: 9 }, benefit: { kind: 'covert_support', role: 'approach', bonus: 0.12 },
    });
    expect(reloaded.mysticWorkings.find(w => w.id === sibling!.id)).toEqual(sibling);
  });
  it('round-trips a working’s typed benefit, cost and prose without changing a sibling', async () => {
    const working = store.bundle.mysticWorkings.find(w => w.id === 'the_bedside_thread')!;
    const sibling = structuredClone(rawContent().mysticWorking('the_door_lamp'));
    const address = 'content:mystic-workings.yaml#mysticWorkings[id=the_bedside_thread].description';
    working.preparation.crowns = 17;
    working.description = 'A reader keeps one named relative alive after a bodily injury.';
    if (working.benefit.kind !== 'household_protection') throw new Error('expected a protection working');
    working.benefit.bonus = 0.3;
    markDirty('mysticWorkings', working.id);
    const variant = stageProseVariant('mystic-workings.yaml', address, 'A learned reader helps one relative survive a physical injury.')!;
    variant.plainenglish = 'A learned reader helps one relative survive a physical injury.';
    const preview = pendingText('mysticWorkings', working.id)!;
    expect(preview.after).toContain('crowns: 17');
    expect((await saveItem('mysticWorkings', working.id)).ok).toBe(true);
    const reloaded = assembleBundle(Object.fromEntries(h.disk), parse);
    expect(reloaded.mysticWorkings.find(w => w.id === working.id)).toMatchObject({ preparation: { crowns: 17 }, benefit: { bonus: 0.3 } });
    expect(reloaded.mysticWorkings.find(w => w.id === 'the_door_lamp')).toEqual(sibling);
    expect(reloaded.proseVariants.find(v => v.address === address)?.plainenglish).toBe(variant.plainenglish);
  });
  it('writes Original and Plain English together and reloads both from the source file', async () => {
    const target = event(EVENT);
    const address = `content:${CRUSADE}#events[id=${EVENT}].title`;
    const originalBefore = target.title;

    target.title = 'A Shelf, Explained More Simply';
    markDirty('events', EVENT);
    const staged = stageProseVariant(CRUSADE, address, 'A simpler title for the shelf.');
    expect(staged).toBeDefined();
    // The shipped fixture may already have a counterpart. Staging returns that
    // live row; editing it is what the editor does in the second prose column.
    staged!.plainenglish = 'A simpler title for the shelf.';

    expect(staged).toMatchObject({ address, plainenglish: 'A simpler title for the shelf.' });
    expect(target.title).not.toBe(staged?.plainenglish);
    expect(store.dirty.has(CRUSADE)).toBe(true);

    const preview = pendingText('events', EVENT);
    expect(preview?.after).toContain('A Shelf, Explained More Simply');
    expect(preview?.after).toContain('A simpler title for the shelf.');
    expect(preview?.after).toContain('proseVariants:');

    const result = await saveEvent(EVENT);
    expect(result.ok).toBe(true);

    const written = parse(h.disk.get(CRUSADE)!) as {
      events: { id: string; title: string }[];
      proseVariants?: { address: string; plainenglish: string }[];
    };
    expect(written.events.find((candidate) => candidate.id === EVENT)?.title)
      .toBe('A Shelf, Explained More Simply');
    expect(written.proseVariants?.find((candidate) => candidate.address === address)?.plainenglish)
      .toBe('A simpler title for the shelf.');

    const reloaded = assembleBundle(Object.fromEntries(h.disk), parse);
    expect(reloaded.events.find((candidate) => candidate.id === EVENT)?.title)
      .toBe('A Shelf, Explained More Simply');
    expect(reloaded.proseVariants.find((candidate) => candidate.address === address)?.plainenglish)
      .toBe('A simpler title for the shelf.');

    // The two columns are independent values: staging/saving the counterpart
    // did not replace the authored Original.
    expect(reloaded.events.find((candidate) => candidate.id === EVENT)?.title)
      .not.toBe(reloaded.proseVariants.find((candidate) => candidate.address === address)?.plainenglish);
    expect(originalBefore).toBeTruthy();
  });

  it('removes a cleared counterpart instead of saving schema-invalid empty prose', async () => {
    const address = `content:${CRUSADE}#events[id=${EVENT}].body`;
    expect(stageProseVariant(CRUSADE, address, 'A direct version.')).toBeDefined();

    expect(removeProseVariant(CRUSADE, address)).toBe(true);
    expect(store.bundle.proseVariants.some((variant) => variant.address === address)).toBe(false);
    expect(store.dirty.has(CRUSADE)).toBe(true);

    const preview = pendingText('events', EVENT);
    expect(preview?.after).not.toContain(address);

    expect((await saveEvent(EVENT)).ok).toBe(true);
    expect(() => assembleBundle(Object.fromEntries(h.disk), parse)).not.toThrow();
    expect(assembleBundle(Object.fromEntries(h.disk), parse).proseVariants
      .some((variant) => variant.address === address)).toBe(false);
  });

  it('does not expose an already-authored counterpart in a read-only Mod Editor source file', () => {
    const authored = `content:${CRUSADE}#events[id=${EVENT}].title`;
    // Existing entries used to bypass the read-only check because staging
    // returned the mutable live row before testing source writability.
    const existing = store.bundle.proseVariants.find((variant) => variant.address === authored);
    expect(existing).toBeDefined();
    const originalWording = existing!.plainenglish;
    h.writable.value = false;
    const before = store.bundle.proseVariants.length;

    expect(stageProseVariant(CRUSADE, authored, 'An unauthorised edit.')).toBeUndefined();
    expect(stageProseVariant(CRUSADE, `content:${CRUSADE}#events[id=${EVENT}].body`, 'A direct version.'))
      .toBeUndefined();
    expect(existing!.plainenglish).toBe(originalWording);
    expect(store.bundle.proseVariants).toHaveLength(before);
    expect(store.dirty.has(CRUSADE)).toBe(false);
  });
});

describe('core prose messages.yaml authoring (#1011)', () => {
  const FILE = 'messages.yaml';
  const ADDRESS = 'core:messages#editor_test_roundtrip';
  const ORIGINAL = 'A witness took {PERSON} before the court.';
  const EDIT = { address: ADDRESS, original: ORIGINAL, plainenglish: '{PERSON} went to court with a witness.' };

  async function cleanUp() {
    h.refuse.value = false;
    h.writable.value = true;
    applyCoreProseEdits([{ ...EDIT, plainenglish: '' }]);
    await saveCoreProseCatalogue();
    h.writes.length = 0;
    store.dirty.clear();
  }

  it('refuses an external messages.yaml edit instead of overwriting it after review', async () => {
    const loaded = h.disk.get(FILE)!;
    try {
      expect(applyCoreProseEdits([EDIT]).ok).toBe(true);
      h.disk.set(FILE, loaded + '\n# Changed outside the editor\n');

      const result = await saveCoreProseCatalogue();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/changed on disk.*Reload/i);
      expect(store.errors[FILE]).toBe(result.error);
      expect(store.dirty.has(FILE)).toBe(true);
      expect(h.writes).toHaveLength(0);
      expect(h.disk.get(FILE)).toContain('Changed outside the editor');
      expect(pendingCoreProseText()!.before).toBe(loaded);
      expect(pendingCoreProseText()!.after).toContain(ADDRESS);
    } finally {
      h.disk.set(FILE, loaded);
      await cleanUp();
    }
  });

  it('fails closed when the current catalogue cannot be read', async () => {
    const loaded = h.disk.get(FILE)!;
    try {
      expect(applyCoreProseEdits([EDIT]).ok).toBe(true);
      h.disk.delete(FILE);

      const result = await saveCoreProseCatalogue();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Cannot verify.*messages.yaml.*no such file/i);
      expect(h.writes).toHaveLength(0);
      expect(store.dirty.has(FILE)).toBe(true);
    } finally {
      h.disk.set(FILE, loaded);
      await cleanUp();
    }
  });

  it('adds, previews and removes a core counterpart in its own YAML file, preserving header and siblings', async () => {
    const before = h.disk.get(FILE)!;
    expect(before).toContain('# Plain English counterparts for the engine');
    try {
      expect(applyCoreProseEdits([EDIT]).ok).toBe(true);
      expect(pendingCoreProseText()!.after).toContain(ADDRESS);
      expect(h.disk.get(FILE)).toBe(before); // a preview is not a write
      expect((await saveCoreProseCatalogue()).ok).toBe(true);
      const after = h.disk.get(FILE)!;
      expect(after).toContain(ADDRESS);
      expect(after).toContain('# Plain English counterparts for the engine');
      expect(after).toContain('core:messages#assize.the_assessors_call');
      expect(store.dirty.has(FILE)).toBe(false);

      expect(applyCoreProseEdits([{ ...EDIT, plainenglish: '' }]).ok).toBe(true);
      // File-level save must work after the removed row no longer has an id
      // for saveItem('proseVariants', address) to look up.
      expect((await saveCoreProseCatalogue()).ok).toBe(true);
      expect(h.disk.get(FILE)).not.toContain(ADDRESS);
      expect(h.disk.get(FILE)).toContain('core:messages#assize.the_assessors_call');
      expect(h.writes.every((write) => write.path === FILE)).toBe(true);
    } finally {
      await cleanUp();
    }
  });

  it('rejects malformed or repeated interpolation placeholders atomically', () => {
    const before = pendingCoreProseText()!.after;
    const result = applyCoreProseEdits([
      EDIT,
      { address: 'core:messages#another_test_key', original: '{PERSON} greeted {PERSON}.',
        plainenglish: '{PERSON} said hello.' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing.*\{PERSON\}/);
    expect(pendingCoreProseText()!.after).toBe(before);
    expect(store.bundle.proseVariants.some((v) => v.address === ADDRESS)).toBe(false);
  });

  it('refuses all shipped catalogue writes in Mod Editor mode', async () => {
    h.writable.value = false;
    try {
      expect(applyCoreProseEdits([EDIT]).ok).toBe(false);
      const result = await saveCoreProseCatalogue();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/read-only/i);
      expect(h.writes).toHaveLength(0);
    } finally {
      h.writable.value = true;
    }
  });

  it('retains edits and the diff baseline when the write transport fails', async () => {
    const before = h.disk.get(FILE)!;
    try {
      expect(applyCoreProseEdits([EDIT]).ok).toBe(true);
      h.refuse.value = true;
      const failure = await saveCoreProseCatalogue();
      expect(failure.ok).toBe(false);
      expect(store.errors[FILE]).toMatch(/refused/);
      expect(store.dirty.has(FILE)).toBe(true);
      expect(h.disk.get(FILE)).toBe(before);
      expect(pendingCoreProseText()!.before).toBe(before);
      expect(pendingCoreProseText()!.after).toContain(ADDRESS);

      h.refuse.value = false;
      expect((await saveCoreProseCatalogue()).ok).toBe(true);
      expect(store.errors[FILE]).toBeUndefined();
      expect(store.saving.has(FILE)).toBe(false);
    } finally {
      await cleanUp();
    }
  });
});


/**
 * Use the real pure registration helper while the rest of this suite's editor
 * transport stays mocked. Keep these regression tests in a measured file until
 * the P0 duration catalogue regeneration (#1538) can be completed.
 */
const { registerUserContent } = await vi.importActual<typeof import('./content.js')>('./content.js');

/**
 * A Mod Editor bundle must never contain one accepted user file from a
 * rejected batch. The global editor map and writable-path list are both
 * mutated by hydration, so testing only the thrown error would miss the bug.
 */
describe('Mod Editor content hydration (#1528)', () => {
  it('rejects a late shipped-file collision without accepting earlier files', () => {
    const shipped = {
      'events/shipped.yaml': 'shipped event',
      'characters/base.yaml': 'shipped character',
    };
    const allFiles: Record<string, string> = { ...shipped };
    const writable = new Set<string>(['events/previous-user.yaml']);
    // Sorting puts the otherwise valid arcs/ path before events/shipped.yaml.
    const incoming = {
      'arcs/new-user.yaml': 'new arc',
      'events/shipped.yaml': 'attempt to replace shipped event',
    };

    expect(() => registerUserContent(allFiles, writable, incoming))
      .toThrow("user content 'events/shipped.yaml' shadows a shipped file");
    expect(allFiles).toEqual(shipped);
    expect(writable).toEqual(new Set(['events/previous-user.yaml']));
    expect(allFiles).not.toHaveProperty('arcs/new-user.yaml');

    // Reattempting a valid batch after a failed one must work in-process.
    registerUserContent(allFiles, writable, { 'arcs/new-user.yaml': 'new arc' });
    expect(allFiles).toEqual({ ...shipped, 'arcs/new-user.yaml': 'new arc' });
    expect(writable).toEqual(new Set(['events/previous-user.yaml', 'arcs/new-user.yaml']));
  });

  it('registers all new paths and their text together when validation succeeds', () => {
    const allFiles: Record<string, string> = { 'events/shipped.yaml': 'shipped event' };
    const writable = new Set<string>();
    registerUserContent(allFiles, writable, {
      'events/user-b.yaml': 'second',
      'arcs/user-a.yaml': 'first',
    });

    expect(allFiles).toEqual({
      'events/shipped.yaml': 'shipped event',
      'arcs/user-a.yaml': 'first',
      'events/user-b.yaml': 'second',
    });
    expect(writable).toEqual(new Set(['arcs/user-a.yaml', 'events/user-b.yaml']));
    expect(() => registerUserContent(allFiles, writable, {})).not.toThrow();
  });
});

describe('the simulation reads plain data (#1891)', () => {
  /**
   * Every object reachable from `rawContent()`, with a visited set: indexes
   * are Maps over the same objects, and the bundle is a graph, not a tree.
   */
  function proxiesIn(root: unknown): string[] {
    const found: string[] = [];
    const seen = new Set<object>();
    const walk = (x: unknown, where: string) => {
      if (x === null || typeof x !== 'object' || seen.has(x)) return;
      seen.add(x);
      if (isProxy(x)) { found.push(where); return; }
      const entries = x instanceof Map ? [...x.entries()].map(([k, v]) => [String(k), v] as const)
        : x instanceof Set ? [...x].map((v, i) => [String(i), v] as const)
        : Object.entries(x);
      for (const [k, v] of entries) walk(v, `${where}.${k}`);
    };
    walk(root, 'content');
    return found;
  }

  it('hands core no Vue proxy anywhere in the indexed content', () => {
    // Chromium's structuredClone refuses a proxy and Node's accepts one, so a
    // world built here would pass either way. This is the check Node can make.
    expect(proxiesIn(rawContent()).slice(0, 5)).toEqual([]);
  });

  it('still sees an edit made through the reactive bundle', () => {
    const target = event(EVENT);
    const before = target.title;
    try {
      target.title = 'A Title Changed Through the Proxy';
      expect(rawContent().event(EVENT)?.title).toBe('A Title Changed Through the Proxy');
    } finally {
      target.title = before;
    }
  });

  it('bumps the revision on every route that marks an edit', async () => {
    let r = store.revision;
    markDirty('events', EVENT);
    expect(store.revision).toBeGreaterThan(r);

    // Before `locate`: an edit to an item no file holds is still an edit.
    r = store.revision;
    markDirty('events', 'no_such_event_anywhere');
    expect(store.revision).toBeGreaterThan(r);

    // The file-level route every prose mutator and `createItem` goes through.
    r = store.revision;
    markCoreProseDraftDirty();
    expect(store.revision).toBeGreaterThan(r);

    const id = 'a_revision_probe_event';
    r = store.revision;
    try {
      await createItem('events', CRUSADE, { ...JSON.parse(JSON.stringify(event(EVENT))), id });
      expect(store.revision).toBeGreaterThan(r);
    } finally {
      const i = store.bundle.events.findIndex((e) => e.id === id);
      if (i >= 0) store.bundle.events.splice(i, 1);
    }
  });
});


describe('schema-driven event metadata controls (#1888)', () => {
  it('connects the new event fields to the existing YAML save flow', () => {
    const components = join(import.meta.dirname, '..', 'components');
    const save = readFileSync(join(components, 'SaveControl.vue'), 'utf8');
    const metadata = readFileSync(join(components, 'EventMetadataEditor.vue'), 'utf8');
    const record = readFileSync(join(components, 'RecordEditor.vue'), 'utf8');
    const rumour = readFileSync(join(components, 'RumourEditor.vue'), 'utf8');
    expect(save).toContain('<EventMetadataEditor');
    expect(save).toContain("markDirty('events', editableEvent.value.id)");
    expect(metadata).toContain('PurposeS.options');
    expect(metadata).toContain('RecordBlockS.parse');
    expect(metadata).toContain("obligations.rumour === 'always'");
    expect(metadata).toContain('<RumourEditor');
    expect(record).toContain('fieldsOfSchema(RecordBlockS)');
    expect(record).toContain('<ClaimEditor');
    const claim = readFileSync(join(components, 'ClaimEditor.vue'), 'utf8');
    expect(claim).toContain('ClaimS.options');
    expect(claim).toContain('fieldsOfSchema(schema');
    expect(rumour).toContain('fieldsOfSchema(rumourSchema)');
  });

  for (const [key, patch] of [
    ['tier', (e: ReturnType<typeof event>) => { e.tier = e.tier === 'head' ? 'family' : 'head'; }],
    ['purposes', (e: ReturnType<typeof event>) => { e.purposes = ['plant_rumour', 'force_record_choice', 'buy_patience']; }],
    ['record', (e: ReturnType<typeof event>) => {
      e.record = {
        subject: 'A witnessed promise',
        options: {
          record: { chronicle: 'The promise was written.', effects: [], claims: [{ kind: 'deed', target: 'head', text: 'The archivist witnessed a promise.' }] },
          omit: { chronicle: null, effects: [] },
          embellish: {
            chronicle: 'Another account was written.', effects: [], claims: [],
            discrepancy: { id: 'an_account', severity: 'minor', provableBy: ['family_record'] },
          },
        },
      };
    }],
    ['rumour', (e: ReturnType<typeof event>) => { e.rumour = { id: 'authoring_test_rumour', accuracy: 0.7, spread: 0.5 }; }],
    ['site', (e: ReturnType<typeof event>) => { e.site = { kind: 'hall', hall: 'main', visitors: ['HEAD'] }; }],
    ['campaigns', (e: ReturnType<typeof event>) => { e.campaigns = ['short']; }],
    ['forcing', (e: ReturnType<typeof event>) => { e.forcing = { slot: 'HEAD', called: false }; }],
    ['weight', (e: ReturnType<typeof event>) => { e.weight += 7; }],
    ['cooldownYears', (e: ReturnType<typeof event>) => { e.cooldownYears += 1; }],
    ['repeatable', (e: ReturnType<typeof event>) => { e.repeatable = !e.repeatable; }],
    ['tags', (e: ReturnType<typeof event>) => { e.tags = [...e.tags, 'authoring_test_tag']; }],
    ['accounts', (e: ReturnType<typeof event>) => { e.accounts = ['The archivist', 'A neighbour']; }],
    ['ages', (e: ReturnType<typeof event>) => { e.ages = { only: ['the_plague'], never: ['the_withering'] }; }],
  ] as const) {
    it(`stages only the ${key} YAML field, keeping every sibling field untouched`, () => {
      const target = event(EVENT);
      const original = JSON.parse(JSON.stringify(target)) as Record<string, unknown>;
      try {
        patch(target);
        markDirty('events', EVENT);
        const staged = pendingText('events', EVENT);
        expect(staged).toBeDefined();
        const before = (parse(staged!.before) as { events: Record<string, unknown>[] }).events.find((e) => e.id === EVENT)!;
        const after = (parse(staged!.after) as { events: Record<string, unknown>[] }).events.find((e) => e.id === EVENT)!;
        expect(after[key]).not.toEqual(before[key]);
        delete before[key];
        delete after[key];
        expect(after).toEqual(before);
      } finally {
        for (const key of Object.keys(target)) {
          if (!(key in original)) delete (target as unknown as Record<string, unknown>)[key];
        }
        Object.assign(target, original);
        markDirty('events', EVENT);
      }
    });
  }
});

describe('authored outcome site and guard controls (#1888)', () => {
  it('reuses the schema variant and filter forms, not free-form JSON', () => {
    const components = join(import.meta.dirname, '..', 'components');
    const site = readFileSync(join(components, 'SceneSiteEditor.vue'), 'utf8');
    const guard = readFileSync(join(components, 'OutcomeGuardEditor.vue'), 'utf8');
    const graph = readFileSync(join(components, 'OutcomeGraph.vue'), 'utf8');
    expect(site).toContain('SceneSiteS.options');
    expect(site).toContain('fieldsOfSchema(schema');
    expect(guard).toContain('<FilterBuilder');
    expect(graph).toContain('<SceneSiteEditor');
    expect(graph).toContain('<OutcomeGuardEditor');
    expect(graph).toContain('CompareOpS.options');
    expect(graph).toContain('OutcomeS.shape.triggers.unwrap().shape.op.options');
  });

  it('stages an outcome guard and site without changing another outcome or any event metadata', () => {
    const target = store.bundle.events.find((e) => e.interaction.kind !== 'narration'
      && e.interaction.choices.some((c) => c.outcomes.length > 0));
    expect(target).toBeDefined();
    const original = JSON.parse(JSON.stringify(target));
    try {
      if (!target || target.interaction.kind === 'narration') return;
      const choice = target.interaction.choices.find((c) => c.outcomes.length > 0)!;
      const outcome = choice.outcomes[0]!;
      outcome.site = { kind: 'hall', hall: 'main', visitors: ['HEAD'] };
      outcome.onlyIf = { slot: Object.keys(target.slots)[0] ?? 'HEAD', filters: [{ awakened: true }] };
      outcome.triggers = { arc: store.bundle.arcs[0]?.id ?? '', op: 'start' };
      markDirty('events', target.id);
      const staged = pendingText('events', target.id)!;
      const getEvent = (text: string) => (parse(text) as { events: { id: string; interaction: unknown }[] })
        .events.find((e) => e.id === target.id)!;
      const before = getEvent(staged.before);
      const after = getEvent(staged.after);
      expect(after.interaction).not.toEqual(before.interaction);
      delete before.interaction;
      delete after.interaction;
      expect(after).toEqual(before);
    } finally {
      if (target) {
        for (const key of Object.keys(target)) {
          if (!(key in original)) delete (target as unknown as Record<string, unknown>)[key];
        }
        Object.assign(target, original);
        markDirty('events', target.id);
      }
    }
  });
});

describe('authored frame and choice-specific Record fields (#1888)', () => {
  it('builds the frame read form from the Zod union variants', () => {
    const components = join(import.meta.dirname, '..', 'components');
    const frame = readFileSync(join(components, 'FrameReadsEditor.vue'), 'utf8');
    const metadata = readFileSync(join(components, 'EventMetadataEditor.vue'), 'utf8');
    expect(frame).toContain('FrameReadS.options');
    expect(frame).toContain('fieldsOfSchema(schema)');
    expect(metadata).toContain('<FrameReadsEditor');
    expect(metadata).toContain('selectorIds(scope)');
    expect(metadata).toContain('<RecordEditor :record="row"');
  });

  it('only stages the reads field when a frame event is given a different reading', () => {
    const target = store.bundle.events.find((e) => e.tier === 'frame');
    expect(target).toBeDefined();
    if (!target) return;
    const original = JSON.parse(JSON.stringify(target));
    try {
      target.reads = [{ omitted: { atLeast: 91 } }];
      markDirty('events', target.id);
      const staged = pendingText('events', target.id)!;
      const find = (text: string) => (parse(text) as { events: Record<string, unknown>[] }).events.find((e) => e.id === target.id)!;
      // The write-back store deliberately serialises Zod-supplied defaults
      // on an edited item. Compare *semantic* schema-normalized siblings so
      // absent defaults (tags, weight, slot fields, etc.) don't look like
      // unrelated edits; the authored record still has to differ in reads.
      const before = EventTemplateS.parse(find(staged.before));
      const after = EventTemplateS.parse(find(staged.after));
      expect(after.reads).not.toEqual(before.reads);
      const { reads: _beforeReads, ...beforeSiblings } = before;
      const { reads: _afterReads, ...afterSiblings } = after;
      expect(afterSiblings).toEqual(beforeSiblings);
    } finally {
      for (const key of Object.keys(target)) if (!(key in original)) delete (target as unknown as Record<string, unknown>)[key];
      Object.assign(target, original);
      markDirty('events', target.id);
    }
  });

  for (const key of ['recordByChoice', 'recordByOutcome'] as const) {
    it(`stages only ${key} when selecting a real choice/outcome`, () => {
      const target = store.bundle.events.find((e) => e.interaction.kind !== 'narration' && e.interaction.choices.length > 0);
      expect(target).toBeDefined();
      if (!target || target.interaction.kind === 'narration') return;
      const original = JSON.parse(JSON.stringify(target));
      try {
        const choice = target.interaction.choices[0]!;
        const id = key === 'recordByChoice' ? choice.id : choice.id + '/' + choice.outcomes[0]!.id;
        const record = RecordBlockS.parse({
          subject: 'Witnessed in the hall',
          options: {
            record: { chronicle: 'The family wrote the truth.' },
            omit: { chronicle: null },
            embellish: {
              chronicle: 'The family wrote a lie.',
              discrepancy: { id: 'test_record_lie', severity: 'minor', provableBy: ['record_keeper'] },
            },
          },
        });
        target[key] = [{ ...record, id }];
        markDirty('events', target.id);
        const staged = pendingText('events', target.id)!;
        const find = (text: string) => (parse(text) as { events: Record<string, unknown>[] }).events.find((e) => e.id === target.id)!;
        const before = find(staged.before);
        const after = find(staged.after);
        expect(after[key]).not.toEqual(before[key]);
        delete after[key];
        delete before[key];
        expect(after).toEqual(before);
      } finally {
        for (const name of Object.keys(target)) {
          if (!(name in original)) delete (target as unknown as Record<string, unknown>)[name];
        }
        Object.assign(target, original);
        markDirty('events', target.id);
      }
    });
  }
});

describe('typed primordial response authoring (#1888)', () => {
  it('uses schema-derived price and response fields rather than free-form JSON', () => {
    const component = readFileSync(join(import.meta.dirname, '..', 'components', 'PrimordialEditor.vue'), 'utf8');
    expect(component).toContain('fieldsOfSchema(AgreedPriceS)');
    expect(component).toContain('fieldsOfSchema(PrimordialResponseS)');
    expect(component).toContain('AgreedPriceS.parse');
    expect(component).toContain('PrimordialResponseS.parse');
    expect(component).toContain('<EffectEditor');
    expect(component).toContain('<RecordEditor');
    expect(component).not.toContain('JSON.stringify(outcome.');
    expect(component).not.toContain('JSON.parse(text)');
  });
});

describe('safe event duplication (#1888)', () => {
  it('offers the next unused snake_case ID and refuses an existing ID', () => {
    const source = event(EVENT);
    const id = suggestedDuplicateId(store.bundle, source);
    expect(id).toMatch(/^[a-z0-9_]+$/);
    expect(store.bundle.events.some((e) => e.id === id)).toBe(false);
    expect(duplicateEventDraft(store.bundle, source, source.id)).toEqual({
      ok: false, error: `Event '${source.id}' already exists.`,
    });
  });

  it('refuses events named by authored substory nodes and follow-ups', () => {
    const referenced = store.bundle.arcs.flatMap((arc) => arc.nodes.map((node) => node.event))
      .find((id) => store.bundle.events.some((e) => e.id === id));
    expect(referenced).toBeDefined();
    const source = event(referenced!);
    const refs = eventBackreferences(store.bundle, source.id);
    expect(refs.some((ref) => ref.startsWith('arc '))).toBe(true);
    const result = duplicateEventDraft(store.bundle, source, suggestedDuplicateId(store.bundle, source));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('referenced by');
  });

  it('creates a valid detached copy without changing the source', () => {
    const source = store.bundle.events.find((e) => !e.arc && e.frequency === 'common'
      && eventBackreferences(store.bundle, e.id).length === 0
      && (e.interaction.kind === 'narration' ? e.interaction.outcomes
        : e.interaction.choices.flatMap((choice) => choice.outcomes))
        .every((outcome) => !outcome.next && !outcome.primordial?.next));
    expect(source).toBeDefined();
    if (!source) return;
    const before = JSON.parse(JSON.stringify(source));
    const id = suggestedDuplicateId(store.bundle, source);
    const result = duplicateEventDraft(store.bundle, source, id);
    expect(result.ok, result.ok ? undefined : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toBe(id);
    expect(result.event.title).toBe(source.title + ' (copy)');
    expect(result.event).not.toBe(source);
    expect(source).toEqual(before);
    expect(store.bundle.events.some((e) => e.id === id)).toBe(false);
  });

  it('exposes duplication only through the existing writable Save panel', () => {
    const componentPath = join(import.meta.dirname, '..', 'components');
    const controls = readFileSync(join(componentPath, 'EventDuplicate.vue'), 'utf8');
    const save = readFileSync(join(componentPath, 'SaveControl.vue'), 'utf8');
    expect(controls).toContain("filesHolding('events')");
    expect(controls).toContain('blockedByEdit');
    expect(controls).toContain("createItem('events'");
    expect(save).toContain('<EventDuplicate v-if="editableEvent"');
  });
});

describe('nested event-reference safety (#1888)', () => {
  it('finds schedule effects nested under outcome bundles, not just next or arc nodes', () => {
    const carrier = event(EVENT);
    const outcomes = carrier.interaction.kind === 'narration'
      ? carrier.interaction.outcomes : carrier.interaction.choices[0]!.outcomes;
    const outcome = outcomes[0]!;
    const before = [...outcome.effects];
    try {
      outcome.effects.push({ kind: 'schedule', event: SIBLING, inYears: 1 });
      const refs = eventBackreferences(store.bundle, SIBLING);
      expect(refs.some((where) => where.includes('.effects[') && where.endsWith('.event'))).toBe(true);
      expect(eventDeletionBlockers(store.bundle, SIBLING).length).toBeGreaterThan(0);
    } finally {
      outcome.effects = before;
    }
  });
});

describe('reference-safe event deletion (#1888)', () => {
  it('refuses to preview an event used by a substory, and a dirty file', () => {
    const linked = store.bundle.arcs.flatMap((arc) => arc.nodes.map((node) => node.event))
      .find((id) => store.bundle.events.some((e) => e.id === id));
    expect(linked).toBeDefined();
    expect(eventDeletionBlockers(store.bundle, linked!).some((path) => path.startsWith('arc '))).toBe(true);
    const linkedPreview = pendingDeleteEvent(linked!);
    expect(linkedPreview.ok).toBe(false);

    markDirty('events', EVENT);
    const dirtyPreview = pendingDeleteEvent(EVENT);
    expect(dirtyPreview.ok).toBe(false);
    if (!dirtyPreview.ok) expect(dirtyPreview.error).toContain('Save or resolve other edits');
    expect(event(EVENT).id).toBe(EVENT);
  });

  it('keeps the whole source file intact if the delete write is refused', async () => {
    // A temporary standalone row: the real authored files still contain their
    // header comments and siblings when this test finishes.
    const source = event(EVENT);
    const id = 'test_delete_refused_event';
    const fresh = JSON.parse(JSON.stringify(source));
    fresh.id = id;
    delete fresh.arc;
    const created = await createItem('events', CRUSADE, fresh);
    expect(created.ok).toBe(true);
    const initial = h.disk.get(CRUSADE)!;
    try {
      expect(pendingDeleteEvent(id).ok).toBe(true);
      h.refuse.value = true;
      const rejected = await deleteEvent(id);
      expect(rejected.ok).toBe(false);
      expect(fileOf('events', id)).toBe(CRUSADE);
      expect(h.disk.get(CRUSADE)).toBe(initial);
    } finally {
      h.refuse.value = false;
      expect((await deleteEvent(id)).ok).toBe(true);
    }
  });

  it('previews and deletes only a standalone row, preserving the sibling event and comments', async () => {
    const id = 'test_delete_standalone_event';
    const fresh = JSON.parse(JSON.stringify(event(EVENT)));
    fresh.id = id;
    delete fresh.arc;
    const created = await createItem('events', CRUSADE, fresh);
    expect(created.ok).toBe(true);
    const before = h.disk.get(CRUSADE)!;
    const sibling = event(SIBLING);
    const siblingSnapshot = JSON.parse(JSON.stringify(sibling));
    const reviewed = pendingDeleteEvent(id);
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.before).toBe(before);
    expect(reviewed.after).not.toContain(`id: ${id}`);
    const result = await deleteEvent(id);
    expect(result.ok).toBe(true);
    expect(fileOf('events', id)).toBeUndefined();
    expect(store.bundle.events.some((event) => event.id === id)).toBe(false);
    expect(h.disk.get(CRUSADE)).toBe(reviewed.after);
    expect(h.disk.get(CRUSADE)).toContain('id: ' + SIBLING);
    expect(h.disk.get(CRUSADE)).toContain('#');
    expect(sibling).toEqual(siblingSnapshot);
  });

  it('wires a typed confirmation and an actual diff to the event Save panel', () => {
    const components = join(import.meta.dirname, '..', 'components');
    const deletion = readFileSync(join(components, 'EventDelete.vue'), 'utf8');
    const save = readFileSync(join(components, 'SaveControl.vue'), 'utf8');
    expect(deletion).toContain('pendingDeleteEvent');
    expect(deletion).toContain('externalChange');
    expect(deletion).toContain('<DiffView');
    expect(deletion).toContain('confirmation.value !== props.id');
    expect(save).toContain('<EventDelete v-if="editableEvent"');
  });
});

describe('validation locations map to exact event IDs (#1888)', () => {
  it('matches nested paths but not similarly prefixed event IDs', () => {
    expect(eventIssueId({ where: 'event:abc' })).toBe('abc');
    expect(eventIssueId({ where: 'event:abc/interaction/outcomes' })).toBe('abc');
    expect(eventIssueId({ where: 'event:abc.title' })).toBe('abc');
    expect(eventIssueId({ where: 'arc:abc' })).toBeUndefined();
    expect(eventIssueId({ where: 'event:abc-extra' })).toBeUndefined();
    expect(eventIssueId({ where: 'event:' })).toBeUndefined();
  });
});

describe('new Rare event starter guards (#1888)', () => {
  it('starts with distinct lasting choice consequences, not two empty outcomes', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'components', 'EventEditor.vue'), 'utf8');
    expect(source).toContain("effects: [{ kind: 'respect', delta: 1 }]");
    expect(source).toContain("effects: [{ kind: 'respect', delta: -1 }]");
  });

  it('chooses an existing authored house for a newly added Record discrepancy', () => {
    const components = join(import.meta.dirname, '..', 'components');
    expect(store.bundle.houses.length).toBeGreaterThan(0);
    for (const component of ['EventMetadataEditor.vue', 'PrimordialEditor.vue']) {
      const source = readFileSync(join(components, component), 'utf8');
      expect(source).toContain("store.bundle.houses[0]?.id");
      expect(source).not.toContain("provableBy: ['family_record']");
    }
  });
});
