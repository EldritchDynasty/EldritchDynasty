import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GATES } from './gates.js';
import {
  GATE_FINGERPRINT_ALGORITHM_VERSION,
  GATE_FINGERPRINT_ENTRIES,
  GATE_PROOF_FORMAT_VERSION,
  fingerprintGateDependencies,
  judgeTrustedProof,
  makeGateProof,
  type GateDependencyManifest,
  type GateProof,
  type TrustedWorkflowRun,
  unclassifiedRuntimeReads,
} from './gate-proof.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const fixtureRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ed-gate-proof-'));
  dirs.push(root);
  mkdirSync(join(root, 'packages/core/src'), { recursive: true });
  mkdirSync(join(root, 'packages/content/events'), { recursive: true });
  mkdirSync(join(root, 'packages/client/src'), { recursive: true });
  writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' } }));
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'packages/core/src/dep.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'packages/core/src/gate.ts'), "import { value } from './dep.js'; export const gate = () => value;\n");
  writeFileSync(join(root, 'packages/content/events/a.yaml'), 'id: a\n');
  writeFileSync(join(root, 'packages/client/src/ui.ts'), 'export const ui = 1;\n');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  return root;
};

const fingerprint = (root: string) => fingerprintGateDependencies({
  repoRoot: root,
  gate: 'fixture',
  entry: { module: 'packages/core/src/gate.ts', exportName: 'gate' },
  toolchain: { node: '22.20', runnerOs: 'Linux', runnerImage: 'ubuntu24@fixture' },
});

describe('#441 gate dependency fingerprints', () => {
  it('keeps the fingerprint entry registry in lockstep with the blocking gate registry', () => {
    expect(Object.keys(GATE_FINGERPRINT_ENTRIES).sort()).toEqual(Object.keys(GATES).sort());
  });

  it('derives code transitively, includes all content, and ignores unrelated docs/UI', async () => {
    const root = fixtureRepo();
    const before = await fingerprint(root);

    expect(before.manifest.inputs.map((input) => input.path)).toContain('packages/core/src/dep.ts');
    expect(before.manifest.inputs.map((input) => input.path)).toContain('packages/content/events/a.yaml');

    writeFileSync(join(root, 'README.md'), '# changed docs\n');
    writeFileSync(join(root, 'packages/client/src/ui.ts'), 'export const ui = 2;\n');
    expect((await fingerprint(root)).fingerprint).toBe(before.fingerprint);

    writeFileSync(join(root, 'packages/core/src/dep.ts'), 'export const value = 2;\n');
    expect((await fingerprint(root)).fingerprint).not.toBe(before.fingerprint);
  });

  it('invalidates on any authored content change', async () => {
    const root = fixtureRepo();
    const before = await fingerprint(root);
    writeFileSync(join(root, 'packages/content/events/a.yaml'), 'id: changed\n');
    expect((await fingerprint(root)).fingerprint).not.toBe(before.fingerprint);
  });

  it('invalidates on the lockfile and toolchain identity', async () => {
    const root = fixtureRepo();
    const before = await fingerprint(root);
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
    expect((await fingerprint(root)).fingerprint).not.toBe(before.fingerprint);

    const changedToolchain = await fingerprintGateDependencies({
      repoRoot: root,
      gate: 'fixture',
      entry: { module: 'packages/core/src/gate.ts', exportName: 'gate' },
      toolchain: { node: '22.21', runnerOs: 'Linux', runnerImage: 'ubuntu24@fixture' },
    });
    expect(changedToolchain.fingerprint).not.toBe(before.fingerprint);
  });

  it('fails safe when runtime reads a repository file outside the manifest', async () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'unclassified.json'), '{}\n');
    const { manifest } = await fingerprint(root);
    expect(unclassifiedRuntimeReads(root, manifest, [
      join(root, 'packages/core/src/dep.ts'),
      join(root, 'node_modules/some-package/index.js'),
      join(root, 'unclassified.json'),
    ])).toEqual(['unclassified.json']);
  });
});

const trustedRun = (): TrustedWorkflowRun => ({
  id: 42,
  event: 'push',
  head_branch: 'main',
  head_sha: 'abc123',
  path: '.github/workflows/check.yml',
  conclusion: 'success',
  head_repository: { full_name: 'EldritchDynasty/EldritchDynasty' },
});

const manifest = (): GateDependencyManifest => ({
  formatVersion: GATE_PROOF_FORMAT_VERSION,
  algorithmVersion: GATE_FINGERPRINT_ALGORITHM_VERSION,
  gate: 'land',
  invocation: ['land'],
  toolchain: { node: '22.20', runnerOs: 'Linux', runnerImage: 'ubuntu24@fixture' },
  inputs: [],
});

