import type { CampaignId, Content, ContentBundle, LibraryRun, Person, SavedGame, PrimordialRecord, HouseAmbitionId, ProseMode, ProseVariant, RunLibrary, SessionCommand, } from '@ed/schema';
import { FounderIdentityError, MAIN_BRANCH, RUNG_ORDER, assertNever, resolveFounder, SessionCommandS, TableOrderS, MusterOrderS } from '@ed/schema';
import type { SimCtx, ChronicleEntry } from './world.js';
import { bootstrap, clearNamingQueue, keepSuggestedName, renameChild, type BootstrapSigning } from './sim.js';
import { stepYear } from './year/step.js';
import type { YearReport } from './year/report.js';
import { passageOf, type Passage } from './year/passage.js';
import { autoResolveAll, declineMatch, resolveChoice, resolveMatch, resolveRecord, type ChoiceResolution, type MatchResolution, type PendingDecision, type RecordOption, type RecordResolution, } from './events/decisions.js';
import {
  adviceFor, adviceForDecision,
  type AdviserAdvice, type HelpSurface, type HelpTier,
} from './advisers.js';
import type { SlotFill } from './events/slots.js';
import { branchOf, halls } from './people/branches.js';
import { knownToExpress, phenotypeOf } from './people/factory.js';
import { headNamesake } from './people/naming.js';
import { formOf } from './people/grammar.js';
import { visibleRecordView } from './record.js';
import { chronicleReading, generationChangesOf, type GenerationChanges } from './people/generation-changes.js';
export type { GenerationChange, GenerationChangeKind, GenerationChanges } from './people/generation-changes.js';
import { loadGame, saveGame } from './save.js';
import { marriagePromiseLotName } from './auction.js';
import { assizeFavour } from './assize.js';
import { order, tableView, type OrderResult, type TableOrder, type TableView } from './table.js';
import { landView, nameParcel, type LandView } from './land.js';
import { activeCommitment, maxMen, musterOrder, positionOptions, type MusterOrder, type MusterOrderResult, } from './muster.js';
import { diagnoseHouseAscension, frozenLadder, visibleAscensionRanking, rungTitle } from './ascension.js';
import { castOf } from './cast.js';
import { examinationAnswerFallback, foundHouse, prologueView, type FoundingChoice, type FoundingResult, type PrologueView } from './prologue.js';
import { msg } from './messages.js';
import { shareCodeOf, type ShareCodeOptions, type ShareCodeResult } from './share-code.js';
import { matchFuture, type MatchCard, type MatchFutureKind, type MatchFutureReading } from './people/match.js';
import { visibleWakings, type PanelWaking } from './people/panel.js';
import { eligibleToMarry } from './people/demography.js';
import { epilogueOf, type EpilogueView } from './ending.js';
import { achievementView, earnedAchievements, type AchievementView } from './achievements.js';
import { chapterOf, openingOf, type ChapterOpening, type ChapterView } from './chapter.js';
import { streamFor } from './rng.js';
import { campaignDef } from './campaign.js';
import { libraryRunOf } from './run-library.js';
import { ambitionOptions, ambitionRelevance, ambitionView, recommendAmbition, type HouseAmbitionOption, } from './ambition.js';
import { activeMatchPriorities, activeRecordPriorities, strategicPressures, } from './ages/strategy.js';
import { resolveDelegated } from './delegation.js';
import { recordStakes } from './record-stakes.js';
import { answeredBy as answeredByPage, causeOf as causeOfPage, type ChronicleCause } from './cause.js';
import { answerPages } from './events/answers.js';
import { knownSuccession } from './people/succession.js';
import { relevantPeople } from './people/relevance.js';
import {
  createProseRuntime, proseForContentField, proseForTale, setProseMode as setRuntimeProseMode, setProseVariants,
  type ProseRuntime,
} from './prose.js';
import type { RecordedMilestone, PowerEvidenceRoute, StandingDelta, Standing, SessionDecisionView, SessionView, CirculatingTale, HallView, MemberView, InterventionView, ChronicleView } from './session-view-types.js';
export type { ChronicleView, RecordedMilestone, PowerEvidenceRoute, StandingDelta, SessionDecisionView, SessionView, CirculatingTale, HallView, MemberView, InterventionView } from './session-view-types.js';

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
 *   shareCode    the founding as a code a friend can begin from, and nothing after it
 *   prologue     the signing, as plain values
 *   epilogue     the last night, once there has been one
 *   view         a plain, serialisable picture of the run right now
 *
 * The engine underneath is reachable as `.ctx` on purpose — the editor needs it
 * for previews, and a sealed façade would only get bypassed. But nothing in a
 * client should need it, and if something does, that is a missing verb here.
 */

/** Public waking records, never a reading of an unwoken man's capacity. */
function wakingEvidence(ctx: SimCtx, rows: PanelWaking[]): string[] {
  return rows.filter((row) => row.sex === 'male').map((row) => msg(ctx,
    'ascension.route.waking', '{NAME}, {RELATION}, woke in {YEAR}.',
    { NAME: row.name, RELATION: row.relation, YEAR: String(row.year) }));
}

