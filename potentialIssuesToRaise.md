# Potential Issues To Raise — Commercial Gameplay and Game-Design Work

**Created:** 27 September 2026  
**Source material:** every Markdown file in the repository root, current issue tracker, and the refreshed `market research.md`.

## Purpose

This is a **candidate backlog**, not a claim that any design change can guarantee commercial success.

The goal is narrower and more useful:

> Identify the remaining gameplay and game-design work most likely to improve first-session clarity, agency, emotional attachment, long-campaign pacing, replayability, word of mouth, and review sentiment **without broadening Eldritch Dynasty into a different genre**.

## Do not raise duplicates for work already tracked

Before creating new issues, finish or account for current open work:

- **#219** — delegate mastered low-stakes repetition while interrupting for meaningful choices.
- **#205** — improve tools and measurement capability; several measurement candidates below may belong under this issue rather than becoming separate tooling epics.
- **#75** — post-launch mod editor; valuable for the content tail, but deliberately not a pre-launch priority.
- **#36** — Bearing epic remains open for its remaining evidence/closure work.

Do **not** recreate the closed market/design issues that already delivered the previous recommendation set:

- #210 House Ambitions
- #211 consequence echoes
- #212 Ascension blocker legibility
- #213 generation question/answer
- #214 Match as three futures
- #215 biased advisers
- #216 mechanically recognisable Ages
- #217 recurring rival/institution relationships
- #218 rite presentation

The numbered items below are intended to be **new issue candidates or explicitly new scopes**.

---

## 1. Audit authored choices for consequence credibility and remove “false choices”

**Priority: P0**

### Why this matters commercially

The `Choices Matter` audience is unusually sensitive to being offered decisions that the game later ignores.

A current caution is *Yes, Your Grace 2: Snowfall*: despite an established predecessor and broad feature set, it sits around 76% positive on Steam, and prominent reviews repeatedly complain that major choices feel railroaded or cosmetic.

Eldritch Dynasty does not need a gigantic branching story. It does need the player to believe:

> “The game heard what I chose.”

### Scope

Create a choice audit that classifies every authored choice option by what it can change:

- persistent simulation state;
- a person or branch;
- a relationship/grudge;
- Chronicle/claim/discrepancy state;
- future eligibility;
- resource/material state;
- later authored callback;
- immediate prose only;
- self-expression only.

Then review the weak tail.

A choice that is “self-expression only” can remain if the game later reflects that identity in prose, Chronicle, adviser response, or ending evidence.

A choice that changes only immediate wording and is never remembered should usually be:

- given a remembered consequence;
- collapsed into a single action;
- or reclassified as flavour rather than a strategic decision.

### Acceptance

- A deterministic report lists every authored decision and the categories each option can affect.
- Every non-flavour decision has at least one persistent effect **or** one later remembered/self-expression callback.
- Any option pair that converges to identical state and identical remembered narrative is explicitly reviewed.
- The report fails only on declared rules; do not invent an arbitrary numeric floor before the baseline is known.
- No new branching-story framework is introduced.

---

## 2. Add replay compression for prose the player has already seen

**Priority: P0**

### Why this matters commercially

The first run can spend the player's attention teaching the world.

A second twenty-generation run cannot demand the same reading cost before showing what changed.

The existing game has strong replay foundations — multiple philosophies, a Library of Houses, multiple endings, variable bloodlines and Ages — but those benefits are weakened if the player rereads identical setup prose for too long.

### Scope

Track text/event content the local player has already seen and provide an opt-in experienced-player presentation mode.

It may:

- instantly reveal previously seen prose;
- provide “skip seen” for verbatim repeated non-decision passages;
- reduce repeated explanatory scaffolding;
- mark previously seen scenes unobtrusively;
- provide a fast path from an ending to a new founding.

It must **never** auto-skip:

- a decision;
- a Record/Omit/Embellish block;
- changed prose;
- a changed outcome;
- a rare/mythic event;
- a rite;
- a frame interlude;
- a consequence echo;
- a callback that differs because of the current house.

This is presentation compression, not automation. #219 owns delegation of routine decisions.

### Acceptance

