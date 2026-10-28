# AGENTS.md

`CLAUDE.md` imports this file. Read **every touched package guide**, even from
root: Codex automatically loads guides only along the path to its cwd.

**Eldritch Dynasty:** text-based generational strategy; one bloodline,
500-year Long Line or 300-year Short Line.

**Authority:** the [concept brief](DesignConcepts/eldritch-dynasty-concept-brief.md)
governs game rules and wins over the [world bible](Background/eldritch-dynasty-world.md).
Follow the task routes before editing.
For implemented behavior, **the code is the spec**; unbuilt design and open
questions live in the [issue tracker](https://github.com/EldritchDynasty/EldritchDynasty/issues).
Read the issue before building it; shipped issues are history.

**Priority:** safely advance open PRs and already-claimed/started work first;
then actionable `priority: P0`, `priority: P1`, `priority: P2`, then unlabelled
issues in tracker/parent and dependency order. Blocked issues retain priority:
respect the blocker and take the highest-priority actionable work. Claims and
landing constraints apply; unlabelled does not mean P0.

## Branches, and the tracker

- Work on a branch, never `main`. Keep a harness-provided name; locally create
  `codex/<topic>` or `claude/<topic>` before the first edit.
- One issue owns one growing branch and PR. Add slices there until complete;
  make an independently landing slice a child issue before opening another PR.
- Claim before starting: `npm run agents -- take <issue> --paths <what you will write>`.
  A claim ref is the mutex; a shared GitHub identity or assignee is not.
  Denied means take another issue. Claim `lane-content` before content work
  and `lane-gates` before gate/CI work, then the issue; follow
  [docs/PARALLEL.md](docs/PARALLEL.md) for lanes, overlap and stale recovery.
  Connector-only: create the working branch, then send
  `/claim <issue> --agent <branch> --paths <paths>`. If that comment is refused,
  commit the same line as `CLAIM_REQUEST` on `claim-request/<branch>` and read
  the matching `CLAIM_RESULT`; stop if both transports are refused.
- Run `npm run agents -- check` before a long/full run; check overlapping
  paths and intervening landings. Close completed issues from the landing
  commit: `Closes #93, closes #94`, a keyword before **each** number. For
  partial work use `Refs #N` and preflight `--no-issue-check`; never negate a
  closing keyword, which GitHub still interprets.
- Leave merged-branch deletion and claim retirement to `janitor.yml`.
  A session's git proxy refuses ref deletion; do not try it or treat a surviving
  branch as in-flight work. Release a claim only when putting work down.

## Working style

- **Standing authorization: run `npm run land` and keep/open a ready
  same-repository PR without asking.** Preflight fetches/rebases/installs/checks
  that head, ending at `preflight-green`. Never push/directly merge `main`, click
  Merge or post `/land` (retired). `npm run check` omits gates;
  `--full-preflight` selects the complete local CI-derived set.
- `.github/workflows/auto-merge-queue.yml` owns landing: an open, ready `main`
  PR needs green `CI required` on its exact head. Public repositories use the
  native queue with green `merge_group`; private ones fast-forward the tested
  head containing `main`, rebasing behind heads for fresh CI. Early/stale events
  no-op; successful `check` revalidates the head. A factual PR-body edit can
  recover a missed handoff. Admin bypass is emergency-only.
  See [the landing](docs/COMMANDS.md#the-landing).
- Long preflights must outlive the turn: use a harness-tracked background run
  (Claude: `run_in_background`), never `nohup … &`; inspect
  `npm run land -- --status`. Only checks after rebase describe the landing
  base; exact-commit integration CI is authoritative.
- Before ancestry reasoning on a fresh clone, check
  `git rev-parse --is-shallow-repository`; unshallow if true. `tools/orient.mjs` does
  this at session start. Shallow ancestry can answer false without failing.
- Fix the model; check whether a failing expectation or its implementation is
  wrong. Run the harness before claiming balance works; old rates are not current.

## Non-negotiable invariants

Details: [core](packages/core/AGENTS.md#invariant-details),
[schema](packages/schema/AGENTS.md#invariant-details) (5, 16), and
[failures](docs/FAILURES.md#invariant-11-migration--28-october-2026) (11). Enforcement:
`rg -n 'INVARIANT ' packages -g '*.ts'`.

### 1. `canExpress` is the only Madness gate

Only expressing males with a non-null X-linked font receive Madness; ungated
effects are schema errors, never clamped (`canExpress`, `madness/gate`).

### 2. `PersonStore.kill` is the only death gate

All deaths use `kill()`, preserving guardian redirection (`people/store.ts`).

### 3. The Narrator does not die

The founder becomes a permanently castable guardian, never alive again;
`isRegent` alone exempts the founder's charter (`kill`, `people/founding-cast.ts`).

### 4. Two magics, two rules

Eldritch Power is X-linked, family-exclusive and male-expressed; Mystic permits
men eight affinities, women Threshold four, with no Madness link or shared code
(`canLearn`, `eldritch`).

### 5. The verbs are enumerated, never scripted

Effects, conditions, filters, targets, deciders and slot roles are closed unions
whose consumers end in `assertNever`, never permissive defaults (`exhaustive.ts`).

### 6. Derived state is not storage

Life changes persist in `Person.acquired`, never `PhenotypeCache`, and reapply
on recompute (`genetics/expression.ts`).

### 7. Events and people ration separately

Record events in `world.frequency`, minted people in `world.characterFrequency`
(`events/selection.ts`, `people/minting.ts`).

### 8. Determinism is per-world, not per-module

Seed each phase separately and conception by `(runSeed, mother, father, ordinal)`;
ids live on `WorldState.counters`, phase names reseed, and core forbids
`Math.random()` (`rng.ts`, `demography.slow.test.ts`).

### 9. The docket blocks the clock

Player choices/casts and Record blocks stop time with `blocked`; every path uses
`decideBranch` and `commitOutcome` (`events/decisions.ts`).

### 10. Attributes are an open list, and sex is a modifier on them

Derive scales from `ctx.genetics.expected`, keep attributes data-driven and
dimorphism as ±half the male-minus-female points; fixed affinities are a world
rule (`gen-loci.mjs`, `attributes.yaml`; [content details](packages/content/AGENTS.md#attributes)).

### 11. A declared field that nothing reads is a bug, not a stub

Grep fields before assuming they work; prove production handling and execution
(`assertNever`, `gateVocabulary`).

### 12. Nothing takes the seal out of the main house

Hall moves first check `castSlots.includes('head')`, including moves of spouses
and children (`people/branches.ts`).

### 13. The world reacts, and says so

Only `assize.ts` rubber-bands money, standing, loyalty, grievance and mortality,
always naming the actor in the chronicle; never genetics, Madness or outcomes.

### 14. The ladder is measured, never stored as an achievement

Recompute current gates, retain `best`/`reachedAt` history and irreversible
Demigod agelessness, and normalise power from loci (`ascension.ts`).

### 15. A hall is not a house

Use `membership.branch` for hall crowding/economy, one open membership per
person, and recall an incoming cadet Head to the seat (`people/branches.ts`,
`people/succession.ts`).

### 16. Every post is a man's

All three placement paths use `canHoldPost` and content uses `careers/gate`, with
no `CareerDef.sex` or shared Mystic restriction (`career.ts`).

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

## Task routes

Find owners/tests in the [architecture map](ARCHITECTURE.md#where-a-thing-lives).
Follow applicable routes; cross-system changes require surrounding sections.

| Task | Read first |
|---|---|
| Events/characters/arcs | [content](packages/content/AGENTS.md), [vocabulary](docs/VOCABULARY.md); concept §§6/16/18–20/25/29; world §§1–2/25–27 and the scene's place/law/money sections |
| Simulation/rules | [core](packages/core/AGENTS.md); concept §5 plus genetics §§7–11, magic §12, economy §§13–15/17, stories §§16/18–21, ladder/endings §§22–23 or bearing §29; world §§8–19 for institutions |
| Types/saves/vocabulary | [schema](packages/schema/AGENTS.md), architecture “Add a field to the world”; core/save tests; simulation route if behavior changes |
| Client/editor UI | [client](packages/client/AGENTS.md) or [editor](packages/editor/AGENTS.md); concept §§4–6/24; content route for authored words |
| Native hosts | [shell](packages/shell/AGENTS.md) or [mobile](packages/mobile/AGENTS.md); opaque saves, generic platform seam, no rules |
| Tooling/hooks/verification | [commands](docs/COMMANDS.md), [portability](docs/PORTABILITY.md), [claims](docs/PARALLEL.md), [tests](docs/TEST-COVERAGE.md#writing-and-measuring-tests); touched package guides |

World §26 is the content pre-commit checklist; §27 is the canon registry.

## Layout and sources

`schema` defines types once; `core` is pure simulation; `content` is YAML;
`editor` previews core directly; `client` uses `GameSession`; native hosts own
device services, no rules. `SavedGame` is the whole world; `SAVE_FORMAT` is 41.

Living guides describe shipped code. Read relevant entries in append-only
[balance](docs/BALANCE-LOG.md) and [agent](docs/AGENT-LOG.md) logs; dated
evidence stays dated. See [failures](docs/FAILURES.md),
[extension recipes](ARCHITECTURE.md) and [other guides](README.md#whats-here).

## Commands

The sole command/cost block, setup and generation commands:
[docs/COMMANDS.md](docs/COMMANDS.md#commands).

## Supported environments

Windows/Linux × Claude Code/Codex are first-class. Use Node `.mjs`,
`tools/portable.mjs`, canonical `.claude/` hooks/skills, shared Codex hook
registrations and thin `.agents/skills/` launchers. Test/guard both platforms;
platform branches take an argument. Root + each guide must fit the default
32 KiB. Details: [docs/PORTABILITY.md](docs/PORTABILITY.md).

## Tests and evidence

Build mechanism states; never pin a test to one lucky seed. Campaign batches,
including those hidden behind tools, belong in declared `*.slow.test.ts` lanes.
Use `expectRate`/`expectMean` for batch claims and `expectHealthyWorld` through runs.
Measure fire/outcome reach when arcs, slots or selection change.
See [docs/TEST-COVERAGE.md](docs/TEST-COVERAGE.md#writing-and-measuring-tests).
Automated reach, replay and mechanism tests cannot establish human attachment,
comprehension or enjoyment; the waived studies in `docs/PLAYTEST.md` were unrun.

## Skills

Use `eldritch-story` before content: architecture, escalation, Ages' debts,
cast, antagonists, endings, two-class Ledger. `rothfuss-prose` owns plain event,
outcome, chronicle and character sentences; `lovecraftian-prose` owns ornate
frame/myth prose. Never bleed registers. `frontend-design` sets new UI direction;
`interface-design` owns craft, hierarchy, states and consistency, never game rules.
