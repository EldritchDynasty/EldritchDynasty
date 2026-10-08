#!/usr/bin/env node
/**
 * THE TIDYING NO AGENT CAN DO FOR ITSELF.
 *
 * A Claude session's git proxy refuses ref deletion — 403, every time — so no
 * agent has ever deleted its own merged branch or its own spent claim. That one
 * restriction is the entire explanation for the thirty-odd `claude/*` branches
 * on this remote. An Actions runner has no such limit, so the sweep lives here
 * and `.github/workflows/janitor.yml` is four lines that call it.
 *
 * It is a script rather than YAML so that it can be READ and RUN:
 * `DRY_RUN=1 node tools/janitor.mjs` prints every action it would take and
 * performs none of them, against whatever remote you point it at.
 *
 * NODE RATHER THAN BASH, AND THE READING IS THE REASON. The bash version used
 * `declare -A`, process substitution and `[[ =~ ]]` — bash 4 features, none of
 * which Git Bash on Windows can be relied on to have and none of which
 * PowerShell has at all. So the one command in this repository that deletes
 * things could only be dry-run from a Linux box, which is the opposite of the
 * arrangement you want for a command that deletes things. AGENTS.md says
 * Windows and Linux are both first-class; this is the file where that claim
 * was least true and mattered most.
 *
 * WHAT IT KEYS OFF, AND WHY IT IS NOT THE ISSUE NUMBER.
 *
 * A branch lands as many issues as its agent claimed — an epic's three
 * sub-issues, a fix and the test-gate it needed. So the unit of "this work is
 * finished" is the BRANCH being an ancestor of main, and the claims are found
 * from it: each claim records the branch holding it (`agent:`), so one merge
 * retires all of them without anybody enumerating anything.
 *
 * Closing an issue is a different question from releasing a lock, and this
 * script keeps them apart. A claim is retired on merge, always: the branch is
 * gone, so the lock has no owner. An ISSUE is closed only where somebody said
 * so — an affirmative closing keyword in a landing commit or in a PR GitHub
 * reports merged into this repository's default branch. An issue held by a
 * merged branch that nobody named is REPORTED and left open, because a branch
 * that lands part of an epic is the normal case and a script cannot tell it
 * from one that finished.
 *
 *   DRY_RUN=1 node tools/janitor.mjs              # what would happen
 *   JANITOR_RANGE=abc..def node tools/janitor.mjs # also close what those named
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { onPath } from './portable.mjs';
import { closingIssues, mergedPrClosingIssues } from './closing-keywords.mjs';

const DRY = process.env.DRY_RUN === '1';
const REMOTE = process.env.REMOTE ?? 'origin';
const SUMMARY = process.env.GITHUB_STEP_SUMMARY ?? '';
/**
 * Two SHAs and nothing else. A dispatch hands this in as free text, and it goes
 * to `git log` as an argument: `--output=…` would be an option, not a range.
 * Anything else reads as "nothing was named", the same answer an unreadable
 * push range gets.
 */
const readRange = (raw) => (/^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$/.test(raw) ? raw : '');
const RANGE = readRange((process.env.JANITOR_RANGE ?? '').trim());
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? '';
const DEFAULT_BRANCH = process.env.JANITOR_DEFAULT_BRANCH ?? 'main';
const RECONCILE_MERGED_PRS = process.env.JANITOR_RECONCILE_MERGED_PRS === '1';
// A failed/cancelled push sweep must not permanently lose its closing evidence.
// Keep the recovery window bounded, and avoid hydrating old PR bodies.
const MERGED_PR_RETRY_HOURS = 48;
const MERGED_PR_RETRY_CUTOFF_MS = Date.now() - MERGED_PR_RETRY_HOURS * 60 * 60 * 1000;
const RECENT_MERGED_PRS = [];
const CWD = process.cwd();

/**
 * Diagnostics go to the LOG and decisions go to the SUMMARY — see the first
 * run of this script, where the summary was a wall of deletions with no reason
 * given for any of them. When there is no summary to write to (a local run),
 * both land on stdout, which is what a local run wants anyway.
 */
