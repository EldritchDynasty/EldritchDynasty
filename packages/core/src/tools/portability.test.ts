import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * BOTH PLATFORMS, ENFORCED RATHER THAN ASKED FOR.
 *
 * AGENTS.md has a section called "Supported environments" saying this
 * repository works on Windows and Linux, under Claude Code and Codex, and that
 * all four combinations are first-class. It was prose, and for months it was
 * false in the one place an agent could not see it:
 *
 *   - Every hook was `#!/usr/bin/env bash`, and two of them piped stdin
 *     through `jq` to read their own payload. Neither bash nor jq is on a
 *     Windows box by default, and neither is on a CI runner unless somebody
 *     put it there.
 *   - `.codex/hooks.json` named `C:\Users\GGPC\Documents\repos\...` — one
 *     particular machine, resolvable by no other checkout on any platform —
 *     and the script it pointed at exited early unless `CLAUDE_CODE_REMOTE`
 *     was set, which Codex never sets.
 *   - `tools/janitor.sh` used bash 4 associative arrays and process
 *     substitution, so the one command in this repository that DELETES things
 *     could only be rehearsed from a Linux box.
 *   - Every job in `check.yml` ran on `ubuntu-latest`, so none of that was
 *     ever exercised anywhere it would fail.
 *
 * NOT ONE OF THOSE THROWS. A session hook that cannot start prints nothing an
 * agent sees: the clone stays shallow, `merge-base --is-ancestor` then answers
 * FALSE past the graft boundary rather than failing, so every "has this
 * landed" reads wrong in the direction that looks cautious, and the claims
 * other sessions hold are simply not printed. A Windows agent got a worse
 * session than a Linux one and had no way to find out. That is this codebase's
 * signature failure mode wearing a shell script, and docs/FAILURES.md is full
 * of the same shape.
 *
 * So the rule is a test, and it runs in the fast lane on BOTH runners.
 */

