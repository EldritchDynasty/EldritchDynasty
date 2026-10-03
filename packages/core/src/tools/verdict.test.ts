import { beforeAll, describe, expect, it, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A PUSH IS NOT FINISHED UNTIL A VERDICT COMES BACK, AND "NONE" IS A STATE.
 *
 * Runs 91 to 97 of `check.yml` on `main` each concluded in three to five
 * seconds with a single job carrying no steps: the repository was out of
 * Actions minutes while it was private, so the runs never started. Seven
 * commits landed unjudged over sixteen hours, six of them agent landings, and
 * the only reason anybody found out was somebody reading the run list by hand
 * a day later.
 *
 * What makes that failure this codebase's own kind is the shape of it: a red
 * run and a run that never happened are the same colour in every UI, so the
 * absence looked exactly like a build somebody would get round to. Two states
 * where there are four — and the first cut of this tool shipped with three,
 * collapsing "CI is still running" into "no verdict", which is the same
 * mistake one turn smaller.
 *
 * So the assertion that matters here is not "green reads green". It is that
 * a commit with NO verdict reports absent rather than failure — and, in the
 * replay below, that the seven real ones do.
 */

const REPO = join(import.meta.dirname, '../../../..');
const TOOL = join(REPO, 'tools/verdict.mjs');
const RANGE_TOOL = join(REPO, 'tools/verdict-range.mjs');

describe('the canonical repository owner', () => {
  it('keeps tracked operational references on the organization repository', () => {
    const formerSlug = ['JamesFlames', 'EldritchDynasty'].join('/');
    const textFile = /\.(?:md|mjs|ts|vue|ya?ml|json|toml)$/;
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO })
      .toString('utf8')
      .split('\0')
      .filter((file) => file && textFile.test(file));
    const stale = files.filter((file) => readFileSync(join(REPO, file), 'utf8').includes(formerSlug));
    expect(stale, `these files still name the repository's former owner: ${stale.join(', ')}`).toEqual([]);
  });
});

const runTool = <T>(name: string, argument: unknown): T => JSON.parse(execFileSync(
  process.execPath,
  ['--input-type=module', '--eval',
    'const [url, name, arg] = process.argv.slice(2); const mod = await import(url); process.stdout.write(JSON.stringify(mod[name](JSON.parse(arg))));',
    'tool-test', pathToFileURL(TOOL).href, name, JSON.stringify(argument ?? null)],
  { encoding: 'utf8' },
));

type Verdict = {
  parseVerdict: (message: string) => null | {
    conclusion: string;
    sha: string;
    branch: string;
    run: string;
    jobs: { name: string; result: string }[];
  };
  stateOf: (v: unknown) => 'green' | 'red' | 'pending' | 'absent';
  resolveSha: (given?: string) => string;
};

const verdict: Verdict = {
  parseVerdict: (message) => runTool<ReturnType<Verdict['parseVerdict']>>('parseVerdict', message),
  stateOf: (value) => runTool<ReturnType<Verdict['stateOf']>>('stateOf', value),
  resolveSha: (given) => runTool<ReturnType<Verdict['resolveSha']>>('resolveSha', given),
};

/** The message shape `.github/workflows/verdict.yml` writes, verbatim. */
const message = (conclusion: string, jobs: Record<string, string>, sha = 'abc123') =>
  [
    `verdict ${conclusion}`,
    '',
    `sha: ${sha}`,
    'branch: main',
    `conclusion: ${conclusion}`,
    'run: https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/34058287997',
    'run_number: 103',
    ...Object.entries(jobs).map(([name, result]) => `job: ${name} = ${result}`),
    'recorded: 2026-09-07T01:00:00Z',
  ].join('\n');

