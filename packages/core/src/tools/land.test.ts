import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * THE QUEUE RUNS WHAT CI RUNS, AND THE SET IS DERIVED RATHER THAN REMEMBERED.
 *
 * AGENTS.md used to grant standing authorisation to fast-forward `main` with
 * no pull request as soon as `npm run check` was green. `check` is
 * `typecheck && validate && test`. CI runs the gates too — measured runs that
 * `check` has never touched, and which were nine minutes when this was
 * written and are better than half an hour now (see `check.yml`'s own
 * re-measured block, and note that the figure in this sentence went stale
 * the same way the ones it replaced did).
 *
 * THE JOB COUNT IS DELIBERATELY NOT STATED HERE ANY MORE. It was "three",
 * and three was true until the test job became a four-way shard matrix and
 * the gates became two lanes. `ciScripts` never counted jobs — it reads npm
 * invocations — so the derivation kept working and only the prose was wrong,
 * which is the cheaper half of this file being right.
 *
 * Four of the eleven red runs of `check.yml` on `main` across runs 61-100
 * failed at exactly that step. Runs 64 and 65 are the clearest: typecheck,
 * validate and the whole test suite green, forty-one minutes of it, then
 * `gates` red. Both agents did what the rulebook said and broke trunk anyway.
 *
 * Native merge-group CI is now the authoritative integration check. This test
 * keeps the optional full local preflight aligned with CI, so it cannot silently
 * omit a newly-added npm-backed check. check.yml already makes this argument
 * about its own gate list:
 *
 *   "The gates are not split by name, deliberately. `npm run gate` runs
 *    whatever is in `GATES`, so a new gate is in CI the moment it exists rather
 *    than the moment somebody remembers this file — gate 2 was written for CI
 *    and wired into nothing for its whole life under the old hand-kept list."
 *
 * A landing command that names its own steps has that failure mode one level
 * up, and it is worse there: a forgotten gate costs a red build, a forgotten
 * JOB costs a red `main` that the agent responsible has already stopped
 * watching.
 */

const REPO = join(import.meta.dirname, '../../../..');
const TOOL = join(REPO, 'tools/land.mjs');
const WORKFLOW = join(REPO, '.github/workflows/check.yml');

const land = (await import(pathToFileURL(TOOL).href)) as {
  STEPS: string[];
  SESSION_PREFLIGHT_STEPS: string[];
  ADVISORY: string[];
  CONCURRENT: string[];
  npmInvocation: (
    platform?: NodeJS.Platform,
    node?: string,
    cli?: string,
  ) => { command: string; prefix: string[] };
  nodeModulesLinkType: (platform?: NodeJS.Platform) => 'junction' | 'dir';
  landPhases: (steps?: string[]) => { alone: string[]; together: string[] };
  verificationPlan: (args: { fullPreflight: boolean }) => {
    steps: string[];
    kind: 'fast' | 'full';
    reason: string;
  };
  start: (cmd: string, args: string[], cwd: string | undefined, o: { live: boolean })
    => Promise<{ ok: boolean; out: string }>;
  ciScripts: (workflow: string) => Set<string>;
  issueLeftOpen: (branch: string, commitLog: string, held?: string[]) => string | null;
  negatedCommitMessageError: (commitLog: string) => string | null;
  deathReading: (dead: { pid: number; started: string; step?: string; target?: string }) => string[];
  ourShed: (tree: unknown, tmp?: string) => boolean;
  finishLanding: (args: {
    target: string;
    branch: string;
  }) => { ok: boolean; state: 'preflight-green'; message: string };
};

const workflow = readFileSync(WORKFLOW, 'utf8');

describe('the queued landing runs every check CI runs', () => {
  it('leaves no script CI runs out of the landing', () => {
    const covered = new Set([...land.STEPS, ...land.ADVISORY]);
    const missed = [...land.ciScripts(workflow)].filter((s) => !covered.has(s));
    expect(
      missed,
      `check.yml runs ${missed.join(', ')}, and the queued \`npm run land\` does not.\n` +
      `Add it to STEPS in tools/land.mjs — or to ADVISORY, if it provably cannot\n` +
      `fail a build, with the reason beside it. An agent's licence to push to\n` +
      `main is that authoritative queue check being green.`,
    ).toEqual([]);
  });

  it('claims no step CI does not actually run', () => {
    const ci = land.ciScripts(workflow);
    const invented = land.STEPS.filter((s) => !ci.has(s));
    expect(
      invented,
      `tools/land.mjs runs ${invented.join(', ')}, which check.yml does not. Either\n` +
      `CI dropped a job and the landing is now stricter than the build, or the\n` +
      `step name is wrong and the landing has been failing on a typo.`,
    ).toEqual([]);
  });

  /**
   * THE WORKFLOW IT MUST REJECT.
   *
   * A rule nobody has watched fail is indistinguishable from a rule that cannot
   * fail, which is why every gate in this repo is a function over its input
   * rather than a script — `gates.test.ts` hands each one content it must
   * refuse. This does the same with a fourth job, because that is the shape of
   * the change that will actually happen: somebody adds a job, `land` does not
   * grow a step, and nothing anywhere says so.
   */
  it('catches a job added to CI that the landing does not run', () => {
    const fourth = `${workflow}
  smoke:
    name: smoke
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run smoke
`;
    const covered = new Set([...land.STEPS, ...land.ADVISORY]);
    const missed = [...land.ciScripts(fourth)].filter((s) => !covered.has(s));
    expect(missed, 'a fourth CI job went unnoticed by the derivation').toEqual(['smoke']);
  });

  it('reads a job the workflow does not have as no job at all', () => {
    // The other direction, so the test above is not passing on a parser that
    // simply reports everything. `npm ci` is environment and never a check.
    const bare = 'jobs:\n  lint:\n    steps:\n      - run: npm ci\n';
    expect([...land.ciScripts(bare)]).toEqual([]);
  });

  /**
   * ── THE TIER IS VISIBLE TO THE DERIVATION, NOT HIDDEN BEHIND IT ───────────
   *
   * Issue #144 tiered this workflow: the expensive jobs now carry
   * `if: needs.tier.outputs.full == 'true'` so a draft branch gets typecheck,
   * validate and the fast lane instead of the whole nine-job set. That is the
   * shape of change this derivation has to survive, and the way it could have
   * failed is precise — a reader that understood YAML would see a CONDITIONAL
   * job and have to decide whether a job that might not run is a job the
   * landing must cover. It would decide wrong eventually, and `gates` would
   * quietly stop being part of what an agent runs before pushing to trunk.
   *
   * `ciScripts` is naive about YAML on purpose and cannot see an `if:` at all,
   * which is not a limitation here but the property: a gated job reads exactly
   * like an ungated one, so a tier can never subtract from the landing's step
   * set. The test below is that stated as a fact rather than left as a
   * consequence — it feeds the reader a job behind the real condition and
   * demands the script still come back.
   */
  it('still derives a step from a job the tier can skip', () => {
    const gated = `jobs:
  gates:
    name: gates
    needs: tier
    if: needs.tier.outputs.full == 'true'
    steps:
      - run: npm ci
      - run: npm run gates -- --lane batch
`;
    expect([...land.ciScripts(gated)]).toEqual(['gates']);
  });

  /**
   * AND THE TIERING ADDED NO JOB THE LANDING DOES NOT RUN.
   *
   * The live workflow, not an invented one. The short tier is `lint` plus
   * `fast lane`, and the fast lane is `test:fast` — already declared a SUBSET
   * of `test` in `COVERED`, which is why it does not need a step of its own.
   * If that declaration ever stops being true, this and the completeness test
   * above fail together.
   */
  it('covers every script the short tier runs', () => {
    const covered = new Set([...land.STEPS, ...land.ADVISORY]);
    for (const script of ['typecheck', 'validate']) {
      expect(land.ciScripts(workflow).has(script) || covered.has(script)).toBe(true);
    }
    // `test:fast` is absorbed by `COVERED`, so it must NOT surface as an
    // uncovered step — and must not have been dropped from the workflow either.
    expect(workflow).toContain('npm run test:fast');
    expect([...land.ciScripts(workflow)].filter((s) => !covered.has(s))).toEqual([]);
  });
});

