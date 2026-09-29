import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { electronEnvironment } from '../scripts/electron-environment.mjs';
import { smokePackagedApp } from '../scripts/packaged-smoke.mjs';

describe('Electron child environment (#355)', () => {
  it('drops only the inherited run-as-Node flag and never mutates the parent', () => {
    const parent = {
      ELECTRON_RUN_AS_NODE: '1',
      ED_DEV_SERVER: 'http://localhost:5174',
      SENTINEL: 'kept',
    };

    expect(electronEnvironment(parent)).toEqual({
      ED_DEV_SERVER: 'http://localhost:5174',
      SENTINEL: 'kept',
    });
    expect(parent).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      ED_DEV_SERVER: 'http://localhost:5174',
      SENTINEL: 'kept',
    });
    expect(electronEnvironment(parent)).not.toBe(parent);
  });

  it('leaves an ordinary environment unchanged in value', () => {
    const parent = { PATH: 'somewhere', SENTINEL: 'kept' };
    expect(electronEnvironment(parent)).toEqual(parent);
    expect(electronEnvironment(parent)).not.toBe(parent);
  });

  it('passes the same sanitized environment to the packaged smoke process', async () => {
    const release = await mkdtemp(join(tmpdir(), 'ed-shell-'));
    const unpacked = join(release, 'win-unpacked');
    await mkdir(unpacked);
    await writeFile(join(unpacked, 'Eldritch Dynasty.exe'), '');

    const run = vi.fn(async () => {});
    const parentEnv = { ELECTRON_RUN_AS_NODE: '1', SENTINEL: 'kept' };

    await smokePackagedApp(release, { platform: 'win32', run, parentEnv });

    expect(run).toHaveBeenCalledWith(
      join(unpacked, 'Eldritch Dynasty.exe'),
      ['--smoke'],
      { SENTINEL: 'kept' },
    );
    expect(parentEnv).toEqual({ ELECTRON_RUN_AS_NODE: '1', SENTINEL: 'kept' });
  });
});
