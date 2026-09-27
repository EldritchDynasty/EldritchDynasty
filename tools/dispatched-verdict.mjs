/**
 * RECORD THE VERDICT OF A CHECK THAT `verdict.yml` CANNOT SEE.
 *
 *   node tools/dispatched-verdict.mjs      # inside remote-land.yml only
 *
 * A remote landing pushes with GITHUB_TOKEN, and a push made with that token
 * starts no workflow, so `remote-land.yml` dispatches `check.yml` on `main`
 * explicitly. That run is started by `github-actions[bot]`, and GitHub does not
 * deliver `workflow_run` for it — so `verdict.yml`, which is triggered by
 * exactly that event, never ran for it and never wrote `refs/verdict/<sha>`,
 * not even the `pending` it writes when a run starts.
 *
 * The remote landing then waited on the ordinary verdict reader for a ref that
 * could not arrive, and every remote landing on record — nine of nine, from
 * 2026-09-27 00:00 to 11:38 — was reported as a FAILURE, including #283's,
 * whose commit 9af68b1 was on `main` with a green `check` (run 36314218433).
 * It was first misread as a slow run outliving a 40-minute wait: exit code 2
 * is `absent`, not `pending`, and that was the whole clue.
 *
 * So the landing job, which has a token that can read Actions, finds the run it
 * dispatched, waits for it, and writes the same ref `verdict.yml` would have,
 * in the same format, so every reader — `npm run verdict`, the session-start
 * hook, the next landing — sees it with git alone. It writes nothing it did
 * not observe: no run found by the deadline leaves NO ref, which is still the
 * honest answer "nothing came".
 */
import { execFileSync } from 'node:child_process';

const POLL_MS = 30_000;

/** The exact message `verdict.yml` writes, so `parseVerdict` reads both. */
export function verdictMessage({ sha, branch, conclusion, runUrl, runNumber, jobs, recorded }) {
  const jobLines = jobs.length
    ? jobs.map((j) => `job: ${j.name} = ${j.result}`).join('\n')
    : 'job: (not started)';
  return `verdict ${conclusion}\n\nsha: ${sha}\nbranch: ${branch}\nconclusion: ${conclusion}\n`
    + `run: ${runUrl}\nrun_number: ${runNumber}\n${jobLines}\nrecorded: ${recorded}\n`;
}

/**
 * The run this landing dispatched: a `workflow_dispatch` run of `check` on the
 * landed commit, created no earlier than the dispatch (less a minute of clock
 * skew). Newest first, so a re-dispatch supersedes an older run.
 */
export function pickRun(runs, sha, dispatchedAt) {
  const after = Date.parse(dispatchedAt) - 60_000;
  return runs
    .filter((r) => r.head_sha === sha && r.event === 'workflow_dispatch' && Date.parse(r.created_at) >= after)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** `pending` while it runs, then GitHub's own conclusion — the same states `verdict.yml` writes. */
export function conclusionOf(run) {
  return run.status === 'completed' ? (run.conclusion ?? 'unknown') : 'pending';
}

async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function writeRef(sha, message) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'verdict', GIT_AUTHOR_EMAIL: 'verdict@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'verdict', GIT_COMMITTER_EMAIL: 'verdict@users.noreply.github.com',
  };
  const git = (args, input) => execFileSync('git', args, { env, input, encoding: 'utf8' }).trim();
  const empty = git(['hash-object', '-t', 'tree', '--stdin'], '');
  const commit = git(['commit-tree', empty, '-F', '-'], message);
  git(['push', '--force', 'origin', `${commit}:refs/verdict/${sha}`]);
}

async function main() {
  const sha = process.env.TARGET_SHA;
  const dispatchedAt = process.env.DISPATCHED_AT;
  const waitMinutes = Number(process.env.WAIT_MINUTES ?? 75);
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !dispatchedAt) {
    console.error('dispatched-verdict: TARGET_SHA (40 hex) and DISPATCHED_AT are required.');
    process.exit(2);
  }
  const deadline = Date.now() + waitMinutes * 60_000;
  let wrotePending = false;

  for (;;) {
    const { workflow_runs: runs } = await api(
      `actions/workflows/check.yml/runs?event=workflow_dispatch&head_sha=${sha}&per_page=20`,
    );
    const run = pickRun(runs, sha, dispatchedAt);
    if (run) {
      const conclusion = conclusionOf(run);
      if (conclusion !== 'pending' || !wrotePending) {
        const jobs = conclusion === 'pending' ? [] : (await api(`actions/runs/${run.id}/jobs?per_page=100`))
          .jobs.map((j) => ({ name: j.name, result: j.conclusion ?? j.status }));
        writeRef(sha, verdictMessage({
          sha, branch: run.head_branch, conclusion, runUrl: run.html_url,
          runNumber: run.run_number, jobs, recorded: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        }));
        console.log(`recorded ${conclusion} for ${sha} from run ${run.id}`);
        if (conclusion !== 'pending') return;
        wrotePending = true;
      }
    }
    if (Date.now() >= deadline) {
      console.log(run
        ? `run ${run.id} is still going at the deadline; the ref says pending.`
        : `no dispatched check run for ${sha} appeared in ${waitMinutes}m; no ref written.`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('dispatched-verdict.mjs')) await main();
