#!/usr/bin/env node
/**
 * WHAT IS THIS CHECKOUT MISSING? — ASKED WITHOUT CHANGING ANYTHING.
 *
 *   npm run doctor               # one line per fact, and the fix for each
 *   npm run doctor -- --json     # the same facts, for a script or an agent
 *   npm run doctor -- --no-launch   # skip starting Chromium to prove it works
 *
 * A managed workspace failed during provisioning once and left nothing to
 * read. Presence checks could not have explained it, because every one of them
 * answered a narrower question than the one being asked: `node_modules/vitest`
 * existing is not dependencies matching the lockfile; a Chromium executable on
 * disk is not a browser that starts; a hook file existing is not a hook
 * registration naming a script that exists. This reports the wider answer to
 * each, and for anything not ready, the one command that makes it so.
 *
 * READ-ONLY, AND THAT IS A RULE RATHER THAN A HABIT. It installs nothing,
 * fetches nothing, writes no ref and no file. Git is asked through `ls-remote`,
 * `rev-parse` and `log` alone, with lazy fetching and prompting switched off;
 * npm is asked for its version and nothing more. `doctor.test.ts` records
 * every command it would run and fails on any other verb, because "the
 * diagnostic quietly fixed it" is how a diagnosis stops being one.
 *
 * NOTHING IT PRINTS CAN CARRY A CREDENTIAL. Git's error output can echo a
 * remote URL, and a remote URL can embed a token. No git stderr is ever shown
 * — an unreachable remote is reported as unreachable, not quoted — and every
 * line is redacted on the way out as a second guard.
 *
 * Exit 0 when every REQUIRED check is ready; 1 otherwise. Chromium and CI are
 * reported but advisory: a missing browser must not fail headless work, and
 * an unreachable network is not a broken checkout.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmInvocation } from './portable.mjs';
import { dependencyState, launchChromium, playwrightChromiumInstalled, PLAYWRIGHT_PACKAGE } from './setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A SEMVER RANGE, WITHOUT A DEPENDENCY.
 *
 * The doctor has to run on a checkout with no node_modules — that is one of
 * the things it diagnoses — so it cannot import `semver`. This covers what an
 * `engines` field here says: space-separated comparators (`>=22 <23`), `||`
 * alternatives, `^` and `~`, and partial versions. Anything else is reported
 * as not satisfied rather than guessed at.
 */
const parseVersion = (v) => {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(String(v).trim());
  if (!m) return null;
  const part = (s) => (s === undefined || s === 'x' || s === '*' ? null : Number(s));
  return [Number(m[1]), part(m[2]), part(m[3])];
};
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
/** The first version past a partial one: 22 → 23.0.0, 22.4 → 22.5.0. */
const past = (c) => (c[1] === null ? [c[0] + 1, 0, 0] : c[2] === null ? [c[0], c[1] + 1, 0] : [c[0], c[1], c[2] + 1]);

function comparator(version, text) {
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(text);
  const c = m && parseVersion(m[2]);
  if (!c) return false;
  const floor = [c[0], c[1] ?? 0, c[2] ?? 0];
  switch (m[1] ?? '=') {
    case '>=': return cmp(version, floor) >= 0;
    case '>': return cmp(version, past(c)) >= 0;
    case '<': return cmp(version, floor) < 0;
    case '<=': return cmp(version, past(c)) < 0;
    case '=': return cmp(version, floor) >= 0 && cmp(version, past(c)) < 0;
    case '^': return cmp(version, floor) >= 0 && cmp(version, [c[0] + 1, 0, 0]) < 0;
    case '~': return cmp(version, floor) >= 0 && cmp(version, past([c[0], c[1] ?? null, null])) < 0;
    default: return false;
  }
}

export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v || typeof range !== 'string' || !range.trim()) return false;
  return range.split('||').some((alternative) => {
    const parts = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((p) => comparator(v, p));
  });
}