function powerEvidenceRoute(ctx: SimCtx): PowerEvidenceRoute {
  const w = ctx.world;
  const daughters = w.people.household(w.playerHouse, w.year)
    .filter((p) => p.sex === 'female' && eligibleToMarry(ctx, p)
      && branchOf(w, p, w.year) === MAIN_BRANCH
      && p.membership.some((m) => m.house === w.playerHouse && m.kind === 'blood'))
    .flatMap((p) => {
      const evidence = wakingEvidence(ctx, visibleWakings(ctx, p)
        .filter((row) => row.kin === 'father' || row.kin === 'brother'));
      return evidence.length ? [{ person: p.id, name: p.name, evidence }] : [];
    }).slice(0, 3);
  // Only link cards the client can actually open now. Later docket items stay
  // behind the current decision, just as they do everywhere else in the UI.
  const decision = w.pendingDecisions[0];
  const cards: PowerEvidenceRoute['cards'] = [];
  const alternatives: PowerEvidenceRoute['alternatives'] = [];
  if (decision?.kind === 'match') {
    for (const card of decision.cards.filter((c) => c.available)) {
      const future = matchFuture(card, activeMatchPriorities(ctx), (key, original, values) =>
        matchFutureMessage(ctx, key, original, values));
      const evidence = card.sex === 'female' ? wakingEvidence(ctx, card.panel.woken) : [];
      const link = { decision: decision.id, card: card.id, name: card.name, label: future.label };
      if (evidence.length) cards.push({ ...link, evidence: future.kind === 'blood'
        ? evidence : [...evidence, ...future.reasons] });
      else if (future.kind === 'continuity' || future.kind === 'standing') {
        alternatives.push({ ...link, evidence: future.reasons });
      }
    }
  }
  return {
    title: msg(ctx, 'ascension.route.title', 'The blood, in witnessed lives'),
    rule: msg(ctx, 'ascension.route.rule',
      "A son's blood comes through his mother. A father passes his blood to his daughters. Look to the wakings recorded around a possible bride."),
    caution: msg(ctx, 'ascension.route.caution',
      'A waking is evidence about a line, not a promise about a child. Birth history and kinship are separate readings; neither proves that the blood will wake.'),
    daughters,
    cards,
    alternatives,
    ...(!cards.length ? { none: msg(ctx, 'ascension.route.no_match',
      'No open Match offers a bride with a witnessed waking in her line. Keep the women of the house in view, and read the next hand when it comes; no year is promised.') } : {}),
  };
}

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
  /** Prospective wording only; deliberately not persisted in the save. */
  proseMode?: ProseMode;
  /** Alternate authored wording supplied by the host/editor for this runtime. */
  proseVariants?: readonly ProseVariant[];
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

interface FoundingBootstrap {
  startYear: number;
  /** `prose` is the reader's setting NOW: the founding page is written inside the rebuild. */
  build(signing: BootstrapSigning, prose: ProseRuntime): SimCtx;
}


/**
 * Auditable, literal-core-message catalogue for the post-scoring Match reading.
 * Dynamic msg() keys are intentionally forbidden: the localisation worklist
 * must be able to find every Original template and fingerprint it. This switch
 * is therefore explicit, and asserts it still agrees with the pure scorer's
 * original text if an author changes one without updating the other.
 */
