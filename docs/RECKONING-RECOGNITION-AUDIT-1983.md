# Long Line purpose recognition: mechanism audit (#1983)

**Disposition (6 November 2026):** The four existing, evidence-backed purpose readings are sufficient for the currently **demonstrable** historical cases. Do not add a fifth passage, a claim of player rescue, or a rite-refusal celebration without a recorded act and a reader-observed gap. The remaining acceptance criterion is a real-reader last-night study; it is **not complete**. This is a source-and-test audit, not a participant result or a full resolution of #1983.

## Scope and sources

Reviewed the current `packages/core/src/ending.ts` (`purposeOf`, `epilogueOf`), `packages/core/src/afterimage.ts`, `packages/core/src/ending.test.ts`, and `packages/client/src/components/Ending.vue` on 6 November 2026. In particular:

- [Purpose selection](../packages/core/src/ending.ts) is a derived `EpiloguePurpose` projection. It is available only to the **Long Line**; the existing `selectEnding` remains the authority for ending eligibility and precedence.
- [Afterimage evidence](../packages/core/src/afterimage.ts) joins outcomes to **one** surviving event/year Chronicle page. A cast or name alone does not establish a rite result. The image's first spent person need not belong to the player's bloodline, so `spentBlood` separately selects a qualifying blood-relative cost.
- [Ending client](../packages/client/src/components/Ending.vue) presents the purpose as an attributed account beside the ambition/status and reckoning. Original and Plain English frames explicitly distinguish a book's testimony from an omniscient verdict.

This audit treats code and saved evidence as the implementation contract. Earlier issue text saying these passages were absent describes an older baseline, not the current build.

## Four existing recognition cases

| Tracked purpose | Acted and supported at collection | Unpursued, lost, or ambiguous evidence | What the reader actually sees |
| --- | --- | --- | --- |
| `deepen_blood` → `blood_spent` | A house-blood person marked as dying in a real successful rite, matched to a unique, named, written Chronicle page and the exact outcome/cast. A later qualifying blood-relative cost still counts if the broader Afterimage first selected an outsider. | Selection alone, cast without successful rite, outsider-only cost, missing/omitted/greyed/future/duplicate page, or an ambiguous outcome-to-page join produces no purpose passage. An embellished page may be shown **as an embellishment**, never as independent fact. | Names the relative, rite year, and page words; states that this is the house's account of a cost, not proof of all that occurred. |
| `secure_branches` → `branch_kept` | A dated, valid male blood-relative founder/charter, a viable cadet hall, and a uniquely documented living blood relative beneath that roof **at the last night**. | Ambition without a qualifying hall, extinct hall, inadequate family, invalid founder, contradictory positive membership, birth after collection, or an unsupported legacy history gives no passage. Older charters **without** a dated membership can use the charter fallback; contradictory positive membership cannot. | Names founder, hall, founding year and survivor. An independently dated lost hall may be mentioned, without inventing who caused its extinction or who rescued the survivor. |
| `restore_ledger` → `ledger_witness` | A genuinely recovered **non-inherited** clause and exactly one still-readable, illuminated, named Chronicle page matching its authored name and text (Original or frozen Plain English). | An inherited clause, recovery counter alone, altered text, unrecorded recovery, greyed/omitted/embellished/future page or ambiguous duplicate does not suffice. | Names the clause, year and surviving contract words; explicitly does **not** infer that the debt was paid. |
| `raise_ascendant` → `ascendant_wait` | A surviving uniquely attributed `ledger_wait:<person-id>` paragraph for a blood relative with an existing identity, a demigod marker, and the page's unchanged words. | Selected ambition without the wait page, lost/omitted/rewritten/duplicate or future-dated page, nonexistent person, or testimony outside the campaign term gives no passage. | Names the person and year of the unfinished wait; it is the family's witness, **not** proof of a later ascent. |

All four intentionally return **no** `purpose` for a Short Line. Absence is preferable to praising an unacted ambition or treating silence as proof of a virtuous choice.

