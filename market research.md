# Eldritch Dynasty — Market Research and Commercial Design Implications

**Research updated:** 27 September 2026  
**Repository context:** current `main` plus every Markdown file in the repository root  
**Original research issue:** #184  
**Purpose:** identify the strongest evidence-backed ways to improve the probability that *Eldritch Dynasty* becomes a commercially successful premium game **without turning it into a different game**.

> Commercial success cannot be guaranteed by design work. This document identifies product risks, market evidence, and design priorities that can improve the odds. Financial break-even cannot be estimated from this repository because a complete development/marketing budget is not present.

---

## 1. What the root documents say the product actually is

The root documents are unusually consistent about the part of the game that should be protected.

*Eldritch Dynasty* is **not** primarily:

- a grand-strategy conquest game;
- a tactical combat game;
- a medieval life simulator;
- a conventional visual novel;
- a genetics sandbox with a story attached.

Its strongest product identity is the intersection of three things:

1. **A bloodline is the player character.** The player makes decisions across generations rather than inhabiting one protagonist.
2. **Marriage and inheritance are strategic verbs.** Blood, fertility, affinities, branch depth and succession turn people into long-horizon plans.
3. **The Chronicle is both memory and evidence.** The player decides what the family writes, and the final reckoning reads that record back.

The root prose documents add two critical quality requirements:

- a long campaign must keep accumulating **meaning**, not merely events;
- the player must be able to trace important consequences back to choices they remember.

That is also the commercial thesis. The game has a plausible niche because its combination is unusual. The main commercial risk is therefore **not insufficient feature breadth**. It is that the unique combination becomes hard to read, repetitive, or emotionally flat over a complete campaign.

---

# 2. Research method and evidence quality

This update uses four evidence classes.

## A. Direct store evidence

Steam store pages are used for:

- review count and score;
- current tags;
- list price where visible;
- supported languages;
- demo availability;
- feature positioning.

Review count is **not treated as unit sales**. It is useful as a scale/sentiment signal only.

## B. Published commercial evidence

Where a developer or publisher has published a sales figure, it is called out separately. The strongest new example in this update is *The King is Watching*, for which GameMaker's July 2026 interview with tinyBuild reports **more than 600,000 Steam copies sold**.

## C. Player-review/community evidence

Community reviews are used to identify repeated experience risks such as:

- choices feeling cosmetic or railroaded;
- resource systems feeling detached from outcomes;
- replay friction;
- information overload;
- confusing rules.

A single review is not treated as a market truth. It is used when it illustrates a risk that also appears in the design of comparable games or in Eldritch Dynasty's own diagnostics.

## D. Repository evidence

The current root documents, current issue tracker, and closed work are used to avoid recommending work that has already landed.

This matters because the project moved materially between the earlier market report and this update. In particular, the recommendations that became #210–#218 are now closed, as are #85, #133, #139, #174, #184 and #185.

---

# 3. Executive conclusion

There is still no close one-to-one competitor.

That is encouraging, but it creates a marketing burden: players will not arrive already knowing what “a five-century unreliable-record bloodline strategy game” feels like. The game must teach its identity through play quickly.

The most important conclusions from the expanded research are:

1. **Protect the narrow hook instead of broadening the genre.** Games with a clear, consistent interaction can outperform much broader designs. *The King is Watching* is the strongest current case: a simple royal-gaze idea remained visible throughout the design and the finished game went on to sell more than 600,000 Steam copies. Its publisher explicitly says the clarity and consistency of the hook mattered.

2. **“Choices Matter” creates a credibility obligation.** *Yes, Your Grace 2: Snowfall* currently sits around 76% positive on Steam despite a known predecessor and a public 100,000-wishlist milestone before launch. Prominent negative reviews complain that major decisions feel railroaded or ineffective. For Eldritch Dynasty, a choice may converge narratively, but it must leave a remembered difference in the house, record, relationship, cost, or player self-expression.

3. **Genealogy itself can be a compelling primary surface.** *The Roottrees are Dead* has more than 5,000 English Steam reviews at roughly 96% positive. It is not a strategy game, but it strongly validates that a family tree can be the object players willingly stare at for hours when relationships are readable and discoveries change what the tree means.

4. **More systems can reduce perceived agency if they do not change outcomes.** *The Pale Beyond* and *Snowfall* both show the danger of asking the player to optimise resources while the story appears to ignore that work. Eldritch Dynasty should prefer fewer systems whose consequences recur over more systems that decorate the same narrative path.

5. **Long-form appeal has to be proven beyond the first clever hour.** tinyBuild says *The King is Watching* changed structure after later-stage playtesting showed the original design did not stay enjoyable enough beyond its opening hours. The lesson is not “make Eldritch a roguelite.” The lesson is that a strong premise is only the beginning; the complete campaign needs an equally strong reason to continue and replay.

6. **Replay friction is now one of the largest remaining design risks.** The project has built House Ambitions, echoes, generation questions, richer Match decisions, advisers, recognisable Ages, recurring rivals and stronger rites. Once players understand those systems, the next commercial question becomes: does a second run make them reread too much known material before new context appears?

7. **The Chronicle is still the strongest defensible differentiator.** Other games have dynasties, bloodlines, difficult choices, event systems and occult tone. Very few make the player's historical record itself both a strategic instrument and ending evidence. The store page, demo, trailer and first session should all make that legible.

