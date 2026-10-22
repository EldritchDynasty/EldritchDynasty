# Eldritch Dynasty — Full Story Reference

> **Complete spoilers.** This is a story-facing map of the game that exists on `main`: what a player is guaranteed to be shown, what changes from run to run, how the Ascension Ladder keeps giving the house a next objective, and how each ending closes the ring opened in 1042.
>
> The executable game is the authority where older design prose has drifted. In particular, the current game has **six authored endings across two campaign profiles**: five available to A Long Line, and four available to A Short Line, with overlap between them.
>
> Reviewed against `main` at `098bfe02` on 22 October 2026. Quotations below
> are Original-register story excerpts; the live YAML, selected campaign and
> prose mode determine the rendered wording. The 33-year demo is an additional
> engine profile, not a choice on the normal start screen.

This is not a replacement for the concept brief, the world bible, or the event corpus. It is the shortest route through the **whole story**.

## The shape of the story

Eldritch Dynasty is the story of one bloodline living inside an agreement none of its descendants made.

The player begins as the signing founder and remains the continuing will of the house when he becomes its guardian: choosing marriages, preserving or spending people, collecting books and heirlooms, deciding what the family writes down, and trying to make later generations capable of doing what earlier generations could not.

Every player-facing run has four layers:

1. **The signing, 1042.** The debt is created, the house is named, and the family receives a gift whose price is its own blood.
2. **The centuries between.** Generations marry, inherit, die, split into cadet halls, accumulate books and land, survive Ages, recover pieces of the Ledger, and climb the Ascension Ladder.
3. **The record of those centuries.** The player repeatedly chooses what the chronicle will say: Record, Omit, or Embellish. The book is not decoration. It is evidence the creditor will later read back.
4. **The last night.** The term expires. The creditor reads the chronicle, not an abstract score sheet, and the ending is selected from what the bloodline survived **and what the book can substantiate**.

The two campaign profiles use the same beginning and the same family systems:

| Campaign | Term | Ledger | Endings available |
|---|---:|---:|---|
| **A Short Line** | 1042–1342, 300 years | 3 clauses | Broken Line, Settled Account, Forgotten, Devoured |
| **A Long Line** | 1042–1542, 500 years | 9 clauses | Apotheosis, Unmade, Broken Line, Forgotten, Devoured |

A Short Line is the default shorter campaign. A Long Line is the complete campaign and contains the God / Unmaking endgame.

### The signing uses the selected campaign's term

The third debt uses `campaignText` in `prologue.yaml`, rendered with the
profile's `years` and `endYear`. Short says 300 years ending in 1342; Long says
500 ending in 1542; the engine's demo says 33 ending in 1075. Endings and
clauses can also carry campaign-aware text. The old shared-term mismatch is
fixed; Long Line excerpts below do not set the Short Line's clock.

`core/src/prologue.ts` renders that term; `core/src/campaign.test.ts` exercises
the campaign text contract.

---

## 1. What every player starts with — The Signing

The game opens before the house has earned its legend.

### Opening

> It was the last of the Hollow Days, when the old year has ended and the
> new one has not begun and every table in the province keeps a seat empty
> without anybody agreeing why. The hall was cold in the way of a room
> built for four times the family that had it. There were seven candles in
> sconces meant for forty, and a dog at the fire that had slept there every
> winter of its life.
>
> What came in was not seen. The dog rose and went out and would not be
> called back, and was found in the morning in the yard with the snow
> melted around it in a shape nobody cared to measure. The iron on the
> table dulled between one sentence and the next, so that the seal which
> had been bright when the man sat down had to be cleaned before it would
> take wax. There was a smell of wet ash indoors, in summer, in the middle
> of winter. Afterwards none of the four who had been in that room could
> agree on how long they had been in it, and two of them would not discuss
> it at all.
>
> Three things were given. Three things were owed for them. The man was
> told which was which, in order, and the order was not an accident.

The prologue then states the three-part agreement. This triad is the structure every ending later repeats with exactly one element changed.

### I. The Roof / A Page a Year

**Given — THE ROOF**

> The house had a poor claim to its land and a worse one to the name above
> its door, and there were two families and a bishop who could have said so
> in a court. After that night none of them did. The quiet held through the
> Fall of the next dynasty and the burning of the Marches and four royal
> surveys, and it holds now.

**Owed — A PAGE A YEAR**

> Somebody of the blood was to write down what the house had done,
> truthfully, in a book kept for the purpose and kept nowhere else. The man
> took this for a courtesy. He was a man who had never yet had anything he
> needed to leave out.

