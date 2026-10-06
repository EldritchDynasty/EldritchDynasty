import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { electronEnvironment } from './electron-environment.mjs';

// Electron 42+ no longer downloads the runtime from postinstall. In the
// supported 44.x line, requiring the package is the supported lazy-install
// path: electron/index.js runs install.js if its platform binary is absent,
// then returns that executable. Keep the launch here rather than through the
// package CLI so ELECTRON_RUN_AS_NODE can be removed before Electron sees it.
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
