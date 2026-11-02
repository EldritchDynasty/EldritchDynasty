# The summit route, played by the public session (#1978)

This is the Long Line's complete ladder played to Apotheosis through the verbs
the shipped client has, and nothing else. It answers one question: **can a
player reach the summit?** It is not a rate, and it is not evidence that a
person would find the route, enjoy it, or understand it.

Dated measurements belong in [BALANCE-LOG.md](BALANCE-LOG.md); this page is the
route and how to read it. Revision, seeds and counts here are the 2 November
2026 measurement, and are dated evidence like everything else.

## Reproducing it

```bash
npm run report:summit-route -- 1 198258 route.json
```

- **Content and code:** `main` at `ea4222d3` plus this branch's
  `summit-route.ts` (no rule or content change before the God rung).
- **Founding:** Long Line, seed 198258, the signing answered with each offered
  default (first heirloom, first grudge, first answer to every Examination
  question), house name "House Gearithy". Default founder.
- **The player's verbs:** `found`, `setAmbition`, `order`, `choose`, `record`,
  `letHimDecide`, `advance`. No debug grant, world edit or chosen roll.
- **Proof the route is public:** `routeReplays` hands the saved command log to
  `replay`, which rebuilds the run from the seed through the session verbs,
  regenerates its own decision log, throws at the first difference and then
  compares the world digest. The 198258 route passes.

The command log is long — 501 `advance`, about 50 `order`, 50 `choose`, 136
`letHimDecide` and 11 `record` — because most years are the chronicler's.
`letHimDecide` is a real player verb: it hands every standing question back to
him, and most of a Long Line is answered that way by anyone.

## The policy, as a player would describe it

`summit` is the ending gate's `ascendant` composite policy, sent as public
verbs, with one addition at the top.

1. **At the signing,** accept the defaults and choose the ambition *Prepare the
   ascent*. Order marriages **in**, and raise the auction ceiling to 1,000
   crowns, enough to contest Marrow's Death bid.
2. **Every year,** keep a Scion and a Scion's Heir named (`scion`,
   `scionHeir`). Prefer an unmarried man, and for the Heir a son or brother of
   the Scion; once an elder has both rites, move the Heir onto one of his
   descendants. While the treasury holds 600 crowns, seek the first minor book of
   an affinity the shelf lacks.
3. **On the docket,** take every ladder bargain — a Vessel, a Great Rite, the
   second man's rites — naming the Vessel who carries the most font. Refuse an
   Unmaking until the living household reads eight books across five
   affinities, covering all four opposed pairs, at Eminent or above. When
   Respect is Eminent, **embellish** the Record; at Exalted, record truly.
   Everything else goes back to the chronicler.
4. **After the docket,** call whichever of the Vessel rite, the Great Rite or
   the Unmaking the Table offers, then search the archive for a clause.
5. **Once the house has stood on God,** keep the book: record every Record
   block truly, call no further rite, and take any offered option that buries
   an open lie.

Step 5 is what turns this seed from Devoured into Apotheosis. Without it the
same house reached God and kept embellishing; at the reckoning it held 15
weight of unsupportable claims against the Long Line's allowance of 9, the
creditor withheld one rung, and Demigod is Devoured. With it the book held 3.

## What happened, and what the player could see

Read across the public view each year (`view().ascension`, `view().ambition`,
Respect and clauses). Names are this seed's.

| Year | What the player did or saw | Cost |
| --- | --- | --- |
| 1042 | Signed; chose *Prepare the ascent*; marriages in; bid ceiling 1,000. The ladder reads *no living man is known to express the blood*. | — |
| 1057–1064 | Ivor wakes: Touched, then Adept. The ladder names the next blocker each year — books, then power — with a hint ("have him study another spellbook"; "seek Matches that strengthen the font"). | Years of study |
| 1102 | Edric reaches Hierophant and the Table offers the Vessel rite; called. | **Tamsin**, the founder's daughter, consumed as the Vessel |
| 1112 | Great Rite called, with Church sanction. The ambition now says *Edric has taken both rites… prepare the next now*. | — |
| 1127–1131 | Vessel rung. A second man (Osric the second) takes both rites; then Respect collapses and the rung falls back. | **Alys the second** consumed |
| 1131–1377 | Two centuries in which the foremost man is blocked at Hierophant, by turns on books, Madness, Respect and power. Respect swings between Unknown and Exalted. Clauses come home one at a time (3 → 7). | **Kerensa the third** consumed (1225) |
| 1378–1381 | Wystan the second takes the Vessel and the Great Rite. The ambition names him as the two-rite elder and says to prepare the next. | **Aveline**, his daughter, consumed |
| 1394 | The second man's Vessel. | **Fritha the fourth**, Wystan's daughter, consumed |
| 1399 | Reading circle and Eminent assembled: the Unmaking is called. Wystan is unmade to raise his grandson **Rowan the fourth**, eighteen. | **Wystan the second** |
| 1400–1401 | Rowan takes his own Vessel and Great Rite: Demigod. His ageing stops. The ladder now reads *Rowan → God: the blood has not brought him close enough to ruin*. | **Vessa the fourth**, his sister, consumed |
| 1410 | Rowan's Madness enters God's window with Exalted standing and eight clauses: **God**. The ambition now says *the book is what is left — 4 embellished claims still stand disputed*. | — |
| 1418–1478 | The house writes truly; two lies are buried or proven (4 → 2); the ninth clause comes home. | Whatever each burial asked |
| 1542 | The creditor reads God and finds it held up: **Apotheosis**. | — |

