#!/usr/bin/env node
/**
 * ONE WAY TO MAKE A CHECKOUT READY, FOR HOOKS AND HUMANS ALIKE.
 *
 *   npm run setup                 # dependencies, reused when they still match
 *   npm run setup -- --browser    # …and Playwright's Chromium, launched to prove it
 *
 * The session hook used to ask whether `node_modules/vitest` EXISTED. A
 * node_modules built from last month's lockfile has a vitest in it, so the
 * hook called a stale install ready and every agent on that container tested
 * against dependencies the repository no longer declared. Presence is not
 * freshness, and nothing printed the difference.
 *
 * So readiness is a FINGERPRINT now: a hash of package-lock.json plus the
 * Node major, platform and architecture that installed it, written to
 * `node_modules/.cache/ed-setup.json` only after an install succeeds. Three
 * paths follow from it, and they are the whole contract:
 *
 *   no node_modules           → `npm ci`. Nothing to throw away, and exact.
 *   fingerprint matches       → nothing. The normal case on a second run.
 *   anything else             → `npm install`, never `npm ci`.
 *
 * WHY NOT `npm ci` WHEN WARM. It deletes node_modules first. A remote
 * container's image is cached after the session hook finishes, and a hook that
 * ran `ci` would discard that cache on every start. `ci` is safe only when
 * there is nothing to discard.
 *
 * WHY OUR OWN STAMP AND NOT npm's `node_modules/.package-lock.json`. npm
 * rewrites its hidden lockfile on every reify, including one that failed
 * halfway, and records neither the Node major nor the platform. A
 * node_modules installed on a Windows host and bind-mounted into a Linux
 * devcontainer matches its own hidden lockfile perfectly and carries the wrong
 * esbuild binary. The stamp is written last, by the one path that knows the
 * install finished, and says which machine it was for. It lives beside the
 * content and run caches, inside node_modules, so it can never outlive the
 * install it describes and is already ignored by git.
 *
 * ORDINARY SETUP NEVER REWRITES THE TRACKED LOCKFILE. `npm install` rewrites
 * package-lock.json whenever package.json disagrees with it. A setup step
 * that did that silently would put an unreviewed lockfile into the next
 * commit. If it happens, the original is put back, no stamp is written, and
 * the report says why — the disagreement is a change somebody has to make on
 * purpose.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './portable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const LOCKFILE = 'package-lock.json';
/** Beside `ed-content` and `ed-runs`: inside the install it describes. */
export const STAMP = ['node_modules', '.cache', 'ed-setup.json'];

/**
 * A checkout is only usable when it has both the unit-test runner and the
 * browser-test runner. The fingerprint says the install FINISHED; this list
 * catches a node_modules somebody has since pruned by hand.
 */
export const PLAYWRIGHT_PACKAGE = '@playwright/test';
export const SESSION_DEPENDENCIES = ['vitest', PLAYWRIGHT_PACKAGE];

const QUIET = ['--no-audit', '--no-fund'];

/** What each dependency state asks npm to do. `ci` only where nothing exists. */
export const PLAN = { missing: 'ci', stale: 'install', ready: 'skip' };

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

export const nodeMajor = (version = process.versions.node) =>
  Number(String(version).replace(/^v/, '').split('.')[0]);

/**
 * The machine an install was for, and the lockfile it was installed from.
 *
 * Line endings are folded before hashing. `.gitattributes` pins LF, but a
 * checkout made before it, or an editor that ignores it, would otherwise read
 * as a changed lockfile on every start and reinstall for nothing.
 */
