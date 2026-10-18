# Eldritch Dynasty — Suggestions

> **Purpose:** design rationale and measured evidence for improving the game.
> Issue priority labels decide work order under `AGENTS.md`; §9 explains the
> design rationale and does not set a second queue.
>
> **Focus:** the owner's priority is the game, not the launch. Launch work is
> blocked for months anyway. `issuesneedingowneraction` records that Windows
> signing, the Play account, Apple enrolment and a Steam App ID will not be
> available for at least several months, and every item in that file is release
> setup, not game design. So nothing in it competes with the work below. Launch
> notes are parked in the appendix.
>
> **Checked against:** `main` at `6f8c144b` and the issue tracker on **18 October
> 2026** (18 open issues; #1641 is closed). Every claim about what the game
> does or measures cites its issue, file or `docs/BALANCE-LOG.md` entry. Numbers
> move, so re-check before relying on one.
>
> The concept brief is the authority on game rules. `market research.md` is the
> evidence ledger. Its comparator lessons (§§5–6) and product-truth risks (§4)
> are the parts that bear on game design.

---

## 1. Direction in one paragraph

Do not make Eldritch Dynasty broader. Make what it already has **reach the
player**:

- the ladder the player is told to climb should be climbable;
- the 500-year campaign should hold things the 300-year one cannot;
- the people should be remembered;
- the record should tempt;
- and all of it should be proven on a human, not only on a bot.

The game is strongest when one act touches all three load-bearing ideas:

1. **blood** — the family is materially different because of what was bred,
   spent, married, inherited or lost;
2. **debt / Ledger** — the house pursues something over centuries, and the old
   contract still constrains the present;
3. **record** — what the house says happened can matter differently from what
   happened.

The sentence a player should be able to say afterwards:

> **I bred this family, lied about what it did, and centuries later the lie came
> back when the debt was read.**

---

## 2. The five feelings to optimise for

- **I have a plan.**
- **This person matters.**
- **That happened because of me.**
- **This generation is different.**
- **I want to see how this ends.**

A feature is worth building when it strengthens one of these without weakening
the others. Each proposal below names the feeling it serves.

---

## 3. What shipped — protect it

Most of the previous version's priorities are on `main` now. **Do not reopen
them as feature proposals.** Protect them, and measure whether they carry the
experience.

| Was a suggestion | Now | Protect |
|---|---|---|
| Make "Choices Matter" credible | #334 finished on 17 Oct: **0 write-only memory keys, 0 prose-only choices, 0 unclassified keys**. Both findings are validation **errors** now. 25 reserved memories have named later readers (`events/remembered_accounts.yaml`). Eight choices are declared `self_expression`. | A choice that changes nothing fails the build. Never weaken that to land content. |
| Finish the opening | The Examination shipped (#343 via #501), with paired-seed balance evidence (#1741). | No dominant answer. Every answer stays a readable given/owed trade-off. |
| Progressive reveal | #368: first-fifty-year disclosure, reveal notices, returning-reader opt-out. | Reveal a rule when it becomes actionable. |
| Faster second run | Skip-seen prose (#267). Shape, stall and divergence instruments (#270–#272). #341's ranked rewrite. | Never auto-skip a changed variant, a decision, a Record, a rite or an interlude. |
| Tree as a strategic surface | #268: search (diacritic-insensitive, #1759), hall filter, direct-line rooting, relevance, known succession, kinship paths, TreeCounsel. | Surface people for what they **did**. |
| Chronicle as causal memory | #269: dated backlinks from bill to page to act. | No hidden formulas. |
| House Afterimage | #260, then #1808: people, defining records and recorded lineage in `afterimageModel`, with archived ancestry preserved. | No grade, no score. |
| Help without omniscience | #273: graduated, in-world adviser help. | Diagnosis first, then the knowable rule. Never the hidden roll. |
| Reading comfort, localisation readiness | #275, #276, `docs/LOCALISATION.md`. | The Chronicle keeps the words the player saw. |
| — (new) | **Plain English** mode (#410/#415): 5,492 counterparts, 0 missing, a zero-gap guard. | Same mechanics in both modes. Only the words change. |
| — (new) | 30 achievements, the 33-year Demonstration, library physical-copy lifecycle (#1205). | No `if (demo)` in core. |

### Interaction rules that still hold

- **decide → consequence → decide again.** Never replace an answered decision
  with the next prompt before the player sees what it did.
- **The Chronicle is not the passage log.** Promote firsts, losses, reversals,
  claims, rungs and rites. Batch the receipts.
- **The cast is situational.** Bring people forward for what is happening to
  them now.

---

# 4. Game improvement rationale

Grouped by the part of the game each proposal opens up. Every item comes from
a measurement; tracker priority labels decide which actionable issue comes next.

## G1 — The ladder stops halfway, for everyone

*Feelings: I have a plan · I want to see how this ends.*

**Tracked:** #1801 (awakening odds), #1802 (ladder scales), #1803 (frozen
stretches, shipped), #1805 (power-gap evidence), #1817 (callable forcing rites),
#1818 (summit), #1820 (hidden capacity) and #1824 (casting-reveal audit).

**Owner rulings, 18 October:** raise natural waking odds for expressing men
only (#1801); keep one ladder scale calibrated to the Long Line (#1802); let
the player try forcing on any unwoken boy in the rite's window, once per boy,
with capacity hidden and the same danger for every boy (#1817); keep the summit
reachable for climbing play (#1818). Free capacity reveals are removed;
knowledge paid for through a rite's consequences remains allowed.

`docs/GAME-LOOP.md` calls the Ascension Ladder *"the main progress track"*: six
rungs. Measured play rarely gets past the second or third.

- **Ordinary play** peaks around **Adept** (mean best rung 2.05–2.39 on the 0–6
  index; BALANCE-LOG, #36 remeasurement).
- **Bots built to climb:** 29 of 30 ladder-gate runs (16 Oct) topped out at
  Hierophant or Adept.
- **The summit:** Apotheosis is **0/512** in ordinary play and **1/512** for the
  `ascendant` policy (#332/#378), against the owner's 8–29% band. The
  `ending_all_long` achievement needs it, and `ending_apotheosis` measured
  0/100 in every column.

### What actually stops the climb (diagnosed 17 Oct 2026)

A read-only diagnostic played **72 Long Lines**: 24 seeds (5100–5123) × three
policies. The policies were ordinary play (`chronicler`), ordinary play plus a
600-crown auction ceiling (`bid`), and the composite `ascendant`. Each year it
recorded the first unmet gate of the house's foremost expressing man, using the
engine's own `standingOf`. It changed no game code. Share of years in each
blocker:

| Blocker of the foremost man | chronicler | bid | ascendant |
|---|---:|---:|---:|
| **power** below the next rung's floor | **42%** | **47%** | **44%** |
| **awakening**: no expresser in the house has woken | **29%** | **27%** | **27%** |
| no expressing man alive at all | 12% | 10% | 11% |
| books | 11% | 10% | 6% |
| everything else (Madness floor, Respect, …) | 6% | 6% | 12% |

**Books were the wrong first guess.** They cost 6–11% of blocked years. When a
book does block, the ascendant house has the supply: its shelf peaks at about
11 of 21 books, and its best reader holds about 8. Its blocked years are reading
time or idle readers. Ordinary play is thinner: a shelf of about 6, because
`bidCeiling` defaults to 0 and an untouched Table never bids. Even there, books
are a minor wall.

**Wall 1 — the frozen ladder (the Long Wait).**

- For **30–34% of all years** (117–145 years per run) the house has no
  awakened expresser, so no rung can move.
- That time comes in about three stretches per run. The median longest stretch
  is 56–82 years; the worst is about 250.
- In **55%** of those years a **grown man (20+) who can express has simply not
  woken**. In 35% there is no expressing man at all. Only about 10% are boys
  still in the normal waking window.
- §11 designed three answers to exactly this. **Two are now built; callable
  forcing remains tracked in #1817:**
  - **Declaring a man mundane — built (#1794)** (§11, *"The Long Wait"*):
    the Table writes `Person.awakening.declaredMundane`; succession and natural
    waking respect it. Bot policies do not yet use the order.
  - **The Late Waking — built (#1797)** (§11: after 30, *"always a scripted
    moment"*): `the_late_waking` in `events/rare_blood.yaml`, rare and unforced.
  - **Forcing it.** The Drowning, the Vigil and the Dark Year cast only boys
    aged 7–15 (Dark Year 10–18), so none can reach the grown men who make up
    most of the wait. They are rare ambient draws the player cannot call. Over
    800 Long Lines they appeared in about **9%, 5.5%, 4.4% and 3.6%** of
    campaigns. Forcing happened in only 2–3 of 24 runs in any column.

**Wall 2 — the Hierophant power floor.** Most power-blocked years sit below
Hierophant's floor of 50. The median shortfall is **13 points** in ordinary
play and **9** for the ascendant house, which marries in. That is the breeding
game doing its job. The question is whether the player can *see* which marriage
closes it.

### Direction and dependencies

1. **Give the Long Wait the verbs §11 already wrote.**
   - **Built (#1794):** a Table order to **declare a man mundane**. A grown
     man of the line (19+, never woken, not the Head) stops waking for good.
     The succession passes over him, as over a mundane man, to a brother or
     cousin who may still express, or to a Regent. He stays free to be placed,
     married or sent. Both the upside and the risk are real. No bot policy
     uses it yet, so the frozen-ladder numbers above are unchanged until
     somebody plays it, or a policy is taught to.
   - **Built (#1797): The Late Waking**, a scripted scene for a man past 30.
     Rare, unforced, and a turn in the story when it comes.
   - **Let the player call a forcing rite** for an eligible boy, the way the
     Vessel rite is already callable from the Table, with the Madness and death
     risk unchanged. *Invariant check:* the call is the player's; the outcome
     must stay a gamble. Forcing must never become reliable, or Eldritch Power
     schedulable (invariants 4 and "Do not"). The owner approved the any-boy,
     hidden-capacity route on #1817; land after #1801 and #1820 and measure it
     separately from the natural-odds change.
2. **Make the power gap legible, not smaller.** Hierophant's 50 is the intended
   hard part. Use the Match card's word about the line (#28), the three
   futures (#214) and TreeCounsel to show *which marriage* closes a 9–13-point
   gap without promising a gain. #1805 owns this presentation; #1802 separately
   re-derives the scale after #1801, against the owner's recorded reach targets.
3. **Books, only after 1 and 2.** For ordinary play, consider making the auction
   ceiling visible at the first auction rather than leaving it at 0.
4. **Then the top.** Work the joint gates after the Unmaking — Mind over
   Madness, the Ledger overlap, Exalted after the rite spends two tiers — one
   mechanism at a time, on paired seeds. The owner chose a reachable summit
   for climbing play (#1818), after #1801 and #1802; the God-Madness floor stays.

**Never:** make Eldritch Power reliable or schedulable, or quietly lower the
God-Madness floor (invariant 4; #378).

**Measure:** frozen-ladder share and longest stretch; blocker shares as in the
table; Vessel, Demigod and God reach, not only God. Re-run the same 72-run
diagnostic before and after each change, on the same seeds.

## G2 — Watch five people play it

*Feelings: all five. This is the only instrument that measures them.*

**Tracked:** `issuesneedingowneraction`, using `docs/PLAYTEST.md`. Recruiting
the people requires the owner; this is not an agent-buildable tracker issue.

**Evidence:** `docs/PLAYTEST.md`. Every human acceptance test was **waived on
28 September and none was run**: a first-timer finishing a Short Line, naming
three people, blaming a decision rather than a number, second-run divergence,
the screen-reader run. *"Waived means not owed, not passed."*

Thousands of bot runs show the game is reachable and coherent. No bot can say
whether it is legible, moving, or boring at minute twelve. Several brief risks
can *only* be checked this way:

- *"Record mechanic as pure stat — if players resolve Record choices without
  reading them, the choices are not costing enough"* (§27);
- *"Women read as people, not inventory"* (#24);
- *"After a loss, the player blames a decision rather than a number"* (#36).

**Do:** run the existing protocol on the beta.3 Windows installer. It already
passed a fresh-VM install and cold resume, so this is a game-improvement step,
not a launch step. Five first-timers, one Short Line each. Record first,
interpret second, tune last. Ask:

- *Which three people do you remember, and why?*
- *What was the house trying to do?*
- *Name one decision that changed what happened later.*
- *When you chose Record, Omit or Embellish, what were you weighing?*
- *Where did you stop understanding what you were looking at?*

What they say should inform changes to the tracker priority labels.

## G3 — Give the Long Line things the Short Line cannot hold

*Feelings: this generation is different · I want to see how this ends.*

**Tracked:** #1807.

**Evidence** (#274 baseline, BALANCE-LOG 2 Oct, 12 shared seeds):

- **No authored event or arc is exclusive to either campaign.** The difference
  is term, Ledger capacity (3 vs 9 clauses) and ending set.
- **Chronicler play reached a Long-exclusive ending in 0/12 runs.** Its two
  exclusive endings are Apotheosis (G1) and Unmade (rare).
- **There is raw material:** 35.8% of late-Long choices have interaction shapes
  never seen in the paired Short run.

**Direction:** make the last two centuries *different in kind*, not only in
number:

- post-1342 Age material whose premise needs a family that has already been
  through three hundred years — old Discrepancies maturing, branches that are
  now houses, a Ledger that is two-thirds read;
- clause recoveries beyond the third that *open* things, not only add to a
  reading;
- a late ending path that ordinary play reaches.

Build on Ages, the Ledger and the ladder. No global late-game multiplier.
Measure **Long-exclusive reach under chronicler play**.

## G4 — Pride climbs, but it does not fall harder

*Feelings: that happened because of me · this generation is different.*

**Tracked:** #1809.

**Evidence** (BALANCE-LOG, #36 remeasurement, 26 Sep): §29.7 asks that
high-Bearing houses reach *higher* rungs on average **and** arrive more
variously, failing harder. The first half holds — high beat low in **8 of 8**
batches, by about +0.17 of a rung. The second half does not: the spread was
only **1.0–1.2 standard errors** above zero, and **3 of 8** batches failed. The
issue records the campaign-term condition as **not satisfied**.

**Why it matters:** the brief's own risk register warns that Bearing must not
become a difficulty dial. As measured, it is closer to a mild **buff**. A proud
house does slightly better and is no riskier. §29.3's *"it bites three times,
and always late"* is the part that is not landing.

**Direction:** strengthen the *late bites* — the three moments §29.3 names — so
a proud house's failures are bigger and more personal. Do not retune
`REMEMBERED_AFTER`. The issue froze two generations as a design statement.
Never name the flaw on screen (§29.4).

## G5 — Afterimage v2: from a statistics card to a house

*Feelings: this person matters · I want to see how this ends.*

**Tracked:** #1808, shipped on `main` (including archived recorded ancestry).
The list below records the rationale for that change, not outstanding work.

**Original evidence:** `afterimageModel` printed seven counts — pages, blanks,
embellishments, lies standing, clauses, attested rung, living blood — and one
Chronicle quote. **It named no person.** The ending screen is the last thing the
player sees. That version answered *"how many pages?"*, not *"what was this
house?"*

**Built from existing read models:**

- three central people, ranked by how often the Chronicle and decision log name
  them;
- the person the house spent;
- the closest brush with extinction (the lowest living-blood year);
- the oldest standing embellishment, and the oldest blank;
- a lineage silhouette of the direct line.

No grade, no rank, no reconstruction of what a blank omitted.

## G6 — Write real trade-offs for the money-shaped choices

*Feelings: I have a plan · that happened because of me.*

**Tracked:** #1810.

**Evidence** (#341 closeout, 6 Oct): replay familiarity is at **27.1%**, the
adopted target. But **money is in 9 of the 10 most common choice shapes**, and
the ranked rewrite could not move that: freed slots refilled from the tail.
BALANCE-LOG: *"Moving it needs new trade-offs written on purpose, not corrected
prices. That is a content commission, not a sweep."*

**Direction:** a content pass where each rewrite trades coin against something
only this game has:

- a name in the record;
- a branch's grievance;
- a person's availability for the Match;
- a Discrepancy someone can prove;
- a book on the shelf.

Measure with `gate:replay` before and after. Do not lower the docket budget to
flatter the figure.

## G7 — The rare tail: content almost nobody sees

*Feeling: this generation is different.*

**Tracked:** #1811.

**Evidence:** at 800 × 500 years, the rarest of 487 non-frame events fire in
0.75–1.25% of runs (BALANCE-LOG 17 Oct). AGENTS.md records **seven frame
interludes that fire in 1–4 of 60 runs**, each waiting on a single named lie.
Moving three interludes onto the *page* (`chronicled`) took them from 0 to
13–17 runs in 60.

**Direction:** for each tail item, decide whether it is meant to be legendary.
If not, fix the funnel upstream — the launcher, the premise, the page — as the
`chronicled` move did. Don't raise the item's own weight. Diagnose with the
five-stage funnel in §5.

## G8 — Unfinished corners of the brief

**Tracked:** #1812 (`recast`), #1813 (family challenges) and #1814 (Regency
and unwoken stretches). Auction favours were deliberately not raised: the
owner removed them in #1184 until a source exists.

Smaller items. Each is a promise in the concept brief that the code does not yet
keep.

- **Auction favours** (§14). Removed by the owner on 14 Oct (#1184) *"until a
  source exists"*. The auction now takes coin, heirlooms and marriage promises.
  A favour economy — earned through Record challenges, careers or assize
  service — would give a Regency another way to make progress (§14: *"the
  auction is how a Regency still makes progress"*).
- **`recast`**. Declared and handled as an Effect, and authored by **no
  content**: gate 10 reports it as owed (invariant 11). Either author scenes
  that need it or retire it on purpose.
- **Family challenges that punish over-specialisation** (§21: *"twenty
  generations chasing Darkness and Death, and then a fire, and nobody can call
  water"*). Measure how often a pooled check over the house fails *because* of
  breeding focus. If the answer is "rarely", the breeding game has no downside
  for specialising.
- **The Regency** (§7, *"most runs lose 30–80 years this way at least once"*).
  G1's diagnostic found the ladder frozen for 117–145 years per Long Line, in
  about three stretches; 35% of that time has no expressing man at all. Measure
  decision density and spine gap *during* those stretches. They are the most at
  risk of feeling like waiting, and G1's verbs should give them decisions.

## G9 — Visuals that make the system legible in play

*Feeling: I have a plan.*

**Tracked:** #1815 (item 1), #1808 (item 6, shipped) and #1806 (item 7,
after #1805). Items 2 and 4 already have #214's futures and #269's backlinks;
items 3 and 5 wait on the G2 human playtest before new work is raised.

Every visual element should answer one of: **who matters? what changed? what
did this cost? what is the house trying to do? what is remembered?**

The surfaces and their design rationale (work order remains in the tracker):

1. the tree changing across generations;
2. the Match as three futures;
3. Record / Omit / Embellish shown beside the page it writes;
4. a callback beside the old page it cites;
5. a rite as before, decision, after;
6. the Afterimage (after G5);
7. **ladder blockers drawn as a path, not a sentence** (G1).

Decoration that answers none of those questions should not compete with the
text.

---

# 5. The boredom risks worth measuring

> **A boring stretch is time in which the player keeps performing actions
> without receiving new information, facing a materially different trade-off,
> changing the direction of the house, or seeing a consequence that makes an
> earlier choice mean something.**

| Risk | Question | Instrument on `main` |
|---|---|---|
| Spine gap | Years since a Match, Record, Age boundary, clause, rung, rite, Regalia or land change | `density-gate.ts` (#270) |
| Shape streak | How many prompts in a row with the same mechanical rhythm? | #271 shapes, `gate:density` |
| Progress stall | Years at one blocker with no player-actionable route | #270's stall detector. **Run it on G1's blockers.** |
| Maintenance streak | The same verb, target and answer with nothing changing between | delegation and standing orders |
| Second-run sameness | Repeated prose and shapes early in run two | `gate:replay` |
| Attribution | Can the player find the act an echo remembers? | #269 backlinks, `echo-chains.test.ts` |
| Regency waiting | Decision density while no son can express | not yet measured (G8) |

For rare content, separate the funnel stages:

1. the prerequisite state never exists;
2. the state exists but slots cannot cast;
3. a condition is false;
4. it is eligible but never selected;
5. it is selected but a branch never resolves.

"Fired 2%" is not a diagnosis. Every instrument above measures a bot. G2
measures a person.

---

# 6. What not to build

- **Tactical combat.** War matters through Muster, people, land, standing and
  promises.
- **A conventional world map as the centre.** The tree, Chronicle and holdings
  are more specific to this game.
- **Universal relationship bars.** Named relationships, grievances, recurring
  threads.
- **Generic roguelite meta-upgrades.** Replay changes remembered history (the
  Library of Houses), not starting power.
- **A global difficulty-by-year multiplier.** Strengthen the system that owns
  the time.
- **A new currency for "depth".** Every meter competes with blood, debt, record,
  people and standing. (G8's favours are a brief-specified bid currency, not a
  new meter.)
- **Progress bars for mysteries.** An actionable model, not omniscience.
- **"More ordinary events" as the default repetition fix**, or a lowered docket
  budget to flatter the numbers.
- **Any G1 fix that makes Eldritch Power reliable** or lowers the God-Madness
  floor.

---

# 7. What to measure before adding another major feature

**People (G2):**

> **Which three people from that run do you remember, and why?**

The failure is not disliking someone. It is remembering roles and numbers but no
people.

**Progression (G1):** best-rung distribution; Vessel, Demigod and God reach;
blocker shares; frozen-ladder share and longest stretch; forcing rites offered
and taken; mundane declarations.

**Campaign identity (G3):** Long-exclusive reach under chronicler play.

**Pride (G4):** the high-minus-low Bearing spread, judged per batch.

**Agency:** the #334 audit stays at zero. Callback rate. The recoverable-source
rate for delayed consequences.

**Pacing:** spine gap, shape streak, stall duration, regency density.

**Replay:** `gate:replay` familiarity ≤ 27.1%, top shape ≤ 4.7% (adopted
guards), and the money share of the top ten shapes (G6).

---

# 8. Decision rule for future proposals

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
9. **Does it help the player reach content the game already has** (G1, G3, G7)
   before adding more?

If the first three answers are **no**, it is unlikely to improve the game.

---

# 9. Rationale and dependencies for game work

Issue priority labels are the only work ordering, after safely advancing
in-flight work as `AGENTS.md` requires. This section explains the relationships
between proposals; its numbering does not assign priorities.

1. **G2: watch five people play.** It is cheap, it uses a build that exists,
   and its findings can change the issue labels. Recruitment waits on the owner.
2. **G1: the ladder.** Declare mundane and the Late Waking are built. Natural
   waking odds (#1801) precede scale calibration (#1802), then the reachable
   summit (#1818). Callable forcing (#1817) follows #1801 and #1820 and is
   measured separately. Power-gap evidence (#1805) follows #1820.
3. **G3: the Long Line's late centuries.**
4. **G5: the Afterimage with people in it.** Built in #1808; protect it.
5. **G4: pride's late bites.**
6. **G6: the money-shape content pass.** Long Wait decisions (G1) are good
   non-money trade-offs to write into it.
7. **G7 and G8: the tail and the brief's corners.**
8. **G9: visuals**, alongside whichever item they illustrate.

---

# Appendix — launch notes (parked)

Owner accounts are months away (`issuesneedingowneraction`), and the game comes
first. `market research.md` §§7–14 holds the evidence. Only two launch items
touch the game itself, so they are worth knowing now:

- **Claims must match measured play.** The Steam copy in `store/steam/README.md`
  promises *"the complete Ascension Ladder"*. G1 decides whether that sentence
  can stay.
- **AI-content disclosure.** Steam's January 2026 rules require disclosing
  pre-generated player-facing content, narrative text included. This
  repository's prose is written in an AI-agent workflow. That is the owner's
  determination to make, but it may shape how future content is authored and
  credited, so it is better decided early than discovered late.

Everything else waits until the accounts exist:

- the Steam page before signing, because it starts wishlists;
- June 2027 Next Fest, with registration by 25 April 2027;
- Steam first, mobile second;
- localisation at about NZD 24,000–34,000 per language for the Original prose;
- price within NZD 28–35;
- the NZ Game Development Sector Rebate, which pays only above NZD 250,000 a
  year of qualifying spend.

---

# Final principle

The best next change is unlikely to be the one that makes the simulation
largest. It is the one that lets a player reach, feel and remember what is
already there:

> **I chose that because of this person; the house paid for it; the book
> remembered it; and the next generation was different because I did.**
