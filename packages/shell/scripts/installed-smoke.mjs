import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronEnvironment } from './electron-environment.mjs';
import { findWindowsInstaller, sha256File } from './windows-release-proof.mjs';

/**
 * Issue #712: smoke the artifact a player installs, not the win-unpacked tree
 * already tested by the packaging job. The manifest and installer travel
 * together through actions/upload-artifact -> download-artifact on a NEW VM.
 */
const PROOF_NAME = 'windows-release-proof.json';
const GAME_EXECUTABLE = 'win-unpacked/Eldritch Dynasty.exe';
const HASH = /^[a-f0-9]{64}$/i;
const NATIVE_HASH = /^[a-f0-9]{64}$/;

function fileLeaf(value) {
  return typeof value === 'string' && value !== '.' && value !== '..'
    && !/[\\/]/.test(value) && value.toLowerCase().endsWith('.exe');
}

/** Reject malformed or path-escaping manifest fields before executing bytes. */
export function checkedWindowsReleaseProof(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) || proof.version !== 1
    || !proof.installer || !proof.executable
    || !fileLeaf(proof.installer.file)
    || proof.executable.file !== GAME_EXECUTABLE
    || !HASH.test(proof.installer.sha256)
    || !HASH.test(proof.executable.sha256)) {
    throw new Error('invalid Windows release proof manifest (version, paths or SHA-256)');
  }
  return proof;
}

/**
 * Fail closed on native smoke evidence: exit 0 alone is insufficient, because
 * a GUI executable can exit successfully before its client received a command.
 */
export function checkedNativeSmokeEvidence(value, command, nonce) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.ok !== true || value.command !== command || value.nonce !== nonce
    || !Number.isSafeInteger(value.year) || value.year < 1042
    || typeof value.sha256 !== 'string' || !NATIVE_HASH.test(value.sha256)) {
    throw new Error(`invalid ${command} native smoke evidence (command, nonce, year or SHA-256)`);
  }
  return value;
}

function runExecutable(program, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${basename(program)} failed: ${signal ?? `exit ${code}`}`));
    });
  });
}

/**
 * Verifies the downloaded installer's hash BEFORE running it, then verifies
 * the installed game's hash BEFORE booting it. A fresh, private installation
 * directory stops an old copy of the app masking a broken downloaded build.
 * run/makeDirectory remove the host dependency for deterministic tests.
 */
export async function smokeInstalledWindowsArtifact(
  artifactDir,
  {
    platform = process.platform,
    parentEnv = process.env,
    tempRoot = process.env.RUNNER_TEMP ?? tmpdir(),
    run = runExecutable,
    makeDirectory = mkdtemp,
    removeDirectory = rm,
  } = {},
) {
  if (platform !== 'win32') throw new Error('installed Windows smoke requires a Windows runner');
  const proof = checkedWindowsReleaseProof(
    JSON.parse(await readFile(join(artifactDir, PROOF_NAME), 'utf8')),
  );
  const installer = await findWindowsInstaller(artifactDir);
  if (basename(installer) !== proof.installer.file) {
    throw new Error('downloaded installer name does not match release proof');
  }

  const actualInstallerHash = await sha256File(installer);
  if (actualInstallerHash.toLowerCase() !== proof.installer.sha256.toLowerCase()) {
    throw new Error('downloaded Windows installer SHA-256 mismatch; refusing to execute');
  }

  // NSIS accepts /D=<absolute-directory> only as its last argument, without
  // enclosing quotes. mkdtemp supplies a fresh target on this new runner.
  const installDir = await makeDirectory(join(tempRoot, 'ed-installed-smoke-'));
  try {
    await run(installer, ['/S', `/D=${installDir}`], parentEnv);
    const installedGame = join(installDir, 'Eldritch Dynasty.exe');
    const actualGameHash = await sha256File(installedGame);
    if (actualGameHash.toLowerCase() !== proof.executable.sha256.toLowerCase()) {
      throw new Error('installed Windows game SHA-256 mismatch; refusing to boot');
    }
    await run(installedGame, ['--smoke'], electronEnvironment(parentEnv));

    // The original renderer test proves a one-process bridge round trip only.
    // Two fresh launches of the *installed* bytes additionally prove that a
    // real GameSession save can survive process exit and validated resume.
    // Isolate both processes from any existing player's saves or Steam profile.
    const nonce = randomUUID();
    const profile = join(installDir, 'smoke-profile');
    const evidencePath = join(profile, 'smoke-evidence.json');
    const smokeEnv = {
      ...electronEnvironment(parentEnv),
      ED_SMOKE_PROFILE: profile,
      ED_SMOKE_NONCE: nonce,
    };
    await run(installedGame, ['--smoke-save'], smokeEnv);
    const saved = checkedNativeSmokeEvidence(
      JSON.parse(await readFile(evidencePath, 'utf8')), 'save', nonce,
    );
    await rm(evidencePath);
    await run(installedGame, ['--smoke-resume'], smokeEnv);
    const resumed = checkedNativeSmokeEvidence(
      JSON.parse(await readFile(evidencePath, 'utf8')), 'resume', nonce,
    );
    if (saved.sha256 !== resumed.sha256 || saved.year !== resumed.year) {
      throw new Error('installed Windows game resumed a different save SHA-256 or year after cold relaunch');
    }
    return { installer, installedGame, sha256: actualGameHash, saveSha256: saved.sha256, year: saved.year };
  } finally {
    // GitHub-hosted Windows runners are throwaway machines. Best-effort cleanup
    // must not overwrite an earlier artifact mismatch or smoke failure.
    try { await removeDirectory(installDir, { recursive: true, force: true }); }
    catch (error) { console.warn('installed smoke cleanup:', error); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const artifactDir = process.argv[2];
  if (!artifactDir) {
    console.error('usage: node installed-smoke.mjs <downloaded-artifact-directory>');
    process.exitCode = 2;
  } else {
    smokeInstalledWindowsArtifact(artifactDir).then(
      ({ sha256, saveSha256, year }) => console.log(`installed Windows game smoke passed: executable=${sha256} resumed-year=${year} save=${saveSha256}`),
      (error) => {
        console.error(error?.stack ?? String(error));
        process.exitCode = 1;
      },
    );
  }
}
