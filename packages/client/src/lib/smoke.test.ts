import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '@ed/content';
import type { Platform, SmokeCommand, SmokeResult } from '../platform.js';
import { createGame } from './game.js';

/**
 * THE EXPORT COMMAND STARTS IN A NEW PROCESS.
 *
 * The iOS runtime smoke deliberately terminates and relaunches the app before
 * every command. Save/resume/import each cause this process to write an
 * autosave, but export does not: its entire job is to prove that the PREVIOUS
 * process left one durable enough to read and carry across the interchange
 * boundary. Waiting for saveStatus === "saved" here therefore waits for an
 * operation that export never starts.
 */
describe('native cold-process smoke export', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports the durable autosave without requiring a write in this process', async () => {
    vi.useFakeTimers();

    const persisted = { format: 28, year: 1082, savedAt: 'prior-process', world: { marker: 7 } };
    let smoke: ((command: SmokeCommand) => Promise<SmokeResult>) | undefined;
    const writeSave = vi.fn(async () => undefined);
    const writeSmokeInterchange = vi.fn(async () => 'eldritch-smoke-export.json');

    const platform: Platform = {
      async listSaves() { return []; },
      async readSave(slot) { return slot === 'autosave' ? persisted : null; },
      writeSave,
      async deleteSave() {},
      async readLibrary() { return null; },
      async writeLibrary() {},
      async readUserContent() { return {}; },
      async exportSave() {},
      async importSave() { return null; },
      onPause() { return () => undefined; },
      onBack() { return () => undefined; },
      onSmokeCommand(listener) {
        smoke = listener;
        return () => undefined;
      },
      writeSmokeInterchange,
    };

    createGame(loadContent(), platform);
    expect(smoke).toBeDefined();

    const resultPromise = smoke!({ kind: 'export' });
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      snapshot: persisted,
      year: 1082,
      path: 'eldritch-smoke-export.json',
    });
    expect(writeSave).not.toHaveBeenCalled();
    expect(writeSmokeInterchange).toHaveBeenCalledWith(persisted);
  });
});
