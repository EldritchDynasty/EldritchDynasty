import type {
  CampaignId, Content, ContentBundle, EndingId, FrameEntry, LibraryRun, Person, PersonStatus, Register, ResolvedClaim, RespectTier,
  SavedGame, TaleForm, HouseAmbitionId,
} from '@ed/schema';
import { MAIN_BRANCH } from '@ed/schema';
import type { SimCtx, ChronicleEntry } from './world.js';
import { bootstrap, clearNamingQueue, keepSuggestedName, renameChild } from './sim.js';
import { stepYear } from './year/step.js';
import type { YearReport } from './year/report.js';
import { passageOf, type Passage } from './year/passage.js';
import {
  autoResolveAll, declineMatch, resolveChoice, resolveMatch, resolveRecord,
  type ChoiceResolution, type MatchResolution, type PendingDecision, type RecordOption,
  type RecordResolution,
} from './events/decisions.js';
import { adviceForDecision } from './advisers.js';
import type { SlotFill } from './events/slots.js';
import { branchOf, halls } from './people/branches.js';
import { phenotypeOf } from './people/factory.js';
import { headNamesake } from './people/naming.js';
import { visibleRecordView } from './record.js';
import { loadGame, saveGame } from './save.js';
import { assizeFavour } from './assize.js';
import { order, tableView, type OrderResult, type TableOrder, type TableView } from './table.js';
import { landView, nameParcel, type LandView } from './land.js';
import {
  activeCommitment, maxMen, musterOrder, positionOptions, type MusterOrder, type MusterOrderResult,
  type PositionOption,
} from './muster.js';
import { diagnoseHouseAscension, measureAscension, rungTitle, type AscensionBlockerKind } from './ascension.js';
import { castOf, type CastMember } from './cast.js';
import { foundHouse, prologueView, type FoundingChoice, type FoundingResult, type PrologueView } from './prologue.js';
import { epilogueOf, type EpilogueView } from './ending.js';
import { chapterOf, openingOf, type ChapterOpening, type ChapterView } from './chapter.js';
import { streamFor } from './rng.js';
import { campaignDef } from './campaign.js';
import { libraryRunOf } from './run-library.js';
import { ambitionOptions, ambitionView, type HouseAmbitionOption, type HouseAmbitionView } from './ambition.js';
import {
  activeMatchPriorities, activeRecordPriorities, strategicPressures,
  type AgeMatchPriority, type AgeRecordPriority,
} from './ages/strategy.js';

/**
 * THE SESSION: everything a client is supposed to need, and nothing else.
 *
 * `SimCtx` is the whole simulation — a person store, a content index, a locus
 * table, and forty exported functions that expect to be called in a particular
 * order. That is the right shape for the engine and the wrong shape for anything
 * outside it. The editor reached straight into `ctx.world`, kept its own
 * reactivity counter to notice mutations, and picked its own RNG seed for
 * resolving a choice; the game client does not exist yet, and whoever writes it
 * would have had to learn all of that first.
 *
 * A session is the seam. Six verbs, one read model, and a save:
 *
 *   advance      turn years, stopping the moment something needs an answer
 *   choose       answer a choice, casting anyone the event asked the player for
 *   send         name the party for a decision the party itself decides
 *   match        take one of the cards a marriage was dealt, or decline the hand
 *   record       Record / Omit / Embellish
 *   letHimDecide hand the pen back to the chronicler
 *   order        a standing order at the table: study, tutor, career, bid, withhold
 *   table        what the house can be told to do, and what it would cost
 *   name         name a newborn of the house
 *   found        answer the prologue: the house's name, and its two choices
 *   prologue     the signing, as plain values
 *   epilogue     the last night, once there has been one
 *   view         a plain, serialisable picture of the run right now
 *
 * The engine underneath is reachable as `.ctx` on purpose — the editor needs it
 * for previews, and a sealed façade would only get bypassed. But nothing in a
 * client should need it, and if something does, that is a missing verb here.
 */

export interface SessionOptions {
  seed?: number;
  campaign?: CampaignId;
  startYear?: number;
  /** Completed houses copied in once at bootstrap (issue #70). */
  libraryRuns?: readonly LibraryRun[];
  /**
   * `ask` parks choices on the docket and stops the clock — the game.
   * `chronicler` answers them in the same code path — the harness, and what a
   * player pressing "to the term" is asking for.
   */
  decider?: 'ask' | 'chronicler';
}

