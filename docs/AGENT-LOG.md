# AGENT-LOG

What changed in the agent workflow, and what it cost or saved — measured, in
the shape [BALANCE-LOG.md](BALANCE-LOG.md) uses for content.

Append under a dated heading. Never edit an entry in place: the point of a log
is that a later reader can see what was believed at the time and whether it
held.

---

## The one thing to know

**This repository measured the simulation obsessively and the agent loop not at
all.** Nine gates play thousands of years to ask whether a design claim is
true; `npm run digest` proves a refactor changed nothing; BALANCE-LOG records
what every content drop did to the frequency tiers. None of it was pointed at
the loop an agent runs, so every change to that loop was a matter of opinion.

`npm run scoreboard` is the instrument. It reads `refs/verdict/<sha>`, written
by `.github/workflows/verdict.yml`, so it needs no API credential — which
matters, because a session has none: `curl https://api.github.com/...` returns
`403 GitHub access is not enabled for this session`, while `git fetch` works.

It can only see back as far as the verdict refs go, and they begin
**2026-09-07**. The 40-run history below was read by hand from the Actions API
and is not reconstructible from the repository.

---

## 2026-09-07 — the landing gate, the verdict, and six smaller holes

Epic #116. The measurements that opened it, from runs 61–100 of `check.yml` on
`main`, read from the Actions API on 6 September:

| | Before | After |
|---|---|---|
| Red runs on `main`, last 40 | **11** | — |
| — of those, failed at the `gates` step | **4** | — |
| Landings with **no verdict at all** | **7** | — |
| `npm run test:fast`, wall clock | **82.77s** | **59.44s** |
| — of which module transform (`collect`) | **64.50s** | **31.48s** |
| Documented commands needing a permission prompt | **4** | **0** |
| Claim refs past the six-hour stale clock | **6 of 8** | reaped at 24h |
| Files a skill named that do not exist | **3** | **0** |
| Hooks firing before or after a tool call | **0** | **2** |

The "after" column for the first three rows is deliberately empty. Those are
rates over a window that has to accumulate, and `npm run scoreboard` is the
thing that will fill them in. Claiming an improvement on the day of the change
would be exactly the habit this log exists to replace.

### What was wrong, in one line each

- **#117** — `AGENTS.md` licensed a push to `main` on `npm run check` being
  green. CI runs three jobs; `check` ran two. Four of the eleven reds failed at
  the third, each after the suite had been green for forty-one minutes.
- **#118** — nothing told an agent a push was unfinished until a verdict came
  back, and a red run and a run that never happened are the same colour in
  every UI. Seven landings went unjudged over sixteen hours.
- **#119** — every invariant was guarded by a test, which is a minute away at
  best and half an hour at worst. Two one-line rules were prose only.
- **#120** — `npm run agents`, the mutex the whole parallel protocol rests on,
  was not among the twenty-five allowed commands. `git fetch` was allowed and
  no write verb was.
- **#121** — a skill told agents to read `CONTEXT.md`, seven times. It is not
  in this repository.
- **#122** — `test:fast` was documented at ~27s against a measured 68.
- **#123** — nothing measured any of the above.
- **#124** — widening a claim's paths silently did nothing, and `check` then
  answered "none overlapping yours".

### What it cost to find out

Four of the eight were found by the tools failing on their own author, which is
worth recording because it is the argument for building them at all:

- `land` refused a push over a stale `node_modules` and reported it as a broken
  test in a file the branch had never touched — the worst-shaped false red
  there is, because it reads as "someone broke `main`".
- `npm run verdict` reported NO VERDICT for its own landing while that run was
  still in progress: "not yet" as "never", which is the same
  two-states-where-there-are-three mistake the issue was written about, made
  inside the fix for it.
- `land` verified a working tree that had been edited while its half-hour suite
  ran, so what it tested was not what it would push.
- `agents -- check` said "none overlapping yours" six minutes before this
  branch edited a file another session held. Both then raised the same constant
  in the same file, and both comments began "RAISED ONCE".

### Isolation off — the one measurement with a prediction attached

