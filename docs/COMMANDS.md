# COMMANDS

The command block itself lives in [AGENTS.md](../AGENTS.md#commands) and is the
only copy — a number kept in two files is wrong in one of them within a few
commits, and `npm run test:fast` was once documented at four different figures
at once while actually taking a hundred seconds. `packages/core/src/codemap.test.ts`
fails the build if a second copy grows back, so **quote no timing here**.

This file is the part that is prose rather than a line: how a session starts,
what the landing actually does, what CI is shaped like, and which of those
commands answer a question nothing else can.

---

## How a session starts

A fresh session on the web orients itself, installs dependencies and warms the
content cache before an agent reads anything — `.claude/hooks/session-start.mjs`,
registered as a SessionStart hook. Locally it does nothing; you already have
`node_modules` and a whole history.

**Orienting is `tools/orient.mjs`, and it is not cosmetic.** The clone arrives
SHALLOW — a third of the history — and a shallow clone does not refuse ancestry
questions, it answers them wrongly: `git branch --merged`, `git log main..x` and
every "has this landed?" come back false past the graft boundary. A cleanup
script trusted that answer once and reported 29 branches as unmerged that were
all merged. The hook unshallows so the answers are real, then prints which
issues other sessions are holding. What that cost before it existed is in
[PARALLEL.md](PARALLEL.md).

## The landing

`npm run land` is a **session preflight**, not a main-pushing command.
[AGENTS.md](../AGENTS.md#working-style) authorizes running it and enqueueing the
result without a confirmation prompt, but a session has no code path that may
push or directly merge `main`.

The default preflight fetches, rebases onto `origin/main`, installs, then runs
typecheck, validation and `test:fast` on that rebased head. Risky core, content
or gate work can opt into the complete local CI-derived set with
`npm run land -- --full-preflight`; it still has no push authority. On success
either mode records `preflight-green`. Keep or open a ready same-repository PR,
then choose GitHub's **Merge when ready**.

The repository ruleset makes GitHub's **native merge queue** the only normal
landing path. The queue uses **REBASE**, builds one group at a time, and may
merge up to three green PRs together. GitHub creates a
`gh-readonly-queue/main/...` synthetic commit and raises the `merge_group`
event. `.github/workflows/check.yml` always sends that event through the full
CI tier and publishes the stable required result **`CI required`**. Only after
that exact integration commit is green does GitHub update `main`.

That distinction is load-bearing. A green PR-head run says the branch is green
against the base GitHub tested at that moment. The merge-group run says the
actual rebased integration GitHub is about to merge is green. The queue proof
for this cutover is #443: its successful `merge_group` commit became the exact
new `main` commit.

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

### A change made only of markdown gets the short set

When every file in a pull request is `.md` **and** its base has a green verdict,
the ordinary PR-head workflow may use the short tier: `typecheck`, `validate`
and `test:fast`. The native merge queue does **not** inherit that shortcut:
every `merge_group` runs the full tier before it can merge. `npm run land
-- --full-preflight` is the local way to request the complete set before enqueueing.

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
needed, then enqueue the ready PR with **Merge when ready**; GitHub's native
queue performs its own fresh rebase and authoritative merge-group check.


## CI, and the janitor

`.github/workflows/check.yml` runs **in two tiers**. The short one — `lint`
(typecheck + validate + prose annotations) and `fast lane` — runs on every
event, always. The full one adds `test` as a four-way vitest shard, `gates` in
five lanes (`batch`, `blood`, `fire-rate`, `war` and `endings`), a `windows` runner and a `corpus` warm that
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

### Scheduled evidence is CI, not a dashboard

`tools/ci-evidence.json` is the checked inventory for #451. Its
`currentTier` says what the repository actually enforces; a `proposedTier`
is only a candidate, and any `moveBlockedBy` keeps that evidence on the merge
path until the named deterministic/mechanism proof exists. Do not turn the
inventory into an optimistic path-filter list.

`.github/workflows/nightly-regression.yml` runs daily on `main` (and by
manual dispatch): **all** slow-test shards, the `fire-rate`, `war` and
`endings` gate lanes, and the broad iOS build/install/launch smoke.
`.github/workflows/weekly-statistical.yml` runs the canonical `blood`
sample weekly (and by manual dispatch).

The slow-test cadence split is now real rather than aspirational. Full PR and
merge-group CI still run every fast test plus the slow suites whose checked
inventory entry says `currentTier: merge-blocking`; nightly runs the complete
slow suite, including the broad population/cadence regressions moved off the
merge path. The selected merge-slow set is duration-packed into four shards
and currently measures about 9.5 minutes per shard before hosted-runner setup.
A slow suite stays merge-blocking when it contains a deterministic/stateful
contract without a cheaper witness — runtime alone is never permission to move
it. The broad iOS runtime smoke follows the same policy shape: merge CI runs it
when native mobile/toolchain inputs change, while nightly exercises it
regardless of the day's diffs. Gate cutovers remain separately justified by
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

**The build was 68 minutes and one shard was all of it.** Run 185 (`main`,
green): every job started within three seconds of every other, seven of the
nine finished inside 21 minutes, and `test 2/4` took **67m47s** while the other
three shards took 3m02s, 10m45s and 4m03s. Vitest shards by a hash of the file
PATH, not by duration, so which suites a shard draws is re-rolled whenever a
test file is added anywhere — and every shard was green throughout.

Two things fixed it. The shards are packed by recorded duration now
(`tools/shards.mjs`, off `tools/test-durations.json`), so four shards cannot
fall apart by coincidence of filename. And **one file was most of the problem
underneath that**: `burying.slow.test.ts` polled `g.view()` — which rebuilds
the household tree, the halls and a chronicle slice — two and three times a
turn to read a number, over about fourteen thousand turns a run, sixty-five
seeds and two policies. It plays exactly what it played before. Measured on a
four-core container, before and after:

| | before | after |
|---|---|---|
| `npm test` | ~65 min | **~14 min** |
| packed shards | 60.2m / 14.6m / 14.6m / 14.6m | **~10m each** |
| spread | 4.12x | **1.00x** |
| longest single file | 60.2m, over a 26.0m fair share | **~9m, under ~10m** |

Those container figures explain why duration-packed test shards exist; they
are not a current runner contract. Current gate-lane baselines live only in
`tools/gate-durations.json`, and each gate job measures itself and fails when
it exceeds the recorded tolerance. #333 records the current per-gate
attribution and repack evidence in `docs/BALANCE-LOG.md` instead of copying
another stopwatch table here. Each lane also retains the JSON produced by
`npm run gates -- --lane <lane> --timings-json <file>`, so a drift can be
attributed gate by gate without transcribing timestamps. A faster build starts
by looking at whichever checked lane the data says is longest.

The shards are not level on the runners (10m05s against 5m27s) while the
committed table packs them level, and that is not the packing failing: the
durations come from a four-core container with a warm corpus, and a runner is
a different machine that may restore a cold one. What the table gets right is
the *relative* cost of the files. `lanes.test.ts` asserts the packing against
those recorded durations — a structural claim about one file being too big —
never against a runner's clock, which would be a stopwatch in CI and muted
within a fortnight.

**What went stale, and what was done about it.** `check.yml` had claimed
`18m02s of wall clock` since run 125 and carried a written argument that
balancing the shards would buy nothing — sound when written, and then `war`
halved (the 500-year term, #133) while `test 2/4` quadrupled, so the floor
stopped being the gates and the argument survived the fact it rested on.
`vitest.config.ts` and this file carried their own copies. All three said, in
their own prose, that a timing comment is perishable. **The warning is not the
mechanism**, so the numbers that decide anything are data now: `npm run cost --
--full --write` measures them, the sequencer packs from them, and a test fails
when they drift. What is left in the comments is the reasoning, which is the
part a number cannot carry.

**Gate-lane shape is measured, not remembered.** Earlier versions of this
file copied runner timings and then reasoned from them after they had gone
stale. #333 makes the current lane cost machine-readable instead. The
important structural fact remains: gates that share an expensive process-local
corpus stay together, while expensive independent gates can move to separate
runners. `gates.test.ts` proves the partition and the workflow matrix agree;
the per-lane duration guard proves the checked timing budget still describes CI.
**The landing is a separate problem, and it got its own fix.** Sharding buys
the verdict; it cannot help `npm run land`, which runs on one container. So
the landing overlaps instead: `typecheck` and `validate` still go first and
alone — twenty-three seconds that catch a broken template before anything
spends forty minutes — and then `test` and `gates` run AT THE SAME TIME.
Vitest takes a worker per core; `npm run gates` is a single node process
walking the gate table in a serial loop, so it held one core for thirty-six
minutes while three sat idle. About 196 core-minutes of work that took 76
minutes of clock **measured 40m01s** overlapped, on 2026-09-13 — fetch to
push, with the CI verdict wait on top of that.

It reports BOTH, too. A serial landing died at the first failure, so a red
test hid a moved gate and cost another 76 minutes to find it — the argument
this file already made about CI's jobs, which had been true of the landing the
whole time.

Everything runs on every push to `main` that touches anything but markdown,
because this repository fast-forwards without pull requests and a PR-gated job
would run approximately never. The gate
step runs everything in `GATES` rather than a list of names, because the list
used to be kept by remembering and gate 2 was left off it.

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
- **`npm run harness`** is the only viable balance method. One playthrough is
  8–12 hours; never claim a balance change works without a batch behind it.
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
- **`npm run cost`** re-measures the figures in AGENTS.md's block; `--write`
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
