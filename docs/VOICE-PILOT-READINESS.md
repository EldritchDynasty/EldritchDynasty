# Human-voice frame pilot: script inventory and decision gate

**Refs #1994. Proposal only; no recordings, casting, approvals, application changes, or participant study.**

> **Historical exploration, not the current pilot shortlist.** This early, Original-only inventory predates the [source-pinned, two-prose-mode decision brief](FRAME-VOICE-PILOT-1994.md). That later brief is the single current proposal for owner review, including its distinct three-scene set and revision manifest. The candidates below are retained to explain alternatives and dynamic-text risks; they are **not** a second set of clips to record. Neither document approves voice or a change to the silent-frame rule.

## Source snapshot and scope

The authored frame source is [`packages/content/events/frame.yaml`](../packages/content/events/frame.yaml), blob `2b29a1aadb55b191edb60b06c7604c20fe2844c3`. It currently contains **28** `frame_*` events. This inventory counts the `body` and outcome `text` scalar words of each entry, using simple whitespace tokenisation of folded YAML. It totals **approximately 2,552 source words**, with **15 scenes containing prose substitution tokens**. These are **planning counts, not performer timing**, and a token such as `{NARRATOR.They}` counts as one word until a particular founding is rendered. The count excludes titles, metadata, translated variants, and unrendered scene branches; it is not a claim that all 28 scenes are seen in one campaign.

The 1542 frame is not general story narration. [Concept §24](../DesignConcepts/eldritch-dynasty-concept-brief.md) keeps its drone silent; [`Interlude.vue`](../packages/client/src/components/Interlude.vue) currently shows text in an accessible modal with the explicit `Go on`/`Continue` action. A voice pilot must preserve both rather than equating finished audio with acceptance of the interlude.

## Inventory

`Words` are estimates for the original authored body plus outcome line(s). `Variable` means the prose contains a token requiring a concrete substitution when recording; it does not guarantee the static text is final or approved.

| Authored event id | Words | Variable |
| --- | ---: | :---: |
| `frame_the_seal_still_west` | 45 | No |
| `frame_what_the_ledger_says_of_the_seal` | 85 | No |
| `frame_two_of_three` | 50 | Yes |
| `frame_the_cost_not_written` | 68 | Yes |
| `frame_the_second_time` | 63 | No |
| `frame_nine_libraries` | 53 | Yes |
| `frame_the_northern_house` | 88 | Yes |
| `frame_the_short_account` | 55 | No |
| `frame_the_bought_silence` | 56 | Yes |
| `frame_the_west_house_again` | 76 | No |
| `frame_the_keeping_of_it` | 55 | Yes |
| `frame_the_missing_third_returns` | 50 | Yes |
| `frame_the_drowning_remembered` | 56 | Yes |
| `frame_the_index_in_another_hand` | 104 | No |
| `frame_the_copy_that_was_short` | 87 | No |
| `frame_read_out_in_a_hall_at_cawdry` | 126 | No |
| `frame_nothing_worth_the_ink` | 171 | Yes |
| `frame_the_short_minute` | 114 | No |
| `frame_what_the_ring_cost` | 105 | Yes |
| `frame_the_rule_of_two` | 117 | No |
| `frame_one_word_and_eight_days` | 130 | Yes |
| `frame_the_colour_of_its_own_paper` | 116 | Yes |
| `frame_the_grates_and_the_hour` | 111 | Yes |
| `frame_the_hour_the_clocks_agree` | 95 | No |
| `frame_what_the_table_was` | 118 | No |
| `frame_the_page_he_does_not_turn` | 119 | Yes |
| `frame_the_ninth_name_unspoken` | 102 | Yes |
| `frame_the_weight_of_a_sentence` | 137 | No |
| **Total** | **2552** | **15 of 28** |

## Earlier exploratory candidates (superseded; not approved or frozen)