Six women of the blood went as Vessels and one elder was unmade. That is the
price §22 sets, paid in full.

## What the policy knew that a player does not

Every act above was a public verb, but some were *chosen* with information the
client does not show. They are listed so nobody mistakes this route for one a
player could find by reading the screen.

- **Who to name Scion.** The shared rule ranks unwoken boys by `canExpress`
  and Eldritch Power. The view shows only who has woken and whether the Power
  comes through them (`expresses`), and power only for the foremost man. A
  player naming a boy before his Awakening is guessing.
- **Which Vessel.** The policy names the candidate carrying the most font. The
  tree does not show carried font.
- **Which descendant receives the Unmaking.** The policy prefers the one whose
  Madness after the elder's lands inside God's window and below his Mind.
  Madness is shown; Mind's bound is not.
- **When the reading circle is ready.** `unmakingReadyForAscendant` counts
  household books, affinities and opposed pairs; the view gives the ladder's
  first blocker, not that count.
- **Which docket choice is a ladder bargain** and **which buries a lie.** The
  policy reads the choice's effects. A player reads its words.

Nothing here reveals a roll before it is made, and nothing makes Eldritch
Power reliable: the route depends on which children woke, how strongly, and
whether each rite's weighted outcome went the right way. One route on one seed
proves only that the summit is reachable through the client's verbs on this
content revision.

## What can still close the road

- **A failed Unmaking ends the summit for the whole run.** The rite's 36%
  failure branch sets `god_rite_failed`, and `selectEnding` reads that flag
  before it asks whether the book substantiates God. A house that loses one
  elder that way, raises another and stands on God later is still The Unmade.
  Seed 198157 did exactly that: it called the Unmaking in 1162 and again in
  1181, one attempt failed at the last step and the other succeeded, and the
  house stood on God in 1232 and was read as The Unmade in 1542. Whether a later success should redeem the
  first failure is a design question, recorded on #1978; this page does not
  change it.
- **The book.** The reckoning substantiates what the Chronicle can hold up.
  Embellishing is the policy's lever for Exalted, and its unsupportable weight
  is still standing at the term unless it is proven or buried. The ascent
  ambition now says so once the house has stood on God.
- **The line.** 145 of the 600 measured houses (24%) broke before the term.
- **Respect after the Unmaking.** The rite's success costs two tiers, and God
  wants Exalted. In the measurement below it is the gate that stops recipients
  who have cleared everything else.

## Measured on 600 houses

`npm run report:summit-route -- 150 <base> out-<k>.json` four times, bases
197800, 197950, 198100 and 198250 (seeds 197800–198399), signed, `summit`
policy, at `ea4222d3` plus this tool; then
`npm run report:summit-route -- --merge out-*.json` prints these tables. One declared sample: these are counts under one bot
policy, not a player success rate, and no target was set in advance.

| | Houses | Share [Wilson 95%] |
| --- | --- | --- |
| Reached the Vessel or higher | 341 | 56.8% [52.8, 60.7] |
| Reached Demigod or higher | 191 | 31.8% [28.2, 35.7] |
| Stood on God | 7 | 1.2% [0.6, 2.4] |
| **Apotheosis** | **6** | **1.0% [0.5, 2.2]** |
| The Unmade | 46 | |
| Devoured / Forgotten / Broken Line | 300 / 103 / 145 | |

Every Apotheosis route replays through `replay`. The seventh God house is
198157, The Unmade, above.

**The joint gate, recipient by recipient.** The observer reads every unmet God
prerequisite for each living Unmaking recipient each year, from the same
predicates `standingOf` uses. 90 houses raised a recipient, for 4,053
recipient-years.

| God prerequisite unmet | Recipient-years | …and the only one unmet |
| --- | --- | --- |
| Respect (Exalted) | 3,577 (88%) | **840** |
| Clauses (seven of nine) | 1,842 | 5 |
| Madness below the floor | 1,578 | 50 |
| Madness over Mind | 1,565 | 89 |
| Mind | 627 | 0 |
| Books | 374 | 0 |
| Power | 220 | 13 |
| Affinities | 190 | 0 |

All prerequisites held in 73 recipient-years across the seven God houses.
Respect alone stood between a ready recipient and God in 19 houses, a median
of 31 years each; seven of them reached God and twelve never did. Mind blocked
a recipient alone in no year, so on this sample an unfinished paid tuition term
is not the demonstrated blocker, and no tuition rule is changed.

**Keeping the book, paired.** The seven God houses replayed under the plain
`ascendant` policy reach God in the same year (the two policies differ only
after it). `ascendant` ends them Apotheosis 4, Devoured 2, Unmade 1; `summit`
ends them Apotheosis 6, Unmade 1. The two Devoured houses, 197828 and 198258,
kept embellishing after God and the creditor withheld a rung (unsupportable
weight 14 and 15 against an allowance of 9; `summit` left 5 and 3). Keeping
the book does not lower that weight in every house — in 198172 it rose from 5
to 9, because later burials and proofs follow different docket answers — so
the rule is a protection, not a guarantee.

## Where the code is

- `packages/core/src/tools/summit-route.ts` — the player, the observer, the
  replay check. `npm run report:summit-route`.
- `packages/core/src/ambition.ts` — the post-God *keep the book* guidance and
  `standingEmbellishedDisputes`.
- `packages/core/src/tools/ladder-policy.ts` and `ending-gate.ts` — the
  ascendant policy this mirrors, and the rate evidence.
