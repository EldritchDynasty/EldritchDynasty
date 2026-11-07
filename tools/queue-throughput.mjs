#!/usr/bin/env node
/**
 * Reproducible, read-only merge-group cohort evidence for #2794.
 *
 * node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-13T01:36:17Z
 * node tools/queue-throughput.mjs --from ... --to ... --runs saved-actions-runs.json --json
 *
 * The first form pages GitHub's Actions API with GITHUB_TOKEN. The second
 * inspects an exported snapshot without network access. Merge-group checks
 * are not PR landings; --with-prs separately counts actual created/merged PRs.
 * A window cannot be certified while it is still open, contains unfinished
 * runs, or was supplied as an unverified subset.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
// PR all-state history grows far beyond one merge-group or job window.
// Preserve a bounded scan without failing at the first 5,000 historical PRs.
const MAX_PR_PAGES = 250;
const SECOND_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

export function timestamp(value) {
  if (typeof value !== 'string' || !SECOND_UTC.test(value)) {
    throw new Error('Expected a complete UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value.replace(/Z$/, '.000Z')) {
    throw new Error('Invalid UTC timestamp: ' + value);
  }
  return milliseconds;
}

export function summarizeMergeGroups(runs, { from, to, now = Date.now(), source = 'snapshot' }) {
  const start = timestamp(from);
  const end = timestamp(to);
  if (end <= start) throw new Error('--to must be later than --from');
  if (!Array.isArray(runs)) throw new Error('Expected an array of GitHub workflow runs');

  const byId = new Map();
  for (const run of runs) {
    if (run.event !== 'merge_group' || run.name !== 'check') continue;
    const created = timestamp(run.created_at);
    if (created < start || created >= end) continue;
    if (!Number.isSafeInteger(run.id)) throw new Error('Run is missing a numeric ID');
    if (byId.has(run.id)) throw new Error('Duplicate run ID: ' + run.id);
    byId.set(run.id, run);
  }

  const details = [];
  for (const run of byId.values()) {
    const done = run.status === 'completed' && typeof run.conclusion === 'string';
    let minutes = null;
    if (done) {
      const started = timestamp(run.run_started_at);
      const updated = timestamp(run.updated_at);
      if (updated < started) throw new Error('Run updated before it started: ' + run.id);
      // Preserve hundredth-minute precision for median/p90 comparisons;
      // rounding individual queue slots to tenths first loses real seconds.
      minutes = Math.round((updated - started) / 600) / 100;
    }
    details.push({
      id: run.id, created_at: run.created_at, conclusion: done ? run.conclusion : null, minutes,
      head_sha: run.head_sha ?? null, run_attempt: run.run_attempt ?? null,
    });
  }
  details.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const finished = details.filter(x => x.conclusion !== null);
  const durations = finished.map(x => x.minutes).sort((a, b) => a - b);
  const rank = (fraction) => durations.length ? durations[Math.ceil(fraction * durations.length) - 1] : null;
  const counts = {};
  for (const run of finished) counts[run.conclusion] = (counts[run.conclusion] ?? 0) + 1;
  const complete = source === 'api' && end <= now && finished.length === details.length;
  const failed = counts.failure ?? 0;
  // A cancelled/skipped/neutral run must never dilute the reported failure
  // share. Such a cohort can describe outcomes but cannot establish a rate.
  const classified = Object.keys(counts).every(key => key === 'success' || key === 'failure');
  const failureSharePercent = complete && details.length && classified
    ? Math.round(failed / details.length * 1000) / 10 : null;
  // Only an exact one-day, 30+ group, fully classified API cohort meets the
  // issue's failure-rate evidence threshold; cancellations never count as green.
  const dailyEligible = complete && end - start === 86400000 && details.length >= 30 && classified;
  const dailyTargetUnder5Percent = dailyEligible ? failed * 20 < details.length : null;

  // Seven consecutive days of successful first-attempt merge-group checks
  // suffice to exclude lanes.test.ts budget failures. A successful rerun can
  // conceal an earlier failure: the latest conclusion alone is not a clean
  // certificate when run_attempt is >1 or missing. Require an active check on
  // each day. Unknown history is NOT evidence that the budget itself failed.
  const sevenDayGroupCounts = end - start === 7 * 86400000
    ? Array.from({ length: 7 }, (_, day) => details.filter(run =>
      Math.floor((timestamp(run.created_at) - start) / 86400000) === day).length)
    : null;
  const sevenDayNoBudgetFailuresProved = complete &&
    sevenDayGroupCounts?.every(count => count > 0) &&
    (counts.success ?? 0) === details.length &&
    details.every(run => run.run_attempt === 1) ? true : null;

  return {
    from, to, source, complete,
    windowDays: Math.round((end - start) / 8640000) / 10,
    groups: details.length,
    finished: finished.length,
    unfinished: details.length - finished.length,
    successful: counts.success ?? 0,
    failed,
    failureSharePercent, dailyTargetUnder5Percent,
    sevenDayGroupCounts, sevenDayNoBudgetFailuresProved,
    otherConclusions: Object.fromEntries(Object.entries(counts).filter(([key]) => key !== 'success' && key !== 'failure')),
    medianMinutes: rank(0.5),
    p90Minutes: rank(0.9),
    // No admission/merge-rate conclusion is possible from Actions runs alone.
    measuresPrArrivalOrLanding: false,
    runs: details,
  };
}

export async function fetchMergeGroupRuns({ repo, token, from, fetchImpl = fetch }) {
  const start = timestamp(from);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid owner/repo');
  if (!token) throw new Error('Set GITHUB_TOKEN for live evidence, or pass --runs FILE');
  const found = [];
  const seenIds = new Set();
  let previousCreated = Infinity;
  let reachedStart = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(API + '/repos/' + repo + '/actions/runs');
    url.searchParams.set('event', 'merge_group');
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error('GitHub Actions API returned HTTP ' + response.status + ' on page ' + page);
    const body = await response.json();
    if (!Array.isArray(body.workflow_runs)) throw new Error('Missing workflow_runs on page ' + page);
    for (const run of body.workflow_runs) {
      // The start-boundary shortcut is only safe for descending, nonduplicated
      // pages. A page shift or unexpected ordering must not certify a partial cohort.
      const created = timestamp(run.created_at);
      if (created > previousCreated) throw new Error('Merge-group runs are not in descending creation order');
      previousCreated = created;
      if (!Number.isSafeInteger(run.id) || seenIds.has(run.id)) {
        throw new Error('Duplicate or invalid merge-group run ID');
      }
      seenIds.add(run.id);
      if (created < start) {
        reachedStart = true;
        // Inspect the rest of this page for ordering violations before the
        // cutoff. Breaking here could hide newer runs following an old row.
        continue;
      }
      found.push(run);
    }
    if (reachedStart) return found;
    if (body.workflow_runs.length < PAGE_SIZE) {
      // A short page is terminal only if the Actions API's advertised total
      // does not indicate missing rows. Otherwise the cohort could appear
      // complete while omitting merge-group failures or slow queue slots.
      if (Number.isSafeInteger(body.total_count) && body.total_count > seenIds.size) {
        throw new Error('Truncated merge-group run page: expected ' + body.total_count +
          ', received ' + seenIds.size);
      }
      return found;
    }
  }
  throw new Error('More than ' + MAX_PAGES + ' pages: incomplete cohort; refuse to report');
}


/**
 * An actual merged_at timestamp, not a successful merge_group check, proves
 * landing. REST provides a latest-state snapshot, not historical ready states.
 */
