import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { build, Platform } from 'electron-builder';
import { smokePackagedApp } from './packaged-smoke.mjs';
import { builderOverrides, packageTarget } from './package-target.mjs';
import { writeWindowsReleaseProof } from './windows-release-proof.mjs';

/**
 * PACKAGE @ed/shell INTO A WINDOWS INSTALLER (issues #67, #75 and #321).
 *
 * There is one builder configuration and two renderer targets. The ordinary
 * invocation packages the game. `--mod-editor` packages the already-built
 * authoring tool with its own app identity and main entrypoint, while keeping
 * the same NSIS/signing/resource rules.
 *
 * Both targets stage their renderer into `.renderer` first. That is the seam
 * that lets electron-builder.yml stay singular: packaging never has to know
 * whether `client/dist` or `editor/dist` was selected, and the installed
 * shell always reads `resources/renderer/index.html`.
 *
 * This script does not build either renderer. Root `build:shell` and
 * `build:mod-editor` deliberately order that first, and a missing build fails
 * here with the exact workspace to build.
 *
 * After packaging on Windows, this script boots the freshly-created
 * `win-unpacked` application with `--smoke`. For the game that proves the
 * packaged client/save bridge; for the Mod Editor it additionally proves the
 * second entrypoint selected `mode: mod-editor` than silently opening
 * the game under a different product name.
 *
 * Every game package also writes `windows-release-proof.json` beside the NSIS
 * installer. It identifies both the installer and the packaged executable by
 * SHA-256, so a clean-machine check can name the exact bytes CI produced.
 * `--require-signature` additionally asks Windows to validate Authenticode on
 * both files and aborts rather than publishing a proof for an invalid release.
 * Pre-release and local packages deliberately leave that check opt-in.
 *
 * DELIBERATELY NEVER INVOKED AS `npm run <script>` FROM check.yml.
 * `tools/land.mjs` derives ordinary landing work from workflow npm scripts;
 * packaging a Windows installer must remain tag/local work, not something
 * every prose landing pays for.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const SHELL = resolve(HERE, '..');
const args = process.argv.slice(2);
const target = packageTarget(args);
const requireSignature = args.includes('--require-signature');
const RELEASE = resolve(SHELL, target.output);
const STAGED_RENDERER = resolve(SHELL, '.renderer');
const RENDERER_SOURCE = resolve(SHELL, '..', target.renderer, 'dist');

/**
 * electron-builder demands a FIXED electron version and refuses `^38.0.0`
 * outright. Resolve the installed package instead of keeping a second version
 * number beside package.json.
 */
const electronVersion = createRequire(import.meta.url)('electron/package.json').version;

try {
  const entry = join(RENDERER_SOURCE, 'index.html');
  if (!existsSync(entry)) {
    throw new Error(
      `no built ${target.renderer} renderer at ${entry}; run ` +
      `npm run build --workspace @ed/${target.renderer} first`,
    );
  }

  // Proof is intentionally one-build-one-artifact. A stale installer from a
  // previous package must never make this run ambiguous or be uploaded beside
  // the bytes the smoke test actually exercised.
  await rm(RELEASE, { recursive: true, force: true });
  await rm(STAGED_RENDERER, { recursive: true, force: true });
  await cp(RENDERER_SOURCE, STAGED_RENDERER, { recursive: true });

  await build({
    projectDir: SHELL,
    targets: Platform.WINDOWS.createTarget(),
    config: builderOverrides(target, electronVersion),
  });

  const smoke = await smokePackagedApp(RELEASE);
  if (smoke.skipped) {
    console.log(`packaged ${target.mode} smoke skipped — the Windows executable cannot run on this platform`);
  } else {
    console.log(`packaged ${target.mode} smoke ok — ${smoke.executable}`);
  }

  if (target.mode === 'game') {
    const releaseProof = await writeWindowsReleaseProof(RELEASE, { requireSignature });
    console.log(
      `Windows installer proof — ${releaseProof.proof.installer.file} ` +
      `sha256 ${releaseProof.proof.installer.sha256}`,
    );
    console.log(
      `Windows executable proof — ${releaseProof.proof.executable.file} ` +
      `sha256 ${releaseProof.proof.executable.sha256}`,
    );
    console.log(`Windows release proof written — ${releaseProof.path}`);
  }
} catch (e) {
  console.error(e?.stack ?? String(e));
  process.exitCode = 1;
} finally {
  await rm(STAGED_RENDERER, { recursive: true, force: true });
}