function matchFutureMessage(
  ctx: SimCtx,
  key: string,
  original: string,
  values?: Readonly<Record<string, string>>,
): string {
  const checked = (expected: string, translated: string): string => {
    if (expected !== original) throw new Error(`Match future text drift: ${key}`);
    return translated;
  };
  switch (key) {
    case 'match.future.label.blood':
      return checked('Blood', msg(ctx, 'match.future.label.blood', 'Blood', values));
    case 'match.future.label.standing':
      return checked('Standing', msg(ctx, 'match.future.label.standing', 'Standing', values));
    case 'match.future.label.continuity':
      return checked('Continuity', msg(ctx, 'match.future.label.continuity', 'Continuity', values));
    case 'match.future.label.mystery':
      return checked('Mystery', msg(ctx, 'match.future.label.mystery', 'Mystery', values));
    case 'match.future.reason.blood.close-kin':
      return checked('the family papers put this match among close kin', msg(ctx, 'match.future.reason.blood.close-kin', 'the family papers put this match among close kin', values));
    case 'match.future.reason.blood.related':
      return checked('the family papers still join these two lines', msg(ctx, 'match.future.reason.blood.related', 'the family papers still join these two lines', values));
    case 'match.future.reason.blood.deep':
      return checked('{houseName} is spoken of as deep blood', msg(ctx, 'match.future.reason.blood.deep', '{houseName} is spoken of as deep blood', values));
    case 'match.future.reason.blood.drop':
      return checked('{houseName} is said to carry a drop of the old blood', msg(ctx, 'match.future.reason.blood.drop', '{houseName} is said to carry a drop of the old blood', values));
    case 'match.future.reason.blood.waking.one':
      return checked('{n} waking is known in the visible line', msg(ctx, 'match.future.reason.blood.waking.one', '{n} waking is known in the visible line', values));
    case 'match.future.reason.blood.waking.many':
      return checked('{n} wakings are known in the visible line', msg(ctx, 'match.future.reason.blood.waking.many', '{n} wakings are known in the visible line', values));
    case 'match.future.reason.standing.account.one':
      return checked('{houseName} already appears in {n} circulating account', msg(ctx, 'match.future.reason.standing.account.one', '{houseName} already appears in {n} circulating account', values));
    case 'match.future.reason.standing.account.many':
      return checked('{houseName} already appears in {n} circulating accounts', msg(ctx, 'match.future.reason.standing.account.many', '{houseName} already appears in {n} circulating accounts', values));
    case 'match.future.reason.standing.our-book':
      return checked('our own book already has pages on {houseName}', msg(ctx, 'match.future.reason.standing.our-book', 'our own book already has pages on {houseName}', values));
    case 'match.future.reason.continuity.full.one':
      return checked('the line is called full on {n} completed life', msg(ctx, 'match.future.reason.continuity.full.one', 'the line is called full on {n} completed life', values));
    case 'match.future.reason.continuity.full.many':
      return checked('the line is called full on {n} completed lives', msg(ctx, 'match.future.reason.continuity.full.many', 'the line is called full on {n} completed lives', values));
    case 'match.future.reason.continuity.ordinary.one':
      return checked('the watched line is ordinary across {n} completed life', msg(ctx, 'match.future.reason.continuity.ordinary.one', 'the watched line is ordinary across {n} completed life', values));
    case 'match.future.reason.continuity.ordinary.many':
      return checked('the watched line is ordinary across {n} completed lives', msg(ctx, 'match.future.reason.continuity.ordinary.many', 'the watched line is ordinary across {n} completed lives', values));
    case 'match.future.reason.continuity.children':
      return checked('{grown} of {borne} children in the named line grew up', msg(ctx, 'match.future.reason.continuity.children', '{grown} of {borne} children in the named line grew up', values));
    case 'match.future.reason.continuity.unrelated':
      return checked('the family papers show no kinship joining the two lines', msg(ctx, 'match.future.reason.continuity.unrelated', 'the family papers show no kinship joining the two lines', values));
    case 'match.future.reason.mystery.unknown':
      return checked('no completed line anybody here has watched', msg(ctx, 'match.future.reason.mystery.unknown', 'no completed line anybody here has watched', values));
    case 'match.future.reason.mystery.empty-panel':
      return checked('the panel has no issue, waking, tale or old page to lean on', msg(ctx, 'match.future.reason.mystery.empty-panel', 'the panel has no issue, waking, tale or old page to lean on', values));
    case 'match.future.reason.mystery.no-case':
      return checked('nothing visible gives the match a clean case', msg(ctx, 'match.future.reason.mystery.no-case', 'nothing visible gives the match a clean case', values));
    case 'match.future.reason.priority.blood':
      return checked('these years make blood unusually important', msg(ctx, 'match.future.reason.priority.blood', 'these years make blood unusually important', values));
    case 'match.future.reason.priority.standing':
      return checked('these years make standing unusually important', msg(ctx, 'match.future.reason.priority.standing', 'these years make standing unusually important', values));
    case 'match.future.reason.priority.continuity':
      return checked('these years make continuity unusually important', msg(ctx, 'match.future.reason.priority.continuity', 'these years make continuity unusually important', values));
    case 'match.future.reason.priority.mystery':
      return checked('these years make mystery unusually important', msg(ctx, 'match.future.reason.priority.mystery', 'these years make mystery unusually important', values));
    case 'match.future.competing.blood':
      return checked('blood', msg(ctx, 'match.future.competing.blood', 'blood', values));
    case 'match.future.competing.standing':
      return checked('standing', msg(ctx, 'match.future.competing.standing', 'standing', values));
    case 'match.future.competing.continuity':
      return checked('continuity', msg(ctx, 'match.future.competing.continuity', 'continuity', values));
    case 'match.future.competing.mystery':
      return checked('mystery', msg(ctx, 'match.future.competing.mystery', 'mystery', values));
    case 'match.future.confidence.mixed':
      return checked('mixed with {competing}', msg(ctx, 'match.future.confidence.mixed', 'mixed with {competing}', values));
    case 'match.future.confidence.uncertain':
      return checked('thin evidence', msg(ctx, 'match.future.confidence.uncertain', 'thin evidence', values));
    default:
      throw new Error(`Unknown Match future message: ${key}`);
  }
}

export class GameSession {
  decider: 'ask' | 'chronicler';
  #initialProseMode: ProseMode;
  #initialProseCatalogueEmpty: boolean;

  constructor(
    public ctx: SimCtx,
    decider: 'ask' | 'chronicler' = 'ask',
    private readonly foundingBootstrap?: FoundingBootstrap,
  ) {
    this.decider = decider;
    const first = ctx.world.decisionLog.find(row => row.kind === 'command');
    this.#initialProseMode = first ? first.initialProseMode ?? 'original' : ctx.replayOrigin?.proseMode ?? ctx.prose.mode;
    this.#initialProseCatalogueEmpty = first ? first.initialProseCatalogueEmpty === true
      : ctx.replayOrigin ? ctx.replayOrigin.catalogueEmpty === true : ctx.prose.variants.size === 0;
    this.#keepReplayOrigin();
  }

  /** Save the external input before the verb generates its independently checked outputs. */
  #input<T>(command: SessionCommand, perform: () => T, accepted: (result: T) => boolean = () => true): T {
    const parsed = SessionCommandS.parse(command); // also owns the copy: caller payloads stay detached
    const log = this.ctx.world.decisionLog;
    const index = log.length;
    const lazy = this.#lazyGenomes();
    const rollback = () => {
      log.splice(index, 1);
      for (const { person, genome } of lazy) person.genome = genome;
    };
    const first = !log.some(row => row.kind === 'command');
    log.push({ kind: 'command', year: this.year, command: parsed,
      ...(this.ctx.prose.mode !== 'original' ? { proseMode: this.ctx.prose.mode } : {}),
      ...(this.ctx.prose.mode !== 'original' && this.ctx.prose.variants.size === 0 ? { proseCatalogueEmpty: true as const } : {}),
      ...(first && this.#initialProseMode !== 'original'
        ? { initialProseMode: this.#initialProseMode } : {}),
      ...(first && this.#initialProseMode !== 'original' && this.#initialProseCatalogueEmpty
        ? { initialProseCatalogueEmpty: true as const } : {}),
    });
    try {
      const result = perform();
      if (!accepted(result)) rollback();
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }

  /** Expression may cache a lazy genome. A read model must not change its
   * saved representation, or opening a card becomes an unrecorded input.
   * Keep the derived phenotype cache; restore only those original lazy refs.
   */
  #read<T>(read: () => T): T {
    const lazy = this.#lazyGenomes();
    try { return read(); }
    finally { for (const { person, genome } of lazy) person.genome = genome; }
  }

  #lazyGenomes() {
    return this.ctx.world.people.all().filter(p => p.genome.kind === 'lazy')
      .map(person => ({ person, genome: person.genome }));
  }