/** Tokens and URL credentials, replaced wherever they appear in a line. */
export const redact = (text) => String(text)
  .replace(/(\/\/)[^/@\s]+@/g, '$1***@')
  .replace(/\b(gh[opsur]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');

const check = (id, state, detail, { fix, required = true } = {}) =>
  ({ id, state, detail, required, ...(fix ? { fix } : {}) });

/** Node and npm against `.nvmrc` and `engines`. */
export function toolchainChecks({ node, npm, nvmrc, engines = {} }) {
  const want = String(nvmrc ?? '').trim();
  const nodeFix = want ? `nvm install ${want} && nvm use ${want}   (or any Node ${want} installer)` : undefined;
  const checks = [];

  if (!want) {
    checks.push(check('node', 'unknown', `Node ${node}; .nvmrc is missing, so there is nothing to compare against`, {
      fix: 'git checkout -- .nvmrc',
    }));
  } else {
    const major = String(parseVersion(node)?.[0] ?? '?');
    const inRange = !engines.node || satisfies(node, engines.node);
    const ok = major === want && inRange;
    checks.push(check('node', ok ? 'ready' : 'mismatch',
      `Node ${node} (.nvmrc ${want}${engines.node ? `, engines ${engines.node}` : ''})`,
      ok ? {} : { fix: nodeFix }));
  }

  if (!npm) {
    checks.push(check('npm', 'unknown', 'npm did not report a version', { fix: nodeFix }));
  } else {
    const ok = !engines.npm || satisfies(npm, engines.npm);
    checks.push(check('npm', ok ? 'ready' : 'mismatch',
      `npm ${npm}${engines.npm ? ` (engines ${engines.npm})` : ''}`,
      ok ? {} : { fix: `the npm bundled with Node ${want || 'the .nvmrc major'} satisfies it: ${nodeFix ?? 'reinstall Node'}` }));
  }
  return checks;
}

export function dependencyCheck(root, io = {}) {
  const { state, detail } = dependencyState(root, io);
  return check('dependencies', state, detail, state === 'ready' ? {} : { fix: 'npm run setup' });
}

/**
 * ready | unavailable. Launched unless told not to, because an executable on
 * disk without its system libraries is the exact case that misreports.
 */
export function chromiumCheck(root, { exists = existsSync, load, launch = launchChromium, probe = true } = {}) {
  const fix = 'npm run setup -- --browser';
  if (!exists(join(root, 'node_modules', ...PLAYWRIGHT_PACKAGE.split('/')))) {
    return check('chromium', 'unavailable', `${PLAYWRIGHT_PACKAGE} is not installed`, { fix, required: false });
  }
  if (!playwrightChromiumInstalled(root, exists, ...(load ? [load] : []))) {
    return check('chromium', 'unavailable', 'the Chromium executable Playwright needs is not installed', { fix, required: false });
  }
  if (!probe) return check('chromium', 'ready', 'executable present (not launched: --no-launch)', { required: false });
  const started = launch(root);
  return started.ok
    ? check('chromium', 'ready', 'Chromium starts', { required: false })
    : check('chromium', 'unavailable', `installed but does not start: ${started.detail}`, {
      fix: 'npm exec -- playwright install-deps chromium   (needs system-package rights)', required: false,
    });
}

/**
 * Both registrations parse, and every script they name exists. Neither
 * agent reports a hook that cannot start, so this is the only place that
 * would.
 */
export function hookCheck(root, { read = readText, exists = existsSync } = {}) {
  const problems = [];
  let named = 0;
  const hooksOf = (file) => {
    const text = read(join(root, file));
    if (text === null) {
      problems.push(`${file} is missing`);
      return [];
    }
    try {
      const parsed = JSON.parse(text);
      return Object.values(parsed.hooks ?? {}).flatMap((entries) => entries.flatMap((e) => e.hooks ?? []));
    } catch {
      problems.push(`${file} does not parse`);
      return [];
    }
  };
  const expect = (file, script) => {
    named++;
    if (!exists(join(root, ...script.split('/')))) problems.push(`${file} names ${script}, which is not there`);
  };

  for (const h of hooksOf('.claude/settings.json')) {
    const script = String(h.args?.[0] ?? h.command ?? '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '');
    expect('.claude/settings.json', script);
  }
  for (const h of hooksOf('.codex/hooks.json')) {
    const script = /\.claude\/hooks\/[\w.-]+\.mjs/.exec(String(h.command ?? ''))?.[0];
    if (script) expect('.codex/hooks.json', script);
    else problems.push(`.codex/hooks.json has a hook naming no .claude/hooks script`);
  }
  if (!problems.length && named === 0) problems.push('no hooks are registered at all');

  return problems.length
    ? check('hooks', 'broken', problems.join('; '), {
      fix: 'git diff -- .claude .codex   (then `git checkout -- <file>` for anything not meant to change)',
    })
    : check('hooks', 'ready', `${named} registrations in .claude/settings.json and .codex/hooks.json, every script present`);
}

/**
 * Read-only git: no fetch, no lazy fetch from a promisor remote, no prompt
 * for a credential, and a deadline so an unreachable remote is an answer.
 */
export const readOnlyGit = (root) => (args) => {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`.trim() };
};

/**
 * What CI last said about `main`, through `tools/verdict.mjs`'s own parser.
 *
 * Asks the remote with `ls-remote`, which writes nothing locally, and reads
 * the verdict only if its commit is already here. Unreachable is `unknown`,
 * with the last verdict this clone fetched as context — never a pass.
 */
export function ciCheck({ git, verdict }) {
  const advisory = { required: false };
  if (!verdict) return check('ci', 'unknown', 'tools/verdict.mjs could not be loaded here', advisory);
  const read = (ref) => {
    const body = git(['log', '-1', '--format=%B', ref]);
    return body.ok ? verdict.stateOf(verdict.parseVerdict(body.out)) : null;
  };

  const head = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const sha = head.ok ? /^([0-9a-f]{40})\s/.exec(head.out)?.[1] : null;
  if (!sha) {
    const local = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}']);
    const seen = local.ok && /^[0-9a-f]{40}$/.test(local.out) ? read(`refs/verdict/${local.out}`) : null;
    return check('ci', 'unknown', `the remote could not be reached${
      seen ? `; this clone last saw ${seen} on main ${local.out.slice(0, 7)}` : ''
    }`, { ...advisory, fix: 'npm run verdict -- origin/main --wait 0   (once the remote is reachable)' });
  }

  const short = sha.slice(0, 7);
  const ref = git(['ls-remote', 'origin', `refs/verdict/${sha}`]);
  if (!ref.ok) return check('ci', 'unknown', `could not ask for main ${short}'s verdict`, advisory);
  const oid = /^([0-9a-f]{40})\s/.exec(ref.out)?.[1];
  if (!oid) {
    return check('ci', 'absent', `CI has recorded no verdict for main ${short} — not a pass`, {
      ...advisory, fix: `npm run verdict -- ${sha}`,
    });
  }
  const state = read(oid);
  if (!state) {
    return check('ci', 'unknown', `main ${short} has a verdict this clone has not fetched`, {
      ...advisory, fix: `npm run verdict -- ${sha} --wait 0`,
    });
  }
  return check('ci', state, `main ${short}`, state === 'green' ? advisory : {
    ...advisory, fix: `npm run verdict -- ${sha} --wait 0   (names the jobs)`,
  });
}

/** npm's version, from the user agent npm hands a script, or by asking it. */
export function npmVersion(env = process.env) {
  const agent = /\bnpm\/(\S+)/.exec(env.npm_config_user_agent ?? '')?.[1];
  if (agent) return agent;
  const npm = npmInvocation();
  const r = spawnSync(npm.command, [...npm.prefix, '--version'], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

export async function diagnose(root, {
  node = process.versions.node,
  npm = npmVersion(),
  read = readText,
  exists = existsSync,
  load,
  launch = launchChromium,
  probe = true,
  git = readOnlyGit(root),
  verdict,
} = {}) {
  let engines = {};
  try {
    engines = JSON.parse(read(join(root, 'package.json')) ?? '{}').engines ?? {};
  } catch {
    engines = {};
  }
  const tools = verdict !== undefined ? verdict : await import('./verdict.mjs').catch(() => null);
  const checks = [
    ...toolchainChecks({ node, npm, nvmrc: read(join(root, '.nvmrc')), engines }),
    dependencyCheck(root, { exists, read }),
    chromiumCheck(root, { exists, load, launch, probe }),
    hookCheck(root, { read, exists }),
    ciCheck({ git, verdict: tools }),
  ].map((c) => ({ ...c, detail: redact(c.detail), ...(c.fix ? { fix: redact(c.fix) } : {}) }));
  return { ok: checks.every((c) => !c.required || c.state === 'ready'), checks };
}

const READY = new Set(['ready', 'green']);

export function describeDiagnosis({ checks }) {
  const lines = ['doctor — read-only: nothing was installed, fetched or changed'];
  for (const c of checks) {
    lines.push(`  ${c.state.padEnd(12)}${c.id.padEnd(14)}${c.detail}${c.required ? '' : '  (advisory)'}`);
    if (!READY.has(c.state) && c.fix) lines.push(`  ${''.padEnd(26)}fix: ${c.fix}`);
  }
  return lines;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/doctor.mjs')) {
  const argv = process.argv.slice(2);
  const result = await diagnose(join(HERE, '..'), { probe: !argv.includes('--no-launch') });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else for (const line of describeDiagnosis(result)) console.log(line);
  process.exit(result.ok ? 0 : 1);
}
