# Founding share-code acceptance matrix (#1995)

**Status: incomplete.** This is a reproducible cross-host closure checklist, **not**
a claim that Android or physical iPhone tests have passed. The implementation is
already present: an `ED1.` code transports the *founding setup*, not the later
game or the sender's Library. This document identifies which existing receipts
can be carried forward, which must be rerun after changes, and the precise
evidence needed to close #1995.

## Compatibility and privacy contract

- The code contains the save format, mechanics/content fingerprint, build
  identifier, campaign, unsigned 32-bit seed, founder gender and blood-parent
  configuration, Examination answers, heirloom, grudge, and friend count/sexes.
  It is bounded by `SHARE_CODE_MAX = 2400` characters. Demonstration codes
  are deliberately unsupported.
- Names the player entered are excluded by default, and **always excluded from
  Chronicle and Afterimage image codes**, even if the player opted into a
  named text code. The receiver supplies excluded house/friend names and an
  excluded founder name when applicable. An explicitly blank founder answer
  remains distinguishable from no answer.
- The same **complete canonical founding save** is promised only for compatible
  format/content/build, identical *substantive* founding choices and names,
  matching Library inputs and matching prose configuration. A different
  recipient Library or different names may lead to a different house. The code
  includes no later choices or post-founding state.
- A refusal must not replace the existing active run or its durable autosave.
  Confirm successful valid retry separately; an error message alone is not
  evidence of state preservation. A successful import must survive **cold
  process termination and restart**, not merely a component remount.
- Compare the canonical saved state with the top-level `savedAt` transport
  timestamp excluded **only when testing persistence across saves**. For the
  founding itself compare the *complete* canonical save using the same inputs,
  as `packages/core/src/share-code.test.ts` does.

Source of truth: [share-code.ts](../packages/core/src/share-code.ts),
[share-code.test.ts](../packages/core/src/share-code.test.ts),
[Start.vue](../packages/client/src/components/Start.vue),
[Book.vue](../packages/client/src/components/Book.vue), and
[Ending.vue](../packages/client/src/components/Ending.vue). See also
[PLAYER-FEATURE-ACCEPTANCE.md](PLAYER-FEATURE-ACCEPTANCE.md).

## Evidence inventory

