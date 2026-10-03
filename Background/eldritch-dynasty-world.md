# THE WORLD — Eldritch Dynasty

**Status:** canon. Where this file and `packages/content/**` disagree, the content wins and this
file gets corrected. Where this file and the concept brief disagree, the brief wins.

**What it is for.** The simulation knows how blood moves. It does not know what a mile costs, who
may arrest a Head, how long a letter takes to reach the king's city, or whether anyone in this
world has ever seen a printed page. Event authors invent those answers under deadline, and by the
sixth Age the game contains three incompatible worlds. This file is the one world, written down.

**How to use it.** Read §1 and §2 once. Then, before writing an event, answer five questions from
the relevant sections:

1. **Whose land is this on?** (§8)
2. **Who has jurisdiction over what just happened** — the house, the town, the Warden, the Crown,
   or the Church? (§8, §9)
3. **How did anyone outside the room hear about it, and how long did that take?** (§6, §20)
4. **What did it cost, in marks?** (§11)
5. **Who tells the story afterwards, and what do they get out of telling it?** (§20)

An event that cannot answer those five is set nowhere.

> **The register, in one line.** Late-medieval, rain-coloured, literate at the top and not at the
> bottom, run by paperwork and grudges. Magic is a licensed trade with a fee schedule. The one
> genuinely uncanny thing in the world is in your family, and the second is coming to collect.

---

## 1. The world in twenty facts

Everything else in this file elaborates these. If you only read one section, read this one.

1. The world is **Ostane**. Nobody says so — it is a word out of old books, like *the terrestrial
   sphere*. People say *the Settled Lands*, meaning the part with roads.
2. There was an **empire**, the **Ambric**. It fell in **604** and every year since is still
   counted from its founding. Your run begins in **1042** and ends in **1542**.
3. The empire left three things: the roads, the language, and the Church. Every kingdom in the
   Settled Lands is younger than all three.
4. The family lives in **Aubren**, a feudal kingdom of great houses, wet weather and strict
   precedence, in the upland province of **the Nethering**, at a stone hall called **Ardwen**.
5. Aubren has a king at **Caster**, a **Warden** over each province, a **magistrate** in each
   market town, and an **Assembly** that meets every third year and keeps the **Roll of Houses**.
   Your Respect tier is your line on that Roll (§10).
6. The **Church of the Nine Quiet Names** is older than the kingdom, richer than the Crown, and
   holds its own courts. Its liturgy wards nightly against a thing its doctrine says is a peasant
   superstition. It has never been asked to explain this and would not enjoy the question.
7. **Money is small and precise.** 1 crown = 20 marks = 240 mites. A day's bread is 2 mites. The
   hall feeds nine to fourteen mouths. Everything in this game is affordable and nothing is
   affordable twice (§11).
8. **Mystic magic is a licensed trade.** It is taught at **the Colleges at Corran**, six weeks
   away in a foreign country, and practised by **warranted** men and women who charge by the job.
   Unwarranted practice is a crime in both courts.
9. **Eldritch Power exists nowhere outside your bloodline.** No rival house has it. No stranger on
   the road has it. Anything impossible done by anyone who is not of the blood is Mystic, fraud,
   or the counterparty. There is no fourth option and authors must not invent one.
10. **Books are made by hand and there is no press** (§7). A book is a year of somebody's life to
    read and half a year of somebody else's to copy. This is why a library is an inheritance.
11. **News moves at the speed of a horse.** A rider does 25 miles a day, the post relay 60, a
    loaded cart 12. Caster is nine days away by cart. Corran is six weeks (§6).
12. **Nothing is faster than that, ever, across the Long Line.** No powder, no press, no steam, no
    signal towers. §7 explains why the line does not move and it is not laziness.
13. **Everything of consequence is written down by somebody with a motive** — the parish roll, the
    notary's book, the Braccish ledger, the Assembly's herald, the Church's inquest minute. This
    is the machinery that makes a Discrepancy provable centuries later (§16).
14. **A dowry is lineage documentation, notarised.** Forging it is an industry with going rates
    (§13). The one thing that cannot be forged is a girl waking early in front of witnesses.
15. **The house holds the low justice on its own land** — fines, the stocks, eviction — and not
    the high. Blood belongs to the Warden's assize (§8).
16. **The great sale** is held at **Sarrow**, the port, once every sixty to ninety years, announced
    years ahead so everyone has time to do something regrettable (§17).
17. **The road-players are the Wayfolk.** They carry every song, every rumour and most of the news,
    they are distrusted everywhere, and they are how a thing that happened at Ardwen becomes a
    ballad in Caster forty years later with the names changed (§20).
18. There are **no other kinds of people**. No elves, no dwarves, no fae, no monsters, no talking
    beasts. Everyone in this world is a human being with a lineage, which is the only kind of person
    the simulation can model and the only kind the story needs. This is not the same as saying the
    world is uniform: it holds a dozen peoples who dislike each other on entirely human grounds
    (§22), a thick culture of manners, oaths and feasts (§23), and beasts that are all ordinary
    animals and all perfectly capable of killing you (§24).
19. **The Church has no magic.** No miracles, no holy fire, no blessed steel. It has law, money,
    literacy and eleven hundred years of organisation, which is worse.
20. **The world does not know what your family is.** It has guesses, insults and songs. Keeping it
    that way is the endgame.

---

## 2. What this world is not

**Excluded because they break a game system.**

- **The printing press.** Books must stay scarce across the Long Line or the library, the auction
  and the whole knowledge economy collapse. §7 gives three in-world reasons it never arrives.
- **Any second bloodline with the gift.** Eldritch Power is family-exclusive; a rival house that
  has it makes the entire ascension premise ordinary.
- **Reliable, schedulable Eldritch Power.** Non-negotiable (brief §12). No cooldown, no ritual
  that summons it on demand, no tier at which it becomes a tool.
- **Working divination.** No prophecy that comes true on schedule, no seer who is simply correct.
  Signs are real, cheap, and unreliable — every marriage-broker in the province has a theory and
  they disagree (`traits.yaml: sign_of_the_blood`).
- **Monsters, and any beast that is not an animal.** The bestiary in §24 is zoology and folklore.
  A thing in the dark is a wolf, a man, a fraud, a warranted practitioner, or the counterparty —
  the same five options as §1.9, and for the same reason. A world with a second monster in it is a
  world where the family's trouble is one item on a list.
- **A neutral narrator.** The game never adjudicates between two accounts in its own voice. There
  is only Daveed, and he is not neutral.

**Excluded because they are the wrong century.** Gunpowder, firearms, cannon, steam, rail, the
telegraph, semaphore chains, banks with branches, paper money, joint-stock companies, standing
police, germ theory, anaesthesia, the compass rose on a common man's wall, a map of the world.

---

## 3. Time

### The Reckoning

Years count from the founding of the Ambric Empire. There is no other calendar and no dispute
about the count, because the Church has kept it without a break since year 180 and the Church does
not lose paperwork.

| Year | |
|---|---|
| **1** | The Ambric Empire founded. |
| **~180** | The Church of the Nine Quiet Names becomes the Empire's cult and its clerks. |
| **310–470** | The Empire at its height. The Ambric Road is cobbled end to end. |
| **604** | **The Fall.** Not a battle — a slow default. The last Emperor's writ stopped being obeyed and nobody recorded the day. |
| **611** | Aubren declares itself a kingdom under the first of its royal houses. |
| **~700–900** | The bad centuries. Roads unmended, letters unanswered, three plagues. |
| **1042** | **Your ancestor signs something.** The run begins. |
| **1542** | The term. The run ends. |

By 1042 the Empire is 438 years gone and is quoted in law the way we quote Rome: constantly, and
by people who have never read it.

### The calendar

Twelve months of thirty days, then **five Hollow Days** at the year's dark end that belong to no
month at all. A sixth Hollow Day is added every fourth year. The year turns on the **first of
Thaw**.

**Thaw · Seedmonth · Greening · Highsun · Haying · Harvest · Ingathering · Slaughter · Smoke ·
Frostfall · Deepwinter · Longnight ·** *(the Hollow Days)*

