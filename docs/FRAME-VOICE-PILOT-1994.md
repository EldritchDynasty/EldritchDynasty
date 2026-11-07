# Frame voice pilot: source inventory and decision gate

> **Preparation only — Refs #1994.** No voice feature, recording, casting, script rewrite, budget approval, or exemption from the frame's silence rule is authorized by this document.

## Provenance and counting boundary

- Source: [`packages/content/events/frame.yaml`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml) at repository commit `117f491eba161972361ab744f21c7f7864041b7c`; file blob `ec0f878aea3198ddadec108969e1803bf505201a`. Re-inventory after any edit to this source or its Plain English variants.
- The authored file has **28 frame event templates**, not 28 interludes guaranteed in one campaign. Concept §2's **12–18 interludes per full run** is a presentation aim; eligibility, choices, and frequency determine what actually appears. This inventory does not measure reach.
- There are **85 Plain English `proseVariants` entries**: title, body, and outcome for each event, plus one extra outcome for `frame_the_west_house_again`. Every listed event has a matching title/body/outcome variant at this revision.
- Counts below are whitespace-separated tokens in **body plus one possible outcome text**, before runtime interpolation; titles, comments, cast, and eligibility metadata are excluded. Two counts separated by `/` are alternative outcomes, not words that play together. Counts are *script planning estimates*, not spoken duration or syllables.
- The `of` values on `proseVariants` refer to corresponding source strings; the file blob/commit pins the whole snapshot. Neither is an audio asset checksum. Actual clips must pin an exact **event ID + prose mode + resolved script revision**, including any substitutions.
- **15 of 28** events have dynamic narrator or page placeholders in their original text, and **13 are static** as written. Do not record an unexpanded token or assume one voiced line represents every player-supplied value. The pilot deliberately uses three static candidates.

## Complete authored inventory