8. **The current NZD $28–35 target remains plausible for a polished premium release**, but price is not the problem to optimise first. The comparable set supports premium text/system games; review sentiment and clarity of value matter more than squeezing another few dollars out of launch price.

---

# 4. Comparable market

Review counts and scores below were checked on or immediately before 27 September 2026. They will drift.

| Game | Why it matters | Current Steam signal | Main lesson for Eldritch Dynasty |
|---|---|---:|---|
| **Crusader Kings III** | Dynasty fantasy at mass-market scale | ~50,000 English reviews, ~90% positive | Generational strategy is a proven fantasy; recurring named people turn systems into stories |
| **Wildermyth** | Procedural people + authored event structure | ~11,688 English reviews, Overwhelmingly Positive | Recurrence and transformation make procedural characters memorable |
| **Suzerain** | Text-heavy decisions, institutions, consequences | ~7,200 English reviews, ~93% positive | Dense reading can sell when choices create coherent political identity |
| **The Roottrees are Dead** | Family tree as central interaction | ~5,071 English reviews, ~96% positive | Genealogy can itself be a compelling screen if relationships are legible |
| **Yes, Your Grace** | Medieval decisions + resource pressure | ~5,260 English reviews, ~85% positive | Small cast + visible trade-offs can carry a compact management narrative |
| **Yes, Your Grace 2: Snowfall** | Broader sequel, more systems | ~1,490 reviews, ~76% positive | Feature expansion does not compensate for perceived loss of agency |
| **Long Live The Queen** | Repeated strategic runs through text/events | ~4,719 English reviews, ~94% positive | Failure becomes replay fuel when the next run supports a different plan |
| **Old World** | Dynasty + recurring events inside strategy | ~3,950 English reviews, ~84% positive | Characters are strongest when the strategic layer remembers relationships |
| **The King is Watching** | One clear kingdom-management hook + replay | ~3,300 English reviews, ~90% positive; **600k+ published Steam sales** | A legible core hook plus long-term replay can scale commercially |
| **The Life and Suffering of Sir Brante** | Text-heavy dark fantasy + consequential choice | ~2,770 English reviews, ~89% positive | Premium text-first presentation can work when consequences are severe and readable |
| **BOOK OF HOURS** | Dense occult text/system play | ~2,704 English reviews, ~89% positive | A patient audience exists for occult inference and text-heavy systems |
| **The Pale Beyond** | Narrative + resource management | ~1,859 reviews, ~90% positive | Management must visibly matter to outcomes or it risks feeling bolted on |
| **Reigns** | Extremely compressed recurring decisions | ~2,624 English reviews, ~84% positive | Fast repeated choice works when state feedback stays immediate |
| **Six Ages: Ride Like the Wind** | Storybook strategy / myth / clan management | ~460 reviews, ~81% positive | Biased advisers and culturally situated advice make opaque worlds learnable |
| **Great Houses of Calderia** | Direct family/dynasty strategy comparison | ~409 reviews, ~60% positive | “Family grand strategy” is not enough on its own; execution and focus matter |
| **Norland** | Family-centred simulation / systemic medieval drama | ~2,900 English reviews, ~82% positive | Emergent family drama is attractive but broader simulation raises complexity expectations |

### Important interpretation

This table is **not a ranking** and review count is not a sales estimate.

The useful pattern is the spread:

- narrow, readable games can earn exceptional sentiment;
- “dynasty” and “medieval management” are not automatically attractive enough to overcome confusion;
- text-heavy games are commercially viable when the interaction is coherent;
- the player must understand why their decisions matter.

---

# 5. New comparator: The Roottrees are Dead

This is the most useful addition to the previous report because it validates a surface Eldritch Dynasty depends on more heavily than almost any strategy comparison does.

*The Roottrees are Dead* asks the player to reconstruct a complicated family tree from documents and clues. It is not mechanically similar to Eldritch Dynasty, but its reception suggests several important things.

## What it validates

### A family tree can be the fun

The tree is not merely a database screen. It is the thing the player is trying to understand.

Eldritch Dynasty should hold itself to the same standard. If the tree is the primary UI, opening it should answer questions such as:

- Where did this blood come from?
- Who is carrying the line?
- Which branch is becoming dangerous?
- How are these two people related?
- What changed because of the last Match?
- Who matters to my current House Ambition?

A tree that only proves parentage is not enough.

### Graduated help protects discovery

Positive Roottrees reviews specifically praise its graduated hint system: a stuck player can ask for a broad nudge and progressively request more detail.

That is a strong model for Eldritch Dynasty's complexity:

- first show an in-world diagnosis;
- then show the rule the family could reasonably know;
- keep exact hidden future rolls hidden.

The closed #212 work on ladder blockers is already aligned with this. The remaining opportunity is broader contextual help for genealogy, the Chronicle, branches, and strategy.

### Complexity can become overload

Community feedback on the larger Roottrees mystery also notes that a much wider search space can become overwhelming even when the underlying deduction remains good.

That maps directly onto Eldritch Dynasty's 50–80 living relatives and centuries of Chronicle material.

**Commercial implication:** information architecture is gameplay. Search, filters, relationship paths, collapse/focus controls and “why this person matters” are not admin features in this game.

---

