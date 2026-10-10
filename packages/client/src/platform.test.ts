import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, digestOf, loadGame, runYears, saveGame } from '@ed/core';
import { Directory, Encoding } from '@capacitor/filesystem';
import { createGame } from './lib/game.js';
import {
  browserPlatform,
  platformForWindow,
  type Platform,
  type SmokeCommand,
  type SmokeResult,
} from './platform.js';
import { mobileStorage } from '../../mobile/src/storage.js';
import { readSave as readDesktopSave, saveRoot, writeSave as writeDesktopSave } from '../../shell/src/saves.mjs';

function bridge(): Platform {
  return {
    listSaves: async () => [], readSave: async () => null, writeSave: async () => undefined,
    deleteSave: async () => undefined, readLibrary: async () => null, writeLibrary: async () => undefined,
    readUserContent: async () => ({}),
    exportSave: async () => undefined, importSave: async () => null,
    onPause: () => () => undefined, onBack: () => () => undefined,
  };
}

function memoryPlatform(): Platform & { saves: Map<string, unknown>; unlocks: string[] } {
  const saves = new Map<string, unknown>();
  const unlocks: string[] = [];
  let library: unknown | null = null;
  return {
    saves,
    unlocks,
    listSaves: async () => [...saves].map(([slot, save]) => ({ slot, ...(save as { year?: number }) })),
    readSave: async (slot) => saves.get(slot) ?? null,
    writeSave: async (slot, save) => { saves.set(slot, save); },
    deleteSave: async (slot) => { saves.delete(slot); },
    readLibrary: async () => library,
    writeLibrary: async (next) => { library = next; },
    unlockAchievement: async (id) => { unlocks.push(id); },
    readUserContent: async () => ({}),
    exportSave: async () => undefined, importSave: async () => null,
    onPause: () => () => undefined, onBack: () => () => undefined,
  };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if ((path.endsWith('.ts') || path.endsWith('.vue')) && !path.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('autosave mutation ordering', () => {
  function deferred(): {
    host: Platform & { saves: Map<string, unknown> };
    writes: Array<{ save: unknown; resolve: () => void; reject: () => void }>;
    deletes: Array<{ resolve: () => void }>;
  } {
    const host = memoryPlatform();
    const writes: Array<{ save: unknown; resolve: () => void; reject: () => void }> = [];
    const deletes: Array<{ resolve: () => void }> = [];

    host.writeSave = (slot, save) => new Promise<void>((resolve, reject) => {
      writes.push({
        save,
        resolve: () => { host.saves.set(slot, save); resolve(); },
        reject: () => reject(new Error('host refused write')),
      });
    });
    host.deleteSave = (slot) => new Promise<void>((resolve) => {
      deletes.push({
        resolve: () => { host.saves.delete(slot); resolve(); },
      });
    });

    return { host, writes, deletes };
  }

  async function turnQueue(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('serializes snapshots so an older slow write cannot complete after a newer one', async () => {
    const { host, writes } = deferred();
    const game = createGame(loadContent(), host);

    game.actions.begin(27901);
    game.actions.begin(27902);
    await turnQueue();

    // The hostile host is holding the first write open. Before #279 the
    // second write was already in flight and could finish first.
    expect(writes).toHaveLength(1);
    const first = writes[0]!;
    first.resolve();
    await turnQueue();

    expect(writes).toHaveLength(2);
    const second = writes[1]!;
    expect(second.save).not.toBe(first.save);
    second.resolve();
    await turnQueue();

    expect(host.saves.get('autosave')).toBe(second.save);
    expect(game.saveStatus.value).toBe('saved');
  });

  it('lets a later save succeed after an earlier host write fails', async () => {
    const { host, writes } = deferred();
    const game = createGame(loadContent(), host);

    game.actions.begin(27911);
    game.actions.begin(27912);
    await turnQueue();

    expect(writes).toHaveLength(1);
    writes[0]!.reject();
    await turnQueue();

    expect(writes).toHaveLength(2);
    // The first rejection is stale because the second save was already
    // requested; it must not flash a false error over the newer intent.
    expect(game.saveStatus.value).toBe('saving');
    writes[1]!.resolve();
    await turnQueue();

    expect(host.saves.get('autosave')).toBe(writes[1]!.save);
    expect(game.saveStatus.value).toBe('saved');
    expect(game.resumable.value).toBe(true);
  });

  it('orders restart deletion after an in-flight write so the discarded run cannot return', async () => {
    const { host, writes, deletes } = deferred();
    const game = createGame(loadContent(), host);

    game.actions.begin(27921);
    await turnQueue();
    expect(writes).toHaveLength(1);

    game.actions.restart();
    await turnQueue();
    expect(deletes).toHaveLength(0);
    expect(game.resumable.value).toBe(false);
    expect(game.saveStatus.value).toBe('idle');

    writes[0]!.resolve();
    await turnQueue();
    expect(host.saves.has('autosave')).toBe(true);
    expect(deletes).toHaveLength(1);

    deletes[0]!.resolve();
    await turnQueue();
    expect(host.saves.has('autosave')).toBe(false);
    expect(game.resumable.value).toBe(false);
    expect(game.saveStatus.value).toBe('idle');
  });

  it('leaves for the front door without deleting the run and resumes the exact snapshot', async () => {
    const host = memoryPlatform();
    let deletes = 0;
    const deleteSave = host.deleteSave;
    host.deleteSave = async (slot) => {
      deletes += 1;
      await deleteSave(slot);
    };
    const game = createGame(loadContent(), host);

    game.actions.begin(35612);
    game.actions.found({
      houseName: 'House Kept',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
    });
    game.actions.enter();
    const before = game.view.value;

    game.actions.leave();

    expect(game.view.value).toBeNull();
    expect(game.resumable.value).toBe(true);
    expect(deletes).toBe(0);

    await expect(game.actions.resume()).resolves.toBe(true);
    expect(game.view.value).toEqual(before);

    // The serialized autosave tail may still be draining, but leaving must
    // never enqueue the destructive restart path.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deletes).toBe(0);
    expect(host.saves.get('autosave')).toBeTruthy();
  });

  it('keeps demo persistence out of the normal full-campaign save namespace', async () => {
    const host = memoryPlatform();
    const source = loadContent();
    const fullSave = saveGame(bootstrap(source, 32321, 1042, 'short'));
    host.saves.set('autosave', fullSave);

    const game = createGame(source, host);
    await turnQueue();
    expect(game.resumable.value).toBe(true);

    game.actions.begin(32322, 'demo');
    await turnQueue();

    expect(host.saves.get('autosave')).toEqual(fullSave);
    expect(host.saves.get('demo-autosave')).toMatchObject({ campaign: 'demo' });
    await expect(game.actions.listSaves()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slot: 'demo-autosave' })]),
    );

    // Restarting the miniature run clears its private slot only. The real
    // sitting remains the thing "Continue the last sitting" will resume.
    game.actions.restart();
    await turnQueue();
    expect(host.saves.has('demo-autosave')).toBe(false);
    expect(host.saves.get('autosave')).toEqual(fullSave);
    expect(game.resumable.value).toBe(true);
  });

  it('lets a slow full-autosave read finish while the demo is saving', async () => {
    const host = memoryPlatform();
    const source = loadContent();
    const fullSave = saveGame(bootstrap(source, 32331, 1042, 'short'));
    let answerRead: ((save: unknown) => void) | undefined;
    host.readSave = async (slot) => {
      if (slot !== 'autosave') return host.saves.get(slot) ?? null;
      return new Promise<unknown>((resolve) => { answerRead = resolve; });
    };

    const game = createGame(source, host);
    game.actions.begin(32332, 'demo');
    await turnQueue();

    expect(host.saves.get('demo-autosave')).toMatchObject({ campaign: 'demo' });
    expect(game.resumable.value).toBe(false);

    answerRead?.(fullSave);
    await turnQueue();

    expect(game.resumable.value).toBe(true);
    await expect(game.actions.resume()).resolves.toBe(true);
    expect(game.view.value?.campaign.id).toBe('short');
  });

  it('does not let a later demo write hide a failed full autosave', async () => {
    const { host, writes } = deferred();
    const game = createGame(loadContent(), host);

    game.actions.begin(32341, 'short');
    game.actions.begin(32342, 'demo');
    await turnQueue();

    // The shared host queue is still serialized, but the second mutation is
    // a different persistence namespace and must not make the first failure stale.
    expect(writes).toHaveLength(1);
    writes[0]!.reject();
    await turnQueue();

    expect(writes).toHaveLength(2);
    expect(game.resumable.value).toBe(false);
    expect(game.saveStatus.value).toBe('saving');

    writes[1]!.resolve();
    await turnQueue();

    expect(host.saves.has('autosave')).toBe(false);
    expect(host.saves.get('demo-autosave')).toMatchObject({ campaign: 'demo' });
    expect(game.resumable.value).toBe(false);
    expect(game.saveStatus.value).toBe('saved');
  });
});

