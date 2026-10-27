#!/usr/bin/env node
/** Advisory discovery only. CI and land retain their existing authority. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classify, DOCS_ONLY_STEPS } from './diff-kind.mjs';
import { parseCodemap, routesForPaths } from './codemap.mjs';
import { runNpm } from './portable.mjs';

const POLICY = 'tools/verify-plan.mjs#planFor';
const TIERS = 'tools/ci-evidence.json';
const fullArgs = ['run', 'land', '--', '--full-preflight'];
const display = (args) => `npm ${args.join(' ')}`;
const scheduled = (tier) => /weekly|nightly|release-only/.test(tier ?? '');

/**
 * Pure: no git, I/O, subprocesses, environment reads, or mutable globals.
 * map is parseCodemap's result; evidence is the CI inventory plus optional
 * baseState and workflowScripts gathered by the caller. Only currentTier is
 * read. Missing evidence broadens the recommendation; it never grants a pass.
 */
export function planFor({ files = [], renames = [], deletions = [], baseSha, headSha,
  shallow = false, evidence = {}, map = { entries: [], files: [], problems: [] } }) {
  files = [...new Set([...files, ...deletions, ...renames.flatMap((r) => [r.from, r.to])]
    .filter(Boolean).map((p) => p.replaceAll('\\', '/')))].sort();
  const reasons = [];
  const notes = ['Advisory recommendations do not replace required integration CI.',
    'Local verdict refs are cached evidence; planning never fetches them.'];
  let broad = false;
  let uncertain = false;
  const widen = (reason, source = POLICY, unknown = false) => {
    broad = true;
    uncertain ||= unknown;
    reasons.push({ reason, source });
  };
  const local = new Map();
  const later = new Map();
  const jobs = evidence.jobs ?? [];
  const jobTier = (id) => jobs.find((job) => job.id === id)?.currentTier;
  const add = (args, reason, source, currentTier, tierSource) => {
    const key = JSON.stringify(args);
    const group = scheduled(currentTier) ? later : local;
    if (!group.has(key)) group.set(key, { args, command: display(args), currentTier: currentTier ?? null,
      tierSource, reasons: [] });
    group.get(key).reasons.push({ reason, source });
  };
  const suite = (path, reason, source) => {
    const item = evidence.slowSuites?.find((s) => s.path === path);
    const tier = item?.currentTier ?? (/\.slow\.test\.ts$/.test(path) ? undefined : jobTier('fast'));
    if (!tier) widen(`No enforced tier is recorded for ${path}`, TIERS, true);
    add(['test', '--', path], reason, source, tier,
      item ? `${TIERS}#slowSuites:${path}` : `${TIERS}#jobs:fast`);
  };
  const gate = (id, reason, source) => {
    const group = ['gates', 'telemetryGates'].find((group) => evidence[group]?.some((g) => g.id === id));
    const item = group && evidence[group].find((g) => g.id === id);
    if (!item?.currentTier) widen(`No enforced tier is recorded for gate ${id}`, TIERS, true);
    add(['run', 'gates', '--', id], reason, source, item?.currentTier, `${TIERS}#${group ?? 'gates'}:${id}`);
  };
  const available = map.files ?? [];
  if (!jobs.length) widen('The enforced CI evidence inventory is unavailable', TIERS, true);
  if (!baseSha || !headSha) widen('Base or head could not be resolved to a commit', 'git merge-base / rev-parse', true);
  if (shallow) widen('Shallow history cannot establish a reliable diff base', 'git rev-parse --is-shallow-repository', true);
  if (!files.length) widen('No changed files to classify', 'tools/diff-kind.mjs#classify', true);
  if (renames.length) widen('Renames affect both old and new dependencies', 'git diff --name-status -M');
  if (deletions.length) widen('Deleted files may have consumers outside the map', 'git diff --no-renames');
  if (new Set(files.map((f) => /^packages\/([^/]+)\//.exec(f)?.[1]).filter(Boolean)).size > 1) {
    widen('The diff crosses package contracts');
  }
  const markdownOnly = files.length > 0 && files.every((file) => /\.md$/i.test(file));
  if (markdownOnly) {
    const docs = classify(files, evidence.baseState ?? 'absent');
    reasons.push({ reason: docs.reason, source: 'tools/diff-kind.mjs#classify' });
    if (docs.short) for (const step of DOCS_ONLY_STEPS) {
      add(['run', step], docs.reason, 'tools/diff-kind.mjs#DOCS_ONLY_STEPS',
        jobTier(step === 'test:fast' ? 'fast' : 'lint'), `${TIERS}#jobs:${step === 'test:fast' ? 'fast' : 'lint'}`);
    }
    else widen('The existing documentation policy requires the full set', 'tools/diff-kind.mjs#classify', evidence.baseState !== 'red');
  } else {
    if (map.problems?.length || !map.entries?.length) widen('The architecture map is incomplete or ambiguous', map.source ?? 'ARCHITECTURE.md', true);
    for (const file of files.filter((f) => !/\.md$/i.test(f))) {
      const routes = [...new Set([...routesForPaths(map, [file]),
        ...map.entries.filter((entry) => entry.suites.includes(file))])];
      const yaml = /^packages\/content\/.*\.ya?ml$/.test(file);
      if (!routes.length && !yaml) widen(`No architecture route covers ${file}`, map.source ?? 'ARCHITECTURE.md');
      for (const route of routes) {
        const source = `${map.source}:${route.line}`;
        for (const path of route.suites) suite(path, `${file}: ${route.topic}`, source);
        for (const command of route.commands) {
          if (command.startsWith('gate:')) gate(command.slice(5), `${file}: ${route.topic}`, source);
          else {
            const match = /^npm run ([\w:-]+)(?: --workspace (@[\w/-]+))?$/.exec(command);
            if (match) {
              // The table names this command, but no currentTier associates
              // it with a lane. Preserve the lead without guessing a tier or
              // executing a platform-specific smoke on an arbitrary host.
              notes.push(`Review ${command} from ${source}; its enforced tier/platform is not resolved by the inventory.`);
              widen(`Map command needs tier/platform review: ${command}`, source, true);
            }
            else widen(`Map command needs manual review: ${command}`, source);
          }
        }
      }
      if (/\.ts$/.test(file) && !/\.test\.ts$/.test(file)) for (const suffix of ['.test.ts', '.slow.test.ts']) {
        const path = file.slice(0, -3) + suffix;
        if (available.includes(path)) suite(path, `Colocated suite for ${file}; this alone does not establish coverage`, 'colocated suite');
      }
      if (/^packages\/(?:schema|core)\/src\/save\.ts$/.test(file)) {
        for (const path of available.filter((f) => /^packages\/core\/src\/(?:save|replay)(?:\.slow)?\.test\.ts$/.test(f))) {
          suite(path, 'Saved state must round-trip and replay', POLICY);
        }
        notes.push('Check SAVE_FORMAT and legacy-save compatibility; the planner cannot decide whether a format change is needed.');
      }
      if (yaml) {
        add(['run', 'validate'], 'Authored YAML is outside the TypeScript import graph', POLICY, jobTier('lint'), `${TIERS}#jobs:lint`);
        const loaders = routesForPaths(map, ['packages/schema/src/assemble.ts', 'packages/schema/src/content-index.ts']);
        if (!loaders.length) widen('The map has no content-loading evidence route', map.source, true);
        for (const path of new Set([...loaders.flatMap((r) => r.suites),
          ...available.filter((f) => /^packages\/content\/.*\.test\.ts$/.test(f))])) {
          suite(path, 'Content loading and bundle assembly', `${map.source}#Where a thing lives`);
        }
        for (const id of ['fire-rate', 'outcome-reach']) gate(id, 'Measure authored exposure after content changes', POLICY);
      }
      if (/^packages\/core\/src\/events\/(?:arcs|slots|selection)\.ts$/.test(file)) {
        for (const id of ['fire-rate', 'outcome-reach']) gate(id,
          'Measure exposure when arcs, slots or selection change', 'AGENTS.md#tests');
      }
      if (/^packages\/core\/src\/(?:rng|world|testing)\.ts$/.test(file)
        || file === 'packages/core/src/year/phases.ts' || /(?:^|\/)index\.ts$/.test(file)) {
        widen(`Shared simulation spine or barrel: ${file}`, POLICY);
      }
    }
    if (files.some((file) => /^packages\/(core|schema)\//.test(file))) {
      add(['run', 'typecheck:core'], 'Check simulation/schema contracts', POLICY, jobTier('lint'), `${TIERS}#jobs:lint`);
    }
  }
  if (broad || !local.size) {
    if (!local.size && !broad) widen('No focused local command is established by the map');
    local.clear();
    add([...fullArgs], 'Conservative full preflight; required CI remains authoritative', 'tools/land.mjs#verificationPlan', null, 'tools/land.mjs#ciScripts');
  }
  return { version: 1, scope: broad ? 'broad' : markdownOnly ? 'docs' : 'focused', uncertain,
    baseSha: baseSha ?? null, headSha: headSha ?? null, baseState: evidence.baseState ?? 'absent', files,
    reasons, notes: [...new Set(notes)], recommendedLocal: [...local.values()],
    requiredIntegration: jobs.filter((job) => /merge-blocking/.test(job.currentTier)).map((job) => ({
      id: job.id, claim: job.claim, currentTier: job.currentTier, source: `${TIERS}#jobs:${job.id}`,
    })),
    workflowScripts: { scripts: evidence.workflowScripts ?? [], source: 'tools/land.mjs#ciScripts(.github/workflows/check.yml)',
      note: 'Workflow-derived inventory, including conditional jobs; the workflow determines which jobs run.' },
    scheduledEvidence: [...later.values()] };
}

/** NUL-separated git statuses preserve spaces, Unicode and newlines in paths. */
export function parseNameStatus(text) {
  const fields = text.split('\0');
  const files = [], renames = [], deletions = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    const path = fields[i++];
    if (/^[RC]/.test(status)) {
      const to = fields[i++];
      files.push(path, to);
      renames.push({ from: path, to });
    } else {
      files.push(path);
      if (status === 'D') deletions.push(path);
    }
  }
  return { files, renames, deletions };
}

/** Gather cached local facts only. No fetch, credentials or checkout writes. */
export async function gatherPlan({ cwd = process.cwd(), base = 'origin/main' } = {}) {
  let gitCwd = cwd;
  const git = (...args) => execFileSync('git', args, { cwd: gitCwd, encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();
  const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const root = attempt(() => git('rev-parse', '--show-toplevel'), cwd);
  gitCwd = root;
  const headSha = attempt(() => git('rev-parse', '--verify', 'HEAD^{commit}'), undefined);
  const baseSha = attempt(() => git('merge-base', base, 'HEAD'), undefined);
  const shallow = attempt(() => git('rev-parse', '--is-shallow-repository') !== 'false', true);
  const read = (path, fallback) => attempt(() => readFileSync(join(root, path), 'utf8'), fallback);
  const untracked = attempt(() => git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean), []);
  const inventory = attempt(() => git('ls-files', '-z').split('\0').filter(Boolean), [])
    .concat(untracked).filter((file) => existsSync(join(root, file)));
  let diffFailed = false;
  let diff = { files: [], deletions: [], renames: [] };
  if (baseSha) {
    try {
      diff = parseNameStatus(git('diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--no-renames', baseSha, '--'));
    } catch { diffFailed = true; }
  }
  const renamed = baseSha ? attempt(() => parseNameStatus(git('diff', '--no-ext-diff', '--no-textconv',
    '--name-status', '-z', '-M', baseSha, '--')).renames, []) : [];
  const evidence = attempt(() => JSON.parse(read('tools/ci-evidence.json', '{}')), {});
  evidence.baseState = 'absent';
  // These existing helpers have repository-local CLI state at import time.
  // Import only while gathering in a checkout, never from the pure planner.
  if (headSha) {
    const { parseVerdict, stateOf } = await import('./verdict.mjs');
    const { ciScripts } = await import('./land.mjs');
    evidence.baseState = baseSha ? attempt(() => stateOf(parseVerdict(git('log', '-1', '--format=%B', `refs/verdict/${baseSha}`))), 'absent') : 'absent';
    evidence.workflowScripts = [...ciScripts(read('.github/workflows/check.yml', ''))].sort();
  }
  const map = parseCodemap(read('ARCHITECTURE.md', ''), { files: inventory });
  if (diffFailed) map.problems.push({ reason: 'git diff failed; changed paths are incomplete' });
  const plan = planFor({ ...diff, files: [...diff.files, ...untracked], renames: renamed,
    baseSha, headSha, shallow, evidence, map });
  plan.notes.push('Files include committed, staged, unstaged and untracked changes; head identifies HEAD only.');
  return plan;
}

export function formatPlan(plan) {
  const commands = (items) => items.length ? items.map((item) =>
    `  ${item.command} [${item.currentTier ?? 'local advisory'}; ${item.tierSource}]\n` +
    item.reasons.map((r) => `    ${r.reason} (${r.source})`).join('\n')).join('\n') : '  none selected';
  return [`Verification plan: ${plan.scope}${plan.uncertain ? ' (uncertain)' : ''}`,
    `Base ${plan.baseSha ?? 'unresolved'} → head ${plan.headSha ?? 'unresolved'}; cached base verdict ${plan.baseState}`,
    ...plan.reasons.map((r) => `  ${r.reason} (${r.source})`),
    'Recommended local:', commands(plan.recommendedLocal), 'Required integration CI:',
    ...plan.requiredIntegration.map((item) => `  ${item.id} [${item.currentTier}; ${item.source}]`),
    `  workflow scripts: ${plan.workflowScripts.scripts.join(', ') || 'unavailable'} (${plan.workflowScripts.source})`,
    'Scheduled evidence:', commands(plan.scheduledEvidence), ...plan.notes.map((n) => `Note: ${n}`)].join('\n');
}

export async function executePlan(plan, { cwd = process.cwd(), json = false } = {}) {
  const results = [];
  for (const item of plan.recommendedLocal) {
    const result = runNpm(item.args, { cwd, stdio: json ? 'pipe' : 'inherit' });
    results.push({ command: item.command, ...result });
    if (!result.ok) break;
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  let base = 'origin/main';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1] && !argv[i + 1].startsWith('-')) base = argv[++i];
    else if (!['--plan', '--json', '--run'].includes(argv[i])) {
      console.error('usage: npm run verify -- --plan [--base origin/main] [--json] [--run]');
      process.exitCode = 2;
      return;
    }
  }
  const plan = await gatherPlan({ base });
  const results = argv.includes('--run') ? await executePlan(plan, { json: argv.includes('--json') }) : undefined;
  if (argv.includes('--json')) console.log(JSON.stringify(results ? { ...plan, results } : plan, null, 2));
  else {
    console.log(formatPlan(plan));
    if (results) for (const result of results) console.log(`${result.command}: exit ${result.status ?? 'none'}${result.signal ? ` (${result.signal})` : ''}${result.error ? `: ${result.error}` : ''}`);
  }
  if (results?.some((r) => !r.ok)) process.exitCode = results.find((r) => !r.ok).status ?? 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
