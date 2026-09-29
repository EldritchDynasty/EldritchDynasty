import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { findPackagedExecutable } from './packaged-smoke.mjs';

const PROOF_FILE = 'windows-release-proof.json';
const AUTHENTICODE_SCRIPT = `
$signature = Get-AuthenticodeSignature -LiteralPath $env:ED_RELEASE_PROOF_PATH
if ($signature.Status -ne 'Valid') {
  Write-Error ("Authenticode signature for '{0}' is {1}: {2}" -f $env:ED_RELEASE_PROOF_PATH, $signature.Status, $signature.StatusMessage)
  exit 1
}
`;

function portableRelative(from, to) {
  return relative(from, to).split(sep).join('/');
}

function runPowerShell(script, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
      windowsHide: true,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `Authenticode verification exited on signal ${signal}`
          : `Authenticode verification exited with code ${code ?? 'unknown'}`,
      ));
    });
  });
}

/**
 * Find the one NSIS installer emitted at the top level of electron-builder's
 * release directory. The unpacked application lives in win-unpacked, so every
 * top-level .exe is an installer candidate and ambiguity is a release failure.
 */
export async function findWindowsInstaller(releaseDir) {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const installers = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name)
    .sort();

  if (installers.length !== 1) {
    const found = installers.length ? installers.join(', ') : 'none';
    throw new Error(`expected exactly one Windows installer in ${releaseDir}; found ${found}`);
  }

  return join(releaseDir, installers[0]);
}

/** Compute the identity recorded beside an uploaded release artefact. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.once('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Ask Windows itself whether a PE file has a valid Authenticode signature.
 * The path travels through an environment variable rather than shell text, so
 * spaces, apostrophes and other path characters never become PowerShell code.
 */
export async function verifyAuthenticode(
  filePath,
  { platform = process.platform, run = runPowerShell } = {},
) {
  if (platform !== 'win32') {
    throw new Error('Authenticode verification requires Windows');
  }

  await run(AUTHENTICODE_SCRIPT, {
    env: { ED_RELEASE_PROOF_PATH: filePath },
  });
}

/**
 * Prove the two bytes that matter for a Windows release: the uploaded NSIS
 * installer and the packaged application it installs. Hashes are always
 * recorded. Signature verification is opt-in so pre-release tags can exercise
 * the exact packaging path while production releases can require both files to
 * be validly signed.
 */
export async function windowsReleaseProof(
  releaseDir,
  { requireSignature = false, verifySignature = verifyAuthenticode } = {},
) {
  const [installer, executable] = await Promise.all([
    findWindowsInstaller(releaseDir),
    findPackagedExecutable(releaseDir),
  ]);

  if (requireSignature) {
    await verifySignature(installer);
    await verifySignature(executable);
  }

  const [installerHash, executableHash] = await Promise.all([
    sha256File(installer),
    sha256File(executable),
  ]);
  const authenticode = requireSignature ? 'valid' : 'not-checked';

  return {
    version: 1,
    installer: {
      file: portableRelative(releaseDir, installer),
      sha256: installerHash,
      authenticode,
    },
    executable: {
      file: portableRelative(releaseDir, executable),
      sha256: executableHash,
      authenticode,
    },
  };
}

/** Persist the proof next to the installer so CI can retain the exact record. */
export async function writeWindowsReleaseProof(releaseDir, options = {}) {
  const proof = await windowsReleaseProof(releaseDir, options);
  const path = join(releaseDir, PROOF_FILE);
  await writeFile(path, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return { path, proof };
}
