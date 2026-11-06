# Merge queue throughput evidence (#2794)

## Post-change gate-proof reuse: 20 observed merge groups (7 November 2026; #3183)

**Window and selection.** On 7 November 2026 UTC, inspect the closed half-open
interval **2026-11-06 19:00:00Z (included) to 2026-11-06 23:00:00Z (excluded)**.
The GitHub Actions API returned **20** `merge_group` workflow runs named
`check` in this four-hour window. All 20 had `status=completed` and
`conclusion=success`. Each had an `attempt=1` `gates (batch)` job with
`status=completed` and `conclusion=success`; its decoded job log had 12
individual gate-planner decision lines. This is an observed post-change sample,
**not** a seven-day or complete 24-hour acceptance cohort.

**Planner evidence.** Count only the timestamped output lines of the form
`<gate>: reuse from run <id>` or `<gate>: run ...` from the gate job.
Ignore echoed source commands, proof-producer messages and the later summary.
Across the 20 successful jobs, **209 of 240 decisions reused a trusted-main
gate proof (87.1%)** and **31 required execution**; the
nearest-rank **median merge-group slot was 10.15 minutes**, calculated from
`updated_at - run_started_at` for each run. The nearest-rank p90 was
**10.67 minutes**. All 20 groups succeeded; this small window has no observed
merge-group failure, but is not a daily failure-rate certificate.

| Merge-group `check` run | Start (UTC, 6 Nov) | Slot minutes | Gate planner reuse / decisions |
|---|---:|---:|---:|
| [42276079064](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42276079064) | 19:02:20 | 10.47 | 12/12 |
| [42277695635](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42277695635) | 19:13:16 | 8.43 | 5/12 |
| [42279006685](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42279006685) | 19:22:10 | 10.47 | 12/12 |
| [42280612092](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42280612092) | 19:33:07 | 16.97 | 0/12 |
| [42283166372](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42283166372) | 19:50:33 | 15.95 | 0/12 |
| [42285550866](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42285550866) | 20:07:00 | 9.78 | 12/12 |
| [42286997854](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42286997854) | 20:16:54 | 7.42 | 12/12 |
| [42288128652](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42288128652) | 20:24:45 | 10.67 | 12/12 |
| [42289701361](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42289701361) | 20:35:52 | 10.65 | 12/12 |
| [42291240782](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42291240782) | 20:46:57 | 10.08 | 12/12 |
| [42292688755](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42292688755) | 20:57:32 | 8.10 | 12/12 |
| [42293904379](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42293904379) | 21:06:06 | 8.27 | 12/12 |
| [42295070827](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42295070827) | 21:14:26 | 8.88 | 12/12 |
| [42296748454](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42296748454) | 21:26:32 | 10.40 | 12/12 |
| [42298250406](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42298250406) | 21:37:25 | 10.25 | 12/12 |
| [42299684266](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42299684266) | 21:48:08 | 9.90 | 12/12 |
| [42302069766](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42302069766) | 22:06:12 | 8.25 | 12/12 |
| [42303680718](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42303680718) | 22:18:27 | 10.35 | 12/12 |
| [42305711504](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42305711504) | 22:34:13 | 10.58 | 12/12 |
| [42307601391](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42307601391) | 22:49:50 | 10.15 | 12/12 |

**How to reproduce and check the boundary.** Page GitHub's
`GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=N`;
select only `name=check` and `created_at` inside the half-open UTC window
above. For each retained run, use
`GET /repos/EldritchDynasty/EldritchDynasty/actions/runs/<run_id>/attempts/1/jobs?per_page=100`
and the matching `gates (batch)` job's
`GET /repos/EldritchDynasty/EldritchDynasty/actions/jobs/<job_id>/logs`.
Verify each run's and gate job's completed/success state and that 12 distinct
planner decisions (reused or run) are observed, not inferred from a green check.
`tools/queue-throughput.mjs --with-proofs --from 2026-11-06T19:00:00Z --to 2026-11-06T23:00:00Z --json`
is the stricter live replay route: it additionally verifies exact-attempt job
identity and the gate inventory at each historical commit. The figures above
are directly counted job-log observations; a full historical-registry replay
was **not** separately executed in this connector session.

