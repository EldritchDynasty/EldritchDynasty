import { describe, expect, it } from 'vitest';
// The reporter is a standalone cross-platform Node CLI, intentionally .mjs.
// @ts-ignore -- no declaration file for the standalone Node entrypoint
import { timestamp, summarizeMergeGroups, fetchMergeGroupRuns, formatMergeGroups, summarizePrFlow, fetchPullRequests, formatPrFlow } from '../../../../tools/queue-throughput.mjs';

type Run = {
  id: number; event: string; name: string; created_at: string;
  run_started_at: string | null; updated_at: string | null;
  status: string; conclusion: string | null;
};
const from = '2026-11-06T01:00:00Z';
const to = '2026-11-07T01:00:00Z';
const now = Date.parse('2026-11-08T00:00:00Z');
const run = (id: number, created_at: string, overrides: Partial<Run> = {}): Run => ({
  id, event: 'merge_group', name: 'check', created_at,
  run_started_at: '2026-11-06T01:10:00Z',
  updated_at: '2026-11-06T01:20:00Z',
  status: 'completed', conclusion: 'success', ...overrides,
});

describe('queue throughput evidence (#2794)', () => {
  it('requires exact UTC timestamps and a non-empty half-open window', () => {
    expect(timestamp(from)).toBe(Date.parse(from));
    for (const bad of ['2026-11-06', '2026-11-06T01:00:00+13:00', '2026-02-30T01:00:00Z', 'bogus']) {
      expect(() => timestamp(bad)).toThrow();
    }
    expect(() => summarizeMergeGroups([], { from: to, to: from })).toThrow(/later/);
  });

  it('filters workflow and event, and uses created_at for window inclusion', () => {
    const rows = [
      run(1, from), run(2, to), run(3, '2026-11-05T23:59:59Z'),
      run(4, '2026-11-06T02:00:00Z', { event: 'push' }),
      run(5, '2026-11-06T02:00:00Z', { name: 'verdict' }),
      run(6, '2026-11-06T23:59:59Z'),
    ];
    const s = summarizeMergeGroups(rows, { from, to, now, source: 'api' });
    expect(s.runs.map((x: { id: number }) => x.id)).toEqual([1, 6]);
    expect(s.groups).toBe(2);
    expect(s.successful).toBe(2);
    expect(s.complete).toBe(true);
    expect(s.measuresPrArrivalOrLanding).toBe(false);
  });

  it('does not treat cancellation or unfinished work as success', () => {
    const rows = [
      run(1, from, { conclusion: 'failure' }),
      run(2, from, { conclusion: 'cancelled' }),
      run(3, from, { status: 'in_progress', conclusion: null, run_started_at: null, updated_at: null }),
    ];
    const s = summarizeMergeGroups(rows, { from, to, now, source: 'api' });
    expect(s.failed).toBe(1);
    expect(s.otherConclusions).toEqual({ cancelled: 1 });
    expect(s.unfinished).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.runs.find((x: { id: number }) => x.id === 3).minutes).toBeNull();
  });

  it('uses lower median rank and nearest p90 rank rather than a guessed percentile', () => {
    const durations = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    const rows = durations.map((m, i) => run(i + 1, '2026-11-06T02:00:00Z', {
      updated_at: new Date(Date.parse('2026-11-06T01:10:00Z') + m * 60000).toISOString().replace('.000Z', 'Z'),
    }));
    const s = summarizeMergeGroups(rows, { from, to, now, source: 'api' });
    expect(s.medianMinutes).toBe(25);
    expect(s.p90Minutes).toBe(45);
    expect(s.windowDays).toBe(1);
  });

  it('fails closed on invalid durations, duplicates and unverified snapshots', () => {
    const row = run(5, from);
    expect(() => summarizeMergeGroups([row, row], { from, to, now })).toThrow(/Duplicate/);
    expect(() => summarizeMergeGroups([run(6, from, {
      updated_at: '2026-11-06T01:00:00Z',
    })], { from, to, now })).toThrow(/before/);
    expect(summarizeMergeGroups([row], { from, to, now, source: 'snapshot' }).complete).toBe(false);
    expect(summarizeMergeGroups([row], { from, to, now: Date.parse(from), source: 'api' }).complete).toBe(false);
    const printed = formatMergeGroups(summarizeMergeGroups([row], { from, to, now, source: 'snapshot' }));
    expect(printed).toContain('INCOMPLETE / snapshot only');
    expect(printed).toContain('not PR arrivals or landed PRs');
  });

  it('pages a full first page and stops only after reaching the start boundary', async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(1000 - i, '2026-11-06T02:00:00Z'));
    const second = [run(900, from), run(899, '2026-11-05T23:00:00Z')];
    const visited: Array<{ page: string | null; event: string | null; token: string }> = [];
    const fetched = await fetchMergeGroupRuns({
      repo: 'EldritchDynasty/EldritchDynasty', token: 'fake-secret', from,
      fetchImpl: async (url: URL, options: { headers: Record<string, string> }) => {
        visited.push({
          page: url.searchParams.get('page'), event: url.searchParams.get('event'),
          token: options.headers.Authorization ?? '',
        });
        return { ok: true, json: async () => ({ workflow_runs: visited.length === 1 ? first : second }) };
      },
    });
    expect(fetched).toHaveLength(101);
    expect(visited.map(x => x.page)).toEqual(['1', '2']);
    expect(visited[0]?.event).toBe('merge_group');
    expect(visited[0]?.token).toBe('Bearer fake-secret');
    expect(fetched.at(-1).id).toBe(900);
  });

  it('rejects missing credentials and API errors rather than reporting partial evidence', async () => {
    await expect(fetchMergeGroupRuns({ repo: 'org/repo', from })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(fetchMergeGroupRuns({
      repo: 'org/repo', token: 'token', from,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    })).rejects.toThrow(/HTTP 403/);
  });
});


