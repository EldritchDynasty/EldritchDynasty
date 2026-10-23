# FAILURES

Bugs that shipped. Every one of them was silent — nothing threw, nothing logged,
and each looked from the outside exactly like a working feature that had not come
up yet.

Read this before writing a test. The pattern to learn is not any individual bug;
it is that **this codebase fails by doing nothing**, so the assertion that catches
it is almost never "does the function return".

---

## The clamp outside the square

```ts
Math.max(0, (age - 45) ** 2)     // the square is ALWAYS positive
```

The clamp did nothing, so the mortality curve ran backwards. A one-year-old
carried a 12% annual hazard, almost no child reached seventeen, and every run
went extinct. The clamp belongs *inside* the square.

**Caught by:** a run that never had a household.
**Now guarded by:** `demography.slow.test.ts` — "lets children reach adulthood".

## And then the house doubled every twenty-five years

Fixing the above removed the only brake there was. Every adult married and bred
for twenty-seven years. The real brakes are completed fertility per couple and a
per-hall soft cap.

**Now guarded by:** `demography.slow.test.ts` — "does not breed without bound".

## Attribute effects evaporated

Every `attribute` effect in the game wrote into the phenotype **cache**, which is
derived and recomputed whenever the year changes. It appeared to work and was
gone by next spring. Acquired modifiers belong in `Person.acquired`.

**Now guarded by:** invariant 6, and `economy.slow.test.ts`.

## There was no annual economy

The treasury only moved when an event spent it, and every money event spends. The
house passed −1,000 crowns by 1400 and stayed there. Nothing checks a negative
treasury, so the only symptom was that `maintainCast` silently stopped hiring
around 1150 — the tutor, the midwife and the archivist quietly left the game, and
with the archivist went the Ledger.

**Now guarded by:** `economy.slow.test.ts`, `ledger.slow.test.ts`.

## Two arc bugs killed a three-node substory

A node that did not declare the arc's bound slot was treated as having an
unfillable one, and cancelled the whole arc. Separately, `inherit` gave up when a
man died childless — which is most men. The seal feud's final scene fired **zero
times in twenty thousand simulated years**.

**Now guarded by:** `arcs.slow.test.ts`. The fire-rate gate is the only thing that
catches this class. Measure fire rates whenever you touch arcs, slots or selection.

## `kind: relationship` was handled by nobody

The effect switch listed the case, commented that another subsystem handled it,
and broke. There was no other subsystem. Four authored outcomes — including the
seal feud's inherited grudge — discarded themselves in silence.

**Now impossible:** the switch ends in `assertNever`, and every case does the work
or does not exist.

## Contracts bound to a house, so the employer could never die

`onEmployerDeath` was unreachable, and `term` with it. Every field deciding how
service ends was dead. Contracts bind to a **person**.

## Every Age reveals a clause — and none did

`ActiveAge.paid.clause` was written by nothing; `clauseBearing` was read by
nothing. Runs reached 2042 with two clauses of nine, and the God rung needs
seven, so the ending the whole game points at was unreachable. Nothing said so.

## Respect only ever ratcheted

It moved when an authored effect moved it and never otherwise, so half the
measured runs sat at their high-water mark from the century they reached it. The
endgame squeeze — Madness to ascend, Respect to be allowed to, Madness destroys
Respect — had one of its three jaws missing.

## One ledger for two things

`world.frequency` rationed events and minted people at once, so a rare *event*
firing barred rare *character* templates for fifty-five years — and minted people
were never recorded at all, so a mythic cap of three produced five and a half per
run.

## An id counter at module scope

Shared by every simulation in the process, so the same seed diverged as soon as a
third run existed between two others — and conception seeds derive from parent
ids, so the divergence reached into genomes. The harness runs thousands of runs.

**Now guarded by:** `world.counters`, and `demography.slow.test.ts`.

## A preview that changed the run it was previewing

`previewTemplate` removed its people and refunded the ration, so it looked clean.
But every rolled person had already advanced `counters.person`, and conception
seeds derive from parent ids — so previewing twenty-four suitors renamed every
child born afterwards and gave them different genomes. The editor's own
inspection tool altered the world, and only on the worlds somebody had inspected.

## The seal left the main house, twice

