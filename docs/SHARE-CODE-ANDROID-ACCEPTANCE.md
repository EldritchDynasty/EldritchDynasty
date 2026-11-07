# Packaged Android share-code acceptance — #3149

> **Execution status: NOT RUN.** This is a reproducible procedure and receipt
> template, **not** Android host evidence. Do not mark a row passed or close
> #3149 until a packaged APK has been driven in an isolated emulator and
> the named artifacts have been retained. Browser, fake-platform, Windows
> and unit tests do not substitute for this check.

## Scope and source of truth

This is the Android-host acceptance slice of #1995. The codec fix in #3135
has merged, but the tested build must still be frozen at execution time.
Use a real debug APK installed through Android, with the **actual Start UI**
and Capacitor Filesystem save transport. An emulator result is not a
physical-device, iOS, human-listening or store-release result.

The share-code contract is implemented in
`packages/core/src/share-code.ts` and `packages/client/src/lib/share-code.ts`.
It uses `ED1.`, a maximum of 2,400 characters, and explicit
save-format/content/build compatibility. Codes cannot encode a Demonstration
founding. Anonymous codes omit typed names; the number and sexes of friends
remain material. Two houses can share a founding setup without having
identical names or recipient Library inputs. Compare **complete canonical
founding state** only when the edition, submitted names and Library inputs
are deliberately held equal; never equate a matching seed alone with an
equivalent founding.

## 1. Freeze and record the tested artifact

Run from the repository root on an Android-SDK workstation with Node from
`.nvmrc`, Java/Gradle, a configured AVD, and `adb` on PATH:

```sh
git rev-parse HEAD
git status --short
node --version
npm --version
adb version
emulator -list-avds
adb devices -l
npm run setup
npm run build:client
npm run sync:android --workspace @ed/mobile
(cd packages/mobile/android && ./gradlew :app:assembleDebug)
sha256sum packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p nz.eldritchdynasty.game -c android.intent.category.LAUNCHER 1
```

The Gradle debug APK is **not** the tag workflow's release AAB or evidence
of Play signing. Record SDK/API level, emulator system-image identity, Android
build, WebView version, AVD name, ABI, APK digest, checked-out source SHA,
content/SAVE_FORMAT/build identifiers and the code-producing app's matching
edition. Capture `adb shell getprop ro.build.version.sdk`,
`adb shell getprop ro.build.fingerprint` and
`adb shell dumpsys package com.google.android.webview` (or the actual
WebView provider), as available. If the provider package differs, record it.

Use a **disposable AVD** and a fresh app profile, with no personal saves.
`adb shell pm clear nz.eldritchdynasty.game` erases the test installation's
data: use only before starting a new isolated case, never between the
failed-import and preservation assertions in a case.

## 2. Establish a comparable founding

1. In the source installation, create a compatible Short or Long Line
   founding with a fixed seed, explicit Examination answers, heirloom,
   grudge, founder configuration, Unicode names and a declared friends
   roster. Save the complete canonical founding snapshot and a
   **names-included** share code. Record the chosen Library inputs.
2. In the clean Android APK, choose the same prose mode or explicitly switch
   it in Reading, enter the code through **Start**, and complete any
   requested signing fields with the **same exact names**. Use the same
   compatible build/content/format and Library inputs. Verify that the
   code is accepted and the player reaches the expected founded house.
3. Capture the complete Android durable founding save through an isolated
   debug-only method or the app's supported export path. Compare canonical
   state, not just rendered names, campaign and seed. Record each difference
   with its JSON path. If a transport refreshes top-level `savedAt`,
   distinguish that transport metadata from simulation state rather than
   silently dropping other differences.
4. Force-stop the package, reopen it, resume the same save, and repeat the
   comparison against the **cold-resumed durable state**. Verify campaign,
   Examination, heirloom, grudge, friends and pending choices. Do not
   silently replace the durable snapshot with a newly founded game.
5. Repeat the Start import and refusal assertions in **Original** and
   **Plain English**. Code equivalence is mechanical; wording and
   accessibility need their own observable checks.