type PrRow = {
  number: number;
  base: { ref: string };
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
};
const pr = (number: number, created_at: string, extra: Partial<PrRow> = {}): PrRow => ({
  number, base: { ref: 'main' }, created_at,
  closed_at: null, merged_at: null, ...extra,
});

describe('main PR flow evidence (#2794)', () => {
  it('counts real merges including older PRs and excludes unrelated bases and boundary arrivals', () => {
    const rows = [
      pr(1, '2026-11-05T23:00:00Z', {
        merged_at: '2026-11-06T03:00:00Z',
        closed_at: '2026-11-06T03:00:00Z',
      }),
      pr(2, '2026-11-06T02:00:00Z'),
      pr(3, '2026-11-06T04:00:00Z', { closed_at: '2026-11-06T05:00:00Z' }),
      pr(4, to), // outside half-open interval
      pr(5, '2026-11-06T02:00:00Z', { base: { ref: 'release' } }),
      pr(6, '2026-11-05T20:00:00Z'),
    ];
    const report = summarizePrFlow(rows, { from, to, now, source: 'api' });
    expect(report.arrivalIds).toEqual([2, 3]);
    expect(report.mergedIds).toEqual([1]);
    expect(report.arrivals).toBe(2);
    expect(report.merged).toBe(1);
    expect(report.closedUnmerged).toBe(1);
    expect(report.openAtStart).toBe(2); // 1 and 6
    expect(report.openAtEnd).toBe(2); // 2 and 6
    expect(report.backlogChange).toBe(0);
    expect(report.arrivalsPerHour).toBe(0.08);
    expect(report.mergedPerHour).toBe(0.04);
    expect(report.complete).toBe(true);
    expect(report.measuresReadyQueue).toBe(false);
    expect(formatPrFlow(report)).toContain('NOT the historical ready merge-queue depth');
  });

  it('rejects bad dates, duplicate numbers and unverifiable snapshots', () => {
    const row = pr(7, from);
    expect(() => summarizePrFlow([row, row], { from, to })).toThrow(/Duplicate/);
    expect(() => summarizePrFlow([pr(8, from, {
      closed_at: '2026-11-05T23:00:00Z',
    })], { from, to })).toThrow(/before creation/);
    expect(summarizePrFlow([row], { from, to, now, source: 'snapshot' }).complete).toBe(false);
    expect(summarizePrFlow([row], { from, to, now: Date.parse(from), source: 'api' }).complete).toBe(false);
  });

  it('paginates ALL PRs so older PRs merged in a window are retained', async () => {
    const first = Array.from({ length: 100 }, (_, i) => pr(i + 1, from));
    const second = [pr(101, '2020-01-01T00:00:00Z', {
      merged_at: '2026-11-06T03:00:00Z', closed_at: '2026-11-06T03:00:00Z',
    })];
    const pages: string[] = [];
    const rows = await fetchPullRequests({
      repo: 'EldritchDynasty/EldritchDynasty', token: 'fake-secret',
      fetchImpl: async (url: URL, options: { headers: Record<string, string> }) => {
        pages.push(url.searchParams.get('page') ?? '');
        expect(url.searchParams.get('state')).toBe('all');
        expect(options.headers.Authorization).toBe('Bearer fake-secret');
        return { ok: true, json: async () => pages.length === 1 ? first : second };
      },
    });
    expect(pages).toEqual(['1', '2']);
    expect(rows).toHaveLength(101);
    expect(summarizePrFlow(rows, { from, to }).mergedIds).toContain(101);
  });

  it('refuses missing credentials and API failures', async () => {
    await expect(fetchPullRequests({ repo: 'org/repo' })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(fetchPullRequests({
      repo: 'org/repo', token: 'fake-secret',
      fetchImpl: async () => ({ ok: false, status: 403 }),
    })).rejects.toThrow(/HTTP 403/);
  });
});
