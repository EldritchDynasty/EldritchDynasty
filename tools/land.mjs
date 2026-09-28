#!/usr/bin/env node
/**
 * THE LANDING, AS ONE COMMAND, RUNNING THE SAME SET CI RUNS.
 *
 * AGENTS.md carries standing authorisation to fast-forward `main` with no pull
 * request "as soon as `npm run check` is green". CI runs THREE jobs. `check` is
 * `typecheck && validate && test` — it does not run the gates.
 *
 * That gap is not theoretical. Four of the eleven red runs of `check.yml` on
 * `main` in runs 61-100 failed at the `gates` step, each one AFTER the whole
 * test suite had been green for forty-one minutes. An agent that ran the check,
 * saw green and pushed did exactly what the rulebook told it to and broke trunk.
 *
 * docs/PARALLEL.md patched over it by asking the agent to classify its own diff
 * first — gates "after the rebase, always" for content, `test:fast` and a gate
 * for docs — which is a decision made before the answer is known, with a
 * shorter path available for getting it wrong.
 *
 * So the landing is one command and the set is derived, not remembered:
 * `land.test.ts` reads `.github/workflows/check.yml` and fails the build if CI
 * grows a job this does not run. That is the same argument check.yml already
 * makes for iterating GATES rather than naming gates in a list — gate 2 was
 * written for CI and wired into nothing for its whole life under a hand-kept
 * list. This is that argument one level up.
 *
 *   npm run land                     # fetch, rebase, install, the whole set,
 *                                    # push, then WAIT for CI
 *   npm run land -- --status         # is a landing running, or did one die?
 *   npm run land -- --dry-run        # print the plan and do none of it
 *   npm run land -- --no-verdict     # push and do not wait to be judged
 *   npm run land -- --no-issue-check # land even though the branch names an
 *                                    # issue no commit closes
 *   npm run land -- --full           # the whole set even on a docs-only diff
 *
 * A DIFF OF ONLY MARKDOWN, ON A GREEN BASE, RUNS THE SHORT SET — typecheck,
 * validate and the fast lane, which is CI's short tier and holds every test
 * that reads a markdown file. The gates and the slow suites cannot see one.
 * The rule, and why it is not the self-classification described below, is in
 * `tools/docs-only.mjs`; it is decided on the REBASED head, never before.
 *
 * IN A WEB SESSION, START IT SO THAT IT SURVIVES THE SESSION. A landing runs
 * for about an hour and a remote container is paused between turns; twice on
 * 2026-09-08 a `nohup … &` landing was killed by that pause and left no
 * error, no exit code and a log that simply stopped. Use the harness's own
 * tracked background run instead — see AGENTS.md, "Working style". If you
 * come back and are not sure, `--status` answers it.
 *
 * What this does NOT do is put the gates in the fix-and-rerun loop. `npm run
 * gate` is nine minutes; it belongs here, once, on the rebased head. The loop
 * is still `npm run test:fast`.
 *
 * ── AND IT IS NOW THE ONLY FULL SET A DRAFT BRANCH GETS ───────────────────
 *
 * `check.yml` is tiered (#144): a DRAFT pull request runs typecheck, validate
 * and the fast lane, and everything else — every push to `main`, every tag,
 * every manual dispatch, every pull request that is not a draft — runs the
 * whole thing. That was always the shape of a landing anyway, because a
 * landing pushes to `main`, and the push it makes is judged by the full set.
 *
 * It does make this command load-bearing in a way it was not: on a draft
 * branch, the steps below are the only place the slow suites and the gates
 * run before the push. `land.test.ts` is what keeps that honest — the step
 * set is still DERIVED from the workflow, and `ciScripts` cannot see an `if:`
 * at all, so a tier can never quietly subtract a job from what this runs.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { nodeModulesLinkType, npmInvocation } from './portable.mjs';
import { DOCS_ONLY_STEPS, landingPlan } from './docs-only.mjs';\nimport { closingIssues } from './closing-keywords.mjs';

/** This checkout, derived from the script rather than from the cwd. */
const REPO = join(import.meta.dirname, '..');

/**
 * The npm scripts a landing runs, in order, ON THE REBASED HEAD.
 *
 * Ordered cheapest-first so a broken template fails in seconds rather than
 * after the suite. CI runs its three jobs in PARALLEL for the opposite reason —
 * a serial run reports only the first thing wrong — but a landing has one
 * terminal and an agent waiting on it, and there the first failure is the
 * answer it needs.
 */
export const STEPS = ['typecheck', 'validate', 'build:client', 'test', 'gates'];

