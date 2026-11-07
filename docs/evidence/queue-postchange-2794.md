# Next non-overlapping post-cutover queue cohort — 7 November 2026

**Issue:** [#3232](https://github.com/EldritchDynasty/EldritchDynasty/issues/3232), part of [#2794](https://github.com/EldritchDynasty/EldritchDynasty/issues/2794).
**Window:** `2026-11-07T01:36:17Z` (inclusive) through `2026-11-07T06:10:00Z` (exclusive), a **closed 4h 33m 43s** observation following directly after the separately documented first complete post-cutover day. These are disjoint windows, not a rolling overlap.

## Results

| Observation | Result |
|---|---:|
| Required `check` merge-group runs, completed | **18** |
| Success / failure / other / pending | **18 / 0 / 0 / 0** |
| Slot median / p90 (nearest rank) | **10.15 / 11.32 minutes** |
| Verified `gates (batch)` jobs | **18 / 18** |
| Explicit gate planner decisions | **216 (12 per job)** |
| Trusted-main proofs reused / executed | **192 / 24** |
| Observed reuse share | **88.9%** |
| PRs created targeting `main` / actually merged | **18 / 19** |
| Created / merged per hour | **3.95 / 4.17** |
| Net PR inflow minus actual merges | **−1** |

All 18 groups succeeded. Each corresponding attempt-1 `gates (batch)` job completed successfully and its decoded log contained exactly twelve distinct timestamped gate-planner decisions. Two groups planned all twelve gates to run rather than reuse; the other sixteen reused all twelve. Gate reuse is a count of explicit planner choices, *not* an independent cryptographic proof audit or a new measurement of individual gate runtime.

## Source ledger

Slot duration uses each completed workflow run's `updated_at - run_started_at`, rounded to hundredths of a minute. UTC times shown below are workflow `created_at`. `Reuse` and `run` are mutually exclusive **timestamped planner** entries in the listed gate job log.

| Merge-group run | Created (UTC) | Slot (min) | Gates job | Reuse / judged |
|---|---:|---:|---|---:|
| [42326438840](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42326438840) | 01:53:33 | 9.87 | [128262744160](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42326438840/job/128262744160) | 12/12 |
| [42327316663](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42327316663) | 02:03:56 | 10.10 | [128265525894](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42327316663/job/128265525894) | 12/12 |
| [42328487446](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42328487446) | 02:17:26 | 11.20 | [128269303990](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42328487446/job/128269303990) | 12/12 |
| [42329470869](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42329470869) | 02:29:06 | 10.57 | [128272487372](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42329470869/job/128272487372) | 12/12 |
| [42330421315](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42330421315) | 02:40:44 | 10.82 | [128275480376](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42330421315/job/128275480376) | 12/12 |
| [42331852273](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42331852273) | 02:59:27 | 10.28 | [128280003548](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42331852273/job/128280003548) | 12/12 |
| [42332712325](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42332712325) | 03:09:58 | 11.32 | [128282742940](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42332712325/job/128282742940) | 12/12 |
| [42333801058](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42333801058) | 03:23:36 | 10.35 | [128286087471](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42333801058/job/128286087471) | 12/12 |
| [42334620417](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42334620417) | 03:34:23 | 10.15 | [128288652393](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42334620417/job/128288652393) | 0/12 |
| [42335381935](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42335381935) | 03:44:50 | 10.15 | [128291055807](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42335381935/job/128291055807) | 12/12 |
| [42336145874](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42336145874) | 03:55:26 | 7.33 | [128293441340](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42336145874/job/128293441340) | 12/12 |
| [42336709086](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42336709086) | 04:03:13 | 8.62 | [128295187462](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42336709086/job/128295187462) | 12/12 |
| [42337397043](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42337397043) | 04:12:17 | 9.48 | [128297349306](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42337397043/job/128297349306) | 12/12 |
| [42338155208](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42338155208) | 04:22:14 | 7.58 | [128299703638](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42338155208/job/128299703638) | 12/12 |
| [42340126124](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42340126124) | 04:49:50 | 10.10 | [128305767516](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42340126124/job/128305767516) | 12/12 |
| [42342425284](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42342425284) | 05:22:00 | 7.92 | [128312865165](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42342425284/job/128312865165) | 12/12 |
| [42343675530](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42343675530) | 05:39:47 | 12.53 | [128316704897](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42343675530/job/128316704897) | 0/12 |
| [42344562886](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42344562886) | 05:52:47 | 10.55 | [128319409132](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/42344562886/job/128319409132) | 12/12 |

## Reproduction and limits

1. Page the GitHub REST workflow-run collection `GET /repos/EldritchDynasty/EldritchDynasty/actions/runs?event=merge_group&per_page=100&page=N` until the oldest `created_at` is before the start. Retain only `event=merge_group`, `name=check` and `created_at >= start && created_at < end`. At collection, page 1 contained 100 rows and its oldest timestamp was `2026-11-06T06:42:07Z`; page 2 was older, so all 18 rows in this window were observable. Check all final statuses/conclusions and use actual run timestamps for slot statistics.
2. For each retained run, inspect the latest attempt's jobs from `GET /repos/.../actions/runs/<run-id>/jobs`, retain the completed/successful `gates (batch)` job, and decode its job log. Count only twelve **timestamped** `<gate>: reuse from run <id>` or `<gate>: run ...` decisions from planner execution. Exclude quoted shell script, producer messages, command echoes and later summaries. Each job in the ledger had twelve unique gate IDs. The more stringent local reporter can replay exact-attempt job identity and historical gate registries with `--with-proofs`; that separate replay was **not** run in this connector-only receipt.
3. Independently count PRs using GitHub issue-search with `incomplete_results=false`, `base:main` and the inclusive end-second `2026-11-07T06:09:59Z`:

    ```text
    repo:EldritchDynasty/EldritchDynasty is:pr base:main created:2026-11-07T01:36:17Z..2026-11-07T06:09:59Z
    repo:EldritchDynasty/EldritchDynasty is:pr base:main is:merged merged:2026-11-07T01:36:17Z..2026-11-07T06:09:59Z
    ```

    These queries returned 18 and 19 respectively. The two populations are different PR sets. The flow rate divides each count by the **4h 33m 43s** window; no merge-group success is taken as proof that a particular PR merged.

**Interpretation.** This later adjacent sample supports another short period of zero observed failed merge groups, high proof reuse and landings at least matching new PR creations. Its failure-free results are **not** a second complete-day certificate; a 4.56-hour window cannot establish the seven-consecutive-day duration-budget absence, sustained arrival/landing equilibrium, historical ready backlog or whether changing native queue build concurrency is safe. The earlier before/after cohorts used different change mixes and load. No causal benefit is asserted; parent #2794 remains open. No runtime code, CI configuration, queue settings, generated timing data, or test assertions were changed, and no local test execution is claimed for this evidence-only change.