**Comparison, not attribution.** The pre-change day-sized baseline in this
document (3 Nov 11:05Z to 4 Nov 11:05Z) recorded **36 reused decisions of
1,152 (3.1%)** across 96 gate jobs, and a **14.38-minute** median across 97
groups. This later 20-group, four-hour sample shows higher observed reuse
(87.1%) and a shorter median (10.15 minutes), but the windows differ in length,
source/content mix, dependency fingerprints, host variation and queue load.
It neither isolates the effect of #2825 nor establishes sustained throughput
or that arrivals are below landings; do not extrapolate these percentages to
the full day.

The observation advances the parent #2794's *before/after proof-reuse*
measurement. It does **not** satisfy the required real seven-day
duration-budget window, sustained arrival/landing balance, any remaining
failure-cause investigation, or the owner's concurrency decision. Keep
#2794 open; no queue setting is changed here.

## Reproduce gate-proof reuse (#3148)

Add `--with-proofs` to inspect the actual planner decisions alongside the
selected merge-group cohort. `--with-prs` can be combined with it:

    GITHUB_TOKEN=... node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-07T01:36:17Z --with-proofs --with-prs --save-proofs proofs.json --json

This pages jobs for each run's **exact attempt**, checks the job's run, commit
and attempt, and reads `BLOCKING_GATE_IDS` from the registry at that commit.
It requires successful planner and gate steps before counting the planner's
`run` / `reuse from run` output. Echoed command source and the later producer's
`reusable` / `non-reusable` messages are excluded. Unknown syntax, incomplete
inventories and duplicate decisions remain unknown observations; API failures
or truncated job pagination stop the command. There is no copied gate list or
assumed twelve-gate denominator.

The report retains every selected workflow group, including a group without
a gate job. It shows known/unknown groups, per-run and per-job identifiers,
observed judged/reused/executed decisions, and the source run IDs for reuse.
Here **executed** means a planner `run` decision followed by a successful gate
step, not a fresh measurement of a gate's runtime. A complete-cohort percentage
is withheld unless the API window is finished and every selected group has
verified observations. Failed or interrupted planner/gate steps cannot supply
an applied reuse decision. An empty cohort supplies no reuse rate.

`--save-proofs FILE` preserves the decoded logs, job metadata and historical
gate inventories for inspection. Retain the selected Actions run snapshot as
well; replay both without credentials:

    node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-07T01:36:17Z --runs check-runs.json --proofs proofs.json --json

Offline snapshots are always labelled unverified and never receive a
complete-cohort percentage. The reporter observes the planner; it does not
independently certify gate proofs or change CI's trust boundary. Reuse is
distinct from workflow success and actual PR landing. This mechanism makes
the before/after calculation repeatable; it does not establish the full-day
or seven-day acceptance windows in #2794 or authorize a concurrency change.

## Reproduce actual PR arrival and landing rates

The read-only reporter now has an **opt-in PR-flow cohort** in addition to
merge-group timings. A green merge-group check does not prove the PR merged;
the PR cohort counts GitHub's actual merged_at timestamps. For example:

    GITHUB_TOKEN=... node tools/queue-throughput.mjs --from 2026-11-06T00:00:00Z --to 2026-11-07T00:00:00Z --with-prs
    GITHUB_TOKEN=... node tools/queue-throughput.mjs --from 2026-11-06T00:00:00Z --to 2026-11-07T00:00:00Z --with-prs --json
    node tools/queue-throughput.mjs --from 2026-11-06T00:00:00Z --to 2026-11-07T00:00:00Z --runs check-runs.json --prs all-prs.json

The live PR query paginates **every** open and closed PR targeting main; it does
not stop at the window's beginning because an older PR can land inside the
window. Missing credentials, API failures or histories exceeding the page cap
fail closed. Local snapshots are marked unverified, and future or unfinished
windows are not complete cohort receipts.

The output separates created PRs, actually merged PRs, closed-unmerged PRs,
and an approximate open-PR count at the beginning/end. Those are not counts
of **ready** PRs or native merge-queue entries: GitHub's current PR REST
snapshot does not reconstruct earlier draft/ready changes or reopen history.
The window's PR arrivals and actual landings per hour help assess the rate
question in #2794, but should be interpreted alongside exact-head CI and the
merge-group cohort. The tool does not change queue settings or imply a
performance improvement merely because it produces a number.



## Conservative seven-day duration-budget evidence (#3180)

A closed seven-day window can **prove the absence of** `lanes.test.ts`
duration-budget failures without needing to diagnose individual jobs, but only
when every merge-group `check` succeeded. Run the reporter with a *live*
GitHub token and exactly seven consecutive 24-hour segments, for example:

```bash
GITHUB_TOKEN=... node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-13T01:36:17Z --json
```

The JSON field `sevenDayNoBudgetFailuresProved` is `true` only when the
window has closed, the API cohort is complete, there are no pending runs, each
of the seven consecutive 24-hour segments has at least one group, and **all**
those groups concluded `success`. The array `sevenDayGroupCounts` shows
activity in each segment. A successful required merge-group `check` cannot
contain a failing budget test; this is a **sufficient**, deliberately
conservative certificate, not a way to classify failed jobs.

For a shorter window, an unverified offline snapshot, an empty day, a failure,
cancellation or missing result, the value is `null` / **not established**.
In particular, `null` must **not** be read as a confirmed duration-budget
failure: a red group could have failed anywhere, and diagnosing a budget
failure requires inspecting its fast-lane job logs. This report does not
certify proof reuse, historical ready-queue depth, PR landings or throughput,
and it never changes the queue concurrency.

This is a reporting capability, **not** a seven-day acceptance observation.
No seven-day cohort was completed as part of this change. Keep parent #2794
open until the actual closed-window evidence and other acceptance criteria
are documented.

## Completed 24-hour queue-flow snapshot (6 November 2026; #3158)

This is a **separate rolling cohort**, not the next adjacent window in the
comparison below. It covers the half-open UTC interval
**2026-11-05 19:00:00 (included) to 2026-11-06 19:00:00 (excluded)**.
It overlaps the existing 5 November 12:45 → 6 November 12:45 cohort; do
not add their totals together or treat them as two independent days.

At collection, GitHub Actions returned every `check` workflow run with
`event=merge_group` and `created_at` in the interval. All 81 selected
runs had finished and **all 81 succeeded** (0 failed, 0 cancelled).
For completed runs, slot duration is `updated_at - run_started_at`;
the nearest-rank median was **10.12 minutes** and p90 **15.75 minutes**.
The first and last selected runs were
[42090811736](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42090811736)
and [42274486258](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42274486258).

Separately, GitHub's PR search by **creation timestamp** counted **81 new
PRs**, and search by actual **merged timestamp** counted **80 merged PRs**
targeting this repository in the same window. The REST PR snapshots independently
agreed with those counts. That is **3.38 arrivals/hour** against
**3.33 actual landings/hour**, a net gap of one PR in this window.
Merge-group success alone is not counted as a landed PR. Search queries
for rechecking the independently timed counters:

```text
repo:EldritchDynasty/EldritchDynasty is:pr created:2026-11-05T19:00:00Z..2026-11-06T19:00:00Z
repo:EldritchDynasty/EldritchDynasty is:pr is:merged merged:2026-11-05T19:00:00Z..2026-11-06T19:00:00Z
```

For the run sample, page GitHub's
`GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=N`,
filter to `name=check` and the half-open `created_at` interval, retain
completed status/conclusion, and calculate slot minutes from the two run
timestamps (nearest-rank quantiles). The existing reporter can also be
run live with:

```bash
GITHUB_TOKEN=... node tools/queue-throughput.mjs --from 2026-11-05T19:00:00Z --to 2026-11-06T19:00:00Z --with-prs --json
```

This observational result is consistent with fewer wasted integration slots
than the earlier 3–4 November baseline, but source mix, concurrent work,
proof eligibility and runner variance are uncontrolled. It does **not**
measure applied gate-proof reuse, reconstruct historical ready-queue depth,
complete the seven-day zero-duration-budget-failure check, prove a sustained
arrival/landing balance, or authorize changing build concurrency. Keep parent
#2794 open until its remaining acceptance evidence and owner decision exist.

## Follow-up: adjacent 24-hour merge-group windows (6 November 2026)

The early baseline below predates the proof-reuse/intake changes. For a nearer
post-change comparison, GitHub's Actions run API was sampled on 6 November
at about 13:01 UTC, using
`GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=N`
(pages 1–3). Select only `check` workflow runs with
`event=merge_group` and `created_at` in the half-open UTC windows below.
All selected runs had completed. Slot minutes are
`updated_at - run_started_at`; median and p90 use the lower-ranked observation
for even populations. The source run IDs make the two cohorts auditable.