/**
 * ── THE TWO STEPS THAT RUN AT THE SAME TIME ───────────────────────────────
 *
 * A landing ran its four steps back to back because that is the order a
 * terminal reads in. Two of them are almost all of it, and they do not
 * compete for the same machine:
 *
 *   npm test    ~40 min, and vitest gives it a worker per core — 4 on the
 *               container this is measured on.
 *   npm run gates  ~36 min, and it is ONE node process running the gate table
 *               in a serial `for` loop. One core, for thirty-six minutes,
 *               while three sat idle behind the test run that just finished.
 *
 * Sequentially that is about 76 minutes of wall clock for about 196 core-
 * minutes of work. Run together on four cores the same work packs into
 * roughly 49. Nothing is skipped and nothing is sampled differently — the
 * gates play the same runs either way, because every stream is derived from
 * `(runSeed, …)` and not from the wall clock or from what else is running.
 *
 * THE CHEAP STEPS STILL GO FIRST, AND STILL GO ONE AT A TIME. `typecheck` and
 * `validate` are about twenty-three seconds together and they are the ones
 * that catch a broken template or a bad schema, so a landing should still
 * fail in seconds rather than after the suite. Only the long pair overlaps.
 *
 * IT ALSO REPORTS BOTH. A serial landing dies at the first failure, so a red
 * test hides a moved gate and costs another 76 minutes to find — which is the
 * argument `check.yml` makes for running its jobs separately, and it was true
 * of the landing the whole time it was written down there. Both run to
 * completion now and a failure names every step that failed.
 */
export const CONCURRENT = ['test', 'gates'];

/**
 * The steps split into the phase each belongs to, in `STEPS` order.
 *
 * A function over the step list rather than two hand-kept arrays, so nothing
 * can be in both and nothing can fall out of the landing by being in neither
 * — `land.test.ts` hands it lists it must partition. The same reason
 * `ciScripts` is a function over the workflow rather than a reader of one.
 */
export function landPhases(steps = STEPS) {
  const long = new Set(CONCURRENT);
  return {
    alone: steps.filter((s) => !long.has(s)),
    together: steps.filter((s) => long.has(s)),
  };
}

/**
 * CI steps that provably cannot fail a build, and so are not part of a landing.
 *
 * `prose-lint.ts` ends in `process.exit(0)` unconditionally and says why:
 * `prose/voice` is warning-level only, because "a linter that blocks writers
 * gets disabled within a fortnight". It prints GitHub annotations. Running it
 * here would cost a content load to produce output nobody is reading.
 *
 * `corpus` warms the run corpus, and is advisory for a different reason from
 * `lint:prose`: the corpus is a CACHE of played millennia, keyed on the
 * content and the simulation sources, and `playedRun` falls back to playing
 * the run on any failure to read or write one. A warm that fails costs the
 * suite its speed-up and cannot cost it its correctness — the workflow step
 * carries `continue-on-error: true` to say the same thing to the runner. A
 * landing does not warm it either: that is seven minutes of runs to make a
 * cache CI will not share with this machine.
 *
 * Anything CI runs that is in neither list fails `land.test.ts`. That is the
 * point: a fourth job cannot be added to the workflow and quietly not be part
 * of what an agent runs before it pushes to trunk.
 */
export const ADVISORY = ['lint:prose', 'corpus'];

/** Environment, not a check. Every job starts with it and none of them is testing it. */
const SETUP = ['ci', 'install'];

/**
 * A SCRIPT CI RUNS THAT THE LANDING COVERS BY RUNNING A SUPERSET OF IT.
 *
 * `test:fast` is `test` minus the `*.slow.test.ts` suites. The Windows job
 * runs it because the question there is whether the TOOLING runs on the other
 * platform, and the suites that spawn the real scripts are all in that lane;
 * a landing that runs the whole suite has already run every test in it.
 *
 * This is a SUBSET DECLARATION and not a suppression, which is the difference
 * worth keeping: the entry names what covers it, so the day `test:fast` stops
 * being a subset of `test` this line is wrong in a way somebody reading it can
 * see. Adding `test:fast` to `STEPS` instead would make every landing re-run
 * the fast lane it is about to run again inside `test`, for no new fact.
 *
 * What the landing CANNOT cover is the platform itself. It runs on whatever
 * machine the agent is on, so a green landing says the suite passes there —
 * the Windows job is the only thing that says it passes on Windows, and no
 * arrangement of steps here can stand in for a second runner.
 */
const COVERED = { 'test:fast': 'test' };

/**
 * Every npm script `check.yml` runs, as script names.
 *
 * A function over the workflow TEXT rather than a script that reads one file,
 * so the test can hand it a workflow it must reject — a rule nobody has watched
 * fail is indistinguishable from a rule that cannot.
 *
 * Deliberately naive about YAML: it matches `npm ...` anywhere in the file,
 * including inside comments. A comment mentioning a command CI does not run
 * makes this OVER-report, which fails the build and gets read. The other
 * direction — a real step this misses — is the one that would be silent, and
 * a `run:` line is the only place a bare `npm` appears in practice.
 */
