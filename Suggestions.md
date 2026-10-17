# Eldritch Dynasty — Suggestions

> **Purpose:** one current decision surface for product direction: what to do
> next, and what to avoid.
>
> **Checked against:** `main` at `e5ab83c` and the issue tracker on
> **17 October 2026**. By then the tracker had one open issue (#1641, a CI timing
> P0) and the commercial pass (#277) had closed with all fourteen children done.
> Every claim below about what the game does or measures cites the issue, file
> or `docs/BALANCE-LOG.md` entry it comes from. Re-check those before relying
> on a number. They move.
>
> `market research.md` is the evidence ledger and source list, revised the same
> day. §4A below carries its decision implications. This file is the shorter
> answer. The concept brief is still the authority on game rules, and
> `issuesneedingowneraction` holds the owner-only release steps. Prices are in
> **NZD**.

---

## 1. Product direction in one paragraph

Do not make Eldritch Dynasty broader. Make its distinctive loop **true in
measured play, proven on real players, faster on a second run, and visible to
someone who has never heard of it.**

The product is strongest when one act touches all three load-bearing ideas:

1. **blood** — the family is materially different because of what was bred,
   spent, married, inherited or lost;
2. **debt / Ledger** — the house is pursuing something over centuries, and the
   old contract still constrains the present;
3. **record** — what the house says happened can matter differently from what
   happened.

Store sentence:

> **Breed a bloodline for five centuries, decide what the family writes about
> what it did, and face the creditor who kept the other copy.**

Player-memory sentence:

> **I bred this family, lied about what it did, and centuries later the lie came
> back when the debt was read.**

Future work should make those sentences truer in play. Not just in copy.

---

## 2. The five feelings to optimise for

A feature is worth building when it strengthens at least one of these without
weakening the others:

- **I have a plan.**
- **This person matters.**
- **That happened because of me.**
- **This generation is different.**
- **I want to see how this ends.**

They describe what the player feels, not how much was built. "More depth",
"more content" and "more systems" are not on the list.

---

## 3. What shipped since the last version — protect it

The previous version of this file listed most of the items below as future
work. They are on `main` now. **Do not reopen them as feature proposals.**
Protect them, and measure whether they carry the experience.

| Was a suggestion | Now | Protect |
|---|---|---|
| Make "Choices Matter" credible | #334 finished on 17 Oct: **0 write-only memory keys, 0 prose-only choices, 0 unclassified keys**. Both findings are validation **errors** now. 25 reserved memories have named later readers in `events/remembered_accounts.yaml`. Eight choices are declared `self_expression` on purpose. | A new choice that changes nothing fails the build. Never weaken that rule to land content. |
| Finish the opening (the Examination) | #343 shipped via #501: schema, runtime, save, replay, client, founder naming. Paired-seed balance evidence is in BALANCE-LOG (#1741). | No dominant answer. Every answer stays a readable given/owed trade-off. |
| Progressive first-fifty-year reveal | #368: disclosure, reveal notices, a returning-reader opt-out, and the 50-year delegation gate. | Reveal a rule when it becomes actionable. Don't hide one. |
| Second run reaches new context faster | Skip-seen prose (#267, `skipSeenProse` in Reading settings); interaction-shape, stall and divergence instruments (#270–#272); #341's ranked rewrite. | Never auto-skip a changed variant, a decision, a Record block, a rite or an interlude. |
| Family tree as a strategic surface | #268: search (now diacritic-insensitive, #1759), hall filter, direct-line rooting, relevance, known succession, kinship paths, TreeCounsel. | Surface people for what they **did**, not the slot they fill. |
| Chronicle as causal memory | #269: dated causal backlinks from bill to page to act. | No hidden formulas. Causal legibility, not debug telemetry. |
| House Afterimage | #260: `afterimageModel` in `client/src/lib/book.ts`, exported as a PNG. | No grade, no score, no "good ending". |
| Contextual help without omniscience | #273: graduated, in-world adviser help. | First the diagnosis, then the knowable rule. Never the hidden roll. |
| Reading comfort and localisation readiness | #275 and #276: text scale, reading font, reduced motion, keyboard paths, pseudo-loc, and the saved-prose decision in `docs/LOCALISATION.md`. | The Chronicle keeps the words the player actually saw. |
| — (new) | **Plain English** reading mode (#410/#415). Owner-ruled **launch-required** on 14 Oct. 5,492 counterparts, 0 missing. A zero-gap guard protects new content. | Mechanics are identical in both modes. Only the words change. |
| — (new) | 30 stable achievement IDs (`core/src/achievements.ts`) and a Steam backend. The **33-year Demonstration** campaign, with guaranteed beats (§4, P1-3). | One mechanism, no `if (demo)` in core. |
| — (new) | Unsigned **v0.1.0-beta.3** builds: a Windows installer that passed a fresh-VM install and cold resume, an Android AAB, and iOS simulator save/resume proof. | Hosts own no rules. |

### Interaction rules that still hold

- **decide → consequence → decide again.** Never replace an answered decision
  with the next prompt before the player sees what the answer did.
- **The Chronicle is not the passage log.** Promote firsts, losses, reversals,
  claims, rungs and rites. Batch or drop the receipts.
- **The cast is situational.** Bring people forward for what is happening to
  them now.

---

# 4. Current highest-value directions

The old P0 list is done. The gaps below come from what the evidence on `main`
now shows. Each one comes from a measurement, not from taste.

## P0-1 — The top of the ladder is a promise the game almost never keeps

**Evidence** (BALANCE-LOG, 10–11 Oct, #332/#378):

| 512 × 500-year runs | Apotheosis |
|---|---:|
| ordinary (chronicler) play | **0 / 512** |
| `ascendant` policy: a bot playing *only* to climb | **1 / 512 (0.2%)** |
| owner's target band (#332) | **8–29%**, floor reported but not enforced |

The recipient funnel at 512 runs stops at almost every gate: alive 35 → power
22 → books 20 → circle 20 → Madness 13 → Mind 6 → clauses 3 → Respect 1 → God 1.
Ordinary play never produces a Madness sample at 90. The highest is 70.1. Only
deliberate rite-buying gets there.

**Why it is P0:** three player-facing surfaces promise this ending.

- The Steam copy (`store/steam/README.md`) sells the Long Line as having *"the
  complete Ascension Ladder"*.
- The achievement `ending_all_long` asks for *all five* Long Line endings. The
  v1 rate table measured `ending_apotheosis` at **0/100 in every column**.
- The Long Line's ending list puts `apotheosis` first.

A player who tries for the summit for two runs, never sees it, and then reads an
achievement that needs it will write the Steam review this project least wants:
*the choices don't matter*.

**Decide one of these. Do not drift:**

1. **Make it reachable for a player who commits to it.** Work the joint gates
   that now bind: Mind-over-Madness containment after the rite, the Ledger
   overlap, and Exalted after the Unmaking spends two tiers. One mechanism at a
   time, paired seeds, never by making Eldritch Power reliable or lowering the
   God-Madness floor.
2. **Make it honestly mythic.** Keep it near-unreachable and say so: store copy
   that does not promise it, an achievement that does not require it, and
   in-game framing that presents the God rung as a rumour the record tells
   about other houses.
3. **Change the target on the record.** The owner revises the 8% band on #332's
   successor. The gate and BALANCE-LOG cite the decision.

All three are legitimate. What is not legitimate is publishing the store copy
and the achievement while the measured rate is 0.2% for a bot built to climb.

## P0-2 — Nobody has watched a human play it

**Evidence:** `docs/PLAYTEST.md`. Every human acceptance test was **waived on
28 September and none was run**: five first-timers finishing a Short Line,
second-run divergence, naming three people, blaming a decision rather than a
number, a full screen-reader run. "Waived means not owed, not passed."

Everything this project knows about fun comes from bots. Thousands of 500-year
harness runs prove the game is *reachable* and *coherent*. None of them can say
it is *legible*, *moving* or *worth NZD 28–35*. The harness's policies are bots
that never get bored, never misread a label, and never close the window at
minute twelve.

**Do now:** run the existing protocol on the beta.3 Windows installer, which
already passed a fresh-VM install and cold resume. Five first-time players on a
Short Line is cheap. Record first, interpret second, tune last. Ask:

- *Which three people from that run do you remember, and why?*
- *What was the house trying to do?*
- *Name one decision that changed what happened later.*
- *Where did you stop understanding what you were looking at?*
- *Would you start another house? Why or why not?*

A failed observation opens a narrow follow-up issue. It does not reopen the
waived one.

## P0-3 — Give the Long Line a reason to exist beyond its length

**Evidence** (#274 baseline, BALANCE-LOG 2 Oct; 12 shared seeds per cell):

- The static inventory finds **no authored event or arc exclusive to either
  campaign**. The differences are term, Ledger capacity (3 vs 9) and ending set.
- Chronicler play reached a Long-exclusive ending in **0/12** runs. Ascendant
  play reached one in 1/12, and that was `unmade`.
- Long's distinctive reach comes mainly from going past Short's three-clause
  cap.
- Encouragingly, **35.8%** of late-Long choices had an interaction shape that
  never appeared in the paired Short run. So late Long is not just "Short plus
  200 years".

The Short Line is the default and the Long Line is the flagship. If the Long
Line's two exclusive endings are 0.2% (Apotheosis) and rare (Unmade), its
promise comes down to "more years". That is a pacing risk and a pricing risk.

**Direction:** give Long a late-game structure that Short cannot hold. That
could be post-1342 Age content, clause recoveries that change what the family
can attempt, or a late ending path that ordinary play can reach. Then measure
**Long-exclusive reach under chronicler play**, not only under the ascendant
bot. Build on the Ages, the Ledger and the ladder. No global late-game
difficulty multiplier.

---

## P1-1 — Afterimage v2: from a statistics card to a house

**Evidence:** `afterimageModel` (book.ts) prints seven counts and one
Chronicle quote: pages written, left blank, improved, lies standing, clauses
recovered, the attested rung, living blood. It names **no person**.

The suggestion was *"What was this house?"* What shipped answers *"How many
pages did this house write?"* Seven numbers are a scoreboard.

**Add, from existing read models only:**

- three central people, chosen by how often the Chronicle and the decision log
  name them;
- the person the house spent, from rite and death records;
- the closest brush with extinction (lowest living-blood year);
- the oldest standing embellishment and the oldest blank;
- a compact lineage silhouette for the direct line.

Keep the rules: no grade, no rank, no reconstruction of what a blank omitted.
This is the object players screenshot. It should look different for every
house.

## P1-2 — Write new trade-offs for the money-shaped choices

**Evidence** (#341 closeout, 6 Oct): replay familiarity is down to **27.1%**,
the adopted target. But **money appears in 9 of the 10 most common choice
shapes**, accepted as known debt. When the ranked slice emptied those slots,
other money shapes refilled them from the tail. BALANCE-LOG says plainly:
*"Moving it needs new trade-offs written on purpose, not corrected prices.
That is a content commission, not a sweep."*

**Direction:** commission that content. Each rewrite trades coin against
something only this game has: a name in the record, a branch's grievance, a
person's availability for the Match, a Discrepancy someone can prove. Measure
with `gate:replay` before and after. Do not lower the docket budget to make the
figure look better.

## P1-3 — Package the demo, and decide what it hands to the full game

**Evidence:** the 33-year `demo` campaign is built and verified on 64 seeds in
both prose modes. It runs the Insurrection opening, Daveed's crossing in 1043, a
forced Record in 1044, an interlude in 1045, and a verdict by 1075.
`client/src/lib/game.ts` says it *"is not offered on the normal front door
yet"*. No demo build target exists.

**Direction:**

- add a demo build that opens straight into the Demonstration, with its own
  save namespace (already isolated with `demo-`);
- end it on the forward-looking problem, not a timer;
- **do not transfer the demo save** into a full run. The miniature compresses
  an Age and kills Daveed on a fixed date, so it is not a canonical Short Line
  opening. Instead, consider entering the finished demo house into the **Library
  of Houses**. Then the full game *remembers* the demo without giving a
  head start. That is the replay rule this game already uses.

## P1-4 — The rare tail: content players will almost never see

**Evidence:** at 800 × 500 years, the rarest of 487 non-frame events fire in
0.75–1.25% of runs. AGENTS.md records seven frame interludes that fire in 1–4 of
60 runs, each waiting on a single named lie. Moving three interludes onto the
*page* (`chronicled`) took them from 0 to 13–17 runs in 60.

**Direction:** for each tail item, decide whether it is *meant* to be
legendary. If it is not, fix the funnel upstream (the launcher, the premise, the
page), as the `chronicled` move did. Do not raise its weight. Diagnose with the
five-stage funnel in §5.

## P1-5 — Use visuals to prove the game is systemic

A text-heavy game's screenshots can look like a sequence of prose panels. Every
visual element should answer at least one of: **who matters? what changed? what
did this cost? what is the house trying to do? what is remembered?**

Highest-value surfaces, in order: the family tree changing over generations;
the Match as three futures; Record / Omit / Embellish next to the page it
writes; a callback beside the old page it cites; a rite as before/decision/after;
the Afterimage (after P1-1). Decoration that answers none of those questions
should not compete with the text.

---

# 4A. Commercial decisions the market research now forces

These are mostly **owner** decisions, not engineering. They are here because
the October 2026 market evidence (`market research.md` §§7–14) makes their
*timing* matter as much as the code does.

## C-1 (owner, P0) — Start the wishlist clock before signing anything

**Evidence:** Steam's June 2026 storefront moved Popular Upcoming out of reach
for niche games (reported 80,000–100,000 wishlists). The new **Personal
Calendar** recommends launches based on each player's own wishlists, follows
and play history. No wishlist, follow or country data exists until a Coming
Soon page is live, and that page needs an **App ID** (USD 100 ≈ **NZD 170**).
The owner has said the App ID is "at least several months" away.

**Recommendation:** if only one account can move early, make it the Steam App
ID. Windows signing, the Play upload key and Apple distribution are needed at
*release*. The App ID is needed to *start accumulating matched players*. That is
the variable this project influences most on Steam's current storefront.

**Calendar** (Steamworks, read 17 Oct):

- **February 2027 Next Fest** registration closes **10 January 2027**. That is
  not realistic without a page.
- **June 2027 Next Fest** (14–21 June) is the realistic target. Register by
  **25 April**, submit required items by **31 May**, press preview from
  **3 June**. Working back: App ID about February 2027, Coming Soon page by
  March 2027.
- A game gets **one** Next Fest. Don't spend it on a demo that has not met a
  human (P0-2).

## C-2 (owner, P0) — Decide the AI disclosure, truthfully, before the page goes up

**Evidence:** Steam's January 2026 rules exempt AI coding tools but require
disclosure of **pre-generated player-facing content, narrative text included**.
This repository's prose is written in an AI-agent workflow. Player sentiment
ranges from mildly to strongly negative depending on who is asked. One review
study found 68.4% recommendation for generative-AI games against 86.3% for
procedurally generated ones.

**Recommendation:** the owner determines what actually shipped and discloses it
specifically and accurately, including the human direction, curation and
editing. A game whose whole thesis is *"the falsified record is proven
centuries later"* must not be the one caught misrepresenting its own. Expect
some review cost. Concealment would multiply it.

## C-3 (P1) — Tune for the Personal Calendar, not for raw totals

- **Tags** that sit beside *Crusader Kings III*, *Pentiment*, *Suzerain* and
  *The Roottrees are Dead* players: Strategy, Choices Matter, Text-Based,
  Dynasty, Lovecraftian, Medieval, Story Rich, Multiple Endings. **Not** "Grand
  Strategy".
- Ask for a **follow** as well as a wishlist, on the demo's end screen and in
  every devlog.
- Measure **wishlists by country** before choosing a translation language
  (C-5).

## C-4 (P1) — Steam leads. Mobile is the second wave.

**Evidence:** premium PC-to-mobile ports went from 7 to 23 between 2024 and
2025, still about 3% of premium mobile releases, and their revenue goes to a few
hits. Text strategy has worked on phones (*Reigns*: 600k+, mostly mobile), but
mobile rarely *finds* an audience on its own.

**Recommendation:** launch on Steam first. Ship Android and iPhone when their
accounts exist, riding Steam's reviews. Before that:

- test the **tree** and the **Match** at phone width with real players;
- plan the Play closed test as **at least three weeks**. The rule needs 12
  testers for 14 continuous days, and the clock reportedly resets if the count
  drops. The owner's plan to invite 20 or more is the right buffer;
- set a **separate, lower phone price** from the stores' own tiers.

## C-5 (P2, owner) — Choose localisation by evidence, and price it honestly

**Evidence (measured this pass):** about **142,000 words** of Original prose and
**147,000** of Plain English in content YAML, plus UI. At vendor rates of about
NZD 0.17–0.24 per word, the Original prose alone is roughly **NZD
24,000–34,000 per language** before editing and QA. The literary register
pushes toward the top of that range. Steam's language-share survey swings
wildly month to month.

**Recommendation:** no language decision until wishlist geography exists
(C-1). Decide per language whether Plain English is offered at all, since it
doubles the cost. Machine or AI translation of narrative text would also be
disclosed content (C-2).

## C-6 (P2) — Price after a human session has been timed

The NZD 28–35 band still holds. It is about USD 16.50–20.60, around recent
top-launch medians (USD 15.64) and 19.99 comparators. But the inputs that
justify a price — human session length, replay appetite, polish — have not
been measured (P0-2). Read Valve's current NZD recommendation in Steamworks on
the day, and never convert by hand.

## C-7 (owner, P2) — NZ funding: check the threshold before counting on it

The Game Development Sector Rebate pays **20%** of qualifying NZ expenditure,
but only above **NZD 250,000 a year** (cap NZD 3 million; administered by NZ On
Air). Below that it pays nothing. Confirm eligibility directly before it
appears in any budget.

---

# 5. The boredom risks worth measuring

> **A boring stretch is time in which the player keeps performing actions
> without receiving new information, facing a materially different trade-off,
> changing the direction of the house, or seeing a consequence that makes an
> earlier choice mean something.**

Most of these now have instruments. Use them before inventing new ones.

| Risk | Question | Instrument on `main` |
|---|---|---|
| Spine gap | Years since a Match, Record, Age boundary, clause, rung, rite, Regalia or land change | `density-gate.ts` (#270) |
| Interaction-shape streak | How many prompts in a row with the same mechanical rhythm? | `#271` shapes, `gate:density` |
| Progress stall | Years at one blocker with no player-actionable route | #270's stall detector |
| Maintenance streak | The same verb, target and answer with nothing changing in between | delegation / standing orders (#219, #368) |
| Second-run sameness | Repeated prose and shapes early in run two | `gate:replay` (#272, #341) |
| Delayed-consequence attribution | Can the player find the act an echo remembers? | #269 backlinks; `echo-chains.test.ts` |
| Tail funnel | Why does a rare item not fire? | below |

For rare content, separate the funnel stages:

1. the prerequisite state never exists;
2. the state exists but slots cannot cast;
3. a condition is false;
4. it is eligible but never selected;
5. it is selected but a branch never resolves.

"Fired 2%" is not a diagnosis.

**The gap the instruments cannot close:** each one measures a bot. None says
whether a person was bored. That is P0-2.

---

# 6. What not to build

- **No tactical combat.** War matters through Muster, people, land, standing
  and promises.
- **No conventional world map as the centre.** The tree, Chronicle and holdings
  are more specific to this game.
- **No universal relationship bars.** Named relationships, grievances and
  recurring threads instead.
- **No generic roguelite meta-upgrades.** Replay changes remembered history
  (the Library of Houses), not starting power.
- **No global difficulty-by-year multiplier.** Strengthen the system that owns
  the time: Ages, Ledger, Bearing, land, rites, rivals, ambitions.
- **No new currency to create "depth".** Every meter competes with blood, debt,
  record, people and standing.
- **No progress bars for mysteries.** An actionable model, not omniscience.
- **No "more ordinary events" as the default repetition fix**, and no lowered
  docket budget to flatter the numbers. Fix the repeater, the shape, the
  callback or the owning system.
- **No fix for the God tail that makes Eldritch Power reliable** or quietly
  lowers the God-Madness floor (invariant 4; #378).

---

# 7. Storefront implications

The store has to sell **gameplay**, not only atmosphere. A screenshot or trailer
set should show, fast:

1. a family changing across generations;
2. a Match as a strategic comparison;
3. a costly choice;
4. Record / Omit / Embellish changing what the book says;
5. an old act returning;
6. a rite spending a named person;
7. an ending that summarises a house unlike another run's.

The first trailer answers **"what do I do?"** before **"how is this written?"**

**Use Daveed.** *Darkest Dungeon* sold 6 million units with an ancestor who
ruined the family and then narrates it. Daveed is that figure, with a twist the
store can say out loud: he is the first Head, he did not die, and he has been
you the whole time. A guilty, non-neutral narrator is a hook, not just lore.

**Claims the evidence supports today:** every choice leaves a trace (#334
enforces it); the family is a genome, not a stat block; the record you falsify
is read back at the end; Plain English mode.

**Claims to hold back until measured:** godhood or "the complete Ascension
Ladder" (P0-1); any session length (no human has been timed); anything about
Long-only content (P0-3).

Every checkbox in `store/steam/README.md`'s publish list is still open, and
every capsule asset is still TODO. Capture from real play only: the Play
listing's played-run screenshots (#1743) are the method to copy. Their tagline
art is not allowed on Steam's base capsules.

---

# 8. Demo direction

Optimise the demo to complete one recognisable Eldritch Dynasty shape, not to
fill a fixed number of minutes:

1. the debt;
2. a person the player can care about;
3. a Match;
4. a meaningful choice;
5. Record / Omit / Embellish;
6. an echo proving the game remembered;
7. the frame and the creditor's promise;
8. a forward-looking problem that makes continuation desirable.

The built Demonstration guarantees 1, 5 and 7 by design (signing, forced Record,
scheduled interlude). Check 2, 3, 4, 6 and 8 **with human players** (P0-2), not
only with seeds. Then measure actual completion time and drop-off.

End on an explicit ask: **wishlist and follow** (C-3). How To Market A Game's
June 2026 Next Fest data puts the median demo-player-to-wishlist conversion
around 19%, and warns that reach matters more than the percentage. Don't tune
the demo to the percentage.

---

# 9. What to measure before adding another major feature

**First session** (humans): time to the first meaningful Match, the first
Record decision and the first echo; the first point where the player can
explain their next move; UI concepts seen before they matter.

**Agency** (instruments): the choice audit holds at zero. Persistent-state
divergence between options. Callback rate. The recoverable-source rate for
delayed consequences.

**Pacing** (instruments): spine gap, shape streak, stall duration, maintenance
streak.

**Replay:** `gate:replay` familiarity at or below 27.1% and top shape at or
below 4.7% (adopted guards). Time to the first unseen context. Seen text
skipped. Standing policies interrupted by a material change.

**Endgame:** Apotheosis and Unmade rates under chronicler *and* ascendant play.
Long-exclusive reach under chronicler play.

**Steam** (aggregate platform data, once a page exists): wishlists and follows
by week and by country; Next Fest demo players and median playtime;
demo-to-wishlist conversion as context, not a pass/fail score. The owner's
recorded checkpoints are **5,000 wishlists before the demo and 15,000 at
launch**. For scale only: 15,000 at a ~10.5% median first-week conversion is
about 1,575 units, roughly **NZD 28,000** to the developer after Steam's cut.

**People** (humans):

> **Which three people from that run do you remember, and why?**

The failure is not disliking someone. It is remembering roles and numbers but
no people.

---

# 10. Decision rule for future proposals

Ask these in order:

1. Does this make **blood**, **the debt/Ledger** or **the record** more
   interesting?
2. Does it create a decision recognisably different from an existing one?
3. Can its consequence be remembered later?
4. Does it strengthen one of the five feelings?
5. Does it make a second run meaningfully different?
6. Can the player understand enough to act without an external wiki?
7. Is it worth the cognitive load and the production cost?
8. Can it be proved with an existing surface before a new system is added?
9. **Is the claim it lets us make true in measured play?** (New. See P0-1.)

If the first three answers are **no**, the feature is unlikely to improve the
product.

---

# 11. Suggested order of product work

This is a direction order, not a replacement for issue priority or repository
coordination. Two lanes run side by side. Engineering does not wait for
accounts, and accounts do not wait for engineering.

### Lane A — the game (engineering and content)

1. **Truth:** resolve P0-1, the summit. Then make the store copy and the
   `ending_all_long` achievement match whichever route the owner picks.
2. **People:** run the playtest protocol on beta.3 (P0-2). Let what it finds
   reorder everything below.
3. **Flagship:** give the Long Line late-game reach that ordinary play finds
   (P0-3).
4. **Demo:** package it, end it on a wishlist-and-follow ask, and decide the
   Library hand-off (P1-3, §8).
5. **Shareability:** Afterimage v2 with people in it (P1-1). It doubles as press
   and social art.
6. **Variety:** the money-shape content commission (P1-2).
7. **Tail:** triage the rare content funnel (P1-4).
8. **Commercial proof:** screenshots, capsules and a trailer from real play
   (P1-5, §7).

### Lane B — the market (mostly owner)

1. **Now:** decide the AI disclosure (C-2) and the summit route (P0-1). Both
   change store copy.
2. **As early as possible:** Steam App ID and a Coming Soon page (C-1). It
   starts wishlists, follows and country data.
3. **By 25 April 2027:** register for June 2027 Next Fest with a demo that has
   met humans.
4. **After the page has wishlist geography:** localisation (C-5) and price (C-6).
5. **At release:** Windows signing. Then Android and iPhone as the second wave
   (C-4).

### The one-line version

Make the claims true, watch people play, open the store page early, and be
honest about how it was made.

---

# 12. Relationship to the evidence document

`market research.md` holds competitor evidence, platform facts, published
commercial data, store and Steam guidance, localisation evidence, and dated
citations. Update it first when evidence changes. Change this file only when
the **decision** changes.

---

# Final principle

The best next feature is unlikely to be the one that makes the simulation
largest. It is the one that makes a player say:

> **I chose that because of this person; the house paid for it; the book
> remembered it; and the next generation was different because I did.**

And it should be true when they check.
