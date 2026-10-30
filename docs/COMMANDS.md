# COMMANDS

The command block below is the sole list of command costs, written by
`npm run cost` and checked by `packages/core/src/codemap.test.ts`. Keep costs
here only; measured figures are perishable and must be remeasured before quoting.

## Commands

```bash
npm install
npm run setup        # what the SessionStart hook runs: `npm ci` when node_modules
                     # is absent, nothing when it still matches the lockfile,
                     # `npm install` otherwise; never rewrites the tracked lockfile.
                     # `-- --browser` adds Playwright's Chromium, launched to prove it.
npm run doctor       # read-only: Node vs .nvmrc, dependency freshness, Chromium,
                     # hook wiring, main's CI verdict, each with its fix. `-- --json`
npm run brief -- --issue 1938 --issue-file <snapshot.json>  # read-only task brief

# Measured on a four-core container, and perishable. Re-measure before quoting.
npm run check        # typecheck (vue-tsc too) + validate + test;
                     # NOT the gates: landing on it broke main 4 times.
npm run land         # session preflight: fetch, rebase, install, then run
                     # typecheck + validate + test:fast ON THAT head. It stops
                     # at preflight-green; a session NEVER pushes main. Use
                     # --full-preflight for the complete local CI-derived set.
                     # Then open/keep a ready same-repository PR. Do not merge it:
                     # auto-merge-queue.yml lands exact-head green CI: native
                     # queue when public, fast-forward of main when private.
                     # Long preflights must use a harness-tracked background run;
                     # `nohup … &` dies with the container silently.
npm run land -- --status   # is a preflight running, dead, or preflight-green?
                     # A session preflight never pushes or merges.
npm run verdict      # did CI answer? green / red / pending / ABSENT (not a pass)
npm run test:fast    # ~6 min, the fix-and-rerun loop. Skips the *.slow.test.ts suites;
                     # lanes.test.ts fails the build if one turns up in this
                     # lane, or if a suite drives a batch through a tools
                     # module without declaring it.
npm test             # everything: fast and slow suites. For fresh counts and
                     # full-suite timing: npm run cost -- --full --write
npm run typecheck    # tsc over packages, then vue-tsc over the editor's and the
                     # client's templates.
npm run validate     # every content rule; exits non-zero on any error. An error
                     # names the file it is in: `events/rites.yaml → event:the_drowning`

npm run dev          # authoring tool at localhost:5173
npm run play         # the game at localhost:5174. Both run at once, on purpose
npm run shell        # the GAME inside the Electron shell — the editor keeps its own target
npm run shell:preview                 # build the client, then run the shell against dist
npm run smoke --workspace @ed/shell   # boot the shell, assert the renderer mounted, exit
npm run build:shell                   # Windows only (#67): client, then an NSIS installer

npm run harness -- 16 500             # 16 headless Long Lines, with balance numbers
npm run digest  -- 8 400              # fingerprint 8 runs; diff the block across commits
npm run gate                          # every gate — what CI will say, in one command
npm run gates   -- fire-rate          # one of them on its own, when you know which
npm run gates   -- --lane batch       # merge-blocking gate lane; sampled gates are scheduled
                                      # `batch`, `blood`, `fire-rate`, `war`, `endings`, `outcome-reach`.
npm run gate:drag / :blood / :ladder / :bearing / :endings / :war / :bottleneck
npm run gate:long / :short / :campaigns / :replay / :line-breaks / :record-returns # measured sessions; each one's
                                      # question is its `//` note in package.json
npm run gate:density -- --seeds=901,902 500 300   # what the player is asked, per
                                      # generation and per Age, and how often the same
                                      # thing twice. Both campaign terms. #88's instrument
npm run gate:land -- 12 500           # acreage trend, loss routes, reader, treasury
npm run corpus                        # warm the run corpus. CI caches it
npm run mutate -- assize --limit 20   # break code on purpose; list what no test noticed
npm run lint:prose                    # advice, never a gate
npm run gen:loci                      # regenerate loci.yaml
npm run gen:docs                      # regenerate docs/VOCABULARY.md from the schemas

