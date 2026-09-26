# Many agents, one repository

Everything below assumes the thing this project actually does: several Claude
sessions, each in its own container with its own clone, working different issues
at the same time. They cannot see each other's files, cannot message each other,
and all of them authenticate to GitHub as the same person.

---

## The one thing to know

**The limit on parallelism here is not merge conflicts. It is the frequency
pool.**

Two agents can each add ten events, each run `npm run check` green on their own
branch, and produce a `main` that fails gate 4 and gate 8 the moment both land —
without one line of overlap between the two diffs. The reason is in
[BALANCE-LOG.md](BALANCE-LOG.md)'s headline: a tier's share of the year is that
tier's weight times *how many templates carry it*, over the same product across
every other tier. Twenty-eight new common templates ration uncommon and rare, and
nothing anywhere reports it. `expectRate` margins go the same way — five tests
have broken on commits that changed nothing they measured, because adding ANY
template re-rolls which scene wins every draw for the rest of the campaign.

Git will merge those two diffs without a murmur. So:

- **Code parallelises. Content serialises.** One content claim open at a time.
- **A branch is only green on the base it was checked against.** Rebase onto the
  landing `main`, then re-run — see [Landing](#landing), which is the rule that
  catches the paragraph above.

Everything else in this document is bookkeeping.

---

## Can an agent assign an issue to itself?

Mechanically yes, usefully no.

Every agent on this repository authenticates as **JamesFlames** — the GitHub
connector carries the owner's identity, not a per-agent one. `get_me` returns the
same login in every session. So an assignee says *a Claude is on this*; it cannot
say *which*, cannot be released by the right one, and cannot arbitrate a race:
assignees, labels and comments are all read-then-write over an API with no
compare-and-swap. Two agents that start a minute apart both read "unassigned" and
both assign.

**Git ref creation is a compare-and-swap.** Pushing a branch that already exists,
carrying a commit that is not a descendant of the one there, is rejected by the
server, always, by protocol. That is a real mutex and it needs no label or
comment-based lock. Shell sessions reach it directly; connector-only sessions
reach the same implementation through the repository-hosted transport below.

So the lock is a ref and the tracker is the human view of it:

```bash
npm run agents                                   # who holds what
npm run agents -- take 93 --paths packages/core/src/economy
npm run agents -- check                          # my claim, and anyone overlapping
npm run agents -- release 93                     # when the work lands
npm run agents -- steal 93                       # only once a claim has gone stale (6h)
```

A connector-only session cannot manufacture the orphan commit that the mutex
requires through the normal GitHub write surface. Create and push the ordinary
working branch first, then put one of these exact commands in an issue comment:

```text
/claim 93 --agent chatgpt/issue-93-topic --paths packages/core/src/economy
/claim 93 --agent chatgpt/issue-93-topic --paths packages/core/src/economy --lane code
/claim check --agent chatgpt/issue-93-topic
/claim release 93 --agent chatgpt/issue-93-topic
```

`.github/workflows/remote-claim.yml` authorizes the commenter, checks out
`main`, and runs `tools/remote-claim.mjs`. That transport validates the
request and invokes **`tools/agents.mjs`** with argument arrays; it never
constructs a claim ref itself. A competing claim therefore still loses at the
same orphan-ref push, and a `DENIED` from `agents.mjs` makes the workflow
fail. The Actions summary contains the tool's output. This is transport to the
one mutex, not a second mutex.

A claim is an orphan commit with an empty tree pushed to `claim/<issue>`. Orphan,
so no second claim can be a fast-forward of the first and quietly win; empty
tree, so taking one touches no file and can never be merged into anything by
accident. The commit message carries the agent, the lane and **the paths it means
to write** — which is the field that earns its keep, because `check` reports an
overlap before either agent has written a line.

The race is what `packages/core/src/tools/agents.test.ts` actually tests: a bare
repository, two clones, both taking the same issue, exactly one holding it. A
mutex nobody has watched lose is indistinguishable from no mutex.

Assign and label the issue as well if you like; it is what the team lead reads.
Just never treat it as the thing that stopped someone else from starting.

---

## Lanes

| Lane | Paths | How parallel |
|---|---|---|
| **client / editor / shell** | `packages/client`, `packages/editor`, `packages/shell` | Freely. Separate trees, separate typecheck, no shared statistics |
| **engine** | `packages/core/src/**` (not `tools/`), `packages/schema/src/**` | By subsystem, one agent per subsystem. Watch the hotspots below |
| **content** | `packages/content/**.yaml` | **One at a time.** Take `lane-content` as well as your issue |
| **gates & CI** | `packages/core/src/tools/**`, `vitest.config.ts`, `.github/workflows` | One at a time. Everyone's build depends on it |
| **docs** | `*.md`, `docs/**` | Freely, but append to `BALANCE-LOG.md` under a dated heading rather than editing in place |

### Engine hotspots — one writer each, whatever the issue says

These are single files that every second feature wants to touch. Declare them in
`--paths` and expect `check` to shout:

- `packages/schema/src/save.ts` — **`SAVE_FORMAT`** is one integer. Two agents
  both bump 10 → 11, git merges both cleanly on either side of the number, and
  one of the two migrations is silently not the format that shipped.
- The closed unions — `event.ts`, `conditions.ts`, `target.ts`, `decider.ts`,
  `event.ts`. Two new `Effect` kinds is two agents in the same union and the same
  `assertNever` switch in `core`. The conflict is mechanical and obvious; the
  danger is resolving it by keeping one side's `case` and both sides' variants,
  which typechecks forever and does nothing (invariant 11).
- `packages/core/src/year/phases.ts` — the year table. Renaming or reordering
  reseeds a phase, so two agents inserting phases must not both guess where.
- `packages/core/src/session.ts` — the whole client surface. Small file, high
  demand.
- Generated: `packages/content/loci.yaml`, `docs/VOCABULARY.md`. **Never resolve
  a conflict in these by hand.** Take either side, then `npm run gen:loci` /
  `npm run gen:docs` and commit the regeneration.

---

## The protocol, end to end

1. **Claim before reading code.** Shell: `npm run agents -- take <issue> --paths
   <what you will write>`. Connector-only: create the working branch, then
   comment `/claim <issue> --agent <branch> --paths <what you will write>`.
   Do this once for each issue this branch intends to land. Denied means denied
   — pick another issue rather than working it in parallel and discovering the
   other agent at merge time.
2. **Branch per agent**, as the session harness already does:
   `claude/<topic>-<suffix>`. One issue, one branch, one session.
3. **Work.** `npm run test:fast` is the loop — see
   [AGENTS.md](../AGENTS.md#commands) for what it costs.
4. **Re-check the claim before the long run.** Shell: `npm run agents -- check`.
   Connector-only: comment `/claim check --agent <branch>`. Both read the
   canonical claim refs and report path/lane overlap before you spend the long
   run.
5. **Land** — below.
6. **Release**: a closing keyword per issue in the landing commit does the
   closing, and the janitor retires every claim the branch held and deletes the
   branch on the same push. `npm run agents -- release <issue>` (or connector
   comment `/claim release <issue> --agent <branch>`) is for the other case —
   an issue you are putting down without landing it, so the merge does not
   sweep it up with the rest.

**A release does not delete the ref, and cannot.** A web session's git proxy
refuses ref deletion — `git push --delete` comes back `403`, and there is no
GitHub tool in the session that deletes one either. So a release force-updates
the claim to a tombstone commit saying `released:`, which every agent reads as
free. It works identically on a laptop and in a container, which a delete does
not. `--prune` will attempt the delete as well, and shrugs when it is refused.

That same 403 is why there are **28 unmerged `claude/*` branches** on the remote:
no agent has ever been able to tidy up after itself. Branch cleanup is a job for
a human with a local checkout (`git push origin --delete <branch>`), or a
scheduled workflow. Do not ask an agent to do it and do not read a surviving
branch as work in flight.

## The standard, end to end

One session, one branch, **as many issues as that branch actually lands**, one
claim each, and they close themselves.

| Step | What does it | What it costs |
|---|---|---|
| Claim | `npm run agents -- take 93 --paths …`, once per issue | a ref push each. Every claim records the **branch** holding it, so `npm run agents` reads as an assignment table and one branch may appear on several rows |
| Say so, for the humans | one comment on the issue naming the branch | optional, and never the lock — an agent's GitHub identity is yours, so a comment cannot arbitrate anything |
| Land | `Closes #93, closes #94` in the commit message | GitHub closes them when that commit reaches `main` — **a keyword in a commit works with no PR at all**, which is what this repository's fast-forward flow needs |
| Clean up | `.github/workflows/janitor.yml` → `tools/janitor.mjs` | deletes the merged branch, retires **every claim that branch was holding**, and closes anything the keyword missed |

### One branch, several issues

That is the normal case, not the exception — an epic delivered in three
sub-issues, or a fix and the test-gate it needed. Two things follow.

**The keyword goes before every number.** `Closes #12, closes #13` closes both.
`Closes #12, #13` closes only #12, and the second issue sits open for a week
before anybody notices. `npm run agents -- check` prints the whole line for
whatever the branch is holding, ready to paste:

```
holding 200 (lane code, 0m)
holding 201 (lane code, 0m)
landing commit needs: Closes #200, closes #201
```

**The sweep keys off the branch, not the issue.** When a branch becomes an
ancestor of `main`, every claim naming it is spent and gets retired — nobody has
to enumerate them. Closing is deliberately the other way round: only issues a
commit actually named get closed, and an issue whose claim was retired by the
merge without any commit naming it is *reported and left open*:

```
- retired `claim/94` — `claude/epic-93` landed
  - ⚠ #94 is still OPEN and no landing commit named it. Close it or re-claim it.
```

Because a branch that lands half an epic is ordinary, and a script cannot tell
that from one that finished the job.

**The janitor exists because agents physically cannot do this part.** A session's
git proxy refuses ref deletion (403), so no agent has ever deleted its own
branch — which is the whole explanation for the 34 `claude/*` branches on the
remote. An Actions runner has no such restriction. It runs on every push to
`main`, plus daily, and deletes only what git can prove is redundant: a branch
whose head is already an ancestor of `main`. A branch that is not merged is
reported in the run summary and left alone, because from the runner "abandoned"
and "in flight" look identical and only one of them is safe to act on. Its first
run removed thirty-six of thirty-seven, because until it existed nobody had ever
been able to delete a merged branch at all.

### Never ask a container whether something is merged

**An agent's clone is SHALLOW.** Fifty-nine commits of a hundred-and-forty-one,
`.git/shallow` on disk, and `git merge-base --is-ancestor` cannot see past the
graft boundary. It does not fail there. It answers **false** — so every branch
older than the shallow window reads as unmerged, and a dry run in a container
reported "7 merged, 29 kept" while the truth was the reverse of it.

That answer looked cautious, which is why it was believed. It cost a full round
of deleting the right branches, restoring them in a panic, and deleting them
again. Three things came out of it:

- `tools/orient.mjs` runs from the SessionStart hook and **unshallows the clone**,
  so the trap is gone rather than documented. It prints the open claims on the
  way past, and can never fail a session — `orient.test.ts` covers the broken
  remote and the not-a-repository cases, because an orientation step that stops
  work is worse than none.
- `tools/janitor.mjs` refuses to run on a shallow clone rather than answer at
  all, and `janitor.test.ts` clones a `--depth 1` repository to watch it refuse.
- The rule below, for the sessions where the hook has not run — a local
  checkout, a subagent, anything unusual:

```bash
git rev-parse --is-shallow-repository   # true → your ancestry answers are noise
git fetch --unshallow                   # if you actually need one
```

`git merge-base`, `git branch --merged`, `git log main..branch`, "has this
landed?" — all of it is unanswerable in a fresh session until you unshallow.

The sweep is `tools/janitor.mjs` rather than steps in the YAML, so it can be read
and run:

```bash
DRY_RUN=1 node tools/janitor.mjs    # every action it would take, and none performed
```

It needs **Settings → Actions → General → Workflow permissions** set to *Read
and write* — [`/settings/actions`](https://github.com/JamesFlames/EldritchDynasty/settings/actions)
in a browser, since the GitHub mobile app does not carry repository settings; or
`gh api -X PUT repos/JamesFlames/EldritchDynasty/actions/permissions/workflow -f
default_workflow_permissions=write`. A workflow's own `permissions:` block can
only NARROW what the repository allows, never exceed it, so a repository capped
at read-only gives the janitor neither of the two it asks for and every delete
comes back 403 — the same wall the agents hit.

Raising that default hands every OTHER workflow a write-capable token as well,
which is why `check.yml` now declares `contents: read` and nothing else. A
default that widens a job nobody was thinking about is how this sort of change
goes wrong six months later.

### Why the branch is not the lock

Naming the branch after the issue is a good convention and a poor mutex, for one
mundane reason: **a web session does not choose its own branch name.** The
harness assigns it (`claude/multi-agent-collaboration-bkj7x8`), before the agent
has read a line of the tracker, so an issue number cannot reliably be in it. The
claim ref is what an agent can push at the moment it decides, under a name it
controls, and it carries the branch as its payload. The two are the same idea;
only one of them can be created on the first second of the session.

---

## Landing

The repository's standing authorization is to fast-forward `main` as soon as
`npm run land` is green, with no PR ([AGENTS.md](../AGENTS.md#working-style)).
That holds with several agents running, and the reason it is one command rather
than four is the whole point of this document:

```bash
npm run land            # fetch · rebase onto origin/main · typecheck, validate,
                        # test AND gate ON THAT HEAD · push · WAIT for CI's
                        # verdict. Stops on the first thing that fails, and
                        # pushes nothing when it does.
npm run land -- --dry-run      # the plan, and none of it performed
npm run land -- --no-verdict   # push, and do not wait to be judged
npm run verdict                # ask about HEAD on its own
```

A connector-only session that cannot run that command locally uses a ready
same-repository PR and comments exactly `/land`. The
`.github/workflows/remote-land.yml` runner executes **that same `npm run land`**
command; it is not permission to merge a merely-green PR. The request is
write-authorized, remote landings queue behind one another, and local vs remote
landings still arbitrate at the final compare-and-swap push. This exists because
a PR check can be green on an old base — the rebase and the post-push verdict
remain mandatory.

**It is one command because the set is derived rather than remembered.**
`npm run check` is `typecheck && validate && test` — it does not run the gates,
which is nine minutes of measured runs and a third of what CI does. Four of the
eleven red runs of `check.yml` on `main` across runs 61-100 failed at exactly
that step, each one after the whole test suite had been green for forty-one
minutes. `packages/core/src/tools/land.test.ts` reads
`.github/workflows/check.yml` and fails the build if CI grows a job the landing
does not run, so the two sets cannot drift apart again quietly.

Put `Closes #93` in the landing commit. GitHub honours a closing keyword in any
commit that reaches the default branch — [it does not need a pull
request](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/using-keywords-in-issues-and-pull-requests)
— so the issue closes on the fast-forward and the janitor retires the claim
behind it. A keyword in a commit that lands on any other branch does nothing but
leave a reference.

**The check that matters is the one after the rebase**, and `land` is that check
— it runs everything on the rebased head, every time. A green run against the
base you forked from says nothing about the base you are landing on — that is
exactly the case where two content branches each pass and their merge does not.

This used to be a table of what you could skip depending on what the rebase
brought in: the full check for content or `core`, `test:fast` and a gate for
docs. **That guidance is gone, and it was the bug.** It asked an agent to
classify its own diff before it knew the answer, and offered a shorter path for
getting it wrong — while gate 4 (fire rate) and gate 8 (outcome reach) can go
red on content nobody in this session touched, because a tier's share of the
year is that tier's weight times how many templates carry it.

One thing is still yours to run, because it answers a question no gate asks:

- **Refactors**: `npm run digest -- 8 400` before and after. If the block moves,
  it was not a refactor — and because each phase draws its own RNG stream, a
  moved block names the system that moved it.

**A push is not finished until a verdict comes back, and there are four
answers.** `land` waits for it and exits on what it says:

| | | |
|---|---|---|
| **green** | every job passed | done |
| **red** | a job failed, and it names which | yours to fix |
| **pending** | CI started and has not finished | wait, or ask again |
| **absent** | no verdict for that commit | **not a pass**, and not yours to fix |

The third one is why any of this exists. Seven consecutive landings on `main`
between 2026-09-05 09:02 and 2026-09-06 01:12 produced runs that concluded in
three to five seconds with a single job carrying no steps — the repository was
out of Actions minutes while it was private. Six were agent landings. Nobody
noticed for sixteen hours, because a red run and a run that never happened are
the same colour in every UI.

An absence is the repository's to fix, not the agent's, and an agent that
treats it as red will spend a session bisecting a diff that was never tested.
Report it and name the commit.

**`pending` is separate from `absent` because the first version of this tool
did not separate them**, and reported NO VERDICT for a commit whose `check` run
was still going — "not yet" as "never", the same collapse one turn smaller. A
run announces itself when it starts now, so a ref saying `pending` means CI is
working. No ref still means nothing is coming, because a run that never starts
never announces either.

**The verdict is a git ref, not an API call**, because the API is not reachable
from where this has to run. Measured in an agent container on 2026-09-07:
`curl https://api.github.com/.../actions/runs` returns
`403 GitHub access is not enabled for this session`. The host is allowed; the
session holds no credential for it, and only the MCP tools do. So
`.github/workflows/verdict.yml` writes `refs/verdict/<sha>` and everything
reads that — the same argument this document already makes about the claim
mutex, applied to reading instead of writing: a local agent and a web session
do not have the same API access, and both have `git fetch`.

---

## How many agents

Three or four concurrent, of which **at most one in content**.

The ceiling is not thinking time, it is the landing lane: `npm run land` runs
the whole set CI runs and has to run again after every rebase, so five agents
finishing together spend their afternoon re-checking each other. What it costs
is stated once, in [AGENTS.md](../AGENTS.md#commands) — and this paragraph used
to say "about nine minutes" against a measured thirty, which made the crowding
sound three times cheaper than it is. Give each agent
a different package where you can — client, editor, engine, content — and the
rebases stay empty.

Two shapes of work that should never run in parallel with anything, including
each other:

- **A balance change** (a frequency profile, a weight, a constant in
  `demography.ts`). It moves every number every other agent is measuring against.
- **A gates or vitest-config change.** It decides whether everyone else's build
  is telling the truth.

Take `lane-content` or `lane-gates` for those and let the others land first.

---

## Running them

- **Web**: one Claude Code session per issue. Each gets its own container and its
  own clone, which is the isolation you want and costs nothing to arrange.
- **Local**: one git worktree per agent —
  [`claude --worktree`](https://code.claude.com/docs/en/worktrees), or
  `isolation: worktree` on a subagent so parallel edits cannot collide in one
  checkout.

Either way the claim ref is the only thing the agents share, and it is the only
thing they need to.
