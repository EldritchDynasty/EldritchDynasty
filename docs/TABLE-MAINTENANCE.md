# Table workload: observation and decision protocol

> **2026-11-05 — issue #1992, read-only instrumentation slice.**
> This document specifies how to interpret the existing opt-in reading log. It is
> not a measured participant study, a bot baseline, or approval to automate the
> house Table.

## Scope and current evidence

The player client already records bounded categories for Table `order`,
`muster`, and choice/Record delegation in `ed-reading-log/12`. Each attempt
has an observed terminal outcome where one exists. `order` and `muster`
return accepted/refused results; delegation reports **returned**, not proof that
a policy changed. An interrupted or capped attempt is **unfinished**, not a
refusal. These events contain category IDs and outcomes, never names, input
text, order payloads or refusal prose.

`tableWorkloadWindows(events, until, truncated)` in
`packages/client/src/lib/reading-log.ts` reads those events without changing
the format, the original events, the save or the game. It segments the observer's
timeline on a **successful Begin/share-code start** or a **displayed saved-run
pickup**. A cancelled/failed load is not a new house. A new run marker emitted by Vue before the Chronicle confirms pickup is held for the next window, rather than overwriting the previous house. Each segment reports:

| Field | Interpretation |
| --- | --- |
| `source`, `endedBy`, `startedAt`, `endedAt` | Observation boundary and why it ended; `open`/`cap` are censored |
| `campaign`, `seed` | Last observed public run marker; missing values remain null |
| `firstObservedYear`, `lastObservedYear`, `observedYearDelta` | In-game span *between observed markers*, **not** exposure-years or a completed reign |
| `foregroundMs` | Visible, focused, not on a declared break, in this window |
| `tableForegroundMs` | The same time while the selected pane is `table`; **exposure, not attention** |
| `actions.orders`, `actions.muster`, `actions.delegation` | Per-category attempts, accepted/refused/threw/returned, and unfinished |

The initial segment may represent an already-running house or merely
pre-Begin activity. It must not be assumed to be a complete campaign.
Page reloads end the recording, so separate device sessions cannot be joined
without a separately reviewed, privacy-preserving study protocol. Two runs
using identical seeds or years remain separate windows.

Example analysis of an explicitly exported artifact:

```ts
import { tableWorkloadWindows } from '../packages/client/src/lib/reading-log.js';

// `artifact` is a voluntarily exported ed-reading-log/12 object.
const windows = tableWorkloadWindows(
  artifact.events,
  artifact.events.at(-1)?.at ?? 0,
  artifact.truncated,
);
// Report each window's denominators and end reason; never silently
// turn partial in-game years into a completed Head tenure.
```

## Classification rubric before collecting a baseline

Classify **the purpose of a concrete accepted command**, supported by its
visible context, rather than labelling every order of one kind mechanical:

- **Maintenance:** repeat scheduling, renewal, withdrawal, reassignment,
  provisioning, or housekeeping intended to preserve the current plan.
- **Consequential:** a decision deliberately trading away a named person's
  future, resources, testimony or strategic opportunity.
- **Ambiguous:** a command whose role cannot be recovered from bounded
  category/outcome telemetry alone; keep it unclassified pending the
  observing participant's account.

An attempted or refused action does not establish a completed task. Delegation
`returned` says nothing about whether a policy was changed or later acted
on. An order `category` by itself cannot identify narrative consequence. Do
not infer a player's intention or importance from category names.

For **observed humans**, report the number of participants, build SHA,
recording opt-in, session duration, `tableForegroundMs` per session, attempts
and terminal actions per observed house window, time hidden/unfocused/on break,
unclassified actions, and the counts of incomplete/capped windows. Describe
observed distraction and player-reported friction separately: foreground time
is only an upper-bound-style exposure proxy, not verified cognitive load.

For the **bot proxy**, predeclare the competent policy, Short/Long seed sets,
sample sizes, world/content revision and action classifications. Use saved
command/result evidence to count manual and delegated actions separately,
and report counts per run, per complete Head tenure, per partial tenure, and
per explicitly defined game-year exposure. Include early broken lines and
unavailable commands instead of quietly dropping them. A bot's count is not
human attention cost.

## Decisions and remaining work

1. Produce a fresh bot baseline with denominators, uncertainty, and relevant
   versions; do not substitute these client recordings for bot evidence.
2. Run the existing #1945 participant protocol with real returning and new
   players, observing Table use and the participant's own interpretation.
3. Record the owner's explicit decision in #1992 before any new automatic
   maintenance, auto-delegation, or UI behavior is shipped. A no-change
   decision is valid.
4. Only after an adopted bounded intervention, remeasure against the same
   definitions and comparable cohorts.

This slice adds an analysis function and deterministic observation-boundary
tests only. **No participant observations or bot results are claimed.**
The parent issue remains open; see also #1945 and #219.