export function summarizePrFlow(pulls, { from, to, now = Date.now(), source = 'snapshot' }) {
  const start = timestamp(from);
  const end = timestamp(to);
  if (end <= start) throw new Error('--to must be later than --from');
  if (!Array.isArray(pulls)) throw new Error('Expected an array of GitHub pull requests');
  const seen = new Set();
  const arrivalIds = [];
  const mergedIds = [];
  let closedUnmerged = 0;
  let openAtStart = 0;
  let openAtEnd = 0;
  for (const pr of pulls) {
    if (pr.base?.ref !== 'main') continue;
    if (!Number.isSafeInteger(pr.number)) throw new Error('PR is missing a numeric number');
    if (seen.has(pr.number)) throw new Error('Duplicate PR number: ' + pr.number);
    seen.add(pr.number);
    const created = timestamp(pr.created_at);
    const closed = pr.closed_at == null ? null : timestamp(pr.closed_at);
    const landed = pr.merged_at == null ? null : timestamp(pr.merged_at);
    if (closed !== null && closed < created) throw new Error('PR closed before creation: ' + pr.number);
    if (landed !== null && landed < created) throw new Error('PR merged before creation: ' + pr.number);
    // A merge is also a closure. Without that timestamp the snapshot would
    // count a landed PR as still open and corrupt both backlog boundaries.
    if (landed !== null && closed === null) throw new Error('Merged PR missing closed_at: ' + pr.number);
    if (landed !== null && closed < landed) throw new Error('PR merged after closure: ' + pr.number);
    if (created >= start && created < end) arrivalIds.push(pr.number);
    if (landed !== null && landed >= start && landed < end) mergedIds.push(pr.number);
    if (closed !== null && landed === null && closed >= start && closed < end) closedUnmerged++;
    // Counts immediately BEFORE the half-open window boundaries.
    if (created < start && (closed === null || closed >= start)) openAtStart++;
    if (created < end && (closed === null || closed >= end)) openAtEnd++;
  }
  const hours = (end - start) / 3600000;
  return {
    from, to, source, complete: source === 'api' && end <= now,
    arrivals: arrivalIds.length, merged: mergedIds.length, closedUnmerged,
    openAtStart, openAtEnd, backlogChange: openAtEnd - openAtStart,
    arrivalsPerHour: Math.round(arrivalIds.length / hours * 100) / 100,
    mergedPerHour: Math.round(mergedIds.length / hours * 100) / 100,
    measuresReadyQueue: false, arrivalIds, mergedIds,
  };
}

