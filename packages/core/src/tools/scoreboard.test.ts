import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * THE SCOREBOARD'S OWN COMMENT PROMISED THIS FILE AND IT DID NOT EXIST.
 *
 * `tally` in `tools/scoreboard.mjs` carries "Exported so `scoreboard.test.ts`
 * can hand it commits whose verdicts it controls", and nothing by that name
 * was ever written — the export was reachable by nobody, which is invariant
 * 11 applied to a tool rather than to the engine. It is written now because
 * the shard matrix gave it something to check.
 *
 * `npm run scoreboard` answers "red rate on `main`, and which job went red".
 * The second half of that stopped being answerable the moment `check.yml`
 * became a four-way test shard and a two-lane gates matrix, because GitHub
 * names a matrix job after its matrix value and the verdict ref records the
 * names verbatim.
 */
const REPO = join(import.meta.dirname, '../../../..');
const TOOL = join(REPO, 'tools/scoreboard.mjs');

/**
 * ── THE ARGUMENT GOES IN A FILE, AND WINDOWS IS WHY ───────────────────────
 *
 * This passed the argument as argv, which is fine until the argument is a
 * whole workflow. Windows caps a command line at 32,767 characters and
 * answers `spawnSync … ENAMETOOLONG` past it; Linux's limit is megabytes, so
 * the test passed on every machine anybody ran it on and failed on the one
 * runner that exists to catch exactly this. `check.yml` crossing the line was
 * not even a change to this test — it was a job being added to the workflow.
 *
 * AGENTS.md: all four combinations of Windows/Linux and Claude/Codex are
 * first-class, and the way this repository fails is silence. This one at
 * least shouted, on the runner that was put there for it.
 *
 * A temp file has no size limit worth knowing about, so the fix is not a
 * bigger budget — it is removing the budget from the design. Everything else
 * about the harness is unchanged: the tool still runs as a REAL node process
 * against the real `.mjs`, which is the property these tests exist for.
 */
