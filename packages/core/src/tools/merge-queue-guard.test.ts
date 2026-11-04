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
      greenAt: green, token: 'test-token', request });
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