  #keepReplayOrigin(): void {
    if (this.#initialProseMode === 'original') delete this.ctx.replayOrigin;
    else this.ctx.replayOrigin = { proseMode: this.#initialProseMode,
      ...(this.#initialProseCatalogueEmpty ? { catalogueEmpty: true } : {}) };
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
    // The old zero/negative/NaN request turns no years. Infinity cannot be a
    // finite saved input, nor may it spin an unbounded loop at a closed Ledger.
    if (!Number.isFinite(years)) years = 0;
    if (years <= 0 || this.ctx.world.ending || this.ctx.world.pendingDecisions.length) {
      return this.#read(() => this.#advance(years));
    }
    const beforeYear = this.year;
    const beforeEnding = this.ctx.world.ending;
    return this.#input({ kind: 'advance', years, decider: this.decider },
      () => this.#advance(years), () => this.year !== beforeYear || this.ctx.world.ending !== beforeEnding);
  }

  #advance(years: number): AdvanceResult {
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
      if (this.ctx.world.ending) break;
      const report = stepYear(this.ctx, this.decider === 'chronicler');
      resolveDelegated(this.ctx);
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
    return this.ctx.world.pendingDecisions.map((decision) => structuredClone(decision));
  }

  /**
   * Ask one living member of the household for help with a page that is not a
   * decision. The tier is supplied by the client only after the previous one
   * has been shown; this method returns exactly what was asked for and keeps
   * the knowledge boundary in `advisers.ts`.
   */
  advice(surface: HelpSurface, subject: string, tier: HelpTier): AdviserAdvice[] {
    return this.#read(() => adviceFor(this.ctx, surface, subject, tier));
  }

  /** Remember or withdraw one exact repeated-event answer (#219). */
  delegateChoice(eventId: string, choiceId: string | null): void {
    if ((this.ctx.world.delegation.choices[eventId] ?? null) === choiceId) return;
    this.#input({ kind: 'delegateChoice', event: eventId, choice: choiceId }, () => {
      if (choiceId === null) delete this.ctx.world.delegation.choices[eventId];
      else this.ctx.world.delegation.choices[eventId] = choiceId;
    });
  }

  /** Remember or withdraw one exact harmless Record answer (#219). */
  delegateRecord(eventId: string, option: RecordOption | null): void {
    if ((this.ctx.world.delegation.records[eventId] ?? null) === option) return;
    this.#input({ kind: 'delegateRecord', event: eventId, option }, () => {
      if (option === null) delete this.ctx.world.delegation.records[eventId];
      else this.ctx.world.delegation.records[eventId] = option;
    });
  }

  /**
   * Answer a choice. The stream is derived from the decision's own id, so the
   * outcome a player gets does not depend on how long they took to answer, how
   * many times the client re-rendered, or what the editor previewed in between.
   */
  choose(decision: string, choiceId: string, cast: SlotFill = {}): ChoiceResolution {
    return this.#input({ kind: 'choose', decision, choice: choiceId, cast }, () => {
      const result = resolveChoice(this.ctx, decision, choiceId, streamFor(this.ctx.world, 'decision', decision), cast);
      if (result.ok) resolveDelegated(this.ctx);
      return result;
    }, result => result.ok);
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
    return this.#input({ kind: 'send', decision, cast }, () => {
      const result = resolveChoice(this.ctx, decision, undefined, streamFor(this.ctx.world, 'decision', decision), cast);
      if (result.ok) resolveDelegated(this.ctx);
      return result;
    }, result => result.ok);
  }

  /**
   * Take a card (concept §5, step 2). No stream: which card is on the table
   * was decided when the hand was dealt, and taking one has no roll in it —
   * the suitor a card promises is the suitor who arrives.
   */
  match(decision: string, cardId: string): MatchResolution {
    return this.#input({ kind: 'match', decision, card: cardId }, () => resolveMatch(this.ctx, decision, cardId), result => result.ok);
  }

  /** Take none of them. A real answer — the house waits for a better year. */
  declineHand(decision: string): boolean {
    return this.#input({ kind: 'declineHand', decision }, () => declineMatch(this.ctx, decision), result => result);
  }

  record(decision: string, option: RecordOption): RecordResolution {
    return this.#input({ kind: 'record', decision, option }, () => {
      const result = resolveRecord(this.ctx, decision, option);
      if (result.ok) resolveDelegated(this.ctx);
      return result;
    }, result => result.ok);
  }

  /** Hand the pen back. Answers everything standing, through the same commit path. */
  letHimDecide(): void {
    if (!this.ctx.world.pendingDecisions.length) return;
    this.#input({ kind: 'letHimDecide' }, () => autoResolveAll(this.ctx, streamFor(this.ctx.world, 'chronicler')));
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
    const parsed = TableOrderS.safeParse(o);
    if (!parsed.success) return { ok: false };
    return this.#input({ kind: 'order', order: parsed.data }, () => order(this.ctx, parsed.data), result => result.ok);
  }

  /** What the house can currently be told to do, and what it would cost. */
  table(): TableView {
    return this.#read(() => tableView(this.ctx));
  }

  /** Issue #210: select, replace, or clear the one voluntary house ambition. */
  setAmbition(id: HouseAmbitionId | null): boolean {
    if (id !== null && !this.ambitionOptions().some((a) => a.id === id)) return false;
    return this.#input({ kind: 'setAmbition', ambition: id }, () => {
      this.ctx.world.houseAmbition = id;
      return true;
    });
  }

  ambitionOptions(): HouseAmbitionOption[] {
    return this.#read(() => ambitionOptions(this.ctx));
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
    return this.#read(() => landView(this.ctx));
  }

  /**
   * THE MUSTER (issue #89, Stage 2 — #95). `reinforce`/`withdraw`, any year,
   * from the panel — no docket. Entering a war and settling one are scripted
   * moments an authored event reaches; this is the standing order in
   * between, the same shape `order()` is for the table.
   */
  muster(order: MusterOrder): MusterOrderResult {
    const parsed = MusterOrderS.safeParse(order);
    if (!parsed.success) return { ok: false };
    return this.#input({ kind: 'muster', order: parsed.data }, () => musterOrder(this.ctx, parsed.data), result => result.ok);
  }

  name(personId: string, name: string): boolean {
    return this.#input({ kind: 'name', person: personId, name }, () => renameChild(this.ctx, personId, name), result => result);
  }

  /**
   * NAME A PARCEL (issue #96, Phase C). The same cheap ownership hook as
   * `name()` above, pointed at ground instead of a newborn — a nickname for
   * an authored holding, or the only name a def-less one (an assart, a
   * drained strip) will ever have.
   */
  nameParcel(parcelId: string, name: string): boolean {
    return this.#input({ kind: 'nameParcel', parcel: parcelId, name }, () => nameParcel(this.ctx, parcelId, name).ok, result => result);
  }

  /** Accept the chronicler's names for everyone waiting. Ignoring the offer is a valid way to play. */
  keepSuggestedNames(): void {
    if (!this.ctx.world.pendingNames.length) return;
    this.#input({ kind: 'keepSuggestedNames' }, () => clearNamingQueue(this.ctx));
  }

  /**
   * Accept his name for ONE child and leave the rest of the queue standing —
   * name the daughter, let him have the four sons (issue #53). All-or-nothing
   * was the only way to answer the queue, which made "keep the names he
   * suggests" the button a player pressed to get their clock back.
   */
  keepSuggestedName(personId: string): boolean {
    return this.#input({ kind: 'keepSuggestedName', person: personId }, () => keepSuggestedName(this.ctx, personId), result => result);
  }

  /**
   * Live Match evidence is presentation, not a change to an already-dealt card.
   * Translation uses the same reviewed, fingerprinted catalogue as other core messages.
   */
  matchFuture(card: MatchCard, priorities: MatchFutureKind[] = []): MatchFutureReading {
    return this.#read(() => matchFuture(card, priorities, (key, original, values) =>
      matchFutureMessage(this.ctx, key, original, values)));
  }

  view(): SessionView {
    return this.#read(() => viewOf(this.ctx));
  }

  /**
   * THE SIGNING (concept §3, issue #38), as plain values. Undefined for a
   * bundle with no prologue in it.
   *
   * A client shows this once, before the first year, and never again;
   * `founded` on the view says which of those two it is.
   */
  prologue(): PrologueView | undefined {
    return this.#read(() => prologueView(this.ctx));
  }

  /**
   * Answer it: name the house, choose the thing the man asked for, and choose
   * who the house stepped on to be where it is. Refused, with a reason, for a
   * choice the prologue never offered — the ending names what was chosen, and
   * an ending naming something the prologue never said is a ring with a hole
   * in it.
   */
  found(choice: FoundingChoice): FoundingResult {
    const result = this.#found(choice);
    if (result.ok) {
      this.#initialProseMode = this.ctx.prose.mode;
      this.#initialProseCatalogueEmpty = this.ctx.prose.variants.size === 0;
      this.#keepReplayOrigin();
    }
    return result;
  }

  /**
   * THE FOUNDING, AS A CODE (#1995). Read from this run's own logged signing
   * and founding, so it says what was answered and nothing that happened
   * after. Names are left out unless asked for; `share-code.ts` says why.
   */
  shareCode(opts: ShareCodeOptions = {}): ShareCodeResult {
    return this.#read(() => shareCodeOf(this.ctx, opts));
  }

  #found(choice: FoundingChoice): FoundingResult {
    // A second answer is just the ordinary once-only refusal. Do not rebuild
    // a finished founding merely because the caller supplied old form fields.
    if (this.ctx.world.founding) return foundHouse(this.ctx, choice);

    // A gender alone is a signing answer: it can turn the founding cast
    // around, so it rebuilds exactly as a name or an Examination answer does.
    const hasSigning = choice.founder !== undefined
      || Object.keys(choice.answers ?? {}).length > 0;
    if (!hasSigning) return foundHouse(this.ctx, choice);

    // An identity that cannot be completed is refused by `foundHouse`, in the
    // reader's wording, before any rebuild is attempted. Bootstrap would throw
    // the same refusal in English only.
    if (choice.founder !== undefined) {
      try {
        resolveFounder(choice.founder);
      } catch (error) {
        if (error instanceof FounderIdentityError) return foundHouse(this.ctx, choice);
        throw error;
      }
    }

    const restart = this.foundingBootstrap;
    if (!restart) {
      return { ok: false, reason: msg(this.ctx, 'founding.refuse.examination_restart', 'the Examination can only be answered from a new run') };
    }
    if (this.ctx.world.year !== restart.startYear || this.ctx.world.decisionLog.length) {
      return {
        ok: false,
        reason: msg(this.ctx, 'founding.refuse.examination_late', 'the Examination belongs before the first year or decision'),
      };
    }

    // Build a candidate first. `foundHouse` does all state-term validation
    // before mutation; only a successful candidate replaces the live ctx.
    let candidate: SimCtx;
    try {
      // A catalogue or reading mode can be installed while the signing is on
      // screen. The rebuild writes the founding page, so it is handed the
      // setting as it stands now, not as it was when the run was created.
      const prose = createProseRuntime(this.ctx.prose.mode, [...this.ctx.prose.variants.values()]);
      candidate = restart.build({ answers: choice.answers, founder: choice.founder }, prose);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message
          : examinationAnswerFallback(this.ctx),
      };
    }
    const result = foundHouse(candidate, choice);
    if (!result.ok) return result;
    this.ctx = candidate;
    return result;
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
  book(opts: { from?: number; to?: number } = {}): ChronicleView[] {
    const { from, to } = opts;
    const entries = chronicleReading(this.ctx.world.chronicle).filter(
      (e) => (from === undefined || e.year >= from) && (to === undefined || e.year <= to),
    );
    return asRead(this.ctx, entries);
  }

  /** Recorded family changes during one Head's tenure, current by default. */
  generationChanges(index?: number): GenerationChanges {
    return this.#read(() => generationChangesOf(this.ctx, index));
  }

  /** The earlier act a Chronicle page answers, when one is recoverable. */
  causeOf(entryId: string): ChronicleCause | undefined {
    return causeOfPage(this.ctx, entryId);
  }

  /** Later Chronicle years that explicitly answer this page. */
  answeredBy(entryId: string): number[] {
    return answeredByPage(this.ctx, entryId);
  }

  /** Stable authored pages in which the book explicitly cast this person. */
  mentions(person: string): string[] {
    return chronicleReading(this.ctx.world.chronicle).flatMap((entry) =>
      entry.id && entry.people?.includes(person) ? [entry.id] : []);
  }

  /**
   * Recorded deeds first, then titled mentions, then unlabelled/blank pages.
   * Select the earliest pages in each group up to five by default, then show
   * the selection chronologically, breaking year ties by Chronicle order.
   * One item per page: the first deed for this person labels it; the source
   * retains any other claims. Infinity reads every page for the full list.
   * Omission is checked before claims/title/dispute metadata: only its stable
   * reading identity and date survive. No people/genome/RNG is read or changed.
   */
  milestones(person: string, opts: { limit?: number } = {}): RecordedMilestone[] {
    const w = this.ctx.world;
    const requested = opts.limit ?? 5;
    const limit = Number.isNaN(requested) ? 5 : Math.max(0, Math.floor(requested));
    return chronicleReading(w.chronicle).flatMap((entry, index) => {
      const blank = entry.text === null || entry.record === 'omit';
      const deed = blank ? undefined : entry.claims?.find((claim) => claim.kind === 'deed' && claim.person === person);
      if (!entry.people?.includes(person) && !deed) return [];
      const row: RecordedMilestone = { entryId: entry.id!, year: entry.year, source: 'blank' };
      if (!blank) {
        row.source = deed ? 'deed' : 'title';
        const label = deed?.kind === 'deed' ? deed.text : entry.title;
        if (label) row.label = label;
        const dispute = entry.record === 'embellish' && entry.discrepancyId
          ? w.discrepancies.get(entry.discrepancyId)?.state : undefined;
        if (dispute) row.disputed = dispute;
      }
      return [{ row, index, rank: row.source === 'deed' ? 0 : row.label ? 1 : 2 }];
    }).sort((a, b) => a.rank - b.rank || a.row.year - b.row.year || a.index - b.index)
      .slice(0, limit)
      .sort((a, b) => a.row.year - b.row.year || a.index - b.index)
      .map(({ row }) => row);
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
    return this.#read(() => {
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
    });
  }

  epilogue(): EpilogueView | undefined {
    return this.#read(() => epilogueOf(this.ctx));
  }

  /** Finished-run awards, read in the current mode without persisting their wording. */
  achievements(library?: RunLibrary): AchievementView[] {
    if (!this.ctx.world.ending) return [];
    return this.#read(() => earnedAchievements(saveGame(this.ctx), library).map((id) => achievementView(this.ctx, id)));
  }

  /** What this finished house may leave in the installation-level library. */
  libraryRun(): LibraryRun | undefined {
    return this.#read(() => libraryRunOf(this.ctx));
  }

  /** Change future authored wording without changing simulation or save state. */
  setProseMode(mode: ProseMode): void {
    setRuntimeProseMode(this.ctx, mode);
  }

  /** Install an asynchronously loaded reader catalogue without changing game state. */
  setProseVariants(variants: readonly ProseVariant[]): void {
    setProseVariants(this.ctx, variants);
  }

  save(): SavedGame {
    return saveGame(this.ctx);
  }
}

