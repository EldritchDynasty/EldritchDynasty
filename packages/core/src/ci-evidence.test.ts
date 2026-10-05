import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface EvidenceInventory {
  jobs: Array<{ id: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string }>;
  gateLanes: Array<{ id: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string }>;
  gateAssertions: Array<{ id: string; lane: string; source: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string }>;
  slowSuites: Array<{ path: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string }>;
}

const root = process.cwd();
const inventory = JSON.parse(
  readFileSync(join(root, 'tools/ci-evidence.json'), 'utf8'),
) as EvidenceInventory;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function relativePosix(path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

describe('CI evidence inventory', () => {
  it('classifies every current slow suite exactly once', () => {
    const actual = filesUnder(join(root, 'packages'))
      .filter((path) => path.endsWith('.slow.test.ts'))
      .map(relativePosix)
      .sort();
    const recorded = inventory.slowSuites.map((entry) => entry.path).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('classifies every current CI job exactly once', () => {
    const workflow = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const jobsStart = workflow.indexOf('\njobs:\n');
    expect(jobsStart, 'check.yml jobs block').toBeGreaterThanOrEqual(0);

    const actual = [...workflow.slice(jobsStart).matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)]
      .map((match) => match[1]!)
      .sort();
    const recorded = inventory.jobs.map((entry) => entry.id).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('classifies every current gate lane exactly once', () => {
    const workflow = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const laneMatch = workflow.match(/lane:\s*\[([^\]]+)\]/);
    expect(laneMatch, 'check.yml gate lane matrix').not.toBeNull();

    const actual = laneMatch![1]!
      .split(',')
      .map((lane) => lane.trim())
      .filter(Boolean)
      .sort();
    const recorded = inventory.gateLanes.map((entry) => entry.id).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('keeps every proposed move off the merge path explicitly blocked', () => {
    const entries = [...inventory.jobs, ...inventory.gateLanes, ...inventory.gateAssertions, ...inventory.slowSuites];
    for (const entry of entries) {
      if (!entry.currentTier.startsWith('merge-blocking') || entry.proposedTier === entry.currentTier) continue;
      expect(
        entry.moveBlockedBy?.trim(),
        JSON.stringify(entry) + ' proposes moving merge-blocking evidence without a blocker',
      ).toBeTruthy();
    }
  });
  it('requires a question and explicit classification for every entry', () => {
    const entries = [...inventory.jobs, ...inventory.gateLanes, ...inventory.gateAssertions, ...inventory.slowSuites];
    for (const entry of entries) {
      expect(entry.claim.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.evidenceType.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.currentTier.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.proposedTier.trim(), JSON.stringify(entry)).not.toBe('');
    }
  });
  it('decomposes the mixed war lane into asserted statistics and telemetry', () => {
    const war = inventory.gateAssertions.filter((entry) => entry.lane === 'war');
    expect(war.map((entry) => entry.id).sort()).toEqual([
      'war:gap-widens',
      'war:it-costs',
      'war:it-pays',
      'war:progress-divergence',
    ]);

    const blockers = war.filter((entry) => entry.currentTier === 'merge-blocking');
    expect(blockers.map((entry) => entry.id).sort()).toEqual([
      'war:gap-widens',
      'war:it-pays',
    ]);
    expect(blockers.every((entry) => entry.evidenceType === 'statistical')).toBe(true);
    expect(blockers.every((entry) => entry.moveBlockedBy?.includes('#440'))).toBe(true);

    const telemetry = war.filter((entry) => entry.evidenceType === 'telemetry');
    expect(telemetry.map((entry) => entry.id).sort()).toEqual([
      'war:it-costs',
      'war:progress-divergence',
    ]);
    expect(telemetry.every((entry) => !entry.currentTier.startsWith('merge-blocking'))).toBe(true);
  });

  it('checks scheduled evidence on main without weakening merge CI yet', () => {
    const nightly = readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8');
    const weekly = readFileSync(join(root, '.github/workflows/weekly-statistical.yml'), 'utf8');

    for (const workflow of [nightly, weekly]) {
      expect(workflow).toContain('schedule:');
      expect(workflow).toContain('workflow_dispatch:');
      expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/main"');
      expect(workflow).toContain('permissions:\n  contents: read');
    }

    expect(nightly).toContain('npm run test:slow -- --shard=${{ matrix.shard }}/4');
    expect(nightly).toContain('lane: [fire-rate, war, endings]');
    expect(weekly).toContain('npm run gates -- --lane blood');
  });

  it('keeps the broad iOS runtime smoke nightly and targets merge CI to native-host changes', () => {
    const checkWorkflow = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const nightlyWorkflow = readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8');

    expect(checkWorkflow).toContain('ios: ${{ steps.decide.outputs.ios }}');
    expect(checkWorkflow).toContain('packages/mobile/');
    expect(checkWorkflow).toContain('packages/client/src/platform(\\.test)?\\.ts$');
    expect(checkWorkflow).toContain("needs.tier.outputs.ios == 'true'");
    expect(checkWorkflow).toContain("name === 'ios' && job.result === 'skipped' && !iosRequired");

    expect(nightlyWorkflow).toContain('name: nightly iOS simulator build');
    expect(nightlyWorkflow).toContain('xcrun simctl bootstatus "$UDID" -b');
    expect(nightlyWorkflow).toContain('xcrun simctl launch "$UDID" nz.eldritchdynasty.game');
  });


  it('surfaces persistent scheduled failures as deduplicated project work', () => {
    const watcher = readFileSync(join(root, '.github/workflows/scheduled-regression-watch.yml'), 'utf8');

    expect(watcher).toContain('workflow_run:');
    expect(watcher).toContain('workflows: [nightly regression, weekly statistical]');
    expect(watcher).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(watcher).toContain('issues: write');
    expect(watcher).toContain('BAD_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(watcher).toContain('RUN_URL: ${{ github.event.workflow_run.html_url }}');
    expect(watcher).toContain('gh issue create');
    expect(watcher).toContain('--label "priority: P0"');
    expect(watcher).toContain('--add-label "priority: P0"');
    expect(watcher).toContain('gh issue comment');
    expect(watcher).toContain('gh issue close');
  });

});