/**
 * A BRANCH NAMED FOR AN ISSUE THAT LANDS WITHOUT CLOSING IT.
 *
 * `claude/issue-106-grlfdh` landed clean, CI went green, and #106 stayed
 * open — the commit's title carried `(#106)`, which GitHub does not read,
 * and no commit said `Closes #106`, which it does. The convention was
 * already correct in AGENTS.md and docs/PARALLEL.md; the session read
 * CLAUDE.md and went straight to `npm run land` without finding the
 * sentence. A rule that only lives in prose is a rule a landing can run
 * clean past, so this is the same argument `ciScripts` makes about a CI job
 * nobody remembered to add to the landing, one layer up: the check has to be
 * IN the command, not near it.
 */
/**
 * ── THE TWO LONG STEPS RUN AT ONCE, AND NOTHING FALLS BETWEEN THEM ────────
 *
 * `npm test` takes a worker per core; `npm run gates` is one node process
 * walking the gate table in a serial loop, so it held one core for thirty-six
 * minutes while three sat idle waiting for it. Sequentially the landing was
 * about 76 minutes of clock for about 196 core-minutes of work; overlapped,
 * that packs into roughly 49.
 *
 * The split is a FUNCTION over the step list rather than two hand-kept
 * arrays, for the reason `ciScripts` is a function over the workflow: two
 * lists drift, and the way this one would drift is silent. A step in neither
 * phase is a check the landing stopped running while still reporting green,
 * which is the same failure as a CI job the landing never learned about — the
 * thing this file already exists to prevent, one level in.
 */
describe('the landing runs its long steps together', () => {
  it('splits every step into exactly one phase', () => {
    const { alone, together } = land.landPhases();
    expect(
      [...alone, ...together].sort(),
      'a step is in neither phase, so the landing no longer runs it',
    ).toEqual([...land.STEPS].sort());
    expect(
      alone.filter((s) => together.includes(s)),
      'a step is in both phases and would be run twice',
    ).toEqual([]);
  });

  it('puts the cheap checks alone and the expensive pair together', () => {
    const { alone, together } = land.landPhases();
    expect(alone).toEqual(['typecheck', 'validate', 'build:client']);
    expect(together).toEqual(['test', 'gates']);
  });

  /**
   * THE RENAME, which is how this actually goes wrong.
   *
   * `STEPS` carried `gate` until the gates job became two lanes and it became
   * `gates` — `land.test.ts` caught that one because CI and the landing
   * disagreed. Nothing would catch the same rename here: an unmatched name in
   * `CONCURRENT` simply stops overlapping, the landing silently returns to
   * seventy-six minutes, and every build stays green.
   */
  it('names only steps that exist, so a rename cannot quietly unparallelise it', () => {
    const strays = land.CONCURRENT.filter((s) => !land.STEPS.includes(s));
    expect(
      strays,
      `CONCURRENT names ${strays.join(', ')}, which STEPS does not. The landing\n`
      + 'would run everything one at a time again and say nothing about it.',
    ).toEqual([]);
  });

  it('keeps the phases in STEPS order', () => {
    // The landing runs `alone` and then `together`, so within a phase the
    // order still has to be the one the step list asks for.
    const { alone, together } = land.landPhases(['validate', 'gates', 'typecheck', 'test']);
    expect(alone).toEqual(['validate', 'typecheck']);
    expect(together).toEqual(['gates', 'test']);
  });

  it('reads a step list with nothing long in it as nothing to overlap', () => {
    // The other direction, so the partition test is not passing on a function
    // that puts everything in one bucket whatever it is handed.
    const { alone, together } = land.landPhases(['typecheck', 'validate']);
    expect(alone).toEqual(['typecheck', 'validate']);
    expect(together).toEqual([]);
  });
});

describe('local landing preflight tiers', () => {
  it('runs the fast tier by default', () => {
    const plan = land.verificationPlan({ fullPreflight: false });
    expect(plan.kind).toBe('fast');
    expect(plan.steps).toEqual(['typecheck', 'validate', 'test:fast']);
    expect(plan.steps).toEqual(land.SESSION_PREFLIGHT_STEPS);
    expect(plan.reason).toContain('native merge-group CI');
  });

  it('offers the complete local set only through --full-preflight', () => {
    const plan = land.verificationPlan({ fullPreflight: true });
    expect(plan.kind).toBe('full');
    expect(plan.steps).toEqual(land.STEPS);
    expect(readFileSync(TOOL, 'utf8')).toContain("process.argv.includes('--full-preflight')");
  });

  it('has no hidden direct-main landing mode', () => {
    const source = readFileSync(TOOL, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).not.toContain('FROM_QUEUE');
    expect(source).not.toContain('--from-queue');
    expect(source).not.toContain('LAND_DEPLOY_KEY');
    expect(source).not.toMatch(/run\('git',\s*\['push'[^\]]*:main/);
  });

  it('hands a green preflight to the native merge queue without a push callback', () => {
    const result = land.finishLanding({
      target: '0123456789abcdef',
      branch: 'feature',
    });
    expect(result).toMatchObject({ ok: true, state: 'preflight-green' });
    expect(result.message).toContain('Merge when ready');
    expect(result.message).toContain('native merge queue');
  });

  it('uses that plan for the steps the command actually executes', () => {
    const source = readFileSync(TOOL, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).toMatch(
      /const plan = verificationPlan\(\{ fullPreflight: FULL_PREFLIGHT \}\)/,
    );
    expect(source).toMatch(/landPhases\(plan\.steps\)/);
    expect(source).toMatch(/remember\('preflight-green', \{ target, branch \}\)/);
  });

  it('names only scripts package.json provides', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const step of new Set([...land.SESSION_PREFLIGHT_STEPS, ...land.STEPS])) {
      expect(pkg.scripts[step], `no \`${step}\` script`).toBeTruthy();
    }
  });
});

