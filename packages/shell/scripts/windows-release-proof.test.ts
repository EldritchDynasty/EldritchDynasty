import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  findWindowsInstaller,
  verifyAuthenticode,
  writeWindowsReleaseProof,
} from './windows-release-proof.mjs';
import { checkedWindowsReleaseProof, smokeInstalledWindowsArtifact } from './installed-smoke.mjs';

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
        expect(args).toEqual(['--smoke']);
        expect(await readFile(program, 'utf8')).toBe('app');
      }
    });
    const result = await smokeInstalledWindowsArtifact(dir, {
      platform: 'win32', tempRoot: dir, run,
      parentEnv: { ELECTRON_RUN_AS_NODE: '1', ED_KEEP: 'safe' },
    });

    expect(result.installer).toBe(installer);
    expect(result.sha256).toBe(hash('app'));
    expect(run).toHaveBeenCalledTimes(2);
    expect(invocations[0]?.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(invocations[1]?.env).toEqual({ ED_KEEP: 'safe' });
    expect(basename(invocations[1]!.program)).toBe('Eldritch Dynasty.exe');
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