- A player can enable “skip/fast-reveal seen text” without enabling any automated decisions.
- Verbatim repeated passive prose can be skipped or instantly revealed.
- Changed variants are always treated as unseen.
- Decisions and consequence-bearing beats always surface.
- The Chronicle remains complete regardless of what presentation was skipped.
- Replay state is local/player preference state and does not alter deterministic simulation outcomes.

---

## 3. Make the family tree fully navigable at real Long-Line population

**Priority: P0**

### Why this matters commercially

*The Roottrees are Dead* is strong evidence that genealogy itself can be compelling: it has more than 5,000 English Steam reviews at roughly 96% positive.

But its community discussion also shows the inverse risk: once relationship complexity grows, the player needs excellent information tools.

Eldritch Dynasty deliberately reaches large living families. The tree is the primary board. It therefore needs to answer strategic questions rather than merely display genealogy.

### Scope

Add navigation that does **not** reveal hidden genome information:

- search by name;
- collapse/expand halls and cadet branches;
- direct-line focus from founder to current Head;
- “show relationship” path between any two known people;
- filter by role/status already known to the house;
- highlight people relevant to the current House Ambition;
- highlight people relevant to succession, a visible branch grievance, or a known rite requirement;
- jump from person → Chronicle mentions;
- jump from Chronicle mention → person/branch;
- preserve the sigil/no-faces presentation.

### Acceptance

- A player can locate any named living person without manually scanning every hall.
- A player can see the known relationship path between two selected people.
- A player can isolate the current Head's direct line.
- The tree can foreground current-plan relevance without exposing hidden genetics or secret state the house does not know.
- Tree operations remain usable at the largest population seen in current Long-Line harness batches.

---

## 4. Add causal backlinks from delayed consequences into the Chronicle

**Priority: P1**

### Why this matters commercially

The refreshed market research keeps returning to the same desired player sentence:

> “That happened because of me.”

#211 already makes major delayed consequences echo before they bill the house.

The next step is to make the causal memory inspectable.

### Scope

When a consequence is caused by a known prior act, let the player follow:

**current consequence → old year/page → original act**

Examples:

- a refused hand;
- a cadet grievance;
- an old Match;
- an embellishment/discrepancy;
- an inherited grudge;
- a neglected promise;
- a prior Muster commitment.

The UI should use dates, names and Chronicle links.

It must **not** expose hidden probability formulas, Bearing scores, secret genomes, or omniscient explanations.

### Acceptance

- Every delayed consequence type that already carries a recoverable source can link to that source from the client.
- The linked page uses the same Chronicle artefact the player originally created.
- No hidden numeric mechanic is surfaced by the backlink.
- Save/resume preserves the linkage deterministically.
- A source that was deliberately omitted remains an omission; the UI must not reconstruct text the house chose not to record.

---

## 5. Create a shareable post-run “House Afterimage”

**Priority: P1**

### Why this matters commercially

The complete Chronicle is the strongest long-form artefact, but it is too large to be the default thing a player shares after finishing a run.

A compact post-run artefact can support:

- Steam screenshots;
- Discord sharing;
- social posts;
- discussion of different houses;
- “look what happened in my run” word of mouth.

It should deepen the game's theme rather than become a score screen.

### Scope

Generate one attractive factual page at the end of a run.

Candidate facts:

- house name and sigil;
- campaign profile;
- ending;
- three people central to the line;
- one sacrifice;
- one old lie that survived;
- one dated blank;
- closest brush with extinction;
- most consequential rival relationship;
- highest rung reached;
- a Match or refusal that later mattered;
- one selected Chronicle sentence.

No grade.
No star rating.
No “best ending.”
No morality score.
No global leaderboard.

### Acceptance

- Every completed run can produce one deterministic Afterimage.
- It is generated only from facts/claims already knowable to the finished run.
- It contains no overall score or evaluative grade.
- It can be exported using the same image/share infrastructure already built for Chronicle export where possible.
- Two meaningfully different runs produce visibly and textually different Afterimages.
- The page remains readable without opening the full Chronicle.

---

## 6. Measure and protect early second-run divergence

**Priority: P1**

### Why this matters commercially

