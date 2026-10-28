# core — the simulation

Pure. Zero DOM, no filesystem, no `Math.random`. Everything is a function of
`SimCtx` and a seeded stream.

## The shape

```
sim.ts            bootstrap, founding rebuilds, rename and snapshot
world.ts          WorldState — the only thing that mutates. SimCtx.
session.ts        GameSession — what a client is allowed to touch
save.ts           world <-> SavedGame, and `digest` for comparing runs
rng.ts            streamFor(world, system) — one stream per system per year
year/phases.ts    YEAR_PHASES: what a year IS, in order
year/step.ts      the clock that runs them
people/           store, factory, demography, branches, succession, minting…
events/           selection, slots, checks, effects, decisions, arcs, interventions
genetics/         loci, meiosis, expression
ages/scheduler.ts Ages as a hazard process; the Ledger pays out here
economy.ts        income, upkeep, tithes, standing decay
assize.ts, land.ts, muster.ts, campaign.ts, record.ts, replay.ts, …
                  one file per system — ARCHITECTURE.md's table names each
presence.ts       physical attendance at an authored emergency's scene site
testing.ts        testWorld / place / marry / beget / phase — build the state you mean
tools/            validate, digest, gates, the measured sessions, gen-docs —
                  all runnable via npm scripts
```

## Before you touch anything

```bash
npm run test:fast         # the loop
npm run check             # typecheck + validate + all tests; excludes gates
npm run land              # preflight the rebased head before a ready PR
npm run digest -- 8 400   # before AND after a refactor: the block must not move
```