describe('the four states', () => {
  it('reads a run where every job passed as green', () => {
    const v = verdict.parseVerdict(
      message('success', { 'typecheck + validate': 'success', test: 'success', gates: 'success' }),
    );
    expect(verdict.stateOf(v)).toBe('green');
    expect(v!.jobs).toHaveLength(3);
  });

  it('reads a failed job as red, and names which one', () => {
    const v = verdict.parseVerdict(
      message('failure', { 'typecheck + validate': 'success', test: 'success', gates: 'failure' }),
    );
    expect(verdict.stateOf(v)).toBe('red');
    expect(v!.jobs.find((j) => j.result === 'failure')?.name).toBe('gates');
  });

  it('reads no verdict at all as ABSENT, which is not a pass', () => {
    expect(verdict.stateOf(null)).toBe('absent');
    expect(verdict.stateOf(verdict.parseVerdict(''))).toBe('absent');
  });

  /**
   * THE STATE THIS TOOL SHIPPED WITHOUT, AND WAS WRONG FOR WANT OF.
   *
   * The first landing to use `npm run verdict` reported NO VERDICT for
   * 912f15e while its `check` run was still in progress — "not yet" reported
   * as "never". That is the same two-states-where-there-are-three mistake the
   * whole issue is about, made inside the fix for it, because a running run
   * and a run that never existed had written the same thing to the refs:
   * nothing.
   *
   * The two must never collapse again. `pending` says CI is working and will
   * answer; `absent` says nothing is coming and the repository has a problem
   * an agent cannot fix. Acting on one as though it were the other wastes a
   * session in either direction.
   */
  it('reads a run that has started but not finished as PENDING, never absent', () => {
    const v = verdict.parseVerdict(message('pending', { '(not started)': 'queued' }));
    expect(verdict.stateOf(v)).toBe('pending');
    expect(verdict.stateOf(v)).not.toBe('absent');
  });

  it('keeps pending and absent distinct, because they mean opposite things', () => {
    const pending = verdict.stateOf(verdict.parseVerdict(message('pending', {})));
    const absent = verdict.stateOf(null);
    expect(pending).not.toEqual(absent);
    // And neither is ever mistaken for a pass.
    expect([pending, absent]).not.toContain('green');
  });

  /**
   * `cancelled` and `timed_out` are not `success`, so they are red.
   *
   * The alternative is a default case that lets an unfamiliar conclusion
   * through as a pass, which is invariant 5's rule — never end a decision over
   * a closed set with a permissive default — applied to a string GitHub owns
   * and may add to without telling anybody.
   */
  it('treats any conclusion that is not success or pending as red', () => {
    for (const c of ['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']) {
      expect(verdict.stateOf(verdict.parseVerdict(message(c, { test: c }))), c).toBe('red');
    }
  });

  it('reads a malformed message as no verdict rather than as a pass', () => {
    // A parser that returns a truthy object for junk would report green for it.
    expect(verdict.parseVerdict('verdict success\n\nnothing useful here')).toBeNull();
    expect(verdict.stateOf(verdict.parseVerdict('total nonsense'))).toBe('absent');
  });
});

/**
 * THE SEVEN, REPLAYED.
 *
 * The acceptance criterion on issue #118, run against the real numbers: those
 * runs must come back as seven ABSENCES, not seven failures. A tool that calls
 * them failures has not fixed anything — it has renamed the confusion.
 *
 * The distinction is not academic. A red build is the agent's to fix. An
 * absence is the repository's to fix, and an agent that treats it as red will
 * spend a session bisecting a diff that was never tested.
 */
describe('runs 91-97, which is why this exists', () => {
  const SEVEN = [
    { run: 91, seconds: 3, sha: '0000091' },
    { run: 92, seconds: 5, sha: '0000092' },
    { run: 93, seconds: 3, sha: '0000093' },
    { run: 94, seconds: 3, sha: '0000094' },
    { run: 95, seconds: 3, sha: '0000095' },
    { run: 96, seconds: 3, sha: '0000096' },
    { run: 97, seconds: 4, sha: '0000097' },
  ];

  it('reports all seven as absent, because no run completed to record one', () => {
    // A run that never starts never completes, so `workflow_run` never fires
    // and no ref is written. The absence falls out of the mechanism rather
    // than being detected by a heuristic about run duration.
    const states = SEVEN.map(() => verdict.stateOf(null));
    expect(states).toEqual(Array(7).fill('absent'));
  });

  it('does not read them as red, which is the whole distinction', () => {
    expect(SEVEN.map(() => verdict.stateOf(null))).not.toContain('red');
  });

  /**
   * And they are not `pending` either. Those seven runs concluded — in three
   * to five seconds, having done nothing — so nothing was ever going to
   * arrive. A tool that called them pending would tell an agent to wait
   * forever, which is the opposite failure and just as expensive.
   */
  it('does not read them as pending — nothing was coming', () => {
    expect(SEVEN.map(() => verdict.stateOf(null))).not.toContain('pending');
  });

  it('still reports run 98 — the first after the repository went public — as green', () => {
    const v = verdict.parseVerdict(
      message('success', { 'typecheck + validate': 'success', test: 'success', gates: 'success' }),
    );
    expect(verdict.stateOf(v)).toBe('green');
  });
});

