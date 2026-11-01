import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GAME_PACKAGE,
  MOD_EDITOR_PACKAGE,
  builderOverrides,
  packageTarget,
} from '../scripts/package-target.mjs';
import { desktopUserData } from './profile-root.mjs';
import { rendererEntry } from './renderer-entry.mjs';

/**
 * THE PACKAGED PATH, WITHOUT ELECTRON.
 *
 * `main.mjs` imports `electron` at module scope and cannot be loaded outside
 * an Electron process — the same reason `saves.mjs` was split out of it. This
 * is a pure function over plain values, so the two readings are assertable
 * with nothing but node.
 */
describe('resolving where the renderer lives', () => {
  const REPO = '/repo';
  const RESOURCES = '/Program Files/Eldritch Dynasty/resources';

  it('reads the client build out of the repository in dev', () => {
    expect(rendererEntry({ isPackaged: false, resourcesPath: RESOURCES, repo: REPO }))
      .toBe(join(REPO, 'packages/client/dist/index.html'));
  });

  it('reads the staged renderer out of packaged resources once installed', () => {
    expect(rendererEntry({ isPackaged: true, resourcesPath: RESOURCES, repo: REPO }))
      .toBe(join(RESOURCES, 'renderer', 'index.html'));
  });

  it('selects the editor in a checkout, while packaging reads the staged target', () => {
    expect(rendererEntry({ isPackaged: false, resourcesPath: RESOURCES, repo: REPO, target: 'editor' }))
      .toBe(join(REPO, 'packages', 'editor', 'dist', 'index.html'));
    expect(rendererEntry({ isPackaged: true, resourcesPath: RESOURCES, repo: REPO, target: 'editor' }))
      .toBe(join(RESOURCES, 'renderer', 'index.html'));
  });

  it('never reaches into the repository once packaged', () => {
    // The failure this guards: an installed app with no monorepo beside it,
    // silently loading a path that only ever existed on the machine it was
    // built on.
    const entry = rendererEntry({ isPackaged: true, resourcesPath: RESOURCES, repo: REPO });
    expect(entry.startsWith(REPO)).toBe(false);
  });

  it('never reads the packaged resources path while still in dev', () => {
    const entry = rendererEntry({ isPackaged: false, resourcesPath: RESOURCES, repo: REPO });
    expect(entry.startsWith(RESOURCES)).toBe(false);
  });
});


describe('the two Windows package targets', () => {
  it('shares one packaged profile even though the installed names differ', () => {
    expect(desktopUserData(join('C:', 'Users', 'Ada', 'AppData', 'Roaming')))
      .toBe(join('C:', 'Users', 'Ada', 'AppData', 'Roaming', 'Eldritch Dynasty'));
  });

  const SHELL = join(import.meta.dirname, '..');

  it('keeps the game as the default target', () => {
    expect(packageTarget([])).toBe(GAME_PACKAGE);
    expect(packageTarget(['--anything-else'])).toBe(GAME_PACKAGE);
    expect(builderOverrides(GAME_PACKAGE, '38.0.0')).toEqual({
      electronVersion: '38.0.0',
    });
  });

  it('selects the editor only when explicitly requested', () => {
    expect(packageTarget(['--mod-editor'])).toBe(MOD_EDITOR_PACKAGE);
    expect(MOD_EDITOR_PACKAGE.renderer).toBe('editor');
    expect(MOD_EDITOR_PACKAGE.output).toBe('release-mod-editor');
  });

  it('gives the second installer its own identity and entrypoint', () => {
    expect(builderOverrides(MOD_EDITOR_PACKAGE, '38.0.0')).toEqual({
      electronVersion: '38.0.0',
      appId: 'nz.eldritchdynasty.modeditor',
      productName: 'Eldritch Dynasty Mod Editor',
      directories: { output: 'release-mod-editor' },
      extraMetadata: { main: 'src/mod-editor-main.mjs' },
    });
  });

  it('has one builder resource slot for whichever renderer was staged', () => {
    const yaml = readFileSync(join(SHELL, 'electron-builder.yml'), 'utf8');
    expect(yaml).toMatch(/from:\s*\.renderer[\s\S]*?to:\s*renderer/);
    expect(yaml).not.toMatch(/from:\s*\.\.\/(?:client|editor)\/dist/);
    expect(yaml).toContain("- '!.renderer/**'");
  });

  it('selects Mod Editor mode before importing the shared shell', () => {
    const entry = readFileSync(join(SHELL, 'src/mod-editor-main.mjs'), 'utf8');
    expect(entry.indexOf("process.env.ED_MOD_EDITOR = '1'"))
      .toBeLessThan(entry.indexOf("import('./main.mjs')"));
  });
});


