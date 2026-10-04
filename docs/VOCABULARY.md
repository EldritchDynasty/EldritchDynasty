# VOCABULARY

**Generated — run `npm run gen:docs`. Do not edit.**

Every closed vocabulary in the game, read off the schemas that define them.
Written so that authoring content or wiring an effect needs this file and
not `event.ts`, `conditions.ts`, `frequency.ts`, `person.ts` and `attributes.ts`.

`T?` optional · `T = x` defaults to x · `T[]` array · `A|B` one of

## Effects

What an outcome may do. The union is closed; `applyEffect` in
`core/src/events/effects.ts` ends in `assertNever`, so adding a kind is a
compile error until it is handled.

| kind | fields |
|---|---|
| `attribute` | `target: Target` `attr: string` `delta: number` |
| `trait` | `target: Target` `trait: string` `op: add\|remove` |
| `status` | `target: Target` `status: string` `cause: string?` |
| `madness` | `target: Target` `delta: number` |
| `awakening` | `target: Target` |
| `heirloom` | `op: grant\|use\|transfer = "grant"` `heirloom: string` `to: string?` |
| `spellbook` | `op: gain\|study\|lose\|degrade` `target: Target` `book: string` |
| `career` | `target: Target` `op: assign\|leave = "assign"` `career: string?` |
| `bond` | `target: Target` `op: bind\|free` `marks: number = 100` |
| `marriage` | `op: "end"` `target: Target` |
| `priorityMatch` | `target: Target` |
| `treasury` | `delta: number` |
| `respect` | `delta: number` |
| `flag` | `flag: string` `set: boolean \| number \| string` |
| `relationship` | `from: Target` `to: Target` `sentiment: number?` `grudge: {severity, inheritance}?` |
| `chronicle` | `text: string` |
| `knowledge` | `op: grant\|revoke` `flag: string` |
| `discrepancy` | `op: create\|prove\|bury` `id: string?` `severity: minor\|major\|total?` `provableBy: string[]?` |
| `rumour` | `op: seed\|feed\|correct` `id: string` `accuracy: number?` |
| `clause` | `reveal: string` |
| `branch` | `op: appease\|slight` `slot: string?` `amount: number = 10` |
| `recast` | `slot: string` |
| `rite` | `rite: vessel\|great_rite\|unmaking` `ascendant: string` `subject: string?` `cause: string?` |
| `schedule` | `event: string` `inYears: number` |
| `arc` | `op: start\|advance\|cancel` `arc: string` |
| `arc_flag` | `flag: string` `set: boolean \| number \| string` |
| `forge_lineage` | `target: Target` `parent: mother\|father` `claimedAs: string` `notarisedBy: string` `generations: number = 3` |
| `tutor` | `target: Target` `attr: string` `op: begin\|cancel` |
| `muster` | `op: begin\|reinforce\|add_officer\|set_position\|settle\|withdraw` `men: number?` `age: string?` `from: string?` `officer: Target?` `position: string?` |
| `land` | `op: grant\|seize\|damage\|restore\|encroach` `parcel: string` `magnitude: number?` |

**Target** — who an effect lands on: `{ slot }`, `{ all }`, `head`, `household`, `all_blood`, `children_of_head`.

## Conditions

Gate an event, an Age onset or an arc successor on world state. Named by
which key is present. `all` / `any` / `not` nest.

