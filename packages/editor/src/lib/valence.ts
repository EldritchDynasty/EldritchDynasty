import { assertNever, type Effect } from '@ed/schema';

/**
 * WHICH WAY DID THAT GO?
 *
 * The player needs to know whether an outcome helped or hurt before they have
 * finished reading it — that is what the boon and blow cues are for, and what
 * the marks beside an outcome in the editor are for. Both read this.
 *
 * Nothing in the content declares it. That is on purpose and it should stay
 * that way: an authored `valence: blow` on eight hundred outcomes is eight
 * hundred chances to say something the effects contradict, and it would drift
 * within a month. So it is DERIVED from the effects the outcome actually
 * applies, which cannot drift, because it is the same list the simulation runs.
 *
 * The cost of deriving it is that this file has an opinion about what is good
 * for a house, and some of those opinions are arguable. They are written down
 * next to each one. Where a kind genuinely does not say — a flag, a rumour,
 * a recast — the answer is `plain`, and `plain` is a real answer rather than a
 * fallback: it has its own cue, because an outcome that lands and moves
 * nothing is a thing the player should still hear.
 */

/** Success, failure, and neither. `Cue` in `sound.ts` carries the same names. */
export type Valence = 'boon' | 'blow' | 'plain';

/**
 * How much each kind counts, so a coin does not outvote a death.
 *
 * These are weights on a sign, not on a magnitude: a treasury delta of −4000
 * and one of −40 are both "the house lost money", and the difference between
 * them belongs in the text, not the chime. The one thing that must hold is the
 * ORDER — a death outranks money, madness outranks a career.
 */
const WEIGHT = {
  death: 6,
  madness: 4,
  grudge: 3,
  book: 2,
  standing: 2,
  ordinary: 1,
} as const;

/**
 * The signed contribution of one effect. Positive is good for the house.
 *
 * Exhaustive over `Effect` and ending in `assertNever` (invariant 5): a new
 * effect kind must come here and say which way it points, and the compiler
 * will not let it be forgotten. A permissive default would silently score
 * every new kind as neutral, and neutral is the answer that looks correct.
 */
