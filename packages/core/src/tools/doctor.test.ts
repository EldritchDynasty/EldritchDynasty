import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A DIAGNOSIS THAT CHANGES NOTHING AND SAYS WHAT WOULD.
 *
 * `tools/doctor.mjs` is the thing to run when a checkout is wrong and nobody
 * knows how. Two properties make it worth running, and both are asserted here
 * rather than promised in its header:
 *
 *   - It is READ-ONLY. Every git and npm command it would issue is recorded
 *     and checked against a list of verbs that write nothing. A doctor that
 *     quietly installed the missing package would report a healthy checkout
 *     and hide the thing it was asked to find.
 *   - It is HONEST WHEN IT CANNOT KNOW. Offline is `unknown`, a browser that
 *     will not start is `unavailable` even though the file is there, and no
 *     line can carry a credential an error message happened to contain.
 *
 * Everything is injected; nothing here touches the network or launches a
 * browser, so the suite runs as-is on the Windows runner.
 */

const REPO = join(import.meta.dirname, '../../../..');
const source = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

type Check = { id: string; state: string; detail: string; required: boolean; fix?: string };
type Git = (args: string[]) => { ok: boolean; out: string };
type Verdict = { parseVerdict: (m: string) => unknown; stateOf: (v: unknown) => string };
type Exists = (path: string) => boolean;
type Load = (root: string) => unknown;

const doctor = (await import(pathToFileURL(join(REPO, 'tools/doctor.mjs')).href)) as {
  satisfies: (version: string, range: string) => boolean;
  redact: (text: string) => string;
  toolchainChecks: (input: {
    node: string; npm: string | null; nvmrc: string | null; engines?: Record<string, string>;
  }) => Check[];
  dependencyCheck: (root: string, io?: { exists?: Exists; read?: (p: string) => string | null }) => Check;
  chromiumCheck: (root: string, io?: {
    exists?: Exists; load?: Load; launch?: (root: string) => { ok: boolean; detail: string }; probe?: boolean;
  }) => Check;
  hookCheck: (root: string, io?: { read?: (p: string) => string | null; exists?: Exists }) => Check;
  ciCheck: (io: { git: Git; verdict: Verdict | null }) => Check;
  diagnose: (root: string, io?: Record<string, unknown>) => Promise<{ ok: boolean; checks: Check[] }>;
  describeDiagnosis: (result: { checks: Check[] }) => string[];
};
const verdictTool = (await import(pathToFileURL(join(REPO, 'tools/verdict.mjs')).href)) as Verdict;

const MAIN = 'a'.repeat(40);
const VERDICT_OID = 'b'.repeat(40);
const TOKEN = 'ghs_' + 'Q'.repeat(36);
const GREEN = `conclusion: success\nsha: ${MAIN}\nbranch: main\njob: fast = success\n`;

/**
 * A git that answers from a table, records every call, and — on purpose —
 * puts a token into every failure and every multi-line answer it gives, the
 * way an error naming a credentialed remote URL would. Nothing the doctor
 * prints may contain it. (`rev-parse` answers one line in real life, so it
 * does here.)
 */
function fakeGit(answers: Record<string, string | null>) {
  const calls: string[][] = [];
  const git: Git = (args) => {
    calls.push(args);
    const key = args.join(' ');
    const hit = Object.keys(answers).find((k) => key.includes(k));
    const answer = hit === undefined ? null : answers[hit]!;
    if (answer === null) {
      return { ok: false, out: `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/o/r.git/'` };
    }
    return { ok: true, out: args[0] === 'rev-parse' ? answer : `${answer}\n# ${TOKEN}` };
  };
  return { calls, git };
}

