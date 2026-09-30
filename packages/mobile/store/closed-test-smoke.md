# Play closed-test smoke

Use this checklist for the Google Play closed test tracked by issue #322. It is
deliberately short: the goal is to prove that the release build is usable on
real Android devices, survives an ordinary app restart, and gives us actionable
feedback without adding analytics, sign-in, or any other network service to the
game.

## Before you start

Install **Eldritch Dynasty** from the closed-test Play link, not from Android
Studio or a locally shared APK.

Record these four facts with your result:

- phone/tablet model;
- Android version;
- Eldritch Dynasty version name and version code shown for the installed app;
- whether this was a fresh install or an update over an earlier test build.

Do not post account details, device identifiers, Play order numbers, or other
private information in feedback.

## Ten-minute smoke

1. **Launch from the Play-installed build.**
   - The first screen should be the game, not an editor or debug page.
   - Start **A Short Line**.
2. **Create the house and make a real decision.**
   - Finish the signing/prologue.
   - Name the house.
   - Advance until at least one player decision appears and answer it.
   - Note the current in-game year.
3. **Prove resume works.**
   - Leave the app normally, remove it from Android's recent-apps view, then
     launch it again.
   - **Resume** should be offered.
   - Resume the same house and confirm the house name and in-game year are the
     same as before the restart.
4. **Check the main reading surfaces.**
   - Open the family/house view and make sure the text can be read and scrolled.
   - Open the Chronicle/Book and make sure a recorded page can be opened.
   - Rotate the device once if rotation is available; there should be no
     permanently hidden control or unreadable overlapping text afterwards.
5. **Exercise save portability on the device.**
   - Return to the start screen and export the current save.
   - Confirm Android offers a share/save destination for the exported file.
   - Import that exported save back into Eldritch Dynasty.
   - Resume it and confirm the same house name and in-game year are present.
6. **Prove the game itself is offline.**
   - After the Play install and the steps above, enable airplane mode.
   - Relaunch and resume the saved house.
   - The game should remain playable; no account or connection prompt should
     appear.

If a device cannot perform one step because Android does not expose that
operation (for example, rotation is locked), mark that step **not applicable**
rather than failing the whole smoke.

## Report the result

For a clean run, add a comment to issue #322 with this compact report:

```text
Closed-test smoke: PASS
Device:
Android:
App version name / code:
Fresh install or update:
Not-applicable steps:
Notes:
```

For a failure, open a GitHub issue at
<https://github.com/JamesFlames/EldritchDynasty/issues/new> and include:

- the device model, Android version, app version name/code, and fresh/update
  status;
- the numbered smoke step that failed;
- what you expected;
- what happened instead;
- the smallest sequence of actions that reproduces it;
- a screenshot or screen recording when it helps.

Then link that issue from #322. Do **not** attach an exported save publicly
unless it is needed to reproduce the problem and you are comfortable sharing
the names/text you entered into that run.

## Release-owner record

Before applying for production access, the owner should be able to point from
#322 to:

- the exact tagged AAB used for the closed test (workflow run, version
  name/code, SHA-256);
- the closed-test start timestamp and tester count;
- at least twelve testers who remained opted in continuously for the required
  period;
- smoke results or linked defects from real devices;
- the Windows ↔ Android save-transfer smoke for the same release family;
- the real playtester Chronicle screenshot that replaces the current automated
  placeholder.

This checklist is evidence for the engineering/readiness side of #322. It does
not replace Play Console's own eligibility checks or the owner's production
access application.
