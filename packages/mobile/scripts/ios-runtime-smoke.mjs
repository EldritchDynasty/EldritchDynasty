import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertFinalEvidence } from './ios-smoke-evidence.mjs';

const APP_ID = 'nz.eldritchdynasty.game';
const RESULT_NAME = 'smoke-result.json';
const READY_NAME = 'smoke-ready.json';
const READY_TIMEOUT_MS = 120_000;
const DELIVERY_TIMEOUT_MS = 30_000;
const COMPLETION_TIMEOUT_MS = {
  save: 300_000,
  resume: 120_000,
  export: 120_000,
  import: 120_000,
};
const udid = process.env.IOS_SIMULATOR_UDID;

if (!udid) throw new Error('IOS_SIMULATOR_UDID is required');

function simctl(args, timeout = 30_000, env = {}) {
  const result = spawnSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`simctl ${args[0]} exited ${result.status}`);
  }
  return result.stdout.trim();
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findNamedFile(directory, name) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    // WebKit/CoreSimulator mutates cache directories while the app is running.
    // A directory discovered by its parent can therefore disappear before we
    // descend into it. Treat only that race as "not found"; surface every
    // other filesystem failure.
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findNamedFile(candidate, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return candidate;
    }
  }
  return null;
}

const dataContainer = simctl(['get_app_container', udid, APP_ID, 'data']);
let resultPath = await findNamedFile(dataContainer, RESULT_NAME);

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const readyPath = await findNamedFile(dataContainer, READY_NAME);
    if (readyPath) {
      console.log('iOS smoke listener ready');
      return readyPath;
    }
    await delay(1_000);
  }
  throw new Error(`iOS smoke listener did not become ready within ${READY_TIMEOUT_MS / 1_000} seconds`);
}

async function command(kind, url) {
  if (resultPath) await rm(resultPath, { force: true });
  resultPath = null;

  // Hosted CoreSimulator has proven unreliable at delivering a custom URL
  // through `simctl openurl`, both warm and as a cold launcher. Launch the
  // Debug app explicitly and pass the same URL through simctl's child
  // environment. SceneDelegate forwards that value through Capacitor's
  // `.capacitorOpenURL` notification after `.capacitorViewDidAppear`.
  const readyPath = await findNamedFile(dataContainer, READY_NAME);
  if (readyPath) await rm(readyPath, { force: true });
  simctl(['terminate', udid, APP_ID]);
  simctl(['launch', udid, APP_ID], 120_000, {
    SIMCTL_CHILD_ED_SMOKE_URL: url,
  });
  await waitForReady();

  const deliveryDeadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let completionDeadline = null;
  let received = false;

  while (true) {
    resultPath = await findNamedFile(dataContainer, RESULT_NAME);
    if (resultPath) {
      try {
        const evidence = JSON.parse(await readFile(resultPath, 'utf8'));
        if (evidence.command !== kind) {
          throw new Error(`expected ${kind} evidence, found ${evidence.command}`);
        }
        if (evidence.stage === 'received') {
          if (!received) {
            received = true;
            completionDeadline = Date.now() + COMPLETION_TIMEOUT_MS[kind];
            console.log(`${kind} smoke command received by app`);
          }
        } else {
          // A pair of absent hashes used to compare equal (undefined === undefined)
          // and could falsely certify persistence. Verify terminal evidence first.
          return assertFinalEvidence(kind, evidence);
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          await delay(250);
          continue;
        }
        throw error;
      }
    }

    const now = Date.now();
    if (!received && now >= deliveryDeadline) {
      throw new Error(`${kind} smoke command was not received within ${DELIVERY_TIMEOUT_MS / 1_000} seconds`);
    }
    if (received && completionDeadline !== null && now >= completionDeadline) {
      throw new Error(
        `${kind} smoke command was received but produced no final evidence within ${COMPLETION_TIMEOUT_MS[kind] / 1_000} seconds`,
      );
    }
    await delay(1_000);
  }
}

// The workflow's ordinary launch above proves the built app can start. Each
// command below terminates and relaunches the Debug app, so save/resume proves
// native persistence across an actual process boundary.
await waitForReady();
const saved = await command('save', 'eldritchdynasty-smoke://save?seed=1042&years=40');
if (saved.year !== 1082) throw new Error(`save reached ${saved.year}, expected 1082`);

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