/**
 * THE DEADLOCK THIS WOULD HAVE HAD, WATCHED RATHER THAN REASONED ABOUT.
 *
 * The obvious way to overlap two steps is to keep `spawnSync` for one of them
 * and spawn the other. It works until the spawned one fills its 64KB stdout
 * pipe, at which point the kernel blocks it — and `spawnSync` is blocking the
 * event loop, so nothing will ever drain it. That is a landing that HANGS at
 * minute forty rather than one that fails, with no output to say why.
 *
 * `npm run gates` prints about forty lines, so this would have sat under the
 * limit and worked for a long time before some gate grew a verbose mode. Both
 * are spawned and both are drained, and this is the test that says so: a
 * captured process that writes well past the pipe limit has to finish.
 */
describe('two steps at once cannot deadlock on a full pipe', () => {
  const NODE = process.execPath;

  it('drains a captured process that writes far past the pipe buffer', async () => {
    const big = await land.start(
      NODE,
      ['-e', 'process.stdout.write("x".repeat(400000))'],
      undefined,
      { live: false },
    );
    expect(big.ok).toBe(true);
    expect(big.out.length).toBe(400000);
  }, 30_000);

  it('runs both to completion and reports each exit code separately', async () => {
    const [good, bad] = await Promise.all([
      land.start(NODE, ['-e', 'process.stdout.write("fine")'], undefined, { live: false }),
      land.start(NODE, ['-e', 'process.stderr.write("boom"); process.exit(3)'], undefined, { live: false }),
    ]);
    expect(good.ok).toBe(true);
    expect(good.out).toBe('fine');
    // The failing one is still READ, because a landing has to print why.
    expect(bad.ok).toBe(false);
    expect(bad.out).toContain('boom');
  }, 30_000);

  it('resolves rather than throwing when the command does not exist', async () => {
    // A rejected promise here would take the landing down through the async
    // main with a stack trace instead of `land: … failed. Nothing was pushed.`
    const r = await land.start('definitely-not-a-command-xyz', [], undefined, { live: false });
    expect(r.ok).toBe(false);
  }, 30_000);
});

describe('the npm launcher is portable', () => {
  it('runs npm through Node on Windows instead of spawning a command shim', () => {
    expect(land.npmInvocation('win32', 'node.exe', 'npm-cli.js')).toEqual({
      command: 'node.exe',
      prefix: ['npm-cli.js'],
    });
    expect(land.npmInvocation('linux', '/usr/bin/node', '/usr/lib/npm-cli.js')).toEqual({
      command: 'npm',
      prefix: [],
    });
  });

  it('uses a privilege-free directory junction for the Windows worktree', () => {
    expect(land.nodeModulesLinkType('win32')).toBe('junction');
    expect(land.nodeModulesLinkType('linux')).toBe('dir');
  });
});

