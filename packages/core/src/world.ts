import type {
  AgeState, ArcInstance, AuctionState, BranchState, CampaignId, Content, EndingId, FrameEntry, FrequencyLedger, HeirloomState, HouseDef,
  LibraryBookState, LibraryMemory, LoggedDecision, LooseSecret, MarriagePromise, MusterState, ParcelState, PersonId, Relationship,
  RentPolicy, ResolvedClaim, RespectTier, RivalLineageState, TaleCirculationState, Year,
} from '@ed/schema';
import { emptyAuctionState } from '@ed/schema';
import { emptyAgeState, emptyFrequencyLedger, emptyMusterState } from '@ed/schema';
import { PersonStore } from './people/store.js';
import type { GeneticsCtx } from './people/factory.js';
import type { BearingEntry } from './bearing.js';
import type { PendingDecision } from './events/decisions.js';
import type { Rung } from './ascension.js';
import type { FriendName } from './people/friends.js';
import type { DelegationPreferences } from './delegation.js';

export interface ChronicleEntry {
  /**
   * Stable identity for the entry an outcome created (issue #8). Only set by
   * `applyOutcome` — the record layer is the reason it exists: `applyRecord`
   * used to find "the" entry for an event by `(eventId, year)`, which rewrote
   * the wrong line the moment one template fired twice in the same year.
   */
  id?: string;
  year: Year;
  /** Frequency decides how this renders: line | paragraph | page | illuminated. */
  weight: 'line' | 'paragraph' | 'page' | 'illuminated';
  title?: string;
  /** null prints as a dated blank line. The blank is a designed artefact. */
  text: string | null;
  eventId?: string;
  named: boolean;
  record?: 'record' | 'omit' | 'embellish';
  /**
   * Known to have existed, and gone: a dead cadet branch, a burned book, a
   * person nobody will mention again. Rendered grey (concept §6).
   */
  greyed?: boolean;
  /**
   * THE RUNG THIS PAGE ATTESTS (concept §22, issue #39). Written by
   * `tickAscension` when the house first stands somewhere it has not stood.
   *
   * It is on the ENTRY rather than read off `world.ascension` because at the term
   * the creditor reads the chronicle and not the world (§6). What the house
   * became and what its book can show are two different facts, and the whole
   * thesis of the game is the gap between them — so the ending asks the book.
   */
  rung?: Rung;
  /** Set when `record: 'embellish'` created a Discrepancy — links the two for `ChronicleQuery` (issue #10). */
  discrepancyId?: string;
  /**
   * What this entry actually CLAIMS, resolved against the cast it fired with
   * (issue #19). `RecordView` (`core/src/record.ts`) folds these across the
   * whole chronicle into what the family's record currently says about a
   * person — the one source of truth for sigil drift.
   */
  claims?: ResolvedClaim[];
  /** A standing preference answered this page (#219). */
  delegated?: string;
}

export type GenerationQuestionKind = 'unstable_heir' | 'thin_line' | 'record' | 'ledger' | 'branch' | 'match' | 'ascension';

/** Stable framing copied onto the reign that defines this human-scale generation (issue #213). */
export interface GenerationQuestion {
  kind: GenerationQuestionKind;
  opened: Year;
  baseline: number;
  signature: string;
  text: string;
  subject?: string;
  subjectName?: string;
}

export interface WorldState {
  seed: number;
  /** The product profile this run belongs to (issue #66). */
  campaign: CampaignId;
  year: Year;
  generation: number;
  playerHouse: string;

  people: PersonStore;
  houses: Map<string, HouseDef>;

  /**
   * Cadet branches, living and extinct (concept §16). Keyed by branch id; the
   * main hall is not in here, because it is not a branch — it is the house.
   */
  branches: Map<string, BranchState>;

  /**
   * RIVAL-HOUSE DESCENT (issue #24 item 6), keyed by house id. Grown by
   * `people/rivals.ts`'s `tickRivals`, on its own stream, for the houses
   * named in `RIVAL_LINEAGE_HOUSES`. Empty until the rivals phase first runs.
   */
  rivalLineages: Map<string, RivalLineageState>;

