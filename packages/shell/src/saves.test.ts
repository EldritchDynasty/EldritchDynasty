import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, digestOf, loadGame, runYears, saveGame } from '@ed/core';
import { findPackagedExecutable, smokePackagedApp } from '../scripts/packaged-smoke.mjs';
import { resolveSavePath, SaveSlotError, slotOfFile } from '../tools/save-slot.mjs';
import { deleteSave, listSaves, readSave, saveRoot, writeSave } from './saves.mjs';
import { readRunLibrary, writeRunLibrary } from './run-library.mjs';
import { readUserContent, userContentRoot } from './user-content.mjs';

/**
 * WRITING A RUN DOWN.
 *
 * `saveGame`/`loadGame` have round-tripped a run exactly for as long as the
 * format has existed, and until now nothing chose a slot or a directory —
 * which is the difference between a save format and saving. The bridge itself
 * needs Electron and is covered by `npm run smoke`; everything below it is
 * plain node and is covered here.
 *
 * A slot name is the second untrusted string this application takes from
 * outside itself, and a guard is mostly refusals: the table below is mostly
 * the things it exists to stop.
 */

const ROOT = '/saves';

const rejects = (slot: unknown) => expect(() => resolveSavePath(ROOT, slot)).toThrow(SaveSlotError);

describe('a slot is a name, not a path', () => {
  it('takes an ordinary name and gives it our extension', () => {
    // `resolve`, not `join`, because that is what the resolver uses — and it
    // uses it because a save path is a security boundary. The two agree on
    // Linux and part company on Windows, where `resolve` qualifies a
    // root-relative path with the current drive: `D:\saves\…` against
    // `\saves\…`. The test was asserting the wrong one of the two.
    expect(resolveSavePath(ROOT, 'the autumn run')).toBe(resolve(ROOT, 'the autumn run.edsave.json'));
  });

  it('refuses anything with a separator or a dot in it', () => {
    rejects('../escaped');
    rejects('..');
    rejects('a/b');
    rejects('a\\b');
    rejects('/etc/passwd');
    // No dot at all, which is what makes `..` unreachable rather than refused.
    rejects('notes.txt');
    rejects('.hidden');
  });

  it('refuses a name that is not one', () => {
    rejects('');
    rejects(undefined);
    rejects(42);
    rejects(' leading space');
    rejects('trailing space ');
    rejects('x'.repeat(65));
  });

  it('reads its own files back out of a listing and ignores everything else', () => {
    expect(slotOfFile('the autumn run.edsave.json')).toBe('the autumn run');
    expect(slotOfFile('notes.txt')).toBeUndefined();
    expect(slotOfFile('../escaped.edsave.json')).toBeUndefined();
    expect(slotOfFile('.edsave.json')).toBeUndefined();
  });
});

