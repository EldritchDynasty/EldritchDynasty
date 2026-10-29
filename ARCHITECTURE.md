# ARCHITECTURE

The map. `AGENTS.md` carries the rules you cannot derive from the code; this
file tells you where the code is and how to add to it.

Owner map and year-phase order reviewed against `main` at `8b09dbee` on
26 October 2026. The code remains the authority when a later change moves an
owner or predicate; older measurements below retain their original context.
Save continuation and the replay owner map were rechecked at `524ea5fe` on
27 October 2026.

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
| `mobile` | Capacitor host for Android and iOS: device services, save/import/export bridge and store artefacts | Rules, simulation state, duplicate client UI |

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
| What each Table order **costs the player** — maintenance, consequential or ambiguous | `core/src/table-load.ts` → `TABLE_ORDER_LOAD`, `classifyCommand`; bot proxy `core/src/tools/table-load-report.ts` | `table-load.test.ts`; dated evidence in `docs/BALANCE-LOG.md` (#1992) |
| Regency/unwoken pacing, maintenance repetition and gaps in progress | `core/src/tools/density-observer.ts`, `density-report.ts` | `tools/stall.test.ts`; dated evidence in `docs/REGENCY-PACING.md` |
| Genetics — loci, meiosis, expression | `core/src/genetics/` | `sim.slow.test.ts`, `attributes.slow.test.ts` |
| **How the blood is handed on** — the font's meiotic drive | `core/src/genetics/meiosis.ts` → `driveToward`, and `drive` in `loci.yaml` | `blood.test.ts`, `blood.slow.test.ts` |
| Who the house marries when nobody is asked | `core/src/people/demography.ts` → `preferred` | `table.test.ts` |
| Who can be **cast** in a slot | `core/src/events/slots.ts` → `candidatesFor` | `arcs.slow.test.ts` |
| What an **effect** does | `core/src/events/effects.ts` → `applyEffect` | `ledger.slow.test.ts` |
| What a **condition** tests | `core/src/events/conditions.ts` | — |
| **Who takes a branch** | `schema/src/decider.ts` + `core/src/events/deciders.ts` | `deciders.test.ts` |
| Which slot fills **first** | `core/src/events/slots.ts` → `fillOrder` | `checks.test.ts` |
| Practical **learned Mystic** checks | `core/src/people/library.ts` → `knowsAffinity`; `events/checks.ts` → `family_knows` | `library.test.ts`, `checks.test.ts` |
| Guarded weighted **outcomes** | `schema/src/event.ts` → `OutcomeGuardS`; `core/src/events/effects.ts` → `outcomeAdmits` | `influence.test.ts`, `rules.test.ts` (`outcomes/guard`, `outcomes/cover`) |
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
| The ladder's public **diagnosis and evidence route** | `core/src/ascension.ts` → `ascensionBlockersFor`; `core/src/session.ts` → `powerEvidenceRoute` | `ladder.test.ts`, `ascension.test.ts` |
| **Achievements** and their measured earn rates | `core/src/achievements.ts`, `core/src/achievement-rates.ts` | `achievements.test.ts` |
| The **rites** — what the top three rungs cost | `core/src/events/rites.ts` | `rites.test.ts`, `rites.slow.test.ts` |
| Standing orders — the table | `core/src/table.ts` | `table.test.ts` |
| Calling the major **rites** and assembling their public cast | `core/src/rite-orders.ts` | `rites.test.ts`, `table.test.ts` |
| Callable **forcing rites**, one lifetime attempt per boy | `core/src/rite-orders.ts`, `events/decisions.ts`; `schema/src/rules.ts` → `rites/forcing` | `table.test.ts`, `influence.test.ts`, `rules.test.ts` |
| **The Long Wait / Late Waking** — declaring an unwoken man mundane, learning and scripted waking after thirty | `core/src/table.ts`, `core/src/people/library.ts`, `core/src/people/factory.ts`, `packages/content/events/rare_blood.yaml`, `packages/client/src/components/Table.vue` | `table.test.ts`, `library.test.ts`, `core/src/events/reach.test.ts` |
| The physical **library** — wear, restoration, sale, burn, tribute and theft | `core/src/people/library.ts`, `core/src/table.ts` | `library.test.ts`, `table.test.ts` |
| Money and standing | `core/src/economy.ts` | `economy.slow.test.ts`, `ledger.slow.test.ts` |
| Standing **Mystic duties** — learned, available, paid practice, paused study and current assignable quotes | `core/src/mystic.ts`, `presence.ts`; `schema/src/mystic.ts`; `packages/content/mystic-workings.yaml` | `mystic.test.ts` |
| **Civilian practice** — library care, provisions, recovery, teaching and construction | `core/src/mystic-civilian.ts`, `mystic.ts`, `people/library.ts`, `land.ts` | `mystic.test.ts` |
| **Outside Mystic service** — contacts, contracts, commissions and inherited return obligations | `core/src/mystic-contracts.ts`, `schema/src/mystic.ts` | `mystic.test.ts` |
| **Mystic practice calibration** — historical strategies, public policy ablations and read-only training/use funnels | `core/src/tools/mystic-repertoire-report.ts`, `mystic-practice-report.ts`, `mystic-practice-policy.ts`, `mystic-practice-funnel.ts`, `mystic-accounting.ts` | `tools/mystic-accounting.test.ts`, `mystic.test.ts`; declared campaign batches in `docs/BALANCE-LOG.md` |
| **Field Mystic support** — deployment, coverage, attrition and capture | `core/src/muster.ts`, `mystic.ts`, `presence.ts` | `mystic-muster.test.ts`, `muster.test.ts` |
| **Covert threats and expeditions** — preparation, defence, evidence, custody and return | `core/src/covert.ts`, `covert-lifecycle.ts`, `covert-operations.ts`, `presence.ts` | `covert.test.ts` |
| Emergency Primordial interventions | `core/src/events/harm.ts`, `events/primordial.ts`, `presence.ts`; `schema/src/primordial.ts` | `events/primordial.test.ts`, `events/primordial-catalogue.test.ts`, `presence.test.ts`; `tools/primordial-report.mjs` |
| The Ledger — Ages and clauses | `core/src/ages/scheduler.ts` | `ledger.slow.test.ts` |
| The **prologue** — founder identity, Examination and founding choices | `schema/src/founder.ts`; `core/src/people/founding-cast.ts`, `prologue.ts`, `sim.ts`, `session.ts`; `packages/content/prologue.yaml` | `founder-identity.test.ts`, `founding-inheritance.test.ts`, `prologue.test.ts`, `tools/signing-gate.test.ts` |
| The **ending** — the last night, and the ring | `core/src/ending.ts` + `packages/content/endings.yaml` | `ending.test.ts` |
| A **chapter** — the years between one Age closing and the next (issue #65) | `core/src/chapter.ts` → `chapterOf`/`openingOf` | `chapter.test.ts` |
| What a **client** can do | `core/src/session.ts` (runtime); `session-view-types.ts` (type-only contracts, re-exported by the session) | `session-api.test.ts`, `session.slow.test.ts`, `view.test.ts`, `save.test.ts`, `replay.test.ts` |
| The **client's only simulation door** | `packages/client/src/lib/game.ts` | `packages/client/src/lib/verbs.test.ts`, `packages/client/src/lib/run.slow.test.ts` |
| Host I/O — saves, import/export, pause/back | `packages/client/src/platform.ts` + `packages/shell/src/preload.cjs` + `packages/mobile/src/platform-bridge.ts` | `packages/client/src/platform.test.ts`, `packages/shell/src/saves.test.ts` |
| What the **player** sees and clicks | `packages/client/src/` | `packages/client/src/lib/verbs.test.ts`, `packages/client/src/lib/run.slow.test.ts` |
| The **Windows host / installer** | `packages/shell/` | `npm run smoke --workspace @ed/shell`, packaged smoke on release tags |
| The **mobile host** (Android and iOS) | `packages/mobile/` — one bridge for both, `packages/mobile/src/platform-bridge.ts` | `packages/client/src/platform.test.ts`, `packages/mobile/src/ios-project.test.ts`, Android tag build and iOS simulator runtime smoke |
| **Land** — parcels, and income as the sum of what is held | `core/src/land.ts` | `land.test.ts`, `land.slow.test.ts`, `gate:land` |
| **The Muster** — the levy, and what a war costs | `core/src/muster.ts` | `muster.test.ts`, `muster.slow.test.ts`, `gate:war` |
| **The papers** — lineage documents as the real dowry | `core/src/people/papers.ts` | `papers.test.ts` |
| Rival-house **descent** | `core/src/people/rivals.ts` | `rivals.test.ts` |
| Authored recurring-role **dismissal and recasting** | `core/src/events/effects.ts` → `recast`; `people/succession.ts` → `maintainCast` | `effect-verbs.test.ts`, `rules.test.ts` (`recast/role`) |
| Which outside houses **recur** — a read model over grudges, the Match, lies | `core/src/relationship-threads.ts` | `rivals.test.ts` |
| The **campaign** — Short Line, Long Line or demo (not yet on the normal start screen) | `core/src/campaign.ts` → `CAMPAIGNS` | `campaign.test.ts`, `gate:campaigns` |
| The house's **ambition** | `core/src/ambition.ts` | `ambition.test.ts` |
| What a standing **delegation** answers, and what must still surface | `core/src/delegation.ts` → `mustSurface` | `deciders.test.ts`, `decisions.slow.test.ts` |
| **Advisers** — a person's advice, never the engine's answer | `core/src/advisers.ts` | `advisers.test.ts` |
| What the chronicle **claims** — the record layer, sigil drift | `core/src/record.ts` | `record.test.ts`, `record.slow.test.ts` |
| **Echo repetition** across systems — counting structural frames rather than prose | `core/src/echoes.ts` | `echo-chains.test.ts`, `echo.slow.test.ts` |
| Which page **answers** which — Chronicle backlinks | `core/src/cause.ts` | `packages/client/src/lib/causes.test.ts` |
| **Nested tales** in circulation | `core/src/events/tales.ts` | `tales.test.ts`, `tales.slow.test.ts` |
| The **decision log** and replay | `core/src/replay.ts` | `replay.test.ts`, `replay.slow.test.ts` |
| The **Library of Houses** — what a finished run leaves the next | `core/src/run-library.ts` | `run-library.slow.test.ts` |
| A **gate** — a design claim measured over a batch | `core/src/tools/gates.ts` → `GATES` | `gates.test.ts` |
| **Outcome reach** — cast/check exposure, finite-sample proof and deterministic witnesses | `core/src/events/reach.ts`; `core/src/tools/outcome-reach-verdict.ts`, `outcome-reach-blocking.ts`; `tools/gen-outcome-witnesses.mjs` | `events/reach.test.ts`, `tools/outcome-reach-verdict.test.ts` |
| How a choice **feels** — interaction shapes | `core/src/tools/shapes.ts` | `shapes.test.ts` |
| Test scaffolding | `core/src/testing.ts` | `year.test.ts` |
| The generated reference | `schema/src/reference.ts` + `core/src/tools/gen-docs.ts` | `docs.test.ts` |

---

## Shipped systems, and how they behave

This is implemented-system history, not a work queue. The code is the authority;
current work is in the issue tracker.

- **Mystic practice checks completed learning** (#1796, #1830). `knowsAffinity`
  reads a living, eligible reader's completed `spellsKnown`; `family_knows`
  asks the household for one. Raw affinity and a book on the shelf are not
  completed training. The Death, Terra and Darkness routes have authored book
  and reader supply.
- **Recurring Mystic practice is shipped** (#1866, #1872–#1878). A standing
  duty names a learned practitioner and a real target. `practitionerGap`
  checks availability, and the `mystic` year phase reserves upkeep before
  benefits are read. An intensive duty pauses unfinished study. Civilian,
  field and security readers apply bounded benefits; outside service occupies
  a real person and may leave inherited obligations. Covert operations keep
  preparation, attendance, attribution, custody and return in saved state.
  These mechanisms do not establish profitable books or frequent attacks:
  paired calibration and unresolved limits are in [docs/BALANCE-LOG.md](docs/BALANCE-LOG.md).
- **The founding configuration changes the founding family** (#1867).
  `resolveFounder` keeps name and grammatical gender separate from blood
  father/blood mother; `configureFoundingCast` sets parents before genomes
  are rolled. `GameSession.found` rebuilds the initial world for the signing
  answer. The founder holds the seal in their own right; the charter exemption
  lives in `isRegent`, rather than in a client rule.
- **The ladder explains its next blocker** (#1806). `ascensionBlockersFor`
  supplies concurrent failures for diagnostics from the actual predicates.
  `SessionView.ascension` carries the ordered rungs, the next unmet predicate
  and, when power is first, public family
  and Match evidence. Client components do not infer hidden genomes or odds.
- **Recurring rivals can leave their role** (#1812). Authored `recast` effects
  free the cast role, and `maintainCast` can refill it. `recast/role` limits
  content to recurring roles the engine knows how to replace; dismissing a
  role is not killing its former occupant or rewriting an arc's kept cast.
- **Pacing observers distinguish Regency from an unwoken house** (#1814).
  The density report counts actual decisions, exact maintenance repetition and
  gaps in strategic progress separately for each period and campaign. It reads
  private diagnostic copies, consumes no simulation draws, and sets no new
  density gate. `docs/REGENCY-PACING.md` records a dated cohort.
- **The Table can call a forcing rite** (#1817). Any otherwise eligible
  unwoken boy in its age window may be offered the rite without exposing his
  hidden font. Ambient and called outcomes set the same `forcingTried` mark.
  `onlyIf` filters weighted outcomes using the actual cast, and the coverage
  rules require a total draw; check bands select outcomes directly instead.
- **Emergency manifestations are local, unsolicited replacements** (#1868).
  `assessHarm` excludes specific agreed prices; `resolvePresence` finds who is
  at the authored scene. Present awakened male expressers each roll at
  `min(EP / 100, 0.9)` in seeded shuffled order. The first success substitutes
  one complete response before the single outcome commit and leaves a saved
  private receipt. This event adapter does not cover annual mortality, ordinary
  upkeep or military attrition, and offers no player manifestation order.

- **The record is read back** (concept §6 and §29.3's third bite, [#45](https://github.com/EldritchDynasty/EldritchDynasty/issues/45)). On the last night the creditor tests what the book CLAIMS against what the rest of the book can support: standing Discrepancies, weighted by severity at the auction's own 1 : 2 : 4, discount the attested rung, and `selectEnding` reads `Reckoning.substantiated` rather than `attested`. Proven lies are excluded (§6 bills those the year they are caught) and buried ones too (burying is the act that answers the bill — §29.4 rule 5). Derived from `world.discrepancies` and the chronicle, so no new world field and no `SAVE_FORMAT` bump. A reading that withholds a rung writes its own chronicle page naming both readings, because a cost the player cannot reconstruct is indistinguishable from bad dice. `standingLies` and `provenLies` had been counted, shown on the ending screen, and read by nothing that decided anything for as long as the endings had existed. See `core/src/ending.ts` and BALANCE-LOG's *"Stage 3's second bite"*.

- **A secret has legs.** `knowsSecrets` and `loyalty` are read — `core/src/people/secrets.ts`, and the `secrets` year phase. Loyalty rises while the house pays its staff and falls while it cannot; when service ends, each secret on the contract is tested against loyalty and against how badly they were let go, and what fails walks out on `world.looseSecrets` with the house that took them on. Years later it is told, and becomes an OPEN DISCREPANCY under its own id, provable by that house — from there the PRESSURE pass, the `discrepancy` condition, the frame's `reads` and the auction's chronicle pages all pick it up with no new vocabulary. `releaseContracts` reads the contract before it clears it, which is the whole trick: read after, a secret is one nobody knows. `secrets/wiring` fails the build if an id is also a content Discrepancy or a knowledge flag. `SAVE_FORMAT` was 6 when this feature landed. `arcs/archive.yaml` still tells the story by hand and is now the illustration rather than the mechanism.
- **Runs survive their hosts.** `packages/client/src/platform.ts` is the generic host seam. The browser uses `localStorage`; Electron injects `window.edPlatform` over filesystem-backed save IPC; Android and iOS implement the same `Platform` contract in `packages/mobile/src/platform-bridge.ts` with Capacitor device services. The start screen can resume and list saves and import/export them; core remains the authority that validates a blob as a `SavedGame`.
- **Barrenness is a recessive** ([#25](https://github.com/EldritchDynasty/EldritchDynasty/issues/25), fertility option D, shipped). `del_hollow_year` is in the `DELETERIOUS` block, harmless carried and near-sterile homozygous, and floors `pairFecundity` — see `people/demography.ts` and `fertility.slow.test.ts`. The agent instructions once listed it as the next piece months after it landed; that stale entry is why current work is tracked by issues.

- **Checks resolve a choice.** `Check`, `PoolSpec` and `Choice.check` are evaluated — `core/src/events/checks.ts`, with `checks/wiring` failing the build when a check's bands name the wrong thing for its role. A `party` decider pools one over the people the player casts.
- **The Library, careers and the auction are built** (concept §§12, 14, 17). `people/library.ts` holds books, study and degradation behind the `spellbook` effect; `people/careers.ts` assigns them, prices them in breeding-pool absence and Madness cover; `auction.ts` announces lots, takes bids in coin or heirloom and resolves them. Each has its own year phase — `library`, `careers`, `auction`.
- **The market can read a line.** A Match card carries a word about the line's fertility, built off the candidate's mother and sisters and only from completed, married childbearing lives — never her genome. `lineSeen` says how many lives that word rests on. See `people/match.ts` and [#28](https://github.com/EldritchDynasty/EldritchDynasty/issues/28).

- **A substory remembers things.** `ArcInstance.localFlags` was declared, saved, initialised to `{}` and read by nothing. The `arc_flag` effect writes it and the `arcFlag` condition reads it back, so a successor can branch on what a beat three nodes upstream decided without that fact becoming a world flag every event in the game can see. Outside an arc both answer FALSE, never true. `arcVisited` asks the same question of the instance's history, and successors gate on `fromChoice` and `fromTag` as well as `fromOutcome` — which stops mattering only if nothing but the player ever takes a branch. See `arcs/flags` and `arc-memory.test.ts`.
- **A two-beat scene needs no arc file.** `Outcome.next` names the follow-up, when it comes due, and which slots it keeps; `schema/src/desugar.ts` compiles the chain into a real `ArcDef` inside `indexContent`, so there is still exactly one thing that runs a tree. It compiles into the INDEX and never the bundle — the authored YAML stays authored, and the editor renders compiled arcs read-only rather than being able to write one to disk.
- **The editor authors all of it.** Effects, slots, filters, checks, branches, outcomes, deciders, arcs and their successors, plus creating new events and substories. The effect/slot/check forms are generated from the Zod schemas (`reference.ts` → `fieldsOfSchema`), so a new `Effect` kind gets a form with no Vue edit. The Instruments tab's **Branch trace** resolves every non-player decider against the six test fixtures through the engine's own `decideBranch`, which is the only way to see what a `state` ladder does without running a century.

- **Cadet branches** (concept §16) are modelled — see AGENTS.md invariant 15 and `people/branches.ts`. A man of the blood leaves the year his brother takes the seal; the family grows sideways to ~70 living across six halls by the term instead of ~20 in one.
- **The suitor draft** is built — `people/match.ts`. Blood of the main hall is dealt three cards, one of them usually a cousin, each with a house, a price and the kinship the documents claim; the rest of the world still pairs through `autoMarry`. A card is a `MintRecipe` rather than a person, so the two declined never enter the world. `wed` is the one marriage path both use.
- **Player choice** is wired — see AGENTS.md invariant 9 and `events/decisions.ts`. Choice events, player-cast slots and the Record block all go on a docket that stops the clock, and `autoResolve` still answers them for the harness.
- **Two hosts, one client.** `packages/shell` loads the built game client in Electron, packages Windows with electron-builder/NSIS, and smoke-tests both source and packaged layouts; release-tag CI requires a signing certificate. `packages/mobile` wraps that same client with Capacitor for Android and iPhone through one bridge. Unsigned Windows/Android beta.3 prereleases and iOS simulator runtime proof are complete; signing, store distribution and physical-device acceptance remain owner-blocked in [issuesneedingowneraction](issuesneedingowneraction). macOS and Linux desktop builds are out of scope. Neither host owns game rules or duplicate UI.
- **Fertility is heritable.** Fecundity is a Core attribute weighted seventy-thirty toward the mother, driving both completed family size and the annual conception chance — see AGENTS.md invariant 10 and [#28](https://github.com/EldritchDynasty/EldritchDynasty/issues/28).
- **The Ledger pays out by campaign.** Short, Long and demo profiles hold
  three, nine and one clauses respectively. Clause-bearing Ages can reveal a
  clause through paid archival service; a post-Unmaking Demigod also permits
  the deliberate late search described in brief §18. Recovery rates belong to
  dated measurements in `docs/BALANCE-LOG.md`, not a universal run guarantee.
- **Hostility is an edge.** Grudges are recorded, inherited down the generations by their own policy, and decay. Content can gate on `grudgeAgainstUs`.
- **Standing decays.** A quiet forty-five years costs a tier, visible Madness costs tiers faster, and decay floors at Known — Unknown has to be done to you.
- **A run is a value.** `saveGame` produces a versioned snapshot and `loadGame`
  validates and rebuilds it. Derived state — the phenotype cache, the house
  table, the content — is rebuilt rather than stored. Pending story decisions
  reconnect to the world's restored arc instance, so answering them advances
  that story once. `save.test.ts` and `replay.test.ts` cover continuation.
- **The client has a surface.** `core/src/session.ts` owns every gameplay verb and runtime reader a client needs. Its view contracts live in the type-only `session-view-types.ts` sibling and keep their existing public session exports. `packages/client/src/lib/game.ts` is the Vue client's only door into the session, and components never reach through to `.ctx`. `view()` and the other reads return plain values, so the UI takes a fresh snapshot after a verb rather than holding live simulation references.
- **The front door is real.** `Start.vue` offers the 300-year Short Line by default and the 500-year Long Line beside it, resumes the last sitting, lists/imports/exports saves, shows the Library of completed houses, and keeps the deterministic seed behind an Advanced disclosure rather than making it the product.
- **A run has a decision log.** `commitOutcome`, `applyRecord` and `renameChild` append a `LoggedDecision` beside the save; `replay()` reconstructs a run from it and throws if the rebuild disagrees with its own record, rather than trusting a log nothing checks. See [#8](https://github.com/EldritchDynasty/EldritchDynasty/issues/8).
- **Discrepancies are readable.** A `discrepancy` condition (existence or exact state) and an `openDiscrepancies` count feed the PRESSURE selection pass; proving one costs Respect a full tier. `discrepancy/wiring` fails the build if a proved or buried id was never created, or `provableBy` names a house that does not exist. See [#9](https://github.com/EldritchDynasty/EldritchDynasty/issues/9).
- **The frame fires.** `tier: frame` has its own `YEAR_PHASES` entry, its own RNG stream, and its own ledger (`world.frame`) — it never touches the ambient Frequency ledger, so a frame firing never steals an ambient event's ration. It is gated by `reads` — a named Discrepancy's state read straight off `world.discrepancies`, how much of the record there is, or a page one named event left in `world.chronicle` (`chronicled`, which holds for a dated blank too, because an omitted page is a page) — rather than `conditions`, casts only `listener_blood` (the sitting Head) and `listener_record` (the guardian — which is also why it cannot fire before the Narrator crosses over), and carries no effects, Record block or rumour by construction (`frame/shape` fails the build otherwise). Twelve to eighteen interludes across a run is the design target; `arcs.slow.test.ts` asserts the batch average lands there. See [#13](https://github.com/EldritchDynasty/EldritchDynasty/issues/13).
- **No nested tale is neutral.** `TaleDefS` and a `tales` collection exist and every tale names a `teller` and a `bias` — there is no way to author one that speaks in the game's own voice. `refs/known` fails the build if an event's `accounts` or a tale's `about` names something that does not exist; `tales/accounts` (CI gate 8) fails it if two accounts on one event do not contradict on at least one field — differing `bias` is the floor until the record layer's claim vocabulary (issue #19) raises the bar. A tale's circulation state (`world.tales`) is born the year the event it is `about` actually fires, not merely when some other event cites it, and the `generation` phase ticks whether it has started circulating and how many times it has mutated since. It **reaches a client** on `SessionView.tales` — only what is actually circulating, carrying `teller`, `bias`, `form`, `text` and how far the telling has drifted. `accuracy` is deliberately NOT on the view: it is the authored answer to how much of an account is true, and a client handed it could sort two contradicting accounts by truth, which is the one reading this layer exists to refuse. For its first life the layer circulated correctly, saved faithfully and surfaced nowhere, which no unit test and no digest could see — `tales.slow.test.ts` is the instrument that would have. `SAVE_FORMAT` was 5 when this feature landed. See [#14](https://github.com/EldritchDynasty/EldritchDynasty/issues/14).

---

## The year

`stepYear` is a clock; the year itself is a table in `core/src/year/phases.ts`.
Each phase declares what it must run **after** and why, and `year.test.ts`
holds the table to its own declarations.

```
ages → mystic → lifecycle → guardian → quarrels → secrets → papers → assize
     → bearing → careers → table → library → muster → land → economy → covert
     → auction → succession → branches → rivals → marriage → births → promises
     → arcs → ambient → frame → ascension → generation → docket
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
[COMMANDS.md](docs/COMMANDS.md#commands)** — one copy, because there were five and three
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