  treasury: number;
  respect: RespectTier;
  /**
   * The year standing last moved, in either direction. Respect decays without
   * maintenance (§17) and this is the clock it decays against — a house that
   * has done nothing worth telling anyone about for thirty years loses a tier.
   */
  respectChanged?: Year;
  discontent: number;

  /**
   * Hostility is an edge, not a type (concept §7). Keyed `from->to` by person
   * id. Grudges live on the edge and outlive both parties — see
   * `people/relationships.ts`.
   */
  relationships: Map<string, Relationship>;

  flags: Map<string, boolean | number | string>;
  knowledge: Set<string>;
  clausesRecovered: Set<string>;
  rumours: Map<string, { accuracy: number; spread: number; seededYear: Year }>;
  discrepancies: Map<string, { severity: string; provableBy: string[]; state: 'open' | 'proven' | 'buried' }>;
  /**
   * What walked out of the house in somebody's head (`people/secrets.ts`).
   * Append-only within a run: a secret that is out does not go back in, and
   * `told` records the year it stopped being only the carrier's.
   */
  looseSecrets: LooseSecret[];

  age: AgeState;
  arcs: Map<string, ArcInstance>;
  /** Heirlooms the house holds, by id, with their charges and cooldowns. */
  heirlooms: Map<string, HeirloomState>;
  /** The Library's shelf: physical spellbook copies the house holds, by id (issue #15). */
  library: Map<string, LibraryBookState>;
  /** Lots announced, sold, and lost — how a Discrepancy gets proven by purchase (issue #17). */
  auction: AuctionState;
  /** Marriage promises pledged as an auction bid currency (issue #17). */
  marriagePromises: MarriagePromise[];
  /**
   * Nested-tale circulation, by tale id (issue #14). A tale is born the year
   * the event it is `about` actually fires — `applyOutcome` does the writing,
   * because that is the one place an outcome commits. The `generation` phase
   * ticks whether it has started circulating and how many times it has
   * mutated since.
   */
  tales: Map<string, TaleCirculationState>;
  /**
   * Previous houses imported at bootstrap (issue #70). Narrative-only and
   * copied into the save so the external library is never consulted mid-run.
   */
  libraryMemories: LibraryMemory[];
  /** `first` is the year it was originally due, so retries cannot loop forever. */
  scheduled: { event: string; year: Year; first?: Year }[];
  /**
   * Books being read right now. A `spellbook` effect with `op: 'study'` puts
   * one here and the `library` phase takes it off when the year comes.
   *
   * This is the one piece of state that makes `studyYears` mean anything.
   * `world.scheduled` could not carry it: that schedules an EVENT, recast from
   * scratch when it comes due, and a study belongs to a particular person for
   * a length of time only that person's career knows.
   */
  studies: { person: PersonId; book: string; completes: Year }[];

  /** Frequency rationing for EVENTS: caps, cooldowns, drought, fire counts. */
  frequency: FrequencyLedger;
  /**
   * A SEPARATE ledger for people. Sharing one with events meant a rare event
   * firing barred rare character templates for fifty-five years, and minted
   * people were never recorded at all — so the mythic cap of three produced
   * five and a half per run.
   */
  characterFrequency: FrequencyLedger;

  chronicle: ChronicleEntry[];
  log: string[];

  /**
   * The Narrator. Daveed Gearithy while he lives, and Daveed Gearithy after,
   * because death does not remove him — it only changes what he is. The voice
   * of the chronicle shifts on the year he crosses over.
   */
  narrator?: string;
  guardianSince?: Year;

  /**
   * The year the sitting Head took the seal. Demigod Stagnation (§22) is about
   * TENURE — "each generation he remains Head" — and was measured off the
   * head's age instead, so a cousin who inherited at sixty and died at seventy
   * counted as a stagnant reign of ten years. It fired constantly once the
   * strength dimorphism let men live longer, and pinned the branches at
   * maximum grievance in every run.
   */
  headSince?: Year;

