# Localisation and saved prose

This document records the storage decision required by issue #276, where every
callback that must repeat exactly is carried, and how the text is inventoried.
It does not choose a launch language, translation vendor, message format, or UI
library.

## Decision: the Chronicle is an artefact

**Persist the rendered words of every saved diegetic artefact. Do not replace
saved Chronicle prose with translation keys plus arguments.**

A future localisation layer may render new text from stable message ids and
typed arguments, but when that text becomes part of the Chronicle, a pending
question, a frame entry, or an inherited Library memory, the save keeps the
rendered wording the player actually encountered.

Changing the reader's language later may translate application chrome and text
that has not yet become a saved artefact. It does **not** rewrite pages already
written by the house.

This is a storage rule, not permission for rules to inspect English. Simulation
and gates must use ids, enums, tags, effects and other structured fields. A
saved string is evidence for the player, never a control signal for the engine.

## Why

### The book must remain the same book

`ChronicleEntryS.text` is already stored as finished text, including
`null` for the designed dated blank. Record choices deliberately distinguish
what happened from what the house wrote. Re-rendering an old entry through a
new translation would change the artefact after the decision that created it.

That matters especially for omissions, embellishments and callbacks. The player
must be able to return to the exact account their house left, not a newly
worded interpretation of it.

### Replay records decisions, not prose reconstruction

`replay()` reconstructs a run from the deterministic simulation and compares
the rebuilt `decisionLog`. The log is the behavioural proof. It does not need
saved prose to become a program for regenerating the book.

Keeping rendered prose therefore does not weaken replay. It keeps two concerns
separate:

- structured decisions reproduce what the simulation did;
- persisted prose preserves what the player was shown and what the house said.

A future localisation layer must preserve that separation. Message ids may be
useful authoring/runtime inputs, but they are not a replacement for the saved
output once a page exists.

### The Library quotes another house's actual record

The Library of Houses stores `LibraryMemory.sourceText` and deliberately
carries a previous run's page into a later one. Its meaning is historical: this
is what that earlier book said.

If an old page were stored only as a translation key and arguments, updating a
translation could silently rewrite a dead house's record. The inherited memory
would cease to be an artefact and become a live view of current localisation
data. That is the opposite of the feature's design.

### Determinism stays structural

The simulation must remain independent of wording. A translated title, label or
sentence must never alter a branch, gate, adviser lens, match, ending or
instrument.

Rendered strings can remain in saves and deterministic fingerprints because
they are outputs. Code that makes a rule by calling `.includes()`,
`.startsWith()`, `.endsWith()` or a regular expression over those outputs is
the bug #276 is removing.

### Save size is not the deciding cost

A Long Line save is already intentionally readable JSON and already stores
Chronicle text, pending decision text and other player-visible artefacts.
Replacing those strings with keys would save some bytes, but would require the
exact historical translation catalogue to reproduce an old book faithfully.

That trades cheap storage for versioned localisation dependencies and a much
harder compatibility contract. The project already accepts a few megabytes of
plain JSON so that saves are inspectable; preserving the words is consistent
with that choice.

## Future localisation contract

When localisation is introduced, use these boundaries:

1. **Authoring/content identity is stable and language-neutral.** Events,
   outcomes, choices, effects, conditions, tales and callbacks keep stable ids.
   Rules read those identities and structured fields.
2. **Rendering may use message ids and typed arguments.** This is an
   implementation detail of producing player-facing text in the currently
   selected language.
3. **Committing an artefact freezes its rendered text.** Once written to the
   Chronicle, frame, docket promise, Library memory, or another persisted
   diegetic record, those words are saved.
4. **Changing language is prospective, not revisionist.** Existing saved pages
   stay as written. New unsaved text may use the newly selected language.
5. **Language metadata is descriptive only.** A future `renderedLocale` or
   equivalent may be stored to label mixed-language artefacts or aid export,
   but simulation must never branch on it.
6. **No translation catalogue is required to load a save.** Loading must not
   need the historical version of the catalogue that rendered an old page.

## Consequences

This decision intentionally allows a resumed book to contain more than one
language if the player changes language during a run. That is preferable to
silently rewriting history or making old saves depend on archived translation
catalogues.

Exports and Library memories remain self-contained. A page can be shown exactly
as saved even if content or translations have since changed.

Localisation work still needs stable identities for repeated callbacks and
every rule currently matching English. Those are separate correctness tasks in
#276; this decision does not preserve any English-matching exception.

## Revisit only if

