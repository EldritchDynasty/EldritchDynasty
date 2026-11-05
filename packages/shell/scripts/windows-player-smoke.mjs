/**
 * Packaged Windows acceptance for #1986 / #1995; never part of ordinary CI.
 * Run: node packages/shell/scripts/windows-player-smoke.mjs
 * Requires the matching checkout and `npm run build:shell` first.
 * Playwright drives the real packaged renderer, preload, disk and AudioContext.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { register } from 'tsx/esm/api';
import { electronEnvironment } from './electron-environment.mjs';
import { sha256File } from './windows-release-proof.mjs';

if (process.platform !== 'win32') throw new Error('This smoke requires a Windows PC');
register();
const { loadBundle } = await import('@ed/content');
const { canonical, newGame, newGameFromShareCode } = await import('@ed/core');
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(repo, 'packages/shell/release');
const executable = join(output, 'win-unpacked/Eldritch Dynasty.exe');
const renderer = join(output, 'win-unpacked/resources/renderer');
const build = process.env.ED_BUILD_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const key = 'eldritch-dynasty:reading';
const content = loadBundle();
const report = { build, at: new Date().toISOString(), windows: release(), node: process.version, checks: [] };
const cache = join(repo, 'node_modules/.cache');
await mkdir(cache, { recursive: true });
const scratch = await mkdtemp(join(cache, 'windows-player-'));
const profile = join(scratch, 'appdata/Eldritch Dynasty');
const hash = value => createHash('sha256').update(value).digest('hex');
let app;
let page;
const errors = [];

function founded(campaign = 'short', seed = 1995) {
  const game = newGame(content, { seed, campaign });
  const p = game.prologue();
  const result = game.found({
    houseName: 'House Windows',
    founder: { name: 'Élodie 雪', gender: 'woman', configuration: 'blood_mother' },
    friends: [{ name: 'Iona Vale', sex: 'female' }],
    heirloom: p.heirlooms[0].heirloom, grudge: p.grudges[0].house,
    answers: Object.fromEntries(p.examination.map(q => [q.id, q.answers[0].id])),
  });
  assert.equal(result.ok, true, result.reason);
  return game;
}

// Transparent taps on real nodes. The analyser carries the existing master
// signal to the actual destination: no fake engine, generated test tone,
// autoplay bypass or replacement platform adapter.
function observeAudio() {
  const observed = { contexts: [], started: 0 };
  window.__windowsAudio = observed;
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(options) {
      super(options);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      analyser.connect(this.destination);
      observed.contexts.push({ context: this, analyser });
    }
    createGain() {
      const gain = super.createGain();
      const connect = gain.connect.bind(gain);
      gain.connect = (destination, ...args) => {
        const entry = observed.contexts.find(e => e.context === this);
        return connect(destination === this.destination ? entry.analyser : destination, ...args);
      };
      return gain;
    }
    createOscillator() {
      const node = super.createOscillator();
      const start = node.start.bind(node);
      node.start = (...args) => { observed.started++; return start(...args); };
      return node;
    }
  };
}

const audio = () => page.evaluate(() => {
  const h = window.__windowsAudio;
  const e = h.contexts.at(-1);
  const samples = new Float32Array(2048);
  e?.analyser.getFloatTimeDomainData(samples);
  return { made: h.contexts.length, started: h.started, state: e?.context.state ?? 'none',
    peak: Math.max(...samples.map(Math.abs)), time: e?.context.currentTime ?? 0 };
});
const disk = () => readFile(join(profile, 'saves/autosave.edsave.json'), 'utf8').then(JSON.parse);
const record = (check, evidence = {}) => { report.checks.push({ check, ...evidence }); console.log(`ok — ${check}`); };

async function attachMain(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('main debugger connection timed out')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
  });
  let id = 0;
  const calls = new Map();
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data);
    const call = calls.get(reply.id);
    if (!call) return;
    calls.delete(reply.id);
    clearTimeout(call.timer);
    if (reply.error || reply.result?.exceptionDetails) call.reject(new Error(JSON.stringify(reply)));
    else call.resolve(reply.result);
  });
  socket.addEventListener('close', () => {
    for (const call of calls.values()) { clearTimeout(call.timer); call.reject(new Error('main process closed')); }
    calls.clear();
  });
  const evaluate = async (fn, arg) => {
    const request = ++id;
    const answer = new Promise((resolve, reject) => calls.set(request, { resolve, reject,
      timer: setTimeout(() => { calls.delete(request); reject(new Error('main debugger request timed out')); }, 10000),
    }));
    socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: {
      expression: `(${fn.toString()})(require('electron'), ${JSON.stringify(arg) ?? 'undefined'})`,
      includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
    } }));
    return (await answer).result.value;
  };
  evaluate.disconnect = () => socket.close();
  return evaluate;
}

async function launch() {
  // The shipped shell explicitly chooses its profile. Its diagnostic switch
  // requires a private profile and nonce before any BrowserWindow is created.
  const child = spawn(executable, ['--inspect=0', '--remote-debugging-port=0', '--smoke-player'], {
    env: { ...electronEnvironment(), ED_DEV_SERVER: '', ED_MOD_EDITOR: '', ED_SMOKE_PROFILE: profile, ED_SMOKE_NONCE: randomUUID() },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const endpoints = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`debug endpoints unavailable: ${logs}`)); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    const inspect = data => {
      logs += data.toString();
      const main = /Debugger listening on (ws:\/\/\S+)/.exec(logs)?.[1];
      const browser = /DevTools listening on (ws:\/\/\S+)/.exec(logs)?.[1];
      if (main && browser) { clearTimeout(timer); resolve({ main, browser }); }
    };
    child.stdout.on('data', inspect); child.stderr.on('data', inspect);
  });
  let evaluate;
  let browser;
  try {
    evaluate = await attachMain(endpoints.main);
    // Ordinary Playwright Electron launch forces focus even while minimized.
    // Connect without its default overrides so native visibility stays real.
    browser = await chromium.connectOverCDP(endpoints.browser, { noDefaults: true });
  } catch (error) {
    evaluate?.disconnect();
    child.kill();
    await exited;
    throw error;
  }
  app = { evaluate, context: () => browser.contexts()[0], close: async () => {
    const timeout = setTimeout(() => child.kill(), 10000);
    try {
      await evaluate(({ app }) => app.quit()).catch(() => {});
      evaluate.disconnect();
      await exited;
      await browser.close();
    } finally { clearTimeout(timeout); }
  } };
  page = app.context().pages()[0] ?? await app.context().waitForEvent('page');
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const host = await app.evaluate(({ app }) => ({ profile: app.getPath('userData'), packaged: app.isPackaged, versions: process.versions }));
  assert.equal(resolve(host.profile), resolve(profile), 'refusing to use a player profile');
  assert.equal(host.packaged, true);
  report.electron = host.versions.electron;
  report.chromium = host.versions.chrome;
  await page.addInitScript(observeAudio);
  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
}

async function resume() {
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'A year', exact: true })).toBeVisible();
}

async function seed(save, slot = 'autosave') {
  // Use the production preload/disk bridge, not browser localStorage saves.
  await page.evaluate(async ({ save, slot, key }) => {
    await window.edPlatform.writeSave(slot, save);
    localStorage.setItem(key, JSON.stringify({ showEverythingFromStart: true, sound: true, soundVolume: 1 }));
  }, { save, slot, key });
  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
}

try {
  const assets = (await readdir(join(renderer, 'assets'))).filter(p => p.endsWith('.js')).sort();
  const sources = await Promise.all(assets.map(p => readFile(join(renderer, 'assets', p), 'utf8')));
  assert(sources.some(s => s.includes(build)), 'packaged client does not identify this source build');
  report.executableSha256 = await sha256File(executable);
  report.appAsarSha256 = await sha256File(join(output, 'win-unpacked/resources/app.asar'));
  const releaseProof = JSON.parse(await readFile(join(output, 'windows-release-proof.json'), 'utf8'));
  report.installerSha256 = await sha256File(join(output, releaseProof.installer.file));
  assert.equal(report.installerSha256, releaseProof.installer.sha256);
  assert.equal(report.executableSha256, releaseProof.executable.sha256);
  report.rendererSha256 = hash(sources.join('\n'));
  await launch();
  const sender = founded();
  const old = founded('short', 777).save();
  await seed(old);
  assert.equal((await audio()).made, 0, 'AudioContext constructed without a gesture');
  record('packaged boot, isolated disk profile and gesture gate');

  const shared = sender.shareCode({ build, names: true });
  assert.equal(shared.ok, true);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  const input = page.locator('#share-code-in');
  await input.fill(shared.code.slice(0, -8));
  await expect(page.locator('#share-code-error')).toBeVisible();
  assert.equal(canonical(await disk()), canonical(old));
  const mismatched = sender.shareCode({ build: 'another-build', names: true });
  assert.equal(mismatched.ok, true);
  await input.fill(mismatched.code);
  await expect(page.locator('#share-code-error')).toBeVisible();
  assert.equal(canonical(await disk()), canonical(old));
  record('damaged and incompatible codes preserve the existing disk save');

  await input.fill(shared.code);
  await expect(page.locator('#share-code-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign from this code', exact: true }).click();
  await expect(page.locator('main.prologue')).toBeVisible();
  const expected = newGameFromShareCode(shared.code, content, { build });
  assert.equal(expected.ok, true);
  await expect.poll(async () => canonical(await disk())).toBe(canonical(expected.session.save()));
  record('Unicode founding import matches the complete canonical save', { saveSha256: hash(canonical(await disk())) });

  // A genuinely cold process must restore both the disk run and Reading choice.
  await app.close(); app = null;
  await launch();
  assert.equal((await audio()).made, 0);
  await resume();
  assert.equal(canonical(await disk()), canonical(expected.session.save()));
  await expect.poll(async () => (await audio()).state).toBe('running');
  await expect.poll(async () => (await audio()).peak, { timeout: 10000 }).toBeGreaterThan(0.00001);
  record('cold resume and real Web Audio output', await audio());

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(async () => (await audio()).state).toBe('suspended');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); });
  await expect.poll(async () => (await audio()).state).toBe('running');
  await expect.poll(async () => (await audio()).peak).toBeGreaterThan(0.00001);
  record('native minimize/restore suspends and restores real audio');

  await page.getByRole('button', { name: 'Reading, marks and keys' }).click();
  const sound = page.getByRole('checkbox', { name: 'Sound', exact: true });
  await sound.uncheck();
  await expect.poll(async () => (await audio()).peak).toBe(0);
  await app.close(); app = null;
  await launch();
  await resume();
  await page.getByRole('button', { name: 'Reading, marks and keys' }).click();
  await expect(page.getByRole('checkbox', { name: 'Sound', exact: true })).not.toBeChecked();
  assert.equal((await audio()).made, 0);
  record('mute survives a cold process restart without opening an audio device');

  // Fixture uses public verbs and the authored Demonstration's early frame.
  const demo = founded('demo', 5000);
  for (let step = 0; step < 40 && demo.year < 1044; step++) {
    if (demo.pending.length) demo.letHimDecide();
    else if (demo.view().namesWanted.length) demo.keepSuggestedNames();
    else demo.advance(1);
  }
  assert.equal(demo.year, 1044);
  await seed(demo.save(), 'demo-autosave');
  await page.getByRole('region', { name: 'Demonstrations kept' }).getByRole('button', { name: /Return to the Demonstration/ }).click();
  const frame = page.locator('.interlude[role="dialog"]');
  for (let action = 0; action < 30 && !(await frame.count()); action++) {
    const chapter = page.locator('.chapter[role="dialog"]');
    const outcome = page.locator('.outcome');
    const docket = page.locator('.docket');
    if (await chapter.count()) await chapter.getByRole('button').click();
    else if (await outcome.count()) await outcome.getByRole('button').click();
    else if (await docket.count()) await docket.getByRole('button', { name: /Let .* decide/ }).click();
    else await page.getByRole('button', { name: 'A year', exact: true }).click();
  }
  await expect(frame).toBeVisible();
  await expect.poll(async () => (await audio()).peak).toBe(0);
  await frame.getByRole('button', { name: 'Go on', exact: true }).click();
  await expect.poll(async () => (await audio()).peak).toBeGreaterThan(0.00001);
  record('authored interlude silences the drone and dismissal restores output');

  // Reach the ending through public production commands, then exercise the
  // actual Copy action. Keep clipboard contents inside the main process and
  // restore every native format immediately after checking the copied code.
  for (let action = 0; action < 3000 && !sender.epilogue(); action++) {
    if (sender.pending.length) sender.letHimDecide();
    else if (sender.view().namesWanted.length) sender.keepSuggestedNames();
    else sender.advance(25);
  }
  assert(sender.epilogue(), 'bounded Short Line did not reach its ending');
  await seed(sender.save());
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await expect(page.locator('main.ending')).toBeVisible();
  const code = await page.locator('#share-code').inputValue();
  assert.equal(code, sender.shareCode({ build }).code);
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.__edClipboard = await Promise.all((await clipboard.read()).map(async item =>
      new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))),
    ));
  });
  try {
    await page.getByRole('button', { name: 'Copy the code', exact: true }).click();
    await expect.poll(() => app.evaluate(async ({ clipboard }, expected) =>
      (await clipboard.readText()) === expected, code), { message: 'Windows clipboard did not receive the founding code' }).toBe(true);
    record('ending Copy action writes the complete anonymous founding code to the Windows clipboard');
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      if (globalThis.__edClipboard.length) await clipboard.write(globalThis.__edClipboard);
      else clipboard.clear();
      delete globalThis.__edClipboard;
    });
  }

  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack ?? String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'windows-player-failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  // This mkdtemp child is the only recursive removal target.
  assert.equal(dirname(scratch), cache);
  assert(basename(scratch).startsWith('windows-player-'));
  await rm(scratch, { recursive: true, force: true });
  await writeFile(join(output, 'windows-player-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
}