describe('negated closing keywords in branch commits', () => {
  it('rejects the historical #61 wording even when another commit has a real close', () => {
    const msg = land.negatedCommitMessageError(
      'balance(#61): widen the Apotheosis band\n\n' +
      'This does not close #61. The issue remains open.\n\n' +
      'follow-up safety work\n\nCloses #332',
    );

    expect(msg).not.toBeNull();
    expect(msg).toContain('#61');
    expect(msg).toContain('Refs #61');
    expect(msg).not.toContain('#332:');
  });

  it('accepts ordinary references and positive closes', () => {
    expect(
      land.negatedCommitMessageError('Refs #61\n\nPart of #332\n\nCloses #319'),
    ).toBeNull();
  });

  it('runs after an authoritative fetch and before the expensive landing work', () => {
    const source = readFileSync(TOOL, 'utf8');
    const fetchAt = source.indexOf("if (!run('git', ['fetch', 'origin', 'main']))");
    const guardAt = source.indexOf('negatedCommitMessageError(ownCommitMessages())', fetchAt);
    const rebaseAt = source.indexOf("mark('rebase')", fetchAt);

    expect(fetchAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(fetchAt);
    expect(rebaseAt).toBeGreaterThan(guardAt);
    expect(
      source.slice(fetchAt, rebaseAt),
      '--no-issue-check must not bypass the commit-message safety guard',
    ).not.toContain('NO_ISSUE_CHECK');
  });
});

describe('a branch named for an issue is refused if nothing closes it', () => {
  it('says nothing about a branch that does not name an issue', () => {
    expect(land.issueLeftOpen('claude/some-feature-abcxyz', 'did a thing, no issue involved')).toBeNull();
  });

  it('catches the actual bug: a title reference is not a closing keyword', () => {
    const msg = land.issueLeftOpen('claude/issue-106-grlfdh', 'Phase 14 layout: one client, 390px to ultrawide (#106)\n\nsome body text');
    expect(msg, '"(#106)" in a title read as though it closed the issue').not.toBeNull();
    expect(msg).toContain('#106');
  });

  it.each(['Closes #106', 'closes #106', 'Fixes #106', 'fixed #106', 'Resolves #106'])(
    'accepts %s as a real closing keyword',
    (line) => {
      expect(land.issueLeftOpen('claude/issue-106-grlfdh', `Some commit\n\n${line}`)).toBeNull();
    },
  );

  it('rejects a negated closing keyword as landing evidence', () => {
    const msg = land.issueLeftOpen(
      'claude/issue-110-x',
      'Follow-up work\\n\\nThis does **not** close #110',
    );
    expect(msg, 'a negated close was accepted as if the issue were meant to close').not.toBeNull();
    expect(msg).toContain('#110');
  });

  it('requires the keyword before EACH number, matching GitHub and janitor.mjs', () => {
    // "Closes #106, #107" closes only #106 on GitHub — janitor.mjs reads it the
    // same way on purpose, so what this refuses and what GitHub actually did
    // never diverge.
    expect(land.issueLeftOpen('claude/issue-107-x', 'Closes #106, #107'), 'a bare second number was read as closed').not.toBeNull();
    expect(land.issueLeftOpen('claude/issue-107-x', 'Closes #106, closes #107')).toBeNull();
  });

  it('is wired into the landing, not just exported and unused', () => {
    const source = readFileSync(join(REPO, 'tools/land.mjs'), 'utf8');
    expect(
      source,
      'issueLeftOpen is defined but the blockers array never calls it — the check ' +
      'exists and nothing runs it, which is invisible in exactly the way this bug was',
    ).toMatch(/issueLeftOpen\(branch,/);
    expect(source, 'there is no way to land anyway once the branch is right').toContain('--no-issue-check');
  });

  /**
   * THE HALF A WEB SESSION DOES NOT HAVE.
   *
   * Everything above reads the BRANCH NAME. The harness names a web session's
   * branch before it has read the tracker — `claude/three-issues-8e7grn` —
   * so there is no number in it to find and every case above returns null.
   * That is the session most likely to forget the convention, and it was the
   * one shape this check could not see; the claim refs knew the whole time.
   */
  describe('and a branch whose name carries no number, off its claims', () => {
    it('catches issues the branch holds that nothing closes', () => {
      const msg = land.issueLeftOpen('claude/three-issues-8e7grn', 'Did three things', ['96', '113']);
      expect(msg, 'a claimed issue nothing closes was allowed to land').not.toBeNull();
      expect(msg).toContain('#96');
      expect(msg).toContain('#113');
      // The line it asks for has to be the line GitHub actually reads.
      expect(msg).toContain('Closes #96, closes #113');
    });

    it('is satisfied when every held issue is closed', () => {
      expect(land.issueLeftOpen(
        'claude/three-issues-8e7grn', 'Did three things\n\nCloses #96, closes #113', ['96', '113'],
      )).toBeNull();
    });

    it('names only the ones still open, and still lists what the branch holds', () => {
      const msg = land.issueLeftOpen('claude/x', 'Closes #96', ['96', '113']);
      expect(msg).toContain('closes #113');
      expect(msg, 'an issue that IS closed was reported as open').not.toMatch(/closes #96,/);
    });

    it('unions the branch name with the claims rather than preferring either', () => {
      // Named for one, holding another: both have to be closed.
      expect(land.issueLeftOpen('claude/issue-106-x', 'Closes #106', ['113'])).not.toBeNull();
      expect(land.issueLeftOpen('claude/issue-106-x', 'Closes #106, closes #113', ['113'])).toBeNull();
    });

    it('says nothing when the branch holds nothing and names nothing', () => {
      expect(land.issueLeftOpen('claude/some-feature-abcxyz', 'did a thing', [])).toBeNull();
    });

    it('reads the claim refs in the landing, not just in agents.mjs', () => {
      const source = readFileSync(join(REPO, 'tools/land.mjs'), 'utf8');
      expect(
        source,
        'claimedIssues is defined but the blockers array never passes it — the branch-name ' +
        'half would keep passing silently on every web session, which is the gap it closes',
      ).toMatch(/issueLeftOpen\(branch,[^;]*?claimedIssues\(branch\)\)/);
    });
  });
});

/**
 * A LANDING THAT WAS KILLED RATHER THAN FINISHED.
 *
 * Twice on 2026-09-08 a landing started with `nohup … &` was gone the next
 * time anybody looked: no exit code, no error, a log stopping mid-suite on a
 * green tick. A remote container is paused between turns and the detached
 * process did not survive it; the harness's tracked background run, given the
 * identical command, carried the same landing to `landed, and judged.`
 *
 * `land.mjs` cannot stop being killed. What it can do is stop the corpse
 * being ambiguous — which took four manual probes to read both times, and
 * `land.mjs`'s own lock comment already says why that ambiguity is
 * dangerous: "An empty log and an absent child process are both equally
 * consistent with running."
 *
 * The reading that matters most is the one about `main`. A landing killed
 * during `test` pushed nothing; a landing killed at `verdict` PUT A COMMIT ON
 * TRUNK and did not stay to hear the answer, which is docs/COMMANDS.md's
 * "an absent verdict is not a pass" arriving by a different road. Guessing
 * either way is worse than saying which.
 */
describe('a killed landing says what it was and what it left on main', () => {
  const dead = { pid: 4194303, started: '2026-09-08T20:41:15.559Z', target: '288afe8ec1f5f4f7fa079ace15e3930c3406c1b8' };

  it('names the pid, the start and the step it got to', () => {
    const lines = land.deathReading({ ...dead, step: 'test' }).join('\n');
    expect(lines).toContain('4194303');
    expect(lines).toContain('2026-09-08T20:41:15.559Z');
    expect(lines, 'the step is the whole point — "it is gone" was never the hard part').toContain('test');
    expect(lines, 'the commit it was landing is not named').toContain('288afe8');
  });

  it('says nothing reached main when it died before the push', () => {
    for (const step of ['fetch', 'rebase', 'install', 'typecheck', 'validate', 'test', 'gate']) {
      const lines = land.deathReading({ ...dead, step }).join('\n');
      expect(lines, `a landing killed at ${step} was not cleared of touching main`).toContain('Nothing of it reached');
    }
  });

  /**
   * The one that costs something to get wrong. `verdict` is the only step that
   * proves the push succeeded, and a commit on trunk nobody judged is the
   * state this repository has the longest record of mishandling.
   */
  it('says a commit is on main, unjudged, when it died after the push', () => {
    const lines = land.deathReading({ ...dead, step: 'verdict' }).join('\n');
    expect(lines).toContain('ALREADY PUSHED');
    expect(lines, 'it does not send the reader to the verdict it never heard').toContain('npm run verdict');
    expect(lines, 'a landed commit does not need re-landing').not.toContain('Nothing of it reached');
  });

  /**
   * And the honest middle. Dying DURING the push is genuinely ambiguous, and
   * this file's whole argument is that a guess is worse than a question.
   */
  it('refuses to resolve the push it may or may not have completed', () => {
    const lines = land.deathReading({ ...dead, step: 'push' }).join('\n');
    expect(lines).toContain('may or may not have landed');
    expect(lines).not.toContain('Nothing of it reached');
    expect(lines).not.toContain('ALREADY PUSHED');
  });

  it('still reads a lock written before the step was recorded', () => {
    // Forward compatibility in the other direction: a lock from a landing that
    // predates `mark` has no step, and must not crash the reading of it.
    const lines = land.deathReading({ pid: 4194303, started: dead.started }).join('\n');
    expect(lines).toContain('an unrecorded step');
  });

  /**
   * The command that was missing. Reading it out of `ps`, a log tail, the lock
   * and `git worktree list` is four probes an agent has to think to run; this
   * is one it can be told about.
   */
  it('answers --status without a lock, and without doing anything', () => {
    const r = spawnSync('node', [TOOL, '--status'], { encoding: 'utf8', cwd: REPO });
    const out = `${r.stdout}${r.stderr}`;
    // No lock in a normal checkout — and crucially it did not start a landing.
    expect(out).toMatch(/no landing is running|a landing (is RUNNING|DIED)/);
    expect(out, '--status ran the landing instead of reporting on it').not.toContain('$ git fetch origin main');
  });

  it('exits non-zero on a dead landing, so a script can ask', () => {
    const lock = join(git(REPO, 'rev-parse', '--git-dir'), 'land.lock');
    const existed = existsSync(lock);
    const previous = existed ? readFileSync(lock, 'utf8') : null;
    writeFileSync(lock, JSON.stringify({ ...dead, step: 'test' }));
    try {
      const r = spawnSync('node', [TOOL, '--status'], { encoding: 'utf8', cwd: REPO });
      expect(r.status, 'a dead landing reported success').toBe(1);
      expect(`${r.stdout}${r.stderr}`).toContain('DIED');
    } finally {
      if (previous !== null) writeFileSync(lock, previous);
      else if (existsSync(lock)) unlinkSync(lock);
    }
  });

  it('reports preflight-green as verified but not landed', () => {
    const gitDir = git(REPO, 'rev-parse', '--git-dir');
    const lock = join(gitDir, 'land.lock');
    const last = join(gitDir, 'land.last.json');
    const previousLock = existsSync(lock) ? readFileSync(lock, 'utf8') : null;
    const previousLast = existsSync(last) ? readFileSync(last, 'utf8') : null;
    if (existsSync(lock)) unlinkSync(lock);
    writeFileSync(last, JSON.stringify({
      step: 'preflight-green',
      target: dead.target,
      branch: 'chatgpt/352-queue-only-landing',
    }));
    try {
      const r = spawnSync('node', [TOOL, '--status'], { encoding: 'utf8', cwd: REPO });
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status).toBe(0);
      expect(out).toContain('preflight-green');
      expect(out).toContain('NOT pushed to main');
      expect(out).toContain('Merge when ready');
    } finally {
      if (previousLock !== null) writeFileSync(lock, previousLock);
      else if (existsSync(lock)) unlinkSync(lock);
      if (previousLast !== null) writeFileSync(last, previousLast);
      else if (existsSync(last)) unlinkSync(last);
    }
  });

  /**
   * THE SWEEP READS ITS PATH OUT OF A FILE, SO IT GETS A GUARD.
   *
   * Cleaning up after a killed landing means `rmSync(…, { recursive: true,
   * force: true })` on a path that came out of `land.lock` — JSON, which
   * anything can write. The delete is correct for exactly one shape,
   * `mkdtempSync(join(tmpdir(), 'ed-landing-'))` plus `/checkout`, and it
   * refuses everything else rather than doing its best with it.
   */
  it('sweeps only a path this tool could have created', () => {
    const tmp = '/tmp';
    expect(land.ourShed(`${tmp}/ed-landing-aB3xY/checkout`, tmp), 'refused its own worktree').toBe(true);
    for (const [path, why] of [
      ['/', 'root'],
      ['/home/someone/a-checkout/checkout', 'a working copy that is not a landing shed'],
      [`${tmp}/something-else/checkout`, 'a temp dir that is not ours'],
      [`${tmp}/ed-landing-aB3xY`, 'the shed rather than the worktree in it'],
      ['/etc/checkout', 'somewhere else entirely'],
      ['', 'an empty path'],
      [undefined, 'no path at all'],
    ] as [unknown, string][]) {
      expect(land.ourShed(path, tmp), `a recursive delete accepted ${why}`).toBe(false);
    }
  });

  /**
   * NOT `REPO`, AND THE LANDING IS WHAT TAUGHT ME THAT.
   *
   * The first cut of the case above used `REPO` as its "obviously not a shed"
   * path. It passes in this checkout and FAILS inside a landing, because a
   * landing runs the suite in `/tmp/ed-landing-<rand>/checkout` — so in there
   * `REPO` is shed-shaped, `ourShed` says true, and it is RIGHT to: that
   * directory is exactly what the sweep is for. The guard was fine; the test
   * had baked in an assumption about where it runs.
   *
   * Worth keeping as a test rather than a comment, because it is the property
   * that made the mistake possible: these two paths are the same shape, and
   * only one of them is a landing's own worktree.
   */
  it('reads a landing worktree as sweepable even when it is the cwd', () => {
    expect(land.ourShed('/tmp/ed-landing-rzOPTU/checkout', '/tmp')).toBe(true);
    expect(land.ourShed('/home/user/EldritchDynasty', '/tmp')).toBe(false);
  });

  /**
   * THE CALL, NOT THE PROSE — and this file has been caught by that once
   * already, matching `git push origin HEAD:main` inside the comment
   * explaining the bug. The first cut of THIS test made the same mistake in
   * the other direction: commenting out `mark('verdict')` left the text on
   * the line, the regex still matched, and the mutation passed. So the
   * assertions below run against the source with its comments removed.
   */
  it('records local verification progress without recording a main push', () => {
    const code = readFileSync(join(REPO, 'tools/land.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code, 'no step is ever written to the lock').toMatch(/mark\(step\)/);
    expect(code, 'the worktree path is never recorded for cleanup').toMatch(/mark\('worktree', \{ tree \}\)/);
    expect(code, 'local preflight still records a direct push state').not.toMatch(/mark\('push'\)/);
    expect(code, 'local preflight still records a post-push verdict state').not.toMatch(/mark\('verdict'\)/);
  });
});

/**
 * A PREFLIGHT VERIFIES A NAMED SHA, AND ONE RUNS PER CHECKOUT.
 *
 * Three failures on 2026-09-07 came from one shape. `land` ran its steps
 * against the live working tree and then pushed `HEAD:main`, which resolves
 * half an hour later:
 *
 *   9/9 gates pass
 *   $ git push origin HEAD:main
 *      ac12cda..02183f5  HEAD -> main
 *
 * That landing started at 891cac5 and verified 891cac5. `02183f5` was
 * committed while it ran and had been through no step at all. It reached trunk
 * under a green banner and CI failed it.
 *
 * It happened because a live landing was read as a dead one — empty log, no
 * `vitest` process, both equally consistent with "between steps" — and a
 * second was started over the same checkout.
 *
 * Both assertions below are from the SECOND actor's point of view, which is
 * the same choice `agents.test.ts` makes about the claim mutex: whether the
 * internals changed is an implementation detail, whether the other party is
 * stopped is the entire point.
 */
describe('a landing pushes what it verified, and only one runs at a time', () => {
  const TOOL = join(REPO, 'tools/land.mjs');
  const source = readFileSync(TOOL, 'utf8');

  it('captures a named SHA for the isolated preflight and never pushes main', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source, 'nothing captures the commit being verified').toMatch(/const target = git\('rev-parse', 'HEAD'\)/);
    expect(code).not.toMatch(/run\('git',\s*\['push'/);
    expect(code).not.toMatch(/:main/);
  });

  it('refuses a second landing and names the process holding it', () => {
    const held = { pid: process.pid, started: new Date().toISOString() };
    const lock = join(git(REPO, 'rev-parse', '--git-dir'), 'land.lock');
    const existed = existsSync(lock);
    const previous = existed ? readFileSync(lock, 'utf8') : null;
    writeFileSync(lock, JSON.stringify(held));
    try {
      const r = spawnSync('node', [TOOL], { encoding: 'utf8' });
      expect(r.status, 'a second landing was allowed to start').not.toBe(0);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain('already running');
      // The sentence that was missing: which process, and since when. Without
      // it the only evidence is an empty log, which reads as death.
      expect(out).toContain(String(process.pid));
      expect(out).toContain(held.started);
    } finally {
      if (previous !== null) writeFileSync(lock, previous);
      else if (existsSync(lock)) unlinkSync(lock);
    }
  });

  /**
   * THE STEPS RUN SOMEWHERE THE SESSION CANNOT REACH.
   *
   * This is the fix that removes the condition rather than guarding it. The
   * steps used to run against the live working tree, so a landing and its own
   * session could not share a container: a landing was started, the next issue
   * was worked while its suite ran, and the suite verified a tree carrying
   * changes the push would not carry.
   *
   * Asserted on the SOURCE rather than by running a thirty-minute landing,
   * which is the honest trade: what this can prove cheaply is that the steps
   * are handed a cwd that is not this checkout, and that the worktree is
   * cleaned up however the landing ends. That a landing is unaffected by
   * concurrent edits is acceptance criterion 3 on #130 and belongs to a person
   * with half an hour, not to the fast lane.
   */
  it('runs its steps in a worktree rather than in the session checkout', () => {
    expect(source, 'no worktree is created').toMatch(/worktree', 'add', '--detach'/);
    expect(
      source,
      'the steps are not handed the worktree as their cwd, so they still run ' +
      'against the live tree and a landing still forbids its own session to type',
    ).toMatch(/runNpm\(\['run', step\], tree\)/);
  });

  it('removes the worktree however the landing ends', () => {
    // A worktree left behind is registered in `.git/worktrees`, and the next
    // `git worktree add` at that path refuses — one abandoned landing would
    // otherwise break every landing after it, which is the same shape as a
    // stale lock.
    expect(source).toMatch(/worktree', 'remove', '--force'/);
    expect(source, 'cleanup is not attached to exit').toMatch(/process\.on\('exit', sweep\)/);
    expect(source, 'cleanup can follow the Windows junction into live node_modules').toMatch(/unlinkSync\(modulesLink\)/);
    expect(
      source.indexOf("process.on('exit', sweep)"),
      'cleanup is registered too late to catch a link-creation failure',
    ).toBeLessThan(source.indexOf("symlinkSync(join(REPO, 'node_modules')"));
  });

  it('no longer re-checks the tree, because the condition is gone', () => {
    // The guard it replaces. Keeping both would leave a landing still refusing
    // on an edit it is now immune to.
    expect(
      source,
      'the tree re-check survived the worktree change — a landing that cannot ' +
      'be affected by an edit must not abandon itself over one',
    ).not.toMatch(/the working tree changed while the checks ran/);
  });

  /**
   * The other direction, and the one that turns a bad landing into every
   * future landing refusing: a lock whose holder is gone must be taken, not
   * obeyed. A stale lock is the failure mode of every lock file ever written.
   */
  it('clears a lock left behind by a process that is gone', () => {
    const lock = join(git(REPO, 'rev-parse', '--git-dir'), 'land.lock');
    const existed = existsSync(lock);
    const previous = existed ? readFileSync(lock, 'utf8') : null;
    // pid 2^22 is above every Linux default pid_max and owned by nothing.
    writeFileSync(lock, JSON.stringify({ pid: 4194303, started: '2026-01-01T00:00:00Z' }));
    try {
      const r = spawnSync('node', [TOOL, '--dry-run'], { encoding: 'utf8' });
      const out = `${r.stdout}${r.stderr}`;
      expect(out, 'a dead holder still blocked a landing').not.toContain('already running');
    } finally {
      if (previous !== null) writeFileSync(lock, previous);
      else if (existsSync(lock)) unlinkSync(lock);
    }
  });
});


describe('local preflight cannot move main', () => {
  it('contains no legacy queue/deploy-key capability', () => {
    const source = readFileSync(join(REPO, 'tools/land.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(source).not.toContain('FROM_QUEUE');
    expect(source).not.toContain('--from-queue');
    expect(source).not.toContain('LAND_DEPLOY_KEY');
    expect(source).not.toMatch(/run\('git',\s*\['push'/);
    expect(source).toMatch(/remember\('preflight-green', \{ target, branch \}\)/);
  });

  it('always returns a native-queue handoff', () => {
    const result = land.finishLanding({
      target: '0123456789abcdef',
      branch: 'feature/native-queue',
    });
    expect(result).toMatchObject({ ok: true, state: 'preflight-green' });
    expect(result.message).toContain('Merge when ready');
    expect(result.message).toContain('native merge queue');
  });
});

describe('the landing is reachable and documented as the licence', () => {
  it('is an npm script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.land, 'package.json has no `land` script').toContain('tools/land.mjs');
  });

  it('is what AGENTS.md names in the standing authorisation', () => {
    // The sentence granting a push to trunk with no review is the one place in
    // this repository where naming the wrong command has already cost four red
    // runs on `main`. It is worth asserting the sentence itself.
    //
    // PROSE WRAPS, and this rule was line-based: the sentence and the command
    // it licenses sat on one 900-character line, and the first edit that
    // rewrapped the bullet moved `npm run land` onto the next line and failed
    // a build over a paragraph break. `codemap.test.ts` learned the same thing
    // about its timing rule. Continuation lines are indented, so folding them
    // into their bullet turns each bullet back into one line to match against.
    //
    // `[ \t]` and NOT `\s`, which matches a newline: `\n\s+` folds a blank line
    // too, so the whole document collapses onto one line, that line contains
    // every phrase in the file, and the rule passes on an AGENTS.md licensing
    // `npm run check`. Checked by mutating the file and watching this fail.
    const agents = readFileSync(join(REPO, 'AGENTS.md'), 'utf8').replace(/\n[ \t]+/g, ' ');
    const rule = agents
      .split('\n')
      .filter((l) => /standing authorization|standing authorisation/i.test(l))
      .join('\n');
    expect(rule, 'AGENTS.md no longer states a standing authorisation at all').not.toEqual('');
    expect(
      rule,
      'the standing authorisation still licenses a push on a command that is not the ' +
      'landing. It must name `npm run land`, which is the set CI runs.',
    ).toContain('npm run land');
  });
});

/**
 * ── A DIFF OF ONLY MARKDOWN, ON A GREEN BASE, GETS THE SHORT SET ──────────
 *
 * `tools/docs-only.mjs` carries the argument. What this file holds is the
 * three things that argument rests on, each stated as a build failure:
 *
 *   1. the classifier refuses what it must — code, renames, an empty diff, a
 *      base that is not green;
 *   2. the short set IS CI's short tier, derived from the workflow, so the
 *      landing and the build cannot mean different things by "short";
 *   3. nothing outside the fast lane reads a markdown file. That is the fact
 *      that makes skipping the rest safe, and the day it stops being true is
 *      the day this goes red rather than the day a docs-only landing breaks
 *      `main`.
 */
const docsOnly = (await import(pathToFileURL(join(REPO, 'tools/docs-only.mjs')).href)) as {
  DOCS_ONLY_STEPS: string[];
  classify: (files: string[], baseState: string) => { short: boolean; reason: string };
  landingPlan: (base: string, head: string, cwd?: string) => { short: boolean; reason: string };
};

describe('a markdown-only change runs the short set, and only then', () => {
  it('runs the short set for markdown on a green base', () => {
    const plan = docsOnly.classify(['ARCHITECTURE.md', 'docs/COMMANDS.md', 'AGENTS.md'], 'green');
    expect(plan.short).toBe(true);
  });

  it.each([
    ['a TypeScript file', ['AGENTS.md', 'packages/core/src/world.ts']],
    ['content YAML', ['packages/content/events/rites.yaml']],
    ['the workflow itself', ['.github/workflows/check.yml']],
    ['package.json, which codemap reads for stray timings', ['package.json']],
    ['a lookalike extension', ['notes.mdx']],
    ['a file that merely contains ".md"', ['README.md.ts']],
  ])('runs everything for %s', (_, files) => {
    const plan = docsOnly.classify(files, 'green');
    expect(plan.short, `${files.join(', ')} was classified as documentation`).toBe(false);
    expect(plan.reason).toContain('not markdown');
  });

  it('runs everything for an empty diff, which is nothing to classify', () => {
    expect(docsOnly.classify([], 'green').short).toBe(false);
  });

  /**
   * THE CASE THAT WOULD LIE. On a red `main`, a short run of a docs commit
   * records a GREEN verdict, and the session banner, the scoreboard and the
   * next landing all read "trunk is healthy". The short set is a claim that
   * nothing changed; it is only a pass if the thing that did not change was.
   */
  it.each(['red', 'pending', 'absent'])('runs everything when the base is %s', (state) => {
    const plan = docsOnly.classify(['AGENTS.md'], state);
    expect(plan.short, `a docs-only diff on a ${state} base was given the short set`).toBe(false);
    expect(plan.reason).toContain(state.toUpperCase());
  });

  /**
   * A real repository, because the bug this guards is in the git invocation
   * rather than the classifier: with rename detection on, `a.ts → a.md` is
   * reported as `a.md` alone and a deleted TypeScript file passes as prose.
   */
  it('sees a TypeScript file renamed to markdown as the code change it is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-docs-only-'));
    try {
      const g = (...args: string[]) => git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args);
      g('init', '--quiet');
      writeFileSync(join(dir, 'engine.ts'), 'export const x = 1;\n'.repeat(20));
      writeFileSync(join(dir, 'README.md'), '# readme\n');
      g('add', '.');
      g('commit', '--quiet', '-m', 'base');
      const base = g('rev-parse', 'HEAD');

      g('mv', 'engine.ts', 'engine.md');
      g('commit', '--quiet', '-m', 'rename');
      const renamed = docsOnly.landingPlan(base, g('rev-parse', 'HEAD'), dir);
      expect(renamed.short, 'a renamed .ts file was classified as documentation').toBe(false);
      expect(renamed.reason).toContain('engine.ts');

      // And a genuine markdown-only diff gets as far as the base's verdict —
      // which, with no remote to ask, is ABSENT, and absent is not green.
      g('checkout', '--quiet', base);
      writeFileSync(join(dir, 'README.md'), '# readme, edited\n');
      g('commit', '--quiet', '-am', 'prose');
      const prose = docsOnly.landingPlan(base, g('rev-parse', 'HEAD'), dir);
      expect(prose.short).toBe(false);
      expect(prose.reason).toContain('markdown only, but the base is ABSENT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers full, never throws, when it cannot diff at all', () => {
    const plan = docsOnly.landingPlan('0000000000000000000000000000000000000000', 'HEAD', REPO);
    expect(plan.short).toBe(false);
  });

  /**
   * "Short" means one thing. It is derived from the jobs `check.yml` runs on
   * every event — the ones carrying neither the tier's condition nor the tag
   * condition — rather than listed twice, for the reason `ciScripts` exists.
   */
  it('is exactly the set CI runs at its short tier', () => {
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
    const blocks = jobs.split(/\n(?= {2}[\w-]+:\s*\n)/).slice(1);
    const always = blocks.filter((b) =>
      !b.includes('needs.tier.outputs.full') && !b.includes("startsWith(github.ref, 'refs/tags/')"));
    expect(always.length, 'found no always-run jobs in check.yml').toBeGreaterThan(0);

    const scripts = new Set<string>();
    for (const b of always) {
      for (const [, name] of b.matchAll(/\bnpm run ([\w:-]+)/g)) scripts.add(name!);
      if (/\bnpm test\b/.test(b)) scripts.add('test');
    }
    for (const a of land.ADVISORY) scripts.delete(a);
    expect([...scripts].sort()).toEqual([...docsOnly.DOCS_ONLY_STEPS].sort());
  });

  it('names only scripts package.json has', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const s of docsOnly.DOCS_ONLY_STEPS) expect(pkg.scripts[s], `no \`${s}\` script`).toBeTruthy();
  });

  /**
   * THE FACT THE WHOLE SHORTCUT STANDS ON.
   *
   * Every file that reads a markdown file as data — `codemap`, `codex`,
   * `docs`, `settings`, this one — is a fast test, and the short set runs
   * those. So this scans everything that is NOT a fast test for code that
   * names a markdown file, and demands the list be exactly the one below,
   * each with the reason it cannot change a verdict. A new reader outside the
   * fast lane fails here first, and whoever wrote it decides, in words, which
   * side of the line it is on.
   */
  const OUTSIDE_FAST_LANE: Record<string, string> = {
    '.claude/hooks/guard-edit.mjs': 'a hook: names generated files to refuse edits; CI never runs it',
    'packages/core/src/tools/gen-docs.ts': 'writes docs/VOCABULARY.md; its one CI reader is docs.test.ts, a fast test',
    'packages/core/src/world-health.slow.test.ts': 'names BALANCE-LOG in an assertion message; reads nothing',
    'tools/agents.mjs': 'message text only',
    'tools/cost.mjs': 'rewrites AGENTS.md figures by hand; CI never runs it',
    'tools/land.mjs': 'message text only',
    'tools/orient.mjs': 'message text only',
  };

  it('finds no markdown reader outside the fast lane it has not been told about', () => {
    const tracked = execFileSync('git', ['ls-files', '*.ts', '*.mjs', '*.js', '*.vue'], { cwd: REPO, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const fastTest = (f: string) => /\.test\.ts$/.test(f) && !/\.slow\.test\.ts$/.test(f);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const readers = tracked.filter((f) =>
      !fastTest(f) && /['"`][^'"`\n]*\.md\b[^'"`\n]*['"`]/.test(strip(readFileSync(join(REPO, f), 'utf8'))));

    const unexplained = readers.filter((f) => !(f in OUTSIDE_FAST_LANE));
    expect(
      unexplained,
      `${unexplained.join(', ')} names a markdown file in code, outside the fast lane. A docs-only ` +
      `landing skips everything outside it, so if this READS markdown and can fail a build, a ` +
      `markdown-only change could break main unseen. Move the check into a fast test, or add it ` +
      `to OUTSIDE_FAST_LANE with the reason it cannot change a verdict.`,
    ).toEqual([]);

    const stale = Object.keys(OUTSIDE_FAST_LANE).filter((f) => !readers.includes(f));
    expect(stale, `OUTSIDE_FAST_LANE explains files that no longer name markdown: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps one short-tier step list while CI alone classifies docs-only changes', () => {
    const code = readFileSync(join(REPO, 'tools/land.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('SESSION_PREFLIGHT_STEPS = DOCS_ONLY_STEPS');
    expect(code).toMatch(/landPhases\(plan\.steps\)/);
    expect(workflow).toContain('node tools/docs-only.mjs "$BASE" "$HEAD_SHA"');
  });
});


describe('the native merge queue CI contract', () => {
  it('runs the check workflow for the synthetic merge-group commit', () => {
    expect(workflow).toContain('merge_group:\n    types: [checks_requested]');
    expect(workflow).toContain("github.event_name == 'merge_group'");
    expect(workflow).toContain('github.event.merge_group.base_sha');
    expect(workflow).toContain('github.event.merge_group.head_sha');
  });

  it('publishes one stable required result and permits skips only for the selected short tier', () => {
    const required = workflow.slice(
      workflow.indexOf('\n  required:\n'),
      workflow.indexOf('\n  android:\n'),
    );
    expect(required).toContain('name: CI required');
    expect(required).toContain('if: always()');
    expect(required).toContain('needs: [tier, lint, fast, windows, ios, test, gates, corpus]');
    expect(required).toContain("const shortTier = needs.tier?.outputs?.full !== 'true';");
    expect(required).toContain("job.result === 'skipped'");
    expect(required).not.toContain("context.eventName === 'pull_request'");
    expect(required).toContain('core.setFailed');
  });
});

const verdictReader = (await import(pathToFileURL(join(REPO, 'tools/verdict.mjs')).href)) as {
  parseVerdict: (m: string) => { conclusion: string; sha: string; run: string; jobs: { name: string; result: string }[] } | null;
  stateOf: (v: unknown) => string;
  landingRecordMessage: (
    receipt: { before: string; checked: string; pushed: string; branch: string },
    verdict: { conclusion: string; run?: string },
  ) => string;
  parseLandingRecord: (m: string) => {
    before: string;
    checked: string;
    pushed: string;
    branch: string;
    verdict: string;
    verdictRef: string;
    run: string;
    recorded: string;
  } | null;
};

describe('queue landing coverage metadata (#320/#352)', () => {
  const BEFORE = 'a'.repeat(40);
  const TARGET = 'b'.repeat(40);

  it('creates the landing coverage commit without a platform-specific filesystem sentinel', () => {
    const code = readFileSync(join(REPO, 'tools/verdict.mjs'), 'utf8');
    expect(code).toContain("tryGit('mktree')");
    expect(code).not.toMatch(/hash-object['"],\s*['"]-t['"],\s*['"]tree/);
  });

  it('records one checked/pushed head and its real verdict, not invented verdicts for covered commits', () => {
    const message = verdictReader.landingRecordMessage(
      { before: BEFORE, checked: TARGET, pushed: TARGET, branch: 'feature/range' },
      { conclusion: 'success', run: 'https://github.com/o/r/actions/runs/42' },
    );
    const record = verdictReader.parseLandingRecord(message);

    expect(record).toMatchObject({
      before: BEFORE,
      checked: TARGET,
      pushed: TARGET,
      branch: 'feature/range',
      verdict: 'success',
      verdictRef: `refs/verdict/${TARGET}`,
      run: 'https://github.com/o/r/actions/runs/42',
    });
    expect(message.match(/^checked:/gm)).toHaveLength(1);
    expect(message.match(/^verdict:/gm)).toHaveLength(1);

    const code = readFileSync(join(REPO, 'tools/verdict.mjs'), 'utf8');
    expect(code).toContain("const LANDING_NS = 'refs/landing'");
    expect(code).toContain('recordLandingRange(sha, verdict)');
  });
});
