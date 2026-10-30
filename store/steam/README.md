# Steam store presence — source copy and asset checklist

This directory is the repository source of truth for the Steam store page.
Steamworks is the publishing surface, not the only copy of the publishing
material.

**Status:** draft for the Coming Soon page. Verified against public Steamworks
documentation on 2026-09-23. Re-check the live Steamworks form and current
templates immediately before upload; Valve changed capsule dimensions in 2024
and explicitly says old dimensions are no longer accepted.

The game itself is still pre-release. Do not turn a planned feature into store
copy merely because an issue promises it. In particular, do not publish the
Long-Line Apotheosis promise until #133's shipped-horizon ending gate is green.

## Product name

```text
Eldritch Dynasty
```

## Short description

Plain text; no release date or other time-sensitive wording.

```text
A text-based generational strategy game about blood, marriage, and the family record you falsify across five centuries.
```

## About This Game

```text
The family record you falsify is what your descendants will inherit. When the Record opens, write what happened, omit it, or embellish it for standing now — and leave a discrepancy the creditor may read back.

In 1042, your ancestor signed something. In 1542, the other party comes to collect.

Eldritch Dynasty is a text-based generational strategy game about one family, one debt, and generations of consequences.

You do not play a hero. You play the will of a bloodline. Across generations you choose who marries whom, who inherits, who is spent, what the family records, and what it leaves conveniently blank.

The people in the house inherit genomes rather than rolled stat blocks. Desired traits can concentrate. Recessives can surface. Marrying outward can thin the blood, while marrying inward can preserve exactly the thing that ruins the descendants you were trying to strengthen.

The chronicle is not a log. It is evidence you are allowed to edit. Record the truth and descendants inherit useful knowledge at a social cost. Omit it and they may repeat the mistake. Embellish it and the house gains standing now while leaving a discrepancy that somebody may prove centuries later.

Every generation leaves a family tree and a book behind it. Cadet branches split away. Ages begin and end. Houses remember insults differently. The Church keeps its own version. The final reckoning reads the record the family chose to make, not a neutral transcript of what really happened.

A Short Line is the default three-century campaign with three Ledger clauses. A Long Line spans five centuries and nine clauses, with a difficult path toward Apotheosis. Its summit is rare, not an ending promised to every house.
```

### Feature bullets for the lower page

Use these only where the Steam editor's formatting makes a scan-friendly
feature section useful; the prose above remains the primary description.

- **Play the house, not a hero.** People are born and buried; the player's will persists across generations.
- **Breed a real bloodline.** Diploid inheritance, dominance and recombination make concentration and dilution consequences of the same genetics.
- **Write the evidence.** Record, omit or embellish what happened, and let descendants inherit the version the family kept.
- **Grow a family sideways.** Heirs, cadet branches, marriages, grudges and succession reshape the house over centuries.
- **Climb while the debt comes due.** Recover the Ledger and build toward a reckoning the family has been postponing since 1042.

## Store art direction

The game has no faces and no portrait art. Steam artwork should not invent a
character-led visual language the game itself does not have.

Use the same vellum / ink / rubric palette and geometric heraldic mark language
as the client and the existing Play assets, but rebuild each Steam asset at its
native size. **Do not resize the Play feature graphic and call it a capsule:**
its thesis-line marketing text is not allowed on Steam's base capsules.

Base store and library capsules contain only:
- artwork;
- the readable `Eldritch Dynasty` logotype;
- an official subtitle only if the project later adopts one.

No tagline, review quote, award, score, discount, release-date text, or feature
callout belongs on a base capsule.

## Required store assets

Current Steamworks dimensions, verified 2026-09-23:

| Asset | Size | Planned filename | Status |
|---|---:|---|---|
| Header capsule | 920×430 | `steam-header-920x430.png` | TODO |
| Small capsule | 462×174 | `steam-small-462x174.png` | TODO |
| Main capsule | 1232×706 | `steam-main-1232x706.png` | TODO |
| Vertical capsule | 748×896 | `steam-vertical-748x896.png` | TODO |
| Screenshots | ≥1920×1080, 16:9 | `screenshot-*.png` | TODO — at least five |
| Page background | 1438×810 | `steam-page-bg-1438x810.png` | optional |

Steamworks source:
https://partner.steamgames.com/doc/store/assets

Graphical-asset content rules:
https://partner.steamgames.com/doc/store/assets/rules

## Required library/client assets

| Asset | Size | Planned filename | Status |
|---|---:|---|---|
| Library capsule | 600×900 | `steam-library-600x900.png` | TODO |
| Library hero | 3840×1240 PNG | `steam-library-hero-3840x1240.png` | TODO — artwork only, no text |
| Library logo | 1280px wide and/or 720px tall PNG | `steam-library-logo.png` | TODO — transparent logo only |
| Library header capsule | 920×430 | `steam-library-header-920x430.png` | TODO |
| Shortcut icon | 256×256 PNG/ICO | `steam-shortcut-256.png` | TODO |
| App icon | 184×184 JPG | `steam-app-184.jpg` | TODO |

## Screenshot shot list

Steam requires at least five screenshots and says screenshots must show actual
gameplay rather than concept art, pre-rendered scenes, awards or marketing copy.
Capture at 1920×1080 or larger, 16:9.

The first five should make the product legible without reading the store prose:

1. **The Book / Chronicle** — a real played page containing an omission or
   contradiction. This is the headline image because the record is the game's
   unique loop.
2. **Family tree / halls** — enough generations visible to show that this is a
   dynasty rather than a party-management game.
3. **The Match** — three candidate cards and a live marriage decision, with the
   bloodline trade-off readable.
4. **Record block** — Record / Omit / Embellish on a consequence the player
   just caused.
5. **A live docket scene** — a strong authored decision with named family
   members, showing the ordinary reading experience rather than a menu.

Useful sixth and seventh:
- land / household state when it visually shows five centuries of accumulation;
- a frame interlude from 1542, chosen to establish the creditor without
  spoiling an ending.

Before upload, mark at least four screenshots as suitable for all ages where
their actual content qualifies, because Steam uses that flag for some store
surfaces.

## Trailer

**Not required for the Coming Soon page in this repository pass.**

Do not make a trailer from mock UI. Capture it from the real client after the
demo/full-client presentation is stable. The first trailer should show the
same product loop as the screenshot sequence: consequence → record choice →
later contradiction.

## Price

Do **not** copy a converted NZD price from issue #73 into Steamworks.

The design target remains NZD 28–35, but the actual Steam price must be chosen
from Steamworks' current pricing tools / suggested regional table on the day it
is entered. Record the chosen USD and NZD prices plus the date back on #73.

## Publish blockers / checks

Before publishing the Coming Soon page:

- [ ] #133 confirms the store copy does not promise an ending or Long-Line
      capability that is still unreachable in the shipped horizon.
- [ ] The live Steamworks short-description field accepts the copy above
      without truncation.
- [ ] All four required store capsules use Valve's current templates.
- [ ] No base capsule contains the thesis tagline or other marketing copy.
- [ ] At least five genuine 16:9 gameplay screenshots are uploaded.
- [ ] Screenshot 1 is a real in-client Chronicle page, not a harness rendering.
- [ ] Platform is Windows; macOS/Linux are not presented as pending features
      (#103).
- [ ] Price is read from the current Steamworks pricing UI rather than from the
      historical conversion in #73.
- [ ] Store copy is reviewed after the final 500-year balance/endings pass.
