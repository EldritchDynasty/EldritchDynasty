#!/usr/bin/env node
/**
 * WHAT THE AGENT LOOP COSTS, MEASURED THE WAY THE GAME IS MEASURED.
 *
 * This repository measures the simulation obsessively. `docs/BALANCE-LOG.md`
 * records what every content drop did to the frequency tiers. Nine gates play
 * thousands of years to ask whether a design claim is true. `npm run digest`
 * proves a refactor changed nothing.
 *
 * None of it is pointed at the loop the agent runs. Every figure in issue #116
 * — 11 red runs in 40, seven landings with no verdict at all, four of the reds
 * at the `gates` step that `npm run check` never ran — was obtained by hand,
 * once, by reading the Actions list. Which means the rest of that epic was
 * unfalsifiable: it would be fixed, and nobody could say by how much.
 *
 * WHY THIS READS REFS AND NOT THE API. Same reason `verdict.mjs` does, and the
 * reason is measured: a session's curl to api.github.com comes back
 * `403 GitHub access is not enabled for this session`. `git fetch` works.
 * `.github/workflows/verdict.yml` records every `check` run onto
 * `refs/verdict/<sha>`, so the history of what CI decided is in the repository
 * rather than behind a credential this tool cannot hold.
 *
 * That has one honest consequence worth stating plainly: it can only see back
 * as far as the verdict refs go, and they were first written on 2026-09-07.
 * The 40-run history in #116 predates them and is not reconstructible here.
 * A scoreboard that quietly reported "0 red in 3 runs" while the epic's own
 * evidence lay outside its window would be worse than none, so it says how
 * many commits it could and could not judge.
 *
 *   npm run scoreboard              # the last 40 commits on main
 *   npm run scoreboard -- 100       # a longer window
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NS = 'refs/verdict';
const WINDOW = Number(process.argv[2] ?? 40);

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const tryGit = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch {
    return { ok: false, out: '' };
  }
};

/**
 * The verdict recorded for a commit, or null. Same shape verdict.mjs reads.
 *
 * `branch` COMES BACK NOW, AND IT IS THE HALF THAT WAS THROWN AWAY.
 * `verdict.yml` has written `branch: <head_branch>` onto every ref since the
 * namespace existed; this reader parsed the line next to it and dropped this
 * one. See `tally` for what that cost.
 *
 * A ref with no `branch:` line is NOT assumed to be trunk. It is recorded as
 * `null` and counted off-trunk, because the question this tool answers is
 * "what did CI say about `main`" and a verdict that cannot say which branch it
 * came from cannot answer it.
 */
function verdictFor(sha) {
  const r = tryGit('log', '-1', '--format=%B', `${NS}/${sha}`);
  if (!r.ok) return null;
  const field = (name) => new RegExp(`^${name}: (.+)$`, 'm').exec(r.out)?.[1]?.trim();
  const conclusion = field('conclusion');
  if (!conclusion) return null;
  return {
    conclusion,
    branch: field('branch') ?? null,
    jobs: [...r.out.matchAll(/^job: (.+?) = (.+)$/gm)].map(([, name, result]) => ({ name, result })),
    coveredBy: field('covered-by') ?? null,
  };
}

/**
 * THE JOB FAMILY — `test 3/4` and `gates (war)` counted as `test` and `gates`.
 *
 * `check.yml` runs the tests as a four-way shard matrix and the gates in two
 * lanes, so GitHub names the jobs `test 1/4` … `test 4/4` and `gates (batch)`
 * / `gates (war)`. Counted raw, "which job went red" fragments into six
 * buckets and stops answering the question it exists for — and worse, it
 * fragments ACROSS TIME: vitest shards by path-hash, so the same failing
 * suite moves between shard numbers whenever a test file is added anywhere in
 * the repository. Two reds in `test` would read as one red in `test 2/4` and
 * one in `test 4/4`, which is a fact about a hash and not about the build.
 *
 * Which shard it was is in the verdict ref and in the Actions UI, where
 * somebody debugging one failure is already looking. This is the aggregate.
 */
export function jobFamily(name) {
  return name.replace(/\s+\d+\/\d+$/, '').replace(/\s*\([^)]*\)$/, '').trim();
}

/**
 * THE BRANCH THIS TOOL IS ABOUT. Everything else is somebody's working copy.
 */
export const TRUNK = 'main';

/**
 * ── A JOB RESULT THAT IS NOT A FAILURE ────────────────────────────────────
 *
 * `byJob` incremented on `result !== 'success'`, which is three different
 * claims wearing one comparison. GitHub writes a job's `conclusion` here, or
 * its `status` when there is no conclusion yet, and most of those values are
 * not a job going red:
 *
 *   `skipped`    the job's `if:` said no. `Android AAB` is tag-gated and
 *                records this on EVERY normal commit, so it was logged as a
 *                failure on all 24 reds — making the second-largest entry in
 *                "which job went red" a job that has never run once.
 *   `cancelled`  the run was superseded. It answered nothing.
 *   `neutral`    explicitly not a failure, by GitHub's own definition.
 *   `queued` / `in_progress` / `pending` / `(not started)`
 *                written at `requested`, before any job exists.
 *
 * A job that never ran is not evidence about a build, and counting it as
 * evidence is how a dashboard grows an entry nobody can act on.
 */
