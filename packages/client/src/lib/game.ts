import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import type { CampaignId, Content, ContentBundle, FrameEntry, HouseAmbitionId, RunLibrary } from '@ed/schema';
import { appendLibraryRun, emptyRunLibrary, readRunLibrary } from '@ed/schema';
import {
  CAMPAIGNS, matchFuture, newGame, resumeGame, standingMoved,
  type ChapterOpening, type ChapterView, type ChronicleEntry,
  type EpilogueView, type FoundingChoice, type FoundingResult, type GameSession,
  type LandView, type MatchCard, type MatchFutureReading, type MatchResolution, type MusterOrder, type MusterOrderResult,
  type OrderResult, type Passage, type PendingDecision,
  type PrologueView, type RecordOption, type SessionView, type SlotFill, type StandingDelta,
  type TableOrder, type TableView,
} from '@ed/core';
import { foldStanding } from './jump.js';
import { currentPlatform, type Platform, type SaveSummary } from '../platform.js';

/**
 * THE CLIENT'S ONLY DOOR INTO THE SIMULATION.
 *
 * Every call to `GameSession` in this package happens in this file, and no
 * component may import from `@ed/core` for anything but a type. That is not
 * tidiness: `session.ctx` is reachable — the editor needs it for previews —
 * and a component that reaches through it would be reading live simulation
 * state that changes under the render, which is what the editor's version
 * counter exists to work around. A client has no such problem and must not
 * grow one.
 *
 * So the flow is one-way. A verb is called, the world moves, and the whole
 * read model is taken again as plain values (`view()` is values only, by
 * contract). Vue's reactivity sees a new object and re-renders; nothing here
 * has to be told what changed, and nothing holds a reference into the world.
 *
 * If something the UI needs cannot be got here, the missing thing is a verb on
 * `session.ts` — not a peek at `.ctx`.
 */

/** The two product profiles the front door may offer, from the engine's one source of truth. */
export const CAMPAIGN_CHOICES = [CAMPAIGNS.short, CAMPAIGNS.long] as const;

/**
 * A PRESENTATION READING OF A CARD, still through the client's one door.
 *
 * Components may import @ed/core for types only. The engine owns what visible
 * Match evidence means, so the component hands the already-photographed card
 * back through this seam rather than growing a second little rules engine in
 * the template.
 */
export function futureOf(card: MatchCard, priorities: SessionView['ageMatchPriorities'] = []): MatchFutureReading {
  return matchFuture(card, priorities);
}

/** The rolling slot every host keeps without asking. */
const AUTOSAVE = 'autosave';

/**
 * HOW MUCH OF THE PASSAGE LOG IS KEPT (issue #49).
 *
 * A Long Line is five hundred years and the log is a tail, not an archive — the
 * chronicle is the archive, and it is on the right of the board. This is
 * comfortably more than the longest jump the clock offers.
 */
const PASSAGE_TAIL = 200;

/**
 * A passage is a report of a year; this is the one small piece of reading the
 * client remembers alongside it. The cast was true BEFORE the year turned, so
 * it can still say why a death mattered after `kill()` has taken that person
 * off the next view. It is deliberately not a field on `Passage` or the world:
 * the account and the cast are both values, joined only while this screen is
 * holding the turn that produced them (issue #44).
 */
export type RememberedPassage = Omit<Passage, 'lines'> & {
  lines: Array<Passage['lines'][number] & {
    /** The exact words that made this person part of last year's cast. */
    remembered?: Pick<SessionView['cast'][number], 'label' | 'because'>;
  }>;
};

/** Attach last year's cast to its deaths, without adding a second world record. */
function rememberCast(passages: Passage[], cast: SessionView['cast']): RememberedPassage[] {
  const remembered = new Map(cast.map(({ person, label, because }) => [person, { label, because }]));
  return passages.map((passage) => ({
    ...passage,
    lines: passage.lines.map((line) => {
      const memory = line.kind === 'death' ? remembered.get(line.person) : undefined;
      return memory ? { ...line, remembered: memory } : line;
    }),
  }));
}