describe('native mod scan tolerates disappearing entries (#2274)', () => {
  it.each(['stat', 'read'] as const)('retains healthy YAML when another entry disappears during %s', async (phase) => {
    const profile = mkdtempSync(join(tmpdir(), 'ed-mod-scan-'));
    const root = join(profile, 'mods', 'content');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'healthy.yaml'), 'healthy: true\n');
    const moving = join(root, 'moving.yaml');
    writeFileSync(moving, 'moving: true\n');

    // Deterministic file-removal races: the entry is present at enumeration,
    // but a concurrent editor removes it before either stat or read. These
    // are separate filesystem calls and cannot be reliably timed with a sleep.
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
      // user-content.mjs now opens the file once and reads through its fd.
      // Inject a read failure on that opened descriptor, not the old pathname.
      let targetFd: number | undefined;
      return {
        ...fs,
        lstatSync: (path: string) => {
          if (phase === 'stat' && path === moving) {
            throw Object.assign(new Error('entry vanished before stat'), { code: 'ENOENT' });
          }
          return fs.lstatSync(path);
        },
        openSync: (...args: Parameters<typeof fs.openSync>) => {
          const fd = fs.openSync(...args);
          if (args[0] === moving) targetFd = fd;
          return fd;
        },
        readFileSync: (path: string | number, encoding: BufferEncoding) => {
          if (phase === 'read' && path === targetFd) {
            throw Object.assign(new Error('entry vanished before read'), { code: 'ENOENT' });
          }
          return fs.readFileSync(path, encoding);
        },
        // The verified YAML reader opens the pathname and reads a file descriptor.
        // Inject at that boundary too, without changing the legacy read mock.
        openSync: (path: string, flags: number) => {
          if (phase === 'read' && path === moving) {
            throw Object.assign(new Error('entry vanished before open'), { code: 'ENOENT' });
          }
          return fs.openSync(path, flags);
        },
      };
    });
    try {
      const { readUserContent } = await import('./user-content.mjs');
      expect(readUserContent(root)).toEqual({ 'healthy.yaml': 'healthy: true\n' });
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it.each(['stat', 'read'] as const)('still reports real %s failures instead of silently hiding mods', async (phase) => {
    const profile = mkdtempSync(join(tmpdir(), 'ed-mod-scan-'));
    const root = join(profile, 'mods', 'content');
    mkdirSync(root, { recursive: true });
    const blocked = join(root, 'blocked.yaml');
    writeFileSync(blocked, 'blocked: true\n');

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
      // user-content.mjs now opens the file once and reads through its fd.
      // Inject a read failure on that opened descriptor, not the old pathname.
      let targetFd: number | undefined;
      return {
        ...fs,
        lstatSync: (path: string) => {
          if (phase === 'stat' && path === blocked) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return fs.lstatSync(path);
        },
        openSync: (...args: Parameters<typeof fs.openSync>) => {
          const fd = fs.openSync(...args);
          if (args[0] === blocked) targetFd = fd;
          return fd;
        },
        readFileSync: (path: string | number, encoding: BufferEncoding) => {
          if (phase === 'read' && path === targetFd) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return fs.readFileSync(path, encoding);
        },
        // The verified YAML reader opens the pathname and reads a file descriptor.
        // Inject at that boundary too, without changing the legacy read mock.
        openSync: (path: string, flags: number) => {
          if (phase === 'read' && path === blocked) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return fs.openSync(path, flags);
        },
      };
    });
    try {
      const { readUserContent } = await import('./user-content.mjs');
      expect(() => readUserContent(root)).toThrow('permission denied');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
      rmSync(profile, { recursive: true, force: true });
    }
  });
});

describe('atomic JSON scratch ownership (#2347)', () => {
  const token = '11111111-1111-4111-8111-111111111111';

  async function fixedScratchWriter() {
    vi.resetModules();
    vi.doMock('node:crypto', async () => ({
      ...(await vi.importActual<typeof import('node:crypto')>('node:crypto')),
      randomUUID: () => token,
    }));
    return import('./atomic-json.mjs');
  }

  it('preserves another writer\'s scratch on exclusive-create collision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-atomic-ownership-'));
    const target = join(dir, 'saved.json');
    const scratch = `${target}.${token}.writing`;
    writeFileSync(target, 'previous destination');
    writeFileSync(scratch, 'other writer data');

    try {
      const { writeJsonAtomically } = await fixedScratchWriter();
      expect(() => writeJsonAtomically(target, { format: 41 })).toThrow(/EEXIST/);
      expect(readFileSync(scratch, 'utf8')).toBe('other writer data');
      expect(readFileSync(target, 'utf8')).toBe('previous destination');
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closes the descriptor and removes only its own partial scratch after a write error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-atomic-partial-'));
    const target = join(dir, 'saved.json');
    const scratch = `${target}.${token}.writing`;
    writeFileSync(target, 'previous destination');
    const close = vi.fn();
    try {
      vi.doMock('node:fs', async () => {
        const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
        return {
          ...fs,
          closeSync: (fd: number) => {
            close(fd);
            fs.closeSync(fd);
          },
          writeFileSync: (file: string | number, data: string, options?: BufferEncoding) => {
            if (typeof file === 'number') {
              fs.writeFileSync(file, 'partial', 'utf8');
              throw new Error('simulated disk full');
            }
            fs.writeFileSync(file, data, options);
          },
        };
      });
      const { writeJsonAtomically } = await fixedScratchWriter();
      expect(() => writeJsonAtomically(target, { format: 41 })).toThrow('simulated disk full');
      expect(close).toHaveBeenCalledOnce();
      expect(() => readFileSync(scratch, 'utf8')).toThrow();
      expect(readFileSync(target, 'utf8')).toBe('previous destination');
    } finally {
      vi.doUnmock('node:fs');
      vi.doUnmock('node:crypto');
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes an owned scratch when the atomic rename fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-atomic-rename-'));
    const target = join(dir, 'existing-directory');
    const scratch = `${target}.${token}.writing`;
    mkdirSync(target);
    try {
      const { writeJsonAtomically } = await fixedScratchWriter();
      expect(() => writeJsonAtomically(target, { format: 41 })).toThrow();
      expect(() => readFileSync(scratch, 'utf8')).toThrow();
      expect(() => writeFileSync(join(target, 'probe'), 'still a directory')).not.toThrow();
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
