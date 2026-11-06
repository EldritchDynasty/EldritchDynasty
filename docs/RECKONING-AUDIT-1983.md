# Long Line purpose recognition: engineering evidence audit (#1983, #3099)

**Review scope:** production code on `main` as inspected 6 November 2026, after
#3055 landed through #3056. This is a source-and-existing-test review, **not**
a participant study, a fresh test run, an Android/Windows build, or an adoption
decision. The wider #1983 remains open for actual-reader acceptance.

## Disposition

**No additional last-night passage is justified by the evidence audited here.**
The shipped ending already has four purpose-specific, attributed passages, not
merely an ambition status line. Each requires something more than a selected
ambition. The still-requested **protected relative** and **refused rite**
accounts have no demonstrated unambiguous, general-purpose evidence join in
this audit. A message that claims a rescue from survival or refusal from silence
would make the creditor an omniscient judge, contrary to the game's rules.

Keep the existing four projections; do not change ending selection, add
persistent recognition state, or introduce speculative prose. A specific
remaining defect with a supported act/page/person join can get a separately
claimed child issue and a bounded regression before prose changes. The parent
issue's question — whether a reader perceives a family purpose beyond ascent —
cannot be answered without observation.

## What the complete ending actually presents

1. `beginningOf` in [ending.ts](../packages/core/src/ending.ts) captures the
   founder, guardian year, opening Chronicle pages and the tracked ambition's
   **name/progress/status** via `ambitionView` (approximately lines 576–603).
   This status is context, **not** evidence of pursuit.
2. `purposeOf` (approximately lines 626–814) returns at most one
   `EpiloguePurpose` only for a **Long Line** with one of four matching
   tracked ambitions. Its source is persisted people/branch/Chronicle evidence,
   with a special join through `afterimageEvidence` for rites.
3. [Ending.vue](../packages/client/src/components/Ending.vue) renders an
   ambition line (around 258–261), the relevant named purpose passage
   (266–332), the actual reckoning (335–383), the independent Afterimage
   memories (385–396), and the ending ring (398–410).
   All four purpose kinds have separate Original and Plain English prose. The
   quoted written words remain the historic page's language when the reader
   switches mode; the UI does not silently rewrite the Chronicle.
4. [afterimage.ts](../packages/core/src/afterimage.ts) collects named pages,
   past decision casts and the last recorded line, choosing written testimony
   in date order. It rejects omitted pages as testimony and uses unique
   event-and-year attribution for outcome joins (roughly 49–141). The
   `spentBlood` candidate is distinct from the earliest spent person of any
   origin, so an outsider's rite does not hide a later blood-relative cost.
5. `selectEnding` in [ending.ts](../packages/core/src/ending.ts) decides from
   the Chronicle's substantiated claim, living blood and campaign contract
   (roughly 387–426). `purposeOf` runs only as part of `epilogueOf`
   **after** the ending has been chosen; it does not alter the ending ID.
   Named costs never award a cleaner ending or an achievement.

## Evidence/absence matrix

| Tracked aim and rendered kind | Acted, supportable history | Missing, unpursued or disputed history | Disposition |
| --- | --- | --- | --- |
| **Deepen the blood — `blood_spent`** | A specific house-blood victim is joined to a successful rite marker, the exact saved outcome, a uniquely attributed, named written Chronicle page and a valid lifetime. Shows the victim, year, surviving words and whether the page was embellished. | An ambition flag alone; an outsider-only rite; cast with no success mark; omitted, greyed, ambiguous or future page; no valid blood-relative lifetime: no specific passage. A claim on a page is not independently verified truth. | **Keep.** It recognizes an actual *cost*, not a rescue. |
| **Secure branches — `branch_kept`** | The dated charter identifies an eligible founder; the last-night hall contains a viable family and a surviving named house-blood relative, with unambiguous historical memberships. A second hall's documented extinction can be mentioned as loss, with no attribution of its cause. | Selected aim with no viable hall, future birth/founding, founder whose charter contradicts dated memberships, multiple simultaneously active memberships, or a hall whose living record cannot be established: no passage. Legacy charter with no dated founder membership is allowed, but positive contradictory evidence is not. | **Keep**, including #3055's contradiction fix. It must never claim which decision saved the hall. |
| **Restore the Ledger — `ledger_witness`** | One specifically recovered **non-inherited** clause has exactly one surviving, named, non-greyed, unaltered illuminated Chronicle page with its original or Plain English authored title/text. It quotes that saved text and year. | Recovered counter without the page; inherited clause; omitted, embellished, altered, future, duplicate or greyed page: no passage. Recovering terms is explicitly **not** paying the debt. | **Keep.** No second independent truth verdict. |
| **Raise an ascendant — `ascendant_wait`** | A uniquely identified `ledger_wait:<personId>` Chronicle page has one named person, the demigod rung, the expected automatic-record shape, surviving words and valid person lifetime/date. It witnesses the wait before an unfinished Ledger, not eventual success. | Aim alone; malformed/duplicated, future/pre-founding/greyed/omitted/reclassified wait page; missing or anachronistic person: no passage. | **Keep.** Do not infer a finished ascent. |