This is the seed of the chronicle mechanic. The house is not merely asked to survive. It is asked to leave a record that can later be read against it.

### II. The Thing in the Blood / The Sons

**Given — THE THING IN THE BLOOD**

> It was not explained, then or since. It comes to the sons and never to
> the daughters, who carry it and hand it on without ever once holding it;
> it cannot be asked for, scheduled, taught, or produced on purpose by
> anybody living; and it has never arrived twice in the same way.

**Owed — THE SONS**

> Not taken — spent. The gift and the price are the same substance, and in
> five hundred years no house of this line has managed to have the first
> without paying the second, though several have written books arguing that
> they did.

This is the central family problem. Men express Eldritch Power and can be destroyed by it. Women carry the font without expressing it. The player must therefore preserve the blood, concentrate it, and keep enough of the family alive that the line is still more than its current best man.

### III. The Keeping / The Term

**Given — THE KEEPING**

> Three objects were left on the table — a seal, a ring, and a rod for
> which no use has ever been established — on the single condition that the
> family hold them in a hand that could be shown.

**Owed — THE TERM**

> Five hundred years, to the day, and then the account read back and
> settled in whatever coin the account turns out to be written in. The man
> agreed to this part quickly, and the two of his household who were sober
> enough to remember it both said afterwards that he had agreed to it more
> quickly than to the others. He was fifty-one. Five hundred years was a
> number, and not a thing that happens to anybody.

A Long Line takes this literally: the clock ends in 1542. A Short Line uses a smaller contract profile and ends in 1342.

### The player's founding choices

First the player names the founder (blank keeps Daveed Gearithy) and answers
the four Examination questions. Each selected answer applies both its given
and its owed terms. `GameSession.found()` rebuilds the founding family before
committing those answers. Gender/configuration selection remains #1867.

The founder is deliberately left unnamed. The player names the **house**, because the house is what persists.

The player also chooses one founding heirloom request:

- **Portion of Agelessness** — “He asked for time…”
- **Portion of Fertility** — “He asked for children…”
- **The Unmirrored Eye** — “He asked to be able to see it…”

And one old wrong that becomes the first inherited grudge: Marrow, Calder, or Ilm.

Finally, the signing asks the player to name up to five people outside the bloodline “without whom the life you have had would have been some other life.” Those names return, disguised by generation and circumstance, during the early centuries. The family itself does not know why.

The prologue ends with the thesis the whole game will later turn around:

> **Everything after this was done by people who did not sign it.**

---

## 2. The centuries — what the player is trying to make

The day-to-day game is deliberately human-scale: marriages, births, deaths, careers, books, land, feuds, cadet branches, events, and decisions about the family record.

Underneath all of it is one legible long-term question:

**How high can this bloodline climb before the term arrives?**

The answer is the Ascension Ladder.

The ladder is not merely a power score. Each rung adds another kind of requirement, so the strategy that clears one rung is insufficient for the next. The player is continually pushed from **breeding**, to **learning**, to **social legitimacy**, to **sacrifice**, to **preservation**, and finally to maintaining an entire family capable of one last working.

### The current executable ladder

The values below are the gates the code currently evaluates. Book counts are derived from the current 21-book catalogue; they are shown here at their present values.

| Rung | What must be true now | What the rung asks the player to become |
|---|---|---|
| **Touched** | The man has awakened; Eldritch Power **10+** | Produce a son in whom the gift actually manifests. This is proof the line still carries what was given. |
| **Adept** | Power **25+**; **1+ book** read; Madness does not exceed Mind | Stop treating awakening as enough. Build a reader who can use what came through the blood without immediately being ruined by it. |
| **Hierophant** | Power **50+**; **3+ books**; **3+ affinities**; Madness **20+** but not above Mind; house at least **Regarded** | The ladder becomes public and paradoxical: the heir must be hurt by the gift, but not destroyed by it, and the outside world must respect the house enough to recognise what it has become. |
| **The Vessel** | Power **70+**; **4+ books**; Mind **70+**; house **Eminent**; the Vessel rite completed | Pay with an actual living member of the blood, willingly given. The next step is no longer something breeding and study can buy by themselves. |
| **Demigod** | Power **85+**; **7+ books**; **5+ affinities**; house **Eminent**; Madness **60+** but not above Mind; all **3 Regalia** held; Great Rite completed | Reassemble what the centuries scattered. The house must preserve its founding objects, sustain a highly damaged but still functioning ascendant, and either obtain sanction for the Great Rite or defy the institution that withholds it. |
| **God** | Power **88+**; living family readers collectively know **8+ distinct books**, with at least one affinity from **each of the four opposed pairs**; house **Exalted**; Madness **90+** but not above Mind; **7+ Ledger clauses** recovered; the Unmaking completed | Outgrow the house's own elder. A separate two-rite elder must be spent to raise a blood descendant beyond him, while the surviving family keeps the four pair positions represented. One perfect patriarch is not enough. |

