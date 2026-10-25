# AGENTS.md

The single source of instructions for Claude Code, Codex and other coding agents
working in this repository. `CLAUDE.md` is only the compatibility shim that
imports this file for Claude Code.

**Eldritch Dynasty** is a text-based generational strategy game: **A Long Line is 500 years, ~20 generations, one bloodline**; #66 adds the 300-year Short Line. The player decides who marries whom, who is spent, what gets written down — and what each child is called.

Read `DesignConcepts/eldritch-dynasty-concept-brief.md` before changing anything that touches game rules. It is the authority; this file is the operating manual.

**The design for everything the concept brief describes and the code does not have now lives in [the issue tracker](https://github.com/EldritchDynasty/EldritchDynasty/issues), not in this repo.** Read the issue before building any of it, and close the issue when you ship it. Each one is self-contained: the fact, the file paths, the type shapes, and the assertion that has to pass.

The unbuilt brief, its implementation plan, and the fertility do-to were folded into those issues and deleted — the same reason the data-model and event-editor briefs before them are gone. A specification that duplicates working code drifts, and every one of these drifted: the data-model brief was still claiming twelve heritable attributes and a `House` with a `roster`; the unbuilt brief was still saying `ModifierS` had seven kinds when it has eight. **For anything that exists, the code is the spec.** All three are recoverable in full from git history.

**What is next.** The original build order — Phases 0–9 ([#7](https://github.com/EldritchDynasty/EldritchDynasty/issues/7)–[#24](https://github.com/EldritchDynasty/EldritchDynasty/issues/24)) and fertility ([#28](https://github.com/EldritchDynasty/EldritchDynasty/issues/28)) — and the commercial pass ([#277](https://github.com/EldritchDynasty/EldritchDynasty/issues/277)) are shipped and closed. Choose actionable tracker work by the priority rule below. Issue numbers describing implemented systems are history, not open work.

**Work priority is explicit.** First progress **in-flight work**: open pull requests and already-claimed/started work that can be advanced safely. After that, choose open issues by repository priority label: `priority: P0` first, then `priority: P1`, then `priority: P2`, then unlabelled issues. A dependency-blocked higher-priority item keeps its priority: record or respect the blocker, then take the highest-priority actionable work rather than pretending the blocked item does not exist. Explicit dependency order, path/content-lane claims, and safety/landing constraints still prevent conflicting work. Unlabelled issues are not implicitly P0; use their tracker/parent ordering and explicit dependencies instead of guessing a priority.

---

## Layout

```
packages/
  schema/    Zod schemas + types. THE SINGLE SOURCE OF TRUTH.
  core/      Pure simulation. Zero DOM. Seeded RNG. Deterministic.
  content/   Authored YAML: events, ages, characters, templates, arcs, loci.
  editor/    Vue 3 + Vite authoring tool. Imports `core` directly.
  client/    Vue 3 + Vite game. Reads and writes the world through `GameSession`.
  shell/     Electron Windows host. Owns the window and the disk. Owns no rules.
  mobile/    Capacitor host: Android and iOS. Owns device services. Owns no rules.
CLAUDE.md         Claude Code compatibility shim; imports this file.
ARCHITECTURE.md   The map: where a thing lives, and how to add one.
DesignConcepts/   The concept brief. The authority on game rules.
Background/       The world bible: geography, law, money, technology, the Church.
.claude/            Claude Code: settings, skills, and the CANONICAL hook scripts.
.agents/skills/     Thin Codex launchers for those same canonical skills.
.codex/             Codex: hooks.json (pointing at .claude/hooks) and config.toml.
```

Everything unbuilt — and every open design question — is in the issue tracker.
For the other root documents, story reviews, store material and browser tests,
see [README.md](README.md#whats-here) and its Other documents table.

**Read [Background/eldritch-dynasty-world.md](Background/eldritch-dynasty-world.md) before
authoring content.** The brief says what the game is about; the world file says what the game is
*in* — what a mile costs, who may arrest a Head, how long a letter takes to reach the king's city,
and why there is no printing press. Its §26 is a pre-commit checklist and its §27 registers
everything already fixed in code and content. Where the two disagree, the brief wins.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) to find code.** It carries the package map, a table of which file owns which concept, and a recipe for each kind of change — adding an effect, a condition, a year phase, a validation rule, a field on the world. This file carries only what the code cannot say for itself.

`packages/schema` is the only definition of what an event is. The editor validates against it, the game loads against it, CI checks the whole content directory against it. Never write a second one.

The editor imports `core` directly and never reimplements simulation logic. That is what makes preview trustworthy.

A `SavedGame` is the whole world as plain, validated data; `SAVE_FORMAT` is 39.

Documentation reviewed against `main` at `098bfe02` on 22 October 2026.
Living guides describe shipped code; dated surveys, narrative drafts and
append-only logs retain their original evidence. See the audit entry in
[docs/AGENT-LOG.md](docs/AGENT-LOG.md). Founder configuration and recurring
Mystic duties remain tracker work (#1867 and #1866).

## Commands

The block below is the only place this repository states what a command costs.
Everything around it — how a session orients, what the landing does, how CI and
the janitor are shaped, and which commands answer a question nothing else can —
is in **[docs/COMMANDS.md](docs/COMMANDS.md)**.

```bash
npm install

# Measured on a four-core container, and perishable. Re-measure before quoting.
npm run check        # typecheck (vue-tsc too) + validate + test;
                     # NOT the gates: landing on it broke main 4 times.
npm run land         # session preflight: fetch, rebase, install, then run
                     # typecheck + validate + test:fast ON THAT head. It stops
                     # at preflight-green; a session NEVER pushes main. Use
                     # --full-preflight for the complete local CI-derived set.
                     # Then open/keep a ready same-repository PR. Do not merge it:
                     # auto-merge-queue.yml enqueues exact-head green CI into
                     # GitHub's native queue; merge_group CI is authoritative.
                     # Long preflights must use a harness-tracked background run;
                     # `nohup … &` dies with the container silently.
npm run land -- --status   # is a preflight running, dead, or preflight-green?
                     # A session preflight never pushes or merges.
npm run verdict      # did CI answer? green / red / pending / ABSENT (not a pass)
npm run test:fast    # ~4 min, the fix-and-rerun loop. Skips the *.slow.test.ts suites;
                     # lanes.test.ts fails the build if one turns up in this
                     # lane, or if a suite drives a batch through a tools
                     # module without declaring it.
npm test             # everything: fast and slow suites. For fresh counts and
                     # full-suite timing: npm run cost -- --full --write
npm run typecheck    # tsc over packages, then vue-tsc over the editor's and the
                     # client's templates.
npm run validate     # every content rule; exits non-zero on any error. An error
                     # names the file it is in: `events/rites.yaml → event:the_drowning`

npm run dev          # authoring tool at localhost:5173
npm run play         # the game at localhost:5174. Both run at once, on purpose
npm run shell        # the GAME inside the Electron shell — the editor keeps its own target
npm run shell:preview                 # build the client, then run the shell against dist
npm run smoke --workspace @ed/shell   # boot the shell, assert the renderer mounted, exit
npm run build:shell                   # Windows only (#67): client, then an NSIS installer

npm run harness -- 16 500             # 16 headless Long Lines, with balance numbers
npm run digest  -- 8 400              # fingerprint 8 runs; diff the block across commits
npm run gate                          # every gate — what CI will say, in one command
npm run gates   -- fire-rate          # one of them on its own, when you know which
npm run gates   -- --lane batch       # merge-blocking gate lane; sampled gates are scheduled
                                      # `batch`, `blood`, `fire-rate`, `war`, `endings`, `outcome-reach`.
npm run gate:drag / :blood / :ladder / :bearing / :endings / :war / :bottleneck
npm run gate:long / :short / :campaigns / :replay # measured sessions; each one's
                                      # question is its `//` note in package.json
npm run gate:density -- --seeds=901,902 500 300   # what the player is asked, per
                                      # generation and per Age, and how often the same
                                      # thing twice. Both campaign terms. #88's instrument
npm run gate:land -- 12 500           # acreage trend, loss routes, reader, treasury
npm run corpus                        # warm the run corpus. CI caches it
npm run mutate -- assize --limit 20   # break code on purpose; list what no test noticed
npm run lint:prose                    # advice, never a gate
npm run gen:loci                      # regenerate loci.yaml
npm run gen:docs                      # regenerate docs/VOCABULARY.md from the schemas

npm run scoreboard                    # red rate on MAIN — a branch verdict and a
                                      # cancelled run get their own columns
npm run cost                          # re-measure the figures above; --write applies them
                                      # (--full --write: also the per-file table CI packs by)
npm run agents                        # who holds which issue, across every running session
npm run agents -- take 93 --paths packages/core/src/economy
npm run agents -- check               # anyone else writing my paths? Run before the long check
npm run agents -- release 93          # when it lands. See docs/PARALLEL.md
```

`loci.yaml`, `docs/VOCABULARY.md` and `tools/test-durations.json` are
**generated**. Never hand-edit one; the last packs CI's shards, and a stale one
fails `lanes.test.ts`.

## Supported environments

This repository is supported on both **Windows and Linux**, and its operating
instructions must work under both **Claude Code and Codex**. Treat all four
combinations as first-class rather than assuming the environment used by the
author of a script or test.

It was prose until 2026-09-14 and false wherever it mattered — bash hooks, `jq`,
a Codex launcher naming one developer's `C:\` path, every CI job on ubuntu.
Nothing threw: a hook that cannot start prints nothing, so the clone stays
shallow and every "has this landed" answers wrongly. **[docs/PORTABILITY.md](docs/PORTABILITY.md)
has the full account and the reason behind each rule below.**

- **Every operating script is `.mjs`, spawned with `node`.** No `.sh` under
  `.claude/`, `.codex/` or `tools/` (`.devcontainer/` is exempt — it IS a Linux
  image). Claude's hooks use exec form; shell form reaches `sh -c`, Git Bash or
  PowerShell depending on the box, and the three disagree.
- **One script, two registrations.** `.claude/settings.json` and
  `.codex/hooks.json` name the same files; neither keeps a copy. A hook reads
  paths via `hookPaths`, never one key — Codex's `apply_patch` names files in a
  diff envelope and carries no `file_path`.
- **The four things that differ live in `tools/portable.mjs`.** Import them.
- **A platform branch takes the platform as an ARGUMENT**, so the other
  platform is testable from this one.
- Assume no POSIX separators, `/bin/bash`, `/dev/null` or `/tmp`. In a test
  spawn `process.execPath`, and build a `file://` URL with `pathToFileURL`.
- Keep this file authoritative, agent-neutral, and inside BOTH size budgets
  (`codemap.test.ts` and `codex.test.ts`). Launchers may adapt, never diverge.
- When changing commands, hooks, or test infrastructure, verify the current
  platform and preserve the other platform deliberately; platform-only behavior
  must be guarded and covered by a test.

---

## Non-negotiable invariants

These are not style preferences. Breaking one silently breaks the design, and every test in the suite exists because the opposite of it shipped at some point.

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

### 5. The verbs are enumerated, never scripted

`Effect`, `Condition`, `Filter`, `Target`, `Decider` and `SlotRole` are closed unions. Adding a variant is a deliberate act with a compiler error at every site that has to keep up — the correct amount of friction.

That only holds because each of those sites now ends in `assertNever`. It did not before: a `switch` with no default and an `if ('x' in c)` chain ending in `return true` both accept a new variant in silence — the effect applies nothing, the condition **passes**, and every event carrying it fires unconditionally for a thousand years. Never end one of those functions with a permissive default.

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

### 11. A declared field that nothing reads is a bug, not a stub

The four subsystems below were all "already there" — in the schema, in authored content, or named in the brief — and all of them did nothing. None threw. Each looked exactly like a working feature that had not come up yet.

- **Effects apply, or they are not effects.** `kind: relationship` was in the switch with a comment saying another subsystem handled it. There was no other subsystem, and four authored outcomes — including the seal feud's inherited grudge — discarded themselves. If you add an `Effect` kind, the switch case does the work or the case does not exist.
- **Contracts bind to a PERSON.** Binding a retainer to the house made `onEmployerDeath` unreachable, and `term` with it. Every field that decides how service ends was dead.
- **Every Age reveals a clause** (§18) — the design's own answer to promise debt, and it was not built. `ActiveAge.paid.clause` was written by nothing and `clauseBearing` was read by nothing, so runs reached 2042 with two clauses of nine and the God rung, which needs seven, could not be reached in any run.
- **Respect decays** (§17). It only ever moved when an authored effect moved it, so the endgame squeeze — Madness to ascend, Respect to be allowed to, Madness destroys Respect — had one of its three jaws missing.

- **A filter has to be able to see what it compares against.** `evalFilter` passes a `relation` filter whose counterpart slot is not cast yet, because a comparison with nobody is not one it can judge. `resolveSlots` filled slots alphabetically, so four authored constraints — `CHALLENGER` not `HEAD`, `PUPIL` not `TUTOR`, `HEAD` not `SON`, `NAMED_ANCESTOR` not `SUITOR` — read as constraints and narrowed nothing. `fillOrder` fills in dependency order now; `slots/references` fails the build on a cycle, which is the one case no order can satisfy.

Grep for a schema field before assuming it works. `onEmployerDeath: 0 refs in core` is the whole bug report.

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


### 16. Every post is a man's

`canHoldPost` (`packages/schema/src/career.ts`) is the only placement gate. All three doors that write `Person.career` ask it: the player's `career` order at the table, the steward's `placePosts`, and the authored `career` effect.

- **§18's careers are institutions, not menu items** — a commission in the Warden's levy, ordination at the Bramme chapter house, a place in the King's household, a Braccish partnership, a bench at Cawdry, a berth out of Sarrow, a bed at the Colleges. Every one of them is closed to a woman.
- **No `sex` field on `CareerDef`.** A per-career flag is one the ninth career forgets to set.
- The three doors asked only for an age. So the steward bought commissions for daughters out of a treasury with six seats to spend, the table offered them, and the clergy's Madness cover and breeding-pool exclusion landed on women — while the prose those events carry says *"ordination is not a post a man leaves"*, *"Two sons, and one place"*, *"He is very good at it"*.
- **`careers/gate`** is the content half. The engine gate turns a mis-cast placement into a placement that does NOTHING — the outcome fires, pays its Respect, writes its chronicle line, and nobody is placed. The rule refuses any bundle whose `career` effect casts from a slot that is not already gated to men, the same way `madness/gate` does.
- This is **not** the Mystic restriction and shares no code with it. A woman is barred from the posts and from nothing else: the tutor's term, the shelf, the Threshold four, the Match and the Record are all hers.

---

## Skills

Five, and they do not overlap. Reach for the right one:

- **`eldritch-story`** — architecture, and the frame. What a phase is *for*, how an Age pays its three debts (clause, standing change, rumour), the escalation stage each Age sits on, the two antagonist tiers, cast slots, endings, the two-class Ledger. Also owns the *prose* of the frame, interludes, prologue, Ledger clauses, nested tales and Age blurbs. Use it before writing content, not after.
- **`rothfuss-prose`** — sentences, for **events**. Event bodies, outcome text, chronicle entries, character blurbs. Plain and concrete. The voice contract every body over five sentences is held to.
- **`lovecraftian-prose`** — sentences, for the **frame and myth layer**. Elevated Dunsanian register, mythic distance, describing the incomprehensible by its effects.
- **`frontend-design`** — distinctive visual direction when creating a new UI
  or substantially reshaping an existing one.
- **`interface-design`** — craft, hierarchy, states and design-system
  consistency for the game client and editor. It owns no game rules.

**The register split is load-bearing.** Events are plain; the frame and myth layer are ornate. Dunsanian diction in an event body is register bleed, and so is plain reportage in an interlude.

## Where the rest of it lives

This file is the rules. Everything else has moved next to the code it is about,
so an agent loads only what its task needs:

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | The shared entry point: rules, commands, invariants, tests, and task routing. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The map. Which file owns which concept, and a recipe for each kind of change. |
| [docs/COMMANDS.md](docs/COMMANDS.md) | What each command is for, how a session orients, the landing's four verdicts, CI and the janitor. |
| [docs/VOCABULARY.md](docs/VOCABULARY.md) | **Generated.** Every effect, condition, filter, slot role, purpose, phase and rule. Read this instead of the schemas. |
| [docs/FAILURES.md](docs/FAILURES.md) | Bugs that shipped, and what each one teaches. All of them silent. |
| [docs/PORTABILITY.md](docs/PORTABILITY.md) | Windows and Linux, Claude Code and Codex: what broke, and what enforces it now. |
| [docs/PARALLEL.md](docs/PARALLEL.md) | Several agents at once: lanes, claims, and what does not parallelise. |
| [docs/BALANCE-LOG.md](docs/BALANCE-LOG.md) | What every balance change measured. Append-only; read the entry for the system you touch. |
| [docs/AGENT-LOG.md](docs/AGENT-LOG.md) | The same, for the agent workflow itself. |
| [docs/LOCALISATION.md](docs/LOCALISATION.md) | The localisation storage decision: saved prose keeps its rendered words (#276). |
| [docs/MODDING.md](docs/MODDING.md) · [docs/PLAYTEST.md](docs/PLAYTEST.md) · [docs/GAME-LOOP.md](docs/GAME-LOOP.md) | The Mod Editor; the first-player playtest runbook; the loop in plain language. |
| [packages/core/AGENTS.md](packages/core/AGENTS.md) | Simulation. |
| [packages/schema/AGENTS.md](packages/schema/AGENTS.md) | Types, validation, the save format. |
| [packages/content/AGENTS.md](packages/content/AGENTS.md) | Writing events and characters. |
| [packages/editor/AGENTS.md](packages/editor/AGENTS.md) | The authoring tool, and its silent-failure list. |
| [packages/client/AGENTS.md](packages/client/AGENTS.md) | The game, and the one rule that keeps it on its side of the seam. |
| [packages/shell/AGENTS.md](packages/shell/AGENTS.md) · [packages/mobile/AGENTS.md](packages/mobile/AGENTS.md) | The Windows and mobile (Android, iOS) hosts. Neither owns a rule. |

The enforcement points for the invariants above are greppable:

```bash
grep -rn "INVARIANT " packages --include=*.ts
```

## Naming the children

Every newborn of the player's household gets a generated name **and** a
`pendingNames` entry. The generated name means nothing downstream can ever hold
a nameless person; the queue is an offer, not a blocker. Ignoring it is a valid
way to play — the chronicler picked a name, and the chronicler is not you.

## Tests

Grouped by the kind of failure they catch rather than by module. How many there
are, and what a run of them costs, is in the command block above.

- **`*.slow.test.ts` plays whole games.** `test:fast` skips them;
  `lanes.test.ts` keeps millennium batches out of that loop. `npm run check`
  runs all tests locally. Hosted CI reads `tools/ci-evidence.json`: checked
  `merge-blocking` suites run on full PR/merge-group CI; `nightly` suites
  run in the complete daily slow suite. `npm run land` defaults to typecheck,
  validate and `test:fast`; `--full-preflight` runs the complete local set.
  The native merge-group `CI required` remains authoritative.
- **A suite can play whole games with no `advance` in it.** `gates.test.ts` was
  41% of the fast lane; the runs happen inside the gates it calls. Driving a
  batch through `tools/` is declared in `lanes.test.ts` for exactly that reason.
- **The slow lane's floor is its longest FILE**, because vitest parallelises per
  file. `record` was 451 seconds of it, playing 240 runs of 458 years to make
  two assertions. Split such a file BY TEST. Never by seed range: these are
  batch statistics, and taking seeds out of a batch changes what it claims.
- **`expectHealthyWorld(ctx)`** (`testing.ts`) asserts a world is internally
  coherent, and is free at the tail of a run that already happened. Sample
  THROUGH a run rather than only at the end — the first bug it found is
  invisible at 2042.
- **`playedRun(bundle, seed, years)`** (`corpus.ts`) reads a played run back
  instead of replaying it, an order of magnitude cheaper. It is a cache of a
  pure function, keyed on content AND code — never a golden file.
- **A batch claim goes through `expectRate` or `expectMean`** (`testing.ts`),
  never a bare `toBeGreaterThan` on a rate or an average. They assert the claim
  AND that the batch can carry it — at least two standard errors of margin —
  and fail with the batch size that would. Five tests have broken on commits
  that changed nothing they measured, because adding ANY template re-rolls
  which scene wins every draw for a thousand years. A thin margin is invisible
  until it is spent; this makes it a build failure with a prescription
  attached instead of a mystery.
- **A gate is a function over a bundle, not a script.** Every gate in
  `tools/gates.ts` returns its verdict rather than printing it, so
  `gates.test.ts` can hand it content it must reject. A gate nobody has seen
  fail is indistinguishable from a gate that cannot fail; four of them were in
  that state for their whole lives.
- **Build the state you mean.** `core/src/testing.ts` gives you `testWorld`,
  `place`, `marry`, `beget` and `phase`. Simulating four hundred years to reach
  a widow is not a test, it is a wait.
- **Do not pin a test to one seed reaching one state.** Two did, and both failed
  the day the RNG streams were split, on a codebase where the behaviour they
  described was demonstrably intact. Assert the mechanism: "standing falls as
  well as rises", not "six seeds end on six tiers".
- **Measure fire rates when you touch arcs, slots or selection.** An event that
  never fires is not in the game, and nothing will tell you.

**The failure mode this codebase actually has is silence.** Nothing here throws.
A house that goes extinct by 1150, a chronicle that stops updating, an editor
loading a different bundle — all of them look like a working simulation from the
outside. Write tests that assert the shape of a healthy run, not that functions
return. [docs/FAILURES.md](docs/FAILURES.md) is the catalogue.

[docs/TEST-COVERAGE.md](docs/TEST-COVERAGE.md) is the dated coverage survey and what
it found — three live bugs, one mechanic that had never run, and why line
coverage reads high on a dispatch chain nobody has ever taken a branch of.

## Branches, and the tracker

The rules an agent needs before it writes anything, in the order it needs them.
The lanes, the claim protocol and what does not parallelise are in
[docs/PARALLEL.md](docs/PARALLEL.md); this is the short version that has to be
true even if nobody opens it.

- **Work on a branch, never on `main`.** A web session is handed one — the name
  comes from the harness, before you have read the tracker, so it will not carry
  an issue number and does not need to. Locally: `git checkout -b claude/<topic>`
  before the first edit.
- **One issue owns one growing branch and one PR.** Keep adding commits/sub-steps
  to that branch and PR until the issue is complete; do not open a new stacked
  or follow-up PR for each slice. If a slice must land independently, make it a
  child issue first so the branch/PR boundary still matches an issue boundary.
- **Claim each issue before you start it**: `npm run agents -- take <issue>
  --paths <what you will write>`. Every agent authenticates to GitHub as the
  same user, so an assignee cannot say WHICH agent holds an issue and cannot
  arbitrate a race; a ref can, because creating one is a compare-and-swap.
  Denied means denied — take another issue rather than working it in parallel
  and meeting the other agent at merge time.
  With no shell (a connector-only session), create the working branch and
  comment `/claim <issue> --agent <branch> --paths <paths>` instead. If the
  connector refuses that comment, commit the same line as `CLAIM_REQUEST` on a
  `claim-request/<branch>` branch and read `CLAIM_RESULT` there
  ([docs/PARALLEL.md](docs/PARALLEL.md)); only if both are refused, stop.
- **Read the issue before building any of it.** Each is self-contained: the
  fact, the file paths, the type shapes, the assertion that has to pass.
- **Close it from the landing commit**: `Closes #93, closes #94`, a keyword
  before EACH number — `Closes #93, #94` closes only the first. GitHub closes
  them when the commit reaches `main`, with no PR involved.
- **Leave the tidying to `janitor.yml`.** It deletes your branch once it is an
  ancestor of `main` and retires the claims it was holding. You cannot do this
  yourself — a session's git proxy refuses ref deletion — so do not try, and do
  not read a surviving branch as work in flight.
- **`npm run agents -- check` before the long/full run**, which says whether
  somebody landed in your paths while you worked, and prints the closing line
  your commit needs.

## Working style

- **Run the harness before claiming a balance change works.** A full run is multi-hour; batch simulation is the only viable balance method. #133 supplies the measured 500-year playtime.
- When a test fails, work out whether the test or the code is wrong. Several "failures" here were correct behaviour asserted incorrectly — rare upward font mutation is *designed*.
- Prefer fixing the model over special-casing the symptom. Nearly every bug in this codebase has been structural: children in the wrong household, widows still married to dead men, cast slots never refilled, counters at module scope.
- **Preflight with `npm run land`, then leave a ready PR for automatic native merge-queue admission.**
  Standing authorization: run preflight and keep/open a ready same-repository PR
  without asking. Do not click Merge, directly merge `main`, or post `/land`
  (`/land` is retired). `.github/workflows/auto-merge-queue.yml` admits only
  an open, ready `main` PR whose exact head has green `CI required`; early or
  stale events no-op, and the successful `check` handoff revalidates the head
  before enqueueing. If admission was missed, a factual PR-body edit may
  retrigger it. GitHub then tests the synthetic `merge_group` head and merges
  only when `CI required` is green. `npm run check` omits gates; use
  `--full-preflight` when complete local CI-derived evidence is useful. The
  admin bypass is emergency-only.
  See [docs/COMMANDS.md](docs/COMMANDS.md#the-landing).
- **Landing must outlive the turn; never use `nohup … &`.** Use the harness-tracked background run (Claude Code: `run_in_background`) and read it with `npm run land -- --status`. Details and failure recovery live in [docs/COMMANDS.md](docs/COMMANDS.md#the-landing).
- **Never ask a fresh clone what has been merged.** It arrives shallow, and
  `merge-base --is-ancestor` answers FALSE past the graft boundary rather than
  failing — a cleanup script trusted that once and reported 29 merged branches as
  unmerged. `tools/orient.mjs` unshallows at session start; if you are unsure,
  `git rev-parse --is-shallow-repository` before any "has this landed" reasoning.
  See [docs/COMMANDS.md](docs/COMMANDS.md#how-a-session-starts).
- **With more than one agent running, the check that counts is the one after the rebase.** `main` moving is the normal case, and a branch green against the base it forked from says nothing about the base it lands on — two content branches can each pass every gate and their merge fail gate 4. `npm run land` rebases for the session preflight; GitHub's merge queue rebases again and runs the authoritative required CI on the synthetic integration commit before merging. Claiming, closing and the janitor are under "Branches, and the tracker" above; the lanes, and the one thing that does not parallelise, are in [docs/PARALLEL.md](docs/PARALLEL.md).

## Do not

- Add a Madness path that skips `canExpress`, or a death path that skips `kill()`.
- Add a second place that applies an event outcome. Everything goes through
  `commitOutcome`.
- Give a person a second open membership record.
- Put an id counter, or any mutable simulation state, at module scope.
- Make Eldritch Power reliable, schedulable, or manifest-on-demand at any tier.
- Spawn people outside `core/src/people/minting.ts`.
- Hand-edit `packages/content/loci.yaml`, `docs/VOCABULARY.md` or
  `tools/test-durations.json`.
- End a switch or `in`-chain over a closed union with a permissive default.
- Add a field to `WorldState` without adding it to the save format.
- Reach into `ctx.world` from a client.
- Keep a hand-written copy of a closed union anywhere, **test helpers
  included** — seven copies of the ladder roles compiled fine and all seven
  answered "no" about a new one (`docs/FAILURES.md`).
- Let the game adjudicate between two contradicting accounts in its own voice.
  There is no narrator who knows the truth — there is only Daveed, and he is not
  neutral.


## Evidence and remaining work

- **Reach is a measured funnel.** An event's premise, cast, eligibility,
  selection and resolved outcome are separate questions. Use the gate runner
  (`npm run gates -- fire-rate`) and outcome-reach
  evidence for the current bundle; do not acquit a red result by remembering
  a rare tail from an older batch. Frame events use record-reading cadence,
  while ambient events share frequency rations.
- **Historical measurements stay dated.** `docs/BALANCE-LOG.md` and
  `docs/REGENCY-PACING.md` identify their code/content, campaigns, seeds and
  policies. They do not establish today's rate after another content change.
- **Human response is unverified.** `docs/PLAYTEST.md` records the waived,
  unrun studies. Automated reach, deterministic replay and mechanism tests
  cannot establish attachment, comprehension or enjoyment.

For implemented-system history, see [ARCHITECTURE.md](ARCHITECTURE.md#shipped-systems-and-how-they-behave).
