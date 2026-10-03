# Eldritch Dynasty — Suggestions

> **Purpose:** one current decision surface for future product direction.
>
> This file consolidates the still-useful recommendations from
> `BoringThingsAndHowToPreventThem.md`, `EngagingAndFunSuggestions.md`, and
> `market research.md`. It deliberately does **not** preserve every historical
> proposal. `market research.md` remains the evidence ledger and source list;
> this file is the shorter answer to **“what should we do next, and what should
> we avoid?”**
>
> The concept brief remains authoritative for game rules. Open issue plans remain
> authoritative for work that is not yet built.

---

## 1. Product direction in one paragraph

Do not make Eldritch Dynasty broader. Make its distinctive loop easier to
understand, harder to doubt, more personal, faster on a second run, and easier
to show to another person.

The product is strongest when one act touches all three of its load-bearing
ideas:

1. **blood** — the family is materially different because of what was bred,
   spent, married, inherited, or lost;
2. **debt / Ledger** — the house is pursuing something over centuries and the
   old contract still constrains the present;
3. **record** — what the house says happened can matter differently from what
   happened.

A useful store-sized sentence remains:

> **Breed a bloodline for five centuries, decide what the family writes about
> what it did, and face the creditor who kept the other copy.**

A useful player-memory sentence is even sharper:

> **I bred this family, lied about what it did, and centuries later the lie came
> back when the debt was read.**

Future work should make those sentences truer in play.

---

## 2. The five feelings to optimise for

A feature is valuable when it strengthens at least one of these without
weakening the others:

- **I have a plan.**
- **This person matters.**
- **That happened because of me.**
- **This generation is different.**
- **I want to see how this ends.**

These are more useful than “more depth”, “more content”, or “more systems”.
They describe player experience rather than implementation volume.

---

## 3. What is already good enough to protect

Several ideas that were once recommendations are now part of the game or have
already had dedicated work. Do not reopen them as broad feature proposals.

### Naming is no longer clerical work

The historical version asked for hundreds of names. Current runs ask for a
small enough set that naming can mean recognition rather than data entry.

**Protect:** only ask the player to name someone when the name itself matters.

### Consequences are shown before the next question

The client now preserves the middle beat:

**decide → consequence → decide again**

**Protect:** never replace an answered decision with the next prompt before the
player sees what the answer did.

### The Chronicle is not the passage log

Routine actions should not flood the object that is supposed to preserve a
five-century legend.

**Protect:** promote firsts, losses, reversals, relationships, claims, rungs,
rites, and remembered consequences; batch or omit receipts.

### The family cast is becoming situational rather than constitutional

A changing name in the same permanent office is not a changing story.

**Protect:** surface people because of what is happening to them now, not
because every generation must show the same five roles.

### The game now has stronger long-horizon structure

House Ambitions, consequence echoes, generation arcs, readable ladder blockers,
stronger Match framing, advisers, mechanically distinct Ages, rival threads,
and deliberate rite presentation have all had dedicated work.

**Protect:** measure whether those systems are actually carrying the experience
before inventing replacements for them.

---

# 4. Current highest-value directions

## P0 — Make “Choices Matter” mechanically credible

The commercial promise is fragile if two buttons differ in prose but converge in
state.

The active choice-audit work is therefore product work, not housekeeping.

### Desired outcome

For every meaningful choice, at least one of these is true:

- persistent state differs;
- a later eligibility or callback differs;
- a person or relationship changes;
- the Chronicle can later prove the difference;
- the option is explicitly self-expression and is authored as such.

### What not to do

Do not create contrived callbacks merely to make a linter green. If a memory
flag is redundant because the Chronicle already preserves the act, delete the
flag. If the choice is intentionally expressive, say so explicitly.

### Evidence to keep

Track:

- write-only memory keys;
- prose-only choices;
- converging outcome signatures;
- option-selection skew;
- later callback rate;
- delayed consequences with a recoverable source.

This is the clearest route to making “That happened because of me” true.

**Failure should usually create a new problem, not merely subtract progress.**
A lost person, failed rite, broken promise, bad Match, or missed opportunity is
more engaging when it changes what the house must now decide. Pure subtraction
can be necessary, but repeated setbacks that only make the same goal farther
away turn consequence into delay.

---

## P0 — Finish the opening as a statement of the whole game

The Examination is valuable because it can make the first minutes teach the
same grammar the whole campaign uses: **given / owed, person / house, benefit /
price**.

### Desired outcome

The opening should establish:

- who the founder is;
- what the debt feels like;
- that every gift is paid for;
- that there is no obviously correct build;
- that names matter;
- that the house's choices will be remembered.

### Guardrails

- no dominant answer that turns the opening into point-buy;
- no hidden “correct morality”;
- paired-seed equivalence evidence for answer packages;
- do not invent balance rates merely to complete the UI;
- keep the long-run founder/guardian framing consistent with the concept brief.

This is one of the best opportunities to make the product legible before the
player meets the larger simulation.

---

## P0 — Make the first fifty years teach the interface progressively

The early game currently has enough systems that showing everything at once can
turn depth into noise.

### Desired outcome

Reveal strategic surfaces when the player has a reason to care about them.

Examples:

- do not foreground advanced ladder detail before the player has an expresser;
- introduce Assize with the first decision where it matters;
- explain Seal / Blood / Highest in context, not as unexplained labels;
- keep seed and diagnostic information behind Advanced;
- give money, standing, and other headline resources their own readable rows;
- confirm a decision and, where truthful, tell the player whether its result is
  immediate, delayed, or unknowable yet;
- preserve save-and-leave as a safe navigation action rather than making
  “return to menu” destructive.

### Principle

**Progressive reveal is not hiding rules.** It is sequencing them so the player
learns a rule at the moment it becomes actionable.

---

## P0 — Restore a real but rare upper-ladder tail

An advertised final ambition that is effectively impossible becomes waiting,
not aspiration.

The God route should remain difficult, costly, and partly numinous. It should
also exist in measured play.

### Desired outcome

- the authored rung floors remain meaningful;
- the population produces a rare genuine candidate tail;
- the route is not fixed by making Eldritch Power reliable;
- the route is not fixed by silently lowering the God-Madness requirement;
- progression-side costs and rites do real work;
- the player can read the current blocker without seeing a spreadsheet of
  hidden genetics.

### Measure together

For every calibration candidate, record:

- power and Madness tail reach;
- `madness > mind` overflow;
- rite uptake and rite provenance;
- ending distribution;
- blood/genetic invariants;
- years a house spends with one unchanged blocker and no actionable route.

Reachability and boredom are the same problem when the player is waiting at the
same closed door for generations.

---

## P1 — Make a second run reach new context faster

A long generational game cannot ask a returning player to reread the same
known material at first-run speed.

### Desired outcome

The second run should diverge early because of history, policy, people, or
Library-of-Houses context — not because enemies have more health or numbers are
larger.

### Build on existing systems

Prefer:

- seen-state presentation;
- fast reveal / skip for already-read prose;
- standing policy for mastered, reversible, low-risk repetition;
- interrupt that policy when the state changes materially;
- Library-of-Houses callbacks that alter context, not starting power;
- campaign identity that makes Short and Long structurally different.

### Measure

- exact prose repeated in the first 30 prompts;
- time to first unseen event/context;
- time to first strategic divergence from the previous run;
- interaction-shape streak;
- how many decisions the player delegates and then overrides.

---

## P1 — Turn the family tree into a strategic surface

A dynasty game has a visual asset most narrative games do not: a tree that is
both story and state.

The risk is that dozens of people become inventory.

### The tree should answer questions

Without exposing raw genome internals, the player should be able to discover:

- who matters to the current House Ambition;
- who can inherit;
- which branch is aggrieved;
- who is related to the current Match;
- who carries a remembered grudge or promise;
- who has been spent, lost, married out, or made exceptional;
- where a named person sits in the line the player has been following.

### Emotional rule

Bring people back because of what they **did**, not merely because of the slot
they currently fill.

A successful session should leave the player remembering people, not only
functions.

---

## P1 — Make the Chronicle navigable as causal memory

The Chronicle is a distinctive moat only if it helps the player connect old
acts to current consequences.

### Desired flow

**current bill → old page → original act**

Useful affordances include:

- “from the winter of 1218”;
- jump to the related Chronicle page;
- show the named people / houses involved;
- link an echo to the act it remembers;
- preserve uncertainty where the fiction is uncertain.

Do **not** expose the hidden formula (“Bearing +12 caused −0.3 appetite”). The
goal is causal legibility, not debug telemetry.

Record / Omit / Embellish should also carry **immediate temptation**. The three
answers are strongest when the player is choosing between a present advantage,
a present cost, a relationship, standing, or uncertainty **and** the version of
history the house will leave behind. If the Record choice is merely “truth,
silence, or lie” with no reason to want the dangerous answer now, it becomes a
ritual rather than a strategy.

---

## P1 — Create a compact post-run House Afterimage

A full Chronicle is valuable but too large to be the default shareable object.

