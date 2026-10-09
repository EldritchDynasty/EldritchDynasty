import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { checkedWindowsReleaseProof, smokeInstalledWindowsArtifact } from './installed-smoke.mjs';

const dirs: string[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ed-installed-artifact-'));
  dirs.push(dir);
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

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('downloaded and installed Windows release smoke (#712)', () => {
  it('verifies both hashes and boots the installed game, without Electron-as-Node', async () => {
    const { dir, installer } = await fixture();
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
    const { dir, installer } = await fixture();
    await writeFile(installer, 'tampered installer');
    const run = vi.fn();
    await expect(smokeInstalledWindowsArtifact(dir, { platform: 'win32', run }))
      .rejects.toThrow(/installer SHA-256 mismatch/);
    expect(run).not.toHaveBeenCalled();
  });

  it('never boots an installed app with different bytes', async () => {
    const { dir } = await fixture();
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
    const { dir, proof } = await fixture();
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
    const { dir, proof } = await fixture();
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