| UTC start (inclusive) → end (exclusive) | Completed groups | Successful | Failed | Median slot | p90 slot |
|---|---:|---:|---:|---:|---:|
| 4 Nov 12:45 → 5 Nov 12:45 | 73 | 70 | 3 (4.1%) | 15.23 min | 17.78 min |
| 5 Nov 12:45 → 6 Nov 12:45 | 69 | 69 | 0 (0%) | 10.07 min | 15.10 min |

Sources for the first cohort range from
[41834935338](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41834935338)
to [42013855690](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42013855690);
failed runs were
[41848493899](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41848493899),
[41858410104](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41858410104)
and [41868605285](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41868605285).
The second cohort ranges from
[42032459983](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42032459983)
to [42218895809](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42218895809).

The observed median slot fell about **5.17 minutes (34%)** and no merge-group
failure appeared in the later complete cohort. **This is observational, not
causal**: different code/content mixes, runner variation, proof eligibility
and a changing queue all affect slot length. The later window also completed
**four fewer groups** (69 vs 73), so a shorter median does **not** establish
higher total landing throughput. These 48 hours do not satisfy the planned
seven-day arrival/land/failure budget or isolate the proof-reuse rate, and
must not be used to justify relaxing build concurrency. Keep #2794 open until
the planned longer-window assessment and acceptance are complete.

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

### Second post-cutover observation (9 groups)

Collected on **6 November 2026 after 06:01 UTC**, from the
[merge-group `check` workflow runs](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml)
and the `gates (batch)` job logs. These six completed runs extend, rather
than replace, the first three post-cutover observations above. The selection
still begins **after PR #2825 merged at 01:36:17 UTC**; it does not count
the 69-run pre-change control as an improvement.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42156657912](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42156657912) | 03:27:24 | 10.03 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42156657912/job/127692358865) |
| [42157836756](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42157836756) | 03:39:09 | 7.98 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42157836756/job/127696174661) |
| [42163732690](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42163732690) | 04:38:48 | 10.15 | success | [5 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42163732690/job/127715250634) |
| [42165371334](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42165371334) | 04:55:50 | 10.17 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42165371334/job/127720530209) |
| [42167307456](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42167307456) | 05:15:11 | 17.27 | success | [0 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42167307456/job/127726715835) |
| [42170345139](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42170345139) | 05:46:00 | 15.85 | success | [0 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42170345139/job/127736480358) |

**Cumulative post-cutover evidence (9 completed groups):** 9 successes,
0 failures (0% observed); median **10.08 minutes**, measured consistently
from `run_started_at` to `updated_at`; **63 / 108 trusted gate-proof
decisions reused (58.3%)**. The six new groups contributed **41 / 72**;
the preceding three contributed **22 / 36**. The two new zero-reuse
groups took 17.27 and 15.85 minutes, while the fully reused groups took
10.03, 7.98 and 10.17 minutes. That association illustrates why the
proof mechanism matters, but it does not prove all slot variation has a
single cause.

**Acceptance is still pending.** Nine groups are short of the required
20-group proof/slot comparison and 30-group day; this is also not seven
consecutive days of duration-budget evidence or an arrivals-versus-landings
working-day sample. The pre-cutover day already had 0/69 failures, so the
post-cutover 0/9 cannot establish an improvement in failure rate. Keep
build concurrency unchanged while gathering the full denominators.

### Third post-cutover observation (12 completed groups)

Collected on **6 November 2026 after 06:50 UTC** from the same
[merge-group `check` workflow](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml).
The next three runs after the nine-group observation all finished successfully.
Their trusted-proof counts come from their actual `gates (batch)` job logs,
not an estimate based on runtime.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42173359961](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42173359961) | 06:16:09 | 9.93 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42173359961/job/127746162754) |
| [42174452516](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42174452516) | 06:26:33 | 9.78 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42174452516/job/127749625645) |
| [42176107270](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42176107270) | 06:42:07 | 8.38 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42176107270/job/127754883893) |

**Cumulative post-cutover (12 groups):** 12 successes, 0 failures;
median slot **9.98 minutes**, measured from `run_started_at` to `updated_at`;
**99 / 144 trusted proof decisions reused (68.75%)**. The 3 added
groups contribute 36 / 36, on top of the prior 63 / 108. The last
group's gate-duration log explicitly marks its proof-only 0/0 execution
as *not* a full-batch timing comparison; do not substitute it for a
measured gate batch.

