#!/usr/bin/env node
/**
 * THE LANDING FOR A REPOSITORY GITHUB WILL NOT GIVE A MERGE QUEUE.
 *
 * GitHub's native merge queue exists only in public organisation repositories,
 * or in private ones on Enterprise Cloud. Rulesets, branch protection and
 * auto-merge need a paid plan for a private repository too. This repository went
 * private on the organisation's Free plan on 2026-10-26. Admission then failed
 * on every green PR, and there was no queue left for it to enter (#1947).
 *
 * So `.github/workflows/auto-merge-queue.yml` reads `repository.private` off
 * the event and picks one of two landings. Public: the native queue, unchanged.
 * Private: this file, which gives the guarantee `merge_group` gave without a
 * synthetic commit. THE COMMIT THAT REACHES `main` IS THE COMMIT CI TESTED.
 *
 *   - A ready PR whose newest exact-head `CI required` is green AND whose head
 *     already contains `main` lands by moving `main` to that exact SHA. The ref
 *     update sends `force: false`, so a `main` that moved in the meantime
 *     refuses rather than receiving an untested combination. GitHub marks a PR
 *     merged when its head commit reaches the base branch.
 *   - A green PR that is behind `main` is rebased by GitHub
 *     (`updatePullRequestBranch`, REBASE, guarded by `expectedHeadOid`). Its CI
 *     runs again on the new head and that run's handoff lands it. This is the
 *     same rebase `npm run land` performs before a session pushes.
 *   - A rebase GitHub refuses, or a workflow-file change the App's token may not
 *     push, gets one comment on the PR for that head. A paused landing must say
 *     so, because silence is the failure mode this repository keeps having.
 *
 * Decisions are pure functions over plain data and the API sits behind one
 * small object, the way `janitor.mjs` keeps its decisions apart from git.
 * `land.test.ts` hands `decide` and the two flows a fake world. A rehearsal
 * with DRY_RUN=1 reads everything and writes nothing:
 *
 *   node tools/fast-forward-landing.mjs land    # PR_NUMBER, HEAD_SHA [, REQUIRED]
 *   node tools/fast-forward-landing.mjs sweep   # EXPECTED_MAIN_SHA
 *
 * Environment: GITHUB_REPOSITORY; READ_TOKEN (needs checks: read, which the
 * App token is not given); WRITE_TOKEN (the landing App's token);
 * CAN_WRITE_WORKFLOWS=true when that token carries the Workflows permission.
 */
import { appendFileSync } from 'node:fs';

export const REQUIRED_CHECK = 'CI required';
export const BASE_BRANCH = 'main';
const WORKFLOWS_DIR = '.github/workflows/';

/** The newest `CI required` run decides, and only once it has finished (#493). */
export function newestRequired(checkRuns) {
  const newest = (checkRuns ?? [])
    .filter((run) => run?.name === REQUIRED_CHECK)
    .sort((a, b) => a.id - b.id)
    .at(-1);
  if (!newest) return '';
  return newest.status === 'completed' ? (newest.conclusion ?? '') : 'pending';
}

/** Open, ready, aimed at `main`, and from this repository. Forks never land here. */
export function eligibility(pr, repository) {
  if (pr?.state !== 'open') return { ok: false, reason: 'is not open' };
  if (pr.draft !== false) return { ok: false, reason: 'is a draft' };
  if (pr.base?.ref !== BASE_BRANCH) return { ok: false, reason: `targets ${pr.base?.ref}, not ${BASE_BRANCH}` };
  if (pr.head?.repo?.full_name !== repository) return { ok: false, reason: 'comes from another repository' };
  return { ok: true, reason: 'eligible' };
}

export function touchesWorkflows(files) {
  return (files ?? []).some((f) =>
    String(f?.filename ?? '').startsWith(WORKFLOWS_DIR)
    || String(f?.previous_filename ?? '').startsWith(WORKFLOWS_DIR));
}

