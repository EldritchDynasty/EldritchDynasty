# Last-night family-purpose recognition — bounded source audit (#1983)

**Source reviewed:** `main` at `ee0c47b10e71b40ca753161bce50c3605dc152fa`, 6 November 2026.
**Scope:** the shipped Long Line recognition, its visible ending, and Afterimage
evidence. This is a mechanism audit, **not** a participant study or a claim that
the complete parent issue is finished.

## What the reader already receives

The ending has three distinct surfaces. `beginningOf` projects the selected
house ambition and its current progress/status; that is a status line, **not
proof of pursuit**. `purposeOf` independently derives at most one witnessed
purpose for a Long Line. `afterimageEvidence` builds the separately attributed
people, lineage and remembered evidence, rather than a hidden-world verdict.
The player client renders each of the four purpose variants in both Original
and Plain English (`Ending.vue`); the creditor's selected ending stays separate.

| Long Line ambition | Evidence needed for a purpose passage | Explicitly insufficient |
| --- | --- | --- |
| Deepen the blood | Named house-blood rite victim, successful rite outcome/death mark, unique surviving written event/year witness | The selected ambition, outsider loss alone, an omitted/lost page, ambiguous attribution or a future page |
| Secure branches | In-term cadet charter with an eligible named founder, a viable hall at collection and a documented living relative; an independently dated lost hall may be acknowledged | An empty/extinct hall, future-born occupant, unsupported founding, contradictory founder or survivor membership, or an inferred rescue |
| Restore the Ledger | A recovered, non-inherited clause with one surviving, unaltered illuminated page in Original or frozen Plain English | Recovered count alone, inherited clause, missing/greyed/omitted/embellished or duplicated testimony |
| Raise an ascendant | A single admissible `ledger_wait:<person>` page, named surviving person, demigod mark and unaltered account at collection | Current ladder state or ambition alone, altered/future/pre-founding or duplicated accounts, misattributed person |

These conditions are enforced in `packages/core/src/ending.ts`, with
contrasts in `ending.test.ts` (the #1983 purpose groups and the chronological,
membership, and duplicate-witness regressions). The #3055/#3056 correction
already rejects contradictory positive same-year membership records; it is not
being reimplemented here.

## Additional defect discovered in the cross-surface audit

The purpose passages and `readTheChronicle` use the *ending's last-night year*
and the campaign's start year. In contrast, `afterimageEvidence` used the
**current mutable world year** as its upper bound after an ending was recorded,
and it imposed no founding-year lower bound. In a recovered/altered world
containing later or pre-founding testimony, the Afterimage could therefore
name people or a blank page outside the book being judged. It could also pick a
later succession holder for the ancestral silhouette or a later thin-line
question, and expose bynames awarded after collection. This contradicted the
bounded purpose passages beside it.

This PR aligns the completed Afterimage with the campaign's
`[startYear, ending.year]` interval for written pages, outcome attribution,
thin-line questions and succession-head selection, and uses the saved ending
year when resolving earned epithets. For unfinished authoring/test inventories,
existing unbounded diagnostic behavior is retained.

A focused regression in the **existing** `ending.test.ts` suite constructs
before-founding, collection-year and post-collection witnesses, a post-collection
succession row and future blank, then advances the recovered world clock beyond
its saved ending. It checks the publicly returned epilogue in both prose modes
and verifies the read does not mutate the canonical saved state. This adds no
new unmeasured test suite.

## Disposition and remaining acceptance

The four existing Long Line purpose branches already distinguish a *pursued
and witnessed* ambition from mere selection, and preserve ending precedence.
No additional ungrounded recognition passage is proposed. The identified
cross-surface time-boundary bug has a narrow code/test correction in this PR.

**Not established here:** a completed local preflight, the hosted CI verdict,
new campaign population reach, or whether actual readers can articulate the
family's purpose, its cost and the creditor's separate judgment. The parent
#1983 remains open for the dated real-reader check and any independently
demonstrated later gap; no qualitative benefit is inferred from automated tests.

## Follow-up: erased Chronicle pages are not surviving Afterimage memories (7 November 2026)

The earlier term-boundary audit established *when* the shareable Afterimage may
read a completed book. A distinct surviving-evidence check remains necessary:
legacy/recovered Chronicle entries may be marked `greyed` (known to have
existed but lost) while still carrying residual text, names, or a Record choice.
The client image's quote selector already excludes such pages, but the core
Afterimage's named-person memories, choice-linked cast mentions, and standing
embellishment previously could still present their words as if preserved.

The bounded correction in `afterimage.ts` now builds those surviving-memory
surfaces from non-greyed written pages, and does not attribute a logged choice
through a greyed page. The broader historical `spent` inventory intentionally
retains its earlier meaning: a documented rite happened even if its account was
later lost; the separate `spentBlood` reckoning already requires ungreyed
written testimony. Neither `purposeOf` nor ending precedence changes.

A new test inside the existing `ending.test.ts` suite constructs a greyed
named and embellished page plus an outcome-log cast, checks that both prose
modes refuse those surviving memories without changing the saved state, then
adds an independent legible page and verifies that only its own source returns.
This is mechanism evidence, **not** a reader study or a declaration that the
parent issue's human acceptance is complete. Local tests and the exact-head CI
verdict must be reported separately; a connector-only code edit is not a pass.


## Follow-up: fractional dates are not historical evidence (7 November 2026)

A recovered or malformed saved Chronicle can contain a numerical year within
the Long Line range that was never a calendar year (for example `1541.5`).
The existing campaign-bound checks in `ending.ts` and `afterimage.ts`
accepted such values as dated witnesses. This could attribute an ascendant's
wait to a non-existent year, quote it at collection, or prefer a fractional
succession Head and thin-line question in the shareable Afterimage.

The completed-book projection now requires safe integer years for Chronicle
witnesses, all four derived purpose cases, the Afterimage's quoted pages,
succession accession and thin-line question dates, as well as saved cadet-hall
extinction years when crediting a surviving hall or a documented lost hall.
Unfinished-world authoring
diagnostics remain unrestricted, as before. Regression cases in the existing
`ending.test.ts` suite cover rejected fractional dates, legitimate integer
witnesses, a fractional duplicate, both prose modes, and unchanged saved state
when reading. No gameplay, ending precedence, content, or save-format changes
are made.

This documents a mechanism repair only. Neither local execution nor the
exact-head hosted CI result is asserted here, and the parent issue's human
reader observations remain open.
