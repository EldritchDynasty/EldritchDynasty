#!/usr/bin/env node
/**
 * DID CI ACTUALLY ANSWER? — AND "NO" IS NOT THE SAME AS "RED".
 *
 * `npm run land` ends by pushing to `main`. That is not the end of the work.
 * Between 2026-09-05 09:02 and 2026-09-06 01:12, seven consecutive pushes to
 * `main` produced a workflow run that concluded in three to five seconds with
 * a single job carrying zero steps — a run that never started, because the
 * repository was out of Actions minutes while it was private. Six of those
 * seven commits were agent landings. Nobody noticed for sixteen hours.
 *
 * Nothing in this repository told an agent a push was unfinished until a
 * verdict came back, and in every UI a red run and a run that never happened
 * are the same colour. This codebase's own thesis, turned on its own CI: it
 * failed by doing nothing, and looked exactly like a feature nobody had
 * exercised yet.
 *
 * So there are FOUR states here, not two:
 *
 *   green    every job succeeded                                      exit 0
 *   red      a job failed, and this names which                       exit 1
 *   absent   no verdict for that commit — CI did not run, or ran and  exit 2
 *            recorded nothing. NOT a pass. Usually not the agent's to
 *            fix, and always the agent's to report.
 *   pending  CI is running and has not answered yet                   exit 3
 *
 * THE FOURTH ONE IS HERE BECAUSE THIS TOOL SHIPPED WITHOUT IT AND WAS WRONG.
 * The first landing to use it reported NO VERDICT for a commit whose `check`
 * run was still in progress — "not yet" reported as "never", which is the
 * same two-states-where-there-are-three mistake the whole issue was about,
 * made inside the fix for it. A pending run and a run that never existed had
 * written the same thing to the refs: nothing.
 *
 * `verdict.yml` now records a run when it STARTS as well as when it finishes,
 * so `pending` is a thing the refs can say. Absence stays honest, because a
 * run that never starts never announces itself either.
 *
 * WHY A GIT REF RATHER THAN THE ACTIONS API. Because the API is not reachable
 * from where this has to run. Measured in an agent container, 2026-09-07:
 *
 *   curl https://api.github.com/repos/JamesFlames/EldritchDynasty/actions/runs
 *   → 403 {"message":"GitHub access is not enabled for this session."}
 *
 * The host is allowed; the session holds no credential for it. Only the MCP
 * tools do, and a script cannot call those. `git fetch` works, including over
 * a custom ref namespace. docs/PARALLEL.md makes the same argument about the
 * claim mutex — "a local agent and a web session do not have the same tools,
 * and both have `git push`" — and this is its other half: they do not have the
 * same API access, and both have `git fetch`.
 *
 * `.github/workflows/verdict.yml` writes `refs/verdict/<sha>` when a `check`
 * run completes. This reads it. Nothing here needs a token, and it behaves
 * identically on a laptop, in a container and inside CI.
 *
 *   npm run verdict                  # HEAD, waiting up to 60 minutes
 *   npm run verdict -- <sha>         # a particular commit
 *   npm run verdict -- --wait 0      # ask once and answer now
 */
import { execFileSync } from 'node:child_process';

/**
 * Long enough for the slowest job, plus the wait to be scheduled at all.
 *
 * Was 25, which was not enough: `check` runs have taken 20-30 minutes and the
 * queue is on top of that. The first landing to use this timed out on a run
 * that finished shortly after. A timeout is not an answer, and a tool whose
 * default produces the wrong one is worse than one that takes longer.
 *
 * Was 40, which was not enough either. On 2026-09-27 the dispatched `check`
 * for 9af68b1 ran 45 minutes (10:58 to 11:43, green), and the remote landing
 * of PR #283 that pushed it gave up at 40 and reported the green landing as
 * a FAILURE. `remote-land.yml` passes its own, larger `--wait`.
 */
export const DEFAULT_WAIT_MINUTES = 60;
/** The ref namespace verdict.yml writes. Not under refs/heads: not a branch. */
const NS = 'refs/verdict';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const tryGit = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
};

/**
 * The verdict recorded for a commit, or null if there is none.
 *
 * Exported and taking the raw message rather than reading the ref itself, so
 * `verdict.test.ts` can hand it messages it must read correctly — including a
 * malformed one. A parser nobody has watched fail is indistinguishable from a
 * parser that cannot.
 */
export function parseVerdict(message) {
  if (!message) return null;
  const field = (name) => new RegExp(`^${name}: (.+)$`, 'm').exec(message)?.[1]?.trim();
  const conclusion = field('conclusion');
  if (!conclusion) return null;
  return {
    conclusion,
    sha: field('sha') ?? '',
    branch: field('branch') ?? '',
    run: field('run') ?? '',
    recorded: field('recorded') ?? '',
    jobs: [...message.matchAll(/^job: (.+?) = (.+)$/gm)].map(([, name, result]) => ({
      name: name.trim(),
      result: result.trim(),
    })),
  };
}

/**
 * green | red | pending | absent, from a verdict that may not exist.
 *
 * `pending` is what `verdict.yml` writes when a run STARTS. Everything else
 * that is not `success` is red — `cancelled` and `timed_out` included. None of
 * those is a build anybody may push on top of, and lumping them together beats
 * a default case that lets an unfamiliar word through as a pass, which is
 * invariant 5's rule applied to a string GitHub owns and may add to.
 */
