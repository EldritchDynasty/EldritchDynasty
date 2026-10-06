import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { BLOCKING_GATE_IDS, isBlockingGateId, type BlockingGateId } from './gate-registry.js';

export const GATE_PROOF_FORMAT_VERSION = 1;
export const GATE_FINGERPRINT_ALGORITHM_VERSION = 1;

export const GATE_PROOF_RUNTIME_INPUTS = [
  '.github/workflows/check.yml',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'packages/core/src/tools/gates.ts',
  'packages/core/src/tools/gate-proof.ts',
  'packages/core/src/tools/gate-registry.ts',
  'tools/gate-read-trace.mjs',
] as const;

export interface GateFingerprintEntry {
  module: string;
  exportName: string;
}

/**
 * These are entry points, not dependency lists. esbuild derives the complete
 * transitive closure from each one. Keeping the root beside the gate registry
 * is conservative: the handful of gates still implemented in gates.ts inherit
 * that module's broad closure until they are split into smaller modules.
 */
export const GATE_FINGERPRINT_ENTRIES: Record<BlockingGateId, GateFingerprintEntry> = {
  clauses: { module: 'packages/core/src/tools/gates.ts', exportName: 'gateClauses' },
  'library-neutrality': { module: 'packages/core/src/tools/library-gate.ts', exportName: 'gateLibraryNeutrality' },
  'outcome-reach-blocking': { module: 'packages/core/src/tools/outcome-reach-blocking.ts', exportName: 'gateUnwitnessedOutcomeReach' },
  'short-line': { module: 'packages/core/src/tools/short-line-gate.ts', exportName: 'gateShortLine' },
  ladder: { module: 'packages/core/src/tools/ladder-gate.ts', exportName: 'gateLadder' },
  'ladder-scales': { module: 'packages/core/src/tools/gates.ts', exportName: 'gateLadderScales' },
  purposes: { module: 'packages/core/src/tools/gates.ts', exportName: 'gatePurposes' },
  'vocabulary-reach': { module: 'packages/core/src/tools/gates.ts', exportName: 'gateVocabularyReach' },
  bottleneck: { module: 'packages/core/src/tools/bottleneck-gate.ts', exportName: 'gateFoundingRecovery' },
  land: { module: 'packages/core/src/tools/land-gate.ts', exportName: 'gateLand' },
  'slot-fillability': { module: 'packages/core/src/tools/gates.ts', exportName: 'gateSlotFillability' },
  'post-fillability': { module: 'packages/core/src/tools/gates.ts', exportName: 'gatePostFillability' },
};

export interface GateManifestInput {
  path: string;
  sha256: string;
}

export interface GateToolchainIdentity {
  node: string;
  runnerOs: string;
  runnerImage: string;
}

export interface GateDependencyManifest {
  formatVersion: number;
  algorithmVersion: number;
  gate: string;
  entry: GateFingerprintEntry;
  invocation: readonly string[];
  toolchain: GateToolchainIdentity;
  inputs: GateManifestInput[];
}

export interface GateFingerprintResult {
  fingerprint: string;
  manifest: GateDependencyManifest;
}

export interface TrustedWorkflowRun {
  id: number;
  event: string;
  head_branch: string;
  head_sha: string;
  path: string;
  conclusion: string | null;
  head_repository?: { full_name?: string | null } | null;
}

export interface GateProof {
  formatVersion: number;
  algorithmVersion: number;
  gate: string;
  fingerprint: string;
  sourceSha: string;
  sourceRunId: number;
  sourceRepository: string;
  sourceWorkflow: string;
  reusable: boolean;
  verdict: 'success';
  manifest: GateDependencyManifest;
  runtimeReads: string[];
  unclassifiedReads: string[];
}

export interface ProofTrustDecision {
  reusable: boolean;
  reason: string;
}

const sha256 = (value: Buffer | string): string =>
  createHash('sha256').update(value).digest('hex');

export const fingerprintGateManifest = (manifest: GateDependencyManifest): string =>
  sha256(JSON.stringify(manifest));

const slash = (value: string): string => value.split(sep).join('/');

const repoRelative = (repoRoot: string, file: string): string | null => {
  const absolute = resolve(file);
  const rel = slash(relative(resolve(repoRoot), absolute));
  if (!rel || rel === '.') return null;
  if (rel === '..' || rel.startsWith('../')) return null;
  return rel;
};

const filesUnder = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  visit(root);
  return out.sort((a, b) => a.localeCompare(b));
};