`vitest.config.ts` now sets `isolate: false`. The prediction on #122 was that
`collect` would roughly halve; it went 64.50s → 31.48s, and the lane went
82.77s → 59.44s with all 1,717 tests still passing.

The precondition is **invariant 8** — "Id sequences live on
`WorldState.counters`, never at module scope" — so the safety of sharing a
module registry across files holds by rule rather than by luck, and the rule is
years older than the setting. The repository had already paid for the
optimisation and was not collecting it.

**#122's target was under 40s and this does not reach it.** Recorded rather
than quietly dropped: the remaining cost is now the tests themselves rather
than the harness — 135s of CPU across four cores — and getting under 40 means
changing what the suite does, not how it is loaded. That is a different issue
from this one.

### The janitor had been refusing for days

Runs 21 through 23 all failed, on the safety valve, firing on a true positive:

```
decide claude/ai-agent-effectiveness-plan-8pzjrr: MERGED · behind 12 ahead 0
... 9 of 9 ...
REFUSED: 9/9 doomed, over 60%
```

All nine were genuinely merged. The guard was a **share**, and in a repository
that fast-forwards without pull requests every branch that lands ends up
merged, so "nearly all of them are merged" is the normal steady state. A share
ceiling here refuses hardest exactly when it has the most legitimate work to
do — and a guard that always fires is one somebody raises without looking.

It is an absolute count now (25). What it was protecting against was a mass
deletion, and a mass deletion is a number of branches, not a proportion of
them. The shallow-clone refusal is untouched and remains the real defence,
because it removes the condition that produced the false readings instead of
trying to recognise their shape afterwards.

## 2026-10-22 — #1864: documentation audit against shipped main

Baseline: `main` at `098bfe02`. The documentation-only branch also retains
`playerhooks.md` from #1865 and adds its missing README inventory row. No
simulation, authored YAML, schema, dependency, migration or generated-duration
change is part of this audit.

| Documents | Review and disposition |
|---|---|
| Root AGENTS, README, ARCHITECTURE and the seven package AGENTS guides | Correct founding/default identity, catalogue/campaign descriptions, instruction routing, the editor's seventh view, learned Mystic checks, forcing/guards, recasting, ladder evidence, local emergency resolution and the host engineering/release distinction. Mobile's existing boundaries remain current. |
| Concept brief and world bible | Bring the shipped ladder and six-ending/campaign envelope into line with the shared predicates; retain design intent and explicitly separate unbuilt #1866/#1867 work. The world registry now names the Short, Long and demo profiles and player-named founder default. |
| COMMANDS, PARALLEL and PORTABILITY | Keep native queue admission and advisory local preflight distinct. Describe the retained merge-slow inventory, scheduled evidence and actual blocking gate lane; remove a second obsolete stopwatch account from the operating procedure. Shared tools and hook registrations remain the portable path. |
| GAME-LOOP, MODDING and LOCALISATION | Correct founder/guardian continuity, household ladder/Regency reading, final pair coverage and frequency competition; distinguish shipped Original/Plain English modes from a future translated-language contract. Saved rendered prose still stays frozen. |
| Suggestions and TEST-COVERAGE | Label as historical snapshots with their original source/dates. No rerun of those balance or coverage cohorts is implied. Old open-work lists are not today's queue. |
| fullstory, criticalprose, playerhooks and story/Age-1 | Correct the current campaign term, founding path and final reading gates. Distinguish illustrative or earlier authored sequences from the live rendered transcript and emotional intentions from observed player responses. |
| Exploratory story concepts, market research and REGENCY-PACING | Preserve dated/exploratory evidence rather than manufacture current results. The exploratory comparison now makes its old version/millennium framing explicit. The research and pacing reports already identify their source dates/trees. |
| PLAYTEST, store/steam and mobile store drafts/checklist | Human studies remain waived and unrun. Point the runbook at existing packaged proof; preserve the stores' draft/unpublished status and owner/device requirements. No store claim, image, account or publication was changed. |
| MERGE-QUEUE-INCIDENT and append-only BALANCE-LOG / FAILURES / prior AGENT-LOG entries | Retain chronological evidence unchanged. A later audit does not rewrite what an incident or measurement showed at the time. |
| .devcontainer guides, interface patterns, canonical skills and Codex launchers | Existing setup/design boundaries and canonical-manual routing need no implementation update. Launcher parity and the shared instruction budget are covered by the existing Codex checks. |
| Generated VOCABULARY, loci and duration table | Regenerate vocabulary through its command and compare; never hand-edit. No genetics or test-inventory change calls for regenerating the other two. |