// Fetch ALL pages, not just PRs created since from: older PRs can land within
// the window. Refuse a truncated cohort rather than declaring victory.
export async function fetchPullRequests({ repo, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid owner/repo');
  if (!token) throw new Error('Set GITHUB_TOKEN for live PR flow, or pass --prs FILE');
  const pulls = [];
  const seenNumbers = new Set();
  let previousCreated = Infinity;
  for (let page = 1; page <= MAX_PR_PAGES; page++) {
    const url = new URL(API + '/repos/' + repo + '/pulls');
    url.searchParams.set('state', 'all');
    url.searchParams.set('sort', 'created');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error('GitHub PR API returned HTTP ' + response.status + ' on page ' + page);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Expected PR array on page ' + page);
    for (const pr of body) {
      const created = timestamp(pr.created_at);
      if (created > previousCreated) throw new Error('PRs are not in descending creation order');
      previousCreated = created;
      if (!Number.isSafeInteger(pr.number) || seenNumbers.has(pr.number)) {
        throw new Error('Duplicate or invalid PR number across pages');
      }
      seenNumbers.add(pr.number);
      pulls.push(pr);
    }
    if (body.length < PAGE_SIZE) return pulls;
  }
  throw new Error('More than ' + MAX_PR_PAGES + ' PR pages: incomplete history; refuse to report');
}

export function formatPrFlow(report) {
  return [
    '# Main-targeted PR flow (#2794)',
    '',
    'Window (UTC): ' + report.from + ' inclusive to ' + report.to + ' exclusive.',
    'Source: ' + report.source + '; coverage: ' +
      (report.complete ? 'all-state API-paginated snapshot' : 'INCOMPLETE / snapshot only') + '.',
    '',
    '| Arrivals | Merged PRs | Closed unmerged | Open at start | Open at end | Net open change |',
    '|---:|---:|---:|---:|---:|---:|',
    '| ' + report.arrivals + ' | ' + report.merged + ' | ' + report.closedUnmerged +
      ' | ' + report.openAtStart + ' | ' + report.openAtEnd + ' | ' + report.backlogChange + ' |',
    '',
    'Created/hour: ' + report.arrivalsPerHour + '; merged/hour: ' + report.mergedPerHour + '.',
    'Open counts use current closure timestamps; past reopen and draft/ready changes are unavailable.',
    'This is NOT the historical ready merge-queue depth. Creation is not admission.',
    '',
    'Created PRs: ' + report.arrivalIds.join(', '),
    'Merged PRs: ' + report.mergedIds.join(', '),
  ].join('\n');
}

export function formatMergeGroups(report) {
  const value = (x) => x === null ? 'n/a' : String(x);
  return [
    '# Merge-group cohort (#2794)',
    '',
    'Window (UTC): ' + report.from + ' inclusive to ' + report.to + ' exclusive.',
    'Source: ' + report.source + '; coverage: ' + (report.complete ? 'finished, API-paginated window' : 'INCOMPLETE / snapshot only') + '.',
    '',
    '| Groups | Successful | Failed | Other | Unfinished | Median slot | p90 slot |',
    '|---:|---:|---:|---:|---:|---:|---:|',
    '| ' + report.groups + ' | ' + report.successful + ' | ' + report.failed +
      ' | ' + Object.values(report.otherConclusions).reduce((a, b) => a + b, 0) +
      ' | ' + report.unfinished + ' | ' + value(report.medianMinutes) +
      ' min | ' + value(report.p90Minutes) + ' min |',
    '',
    'Failure share (finished, classified API cohort only): ' +
      (report.failureSharePercent === null ? 'n/a' : report.failureSharePercent + '%') + '.',
    'Daily <5% failure target (exact 24h, 30+ groups, only success/failure conclusions): ' +
      (report.dailyTargetUnder5Percent === null ? 'not evaluated' :
        report.dailyTargetUnder5Percent ? 'met' : 'not met') + '.',
    'Seven-day zero duration-budget failures (sufficient green-CI evidence): ' +
      (report.sevenDayNoBudgetFailuresProved ? 'established' : 'not established') + '.',
    'Seven-day groups per consecutive 24h segment: ' +
      (report.sevenDayGroupCounts === null ? 'n/a' : report.sevenDayGroupCounts.join(', ')) + '.',
    'First-attempt results are required: a green rerun cannot rule out an earlier failed attempt.',
    'A red or missing check needs job-log diagnosis; not established does not mean the budget failed.',
    'This counts workflow runs, not PR arrivals or landed PRs. It is not a throughput or concurrency recommendation.',
    '',
    'Run IDs: ' + report.runs.map(x => x.id).join(', '),
  ].join('\n');
}

// Read the inventory at each measured SHA, rather than copying today's union
// or assuming that every historical job judged the same number of gates.
export function gateIdsFromRegistry(source) {
  const declaration = /export const BLOCKING_GATE_IDS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!declaration) throw new Error('Missing canonical blocking gate inventory');
  const rows = declaration[1].split('\n').map(x => x.trim()).filter(Boolean);
  const ids = rows.map(row => /^'([a-z][a-z0-9-]*)',$/.exec(row)?.[1]);
  if (!ids.length || ids.some(x => !x) || new Set(ids).size !== ids.length) {
    throw new Error('Unrecognized canonical blocking gate inventory');
  }
  return ids;
}

