import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '../../../..');
const CLI = join(REPO, 'tools/verify-plan.mjs');
interface Reason { reason: string; source: string }
interface Command { command: string; args: string[]; currentTier: string | null; reasons: Reason[] }
interface Plan {
  scope: string; uncertain: boolean; baseSha: string | null; headSha: string | null;
  reasons: Reason[]; notes: string[]; recommendedLocal: Command[]; scheduledEvidence: Command[];
  requiredIntegration: { id: string; currentTier: string }[];
  workflowScripts: { scripts: string[] }; files: string[];
}
const planner = await import(pathToFileURL(CLI).href) as {
  planFor: (input: object) => Plan;
  parseNameStatus: (text: string) => { files: string[]; renames: object[]; deletions: string[] };
  gatherPlan: (input: { cwd: string; base: string }) => Promise<Plan>;
  formatPlan: (plan: Plan) => string;
};
const codemap = await import(pathToFileURL(join(REPO, 'tools/codemap.mjs')).href) as {
  parseCodemap: (text: string, options: { files: string[] }) => {
    entries: { paths: string[]; suites: string[] }[]; problems: object[]; files: string[];
  };
};
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
const map = codemap.parseCodemap(readFileSync(join(REPO, 'ARCHITECTURE.md'), 'utf8'), { files: tracked });
const inventory = JSON.parse(readFileSync(join(REPO, 'tools/ci-evidence.json'), 'utf8'));
const evidence = { ...inventory, baseState: 'green', workflowScripts: ['test', 'gates', 'typecheck', 'validate'] };
const plan = (files: string[], extra = {}) => planner.planFor({
  files, baseSha: 'base-sha', headSha: 'head-sha', evidence, map, ...extra,
});
const commands = (items: Command[]) => items.map((item) => item.command);
const FULL = 'npm run land -- --full-preflight';

