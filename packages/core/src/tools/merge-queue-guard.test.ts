import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const tool = (await import(pathToFileURL(join(import.meta.dirname, '../../../../tools/merge-queue-guard.mjs')).href)) as {
  groupPrNumber: (branch: string) => number | undefined;
  lastGroupVerdict: (number: number, runs: unknown[]) => { id: number; conclusion: string } | undefined;
  admissionDecision: (number: number, at: string, runs: unknown[]) => { allowed: boolean; run?: number };
  checkAdmission: (args: { repo: string; prNumber: number; greenAt: string; token: string;
    request: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> }) => Promise<{ allowed: boolean }>;
};

const green = '2026-11-04T03:00:00Z';
const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number, parents = [sha(n - 1)]) => ({
  sha: sha(n), parents: parents.map(sha => ({ sha })),
});
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
type Request = Parameters<typeof tool.checkAdmission>[0]['request'];
const admit = (request: Request) => tool.checkAdmission({
  repo: 'owner/repo', prNumber: 123, greenAt: green, token: 'test-token', request,
});
/** Existing red-verdict tests all describe an otherwise linear eligible PR. */
const withLinearHistory = (history: Request): Request => async url => {
  if (url.endsWith('/pulls/123')) return response({ base: { sha: sha(0) }, head: { sha: sha(1) } });
  if (url.includes('/compare/')) return response({ total_commits: 1, commits: [commit(1)] });
  return history(url);
};
const group = (id: number, pr: number, conclusion: string, updated_at: string, status = 'completed') => ({
  id, event: 'merge_group', status, conclusion, updated_at,
  created_at: '2026-11-04T03:05:00Z',
  head_branch: 'gh-readonly-queue/main/pr-' + pr + '-0123456789abcdef',
});

describe('native queue red-merge-group admission guard (#2806)', () => {
  it('recognises exact PR numbers and rejects similar or unrelated refs', () => {
    expect(tool.groupPrNumber('gh-readonly-queue/main/pr-12-abc123')).toBe(12);
    expect(tool.groupPrNumber('gh-readonly-queue/main/pr-123-abc123')).toBe(123);
    expect(tool.groupPrNumber('gh-readonly-queue/main/pr-12-branch')).toBeUndefined();
    expect(tool.groupPrNumber('ordinary-feature-branch')).toBeUndefined();
  });

  it('blocks only a terminal integration failure later than the green exact-head result', () => {
    const failed = group(51, 123, 'failure', '2026-11-04T03:30:00Z');
    expect(tool.admissionDecision(123, green, [failed])).toEqual({
      allowed: false, reason: expect.any(String), run: 51,
    });
    expect(tool.admissionDecision(12, green, [failed]).allowed).toBe(true);
    expect(tool.admissionDecision(123, '2026-11-04T03:31:00Z', [failed]).allowed).toBe(true);
    expect(tool.admissionDecision(123, green, [group(52, 123, 'timed_out', '2026-11-04T03:31:00Z')]).allowed).toBe(false);
  });

  it('respects the newest terminal verdict and ignores cancelled runs', () => {
    const failed = group(51, 123, 'failure', '2026-11-04T03:30:00Z');
    const cancelled = group(52, 123, 'cancelled', '2026-11-04T03:40:00Z');
    const success = group(53, 123, 'success', '2026-11-04T03:50:00Z');
    expect(tool.admissionDecision(123, green, [cancelled, failed]).allowed).toBe(false);
    expect(tool.admissionDecision(123, green, [failed, success]).allowed).toBe(true);
  });

  it('paginates back before the green result and finds a failure from an older page', async () => {
    let pages = 0;
    const response = (workflow_runs: unknown[]) => ({
      ok: true, status: 200, json: async () => ({ workflow_runs }),
    });
    const request = async () => {
      pages++;
      if (pages === 1) return response(Array.from({ length: 100 }, (_, i) =>
        group(200 - i, 900, 'success', '2026-11-04T03:40:00Z')));
      return response([group(50, 123, 'failure', '2026-11-04T03:31:00Z')]);
    };
    const result = await tool.checkAdmission({ repo: 'owner/repo', prNumber: 123,
      greenAt: green, token: 'test-token', request: withLinearHistory(request) });
    expect(result.allowed).toBe(false);
    expect(pages).toBe(2);
  });

  it('wires the guard into both native queue admission paths, never the private fast-forward', () => {
    const workflow = readFileSync(join(import.meta.dirname, '../../../../.github/workflows/auto-merge-queue.yml'), 'utf8');
    expect(workflow).toContain('id: queue-guard');
    expect(workflow).toContain("steps.queue-guard.outputs.allowed == 'true'");
    expect(workflow).toMatch(/reconcile-after-main:[\s\S]*node tools\/merge-queue-guard\.mjs/);
    expect(workflow).toMatch(/Check out the trusted native queue guard[\s\S]*ref: main/);
    expect(workflow).toMatch(/sweep-after-main:[\s\S]*run: node tools\/fast-forward-landing\.mjs sweep/);
  });

  it('fails closed on an API error instead of treating an incomplete scan as green', async () => {
    await expect(tool.checkAdmission({ repo: 'owner/repo', prNumber: 123,
      greenAt: green, token: 'test-token', request: async () => ({ ok: false, status: 403,
        json: async () => ({}) }) })).rejects.toThrow('HTTP 403');
    expect(() => tool.admissionDecision(123, '', [])).toThrow('timestamp');
  });
});

