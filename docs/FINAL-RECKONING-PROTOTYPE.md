# Final reckoning — paper prototype for #1989

**Status: design proposal, not an implemented feature.** Prepared 30 October 2026 against the shipped ending/Chronicle contracts. The owner approved the *shape* of an up-to-three-page interrogation on #1989, but **has not approved the prices below**. Do not build its mechanics or prose until the owner signs off on them. This file changes no game rules.

## What is true in the current game

- `readTheChronicle()` counts legible pages, blanks, proven/open Discrepancies, attested and substantiated rungs and recovered clauses. An open, embellishment-linked Discrepancy withholds proof by severity (1:2:4); a *proven* lie has already paid its historical scandal/Respect penalty and must not be charged a second time. A buried lie is not outstanding proof debt.
- `selectEnding()` currently resolves **Broken Line first**, then failed rite/Unmade, substantiated Apotheosis, Devoured, Short/Demonstration settlement and Forgotten. A written rung cannot overtake `world.ascension.best`.
- `closeTheLedger()` currently selects/stores `world.ending` and appends the Term page immediately. `GameSession.advance()` stops when `world.ending` is set. `epilogueOf()` consumes a finalized ending. Placing buttons in `Ending.vue` alone would be too late.
- The Chronicle's Record/Omit/Embellish consequences and `commitOutcome` are authoritative. A presentation component must not rewrite the book, settle Discrepancies or alter the ending.

## Proposed lifecycle, before any Vue UI

1. The campaign reaches the existing collection boundary, with the year's normal decisions resolved. **Do not** select an ending or write the Term page yet. Record a deterministic **pending reckoning** snapshot in saved world state: campaign and year, ordered challenge IDs, the exact Chronicle entry IDs and eligible citation entry/account IDs, selected answer and citation for each completed challenge, and a current index. The snapshot must survive save/resume; do not derive IDs from localized prose or regenerate challenges after reload.
2. Pick **at most one per type**, in stable type order: (a) an outstanding Discrepancy *linked to an embellished source entry*; (b) a dated omitted/blank Chronicle entry; (c) the surviving attested-rung entry, if any. Within a type pick by a declared stable sort (proposed: source `year`, then entry `id`; for an outstanding lie, stable Discrepancy ID as final tie-break). Do not sample, reseed or manufacture evidence. Unlinked ambient Discrepancies are not contested as though the house authored them.
3. The reader sees the creditor's *partisan* question with the exact dated page and only documents or accounts the house genuinely holds. The buttons are **Stand by the page** (choose a cited held page/account), **Confess**, and **Keep silent**. No numeric weight, Respect meter, proof threshold or Bearing is shown in the 1542 frame. The citation selector is a page surface, not a hidden stat picker. A missing citation disables Stand rather than inventing a witness.
4. A player answer blocks the clock like other dockets. Record one typed command against the currently pending challenge ID, validate the citation and reject stale, out-of-order or duplicate answers. Resolve once through a single authoritative core commit path; never apply an outcome in Vue. Advance the pending index and persist the resulting record/provenance. If the next challenge is still pending, remain on the same collection year.
5. After the last answer—or immediately if **zero** challenges qualify—perform **one** final reading against the resulting evidence, then call the existing ending precedence **once**, append the Term/withheld pages **once**, and expose the existing ring/epilogue. Term pages are results, never new evidence for challenge selection. Do not offer a replay of completed challenges upon load.

### State, migration and replay boundary

An implementation needs a closed pending-reckoning/answer vocabulary in schema and core, an explicit save format migration/default for old saves, deterministic command-log replay, and a new blocked presentation state in `GameSession`. Use `assertNever` at closed-union consumers. An old save with a finalized `world.ending` remains finished and shows no questions. New saves in the middle retain the source pages, choice index and already-paid costs without reapplying them. The draft must decide whether changes to an existing Chronicle entry create a dated appended *correction* (preferred) rather than mutating historical text; the creditor is never an omniscient referee.

## Prices to take back to the owner — **not approved**

These are explicit **candidate stakes**, not existing implemented behavior. They use the current book/Respect/clauses/rung concepts rather than adding a new currency. Each answer has a disadvantage, and a failed citation must not receive a free proof award.

