# content — the authored game

YAML, and a loader whose only job is to hand files over as text. What a bundle
*is* lives in `schema/src/assemble.ts` → `CONTENT_LAYOUT`, which both this
loader and the editor's read. Do not restate it here.

```
attributes.yaml traits.yaml houses.yaml heirlooms.yaml clauses.yaml
prologue.yaml     the signing (§3), and the two choices it collects
endings.yaml      the five (§23), each ringing the prologue's triad
loci.yaml         GENERATED. Edit tools/gen-loci.mjs and `npm run gen:loci`.
ages/  events/  arcs/  characters/      split across as many files as you like
```

## Before writing anything

Read **[docs/VOCABULARY.md](../../docs/VOCABULARY.md)** — every effect, condition,
filter, slot role, purpose and frequency obligation, generated from the schemas.
You should not need to open a `.ts` file to author content.

Read **[Background/eldritch-dynasty-world.md](../../Background/eldritch-dynasty-world.md)** for
the world the content is set in — places, distances, coin, law, the Church, the technology line,
and how a name is built. Nothing validates it, so an event set nowhere passes CI. Its §23 is the
checklist to run before you commit one; §24 is what is already fixed and may not be contradicted.

```bash
npm run validate     # 32 rules; exits non-zero on any error
```

**Campaign shape (#274):** endings/conditions → `npm run gate:campaigns`; paste before/after.

## Events

- **Exactly three distinct purposes**, from the closed vocabulary.
- **Frequency is a rationing tier, not a weight.** It decides caps, cooldowns,
  whether a Record block is required, whether the world remembers, and how the
  chronicle renders it. Tune the profile and measure in the harness; never tune
  by nudging a per-template `weight`.
- **The cooldown is GLOBAL to the tier, and this is the single most important
  scheduling fact for anybody adding content in bulk.** `frequencyWeight`
  returns zero for a whole tier for `cooldownYears` after any template of that
  tier fires. Uncommon is 12 years, so a 500-year Long Line has room for about
  42 uncommon fires in total (about 25 in a 300-year Short Line), *shared by
  every uncommon template in the game* — and each one you add divides that
  pool again. Common has no cooldown at all.
  So: a new scene that is ordinary texture belongs at `common`, and `uncommon`
  is a place you spend rather than a synonym for "not that often". A drop of a
  dozen uncommon templates measurably starved four existing ones here, and the
  first three attempts to fix it by weight did nothing, because weight cannot
  buy a share of a ration that is already spent.
- **A TIER'S POOL IS NOT `frequency: rare`. Count it before you reason about
  it.** Of the 44 templates carrying `rare` before the rare drop, 25 were
  `tier: frame` (rationed off `world.frame`, not the frequency ledger) and 10
  were arc nodes (excluded from the ambient pool by construction — see
  `recordTemplateFire`). The AMBIENT rare pool was NINE templates sharing 7.25
  firings a run, and every raise of the rare weight from 40 to 320 was buying
  share for those nine. Fifty new rare templates took that pool to 59 and the
  weight stopped mattering within ten per cent — a pool that big wins the draw
  whenever it is eligible, and eligibility is the cooldown. Measure the pool
  you are actually joining.
- **A template rationed by its CONDITION or its CAST cannot share a flat weight
  with templates that have neither.** `the_drowning` needs an unwoken,
  expressing male aged 7-15 — the narrowest cast in the content — and went from
  13 runs in 60 to TWO when the ambient rare pool grew, taking three frame
  interludes that read its Embellish lie to zero with it. Same shape on
  `the_cart_from_the_chapter_house`, which only fires while the Assize reads
  the house at -0.25 or worse, and which went to zero in the same batch. Both
  are fixed by per-template weight and that is NOT the thing the manual warns
  against: tier share is tuned in the profile, and a narrow cast is tuned here,
  and `the_drowning_repeated` has carried that argument in writing since it was
  authored.
- **And adding COMMON templates rations the other tiers, which is the same fact
  from the outside.** A tier's share of the yearly draw is its weight times how
  many templates carry it times their own weights, over the same product across
  every other tier. Twenty-eight new commons cut uncommon from 93.1 firings a
  run to 75.0 and rare from 24.0 to 14.1 with no uncommon or rare content
  changing at all, and took one event to zero. The fix is the profile in
  `schema/src/frequency.ts`, measured — never a per-template weight. Give a new
  common a modest weight anyway (these sit at 65-90), and price it against the
  events it displaces: the new commons averaged -4.7 crowns a firing against
  the existing ones' -14.9, and the median treasury in that measurement batch rose by half
  until they were repriced.
- **A quarter of the library has to ASK.** `events/player-share` fails the
  build if fewer than 25% of templates put a question in front of the player
  rather than resolving themselves. Four shapes count: `decidedBy: player`, a
  `party` decider (the player casts the slots — WHO GOES is the decision), any
  `castBy: player` slot, and a Record block. A `state` ladder, a `chance` draw
  and a narration are texture, and texture is the cheap half to write: a
  hundred templates of weather and pantry can be added in an afternoon and a
  run full of them looks exactly like a run full of decisions from the
  outside. The floor sits far under where the content stands (81% at the time
  of writing) because it is for the six-hundredth template, not this one.
- Bodies reference slots as `{SLOT}`. Undefined slots are errors.
- An arc-bound slot with `onMissing: continue_absent` **must** supply `absentBody`
  — otherwise it renders a token for a man forty years in the ground.
- **IDs are `snake_case` and are never renamed after commit.** Save files
  reference them. Slot names are not save-referenced and may be renamed — the
  editor rewrites the body's `{TOKEN}`s with them.
- **Slots fill in DEPENDENCY order**, not the order you wrote them. A
  `relation` filter comparing against a slot nothing has cast yet passes, so
  the engine casts the slots a filter points at first. Two filters pointing at
  each other are a cycle and fail the build: one of them can never narrow
  anything.
- **`decidedBy` says who takes the branch**, and defaults to `player`. Reach for
  `state` when the family's own condition has already decided and there is
  nothing to ask, and for `party` when the player's decision is *who goes* and
  a check over exactly those people decides the rest. A `party` decider needs a
  `castBy: player` slot and a check whose bands name CHOICES, not outcomes.
- **A second beat is `next` on an outcome**, with `keep` naming the slots the
  follow-up casts with the same people. Longer than three beats, write an arc.
- **Every option has to change something that lasts** (`choices/consequence`,
  issue #266). Two options with identical effects and callbacks are an error.
  An option with no effect, or only memory nothing reads, is a warning. That
  includes the passive "leave it", which otherwise teaches the player that
  inaction is free. If changing nothing is the point, tag every one of its
  outcomes `self_expression`. That is legitimate, because its Chronicle page
  still differs, but it has to be said. `npm run audit:choices` prints the
  whole picture.
- **A flag you set must be read somewhere.** Every `flag`, `knowledge`
  (including a Record's `grantsKnowledge`) and `arc_flag` needs a condition
  that reads it: a later event, a successor's `when`, a rite. Otherwise it is
  a warning, and it is invariant 11. The outcome's own Chronicle page already
  remembers the act, so a flag that nothing will ever ask about is a delete,
  not a stub.
- **Any body longer than five sentences is held to the prose contract.** Use the
  `rothfuss-prose` skill. `npm run validate` counts the countable half.

## Characters — two different things

- **`characters/founding.yaml`** — the twelve individuals who exist in 1042.
  Genomes are still *rolled*; `bias` nudges an authored intent without pinning it.
- **`characters/templates.yaml`** — recipes for everyone the next five centuries
  produces: suitors, grooms, rivals, tutors, midwives, wanderers.

A template's most consequential field is `houses`, because it decides whether
that person carries anything, and the player can never see it. Review templates
with the editor's **Roll 24** preview, not by reading the form: a recipe that
reads like deep blood and produces nothing but nulls looks correct on paper.

Nothing spawns people outside `core/src/people/minting.ts`.

## The two ends of the run

`prologue.yaml` and `endings.yaml` are the only files here in the **Dunsanian**
register — `.claude/skills/lovecraftian-prose`, never `rothfuss-prose`. Event
bodies, outcome text and chronicle lines are plain; these two are not, and the
prologue is the single most likely place in the game for register bleed,
because it is the one screen where the mythic layer and the tutorial impulse
meet.

Both close on a plain line, and the drop is the effect. The prologue's `thesis`
is the note the player hears under every scene for the next five centuries, and
every ending's `closing` reaches back to it.

**The ring.** Each ending replays the prologue's triad with exactly ONE element
changed — `ending/ring` fails the build on two, and on none. Change the
prologue's triad and every ending's substitution has to be re-read against it;
nothing else in this directory has that coupling.

**Which ending fires is read off the chronicle, not off the world** (§6): the
highest rung any surviving page attests, plus whether anybody is at the table.
The one ending content can reach directly is *The Unmade* — set the world flag
`god_rite_failed` (`{ kind: flag, flag: god_rite_failed, set: true }`) when the
God rite fails at its last step, which is what #43 is for.

## Adding a collection

One row in `CONTENT_LAYOUT` (`schema/src/assemble.ts`) and one field on
`ContentBundleS`. Both loaders pick it up; `bundle.test.ts` checks that every
declared collection has a place to come from.