# 6. New comparator: The King is Watching

This is not a structural competitor. It is a commercial-design comparator.

GameMaker's July 2026 interview with tinyBuild reports:

- the game began as a Ludum Dare project;
- its browser version reached more than two million plays;
- the full Steam version sold more than 600,000 copies;
- the publisher was attracted by a very clear idea — buildings only work while the king looks at them;
- later playtesting showed the original structure had limited appeal beyond the first few hours;
- the project pivoted to a roguelite structure to strengthen progression and replay;
- tinyBuild says the finished game averages around twenty hours of play;
- the publisher also tailored localization/marketing after seeing strong organic interest in China.

## The Eldritch lesson

The wrong lesson would be:

> Add roguelite progression.

The right lesson is:

> **A commercially promising hook must survive contact with hour five.**

Eldritch Dynasty already has a stronger long-form thematic architecture than a game-jam prototype. It should still prove the same questions:

1. Is the hook obvious after one session?
2. Does the same hook keep producing different decisions later?
3. Does a second run create new context quickly enough?
4. Is there a reason to return tomorrow besides unfinished content?

The Library of Houses (#70) is an excellent thematic replay mechanism because it changes what the next world remembers rather than making the next house stronger. The remaining risk is how quickly the player feels that difference.

---

# 7. New caution: Yes, Your Grace 2 — more systems, weaker agency signal

*Yes, Your Grace 2: Snowfall* is useful because it is unusually close in presentation space:

- medieval;
- story rich;
- choices matter;
- management/resource systems;
- multiple endings;
- repeated petitions/decisions;
- a known predecessor.

It also publicly passed 100,000 Steam wishlists in April 2024.

As of this update it is around **76% positive** on Steam. Prominent negative reviews repeatedly describe a mismatch between being offered choices and feeling that important story events happen regardless. Even a positive review notes that choices can sometimes feel ineffective.

## Why this matters more than the raw score

A game can be structurally linear and still provide satisfying self-expression. The problem is not convergence by itself.

The problem is **promising strategic agency and then failing to acknowledge it**.

For Eldritch Dynasty, a choice can legitimately converge on the same historical Age or creditor arrival. It should still do at least one of these:

- alter a future option;
- alter the family, a person, branch, standing, land, record, or knowledge;
- alter what somebody later says;
- alter the Chronicle;
- alter the cost of a later decision;
- become evidence at the last night;
- reveal something about the player's chosen philosophy and receive a later callback.

If two options only swap prose and are never remembered, the game should question whether they need to be options.

---

# 8. New caution: The Pale Beyond — systems must change the story players think they are controlling

*The Pale Beyond* is currently about 90% positive on Steam, so it is not a failure case.

It is useful because the positive and negative reviews expose the exact tension Eldritch Dynasty needs to manage:

- positive players praise characters, atmosphere and weighty decisions;
- some negative players describe the resource system as work that does not sufficiently alter the linear story;
- some community discussion describes replay as losing value once the optimal resource approach is understood.

The lesson is not “avoid resources.” It is:

> **Every maintenance system needs a story job.**

Land, careers, books, Muster, standing, branches and rites should exist because they create different descendants, different options, different debts or different records — not because a strategy game is expected to have management screens.

The root concept brief already gives the correct test:

> If a feature does not touch blood, the Ledger, or the record, it is not in this game.

Keep applying it.

---

# 9. Choice design — the commercial obligation behind the “Choices Matter” tag

The project now has much better immediate outcomes and delayed echoes than it did when earlier root documents were written.

The next useful step is not simply “more consequence.” It is **consequence credibility**.

## A choice does not need a unique ending

Massive branching trees are not economically necessary.

A good choice may instead change:

- who the player is protecting;
- what the house believes;
- which cost they accepted;
- who remembers the insult;
- what a later character thinks is true;
- which family line remains available;
- which fact survives in the Chronicle.

That is compatible with a fixed 1542 reckoning.

## What must be avoided

- two buttons with effectively identical future state;
- choices where one is obviously dominant in almost every context;
- “hard choices” that only change a resource by a tiny amount and are never recalled;
- a maintenance action presented as a dramatic decision;
- a story scene that explicitly offers refusal and then proceeds identically without acknowledging the refusal.

## Recommended audit

Add a report over authored decisions that classifies each option by what it can change:

- persistent simulation state;
- person/relationship state;
- Chronicle/claim state;
- future eligibility;
- immediate outcome only;
- self-expression only.

“Self-expression only” is valid when the game later remembers or reflects it. “Immediate outcome only” should be deliberately rare.

---

# 10. The family tree must become a decision surface, not a genealogy archive

The project has already fixed several major tree problems:

- marriages are represented;
- ancestry is recoverable;
- a small situational cast is foregrounded;
- Match choices are richer;
- the full Chronicle is readable/exportable.

The commercial risk now moves up one level.

At Long-Line scale, a player must be able to answer strategic questions without manually scanning dozens of people.

## Recommended tree capabilities

- search by name;
- collapse/expand halls;
- filter by living/dead where appropriate;
- highlight direct lineage to current Head;
- highlight active House Ambition relevance;
- show the relationship path between any two selected people;
- filter to people relevant to a rite, affinity, branch grievance, or succession decision without exposing hidden genomes;
- jump from a person to Chronicle mentions;
- jump from a Chronicle entry back to the people/branch involved;
- preserve the no-faces / sigil identity.

This is not “make a genealogy app.” It is making the primary strategic board playable at its designed population.

---

# 11. Replay: the next major commercial design problem

A first run can tolerate discovery cost. A second run cannot demand the same discovery cost again.

The repository already has unusually strong replay foundations:

- Short and Long campaign profiles;
- different House Ambitions;
- different family philosophies;
- a persistent Library of Houses;
- varying Ages/events/relationships;
- multiple endings;
- a large state-dependent content pool.

The missing commercial layer is **replay compression**.

## Recommended replay rule

> Compress what the player already knows; never compress the decision that became different.

Examples:

- permit fast reveal / skip of prose the player has already seen verbatim;
- never auto-skip a changed variant, new outcome, rare/mythic scene, decision, Record block, rite, interlude or callback;
- mark previously seen event text unobtrusively;
- provide a fast restart path from an ending to a new founding;
- let experienced players reduce explanatory scaffolding;
- keep the Chronicle complete even when presentation was skipped.

The purpose is not to make the game faster for its own sake. It is to move the second-run player to **new context** faster.

---

# 12. Second-run freshness should be measured from the start, not at the ending

A replay system that diverges only in year 1400 will not make the opening feel replayable.

The Library of Houses is thematically excellent, but its commercial value depends on whether the player notices the previous world soon enough.

## Recommended measurement

For a completed run followed by another run:

- compare the first 3 generations;
- compare the first 30 player prompts;
- report repeated event IDs and repeated verb shapes;
- report when the first inherited Library/tale/relationship consequence becomes visible;
- report when the first materially different strategic plan becomes available.

Do not set an arbitrary pass/fail threshold before measuring the current game.

The desired qualitative shape is simple:

> By the time a returning player has finished the opening chapter, they should have encountered at least one reason this house cannot be played exactly like the last one.

---

# 13. Strategic waiting must be treated as a distinct failure mode

The old endgame calibration work fixed important reachability problems, but “reachable” is not the same as “playable.”

A long-form strategy game can become boring when the player:

- knows what they need;
- has only one blocker left;
- has no deliberate action that can improve it;
- continues processing routine years waiting for the simulation to cooperate.

This is particularly dangerous in a game whose fiction makes patience feel thematically appropriate. The player can mistake a dead decision space for “slow burn.”

## Recommended general stall detector

Measure, for named long-horizon goals:

- years with the same dominant blocker;
- years since a player-actionable path existed;
- longest interaction-shape streak;
- longest spine gap;
- generations with no change in the active House Ambition's state;
- repeated attempts at an action that cannot yet succeed.

The answer should **not** be a generic progress bar or a universal difficulty ramp.

If a stall is found, fix the existing system that owns the blocker.

---

# 14. The Chronicle should close the causal loop

The Chronicle is already readable and exportable.

Its next high-value usability improvement is to make remembered causality inspectable.

When a delayed consequence says, for example, that House Marrow remembers a refusal from two generations ago, the player should be able to move naturally from:

**bill → old page → original act**

without exposing hidden formulas.

This can be a small interface affordance:

- “from the winter of 1218”;
- jump to related Chronicle entry;
- show the named person/house involved;
- no numeric Bearing or probability explanation.

This turns the Chronicle from archive into strategic memory and strengthens the game's single most distinctive system.

---

# 15. Post-run shareability: add the House Afterimage

The full Chronicle export is valuable, but a complete run is too large to be the default object players share.

A compact generated post-run page can create a better social artefact.

## It should contain facts, not grades

Possible items:

- the house name and sigil;
- the ending;
- three people most central to the house's ascent;
- one person sacrificed;
- the oldest surviving embellishment;
- the oldest blank;
- the largest holding and worst loss;
- the generation where the line came closest to ending;
- the longest-running external relationship;
- one rejected Match that later mattered;
- one sentence drawn from the Chronicle.

No score.
No letter grade.
No “good ending.”
No moral verdict.

The page answers:

> **What was this house?**

This is more useful for screenshots, Discord, Steam discussions and word of mouth than a generic victory screen.

---

# 16. Demo strategy — update the previous recommendation

The earlier market report was too confident about a specific demo duration.

Current Next Fest analysis is a reason to soften that.

How To Market A Game's June 2026 survey reports demo-player-to-wishlist conversion around:

- 30th percentile: 15.9%;
- median: 19.3%;
- 70th percentile: 23.2%.

The same analysis explicitly warns developers **not to over-interpret the conversion percentage**. Some games with lower conversion still generated far more absolute wishlists because they reached many more players.

## Revised recommendation

Do not optimise the demo to a fixed minute count.

Optimise it to prove one complete Eldritch Dynasty shape:

1. the debt;
2. a Match;
3. a person the player can care about;
4. a meaningful choice;
5. Record / Omit / Embellish;
6. an echo proving the game remembered;
7. the 1542 frame or equivalent promise;
8. a forward-looking problem that makes continuation desirable.

Then measure actual completion time and drop-off.

The demo should end because the **shape is complete**, not because a clock says 25, 45 or 90 minutes.

## Save transfer

For Eldritch Dynasty, demo save transfer still makes thematic sense because the product is a continuous family history. If the demo campaign is intentionally compressed or non-canonical, do not force transfer merely because other games do it.

---

# 17. Steam positioning

## Do not lead with “grand strategy”

That label creates expectations for:

- maps;
- conquest;
- diplomacy breadth;
- military systems;
- large economic models;
- faction-level political simulation.

The game intentionally does not provide several of those.

## Better category language

Use combinations such as:

- **generational strategy**
- **narrative simulation**
- **choices-matter dynasty game**
- **dark-fantasy bloodline strategy**
- **text-based strategy**
- **story-rich simulation**
- **multiple endings**
- **replay value**

Candidate store line:

> **Breed a bloodline for five centuries, decide what the family writes about what it did, and face the creditor who kept the other copy.**

That line expresses the three systems the concept says everything should touch: blood, Ledger/debt, record.

---

# 18. Trailer priorities

A trailer for this game should not spend most of its time on prose cards.

Show the interaction that proves the prose is a game.

Recommended sequence:

1. family tree grows across generations;
2. three Match candidates imply different futures;
3. player chooses one;
4. child/branch consequence appears;
5. Record / Omit / Embellish changes the page;
6. old wording returns later as a consequence;
7. a named relative is spent in a rite;
8. the last-night frame reads the Chronicle;
9. several visually different house outcomes/afterimages.

The trailer should answer:

> “What do I *do*?”

before it tries to answer:

> “How beautifully is it written?”

---

## 18A. Visual merchandising: the store page has to prove this is a game

This is a more important production constraint than the previous version of this report made it.

Steam's current trailer guidance says the first trailer is often one of the first things a potential customer sees, that a Discovery Queue impression may have **less than ten seconds**, and that the trailer should still communicate without audio. Valve explicitly recommends making the **first trailer primarily gameplay**. The first two trailers appear before screenshots on the store page.

That pushes Eldritch Dynasty toward a very specific visual requirement:

> **the player must be able to recognise state changing before they have read a paragraph.**

The current product already has the right raw material. It needs to be staged as visual proof.

### The six strongest screenshot / trailer surfaces

1. **The family tree as change over time.**
   Show marriages, branches, deaths, sacrifices and one highlighted line of continuity. The tree should look different after a decision, not merely contain more names.

2. **The Match as three futures.**
   A screenshot should make it obvious that the player is comparing people and consequences, not choosing between three differently worded buttons.

3. **Record / Omit / Embellish.**
   Show the act and the book together: what happened, what the house chose to say, and the visual treatment of the resulting page.

4. **A delayed callback.**
   A strong marketing image can pair an old Chronicle page with the later consequence that cites it. This is the product's most distinctive proof of “choices matter”.

5. **A deliberate rite.**
   Rites should have a before / decision / after visual rhythm that looks unlike an ordinary event. The important image is not spectacle by itself; it is a named person being spent and the house state changing because of it.

6. **The House Afterimage.**
   A compact end-of-run composition — line, people, ending, one lie, one loss, one achievement — gives the product a visual object that can serve the ending, screenshots, social sharing and press material at once.

### Visual language should carry information

The strongest visual additions are not decorative illustrations between paragraphs. They answer one of five questions:

- **who matters?**
- **what changed?**
- **what did this cost?**
- **what is the house trying to do?**
- **what is remembered?**

This suggests a restrained visual system:

- **blood / lineage:** branching lines, seals, portraits or silhouettes, inherited marks;
- **debt / Ledger:** ruled pages, clauses, marginal countersigns, an object accumulating completion without becoming a generic progress bar;
- **record:** ink, blanks, overwritten lines, marginal annotations, conflicting copies;
- **Ages:** typography, page material, illumination, wear and framing that make a new Age legible before a label explains it;
- **rites:** deliberate changes in framing, spacing and motion so the player knows the interaction has exceptional weight.

The concept does not need a conventional strategic world map to become more visual. The **tree, Chronicle, plat/holdings, Match comparison and ending artefact** are more distinctive visual surfaces.

### Steam asset implications

Steam currently requires store screenshots at **1920×1080 or larger in 16:9**, and its required store capsules are artwork plus the game logo rather than miniature feature lists. Base capsules cannot carry review scores, awards, discount copy or similar marketing text.

That means the capsule art has to communicate the tone of **a dynasty under a centuries-long debt** without explanatory copy. Feature explanation belongs in gameplay screenshots, trailers and the written About section.

Steam's About section can embed screenshots and short animations. Valve recommends roughly **1170 px wide** assets for high-DPI presentation and notes that text embedded inside images creates extra localization work. For this game, that argues for:

- textless or minimally textual feature GIFs where possible;
- real in-game UI text localized by the game rather than baked into marketing art;
- one visual motif that survives every capsule crop;
- screenshots captured from actual gameplay states rather than bespoke mock-ups that cannot be reproduced in the product.

### A practical visual proof set

Before a public marketing push, assemble one clean 16:9 capture for each:

| Proof | The player should understand without a caption |
|---|---|
| Bloodline | this family has changed over generations |
| Match | these candidates lead to different futures |
| Record | the player controls what history claims |
| Callback | the game remembers an old act |
| Ambition | the house is trying to reach something over decades |
| Rite | a named person is being deliberately spent |
| Ending | this completed house has a specific story |

If those seven images all look like “a paragraph in a parchment panel”, the visual design still has a commercial problem even if the underlying systems are excellent.

Sources:
- Steamworks, **Trailers**: https://partner.steamgames.com/doc/store/trailer
- Steamworks, **Graphical Assets - Overview**: https://partner.steamgames.com/doc/store/assets
- Steamworks, **Graphical Asset Rules**: https://partner.steamgames.com/doc/store/assets/rules
- Steamworks, **Store Page Written Description**: https://partner.steamgames.com/doc/store/page/description
- Steamworks, **Store Page Extra Asset Management**: https://partner.steamgames.com/doc/store/page/assets

---

## 18B. Near-term Steam timing: October 2026 Next Fest is now a readiness decision

Steam's official schedule for the October 2026 Next Fest is:

- **28 September 2026:** deadline for required items to be submitted for review;
- **8 October:** press preview begins;
- **19 October:** Next Fest begins;
- **26 October:** Next Fest ends and the wrap-up launches.

As of **3 October 2026**, the review-submission deadline has already passed. A project that did not make that submission should not distort the demo or marketing build to chase the October event. Steam says a title can participate in only **one** Next Fest, and identifies **February 2027** as the next planned edition.

That makes the right question:

> **Is the current demo strong enough that this is the one Next Fest we want to spend?**

If the project is already registered and review-ready for October, the priority is not adding another feature. It is making the demo prove the loop quickly, capturing representative gameplay, and making the store page communicate without audio or long reading.

If it is not already through the September review milestone, February 2027 is the cleaner planning target. Use the extra time to make sure the demo reaches a complete Eldritch shape — debt, person, Match, choice, Record, callback, frame, forward problem — instead of merely being longer.

Source:
- Steamworks, **Steam Next Fest: October 2026**: https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/2026october

---

# 19. Price

The concept brief's **NZD $28–35** target remains defensible as a working band.

Comparable premium prices range widely:

- compact text/choice games can succeed below USD $20;
- narrative-management games commonly sit around the USD $20 area;
- larger systemic strategy games charge substantially more.

The game should not choose price by averaging competitors.

Price should follow:

- demonstrated campaign quality;
- actual measured session length;
- replay value;
- presentation polish;
- localization scope;
- content breadth at release.

Do not use review count to infer competitor revenue unless a published sales figure exists.

---

# 20. International market and localization

This is more important than the previous report made it.

Many successful or relevant strategy/narrative comparables support Simplified Chinese, including:

- Crusader Kings III;
- Wildermyth;
- Old World;
- The Life and Suffering of Sir Brante;
- Yes, Your Grace;
- Yes, Your Grace 2;
- Reigns;
- The King is Watching.

tinyBuild's 2026 discussion of *The King is Watching* says the publisher observed strong organic interest from China and then tailored localization, content and local promotion accordingly.

## Recommendation

Do **not** assume Eldritch Dynasty must launch in a particular language solely from this comparison.

Instead:

1. make the UI and content pipeline localization-ready now;
2. avoid baking English text into images;
3. maintain a terminology/glossary layer for blood, rites, ranks and Chronicle terms;
4. test layout expansion;
5. preserve speaker/register metadata so literary voice survives translation;
6. use wishlist/demo geography to decide launch languages.

For this game, localization is not a late string-table job. The changing chronicler voices and deliberately precise wording make it a product-design constraint.

---

# 21. Accessibility and reading comfort are commercial design

This is a text-heavy game. Reading comfort determines how much of the product a player can enjoy.

The repository has already done substantial accessibility work, including ARIA and platform text scaling fixes. The remaining commercial standard should include:

- readable line length;
- user-controlled font scale;
- high-contrast text option if the vellum treatment reduces clarity;
- reduced-motion/text-animation controls;
- instant text reveal;
- keyboard navigation for every recurring decision;
- clear focus states;
- consistent “seen” treatment for replay;
- no essential information available only on hover.

These are not cosmetic polish. In a game where most meaning arrives through text, they are equivalent to input responsiveness in an action game.

---

# 22. What not to add

The expanded market research makes the existing “do not add” list stronger.

## Do not add tactical combat

War already matters through Muster, family cost and consequences. A combat layer would consume production while moving the product toward much better-funded competitors.

## Do not add a conventional world map as the strategic centre

The family tree, Chronicle and plat are more distinctive and more coherent with the thesis.

## Do not add relationship bars for everyone

Recurring named relationships and remembered grievances are more legible and less generic.

## Do not add a generic roguelite upgrade tree

The success of *The King is Watching* does not imply that Eldritch Dynasty should copy its progression structure. The Library of Houses is a better replay mechanism because it changes history, not starting power.

## Do not add currencies because strategy games “need depth”

Every additional meter competes for attention with blood, record and debt.

## Do not hide every rule in the name of mystery

Mystery is not the same as incomprehension. The player must be able to form an actionable model.

## Do not make “more event templates” the default answer to repetition

The current game already has a large content pool and low same-Age repeat rates. Improve context, callbacks and interaction shape first.

---

# 23. Current project status changes the priority list

Several recommendations in the previous market report are no longer future recommendations.

They have already been tracked and closed:

- **#210** — visible multi-generation House Ambition;
- **#211** — delayed consequence echoes;
- **#212** — legible next Ascension obstacle;
- **#213** — generation question/answer arc;
- **#214** — Match as different futures;
- **#215** — biased living advisers;
- **#216** — mechanically recognisable Ages;
- **#217** — recurring rival/institution threads;
- **#218** — deliberate rite presentation.

Major older commercial/design risks also closed:

- **#85** — long-horizon accumulation;
- **#133** — 500-year Long Line;
- **#139** — thin tail content;
- **#174** — engagement review;
- **#177** — Short Line signing term mismatch;
- **#185** — ending/gate correctness;
- **#201** — early ladder/empty-late-game issue.

Those four historical follow-ons are also now closed: **#219** (delegation), **#205** (tools/measurement), **#75** (the post-launch mod-editor issue), and **#36** (Bearing).

Current open product work most relevant to this report is instead:

- **#334** — remove or justify write-only and prose-only choice memory;
- **#341** — reduce recurring-event and money-axis replay sameness;
- **#274** — finish the fresh Short-vs-Long differentiation evidence;
- **#343** — the Examination / founder-shaping opening;
- **#356** — owner-playtest UI and progressive-reveal follow-ups;
- **#378** — restore a real but rare God-Madness tail.

**#277** remains the authoritative commercial-pass tracker and should be preferred over duplicating its execution order here.

Therefore the next market-driven work should focus on the gaps that remain **after** the closed systems above, rather than restating them.

---

# 24. Highest-value remaining commercial design priorities

## P0 — consequence credibility

Audit choices for whether the game can remember what the player selected.

The “Choices Matter” promise is fragile. A choice may converge structurally, but the game should acknowledge its meaning.

## P0 — second-run speed

Build replay compression and measure how quickly a returning player reaches new context.

A twenty-generation game cannot expect the player to reread every known scene on every run.

## P0 — family information navigation

Make the full-size tree answer strategic questions quickly.

Genealogy is a marketable surface only if it remains legible at the population the simulation actually produces.

## P1 — causal Chronicle navigation

Let a delayed consequence lead back to the old act that caused it.

This directly strengthens the game's unique moat.

## P1 — strategic-stall detector

Measure waiting with no actionable move across all long-horizon goals.

## P1 — House Afterimage

Turn one completed run into a compact, attractive, factual story object players can share.

## P1 — contextual help without omniscience

Extend the “next obstacle” philosophy to other complex surfaces through in-world, graduated help.

## P2 — localization readiness

Make prose, UI and layout structurally translatable now; decide actual launch languages from audience evidence later.

## P2 — post-launch mod support, only if deliberately reopened

The old mod-editor issue **#75 is closed**. If mod support is deliberately reopened later, keep it post-launch: it can extend the content tail, but it should not displace core-game polish now.

---

# 25. What should be measured before launch

Automated simulation remains excellent for reachability and balance, but commercial quality also needs player-behaviour evidence.

Do not make external play sessions a blocking engineering acceptance criterion unless the project owner chooses to. They are still a valuable research instrument.

Useful measures:

### First-session

- time to first meaningful Match;
- time to first Record/Omit/Embellish decision;
- time to first consequence echo;
- prompts before the active House Ambition affects a choice;
- first point at which the player is expected to understand the next strategic move.

### Pacing

- spine gap;
- same interaction-shape streak;
- strategic-stall duration;
- repeated identical policy choices;
- years with one blocker and no actionable route.

### Replay

- exact prose repeated in first 30 prompts;
- time to first new Library-of-Houses callback;
- first strategic divergence from prior run;
- amount of seen text skipped;
- decisions that must remain manual.

### Agency

- option-to-option persistent-state divergence;
- choices with only immediate prose difference;
- later callback rate;
- percentage of delayed consequences with a recoverable source.

### Chronicle

- voluntary opens;
- search/filter use;
- jumps from consequence back to source;
- export/share actions where platform analytics/privacy policy permits.

### Demo / Steam

Use Steamworks and other aggregate platform data where possible rather than inventing bespoke tracking:

- demo players;
- demo median playtime;
- demo completion proxy;
- wishlist additions;
- Steam Next Fest reach;
- player-to-wishlist conversion as **context**, not a standalone pass/fail score.

---

# 26. Product decision rule

When considering a new gameplay feature, ask in order:

1. Does this make **blood**, **the debt/Ledger**, or **the record** more interesting?
2. Does it create a decision the player can recognise as different from an existing decision?
3. Can the consequence be remembered later?
4. Does it help one of the five desired player feelings already named in the root documents?
   - I have a plan.
   - This person matters.
   - That happened because of me.
   - This generation is different.
   - I want to see how this ends.
5. Will it make a second run meaningfully different?
6. Can the player understand it without an external wiki?
7. Is it worth the additional cognitive load?

If the answer to the first three is no, it is unlikely to improve the commercial product.

---

# 27. Bottom line

The market evidence does **not** suggest Eldritch Dynasty needs to become broader.

It suggests the opposite.

The games with the strongest lessons here succeed because players can describe the thing they do:

- *Crusader Kings III*: create dynastic stories from people and succession.
- *Wildermyth*: watch procedural heroes become specific legends.
- *The Roottrees are Dead*: reconstruct a family through a tree.
- *Suzerain*: make political decisions and live with them.
- *The King is Watching*: only what the king watches works.
- *Long Live The Queen*: prepare differently, fail differently, try again.

The sentence Eldritch Dynasty should earn is:

> **I bred this family, lied about what it did, and centuries later the lie came back when the debt was read.**

That is commercially clearer and harder to copy than “medieval dynasty strategy.”

The next work should make that sentence **faster to understand, harder to doubt, easier to replay, and easier to share**.

---

# Sources checked in this update

Comparable/store/community sources were checked 25–27 September 2026; the Steamworks platform/merchandising sources added in §18A–B were checked 3 October 2026.

## Direct Steam/store evidence

- Crusader Kings III — https://store.steampowered.com/app/1158310/Crusader_Kings_III/
- Wildermyth — https://store.steampowered.com/app/763890/Wildermyth/
- Suzerain — https://store.steampowered.com/app/1207650/Suzerain/
- The Roottrees are Dead — https://store.steampowered.com/app/2754380/The_Roottrees_are_Dead/
- Yes, Your Grace — https://store.steampowered.com/app/1115690/Yes_Your_Grace/
- Yes, Your Grace 2: Snowfall — https://store.steampowered.com/app/1373090/Yes_Your_Grace_2_Snowfall/
- Long Live The Queen — https://store.steampowered.com/app/251990/Long_Live_The_Queen/
- Old World — https://store.steampowered.com/app/597180/Old_World/
- The King is Watching — https://store.steampowered.com/app/2753900/The_King_is_Watching/
- The Life and Suffering of Sir Brante — https://store.steampowered.com/app/1272160/The_Life_and_Suffering_of_Sir_Brante/
- BOOK OF HOURS — https://store.steampowered.com/app/1028310/BOOK_OF_HOURS/
- The Pale Beyond — https://store.steampowered.com/app/1266030/The_Pale_Beyond/
- Reigns — https://store.steampowered.com/app/474750/Reigns/
- Six Ages: Ride Like the Wind — https://store.steampowered.com/app/881420/Six_Ages_Ride_Like_the_Wind/
- Great Houses of Calderia — https://store.steampowered.com/app/1812910/Great_Houses_of_Calderia/
- Norland — https://store.steampowered.com/app/1857090/Norland/

## Published commercial / market evidence

- GameMaker, **“The King Is Watching From Game Jam to 600k Sales”**, 9 July 2026  
  https://gamemaker.io/en/blog/the-king-is-watching-tinybuild
- Yes, Your Grace / Brave At Night Steam announcement, **100,000 Snowfall wishlists**, 4 April 2024  
  https://store.steampowered.com/news/posts/?enddate=1712250352&feed=steam_community_announcements
- How To Market A Game, **June 2026 Steam Next Fest demo/wishlist analysis**, 30 June 2026  
  https://howtomarketagame.com/2026/06/30/nobody-plays-demos-and-that-is-ok/
- How To Market A Game, **June 2026 Next Fest tracker / benchmark page**  
  https://howtomarketagame.com/snf/

## Community/review evidence used directionally

- Yes, Your Grace 2: Snowfall Steam reviews  
  https://steamcommunity.com/app/1373090/reviews/
- The Pale Beyond Steam reviews/discussions  
  https://steamcommunity.com/app/1266030/reviews/
- The Roottrees are Dead Steam reviews/discussions  
  https://steamcommunity.com/app/2754380/reviews/
- The King is Watching Steam reviews/discussions  
  https://steamcommunity.com/app/2753900/reviews/

## Steam platform / merchandising guidance

- Steamworks, **Trailers** — gameplay-first trailer guidance and store ordering  
  https://partner.steamgames.com/doc/store/trailer
- Steamworks, **Graphical Assets - Overview** — current capsule and screenshot dimensions  
  https://partner.steamgames.com/doc/store/assets
- Steamworks, **Graphical Asset Rules** — capsule-content restrictions  
  https://partner.steamgames.com/doc/store/assets/rules
- Steamworks, **Store Page Written Description** — embedded visual and localization guidance  
  https://partner.steamgames.com/doc/store/page/description
- Steamworks, **Store Page Extra Asset Management** — high-DPI image/animation guidance  
  https://partner.steamgames.com/doc/store/page/assets
- Steamworks, **Steam Next Fest: October 2026** — October dates, submission milestone, one-Fest eligibility and February 2027 next edition  
  https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/2026october

## Narrative/game-design background

- Game Developer, **“From let's play to let's pay: on designing financially successful narrative games”**  
  https://www.gamedeveloper.com/business/from-let-s-play-to-let-s-pay-on-designing-financially-successful-narrative-games
- Game Developer, **“Deep Dive: Curating meaningful multiplayer narrative choices in Doomsday Paradise”**  
  https://www.gamedeveloper.com/design/deep-dive-multiplayer-narrative-in-doomsday-paradise
- Game Developer, **“In narrative games, self-expression doesn't mean 'empowerment'”**  
  https://www.gamedeveloper.com/design/in-narrative-games-self-expression-doesn-t-mean-empowerment-
- GDC Vault, **“Level Design Workshop: The Illusion of Choice”**  
  https://gdcvault.com/play/1023552/Level-Design-Workshop-The-Illusion

---

## Evidence caution

Store scores and counts are snapshots and will change. Published sales figures are only treated as sales evidence where the developer/publisher has stated them. Third-party owner/revenue estimators were reviewed during research but intentionally **not** used as primary commercial evidence in this revision.