| condition | shape |
|---|---|
| `all` | `all: Condition[]` |
| `any` | `any: Condition[]` |
| `not` | `not: Condition` |
| `flag` | `flag: string` `is: boolean?` |
| `knowledge` | `knowledge: string` `has: boolean` |
| `respect` | `respect: {op, tier}` |
| `year` | `year: {op, value}` |
| `campaignProgress` | `campaignProgress: {op, value}` |
| `generation` | `generation: {op, value}` |
| `treasury` | `treasury: {op, value}` |
| `clausesRecovered` | `clausesRecovered: {op, value}` |
| `familyAny` | `familyAny: {attr, atLeast}` |
| `familySize` | `familySize: {op, value}` |
| `bloodCount` | `bloodCount: {op, value}` |
| `inRegency` | `inRegency: boolean` |
| `hasExpressingHead` | `hasExpressingHead: boolean` |
| `cadetBranches` | `cadetBranches: {op, value}` |
| `branchGrievance` | `branchGrievance: {op, value}` |
| `discontent` | `discontent: {op, value}` |
| `grudgeAgainstUs` | `grudgeAgainstUs: {op, value}` |
| `ageActive` | `ageActive: string` |
| `ageRegister` | `ageRegister: warm\|cold\|institutional` |
| `ageElapsed` | `ageElapsed: {op, years}` |
| `ageStacked` | `ageStacked: {op, count}` |
| `agesElapsed` | `agesElapsed: {op, value}` |
| `ageNamed` | `ageNamed: boolean` |
| `discrepancy` | `discrepancy: string` `state: open\|proven\|buried?` |
| `openDiscrepancies` | `openDiscrepancies: {op, value}` |
| `assize` | `assize: {op, value}` |
| `bearing` | `bearing: {op, value}` |
| `unheard` | `unheard: {op, value}` |
| `ascension` | `ascension: {atLeast, best}` |
| `arcFlag` | `arcFlag: string` `is: boolean \| number \| string?` |
| `arcVisited` | `arcVisited: string` |
| `unlocked` | `unlocked: string` |
| `posts` | `posts: {op, value, career}` |
| `postHeldFor` | `postHeldFor: {career, op, years}` |
| `holdsParcel` | `holdsParcel: string` |
| `acreage` | `acreage: {op, value}` |
| `arcCanFinish` | `arcCanFinish: string` |

## Filters

Narrow a slot's candidates, or an heirloom's eligible bearers. Run against
one person at a time.

| filter | shape |
|---|---|
| `attr` | `attr: string` `op: lt\|lte\|eq\|gte\|gt\|ne` `value: number` |
| `trait` | `trait: string` `has: boolean` |
| `tag` | `tag: string` `has: boolean` |
| `sex` | `sex: male\|female` |
| `age` | `age: {op, value}` |
| `status` | `status: string[]` |
| `membership` | `membership: string[]` |
| `career` | `career: string[]` |
| `awakened` | `awakened: boolean` |
| `canExpress` | `canExpress: boolean` |
| `bonded` | `bonded: boolean` |
| `rung` | `rung: {atLeast}` |
| `rite` | `rite: {taken}` |
| `relation` | `relation: not\|child_of\|descendant_of\|sibling_of\|spouse_of\|blood_of` `of: string` |
| `exceeds` | `exceeds: {of, on}` |
| `taught` | `taught: {attr}` |
| `inTerm` | `inTerm: boolean` |
| `all` | `all: Filter[]` |
| `any` | `any: Filter[]` |
| `not` | `not: Filter` |

## Who decides

`decidedBy` on a `choice` or `dispatch` interaction. Orthogonal to the
interaction kind: the shape says how many branches there are and whether the
player casts them, the decider says who takes one. Source:
`schema/src/decider.ts`, evaluated by `core/src/events/deciders.ts`.

| decider | shape | what it means |
|---|---|---|
| `player` | `decidedBy: player` | The docket stops the clock and asks. The default, and what a choice event has always been. |
| `chance` | `decidedBy: chance` | A weighted draw over the branches, each worth the sum of its outcomes' weights. |
| `state` | `decidedBy: { state: [{when: Condition?, take: string, because: string?}] }` | A ladder, read top down: the first rung whose `when` holds takes the branch it names. A final rung with no `when` is the else. The family's own condition decides. |
| `party` | `decidedBy: { party: { check: string } }` | The player casts the `castBy: player` slots — that is his decision — and the named Check, pooled over exactly those people, picks the branch. Its bands name CHOICE ids, not outcome ids. |

## Trees of events

An arc successor asks what happened in the parent. Every guard present must
hold, and exactly one successor is taken. Source: `schema/src/arc.ts`.

**Successor** — `to: string` · `when: Condition?` · `fromOutcome: string?` · `fromChoice: string?` · `fromTag: string?` · `weight: number = 100`