The current [three-scene proposal](FRAME-VOICE-PILOT-1994.md#three-representative-pilot-pages-proposal-not-approved) deliberately selects static prose while the speaker, mode, and substituted-word recording policy remain undecided. In particular, `frame_two_of_three` below demonstrates the *unresolved* narrator-substitution problem; it is **not** a currently proposed pilot clip. Only an explicit #1994 owner decision can revise the current shortlist.

1. **`frame_the_seal_still_west`**, *A Box in Someone Else's Hallway* (45 source words): short, no prose substitutions, gated by the unresolved Seal gift lie. Tests sparse delivery and whether a silent pause before a human line actually works. A test fixture must make the gate eligible; do not assume normal play will fire it for every tester.
2. **`frame_read_out_in_a_hall_at_cawdry`**, *Item Nine* (126 source words): longer, static scene gated by a Chronicle event. Tests endurance, a deliberate pause and the ability to read ahead or dismiss without waiting for playback.
3. **`frame_two_of_three`**, *The Third Piece* (50 source words): compact but uses `NARRATOR` grammatical substitutions, gated by the regalia account. Tests what to do when resolved spoken words vary by founded identity. Either record approved distinct rendered variants or choose a different, fixed-text pilot. A mismatch between recorded voice and displayed words is a rejection, not a known limitation to wave through.

Do **not** freeze `frame_the_page_he_does_not_turn` as a pilot now: #2632 has ongoing claimed work affecting that named-omission scene. Likewise the proposed interactive last-night reckoning in #1989 is not yet a stable voice script; its prices remain owner-unapproved in [`FINAL-RECKONING-PROTOTYPE.md`](FINAL-RECKONING-PROTOTYPE.md).

## Owner decisions required before any recording

| Decision | Alternatives and requested acceptance |
| --- | --- |
| **Go/no-go on voice** | Keep the current text-only frame, or authorize exactly three pilot recordings; clarify the intended §24 exception to the quieter frame |
| **Voice identity** | A human performer as the last of the blood, the guardian, or an unnamed reader; do not turn the creditor into a person or claim the narrative can adjudicate hidden truth |
| **Prose and substitutions** | Original-only with Plain English remaining text-only, or separately performed matching variants; approve the actual rendered transcript for each event, mode and fixed dynamic-token combination |
| **Casting and budget** | Named owner to approve performer, recording budget, rehearsal, direction, edit/mastering and retakes; zero spend or permission is assumed here |
| **Rights and distribution** | Written licence for in-game browser/native distribution, trailers, editing, patching, geographical use, contract duration, performer credit and revocation/termination; do not infer voice-model-training rights |
| **Pilot outcome** | Define what to observe: comprehension, stopping/skipping, preference uptake, and whether silence or speaking better serves these scenes; no automated playback test establishes human benefit |

## Freeze and packaging contract (implementation proposal)

Before recording, create a per-clip manifest with **event id**, language/prose mode, source content revision, *resolved transcript hash*, substitution variant identity if applicable, audio asset path, codec, duration, performer/licence reference, and approved revision. The transcript identity must match what the player sees. Missing, outdated, blocked, corrupt or unsupported recordings fall back to readable text without an error modal. A prose-mode change must not silently label unmatched narration as equivalent captions.

An implementation should reuse the client sound policy after #1986's relevant changes land; it should not create a second Web Audio owner or alter simulation `WorldState`. Voice is explicitly activated and controlled with a separate persistent *reading preference*, not a save/replay command. The frame remains quiet until consent; only one clip plays; `pagehide`, dismiss, replacement, navigation and loss of focus stop it. Returning to the page cannot silently restart voice. Audio completion never advances the simulation or dismisses the modal.

### Verification matrix for a future implementation

- **Text-first:** no assets, unavailable asset, unsupported mode, declined permission, autoplay refusal, interrupted loading and failure to decode all leave the full text and action usable.
- **Interaction:** rapid enter/dismiss/re-enter, keyboard/IME Escape, Tab trap and focus restoration, reduced motion, screen reader, and skip/stop voice independently of dismissing the interlude.
- **Foreground and preferences:** mute/unmute, separate voice volume, background/resume, browser and native-host audio lifecycles; no second clip may overlap the first.
- **Integrity:** compare the same seed/decisions with voice disabled and enabled: identical save bytes, RNG stream and command log. Check asset manifest against exact content revision so changed source text never gets obsolete narration.
- **Observation:** recruit readers of a candidate build and log actual scripts, platform, consent and skip reasons; distinguish a technical pass from a felt narrative benefit.

## Handoff

For the **current owner review and script-freeze decision**, use [Frame voice pilot: source inventory and decision gate](FRAME-VOICE-PILOT-1994.md). Keep this first inventory as dated planning context; its original word counts exclude Plain English, and its alternative shortlist must not be merged into the later proposal without an owner decision.

This document completes the **inventory and technical proposal portion only** of #1994's first step. The owner still needs to approve whether voice exists at all, the narrator, mode, three frozen scripts, commercial rights and budget. No `Closes` keyword applies; later implementation depends on those choices and the appropriate client audio branch landing. After approval, work should proceed on the same claimed issue/branch or a separately tracked landing slice, never by bypassing the canonical claim mutex.
