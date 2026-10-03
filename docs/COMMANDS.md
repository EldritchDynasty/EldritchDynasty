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
push `main`.

The default preflight fetches, rebases onto `origin/main`, installs, then runs
typecheck, validation and `test:fast` on that rebased head. Risky core, content
or gate work can opt into the complete local CI-derived set with
`npm run land -- --full-preflight`; it still has no push authority. On success
either mode records `preflight-green` and tells the caller to keep/open a ready
same-repository PR and comment `/land`. It does not create a CI verdict, close
an issue, or turn "green here" into "landed". The queue always repeats the
rebase and complete authoritative set on the exact head it can push.

The **only** push boundary is `.github/workflows/remote-land.yml`, which invokes
the same command with explicit `--from-queue`. The queue serializes requests,
fetches/rebases again at the head of the line, runs the authoritative full set
on the exact head it can push, then configures the write-enabled
`LAND_DEPLOY_KEY` over SSH with checkout credentials disabled. A missing key
fails before the push. Never infer push authority from `GITHUB_ACTIONS` or any
other ambient variable.

Because the queue push uses the deploy key rather than `GITHUB_TOKEN`, it
emits the ordinary GitHub `push` event. The normal `check.yml`,
`verdict.yml`, and `janitor.yml` paths therefore run without manual dispatch
workarounds. The queue captures the pushed SHA and waits with `npm run verdict`;
green, red, pending and **absent** remain distinct, and an absent verdict is not
a pass.

**The issue-closing guard still applies before either preflight or queue work.**
A claimed issue needs a real `Closes #N`/equivalent keyword unless this landing
intentionally leaves it open. For that staged case use
`npm run land -- --no-issue-check` locally and enqueue the matching remote
escape hatch:

```
/land --no-issue-check
```

Ordinary work uses:

```
/land
```

A Claude Code connector may append its standard generated-by footer; the remote
parser accepts that exact footer after either command. Other extra text is not a
landing request. To mention an issue without closing it use `Refs #N` or
`Part of #N`; do not negate a closing keyword because GitHub still interprets
the keyword.

Remote landing requests are admitted only for trusted collaborators and are
serialized with the workflow's `queue: max` group. The normal group has an
explicit epoch suffix (after #427, `remote-land-main-v3`). The queue's final
non-force push is authoritative: if `main` moved after the checked rebase,
Git rejects the stale push rather than letting an old runner overwrite newer
work.

### Recovering an orphaned remote landing queue

A queue holder that is merely slow is not an orphan. First read its workflow
run and the serialized `land` job. The timeout clock starts when that **job
gets a runner** (its job `started_at`, or the first runner timestamp in its
job log), not when the workflow run was created and not when its request began
waiting for the concurrency group. Queue wait does not consume
`timeout-minutes`. If the `land` job has not started, it is queued, not
orphaned, regardless of the workflow's age.

Only use this recovery when GitHub still reports the running `land` job
**after `now - land_job.started_at` exceeds the workflow's own
`timeout-minutes` budget**, and the available GitHub control surface cannot
cancel that run. Run `36833259028` on 2026-10-01/02 is the first recorded
example: its 240-minute job remained `in_progress` for more than a day and
held every later `/land`.

Run `37095227792` is the counterexample that makes the distinction
load-bearing. It looked older than four hours while queued, but its `land`
runner started at `2026-10-03T14:46:39Z`, pushed at `17:05:38Z`, and
finished green at about `17:47:29Z`: roughly 3h01m of actual job runtime,
inside the 240-minute budget. Treating workflow/queue age as runtime caused an
unnecessary v2→v3 recovery.

Do **not** bypass the queue or click GitHub's merge button. Instead:

1. Change only the normal queue epoch suffix in
   `.github/workflows/remote-land.yml` (for example, after #427,
   `remote-land-main-v3` → `remote-land-main-v4`) and update its fast test.
2. Put `<!-- remote-land -->` in that recovery PR's body. The existing
   reusable bootstrap uses `remote-land-bootstrap-<run id>`, a separate,
   run-unique concurrency group, specifically so a proposed queue workflow can
   land without joining the broken copy already on `main`.
3. Land the recovery through that bootstrap path. The old holder may eventually
   wake, but its previously checked head cannot overwrite newer `main`: the
   repository landing pushes a specific rebased SHA without force, so Git
   rejects a stale non-fast-forward push.
4. Re-comment `/land` (or `/land --no-issue-check`) on any PRs that were
   waiting behind the retired epoch. Old pending runs stay attached to the old
   group; do not assume changing the workflow migrates them.

Rotating the epoch is recovery from an observed orphan, not a routine way to
skip a busy queue. If the existing holder is within its timeout, leave it
alone.

**Never click GitHub's merge button as a substitute.**

### A change made only of markdown gets the short set

When every file the branch changes is `.md` **and** the commit it lands on has a
green verdict, the landing runs `typecheck`, `validate` and `test:fast` instead
of the whole set — exactly CI's short tier — and CI does the same for that push.
`npm run land -- --full` runs everything anyway.

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
last reached `preflight-green`. A dead session preflight has pushed nothing:
sessions do not cross the queue's push boundary. Clear/restart the preflight as
needed, then enqueue the ready PR with `/land`; the queue performs its own
fresh rebase and authoritative check.


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