describe('native REBASE linear-history admission guard (#3016)', () => {
  it.each([
    { head: 2, position: 'at the head' },
    { head: 3, position: 'before a single-parent head' },
  ])('refuses a merge commit $position', async ({ head }) => {
    const calls: string[] = [];
    const result = await admit(async url => {
      calls.push(url);
      if (url.endsWith('/pulls/123')) return response({ base: { sha: sha(0) }, head: { sha: sha(head) } });
      return response({ total_commits: head, commits: [
        commit(1), commit(2, [sha(1), sha(0)]), ...(head === 3 ? [commit(3)] : []),
      ] });
    });
    expect(result).toEqual({ allowed: false, reason: expect.stringContaining(sha(2)) });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('/compare/' + sha(0) + '...' + sha(head));
  });

  it('inspects a 251-commit linear topic across pinned comparison pages before reading CI history', async () => {
    const commits = Array.from({ length: 251 }, (_, i) => commit(i + 1));
    const calls: string[] = [];
    const result = await admit(async url => {
      calls.push(url);
      if (url.endsWith('/pulls/123')) return response({ base: { sha: sha(0) }, head: { sha: sha(251) } });
      if (url.includes('/compare/')) {
        const page = Number(new URL(url).searchParams.get('page'));
        return response({ total_commits: commits.length, commits: commits.slice((page - 1) * 100, page * 100) });
      }
      return response({ workflow_runs: [] });
    });
    expect(result.allowed).toBe(true);
    expect(calls.filter(url => url.includes('/compare/'))).toEqual([1, 2, 3].map(page =>
      'https://api.github.com/repos/owner/repo/compare/' + sha(0) + '...' + sha(251) + '?per_page=100&page=' + page));
    expect(calls.at(-1)).toContain('/actions/workflows/check.yml/runs');
  });

  it('finds an interior merge on a later comparison page', async () => {
    const commits = Array.from({ length: 102 }, (_, i) => commit(i + 1));
    commits[100] = commit(101, [sha(100), sha(1)]);
    const result = await admit(async url => {
      if (url.endsWith('/pulls/123')) return response({ base: { sha: sha(0) }, head: { sha: sha(102) } });
      const page = Number(new URL(url).searchParams.get('page'));
      return response({ total_commits: commits.length, commits: commits.slice((page - 1) * 100, page * 100) });
    });
    expect(result).toEqual({ allowed: false, reason: expect.stringContaining(sha(101)) });
  });

  it.each([
    { total_commits: 1, commits: [] },
    { total_commits: 2, commits: [commit(1)] },
    { total_commits: 1, commits: [{ sha: sha(1) }] },
    { total_commits: 1, commits: [{ sha: sha(1), parents: [] }] },
    { total_commits: 1, commits: [commit(1, ['invalid'])] },
    { total_commits: 2, commits: [commit(1), commit(1)] },
    { total_commits: 2, commits: [commit(1), commit(2, [sha(0)])] },
    { total_commits: 1, commits: [commit(2)] },
    { total_commits: 0, commits: [] },
  ])('fails closed on incomplete or malformed topic history: %j', async comparison => {
    await expect(admit(async url => url.endsWith('/pulls/123')
      ? response({ base: { sha: sha(0) }, head: { sha: sha(1) } })
      : response(comparison))).rejects.toThrow(/topic/i);
  });

  it('does not admit a PR when its comparison cannot be read', async () => {
    await expect(admit(async url => url.endsWith('/pulls/123')
      ? response({ base: { sha: sha(0) }, head: { sha: sha(1) } })
      : { ok: false, status: 403, json: async () => ({}) })).rejects.toThrow('Cannot read topic history (HTTP 403)');
  });
});