A week is a **tenday**. Three tendays to a month. In practice authors need only five of these:
*Thaw* (mud, debt, the year's first quarrel), *Highsun* (fairs, travel, war), *Harvest* (money
arrives), *Slaughter* (the beasts are killed and salted, and the house eats well once) and *the
Hollow Days* (the Church's nine nights of the Quieting; nobody travels; everything waits).

### The house's year at Ardwen

| | |
|---|---|
| **Thaw** | The roads are impassable and the accounts are done. Rents fall due at the first fair weather; the ones that will not be paid are known by now. |
| **Seedmonth–Greening** | Sowing. **The Greening feast** — tenants at the low tables, kin up from the branch halls, the first of the year's two occasions on which the whole family is in one room. |
| **Highsun–Haying** | Travel, fairs at Bramme, weddings, levies if there is a war. Anyone going to Corran leaves now. |
| **Harvest–Ingathering** | The year's income arrives, in grain more than coin. The Warden's assize sits at Cawdry. |
| **Slaughter** | Beasts killed, salted, smoked. **The Slaughter feast** — the second occasion, and the one where somebody says the thing they have been not saying since Greening. |
| **Smoke–Longnight** | Nothing happens outdoors. Study, illness, and the long argument. Children are born in this quarter more than any other, which the midwives attribute to Slaughter. |
| **The Hollow Days** | The Quieting is said at dusk for nine nights. The house is expected at the chapter house in Bramme at least once, and is noticed when it is not. |

Hours are told by bells in towns and by the sun everywhere else. Tower clocks exist in Caster,
Sarrow and Corran and are a thing people go to look at. Nobody owns a clock.

---

## 4. The Settled Lands

The known world is a coastline, a river system, three mountain walls and about nine hundred miles
of road. Beyond it there is more world; there is no reason for anyone in this game to go there.

| | What it is | Function in play |
|---|---|---|
| **Aubren** | Feudal kingdom. Great houses, strict precedence, wet uplands and good grain in the south. Home. | Where the run happens. |
| **Bracc** | Mountains, mines, and the ledgers. The Braccish weigh the coin everyone else spends and take their cut of every exchange. | Credit, debt, letters of exchange, the coin standard. |
| **Anvary** | A league of free cities, merchant-run and irritatingly pleased about it. Nobles are tolerated, not obeyed. | Books, glass, paper, the Colleges, foreign affinities. |
| **Yssanne** | Across the Grey. Older than the Empire, refined, courteous and entirely unimpressed. Silk, dye, and law that does not resemble ours. | The far match, the foreign clause, the letter that takes a year. |
| **The Marches** | A shattered belt of two hundred petty holds between Aubren and the east. Nobody has ruled it since 604. | Soldiers for hire, exiles, a place to disappear a cousin. |
| **The Rimefell** | The northern mountain wall. Herders, ore, six months of snow. | Where a book or a bride comes from when she should not exist. |
| **The Barrenward** | East of the Marches. Old roads going the wrong way and nothing at the end of them. | Ruins. Do not populate it. |
| **The Grey** | The western sea. Coastal trade, no crossing worth making except to Yssanne. | Weather, wrecks, salt. |

**Aubren's neighbours matter in this order:** Anvary (books and money), Bracc (money), the Marches
(soldiers), Yssanne (rare and expensive). Two of these can be reached in a season. Yssanne cannot.

### Language

**Ambric** is what everyone speaks, and it is the Empire's tongue worn smooth. **Old Ambric** is
its dead ancestor and survives in three places: the Church's liturgy, the law's formulas, and a
physician's labels. A man who can read Old Ambric can argue in a Church court; a man who cannot
must hire one who can, at 2 marks a day.

**Braccan** is spoken in Bracc and in every counting-house everywhere. Anvarine cities each keep a
dialect and conduct business in Ambric. **Yssene** is soft, vowel-heavy, and nobody in Aubren
speaks it properly.

Nobody is illiterate at the top and almost nobody is literate at the bottom. A tenant farmer knows
his mark. A steward reads and writes and does sums. A Head who cannot read is a scandal his
grandchildren will still be explaining.

---

## 5. Home ground

### Ardwen

A stone hall on a rise above a bend in the **river Wend**, in **the Nethering**, the wet western
upland province of Aubren. Not a castle. A fortified house: a walled yard, a gatehouse nobody has
shut in ninety years, a hall block with an east and a west wing, seven grates, two cellars, a
chapel the family does not use, and a roof that is a running argument.

Fixed features, because they are already in the content and authors keep needing them:

- **The long room** — where lessons happen and where the family eats when it is not being formal.
- **The second cellar** — cold, dry, bricked and unbricked more than once. Things get left there.
- **The east cellar** — where the house puts what it has bought and does not want to look at.
- **The west wing** — the roof has been bad since about 1090 and is quoted in every argument
  about money for the next nine hundred years.
- **The yard** — where things happen in front of witnesses, which is the whole point of a yard.

The house holds roughly **1,400 acres**: eleven tenant farms, a mill on the Wend, woodland, and
the common where the village grazes. In an ordinary decade the hall feeds **nine to fourteen
mouths** — family, unmarried kin, and the indoor servants.

### The near country

| Place | Distance from Ardwen | What it is |
|---|---|---|
| **Wick** | half a mile, downhill | The village. About 120 souls, all tenants. A church, a smith, an alehouse, a reeve. |
| **The smaller house** | 4 miles of bad gravel | The first cadet hall. Nobody has mended the road in thirty years and everyone has noticed. |
| **Bramme** | 11 miles — four hours' ride, half a day by cart | Market town, ~2,000 people. A magistrate, a notary, a chapter house of the Church, a physician, two fairs a year (Greening and Ingathering), and a gaol with three rooms. **Most events that need a town need Bramme.** |
| **Cawdry** | 40 miles — two days by cart | Provincial seat, ~9,000. The Warden sits here; the assize twice a year; the province's records; a proper bookseller who is wrong about most things. |
| **Caster** | 210 miles — nine days by cart, five by rider, three by post relay | The king's city, ~60,000. Court, the Assembly, the heralds and the Roll of Houses. |
| **Sarrow** | 260 miles east — eleven days | Aubren's chief port. Ships, brokers, and **the great sale** (§17). |
| **Hesk** | 18 miles north — a long day by cart | The slate quarries. A village of one trade that has married only itself for three hundred years (§22). Every roof in the province, including the one that leaks. |
| **The Lag** | 40 miles down the Wend — two days by boat, four back | Flat drowned country. Eels, peat, wildfowl, ague, and a reputation. Not the house's land and not really the Warden's either (§22). |
| **Coln** | 50 miles south — two days from Bramme | A shrine and a stone. The province's pilgrimage, walkable in a fortnight there and back, and the respectable reason to be absent. |
| **Corran** | ~700 miles — six weeks by road, four by ship in season | In Anvary. The Colleges. Where a son goes and does not come back for nine years. |

**Cadet halls** are founded within a day's ride and take their own names — the smaller house, the
west house, the house at the ford. A branch four generations old is a neighbour with a grudge and
a claim, not a wing of the family.

---

## 6. Distance, travel and news

The most common consistency failure in a generational game is information arriving too fast. These
numbers are the ceiling.

| | Per day |
|---|---|
| Loaded cart, ox | 10 miles |
| Loaded cart, horse | 12–15 miles |
| Rider, own horse, sustainable | 25 miles |
| Rider, killing the horse | 60 miles, once |
| **The post relay** (Crown or Church, fresh horses at stages) | 60 miles |
| Marching column | 12 miles |
| Coastal ship, fair wind | 90 miles |
| Foot | 18 miles |

**Roads.** The **Ambric Road** is the Empire's work — cobbled, drained, straight, and still the
best road anyone has, four hundred years after the men who mended it stopped being paid. It does
not go to Ardwen. The Nethering is reached by a spur that is gravel, then mud,
then a track. In Thaw and Deepwinter the province is effectively closed.

**How news actually travels.** A thing that happens at Ardwen in Highsun reaches Bramme by market
day, Cawdry within a tenday, Caster within two months if anyone cares, and Corran within the year
if it is interesting enough to be worth a letter. It reaches everyone else through the **Wayfolk**,
in a song, in about a generation, with the names wrong (§20).

**Letters.** A letter to Caster and its reply: three tendays, if nothing goes wrong. To Corran and
back: most of a year, and the answer will address a question you have stopped caring about. This
is why a foreign match takes a decade to arrange and why the family's own records outrank
everybody's memory.

**Corollary for authors.** Nobody reacts to distant news in the same scene. A rival cannot know
about the Drowning by supper. The Church cannot open an inquest on something that happened last
month in another province. If an event needs the world to know a thing, either put a witness in
the room or let a generation pass.

---

## 7. The technology line

**Present, ordinary, unremarkable:** watermills and windmills · the heavy plough and the horse
collar · three-field rotation · crossbows and warbows · mail, plate, and the crossbow's slow
argument with it · stone building, lime mortar, glazed windows in a rich house and shutters in a
poor one · wheeled transport, ferries, stone bridges · spectacles (Anvarine, recent, expensive,
old men only) · ground lenses and mirrors as luxury goods · tower clocks in three cities · paper
alongside vellum, the paper Anvarine and dear · wax and lead seals · double-entry books in Bracc ·
soap, brandy, wire, decent steel, and reasonably good glass.

**Present, expensive, guild-controlled — the Mystic trade's few durable goods.** Warranted
practitioners sell exactly three things worth naming, and they have not changed anyone's life who
could not already afford them:

- **Warded lamps** — steady light without flame, sold by weight of the glass. One lights the
  Colleges' Deep Room. A great house might own two.
- **Still-glass** — flawless lenses and mirrors. A physician's lens costs 14 crowns.
- **Cold rooms** — a stone chamber that stays at winter through Highsun. Three exist in Aubren, and
  the one at Sarrow is why the port matters.

**Absent, permanently:** gunpowder and everything downstream · steam and rail · the telegraph and
signal chains · the printing press · mechanical clocks small enough to carry · banking with
branches, paper currency, or joint-stock finance · anaesthesia, antisepsis, germ theory · standing
professional police · the anatomical or the astronomical revolution · anything that would let a
message beat a horse.

### Why there is no press, in the world's own terms

Authors will be tempted. The three reasons, in the order a character would give them:

1. **The Church forbids it.** Doctrine holds that the ward is the *saying* of the nine names, and
   that a name cut into metal is a name said forever by a thing that is not a person. Setting type
   is, in Church law, a species of unlawful naming. The penalty is silence (§9).
2. **The copyists hold a charter.** The Colleges' scriptorium and the Anvarine stationers'
   companies have a monopoly on multiplied text, granted in 812 and renewed by every authority
   since because it is enormously profitable to everyone doing the renewing.
3. **There is no cheap paper.** Anvarine mills make good paper in small quantity at high price.
   Nobody has found it worth building the industry a press would need, because of reasons 1 and 2.

The consequence is the whole knowledge economy: a book is a hand-copy, a copy is half a year of a
copyist at 6–15 crowns, and burning a library removes those books from the world. That is why
**the Burning of the Nine Libraries** is the most consequential thing that can happen in a run.

---

## 8. Governance and law

### Aubren, from the top

| | Who | What they can actually do to you |
|---|---|---|
| **The Crown** | A king at Caster. The dynasty may change more than once across the Long Line; the kingdom persists. | Grant and revoke title. Levy war and tax. Take an heir into wardship. Pardon anything. |
| **The Assembly** | The realm's registered houses and the delegates of the chartered towns, meeting at Caster **every third year**. | Confirm taxes, hear petitions, and — the part that matters — keep the **Roll of Houses** (§10). |
| **The Warden** | The Crown's man over a province. The Warden of the Nethering sits at Cawdry. | The **assize**, twice a year: blood, land, treason, and any dispute between houses. Calls the levy. Claims wardship of a minor heir. |
| **The magistrate** | Appointed to a market town. Bramme's sits three days a tenday. | Debt, theft, contract, assault, the fair's disputes. Fines, the stocks, gaol, and referral upward. |
| **The house** | You. On your own land. | **The low justice**: fines, the stocks, whipping, eviction of a tenant, the settling of quarrels between tenants. |
| **The village** | A **reeve**, chosen by the tenants and confirmed by the house. | Field boundaries, strays, the common, and telling the house what it does not want to hear. |

**The low justice and the high.** A landed house may fine, confine, whip and evict on its own land.
It may not hang, maim, or try a matter of blood — those go to the Warden's assize, and a Head who
hangs a man in his own yard has committed murder in the Crown's view and will be told so
expensively. This distinction is worth an event on its own and should never be blurred.

**Nobody arrests a Head casually.** A Head is taken by the Warden's serjeants on the Warden's
warrant, or by an **apparitor** of the Church on a Church summons, and both of those are events. A
magistrate summons him; he does not seize him.

### Taxes, and the other ways money leaves

| | |
|---|---|
| **Hearth tax** | 4 mites per hearth per year, collected in Harvest. Ardwen's tenants have 46 hearths. |
| **Relief** | Paid to the Crown when a house inherits: **one year's income**. The single largest predictable expense in the game, and it lands exactly when the house is weakest. |
| **Wardship** | If an heir is under 16, the Warden may take the estate's management until majority and keep the profits. Buying the wardship back is customary and costs about three years' income. |
| **The levy** | In war: two households in five, or coin in place of a man (§19). |
| **Purveyance** | The Crown or the Warden may take grain, carts and horses at a price it sets, and pay eventually. |
| **The Church's tithe** | A tenth, notionally. In practice negotiated, and the negotiation is a relationship. |

### Contract, oath and the notary

The world runs on **sealed documents**. A contract is written by a notary, sealed by the parties,
witnessed by two men of standing, and entered in the notary's book — and it is the *notary's book*
that is the evidence, not your copy. Bramme has one notary; Cawdry has nine; Caster has a street
of them. A notary's attestation costs 1 mark. Notaries are bribable and their books are not
easily altered, which is exactly the tension the Discrepancy system runs on (§16).

An **oath** sworn before a keeper of the Church is enforceable in the Church court and nowhere
else. This is why the Church has jurisdiction over so much: everyone swears everything.

---

## 9. The Church of the Nine Quiet Names

The oldest institution in the Settled Lands, and the only one that spans all of them.

### Doctrine

There are nine names. Saying them, quietly, in order, at dusk, is the ward — **the Quieting**.
Doctrine holds that the naming *is* the protection and that no other protection is needed or
permitted. What the names are names *of* is the question the Church declines to answer, and has
declined for eleven centuries with increasing institutional grace.

Its two official positions, held simultaneously:

- The thing the peasants believe in — the one that rusts iron, turns milk sweet, and signs
  contracts — is **superstition**, and educated men do not entertain it.
- The Quieting is said every dusk in every parish in the Settled Lands, without exception, and a
  parish that misses it is investigated.

Nobody inside the Church finds this contradictory. Everyone outside it does, and the ones who say
so publicly become a matter for the assessors.

**The Book of Quiet** is the text: the nine names, the order, the form of the Quieting, and about
four hundred pages of commentary on how to say them. Church copies are small, vellum, and made to
be held in one hand. A parish copy is chained.

**Rival traditions** hold that the nine are nine different things, or that they are one thing
lying about itself eight times. Both are heresies with names and both have adherents, mostly among
scholars in Anvary, where the Church can do nothing about it and says so at length.

### Offices

| | |
|---|---|
| **Keeper** | The parish priest. Says the Quieting, keeps the **parish roll** (births, marriages, deaths), witnesses oaths, and knows everything. |
| **Canon** | Runs a chapter house in a market town. Bramme has one. Four or five keepers under him. |
| **Assessor** | The court's investigator. Opens inquests, compares accounts, asks the follow-up question. Wears no badge, which is the badge. |
| **Apparitor** | Serves summons and makes arrests. Two of them will come; there are always two. |
| **Prelate** | Rules a province from the cathedral city. Politically the Warden's equal and socially his superior. |
| **The Custodian** | The head of the whole Church, seated at **Vaunt** in the old imperial heartland. Appears in this game as a signature on a document, never as a person. |

### The Church court, and what it can do

Jurisdiction: **heresy · oaths · marriage and legitimacy · wills · unwarranted practice · the
records of any of the above.** That is an enormous share of everything a dynasty does.

Procedure is oral, slow, and conducted partly in Old Ambric. Testimony is read from letters.
Speeches run for days. To answer a summons properly a house must hire an advocate who reads Old
Ambric — 2 marks a day, and the good ones are in Cawdry.

The sanctions, in order:

1. **Admonition.** A letter. Costs nothing and is remembered.
2. **Fine.** 20 to 400 crowns, scaled to what you have. A minor heresy freely admitted runs about
   180 and buys eighty years of not being looked at closely.
3. **Penance.** Public, tedious, and cheap in coin. It costs standing and it costs the Head's
   dignity, which is sometimes the point.
4. **Silence.** The house is put to silence: no keeper will say the Quieting on its land, no
   marriage in it is witnessed, no burial in it is entered on the roll. Tenants leave. Matches
   fail. It is the worst thing that happens to a house short of the last one.
5. **The naming.** A person is named aloud, from the chapter house, as an enemy of the ward. It is
   the Church's only loud act and it functions as outlawry: no contract with them is enforceable,
   no oath they swear is good, and killing them is a fine rather than a hanging.

**The Church can be bribed**, because it is enormous and its people are people, and because its
own doctrine gives it no coherent reason to be rigorous about the one thing your family is. A
house at **Eminent** can expect it to look away once in a generation (§10). Nobody negotiates that
in writing.

### The Church and magic

The Church does **not** work magic. It has no miracles and claims none — the Quieting is a saying,
not a working, and a keeper who claims otherwise is disciplined. What it has is the power to
license, to prosecute, and to burn.

Its position on Mystic practice: lawful when warranted, criminal when not, and distasteful in
either case. Its position on the blood is the contradiction the whole run lives inside — it holds
that the law of male expression is divine and the practice of concentrating it abominable, and has
never reconciled the two.

---

## 10. Standing — the Roll of Houses

Respect is not a mood. It is a line in a book kept by the Assembly's heralds at Caster, revised at
each triennial sitting, and copied by every herald, broker and marriage-agent in the kingdom.

| Tier | What it means in the world | What it opens |
|---|---|---|
| **Unknown** | Not on the Roll, or struck from it. You hold land at somebody's sufferance. | Nothing. Being struck off is done *to* you and is a scene. |
| **Known** | Entered on the Roll. Your seal is your own; your marriages are registered; minor houses will treat. | Minor matches. The open lots at the sale. Credit at bad rates. |
| **Regarded** | Summoned to the Assembly. A seat at the provincial assize. The Warden's clerk knows your steward's name. | Good matches. Credit at fair rates. **Sealed lots** at the sale. |
| **Eminent** | The Warden addresses your Head as an equal and the prelate invites him to dinner. | Great houses. The Church looks away once a generation. Negotiation without giving hostages. |
| **Exalted** | Named in the King's own writs. Precedence at Caster. There are perhaps six houses here at a time. | The finest blood in the world offers itself. **The ascension rites become socially possible.** |

**Standing costs money to hold** (`core/src/economy.ts`): a house at Eminent must be seen to live
like one — a larger household, better cloth, a horse nobody rides, and the two feasts done
properly. This is why the decay is not arbitrary. A quiet forty-five years without an Assembly
petition, a public match or a visible act costs a tier because the heralds revise on evidence and
you supplied none.

**Sumptuary law** makes standing visible and is a gift to event authors. Only a house on the Roll
may wear a sealed ring in public. True black dye and deep red are reserved to Eminent and above; a
merchant in black is fined 2 crowns and laughed at, and the fine is not the part that stings. A
house dressing above its line is the cheapest scandal in the game.

---

## 11. Money

**1 crown = 20 marks = 240 mites.** A mite is copper and everybody has one. A mark is silver and a
labourer sees a few a year. A crown is gold, is mostly an accounting unit and a letter of credit,
and a tenant farmer may go his whole life without holding one.

The **Braccish weight standard** is what everyone trusts; Aubren, Anvary and the Marches all strike
coin and all of it is weighed against Braccish reckoning at the counting house, which takes its
cut. Cross-border payment moves by **letter of credit**, drawn on a Braccish house, at 2% and a
month's delay. There is no paper money and no cheque.

### Prices

The brief's table, extended. These are the fixed points; interpolate, do not invent.

| | |
|---|---|
| A day's bread, one person | 2 mites |
| A day's labour, hired man, plus food | 3 mites |
| A night at a decent inn | 8 mites |
| A yard of good wool | 6 mites |
| A notary's attestation | 1 mark |
| An advocate who reads Old Ambric | 2 marks a day |
| A servant's yearly wage *(plus board, bed and cloth — the wage is pocket money)* | 3 marks |
| A yard of Yssene silk | 4 marks |
| A cow | 2 crowns |
| An ox | 3 crowns |
| A plain sword | 2 crowns |
| A riding horse | 8 crowns |
| A mail shirt | 12 crowns |
| A physician's lens, still-glass | 14 crowns |
| A forged pedigree, good enough for Bramme | 25 crowns |
| A forged pedigree, good enough for Caster | 120 crowns |
| **Standing cost, per living family member per year** | 1 crown |
| **Raising a child, per year, birth to 20** | 1 crown |
| A bound blank book, vellum, 200 leaves | 3 crowns |
| A fair copy of an ordinary book, half a year's work | 6–15 crowns |
| A warhorse | 60 crowns |
| Roofing the west wing, properly, again | 90 crowns |
| Commuting the levy, one household | 120 crowns |
| A minor heresy, freely admitted | 180 crowns |
| **Special education, one attribute, full term** | 40 crowns |
| **A minor spellbook at auction** | 60–200 crowns |
| **A foreign-affinity or high-tier book** | 400–1,200 crowns |
| **Typical income at Regarded, per year** | 55–70 crowns |
| **Relief on inheritance** | one year's income |

**Retainer wages are in marks per year, plus board** — tutor 4, archivist 5, steward 6, midwife 3
(`characters/founding.yaml`). A steward on 6 marks who has been in post eleven years is not
being robbed; he is being taken for granted, which is a different and better story.

**A useful sanity check.** 240 crowns is the price of a Portion of Agelessness, and the seller's
line is that it would keep the house in bread for nine years. Nine years of bread at 2 mites a day
is a household of about nine. That is the size of Ardwen, and the arithmetic in the game is meant
to survive being checked, because a subset of players will check it.

---

## 12. Land, work and who is who

The house's income is **land**, not trade. Eleven tenant farms pay in grain and labour, the mill
takes a share of everything it grinds, the woodland sells timber badly and pannage well, and the
common is the reason the village tolerates the house.

The house keeps a **terrier**: a written register of its holdings, parcel by parcel, the bounds of
each given by its landmarks and its neighbours — *from the mill leat to the ford, abutting the
common on the north, forty acres of wet pasture.* Great houses have theirs drawn, at expense, and
are pleased to be asked about it. It is the house's own copy, and as with every copy in Aubren it
is the notary's book that is the evidence (§8). A terrier and a notary's book that disagree is not
a clerical matter — it is how most land disputes in the province begin.

| | |
|---|---|
| **Tenants** | Farm the house's land on customary terms, inheritable in practice. Owe rent, days of labour, and the mill. Cannot be evicted casually, and every eviction is remembered for four generations. |
| **Cottagers and labourers** | No land worth the name. Work for days. First to starve in a hard winter and first to leave in a bad one. |
| **The village trades** | Smith, miller, carpenter, alewife. The smith matters: iron is what dulls when the blood is in the room. |
| **Indoor servants** | Nine or so at Ardwen: steward, cook, two or three maids, a groom, a yard man, and whoever the house is buying this decade. Fed, bedded, clothed, and paid a few marks. |
| **Retainers** | Contracted: tutor, midwife, archivist, physician, singer, chronicler, guard. A contract binds to a **person**, not to the house, and says what happens when that person dies (`schema` — `RetainerRole`, `onEmployerDeath`). |
| **Wards and hostages** | Children fostered into another house to hold an alliance, or given as surety in a treaty. Both are normal, legal, and precisely the person a rival will ask for when they have worked out what she is for. |

**Nobody in this world is a slave and there is no serfdom in Aubren.** People are held by debt,
custom, contract and having nowhere else to go, which is sufficient.

---

## 13. Marriage, kinship and the seal

### How a marriage is actually made

1. **The approach.** Through a broker or a mutual house. Every province has marriage-brokers and
   they all have opinions about the signs.
2. **The papers.** The dowry is **lineage documentation** — three generations of maternal record,
   notarised, sealed. Coin and land come with it, but the papers are the negotiation. Forging them
   is an industry with published rates (§11) and a standard tell: the seal of a house that
   stopped existing.
3. **The contract.** Written by a notary, sealed, witnessed, entered in his book.
4. **The oath.** Sworn before a keeper. This is what makes it a marriage, and what makes the
   Church the court for any later argument about it.
5. **The roll.** Entered in the parish roll. If it is not on the roll it did not happen, and a
   century later that is exactly the sort of thing an assessor finds.

**Matrilineal marriage** — a man takes the house's name — is lawful, requires the heralds to
re-register the house, and is universally considered scandalous by people who would do it
themselves in a heartbeat. A house whose living blood is all female practises it or ends.

**Cousin marriage** is legal to the second degree with a Church dispensation, which costs four
crowns and is granted routinely because it is granted to everyone — eleven a year in this diocese,
entered in the register by name and degree and date, no distinction made between them because there
is none to make. Beyond that it is not granted and is done anyway, and the record is made to say
something else.

### Inheritance and the seat

Male-preference primogeniture, with the house's own custom on top: **the seat passes to the eldest
son who expresses**. If none does, the house enters **Regency** — a woman of the blood holds it,
which is customary, tolerated, and not lawful, and survives because the alternative is the estate
falling to the Warden.

Younger sons receive a **portion**: a farm or two, a sum, and leave to found a hall. This is the
world's name for a cadet branch, and it is why the branches are simultaneously loyal and
aggrieved — the portion was fair, and it was not the seat.

**The Regalia** is three founding heirlooms held together, of which the **Seal** is one. The Seal
is what a Head is: a Head without it is a man with an argument. When it goes sideways to a cousin's
hall, the arrangement is described by everyone in the language of a loan, and nobody writes down
when the loan is due (`events/arc_seal.yaml`).

---

## 14. The two magics in public

### Mystic practice — the trade

Eight affinities in four opposed pairs, in two groups. **Elemental**: Fluid ↔ Thermal, Aero ↔
Terra. **Threshold**: Life ↔ Death, Light ↔ Darkness.

The world's plain words for practitioners, which is what event bodies should use: *a water-worker,
a fire-hand, a wind-caller, a stone-wright; a green hand, a death-worker, a lamp-wright, a
shadow-worker*. "Warranted practitioner" is the legal term. "Book-man" and "the lettered" are what
villagers say, and they say it about anyone who reads.

**Women practise only the four Threshold affinities**, and this is a fact rather than a rule.
A woman can read every word of an Elemental book, understand it perfectly, and the working will
not take. Everyone has tested it. Nobody can say why, including the Colleges, which is a
sentence the Colleges hate.

Practice is priced like plumbing. A green hand attends a difficult birth for 2 marks. A
death-worker is fetched for a bad death at 5 marks and is worth it. A stone-wright surveying a
foundation charges 1 crown and is cheaper than the wall falling down. A Life-affine practitioner
in a plague year cannot be hired at any price, which is the whole of the Plague Age's economy.

### Eldritch Power — the family's trouble

It exists nowhere else. The world therefore has no vocabulary for it, only borrowed words:

- **The house's own word**, whatever the chronicle of that century happens to use. It changes.
- **"The blood"** — neutral, in marriage contracts and Church law, where it is a real legal
  category despite the Church's public position that it does not exist.
- **"The old gift"** — flattering, used by people who want something.
- **"The family's trouble"** — what the village says, kindly, meaning the sons.
- **"Inbred"** — what the rival says, and it works because it is true.

Manifestations are always narrated as things that happened **to** the family. Nobody in the world,
including the family, can produce one deliberately. There is no rite, no focus, no tier at which
this changes.

**The signs** are real, cheap and unreliable: iron that dulls where she sleeps, milk that turns
sweet (sour is only weather), dogs that will not enter a room. Every house has a folk theory, every
theory disagrees, and a good midwife's happens to be right more often than not.

---

## 15. The Colleges at Corran

Six weeks away, in a foreign country, and expensive. This distance is deliberate: **the Colleges
are where books come from and where a son can be sent. The Church is the institution that happens
to you.**

Five ranks: **petitioner → reader → warranted → master → the Provost.** The **warrant** itself is a
stamped brass token, worn at the collar, and it is a licence to practise for money anywhere in the
Settled Lands. Unwarranted practice is prosecuted in both courts.

Four faculties: **the Rolls** (law and letters) · **the Infirmary** (medicine) · **the Works**
(arithmetic, survey, building) · **the Practical** (the eight affinities). The library is **the
Deep Room** and outsiders do not enter it.

Tuition is set per student at admission, by argument, and ranges from 4 to 40 crowns a term. A
term is half a year. A son sent at sixteen comes back warranted at twenty-five if he is good, and
does not come back at all about a third of the time.

**What the Colleges will not do:** teach anything about the blood, admit that it exists, or send
anyone to look at it. Their scholars hold the 1042 contract to be a provincial forgery and have
published on the subject. This is the family's epistemic problem for the first two centuries — not
proving the counterparty can be beaten, but proving to a hostile institution that it is there at
all.

---

## 16. Records, and how a lie gets caught

The Discrepancy system is not magic. It is paperwork, and this is the paperwork.

| Record | Kept by | Why it catches you |
|---|---|---|
| **The parish roll** | The keeper, in every village | Births, marriages, deaths, with dates. The single hardest thing to falsify, because copies go to the chapter house. |
| **The notary's book** | The notary, in the town | Every contract, sealed and dated. Yours is a copy; his is the evidence. |
| **The Roll of Houses** | The Assembly's heralds at Caster | Precedence, arms, registered marriages, the year a house changed its name. |
| **The Braccish ledger** | The counting house | Every letter of credit, every transfer, every sum. Braccish books are famously honest and famously for sale. |
| **The assize record** | The Warden's clerk at Cawdry | Every case of blood or land in the province, for four hundred years. |
| **The inquest minute** | The Church's assessors | What the house said, in the house's own words, in a year the house has since described differently. |
| **A rival's chronicle** | House Marrow, and others | Their account of your century, and it is buyable at the sale. |
| **Your own chronicle** | You | Worthless as a defence — see the Clause of the Witness. |

**The shape of an exposure.** A Discrepancy is proven when two of these disagree in front of
somebody with a motive. That is the only way it happens, and an event that proves one should name
the documents. "Somebody found out" is not a scene. "They have your account of 1341, and three
others, and would like to understand why yours is the shortest" is.

---

## 17. The great sale at Sarrow

Held by a syndicate of Sarrow brokers, once every sixty to ninety years, **announced four to six
years ahead** so that every house in the Settled Lands has time to liquidate, borrow, and do
something regrettable.

**Stock:** spellbooks, often in affinities nobody present possesses · heirlooms with two histories
· contracts and debts · occasionally a person — a ward, a hostage, a marriage right · and **pages
of other families' chronicles**, which is how a Discrepancy gets proven.

**Bidding is against named houses with visible motives.** House Marrow always wants Death texts.
The Church bids on Light and burns it. Knowing who wants what lets you drive a price up on an
enemy, which is the most enjoyable thing a poor house can do.

**Currencies of bid:** coin · letters of credit drawn on Bracc · favours owed · heirloom trade ·
and **marriage promises** — pledging a granddaughter not yet born to acquire a book for an affinity
nobody in the family has, on the theory that the blood will come. Sometimes it does.

Smaller trade happens constantly and elsewhere: the Cawdry bookseller, the Bramme fairs, an
Anvarine agent's catalogue, and the sellers who come to the door with a bottle and a price and will
not say what they are selling.

---

## 18. Careers

Purchased placements, chiefly for those who will never advance the house themselves. Each is a
real institution, not a menu item.

| Career | How it is actually bought | Costs |
|---|---|---|
| **Military** | A commission in the Warden's levy, a place in the King's household, or a captaincy bought in a Marches company. 30–90 crowns. | Kills people. Pays enormous Respect in a Wars and none in a Peace. |
| **Clergy** | Given to the chapter house at Bramme, or with money to a cathedral. A gift of 60 crowns and a farm is customary. | Removes them from the breeding pool permanently. Grants cover: the Church investigates a house with a son in it more slowly. |
| **Court** | A place at Caster in the King's household or a great house's. 40 crowns a year, ongoing, and it never ends. | Cheap Respect, good matches, Charm — and the family's business discussed by strangers. |
| **Merchant** | A share in a Sarrow venture or a Braccish partnership. 100 crowns buys a share. | No Respect whatever. Real money, at real risk. |
| **Scholar** | Sent to Corran. 4–40 crowns a term for eighteen terms. | No Respect at home. Faster study, and a warrant at the end of it. |

Note the shape: the careers that pay Respect cost you either the person's body or their bloodline.
**Respect is bought with descendants.**

---

## 19. War

Aubren fights its neighbours and itself. There is no standing army beyond the King's household of
about 900 men; everything else is levy and hire.

- **The levy.** Two households in five, called by the Warden, served with a list and a cart and
  the good manners of men who do not need to be rude. A household may send a man or commute at
  120 crowns. A house that always commutes is known to have always commuted.
- **Hire.** The Marches companies, paid by the month, loyal until the month ends.
- **Fighting.** Warbows, crossbows, spears, mail and plate, horse used for the shock and the
  chase. Battles are short, rare and decisive; the war is mostly the marching, the taking of
  places, and the burning of somebody's harvest.
- **Sieges.** Engines, mining, and starvation. A fortified hall like Ardwen is taken by hunger or
  betrayal, in that order of likelihood, and never in an afternoon.
- **Afterwards.** Looted libraries reach the market within two years and are priced by weight by
  men who cannot read them. This is the best buying window in the game and everyone knows it,
  which is a thing to be ashamed of and nobody is.

---

## 20. Folklore, songs, and how a rumour is made

### The Wayfolk

Travelling players — troupes of fifteen to forty, wagons, one extended family under one name.
They perform in market squares for coin and in great halls for supper and a floor to sleep on.
They are the only people who go everywhere and talk to everyone.

They are also distrusted everywhere: accused of theft, of taking children, of carrying illness.
The accusations are mostly false and universally believed. A house that treats them well gets its
version of a story sung for a century; a house that turns them away gets the other version.

**Wayfolk keep two names**, a use-name for strangers and a family name for their own. Asking for
the second is a serious rudeness. This is a custom, not a magic — names are load-bearing in this
world socially, legally and in the record, and never supernaturally.

### Tinkers

Single travellers with a pack and a mule, mending pots and selling small goods and worse news.
The superstition, which everyone observes and nobody defends: **take the third price.** A tinker
names three prices and the third is the true one; haggling past it is bad luck, and refusing a
tinker water is worse.

### Songs

Ballads are sung in **staves** and known by their first lines. A new one takes about fifteen years
to travel the kingdom and about fifty to lose its original names. By the third generation the
house in the song is unnamed, the daughter has become a maiden, and the thing in the cellar has
become a bear.

Named Arts generate songs. So do Vessels, Regencies and anything involving a girl waking early in
front of witnesses. A song that helps is worth more than a chapter house's goodwill; a song that is
better than the truth, more famous than the truth, and false is worth more still, right up until
somebody buys the page that disproves it.

### The counting rhyme

Children in every province skip to a rhyme that lists the nine names. It gets the order wrong. The
Church has attempted three times to suppress it and has, on each occasion, taught it to a new
province.

### Common superstitions, for texture

Iron over the door of a birthing room · never say a person's name aloud during the Quieting · dogs
know first · milk turned sweet is a sign and milk turned sour is only weather · do not count your
children aloud · a house with no fire in a grate for a full year is not a house any more · the
third price · leave the last of the bread.

---

## 21. Daily texture

**Food.** Bread and pottage, twice a day, at every level. Rye in the Nethering, wheat in the
south. Small beer for everyone including children, because the water is not trustworthy. Cheese,
onions, peas, salt pork after Slaughter, fresh meat only when something is killed or hunted. A
great house eats more meat, more spice and more courses, not different food. No sugar to speak of;
honey. No tea, no coffee, no chocolate, no tobacco, no potatoes, no maize, no tomatoes.

**Dress.** Wool and linen. Colour is status: undyed and brown at the bottom, good blues and greens
in the middle, true black and deep red at the top and licensed (§10). Silk is Yssene and is
inherited rather than bought. Everyone wears a knife. Nobody wears a sword indoors except a fool.

**The house.** Cold, dark, and loud with people. Rushes on the floor in the old wings, boards in
the new. Fires in three grates out of seven in an ordinary winter. Candles are tallow and stink;
wax is for the chapel and for guests. A warded lamp, if the house owns one, lives in the room the
family is proudest of.

**Medicine.** Humoral. Bleeding, purging, poultices, setting bones, and a competent midwife who is
worth more than any of it. Physicians are Colleges-trained, live in towns, and are more useful
than they have any right to be. A green hand beats them both and cannot be got in a plague year.

**Death.** At home, in the room, in front of the family. Washed and laid out by women of the
household. Buried within two days, in the churchyard at Wick or, for the Head and his wife, under
the chapel floor at Ardwen. The keeper enters it on the roll. A house that has run out of floor is
a house with a history.

**Children.** Perhaps two in three reach five. Every family in this world has buried children and
none of them find it acceptable; the flat way people speak of it is not indifference and should
never be written as indifference.

---

## 22. The peoples of the Settled Lands

Every one of them is human, and every one of them is somebody's neighbour and somebody's insult.
The divisions in this world are of trade, water, language and law — never of blood, except the one.

**Why this section exists.** An event needs a stranger roughly every third time it is written, and
a stranger who is only *a man from the road* is a wasted slot. Each of these arrives with a reason
to be there, a thing they want, and a reason nobody quite trusts them.

### Inside Aubren

| Who | What they are | Function in play |
|---|---|---|
| **The fell-graziers** | Sheep men of the high Nethering. Take the flocks up at Greening and bring them down at Slaughter, and are somewhere else for half of every year. Hold their grazing by a custom older than the province and have never produced a document for it. | Witnesses who were on the hill. A land dispute with no paper on either side, which is the purest Discrepancy fuel in the setting. |
| **The Lag folk** | The flat wet country forty miles down the Wend: eel-fishers, wildfowlers, peat-cutters, their own reeves, their own drowned calendar. Ague in Highsun, and everyone there has had it. | They will hide a person, move a box, and forget a face, at published prices. What they cut out of the peat — a boat, a body, a box — is sold at Bramme and is always older than it should be. |
| **The slate-men of Hesk** | A quarry village eighteen miles north. Roof the province. Marry only each other and have for three hundred years. | The west wing's roof comes from here (90 crowns, §11). A closed pool with a visible inherited fault of their own is the world's quiet mirror of what the family is doing on purpose. |
| **The colliers** | Charcoal burners. Live in the wood in season, sleep by the burn, come out black and are back in a tenday. Without them there is no smith. | They are awake at night in the one place nobody else is, they see everything, and their testimony is worth nothing in any court. |
| **The drovers** | Move cattle south along the green roads, two hundred miles at ten a day, the same families on the same routes for generations. Own land at both ends. | The slower, respectable news network — the Wayfolk carry the song, the drovers carry the fact. They also carry coin and notes of hand, and are robbed about once a decade. |
| **The wool factors** | Southern buyers who come up in Haying, price the clip, and leave. Pleasant, and pricing your whole year. | The one moment each year when an outsider assesses the house's real position and writes it down somewhere the house cannot see. |
| **The Bearers** | A lay burial confraternity, hooded, unpaid but for bread. They wash and carry the dead where a keeper will not go and a family cannot. The Church tolerates them and does not license them. | The Plague Age. They enter every house in the province and look at every body in it, including yours. |
| **The oath-men** | Men who follow the assize circuit and sell testimony. Everyone knows. The Warden's clerk knows. | Buyable witnesses, at 2 marks a day, and the reason a proven Discrepancy needs documents rather than mouths (§16). |
| **The licensed poor** | Beg by a badge from their own parish and nowhere else. Begging out of parish is vagrancy, and vagrancy is the stocks. | Cheap eyes, legally immobile. A beggar seen forty miles from his badge is a story on his own. |
| **The burgesses** | Chartered-town men — Bramme's forty households that elect its delegates and resent every landed house within a day's ride. | The town's answer to the house, and it is *no*. They send delegates to the Assembly and their votes are not yours. |
| **Pilgrims** | Walking to the shrine at Coln, or, once in a life and rarely, to Vaunt. Under the Church's protection on the road. | The only respectable reason for anyone to be anywhere. This is how a family member vanishes for two years and comes back, or does not. |

### The travelling peoples

| Who | | |
|---|---|---|
| **The Wayfolk** | Fifteen to forty in a troupe, one extended family under one name, wagons, two names each (§20). They settle their own quarrels at a gathering every third year and take no dispute to any court in the Settled Lands, which is precisely why every court in the Settled Lands mistrusts them. | Every song, every rumour, most of the news. Treated well, they sing your version for a century. |
| **The boat families** | The Wend and the rivers below it. Born, married and buried aboard; a dialect nobody ashore speaks well; a guild that will not take an outsider. | They will carry a thing and not open it, once, for a price, and their memory for a cargo is famously poor and privately excellent. |
| **The tinkers** | One traveller, one mule, pots and small goods and worse news. The third price (§20). | The cheapest way to put a stranger in a scene without owing the world an explanation. |
| **The companies** | Marches men between wars, camped outside a town in numbers that make the magistrate polite. Paid by the month, loyal until the month ends. | Hired soldiers (§19), and the reason a province holds its breath in a year with no war to send them to. |

### Foreigners resident in Aubren

| Who | | |
|---|---|---|
| **The weighers** | Braccish factors. A counting house at Cawdry, three at Sarrow. Wear their weights on the belt and swear no oath in a Church court — they swear *on the weight*, which the Church has objected to formally for two hundred years and accepted in practice for four hundred. | Credit, letters of exchange, and the ledger that outlives everyone (§16). |
| **The stationers' agents** | Anvarine. Travel with a catalogue and no stock, take the order, and deliver in eleven months. | How a house buys a book without going to Sarrow, and how a house's buying habits become a document in Corran. |
| **The Yssene houses** | Perhaps nine families in the whole kingdom, exiled or married in, poor, immaculately mannered, and holding to a law of inheritance that Aubren does not recognise and cannot quite dismiss. | A foreign match without a year of letters. Also a legal argument nobody in the Nethering is equipped to have. |
| **The Rimefell men** | Come down in Frostfall with ore, horn, coarse wool and horses, and go back before the passes close. Speak Ambric badly and prices exactly. | Where a book, a bride or a horse comes from when the paperwork says it cannot exist. |

**Prejudice, in the order Aubren holds it:** the Wayfolk (thieves), the Lag folk (webbed, allegedly),
the colliers (dirty and therefore dishonest), the boat families (foreign though they are not), the
weighers (avaricious and correct about it), the Yssene (proud), the Rimefell men (simple), and the
burgesses (jumped-up). All of it is ordinary human contempt and none of it is ever true of an
individual on the page.

---

## 23. Culture, manners and custom

§21 covers what people eat and wear. This is how they behave, and it exists so that a scene can go
wrong socially without anybody breaking a law.

### The rules of a room

- **Precedence is the whole of politeness.** Who goes through a door first, who sits where at the
  two feasts, who is served before whom. An insult here is deniable, permanent and free, which is
  why the great houses use it and the Warden's steward is paid so well to prevent it.
- **To drink standing is to refuse the house's welcome without saying so.** A tenant given beer in
  the hall sits with it. A man who drinks it on his feet has told the room he is not staying and is
  not accepting, and everyone present has understood him, and nobody will say a word about it for
  thirty years.
- **A knife at table, never a sword indoors.** Everyone carries a knife and eats with it. A man who
  comes armed to another man's hall is either an idiot or making a statement, and both get the same
  reception.
- **The last of the bread stays on the board.** Taking it is greed; leaving it is manners. There is
  a superstitious reason (§20) and nobody gives it.
- **The second cup** is poured at every feast and not drunk, for the house's dead of that year. In a
  bad year it is poured twice and this is remarked on for a generation.

### Hospitality, and the third night

A traveller at the door is fed. A guest is a guest for two nights. **On the third night he becomes
of the household** — he may be set to work, he eats at the low table, and he falls under the house's
low justice (§8). Both sides understand it and both sides use it: this is how the Wayfolk get a
floor, how a hired man becomes a servant without a contract, and how a house acquires a person it
would rather not have to explain.

Refusing the door is lawful and is remembered longer than almost anything else a house does.

### Oaths, greetings and what people say

Names are load-bearing and the great ones are not said, so this world swears on *objects and
records* instead: **on iron**, **on the roll** (a man's own parish entry, and the strongest oath a
commoner has), **on the weight** (Braccish), **by the road** (Wayfolk, and worthless in any court).
An oath before a keeper is the only one with teeth (§8), and everyone swears everything.

Blasphemy here is not obscenity — it is **naming**: saying one of the nine aloud, out of order, at
the wrong hour. It is the one thing that empties a room. Ordinary cursing is agricultural and mild.

At dusk, entering a house: *"Quiet to the house."* The answer is *"And to the road."* Said by
everyone, meant by almost nobody, and omitted only by a person who has just had very bad news.

### Birth, naming and death

- **A child is not named for eleven days.** Until the keeper enters it on the roll it is *the
  child*, and iron lies over the birthing-room door the whole time (§20). Half the province thinks
  this is about illness and half thinks it is not, and both halves do it.
- **Eleven days of grey.** The household wears undyed wool and the house cancels nothing, because
  work is the mourning. The dead person's place is left at the board until the next feast, and then
  filled without comment, and that is the moment the family knows.
- **A widow's year**, after which remarriage is expected rather than permitted, and a widow who
  declines is doing something legible to everyone.
- **The bees are told.** When the Head dies somebody goes to the hives before dark and says so,
  plainly, out loud. A hive that leaves in the following month is the worst domestic omen the world
  has. The custom is that you must tell them the truth — which makes the hives the one place at
  Ardwen where the family has never once been able to use the chronicle's methods.

### Feasts, fairs and play

| | |
|---|---|
| **The Thaw ball** | Wick against the next village, no rules worth the name, across three fields and the river. Bones break every year. The house is expected to be seen watching and not to interfere. |
| **The Greening feast** | Tenants at the low tables, kin up from the branch halls (§3). Round dances, pipe and tabor, the crowd bowed badly. |
| **The Bramme fairs** | Greening and Ingathering. Wrestling, the butts, hiring, and the year's marriages roughly settled at the edges of it. |
| **The butts** | Every village keeps them and the men shoot after the tenth-day rest, because the levy is what it is (§19). A house that lets its butts rot is noticed by the Warden's clerk. |
| **Hunting** | The Warden's deer are the Warden's. Boar in the house's own wood is the house's, and is genuinely dangerous. Hawking is status, priced by bird, and a lady's merlin is worth more socially than the horse she is on. |
| **Indoors** | Dice, and **tables**, and the long board with its counters, played for mites by everyone and for farms by idiots. |
| **The Slaughter feast** | The second gathering (§3), the good meat, the full grates, and the evening somebody finally says the thing (§3). |
| **The Hollow Days** | Nine nights of the Quieting. Nobody travels, nothing is decided, no contract is sealed. The last seat at the table is not filled and nobody explains why. |

### Music

Ballads are sung in **staves** and known by their first lines (§20). The instruments are pipe and
tabor, the bowed **crowd**, a plucked cittern in a rich house, and the Wayfolk's harp, which is
better than anything the nobility owns and is never said to be. Singing is participatory: a stave
sung well in a full hall is finished by the room, and a house whose people will not come in on the
turn of a song has a problem it has not yet admitted to.

---

## 24. Beasts

> **There are no monsters.** Every animal in this world is an animal. Every thing that *seems* to be
> a monster resolves, without exception, to one of five: an animal, a person, a fraud, a warranted
> practitioner, or the counterparty (§1.9). Authors may leave which one unresolved forever. They may
> not invent a sixth.

### The useful ones

| | |
|---|---|
| **Dogs** | The hall hounds, the yard dog, the shepherd's bitch who is worth more than the shepherd, the terrier kept for rats. **Dogs know first** (§20) and it is the only folk belief in the setting that is reliably correct. Treat them as the game's one honest instrument: they cannot be bribed, questioned, contradicted or entered in a book. Give a dog exactly one reaction per scene and never a second. |
| **Horses** | A riding horse is 8 crowns, a warhorse 60 (§11). The Nethering pony is small, ugly, and will still be walking when the southern horse has stopped. |
| **Oxen** | 3 crowns and the plough. Slow, enormous, and the reason a cart does ten miles a day (§6). |
| **Cattle** | 2 crowns. The drovers' whole trade, and the first thing a war takes. |
| **Sheep** | The province's actual money. Wool is what the factors come for and what pays the relief. |
| **Pigs** | Into the woodland for pannage in Smoke, killed at Slaughter, eaten all year. The most important animal at Wick and the least dignified. |
| **Bees** | The only sweetener there is (§21), and the household's conscience — see §23. |
| **Cats** | Hall, mill and church. Not pets and not named, except the mill cat, which is always named and is always named the same thing. |
| **Doves** | A dovecote is a right of a landed house, and a cause of complaint from every tenant whose seed they eat. **They are food. They do not carry messages.** Nothing beats a horse (§6). |
| **Hawks** | Status, licensed by custom rather than law, and ranked by bird. Losing one is an expensive scene. |

### The dangerous ones

| | |
|---|---|
| **Wolves** | The uplands in Frostfall and Deepwinter, and the Rimefell always. The house pays a bounty of 1 mark a head. In a wolf-year the tenants stop moving after dark and the house's authority is measured entirely by whether it does anything about it. Never say the word in winter — say *the grey*. |
| **Boar** | The house's own wood. Kills people, including well-armed people on horses, which is why hunting it is worth so much Respect. |
| **Bear** | Rimefell, and effectively gone from Aubren — which is exactly why a bear is what a story turns into. By the third generation the thing in the cellar has become a bear (§20), because a bear is the largest thing the audience can still believe. |
| **Feral packs** | Masterless dogs after a war or a bad winter, which is the closest thing to a monster this world produces, and it is a husbandry failure. |
| **Pike and eels** | The Wend and the Lag. A pike takes fingers. The eels are the Lag's income and a Bramme delicacy, and the fords are what actually kill children. |
| **Rats** | Grain loss in an ordinary year. In the Plague Age, everything. |
| **Adders** | The high pasture in Highsun. Rarely fatal, always a fortnight of fever, and every grazier has a cure and none of them work. |
| **Murrain and rot** | Cattle plague and liver fluke in the wet uplands. A murrain year costs a house more than a bad harvest and is nobody's fault, which makes it hard to write about and worth writing about. |
| **The ague** | Marsh fever out of the Lag. Comes back every summer for life. |
| **Crows** | At the assize ground, and at the burning of anything. Ubiquitous, unlucky, and never once supernatural. |

### The ones that are not there

Every one of these is believed in by somebody. None of them exists. They are included so that
authors have folklore to draw on without adding a creature to the world, and the second column is
what the scene is *actually* about.

| What people say | What it is |
|---|---|
| **The grey mare of the ford** | Takes children at the crossing below Wick. It is the Wend in Thaw, and the crossing is genuinely lethal, and the story has saved more children than the truth ever did. |
| **The Long Man** | The extra figure at the field's edge at harvest, counted and then not there. Bad light, tiredness, and the rule against counting people aloud (§20). |
| **Corpse-lights** | Over the Lag, on still nights. Marsh gas. Every Lag family has a relative who followed one. |
| **The fetch** | A person seen where they cannot be; the household expects a death within the year. Mistaken identity, or a lie told for a reason, or — very rarely, and never explained — one of the five. |
| **The Hollow-Day guest** | The reason the last seat is left empty on the nine nights. Nobody has a story about it. That is the story. |
| **The family's trouble** | Wick's own creature-explanation for iron dulling, milk turning sweet and dogs leaving a room (§14). The village is wrong about the creature and right about the house, and has been for centuries, and has always been too polite to finish the sentence. |

**Using a beast in an event.** It may frighten, kill, refuse, or leave. It may not explain, warn,
guide or judge. The moment an animal knows something the reader does not, the world has a second
magic in it — and dogs leaving a room is the whole budget, spent, permanently.

---

## 25. Naming things

New names will be needed constantly. These rules keep five centuries of invention sounding like
one world.

**Hard rules.** No apostrophes. No accents. No name that appears in Rothfuss's books or rhymes
obviously with one. Nothing that reads as modern English (`Jason`, `Tyler`) and nothing
fantasy-generic (`Aeryndril`, `Zoltek`). One or two syllables for houses, two or three for people.

| Who | Sound | Examples to build from |
|---|---|---|
| **Aubrene commoners** | Anglo-Saxon and Welsh, plain | Osric, Bertram, Hesper, Tamsin, Merrick, Eilwen, Rhoswen, Gwenna, Aldith, Colm, Maud, Wend |
| **Aubrene nobility, given names** | Norman-French over that substrate | Aumery, Gyles, Amice, Isolde, Rowan, Perrin, Alis, Daveed, Lorcan, Doran |
| **Great houses** | **One short hard word, usually a noun** — this is the strongest naming rule in the setting | Marrow, Calder, Ilm *(canon)*; Vane, Rook, Culver, Brede, Aske, Thorn, Harrow, Fen, Quill, Stannock |
| **Braccish** | Consonant-heavy, doubled letters, blunt | Brakk, Hrold, Odessen, Verrin, Karsk |
| **Anvarine** | Mercantile, Italianate-Dutch | Vasse, Loredan, Mirren, Anselm, Corte |
| **Yssene** | Soft, vowel-heavy, doubled l and s | Ellianne, Sillowen, Naressa, Yssira |
| **Marches** | Compounds and place-names as surnames | Fennow, Redgate, Ash of the Low Hold |
| **Wayfolk** | A use-name that is a thing or a trade | Pike, Kettle, Ninepence, Small Hal |
| **Places in Aubren** | English topography, invented | Bramme, Cawdry, Wick, Sarrow, Caster, Ardwen, Hesk, Coln, the Wend, the Nethering, the Lag |
| **Peoples and trades** | A plain English noun for what they do, with *the* | the fell-graziers, the colliers, the drovers, the weighers, the oath-men, the Bearers, the boat families |
| **Beasts and folk-creatures** | Plain English, or a plain English compound. **Never a coined word** | the grey, the grey mare of the ford, the Long Man, corpse-lights, the fetch |

**A person is named** *given name* + *of house* for the nobility (Lorcan of Marrow, Sable of
Marrow), *given name* alone for commoners and servants, and *given name* + trade for townsfolk
(Hal Smith, Alis the Cooper). The player's family uses given names alone in the chronicle, because
the chronicle is written from inside the house.

**Do not use nine for anything new.** Nine belongs to the counterparty, its names and its clauses,
and it is already carrying the Nine Quiet Names, the nine clauses, the Nine-Fold Seal and the
Burning of the Nine Libraries. Threes are similarly spoken for. If you need a number, use four,
seven, eleven or forty.

---

## 26. Before you commit an event

- [ ] **Where is it?** A named place from §5, or somewhere reachable from one.
- [ ] **Who has jurisdiction?** House, magistrate, Warden, Crown, or Church — and does the event
      respect the low justice / high justice line?
- [ ] **How did the outside world learn of it, and how long did that take?** (§6) Nobody reacts to
      distant news in the same scene.
- [ ] **What did it cost, in marks or crowns, against §11?** A number the player can check.
- [ ] **Is the magic in it Mystic, or a manifestation, or neither?** No third system. If a stranger
      does something impossible, they are warranted, a fraud, or the counterparty.
- [ ] **Does anything in it require technology from §7's absent list?** Especially: is anyone
      reading something printed?
- [ ] **If there is a stranger in it, which people are they, and what do they want?** (§22) *A man
      from the road* is a wasted slot.
- [ ] **If there is a beast in it, does it only frighten, kill, refuse or leave?** (§24) An animal
      that knows something is a second magic.
- [ ] **Who tells this story afterwards, and what do they get from telling it?**
- [ ] **Does it contradict the canon registry below?**

---

## 27. Canon registry — what is already fixed

Established in code and content. This file must not contradict any of it, and neither may you.

| Thing | Fixed as | Where |
|---|---|---|
| The run | 1042–1542, ~20 generations | brief, `core/src/campaign.ts` |
| The founder | **Daveed Gearithy**, born 1004, never dies, becomes the house's guardian | `characters/founding.yaml`, invariant 3 |
| The house | The player names it; **The Eldritch House** by default, `house_gearithy` | `houses.yaml` |
| Rival houses | **Marrow** (death, eminent), **Calder** (soldiers, regarded), **Ilm** (light and scholarship, regarded) | `houses.yaml` |
| The Church | **The Church of the Nine Quiet Names**, wealth 4000, exalted, wants Light and burns it | `houses.yaml` |
| Coin | 1 crown = 20 marks = 240 mites | brief §13, `core/src/economy.ts` |
| Income at Regarded | 55–70 crowns a year | `economy.ts` |
| Household size | Main hall soft cap **14**, branch soft cap **8** | `people/branches.ts` |
| The nine clauses | Named and written, one revealed per clause-bearing Age | `clauses.yaml` |
| The Ages | Long Peace, Wars, Crusade, Insurrection, Withering, Quickening, Plague | `ages/ages.yaml` |
| The Regalia | Three founding heirlooms; the **Seal** is one; needed entire for Demigod | brief §22, `arcs/seal.yaml` |
| The Burning of the Nine Libraries | Mythic, fires no earlier than 1300, reveals the Clause of the Kept Thing | `events/rites.yaml` |
| The Drowning | A rite in a forty-page book found in the second cellar; nine days; the book does not give the price | `events/rites.yaml` |
| The two feasts | The house gathers twice a year; the branches come up for both | `events/cadets.yaml` |
| The smaller house | Four miles of bad gravel, unmended for thirty years | `events/cadets.yaml` |
| The eight affinities | Fluid↔Thermal, Aero↔Terra (Elemental); Life↔Death, Light↔Darkness (Threshold) | brief §9, `attributes.yaml` |
| Who may go mad | If and only if capable of expressing Eldritch Power | brief §10, invariant 1 |
| Portions | Agelessness (240 crowns, one dose) and Fertility (170 crowns, three doses, sixty years apart) | `heirlooms.yaml`, `events/portions.yaml` |

**New in this file, and now canon:** the Reckoning and the Fall (§3), the calendar (§3), Ostane and
the Settled Lands (§4), Aubren, Bracc, Anvary, Yssanne, the Marches (§4), Ardwen, Wick, Bramme,
Cawdry, Caster, Sarrow, Corran (§5), travel rates (§6), the technology line and the absence of the
press (§7), the Assembly and the Roll of Houses (§8, §10), the Church's offices, courts and
sanctions (§9), the price table's extensions (§11), the terrier (§12), the Colleges (§15), the
records that catch a lie (§16), the sale at Sarrow (§17), the Wayfolk and the third price (§20),
the eleven peoples and the places Hesk, Coln and the Lag (§22), the third night, the second cup,
drinking standing, the eleven days and the telling of the bees (§23), and the bestiary and its five
resolutions (§24).

---

## 28. Deliberately left empty

Do not fill these in without a decision recorded in [the issue tracker](https://github.com/EldritchDynasty/EldritchDynasty/issues).

- **The nine names themselves.** They are never listed in full anywhere the player can read. The
  counting rhyme gets the order wrong on purpose. Authors may quote **one** name in a scene and it
  must be a name no other scene has used.
- **What the counterparty is.** The answer exists in the design bible and appears nowhere in
  content. Every account in the game is somebody's guess.
- **The reigning dynasty of Aubren.** A king exists in every century; naming one pins a date and
  makes the next author's job harder. Say "the King", "the King's writ", "the court at Caster".
- **A map with distances not in §5.** If you need a new place, add it here first.
- **Any second magical people, place or power.** There is not one.
- **Whether any creature in §24's third table is real.** They are not, and the file says so for the
  authors' benefit. No event may confirm it in either direction: a scene that proves the grey mare
  is only a river is as damaging as one that proves it is not, because the world's folklore has to
  stay the thing the family hides inside.