/**
 * What one PR needs right now. Every refusal comes first and names itself:
 * the only actions are `fast-forward`, `rebase`, `needs-workflows` and `skip`.
 *
 * `comparison` is GitHub's `compare/main...<head>`: `behind_by` counts commits
 * on `main` the head does not contain, `ahead_by` the reverse.
 */
export function decide({ pr, repository, expectedHead, required, comparison, workflows, canWriteWorkflows }) {
  const sha = pr?.head?.sha ?? '';
  const short = sha.slice(0, 7);
  const ok = eligibility(pr, repository);
  if (!ok.ok) return { action: 'skip', reason: `PR #${pr?.number} ${ok.reason}` };
  if (expectedHead && sha !== expectedHead) {
    return { action: 'skip', reason: `PR #${pr.number} moved from ${expectedHead.slice(0, 7)} to ${short}; that head has its own CI` };
  }
  if (required !== 'success') {
    return { action: 'skip', reason: `PR #${pr.number}: ${REQUIRED_CHECK} is ${required || 'absent'} on ${short}` };
  }
  if (!comparison || !Number.isInteger(comparison.ahead_by) || !Number.isInteger(comparison.behind_by)) {
    return { action: 'skip', reason: `PR #${pr.number}: no comparison of ${short} with ${BASE_BRANCH}` };
  }
  if (comparison.ahead_by === 0) return { action: 'skip', reason: `PR #${pr.number}: ${short} is already on ${BASE_BRANCH}` };
  if (workflows && !canWriteWorkflows) {
    return { action: 'needs-workflows', reason: `PR #${pr.number} changes ${WORKFLOWS_DIR} and the landing token cannot push workflow files` };
  }
  if (comparison.behind_by === 0) return { action: 'fast-forward', reason: `PR #${pr.number}: ${short} is green and contains ${BASE_BRANCH}` };
  return { action: 'rebase', reason: `PR #${pr.number}: ${short} is green but ${comparison.behind_by} behind ${BASE_BRANCH}` };
}

export const marker = (kind, sha) => `<!-- fast-forward-landing:${kind}:${sha} -->`;

function conflictComment(pr, message) {
  return [
    marker('rebase', pr.head.sha),
    `**Automatic landing paused.** \`${BASE_BRANCH}\` has moved, and GitHub could not rebase`,
    `\`${pr.head.ref}\` (\`${pr.head.sha.slice(0, 7)}\`) onto it: ${message}`,
    '',
    `Rebase the branch onto \`origin/${BASE_BRANCH}\` (\`npm run land\` does it) and push.`,
    'CI runs on the new head and the landing workflow takes it from there.',
  ].join('\n');
}

function workflowsComment(pr) {
  return [
    marker('workflows', pr.head.sha),
    `**Automatic landing paused.** CI is green on \`${pr.head.sha.slice(0, 7)}\`, but this PR`,
    `changes \`${WORKFLOWS_DIR}\` and the landing App's token cannot push workflow files.`,
    '',
    'An owner can grant the merge-queue App **Workflows: read and write**, after which the',
    'next landing event takes it, or land this one PR with **Rebase and merge**.',
  ].join('\n');
}

/**
 * Carries out `decide` for one PR. Returns what happened; throws only on a
 * response it has no rule for, which the workflow reports as a failed job.
 */