function authoredProseVariants(source: ContentBundle | Content): readonly ProseVariant[] {
  return source.proseVariants;
}

export function newGame(source: ContentBundle | Content, opts: SessionOptions = {}): GameSession {
  const seed = opts.seed ?? 1042;
  const startYear = opts.startYear ?? 1042;
  const campaign = opts.campaign ?? 'long';
  const libraryRuns = opts.libraryRuns ?? [];
  const proseVariants = opts.proseVariants ?? authoredProseVariants(source);
  // The founding page is written inside `bootstrap`, so the wording has to be
  // chosen before it is called, not configured afterwards — here, and again in
  // `found()`'s rebuild with whatever the reader has chosen since.
  const prose = createProseRuntime(opts.proseMode ?? 'original', proseVariants);
  const ctx = bootstrap(source, seed, startYear, campaign, libraryRuns, undefined, prose);
  // Rebuild from the indexed content snapshot this run actually started with,
  // not from a host object that might be edited while the prologue is open.
  const foundingSource = ctx.content;
  const build = (signing: BootstrapSigning, live: ProseRuntime) =>
    bootstrap(foundingSource, seed, startYear, campaign, libraryRuns, signing, live);
  return new GameSession(ctx, opts.decider ?? 'ask', { startYear, build });
}

export function resumeGame(
  save: unknown,
  source: ContentBundle | Content,
  opts: SessionOptions = {},
): GameSession {
  const ctx = loadGame(save, source);
  const session = new GameSession(ctx, opts.decider ?? 'ask');
  setProseVariants(ctx, opts.proseVariants ?? authoredProseVariants(source));
  if (opts.proseMode) setRuntimeProseMode(ctx, opts.proseMode);
  return session;
}