`foundCadetBranch` moves a man's wife and unmarried children with him. Twice that
quietly moved the sitting **Head** into a branch — once as somebody's unmarried
son, once as a Regent whose husband founded a hall. Afterwards `speakerOf` found
no head in the main hall, nobody there could ever leave again, and succession
never noticed because the seat was filled.

## The browser loaded a different game

The node and browser content loaders each carried their own copy of which
collection came from which file. The browser one never collected
`characterTemplates`, so the editor minted no spouses, every line died out by
1150, and the tree view disagreed with the harness for a whole session.

**Now impossible:** there is one loader and one `CONTENT_LAYOUT`.

## A permissive default in the condition evaluator

`evalCondition` ended in `return true`. A condition kind added to the schema and
not handled there did not fail — it **passed**, so every event carrying it fired
unconditionally, forever, looking exactly like content meant to be common.

**Now impossible:** `assertNever`.

## Four recipes described a person the world then rolled at random

`CharacterTemplate.bias` — "a scholar's daughter has a mind", "the rival is
charming and deathly" — was authored on four templates, validated at boot,
saved, loaded, and **read by nothing**. `applyBias` lived in `sim.ts` and ran
over the founding cast alone; every person minted after 1042 got a plain draw
from their house's pool. The field was not broken, it was unreachable, and the
symptom was that a suitor advertised as a scholar's daughter had exactly the
mind of a random woman of House Ilm.

It surfaced when the Match put those templates in front of the player as
cards. A card that promises a scholar's daughter has to deal one, and the
first thing anyone would do with a deck is compare two cards.

**Now guarded by:** `attributes.slow.test.ts` — "gives a scholar's daughter the
mind the recipe says she has", which mints forty of each recipe and compares
the means. The rule itself now lives in `genetics/meiosis.ts`, applied by
`materialize` off the genome ref, so both paths — founding cast and minted
person — go through one function.

---

## Damage created the thing it damaged

`degradeLibraryCopy` routed through `acquireLibraryCopy`, which MINTS a shelf
copy when the house has none. So `op: 'degrade'` against a book the house had
never bought put that book on the shelf at `100 - degradesBy` — a net gain,
from an outcome whose prose is about rot.

The Crusade's second cellar is the live case: choosing to hide two dark
workings the house did not own was rewarded with both of them. And a shelf copy
is not inert — `table.ts` will only let a study be ordered for a book the house
holds, the steward's auto-study reads the shelf directly, and the auction pool
excludes what is already held. A book the house never bought became studyable,
climbable and unbuyable in one step.

Measured over 12 thousand-year runs the shelf ran a quarter-book fat (mean
10.00, against 9.75 once damage stopped creating books).

**Caught by:** grepping the readers of `world.library` after noticing the
adjacent bug below.
**Now guarded by:** `library.test.ts` — "degrade against a book the house does
not hold does nothing". The test that existed gained the book first, which is
exactly why it never saw this.

## `condition` was spent and bought nothing

`LibraryBookState.condition` was declared, initialised to 100, decremented by
`op: 'degrade'`, saved and loaded — and read by **nothing** (invariant 11).

What makes it worth its own heading is the docstring, which said the engine
deliberately left the arithmetic to content: *"content schedules `gain` further
out for a low condition."* Content could not. No `Condition` kind exposes a
book's condition, so no author could ever branch on one, and `op: 'study'`
schedules through `effectiveStudyYears` rather than through an authored
duration. The punt was unimplementable, and five authored outcomes across
three files spent the number anyway.

A field with a plausible reason for having no reader is worse than one with
none, because the reason stops anybody looking.

**Now guarded by:** `library.test.ts` — "a degraded copy takes a reader longer"
and "the drag reaches the scheduled completion year", the second because the
arithmetic being right and the scheduled year being right are two facts.

## `Person.arcBindings` was never written either

An `ArcId[]` on every person, initialised by the factory, written into the save
format and read back out of it. Nothing ever pushed to it and nothing ever read
it — a round trip with no departure.

It was also the wrong shape to fix by wiring up. `ArcInstance.bindings` is the
cast of a running arc, and `dueArcSteps` recasts and *inherits* those bindings
as the cast dies off, rewriting them without touching any Person. A mirror on
the person would have been wrong by the second beat of any arc that outlived
its own cast. Derived state is not storage (invariant 6), so the field is gone
rather than filled, with a note in its place saying why it should not return.

