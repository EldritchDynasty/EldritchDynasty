# Eldritch Dynasty

A text-based generational strategy game. **A Long Line is five hundred years, roughly twenty generations, one bloodline.**

You are not a character. You are the will of a bloodline — the thing that persists while individuals are born, ruined and buried. You never fight, never explore, and never speak a line of dialogue. You decide **who marries whom**, **who is spent**, **what gets written down**, and what each child is called.

> In year 1042 your ancestor signed something. In 1542 the other party comes to collect.

**Status:** pre-release. The simulation, content pipeline, authoring tool, game client, Windows Electron host and Android/iPhone (iOS) Capacitor host are working. `npm run play` runs the browser client with the 300-year Short Line selected; the same start screen also offers the complete 500-year Long Line, from 1042 to the reckoning in 1542.

The verified `v0.1.0-beta.3` prerelease has an **unsigned Windows NSIS installer and Android AAB**; iOS has unsigned simulator save/resume/export/import proof. Signing, store accounts, TestFlight and physical-device release checks remain owner-blocked in [issuesneedingowneraction](issuesneedingowneraction). These are development proofs, not published store releases. macOS and Linux desktop builds are out of scope.

New to the design? [docs/GAME-LOOP.md](docs/GAME-LOOP.md) is a plain-language walkthrough
of the loop and how a family progresses — the Ascension Ladder and the barriers between
its rungs.

---

## What's here

```
packages/
  schema/    Zod schemas + types. The single source of truth.
  core/      Pure simulation. Zero DOM, seeded RNG, deterministic.
  content/   Authored YAML: events, ages, characters, templates, arcs, loci.
  editor/    Vue 3 + Vite authoring tool. Imports core directly.
  client/    Vue 3 + Vite game. One client for browser, Windows, Android and iOS.
  shell/     Electron Windows host. Owns the window and the disk, and no rules.
  mobile/    Capacitor host for Android and iOS. Owns device services, and no rules.
AGENTS.md         Shared agent entry point: rules, commands, and task routing.
CLAUDE.md         Claude Code compatibility shim that imports AGENTS.md.
ARCHITECTURE.md   Where a thing lives, and how to add one.
docs/COMMANDS.md  What each command is for, the landing, CI and the janitor.
docs/GAME-LOOP.md Plain-language guide to the loop and how a family progresses.
DesignConcepts/   The concept brief. The authority on game rules.
Background/       The world bible: geography, law, money, technology, the Church.
story/            Spoiler-bearing narrative reviews of the implemented Ages.
store/steam/      Draft Steam page copy and its asset/publishing checklist.
tests/e2e/        Playwright browser tests (npm run test:e2e).
tools/            Agent workflow, CI evidence, claims, landing and measurements.
.github/          CI, release, merge-queue and maintenance workflows.
.devcontainer/    The CatDesk development container and setup guide.
.interface-design/system.md  The game and editor's interface design system.
.claude/          Claude Code: skills, settings, and the canonical hook scripts.
.agents/skills/     Codex launchers for those same skills (no duplicated manuals).
.codex/           Codex: the doc-budget setting, and hooks pointing at .claude/hooks.
```