`Outcome.next` is the short form: `{event, after, keep}` on an outcome
compiles into a real arc before the engine sees it (`schema/src/desugar.ts`),
so a two-beat scene needs no arc file and there is still one thing that runs
a tree. `keep` names the slots cast with the same people in the follow-up.

## Frequency

A rationing tier, not a weight synonym. It reaches into scheduling,
presentation, folklore and whether a Record choice is required.

| tier | cap | cooldown | record block | folklore | chronicle |
|---|---|---|---|---|---|
| `common` | none | none | forbidden | never | line |
| `uncommon` | none | 12 yr | optional | optional | paragraph |
| `rare` | 22/run | 30 yr | required | always | page, named |
| `mythic` | 3/run | 170 yr | required | always | illuminated, named |

## Enumerations

**SlotRole** — `head` · `family_member` · `spouse` · `child` · `sibling` · `cadet` · `unwoken` · `retainer` · `rival_house` · `outsider` · `heirloom` · `spellbook` · `tutor` · `rival` · `fragile` · `the_match` · `listener_record` · `listener_blood` · `guardian` · `foremost` · `second_foremost` · `newly_placed` · `newly_taught` · `set_to_a_book` · `sole_heir_unwed` · `sole_heir_spent`
<br>Who a slot may cast. `core/src/events/slots.ts` narrows the pool.

**Purpose** — `advance_clause` · `change_relationship` · `worldbuild_through_action` · `establish_magic_rule` · `test_magic_rule` · `change_standing` · `plant_rumour` · `force_record_choice` · `buy_patience`
<br>Every template declares exactly three, all distinct.

**EventTier** — `individual` · `head` · `family` · `record` · `frame`
<br>`frame` events run in their own year phase, gated by `reads` rather than `conditions`.

**Frequency** — `common` · `uncommon` · `rare` · `mythic`
<br>A rationing tier, not a weight synonym. See the table below.

**ChronicleWeight** — `line` · `paragraph` · `page` · `illuminated`
<br>How an entry renders. Decided by frequency, not authored.

**RespectTier** — `unknown` · `known` · `regarded` · `eminent` · `exalted`
<br>Ordered. Decay floors at `known`; `unknown` has to be done to you.

**Register** — `warm` · `cold` · `institutional`
<br>An Age's texture. Two Ages of one register never run consecutively.

**CompareOp** — `lt` · `lte` · `eq` · `gte` · `gt` · `ne`

**Sex** — `male` · `female`

**PersonStatus** — `alive` · `dead` · `vessel_consumed` · `missing` · `given_to_church` · `ascended` · `guardian`
<br>`guardian` is the Narrator after he crosses over — never `alive` again.

**MembershipKind** — `blood` · `married_in` · `retainer` · `ward` · `hostage` · `clergy` · `cadet` · `none`
<br>One OPEN record per person. Two puts them in two halls at once.

**RetainerRole** — `tutor` · `steward` · `guard` · `midwife` · `archivist` · `singer` · `physician` · `chronicler`
<br>An `archivist` in post is what makes an Age pay its clause.

**AttributeKind** — `core` · `affinity` · `eldritch` · `derived` · `hidden`
<br>The list of attributes is open; nothing in the engine counts them.

## The year

In order. Each phase draws from its own RNG stream, seeded from its name.
Source: `core/src/year/phases.ts`.

