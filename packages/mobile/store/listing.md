# Play Store listing — draft copy

Draft for the Play Console listing form. Every figure here is a character
count against the limits in issue #110; re-verify against the live form
before submitting, since Play's own limits are the source of truth, not this
file.

## Title

```
Eldritch Dynasty
```
16 characters (limit 30).

## Short description (limit 80)

```
You are the family. 500 years, one bloodline, no two runs the same.
```
67 characters.

## Full description (limit 4000)

```
Eldritch Dynasty is a generational strategy game. A Long Line runs five
hundred years — about twenty generations of one bloodline — and every choice
in it is yours: who marries whom, who is spent on a levy that does not ask
what he was worth to his mother, what gets written into the family's own
record, and what each child is called.

You do not play a single hero. You play the house. The people in it are born,
marry, inherit, go mad, and die according to rules that do not bend for you —
and the record the family keeps of itself is not the same thing as what
actually happened. What you choose to write down outlives what you chose to
do.

Nobody in this game has a face. There is no art beyond the sigils a house
carries into its own record — the game is built entirely from text, choices,
and the family tree you grow across five centuries. If that sounds like it
asks more of you than most games do, it does.

This app collects no data and needs no connection. Play the whole five
hundred years offline, at your own pace, and see what your line looks like
at the end of it.
```

## Content rating (IARC)

Answer descriptively rather than defaulting to "no":

- Themes: death, hereditary madness, arranged marriage, bonded debt, forgery,
  occult ritual. No graphic violence — these are consequences described in
  text, not depicted.
- Gambling: no real-money gambling and no purchases of any kind. The game has
  a marriage-market mechanic (trading candidates, prices, kinship claims)
  that is a strategic negotiation, not a game of chance played for stakes —
  describe it in those terms on the questionnaire rather than answering the
  gambling question with a bare "no."
- Expected result: roughly PEGI 12–16 / ESRB Teen. Confirm against IARC's
  actual questionnaire result before submitting — this is an estimate, not
  a filed answer.

## Target audience and content

- **13+.** Deliberately outside the Families program, whose requirements do
  not fit a game about mortality, madness, and debt.

## Data safety

- **No data collected, none transmitted.** True as of this writing because
  the client makes no network calls and ships no analytics or crash-reporting
  SDK — see `packages/mobile/AGENTS.md` for what would make this false and
  what to do before shipping a version where it is.

## App access

- All functionality is available without login, account, or special access.

## Closed-test operations

Before starting the 14-day closed test, give testers
[`closed-test-smoke.md`](closed-test-smoke.md). It verifies the Play-installed
build, restart/resume, the main reading surfaces, same-device export/import and
offline play, and routes failures to reproducible GitHub issues without adding
analytics or a feedback network service to the app.

## Graphics

- **Icon:** `play-icon-512.png` — 512×512, in the same vellum/ink/rubric
  palette and geometric heraldic language used by the in-game sigils and
  marginal marks. It is intentionally a mark rather than a portrait: the game
  has no faces, and the store icon should not imply otherwise.
- **Feature graphic:** `play-feature-1024x500.png` — 1024×500. It uses the
  same house mark and page palette, with the game's title and the thesis line
  "What you write outlives what you did." No screenshots or character art are
  composited into it.
- **Phone screenshots:** [screenshot-chronicle.png](screenshot-chronicle.png)
  shows the full Chronicle; [screenshot-household.png](screenshot-household.png)
  shows the living family tree. Both are 1080×1920, opaque 24-bit RGB PNGs
  captured from the production-built game client. They replace the former
  Chronicle placeholder and provide two phone screenshots for the listing.

## Screenshot provenance — 2026-10-15

These are unmodified captures of the actual client reading a real played Short
Line, under the owner's #324/#335 waiver recorded on #322. No text was invented
for the images. The save was imported through **Bring a run in** and validated
by core; every displayed name and Chronicle entry comes from that run.

- **Landed source:** `68a94d3e8f9bf992c0c0829b694ef02e76c56e4d`.
- **Campaign / seed:** Short Line, `7001`.
- **Played policy / term:** chronicler, 80 years, from 1042 to **1122**;
  **91 Chronicle entries** at capture.
- **House:** House Gearithy; the default founder, Daveed Gearithy.
- **Heirloom / first grudge:** `portion_of_agelessness` / `house_marrow`.
- **Examination:** `the_ford=own_back`,
  `the_two_letters=what_her_mother_bore`, `the_hard_winter=the_teacher`,
  `the_moved_stone=assize_at_cawdry`.
- **Imported-snapshot world digest:** `e5922d129f613eb0:280776`, from
  `digestOf(session.ctx)` before the capture-only UI steps below.
- **Generation:** Node v24.19.0, `newGame(content, { seed: 7001,
  campaign: 'short', decider: 'chronicler' })`, `found` with the inputs above,
  `advance(80)`, then `saveGame(session.ctx)`.
- **Renderer:** `npm run build:client`, served by Vite preview; Chromium
  153.0.8010.12 through Playwright, Original reading mode, touch/mobile
  viewport **540×960 CSS pixels at device scale 2**.
- **UI steps:** accept the nine suggested child names with **Keep the names he
  suggests**, dismiss the introductory hints, and open the household's main
  hall with the **Everyone** filter. For the Chronicle, choose **The chronicle
  → Read it whole**, keep **The whole book**, leave search empty, and select
  **1100**. No further years are advanced for either screenshot.
- **Capture checks:** no page errors or horizontal overflow; image headers
  verify 1080×1920, 8 bits per RGB channel, and no alpha channel. Both images
  were visually reviewed at their captured size.

| Image | SHA-256 |
|---|---|
| `screenshot-chronicle.png` | `91c94e9343bf600521775adc21968cd8c7bb575e9e3f5352154262e4f5d60fef` |
| `screenshot-household.png` | `a5f79790a039df6901ed0338c0e2c2a635b7a8283d27d068bef055d0aecb081b` |

The Play account, release artifact, closed-test approval, 12 opted-in testers
for 14 continuous days, and production access remain separate acceptance on
#322. These images do not establish those release checkpoints.
