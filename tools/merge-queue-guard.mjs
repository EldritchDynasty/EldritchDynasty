/**
 * Native queue guard (#2806): do not spend another serial merge-group slot on
 * an unchanged head whose last integration verdict was red.
 *
 * GitHub's merge_group runs have no pull_requests associations, but this
 * repository builds one PR per group and the synthetic branch identifies it:
 * gh-readonly-queue/main/pr-<number>-<main-head>. Do not match by prefix only.
 *
 * The successful exact-head "CI required" check is newer evidence only when
 * it COMPLETED after the failed merge group. This allows a newly tested
 * head to recover without repeatedly re-admitting stale green heads.
 *
 * Native REBASE also needs a linear topic history (#3016). A green head with
 * a merge commit can be admitted and immediately removed without a CI run.
 * Inspect the complete, SHA-pinned comparison before spending a queue slot.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const GROUP_REF = /^gh-readonly-queue\/main\/pr-(\d+)-[0-9a-f]+$/;
const RED = new Set(['failure', 'timed_out']);
const VERDICTS = new Set(['success', ...RED]);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/;

async function githubJson(url, token, request, resource) {
  const response = await request(url, {
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2026-03-10',
    },
  });
  if (!response.ok) throw new Error('Cannot read ' + resource + ' (HTTP ' + response.status + ')');
  return response.json();
}

/** Compare immutable SHAs; do not silently truncate the PR commits API at 250. */
async function linearHistoryDecision({ repo, prNumber, token, request }) {
  const api = 'https://api.github.com/repos/' + repo;
  const pr = await githubJson(api + '/pulls/' + prNumber, token, request, 'pull request');
  const base = pr.base?.sha;
  const head = pr.head?.sha;
  if (!SHA.test(base ?? '') || !SHA.test(head ?? '')) throw new Error('Malformed pull request history');
  const seen = new Set();
  let total;
  let previous;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await githubJson(api + '/compare/' + base + '...' + head
      + '?per_page=' + PAGE_SIZE + '&page=' + page, token, request, 'topic history');
    if (!Number.isSafeInteger(data.total_commits) || data.total_commits < 1
      || !Array.isArray(data.commits) || data.commits.length > PAGE_SIZE
      || (total !== undefined && data.total_commits !== total)) {
      throw new Error('Malformed or empty topic history');
    }
    total = data.total_commits;
    for (const commit of data.commits) {
      if (!SHA.test(commit.sha ?? '') || seen.has(commit.sha)
        || !Array.isArray(commit.parents) || commit.parents.length < 1
        || commit.parents.some((parent) => !SHA.test(parent.sha ?? ''))) {
        throw new Error('Malformed topic commit');
      }
      if (commit.parents.length > 1) {
        return { allowed: false, reason: 'native REBASE requires linear topic history; merge commit '
          + commit.sha + ' must be rebased on its claimed branch and tested again' };
      }
      if (previous && commit.parents[0].sha !== previous) throw new Error('Incomplete linear topic history');
      seen.add(commit.sha);
      previous = commit.sha;
    }
    if (seen.size === total && previous === head) return { allowed: true };
    if (seen.size >= total || data.commits.length < PAGE_SIZE) throw new Error('Incomplete topic history');
  }
  throw new Error('Topic history exceeded safe pagination bound');
}

export function groupPrNumber(branch) {
  const match = GROUP_REF.exec(branch ?? '');
  return match ? Number(match[1]) : undefined;
}

/** Ignore cancelled/unfinished runs: they never overturned the last verdict. */
export function lastGroupVerdict(prNumber, runs) {
  return runs
    .filter((r) => r.event === 'merge_group' && r.status === 'completed'
      && VERDICTS.has(r.conclusion) && groupPrNumber(r.head_branch) === prNumber)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      || (b.id - a.id))[0];
}

export function admissionDecision(prNumber, greenAt, runs) {
  const greenTime = Date.parse(greenAt);
  if (!Number.isFinite(greenTime)) throw new Error('Missing trustworthy green CI completion timestamp');
  const last = lastGroupVerdict(prNumber, runs);
  if (last && RED.has(last.conclusion) && Date.parse(last.updated_at) >= greenTime) {
    return { allowed: false, reason: 'latest merge group failed after exact-head green CI', run: last.id };
  }
  return { allowed: true, reason: last ? 'latest merge-group verdict does not supersede green CI' : 'no intervening merge-group failure' };
}

/**
 * Scan workflow runs newest first, far enough back to cover all groups that
 * could have finished after the head's green check. A bounded scan fails
 * CLOSED instead of silently ignoring old red evidence on busy repositories.
 */
export async function checkAdmission({ repo, prNumber, greenAt, token, request = fetch }) {
  const greenTime = Date.parse(greenAt);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
    || !token || !Number.isFinite(greenTime)) {
    throw new Error('Missing trusted repository, pull request, token or green CI timestamp');
  }
  const linear = await linearHistoryDecision({ repo, prNumber, token, request });
  if (!linear.allowed) return linear;
  const cutoff = greenTime - LOOKBACK_MS;
  const history = [];
  let exhausted = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = 'https://api.github.com/repos/' + repo
      + '/actions/workflows/check.yml/runs?event=merge_group&per_page=' + PAGE_SIZE
      + '&page=' + page;
    const data = await githubJson(url, token, request, 'merge-group history');
    if (!Array.isArray(data.workflow_runs)) throw new Error('Malformed merge-group history');
    const runs = data.workflow_runs;
    history.push(...runs);
    const oldest = runs.at(-1);
    if (runs.length < PAGE_SIZE || !oldest || Date.parse(oldest.created_at) < cutoff) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) throw new Error('Merge-group history exceeded safe pagination bound');
  return admissionDecision(prNumber, greenAt, history);
}

async function main() {
  const result = await checkAdmission({
    repo: process.env.GITHUB_REPOSITORY,
    prNumber: Number(process.env.PR_NUMBER),
    greenAt: process.env.GREEN_AT,
    token: process.env.GH_TOKEN,
  });
  console.log('PR #' + process.env.PR_NUMBER + ': ' + result.reason
    + (result.run ? ' (run ' + result.run + ')' : ''));
  if (!result.allowed) process.exitCode = 3;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('::warning::Merge-group guard refused admission: ' + error.message);
    process.exitCode = 1;
  });
}
