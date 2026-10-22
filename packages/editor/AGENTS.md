# editor — the authoring tool

Vue 3 + Vite. Imports `@ed/core` directly and never reimplements simulation
logic — that is what makes preview trustworthy.

Seven views over authored content and real simulation/validation; previews use
the engine rather than a second rules implementation.

| View | For |
|---|---|
| **Events** | Everything a template is: slots and their filters, who decides, branches, outcomes, effects, checks, conditions. Frequency picker showing what each tier *obliges*, live voice-contract lint, per-Age coverage |
| **Substories** | Arcs as a graph, ranked by distance from the entry. Beats, schedules, successors and their guards; a beat nothing reaches is drawn in rubric |
| **Characters** | Templates, with a rolled 24-person preview and the gene pool's real carrier rate |
| **Core prose** | Search core message ids, edit Plain English counterparts, validate interpolation/hash parity, review a diff and save `messages.yaml` |
| **Family tree** | Generational SVG with procedural inherited sigils; hot lines mark maternal font transmission |
| **Simulate** | Run to 1542, name the children, watch frequency drive chronicle typography |
| **Instruments** | Test families, branch trace, coverage, fire rate, pronoun preview, clause board, tale pairs |

## Forms are generated, not written

`EffectEditor`, `SlotEditor` and `CheckEditor` draw themselves from field
descriptors walked off the Zod schemas — `reference.ts` → `fieldsOfSchema`,
`effectFields`. There is no hand-kept list of effect kinds anywhere in this
package, and there must not be: a hand-kept copy of a closed union is a copy
that goes stale, which is the failure this codebase has had most often.

Adding an `Effect` kind therefore gives it a form here for free. Adding a
`Condition` or `Filter` kind needs one row in `ConditionBuilder`/`FilterBuilder`'s
`LEAF_SHAPES` table if it fits an existing shape, and a new shape if it does not.

## Two models, and which one to edit

`store.bundle` is the AUTHORED content — what the YAML says, and what a save
writes back. `props.content` is that bundle compiled: `indexContent` turns an
`Outcome.next` chain into a real arc and grafts an `arc` block onto the events
it names, by COPYING them.

**Edit `store.bundle`. Read `props.content`.** Editing `content.events` works
for most events and silently loses the edit for any event a `next` chain
touches, which is the worst possible failure mode — it depends on the content.

## Typecheck the templates

```bash
npm run typecheck:editor    # vue-tsc. Plain tsc cannot see .vue files.
```

Run it. Every silent failure this tool has had was in a template, and it found
three the day it was added.

## Gotchas, all of which cost real time

- **Prefer a handler or `v-model` to template casts.** A past inline tab
  assignment failed silently; casts are not universally unsupported by Vue.
  Compile templates and exercise the action instead of relying on typecheck.
- **`{` in template literals collides with Vue's `{{ }}`.** Build such strings in `<script>`.
- **`triggerRef` is not enough for a long-lived mutable world.** An intermediate
  computed returning `ctx.value.world` yields the same reference every time, so
  Vue short-circuits and every computed *downstream of it* silently stops
  updating while its siblings keep working. Use the explicit `version` counter in
  `SimRunner.vue` — or read through `session.view()`, which returns a value and
  has no such problem.
- **`previewTemplate` must stay side-effect free.** Rolling twenty-four suitors to
  inspect a recipe must not add twenty-four people to the world, and must not
  advance the id counters — conception seeds derive from parent ids, so a preview
  that does will rename every child born afterwards.

## Writing content back

`lib/content.ts` has one API over two transports: a Vite middleware in dev, IPC
to the Electron main process in the shell. Nothing above that function knows or
cares which it is running in.

In the shell's **Mod Editor** mode, shipped YAML remains loaded so authored user
content can reference it, but shipped source files are reference-only. User YAML
is hydrated from `<userData>/mods/content` before `store.ts` is imported, and
only those hydrated paths may be written or offered as new-item destinations.
Do not weaken that into a shadow-copy write: editing a shipped event must never
create a same-named file in the user-content root.