export async function landOne(io, { number, expectedHead, required, repository, canWriteWorkflows }) {
  let retried = false;
  for (;;) {
    const pr = await io.pr(number);
    const head = pr?.head?.sha;
    const comparison = head ? await io.compare(head) : null;
    const workflows = canWriteWorkflows || !head ? false : await io.touchesWorkflows(number);
    const d = decide({ pr, repository, expectedHead, required, comparison, workflows, canWriteWorkflows });
    io.log(d.reason);

    if (d.action === 'skip') return 'skipped';

    if (d.action === 'needs-workflows') {
      await io.commentOnce(number, marker('workflows', head), workflowsComment(pr));
      io.summary(`PR #${number}: paused. It changes workflow files and the token cannot push them.`);
      return 'needs-workflows';
    }

    if (d.action === 'rebase') {
      const r = await io.rebase(pr.node_id, head);
      if (r.ok) {
        io.summary(`PR #${number}: rebased onto ${BASE_BRANCH}; CI reruns on the new head.`);
        return 'rebased';
      }
      if (/conflict|could not be rebased|cannot be rebased|unable to (update|rebase)/i.test(r.message ?? '')) {
        await io.commentOnce(number, marker('rebase', head), conflictComment(pr, r.message));
        io.summary(`PR #${number}: paused. GitHub could not rebase it onto ${BASE_BRANCH}.`);
        return 'conflict';
      }
      throw new Error(`PR #${number}: rebase of ${head} failed: ${r.message}`);
    }

    // fast-forward
    const r = await io.fastForward(head);
    if (r.ok) {
      io.summary(`PR #${number}: landed. ${BASE_BRANCH} is now ${head}, the commit CI tested.`);
      return 'landed';
    }
    // 422 is GitHub's answer when the update is not a fast-forward: `main`
    // moved under us. Look once more; anything else, or the same answer twice,
    // is a refusal this file has no rule for.
    if (r.status !== 422 || retried) {
      throw new Error(`PR #${number}: ${BASE_BRANCH} refused ${head} (${r.status}): ${r.message}`);
    }
    io.log(`PR #${number}: ${BASE_BRANCH} moved before ${head.slice(0, 7)} landed; deciding again.`);
    retried = true;
  }
}

/**
 * After `main` advances and its own CI is green: land what is ready, rebase
 * what is green but behind. Oldest PR first, so the queue keeps its order.
 */
export async function sweep(io, { expectedMain, repository, canWriteWorkflows }) {
  const current = await io.mainSha();
  if (current !== expectedMain) {
    io.log(`${BASE_BRANCH} moved from ${expectedMain} to ${current}; the newer run owns this sweep.`);
    return { failed: 0, outcomes: {} };
  }
  const outcomes = {};
  let failed = 0;
  const pulls = [...await io.openPulls()].sort((a, b) => a.number - b.number);
  for (const listed of pulls) {
    const ok = eligibility(listed, repository);
    if (!ok.ok) {
      io.log(`PR #${listed.number} ${ok.reason}`);
      continue;
    }
    try {
      const required = await io.required(listed.head.sha);
      outcomes[listed.number] = await landOne(io, {
        number: listed.number, expectedHead: listed.head.sha, required, repository, canWriteWorkflows,
      });
    } catch (error) {
      failed += 1;
      outcomes[listed.number] = 'failed';
      io.log(`::error::${error.message}`);
    }
  }
  return { failed, outcomes };
}

// ── The GitHub side ────────────────────────────────────────────────────────

const REBASE = `mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){
  updatePullRequestBranch(input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid,updateMethod:REBASE}){
    pullRequest{ headRefOid }
  }
}`;

