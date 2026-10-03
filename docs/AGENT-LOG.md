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

---

## 2026-10-03 — #353 queue occupancy baseline before #424

#424 isolates one queue-throughput variable: after the serialized landing has
rebased, run the authoritative set, and pushed the exact checked head, should it
keep holding the queue while the ordinary push-triggered verdict rechecks that
same tree?

Live PR #418 landing run `37095188185` provides the before measurement:

| Measure | Before #424 | After #424 |
|---|---:|---:|
| Serialized land job started | 04:07:03Z | — |
| Authoritative check/push step | **2h 12m 13s** (04:07:09Z → 06:19:22Z) | — |
| Post-push verdict wait began | **06:19:22Z** | — |
| Normal push-triggered check began | **06:19:23Z** | — |
| Queue slot released after push | **No** — it remained occupied by the verdict wait | — |

The deploy-key push had already emitted the ordinary `push` event: `check.yml`,
`verdict.yml`, and `janitor.yml` were running independently while the serialized
landing still held its concurrency slot. That is the duplicate occupancy #424
removes; it does **not** remove the normal post-push health verdict.

The after column stays empty until a real landing runs through #424's shipped
workflow. A successful workflow-source test is not timing evidence, and a push
reported as successful is not retroactively called green before the asynchronous
verdict exists.

