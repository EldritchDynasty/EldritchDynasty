# Merge queue throughput evidence (#2794)

## Before the fresher-proof change

Collected on 4 November 2026 through GitHub's workflow-run, job and decoded
job-log APIs. The window selects check.yml merge-group runs starting from
3 November 11:05 UTC through 4 November 11:05 UTC; their final updates extend
to 11:19 UTC. Each run ID below links to the source evidence.

- 97 groups; 14 failed (14.4%).
- Median slot: 14.38 minutes, measured from run_started_at to updated_at.
- 96 gate jobs logged 36 reused proofs of 1152 decisions (3.13%).
- One group failed before a gate job existed. It remains in the slot/failure denominator.

The reuse decisions are the gate planner's log output used to write each
"Trusted gate-proof reuse" step summary. This day-sized sample supports the
low-reuse hypothesis in #2794; it does not prove that every miss was caused by
producer lag. Dependency changes and different runner images also invalidate
fingerprints. Every sampled gate-duration line reported a 4-CPU host.

| Run | Slot (minutes) | Result | Proofs reused / judged |
|---|---:|---|---:|
| [41624842875](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41624842875) | 13.70 | success | 0 / 12 |
| [41626812420](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41626812420) | 10.52 | success | 0 / 12 |
| [41629801796](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41629801796) | 10.03 | success | 12 / 12 |
| [41631202786](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41631202786) | 6.88 | success | 12 / 12 |
| [41632196187](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41632196187) | 9.68 | success | 12 / 12 |
| [41635157692](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41635157692) | 14.38 | success | 0 / 12 |
| [41637443138](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41637443138) | 12.43 | success | 0 / 12 |
| [41639251154](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41639251154) | 10.58 | failure | 0 / 12 |
| [41640760077](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41640760077) | 17.57 | success | 0 / 12 |
| [41643437920](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41643437920) | 11.03 | success | 0 / 12 |
| [41645132322](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41645132322) | 16.45 | success | 0 / 12 |
| [41647682996](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41647682996) | 12.97 | failure | 0 / 12 |
| [41649746867](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41649746867) | 12.62 | success | 0 / 12 |
| [41651846119](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41651846119) | 11.02 | success | 0 / 12 |
| [41653733917](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41653733917) | 12.77 | success | 0 / 12 |
| [41655922832](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41655922832) | 9.83 | success | 0 / 12 |
| [41657628641](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41657628641) | 12.25 | success | 0 / 12 |
| [41659789572](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41659789572) | 16.52 | success | 0 / 12 |
| [41662924896](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41662924896) | 16.90 | success | 0 / 12 |
| [41665947287](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41665947287) | 10.23 | failure | 0 / 12 |
| [41667721969](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41667721969) | 12.75 | success | 0 / 12 |
| [41669929610](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41669929610) | 15.47 | success | 0 / 12 |
| [41672704527](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41672704527) | 16.78 | success | 0 / 12 |
| [41675668410](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41675668410) | 17.27 | success | 0 / 12 |
| [41678639959](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41678639959) | 13.23 | success | 0 / 12 |
| [41680929945](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41680929945) | 15.45 | success | 0 / 12 |
| [41683594292](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41683594292) | 12.22 | success | 0 / 12 |
| [41685647267](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41685647267) | 11.85 | success | 0 / 12 |
| [41687604219](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41687604219) | 10.45 | success | 0 / 12 |
| [41689247551](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41689247551) | 15.80 | success | 0 / 12 |
| [41691832710](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41691832710) | 13.65 | success | 0 / 12 |
| [41694124389](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41694124389) | 13.95 | failure | 0 / 12 |
| [41696398713](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41696398713) | 10.65 | success | 0 / 12 |
| [41698100443](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41698100443) | 16.78 | success | 0 / 12 |
| [41700823656](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41700823656) | 16.63 | success | 0 / 12 |
| [41703488190](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41703488190) | 11.88 | success | 0 / 12 |
| [41705419781](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41705419781) | 17.02 | success | 0 / 12 |
| [41708110612](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41708110612) | 16.35 | failure | 0 / 12 |
| [41710710832](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41710710832) | 17.57 | success | 0 / 12 |
| [41713496155](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41713496155) | 17.10 | success | 0 / 12 |
| [41716180997](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41716180997) | 17.25 | success | 0 / 12 |
| [41718925084](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41718925084) | 12.77 | success | 0 / 12 |
| [41720974181](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41720974181) | 13.22 | success | 0 / 12 |
| [41723055443](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41723055443) | 10.85 | success | 0 / 12 |
| [41724699065](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41724699065) | 16.07 | success | 0 / 12 |
| [41727165463](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41727165463) | 16.57 | failure | 0 / 12 |
| [41729755517](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41729755517) | 11.78 | failure | 0 / 12 |
| [41731545768](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41731545768) | 17.20 | failure | 0 / 12 |
| [41734012830](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41734012830) | 9.35 | success | 0 / 12 |
| [41735358006](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41735358006) | 16.45 | success | 0 / 12 |
| [41737713722](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41737713722) | 16.97 | success | 0 / 12 |
| [41740040900](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41740040900) | 10.55 | success | 0 / 12 |
| [41741426692](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41741426692) | 16.68 | success | 0 / 12 |
| [41743594384](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41743594384) | 16.82 | success | 0 / 12 |
| [41745798084](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41745798084) | 10.27 | failure | 0 / 12 |
| [41747134601](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41747134601) | 12.73 | success | 0 / 12 |
| [41748785493](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41748785493) | 16.53 | success | 0 / 12 |
| [41750824971](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41750824971) | 16.13 | success | 0 / 12 |
| [41752829168](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41752829168) | 10.05 | success | 0 / 12 |
| [41754030996](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41754030996) | 16.97 | success | 0 / 12 |
| [41756004103](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41756004103) | 10.52 | success | 0 / 12 |
| [41757198357](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41757198357) | 16.68 | success | 0 / 12 |
| [41759102107](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41759102107) | 16.07 | success | 0 / 12 |
| [41760928757](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41760928757) | 16.97 | success | 0 / 12 |
| [41762803587](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41762803587) | 11.05 | failure | 0 / 12 |
| [41763989454](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41763989454) | 13.72 | success | 0 / 12 |
| [41765513142](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41765513142) | 16.68 | success | 0 / 12 |
| [41767320726](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41767320726) | 16.52 | failure | 0 / 12 |
| [41769041922](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41769041922) | 9.88 | success | 0 / 12 |
| [41770040949](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41770040949) | 16.85 | success | 0 / 12 |
| [41771799515](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41771799515) | 16.75 | success | 0 / 12 |
| [41773541888](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41773541888) | 16.52 | success | 0 / 12 |
| [41775246546](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41775246546) | 12.83 | success | 0 / 12 |
| [41776531871](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41776531871) | 16.92 | success | 0 / 12 |
| [41778353923](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41778353923) | 15.68 | success | 0 / 12 |
| [41779996094](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41779996094) | 13.32 | failure | 0 / 12 |
| [41781391843](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41781391843) | 13.48 | success | 0 / 12 |
| [41782799324](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41782799324) | 18.05 | success | 0 / 12 |
| [41784795846](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41784795846) | 18.15 | success | 0 / 12 |
| [41786866756](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41786866756) | 12.20 | success | 0 / 12 |
| [41788262465](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41788262465) | 11.55 | success | 0 / 12 |
| [41789546715](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41789546715) | 16.08 | success | 0 / 12 |
| [41791455007](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41791455007) | 16.47 | success | 0 / 12 |
| [41793436916](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41793436916) | 18.02 | success | 0 / 12 |
| [41795558471](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41795558471) | 10.58 | success | 0 / 12 |
| [41796892196](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41796892196) | 12.68 | success | 0 / 12 |
| [41798563690](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41798563690) | 17.25 | success | 0 / 12 |
| [41800841778](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41800841778) | 13.03 | success | 0 / 12 |
| [41802566222](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41802566222) | 16.42 | success | 0 / 12 |
| [41804809728](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41804809728) | 17.38 | success | 0 / 12 |
| [41807299625](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41807299625) | 17.35 | success | 0 / 12 |
| [41809454636](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41809454636) | 17.60 | success | 0 / 12 |
| [41811367581](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41811367581) | 13.12 | success | 0 / 12 |
| [41813765362](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41813765362) | 5.65 | failure | — |
| [41814451205](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41814451205) | 18.17 | success | 0 / 12 |
| [41816512130](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41816512130) | 17.37 | success | 0 / 12 |
| [41818476985](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41818476985) | 14.03 | failure | 0 / 12 |