The ladder is cumulative: somebody standing at a higher rung must also have cleared everything below it.

### Why the next rung is always a different problem

The important part of the table is not the numbers. It is the changing **shape** of the obstruction.

- **Touched → Adept:** learn.
- **Adept → Hierophant:** broaden knowledge, acquire visible standing, and accept some Madness rather than avoiding it.
- **Hierophant → Vessel:** make the family pay a human cost.
- **Vessel → Demigod:** preserve the Regalia across generations and survive the Great Rite.
- **Demigod → God:** stop thinking about one exceptional man. Build a deep living family, recover enough of the contract, sustain reading across all four opposed pairs, and create a descendant strong enough to inherit what an elder is destroyed to give him.

That last reversal is the terminal irony of the ladder:

> **A dynasty that concentrates everything into one perfect patriarch cannot ascend.**

The elder matters because somebody after him must be better.

---

## 3. The other clock — The Ledger

The Ascension Ladder tells the player what the **house** is becoming.

The Ledger tells the player what the **debt** was all along.

The family begins with only one known clause. Further clauses are recovered through clause-bearing Ages when the house has kept the means to recover them. A Long Line has all nine clauses in its contract; A Short Line uses a three-clause profile.

The nine Long-Line clauses are:

1. **The Term** — five hundred years exactly; no extension, nobody may be absent at collection.
2. **The Kept Thing** — what was given must remain keepable; losing the Regalia is not merely a material loss.
3. **The Blood Entire** — the debt belongs to the blood, not one man, and does not divide among heirs.
4. **Substitution** — one blood relative may pay in another's place; consent obtained in ignorance still counts.
5. **The Ninth Name** — the counterparty's nine names are legally one party.
6. **The Broken Line** — extinction does not discharge the debt; it falls on what holds the house and name.
7. **The Made Thing** — ceasing to be a person does not end the obligation. Ascent is not escape.
8. **The Witness** — the debtor's own writing is not evidence; the counterparty is a witness.
9. **The Final Accounting** — at the term, what is owed is read aloud and must be answered; silence is an answer.

The clauses deliberately move the player's understanding in the wrong direction before correcting it. Early recovery makes the agreement look more exact and therefore more manageable. Later recovery reveals that precision is not the same thing as safety.

Most importantly, the Ledger converges with the ladder at the top. God requires **seven recovered clauses**, so a house cannot ignore the story mystery for four centuries and solve it with genetics in the final generation.

---

## 4. The Ages — the middle is a story, not a fixed script

The signing and the last night are fixed. The five centuries between them are not.

An Age is a hazard process. It starts and ends probabilistically, so even the same Age can occupy very different spans in two runs. Some Ages can reveal clauses; some cannot. Their opening text is shown before the family has a name for what is happening.

The seven current Ages are:

### The Long Peace — warm, clause-bearing

> For a time the harvests came in fat and the graveyards thin, and the
> house began to believe, as every house does when the years are kind for
> long enough, that this was simply how things were now.

The temptation is complacency. The family has room to marry, accumulate, study, and mistake prosperity for permanence.

### The Wars — cold, clause-bearing

> Word came that men were needed, and then that men were needed again, and
> the house learned what a son is worth to a levy that does not ask what
> he was worth to his mother.

The story pressure is direct: the same sons needed for the bloodline are also bodies the world can spend.

### The Crusade — institutional, clause-bearing

> Somewhere a clerk with a very good memory had begun, without any
> particular malice, to take an interest in the family, and the family had
> the uneasy sense of a door that had always stood open being quietly
> measured for a lock.

The threat becomes organised observation rather than bad fortune.

### The Insurrection — institutional, not clause-bearing

> Houses that had stood since before anyone living could remember began,
> one after another, to discover that standing since before anyone could
> remember had never been the same thing as standing forever.

The game's assumption that a house is a permanent unit comes under political pressure.

### The Withering — cold, clause-bearing

> Fewer children woke to what should have been theirs, and fewer books
> changed hands, and nobody could name the year it started because it had
> not started in any year — it had simply, by degrees, stopped being
> replaced.