The matrix is derived from the existing guards in `purposeOf`, the
`AfterimageEvidence` join, and regression coverage in
[ending.test.ts](../packages/core/src/ending.test.ts):
approximately 1324–1660 (blood), 1660–1900 and 2150–2188 (branches),
1900–2020 and 2530–2555 (Ledger), 2020–2150 and 2557–2585
(ascendant), plus historical-window and read-only projection tests.
The exact test outcomes are **not re-reported as freshly executed** here.

### The #3055/#3056 integrity boundary

The earlier `currentMembership(person, year)` shortcut picked one active
membership even when recovered history had two simultaneous, contradictory
rows. That could fabricate a charter or a viable hall. The merged correction
in [ending.ts](../packages/core/src/ending.ts) now:

- requires exactly **one** active resident membership at collection;
- rejects a founder with **multiple** active charter-date memberships;
- accepts a historical charter with **no** dated founder membership for
  legacy saves, while rejecting a unique *contradictory* membership;
- keeps the normal founder age, house, branch, birth, death and viability
  checks, and computes the historical family from the last-night date rather
  than today's still-hot people.

This is evidence integrity, not proof that a participant understood the
branch's story. The associated child #3055 is completed by merged PR #3056.

## Requested cases that do not yet justify a new passage

| Proposed recognition | What the model can currently say | What would be needed before implementation | Decision |
| --- | --- | --- | --- |
| A relative was **protected/saved** | A person was alive at collection, maybe in a documented cadet hall. Survival by itself does not identify a protective decision. | An explicit persisted protective choice/effect tied to a named person and uniquely attributable saved page, an observed consequence or cost, and handling for omissions, alternate outcomes, retries and contradictory evidence. | **Defer** causal praise; keep neutral survival language. |
| The house **refused a rite** | A rite did not appear among witnessed sacrifices; absence is not a recorded refusal. | A dated, identifiable refusal outcome and its unambiguous Chronicle testimony. Compare refusal, never-offered rite, attempted-but-failed rite, omitted account and another person's rite. | **Defer** until a real refusal witness exists and reader need is demonstrated. |
| The creditor declares **whose version is true** | The Chronicle may contain embellished or disputed pages and names. | The product specifically prohibits omniscient adjudication. | **No change**; quote provenance and leave contradictions visible. |
| A better ending for a fulfilled ambition | Purpose evidence already sits beside, not above, the game ending. | Separate owner-approved design change to ending rules, with a new calibration and campaign tests. | **No change** under #1983. |

These are **engineering dispositions**, not findings that protected-relative
stories would be uninteresting. Real-reader reports can motivate a precise
new child issue without making the story assert more than the saved evidence.

## Reproducible reader acceptance — still outstanding

Use [PLAYTEST.md](PLAYTEST.md) and the parent #1983's acceptance language. For
each observed completed Long Line, record the exact game/client build SHA,
campaign, seed, save/replay provenance, selected ambition, ending ID, prose
mode, which purpose passage actually appeared, and whether a saved page was
omitted or disputed. Keep sample size and incomplete sessions visible.

Compare **three evidence levels per aim** on otherwise comparable builds:
(1) an acted and uniquely documented history that displays its purpose,
(2) an aim selected but not acted on, and (3) the same apparent act with its
witness omitted, greyed, duplicated or contradicted. Use the four existing
kinds, including a viable-versus-contradictory hall and a blood-relative-versus-
outsider rite. Check Original and Plain English, keyboard/screen reader/touch
where available, and replay/save-resume equivalence. No participant is told
which purpose to report.

Ask the reader *in their own words*: what goal the house pursued, which named
person or account supports the answer, what the goal **cost or failed to
achieve**, and how that differs from the creditor's ascent/ending verdict.
Record mistakes and uncertain answers rather than converting a visible
passage or a passing test into comprehension.

**Exit rule for #1983:** once dated observations exist, choose *keep*,
*revise* or *no change* with an explicit build, examples, incomplete sessions
and limits. If a missing case is shown and the saved evidence supports it,
create a bounded child issue before any new prose/code PR. The current audit
cannot close #1983 or claim the reader criterion has passed.

## Verification and scope of this child

Only this documentation page is added; no content, core, schema, client, RNG,
save format or ending precedence was changed. This connector-only session did
not run local npm scripts or a local `npm run land` preflight. The PR's exact
head and merge-group CI remain the authoritative required checks for landing.

**Issue linkage:** Closes #3099 when this audit lands. Refs #1983, which
remains open for participant evidence and any justified subsequent slice.