  /**
   * WHO HAS HELD THE SEAL, AND WHEN (issue #56).
   *
   * `castSlots` carries the seal and `ensureHead` strips it from everyone the
   * moment it seats somebody new, which is right — one head at a time — and
   * means nothing anywhere remembered the fourteen before him. The dead leave
   * the halls by design, so by 1400 a player had fourteen generations of
   * ancestors with no trace on any screen, in a game whose whole subject is
   * generational.
   *
   * The name is copied rather than looked up, because the player renames
   * newborns and this is a record of what the house called him WHEN HE HELD
   * IT. The id is here too, for anyone who wants the person.
   *
   * `to` is open on the sitting head and closed by the next succession, the
   * same shape a marriage uses.
   */
  succession: { person: PersonId; name: string; from: Year; to?: Year; question?: GenerationQuestion; answer?: string }[];

  /**
   * WARDSHIP (world §"Taxes"): "If an heir is under 16, the Warden may take
   * the estate's management until majority and keep the profits." Set the
   * year the seat falls vacant onto a rightful heir too young to hold it —
   * `heirApparent`'s own 16-year floor (deliberate, per `naming.ts`) means
   * nobody under that age has ever been offered the seal, so a minor whose
   * claim outranks every living adult's used to be skipped in silence and an
   * uncle or cousin sat in his place instead. `ensureHead` now checks the
   * age-blind heir first: if the true next-in-line is a minor, the seat
   * stays empty — nobody of the house holds `head` — and `boughtBack` decides
   * whether the land income (`tickEconomy`) reaches the treasury or is
   * diverted to the Warden. `ensureHead` clears this and seats the ward the
   * year he turns sixteen, or, if he dies first, falls through to whoever is
   * next in line at that point — a second minor included.
   */
  wardship?: { ward: PersonId; since: Year; boughtBack?: boolean };

  /**
   * Newborns of the house awaiting a name from the player. They already carry
   * a generated one, so nothing downstream can hold a nameless person — this
   * is an offer, not a blocker.
   */
  /**
   * THE ASSIZE (`assize.ts`) — what the world has noticed about the house, and
   * when it last did something about it.
   *
   * `pressure` is derived and re-measured every year; it is stored so that a
   * client and an authored condition can both read the same number the phase
   * acted on, rather than each recomputing it against a world that has moved.
   * The other four are genuine state: what the world has already done, and
   * which of its temporary mercies and exactions are still in force.
   */
  assize: {
    /** Last reading, in [-1, 1]. Positive is ahead of where a house should be. */
    pressure: number;
    /** The year the run opened. The expectation curve is measured off it. */
    openedAt: Year;
    /** Last year the Assize did anything at all. */
    lastSitting: Year;
    /** Response id -> the year it last happened. Cooldowns read this. */
    fired: Record<string, Year>;
    /** Cheaper hands at the Match, through this year. */
    favour?: Year;
    /** A physician in the house: gentler mortality, through this year. */
    mercy?: Year;
    /** Everything costs the house more, through this year. */
    exaction?: Year;
  };

  /**
   * WHEN THE HOUSE LAST WENT TO MARKET FOR SOMEBODY, by person id.
   *
   * A hand that is not taken — because the house cannot raise the dowry, or
   * because the player declined it — used to put the same person back on the
   * docket three years later, and again, and again. Once the Assize started
   * pricing cards against the purse this became visible: the Match went from
   * 38 hands a run to 90, nearly all of them the same few people being offered
   * to the same few houses. A house that could not close a match does not go
   * back to the market next season.
   */
  courted: Record<string, Year>;

  /**
   * THE HOUSE GOES TO MARKET FOR THIS PERSON NEXT (issue #132, Stage 2).
   *
   * Person ids, written by the `priorityMatch` effect and read by
   * `matchSubjects` (`people/match.ts`), which lets a flagged person skip
   * both the per-person and the house-wide cooldown and out-weighs anyone
   * else for the season's one hand. Cleared the day a hand is dealt for
   * them — the same shape `courted` uses, so a decline does not loop this
   * forever. Almost always empty: it exists at all only because "the last of
   * a line gets no priority in the Match" was true until it did.
   */
  priorityMatch: string[];