export interface GameStore {
  /** The whole read model, retaken after every verb. Null before the run begins. */
  view: Ref<SessionView | null>;
  /** What the house can be told to do, and what it would cost. Null before the run begins. */
  table: Ref<TableView | null>;
  /** The house's land — held ground and the open market (issue #94). Null before the run begins. */
  land: Ref<LandView | null>;
  /**
   * WHAT THE LAST TURN OF THE CLOCK DID TO THE HOUSE (issue #54), or null
   * where it did nothing. Every number in the header is a level; this is the
   * derivative, and it is the engine's own account rather than a diff of
   * snapshots the client kept for itself.
   */
  jump: Ref<StandingDelta | null>;
  /** What is standing on the docket, waiting to be answered. */
  docket: ComputedRef<PendingDecision[]>;
  /** The signing (concept §3). Null before a run begins. */
  prologue: Ref<PrologueView | null>;
  /**
   * Whether the player has walked out of the prologue and into the run.
   *
   * Separate from `prologue.founded` because the last thing the prologue does
   * is not a choice: it states the thesis of the whole game on one plain line
   * and holds it there. A screen that vanished the instant the house was named
   * would put that line under a family tree, which is where it does nothing.
   */
  openingSeen: Ref<boolean>;
  /** The last night (concept §23). Null until the run has reached the term. */
  epilogue: Ref<EpilogueView | null>;
  /**
   * WHAT THE YEARS DID, newest first (issue #49).
   *
   * Kept HERE rather than read off the view, because it is not a reading of
   * the world — it is what happened while the clock was turning, and the
   * world has no memory of a year having gone past. It is therefore also the
   * one thing on this store that a reload loses, and it loses it honestly:
   * see `start`, which empties it rather than leaving a resumed run holding
   * half-remembered years.
   */
  passages: Ref<RememberedPassage[]>;
  /** The interlude to hold on screen, if the last step produced one. */
  interlude: Ref<FrameEntry | null>;
  /**
   * THE FRONT OF THE CHAPTER QUEUE (issue #65), or null with nothing waiting.
   *
   * Unlike `interlude`, nothing here is ever dropped — an Age closing without
   * its card would be exactly the silent failure this codebase's own doctrine
   * warns about, so a long jump that closes three Ages queues three beats and
   * `dismissChapter` works through them one at a time.
   */
  chapter: ComputedRef<ChapterBeat | null>;
  /** Every interlude the run has shown, newest first. The frame as a record. */
  frame: ComputedRef<FrameEntry[]>;
  /** True once the ledger has closed — which is the engine's word, not the calendar's. */
  ended: ComputedRef<boolean>;
  /** The last thing the FOUNDING refused, and why. The table has its own. */
  refused: Ref<string | null>;
  /**
   * THE LAST ORDER THE TABLE REFUSED, AND WHICH PANEL ASKED (issue #55).
   *
   * Keyed by the order's kind because the reason has to be drawn against the
   * control that produced it. One shared string was rendered in one panel, so
   * a refusal from The Papers printed its reason roughly 1,500px above the
   * button that had just been pressed — off-screen, and indistinguishable
   * from nothing happening at all, which is the thing this repository is least
   * able to detect and least able to afford.
   */
  refusal: Ref<{ kind: TableOrder['kind']; reason: string } | null>;
  /**
   * THE LAST SPEND, AS A RECEIPT (issue #59). A 120-crown pedigree out of 252
   * was one click with nothing before it and nothing after — the button simply
   * stopped being disabled at some point later. Null where the order cost
   * nothing, so the table is not decorated with receipts for free things.
   */
  receipt: Ref<string | null>;
  /**
   * THE LAST MUSTER ORDER REFUSED, AND WHY (issue #89, Stage 2 — #95) — the
   * same reason `refusal` exists for the table, kept apart because it is a
   * different verb, keyed by a different discriminant (`op`, not `kind`).
   */
  musterRefusal: Ref<{ op: MusterOrder['op']; reason: string } | null>;
  /**
   * WHAT THE LAST ANSWER DID (issue #84).
   *
   * `resolveChoice` has returned the rendered outcome prose since the day it
   * was written — the authored sentence, slots filled, that says what the
   * player's decision caused — and `packages/client` dropped it on the floor.
   * So the loop was: read a five-sentence dilemma somebody wrote carefully,
   * weigh it, choose, and have the panel replaced by the next dilemma. The
   * consequence existed, as one unhighlighted `line`-weight entry at the top
   * of a reversed sixty-entry column on the far right of the board, with
   * nothing tying it to the question just answered. That fired 304 times a
   * run on seed 7 — 78% of everything the player answers.
   *
   * Decide → see what it did → decide again. This is the middle beat.
   *
   * Held rather than logged, because it belongs to the decision that produced
   * it: the docket panel is replaced by this and the next decision waits until
   * it is dismissed. `letHimDecide` and `advance` set it to null — a hundred
   * answers at once have no single outcome to show, and pretending otherwise
   * would show the last one as though it were the point.
   */
  outcome: Ref<Outcome | null>;
  /**
   * THE LAST CARD THE MATCH REFUSED, AND WHICH ONE (issue #83).
   *
   * Keyed by card id for the same reason `refusal` is keyed by order kind: a
   * reason drawn anywhere but against the control that produced it is
   * indistinguishable from nothing having happened.
   *
   * `match.ts` now closes a card the moment its person or its subject stops
   * being able to marry, so this should stay null forever. It is here because
   * the bug it belongs to was a return value nobody read, and the fix for
   * that is not a better engine — it is a client that draws the answer.
   */
  refusedCard: Ref<{ card: string; reason: string } | null>;
  /** A run kept from a previous page load is waiting to be resumed. */
  resumable: Ref<boolean>;
  /**
   * WHETHER THE HOST HAS THE LATEST TURN (issue #67).
   *
   * `writeSave` resolves and nothing told the player it did — the autosave
   * that survives a closed tab was invisible from the inside. `'idle'` before
   * the first write, `'saving'` for the round trip, `'saved'` once the host
   * confirms it, `'error'` if it refused. A `Ref` rather than a boolean so the
   * board can say WHICH of those it is, not merely whether it is done.
   */
  saveStatus: Ref<'idle' | 'saving' | 'saved' | 'error'>;
  /** Named snapshots the selected host can see, newest first. */
  saves: Ref<SaveSummary[]>;
  /** Completed houses held by this installation/profile (issue #70). */
  library: Ref<RunLibrary>;
  /** False only while the host's profile store is still being read. */
  libraryReady: Ref<boolean>;
  actions: GameActions;
}

