# ARCHITECTURE

The map. `AGENTS.md` carries the rules you cannot derive from the code; this
file tells you where the code is and how to add to it.

**Reading order for an agent.** Load the least you can:

| Task | Read |
|---|---|
| Author or edit content | [docs/VOCABULARY.md](docs/VOCABULARY.md) + [packages/content/AGENTS.md](packages/content/AGENTS.md) |
| Change a rule of the world | this file's table below → the one file it names |
| Add a verb (effect, condition, phase, rule) | the matching recipe below |
| Fix a failing test | the test file, then the one file it exercises |
| Understand why something is the way it is | [docs/FAILURES.md](docs/FAILURES.md) |

Each package has its own `AGENTS.md` with only the rules that apply inside it.

---

## The model, in one paragraph

Authored YAML is loaded into a **`ContentBundle`**, indexed once into a
**`Content`**, and never changes again during a run. A **`WorldState`** holds
everything the run has caused, and is the only thing that mutates. A
**`SimCtx`** is the pair of them plus two derived things — the locus table and
the set of names already spoken for. A **year** is an ordered list of named
**phases**, each of which takes `SimCtx` and its own RNG stream. A
**`GameSession`** is the narrow surface a client uses. A **`SavedGame`** is the
whole world as plain, validated data.

```
YAML ──assembleBundle──▶ ContentBundle ──indexContent──▶ Content ─┐
                                                                  ├─▶ SimCtx ──YEAR_PHASES──▶ WorldState
                                                       bootstrap ─┘        │
                                                                   saveGame│loadGame
                                                                           ▼
                                                                      SavedGame
```

---

## Packages

