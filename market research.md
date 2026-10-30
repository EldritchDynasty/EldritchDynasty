# Eldritch Dynasty — Market Research and Commercial Design Implications

**Research updated:** 17 October 2026 (previous revision: 3 October 2026)  
**Comparator desk-check addendum:** 30 October 2026 (§5 and sources); this is not a full refresh of the older market figures.  
**Repository context:** `main` at `e5ab83c`, the issue tracker on 17 October,
`docs/BALANCE-LOG.md`, `store/steam/README.md` and `issuesneedingowneraction`  
**Original research issue:** #184; consolidation #402  
**Currency:** all prices are in **New Zealand dollars (NZD)** unless marked
otherwise. USD figures are converted at **NZD 1.70 per USD 1**, from a 31 July
2026 market close of USD/NZD 1.7056. That is the latest rate found. Re-check
the RBNZ series before you rely on any converted figure.  
**Purpose:** find the evidence-backed ways to raise the odds that *Eldritch
Dynasty* succeeds commercially as a premium game **without turning it into a
different game**.

> **Reading order (17 Oct 2026):** the owner's priority is improving the game,
> not launching it. Release accounts are months away anyway
> (`issuesneedingowneraction`). For game work, read §4 (product-truth risks)
> and §§5–6 (comparator lessons). §§7–14 are launch evidence, kept for when
> launch comes back into focus. `Suggestions.md` turns §4 into game priorities.
>
> Commercial success cannot be guaranteed by design work. This document names
> product risks, market evidence and priorities that can improve the odds. It
> does not estimate break-even, because no development or marketing budget is in
> the repository.

---

## 0. What changed since the 3 October revision

The product moved faster than this document did. Read these first.

