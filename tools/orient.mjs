#!/usr/bin/env node
/**
 * WHAT AN AGENT NEEDS TO KNOW BEFORE IT KNOWS ANYTHING ELSE.
 *
 * Three facts, printed at session start, because all of them are invisible and
 * every one has already cost this repository something.
 *
 * ONE: THE CLONE ARRIVES SHALLOW, AND GIT LIES ABOUT HISTORY WHEN IT IS.
 *
 * A fresh session gets 59 commits of a 141-commit main and `.git/shallow` on
 * disk. `git merge-base --is-ancestor` cannot walk past the graft boundary and
 * does not fail there — it answers FALSE. So `git branch --merged`, `git log
 * main..branch` and every "has this landed?" come back wrong, in the direction
 * that looks cautious, which is why the wrong answer gets believed. A cleanup
 * script trusted it once and reported 29 branches as unmerged that were all
 * merged; the repair took an hour and deleted the same branches twice.
 *
 * Documenting that was not enough — this codebase's own history is a list of
 * rules that were only ever asked for. So the trap is removed instead: the
 * session unshallows, and the question becomes answerable.
 *
 * TWO: WHAT `main` LAST GOT BACK FROM CI. An agent that arrives to a red or
 * unjudged trunk should know before it starts, not after it has rebased onto
 * one. Seven commits landed unjudged over sixteen hours in September 2026 and
 * the only reason anybody found out was somebody reading the Actions list by
 * hand a day later.
 *
 * THREE: SOMEBODY ELSE MAY BE HOLDING THE ISSUE YOU ARE ABOUT TO START.
 * Claims live on refs nobody has to read a document to see (docs/PARALLEL.md).
 * Printing them here is the difference between a protocol and a suggestion.
 *
 * NODE RATHER THAN BASH, WHICH IS THE WHOLE POINT OF THE PORT. This was the
 * first thing a session ran and it was `#!/usr/bin/env bash`. On a Windows
 * checkout it did not run, and it did not say so: the clone stayed shallow, so
 * every ancestry answer for the rest of that session was wrong in the
 * direction that looks cautious, and the claims other agents held were simply
 * not printed. The failure of an orientation step is invisible BY
 * CONSTRUCTION — there is nothing to compare its silence against.
 *
 * Never fails a session. Every step is forgiving and the exit is always 0: an
 * orientation step that can break a session is worse than no orientation.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CLAUDE_PROJECT_DIR ?? join(HERE, '..');

/** Git, forgiving: every question here has a wrong answer that is survivable. */
const git = (...args) => {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim() };
};

const say = (line) => process.stdout.write(`${line}\n`);

if (git('rev-parse', '--is-shallow-repository').out === 'true') {
  const before = git('rev-list', '--count', 'HEAD').out || '?';
  say('unshallowing — ancestry is unanswerable in a shallow clone…');
  if (git('fetch', '--quiet', '--unshallow').ok) {
    say(`  history: ${before} commits → ${git('rev-list', '--count', 'HEAD').out || '?'}`);
  } else {
    say('  COULD NOT UNSHALLOW. Do not trust `git branch --merged`, `git log main..x`');
    say("  or any 'has this landed' answer in this session — see docs/PARALLEL.md.");
  }
}

say(`you are on: ${git('rev-parse', '--abbrev-ref', 'HEAD').out || '?'}`);

/**
 * Reads `refs/verdict/<sha>`, written by .github/workflows/verdict.yml. No API
 * and no token: the Actions API answers a session's curl with 403, and this has
 * to work in the place where that is true.
 */
if (git('fetch', '--quiet', 'origin', '+refs/verdict/*:refs/verdict/*').ok) {
  const head = git('rev-parse', 'origin/main').out;
  if (head) {
    const body = git('log', '-1', '--format=%B', `refs/verdict/${head}`).out;
    const conclusion = /^conclusion: (.*)$/m.exec(body)?.[1]?.trim() ?? '';
    const short = head.slice(0, 7);
    if (conclusion === 'success') say(`main: green on ${short}`);
    else if (!conclusion) say(`main: NO VERDICT on ${short} — CI has not answered for it. Not a pass.`);
    else say(`main: ${conclusion} on ${short} — trunk is not green. \`npm run verdict\` for the jobs.`);
  }
}

/**
 * Scheduled evidence uses the same API-free contract as the main verdict.
 * The watcher writes one orphan ref per cadence and preserves the first red
 * SHA across repeated failures. Missing scheduled evidence is never green.
 */
if (git('fetch', '--quiet', 'origin', '+refs/scheduled/*:refs/scheduled/*').ok) {
  for (const cadence of ['nightly', 'weekly', 'outcome-reach']) {
    const ref = `refs/scheduled/${cadence}`;
    if (!git('show-ref', '--verify', '--quiet', ref).ok) {
      say(`${cadence}: NO VERDICT — scheduled evidence has not answered yet. Not a pass.`);
      continue;
    }

    const body = git('log', '-1', '--format=%B', ref).out;
    const conclusion = /^conclusion: (.*)$/m.exec(body)?.[1]?.trim() ?? '';
    const sha = /^sha: (.*)$/m.exec(body)?.[1]?.trim() ?? '';
    const since = /^since: (.*)$/m.exec(body)?.[1]?.trim() ?? sha;
    if (conclusion === 'success') {
      say(`${cadence}: green on ${sha.slice(0, 7) || '?'}`);
    } else {
      say(`${cadence}: red since ${since.slice(0, 7) || '?'} (${conclusion || 'unknown'}) — see the P0 scheduled-regression issue.`);
    }
  }
}

/**
 * The claims other sessions are holding right now. `agents.mjs` fetches, so
 * this is current rather than remembered; if the remote is unreachable it says
 * so and the session continues.
 */
const AGENTS = join(HERE, 'agents.mjs');
if (existsSync(AGENTS)) {
  // stdout through, stderr swallowed: a remote that is not answering should
  // cost one friendly line, not a stack trace at the top of a session.
  const r = spawnSync(process.execPath, [AGENTS, 'list'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'ignore'],
  });
  if (r.error || r.status !== 0) say('could not read claims — `npm run agents` before taking an issue');
}

process.exit(0);