const trustedProof = (): GateProof => ({
  formatVersion: GATE_PROOF_FORMAT_VERSION,
  algorithmVersion: GATE_FINGERPRINT_ALGORITHM_VERSION,
  gate: 'land',
  fingerprint: 'fingerprint',
  sourceSha: 'abc123',
  sourceRunId: 42,
  sourceRepository: 'EldritchDynasty/EldritchDynasty',
  sourceWorkflow: '.github/workflows/check.yml',
  reusable: true,
  manifest: manifest(),
  runtimeReads: [],
  unclassifiedReads: [],
});

const expected = {
  repository: 'EldritchDynasty/EldritchDynasty',
  workflow: '.github/workflows/check.yml',
  gate: 'land',
  fingerprint: 'fingerprint',
};

  it('the preload attributes real runtime reads to the active gate', () => {
    const root = fixtureRepo();
    const trace = join(root, 'trace.jsonl');
    const preload = join(import.meta.dirname, '../../../../tools/gate-read-trace.mjs');
    const target = join(root, 'packages/core/src/dep.ts');
    execFileSync(process.execPath, [
      '--import', preload,
      '-e',
      `globalThis.__edGateTrace.start('fixture'); require('node:fs').readFileSync(${JSON.stringify(target)}); globalThis.__edGateTrace.stop();`,
    ], {
      cwd: root,
      env: { ...process.env, ED_GATE_READ_TRACE: trace },
      stdio: 'pipe',
    });
    const rows = readFileSync(trace, 'utf8').trim().split(/\\r?\\n/).map((line) => JSON.parse(line));
    expect(rows).toContainEqual({ gate: 'fixture', path: target });
  });

  it('marks a missing or unclassified runtime trace non-reusable', async () => {
    const root = fixtureRepo();
    const fingerprintResult = await fingerprint(root);
    const base = {
      repoRoot: root,
      fingerprint: fingerprintResult,
      sourceSha: 'abc',
      sourceRunId: 1,
      sourceRepository: 'EldritchDynasty/EldritchDynasty',
      sourceWorkflow: '.github/workflows/check.yml',
      runtimeReads: [] as string[],
    };
    expect(makeGateProof({ ...base, traceAvailable: false })).toMatchObject({
      reusable: false,
      unclassifiedReads: ['<runtime-trace-missing>'],
    });

    writeFileSync(join(root, 'mystery.json'), '{}\\n');
    expect(makeGateProof({
      ...base,
      runtimeReads: [join(root, 'mystery.json')],
      traceAvailable: true,
    })).toMatchObject({
      reusable: false,
      unclassifiedReads: ['mystery.json'],
    });
  });

describe('#441 trusted proof boundary', () => {
  it('accepts only matching successful main-push evidence', () => {
    expect(judgeTrustedProof(trustedRun(), trustedProof(), expected)).toEqual({
      reusable: true,
      reason: 'reused trusted main proof from run 42',
    });
  });

  it.each([
    ['pull request event', (r: TrustedWorkflowRun) => { r.event = 'pull_request'; }],
    ['feature branch', (r: TrustedWorkflowRun) => { r.head_branch = 'feature'; }],
    ['failed run', (r: TrustedWorkflowRun) => { r.conclusion = 'failure'; }],
    ['wrong workflow', (r: TrustedWorkflowRun) => { r.path = '.github/workflows/nightly-regression.yml'; }],
    ['fork', (r: TrustedWorkflowRun) => { r.head_repository = { full_name: 'fork/EldritchDynasty' }; }],
  ])('rejects a poisoned source: %s', (_name, poison) => {
    const run = trustedRun();
    poison(run);
    expect(judgeTrustedProof(run, trustedProof(), expected).reusable).toBe(false);
  });

  it('rejects source-SHA, run-id, algorithm, and fingerprint mismatches', () => {
    for (const mutate of [
      (p: GateProof) => { p.sourceSha = 'other'; },
      (p: GateProof) => { p.sourceRunId = 99; },
      (p: GateProof) => { p.algorithmVersion += 1; },
      (p: GateProof) => { p.fingerprint = 'other'; },
      (p: GateProof) => { p.reusable = false; },
      (p: GateProof) => { p.unclassifiedReads = ['mystery.json']; },
    ]) {
      const proof = trustedProof();
      mutate(proof);
      expect(judgeTrustedProof(trustedRun(), proof, expected).reusable).toBe(false);
    }
  });
});