This is still a **descriptive sample below acceptance thresholds**, not
proof of a throughput or failure-rate improvement: the fresh pre-cutover
control was already 0/69 failures, only 12 of 20 required post-change
groups have completed, and the 30-group day, seven-day budget streak,
and arrivals-versus-landings comparison remain unmeasured. Keep merge
queue build concurrency unchanged pending those checks.

### Fourth post-cutover observation (17 groups)

Collected **6 November 2026 after 07:49 UTC** from the
[merge-group `check` workflow](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml).
Five additional completed `merge_group` runs extend the prior twelve-run
sample. As before, the cutover is PR #2825's actual landing at
**01:36:17 UTC**; a queued or unfinished run is not a success or part of
the denominator. Duration is `updated_at - run_started_at`, not runner
execution time; gate counts are read from each `gates (batch)` job's
printed reuse plan, not inferred from a fast slot.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42177170788](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42177170788) | 06:52:12 | 9.98 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42177170788/job/127758238817) |
| [42178266561](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42178266561) | 07:02:39 | 10.25 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42178266561/job/127761718493) |
| [42180092371](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42180092371) | 07:19:18 | 9.93 | success | [5 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42180092371/job/127767511769) |
| [42181195299](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42181195299) | 07:29:24 | 10.47 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42181195299/job/127771027487) |
| [42182499545](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42182499545) | 07:41:14 | 8.27 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42182499545/job/127775161569) |

**Cumulative post-cutover: 17 completed groups, 17 successful, 0 failed;**
median slot **9.98 minutes**, **152 / 204 (74.5%)** trusted gate-proof
decisions reused. These five groups contributed 53 / 60; the previous
twelve contributed 99 / 144. The source-window baseline above was 14.38
minutes and 3.13% reuse; the *immediately preceding* 24-hour control was
already 0 / 69 failures and 12.20 minutes median, so do not claim a
failure-rate improvement or a causal speedup from this selective early
post-cutover sample. Proof-only 0/0 gate executions are not full-batch
duration comparisons.

**Still below acceptance:** 17 is fewer than 20 post-change groups
for the slot/proof comparison and fewer than 30 groups in a day for the
failure-rate condition. The seven-day unmeasured-file budget, working-day
arrival-vs-landing balance, and owner decision on increased concurrency
also remain unverified. Keep build concurrency unchanged.

### Fifth post-cutover observation: 20 completed groups (initial comparison threshold)

Collected **6 November 2026 after 08:47 UTC**, using the same fixed
post-#2825 selection and measurement definitions as the first four observations.
The native merge-group `check` runs below extend the earlier 17, not a new
or cherry-picked cohort. All three final conclusions are successful; each
`gates (batch)` job independently printed twelve reused trusted proofs.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42185536846](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42185536846) | 08:08:20 | 11.47 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42185536846/job/127784918975) |
| [42186941116](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42186941116) | 08:20:15 | 8.23 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42186941116/job/127789494760) |
| [42189479409](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42189479409) | 08:41:26 | 5.90 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42189479409/job/127797735249) |

**Fixed post-cutover cohort (20 completed groups):** **20 successful / 0
failed**, median **9.96 minutes** from `run_started_at` to `updated_at`,
and **188 / 240 (78.3%)** trusted gate-proof decisions reused. This meets
the issue's *20-group descriptive slot/proof comparison* denominator.

For context, the original day-sized baseline measured **14.38 minutes** median
and **36 / 1152 (3.13%)** proof reuse. The immediately preceding 24-hour
control instead measured **12.20 minutes** median and **0 / 69 failures**.
The post-cutover sample spans only about seven hours and a shifting PR mix;
it is not an equivalent randomized or day-long comparison. It is consistent
with more reuse and shorter observed slots but does not prove causality, a
failure-rate improvement or durable arrival/landing equilibrium. In particular,
0/20 failures must not be described as an improvement over 0/69. Do not use
proof-only 0/0 gate execution times as full-gate benchmarking.

**Still open:** the 30-group/day under-5%-failure condition, seven consecutive
days free of the unmeasured-test-file budget failure, and the working-day
arrival-versus-landing/backlog assessment. No evidence here authorizes raising
merge-queue concurrency.

## Follow-up after landing

The implementation publishes merge-group proofs, but consumers accept them only
after whole-run success and independent full-history main-ancestry verification.
It also opens measured duration refresh PRs at five unmeasured files while
retaining the eight-file guard, and brakes new ordinary code claims at ten ready
PRs. The repair PR shares the normal CI and merge queue requirements.