export function parseGateProofLog(log, gateIds) {
  if (typeof log !== 'string' || !Array.isArray(gateIds) || !gateIds.length ||
    gateIds.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9-]*$/.test(x)) ||
    new Set(gateIds).size !== gateIds.length) throw new Error('Invalid gate proof evidence');
  const decisions = new Map();
  let groupDepth = 0;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /, '');
    // Actions echoes shell/heredoc source inside groups. It is not output.
    if (line.startsWith('##[group]')) { groupDepth++; continue; }
    if (line === '##[endgroup]') {
      if (!groupDepth) throw new Error('Unbalanced Actions log group');
      groupDepth--; continue;
    }
    if (groupDepth || !/^[a-z][a-z0-9-]*: (?:run|reuse)(?:\s|$)/.test(line)) continue;
    const reused = /^([a-z][a-z0-9-]*): reuse from run (\d+) — reused trusted main proof from run (\d+)$/.exec(line);
    const executed = /^([a-z][a-z0-9-]*): run — no matching trusted main proof among \d+ candidate run\(s\)$/.exec(line);
    const gate = (reused ?? executed)?.[1];
    const sourceRunId = reused ? Number(reused[2]) : null;
    if (!gate || (reused && (reused[2] !== reused[3] || !Number.isSafeInteger(sourceRunId) || sourceRunId <= 0))) {
      throw new Error('Malformed planner decision');
    }
    if (!gateIds.includes(gate)) throw new Error('Unexpected planner gate: ' + gate);
    if (decisions.has(gate)) throw new Error('Duplicate planner gate: ' + gate);
    decisions.set(gate, { gate, action: reused ? 'reuse' : 'run', sourceRunId });
  }
  if (groupDepth || decisions.size !== gateIds.length) throw new Error('Incomplete planner log');
  return gateIds.map(id => decisions.get(id));
}

