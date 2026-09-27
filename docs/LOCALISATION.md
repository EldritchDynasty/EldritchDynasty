# Localisation and saved prose

This document records the storage decision required by issue #276. It does not
choose a launch language, translation vendor, message format, or UI library.

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
