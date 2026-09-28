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
 * so — a closing keyword in a landing commit, which GitHub honours by itself on
 * the default branch. An issue held by a merged branch that nobody named is
 * REPORTED and left open, because a branch that lands part of an epic is the
 * normal case and a script cannot tell it from one that finished.
 *
 *   DRY_RUN=1 node tools/janitor.mjs              # what would happen
 *   JANITOR_RANGE=abc..def node tools/janitor.mjs # also close what those named
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { onPath } from './portable.mjs';\nimport { closingIssues } from './closing-keywords.mjs';

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
function issueState(n) {
  if (!HAS_GH) return 'UNKNOWN';
  const r = spawnSync('gh', ['issue', 'view', String(n), '--json', 'state', '--jq', '.state'], {
    cwd: CWD, encoding: 'utf8',
  });
  const out = (r.stdout ?? '').trim();
  return !r.error && r.status === 0 && out ? out : 'UNKNOWN';
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

// ---------------------------------------------------------------------------
// 1. Which branches have landed. `main` is the judge; nothing else is consulted.
// ---------------------------------------------------------------------------
const MERGED = new Set();
const DOOMED = [];
const ALIVE = [];
say('### Branches');

/**
 * DECIDE FIRST, DELETE AFTER, AND REFUSE A SWEEP THAT WANTS EVERYTHING.
 *
 * The first run of this script deleted 29 branches it should have kept. The
 * decision was wrong on the runner and right in two local runs over the same
 * refs, and the reason it could act on that wrongness is that it deleted inside
 * the loop that decided — no pass ever saw the whole answer, so nothing could
 * notice the answer was absurd.
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
  const merged = git('merge-base', '--is-ancestor', sha, MAIN).ok;
  (merged ? DOOMED : ALIVE).push(branch);
  const behind = gitOut('rev-list', '--count', `${sha}..${MAIN}`) || '?';
  const ahead = gitOut('rev-list', '--count', `${MAIN}..${sha}`) || '?';
  log(`decide ${branch}: ${gitOut('rev-parse', '--short', sha)} vs main `
    + `${gitOut('rev-parse', '--short', MAIN)} → ${merged ? 'MERGED' : 'keep'} `
    + `· behind ${behind} ahead ${ahead}`);
}

const total = DOOMED.length + ALIVE.length;
if (DOOMED.length > MAX_DELETE) {
  say(`**PAUSED** — ${DOOMED.length} branches came back "merged", over the ${MAX_DELETE} ceiling.`);
  say('Nothing was deleted. Read the per-branch decisions in the log; if they are right,');
  say('re-run with a higher `max_delete`. A backlog nobody could tidy legitimately looks like this.');
  process.stderr.write(`REFUSED: ${DOOMED.length} doomed of ${total}, over ${MAX_DELETE}\n`);
  process.exit(1);
}

for (const branch of DOOMED) {
  MERGED.add(branch);
  act('git', 'push', REMOTE, '--delete', branch);
  say(`- deleted \`${branch}\` — merged`);
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
// 2. The issues a landing commit said it finished. GitHub does this itself and
//    does it faster; this is the backstop for the shapes it skips, and a no-op
//    whenever the platform already acted.
//
//    ONE KEYWORD PER ISSUE. `Closes #12, closes #13` closes both; `Closes #12,
//    #13` closes only #12 — GitHub's rule, and this pattern reads it the same
//    way on purpose, so what the janitor reports and what GitHub did never
//    diverge.
// ---------------------------------------------------------------------------
const NAMED = new Set();
if (RANGE) {
  say('');
  say('### Issues named by this push');
  const body = gitOut('log', '--format=%B', RANGE);
  for (const n of [...new Set(closingIssues(body))].sort((a, b) => Number(a) - Number(b))) {
    NAMED.add(n);
    if (issueState(n) === 'OPEN') {
      act('gh', 'issue', 'close', n, '--reason', 'completed', '--comment', 'Landed on `main`.');
      say(`- closed #${n}`);
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