| Frame event | Source title | Original / Plain English words | Runtime text |
| --- | --- | ---: | --- |
| [`frame_the_seal_still_west`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L17) | A Box in Someone Else's Hallway | 45 / 42 | Static |
| [`frame_what_the_ledger_says_of_the_seal`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L42) | A Trusted Branch | 85 / 100 | Static |
| [`frame_two_of_three`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L75) | The Third Piece | 50 / 55 | Variable: `{NARRATOR.They}`, `{NARRATOR.s}`, `{NARRATOR.they}` |
| [`frame_the_cost_not_written`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L106) | What the Book Did Not Say | 68 / 68 | Variable: `{NARRATOR.They}`, `{NARRATOR.is}`, `{NARRATOR.s}` |
| [`frame_the_second_time`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L147) | Nine Days, Twice | 63 / 63 | Static |
| [`frame_nine_libraries`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L178) | What Burned, and What Was Kept | 53 / 56 | Variable: `{NARRATOR.They}`, `{NARRATOR.es}` |
| [`frame_the_northern_house`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L205) | Not Heard From After | 88 / 84 | Variable: `{NARRATOR.their}`, `{NARRATOR.they}`, `{NARRATOR.has}`, `{NARRATOR.them}` |
| [`frame_the_short_account`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L249) | Three Other Accounts | 55 / 58 | Static |
| [`frame_the_bought_silence`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L274) | Eighty Years of Not Being Looked At | 56 / 64 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}`, `{NARRATOR.them}` |
| [`frame_the_west_house_again`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L302) | Still Not Corrected | 51/62 / 54/63 | Static |
| [`frame_the_keeping_of_it`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L330) | The Branch That Was Never Named | 55 / 59 | Variable: `{NARRATOR.they}`, `{NARRATOR.has}`, `{NARRATOR.They}`, `{NARRATOR.s}` |
| [`frame_the_missing_third_returns`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L368) | The Count, Again | 50 / 50 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}` |
| [`frame_the_drowning_remembered`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L414) | The Trough, Still Filled | 56 / 55 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}`, `{NARRATOR.their}` |
| [`frame_the_index_in_another_hand`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L458) | Eleven Quires | 104 / 98 | Static |
| [`frame_the_copy_that_was_short`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L488) | Ten Years and a Half | 87 / 86 | Static |
| [`frame_read_out_in_a_hall_at_cawdry`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L517) | Item Nine | 126 / 129 | Static |
| [`frame_nothing_worth_the_ink`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L556) | In the Ordinary Way | 171 / 165 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}`, `{NARRATOR.they}` |
| [`frame_the_short_minute`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L610) | Three Nouns, and a Minute With Two | 114 / 114 | Static |
| [`frame_what_the_ring_cost`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L642) | Both of Them Were Trouble | 105 / 104 | Variable: `{NARRATOR.They}`, `{NARRATOR.es}`, `{NARRATOR.they}`, `{NARRATOR.them}` |
| [`frame_the_rule_of_two`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L673) | What Was Always in the Room | 117 / 113 | Static |
| [`frame_one_word_and_eight_days`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L704) | One Word, and Eight Days | 130 / 128 | Variable: `{NARRATOR.they}`, `{NARRATOR.has}` |
| [`frame_the_colour_of_its_own_paper`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L737) | The Colour of Its Own Paper | 116 / 115 | Variable: `{NARRATOR.They}`, `{NARRATOR.es}`, `{NARRATOR.was}` |
| [`frame_the_grates_and_the_hour`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L800) | Seven Grates, One Lit | 111 / 104 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}`, `{NARRATOR.them}` |
| [`frame_the_hour_the_clocks_agree`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L833) | Four Minutes | 95 / 92 | Static |
| [`frame_what_the_table_was`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L863) | The Length of the Table | 118 / 111 | Static |
| [`frame_the_page_he_does_not_turn`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L894) | A Page Left Face Down | 119 / 112 | Variable: `{PAGE_YEAR}`, `{PAGE_SUBJECT}`, `{NARRATOR.they}`, `{NARRATOR.s}` |
| [`frame_the_ninth_name_unspoken`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L933) | Eight of Nine | 102 / 98 | Variable: `{NARRATOR.They}`, `{NARRATOR.has}`, `{NARRATOR.they}` |
| [`frame_the_weight_of_a_sentence`](https://github.com/EldritchDynasty/EldritchDynasty/blob/117f491eba161972361ab744f21c7f7864041b7c/packages/content/events/frame.yaml#L982) | The Weight of a Sentence | 137 / 137 | Static |

## Three representative pilot pages (proposal; not approved)

Choose **only one prose mode** when authorizing a pilot; never label Original spoken over differing Plain English as matching captions. These three sample the frame's distinct jobs without inventing interpolated family names or narrator forms.

1. **House account — “A Trusted Branch”** (`frame_what_the_ledger_says_of_the_seal`): 85 Original / 100 Plain English words. Eligible only when `seal_the_grandson_presses` was chronicled. Its text distinguishes the letter's surviving page from what the family wrote under it. Useful test of controlled quiet and legally particular prose without changing the truth of the page.
2. **Contradictory evidence — “Three Other Accounts”** (`frame_the_short_account`): 55 / 58 words. Requires `the_thin_papers` discrepancy in the `proven` state. An intentionally shorter reading: does the voice leave the creditor's judgment partisan instead of sounding like an omniscient verdict?
3. **Atmospheric silence — “Four Minutes”** (`frame_the_hour_the_clocks_agree`): 95 / 92 words. Requires at least two recorded pages. Tests the cost of voicing a frame whose baseline rule is *page turns and nothing else*, without a named character or evidence interpolation.

All three have one authored outcome and no `{NARRATOR.*}`, `{PAGE_YEAR}` or `{PAGE_SUBJECT}` token in the Original text. These are **candidate recordings**, not a promise they appear together, or at all, in ordinary play. Before usability or playback testing, construct explicit eligible and ineligible histories using their existing `reads` predicates; do not weaken gates just to make a demo.

### Pilot revision manifest to freeze **after** approval

| Event ID | `body` source fingerprint (`proseVariants.of`) | Outcome source fingerprint (`proseVariants.of`) |
| --- | --- | --- |
| `frame_what_the_ledger_says_of_the_seal` | `dfa12bbee74e2b52` | `38fd6bf0cef44b3c` |
| `frame_the_short_account` | `10b128f3438fefef` | `a3f398dddb06ff89` |
| `frame_the_hour_the_clocks_agree` | `f3d3fd7538b63759` | `8c63367ae5e2ed6e` |

At casting time freeze the final script, selected mode, exact displayed body **and outcome**, pronunciation guide, and immutable exported audio checksums beside this manifest. A revised source text invalidates the corresponding clip until it is reviewed/re-recorded or explicitly mapped, not silently played over a new caption. Titles above are editorial locators, not automatically spoken lines.

## Owner decisions — the gate before recording or implementation

| Decision | Concrete choice to record | Reason it cannot be inferred |
| --- | --- | --- |
| Change concept §§2 and 24? | Voice **yes/no**, and exactly when voice is allowed; retain drone silence and decide whether page-turns may coexist | Today the frame is expressly slower and silent except page turns. Voice is a design exception, not merely another cue |
| Speaker and character status | Last of the blood / founder-guardian / disembodied reader / other; whose knowledge and point of view? | The creditor is *not a person*. The voice must not turn a partisan account into impartial systems information |
| Spoken prose mode and on-screen text | Original, Plain English, both separately, or defer; record localisation boundary | Each event has mode-specific prose with differing wording and length |
| Budget and performer | Maximum approved pilot spend, casting brief, performer and post-production scope | Three pages are a budget proposal, not a purchase authorization |
| Script and rights freeze | Mode/revision, dynamic substitutions, recording/editing/distribution rights, store and trailer reuse, credits | Performer permission for a pilot is not automatically license to distribute or advertise |
| Experience gate | Default voice preference, independent volume, skip/stop interaction and measured criteria for extend/revise/stop | Playback success does not establish that narration improves the quiet frame |

**Current status:** none of the above choices is decided by this inventory. Return the decision matrix to the owner on #1994; a decision to decline voice is a valid outcome. Confirm any store-generated-content disclosure rules against the current platform's first-party guidance before making a compliance claim.

## Implementation boundary if the owner approves

- Treat source text as authoritative. Maintain an event ID / mode / source-revision keyed audio manifest, and a fall-through text-only path for missing, blocked, corrupt, or out-of-date clips. Dynamic script events must either be excluded or get a separately approved substitution strategy.
- Use the shipped presentation audio path from #1986, but voice gets an **independent preference and level**. Stop or skip voice without advancing interludes; dismiss/replacement stops it; background/foreground cannot restart an obsolete clip. Keep the frame's Age drone **silent**.
- Do not modify `WorldState`, save format, RNG streams, command log, event eligibility, `reads` gates, or skip-seen behaviour for a voice pilot. Keep Original and Plain English screen text selectable, accessible, and readable without audio.
- Test missing media, denied autoplay, first gesture, rapid next/dismiss, background/restore, unsupported mode, revision mismatch, mute/zero level and packaging across browser/Windows/Android/iOS as available. Record build revision, package checksum, host, actual audio route and which tests were not run.
- Ask actual listeners whether voice helps or dilutes the frame; report completion, skipped audio, comprehension of speaker, silence and preference choice before authorizing expansion to the other 25 events. Neither a fake engine test nor a playable clip is participant evidence.

## Verification and deliberately unrun work

- Inventory checked against the named `frame.yaml` source, counting 28 `events` IDs, 85 prose variants and one two-outcome event. All 28 event title/body/outcome variants were matched in this source snapshot.
- **Not run:** npm/Vitest, gameplay eligibility/reach, any browser or packaged-host audio, recording session, listening/user study, copyright/rights clearance, platform policy audit, or §24 owner approval. Those are not implied by a documentation-only PR.
- `#1994` stays open: this is its independently landable **decision-preparation** slice. A later approved production implementation should have its own demonstrated contract and a separate claim/PR scope.