export function ciScripts(workflow) {
  const found = new Set();
  for (const [, run, name] of workflow.matchAll(/\bnpm (?:(run|test|ci|install)\b)\s*([\w:-]*)/g)) {
    if (run === 'run' && name) found.add(name);
    else if (run && run !== 'run') found.add(run);
  }
  for (const s of SETUP) found.delete(s);
  for (const [narrow, wide] of Object.entries(COVERED)) {
    if (found.has(narrow) && STEPS.includes(wide)) found.delete(narrow);
  }
  return found;
}

/**
 * A BRANCH NAMED FOR AN ISSUE THAT LANDS WITHOUT CLOSING IT.
 *
 * `claude/issue-106-grlfdh` landed clean, CI went green, and #106 stayed
 * open: the commit's TITLE carried `(#106)`, which GitHub does not read, and
 * no commit said `Closes #106`, which it does. Nothing failed, so nothing
 * said so — this codebase's house failure mode, applied to its own process.
 * The convention was already written down, correctly, in AGENTS.md and
 * docs/PARALLEL.md; a session that read `CLAUDE.md` and went straight to
 * `npm run land` never saw the sentence. Documentation that has to be found
 * is a check that has to be remembered, and this repository does not trust
 * that shape anywhere else.
 *
 * `janitor.mjs` already asks this exact question — "#$slug is still OPEN and
 * no landing commit named it" — but only for a CLAIMED issue, and only after
 * the merge. This asks it before the push, off the branch-naming convention
 * every session gets for free (`claude/issue-<N>-...`), whether or not the
 * claim protocol was used.
 *
 * A pure function over two strings, the same shape as `ciScripts`: nothing
 * here calls git, so a test can hand it a commit log it must reject without
 * landing anything. The keyword pattern is copied from `janitor.mjs` rather
 * than re-derived, so what this refuses to land and what GitHub would have
 * closed anyway never disagree — `Closes #93, #94` closes only #93 there,
 * and closes only #93 here for the same reason: the keyword must sit
 * immediately before EACH number.
 */
/**
 * AND THE BRANCH NAME IS THE HALF THAT WEB SESSIONS DO NOT HAVE.
 *
 * The check above reads `claude/issue-106-grlfdh` and finds 106. A web
 * session's branch is named by the harness BEFORE it has read the tracker —
 * `claude/three-issues-8e7grn` — so there is no number in it to find, this
 * returned null, and the landing said nothing. The session most likely to
 * forget the convention is the one shape this could not see.
 *
 * The claim refs already know. `agents.mjs` records the branch on every
 * `claim/<issue>` and already prints the exact line a landing commit needs;
 * `land.mjs` simply never asked. So `held` is those issue numbers, gathered
 * by the caller (this stays a pure function over strings, the same as
 * `ciScripts`, so a test can hand it a log it must reject).
 */
export function issueLeftOpen(branch, commitLog, held = []) {
  const fromName = branch.match(/issue-(\d+)/)?.[1];
  const wanted = [...new Set([...(fromName ? [fromName] : []), ...held.map(String)])];
  if (!wanted.length) return null;

  const closes = (n) =>
    new RegExp(`\\b(clos(e|es|ed)|fix(e[sd])?|resolv(e|es|ed))\\s+#${n}\\b`, 'i').test(commitLog);
  const open = wanted.filter((n) => !closes(n));
  if (!open.length) return null;

  const list = open.map((n) => `#${n}`).join(', ');
  const keywords = open.map((n, i) => `${i === 0 ? 'Closes' : 'closes'} #${n}`).join(', ');
  const how = wanted.length === 1
    ? `this branch is for issue ${list}, and no commit in it says "Closes ${list}"`
    : `this branch holds ${wanted.map((n) => `#${n}`).join(', ')}, and no commit in it closes ${list}`;

  return `${how} — the keyword GitHub actually reads. "(${list})" in a title is ` +
    `decoration, not a closing keyword: it will land, CI will go green, and the ` +
    `issue stays open with nothing saying so. The keyword must sit immediately ` +
    `before EACH number, so the line is "${keywords}". Add it to a commit, or ` +
    `land anyway with --no-issue-check.`;
}

// ── the landing itself ───────────────────────────────────────────────────────

const DRY = process.argv.includes('--dry-run');
const NO_VERDICT = process.argv.includes('--no-verdict');
const NO_ISSUE_CHECK = process.argv.includes('--no-issue-check');
const STATUS = process.argv.includes('--status');
const FULL = process.argv.includes('--full');

/**
 * Commit messages unique to this branch, best effort. Checked before the
 * fetch below, so a stale local `origin/main` can only make this MORE
 * lenient — a commit already on main slipping into the range still cannot
 * produce a false "not closed". A missing `origin/main` ref falls back to
 * recent history rather than skipping the check outright.
 */
