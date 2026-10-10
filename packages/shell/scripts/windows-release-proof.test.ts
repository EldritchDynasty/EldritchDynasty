import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { inspectSeedDisclosure } from '../src/seed-disclosure.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  findWindowsInstaller,
  verifyAuthenticode,
  writeWindowsReleaseProof,
} from './windows-release-proof.mjs';
import { checkedNativeSmokeEvidence, checkedWindowsReleaseProof, smokeInstalledWindowsArtifact } from './installed-smoke.mjs';

const temporaryDirectories: string[] = [];

async function fixture() {
  const release = await mkdtemp(join(tmpdir(), 'ed-windows-proof-'));
  temporaryDirectories.push(release);
  const unpacked = join(release, 'win-unpacked');
  await mkdir(unpacked);
  const installer = join(release, 'Eldritch Dynasty Setup 0.1.0.exe');
  const executable = join(unpacked, 'Eldritch Dynasty.exe');
  await writeFile(installer, 'installer');
  await writeFile(executable, 'app');
  return { release, installer, executable };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Windows release proof', () => {
  it('records the exact installer and packaged executable by SHA-256', async () => {
    const { release } = await fixture();

    const { path, proof } = await writeWindowsReleaseProof(release);

    expect(proof).toEqual({
      version: 1,
      installer: {
        file: 'Eldritch Dynasty Setup 0.1.0.exe',
        sha256: '9c0d294c05fc1d88d698034609bb81c0c69196327594e4c69d2915c80fd9850c',
        authenticode: 'not-checked',
      },
      executable: {
        file: 'win-unpacked/Eldritch Dynasty.exe',
        sha256: 'a172cedcae47474b615c54d510a5d84a8dea3032e958587430b413538be3f333',
        authenticode: 'not-checked',
      },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(proof);
  });

  it('requires both installer and packaged executable signatures when asked', async () => {
    const { release, installer, executable } = await fixture();
    const verified: string[] = [];

    const { proof } = await writeWindowsReleaseProof(release, {
      requireSignature: true,
      verifySignature: async (filePath) => {
        verified.push(filePath);
      },
    });

    expect(verified.sort()).toEqual([installer, executable].sort());
    expect(proof.installer.authenticode).toBe('valid');
    expect(proof.executable.authenticode).toBe('valid');
  });

  it('fails rather than guessing when more than one installer is present', async () => {
    const { release } = await fixture();
    await writeFile(join(release, 'old-build.exe'), 'old');

    await expect(findWindowsInstaller(release)).rejects.toThrow(
      /expected exactly one Windows installer/,
    );
  });

  it('passes the exact path to Windows Authenticode verification without shell interpolation', async () => {
    const run = vi.fn(async (
      _script: string,
      _options: { env: Record<string, string> },
    ) => undefined);
    const filePath = "C:\\build\\O'Brien\\Eldritch Dynasty.exe";

    await verifyAuthenticode(filePath, { platform: 'win32', run });

    expect(run).toHaveBeenCalledOnce();
    const [script, options] = run.mock.calls[0]!;
    expect(script).toContain('Get-AuthenticodeSignature');
    expect(script).toContain('$env:ED_RELEASE_PROOF_PATH');
    expect(options.env.ED_RELEASE_PROOF_PATH).toBe(filePath);
  });

  it('refuses to claim an Authenticode result off Windows', async () => {
    const run = vi.fn(async () => undefined);

    await expect(
      verifyAuthenticode('/tmp/fake.exe', { platform: 'linux', run }),
    ).rejects.toThrow('Authenticode verification requires Windows');
    expect(run).not.toHaveBeenCalled();
  });
});

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function installedFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ed-installed-artifact-'));
  temporaryDirectories.push(dir);
  const installerName = 'Eldritch Dynasty Setup 0.1.0.exe';
  const installer = join(dir, installerName);
  const proof = {
    version: 1,
    installer: { file: installerName, sha256: hash('installer'), authenticode: 'not-checked' },
    executable: { file: 'win-unpacked/Eldritch Dynasty.exe', sha256: hash('app'), authenticode: 'not-checked' },
  };
  await writeFile(installer, 'installer');
  await writeFile(join(dir, 'windows-release-proof.json'), JSON.stringify(proof));
  return { dir, installer, proof };
}

