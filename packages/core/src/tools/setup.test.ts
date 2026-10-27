import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ONE SETUP PATH, AND THE FIVE CHECKOUTS IT HAS TO TELL APART.
 *
 * The session hook used to call a checkout ready when `node_modules/vitest`
 * existed. A node_modules built from an older lockfile has one, so a stale
 * install passed for a fresh one, and nothing said so. `tools/setup.mjs`
 * answers with a fingerprint instead, and these are the cases it must not
 * confuse: fresh, warm, stale, a lockfile npm wanted to rewrite, and a browser
 * that is missing or will not start.
 *
 * Every case here is built rather than downloaded — an injected filesystem and
 * an npm that records what it was asked — in the style of the session-start
 * tests these replaced. No network, so the same suite runs on the Windows
 * runner, which is the platform the paths are most likely to be wrong on.
 */

const REPO = join(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

type Ran = { ok: boolean; out: string };
type Host = { node?: string; platform?: string; arch?: string };
type Exists = (path: string) => boolean;
type Load = (root: string) => unknown;
type Dependencies = { state: string; action: string; detail: string; lockfileRestored?: boolean };
type Browser = { state: string; action: string; detail: string };
type Options = {
  browser?: boolean;
  probe?: boolean;
  container?: boolean;
  run?: (args: string[]) => Ran;
  exists?: Exists;
  read?: (path: string) => string | null;
  write?: (path: string, text: string) => void;
  load?: Load;
  launch?: (root: string) => { ok: boolean; detail: string };
  log?: (line: string) => void;
  host?: Host;
};

/**
 * Loaded the way `portability.test.ts` loads `portable.mjs`: a dynamic import
 * with the shape named here. These are plain ES modules with no declaration
 * file, and writing one would be a second statement of the same signatures.
 */
const tool = (await import(pathToFileURL(join(REPO, 'tools/setup.mjs')).href)) as {
  LOCKFILE: string;
  STAMP: string[];
  PLAN: Record<string, string>;
  PLAYWRIGHT_PACKAGE: string;
  dependencyFingerprint: (lock: string, host?: Host) => Record<string, unknown>;
  dependencyState: (
    root: string,
    io?: { exists?: Exists; read?: (path: string) => string | null; host?: Host },
  ) => { state: string; detail: string };
  sessionReady: (root: string, exists?: Exists, load?: Load, read?: (path: string) => string | null) => boolean;
  playwrightBrowserInstallArgs: (withSystemDeps?: boolean) => string[];
  playwrightProvisionArgs: (root: string, withSystemDeps?: boolean, exists?: Exists, load?: Load) => string[] | null;
  inContainer: (platform: string, env: Record<string, string | undefined>, exists: Exists) => boolean;
  setup: (root: string, options?: Options) => { ok: boolean; dependencies: Dependencies; browser: Browser | null };
  describeSetup: (result: { dependencies: Dependencies; browser: Browser | null }) => string[];
};

/**
 * THE MACHINE RUNNING THIS SUITE, NOT A MACHINE IT IMAGINES.
 *
 * `sessionReady` reads the real platform, because that is the question the
 * hook asks. The first cut stamped every fixture as linux-x64, which matched
 * the Linux runner by coincidence; the Windows runner then saw — correctly —
 * an install made for another platform, and two tests failed on the very
 * fingerprint they were written to defend. "Another" platform, architecture
 * and Node major are derived from this one, so each case means the same thing
 * on every runner.
 */
const HOST: Host = { node: process.versions.node, platform: process.platform, arch: process.arch };
const OTHER_PLATFORM = HOST.platform === 'win32' ? 'linux' : 'win32';
const OTHER_ARCH = HOST.arch === 'arm64' ? 'x64' : 'arm64';
const OTHER_NODE = `${Number(process.versions.node.split('.')[0]) - 2}.1.0`;
const LOCK = '{"name":"eldritch-dynasty","lockfileVersion":3}\n';
const CHROMIUM = '/browser-cache/chromium';
const playwright: Load = () => ({ chromium: { executablePath: () => CHROMIUM } });
const quiet = () => {};

/**
 * A checkout, as a set of paths. Slashes are folded so `join` on the Windows
 * runner names the same entries as `join` here.
 */
function checkout({
  installed = false,
  stamp = undefined as Host | 'none' | undefined,
  lock = LOCK,
  browser = false,
} = {}) {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  files.set('/repo/package-lock.json', lock);
  const install = () => {
    for (const d of ['/repo/node_modules', '/repo/node_modules/vitest', '/repo/node_modules/@playwright/test']) dirs.add(d);
  };
  if (installed) install();
  if (installed && stamp !== 'none') {
    files.set(
      `/repo/${tool.STAMP.join('/')}`,
      JSON.stringify(tool.dependencyFingerprint(lock, stamp ?? HOST)),
    );
  }
  if (browser) files.set(CHROMIUM, '');
  const io = {
    exists: (p: string) => files.has(norm(p)) || dirs.has(norm(p)),
    read: (p: string) => files.get(norm(p)) ?? null,
    write: (p: string, t: string) => void files.set(norm(p), t),
  };
  return { files, dirs, install, io };
}

/** An npm that records every command and does what it is told to. */
function npm(
  repo: ReturnType<typeof checkout>,
  { fail = [] as string[], rewriteLock = null as string | null, browserInstalls = true } = {},
) {
  const calls: string[] = [];
  const run = (args: string[]): Ran => {
    const command = args.join(' ');
    calls.push(command);
    const failed = fail.some((f) => command.includes(f));
    if (!failed && (args[0] === 'ci' || args[0] === 'install')) repo.install();
    if (rewriteLock !== null && (args[0] === 'ci' || args[0] === 'install')) {
      repo.files.set('/repo/package-lock.json', rewriteLock);
    }
    if (!failed && args.includes('playwright') && browserInstalls) repo.files.set(CHROMIUM, '');
    return { ok: !failed, out: '' };
  };
  return { calls, run };
}

const run = (repo: ReturnType<typeof checkout>, driver: ReturnType<typeof npm>, extra: Options = {}) =>
  tool.setup('/repo', {
    ...repo.io, run: driver.run, load: playwright, log: quiet, host: HOST, container: false, ...extra,
  });

describe('the dependency fingerprint', () => {
  it('is the lockfile and the machine, and nothing else', () => {
    expect(tool.dependencyFingerprint(LOCK, HOST)).toEqual(tool.dependencyFingerprint(LOCK, HOST));
    expect(tool.dependencyFingerprint(LOCK, HOST)).not.toEqual(tool.dependencyFingerprint(`${LOCK} `, HOST));
    expect(tool.dependencyFingerprint(LOCK, { ...HOST, node: '24.1.0' }).node).toBe(24);
    expect(tool.dependencyFingerprint(LOCK, { ...HOST, node: 'v22.9.0' }).node).toBe(22);
  });

  it('does not read a CRLF checkout of the same lockfile as a change', () => {
    expect(tool.dependencyFingerprint(LOCK.replace(/\n/g, '\r\n'), HOST))
      .toEqual(tool.dependencyFingerprint(LOCK, HOST));
  });

  /**
   * A node_modules installed on a Windows host and bind-mounted into a Linux
   * container matches its lockfile perfectly and carries the wrong esbuild.
   */
  it('reads an install made on another platform as stale', () => {
    const repo = checkout({ installed: true, stamp: { ...HOST, platform: OTHER_PLATFORM } });
    expect(tool.dependencyState('/repo', { ...repo.io, host: HOST })).toEqual({
      state: 'stale',
      detail: `installed for ${OTHER_PLATFORM}-${HOST.arch}, running on ${HOST.platform}-${HOST.arch}`,
    });
  });

  it('lives inside node_modules, so it cannot outlive the install it describes', () => {
    expect(tool.STAMP.slice(0, 2)).toEqual(['node_modules', '.cache']);
    expect(read('.gitignore')).toMatch(/^\/?node_modules\/?$/m);
  });
});

describe('npm run setup', () => {
  it('installs a fresh checkout with npm ci, and stamps it', () => {
    const repo = checkout();
    const driver = npm(repo);
    const result = run(repo, driver);

    expect(driver.calls).toEqual(['ci --no-audit --no-fund']);
    expect(result.dependencies).toMatchObject({ state: 'ready', action: 'ci' });
    expect(tool.dependencyState('/repo', { ...repo.io, host: HOST }).state).toBe('ready');
  });

  it('reuses a warm checkout whose fingerprint matches, and runs nothing', () => {
    const repo = checkout();
    run(repo, npm(repo));
    const second = npm(repo);
    const result = run(repo, second);

    expect(second.calls).toEqual([]);
    expect(result.dependencies).toMatchObject({ state: 'ready', action: 'skip' });
    expect(result.ok).toBe(true);
  });

  it('notices a changed lockfile and refreshes it with npm install', () => {
    const repo = checkout({ installed: true });
    repo.files.set('/repo/package-lock.json', `${LOCK}{"changed":true}\n`);
    expect(tool.dependencyState('/repo', { ...repo.io, host: HOST }))
      .toEqual({ state: 'stale', detail: 'package-lock.json changed since the last install' });

    const driver = npm(repo);
    const result = run(repo, driver);
    expect(driver.calls).toEqual(['install --no-audit --no-fund']);
    expect(result.dependencies.state).toBe('ready');
    expect(tool.dependencyState('/repo', { ...repo.io, host: HOST }).state).toBe('ready');
  });

  /**
   * The cached-image property. `npm ci` deletes node_modules before it
   * installs, so on a warm tree it throws away the container cache the
   * session hook exists to keep. Every way a warm tree can be stale must be
   * answered by `install`.
   */
  it('never runs npm ci on a warm tree, however it is stale', () => {
    const variants: Array<[string, ReturnType<typeof checkout>]> = [
      ['no fingerprint (installed by a plain npm install)', checkout({ installed: true, stamp: 'none' })],
      ['installed under another Node major', checkout({ installed: true, stamp: { ...HOST, node: OTHER_NODE } })],
      ['installed for another architecture', checkout({ installed: true, stamp: { ...HOST, arch: OTHER_ARCH } })],
    ];
    const pruned = checkout({ installed: true });
    pruned.dirs.delete('/repo/node_modules/vitest');
    variants.push(['vitest pruned by hand', pruned]);

    for (const [why, repo] of variants) {
      expect(tool.dependencyState('/repo', { ...repo.io, host: HOST }).state, why).toBe('stale');
      const driver = npm(repo);
      run(repo, driver);
      expect(driver.calls, why).toEqual(['install --no-audit --no-fund']);
    }
    expect(tool.PLAN).toEqual({ missing: 'ci', stale: 'install', ready: 'skip' });
  });

  it('puts the tracked lockfile back when npm install rewrites it, and does not call that ready', () => {
    const repo = checkout({ installed: true, stamp: 'none' });
    const driver = npm(repo, { rewriteLock: '{"rewritten":true}\n' });
    const result = run(repo, driver);

    expect(repo.files.get('/repo/package-lock.json')).toBe(LOCK);
    expect(result.ok).toBe(false);
    expect(result.dependencies).toMatchObject({ state: 'stale', lockfileRestored: true });
    expect(result.dependencies.detail).toContain('commit the lockfile');
    expect(repo.files.has(`/repo/${tool.STAMP.join('/')}`), 'a refused rewrite must not be stamped').toBe(false);
    // Running setup again would only repeat this, so the fix is not setup.
    expect(tool.describeSetup(result)).toContain('  fix: npm install, then review and commit package-lock.json');
    expect(tool.describeSetup(result)).not.toContain('  fix: npm run setup');
  });

  it('reports a failed install without stamping it', () => {
    const repo = checkout();
    const result = run(repo, npm(repo, { fail: ['ci'] }));

    expect(result.ok).toBe(false);
    expect(result.dependencies).toMatchObject({ state: 'missing', action: 'ci', detail: 'npm ci failed' });
    expect(tool.describeSetup(result)).toContain('  fix: npm run setup');
  });

  it('refuses to install without a lockfile rather than inventing one', () => {
    const repo = checkout({ installed: true, stamp: 'none' });
    repo.files.delete('/repo/package-lock.json');
    const driver = npm(repo);
    const result = run(repo, driver);

    expect(driver.calls).toEqual([]);
    expect(result.dependencies.detail).toContain('restore it from git');
  });

  /**
   * The defaults, on a real disk. Everything above injects the filesystem;
   * this proves the stamp lands where `dependencyState` reads it, with this
   * platform's separators, so the Windows runner checks the Windows spelling.
   */
  it('writes the stamp where it reads it, on the real filesystem', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-setup-'));
    try {
      writeFileSync(join(root, 'package-lock.json'), LOCK);
      for (const d of ['vitest', join('@playwright', 'test')]) mkdirSync(join(root, 'node_modules', d), { recursive: true });

      expect(tool.dependencyState(root).state).toBe('stale');
      const calls: string[][] = [];
      const result = tool.setup(root, { run: (args) => (calls.push(args), { ok: true, out: '' }), log: quiet });

      expect(calls).toEqual([['install', '--no-audit', '--no-fund']]);
      expect(result.dependencies.state).toBe('ready');
      expect(existsSync(join(root, ...tool.STAMP))).toBe(true);
      expect(tool.dependencyState(root).state).toBe('ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the browser half', () => {
  it('loads Chromium through the Playwright package the repository declares directly', () => {
    expect(tool.PLAYWRIGHT_PACKAGE).toBe('@playwright/test');
  });

  it('does not call a checkout ready when Playwright is missing', () => {
    const repo = checkout({ installed: true, browser: true });
    repo.dirs.delete('/repo/node_modules/@playwright/test');

    expect(tool.dependencyState('/repo', { ...repo.io, host: HOST }).detail).toBe('@playwright/test not installed');
    expect(tool.sessionReady('/repo', repo.io.exists, playwright, repo.io.read)).toBe(false);
  });

  it('does not call a checkout ready when packages exist but Chromium is absent', () => {
    const repo = checkout({ installed: true });

    expect(tool.dependencyState('/repo', { ...repo.io }).state).toBe('ready');
    expect(tool.sessionReady('/repo', repo.io.exists, playwright, repo.io.read)).toBe(false);
    expect(tool.playwrightProvisionArgs('/repo', false, repo.io.exists, playwright))
      .toEqual(['exec', '--', 'playwright', 'install', 'chromium']);
  });

  it('skips browser provisioning only when the exact Chromium executable exists', () => {
    const repo = checkout({ installed: true, browser: true });

    expect(tool.sessionReady('/repo', repo.io.exists, playwright, repo.io.read)).toBe(true);
    expect(tool.playwrightProvisionArgs('/repo', false, repo.io.exists, playwright)).toBeNull();
  });

  it('installs Chromium through npm exec, not a platform-specific bin shim', () => {
    expect(tool.playwrightBrowserInstallArgs())
      .toEqual(['exec', '--', 'playwright', 'install', 'chromium']);
    expect(tool.playwrightBrowserInstallArgs(true))
      .toEqual(['exec', '--', 'playwright', 'install', '--with-deps', 'chromium']);
  });

  it('reports a missing browser without touching the dependency result', () => {
    const repo = checkout({ installed: true });
    const driver = npm(repo, { browserInstalls: false });
    const result = run(repo, driver, { browser: true });

    expect(result.dependencies.state, 'headless work must not wait on a browser').toBe('ready');
    expect(result.browser).toMatchObject({ state: 'unavailable', action: 'install' });
    expect(result.ok).toBe(false);
    expect(tool.describeSetup(result).join('\n')).toContain('npm run setup -- --browser');
  });

  it('retries without system libraries in a container, and launches to find out whether that worked', () => {
    const repo = checkout({ installed: true });
    const driver = npm(repo, { fail: ['--with-deps'] });
    const started = { ok: false, detail: 'error while loading shared libraries: libnss3.so' };
    const result = run(repo, driver, { browser: true, container: true, launch: () => started });

    expect(driver.calls).toEqual([
      'exec -- playwright install --with-deps chromium',
      'exec -- playwright install chromium',
    ]);
    expect(result.browser?.state, 'an executable that cannot start is not a ready browser').toBe('unavailable');
    expect(result.browser?.detail).toContain('system libraries could not be installed');
    expect(result.dependencies.state).toBe('ready');

    const fine = checkout({ installed: true });
    const ok = run(fine, npm(fine, { fail: ['--with-deps'] }), {
      browser: true, container: true, launch: () => ({ ok: true, detail: '' }),
    });
    expect(ok.browser?.state).toBe('ready');
  });

  it('launches an already-installed browser when asked to, rather than trusting the file', () => {
    const repo = checkout({ installed: true, browser: true });
    const driver = npm(repo);
    const result = run(repo, driver, {
      browser: true, probe: true, launch: () => ({ ok: false, detail: 'Host system is missing dependencies' }),
    });

    expect(driver.calls).toEqual([]);
    expect(result.browser).toMatchObject({ state: 'unavailable', action: 'skip' });
  });

  it('does not run Playwright at all when its package is not installed', () => {
    const repo = checkout();
    const driver = npm(repo, { fail: ['ci'] });
    const result = run(repo, driver, { browser: true });

    expect(driver.calls).toEqual(['ci --no-audit --no-fund']);
    expect(result.browser).toMatchObject({ state: 'unavailable', action: 'none' });
  });

  it('tries system libraries only in a Linux container, decided from arguments', () => {
    const none = () => false;
    expect(tool.inContainer('linux', { CLAUDE_CODE_REMOTE: 'true' }, none)).toBe(true);
    expect(tool.inContainer('linux', {}, (p) => p === '/.dockerenv')).toBe(true);
    expect(tool.inContainer('linux', {}, none)).toBe(false);
    expect(tool.inContainer('win32', { CLAUDE_CODE_REMOTE: 'true' }, () => true)).toBe(false);
  });
});

describe('hooks and people take one path', () => {
  it('is the script package.json names', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.setup).toBe('node tools/setup.mjs');
  });

  it('is what the session start calls, so it never installs anything of its own', () => {
    const start = read('tools/session-start.mjs');
    expect(start).toMatch(/import \{[^}]*\bsetup\b[^}]*\} from '\.\/setup\.mjs'/);
    expect(start, 'session-start.mjs runs its own npm install or ci again').not.toMatch(/\[\s*'(install|ci)'/);
  });

  it('is what the hook gate asks, so the gate means fresh rather than present', () => {
    expect(read('.claude/hooks/session-start.mjs'))
      .toMatch(/import \{ sessionReady \} from '\.\.\/\.\.\/tools\/setup\.mjs'/);
  });
});
