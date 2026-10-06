import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { electronEnvironment } from './electron-environment.mjs';

const require = createRequire(import.meta.url);
const electronPackage = require.resolve('electron/package.json');
const electronRoot = dirname(electronPackage);

function electronExecutable() {
  try {
    return require('electron');
  } catch (firstError) {
    // Electron 42+ no longer downloads its binary from postinstall. A fresh
    // `npm ci` therefore installs the JS package first and fetches the runtime
    // only when its `install-electron` bin is invoked. Run that same package
    // entrypoint directly so every shell command (dev/start/smoke/package)
    // keeps working without a platform-specific .bin shim.
    const installed = spawnSync(process.execPath, [join(electronRoot, 'install.js')], {
      cwd: electronRoot,
      env: electronEnvironment(),
      stdio: 'inherit',
    });
    if (installed.error) throw installed.error;
    if (installed.status !== 0) {
      throw new Error(`Electron binary install exited with status ${installed.status ?? 'unknown'}`, {
        cause: firstError,
      });
    }
    return require('electron');
  }
}

// Requiring the package from Node returns the platform's Electron executable.
// Launch it directly so the environment can be corrected before Electron sees
// it; invoking the package's CLI would inherit ELECTRON_RUN_AS_NODE first.
let electron;
try {
  electron = electronExecutable();
} catch (error) {
  console.error(`could not install Electron: ${error?.message ?? error}`);
  process.exitCode = 1;
} 

if (electron) {
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
}