The 20-group slot/proof comparison above is now measured, with linked
gate-reuse decisions and the fixed cutover. The following acceptance evidence
is still pending and keeps #2794 open:
- A day with at least 30 groups and a failure rate below 5%.
- Seven consecutive days without an unmeasured-file-budget merge-group failure.
- A working day with landings keeping up with arrivals and a falling ready backlog.

Build concurrency remains at its existing setting. Slice 5 requires measured
improvement from slices 2–4 first; the 20-group descriptive sample does not replace the 30-group day, seven-day budget streak, workload-capacity verification, or owner approval.
Before increasing it, confirm the account's concurrent-job allowance against
GitHub's current plan documentation and record the actual ruleset change in
COMMANDS.md. No concurrency or rate improvement is claimed in advance.


### Sixth post-cutover observation: 22 completed groups and a bounded flow check

Collected **6 November 2026 after 09:27 UTC**, extending the same fixed
post-[#2825](https://github.com/EldritchDynasty/EldritchDynasty/pull/2825)
cutover cohort (01:36:17 UTC). Neither row below was counted in the fifth
observation; both check.yml merge-group runs completed successfully. The
gate-proof decisions come from the gates (batch) job's actual planner log,
not a duration-based inference.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42191598170](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42191598170) | 08:59:10 | 9.57 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42191598170/job/127804788040) |
| [42193017150](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42193017150) | 09:10:27 | 10.83 | success | [0 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42193017150/job/127809435545) |

**Cumulative fixed post-cutover cohort: 22/22 successful groups (0
observed failures), median slot 9.96 minutes and 200/264 (75.8%)
trusted gate-proof decisions reused.** Duration is again GitHub's
updated_at minus run_started_at, not the gate job's execution time.
The two additions contribute 12/24 reused decisions. The second job
explicitly reported no matching trusted main proof among 60 candidate
runs and executed all twelve gates in about nine minutes; this is not
evidence that the proof-consumer bypassed validation or that any single
cause explains the fingerprint misses.

#### Bounded arrivals-versus-landings observation (not a full-day result)

For the half-open window **(2026-11-06 01:36:17 UTC,
2026-11-06 09:21:43 UTC]**, immediately after #2825's merge through
the last completed merge in the observed cohort (**7 h 45 m 26 s**),
GitHub's PR metadata records:

- **22 new PRs opened and 22 PRs merged**, or approximately **2.84/h**
  in each direction. These counts use PR created_at and merged_at,
  including merges of PRs opened before this window; the cutover PR
  itself is excluded from the landing count.
- One additional PR, [#3069](https://github.com/EldritchDynasty/EldritchDynasty/pull/3069),
  was closed without merging. It is not counted as a landing.
- The number of **open PRs** declined from **3 at the start** (#3060,
  #3061, #3062) to **2 at the end** (#3085, #3090), reconstructed from
  PR creation and closing timestamps. This is an *open-PR* count, not
  a reconstructed *ready queue* count: historical draft and queue
  transitions were not established.
- Source: GitHub
  [PR collection](https://github.com/EldritchDynasty/EldritchDynasty/pulls?q=is%3Apr),
  inspected via the REST pulls collection with state=all, creation
  descending and 100 results, alongside the closed/updated collection.
  The oldest returned creation was 4 November 16:11 UTC;
  the closed/updated collection covered the entire target interval.
  The [merge-group run collection](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml)
  was filtered to event=merge_group and completed check runs.

This bounded observation shows arrivals matching landings *during this
window* and an open-PR count falling by one. It does not establish the
issue's full **working-day ready-backlog** criterion, nor can the small
0/22 failure sample establish an improvement over the immediately
preceding **0/69** pre-cutover control. The original **14/97**
day-sized baseline is a different cohort and workload. The required
30-group day below 5% failure and seven consecutive days without a
duration-budget merge-group failure remain unmeasured. Do not change
build concurrency on this preliminary evidence alone.


### Seventh post-cutover observation: 29 completed groups (7 more)

Collected on **6 November 2026 after 11:19 UTC** for child #3103 of #2794.
This extends the *same* fixed cohort whose cutover is #2825's merge at
**2026-11-06 01:36:17 UTC**. The seven subsequent, completed
`check.yml` `merge_group` runs are shown in creation order; none appears
in the preceding 22-group observation. Each has a successful terminal
workflow conclusion. Run durations are GitHub `updated_at - run_started_at`;
proof counts were read from each job's **planner decisions** (`reuse from run`
versus `run — no matching trusted main proof`), *not* from the separate
proof-production trace's `reusable` lines.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42195495034](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42195495034) | 09:29:58 | 10.43 | success | [5 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42195495034/job/127817703791) |
| [42196815353](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42196815353) | 09:40:59 | 7.92 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42196815353/job/127822143858) |
| [42198632580](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42198632580) | 09:55:04 | 6.97 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42198632580/job/127828151438) |
| [42200917200](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42200917200) | 10:12:48 | 9.50 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42200917200/job/127835766863) |
| [42203127448](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42203127448) | 10:30:02 | 9.93 | success | [5 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42203127448/job/127843174180) |
| [42204491034](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42204491034) | 10:40:42 | 8.12 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42204491034/job/127847680137) |
| [42206473802](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42206473802) | 10:56:35 | 10.72 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42206473802/job/127854468387) |