// A failed proof lookup is a safe optimization failure only when the gate
// runner itself proves it executed every gate. Check two independent lines
// outside Actions' echoed command groups; a partial planner is never a
// verified full run. The inventory comes from this run's exact head SHA.
export function verifiedRunAllFallback(log, gateIds) {
  if (typeof log !== 'string' || !Array.isArray(gateIds) || !gateIds.length ||
    gateIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) ||
    new Set(gateIds).size !== gateIds.length) return false;
  const expected = gateIds.length;
  let groupDepth = 0;
  let passed = 0;
  let measured = 0;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /, '');
    if (line.startsWith('##[group]')) { groupDepth++; continue; }
    if (line === '##[endgroup]') {
      if (groupDepth === 0) return false;
      groupDepth--;
      continue;
    }
    if (groupDepth) continue;
    // A partial plan cannot be reclassified as run-all just because the
    // subsequent gate output happens to include an all-gates summary.
    if (/^[a-z][a-z0-9-]*: (?:run|reuse)(?:\s|$)/.test(line)) return false;
    if (/^\d+\/\d+ gates pass in lane batch$/.test(line)) {
      if (line !== expected + '/' + expected + ' gates pass in lane batch') return false;
      passed++;
    }
    const duration = /^gate-duration: evidence (\d+) executed gates(?:,|$)/.exec(line);
    if (duration) {
      if (Number(duration[1]) !== expected) return false;
      measured++;
    }
  }
  return groupDepth === 0 && passed === 1 && measured === 1;
}

function proofJobProblem(job, run) {
  if (!job) return 'missing gate job';
  if (job.run_id !== run.id || job.head_sha !== run.head_sha || job.run_attempt !== run.run_attempt ||
    !Number.isSafeInteger(job.id) || job.id <= 0 || job.name !== 'gates (batch)') {
    return 'gate job identity mismatch';
  }
  if (job.status !== 'completed') return 'unfinished gate job';
  // Successful named steps do not establish a usable result if the enclosing
  // job later fails (for example during post-step cleanup or reporting).
  if (job.conclusion !== 'success') return 'unsuccessful gate job';
  if (!Array.isArray(job.steps)) return 'missing gate step metadata';
  for (const name of ['find reusable trusted gate proofs', 'gates']) {
    const steps = job.steps.filter(x => x?.name === name);
    if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') {
      return 'unconfirmed step: ' + name;
    }
  }
  return null;
}

