# Dependencies — what `npm audit` says, and what was accepted

The standing record for [#506](https://github.com/EldritchDynasty/EldritchDynasty/issues/506).
CI's `npm ci` prints an audit count on every job; this file says which of those
findings are known, why they are still there, and what would remove them. A
finding that is not in the table below is new, and is a bug report.

Never `npm audit fix --force`. It picks the newest major of everything it can
reach — it offered vitest 5, Electron 44 and a *downgrade* of electron-builder
here — without asking whether the code survives it.

## Ongoing audit evidence — shipped with #514

The scheduled **dependency advisory audit** workflow (`.github/workflows/dependency-audit.yml`)
checks the current npm advisory database **without modifying the lockfile**.
It runs on `main` each Monday (03:37 UTC) and immediately after relevant
lockfile, shell-package or audit-workflow changes land on `main`. It can also
be dispatched manually after
dependency changes, and uploads the unfiltered `dependency-audit.json` for
review. `tools/electron-audit.mjs` also writes a summary of advisory severity
and Electron/packaging dependency findings to the GitHub Actions job summary.

The policy is deliberately narrow: **any high or critical package finding
fails** the audit; low/moderate findings are listed for comparison with the
accepted table below. Those remaining findings are not automatically accepted
just because the scheduled job is green. A malformed npm response or a
network failure must not be reported as a clean bill of health. This is a
new recurring measurement, not a replacement for the first successful
tagged Windows install/signing proof required by #321 and #514.

Hosted run [38226428291](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/38226428291)
at `978c576ac17511226433a28c00e3da20b45022c5` was reviewed on 12 October:
0 critical, 0 high, 11 moderate, 0 low. Its retained artifact and disposition
are linked in [#514](https://github.com/EldritchDynasty/EldritchDynasty/issues/514#issuecomment-6121709689).
These are dated results, not a claim about a later advisory database.

## 2026-10-22 — documentation-audit measurement

`npm audit --json` on the unchanged lockfile from `main` at `098bfe02`
reported **0 critical, 0 high, 13 moderate, 0 low**. The lockfile has Electron
44.7.0 and Vitest / `@vitest/mocker` 4.1.11. npm exits 1 for these findings;
`tools/electron-audit.mjs` passes its high/critical gate while listing the
moderates for review. No dependency or lockfile was changed by this audit.

The two extra package rows over the historical 11 are `@vitest/mocker` and
its parent `vitest`, from:

| Advisory | Reported affected range | Status |
|---|---|---|
| [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), unauthenticated manual mock registration | `@vitest/mocker` >=2.1.0-beta.7, <4.1.12 | Newly recorded dev/test dependency finding; npm reports a fix available. Not accepted by the old table. |
| [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp), Windows redirect allowlist traversal | `@vitest/mocker` >=4.1.11, <4.1.12 | Same pending review/remediation; does not establish a shipped renderer exposure. |

The accepted historical packaging and iOS-generation findings below remain
reported too. Reproduce the current report before taking a dependency change;
the documentation audit neither waives these new findings nor claims a clean
advisory result.

---

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

### Electron 41 was a stopgap (historical 2026-10-06 note)

41.10.7 is the smallest version that clears every Electron advisory reported,
and it does it without crossing two breaking changes: 42 stops downloading the
binary in `postinstall` (which `packages/shell/scripts/electron.mjs` depends on),
and 43 starts every file dialog without a `defaultPath` in Downloads. **But
41 is out of upstream support** — Electron supports the newest three majors —
so the next advisory will have no 41.x fix.
[#514](https://github.com/EldritchDynasty/EldritchDynasty/issues/514) was
opened to move the shell to a supported line and take on both changes.

### 2026-10-08 — Electron 44 code landed; release proof still outstanding

[#522](https://github.com/EldritchDynasty/EldritchDynasty/pull/522) updated
`@ed/shell` and the lockfile to **Electron 44.5.1**. Its launcher uses Electron
44's on-demand binary installation through `require('electron')`, and the
Open-a-run dialog now sets Documents as its explicit `defaultPath`. The
41.10.7 table above records the **2026-10-06 audit**, not the currently
installed Electron version.

The code slice passed hosted PR CI, including clean dependency installation,
but that is not evidence that a freshly installed Electron shell has launched
successfully or that the tag-only Windows installer has packaged and passed
its packaged smoke. [#514](https://github.com/EldritchDynasty/EldritchDynasty/issues/514)
was subsequently closed by owner decision: the launcher engineering and cold
Windows smoke had shipped, and the remaining tagged packaging proof was folded
into #321. The unsigned beta.3 proof and deferred production signing/store work
are now recorded in [issuesneedingowneraction](../issuesneedingowneraction).
Do not treat the historical advisory totals as a current audit result.

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
