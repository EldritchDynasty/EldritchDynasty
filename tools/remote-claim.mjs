#!/usr/bin/env node
/**
 * CONNECTOR-ONLY TRANSPORT TO THE ONE CLAIM MUTEX.
 *
 * tools/agents.mjs owns claim semantics: orphan empty-tree commits, CAS pushes,
 * stale handling, path overlap, release tombstones. This file deliberately
 * owns none of that. It accepts one small issue-comment grammar and invokes the
 * existing tool with an argument array so a connector-only session can reach
 * exactly the same protocol a shell session uses.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENTS = join(import.meta.dirname, 'agents.mjs');

export const CLAIM_SYNTAX = [
  '/claim <issue> --agent <working-branch> --paths <csv> [--lane <lane>]',
  '/claim check --agent <working-branch>',
  '/claim release <issue> --agent <working-branch>',
].join('\n');

const syntaxError = (detail = 'invalid request') =>
  new Error(`${detail}. Expected one of:\n${CLAIM_SYNTAX}`);

function validateAgent(agent) {
  if (!agent || /\s/.test(agent)) throw syntaxError('agent must be one branch name');
  if (agent === 'main' || agent.startsWith('claim/')) {
    throw syntaxError('agent must name the ordinary working branch, not main or a claim ref');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(agent)
      || agent.includes('..')
      || agent.includes('//')
      || agent.endsWith('/')
      || agent.endsWith('.lock')) {
    throw syntaxError('agent is not a usable working-branch name');
  }
  return agent;
}

function validatePaths(raw) {
  const paths = raw.split(',');
  if (!raw || paths.some((p) =>
    !p
    || p !== p.trim()
    || p.startsWith('/')
    || p.includes('..')
    || p.includes('//')
    || !/^[A-Za-z0-9._/*-]+$/.test(p))) {
    throw syntaxError('paths must be a non-empty comma-separated repository path list');
  }
  return paths.join(',');
}

function validateLane(lane) {
  if (!lane) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(lane)) {
    throw syntaxError('lane is not usable');
  }
  return lane;
}

export function parseClaimRequest(raw) {
  const body = String(raw ?? '').trim();

  let match = body.match(/^\/claim ([1-9]\d*) --agent (\S+) --paths (\S+?)(?: --lane (\S+))?$/);
  if (match) {
    return {
      command: 'take',
      issue: match[1],
      agent: validateAgent(match[2]),
      paths: validatePaths(match[3]),
      lane: validateLane(match[4]),
    };
  }

  match = body.match(/^\/claim check --agent (\S+)$/);
  if (match) return { command: 'check', agent: validateAgent(match[1]) };

  match = body.match(/^\/claim release ([1-9]\d*) --agent (\S+)$/);
  if (match) {
    return { command: 'release', issue: match[1], agent: validateAgent(match[2]) };
  }

  throw syntaxError();
}

export function argsFor(request) {
  switch (request.command) {
    case 'take':
      return [
        'take', request.issue,
        '--agent', request.agent,
        '--paths', request.paths,
        ...(request.lane ? ['--lane', request.lane] : []),
      ];
    case 'check':
      return ['check', '--agent', request.agent];
    case 'release':
      return ['release', request.issue, '--agent', request.agent];
    default:
      throw new Error(`unsupported remote claim command: ${request.command}`);
  }
}

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function assertWorkingBranch(agent) {
  const format = runGit(['check-ref-format', '--branch', agent]);
  if (format.status !== 0) {
    throw new Error(`working branch ${agent} is not a valid git branch name`);
  }

  const remote = runGit([
    'ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${agent}`,
  ]);
  if (remote.status !== 0) {
    throw new Error(
      `working branch ${agent} is not on origin; create and push it before /claim`,
    );
  }
}

function writeSummary(title, output) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const body = String(output || '(no output)')
    .trim()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  appendFileSync(file, `### ${title}\n\n${body}\n`);
}

export function runRemoteClaim(raw = process.env.ED_CLAIM_REQUEST) {
  try {
    const request = parseClaimRequest(raw);
    assertWorkingBranch(request.agent);
    const args = argsFor(request);
    const child = spawnSync(process.execPath, [AGENTS, ...args], {
      encoding: 'utf8',
      env: process.env,
    });
    const stdout = child.stdout ?? '';
    const stderr = child.stderr ?? '';
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    const output = `${stdout}${stderr}`.trim();
    writeSummary(
      child.status === 0 ? 'Remote claim' : 'Remote claim — failed',
      output,
    );

    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`remote-claim: ${message}`);
    writeSummary('Remote claim — failed', message);
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) runRemoteClaim();