/** Decoded log evidence is observational; this does not validate/reuse proofs. */
export function summarizeGateProofs(evidence, cohort, { repo, source = 'snapshot' }) {
  if (evidence?.version !== 1 || evidence.repository !== repo || !Array.isArray(evidence.runs)) {
    throw new Error('Invalid gate proof snapshot');
  }
  const entries = new Map();
  for (const entry of evidence.runs) {
    if (!entry || !cohort.runs.some(run => run.id === entry.runId)) throw new Error('Unexpected proof run');
    if (entries.has(entry.runId)) throw new Error('Duplicate proof run: ' + entry.runId);
    entries.set(entry.runId, entry);
  }
  const runs = cohort.runs.map(run => {
    const entry = entries.get(run.id);
    let reason = run.conclusion === null ? 'unfinished workflow run' :
      !entry ? 'missing run evidence' :
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0 ?
        'missing run identity' :
      entry.headSha !== run.head_sha || entry.runAttempt !== run.run_attempt ? 'run identity mismatch' :
      proofJobProblem(entry.job, run);
    let decisions = null;
    let evidenceKind = 'unverified';
    if (!reason) {
      try {
        decisions = parseGateProofLog(entry.log, entry.gateIds);
        evidenceKind = 'planner';
      } catch (error) {
        // Only an absent planner (not malformed, partial or duplicated planner
        // evidence) may fall back to the independently verified run-all path.
        if (error.message === 'Incomplete planner log' &&
          verifiedRunAllFallback(entry.log, entry.gateIds)) {
          decisions = entry.gateIds.map(gate => ({ gate, action: 'run', sourceRunId: null }));
          evidenceKind = 'run-all-fallback';
        } else {
          reason = error.message;
        }
      }
    }
    return {
      runId: run.id, jobId: entry?.job?.id ?? null, headSha: run.head_sha, runAttempt: run.run_attempt,
      known: reason === null, reason, evidenceKind, decisions,
      judged: decisions?.length ?? 0,
      reused: decisions?.filter(x => x.action === 'reuse').length ?? 0,
      executed: decisions?.filter(x => x.action === 'run').length ?? 0,
    };
  });
  const known = runs.filter(run => run.known).length;
  const plannerVerified = runs.filter(run => run.known && run.evidenceKind === 'planner').length;
  const fallbackVerified = runs.filter(run => run.known && run.evidenceKind === 'run-all-fallback').length;
  const sum = key => runs.reduce((total, run) => total + run[key], 0);
  const judged = sum('judged');
  const reused = sum('reused');
  const complete = source === 'api' && cohort.complete && runs.length > 0 && known === runs.length;
  return {
    source, complete, groups: runs.length, known, unknown: runs.length - known,
    plannerVerified, fallbackVerified, judged, reused, executed: sum('executed'),
    reusePercent: complete && judged ? Math.round(reused / judged * 1000) / 10 : null,
    runs,
  };
}

export async function fetchGateProofEvidence({ repo, token, runs, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid owner/repo');
  if (!token) throw new Error('Set GITHUB_TOKEN for live proof evidence, or pass --proofs FILE');
  const request = async (path, raw = false) => {
    const response = await fetchImpl(new URL(API + '/repos/' + repo + path), { headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28',
    } });
    if (!response.ok) throw new Error('GitHub proof evidence API returned HTTP ' + response.status);
    return raw ? response.text() : response.json();
  };
  const registries = new Map();
  const entries = [];
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || run.id <= 0 || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) throw new Error('Missing run identity for proof fetch');
    const jobs = [];
    const ids = new Set();
    let total = null;
    let exhausted = false;
    // Pin the attempt: a rerun must not mix new jobs with an older cohort.
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await request('/actions/runs/' + run.id + '/attempts/' + run.run_attempt +
        '/jobs?per_page=' + PAGE_SIZE + '&page=' + page);
      if (!Array.isArray(body.jobs) || !Number.isSafeInteger(body.total_count) || body.total_count < 0 ||
        body.jobs.length > PAGE_SIZE || (total !== null && total !== body.total_count)) throw new Error('Invalid jobs page');
      total = body.total_count;
      for (const job of body.jobs) {
        if (!Number.isSafeInteger(job.id) || ids.has(job.id)) throw new Error('Duplicate or invalid job ID');
        ids.add(job.id); jobs.push(job);
      }
      if (jobs.length > total) throw new Error('Inconsistent jobs count');
      if (jobs.length === total) { exhausted = true; break; }
      if (body.jobs.length < PAGE_SIZE) throw new Error('Truncated jobs page');
    }
    if (!exhausted) throw new Error('Incomplete jobs history');
    const matching = jobs.filter(job => job.name === 'gates (batch)');
    if (matching.length > 1) throw new Error('Ambiguous gate jobs');
    const job = matching[0] ?? null;
    const entry = { runId: run.id, headSha: run.head_sha, runAttempt: run.run_attempt, job, gateIds: null, log: null };
    if (run.conclusion !== null && !proofJobProblem(job, run)) {
      if (!registries.has(run.head_sha)) {
        const source = await request('/contents/packages/core/src/tools/gate-registry.ts?ref=' + run.head_sha, true);
        registries.set(run.head_sha, gateIdsFromRegistry(source));
      }
      entry.gateIds = registries.get(run.head_sha);
      entry.log = await request('/actions/jobs/' + job.id + '/logs', true);
    }
    entries.push(entry);
  }
  return { version: 1, repository: repo, runs: entries };
}

