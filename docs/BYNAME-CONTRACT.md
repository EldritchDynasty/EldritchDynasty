# Byname grant and provenance contract (implementation preparation)

**Status:** source-audited design contract for [#1990](https://github.com/EldritchDynasty/EldritchDynasty/issues/1990), not a shipped byname rule. This file documents the smallest first slice and its blockers. The implementation, content wording, UI, save changes and incidence measurements remain on #1990. Audit: 31 October 2026, main at ed51de1.

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

## Delivery boundary

This document changes **no** simulation behavior, content, save format or UI. A full implementation needs independent claims for the exact schema/core/client paths, plus lane-content for YAML and lane-gates for gate tooling. The sources above are verified plumbing, not tests executed in this documentation-only slice. Close [#2076](https://github.com/EldritchDynasty/EldritchDynasty/issues/2076) for this contract only; leave [#1990](https://github.com/EldritchDynasty/EldritchDynasty/issues/1990) open until implementation, deterministic tests, real batch measurement and reader observation.