Keep one labelled fixed-Library case. Run a separate **different Library**
case and record which starting facts differ; it must **not** be described
as a byte-for-byte equivalent world. Run an **anonymous** code case with
names excluded: the recipient must supply omitted names, but the
founding's other encoded inputs (including friend sexes/count) persist.

## 3. Refusal and preservation matrix

For each case below, first have a valid active run and saved disk snapshot.
Enter the input through the packaged **Start** flow; do not invoke the core
decoder directly. Capture the visible refusal in **both** prose modes,
then verify the prior in-memory run and durable saved state are unchanged.
Finally import a deliberately valid compatible code and verify that recovery
works. Failure must not silently overwrite the previous house.

| Case | Expected contract | Actual result | Evidence |
| --- | --- | --- | --- |
| Damaged checksum / invalid code | Explicit refusal | UNRUN | — |
| Truncated code | Explicit refusal | UNRUN | — |
| More than 2,400 characters | Bounded refusal | UNRUN | — |
| Other save format | Edition mismatch | UNRUN | — |
| Other content fingerprint | Edition mismatch | UNRUN | — |
| Other build identity | Edition mismatch | UNRUN | — |
| Unsupported `ED` version | Version refusal | UNRUN | — |
| Demonstration founding/code | Unsupported demonstration | UNRUN | — |
| Valid retry after refusal | Explicit successful new founding | UNRUN | — |
| Cancelled/failed copy | Existing save remains; usable selectable fallback | UNRUN | — |

Do not manufacture a foreign-format/build code by relabelling a checksum
without rebuilding it: otherwise a checksum error proves only corruption,
not the targeted compatibility branch. Construct each fixture through the
production codec or a separately documented versioned producer, then
record the fixture identifier and how its checksum remains valid.

## 4. Export, transcription and accessible handoff

From a real Android Chronicle and Afterimage, inspect anonymous share-code
handoff and exported-image layout. Capture the rendered image and any
native share action. Confirm that the whole `ED1.` code is visible or
selectable, can be transcribed into the actual Start UI, and is not
cut off. Check any produced PNG/SVG and accessible-text equivalent in
both prose modes; mark an unsupported host route **UNAVAILABLE**, not pass.
Verify the exported image never includes optional private names through
the anonymous-code field. Record clipboard/selectable fallback separately
from the native share sheet.

The browser measurement in `tests/e2e/share-image.spec.ts` and the
packaged Windows result in `docs/WINDOWS-PLAYER-SMOKE.md` are useful
mechanism references, but **not Android acceptance receipts**.

## 5. Retain an auditable receipt

Record the following alongside the corresponding artifact links, with
only anonymized synthetic names and saves:

| Required field | Result |
| --- | --- |
| Source SHA / dirty status | NOT RECORDED |
| APK path and SHA-256 | NOT RECORDED |
| Node, Java, Android SDK/API, Gradle | NOT RECORDED |
| AVD, ABI, Android version, WebView provider/version | NOT RECORDED |
| Campaign, seed, save format, content/build fingerprints | NOT RECORDED |
| Source/recipient Library fixture and names policy | NOT RECORDED |
| Complete founding-state and cold-resume comparison | UNRUN |
| Original and Plain English Start-UI imports | UNRUN |
| Anonymous names and differing-Library comparisons | UNRUN |
| Refusal-state preservation and deliberate valid retry | UNRUN |
| Chronicle/Afterimage code legibility and accessibility | UNRUN |
| Native clipboard/selectable handoff | UNRUN |
| Failure logs/screenshots and reproduction links | NONE |

For reproducibility, retain console commands/stdout, short synthetic
input fixture identifiers, before/after canonical-save comparison output,
host screenshots (e.g. `adb exec-out screencap -p > screenshot.png`),
and narrowly filtered Android logs with personal data redacted. Link
artifacts by exact source revision. Never commit real private saves,
unredacted names, credentials, Android signing keys or megabyte log dumps.

**Completion rule:** a reviewer can rebuild the named APK and reproduce
each required Android result, or see an explicit blocker/unrun result.
After execution, replace the placeholders with factual evidence and
report failures on the parent #1995. This preparatory procedure alone
does **not** close #3149.