describe('the version ranges an engines field states', () => {
  it('reads the contract this repository declares', () => {
    expect(doctor.satisfies('22.0.0', '>=22 <23')).toBe(true);
    expect(doctor.satisfies('22.22.0', '>=22 <23')).toBe(true);
    expect(doctor.satisfies('v22.9.1', '>=22 <23')).toBe(true);
    expect(doctor.satisfies('21.9.9', '>=22 <23')).toBe(false);
    expect(doctor.satisfies('23.0.0', '>=22 <23')).toBe(false);
    expect(doctor.satisfies('24.19.0', '>=22 <23'), "#1932's reproduction ran here").toBe(false);
    expect(doctor.satisfies('10.9.4', '>=10')).toBe(true);
    expect(doctor.satisfies('9.9.9', '>=10')).toBe(false);
  });

  it('reads the other common forms rather than guessing at them', () => {
    expect(doctor.satisfies('22.4.1', '^22.1.0')).toBe(true);
    expect(doctor.satisfies('23.0.0', '^22.1.0')).toBe(false);
    expect(doctor.satisfies('22.1.9', '~22.1')).toBe(true);
    expect(doctor.satisfies('22.2.0', '~22.1')).toBe(false);
    expect(doctor.satisfies('22.7.0', '22')).toBe(true);
    expect(doctor.satisfies('22.7.0', '22.x')).toBe(true);
    expect(doctor.satisfies('20.1.0', '^18 || ^20')).toBe(true);
    expect(doctor.satisfies('22.0.0', '> 21')).toBe(true);
    expect(doctor.satisfies('21.5.0', '> 21')).toBe(false);
    expect(doctor.satisfies('22.0.0', 'latest'), 'an unreadable range is not a pass').toBe(false);
    expect(doctor.satisfies('22.0.0', '')).toBe(false);
  });
});

describe('the toolchain', () => {
  const engines = { node: '>=22 <23', npm: '>=10' };

  it('calls the pinned major ready', () => {
    const [node, npm] = doctor.toolchainChecks({ node: '22.22.0', npm: '10.9.4', nvmrc: '22\n', engines });
    expect(node).toMatchObject({ state: 'ready', required: true });
    expect(npm).toMatchObject({ state: 'ready' });
    expect(node!.fix).toBeUndefined();
  });

  it('calls a floating LTS a mismatch, and names the command that fixes it', () => {
    const [node] = doctor.toolchainChecks({ node: '24.19.0', npm: '11.6.0', nvmrc: '22', engines });
    expect(node!.state).toBe('mismatch');
    expect(node!.fix).toContain('nvm install 22');
  });

  it('says unknown, not ready, when there is nothing to compare against', () => {
    const [node, npm] = doctor.toolchainChecks({ node: '22.22.0', npm: null, nvmrc: null, engines });
    expect(node!.state).toBe('unknown');
    expect(npm!.state).toBe('unknown');
  });

  it('holds npm to its own range', () => {
    const [, npm] = doctor.toolchainChecks({ node: '22.0.0', npm: '9.8.1', nvmrc: '22', engines });
    expect(npm!.state).toBe('mismatch');
  });
});

describe('dependencies and the browser', () => {
  const exists = (paths: string[]) => (p: string) => paths.includes(p.replace(/\\/g, '/'));
  const playwright: Load = () => ({ chromium: { executablePath: () => '/browser-cache/chromium' } });
  const installed = ['/repo/node_modules', '/repo/node_modules/vitest', '/repo/node_modules/@playwright/test'];

  it('reports a checkout with no install as missing, and says to run setup', () => {
    const c = doctor.dependencyCheck('/repo', { exists: exists([]), read: () => null });
    expect(c).toMatchObject({ state: 'missing', fix: 'npm run setup', required: true });
  });

  it('reports an install with no fingerprint as stale, not ready', () => {
    const c = doctor.dependencyCheck('/repo', {
      exists: exists(installed),
      read: (p) => (p.replace(/\\/g, '/').endsWith('package-lock.json') ? '{}' : null),
    });
    expect(c.state).toBe('stale');
  });

  it('reports a missing browser as unavailable, and never as required', () => {
    const c = doctor.chromiumCheck('/repo', { exists: exists(installed), load: playwright, launch: () => ({ ok: true, detail: '' }) });
    expect(c).toMatchObject({ state: 'unavailable', required: false, fix: 'npm run setup -- --browser' });
  });

  it('calls an executable that will not start unavailable', () => {
    const c = doctor.chromiumCheck('/repo', {
      exists: exists([...installed, '/browser-cache/chromium']),
      load: playwright,
      launch: () => ({ ok: false, detail: 'error while loading shared libraries: libnss3.so' }),
    });
    expect(c.state).toBe('unavailable');
    expect(c.detail).toContain('libnss3');
    expect(c.fix).toContain('install-deps');
  });

  it('does not launch anything when told not to', () => {
    let launched = false;
    const c = doctor.chromiumCheck('/repo', {
      exists: exists([...installed, '/browser-cache/chromium']),
      load: playwright,
      launch: () => ((launched = true), { ok: true, detail: '' }),
      probe: false,
    });
    expect(c.state).toBe('ready');
    expect(launched).toBe(false);
  });
});