| # | phase | after | why |
|---|---|---|---|
| 1 | `ages` | — | An Age is the weather every other phase happens in, so it is decided first. |
| 2 | `lifecycle` | `ages` | Awakening, Madness and mortality all read the year the Age has just set. |
| 3 | `guardian` | `lifecycle` | He can only have crossed over in the pass that tried to kill him. |
| 4 | `quarrels` | `lifecycle` | Grudges pass to the living and posts fall vacant, both on this year's deaths. |
| 5 | `secrets` | `quarrels` | A secret can only walk out with somebody, and `quarrels` is where service ends. Loyalty moves here too, so a year of arrears is priced before the next year's releases read it (`people/secrets.ts`). |
| 6 | `papers` | `secrets` | A forged pedigree is caught the way a secret walks out — by somebody with a motive putting two records side by side (world §16). Runs after `secrets` so both leave the house through the same kind of year, and before `assize`, so the world reads a house whose papers have just been questioned as the house it now is (`people/papers.ts`). |
| 7 | `assize` | `ages` | The world reads the house as the Age has just left it, and before anything this year spends. |
| 8 | `bearing` | `assize` | Bearing is read off acts already taken and halls already angry, so it runs after the Assize has settled the year's standing and before the Match deals a hand against it. It draws no dice. |
| 9 | `careers` | `quarrels` | A career's income and Respect are owed to whoever is still living after this year's dead are settled, and `economy` needs the treasury they add before it tallies the year (issue #16). |
| 10 | `table` | `careers` | A term finishes for whoever is alive after `lifecycle`, and a reader is set to a book at the pace of whichever post `careers` has just given him. |
| 11 | `library` | `careers`, `table` | A book finished this year is finished by whoever is still alive after `lifecycle`, and by whichever career they held when `careers` settled — a Scholar who left the post mid-book still read it at a Scholar's pace, because the years were spent when the study began. |
| 12 | `muster` | `ages`, `careers` | A commitment is settled against the Age that ended and the officers who are still alive, and `economy` must see this year's war upkeep in its tally (issue #89, Stage 2 — #95). Fully dormant with no commitment standing — no draw, no write, no chronicle line — which is the free regression test: a run that never musters must digest bit-identical to one that never had this phase at all. |
| 13 | `land` | `ages` | `economy` reads what the house holds this year, so land settles before it (issue #93). The market opens and expires here, and a term of improvement completes here, on this phase's own reserved stream (issue #94, Phase B) — tenant risk and loss (issue #91, Phase D on) land inside it too, rather than reshuffling the table around them. |
| 14 | `economy` | `careers`, `land`, `muster` | Wages are owed to whoever is still in post after the contracts settle, and the annual tally comes last so it sees career and war upkeep too. Condition then reads the closed books before this year's birth roll. |
| 15 | `auction` | `economy` | Bidding spends the treasury `economy` just tallied, and a lot bought this year should show up in the same year's chronicle as everything else that happened to the house (issue #17). |
| 16 | `succession` | `lifecycle` | The seat and the recurring cast refill on this year's vacancies. Without this the head, tutor and rival slots empty within a generation and the event pool silently collapses to nothing. |
| 17 | `branches` | `succession` | A son leaves the year his brother takes the seal, and not before. |
| 18 | `rivals` | — | Rival-house descent (issue #24 item 6) draws from its own stream and reads nothing else this year has settled, so it has no real dependency — it runs before `marriage` only so a lineage member who came of age this year is already there when a card is dealt for her. |
| 19 | `marriage` | `branches` | A bride joins the hall her husband is in, which the split has just decided. |
| 20 | `births` | `marriage` | A couple married this spring may conceive this year. |
| 21 | `arcs` | `births` | A substory casts from the living, and this year's dead and born are settled. |
| 22 | `ambient` | `arcs` | Substories get the year's attention before the ambient pool spends any of it. |
| 23 | `frame` | `ambient` | The frame reacts to the record — it has to run after the year has written its lines, not before. |
| 24 | `ascension` | `library`, `economy` | A rung is read off the books finished this year and the standing the economy has just set. |
| 25 | `generation` | `ambient`, `frame` | The generation counter gates content, so it turns over once everything else has. Tale circulation ticks here too — it only cares that the year has advanced, not what else fired in it. |
| 26 | `docket` | `generation` | A hand dealt in `marriage` is answered after the whole year has run — `step.ts` turns every phase and only then reports the block — so the last thing the year does is re-read what it is about to ask the player (issue #83). |

## Validation rules

Run one with `runRule(id, bundle)`. Source: `schema/src/rules.ts`.

| rule | what it is for |
|---|---|
| `ids/unique` | Two events with one id means one of them is unreachable, and save files name both. |
| `event/purposes` | CI gate 6. Exactly three distinct purposes, from the closed vocabulary (editor brief §4.5). |
| `frequency/obligations` | A tier is a set of duties, not a weight: Record blocks, folklore, caps, accounts. |
| `record/claims` | Record and Embellish must either both carry claims or neither may, because both are pages about the same event. |
| `slots/references` | Every {TOKEN} names a declared slot, and a relation filter names one that is cast before it. |
| `slots/negated-relation` | A negated relation filter must name a counterpart cast before it, or it rejects everybody instead of narrowing anybody. |
| `slots/arc-bound` | A slot bound for a whole substory needs an arc, and an absent-body if it may go missing. |
| `slots/counted` | A slot that casts a party may only be referenced as a party — `{ all: }` or `party_sum`. |
| `madness/gate` | Madness may only be dealt to a target the slot has already gated to someone who can express. |
| `awakening/gate` | Forced Awakening must target one explicitly unwoken slot; runtime separately verifies a carried Eldritch font. |
| `refs/known` | Ages, arcs, careers, spellbooks, knowledge flags, tales and their about-events named by content must be things that exist. |
| `tales/accounts` | CI gate 8. Every pair of an event's accounts must contradict on at least one field — differing bias is the minimum bar (issue #14). Two accounts that agree are one account written twice. |
| `discrepancy/wiring` | A Discrepancy proved or buried without ever being created cannot be found; provableBy must name a real house. |
| `secrets/wiring` | A secret on a contract becomes a Discrepancy under its own id, so nothing else may own that id. |
| `arcs/wiring` | An arc that points at a node or an event that is not there dies silently at that node. |
| `arcs/expiry` | An arc's expiresAfterYears must cover the longest path its own node schedules can draw. |
| `arcs/inline` | An inline follow-up must belong to exactly one chain, and must not compete with an authored arc. |
| `arcs/flags` | arc_flag effects and arcFlag/arcVisited conditions only mean anything inside a substory. |
| `decider/wiring` | A state ladder must name real branches and end in an unguarded rung; a party decider needs a check and a party. |
| `outcomes/weights` | A group of outcomes whose weights sum to zero can never resolve. |
| `event/shape` | A choice with one option is narration; a body of twenty words is a stub. |
| `checks/wiring` | A Check must be declared to be named, its bands ordered highest-first, and every band must name a real outcome — or, for a check a party decider spends, a real branch. |
| `ages/coverage` | An Age with no content of its own is a modifier wearing a name. |
| `clause/ages` | CI gate 7. A clause pinned to fewer than two Ages is a clause some runs never see. |
| `prologue/shape` | One prologue, three beats, and both of its choices pointing at things that exist. |
| `ending/complete` | All five endings, once each. An ending nobody wrote is an ending that cannot fire. |
| `ending/ring` | Every ending replays the prologue with EXACTLY ONE element changed. Two is a rewrite, none is not a ring. |
| `traits/mystic-restriction` | Women practise only the Threshold four (concept §9), so a female-tagged elemental trait is unlearnable. |
| `careers/gate` | A career may only be assigned to a slot already gated to men — every post in §18 is a man's. |
| `houses/alleles` | A house's gene pool must name loci and alleles that exist, or it is a characterisation the genome never receives. |
| `parcels/wiring` | tenant_farm may repeat; every other kind names one unique holding and risk shape. |
| `war/wiring` | A position an event sets exists; minRespect is a real Respect tier; discountWithCareer names a real career; a priced position has a multiplier. |
| `event/purpose-overlap` | CI gate 6. A triple used far past its share is one event written several times. |
| `prose/voice` | Bodies over five sentences are held to the countable half of the prose manual. The frame answers to a tighter budget (issue #13). |
| `prose/bearing` | No choice label names bearing — it must never read as a stat (concept §29, rule 1). |
| `frame/shape` | The frame reacts to the record: no effects, no Record block, no rumour, no choices, no slot against the living family, and at least one read to react to. `reads` is frame-only, and a `chronicled` read names an event that can actually leave a page. |
| `events/player-share` | At least a quarter of the library must actually ask the player something. |
| `rites/wiring` | A rite names declared slots, casts its ascendant from a pool that can express, and takes its subject. |
| `choices/consequence` | Every choice must change something that lasts, and every flag or knowledge key written must be read somewhere. |
