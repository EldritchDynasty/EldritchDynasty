# core — the simulation

Pure. Zero DOM, no filesystem, no `Math.random`. Everything is a function of
`SimCtx` and a seeded stream.

## The shape

```
sim.ts            bootstrap, and the player's verbs (rename, snapshot)
world.ts          WorldState — the only thing that mutates. SimCtx.
session.ts        GameSession — what a client is allowed to touch
save.ts           world <-> SavedGame, and `digest` for comparing runs
rng.ts            streamFor(world, system) — one stream per system per year
year/phases.ts    YEAR_PHASES: what a year IS, in order
year/step.ts      the clock that runs them
people/           store, factory, demography, branches, succession, minting…
events/           selection, slots, conditions, effects, decisions, arcs
genetics/         loci, meiosis, expression
ages/scheduler.ts Ages as a hazard process; the Ledger pays out here
economy.ts        income, upkeep, tithes, standing decay
assize.ts, land.ts, muster.ts, campaign.ts, record.ts, replay.ts, …
                  one file per system — ARCHITECTURE.md's table names each
testing.ts        testWorld / place / marry / beget / phase — build the state you mean
tools/            validate, digest, gates, the measured sessions, gen-docs —
                  all runnable via npm scripts
```

## Before you touch anything

```bash
npm run test:fast         # the loop
npm run check             # everything. Before you claim it works.
npm run digest -- 8 400   # before AND after a refactor: the block must not move
```

What each of those costs is in [AGENTS.md](../../AGENTS.md#commands), stated
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

## Adding a system

One entry in `YEAR_PHASES` with `after` and `why`. It gets a stream
automatically, `year.test.ts` checks the ordering claim, and
`phase('name', ctx)` runs it alone in a test.

Full recipes: [ARCHITECTURE.md](../../ARCHITECTURE.md).
Every vocabulary — effects, conditions, filters, roles: [docs/VOCABULARY.md](../../docs/VOCABULARY.md).