The original build order and commercial pass ([#277](https://github.com/EldritchDynasty/EldritchDynasty/issues/277)) are complete. Open work lives in
[the issue tracker](https://github.com/EldritchDynasty/EldritchDynasty/issues), selected by the priority rule in [AGENTS.md](AGENTS.md).
[Suggestions.md](Suggestions.md) is the current decision surface for improving the game.

## Other documents

| File | Purpose and reader |
|---|---|
| [README.md](README.md) | Project orientation for players, contributors and agents. |
| [Suggestions.md](Suggestions.md) | Current improvement priorities and tradeoffs for the owner and implementers. |
| [fullstory.md](fullstory.md) | Complete story reference for authors and reviewers; contains ending and identity spoilers. |
| [criticalprose.md](criticalprose.md) | Narrative promises and prose beats for content authors; contains spoilers. |
| `market research.md` | Dated market evidence and commercial implications for the owner. |
| [issuesneedingowneraction](issuesneedingowneraction) | Deferred signing, account, store and device requirements, with existing release proof. |
| [docs/](docs/) | Operating guides, generated vocabulary, playtest/modding guides and dated measurement logs. |
| `package.json`, `package-lock.json` | Workspace commands, dependencies and their locked versions. |
| `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `playwright.config.ts` | TypeScript and test configuration for contributors. |
| `.gitattributes`, `.gitignore` | Git text handling and generated/local file exclusions. |

## Run locally

```bash
npm install
npm run check     # typecheck + validate + tests; not the gates/landing
npm run dev         # authoring tool at localhost:5173
npm run play        # browser game at localhost:5174
npm run shell       # the game client in the Electron host
npm run android     # rebuild, sync and run the Android debug build
npm run ios         # rebuild, sync and run on iOS (macOS)
npm run ios:build   # unsigned iOS Simulator build (macOS / CI)
npm run build:shell # Windows NSIS installer (local builds may be unsigned)

npm run harness -- 16 500    # 16 headless Long Lines, with balance numbers
npm run digest  -- 8 400     # fingerprint 8 runs; diff across commits
```

## The interesting part: genetics

Characters do not inherit stats. They inherit **alleles**, and stats are computed. Real diploid genomes — loci, dominance, recombination over centimorgan positions, mutation. Everything the design asks for is a consequence of that rather than a special case:

- Regression to the mean and a fat tail for throwbacks fall out of Mendelian segregation.
- Cousin marriage concentrates the wanted alleles *and* exposes the founder's deleterious recessives, from one mechanism, in opposite directions.
- **Eldritch Power is X-linked and family-exclusive.** A son's font comes only from his mother; a father passes his single X intact to every daughter. So marrying outward genuinely dilutes the blood, cousin marriage is *the* mechanism rather than *a* mechanism, and daughters are the family's vault.
- Men are hemizygous on the X, so they express what women only carry — and break for the same reason. The setting's central law is a fact about chromosomes that the Church has built a doctrine on misexplaining.
- **Fertility is inherited too**, weighted seventy-thirty toward the mother. A man of a thin line is a mild disappointment; a woman of one is the whole marriage. So a fertile daughter is at once the best bride to give away and the worst one to lose. Fecund couples leave more descendants, so the family's fecundity climbs for two centuries and then settles — concentration pushes it up, marrying outward pulls it back, which is exactly the shape the blood itself has.
- Strength is sexually dimorphic: men are the stronger in about nineteen pairs in twenty. The twentieth is a woman worth writing down.

The attribute list is **open** — an attribute is six loci and a description, and nothing in the engine counts them.

## The family is more than one household

Name an heir and everyone else becomes a **cadet branch** — a hall of its own, with its own crowding brake, its own books, and its own memory. The family grows sideways the way real ones did, roughly seventy living across six halls by the collection rather than twenty in one room.

Branches pay a tithe while they are content and stop while they are not. Grievance rises in a hall that holds a man who could have led and watches somebody lesser hold the seal, and it fades when nothing is wrong. When the main line runs out of men the seal goes to a cousin, and he is sent for, and everyone learns his name by spring.

## The debt pays out on a schedule

The Ledger is campaign-shaped rather than global. **A Short Line** carries a three-clause contract across 300 years; **A Long Line** carries nine clauses across 500 years. You begin knowing one, and later clauses are recovered only by a house that is keeping records, which means an archivist in service and paid for. The number recovered by collection depends on whether anybody was writing things down during the centuries you were busy.

Clauses arrive in the chronicle in the contract's own hand. They are the one thing in the book nobody in the family wrote, and the only entries you are never offered the chance to edit.

## You are the one deciding

Choice events, the slots a mission asks you to cast, and the Record block — Record, Omit, Embellish — all go on a docket, and **the year does not turn while a decision stands**. Choices you cannot afford are shown anyway, greyed, with the reason: an unavailable option is information.

Omitting an entry does not remove it. It prints as a dated blank line, and the blanks are the thing players screenshot.

Hand the pen back whenever you like — the chronicler answers through exactly the same code, which is what the headless harness runs for a complete Long Line at a time.

The implemented game also includes **achievements**, a **Plain English** prose mode alongside the Original, and a physical library whose books wear, can be restored, sold, burned, paid as tribute or stolen. **The Long Wait** makes an unwoken man's future a house decision: keep waiting, or declare him mundane and free the succession; a waking past thirty comes through a scripted scene. The engine also has a 33-year demo profile, **A Demonstration**, using the same systems for a dated introduction with a complete Age, a Record decision, an interlude and a verdict. It is not yet offered on the normal start screen.

## Frequency

Every event and character template declares `common | uncommon | rare | mythic`. It is a **rationing tier**, not a weight synonym — it reaches into scheduling (caps, cooldowns, a drought curve), presentation (a common event is one grey line; a mythic one is an illuminated page named in the chronicle forever), folklore, and whether a Record choice is required.

A mythic event is not *unlikely*. It is rationed: at most three in a Long Line, and the drought curve makes sure you get them.

## The engine, from outside

A run is reached through one narrow `GameSession` surface rather than through simulation internals. It owns prompted decisions (`choose`, `send`, `match`, `record`), deliberate house actions (`order`, `muster`, naming and founding), and read models (`view`, `table`, `land`, `book`, `line`); persistence stays on the same module through `save` and `resumeGame`. The Vue client centralises every call to that seam in `packages/client/src/lib/game.ts`:

```ts
const game = newGame(loadContent(), { seed: 1042, campaign: 'long' });
game.advance(400);                       // stops the moment something needs an answer
const [decision] = game.pending;
game.choose(decision.id, 'send_the_boy');
const view = game.view();                // plain data: halls, chronicle, docket, clauses
const table = game.table();               // deliberate actions and their current costs
const save = game.save();                 // versioned, validated, and it reloads bit-identically
```

A year is an ordered table of named phases, each with its own RNG stream, so a system can be added, reordered or retimed without moving anybody else's dice. Content is loaded by one loader from one declared layout, indexed once, and every closed union in the engine ends in `assertNever` — the failure mode here is silence, and the compiler is the cheapest thing that breaks it.

## Contributing

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the map and [AGENTS.md](AGENTS.md) for the rules. It carries the invariants, the prose contract for event text, and a list of bugs that shipped — because the failure mode in this codebase is **silence**. Nothing throws. A house that quietly goes extinct, a chronicle that stops updating, an event that never fires: all of them look like a working simulation from the outside.
