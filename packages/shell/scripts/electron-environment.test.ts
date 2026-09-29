import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { electronEnvironment } from './electron-environment.mjs';

describe('the Electron child environment', () => {
  it('removes a host ELECTRON_RUN_AS_NODE flag without mutating its source', () => {
    const host = {
      ELECTRON_RUN_AS_NODE: '1',
      ED_DEV_SERVER: 'http://localhost:5174',
      ED_MOD_EDITOR: '1',
    };

    expect(electronEnvironment(host)).toEqual({
      ED_DEV_SERVER: 'http://localhost:5174',
      ED_MOD_EDITOR: '1',
    });
    expect(host.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('leaves an ordinary environment unchanged', () => {
    expect(electronEnvironment({ PATH: 'somewhere' })).toEqual({ PATH: 'somewhere' });
  });

  it('guards every development entrypoint before Electron starts', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    for (const script of ['start', 'preview', 'smoke']) {
      expect(pkg.scripts[script]).toContain('node scripts/electron.mjs');
    }
  });
});