Reconsider this decision only if the product explicitly decides that the
Chronicle is a live document that should be retranslated retroactively. That
would require, at minimum, versioned message ids and arguments for every saved
artefact, a compatibility policy for removed or changed messages, a treatment
for authored quotations and omissions, and a decision about whether Library
memories quote the historical wording or the current translation.

Until such a product decision exists, **saved words are history**.

## Callback identity: where a phrase must come back

Some words in this game are meant to be recognised when they return — the
ending's ring against the prologue, a clause read back, an old act named again
a generation later. A translation (or a rewording) must not be able to break
that recognition, so each callback has to be carried by an **identity**, never
by two strings happening to match. Surveyed 2026-09-28 against `main`:

| Callback | What repeats | Carried by | Status |
|---|---|---|---|
| The ring (`ending.ts`, rule `ending/ring`) | the prologue's triad, restated in every ending with one element replaced | `EndingRing.beat` (a 1-based index into `prologue.triad`) plus exactly one replacement field; the other beats are read from the prologue itself | **id** — nothing compares text |
| An Age named late (`year/phases.ts`, `chapter.ts`) | the Age's `opening`, shown when it begins and quoted unchanged on the page that names it | the Age id; both appearances read `AgeDef.opening` | **id** for the quotation. The naming page, like the clause page below, carries no Age id of its own — same gap, same fix |
| A clause revealed (`revealClause`) | the contract's own words, entered in its own hand | `world.clausesRecovered` and `ActiveAge.paid.clause` hold the clause id | **gap** — the chronicle page itself carries only `title` and `text`, so nothing can tell *which* clause a page is without comparing strings. Nothing does today. The fix is a clause id on `ChronicleEntryS`, which is a `SAVE_FORMAT` change and waits for a slice that owns `save.ts` |
| The Ledger's Demigod wait (`ascension.ts`) | a page written once when the book holds too few clauses | the condition is `standing.blocker === 'clauses'` since #270 (the endings gate reads the same field); the page is still deduped by `entry.text?.startsWith(opening)` | **half done** — the dedupe still matches English, and `english.test.ts` lists it as the one known site |
| A bearing act echoed (`bearing.ts`, #211) | the match, claim or parcel an act was about, named again a generation later | the act's `kind` (a closed enum), `year` and `page` id decide *whether* and *when* it echoes | **id** for identity; `about` is a rendered name frozen at the time of the act and interpolated into the echo. Under the storage decision above that is history, not a key — but the echo sentence around it is rendered later, so a book can mix two languages inside one line. Acceptable; noted so nobody is surprised |
| A later page answering an earlier act (`cause.ts`, #269) | a backlink from a page to the act it answers | `ChronicleEntry.cause` = `{ year, page }`; `cause.ts` resolves the page by id | **id** (a blank is found by `text === null`, which is structure, not English) |
| A Library memory (`run-library.ts`) | a previous house's page, quoted into a later run | `sourceHouse` and `sourceYear`; `sourceText` is the quotation itself | **id** — `sourceText` is displayed and never compared |
| A tale cited by an event (`accounts`, `about`) | a nested tale surfacing on a later event | tale ids, validated by `refs/known` | **id** |
| A tale surfaced on a Match card (`people/panel.ts`) | tales that concern the candidate's house | `TaleDef.houses`, validated by `refs/known` | **id** — it searched the tale's text and teller for the house's name until #276 |

The rule for a new callback: if the second appearance has to be *recognised*,
give the first one an id and have the second one read it. A phrase repeated by
hand in two YAML files is a callback nothing can check, and the first
translator to render them differently has broken it without anyone noticing.

## How much there is, and in which voice

`npm run audit:strings` inventories every player-facing string source — content
YAML, sentence literals in `packages/core/src`, and the client's templates,
attributes and scripts — with counts, words and `{SLOT}` interpolations, and
tags each with the register it is written in (`event`, `interlude`, `frame`,
`prologue`, `ledger`, `tale`, `age`, `adviser`, `chronicler`, `interface`).
`-- --files` adds the per-file table. It is an inventory, never a gate, and it
chooses no language.

The voice comes from where a string lives, per the register split in
AGENTS.md → Skills, except that a `tier: frame` event is an interlude wherever
it is filed. Which content keys count is a closed pair of lists in
`packages/core/src/tools/string-audit.ts`; its test fails when a content key
carries multi-word text and is in neither, so a new prose field cannot join the
game without the inventory being told whether a player reads it.
