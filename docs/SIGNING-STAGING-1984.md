# First-session signing: staged candidate and observation contract (#1984)

_Protocol audit: 7 November 2026. No human playtest or host smoke was performed by this change._

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
The current `ed-reading-log/13` format already has `pane` events;
these coarse markers do not add a new event schema. Format 13 also identifies
failed pickups so a refused load does not silently split the previous run. The
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

## Reproducible baseline/candidate capture sheet

Do not call the older unstaged opening a measured baseline merely because a
historical commit is available. **Before the first participant**, identify two
builds that can both be run and reproduce the actual baseline and the staged
candidate. Record their **full** source SHAs, build/content identities,
platforms and any relevant UI differences. The exported recorder's
`build.sha` and `build.platform` are provenance checks, not substitutes for
recording which variant the participant actually used. If no reproducible
baseline exists, report a single-arm candidate observation instead of a
comparative effect.

For each attempted session, fill in one row; do not discard incomplete starts:

| Field | Baseline / candidate observation |
| --- | --- |
| Session and variant | Anonymous local session ID; baseline or staged candidate; cohort/recruitment note |
| Build | Exact source SHA, content/build identity, platform and recorder `format` |
| Inputs | Campaign (keep Demonstration separate), declared seed, prose mode, relevant accessibility/skip-seen settings and Library policy |
| Conditions | Screen size, keyboard/touch/screen-reader path, observer help, break/hidden intervals |
| Start and signing | Accepted Begin, stage exposure, first accepted `found`, returned `enter`, rejected/retried attempts |
| First action | Recorder's `summary.entries[].firstAcceptedCommand` verb and timestamp **plus** observer's account of whether it was consequential |
| Time and fate | `startedAt`, `foundedAt`, `enteredAt`, `wallMs`, `foregroundMs`, `censored`; explain missing endpoints and interruptions |
| Understanding | Which given/owed tradeoff the reader thinks they made; navigation mistakes, assistance, abandonment, and participant wording recorded separately |
| Integrity | Whether equivalent substantive founding inputs produced equivalent canonical founding state/replay; any mismatch or unavailable check |

The recorder's `summary.entries` is an array: a restart can create multiple
entries in a single exported file. Each entry starts at accepted Begin, not
when a URL was opened, and ends at the first accepted gameplay-command candidate,
another start/pickup, or log termination. The `firstAcceptedCommand` can be
`choose`, `match`, `order`, `muster`, or `record`; a successful Sign or Enter
is **not** that endpoint. Null endpoints and `censored: true` are observations
of missing evidence, not zero elapsed time, abandonment or a refusal.
`foregroundMs` excludes hidden/unfocused/declared-break intervals, but remains
an exposure estimate, not measured reading or comprehension.

Before comparing rows, report variant-specific denominators (participants,
attempts, completed first actions, censored entries, and refused/retried
foundings). Keep identical substantive input choices and compare both prose
modes; disclose any differences. Use the participant's own description of
their first meaningful action to decide whether the recorded command was a
valid endpoint. If one variant lacks provenance, comparable inputs or an
observer-verified endpoint, keep its descriptive result but **do not** infer
that the staged signing improved speed, understanding or retention.

## Decision still required

No participant rows, baseline build pairing, comparative result or adoption
decision are supplied by this protocol revision. Capture them under the
existing `docs/PLAYTEST.md` consent/observation process. Publish the
baseline/candidate findings and an explicit adopt/revise/no-change decision
before considering #1984 complete.

The client tests cover deterministic draft isolation, coarse stage-event
labels, and unchanged accepted-command timing. Browser/native audio, actual
reader comprehension, cross-device sessions and baseline-vs-candidate
human outcomes **have not been measured by this patch**. This issue must
remain open pending that evidence and a recorded adopt/revise/no-change call.