const log = (line) => process.stdout.write(`${line}\n`);
function say(line) {
  if (!SUMMARY) return log(line);
  // A summary that cannot be written must not take the sweep down with it.
  try { appendFileSync(SUMMARY, `${line}\n`); } catch { /* the sweep matters more */ }
}

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: CWD, encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const gitOut = (...args) => git(...args).out;

/** Perform it, or say what would have been performed. Never both. */
function act(cmd, ...args) {
  if (DRY) return log(`would: ${cmd} ${args.join(' ')}`);
  spawnSync(cmd, args, { cwd: CWD, stdio: 'ignore' });
}

/**
 * `gh` is absent when this is run locally. Say UNKNOWN rather than guessing
 * CLOSED, so a missing tool can never close or retire anything.
 */
const HAS_GH = onPath('gh');
let reconciliationFailed = false;

/** Injected issue history is used only for dry-run fixtures, never for live repair. */
function dryIssueEvidence(n) {
  if (!DRY || !process.env.JANITOR_ISSUES_JSON) return null;
  try {
    const issues = JSON.parse(process.env.JANITOR_ISSUES_JSON);
    return issues && Object.hasOwn(issues, String(n)) ? issues[String(n)] : null;
  } catch {
    return null;
  }
}

function issueState(n) {
  if (DRY && process.env.JANITOR_ISSUES_JSON) {
    const state = dryIssueEvidence(n)?.state;
    return state === 'OPEN' || state === 'CLOSED' ? state : 'UNKNOWN';
  }
  if (!HAS_GH) return 'UNKNOWN';
  const r = spawnSync('gh', ['issue', 'view', String(n), '--json', 'state', '--jq', '.state'], {
    cwd: CWD, encoding: 'utf8',
  });
  const out = (r.stdout ?? '').trim();
  return !r.error && r.status === 0 && out ? out : 'UNKNOWN';
}

/**
 * Retry closing evidence is valid only if the issue has NOT been reopened
 * after that landing. GitHub's issue event history is the authority: an OPEN
 * state alone cannot distinguish a missed close from an owner's deliberate
 * reopen. Read ALL event pages; missing or malformed evidence is not consent
 * to close. Comparing against the latest eligible landing allows a genuinely
 * newer merged PR to close an issue reopened after an older merge.
 */
