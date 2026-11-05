# Cohort-ready reader, signing and Table metrics

**Scope:** a read-only, privacy-preserving reduction of the existing opt-in
ed-reading-log/12 export. Refs #1945 (mystery pacing), #1984 (first signing)
and #1992 (Table workload). It is not a new recorder, a bot-policy run, or an
observed study. Those issue-level studies and any owner decision remain open.

This tool adds distributional evidence that the existing
tools/reader-evidence-report.ts does not produce: complete vs censored
entry-time and answer-gap distributions, plus Table-pane manual action rates
with explicit denominators and campaign separation.

## Collect and run

Ask for the participant's informed agreement, then use the ordinary game with
the **single** ?reading-log=1 URL switch. The player must choose **Export
reading log**. The opt-in recorder contains no typed names, and makes no
network request. Keep raw exports private; ask for consent again before
sharing or aggregating another person's recordings.

From the repository root, with the project dependencies installed:

    npx tsx --tsconfig tsconfig.base.json tools/reader-cohort-metrics.ts /private/sitting-1.json /private/sitting-2.json > /private/cohort-metrics.json

The command only reads locally provided JSON and writes the result to stdout;
it does not modify saves, analytics state, the simulation or any user files.
The output contains no raw page/decision ids, seeds, file paths, typed text,
refusal reasons or participant identifiers. Build SHAs are retained to expose
potentially incompatible observations, not to identify people.

The existing evidence reporter validates every input first: only complete
version-12 exports with finite ordered times and a terminal marker are
accepted. All metrics here are computed again from events, never from an
exported/stale summary. Unsupported or partial files cannot silently become
complete observations.

## How to interpret the output

| Field | Numerator / denominator | What it **doesn't** establish |
| --- | --- | --- |
| entries.completed | Successful new-house starts with an accepted command after an accepted signing and Enter | Whether that command was a meaningful family decision |
| entries.censored | Starts without that accepted command before the observation ends | Abandonment, failure or a slow completed entry |
| entries.completedForegroundMs | Visible, focused, unbroken exposure from accepted Begin to first accepted candidate command | Exact time spent reading individual signing steps |
| answerGaps.completedForegroundMs | Exposure between two observed answers (excluding the initial open-to-first-answer interval) | Understanding or the player's unanswered question |
| answerGaps.censoredForegroundLowerBoundMs | Exposure since an observed answer before the sitting ended or was cut short | The eventual wait; censoring is not a completion |
| answerGaps.completedGameYears | Difference between observed game years for complete answer-to-answer gaps | Wall time or foreground attention |
| campaigns[].tableForegroundShare | Table-pane exposure / observed house-window foreground exposure | Workload category, consequential value or a whole campaign |
| campaigns[].attemptsPerTableForegroundHourEstimate | Manual order + muster attempts / observed Table-pane hours | Attempts per player-hour or generation, or attention saved by automation |

Every numeric Distribution gives count, min, median, p90 and max.
Quantiles are interpolated between sorted empirical observations; they are
computed **only from completed intervals**. Missing observations produce
count zero and null numeric quantiles. No missing or censored observation is
silently treated as zero or as a completed time.

The campaigns array separates Short Line, Long Line, Demonstration and unknown
observations. Each bucket contains first-entry metrics, Table foreground
exposure, manually attempted / accepted / refused / unfinished orders and
Muster commands, and attempts to set or clear delegation. It counts
observation windows, **not Head tenures or unique people**. The Table rate
is null if no Table foreground time was observed; it is not an assumption of
no workload. Some orders may be made outside that pane.

The builds array contains sanitized commit SHAs or unknown; mixedBuilds=true
warns that this call combined builds. Splitting cohorts by actual tested SHA,
campaign and participant recruitment is the researcher's job. One person can
have several exports; merging them does not increase participant count.

## Protocol use and boundaries

For **#1984**, start at successful Begin, observe the accepted candidate
command on the board and annotate which action was genuinely consequential.
Observe refusals and partial sittings without converting them to abandoned
sessions. Compare the same campaign and build before considering whether a
staged signing improved the experience.

For **#1945**, pair completed and censored answer-gaps with the person's
verbatim question and what the answer changed. Exposure in front of a screen
is not reading or curiosity. Do not retune content based on a large game-year
number alone. A new answer must be actually observed, not carried from a save
or counted on a Chronicle revisit.

For **#1992**, use the M/C/A (maintenance / consequential / ambiguous)
rubric from docs/PLAYTEST.md on observed individual commands. Mechanical
Table categories do not establish intent. Annotate available systems,
incomplete generations and interrupted sitting boundaries separately.
Compare against a separately predeclared bot proxy only after recording the
policy and seed cohorts. This tool has **no** Head-tenure denominator and
does not justify opt-out automation or claim a reduction in player burden.

Keep the observations, decisions and limitations dated and separate from any
later changes. Player sessions and owner decisions are still necessary to
finish these parent issues.

## Verification

packages/client/src/lib/reading-log.test.ts includes synthetic fake-clock
coverage of completed/censored entries and gaps, zero-denominator Table
rates, privacy of output, malformed input rejection and mixed-build
warnings. No new test suite was added to the fast-test duration inventory.

The tool imports the existing report validator and the client's read-only
summary arithmetic. It does not hook a client action, alter a save or change
the consent notice. Exact-head GitHub CI remains the authoritative check
until it passes; local host and participant observations are not claimed.