// ── The read model ────────────────────────────────────────────────────────

/**
 * Chronicle pages as a client receives them: deep copies, because a page's
 * people, claims and cause are nested values and the saved book must not be
 * writable from Vue, each marked with the kind of answer it is (#1945).
 */
function asRead(ctx: SimCtx, entries: ChronicleEntry[]): ChronicleView[] {
  if (!entries.length) return [];
  const kinds = answerPages(ctx, entries.reduce((min, e) => Math.min(min, e.year), Infinity) - 1);
  return entries.map((entry) => {
    const copy: ChronicleView = structuredClone(entry);
    const answer = kinds.get(entry.id!);
    if (answer) copy.answer = answer;
    return copy;
  });
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
      ...proseForTale(ctx, def),
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

/** Select an authored house name only when the live world still uses that text.
 * A player-facing record must preserve runtime renames, unknown house ids and
 * stable house identity independently of the current reading preference. */
function presentedHouseName(ctx: SimCtx, id: string): string {
  const name = ctx.world.houses.get(id)?.name;
  if (name === undefined) return id;
  const authored = ctx.content.house(id);
  return authored?.name === name
    ? proseForContentField(ctx, 'houses', id, 'name', name)
    : name;
}

function interventionViews(ctx: SimCtx): InterventionView[] {
  return interventionsOf(ctx).map(({ year, record }) => ({ year, page: record.page,
    actor: record.actor, actorName: record.actorName, manifestation: record.manifestation, receipt: record.receipt }));
}

export function interventionsOf(ctx: SimCtx): { year: number; event: string; record: PrimordialRecord }[] {
  return ctx.world.decisionLog.flatMap(row => row.kind === 'outcome' && row.primordial
    ? [{ year: row.year, event: row.event, record: structuredClone(row.primordial) }] : []);
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
  const succession = knownSuccession(ctx);
  const successionPossible = new Set(succession.possible);
  const relevance = relevantPeople(ctx);
  const hallViews: HallView[] = [];
  for (const [id, living] of halls(w, w.year)) {
    const members = [...living, ...(consumedByHall.get(id) ?? [])];
    const branch = w.branches.get(id);
    hallViews.push({
      id,
      name: branch?.name ?? msg(ctx, 'session.hall.main', 'the main hall'),
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
          ...(p.awakening.awakened ? { expresses: knownToExpress(p, ctx.genetics, w.year) } : {}),
          madness: p.madness,
          attrs: realAttrs,
          parents: {
            ...(p.trueParents.mother !== undefined ? { mother: p.trueParents.mother } : {}),
            ...(p.trueParents.father !== undefined ? { father: p.trueParents.father } : {}),
          },
          record: {
            // The claimed value where the record has spoken; the real one
            // otherwise, so a UI can always draw `record.attrs` for the
            // headline view and never has to fall back itself.
            attrs: { ...realAttrs, ...Object.fromEntries(view.attrs) },
            claimedTraits: [...view.claimedTraits],
            claimedDeath: view.claimedDeath,
            parents: {
              ...(p.claimedParents.mother !== undefined ? { mother: p.claimedParents.mother } : {}),
              ...(p.claimedParents.father !== undefined ? { father: p.claimedParents.father } : {}),
            },
            claimed: [...view.attrs.keys()],
          },
          drift: view.divergence.size > 0,
        };
        if (p.epithet !== undefined) m.epithet = p.epithet;
        if (succession.heir === p.id) m.succession = 'heir';
        else if (successionPossible.has(p.id)) m.succession = 'possible';
        const reasons = relevance.get(p.id);
        if (reasons?.length) m.relevance = reasons.map((reason) => ({ reason }));
        if (p.contract) m.contract = p.contract.role;
        if (p.career) {
          const post = ctx.content.career(p.career.career);
          m.post = post
            ? proseForContentField(ctx, 'careers', String(post.id), 'name', post.name)
            : String(p.career.career);
        }
        if (spouse) {
          const marriedIn = spouse.houseOfOrigin !== w.playerHouse;
          m.spouse = {
            id: spouse.id,
            name: spouse.name,
            marriedIn,
            // The current name takes precedence over an authored translation:
            // this is the same house name promises and loose secrets display.
            ...(marriedIn ? { house: presentedHouseName(ctx, spouse.houseOfOrigin) } : {}),
          };
        }
        return m;
      }),
    });
  }

  // Provenance survives a person's death, but the hall view deliberately
  // contains living members only. Resolve the kept book's references
  // here, without sending the whole person store (or hidden facts) to Vue.
  // Chronicle views must not expose writable references into the saved book.
  // Deep copies matter: a page's people, claims and cause are nested values.
  const chronicle = asRead(ctx, chronicleReading(w.chronicle).slice(-chronicleLines));
  const chroniclePeople = [...new Set(w.chronicle.filter((entry) => entry.text !== null && entry.record !== 'omit')
    .flatMap((entry) => [...(entry.people ?? []), ...(entry.claims ?? [])
      .flatMap((claim) => claim.kind === 'deed' ? [claim.person] : [])]))]
    .flatMap((id) => {
      const person = w.people.get(id);
      return person ? [{ id: String(id), name: person.name }] : [];
    });

  const campaign = campaignDef(w.campaign);
  // A campaign's name is reader-facing prose, not world state. Keep the
  // identity and campaign clock unchanged when the reader switches wording.
  const campaignName = (() => {
    switch (campaign.id) {
      case 'short': return msg(ctx, 'session.campaign.short', 'A Short Line');
      case 'long': return msg(ctx, 'session.campaign.long', 'A Long Line');
      case 'demo': return msg(ctx, 'session.campaign.demo', 'A Demonstration');
      default: return assertNever(campaign.id, 'session campaign');
    }
  })();
  const view: SessionView = {
    year: w.year,
    campaign: { id: campaign.id, name: campaignName, startYear: campaign.startYear, endYear: campaign.endYear },
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
                ...(previous.ambition !== undefined ? { ambition: previous.ambition } : {}),
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
    // The authored default is reader-facing prose; a signed/player-chosen
    // founding name still wins and is never translated as content.
    houseName: w.founding?.houseName ?? presentedHouseName(ctx, w.playerHouse),
    ...(ambitionView(ctx) ? { ambition: ambitionView(ctx)! } : {}),
    ambitionOptions: ambitionOptions(ctx),
    ...(() => {
      const recommended = recommendAmbition(ctx);
      return recommended ? { ambitionRecommendation: recommended } : {};
    })(),
    attributes: ctx.content.attributes.map((a) => ({
      attr: String(a.id),
      name: proseForContentField(ctx, 'attributes', String(a.id), 'name', a.name),
    })),
    traits: ctx.content.traits.map((t) => ({
      trait: String(t.id),
      name: proseForContentField(ctx, 'traits', String(t.id), 'name', t.name),
    })),
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
        ...(a.named ? { name: proseForContentField(ctx, 'ages', a.age, 'name', def.name) } : {}),
      }];
    }),
    agePressures: strategicPressures(ctx),
    ageMatchPriorities: activeMatchPriorities(ctx),
    ageRecordPriorities: activeRecordPriorities(ctx),
    halls: hallViews,
    chronicle,
    interventions: interventionViews(ctx),
    chroniclePeople,
    // COPIED, like every other array on this object. This one line handed the
    // caller `world.frame.entries` itself, so a view taken before the clock
    // moved grew a new interlude when it moved — `session.test.ts` calls that
    // "the old view changed when the world did", and it stayed invisible for
    // as long as a sixty-year window rarely contained an interlude. More frame
    // content made it visible; it was always wrong.
    frame: w.frame.entries.map((entry) => structuredClone(entry)),
    docket: w.pendingDecisions.map((decision) => {
      const ambition = ambitionRelevance(ctx, decision);
      return structuredClone({
        ...decision,
        advice: adviceForDecision(ctx, decision),
        ...(ambition ? { ambition } : {}),
        ...(decision.kind === 'record' ? { stakes: recordStakes(ctx, decision) } : {}),
      });
    }),
    namesWanted: w.pendingNames.map((n) => ({
      person: n.person, suggested: n.suggested, sex: n.sex, born: n.born, because: n.because,
    })),
    tales: circulatingTales(ctx),
    marriagePromises: w.marriagePromises.map((p) => ({
      house: p.toHouse,
      houseName: presentedHouseName(ctx, p.toHouse),
      year: p.year,
      lot: p.lot,
      // A lot is a spellbook, an heirloom, or a page of somebody's chronicle.
      // Whichever it is, the family knows what it gave a daughter for.
      lotName: marriagePromiseLotName(ctx, p),
    })),
    ascension: {
      rung: w.ascension.rung,
      best: w.ascension.best,
      title: rungTitle(ctx, w.ascension.rung),
      bestTitle: rungTitle(ctx, w.ascension.best),
      rungs: RUNG_ORDER.map((id) => ({
        id,
        title: rungTitle(ctx, id),
        ...(w.ascension.reachedAt[id] !== undefined ? { reachedAt: w.ascension.reachedAt[id]! } : {}),
      })),
      ...(w.ascension.reachedAt[w.ascension.best] !== undefined
        ? { bestAt: w.ascension.reachedAt[w.ascension.best]! }
        : {}),
      ...(() => {
        const frozen = frozenLadder(ctx);
        return frozen ? { frozen } : {};
      })(),
      ...(() => {
        const f = visibleAscensionRanking(ctx)[0];
        const diagnosis = diagnoseHouseAscension(ctx, { rung: w.ascension.rung, best: w.ascension.best, foremost: f });
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
                ...(diagnosis.blockers[0]?.kind === 'power' ? { route: powerEvidenceRoute(ctx) } : {}),
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
      houseName: presentedHouseName(ctx, l.house),
      since: l.since,
      ...(l.told !== undefined ? { told: l.told } : {}),
    })),
  };

  if (w.ending) view.ending = { ...w.ending };

  const narrator = w.narrator ? w.people.get(w.narrator) : undefined;
  if (narrator) view.narrator = { name: narrator.name, them: formOf(narrator, 'them') };

  if (guardian) {
    view.guardian = {
      id: guardian.id,
      name: guardian.name,
      ...(w.guardianSince !== undefined ? { since: w.guardianSince } : {}),
    };
  }

  const commitment = activeCommitment(ctx);
  if (commitment) {
    const position = commitment.position !== undefined
      ? ctx.content.position(commitment.position)
      : undefined;
    const positionName = position
      ? proseForContentField(ctx, 'positions', position.id, 'name', position.name)
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