/**
 * ONE CARD ON THE CHAPTER QUEUE (issue #65).
 *
 * A discriminated union rather than two rows, because at most one is on
 * screen at once through one `Chapter.vue` and the component only needs to
 * know which face it is showing. Every Age closing produces a `closing` beat
 * — none are dropped, unlike an interlude, because the whole point is a card
 * for every one of them — and every Age beginning produces an `opening` one.
 */
export type ChapterBeat =
  | { kind: 'opening'; opening: ChapterOpening }
  | { kind: 'closing'; view: ChapterView };

/** What the player just did, and what it did to the world. */
export interface Outcome {
  /** The answer they gave, in their own words off the button they pressed. */
  said: string;
  /**
   * What it caused. Null only for a Record omission, where a dated blank line
   * IS the artefact and there is no sentence to show.
   */
  text: string | null;
  /** A Record answer is the one whose result is a line in the book. */
  kind: 'choice' | 'match' | 'record';
}

/**
 * WHAT THE UI CAN DO, ENUMERABLE AT RUNTIME.
 *
 * One entry per verb the player has, named after the verb it carries.
 * `verbs.test.ts` walks this object and the templates: an action nothing in a
 * `.vue` file calls is a verb the player cannot reach, which is exactly how
 * `send` would have sat unwired for months while every `party` decider in the
 * content quietly resolved through `letHimDecide`.
 */