export function dependencyFingerprint(lockText, {
  node = process.versions.node,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return {
    lockfile: createHash('sha256').update(String(lockText).replace(/\r\n/g, '\n')).digest('hex'),
    node: nodeMajor(node),
    platform,
    arch,
  };
}

/**
 * missing | stale | ready, with the reason in words.
 *
 * `missing` means no node_modules at all, and is the only state `npm ci` is
 * allowed to answer. Everything wrong with an install that exists is `stale`.
 */
export function dependencyState(root, { exists = existsSync, read = readText, host = {} } = {}) {
  if (!exists(join(root, 'node_modules'))) {
    return { state: 'missing', detail: 'node_modules is absent' };
  }
  const lock = read(join(root, LOCKFILE));
  if (lock === null) return { state: 'stale', detail: `${LOCKFILE} is missing` };

  const absent = SESSION_DEPENDENCIES.filter((name) =>
    !exists(join(root, 'node_modules', ...name.split('/'))));
  if (absent.length) return { state: 'stale', detail: `${absent.join(' and ')} not installed` };

  let stamp = null;
  try {
    stamp = JSON.parse(read(join(root, ...STAMP)) ?? 'null');
  } catch {
    stamp = null;
  }
  if (!stamp || typeof stamp !== 'object') {
    return { state: 'stale', detail: 'no setup fingerprint — installed by something other than `npm run setup`' };
  }

  const want = dependencyFingerprint(lock, host);
  if (stamp.lockfile !== want.lockfile) {
    return { state: 'stale', detail: `${LOCKFILE} changed since the last install` };
  }
  if (stamp.node !== want.node) {
    return { state: 'stale', detail: `installed under Node ${stamp.node}, running Node ${want.node}` };
  }
  if (stamp.platform !== want.platform || stamp.arch !== want.arch) {
    return {
      state: 'stale',
      detail: `installed for ${stamp.platform}-${stamp.arch}, running on ${want.platform}-${want.arch}`,
    };
  }
  return { state: 'ready', detail: `matches ${LOCKFILE} ${want.lockfile.slice(0, 12)}` };
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

/**
 * The SessionStart gate: fresh dependencies AND the exact Chromium. Read on
 * every local session start, so it reads files and spawns nothing.
 */
export function sessionReady(root, exists = existsSync, load = loadPlaywright, read = readText) {
  return dependencyState(root, { exists, read }).state === 'ready'
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

/**
 * A Linux container is where `--with-deps` is worth trying: there is usually
 * a package manager and nobody to answer a sudo prompt. The platform is an
 * argument so the Windows answer is testable from Linux.
 */
export const inContainer = (platform = process.platform, env = process.env, exists = existsSync) =>
  platform === 'linux' && (env.CLAUDE_CODE_REMOTE === 'true' || exists('/.dockerenv'));

/**
 * AN EXECUTABLE ON DISK IS NOT A BROWSER THAT STARTS.
 *
 * Downloading Chromium and installing the system libraries it links against
 * are separate steps, and a locked-down image allows the first and refuses the
 * second. The binary is then exactly where Playwright looks for it, and every
 * browser test fails at launch. Only launching it tells the two apart.
 */
export function launchChromium(root, timeout = 60_000) {
  const script = [
    "import { createRequire } from 'node:module';",
    `const { chromium } = createRequire(process.argv[1])('${PLAYWRIGHT_PACKAGE}');`,
    'const browser = await chromium.launch();',
    'await browser.close();',
  ].join('\n');
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, join(root, 'package.json')],
    { cwd: root, encoding: 'utf8', timeout },
  );
  if (r.status === 0) return { ok: true, detail: '' };
  if (r.error?.code === 'ETIMEDOUT') return { ok: false, detail: `launch timed out after ${timeout / 1000}s` };
  const line = `${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).find(Boolean) ?? `exit ${r.status}`;
  return { ok: false, detail: line.slice(0, 200) };
}

/**
 * Chromium, installed if absent, and ready only if it would start.
 *
 * The launch is tried whenever it is asked for, and always after the
 * system-library half was refused — the one case where an executable on disk
 * is known to prove nothing. Never throws, and never touches the dependency
 * state: a missing browser must not stop headless simulation work.
 */
export function provisionBrowser(root, {
  container = inContainer(),
  probe = false,
  run = (args) => runNpm(args, { cwd: root }),
  exists = existsSync,
  load = loadPlaywright,
  launch = launchChromium,
  log = console.log,
} = {}) {
  if (!exists(join(root, 'node_modules', ...PLAYWRIGHT_PACKAGE.split('/')))) {
    return { state: 'unavailable', action: 'none', detail: `${PLAYWRIGHT_PACKAGE} is not installed` };
  }

  let action = 'skip';
  let librariesRefused = false;
  const installArgs = playwrightProvisionArgs(root, container, exists, load);
  if (installArgs) {
    action = 'install';
    log('ensuring Playwright Chromium is available…');
    let browser = run(installArgs);
    // A locked-down cloud image may let Playwright download a browser while
    // refusing apt/sudo. Keep the useful half instead of failing outright.
    if (!browser.ok && container) {
      log('Playwright system dependencies could not be installed; retrying Chromium only…');
      librariesRefused = true;
      browser = run(playwrightBrowserInstallArgs(false));
    }
  }

  if (!playwrightChromiumInstalled(root, exists, load)) {
    return { state: 'unavailable', action, detail: 'the Chromium executable Playwright needs is not installed' };
  }
  if (probe || librariesRefused) {
    const started = launch(root);
    if (!started.ok) {
      return {
        state: 'unavailable',
        action,
        detail: `Chromium is installed but does not start${
          librariesRefused ? ' (its system libraries could not be installed)' : ''
        }: ${started.detail}`,
      };
    }
    return { state: 'ready', action, detail: 'Chromium starts' };
  }
  return { state: 'ready', action, detail: 'Chromium executable present' };
}

/**
 * The whole setup. Returns what it found and did rather than throwing: the
 * session hook calls this, and a hook is not allowed to fail a session.
 */
export function setup(root, {
  browser = false,
  probe = false,
  container = inContainer(),
  run = (args) => runNpm(args, { cwd: root }),
  exists = existsSync,
  read = readText,
  write = writeText,
  load = loadPlaywright,
  launch = launchChromium,
  log = console.log,
  host = {},
  now = () => new Date().toISOString(),
} = {}) {
  const before = dependencyState(root, { exists, read, host });
  const action = PLAN[before.state];
  const lockPath = join(root, LOCKFILE);
  let dependencies;

  if (action === 'skip') {
    dependencies = { state: 'ready', action, detail: before.detail };
  } else {
    const lock = read(lockPath);
    if (lock === null) {
      dependencies = {
        state: before.state,
        action: 'none',
        detail: `${LOCKFILE} is missing; restore it from git before installing`,
      };
    } else {
      log(action === 'ci'
        ? 'installing dependencies from the lockfile (npm ci)…'
        : `refreshing dependencies (${before.detail}) with npm install…`);
      const installed = run([action, ...QUIET]);
      const rewritten = read(lockPath) !== lock;
      if (rewritten) write(lockPath, lock);

      if (installed.ok && !rewritten) {
        write(join(root, ...STAMP), `${JSON.stringify({ ...dependencyFingerprint(lock, host), installedAt: now() }, null, 2)}\n`);
        dependencies = { state: 'ready', action, detail: dependencyState(root, { exists, read, host }).detail };
      } else {
        const why = [];
        if (!installed.ok) why.push(`npm ${action} failed`);
        if (rewritten) {
          why.push(`npm ${action} rewrote ${LOCKFILE}, so package.json and the lockfile disagree; `
            + 'setup put the tracked lockfile back. Run `npm install` on purpose and commit the lockfile it writes');
        }
        dependencies = {
          state: dependencyState(root, { exists, read, host }).state,
          action,
          detail: why.join('; '),
          ...(rewritten ? { lockfileRestored: true } : {}),
        };
      }
    }
  }

  const chromium = browser
    ? provisionBrowser(root, { container, probe, run, exists, load, launch, log })
    : null;

  return {
    ok: dependencies.state === 'ready' && (!chromium || chromium.state === 'ready'),
    dependencies,
    browser: chromium,
  };
}

/** The lines a person reads, and the command for anything not ready. */
export function describeSetup(result) {
  const lines = [];
  const d = result.dependencies;
  lines.push(`dependencies: ${d.state}${d.action === 'skip' ? ' (reused)' : d.action === 'none' ? '' : ` (npm ${d.action})`} — ${d.detail}`);
  // A restored lockfile is not something setup can fix by running again: it
  // would install, see the rewrite, and put it back, every time.
  if (d.lockfileRestored) lines.push('  fix: npm install, then review and commit package-lock.json');
  else if (d.state !== 'ready') lines.push('  fix: npm run setup');
  if (result.browser) {
    const b = result.browser;
    lines.push(`chromium: ${b.state} — ${b.detail}`);
    if (b.state !== 'ready') {
      lines.push(d.state === 'ready'
        ? '  fix: npm run setup -- --browser   (a browser that will not start needs `npm exec -- playwright install-deps chromium`, with system-package rights)'
        : '  fix: npm run setup -- --browser   (after the dependencies are ready)');
    }
  }
  return lines;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/setup.mjs')) {
  const argv = process.argv.slice(2);
  const browser = argv.includes('--browser');
  // The checkout this file is in, not CLAUDE_PROJECT_DIR: from a worktree,
  // that variable can name a different checkout's node_modules.
  const result = setup(join(HERE, '..'), { browser, probe: browser });
  for (const line of describeSetup(result)) console.log(line);
  process.exit(result.ok ? 0 : 1);
}
