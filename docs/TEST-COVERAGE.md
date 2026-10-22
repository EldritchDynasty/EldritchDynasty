# TEST COVERAGE

**Historical survey: August–September 2026.** Reviewed for provenance against
`main` at `098bfe02` on 22 October 2026. The percentages, suite counts and
"open" surfaces below describe those survey dates, not today's coverage.
`jsdom` and `@vue/test-utils` are now installed and Vue/host tests exist; use
the current test files and `tools/ci-evidence.json` for the enforced contracts.
No new coverage run was made for this documentation audit. Current command
measurements belong in [AGENTS.md](../AGENTS.md#commands).

Measured 2026-08-20 with `@vitest/coverage-v8` over the full suite, plus two
probes for the things a coverage tool cannot express: which authored *outcomes*
a run can actually reach, and which of the condition and effect vocabularies
have ever been evaluated.

Everything the survey found has been fixed. This file is kept as the record of
what was blind and what the fixes were, and as the method for asking the
question again.

The house thesis is that **this codebase fails by doing nothing**
([FAILURES.md](FAILURES.md)). Line coverage is a poor instrument for that: a
statement executes just as happily when it is wrong. What made the survey worth
running was the other half — what is never reached at all — because in a
codebase that fails silently, an unreached branch and a broken one look
identical from the outside.

---

## The numbers

| Package | Before | After |
| --- | --- | --- |
| `schema` | 95.1% | **99.0%** |
| `core` | 86.8% | **91.3%** |
| `content` | 100% | 100% |
| `editor` | 0% | 1.1% (the two node-testable modules) |
| `shell` | 0% | 0% |
| **Engine** (core + schema + content) | 89.3% | **93.6%** |
| **Repo total** | 56.95% | 60.4% |
| Branches / functions | 86.2% / 86.7% | **89.2% / 91.0%** |

45 files and 535 tests became 53 and 692, and 59 and 809 after the passes
below; content drops since have taken it to 77 and 981. The repo total is
still mostly the editor's 4,440 lines of Vue, which need `jsdom` and
`@vue/test-utils` — a real decision, deliberately not taken here.

**What was already good, and was not traded away for a number:** the thirty-two
`*.slow.test.ts` suites that simulate centuries and assert the *shape* of a
healthy run. They are the only instrument that catches a house which quietly
empties.

---

## What the survey found, and what fixing it turned up

Four of the eight findings were dead tests. Three were live bugs that the
tests found on the way through, and one was a whole mechanic that had never
run.

### Bugs the fixes uncovered

**`recast` freed the wrong role.** `effects.ts` filtered the literal string
`'head'` out of `castSlots` whatever slot it was pointed at, contradicting the
comment directly above it. On any non-head slot it freed nothing — so
`maintainCast` never refilled the slot and the effect was a no-op that looked
like it had worked — and if the person standing there happened to hold the
seal, it took the seal off them instead. The role now comes from the template,
threaded through `EvalScope` the way arc memory already was. Three tests in
`effect-verbs.test.ts` fail against the old line.

**The content-write guard had drifted.** The same check was written four times
across two transports. The dev server's PUT half omitted the trailing
separator, so a sibling `packages/content-x/` passed a check the GET half
blocked; the two transports also disagreed about whether non-YAML was
writable. One implementation now, in `packages/content/tools/content-path.mjs`,
written with `path.relative` so the separator bug cannot come back.

**The diff view drew an elision that had not happened.** `collapseContext`
started `lastKept` at `-2`, so the first kept line at index 0 satisfied
`i > lastKept + 1` and emitted a gap — a `⋯` above the first line of every diff
that began at the top of the file. Cosmetic, and exactly the kind of thing 0%
coverage hides.

### The mechanic that had never run

The auction has bought spellbooks since the auction existed and **nothing ever
read one**. `gainSpellbook` was reachable only through a `spellbook` effect no
content authored, so a thousand-year run ended with sixty-odd volumes on the
shelf, degrading, and `Person.spellsKnown` empty in every house that ever
lived — 0 readers across 12 × 1000y. Eleven books carried `studyYears` and the
Scholar carried `studySpeed: 0.7`, both measuring a wait nobody was having;
`effectiveStudyYears` had zero callers.

`spellbook.op: study` is the door in — the same arrival with the years in front
of it, carried by `world.studies` and collected by a new `library` year phase.
The `schedule` effect could not have done it: that schedules an *event*, recast
from scratch when due, and a study belongs to one person for a length of time
only that person's career knows. Content: `the_book_comes_down`. **19 readers
now, across the same 12 runs.**

The same finding's other half — `world.scheduled` is written only by the
`schedule` effect and read only by `forcedCandidates`, whose loop body had
never executed — is covered directly in `study.test.ts`, including
`SCHEDULE_PATIENCE` and the five-year requeue.

### Dead tests, now live

**Gate 8 (outcome-reach), new.** Gate 4 measures how often each of the 48
events fires; the content declares 94 `(event, choice, outcome)` triples and
nothing measured those. Built on `world.decisionLog`, which replay already
recorded. It found what it was written for on its first run:
`the_vessel_rite/take_the_gifted_one` required `VESSEL.mind >= 40`, a number
authored against the 0–100 *range* rather than the population — median 10, p90
16 among the kin the rite can cast. The branch was offered once in 85 firings
and taken never. At 16 it lands in 6% of runs.

Sample size is the whole design. At **30** runs the probe also flagged
`hold_the_gate -> driven_off`, which at 100 runs resolves in 11% — the rarest
thing in the game, not a dead one. It runs at 100, like gate 4.

**Gate 2 was run by nothing** — not CI, not a test — since it was written.
Now in `check.yml` alongside gate 8.

**Every gate is now a function over a bundle** returning a verdict rather than
printing one, because a gate nobody has seen fail is indistinguishable from a
gate that cannot fail. `gates.test.ts` hands each one content it must reject.

**35 of 72 issue-raising sites in `rules.ts` never fired.** Five rules had no
exercised failure path at all — `frame/shape` (8 sites),
`frequency/obligations` (6), `slots/arc-bound`, `event/shape`,
`traits/mystic-restriction`. `frame/shape` was the sharpest: AGENTS.md says a
frame event "carries no effects, Record block or rumour by construction
(`frame/shape` fails the build otherwise)", and nothing had ever demonstrated
that it does. All 71 sites now fire; `rules.ts` is at 100% statements.

**Nine of 25 condition predicates had never been evaluated**, by a test or by
a line of content. `conditions.test.ts` asks every predicate a question it must
answer TRUE and one it must answer FALSE — a predicate stuck on `true` gates
nothing, and content gated on nothing fires in every run forever.

**`rumour` and `recast` effect verbs had never executed**, and neither had the
two `assertNever` fallthroughs, both of which used to `return true`.

**The view API.** One function in five on `GameSession` had never been called:
`declineHand` is a real move nobody had made, and `branchReport`,
`frequencyReport` and `describeDecision` are diagnostics — reached for when
something is already wrong, which is the worst moment to find out they throw.

---

## The methodological note worth keeping

**Line coverage reads high on exactly the code this survey was about.**
`conditions.ts` reported 84.9% statements while a third of its predicates had
never returned an answer, because the evaluator is a chain of single-line
guards:

```ts
if ('familySize' in c) return compare(w.people.household(...).length, ...);
```

v8 marks that covered the moment *any* condition is evaluated — the `in` test
runs every time. Only the multi-line kinds showed as uncovered. Read a
dispatch chain's coverage number as a starting point for questions, never as
an answer.

---

## Asking again

```
npm i --no-save @vitest/coverage-v8@2.1.8
npx vitest run --coverage --coverage.provider=v8 \
  --coverage.include='packages/**/src/**' \
  --coverage.exclude='packages/**/*.test.ts'
```

Coverage tooling is deliberately *not* in `package.json`. It is a probe to run
on purpose when asking this question, for the same reason `digest.ts` is not a
checked-in golden: a coverage threshold in CI gets satisfied rather than read.
The two questions it cannot answer — outcome reach, and vocabulary reach — are
gate 8 and the truth tables, and those *are* wired in.

## The second pass, 2026-08-23

Two things the first survey named and one it could not see.

### The write-back store, and the bug it was hiding

`store.ts` was the largest node-testable module in the repo with no tests at
all, and the first survey named it as the next thing worth doing. Thirty-two
tests now cover it — `packages/editor/src/lib/store.test.ts`, running against
the **real content directory** with only the two transport functions faked, so
nothing writes to disk but everything parses and re-serialises the files the
game ships.

Thirteen of them failed on the first run, all to one cause.

**`doc.setIn(path, plainObject)` stores a raw JS object, not a YAML node.** It
*serialises* correctly — the written file is byte-for-byte what it should be,
which is exactly why this survived — but `doc.getIn([key, i, 'id'])` walks
nodes, and a raw object is not one, so it returns `undefined` from that moment
on. `locate` is built on `getIn`. So an item became invisible to the store the
instant it was first written:

- the **second** save of any event failed with `'…' is not in any loaded file`;
- `createItem` — which appends with `addIn` and then calls `saveItem` — could
  never locate what it had just appended, so **"+ new" never wrote to disk at
  all**.

Both looked like they had worked, because the live model updates either way and
the UI reads the live model. The author sees their new event in the list, and
the file on disk does not have it. `node()` wraps the value in `createNode`
before it goes in; the serialised output is unchanged, byte for byte.

### The field a digest cannot see

`digest` is computed from `saveGame`'s output, so it covers "every field the
format knows about" — its own comment says so, and that is the whole hole. Add
a field to `WorldState` and `createWorld`, forget `SavedGameS` and `saveGame`,
and the field is not in the format, so it is not in the digest, so **every
round-trip test in `save.test.ts` still passes** while the field silently
resets on load. CLAUDE.md names this failure ("it makes the field reset
silently on load, which looks exactly like a subsystem that stopped working two
centuries in") and nothing tested it.

`every field on the world crosses the boundary` compares world and save by
**key** rather than by value, on a world four hundred years old so its optional
fields (`narrator`, `guardianSince`, `headSince`, `respectChanged`) are all
set — and a fourth test pins that sample, so the guard fails loudly rather than
going quietly blind if a future change stops setting one of them. `houses` is
the one declared exception, rebuilt from content on load.

It was verified by adding a `vendetta: Map` to the world and confirming it goes
red naming the field, while every digest test around it stayed green.

## The third pass, 2026-09-06 — effectiveness and cost

The first two passes asked what the suite REACHES. This one asked two
questions it had never asked: what the suite would NOTICE, and what it costs
to ask.

### What was measured first

Nothing here was decided from reading. The whole suite was run and timed
before a line was changed, on a four-core container:

| | |
|---|---|
| Full suite | 1,466s wall · 125 files · 1,741 tests |
| Slow lane | 2,358s CPU across 43 files |
| Fast lane | 149s CPU across 82 files — **84s wall** |
| Lane floor (longest slow file) | `record.slow.test.ts` — **451s** |

Three documented numbers were two to three times out and nothing reported it:
the fast lane was quoted at 26s, `npm run check` at ~9 min against a measured
25, and the lane floor was named as two files that had not been the floor for
months. Timing comments are perishable and the repository had no instrument
that noticed.

### The fast lane was 84 seconds and the rule could not see why

`gates.test.ts` cost 61.1s — 41% of the whole lane — and contains no
`newGame`, no `advance` and no `runYears`. `lanes.test.ts` reads a suite's own
text, and there was nothing in the text to read: the runs happen inside the
gate functions it calls.

Two things were actually slow, and neither was a test. **Gate 2 called
`fam.build()` inside its loop over every event** — six worlds bootstrapped per
event, four hundred events, to answer a question that consults each household
read-only. **Gate 9 re-played its whole batch for every set of floors it was
asked to judge**, and `gates.test.ts` asks five times.

`gates.test.ts` 61.1s → 16s; the lane 84s → 55s. `lanes.test.ts` now also
enforces that driving a batch through a `tools/` module is DECLARED — the
second way into the wrong lane, which the text-level rule cannot see.

### Nothing asked whether the world was still a world

Forty-three suites played millennia and each checked its own subsystem.
Between them they owned no answer to "are these people internally
consistent", because it belonged to none of them — and `FAILURES.md` is
largely a list of times that gap shipped.

`worldViolations` / `expectHealthyWorld` (`core/src/testing.ts`) are those
predicates: one open membership record, no widow married to a corpse, the
seal in the main house among the living, the narrator never a corpse, the
ladder remembering its best. Free at the tail of a run that already happened.

**What is in it was decided by measurement.** The first cut asserted that the
dead hold no offices and fired on 150 healthy people per six runs — `kill()`
leaves cast markers on the dead on purpose and `cast.ts` reads roles off
`living()`. A checker that fails on healthy runs gets muted, and a muted
checker is worse than none because it looks like coverage.

**It found a live bug on its first outing.** `kill()`'s guardian branch — the
redirect that makes Daveed a guardian spirit rather than a corpse — closes
only HIS half of the marriage. The ordinary death path eight lines below it
closes both, under a comment explaining that a widow who stays married forever
never remarries and never bears again.

It is invisible at the end of a run: 24 played millennia showed zero open vows
to the guardian, because something downstream closes her side within a
century. Sampling every fifty years finds it at 2 checkpoints of 160, first in
1092. **That is the argument for sampling THROUGH a run rather than at 2042**,
and it paid for itself immediately.

The fix is pinned rather than applied: closing her side at his death moves
`npm run digest` on 3 of 4 seeds, so it is a balance change wanting the
harness and a BALANCE-LOG entry. The pin fails if the count grows AND if it
goes to zero.

### Invariant 11 had no enforcement point

"A declared field that nothing reads is a bug, not a stub" was the only
invariant of the fifteen with nowhere to point — `grep -rn "INVARIANT 11"`
returned nothing. The compiler enforces half of it and cannot see the other
half: `assertNever` makes every Effect kind HANDLED, and nothing asks whether
any content authors one.

**Gate 10** asks three questions — declared (off the Zod schema via
`vocabulary()`), authored, and reached in a played run — and plays nothing,
because every resolution it needs is in the batch gates 4 and 8 already share.

On the shipped game: **24 Effect kinds, 22 authored, all 22 reached across 250
runs.** The two it names are `recast` and `schedule`: declared, handled,
unit-tested, and executed by no run in the game's history. `recast` is the
verb that shipped with a bug freeing the wrong role, for exactly this reason.

### Two gates existed and CI ran neither

`gateEndings` (#42) and `gateBearing` (#45) both return `{ ok, lines }` and
neither was in `GATES`, so `npm run gate` never called them. That is gate 2's
history repeating, under a comment in the same file reading "a gate outside
this table is a gate CI does not run".

`endings` PASSES and is registered; its output carries #61 in plain sight
(`apotheosis 0.0%`) on every push. `gateBearing` FAILS the shipped game — §29
rule 2 — which is #45 still being open, and is under-powered at its default
besides. It stays out on purpose and in writing.

### A quarter of the batch claims carried their margin

CLAUDE.md has required `expectRate`/`expectMean` since those helpers existed.
Measured: **11 call sites in 4 suites obeyed, 34 claims across 17 did not.**

Half the unguarded ones were CEILINGS, and there was no ceiling guard at all —
so the guard was missing from precisely the assertions nobody had checked.
`expectRateBelow` and `expectMeanBelow` are the same statistics with the sign
flipped.

Twenty-two are converted and all still hold, with a margin now.

**And the ceiling guard was written twice before it was written once.** A
`expectRateBelow`/`expectMeanBelow` pair was added here, and `main` had
already grown the same capability as a `ceiling` option ON `expectMean` — a
second implementation of an existing thing, which is the one rule this
repository states flatly. Both duplicates are gone; `expectRate` now takes a
`ceiling` in exactly `expectMean`'s idiom, and a test asserts that a ceiling
claim and its complementary floor claim report the SAME margin, because a
mirror that gives a different answer is a guard that is quietly more
permissive in one direction.
`margins.test.ts` is the ratchet: a debt register that fails when the count
GROWS and when it SHRINKS, so converting one forces the number down. It earned
its keep before it landed — merging `main` brought a commit that converted two
claims, and the register refused the looser bound it was still recording.

The twelve that remain are ones the four guards cannot express: seven are
`Math.abs(mean(a) - mean(b)) < x`, a difference of two means whose standard
error combines both samples, and two are a regression slope. A threshold that
is honestly bare beats a guarded one that lies about which statistic it
measured. A two-sample helper is the next step.

### The suite replayed 110,000 years to make two assertions

`record.slow.test.ts` plays 240 runs of 458 years for two assertions, and
neither batch is negotiable — drift lands in about 12% of seeds. At 451
seconds it was the floor the whole lane waited behind.

So the years stay and the replaying goes. `corpus.ts` reads a played run back
through `saveGame`/`loadGame` instead of replaying it: **121ms against
2,207ms**, 97KB gzipped per run. `record.slow.test.ts` 451s → 23s.

It is a cache of a pure function, not a golden file: `(content, code, seed,
years)` fully determines a run, so the key is a hash of all four and a stale
entry is unreachable. Hashing content alone would have been the trap — the
corpus would stay authoritative across a change to `sim.ts`.

**And it pays a correctness dividend.** `corpus.slow.test.ts` compares a
remembered run against a freshly played one FIELD BY FIELD — two worlds, not
two saves. That is the guard `digest` structurally cannot be, because digest
is computed from `saveGame`'s output and so cannot see a field the format
never knew about. CLAUDE.md names that failure; nothing had measured it over a
played millennium.

### The mutation probe, and the first thing it found

`npm run mutate` breaks the code on purpose — one small, plausible edit at a
time — and runs the fast lane. A mutant the suite kills is a line somebody is
really checking; a mutant that SURVIVES is a line you can break without any
test complaining. In a codebase that fails by doing nothing, that is the whole
list of places a silent failure could live.

It is a probe, not a gate: not in `npm run check`, no threshold anywhere, for
the reason this document already gives about coverage. A mutation score in CI
is worse than a coverage one, because the cheapest way to raise it is to pin
behaviour nobody cares about.

**It refuses to run against a red lane.** A mutant is "killed" when the lane
goes red, so a lane that is already red kills everything and reports a perfect
score. That is not hypothetical — the first real run of this probe was
invalidated exactly that way, by a component suite that landed in the lane
mid-run with a broken fixture. Forty minutes of runner time for a clean bill
of health that was an artefact of the instrument.

**The first survivor it found was the sex filter.**

```
packages/core/src/events/conditions.ts:153   p.sex === f.sex   ->   !==
```

One character, and the entire fast lane — 1,653 tests — had nothing to say
about it. A filter that selects the opposite sex casts daughters into every
role written for a son.

The gap behind it is structural and is the same one the first survey found for
conditions, one union over. Conditions gate whether an event FIRES and
`conditions.test.ts` asks all 25 of them a question they must answer true and
one they must answer false. Filters gate WHO it can be cast on — `sex`, `age`,
`status`, `membership`, `career`, `trait`, and the `all`/`any`/`not`
combinators — and nobody had ever done it for them. A filter stuck on `true`
does not stop the event; it casts the wrong person into it.

`filters.test.ts` is that truth table. Re-running the probe over the same two
mutants afterwards: **1 survivor becomes 0.**

## Still open at the survey date

- **The editor's 4,440 lines of Vue.** Needs `jsdom` and `@vue/test-utils`.
  With `store.ts` covered, this is the remaining untested surface — and it is a
  real decision, still deliberately not taken.
- **`shell/src/main.mjs`.** Electron main process; its one piece of real logic,
  the path guard, is now shared and tested.

## Found, and then finished

Both of the things the second pass recorded as open were design calls rather
than defects, so they were reported rather than patched quietly. Both are now
settled.

### `TraitDef.conflictsWith` — removed

It arrived with the initial commit, was never referenced again, appears in no
design document, and the generated `docs/VOCABULARY.md` does not even surface
it. No content declares it; nothing in `core` reads it.

Implementing it would have been the worse of the two options. There is no pair
of traits in the game that conflicts — the one real stacking hazard the repo
has hit (`competent_physician` and `keeps_the_sickroom` both damping the
Plague, noted in `traits.yaml`) involves two traits the physician's template
deliberately carries **together**, and it was correctly fixed by tuning the
modifiers. Building a gate whose refusal branch no run would ever take trades
one invariant-11 violation for another, and this repo is named after the
second kind.

So the field is gone. If trait conflict is ever wanted, it is a line in the
schema and a single grant gate — `p.traits.add` currently has four production
call sites (`people/careers.ts`, `people/minting.ts`, `events/effects.ts`,
`sim.ts`), so the gate is the real work, not the field.

### Nested tales — now on the view

`world.tales` was born, circulated, mutated and saved, and `SessionView`
carried no field for any of it, so `teller` and `bias` — "required, not
optional colour" per `schema/src/tale.ts` — reached nobody. `chronicle`, `frame`
and `looseSecrets` all surfaced; this did not.

`SessionView.tales` now carries what is actually circulating: `teller`,
`bias`, `form`, `text`, `about`, the year it began and how far the telling has
drifted. Two things are deliberately absent:

- **`accuracy`**, the authored answer to how much of an account is true. The
  game never adjudicates between contradicting accounts in its own voice, and
  a client handed the answer key could sort them by truth. A test asserts the
  view never carries it, and fails if someone adds it back.
- **`claims`**, for a duller reason: they are authored against a slot `Target`
  and mean nothing until resolved against the cast the tale's event fired
  with, which circulation state does not carry. That is real work, not a field
  to copy.

**The instrument that was missing.** Every unit test passed throughout, and so
did the digest, because nothing was broken — the layer worked perfectly and
was invisible. Only "does it reach the player, in a run" catches that, so
`tales.slow.test.ts` now asks it: 18-26 accounts circulating at 2042, all 32
authored tales reached across eight runs, and at least one event showing the
player two accounts that disagree.

One note on method, since it cost a detour: the first measurement of this
returned **zero tales in every run**, which looked like the layer was dead
rather than merely unseen. The probe had passed `autoResolve: true` to
`newGame`, which takes `decider: 'ask' | 'chronicler'` — the unknown key was
ignored, the default parked the run on the first decision, and `advance(1000)`
turned about four years. A measurement harness is code, and a startling number
is a reason to check the harness before the game.