export interface GameActions {
  begin(seed: number, campaign?: CampaignId): void;
  /** Answer the prologue: the house's name, and its two choices. */
  found(choice: FoundingChoice): FoundingResult;
  /** Leave the prologue. The thesis has been read; the years start now. */
  enter(): void;
  resume(): Promise<boolean>;
  load(slot: string): Promise<boolean>;
  listSaves(): Promise<SaveSummary[]>;
  importSave(): Promise<boolean>;
  exportSave(slot: string): Promise<boolean>;
  deleteLibraryRun(id: string): Promise<void>;
  clearLibrary(): Promise<void>;
  restart(): void;
  advance(years: number): void;
  /**
   * `said` is the label off the control that was pressed, and it is passed in
   * rather than looked up because the store does not know what the panel drew
   * — an unavailable choice is still numbered, a Record option's label is the
   * client's own words, and a card is a name. It is only ever shown back to
   * the player above what their answer did (issue #84).
   */
  choose(decision: string, choiceId: string, cast?: SlotFill, said?: string): void;
  send(decision: string, cast?: SlotFill, said?: string): void;
  match(decision: string, cardId: string, said?: string): MatchResolution | undefined;
  declineHand(decision: string): void;
  record(decision: string, option: RecordOption, said?: string): void;
  /** Read the outcome, and let the next decision through. */
  dismissOutcome(): void;
  /** Choose, replace, or clear the voluntary house ambition (issue #210). */
  setAmbition(id: HouseAmbitionId | null): boolean;
  letHimDecide(): void;
  order(o: TableOrder): OrderResult;
  /** The Muster's own standing verb (issue #89, Stage 2 — #95) — reinforce or withdraw, any year, no docket. */
  muster(o: MusterOrder): MusterOrderResult;
  name(person: string, name: string): boolean;
  /** The same verb, pointed at ground instead of a newborn (issue #96, Phase C). */
  nameParcel(parcel: string, name: string): boolean;
  keepSuggestedNames(): void;
  /** Accept his name for one child, leaving the rest of the queue standing. */
  keepSuggestedName(person: string): boolean;
  /**
   * THE WHOLE BOOK (issue #48). The panel on the board is a window on the last
   * sixty entries; this is the volume the player has been writing.
   */
  book(opts?: { from?: number; to?: number }): ChronicleEntry[];
  /**
   * THE SPINE (issue #56). Who has held the seal since the signing. The halls
   * are the living household; this is the fourteen generations behind them.
   */
  line(): ReturnType<GameSession['line']>;
  dismissInterlude(): void;
  /** Read the chapter card, and let the next one in the queue through. */
  dismissChapter(): void;
}