  /**
   * THE TABLE (`table.ts`) — standing orders the player has given the house.
   *
   * `tutoring` is §13's special education, paid for on the day it is ordered.
   * `bidCeiling` is how high the house goes at the next auction. `withheld` is
   * who is being kept off the marriage market, by person id and the year the
   * order was given — §7 says every daughter married outward is power leaving
   * the blood forever, and there was no way to decline to spend her.
   */
  tutoring: { person: string; attr: string; completes: Year }[];
  bidCeiling: number;
  withheld: Record<string, Year>;

  /**
   * THE LAND MARKET (issue #91, Phase B — #94). `lots` names a `ParcelDef`
   * the house does not hold (`foundingHolding: false`), what it costs, and
   * the year it is gone if the house does not take it — a permanent
   * catalogue would make land a savings account, so nothing here stands
   * forever. `tickLandMarket` (`core/src/land.ts`) opens and expires them;
   * the `buy` order is the only thing that empties one early.
   */
  landMarket: { lots: { parcel: string; price: number; closesYear: Year; reason: 'neighbour_short' | 'fair' }[] };
  /**
   * TERMS BOUGHT AGAINST A HELD PARCEL'S YIELD (issue #94), parallel to
   * `tutoring` — `parcel` names the live `ParcelState` id (not the def), so a
   * farm sold mid-improvement takes the unfinished work with it rather than
   * crediting whoever buys the def next.
   */
  landImprovements: { parcel: string; completes: Year }[];
  /**
   * THE STANDING ORDER ON RENTS (issue #94). `customary` is the steward's
   * floor — a house whose player never opens the table still behaves like a
   * house, and does not squeeze its tenants to do it. `hard` and `rack` buy
   * income at the cost of the discontent it costs anywhere else money is
   * pulled out of people who did not choose to give it (`economy.ts`'s own
   * debt-linked drift is the precedent for moving `discontent` outside an
   * assize sitting; invariant 13 is about assize being the only REACTIVE
   * judgment, not the only writer of the field).
   */
  rentsPolicy: RentPolicy;
  /**
   * GROUND THE HOUSE ONCE HELD AND DOES NOT (issue #96, Phase C). `sellParcel`
   * and `seizeParcel` (`land.ts`) append here before the live `ParcelState` is
   * dropped — without it a sold or seized parcel simply vanished, and the
   * plat's `lost` state (struck through, keeping its year and who let it go)
   * had nothing to draw.
   */
  lostParcels: { defId: string; name: string; place: string; year: Year; by: string }[];
  /**
   * THE ILLUMINATED DEED HAS FIRED (issue #96). Guards a `weight: 'illuminated'`
   * chronicle entry so it writes once, the first time held acreage crosses the
   * founding total by a real margin — see `tickPlatIllumination` in `land.ts`.
   */
  platIlluminated: boolean;

  /**
   * WHO THE STEWARD ACTED ON THIS YEAR, by person id (issue #127).
   *
   * `runStandingOrders` already knows exactly who finished a term, who was
   * set to a book and who was bought a post, and had nowhere to put it —
   * `year/phases.ts` called it as a statement and threw the answer away, so
   * no template could ever be cast on the man the steward actually acted on.
   * The `newly_placed` / `newly_taught` / `set_to_a_book` slot roles read
   * this, later the SAME year.
   *
   * Overwritten wholesale at the top of every `table` phase — last year's
   * answer is not this year's — but it is real simulation output, not
   * derived state (invariant 6), and it reaches the save format like
   * anything else on the world: a save taken between the `table` phase
   * writing it and `ambient`/`arcs` reading it later the same year must
   * reload the same answer rather than resetting it.
   */
  stewardYear: { taught: string[]; opened: string[]; placed: string[] };