describe('advisory verification from the canonical map', () => {
  it('selects mapped leaf evidence and colocated tests with reasons, without certifying safety', () => {
    const result = plan(['packages/core/src/people/library.ts']);
    expect(result.scope).toBe('focused');
    expect(commands(result.recommendedLocal)).toContain('npm test -- packages/core/src/library.test.ts');
    expect(commands(result.recommendedLocal)).toContain('npm run typecheck:core');
    expect(result.recommendedLocal.every((c) => c.reasons.every((r) => r.reason && r.source))).toBe(true);
    expect(result.requiredIntegration.some((job) => job.id === 'required')).toBe(true);
  });

  it('uses current enforcement even when proposed tiers disagree', () => {
    const changed = JSON.parse(JSON.stringify(evidence));
    changed.slowSuites.forEach((suite: { currentTier: string; proposedTier: string }) => {
      suite.proposedTier = suite.currentTier === 'weekly' ? 'merge-blocking' : 'weekly';
    });
    changed.telemetryGates.forEach((gate: { proposedTier: string }) => { gate.proposedTier = 'merge-blocking'; });
    expect(plan(['packages/content/events/age_crusade.yaml'], { evidence: changed }))
      .toEqual(plan(['packages/content/events/age_crusade.yaml']));
    const result = plan(['packages/core/src/events/arcs.ts']);
    expect(result.scheduledEvidence.find((c) => c.command.includes('arcs.slow.test.ts'))?.currentTier).toBe('weekly');
    expect(commands(result.scheduledEvidence)).toContain('npm run gates -- fire-rate');
  });

  it('checks saves and replay and calls out compatibility, without deciding the format', () => {
    const result = plan(['packages/schema/src/save.ts']);
    expect(commands(result.recommendedLocal)).toEqual(expect.arrayContaining([
      'npm test -- packages/core/src/save.test.ts', 'npm test -- packages/core/src/replay.test.ts',
    ]));
    expect(result.notes.join(' ')).toContain('SAVE_FORMAT');
  });

  it('selects loader/validation tests and separates scheduled exposure for YAML', () => {
    const result = plan(['packages/content/events/age_crusade.yaml']);
    expect(result.scope).toBe('focused');
    expect(commands(result.recommendedLocal)).toEqual(expect.arrayContaining([
      'npm run validate', 'npm test -- packages/schema/src/bundle.test.ts',
      'npm test -- packages/content/src/content-path.test.ts',
    ]));
    expect(commands(result.scheduledEvidence)).toEqual(expect.arrayContaining([
      'npm run gates -- fire-rate', 'npm run gates -- outcome-reach',
    ]));
    expect(commands(result.recommendedLocal).some((c) => /fire-rate|outcome-reach/.test(c))).toBe(false);
  });

  it.each(['green', 'red', 'pending', 'absent'])('reuses documentation classification for a %s cached base', (baseState) => {
    const result = plan(['README.md'], { evidence: { ...evidence, baseState } });
    expect(result.scope).toBe(baseState === 'green' ? 'docs' : 'broad');
    expect(commands(result.recommendedLocal)).toEqual(baseState === 'green'
      ? ['npm run typecheck', 'npm run validate', 'npm run test:fast'] : [FULL]);
    expect(result.reasons.some((r) => r.source.includes('diff-kind'))).toBe(true);
  });

  it.each([
    'packages/core/src/rng.ts', 'packages/core/src/world.ts', 'packages/core/src/testing.ts',
    'packages/core/src/year/phases.ts', 'packages/client/src/index.ts', 'some/unknown.ts',
  ])('broadens shared or unknown dependencies: %s', (path) => {
    const result = plan([path]);
    expect(result.scope).toBe('broad');
    expect(commands(result.recommendedLocal)).toEqual([FULL]);
  });

  it('never treats a colocated filename as proof of coverage', () => {
    const result = plan(['new-module.ts'], { map: { ...map, files: [...map.files, 'new-module.test.ts'] } });
    expect(result.scope).toBe('broad');
    expect(result.reasons.some((r) => /No architecture route/.test(r.reason))).toBe(true);
  });

  it.each([
    { shallow: true }, { baseSha: undefined }, { headSha: undefined }, { evidence: {} },
    { map: { ...map, problems: [{ ref: 'missing.ts' }] } },
  ])('marks incomplete facts uncertain: %j', (facts) => {
    const result = plan(['packages/core/src/people/library.ts'], facts);
    expect(result.uncertain).toBe(true);
    expect(commands(result.recommendedLocal)).toEqual([FULL]);
  });

  it('broadens renames, deletions and package boundaries, including a code → Markdown rename', () => {
    for (const extra of [
      { renames: [{ from: 'engine.ts', to: 'engine.md' }] },
      { deletions: ['removed.ts'] },
    ]) {
      const result = plan(['README.md'], extra);
      expect(result.scope).toBe('broad');
      expect(result.files).toContain('README.md');
      expect(commands(result.recommendedLocal)).toEqual([FULL]);
    }
    expect(plan(['packages/core/src/save.ts', 'packages/schema/src/save.ts']).scope).toBe('broad');
  });

  it('preserves NUL-delimited rename/deletion paths containing spaces and newlines', () => {
    expect(planner.parseNameStatus('R100\0old name.ts\0new\nname.ts\0D\0deleted.ts\0M\0changed.ts\0')).toEqual({
      files: ['old name.ts', 'new\nname.ts', 'deleted.ts', 'changed.ts'],
      renames: [{ from: 'old name.ts', to: 'new\nname.ts' }], deletions: ['deleted.ts'],
    });
  });

  it('accepts Windows path separators without changing the plan', () => {
    expect(plan(['packages\\core\\src\\people\\library.ts']))
      .toEqual(plan(['packages/core/src/people/library.ts']));
  });

  const fixtures = JSON.parse(readFileSync(join(REPO, 'tools/verify-plan-fixtures.json'), 'utf8')).fixtures as {
    name: string; baseSha: string; headSha: string; files: string[];
  }[];
  it.each(fixtures)('reproduces the $name commit fixture with explicit SHAs', (fixture) => {
    const result = plan(fixture.files, { baseSha: fixture.baseSha, headSha: fixture.headSha });
    expect(result).toEqual(plan(fixture.files, { baseSha: fixture.baseSha, headSha: fixture.headSha }));
    expect(result.baseSha).toBe(fixture.baseSha);
    expect(result.headSha).toBe(fixture.headSha);
    expect(result.scope).toBe(fixture.name === 'documentation audit' ? 'docs' : 'focused');
    const human = planner.formatPlan(result);
    for (const command of [...result.recommendedLocal, ...result.scheduledEvidence]) expect(human).toContain(command.command);
    for (const job of result.requiredIntegration) expect(human).toContain(`${job.id} [${job.currentTier}`);
    expect(human).toContain(fixture.headSha);
    expect(human).toContain('Scheduled evidence:');
  });
});

