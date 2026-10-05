import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * THE THING THAT RUNS BEFORE THE AGENT KNOWS ANYTHING.
 *
 * `tools/orient.mjs` runs from the SessionStart hook. It has two jobs and one
 * absolute constraint.
 *
 * The jobs: unshallow the clone, and print the claims other sessions hold. The
 * first matters because a shallow clone does not refuse ancestry questions, it
 * ANSWERS THEM WRONGLY — false for anything past the graft boundary — and the
 * wrong answer looks like the cautious one. Documenting that was tried; this
 * repository's own history is a catalogue of rules that were only asked for.
 *
 * The constraint: it must never fail a session. A broken remote, no network, no
 * git — every one of those has to end in exit 0 with the session usable, or an
 * orientation step becomes the thing that stops work. That is what most of
 * these tests are about.
 *
 * It is spawned with `process.execPath` rather than with `bash`, because this
 * suite runs on a Windows runner too and the only interpreter guaranteed to be
 * present there is the one already running the test. That is also why the
 * script it drives is no longer a shell script: an orientation step that
 * cannot start on a platform does not report it, and the session then spends
 * its whole life on a shallow clone answering ancestry questions wrongly.
 */

const ORIENT = join(import.meta.dirname, '../../../../tools/orient.mjs');

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const orient = (dir: string) => {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [ORIENT], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ed-orient-'));
  const bare = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, 'seed');
  const seed = join(root, 'seed');
  git(seed, 'config', 'user.email', 'a@example.com');
  git(seed, 'config', 'user.name', 'a');
  for (let i = 0; i < 8; i++) git(seed, 'commit', '-q', '--allow-empty', '-m', `main ${i}`);
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

  // A claim another session is holding, in the shape `agents.mjs` writes.
  const empty = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const claim = git(seed, 'commit-tree', empty, '-m', 'claim 93\n\nagent: claude/somebody-else\nlane: content\npaths: packages/content/events');
  git(seed, 'push', '-q', 'origin', `${claim}:refs/heads/claim/93`);

  git(root, 'clone', '-q', '--depth', '1', pathToFileURL(bare).href, 'work');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const pushScheduled = (cadence: 'nightly' | 'weekly' | 'outcome-reach', body: string) => {
  const seed = join(root, 'seed');
  const empty = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const verdict = git(seed, 'commit-tree', empty, '-m', body);
  git(seed, 'push', '-q', 'origin', `${verdict}:refs/scheduled/${cadence}`);
};

describe('session orientation', () => {
  it('unshallows the clone, so ancestry questions have real answers', () => {
    const work = join(root, 'work');
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('true');

    const r = orient(work);
    expect(r.code).toBe(0);
    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(Number(git(work, 'rev-list', '--count', 'HEAD'))).toBe(8);
  });

  it('names the branch and the issues other sessions are holding', () => {
    const r = orient(join(root, 'work'));
    expect(r.out).toContain('you are on:');
    expect(r.out).toContain('93');
    expect(r.out).toContain('claude/somebody-else');
  });

  it('is a no-op on a clone that is already whole', () => {
    git(root, 'clone', '-q', join(root, 'origin.git'), 'full');
    const r = orient(join(root, 'full'));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('unshallowing');
  });

  it('prints the first scheduled red SHA and refuses to call a missing cadence green', () => {
    pushScheduled('nightly', [
      'scheduled nightly failure',
      '',
      'sha: abcdef0123456789abcdef0123456789abcdef01',
      'conclusion: failure',
      'since: 1234567890abcdef1234567890abcdef12345678',
      'run: https://example.invalid/nightly',
      'recorded: 2026-10-06T00:00:00Z',
    ].join('\n'));

    const r = orient(join(root, 'work'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('nightly: red since 1234567 (failure)');
    expect(r.out).toContain('weekly: NO VERDICT — scheduled evidence has not answered yet. Not a pass.');
    expect(r.out).toContain('outcome-reach: NO VERDICT — scheduled evidence has not answered yet. Not a pass.');
  });

  it('prints the dedicated outcome-reach telemetry verdict', () => {
    pushScheduled('outcome-reach', [
      'scheduled outcome-reach success',
      '',
      'sha: 7654321fedcba9876543210',
      'conclusion: success',
      'since: ',
      'run: https://example.invalid/outcome-reach',
    ].join('\n'));

    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('outcome-reach: green on 7654321');
  });

  it('prints a successful scheduled cadence against the SHA it measured', () => {
    pushScheduled('weekly', [
      'scheduled weekly success',
      '',
      'sha: fedcba9876543210fedcba9876543210fedcba98',
      'conclusion: success',
      'since: fedcba9876543210fedcba9876543210fedcba98',
      'run: https://example.invalid/weekly',
      'recorded: 2026-10-06T00:00:00Z',
    ].join('\n'));

    const r = orient(join(root, 'work'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('weekly: green on fedcba9');
  });

  it('still exits clean when the remote is unreachable', () => {
    // The session has to start whether or not GitHub is answering. An
    // orientation step that fails a session is worse than no orientation.
    const work = join(root, 'work');
    git(work, 'remote', 'set-url', 'origin', join(root, 'no-such-repo.git'));
    const r = orient(work);
    expect(r.code).toBe(0);
    expect(r.out).toContain('COULD NOT UNSHALLOW');
    expect(r.out).toContain('Do not trust');
  });

  it('still exits clean when pointed at something that is not a git repository', () => {
    const r = orient(root);
    expect(r.code).toBe(0);
  });
});