const NOT_A_JOB_FAILURE = new Set([
  'success', 'skipped', 'cancelled', 'neutral',
  'queued', 'in_progress', 'pending', 'waiting', 'requested', '(not started)', '(unavailable)',
]);

/**
 * ── WHICH JOBS CANNOT FAIL A BUILD, DERIVED AND NOT REMEMBERED ────────────
 *
 * `warm run corpus` carries `continue-on-error: true` at the JOB level: it is
 * a cache warm, `playedRun` falls back to playing the run, and `land.mjs`
 * lists `corpus` in ADVISORY for the same reason. A red there is a slower
 * next build and never a broken one — so it belongs in its own column rather
 * than beside the job that actually broke trunk.
 *
 * Read off the workflow rather than kept in a list here, for the reason
 * `ciScripts` in `tools/land.mjs` is a function over the same file: a second
 * advisory job would otherwise be counted as a real failure until somebody
 * remembered this constant existed. The fallback is the one job that has the
 * flag today — if the workflow cannot be read at all, the tool degrades to
 * what it knew rather than to silence.
 *
 * An ARRAY and not a Set, because `scoreboard.test.ts` calls these across a
 * JSON boundary (a real `node` process, so the tool is exercised as a tool)
 * and `JSON.stringify(new Set(…))` is `{}` — a rule that would have passed on
 * an empty answer. `tally` takes either.
 */
export function advisoryJobs(workflow) {
  if (!workflow) return ['warm run corpus'];
  const found = new Set();
  // Job blocks are the keys at exactly two spaces under `jobs:`; everything
  // belonging to one is indented further. Naive on purpose, and the same
  // naivety `ciScripts` documents: over-reporting is visible, under-reporting
  // is silent, and this only ever moves a job into a softer column.
  const blocks = workflow.split(/\n(?=  [\w-]+:\n)/);
  for (const block of blocks) {
    if (!/^\s*continue-on-error:\s*true\s*$/m.test(block)) continue;
    const name = /^\s{4}name:\s*(.+?)\s*$/m.exec(block)?.[1];
    if (name) found.add(jobFamily(name));
  }
  return found.size ? [...found].sort() : ['warm run corpus'];
}

/**
 * ── WHAT CI SAID ABOUT THIS COMMIT, AND WHERE IT SAID IT ──────────────────
 *
 * This reported a 4-for-4 green trunk as 84.8% red, and both halves of that
 * were one comparison each.
 *
 * A VERDICT FROM A FEATURE BRANCH IS NOT A VERDICT ABOUT `main`. Commits reach
 * trunk by fast-forward, in batches — four landed within six seconds on
 * 2026-09-19 — so only the tip of a batch ever gets a push run on `main` and
 * the rest keep the verdict from the branch they were written on, including
 * mid-development reds that were fixed before they landed. 28 of the 32 judged
 * commits were that. The ref has always carried `branch:`; nothing read it.
 *
 * AND A CANCELLED RUN IS NOT A FAILED ONE. `cancel-in-progress` kills a run
 * the moment the next push arrives, which is what that setting is for; 24 of
 * those 28 died that way. A run that was stopped before it finished answered
 * no question at all, and the honest thing to do with a non-answer is to give
 * it its own column — the same discipline that made this tool report
 * `unjudged` separately instead of claiming a clean sheet.
 *
 * So the order below is the order of the questions: is there a verdict at
 * all, did it come from trunk, is it still running, was it stopped, did it
 * pass. Only the last two are a colour.
 *
 * Exported so `scoreboard.test.ts` can hand it commits whose verdicts it
 * controls — including a window with no verdicts at all, which must report as
 * unjudged rather than as a clean sheet.
 */
