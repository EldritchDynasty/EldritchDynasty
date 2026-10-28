# Windows and Linux, Claude Code and Codex

AGENTS.md states the rules. This is what is behind them, and what to do when
you touch a hook, a command or a test fixture.

Reviewed against `main` at `098bfe02` on 22 October 2026. The dated failures
below explain the current portable `.mjs` tools and shared hook registrations;
old file sizes, deleted scripts and runtime costs in that history are not
current measurements. Use [COMMANDS.md](COMMANDS.md#commands) for the live
command block; root plus each package guide fits the default 32 KiB budget.

## What it was

The claim — all four agent/platform combinations first-class — was prose until
2026-09-14, and false in every place it was load-bearing:

- Every hook was `#!/usr/bin/env bash`, and two read their own payload through
  **`jq`**. Neither is on a stock Windows box, and neither is on a CI runner
  unless somebody installed it.
- `.codex/hooks.json` named `C:\Users\GGPC\Documents\repos\...` — one
  developer's machine — and the script it named was a **copy** of the Claude
  one, gated on `CLAUDE_CODE_REMOTE`, which Codex never sets. It exited at
  line one of every session it ever ran in.
- Both guards read `tool_input.file_path` and nothing else. That is the Claude
  payload. Codex writes with `apply_patch` and names its files inside a
  unified-diff envelope on `tool_input.command`, with **no `file_path` key at
  all** — so under Codex the generated-file guard allowed every edit it exists
  to refuse.
- `tools/janitor.sh` used bash-4 associative arrays, so the one command here
  that **deletes things** could only be rehearsed from Linux.
- Three tools spawned a bare `npm`, which on Windows is a `.cmd` shim Node
  will not spawn without a shell.
- Codex silently truncates concatenated AGENTS.md files at
  `project_doc_max_bytes` (32 KiB default, openai/codex#7138). The root file is
  over 51 KiB, so Codex read about 63% of it and every per-package AGENTS.md
  arrived at zero bytes.
- Every CI job ran on `ubuntu-latest`, so none of the above was ever exercised
  where it fails.

**Not one of those threw.** A hook that cannot start prints nothing an agent
sees: the clone stays shallow, `merge-base --is-ancestor` answers FALSE past
the graft boundary rather than failing, and every "has this landed" comes back
wrong in the direction that looks cautious. This is the codebase's signature
failure mode, inside its own enforcement.

## The rules, and why each one

**Every operating script is `.mjs`, spawned with `node`.** No `.sh` under
`.claude/`, `.codex/` or `tools/`. `.devcontainer/` is the exemption, because a
devcontainer *is* a Linux image — `post-create.sh` runs `apt-get`.

**Claude's hooks use exec form**: `"command": "node"` with the script in
`"args"`. Shell form hands one string to `sh -c` on Linux and macOS, to Git
Bash on Windows, or to **PowerShell where Git Bash is absent**;
`${CLAUDE_PROJECT_DIR}` expands in two of those three and is a literal in the
other. Exec form has no shell in it, and on Windows it requires a real
executable — which is why `node` is the command and the script is an argument.

**Codex's registration is a command line**, because Codex runs a hook with the
session cwd, which may be a subdirectory, so the git root is the one anchor
correct from anywhere: `node "$(git rev-parse --show-toplevel)/..."`. That
evaluates in sh, Git Bash and PowerShell. `cmd.exe` does not expand `$(...)`
and is the one shell this would need a different form for.

**One script, two registrations.** `.claude/settings.json` and
`.codex/hooks.json` name the same files. Neither keeps a copy — the same
arrangement `.agents/skills` uses, and for the same reason: the copy that
existed drifted immediately.

**A hook reads its paths from `hookPaths`**, never from one key. It returns
every path a call touches, under either payload shape, including the
destination of a rename and the third file of a multi-file patch.

**`tools/portable.mjs` holds the four differences** and nothing else:

| | |
|---|---|
| `npmInvocation` | npm is a `.cmd` shim; run npm's own JS CLI through this Node |
| `nodeModulesLinkType` | a junction needs no privilege; a directory symlink does |
| `repoRelative` | backslashes, either-case drive letter, case-insensitive compare |
| `hookPaths` / `readHookPayload` | both agents' payloads, with no `jq` |

**A platform branch takes the platform as an argument.** `repoRelative(p, root,
'win32')` resolves with Windows rules on a Linux runner. The first cut read
`process.platform` inside and silently returned `c:/repo/packages/...` instead
of `packages/...` — a wrong answer in a function whose whole job is the string
two guards compare against, on the platform no test could reach.

## When you touch one

- Spawn `process.execPath` in a test, never an interpreter by name.
- Build a `file://` URL with `pathToFileURL`. `file://C:\Users\...` is not one.
- Assume no `/dev/null`, no `/tmp`, no POSIX separators, and no permission to
  create a Unix symlink.
- Keep AGENTS.md inside **both** budgets: `codemap.test.ts` caps the root file
  so a session does not load what only some tasks need, and `codex.test.ts`
  caps the root file plus the largest package file against
  Codex's default 32 KiB, without a repository override.
- **Never put a file's CONTENTS in argv.** Windows caps a whole command line at
  32,767 characters and answers `spawnSync … ENAMETOOLONG` past it; Linux's
  limit is megabytes, so this passes everywhere anybody runs it and fails on
  the one runner that exists to catch it. Write the argument to a temp file and
  pass the PATH.

  It happened to `scoreboard.test.ts`, which handed `advisoryJobs` the whole of
  `check.yml` to prove the reader derives its answer from the workflow rather
  than from a list. Nothing about that test changed on the day it broke:
  **`check.yml` grew a job** (#144's tier) and crossed 32,767 at 33,341 bytes.
  So the trap is not a big argument — it is a small argument that is a FILE,
  which some later commit will make big for reasons that have nothing to do
  with the test. A temp file has no limit worth knowing about, and the
  spawn-a-real-process property these tests exist for is unaffected.

## Shared operating requirements

The root `AGENTS.md` stays authoritative and agent-neutral. Launchers adapt,
never diverge; Claude's package `CLAUDE.md` files contain only `@AGENTS.md`.
From a root-cwd Codex session, explicitly read every touched package guide.
Codex only concatenates guides along the working-directory ancestry.

No `.sh` belongs under `.claude/`, `.codex/` or `tools/`; `.devcontainer/` is
the Linux-image exception. Hooks use `hookPaths` for both tool payloads, not
one agent's `file_path`. Assume no POSIX separators, `/bin/bash`, `/dev/null`
or `/tmp`: use `process.execPath`, `pathToFileURL` and portable temp paths in
tests. When commands, hooks or infrastructure change, verify this platform and
deliberately preserve the other with guarded, tested platform-specific behavior.

## What enforces it

| | |
|---|---|
| `portability.test.ts` | no `.sh`, no shell in a registration, no bare `npm`, no `bash` in a fixture, a Windows job in CI, LF pinned |
| `codex.test.ts` | the Codex payload shape, no absolute path in either registration, one script for both, the doc budget |
| `check.yml` → `windows` | a `windows-latest` runner doing `typecheck`, `validate`, `test:fast` |

The Windows job runs the fast lane because that is where the suites that spawn
the real scripts live. The gates and the slow lane stay on one platform: a
seeded pure simulation returns the same numbers on either, and a second runner
spending thirty minutes to re-derive them would buy nothing. It costs no wall
clock — the build's floor is a gate lane, not this job.

**It has now paid for itself twice.** The `ENAMETOOLONG` above was red on
`windows` and green on every other job in the build — all four test shards,
both gate lanes, the lint job and the Linux fast lane running the very same
suite. A repository that supports one platform in prose and tests one platform
in CI does not find out; this one found out in twenty minutes.