function ownCommitMessages() {
  try {
    return git('log', '--format=%B', 'origin/main..HEAD');
  } catch {
    try { return git('log', '-20', '--format=%B'); } catch { return ''; }
  }
}

/**
 * THE ISSUES THIS BRANCH HAS CLAIMED, off the same refs `agents.mjs` writes.
 *
 * A claim is an orphan commit at `claim/<slug>` whose message carries
 * `agent: <branch>`, and `npm run agents -- check` already prints the closing
 * line a landing needs from exactly this data. Reading it here is what lets
 * `issueLeftOpen` protect a branch whose NAME carries no issue number, which
 * is every branch a web session is handed.
 *
 * Best effort on purpose, and never a blocker of its own: an unreachable
 * remote or a repository with no claims at all returns nothing and the
 * landing proceeds on the branch-name check alone. A claim system that can
 * stop a green landing when the network hiccups is worse than the gap.
 */
function claimedIssues(branch) {
  const fetched = tryGit(
    'fetch', '--quiet', '--prune', 'origin', '+refs/heads/claim/*:refs/remotes/origin/claim/*',
  );
  if (!fetched.ok) return [];

  const refs = tryGit('for-each-ref', '--format=%(refname)', 'refs/remotes/origin/claim/');
  if (!refs.ok || !refs.out) return [];

  const issues = [];
  for (const ref of refs.out.split('\n').filter(Boolean)) {
    const slug = ref.slice('refs/remotes/origin/claim/'.length);
    if (!/^\d+$/.test(slug)) continue;          // `lane-content` is a lane, not an issue
    const body = tryGit('log', '-1', '--format=%B', ref);
    if (!body.ok) continue;
    const field = (k) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(body.out)?.[1]?.trim() ?? '';
    if (field('released')) continue;            // a tombstone is a free issue
    if (field('agent') === branch) issues.push(slug);
  }
  return issues;
}

const say = (s) => console.log(s);
const die = (s) => {
  console.error(`land: ${s}`);
  process.exit(1);
};

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** `git`, for the questions where "it did not work" is an answer rather than a crash. */
const tryGit = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
};

/**
 * ONE LANDING PER CHECKOUT, AND IT SAYS SO.
 *
 * A landing was declared dead — its output file was empty and no `vitest`
 * process was visible — and a second was started against the same working
 * tree. It was not dead; it was between steps. Two landings then ran over one
 * checkout, and the first of them pushed a commit the second had made.
 *
 * An empty log and an absent child process are both equally consistent with
 * "running", so no amount of looking would have settled it. The sentence that
 * was missing is the one this prints.
 *
 * A pid file under `.git/` rather than a ref: this is a single-checkout
 * problem. Two SESSIONS landing at once is already handled, and more strongly
 * — the push is a compare-and-swap and the server rejects the loser.
 */
const LOCK = join(git('rev-parse', '--git-dir'), 'land.lock');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * WHAT THE LOCK REMEMBERS, AND WHY IT IS MORE THAN A PID.
 *
 * A landing takes an hour. A session does not. Twice on 2026-09-08 a landing
 * started with `nohup … &` was simply GONE the next time anybody looked — no
 * exit code, no error, the log stopping mid-suite after `blood.test.ts` with
 * a green tick as its last line. The container it ran in was paused between
 * turns and the detached process did not survive that; the harness's own
 * tracked background run, given the identical command, ran the same landing
 * to `landed, and judged.`
 *
 * Diagnosing it took four manual probes both times — `ps aux`, a log tail,
 * `cat .git/land.lock`, `git worktree list` — because nothing in the tool
 * said "this died". `land.mjs` cannot stop being killed, and it cannot tell
 * from in here whether it was started in a way that will survive. What it
 * can do is make the corpse legible, which is the same trade every other
 * guard in this file makes.
 *
 * So the lock is the black box: it carries where the landing GOT TO, not
 * only who was running it, and `--status` reads it back out. The step past
 * `push` is the one that matters most — that landing put a commit on `main`
 * and did not stay to hear the verdict, which is docs/COMMANDS.md's "an
 * absent verdict is not a pass" arriving by a different road.
 */
function readLock() {
  if (!existsSync(LOCK)) return null;
  try {
    return JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    return null;   // an unreadable lock is not a landing
  }
}

/** The landing in progress, held here so `mark` can say where it got to. */
let held = null;

/** The live landing holding this checkout, as a blocker line, or false. */
function lockHolder() {
  const running = readLock();
  if (!running || !alive(running.pid)) return false;
  return `a landing is already running (pid ${running.pid}), started ${running.started},\n` +
    `      at ${running.step ?? 'an unrecorded step'}.\n` +
    `      Two landings over one working tree is how an unverified commit reached\n` +
    `      \`main\` on 2026-09-07. Wait for it, or kill it and remove ${LOCK}.`;
}