A generated afterimage can make a completed house easy to remember, screenshot,
compare, and discuss.

### It should be factual, not a scorecard

Possible elements:

- house name and sigil;
- ending;
- three central people;
- one person sacrificed;
- oldest surviving embellishment;
- oldest blank;
- largest holding and worst loss;
- closest brush with extinction;
- longest-running outside relationship;
- one Match rejection that later mattered;
- one Chronicle sentence;
- a compact five-century lineage silhouette.

No grade. No morality score. No “good ending”.

The question is:

> **What was this house?**

---

## P1 — Use visuals to prove the game is systemic, not merely literary

The market risk for a text-heavy strategy game is that screenshots can look
like a sequence of prose panels. The product needs visual surfaces that show
state changing over time.

### Highest-value visual surfaces

1. **The family tree** — names, branches, marriages, losses, highlighted
   continuity.
2. **Match comparison** — three people as three futures, with clear differences
   the player can reason about.
3. **Chronicle / Record** — the same act as fact, omission, or embellishment,
   and the later page that remembers it.
4. **House holdings / plat** — accumulation and reversal without turning the
   game into a conventional world-map strategy game.
5. **Age identity** — typography, marginalia, illumination, wear, framing, or
   restrained palette shifts that make a new era visually recognisable.
6. **Rites** — deliberate staging and before/after state, not another ordinary
   event card.
7. **House Afterimage** — a visually coherent object suitable for the ending,
   screenshots, and sharing.

### Visual rule

A new visual element should answer at least one of:

- **who matters?**
- **what changed?**
- **what did this cost?**
- **what is the house trying to do?**
- **what is remembered?**

Decoration that answers none of those should not compete with the text.

---

# 5. The boredom risks worth measuring

Boredom here is not slowness.

> **A boring stretch is time in which the player keeps performing actions
> without receiving new information, facing a materially different trade-off,
> changing the direction of the house, or seeing a consequence that makes an
> earlier choice mean something.**

## Spine gap

Years since any major structural beat:

- Match;
- Record block;
- Age boundary;
- clause recovery;
- rung change;
- rite offer/result;
- Regalia gain/loss;
- major land change;
- inherited grudge / branch consequence.

A long run of ordinary choices can be healthy until nothing changes what those
choices mean.

## Interaction-shape streak

How many prompts in a row have the same mechanical rhythm even when the prose
is different?

Distinct event text is not enough if every decision is paragraph → two buttons
→ immediate outcome.

## Progress stall

For each long-horizon goal, measure:

- years with the same dominant blocker;
- years since a player-actionable path existed;
- generations with no change in the active ambition;
- repeated attempts at an action that cannot yet succeed.

## Maintenance streak

A chore is a repeated action whose **answer does not change**.

Measure repeated:

- verb;
- target class;
- outcome preference;
- with no meaningful intervening state change.

Delegate or batch only when the action is frequent, reversible, low-risk, and
already mastered.

## Delayed-consequence attribution

When an old act returns, can the player understand what it is remembering?

Every delayed-consequence system should have at least one path proving the
player-facing text can identify its source act without revealing hidden math.

## Tail funnel

For rare content, distinguish:

1. prerequisite state never exists;
2. state exists but slots cannot cast;
3. condition is false;
4. eligible but never selected;
5. selected but a branch never resolves.

“Fired 2%” is not a diagnosis.

---

# 6. What not to build

## No tactical combat system

War should matter through Muster, people, land, standing, promises, and
consequences. A tactical layer spends production on a market where the game is
least distinctive.

## No conventional strategic world map as the centre

The family tree, Chronicle, and house holdings are more specific to this game.
A world map may support context; it should not replace the dynasty as the main
decision surface.

## No universal relationship bars

Use named relationships, remembered grievances, advisers, and recurring
threads. A bar for everybody turns specific people back into inventory.

## No generic roguelite meta-upgrade tree

Replay should change remembered history and context, not simply start run two
with permanent power.

## No global difficulty-by-year multiplier

If late play is flat, strengthen an existing system that owns time: Ages,
Ledger, Bearing, land, rites, rivalries, or ambitions.

## No new currency merely to create “depth”

Every meter competes for attention with blood, debt, record, people, and
standing. Add one only when an important decision cannot be expressed with
existing state.

## No progress bars for mysteries that are meant to remain mysterious

The player needs an actionable model, not omniscience. Explain what can be
acted on; preserve uncertainty where uncertainty is the fiction.

## No “more ordinary events” as the default repetition fix