export function formatGateProofs(report) {
  return [
    '# Gate-proof planner observations (#2794)', '',
    'Source: ' + report.source + '; coverage: ' + (report.complete ? 'complete API cohort' : 'INCOMPLETE / snapshot only') + '.',
    'Known groups: ' + report.known + '/' + report.groups + '; unknown: ' + report.unknown + '.',
    'Planner-verified groups: ' + report.plannerVerified + '; verified run-all fallbacks: ' + report.fallbackVerified + '.',
    'Observed decisions: ' + report.judged + '; reused: ' + report.reused + '; executed: ' + report.executed + '.',
    'Complete-cohort reuse: ' + (report.reusePercent === null ? 'n/a' : report.reusePercent + '%') + '.',
    'Planner observations do not certify proof validity, PR landings or a concurrency recommendation.', '',
    '| Run | Job | Judged | Reused | Executed | Evidence |', '|---:|---:|---:|---:|---:|---|',
    ...report.runs.map(run => '| ' + run.runId + ' | ' + (run.jobId ?? 'n/a') + ' | ' + run.judged +
      ' | ' + run.reused + ' | ' + run.executed + ' | ' + (run.reason ?? run.evidenceKind) + ' |'),
  ].join('\n');
}

export async function runCli(argv = process.argv.slice(2), environment = process.env) {
  const option = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + name);
    return argv[i + 1];
  };
  const from = option('--from');
  const to = option('--to');
  if (!from || !to) throw new Error('Use --from UTC --to UTC [--runs FILE] [--with-prs | --prs FILE] [--with-proofs | --proofs FILE] [--json]');
  const proofFile = option('--proofs');
  const saveProofs = option('--save-proofs');
  const withProofs = argv.includes('--with-proofs') || proofFile !== null;
  if (saveProofs && (!withProofs || proofFile)) throw new Error('--save-proofs requires live --with-proofs');
  const file = option('--runs');
  const repo = option('--repo') ?? 'EldritchDynasty/EldritchDynasty';
  const runs = file
    ? (() => { const json = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(json) ? json : json.workflow_runs; })()
    : await fetchMergeGroupRuns({ repo, token: environment.GITHUB_TOKEN, from });
  const report = summarizeMergeGroups(runs, { from, to, source: file ? 'snapshot' : 'api' });
  const prFile = option('--prs');
  const withPrs = argv.includes('--with-prs') || prFile !== null;
  const prRows = !withPrs ? null : prFile
    ? (() => { const json = JSON.parse(readFileSync(prFile, 'utf8')); return Array.isArray(json) ? json : json.pull_requests; })()
    : await fetchPullRequests({ repo, token: environment.GITHUB_TOKEN });
  const prReport = prRows === null ? null :
    summarizePrFlow(prRows, { from, to, source: prFile ? 'snapshot' : 'api' });
  const proofEvidence = !withProofs ? null : proofFile ? JSON.parse(readFileSync(proofFile, 'utf8')) :
    await fetchGateProofEvidence({ repo, token: environment.GITHUB_TOKEN, runs: report.runs });
  const proofReport = proofEvidence === null ? null :
    summarizeGateProofs(proofEvidence, report, { repo, source: proofFile ? 'snapshot' : 'api' });
  if (saveProofs) writeFileSync(saveProofs, JSON.stringify(proofEvidence, null, 2) + '\n');
  const output = prReport === null && proofReport === null ? report : {
    mergeGroups: report, ...(prReport ? { pullRequests: prReport } : {}), ...(proofReport ? { gateProofs: proofReport } : {}),
  };
  process.stdout.write((argv.includes('--json')
    ? JSON.stringify(output, null, 2)
    : formatMergeGroups(report) + (prReport ? '\n\n' + formatPrFlow(prReport) : '') +
      (proofReport ? '\n\n' + formatGateProofs(proofReport) : '')) + '\n');
  // A result can be useful while incomplete, but never say it is acceptance evidence.
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    console.error('queue-throughput: ' + error.message);
    process.exitCode = 1;
  });
}
