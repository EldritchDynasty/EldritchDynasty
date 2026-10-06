import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';

export const GATE_PROOF_FORMAT_VERSION = 1;
export const GATE_FINGERPRINT_ALGORITHM_VERSION = 1;

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
export const GATE_FINGERPRINT_ENTRIES: Record<string, GateFingerprintEntry> = {
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
      sourcefile: `gate-proof-${options.gate}.ts`,
      loader: 'ts',
    },
    absWorkingDir: repoRoot,
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'bundle',
    treeShaking: true,
    tsconfig: join(repoRoot, 'tsconfig.base.json'),
    logLevel: 'silent',
  });

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
  paths.add('package-lock.json');

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
    invocation: [...(options.invocation ?? [options.gate])],
    toolchain: options.toolchain ?? defaultToolchain(),
    inputs,
  };

  return {
    fingerprint: sha256(JSON.stringify(manifest)),
    manifest,
  };
}

export async function fingerprintRegisteredGate(
  repoRoot: string,
  gate: string,
  invocation: readonly string[] = [gate],
): Promise<GateFingerprintResult> {
  const entry = GATE_FINGERPRINT_ENTRIES[gate];
  if (!entry) throw new Error(`no fingerprint entry registered for gate ${gate}`);
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
    const rel = isAbsolute(raw)
      ? repoRelative(repoRoot, raw)
      : slash(raw).replace(/^\.\//, '');
    if (!rel || rel.startsWith('node_modules/') || rel.startsWith('.git/')) continue;
    if (!declared.has(rel)) unknown.add(rel);
  }
  return [...unknown].sort((a, b) => a.localeCompare(b));
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
    manifest: options.fingerprint.manifest,
    runtimeReads,
    unclassifiedReads,
  };
}

interface TraceLine {
  gate?: string;
  path?: string;
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
  if (traceAvailable && tracePath) {
    for (const line of readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line) as TraceLine;
      if (!record.gate || !record.path) continue;
      const values = traces.get(record.gate) ?? [];
      values.push(record.path);
      traces.set(record.gate, values);
    }
  }

  const { GATES } = await import('./gates.js');
  mkdirSync(outputDir, { recursive: true });
  const summary: Array<{ gate: string; fingerprint: string; reusable: boolean; unclassifiedReads: string[] }> = [];

  for (const gate of Object.keys(GATES)) {
    const fingerprint = await fingerprintRegisteredGate(repoRoot, gate);
    const proof = makeGateProof({
      repoRoot,
      fingerprint,
      sourceSha,
      sourceRunId,
      sourceRepository,
      sourceWorkflow,
      runtimeReads: traces.get(gate) ?? [],
      traceAvailable,
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

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/gate-proof.ts');
if (isMain) {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== 'produce') {
    console.error('usage: gate-proof.ts produce --trace <jsonl> --output-dir <dir> --source-sha <sha> --source-run <id> --repository <owner/repo> [--workflow <path>]');
    process.exit(2);
  }
  produceProofFiles(argv).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
