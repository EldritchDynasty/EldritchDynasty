# Dependencies — what `npm audit` says, and what was accepted

The standing record for [#506](https://github.com/EldritchDynasty/EldritchDynasty/issues/506).
CI's `npm ci` prints an audit count on every job; this file says which of those
findings are known, why they are still there, and what would remove them. A
finding that is not in the table below is new, and is a bug report.

Never `npm audit fix --force`. It picks the newest major of everything it can
reach — it offered vitest 5, Electron 44 and a *downgrade* of electron-builder
here — without asking whether the code survives it.

## 2026-10-06 — 24 findings → 11, none critical or high

Measured on `main` at `2141779`: **24 (2 critical, 8 high, 14 moderate)**.

| Finding | Severity | Runtime? | Path | Fix |
|---|---|---|---|---|
| `vitest` ≤4.1.10, `tinypool` <2.1.2, `@vitest/mocker`, `vite-node` | critical ×2, moderate | dev (test runner) | direct | vitest `^2.1.8` → `^4.1.11` |
| `vite` ≤6.4.2 (fs.deny bypass on Windows) | high | dev (dev server, build) | vitest 2's own `vite@5` | gone with vitest 2; root pins `vite ^6.4.3` so vitest shares the client's |
| `esbuild` ≤0.24.2 (dev server CORS) | moderate | dev | direct (`gate-proof.ts` metafile) | `^0.21.5` → `^0.25.12`, deduped with vite's |
| `electron` <41.10.6 (24 advisories) | high | **shipped** (the Windows game) | direct | `^38.0.0` → `^41.10.7` — see below |
| `extract-zip` ≤2.0.1 (symlink traversal) | high | dev (binary download) | electron 38 → `@electron/get@2` | gone with electron 41, which uses `@electron-internal/extract-zip` |
| `vue`/`@vue/server-renderer` <3.5.42 (SSR XSS) | high | shipped, but no SSR | direct | lockfile 3.5.41 → 3.5.43, in range |
| `brace-expansion`, `source-map-js`, `http-cache-semantics` | high | dev | transitive | lockfile, in range (`npm audit fix`) |

### Electron 41 is a stopgap

41.10.7 is the smallest version that clears every Electron advisory reported,
and it does it without crossing two breaking changes: 42 stops downloading the
binary in `postinstall` (which `packages/shell/scripts/electron.mjs` depends on),
and 43 starts every file dialog without a `defaultPath` in Downloads. **But
41 is out of upstream support** — Electron supports the newest three majors —
so the next advisory will have no 41.x fix.
[#514](https://github.com/EldritchDynasty/EldritchDynasty/issues/514) moves the
shell to a supported line and takes on both of those changes deliberately.

### Vitest 4 changed three things the repository leaned on

- `poolMatchGlobs` and `poolOptions` are gone, and an unknown key is ignored
  without a word — which would have put the DOM suites back in the
  shared-registry pool (the #269 failure). `vitest.config.ts` now declares two
  `projects`; `lanes.test.ts` asserts the split and fails if either old key
  comes back.
- The reporter hook `onFinished` is gone. `tools/duration-reporter.mjs` would
  have stopped being called, written nothing, and left `npm run cost` reading
  the previous table as this run's. It implements `onTestRunEnd` now.
- npm 10.9's arborist crashes (`reading 'edgesOut'`) building the ideal tree
  across vitest 4's optional `jsdom` → `canvas` peer chain from the old
  lockfile. The lockfile was resolved once with npm 11 and then confirmed with
  npm 10: `npm install` is a no-op on it and `npm ci` installs it.

## Accepted — still reported, and why

| Advisory | Severity | Reached through | Why it stays | What removes it |
|---|---|---|---|---|
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) `sprintf-js` ≤1.1.3, DoS via unbounded precision | moderate | `electron-builder` → `app-builder-lib` → `@electron/get@3` → `global-agent` → `roarr` → `sprintf-js` (8 audit rows) | Build-time only: electron-builder fetching an Electron zip while packaging the Windows installer. No attacker controls a format string there. | electron-builder 27 (on `@electron/get@5`), still alpha — `27.0.0-alpha.9` on this date |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) `uuid` <11.1.1, missing bounds check in v3/v5/v6 with a caller `buf` | moderate | `@capacitor/cli` → `xcode` → `uuid@7` (3 audit rows) | Build-time only (iOS project generation), and `xcode` calls `uuid.v4()` alone — the vulnerable functions are never called. | an `xcode` release on `uuid` ≥11.1.1; none exists on this date |

Re-measure with `npm audit --json` before trusting either row: the advisory
database moves without a commit here.