This attacks replacement itself: awakened heirs and circulating knowledge become harder to sustain.

### The Quickening — warm, clause-bearing

> The gift came early now, and came to more of the blood than it had any
> right to, and the house found the ladder it had climbed alone for
> generations suddenly and uncomfortably crowded with other men's sons.

Abundance is not pure relief. The gift becoming common inside the bloodline creates rivals, alternate branches, and people whose existence complicates succession.

### The Plague — cold, not clause-bearing

> It did not ask after bloodlines or affinities or which houses had been
> careful, and the ones who had built their lives on being strong learned,
> in a season, what the ones who had built theirs on being clever already
> knew.

The plague does not care which people were load-bearing to the player's plan.

No particular sequence of these seven is “the canonical plot.” Their job is to make the centuries leave different scars while the signing, ladder, Ledger, and ending keep the run pointed toward the same final night.

---

## 5. The chronicle — the player writes the weapon used at the end

The family owes a page a year. Mechanically, the player repeatedly decides what the record will do with consequential events:

- **Record** — preserve what happened. Damning truth can cost Respect now, but later generations and the final reading have something real to stand on.
- **Omit** — leave a dated blank. The event is not erased; the blank itself survives and is read on the last night.
- **Embellish** — improve the story and often the house's standing now, but create a claim that can be contradicted by the rest of the record.

This is not a morality meter. Embellishing can be strategically useful because the upper ladder requires high Respect. The problem is delayed: the creditor later asks what the book can support.

At the term the ending code distinguishes:

- the highest rung the chronicle **attests**;
- the highest rung the chronicle can **substantiate** after standing discrepancies are weighed against it;
- the actual surviving bloodline;
- the recovered contract;
- and whether the terminal rite succeeded or failed.

That is why the story's question is not simply “did the player reach God?”

It is also:

**What did the family say it became, and can the book hold that claim up when somebody else reads it?**

---

## 6. What the player is meant to feel as the ladder rises

The story escalates by changing the meaning of success.

### Early game — *Can this family keep the gift?*

The player is breeding for a viable line, learning which daughters carry the future, coping with sons who do not awaken, and establishing enough wealth and continuity to think beyond the next succession.

Adept is the first answer: the gift can be made useful.

### Middle game — *What will the family do to become formidable?*

Hierophant makes social standing, books, affinities, and Madness collide. The player can no longer optimise only the genome.

The Vessel then turns the game's metaphor literal. “The sons” were always the price; now the player has to name one of the blood and spend a person deliberately.

### Late game — *Can the house preserve enough of itself to survive its own ambition?*

Demigod requires the Regalia to be reunited, knowledge to have survived, the ascendant to have been driven deep into Madness without crossing what his Mind can bear, and the Great Rite to have happened.

God reverses the fantasy of the singular chosen one. The house needs an elder who climbed, a descendant who can surpass him, living readers who collectively preserve the four opposed-pair positions, seven recovered clauses, Exalted standing, and a final act that destroys the elder to lift the younger.

The player's best individual is no longer the project.

**The family is.**

---

## 7. The last night — what is guaranteed

Every completed run ends with the account being read.

The epilogue replays the three beats of the signing. Exactly one half of one beat is replaced for the chosen ending. The unchanged material makes the player hear the difference.

The creditor also reads the player's own chronicle back: its blanks, embellishments, illuminated pages, and the claims the family made about itself.

The game currently has six authored endings across the two campaign profiles.

---

## 8. Endings

### Apotheosis — A Long Line

**Condition in the executable selector:** the chronicle can substantiate **God**, and the Long campaign permits the ending.

**Opening:**

> The book was brought to the table by somebody who had been told from
> childhood that they would be the one to bring it, and it was read
> through from the first page to the last without a word from either side
> of the table. It took most of the night. Where the family had written
> the truth, the truth was accepted without comment, which was worse than
> argument. Where the family had written nothing, the blank was read too,
> and took as long as a page.
>
> When it was finished the account was closed in the ordinary way, and
> then something wrote underneath it. The hand is not a human hand. It is
> the one page of the book that every scholar who has been permitted to
> see it agrees about, and what they agree is that it is perfectly
> legible, and that they can read it, and that they would rather not have
> been able to.

**The changed beat:** the third debt, **THE TERM**, is found to have nothing on the other side of it because the thing that would have been collected is already sitting at the table.

**Last line:**

> **Everything after this will be done by something that did sign it.**