## Cutover check: first proof-reuse evidence (6 November 2026)

PR [#2825](https://github.com/EldritchDynasty/EldritchDynasty/pull/2825)
merged at **2026-11-06 01:36:17 UTC** (`9c4ff14e`). It is the
cutover for the duration-refresh, landed-merge-group-proof and intake-brake
changes. The older baseline above must **not** be compared with a period
which predates this merge and then called a post-change result.

### Fresh pre-cutover control

The preceding fixed 24-hour window, **2026-11-05 01:36:17 to
2026-11-06 01:36:17 UTC**, contains **69 completed merge-group
`check` runs, all successful (0 failures)**. Its median slot was
**12.20 minutes** (range 6.03–18.02), calculated from each run's
`run_started_at` to `updated_at`, the same measure used above.
The last included run was
[42143778776](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42143778776).
The complete result set was selected from
[merge-group Actions runs](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml)
using the GitHub Actions `/actions/runs?event=merge_group&per_page=100&page=1`
API, filtering to workflow `check`, completed runs and the stated
half-open `created_at` window. That page included all 69 runs at
collection time. In particular, the zero-failure result occurred
**before** #2825 landed; do not attribute it to #2825.

### First three post-cutover groups (insufficient for acceptance)

These are the complete finished merge-group `check` runs observed between
the cutover and the 6 November 03:27 UTC collection. Each head is a
descendant of `9c4ff14e` (verified with GitHub commit comparison),
not merely a run created after the merge.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42144943781](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42144943781) | 01:36:19 | 9.82 | success | 5 / 12 |
| [42146053210](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42146053210) | 01:46:36 | 10.08 | success | 12 / 12 |
| [42153716411](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42153716411) | 02:59:12 | 9.50 | success | 5 / 12 |