const REPO = join(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/**
 * Loaded the way `land.test.ts` loads `land.mjs`: a dynamic import with the
 * shape named here. These are plain ES modules with no declaration file, and
 * writing one would be a second statement of the same signatures — the thing
 * `packages/schema` exists to stop this repository doing anywhere else.
 */
const portable = (await import(pathToFileURL(join(REPO, 'tools/portable.mjs')).href)) as {
  npmInvocation: (p: string, node: string, cli: string | undefined)
    => { command: string; prefix: string[] };
  nodeModulesLinkType: (p: string) => string;
  repoRelative: (path: string | undefined, root: string, p: string) => string | null;
  foldPath: (path: string, p: string) => string;
  readHookPayload: (stream: AsyncIterable<Buffer>) => Promise<unknown>;
};
const { npmInvocation, nodeModulesLinkType, repoRelative, readHookPayload, foldPath } = portable;

const costTool = (await import(pathToFileURL(join(REPO, 'tools/cost.mjs')).href)) as {
  measure: (script: string, extra?: string[]) => {
    script: string; seconds: number; files?: number; tests?: number; ok: boolean;
  };
  rewriteCommandCosts: (
    text: string,
    results: Array<{
      script: string; seconds: number | null; files?: number; tests?: number; ok: boolean;
    }>,
  ) => string;
};

/** Every tracked file under a directory, recursively, ignoring installs. */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir))) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(REPO, rel)).isDirectory()) filesUnder(rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * THE DIRECTORIES AN AGENT'S SESSION ACTUALLY RUNS THINGS OUT OF.
 *
 * `.devcontainer/` is deliberately not among them. A devcontainer IS a Linux
 * image — `post-create.sh` runs `apt-get` and `chown vscode:vscode` — so bash
 * there is not an assumption, it is the subject. The rule is about scripts
 * that a Windows agent is expected to run, and every one of those lives here.
 */
const AGENT_PATHS = ['.claude', '.codex', 'tools'];

describe('the operating scripts run on both platforms', () => {
  it('names no shell script an agent is expected to run', () => {
    const shells = AGENT_PATHS.flatMap((d) => filesUnder(d)).filter((f) => /\.(sh|bash|zsh)$/.test(f));
    expect(
      shells,
      'a bash script here does not fail loudly on Windows — it does not run, and says nothing. '
      + 'Port it to .mjs; tools/portable.mjs has the four things that differ.',
    ).toEqual([]);
  });

  /**
   * A shebang is advice on Linux and nothing at all on Windows, so the thing
   * that decides whether a script runs is how it is INVOKED. Every invocation
   * this repository controls names `node`.
   */
  it('invokes every one of them with node, from the workflows that use them', () => {
    const janitor = read('.github/workflows/janitor.yml');
    expect(janitor).toContain('node tools/janitor.mjs');
    expect(janitor).not.toMatch(/run:\s*tools\/\S+\.sh/);
  });
});

/**
 * THE HOOKS, WHICH ARE THE FIRST THING THAT RUNS AND THE LAST THING ANYBODY
 * CHECKS.
 *
 * Claude Code's exec form — `command` plus `args` — spawns the executable
 * directly with no shell in the middle. Shell form hands one string to `sh -c`
 * on Linux and macOS, to Git Bash on Windows, and to PowerShell where Git Bash
 * is absent; `${CLAUDE_PROJECT_DIR}` expands in two of those three and is a
 * literal in the other. Codex runs its hook command with the session's working
 * directory, so a path relative to the repository root resolves identically
 * under all of them and an absolute one resolves on exactly one machine.
 */
describe('the session hooks', () => {
  type Hook = { type: string; command: string; args?: string[] };

  it('spawns the Claude hooks without a shell', () => {
    const settings = JSON.parse(read('.claude/settings.json')) as {
      hooks?: Record<string, { hooks: Hook[] }[]>;
    };
    const hooks = Object.values(settings.hooks ?? {}).flatMap((e) => e.flatMap((x) => x.hooks));
    expect(hooks.length, '.claude/settings.json registers no hooks at all').toBeGreaterThan(0);
    for (const h of hooks) {
      expect(h.command).toBe('node');
      expect(h.args?.[0], 'exec form takes the script as an argument').toMatch(/\.mjs$/);
    }
  });

  /**
   * The Codex half cannot use exec form — its `command` is a command line, and
   * Codex runs it with the session cwd, which may be a subdirectory, so the
   * git root is the one anchor correct from anywhere. What matters HERE is
   * only that the interpreter is `node`: `bash` was the previous spelling, and
   * Git Bash is not on every Windows box while `jq` is on almost none.
   *
   * `codex.test.ts` owns the rest of that registration — that it names no
   * absolute path, matches `apply_patch`, and points at the same scripts
   * Claude runs rather than copies of them.
   */
  it('runs the Codex hooks with node rather than a shell interpreter', () => {
    const codex = JSON.parse(read('.codex/hooks.json')) as {
      hooks?: Record<string, { hooks: Hook[] }[]>;
    };
    const hooks = Object.values(codex.hooks ?? {}).flatMap((e) => e.flatMap((x) => x.hooks));
    expect(hooks.length, '.codex/hooks.json registers no hooks at all').toBeGreaterThan(0);
    for (const h of hooks) {
      expect(h.command, 'a hook that needs bash does not run on a plain Windows box')
        .not.toMatch(/\b(bash|sh|zsh|jq)\b/);
      expect(h.command).toMatch(/^node\b/);
      expect(h.command).toMatch(/\.claude\/hooks\/[\w.-]+\.mjs/);
    }
  });
});

/**
 * A TEST THAT SPAWNS `bash` IS A TEST THAT FAILS ON THE WINDOWS RUNNER.
 *
 * Four of them did, and every one was testing something with no shell in it —
 * the interpreter was incidental. `process.execPath` is the one interpreter
 * guaranteed to be present, since it is already running the test.
 */
describe('the suites that drive those scripts', () => {
  const suites = filesUnder('packages').filter((f) => f.endsWith('.test.ts'));

  it('spawns no shell to do it', () => {
    const offenders = suites.filter((f) => /execFileSync\(\s*['"](bash|sh|zsh|jq)['"]/.test(read(f)));
    expect(offenders, 'spawn process.execPath instead — it is the only interpreter both runners have')
      .toEqual([]);
  });

  it('builds no file:// URL by hand, which a drive letter is not', () => {
    const offenders = suites.filter((f) => /`file:\/\/\$\{/.test(read(f)));
    expect(offenders, 'use pathToFileURL: `file://C:\\Users\\...` is not a URL').toEqual([]);
  });
});

/**
 * `npm` IS A `.cmd` SHIM ON WINDOWS AND NODE WILL NOT SPAWN ONE.
 *
 * Not a shell script, not an executable — a script the command processor
 * interprets. Spawning it by name fails with ENOENT; spawning it through a
 * shell hands every argument back to the command processor to re-split, which
 * breaks on the first one containing a space. `npmInvocation` runs npm's own
 * JavaScript CLI through the Node binary already running, so there is no shell
 * and the argument boundaries survive.
 *
 * Three separate tools spawned a bare `npm` before this test existed, and all
 * three were things an agent runs: the session hook, the Electron dev
 * launcher, and `cost.mjs` — the instrument the workflow comments tell
 * everybody to re-measure with.
 */
describe('everything that spawns npm', () => {
  const scripts = [
    ...filesUnder('tools'),
    ...filesUnder('.claude'),
    ...filesUnder('.codex'),
    ...filesUnder('packages/shell/scripts'),
  ].filter((f) => f.endsWith('.mjs'));

  it('goes through npmInvocation rather than naming the binary', () => {
    const offenders = scripts.filter((f) => {
      const text = read(f);
      if (f.endsWith('portable.mjs')) return false;
      return /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*['"]npm(\.cmd)?['"]/.test(text);
    });
    expect(offenders, 'import npmInvocation from tools/portable.mjs').toEqual([]);
  });
});

/**
 * A FAILED MEASUREMENT IS NOT A SHORT MEASUREMENT.
 *
 * cost.mjs exists because remembered timing figures rot. Treating an npm
 * failure as a valid elapsed duration is worse: `--write` can replace a true
 * figure with the time it took a broken suite to abort. Keep this in an
 * existing tooling suite so adding the guard does not itself invalidate the
 * generated per-file duration table.
 */
describe('tools/cost.mjs fails closed', () => {
  it('marks a command that did not complete successfully as unusable', () => {
    const result = costTool.measure('definitely-not-an-eldritch-script');
    expect(result.script).toBe('definitely-not-an-eldritch-script');
    expect(result.ok).toBe(false);
    expect(result.seconds).toBeGreaterThanOrEqual(0);
  });

  it('does not rewrite command costs from failed measurements', () => {
    const original = [
      'npm run test:fast # 47s, the fix-and-rerun loop. Skips the *.slow.test.ts suites;',
      'npm test # everything: 2,536 tests in 157 files, ~14 min',
      '',
    ].join('\n');

    expect(costTool.rewriteCommandCosts(original, [
      { script: 'test:fast', seconds: 2.1, files: 10, tests: 100, ok: false },
      { script: 'test', seconds: 3.2, files: 1, tests: 2, ok: false },
    ])).toBe(original);
  });

  it('still rewrites successful measurements', () => {
    const original = [
      'npm run test:fast # 47s, the fix-and-rerun loop. Skips the *.slow.test.ts suites;',
      'npm test # everything: 2,536 tests in 157 files, ~14 min',
      '',
    ].join('\n');

    const rewritten = costTool.rewriteCommandCosts(original, [
      { script: 'test:fast', seconds: 12.2, files: 10, tests: 100, ok: true },
      { script: 'test', seconds: 61.4, files: 11, tests: 101, ok: true },
    ]);

    expect(rewritten).toContain(
      'npm run test:fast # 12s, the fix-and-rerun loop. Skips the *.slow.test.ts suites;',
    );
    expect(rewritten).toContain('npm test # everything: 101 tests in 11 files, 61s');
  });
});

/**
 * CI IS WHERE THIS STOPS BEING A CLAIM. Everything above is a rule about
 * source; this is the assertion that a machine somewhere actually runs it.
 */
describe('CI', () => {
  const workflow = read('.github/workflows/check.yml');

  it('runs a job on Windows', () => {
    expect(
      /runs-on:\s*windows-latest/.test(workflow),
      'every job on ubuntu means the Windows claim is tested by nobody',
    ).toBe(true);
  });

  it('makes that job run the lane the tooling suites are in', () => {
    const windows = workflow.slice(workflow.indexOf('runs-on: windows-latest'));
    for (const cmd of ['npm run typecheck', 'npm run validate', 'npm run test:fast']) {
      expect(windows, `the Windows job does not run \`${cmd}\``).toContain(cmd);
    }
  });

  /**
   * Git for Windows sets `core.autocrlf=true` at install time, so without
   * this every text file in a Windows checkout gets CRLF — including the 89
   * authored YAML files and `docs/VOCABULARY.md`, which `docs.test.ts`
   * compares against freshly rendered output.
   */
  it('pins line endings so a checkout is the same on both', () => {
    expect(read('.gitattributes')).toMatch(/^\* text=auto eol=lf$/m);
  });
});

/** The four differences themselves, asserted against both platforms by name. */
describe('tools/portable.mjs', () => {
  it('runs npm through its own JavaScript CLI on Windows, where npm is a .cmd shim', () => {
    expect(npmInvocation('win32', 'C:\\node\\node.exe', 'C:\\npm\\npm-cli.js'))
      .toEqual({ command: 'C:\\node\\node.exe', prefix: ['C:\\npm\\npm-cli.js'] });
    expect(npmInvocation('linux', '/usr/bin/node', '/usr/lib/npm-cli.js'))
      .toEqual({ command: 'npm', prefix: [] });
  });

  /**
   * No `npm_execpath` — a hook spawned by the harness rather than by npm.
   * Passed as `''` rather than `undefined`, because `undefined` is what
   * triggers the default parameter and the default reads the environment,
   * which under vitest is npm's own.
   */
  it('falls back to plain npm when nothing named the CLI', () => {
    expect(npmInvocation('win32', 'C:\\node\\node.exe', ''))
      .toEqual({ command: 'npm', prefix: [] });
  });

  it('links node_modules with a junction on Windows, which needs no privilege', () => {
    expect(nodeModulesLinkType('win32')).toBe('junction');
    expect(nodeModulesLinkType('linux')).toBe('dir');
  });

  /**
   * The guards match on `packages/content/loci.yaml`. What a hook is handed on
   * Windows is a backslash path with a drive letter of either case, and the
   * whole thing compares case-insensitively there and not here.
   */
  it('folds a hook path into the one spelling the guards compare against', () => {
    expect(repoRelative('C:\\repo\\packages\\content\\loci.yaml', 'C:\\repo', 'win32'))
      .toBe('packages/content/loci.yaml');
    expect(repoRelative('c:\\REPO\\packages\\Content\\Loci.yaml', 'C:\\repo', 'win32'))
      .toBe('packages/content/loci.yaml');
    expect(repoRelative('/repo/packages/content/loci.yaml', '/repo', 'linux'))
      .toBe('packages/content/loci.yaml');
  });

  /**
   * Case folding is Windows-only on purpose. Two spellings name one file
   * there and two different files here, and a guard that refuses a file it has
   * no business refusing is a guard somebody switches off.
   */
  it('does not fold case on Linux, where two spellings are two files', () => {
    expect(repoRelative('/repo/packages/Content/Loci.yaml', '/repo', 'linux'))
      .toBe('packages/Content/Loci.yaml');
  });

  /**
   * THE BUG THIS PAIR EXISTS FOR, AND IT REACHED `main`.
   *
   * `repoRelative` folds case on Windows, so a path that comes BACK from it is
   * folded — and anything matched AGAINST it has to be folded the same way.
   * `guard-edit.mjs` kept its denial table keyed by the repository's own
   * spelling, so on Windows `docs/VOCABULARY.md` arrived as
   * `docs/vocabulary.md`, missed the lookup, and the guard ALLOWED on Windows
   * the edit it denied on Linux. A guard that works on one platform and lies
   * on the other is worse than one that does neither.
   *
   * The Windows job caught it, which is the whole argument for having one. This
   * asserts it from either runner, which is the argument for the platform being
   * an argument.
   */
  it('folds a path the same way on both sides of a comparison', () => {
    expect(foldPath('docs/VOCABULARY.md', 'win32')).toBe('docs/vocabulary.md');
    expect(foldPath('docs/VOCABULARY.md', 'linux')).toBe('docs/VOCABULARY.md');
    // The round trip: what repoRelative returns must equal the folded key.
    const rel = repoRelative('C:\\repo\\docs\\VOCABULARY.md', 'C:\\repo', 'win32');
    expect(rel).toBe(foldPath('docs/VOCABULARY.md', 'win32'));
  });

  it('says nothing about a path outside the repository', () => {
    expect(repoRelative('/elsewhere/loci.yaml', '/repo', 'linux')).toBeNull();
    expect(repoRelative('', '/repo', 'linux')).toBeNull();
    expect(repoRelative(undefined, '/repo', 'linux')).toBeNull();
  });

  /**
   * The payload reader replaces `jq`, and its one absolute rule is that it
   * cannot be the thing that fails: a guard that blocks on its own bug is
   * worse than the bug it guards against.
   */
  it('reads a hook payload without jq, and never throws on a bad one', async () => {
    const stream = (text: string) => (async function* () { yield Buffer.from(text); })();
    expect(await readHookPayload(stream('{"tool_input":{"file_path":"x"}}')))
      .toEqual({ tool_input: { file_path: 'x' } });
    expect(await readHookPayload(stream('not json at all'))).toEqual({});
    expect(await readHookPayload(stream(''))).toEqual({});
    expect(await readHookPayload(stream('[1,2,3]'))).toEqual([1, 2, 3]);
  });
});
