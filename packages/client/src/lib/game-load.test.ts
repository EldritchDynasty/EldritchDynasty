// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import { BROWSER_IMPORT_CANCELLED, browserPlatform, type Platform } from '../platform.js';
import { createGame } from './game.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => window.localStorage.clear());

describe('run selection ignores stale host responses (#1348)', () => {
  it('a delayed named load cannot replace a newer Begin', async () => {
    const source = loadBundle();
    const oldSave = newGame(source, { seed: 7, campaign: 'short' }).save();
    const pendingRead = deferred<unknown | null>();
    const platform: Platform = {
      ...browserPlatform(),
      readSave: async (slot) => slot === 'old' ? pendingRead.promise : null,
      writeSave: async () => undefined,
    };
    const game = createGame(source, platform);

    const oldLoad = game.actions.load('old');
    game.actions.begin(71, 'short');
    const chosen = game.view.value;
    expect(chosen).not.toBeNull();

    pendingRead.resolve(oldSave);
    expect(await oldLoad).toBe(false);
    expect(game.view.value).toBe(chosen);
  });

  it('of two overlapping named loads, only the last-selected run can take over', async () => {
    const source = loadBundle();
    const save = newGame(source, { seed: 8, campaign: 'short' }).save();
    const older = deferred<unknown | null>();
    const newer = deferred<unknown | null>();
    const platform: Platform = {
      ...browserPlatform(),
      readSave: async (slot) => slot === 'old' ? older.promise : slot === 'new' ? newer.promise : null,
      writeSave: async () => undefined,
    };
    const game = createGame(source, platform);

    const firstLoad = game.actions.load('old');
    const secondLoad = game.actions.load('new');
    newer.resolve(save);
    expect(await secondLoad).toBe(true);
    const chosen = game.view.value;
    expect(chosen).not.toBeNull();

    older.resolve(save);
    expect(await firstLoad).toBe(false);
    expect(game.view.value).toBe(chosen);
  });

  it('leaving the board cancels a pending load rather than resurrecting it', async () => {
    const source = loadBundle();
    const save = newGame(source, { seed: 9, campaign: 'short' }).save();
    const pendingRead = deferred<unknown | null>();
    const platform: Platform = {
      ...browserPlatform(),
      readSave: async (slot) => slot === 'old' ? pendingRead.promise : null,
      writeSave: async () => undefined,
    };
    const game = createGame(source, platform);
    game.actions.begin(79, 'short');

    const oldLoad = game.actions.load('old');
    game.actions.leave();
    expect(game.view.value).toBeNull();

    pendingRead.resolve(save);
    expect(await oldLoad).toBe(false);
    expect(game.view.value).toBeNull();
  });

  it('an import picker opened before Begin cannot displace the new game; cancellation stays distinct', async () => {
    const source = loadBundle();
    const save = newGame(source, { seed: 10, campaign: 'short' }).save();
    const pendingImport = deferred<unknown | null>();
    let nextImport: () => Promise<unknown | null> = () => pendingImport.promise;
    const platform: Platform = {
      ...browserPlatform(),
      importSave: () => nextImport(),
      writeSave: async () => undefined,
    };
    const game = createGame(source, platform);

    const importing = game.actions.importSave();
    game.actions.begin(80, 'short');
    const chosen = game.view.value;
    pendingImport.resolve(save);
    expect(await importing).toBe(false);
    expect(game.view.value).toBe(chosen);

    nextImport = async () => BROWSER_IMPORT_CANCELLED;
    expect(await game.actions.importSave()).toBe('cancelled');
  });
});