/**
 * THE REF ITSELF, AGAINST A REAL REPOSITORY.
 *
 * Everything above is a parser. This is the part that has to be true of git:
 * that an orphan commit pushed to a namespace outside `refs/heads` can be
 * written, fetched back by a clone, and read — because that is what the
 * workflow does and what `npm run verdict` does, and neither has ever been
 * watched do it.
 */
describe('the ref, in a repository', () => {
  let root: string;
  let bare: string;
  let clone: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'verdict-'));
    bare = join(root, 'bare.git');
    clone = join(root, 'clone');
    execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
    execFileSync('git', ['clone', bare, clone]);
    git(clone, 'config', 'user.email', 't@example.com');
    git(clone, 'config', 'user.name', 'test');
    writeFileSync(join(clone, 'a'), '');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-m', 'first');
    git(clone, 'push', 'origin', 'main');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes and reads back a verdict the way the workflow does', () => {
    const sha = git(clone, 'rev-parse', 'HEAD');
    // Git's empty tree, by its well-known hash rather than by hashing
    // `/dev/null` — which is a path on one of the two platforms CI runs on.
    const empty = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const body = message('success', { test: 'success', gates: 'success' }, sha);
    const commit = git(clone, 'commit-tree', empty, '-m', body);
    git(clone, 'push', 'origin', `${commit}:refs/verdict/${sha}`);

    // A DIFFERENT clone, because the question is whether another session can
    // read it — the one the agent container actually asks.
    const reader = join(root, 'reader');
    execFileSync('git', ['clone', bare, reader]);
    git(reader, 'fetch', 'origin', '+refs/verdict/*:refs/verdict/*');

    const read = verdict.parseVerdict(git(reader, 'log', '-1', '--format=%B', `refs/verdict/${sha}`));
    expect(verdict.stateOf(read)).toBe('green');
    expect(read!.sha).toBe(sha);

    // The commit is an orphan with an empty tree: it cannot be a fast-forward
    // of anything and cannot be merged into a branch by accident, exactly as a
    // claim ref cannot.
    expect(git(reader, 'rev-list', '--count', `refs/verdict/${sha}`)).toBe('1');
    expect(git(reader, 'ls-tree', `refs/verdict/${sha}`)).toBe('');
  });

  it('has nothing to report for a commit CI never judged', () => {
    git(clone, 'commit', '--allow-empty', '-m', 'unjudged');
    const sha = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'push', 'origin', 'main');

    const reader = join(root, 'reader2');
    execFileSync('git', ['clone', bare, reader]);
    git(reader, 'fetch', 'origin', '+refs/verdict/*:refs/verdict/*');

    let found: string | null = null;
    try {
      found = git(reader, 'log', '-1', '--format=%B', `refs/verdict/${sha}`);
    } catch {
      found = null;
    }
    expect(verdict.stateOf(verdict.parseVerdict(found ?? ''))).toBe('absent');
  });
});

/**
 * THE REF IS NAMED FOR THE FULL SHA AND NOBODY TYPES ONE.
 *
 * `verdict.yml` writes `refs/verdict/<40 hex>`. This tool looked the ref up
 * under whatever was typed, so `npm run verdict -- 037da8b` — the form every
 * `git log --oneline`, every landing message and this repository's own docs
 * print — found nothing and reported NO VERDICT.
 *
 * Of the four states that is the worst one to get wrong. It is documented as
 * "not a pass and not yours to fix", and its message sends the reader to the
 * repository's Actions billing. Measured on 2026-09-13: `main` at 037da8b was
 * green, all three jobs passed, the ref was on the remote, and a short sha
 * said CI had never run for it.
 */