What each of those costs is in [docs/COMMANDS.md](../../docs/COMMANDS.md#commands), stated
once so it can only be wrong in one place.

Reading the enforcement points for the invariants:

```bash
grep -rn "INVARIANT " packages --include=*.ts
```

## The rules that bite here

- **`kill()` is the only death gate**, and `canExpress` the only Madness gate.
  Both have exactly one implementation. Adding a second is how the Narrator dies.
- **Never put mutable state at module scope.** Id counters live on
  `world.counters`. A module-level counter is shared by every run in the process.
- **Derived state is not storage.** Anything life does to a person goes in
  `Person.acquired`; the phenotype cache is recomputed whenever the year moves.
- **A phase's name seeds its RNG.** Renaming one changes every run it touches.
- **A new field on `WorldState` needs a line in the save format**, or it resets
  silently on load. See `ARCHITECTURE.md` → "Add a field to the world".
- **Closed unions end in `assertNever`.** Never a permissive default.
- **Completed study is distinct from the shelf and raw affinity.** Practical
  Mystic checks use `knowsAffinity` in `people/library.ts`; `family_knows`
  reads living household readers. A physical copy alone cannot cast a spell.
- **Outcome selection and commitment are separate.** `onlyIf` filters weighted
  draws against the actual cast. `events/primordial.ts` may then replace an
  eligible emergency result; only `commitOutcome` applies the final bundle.
  Ordinary annual mortality and upkeep do not pass through that event adapter.

## Adding a system

One entry in `YEAR_PHASES` with `after` and `why`. It gets a stream
automatically, `year.test.ts` checks the ordering claim, and
`phase('name', ctx)` runs it alone in a test.

Full recipes: [ARCHITECTURE.md](../../ARCHITECTURE.md).
Every vocabulary — effects, conditions, filters, roles: [docs/VOCABULARY.md](../../docs/VOCABULARY.md).

## Invariant details

These retain the numbered rules from the shared entry point.

### 1. `canExpress` is the only Madness gate

A person can go mad **if and only if they are capable of expressing Eldritch Power** — male, with a non-null X-linked font. Never a woman, never a mundane man.

- There is **no** `if (female) madness = 0` clamp, and there must never be one. A clamp is something a later feature bypasses by accident; an unentered branch stays unentered.
- Every Madness source routes through `phenotypeOf(p).eldritch.canExpress`.
- An effect adding Madness to an ungated target is a **schema error**, not a silent no-op.

### 2. `PersonStore.kill` is the only death gate

Plague, duel, madness overflow, an authored `status` effect — all of it goes through `kill()`. A second place that ends a life is a second place that can kill the Narrator, and he does not die.

### 3. The Narrator does not die

The founder is the player: their name, their gender, and their **founding configuration** (#1867). **Daveed Gearithy**, a man and the blood father, is the authored default. The founder is the first character and the first head of the Eldritch House. When death is triggered for them it is *redirected*: they become the house's guardian spirit and make its decisions from that day forward.

- Marked `becomesGuardian: true` on the seed character; handled inside `kill()`.
- Afterwards their status is `guardian` — never `alive` again, so succession, marriage, births and mortality all step around them.
- They stay castable forever via the `guardian` slot role, which reads status rather than liveness. A template written for 1042 can still name them in 1542.
- Name and gender never touch a body. Only the configuration does (`people/founding-cast.ts`): as *blood mother* the founder is the woman who carries the font and a married-in husband fathers the children.
- **The founder's charter**: the founder holds the seal in their own right. `isRegent` is the one place that exempts them; never test a head's `sex` for Regency.

### 4. Two magics, two rules

- **Eldritch Power** is given, X-linked, family-exclusive. Men express it, women carry it and never express it. It may never become reliable or schedulable.
- **Mystic** magic is taken from books. Women practise only the four **Threshold** affinities (life, death, light, darkness); men practise all eight. This gates *learnability* and has **no Madness consequence**.

`canLearn()` and `eldritch()` share no code, and that separation is the design.

### 6. Derived state is not storage

`PhenotypeCache` is **derived** — recomputed from the genome whenever the year changes. Anything life does to a person (education, injury, event effects) goes in `Person.acquired` and is re-applied on every recompute. Writing into the cache appears to work and is gone by next spring, which silently made every `attribute` effect in the game inert.

### 7. Events and people ration separately

`world.frequency` is the ledger for events; `world.characterFrequency` is the ledger for minted people. They were one, which meant a rare *event* firing barred rare *character* templates for fifty-five years, and minted people were never recorded at all — so a mythic cap of three produced five and a half per run.

### 8. Determinism is per-world, not per-module

Every conception derives its RNG stream from `(runSeed, mother, father, ordinal)`. **Id sequences live on `WorldState.counters`, never at module scope.** A module-level counter is shared by every simulation in the process, so the same seed diverges as soon as a third run exists between two others — and the harness runs thousands. This shipped once; `demography.slow.test.ts` now asserts against it.

Every year phase draws from its OWN stream, derived from `(seed, year, phase name)` — see `streamFor` in `rng.ts`. One shared year-RNG was deterministic and unrefactorable: adding a single `rng.bool()` to the mortality pass shifted every subsequent draw that year, so no change could be shown to preserve a run. A phase's name is therefore part of the save in all but name. Renaming one reseeds it, which is fine — it is a new system — but it is not a cosmetic edit.

Never introduce `Math.random()` into `core`.

### 9. The docket blocks the clock

`stepYear(ctx, false)` puts choice events and Record blocks on `world.pendingDecisions` and **does not advance the year** until they are answered. A choice resolved three years after its event is not a choice.

- **Not every branch is the player's.** `decidedBy` (`schema/src/decider.ts`) says who takes one: `player` dockets, `chance` draws, `state` reads a ladder of guards over the family's own condition, and `party` pools a `Check` over the people the player casts — his decision there is *who goes*, and `session.send` is how a client answers it. Player choices and player-cast slots stop the clock; automatic branch resolution does not by itself ask a question.
- **`decideBranch` is the one evaluator**, and both the docket path and auto-resolve go through it, for the same reason `commitOutcome` is the only place an outcome is applied. Every path through it returns a branch — a ladder no rung of which holds falls through to weight rather than returning nothing, because an unanswered decision stops the clock permanently.

- The blocked call returns a report with `blocked` set rather than silently doing nothing.
- `autoResolve` (the default, and what every test and the harness runs) answers through the *same* commit path — `commitOutcome` in `events/decisions.ts`. One place applies an outcome, spends the frequency ration, starts substories and advances the arc. Two paths would be two sets of rules.

### 10. Attributes are an open list, and sex is a modifier on them

Nothing in the engine counts attributes. An attribute is six loci in `gen-loci.mjs` and an entry in `attributes.yaml`; **Fecundity** was added that way and cost no engine change. The eight affinities *are* fixed, because the dyads and the Threshold restriction are a rule about the world (§7), not a list length.

- **Dimorphism is data, in points, male minus female**, declared on the attribute and applied as ±half so the population mean does not move. Strength carries 26 of it — men are stronger in about 19 pairs in 20. A shift that *sorted* the sexes would be a different and worse claim, and a one-sided shift would quietly change female mortality (`hazard *= 1 - strength/220`) and surface three systems away as a fertility bug.
- **Anything mapping an attribute onto a real quantity centres on `ctx.genetics.expected`**, computed from the locus table at bootstrap. A hardcoded centre stops being true the next time somebody edits `LOCI_PER_CORE`, and the symptom is every family in the game gaining or losing a child with nothing in the diff to say so.
- **A cap is not an effect.** Fecundity drives the annual conception chance as well as completed family size, because most couples never reach their cap — crowding and a dead husband get there first. The first cut made only the cap heritable and the top third of mothers bore *fewer* children than the bottom third. If a heritable number only touches a ceiling, measure whether the ceiling ever binds.

### 12. Nothing takes the seal out of the main house

`foundCadetBranch` moves a man's wife and unmarried children with him. Twice that quietly moved the sitting **Head** into a branch — once as somebody's unmarried son, once as a Regent whose husband founded a hall — after which `speakerOf` found no head in the main hall, nobody there could ever leave again, and succession never noticed because the seat was filled. Any code that moves people between halls checks `castSlots.includes('head')` first.

### 13. The world reacts, and says so

`assize.ts` is the only rubber band in the simulation, it is explicit, and every
response it makes writes a chronicle line naming who did what.

- It moves **money, standing, loyalty, grievance and mortality** — never
  genetics, never Madness, never an authored outcome. Those belong to the
  content and to the genome, and a correction that reached them would be the
  world rewriting a decision the player made.
- A hidden nudge is a lie the player can feel and cannot name. If the assize
  acts, the chronicle says so, with the actor named.

### 14. The ladder is measured, never stored as an achievement

`ascension.ts` reads the calibrated gates every year, off the people and the
content, and recomputes where the house stands. `world.ascension.best` and
`reachedAt` preserve the high-water history — the rung can be lost, the fact
that it was reached cannot. Demigod attainment separately records the
irreversible cessation of ageing; a later fall in standing does not undo it.

`eldritchPower` normalises onto §22's 0–100 scale from the locus table rather
than from a constant, which is invariant 10's rule applied to the ladder: the
scale moves when the loci move, and nothing has to be told.

### 15. A hall is not a house

Cadet branches are households inside the player's house, keyed by `membership.branch`. `people.household(house, year)` is still the whole family; `halls()` splits it.

- **Crowding is per hall.** `MAIN_HALL_SOFT_CAP` for the seat, `BRANCH_SOFT_CAP` for a branch. One brake over one household is why runs used to end with twenty people.
- The economy books the main hall; branches feed themselves, pay a tithe, and cost kin upkeep.
- Moving someone between halls closes one membership record and opens another. Two open records puts them in two halls at once and double-counts them everywhere.
- Succession scans the whole house and prefers the seat; a cadet who takes the seal is **recalled** to the main hall. A Head ruling from a branch is a Head whose own hall belongs to somebody else.

## Naming the children

Every newborn of the player's household gets a generated name **and** a
`pendingNames` entry. The generated name means nothing downstream can ever hold
a nameless person; the queue is an offer, not a blocker. Ignoring it is a valid
way to play — the chronicler picked a name, and the chronicler is not you.
