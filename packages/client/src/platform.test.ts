import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, saveGame } from '@ed/core';
import { createGame } from './lib/game.js';
import { browserPlatform, platformForWindow, type Platform } from './platform.js';

function bridge(): Platform {
  return {
    listSaves: async () => [], readSave: async () => null, writeSave: async () => undefined,
    deleteSave: async () => undefined, readLibrary: async () => null, writeLibrary: async () => undefined,
    readUserContent: async () => ({}),
    exportSave: async () => undefined, importSave: async () => null,
    onPause: () => () => undefined, onBack: () => () => undefined,
  };
}

function memoryPlatform(): Platform & { saves: Map<string, unknown> } {
  const saves = new Map<string, unknown>();
  let library: unknown | null = null;
  return {
    saves,
    listSaves: async () => [...saves].map(([slot, save]) => ({ slot, ...(save as { year?: number }) })),
    readSave: async (slot) => saves.get(slot) ?? null,
    writeSave: async (slot, save) => { saves.set(slot, save); },
    deleteSave: async (slot) => { saves.delete(slot); },
    readLibrary: async () => library,
    writeLibrary: async (next) => { library = next; },
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
    const forbidden = /userAgent|capacitor|electron|isAndroid|process\.platform/i;
    const offenders = sourceFiles(join(import.meta.dirname))
      .filter((path) => forbidden.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('the Android bridge stays interchangeable with every other host', () => {
  const clientSource = readFileSync(join(import.meta.dirname, 'platform.ts'), 'utf8');
  const androidSource = readFileSync(
    join(import.meta.dirname, '../../mobile/src/platform-bridge.ts'),
    'utf8',
  );

  function stringConstant(source: string, name: string): string {
    const value = new RegExp(`const ${name} = '([^']+)'`).exec(source)?.[1];
    if (value === undefined) throw new Error(`missing ${name}`);
    return value;
  }

  function acceptList(source: string): string {
    const value = /input\.accept\s*=\s*'([^']+)'/.exec(source)?.[1];
    if (value === undefined) throw new Error('host has no import accept list');
    return value;
  }

  function methodBlock(source: string, name: string, next: string): string {
    const start = source.indexOf(`async ${name}(`);
    const end = source.indexOf(`async ${next}(`, start + 1);
    if (start < 0 || end < 0) throw new Error(`cannot isolate Android ${name}()`);
    return source.slice(start, end);
  }

  it('type-checks the real Android object against the client-owned Platform contract', () => {
    expect(androidSource).toContain("import type { Platform } from '../../client/src/platform.js';");
    expect(androidSource).toContain('} satisfies Platform;');
    expect(androidSource).toContain('Object.assign(window, { edPlatform: platform });');
  });

  it('uses the same save and library namespaces as the browser host', () => {
    expect(stringConstant(androidSource, 'PREFIX')).toBe(stringConstant(clientSource, 'PREFIX'));
    expect(stringConstant(androidSource, 'LIBRARY_KEY')).toBe(stringConstant(clientSource, 'LIBRARY_KEY'));
  });

  it('keeps save payloads opaque instead of translating them in the Android shell', () => {
    const read = methodBlock(androidSource, 'readSave', 'writeSave');
    const write = methodBlock(androidSource, 'writeSave', 'deleteSave');

    expect(read).toContain('return value ? JSON.parse(value) : null;');
    expect(write).toContain('value: JSON.stringify(save)');
    expect(write).not.toMatch(/\b(format|year|savedAt)\s*:/);
  });

  it('imports the same interchange files and exports JSON on both hosts', () => {
    expect(acceptList(androidSource)).toBe(acceptList(clientSource));
    expect(androidSource).toMatch(/const name = `eldritch-\$\{[^}]+\}\.json`/);
    expect(clientSource).toMatch(/link\.download = `eldritch-\$\{[^}]+\}\.json`/);
  });
});

