import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { assembleBundle } from '@ed/schema';

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
  createItem, externalChange, removeProseVariant, stageProseVariant,
} = await import('./store.js');

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
  h.writes.length = 0;
  h.refuse.value = false;
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
    h.disk.set(CRUSADE, `# touched by git\n${h.disk.get(CRUSADE)}`);
    const res = await externalChange(CRUSADE);
    expect(res.changed).toBe(true);
    expect(res.text).toContain('# touched by git');
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