describe('the sha a verdict is looked up under', () => {
  it('passes a full 40-character sha through untouched, without asking git', () => {
    const full = '037da8bfd25178edb986650d1ef88b961b931792';
    expect(verdict.resolveSha(full)).toBe(full);
    // Case-folded, because a ref name is bytes and GitHub writes lower case.
    expect(verdict.resolveSha(full.toUpperCase())).toBe(full);
  });

  it('expands anything else git can resolve — which is what a person types', () => {
    const head = verdict.resolveSha('HEAD');
    expect(head, 'HEAD did not resolve to a full sha').toMatch(/^[0-9a-f]{40}$/);
    // The bug, as an assertion: the short form has to arrive at the same ref
    // name as the long one, or the lookup misses and reports absent.
    expect(verdict.resolveSha(head.slice(0, 7))).toBe(head);
  });

  it('defaults to HEAD when nothing was given, as the landing calls it', () => {
    expect(verdict.resolveSha()).toBe(verdict.resolveSha('HEAD'));
  });

  it('is actually used to build the ref name, rather than being exported and unused', () => {
    const source = readFileSync(TOOL, 'utf8');
    expect(
      source,
      'main() takes the positional argument verbatim again — a short sha will report '
      + 'NO VERDICT for a green commit, which is the bug this function exists for',
    ).toMatch(/resolveSha\(positional\[0\]\)/);
  });
});


/**
 * A MAIN RUN JUDGES THE INTEGRATED RANGE, NOT ONLY ITS TIP (#320).
 *
 * Connector landings and merged PRs can place several commits on main before
 * one push-triggered check runs. The old recorder wrote refs/verdict/<head>
 * only, so the other commits stayed permanently unjudged even though their
 * content was present in the exact tree CI exercised.
 *
 * These fixtures use real git history and real verdict refs. The important
 * failure cases are the boundaries: a cancelled run is not an answer and may
 * be covered through; a failed run IS an answer and must keep its own verdict.
 */
