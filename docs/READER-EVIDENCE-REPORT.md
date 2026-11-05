# Offline reading and Table evidence report

**Scope:** #1945 (mystery pacing in active reading time), #1992 (Table
maintenance load). This is a research aid for existing opt-in client logs.
It is not a simulation gate, a new recorder, a participant study, an
observed baseline, or an approval to automate Table work.

## Collect a log

1. Ask the participant for consent to use the research recorder. Launch the
   ordinary player client with the single URL switch **?reading-log=1**.
   The notice on screen describes the stored fields and local-only collection.
2. Let the participant use the normal game. Record separately (with consent)
   the tested build, session context, any undeclared pauses, and their own
   explanation of what they were doing.
3. Have the participant press **Export reading log**. The JSON stays on that
   machine until they choose to share it. Keep original exports private.
4. Analyze only consented exports. One export is a device observation
   window, not a unique participant or an entire Long/Short Line.

## Run the report

At the repository root, with the normal npm dependencies installed:

    npx tsx --tsconfig tsconfig.base.json tools/reader-evidence-report.ts /private/research/session-a.json /private/research/session-b.json > /private/research/table-evidence.json

The command reads local JSON files and writes one versioned JSON report to
standard output. It does not modify its inputs, send telemetry, record a game
command or contact a network endpoint. Input file paths are not written
into the report. Keep the output private too: aggregates over a single
participant can still describe that person's play.

Only complete **ed-reading-log/12** (historical) and **ed-reading-log/13** (current) exports are accepted. Version 13 adds an explicit failed-pickup boundary; version 12 cannot supply that observation. Mixed-version input is labelled `mixed` in the report. The tool validates
the terminal marker, cap flag and ordered finite timestamps; unsupported,
missing, partially written or out-of-order logs fail rather than inferring
a duration. It recomputes clocks and category totals using the client's
summarize and tableWorkloadWindows functions. A stale or forged stored
summary cannot substitute statistics. Raw page ids, decision ids, seeds,
filenames, campaign free text, player inputs and refusal reasons are never
copied to the output. The report permits only known campaign labels and
hex commit identifiers.

Use buildSha and the input-log count to split incompatible cohorts. Keep
the participant-to-export mapping separately when the same participant has
multiple sessions. Different exports are not independent people.

## What the numbers mean

| Field | Numerator and denominator | Interpretation |
| --- | --- | --- |
| foregroundMs | Visible, focused, unbroken time in the full log | Exposure proxy, not actual reading |
| foregroundMsInWindows | Sum of foreground time in observed house windows | Excludes title-screen time before Begin |
| tableForegroundMs | Portion above while Table is selected and not behind an interlude/ending | Table-pane exposure, not necessarily maintenance |
| tableForegroundShare | Total Table foreground ms / total house-window foreground ms | Weighted share, not an average of per-log percentages |
| orders, muster, delegation | Attempts, accepted, refused, threw, returned, unfinished | Terminal evidence; delegation returning does not prove a policy changed |
| observedYearDelta | Last seen in-game year minus first in that window | A span, not person-years or a completed generation |
| ordersPerObservedYear | Order attempts / positive observed year span | Null if unknown/zero; never extrapolate |
| answerIntervals | Gaps starting at an observed answer, completed vs censored | Excludes initial exposure-to-first-answer gap |
| entries | New-house signing intervals reaching an accepted first command, vs censored | Not proof that a choice mattered |

Each window includes its source (initial, begin or confirmed pickup) and
ending (begin, pickup, end, cap or open). Separate houses remain isolated
even if campaign/seed/year matches. A failed or canceled saved-run pickup
is not a new house. A cap censors incomplete observations.

**Important:** a span from 1042 to 1050 does not prove eight years of
Table exposure. Compare actions per completed Head tenure and per
exposure-year only using separately verified tenure and exposure data.
The recorder cannot establish those denominators itself. Do not call
ordersPerObservedYear a per-generation burden rate.

## Analysis plan before interpreting evidence

For mystery pacing (#1945), predeclare campaigns and tested builds. Use
completed answer-to-answer gaps for observed foreground waits and retain
censored gaps separately. Compare game years with foreground exposure
only after excluding background/blur/break intervals. Ask whether each
apparent stall was confusion, choosing, deliberate reading, interruption
or a technical fault. A large gap alone is not a broken mystery.

For Table maintenance (#1992), classify on-screen actions using a
reviewed rubric. **Maintenance** means upkeep, renewal or repeated
status-preserving work without a distinct strategic dilemma.
**Consequential** means a choice the player can describe as changing
a named person's fate, family, risk or future. **Ambiguous** covers
mixed-purpose or unclear actions; report them separately.

The mechanical category (one order kind) is not itself the human rubric.
Ask which panes participants ignore or revisit, which renewals they
resent, and which interruptions they valued. Report incomplete sessions
and participant counts alongside file counts; sampling units for human
conclusions are people, not exported files.

The bot proxy requested by #1992 is separate: declare seeds, policy,
campaign, accepted/refused orders, partial tenures, broken lines,
exposure assumptions and uncertainty before executing it. Bot commands
estimate policy activity, not human attention. This report invents
neither bot nor reader measurements, and makes no delegation decision.

## Verification and boundaries

The reader-evidence-report.test.ts suite covers weighted denominators,
recomputation despite a forged summary, privacy, censoring, action
outcomes and invalid export refusal. Typechecks and authoritative
exact-head CI must pass before landing. The new test file also enters
the repository's measured-duration inventory.

This tool reduces the existing format without changing the observer's
event format, consent notice, transport, game rules, save data or
automatic delegation. Human studies and owner decisions in #1945 and
#1992 remain open.