const runTool = <T>(name: string, argument: unknown): T => {
  const dir = mkdtempSync(join(tmpdir(), 'ed-scoreboard-'));
  const argFile = join(dir, 'arg.json');
  try {
    writeFileSync(argFile, JSON.stringify(argument ?? null));
    return JSON.parse(execFileSync(
      process.execPath,
      ['--input-type=module', '--eval',
        'const [url, name, argFile] = process.argv.slice(2);'
        + " const { readFileSync } = await import('node:fs');"
        + ' const mod = await import(url);'
        + " process.stdout.write(JSON.stringify(mod[name](JSON.parse(readFileSync(argFile, 'utf8')))));",
        'tool-test', pathToFileURL(TOOL).href, name, argFile],
      { encoding: 'utf8' },
    ));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

type Verdict = {
  conclusion: string;
  branch?: string | null;
  jobs: { name: string; result: string }[];
};

type Tally = {
  total: number; green: number; red: number; pending: number; cancelled: number; covered: number;
  offTrunk: number; unjudged: number;
  byJob: Record<string, number>;
  advisoryJob: Record<string, number>;
  offTrunkBy: Record<string, number>;
};

type Scoreboard = {
  jobFamily: (name: string) => string;
  tally: (rows: { verdict: Verdict | null }[]) => Tally;
  advisoryJobs: (workflow: string | null) => string[];
};

const scoreboard: Scoreboard = {
  jobFamily: (name: string) => runTool<string>('jobFamily', name),
  // `tally` takes options as a second argument and the harness passes one, so
  // every call here exercises the DEFAULTS — which is what `npm run scoreboard`
  // itself is closest to, and the shape a mistake would actually ship in.
  tally: (rows) => runTool<Tally>('tally', rows),
  advisoryJobs: (workflow) => runTool<string[]>('advisoryJobs', workflow),
};

/** A verdict from a run on trunk. */
const onMain = (conclusion: string, jobs: Verdict['jobs'] = []) =>
  ({ verdict: { conclusion, branch: 'main', jobs } });

/** The same, from the branch the commit was written on. */
const onBranch = (conclusion: string, jobs: Verdict['jobs'] = []) =>
  ({ verdict: { conclusion, branch: 'codex/issue-61-channel', jobs } });

describe('a matrix job is counted under the job it is part of', () => {
  it('folds the test shards together', () => {
    expect(scoreboard.jobFamily('test 1/4')).toBe('test');
    expect(scoreboard.jobFamily('test 4/4')).toBe('test');
  });

  it('folds the gate lanes together', () => {
    expect(scoreboard.jobFamily('gates (batch)')).toBe('gates');
    expect(scoreboard.jobFamily('gates (war)')).toBe('gates');
  });

  it('leaves a job that is not in a matrix exactly as it is', () => {
    // The other direction, so the rule above is not passing on a function that
    // trims something off everything it is handed. This is a real job name.
    expect(scoreboard.jobFamily('typecheck + validate')).toBe('typecheck + validate');
  });

  /**
   * THE BUG THIS ACTUALLY PREVENTS, and it is not cosmetic.
   *
   * Vitest shards by a hash of the file PATH, so which shard a suite lands in
   * moves whenever a test file is added anywhere in the repository. Counted
   * raw, one suite failing twice in a fortnight reads as two different jobs
   * failing once each — a fact about a hash, reported as a fact about the
   * build.
   */
  it('counts one suite failing in two different shards as two reds in test', () => {
    // `branch: main` because a red is now something TRUNK said — see the
    // suite below. The claim here is still only about folding shard numbers.
    const red = (job: string) => onMain('failure', [
      { name: job, result: 'failure' },
      { name: 'typecheck + validate', result: 'success' },
    ]);
    const t = scoreboard.tally([red('test 2/4'), red('test 4/4')]);
    expect(t.red).toBe(2);
    expect(t.byJob).toEqual({ test: 2 });
  });

  it('still reports a window with no verdicts as unjudged, not as a clean sheet', () => {
    // The case the original comment named, and the reason `tally` was exported
    // in the first place. An absence is not a pass — see `tools/verdict.mjs`.
    const t = scoreboard.tally([{ verdict: null }, { verdict: null }]);
    expect(t.unjudged).toBe(2);
    expect(t.green).toBe(0);
    expect(t.red).toBe(0);
  });
});

/**
 * ── THE SCOREBOARD REPORTED A 4-FOR-4 GREEN TRUNK AS 84.8% RED ────────────
 *
 * Issue #145. Three defects, one comparison each, and the number they produced
 * is the one a human reads before deciding whether `main` is safe to build on.
 * It was wrong by the full width of its range, and it is what makes a
 * reasonable person propose turning tests off.
 *
 * Every case below is a real row out of the last 40 commits of `main`, not a
 * constructed edge: 24 cancelled feature-branch runs, 4 more that were green
 * on a branch and never judged on trunk, and an `Android AAB = skipped` on
 * every one of them because the job is tag-gated.
 */
describe('a verdict says what CI decided, and where it decided it', () => {
  it('does not count a cancelled feature-branch run as a red on trunk', () => {
    // 24 of the 28 "reds" were this: `cancel-in-progress` superseding a run
    // when the next push arrived, 30 seconds in. It answered no question.
    const t = scoreboard.tally([onBranch('cancelled')]);
    expect(t.red).toBe(0);
    expect(t.green).toBe(0);
    expect(t.offTrunk).toBe(1);
  });

  it('does not count a green feature-branch run as a trunk pass either', () => {
    // The other direction, so the rule above is not just "branch means fine".
    // A commit that has only ever been judged mid-branch has not been judged
    // on `main`, and saying so is the same discipline as `unjudged`.
    const t = scoreboard.tally([onBranch('success')]);
    expect(t.green).toBe(0);
    expect(t.red).toBe(0);
    expect(t.offTrunk).toBe(1);
    expect(t.offTrunkBy).toEqual({ success: 1 });
  });

  it('counts a cancelled run ON TRUNK as cancelled, not as red and not as green', () => {
    const t = scoreboard.tally([onMain('cancelled')]);
    expect(t.cancelled).toBe(1);
    expect(t.red).toBe(0);
    expect(t.green).toBe(0);
  });

  it('counts a failure on trunk as red, and that is the only thing that is', () => {
    const t = scoreboard.tally([
      onMain('failure'),
      onMain('success'),
      onMain('cancelled'),
      onBranch('failure'),
      { verdict: null },
    ]);
    expect(t.red).toBe(1);
    expect(t.green).toBe(1);
    expect(t.cancelled).toBe(1);
    expect(t.offTrunk).toBe(1);
    expect(t.unjudged).toBe(1);
  });

  it('refuses to call a verdict trunk\'s when the ref does not say which branch', () => {
    // Older refs, and any future shape this parser cannot read. The tool's job
    // is to refuse to report a number it cannot support, so an unattributable
    // verdict is off-trunk rather than quietly counted as `main`.
    const t = scoreboard.tally([{ verdict: { conclusion: 'failure', jobs: [] } }]);
    expect(t.red).toBe(0);
    expect(t.offTrunk).toBe(1);
    expect(t.offTrunkBy).toEqual({ 'failure (branch unrecorded)': 1 });
  });
});

describe('which job went red names jobs that actually ran', () => {
  it('leaves a skipped job out of byJob entirely', () => {
    // `Android AAB` is `if: startsWith(github.ref, 'refs/tags/')` and records
    // `skipped` on every normal commit. Counted as a failure it became the
    // second-largest entry in "which job went red" — a job that has never run.
    const t = scoreboard.tally([onMain('failure', [
      { name: 'test 2/4', result: 'failure' },
      { name: 'Android AAB', result: 'skipped' },
    ])]);
    expect(t.byJob).toEqual({ test: 1 });
    expect(Object.keys(t.byJob)).not.toContain('Android AAB');
  });

  it('leaves a cancelled sibling job out too', () => {
    const t = scoreboard.tally([onMain('failure', [
      { name: 'gates (war)', result: 'failure' },
      { name: 'gates (batch)', result: 'cancelled' },
    ])]);
    expect(t.byJob).toEqual({ gates: 1 });
  });

  it('segregates an advisory job rather than blaming it for the build', () => {
    // `warm run corpus` carries `continue-on-error: true` and `land.mjs` lists
    // `corpus` in ADVISORY. A red there is a slower next build, never a broken
    // one, so it must not sit beside the job that actually broke trunk.
    const t = scoreboard.tally([onMain('failure', [
      { name: 'test 1/4', result: 'failure' },
      { name: 'warm run corpus', result: 'failure' },
    ])]);
    expect(t.byJob).toEqual({ test: 1 });
    expect(t.advisoryJob).toEqual({ 'warm run corpus': 1 });
  });

  it('reads the advisory jobs off the workflow rather than off a list here', () => {
    // Derived, for the reason `ciScripts` in `tools/land.mjs` is derived: a
    // second `continue-on-error` job would otherwise be counted as a real
    // failure until somebody remembered a constant existed.
    const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(scoreboard.advisoryJobs(workflow)).toContain('warm run corpus');
    // And it does not sweep in a job that can fail the build.
    expect(scoreboard.advisoryJobs(workflow)).not.toContain('test');
    expect(scoreboard.advisoryJobs(workflow)).not.toContain('gates');
  });

  it('finds a second advisory job without being told about it', () => {
    const invented = [
      'jobs:',
      '  lint:',
      '    name: typecheck + validate',
      '    runs-on: ubuntu-latest',
      '  weather:',
      '    name: ask the sky',
      '    runs-on: ubuntu-latest',
      '    continue-on-error: true',
      '',
    ].join('\n');
    expect(scoreboard.advisoryJobs(invented)).toEqual(['ask the sky']);
  });

  it('does not make a required job advisory when only one step continues on error', () => {
    const invented = [
      'jobs:',
      '  gates:',
      '    name: gates (batch)',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: optional proof artifact',
      '        continue-on-error: true',
      '        run: node optional-proof.mjs',
      '',
    ].join('\n');
    expect(scoreboard.advisoryJobs(invented)).not.toContain('gates');
  });
});

/**
 * THE CLI IS THE INSTRUMENT, NOT JUST ITS PURE HELPERS — issue #116 Stage 3.
 *
 * The unit cases above can prove `tally` and `redRate` in isolation while
 * `npm run scoreboard` itself quietly stops fetching the verdict namespace,
 * reads the wrong branch, or formats a different denominator. Stage 3 asks for
 * the same shape as the land/verdict tests: a real repository with refs the
 * tool must discover for itself.
 */
describe('the scoreboard CLI over real verdict refs', () => {
  const gitAt = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  it('prints the four verdict counts and red rate from fixture refs', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-scoreboard-cli-'));
    try {
      const bare = join(root, 'origin.git');
      const writer = join(root, 'writer');
      const reader = join(root, 'reader');

      gitAt(root, 'init', '-q', '--bare', 'origin.git');
      gitAt(root, 'init', '-q', 'writer');
      gitAt(writer, 'config', 'user.email', 'scoreboard@example.com');
      gitAt(writer, 'config', 'user.name', 'scoreboard');

      const specs = [
        { subject: 'green', conclusion: 'success', jobs: ['job: typecheck + validate = success'] },
        { subject: 'red', conclusion: 'failure', jobs: ['job: gates (war) = failure'] },
        { subject: 'pending', conclusion: 'pending', jobs: ['job: (not started)'] },
        { subject: 'cancelled', conclusion: 'cancelled', jobs: ['job: test 1/4 = cancelled'] },
      ] as const;

      const shas: string[] = [];
      for (const spec of specs) {
        gitAt(writer, 'commit', '-q', '--allow-empty', '-m', spec.subject);
        shas.push(gitAt(writer, 'rev-parse', 'HEAD'));
      }
      gitAt(writer, 'branch', '-M', 'main');
      gitAt(writer, 'remote', 'add', 'origin', bare);
      gitAt(writer, 'push', '-q', 'origin', 'main');

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        const sha = shas[i]!;
        const message = [
          `verdict ${spec.conclusion}`,
          '',
          `sha: ${sha}`,
          'branch: main',
          `conclusion: ${spec.conclusion}`,
          ...spec.jobs,
          '',
        ].join('\n');
        const verdict = gitAt(writer, 'commit-tree', EMPTY_TREE, '-m', message);
        gitAt(writer, 'push', '-q', 'origin', `${verdict}:refs/verdict/${sha}`);
      }

      gitAt(root, 'clone', '-q', '--branch', 'main', bare, 'reader');
      const out = execFileSync(process.execPath, [TOOL, '4'], {
        cwd: reader,
        encoding: 'utf8',
      });

      expect(out).toMatch(/^\s*green\s+1\s*$/m);
      expect(out).toMatch(/^\s*red\s+1\s*$/m);
      expect(out).toMatch(/^\s*pending\s+1\s*$/m);
      expect(out).toMatch(/^\s*cancelled\s+1\s+superseded before it could answer\s*$/m);
      expect(out).toMatch(/^\s*red rate\s+50\.0%\s+over the 2 commit\(s\) main judged\s*$/m);
      expect(out).toMatch(/^\s*gates\s+1\s*$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives covered commits from one exact landing range without fabricating verdict refs', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-scoreboard-landing-'));
    try {
      const bare = join(root, 'origin.git');
      const writer = join(root, 'writer');
      const reader = join(root, 'reader');

      gitAt(root, 'init', '-q', '--bare', 'origin.git');
      gitAt(root, 'init', '-q', 'writer');
      gitAt(writer, 'config', 'user.email', 'scoreboard@example.com');
      gitAt(writer, 'config', 'user.name', 'scoreboard');

      const commit = (subject: string) => {
        gitAt(writer, 'commit', '-q', '--allow-empty', '-m', subject);
        return gitAt(writer, 'rev-parse', 'HEAD');
      };
      const base = commit('previous judged main head');
      const first = commit('first commit in queued landing');
      const second = commit('second commit in queued landing');
      const head = commit('exact checked and pushed head');

      gitAt(writer, 'branch', '-M', 'main');
      gitAt(writer, 'remote', 'add', 'origin', bare);
      gitAt(writer, 'push', '-q', 'origin', 'main');

      const verdictRef = (sha: string, conclusion: string, branch = 'main') => {
        const message = [
          `verdict ${conclusion}`,
          '',
          `sha: ${sha}`,
          `branch: ${branch}`,
          `conclusion: ${conclusion}`,
          'job: test = success',
          '',
        ].join('\n');
        const verdict = gitAt(writer, 'commit-tree', EMPTY_TREE, '-m', message);
        gitAt(writer, 'push', '-q', 'origin', `${verdict}:refs/verdict/${sha}`);
      };

      // Only the exact checked head was independently judged. With no older
      // judged boundary, historical repair cannot explain this range; the
      // durable landing record below is the only evidence for its members.
      verdictRef(head, 'success');
      // Neither weaker kind of evidence may hide the later checked range:
      // an off-trunk verdict says nothing about main, and a cancelled main run
      // answered nothing at all.
      verdictRef(first, 'failure', 'chatgpt/work');
      verdictRef(second, 'cancelled', 'main');

      const landingMessage = [
        'landing coverage',
        '',
        `before: ${base}`,
        `checked: ${head}`,
        `pushed: ${head}`,
        'branch: chatgpt/work',
        'verdict: success',
        `verdict_ref: refs/verdict/${head}`,
        'run: https://github.com/o/r/actions/runs/42',
        'recorded: 2026-10-01T07:00:00Z',
        '',
      ].join('\n');
      const landing = gitAt(writer, 'commit-tree', EMPTY_TREE, '-m', landingMessage);
      gitAt(writer, 'push', '-q', 'origin', `${landing}:refs/landing/${head}`);

      gitAt(root, 'clone', '-q', '--branch', 'main', bare, 'reader');
      const out = execFileSync(process.execPath, [TOOL, '3'], {
        cwd: reader,
        encoding: 'utf8',
      });

      expect(out).toMatch(/^\s*green\s+1\s*$/m);
      expect(out).toMatch(/^\s*covered\s+2\s+included in a separately judged main head\s*$/m);
      expect(out).toMatch(/^\s*off-trunk\s+0\s+only ever judged on the branch it was written on\s*$/m);
      expect(out).toMatch(/^\s*unjudged\s+0\s+no verdict or landing coverage — see below\s*$/m);
      expect(out).toMatch(/^\s*red rate\s+0\.0%\s+over the 1 commit\(s\) main judged\s*$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not trust a synthetic covered ref when no current range proves it', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-scoreboard-unproved-covered-'));
    try {
      const bare = join(root, 'origin.git');
      const writer = join(root, 'writer');
      const reader = join(root, 'reader');

      gitAt(root, 'init', '-q', '--bare', 'origin.git');
      gitAt(root, 'init', '-q', 'writer');
      gitAt(writer, 'config', 'user.email', 'scoreboard@example.com');
      gitAt(writer, 'config', 'user.name', 'scoreboard');

      gitAt(writer, 'commit', '-q', '--allow-empty', '-m', 'synthetically covered long ago');
      const synthetic = gitAt(writer, 'rev-parse', 'HEAD');
      gitAt(writer, 'commit', '-q', '--allow-empty', '-m', 'unexplained boundary');
      gitAt(writer, 'commit', '-q', '--allow-empty', '-m', 'only independently judged head');
      const head = gitAt(writer, 'rev-parse', 'HEAD');

      gitAt(writer, 'branch', '-M', 'main');
      gitAt(writer, 'remote', 'add', 'origin', bare);
      gitAt(writer, 'push', '-q', 'origin', 'main');

      const verdictRef = (sha: string, conclusion: string) => {
        const message = [
          `verdict ${conclusion}`,
          '',
          `sha: ${sha}`,
          'branch: main',
          `conclusion: ${conclusion}`,
          ...(conclusion === 'covered' ? [`covered-by: ${head}`] : ['job: test = success']),
          '',
        ].join('\n');
        const verdict = gitAt(writer, 'commit-tree', EMPTY_TREE, '-m', message);
        gitAt(writer, 'push', '-q', 'origin', `${verdict}:refs/verdict/${sha}`);
      };
      verdictRef(synthetic, 'covered');
      verdictRef(head, 'success');

      // There is only one independently judged main head, so historical repair
      // has no adjacent judged boundary and there is no durable landing record.
      // The old synthetic ref must therefore not make history look explained.
      gitAt(root, 'clone', '-q', '--branch', 'main', bare, 'reader');
      const out = execFileSync(process.execPath, [TOOL, '3'], {
        cwd: reader,
        encoding: 'utf8',
      });

      expect(out).toMatch(/^\s*green\s+1\s*$/m);
      expect(out).toMatch(/^\s*covered\s+0\s+included in a separately judged main head\s*$/m);
      expect(out).toMatch(/^\s*unjudged\s+2\s+no verdict or landing coverage — see below\s*$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reconstructs old tip-only batches only between independently judged main heads', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-scoreboard-history-'));
    try {
      const bare = join(root, 'origin.git');
      const writer = join(root, 'writer');
      const reader = join(root, 'reader');

      gitAt(root, 'init', '-q', '--bare', 'origin.git');
      gitAt(root, 'init', '-q', 'writer');
      gitAt(writer, 'config', 'user.email', 'scoreboard@example.com');
      gitAt(writer, 'config', 'user.name', 'scoreboard');

      const commit = (subject: string) => {
        gitAt(writer, 'commit', '-q', '--allow-empty', '-m', subject);
        return gitAt(writer, 'rev-parse', 'HEAD');
      };
      const base = commit('older judged batch tip');
      const first = commit('old batch member one');
      const second = commit('old batch member two');
      const head = commit('newer judged batch tip');

      gitAt(writer, 'branch', '-M', 'main');
      gitAt(writer, 'remote', 'add', 'origin', bare);
      gitAt(writer, 'push', '-q', 'origin', 'main');

      const verdictRef = (sha: string) => {
        const message = [
          'verdict success',
          '',
          `sha: ${sha}`,
          'branch: main',
          'conclusion: success',
          'job: test = success',
          '',
        ].join('\n');
        const verdict = gitAt(writer, 'commit-tree', EMPTY_TREE, '-m', message);
        gitAt(writer, 'push', '-q', 'origin', `${verdict}:refs/verdict/${sha}`);
      };
      verdictRef(base);
      verdictRef(head);

      gitAt(root, 'clone', '-q', '--branch', 'main', bare, 'reader');
      const out = execFileSync(process.execPath, [TOOL, '4'], {
        cwd: reader,
        encoding: 'utf8',
      });

      expect(out).toMatch(/^\s*green\s+2\s*$/m);
      expect(out).toMatch(/^\s*covered\s+2\s+included in a separately judged main head\s*$/m);
      expect(out).toMatch(/^\s*unjudged\s+0\s+no verdict or landing coverage — see below\s*$/m);
      expect(out).toMatch(/^\s*red rate\s+0\.0%\s+over the 2 commit\(s\) main judged\s*$/m);
      expect(first).not.toBe(second);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});

