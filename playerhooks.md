# Player hooks in Eldritch Dynasty

**Eldritch Dynasty’s strongest hook is: “I’m building a future for this family, but the things I do to secure it may be what destroys it.”** The mystery draws the player in; particular people, ambitions and remembered decisions give them reasons to stay.

Reading the current implementation and content, these are the main points where that investment develops. They overlap and vary between runs.

| Point in the game | What hooks the player | Goal and emotional investment |
|---|---|---|
| **Before playing: the debt has a date** | “An ancestor signed something. The other party comes to collect.” There is an unanswered question and a definite reckoning. | **Curiosity and apprehension:** What did we agree to? Can I prepare the family to survive collection? |
| **The signing: making this my house** | Naming the founder and house, answering the Examination, choosing an heirloom and an inherited grudge. Each answer gives something and costs something. | **Ownership:** These are my family’s strengths, compromises and enemies. I want to see what my choices produce. |
| **First marriages, births and awakenings** | A marriage promises a future child; the child’s inheritance and awakening remain uncertain. Naming children makes that anticipation personal. | **Hope:** Will this child be the one? Can I give them the education, partner and protection they need? |
| **First succession** | Someone the player prepared takes responsibility; others establish branches. The founder’s persistence as guardian connects those changing lives. | **Continuity and grief:** Can the next generation carry forward what the last one built? A person’s death leaves an unfinished project. |
| **The first costly Record decision** | Record, Omit or Embellish makes the player responsible for the family’s account of an event. Truth can damage standing; concealment can damage descendants. | **Complicity:** Do I protect the house now, or leave its children the truth? Later consequences make an earlier decision worth remembering. |
| **Recovering clauses and revisiting the frame** | New clauses provide concrete information about the bargain. Interludes bring earlier entries back under scrutiny. | **Discovery and reconsideration:** I understand more of the danger—and may need to change my plan. Keeping an archivist becomes purposeful. |
| **A crisis: war, plague, scrutiny or a generation without an eligible magical heir** | Established people, halls, books and plans become vulnerable. Different crises change what the family urgently needs. | **Protectiveness and resolve:** Save this person, preserve this branch, get through these years. Previous investment gives survival a specific meaning. |
| **Higher ascension, especially the Vessel** | Progress demands a named living relative. The person consumed belongs to the family the player has spent generations building. | **Ambition colliding with attachment:** How badly do I want this achievement? Whose future am I willing to spend on it? |
| **The final ascent and collection** | The Long Line requires the family to outgrow its greatest elder. At collection, the chronicle—including its blanks and disputed accounts—is read back. | **Legacy and accountability:** Can the family finish what I began? Can the history I constructed withstand its reckoning? |

These hooks are grounded in the [opening and signing](https://github.com/EldritchDynasty/EldritchDynasty/blob/main/packages/content/prologue.yaml), the [generational loop](https://github.com/EldritchDynasty/EldritchDynasty/blob/main/docs/GAME-LOOP.md), and the [authored endings](https://github.com/EldritchDynasty/EldritchDynasty/blob/main/packages/content/endings.yaml).

**The most direct mechanism for giving the player an ongoing goal is House Ambition.** The implemented choices are:

- **Deepen the blood:** build a broad, resilient living family.
- **Prepare the ascent:** develop a named candidate toward higher ascension.
- **Restore the Ledger:** recover the contract’s missing clauses.
- **Secure the branches:** establish viable family halls beyond the main seat.

Each displays progress, current status and a next step. That connects a centuries-long premise to something the player can pursue now. The default Short Line gives a particularly concrete destination: a three-clause account to settle over 300 years. The Long Line expands to nine clauses and the full ascension ladder. See the [ambition implementation](https://github.com/EldritchDynasty/EldritchDynasty/blob/main/packages/core/src/ambition.ts).

My main concern is **the handoff from curiosity to caring**. The opening can make someone want an explanation before they care about any descendant. The early game needs a person they remember, a near-term hope for that person, and a decision whose consequence they recognise. Likewise, ascension becomes emotionally powerful when the player thinks “I’m asking this of him again,” alongside wanting the next rung.

Those are designed hooks, with plausible emotional effects. Their effectiveness with new players remains unverified: the [playtest notes](https://github.com/EldritchDynasty/EldritchDynasty/blob/main/docs/PLAYTEST.md) explicitly say the relevant human studies were waived and weren’t run.