describe('the hook registrations', () => {
  it('finds this repository\'s own registrations intact', () => {
    const c = doctor.hookCheck(REPO);
    expect(c.state, c.detail).toBe('ready');
    expect(c.detail).toMatch(/^\d+ registrations/);
    expect(Number(/^(\d+)/.exec(c.detail)?.[1])).toBeGreaterThanOrEqual(4);
  });

  const files = (settings: string, codex: string) => (p: string) => {
    const n = p.replace(/\\/g, '/');
    if (n.endsWith('.claude/settings.json')) return settings;
    if (n.endsWith('.codex/hooks.json')) return codex;
    return null;
  };
  const hook = (h: object) => JSON.stringify({ hooks: { SessionStart: [{ hooks: [h] }] } });

  it('reports a registration naming a script that is not there', () => {
    const c = doctor.hookCheck('/repo', {
      read: files(
        hook({ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/gone.mjs'] }),
        hook({ type: 'command', command: 'node "$(git rev-parse --show-toplevel)/.claude/hooks/gone.mjs"' }),
      ),
      exists: () => false,
    });
    expect(c.state).toBe('broken');
    expect(c.detail).toContain('.claude/settings.json names .claude/hooks/gone.mjs');
    expect(c.detail).toContain('.codex/hooks.json names .claude/hooks/gone.mjs');
    expect(c.fix).toBeDefined();
  });

  it('reports a registration that does not parse, rather than reading it as empty', () => {
    const c = doctor.hookCheck('/repo', { read: files('{ not json', hook({ command: 'bash x.sh' })), exists: () => true });
    expect(c.state).toBe('broken');
    expect(c.detail).toContain('.claude/settings.json does not parse');
    expect(c.detail).toContain('naming no .claude/hooks script');
  });
});

describe('the last CI verdict', () => {
  it('reads a recorded verdict through verdict.mjs\'s own parser', () => {
    const { git } = fakeGit({
      'refs/heads/main': `${MAIN}\trefs/heads/main`,
      [`refs/verdict/${MAIN}`]: `${VERDICT_OID}\trefs/verdict/${MAIN}`,
      [`log -1 --format=%B ${VERDICT_OID}`]: GREEN,
    });
    expect(doctor.ciCheck({ git, verdict: verdictTool })).toMatchObject({ state: 'green', required: false });
  });

  it('says absent, not green, when CI recorded nothing', () => {
    const { git } = fakeGit({ 'refs/heads/main': `${MAIN}\trefs/heads/main`, [`refs/verdict/${MAIN}`]: '' });
    const c = doctor.ciCheck({ git, verdict: verdictTool });
    expect(c.state).toBe('absent');
    expect(c.detail).toContain('not a pass');
  });

  it('says unknown offline, and still reports what this clone last saw', () => {
    const { git } = fakeGit({
      'rev-parse': MAIN,
      [`log -1 --format=%B refs/verdict/${MAIN}`]: GREEN,
    });
    const c = doctor.ciCheck({ git, verdict: verdictTool });
    expect(c.state).toBe('unknown');
    expect(c.detail).toContain('could not be reached');
    expect(c.detail).toContain('last saw green');
    expect(c.fix).toContain('npm run verdict');
  });

  it('says unknown when the verdict exists but has not been fetched, and does not fetch it', () => {
    const { calls, git } = fakeGit({
      'refs/heads/main': `${MAIN}\trefs/heads/main`,
      [`refs/verdict/${MAIN}`]: `${VERDICT_OID}\trefs/verdict/${MAIN}`,
    });
    const c = doctor.ciCheck({ git, verdict: verdictTool });
    expect(c.state).toBe('unknown');
    expect(c.fix).toContain(`npm run verdict -- ${MAIN}`);
    expect(calls.some((a) => a[0] === 'fetch')).toBe(false);
  });
});

describe('the doctor as a whole', () => {
  const offline = () => fakeGit({});
  const base = {
    node: '22.22.0',
    npm: '10.9.4',
    verdict: verdictTool,
    launch: () => ({ ok: true, detail: '' }),
  };

  /**
   * The read-only rule, checked against everything it would run. `ls-remote`
   * writes nothing locally; `rev-parse` and `log` read. Any other verb is a
   * diagnosis that has started changing the thing it diagnoses.
   */
  it('asks git only questions that write nothing', async () => {
    const { calls, git } = fakeGit({
      'refs/heads/main': `${MAIN}\trefs/heads/main`,
      [`refs/verdict/${MAIN}`]: `${VERDICT_OID}\trefs/verdict/${MAIN}`,
    });
    await doctor.diagnose(REPO, { ...base, git });
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(['ls-remote', 'rev-parse', 'log'], args.join(' ')).toContain(args[0]);
  });

  it('has no path to an installer, a fetch or a push in its source', () => {
    const text = source('tools/doctor.mjs');
    expect(text).not.toMatch(/\brunNpm\b|\bsetup\(|provisionBrowser|writeFileSync|mkdirSync/);
    expect(text).not.toMatch(/\[\s*'(fetch|push|pull|install|ci|update-ref|commit)'/);
  });

  it('prints no credential, even when every git output carries one', async () => {
    const { git } = fakeGit({ 'refs/heads/main': `${MAIN}\trefs/heads/main` });
    const result = await doctor.diagnose(REPO, { ...base, git });
    const printed = JSON.stringify(result) + doctor.describeDiagnosis(result).join('\n');
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain('x-access-token');

    const offlineResult = await doctor.diagnose(REPO, { ...base, git: offline().git });
    expect(JSON.stringify(offlineResult)).not.toContain(TOKEN);
  });

  it('redacts URL credentials and GitHub tokens as a second guard', () => {
    expect(doctor.redact(`https://user:${TOKEN}@github.com/o/r`)).toBe('https://***@github.com/o/r');
    expect(doctor.redact(`token ${TOKEN} here`)).toBe('token *** here');
    expect(doctor.redact('github_pat_' + 'A'.repeat(30))).toBe('***');
  });

  it('stays useful offline: CI is unknown and advisory, and the rest still answers', async () => {
    const result = await doctor.diagnose(REPO, { ...base, git: offline().git, probe: false });
    const ci = result.checks.find((c) => c.id === 'ci')!;
    expect(ci).toMatchObject({ state: 'unknown', required: false });
    expect(result.checks.map((c) => c.id)).toEqual(['node', 'npm', 'dependencies', 'chromium', 'hooks', 'ci']);
    expect(result.checks.find((c) => c.id === 'hooks')!.state).toBe('ready');
  });

  it('fails on a required check and not on an advisory one', async () => {
    const wrongNode = await doctor.diagnose(REPO, { ...base, node: '24.19.0', git: offline().git, probe: false });
    expect(wrongNode.ok).toBe(false);

    const noBrowser = await doctor.diagnose(REPO, {
      ...base, git: offline().git, load: () => { throw new Error('no playwright'); },
    });
    expect(noBrowser.checks.find((c) => c.id === 'chromium')!.state).toBe('unavailable');
    expect(noBrowser.checks.filter((c) => c.required).map((c) => c.id))
      .toEqual(['node', 'npm', 'dependencies', 'hooks']);
  });

  it('prints the fix under every line that is not ready, and only there', () => {
    const lines = doctor.describeDiagnosis({
      checks: [
        { id: 'node', state: 'ready', detail: 'Node 22', required: true },
        { id: 'dependencies', state: 'stale', detail: 'lockfile changed', required: true, fix: 'npm run setup' },
      ],
    });
    expect(lines.filter((l) => l.includes('fix:'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('fix: npm run setup');
  });

  it('is the script package.json names', () => {
    const scripts = (JSON.parse(source('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.doctor).toBe('node tools/doctor.mjs');
  });
});
