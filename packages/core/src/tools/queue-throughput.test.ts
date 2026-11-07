import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKING_GATE_IDS } from './gate-registry.js';
// The reporter is a standalone cross-platform Node CLI, intentionally .mjs.
// @ts-ignore -- no declaration file for the standalone Node entrypoint
import { timestamp, summarizeMergeGroups, fetchMergeGroupRuns, formatMergeGroups, summarizePrFlow, fetchPullRequests, formatPrFlow, gateIdsFromRegistry, parseGateProofLog, summarizeGateProofs, fetchGateProofEvidence, formatGateProofs } from '../../../../tools/queue-throughput.mjs';

type Run = {
  id: number; event: string; name: string; created_at: string;
  run_started_at: string | null; updated_at: string | null;
  status: string; conclusion: string | null;
  head_sha?: string; run_attempt?: number;
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

  it('retains hundredth-minute precision for queue slot evidence', () => {
    // Seven and fifteen extra seconds are not the same duration. Rounding
    // each run to tenths before taking quantiles hid that distinction.
    const started = '2026-11-06T01:10:00Z';
    const rows = [
      run(21, '2026-11-06T01:00:00Z', {
        run_started_at: started, updated_at: '2026-11-06T01:20:07Z',
      }),
      run(22, '2026-11-06T01:00:01Z', {
        run_started_at: started, updated_at: '2026-11-06T01:20:15Z',
      }),
    ];
    const report = summarizeMergeGroups(rows, { from, to, now, source: 'api' });
    expect(report.runs.map((entry: { minutes: number }) => entry.minutes)).toEqual([10.12, 10.25]);
    expect(report.medianMinutes).toBe(10.12);
    expect(report.p90Minutes).toBe(10.25);
    expect(formatMergeGroups(report)).toContain('10.12 min | 10.25 min');
  });

  it('certifies the daily failure target only for a complete 30+ group day', () => {
    const groupDay = Array.from({ length: 40 }, (_, i) => run(i + 1, from, {
      conclusion: i < 2 ? 'failure' : 'success',
    }));
    const atThreshold = summarizeMergeGroups(groupDay, { from, to, now, source: 'api' });
    expect(atThreshold.failureSharePercent).toBe(5);
    expect(atThreshold.dailyTargetUnder5Percent).toBe(false); // strict under 5%

    const belowThreshold = summarizeMergeGroups(
      groupDay.map((row, i) => i === 1 ? { ...row, conclusion: 'success' } : row),
      { from, to, now, source: 'api' },
    );
    expect(belowThreshold.failureSharePercent).toBe(2.5);
    expect(belowThreshold.dailyTargetUnder5Percent).toBe(true);
    expect(formatMergeGroups(belowThreshold)).toContain('Daily <5% failure target');
    expect(formatMergeGroups(belowThreshold)).toContain('met.');

    for (const [rows, options] of [
      [groupDay.slice(0, 29), { from, to, now, source: 'api' }],
      [groupDay, { from, to, now, source: 'snapshot' }],
      [groupDay, { from, to, now: Date.parse(from), source: 'api' }],
      [groupDay, { from, to: '2026-11-06T13:00:00Z', now, source: 'api' }],
      [groupDay.map((row, i) => i === 2 ? { ...row, conclusion: 'cancelled' } : row),
        { from, to, now, source: 'api' }],
      [groupDay.map((row, i) => i === 2 ? { ...row, conclusion: null, status: 'in_progress' } : row),
        { from, to, now, source: 'api' }],
    ] as const) {
      const report = summarizeMergeGroups([...rows], options);
      expect(report.dailyTargetUnder5Percent).toBeNull();
      expect(formatMergeGroups(report)).toContain('not evaluated');
    }
  });


  it('proves seven clean budget days only from complete, active and green API cohorts', () => {
    const sevenDaysTo = '2026-11-13T01:00:00Z';
    const sevenDayNow = Date.parse('2026-11-14T00:00:00Z');
    const utc = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
    const green = Array.from({ length: 7 }, (_, day) => {
      const first = Date.parse(from) + day * 86400000;
      return run(700 + day, utc(first), {
        run_started_at: utc(first + 600000),
        updated_at: utc(first + 1200000),
      });
    });
    const options = { from, to: sevenDaysTo, now: sevenDayNow, source: 'api' };
    const proven = summarizeMergeGroups(green, options);
    expect(proven).toMatchObject({
      complete: true, successful: 7, failed: 0,
      sevenDayGroupCounts: [1, 1, 1, 1, 1, 1, 1],
      sevenDayNoBudgetFailuresProved: true,
    });
    expect(formatMergeGroups(proven)).toContain(
      'Seven-day zero duration-budget failures (sufficient green-CI evidence): established.',
    );

    // No failure cause can be attributed to the budget without fast-lane logs.
    const insufficient: Array<{ rows: Run[]; options: Parameters<typeof summarizeMergeGroups>[1] }> = [
      { rows: green.map((x, i) => i === 3 ? { ...x, conclusion: 'failure' } : x), options },
      { rows: green.map((x, i) => i === 3 ? { ...x, conclusion: 'cancelled' } : x), options },
      { rows: green.map((x, i) => i === 3
        ? { ...x, status: 'in_progress', conclusion: null, updated_at: null } : x), options },
      { rows: green.filter(x => x.id !== 703), options },
      { rows: [...green.slice(0, 3), { ...green[3]!, created_at: green[2]!.created_at }, ...green.slice(4)], options },
      { rows: [], options },
      { rows: green, options: { ...options, source: 'snapshot' } },
      { rows: green, options: { ...options, now: Date.parse('2026-11-12T00:00:00Z') } },
      { rows: green, options: { ...options, to } },
    ];
    for (const sample of insufficient) {
      const report = summarizeMergeGroups(sample.rows, sample.options);
      expect(report.sevenDayNoBudgetFailuresProved).toBeNull();
      expect(formatMergeGroups(report)).toContain(
        'Seven-day zero duration-budget failures (sufficient green-CI evidence): not established.',
      );
    }
    expect(summarizeMergeGroups(green, { ...options, to }).sevenDayGroupCounts).toBeNull();
  });

  it('does not report a diluted failure share for other terminal outcomes', () => {
    const rows = [
      run(41, from, { conclusion: 'failure' }),
      run(42, from, { conclusion: 'cancelled' }),
      run(43, from),
    ];
    const report = summarizeMergeGroups(rows, { from, to, now, source: 'api' });
    expect(report).toMatchObject({
      complete: true, finished: 3, failed: 1,
      otherConclusions: { cancelled: 1 },
      failureSharePercent: null, dailyTargetUnder5Percent: null,
    });
    expect(formatMergeGroups(report)).toContain('Failure share (finished, classified API cohort only): n/a.');
    expect(formatMergeGroups(report)).toContain('Daily <5% failure target');
    expect(formatMergeGroups(report)).toContain('not evaluated');

    // A finished API cohort without ambiguous outcomes retains its descriptive
    // percentage, even when too small for the daily 30-group verdict.
    const classified = summarizeMergeGroups(rows.filter(row => row.id !== 42), {
      from, to, now, source: 'api',
    });
    expect(classified.failureSharePercent).toBe(50);
    expect(classified.dailyTargetUnder5Percent).toBeNull();
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

  it('rejects shuffled or repeated merge-group pages instead of truncating a cohort', async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(i + 1, '2026-11-06T02:00:00Z'));
    for (const second of [
      [run(101, '2026-11-06T02:00:01Z'), run(102, '2026-11-05T23:00:00Z')],
      [run(1, '2026-11-06T02:00:00Z')],
      // The first old row must not mask an unexpected newer row later on the page.
      [run(103, '2026-11-05T23:00:00Z'), run(104, '2026-11-06T02:00:00Z')],
    ]) {
      let page = 0;
      await expect(fetchMergeGroupRuns({
        repo: 'EldritchDynasty/EldritchDynasty', token: 'fake-secret', from,
        fetchImpl: async () => ({ ok: true, json: async () => ({ workflow_runs: ++page === 1 ? first : second }) }),
      })).rejects.toThrow(/descending creation order|Duplicate or invalid/);
      expect(page).toBe(2);
    }
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

  it('rejects inconsistent merged PR closures rather than inflating the open backlog', () => {
    const created = '2026-11-06T02:00:00Z';
    const merged = '2026-11-06T03:00:00Z';
    expect(() => summarizePrFlow([pr(9, created, { merged_at: merged })], {
      from, to, now, source: 'api',
    })).toThrow(/Merged PR missing closed_at: 9/);
    expect(() => summarizePrFlow([pr(10, created, {
      merged_at: merged, closed_at: '2026-11-06T02:30:00Z',
    })], { from, to, now, source: 'api' })).toThrow(/PR merged after closure: 10/);

    // The normal GitHub snapshot has both timestamps; this still lands exactly
    // once and does not leave a ghost PR in the end-of-window open count.
    const report = summarizePrFlow([pr(11, created, {
      merged_at: merged, closed_at: merged,
    })], { from, to, now, source: 'api' });
    expect(report.complete).toBe(true);
    expect(report.merged).toBe(1);
    expect(report.openAtEnd).toBe(0);
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

  it('rejects out-of-order and duplicated PR pagination before certifying flow', async () => {
    const first = Array.from({ length: 100 }, (_, i) => pr(i + 1, '2026-11-06T02:00:00Z'));
    for (const second of [
      [pr(101, '2026-11-06T02:00:01Z')],
      [pr(1, '2026-11-06T02:00:00Z')],
    ]) {
      let page = 0;
      await expect(fetchPullRequests({
        repo: 'EldritchDynasty/EldritchDynasty', token: 'fake-secret',
        fetchImpl: async () => ({ ok: true, json: async () => ++page === 1 ? first : second }),
      })).rejects.toThrow(/descending creation order|Duplicate or invalid/);
      expect(page).toBe(2);
    }
  });

  it('refuses missing credentials and API failures', async () => {
    await expect(fetchPullRequests({ repo: 'org/repo' })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(fetchPullRequests({
      repo: 'org/repo', token: 'fake-secret',
      fetchImpl: async () => ({ ok: false, status: 403 }),
    })).rejects.toThrow(/HTTP 403/);
  });
});

const repo = 'EldritchDynasty/EldritchDynasty';
const headSha = 'a'.repeat(40);
const registry = readFileSync(new URL('./gate-registry.ts', import.meta.url), 'utf8');
const proofRun = (id = 1) => run(id, from, { head_sha: headSha, run_attempt: 2 });
const proofLog = (reuse = 5) => BLOCKING_GATE_IDS.map((gate, i) =>
  '2026-11-06T01:15:00.1234567Z ' + gate + (i < reuse
    ? ': reuse from run 123 — reused trusted main proof from run 123'
    : ': run — no matching trusted main proof among 3 candidate run(s)')).join('\n');
const proofJob = (id = 1) => ({
  id: id + 100, run_id: id, head_sha: headSha, run_attempt: 2,
  name: 'gates (batch)', status: 'completed', conclusion: 'success',
  steps: ['find reusable trusted gate proofs', 'gates'].map(name => ({ name, status: 'completed', conclusion: 'success' })),
});
const proofEntry = (id = 1) => ({
  runId: id, headSha, runAttempt: 2, job: proofJob(id), gateIds: [...BLOCKING_GATE_IDS], log: proofLog(),
});
const evidence = (entries = [proofEntry()]) => ({ version: 1, repository: repo, runs: entries });
const cohort = (rows = [proofRun()]) => summarizeMergeGroups(rows, { from, to, now, source: 'api' });

describe('gate-proof reuse observations (#3148)', () => {
  it('derives the exact inventory from the measured registry and refuses unfamiliar syntax', () => {
    expect(gateIdsFromRegistry(registry)).toEqual(BLOCKING_GATE_IDS);
    expect(() => gateIdsFromRegistry('')).toThrow(/inventory/);
    expect(() => gateIdsFromRegistry(registry.replace("'clauses',", '...otherGates,'))).toThrow(/inventory/);
  });

  it('reads planner output without counting echoed source or later proof-production traces', () => {
    const echoed = '##[group]Run planner\n' + proofLog() + '\n##[endgroup]\n';
    const produced = BLOCKING_GATE_IDS.map(gate => gate + ': abcdef012345 — reusable').join('\n');
    const decisions = parseGateProofLog(echoed + proofLog() + '\n' + produced, BLOCKING_GATE_IDS);
    expect(decisions).toHaveLength(BLOCKING_GATE_IDS.length);
    expect(decisions.filter((x: { action: string }) => x.action === 'reuse')).toHaveLength(5);
    expect(decisions[0]).toEqual({ gate: BLOCKING_GATE_IDS[0], action: 'reuse', sourceRunId: 123 });
    expect(decisions.at(-1)).toEqual({ gate: BLOCKING_GATE_IDS.at(-1), action: 'run', sourceRunId: null });
  });

  it('refuses truncated, duplicated, unknown and inconsistent planner output', () => {
    const valid = proofLog();
    expect(() => parseGateProofLog(valid.split('\n').slice(1).join('\n'), BLOCKING_GATE_IDS)).toThrow(/Incomplete/);
    expect(() => parseGateProofLog(valid + '\n' + valid, BLOCKING_GATE_IDS)).toThrow(/Duplicate/);
    expect(() => parseGateProofLog(valid.replace('clauses:', 'unregistered:'), BLOCKING_GATE_IDS)).toThrow(/Unexpected/);
    expect(() => parseGateProofLog(valid.replace('proof from run 123', 'proof from run 124'), BLOCKING_GATE_IDS)).toThrow(/Malformed/);
    expect(() => parseGateProofLog(valid.replace('reuse from run 123', 'reuse from run nope'), BLOCKING_GATE_IDS)).toThrow(/Malformed/);
    expect(() => parseGateProofLog('##[group]truncated\n' + valid, BLOCKING_GATE_IDS)).toThrow(/Incomplete/);
  });

  it('retains every workflow group and suppresses a complete-cohort rate if any evidence is missing', () => {
    const report = summarizeGateProofs(evidence(), cohort([proofRun(), proofRun(2)]), { repo, source: 'api' });
    expect(report).toMatchObject({ groups: 2, known: 1, unknown: 1, judged: BLOCKING_GATE_IDS.length, reused: 5, complete: false, reusePercent: null });
    expect(report.runs[1].reason).toBe('missing run evidence');
    expect(formatGateProofs(report)).toContain('Known groups: 1/2');
    const complete = summarizeGateProofs(evidence(), cohort(), { repo, source: 'api' });
    expect(complete).toMatchObject({ complete: true, reused: 5, executed: BLOCKING_GATE_IDS.length - 5 });
    expect(complete.reusePercent).toBe(Math.round(5 / BLOCKING_GATE_IDS.length * 1000) / 10);
    expect(summarizeGateProofs(evidence(), cohort(), { repo }).complete).toBe(false);
    expect(summarizeGateProofs(evidence(), { ...cohort(), complete: false }, { repo, source: 'api' }).reusePercent).toBeNull();
  });

  it('does not count a plan which failed before the gate command could apply it', () => {
    const entry = proofEntry();
    entry.job.steps[0]!.conclusion = 'failure';
    const report = summarizeGateProofs(evidence([entry]), cohort(), { repo, source: 'api' });
    expect(report).toMatchObject({ known: 0, unknown: 1, judged: 0, reused: 0, reusePercent: null });
    expect(report.runs[0].reason).toContain('unconfirmed step');
  });

  it('withholds reuse certification when the enclosing gate job fails after green gate steps', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
      // Runtime API conclusions are nullable; proofJob's successful-control
      // fixture normally infers a non-null string.
      const entry = { ...proofEntry(), job: { ...proofJob(), conclusion: conclusion as string } };
      // Both checked steps completed successfully, but the job itself did not.
      expect(entry.job.steps.every(step => step.conclusion === 'success')).toBe(true);
      const report = summarizeGateProofs(evidence([entry]), cohort(), { repo, source: 'api' });
      expect(report).toMatchObject({
        known: 0, unknown: 1, judged: 0, reused: 0, executed: 0,
        complete: false, reusePercent: null,
      });
      expect(report.runs[0].reason).toBe('unsuccessful gate job');
    }
    // An entirely successful job remains valid evidence.
    expect(summarizeGateProofs(evidence(), cohort(), { repo, source: 'api' }))
      .toMatchObject({ complete: true, known: 1, reused: 5 });
  });

  it('does not fetch an inventory or log for a failed gate job', async () => {
    const visited: URL[] = [];
    const fetched = await fetchGateProofEvidence({
      repo, token: 'fake-secret', runs: cohort().runs,
      fetchImpl: async (url: URL) => {
        visited.push(url);
        return { ok: true, json: async () => ({
          total_count: 1, jobs: [{ ...proofJob(), conclusion: 'failure' }],
        }) };
      },
    });
    expect(visited).toHaveLength(1);
    expect(visited[0]?.pathname).toContain('/attempts/2/jobs');
    expect(fetched.runs[0]).toMatchObject({ gateIds: null, log: null });
    expect(summarizeGateProofs(fetched, cohort(), { repo, source: 'api' }))
      .toMatchObject({ complete: false, known: 0, reused: 0, reusePercent: null });
  });

  it('rejects cross-run, cross-head, cross-attempt and ambiguous snapshot evidence', () => {
    for (const entry of [
      { ...proofEntry(), headSha: 'b'.repeat(40) },
      { ...proofEntry(), runAttempt: 1 },
      { ...proofEntry(), job: { ...proofJob(), run_id: 2 } },
      { ...proofEntry(), job: { ...proofJob(), head_sha: 'b'.repeat(40) } },
      { ...proofEntry(), job: { ...proofJob(), run_attempt: 1 } },
    ]) {
      expect(summarizeGateProofs(evidence([entry]), cohort(), { repo, source: 'api' })).toMatchObject({ known: 0, reusePercent: null });
    }
    expect(() => summarizeGateProofs(evidence([proofEntry(), proofEntry()]), cohort(), { repo })).toThrow(/Duplicate/);
    expect(() => summarizeGateProofs(evidence([proofEntry(3)]), cohort(), { repo })).toThrow(/Unexpected/);
    expect(() => summarizeGateProofs(evidence(), cohort(), { repo: 'other/repo' })).toThrow(/snapshot/);
  });

  it('fetches all job pages at the selected attempt, verifies metadata, and caches inventory by SHA', async () => {
    const visited: URL[] = [];
    const fetched = await fetchGateProofEvidence({ repo, token: 'fake-secret', runs: cohort([proofRun(), proofRun(2)]).runs,
      fetchImpl: async (url: URL, options: { headers: Record<string, string> }) => {
        visited.push(url);
        expect(options.headers.Authorization).toBe('Bearer fake-secret');
        const match = /\/runs\/(\d+)\/attempts\/2\/jobs$/.exec(url.pathname);
        if (match) {
          const id = Number(match[1]);
          const page = url.searchParams.get('page');
          return { ok: true, json: async () => ({ total_count: 101, jobs: page === '1'
            ? Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: 'other' }))
            : [proofJob(id)] }) };
        }
        return { ok: true, text: async () => url.pathname.includes('/contents/') ? registry : proofLog() };
      },
    });
    expect(visited.filter(x => x.pathname.endsWith('/jobs'))).toHaveLength(4);
    expect(visited.filter(x => x.pathname.includes('/contents/'))).toHaveLength(1);
    expect(visited.find(x => x.pathname.includes('/contents/'))?.searchParams.get('ref')).toBe(headSha);
    expect(summarizeGateProofs(fetched, cohort([proofRun(), proofRun(2)]), { repo, source: 'api' })).toMatchObject({ complete: true, known: 2, reused: 10 });
  });

  it('retains a missing gate job without fetching invented log evidence', async () => {
    const fetched = await fetchGateProofEvidence({ repo, token: 'fake-secret', runs: cohort().runs,
      fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 0, jobs: [] }) }),
    });
    expect(fetched.runs[0].job).toBeNull();
    expect(summarizeGateProofs(fetched, cohort(), { repo, source: 'api' })).toMatchObject({ groups: 1, unknown: 1, complete: false });
  });

  it('fails closed on API failure, truncation and duplicate gate jobs', async () => {
    await expect(fetchGateProofEvidence({ repo, runs: [] })).rejects.toThrow(/GITHUB_TOKEN/);
    for (const response of [
      { ok: false, status: 403 },
      { ok: true, json: async () => ({ total_count: 2, jobs: [proofJob()] }) },
      { ok: true, json: async () => ({ total_count: 2, jobs: [proofJob(), { ...proofJob(), id: 999 }] }) },
    ]) {
      await expect(fetchGateProofEvidence({ repo, token: 'fake-secret', runs: cohort().runs,
        fetchImpl: async () => response,
      })).rejects.toThrow(/HTTP 403|Truncated|Ambiguous/);
    }
  });

  it('runs the offline CLI with preserved source IDs and unverified snapshot coverage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'queue-proof-'));
    try {
      const runFile = join(dir, 'runs.json');
      const proofFile = join(dir, 'proofs.json');
      writeFileSync(runFile, JSON.stringify([proofRun()]));
      writeFileSync(proofFile, JSON.stringify(evidence()));
      const cli = fileURLToPath(new URL('../../../../tools/queue-throughput.mjs', import.meta.url));
      const args = [cli, '--from', from, '--to', to, '--runs', runFile, '--proofs', proofFile];
      const result = spawnSync(process.execPath, [...args, '--json'], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.gateProofs).toMatchObject({ source: 'snapshot', complete: false, reused: 5, reusePercent: null });
      expect(output.gateProofs.runs[0]).toMatchObject({ runId: 1, jobId: 101, headSha, runAttempt: 2 });
      const printed = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(printed.stdout).toContain('INCOMPLETE / snapshot only');
      expect(printed.stdout).toContain('Complete-cohort reuse: n/a');
      const invalid = spawnSync(process.execPath, [...args, '--save-proofs', join(dir, 'output.json')], { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('--save-proofs requires live');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
