import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { electronEnvironment } from './electron-environment.mjs';
import { observeViteLocal, viteLocalUrl } from './dev-server.mjs';

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


describe('Vite actual local URL for Electron development (#890)', () => {
  it('uses the printed URL, including when Vite auto-selected a higher port', () => {
    expect(viteLocalUrl('  ➜  Local:   http://localhost:5175/')).toBe('http://localhost:5175/');
    expect(viteLocalUrl('Local: http://127.0.0.1:5177/')).toBe('http://127.0.0.1:5177/');
    expect(viteLocalUrl('Local: https://localhost:7443/')).toBe('https://localhost:7443/');
  });

  it('accepts ANSI-colored Vite output without leaking terminal codes into the URL', () => {
    const colored = '  ➜  \x1b[36mLocal:\x1b[0m \x1b[32mhttp://localhost:5176/\x1b[0m';
    expect(viteLocalUrl(colored)).toBe('http://localhost:5176/');
  });

  it.each([
    '',
    'Port 5174 is in use, trying another one...',
    'Network: http://localhost:5175/',
    'Local: file:///tmp/rogue',
    'Local: https://another-server.example/',
    'Local: http://',
    'This is not a startup line',
  ])('refuses unrelated, untrusted or incomplete Local output: %s', (line) => {
    expect(viteLocalUrl(line)).toBeNull();
  });

  it('waits for a full line even when both the URL and newline arrive in separate chunks', () => {
    const onLocal = vi.fn();
    const consume = observeViteLocal(onLocal);
    consume('  VITE ready in 221ms\n  ➜  Loc');
    consume('al:   http://localhost:5');
    expect(onLocal).not.toHaveBeenCalled();
    consume('175/');
    expect(onLocal).not.toHaveBeenCalled();
    consume('\r\n  ➜  Network: use --host\n');
    expect(onLocal).toHaveBeenCalledExactlyOnceWith('http://localhost:5175/');
    consume('  ➜  Local: http://localhost:9999/\n');
    expect(onLocal).toHaveBeenCalledTimes(1);
  });

  it('skips misleading lines and follows the final valid Vite Local URL', () => {
    const onLocal = vi.fn();
    const consume = observeViteLocal(onLocal);
    consume('Local: file:///bogus\nPort 5174 is in use\n');
    consume('Local: http://localhost:5178/\n');
    expect(onLocal).toHaveBeenCalledExactlyOnceWith('http://localhost:5178/');
  });

  it('keeps the explicit ED_DEV_SERVER override ahead of the discovered Vite URL', () => {
    const fromVite = vi.fn();
    const override = 'http://localhost:8888';
    const consume = observeViteLocal((actual) => fromVite(override ?? actual));
    consume('Local: http://localhost:5179/\n');
    expect(fromVite).toHaveBeenCalledWith(override);

    // Protect the launcher integration from drifting back to a fixed port.
    const dev = readFileSync(new URL('./dev.mjs', import.meta.url), 'utf8');
    expect(dev).toContain('observeViteLocal');
    expect(dev).toContain('launchShell(OVERRIDE_URL ?? viteUrl)');
    expect(dev).not.toContain("const URL_ =");
    expect(dev).toContain("electron.on('error'");
  });
});
