import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, saveGame } from '@ed/core';
import { Directory, Encoding } from '@capacitor/filesystem';
import { createGame } from './lib/game.js';
import { browserPlatform, platformForWindow, type Platform } from './platform.js';
import { mobileStorage } from '../../mobile/src/storage.js';

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