This is not “the family defeated the creditor.” The ending preserves the game's refusal to explain the counterparty. The achievement is that the house has changed the category of the party at the table.

---

### The Unmade — A Long Line

**Condition in the executable selector:** the final God rite reached its last step and failed.

**Opening:**

> It was done in the small hall, because the great one had not been heated
> in two generations, and it failed at the last step in front of eleven
> people who had spent their whole lives being told what it would be like
> when it worked. What went out of the room went out of the blood with it.
> There was no sound. A woman who was there said later that it was like
> the moment after a bell, and then like the moment after that, and then
> like nothing at all.
>
> The book was read on the last night to a cousin of no particular line,
> who had been sent for because there was nobody else, and who kept
> apologising for not understanding it. Nothing came for the account. The
> hall is cold now in the way of a room built for four times the family
> that has it, and there are candles in perhaps a seventh of the sconces,
> and a dog at the fire that has slept there every winter of its life.

**The changed beat:** **THE THING IN THE BLOOD** is gone. The house is quiet again, but the quiet no longer means what it meant in 1042.

**Last line:**

> **Everything after this will be done by people who never heard of it.**

The house attempted transcendence and instead ended the supernatural inheritance itself.

---

### The Broken Line — A Short Line or A Long Line

**Condition in the executable selector:** no living member of the blood remains when the ending is read.

**Opening:**

> The last of them did not last the winter, and the ones before that had
> not lasted the winters before it, and by the term there was nobody in
> the house at all except the two women from Wick who came up twice a week
> to see that the roof held. They were not there on the night. Nobody was.
>
> The book was read anyway, at the table, in an empty hall, from the first
> page to the last. There is no account of this. The chronicle simply
> stops, and what is known about the last night is known because the
> candles were found burnt to the sockets and the book was found closed,
> and it had been left open.

**The changed beat:** **THE SONS** are paid in full — then the sisters and cadet cousins too. The line itself is gone.

**Last line:**

> **There was nobody left to do anything after this.**

Extinction is not an escape clause. The Ledger explicitly says the broken line does not discharge the debt.

---

### The Settled Account — A Short Line only

**Condition in the executable selector:** the Short campaign's contract is complete, the chronicle's highest claim survives the creditor's reading intact, and the house has not already qualified for Devoured.

**Opening:**

> The book was brought to the table with three leaves marked in the old
> hand, and those were the leaves the other party asked for first. Each was
> found where it ought to be. Each said what it had said when it was
> written. The rest of the chronicle was read afterwards, because the
> family had kept it and because a book brought to a table is read, but the
> account had already changed while the candles were still high.
>
> Nothing was forgiven. Nothing was mistaken for strength. The thing on the
> other side of the table simply reached the end of what this signing had
> promised, put one finger beneath the last line, and closed the cover.
> By morning the family still had its house, its blood, and every problem
> that had not been part of the contract.

**The changed beat:** **THE TERM** ends in a shorter account whose required clauses are all present and answerable.

**Last line:**

> **Everything after this was done by people whose debt was paid.**

Settlement is not a Long-Line shortcut. The complete Long campaign promises the God / Unmaking axis instead.

---

### The Forgotten — A Short Line or A Long Line

**Condition in the executable selector:** the house survives to the term but qualifies for none of the stronger ending branches. This includes a genuinely modest house, and it can also include a house whose chronicle claimed more than it could substantiate.

**Opening:**

> The house kept its page a year for five hundred years. It is, by some
> distance, the most complete private record in the province, and the
> Colleges at Corran have twice sent a reader to copy portions of it, and
> both times the reader was chiefly interested in the grain prices.
>
> On the last night the account was read from the first page to the last,
> and the blanks were read as carefully as the pages, and at the end of it
> nothing was collected. There is no record of anything being said. The
> candles burned down and the room grew cold and at some point in the
> early morning the family understood that they had been read, and
> measured, and found to be a private record in a provincial house with
> good grain prices.

**The changed beat:** **A PAGE A YEAR** is the part the family truly completed. The immense family history is, from the counterparty's scale, merely a complete private record.

**Last line:**

> **Everything after this was done by people who did not sign it. It turns out nobody needed them to.**

The ending is deliberately not catastrophic. Its wound is scale: the house spent centuries making itself matter and discovers that survival and significance are different things.

---

### The Devoured — A Short Line or A Long Line

**Condition in the executable selector:** the chronicle can substantiate at least **Hierophant**, but not God. This branch is checked before Short-Line settlement.

**Opening:**