function scoreOf(e: Effect): number {
  switch (e.kind) {
    case 'attribute':
      return Math.sign(e.delta) * WEIGHT.ordinary;

    /**
     * A trait is whatever the content says it is — `steady` and `consumptive`
     * are the same shape here. Adding one is not knowable as good or bad
     * without reading the trait's own definition, which this function is
     * deliberately not given. Silent.
     */
    case 'trait':
      return 0;

    /**
     * Every status a person can be moved to takes them out of the living
     * household: dead, given to the church, spent as the Vessel. The guardian
     * is the exception the invariant carves out — Daveed does not die — and
     * he is still a man the house has stopped being able to marry off.
     */
    case 'status':
      return -WEIGHT.death;

    /**
     * A RITE (§22). Scored as a death, because one is what it costs — the
     * Vessel is a living relative and the house does not get her back. What
     * the ascendant gains is real and is deliberately not weighed against it:
     * an outcome that reads as a boon is an outcome the player is being told
     * to take, and the whole point of this rung is that it is a bargain.
     */
    case 'rite':
      return -WEIGHT.death;

    /** Madness only ever goes one way for a house. */
    case 'madness':
      return -Math.sign(e.delta) * WEIGHT.madness;

    /**
     * Awakening unlocks Mind, reading and ascension. The ritual's permanent
     * Madness cost is authored as its own effect beside this one, so scoring
     * the transition as a modest boon keeps the bargain visible rather than
     * hiding either side of it.
     */
    case 'awakening':
      return WEIGHT.book;

    /** A thing arrives, a thing is spent, a thing changes hands. */
    case 'heirloom':
      return e.op === 'grant' ? WEIGHT.ordinary : 0;

    case 'spellbook':
      return e.op === 'lose' || e.op === 'degrade' ? -WEIGHT.book : WEIGHT.book;

    case 'career':
      return e.op === 'assign' ? WEIGHT.ordinary : -WEIGHT.ordinary;

    case 'treasury':
      return Math.sign(e.delta) * WEIGHT.ordinary;

    case 'respect':
      return Math.sign(e.delta) * WEIGHT.standing;

    /** Bookkeeping. A flag is how the game remembers, not what happened. */
    case 'flag':
    case 'arc_flag':
      return 0;

    /**
     * A grudge is a debt with a person's name on it and it is inherited, so
     * it outweighs the sentiment shift that usually comes with it.
     */
    case 'relationship':
      if (e.grudge) return -WEIGHT.grudge;
      return e.sentiment === undefined ? 0 : Math.sign(e.sentiment) * WEIGHT.ordinary;

    /** Text. The chronicle line is the report, not the event. */
    case 'chronicle':
      return 0;

    case 'knowledge':
      return e.op === 'grant' ? WEIGHT.ordinary : -WEIGHT.ordinary;

    /**
     * A Discrepancy is a liability from the moment it exists, and proving one
     * is the liability arriving. Burying it is the only good news here.
     */
    case 'discrepancy':
      return e.op === 'bury' ? WEIGHT.ordinary : -WEIGHT.standing;

    /**
     * Silent, and this one is a judgement worth stating. A rumour is not bad
     * news by construction — `plant_rumour` is a legal purpose that perfectly
     * ordinary scenes declare, and half of them are the house being talked
     * about in ways it likes. Scoring rumours as blows would make the blow cue
     * fire on a third of the library and mean nothing by the second century.
     */
    case 'rumour':
      return 0;

    /** A clause recovered is the one thing in the run that is unambiguously progress. */
    case 'clause':
      return WEIGHT.standing;

    case 'branch':
      return e.op === 'appease' ? WEIGHT.ordinary : -WEIGHT.ordinary;

    /** Machinery: who is in the room, what happens next, which story runs. */
    case 'recast':
    case 'schedule':
    case 'arc':
      return 0;

    /**
     * A forged pedigree is a bargain, not a boon: it buys a match now and
     * files a document somebody can produce in two hundred years. The game
     * has a whole system for the second half of that. Silent.
     */
    case 'forge_lineage':
      return 0;

    /**
     * Neither, and deliberately. Binding somebody buys hands the house does
     * not pay for and costs it their goodwill for as long as it holds them;
     * freeing them costs the debt and buys the silence. Both are trades this
     * game asks the player to make rather than outcomes it grades, and an
     * arrow either way in the editor would be the author being told which one
     * is the right answer.
     */
    case 'bond':
      return 0;

    /**
     * Ending a marriage is a trade the same way `bond` is: a real cost with
     * a real gain behind it (issue #132), and an arrow either way would be
     * the editor grading a decision this game asks the player to make.
     */
    case 'marriage':
      return 0;

    /** Machinery — see `muster`, below, for the same reasoning. */
    case 'priorityMatch':
      return 0;

    /** A term begun is the same shape of investment as a book gained; cut short, the same loss. */
    case 'tutor':
      return e.op === 'begin' ? WEIGHT.book : -WEIGHT.book;

    /**
     * Machinery: the commitment's own bookkeeping. What an outcome does TO
     * the house is carried by whatever effects ride alongside it —
     * `the_muster_is_called`'s `they_go` outcome pairs `op: 'begin'` with
     * its own `respect`/`relationship` effects, and those already say which
     * way it went. Silent, on the same grounds as `bond`: entering, buying a
     * position and withdrawing are trades this game asks the player to make
     * rather than outcomes it grades.
     */
    case 'muster':
      return 0;

    /**
     * LAND (issue #91, Phase D — #98). A parcel gained or repaired is the
     * same shape of gain as a book gained; a parcel lost or damaged, the
     * same shape of loss — `tutor`'s own reasoning, aimed at ground instead
     * of a term.
     */
    case 'land':
      return e.op === 'grant' || e.op === 'restore' ? WEIGHT.book : -WEIGHT.book;
  }
  return assertNever(e, 'effect');
}

/**
 * Which way an outcome went, for the house.
 *
 * An outcome with no effects at all is `plain` — and there are a lot of those,
 * because a scene whose whole job is `worldbuild_through_action` is allowed to
 * just happen.
 */
export function valenceOf(effects: readonly Effect[]): Valence {
  const total = effects.reduce((sum, e) => sum + scoreOf(e), 0);
  if (total > 0) return 'boon';
  if (total < 0) return 'blow';
  return 'plain';
}

/** The running total, for a view that wants to say how strongly. */
export function valenceScore(effects: readonly Effect[]): number {
  return effects.reduce((sum, e) => sum + scoreOf(e), 0);
}