/**
 * THE ARM THE ASSIZE IS CURRENTLY HOLDING, from the pressure behind it.
 *
 * One function because there are now two readers — the view and the jump's
 * account (issue #54) — and a threshold with two spellings is a pair that
 * agrees until somebody tunes one of them.
 */
/** `-0` is a real IEEE value that does not survive JSON. Nothing here means it. */
function noNegativeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function assizeArm(pressure: number): 'resents' | 'steadies' | 'indifferent' {
  if (pressure > 0.35) return 'resents';
  if (pressure < -0.35) return 'steadies';
  return 'indifferent';
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
interface Standing {
  treasury: number;
  discontent: number;
  clauses: number;
  respect: RespectTier;
  arm: string;
}

function standingNow(ctx: SimCtx): Standing {
  const w = ctx.world;
  return {
    // Rounded the way the header rounds them, so a jump that moved the
    // treasury by a third of a crown does not report a change nobody can see.
    treasury: Math.round(w.treasury),
    discontent: Math.round(w.discontent),
    clauses: w.clausesRecovered.size,
    respect: w.respect,
    arm: assizeArm(w.assize.pressure),
  };
}

function standingBetween(before: Standing, after: Standing): StandingDelta {
  return {
    treasury: after.treasury - before.treasury,
    discontent: after.discontent - before.discontent,
    clauses: after.clauses - before.clauses,
    ...(before.respect !== after.respect ? { respect: { from: before.respect, to: after.respect } } : {}),
    ...(before.arm !== after.arm ? { arm: { from: before.arm, to: after.arm } } : {}),
  };
}

/** Whether anything in it is worth drawing. A jump that did nothing says nothing. */
export function standingMoved(d: StandingDelta): boolean {
  return d.treasury !== 0 || d.discontent !== 0 || d.clauses !== 0
    || d.respect !== undefined || d.arm !== undefined;
}

export interface AdvanceResult {
  years: YearReport[];
  /**
   * THE SAME YEARS, AS VALUES (issue #49).
   *
   * `years` carries live `Person` objects out of the world — fine for `core`,
   * which owns them, and unusable by a client, which must hold nothing that
   * changes under the render. So the account is folded down here as well, and
   * a client reads this and never `years`.
   *
   * Quiet years are absent rather than empty. See `passageOf`.
   */
  passages: Passage[];
  /**
   * A CHAPTER FOR EVERY AGE THAT CLOSED OVER EXACTLY THE YEARS TURNED (issue
   * #65). Folded here for the same reason `passages` is: a client asking
   * "did anything chapter-worthy happen in the years I just turned?" needs an
   * answer keyed to this call, not a poll against `view().ages` taken before
   * and after. Empty on a call that closed no Age, which is most of them —
   * `chapterOf` is derived and cheap to skip.
   */
  chapters: ChapterView[];
  /** An Age beginning, for every Age that began over exactly the years turned. See `chapters`. */
  opened: ChapterOpening[];
  /**
   * What the years cost or paid the house, over exactly the years turned. A
   * call that turned none reports zeroes and no tiers.
   */
  changed: StandingDelta;
  /** Why it stopped short, if it did. */
  stoppedBy?: 'decision';
  pending: PendingDecision[];
}

export class GameSession {
  decider: 'ask' | 'chronicler';

  constructor(readonly ctx: SimCtx, decider: 'ask' | 'chronicler' = 'ask') {
    this.decider = decider;
  }

  get year(): number {
    return this.ctx.world.year;
  }

  /**
   * Turn up to `years` years. Stops early — and says so — the moment the docket
   * is not empty, because the clock is already stopped at that point and
   * spinning the loop would only produce blocked reports.
   */
  advance(years = 1): AdvanceResult {
    const out: YearReport[] = [];
    const said: Passage[] = [];
    const chapters: ChapterView[] = [];
    const opened: ChapterOpening[] = [];
    // Taken before the first year and read again after the last, so the
    // account covers exactly the years turned — including none of them, which
    // is the case that must report nothing rather than nothing-shaped.
    const before = standingNow(this.ctx);
    for (let i = 0; i < years; i++) {
      if (this.ctx.world.pendingDecisions.length) {
        return {
          years: out,
          passages: said,
          chapters,
          opened,
          changed: standingBetween(before, standingNow(this.ctx)),
          stoppedBy: 'decision',
          pending: this.pending,
        };
      }
      const report = stepYear(this.ctx, this.decider === 'chronicler');
      out.push(report);
      // Folded HERE, while the report's people are the people it means. A
      // caller that kept the report and mapped it later would be reading a
      // person who has since aged, married and in one case stopped being one.
      const passage = passageOf(this.ctx, report);
      if (passage) said.push(passage);
      for (const id of report.agesBegan) {
        const beat = openingOf(this.ctx, id);
        if (beat) opened.push(beat);
      }
      // Every closing this exact year, matched back to the `EndedAge` object
      // `tickAges` just pushed — `report.agesEnded` is ids, and an id recurs
      // (an Age closes and, decades later, opens and closes again), so the id
      // alone cannot say which entry in `world.age.ended` is the one this year
      // produced.
      for (const id of report.agesEnded) {
        const ended = this.ctx.world.age.ended.find((e) => e.age === id && e.ended === report.year);
        if (!ended) continue;
        const chapter = chapterOf(this.ctx, ended);
        if (chapter) chapters.push(chapter);
      }
    }
    return {
      years: out,
      passages: said,
      chapters,
      opened,
      changed: standingBetween(before, standingNow(this.ctx)),
      pending: this.pending,
    };
  }

  get pending(): PendingDecision[] {
    return [...this.ctx.world.pendingDecisions];
  }

  /**
   * Answer a choice. The stream is derived from the decision's own id, so the
   * outcome a player gets does not depend on how long they took to answer, how
   * many times the client re-rendered, or what the editor previewed in between.
   */
  choose(decision: string, choiceId: string, cast: SlotFill = {}): ChoiceResolution {
    return resolveChoice(
      this.ctx,
      decision,
      choiceId,
      streamFor(this.ctx.world, 'decision', decision),
      cast,
    );
  }

  /**
   * Name the party and let what they are between them decide the rest — the
   * answer to a decision whose `choicesAreOpen` is false (`schema/src/decider.ts`,
   * the `party` kind). The player's decision was who goes; the branch follows
   * from the people he sent, through a `Check` pooled over exactly them.
   *
   * Same stream, same commit path, same everything as `choose`. The only
   * difference is which half of the answer the client supplies.
   */
  send(decision: string, cast: SlotFill = {}): ChoiceResolution {
    return resolveChoice(
      this.ctx,
      decision,
      undefined,
      streamFor(this.ctx.world, 'decision', decision),
      cast,
    );
  }

  /**
   * Take a card (concept §5, step 2). No stream: which card is on the table
   * was decided when the hand was dealt, and taking one has no roll in it —
   * the suitor a card promises is the suitor who arrives.
   */
  match(decision: string, cardId: string): MatchResolution {
    return resolveMatch(this.ctx, decision, cardId);
  }

  /** Take none of them. A real answer — the house waits for a better year. */
  declineHand(decision: string): boolean {
    return declineMatch(this.ctx, decision);
  }

  record(decision: string, option: RecordOption): RecordResolution {
    return resolveRecord(this.ctx, decision, option);
  }

  /** Hand the pen back. Answers everything standing, through the same commit path. */
  letHimDecide(): void {
    autoResolveAll(this.ctx, streamFor(this.ctx.world, 'chronicler'));
  }

  /**
   * THE TABLE (`table.ts`) — the first verbs on this surface the player uses on
   * a turn of their own choosing rather than in answer to a prompt.
   *
   * Everything else here answers the docket. The auction, the careers and the
   * library ticked without ever asking, which deleted §13's headline tension
   * ("tutor the child you have, or buy the book his grandchildren might read;
   * you can afford one") by having the simulation quietly decide both.
   */
  order(o: TableOrder): OrderResult {
    return order(this.ctx, o);
  }

  /** What the house can currently be told to do, and what it would cost. */
  table(): TableView {
    return tableView(this.ctx);
  }

  /** Issue #210: select, replace, or clear the one voluntary house ambition. */
  setAmbition(id: HouseAmbitionId | null): boolean {
    if (id !== null && !ambitionOptions(this.ctx.world.campaign).some((a) => a.id === id)) return false;
    this.ctx.world.houseAmbition = id;
    return true;
  }

  ambitionOptions(): HouseAmbitionOption[] {
    return ambitionOptions(this.ctx.world.campaign);
  }

  /**
   * THE LAND (issue #91, Phase B — #94) — held ground, what is on the market
   * today and what it costs, and what a term of improvement would cost.
   * `order`'s `buy`/`sell`/`rents`/`improve` are what a player answers this
   * with; it stays a verb of its own rather than folding into `table()`
   * because a client draws the two on one screen without them being one
   * object, the same way `jump()` sits beside `view()`.
   */
  land(): LandView {
    return landView(this.ctx);
  }

  /**
   * THE MUSTER (issue #89, Stage 2 — #95). `reinforce`/`withdraw`, any year,
   * from the panel — no docket. Entering a war and settling one are scripted
   * moments an authored event reaches; this is the standing order in
   * between, the same shape `order()` is for the table.
   */
  muster(order: MusterOrder): MusterOrderResult {
    return musterOrder(this.ctx, order);
  }

  name(personId: string, name: string): boolean {
    return renameChild(this.ctx, personId, name);
  }

  /**
   * NAME A PARCEL (issue #96, Phase C). The same cheap ownership hook as
   * `name()` above, pointed at ground instead of a newborn — a nickname for
   * an authored holding, or the only name a def-less one (an assart, a
   * drained strip) will ever have.
   */
  nameParcel(parcelId: string, name: string): boolean {
    return nameParcel(this.ctx, parcelId, name).ok;
  }

  /** Accept the chronicler's names for everyone waiting. Ignoring the offer is a valid way to play. */
  keepSuggestedNames(): void {
    clearNamingQueue(this.ctx);
  }

  /**
   * Accept his name for ONE child and leave the rest of the queue standing —
   * name the daughter, let him have the four sons (issue #53). All-or-nothing
   * was the only way to answer the queue, which made "keep the names he
   * suggests" the button a player pressed to get their clock back.
   */
  keepSuggestedName(personId: string): boolean {
    return keepSuggestedName(this.ctx, personId);
  }

  view(): SessionView {
    return viewOf(this.ctx);
  }

  /**
   * THE SIGNING (concept §3, issue #38), as plain values. Undefined for a
   * bundle with no prologue in it.
   *
   * A client shows this once, before the first year, and never again;
   * `founded` on the view says which of those two it is.
   */
  prologue(): PrologueView | undefined {
    return prologueView(this.ctx);
  }

  /**
   * Answer it: name the house, choose the thing the man asked for, and choose
   * who the house stepped on to be where it is. Refused, with a reason, for a
   * choice the prologue never offered — the ending names what was chosen, and
   * an ending naming something the prologue never said is a ring with a hole
   * in it.
   */
  found(choice: FoundingChoice): FoundingResult {
    return foundHouse(this.ctx, choice);
  }

  /**
   * THE LAST NIGHT (concept §23, issue #39). Undefined until the run has
   * reached the term — an epilogue for a house still living in 1400 is a
   * spoiler with a bug in it.
   */
  /**
   * THE WHOLE BOOK (issue #48).
   *
   * `view()` carries the last `VIEW_CHRONICLE_LINES` entries and its own
   * comment has always said what that leaves out — *"the whole book is a
   * separate read"* — and the separate read was never written. So a player
   * wrote a book across a Long Line and could see the last sixty lines of
   * it, while the only character who ever read the finished thing was the
   * creditor, in the epilogue, on the last night.
   *
   * A verb here rather than a peek at `ctx.world.chronicle`, because that is
   * the rule: if a client cannot get something through the seam, the missing
   * thing is a verb on this file.
   *
   * `from`/`to` are inclusive years and both optional — the whole volume is
   * the default, because the whole volume is the point. Entries come back in
   * the order they were written, which is the order a book is read in and the
   * reverse of the order the panel shows.
   */
  book(opts: { from?: number; to?: number } = {}): ChronicleEntry[] {
    const { from, to } = opts;
    return this.ctx.world.chronicle.filter(
      (e) => (from === undefined || e.year >= from) && (to === undefined || e.year <= to),
    );
  }

  /**
   * THE SPINE (issue #56). Who has held the seal since the signing, oldest
   * first, with what the book says became of each of them.
   *
   * The halls are the LIVING household and stay that way — the dead are in the
   * chronicle, which is where a family keeps its dead — so by 1400 a player
   * had fourteen generations of ancestors with no trace on any screen, in a
   * game whose whole subject is generational. This is deliberately not a
   * genealogy: one line, one name a generation, the seal and nothing else.
   *
   * `claimedDeath` is the RECORD's account, because a house that improved its
   * own history should meet the version it wrote. Where the book has said
   * nothing, the years are simply the years.
   */
  line(): {
    person: string;
    name: string;
    from: number;
    to?: number;
    born?: number;
    died?: number;
    /**
     * INVARIANT 3: the Narrator does not die. `kill` REDIRECTS him — status
     * `guardian`, never `alive` again — and it sets `died` on the way past, so
     * a reader that saw only the year would have the one man who did not die
     * dying in it, on the screen built to show the line back to the signing.
     */
    guardian?: boolean;
    claimedDeath?: { year: number; cause: string };
  }[] {
    const w = this.ctx.world;
    const household = w.people.household(w.playerHouse, w.year);
    return w.succession.map((held) => {
      const p = w.people.get(held.person);
      const said = p ? visibleRecordView(this.ctx, p.id, household) : undefined;
      return {
        person: held.person,
        name: held.name,
        from: held.from,
        ...(held.to !== undefined ? { to: held.to } : {}),
        ...(p?.born !== undefined ? { born: p.born } : {}),
        ...(p?.died !== undefined ? { died: p.died } : {}),
        ...(p?.status === 'guardian' ? { guardian: true } : {}),
        ...(said?.claimedDeath ? { claimedDeath: said.claimedDeath } : {}),
      };
    });
  }

  epilogue(): EpilogueView | undefined {
    return epilogueOf(this.ctx);
  }

  /** What this finished house may leave in the installation-level library. */
  libraryRun(): LibraryRun | undefined {
    return libraryRunOf(this.ctx);
  }

  save(): SavedGame {
    return saveGame(this.ctx);
  }
}

export function newGame(source: ContentBundle | Content, opts: SessionOptions = {}): GameSession {
  const ctx = bootstrap(source, opts.seed ?? 1042, opts.startYear ?? 1042, opts.campaign ?? 'long', opts.libraryRuns ?? []);
  return new GameSession(ctx, opts.decider ?? 'ask');
}

export function resumeGame(
  save: unknown,
  source: ContentBundle | Content,
  opts: SessionOptions = {},
): GameSession {
  return new GameSession(loadGame(save, source), opts.decider ?? 'ask');
}

// ── The read model ────────────────────────────────────────────────────────

/**
 * A picture of the run, in plain data.
 *
 * Everything here is a number, a string, or an array of them — no `Map`, no
 * `Set`, no live reference into the world. That is what makes it safe to hand
 * to a template, diff between years, send over IPC, or snapshot in a test. A UI
 * built on live references has to be told when to re-read; a UI built on values
 * only has to be given a new one.
 */
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
    previous?: { question: string; answer: string; from: number; to: number };
  };
  /** The house's id — what content and saves refer to it by. */
  house: string;
  /** What it is CALLED. A client drawing `house` puts `house_gearithy` on the screen. */
  houseName: string;
  /** Issue #210. Selection is state; every progress number and direction below is derived. */
  ambition?: HouseAmbitionView;
  ambitionOptions: HouseAmbitionOption[];
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
  /** The frame (concept §2, issue #13) — separate from `chronicle` on purpose. See `world.frame`. */
  frame: FrameEntry[];
  docket: PendingDecision[];
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
  /**
   * The family found out what is in their blood — NOT that the Power
   * manifested in them. §11 times a daughter's Awakening by what she carries
   * rather than by what she can use, so most of the house's awakenings are
   * women's, by design. Read this with `expresses` or not at all (issue #78).
   */
  awakened: boolean;
  /**
   * Whether the Power actually comes through them: `canExpress`, computed
   * where it is always computed and carried out here so no client ever
   * recomputes it. Invariant 4 gives it one home, and `sex === 'male' &&
   * awakened` is a second one — correct today, and a hand-written copy of a
   * closed rule the moment anything about the font changes.
   *
   * A woman is `awakened: true, expresses: false` and that is the ordinary
   * case, not a defect: she reads and she carries, and the risk was never
   * hers (§10). A client drawing one mark for both states the opposite of §7.
   */
  expresses: boolean;
  /** Only ever nonzero where the person can express. See invariant 1. */
  madness: number;
  contract?: string;
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