npm run scoreboard                    # red rate on MAIN — a branch verdict and a
                                      # cancelled run get their own columns
npm run cost                          # re-measure the figures above; --write applies them
                                      # (--full --write: also the per-file table CI packs by)
npm run agents                        # who holds which issue, across every running session
npm run agents -- take 93 --paths packages/core/src/economy
npm run agents -- check               # anyone else writing my paths? Run before the long check
npm run agents -- release 93          # when it lands. See docs/PARALLEL.md
```

`loci.yaml`, `docs/VOCABULARY.md` and `tools/test-durations.json` are
**generated**. Never hand-edit one; the last packs CI's shards, and a stale one
fails `lanes.test.ts`.

---

## How a session starts

A fresh session on the web orients itself, sets up dependencies and Chromium,
and warms the content cache before an agent reads anything —
`.claude/hooks/session-start.mjs`, registered as a SessionStart hook. Locally it
runs only when the checkout is not ready: no Chromium, or dependencies whose
fingerprint no longer matches `package-lock.json`. An install that is merely
*present* no longer counts.

**Setup is `tools/setup.mjs`, and a person runs the same function**: `npm run
setup` (`-- --browser` for Chromium). `npm ci` only when `node_modules` is absent,
nothing when the fingerprint — lockfile hash, Node major, platform — matches,
`npm install` otherwise, because `ci` deletes `node_modules` and would throw away
a cached container image. If `npm install` rewrites the tracked lockfile, setup
puts it back and says so. **`npm run doctor`** is the read-only half: Node and
npm against `.nvmrc` and `engines`, dependency freshness, whether Chromium
starts, whether both hook registrations name scripts that exist, and `main`'s
last CI verdict (`unknown` offline) — each not-ready line with its fix, and
`-- --json` for the same facts. It installs, fetches and writes nothing.

**Orienting is `tools/orient.mjs`, and it is not cosmetic.** The clone arrives
SHALLOW — a third of the history — and a shallow clone does not refuse ancestry
questions, it answers them wrongly: `git branch --merged`, `git log main..x` and
every "has this landed?" come back false past the graft boundary. A cleanup
script trusted that answer once and reported 29 branches as unmerged that were
all merged. The hook unshallows so the answers are real, then prints which
issues other sessions are holding. What that cost before it existed is in
[PARALLEL.md](PARALLEL.md).

## Make a contribution

Start with [README.md's local setup](../README.md#run-locally), then read
[AGENTS.md](../AGENTS.md) and the `AGENTS.md` inside each package you will
change. [ARCHITECTURE.md](../ARCHITECTURE.md) routes a task to its source and
existing tests. Read the concept brief before changing game rules and the
world bible before authoring content.

1. Read or create the issue that owns the change. Check current claims with
   `npm run agents`; follow the repository's priority and dependency rules
   when choosing work.
2. Work on a dedicated branch, for example `git switch -c codex/<topic>`.
   Claim the issue with `npm run agents -- take <issue> --paths <paths>`;
   list the files or directories you will write. A refused claim blocks work
   on that issue. Content and gate/CI changes also need their lane claim; see
   [PARALLEL.md](PARALLEL.md#lanes).
3. Make the change and run the relevant existing tests. Use
   `npm run typecheck`, `npm run validate` and `npm run test:fast` for the
   ordinary loop. Content and balance work also need the measurements their
   claim requires. Regenerate generated files through their npm commands.
4. Commit the completed change, with a closing keyword such as `Closes #93`
   for each issue it completes. Keep the working tree clean, run
   `npm run agents -- check`, then `npm run land`. If it rebases, its checks
   apply to that new head. Use a harness-tracked background run for a long
   preflight and inspect it with `npm run land -- --status`.
5. Push the topic branch with `git push -u origin HEAD` and open or update
   one ready PR against `main`, describing the result, validation and any
   remaining limits. Keep partial work explicit with `Refs #N` and the
   preflight's `--no-issue-check` option instead of closing it prematurely.

