/** Type-only session read contracts. Runtime readers and verbs remain in session.ts. */
import type {
  DiscrepancyState, RespectTier, CampaignId, Register, FrameEntry, Rung, EndingId, TaleForm, ResolvedClaim, PersonStatus,
} from '@ed/schema';
import type { PendingDecisionView } from './events/decisions.js';
import type { AmbitionRelevance, HouseAmbitionView, HouseAmbitionOption, AmbitionRecommendation } from './ambition.js';
import type { RecordStakes } from './record-stakes.js';
import type { AgeMatchPriority, AgeRecordPriority } from './ages/strategy.js';
import type { ChronicleEntry } from './world.js';
import type { PositionOption } from './muster.js';
import type { FrozenLadder, AscensionBlockerKind } from './ascension.js';
import type { CastMember } from './cast.js';

/** A source-linked reading of what the family wrote, never a reconstructed life. */
export interface RecordedMilestone {
  entryId: string;
  year: number;
  label?: string;
  source: 'deed' | 'title' | 'blank';
  disputed?: DiscrepancyState;
}

export interface PowerEvidenceRoute {
  title: string;
  rule: string;
  caution: string;
  daughters: { person: string; name: string; evidence: string[] }[];
  cards: { decision: string; card: string; name: string; label: string; evidence: string[] }[];
  alternatives: { decision: string; card: string; name: string; label: string; evidence: string[] }[];
  none?: string;
}

/**
 * WHAT THE JUMP DID TO THE HOUSE (issue #54).
 *
 * Every number in the header is a LEVEL, and after turning a clock the only
 * question a player has is a derivative: 252 crowns might have been 190 and
 * climbing or 610 and collapsing, and the header reads the same either way.
 * That is this codebase's failure mode exactly — nothing on the screen is
 * wrong, and the screen has stopped carrying information.
 *
 * It is computed HERE, over the years `advance` actually turned, rather than
 * by a client diffing snapshots it took itself. A client holding its own idea
 * of when a year happened would be private simulation bookkeeping living in
 * Vue, and this repository has spent enough on second places that keep the
 * same books.
 *
 * The tiers are `undefined` where they did not move, and that is load-bearing
 * rather than tidy: a tier that held is not news, and a header permanently
 * decorated with "(0)" is the noise the whole issue is about.
 */
export interface StandingDelta {
  /** Signed, summed over the years turned. Zero where the money did not move. */
  treasury: number;
  discontent: number;
  /** How many Ledger clauses came back this jump. Never negative — they do not un-recover. */
  clauses: number;
  /** Set only where the tier actually moved. */
  respect?: { from: RespectTier; to: RespectTier };
  arm?: { from: string; to: string };
}

/** The five things the header draws, as they stand this instant. */
export interface Standing {
  treasury: number;
  discontent: number;
  clauses: number;
  respect: RespectTier;
  arm: string;
}

/**
 * A picture of the run, in plain data.
 *
 * Everything here is a number, a string, or an array of them — no `Map`, no
 * `Set`, no live reference into the world. That is what makes it safe to hand
 * to a template, diff between years, send over IPC, or snapshot in a test. A UI
 * built on live references has to be told when to re-read; a UI built on values
 * only has to be given a new one.
 */
export type SessionDecisionView = PendingDecisionView & {
  ambition?: AmbitionRelevance;
  /** #1867 §5: what each offered Record option costs, by the rules. Record dockets only. */
  stakes?: RecordStakes;
};