/**
 * WHERE A LANDING GOT TO, WRITTEN DOWN AS IT GOES.
 *
 * Cheap — one small file rewrite per step, against steps that take minutes —
 * and it is the whole difference between "it is gone" and "it died in
 * `npm run test`, having pushed nothing".
 */
function mark(step, extra = {}) {
  if (!held) return;
  held = { ...held, ...extra, step };
  // A note that cannot be written must not take the landing down with it.
  try { writeFileSync(LOCK, JSON.stringify(held)); } catch { /* the landing matters more */ }
}

/**
 * WHAT A DEAD LANDING LEFT ON DISK.
 *
 * `sweep` is registered on `process.on('exit')`, which does not run for a
 * process that was killed rather than ended — so every silent death leaves a
 * registered worktree and a `/tmp/ed-landing-*` directory behind it. Two of
 * them were still there when this was written.
 */
function sweepShed(tree) {
  if (!ourShed(tree)) return;
  try { execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch { /* gone */ }
  try { rmSync(dirname(tree), { recursive: true, force: true }); } catch { /* gone */ }
  try { execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' }); } catch { /* nothing to prune */ }
}

/**
 * A RECURSIVE DELETE DRIVEN BY A FILE ON DISK GETS A GUARD.
 *
 * `sweepShed` reads its path out of `land.lock`, which is JSON that anything
 * can write, and then calls `rmSync(…, { recursive: true, force: true })` on
 * the parent of it. That is the shape that takes a directory nobody meant —
 * so it only ever sweeps a path this tool could itself have made:
 * `mkdtempSync(join(tmpdir(), 'ed-landing-'))` plus `/checkout`. The janitor
 * refuses a shallow clone for the same class of reason; a delete that is
 * merely PROBABLY right is not right.
 */
export function ourShed(tree, tmp = tmpdir()) {
  if (typeof tree !== 'string' || !tree) return false;
  if (basename(tree) !== 'checkout') return false;
  const shed = dirname(tree);
  return dirname(shed) === tmp && basename(shed).startsWith('ed-landing-');
}

/**
 * A LANDING THAT WAS KILLED RATHER THAN FINISHED, IN WORDS.
 *
 * The one thing it must never do is guess about `main`. `verdict` is the only
 * step that proves the push succeeded; `push` itself is genuinely ambiguous
 * and is reported as ambiguous rather than resolved in either direction.
 *
 * Returns lines rather than printing them, so a test can read the three
 * readings without killing a landing to produce one — the same shape as
 * `ciScripts` and `issueLeftOpen` above.
 */
export function deathReading(dead) {
  const at = dead.step ?? 'an unrecorded step';
  const on = dead.target ? ` on ${dead.target.slice(0, 7)}` : '';
  const lines = [
    `pid ${dead.pid}, started ${dead.started},`,
    `and it got as far as ${at}${on}.`,
  ];
  if (dead.step === 'verdict') {
    lines.push(
      'IT HAD ALREADY PUSHED: that commit is on `main` and nobody heard the',
      'verdict. Run `npm run verdict` against it — an absent verdict is not a',
      'pass, and re-landing is not what it needs.',
    );
  } else if (dead.step === 'push') {
    lines.push(
      'IT DIED DURING THE PUSH and may or may not have landed. Check',
      '`git log --oneline -1 origin/main` before re-running.',
    );
  } else {
    lines.push(
      'Nothing of it reached `main`. `npm run land` clears this and starts again.',
    );
  }
  return lines;
}

function takeLock() {
  const dead = readLock();
  if (dead) {
    say('\n  A PREVIOUS LANDING DID NOT FINISH:');
    for (const line of deathReading(dead)) say(`  ${line}`);
    sweepShed(dead.tree);
  }
  held = { pid: process.pid, started: new Date().toISOString(), step: 'fetch' };
  writeFileSync(LOCK, JSON.stringify(held));
  // Released however this ends, including a failing step — a lock that outlives
  // its holder turns one bad landing into every future landing refusing.
  const drop = () => { try { unlinkSync(LOCK); } catch { /* already gone */ } };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { drop(); process.exit(130); });
  }
}

/**
 * THE READING, WITHOUT DOING ANYTHING — the command that was missing.
 *
 * Reports, never acts: the sweep belongs to the next real landing, the same
 * way `--dry-run` reports preconditions rather than fixing them. An agent
 * returning to a session it left an hour ago asks this instead of assembling
 * the answer out of `ps`, a log tail and two git commands.
 */
function status() {
  const seen = readLock();
  if (!seen) {
    say('no landing is running, and none left a mark on this checkout.');
    return 0;
  }
  if (alive(seen.pid)) {
    say(`a landing is RUNNING: pid ${seen.pid}, started ${seen.started},`);
    say(`  at ${seen.step ?? 'an unrecorded step'}${seen.target ? ` on ${seen.target.slice(0, 7)}` : ''}.`);
    return 0;
  }
  say('a landing DIED:');
  for (const line of deathReading(seen)) say(`  ${line}`);
  return 1;
}