describe('downloaded and installed Windows release smoke (#712)', () => {
  it('verifies both hashes and boots the installed game, without Electron-as-Node', async () => {
    const { dir, installer } = await installedFixture();
    const invocations: { program: string; args: string[]; env: Record<string, string> }[] = [];
    const run = vi.fn(async (program: string, args: string[], env: Record<string, string>) => {
      invocations.push({ program, args, env });
      if (program === installer) {
        expect(args[0]).toBe('/S');
        expect(args[1]).toMatch(/^\/D=/);
        await writeFile(join(args[1]!.slice(3), 'Eldritch Dynasty.exe'), 'app');
      } else {
        expect(await readFile(program, 'utf8')).toBe('app');
        if (args[0] === '--smoke') return;
        expect(['--smoke-save', '--smoke-resume']).toContain(args[0]);
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.ED_SMOKE_PROFILE).toBeTruthy();
        expect(env.ED_SMOKE_NONCE).toBeTruthy();
        await mkdir(env.ED_SMOKE_PROFILE!, { recursive: true });
        await writeFile(join(env.ED_SMOKE_PROFILE!, 'smoke-evidence.json'), JSON.stringify({
          ok: true, command: args[0] === '--smoke-save' ? 'save' : 'resume',
          nonce: env.ED_SMOKE_NONCE, year: 1054, sha256: hash('real-game-save'),
        }));
      }
    });
    const result = await smokeInstalledWindowsArtifact(dir, {
      platform: 'win32', tempRoot: dir, run,
      parentEnv: { ELECTRON_RUN_AS_NODE: '1', ED_KEEP: 'safe' },
    });

    expect(result.installer).toBe(installer);
    expect(result.sha256).toBe(hash('app'));
    expect(result.saveSha256).toBe(hash('real-game-save'));
    expect(result.year).toBe(1054);
    expect(run).toHaveBeenCalledTimes(4);
    expect(invocations[0]?.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(invocations.slice(1).map((call) => call.args)).toEqual([
      ['--smoke'], ['--smoke-save'], ['--smoke-resume'],
    ]);
    expect(invocations[1]?.env).toEqual({ ED_KEEP: 'safe' });
    expect(invocations[2]?.env.ED_SMOKE_PROFILE).toBe(invocations[3]?.env.ED_SMOKE_PROFILE);
    expect(invocations[2]?.env.ED_SMOKE_NONCE).toBe(invocations[3]?.env.ED_SMOKE_NONCE);
    expect(basename(invocations[1]!.program)).toBe('Eldritch Dynasty.exe');
  });

  it('refuses absent, malformed and stale native smoke receipts', () => {
    const good = { command: 'save', ok: true, nonce: 'unique-run', year: 1054, sha256: hash('save') };
    expect(checkedNativeSmokeEvidence(good, 'save', 'unique-run')).toEqual(good);
    for (const invalid of [
      null,
      { ...good, ok: false },
      { ...good, command: 'resume' },
      { ...good, nonce: 'another-run' },
      { ...good, year: undefined },
      { ...good, year: NaN },
      { ...good, sha256: undefined },
      { ...good, sha256: '0'.repeat(63) },
      { ...good, sha256: 'Z'.repeat(64) },
      { ...good, sha256: 'A'.repeat(64) },
    ]) {
      expect(() => checkedNativeSmokeEvidence(invalid, 'save', 'unique-run'))
        .toThrow(/invalid save native smoke evidence/);
    }
  });

  it.each(['hash', 'year'] as const)(
    'refuses a real-save %s mismatch across installed process relaunches',
    async (mismatch) => {
      const { dir, installer } = await installedFixture();
      const run = vi.fn(async (program: string, args: string[], env: Record<string, string>) => {
        if (program === installer) {
          await writeFile(join(args[1]!.slice(3), 'Eldritch Dynasty.exe'), 'app');
          return;
        }
        if (args[0] === '--smoke') return;
        await mkdir(env.ED_SMOKE_PROFILE!, { recursive: true });
        await writeFile(join(env.ED_SMOKE_PROFILE!, 'smoke-evidence.json'), JSON.stringify({
          command: args[0] === '--smoke-save' ? 'save' : 'resume', ok: true,
          nonce: env.ED_SMOKE_NONCE,
          sha256: mismatch === 'hash' && args[0] === '--smoke-resume' ? hash('wrong') : hash('save'),
          year: mismatch === 'year' && args[0] === '--smoke-resume' ? 1055 : 1054,
        }));
      });
      await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', tempRoot: dir, run }))
        .rejects.toThrow(/different save SHA-256 or year/);
      expect(run).toHaveBeenCalledTimes(4);
    },
  );

  it('rejects an installed executable that exits zero without writing native save evidence', async () => {
    const { dir, installer } = await installedFixture();
    const run = vi.fn(async (program: string, args: string[]) => {
      if (program === installer) {
        await writeFile(join(args[1]!.slice(3), 'Eldritch Dynasty.exe'), 'app');
      }
    });
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', tempRoot: dir, run }))
      .rejects.toThrow(/ENOENT/);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('pins both halves of the test-only client command IPC transport', async () => {
    const [preload, main] = await Promise.all([
      readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
      readFile(new URL('../src/main.mjs', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain("ipcRenderer.send('ed:smoke-ready')");
    expect(preload).toContain("ipcRenderer.on('ed:smoke-command'");
    expect(preload).toContain("ipcRenderer.send('ed:smoke-result'");
    expect(main).toContain("ipcMain.on('ed:smoke-ready'");
    expect(main).toContain("ipcMain.on('ed:smoke-result'");
    expect(main).toContain("kind: 'save', seed: 882, years: 12");
    expect(main).toContain("kind: 'resume'");
    expect(main).toContain("createHash('sha256')");
    expect(main).toContain("writeFileSync(join(app.getPath('userData'), 'smoke-evidence.json'");
  });

  it('refuses to execute an installer whose bytes differ from the retained artifact proof', async () => {
    const { dir, installer } = await installedFixture();
    await writeFile(installer, 'tampered installer');
    const run = vi.fn();
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', run }))
      .rejects.toThrow(/installer SHA-256 mismatch/);
    expect(run).not.toHaveBeenCalled();
  });

  it('never boots an installed app with different bytes', async () => {
    const { dir } = await installedFixture();
    const runs: string[] = [];
    await expect(smokeInstalledWindowsArtifact(dir, {
      platform: 'win32', tempRoot: dir,
      run: async (program: string, args: string[]) => {
        runs.push(program);
        if (args[0] === '/S') await writeFile(join(args[1]!.slice(3), 'Eldritch Dynasty.exe'), 'not the packaged app');
      },
    })).rejects.toThrow(/game SHA-256 mismatch/);
    expect(runs).toHaveLength(1);
  });

  it('refuses a different named installer or ambiguous stale executable', async () => {
    const { dir, proof } = await installedFixture();
    const run = vi.fn();
    await writeFile(join(dir, 'another.exe'), 'other bytes');
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', run }))
      .rejects.toThrow(/exactly one Windows installer/);
    expect(run).not.toHaveBeenCalled();
    await rm(join(dir, 'another.exe'));
    await writeFile(join(dir, 'windows-release-proof.json'), JSON.stringify({
      ...proof, installer: { ...proof.installer, file: 'wrong.exe' },
    }));
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', run }))
      .rejects.toThrow(/name does not match release proof/);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    '../outside.exe',
    'dir\\\\evil.exe',
    '/absolute.exe',
    'wrong.bin',
  ])('rejects an untrusted installer filename before executing: %s', async (file) => {
    const { dir, proof } = await installedFixture();
    await writeFile(join(dir, 'windows-release-proof.json'), JSON.stringify({
      ...proof, installer: { ...proof.installer, file },
    }));
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', run: vi.fn() }))
      .rejects.toThrow(/invalid Windows release proof/);
  });

  it('rejects an executable manifest path outside the game package', () => {
    const proof = {
      version: 1,
      installer: { file: 'setup.exe', sha256: hash('installer') },
      executable: { file: 'win-unpacked/../../attacker.exe', sha256: hash('app') },
    };
    expect(() => checkedWindowsReleaseProof(proof)).toThrow(/invalid Windows release proof/);
  });

  it('rejects non-Windows callers before trying to read the downloaded artifact', async () => {
    await expect(smokeInstalledWindowsArtifact('/does/not/exist', { platform: 'linux' }))
      .rejects.toThrow(/requires a Windows runner/);
  });
});

// Reuse this measured shell test suite to avoid invalidating the shard-duration
// inventory. This is still the exact renderer inspector serialized by --smoke.
const document = new JSDOM('', { url: 'http://localhost' }).window.document;
const seedControls = '<label for="seed">seed</label><input id="seed" type="number">';

function mountStart({ exposed = false, toggleWorks = true, hidesAfterClosing = true } = {}) {
  document.body.innerHTML = `
    <main class="start">
      <h1>Eldritch Dynasty</h1>
      <div class="advanced">
        <button aria-expanded="false">Advanced</button>
        <div class="controls"></div>
      </div>
    </main>`;
  const button = document.querySelector('.advanced > button')!;
  const controls = document.querySelector('.controls')!;
  if (exposed) controls.innerHTML = '<div hidden>' + seedControls + '</div>';

  if (toggleWorks) {
    button.addEventListener('click', () => {
      const opening = button.getAttribute('aria-expanded') === 'false';
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
      button.textContent = opening ? 'Hide advanced' : 'Advanced';
      if (opening) controls.innerHTML = seedControls;
      else if (hidesAfterClosing) controls.innerHTML = '';
    });
  }
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('installed game Start smoke (#718)', () => {
  it('verifies the seed is absent until Advanced opens and disappears again on close', async () => {
    mountStart();
    expect(await inspectSeedDisclosure(document)).toBe('ok');
    expect(document.querySelector('input#seed')).toBeNull();
  });

  it('rejects a seed field hidden only with CSS before the user opens Advanced', async () => {
    mountStart({ exposed: true });
    expect(await inspectSeedDisclosure(document)).toBe('seed is exposed before Advanced is opened');
  });

  it('rejects an Advanced disclosure that cannot show the seed input', async () => {
    mountStart({ toggleWorks: false });
    expect(await inspectSeedDisclosure(document)).toBe(
      'opening Advanced did not reveal the numeric seed control',
    );
  });

  it('rejects an Advanced disclosure that leaves seed visible when closed', async () => {
    mountStart({ hidesAfterClosing: false });
    expect(await inspectSeedDisclosure(document)).toBe(
      'closing Advanced did not hide the seed control',
    );
  });

  it('rejects a missing Start screen instead of silently checking another view', async () => {
    document.body.innerHTML = '<main class="prologue">Not the Start screen</main>';
    expect(await inspectSeedDisclosure(document)).toBe('the game Start screen is missing');
  });

  it('rejects Advanced missing from the game Start screen', async () => {
    document.body.innerHTML = '<main class="start"><h1>Eldritch Dynasty</h1></main>';
    expect(await inspectSeedDisclosure(document)).toBe(
      'the Start screen has no closed Advanced disclosure',
    );
  });
});