**Now guarded by:** nothing, and it does not need to be — the field does not
exist. `SAVE_FORMAT` stayed at 9: a removed field that nothing read cannot
silently reset anything, which is the failure the version guards against.

---

## Found before it shipped: a negative locus group pays out instead of costing

Not a bug that shipped — `FECUNDITY_DRAG_COUPLING` is zero, so nothing in the
game runs this path. It is here because the next person to turn that constant up
will walk into it, and because the shape generalises past fertility.

`completedFertility` measures a couple against `expectedAttribute('fecundity')`,
the population mean derived from the locus table. That mean is **theoretical and
unclamped**; the attribute a real body carries is clamped to the authored range,
which floors at zero. Add a strong one-sided negative group of loci — option B's
drag is six of them — and the two come apart: at coupling 2 the computed centre
has fallen from 26 to 4 with a quarter of all mothers sitting on the floor, and
by coupling 4 it is **-18 against a floor that has not moved**.

Every family in the game then reads as *above* average, and the drag hands out
children. Across 200 thousand-year runs per coupling, births per run rose
monotonically — 748 at coupling 0, 795, 870, and 1,009 at coupling 4. The feature
made the house bigger the whole way up, and nothing threw.

**Caught by:** `npm run gate:drag`, which prints the computed centre and the
floored share next to the outcome columns for exactly this reason.
**Now guarded by:** `attributes.slow.test.ts` — "does not pin the founding cast
against the ends of its own range", which trips at coupling 1, well before the
sign flips.

---

## The same centre, wrong a second way: a locus that is drawn by its own rule

The entry above fixed `expectedAttribute` to take the clamp into account, and
that was the right fix. This is the *next* thing wrong with the same number, and
it was found the first time a font locus was made to feed a real attribute —
option B respecified as pleiotropy, measured by `gate:drag --pleiotropic`.

`expectedAttribute` computes the population mean from the **authored allele
frequencies**. `drawAllele` does not draw font alleles at those frequencies:

> Font loci: OUTSIDERS carry nulls except at their pool's carrier rate, and what
> they carry when they carry anything is weak.

That override is correct and load-bearing — it is the whole of *"Eldritch Power
dilutes when married outward and cannot be replaced from any external source"*.
Authored, a font locus is 12% carriers; the deepest-blooded rival pool draws at
5% and most of the world at under 1%, weak alleles only.

So the moment a font locus contributes to an attribute, the centre the game
measures couples against is computed from frequencies **nobody in the world is
drawn at**, and it falls far faster than the population does. Same visible
symptom as before, from the other direction: every family reads as above
average, and births per run climb with the strength of a thing named "drag".
Over 200 thousand-year runs per coupling: the computed centre falls 26.1 → 15.1
→ 4.0 → 0 while the mothers it claims to describe only go 29.8 → 27.6 → 25.1 →
23.5, and births go 712 → 863 → 976 → 987. At `FERTILITY_SLOPE` 0.09 a gap of
21 points is about two extra children for every couple in the game.

The generalisation, which is what makes this worth a section rather than a
footnote: **a locus kind with a draw rule of its own has two frequencies, and
only one of them is written down.** ~~`eldritch_font` is the only kind that has
one today, and no shipped locus of that kind feeds an attribute — so this is
latent, not live~~ — **wrong on both counts, corrected below.**

**Caught by:** `npm run gate:drag -- 200 1000 0 1 2 4 --pleiotropic`.
**Guarded by:** `fecundity-drag.slow.test.ts` — "the shipped content carries no
such contribution" and "the centre is computed from frequencies the font is not
drawn at".

### It was already live, on `strength`, and there were two kinds all along (issue #113)

Re-reading the paragraph above while scoping its fix turned up two things it
got wrong, both load-bearing:

**`deleterious` has a draw rule of its own too.** `drawAllele` forces the bad
allele at a house's own `deleteriousLoad`, on top of the authored `p: 0.07` —
the effective frequency is `load + (1 − load) × p_bad`, not `p_bad` alone.

