# First-session signing: staged candidate and observation contract (#1984)

_Repository audit: 6 November 2026. No human playtest or host smoke was performed by this change._

## Baseline and current candidate

The ordinary client begins a new house from **Start** with a chosen campaign and
seed. The Prologue reads its authored three-part debt before allowing signing.
All drafts remain presentation state until one successful `GameSession.found()`
call. The existing candidate splits signing into these stages:

1. **Founder** (where requested): name, gender, and the separate blood-parent
   configuration. Gender only suggests a configuration until explicitly chosen.
2. **Examination** (where authored): all four questions and their given/owed
   consequences. None may be omitted.
3. **House:** heirloom, first grudge, house name and an optional collapsed
   disclosure for naming friends. Unnamed friends are not sent in the payload.

Back/Continue only changes the local stage, while a final accepted signing
shows the thesis and **Enter** opens the playable board. The first meaningful
family choice must be observed *after* Enter, not inferred from Sign.

The candidate already exists; this slice protects its per-run identity if a
retained component receives another campaign sharing the same starting year,
signing page and mechanical option identifiers. Changing prose mode alone
does not change run identity or the founding payload.

## What the optional recorder can establish

On a URL with exactly one opt-in `?reading-log=1`, the client records
`begin` only after a successful start. It records accepted/refused `found`
and returned/thrown `enter` separately from their attempts. A successful
begin-to-first-accepted-command interval appears in `summary.entries`; the
accepted command is a **candidate** meaningful family action, not proof of
comprehension. A later pickup/new run/export censors incomplete intervals.

This slice also records coarse `pane` boundaries at the time the signing
becomes available and when the reader changes section:

- `signing:founder`
- `signing:examination`
- `signing:house`

Only a fixed stage label is emitted. No founder/house/friend names, written
answers, refusal text, or optional friend information are in these markers.
The existing `ed-reading-log/12` event format already has `pane` events;
this is an additive use of that field rather than a new format. The
foreground clock remains an **exposure proxy**, not active reading time.
Stage transitions alone do not establish an accepted decision.

## Study protocol before adoption

Use the existing protocol in `docs/PLAYTEST.md` and compare fresh newcomers
on the declared baseline and candidate with the same endpoint: the **first
observed accepted consequential family action** after Enter. Keep
Demonstration and full-campaign observations separate. Record starts,
completion/censoring, navigation errors, assistance, comprehension and
abandonment notes with an observer; do not infer them from clicks or time alone.
Compare Original and Plain English, keyboard and responsive layouts, and
fixed-seed founding/replay equivalence before changing the default further.

The client tests cover deterministic draft isolation, coarse stage-event
labels, and unchanged accepted-command timing. Browser/native audio, actual
reader comprehension, cross-device sessions and baseline-vs-candidate
human outcomes **have not been measured by this patch**. This issue must
remain open pending that evidence and a recorded adopt/revise/no-change call.
