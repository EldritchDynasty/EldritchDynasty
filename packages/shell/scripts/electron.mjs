import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { electronEnvironment } from './electron-environment.mjs';

// Requiring the package from Node returns the platform's Electron executable.
// Launch it directly so the environment can be corrected before Electron sees
// it; invoking the package's CLI would inherit ELECTRON_RUN_AS_NODE first.
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, process.argv.slice(2), {
  cwd: process.cwd(),
  env: electronEnvironment(),
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`could not launch Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