**And it was not latent.** All five shipped deleterious loci carry
`contributes: [{ attr: strength, weight: 0.5 }]` in `loci.yaml`. The guard
above (`fecundity-drag.slow.test.ts:303`) only ever checked `eldritch_font` —
true and narrow, and the second kind walked underneath it. The live error
ran a fifth of a point to two and a bit points of `strength`, worse in the
heavier pools (`deleteriousLoad` 0.04–0.31 across shipped houses) — small
because `dominance: 1` makes the curse fully recessive, but the SHAPE was
already wrong: the true centre is a different number per gene pool, while
`expectedAttribute` returned one number for the whole world.

**The fix is one function, not two patches.** `effectiveAlleleWeights`
(`genetics/loci.ts`) is now the only place either override's arithmetic is
computed — a closed switch over `LocusKind`, ending in `assertNever`, so a
locus kind added later without a case here is a compile error rather than a
third instance of this exact bug. `drawAllele` samples one person's pool from
it; `expectedAttribute` (`genetics/expression.ts`) takes an optional pool
MIX and blends the same weights across every house in play, weighted by
`mintShareByHouse` — each house's share of the world as the character
templates actually draw it (`sim.ts`'s `makeGeneticsCtx` is the one caller
that must pass this; a bare, pool-less call is still the right thing for a
calibration tool comparing two synthetic bundles against each other).

Re-run after the fix (`gate:drag --pleiotropic`, smoke scale — the full
200×1000 batch is in `docs/BALANCE-LOG.md`): the centre no longer collapses
with `k`. Where it used to run 26.1 → 15.1 → 4.0 → 0 against a `borne` that
barely moved, centre and borne now track each other at every coupling.

**Caught by:** `packages/core/src/allele-draw.test.ts` (the pure-function
claims) and `attributes.slow.test.ts`'s pool-by-pool and pool-mix strength
tests (the real-bootstrap claims), both new.
**Guarded by:** the same `assertNever` that makes a new `LocusKind` a compile
error the moment it needs a case in `effectiveAlleleWeights`.

---

## Tests that were wrong, not the code

Worth its own heading, because the reflex is to fix the code. It said "two"
for as long as there were two; it is eight now, which is the other reason the
heading is worth having.

- `writes the clause into the chronicle in the contract's own hand` pinned seed
  909 to revealing a clause within 600 years.
- `does not ratchet` asserted that six seeds end on more than one tier.

Two more, found by the library fix above, which re-rolls any trajectory in
which a `degrade` used to mint a book:

- `makes the pairing the whole design turns on more than a handful of times`
  took the mean of five seeds against a threshold of 5. `hotPairs` runs 0 to 45
  with a standard deviation near 12, so a five-seed mean carries a standard
  error of about 5.8 — larger than the threshold it was being compared to. It
  had been passing at 5.40. Over twenty seeds the statistic does not move for
  the library fix at all (11.15 before, 10.50 after, a fifth of one standard
  error) while the five-seed mean falls to 4.40. Widened to twenty seeds, which
  costs 55 seconds and leaves the claim exactly as it was.
- `keeps grievance and discontent inside a usable range` required EVERY seed in
  its batch to finish with a living cadet hall. Seed 31 now does not: the 1522
  plague takes that house from 39 of the blood to none by 1560, which is a
  `broken_line` run rather than a fault. Survival was never the claim — the
  batch-level "the narrow block measured nothing" guard at the foot of the test
  is what protects the measurement, and it does it without forbidding a lost
  run.

The pattern in both: a threshold read off one sample of a heavy-tailed
statistic. The next unrelated commit was always going to break them.

Four more, found by issue #113's allele-draw fix, which changed how many
numbers a draw takes out of the stream without changing any frequency — so it
re-rolled which people every seed produces while provably moving no
distribution (`allele-draw.test.ts` runs the old procedure against the new
weights over every shipped locus and pool to say so). All four passed on
unmodified `main`; none measured anything the fix touched:

- `goes back in the bag when the player renames the child` waited on one seed
  to spend a friend-name inside 200 years. Five seeds now.
- `deals the Match about once a generation` asserted a per-seed FLOOR on a
  count; seed 4104 came back with 11 of a batch that had not moved. The floor
  is a claim about the game and now goes through `expectMean`; the ceiling,
  which is the 171-hands regression this test was built for, stays per-seed.
