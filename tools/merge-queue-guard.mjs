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
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const GROUP_REF = /^gh-readonly-queue\/main\/pr-(\d+)-[0-9a-f]+$/;
const RED = new Set(['failure', 'timed_out']);
const VERDICTS = new Set(['success', ...RED]);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
  const cutoff = greenTime - LOOKBACK_MS;
  const history = [];
  let exhausted = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = 'https://api.github.com/repos/' + repo
      + '/actions/workflows/check.yml/runs?event=merge_group&per_page=' + PAGE_SIZE
      + '&page=' + page;
    const response = await request(url, {
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10',
      },
    });
    if (!response.ok) throw new Error('Cannot read merge-group history (HTTP ' + response.status + ')');
    const data = await response.json();
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
