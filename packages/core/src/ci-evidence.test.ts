import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { shardCosts } from '../../../tools/shards.mjs';

interface EvidenceInventory {
  jobs: Array<{ id: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; coveredBy?: string[] }>;
  gateLanes: Array<{ id: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; fasterEvidence?: string; coveredBy?: string[] }>;
  gates: Array<{ id: string; lane: string; source: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; fasterEvidence?: string; coveredBy?: string[] }>;
  telemetryGates: Array<{ id: string; source: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; fasterEvidence?: string; coveredBy?: string[]; failureWitness?: string }>;
  gateAssertions: Array<{ id: string; lane: string; source: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; coveredBy?: string[] }>;
  slowSuites: Array<{ path: string; claim: string; evidenceType: string; currentTier: string; proposedTier: string; moveBlockedBy?: string; fasterEvidence?: string; coveredBy?: string[] }>;
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

function expectTestReference(reference: string): void {
  const split = reference.indexOf('#');
  expect(split, `coveredBy reference needs path#test-title: ${reference}`).toBeGreaterThan(0);
  const path = reference.slice(0, split);
  const expected = reference.slice(split + 1);
  const source = readFileSync(join(root, path), 'utf8');
  const titles = [...source.matchAll(/\bit\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)]
    .map((match) => match[2]!.replace(/\\(['"`\\])/g, '$1'));
  expect(titles, `coveredBy test does not exist: ${reference}`).toContain(expected);
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

  it('keeps the measured merge-slow shard floor within ten minutes', () => {
    const durations = JSON.parse(
      readFileSync(join(root, 'tools/test-durations.json'), 'utf8'),
    ) as { files: Record<string, number> };
    const mergeSlow = inventory.slowSuites
      .filter((entry) => entry.currentTier === 'merge-blocking')
      .map((entry) => entry.path);
    const unmeasured = mergeSlow.filter((path) => durations.files[path] === undefined);
    expect(unmeasured, 'a merge-blocking slow suite has no committed duration').toEqual([]);

    const workflow = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const shardMatch = workflow.match(/^\s*shard:\s*\[([^\]]+)\]/m);
    expect(shardMatch, 'check.yml no longer declares the merge-slow shard matrix').not.toBeNull();
    const shardCount = shardMatch![1]!.split(',').length;
    const costs = shardCosts(mergeSlow, shardCount, durations.files);
    const max = Math.max(...costs);

    expect(
      max,
      'merge-blocking slow suites pack above the 10-minute measured target: '
        + costs.map((ms) => `${(ms / 60000).toFixed(2)}m`).join(', '),
    ).toBeLessThanOrEqual(10 * 60_000);
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

  it('classifies every defined gate lane exactly once, regardless of CI cadence', () => {
    const source = readFileSync(join(root, 'packages/core/src/tools/gates.ts'), 'utf8');
    const defaultLane = /export const DEFAULT_LANE = '([^']+)'/.exec(source);
    const ownLane = /const OWN_LANE:[^=]+ = \{([\s\S]*?)^\};/m.exec(source);

    expect(defaultLane, 'gates.ts DEFAULT_LANE').not.toBeNull();
    expect(ownLane, 'gates.ts OWN_LANE registry').not.toBeNull();

    const dedicated = [...ownLane![1]!.matchAll(/^  (?:'([^']+)'|([A-Za-z0-9_-]+)):\s*\[/gm)]
      .map((match) => match[1] ?? match[2]!);
    const actual = [defaultLane![1]!, ...dedicated].sort();
    const recorded = inventory.gateLanes.map((entry) => entry.id).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('classifies every registered gate exactly once', () => {
    const source = readFileSync(join(root, 'packages/core/src/tools/gates.ts'), 'utf8');
    const registry = /export const GATES:[^\n]+ = \{([\s\S]*?)^\};/m.exec(source);
    expect(registry, 'gates.ts GATES registry').not.toBeNull();

    const actual = [...registry![1]!.matchAll(/^  (?:'([^']+)'|([A-Za-z0-9_-]+)):\s+/gm)]
      .map((match) => match[1] ?? match[2]!)
      .sort();
    const recorded = inventory.gates.map((entry) => entry.id).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('classifies every registered telemetry gate exactly once', () => {
    const source = readFileSync(join(root, 'packages/core/src/tools/gates.ts'), 'utf8');
    const registry = /export const TELEMETRY_GATES:[^\n]+ = \{([\s\S]*?)^\};/m.exec(source);
    expect(registry, 'gates.ts TELEMETRY_GATES registry').not.toBeNull();

    const actual = [...registry![1]!.matchAll(/^  (?:'([^']+)'|([A-Za-z0-9_-]+)):\s+/gm)]
      .map((match) => match[1] ?? match[2]!)
      .sort();
    const recorded = inventory.telemetryGates.map((entry) => entry.id).sort();

    expect(new Set(recorded).size).toBe(recorded.length);
    expect(recorded).toEqual(actual);
  });

  it('keeps every proposed move off the merge path explicitly blocked', () => {
    const entries = [...inventory.jobs, ...inventory.gateLanes, ...inventory.gates, ...inventory.telemetryGates, ...inventory.gateAssertions, ...inventory.slowSuites];
    for (const entry of entries) {
      if (!entry.currentTier.startsWith('merge-blocking') || entry.proposedTier === entry.currentTier) continue;
      expect(
        entry.moveBlockedBy?.trim(),
        JSON.stringify(entry) + ' proposes moving merge-blocking evidence without a blocker',
      ).toBeTruthy();
    }
  });
  it('requires a question and explicit classification for every entry', () => {
    const entries = [...inventory.jobs, ...inventory.gateLanes, ...inventory.gates, ...inventory.telemetryGates, ...inventory.gateAssertions, ...inventory.slowSuites];
    for (const entry of entries) {
      expect(entry.claim.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.evidenceType.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.currentTier.trim(), JSON.stringify(entry)).not.toBe('');
      expect(entry.proposedTier.trim(), JSON.stringify(entry)).not.toBe('');
    }
  });
  it('keeps war sampled evidence nightly with concrete merge witnesses', () => {
    const war = inventory.gateAssertions.filter((entry) => entry.lane === 'war');
    expect(war.map((entry) => entry.id).sort()).toEqual([
      'war:gap-widens',
      'war:it-costs',
      'war:it-pays',
      'war:progress-divergence',
    ]);
    expect(war.every((entry) => entry.currentTier === 'nightly')).toBe(true);
    expect(war.every((entry) => entry.proposedTier === 'nightly')).toBe(true);

    const asserted = war.filter((entry) => entry.evidenceType === 'statistical');
    expect(asserted.map((entry) => entry.id).sort()).toEqual([
      'war:gap-widens',
      'war:it-pays',
    ]);
    expect(asserted.every((entry) => (entry.coveredBy?.length ?? 0) > 0)).toBe(true);

    const telemetry = war.filter((entry) => entry.evidenceType === 'telemetry');
    expect(telemetry.map((entry) => entry.id).sort()).toEqual([
      'war:it-costs',
      'war:progress-divergence',
    ]);
  });

  it('keeps sampled ending distribution nightly with deterministic merge witnesses', () => {
    const gate = inventory.telemetryGates.find((entry) => entry.id === 'endings');
    expect(gate?.evidenceType).toBe('statistical ending-distribution regression');
    expect(gate?.currentTier).toBe('nightly');
    expect(gate?.proposedTier).toBe('nightly');
    expect(gate?.coveredBy).toContain(
      'packages/core/src/ending.test.ts#names every one of the five, exhaustively',
    );
    expect(gate?.coveredBy).toContain(
      'packages/core/src/ending-gate.test.ts#fails a batch where every house arrives at the same place',
    );
  });

  it('splits sampled fire-rate from blocking vocabulary authorship and outcome telemetry', () => {
    const fire = inventory.telemetryGates.find((entry) => entry.id === 'fire-rate');
    const vocabulary = inventory.gates.find((entry) => entry.id === 'vocabulary-reach');
    const outcome = inventory.telemetryGates.find((entry) => entry.id === 'outcome-reach');

    expect(inventory.gateLanes.map((entry) => entry.id)).toEqual(['batch']);
    expect(fire?.evidenceType).toBe('statistical occurrence-rate regression');
    expect(fire?.currentTier).toBe('nightly');
    expect(fire?.proposedTier).toBe('nightly');
    expect(fire?.source).toContain('gateFireRateNightly');
    expect(vocabulary?.lane).toBe('batch');
    expect(vocabulary?.evidenceType).toBe('deterministic structural verdict');
    expect(vocabulary?.currentTier).toBe('merge-blocking');
    expect(vocabulary?.proposedTier).toBe('merge-blocking');
    expect(vocabulary?.fasterEvidence).toContain('vocabulary-authorship.test.ts');
    expect(outcome?.currentTier).toBe('weekly telemetry');
    expect(outcome?.proposedTier).toBe('weekly telemetry');
  });

  it('pins each scheduled red tier to a deliberate failing fixture', () => {
    const failingScheduled = inventory.telemetryGates
      .filter((entry) => entry.currentTier === 'nightly' || entry.currentTier === 'weekly');
    expect(failingScheduled.map((entry) => entry.id).sort()).toEqual([
      'blood', 'endings', 'fire-rate', 'war',
    ]);

    for (const entry of failingScheduled) {
      expect(
        entry.failureWitness?.trim(),
        `scheduled red gate lacks a failureWitness: ${entry.id}`,
      ).toBeTruthy();
      expectTestReference(entry.failureWitness!);
      const title = entry.failureWitness!.slice(entry.failureWitness!.indexOf('#') + 1);
      expect(title, `failureWitness should name an explicit red fixture: ${entry.id}`)
        .toMatch(/\b(fail|reject)/i);
    }

    const telemetryOnly = inventory.telemetryGates
      .filter((entry) => entry.currentTier.includes('telemetry'));
    expect(telemetryOnly.map((entry) => entry.id)).toEqual(['outcome-reach']);
    expect(telemetryOnly.every((entry) => entry.failureWitness === undefined)).toBe(true);
  });

  it('pins every scheduled gate to concrete merge-blocking test titles', () => {
    for (const entry of inventory.telemetryGates) {
      expect(entry.coveredBy?.length, `scheduled gate lacks coveredBy: ${entry.id}`).toBeGreaterThan(0);
      for (const reference of entry.coveredBy ?? []) expectTestReference(reference);
    }
    for (const entry of inventory.gateAssertions.filter((candidate) => candidate.evidenceType === 'statistical')) {
      expect(entry.coveredBy?.length, `scheduled assertion lacks coveredBy: ${entry.id}`).toBeGreaterThan(0);
      for (const reference of entry.coveredBy ?? []) expectTestReference(reference);
    }
    for (const entry of inventory.slowSuites.filter((candidate) => candidate.currentTier === 'nightly')) {
      expect(entry.coveredBy?.length, `nightly slow suite lacks coveredBy: ${entry.path}`).toBeGreaterThan(0);
      for (const reference of entry.coveredBy ?? []) expectTestReference(reference);
    }
  });

  it('splits slow regression by checked evidence tier without dropping either side', () => {
    const check = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const nightly = readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8');
    const weekly = readFileSync(join(root, '.github/workflows/weekly-statistical.yml'), 'utf8');

    for (const workflow of [nightly, weekly]) {
      expect(workflow).toContain('schedule:');
      expect(workflow).toContain('workflow_dispatch:');
      expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/main"');
      expect(workflow).toContain('permissions:\n  contents: read');
      expect(workflow).not.toMatch(/^\s+pull_request:/m);
      expect(workflow).not.toMatch(/^\s+pull_request_target:/m);
      expect(workflow).not.toMatch(/^\s+merge_group:/m);
      expect(workflow).not.toMatch(/^\s+push:/m);
    }

    const mergeSlow = inventory.slowSuites.filter((entry) => entry.currentTier === 'merge-blocking');
    const nightlySlow = inventory.slowSuites.filter((entry) => entry.currentTier === 'nightly');
    expect(mergeSlow.length).toBeGreaterThan(0);
    expect(nightlySlow.length).toBeGreaterThan(0);
    expect(new Set(inventory.slowSuites.map((entry) => entry.currentTier))).toEqual(
      new Set(['merge-blocking', 'nightly']),
    );

    const mergeTestStart = check.indexOf('\n  test:\n');
    const mergeTestEnd = check.indexOf('\n  gates:\n', mergeTestStart);
    expect(mergeTestStart, 'check.yml merge-slow job').toBeGreaterThanOrEqual(0);
    expect(mergeTestEnd, 'check.yml gates job after merge-slow').toBeGreaterThan(mergeTestStart);
    const mergeTestJob = check.slice(mergeTestStart, mergeTestEnd);

    const releaseSlowStart = check.indexOf('\n  release-slow:\n');
    const releaseSlowEnd = check.indexOf('\n  release-gates:\n', releaseSlowStart);
    expect(releaseSlowStart, 'check.yml release-slow job').toBeGreaterThanOrEqual(0);
    expect(releaseSlowEnd, 'check.yml release-gates job after release-slow').toBeGreaterThan(releaseSlowStart);
    const releaseSlowJob = check.slice(releaseSlowStart, releaseSlowEnd);

    expect(check).toContain('tools/ci-evidence.json');
    expect(check).toContain('entry.currentTier === "merge-blocking"');
    expect(mergeTestJob).toContain('npm test -- ${{ steps.suites.outputs.files }} --shard=${{ matrix.shard }}/4');
    expect(mergeTestJob).not.toContain('npm test -- --shard=${{ matrix.shard }}/4');
    expect(releaseSlowJob).toContain('npm test -- --shard=${{ matrix.shard }}/4');
    expect(nightly).toContain('npm run test:slow -- --shard=${{ matrix.shard }}/4');
    expect(nightly).toContain('gate: [fire-rate, war, endings]');
    expect(nightly).toContain('npm run gates -- ${{ matrix.gate }}');
    expect(weekly).toContain('npm run gates -- blood');

    expect(check).toContain('release-slow:');
    expect(check).toContain('release-gates:');
    expect(check).toContain('gate: [blood, fire-rate, war, endings]');
    expect(check).toContain('needs: [lint, windows, test, gates, release-slow, release-gates]');
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

    for (const workflow of [checkWorkflow, nightlyWorkflow]) {
      const smokeStart = workflow.indexOf('- name: install and launch on an iPhone simulator');
      expect(smokeStart, 'iOS runtime smoke step').toBeGreaterThanOrEqual(0);
      const smoke = workflow.slice(smokeStart);
      expect(smoke.slice(0, 700)).toContain('timeout-minutes: 15');
      expect(smoke).toContain('launch_once()');
      expect(smoke).toContain('simctl launch client did not return within 120 seconds.');
      expect(smoke).toContain('simctl launch --terminate-running-process "$UDID" nz.eldritchdynasty.game');
    }
  });


  it('surfaces persistent scheduled failures as deduplicated project work', () => {
    const watcher = readFileSync(join(root, '.github/workflows/scheduled-regression-watch.yml'), 'utf8');
    const orient = readFileSync(join(root, 'tools/orient.mjs'), 'utf8');

    expect(watcher).toContain('workflow_run:');
    expect(watcher).toContain('workflows: [nightly regression, weekly statistical]');
    expect(watcher).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(watcher).toContain('issues: write');
    expect(watcher).toContain('BAD_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(watcher).toContain('RUN_URL: ${{ github.event.workflow_run.html_url }}');
    expect(watcher).toContain('--search "$TITLE in:title"');
    expect(watcher).toContain('gh issue create');
    expect(watcher).toContain('--label "priority: P0"');
    expect(watcher).toContain('--add-label "priority: P0"');
    expect(watcher).toContain('gh issue comment');
    expect(watcher).toContain('gh issue close');
    expect(watcher).toContain('contents: write');
    expect(watcher).toContain('refs/scheduled/$KEY');
    expect(watcher).toContain('since: %s');
    expect(orient).toContain("'+refs/scheduled/*:refs/scheduled/*'");
    expect(orient).toContain("for (const cadence of ['nightly', 'weekly'])");
    expect(orient).toContain('red since');
    expect(orient).toContain('scheduled evidence has not answered yet');
  });

});