const defaultToolchain = (): GateToolchainIdentity => ({
  node: process.versions.node.split('.').slice(0, 2).join('.'),
  runnerOs: process.env.RUNNER_OS ?? process.platform,
  runnerImage: [
    process.env.ImageOS,
    process.env.ImageVersion,
  ].filter(Boolean).join('@') || 'local',
});

export interface FingerprintOptions {
  repoRoot: string;
  gate: string;
  entry: GateFingerprintEntry;
  invocation?: readonly string[];
  toolchain?: GateToolchainIdentity;
}

/**
 * Build the dependency fingerprint without running the gate.
 *
 * esbuild's metafile is the authority for code dependencies. Content is
 * deliberately all-or-nothing because every simulation gate loads the bundle.
 * package-lock + Node/runner identity cover the toolchain. The manifest is
 * sorted before hashing so filesystem enumeration order cannot change proof
 * identity.
 */
export async function fingerprintGateDependencies(
  options: FingerprintOptions,
): Promise<GateFingerprintResult> {
  const repoRoot = resolve(options.repoRoot);
  const modulePath = slash(options.entry.module);
  const exportName = options.entry.exportName;
  const result = await build({
    stdin: {
      contents: `export { ${exportName} as gate } from './${modulePath}';`,
      resolveDir: repoRoot,
      sourcefile: `<gate-proof-${options.gate}.ts>`,
      loader: 'ts',
    },
    absWorkingDir: repoRoot,
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    treeShaking: true,
    tsconfig: join(repoRoot, 'tsconfig.base.json'),
    logLevel: 'silent',
  });

  if (!result.metafile) throw new Error('esbuild did not return dependency metadata');
  const paths = new Set<string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.startsWith('<')) continue;
    const absolute = isAbsolute(input) ? input : resolve(repoRoot, input);
    const rel = repoRelative(repoRoot, absolute);
    if (rel) paths.add(rel);
  }
  for (const file of filesUnder(join(repoRoot, 'packages', 'content'))) {
    const rel = repoRelative(repoRoot, file);
    if (rel) paths.add(rel);
  }
  for (const required of GATE_PROOF_RUNTIME_INPUTS) {
    const absolute = join(repoRoot, required);
    if (!existsSync(absolute)) {
      throw new Error(`gate proof dependency is missing: ${required}`);
    }
    paths.add(required);
  }

  const inputs: GateManifestInput[] = [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      sha256: sha256(readFileSync(join(repoRoot, path))),
    }));

  const manifest: GateDependencyManifest = {
    formatVersion: GATE_PROOF_FORMAT_VERSION,
    algorithmVersion: GATE_FINGERPRINT_ALGORITHM_VERSION,
    gate: options.gate,
    entry: { module: modulePath, exportName },
    invocation: [...(options.invocation ?? [options.gate])],
    toolchain: options.toolchain ?? defaultToolchain(),
    inputs,
  };

  return {
    fingerprint: fingerprintGateManifest(manifest),
    manifest,
  };
}

export async function fingerprintRegisteredGate(
  repoRoot: string,
  gate: string,
  invocation: readonly string[] = [gate],
): Promise<GateFingerprintResult> {
  if (!isBlockingGateId(gate)) throw new Error(`no fingerprint entry registered for gate ${gate}`);
  const entry = GATE_FINGERPRINT_ENTRIES[gate];
  return fingerprintGateDependencies({ repoRoot, gate, entry, invocation });
}

/**
 * Runtime tracing is a second, fail-safe boundary. A repository file read at
 * execution time that was not already in the static/content/toolchain manifest
 * makes the proof non-reusable rather than silently extending the dependency
 * model optimistically.
 */
export function unclassifiedRuntimeReads(
  repoRoot: string,
  manifest: GateDependencyManifest,
  runtimeReads: readonly string[],
): string[] {
  const declared = new Set(manifest.inputs.map((input) => input.path));
  const unknown = new Set<string>();

  for (const raw of runtimeReads) {
    const absolute = isAbsolute(raw) ? resolve(raw) : resolve(repoRoot, raw);
    const rel = repoRelative(repoRoot, absolute);
    if (!rel || rel.startsWith('node_modules/') || rel.startsWith('.git/')) continue;
    if (declared.has(rel)) continue;

    // The content tree is intentionally fingerprinted in full. Directory reads
    // under that tree are therefore classified by the complete file inventory,
    // while an enumerated directory anywhere else remains unknown.
    if (
      (rel === 'packages/content' || rel.startsWith('packages/content/'))
      && existsSync(absolute)
      && statSync(absolute).isDirectory()
    ) continue;

    unknown.add(rel);
  }
  return [...unknown].sort((a, b) => a.localeCompare(b));
}


const objectRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function parseGateProof(value: unknown): GateProof | null {
  const proof = objectRecord(value);
  const manifest = objectRecord(proof?.manifest);
  const entry = objectRecord(manifest?.entry);
  const toolchain = objectRecord(manifest?.toolchain);
  const inputs = manifest?.inputs;

  if (
    !proof
    || typeof proof.formatVersion !== 'number'
    || typeof proof.algorithmVersion !== 'number'
    || typeof proof.gate !== 'string'
    || typeof proof.fingerprint !== 'string'
    || typeof proof.sourceSha !== 'string'
    || typeof proof.sourceRunId !== 'number'
    || typeof proof.sourceRepository !== 'string'
    || typeof proof.sourceWorkflow !== 'string'
    || typeof proof.reusable !== 'boolean'
    || proof.verdict !== 'success'
    || !stringArray(proof.runtimeReads)
    || !stringArray(proof.unclassifiedReads)
    || !manifest
    || typeof manifest.formatVersion !== 'number'
    || typeof manifest.algorithmVersion !== 'number'
    || typeof manifest.gate !== 'string'
    || !entry
    || typeof entry.module !== 'string'
    || typeof entry.exportName !== 'string'
    || !stringArray(manifest.invocation)
    || !toolchain
    || typeof toolchain.node !== 'string'
    || typeof toolchain.runnerOs !== 'string'
    || typeof toolchain.runnerImage !== 'string'
    || !Array.isArray(inputs)
    || !inputs.every((item) => {
      const input = objectRecord(item);
      return Boolean(input && typeof input.path === 'string' && typeof input.sha256 === 'string');
    })
  ) return null;

  return value as GateProof;
}

export function parseTrustedWorkflowRun(value: unknown): TrustedWorkflowRun | null {
  const run = objectRecord(value);
  const headRepository = objectRecord(run?.head_repository);
  if (
    !run
    || typeof run.id !== 'number'
    || !Number.isSafeInteger(run.id)
    || run.id <= 0
    || typeof run.event !== 'string'
    || typeof run.head_branch !== 'string'
    || typeof run.head_sha !== 'string'
    || typeof run.path !== 'string'
    || !(typeof run.conclusion === 'string' || run.conclusion === null)
    || !headRepository
    || typeof headRepository.full_name !== 'string'
  ) return null;

  return value as TrustedWorkflowRun;
}

export function judgeTrustedProof(
  run: TrustedWorkflowRun,
  proof: GateProof,
  expected: {
    repository: string;
    workflow: string;
    gate: string;
    fingerprint: string;
  },
): ProofTrustDecision {
  if (run.event !== 'push') return { reusable: false, reason: `source event is ${run.event}, not push` };
  if (run.head_branch !== 'main') return { reusable: false, reason: `source branch is ${run.head_branch}, not main` };
  if (run.path !== expected.workflow) return { reusable: false, reason: `source workflow is ${run.path}` };
  if (run.conclusion !== 'success') return { reusable: false, reason: `source conclusion is ${run.conclusion ?? 'missing'}` };
  if (run.head_repository?.full_name !== expected.repository) {
    return { reusable: false, reason: `source repository is ${run.head_repository?.full_name ?? 'missing'}` };
  }
  if (proof.formatVersion !== GATE_PROOF_FORMAT_VERSION) return { reusable: false, reason: 'proof format version mismatch' };
  if (proof.verdict !== 'success') return { reusable: false, reason: `proof verdict is ${String(proof.verdict)}` };
  if (proof.manifest.formatVersion !== proof.formatVersion) return { reusable: false, reason: 'manifest proof format version mismatch' };
  if (proof.manifest.algorithmVersion !== proof.algorithmVersion) return { reusable: false, reason: 'manifest fingerprint algorithm version mismatch' };
  if (proof.manifest.gate !== proof.gate) return { reusable: false, reason: 'manifest gate mismatch' };
  if (fingerprintGateManifest(proof.manifest) !== proof.fingerprint) return { reusable: false, reason: 'proof fingerprint does not match its manifest' };
  if (proof.algorithmVersion !== GATE_FINGERPRINT_ALGORITHM_VERSION) return { reusable: false, reason: 'fingerprint algorithm version mismatch' };
  if (proof.gate !== expected.gate) return { reusable: false, reason: `proof gate is ${proof.gate}` };
  if (proof.sourceRepository !== expected.repository) return { reusable: false, reason: `proof repository is ${proof.sourceRepository}` };
  if (proof.sourceWorkflow !== expected.workflow) return { reusable: false, reason: `proof workflow is ${proof.sourceWorkflow}` };
  if (proof.sourceRunId !== run.id) return { reusable: false, reason: 'proof source run does not match workflow run' };
  if (proof.sourceSha !== run.head_sha) return { reusable: false, reason: 'proof source SHA does not match workflow run' };
  if (!proof.reusable) return { reusable: false, reason: 'producer marked proof non-reusable' };
  if (proof.unclassifiedReads.length) return { reusable: false, reason: 'proof contains unclassified runtime reads' };
  if (proof.fingerprint !== expected.fingerprint) return { reusable: false, reason: 'dependency fingerprint changed' };
  return { reusable: true, reason: `reused trusted main proof from run ${run.id}` };
}



