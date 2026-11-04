# Player feature acceptance — 4 November 2026

This receipt covers #1986 (sound), #1991 (contextual glossary), and #1995
(founding share codes). Source inspection began at `15ead118`. Most of the
implementation was already shipped; this change completes missing glossary
surfaces and exercises the existing sound and sharing paths in real Chromium.
It does not replace the outstanding native-host checks.

## Contextual glossary (#1991)

The validated collection in `packages/content/glossary.yaml` already provides
Standing, Discrepancy, Ledger, clause, Regency, cadet hall, Muster, Threshold
affinity, expresser and Vessel, in both reading modes. Its related references
are bounded to three open definitions with no ancestor cycles.

The following missing surfaces now use that collection:

- Navigable factual Passage rows retain their original person button and add
  an adjacent term disclosure. Opening it does not navigate to the person.
- The Standing panel's recovered-clause/Ledger label has the same disclosure
  as its Standing label, with the existing expanded-row layout.
- Table book blurbs, Mystic working descriptions/field terms and Ledger-search
  refusals explain their first matching term. The Vessel action has an adjacent
  explanation available even while the action is disabled.
- Related-term introductions are real DOM text, so assistive readers and the
  pseudo-localisation pass can encounter them.

These join the existing Docket body, Chronicle sentence/evidence and
non-navigable Passage integrations. Action buttons, person links, selects and
their stored text are not rewritten. Interludes and the creditor's spoken
reading remain outside the glossary context.

`tests/e2e/glossary.spec.ts` exercises the shipped client at desktop width and
390px with enlarged text, Original and Plain English, touch activation,
keyboard nesting, the depth cap, Escape focus restoration, and expanded
pseudo-localised DOM text. It compares complete canonical saves before and
after opening and closing disclosures. Component tests also exercise the
adjacent person/action controls without issuing orders or changing input data.

The browser checks validate native button and note semantics and accessible
relationships. No participant or screen-reader listening study was performed;
there is no claim of better comprehension.

## Sound (#1986)

The existing client owns the synthesized score and the editor imports it.
Reading preferences default to sound on and volume 1, but no engine opens
before a user gesture. These preferences are outside the save and command log.

| Existing cue | Committed transition |
| --- | --- |
| page | An advance moved the year |
| bell | That advance stopped on a new Docket question |
| seal | Accepted founding, Match or Record answer |
| boon / blow / plain | Accepted choice outcome, using its existing valence |

The drone follows the board and current Age registers, with silence during
interludes, the last night, hidden/backgrounded pages, mute and zero volume.
The existing fake-engine tests cover these transitions and compare complete
canonical saves for the same session played with sound on and off.

The real Chromium suite verifies gesture startup, persistent mute, hidden and
visible lifecycle transitions and volume changes. The added rapid
pagehide/pageshow case verifies a return before lifecycle promises settle
does not leave the real audio clock suspended or construct a second engine.

**Still required before closing #1986:** sound-enabled packaged Windows and
Android smoke, including preference persistence and background/foreground
behavior. Physical playback, silent-switch behavior and iOS were not tested
in this Linux workspace. Browser source scheduling is not a listening result.

## Founding share codes (#1995)

The existing `ED1` codec carries only the encoded founding setup: edition,
campaign, seed, founder configuration, Examination answers, heirloom, grudge
and friend roster. Demonstration codes are refused. Names are excluded unless
the sender opts in; image exports always use the nameless code. Different
recipient names and their local Library can produce a different world.

The new browser round-trip begins at the actual Ending screen, opts into
named text, refuses both clipboard mechanisms, and checks that the code stays
selectable with an accessible failure receipt. It exports the Afterimage
through the real SVG fallback, reads its actual downloaded bytes, verifies
that the complete nameless code survived, and imports that code through Start
in a separate browser context. With fixed names, edition, prose mode and
Library inputs, the entire canonical save matches the production founding
path. Both reading modes and desktop/390px viewports are covered.

The existing suites separately cover malformed/incompatible input without
autosave replacement, Unicode opt-in names, Chronicle PNG/SVG layout,
Canvas-free export, and codec/save/Library contrasts.

**Still required before closing #1995:** native Windows and mobile round-trip
evidence. A narrow Chromium viewport is not a packaged mobile-host smoke.

## Reproduction

Use the repository's Node 22 toolchain and installed Chromium:

```sh
npx vitest run packages/client/src/components/Passage.test.ts packages/client/src/components/TableAccessibility.test.ts packages/client/src/components/Standing.test.ts packages/client/src/components/glossary-focus.test.ts packages/client/src/lib/glossary.test.ts packages/client/src/lib/sound.test.ts packages/core/src/share-code.test.ts
npx playwright test --project=chromium tests/e2e/glossary.spec.ts tests/e2e/sound.spec.ts tests/e2e/share-code.spec.ts tests/e2e/share-image.spec.ts
```

Local validation uses Node v22.23.4 and Playwright's Chromium
153.0.8010.12 on Linux. The PR records final preflight and exact-head CI results.
