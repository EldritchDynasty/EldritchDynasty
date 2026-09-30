#!/usr/bin/env node
/**
 * A CHANGE THAT TOUCHES ONLY MARKDOWN GETS THE SHORT SET — IF ITS BASE WAS GREEN.
 *
 * A landing that edits one sentence of `ARCHITECTURE.md` used to spend the
 * same forty minutes as one that rewrites the mortality pass, and CI spent the
 * same half hour of runners on it. Most of that is the gates and the slow
 * suites, and NEITHER OF THEM CAN SEE A MARKDOWN FILE: they load the
 * simulation sources and `packages/content`, whose loader refuses anything
 * that is not YAML. A diff made only of `.md` files cannot change one number
 * they compute.
 *
 * WHAT DOES READ MARKDOWN IS THE FAST LANE, and it reads it as data, not as
 * prose. `codemap.test.ts` fails on a dead path, a dead link, a second copy of
 * a timing and an oversized `AGENTS.md`; `codex.test.ts` on the Codex byte
 * budget; `docs.test.ts` on a hand-edited `docs/VOCABULARY.md`; `land.test.ts`
 * and `settings.test.ts` on sentences in `AGENTS.md` they depend on. So "only
 * markdown changed" is NOT "nothing can break" — which is why the short set is
 * exactly CI's short tier (typecheck, validate, the fast lane) and not nothing.
 * `land.test.ts` fails the build if code outside the fast lane starts reading
 * a markdown file, which is the day this reasoning stops being true.
 *
 * THIS IS NOT THE RULE `land.mjs` RETIRED. `docs/PARALLEL.md` once asked the
 * agent to classify its own diff and pick a shorter path for "docs" — a
 * judgement, made from memory, with no definition of docs. This is a function
 * over `git diff` with one definition, and it fails SAFE: any file that is not
 * markdown, a diff it cannot compute, or an empty one is the full set.
 *
 * AND ONLY ON A GREEN BASE. The short set proves "this changed nothing the
 * full set reads" — which is a pass only if the full set passed on the commit
 * underneath. On a red, pending or unjudged `main`, a docs-only commit would
 * otherwise collect a green verdict it did not earn, and every reader of "is
 * trunk green" — the session banner, the scoreboard, the next landing — would
 * be told the red had gone away. That is a lie with the actor unnamed, the one
 * thing this repository refuses in its own simulation, so the base's verdict
 * is read off `refs/verdict/<sha>` and anything short of `success` runs it all.
 *
 * ONE MODULE, TWO CALLERS. `land.mjs` imports the short-tier step list for its
 * default advisory preflight; `check.yml`'s `tier` job runs this file as a
 * command to decide whether CI itself may use that tier. Two copies of either
 * list would be two rules within a month.
 *
 *   node tools/docs-only.mjs <base> <head>   # prints `short` or `full`; why, on stderr
 */
import { execFileSync } from 'node:child_process';
import { parseVerdict, stateOf } from './verdict.mjs';

/**
 * What a docs-only change runs. The same three scripts as CI's short tier —
 * `land.test.ts` derives that tier from `check.yml` and fails if they differ,
 * so the landing and the build cannot disagree about what "short" means.
 */
export const DOCS_ONLY_STEPS = ['typecheck', 'validate', 'test:fast'];

const MARKDOWN = /\.md$/i;

/**
 * short or full, and why, from the changed paths and the base's verdict state.
 *
 * Pure, like `ciScripts` and `issueLeftOpen`: a test hands it the diff it must
 * refuse. `files` must come from a rename-blind diff (`--no-renames`) — with
 * rename detection, `a.ts → a.md` lists only `a.md`, and a deleted TypeScript
 * file would pass as documentation.
 */
export function classify(files, baseState) {
  if (!files.length) return { short: false, reason: 'no changed files to classify' };
  const code = files.filter((f) => !MARKDOWN.test(f));
  if (code.length) {
    const named = code.slice(0, 3).join(', ') + (code.length > 3 ? `, and ${code.length - 3} more` : '');
    return { short: false, reason: `not markdown only: ${named}` };
  }
  if (baseState !== 'green') {
    return {
      short: false,
      reason: `markdown only, but the base is ${baseState.toUpperCase()}, not green — ` +
        'a short run on top of it would report green for a trunk that is not',
    };
  }
  return { short: true, reason: `markdown only (${files.length} file${files.length === 1 ? '' : 's'}) on a green base` };
}

const gitIn = (cwd) => (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** The verdict state of one commit, fetched from the remote. Unreachable reads as absent. */
function verdictState(git, sha) {
  try {
    git('fetch', '--quiet', 'origin', `+refs/verdict/${sha}:refs/verdict/${sha}`);
    return stateOf(parseVerdict(git('log', '-1', '--format=%B', `refs/verdict/${sha}`)));
  } catch {
    return 'absent';
  }
}

/**
 * The plan for `base...head`: which set, and why. Never throws — anything that
 * goes wrong asking the question is an answer of `full`.
 *
 * The verdict is read for the MERGE BASE, because that is the commit whose
 * code this diff leaves untouched. For a push to `main` it is `base` itself;
 * for a pull request it is where the branch left `main`.
 */
export function landingPlan(base, head, cwd = undefined) {
  const git = gitIn(cwd);
  let files;
  let mergeBase;
  try {
    mergeBase = git('merge-base', base, head);
    files = git('diff', '--no-renames', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
  } catch {
    return { short: false, reason: `could not diff ${String(base).slice(0, 7)}...${String(head).slice(0, 7)}` };
  }
  if (files.some((f) => !MARKDOWN.test(f)) || !files.length) return classify(files, 'absent');
  return classify(files, verdictState(git, mergeBase));
}

if (process.argv[1] && process.argv[1].endsWith('docs-only.mjs')) {
  const [base, head] = process.argv.slice(2);
  const plan = /^0+$/.test(base ?? '') || !base || !head
    ? { short: false, reason: 'no base commit to compare against' }
    : landingPlan(base, head);
  console.error(`docs-only: ${plan.reason}`);
  console.log(plan.short ? 'short' : 'full');
}