export function createGame(source: ContentBundle | Content, platform: Platform = currentPlatform()): GameStore {
  // `shallowRef`, because a `GameSession` owns the whole mutable world and
  // making that deeply reactive would have Vue walk every person in the house
  // on every year. Nothing renders off this object — everything renders off
  // the values `refresh` takes from it.
  const session = shallowRef<GameSession | null>(null);
  const view = ref<SessionView | null>(null);
  const table = ref<TableView | null>(null);
  const land = ref<LandView | null>(null);
  const prologue = ref<PrologueView | null>(null);
  const openingSeen = ref(false);
  const epilogue = ref<EpilogueView | null>(null);
  const interlude = ref<FrameEntry | null>(null);
  const passages = ref<RememberedPassage[]>([]);
  const jump = ref<StandingDelta | null>(null);
  const refused = ref<string | null>(null);
  const refusal = ref<{ kind: TableOrder['kind']; reason: string } | null>(null);
  const receipt = ref<string | null>(null);
  const musterRefusal = ref<{ op: MusterOrder['op']; reason: string } | null>(null);
  const outcome = ref<Outcome | null>(null);
  const refusedCard = ref<{ card: string; reason: string } | null>(null);
  const resumable = ref(false);
  const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saves = ref<SaveSummary[]>([]);
  const library = ref<RunLibrary>(emptyRunLibrary());
  const libraryReady = ref(false);
  // The browser can answer synchronously, native hosts cannot. Keeping the
  // snapshot outside Vue means the saved world is never made reactive merely
  // because the front door needs to know it exists.
  let keptSave: unknown | null = null;
  let archivedRunId: string | null = null;
  /** The chapter queue (issue #65). Never trimmed to "the latest" — see `ChapterBeat`. */
  const chapterQueue = ref<ChapterBeat[]>([]);

  /**
   * Hold what an answer did, unless there is nothing worth holding.
   *
   * A narration outcome with no authored text, and a Record omission, both
   * arrive here as a null `text`. The omission is still shown — the dated
   * blank is the artefact, and the panel says so in words. An outcome with
   * neither text nor a blank to point at is not held: an empty panel between
   * two decisions is one more click for nothing.
   */
  function hold(next: Outcome | null): void {
    outcome.value = next && (next.text !== null || next.kind === 'record') ? next : null;
  }

  /** How much frame the player has already been shown. */
  let seenFrame = 0;

  const docket = computed(() => view.value?.docket ?? []);
  const frame = computed(() => [...(view.value?.frame ?? [])].reverse());
  const chapter = computed(() => chapterQueue.value[0] ?? null);
  // What the ENGINE says, not what the calendar says. The run ends when the
  // ledger closes, and the ledger closing is what produces an epilogue to
  // show — a client deciding for itself that the displayed collection year means over would be a second
  // opinion about the one thing the whole game is pointed at.
  const ended = computed(() => view.value?.ending !== undefined);

  /**
   * Take the picture again. Called after every verb, and it is the only thing
   * that writes to `view` and `table` — a component that mutated either would
   * be editing a photograph.
   */
  function refresh(): void {
    const g = session.value;
    if (!g) return;
    view.value = g.view();
    table.value = g.table();
    land.value = g.land();
    prologue.value = g.prologue() ?? null;
    epilogue.value = g.epilogue() ?? null;
    keep(g);
  }

  function start(g: GameSession): void {
    session.value = g;
    archivedRunId = null;
    // A resumed run does not replay its own prologue.
    openingSeen.value = g.prologue()?.founded !== undefined;
    seenFrame = g.view().frame.length;
    // A resumed run did not just live through the years that closed its
    // already-ended Ages — those cards were shown, or missed, in whatever
    // session actually turned them. Replaying the whole history's worth on
    // every load would be `showInterlude`'s old bug in a new shape.
    chapterQueue.value = [];
    interlude.value = null;
    // A resumed run did not watch its own earlier years go past,
    // and a log that pretended otherwise would be inventing them. The same
    // goes for the last jump: there was not one.
    passages.value = [];
    jump.value = null;
    refused.value = null;
    refusal.value = null;
    musterRefusal.value = null;
    receipt.value = null;
    outcome.value = null;
    refusedCard.value = null;
    refresh();
  }

  const actions: GameActions = {
    begin(seed, campaign = 'short') {
      const begun = newGame(source, { seed, startYear: CAMPAIGNS[campaign].startYear, campaign, libraryRuns: library.value.runs });
      // Catalogue availability belongs to GameSession, not Vue; route the read
      // through the same store seam as every other public session method.
      begun.ambitionOptions();
      start(begun);
    },

    enter() {
      openingSeen.value = true;
    },

    found(choice) {
      const result = session.value?.found(choice) ?? { ok: false, reason: 'no run' };
      refused.value = result.ok ? null : result.reason ?? 'he did not';
      refresh();
      return result;
    },

    /** Pick a run back up after a reload. Not a menu: one run, kept in the tab. */
    async resume() {
      return loadSave(keptSave ?? await readKept(), true);
    },

    async load(slot) {
      try {
        return loadSave(await platform.readSave(slot));
      } catch {
        return false;
      }
    },

    async listSaves() {
      await refreshSaves();
      return saves.value;
    },

    async importSave() {
      try {
        return loadSave(await platform.importSave());
      } catch {
        return false;
      }
    },

    async exportSave(slot) {
      try {
        const save = await platform.readSave(slot);
        if (!save) return false;
        await platform.exportSave(save);
        return true;
      } catch {
        return false;
      }
    },

    async deleteLibraryRun(id) {
      library.value = { ...library.value, runs: library.value.runs.filter((run) => run.id !== id) };
      await platform.writeLibrary(library.value);
    },

    async clearLibrary() {
      library.value = emptyRunLibrary();
      await platform.writeLibrary(library.value);
    },

    restart() {
      session.value = null;
      view.value = null;
      table.value = null;
      land.value = null;
      prologue.value = null;
      epilogue.value = null;
      openingSeen.value = false;
      interlude.value = null;
      chapterQueue.value = [];
      passages.value = [];
      jump.value = null;
      forget();
      resumable.value = false;
    },

    /**
     * Turn the clock. Stops of its own accord at three things: a decision on
     * the docket, a child waiting to be named, and the collection year.
     *
     * The naming queue stopping the clock is a choice, not a rule of the
     * engine — `stepYear` does not care. Naming is one of the few things the
     * player does to a person rather than to a bloodline, and it should be
     * able to interrupt a century.
     */
    advance(years) {
      const g = session.value;
      if (!g) return;
      // Turning the clock is moving on. An outcome held from the last answer
      // and still on screen behind a jump would be describing a different year.
      outcome.value = null;
      const said: RememberedPassage[] = [];
      // Every beat this press produced, opens and closings both, in the order
      // the years turned them out — see `ChapterBeat`. Unlike `passages` this
      // is not trimmed and not reversed: every one of them queues.
      const beats: ChapterBeat[] = [];
      // The account of THIS press, summed out of the years it turned. Reset
      // here rather than added to, because it answers "did that go well?" and
      // the question is about the press the player just made.
      let moved: StandingDelta | null = null;
      for (let i = 0; i < years; i++) {
        const before = g.view();
        if (before.ending) break;
        if (g.pending.length || before.namesWanted.length) break;
        const turned = g.advance(1);
        moved = foldStanding(moved, turned.changed);
        said.push(...rememberCast(turned.passages, before.cast));
        for (const opening of turned.opened) beats.push({ kind: 'opening', opening });
        for (const view of turned.chapters) beats.push({ kind: 'closing', view });
      }

      // ARRIVING AT THE TERM IS NOT THE SAME AS BEING READ. `stepYear` closes
      // the ledger on the step it is asked to take AFTER the collection year has arrived, so
      // a run that lands exactly on the year — which every run does, since the
      // clock stops there — would sit unended until the player pressed a
      // button that visibly does nothing. One more turn of the handle, here,
      // where the client is already deciding what a press of "on" means.
      const beforeTerm = g.view();
      if (!beforeTerm.ending && beforeTerm.year >= beforeTerm.campaign.endYear && !g.pending.length) {
        const turned = g.advance(1);
        moved = foldStanding(moved, turned.changed);
        said.push(...rememberCast(turned.passages, beforeTerm.cast));
        for (const opening of turned.opened) beats.push({ kind: 'opening', opening });
        for (const view of turned.chapters) beats.push({ kind: 'closing', view });
      }

      // Newest first, to read the way the chronicle beside it reads. Guarded,
      // because `advance` is a no-op whenever something is waiting and a new
      // array every time the player presses a blocked button is a re-render
      // that says nothing.
      if (said.length) {
        passages.value = [...said.reverse(), ...passages.value].slice(0, PASSAGE_TAIL);
      }
      // EVERY beat this press produced queues — nothing here is trimmed to
      // "the latest," which is `showInterlude`'s rule and the wrong one for a
      // chapter (issue #65: "every Age closing gets a card").
      if (beats.length) {
        chapterQueue.value = [...chapterQueue.value, ...beats];
        for (const beat of beats) {
          if (beat.kind === 'closing' && beat.view.boundary) saveChapterBoundary(g, beat.view);
        }
      }
      // Null rather than a delta of zeroes: a header permanently decorated
      // with "(0)" is the noise this is meant to remove, and a press that was
      // eaten by a waiting docket must say nothing rather than say nothing
      // happened.
      jump.value = moved && standingMoved(moved) ? moved : null;
      refresh();
      showInterlude();
    },

    choose(decision, choiceId, cast = {}, said = '') {
      const result = session.value?.choose(decision, choiceId, cast);
      hold(result?.ok ? { said, text: result.resolved?.text ?? null, kind: 'choice' } : null);
      refresh();
    },

    send(decision, cast = {}, said = '') {
      const result = session.value?.send(decision, cast);
      hold(result?.ok ? { said, text: result.resolved?.text ?? null, kind: 'choice' } : null);
      refresh();
    },

    match(decision, cardId, said = '') {
      const result = session.value?.match(decision, cardId);
      // THE REFUSAL, DRAWN WHERE THE CARD IS (issue #83). Belt and braces
      // behind the engine-side close: the panel should never be able to
      // offer a card that refuses, and if one ever does the player is told
      // rather than left clicking a button that does nothing.
      refusedCard.value = result && !result.ok
        ? { card: cardId, reason: result.reason ?? 'the house cannot' }
        : null;
      hold(result?.ok ? { said, text: result.line ?? null, kind: 'match' } : null);
      refresh();
      return result;
    },

    declineHand(decision) {
      session.value?.declineHand(decision);
      refusedCard.value = null;
      refresh();
    },

    record(decision, option, said = '') {
      const result = session.value?.record(decision, option);
      hold(result?.ok ? { said, text: result.line ?? null, kind: 'record' } : null);
      refresh();
    },

    dismissOutcome() {
      outcome.value = null;
    },

    setAmbition(id) {
      const ok = session.value?.setAmbition(id) ?? false;
      refresh();
      return ok;
    },

    letHimDecide() {
      session.value?.letHimDecide();
      // A hundred answers at once have no single outcome. Showing the last
      // one as though it were the point would be worse than showing none.
      outcome.value = null;
      refusedCard.value = null;
      refresh();
    },

    order(o) {
      const result = session.value?.order(o) ?? { ok: false, reason: 'no run' };
      refusal.value = result.ok
        ? null
        : { kind: o.kind, reason: result.reason ?? 'the house will not' };
      // Only where money moved. An order that cost nothing gets no receipt,
      // and a refusal gets the reason it already had.
      receipt.value = result.ok && result.spent !== undefined
        ? `${result.spent} spent. ${result.left} left.`
        : null;
      refresh();
      return result;
    },

    muster(o) {
      const result = session.value?.muster(o) ?? { ok: false, reason: 'no run' };
      musterRefusal.value = result.ok
        ? null
        : { op: o.op, reason: result.reason ?? 'the house will not' };
      refresh();
      return result;
    },

    name(person, newName) {
      const ok = session.value?.name(person, newName) ?? false;
      refresh();
      return ok;
    },

    nameParcel(parcel, newName) {
      const ok = session.value?.nameParcel(parcel, newName) ?? false;
      refresh();
      return ok;
    },

    keepSuggestedNames() {
      session.value?.keepSuggestedNames();
      refresh();
    },

    keepSuggestedName(person) {
      const ok = session.value?.keepSuggestedName(person) ?? false;
      refresh();
      return ok;
    },

    // Read-only, so no `refresh()`: taking the picture again after a read
    // would be a client that thinks looking at something changes it.
    book(opts) {
      return session.value?.book(opts) ?? [];
    },

    line() {
      return session.value?.line() ?? [];
    },

    dismissInterlude() {
      interlude.value = null;
    },

    dismissChapter() {
      chapterQueue.value = chapterQueue.value.slice(1);
    },
  };

  /**
   * THE FRAME IS QUIETER THAN THE TALE (concept §24).
   *
   * One interlude is held on screen with the family out of the way; the rest
   * of what a long jump produced goes to the ledger, where the frame is
   * legible as a layer rather than as a moment. A player who pressed "on" has
   * asked not to be interrupted twenty times.
   */
  function showInterlude(): void {
    const entries = view.value?.frame ?? [];
    if (entries.length > seenFrame) interlude.value = entries[entries.length - 1] ?? null;
    seenFrame = entries.length;
  }

  /**
   * A HARD, NAMED AUTOSAVE AT A CHAPTER BOUNDARY (issue #65, item 3).
   *
   * `keep()` writes the rolling `AUTOSAVE` slot after every verb — this is a
   * second, distinct save, in a slot of its own, at the one moment in a run
   * that is a good place to put the story down. Keyed by the Age and the year
   * it closed rather than by `began`: an Age recurs, so `age-<began>` would
   * be unique per Age INSTANCE, and a `ChapterView` does not carry `began` in
   * the first place — it is a window between two closings, not an Age's own
   * span (see `chapter.ts`). `(age, to)` is unique for the same reason `to`
   * partitions the run: two closings never share a year.
   */
  function saveChapterBoundary(g: GameSession, view: ChapterView): void {
    const slot = `chapter-${view.age}-${view.to}`;
    void platform.writeSave(slot, g.save()).then(refreshSaves).catch(() => undefined);
  }

  function archiveFinished(g: GameSession): void {
    if (!libraryReady.value) return;
    const run = g.libraryRun();
    if (!run || archivedRunId === run.id) return;
    library.value = appendLibraryRun(library.value, run);
    archivedRunId = run.id;
    void platform.writeLibrary(library.value).catch(() => {
      // Keep the run playable even if profile persistence fails. Autosave has
      // its own status; the library is retention metadata, never run state.
      archivedRunId = null;
    });
  }

  /** Write after every completed client verb, and once more at host pause. */
  function keep(g: GameSession): void {
    const save = g.save();
    archiveFinished(g);
    keptSave = save;
    resumable.value = true;
    saveStatus.value = 'saving';
    void platform.writeSave(AUTOSAVE, save)
      .then(() => { saveStatus.value = 'saved'; })
      .then(refreshSaves)
      .catch(() => { resumable.value = false; saveStatus.value = 'error'; });
  }

  function loadSave(save: unknown | null, discardAutosave = false): boolean {
    if (!save) return false;
    try {
      start(resumeGame(save, source));
      return true;
    } catch {
      // A format that cannot be read is not a run we can safely continue. A
      // named slot stays available for export or a later migration; only the
      // rolling slot is cleared when its own resume attempt failed.
      if (discardAutosave) forget();
      return false;
    }
  }

  async function refreshSaves(): Promise<void> {
    try { saves.value = await platform.listSaves(); } catch { saves.value = []; }
  }

  async function readKept(): Promise<unknown | null> {
    try {
      keptSave = await platform.readSave(AUTOSAVE);
      resumable.value = keptSave !== null;
      return keptSave;
    } catch {
      keptSave = null;
      resumable.value = false;
      return null;
    }
  }

  function forget(): void {
    keptSave = null;
    resumable.value = false;
    void platform.deleteSave(AUTOSAVE).catch(() => undefined);
  }

  const libraryLoad = platform.readLibrary()
    .then((raw) => { library.value = readRunLibrary(raw); })
    .catch(() => { library.value = emptyRunLibrary(); })
    .finally(() => {
      libraryReady.value = true;
      // A resumed save may already be on its ending screen. If the host read
      // finished after it loaded, archive it now rather than waiting for a
      // verb the player may never press.
      const g = session.value;
      if (g) archiveFinished(g);
    });

  // Native stores answer asynchronously, so discover a resumable run after
  // composition instead of assuming a browser-only storage API exists.
  void libraryLoad;
  void readKept();
  void refreshSaves();
  platform.onPause(() => {
    const g = session.value;
    if (g) keep(g);
  });

  return {
    view, table, land, prologue, openingSeen, epilogue, docket, passages, jump, interlude, chapter, frame, ended,
    refused, refusal, receipt, musterRefusal, outcome, refusedCard, resumable, saveStatus, saves, library, libraryReady, actions,
  };
}