describe('the commit range covered by an integrated main run', () => {
  const gitAt = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  const writeVerdict = (
    cwd: string,
    sha: string,
    conclusion: string,
    branch = 'main',
    run = '900',
  ) => {
    const body = [
      `verdict ${conclusion}`,
      '',
      `sha: ${sha}`,
      `branch: ${branch}`,
      `conclusion: ${conclusion}`,
      `run: https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/${run}`,
      'recorded: 2026-09-29T05:00:00Z',
    ].join('\n');
    const refCommit = gitAt(cwd, 'commit-tree', EMPTY_TREE, '-m', body);
    gitAt(cwd, 'update-ref', `refs/verdict/${sha}`, refCommit);
  };

  const covered = (cwd: string, head: string, branch = 'main', run = '999') =>
    execFileSync(process.execPath, [RANGE_TOOL, head, branch, run], {
      cwd,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-verdict-range-'));
    gitAt(root, 'init', '-q', '-b', 'main');
    gitAt(root, 'config', 'user.email', 'verdict-range@example.com');
    gitAt(root, 'config', 'user.name', 'verdict-range');
    const commit = (subject: string) => {
      gitAt(root, 'commit', '-q', '--allow-empty', '-m', subject);
      return gitAt(root, 'rev-parse', 'HEAD');
    };
    return { root, commit };
  };

  it('covers every commit after the previous judged main head', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('previous landed head');
      writeVerdict(root, base, 'success', 'main', '800');
      const one = commit('first commit in landed batch');
      const two = commit('second commit in landed batch');
      const head = commit('batch tip');

      expect(covered(root, head)).toEqual([one, two, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the first-parent main boundary for a real merge commit', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('previous main');
      writeVerdict(root, base, 'success', 'main', '800');

      gitAt(root, 'checkout', '-q', '-b', 'topic');
      const one = commit('topic one');
      // Even a misleading main-shaped ref on the side branch cannot become
      // the integration boundary; only trunk's first-parent lineage can.
      writeVerdict(root, one, 'success', 'main', '850');
      const two = commit('topic two');

      gitAt(root, 'checkout', '-q', 'main');
      gitAt(root, 'merge', '-q', '--no-ff', 'topic', '-m', 'merge topic');
      const head = gitAt(root, 'rev-parse', 'HEAD');

      expect(covered(root, head)).toEqual([one, two, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let feature-branch verdicts truncate main coverage', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('previous main');
      writeVerdict(root, base, 'success', 'main', '800');
      const one = commit('feature commit one');
      writeVerdict(root, one, 'success', 'chatgpt/work', '850');
      const two = commit('feature commit two');
      writeVerdict(root, two, 'failure', 'chatgpt/work', '851');
      const head = commit('landed tip');

      expect(covered(root, head)).toEqual([one, two, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let synthetic covered refs become later integration boundaries', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('last independently judged main');
      writeVerdict(root, base, 'success', 'main', '800');
      const coveredCommit = commit('covered by an earlier integrated head');
      writeVerdict(root, coveredCommit, 'covered', 'main', '850');
      const next = commit('next commit after covered marker');
      const head = commit('later checked main head');

      expect(covered(root, head)).toEqual([coveredCommit, next, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('covers through pending and cancelled main runs because neither answered', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('last judged main');
      writeVerdict(root, base, 'success', 'main', '800');
      const pending = commit('superseded pending head');
      writeVerdict(root, pending, 'pending', 'main', '810');
      const cancelled = commit('cancelled head');
      writeVerdict(root, cancelled, 'cancelled', 'main', '811');
      const head = commit('later integrated head');

      expect(covered(root, head)).toEqual([pending, cancelled, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops at an earlier failed main run because that commit was actually judged', () => {
    const { root, commit } = fixture();
    try {
      const old = commit('older green');
      writeVerdict(root, old, 'success', 'main', '800');
      const failed = commit('red main');
      writeVerdict(root, failed, 'failure', 'main', '810');
      const head = commit('later fix');

      expect(covered(root, head)).toEqual([head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores partial refs from the same source check when a recorder is retried', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('previous judged main');
      writeVerdict(root, base, 'success', 'main', '800');
      const one = commit('batch one');
      // Simulate a recorder that wrote one successful-looking ref before its
      // own job was retried. It belongs to the same source check, so it cannot
      // become the boundary for itself.
      writeVerdict(root, one, 'success', 'main', '999');
      const head = commit('batch tip');

      expect(covered(root, head, 'main', '999')).toEqual([one, head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the head only when no safe main boundary exists', () => {
    const { root, commit } = fixture();
    try {
      commit('unknown history one');
      commit('unknown history two');
      const head = commit('current head');

      expect(covered(root, head)).toEqual([head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps feature-branch runs head-only even when main verdicts exist behind them', () => {
    const { root, commit } = fixture();
    try {
      const base = commit('main base');
      writeVerdict(root, base, 'success', 'main', '800');
      commit('feature one');
      const head = commit('feature tip');

      expect(covered(root, head, 'chatgpt/feature')).toEqual([head]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


describe('historical verdict batch repair', () => {
  const gitAt = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-verdict-repair-'));
    gitAt(root, 'init', '-q', '-b', 'main');
    gitAt(root, 'config', 'user.email', 'verdict-repair@example.com');
    gitAt(root, 'config', 'user.name', 'verdict-repair');
    const commit = (subject: string) => {
      gitAt(root, 'commit', '-q', '--allow-empty', '-m', subject);
      return gitAt(root, 'rev-parse', 'HEAD');
    };
    const verdictRef = (
      sha: string,
      conclusion: string,
      branch = 'main',
      run = '900',
    ) => {
      const body = [
        `verdict ${conclusion}`,
        '',
        `sha: ${sha}`,
        `branch: ${branch}`,
        `conclusion: ${conclusion}`,
        `run: https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/${run}`,
        'recorded: 2026-09-29T05:00:00Z',
      ].join('\n');
      const refCommit = gitAt(root, 'commit-tree', EMPTY_TREE, '-m', body);
      gitAt(root, 'update-ref', `refs/verdict/${sha}`, refCommit);
    };
    const plans = (head: string) => {
      const out = execFileSync(process.execPath, [RANGE_TOOL, '--repair', head], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      if (!out) return [] as Array<{ source: string; target: string }>;
      return out.split('\n').map((line) => {
        const [source, target] = line.split('\t');
        return { source: source!, target: target! };
      });
    };
    return { root, commit, verdictRef, plans };
  };

  it('reconstructs every missing commit between adjacent judged main tips', () => {
    const { root, commit, verdictRef, plans } = fixture();
    try {
      const oldest = commit('oldest known main tip');
      verdictRef(oldest, 'success', 'main', '700');

      const a = commit('batch one a');
      const b = commit('batch one b');
      const tipOne = commit('batch one tip');
      verdictRef(tipOne, 'success', 'main', '800');

      const c = commit('batch two a');
      // A feature-branch verdict is evidence about that branch, not main, and
      // is exactly the kind of ref the historical repair must supersede.
      verdictRef(c, 'success', 'chatgpt/topic', '850');
      const d = commit('batch two b');
      verdictRef(d, 'cancelled', 'main', '860');
      const tipTwo = commit('batch two tip');
      verdictRef(tipTwo, 'success', 'main', '900');

      expect(plans(tipTwo)).toEqual([
        { source: tipTwo, target: c },
        { source: tipTwo, target: d },
        { source: tipOne, target: a },
        { source: tipOne, target: b },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never uses a covered ref as the source of a historical repair range', () => {
    const { root, commit, verdictRef, plans } = fixture();
    try {
      const oldest = commit('old independently judged main');
      verdictRef(oldest, 'success', 'main', '700');

      const beforeCovered = commit('member before synthetic coverage marker');
      const coveredCommit = commit('synthetic covered commit');
      verdictRef(coveredCommit, 'covered', 'main', '800');
      const afterCovered = commit('member after synthetic coverage marker');
      const head = commit('new independently judged tip');
      verdictRef(head, 'success', 'main', '900');

      expect(plans(head)).toEqual([
        { source: head, target: beforeCovered },
        { source: head, target: coveredCommit },
        { source: head, target: afterCovered },
      ]);
      expect(plans(head).some((plan) => plan.source === coveredCommit)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a real failed main verdict while repairing each side of it', () => {
    const { root, commit, verdictRef, plans } = fixture();
    try {
      const oldest = commit('old green');
      verdictRef(oldest, 'success', 'main', '700');

      const beforeRed = commit('introduced by red batch');
      const red = commit('red tip');
      verdictRef(red, 'failure', 'main', '800');

      const afterRed = commit('introduced by later green batch');
      const green = commit('green tip');
      verdictRef(green, 'success', 'main', '900');

      expect(plans(green)).toEqual([
        { source: green, target: afterRed },
        { source: red, target: beforeRed },
      ]);
      expect(plans(green).some((plan) => plan.target === red)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never invents coverage before the oldest provable judged-main boundary', () => {
    const { root, commit, verdictRef, plans } = fixture();
    try {
      const unknownA = commit('too old to reconstruct a');
      const unknownB = commit('too old to reconstruct b');
      const oldestKnown = commit('first known judged main');
      verdictRef(oldestKnown, 'success', 'main', '800');
      const newer = commit('new batch member');
      const head = commit('new judged tip');
      verdictRef(head, 'success', 'main', '900');

      const repaired = plans(head);
      expect(repaired).toEqual([{ source: head, target: newer }]);
      expect(repaired.some((plan) => plan.target === unknownA || plan.target === unknownB)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('repairs commits introduced by a merge from the merge tip verdict', () => {
    const { root, commit, verdictRef, plans } = fixture();
    try {
      const base = commit('known main base');
      verdictRef(base, 'success', 'main', '700');

      gitAt(root, 'checkout', '-q', '-b', 'topic');
      const sideA = commit('side a');
      const sideB = commit('side b');
      gitAt(root, 'checkout', '-q', 'main');
      gitAt(root, 'merge', '-q', '--no-ff', 'topic', '-m', 'merge topic');
      const mergeTip = gitAt(root, 'rev-parse', 'HEAD');
      verdictRef(mergeTip, 'success', 'main', '800');

      expect(plans(mergeTip)).toEqual([
        { source: mergeTip, target: sideA },
        { source: mergeTip, target: sideB },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