export function tally(rows, { trunk = TRUNK, advisory = advisoryJobs(null) } = {}) {
  const advisorySet = advisory instanceof Set ? advisory : new Set(advisory);
  const out = {
    total: rows.length,
    green: 0, red: 0, pending: 0, cancelled: 0, covered: 0, offTrunk: 0, unjudged: 0,
    byJob: {}, advisoryJob: {}, offTrunkBy: {},
  };
  for (const { verdict } of rows) {
    if (!verdict) { out.unjudged++; continue; }
    if (verdict.branch !== trunk) {
      out.offTrunk++;
      const said = verdict.branch === null || verdict.branch === undefined
        ? `${verdict.conclusion} (branch unrecorded)`
        : verdict.conclusion;
      out.offTrunkBy[said] = (out.offTrunkBy[said] ?? 0) + 1;
      continue;
    }
    if (verdict.conclusion === 'pending') { out.pending++; continue; }
    if (verdict.conclusion === 'cancelled' || verdict.conclusion === 'skipped') {
      out.cancelled++;
      continue;
    }
    if (verdict.conclusion === 'covered') { out.covered++; continue; }
    if (verdict.conclusion === 'success') { out.green++; continue; }
    out.red++;
    for (const j of verdict.jobs) {
      if (NOT_A_JOB_FAILURE.has(j.result)) continue;
      const fam = jobFamily(j.name);
      const bucket = advisorySet.has(fam) ? out.advisoryJob : out.byJob;
      bucket[fam] = (bucket[fam] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Percentage over the heads TRUNK ACTUALLY JUDGED — not over the window, not
 * over covered commits, and not over commits carrying a verdict from elsewhere.
 */
export const redRate = (t) => {
  const judged = t.green + t.red;
  return judged === 0 ? null : (t.red / judged) * 100;
};

function main() {
  if (!tryGit('fetch', '--quiet', 'origin', `+${NS}/*:${NS}/*`).ok) {
    console.error('scoreboard: could not reach the remote.');
    process.exit(1);
  }
  tryGit('fetch', '--quiet', 'origin', 'main');

  const workflow = (() => {
    try {
      return readFileSync(join(import.meta.dirname, '../.github/workflows/check.yml'), 'utf8');
    } catch {
      return null;
    }
  })();

  const shas = git('rev-list', `-${WINDOW}`, 'origin/main').split('\n').filter(Boolean);
  const rows = shas.map((sha) => ({
    sha,
    subject: tryGit('log', '-1', '--format=%s', sha).out,
    verdict: verdictFor(sha),
  }));
  const t = tally(rows, { advisory: advisoryJobs(workflow) });
  const rate = redRate(t);
  const isRed = (v) => v && v.branch === TRUNK
    && !['success', 'pending', 'cancelled', 'skipped', 'covered'].includes(v.conclusion);

  console.log(`${TRUNK}, last ${t.total} commits\n`);
  console.log(`  green      ${String(t.green).padStart(4)}`);
  console.log(`  red        ${String(t.red).padStart(4)}`);
  console.log(`  pending    ${String(t.pending).padStart(4)}`);
  console.log(`  cancelled  ${String(t.cancelled).padStart(4)}   superseded before it could answer`);
  console.log(`  covered    ${String(t.covered).padStart(4)}   included in a separately judged main head`);
  console.log(`  off-trunk  ${String(t.offTrunk).padStart(4)}   only ever judged on the branch it was written on`);
  console.log(`  unjudged   ${String(t.unjudged).padStart(4)}   no verdict ref — see below`);
  console.log('');
  console.log(`  red rate   ${rate === null ? '   —' : `${rate.toFixed(1)}%`}   over the ${t.green + t.red} commit(s) ${TRUNK} judged`);

  if (Object.keys(t.byJob).length) {
    console.log('\n  which job went red:');
    for (const [job, n] of Object.entries(t.byJob).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${job.padEnd(24)} ${n}`);
    }
  }

  if (Object.keys(t.advisoryJob).length) {
    console.log('\n  advisory jobs that failed (continue-on-error — never the reason a build is red):');
    for (const [job, n] of Object.entries(t.advisoryJob).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${job.padEnd(24)} ${n}`);
    }
  }

  if (t.red) {
    console.log('\n  red commits:');
    for (const r of rows) {
      if (isRed(r.verdict)) {
        console.log(`    ${r.sha.slice(0, 7)}  ${r.subject.slice(0, 60)}`);
      }
    }
  }

  if (t.offTrunk) {
    console.log('');
    console.log(`  ${t.offTrunk} of ${t.total} commit(s) carry a verdict from a feature branch and none`);
    console.log(`  from ${TRUNK}. Commits reach trunk by fast-forward in batches, so only the tip of`);
    console.log('  a batch gets a push run and the rest keep whatever CI said while they were');
    console.log('  being written. That is a fact about the branch, not about trunk, and it is');
    console.log('  counted here rather than in the red column:');
    for (const [said, n] of Object.entries(t.offTrunkBy).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${said.padEnd(24)} ${n}`);
    }
  }

  if (t.cancelled) {
    console.log('');
    console.log(`  ${t.cancelled} run(s) on ${TRUNK} were cancelled. \`cancel-in-progress\` superseding a`);
    console.log('  stale run is correct behaviour and answers no question either way — see #144');
    console.log('  for the push storm upstream of it.');
  }

  if (t.unjudged) {
    console.log('');
    console.log(`  ${t.unjudged} of ${t.total} commit(s) have no verdict ref. Verdicts began on`);
    console.log('  2026-09-07, so anything older is outside this window rather than unjudged');
    console.log('  in the sense #118 means. A RECENT commit with no verdict is the real');
    console.log('  thing: `npm run verdict -- <sha>` says which.');
  }
}

if (process.argv[1] && process.argv[1].endsWith('scoreboard.mjs')) main();