  /**
   * BEARING (`bearing.ts`, concept §29) — how the house has carried itself,
   * as distinct from how it is doing.
   *
   * `score` is derived and re-measured every year; it is stored for the same
   * reason `assize.pressure` is, so a client and an authored condition read
   * the number the phase acted on rather than each recomputing it against a
   * world that has moved.
   *
   * `acts` is genuine state and has to be. Four of bearing's seven inputs are
   * live readings off things the world already holds, but a hand refused, a
   * person kept off the market and a cousin taken over an outsider all leave
   * NO trace once they are done — and they are the three the whole system is
   * about. The YEAR on each is load-bearing rather than bookkeeping: bearing
   * never charges for an act less than two generations old, and without the
   * year there is no way to know.
   */
  /**
   * The most of its own blood this house has ever had living at once.
   *
   * `demography.ts` reads it to tell a line that is DYING from one that is
   * merely young: a founding house of four has no buffer and is not in
   * trouble, and a house of four that used to be forty is the thing §23's
   * `broken_line` is about. Without it the small-line hazard punished every
   * run's first century — measured, it cost the batch a fifth of its grudges
   * and tipped an already-marginal outcome to never firing.
   */
  bloodHighWater: number;

  bearing: {
    score: number;
    acts: BearingEntry[];
    /**
     * THE WARNINGS NOBODY GAVE (§29 stage 3, issue #45).
     *
     * A house that carries itself stops being told things — the retainer's
     * warning, the steward's objection, the cadet's letter. The rule that
     * keeps that fair is the issue's own: *every warning withheld leaves a
     * trace the player can find later*, because suppressing information with
     * no recoverable trace is indistinguishable from bad dice.
     *
     * This is the trace, and it is state rather than a reading: the moment
     * passes, the scene resolves, and afterwards a year in which nobody spoke
     * looks exactly like a year in which there was nothing to say.
     */
    unheard: { year: Year; event: string }[];
  };
  /**
   * WHO THE HOUSE MARRIES WHEN THE PLAYER IS NOT ASKED (issue #41).
   *
   * The Match is one chapter beat a generation; the house makes five hundred
   * other marriages in a run, and until this field they were made with no
   * regard to the one thing §7 says marriage is for. `in` keeps the blood in
   * the family, `out` spends it for money and allies, and `as_it_falls` is
   * what the house did before anybody gave it an order — the default, and
   * byte-identical to it.
   */
  marriagePolicy: 'in' | 'out' | 'as_it_falls';

  /** Issue #210: one voluntary lens over existing state; progress is always derived. */
  houseAmbition: import('@ed/schema').HouseAmbitionId | null;

  /**
   * THE SCION (issue #61). Who the house has named to build the ladder on —
   * the one standing order in `TableOrder` about a PERSON rather than a
   * policy. `null` is the shipped default, and means what it did before this
   * existed: nobody's marriage, reading or tutoring is biased toward
   * concentrating the family's blood on one man rather than spreading it
   * evenly across the halls, and no post is refused him he would otherwise
   * be offered.
   *
   * Read by `preferred` (`people/demography.ts`), the Match and `table.ts`'s
   * steward (`runStandingOrders`, `placePosts`): whatever `marriagePolicy`
   * says for everybody else, the named scion marries IN and wins the
   * season's hand on a tie (Stage A); he reads first and reads the longest
   * useful book, is bought a term in mind before the die is asked, and holds
   * no post the steward would otherwise have placed him in (Stage B).
   *
   * Naming the next one after he dies is not automatic — see `scionVacant`
   * and `table.ts`'s `scion` order — because a programme that renamed itself
   * would not be a decision the player made.
   */
  scion: string | null;

  /**
   * THE PROGRAMME LAPSED, AND SAID SO (issue #61, Stage C). Set the year
   * `scion` stopped pointing at anybody still standing — dead, or become the
   * guardian — and cleared the moment the table is given a new `scion`
   * order, naming somebody or explicitly declining to.
   *
   * Without this, a scion's death would just go quiet: `preferred` and the
   * Match test identity, so a dead man's id simply stops matching anybody
   * and nothing else would ever say the programme had lapsed. Reading it is
   * how a client offers the one decision this design means to span
   * generations rather than silently doing nothing on the house's behalf.
   */
  scionVacant?: { was: string; wasName: string; since: Year };