describe('the save directory', () => {
  let userData = '';
  let root = '';

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'ed-saves-'));
    root = saveRoot(userData);
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  const aSave = (over: Record<string, unknown> = {}) => ({ format: 6, year: 1442, savedAt: '2026-08-22T00:00:00.000Z', ...over });

  it('writes, lists, reads back and deletes a slot', () => {
    writeSave(root, 'the autumn run', aSave());
    expect(listSaves(root).map((s) => s.slot)).toEqual(['the autumn run']);
    expect(listSaves(root)[0]).toMatchObject({ year: 1442, format: 6 });
    expect(readSave(root, 'the autumn run')).toMatchObject({ year: 1442 });

    deleteSave(root, 'the autumn run');
    expect(listSaves(root)).toEqual([]);
  });

  it('refuses a save-root directory symlink before any save can escape the profile', () => {
    const outside = join(userData, 'external-directory');
    mkdirSync(outside);
    rmSync(root, { recursive: true });
    try {
      symlinkSync(outside, root, 'dir');
    } catch (error) {
      // Some Windows configurations restrict directory symlinks without
      // Developer Mode. Other directory-root assertions still run there.
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }

    // Node's recursive mkdir accepts a symlinked directory without error;
    // saveRoot must reject it, rather than returning a path that leaves the
    // profile on the next atomic write.
    expect(() => writeSave(saveRoot(userData), 'escaped', aSave())).toThrow(
      'save root is not a regular directory',
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a non-directory entry at the save root', () => {
    rmSync(root, { recursive: true });
    writeFileSync(root, 'unrelated content', 'utf8');
    expect(() => saveRoot(userData)).toThrow();
    expect(readFileSync(root, 'utf8')).toBe('unrelated content');
  });

  it('rechecks a save root even after a successful earlier creation', () => {
    expect(saveRoot(userData)).toBe(root);
    const outside = join(userData, 'later-destination');
    mkdirSync(outside);
    rmSync(root, { recursive: true });
    try {
      symlinkSync(outside, root, 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
    expect(() => saveRoot(userData)).toThrow('save root is not a regular directory');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('lists newest first', () => {
    writeSave(root, 'older', aSave({ savedAt: '2020-01-01T00:00:00.000Z' }));
    writeSave(root, 'newer', aSave({ savedAt: '2026-01-01T00:00:00.000Z' }));
    expect(listSaves(root).map((s) => s.slot)).toEqual(['newer', 'older']);
  });

  it('leaves nothing half-written behind', () => {
    // The scratch file is renamed into place, never written over the slot. A
    // `writeFileSync` interrupted half way leaves a file with the right name
    // that will never parse again — which the player finds out about the next
    // time they open the only copy of a nine-hour game.
    writeSave(root, 'the autumn run', aSave());
    expect(readdirSync(root)).toEqual(['the autumn run.edsave.json']);
  });

  it('never follows a planted .writing symlink during an atomic save', () => {
    // The old fixed scratch filename allowed writeFileSync() to follow this
    // link before the final path was renamed, overwriting a different file.
    const outside = join(userData, 'unrelated.json');
    writeFileSync(outside, 'keep these original bytes', 'utf8');
    const legacyScratch = join(root, 'protected.edsave.json.writing');
    try {
      symlinkSync(outside, legacyScratch, 'file');
    } catch (error) {
      // Creating file symlinks on Windows may require Developer Mode.
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }

    writeSave(root, 'protected', aSave({ year: 1450 }));
    expect(readFileSync(outside, 'utf8')).toBe('keep these original bytes');
    expect(readSave(root, 'protected')).toMatchObject({ year: 1450, format: 6 });
    // The writer must neither use nor delete another entry's old scratch path.
    expect(readdirSync(root).sort()).toEqual([
      'protected.edsave.json',
      'protected.edsave.json.writing',
    ]);
  });

  it('does not change an existing slot when JSON serialization fails', () => {
    writeSave(root, 'existing', aSave({ year: 1442 }));
    const cycle: Record<string, unknown> = { format: 6 };
    cycle.self = cycle;
    expect(() => writeSave(root, 'existing', cycle)).toThrow();
    expect(readSave(root, 'existing')).toMatchObject({ year: 1442, format: 6 });
    expect(readdirSync(root)).toEqual(['existing.edsave.json']);
  });

  it('cleans the exclusive scratch when atomic rename is refused', () => {
    mkdirSync(join(root, 'occupied.edsave.json'));
    expect(() => writeSave(root, 'occupied', aSave())).toThrow();
    expect(readdirSync(root)).toEqual(['occupied.edsave.json']);
  });

  it('reports a corrupt slot rather than dropping it out of the listing', () => {
    // A save list that silently omits the run somebody spent nine hours on is
    // this codebase's own failure mode with a filesystem attached.
    writeFileSync(join(root, 'ruined.edsave.json'), '{ not json', 'utf8');
    const [entry] = listSaves(root);
    expect(entry?.slot).toBe('ruined');
    expect(entry?.unreadable).toBeTruthy();
  });

  it('reports a directory-shaped slot while keeping valid saves visible', () => {
    mkdirSync(join(root, 'not-a-file.edsave.json'));
    // The slot name syntax forbids an internal dot but permits dashes.
    writeSave(root, 'healthy', aSave());

    const bySlot = new Map(listSaves(root).map((entry) => [entry.slot, entry]));
    expect(bySlot.get('healthy')).toMatchObject({ year: 1442, format: 6 });
    expect(bySlot.get('not-a-file')?.unreadable).toContain('not a regular file');
    expect(() => readSave(root, 'not-a-file')).toThrow('not a regular file');
  });

  it('never follows a linked slot outside the saves directory', () => {
    const external = join(userData, 'external.json');
    writeFileSync(external, JSON.stringify(aSave({ year: 1999, format: 999 })), 'utf8');
    try {
      symlinkSync(external, join(root, 'linked.edsave.json'), 'file');
    } catch (error) {
      // Windows hosts without Developer Mode cannot create a file symlink;
      // the directory/non-file contract above still runs on both platforms.
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
    writeSave(root, 'healthy', aSave());

    const bySlot = new Map(listSaves(root).map((entry) => [entry.slot, entry]));
    expect(bySlot.get('healthy')?.year).toBe(1442);
    expect(bySlot.get('linked')?.unreadable).toContain('not a regular file');
    expect(bySlot.get('linked')?.year).toBeUndefined();
    expect(bySlot.get('linked')?.format).toBeUndefined();
    expect(() => readSave(root, 'linked')).toThrow('not a regular file');
  });

  it('ignores whatever else is in the directory', () => {
    writeFileSync(join(root, 'notes.txt'), 'a list of names', 'utf8');
    writeSave(root, 'kept', aSave());
    expect(listSaves(root).map((s) => s.slot)).toEqual(['kept']);
  });

  it('refuses a blob that is not a save at all', () => {
    expect(() => writeSave(root, 'nope', 'a string' as never)).toThrow(TypeError);
    expect(() => writeSave(root, 'nope', {} as never)).toThrow(TypeError);
    expect(() => writeSave(root, 'nope', [] as never)).toThrow(TypeError);
    expect(listSaves(root)).toEqual([]);
  });

  it('refuses to delete outside the save directory', () => {
    expect(() => deleteSave(root, '../..')).toThrow(SaveSlotError);
  });

  /**
   * The point of all of it. Not "the file exists" — a run that comes off the
   * disk and continues bit-identically, which is the promise `save.test.ts`
   * makes about the format and nothing has ever made about a file.
   */
  it('round-trips a real run through the disk and continues identically', () => {
    const bundle = loadContent();
    const played = bootstrap(bundle, 1042, 1042);
    runYears(played, 200);

    writeSave(root, 'the autumn run', saveGame(played));
    const reloaded = loadGame(readSave(root, 'the autumn run'), bundle);

    runYears(played, 40);
    runYears(reloaded, 40);
    // `digestOf`, not `JSON.stringify`: property insertion order is not state,
    // and a record Zod rebuilt in schema order serialises differently from the
    // identical record the run built field by field.
    expect(digestOf(reloaded)).toBe(digestOf(played));
  });

  it('is a directory under userData, and not the repository', () => {
    expect(root).toBe(join(userData, 'saves'));
    expect(root.includes('packages')).toBe(false);
  });
});


describe('the installation library on disk', () => {
  let userData = '';

  beforeEach(() => { userData = mkdtempSync(join(tmpdir(), 'ed-library-')); });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('is a second store beside saves and round-trips atomically', () => {
    const library = { format: 1, runs: [{ id: 'house-one' }] };
    const path = writeRunLibrary(userData, library);
    expect(path).toBe(join(userData, 'library.json'));
    expect(readRunLibrary(userData)).toEqual(library);
  });

  it('never follows a planted library.json.writing symlink outside the profile store', () => {
    const unrelated = join(userData, 'unrelated-records.txt');
    writeFileSync(unrelated, 'unrelated file must not change', 'utf8');
    const legacyScratch = join(userData, 'library.json.writing');
    try {
      symlinkSync(unrelated, legacyScratch, 'file');
    } catch (error) {
      // Creating file symlinks on Windows may require Developer Mode.
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }

    const library = { format: 1, runs: [{ id: 'house-two' }] };
    writeRunLibrary(userData, library);
    expect(readFileSync(unrelated, 'utf8')).toBe('unrelated file must not change');
    expect(readRunLibrary(userData)).toEqual(library);
    expect(readdirSync(userData).sort()).toEqual([
      'library.json',
      'library.json.writing',
      'unrelated-records.txt',
    ]);
  });

  it('has no value before a house has finished', () => {
    expect(readRunLibrary(userData)).toBeNull();
  });

  it('leaves malformed JSON for the caller to reject rather than inventing data', () => {
    writeFileSync(join(userData, 'library.json'), '{not json', 'utf8');
    expect(() => readRunLibrary(userData)).toThrow();
  });
});


describe('packaged Windows smoke', () => {
  const roots: string[] = [];

  function releaseDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'ed-packaged-smoke-'));
    roots.push(root);
    mkdirSync(join(root, 'win-unpacked'), { recursive: true });
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds the one application executable in win-unpacked', async () => {
    const release = releaseDir();
    writeFileSync(join(release, 'win-unpacked', 'Eldritch Dynasty.exe'), '');
    writeFileSync(join(release, 'Eldritch Dynasty Setup 0.1.0.exe'), '');

    expect(await findPackagedExecutable(release))
      .toBe(join(release, 'win-unpacked', 'Eldritch Dynasty.exe'));
  });

  it('refuses an ambiguous unpacked directory instead of smoking the wrong program', async () => {
    const release = releaseDir();
    writeFileSync(join(release, 'win-unpacked', 'Eldritch Dynasty.exe'), '');
    writeFileSync(join(release, 'win-unpacked', 'helper.exe'), '');

    await expect(findPackagedExecutable(release))
      .rejects.toThrow('expected exactly one packaged app executable');
  });

  it('runs the packaged executable with the shell smoke flag on Windows', async () => {
    const release = releaseDir();
    const executable = join(release, 'win-unpacked', 'Eldritch Dynasty.exe');
    writeFileSync(executable, '');

    const calls: Array<{ executable: string; args: string[] }> = [];
    const result = await smokePackagedApp(release, {
      platform: 'win32',
      run: async (path, args) => { calls.push({ executable: path, args }); },
    });

    expect(result).toEqual({ skipped: false, executable });
    expect(calls).toEqual([{ executable, args: ['--smoke'] }]);
  });

  it('does not try to execute a Windows package from another platform', async () => {
    const release = releaseDir();
    const result = await smokePackagedApp(release, {
      platform: 'linux',
      run: async () => { throw new Error('must not run'); },
    });

    expect(result).toEqual({ skipped: true });
  });
});


describe('desktop user content', () => {
  let userData = '';

  beforeEach(() => { userData = mkdtempSync(join(tmpdir(), 'ed-user-content-')); });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('uses one profile-owned root without creating it merely by reading', () => {
    const root = userContentRoot(userData);
    expect(root).toBe(join(userData, 'mods', 'content'));
    expect(readUserContent(root)).toEqual({});
  });

  it('reads YAML recursively with content-relative keys and ignores other files', () => {
    const root = userContentRoot(userData);
    mkdirSync(join(root, 'events'), { recursive: true });
    writeFileSync(join(root, 'events', 'my_event.yaml'), 'events: []\n');
    writeFileSync(join(root, 'readme.txt'), 'not content');
    expect(readUserContent(root)).toEqual({ 'events/my_event.yaml': 'events: []\n' });
  });
});
