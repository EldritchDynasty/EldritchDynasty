# Product playtest protocol

This is an optional product-research runbook for observing first-time players.
It preserves questions and thresholds developed while #24, #35, #36, #60, #85,
#103 and #213 were active. Those issue numbers are provenance, not current
acceptance gates: #24, #35, #60, #85, #103 and #213 are closed, and #36 now
defines its remaining acceptance as automated/measurable engineering evidence.
A live issue body, not this file, is the authority on what closes that issue.

The rule is simple: **record first, interpret second, tune last**.

## Before recruiting

Use a product-equivalent build, preferably the packaged Windows build from #67
once that path is green. Do not use editor controls, debug panels, seeded test
helpers, or explanations that a normal player would not receive.

For every session record:

- build commit SHA;
- platform;
- campaign id and the actual `startYear`, `endYear`, and `years` from
  `CampaignDef`;
- seed;
- whether this is the participant's first or second completed run.

Do not copy campaign duration from an issue title. The tracker has carried stale
200/300-year wording while the product changed. At the time this protocol was
written, the code in `packages/core/src/campaign.ts` defines **A Short Line as
1042–1342 (300 years)** and **A Long Line as 1042–1542 (500 years)**. The test
record must preserve what the tested build actually shipped.

### Freeze the mechanisms being judged

Do not change bearing weights, warning suppression, ending reckoning, motif
timing, deleterious-load values, or the daughter/match presentation between
participants in one cohort. A moving mechanism makes the observations
incomparable.

If a build-breaking defect requires a new SHA, record the break between cohorts
rather than silently pooling the results.

## Cohort