  /**
   * THE HEIR (issue #61, Stage E4). The first God design asked for a living
   * Demigod AND a separate descendant who exceeded him. The household rite
   * now spends a two-rite Hierophant for a blood descendant, but the reason
   * to prepare a successor remains: a house
   * concentrating everything onto one Scion produces the first man and
   * starves the second by the same act — measured, 0 of 873 samples ever
   * put a second man within seven points of Demigod power under the
   * strongest single-Scion policy anyone could drive (issue #61's own
   * diagnosis). The house names a SECOND man to build alongside the first —
   * a father and son, or two brothers — so the pair is a programme rather
   * than a competition for the same books, the same tutor's terms and the
   * same season's hand.
   *
   * `null` is the shipped default, same as `scion`: nobody's marriage,
   * reading or tutoring carries a second concentration on top of the
   * first, and every rule the Scion gets, the heir gets one priority tier
   * behind him — never ahead, never in the same slot on the same year.
   * Cannot be named to the Scion's own person; a house does not build a
   * pair out of one man.
   */
  scionHeir: string | null;

  /**
   * THE HEIR'S PROGRAMME LAPSES OUT LOUD TOO (issue #61, Stage E4) — the
   * same reasoning as `scionVacant`, applied to the second name. `preferred`
   * and the Match test identity against `w.scionHeir` exactly as they do
   * against `w.scion`, so a dead heir's id would otherwise just stop
   * matching anybody with nothing left to say the programme had lost its
   * second man.
   */
  scionHeirVacant?: { was: string; wasName: string; since: Year };

  /**
   * THE ASCENSION LADDER (`ascension.ts`, concept §22). Six rungs, and none of
   * them existed in the code — the player's only answer to "am I winning?" was
   * a Respect tier that landed on exalted anyway.
   *
   * `rung` is where the house stands THIS year and falls when the man holding
   * it dies. `best` is the high-water mark and never falls, because a family
   * that made a Hierophant once made one. `reachedAt` is when each was first
   * touched, which is what an ending reads.
   */
  ascension: {
    rung: Rung;
    best: Rung;
    reachedAt: Partial<Record<Rung, Year>>;
  };

  /**
   * THE SIGNING (concept §3, issue #38). What the player chose in 1042, kept
   * across a Long Line so the epilogue can name which element it changed.
   *
   * Absent on a world nobody founded — the harness, the digest and every test
   * that calls `bootstrap` directly. The run is playable either way: what the
   * prologue sets is a house name, an object and a grudge, and the simulation
   * has defaults for all three. A client shows the prologue; a batch of two
   * hundred headless runs does not want to answer it two hundred times.
   */
  founding?: {
    /** What the player called the house. `houses.yaml` says what the world calls it. */
    houseName: string;
    /** The one thing the man asked for by name. Also in `heirlooms`, where it does its work. */
    heirloom: string;
    /** Who the house stepped on. Also a `Relationship` edge, where it does its work. */
    grudge: string;
    year: Year;
  };

  /**
   * THE FIVE NAMES (see `people/friends.ts`). Who the player could not have
   * done without, given at the signing and handed back out one at a time over
   * a Long Line.
   *
   * Empty on every world nobody founded, and empty is load-bearing: with no
   * name of a sex left in the bag `claimFriendName` draws nothing at all, so
   * the harness, the digest and every gate roll exactly the numbers they
   * rolled before this field existed.
   */
  friends: FriendName[];

  /**
   * WHERE THE LONG LINE LANDED (concept §23, issue #39). Set once, at the
   * term by `closeTheLedger`, and never again — the clock does not turn after
   * it, and a run that has ended stays ended across a save.
   */
  ending?: { id: EndingId; year: Year };

  pendingNames: {
    person: string;
    born: Year;
    suggested: string;
    sex: string;
    chosen?: string;
    /**
     * WHY THIS CHILD AND NOT THE OTHER FOUR (issue #62).
     *
     * Naming was 189 stops a run — 37% of everything the player was ever
     * asked — because every child of the seat raised one. It is now raised
     * only where the child is somebody, and this says who they are, in the
     * family's own terms: *"the Head has a son, and had none before today"*.
     *
     * Not optional, and not decoration. A prompt with no reason on it is
     * indistinguishable from the form this replaced: the player cannot tell
     * a child who matters from the next one in the queue, so they answer
     * both the same way. `nameWorthAsking` is the only thing that writes it,
     * and it never returns an empty one.
     */
    because: string;
  }[];