export interface SessionView {
  year: number;
  campaign: { id: CampaignId; name: string; startYear: number; endYear: number };
  generation: number;
  /**
   * THE HUMAN-SCALE CHAPTER (issue #213). The current question is fixed when
   * the sitting Head takes the seal; the previous answer was fixed when the
   * seal next changed hands, so neither can drift as later years move state.
   */
  generationArc?: {
    question: string;
    opened: number;
    kind: string;
    previous?: {
      question: string; answer: string; from: number; to: number;
      /** The tracked ambition, read the year the seal passed on (#1867 §5). */
      ambition?: string;
    };
  };
  /** The house's id — what content and saves refer to it by. */
  house: string;
  /** What it is CALLED. A client drawing `house` puts `house_gearithy` on the screen. */
  houseName: string;
  /** Issue #210. Selection is state; every progress number and direction below is derived. */
  ambition?: HouseAmbitionView;
  ambitionOptions: HouseAmbitionOption[];
  /**
   * #1867 §4: the plan the house's visible situation points at this year, and
   * why. Present from the opening, so the first ambition arrives with a reason;
   * recomputed every year, so it follows a succession, a crisis or a lost
   * candidate. Advice only — choosing it changes nothing but what is tracked.
   */
  ambitionRecommendation?: AmbitionRecommendation;
  /**
   * WHAT THE CONTENT CALLS THINGS. Attributes and traits arrive everywhere
   * else on this view as ids — `max_age`, `the_tutors_aphorisms` — because
   * that is what saves and claims refer to them by, and a client that printed
   * an id would be showing the player the inside of the database.
   *
   * They are here rather than in a client's own table because both lists are
   * open: an attribute is six loci and a row in `attributes.yaml` (invariant
   * 10), and a client holding a copy of either would keep working, correctly,
   * and quietly stop mentioning the twentieth.
   */
  attributes: { attr: string; name: string }[];
  traits: { trait: string; name: string }[];
  /**
   * THE RUN'S IDENTITY (issue #59). Determinism is per-world and carefully
   * kept, which makes the seed the one thing that names this run — and it
   * left the screen at `Begin` and never came back, so a player could not say
   * which run they had played, replay it, or report a bug against it.
   */
  seed: number;
  treasury: number;
  respect: RespectTier;
  discontent: number;
  clausesRecovered: number;
  clausesTotal: number;
  /**
   * WHAT IS HAPPENING TO THE WORLD (concept §20). One entry per Age currently
   * running.
   *
   * `name` is WITHHELD until the chronicle names it — `schema/src/age.ts`,
   * rule one: the family lives through the years first and gets a word for
   * them afterwards, and a client handed the name on the first day would
   * print "The Plague" over a year the house only knows as a bad one. It is
   * withheld HERE rather than asked of the client, for the same reason a
   * tale's `accuracy` is: a value on the view is a value somebody draws.
   *
   * `register` is not withheld. It is the mood of the years, which the family
   * can feel from inside them, and it is what the editor's drone reads.
   */
  ages: {
    age: string;
    began: number;
    /** Absent while the Age is still running. Set the year it closed. */
    ended?: number;
    register: Register;
    name?: string;
  }[];
  /** What matters strategically right now, deliberately stripped of Age names and dates. */
  agePressures: string[];
  /** Compact values used to read existing Match evidence in those same years. */
  ageMatchPriorities: AgeMatchPriority[];
  /** Which recurring Chronicle choice these years make easiest to rationalise. */
  ageRecordPriorities: AgeRecordPriority[];
  halls: HallView[];
  chronicle: ChronicleEntry[];
  interventions?: InterventionView[];
  /** Names on kept Chronicle pages, including ancestors outside the window and living halls.
   * This is a read-model index, not a new saved-world record. */
  chroniclePeople: { id: string; name: string }[];
  /** The frame (concept §2, issue #13) — separate from `chronicle` on purpose. See `world.frame`. */
  frame: FrameEntry[];
  docket: SessionDecisionView[];
  /**
   * The children the house is being asked to name, and WHY each one (issue
   * #62). Naming was 189 prompts a run and is now raised only where the
   * child is somebody; `because` is what makes that difference legible, and
   * a client that drew the prompt without it would have rebuilt the form.
   */
  namesWanted: { person: string; suggested: string; sex: string; born: number; because: string }[];
  /**
   * What the house no longer holds alone (`people/secrets.ts`). A client needs
   * this: a secret that is out is the one piece of the record the player can
   * neither write nor omit, and the year it is `told` it becomes something a
   * named house can prove.
   */
  looseSecrets: {
    secret: string;
    carrier: string;
    house: string;
    houseName: string;
    since: number;
    told?: number;
  }[];
  /**
   * WHAT ELSE IS BEING SAID (issue #14). The tales in circulation this year —
   * a rival house's chronicle, a ballad, a Church doctrine, a rhyme children
   * have. `world.tales` has been born, circulated, mutated and SAVED since
   * issue #14 shipped, and no client could see a word of it: `chronicle`,
   * `frame` and `looseSecrets` all surfaced and this did not, so `teller` and
   * `bias` — "required, not optional colour" per `schema/tale.ts` — reached
   * nobody.
   *
   * Only tales that have actually started circulating appear. A tale whose
   * event has fired but whose `circulatesFrom` year has not arrived is not yet
   * something anyone has heard.
   *
   * `accuracy` is DELIBERATELY not here. It is the authored answer to "how
   * much of this is true", and the game does not adjudicate between two
   * contradicting accounts in its own voice (AGENTS.md, "Do not") — there is
   * no narrator who knows, only Daveed, and he is not neutral. A client handed
   * `accuracy` could sort the accounts by truth, which is the one reading this
   * layer exists to refuse. The player gets the teller and the bias and weighs
   * them, exactly as they would a person.
   *
   * `claims` is not here either, for a duller reason: a `TaleDef`'s claims are
   * authored against a slot `Target` and are only meaningful once resolved
   * against the cast the tale's event fired with, which circulation state does
   * not carry. Resolving them is a real piece of work, not a field to copy.
   */
  tales: CirculatingTale[];
  /**
   * WHAT THE HOUSE HAS PLEDGED THAT IT DOES NOT YET HAVE (issue #17, #40).
   *
   * An unborn granddaughter promised at auction to acquire a book for an
   * affinity nobody in the family has, on the theory that the blood will come.
   * It has circulated and saved since the auction shipped and reached no
   * client at all — which is this repository's most-repeated failure, recorded
   * four separate times in `docs/BALANCE-LOG.md`.
   *
   * `lot` is what she was promised FOR, named rather than referenced: a
   * promise a client cannot explain is a line of bookkeeping.
   */
  marriagePromises: {
    house: string;
    houseName: string;
    year: number;
    lot: string;
    lotName: string;
  }[];
  guardian?: { id: string; name: string; since?: number };
  /**
   * The founder, as a client may name them (#1867): the name, and the form
   * that takes an object ("Let her decide"). Present from the first year,
   * where `guardian` waits until they have crossed over.
   */
  narrator?: { name: string; them: string };
  /**
   * THE MUSTER (issue #89, Stages 2-3 — #95, #97). Absent — not merely empty —
   * with no commitment standing, which is nearly always: #90 measures a
   * median gap of ~250 years between Wars. `muster()` is what a player
   * answers this with — `reinforce`, `buy` or `withdraw`, any year, no docket.
   * `positions` prices every position against the house as it stands today —
   * `none` included, per #97's own "a choice and not an absence".
   */
  muster?: {
    began: number;
    men: number;
    maxMen: number;
    officers: { person: string; name: string }[];
    position?: string;
    positionName?: string;
    credit: number;
    tide: number;
    positions: PositionOption[];
  };
  /**
   * HOW THE WORLD READS THE HOUSE (`assize.ts`). `pressure` runs from -1 (the
   * world can see you are failing, and is steadying you) to 1 (the world can
   * see you are ahead, and is charging you for it). `standing` is the arm
   * currently in force, and the three flags are whatever temporary mercy or
   * exaction is running this year.
   *
   * A client draws this. The whole design of the Assize is that it is EXPLICIT
   * — a hidden rubber band is a lie the player can feel and cannot name — so a
   * reading the client cannot show is the same system with its point removed.
   */
  /**
   * WHERE THE HOUSE STANDS ON THE LADDER (`ascension.ts`, concept §22).
   * `rung` falls when the man holding it dies; `best` never does. `blocked` is
   * the one thing most obviously in the way of the next rung, in words — a
   * client puts it under the rung, and it is the whole answer to "am I
   * winning?", which the player had no way to ask.
   */
  ascension: {
    rung: string;
    best: string;
    title: string;
    /**
     * THE HIGH-WATER MARK, IN WORDS AND WITH ITS YEAR (issue #50).
     *
     * `best` is a `Rung` id and `bestTitle` is what it is called. Both, because
     * a client that turned one into the other would be keeping a hand-written
     * copy of a closed union — and this one is §22's ladder, which is the last
     * union in the game that should have two spellings.
     *
     * `bestAt` is absent for a house that has never been on the ladder, which
     * is not a gap: `reachedAt` records the year a rung was first touched, and
     * `none` was never touched, it was where everybody started.
     */
    bestTitle: string;
    bestAt?: number;
    /** Canonical bottom-to-top ladder. Never infer a rung's name or order in a client. */
    rungs: { id: Rung; title: string; reachedAt?: number }[];
    /**
     * THE LADDER IS FROZEN (issue #1803): no man of the house has woken to the
     * Power, so no rung can move. Present only then. Derived from public facts
     * (`frozenLadder`), so a client may say so and offer to wait for the blood.
     */
    frozen?: FrozenLadder;
    /**
     * The next rung in the language of the world, not as a threshold list.
     * Absent only when the house has already reached God.
     */
    diagnosis?: {
      person?: string;
      name?: string;
      target: string;
      targetTitle: string;
      blockers: { kind: AscensionBlockerKind; text: string; hint: string }[];
      /** Named, public evidence and existing routes when power is the first blocker. */
      route?: PowerEvidenceRoute;
    };
    foremost?: { person: string; name: string; blocked?: string; power: number; spells: number };
  };
  /**
   * WHO THIS GENERATION IS ABOUT (`cast.ts`, issue #44). Five to seven people
   * out of seventy, each with the one fact that is true of them and of nobody
   * else in the house.
   *
   * It is on the view rather than behind a verb because it is a reading and
   * not an action, and it is derived on every read because it is a reading of
   * a household that changes every spring (invariant 6).
   */
  cast: CastMember[];
  assize: {
    pressure: number;
    arm: 'resents' | 'steadies' | 'indifferent';
    favour: boolean;
    mercy: boolean;
    exaction: boolean;
    /**
     * THE NAME THE SITTING HEAD IS BEING MEASURED AGAINST (issue #62).
     *
     * Present only where the player deliberately named him after a man who
     * held the seal before him. The bar `assizePressure` grades the house on
     * is higher for it, and invariant 13 does not allow a reading the player
     * can feel and cannot name — so it is here, in words, beside the
     * pressure it moves.
     */
    measuredAgainst?: { name: string; before: number };
  };
  /**
   * THE TERM, once it has arrived (issue #39). Present only after the collection year, which
   * is also the only condition under which `epilogue()` answers — a client
   * reads this to know the run is over and that one is waiting.
   */
  ending?: { id: EndingId; year: number };
}