**Early sample only:** 3/3 groups succeeded; median slot **9.82
minutes**; **22/36 (61.1%)** of the gate planner's per-group decisions
reused a trusted proof. The reuse numerator comes from the actual
`gates (batch)` job logs:
[127654076578](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42144943781/job/127654076578),
[127657747114](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42146053210/job/127657747114),
and [127682840965](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42153716411/job/127682840965).
These plans cite the source run for each reused gate, rather than
inferring reuse from elapsed time. For comparison, the three immediately
preceding gate jobs each planned **0/12** reuse:
[42139818809](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42139818809),
[42140921682](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42140921682),
[42143778776](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42143778776).

**Do not claim an acceptance result yet.** Three post-change groups
are below the required 20-group throughput/proof comparison and the
30-group day, and cannot speak to a seven-day budget streak or
arrival-versus-landing balance. The earlier control was already
0/69 failures, so short-term failure comparisons are especially
confounded. Keep concurrency unchanged and refresh this fixed-cutover
cohort once its required denominators exist.

## Follow-up after landing

The implementation publishes merge-group proofs, but consumers accept them only
after whole-run success and independent full-history main-ancestry verification.
It also opens measured duration refresh PRs at five unmeasured files while
retaining the eight-file guard, and brakes new ordinary code claims at ten ready
PRs. The repair PR shares the normal CI and merge queue requirements.

The following evidence is still pending and keeps #2794 open:

- At least 20 post-change groups: median slot and proof-reuse rate against the
  baseline above. Retained gate-reuse-plan and gate-timings artifacts make the
  source decisions inspectable.
- A day with at least 30 groups and a failure rate below 5%.
- Seven consecutive days without an unmeasured-file-budget merge-group failure.
- A working day with landings keeping up with arrivals and a falling ready backlog.

Build concurrency remains at its existing setting. Slice 5 requires measured
improvement from slices 2–4 first; the initial three-group post-change evidence above is not enough to evaluate that change.
Before increasing it, confirm the account's concurrent-job allowance against
GitHub's current plan documentation and record the actual ruleset change in
COMMANDS.md. No concurrency or rate improvement is claimed in advance.

