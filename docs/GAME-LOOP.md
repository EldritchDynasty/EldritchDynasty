# The game loop, and how a family progresses

A plain-language orientation to what a player actually does across a run, and what stands
in the way. [DesignConcepts/eldritch-dynasty-concept-brief.md](../DesignConcepts/eldritch-dynasty-concept-brief.md)
is the authority on all of this — its section numbers are cited below — and wins wherever
this page simplifies something into a rougher shape than the brief gives it.

Reviewed against `main` at `8b09dbee` on 26 October 2026. The code's calibrated
gates, rather than older design counts, govern the climb.

## The basic loop

At the signing you name the founder and choose their gender and **founding
configuration** (§3). As blood father, the founder passes the font to every
daughter; as blood mother, the founder carries it and bears the children.
Gender controls how the founder is referred to; the configuration determines
the founding parents. The founder holds the seal in their own right, including
as blood mother. The opening Examination, heirloom and first grudge set real
terms for the house that follows.

You begin as the signing founder and continue as the house's guardian. You steer
the **family**, generation after generation
(roughly one chapter per generation). Each round: years pass, you pick a
marriage partner for your heir from three candidate cards, a handful of text events fire,
children are born, you decide what the chronicle records about the generation just lived,
and you name an heir. The shipped start screen defaults to **A Short Line: 300 years (1042–1342)**; **A Long Line** is the full **500-year (1042–1542)** campaign, roughly twenty generations. See §5, Core Loop.

When the docket asks for a choice, a party, a Match or a Record, **the clock
waits for the answer**. Between those decisions the house table lets you
choose study, careers, standing duties, land work and other deliberate
actions. The Ascension display names the next unmet requirement. A voluntary
House Ambition can keep one plan visible — deepen the blood, prepare the
ascent, restore the Ledger or secure the branches — without adding a bonus
or a second progress system.

## Learned magic has work beyond the ladder

**Mystic magic is learned; Eldritch Power is inherited.** A book on the shelf
and an affinity high enough to read it are the beginning of training. The
reader must wake, qualify and finish studying before they know the working.
Women can learn the four Threshold affinities — Life, Death, Light and
Darkness — while men can learn all eight. Mystic work itself adds no Madness
and requires no expressed Eldritch Power. See §12.

At the house table, assign a trained, available person to an offered duty
and its target. The offer states preparation, upkeep and scope. Duties can
care for people and books, provide for a hall, protect an estate, support
construction or serve in a levy or expedition. An intensive duty pauses the
reader's unfinished study; an absent, injured, captured or unpaid practitioner
cannot supply the promised coverage. Releasing the duty lets an available
reader resume their remaining study if the book is still on the shelf.

Warranted outside practitioners can be sought and hired. Sending a qualified
reader on a commission occupies that person through preparation, service and
return, and can leave an obligation for a later trained reader. Sending a
family practitioner away also leaves their home duties uncovered. Preparing
an expedition or answering a household threat has costs, attendance and
possible custody consequences; learned support does not erase those risks.

These are available strategies, not a promise that training pays back in
coin or that every run offers frequent attacks. The dated paired evidence
and remaining limits are in [BALANCE-LOG.md](BALANCE-LOG.md).

## How the family actually advances

The main progress track is the **Ascension Ladder** (§22) — six ranks the bloodline climbs
by breeding a man powerful and stable enough to hit each rung:

1. **Touched** — awakened, and the power took. Baseline, not an achievement.
2. **Adept** — has learned real spells, powerful enough, sane enough.
3. **Hierophant** — powerful, versatile, and publicly respected — and carries *some*
   madness, because this rung has a madness floor as well as a ceiling.
4. **The Vessel** — requires a living relative sacrificed into the ascending heir.
5. **Demigod** — ageing stops; requires the three founding heirlooms reunited.
6. **God** — requires a separate blood descendant to receive the two-rite elder's
   Unmaking and clear the final gates, with living family readers carrying eight
   distinct books and an affinity from each opposed pair. The earlier cumulative
   gates still apply. The family has to prepare a successor beyond its elder.

Each rung demands more raw power, more magical range, more social standing, and —
pointedly — more sanity risk. A dynasty that concentrates everything into one perfect
patriarch cannot ascend; you have to build a family deep enough to eventually produce
someone better than your best.

## The barriers, and why they bite

- **Awakening is not fully controllable.** A child may never "wake" magically at all — a
  real, permanent outcome. Until they do, they cannot learn or lead. Rituals can force it
  early, at the cost of permanent madness and a real chance of killing the child. §11.
- **The Long Wait is a decision.** At the house table, an unwoken man of the line
  aged nineteen or older (other than the sitting Head) can be declared mundane.
  The declaration is permanent: he can never wake or learn magic, and succession
  passes him over for a brother, cousin or Regent. He can still marry, hold a post
  or be sent away. Keep waiting and he may still wake; past thirty, **the Late
  Waking** comes only through a scripted scene. §11.
- **Madness vs. Mind.** Power causes madness; Mind is the capacity to contain it. Go over
  your Mind score and the family pays in stillbirths and ruined heirs. But the higher rungs
  of the ladder *require* a minimum amount of madness, so the intended play is to run
  madness right up against Mind and hold it there, not to avoid it. §10, §22.
- **Only men express the power, and only men can go mad from it.** Women carry the font
  and never express it, which makes cousin marriage the only route by which carried power
  reaches an eligible male heir — the source of the family's power is also the source of
  its scandal and its self-destruction. §7, §10.
- **The Barren Generation (Regency).** If no living son can express the power, a woman
  holds the house together. She can defend, enrich, negotiate and prepare books
  and future heirs; she cannot express Eldritch Power herself. The house's
  ladder is measured over its eligible men, rather than the Head alone. The
  Ledger (the antagonist's debt) keeps counting regardless. The measured pacing
  cohorts are dated in [REGENCY-PACING.md](REGENCY-PACING.md). §7.
- **Respect is a permission gate, not a score to maximise.** Five tiers, Unknown through
  Exalted. High Respect is required just to be *allowed* to attempt the higher rites, but
  visible madness and honest chronicle entries about it burn Respect fast — so the endgame
  becomes a squeeze: you need great power to ascend, respectability to be allowed to, and
  power destroys respectability. §17.
- **The chronicle is a trap of your own making.** Every generation you choose to Record
  events truthfully (costs Respect when the truth is damning), Omit them (descendants lose
  useful knowledge and can repeat the same mistake at full price generations later), or
  Embellish them (buys Respect now, but creates a Discrepancy — a lie that can be proven
  against you later, at the worst possible time). §6.
- **The Vessel rite is a real cost, not a resource sink.** Reaching rung 4 means naming and
  sacrificing an actual relative from the family tree. Their power feeds the ascendant but
  cannot be passed to his own children, so the family can't simply cannibalise its way
  upward — every generation still has to be properly bred. §22.
- **The Ledger scales with the campaign.** A Short Line carries **three clauses** across
  300 years; A Long Line carries **nine** across 500. Reaching the reckoning with only a
  few clauses recovered produces a materially worse reading than recovering most of the
  available contract — a slow-burn barrier that rewards long-term attention (keeping an
  archivist in service) rather than a last-minute push. §18.
- **Money and careers are finite.** Every family member you educate, place in the church,
  army or court, or leave idle is a choice that trades one person's future for the house's
  present. §13, §17.

Progression means breeding for power, sanity headroom, fertility
and charm — across generations while juggling four scarce resources (magical power, sanity
headroom, social respect, and truth in your own record), each of which actively undermines
at least one of the others as you climb.
