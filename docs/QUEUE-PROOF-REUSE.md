# First complete post-cutover day: gate-proof reuse log audit (#3207; parent #2794)

**Child issue [#3207](https://github.com/EldritchDynasty/EldritchDynasty/issues/3207); parent [#2794](https://github.com/EldritchDynasty/EldritchDynasty/issues/2794).**

**Observation, 7 November 2026 UTC.** This is an independent, read-only audit
of the same fixed 24-hour window used by [issue #3203](https://github.com/EldritchDynasty/EldritchDynasty/issues/3203)
and [PR #3204](https://github.com/EldritchDynasty/EldritchDynasty/pull/3204), not an additional
non-overlapping cohort.

- **Window:** `2026-11-06T01:36:17Z` inclusive to
  `2026-11-07T01:36:17Z` exclusive, exactly one day after #2825's merge cutover.
- **Selection:** GitHub Actions `check` workflow runs with
  `event=merge_group` and `created_at` inside that half-open window.
  `GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=1`
  included all 92 selected runs; the page extended earlier than the lower
  boundary. All **92/92** were completed and successful.
- **Evidence:** inspect the *latest attempt* `gates (batch)` job for each
  selected run and its decoded job log; require a successful gate job. Count
  only timestamp-prefixed, single-gate planner decisions of the form
  `<gate>: reuse from run <id>` and `<gate>: run ...`. Ignore echoed script
  source, later summaries, and proof-production messages. Require twelve
  distinct decisions in each normal planner run.
- **Attempt caveat:** [run 42311086198](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42311086198)
  was on attempt 2; the latest successful attempt's gate job/log, not the
  preceding attempt, is the observation.

## What the jobs actually did

| Cohort | Runs | Reused gate opportunities | Executed gate opportunities |
|---|---:|---:|---:|
| Planner reported 12 reuses | 68 | 816 | 0 |
| Planner reported 5 reuses and 7 runs | 8 | 40 | 56 |
| Planner reported 0 reuses and 12 runs | 15 | 0 | 180 |
| Proof-planner failure; safe run-all fallback | 1 | 0 | 12 |
| **Full-day observed total** | **92** | **856** | **248** |

For the **91 successful planner executions**, all 1,092 decisions were
individually found in the logs, with twelve distinct gate names each:
**856/1,092 = 78.4%** planned reuse. The one other job lacks planner decisions;
its gate log explicitly confirms **12/12 gates executed**. Including that
independently verified safe fallback yields **856/1,104 = 77.5% observed
reuse of gate opportunities** for the whole 92-group cohort.

This is an *observational log count*, **not** the stricter
`tools/queue-throughput.mjs --with-proofs` complete-cohort certificate:
that reporter correctly withholds its full-cohort rate when the planner is
unavailable. The historical fingerprint/gate registry and all source-proof
artifacts were not independently replayed here. In particular, a green
merge-group is not itself evidence that any proof was reused.

### Non-full-reuse run IDs (complete exception inventory)

All remaining 68 selected runs showed twelve distinct reuse decisions.

- **5 of 12 reused, 7 executed (8 runs):** [42144943781](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42144943781), [42153716411](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42153716411), [42163732690](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42163732690), [42180092371](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42180092371), [42195495034](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42195495034), [42203127448](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42203127448), [42277695635](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42277695635), [42317815721](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42317815721).
- **0 of 12 reused by a successful planner (15 runs):** [42167307456](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42167307456), [42170345139](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42170345139), [42193017150](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42193017150), [42214347693](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42214347693), [42217536424](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42217536424), [42225935201](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42225935201), [42237763810](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42237763810), [42243400694](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42243400694), [42245132547](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42245132547), [42255978426](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42255978426), [42262965283](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42262965283), [42271542529](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42271542529), [42280612092](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42280612092), [42283166372](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42283166372), [42318899284](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42318899284).
- **Planner unavailable; 12 actually executed (1 run):**
  [42313920538](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42313920538).

At [run 42313920538](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42313920538),
the `find reusable trusted gate proofs` step exited 1 at
**2026-11-06 23:45:18 UTC** after `gh` returned **HTTP 503**:
`No server is currently available to service your request`.
The subsequent `gates` step succeeded with `12/12 gates pass in lane batch`
and the job recorded 12 executed gates, taking **14.8 minutes** of reported
gate time. The `retain gate reuse decisions` step was skipped. This is a
*safe fail-closed optimization outage*, not a failed merge group or a valid
planner report with zero reuses. Treating the missing decisions as twelve
reuses would be incorrect; treating the run as wholly unobserved would lose
the separately verified run-all execution.

## Reproduction

1. Page `GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=N`,
   enforce descending creation dates and the exact half-open boundary;
   select only `name=check`. This window fits on page 1.
2. For each run, use its `run_attempt` in
   `GET /repos/EldritchDynasty/EldritchDynasty/actions/runs/<id>/attempts/<attempt>/jobs?per_page=100`,
   find its completed/successful `gates (batch)` job, and decode
   `GET /repos/EldritchDynasty/EldritchDynasty/actions/jobs/<job_id>/logs`.
   Validate exactly twelve distinct planner decisions in each of the 91
   ordinary jobs; isolate the HTTP 503 incident, and require the fallback's
   twelve-gate completion line instead.
3. Independently run `node tools/queue-throughput.mjs --from 2026-11-06T01:36:17Z --to 2026-11-07T01:36:17Z --with-proofs --json`
   with `GITHUB_TOKEN`. The reporter verifies historical inventories,
   exact run/head/attempt and gate-job outcomes. For a missing planner it accepts
   a **verified run-all fallback** only when the non-echoed gate output reports
   both `N/N gates pass in lane batch` and `gate-duration: evidence N executed
   gates`, for the same N in the SHA-pinned gate registry. That run contributes
   zero reused and N executed decisions; all other incomplete/ambiguous
   evidence still prevents a whole-cohort certification.

## Reporter regression: verified full execution after proof lookup failure (#3224)

The audit originally required every successful job to emit one planner decision
per gate. The GitHub HTTP 503 above left no such decisions even though the
required gate step completed and the gate runner independently proved all
twelve executed. `tools/queue-throughput.mjs` now distinguishes
`planner`, `run-all-fallback` and `unverified` evidence kinds. It reports
the counts separately and includes run-all fallbacks as **0 reused / N executed**.

The fallback path requires the workflow run's exact SHA/attempt, a successful
enclosing gate job and both named steps, its SHA-pinned gate inventory, and two
distinct, ungrouped Actions log facts: all N gates passed and gate-duration
recorded N actually executed gates. Missing or contradictory markers, echoed
commands, partial planner output, failed steps/jobs and mismatched run identities
remain unknown. A locally supplied `--proofs` snapshot remains non-certifying;
the complete-cohort percentage is issued only for a fully verified API cohort.

The 77.5% figure above remains a *manual observational audit* until a live
post-change reporter run is captured. This improvement changes reporting only,
not the gate-proof trust model, gate execution or native queue settings.

## Meaning and remaining boundary

The documented **pre-change** day-sized baseline in
[QUEUE-THROUGHPUT.md](QUEUE-THROUGHPUT.md) observed only
**36/1,152 = 3.1%** proof reuse and a **14.38-minute** median group slot.
The *post-change* window here shows **77.5% observed reuse**; the separate
#3203/#3204 24-hour cohort found **92 successes in 92 groups**, nearest-rank
**10.15-minute median**, **90 newly created PRs**, and **91 actual merges**.
These are measured correlations, **not** causal proof that #2825 alone
produced the improvement. The job mix, gate fingerprints, runner variation
and windows are different; the 20-group 87.1% sample elsewhere in the
throughput document overlaps this same day and must not be added again.

**Parent #2794 remains open.** This receipt advances its before/after proof
reuse evidence. It does not establish seven consecutive budget-safe days,
historical ready-queue depth, sustained working-day arrival/landing balance,
or owner approval for increasing native-queue build concurrency.
No merge-queue configuration, gate, generated duration file, or code behavior
was changed.
