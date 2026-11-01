# Byname grant and provenance contract (implementation preparation)

**Status:** shipped as the record-claim source for [#1990](https://github.com/EldritchDynasty/EldritchDynasty/issues/1990), 1 November 2026. The sections below keep the 31 October audit; **What shipped** records what the code now does and where it departs from the proposal.

## What shipped (1 November 2026)

| Piece | Where |
| --- | --- |
| Authored wording | `byname: { slot, text }` on a Record block's `record` or `embellish` option (`schema/src/byname.ts`, `RecordBynameS`). Omit has no field for it. Plain English counterparts use the ordinary `proseVariants` address `….options.<pen>.byname.text`. |
| Validation | `byname/slot` (`schema/src/rules.ts`): a declared slot, a claim about that slot on the same pen, no `{TOKEN}`, no §29 bearing word, at most five words. |
| The one grant | `grantByname` (`core/src/byname.ts`), called at the end of `applyRecord` after the page is written. `resolveRecord` (the docket) and `afterRecord` (the chronicler's automatic pen) both reach it. |
| Eligibility | `eligibleByname`: the selected pen authors one; its slot cast exactly one person; that person was family of the player's house in the page's year (dead included); the committed page carries a claim about them; they hold no epithet or grant yet. |
| Saved provenance | `Person.byname` (`BynameGrantS`): `source { kind: 'record', event, pen, page, choice?, outcome?, discrepancy? }`, `year`, optional `settled`. The words are frozen into `Person.epithet` in the reader's prose mode at commit. Additive: no `SAVE_FORMAT` bump; an older save loads with its epithets and no grant. |
| Contest | `settleBynames`, called from the one real `discrepancy` prove/bury effect, stamps `settled` on the grant whose page is the **latest** embellished page carrying that authored id — found through that page's own claims. An earlier telling keeps its stamp, or stays `claimed` if it was superseded while open. |
| Read model | `bynameView` → `BynameView { text, standing, year?, page?, settledYear? }` on members, `line()` and Chronicle people; `recordBynamePreview` on Record dockets (derived, never saved); `RecordResolution.byname` for the receipt. Standings: `attested`, `claimed`, `contested`, `buried`, `unknown`. |
| Client | Docket preview per pen, receipt line, member card note with a link to the exact page, Recorded Life marks that page (`client/src/lib/byname.ts`). |

**Departures from the proposal below.** (1) The contest is stamped on the grant at settlement rather than projected from the discrepancy map, because the map cannot say which telling a proof addressed once an authored id repeats; this is the "occurrence-scoped proof identity" option, scoped to the grant and leaving the world's discrepancy model unchanged. (2) The words are stored once, in the reader's mode at commit, like every other saved page, rather than as an Original/Plain pair (`docs/LOCALISATION.md`: changing mode is prospective). (3) The source table is authored inline on the Record options rather than in a separate table, so a byname can only rest on the claims beside it. (4) **Known limit:** a `discrepancy: create` *effect* can reopen an authored id without writing an embellished page — today only `the_drowning_repeated`'s Omit pen does, for `the_second_drowning_lie`. If that template embellished once, later omitted, and the lie was then proven, the proof would settle the earlier embellished telling. That needs a rare template to fire twice with those pens and a proof after; fixing it needs per-occurrence identity on the discrepancy itself, which is a save-format change this slice does not make.

**Measured reach of this source.** Sixteen 500-year Long Lines under the ordinary chronicler (seeds 1990 + 37k, `main` at 5a788e3) committed claim-bearing Record pages about 59 of 192 Heads (30.7%) and 43 other people. That is the ceiling for any record-claim source, even if every claim-bearing block authored a byname. **"Most Heads" therefore needs a second source variant** (a death, succession or reign source) — an intentional new `BynameSource` case, not more wording on Record blocks.

## Existing contracts to preserve

| Mechanism | Shipped source and consequence |
| --- | --- |
| Person's label | [schema/person.ts](../packages/schema/src/person.ts) defines optional Person.epithet. [core/save.ts](../packages/core/src/save.ts) and [schema/save.ts](../packages/schema/src/save.ts) persist the optional string; older saves can lack it. |
| Initial authored label | [schema/content.ts](../packages/schema/src/content.ts), [core/sim.ts](../packages/core/src/sim.ts) and [people/factory.ts](../packages/core/src/people/factory.ts) can seed an epithet. The implementation must not overwrite one. |
| Read model | [core/session.ts](../packages/core/src/session.ts) exposes the value on a member; [client/Member.vue](../packages/client/src/components/Member.vue) already includes it visually and in the accessible name. This is **not** coverage of all #1990 surfaces. |
| The three pens | [schema/event.ts](../packages/schema/src/event.ts) RecordBlockS has separate record, omit and embellish options. Omit has a null Chronicle and **no claims**; embellish carries a discrepancy definition. |
| Record commitment | [events/decisions.ts](../packages/core/src/events/decisions.ts) applyRecord selects the outcome-created entry by its exact entryId. It records chosen option and resolved person-specific claims, freezes deed prose, writes a dated blank for Omit and links embellishment to discrepancyId. |
| Saved evidence | [core/world.ts](../packages/core/src/world.ts) and [schema/save.ts](../packages/schema/src/save.ts) carry ChronicleEntry.id (optional on old entries), record, claims, discrepancyId and the discrepancy map with open/proven/buried states. [core/record.ts](../packages/core/src/record.ts) folds claims; a deed claim is an attributed narrative claim, *not* objective truth. |
| Causal links | [core/cause.ts](../packages/core/src/cause.ts) uses exact Chronicle page identity and can resolve an answered proven/buried discrepancy to its embellished page. [core/run-library.ts](../packages/core/src/run-library.ts) creates a display-only year/index fallback for pages missing ids; that fallback is **not durable source identity**. |

There is no byname provenance or authoritative grant path today. The generated-name EPITHETS list in [people/names.ts](../packages/core/src/people/names.ts) is not Person.epithet and must never be treated as a grant.

## First candidate source: one already-authored Record moment

[waking_early](../packages/content/events/age_quickening.yaml) is a bounded **candidate**, not an approved incidence decision. The existing nine-year-old CHILD slot is the actual named person, not a string parsed from prose.

| Pen | Evidence already authored | Proposed byname behavior |
| --- | --- | --- |
| Record | A resolved deed claim on CHILD saying the child woke at nine, with the iron/milk signs | One modest, attested byname, worded in content in both registers |
| Omit | A dated blank with no claims | No new grant, no removal of an older byname |
| Embellish | A resolved trait claim on CHILD asserting sign_of_the_blood, linked to the_early_waking_lie discrepancy | A distinct flattering *claimed* byname; mark contested only if that discrepancy is later proven |

**Important asymmetry:** record has a deed claim; embellish has a trait claim, not a deed claim. A grant rule requiring the same claim kind in both branches would miss the lie. Specify the source using an authored closed source id plus per-pen requirements; check the committed page's person-targeted claims after applyRecord, never scan English for a phrase. The grant may only happen when the qualifying branch actually resolves; a selected event, pending docket or uncommitted choice is insufficient. Validate the source's actual fire rate before adopting it as the only source; an Age-bound uncommon scene cannot by itself prove most Heads acquire bynames.

Second candidate for later evaluation: [corran_what_came_back](../packages/content/events/arc_corran.yaml) records the named SON's return. A later source must be audited for all three pen branches and person availability before inclusion, rather than inferred from its story title. Do not change content while lane-content is held by another session.

## Proposed production contract — not yet added to the schema

1. **One authoritative commit boundary.** Evaluate eligible byname candidates only immediately after successful Record commitment in the core, using the *actual* page id and the resolved cast/claims. No client watcher, save loader, succession polling or text search may award a byname. Keep the existing outcome and death gates unchanged.
2. **Closed provenance discriminant.** Start with one source variant, record-claim, exhaustively handled with assertNever. Proposed durable grant shape: personId, source kind, sourceId (authored table entry), pageId, grantYear, selected pen, optional discrepancyId, and frozen Original and Plain byname wording. The existing Person.epithet remains an accessible display value. A second variant (death or succession) requires another intentional exhaustive case, not an arbitrary string.
3. **Source identity and ambiguity.** ChronicleEntry.id is required for a *new* grant. Never reconstruct an id from eventId+year, prose, or the run-library's year/index fallback: the same template can fire twice in one year. Resolved claims carry person ids; ambiguous multi-target events must have an explicit selection rule and tested uniqueness. For a record claim, authored source id + page id + claimed person is the idempotency key.
4. **Idempotency and precedence.** Do not grant if the person's historical source key is already committed. Preserve pre-authored epithets and legacy save epithets without inventing a source. For the first slice, first qualifying committed grant wins; later candidates cannot replace it silently. Determine the order from committed page sequence, not alphabetical event ids or RNG. A subsequent Omit never erases an old grant.
5. **Contest is a projection, not a rewritten past.** If the saved grant links an embellishment's discrepancyId, resolve its current state through the existing discrepancy map: open = claimed, proven = visibly contested, buried = buried/unproven (do not call it proven). Preserve historical byname wording and original source link in all states; show a distinct qualification when proven, not an omniscient correction or replacement. Do not infer proof from current hidden attributes. A proven discrepancy with a reused authored id could be ambiguous: before implementation, audit whether repeated writes to that id are possible and whether the existing discrepancy lifecycle is keyed per occurrence. If not, this source must not grant until that identity problem is solved.
6. **Saved history, not derived prose.** Add a schema/save definition for provenance alongside the existing optional epithet and serialize it through both store and restore paths, defaulting to absent for legacy saves. Store the rendered Original/Plain pair at commitment so a localisation or content update never renames history on load. Never generate a new grant in loadGame or during view reconstruction. Do not bump SAVE_FORMAT merely to mask an additive compatibility decision: follow the schema/serialization contract and test old-file semantics.
7. **Surface the source, not live world state.** GameSession must return a value-only byname/source/dispute projection with an exact Chronicle-page link. Client tree, Chronicle, Recorded Life, Afterimage and ending must use the shared person-label treatment including exports and screen-reader labels; the client must not read ctx.world. A source omitted from an old save is shown as unknown, not guessed.
8. **Authored wording belongs in content.** Two distinct Original/Plain forms per applicable pen must describe the same claimed act, with the embellished version clearly a house assertion rather than verified fact. Keep the voice registers and §29.4 forbidden-word lint. Neither an English deed string nor a translated label is a stable source id.

### Deterministic acceptance matrix for #1990

- Record, Omit and Embellish of the same sourced event with a constructed CHILD; verify award/absence, person id, page id, wording and linked discrepancy.
- Repeated same-template same-year firings award to the correct people/pages, not the last matching event/year; repeated commit/resume cannot award twice.
- Already-authored epithet survives a candidate, a later Omit and a death; a legacy epithet-only save remains unchanged and gains no fabricated provenance.
- Two qualifying sources resolve in explicit commit order; the earlier grant persists, including through succession/death and a save/load round trip.
- Open, proven and buried discrepancies have separate reader-visible states; proven only qualifies the *particular linked* embellished grant.
- Missing optional page id, missing person, ambiguous resolved targets and absent legacy evidence must fail closed without creating a misleading source.
- Both prose modes, every requested UI surface, long/repeated names, SVG/PNG exports and accessible labels must resolve the same historical source.
- Measure grant incidence by campaign and by Heads versus other relatives in a declared slow lane across paired seeds; report grants and proven contests separately with denominators and uncertainty. Provisional target to test rather than tune blindly: a minority of all relatives, with Heads more likely to be labelled. Do not claim this tests the actual-reader three-people attachment question (#44).

## Repeated-discrepancy audit — 1 November 2026

A Discrepancy's `id` is an **authored content identifier**, not an occurrence identifier. `applyRecord` saves the same `discrepancyId` on each embellished Chronicle page and writes `world.discrepancies.set(id, { ..., state: 'open' })` on every firing. If the same authored Record fires again, that resets the single shared state even when the first incident had already been proved or buried. Its pages keep distinct `ChronicleEntry.id` values and distinct resolved people, but the discrepancy map does not preserve which particular incident the later proof addressed.

The reader's `causeOf` / `answeredBy` fallback used to select the **first** embellished page for an authored discrepancy id, so a later proof could misleadingly cite the wrong person's page. The `cause.ts` correction is intentionally conservative: it indexes a unique origin only when exactly one embellished page carries the id. With two or more, it does not synthesize a cause; an explicit `ChronicleEntry.cause.page` still resolves by exact page identity. `cause.test.ts` covers unique, repeated, open, proven and buried cases as well as explicit page links.

**Implication for bynames:** a page-id/person-id grant can be historically identified, but a shared authored discrepancy **state cannot prove that particular grant contested** after repeated occurrences. Before implementing an embellished source's contest projection, either introduce occurrence-scoped proof identity throughout writers/readers/saves, or fail closed for ambiguous ids and expose that limitation to the reader. Do not associate every grant carrying the same authored id with one proof, and do not infer a source from prose or `(event, year)`. This slice fixes a misleading Chronicle link; it does **not** make byname contests occurrence-specific or change the world's saved discrepancy model.

## Delivery boundary

The record-claim source, its saved provenance, contest stamping, read model and client surfaces shipped with #1990 (see **What shipped**). Still open, and not claimed by this work: a second source variant to reach most Heads, and the actual-reader #44 "three people" question, which no automated run can answer.
