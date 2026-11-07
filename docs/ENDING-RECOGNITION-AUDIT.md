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


## Follow-up: a counted household has whole, non-negative people (7 November 2026)

The Afterimage's smallest documented thin-line generation count was guarded by
`Number.isFinite`, which also accepts negative, fractional and
beyond-safe-integer counts in damaged or recovered succession-question data.
This can make a completed book announce half a relative or an impossible
negative household even when another, credible dated question survives.

For completed books only, `afterimageEvidence` now requires the question's
`baseline` to be a non-negative safe integer. Valid zero counts remain
admissible, and unfinished authoring inventories retain their existing
finite-number diagnostics. An existing ending test suite adds both prose
modes, negative/fractional/unsafe contrasts, an independently valid fallback,
and save-digest immutability. This changes only the evidence projected into
the last-night Afterimage, not succession, gameplay state, ending eligibility,
or the original #1983 participant-study requirement.

The connector edit alone does not establish a local npm preflight or a green
hosted CI verdict; those must be reported separately.

## Follow-up: a thin-line count belongs to a credible succession tenure (7 November 2026)

The Afterimage's smallest generation-opening blood count was previously taken
from any in-term `thin_line` question with a plausible date and numeric count.
Unlike the neighboring ancestral-silhouette selection, it did not verify that
the succession row's named Head existed and was alive at accession, or that
the question was actually opened during that Head's tenure. A recovered book
could therefore project a spurious minimum of one from an impossible reign,
even while its displayed last seal-holder rejected that same row.

For a **completed** book, `afterimageEvidence` now admits a count only when
the accession has an existing, living-at-accession Head, the question's opening
falls between that accession and its recorded end (if any), and each recorded
tenure boundary is a whole safe-integer year. Earlier valid questions remain
eligible as a fallback. Unfinished authoring inventories remain unchanged.

The added `ending.test.ts` regression checks absent, unborn and already-dead
Heads, pre-accession and post-tenure questions, fractional tenure boundaries,
a supported fallback, both prose modes and read-only saved-state behavior.
The existing `byname-chronology.test.ts` also now distinguishes advancing the
collection year (which cannot rescue a question predating its Head's tenure)
from updating that question to its real accession year; unfinished synthetic
diagnostics continue to admit the original inconsistent fixture.
This is one bounded evidence-integrity correction, not participant acceptance
for #1983. Local npm tests and exact-head CI are not claimed by the edit.


## Follow-up: named people require whole-year life evidence (7 November 2026)

A completed Chronicle already rejects fractional page years and branch
membership/birth dates. The separate named-person join still accepted a
fractional `Person.born` for an ascendant wait or a successful blood-relative
rite. A fictional `1541.5` birth is not a dated human life, even when a
matching rite's page, outcome and death mark agree. Ascendant waits likewise
accepted a fractional `Person.died` value later than the page. The
Afterimage's named memories and rite witnesses compared birth dates without
requiring a whole year, so its image could perpetuate the same attribution.

Child #3226 requires safe integer birth dates for completed-book named
Afterimage sources and rite evidence, and for the Long Line's blood and
ascendant purposes. A recorded death year for an ascendant witness must
likewise be a safe integer. Unfinished authoring inventories retain their
permissive synthetic dates. Existing tests now contrast invalid fractional
dates with the same valid whole-year witnesses, including both prose modes,
stable ending choice and unchanged save digest during reads.

This corrects a recoverable evidence boundary; it does **not** establish
Android/browser acceptance, a full local test run or the reader observations
still required to close #1983.


## Follow-up: a recovered death needs a credible calendar year (7 November 2026)

The Long Line `secure_branches` purpose checks residence and founding
chronology at the **saved** last night. The earlier birth/membership audit
rejected fractional or impossible membership dates, but left a separate gap:
`person.died` and `founder.died` were compared to term years without
validating them. A restored save with a fractional, `NaN`, or unsafe death
year could be credited with a surviving blood relative or a founding witness
despite its impossible lifetime.

The bounded correction in `ending.ts` requires any present death year to
be a safe integer before crediting a collection-year resident or charter
founder. An ordinary valid death after collection remains eligible as
evidence of survival on that night; a founder who died after the legitimate
charter need not survive to collection. No death or save data is repaired
or rewritten, and no player action, RNG, ending precedence or format changes.

The existing `ending.test.ts` suite now contrasts malformed founder and
resident death years with valid post-collection deaths, reads both prose
modes, holds the recorded last-night year against a later world clock and
checks read-only digest preservation. This is **mechanism coverage** only:
real-reader purpose recognition for parent #1983 remains unevaluated, and
local and hosted test verdicts must be reported separately.

## Follow-up: a last-night seal-holder needs a whole-year lifetime (7 November 2026)

The completed Afterimage already checks that a succession row's Head existed
and was alive at accession, but those comparisons accepted recovered fractional
or unsafe `Person.born`/`Person.died` values. A malformed later Head could
therefore replace a credible earlier ancestral silhouette and supply the
smallest generation-opening blood count, even though the book did not contain
a valid calendar-year lifetime for that Head.

The bounded `afterimageEvidence` correction now requires safe-integer birth
years, and safe-integer death years whenever present, **for completed-book
succession Head and thin-line witnesses**. The existing admissibility rules for
accession, question, tenure and population count remain unchanged. A legitimate
death after accession remains eligible; unfinished synthetic authoring
inventories retain their prior permissive behaviour.

A regression in the existing `ending.test.ts` suite contrasts fractional,
non-finite and unsafe lifetime dates against a valid older accession, checks
both Original and Plain English, confirms a legitimate death year, verifies
ending selection and read-only save digests, and preserves unfinished diagnostic
behaviour. No authored content, ending precedence, save-format or gameplay
rules change. The parent #1983 still requires actual-reader acceptance;
connector-only editing does not establish a local preflight or hosted CI pass.

## Follow-up: an impossible reign cannot displace the last credible Head (7 November 2026)

A recovered completed Afterimage checked the succession Head's accession year
and lifetime, but did not validate the recorded end of that Head's tenure.
A row whose `to` year was fractional, unsafe or **earlier than its `from`**
year could become the image's final ancestral silhouette. The neighboring
thin-line count already rejected such a tenure, leaving the image contradicting
itself: it named the disputed Head while falling back to an earlier Head's
documented generation count.

The completed-book `afterimageEvidence` projection now applies a whole-year,
not-before-accession guard to any supplied succession end year, matching the
thin-line evidence boundary. An omitted end year remains admissible, a same-year
tenure remains admissible, and unfinished authoring/test inventories retain
their existing synthetic flexibility. The existing `ending.test.ts` suite
contrasts a reversed, fractional, non-finite and unsafe tenure end against an
earlier credible Head, and preserves valid tenure witnesses in both prose modes,
ending selection and saved-state read purity.

This is a narrowly evidenced history-integrity repair, not a reimplementation
of the four already-shipped ambition-purpose cases. Parent #1983 still needs
actual-reader acceptance; no local or hosted test result is claimed until run.
