# PR #1445 native merge-queue eviction and recovery (2026-10-12)

This is a dated incident record, not an alternative landing procedure.
**GitHub's native REBASE merge queue remains the sole normal way to land a
ready pull request.** [AGENTS.md](../AGENTS.md) and
[COMMANDS.md](COMMANDS.md#the-landing) govern current operations.

## Symptom and evidence

- [PR #1445](https://github.com/EldritchDynasty/EldritchDynasty/pull/1445)
  initially had a merge commit in its branch history. An exact-head green
  `CI required` check and a successful queue-admission workflow did **not**
  mean the PR had entered a tested merge group.
- GitHub repeatedly added and removed the PR from its native queue. For
  example, on 2026-10-12 it was added at 17:28:31 UTC and removed at
  17:28:47 UTC, a 16-second interval. Its issue timeline identified
  `github-merge-queue[bot]` as the remover but contained no reason field.
  There was no successful `merge_group` integration for the affected head.
- The observed configuration required `CI required` from GitHub Actions
  and used native `REBASE` grouping. The queue's 120-minute check-response
  timeout does not explain a 16-second removal. The GitHub API evidence alone
  did not establish a precise provider-side dequeue reason.
- The branch was then linearized against current `main`, preserving the
  reviewed changes and explicitly restoring the live App preference wiring
  from its earlier merge resolution. PR head
  [`0ffc6fdd`](https://github.com/EldritchDynasty/EldritchDynasty/commit/0ffc6fdd77e3363311208d22621314625c9d4251)
  has one parent.
- The **same PR** subsequently entered a real `merge_group`. [Run
  38315209213](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/38315209213)
  completed with `CI required=success`: Linux fast lane, Windows,
  validation/typecheck, all four slow shards and batch gates succeeded.
  Its synthetic integration SHA was
  [`eb40e974`](https://github.com/EldritchDynasty/EldritchDynasty/commit/eb40e9743bd6894694b7e3f065634cbef8d4626d).
  Native queue bot merged PR #1445 on 2026-10-12 at **22:20:22 UTC**.

**Outcome:** the previously blocked PR was integrated by the intended
queue after history linearization, with full merge-group CI. That is direct
proof of recovery, **not** proof that GitHub specifically diagnosed merge
commits as the earlier eviction cause.

## How to investigate a recurrence

1. Inspect the affected PR's exact head SHA, GitHub Actions `CI required`
   result, `draft` status, base, head repository, mergeability, and its
   `added_to_merge_queue` / `removed_from_merge_queue` timeline events.
   Distinguish an admission workflow's success from an actual synthetic
   `merge_group` run.
2. Check whether the head branch contains merge commits while the native
   queue uses REBASE. If it does, consider an ordinary linear rebase onto
   current `main` **on that issue's claimed working branch**. Preserve and
   review any conflict resolution as real code, especially App call-chain
   wiring; never silently discard a feature that arrived in a merge commit.
3. After changing the head, run the required local preflight when a checkout
   is available. Leave a ready same-repository PR for **fresh exact-head CI**
   and automatic admission; a green verdict for an older SHA does not count.
   Confirm `merge_group` ran its full tier and `CI required` succeeded
   before calling anything landed.
4. If a now-linear and otherwise eligible PR is still removed without a
   merge-group run, inspect the queue status and active ruleset in the owner
   GitHub UI and request GitHub Support's removal reason. Record the specific
   bot event time and head SHA. Do not speculate by loosening a required
   check, bypassing branch protection, manually merging, re-adding on every
   dequeue, or posting the retired `/land` command.

The source investigation, including the earlier failed admissions and
ruleset details, is [issue #1499](https://github.com/EldritchDynasty/EldritchDynasty/issues/1499).