  /**
   * The docket: events waiting on the player. Unlike the naming queue this one
   * IS a blocker — `stepYear` will not advance a year while a decision stands,
   * because a choice resolved after its year has passed is not a choice.
   *
   * Empty in `autoResolve` mode, which is what the harness and the tests run.
   */
  pendingDecisions: PendingDecision[];

  /** Narrow, opt-in answers the player explicitly asked the house to repeat (#219). */
  delegation: DelegationPreferences;

  /**
   * INVARIANT 8. Id sequences live on the WORLD, never at module scope. Module-level
   * counters are shared across every simulation in the process, so two runs of
   * the same seed diverge as soon as a third run exists between them — and the
   * headless harness runs thousands. Determinism has to survive that or it is
   * not determinism.
   */
  counters: {
    person: number; mint: number; arc: number; branch: number; decision: number; grudge: number;
    chronicle: number; lot: number; parcel: number; muster: number; library: number; rival: number;
  };

  /**
   * The decision log (issue #8): every outcome, Record answer and rename that
   * had a genuinely external answer, in the order it happened. Append-only —
   * nothing in `core` ever removes an entry. See `schema/decision-log.ts`.
   */
  decisionLog: LoggedDecision[];

  /**
   * The frame layer (concept §2, Layer 1; issue #13). Its own array, kept off
   * `chronicle` on purpose — the chronicle is the family's own record,
   * written between 1042 and 1542; the frame is 1542 itself, reacting to that
   * record from outside it. It also rations on its own cadence, off a ledger
   * of its own, so a frame firing never steals an ambient event's budget
   * (invariant 7's shape: "ration separately").
   */
  frame: {
    /** The last year ANY frame event fired, for the minimum-gap cadence check. */
    lastFired: Year | null;
    /**
     * eventId -> the year it last fired. Drives `repeatable` and
     * `cooldownYears` — declared on every `EventTemplate` since the schema's
     * first draft and read by nothing in `core` until now (invariant 11: a
     * declared field nothing reads is a bug). Most interludes are a single
     * beat (`repeatable: false`); a few return, on their own cooldown, for as
     * long as the Discrepancy they react to stays open.
     */
    firedAt: Record<string, number>;
    entries: FrameEntry[];
  };

  /**
   * THE HOUSE'S LAND (concept §13, world §5/§12; issue #91, Phase A — #93;
   * bought and sold from Phase B — #94). One entry per parcel currently
   * held, keyed by parcel id. Seeded at bootstrap with the 1042 endowment
   * (`parcels.yaml`); `buy` mints an entry and `sell` deletes one from here
   * on. `land.ts`'s `landIncome` is the only reader that matters;
   * `economy.ts` no longer looks up income on the Respect tier alone.
   */
  parcels: Map<string, ParcelState>;

  /**
   * THE MUSTER (concept §6, world §10; issue #89, Stage 2 — #95). Dormant
   * for the overwhelming majority of a run — #90 measures a median gap of
   * ~250 years between Wars — so `commitments` sits empty and `tide` sits
   * at its middle for most of a house's life, and the `muster` phase draws
   * and writes nothing while it does. `land.ts`'s `landIncome`-and-`parcels`
   * split is the precedent: state a subsystem earns only when it is used.
   */
  muster: MusterState;
}

