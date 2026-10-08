// Tag-only Android release preparation and durable artifact proof (#601).
// All policy and manifest validation is portable so the fast lane can test it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredSecrets = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

export function signingPolicy(tag, env) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error('Android release requires a SemVer v* tag');
  }
  const present = requiredSecrets.filter((key) => Boolean(env[key]));
  if (present.length !== 0 && present.length !== requiredSecrets.length) {
    throw new Error('Partial Android signing secrets: provide all four or none');
  }
  const production = !tag.split('+', 1)[0].includes('-');
  if (production && present.length === 0) {
    throw new Error('Production Android release requires all four ANDROID_KEYSTORE_* signing secrets');
  }
  return { production, signed: present.length === requiredSecrets.length };
}

// Java .properties treats backslash and newlines as syntax, not password text.
function propertyValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n').replace(/:/g, '\\:')
    .replace(/=/g, '\\=').replace(/#/g, '\\#').replace(/!/g, '\\!');
}

export function prepareSigning({ tag, env, androidRoot }) {
  const policy = signingPolicy(tag, env);
  if (policy.signed) {
    const encoded = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || !encoded) {
      throw new Error('ANDROID_KEYSTORE_BASE64 is invalid base64');
    }
    const key = Buffer.from(encoded, 'base64');
    if (!key.length) throw new Error('ANDROID_KEYSTORE_BASE64 decoded to an empty file');
    mkdirSync(androidRoot, { recursive: true });
    writeFileSync(path.join(androidRoot, 'release.keystore'), key, { mode: 0o600 });
    const entries = [
      ['storeFile', 'release.keystore'],
      ['storePassword', env.ANDROID_KEYSTORE_PASSWORD],
      ['keyAlias', env.ANDROID_KEY_ALIAS],
      ['keyPassword', env.ANDROID_KEY_PASSWORD],
    ];
    writeFileSync(path.join(androidRoot, 'keystore.properties'),
      entries.map(([keyName, value]) => keyName + '=' + propertyValue(value)).join('\n') + '\n',
      { mode: 0o600 });
  }
  return policy;
}

export function buildProof({ bytes, metadata, tag, sourceSha, runUrl, signing }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Missing or empty Android AAB');
  if (!metadata || !Number.isInteger(metadata.versionCode)
    || metadata.versionCode < 1 || metadata.versionCode > 2100000000) {
    throw new Error('Missing or invalid Gradle versionCode in release metadata');
  }
  if (metadata.versionName !== tag || metadata.bundle !== 'app-release.aab') {
    throw new Error('Gradle AAB versionName or output name differs from the release tag');
  }
  if (!/^[a-f0-9]{40}$/i.test(sourceSha || '') || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(runUrl || '')) {
    throw new Error('Android release proof requires a source SHA and workflow run URL');
  }
  if (!['verified', 'unsigned-prerelease'].includes(signing)) {
    throw new Error('Android signing must be verified or explicitly unsigned-prerelease');
  }
  if (!signingPolicy(tag, {}).production && signing === 'unsigned-prerelease') {
    // The only release permitted to ship unsigned is an explicitly marked pre-release.
  } else if (signing !== 'verified') {
    throw new Error('Production Android AAB cannot be unsigned');
  }
  return {
    artifact: 'app-release.aab',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    versionCode: metadata.versionCode,
    versionName: metadata.versionName,
    sourceSha,
    runUrl,
    signing,
  };
}

// Only invoked by check.yml's tag job. Never by ordinary PR preflight.
function main() {
  const command = process.argv[2];
  const root = path.resolve('packages/mobile/android');
  const out = path.join(root, 'app/build/outputs/bundle/release');
  const tag = process.env.GITHUB_REF_NAME ?? '';
  if (command === 'prepare') {
    const policy = prepareSigning({ tag, env: process.env, androidRoot: root });
    if (!process.env.GITHUB_OUTPUT) throw new Error('prepare requires GITHUB_OUTPUT');
    appendFileSync(process.env.GITHUB_OUTPUT, 'signed=' + policy.signed + '\n');
    console.log(policy.signed ? 'Android release: signing key installed' : 'Android pre-release: unsigned artifact permitted');
  } else if (command === 'proof') {
    const proof = buildProof({
      bytes: readFileSync(path.join(out, 'app-release.aab')),
      metadata: JSON.parse(readFileSync(path.join(out, 'release-metadata.json'), 'utf8')),
      tag, sourceSha: process.env.GITHUB_SHA,
      runUrl: process.env.ANDROID_RUN_URL,
      signing: process.env.ANDROID_SIGNING_RESULT,
    });
    writeFileSync(path.join(out, 'android-release-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('Android AAB SHA-256: ' + proof.sha256);
    console.log('versionCode=' + proof.versionCode + ' versionName=' + proof.versionName + ' signing=' + proof.signing);
  } else {
    throw new Error('Usage: node tools/android-release-proof.mjs prepare|proof');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
