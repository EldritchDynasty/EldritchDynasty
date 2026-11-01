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
    writeFileSync(join(root, 'healthy.yaml'), 'healthy: true\\n');
    const moving = join(root, 'moving.yaml');
    writeFileSync(moving, 'moving: true\\n');

    // Deterministic file-removal races: the entry is present at enumeration,
    // but a concurrent editor removes it before either stat or read. These
    // are separate filesystem calls and cannot be reliably timed with a sleep.
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...fs,
        lstatSync: (path: string) => {
          if (phase === 'stat' && path === moving) {
            throw Object.assign(new Error('entry vanished before stat'), { code: 'ENOENT' });
          }
          return fs.lstatSync(path);
        },
        readFileSync: (path: string, encoding: BufferEncoding) => {
          if (phase === 'read' && path === moving) {
            throw Object.assign(new Error('entry vanished before read'), { code: 'ENOENT' });
          }
          return fs.readFileSync(path, encoding);
        },
      };
    });
    try {
      const { readUserContent } = await import('./user-content.mjs');
      expect(readUserContent(root)).toEqual({ 'healthy.yaml': 'healthy: true\\n' });
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it('still reports real read failures instead of silently hiding mods', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'ed-mod-scan-'));
    const root = join(profile, 'mods', 'content');
    mkdirSync(root, { recursive: true });
    const blocked = join(root, 'blocked.yaml');
    writeFileSync(blocked, 'blocked: true\\n');

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...fs,
        readFileSync: (path: string, encoding: BufferEncoding) => {
          if (path === blocked) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return fs.readFileSync(path, encoding);
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
