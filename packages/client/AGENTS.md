# client — the game

Vue 3 + Vite, on port 5174. `npm run play`.

The editor is a tool for making the game; this is the game. They share schemas,
core and visual conventions, while their application state stays separate.

## The one rule

**Everything comes through `GameSession`, and every call to it is in
`src/lib/game.ts`.**

`session.ctx` is reachable — the editor needs it for previews — which makes it
the shortcut this package will reach for the first time the read model is
missing something. It is not a shortcut. It is live simulation state that
changes under the render, which is what the editor's `version` counter exists
to work around, and reading it means this is no longer written against the
seam.

If the UI needs something it cannot get from `view()`, `table()` or a verb, the
missing thing is a verb on `core/src/session.ts` — go and add it there. Six
things went on the read model while this package was written, every one of them
found by trying to draw it: the header printed `house_gearithy` at the player,
a card printed `max_age` and `the_tutors_aphorisms`, the halls arrived as flat
lists with nothing joining a parent to a child, the record would not say which
attributes it had actually spoken about, the Ages were not on the view at all,
and the table could not offer a post or say who the market may be shown.

A seventh went on it afterwards and is the one to read before drawing anything
else: `view.cast` — three to seven people out of seventy, with the one fact that
is true of each of them and of nobody else (`core/src/cast.ts`, issue #44). The
tree can draw the family; only this can say who the year is about, and the
selected card is held by `App.vue` so the list and the tree cannot disagree
about who is open.

`verbs.test.ts` enforces both halves of that, and neither end of it is a list
anybody maintains:

```
GameSession's methods  →  called in game.ts  →  an action a template calls
```

The first list comes off the prototype, the second off the store. Add a verb to
`session.ts` and this package fails until it is wired all the way to something
clickable — which is the only thing standing between the content's two `party`
deciders and a `send` verb that silently never fires.

The ladder's order, names and next unmet predicate come from `view.ascension`.
Render its diagnosis and public evidence route rather than reproducing power,
reading or rite predicates in a component. The Table likewise supplies forcing
rite offers and refusals; an unwoken boy's hidden font is not UI information.

## The read model is a photograph

`view()` is values only, by contract. Every verb goes through the store, the
store retakes the whole picture, and Vue re-renders because the object is new.
Nothing holds a reference into the world and nothing needs telling what changed.

A component that mutated `view` or `table` would be editing a photograph.

## The record is the headline

The tree draws `member.record` — claimed attributes, claimed traits, claimed
death, and the claimed parents. The person the simulation generated is under
the card, which is the right amount of friction: the family's own documents are
what the family has.

`record.attrs` fills in the real value for any attribute the record has never
spoken about, so a UI never has to fall back — and drawn unfiltered that puts a
woman's Fecundity on her card, which deletes §7's marriage market in one line.
Draw `record.claimed` and nothing else.

## Typecheck the templates, and compile them

```bash
npm run typecheck:client   # vue-tsc. Plain tsc cannot see .vue files.
npx vitest run packages/client
```

`vue-tsc` catches a property that is not on a prop. It does **not** catch a
template that will not parse: an apostrophe inside a bound attribute got
through `npm run typecheck` clean and then served a 500 and a blank page.
`templates.test.ts` runs the real compiler over every `.vue` for that reason.

The editor's gotcha list applies here too — see
[packages/editor/AGENTS.md](../editor/AGENTS.md). One correction from
measurement: a TypeScript cast in a template expression does work in this Vue,
verified in a browser. It is still avoided here, because `v-model` says the
same thing without the question.

## The two ends of the run

`Prologue.vue` is the signing (concept §3) and `Ending.vue` is the last night
(§23), and they are one shape: **the epilogue replays the prologue's triad with
exactly one element changed**. Neither writes that text. Both are authored —
`packages/content/prologue.yaml`, `packages/content/endings.yaml` — and the
substitution is checked by the `ending/ring` rule, because two substitutions is
a rewrite and would not look wrong on the page.

Both screens are in the **Dunsanian** register and both end on a plain line.
The drop is the effect; do not smooth it out. The prologue's thesis gets a
screen to itself for the same reason, which is what `openingSeen` is for — a
line that lands under a family tree does nothing.

The signing collects the founder's name and Examination answers before the
house, heirloom, grudge and optional friends. `GameSession.found()` validates
and rebuilds that start atomically. The founder is still the authored male
signer; the gender/configuration work in #1867 is not shipped.

## Sound

§24's sound bed lives here and the editor imports it: `lib/sound.ts` is the
score and the only code that touches `AudioContext`, `lib/valence.ts` says
which way an outcome went, and `lib/sound-bed.ts` decides when either may be
heard (#1986). Do not add a cue; `sound.ts` states the budget.

- Cues follow verbs that took, through `soundActions` — never a watcher on the
  view, which would chime on a resumed save or a reopened Book. The drone
  follows the screen: the board only, silenced by an interlude or the last
  night, stacked by the running Ages' authored registers.
- Nothing plays before the first gesture, hidden or backgrounded pages go
  quiet, and a failing engine turns into silence. `Sound` never throws into a
  verb.
- On/off and the level are reading preferences (`accessibility.ts`), default
  on, never in `WorldState`, the save or the command log. `sound.test.ts`
  proves a loud and a silent session save the same bytes.
- Sound never carries anything alone: every cue repeats something on screen.

## Share codes

The last night shows the founding as a code, and Start → Advanced begins from
one (#1995). `core/src/share-code.ts` owns the codec and the contract; the
client only shows the code, collects the names it left out and words its
refusals (`lib/share-code.ts`, both modes, ending in `assertNever`).

- Names are out unless the reader ticks the box. A code without them still
  carries the friends' number and sexes, and the recipient types the names.
- A code from another build, content or save format is refused, never begun
  as a lookalike. `game.ts` passes `__ED_BUILD__`'s SHA as the build.
- Beginning goes through `beginFromShareCode`, which is `newGame` + `found`. A
  refusal leaves the current run and its autosave alone. A founded import still
  opens on the signing's thesis screen.
- The Chronicle plate's foot (PNG and SVG) and the Afterimage's last rows carry
  the code **without names, always**: the box on the ending screen governs only
  the text beside it. `lib/book.ts` lays the code out in `PLATE.mono`, wrapped
  by grapheme at the column; `readShareCode` ignores the line breaks a reader
  types back. `tests/e2e/share-image.spec.ts` measures that in real Chromium.
- Copying goes through the optional `Platform.copyText`; a host without one gets
  `copyTextInBrowser` (Clipboard API, then a selected textarea). A copy that did
  not take says so, and the code stays selectable by hand.

## Saves and hosts

The client owns the save UI and talks only to the generic `Platform` seam in
`src/platform.ts`. It must not name Electron, Capacitor, Android, iOS or Windows.
The browser implementation persists named slots in `localStorage`; native hosts
inject the same `window.edPlatform` contract before the client starts.

`Start.vue` lists durable runs and exposes import/export, while `game.ts`
autosaves through that seam. Saves remain opaque here: core validates and resumes
them, and each host only stores or transports the JSON. New device behaviour
belongs in `packages/shell` or `packages/mobile`, not in a second client path.