const temps: string[] = [];
afterAll(() => { for (const temp of temps) rmSync(temp, { recursive: true, force: true }); });
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' };
function checkout() {
  const cwd = mkdtempSync(join(tmpdir(), 'ed-verify-plan-'));
  temps.push(cwd);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Verification fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('packages/core/src/example.ts', 'export const n = 1;\n');
  write('packages/core/src/example.test.ts', '// fixture suite\n');
  write('ARCHITECTURE.md', '## Where a thing lives\n\n| If you are changing… | Go to | Guarded by |\n|---|---|---|\n| Fixture | `core/src/example.ts` | `example.test.ts` |\n\n---\n');
  write('tools/ci-evidence.json', JSON.stringify(evidence));
  write('.github/workflows/check.yml', 'jobs:\n  fast:\n    steps:\n      - run: npm run test:fast\n');
  write('package.json', JSON.stringify({ scripts: {
    test: 'node -e "process.exit(7)"',
    'typecheck:core': 'node -e "require(\'fs\').writeFileSync(\'should-not-run\',\'bad\')"',
  } }));
  git('add', '.');
  git('commit', '-qm', 'fixture base');
  write('packages/core/src/example.ts', 'export const n = 2;\n');
  return { cwd, write, git };
}
function snapshot(root: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      hash.update(path.slice(root.length));
      const stat = statSync(path);
      hash.update(`${stat.size}:${stat.mtimeMs}`);
      if (stat.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest('hex');
}

describe('read-only CLI and explicit portable execution', () => {
  it('plans dirty local changes from a subdirectory without credentials or writes', async () => {
    const { cwd } = checkout();
    const before = snapshot(cwd);
    const result = spawnSync(process.execPath, [CLI, '--plan', '--base', 'HEAD', '--json'], {
      cwd, encoding: 'utf8', env: { ...gitEnv, GH_TOKEN: '', GITHUB_TOKEN: '' },
    });
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as Plan;
    expect(parsed.scope).toBe('focused');
    expect(parsed.files).toEqual(['packages/core/src/example.ts']);
    expect(await planner.gatherPlan({ cwd: join(cwd, 'packages/core'), base: 'HEAD' })).toEqual(parsed);
    expect(snapshot(cwd)).toBe(before);
  });

  it('reports missing base and real shallow history as uncertain, without repairing either', () => {
    const { cwd, git } = checkout();
    for (const base of ['missing-remote/main', 'HEAD']) {
      if (base === 'HEAD') writeFileSync(join(cwd, '.git/shallow'), git('rev-parse', 'HEAD') + '\n');
      const before = snapshot(cwd);
      const result = spawnSync(process.execPath, [CLI, '--plan', '--base', base, '--json'], { cwd, env: gitEnv, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout) as Plan;
      expect(parsed.uncertain).toBe(true);
      expect(commands(parsed.recommendedLocal)).toEqual([FULL]);
      expect(snapshot(cwd)).toBe(before);
    }
  });

  it('reports the actual npm failure status and stops before later commands', () => {
    const { cwd } = checkout();
    const result = spawnSync(process.execPath, [CLI, '--plan', '--base', 'HEAD', '--run', '--json'], {
      cwd, env: gitEnv, encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(7);
    const parsed = JSON.parse(result.stdout) as Plan & { results: { ok: boolean; status: number }[] };
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({ ok: false, status: 7 });
    expect(readdirSync(cwd)).not.toContain('should-not-run');
  });
});
