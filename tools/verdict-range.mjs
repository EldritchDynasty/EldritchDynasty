#!/usr/bin/env node
/**
 * WHICH COMMITS DID THIS INTEGRATED MAIN RUN ACTUALLY TEST? (#320)
 *
 * A check run is attached to one head SHA, but a fast-forward or merged batch
 * can put several commits onto main at once. The tested tree contains every
 * commit newly reachable since the previous judged main head. Recording a
 * verdict only for the tip therefore leaves the rest permanently "unjudged"
 * even though they were part of the exact integrated tree CI exercised.
 *
 * This helper finds the nearest earlier ancestor with a JUDGED main verdict,
 * then prints every commit in base..head. Pending/cancelled/skipped runs and
 * synthetic `covered` refs are deliberately not boundaries: only a check that
 * actually judged that exact main head may define an integration boundary.
 *
 * Safety rule: if no judged main boundary can be proved, return only the head.
 * Never repaint unknown history merely to make the scoreboard look complete.
 *
 * Usage from verdict.yml after fetching full history and refs/verdict/*:
 *
 *   node tools/verdict-range.mjs <head-sha> <branch> <source-check-run-id>
 */
import { execFileSync } from 'node:child_process';

export const TRUNK = 'main';
const NON_BOUNDARIES = new Set(['pending', 'cancelled', 'skipped', 'covered']);

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const tryGit = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch {
    return { ok: false, out: '' };
  }
};

export function verdictMeta(message) {
  if (!message) return null;
  const field = (name) => new RegExp(`^${name}: (.+)$`, 'm').exec(message)?.[1]?.trim();
  const conclusion = field('conclusion');
  if (!conclusion) return null;
  return {
    branch: field('branch') ?? null,
    conclusion,
    run: field('run') ?? '',
  };
}

function sourceRunId(run) {
  return /\/actions\/runs\/(\d+)(?:$|[/?#])/.exec(run)?.[1] ?? '';
}

export function isJudgedMainBoundary(meta, currentRunId = '', trunk = TRUNK) {
  if (!meta || meta.branch !== trunk || NON_BOUNDARIES.has(meta.conclusion)) return false;
  if (currentRunId && sourceRunId(meta.run) === String(currentRunId)) return false;
  return true;
}

/**
 * Return the SHAs covered by one source check run.
 *
 * Feature-branch runs still own only their head. On main, the previous judged
 * main verdict is the integration boundary; git itself computes the DAG range,
 * so this works for both linear fast-forwards and merge commits.
 */
function metaForRef(sha) {
  const read = tryGit('log', '-1', '--format=%B', `refs/verdict/${sha}`);
  return read.ok ? verdictMeta(read.out) : null;
}

/**
 * Reconstruct landed batches that old tip-only recording left incomplete.
 *
 * Each pair of adjacent judged main tips proves one historical integration
 * range. The newer tip's run tested every commit in older..newer, so missing,
 * feature-branch, pending and cancelled refs inside that range can inherit that
 * exact source verdict. Existing independently judged main refs are never
 * overwritten; synthetic `covered` refs may be repaired from the real source.
 *
 * Nothing older than the oldest pair is returned: without both boundaries the
 * batch cannot be reconstructed honestly.
 */
export function repairPlans(headSha) {
  const resolved = tryGit('rev-parse', '--verify', '--quiet', `${headSha}^{commit}`);
  if (!resolved.ok) throw new Error(`verdict-range: ${headSha} is not a commit in this checkout`);
  const head = resolved.out;
  const mainline = git('rev-list', '--first-parent', head).split('\n').filter(Boolean);
  const judged = mainline.filter((sha) => isJudgedMainBoundary(metaForRef(sha)));

  const plans = [];
  for (let i = 0; i + 1 < judged.length; i++) {
    const source = judged[i];
    const older = judged[i + 1];
    const range = git('rev-list', '--reverse', `${older}..${source}`)
      .split('\n')
      .filter(Boolean);

    for (const target of range) {
      if (target === source) continue;
      if (isJudgedMainBoundary(metaForRef(target))) continue;
      plans.push({ source, target });
    }
  }
  return plans;
}

export function coveredShas(headSha, branch, currentRunId = '') {
  const resolved = tryGit('rev-parse', '--verify', '--quiet', `${headSha}^{commit}`);
  if (!resolved.ok) throw new Error(`verdict-range: ${headSha} is not a commit in this checkout`);
  const head = resolved.out;

  if (branch !== TRUNK) return [head];

  // The boundary belongs to trunk's own lineage. A merge's side branch may
  // carry arbitrary verdict refs; none of them can define where the previous
  // integrated main tree ended. First-parent is exactly that history.
  const history = git('rev-list', '--first-parent', head).split('\n').filter(Boolean);
  let boundary = null;

  // Skip the head itself. The requested event may already have written a
  // pending ref for it, and a rerun may have left a partial ref from this same
  // source check. Neither may truncate the range it is trying to record.
  for (const sha of history.slice(1)) {
    const meta = metaForRef(sha);
    if (isJudgedMainBoundary(meta, currentRunId)) {
      boundary = sha;
      break;
    }
  }

  if (!boundary) return [head];

  const range = git('rev-list', '--reverse', `${boundary}..${head}`)
    .split('\n')
    .filter(Boolean);
  return range.length ? range : [head];
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--repair') {
    const head = args[1];
    if (!head) {
      console.error('usage: verdict-range.mjs --repair <head-sha>');
      process.exit(2);
    }
    const lines = repairPlans(head).map(({ source, target }) => `${source}\t${target}`);
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  const [head, branch = TRUNK, runId = ''] = args;
  if (!head) {
    console.error('usage: verdict-range.mjs <head-sha> <branch> <source-check-run-id>');
    process.exit(2);
  }
  process.stdout.write(`${coveredShas(head, branch, runId).join('\n')}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('verdict-range.mjs')) main();
