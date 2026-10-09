import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { electronEnvironment } from '../scripts/electron-environment.mjs';
import { externalWebUrl, handleExternalPopup } from './external-links.mjs';
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

describe('Electron popup link boundary', () => {
  it('accepts and canonicalizes absolute HTTP(S) URLs only', () => {
    expect(externalWebUrl('https://example.com/path?x=1#part'))
      .toBe('https://example.com/path?x=1#part');
    expect(externalWebUrl('HTTP://Example.Com'))
      .toBe('http://example.com/');
    expect(externalWebUrl('http://localhost:5174/page'))
      .toBe('http://localhost:5174/page');
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/cmd.exe',
    'file:///etc/passwd',
    'data:text/html,hello',
    'mailto:someone@example.com',
    'ms-settings:privacy',
    'ms-msdt:/id',
    'steam://run/123',
    'ftp://example.com',
    'blob:https://example.com/token',
    '//example.com/path',
    '/relative/link',
    'example.com',
    'https:example.com',
    'https:/example.com',
    'https://',
    'https://[invalid',
    ' https://example.com/',
    '',
    null,
    undefined,
    42,
  ])('refuses a non-web or malformed popup: %s', (input) => {
    expect(externalWebUrl(input)).toBeNull();
    const openExternal = vi.fn();
    expect(handleExternalPopup(input, openExternal)).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens an approved canonical URL outside Electron but still denies the popup', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    expect(handleExternalPopup('HTTPS://Example.com/play', openExternal))
      .toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/play');
  });

  it('handles a rejected OS launch without leaving an unhandled rejection', async () => {
    const error = new Error('no browser installed');
    const onError = vi.fn();
    const openExternal = vi.fn().mockRejectedValue(error);
    expect(handleExternalPopup('https://example.com/', openExternal, onError))
      .toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('handles a synchronous launch failure and still denies the popup', () => {
    const error = new Error('protocol handler failed');
    const onError = vi.fn();
    const openExternal = vi.fn(() => { throw error; });
    expect(handleExternalPopup('http://example.com', openExternal, onError))
      .toEqual({ action: 'deny' });
    expect(onError).toHaveBeenCalledWith(error);
  });
});