**Cumulative post-cutover cohort: 29/29 successful groups, 0 failures,
9.93-minute median slot, and 270/348 (77.6%) trusted gate-proof decisions
reused.** These seven new groups added **70/84** reuse decisions to the
previous 200/264. The latest seven group durations were 10.43, 7.92, 6.97,
9.50, 9.93, 8.12 and 10.72 minutes. This is a *descriptive* cohort:
more reuse does not establish causation of every time difference, and a
proof-only 0/0 gate execution must not be treated as full-gate timing.

**Acceptance remains open.** The elapsed post-cutover observation is under
one full day, and 29 is one short of the issue's 30-group/day condition.
The immediately preceding 24-hour pre-cutover control already had **0/69**
failures; therefore the post-cutover 0/29 is **not** evidence of a failure-rate
improvement. A seven-consecutive-day absence of unmeasured-duration budget
failures has not yet elapsed. Earlier bounded arrivals/landings also do not
establish a full working-day *ready-backlog* decrease. No queue concurrency
change or owner approval is implied.


### Eighth post-cutover observation: 32 completed groups

Collected **6 November 2026 after 12:00 UTC** from GitHub's
[`check.yml` merge-group run collection](https://github.com/EldritchDynasty/EldritchDynasty/actions/workflows/check.yml),
using the original fixed cutover at **2026-11-06 01:36:17 UTC** when
[#2825](https://github.com/EldritchDynasty/EldritchDynasty/pull/2825) merged.
The query selected completed `check` runs with `event=merge_group`, ordered
by `created_at` across two pages. The previous 29 completed groups are
unchanged; these are the next **three**. Proof counts are the twelve planner
decisions in the `gates (batch)` job logs, not the later proof-publication
trace or an inference from duration.

| Run (Actions) | Started UTC | Slot (min) | Result | Trusted gates reused / judged |
|---|---|---:|---|---:|
| [42208785697](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42208785697) | 11:14:39 | 8.20 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42208785697/job/127862045143) |
| [42210555232](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42210555232) | 11:28:53 | 8.33 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42210555232/job/127867921401) |
| [42213256994](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42213256994) | 11:51:01 | 8.72 | success | [12 / 12](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42213256994/job/127876906771) |

**Cumulative fixed post-cutover cohort: 32/32 successful merge-group
checks, 0 failures; median slot 9.88 minutes; 306 / 384 (79.7%) trusted
gate-proof decisions reused.** The new groups contributed 36 / 36 reuse
decisions, up from 270 / 348 after 29 groups. Median uses the full 32-run
ordered sample, with slot duration calculated as GitHub `updated_at -
run_started_at`. The first group's start was 01:36:19 UTC and the latest
completion was 11:59:44 UTC: **10 h 23 m 25 s**, not a complete day.
All three new jobs executed zero local gates (proof-only 0/0); their 2–3 s
gate-duration logs must not be misreported as full-batch execution times.

The sample now exceeds the **30-group count** in #2794 but **not its
day-sized observation requirement**. The preceding 24-hour control already
recorded **0/69 failures**; this cohort's 0/32 therefore cannot establish a
failure-rate improvement. Nor does it supply seven consecutive days without
duration-budget failures, a working-day *ready-queue* backlog trend, or
evidence for raising concurrency. Continue the fixed-cutover observation
without resetting its denominator or making causal claims from the shifting
PR mix.
