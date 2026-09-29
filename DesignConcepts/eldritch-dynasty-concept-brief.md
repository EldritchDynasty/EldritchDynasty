# ELDRITCH DYNASTY — Concept Brief

**Version:** 0.2.2 (bearing)
**Date:** August 2026
**Genre:** Text-based generational strategy / narrative simulation
**Platform:** PC (Windows, macOS, Linux) via Steam; browser demo
**Stack:** Vue 3 + TypeScript, Electron
**Target price:** NZD $28–35
**Session shape:** **A Long Line** is 500 in-game years (1042–1542), roughly 20 generations. Real-time playtime has not been measured for this profile; no duration claim is made. **A Short Line** is the separate 300-year default (#66).

> **On this revision.** v0.1 was a systems document with story bolted to the outside. v0.2 rebuilds the narrative architecture using the principles in `.claude/skills/eldritch-story/reference/story-manual.md`. No system from v0.1 has been cut. What has changed: the game now has a **frame**, the chronicle is now **unreliable and player-authored**, the debt now **pays out on a schedule** instead of deferring everything to the last hour, and every Age is now required to advance the mystery. v0.1 is preserved at `eldritch-dynasty-concept-brief.v0.1.md`. Changes are itemised in §26.
>
> **0.2.1 — three changes, arriving with the data model.** The affinity count is now **eight**, in four opposed pairs; §22's God gate was right and §9 was short one. Eldritch Power is confirmed **X-linked**. And the eight affinities now split into **Elemental** and **Threshold**, with women practising only the Threshold four. Note carefully that this governs **Mystic** magic only: Eldritch Power stays male-expressed, and since Madness is the overflow of Eldritch Power, **only those capable of expressing it can go mad** — which means never a woman and never a mundane man. §7, §10, §11, §12, §16, §17 and §22 all move with these.
>
> §20 also changes: **Ages now begin and end by chance**, with per-Age duration bands rather than one global 40–150 span, and Ages may own exclusive events.
>
> **0.2.2 — one addition, and it is a theme becoming a system.** §29 is new. The story manual has always named **Pride** the line's fatal flaw, alongside the blood and the signing; unlike every other component on that list it was never given a mechanism, and a theme no system reads is decoration. §29 makes it **bearing** — a reading rather than a resource, computed off seven acts the player already performs, never named in a player-facing string, and billed two generations late. Nothing else moves: no section is renumbered, no existing rule changes, and §27 gains two entries.

---

## 0. The Thesis Sentence

> **This is the true story of how the house became the thing people sing about — told by the last of the line, on the last night, to the creditor sitting across the table.**

Everything below is downstream of that sentence.

The game is not about a family becoming gods. It is about the **gap between what the family did and what the family wrote down**, and about a player who spends centuries widening that gap on purpose, and one night at the end where the gap is read aloud.

If a feature does not touch blood, the ledger, or the record, it is not in this game.

---

## 1. Pitch

*Five hundred years is just enough time to ruin a family properly.*

In year 1042 your ancestor signed something. In 1542 the other party comes to collect. You have roughly twenty generations to raise a descendant capable of paying, breaking, or outliving that debt — and the only asset you can pass down is blood.

The goal is to make a god. The method is marriage. The record is a lie you are writing as you go.

---

## 2. The Three-Layer Architecture

The game is a nesting doll. Three layers, each with its own voice, tempo, and colour. Build all three; do not let them blur.

### Layer 1 — The Frame · Year 1542
Third person, present tense, **quiet**. Two figures at a long table in a cold house. One is the last of the blood. One is not a person. Between them sits the chronicle the player has spent the entire run writing.

- **Volume:** ~5% of total text. Twelve to eighteen interludes across a full run.
- **Tempo:** slower than everything around it. No music. Reduced palette. Page turns and nothing else.
- **Function:** it is the *promise*. Every generation is played against the question *how does this become that?*
- **Rule:** the frame never dispenses systems information. It reacts to the record.

> The house was quiet on the last night, and it was a quiet of three parts.
>
> The first was the ordinary quiet of a great house with too few people left in it. No boots in the upper hall. No fire in six of the seven grates. Nobody calling down the stair for someone to bring a light.
>
> The second was smaller, and it was made on purpose. Two at the long table, and neither of them talking about the road, or the year, or the seal on the box between them. One of them had been not-talking about it for a very long time.
>
> The third was underneath the other two, and it was the reason for them. It was the dry, ledger-paper sound of a debt that has finished waiting.

### Layer 2 — The Tale · 1042–1542
The run itself. Warm, quick, particular. Told in the voice of whichever family chronicler is holding the pen that century, which means the voice **changes** — a soldier's widow writes differently from a bought scholar, and both are writing about you.

- **Volume:** ~90%.
- **Tempo:** a generation is a chapter. Fifteen minutes. One scene, one turn.

### Layer 3 — The Nested Tales
Everything the world says about the world: tavern songs, rival houses' chronicles, Church doctrine, a children's counting rhyme, a play performed badly in a provincial town about a Head who has been dead two centuries and is now a comic villain.

- **Volume:** ~5%, delivered as inserts inside events and as findable documents.
- **Rule, absolute:** **no nested tale is neutral.** Every one is told by someone with a stake. Two accounts of the same event must contradict, and the game must never adjudicate between them in its own voice.

---

## 3. The Prologue — A Debt of Three Parts

Once, at the head of the run. Non-interactive except for two choices. Roughly four minutes.

- Year 1042. The founder is **never named**. He is "the man," "your ancestor." The player names the *house*, not the man — names are load-bearing in this world and his is withheld deliberately.
- The counterparty appears **on-screen, once, in the entire game**. Not shown; described by what it displaces. Iron rusting on the table between one sentence and the next. A dog that will not come into the room. The smell of wet ash indoors, in summer.
- The prologue is structured as an announced triad — **three things given, three things owed** — and delivers three, ascending in weight. The third is the one that hurts.
- The player's two choices set the founding heirloom and the family's first grudge. Both echo for five hundred years.
- The prologue closes on a single plain line that states the emotional thesis of the run.

**The epilogue rings it.** Every ending replays the prologue's structure with exactly one element changed. See §24.

---

## 4. Player Fantasy

You are not a character. You are the **will of a bloodline** — the thing that persists while individuals are born, ruined, and buried. You never fight, never explore, never speak a line of dialogue.

You do three things: you decide **who marries whom**, you decide **who is spent**, and you decide **what gets written down**.

The emotional register is **complicity**. The player will do things across five centuries that no single decision would have justified, and then will decide how those things are remembered.

---

## 5. Core Loop

One generation ≈ 15 minutes. One chapter. One turn.

1. **Chronicle** — years pass in a short illuminated passage. World events, Ages, rival houses.
2. **The Match** — draft one suitor from three cards. Blood, politics, dowry, and one secret revealed later.
3. **Events** — 2–3 text scenes drawn from family traits, grudges, and heirlooms.
4. **Awakening & Reveal** — children born; attributes shown; Awakenings resolve.
5. **The Record** — *(new)* the chronicler asks what to write. See §6.
6. **Succession** — name an heir. Everyone else becomes a cadet branch.

**Interludes.** Every third or fourth generation, and always after an emotional peak, the game cuts to 1542 for ninety seconds. The interlude does not advance the tale. It lowers the temperature, shows that something in the present has quietly worsened, and lets the creditor react to what was just written.

---

## 6. The Chronicle — the Unreliable Record

**This is the central addition of v0.2 and the mechanical form of the thesis sentence.**

The chronicle was always the save file, the UI, and the scoreboard. Now it is also **evidence**, and the player is the one falsifying it.

At the end of each generation the chronicler presents the two or three notable things that happened. For each, the player chooses:

| Choice | Effect on descendants | Effect on Respect | Risk |
|---|---|---|---|
| **Record** | Descendants inherit the knowledge — a ritual's true cost, a book's location, an enemy's real motive, a Named Art's method | Truthful entries about Madness, sacrifice or heresy **cost Respect** | None. The record is simply true, and true is often expensive |
| **Omit** | Knowledge is lost. Two centuries later a descendant repeats the mistake at full price, and the event text notes that nobody remembers why the room is bricked up | Neutral | Lost knowledge is genuinely gone. Some events can only be solved by a family that wrote it down |
| **Embellish** | Descendants who act on the entry act on something false, and pay for it | **Respect gain now** | Creates a **Discrepancy** |

### Discrepancies
Every embellishment is logged invisibly. Rival houses, the Church, and the auction's archivists all hold fragments of the truth. A Discrepancy that is *proven* costs a full Respect tier and seeds a scandal event chain. A Discrepancy that survives to 1542 becomes part of the family's legend permanently.

Discrepancies are the reason the endgame concealment squeeze (§17) has texture instead of just being a stat check. You are not hiding Madness. You are **maintaining a story**.

### The last night
At 1542 the creditor reads the chronicle. Not the simulation state — **the chronicle**. What you wrote determines which ending text fires, what the creditor believes it is owed, and whether a bluff four hundred years old holds.

A house that recorded everything faithfully arrives poor in Respect and rich in knowledge. A house that embellished everything arrives exalted, revered, and unable to prove a single thing it needs to prove.

### Lost Books, greyed
Retained from v0.1 and extended: the chronicle displays in grey everything **known to have existed and now gone** — books, people, whole cadet branches, and omitted entries, which appear as a dated blank line with no text. Players will screenshot the blanks.

### How much room an entry gets *(new)*
Four weights — **line · paragraph · page · illuminated** — and for an authored event the weight is not an authoring choice. It falls out of the frequency tier, and `packages/schema/src/frequency.ts` is the only place that mapping exists. Nobody picks it per scene on purpose: a writer who could make his own scene illuminated would.

The simulation writes to the book as well, at about fifty sites, and those choose by hand. The rank they have settled on is a design claim rather than a formatting habit, so it is stated here: **the creditor's words outrank the family's.** A revealed Ledger clause is `illuminated` — the room a Mythic event gets, titled, named, in the contract's own hand. A man of the blood reaching a rung of the ladder no ancestor reached is a `paragraph`, which is the room an Uncommon event gets.

That is deliberate, and it is the thesis sitting in the furniture. The book belongs to the family and the family does not decide what the largest thing in it is. A house may climb to Demigod and find the page recording it smaller than the page recording what it owes — which is the same sentence the engine already says in prose when it writes that rung down: *they called it Hierophant, when they called it anything, and most of them did not.*

It is also load-bearing rather than decorative. The creditor reads the chronicle (§23), an achievement the book under-reports is an achievement it can discount, and a house that climbed but cannot show it climbed is the shape the last night is built to punish. Any new entry the simulation writes is choosing a rank on that scale, and should be able to say why.

---

## 7. The One Permutation

Rothfuss's worldbuilding rule: change one thing, then follow the consequences all the way down. Everything social in this game descends from a single law.

> **Men express the whole of the blood. Women express only what stands at a threshold — the coming in, the going out, the seeing and the unseeing. Only a man who expresses it may lead the house.**

Followed down, with nothing invented that is not a consequence:

- **Cousin marriage is not a temptation, it is the mechanism.** The only route by which carried power reaches an expressing male heir. The path to godhood runs directly through the thing that produces Madness, and there is no alternative route.
- **Only those who can hold the power can be destroyed by it.** Madness is the overflow of Eldritch Power, so a woman cannot go mad — ever, at any concentration of blood, under any ritual (§10). Neither can a mundane son, who has nothing to overflow. The family's entire capacity for self-destruction is concentrated in exactly the people it is counting on.
- **The law bars women from leading, and the reason gets thinner every century.** Leadership requires Eldritch expression, which women never have. But a woman may master the Threshold Arts, hold the house through a sixty-year Regency, and hand the seal at the end of it to a nephew whose sole qualification is having been born correctly. The Church holds that only the blood's own gift qualifies. Nobody in a cadet branch has ever found that convincing.
- **Daughters are the most strategically valuable people in the family and are barred by law from ruling.** They are also the family's only export — every daughter married outward is power leaving the blood forever.
- **A dowry is not money.** Great houses negotiate in *lineage documentation*: three generations of maternal records, notarised. Forging them is an industry.
- **The Church's position** is that the law is divine and the practice is abominable, and it has never resolved the contradiction, which is why it can be bribed.
- **Rival houses' insults** are specific to this: they do not call you cruel, they call you *inbred*, and it works because it is true.
- **The marriage market has a vocabulary.** "Deep blood," "a thin line," "a bought grandmother." Never explained in text. Learned from use.

### The Barren Generation
When no living son expresses Eldritch Power, the family enters **Regency**. A woman of the blood holds the house. She can defend, enrich, negotiate, and arrange marriages with precision. She cannot advance ascension by a single point. The Ledger keeps counting.

A soft-fail with real teeth. Most runs lose 30–80 years this way at least once. The chronicle entries written *during* a Regency are the best-written in the game, and the player will notice.

---

## 8. The Family Tree

The tree is the primary UI, the save file, and the scoreboard. There is no world map and no combat screen. The house keeps a **plat** of what it holds — a document, not a theatre of operations, and never the scoreboard.

- Grows sideways across five centuries
- Dark where lines end, hot where blood concentrates
- Characters represented by **procedurally mutating heraldic sigils** inheriting visual elements from both parents — no portraits, no faces
- Sigil legibility encodes state: line weight = Strength, flourish and symmetry = Charm, spidery asymmetry = high Madness
- *(new)* **Sigils drift with the record, not the truth.** A character the chronicle embellished is drawn as the chronicle describes them. Hover shows the sigil the simulation actually generated. On most characters these are identical. On the ones that matter, they are not.

---

## 9. Heritable Attributes

Core attributes and eight Mystic affinities, inherited from both parents with regression to the mean and a fat tail for throwbacks. Recessives carry silently across generations.

> *(v0.2.2)* **The list is open.** This section said "twelve" and treated the count as load-bearing; it never was. An attribute is six loci and a description, the engine counts none of them, and **Fecundity** is the first addition — see below. What is fixed is the eight affinities, because the dyads and the Threshold restriction are a rule about the world (§7), not a list length.

**Eldritch Power is not one of them.** It is inherited differently, expressed differently, and exists nowhere outside the blood. It is described separately below and it obeys none of the rules above.

### Core
| Attribute | Function |
|---|---|
| **Strength** | Survival. Duels, war, plague, hard winters, childbirth. **Sexually dimorphic**: men are almost always the stronger, in about nineteen cases in twenty. The twentieth is a woman worth writing down. |
| **Charm** | The economy of options. Determines which suitor cards you are dealt. Compounds. |
| **Agility** | Escape, precision, ritual execution, certain Arts. |
| **Mind** | Capacity for Madness. Study speed and concurrent book capacity. |
| **Fecundity** *(v0.2.2)* | How readily children come, and how many a couple completes. Weighted **seventy-thirty toward the mother**, so a thin husband is a disappointment and a thin wife is the whole marriage. Nobody in the world has a number for it: they have a grandmother who bore seven and a cousin who bore none. |

**Why Fecundity is dimorphic in weight but Strength is dimorphic in level.** Strength differs *between* a man and a woman; fertility differs in *whose* it is. Both are one clause in the data — `dimorphism` on the attribute, `MOTHER_SHARE` on the fertility rule — and neither is a special case in the genetics.

### Mystic affinities

Eight, in four opposed pairs, in two groups. **The grouping is not cosmetic — it decides who can express what** (§7, §10).

**Elemental** — force applied to the world. Practised by men only.

| Pair | |
|---|---|
| **Fluid** ↔ **Thermal** | the tide and the fire |
| **Aero** ↔ **Terra** | the wind and the weight |

**Threshold** — the coming in, the going out, the seeing and the unseeing. Practised by both sexes.

| Pair | |
|---|---|
| **Life** ↔ **Death** | birth and the returned |
| **Light** ↔ **Darkness** | sight and concealment |

**Terra** is stone, foundation, burial, and load. It is the affinity of walls and of what is underneath them, which in this family is not a small subject.

**The split governs Mystic practice** (§12). A woman can learn, hold and work the four Threshold affinities, and cannot touch the Elemental four at all — those books are closed to her, not merely slow. Men practise all eight.

**Eldritch Power is a separate matter and obeys a harder law: men express it and women never do** (§7, §10). The two rules are independent, and the difference between them is the whole distinction between the taken magic and the given one. A woman of the deepest blood in the world can be a formidable Death-worker for fifty years and never have a single Eldritch manifestation in her life.

**Opposition is not exclusion.** A line can hold both halves of a dyad. It is rare, it is expensive, and the Arts it opens are the four the Church has bothered to name (§12).

**Sparse by design.** Most characters are zero in most affinities. A typical character has one or two nonzero; an exceptional one has three. Affinity gates which spellbooks can be learned at all, and how fast.

### Eldritch Power
The family's own inheritance. Exists nowhere outside the bloodline. **Dilutes when married outward** and cannot be replaced from any external source. Advancement depends on concentration and on rare upward mutation in progeny.

---

## 10. Madness and Mind

Mind is a **capacity**, not a cure.

- **Madness ≤ Mind** → contained. Reads as visionary, unsettling, brilliant. Grants bonus Eldritch Power and unlocks deeper spell tiers. This is good.
- **Madness > Mind** → overflow. Stillbirths, burned wings of the house, heirs who abdicate and walk into the sea.

Optimal play is to run Madness *right up against* Mind and hold it there. Players breed for Mind not to be safe, but to afford more Madness.

**Madness accrues from birth. Mind only develops after Awakening.** The unwoken *son* of hot blood is therefore the most fragile person in the house — pressure with no vessel.

Madness sources: concentrated blood, forced Awakening rituals, Vessel sacrifice, certain heirloom Burdens, ascension itself.

### Who can go mad

Madness is the overflow of Eldritch Power. It follows that only those who can hold Eldritch Power can accrue it, and the rule is exactly that plain:

> **A person can go mad if and only if they are capable of expressing Eldritch Power.**

Capability, not achievement. A boy of hot blood is exposed from birth, years before he wakes and decades before he manifests — which is the whole of the "pressure with no vessel" problem above. But the gate is absolute at both ends:

- **Women never go mad.** Not rarely, not with difficulty, not late. Never — at any concentration of blood, at any age, under any ritual, holding any affinity. They carry the font and cannot express it, and what cannot be expressed cannot overflow. Mystic practice costs nobody Madness, so a woman may work the Threshold Arts for fifty years at no risk whatever.
- **Mundane men never go mad either.** A son whose X carries nothing — the ordinary result of marrying outward — has no font to overflow. He is perfectly safe, and he is safe precisely because he is useless. Those are the same sentence.
- **Everyone in between is exposed, permanently, from birth.**

**The safe are the expendable, and the expendable are the safe.** The set of people who cannot go mad is exactly the set of people the family can send anywhere without risking anything that matters (§11) — the daughters and the mundane sons. Every person the house is actually counting on is, by definition, someone it can lose to the blood. There is no configuration of the family in which this is not true.

Note also what this does to the ladder. **Overflow Madness is involuntary** — it happens to men because of what they were born carrying. **The Madness the ascension ladder demands is purchased**, through forced Awakenings, the Vessel rite and ascension itself (§22). The God-candidate does not reach Madness 90 by accident. He buys it, knowing the price, which is the only way that number means anything.

### What follows from it

- **The library becomes women's work, because their years are uncontested.** A character has perhaps forty productive years, and for a man every one spent studying is a year not spent advancing the house (§12). A woman cannot advance it at all, so her forty years are free. Over five centuries the archive, the library and the chronicle drift into the hands of the people who had time to keep them — which is the mechanical reason the voice of the record keeps changing (§2), and why so much of what the family knows about itself was written by someone the law forbade to use it.
- **A Regency stops the clock.** A woman at the head accrues no Madness and draws less Church attention, so a Regency becomes a concealment window: eighty years in which Discrepancies age quietly toward settled legend and the heat goes out of things. Players will trigger one deliberately to launder a bad century. That is a correct read of the system rather than an exploit, and the balance pass should assume it.
- **Darkness is concealment, and women can work it.** This is the endgame (§17). A daughter with Darkness affinity is the house's answer to the last two centuries — the one person who can hide what it is doing from the people who would burn it for doing it. The women who write the chronicle are also the ones who can hide what is in it.
- **The blood takes sons before it takes daughters.** Overflow in the womb is a male outcome, because a daughter's second copy of the blood modulates what a son's single copy cannot. A hot line loses sons and keeps daughters, so a family drifts toward Regency exactly when it is closest to ascending — and the game never touches the coin flip to make it happen.
- **The Vessel rite is gendered by capability.** A relative incapable of expression — any woman, or a mundane son — transfers her attributes and carried blood with no Madness at all. Anyone capable transfers theirs in full and uncapped (§22). The family's safest sacrifice and its most valuable breeding asset are frequently the same person, described in two different words.

---

## 11. Awakening

Until a character Awakens, all power is written down and unreachable. Learning cannot begin.

| Window | Frequency | Notes |
|---|---|---|
| Before age 5 | Rare | Alarming. The child is treated as marked. |
| Ages 5–20 | Common | Bulge around puberty. |
| Ages 20–30 | Uncommon | |
| After 30 | Rare | **The Late Waking** — always a scripted moment. |
| Never | Real outcome | Permanent. Not a soft-lock. |

Higher Eldritch Power skews earlier *and* widens the tail. Prodigies and cripples come from the same blood.

**In daughters, Awakening is timed by what they carry rather than by what they can use.** An early-waking girl is therefore the one honest signal in a marriage market otherwise built entirely on forged documents — unfakeable, publicly witnessed, and worth more than any notarised pedigree. The great houses have all noticed that it works. None of them have a word for why.

**Awakening gates learning for women exactly as it does for men** — until she wakes, a daughter can study nothing, Threshold or otherwise, and every year she has not woken is a year of feeding and protecting someone who cannot yet be useful. What Awakening does *not* do is put her in danger. She wakes, she reads, she carries. The risk was never hers (§10).

### The Long Wait
Each year an unwoken child of promising blood is a year spent feeding, protecting, and not marrying them off. At some point the Head must **declare them mundane** and put them to use — freeing the succession, risking disaster.

### The Unwoken
Cannot learn, ascend, or lead. They are also the only members who can safely be sent anywhere: fostered, married out, given to the Church, sent to war. A dynasty of the woken has no expendable hands.

### Forcing It
Rituals — the Vigil, the Drowning, the Dark Year — provoke early Awakening. Each raises Madness permanently, carries a real chance of killing the child, and works often enough to tempt. Heirloom Burdens offer cheaper, worse versions.

A house that forces every child burns out by generation 25. A house that never forces loses decades it cannot afford.

**Ritual knowledge is chronicle-gated.** The *true* cost of each ritual is learned once, by paying it. If that generation Records it, descendants see the real numbers. If they Omit it, the ritual reverts to a vague, tempting description, and a great-great-grandson finds out the hard way. This is the clearest place the record mechanic bites.

---

## 12. Two Magics, Two Economies

Deliberately built at opposite ends of the scientific–numinous spectrum. One exists so the player can be clever. The other exists so the player can be frightened.

### Mystic power is taken — the rigorous system
Every spell is learned from a spellbook, at roughly a year of a life. Affinity is a gate, not a discount: below threshold the book cannot be learned at any duration. Mind sets read speed and concurrent capacity. Madness makes study erratic.

Fully legible. Costs stated in years and coin. The player can plan four generations of it on paper, and should be able to. **The numbers must actually be run** — study durations, affinity thresholds, and library degradation should survive a spreadsheet, because a subset of players will build one.

A character has perhaps 40 productive years. **Every spell learned is a generation not advanced.**

### Eldritch Power is given — the numinous system
Arrives unbidden, costs nothing, cannot be sought. Spells manifest spontaneously: affinity profile determines *which* are possible, Eldritch Power determines *which tier* is rolled, Madness determines *how often* the roll happens.

**Design rule, non-negotiable:** the player must never gain reliable control of it. No cooldown, no button, no manifest-on-demand at any tier. The moment Eldritch Power becomes a tool, the wonder dies and the game becomes a spreadsheet with a skull on it. Manifestations are always narrated as events that happened *to* the family, and are among the few things the chronicle can be wrong about in the player's favour.

### The interface
The University-equivalent here is the family library and the Church's grudging tolerance: an institution that teaches the rigorous system, gatekeeps the numinous one, and can ruin you for practising it. The argument between mechanism and mystery *is* the setting.

### Multi-affinity Arts
| Combination | Domain |
|---|---|
| Thermal + Aero | Storm, ash-wind |
| Life + Death | The returned, the un-buried |
| Light + Darkness | Thresholds, unseeing, doors |
| Fluid + Death | Drowning-sickness, the tide that takes |
| Life + Fluid | Flourishing, plague-breaking |
| Terra + Death | The barrow. What stays down, and the foundations that remember it |
| Terra + Thermal | The forge, glass out of sand, the slow burn under stone |
| Terra + Life | Root and harvest; the house that grows into its own ground |

A suitor with a single high affinity isn't weak — she's the missing half of something.

**The four opposed-pair Arts** — Fluid+Thermal, Aero+Terra, Life+Death, Light+Darkness — are the ones the Church names in its liturgy. A family that holds one has, by definition, been marrying carefully for a long time, and everyone can see that it has.

### Named Arts
Roughly one per run. Permanently recorded under the name of the person who first held it, inheritable by descendants meeting the affinity threshold. This is how a family accumulates a canon.

**Women can found the canon.** Life+Death and Light+Darkness are both Threshold pairs, so a woman holding either dyad can produce an opposed-pair Art on her own — two of the four the Church names. Over five centuries a house can end up with its greatest Arts named for women, inherited and used by men who did not make them, and recorded in a chronicle those same women wrote. The game does not need to comment on this. It only needs to let it happen and then print the names.

*(new)* **Named Arts generate songs.** Each one seeds a nested tale that circulates in the world, mutates over centuries, and is eventually sung back to the family in a version they do not recognise. A Named Art recorded truthfully produces a song that helps. One embellished produces a song that is better, more famous, and false — and rival houses will try to make the family perform it.

### The Library
Spellbooks persist and are inheritable — a great-grandfather's purchase can pay out for centuries. They also burn, are stolen, are demanded as tribute, are sold in desperate winters, and **degrade** (adding years to study time; restoration is its own expense).

---

## 13. Money

Money is worldbuilding, not just resource. Prices are fixed, quoted constantly in event text, and small enough to feel.

**Coin:** 1 crown = 20 marks = 240 mites.

| Thing | Price |
|---|---|
| A day's bread, one person | 2 mites |
| A night at a decent inn | 8 mites |
| A servant's yearly wage | 3 marks |
| Standing cost, per living family member per year | 1 crown |
| Raising a child, per year, birth to 20 | 1 crown |
| Special education, one attribute, full term | 40 crowns |
| Post-Demigod Ledger search, one clause | 40 crowns |
| A minor spellbook at auction | 60–200 crowns |
| A foreign-affinity or high-tier book | 400–1,200 crowns |
| Typical income at **Regarded**, per year | 55–70 crowns |

**Income** derives from holdings, modified by the Head's Charm and family Respect. **Investments** run on multi-generational payoff curves. **Shocks** — plague, fire, war levies, litigation, debts called in.

**Key tension:** special education competes directly with the auction. Tutor the child you have, or buy the book his grandchildren might read. Both are correct; you can afford one.

---

## 14. The Auction

Rare — once every two or three generations. Announced years ahead so the player can liquidate, borrow, or start planning something regrettable.

**Stock:** spellbooks (often foreign affinities you don't have — bought for grandchildren not yet bred), heirlooms, contracts and debts, occasionally a person (a ward, a hostage, a marriage right), and *(new)* **pages of other families' chronicles**, which is how Discrepancies get proven.

**Bidding is against named rival houses with visible motives.** House Marrow always wants Death texts. The Church bids on Light and burns it. Knowing who wants what lets you drive prices up on enemies.

**Bid currencies:** coin, favours owed, heirloom trade, or **marriage promises** — pledging a granddaughter not yet born, to acquire a book for an affinity nobody in the family has, on the theory that the blood will come. Sometimes it does.

The auction is how a Regency still makes progress: the regent cannot advance ascension, but she can buy the library that makes her grandson inevitable.

---

## 15. Heirlooms

| Type | Example | Function |
|---|---|---|
| **Instruments** | A focus, a rod, a mirror | +affinity, or lowers a book's threshold — lets a weak line read above its blood |
| **Regalia** | Ring of the house, the Nine-Fold Seal | Head only. Feeds Head challenges. Required for Demigod. |
| **Burdens** | A sealed thing, a debt, something that watches | Powerful. Wants something. Cannot be sold. |

Every heirloom carries **two histories**: what it is, and what the chronicle says it is. Burdens in particular acquire flattering biographies over centuries, which is how a family forgets what it is keeping in the east cellar.

---

## 16. The Cast Slots

Recurring narrative roles, refilled with new people every few generations, so the family's history rhymes. Event authors write to slots, not to individuals.

| Slot | Function | Notes |
|---|---|---|
| **The Tutor** | Warm, funny, competent, teaches fundamentals, dies or leaves before the heir matures | His lines become the family's aphorisms, quoted in the chronicle for centuries by people who never met him |
| **The Match That Never Comes** | A suitor card that appears across multiple generations and can never actually be drafted | Different woman each time, same house, same impossible terms. The family's great might-have-been |
| **The Rival** | A named opposite number, personally vicious and **correct about your arrogance** | Fed by class, not temperament. Their chronicle is buyable at auction |
| **The Cadets** | Cadet branches: loyal, funny, warm, and increasingly aggrieved | The reader's rest stops. At least one has a wound the Head is too busy to notice |
| **The Fragile One** | The damaged prodigy. Speaks in slant-logic. Represents the numinous system pushed too far | Always a boy — only those who can express can break (§10). Handle with tenderness. Never explain him. The obvious Vessel, which is the point |
| **The Two Listeners** | In 1542: one wants the record accurate; one wants the family to survive the night | Opposed agendas. They argue about the chronicle in front of the player |
| **The Board** | The Church of the Nine Quiet Names, the Assembly, the archivists | A committee of specialists, each reducible to one memorable trait, who periodically judge you |

---

## 17. Respect and Concealment

Five tiers, gating categories rather than granting bonuses.

| Tier | Opens |
|---|---|
| **Unknown** | Nothing |
| **Known** | Minor houses will marry you; basic auction access |
| **Regarded** | Good suitor cards; credit; sealed auction lots |
| **Eminent** | Great houses; Church looks away once per generation; hostage-free negotiation |
| **Exalted** | The finest blood in the world offers itself; **the Ascension rites become socially possible** |

**A demigod cannot be made in secret.** The rites require witnesses and sanction. A blood-perfect, book-rich, universally despised house stalls at Hierophant permanently.

Respect **decays** without maintenance — a quiet generation costs a tier. **Visible Madness burns it fast.**

The endgame squeeze: you need enormous Madness to ascend, Respect to be allowed to, and Madness destroys Respect. The last two centuries become an exercise in concealment — which, since v0.2, means an exercise in **authorship**. Every Respect point bought by embellishment is a Discrepancy waiting to be proven at the worst possible moment.

*(v0.2.1)* **Concealment has a second instrument, and it is a person.** Darkness is the affinity of not-being-seen, and it is a Threshold affinity, which means daughters can work it (§9–10). A house entering the squeeze with a Darkness-affine woman alive has an answer to the Church that a house without one does not. She is not a stat — she is a specific relative, she can die, she can be married away by a Head who did not think it through four generations ago, and she can be demanded as a hostage by people who have worked out what she is for. Losing her at year 1900 should be one of the worst things that can happen to a run, and the player should see it coming.

### Careers
Purchased placements, chiefly for the Unwoken.

| Career | Respect | Income | Cost |
|---|---|---|---|
| Military | High | Variable | Kills people |
| Clergy | High | Steady | Removes them from the breeding pool; grants Madness cover |
| Court | Moderate | Low | Charm growth, better suitor cards |
| Merchant | Low | High | — |
| Scholar | None | None | Faster study |

Note the shape: the careers that pay Respect cost you either the person's body or their bloodline. **Respect is bought with descendants.**

---

## 18. The Counterparty — the Mythic Antagonist

Built to the mythic-antagonist model: appears once, then exists only as folklore.

- **On screen twice in five centuries.** The prologue, and the last night. Nothing between.
- **Never described directly.** Known by displacement and omen: iron that rusts overnight, milk that turns sweet, the smell of wet ash indoors, a sound like a page turning in an empty room, dogs that will not enter a room they have slept in for years.
- **Denied by educated society.** Scholars hold that the 1042 contract is a provincial forgery. The Church holds that the entity is a peasant superstition, and simultaneously maintains a liturgy against it, and has never been asked to explain why.
- **Has nine names, and they contradict.** The Church of the Nine Quiet Names exists to keep them quiet; doctrine holds that the naming *is* the ward. Rival traditions hold that the nine are nine different things, or one thing lying about itself eight times.
- **The player's epistemic quest comes first.** For the opening two centuries the goal is not to beat it. It is to establish that it exists, against an institution that would ruin you for saying so.

### The Ledger — scheduled payoff
The single largest structural risk in this design is **promise debt**: opening a five-century mystery and paying nothing until the last act. The fix is mechanical.

The contract has **nine clauses**. The player begins knowing one.

- **Every clause-bearing Age reveals exactly one clause through the normal cadence.** Not a hint — a hard fact, entered in the chronicle in the contract's own hand.
- **Late archival exception (#185).** Once a successful Unmaking recipient has actually attained Demigod, a living archivist or chronicler of the house may be paid **40 crowns** to search the old contracts for the lowest-weight unrecovered clause, at most once per year, while the house knows fewer than the seven clauses God requires. This is a deliberate player order, never automatic; all nine clauses, the ordinary Age cadence, and the seven-clause God gate remain intact.
- Clauses are **not** flavour. Each one changes what is legally and mechanically possible at 1542: what counts as payment, who may be substituted, whether a Demigod is a person, what happens if the family line ends before collection.
- A run that reaches 1542 having recovered three clauses has a genuinely worse endgame than one that recovered eight — and the player will have felt that lack coming for a century.
- **The answers are written before the game ships.** All nine clauses, and the true nature of the counterparty, exist in the design bible on day one. Nothing is left to be decided later.

---

## 19. Nested Tales

The world talks about the family, and the world is wrong, and the wrongness is content.

**Forms:** tavern songs · rival house chronicles (buyable) · Church doctrine and sermons · a children's counting rhyme that lists the Nine Names in the wrong order · a travelling play · a scholar's dismissive footnote · a hedge-witch's warding charm that happens to be correct.

**Rules:**
1. Every nested tale is performed by someone with a motive. The teller is always named and always biased.
2. Any event of consequence has **at least two surviving accounts, which disagree**. The player has access to both and to the simulation's actual outcome, which is often neither.
3. The game never adjudicates in its own voice. There is no narrator who knows the truth.
4. Nested tales **rhyme with the player's arc without commenting on it**. The ballad about the house that fed its own daughter to a door is not about you. It is about a family four hundred years dead. It is about you.

### Rumour
*(new mechanic)* Every Age generates one **Rumour** about the family — derived from what actually happened, distorted by distance, and coloured by what the chronicle claims. Rumours are visible to the player, affect suitor card quality and Church attention, and can be **fed** (cheap, raises Respect, deepens the Discrepancy) or **corrected** (expensive, costs Respect now, closes an exposure).

This is the picaresque-to-legend pipeline made literal: the player watches events happen, then watches them become songs.

---

## 20. Ages as Episodes

An Age is a rules patch on the world. Each modifies at least three of: income, Respect, marriage market, auction stock, mortality, Awakening rate, Church attention.

**Ages arrive by chance and end by chance.** There is no calendar for the player to learn. Each Age carries an onset weight and a per-year chance of ending, so the same Age runs a different length in every run — a Wars can burn itself out in twenty years or grind on for eighty, and the family has no way to know which one it is living through until it is over. Planning under that uncertainty is the point: the question is never *when does this end*, it is *do I spend now or hold*.

**Duration is a property of the Age, not a global band.** Tempo is how Ages differ most, and a run that draws three short violent Ages back to back should feel nothing like one that draws two long ones.

| Age | Typical span | Effect |
|---|---|---|
| **The Long Peace** | 60–150 | Income up, mortality down, Respect stagnant. Military careers worthless. Everyone breeds. Ends with too many mouths and no standing. |
| **The Wars** | 15–60 | Military Respect enormous. Sons die. Levies gut income. Auctions flood with looted books — best buying window in the game. |
| **The Crusade** | 30–90 | Church attention permanent and doubled. Madness detection severe. Light and Life are safe; Death and Darkness are a death sentence if seen. |
| **The Insurrection** | 10–40 | Great houses collapse. Respect tiers reshuffle. Ruined nobility with excellent blood marries downward in desperation. |
| **The Withering** | 40–120 | Awakening rates fall globally. Fewer books circulate. A generation may pass with nothing gained. |
| **The Quickening** | 20–60 | Awakening early and common everywhere. Rivals ascend too — the ladder gets crowded. |
| **The Plague** | 5–25 | Mortality catastrophic, weighted against low Strength. Life affinity becomes the most valuable thing in the world. Small families die out. |

Spans are the middle of the distribution, not its edges. A twelve-year Wars and a hundred-year Wars must both be possible or the player will learn the band and plan against it.

**Rules:**
1. **Ages are named late.** The player feels two decades of effects before the chronicle gives it a name.
2. **Ages overlap.** Two-Age stacking is uncommon and memorable.
3. **Ages are the difficulty curve.** The final fifth of the run draws from the harsh table — cold and institutional registers at triple onset weight, warm at a third — so the family should nearly always be inside a Crusade, an Insurrection or a Plague on the night the creditor arrives. *(#133)* The rule is **relative**, and the number that used to be written here was not: it said *the final 200 years* when the run was a millennium and the harsh table opened after 1842. Halving A Long Line moved the window rather than stranding it past collection — it is now the hundred years after **1442** — and `LATE_PHASE_FRACTION` in `packages/core/src/campaign.ts` is the one place the fifth is written down.
4. *(new)* **Every Age must pay its debts.** An Age is not authored until it delivers all three:
   - **One Ledger clause** — a hard fact about the contract (§18)
   - **One standing change** — the family ends the Age materially richer, poorer, more feared, or more exposed than it began
   - **One Rumour** — a story about the family that enters the world in distorted form (§19)

   An Age that delivers none of these is a beautiful two hundred years in which nothing happened, and it is exactly the failure that makes long games feel like drift.

   *(v0.2.1)* Since Ages can now be short, **clause reveals fire on a schedule measured from the Age's start, never from its end** — a twelve-year Plague must still be able to pay. Ages that cannot reliably carry the freight are marked **non-clause-bearing** and excused from the first requirement; they still owe a standing change and a Rumour, which are cheap enough to deliver in a decade.
5. *(v0.2.1)* **Some events belong to one Age and to nothing else.** An Age is not really a rules patch — it is a *setting*, and a setting that shares all its content with every other setting is a modifier with a name. The Wars needs scenes that can only happen in a war: the levy at the door, the son who comes back wrong, the auction stall selling a dead man's library. Age-exclusive content is what makes an Age feel like somewhere rather than a number.

   **The corollary is a real production risk.** Short Ages starve their own content: fifteen exclusive events in an Age that lasts twenty years means the player sees three of them and the other twelve were never written for this run. Two mitigations, both mandatory. Age-exclusive events take a **priority boost** while their Age is active, ahead of ambient content — an Age's own scenes are the reason it exists. And fire rates for them must be measured **conditional on the Age being active**, never globally, or the CI gate will condemn perfectly good content for the crime of belonging to a rare short Age.

**Historic Ages** — one or two per run, seeded, non-repeating, named in the chronicle forever. *The Burning of the Nine Libraries*: every spellbook not held by your family is removed from the world. What you own becomes irreplaceable, and every rival wants your library.

**Alternate the register.** Never two Ages of the same texture consecutively: warm/prosperous → cold/lethal → institutional/political. The scheduler enforces this.

Ages force optimisation *across* generations rather than within one: sitting on coin through a Peace because a Wars is overdue; holding a daughter unmarried because an Insurrection will put better houses in reach.

---

## 21. Challenges

**Individual** — resolved against one person's attributes. A duel (Strength/Agility), a seduction (Charm), a spell that slips its leash (Mind vs Madness). Outcomes change that person, sometimes permanently.

**Head** — resolved against the patriarch alone; he must personally be present. Oaths, rival houses, the Church asking pointed questions. A frail patriarch is a liability the whole family feels — which is why you cannot breed purely for Eldritch Power and ignore the body.

**Family** — resolved against a pool: total Strength across all living members, the highest Mind in the house, whether *anyone* holds Life affinity when the plague comes. These punish over-specialisation. Twenty generations chasing Darkness and Death, and then a fire, and nobody can call water.

**Record** — *(new)* resolved against the chronicle rather than against people. An archivist requests the family's papers. A rival produces a page. A Church inquest compares your account of 1341 with three others. Wins and losses here are paid in Respect and in exposure, and they are the only challenges a Regency can fight at full strength.

---

## 22. The Ascension Ladder

### 1. Touched — *awakened, and it took*
**Gate:** Awakening occurs · Eldritch Power ≥ 10
**Cost:** None. Baseline, not achievement. No Touched male = Regency.

### 2. Adept — *the blood does something*
**Gate:** EP ≥ 25 · 3 spells · Madness ≤ Mind
**Cost:** The years of study
**Unlocks:** May hold Regalia. Eldritch manifestations become frequent — never reliable.
*Typical arrival: generation 3–5.*

### 3. Hierophant — *the world notices*
**Gate:** EP ≥ 50 · 8 spells across ≥3 affinities · 1 Named Art in the family · Respect ≥ Regarded · **Madness ≥ 20** and ≤ Mind
**Cost:** A public rite. Failure costs a Respect tier.
**Unlocks:** Head may sanction rituals. Sealed auction lots.

Note the Madness *floor*. From here up, a placid mind cannot ascend.
*Typical arrival: generation 10–15. This is where most first runs die — at the Respect wall, having bred beautifully and offended everyone.*

### 4. The Vessel — *the rung nobody expects*
**Gate:** EP ≥ 70 · 15 spells · 2 Named Arts · Mind ≥ 70 · Respect ≥ Eminent
**Cost:** **A living family member of the blood, willingly given.** Named, chosen by the player from the tree. Consumed. Their attributes are added to the ascendant's. The tree shows them greyed, with a mark that is not the mark for death.

The Vessel's Madness transfers **in full and uncapped**. Sacrificing your most gifted, most damaged relative is the strongest play and the worst idea.

**What the ascendant gains, he cannot pass on.** A Vessel's blood enters the man, not the line — his own children inherit exactly what they would have inherited had the rite never happened. This is why a family cannot ascend by consuming its way upward: every generation has to be *bred*, and the rite only decides who gets to spend what the breeding produced. Note also that a relative *incapable* of expression transfers no Madness (§10) — which makes a daughter the safe Vessel and, because she is also the family's vault, the expensive one.

*(new)* The Vessel generates a mandatory Record choice with no good option: record it and lose two Respect tiers, or omit it and create the largest Discrepancy in the game — one that the Church spends the remaining centuries trying to prove.

### 5. Demigod — *the hinge*
**Gate:** EP ≥ 85 · 25 spells across ≥5 affinities · 4 Named Arts · Respect ≥ Eminent · Madness ≥ 60 and ≤ Mind · **the Regalia complete** (all three founding heirlooms held simultaneously — most runs have lost at least one, so this is often the real gate)
**Cost:** A Great Rite requiring Church sanction *or* open defiance. Defiance sets the Church permanently hostile.
**Effect:** Ageing stops. Death by violence or Madness overflow only. Reaching Demigod is a life event, not a reading that can be revoked: if current standing later falls, ageing does not restart.

**Demigod Stagnation:** each generation he remains Head, Respect decays faster and a Discontent counter rises. High Discontent seeds Insurrection events *inside the family* — cadet branches with grievances and their own libraries, and their own chronicles, which contradict yours.
*The old year-550–700 target predates the 500-year Long Line; its arrival target needs measurement against the current term.*

### 6. God — *the Ledger closes*
**Gate:**
- A **living** elder in the family who has reached at least Hierophant and completed both the Vessel and Great Rites
- A **separate**, adult blood descendant capable of expressing Eldritch Power, chosen before the Unmaking; the elder's completed rites pass to him when the elder is sacrificed
- The descendant's own EP ≥ 98; living members of the family, including spouses in its halls, together have read enough distinct books for the final reading gate and know **all eight** affinities to form the last working
- Respect ≥ Exalted
- Madness ≥ 90, Mind ≥ Madness — the narrowest window in the game
- **At least seven of the nine Ledger clauses recovered**
- The Ledger settled: the 1042 debt paid, broken, or assumed

**Cost:** The elder who completed both rites. He is unmade to raise the younger, passing on part of his born font and channel as well as the power he acquired. Chosen — or resisted, in which case it is a fight, and the whole run can be lost at the final step. The descendant must still clear the personal power, Mind and Madness gates after the rite; living family readers supply the book and affinity gates. An absent or dead reader cannot stand in the circle.

### Why the shape works
Each rung escalates a different axis, so no single strategy carries you: early rewards breeding, mid rewards patience and the library, Hierophant rewards diplomacy, Vessel rewards ruthlessness, Demigod rewards *preservation*, and God rewards a family deep enough to sacrifice an elder who climbed, raise a descendant who can bear what he leaves, and keep the eight arts alive among the blood — and honest enough, somewhere along the way, to have written down what it actually did.

The terminal irony: the elder's climb is necessary and insufficient. **A dynasty that concentrates everything into one perfect patriarch cannot ascend.** It must raise a successor and keep living readers of every affinity; when the elder is unmade, the house must still know what he did not.

---

## 23. Endings as the Ring

Every ending replays the prologue's three-part structure with **exactly one element changed**. Same cadence, same three beats, one substitution — that is where the whole five centuries lands.

| Ending | Condition | The element that changes |
|---|---|---|
| **Apotheosis** | A god is made | The third part of the triad is no longer a debt. The final page is written in a hand that is not human, and it is legible, which is worse |
| **The Unmade** | The God rite fails at the last step | Both titans gone. The house is quiet in exactly the way it was quiet in 1042, and a mundane cadet cousin is sitting where the founder sat |
| **The Broken Line** | Madness overflow takes the family before 1542 | Nobody is at the table. The creditor reads the chronicle alone |
| **The Forgotten** | You survive to 1542 having never passed Adept | The creditor arrives, reads, and does not collect. Survival as anticlimax. The worst ending, and it does not feel like losing until the last line |
| **The Devoured** | The Ledger comes due with a Hierophant or Vessel at the head | Strong enough to be interesting to it. Not strong enough to refuse |

**In all five,** the closing text is assembled from the chronicle the player wrote — including the omissions, which print as dated blank lines. The last thing on screen is a short, plain sentence that reaches back to the prologue's final line.

---

## 24. Presentation

- **Ink-on-vellum.** Two typefaces, three colours, marginalia, drop caps.
- **No faces.** Heraldic sigils only. One artist, infinite portraits, and sigil drift across five centuries becomes its own quiet art piece.
- **The chronicle** is a persistent, scrollable, searchable document that grows the entire run. It is the artefact players will screenshot — and since v0.2 it is also the thing they will lie in.
- **Audio:** sparse. Page turn, seal, bell. Ambient drone that shifts by Age.
- **The frame is quieter than the tale.** 1542 interludes drop to two colours, kill the drone entirely, and slow the text reveal. The player should feel the temperature change before they read a word.
- **Voice discipline.** Tale text is written to `.claude/skills/rothfuss-prose/reference/prose-manual.md`: plain concrete words, sound and temperature before sight, absence used to describe rooms, paragraphs landing on a short unexplained sentence, one aphorism per two or three screens and no more.

---

## 25. Event Authoring Doctrine

**The real cost is event authoring, not systems.** Budget 300–500 event templates for a run to feel non-repetitive. The game is a content problem wearing a systems costume.

### The three-purpose rule
Adapted from Rothfuss's own revision method — breaking chapters into **French scenes** (a new unit every time someone enters or leaves) and asking what each is for.

> **Every event template must declare three purposes in its metadata. The editor refuses to save one that declares fewer.**

Legal purposes: advance a Ledger clause · change a relationship · deliver worldbuilding through action · establish or test a rule of magic · change material standing · plant a detail that becomes a Rumour · offer a Record choice with no clean option · be funny enough to buy patience for the next slow chapter.

### The duplicate sweep
The editor reports templates sharing all three purposes. Rothfuss's discovery on his own draft was that he had written the same scene repeatedly — several scenes whose only job was showing the protagonist was clever. Our equivalent failure is the event whose only job is *the family is formidable*. Cap those at one per Age and cut the rest.

### The repeated 10% cut
Not a one-time pass. After each content milestone, cut 10% of event text, then leave it for a month and do it again. Each pass exposes structure the last pass hid.

### Test-read discipline
Rothfuss circulated his manuscript to 60–80 readers before it sold. Our analogue: **every event template is read by three people who did not write it**, and any template that needs the author present to make sense is rewritten.

---

## 26. Changes from v0.1

| # | Change | Reason |
|---|---|---|
| 1 | Added the 1542 **frame** and interlude cadence | The run needed a promise to be read against |
| 2 | Added the **prologue triad** and playable 1042 signing | Opens on a state, not a tutorial; puts the antagonist on screen exactly once |
| 3 | **Chronicle is now player-authored and unreliable** (Record / Omit / Embellish, Discrepancies) | Makes the legend-vs-truth thesis mechanical rather than thematic |
| 4 | **Ledger split into nine clauses, one per Age** | Kills the promise-debt failure — the mystery now pays out on a schedule |
| 5 | Codified the **one permutation** and its social consequences | Worldbuilding descends from one law instead of being invented piecemeal |
| 6 | Fixed the **price table** | Pressure requires arithmetic the player can feel |
| 7 | Added **Cast Slots** | Gives event authors recurring roles so five centuries rhyme |
| 8 | Added **Rumours** and the nested-tale rules | The picaresque now visibly manufactures the legend |
| 9 | Ages must now pay **clause + standing + rumour** | Prevents beautiful centuries in which nothing happens |
| 10 | Added the **Record challenge** type | Gives Regencies a fight they can win at full strength |
| 11 | Endings recast as **variations on the prologue** | Closes the ring; makes the last line land |
| 12 | Event editor enforces **three declared purposes** | Rothfuss's revision method moved upstream into authoring |
| 13 | Eldritch Power explicitly **may never become reliable** | Protects the numinous half of the magic design from optimisation |

---

## 27. Design Risk Register

- [ ] **Frame with no function.** Do the 1542 interludes complicate the tale, or just look mysterious?
- [ ] **Promise debt.** Is every one of the nine clauses written, and is each assigned to an Age?
- [ ] **Spine stall.** Chart clause recovery per 200 years. Any flat stretch is a redesign, not a tuning pass.
- [ ] **Formidability spam.** Count templates whose real purpose is *the family is impressive*. More than one per Age is too many.
- [ ] **Numinous drift.** Any feature request that makes Eldritch Power schedulable is rejected on sight.
- [ ] **Costless rigour.** Any Mystic spell without a stated cost in years and coin.
- [ ] **Motif inflation.** Threes are load-bearing here (three silences, three Regalia, three purposes, nine names). If everything comes in threes the pattern stops meaning anything.
- [ ] **Record mechanic as pure stat.** If players resolve Record choices without reading them, the choices are not costing enough.
- [ ] **Unwritten ending.** The counterparty's true nature must exist in the bible before vertical slice.
- [ ] **Pride as a penalty.** Bin runs by bearing (§29). High-bearing runs must reach *higher* rungs on average **and** fail harder. If they only fail harder, bearing is a difficulty setting and players will play around it instead of feeling it.
- [ ] **The named flaw.** Any player-facing string containing *pride*, *arrogance*, *hubris* or *vanity* is a design failure and not a wording one. It is a lint rule, not a review note.

---

## 28. Production Notes

**Build the event editor before the game.** See the accompanying technical brief. Add the three-purpose metadata field and the duplicate sweep to its requirements.

**Deterministic core.** A pure, seeded simulation module with no UI dependencies allows headless batch runs — large deterministic batches in CI to check ascension rates, median Regency onset, Madness curve divergence, and *(new)* clause-recovery distribution and Discrepancy exposure rates. For a multi-hour generational campaign, this is the only viable balance method.

**Two writers minimum, and they must sound different.** Chronicler voice changes by century; that is a feature, and it is cheaper to get from two people than from one person imitating themselves.

**Reference points:** Wildermyth (event templating), Crusader Kings (succession pressure), Cultist Simulator (tone and opacity), Roots of Pacha and Wildermyth (price positioning, NZD $28–35). *(new)* Kentucky Route Zero and Disco Elysium for unreliable-record presentation.

---

## 29. Bearing — the Flaw the House Does Not Name

*(v0.2.2)*

The story manual lists **Pride** among the components the protagonist is built from — *"the house knows what it is, narrates it ruefully, and does it again."* It is named the fatal flaw, and it has never been anything but a line in a character blurb.

Every other component on that list is already mechanical. The extraordinary talent is a genome. The catastrophic loss is the signing. The performer's instinct is the Record block (§6). The chronic under-resourcing is the price table (§13). Pride is the only one that stayed a theme, and a theme no system reads is decoration.

This section gives it a mechanism. It gives it no name.

### 29.1 The rule that makes it a moral and not a tax

**Pride is usually correct.** It is how a house climbs.

Refusing a hand that is beneath the house is right. Keeping the Darkness-affine daughter off the market is right — §17 says losing her at 1900 should be one of the worst things that can happen to a run. Embellishing buys the Respect the rites are impossible without (§17, §22). A player has to be able to be proud, and be right, forty times.

If pride is a penalty, it is a difficulty setting, and a player identifies a difficulty setting inside an hour and plays around it rather than feeling it. The moral only lands when the forty correct decisions and the one ruinous one are *the same decision*, taken forty-one times, with no way to tell in advance which one this was.

That is also the honest version of the theme. Nobody's house is destroyed by being proud once.

### 29.2 Bearing — a reading, not a resource

**Bearing** is how the house carries what it has, as distinct from what it has. It sits beside the Assize's `pressure` and is built the same way: derived, recomputed every year, explicit in its consequences, and never surfaced as a number.

The Assize asks *how is this house doing?* Bearing asks *how is it taking it?*

| The act | The verb it already is | What the country calls it |
|---|---|---|
| Writing the family larger than it was | Embellish (§6) | a house that believes its own songs |
| Refusing a hand as beneath the house | declining the Match (§5) | they would not have him |
| Keeping somebody off the marriage market | a standing order at the table | the vault they will not open |
| Taking the cousin card with an outside card on the table | the Match (§5, §7) | they will not dilute |
| Leaving a cadet hall's grievance standing | branch grievance (§16) | the brother nobody wrote to |
| Holding the seat past a long tenure | Demigod Stagnation, Discontent (§22) | he will not be told he is old |
| Buying standing in a year the hall is short | careers, the auction (§14, §17) | a new coat and no roof |

Nothing new is asked of the player. Something finally reads what the player already does.

### 29.3 It bites three times, and always late

**One — the world stops offering.** High bearing thins what the Match deals: fewer outside houses send a card, and the ones that do send worse ones, until the cousin card is the only card on the table.

This is the whole moral in a single loop and it requires no text at all. §7 already establishes that cousin marriage is *not a temptation, it is the mechanism*. Bearing makes it also a **consequence**: the pride that refuses to dilute the blood is precisely what forces the marriage that ruins it. The player does not read a moral. The player runs out of options, and does not immediately know why.

**Two — the house stops being told.** A proud house is a house nobody brings bad news to. Bearing suppresses the warning: the retainer who would have said something does not, the steward's objection is not made, the cadet's letter is not answered. The player experiences a stretch of bad luck. The chronicle records something else — that the letter was sent, and was not read, and that this is the third time.

This one needs a guard rail. Withholding information is only fair if the withholding is itself eventually recoverable, so **every warning suppressed leaves a trace the player can find later**, most naturally in a rival's account of the same year. Suppression with no recoverable trace is indistinguishable from bad dice, and it teaches the player nothing except that the game cheats.

**Three — the record is read back.** Already specified and already built. Every embellishment is a Discrepancy with a name on it, and at 1542 the creditor reads *the chronicle* rather than the simulation (§6). A house that arrives exalted, revered and unable to prove one thing it needs to prove is pride's final bill, and it is exactly the shape §6 already describes. It needs no new mechanism — only the last night to exist.

### 29.4 Five rules of subtlety

1. **Never name it.** No stat, no meter, no bar. No player-facing string in the game contains *pride*, *arrogance*, *hubris* or *vanity*. This is a lint rule, so that it is still true at the six-hundredth template.
2. **Pride must usually be correct.** §29.1. This is the load-bearing one; the other four are hygiene.
3. **It never costs on the day.** Two generations minimum between the act and the bill.
4. **Only other people say it.** A rival's chronicle, a rumour, a cadet's line, the Rival slot who is already written as *personally vicious and entirely correct about your arrogance* (§16). And the game never adjudicates: one circulating tale calls the house proud, another calls it dignified, and both stand. There is no narrator who knows.
5. **Reversible by act, never by apology.** Appease a hall. Take a hand you were offered. Record something true that costs you a tier. There is no humility button and no atonement event.

### 29.5 The motif — the long gallery

Motifs darken or they are wallpaper. Pride gets one image, tracked across the Ages, that the game never explains: **the family looking at itself.**

| Reading | | Register |
|---|---|---|
| Ages 1–2 | The house hangs its founder in the long gallery, and there is a great deal of wall left. | tale |
| Ages 3–5 | A cadet notices his branch is not on the wall. He is told there is no room, which is true, and that a place will be made, which is not. | tale |
| Ages 6–8 | A Head has someone taken down. The chronicle does not say who, and two rival accounts disagree about it. | tale |
| 1542 | The wall is full. The last of the line walks the length of it to reach the table, and sits down opposite something that does not have a face. | frame |

The third reading is where the motif joins the record layer instead of merely commenting on it: *the chronicle does not say who* is an omission, and omissions print as dated blank lines (§6).

**The register split is live here.** Three tale-layer readings in plain Rothfuss, one frame reading in the Dunsanian register — one image crossing the boundary, which makes this the likeliest place in the game for register bleed. The temptation is to let the last reading's diction leak backwards into the third. It must not.

### 29.6 The counter-example is not optional

If the modest house simply wins, bearing is a difficulty setting wearing a theme's clothes.

The modest house has to lose too, and differently. It marries outward, it dilutes, it keeps every friend it ever made, it offends nobody, and it stalls at Adept with a full hall and nothing in the blood. That is **The Forgotten** — the ending §23 already calls the worst one, *and it does not feel like losing until the last line*.

Pride is how you climb. That is what makes it worth warning about, and it is why the warning is never spoken.

### 29.7 How it is known to be working

This codebase fails by doing nothing, and a theme fails the same way — silently, looking exactly like a simulation that works.

- **The variance test.** Over a batch, binned by bearing: high-bearing runs must reach *higher* rungs on average **and** show materially higher variance in outcome. Mean alone cannot distinguish a moral from a penalty; the asymmetry is the whole measurement.
- **The lint rule.** Zero occurrences of the four words in player-facing content, failing the build.
- **Reconstructability.** For every run that ends badly under high bearing, the chain from act to consequence is recoverable from the chronicle alone, with no reference to world state. If it is not in the chronicle, the player cannot have learned it.
- **The Forgotten stays reachable.** §29.6, as a measured floor rather than an intention.

**The sentence this is all for, which appears nowhere in the game:** the pride that made the house great is the reason there is nobody left to inherit the greatness.

---

*Related: `.claude/skills/eldritch-story/reference/story-manual.md` (architecture), `.claude/skills/rothfuss-prose/reference/prose-manual.md` (voice), [the issue tracker](https://github.com/JamesFlames/EldritchDynasty/issues) (the systems this brief describes that do not exist yet, one issue each, in build order), `AGENTS.md` (the operating manual for the ones that do).*
