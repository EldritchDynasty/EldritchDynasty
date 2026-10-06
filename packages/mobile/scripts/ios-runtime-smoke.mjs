import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const APP_ID = 'nz.eldritchdynasty.game';
const RESULT_NAME = 'smoke-result.json';
const udid = process.env.IOS_SIMULATOR_UDID;

if (!udid) throw new Error('IOS_SIMULATOR_UDID is required');

function simctl(args, timeout = 30_000) {
  const result = spawnSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    timeout,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`simctl ${args[0]} exited ${result.status}`);
  }
  return result.stdout.trim();
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findResult(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findResult(candidate);
      if (nested) return nested;
    } else if (entry.name === RESULT_NAME) {
      return candidate;
    }
  }
  return null;
}

const dataContainer = simctl(['get_app_container', udid, APP_ID, 'data']);
let resultPath = await findResult(dataContainer);

async function command(kind, url) {
  if (resultPath) await rm(resultPath, { force: true });
  simctl(['openurl', udid, url]);

  for (let attempt = 0; attempt < 120; attempt++) {
    resultPath = await findResult(dataContainer);
    if (resultPath) {
      try {
        const evidence = JSON.parse(await readFile(resultPath, 'utf8'));
        if (evidence.command !== kind) {
          throw new Error(`expected ${kind} evidence, found ${evidence.command}`);
        }
        if (!evidence.ok) throw new Error(evidence.error ?? `${kind} smoke command failed`);
        return evidence;
      } catch (error) {
        if (error instanceof SyntaxError) {
          await delay(250);
          continue;
        }
        throw error;
      }
    }
    await delay(1_000);
  }
  throw new Error(`${kind} smoke command produced no evidence within 120 seconds`);
}

// Let the WebView install its appUrlOpen listener after the simulator launch.
await delay(5_000);
const saved = await command('save', 'eldritchdynasty-smoke://save?seed=1042&years=40');
if (saved.year !== 1082) throw new Error(`save reached ${saved.year}, expected 1082`);

simctl(['terminate', udid, APP_ID]);
simctl(['launch', udid, APP_ID], 120_000);
await delay(5_000);
const resumed = await command('resume', 'eldritchdynasty-smoke://resume');
if (resumed.sha256 !== saved.sha256) {
  throw new Error(`save/resume mismatch: ${saved.sha256} != ${resumed.sha256}`);
}

const exported = await command('export', 'eldritchdynasty-smoke://export');
if (!exported.path) throw new Error('export returned no interchange path');
const imported = await command(
  'import',
  `eldritchdynasty-smoke://import?path=${encodeURIComponent(exported.path)}`,
);
if (imported.sha256 !== exported.sha256) {
  throw new Error(`export/import mismatch: ${exported.sha256} != ${imported.sha256}`);
}

console.log(`save/resume sha256: ${saved.sha256}`);
console.log(`export/import sha256: ${exported.sha256}`);
