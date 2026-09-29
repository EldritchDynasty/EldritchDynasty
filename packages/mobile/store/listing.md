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
- **Phone screenshots (2–8):** `screenshot-chronicle-placeholder.png` in this
  directory is the first one — see its note below. The others should show
  the family tree/table view and the docket (a live decision), since those
  are the two other things this game visibly is.

## Screenshot status

`screenshot-chronicle-placeholder.png` was captured 2026-09-20 from an
**automated playthrough** driving the actual client UI (not a hand-played
session, not a raw `npm run harness` batch run) — a scripted browser session
signed the prologue as "The House of Salt," answered the docket with "Let
him decide" throughout, and opened the in-game Book. Every name and every
line of prose on it is genuine simulation output, not placeholder text; the
house name is the only thing about it that was chosen by the automation
rather than a person.

Per this issue's own recommendation: use this now so the closed test is not
waiting on a playtest that has not been scheduled, and swap it for a page
from a real playtester once #60's first five playtesters exist. Recorded on
issue #110 as well.