- `never lets a mother bear a child outside a plausible age` hardcoded a floor
  of 17 against an engine whose `CHILDBEARING.from` is 15 and whose female
  fertility curve is at 0.42 of peak by body-age 15. A birth at sixteen was
  always legal; no run had happened to produce one at seed 909. The floor
  reads the constant now.
- the pinned half-closed vow went from 2 checkpoints of 160 to 3 — the same
  couple, the same year, one more of the eight seeds, because the reshuffle
  moved when Daveed dies by a year or two and that window either contains the
  50-year sample or does not.

**The sub-pattern worth naming separately from the one above:** three of these
four are not thresholds off a noisy statistic at all. They are assertions
pinned to a SEED — and a test pinned to a seed is measuring the draw order,
which any change anywhere is allowed to move. The fourth is worse and more
useful: a constant written into a test that contradicted the constant in the
code, passing for as long as the dice never exercised the gap.

Three more, from the same reshuffle, caught only once the slow lane actually
ran (`npm run land` runs it; `test:fast` skips it by design) against a base
commit carrying unrelated content ahead of this one:

- `weights the mother above the father` — the exact test this same issue's
  test file already documents breaking once before on a six-seed batch. Broke
  again on a fresh six-seed sample; the fecundity centre it could plausibly
  have moved is bit-identical before and after the fix. Rebuilt on twenty
  seeds through `expectMean` in place of the bare `toBeGreaterThan` it never
  should have had.
- `makes the pairing the whole design turns on more than a handful of times`
  — already widened to sixty seeds for this exact reason; landed at 2.0
  standard errors again, the eighth time. Widened to ninety.
- `spreads them across the centuries rather than emptying the bag at once` —
  a per-instance ceiling on a coin with no upper bound once it is due, so a
  1%-tail event (measured: 2 of 200 fresh instances) failed the build the way
  any per-instance cap on a heavy tail eventually does. Converted to a rate
  claim.

Full numbers for all three are in `docs/BALANCE-LOG.md`, under the allele-draw
writeup this issue also produced.

A third, found by the bond content drop, and the clearest case yet because the
cause could be ruled out rather than argued about:

- `gives the family somewhere to quarrel with itself` counted feuds across
  twelve runs and asserted `> 8`. It broke on two household templates that fire
  under once a run between them and create no grudges whatsoever. Measured over
  48 seeds on two independent seed sets, the underlying rate is 81%–90% — so a
  threshold of two-in-three on a twelve-run binomial fails about one time in
  eleven at the high end and one in four at the low, with nothing wrong. Adding
  ANY template to the pool re-rolls which scene wins every draw for a thousand
  years; that is not a regression, it is what a shared draw means. Widened to
  24 runs, same claim, same proportion.

Three times now the same shape, so it is worth stating as a rule rather than a
story: **a batch-statistical test needs its threshold at least two standard
errors from the measured mean, and the measurement has to come from a wider
batch than the test runs.** A threshold set by eye off the batch it will be
tested on is a coin the next commit flips.

**And a rule stated in prose is a rule nobody applies at three in the morning**,
so it is now a function. `expectRate` and `expectMean` in `core/src/testing.ts`
assert the claim and the margin together, and fail with the batch size that
would carry it. Their own tests (`claims.test.ts`) feed them the exact
five-seed batch that shipped — the one where the mean came out 5.40 against a
floor of 5 and PASSED — and require them to refuse it, because the case worth
catching is not a claim that is false. It is a claim that is true this week.

Converting the existing batch claims found the audit's real answer, which was
not what the last three failures suggested: `arcs`, `ascension` and
`branches-contentment` all cleared two standard errors comfortably. Their
authors had already widened them by hand, with comments explaining why. The
culture was there; only the enforcement was missing.

Both failed the day the RNG streams were split. The harness showed sixteen seeds
landing across four tiers on the same commit — the behaviour was intact, and the
tests were describing a sample rather than a mechanism. They assert the mechanism
now.

## Seven hand-written copies of a closed union, and none of them failed to compile