## Mechanism and contrast evidence

The committed [ending tests](../packages/core/src/ending.test.ts) exercise these distinctions:

- `blood_spent` (`describe` near line 1324): witnessed death versus casting, outsider versus blood-relative, embellished versus omitted/greyed, duplicate or later accounts, bynames earned only as of collection, and preservation of ending and state digests.
- `branch_kept` (near line 1659): documented viable hall versus ambition-only or invalid evidence; a named living relative; founder and survivor byname date; lost-hall bounds; collection-time membership and later-death recovery; ambiguous/repeated membership and the legacy-charter exception. The contradictory-membership repair is already merged via [PR #3056](https://github.com/EldritchDynasty/EldritchDynasty/pull/3056) and child [#3055](https://github.com/EldritchDynasty/EldritchDynasty/issues/3055). **Do not repeat it as new work.**
- `ledger_witness` (near line 1887): surviving original/frozen Plain English text, recovery without a page, known page without recovery, omitted/greyed/altered/embellished/duplicate/future evidence, unchanged ending ID and world digest.
- `ascendant_wait` (near line 1999): identity and unique ledger-wait source, the changed prose mode, preserved detached evidence, collection-time bynames, missing/reclassified/duplicated/future pages, and unchanged ending ID/digest.

The afterimage's people/line inventory is a separate attributed projection: `people[].sources` come from existing written pages and `line[].record.parents` uses **claimed** parentage. It is not an independent historical witness to rescue, truth, or an ambition's success. The ending panel pairs that inventory with `beginning.ambition`, the four narrow optional purpose passages and the creditor's own summary. This preserves the creditor's partisan voice and the Original/Plain English distinction without rewriting the ending prose or granting an achievement.

**Verification performed here:** source and existing-test inspection only, with the explicitly cited cases above. No new Vitest run, full preflight, slow campaign measurement, device test, or participant interview was executed by this connector-only audit. Required CI of any PR remains independent evidence.

## Gap disposition: do not invent what the save does not establish

The user-facing hypothesis also mentions *protecting a named relative* or *refusing a rite*. Neither a live relative nor the absence of a rite establishes that the player deliberately protected that person or refused a specific opportunity. The four existing witnesses do not imply these deeds; that restraint is correct. Adding such prose would require a **specific, surviving, uniquely attributable** command/decision outcome (with time, person, page or public projection as applicable), an observable consequence or cost, and handling of omitted/greyed/embellished/duplicated and legacy evidence. A same-year coincidence or an ambition chosen on the start screen is insufficient.

**Engineering disposition:** no fifth purpose branch is adopted on current mechanism evidence. The four implemented recognitions and their contrasts already satisfy the demonstrable portion of the audit. If reader observations identify a narrower failure, open/claim an independently landing child with the exact save/page/person keys and negative cases; do not widen this parent into speculative content or change ending precedence. Any new authored prose must follow the content lane and its prose guides. #1989's interactive creditor remains a separate, unapproved design boundary.

## Reader acceptance still outstanding

Observe real readers on the **complete Long Line last night** (not just on an isolated purpose screenshot), and record:

1. Build/source revision, campaign, prose mode, save provenance, which purpose witness was present or absent, and whether the Chronicle had blanks, disputed or embellished material.
2. Their own description **before prompting** of the purpose they pursued, who benefited or was spent, what cost was paid, and whether they distinguish this from achieving ascent.
3. Whether they correctly distinguish the creditor's claims from the house's evidence; log misunderstandings tied to an exact displayed line, page or action, and note interrupted/incomplete sessions.
4. A dated disposition for each observed gap: no change, evidence repair, bounded wording/projection change, or broader design decision. Preserve both positive and no-witness histories and test both prose modes.

No such reader finding has been supplied by this audit. **Keep parent #1983 open** until its original participant acceptance has a dated evidence report. This document completes only the requested bounded *mechanism assessment*.
