# Player audio host acceptance — evidence matrix (#1986)

This is the **remaining-host checklist**, not an assertion that player audio
works on every device. Keep test mechanisms and observed host behavior separate:
a green fake-engine unit suite does not demonstrate audible mobile playback,
and an old packaged Windows receipt does not cover newer audio changes.
The parent issue stays open until its required host observations are recorded.

## Evidence already in the repository

| Source / environment | What was actually established | Limitation / current status |
| --- | --- | --- |
| [PR #2999](https://github.com/EldritchDynasty/EldritchDynasty/pull/2999), packaged Windows 10 (build source `2aa474ee7699f23009d15663008d1058fcc750ec`, 2026-11-05 06:30 UTC) | Eight packaged checks passed: first-gesture gate and measured nonzero master signal, native minimize/restore, mute across cold restart, Demonstration interlude silence/return, share-code refusals, Unicode founding and cold resume, ending clipboard | Measured renderer signal, **not** human listening or phone playback. Audio fixes since this SHA require the affected rows to be rerun. The executable was locally packaged and unsigned, not a store release |
| [Windows runbook](WINDOWS-PLAYER-SMOKE.md) | Reproducible `npm run build:shell` followed by `node packages/shell/scripts/windows-player-smoke.mjs`; the ignored `packages/shell/release/windows-player-smoke.json` has per-row results and build/hash identity | A script and receipt format are not a fresh run or a substitute for real Android evidence |
| `packages/client/src/lib/sound.test.ts` and `sound-bed-preference.test.ts` | Fake-engine mechanism tests cover score, committed cues, mute/volume, hidden/background behavior and failure paths; `sound.test.ts` compares complete saves loud and silent | Tests in source are not physical-host listening tests. Record the exact tested commit and result before calling a run passed |
| `tests/e2e/sound.spec.ts` | Real Chromium exercises the first gesture, AudioContext source starts, settings persistence, visibility/page lifecycle, and further audio behaviors | Desktop Chromium is not packaged Capacitor/Android or iOS; synthetic lifecycle events do not prove native lifecycle delivery |
| Android packaged player | **Unrun here** | Required host acceptance remains open; record real device or emulator, OS, WebView, output route and actual observed signal |
| iOS packaged player | **Unrun here** | Record separately if exercised; an iOS simulator is not physical iPhone listening |
| Human listening | **Unrun here** | No assertion about perceived sound quality or improved reader experience |

## Android acceptance — reproducible protocol

Use the *actual packaged player*, not the editor, a fake engine or only a
browser test. Run on a pinned checkout after the intended audio fixes have
landed. The mobile package's commands are documented in
[`packages/mobile/AGENTS.md`](../packages/mobile/AGENTS.md); follow that
guide and `packages/client/AGENTS.md` before any native-code change.

1. Record the **source commit**, build flavor (Debug or Release), APK SHA-256,
   Android build/runtime versions, device model or emulator image, WebView
   version, audio route, volume, silent-mode state and the actual debuggable
   package flag. Keep observed and inferred fields distinct. An emulator
   producing a signal is not evidence that a physical speaker was heard.
2. Build the client, then sync the native host from the same checkout:
   `npm run build --workspace @ed/client`, followed by
   `npm run sync:android --workspace @ed/mobile`. Produce/install the intended
   flavor from `packages/mobile/android`; do not treat an unsigned Debug APK
   as the Release APK. Preserve the package hash for the installed binary.
3. With the Reading default **on**, volume **1**, observe that no device/score
   starts before the first user gesture. Start or resume a real full campaign,
   then verify audible/measured Age drone and the existing page, bell, seal,
   boon, blow and plain cues at their **actual committed moments**. Do not add
   new cues or treat a sound count alone as evidence that a cue was audible.
4. Set **off** and **zero volume** separately. Check silence without exceptions,
   no continuing stale cue or drone, and restoration to the latest Age only
   after the correct user interaction. Fully terminate and cold-restart to
   verify the stored Reading preference; no sound value belongs in a save,
   command log or `WorldState`.
5. Trigger a real authored **1542 frame/interlude** and verify that the drone
   is silent during the held frame, then returns only after it is dismissed.
   Exercise host background/foreground, interrupted or unavailable audio,
   rapid suspend/resume and an activation denial. Record whether the audio
   clock, sources and output actually behave as intended, not merely that the
   UI stayed responsive.
6. With identical founding, Library and game commands, compare **complete
   canonical saves**, RNG/decision replay and resulting year with sound on and
   off. A sound preference or lifecycle transition must not change simulation.
   Record failures, including whether the prior durable save survived restart.
7. For any native diagnostic smoke used to drive the run, enforce the
   Debug/Release boundary separately: [#3161](https://github.com/EldritchDynasty/EldritchDynasty/issues/3161)
   documents a demonstrated Release-build diagnostic-intent exposure. Until
   that fix and a Release APK rejection test are verified, **do not use a
   diagnostic intent as proof of safe Release behavior**. Do not run smoke on
   a personal/player profile; use an isolated disposable installation.

### Host result ledger

Enter the actual source/build SHA and artifact hash before changing any
`unrun` status. Store the receipt, logs and any scope limits alongside the
issue, not as an implied result in this template.

| Required Android row | Debug | Release | Evidence to retain |
| --- | --- | --- | --- |
| First gesture and real cue/drone output | unrun | unrun | Signal/audio route and gesture timestamps |
| Mute, zero level and cold-restart preference | unrun | unrun | Before/after preference and device state |
| 1542 frame silence and return | unrun | unrun | Frame state and audio source/output sample |
| Native background/foreground and interruption | unrun | unrun | Lifecycle events and resume/refusal outcome |
| Complete save/replay equality with sound on/off | unrun | unrun | Canonical hash and paired command sequence |
| Release diagnostic boundary (#3161) | n/a | unrun | Non-debuggable installed APK and unchanged prior save |

## Closure and coordination

- Refresh the Windows audio rows against the **final** integrated audio SHA;
  the historical #2999 receipt remains valid only for its own source.
- Link the exact-headed hosted `CI required` and, for this public repo,
  `merge_group` result. Green CI does not replace the host rows above.
- Close #1986 only after the required **Windows and Android** checks and
  preference/error behavior are evidenced, with remaining iOS and human
  listening limitations stated explicitly.
- Keep [#1995](https://github.com/EldritchDynasty/EldritchDynasty/issues/1995)
  and its packaged share-code acceptance separate. A successful share-code
  import does not prove the audio bed, and vice versa.