The [landing contract below](#the-landing) explains the automatic queue and
the distinction between a local preflight, PR CI and integration CI. The
janitor retires claims after landing; a surviving branch alone does not mean
work is still in flight.

### Prepare an issue brief

`npm run brief -- --issue N --issue-file <snapshot.json>` assembles a starting
brief from the issue, tracked paths, the architecture owner map, package guides,
the root Task routes, cached claims and the existing verification planner.
It reads local data only: it does not fetch, claim, edit, run checks, pick a
branch, post a comment or change the tracker. A brief does not authorize work
or replace the instructions it links.

For Claude, Codex and sessions whose GitHub access is through the connector:
read the issue through that connector and save its JSON in the execution
workspace. The command accepts the issue object, an `issue` wrapper, or the
whole connector response with `structuredContent.issue`. Both `number` and
the connector's `issue_number` are supported. There is no live-fetch fallback
and no GitHub credential is required.

```bash
npm run brief -- --issue 1938 --issue-file /path/to/snapshot.json
npm --silent run brief -- --issue 1938 --issue-file /path/to/snapshot.json --json > brief.json
```

Markdown and JSON render one data object. Markdown keeps the acceptance section
verbatim and bounds the rest of the view; it names omitted entries and points
to `--json`. If acceptance alone exceeds the Markdown budget, use JSON to keep
it intact. Resolved, ambiguous, missing and unsafe paths carry their original
issue lines. A line citation outside today's file, or a named function absent
from its cited span, is a gap to review, not a guessed correction.

Issue/dependency state from a file is stale. An optional outer `fetchedAt` ISO
timestamp is preserved when supplied; otherwise it is unknown, and `loadedAt`
is explicitly a different clock. File modification time is not used as a fetch
time. HEAD names the committed revision; routing and citation checks read the
current tracked working-tree files, which may include local edits.

Claims are read from cached refs without refreshing them, even if the cache
looks recent. Refresh with `npm run agents` before claiming/editing, obtain
current blocker states from the tracker, then run `npm run agents -- check`
before a long check. Verification advice comes from `planFor` and separates
local checks, required integration CI and scheduled evidence; it is based on
referenced/proposed paths rather than an actual implementation diff.

A session with no executor cannot run this Node command. It can save the
connector snapshot and hand it to an executor-equipped session, requesting the
result with its source, revision and freshness fields. Until then, read the
linked guides and follow the [connector claim transport](PARALLEL.md); do not
represent a manually assembled summary as generated output.

## The landing

`npm run land` is a **session preflight**, not a main-pushing command.
[AGENTS.md](../AGENTS.md#working-style) authorizes running it and leaving the
result as a ready PR without a confirmation prompt, but a session has no code
path that may push or directly merge `main`.

The default preflight fetches, rebases onto `origin/main`, installs, then runs
typecheck, validation and `test:fast` on that rebased head. Risky core, content
or gate work can opt into the complete local CI-derived set with
`npm run land -- --full-preflight`; it still has no push authority. On success
either mode records `preflight-green`. Keep or open a ready same-repository PR
and leave it ready. **Do not click Merge, directly merge `main`, or post
`/land`; `/land` is retired.**

`.github/workflows/auto-merge-queue.yml` owns the landing. It runs on PR
`opened`, `reopened`, `ready_for_review`, `synchronize` and `edited` events,
and on completion of the `check` workflow. On an early PR event it may find
`CI required` absent or pending; that is a normal successful no-op. When the
`check` workflow later completes successfully, the workflow-run handoff
re-reads the PR and accepts it only when the PR is still open and ready, still
targets `main`, still belongs to this repository, and still has the exact head
SHA that went green. A completed check for an older head can never land newer
code. Both landings authenticate with the merge-queue GitHub App's token.

Normally an agent does nothing after exact-head CI becomes green; the
workflow-run handoff takes it. If that was missed because the earlier event
raced or was cancelled, a factual PR-body edit can retrigger the supported
`edited` path. That is recovery for the automatic path, not permission to
merge directly.

**Which landing runs depends on the repository's visibility**, read off the
event in one place (`LANDING_MODE`). GitHub's native merge queue exists only
in public organisation repositories or private ones on Enterprise Cloud, and a
private repository on the Free plan has no rulesets, branch protection or
auto-merge either (#1947). Making the repository public again switches back
with no edit.

- **Public: the native merge queue.** The handoff calls GitHub's
  `enqueuePullRequest` GraphQL mutation. The ruleset makes the queue the only
  normal landing path. It uses **REBASE**, builds one group at a time, and may
  merge up to three green PRs together. GitHub creates a
  `gh-readonly-queue/main/...` synthetic commit and raises the `merge_group`
  event; `check.yml` always sends that event through the full CI tier and
  publishes the stable required result **`CI required`**. Only after that exact
  integration commit is green does GitHub update `main`. The queue proof for
  this cutover is #443: its successful `merge_group` commit became the exact
  new `main` commit.
- **Private: a fast-forward.** `tools/fast-forward-landing.mjs` lands a green
  head only when it already contains `main`, by moving `main` to that exact
  SHA with `force: false`. A `main` that moved meanwhile refuses rather than
  receiving an untested combination. A green head that is behind `main` is
  rebased by GitHub (`updatePullRequestBranch`, REBASE, with an expected head);
  its CI runs again and that run's handoff lands it. After `main`'s own CI
  passes, `sweep-after-main` does the same for every ready PR, oldest first.
  A rebase GitHub refuses, or a PR changing `.github/workflows/` when the App
  lacks the Workflows permission, gets one comment saying so. Nothing moves
  `main` but the App, and nothing forces it; but with no ruleset GitHub does
  not stop a person who pushes there, so the rule against it is this document.

That distinction is load-bearing. A green PR-head run against an older base says
the branch was green against that base. What may reach `main` is only a commit
whose own CI is green: GitHub's merge-group commit when public, the PR head
that already contains `main` when private.

A local preflight does not create a CI verdict, close an issue, or turn
"green here" into "landed". `npm run check` is also not a substitute because
it omits the gates. The repository-admin bypass is retained only as an
**emergency pull-request escape hatch**; ordinary work must not use it to skip
the queue.

**The issue-closing guard still applies to local preflight.** A claimed issue
needs a real `Closes #N`/equivalent keyword unless this slice intentionally
leaves it open. For staged work use `npm run land -- --no-issue-check` and use
`Refs #N` or `Part of #N` in the PR/commit text. Do not negate a closing
keyword because GitHub still interprets the keyword.

### Find focused local checks

`npm run verify -- --plan` recommends checks for the current diff against the
merge base of `origin/main` and HEAD. `--base <ref>` changes that comparison;
`--json` emits the same plan as data. It includes committed, staged, unstaged
and untracked paths. The head SHA identifies the commit, not a snapshot of
uncommitted edits.

Planning reads local git facts and cached verdict refs. It never fetches,
rebases, installs dependencies or runs checks, and needs no GitHub API token.
An unavailable base, shallow history or incomplete map produces an uncertain
full-preflight recommendation. Cached base verdicts can be absent or stale;
only the existing green-base Markdown policy permits the short documentation
set. Renames, deletions, shared simulation files, package boundaries and
unmapped dependencies broaden the recommendation.

The path-to-suite source is [ARCHITECTURE.md](../ARCHITECTURE.md#where-a-thing-lives),
parsed once by `tools/codemap.mjs` for verification and task briefs. Colocated
tests add evidence but cannot establish coverage alone. Tiers come from
`tools/ci-evidence.json`'s `currentTier` and the existing workflow reader;
`proposedTier` never selects a check. YAML changes include validation, loader
tests and the scheduled fire-rate/outcome-reach measurements. The planner does
not use import-graph selection: barrels fan out widely and authored YAML is
outside that graph.

The output separates **recommended local**, **required integration CI** and
**scheduled evidence**, with a reason and source for each recommendation.
`npm run land -- --dry-run` also prints this advisory plan. It does not change
the landing's actual steps, blockers, proof reuse or CI requirements.

Add `--run` to execute only the recommended local commands through the shared
portable npm launcher. It reports each actual exit status and stops at the
first failure; scheduled commands remain a separate evidence list. Explicit
execution can run the recommended full preflight, whose normal fetch, rebase
and install behavior is described above. A focused recommendation is an
iteration aid; required integration CI remains authoritative.

### A change made only of markdown gets the short set

When every file in a pull request is `.md` **and** its base has a green verdict,
the ordinary PR-head workflow may use the short tier: `typecheck`, `validate`
and `test:fast`. The native merge queue does **not** inherit that shortcut:
every `merge_group` runs the full tier before it can merge. The private
fast-forward landing has no second run, so a markdown-only PR lands on its
short PR tier, the same tier `main`'s own push CI gives a markdown-only commit.
`npm run land -- --full-preflight` is the local way to request the complete set
before the landing.

This is safe for a reason that can be checked, not assumed: the gates and the
slow suites load only the simulation sources and the content YAML, and the
content loader refuses anything that is not YAML. What reads markdown is the
fast lane, and it reads it as data — `codemap.test.ts` for dead paths and the
size of `AGENTS.md`, `codex.test.ts` for the Codex byte budget, `docs.test.ts`
for a hand-edited `docs/VOCABULARY.md`. So a markdown-only change still runs
the tests that can fail on it, and skips only the ones that cannot see it.

It is not the rule this file once described and `tools/land.mjs` retired — an
agent classifying its own diff from memory. `tools/docs-only.mjs` is one
function over `git diff --no-renames`, shared by the landing and `check.yml`,
and it fails safe: a renamed `.ts`, an empty diff, a diff it cannot compute or
a base that is red, pending or unjudged all get the full set. The green-base
rule is the one that matters most — a short run on top of a red `main` would
record a green verdict and tell every reader the red had gone away.
`land.test.ts` fails the build if code outside the fast lane starts naming a
markdown file, which is the day the argument above stops being true.

### A preflight has to outlive the session that started it

An optional `--full-preflight` can outlive a web-session turn. Start it in a
background the harness tracks (for example Claude Code's `run_in_background`)
and never with `nohup … &`, which can die when the container is paused and
leave no useful completion signal.

`npm run land -- --status` reports whether the preflight is running, dead, or
last reached `preflight-green`. A dead session preflight has pushed nothing. Clear/restart the preflight as
needed, then keep the same-repository PR ready; `auto-merge-queue.yml` lands
it after exact-head CI is green, through the native queue's merge-group check
when public or a fast-forward of that exact head when private.


## CI, and the janitor

`.github/workflows/check.yml` runs **in two tiers**. The short one — `lint`
(typecheck + validate + prose annotations) and `fast lane` — runs on every
event, always. The full one adds the checked merge-blocking slow suites in four duration-packed
vitest shards, `gates` in
one merge-blocking `batch` lane (sampled `fire-rate`, `war`, `endings`, `blood` and `outcome-reach` run weekly), a `windows` runner and a `corpus` warm that
nothing waits on, and it runs on every push to `main`, every tag, every manual
dispatch and every pull request that is **not a draft**. A draft pull request
gets the short tier, and the `full-ci` label raises it without undrafting.
A push or pull request made only of markdown, on a base whose own verdict is
green, gets the short tier too — see [the landing](#a-change-made-only-of-markdown-gets-the-short-set)
for why that skips nothing that could fail. A tag or a manual dispatch always
runs everything.
Serial, the build reported only the FIRST thing wrong, so a moved gate hid
behind a failing test and cost another whole run to find; each job now answers
independently, and every matrix sets `fail-fast: false` so a shard cannot
cancel its siblings and rebuild that failure mode one level down.

### Trusted gate-proof reuse

Merge-blocking simulation gates may reuse a prior result only through the
#441 proof boundary. **A cache hit is never evidence.** The authority is a
proof artifact produced by a successful `push` run of
`.github/workflows/check.yml` on `refs/heads/main` in this repository.

Each proof names its gate, proof-format and fingerprint-algorithm versions,
normalized dependency manifest, fingerprint, source SHA/run/repository/workflow,
and whether the producer observed any runtime file read outside that manifest.
The dependency manifest is conservative by construction: esbuild derives the
transitive code closure from the gate entry, **all** `packages/content/**`
files are included, and `package-lock.json`, Node major/minor, runner OS/image
and the canonical gate invocation are fingerprinted too. During the trusted
producer run a Node preload traces repository file reads. An unclassified read,
missing trace, malformed proof, or proof-generation failure yields no reusable
evidence; the next integration runs the gate.

A PR or merge-group consumer may inherit green only after independently checking
all of these facts:

- the source workflow run event is `push`, its branch is `main`, its
  conclusion is `success`, and its head repository is
  `EldritchDynasty/EldritchDynasty`;
- the run path is exactly `.github/workflows/check.yml`;
- the proof's source SHA and run id match that workflow run;
- proof-format and fingerprint-algorithm versions are current;
- the gate name and current dependency fingerprint match;
- the producer marked the proof reusable and recorded zero unclassified reads.

Lookup is by **fingerprint**, not by the PR base SHA: the newest trusted main
run with an equal fingerprint is eligible. A feature-branch artifact, PR
artifact, `actions/cache`, mutable label, arbitrary branch/ref, failed or
pending run, missing artifact, or unverifiable evidence is never an authority.
Every such uncertainty is a cache miss and executes the real gate. The gate job
and stable `CI required` result keep the same names whether a gate executed or
reused proof; their summaries name the fingerprint and inherited main run so
reuse remains auditable.

### Scheduled evidence is CI, not a dashboard

`tools/ci-evidence.json` is the checked inventory for #451. Its
`currentTier` says what the repository actually enforces; a `proposedTier`
is only a candidate, and any `moveBlockedBy` keeps that evidence on the merge
path until the named deterministic/mechanism proof exists. Do not turn the
inventory into an optimistic path-filter list.

`.github/workflows/weekly-statistical.yml` runs on Sunday at 04:23 UTC on
`main` (and by manual dispatch): **all** slow-test shards, the `fire-rate`,
`war` and `endings` gate lanes, the broad iOS build/install/launch smoke, and
the canonical `blood` and `signing` samples.
`.github/workflows/outcome-reach-telemetry.yml` runs the canonical sampled
`outcome-reach` report weekly on its own cadence. The scheduled-regression
watcher records both workflow streams, so a red weekly or outcome-reach run
becomes visible to `orient` and persistent P0 project work rather than a
dashboard-only failure.

Until 2026-10-27 the slow shards, the three sampled gate lanes and the iOS
smoke ran **nightly**. They moved to the weekend run when the repository went
private on the Free plan, whose 2,000 included Actions minutes a month the
nightly alone would have spent (#1949). Merge CI did not change. What changed
is how soon a scheduled red is seen: a sampled gate that goes red on content
nobody touched now surfaces within a week rather than a day, so expect a week
of commits to bisect, or dispatch the workflow by hand when a risky change
lands. `refs/scheduled/nightly` keeps the nightly's last verdict as history;
`orient` no longer reads it.

The slow-test cadence split is now real rather than aspirational. Full PR and
merge-group CI still run every fast test plus the slow suites whose checked
inventory entry says `currentTier: merge-blocking`; the weekly run executes the complete
slow suite, including the broad population/cadence regressions moved off the
merge path. The selected merge-slow set is duration-packed into four shards from the
committed duration table, and `ci-evidence.test.ts` fails if that measured
merge-slow floor exceeds the issue's ten-minute target. Do not copy the current
shard stopwatch into prose: the inventory is being deliberately reduced as
deterministic witnesses replace played-run evidence. A slow suite stays
merge-blocking when it contains a deterministic/stateful contract without a
cheaper witness — runtime alone is never permission to move it. The broad iOS
runtime smoke follows the same policy shape: merge CI runs it
when native mobile/toolchain inputs change, while the weekly run exercises it
regardless of the week's diffs. Gate cutovers remain separately justified by
their own inventory rows; a scheduled copy is not by itself permission to stop
blocking merges.

`.github/workflows/scheduled-regression-watch.yml` turns a scheduled
non-success on `main` into active project work: it opens or updates one
`priority: P0` issue per scheduled workflow, records the failing SHA and run
URL, repairs the priority label if it drifted, and closes the issue when that
workflow is green again. A missing, cancelled or red scheduled run is never
substitute green evidence.

**Why the tier exists**, measured over runs 169-198: `codex/issue-61-channel`
started three full builds in **ten seconds** and two were cancelled on arrival;
`codex/issue-133-stage5` started eight in seventeen minutes and seven were
cancelled. The cancellation is correct — superseding a stale run is what
`cancel-in-progress` is for — and the waste is upstream of it, in firing the
expensive half at a commit that will be superseded before it finishes. The
default is still the safe one: an ordinary pull request is not a draft, so it
gets exactly the coverage it always did, and cheap iteration is something you
opt into rather than something you can forget your way out of.

**Why duration packing exists.** The earlier full-suite build was dominated by
one shard while its siblings finished much earlier. Path-hash packing had no
relationship to cost; repeated `view()` reads inside a played-run test added
avoidable work as well. The fix paired duration-based packing with a cheaper
read of the same simulation result. Historical measurements are retained in
[AGENT-LOG.md](AGENT-LOG.md) and [BALANCE-LOG.md](BALANCE-LOG.md).

Current measurements live in `tools/test-durations.json` and
`tools/gate-durations.json`. The test sequencer packs from the first;
`lanes.test.ts` and the evidence-inventory checks enforce the retained suite
shape. Gate jobs retain structured timings with host CPU and Node metadata and
apply the checked duration guard. A faster runner and a cheaper algorithm are
different explanations, so retain that host evidence when rebaselining.

**A baseline belongs to a runner class**, keyed by logical CPUs (#1947).
GitHub's standard Linux runner has 4 CPUs for a public repository and 2 for a
private one, and the gates fan out over workers, so going private made the same
`batch` commit take 12.9m against its 9.0m 4-CPU baseline. Each lane's
`seconds` is the class named by the file's `cpus`; `byCpus` holds measurements
on other classes. A lane with no measurement for the host it ran on prints
**NOT JUDGED** and a `::warning::` naming what to record, rather than being held
to another class's number. Record the first real run on a new class under
`byCpus`, with its run, job and host.

The local preflight has two modes. Default runs typecheck, validation and the
fast lane. `--full-preflight` derives the complete local script set from CI
and overlaps independent expensive checks after the preliminary checks pass.
Neither mode pushes `main`; CI on the exact commit that lands remains the
integration authority (the merge-group commit when public, the PR head when
private). Merge CI runs the classified blocking slow suites and
`batch` gates, while scheduled and release workflows own the broader sampled
sets described above. It does not run every gate on every merge.

**One job runs on Windows, and it is the one that makes AGENTS.md's
"Supported environments" a fact rather than a sentence.** It runs the same
`typecheck`, `validate` and `test:fast` an agent runs — no Windows-only
variant, because a variant is a command that drifts. The fast lane is the whole
answer because that is where the suites that spawn the real scripts live:
`settings`, `orient`, `janitor`, `land`, `agents`, `verdict` and
`portability` all run the tooling and read what it prints. The gates and the
slow lane stay on one platform; a seeded pure simulation returns the same
numbers on either, and a second runner spending thirty minutes to re-derive
them would buy nothing. It costs no wall clock either way — the current
gate critical path is read from `tools/gate-durations.json`, and the Windows
job remains below that checked budget.

`npm run land` cannot stand in for it. The landing runs on whatever machine
the agent is on, so green there says the suite passes THERE. `ciScripts` in
`tools/land.mjs` knows `test:fast` is covered by the `test` it already runs —
a declared subset, not a suppression — and nothing it could run would cover
the platform.

`janitor.yml` runs `tools/janitor.mjs` on every push to `main`: it deletes
branches already merged there, retires every claim ref those branches were
holding, and closes what a landing commit named. **An agent's own git proxy
refuses ref deletion**, so that housekeeping cannot happen anywhere else — do
not try it, and do not read a surviving branch as work in flight.
`DRY_RUN=1 node tools/janitor.mjs` shows what it would do.

## The ones that answer a question nothing else can

- **`npm run digest` proves a refactor changed nothing.** Run it before and
  after. If the fingerprint block moves it was not a refactor — and since each
  year phase draws from its own RNG stream, a moved block points at the system
  that moved it.
- **`npm run harness`** supplies headless balance evidence. Human Long Line
  playtime is unmeasured; never claim a balance change works without a batch
  behind it.
- **`npm run mutate`** breaks code on purpose and lists what no test noticed. A
  PROBE, run deliberately — never a CI threshold.
- **`npm run gate:drag` / `:blood` / `:ladder` / `:bearing`** are the four
  measured sessions; their arguments and findings are in
  [BALANCE-LOG.md](BALANCE-LOG.md).
- **`npm run gate:campaigns -- 12`** (issue #274) prints both the static difference between A Short Line and A Long Line and played reach on shared seeds under the chronicler and ascendant policies: ending sets, Ledger capacity, ladder/rite vocabulary, campaign-exclusive content, how often a real run reaches it, and where same-seed Short/Long decision streams first diverge. Use `--static` for the cheap inventory-only check. Run the played report whenever `CAMPAIGNS`, an ending, or a campaign-scoped condition changes, and paste the before/after report with the change so product drift is visible rather than inferred from prose.
- **`npm run gate:density`** (issue #88) reports what the player is asked and
  how often the same thing twice — per generation, per Age, the repeat rate
  within a run and within an Age, and the longest span carrying no Match, no
  Record block and no Age boundary. It takes `--seeds=` so the band in
  `attention.slow.test.ts` can be re-derived from that file's own pool; a band
  measured on other seeds is one nobody can reproduce when it goes red. Like
  the four above, it prints and does not judge.
- **`npm run cost`** re-measures the figures in this file's command block; `--write`
  applies them. They are measured on a four-core container and are perishable.
- **`npm run scoreboard`** gives the red rate on `main` and which job went red. It
  distinguishes exact **judged heads** from commits **covered** by a durable
  landing range; covered means the commit was included in a separately checked
  main head, not that it received its own green verdict. **Unjudged** means
  neither a main verdict nor proven landing coverage explains that history.
- **`npm run agents`** is the claim protocol — see [PARALLEL.md](PARALLEL.md).
  `check` before the long run says whether somebody landed in your paths while
  you worked.

`packages/content/loci.yaml` and `docs/VOCABULARY.md` are **generated**
(`npm run gen:loci`, `npm run gen:docs`). Never hand-edit either;
`.claude/hooks/guard-edit.mjs` denies the attempt.

## Interpreting reach evidence

- **Reach is a measured funnel.** An event's premise, cast, eligibility,
  selection and resolved outcome are separate questions. Use the gate runner
  (`npm run gates -- fire-rate`) and outcome-reach
  evidence for the current bundle; do not acquit a red result by remembering
  a rare tail from an older batch. Frame events use record-reading cadence,
  while ambient events share frequency rations.
- **Historical measurements stay dated.** `BALANCE-LOG.md` and
  `REGENCY-PACING.md` identify their code/content, campaigns, seeds and
  policies. They do not establish today's rate after another content change.
- **A rare invitation and a lost promise need separate counts.**
  `npm run report:story-routes -- --runs=800 --output=routes.json` records
  actual offers, chosen branches, scheduled/inline delivery, missing kept
  people and by-Age/tier/frequency selection sources. `--funnel` adds the
  existing upstream/downstream stages; `--policy=short-descent` takes the
  herald's short answer through the player docket. That policy uses different
  streams from canonical automatic play. `--without-glimpses` is a diagnostic
  premise ablation, including downstream effects, never a shipped ration
  change. Reports retain partial batches, exact seeds, source hashes, complete
  saved-state observer controls and house-level 95% Wilson intervals. They
  report evidence without changing any gate's threshold.
- **A delivery belongs to a specific promise.** Story-route rows report
  `launchPage` and `deliveryPage`, matching the saved cause of the schedule,
  unanswered choice or inline instance. A second promise is not fulfilled by
  the first one's page, even in the same year. Missing provenance remains
  unknown; several schedules for the same target from one page are explicitly
  ambiguous because saved causes do not distinguish those effects. An
  unanswered scheduled choice is `awaiting_decision`, not a retired promise.
- **Human response is unverified.** `PLAYTEST.md` records the waived,
  unrun studies. Automated reach, deterministic replay and mechanism tests
  cannot establish attachment, comprehension or enjoyment.