For a cohort using the historical Phase 13 observation set (#60, closed),
recruit **five first-time or genuinely low-context players**. Six is preferable
when practical; that is a product-research preference, not an issue-closing
threshold.

They must not have read the design brief, §29, the bearing issues, or the
acceptance criteria below.

Normal onboarding is allowed. Design explanation is not.

### Historical cross-device scenario (#103, closed)

If evaluating cross-device handoff, reuse the same cohort rather than recruiting
a second group. One useful scenario has **one participant complete A Short Line
on Android**.
A different participant **starts on the packaged Windows build and finishes on
Android from an exported save**, with a full application close between the two
sittings. At the handoff, record the Windows and Android build SHAs, device/OS,
and `SAVE_FORMAT`; export the save, fully exit the Windows application, then
import it on Android for the next sitting.

That transfer is a prescribed acceptance step, not spontaneous behaviour. The
observer may instruct the cross-device participant to perform it at the planned
handoff, but **must not count that instructed export toward #60's spontaneous
chronicle/export criterion**.

Do not tell them:

- that pride/bearing is being measured;
- that daughters are being observed as people versus inventory;
- that cousin cards are a genetics-risk test;
- which choices are expected to matter;
- that chronicle sharing/export is an acceptance criterion.

## During the Short-Line run

Observe rather than coach. Keep a timestamped note whenever one of the following
occurs.

### Historical first-run observation set (#60, closed)

Record:

- start and finish time;
- active playtime where pauses can be separated;
- each stop and resume point;
- any place they need help beyond normal UI/onboarding;
- any spontaneous statement about what the house is trying to become;
- any person they refer to repeatedly;
- any decision they later revisit;
- any spontaneous opening, exporting, copying, or sharing of a chronicle page.

**Do not suggest exporting or sharing before the run and post-run questions are
complete.** The #60 criterion is valuable only when the artefact attracts the
player without being requested.

### Historical women-as-people observation set (#24, closed)

Record the player's own language around daughters and women on Match panels.

Observe:

- whether they use names or functions such as "carrier", "match", "good genes";
- whether they remember a woman later without the interface currently showing
  her;
- whether they can say something about a named woman beyond her blood/match
  value;
- whether the matchmaker panel's mother/sister history is read as family
  history or scanned only as coefficients.

Objection to the injustice of the setting is **not** a failure. The failure
signal is indifference expressed as inventory language: women becoming
interchangeable resources whose names and individual histories do not survive
the decision.

Do not ask "did the women feel like people?" during play. That manufactures the
criterion.

### Historical deleterious-load observation set (#24, closed)

For every cousin-card opportunity record:

- whether the cousin card was offered;
- whether it was taken;
- visible hesitation before the choice;
- whether a later bad outcome is attributed to the cousin choice;
- whether one punishment causes the player to stop considering cousins;
- whether cousins continue to be taken with acknowledged risk.

Interpret only after the cohort:

- routinely avoided after one punishment → load may be too high;
- taken repeatedly without thought or remembered consequence → load may be too low;
- repeatedly taken, sometimes hesitated over, and sometimes regretted → intended shape.

Do not use this observation to retune concentration generally. The earlier
"deleterious load is why concentration fails" theory was already measured and
rejected.

## Immediately after the ending

Do not show an issue checklist or explain the design first.

### Optional bearing question

Ask exactly:

> **What do you think went wrong — or right — for your house?**

Let the player answer uninterrupted. Record the answer verbatim or as close to
verbatim as possible.

Only after the first answer, ask:

> **Which decision, or repeated kind of decision, do you think caused that?**

If using this question, record:

- named a concrete decision or repeated behaviour: yes/no;
- named a specific person in the explanation: yes/no;
- connected the behaviour to a consequence that arrived later: yes/no;
- answered primarily with a number, stat, hidden rule, or system: yes/no;
- independently used the ordinary English word "pride": yes/no.

Spontaneously saying "pride" is not itself a failure. A failure is the game
teaching a visible pride/bearing number or the player explaining the result as a
mechanical stat instead of a remembered act and consequence.

Do not offer a list of Match/Record/bearing mechanics as prompts.

### Historical Phase 13 questions (#60, closed)

After the bearing answer is safely recorded, ask these open questions in order:

1. **What was your house for?**
2. **Who do you remember most clearly? Why?**
3. **What decision mattered most?**
4. **What do you think A Long Line would give you that this run did not?**

The fourth answer should be compared with the front-door promise actually shown
by the tested build. A useful answer names meaningful scope — the full
Ledger/ladder/endgame or broader generational story reach — rather than merely
"more years".

Only after these are recorded may the observer ask about confusing screens,
missing information, or whether the player would export/share something.

## Historical second-run comparison (#35, closed)

At least one participant who completed the first run should play a second Short
Line without being told which decision is supposed to differ.

After the second ending ask:

1. **What was materially different this time?**
2. **What decision do you think caused that difference?**

Pass the carry-forward question when the two runs differ in consequential
events/outcome and the player names a concrete decision they believe changed
the line. A number, hidden rule, or "luck" alone is not that result.

## Historical early-vs-late chronicle test (#85, closed)

This was the human half of #85. It remains useful as an optional product-research
exercise; it is no longer issue acceptance.

### Prepare the material before any reader sees it

Use **eight Long-Line seeds**. For each seed:

1. export chronicle material from the early third and late third;
2. choose comparable-length excerpts that contain ordinary run history, not the
   prologue or final Term page;
3. remove explicit dates, campaign labels, "the Term", and other direct clock
   tells;
4. preserve names, decisions, land/Muster/bearing consequences, career history,
   Record consequences, and other genuine state differences;
5. randomise whether the early or late excerpt is shown first;
6. label the pair only with an opaque id such as `A1/A2`.

Keep an answer key outside the reader sheet.

Do not hand-pick only spectacular late passages. The question is whether the
game's normal later history is distinguishable, not whether an observer can
spot an ending.

### Reader task

After the participant's own run is complete, give them the eight pairs one at a
time and ask:

> **Which excerpt comes later in its family's history, and what makes you think so?**

For each pair record:

- early/late choice;
- correct/incorrect;
- reason, in the reader's words.

Five readers × eight pairs gives 40 binary judgements. A useful pre-declared
"above chance" floor is **26/40 correct**: under a 50/50 null, 26 or more has a
one-sided binomial tail of about 4%. Do not lower this threshold after seeing the
results.

Also classify the cited reason. Concrete later-history evidence includes, for
example, accumulated or lost land, repeated Muster history, long career tenure,
delayed bearing/Record consequences, broader family history, or ladder/goal
state. "The prose sounds later" with no concrete feature is weaker evidence and
should be kept separate.

## Historical observation thresholds

These thresholds preserve how the closed research questions were read. They are
not current issue-closing gates and must not be copied into an open issue
without a new decision and new evidence. Do not convert every qualitative
question into a fake precise metric; preserve the raw observations for design
decisions.

| Question | Pre-declared reading |
|---|---|
| #60 completion | 5/5 first-time players finish with normal UI help only |
| #60 house story | at least 4/5 can state a coherent story/purpose for the house |
| #60 decision | at least 4/5 name a specific decision that mattered |
| #60 person | at least 3/5 name a specific person |
| #60 artefact | at least 1/5 voluntarily opens/shares/exports a chronicle page |
| #60 playtime | report median and range against the active Short-Line product target; do not rewrite the target after observing it |
| Bearing research signal | for a five-player cohort, 4/5 decision/repeated-behaviour explanations and 3/5 delayed-consequence links was the historical research target; with six players, the historical floors were 4/6 and 3/6 |
| #24 item 3 | decide from names/history versus inventory language; objection is not failure |
| #24 item 5 | decide from repeated risk-taking/hesitation/regret, not one dramatic seed |
| #35 second run | consequential divergence plus a concrete decision the player believes caused it |
| #85 blind reader | at least 26/40 early-vs-late judgements correct, with concrete cited differences |
| Generation-memory research (#213, closed) | after each completed generation, ask “what was that generation about?” before showing its framing again; record whether the answer names the same pressure/person in substance |

A failed row creates a **narrow follow-up for the observed failure**. It does not
automatically reopen an old tuning theory.

Examples:

- "random/dice" after the ending → delayed read-back may be illegible;
- "I lost because the number was low" → ending/presentation may expose mechanism
  instead of consequence;
- cannot remember the relevant decision → warning/record trail may be too weak;
- every player identifies the same optimal moral → bearing may have become a tax;
- women remembered only as "the carrier" → personhood mitigation is insufficient;
- cousins abandoned after one punishment → inspect deleterious-load severity;
- blind early/late reasons cite only wording → later game state may still be too
  stationary even if the classifier squeaks past 50%.

## Historical generation-memory check (#213, closed)

At the first natural pause after a generation closes, **before reopening the
generation framing**, ask:

> **What was that generation about?**

Record the answer verbatim. Do not prompt with the question the UI showed. The
check passes for that generation when the player names the same human pressure
or person in substance; exact wording is irrelevant. A player repeating the UI
sentence from memory is useful evidence, but a player independently saying
“keeping the east hall from walking” when the framing was about that cadet
branch is stronger evidence.

## Per-participant record

Copy this block once per participant.

```text
Participant: P__
Build SHA:
Platform:
Campaign:
Start/end/years:
Seed:
First or second completed run:

Started:
Finished:
Active playtime:
Sittings / resume points:
Help beyond normal UI:

House "for":
Most memorable person:
Decision that mattered:
What Long adds:
Generation “what was it about?” answer (verbatim):
Same pressure/person as framing?:

Bearing first answer (verbatim):
Bearing decision/repeated behaviour:
Specific person named?:
Delayed consequence named?:
Number/stat/system explanation?:
Used "pride" spontaneously?:

Women named/referred to:
Inventory-language observations:

Cousin opportunities:
Cousin cards taken:
Hesitation/regret/avoidance observations:

Chronicle opened/exported/shared without prompt?:
What happened:
```

## Cohort report

When the cohort is complete, append or link one report containing:

- tested SHA and exact campaign definition;
- participant count;
- completion/playtime table;
- anonymised first answers to the bearing question;
- #60 pass/fail table;
- #24 item 3 and item 5 decisions with the observations that justify them;
- #35 second-run comparison;
- #85 40-judgement blind-reader table and cited-reason categories;
- every follow-up opened as a result.

Preserve the raw notes until the issues are closed. A summary without the first
answers makes it too easy to remember the interpretation and lose the evidence
that produced it.