`AGENTS.md`'s "Do not" has said *keep no hand-written copy of a closed union
anywhere* since the list existed. The ladder roles were copied by hand in
**seven** places regardless, and adding `second_foremost` (issue #61, Stage E5)
broke every one at once:

| where | what the silence did |
|---|---|
| `madness/gate` | would demand a `canExpress` filter on a slot whose pool IS the gate |
| the rite shape rule | same |
| `careers/gate` | same |
| `costsTheClimber` | read the second man's Vessel — the largest charge the ladder lays on anybody — as a FREE option, so no gate column ever took it deliberately |
| `rites.slow.test.ts`'s `charges()` | same, in a slow-lane suite; a house that had REFUSED the rite ended up carrying it |
| `ladder.slow.test.ts` | its "declawed" bundle stopped declawing, so the negative control the test IS was incomplete |
| `careers.test.ts` | mirrored `careers/gate`'s rule and drifted from it |

**Nothing failed to compile.** `role === 'foremost'` is valid TypeScript that
quietly answers "no" about a role it has never heard of — the `in`-chain
problem from the condition evaluator above, wearing a string comparison.

Three were found by the compiler being *unable* to help and a human reading
call sites; two more by the full test set; and the last two by the sweep that
was written after the first five, which is the point. `LADDER_ROLES` in
`packages/schema/src/event.ts` is the one list, `isLadderRole` is how anything asks, and
`ladder.test.ts`'s *nothing hand-copies the ladder roles* fails the build on a
new copy. **A rule with no enforcement point is a comment**, and this one had
been a comment for as long as the list had existed.

The general shape, worth more than the instance: a closed union hidden in a
**test helper** is the worst case of this, because the helper looks like test
scaffolding rather than production logic, and a copy in a `*.slow.test.ts` is
invisible to `npm run test:fast` — which is the loop an author actually runs.

## One silence, three instruments, one pin

Stage E1 tightened `the_unmaking`'s cast to what §22 actually asks the God rung
for. Correct, and it made the event unfireable until the population can produce
a standing Demigod. That single fact is read by **three** separate instruments,
and pinning it in one did not pin it in the others:

- gate 4 (fire rate) — pinned as `OWED_FIRE_RATE` when E1 landed
- gate 8 (outcome reach) — not pinned; three outcomes read as *never resolve*
- `arcs.slow.test.ts`'s dead-event sweep — not pinned; read as a dead event

So a branch carrying E1 was red in two places nobody had looked at, for a
reason already understood and already written down once. **When you pin a
measured debt, grep for every other thing that measures the same silence** —
fire rate, outcome reach, and "every event fires at least once" are three
questions with one answer here.

The pins also have to name what actually pays them off, and the first one did
not: it said Stage E4's pair lever would clear the debt. E4 shipped, E5 built
the casting primitive E4 said was missing, and the debt did not clear — what
owes it is channel width (`GREAT_RITE_REACH`, `channelCeiling`). A pin that
names the wrong creditor sends the next reader to redo work that is already
done.

## The editor was blank, and every editor test was green (#1891)

`createWorld` clones each house with `structuredClone` (#980). The editor
indexed its live, Vue-reactive bundle and handed that to `core`, so every
house was a proxy. **Node's `structuredClone` accepts a Vue proxy; Chromium's
throws `DataCloneError`.** From 11 October, Instruments, Family tree and
Simulate threw the moment they built a world. On 22 October the emergency
intervention panel started building one for the first event of the Events
view, and the render error unmounted the whole editor on boot: a blank page,
with `typecheck:editor` clean and 152 editor tests passing. Nothing that ran
the editor existed.

Two more were hiding behind it, both just as quiet:

- **Browsing marked files dirty.** A deep watcher on the selected item fires
  when the *selection* changes too, so five clicks reported five unsaved
  files. An unsaved count that is always wrong is one an author learns to
  ignore, which is the same as not having one.
- **A keystroke cost over a second.** Every edit re-indexed the bundle and
  validated all 533 events through reactive proxies.

And the browser tests themselves could not start. `playwright.config.ts`
carried a glob in a block comment, and its slash-star-star-slash closed the
comment. The file failed to parse from the day it landed (#360), so for three
weeks `npm run test:e2e` errored before running anything, and nothing ran it
to notice.

**The lesson:** a test environment that is more lenient than production can
pass code that production refuses. A Node test cannot stand in for a browser
on anything a browser API decides.
**Now guarded by:** `tests/e2e/editor.spec.ts`, run by `check.yml`'s
merge-blocking `editor` job; `store.test.ts` — "hands core no Vue proxy
anywhere in the indexed content"; `watch-edits.test.ts`.
