import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '../../../..');
const proof = (await import(pathToFileURL(join(REPO, 'tools/android-release-proof.mjs')).href)) as {
  signingPolicy: (tag: string, env: Record<string, string>) => { production: boolean; signed: boolean };
  prepareSigning: (p: { tag: string; env: Record<string, string>; androidRoot: string }) =>
    { production: boolean; signed: boolean };
  buildProof: (p: { bytes: Buffer; metadata: unknown; tag: string; sourceSha: string;
    runUrl: string; signing: string }) => Record<string, unknown>;
};

const TAG = 'v0.3.0-beta.1';
const PROD = 'v1.0.0';
const SECRETS = {
  ANDROID_KEYSTORE_BASE64: Buffer.from('fixture keystore').toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: 'testing=pass:\\word',
  ANDROID_KEY_ALIAS: 'upload',
  ANDROID_KEY_PASSWORD: 'testkey',
};

describe('Android tag signing policy (#601)', () => {
  it('refuses unsigned production, partial credentials and non-SemVer tags', () => {
    expect(() => proof.signingPolicy(PROD, {})).toThrow(/requires all four/);
    expect(() => proof.signingPolicy(TAG, { ANDROID_KEY_ALIAS: 'upload' })).toThrow(/Partial/);
    expect(() => proof.signingPolicy('not-a-release', {})).toThrow(/SemVer/);
  });

  it('permits an unsigned pre-release but signs one with all four secrets', () => {
    expect(proof.signingPolicy(TAG, {})).toEqual({ production: false, signed: false });
    expect(proof.signingPolicy(TAG, SECRETS)).toEqual({ production: false, signed: true });
    expect(proof.signingPolicy(PROD, SECRETS)).toEqual({ production: true, signed: true });
  });

  it('writes key material only for signed releases, and correctly escapes properties', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-android-proof-'));
    try {
      proof.prepareSigning({ tag: TAG, env: {}, androidRoot: dir });
      expect(existsSync(join(dir, 'release.keystore'))).toBe(false);
      proof.prepareSigning({ tag: PROD, env: SECRETS, androidRoot: dir });
      expect(readFileSync(join(dir, 'release.keystore'), 'utf8')).toBe('fixture keystore');
      const properties = readFileSync(join(dir, 'keystore.properties'), 'utf8');
      expect(properties).toContain('storePassword=testing\\=pass\\:\\\\word');
      expect(properties).toContain('keyAlias=upload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid base64 rather than writing a broken signing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-android-proof-'));
    try {
      expect(() => proof.prepareSigning({
        tag: PROD, env: { ...SECRETS, ANDROID_KEYSTORE_BASE64: 'not-base64?' }, androidRoot: dir,
      })).toThrow(/base64/);
      expect(existsSync(join(dir, 'release.keystore'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Android release artifact proof (#601)', () => {
  const values = {
    bytes: Buffer.from('an AAB test fixture'),
    metadata: { bundle: 'app-release.aab', versionCode: 5001, versionName: TAG },
    tag: TAG, sourceSha: 'a'.repeat(40),
    runUrl: 'https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/123',
    signing: 'unsigned-prerelease',
  };

  it('binds SHA-256, Gradle version data, source commit, and workflow run', () => {
    const result = proof.buildProof(values);
    expect(result).toEqual({
      artifact: 'app-release.aab',
      sha256: '2b740746d7010e20ee12f58e43d9540488e5f466434bb192ae94e250d7e59614',
      versionCode: 5001,
      versionName: TAG,
      sourceSha: 'a'.repeat(40),
      runUrl: values.runUrl,
      signing: 'unsigned-prerelease',
    });
  });

  it('never describes an empty AAB, wrong tag or unsigned production as releasable', () => {
    expect(() => proof.buildProof({ ...values, bytes: Buffer.alloc(0) })).toThrow(/empty/);
    expect(() => proof.buildProof({ ...values, metadata: { ...values.metadata, versionName: 'v2.0.0' } })).toThrow(/differs/);
    expect(() => proof.buildProof({ ...values, tag: PROD, metadata: { ...values.metadata, versionName: PROD } }))
      .toThrow(/cannot be unsigned/);
    expect(proof.buildProof({
      ...values, tag: PROD, metadata: { ...values.metadata, versionName: PROD }, signing: 'verified',
    }).signing).toBe('verified');
  });

  it('keeps the existing rerun-safe versionCode contract and GitHub wiring', () => {
    const gradle = readFileSync(join(REPO, 'packages/mobile/android/app/build.gradle'), 'utf8');
    const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(gradle).toContain('runNumber * versionCodeAttemptStride + runAttempt');
    expect(gradle).toContain('writeReleaseProofMetadata');
    expect(workflow).toContain('node tools/android-release-proof.mjs prepare');
    expect(workflow).toContain('node tools/android-release-proof.mjs proof');
    expect(workflow).toContain('android-release-proof.json');
    expect(workflow).toContain('release-slow, release-gates');
  });
});
