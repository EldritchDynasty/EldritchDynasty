#!/usr/bin/env node
/**
 * WHAT EVERY SESSION DOES BEFORE THE AGENT DOES ANYTHING.
 *
 * Orient, install if there is nothing installed, warm the content cache. The
 * body lives here and the gate lives in `.claude/hooks/session-start.mjs`,
 * which BOTH agents register — there is no second copy, because the second
 * copy is exactly how they diverged: it was a duplicate of the Claude hook,
 * gated on `CLAUDE_CODE_REMOTE`, a variable Codex never sets, so it exited 0
 * having done nothing, every session, for its whole life. Nothing reported it,
 * because a session hook that does nothing looks precisely like a session hook
 * with nothing to do.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './portable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A cached checkout is only ready when it has both the unit-test runner and
 * the browser-test runner. Keeping this list here lets the thin Claude/Codex
 * hook ask the same question as the installer instead of carrying a stale
 * second definition of "set up".
 */
export const PLAYWRIGHT_PACKAGE = '@playwright/test';
export const SESSION_DEPENDENCIES = ['vitest', PLAYWRIGHT_PACKAGE];

export function sessionDependenciesInstalled(root, exists = existsSync) {
  return SESSION_DEPENDENCIES.every((name) =>
    exists(join(root, 'node_modules', ...name.split('/'))),
  );
}

const loadPlaywright = (root) =>
  createRequire(join(root, 'package.json'))(PLAYWRIGHT_PACKAGE);

/**
 * Playwright's npm package and browser payload have different lifetimes.
 * chromium.executablePath() names the exact binary required by this installed
 * Playwright version, so a restored node_modules cache cannot hide a missing
 * browser cache or accept a stale Chromium from another Playwright version.
 */
export function playwrightChromiumInstalled(
  root,
  exists = existsSync,
  load = loadPlaywright,
) {
  try {
    const playwright = load(root);
    const executable = playwright?.chromium?.executablePath?.();
    return typeof executable === 'string' && executable.length > 0 && exists(executable);
  } catch {
    return false;
  }
}

export function sessionReady(root, exists = existsSync, load = loadPlaywright) {
  return sessionDependenciesInstalled(root, exists)
    && playwrightChromiumInstalled(root, exists, load);
}

/** Use npm's portable launcher rather than a platform-specific .bin shim. */
export const playwrightBrowserInstallArgs = (withSystemDeps = false) =>
  ['exec', '--', 'playwright', 'install', ...(withSystemDeps ? ['--with-deps'] : []), 'chromium'];

export function playwrightProvisionArgs(
  root,
  withSystemDeps = false,
  exists = existsSync,
  load = loadPlaywright,
) {
  return playwrightChromiumInstalled(root, exists, load)
    ? null
    : playwrightBrowserInstallArgs(withSystemDeps);
}

export function sessionStart(root = join(HERE, '..')) {
  /**
   * Orientation first: unshallow the clone, say what CI last said about
   * `main`, and print who is holding which issue. All three are invisible
   * otherwise, and the shallow clone in particular makes git answer ancestry
   * questions WRONGLY rather than refusing them — see tools/orient.mjs.
   */
  spawnSync(process.execPath, [join(HERE, 'orient.mjs')], { cwd: root, stdio: 'inherit' });

  /**
   * `install`, not `ci`: a remote container's image is cached after this hook
   * completes, and `ci` deletes node_modules first, which throws that cache
   * away every time. Skipped entirely when the dependencies are already there,
   * which is the normal case on a developer's own machine.
   */
  if (!sessionDependenciesInstalled(root)) {
    console.log('installing dependencies…');
    runNpm(['install', '--no-audit', '--no-fund'], { cwd: root });
  }

  /**
   * A fresh cloud checkout now has the Playwright package, but the browser
   * binary is intentionally not stored in the lockfile. Ensure Chromium is in
   * Playwright's cache as part of the same session bootstrap. The command is
   * idempotent, so a cached container pays only the existence check/download
   * check on later starts.
   *
   * Do not fail the session if the browser download is unavailable. That is
   * the same failure policy as dependency install and content warming: print
   * the actionable command and leave the checkout usable.
   */
  if (existsSync(join(root, 'node_modules', '@playwright', 'test'))) {
    const container = process.platform === 'linux'
      && (process.env.CLAUDE_CODE_REMOTE === 'true' || existsSync('/.dockerenv'));
    const installArgs = playwrightProvisionArgs(root, container);
    if (installArgs) {
      console.log('ensuring Playwright Chromium is available…');
      let browser = runNpm(installArgs, { cwd: root });

      // A locked-down cloud image may let Playwright download a browser while
      // refusing apt/sudo. Keep the useful half instead of turning that into a
      // failed session bootstrap.
      if (!browser.ok && container) {
        console.log('Playwright system dependencies could not be installed; retrying Chromium only…');
        browser = runNpm(playwrightBrowserInstallArgs(false), { cwd: root });
      }
      if (!browser.ok) {
        console.log('Playwright Chromium is unavailable — run `npm run playwright:install` before browser tests');
      }
    }
  }

  /**
   * Warm the parsed-content cache (packages/content/src/index.ts). The first
   * loadContent() of a session pays ~730ms to parse 74 YAML files and writes
   * the result to node_modules/.cache; every test file after it pays ~225ms.
   *
   * `npm run validate` is the warmer because it already loads the content and
   * takes about a second, so it costs nothing extra and answers a second
   * question on the way past: whether this checkout's content is even valid. A
   * failure here is worth printing and is not worth blocking the session over
   * — the agent will run the same command and get the same list.
   */
  console.log('warming the content cache…');
  if (!runNpm(['run', 'validate'], { cwd: root }).ok) {
    console.log('content does not validate — see the errors above');
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/session-start.mjs')) {
  sessionStart(process.env.CLAUDE_PROJECT_DIR ?? join(HERE, '..'));
}