/** How much of the chronicle a view carries. The whole book is a separate read. */
export const VIEW_CHRONICLE_LINES = 60;

/**
 * The tales the world can currently hear, as values.
 *
 * Ordered by the year each began circulating, then by id — a view is a
 * picture, and a picture that reshuffles between two reads of an unchanged
 * world is a UI that jumps for no reason. Map iteration order would have given
 * insertion order, which is the order the events happened to fire in.
 */
function circulatingTales(ctx: SimCtx): CirculatingTale[] {
  const out: CirculatingTale[] = [];
  for (const [id, state] of ctx.world.tales) {
    if (!state.circulating) continue;
    // Content edited out from under a save — the same guard `tickTales` uses.
    const def = ctx.content.tale(id);
    if (!def) continue;
    out.push({
      id,
      form: def.form,
      teller: def.teller,
      bias: def.bias,
      text: def.text,
      about: def.about,
      since: state.circulatesFrom,
      mutations: state.mutations,
    });
  }
  for (const memory of ctx.world.libraryMemories) {
    out.push({
      id: memory.id,
      form: memory.form,
      teller: memory.teller,
      bias: memory.bias,
      text: memory.text,
      about: memory.about,
      since: memory.since,
      mutations: memory.mutations,
      source: { house: memory.sourceHouse, year: memory.sourceYear, text: memory.sourceText },
      sourceClaims: memory.sourceClaims.map((claim) => ({ ...claim })),
      claims: memory.claims.map((claim) => ({ ...claim })),
    });
  }
  out.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export function viewOf(ctx: SimCtx, chronicleLines = VIEW_CHRONICLE_LINES): SessionView {
  const w = ctx.world;
  const guardian = w.people.guardian();

  // A sign-reader anywhere in the house helps read the whole house's record
  // (issue #19) — reveal_signs is a household presence effect, the same
  // scope every other trait of its kind uses.
  const wholeHousehold = w.people.household(w.playerHouse, w.year);

  /**
   * THE ONE PERSON WHO DOES NOT LEAVE THE HALL (§22, issue #43).
   *
   * `halls` is the SIMULATION's grouping and it is the living household —
   * crowding, casting and succession all read it, and a consumed woman must
   * not be marriageable. So the tree's copy of a hall is the living one plus
   * anybody the rite took out of it, and `status` is how a client tells them
   * apart. Nowhere else in the game does a person stay on the tree after they
   * stop being in the house, which is the point of the mark.
   */
  const consumedByHall = new Map<string, Person[]>();
  for (const p of w.people.all()) {
    if (p.status !== 'vessel_consumed') continue;
    const key = branchOf(w, p, p.died ?? w.year);
    consumedByHall.set(key, [...(consumedByHall.get(key) ?? []), p]);
  }

  const namesake = headNamesake(ctx);
  const hallViews: HallView[] = [];
  for (const [id, living] of halls(w, w.year)) {
    const members = [...living, ...(consumedByHall.get(id) ?? [])];
    const branch = w.branches.get(id);
    hallViews.push({
      id,
      name: branch?.name ?? 'the main hall',
      grievance: branch?.grievance ?? 0,
      isSeat: id === MAIN_BRANCH,
      members: members.map((p) => {
        const ph = phenotypeOf(p, ctx.genetics, w.year);
        const realAttrs = Object.fromEntries(ph.attrs);
        const view = visibleRecordView(ctx, p.id, wholeHousehold);
        // The marriage still open, if there is one. A widow whose husband
        // died is not married to him any more — `PersonStore.kill` closes the
        // record on both sides — so `to === undefined` is the whole test.
        const wed = p.marriages.find((x) => x.to === undefined);
        const spouse = wed ? w.people.get(wed.spouse) : undefined;
        const m: MemberView = {
          id: p.id,
          name: p.name,
          sex: p.sex,
          age: (p.died ?? w.year) - p.born,
          status: p.status,
          head: p.castSlots.includes('head'),
          awakened: p.awakening.awakened,
          expresses: ph.eldritch.canExpress,
          madness: p.madness,
          attrs: realAttrs,
          parents: { ...p.trueParents },
          record: {
            // The claimed value where the record has spoken; the real one
            // otherwise, so a UI can always draw `record.attrs` for the
            // headline view and never has to fall back itself.
            attrs: { ...realAttrs, ...Object.fromEntries(view.attrs) },
            claimedTraits: [...view.claimedTraits],
            claimedDeath: view.claimedDeath,
            parents: { ...p.claimedParents },
            claimed: [...view.attrs.keys()],
          },
          drift: view.divergence.size > 0,
        };
        if (p.epithet !== undefined) m.epithet = p.epithet;
        if (p.contract) m.contract = p.contract.role;
        if (spouse) {
          const marriedIn = spouse.houseOfOrigin !== w.playerHouse;
          m.spouse = {
            id: spouse.id,
            name: spouse.name,
            marriedIn,
            // Named only where she came from somewhere else. "of our own house"
            // is not a thing anybody says about their own daughter.
            ...(marriedIn
              ? { house: ctx.content.house(spouse.houseOfOrigin)?.name ?? spouse.houseOfOrigin }
              : {}),
          };
        }
        return m;
      }),
    });
  }

  const campaign = campaignDef(w.campaign);
  const view: SessionView = {
    year: w.year,
    campaign: { id: campaign.id, name: campaign.name, startYear: campaign.startYear, endYear: campaign.endYear },
    generation: w.generation,
    ...(() => {
      const current = w.succession.at(-1);
      if (!current?.question) return {};
      const previous = w.succession.length > 1 ? w.succession[w.succession.length - 2] : undefined;
      return {
        generationArc: {
          question: current.question.text,
          opened: current.question.opened,
          kind: current.question.kind,
          ...(previous?.question && previous.answer && previous.to !== undefined
            ? {
              previous: {
                question: previous.question.text,
                answer: previous.answer,
                from: previous.from,
                to: previous.to,
              },
            }
            : {}),
        },
      };
    })(),
    house: w.playerHouse,
    // What the PLAYER called it, where there was a player to call it anything.
    // `houses.yaml` is what the world calls the house; `founding` is what the
    // family does, and the family's name for itself is the one on the page.
    houseName: w.founding?.houseName ?? w.houses.get(w.playerHouse)?.name ?? w.playerHouse,
    ...(ambitionView(ctx) ? { ambition: ambitionView(ctx)! } : {}),
    ambitionOptions: ambitionOptions(w.campaign),
    attributes: ctx.content.attributes.map((a) => ({ attr: String(a.id), name: a.name })),
    traits: ctx.content.traits.map((t) => ({ trait: String(t.id), name: t.name })),
    seed: w.seed,
    treasury: Math.round(w.treasury),
    respect: w.respect,
    discontent: Math.round(w.discontent),
    clausesRecovered: Math.min(w.clausesRecovered.size, campaign.clauses),
    clausesTotal: campaign.clauses,
    // THE FINISHED ONES TOO (issue #81). A reading pane covering a thousand
    // years is almost entirely finished Ages, and until `ended` carried the
    // named flag there was no way to draw them without either naming Ages the
    // house never named or refusing to draw any of them at all.
    //
    // Oldest first, and the running ones last, so the list reads as the
    // house's own history rather than as two lists stapled together.
    ages: [
      ...w.age.ended.map((a) => ({ ...a, active: false })),
      ...w.age.active.map((a) => ({ ...a, ended: undefined, active: true })),
    ].sort((a, b) => a.began - b.began).flatMap((a) => {
      const def = ctx.content.age(a.age);
      if (!def) return [];
      return [{
        age: a.age,
        began: a.began,
        register: def.register,
        ...(a.ended !== undefined ? { ended: a.ended } : {}),
        ...(a.named ? { name: def.name } : {}),
      }];
    }),
    agePressures: strategicPressures(ctx),
    ageMatchPriorities: activeMatchPriorities(ctx),
    ageRecordPriorities: activeRecordPriorities(ctx),
    halls: hallViews,
    chronicle: w.chronicle.slice(-chronicleLines),
    // COPIED, like every other array on this object. This one line handed the
    // caller `world.frame.entries` itself, so a view taken before the clock
    // moved grew a new interlude when it moved — `session.test.ts` calls that
    // "the old view changed when the world did", and it stayed invisible for
    // as long as a sixty-year window rarely contained an interlude. More frame
    // content made it visible; it was always wrong.
    frame: [...w.frame.entries],
    docket: w.pendingDecisions.map((decision) => ({
      ...decision,
      advice: adviceForDecision(ctx, decision),
    })),
    namesWanted: w.pendingNames.map((n) => ({
      person: n.person, suggested: n.suggested, sex: n.sex, born: n.born, because: n.because,
    })),
    tales: circulatingTales(ctx),
    marriagePromises: w.marriagePromises.map((p) => ({
      house: p.toHouse,
      houseName: w.houses.get(p.toHouse)?.name ?? p.toHouse,
      year: p.year,
      lot: p.lot,
      // A lot is a spellbook, an heirloom, or a page of somebody's chronicle.
      // Whichever it is, the family knows what it gave a daughter for.
      lotName: ctx.content.spellbook(p.lot)?.name
        ?? ctx.content.heirloom(p.lot)?.name
        ?? p.lot,
    })),
    ascension: {
      rung: w.ascension.rung,
      best: w.ascension.best,
      title: rungTitle(w.ascension.rung),
      bestTitle: rungTitle(w.ascension.best),
      ...(w.ascension.reachedAt[w.ascension.best] !== undefined
        ? { bestAt: w.ascension.reachedAt[w.ascension.best]! }
        : {}),
      ...(() => {
        const measured = measureAscension(ctx);
        const f = measured.foremost;
        const diagnosis = diagnoseHouseAscension(measured);
        return {
          ...(f
            ? {
              foremost: {
                person: f.person,
                name: f.name,
                ...(f.standing.blocked !== undefined ? { blocked: f.standing.blocked } : {}),
                power: f.standing.power,
                spells: f.standing.spells,
              },
            }
            : {}),
          ...(diagnosis
            ? {
              diagnosis: {
                ...(diagnosis.person !== undefined ? { person: diagnosis.person } : {}),
                ...(diagnosis.name !== undefined ? { name: diagnosis.name } : {}),
                target: diagnosis.target,
                targetTitle: diagnosis.targetTitle,
                blockers: diagnosis.blockers.map((blocker) => ({ ...blocker })),
              },
            }
            : {}),
        };
      })(),
    },
    cast: castOf(ctx),
    assize: {
      // ROUNDED, AND NOT TO NEGATIVE ZERO.
      //
      // `Math.round(-0.004 * 100) / 100` is `-0`, and `JSON.stringify(-0)` is
      // `"0"` — so a view carrying it stops surviving its own round trip, and
      // `Object.is(-0, 0)` is false, so every equality check on a saved-and-
      // reloaded view fails on a number that reads identically in both. The
      // read model is plain data by contract; `-0` is not plain data.
      pressure: noNegativeZero(Math.round(w.assize.pressure * 100) / 100),
      arm: assizeArm(w.assize.pressure),
      favour: assizeFavour(ctx, 'favour'),
      mercy: assizeFavour(ctx, 'mercy'),
      exaction: assizeFavour(ctx, 'exaction'),
      ...(namesake ? { measuredAgainst: { name: namesake.name, before: namesake.before } } : {}),
    },
    looseSecrets: w.looseSecrets.map((l) => ({
      secret: l.secret,
      carrier: l.carrierName,
      house: l.house,
      houseName: w.houses.get(l.house)?.name ?? l.house,
      since: l.since,
      ...(l.told !== undefined ? { told: l.told } : {}),
    })),
  };

  if (w.ending) view.ending = { ...w.ending };

  if (guardian) {
    view.guardian = {
      id: guardian.id,
      name: guardian.name,
      ...(w.guardianSince !== undefined ? { since: w.guardianSince } : {}),
    };
  }

  const commitment = activeCommitment(ctx);
  if (commitment) {
    const positionName = commitment.position !== undefined
      ? ctx.content.position(commitment.position)?.name
      : undefined;
    view.muster = {
      began: commitment.began,
      men: commitment.men,
      maxMen: maxMen(ctx),
      officers: commitment.officers.flatMap((id) => {
        const p = w.people.get(id);
        return p ? [{ person: p.id, name: p.name }] : [];
      }),
      ...(commitment.position !== undefined ? { position: commitment.position } : {}),
      ...(positionName !== undefined ? { positionName } : {}),
      credit: Math.round(commitment.credit * 100) / 100,
      tide: w.muster.tide,
      positions: positionOptions(ctx),
    };
  }

  return view;
}

/** Which hall a person is in this year. Exposed because a client will ask. */
export function hallOf(ctx: SimCtx, personId: string): string | undefined {
  const p = ctx.world.people.get(personId);
  return p ? branchOf(ctx.world, p, ctx.world.year) : undefined;
}