/** Inherit the terminal: an agent watching a nine-minute gate needs to see it move. */
const run = (cmd, args, cwd) => spawnSync(cmd, args, { stdio: 'inherit', cwd }).status === 0;

/**
 * The two Windows facts a landing needs — npm is a `.cmd` shim that cannot be
 * spawned without a shell, and a directory symlink is a privilege a junction
 * is not. Both live in `tools/portable.mjs` now, with the rest of them, and
 * are re-exported here because `land.test.ts` has always asked this module for
 * them and a landing is the loudest place either one can go wrong.
 */
export { npmInvocation, nodeModulesLinkType };
const NPM = npmInvocation();
const runNpm = (args, cwd) => run(NPM.command, [...NPM.prefix, ...args], cwd);
const startNpm = (args, cwd, options) => start(NPM.command, [...NPM.prefix, ...args], cwd, options);

/**
 * One step, started rather than waited for, so two can be in flight at once.
 *
 * `spawnSync` cannot be used for both: it blocks the event loop, so the other
 * process's stdout would sit unread in a 64KB pipe until it filled and then
 * BLOCK THAT PROCESS — a landing that deadlocks at minute forty rather than
 * one that fails. Both are spawned properly and both are drained.
 *
 * ONE OF THEM IS STREAMED AND THE REST ARE HELD. Two writers on one terminal
 * interleave into something nobody can read, and a landing's output is read
 * by an agent that has to act on it. So the first long step writes through
 * live — it is the one with a progress reporter, and it is the difference
 * between "working" and "hung" for forty minutes — and the others are kept
 * whole and printed under their own heading when they finish.
 */
export function start(cmd, args, cwd, { live }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (d) => { out += d; if (live) process.stdout.write(d); };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => resolve({ ok: false, out: `${out}\n${e.message}` }));
    p.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}