export function stateOf(verdict) {
  if (!verdict) return 'absent';
  if (verdict.conclusion === 'pending') return 'pending';
  return verdict.conclusion === 'success' ? 'green' : 'red';
}

/** Fetch the namespace. A remote that cannot be reached is not a verdict. */
function refresh() {
  return tryGit('fetch', '--quiet', 'origin', `+${NS}/*:${NS}/*`).ok;
}

/**
 * THE REF IS NAMED FOR THE FULL SHA, AND NOBODY TYPES ONE.
 *
 * `verdict.yml` writes `refs/verdict/<40 hex>`, because that is what
 * `github.event.workflow_run.head_sha` is. This tool looked up
 * `refs/verdict/<whatever was typed>` — so `npm run verdict -- 037da8b`, the
 * form every `git log --oneline`, every landing message and every one of this
 * repository's own docs prints, missed the ref and reported NO VERDICT.
 *
 * That is the worst available answer to get wrong. An absent verdict is the
 * one state this tool exists to distinguish, it is documented as "not a pass
 * and not yours to fix", and its message sends the reader to the
 * repository's Actions minutes. Measured on 2026-09-13: `main` at 037da8b was
 * green, every job passed, the ref was on the remote, and a short sha said
 * CI had never run.
 *
 * So the argument is resolved to a commit before it is used as a name. It
 * takes anything `git rev-parse` does — a short sha, `HEAD~2`, a branch,
 * `origin/main` — which is a bonus rather than the point. A full sha is used
 * as given, so a commit this checkout does not have can still be asked about.
 */
export function resolveSha(given) {
  if (!given) return git('rev-parse', 'HEAD');
  if (/^[0-9a-f]{40}$/i.test(given)) return given.toLowerCase();

  const r = tryGit('rev-parse', '--verify', '--quiet', `${given}^{commit}`);
  if (r.ok && /^[0-9a-f]{40}$/i.test(r.out)) return r.out.toLowerCase();

  // NOT the absent message: this is "could not ask", not "nothing answered",
  // and the difference is the whole subject of this file.
  console.error(`verdict: '${given}' does not name a commit in this checkout.`);
  console.error('A verdict ref is named for the full 40-character sha, so a short one has to');
  console.error('be resolved here first. Fetch the commit, or pass the full sha.');
  process.exit(EXIT.absent);
}

function verdictFor(sha) {
  const r = tryGit('log', '-1', '--format=%B', `${NS}/${sha}`);
  return r.ok ? parseVerdict(r.out) : null;
}

const EXIT = { green: 0, red: 1, absent: 2, pending: 3 };

function report(sha, verdict) {
  const state = stateOf(verdict);
  if (state === 'green') {
    console.log(`green — ${sha.slice(0, 7)} passed every job.`);
    for (const j of verdict.jobs) console.log(`  ${j.name}: ${j.result}`);
    if (verdict.run) console.log(`  ${verdict.run}`);
  } else if (state === 'red') {
    console.log(`RED — ${sha.slice(0, 7)}: ${verdict.conclusion}.`);
    for (const j of verdict.jobs) {
      console.log(`  ${j.result === 'success' ? ' ' : '✗'} ${j.name}: ${j.result}`);
    }
    if (verdict.run) console.log(`  ${verdict.run}`);
    console.log('\nFix it and land again. `npm run land` re-runs the whole set on the rebased head.');
  } else if (state === 'pending') {
    console.log(`STILL RUNNING — ${sha.slice(0, 7)} has not been judged yet.`);
    if (verdict.run) console.log(`  ${verdict.run}`);
    console.log('');
    console.log('This is not an absence and not a pass. CI started and has not');
    console.log('finished. Ask again — `npm run verdict` — or raise --wait.');
  } else {
    console.log(`NO VERDICT for ${sha.slice(0, 7)}.`);
    console.log('');
    console.log('This is NOT a pass. CI either never ran for this commit, or ran and');
    console.log('recorded nothing. Seven landings on `main` went this way over sixteen');
    console.log('hours in September 2026 and every one of them looked fine.');
    console.log('');
    console.log('An agent cannot fix it and must not absorb it: say so, and name the');
    console.log('commit. If `check.yml` runs are concluding in seconds with no steps,');
    console.log("the repository's Actions minutes are the first thing to look at.");
  }
  return EXIT[state];
}

async function main() {
  const sha = resolveSha(positional[0]);
  const waitMinutes = Number(flag('wait', DEFAULT_WAIT_MINUTES));
  const deadline = Date.now() + waitMinutes * 60_000;

  if (!refresh()) {
    console.error('verdict: could not reach the remote. No verdict is not a pass.');
    process.exit(EXIT.absent);
  }

  // Wait through `absent` AND `pending` alike: neither is an answer. They are
  // reported differently at the deadline because they mean opposite things —
  // one says CI is working, the other says nothing is coming.
  let verdict = verdictFor(sha);
  if (waitMinutes > 0 && stateOf(verdict) !== 'green' && stateOf(verdict) !== 'red') {
    console.log(`waiting up to ${waitMinutes}m for a verdict on ${sha.slice(0, 7)}…`);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30_000));
      refresh();
      verdict = verdictFor(sha);
      const s = stateOf(verdict);
      if (s === 'green' || s === 'red') break;
    }
  }

  process.exit(report(sha, verdict));
}

// Importable by the test, runnable as a command.
if (process.argv[1] && process.argv[1].endsWith('verdict.mjs')) await main();