| Platform or boundary | Existing evidence | What remains |
| --- | --- | --- |
| Pure codec, replay, Library and Unicode | Automated `share-code.test.ts`; named/anonymous and incompatible-code contrasts | Exact-head CI on any changed implementation; not a native-device receipt |
| Chromium web, both prose modes | `tests/e2e/share-code.spec.ts` and `share-image.spec.ts`; [browser acceptance note](PLAYER-FEATURE-ACCEPTANCE.md#founding-share-codes-1995) | Rerun against accepted release build; verify touch and screen-reader usability separately |
| Packaged Windows player | [Merged #2999](https://github.com/EldritchDynasty/EldritchDynasty/pull/2999), tested at `2aa474ee7699f23009d15663008d1058fcc750ec`, 5 Nov 2026, with Unicode founding, damaged/incompatible refusal, cold resume, real clipboard and installer hashes | Preserve receipt or rerun if subsequent changes affect the relevant path; this was an **unsigned** package, not signed-store proof |
| iOS simulator, Debug | [ios-runtime-smoke.mjs](../packages/mobile/scripts/ios-runtime-smoke.mjs) drives real native storage and a `share-code` Start command followed by a separate cold `resume`; [mobile bridge](../packages/mobile/src/platform-bridge.ts) hashes snapshots | Attach a successful run ID, simulator/OS and source SHA; the existence of a script is **not** a passing receipt; add refusal/image/clipboard observations outside the automated hash |
| Android installed host | Android bridge and supported native app exist; no Android host share-code acceptance receipt is recorded here | Run the full device protocol below, attach source/build/artifact, screenshots/log and resulting canonical comparisons |
| Physical iPhone | Native iOS host exists; simulator does not prove physical touch, clipboard, share sheet, background or file behavior | Run the same full protocol on a real iPhone and attach device/OS/build evidence |

Do **not** use a 390px Chromium viewport as an Android/iOS acceptance
substitute. Do **not** interpret a simulator SHA comparison as evidence that the
real clipboard, image share, or accessibility gestures worked. Both prose modes
need their own visible refusal and retry observations.

## Reproduce the current automated boundaries

From a source checkout matching the tested artifact:

```sh
npx vitest run packages/core/src/share-code.test.ts packages/client/src/lib/share-code.test.ts
npx playwright test --project=chromium tests/e2e/share-code.spec.ts tests/e2e/share-image.spec.ts
```

On Windows, follow [the packaged player receipt](WINDOWS-PLAYER-SMOKE.md):

```powershell
npm.cmd run build:shell
node packages/shell/scripts/windows-player-smoke.mjs
```

Capture the source commit, executable/installer/renderer hashes and the
machine-readable ignored output
`packages/shell/release/windows-player-smoke.json`; never commit personal
clipboard content or private names.

For the iOS Debug simulator, use the existing scripted sequence with a
booted simulator and matching built/installed Debug app:

```sh
IOS_SIMULATOR_UDID=<simulator-udid> node packages/mobile/scripts/ios-runtime-smoke.mjs
```

The script's `share-code` command exercises the real client Start/store path;
the next `resume` command compares its canonical durable snapshot hash in a
separate launch. This is deliberately **not** a production deep-link API:
`eldritchdynasty-smoke://` is registered only by the iOS Debug target.

## Installed mobile acceptance protocol

Record a **separate row per device, platform, build, mode and scenario**, using
an isolated profile with no personal information. Use the *actual Start and
Ending screens* and the native file/clipboard/share-sheet surfaces, not a
direct core function call. Keep a baseline valid autosave with an identifiable
seed and campaign before each refusal.

1. **Complete named founding.** On the source, sign a supported Long or
   Short Line with a Unicode house/founder and at least one Unicode friend;
   choose all Examination answers, heirloom and grudge. Export a *named text*
   code at Ending. Import it through Start on a matching build, prose mode and
   fixed Library. Compare the **full canonical founding save** and subsequent
   cold-resumed save; name both source and receiver revisions.
2. **Anonymous image founding.** Export both Chronicle PNG/SVG routes and
   Afterimage PNG/SVG routes (force fallback where the host permits). Confirm
   a complete, legible code, no typed names in the code, line wrapping within
   the image, an accessible/selectable text equivalent, and successful
   transcription/import via Start. Supply identical excluded names and fixed
   Library for the canonical comparison. Record which export formats the
   platform actually supports; an unsupported path is a failed/incomplete row,
   not a silent pass.
3. **Refusal without loss.** Against a pre-existing valid saved run, attempt
   truncated/miscopied, overlong, wrong format/build/content, and unsupported
   Demonstration codes. For each: capture the *visible* reason in Original and
   Plain English, compare the existing durable save before and after a cold
   restart, and then import a valid code deliberately. A refused import must
   never silently overwrite or clear the earlier run.
4. **Clipboard and handoff.** Exercise successful Copy and denied/unavailable
   clipboard APIs, including cancelled/failed native share. Verify the entire
   code remains visible and selectable using touch, keyboard and a screen
   reader when Copy fails. Confirm no network transfer or telemetry is
   required. A browser-copy fixture does not prove the native host result.
5. **Contrasts.** Repeat an anonymous code with changed receiver names and
   with different local Library inputs. Document the differences without
   asserting canonical equality or leaking the source's personal names.
   Confirm that the imported code itself still contains no post-founding data.

### Retained evidence format

Each row must record:

| Field | Required evidence |
| --- | --- |
| Scope | Android / iOS simulator / physical iOS / packaged Windows / Chromium; device and OS |
| Provenance | UTC timestamp, source SHA, content/save version, build ID, artifact path or digest, debug/release and signing state |
| Scenario | Named/anonymous, Long/Short, prose mode, Library identity, exact import/refusal/export scenario |
| Result | **PASS**, **FAIL**, **NOT RUN**, or **BLOCKED** (no inferred passes); observed UI text and errors |
| Integrity | Before/after autosave and cold-resume comparisons; canonical hash or restricted test fixture; no private payload |
| Reproduction | Commands, logs/screenshots/artifact links, observer and known environment limitations |

A test failure should become a bounded child issue with its reproduction and
be fixed on its own legally claimed branch; do not hide it in a parent
acceptance note. Completion of #1995 requires current receipts for browser,
packaged Windows and **both mobile hosts**, including import/refusal, image,
accessibility and cold persistence. A successful CI run or this matrix alone
does **not** close #1995.