| Package | Holds | Never holds |
|---|---|---|
| `schema` | Zod schemas, the types they infer, content validation rules, the save format | Simulation logic, I/O |
| `core` | The simulation. Pure, seeded, deterministic | DOM, `Math.random`, filesystem |
| `content` | Authored YAML, and a loader that only reads files | Any statement about what a bundle *is* — that lives in `schema/src/assemble.ts` |
| `editor` | Vue 3 authoring tool. Imports `core` directly, so preview is the real thing. Its effect, slot and check forms are generated from the Zod schemas (`reference.ts` → `fieldsOfSchema`), so they cannot fall behind the unions | Reimplemented simulation, and any hand-listed copy of a closed union |
| `client` | Vue 3 game. Every gameplay read/action goes through `GameSession`; host I/O goes through the generic `Platform` seam | `session.ctx`, a second simulation read model, native APIs, or any rule of its own |
| `shell` | Electron Windows host: window, filesystem-backed saves/import/export and NSIS packaging | Rules |
| `mobile` | Capacitor host for Android, and iOS next (#349): device services, save/import/export bridge and store artefacts | Rules, simulation state, duplicate client UI |

---

## Where a thing lives

| If you are changing… | Go to | Guarded by |
|---|---|---|
| What an event/age/arc/character **is** | `schema/src/event.ts`, `age.ts`, `arc.ts`, `character.ts` | `rules.test.ts` |
| Which file a collection is **loaded from** | `schema/src/assemble.ts` → `CONTENT_LAYOUT` | `bundle.test.ts` |
| Looking a content id **up** | `schema/src/content-index.ts` | `bundle.test.ts` |
| A **validation** rule | `schema/src/rules.ts` → `CONTENT_RULES` | `rules.test.ts` |
| The **prose** contract | `schema/src/prose.ts` | `rules.test.ts` |
| A **Plain English** counterpart | content: a `proseVariants:` block at the end of the Original's own YAML file; a core `msg()` line: `content/messages.yaml` | `prose-variants.test.ts`, `prose.test.ts` |
| What a **choice** can change | `schema/src/choices.ts` → `auditChoices`; CLI `core/src/tools/choice-audit.ts` (`npm run audit:choices`) | `rules.test.ts` |
| The **save format** | `schema/src/save.ts` (shape) + `core/src/save.ts` (conversion) | `save.test.ts` |
| **What happens in a year** | `core/src/year/phases.ts` → `YEAR_PHASES` | `year.test.ts` |
| Death, birth, marriage rates | `core/src/people/demography.ts` | `demography.slow.test.ts`, `attributes.slow.test.ts` |
| **The Match** — three cards, one marriage | `core/src/people/match.ts` | `match.test.ts` |
| What a card lets you reason from | `core/src/people/panel.ts` | `panel.test.ts`, `gate:blood`'s `blind`/`panel` columns |
| How much the player is asked, and how often the same thing twice | `core/src/tools/density-gate.ts` | `attention.slow.test.ts`'s per-generation band |
| Genetics — loci, meiosis, expression | `core/src/genetics/` | `sim.slow.test.ts`, `attributes.slow.test.ts` |
| **How the blood is handed on** — the font's meiotic drive | `core/src/genetics/meiosis.ts` → `driveToward`, and `drive` in `loci.yaml` | `blood.test.ts`, `blood.slow.test.ts` |
| Who the house marries when nobody is asked | `core/src/people/demography.ts` → `preferred` | `table.test.ts` |
| Who can be **cast** in a slot | `core/src/events/slots.ts` → `candidatesFor` | `arcs.slow.test.ts` |
| What an **effect** does | `core/src/events/effects.ts` → `applyEffect` | `ledger.slow.test.ts` |
| What a **condition** tests | `core/src/events/conditions.ts` | — |
| **Who takes a branch** | `schema/src/decider.ts` + `core/src/events/deciders.ts` | `deciders.test.ts` |
| Which slot fills **first** | `core/src/events/slots.ts` → `fillOrder` | `checks.test.ts` |
| An inline `next` becoming an **arc** | `schema/src/desugar.ts` | `desugar.test.ts` |
| What a substory **remembers** | `arcs.ts` (`arc_flag` / `arcFlag`) | `arc-memory.test.ts` |
| Which events **fire** | `core/src/events/selection.ts` | `sim.slow.test.ts`, `arcs.slow.test.ts` |
| The **frame** — 1542, gated by `reads` | `core/src/events/frame.ts` | `arcs.slow.test.ts` |
| **Substories** | `core/src/events/arcs.ts` | `arcs.slow.test.ts` |
| The **docket** and the Record block | `core/src/events/decisions.ts` | `decisions.slow.test.ts` |
| Cadet **halls** | `core/src/people/branches.ts` | `branches.slow.test.ts` |
| The world's reaction — the Assize | `core/src/assize.ts` | `assize.test.ts` |
| The world's memory — Bearing (§29) | `core/src/bearing.ts` | `bearing.test.ts`, `bearing-gate.test.ts` |
| The Ascension Ladder — §22's rungs | `core/src/ascension.ts` | `ascension.test.ts` |
| The **rites** — what the top three rungs cost | `core/src/events/rites.ts` | `rites.test.ts`, `rites.slow.test.ts` |
| Standing orders — the table | `core/src/table.ts` | `table.test.ts` |
| Money and standing | `core/src/economy.ts` | `economy.slow.test.ts`, `ledger.slow.test.ts` |
| The Ledger — Ages and clauses | `core/src/ages/scheduler.ts` | `ledger.slow.test.ts` |
| The **prologue** — the signing, and its two choices | `core/src/prologue.ts` + `packages/content/prologue.yaml` | `prologue.test.ts` |
| The **ending** — the last night, and the ring | `core/src/ending.ts` + `packages/content/endings.yaml` | `ending.test.ts` |
| A **chapter** — the years between one Age closing and the next (issue #65) | `core/src/chapter.ts` → `chapterOf`/`openingOf` | `chapter.test.ts` |
| What a **client** can do | `core/src/session.ts` | `session.slow.test.ts` |
| The **client's only simulation door** | `packages/client/src/lib/game.ts` | `packages/client/src/lib/verbs.test.ts`, `packages/client/src/lib/run.slow.test.ts` |
| Host I/O — saves, import/export, pause/back | `packages/client/src/platform.ts` + `packages/shell/src/preload.cjs` + `packages/mobile/src/platform-bridge.ts` | `packages/client/src/platform.test.ts`, `packages/shell/src/saves.test.ts` |
| What the **player** sees and clicks | `packages/client/src/` | `packages/client/src/lib/verbs.test.ts`, `packages/client/src/lib/run.slow.test.ts` |
| The **Windows host / installer** | `packages/shell/` | `npm run smoke --workspace @ed/shell`, packaged smoke on release tags |
| The **mobile host** (Android; iOS next, #349) | `packages/mobile/` — one bridge for both, `packages/mobile/src/platform-bridge.ts` | Android tag build + the client `Platform` contract |
| **Land** — parcels, and income as the sum of what is held | `core/src/land.ts` | `land.test.ts`, `land.slow.test.ts`, `gate:land` |
| **The Muster** — the levy, and what a war costs | `core/src/muster.ts` | `muster.test.ts`, `muster.slow.test.ts`, `gate:war` |
| **The papers** — lineage documents as the real dowry | `core/src/people/papers.ts` | `papers.test.ts` |
| Rival-house **descent** | `core/src/people/rivals.ts` | `rivals.test.ts` |
| Which outside houses **recur** — a read model over grudges, the Match, lies | `core/src/relationship-threads.ts` | `rivals.test.ts` |
| The **campaign** — Short Line or Long Line | `core/src/campaign.ts` → `CAMPAIGNS` | `campaign.test.ts`, `gate:campaigns` |
| The house's **ambition** | `core/src/ambition.ts` | `ambition.test.ts` |
| What a standing **delegation** answers, and what must still surface | `core/src/delegation.ts` → `mustSurface` | `deciders.test.ts`, `decisions.slow.test.ts` |
| **Advisers** — a person's advice, never the engine's answer | `core/src/advisers.ts` | `advisers.test.ts` |
| What the chronicle **claims** — the record layer, sigil drift | `core/src/record.ts` | `record.test.ts`, `record.slow.test.ts` |
| Which page **answers** which — Chronicle backlinks | `core/src/cause.ts` | `packages/client/src/lib/causes.test.ts` |
| **Nested tales** in circulation | `core/src/events/tales.ts` | `tales.test.ts`, `tales.slow.test.ts` |
| The **decision log** and replay | `core/src/replay.ts` | `replay.slow.test.ts` |
| The **Library of Houses** — what a finished run leaves the next | `core/src/run-library.ts` | `run-library.slow.test.ts` |
| A **gate** — a design claim measured over a batch | `core/src/tools/gates.ts` → `GATES` | `gates.test.ts` |
| How a choice **feels** — interaction shapes | `core/src/tools/shapes.ts` | `shapes.test.ts` |
| Test scaffolding | `core/src/testing.ts` | `year.test.ts` |
| The generated reference | `schema/src/reference.ts` + `core/src/tools/gen-docs.ts` | `docs.test.ts` |

---

## The year

`stepYear` is a clock; the year itself is a table in `core/src/year/phases.ts`.
Each phase declares what it must run **after** and why, and `year.test.ts`
holds the table to its own declarations.

```
ages → lifecycle → guardian → quarrels → secrets → papers → assize → bearing
     → careers → table → library → muster → land → economy → auction → succession
     → branches → rivals → marriage → births → arcs → ambient → frame → ascension
     → generation → docket
```

Every phase draws from `streamFor(world, phase.name)` — its own stream, derived
from `(seed, year, name)`. Inserting a die roll in one phase does not move any
other phase's numbers. **A phase's name is part of the save in all but name:
renaming one reseeds it.**

---

## Recipes

### Add an event
Write it in `packages/content/events/*.yaml`, or press **+ new** in the editor's
Events tab. Three distinct purposes, a frequency tier, slots for every `{TOKEN}`
in the body. `npm run validate`. Bodies over five sentences go through the
`rothfuss-prose` skill.

### Add a tree of events
Two ways, one runtime.

**A second beat** is `next: { event, after, keep }` on an outcome. `keep` names
the slots cast with the same people, which is the whole reason it beats a
`schedule` effect. `schema/src/desugar.ts` compiles the chain into a real
`ArcDef` inside `indexContent` — into the INDEX, never the bundle, so the
authored YAML stays authored and the editor cannot write a compiled arc to disk.

**Anything longer** is an `ArcDef` in `packages/content/arcs/*.yaml`, or the
editor's Substories tab, which writes both halves of the `arc: { of, node }`
binding for you. Successors gate on `fromChoice` / `fromOutcome` / `fromTag` and
on a `when` evaluated with the running instance in scope — so a guard can ask
what THIS run of the story remembers (`arcFlag`, `arcVisited`) rather than only
what the world looks like. Write that memory with an `arc_flag` effect.

### Add an attribute
Six loci in `packages/content/tools/gen-loci.mjs`, one row in
`attributes.yaml`, `npm run gen:loci`. No engine change — nothing counts
attributes. Anything mapping it onto a real quantity centres on
`ctx.genetics.expected`.

### Add an `Effect` kind
1. A variant in `EffectS` (`schema/src/event.ts`).
2. A `case` in `applyEffect` (`core/src/events/effects.ts`) — **the compiler
   will demand it**; `assertNever` is the last line of that switch.
3. A cross-reference check in `refs/known` if it names other content.
4. A test that the effect *changes something*. A case that compiles and does
   nothing is the bug this codebase actually has.

### Add a `Decider` kind
Who takes a branch is a closed union like the rest (`schema/src/decider.ts`).
1. A variant in `DeciderS`, and a row in `reference.ts`'s `deciders` list.
2. A branch in `decideBranch` (`core/src/events/deciders.ts`). It must return a
   choice on **every** path — a decision with no answer stops the clock for good
   (invariant 9), so the fallbacks there are load-bearing, not defensive.
3. A case in `deciderKind`, and a button in `DeciderPicker.vue`.
4. A rule in `decider/wiring` for whatever the new kind can name and get wrong.

### Add a slot role
1. A variant in `SlotRoleS` (`schema/src/event.ts`), with a comment saying what
   POSITION it is not — every role but this one names a seat, a hall or a
   contract, and the reason `foremost` had to exist is that the ladder is none
   of those.
2. A `case` in `candidatesFor` (`core/src/events/slots.ts`). **The compiler will
   demand it**; `assertNever` is the last line of that switch. Narrow the pool
   there rather than leaving it to the spec's filters — three roles do leave it,
   and `slots.ts` says out loud that all three are stated gaps.
3. Ask whether the POOL now guarantees something a validation rule currently
   asks a filter for. `madness/gate` accepts an outcome on a `foremost` slot
   with no `canExpress` filter because that role cannot cast anyone else.
4. Check gate 2: a role no test family can cast is a role the ambient pool will
   starve quietly. `npm run gates -- slot-fillability`.

### Add a `Condition` or `Filter`
A variant in `schema/src/conditions.ts`, then a branch in
`core/src/events/conditions.ts`. Both functions end in `assertNever`, so a
missing branch fails to compile rather than silently returning `true`.

### Add a year phase
One entry in `YEAR_PHASES`, with `after` and `why` filled in. It gets its own
RNG stream automatically. Test it alone with `phase('yourphase', ctx)`.

### Add a validation rule
One `ValidationRule` in `schema/src/rules.ts`, appended to `CONTENT_RULES`. Test
it alone with `runRule('your/rule', bundle)`.

### Add a field to the world
1. The field on `WorldState` (`core/src/world.ts`) and its initial value in
   `createWorld`.
2. The field in `SavedGameS` (`schema/src/save.ts`).
3. Read and write it in `saveGame` / `loadGame` (`core/src/save.ts`).

Skipping 2–3 does not fail. It makes the field reset silently on load, which
looks exactly like a subsystem that stopped working two centuries in.
`save.test.ts`'s "continues identically after loading" is what catches it.

### Write a test
Use `core/src/testing.ts`: `testWorld`, `place`, `marry`, `beget`, `phase`.
Build the state you mean rather than simulating four hundred years to reach it.
Reserve long runs for assertions about the *shape of a healthy run* — those
genuinely need one.

---

## Commands

**The command list, with what each one costs, is in
[AGENTS.md](AGENTS.md#commands)** — one copy, because there were five and three
of them quoted a timing that had been wrong for months.

One command is worth explaining here rather than there. `npm run gate:drag`
is the one batch that runs the game at settings the shipped code does not
allow: it sweeps the fecundity drag (issue #26) across coupling strengths
`FECUNDITY_DRAG_COUPLING` cannot take, by rebuilding the CONTENT per coupling
rather than by touching the constant. Add `--phased` to seed the founders' font
haplotypes with the drag, which is the premise the design assumes and the
content does not supply.

It sweeps **two mechanisms**, not one. `--pleiotropic` runs option B
respecified: the negative fecundity contribution carried on the `eldritch_font`
loci themselves rather than on a linked group beside them. `k` is calibrated so
that a row of one is comparable to a row of the other — same mean cost to the
population, differently distributed — which is the only way the two tables can
be read side by side. See `core/src/tools/drag-gate.ts`.

---

## What the compiler now enforces

These used to be prose rules in `AGENTS.md`. They are checks now, and the entry
in `AGENTS.md` is gone.

| Rule | Enforced by |
|---|---|
| Every `Effect`, `Condition`, `Filter`, `Target`, `Decider` and slot role is handled | `assertNever` at each switch |
| A relation filter can see the slot it compares against | `fillOrder`, and `slots/references` on a cycle |
| A check's bands name the right thing for its role | `checks/wiring` |
| An event claiming to be an arc node is one | `arcs/wiring` (both directions) |
| The save format matches the runtime types | `SAVE_SHAPES_AGREE` in `schema/src/save.ts` |
| Both content loaders agree | There is one loader; `CONTENT_LAYOUT` is the only table |
| Every collection has a place to load from | `bundle.test.ts` |
| Phase ordering matches its declarations | `year.test.ts` |
| A missing content id is loud | `Content.mustEvent` / `mustArc` / `mustAge` |
| A named content file is present | `assembleBundle` throws |
| Vue templates typecheck | `npm run typecheck:editor` (`vue-tsc`) |
| The vocabulary reference is current | `docs.test.ts` |
| Every condition and filter in the schema is evaluated | `docs.test.ts` |