describe('the platform seam', () => {
  it('takes an injected host whole, rather than detecting one below composition', async () => {
    const injected = bridge();
    const platform = platformForWindow({ edPlatform: injected } as Window);
    expect(platform).toBe(injected);
    await expect(platform.readSave('autosave')).resolves.toBeNull();
  });

  it('gives the browser durable named saves when no host bridge exists', async () => {
    const values = new Map<string, string>();
    const storage = {
      get length() { return values.size; },
      key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    } as Storage;
    const prior = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
    try {
      const platform = browserPlatform();
      await platform.writeSave('first', { format: 15, year: 1111, savedAt: '2026-09-13T00:00:00.000Z' });
      await platform.writeSave('second', { format: 15, year: 1200, savedAt: '2026-09-14T00:00:00.000Z' });
      await expect(platform.readSave('first')).resolves.toMatchObject({ year: 1111 });
      await expect(platform.readUserContent()).resolves.toEqual({});
      await expect(platform.listSaves()).resolves.toMatchObject([{ slot: 'second' }, { slot: 'first' }]);
      await platform.deleteSave('first');
      await expect(platform.readSave('first')).resolves.toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prior });
    }
  });

  it('rejects browser deletion when localStorage access is denied (#899)', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage(): Storage {
          throw new Error('site storage blocked');
        },
      },
    });
    try {
      const host = browserPlatform();
      // Unlike readSave (which can report missing data), deletion is a
      // mutation: a denied write cannot be presented as a successful delete.
      await expect(host.deleteSave('autosave'))
        .rejects.toThrow('this browser does not permit saved data');
      await expect(host.writeSave('autosave', { year: 1220 }))
        .rejects.toThrow('this browser does not permit saved data');
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('deletes only the named browser slot and propagates removeItem failures (#899)', async () => {
    const values = new Map([
      ['ed:save:autosave', 'old run'],
      ['ed:save:other', 'keep this run'],
      ['ed:library', 'keep this library'],
    ]);
    let denyRemoval = false;
    const storage = {
      removeItem(key: string) {
        if (denyRemoval) throw new Error('storage refused deletion');
        values.delete(key);
      },
    } as Storage;
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    try {
      const host = browserPlatform();
      denyRemoval = true;
      await expect(host.deleteSave('autosave')).rejects.toThrow('storage refused deletion');
      expect(values.has('ed:save:autosave')).toBe(true);
      denyRemoval = false;
      await expect(host.deleteSave('autosave')).resolves.toBeUndefined();
      expect([...values]).toEqual([
        ['ed:save:other', 'keep this run'],
        ['ed:library', 'keep this library'],
      ]);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('keeps healthy browser saves visible when another slot has malformed JSON', async () => {
    // A failed import or damaged localStorage record must not make every other
    // saved dynasty disappear from the front-door list.
    const values = new Map<string, string>([['ed:save:damaged', '{invalid json']]);
    const storage = {
      get length() { return values.size; },
      key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    } as Storage;
    const prior = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
    try {
      const platform = browserPlatform();
      await platform.writeSave('older', { format: 28, year: 1142, savedAt: '2026-10-08T00:00:00.000Z' });
      await platform.writeSave('newer', { format: 28, year: 1222, savedAt: '2026-10-09T00:00:00.000Z' });

      await expect(platform.readSave('damaged')).resolves.toBeNull();
      await expect(platform.listSaves()).resolves.toEqual([
        { slot: 'newer', year: 1222, format: 28, savedAt: '2026-10-09T00:00:00.000Z' },
        { slot: 'older', year: 1142, format: 28, savedAt: '2026-10-08T00:00:00.000Z' },
      ]);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prior });
    }
  });

  it('keeps browser JSON save downloads alive until their URL can safely be revoked (#1012)', async () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousURL = Object.getOwnPropertyDescriptor(globalThis, 'URL');
    const steps: string[] = [];
    const blobs: Blob[] = [];
    let attached = false;
    let failClick = false;
    const link = {
      href: '',
      download: '',
      hidden: false,
      click() {
        expect(attached, 'the anchor must be in the document before click').toBe(true);
        steps.push('click');
        if (failClick) throw new Error('browser blocked the download');
      },
      remove() {
        steps.push('remove');
        attached = false;
      },
    };
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:json-save-${blobs.length}`;
    });
    const revokeObjectURL = vi.fn((url: string) => { steps.push(`revoke:${url}`); });

    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'URL', {
      configurable: true, value: { createObjectURL, revokeObjectURL },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement(tag: string) {
          expect(tag).toBe('a');
          return link;
        },
        body: {
          appendChild(child: unknown) {
            expect(child).toBe(link);
            attached = true;
            steps.push('append');
          },
        },
      },
    });

    try {
      const host = browserPlatform();
      await host.exportSave({ format: 28, year: 1342, houseName: 'House of Salt' });

      expect(link.href).toBe('blob:json-save-1');
      expect(link.download).toBe('eldritch-1342.json');
      expect(link.hidden).toBe(true);
      expect(steps).toEqual(['append', 'click', 'remove']);
      expect(attached).toBe(false);
      expect(blobs[0]!.type).toBe('application/json');
      expect(await blobs[0]!.text()).toBe(JSON.stringify({
        format: 28, year: 1342, houseName: 'House of Salt',
      }, null, 2));

      vi.advanceTimersByTime(59_999);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:json-save-1');

      // The helper also cleans up and releases the URL after a blocked click.
      failClick = true;
      await expect(host.exportSave({ format: 28 })).rejects.toThrow('browser blocked the download');
      expect(link.download).toBe('eldritch-run.json');
      expect(attached).toBe(false);
      expect(steps.slice(-2)).toEqual(['click', 'remove']);
      vi.advanceTimersByTime(60_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:json-save-2');
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (previousURL) Object.defineProperty(globalThis, 'URL', previousURL);
      else Reflect.deleteProperty(globalThis, 'URL');
    }
  });

  it('settles browser imports for a cancelled picker, empty selection and JSON content', async () => {
    // Node-hosted fake: exercise the actual browser Platform without opening a
    // window, using the file input's distinct cancel and change events.
    const state: {
      input?: {
        files: File[];
        accept: string;
        onchange: (() => void) | null;
        cancel: (() => void) | null;
      };
      reader?: {
        onabort: (() => void) | null;
        onerror: (() => void) | null;
      };
    } = {};
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const oldReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement(tag: string) {
          expect(tag).toBe('input');
          const picker = {
            type: '',
            accept: '',
            files: [] as File[],
            onchange: null as (() => void) | null,
            cancel: null as (() => void) | null,
            addEventListener(event: string, listener: () => void) {
              if (event === 'cancel') picker.cancel = listener;
            },
            click() {},
          };
          state.input = picker;
          return picker;
        },
      },
    });
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: class {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        constructor() { state.reader = this; }
        readAsText(file: File) {
          const fixture = (file as File & { fixture: string }).fixture;
          if (fixture === 'throw-read') throw new Error('FileReader unavailable');
          if (fixture === 'abort-read' || fixture === 'error-read') return;
          this.result = fixture;
          this.onload?.();
        }
      },
    });

    try {
      const host = browserPlatform();
      const cancelled = host.importSave();
      expect(state.input?.accept).toBe('application/json,.json,.edsave');
      expect(state.input?.cancel).toBeTypeOf('function');
      state.input!.cancel!();
      await expect(cancelled).resolves.toBeNull();

      const empty = host.importSave();
      state.input!.onchange!();
      await expect(empty).resolves.toBeNull();

      const valid = host.importSave();
      state.input!.files = [{ fixture: '{"format":28,"year":1142}' } as File & { fixture: string }];
      state.input!.onchange!();
      await expect(valid).resolves.toEqual({ format: 28, year: 1142 });

      const invalid = host.importSave();
      state.input!.files = [{ fixture: '{bad JSON' } as File & { fixture: string }];
      state.input!.onchange!();
      await expect(invalid).resolves.toBeNull();

      const aborted = host.importSave();
      state.input!.files = [{ fixture: 'abort-read' } as File & { fixture: string }];
      state.input!.onchange!();
      expect(state.reader?.onabort).toBeTypeOf('function');
      state.reader!.onabort!();
      await expect(aborted).resolves.toBeNull();

      const errored = host.importSave();
      state.input!.files = [{ fixture: 'error-read' } as File & { fixture: string }];
      state.input!.onchange!();
      state.reader!.onerror!();
      await expect(errored).resolves.toBeNull();

      const thrown = host.importSave();
      state.input!.files = [{ fixture: 'throw-read' } as File & { fixture: string }];
      // The exception is thrown from the change callback, not the Promise executor.
      expect(() => state.input!.onchange!()).not.toThrow();
      await expect(thrown).resolves.toBeNull();
    } finally {
      if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (oldReader) Object.defineProperty(globalThis, 'FileReader', oldReader);
      else Reflect.deleteProperty(globalThis, 'FileReader');
    }
  });

  it('round-trips the profile library separately from save slots in a browser', async () => {
    const values = new Map<string, string>();
    const storage = {
      get length() { return values.size; },
      key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    } as Storage;
    const prior = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
    try {
      const platform = browserPlatform();
      const library = { format: 1, runs: [{ id: 'old-house' }] };
      await platform.writeLibrary(library);
      await expect(platform.readLibrary()).resolves.toEqual(library);
      await expect(platform.listSaves()).resolves.toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prior });
    }
  });

  it('archives a completed run into the profile library', async () => {
    const host = memoryPlatform();
    const source = loadContent();
    const ctx = bootstrap(source, 8181, 1042, 'short');
    const person = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]!;
    ctx.world.founding = {
      houseName: 'House Remembered',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      answers: {},
      year: 1042,
    };
    ctx.world.chronicle.push({
      id: 'remembered_page',
      year: 1200,
      weight: 'paragraph',
      text: `${person.name} was entered in the book as untouched.`,
      named: true,
      record: 'record',
      claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 0 }],
    });
    ctx.world.ending = { id: 'forgotten', year: 1342 };
    host.saves.set('finished', saveGame(ctx));

    const game = createGame(source, host);
    await game.actions.load('finished');
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(host.readLibrary()).resolves.toMatchObject({
      format: 1,
      runs: [{ seed: 8181, house: 'House Remembered', endedYear: 1342 }],
    });
    expect(host.unlocks).toContain('ending_forgotten');

    // Loading/refreshing the same completed house again re-evaluates pure
    // facts, but must not spam the profile backend with a second unlock call.
    await game.actions.load('finished');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.unlocks.filter((id) => id === 'ending_forgotten')).toHaveLength(1);
  });

  it('deduplicates an in-flight achievement unlock, then retries after rejection', async () => {
    const host = memoryPlatform();
    const source = loadContent();
    const ctx = bootstrap(source, 82323, 1042, 'short');
    ctx.world.founding = {
      houseName: 'House Retry',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      answers: {},
      year: 1042,
    };
    ctx.world.ending = { id: 'forgotten', year: 1342 };
    host.saves.set('finished-retry', saveGame(ctx));

    const attempts: Array<{
      id: string;
      resolve: () => void;
      reject: () => void;
    }> = [];
    host.unlockAchievement = (id) => new Promise<void>((resolve, reject) => {
      attempts.push({
        id,
        resolve,
        reject: () => reject(new Error('backend unavailable')),
      });
    });

    const game = createGame(source, host);
    const forgottenAttempts = () => attempts.filter((attempt) => attempt.id === 'ending_forgotten');

    await game.actions.load('finished-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forgottenAttempts()).toHaveLength(1);

    // Re-evaluation while the backend call is unresolved must not issue a
    // second request for the same profile-wide achievement.
    await game.actions.load('finished-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forgottenAttempts()).toHaveLength(1);

    forgottenAttempts()[0]!.reject();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A failed call was never delivered, so the next evaluation retries it.
    await game.actions.load('finished-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forgottenAttempts()).toHaveLength(2);

    forgottenAttempts()[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Once the host confirms success, later evaluations stay de-duplicated.
    await game.actions.load('finished-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forgottenAttempts()).toHaveLength(2);
  });

  it('retries an achievement after the host throws synchronously', async () => {
    const host = memoryPlatform();
    const source = loadContent();
    const ctx = bootstrap(source, 82324, 1042, 'short');
    ctx.world.founding = {
      houseName: 'House Throw',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      answers: {},
      year: 1042,
    };
    ctx.world.ending = { id: 'forgotten', year: 1342 };
    host.saves.set('finished-throw', saveGame(ctx));

    let attempts = 0;
    host.unlockAchievement = () => {
      attempts += 1;
      if (attempts === 1) throw new Error('bridge unavailable');
      return Promise.resolve();
    };

    const game = createGame(source, host);

    await expect(game.actions.load('finished-throw')).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempts).toBe(1);

    await expect(game.actions.load('finished-throw')).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempts).toBe(2);

    await game.actions.load('finished-throw');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempts).toBe(2);
  });

  it('round-trips the same snapshot through separate host implementations', async () => {
    const first = memoryPlatform();
    const source = loadContent();
    const game = createGame(source, first);
    game.actions.begin(1042);
    game.actions.advance(1);
    // Autosaves are serialized: the 1043 snapshot is queued behind the
    // immediately-resolving 1042 write. Give that promise tail one event-loop
    // turn to drain before reading the host.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = first.saves.get('autosave');
    expect(saved).toMatchObject({ format: expect.any(Number), year: 1043 });

    const second = memoryPlatform();
    second.saves.set('from elsewhere', saved!);
    const resumed = createGame(source, second);
    await expect(resumed.actions.load('from elsewhere')).resolves.toBe(true);
    expect(resumed.view.value?.year).toBe(1043);
  });

  it('does not name a host anywhere in the client', () => {
    const forbidden = /userAgent|capacitor|electron|isAndroid|isIOS|process\.platform/i;
    const offenders = sourceFiles(join(import.meta.dirname))
      .filter((path) => forbidden.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('the mobile bridge stays interchangeable with every other host', () => {
  const clientSource = readFileSync(join(import.meta.dirname, 'platform.ts'), 'utf8');
  const mobileSource = readFileSync(
    join(import.meta.dirname, '../../mobile/src/platform-bridge.ts'),
    'utf8',
  );

  function acceptList(source: string): string {
    const value = /input\.accept\s*=\s*'([^']+)'/.exec(source)?.[1];
    if (value === undefined) throw new Error('host has no import accept list');
    return value;
  }

  it('type-checks the real mobile object against the client-owned Platform contract', () => {
    expect(mobileSource).toContain("import type { Platform } from '../../client/src/platform.js';");
    expect(mobileSource).toContain("import { mobileStorage, saveSummary } from './storage.js';");
    expect(mobileSource).toContain('} satisfies Platform;');
    expect(mobileSource).toContain('Object.assign(window, { edPlatform: platform });');
  });

  it('imports the same interchange files and exports JSON on browser and mobile hosts', () => {
    expect(acceptList(mobileSource)).toBe(acceptList(clientSource));
    expect(mobileSource).toMatch(/const name = `eldritch-\$\{[^}]+\}\.json`/);
    expect(clientSource).toMatch(/link\.download = `eldritch-\$\{[^}]+\}\.json`/);
  });
});

describe('native runtime smoke seam', () => {
  it('drives a real save, cold resume, export, and import through the client store', async () => {
    const host = memoryPlatform();
    const nativeWrite = host.writeSave;
    host.writeSave = (slot, save) => nativeWrite(slot, JSON.parse(JSON.stringify(save)));
    const interchange = new Map<string, unknown>();
    let smoke: ((command: SmokeCommand) => Promise<SmokeResult>) | undefined;
    host.onSmokeCommand = (listener) => {
      smoke = listener;
      return () => { smoke = undefined; };
    };
    host.writeSmokeInterchange = async (save) => {
      interchange.set('eldritch-smoke-export.json', save);
      return 'eldritch-smoke-export.json';
    };
    host.readSmokeInterchange = async (path) => interchange.get(path) ?? null;

    createGame(loadContent(), host);
    expect(smoke).toBeTypeOf('function');
    const saved = await smoke!({ kind: 'save', seed: 1042, years: 40 });
    expect(saved).toMatchObject({ year: 1082, snapshot: { year: 1082, campaign: 'short' } });

    // Reconstruct the store as a terminated/relaunched WebView would. The
    // platform map is the durable native Data directory shared by both lives.
    createGame(loadContent(), host);
    expect(smoke).toBeTypeOf('function');
    const resumed = await smoke!({ kind: 'resume' });
    expect(resumed.snapshot).toMatchObject({ year: 1082, campaign: 'short' });

    const exported = await smoke!({ kind: 'export' });
    expect(exported.path).toBe('eldritch-smoke-export.json');
    expect(interchange.get(exported.path!)).toEqual(exported.snapshot);

    const imported = await smoke!({ kind: 'import', path: exported.path! });
    expect(imported.snapshot).toMatchObject({ year: 1082, campaign: 'short' });
    expect(host.saves.get('autosave')).toEqual(imported.snapshot);
  });
});

const MOBILE_MISSING = { code: 'OS-PLUG-FILE-0008' };

function mobileFileStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: Array<{ path: string; directory: Directory; encoding: Encoding; recursive?: boolean }> = [];
  return {
    data,
    writes,
    async readdir({ path, directory }: { path: string; directory: Directory }) {
      const prefix = `${path}/`;
      const files = [...data.keys()]
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .filter((candidate) => candidate && !candidate.includes('/'))
        .map((name) => ({ name, type: 'file' as const }));
      if (!files.length && ![...data.keys()].some((candidate) => candidate.startsWith(prefix))) {
        throw MOBILE_MISSING;
      }
      expect(directory).toBe(Directory.Data);
      return { files };
    },
    async readFile({ path, directory, encoding }: {
      path: string;
      directory: Directory;
      encoding: Encoding;
    }) {
      expect(directory).toBe(Directory.Data);
      expect(encoding).toBe(Encoding.UTF8);
      const value = data.get(path);
      if (value === undefined) throw MOBILE_MISSING;
      return { data: value };
    },
    async writeFile({ path, data: value, directory, encoding, recursive }: {
      path: string;
      data: string;
      directory: Directory;
      encoding: Encoding;
      recursive?: boolean;
    }) {
      writes.push({ path, directory, encoding, recursive });
      data.set(path, value);
      return { uri: path };
    },
    async deleteFile({ path, directory }: { path: string; directory: Directory }) {
      expect(directory).toBe(Directory.Data);
      if (!data.delete(path)) throw MOBILE_MISSING;
    },
  };
}

function mobilePreferenceStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async keys() { return { keys: [...data.keys()] }; },
    async get({ key }: { key: string }) { return { value: data.get(key) ?? null }; },
    async remove({ key }: { key: string }) { data.delete(key); },
  };
}

describe('Windows to Android saved-game transfer (Refs #322)', () => {
  it('reads the real shell JSON from disk and continues bit-identically through mobile storage', async () => {
    const content = loadContent();
    const original = bootstrap(content, 32209, 1042, 'short');
    runYears(original, 24);

    // The Electron host writes a JSON file; the Capacitor host persists the
    // imported JSON in Directory.Data. Exercise those real storage functions
    // rather than two memoryPlatform mocks, without booting either native UI.
    const userData = mkdtempSync(join(tmpdir(), 'ed-cross-host-'));
    try {
      const desktopRoot = saveRoot(userData);
      const file = writeDesktopSave(desktopRoot, 'windows run', saveGame(original));
      const transferJson = readFileSync(file, 'utf8');
      const mobileFiles = mobileFileStore();
      const android = mobileStorage(mobileFiles, mobilePreferenceStore());

      await android.writeSave('imported Windows run', JSON.parse(transferJson));
      expect(mobileFiles.data.get('eldritch/saves/imported%20Windows%20run.json'))
        .toBe(transferJson);

      const fromWindows = loadGame(readDesktopSave(desktopRoot, 'windows run'), content);
      const fromAndroid = loadGame(await android.readSave('imported Windows run'), content);
      runYears(original, 20);
      runYears(fromWindows, 20);
      runYears(fromAndroid, 20);

      // The digest ignores serialization/property order but not simulation
      // state. Both hosts must continue like the unpaused original timeline.
      expect(digestOf(fromAndroid)).toBe(digestOf(fromWindows));
      expect(digestOf(fromAndroid)).toBe(digestOf(original));
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

describe('mobile durable storage', () => {
  it('stores opaque saves and the Library in the app-owned Data directory', async () => {
    const files = mobileFileStore();
    const preferences = mobilePreferenceStore();
    const store = mobileStorage(files, preferences);
    const save = { format: 27, year: 1201, nested: { exact: ['opaque', 7] } };
    const library = { format: 1, runs: [{ seed: 19 }] };

    await store.writeSave('autosave', save);
    await store.writeLibrary(library);

    expect(files.data.get('eldritch/saves/autosave.json')).toBe(JSON.stringify(save));
    expect(files.data.get('eldritch/library.json')).toBe(JSON.stringify(library));
    expect(files.writes).toEqual([
      expect.objectContaining({ path: 'eldritch/saves/autosave.json', directory: Directory.Data, recursive: true }),
      expect.objectContaining({ path: 'eldritch/library.json', directory: Directory.Data, recursive: true }),
    ]);
    await expect(store.readSave('autosave')).resolves.toEqual(save);
    await expect(store.readLibrary()).resolves.toEqual(library);
  });

  it('round-trips arbitrary slot names without turning them into paths', async () => {
    const files = mobileFileStore();
    const store = mobileStorage(files, mobilePreferenceStore());

    await store.writeSave('old house / 2', { format: 27, year: 1300 });

    expect(files.data.has('eldritch/saves/old%20house%20%2F%202.json')).toBe(true);
    await expect(store.listSaves()).resolves.toMatchObject([
      { slot: 'old house / 2', year: 1300, format: 27 },
    ]);
  });

  it('migrates existing Android Preference saves only after a durable write succeeds', async () => {
    const files = mobileFileStore();
    const preferences = mobilePreferenceStore({
      'ed:save:autosave': JSON.stringify({
        format: 27,
        year: 1199,
        savedAt: '2026-09-30T00:00:00.000Z',
      }),
      'ed:library': JSON.stringify({ format: 1, runs: [{ seed: 91 }] }),
    });
    const store = mobileStorage(files, preferences);

    await expect(store.listSaves()).resolves.toMatchObject([
      { slot: 'autosave', year: 1199, format: 27 },
    ]);
    expect(preferences.data.has('ed:save:autosave')).toBe(false);
    expect(files.data.has('eldritch/saves/autosave.json')).toBe(true);

    await expect(store.readLibrary()).resolves.toEqual({ format: 1, runs: [{ seed: 91 }] });
    expect(preferences.data.has('ed:library')).toBe(false);
    expect(files.data.has('eldritch/library.json')).toBe(true);
  });

  it('keeps a legacy save readable when migration cannot write the file', async () => {
    const base = mobileFileStore();
    const preferences = mobilePreferenceStore({
      'ed:save:autosave': JSON.stringify({ format: 27, year: 1177 }),
    });
    const files = {
      ...base,
      async writeFile() { throw new Error('disk unavailable'); },
    };
    const store = mobileStorage(files, preferences);

    await expect(store.readSave('autosave')).resolves.toEqual({ format: 27, year: 1177 });
    expect(preferences.data.has('ed:save:autosave')).toBe(true);
  });

  it('ignores malformed snapshots without making the whole save list unreadable', async () => {
    const files = mobileFileStore({
      'eldritch/saves/bad.json': '{',
      'eldritch/saves/good.json': JSON.stringify({
        format: 27,
        year: 1234,
        savedAt: '2026-10-01T00:00:00.000Z',
      }),
    });
    const store = mobileStorage(files, mobilePreferenceStore());

    await expect(store.listSaves()).resolves.toEqual([
      { slot: 'good', format: 27, year: 1234, savedAt: '2026-10-01T00:00:00.000Z' },
    ]);
  });


  it('does not resurrect an older Preferences save over malformed native JSON (#900)', async () => {
    const path = 'eldritch/saves/autosave.json';
    const broken = '{"format":28,"year":1250';
    const old = JSON.stringify({ format: 27, year: 1100 });
    const files = mobileFileStore({ [path]: broken });
    const preferences = mobilePreferenceStore({ 'ed:save:autosave': old });
    const store = mobileStorage(files, preferences);

    await expect(store.readSave('autosave')).resolves.toBeNull();
    expect(files.data.get(path)).toBe(broken);
    expect(preferences.data.get('ed:save:autosave')).toBe(old);
    expect(files.writes).toEqual([]);
  });

  it('does not overwrite malformed native saves while listing older Preferences keys (#900)', async () => {
    const path = 'eldritch/saves/autosave.json';
    const broken = '{"format":28';
    const old = JSON.stringify({ format: 27, year: 1111 });
    const files = mobileFileStore({
      [path]: broken,
      'eldritch/saves/healthy.json': JSON.stringify({ format: 28, year: 1300 }),
    });
    const preferences = mobilePreferenceStore({ 'ed:save:autosave': old });
    const store = mobileStorage(files, preferences);

    // A corrupt slot remains omitted, as before, without hiding healthy saves
    // or treating the corrupt native file as a migration destination.
    await expect(store.listSaves()).resolves.toEqual([
      { slot: 'healthy', format: 28, year: 1300, savedAt: undefined },
    ]);
    expect(files.data.get(path)).toBe(broken);
    expect(preferences.data.get('ed:save:autosave')).toBe(old);
    expect(files.writes).toEqual([]);
  });

  it('does not replace malformed native Library JSON with a stale legacy copy (#900)', async () => {
    const path = 'eldritch/library.json';
    const broken = '{"format":1,"runs":[';
    const old = JSON.stringify({ format: 1, runs: [{ year: 1100 }] });
    const files = mobileFileStore({ [path]: broken });
    const preferences = mobilePreferenceStore({ 'ed:library': old });
    const store = mobileStorage(files, preferences);

    await expect(store.readLibrary()).resolves.toBeNull();
    expect(files.data.get(path)).toBe(broken);
    expect(preferences.data.get('ed:library')).toBe(old);
    expect(files.writes).toEqual([]);
  });

  it('keeps the newer durable save when legacy key cleanup fails during deletion (#895)', async () => {
    const newer = { format: 27, year: 1250 };
    const older = { format: 27, year: 1100 };
    const path = 'eldritch/saves/autosave.json';
    const legacyKey = 'ed:save:autosave';
    const files = mobileFileStore({ [path]: JSON.stringify(newer) });
    const preferences = mobilePreferenceStore({ [legacyKey]: JSON.stringify(older) });
    const failingPreferences = {
      ...preferences,
      async remove() { throw new Error('Preferences store unavailable'); },
    };
    const store = mobileStorage(files, failingPreferences);

    await expect(store.deleteSave('autosave')).rejects.toThrow('Preferences store unavailable');
    expect(files.data.get(path)).toBe(JSON.stringify(newer));
    expect(preferences.data.get(legacyKey)).toBe(JSON.stringify(older));

    // A failed deletion must not silently downgrade to the old snapshot
    // through readSave/listSaves' ordinary legacy-migration fallback.
    await expect(store.readSave('autosave')).resolves.toEqual(newer);
    await expect(store.listSaves()).resolves.toEqual([
      { slot: 'autosave', year: 1250, format: 27, savedAt: undefined },
    ]);
    expect(files.data.get(path)).toBe(JSON.stringify(newer));
  });

  it('preserves the native save if its deletion fails after clearing the legacy key (#895)', async () => {
    const path = 'eldritch/saves/autosave.json';
    const fileStore = mobileFileStore({
      [path]: JSON.stringify({ format: 27, year: 1250 }),
    });
    const files = {
      ...fileStore,
      async deleteFile() { throw new Error('native delete refused'); },
    };
    const preferences = mobilePreferenceStore({
      'ed:save:autosave': JSON.stringify({ format: 27, year: 1100 }),
    });
    const store = mobileStorage(files, preferences);

    await expect(store.deleteSave('autosave')).rejects.toThrow('native delete refused');
    expect(preferences.data.has('ed:save:autosave')).toBe(false);
    expect(fileStore.data.has(path)).toBe(true);
    await expect(store.readSave('autosave')).resolves.toEqual({ format: 27, year: 1250 });
  });

  it('deletes both durable and pre-migration copies of a slot', async () => {
    const files = mobileFileStore({
      'eldritch/saves/autosave.json': JSON.stringify({ format: 27, year: 1200 }),
    });
    const preferences = mobilePreferenceStore({
      'ed:save:autosave': JSON.stringify({ format: 27, year: 1199 }),
    });
    const store = mobileStorage(files, preferences);

    await store.deleteSave('autosave');

    expect(files.data.has('eldritch/saves/autosave.json')).toBe(false);
    expect(preferences.data.has('ed:save:autosave')).toBe(false);
    await expect(store.readSave('autosave')).resolves.toBeNull();
  });
});

describe('browser save export cleanup (Closes #893)', () => {
  it('releases the save blob on success, failed anchor creation and failed download dispatch', async () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:eldritch-export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const links: Array<{ href: string; download: string }> = [];
    let dispatched = 0;
    let failAt: 'none' | 'element' | 'click' = 'none';

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement(tag: string) {
          expect(tag).toBe('a');
          if (failAt === 'element') throw new Error('anchor creation refused');
          const link = {
            href: '',
            download: '',
            click() {
              dispatched += 1;
              if (failAt === 'click') throw new Error('download dispatch refused');
            },
          };
          links.push(link);
          return link;
        },
      },
    });

    try {
      const host = browserPlatform();
      await expect(host.exportSave({ year: 1220, format: 28 })).resolves.toBeUndefined();
      expect(links[0]).toMatchObject({
        href: 'blob:eldritch-export',
        download: 'eldritch-1220.json',
      });
      const blob = create.mock.calls[0]?.[0] as Blob;
      expect(blob.type).toBe('application/json');
      await expect(blob.text()).resolves.toBe(JSON.stringify({ year: 1220, format: 28 }, null, 2));
      expect(dispatched).toBe(1);
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenLastCalledWith('blob:eldritch-export');

      failAt = 'element';
      await expect(host.exportSave({ year: 1221 })).rejects.toThrow('anchor creation refused');
      expect(revoke).toHaveBeenCalledTimes(2);
      expect(revoke).toHaveBeenLastCalledWith('blob:eldritch-export');

      failAt = 'click';
      await expect(host.exportSave({ year: 1222 })).rejects.toThrow('download dispatch refused');
      expect(dispatched).toBe(2);
      expect(revoke).toHaveBeenCalledTimes(3);
      expect(revoke).toHaveBeenLastCalledWith('blob:eldritch-export');
      expect(create).toHaveBeenCalledTimes(3);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
});
