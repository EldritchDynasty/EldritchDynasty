#!/usr/bin/env node
/** Refresh generated shard data before the eight-file guard is exhausted (#2794). */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { npmInvocation } from './portable.mjs';
import { testInventory } from './test-duration-report.mjs';

export const REFRESH_AT = 5;
export const DURATION_BRANCH = 'automation/test-durations';
const TITLE = '[duration-maintenance] refresh generated test durations';

export function durationRefreshStatus(root) {
  const table = JSON.parse(readFileSync(join(root, 'tools/test-durations.json'), 'utf8'));
  const missing = testInventory(root).filter((path) => table.files[path] === undefined);
  return { needed: missing.length >= REFRESH_AT, missing };
}

/** The injected executor lets tests prove denied claims and failed suites never publish. */
export function refreshDurations({ root = process.cwd(), run, cpuCount = cpus().length } = {}) {
  run ??= (command, args, options = {}) => (execFileSync(command, args, {
    cwd: root, encoding: 'utf8', env: process.env, ...options,
  }) ?? '').trim();
  if (!durationRefreshStatus(root).needed) return 'below threshold';
  if (cpuCount !== 4) throw new Error(`Duration maintenance requires 4 CPUs; found ${cpuCount}`);
  const node = (args, options) => run(process.execPath, args, options);
  const npm = (args, options) => {
    const invocation = npmInvocation();
    return run(invocation.command, [...invocation.prefix, ...args], options);
  };
  const gh = (args, issue = false) => run('gh', args, issue ? {
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN },
  } : {});
  const git = (...args) => run('git', args);
  const claim = (...args) => node(['tools/agents.mjs', ...args]);
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  const dir = mkdtempSync(join(tmpdir(), 'ed-duration-maintenance-'));
  let lane = false;
  let issue;
  let issueHeld = false;
  let published = false;
  try {
    if (git('rev-parse', 'HEAD') !== git('rev-parse', 'refs/remotes/origin/main')) {
      throw new Error('Duration maintenance must start from fetched main');
    }
    // Checkout is main; this fixed branch grows one PR rather than opening one per push.
    git('switch', '-C', DURATION_BRANCH);
    git('config', 'user.name', 'duration-maintenance[bot]');
    git('config', 'user.email', 'duration-maintenance@users.noreply.github.com');
    try {
      claim('take', 'lane-gates', '--paths', 'tools/test-durations.json', '--lane', 'gates');
      lane = true;
    } catch {
      console.warn('Duration refresh deferred: lane-gates could not be acquired. The next run retries.');
      return 'claim unavailable';
    }
    const matches = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open',
      '--search', '"[duration-maintenance]" in:title', '--json', 'number,title', '--limit', '100'], true));
    issue = matches.find((item) => item.title === TITLE)?.number;
    if (!issue) {
      const body = join(dir, 'issue.md');
      writeFileSync(body, 'Child of #2794: automatically measure the complete test inventory on a 4-CPU runner, '
        + 'regenerate tools/test-durations.json through tools/cost.mjs, and land through required CI and the native queue.\n');
      const url = gh(['issue', 'create', '--repo', repo, '--title', TITLE,
        '--label', 'priority: P1', '--body-file', body], true);
      issue = Number(/\/issues\/(\d+)\s*$/.exec(url)?.[1]);
      if (!issue) throw new Error('Could not resolve the duration maintenance issue');
    }
    claim('take', String(issue), '--paths', 'tools/test-durations.json', '--lane', 'gates');
    issueHeld = true;
    const sha = git('rev-parse', 'HEAD');
    const old = git('ls-remote', '--heads', 'origin', `refs/heads/${DURATION_BRANCH}`).split(/\s/)[0];
    npm(['ci'], { stdio: 'inherit' });
    const report = join(dir, 'durations.json');
    npm(['test', '--', '--reporter=default', '--reporter=./tools/duration-reporter.mjs', `--outputFile=${report}`], {
      stdio: 'inherit', env: { ...process.env, ED_COST_MEASUREMENT: '1', ED_DURATION_SOURCE_SHA: sha },
    });
    npm(['run', 'cost', '--', '--report', report, '--require-complete', '--write'], { stdio: 'inherit' });
    npm(['test', '--', 'packages/core/src/lanes.test.ts', 'packages/core/src/codemap.test.ts'], { stdio: 'inherit' });
    git('add', 'tools/test-durations.json');
    if (!git('diff', '--cached', '--name-only')) return 'unchanged';
    git('commit', '-m', `chore(ci): refresh measured test durations\n\nCloses #${issue}. Refs #2794.`);
    git('push', `--force-with-lease=refs/heads/${DURATION_BRANCH}:${old}`, 'origin', `HEAD:refs/heads/${DURATION_BRANCH}`);
    const body = join(dir, 'pr.md');
    const runUrl = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    writeFileSync(body, `Closes #${issue}. Refs #2794.\n\nGenerated from the complete successful test run on 4 CPUs at ${sha}.\n`
      + `Measurement: ${runUrl}. Imported with \`npm run cost -- --report <file> --require-complete --write\`; `
      + 'inventory coverage, test success, runner class and the normal lane guards were checked.\n');
    const prs = JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'open', '--head', DURATION_BRANCH, '--json', 'number']));
    if (prs.length) gh(['pr', 'edit', String(prs[0].number), '--repo', repo, '--body-file', body]);
    else gh(['pr', 'create', '--repo', repo, '--base', 'main', '--head', DURATION_BRANCH,
      '--title', 'chore(ci): refresh measured test durations', '--body-file', body]);
    published = true;
    return 'PR ready for required CI';
  } finally {
    if (!published) {
      // A failed measurement must neither publish partial data nor strand the lane.
      try { if (issueHeld) claim('release', String(issue)); }
      finally { if (lane) claim('release', 'lane-gates'); }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === 'status') {
    const status = durationRefreshStatus(process.cwd());
    console.log(JSON.stringify(status));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needed=${status.needed}\n`);
  } else if (process.argv[2] === 'refresh') {
    console.log(refreshDurations());
  } else throw new Error('usage: duration-maintenance.mjs status|refresh');
}