export interface CirculatingTale {
  id: string;
  form: TaleForm;
  /** Always named. Never neutral. See `schema/tale.ts`. */
  teller: string;
  /** What the teller wants the listener to believe. */
  bias: string;
  text: string;
  /** The event this is an account of. Two accounts sharing this contradict each other. */
  about: string;
  /** The year it began circulating. */
  since: number;
  /** How far the telling has drifted since: one per `mutatesEveryYears` window. */
  mutations: number;
  /**
   * Present only for issue #70 memories. Both claim arrays are attributed
   * records; neither is hidden truth.
   */
  source?: { house: string; year: number; text: string };
  sourceClaims?: ResolvedClaim[];
  claims?: ResolvedClaim[];
}

export interface HallView {
  id: string;
  name: string;
  grievance: number;
  isSeat: boolean;
  members: MemberView[];
}

export interface MemberView {
  id: string;
  name: string;
  epithet?: string;
  sex: string;
  age: number;
  /**
   * Almost always `alive`, and the exception is the whole reason it is here:
   * §22's Vessel is CONSUMED, and *"the tree shows them greyed, with a mark
   * that is not the mark for death"*. The dead leave the halls — they are in
   * the chronicle, which is where a family keeps its dead — and this one
   * person does not, because the rite left something on the tree that the
   * house has to keep looking at.
   */
  status: PersonStatus;
  head: boolean;
  /** Known succession only: never inferred from an unwoken person's genome. */
  succession?: 'heir' | 'possible';
  /** Visible reasons this person matters to the current plan or house state. */
  relevance?: { reason: string }[];
  /**
   * The family found out what is in their blood — NOT that the Power
   * manifested in them. §11 times a daughter's Awakening by what she carries
   * rather than by what she can use, so most of the house's awakenings are
   * women's, by design. Read this with `expresses` or not at all (issue #78).
   */
  awakened: boolean;
  /** Absent until Awakening; thereafter whether the witnessed Power comes through them. */
  expresses?: boolean;
  /** Only ever nonzero where the person can express. See invariant 1. */
  madness: number;
  contract?: string;
  /** The authored career/post this person currently holds. Retainer contracts are separate. */
  post?: string;
  /**
   * WHO THEY WERE REALLY BORN TO, and who they are married to now. A tree is a
   * tree because of these — the halls used to arrive as three flat lists of
   * people with nothing joining them, so a client could draw a roster and
   * nothing else. Ids only; every parent still living is elsewhere in this
   * view, and a spouse who married in carries their name because a wife of
   * another house is not in any hall of ours.
   *
   * Real parentage sits out here beside the real `attrs`, and the CLAIMED
   * line sits inside `record` beside the claimed ones. Same split, same
   * reason: the tree draws the record and the hover shows the person.
   */
  parents: { mother?: string; father?: string };
  /**
   * WHO THEY ARE MARRIED TO NOW, and where she came from (issue #56).
   *
   * The pairing existed only as a line of text inside an opened card, so the
   * player's single most consequential recurring decision — who marries whom —
   * was invisible in the picture of the family. A woman married in from
   * another house sat in the roster between two of the house's own children as
   * an unrelated row.
   *
   * `marriedIn` and `house` are the half a tree needs to say what she is: §7's
   * whole marriage market is houses trading blood, and a spouse drawn without
   * the house she came from is the one fact about her that mattered.
   */
  spouse?: { id: string; name: string; marriedIn: boolean; house?: string };
  /** The REAL attributes. What hovering over a drifted sigil is meant to show (issue #19). */
  attrs: Record<string, number>;
  /**
   * What the chronicle SAYS — `RecordView`, derived fresh, folded down to the
   * one shape a UI actually draws. This is the primary reading: "the tree
   * draws the recorded person; hover shows the real one" (issue #19). Falls
   * back to the real attrs/traits/death for anyone the record has never
   * spoken about, so a UI can always draw `record` and never `attrs` for the
   * headline view.
   */
  record: {
    attrs: Record<string, number>;
    claimedTraits: string[];
    claimedDeath?: { year: number; cause: string };
    /**
     * The line the documents give them. A forged dowry moves this and not
     * `parents`, and `pedigreeF` is calculated off exactly this — so a tree
     * drawn from the record is the tree the family believes it has.
     */
    parents: { mother?: string; father?: string };
    /**
     * WHICH OF `attrs` THE RECORD HAS ACTUALLY SPOKEN ABOUT. The rest of that
     * map is the real value, filled in so a UI can always draw `record.attrs`
     * and never has to fall back itself — which is convenient and, drawn
     * unfiltered, a lie the other way: it would print a woman's Fecundity on
     * her card, and "nobody in the world has a number for it"
     * (`attributes.yaml`) is the whole reason the marriage market reads a LINE
     * instead. A client showing only what the family can honestly claim reads
     * this first.
     */
    claimed: string[];
  };
  /** Non-empty divergence — sigil drift. See `Sigil.vue`'s `drift` prop. */
  drift: boolean;
}

export interface InterventionView {
  year: number;
  page: string;
  actor: string;
  actorName: string;
  manifestation: string;
  receipt: string;
}