> The one at the head of the table was the most formidable thing this
> family has ever produced, and had been for thirty years, and the whole
> province knew it. Three bishops had written about it. Two houses had
> married into it on purpose. The book was read through with the head of
> the house present, which had not been done before, and which the family
> had understood to be a strength.
>
> It was. That was the difficulty. What came for the account had walked a
> long way for something worth the walk, and had not come to argue, and
> did not.

**The changed beat:** **THE TERM** includes the formidable head of the house — worth the journey, not formidable enough to change what follows.

**Last line:**

> **Everything after this was done by people who did not sign it. So was this.**

This is the ladder's cruel middle answer: becoming extraordinary can make the family more collectible without making it safe.

---

## 9. The ending order matters

The last-night selector currently asks these questions in order:

1. **Is anybody of the blood still alive?** If not: **The Broken Line**.
2. **Did the Long-Line God rite fail at the last step?** If so: **The Unmade**.
3. **Can the chronicle substantiate God?** If so, in A Long Line: **Apotheosis**.
4. **Can the chronicle substantiate Hierophant or better?** If so: **The Devoured**.
5. **In A Short Line, is the shorter contract complete and is the book's claim fully substantiated?** If so: **The Settled Account**.
6. Otherwise: **The Forgotten**.

That ordering is story logic, not merely implementation detail. A formidable Short-Line house cannot escape Devoured by presenting tidy paperwork. And a house whose book claims greatness but cannot support the claim may fall all the way to Forgotten.

---

## 10. What is fixed, and what is deliberately variable

| Story element | Fixed in every player run? | Notes |
|---|---|---|
| The 1042 signing | **Yes** | Same authored opening and triad; founding choices personalise it. |
| The house name | **Chosen** | The founder is left unnamed; the house is the persistent protagonist. |
| The five outside names | **Asked** | Optional to supply; their later appearances are hidden and variable. |
| The Ascension Ladder | **Yes** | Same ordered rungs and current gates. Who reaches them, and when, varies. |
| The chronicle / Record choices | **Yes as a system** | Particular events and therefore particular choices vary. |
| The seven Ages | **Variable** | Hazard processes, not a fixed seven-act script. |
| Ledger recovery | **Variable** | The contract profile is fixed; which clauses are recovered during a run varies. |
| Frame interludes | **Variable** | They react to what the record contains; they are not a fixed cut-scene sequence. |
| The last-night reading | **Yes** | A completed run ends in the account being read. |
| The ending | **Exactly one** | Selected from the campaign's available endings and the chronicle's substantiated story. |

---

## 11. The whole story in one paragraph

In 1042 the founder, named by the player, accepts a protected house, an impossible thing in the blood, and three objects to keep; in exchange his descendants owe a truthful record, their sons, and an account at the end of the term. The player names the house and then spends centuries making descendants who can carry the gift farther than their parents did: first awakening it, then learning it, then becoming publicly formidable, then paying for ascent with relatives, heirlooms, reputation, sanity, knowledge, and finally the elder who climbed before them. While the family does this, the Ledger slowly reveals that inheritance, extinction, and even ceasing to be human do not obviously void the agreement, and the chronicle the player has been editing for immediate advantage becomes the evidence read at the end. When the term arrives, the creditor sits at the table and reads what the house said it was. The family may be extinct, forgotten, worth consuming, released from a shorter account, emptied of the gift by a failed last rite, or transformed far enough that the final party at the table is no longer merely the descendant of the person who signed. The last night does not ask whether the family was good. It asks what five centuries made, what they wrote down about making it, and whether the book can prove the difference.

---

## Source-of-truth pointers

When this reference and another document disagree, follow the executable source for what currently happens and the concept brief for the intended game rule:

- `packages/content/prologue.yaml` — exact signing text, founding choices, thesis.
- `packages/core/src/prologue.ts` — what the playable signing actually changes.
- `packages/core/src/ascension.ts` — current rung gates and the player-facing reason a rung is blocked.
- `packages/content/clauses.yaml` — the nine Long-Line clauses.
- `packages/content/ages/ages.yaml` — current Ages and their opening passages.
- `packages/core/src/ending.ts` — current last-night reading and ending selection order.
- `packages/content/endings.yaml` — exact ending prose and ring substitutions.
- `packages/core/src/campaign.ts` — Short and Long campaign profiles.
- `DesignConcepts/eldritch-dynasty-concept-brief.md` — design authority.
- `.claude/skills/eldritch-story/SKILL.md` — story architecture and register split.