function reopenVerdict(n, landedAtMs, trustedMergeTime) {
  if (!Number.isFinite(landedAtMs) || landedAtMs <= 0) return 'UNKNOWN';

  let reopenings;
  if (DRY && process.env.JANITOR_ISSUES_JSON) {
    reopenings = dryIssueEvidence(n)?.reopenings;
  } else {
    if (!HAS_GH || !REPOSITORY) return 'UNKNOWN';
    const endpoint = `/repos/${REPOSITORY}/issues/${n}/events?per_page=100`;
    const r = spawnSync('gh', [
      'api', '--paginate',
      '--jq', '.[] | select(.event == "reopened") | .created_at',
      '--header', 'Accept: application/vnd.github+json',
      '--header', 'X-GitHub-Api-Version: 2022-11-28',
      endpoint,
    ], { cwd: CWD, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      log(`issue reconciliation: could not read reopen events for #${n}: ${r.error?.message || (r.stderr ?? '').trim()}`);
      return 'UNKNOWN';
    }
    reopenings = (r.stdout ?? '').split('\n').filter(Boolean);
  }

  if (!Array.isArray(reopenings) || reopenings.some((at) =>
    typeof at !== 'string' || !at.trim() || !Number.isFinite(Date.parse(at)))) {
    return 'UNKNOWN';
  }
  // Committer dates are supplied by the committer, not GitHub. A pushed
  // commit with a future timestamp cannot prove it landed after a reopen.
  // Only GitHub's PR merged_at may establish that ordering.
  if (!trustedMergeTime && reopenings.length > 0) return 'UNKNOWN';
  return reopenings.some((at) => Date.parse(at) >= landedAtMs) ? 'REOPENED' : 'CLEAR';
}

/** Close one issue with an explicit repository and verify that GitHub accepted it. */
function closeReconciledIssue(n, comment) {
  const args = [
    'issue', 'close', String(n),
    '--reason', 'completed',
    '--comment', comment,
  ];
  if (REPOSITORY) args.push('--repo', REPOSITORY);

  if (DRY) {
    log(`would: gh ${args.join(' ')}`);
    return true;
  }

  const r = spawnSync('gh', args, { cwd: CWD, encoding: 'utf8' });
  if (!r.error && r.status === 0) return true;

  reconciliationFailed = true;
  log(`issue reconciliation: failed to close #${n}: ${(r.stderr ?? '').trim()}`);
  return false;
}

/**
 * GitHub's commit -> pulls association survives native merge-queue rebase
 * landings even when the PR body is not copied into the resulting commit.
 * #454 and #485 are the live counterexamples that established this path.
 */
function mergedPullRequestsForCommit(sha) {
  // The injected dry-run PR inventory replaces GitHub in cross-platform
  // fixture tests. Never consult a real API for a synthetic commit SHA.
  if (DRY && process.env.JANITOR_MERGED_PRS_JSON) return [];
  if (!RECONCILE_MERGED_PRS || !HAS_GH || !REPOSITORY) return [];
  const r = spawnSync('gh', [
    'api',
    '--header', 'Accept: application/vnd.github+json',
    '--header', 'X-GitHub-Api-Version: 2022-11-28',
    `/repos/${REPOSITORY}/commits/${sha}/pulls`,
  ], { cwd: CWD, encoding: 'utf8' });

  if (r.error || r.status !== 0) {
    reconciliationFailed = true;
    log(`issue reconciliation: could not read PRs for ${sha}: ${(r.stderr ?? '').trim()}`);
    return [];
  }

  try {
    const parsed = JSON.parse(r.stdout ?? '[]');
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    log(`issue reconciliation: invalid PR response for ${sha}: ${error}`);
  }
  reconciliationFailed = true;
  return [];
}

/**
 * Native merge queue lands with REBASE, so the reviewed source branch tip is
 * deliberately NOT an ancestor of main. GitHub still retains the PR's exact
 * source ref and source SHA. That pair is safe landing evidence only when the
 * PR is merged into this repository's default branch and the head repository
 * is this repository too.
 *
 * Read the closed-PR collection once rather than issuing one API request per
 * surviving branch. Missing or unreadable GitHub evidence simply yields no
 * extra landing proof: ancestry remains authoritative and branches are kept.
 *
 * JANITOR_MERGED_PRS_JSON exists only for DRY runs so the cross-platform test
 * can inject REST-shaped evidence without depending on a network or a runnable
 * gh shim on Windows. A live deleting run always asks GitHub itself.
 */
function mergedPullRequestLandingHeads() {
  if (!RECONCILE_MERGED_PRS || !REPOSITORY) return new Map();

  const landed = new Map();
  const remember = (pr) => {
    if (!pr?.merged_at) return;
    if (pr.base?.ref !== DEFAULT_BRANCH || pr.base?.repo?.full_name !== REPOSITORY) return;
    if (pr.head?.repo?.full_name !== REPOSITORY) return;
    if (typeof pr.head?.ref !== 'string' || typeof pr.head?.sha !== 'string') return;
    landed.set(`${pr.head.ref}\0${pr.head.sha}`, Number(pr.number) || '?');
    const mergedAt = Date.parse(pr.merged_at);
    if (Number.isFinite(mergedAt) && mergedAt >= MERGED_PR_RETRY_CUTOFF_MS) {
      RECENT_MERGED_PRS.push(pr);
    }
  };

  const fixture = DRY ? (process.env.JANITOR_MERGED_PRS_JSON ?? '') : '';
  if (fixture) {
    try {
      const parsed = JSON.parse(fixture);
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      for (const pr of parsed) remember(pr);
    } catch (error) {
      log(`branch reconciliation: invalid injected PR evidence: ${error}`);
    }
    return landed;
  }

  if (!HAS_GH) {
    log('branch reconciliation: gh unavailable; keeping non-ancestor branches');
    if (!DRY) reconciliationFailed = true;
    return landed;
  }

  const endpoint =
    `/repos/${REPOSITORY}/pulls?state=closed&base=${encodeURIComponent(DEFAULT_BRANCH)}&per_page=100`;

  // Do not capture full REST objects: a 100-PR page exceeds spawnSync's
  // default maxBuffer. Project seven scalar fields and only the BASE64-encoded
  // bodies of PRs merged in the last 48 hours, for bounded closing recovery.
  // Older PRs have an empty eighth field; their bodies never enter Node.
  const retryCutoffSeconds = Math.floor(MERGED_PR_RETRY_CUTOFF_MS / 1000);
  const projection = [
    '.[]',
    '| select(.merged_at != null)',
    '| [.number, .merged_at, .base.ref, .base.repo.full_name,',
    '   .head.ref, .head.sha, .head.repo.full_name,',
    `   (if (.merged_at | fromdateiso8601) >= ${retryCutoffSeconds}`,
    '    then (.body // "" | @base64) else "" end)]',
    '| @tsv',
  ].join(' ');
  const r = spawnSync('gh', [
    'api', '--paginate',
    '--jq', projection,
    '--header', 'Accept: application/vnd.github+json',
    '--header', 'X-GitHub-Api-Version: 2022-11-28',
    endpoint,
  ], { cwd: CWD, encoding: 'utf8' });

  if (r.error || r.status !== 0) {
    reconciliationFailed = true;
    const detail = r.error?.message || (r.stderr ?? '').trim() || `exit ${r.status ?? 'unknown'}`;
    log(`branch reconciliation: could not list merged PRs: ${detail}`);
    return landed;
  }

  for (const line of (r.stdout ?? '').split('\n').filter(Boolean)) {
    const fields = line.split('\t');
    if (fields.length !== 8) {
      reconciliationFailed = true;
      log(`branch reconciliation: invalid projected PR record with ${fields.length} fields`);
      continue;
    }
    const [number, mergedAt, baseRef, baseRepo, headRef, headSha, headRepo, encodedBody] = fields;
    remember({
      number,
      merged_at: mergedAt || null,
      base: { ref: baseRef, repo: { full_name: baseRepo } },
      head: { ref: headRef, sha: headSha, repo: { full_name: headRepo } },
      body: encodedBody ? Buffer.from(encodedBody, 'base64').toString('utf8') : '',
    });
  }

  return landed;
}

/**
 * A SHALLOW CLONE INVERTS EVERY ANSWER THIS SCRIPT GIVES, AND SAYS NOTHING.
 *
 * This is the bug that cost a repository its branch list. An agent container
 * clones shallow — 59 commits of a 141-commit main — and `merge-base
 * --is-ancestor` cannot walk past the graft boundary, so it returns FALSE for
 * every branch older than the shallow window. Run there, the script reported
 * "7 merged, 29 kept" and was wrong about all 29. Run on a runner with
 * fetch-depth: 0 it reported the truth, and the truth looked like a rampage.
 *
 * There is no partial credit available: an ancestry test on a shallow clone is
 * not conservative, it is arbitrary. So the script refuses to run on one.
 */
if (gitOut('rev-parse', '--is-shallow-repository') !== 'false') {
  const depth = gitOut('rev-list', '--count', 'HEAD') || '?';
  process.stderr.write(`REFUSED: this clone is shallow (${depth} commits reachable).\n`);
  process.stderr.write('  Ancestry is unanswerable here and every branch would read as unmerged.\n');
  process.stderr.write('  Use a runner with fetch-depth: 0, or `git fetch --unshallow` first.\n');
  process.exit(2);
}

git('fetch', '-q', REMOTE, '+refs/heads/*:refs/janitor/*', '--prune');
const MAIN = gitOut('rev-parse', 'refs/janitor/main');

/** Positive closing keywords are landing evidence whether or not GitHub has closed the issue yet. */

/**
 * Latest main commit time that names each issue. The timestamp matters: an old
 * `Closes #N` from before this agent took #N is not evidence that THIS claim
 * landed, even if somebody later deleted the agent branch.
 */
const MAIN_LANDED_AT = new Map();
const mainLog = gitOut('log', '--format=%ct%x00%B%x00', MAIN).split('\0');
for (let i = 0; i + 1 < mainLog.length; i += 2) {
  const at = Number(mainLog[i].trim());
  if (!Number.isFinite(at)) continue;
  for (const issue of closingIssues(mainLog[i + 1])) {
    MAIN_LANDED_AT.set(issue, Math.max(MAIN_LANDED_AT.get(issue) ?? 0, at));
  }
}

const refs = () =>
  gitOut('for-each-ref', '--format=%(refname)', 'refs/janitor/').split('\n').filter(Boolean);

/**
 * Active claim refs answer whether a branch is still somebody's mutex. A newly
 * created working branch normally points at main until its first work commit,
 * so ancestry alone cannot distinguish "freshly claimed" from "already landed".
 */
function activeClaimTimesByAgent() {
  const claimedAt = new Map();
  for (const ref of refs()) {
    const name = ref.replace(/^refs\/janitor\//, '');
    if (!name.startsWith('claim/')) continue;
    const body = gitOut('log', '-1', '--format=%B', ref);
    if (!/^claim\s+\S+(?:\n|$)/.test(body)) continue;

    const agent = body.match(/^agent:\s*(.+)$/m)?.[1]?.trim();
    if (!agent) continue;
    const taken = body.match(/^taken:\s*(.+)$/m)?.[1]?.trim();
    const parsed = taken ? Date.parse(taken) / 1000 : Number.NaN;
    const fallback = Number(gitOut('log', '-1', '--format=%ct', ref));
    const at = Number.isFinite(parsed) ? parsed : fallback;
    if (!Number.isFinite(at)) continue;
    claimedAt.set(agent, Math.max(claimedAt.get(agent) ?? -Infinity, at));
  }
  return claimedAt;
}

// ---------------------------------------------------------------------------
// 1. Which branches have landed. Main ancestry or an exact-head merged PR is proof.
// ---------------------------------------------------------------------------
const MERGED = new Set();
const DOOMED = [];
const ALIVE = [];
const LANDED_BY = new Map();
const PR_LANDINGS = mergedPullRequestLandingHeads();
const ACTIVE_CLAIMED_AT = activeClaimTimesByAgent();
say('### Branches');

/**
 * DECIDE FIRST, DELETE AFTER, AND BOUND EVERY SWEEP.
 *
 * The first run of this script deleted 29 branches it should have kept. The
 * decision was wrong on the runner and right in two local runs over the same
 * refs, and the reason it could act on that wrongness is that it deleted inside
 * the loop that decided — no pass ever saw the whole answer, so nothing could
 * notice the answer was absurd. The full decision pass remains mandatory, but
 * a large backlog is not itself an error: once every candidate is proven, drain
 * it in deterministic bounded batches instead of deadlocking cleanup forever.
 *
 * THE CEILING IS A COUNT, NOT A SHARE, AND THAT CHANGE IS LOAD-BEARING.
 *
 * Guarding on the share was the natural way to say "this looks like everything
 * at once", and it fired on every run from #21 to #23 and deleted nothing for
 * days. All nine branches it refused were genuinely merged: this repository
 * fast-forwards without pull requests, so every branch that ever lands ends up
 * merged, and "nearly all of them are merged" is the NORMAL steady state
 * rather than an alarm. A share ceiling here refuses hardest exactly when it
 * has the most legitimate work to do, and a guard that always fires is a guard
 * nobody reads.
 *
 * What it was protecting against was a MASS DELETION, and a mass deletion is a
 * number of branches, not a proportion of them. The shallow-clone refusal
 * above is the real defence: it removes the condition that produced the false
 * readings rather than trying to recognise their shape afterwards.
 */
const MAX_DELETE = Number(process.env.JANITOR_MAX_DELETE ?? 25);

const ordinary = (branch) => branch !== 'main' && !branch.startsWith('claim/');

for (const ref of refs()) {
  const branch = ref.replace(/^refs\/janitor\//, '');
  if (!ordinary(branch)) continue;
  const sha = gitOut('rev-parse', ref);
  const ancestor = git('merge-base', '--is-ancestor', sha, MAIN).ok;
  const pr = PR_LANDINGS.get(`${branch}\0${sha}`);
  const tipAt = Number(gitOut('log', '-1', '--format=%ct', ref));
  const claimedAt = ACTIVE_CLAIMED_AT.get(branch);
  // A claim at or after the current tip means no branch work has happened
  // since that mutex was acquired. Keep it even if the untouched tip is
  // already on main. Exact-head merged-PR evidence is stronger and still
  // retires native merge-queue REBASE landings.
  const freshUntouchedClaim = claimedAt !== undefined
    && Number.isFinite(tipAt)
    && claimedAt >= tipAt;
  const merged = pr !== undefined || (ancestor && !freshUntouchedClaim);
  if (merged) {
    DOOMED.push(branch);
    LANDED_BY.set(
      branch,
      pr !== undefined && (!ancestor || freshUntouchedClaim)
        ? `merged PR #${pr} at exact head`
        : 'ancestor of main',
    );
  } else {
    ALIVE.push(branch);
  }
  const behind = gitOut('rev-list', '--count', `${sha}..${MAIN}`) || '?';
  const ahead = gitOut('rev-list', '--count', `${MAIN}..${sha}`) || '?';
  log(`decide ${branch}: ${gitOut('rev-parse', '--short', sha)} vs main `
    + `${gitOut('rev-parse', '--short', MAIN)} → ${merged ? 'MERGED' : 'keep'} `
    + `· behind ${behind} ahead ${ahead}`
    + (freshUntouchedClaim && pr === undefined ? ' · active claim newer than branch tip' : '')
    + (pr !== undefined && (!ancestor || freshUntouchedClaim) ? ` · merged PR #${pr} exact head` : ''));
}

const total = DOOMED.length + ALIVE.length;
if (!Number.isInteger(MAX_DELETE) || MAX_DELETE < 1) {
  say(`**PAUSED** — invalid deletion ceiling \`${MAX_DELETE}\`; it must be a positive integer.`);
  process.stderr.write(`REFUSED: invalid JANITOR_MAX_DELETE=${MAX_DELETE}\n`);
  process.exit(1);
}

const DELETE_BATCH = [...DOOMED]
  .sort((a, b) => a.localeCompare(b))
  .slice(0, MAX_DELETE);

if (DOOMED.length > DELETE_BATCH.length) {
  const remaining = DOOMED.length - DELETE_BATCH.length;
  say(`**BOUNDED SWEEP** — ${DOOMED.length} of ${total} branches are proven merged; `
    + `deleting ${DELETE_BATCH.length} this run and leaving ${remaining} for a later sweep.`);
  log(`bounded sweep: ${DOOMED.length} proven merged branches; deleting `
    + `${DELETE_BATCH.length}, deferring ${remaining}`);
}

for (const branch of DELETE_BATCH) {
  MERGED.add(branch);
  act('git', 'push', REMOTE, '--delete', branch);
  say(`- deleted \`${branch}\` — ${LANDED_BY.get(branch) ?? 'merged'}`);
}

let kept = 0;
for (const ref of refs()) {
  const branch = ref.replace(/^refs\/janitor\//, '');
  if (!ordinary(branch) || MERGED.has(branch)) continue;
  kept += 1;
  const days = Math.floor((Date.now() / 1000 - Number(gitOut('log', '-1', '--format=%ct', ref))) / 86400);
  // Not merged. Work in flight and a session that died in 2026 look identical
  // from here, and only one of them is safe to act on — so this reports.
  if (days >= 14) say(`- kept \`${branch}\` — NOT merged, last commit ${days}d ago`);
}
say('');
say(`${MERGED.size} deleted, ${kept} left standing.`);

// ---------------------------------------------------------------------------
// 2. The issues a landing commit or merged PR said it finished. GitHub usually
//    does this itself and faster; this is the backstop for the queue/rebase
//    shapes it skips, and a no-op whenever the platform already acted.
//
//    ONE KEYWORD PER ISSUE. `Closes #12, closes #13` closes both; `Closes #12,
//    #13` closes only #12 — GitHub's rule, and this pattern reads it the same
//    way on purpose, so what the janitor reports and what GitHub did never
//    diverge.
// ---------------------------------------------------------------------------
const NAMED = new Set();
if (RANGE || RECENT_MERGED_PRS.length) {
  say('');
  say(RANGE ? '### Issues named by this push' : '### Issues from recent merged PRs');

  /** issue -> latest eligible closing landing, including its timestamp. */
  const evidence = new Map();
  const remember = (n, source, landedAtMs) => {
    if (!Number.isFinite(landedAtMs) || landedAtMs <= 0) return;
    const previous = evidence.get(n);
    const trusted = source.startsWith('merged PR');
    const previousTrusted = previous?.source.startsWith('merged PR') ?? false;
    // A GitHub PR merge timestamp always outranks a user-supplied commit
    // timestamp; within the same evidence class use the latest landing.
    if (!previous || (trusted && !previousTrusted)
      || (trusted === previousTrusted && landedAtMs > previous.landedAtMs)) {
      evidence.set(n, { source, landedAtMs });
    }
  };

  if (RANGE) {
    const commits = gitOut('log', '--format=%ct%x00%B%x00', RANGE).split('\0');
    for (let i = 0; i + 1 < commits.length; i += 2) {
      const committedAt = Number(commits[i].trim()) * 1000;
      for (const n of closingIssues(commits[i + 1])) remember(n, 'landing commit', committedAt);
    }
  }

  // Replay the recent merged-PR inventory on every run, including schedules.
  // This recovers closes skipped by a failed or cancelled landing-push sweep.
  // The same positive-keyword and same-repo/default-branch checks still apply.
  for (const pr of RECENT_MERGED_PRS) {
    for (const n of mergedPrClosingIssues(pr, {
      repository: REPOSITORY,
      defaultBranch: DEFAULT_BRANCH,
    })) {
      remember(n, `merged PR #${pr.number} (48h retry)`, Date.parse(pr.merged_at));
    }
  }

  // Native merge queue may rebase a PR without copying its body to any commit.
  // Ask GitHub which PRs own each newly-landed commit, then apply the SAME
  // affirmative/negated parser used by PR admission. Only merged PRs targeting
  // this repository's default branch can contribute evidence.
  const commits = RANGE
    ? gitOut('rev-list', '--reverse', RANGE).split('\n').filter(Boolean)
    : [];
  for (const sha of commits) {
    for (const pr of mergedPullRequestsForCommit(sha)) {
      const closings = mergedPrClosingIssues(pr, {
        repository: REPOSITORY,
        defaultBranch: DEFAULT_BRANCH,
      });
      for (const n of closings) {
        remember(n, `merged PR #${pr.number}`, Date.parse(pr.merged_at));
        const mergedAt = Date.parse(pr.merged_at) / 1000;
        if (Number.isFinite(mergedAt)) {
          MAIN_LANDED_AT.set(n, Math.max(MAIN_LANDED_AT.get(n) ?? 0, mergedAt));
        }
      }
    }
  }

  for (const n of [...evidence.keys()].sort((a, b) => Number(a) - Number(b))) {
    NAMED.add(n);
    const { source, landedAtMs } = evidence.get(n);
    const state = issueState(n);
    if (state === 'OPEN') {
      const verdict = reopenVerdict(n, landedAtMs, source.startsWith('merged PR'));
      if (verdict === 'REOPENED') {
        say(`- kept #${n} open — reopened after ${source}`);
        continue;
      }
      if (verdict === 'UNKNOWN') {
        if (!DRY && HAS_GH && REPOSITORY) reconciliationFailed = true;
        say(`- kept #${n} open — reopening history UNKNOWN for ${source}`);
        continue;
      }
      const comment = `Landed on \`${DEFAULT_BRANCH}\` via ${source}.`;
      if (closeReconciledIssue(n, comment)) say(`- closed #${n} — ${source}`);
      else say(`- FAILED to close #${n} — ${source}`);
    } else if (state === 'CLOSED') {
      say(`- #${n} already closed — ${source}`);
    } else {
      // A local/dry run has no authenticated repository context and UNKNOWN is
      // expected there. A live Actions reconciliation does have that context:
      // if it cannot read a named issue, fail visibly rather than pretending
      // the post-merge repair succeeded.
      if (!DRY && HAS_GH && REPOSITORY) reconciliationFailed = true;
      say(`- #${n} named by ${source}; state UNKNOWN, left untouched`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The claims. One merge retires every claim its branch was holding.
// ---------------------------------------------------------------------------
say('');
say('### Claims');

/**
 * A merged PR branch can disappear before this sweep starts. In that ordering
 * it cannot enter MERGED because there is no ordinary ref left to inspect.
 * The claim refs survive, though, and numeric claims say which issues that same
 * agent branch owned. If the branch is absent AND every still-held numeric
 * sibling has a closing keyword on main, main itself is the landed evidence.
 *
 * Requiring every sibling matters: one finished issue on a branch that is
 * still carrying another must not unlock a named lane. Requiring the ordinary
 * branch to be absent matters too: an unmerged branch is stronger evidence of
 * active work than an old closing keyword is of completion.
 */
const CLAIMS = gitOut('for-each-ref', '--format=%(refname)', 'refs/janitor/claim/')
  .split('\n').filter(Boolean).map((ref) => {
    const slug = ref.replace(/^refs\/janitor\/claim\//, '');
    const body = gitOut('log', '-1', '--format=%B', ref);
    return {
      ref,
      slug,
      body,
      agent: /^agent: (.*)$/m.exec(body)?.[1]?.trim() ?? '',
      numeric: /^\d+$/.test(slug),
      released: /^released:/m.test(body),
      claimedAt: Number(gitOut('log', '-1', '--format=%ct', ref)),
      hours: Math.floor((Date.now() / 1000 - Number(gitOut('log', '-1', '--format=%ct', ref))) / 3600),
    };
  });
const ORDINARY_SEEN = new Set([...DOOMED, ...ALIVE]);

const absentAgentLanded = (agent) => {
  if (!agent || ORDINARY_SEEN.has(agent)) return false;
  const siblings = CLAIMS.filter((c) => c.agent === agent && c.numeric && !c.released);
  return siblings.length > 0 && siblings.every((c) => (MAIN_LANDED_AT.get(c.slug) ?? 0) >= c.claimedAt);
};

let held = 0;
for (const claim of CLAIMS) {
  const { ref, slug, body, agent, hours, numeric } = claim;
  let reason = '';
  let landed = false;

  if (/^released:/m.test(body)) {
    reason = 'released by the agent';
  } else if (agent && MERGED.has(agent)) {
    reason = `\`${agent}\` landed`;
    landed = true;
  } else if (!numeric && absentAgentLanded(agent)) {
    reason = `\`${agent}\` is gone and all its issue claims landed on main`;
    landed = true;
  } else if (numeric && issueState(slug) === 'CLOSED') {
    reason = `issue #${slug} is closed`;
  } else {
    /**
     * THE SESSION THAT STOPPED.
     *
     * Everything above retires a claim whose WORK resolved — landed, released,
     * or closed. None of it covers a session that simply died holding one, and
     * that is the common case: six of eight open claims were past the six-hour
     * stale clock on 2026-09-06, two of them by more than half a day, and one
     * of those two was `lane-content` — the serialising lock for the only lane
     * that cannot run in parallel, held by a session that had stopped fifteen
     * hours earlier.
     *
     * `agents.mjs` reports those as stealable and leaves the decision to
     * whoever arrives. That is the wrong place for it: stealing is a judgement
     * an agent must make from a banner, on no information about whether the
     * other session is alive, and a new session's safest reading of an
     * ambiguous lock is always to wait. So nobody steals, and the lane stays
     * shut.
     *
     * The threshold here is deliberately FAR past the six hours that make a
     * claim stealable — a stale claim is an invitation to a human decision;
     * this is the point where no decision is coming. `lane-content` gets a
     * shorter one because it blocks a whole lane rather than one issue.
     */
    const limit = Number(slug === 'lane-content'
      ? process.env.JANITOR_LANE_HOURS ?? 12
      : process.env.JANITOR_CLAIM_HOURS ?? 24);
    if (hours >= limit) reason = `held ${hours}h with no landing, past the ${limit}h reaping horizon`;
  }

  if (reason) {
    act('git', 'push', REMOTE, '--delete', `claim/${slug}`);
    say(`- retired \`claim/${slug}\` — ${reason}`);
    // The multi-issue case, said out loud: a branch that LANDED while still
    // holding an issue nobody's commit named. Usually an epic delivered in
    // parts. Never closed from here — only reported. An agent that put an issue
    // down by hand said what it meant by releasing it, so that case is silent.
    if (landed && numeric && !NAMED.has(slug) && issueState(slug) === 'OPEN') {
      say(`  - ⚠ #${slug} is still OPEN and no landing commit named it. Close it or re-claim it.`);
    }
  } else {
    held += 1;
    say(`- \`claim/${slug}\` held by ${agent || 'someone'}, ${hours}h`);
  }
}
say('');
say(`${held} claim(s) still open.`);

if (reconciliationFailed) {
  process.stderr.write('Issue reconciliation was incomplete; see the diagnostics above.\n');
  process.exitCode = 1;
}
