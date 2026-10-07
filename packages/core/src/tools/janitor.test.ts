import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * THE SWEEP, AND THE CLONE THAT MAKES IT LIE.
 *
 * `tools/janitor.mjs` deletes branches whose head is already an ancestor of
 * main. The first time it ran for real it deleted every branch on the remote,
 * and the reason took a truth table to find: an agent's container clones
 * SHALLOW — 59 commits of a 141-commit history — and `git merge-base
 * --is-ancestor` cannot walk past the graft boundary. It does not error there.
 * It answers FALSE, for every branch older than the shallow window, silently.
 *
 * So the same script over the same refs said "7 merged, 29 kept" in the
 * container and "36 merged" on a runner with fetch-depth: 0, and the second one
 * was right. A wrong answer that looks like a cautious answer is the worst
 * shape a check can have, and this repository is full of the same lesson:
 * nothing throws, so the failure is always something quietly not happening.
 *
 * These tests pin the three things that matter: it refuses on a shallow clone,
 * it is correct on a full one, and it pauses before a MASS deletion — a count,
 * not a share, since a repository that fast-forwards without pull requests has
 * "nearly every branch merged" as its normal state rather than its alarm.
 */

const TOOL = join(import.meta.dirname, '../../../../tools/janitor.mjs');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gitWithEnv = (cwd: string, env: Record<string, string>, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();

const janitor = (cwd: string, env: Record<string, string> = {}) => {
  try {
    const out = execFileSync(process.execPath, [TOOL], {
      cwd,
      encoding: 'utf8',
      // A real file rather than `/dev/null`, which is a path on one of the two
      // platforms this suite runs on. The summary is written, read by nobody,
      // and thrown away with the fixture — what these tests read is stdout.
      env: { ...process.env, GITHUB_STEP_SUMMARY: join(root, 'summary.md'), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

const branches = (bare: string) =>
  git(bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').sort();


function rebasedFixture(withClaim = false) {
  const fixture = mkdtempSync(join(tmpdir(), 'ed-janitor-rebased-'));
  const bare = join(fixture, 'origin.git');
  git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
  git(fixture, 'clone', '-q', bare, 'seed');
  const seed = join(fixture, 'seed');
  git(seed, 'config', 'user.email', 'a@example.com');
  git(seed, 'config', 'user.name', 'a');
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

  const agent = 'chatgpt/rebased-landing';
  git(seed, 'checkout', '-q', '-b', agent);
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'reviewed source head');
  const head = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);

  if (withClaim) {
    const claim = git(seed, 'commit-tree', EMPTY_TREE, '-m',
      `claim 528\n\nagent: ${agent}\nlane: code\npath: tools/janitor.mjs`);
    git(seed, 'push', '-q', 'origin', `${claim}:refs/heads/claim/528`);
  }

  // Native queue's REBASE result has a different commit identity on main, so
  // the reviewed source head remains ahead of and behind main.
  git(seed, 'checkout', '-q', 'main');
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'rebased queue landing');
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

  git(fixture, 'clone', '-q', bare, 'sweep');
  return { fixture, sweep: join(fixture, 'sweep'), agent, head };
}

const prEvidence = (
  agent: string,
  head: string,
  overrides: {
    merged_at?: string | null;
    baseRef?: string;
    baseRepo?: string;
    headRepo?: string;
  } = {},
) => ({
  number: 900,
  merged_at: overrides.merged_at === undefined ? '2026-10-06T17:00:00Z' : overrides.merged_at,
  base: {
    ref: overrides.baseRef ?? 'main',
    repo: { full_name: overrides.baseRepo ?? 'acme/repo' },
  },
  head: {
    ref: agent,
    sha: head,
    repo: { full_name: overrides.headRepo ?? 'acme/repo' },
  },
});

const withPrEvidence = (prs: unknown[]) => ({
  DRY_RUN: '1',
  JANITOR_RECONCILE_MERGED_PRS: '1',
  GITHUB_REPOSITORY: 'acme/repo',
  JANITOR_DEFAULT_BRANCH: 'main',
  JANITOR_MERGED_PRS_JSON: JSON.stringify(prs),
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ed-janitor-'));
  const bare = join(root, 'origin.git');
  // `-b main`: a bare repo whose HEAD names a branch that never gets created
  // clones as an empty repository, and the fixture then proves nothing.
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, 'seed');
  const seed = join(root, 'seed');
  git(seed, 'config', 'user.email', 'a@example.com');
  git(seed, 'config', 'user.name', 'a');

  // A history deep enough that a --depth 1 clone cannot see the bottom of it.
  for (let i = 0; i < 12; i++) git(seed, 'commit', '-q', '--allow-empty', '-m', `main ${i}`);
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

  // `landed` is an old commit ON main's own history: genuinely merged, and old
  // enough to sit outside a shallow window. This is the branch the shallow
  // clone gets wrong.
  git(seed, 'push', '-q', 'origin', `${git(seed, 'rev-parse', 'HEAD~8')}:refs/heads/claude/landed`);
  git(seed, 'checkout', '-q', '-b', 'claude/in-flight');
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'work nobody has merged');
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/in-flight');

  git(root, 'clone', '-q', bare, 'full');
  // file://, because `--depth` is ignored for a plain local path — and built
  // with `pathToFileURL` rather than spelled, because `file://C:\\Users\\...` is
  // not a URL and this fixture runs on a Windows runner too.
  git(root, 'clone', '-q', '--depth', '1', pathToFileURL(bare).href, 'shallow');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the janitor', () => {
  it('refuses to run on a shallow clone rather than answering wrongly', () => {
    const shallow = join(root, 'shallow');
    expect(git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true');

    const r = janitor(shallow, { DRY_RUN: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toContain('shallow');
    // The point of the guard: on this clone the merged branch reads as unmerged,
    // so every answer it could give would be wrong in one direction or the other.
    expect(r.out).not.toContain('decide claude/landed');
  });

  it('leaves every branch alone when it refuses', () => {
    const before = branches(join(root, 'origin.git'));
    janitor(join(root, 'shallow'));
    expect(branches(join(root, 'origin.git'))).toEqual(before);
  });

  it('tells merged from unmerged on a full clone', () => {
    const r = janitor(join(root, 'full'), { DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/decide claude\/landed:.*MERGED/);
    expect(r.out).toMatch(/decide claude\/in-flight:.*keep/);
    expect(r.out).toContain('would: git push origin --delete claude/landed');
    expect(r.out).not.toContain('delete claude/in-flight');
  });

  /**
   * THE CEILING IS A COUNT NOW, AND THAT IS THE WHOLE FIX.
   *
   * It used to be a SHARE — pause if more than 60% of branches read as merged
   * — and it refused every run from #21 to #23, deleting nothing for days:
   *
   *   decide claude/ai-agent-effectiveness-plan-8pzjrr: MERGED · behind 12 ahead 0
   *   ... 9 of 9 ...
   *   REFUSED: 9/9 doomed, over 60%
   *
   * All nine were genuinely merged. This repository fast-forwards without pull
   * requests, so every branch that lands ends up merged and "nearly all of
   * them are merged" is the NORMAL steady state, not an alarm. A share ceiling
   * refuses hardest exactly when it has the most legitimate work to do, and a
   * guard that always fires is one somebody raises without looking — which is
   * worse than no guard.
   *
   * What it was protecting against was a MASS DELETION, and a mass deletion is
   * a number of branches rather than a proportion of them.
   */
  /**
   * The workflow supplies a real push's before..after range through the
   * environment. Treat it as hostile input anyway: only two full SHAs joined
   * by `..` may reach `git log`, or an option-shaped string could become a
   * command-line argument rather than a revision range.
   */
  it('reads an explicit range of two SHAs, and nothing else', () => {
    const full = join(root, 'full');
    const range = `${git(full, 'rev-parse', 'origin/main~2')}..${git(full, 'rev-parse', 'origin/main')}`;
    // An empty summary path sends `say()` to stdout, where this can read it.
    const named = janitor(full, { DRY_RUN: '1', GITHUB_STEP_SUMMARY: '', JANITOR_RANGE: range });
    expect(named.code).toBe(0);
    expect(named.out).toContain('### Issues named by this push');

    for (const bad of ['', 'main~2..main', `--output=${join(root, 'x')}`, `${range}; echo`]) {
      const r = janitor(full, { DRY_RUN: '1', GITHUB_STEP_SUMMARY: '', JANITOR_RANGE: bad });
      expect(r.code, bad).toBe(0);
      expect(r.out, bad).not.toContain('### Issues named by this push');
    }
  });

  it('sweeps a backlog where nearly every branch is legitimately merged', () => {
    const r = janitor(join(root, 'full'), { DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('would: git push origin --delete claude/landed');
    expect(r.out).not.toContain('REFUSED');
  });


  /**
   * GitHub can delete a merged PR branch before the scheduled janitor fetches
   * refs. The old sweep then had no ordinary branch to put in MERGED, so a
   * named lane claim survived even though the numeric claim beside it had
   * landed. #177 left lane-content locked this way until it was force-released.
   */
  it('retires a named lane when merge -> branch deletion happens before the sweep', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ed-janitor-deleted-first-'));
    try {
      const bare = join(fixture, 'origin.git');
      git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
      git(fixture, 'clone', '-q', bare, 'seed');
      const seed = join(fixture, 'seed');
      git(seed, 'config', 'user.email', 'a@example.com');
      git(seed, 'config', 'user.name', 'a');
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'base');
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

      const agent = 'chatgpt/issue-177-short-line-signing';

      // Claims come first in a real session. The landing commit must be newer
      // than them; an older `Closes #177` is not evidence that THIS claim landed.
      const issueClaim = git(seed, 'commit-tree', EMPTY_TREE, '-m',
        `claim 177\n\nagent: ${agent}\nlane: content\npaths: packages/content/prologue.yaml`);
      git(seed, 'push', '-q', 'origin', `${issueClaim}:refs/heads/claim/177`);
      const laneClaim = git(seed, 'commit-tree', EMPTY_TREE, '-m',
        `claim lane-content\n\nagent: ${agent}\nlane: content\npaths: packages/content/prologue.yaml`);
      git(seed, 'push', '-q', 'origin', `${laneClaim}:refs/heads/claim/lane-content`);

      git(seed, 'checkout', '-q', '-b', agent);
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'fix(#177): signing term', '-m', 'Closes #177');
      git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);

      // The ordering from #181: land, then GitHub removes the ordinary branch,
      // THEN janitor gets its first look at the refs.
      git(seed, 'checkout', '-q', 'main');
      git(seed, 'merge', '-q', '--ff-only', agent);
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
      git(seed, 'push', '-q', 'origin', '--delete', agent);

      git(fixture, 'clone', '-q', bare, 'sweep');
      const r = janitor(join(fixture, 'sweep'), { DRY_RUN: '1' });

      expect(r.code).toBe(0);
      // `say()` goes to GITHUB_STEP_SUMMARY in this fixture; stdout carries
      // the action itself, which is the contract that used to be missing.
      expect(r.out).toContain('would: git push origin --delete claim/lane-content');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('keeps a named lane when its ordinary branch is still active', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ed-janitor-live-lane-'));
    try {
      const bare = join(fixture, 'origin.git');
      git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
      git(fixture, 'clone', '-q', bare, 'seed');
      const seed = join(fixture, 'seed');
      git(seed, 'config', 'user.email', 'a@example.com');
      git(seed, 'config', 'user.name', 'a');
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'base');
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'earlier work', '-m', 'Closes #177');
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

      const agent = 'chatgpt/still-working';
      git(seed, 'checkout', '-q', '-b', agent);
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'new work not landed');
      git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);

      const issueClaim = git(seed, 'commit-tree', EMPTY_TREE, '-m',
        `claim 177\n\nagent: ${agent}\nlane: content\npaths: packages/content/prologue.yaml`);
      git(seed, 'push', '-q', 'origin', `${issueClaim}:refs/heads/claim/177`);
      const laneClaim = git(seed, 'commit-tree', EMPTY_TREE, '-m',
        `claim lane-content\n\nagent: ${agent}\nlane: content\npaths: packages/content/prologue.yaml`);
      git(seed, 'push', '-q', 'origin', `${laneClaim}:refs/heads/claim/lane-content`);

      git(fixture, 'clone', '-q', bare, 'sweep');
      const r = janitor(join(fixture, 'sweep'), { DRY_RUN: '1' });

      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${agent.replaceAll('/', '\\/')}:.*keep`));
      expect(r.out).not.toContain('would: git push origin --delete claim/lane-content');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('keeps a branch at main when its active claim was taken after that tip', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ed-janitor-fresh-claim-'));
    try {
      const bare = join(fixture, 'origin.git');
      git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
      git(fixture, 'clone', '-q', bare, 'seed');
      const seed = join(fixture, 'seed');
      git(seed, 'config', 'user.email', 'a@example.com');
      git(seed, 'config', 'user.name', 'a');
      const atBase = { GIT_AUTHOR_DATE: '2026-10-07T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:00:00Z' };
      gitWithEnv(seed, atBase, 'commit', '-q', '--allow-empty', '-m', 'base');
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

      const agent = 'chatgpt/fresh-claim';
      git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);
      const claim = gitWithEnv(
        seed,
        { GIT_AUTHOR_DATE: '2026-10-07T00:01:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:01:00Z' },
        'commit-tree', EMPTY_TREE, '-m',
        `claim 538\n\nagent: ${agent}\nlane: code\npath: tools/janitor.mjs\ntaken: 2026-10-07T00:01:00.000Z`,
      );
      git(seed, 'push', '-q', 'origin', `${claim}:refs/heads/claim/538`);

      git(fixture, 'clone', '-q', bare, 'sweep');
      const r = janitor(join(fixture, 'sweep'), { DRY_RUN: '1' });

      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${agent}:.*keep.*active claim newer than branch tip`));
      expect(r.out).not.toContain(`delete ${agent}`);
      expect(r.out).not.toContain('delete claim/538');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('retires a claimed branch once a post-claim work commit lands by ancestry', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ed-janitor-post-claim-landed-'));
    try {
      const bare = join(fixture, 'origin.git');
      git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
      git(fixture, 'clone', '-q', bare, 'seed');
      const seed = join(fixture, 'seed');
      git(seed, 'config', 'user.email', 'a@example.com');
      git(seed, 'config', 'user.name', 'a');
      const atBase = { GIT_AUTHOR_DATE: '2026-10-07T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:00:00Z' };
      gitWithEnv(seed, atBase, 'commit', '-q', '--allow-empty', '-m', 'base');
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

      const agent = 'chatgpt/post-claim-landed';
      git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);
      const claim = gitWithEnv(
        seed,
        { GIT_AUTHOR_DATE: '2026-10-07T00:01:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:01:00Z' },
        'commit-tree', EMPTY_TREE, '-m',
        `claim 538\n\nagent: ${agent}\nlane: code\npath: tools/janitor.mjs\ntaken: 2026-10-07T00:01:00.000Z`,
      );
      git(seed, 'push', '-q', 'origin', `${claim}:refs/heads/claim/538`);

      git(seed, 'checkout', '-q', agent);
      gitWithEnv(
        seed,
        { GIT_AUTHOR_DATE: '2026-10-07T00:02:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:02:00Z' },
        'commit', '-q', '--allow-empty', '-m', 'fix(#538): janitor evidence', '-m', 'Closes #538',
      );
      git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${agent}`);
      git(seed, 'checkout', '-q', 'main');
      git(seed, 'merge', '-q', '--ff-only', agent);
      git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

      git(fixture, 'clone', '-q', bare, 'sweep');
      const r = janitor(join(fixture, 'sweep'), { DRY_RUN: '1' });

      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${agent}:.*MERGED`));
      expect(r.out).toContain(`would: git push origin --delete ${agent}`);
      expect(r.out).toContain('would: git push origin --delete claim/538');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('projects paginated PR evidence through one composable jq pipeline', () => {
    const source = readFileSync(TOOL, 'utf8');
    expect(source).toContain("'api', '--paginate',");
    expect(source).toContain("'--jq', projection,");
    expect(source).not.toContain("'api', '--paginate', '--slurp'");
    expect(source).toContain("'.[]',\n    '| select(.merged_at != null)',");
    expect(source).toContain("'| [.number, .merged_at, .base.ref, .base.repo.full_name,'");
    expect(source).toContain("'| @tsv',");
    expect(source).toContain("r.error?.message || (r.stderr ?? '').trim()");
  });

  it('retires a rebased merge-queue branch and its claim from exact PR head evidence', () => {
    const f = rebasedFixture(true);
    try {
      const r = janitor(f.sweep, withPrEvidence([prEvidence(f.agent, f.head)]));
      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${f.agent}:.*MERGED.*merged PR #900 exact head`));
      expect(r.out).toContain(`would: git push origin --delete ${f.agent}`);
      expect(r.out).toContain('would: git push origin --delete claim/528');
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  });

  it('keeps a reused branch when the merged PR names an older head SHA', () => {
    const f = rebasedFixture();
    try {
      const older = git(f.sweep, 'rev-parse', 'origin/main~1');
      const r = janitor(f.sweep, withPrEvidence([prEvidence(f.agent, older)]));
      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${f.agent}:.*keep`));
      expect(r.out).not.toContain(`delete ${f.agent}`);
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  });

  it('keeps a branch when the matching PR was closed without merging', () => {
    const f = rebasedFixture();
    try {
      const r = janitor(f.sweep, withPrEvidence([
        prEvidence(f.agent, f.head, { merged_at: null }),
      ]));
      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`decide ${f.agent}:.*keep`));
      expect(r.out).not.toContain(`delete ${f.agent}`);
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  });

  it('keeps exact-head PR evidence from another base or repository', () => {
    for (const overrides of [
      { baseRef: 'release' },
      { baseRepo: 'elsewhere/repo' },
      { headRepo: 'elsewhere/repo' },
    ]) {
      const f = rebasedFixture();
      try {
        const r = janitor(f.sweep, withPrEvidence([prEvidence(f.agent, f.head, overrides)]));
        expect(r.code, JSON.stringify(overrides)).toBe(0);
        expect(r.out, JSON.stringify(overrides)).toMatch(
          new RegExp(`decide ${f.agent}:.*keep`),
        );
        expect(r.out, JSON.stringify(overrides)).not.toContain(`delete ${f.agent}`);
      } finally {
        rmSync(f.fixture, { recursive: true, force: true });
      }
    }
  });

  it('still pauses on a mass deletion, which is what the guard was ever for', () => {
    const r = janitor(join(root, 'full'), { DRY_RUN: '1', JANITOR_MAX_DELETE: '0' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('REFUSED');
    expect(r.out).not.toContain('would: git push origin --delete');
  });
});