The dependency report was re-requested from npm on the unchanged lockfile:
0 high/critical and 13 moderate package rows. DEPENDENCIES records the two
additional Vitest-related rows as new findings awaiting remediation/review,
not as accepted by the older packaging/iOS table. The raw report is
reproducible with `npm audit --json`; it is not a new production release proof.

The first attempted local checks exposed an executor restriction:
`execFileSync` children returned `EPERM` even when Git printed a version.
Running with the executor's additional network permission resolved it; no
repository workaround or disabled test was introduced. The focused docs,
codemap and Codex suites then passed all 85 assertions. Command-cost and
preflight outcomes are recorded in the PR; timing belongs only in the generated
AGENTS command block. The full population/coverage studies were not rerun for
a prose-only change.

## 2026-10-26 — #1931: onboarding and shipped-system documentation

Reviewed against `main` at `8b09dbee`. The README now gives Git/Node/npm
prerequisites, a fresh-clone browser/editor path, separate native-host links,
task-based guide navigation and an executable session/persistence example.
[COMMANDS.md](COMMANDS.md#make-a-contribution) carries the contribution sequence
from issue and claim through commit, preflight and the ready PR. Root AGENTS
routes to the updated architecture map without duplicating its implementation
inventory.

The architecture map now routes founding configuration, civilian/field Mystic
practice, outside contracts, covert operations and outcome-reach evidence to
their owners and existing tests. Its diagram was compared with all 29 entries
in `YEAR_PHASES`, including `mystic`, `covert` and `promises`. The game-loop
guide explains the signing, docket, voluntary ambition and practical learned
magic. The modding guide distinguishes template fire rate, guarded/check
outcome exposure, deterministic reachability and finite-sample proof. The
concept brief's stale §26 claim that recurring practice was unbuilt is
corrected to agree with its already-updated §12.

Validation before preflight: the existing docs, codemap and Codex budget
suites passed all 85 assertions; `npm run gen:docs` left the vocabulary
unchanged. Both documented development servers started concurrently and
served their page and TypeScript entry on ports 5174/5173. The README example
ran directly from its code block and restored the same year and docket ids;
its validated saved state matched immediately after loading. Relative links,
heading targets and named source paths were checked. Preflight results are
recorded in the PR, rather than anticipated here.

**A continuation check exposed an existing bug.** Saving the pending
`the_tutors_good_years` choice on seed 1042 and answering it through the
chronicler repeats that scene at 1044 after reload; uninterrupted play reaches
`the_green_hand` at 1046 instead. [Issue #1932](https://github.com/EldritchDynasty/EldritchDynasty/issues/1932)
retains the executable reproduction. README and ARCHITECTURE now state the
limitation rather than claiming unconditional identical continuation. This
documentation change does not fix that runtime bug.

The baseline's existing CI verdict was red in the editor browser job
([run 40406062800](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/40406062800));
typechecking, content validation and Linux/Windows fast lanes passed there.
No simulation, authored YAML, dependency, workflow, gate threshold or generated
file changed. Historical balance/coverage logs remain intact, and no new
population study or human playtest is claimed.

## 2026-10-27 — #1931: refresh the documentation PR on the repaired save path

Recovered the unchanged documentation branch after its claim passed the
six-hour stale threshold, and rebased it onto `main` at `524ea5fe`. The old
PR passed all twelve game gates; its failed CI result was the runner-class
duration guard repaired on this newer base. The existing PR remains the
single landing unit for #1931.

Removed the living guides' obsolete #1932 repetition caveat. `loadGame` now
reconnects a pending choice to the world's authoritative arc instance, and
the architecture map points to the new fast public-session replay/scenario
coverage as well as the full-run suite. The earlier audit above remains as
the record of what was reproduced before that fix landed.

Executed the README's exact code block on Node v22.23.4: it stops in 1043,
restores that year and the one pending choice, and produces identical complete
canonical state after delegating the docket and advancing five more years.
The additional immediate raw-snapshot comparison found a smaller, separate
normalization defect: schema loading drops `pendingDecisions[0].arcStep.playerCast`
(`[]` in this example). [#1952](https://github.com/EldritchDynasty/EldritchDynasty/issues/1952)
records the reproduction and runtime reconstruction plan. This evidence does
not establish gameplay divergence, and the README example promises the
restored year and docket rather than raw snapshot identity at that boundary.

All **97 relative links and heading targets** in the eight changed Markdown
files resolve. `npm run gen:docs` leaves no vocabulary diff; the updated save
and replay source/test references exist. Final rebased preflight results are
recorded in the PR. This recovery changes documentation only and leaves the
dated audits intact.

## 2026-10-27 — #1931: revalidate after the two runtime fixes landed

Rebased the same documentation branch onto `main` at `1753684b`, which includes
the landed #1930 telemetry correction and #1952 pending-cast reconstruction.
The exact README example now has identical complete canonical snapshots both
immediately after loading and after answering the docket and continuing five
years. The normalization finding in the preceding entry is therefore repaired
on this base; that historical observation is retained.

The previous documentation head's browser CI job never reached the tests:
system-package downloads took 4 minutes 55 seconds, and the five-minute
Chromium-provisioning step timed out during the browser download. Its other
checks passed. This is provisioning evidence, not an application-test failure.
The rebased head goes through the normal checks again, without changing CI
deadlines, assertions or workflows. Final preflight/CI results belong to the
current PR head.

## 2026-10-27 — #1936: advisory verification from the current diff

Added `npm run verify -- --plan [--base <ref>] [--json]`, backed by a pure
`planFor` and the shared `tools/codemap.mjs` architecture-table parser. The
map remains in ARCHITECTURE.md; no second path-to-test inventory was added.
Existing documentation classification was extracted without changing its
results. Recommendations read only `currentTier`, with the existing workflow
reader supplying its script inventory. Required integration CI and scheduled
evidence stay distinct from local iteration commands.

The CLI reads cached local facts, including dirty/untracked changes. It does
not fetch missing history or verdicts, run setup, or repair uncertainty.
Missing bases, shallow clones, unresolved routes, renames, deletions, shared
spines and package boundaries recommend full preflight. Explicit `--run`
uses the shared portable npm launcher, reports actual exit statuses and stops
after failure. `land --dry-run` prints the advisory plan without changing the
landing's verification policy or exit contract.

Focused verification passed 219 tests across the planner, codemap, landing
and portability suites; core typechecking passed. Fixtures record actual
recent main diffs for core reach, YAML content, client, schema and docs; their
cached-verdict scenarios are explicit test inputs, not historical CI claims.
Temporary-checkout tests establish unchanged files and metadata during
planning, credential-free operation, missing-base/shallow handling and a real
npm exit status of 7 without running later commands. Every architecture map
path and guard resolves, including ambiguous basenames resolved within the
source package. Manual `land --dry-run` prints both its unchanged preflight
policy and the advisory plan. No required check, threshold, proof-reuse rule,
merge-queue rule or workflow changed. Final rebased preflight and CI results
belong to the PR head.

### #1936 preflight follow-up — keep map verification together

The first full fast preflight passed 6,109 tests and failed the duration
inventory check: a ninth unmeasured file exceeded its existing allowance of
eight. The new planner cases now live in the existing codemap suite, alongside
the source map they exercise. All 219 focused assertions remain, passing in
three suites. No duration figure was invented, and the measurement budget and
shard-balance limits are unchanged. The earlier four-suite focused result
records the original layout; this is its final ownership layout. The rebased
preflight is rerun with the same substantive cases.