The Library of Houses (#70) is one of the most thematically appropriate replay systems in the project.

Its commercial value is limited if the returning player does not notice a changed world until late in the campaign.

Replay freshness should therefore be measured **near the beginning**.

### Scope

Add a paired-run report that compares a first completed run and the next run seeded with the resulting library.

For the second run report:

- first three generations;
- first 30 prompts;
- repeated authored event IDs;
- repeated interaction shapes;
- first Library-derived visible callback;
- first materially different strategic opportunity;
- first external relationship that differs because of inherited history.

This can live under #205 if that is the cleaner ownership.

### Acceptance

- A tool can print an early-run replay-difference report from a fixed first-run library corpus.
- Empty-library behaviour remains identical to the existing deterministic baseline.
- The report distinguishes textual variation from strategic-state variation.
- No arbitrary pass/fail threshold is set until the baseline is measured.
- If the baseline shows the Library's effects appear too late, fix seeding/presentation rather than adding permanent bonuses.

---

## 7. Add a general strategic-stall detector

**Priority: P1**

### Why this matters commercially

A reachable goal can still be boring if the player knows what they need but cannot do anything useful to move toward it.

The older ending and ladder work fixed major reachability problems. The remaining risk is **waiting**:

- one blocker;
- no deliberate action;
- many routine years;
- no change in plan.

That produces abandonment even when the simulation is technically working.

### Scope

Extend measurement to identify:

- years/generations with the same dominant blocker;
- years since the player last had an actionable way to affect it;
- longest “goal did not move” span;
- repeated failed attempts at the same verb;
- House Ambition states that remain unchanged for many decisions;
- longest ordinary/spine gap;
- longest repeated interaction-shape streak.

This should coordinate with #205 rather than create competing measurement infrastructure.

### Acceptance

- The report runs on Short and Long campaigns.
- It names the system/blocker responsible for each detected stall.
- It separates “deliberate long plan with meaningful interim actions” from “nothing actionable.”
- Any tuning response must be owned by the blocking system; no generic difficulty ramp or global event-frequency increase.
- Thresholds are established from measured distributions, not guessed.

---

## 8. Detect semantic repetition, not only repeated event IDs

**Priority: P1**

### Why this matters commercially

The current event pool already has low direct same-Age repetition.

That does not prevent this experience:

> Different prose, same interaction, same obvious answer.

A long campaign can feel repetitive even when the event IDs never repeat.

### Scope

Use existing event metadata, purposes, verbs and option-effect categories to report repeated **interaction shapes** such as:

- pay / refuse;
- spend Respect / accept grievance;
- choose obvious best Match;
- Record choice with the same dominant answer;
- harmless career assignment;
- recurring resource top-up;
- “pick the only affordable option.”

The detector should look for streaks and high-frequency patterns across a campaign.

### Acceptance

- The report identifies interaction shape independently from event ID.
- It can show the most frequent shapes by Age and campaign profile.
- It reports same-shape streaks.
- It can distinguish a repeated verb with different strategic context from a repeated verb whose answer is effectively predetermined.
- Findings feed authoring/tuning; do not solve them by adding arbitrary event volume.

---

## 9. Add graduated, in-world contextual help for complex systems

**Priority: P1**

### Why this matters commercially

The project correctly avoids turning mystery into progress bars.

That does not mean players should be stranded.

*The Roottrees are Dead* demonstrates a useful pattern: help can begin as a small nudge and become more specific only if requested.

Eldritch Dynasty already has biased advisers (#215), which gives this feature an in-world voice.

### Scope

For major complex surfaces — family tree, Chronicle, branches, known rite requirements, Match context — allow the player to request increasing help:

1. **Nudge:** “The steward thinks House Ilm stopped calling after the winter refusal.”
2. **Known rule:** explain the relevant rule the family actually understands.
3. **Actionable suggestion:** point to an available verb/screen that could help.

Never reveal:

- exact hidden probabilities;
- hidden genomes;
- secret event rolls;
- omniscient truth where the fiction forbids it;
- Bearing as a named meter.

Advisers may disagree according to their interests.

### Acceptance

- Help is optional and requested by the player.
- At least three major complex surfaces support a graduated help path.
- Help only uses information the house could know.
- The most specific tier gives an actionable next step without solving the decision.
- Adviser bias is preserved where appropriate; there is no neutral omniscient narrator.

---

## 10. Protect meaningful differentiation between Short Line and Long Line

**Priority: P1**

### Why this matters commercially

A Long Line must not feel like:

> “The Short Line, plus another two hundred years.”

The current game already has meaningful structural differences — deeper Ledger, upper ladder, full rites and Long-specific endings — but that distinction should be guarded as the game continues to evolve.

### Scope

Create a campaign-differentiation report and content/design checklist.

Measure:

- verbs available only in Long;
- revelations/clauses unique to Long;
- rites/rungs unique to Long;
- external pressures that only emerge in Long;
- ending routes unique to Long;
- percentage of late Long prompts that are not merely repeats of Short-era interaction shapes.

The Short Line should remain a complete product shape, not a tutorial.
The Long Line should remain qualitatively deeper, not merely longer.

### Acceptance

- A report names Long-exclusive verbs, revelations, goals and ending routes.
- Every Long Line batch reaches multiple pieces of Long-exclusive gameplay before term.
- The late Long Line contains at least one strategic problem whose solution vocabulary did not exist in the Short Line.
- No Short-only “fake ending” language suggests the player played an incomplete game.
- Any future campaign change runs this differentiation report.

---

## 11. Finish the reading-comfort and experienced-player UX layer

**Priority: P2**

### Why this matters commercially

For a text-heavy game, reading comfort is gameplay quality.

The repository has already addressed major accessibility defects such as ARIA and platform font scaling. The remaining target should be a coherent player-facing reading suite rather than isolated fixes.

### Scope

Ensure the client exposes:

- user font scaling;
- sensible maximum line width;
- instant text reveal;
- reduced motion/text animation;
- keyboard navigation for recurring decisions;
- visible focus state;
- no essential hover-only information;
- high-contrast text option if needed against vellum;
- “seen” state that integrates with issue candidate #2;
- persistent preferences across sessions.

Do not redesign the ink-on-vellum identity unless readability evidence demands it.

### Acceptance

- All recurring decision flows are keyboard-operable.
- Text animation can be disabled.
- Font scale is user-adjustable and works across supported layouts.
- Essential game information has a non-hover path.
- Reading preferences persist.
- A single automated accessibility/regression checklist covers these rules so they do not drift independently.

---

## 12. Make the narrative/UI localization-ready and use audience evidence to choose launch languages

**Priority: P2**

### Why this matters commercially

Many of the strongest relevant games support Simplified Chinese and multiple European/Asian languages.

tinyBuild's 2026 *The King is Watching* postmortem is especially relevant: it says strong organic interest from China changed localization and promotional priorities.

Eldritch Dynasty is unusually difficult to translate because voice is part of the game:

- chronicler register changes;
- Chronicle wording becomes evidence;
- repeated phrases are callbacks;
- names and terminology are mechanical;
- prose is intentionally concise and rhythmic.

Localization cannot safely be treated as a final string dump.

### Scope

Prepare the game for translation without committing to a launch-language list yet:

- no player-facing English hard-coded outside the localization surface;
- no essential text baked into images;
- stable terminology keys for ranks, blood concepts, Ledger, rites and Chronicle actions;
- speaker/register metadata available to translators;
- translator notes for callbacks and phrases whose exact repetition matters;
- layout tests for longer strings;
- plural/date/name handling;
- exportable content corpus for translation;
- market/language decision based on wishlist/demo geography before localization spend.

### Acceptance

- A localization audit can enumerate every player-facing string source.
- A pseudo-localized build can expand text significantly without breaking recurring decision screens.
- Chronicle callback identity survives localization keys rather than depending on English substring matching.
- Translator context can distinguish tale/frame/chronicler/adviser voices.
- No specific launch language is mandated until audience evidence supports it.

---

# Suggested raising order

If these become GitHub issues, raise them in this order:

1. **Choice consequence credibility audit**
2. **Replay compression / skip seen prose**
3. **Full-population family-tree navigation**
4. **Chronicle causal backlinks**
5. **Strategic-stall detector** (or fold into #205)
6. **Semantic interaction repetition detector** (or fold into #205)
7. **Early second-run divergence measurement** (or fold into #205)
8. **House Afterimage**
9. **Graduated contextual help**
10. **Short-vs-Long differentiation guard**
11. **Reading-comfort UX**
12. **Localization readiness**

The first four most directly protect the commercial promise:

> **My plan mattered, I could understand my family, the game remembered what I did, and a second run did not waste my time.**
