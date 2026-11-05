# Packaged Windows player checks

Issue #2996 supplies the Windows host evidence for #1986 (sound) and #1995
(founding share codes). Run from the repository root on Windows with the
Node major in `.nvmrc` and dependencies prepared by `npm run setup`:

```powershell
npm.cmd run build:shell
node packages/shell/scripts/windows-player-smoke.mjs
```

The build produces an unsigned local NSIS installer and checks its unpacked
application. The player smoke drives that same executable and its real packaged
renderer/preload. It verifies the build identifier and installer/executable
hashes before proceeding. The matching source checkout supplies the public
core APIs used to prepare fixtures and compare complete canonical saves.

The smoke uses `--smoke-player`, `ED_SMOKE_PROFILE` and `ED_SMOKE_NONCE` to select
an isolated temporary profile under `node_modules/.cache`. Both environment
values are required by the packaged host. This switch does not enable the
synthetic save/resume command bridge. Ordinary sessions keep their usual profile.
The temporary directory is removed after all test processes exit.

Checks cover the first-gesture audio gate, a real nonzero Web Audio signal,
native minimize/restore, mute across a cold process restart, the authored
Demonstration interlude's silence and return, damaged/incompatible share-code
refusals without disk-save loss, Unicode founding equality, cold disk resume,
and the ending's real Windows clipboard Copy action. Clipboard payloads stay
inside the main process and their original formats are restored immediately.

The connection uses Playwright's `connectOverCDP` with `noDefaults: true`.
Ordinary Electron automation forces renderer focus, masking native minimized
visibility. No autoplay override or fake audio device is used. A transparent
analyser measures the game's existing master signal; this proves rendered
output, not human listening, speaker quality or player enjoyment.

The machine-readable receipt is
`packages/shell/release/windows-player-smoke.json`. It records the client build,
host versions, installer/executable/ASAR/renderer hashes and individual results;
a failed run records its error and a screenshot in the same ignored directory.
This is an explicit local check, not a new merge-blocking gate or a signed
release proof. Android/iOS device checks and human listening remain separate
acceptance work on the parent issues.
