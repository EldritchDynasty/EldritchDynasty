import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { electronEnvironment } from './electron-environment.mjs';

/**
 * Find the application executable inside electron-builder's unpacked Windows
 * output. The installer itself also ends in .exe, so search only win-unpacked.
 *
 * There should be exactly one top-level executable there: the game. Failing
 * loud on zero or several is deliberate — silently choosing one would turn a
 * packaging-layout change into a smoke test of the wrong program.
 */
export async function findPackagedExecutable(releaseDir) {
  const unpacked = join(releaseDir, 'win-unpacked');
  const entries = await readdir(unpacked, { withFileTypes: true });
  const executables = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name)
    .sort();

  if (executables.length !== 1) {
    const found = executables.length ? executables.join(', ') : 'none';
    throw new Error(`expected exactly one packaged app executable in ${unpacked}; found ${found}`);
  }

  return join(unpacked, executables[0]);
}

function runProcess(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'inherit',
      windowsHide: true,
      env,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `packaged smoke exited on signal ${signal}`
          : `packaged smoke exited with code ${code ?? 'unknown'}`,
      ));
    });
  });
}

/**
 * Smoke the BUILT application, not Electron pointed at the repository.
 *
 * The source smoke in main.mjs proves the renderer and save bridge work. This
 * second hop proves electron-builder copied the client into resources and that
 * app.isPackaged resolves the renderer from there — #67's acceptance gap.
 *
 * Windows-only because this repository only ships a Windows desktop package.
 * Keeping the skip here still lets a non-Windows developer create/inspect a
 * cross-built directory without trying to execute a Windows binary.
 */
export async function smokePackagedApp(
  releaseDir,
  { platform = process.platform, run = runProcess, parentEnv = process.env } = {},
) {
  if (platform !== 'win32') return { skipped: true };

  const executable = await findPackagedExecutable(releaseDir);
  await run(executable, ['--smoke'], electronEnvironment(parentEnv));
  return { skipped: false, executable };
}