1. **The commercial pass is finished.** #277 closed on 17 October with all
   fourteen children done. The choice audit (#334) reached zero write-only and
   zero prose-only choices. The Examination (#343), skip-seen prose, tree
   planning, Chronicle backlinks, the Afterimage, graduated help, reading
   comfort and localisation readiness all shipped. Plain English mode shipped
   and is launch-required. The 33-year demo campaign shipped. §3 and §17 of the
   old version recommended work that is now done.
2. **Release accounts are months away.** On 16 October the owner confirmed that
   Windows signing, the Play account and upload key, Apple enrolment and **a
   Steam App ID will not be available for at least several months**
   (`issuesneedingowneraction`). No Steam store page can go live without an App
   ID. Every wishlist day before launch depends on that page. See §9.
3. **Steam changed its storefront in June 2026.** Popular Upcoming now needs
   roughly **80,000–100,000 wishlists** (reported; not Valve's published
   number). A new **Personal Calendar** recommends launches to players based on
   their own wishlists, follows and play history. For a niche game, wishlists
   from the *right* players now matter more than raw totals. See §8.
4. **Steam's AI-content disclosure was rewritten in January 2026.** Disclosure
   now covers player-facing content, including narrative text. This repository's
   prose is written in an AI-agent workflow. That is an owner decision with
   market consequences. See §12.
5. **The evidence on the summit got sharper.** Apotheosis is **1 in 512** runs
   for a bot playing only to climb, and **0 in 512** in ordinary play. The Steam
   copy and an achievement both promise it. See §4.
6. **No human playtest has been run.** Every human acceptance test was waived on
   28 September (`docs/PLAYTEST.md`). See §4.

---

## 1. What the product actually is

*Eldritch Dynasty* is **not** primarily:

- a grand-strategy conquest game;
- a tactical combat game;
- a medieval life simulator;
- a conventional visual novel;
- a genetics sandbox with a story attached.

Its identity is where three things meet:

1. **A bloodline is the player character.** The player decides across
   generations rather than living as one protagonist.
2. **Marriage and inheritance are strategic verbs.** Blood, fertility,
   affinities, branches and succession turn people into long-horizon plans.
3. **The Chronicle is both memory and evidence.** The player decides what the
   family writes, and the last night reads that record back.

The commercial thesis follows from that. The niche is plausible because the
combination is unusual. The main risk is **not too few features**. The risk is
that the combination is hard to read, repetitive, emotionally flat over a full
campaign, or **promises something the game rarely delivers**.

---

# 2. Method and evidence quality

Five evidence classes. Each figure in this document is labelled with one.

| Class | Used for | How much to trust it |
|---|---|---|
| **A. Official platform documentation** | Steam, Google and Apple rules, dates and fees; NZ government schemes | High. Rules change, so the check date is given. |
| **B. Published first-party figures** | Sales or players stated by a developer or publisher | High for what they state. *Players* are not *copies*. |
| **C. Store and review snapshots** | Review counts, scores, tags, prices | Medium. They drift. A review count is **not** a sales figure. |
| **D. Analyst and secondary reporting** | GameDiscoverCo, How To Market A Game, Sensor Tower, AppMagic, Alinea and VG Insights estimates, press summaries | Medium to low. Estimates and samples differ. Several are vendor blogs. |
| **E. Repository evidence** | What the game does and what it measures | High for this codebase on the date checked. |

**Limits of the 17 October revision.** Its page fetcher could not resolve
external hosts or Steam's store API, so the figures added then came from search
summaries, not directly inspected pages. The **30 October comparator addendum**
checked the linked Steam store listings for *Bloodweight* and *Star Dynasties*
directly, with the dated review counts in §5. That verifies **storefront claims
and metadata only**, not the mechanics, sales or player experience. Other rows
retain their original dates; do not treat the addendum as a complete refresh.

The user brief for this document asks for official sources and for skepticism
toward marketing. Several hits in this research were vendor blogs selling
localisation, testing or "Steam page analysis" services. Those are used only
where they agree with a stronger source, and they are labelled **D**.

---

# 3. Executive conclusion

A close **marketed** comparator now exists: *Bloodweight* (Steam, 20 May 2026),
which advertises generations, a Soul Teller and a lasting chronicle (C,
storefront claims; not independently played). That makes "a chronicle of your
dynasty" an insufficient standalone hook. *Eldritch Dynasty* must demonstrate
its narrower distinction early: the player chooses what the Record states,
can falsify it, and later encounters the consequences. This is a product
positioning hypothesis, not a verified feature comparison with *Bloodweight*.

1. **Protect the narrow hook. Do not broaden the genre.** *The King is Watching*
   shows a clear, consistent interaction scaling commercially: more than
   600,000 Steam copies by July 2026 (B). Its publisher credits the clarity of
   the hook.

2. **The product promise must be true in measured play.** This is new and it is
   the largest risk the repository can fix by itself. The Long Line is sold on
   its summit. The summit is reached in 0.2% of runs by a bot built to reach it
   (E). *Yes, Your Grace 2: Snowfall* (about 76% positive, C) shows what
   reviewers do when promised agency feels hollow.

3. **No real player has been observed.** Bots prove reachability, not fun. The
   cheapest high-value research left is five first-time players on the beta.3
   Windows build (E).

4. **The store page is now the long pole, not the code.** Steam's June 2026
   storefront rewards wishlists collected from matched players over time. An App
   ID that is "months away" means wishlist runway that is months shorter. The
   Steam Direct fee is **USD 100 (about NZD 170)** (A). It is the cheapest
   high-leverage owner action on the list.

5. **February 2027 Next Fest is effectively out. June 2027 is the realistic
   target.** Registration for June 2027 closes 25 April 2027 (A). Working back
   from that needs a live Coming Soon page by early 2027. See §9.

6. **AI disclosure is a live market question for this game.** Steam now asks
   about AI-generated narrative content. Player sentiment ranges from mildly to
   strongly negative depending on who is asked (D). A game *about* falsified
   records cannot afford to be caught misrepresenting its own. Disclose
   accurately. See §12.

7. **Genealogy can be the fun.** *The Roottrees are Dead* has about 96% positive
   on more than 5,000 English reviews (C). The tree and Chronicle tools that
   shipped in #268 and #269 are the right bet. Prove them with players.

8. **Mobile is a second wave, not a co-lead.** Premium mobile ports are growing
   from a tiny base, and the revenue goes to a few hits (D). Steam should lead.
   Mobile follows when its accounts exist, using the client that is already
   shared.

9. **The NZD 28–35 target is still plausible**, but recent Steam launch prices
   have drifted down (D). Price follows proven campaign quality, not the other
   way round.

---

# 4. Product-truth risks visible from the repository

These are not market data, but they decide how the market will receive the
game. All figures are class **E**.

## 4.1 The summit

| 512 × 500-year runs (BALANCE-LOG, 10–11 Oct) | Apotheosis |
|---|---:|
| ordinary (chronicler) play | 0 / 512 |
| `ascendant` policy, playing only to climb | 1 / 512 (0.2%) |
| owner target band (#332) | 8–29%, floor reported, not enforced |

Meanwhile:

- The 30 October source copy in `store/steam/README.md` now describes a
  *difficult path toward Apotheosis* and explicitly says the summit is not
  promised to every house. The earlier unqualified "complete Ascension Ladder"
  phrasing was withdrawn; the need to demonstrate a player-equivalent route in
  #1978 remains.
- Achievement `ending_all_long` needs **all five** Long Line endings. The v1
  rate table measured `ending_apotheosis` at **0/100** in every column.

**Market reading:** achievement hunters and completionists read Steam's global
unlock percentages. An achievement at roughly 0% beside the store promise is a
public, quantified version of "the choices don't matter". Pick a route before
the store page goes live: make the summit reachable for a committed player,
make it honestly mythic, or change the target on the record. `Suggestions.md`
P0-1 has the options.

## 4.2 The Long Line has no content of its own

The #274 baseline (2 October) found **no authored event or arc exclusive to the
Long Line**, and **0/12** chronicler runs reaching a Long-exclusive ending. The
500-year mode is the flagship and the longest-sell feature. If its distinct
promise comes down to "more years", players will reasonably ask why it takes so
long. The good news: 35.8% of late-Long choices had interaction shapes never
seen in the paired Short run, so the raw material is there.

## 4.3 No human evidence

`docs/PLAYTEST.md`: *"Waived means not owed, not passed. Nothing here is
evidence that any of these held."* Every commercially decisive question is in
that waived list: can a first-timer finish a Short Line unaided, do they
remember people rather than numbers, do they blame a decision rather than a
number.

## 4.4 What is already in good shape

These are commercial strengths. Say so in marketing.

- **Choices are audited.** A choice that changes nothing fails validation (#334).
- **Run two is measured.** New-event, familiar-shape choices are at 27.1%, and
  the top shape takes 4.7% (#341).
- **Plain English mode** with full counterpart coverage: an accessibility
  feature few text-heavy strategy games have.
- **Three hosts built from one client.** Windows passed fresh-VM install and
  cold resume. The Android AAB was proven. iOS save/resume was proven on the
  simulator.

---

# 5. Comparable market

Snapshot of **27 September 2026** (C) unless marked. Rows explicitly dated
**30 October 2026** are later Steam storefront spot-checks. This is not a
ranking, and review count is not a sales estimate. Store descriptions are
developer/publisher claims, not hands-on verification. Prices are presented
in their displayed USD store context, not silently converted into NZD.

| Game | Why it matters | Steam signal | Lesson for Eldritch Dynasty |
|---|---|---:|---|
| **Bloodweight** *(new, C; 30 Oct 2026)* | [Steam app 4522140](https://store.steampowered.com/app/4522140/) advertises 100 generations, one heir at a time and a Soul Teller who records the dynasty; released 20 May 2026 by adarkfable | USD 14.99 listed; **1** user review and no aggregate Steam score (C) | Chronicle and generational strategy are not distinctive words alone. Whether its chronicle can actually be altered or read back consequentially is **unverified gameplay**; no hands-on comparison or sales inference. |
| **Star Dynasties** *(new, C; 30 Oct 2026)* | [Steam app 1194590](https://store.steampowered.com/app/1194590/) describes a turn-based feudal dynasty in space, with procedural personal politics and light empire management; released 1 Sep 2021 | 421 Steam user reviews, 70% positive in the 30 Oct storefront check (C); historical listing, not sales | Long-form dynastic politics has a comparator outside fantasy. Its setting and action structure differ; no assertion of equivalent mechanics. |
| **Crusader Kings III** | Dynasty fantasy at mass scale | ~50,000 English reviews, ~90% | Recurring named people turn systems into stories |
| **Wildermyth** | Procedural people plus authored events | ~11,688 English reviews, Overwhelmingly Positive | Recurrence and transformation make procedural characters memorable |
| **Pentiment** *(new)* | Medieval, manuscript look, history told by unreliable people | ~95% of ~9,300–9,600 reviews (C, third-party trackers, Oct 2026); USD 19.99 (≈ NZD 34) | Illuminated-manuscript presentation sells text-first play. Unit estimates of 189k–275k are tracker guesses (D), not sales evidence |
| **Suzerain** | Text-heavy decisions, institutions, consequences | ~7,200 English reviews, ~93% | Dense reading sells when choices build a political identity. Mobile versions shipped Dec 2022 |
| **The Roottrees are Dead** | Family tree as the central interaction | ~5,071 English reviews, ~96% | Genealogy can be the fun if relationships are readable |
| **Yes, Your Grace** | Medieval decisions plus resource pressure | ~5,260 English reviews, ~85% | A small cast and visible trade-offs carry a compact management story |
| **Yes, Your Grace 2: Snowfall** | Broader sequel, more systems | ~1,490 reviews, ~76% | More features do not make up for a perceived loss of agency |
| **Long Live The Queen** | Repeated strategic runs through text | ~4,719 English reviews, ~94% | Failure fuels replay when the next run allows a different plan |
| **Old World** | Dynasty plus events inside strategy | ~3,950 English reviews, ~84% | Characters are strongest when the strategy layer remembers relationships |
| **The King is Watching** | One clear hook plus replay | ~3,300 English reviews, ~90%; **600k+ Steam copies (B)** | A legible hook plus long-term replay can scale |
| **The Life and Suffering of Sir Brante** | Dark text-first fantasy, consequential choice | ~2,770 English reviews, ~89% | Premium text works when consequences are severe and readable |
| **BOOK OF HOURS** | Dense occult text and systems | ~2,704 English reviews, ~89% | A patient audience exists for occult inference |
| **The Pale Beyond** | Narrative plus resource management | ~1,859 reviews, ~90% | Management must visibly change outcomes |
| **Reigns** | Very compressed recurring decisions | ~2,624 English reviews, ~84%; **600k+ sales, mostly iOS/Android (B, 2017)** | Fast repeated choice works on phones when feedback is immediate |
| **The Shrouded Isle** *(new)* | Sacrificing members of named families to an eldritch god | Mostly Positive, ~1,167 reviews (C, third-party listing) | The closest thematic neighbour. Critics said it *"drops you into its system without much explanation"*. Onboarding was its tax |
| **Darkest Dungeon** *(new)* | Lovecraftian; a culpable Ancestor narrates the family's ruin | **6 million units by Dec 2022 (B, Red Hook)** | A narrator who caused the ruin can become the brand. Daveed is that narrator |
| **Six Ages: Ride Like the Wind** | Storybook clan strategy and myth | ~460 reviews, ~81% | Biased advisers make opaque worlds learnable. Mobile-first studio |
| **Great Houses of Calderia** | Direct family-strategy comparison | ~409 reviews, ~60% | "Family grand strategy" alone is not enough. Execution and focus matter |
| **Norland** | Family-centred systemic medieval drama | ~2,900 English reviews, ~82% | A broader simulation raises expectations about complexity |

### Competitor evidence boundary and hands-on handoff (#1988)

The 30 October checks above read public [Bloodweight](https://store.steampowered.com/app/4522140/)
and [Star Dynasties](https://store.steampowered.com/app/1194590/) Steam pages
(**C: storefront snapshots**). The listed description, price and review count
are not evidence of feature execution, unit sales or audience retention. In
particular, one Bloodweight review is too small for a meaningful sentiment
summary. The earlier third-party *Star Dynasties* unit estimate is class **D**
and is not used as a measured sales figure here.

**A human with legitimate access still needs to perform the two-hour Bloodweight
teardown.** Record the date, platform, game build/version and time played;
write down the first ten minutes of onboarding and first consequential heir
choice; capture one concrete Soul Teller/chronicle entry, whether the player
can edit/omit it and whether a later scene refers back to that exact entry.
Record what was *not* encountered in the session rather than inferring absence.
On the same dated pass, record the live price, review count and rating if Steam
offers one, then sample the actual reviews with quotations/sources and a stated
denominator. Separate direct observations from developer claims and reviewer
opinions. Post the findings on #1988 for the owner to compare with the already
approved falsified-Record store positioning; **no game was purchased or played
for this addendum**.

**The useful pattern:** narrow, readable games earn exceptional sentiment.
"Dynasty" and "medieval management" do not sell themselves past confusion. Text
games sell when the interaction is coherent. The player must understand why a
decision mattered.

---

# 6. Comparator lessons that still apply

## 6.1 *The Roottrees are Dead* — the tree can be the fun

The tree is not a database screen. It is the thing the player is trying to
understand. Players praise its **graduated hint system**: a broad nudge first,
then more detail on request. Community feedback also says that a much larger
search space can overwhelm even when the deduction underneath is good.

*Eldritch Dynasty* shipped the matching tools: search, hall filters,
direct-line rooting, relevance, kinship paths (#268), and graduated in-world help
(#273). The remaining question is whether players **use** them at 50–80 living
relatives. Only a playtest answers that.

## 6.2 *The King is Watching* — the hook has to survive hour five

GameMaker's July 2026 interview with tinyBuild (B) reports a Ludum Dare origin,
more than two million browser plays, **more than 600,000 Steam copies**, about
twenty hours of average play, and a structural pivot after later-stage
playtesting showed limited appeal beyond the first hours. The publisher also
tailored localisation after strong organic interest from China.

The wrong lesson is "add roguelite progression". The right one is: **a strong
hook must survive contact with hour five, and that was discovered by playtesting
humans, not bots.**

## 6.3 *Yes, Your Grace 2* — promised agency must be acknowledged

Prominent negative reviews say big events happen whatever the player chose (C).
A choice may converge. It must still leave a remembered difference. #334 now
enforces that at the build level, which is a real competitive advantage. The
summit (§4.1) is the place where the same complaint could still land.

## 6.4 *The Pale Beyond* — every management system needs a story job

Some reviewers describe the resource layer as work that does not change the
story (C). Land, careers, books, Muster, standing, branches and rites must keep
creating different descendants, options, debts or records. The concept brief's
test still applies: *if a feature does not touch blood, the Ledger, or the
record, it is not in this game.*

## 6.5 *The Shrouded Isle* and *Darkest Dungeon* — the eldritch-family niche

*The Shrouded Isle* is the nearest thematic neighbour: houses, sacrifice, an
eldritch god. It was received as stylish but opaque. *Darkest Dungeon* sold
millions with a narrator who is the cause of the family's ruin. Together they
suggest:

- the eldritch-family fantasy has an audience;
- **onboarding is the tax** on that fantasy. The Examination and the progressive
  reveal are the right investments;
- **a guilty narrator is marketable.** Daveed — first Head, guardian spirit, the
  player all along, and not neutral — is a trailer voice and a store hook, not
  just a lore detail.

---

# 7. The Steam market in 2026

## 7.1 Size and odds

- About **19,000–20,300 games released on Steam in 2025** (D; estimates differ
  by source).
- Sensor Tower's *State of Gaming 2026* reports **USD 12 billion premium revenue
  on Steam** (≈ NZD 20.4 billion), and **+13%** growth for PC and console against
  **+1%** for mobile in-app revenue (D, analyst press release).
- Reported estimates put **about 3%** of releases ever reaching 1,000 user
  reviews (D). Median revenue figures range from about **USD 250 to USD 1,000**
  depending on method (D). Treat these as orientation, not forecasts.

**Implication:** the median Steam game makes almost nothing. Polish alone does
not move a game out of the median. Discoverability by the right players does.

## 7.2 Price drift

GameDiscoverCo found the median price of the top 50 new Steam releases fell
**from USD 19.50 to USD 15.64** between February 2023 and October 2025 (D,
reported). At NZD 1.70 that is roughly **NZD 33 → NZD 27**. Secondary reports
say Valve refreshed its regional price matrix in March 2026, the first update
since October 2022 (D).

## 7.3 Wishlists and conversion

- GameDiscoverCo (2024 sample) found a **median first-week wishlist-to-sales
  ratio of about 10.5%** for new Steam games (D). Others report 20%. Plan on
  **10–20%**.
- How To Market A Game archived its long-standing "about 7,000 wishlists at
  launch" benchmark after Steam's June 2026 change. Secondary summaries of its
  new guidance list tiers of about **5,000 / 8,000 / 50,000 / 90,000** (D).
- The owner's recorded checkpoints are **5,000 wishlists before the demo and
  15,000 at launch**, with the date moved if below 5,000 four weeks out
  (`issuesneedingowneraction`). Those sit sensibly between the published tiers.

**Illustration, not a forecast:** 15,000 launch wishlists × 10.5% ≈ **1,575
first-week units**. At an average realised price of about USD 15 after regional
pricing and discounts, minus Steam's 30%, that is about USD 16,500 to the
developer, roughly **NZD 28,000 before tax and refunds**. The point is scale. A
launch at the checkpoint funds a small team for weeks, not years. The long tail
of sales, discounts, the demo and a second platform carry the rest.

---

# 8. Steam discoverability after June 2026

Steam overhauled its store home in June 2026 (D, multiple outlets). Two changes
matter here.

1. **Popular Upcoming got much harder.** Reported thresholds rose from about
   7,000 to **80,000–100,000 wishlists** for new entries (D; not published by
   Valve). A niche text strategy game should not plan around that list.
2. **The Personal Calendar.** Valve describes it as recently released and
   upcoming games *"filtered down to the set of games we think you are most
   likely to be interested in"*, based on each user's wishlists, follows and
   play history. Early developer reports describe large single-day wishlist
   jumps and visibility that lasts about a month after launch (D, early data).

**Implications for this game:**

- **Matched wishlists beat raw wishlists.** The calendar uses play history, so a
  wishlist from someone who plays *Crusader Kings III*, *Pentiment*, *Suzerain*
  or *The Roottrees are Dead* is worth more than a generic one. Spend marketing
  effort where those players are.
- **Tags matter more.** Choose Steam tags that put the game next to those
  players' libraries: Strategy, Choices Matter, Text-Based, Dynasty,
  Lovecraftian, Medieval, Story Rich, Multiple Endings, Replay Value, Singleplayer.
  Avoid "Grand Strategy" (§15).
- **Followers count.** Ask for follows as well as wishlists in every devlog and
  demo exit screen.
- **Time on the page compounds.** Every month without a Coming Soon page is a
  month in which no matched player can wishlist the game.

---

# 9. Launch calendar and Steam lead times

## 9.1 Official Steam requirements (A)

- **Steam Direct fee:** USD 100 per app (≈ NZD 170), recoupable after USD 1,000
  adjusted gross revenue.
- **Waiting period:** first-time publishers wait **30 days** between paying the
  fee and releasing. Some third-party guides say 21; the Steamworks page says 30.
- **Coming Soon:** the store page must be public for **at least two weeks**
  before release.
- **Reviews:** store-page review typically takes 3–5 business days. Submit at
  least 7 days before you want it live. The build is reviewed separately.

## 9.2 Next Fest

| Edition | Registration | Required items in | Press preview | Festival |
|---|---|---|---|---|
| Oct 2026 | — | passed (28 Sep) | 8 Oct | **19–26 Oct 2026** (running now) |
| Feb 2027 | **10 Jan 2027** | 8 Feb | 11 Feb | 22 Feb – 1 Mar 2027 |
| **Jun 2027** | **25 Apr 2027** | 31 May | 3 Jun | **14–21 Jun 2027** |

A title can take part in **one** Next Fest only (A). Dates are from the
Steamworks pages, read through search summaries this session.

## 9.3 What the owner timeline implies

- With no App ID for "at least several months" from 16 October 2026, **February
  2027 is not realistic**. Registration closes 10 January and needs a live store
  page and a reviewed demo.
- **June 2027 works backwards like this:**
  - App ID and fee paid by **about February 2027**;
  - Coming Soon page live by **March 2027** (one or two weeks of review);
  - demo build reviewed **well before 31 May**;
  - register by **25 April**;
  - press preview from **3 June**;
  - festival **14–21 June**.
- **Why the App ID should come before signing:** Windows Authenticode, the Play
  upload key and Apple distribution are needed at *release*. The App ID is needed
  to *start the wishlist clock*. On Steam's June 2026 storefront, that clock is
  the strongest predictor this project can influence. If the owner can move one
  account forward, it should be this one.

---

# 10. Platform strategy: Windows, Android and iPhone

The owner has committed to three hosts (#277, 29 Sep). This revision adds the
market evidence the earlier version lacked.

## 10.1 What the evidence says about premium mobile

- **Premium PC-to-mobile ports are growing from a very small base:** 7 in 2024,
  23 in 2025, still about 3% of premium mobile releases (D, AppMagic via
  GameDev News).
- **Revenue goes to a few hits.** *Balatro* alone is estimated at USD 21.3
  million on mobile (D). Port publishers say known IP and awards help smaller
  games (D).
- **Text-first strategy has worked on phones:** *Reigns* sold more than 600,000,
  mostly on iOS and Android (B, 2017). *Suzerain* added mobile in 2022. *Six
  Ages* comes from a mobile-first studio.
- **Mobile overall is flat:** Sensor Tower reports mobile in-app revenue up only
  1% (D). Premium sits outside that free-to-play economy.

**Reading:** Steam leads. Mobile is a second wave that rides Steam's reviews and
any press the game earns. It is cheap here because the client is already shared
(`packages/mobile`). But it is unlikely to *find* the audience on its own.

## 10.2 Store fees and terms

| Store | Account cost | Commission (long-standing published terms; re-verify at signup) | Gate |
|---|---|---|---|
| Steam | USD 100 per app ≈ **NZD 170** | 30%, falling to 25% above USD 10M and 20% above USD 50M per title | 30-day first-release wait; two weeks Coming Soon |
| Google Play | USD 25 once ≈ **NZD 43** | 15% on the first USD 1M per year | **Personal accounts created after 13 Nov 2023 need a closed test with ≥12 opted-in testers for 14 continuous days** before production access (A; third-party guides add that dropping below 12 resets the clock) |
| Apple App Store | USD 99 per year ≈ **NZD 168** (Apple bills a local price; confirm at enrolment) | 15% under the Small Business Program, below USD 1M | Review; TestFlight for physical-device proof |

The owner chose a **personal** Play account on 14 October and plans to invite
20 or more testers as a buffer. That is the right call given the reset risk.
Treat the 14-day test as a **minimum** of three weeks on the calendar.

## 10.3 What text on phones needs

Reading on a phone is the risk, and this project has better tools for it than
most: text scale, reading font, Plain English mode, keyboard-free navigation
work. Before mobile launch, test the **tree** and the **Match** at phone width
with real players. Those are the screens most likely to collapse at that size.

---

# 11. Price

The concept brief's **NZD 28–35** band is still defensible as a working range.

- In USD terms at NZD 1.70 it is roughly **USD 16.50–20.60**, which brackets
  the USD 15.64 median of recent top launches (§7.2) and the USD 19.99 of
  comparators such as *Pentiment* and *Sir Brante*.
- Steam's NZD store prices are set per currency in Steamworks. **Read Valve's
  current NZD recommendation in the pricing tool on the day.** Do not convert by
  hand. The matrix was reportedly refreshed in March 2026.
- **Choose price by evidence, not by averaging competitors:** demonstrated
  campaign quality, *measured* human session length (none exists yet; §4.3),
  replay value, polish, localisation scope and content breadth.
- **Mobile is usually priced lower than Steam.** Plan a separate phone price
  rather than copying the Steam figure. Use the platform's own price tiers.

Do not infer competitor revenue from review counts unless a published sales
figure exists.

---

# 12. AI-content disclosure and player sentiment

## 12.1 The rule

In **January 2026** Valve rewrote the AI section of the Steam content survey
(D, multiple outlets reporting Valve's form; Valve's own text was not opened
this session):

- **Efficiency tools are out of scope.** Valve's wording is reported as
  *"Efficiency gains through the use of AI powered tools is not the focus of
  this section."* That covers AI coding assistants and workflow tools.
- **Player-facing content is in scope:** artwork, audio, **narrative elements**,
  **localisation**, marketing assets and the store page.
- There are two tiers: **pre-generated** content shipped with the game, and
  **live-generated** content made while the game runs.

## 12.2 Why it applies here

This repository is developed with AI coding agents. Its authoring skills
(`rothfuss-prose`, `lovecraftian-prose`, `eldritch-story`) exist to direct how
event bodies, interludes and frame prose are written, and the Plain English
counterparts were authored the same way. If shipped prose was generated or
substantially drafted by AI tools, the **pre-generated narrative** tier
applies. The engine generates no text live, so the live tier does not.

That determination is the owner's to make on the real authorship history. This
document does not make it.

## 12.3 How players react

The evidence is mixed and depends heavily on how the question is asked (D):

- **Quantic Foundry** panel (1,799 gamers, Oct–Dec 2025): **85%** negative, 62%
  "very negative".
- **BCG 2026** global gaming survey: much milder, with 5% negative toward
  AI-generated NPCs and dialogue. BCG attributes the gap to question wording.
- **PlayerPulse** tracking: the share saying they would refuse or be less likely
  to buy rose from about 22% (Mar 2024) to over 25% (Dec 2025).
- **An arXiv analysis of 508,192 Steam reviews** found recommendation rates of
  **68.4%** for generative-AI games against **86.3%** for procedurally generated
  ones. Some reviewers explicitly withheld recommendations in protest.
- Reported disclosure prevalence: more than 7,300 games by March 2026; about
  31% of 2026 releases.

## 12.4 Recommendation

- **Disclose accurately and specifically.** This game's whole thesis is that a
  falsified record gets proven centuries later. An undisclosed AI-prose
  discovery after launch would be the worst possible story for *this* product.
- **Say what humans did.** If the owner directed, curated, edited and rejected
  the prose, and designed the systems, the disclosure text can say so plainly.
  Specific, honest disclosures read better than vague ones.
- **Expect a review-score cost and plan for it.** Players who care will filter.
  The audience in §5 is reading-heavy and may be more sensitive than average.
  Strong craft and honesty limit the damage. Concealment multiplies it.
- **Translation:** machine or AI translation of the narrative also counts as
  disclosed content. Factor that into the localisation decision (§13).

---

# 13. Localisation

## 13.1 How big the job is (measured, E)

A word count over `packages/content/**/*.yaml` this session, counting strings of
four words or more and excluding generated `loci.yaml`:

| Register | Words |
|---|---:|
| **Original** prose | **~142,000** |
| **Plain English** counterparts | **~147,000** |

UI strings in the client and core `messages.ts` come on top.

## 13.2 What it costs

Vendor rate cards put game translation at about **USD 0.10–0.14 per source
word**, with editing and QA billed separately (D, vendor sources). That is about
**NZD 0.17–0.24 per word**.

- Translating the **Original** prose alone: about **NZD 24,000–34,000 per
  language**, before editing, LQA and UI.
- The literary register (Rothfuss plain, Dunsany elevated) is harder than
  typical game text. Budget toward the top of the range, or above it.
- Translating **both** registers roughly doubles the cost. Decide per language
  whether Plain English is offered in translation at all.

## 13.3 Which language first

- *The King is Watching* and most comparators support Simplified Chinese. Its
  publisher reacted to organic Chinese interest (B).
- Steam Hardware Survey language shares are **volatile**. In February 2026
  Simplified Chinese reportedly jumped to 54.6% and English fell to 22.3%, which
  observers treated as a sampling anomaly (D). Do not plan around one month.
- **Use the game's own wishlist geography.** Steamworks reports wishlists by
  country once the Coming Soon page is live. One more reason the App ID
  matters (§9).

## 13.4 Readiness that has already shipped

#276 and `docs/LOCALISATION.md` settled the hard architectural question: **the
saved Chronicle keeps the words the player saw.** Pseudo-localisation exists.
Plain English proves the runtime can switch prose per reader. What remains is a
**decision** — language, vendor, and whether to translate both registers — not
an engineering gap.

---

# 14. New Zealand context

## 14.1 The industry (B/D)

- The NZGDA's 2025 survey reports NZ games-industry income of **NZD 759.57
  million** for 2024/25, up 38.6%, with about **95% from international sales**,
  and full-time-equivalent jobs up 29.2% to 1,418.
- NZ On Air rebate data reportedly shows **NZD 829 million** across rebate
  studios in 2025/26 (D; secondary report, not opened directly).

NZ games are an export industry. Plan the launch for a global audience, with
NZ as one small market among many.

## 14.2 The Game Development Sector Rebate (A)

| | |
|---|---|
| Rate | **20%** of qualifying NZ expenditure |
| Minimum | **NZD 250,000** qualifying expenditure per year. Below that, nothing is paid. |
| Cap | **NZD 3 million** per firm per year |
| Year | 1 April – 31 March. One application per year. |
| Administered by | **NZ On Air** (policy: MBIE) |

**Implication:** the scheme targets mid-sized and larger studios. A team
spending under NZD 250,000 a year on qualifying NZ costs receives nothing. At
exactly the threshold, the rebate would be about NZD 50,000. Check eligibility
rules (entity type, what counts as qualifying expenditure, whether pre-release
development qualifies) directly with NZ On Air before budgeting for it.

## 14.3 Smaller programmes

The Kiwi Game Starter competition and the NZ Film Commission's Interactive
Development Fund (grants of NZD 5,000–25,000 per project in its pilot) have run
in past years. **No current 2026 rounds were confirmed** in this research. Check
NZGDA and NZFC directly.

---

# 15. Positioning

## Do not lead with "grand strategy"

That label promises maps, conquest, diplomatic breadth, military systems and
faction simulation. This game deliberately leaves most of those out.

## Better category language

- **generational strategy**
- **narrative simulation**
- **choices-matter dynasty game**
- **dark-fantasy bloodline strategy**
- **text-based strategy**
- **story rich**, **multiple endings**, **replay value**

Store line:

> **Breed a bloodline for five centuries, decide what the family writes about
> what it did, and face the creditor who kept the other copy.**

## Claims the evidence supports today

- "Every choice leaves a trace": the #334 audit enforces it at build time.
- "Your family is a genome, not a stat block": invariant-backed.
- "The record you falsify is read back at the end": #45, the Reckoning.
- "Plain English mode": shipped, full coverage.

## Claims to hold back until measured

- "Ascend to godhood" or "the complete Ascension Ladder" (§4.1).
- Any session-length claim. No human session has been timed.
- Any claim about the Long Line's distinct content (§4.2).

---

# 16. Visual merchandising: the store page has to prove this is a game

Steam's trailer guidance (A) says a Discovery Queue impression may get **less
than ten seconds**, that the trailer should work **without audio**, and that the
**first trailer should be primarily gameplay**. The first two trailers appear
before screenshots on the store page.

> **The player must be able to see state changing before they have read a
> paragraph.**

## 16.1 The strongest surfaces

1. **The family tree as change over time**: marriages, branches, deaths,
   sacrifices, one highlighted line.
2. **The Match as three futures.**
3. **Record / Omit / Embellish** shown next to the page it writes.
4. **A delayed callback**: an old page beside the later consequence that cites
   it. The most distinctive proof that choices matter.
5. **A rite**: before, decision, after, and a named person spent.
6. **The House Afterimage.** Today it is seven counts and a quote. A version
   that names people (`Suggestions.md` P1-1) makes a far better press and social
   image.

## 16.2 Visual language should carry information

Each element answers **who matters? what changed? what did this cost? what is
the house trying to do? what is remembered?**

- **blood / lineage:** branching lines, seals, silhouettes, inherited marks (the
  game has no faces; keep it that way);
- **debt / Ledger:** ruled pages, clauses, countersigns;
- **record:** ink, blanks, overwritten lines, marginalia, conflicting copies;
- **Ages:** typography, page material, illumination and wear that make a new Age
  readable before a label explains it;
- **rites:** changes in framing, spacing and motion.

*Pentiment* is the commercial proof that a manuscript look can carry a
text-first game (§5).

## 16.3 Steam asset rules (A, as of 3 Oct)

- Screenshots **1920×1080 or larger, 16:9**, showing actual gameplay.
- Base capsules carry **artwork and the logo only**. No taglines, scores,
  awards or discount text.
- About-section images around **1170 px wide** for high-DPI screens. Text baked
  into images means extra localisation work.

`store/steam/README.md` lists every capsule as **TODO**. The Play listing
already has real played-run screenshots (#1743). Reuse the *method*, not the
images: Steam's base capsules forbid the Play feature graphic's tagline.

## 16.4 The seven-image proof set

| Proof | The viewer should understand, without a caption |
|---|---|
| Bloodline | this family has changed over generations |
| Match | these candidates lead to different futures |
| Record | the player controls what history claims |
| Callback | the game remembers an old act |
| Ambition | the house is trying to reach something over decades |
| Rite | a named person is being deliberately spent |
| Ending | this completed house has a specific story |

If all seven look like "a paragraph in a parchment panel", the visual design
still has a commercial problem, however good the systems are.

---

# 17. Trailer

Show the interaction that proves the prose is a game:

1. the family tree grows across generations;
2. three Match candidates imply different futures;
3. the player chooses one;
4. a child or branch consequence appears;
5. Record / Omit / Embellish changes the page;
6. the old wording returns later as a consequence;
7. a named relative is spent in a rite;
8. Daveed's voice on the last night reads the Chronicle;
9. several visibly different Afterimages.

Answer *"What do I do?"* before *"How well is it written?"* Capture from the real
client only. No mock UI.

---

# 18. Demo strategy

## 18.1 What exists (E)

The `demo` campaign (`core/src/campaign.ts`) is a **33-year** miniature,
1042–1075. It opens with the existing Insurrection Age, Daveed crosses to
guardian in 1043, a forced Record decision comes in 1044, an interlude reads that
page in 1045, and the verdict comes by 1075. It is verified on 64 seeds in both
prose modes. **It is not yet offered by any build.** A Steam demo is a separate
app under the main App ID, so it waits on that too.

## 18.2 Conversion evidence (D)

How To Market A Game's June 2026 Next Fest analysis put demo-player-to-wishlist
conversion at a **median of about 19.3%** (30th percentile 15.9%, 70th 23.2%),
and warned **against over-reading the percentage**. Reach matters more.

## 18.3 Recommendations

- Optimise the demo to prove **one complete Eldritch shape**: debt, a person, a
  Match, a choice, Record, an echo, the frame, and a forward problem. Do not aim
  for a fixed minute count.
- The demo guarantees the signing, the Record and the interlude by design. Check
  that a **person**, a **Match** and an **echo** land, with humans.
- **End on an ask:** wishlist *and* follow (the Personal Calendar reads both).
- **Do not transfer the save.** The miniature compresses an Age and fixes
  Daveed's death date, so it is not a canonical opening. Consider entering the
  finished demo house into the **Library of Houses**, so the full game remembers
  it without a head start.

---

# 19. Accessibility and reading comfort

Text is the interface. Reading comfort is to this game what input latency is to
an action game. Shipped: text scale, reading font, reduced motion, keyboard
paths, focus styles, skip-seen prose, ARIA naming across tree, Chronicle, Plat
and Muster (dozens of closed issues in October), and **Plain English**.

Still unproven: the waived **full screen-reader run with the display off, by a
non-team tester** (`docs/PLAYTEST.md`). Accessibility is also a marketing claim
on Steam and the mobile stores. Run that test before making the claim.

---

# 20. What should be measured before launch

**Run once, with humans (none so far):** five first-timers on a Short Line; one
screen-reader run; one mobile session per platform at phone width.

**First session:** time to the first Match, the first Record and the first echo;
the point where the player can name their next move; the three people they
remember.

**Agency (instruments):** the #334 audit holds at zero; option divergence;
callback rate; recoverable-source rate.

**Pacing (instruments):** spine gap, shape streak, stall duration.

**Replay (instruments):** `gate:replay` familiarity ≤ 27.1%; top shape ≤ 4.7%;
time to first unseen context.

**Endgame (instruments):** Apotheosis and Unmade under chronicler *and*
ascendant play; Long-exclusive reach under chronicler play.

**Steam (aggregate platform data, once a page exists):** wishlists by country;
follows; Next Fest demo players and median playtime; demo-to-wishlist conversion
as **context**, not a pass/fail score.

---

# 21. What not to add

- **Tactical combat.** War already matters through Muster, family cost and
  consequences.
- **A conventional world map as the centre.** The tree, Chronicle and Plat are
  more distinctive.
- **Relationship bars for everyone.** Named relationships and remembered
  grievances instead.
- **A generic roguelite upgrade tree.** The Library of Houses changes history,
  not starting power.
- **Currencies for "depth".** Every meter competes with blood, record and debt.
- **Hiding every rule in the name of mystery.** Mystery is not incomprehension.
- **More ordinary event templates as the default repetition fix.** Content
  breadth is already large (487 non-frame events). Improve context, callbacks
  and shape.

---

# 22. Product decision rule

1. Does this make **blood**, **the debt/Ledger** or **the record** more
   interesting?
2. Does it create a decision the player can tell apart from an existing one?
3. Can the consequence be remembered later?
4. Does it help one of the five feelings — *I have a plan; this person matters;
   that happened because of me; this generation is different; I want to see how
   this ends*?
5. Will it make a second run meaningfully different?
6. Can the player understand it without an external wiki?
7. Is it worth the extra cognitive load?
8. **Is every store or achievement claim it supports true in measured play?**

If the first three answers are no, it is unlikely to improve the commercial
product.

---

# 23. Bottom line

The market evidence does **not** say Eldritch Dynasty needs to be broader. It
says the opposite. The games with the strongest lessons succeed because players
can describe what they do:

- *Crusader Kings III*: dynastic stories from people and succession.
- *Wildermyth*: procedural heroes become specific legends.
- *The Roottrees are Dead*: reconstruct a family through a tree.
- *Suzerain*: political decisions you live with.
- *The King is Watching*: only what the king watches works.
- *Darkest Dungeon*: your ancestor ruined the family, and he narrates it.

The sentence Eldritch Dynasty should earn:

> **I bred this family, lied about what it did, and centuries later the lie came
> back when the debt was read.**

October 2026 changed the *order* of the work. The systems are largely built.
What is left is:

1. **make the claims true** (the summit, the Long Line);
2. **watch people play it**;
3. **open the store page early enough** for Steam's new storefront to find the
   right players;
4. **be honest about how it was made.**

---

# 24. Sources

Checked **25–27 September 2026** (comparators), **3 October 2026** (Steamworks
merchandising), and **17 October 2026** (everything marked *new*). The
17 October checks used search-engine summaries of the pages below because the
page fetcher could not reach external hosts. Open them before acting on a figure.

## Repository (E)

- `docs/BALANCE-LOG.md`: 2026-10-02 (#274 Short vs Long), 2026-10-06 (#341
  closeout), 2026-10-07 (#540 achievement rates), 2026-10-10 and 2026-10-11
  (#332, #378), 2026-10-17 (commercial-pass completion)
- `docs/PLAYTEST.md`: the waived human tests
- `store/steam/README.md`: store copy and asset checklist
- `issuesneedingowneraction`: owner-only release steps and commercial checkpoints
- `packages/core/src/campaign.ts`, `packages/core/src/achievements.ts`,
  `packages/client/src/lib/book.ts`, `packages/client/src/lib/game.ts`
- Issues #277, #323, #332, #334, #341, #378 (all closed by 17 Oct 2026)

## Official platform and government (A)

- Steamworks, **Steam Next Fest: February 2027** —
  https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/feb_2027 *(new)*
- Steamworks, **Steam Next Fest: June 2027** —
  https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/june_2027 *(new)*
- Steamworks, **Steam Next Fest: October 2026** —
  https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/2026october
- Steamworks, **Steam Direct** — https://partner.steamgames.com/steamdirect *(new)*
- Steamworks, **Releasing your game** — https://partner.steamgames.com/doc/store/releasing *(new)*
- Steamworks, **App fee** — https://partner.steamgames.com/doc/gettingstarted/appfee
- Steamworks, **Trailers** — https://partner.steamgames.com/doc/store/trailer
- Steamworks, **Graphical Assets – Overview** — https://partner.steamgames.com/doc/store/assets
- Steamworks, **Graphical Asset Rules** — https://partner.steamgames.com/doc/store/assets/rules
- Steamworks, **Store Page Written Description** — https://partner.steamgames.com/doc/store/page/description
- Steamworks, **Store Page Extra Asset Management** — https://partner.steamgames.com/doc/store/page/assets
- Google Play Console Help, **testing requirements for new personal accounts** —
  https://support.google.com/googleplay/android-developer/answer/14151465 *(new)*
- Apple Developer, **membership and fee waiver** — https://developer.apple.com/support/fee-waiver *(new)*
- NZ On Air, **Game Development Sector Rebate** —
  https://www.nzonair.govt.nz/funding/game-development-sector-rebate-scheme-gdsr/ *(new)*
- MBIE / NZ On Air, **GDSR design features** —
  https://www.nzonair.govt.nz/documents/1031/FINAL_Game_Development_Sector_Rebate__Design_Features.pdf *(new)*

## Published first-party figures (B)

- GameMaker, **"The King Is Watching From Game Jam to 600k Sales"**, 9 July 2026 —
  https://gamemaker.io/en/blog/the-king-is-watching-tinybuild
- Yes, Your Grace, **100,000 Snowfall wishlists**, 4 April 2024 —
  https://store.steampowered.com/news/posts/?enddate=1712250352&feed=steam_community_announcements
- Red Hook Studios, **Darkest Dungeon 6 million units (Dec 2022)**, as reported —
  https://wnhub.io/news/investment/item-45054 *(new)*
- Nerial, **Reigns 600,000+ sales, mostly mobile** —
  https://www.gamedeveloper.com/business/-i-reigns-i-sells-big-on-mobile-proves-premium-games-can-still-be-king *(new)*
- NZGDA, **NZ game development industry breaks records (2025 survey)** —
  https://www.nzgda.com/blog/new-zealand-game-development-industry-breaks-records *(new)*

## Store snapshots (C)

- Bloodweight — https://store.steampowered.com/app/4522140/ *(direct store spot-check, 30 Oct 2026; gameplay unverified)*
- Star Dynasties — https://store.steampowered.com/app/1194590/ *(direct store spot-check, 30 Oct 2026; reviews are not sales)*
- Crusader Kings III — https://store.steampowered.com/app/1158310/
- Wildermyth — https://store.steampowered.com/app/763890/
- Pentiment — https://store.steampowered.com/app/1205520/ *(new)*
- Suzerain — https://store.steampowered.com/app/1207650/
- The Roottrees are Dead — https://store.steampowered.com/app/2754380/
- Yes, Your Grace — https://store.steampowered.com/app/1115690/
- Yes, Your Grace 2: Snowfall — https://store.steampowered.com/app/1373090/
- Long Live The Queen — https://store.steampowered.com/app/251990/
- Old World — https://store.steampowered.com/app/597180/
- The King is Watching — https://store.steampowered.com/app/2753900/
- The Life and Suffering of Sir Brante — https://store.steampowered.com/app/1272160/
- BOOK OF HOURS — https://store.steampowered.com/app/1028310/
- The Pale Beyond — https://store.steampowered.com/app/1266030/
- Reigns — https://store.steampowered.com/app/474750/
- The Shrouded Isle — https://store.steampowered.com/app/501320/ *(new)*
- Six Ages: Ride Like the Wind — https://store.steampowered.com/app/881420/
- Great Houses of Calderia — https://store.steampowered.com/app/1812910/
- Norland — https://store.steampowered.com/app/1857090/
- Community reviews used directionally: Snowfall
  (https://steamcommunity.com/app/1373090/reviews/), The Pale Beyond
  (https://steamcommunity.com/app/1266030/reviews/), The Roottrees are Dead
  (https://steamcommunity.com/app/2754380/reviews/), The King is Watching
  (https://steamcommunity.com/app/2753900/reviews/)

## Analyst and secondary (D)

- How To Market A Game, **How the Steam Personal Calendar affects your launch**,
  25 June 2026 — https://howtomarketagame.com/2026/06/25/how-the-steam-personal-calendar-affects-your-launch/ *(new)*
- How To Market A Game, **ARCHIVE: how many wishlists should I have at launch** —
  https://howtomarketagame.com/2026/06/25/archive-how-many-wishlists-should-i-have-when-i-launch-my-game/ *(new)*
- How To Market A Game, **June 2026 Next Fest demo analysis**, 30 June 2026 —
  https://howtomarketagame.com/2026/06/30/nobody-plays-demos-and-that-is-ok/
- GamesRadar, **Popular Upcoming now ~15× harder** —
  https://www.gamesradar.com/games/valve-made-it-roughly-15-times-harder-for-indie-games-to-reach-a-coveted-steam-ranking-but-one-expert-says-an-understated-new-steam-feature-is-doing-gods-work/ *(new)*
- KitGuru, **Valve announces Steam Personal Calendar** —
  https://www.kitguru.net/desktop-pc/mustafa-mahmoud/valve-announces-new-steam-personal-calendar-recommendations-system/ *(new)*
- GameDiscoverCo via GameDev Reports, **wishlist conversion benchmarks** —
  https://gamedevreports.substack.com/p/gamediscoverco-conversion-benchmarks *(new)*
- GameDiscoverCo via GameDev Reports, **spending and price trends** —
  https://gamedevreports.substack.com/p/gamediscoverco-people-are-spending *(new)*
- Sensor Tower, **State of Gaming 2026** —
  https://sensortower.com/press/press-release-sensor-tower-state-of-gaming-gaming-drove-52-billion-downloads-82b-iap-revenue-on-mobile-and-12b-premium-revenue-on-steam *(new)*
- GameDev News (AppMagic data), **Premium mobile releases up 77% in 2025** —
  https://gamedev.net/news/premium-mobile-games-are-back-with-releases-up-77-in-2025-r4367/ *(new)*
- Notebookcheck, **Steam AI disclosure form update** —
  https://www.notebookcheck.net/Steam-updates-AI-disclosure-form-requiring-developers-to-report-visible-and-in-game-AI-but-not-background-tools.1206103.0.html *(new)*
- Digital Watch, **New Steam rules redefine when AI use must be disclosed** —
  https://dig.watch/updates/new-steam-rules-redefine-when-ai-use-must-be-disclosed *(new)*
- arXiv, **Player Perceptions of Generative AI in Games: A Steam Review Analysis** —
  https://arxiv.org/html/2608.11539 *(new)*
- GameSpot, **GenAI in games? Most players just don't care, study finds** (BCG) —
  https://www.gamespot.com/articles/genai-in-games-most-players-just-dont-care-study-finds/1100-6538972/ *(new)*
- Boing Boing, **Survey finds "very negative" attitude toward generative AI** (Quantic Foundry) —
  https://boingboing.net/2025/12/20/survey-finds-very-negative-attitude-toward-gen-ai-in-games.html *(new)*
- GamingOnLinux, **Steam survey Feb 2026 swing to Simplified Chinese** —
  https://gamingonlinux.com/2026/03/steam-survey-for-february-2026-shows-a-big-swing-to-simplified-chinese *(new)*
- Pentiment review and estimate trackers (conflicting; estimates only) —
  https://raijin.gg/app/1205520/Pentiment and https://steampulse.org/game/1205520 *(new)*
- Localisation rates (vendor rate cards; quote several vendors) —
  https://allcorrectgames.com/localization-pricing/ and https://alconost.com/en/blog/localization-cost *(new)*
- Exchange rate, USD/NZD history 2026 —
  https://www.poundsterlinglive.com/history/USD-NZD-2026 *(new; re-check against RBNZ)*

## Design background

- Game Developer, **"From let's play to let's pay"** —
  https://www.gamedeveloper.com/business/from-let-s-play-to-let-s-pay-on-designing-financially-successful-narrative-games
- Game Developer, **"In narrative games, self-expression doesn't mean 'empowerment'"** —
  https://www.gamedeveloper.com/design/in-narrative-games-self-expression-doesn-t-mean-empowerment-
- GDC Vault, **"Level Design Workshop: The Illusion of Choice"** —
  https://gdcvault.com/play/1023552/Level-Design-Workshop-The-Illusion

---

## Evidence caution

Store scores and counts are snapshots and will change. A sales figure is
treated as sales evidence only where the developer or publisher stated it.
**Players are not copies:** subscription launches inflate player counts, as
*Blue Prince*'s "2 million players" did through Game Pass and PS Plus. Tracker
estimates of owners or revenue (VG Insights, Gamalytic, SteamSpy derivatives)
are labelled as estimates and never used as the basis of a decision here.
