import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findWindowsInstaller,
  verifyAuthenticode,
  writeWindowsReleaseProof,
} from './windows-release-proof.mjs';

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