| Challenged page | Stand by page — proposed risk/price | Confess — proposed certain price | Keep silent — proposed price |
| --- | --- | --- | --- |
| **Standing Discrepancy** (open, tied to an embellished page) | Must cite an independent held page/account identifying the same act. Provisional **one recovered clause pledged as surety**; on a contradiction the surety is forfeited and the Discrepancy remains open. A valid corroboration may help the creditor accept the page, but cannot establish a rung above actual attainment. | Append a dated admission attached to the source; settle the open Discrepancy as **proven**, using its existing **one Respect-tier/scandal** cost *exactly once*, rather than also charging its open-proof weight. Historical facts are not retroactively rewritten. | Preserve the original embellishment, its open Discrepancy, and its existing **1/2/4 unsupportable proof weight**. No immediate currency loss; the last reading may withhold a rung. |
| **Dated blank** (Omit) | Cite an extant independent page/account establishing the omission's subject. Provisional **one clause pledged** to support the silence; if that document cannot address the omission, it is forfeited and the blank stays a blank. No invented lost knowledge. | Add an explicitly **new dated truthful admission**, not text magically recovered from the old blank; provisional **one Respect-tier cost** for making an ignominious act public. The original blank remains historically visible and cited. | Leave the blank unreadable and accept **loss of this chance to introduce corroborating testimony**. No instant proof grant or new Discrepancy merely for declining to answer. |
| **Attested rung** (existing surviving page) | Cite an independently held rite/attestation page. Provisional **one recovered clause pledged**; if the evidence is inadequate, the creditor declines the claim and the surety is lost. The existing `best` truth ceiling is absolute. | Append a dated retraction and **reduce the book's claim by one rung at most**, capped by real attained power; it may sacrifice a more favorable ending, and the claim cannot silently be restored by old text. | Leave the claim uncorroborated; provisional **one rung of evidence withheld**, even if an otherwise safe attestation would have survived. It cannot grant Apotheosis. |

**Trade-off / cautions:** Pledging a clause may make settlement impossible and could be disproportionate to a poor house, while a confession near term could have no later scandal event to deliver. A final-night Respect cost with no downstream consequence is *not a real cost*. These are open design questions: before implementation the owner must settle whether collateral is available in all campaigns, how a clause can be pledged without corrupting `clausesRecovered`, what in-world effect a terminal Respect loss has, how independent citation adequacy is judged without an omniscient truth verdict, whether rung reductions are temporary proof rulings or lasting record corrections, and whether a confession's existing proven-lie cost can be applied at the term without duplicate billing. No table cell is authorization to change `Reckoning` arithmetic.

## Paper scenarios and expected boundaries

| Hand-made house at term | Challenge candidates | Expected paper behavior |
| --- | --- | --- |
| Open embellished lie with source page and held independent witness | Discrepancy; possibly others | Stand can cite a real witness; Confess creates a **dated admission** and pays once; Silence leaves the weighted open-proof debt. Different choices may affect the existing `substantiated` result, never `ascension.best`. |
| Open lie with **no** independent witness | Discrepancy | Stand unavailable; Confess and Silence remain meaningfully distinct. No automatic truth judgment from the creditor. |
| Only a dated omitted page with no corroborating material | Blank | Stand unavailable. Confession can add *new testimony*, not reconstruct unknowable past; Silence leaves the blank. |
| Attested god on a forged page, actual best below god | Rung | Every choice respects the **actual best** ceiling. Apotheosis is unreachable by simply standing by the forgery. |
| Already-proven lie or buried Discrepancy | None of the open-lie type | No renewed charge for the proven lie; buried evidence does not suddenly become open again. |
| No eligible sources in the Chronicle | **Zero** | No interrogation screen; finalization follows the existing ending path once. |
| Short Line with all clauses and corroborated book | Whatever qualifies | A pledged clause may imperil **Settled**; final selection still applies the existing Short-specific rules and the other higher-precedence endings. |
| A failed God rite | Whatever qualifies | Reckoning cannot undo an already failed rite; **Unmade** retains precedence after a living line check. |
| Broken Line, no living mortal blood | See comparison below | Do not conjure a living heir or change the guardian's status; **Broken Line** remains first. |
| Save during answer 2; reload and submit answer 1 again | Persisted challenges | Reject stale answer and never settle an evidence item twice; the same eventual ending as an uninterrupted run. |

### Broken Line: both owner-requested paper alternatives

**A. No interrogation (recommended).** When `livingBlood === 0`, go directly to `broken_line`: the creditor reads alone. This preserves §23's empty table, current precedence and absence of a living respondent. The guardian may still be present in lore, but cannot stand in for an extinct lineage in the ending test. This is a coherent *absence* of the last-night player choice, explained by what the house lost.

**B. Founder guardian answers.** The founder is permanently castable as a guardian (invariant 3), so an exceptional final page could be addressed to that voice while `livingBlood` stays zero and `broken_line` remains unavoidable. This gives a player a reckoning even in defeat, but risks making the creditor's "read alone" ending false and creating nonfunctional answers. If chosen, it needs separate authored framing, replay tests and a meaningful consequence (e.g. a remembered final admission), *not* a rescue, a resurrected founder or a changed ending ID.

**Recommendation:** A until observed players give a reason for B. The owner must pick; implementation may not silently take the recommendation.

## Acceptance gates before turning this into code

1. Owner signs off on **each answer's terminal stakes**, eligibility/citation policy and Broken Line A/B.
2. Written finalization/decision API contract includes save migration and single-commit/replay rejection tests; no new effect executor.
3. Constructed tests cover each source, no source, false/missing citation, proven/buried/open evidence, all ending precedences, command replay, interrupted save, prose modes and accessibility.
4. Existing ending and corpus gates measure real consequences on declared seeds, with no claim about player enjoyment until people are observed.
5. Frame text remains the creditor's interested account; the existing prologue/epilogue ring changes exactly one element.

This document is a handoff for **#1989 step 1 only**. No code, content or balance change has been made, and no player testing is claimed.
