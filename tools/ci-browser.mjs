#!/usr/bin/env node
/**
 * Provision the locked Playwright browser without paying for apt on a runner
 * that can already launch it (#2904). Cache only browser payloads; readiness
 * is always proved against the current runner's system libraries.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
export const BUDGET_MS = 240_000;
export const ATTEMPT_MS = 90_000;

const probeScript = [
  "const { chromium } = require('@playwright/test');",
  '(async () => {',
  '  const browser = await chromium.launch({ timeout: 15000 });',
  '  try {',
  '    const page = await browser.newPage();',
  "    await page.setContent('<p>Chromium is ready</p>');",
  "    if (await page.locator('p').textContent() !== 'Chromium is ready') throw new Error('render probe failed');",
  '  } finally { await browser.close(); }',
  '})().catch(error => { console.error(error); process.exitCode = 1; });',
].join('\n');

/** Run the installed CLI directly: no npx fallback download or Windows shim. */
export function runBrowserCommand(stage, timeout, { root = ROOT } = {}) {
  const args = stage === 'probe'
    ? ['-e', probeScript]
    : [require.resolve('@playwright/test/cli'), stage === 'browser' ? 'install' : 'install-deps', 'chromium'];
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output) process.stdout.write(output);
  return { ok: result.status === 0, timedOut: result.error?.code === 'ETIMEDOUT' };
}

/**
 * At most two attempts per install, within the original five-minute step.
 * A timed-out installer is not retried: its child apt process may still own a
 * lock until the Actions runner cleans up the failed job. Fail visibly then.
 */
export function provisionCiBrowser({
  run = runBrowserCommand,
  now = Date.now,
  log = console.log,
  platform = process.platform,
} = {}) {
  const started = now();
  const deadline = started + BUDGET_MS;
  const attempt = (stage, cap = ATTEMPT_MS) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Chromium provisioning exhausted its 240-second budget');
    const before = now();
    const result = run(stage, Math.min(cap, remaining));
    log(`chromium setup: ${stage} ${result.ok ? 'ready' : 'failed'} in ${((now() - before) / 1000).toFixed(1)}s`);
    if (result.timedOut) throw new Error(`Chromium ${stage} timed out; provisioning failed`);
    return result.ok;
  };
  const install = (stage) => {
    if (attempt(stage)) return;
    log(`chromium setup: retrying ${stage} once`);
    if (!attempt(stage)) throw new Error(`Chromium ${stage} failed on both attempts`);
  };

  install('browser');
  if (!attempt('probe', 25_000)) {
    // Linux runners normally carry Chromium's runtime libraries already.
    // Only a failed real launch justifies apt; fonts alone do not require it.
    if (platform !== 'linux') throw new Error('Chromium could not launch on this runner');
    install('dependencies');
    if (!attempt('probe', 25_000)) throw new Error('Chromium could not launch after installing system dependencies');
  }
  log(`chromium setup: launch and render verified in ${((now() - started) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { provisionCiBrowser(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