Current work already shows that repetition is often about decision shape,
concentration, callbacks, or missing consequences rather than a shortage of
prose.

Do **not** lower the global event/docket budget merely to make the repetition
numbers look better. Fewer questions is not the same as better questions: fix
the repeater, interaction shape, callback, or owning progression system while
preserving the measured decision density.

---

# 7. Visual and storefront implications

The game must be marketable with **gameplay**, not only with atmosphere.

A useful screenshot/trailer set should prove, quickly:

1. a family changes across generations;
2. a Match is a strategic comparison;
3. the player makes a morally or strategically costly choice;
4. Record / Omit / Embellish changes what the book says;
5. an old act returns later;
6. a rite spends a named person;
7. the ending can summarise a house that looks different from another run.

The first trailer should answer **“what do I do?”** before it answers **“how is
this written?”**

Avoid store art that tries to explain the game with paragraphs. Let the logo,
art direction, and gameplay surfaces do different jobs.

---

# 8. Demo direction

Do not optimise the demo to an arbitrary minute count.

Optimise it to complete one recognisable Eldritch Dynasty shape:

1. the debt;
2. a person the player can care about;
3. a Match;
4. a meaningful choice;
5. Record / Omit / Embellish;
6. an echo proving the game remembered;
7. the frame / creditor promise;
8. a forward-looking problem that makes continuation desirable.

Then measure actual completion time and drop-off.

A demo should end because the **shape is complete**, not because a timer has
expired.

---

# 9. What to measure before adding another major feature

## First-session legibility

- time to first meaningful Match;
- time to first Record decision;
- time to first consequence echo;
- prompts before House Ambition affects a choice;
- first point where the player can explain their next strategic move;
- UI concepts the player sees before they have a reason to care about them.

## Agency

- persistent-state divergence between options;
- prose-only / self-expression rate;
- callback rate;
- recoverable source rate for delayed consequences.

## Pacing

- spine gap;
- interaction-shape streak;
- strategic-stall duration;
- maintenance streak;
- years at one blocker with no action.

## Replay

- repeated prose in the first 30 prompts;
- time to first unseen context;
- time to first different strategic plan;
- seen text skipped;
- standing policies interrupted by meaningful state changes.

## People

Human playtest question:

> **Which three people from that run do you remember, and why?**

The failure is not that a player disliked somebody. The failure is that they
remember roles and numbers but no people.

## Chronicle

- voluntary opens;
- search/filter use;
- jumps from consequence to source;
- exports;
- afterimage/share actions where platform policy and privacy permit.

---

# 10. Decision rule for future proposals

Ask these in order:

1. Does this make **blood**, **the debt/Ledger**, or **the record** more
   interesting?
2. Does it create a decision recognisably different from an existing one?
3. Can its consequence be remembered later?
4. Does it strengthen one of the five desired player feelings?
5. Does it make a second run meaningfully different?
6. Can the player understand enough to act without an external wiki?
7. Is it worth the cognitive load and production cost?
8. Can the idea be proved with an existing surface before adding a new system?

If the first three answers are **no**, the feature is unlikely to improve the
product.

---

# 11. Suggested order of product work

This is a direction order, not a replacement for issue priority or repository
coordination.

1. **Credibility:** finish choice consequence auditing and remove dead /
   misleading choice state.
2. **Opening:** finish the Examination and progressive early-game reveal without
   inventing balance decisions that the design has not made.
3. **Endgame:** restore and measure a real rare God-Madness / Apotheosis path.
4. **Replay:** reduce rereading and mastered repetition; measure early
   divergence.
5. **Navigation:** make the tree and Chronicle answer strategic and causal
   questions quickly.
6. **Shareability:** build the factual House Afterimage.
7. **Commercial proof:** assemble screenshots/trailer/demo around the actual
   gameplay loop, not around genre labels.
8. **Localization readiness:** keep prose, UI, layouts, and visual assets
   structurally translatable; choose launch languages from audience evidence.
9. **Post-launch breadth:** keep the mod editor and other expansion surfaces
   behind core-game clarity and polish.

---

# 12. Relationship to the evidence document

`market research.md` remains the place for:

- competitor evidence;
- current platform facts;
- published commercial data;
- store/Steam guidance;
- localization evidence;
- citations and dated sources;
- changes in the external market.

This file should stay shorter. When evidence changes, update the market report
first and change this file only when the **decision implication** changes.

---

# Final principle

The best next feature is unlikely to be the one that makes the simulation
largest.

It is the one that makes a player say:

> **I chose that because of this person; the house paid for it; the book
> remembered it; and the next generation was different because I did.**