export function createWorld(content: Content, seed: number, startYear: Year, campaign: CampaignId = 'long'): WorldState {
  const playerHouse = content.houses.find((h) => h.isPlayerHouse)?.id ?? content.houses[0]?.id;
  if (!playerHouse) throw new Error('content declares no houses; there is nobody to play');

  // THE 1042 ENDOWMENT (issue #93). `id` is counter-generated off
  // `counters.parcel` itself, matching every other stateful thing in this
  // codebase (`nextBranchId`'s `w.counters.branch += 1`) rather than a
  // disconnected local — because Phase C mints parcels with no `ParcelDef`
  // behind them at all, and needs the same counter to still be live. `defId`
  // is what `landIncome` actually reads.
  //
  // ONLY `foundingHolding` DEFS MINT A STATE HERE (issue #94, Phase B). The
  // rest exist in content unheld, on purpose — they are the land market's
  // whole pool, and a def with no `ParcelState` behind it is exactly what
  // `buy` looks for.
  const counters = {
    person: 0, mint: 0, arc: 0, branch: 0, decision: 0, grudge: 0, chronicle: 0, lot: 0, parcel: 0, muster: 0, library: 0, rival: 0,
  };
  const parcels = new Map<string, ParcelState>();
  for (const def of content.parcels) {
    if (!def.foundingHolding) continue;
    const id = `prc_${(counters.parcel += 1).toString(36)}`;
    parcels.set(id, { id, defId: def.id, heldSince: startYear });
  }

  return {
    seed,
    campaign,
    year: startYear,
    generation: 0,
    playerHouse,
    people: new PersonStore(),
    houses: new Map(content.houses.map((h) => [h.id, h])),
    branches: new Map(),
    rivalLineages: new Map(),
    relationships: new Map(),
    treasury: 240,
    respect: 'known',
    discontent: 0,
    flags: new Map(),
    knowledge: new Set(),
    clausesRecovered: new Set(),
    rumours: new Map(),
    discrepancies: new Map(),
    looseSecrets: [],
    age: emptyAgeState(),
    arcs: new Map(),
    heirlooms: new Map(),
    library: new Map(),
    auction: emptyAuctionState(startYear),
    marriagePromises: [],
    tales: new Map(),
    libraryMemories: [],
    scheduled: [],
    studies: [],
    frequency: emptyFrequencyLedger(),
    characterFrequency: emptyFrequencyLedger(),
    chronicle: [],
    log: [],
    assize: { pressure: 0, openedAt: startYear, lastSitting: startYear, fired: {} },
    courted: {},
    priorityMatch: [],
    tutoring: [],
    bidCeiling: 0,
    withheld: {},
    landMarket: { lots: [] },
    landImprovements: [],
    rentsPolicy: 'customary',
    lostParcels: [],
    platIlluminated: false,
    stewardYear: { taught: [], opened: [], placed: [] },
    bloodHighWater: 0,
    bearing: { score: 0, acts: [], unheard: [] },
    friends: [],
    marriagePolicy: 'as_it_falls',
    houseAmbition: null,
    scion: null,
    scionHeir: null,
    ascension: { rung: 'none', best: 'none', reachedAt: {} },
    succession: [],
    pendingNames: [],
    pendingDecisions: [],
    delegation: { choices: {}, records: {} },
    counters,
    decisionLog: [],
    frame: { lastFired: null, firedAt: {}, entries: [] },
    parcels,
    muster: emptyMusterState(),
  };
}

/**
 * Everything a simulation function is allowed to reach for, and nothing else.
 *
 *   world     the mutable state of this run. The only thing that changes.
 *   content   the authored game, indexed. Read-only for the whole run.
 *   genetics  the locus table and population means, derived from content once.
 *   names     names already spoken for, so no two living people share one.
 *
 * A function taking `SimCtx` can be called from a test, the harness, the editor
 * and the game client without any of them knowing about the others.
 */
export interface SimCtx {
  world: WorldState;
  content: Content;
  genetics: GeneticsCtx;
  takenNames: Set<string>;
}

export function head(w: WorldState): ReturnType<PersonStore['living']>[number] | undefined {
  return w.people
    .living()
    .filter((p) => p.castSlots.includes('head'))
    .sort((a, b) => a.born - b.born)[0];
}

/**
 * Regency: a woman of the blood holds the house because no living son
 * expresses. She can defend, enrich, negotiate and arrange marriages with
 * precision. She cannot advance ascension by a point — nor accrue one of
 * Madness.
 *
 * There was a second implementation of this here that read raw allele effects
 * off haplotype zero, ignored dominance, and treated any unmaterialized genome
 * as non-expressing. Nothing called it, which is the only reason it never
 * produced a wrong answer. Expression is computed in exactly one place.
 */
export function inRegency(w: WorldState): boolean {
  return head(w)?.sex === 'female';
}