function client(token, api) {
  return async function request(method, path, body) {
    const res = await fetch(path.startsWith('http') ? path : `${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
    return { status: res.status, data, next };
  };
}

async function readAll(request, path) {
  const out = [];
  for (let url = path, page = 0; url && page < 30; page += 1) {
    const r = await request('GET', url);
    if (r.status !== 200) throw new Error(`GET ${url} answered ${r.status}: ${r.data?.message ?? ''}`);
    out.push(...(Array.isArray(r.data) ? r.data : []));
    url = r.next;
  }
  return out;
}

export function liveIo({ repository, readToken, writeToken, dryRun, api = 'https://api.github.com' }) {
  const read = client(readToken, api);
  const write = client(writeToken, api);
  const repo = `/repos/${repository}`;
  const get = async (path) => {
    const r = await read('GET', path);
    if (r.status !== 200) throw new Error(`GET ${path} answered ${r.status}: ${r.data?.message ?? ''}`);
    return r.data;
  };
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  return {
    log: (line) => console.log(line),
    summary: (line) => {
      console.log(line);
      if (summaryFile) appendFileSync(summaryFile, `- ${line}\n`);
    },
    pr: (number) => get(`${repo}/pulls/${number}`),
    openPulls: () => readAll(read, `${repo}/pulls?state=open&base=${BASE_BRANCH}&per_page=100`),
    required: async (sha) => newestRequired(
      (await get(`${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(REQUIRED_CHECK)}&per_page=100`)).check_runs),
    compare: (sha) => get(`${repo}/compare/${BASE_BRANCH}...${sha}?per_page=1`),
    touchesWorkflows: async (number) => touchesWorkflows(await readAll(read, `${repo}/pulls/${number}/files?per_page=100`)),
    mainSha: async () => (await get(`${repo}/git/ref/heads/${BASE_BRANCH}`)).object.sha,
    fastForward: async (sha) => {
      if (dryRun) { console.log(`would: move ${BASE_BRANCH} to ${sha}, force false`); return { ok: true }; }
      const r = await write('PATCH', `${repo}/git/refs/heads/${BASE_BRANCH}`, { sha, force: false });
      return r.status === 200 ? { ok: true } : { ok: false, status: r.status, message: r.data?.message ?? String(r.data) };
    },
    rebase: async (pullRequestId, expectedHeadOid) => {
      if (dryRun) { console.log(`would: rebase ${pullRequestId} at ${expectedHeadOid} onto ${BASE_BRANCH}`); return { ok: true }; }
      const r = await write('POST', `${api}/graphql`, { query: REBASE, variables: { pullRequestId, expectedHeadOid } });
      const errors = r.data?.errors ?? [];
      if (r.status === 200 && !errors.length && r.data?.data?.updatePullRequestBranch?.pullRequest) return { ok: true };
      return { ok: false, message: errors.map((e) => e.message).join('; ') || `${r.status}: ${r.data?.message ?? ''}` };
    },
    commentOnce: async (number, mark, body) => {
      const comments = await readAll(read, `${repo}/issues/${number}/comments?per_page=100`);
      if (comments.some((c) => String(c?.body ?? '').includes(mark))) return false;
      if (dryRun) { console.log(`would: comment on PR #${number}: ${mark}`); return true; }
      const r = await write('POST', `${repo}/issues/${number}/comments`, { body });
      if (r.status !== 201) throw new Error(`comment on PR #${number} answered ${r.status}: ${r.data?.message ?? ''}`);
      return true;
    },
  };
}

async function main() {
  const [command] = process.argv.slice(2);
  const env = process.env;
  const repository = env.GITHUB_REPOSITORY;
  const readToken = env.READ_TOKEN || env.GH_TOKEN;
  const writeToken = env.WRITE_TOKEN || readToken;
  if (!repository || !readToken) throw new Error('GITHUB_REPOSITORY and READ_TOKEN are required');
  const dryRun = env.DRY_RUN === '1';
  const io = liveIo({ repository, readToken, writeToken, dryRun, api: env.GITHUB_API_URL || undefined });
  const canWriteWorkflows = env.CAN_WRITE_WORKFLOWS === 'true';

  if (command === 'land') {
    const number = Number(env.PR_NUMBER);
    const expectedHead = env.HEAD_SHA;
    if (!Number.isInteger(number) || !expectedHead) throw new Error('land needs PR_NUMBER and HEAD_SHA');
    // The workflow passes REQUIRED=success only after establishing it for this
    // exact head. A person rehearsing by hand gets the live answer instead.
    const required = env.REQUIRED || await io.required(expectedHead);
    await landOne(io, { number, expectedHead, required, repository, canWriteWorkflows });
    return 0;
  }
  if (command === 'sweep') {
    if (!env.EXPECTED_MAIN_SHA) throw new Error('sweep needs EXPECTED_MAIN_SHA');
    const { failed } = await sweep(io, { expectedMain: env.EXPECTED_MAIN_SHA, repository, canWriteWorkflows });
    return failed ? 1 : 0;
  }
  throw new Error(`usage: fast-forward-landing.mjs land|sweep (got ${command ?? 'nothing'})`);
}

if (process.argv[1] && process.argv[1].endsWith('fast-forward-landing.mjs')) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
