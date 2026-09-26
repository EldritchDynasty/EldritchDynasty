import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * THE MUTEX THAT LETS SEVERAL AGENTS SHARE THIS REPOSITORY.
 *
 * `tools/agents.mjs` is the claim tool — see docs/PARALLEL.md. It lives at the
 * repository root as plain `.mjs` rather than in this directory as TypeScript
 * because an agent runs it before it has decided whether to `npm install`, and
 * `tsx` is a dependency. The test belongs here, where the suite is.
 *
 * What is worth testing is exactly one thing: that two agents cannot both hold
 * one issue. Everything else the tool does is printing. And the failure it
 * guards is the quiet kind this codebase specialises in — two sessions working
 * the same issue for an afternoon look, from inside either one, precisely like
 * one session working it.
 *
 * So the test stands up a bare repository and two clones of it, and races them.
 * The guarantee being leaned on is git's own: a push that creates a ref which
 * already exists, carrying a commit that is not a descendant of the one there,
 * is rejected by the receiving end. The claim commits are ORPHANS, so no second
 * claim can ever be a descendant of the first, so the second push always loses.
 */

const TOOL = join(import.meta.dirname, '../../../../tools/agents.mjs');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Returns the tool's exit code and its output, because a DENIED must be both. */
const agents = (cwd: string, ...args: string[]) => {
  try {
    return { code: 0, out: execFileSync('node', [TOOL, ...args], { cwd, encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ed-agents-'));
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(root, 'init', '-q', 'alpha');
  const alpha = join(root, 'alpha');
  git(alpha, 'config', 'user.email', 'alpha@example.com');
  git(alpha, 'config', 'user.name', 'alpha');
  git(alpha, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(alpha, 'remote', 'add', 'origin', join(root, 'origin.git'));
  git(alpha, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(root, 'clone', '-q', join(root, 'origin.git'), 'beta');
  const beta = join(root, 'beta');
  git(beta, 'config', 'user.email', 'beta@example.com');
  git(beta, 'config', 'user.name', 'beta');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the claim ref', () => {
  it('gives an issue to one agent and refuses the other', () => {
    const taken = agents(join(root, 'alpha'), 'take', '101', '--agent', 'alpha', '--paths', 'packages/core/src/land.ts');
    expect(taken.code).toBe(0);
    expect(taken.out).toContain('held: 101');

    const denied = agents(join(root, 'beta'), 'take', '101', '--agent', 'beta');
    expect(denied.code).toBe(1);
    expect(denied.out).toContain('DENIED');
    expect(denied.out).toContain('alpha');
  });

  it('rejects a claim pushed straight at a ref somebody holds — the guarantee under the tool', () => {
    const beta = join(root, 'beta');
    const orphan = git(beta, 'commit-tree', EMPTY_TREE, '-m', 'claim 101\n\nagent: beta');
    expect(() => git(beta, 'push', 'origin', `${orphan}:refs/heads/claim/101`)).toThrow();
  });

  it('warns the taker when another agent has declared the same paths', () => {
    const out = agents(join(root, 'beta'), 'take', '102', '--agent', 'beta', '--paths', 'packages/core/src/land.ts');
    expect(out.code).toBe(0);
    expect(out.out).toContain('overlapping paths on 101');
  });

  it('warns when a second agent enters the content lane, where branches interact', () => {
    agents(join(root, 'alpha'), 'take', '103', '--agent', 'alpha', '--paths', 'packages/content/events');
    const out = agents(join(root, 'beta'), 'take', '104', '--agent', 'beta', '--paths', 'packages/content/ages');
    expect(out.out).toContain('CONTENT lane');
  });

  it('releases by tombstone rather than by deleting the ref, and the next agent can take it', () => {
    // Deleting would be tidier. A web session's git proxy refuses ref deletion
    // with a 403, so a release that deleted would work on a laptop and leave
    // the issue permanently held in a container.
    const released = agents(join(root, 'alpha'), 'release', '101', '--agent', 'alpha');
    expect(released.code).toBe(0);
    expect(git(join(root, 'origin.git'), 'rev-parse', '--verify', 'refs/heads/claim/101')).toMatch(/^[0-9a-f]{40}$/);

    expect(agents(join(root, 'beta'), 'list').out).not.toContain('101 ');
    const retaken = agents(join(root, 'beta'), 'take', '101', '--agent', 'beta');
    expect(retaken.code).toBe(0);
    expect(retaken.out).toContain('held: 101');
  });

  it('will not release another agent\'s claim without being told twice', () => {
    const out = agents(join(root, 'alpha'), 'release', '101', '--agent', 'alpha');
    expect(out.code).toBe(2);
    expect(out.out).toContain('held by beta');
  });

  it('refuses to steal a claim that is not stale, and takes one that is', () => {
    const fresh = agents(join(root, 'alpha'), 'steal', '101', '--agent', 'alpha');
    expect(fresh.code).toBe(2);
    expect(fresh.out).toContain('not stale yet');

    // A session that died without releasing: the claim stands, nothing renews it.
    const beta = join(root, 'beta');
    const old = new Date(Date.now() - 9 * 3600 * 1000).toISOString();
    const stale = execFileSync('git', ['commit-tree', EMPTY_TREE, '-m', 'claim 105\n\nagent: ghost\nlane: code'], {
      cwd: beta,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old },
    }).trim();
    git(beta, 'push', '-q', 'origin', `${stale}:refs/heads/claim/105`);

    const stolen = agents(join(root, 'alpha'), 'steal', '105', '--agent', 'alpha');
    expect(stolen.code).toBe(0);
    expect(stolen.out).toContain('stolen: 105');
  });

  it('spells out the closing keywords for every issue one branch is holding', () => {
    // A branch lands as many issues as it claimed, and GitHub needs the keyword
    // before EACH number: `Closes #12, closes #13` closes both, `Closes #12,
    // #13` closes only #12. That rule is discovered by finding the second issue
    // still open a week later, so the tool writes the line out.
    agents(join(root, 'alpha'), 'take', '200', '--agent', 'epic');
    const second = agents(join(root, 'alpha'), 'take', '201', '--agent', 'epic');
    expect(second.out).toContain('Closes #200, closes #201');

    const checked = agents(join(root, 'alpha'), 'check', '--agent', 'epic');
    expect(checked.out).toContain('landing commit needs: Closes #200, closes #201');
  });

  /**
   * WIDENING A CLAIM USED TO DO NOTHING, AND `check` THEN SAID "ALL CLEAR".
   *
   * `take` returned early whenever `--renew` was absent, discarding the
   * `--paths` it had just parsed. An agent that started narrow, found the
   * change reached further, and re-ran `take` with the wider set was told
   * "already yours" while the ref kept the old list — and `check`, comparing
   * against that list, answered "none overlapping yours".
   *
   * That is not "no overlap". It is "no overlap with what you declared when
   * you started", and the sentence said neither. It is how the session that
   * wrote this edited CLAUDE.md while another session held it, six minutes
   * after being told nothing overlapped; both then raised the same constant in
   * the same file and both comments began "RAISED ONCE".
   *
   * The assertion is deliberately the SECOND agent's view. Whether the ref was
   * rewritten is an implementation detail; whether the other clone can see the
   * wider claim is the whole purpose of declaring paths at all.
   */
  it('widens a claim in place, so the other clone can see the new paths', () => {
    const alpha = join(root, 'alpha');
    const beta = join(root, 'beta');
    agents(alpha, 'take', '140', '--agent', 'alpha', '--paths', 'packages/core/src/narrow.ts');

    // Beta is nowhere near it yet.
    const before = agents(beta, 'take', '141', '--agent', 'beta', '--paths', 'CLAUDE.md');
    expect(before.out).not.toContain('CLAUDE.md');

    // Alpha discovers the change reaches CLAUDE.md and says so. No --renew:
    // renewing the clock and widening the paths are the same write.
    const widened = agents(alpha, 'take', '140', '--agent', 'alpha',
      '--paths', 'packages/core/src/narrow.ts,CLAUDE.md');
    expect(widened.code).toBe(0);
    expect(widened.out).toContain('widened');
    expect(widened.out).toContain('CLAUDE.md');

    // The point: beta now sees it, from the ref, without asking alpha.
    const after = agents(beta, 'check', '--agent', 'beta');
    expect(after.out).toContain('CLAUDE.md');
    expect(after.code).toBe(1);
  });

  it('says how many paths an all-clear was clear over', () => {
    // "None overlapping yours" over a stale list is a confident wrong answer,
    // and the count is what makes it checkable by whoever reads it.
    //
    // Its own agent and its own path, because the fixture above is deliberately
    // full of overlaps and an all-clear cannot be asserted from inside one.
    agents(join(root, 'alpha'), 'take', '150', '--agent', 'gamma',
      '--paths', 'packages/core/src/nobody-else-is-here.ts');
    const out = agents(join(root, 'alpha'), 'check', '--agent', 'gamma').out;
    expect(out).toMatch(/none overlapping the \d+ path\(s\)/);
  });

  it('reports an overlap from check, and says so in its exit code', () => {
    // `check` is what an agent runs before the nine-minute check, to find out
    // whether somebody landed in its paths while it worked.
    const out = agents(join(root, 'beta'), 'check', '--agent', 'beta');
    expect(out.code).toBe(1);
    expect(out.out).toMatch(/same paths|CONTENT lane/);
  });
});


/**
 * CONNECTOR-ONLY CLAIMS USE A REMOTE SHELL, NOT A SECOND LOCK.
 *
 * The bare-repository race above remains the mutex proof. These tests pin the
 * smaller promise added by #205: issue-comment syntax is strict, authorization
 * is explicit, and the transport delegates every state change to agents.mjs.
 */
describe('the connector-only remote claim transport', () => {
  const remoteTool = join(import.meta.dirname, '../../../../tools/remote-claim.mjs');
  const remoteWorkflow = join(import.meta.dirname, '../../../../.github/workflows/remote-claim.yml');

  const module = async () => await import(pathToFileURL(remoteTool).href) as {
    parseClaimRequest: (raw: string) => Record<string, string | undefined>;
    argsFor: (request: Record<string, string | undefined>) => string[];
  };

  it('parses the three explicit commands into agents.mjs arguments', async () => {
    const { parseClaimRequest, argsFor } = await module();

    const take = parseClaimRequest(
      '/claim 205 --agent chatgpt/issue-205-remote-claim --paths tools/remote-claim.mjs,.github/workflows --lane gates',
    );
    expect(take).toEqual({
      command: 'take',
      issue: '205',
      agent: 'chatgpt/issue-205-remote-claim',
      paths: 'tools/remote-claim.mjs,.github/workflows',
      lane: 'gates',
    });
    expect(argsFor(take)).toEqual([
      'take', '205',
      '--agent', 'chatgpt/issue-205-remote-claim',
      '--paths', 'tools/remote-claim.mjs,.github/workflows',
      '--lane', 'gates',
    ]);

    const check = parseClaimRequest('/claim check --agent chatgpt/issue-205-remote-claim');
    expect(argsFor(check)).toEqual([
      'check', '--agent', 'chatgpt/issue-205-remote-claim',
    ]);

    const release = parseClaimRequest(
      '/claim release 205 --agent chatgpt/issue-205-remote-claim',
    );
    expect(argsFor(release)).toEqual([
      'release', '205', '--agent', 'chatgpt/issue-205-remote-claim',
    ]);
  });

  it.each([
    '/claim',
    '/claim 0 --agent branch --paths tools',
    '/claim 205 --paths tools --agent branch',
    '/claim 205 --agent main --paths tools',
    '/claim 205 --agent claim/205 --paths tools',
    '/claim 205 --agent branch --paths ../outside',
    '/claim 205 --agent branch --paths tools --extra nope',
    '/claim check --agent branch trailing',
    '/claim release nope --agent branch',
  ])('rejects malformed or unsafe request %s', async (raw) => {
    const { parseClaimRequest } = await module();
    expect(() => parseClaimRequest(raw)).toThrow(/Expected one of:/);
  });

  it('authorizes write collaborators and executes trusted main with full history', () => {
    const text = readFileSync(remoteWorkflow, 'utf8');
    expect(text).toContain('issue_comment:');
    expect(text).toContain("github.event.comment.body == '/claim'");
    expect(text).toContain("startsWith(github.event.comment.body, '/claim ')");
    expect(text).toContain('getCollaboratorPermissionLevel');
    expect(text).toContain("['admin', 'maintain', 'write']");
    expect(text).toContain('contents: write');
    expect(text).toContain('ref: main');
    expect(text).toContain('fetch-depth: 0');
    expect(text, 'pull_request_target would execute untrusted PR code with a write token')
      .not.toContain('pull_request_target:');
  });

  it('delegates claim state to agents.mjs instead of recreating its ref protocol', () => {
    const transport = readFileSync(remoteTool, 'utf8');
    const workflow = readFileSync(remoteWorkflow, 'utf8');

    expect(transport).toContain("join(import.meta.dirname, 'agents.mjs')");
    expect(transport).toContain('spawnSync(process.execPath, [AGENTS, ...args]');
    expect(workflow).toContain('run: node tools/remote-claim.mjs');

    for (const text of [transport, workflow]) {
      expect(text).not.toContain('commit-tree');
      expect(text).not.toContain('refs/heads/claim/');
      expect(text).not.toContain('--force-with-lease');
    }
  });

  it('passes a DENIED exit through and leaves the tool output in the Actions summary', () => {
    const transport = readFileSync(remoteTool, 'utf8');
    expect(transport).toContain('process.exitCode = child.status ?? 1');
    expect(transport).toContain('GITHUB_STEP_SUMMARY');
    expect(transport).toContain("child.status === 0 ? 'Remote claim' : 'Remote claim — failed'");
  });
});
