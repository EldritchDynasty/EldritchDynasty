#!/usr/bin/env node
/**
 * Reproducible, read-only merge-group cohort evidence for #2794.
 *
 * node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-13T01:36:17Z
 * node tools/queue-throughput.mjs --from ... --to ... --runs saved-actions-runs.json --json
 *
 * The first form pages GitHub's Actions API with GITHUB_TOKEN. The second
 * inspects an exported snapshot without network access. Neither counts PR
 * arrivals/landings: a successful merge-group check is not proof of a merge.
 * A window cannot be certified while it is still open, contains unfinished
 * runs, or was supplied as an unverified subset.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
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
      minutes = Math.round((updated - started) / 6000) / 10;
    }
    details.push({ id: run.id, created_at: run.created_at, conclusion: done ? run.conclusion : null, minutes });
  }
  details.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const finished = details.filter(x => x.conclusion !== null);
  const durations = finished.map(x => x.minutes).sort((a, b) => a - b);
  const rank = (fraction) => durations.length ? durations[Math.ceil(fraction * durations.length) - 1] : null;
  const counts = {};
  for (const run of finished) counts[run.conclusion] = (counts[run.conclusion] ?? 0) + 1;
  const complete = source === 'api' && end <= now && finished.length === details.length;

  return {
    from, to, source, complete,
    windowDays: Math.round((end - start) / 8640000) / 10,
    groups: details.length,
    finished: finished.length,
    unfinished: details.length - finished.length,
    successful: counts.success ?? 0,
    failed: counts.failure ?? 0,
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
      // GitHub returns newest created_at first. Fail closed on malformed dates.
      const created = timestamp(run.created_at);
      if (created < start) {
        reachedStart = true;
        break;
      }
      found.push(run);
    }
    if (reachedStart || body.workflow_runs.length < PAGE_SIZE) return found;
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
  for (let page = 1; page <= MAX_PAGES; page++) {
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
    pulls.push(...body);
    if (body.length < PAGE_SIZE) return pulls;
  }
  throw new Error('More than ' + MAX_PAGES + ' PR pages: incomplete history; refuse to report');
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
    'This counts workflow runs, not PR arrivals or landed PRs. It is not a throughput or concurrency recommendation.',
    '',
    'Run IDs: ' + report.runs.map(x => x.id).join(', '),
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
  if (!from || !to) throw new Error('Use --from UTC --to UTC [--runs FILE] [--with-prs | --prs FILE] [--json]');
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
  const output = prReport === null ? report : { mergeGroups: report, pullRequests: prReport };
  process.stdout.write((argv.includes('--json')
    ? JSON.stringify(output, null, 2)
    : formatMergeGroups(report) + (prReport ? '\n\n' + formatPrFlow(prReport) : '')) + '\n');
  // A result can be useful while incomplete, but never say it is acceptance evidence.
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    console.error('queue-throughput: ' + error.message);
    process.exitCode = 1;
  });
}