export interface TrustedProofCandidate {
  run: TrustedWorkflowRun;
  proof: unknown;
}

export interface SelectedTrustedProof {
  run: TrustedWorkflowRun;
  proof: GateProof;
  decision: ProofTrustDecision;
}

export function selectNewestTrustedProof(
  candidates: readonly TrustedProofCandidate[],
  expected: {
    repository: string;
    workflow: string;
    gate: string;
    fingerprint: string;
  },
): SelectedTrustedProof | null {
  const newestFirst = [...candidates].sort((a, b) => b.run.id - a.run.id);
  for (const candidate of newestFirst) {
    const proof = parseGateProof(candidate.proof);
    if (!proof) continue;
    const decision = judgeTrustedProof(candidate.run, proof, expected);
    if (decision.reusable) return { run: candidate.run, proof, decision };
  }
  return null;
}

export interface MakeGateProofOptions {
  repoRoot: string;
  fingerprint: GateFingerprintResult;
  sourceSha: string;
  sourceRunId: number;
  sourceRepository: string;
  sourceWorkflow: string;
  runtimeReads: readonly string[];
  traceAvailable?: boolean;
}

export function makeGateProof(options: MakeGateProofOptions): GateProof {
  const runtimeReads = [...new Set(options.runtimeReads)].sort((a, b) => a.localeCompare(b));
  const unclassifiedReads = options.traceAvailable === false
    ? ['<runtime-trace-missing>']
    : unclassifiedRuntimeReads(options.repoRoot, options.fingerprint.manifest, runtimeReads);

  return {
    formatVersion: GATE_PROOF_FORMAT_VERSION,
    algorithmVersion: GATE_FINGERPRINT_ALGORITHM_VERSION,
    gate: options.fingerprint.manifest.gate,
    fingerprint: options.fingerprint.fingerprint,
    sourceSha: options.sourceSha,
    sourceRunId: options.sourceRunId,
    sourceRepository: options.sourceRepository,
    sourceWorkflow: options.sourceWorkflow,
    reusable: unclassifiedReads.length === 0,
    verdict: 'success',
    manifest: options.fingerprint.manifest,
    runtimeReads,
    unclassifiedReads,
  };
}

interface TraceLine {
  gate?: string;
  path?: string;
  marker?: string;
}

const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

async function produceProofFiles(argv: readonly string[]): Promise<void> {
  const repoRoot = resolve(option(argv, '--repo-root') ?? process.cwd());
  const tracePath = option(argv, '--trace');
  const outputDir = resolve(repoRoot, option(argv, '--output-dir') ?? 'gate-proofs');
  const sourceSha = option(argv, '--source-sha');
  const sourceRun = option(argv, '--source-run');
  const sourceRepository = option(argv, '--repository');
  const sourceWorkflow = option(argv, '--workflow') ?? '.github/workflows/check.yml';

  if (!sourceSha || !sourceRun || !sourceRepository) {
    throw new Error('produce requires --source-sha, --source-run, and --repository');
  }
  const sourceRunId = Number(sourceRun);
  if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) {
    throw new Error(`invalid --source-run ${sourceRun}`);
  }

  const traceAvailable = Boolean(tracePath && existsSync(tracePath));
  const traces = new Map<string, string[]>();
  const tracedPhases = new Set<string>();
  if (traceAvailable && tracePath) {
    for (const line of readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line) as TraceLine;
      if (!record.gate) continue;
      if (record.marker === 'start') tracedPhases.add(record.gate);
      if (!record.path) continue;
      const values = traces.get(record.gate) ?? [];
      values.push(record.path);
      traces.set(record.gate, values);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const summary: Array<{ gate: string; fingerprint: string; reusable: boolean; unclassifiedReads: string[] }> = [];

  for (const gate of BLOCKING_GATE_IDS) {
    const fingerprint = await fingerprintRegisteredGate(repoRoot, gate);
    const proof = makeGateProof({
      repoRoot,
      fingerprint,
      sourceSha,
      sourceRunId,
      sourceRepository,
      sourceWorkflow,
      runtimeReads: [
        ...(traces.get('__shared__') ?? []),
        ...(traces.get(gate) ?? []),
      ],
      traceAvailable: traceAvailable
        && tracedPhases.has('__shared__')
        && tracedPhases.has(gate),
    });
    writeFileSync(
      join(outputDir, `gate-proof-${gate}.json`),
      `${JSON.stringify(proof, null, 2)}\n`,
    );
    summary.push({
      gate,
      fingerprint: proof.fingerprint,
      reusable: proof.reusable,
      unclassifiedReads: proof.unclassifiedReads,
    });
  }

  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  for (const row of summary) {
    const state = row.reusable ? 'reusable' : `non-reusable: ${row.unclassifiedReads.join(', ')}`;
    console.log(`${row.gate}: ${row.fingerprint.slice(0, 12)} — ${state}`);
  }
}