async function main() {
  // Before anything else, and doing nothing else: this is the question an
  // agent asks when it does not know whether its landing is alive.
  if (STATUS) process.exit(status());

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

  /**
   * A shallow clone answers ancestry questions WRONGLY rather than refusing, so
   * a rebase onto a graft boundary is not a rebase. tools/orient.mjs unshallows
   * from the SessionStart hook; this is for the sessions where it did not run.
   */
  const blockers = [
    lockHolder(),
    git('rev-parse', '--is-shallow-repository') === 'true' &&
      'this clone is shallow — `git fetch --unshallow`, or run `node tools/orient.mjs`.\n' +
      '  Ancestry answers here are noise, and a rebase is an ancestry answer.',
    git('status', '--porcelain') && 'working tree is dirty. Commit or stash before landing.',
    branch === 'main' && 'already on main — land from the feature branch.',
    !NO_ISSUE_CHECK && issueLeftOpen(branch, ownCommitMessages(), claimedIssues(branch)),
  ].filter(Boolean);

  say(`landing ${branch} → main`);
  say(`  fetch · rebase · ${STEPS.map((s) => `npm run ${s}`).join(' · ')} · push`);

  // A dry run REPORTS the preconditions rather than stopping at the first one.
  // Being told about the dirty tree and then, on the next attempt, about the
  // shallow clone is two round trips to learn one thing.
  if (DRY) {
    // Against the local `origin/main`, unfetched and unrebased — so a preview.
    // The real landing decides again on the rebased head.
    if (!FULL) {
      const plan = tryGit('rev-parse', 'origin/main').ok
        ? landingPlan(git('rev-parse', 'origin/main'), 'HEAD')
        : { short: false, reason: 'no local origin/main to compare against' };
      say(`\n  would run the ${plan.short ? 'SHORT' : 'full'} set — ${plan.reason}`);
    }
    for (const b of blockers) say(`\n  would stop: ${b}`);
    say(`\n--dry-run: nothing was fetched, rebased, run or pushed.`);
    process.exit(blockers.length ? 1 : 0);
  }
  if (blockers.length) die(blockers[0]);
  takeLock();

  say('\n$ git fetch origin main');
  if (!run('git', ['fetch', 'origin', 'main'])) die('fetch failed.');

  mark('rebase');
  say('\n$ git rebase origin/main');
  if (!run('git', ['rebase', 'origin/main'])) {
    die('rebase left conflicts. Resolve them, `git rebase --continue`, then run this again.\n' +
        '      Never hand-resolve packages/content/loci.yaml or docs/VOCABULARY.md — take\n' +
        '      either side and regenerate (npm run gen:loci, npm run gen:docs).');
  }

  // A REBASE CAN BRING IN A DEPENDENCY, AND A STALE node_modules THEN REPORTS A
  // RED THAT IS NOT THERE.
  //
  // The first landing to hit this got two typecheck errors in a client test it
  // had never touched: `@vue/test-utils` was declared in `package.json` by
  // another session's commit and absent from this container. `main` was fine.
  // Nothing about the message said so, and the obvious next move — read the
  // failing test, look for the bug — is a wasted session.
  //
  // So it installs, unconditionally, and `.claude/hooks/session-start.mjs`
  // already carries the argument for why there is no condition: "It costs about
  // eleven seconds. Deciding about it costs more than that."
  mark('install');
  say('\n$ npm install');
  if (!runNpm(['install', '--no-audit', '--no-fund'])) {
    die('npm install failed on the rebased head. Nothing was pushed.');
  }

  /**
   * THE COMMIT BEING LANDED, NAMED ONCE AND USED FOR EVERYTHING AFTER.
   *
   * `git push origin HEAD:main` resolves HEAD AT PUSH TIME, half an hour after
   * the steps that verified it. On 2026-09-07 a landing that started at
   * 891cac5, and verified 891cac5, pushed 02183f5 — a commit made while it ran
   * and never seen by a single step. It went to trunk under `9/9 gates pass`
   * and CI failed it.
   *
   * Pushing the SHA instead means a commit made during the run is simply not
   * landed, which is the right answer and needs no guard to notice.
   */
  const target = git('rev-parse', 'HEAD');
  mark('worktree', { target });
  say(`\n  landing ${target.slice(0, 7)} — commits made from here on are not in it.`);

  /**
   * THE STEPS RUN IN A PRISTINE CHECKOUT, NOT IN YOURS.
   *
   * They used to run against the live working tree, which meant a landing and
   * its own session could not share a container. On 2026-09-07 a landing was
   * started, the next issue was worked while its half-hour suite ran, and the
   * suite therefore verified a tree carrying changes the push would not carry.
   * A green run over the wrong tree is worse than a red one, because it is
   * believed.
   *
   * The guard for that was to re-check the tree before pushing and abandon the
   * landing if it had moved — correct, and it made a thirty-minute command
   * that forbids you to type. This removes the condition instead: the steps
   * run in a detached worktree at `target`, so what they verify is exactly
   * what will be pushed, and the session's own tree is free the whole time.
   *
   * It is what CI does, for the same reason.
   *
   * `node_modules` is SYMLINKED rather than installed again: it was installed
   * above, against the lockfile at `target`, which is the lockfile being
   * verified. Measured on this repository — the worktree costs 0.08s to make,
   * and the fast lane inside it reports 89 files and 1,725 tests in 56.87s
   * against 59.44s in the main checkout, which is the same number.
   */
  const shed = mkdtempSync(join(tmpdir(), 'ed-landing-'));
  const tree = join(shed, 'checkout');
  say(`\n$ git worktree add --detach ${tree} ${target.slice(0, 7)}`);
  if (!run('git', ['worktree', 'add', '--detach', '--quiet', tree, target])) {
    die('could not create the landing worktree. Nothing was pushed.');
  }
  const modulesLink = join(tree, 'node_modules');

  // Removed however this ends. A worktree left behind is registered in
  // `.git/worktrees` and the next `git worktree add` at the same path refuses.
  const sweep = () => {
    // On Windows this is a junction into the live checkout. Remove the link
    // first so neither Git nor a recursive fallback can follow it and erase
    // the dependency cache it points at.
    try { unlinkSync(modulesLink); } catch { /* absent or already removed */ }
    try { execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch { /* gone */ }
    try { rmSync(shed, { recursive: true, force: true }); } catch { /* gone */ }
  };
  process.on('exit', sweep);
  // Register cleanup BEFORE making the link: if link creation itself fails,
  // the worktree must not be left registered for the next landing to trip on.
  symlinkSync(join(REPO, 'node_modules'), modulesLink, nodeModulesLinkType());
  // Written down so the NEXT landing can sweep it if this one is killed:
  // `process.on('exit')` above does not run for a process that was killed.
  mark('worktree', { tree });

  // Everything below is ON THE REBASED HEAD, which is the whole point. A branch
  // that was green against the base it forked from says nothing about the base
  // it lands on — two content branches can each pass every gate and their merge
  // fail gate 4, with no overlap between the two diffs.
  //
  // Which set, decided HERE: after the rebase, against the commit being
  // pushed. `origin/main` is what CI will call `before`, so the landing and
  // the build classify the same diff against the same verdict.
  const plan = FULL
    ? { short: false, reason: '--full' }
    : landingPlan(git('rev-parse', 'origin/main'), target);
  say(`\n  ${plan.short ? 'SHORT set' : 'full set'} — ${plan.reason}.`);
  if (plan.short) say(`  ${DOCS_ONLY_STEPS.map((s) => `npm run ${s}`).join(' · ')}; --full for everything.`);
  const { alone, together } = landPhases(plan.short ? DOCS_ONLY_STEPS : STEPS);

  // Cheapest first, and one at a time. Twenty-three seconds that catch a
  // broken Vue template or a bad schema, before anything spends forty minutes.
  for (const step of alone) {
    mark(step);
    say(`\n$ npm run ${step}`);
    if (!runNpm(['run', step], tree)) {
      die(`\`npm run ${step}\` failed on ${target.slice(0, 7)}. Nothing was pushed.`);
    }
  }

  // Then the long pair, at the same time. See `CONCURRENT` for the measurement.
  if (together.length) {
    mark(together.join('+'));
    say(`\n$ ${together.map((s) => `npm run ${s}`).join('  &  ')}`);
    if (together.length > 1) {
      say(`  together — ${together[0]} streams below, the rest are printed whole when they finish.`);
    }

    const done = await Promise.all(together.map((step, i) => (
      startNpm(['run', step], tree, { live: i === 0 }).then((r) => ({ step, ...r }))
    )));

    // The held ones, in `STEPS` order, each under its own heading.
    for (const r of done.slice(1)) {
      say(`\n── npm run ${r.step} ──`);
      process.stdout.write(r.out.endsWith('\n') ? r.out : `${r.out}\n`);
    }

    // EVERY step that failed, not the first. A serial landing died at the
    // first one, so a red test hid a moved gate and cost another 76 minutes
    // to find it — the same argument `check.yml` makes about its own jobs.
    const failed = done.filter((r) => !r.ok).map((r) => r.step);
    if (failed.length) {
      const which = failed.map((f) => `\`npm run ${f}\``).join(' and ');
      die(`${which} failed on ${target.slice(0, 7)}. Nothing was pushed.`);
    }
  }

  /**
   * WHAT WAS TESTED MUST BE WHAT IS PUSHED.
   *
   * The tree is checked for cleanliness at the top and then the steps run for
   * half an hour, during which nothing stopped the agent editing files. The
   * session that wrote this did exactly that: it started a landing, worked on
   * the next issue while the suite ran, and the suite therefore verified a
   * working tree that included uncommitted changes the push would not carry.
   *
   * A green run over the wrong tree is worse than a red one, because it is
   * believed. So the tree and the commit are both re-checked here, at the last
   * moment before the push, and a landing that drifted is abandoned rather
   * than pushed on a verification that does not describe it.
   */
  // NO TREE RE-CHECK HERE, AND THAT IS THE POINT.
  //
  // There used to be one: the steps ran against the live tree, so an edit
  // during the run meant they had verified something else, and the landing was
  // abandoned. The steps run in a worktree at `target` now, so the session's
  // tree cannot affect what was verified or what is pushed. The guard is gone
  // because the condition is, which is the better of the two ways to fix a
  // check that keeps firing.
  mark('push');
  say(`\n$ git push origin ${target.slice(0, 7)}:main`);
  if (!run('git', ['push', 'origin', `${target}:main`])) {
    die('push rejected — somebody landed first. Run this again: it rebases and re-checks.');
  }
  // The step that separates "nothing reached main" from "a commit is on main
  // and nobody heard the verdict" — the only two readings a corpse can have.
  mark('verdict');

  // A PUSH IS NOT THE END OF THE WORK.
  //
  // This used to print "verify the verdict actually arrived" and leave it
  // there. A rule that is only asked for is the failure mode this repository
  // has the longest record of — `lanes.test.ts` exists because one was asked
  // for and ignored by seven suites for months. So the landing waits for the
  // verdict itself, and its exit code is the verdict's.
  //
  // Waiting costs nothing that is at risk: the push has happened, nothing is
  // holding a lock, and the alternative is a session that ends believing a
  // commit was judged when it was not. `--no-verdict` is there for a human
  // who would rather watch the Actions tab.
  if (NO_VERDICT) {
    say('\nlanded. --no-verdict: nobody is checking whether CI answered.');
    return;
  }
  say('\n$ npm run verdict');
  const answered = runNpm(['run', '--silent', 'verdict']);
  if (!answered) {
    die('the landing is on `main`, and CI has not returned a green verdict for it.\n' +
        '      Read the lines above: a RED build is yours to fix, an ABSENT one is not\n' +
        '      yours to fix and is still not a pass.');
  }
  say('\nlanded, and judged.');
}

// Importable for the test that compares STEPS against the workflow, runnable as
// a command. Without the guard, importing it would try to land.
if (process.argv[1] && process.argv[1].endsWith('land.mjs')) {
  // `main` is async now, because two steps run at once. An unhandled rejection
  // would print a warning and exit 0 — a landing that failed and looked like
  // one that worked, which is the one outcome this tool exists to prevent.
  main().catch((e) => {
    console.error(`land: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
}
