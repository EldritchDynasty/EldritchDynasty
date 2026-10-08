# shell — the desktop wrapper

Electron wraps the already-built `@ed/client` application and, in Mod Editor
mode, hosts `@ed/editor` against the same disk boundary. Both modes have a
Windows package; the game remains the default target. This package owns the
window, the menu bar and the disk. It owns no
game rules, no simulation state, and no duplicate client/editor UI —
`main.mjs`'s own header says the same thing about the runtime half of this
package, and packaging is held to it too.

## The seam

`src/renderer-entry.mjs` resolves where `index.html` lives for either web
application: its own `dist` inside the repository in dev, or the one staged
`process.resourcesPath/renderer` once packaged. `scripts/dist-windows.mjs`
stages `client/dist` by default and `editor/dist` for `--mod-editor`, so there
is one electron-builder configuration rather than two copies that can drift.
The game client remains the default.
It is split out of `main.mjs` — which imports `electron` at module scope and
so cannot be loaded outside an Electron process at all — so it stays a plain
function over plain values, testable with nothing but node
(`renderer-entry.test.ts`).

Saves are opaque JSON, written under Electron's `userData` by `src/saves.mjs`.
`SavedGameS` in core is still the only authority on whether a blob is a run;
this package checks exactly one thing about one — that `format` is a number.

## Commands

```bash
npm run shell            # the game, live against the client's dev server
npm run mod-editor --workspace @ed/shell  # editor; writes only <userData>/mods/content
npm run shell:preview    # build the client, then run the shell against dist
npm run smoke --workspace @ed/shell   # boot, assert the renderer mounted, round-trip a save
npm run build:shell      # Windows game: build client, package NSIS, smoke win-unpacked.
npm run build:mod-editor # Windows Mod Editor (#75): build editor, package the second NSIS
                          # target through the SAME builder config, smoke its mode.
                          # Both are unsigned unless CSC_LINK/CSC_KEY_PASSWORD are set.
                          # Pre-release tags deliberately package unsigned and retain
                          # the hash proof. Plain production tags require valid
                          # Authenticode and refuse to upload unsigned bytes.
```

The three development launch commands go through `scripts/electron.mjs`. Some
Node-hosted tools export `ELECTRON_RUN_AS_NODE=1` for their own process; passing
that flag through makes Electron behave as Node and fail before it can create a
window. The launcher removes that one inherited host flag before starting the
real Electron binary.

Electron is currently declared at **^44.5.1**, a supported major at the
time of the #522 upgrade. On Electron 42+, `npm ci` does not download the
runtime binary in `postinstall`. The launcher keeps `require('electron')`:
Electron 44's own entrypoint installs its binary lazily if it is missing,
then returns the executable path. `scripts/electron.mjs` launches that binary
with the inherited `ELECTRON_RUN_AS_NODE` flag removed. The Open-a-run dialog
explicitly starts in Documents, avoiding Electron 43+'s Downloads default.
See the dependency history in [docs/DEPENDENCIES.md](../../docs/DEPENDENCIES.md).

**The code upgrade is not the complete release proof.** #514 remains open for
a fresh-`npm ci` shell smoke, tagged Windows installer/packaged smoke, and
a current Electron advisory check. Do not mistake an ordinary green PR CI run
for the tag-only packaging evidence.

## Boundaries

- `electron-builder.yml` is the single packaging configuration for both Windows
  targets, and packaging owns no rules either: it moves bytes into an installer
  and nothing more. `.renderer/` is temporary staging and must never become a
  second checked-in build output. macOS and Linux are out of
  scope (#103), not deferred — do not add a `mac:` or `linux:` block without
  reopening that decision.
- `extraResources` in that file copies the staged renderer and one small guard
  module (`content-path.mjs`, shared with the editor's dev-server bridge) into
  the packaged `resources` directory. Nothing else from outside this package
  ships — a packaged build carries no repository content paths at runtime.
- `dist-windows.mjs` calls electron-builder's own Node API rather than
  spawning its CLI, and is never invoked as an `npm run` script from
  `check.yml` — see its own header and `tools/land.mjs`'s `ciScripts` for why:
  packaging a Windows installer has no part in an ordinary landing. On Windows,
  it then runs the freshly-built `win-unpacked` application with `--smoke`;
  the tagged release job therefore verifies the installed resource path and
  real preload/save bridge before it uploads the installer.
- Steam achievements (#323) use `steamworks.js` **only in the Electron main
  process**. The renderer receives one `unlockAchievement(id)` IPC capability;
  never enable Node integration or disable context isolation to reach Steam.
  The package is pinned because it ships native binaries, is unpacked from ASAR,
  and is loaded by the packaged smoke before an installer is trusted. A shipped
  build contains no App ID: Steam supplies it when launching the game.
  `ED_STEAM_APP_ID` and `steam_appid.txt` are development aids only, and the
  latter is explicitly excluded from packaging.