const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

export interface GateReusePlanRow {
  gate: BlockingGateId;
  fingerprint: string;
  action: 'reuse' | 'run';
  reason: string;
  sourceRunId?: number;
  sourceSha?: string;
}

export interface GateReusePlan {
  version: 1;
  repository: string;
  workflow: string;
  gates: GateReusePlanRow[];
}

async function planProofReuse(argv: readonly string[]): Promise<void> {
  const repoRoot = resolve(option(argv, '--repo-root') ?? process.cwd());
  const candidateRootRaw = option(argv, '--candidate-root');
  const outputRaw = option(argv, '--output');
  const repository = option(argv, '--repository');
  const workflow = option(argv, '--workflow') ?? '.github/workflows/check.yml';

  if (!candidateRootRaw || !outputRaw || !repository) {
    throw new Error('plan requires --candidate-root, --output, and --repository');
  }

  const candidateRoot = resolve(repoRoot, candidateRootRaw);
  const output = resolve(repoRoot, outputRaw);
  const runs: Array<{ run: TrustedWorkflowRun; dir: string }> = [];
  if (existsSync(candidateRoot)) {
    for (const entry of readdirSync(candidateRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(candidateRoot, entry.name);
      const run = parseTrustedWorkflowRun(readJsonFile(join(dir, 'run.json')));
      if (run) runs.push({ run, dir });
    }
  }

  const gates: GateReusePlanRow[] = [];
  for (const gate of BLOCKING_GATE_IDS) {
    const current = await fingerprintRegisteredGate(repoRoot, gate);
    const candidates: TrustedProofCandidate[] = runs.map(({ run, dir }) => ({
      run,
      proof: readJsonFile(join(dir, `gate-proof-${gate}.json`)),
    }));
    const selected = selectNewestTrustedProof(candidates, {
      repository,
      workflow,
      gate,
      fingerprint: current.fingerprint,
    });

    if (selected) {
      gates.push({
        gate,
        fingerprint: current.fingerprint,
        action: 'reuse',
        reason: selected.decision.reason,
        sourceRunId: selected.run.id,
        sourceSha: selected.run.head_sha,
      });
    } else {
      gates.push({
        gate,
        fingerprint: current.fingerprint,
        action: 'run',
        reason: `no matching trusted main proof among ${runs.length} candidate run(s)`,
      });
    }
  }

  const plan: GateReusePlan = {
    version: 1,
    repository,
    workflow,
    gates,
  };
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  for (const row of gates) {
    const source = row.action === 'reuse' ? ` from run ${row.sourceRunId}` : '';
    console.log(`${row.gate}: ${row.action}${source} — ${row.reason}`);
  }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/gate-proof.ts');
if (isMain) {
  const [command, ...argv] = process.argv.slice(2);
  const run = command === 'produce'
    ? produceProofFiles(argv)
    : command === 'plan'
      ? planProofReuse(argv)
      : null;
  if (!run) {
    console.error('usage: gate-proof.ts produce --trace <jsonl> --output-dir <dir> --source-sha <sha> --source-run <id> --repository <owner/repo> [--workflow <path>]');
    console.error('   or: gate-proof.ts plan --candidate-root <dir> --output <json> --repository <owner/repo> [--workflow <path>]');
    process.exit(2);
  }
  run.catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
