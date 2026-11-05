import type { ChronicleView, MusterOrder, RecordOption, TableOrder } from '@ed/core';
import { readingLogMusterCategory, readingLogTableCategory } from './content.js';
import { parseRecordOption, type GameActions } from './game.js';

/**
 * THE READING LOG (#1945). An opt-in research recorder, off by default.
 *
 * `gate:long` measures the silence between answers in game years. A reader
 * does not live in game years: a sixty-year gap is a minute of turning pages
 * for one player and an evening of decisions for another. This records what a
 * reader was shown and when the window was in front of them, so a playtest can
 * put the two clocks side by side.
 *
 * It is a reader-side observer and nothing else. It reads the view the store
 * already publishes and passes every verb straight through; it writes nothing
 * to the world, the save or the command log, keeps nothing between page loads,
 * and sends nothing anywhere. The only way out is the reader pressing Export.
 *
 * Three cautions travel inside every artifact, because the numbers will be
 * read by somebody who did not write this:
 *   - "foreground" is an exposure proxy — the page was visible and focused —
 *     not a measurement of reading;
 *   - game years are simulation pacing, not time;
 *   - an interval cut off by a reload, an export or the cap is censored: it
 *     says the next answer had not come YET, not that it never would.
 */

/** 12: opt-in Table action outcome summaries, with censored incomplete attempts. */
export const READING_LOG_FORMAT = 'ed-reading-log/12';

/** `?reading-log=1` turns it on for this page load, and nothing else does. */
export const READING_LOG_QUERY = 'reading-log';

/** Bounded, so a forgotten switch cannot fill the reader's disk. */
export const READING_LOG_MAX_EVENTS = 20_000;

/** What the notice says, word for word — the switch is not informed consent without it. */
export const READING_LOG_NOTICE =
  'Reading log is on. On this device only, it records which pages and decisions are shown, the in-game year, '
  + 'when this window is in front, which panel is open, which buttons you press, whether founding was accepted or refused, which signing section you reach, and whether entry returned, Record/Omit/Embellish modes, generated decision ids and results, whether family choices and Matches were accepted or refused, and Table/Muster/delegation categories and results. It records no text you type, '
  + 'is not part of your saved game, and leaves this device only if you export it.';

export const READING_LOG_CAVEATS = [
  'foregroundMs counts time the page was visible and focused outside declared breaks: an exposure proxy, not reading time.',
  'Game years are simulation pacing, not elapsed time.',
  'A censored gap ended without a next answer (export, stop, unload, new house or the event cap); it is a lower bound.',
  'After the event cap, no further time is measured. The terminal marker uses the cap instant even if Export is pressed later.',
  'Beginning another house censors the old answer gap: page ids and game-year gaps do not carry across houses.',
  'The first gap starts at the log, not at an answer, and the first after a resumed save starts at the resume: neither is a whole answer-to-answer interval.',
  'The first Chronicle window after a successful saved-run pickup is carried history; the prior house gap is censored, not continued into the loaded save.',
  'For Record, Table, Muster and delegation, attempted and terminal action events form pairs. An unpaired attempt means an interruption or capped log, not a refusal. Delegation returning is not proof it made a change.',
  'Unknown Table and Muster categories are recorded as unknown, never as unvalidated caller text.',
  'Table action summary counts only terminal results paired with an attempt in the same window; unmatched terminals are ignored, and unfinished attempts may be interrupted, capped or have an unreadable outcome. None is a refusal.',
  'Record actions carry the chosen mode, generated decision id and whether the game accepted it, but no typed wording. A Record action alone does not prove a later page was read back.',
  'Choose and Match record acceptance or refusal from their returned result, not an attempted click. Other answer verbs without a returned outcome remain attempts only; a Match refusal may include an unavailable card.',
  'A share-code start marks a new run only after acceptance; neither its code nor the recipient names are recorded.',
  'Signing markers distinguish a founding attempt from accepted, refused or thrown results; enter returning is not proof a meaningful family decision was taken. Names, founder answers and refusal reasons are never recorded.',
  'Signing-section pane markers name only founder, examination or house; their timestamps are exposure boundaries, not evidence of comprehension or a completed section.',
  'An entry timing starts at a successful Begin, not at recorder activation. Its first accepted gameplay command is only a candidate family decision: an observer must verify the command was consequential. Incomplete or interrupted entries are censored, not abandoned.',
  'seen marks a decision whose authored scene this device had shown before; revisit marks a page already shown in this log; '
    + 'carried marks a page already in the chronicle when a saved run was picked up. Revisits and carried pages answer nothing.',
] as const;

export function readingLogRequested(search: string): boolean {
  // This research recorder is opt-in. Ambiguous duplicate switches must not
  // silently take the first value and turn recording on despite a later "off".
  const values = new URLSearchParams(search).getAll(READING_LOG_QUERY);
  return values.length === 1 && ['', '1', 'on', 'true', 'yes'].includes(values[0]!.toLowerCase());
}

export type ReadingAnswerKind = 'interlude' | NonNullable<ChronicleView['answer']>;

/** The verbs worth a line. Reads (`book`, `advice`, …) are not actions. */
const RECORDED_VERBS = {
  begin: 'start',
  beginFromShareCode: 'start',
  resume: 'start',
  load: 'start',
  importSave: 'start',
  found: 'signing',
  enter: 'signing',
  advance: 'advance',
  letHimDecide: 'answer',
  choose: 'answer',
  send: 'answer',
  match: 'answer',
  declineHand: 'answer',
  record: 'answer',
  dismissOutcome: 'dismiss',
  dismissInterlude: 'dismiss',
  dismissChapter: 'dismiss',
  order: 'table',
  muster: 'muster',
  delegateChoice: 'delegate',
  delegateRecord: 'delegate',
} as const satisfies Partial<Record<keyof GameActions, 'start' | 'signing' | 'advance' | 'answer' | 'dismiss' | 'table' | 'muster' | 'delegate'>>;

export type RecordedVerb = keyof typeof RECORDED_VERBS;
type LegacyVerb = Exclude<RecordedVerb, 'found' | 'enter' | 'record' | 'choose' | 'match' | 'order' | 'muster' | 'delegateChoice' | 'delegateRecord'>;

/** The verbs that pick up a saved run, whose chronicle the reader saw in some other session. */
const PICKUPS: ReadonlySet<RecordedVerb> = new Set(['resume', 'load', 'importSave']);

export type EndReason = 'exported' | 'stopped' | 'unloaded';

/** `at` is milliseconds since the log started, off a monotonic clock. */
export type ReadingLogEvent =
  | { at: number; kind: 'visible'; visible: boolean }
  | { at: number; kind: 'focus'; focused: boolean }
  | { at: number; kind: 'break'; on: boolean }
  | { at: number; kind: 'pane'; pane: string }
  | { at: number; kind: 'prose'; mode: string }
  | { at: number; kind: 'run'; campaign: string; seed: number }
  | { at: number; kind: 'pickup' }
  | { at: number; kind: 'year'; year: number }
  | { at: number; kind: 'page'; year: number; page: string; event?: string; answer?: ReadingAnswerKind; revisit?: true; carried?: true }
  | { at: number; kind: 'interlude'; year: number; event: string; answer: 'interlude'; revisit?: true }
  | { at: number; kind: 'decision'; year: number; decision: string; event: string; seen: boolean }
  | { at: number; kind: 'action'; verb: LegacyVerb; act: (typeof RECORDED_VERBS)[LegacyVerb]; years?: number }
  | { at: number; kind: 'action'; verb: 'found'; act: 'signing'; status: 'attempted' | 'accepted' | 'refused' | 'threw' }
  | { at: number; kind: 'action'; verb: 'enter'; act: 'signing'; status: 'attempted' | 'returned' | 'threw' }
  | { at: number; kind: 'action'; verb: 'record'; act: 'answer'; mode: RecordOption | 'unknown'; decision?: string; status: 'attempted' | 'accepted' | 'refused' | 'threw' }
  | { at: number; kind: 'action'; verb: 'choose' | 'match'; act: 'answer'; status: 'attempted' | 'accepted' | 'refused' | 'threw' }
  | { at: number; kind: 'action'; verb: 'order'; act: 'table'; category: TableOrder['kind'] | 'unknown'; status: 'attempted' | 'accepted' | 'refused' | 'threw' }
  | { at: number; kind: 'action'; verb: 'muster'; act: 'muster'; category: MusterOrder['op'] | 'unknown'; status: 'attempted' | 'accepted' | 'refused' | 'threw' }
  | { at: number; kind: 'action'; verb: 'delegateChoice' | 'delegateRecord'; act: 'delegate'; category: 'choice' | 'record'; change: 'set' | 'clear'; status: 'attempted' | 'returned' | 'threw' }
  | { at: number; kind: 'ended' }
  | { at: number; kind: 'end'; reason: EndReason };

type Untimed<E> = E extends ReadingLogEvent ? Omit<E, 'at'> : never;

export interface ReadingLogBuild {
  /** The commit the client was built from; `unknown` when the build could not say. */
  sha: string;
  /** Declared at build time (`ED_BUILD_PLATFORM`); the client never names its host. */
  platform: string;
}

/** One stretch between two answers, on three clocks. */
export interface AnswerGap {
  from: { at: number; year: number | null; kind: ReadingAnswerKind | 'start' };
  to: { at: number; year: number | null; kind: ReadingAnswerKind | EndReason | 'cap' | 'open' | 'new-run' };
  wallMs: number;
  foregroundMs: number;
  years: number | null;
  decisions: number;
  censored: boolean;
}

/** A completed command is a candidate first family action, not a claim about its meaning. */
export type EntryCommand = 'choose' | 'match' | 'order' | 'muster' | 'record';

/** One accepted new-house start, bounded by a later start, pickup, or log end. */
export interface EntryTiming {
  startedAt: number;
  campaign: string | null;
  foundedAt: number | null;
  enteredAt: number | null;
  firstAcceptedCommand: { at: number; verb: EntryCommand } | null;
  /** Interval after accepted Begin, excluding time on the title screen. */
  wallMs: number;
  foregroundMs: number;
  /** No accepted command observed before this entry was cut off. */
  censored: boolean;
}

/** A bounded category and its observed action outcomes; no order arguments or refusal text. */
export interface TableActionCounts {
  category: string;
  attempts: number;
  accepted: number;
  refused: number;
  threw: number;
  returned: number;
  /** An attempt with no matching terminal marker is censored, not refused. */
  unfinished: number;
}

export interface TableActionSummary {
  orders: TableActionCounts[];
  muster: TableActionCounts[];
  /** Categories distinguish choice/record delegation and set/clear. */
  delegation: TableActionCounts[];
}

export interface ReadingLogSummary {
  /** Compare first-session paths without mistaking button attempts for success. */
  entries: EntryTiming[];
  wallMs: number;
  foregroundMs: number;
  hiddenMs: number;
  unfocusedMs: number;
  breakMs: number;
  answers: number;
  decisions: number;
  /** Per-category Table/Muster/delegation actions and terminal outcomes (#2526). */
  tableActions: TableActionSummary;
  /** Decisions shown per hour in the foreground. An estimate, and labelled one. */
  decisionsPerForegroundHourEstimate: number | null;
  gaps: AnswerGap[];
}

export interface ReadingLogArtifact {
  format: typeof READING_LOG_FORMAT;
  build: ReadingLogBuild;
  startedAt: string;
  notice: string;
  caveats: readonly string[];
  truncated: boolean;
  events: ReadingLogEvent[];
  summary: ReadingLogSummary;
}

/**
 * The recorder. The clock is a parameter so a test can turn it by hand, and
 * the DOM is somebody else's problem (`attachReadingLog`).
 */
export class ReadingLog {
  readonly events: ReadingLogEvent[] = [];
  truncated = false;
  /** The first instant after the log filled, before unobserved time begins. */
  #cappedAt: number | null = null;
  #ended: EndReason | null = null;
  readonly #origin: number;
  readonly #shown = new Set<string>();
  readonly #last = new Map<string, string>();
  /** The chronicle window last seen, so the next one can say what is new in it. */
  #window = new Set<string>();
  /** A saved run is being picked up: its first window is history, not news. */
  #pickingUp = false;
  /** Keep the loaded run's year until its Chronicle confirms the pickup. */
  #pendingPickupYear: number | null = null;
  /** A newer start must not be cancelled by an older asynchronous pickup. */
  #startGeneration = 0;

  constructor(
    private readonly now: () => number,
    readonly build: ReadingLogBuild,
    readonly startedAt: string,
    initial: { visible: boolean; focused: boolean },
  ) {
    this.#origin = now();
    this.note({ kind: 'visible', visible: initial.visible });
    this.note({ kind: 'focus', focused: initial.focused });
  }

  get ended(): EndReason | null { return this.#ended; }
  /** The wrapper associates an async pickup's outcome with the start it observed. */
  get startGeneration(): number { return this.#startGeneration; }

  /**
   * Add one event. A state that has not changed is not an event — a second
   * `focus` while focused would otherwise split an interval in two — and an
   * ended or full log takes nothing more.
   */
  note(event: Untimed<ReadingLogEvent>): void {
    if (this.#ended || this.truncated) return;
    // App.vue observes the new year before the Chronicle that confirms a
    // saved-run pickup. Do not write that year into the previous house's gap.
    if (event.kind === 'year' && this.#pickingUp) {
      this.#pendingPickupYear = event.year;
      return;
    }
    if (event.kind === 'action' && event.act === 'start') {
      this.#startGeneration++;
      this.#pickingUp = PICKUPS.has(event.verb);
      this.#pendingPickupYear = null;
      if (event.verb === 'begin' || event.verb === 'beginFromShareCode') {
        // The next house can reuse every Chronicle id (especially with a
        // repeated seed). A page fresh to that house is not a revisit to
        // another one, and its first chronicle window is new evidence.
        this.#shown.clear();
        this.#window.clear();
        this.#last.delete('run');
        this.#last.delete('year');
      }
    }
    const state = stateKey(event);
    if (state) {
      if (this.#last.get(state[0]) === state[1]) return;
      this.#last.set(state[0], state[1]);
    }
    if (this.events.length >= READING_LOG_MAX_EVENTS - 1) {
      // Once further foreground/visibility events cannot be stored, the
      // exposure clock must stop. Otherwise an export hours later silently
      // counts unobserved time as if the last known focus state still held.
      this.#cappedAt = this.now() - this.#origin;
      this.truncated = true;
      return;
    }
    this.events.push({ ...event, at: this.now() - this.#origin } as ReadingLogEvent);
  }

  /**
   * The view's chronicle window, each time it changes. A page that was not in
   * the last window has just come on screen. The first window after a saved
   * run is picked up is that run's history — read, or skipped, in a session
   * this log never saw — so every page in it is `carried` and answers nothing.
   */
  chronicle(entries: readonly Pick<ChronicleView, 'id' | 'year' | 'eventId' | 'answer'>[] | undefined): void {
    if (!entries) return;
    const carried = this.#pickingUp;
    this.#pickingUp = false;
    if (carried) {
      // A matching new-world year might not trigger Vue's year watcher at all.
      // Use the last observed one then, but prefer a changed year deferred
      // while the pickup was pending. Confirm it AFTER the pickup boundary.
      const previousYear = this.#last.get('year');
      const pickupYear = this.#pendingPickupYear
        ?? (previousYear === undefined ? null : Number(previousYear));
      this.#pendingPickupYear = null;
      // A load/import/resume can replace the current house without a Begin.
      // Saved houses can reuse the exact Chronicle ids we saw in the previous
      // house. The first window is carried history, but it must be recorded
      // once in its own identity epoch instead of being dropped as unchanged.
      this.#shown.clear();
      this.#window.clear();
      this.#last.delete('run');
      this.#last.delete('year');
      // A loaded save is a boundary for observer gaps as well as page IDs;
      // only a successfully displayed Chronicle produces this marker.
      this.note({ kind: 'pickup' });
      if (pickupYear !== null) this.note({ kind: 'year', year: pickupYear });
    }
    for (const entry of entries) if (entry.id && !this.#window.has(entry.id)) this.page(entry.year, entry, carried);
    this.#window = new Set(entries.flatMap((entry) => (entry.id ? [entry.id] : [])));
  }

  /**
   * A pick-up that came back without a run — a cancelled picker, an unreadable
   * save — leaves the run on screen as it was, and its next page is news.
   */
  pickUpFailed(generation: number): void {
    // The old import/load may finish after another pickup has begun (or a
    // new game has started). Its failure cannot erase that newer boundary.
    if (generation === this.#startGeneration) {
      this.#pickingUp = false;
      this.#pendingPickupYear = null;
    }
  }

  /** A chronicle page came on screen. The second time it is a revisit. */
  page(year: number, entry: Pick<ChronicleView, 'id' | 'eventId' | 'answer'>, carried = false): void {
    if (!entry.id) return;
    const revisit = this.#seen(`page:${entry.id}`);
    this.note({
      kind: 'page', year, page: entry.id,
      ...(entry.eventId ? { event: entry.eventId } : {}),
      ...(entry.answer ? { answer: entry.answer } : {}),
      ...(revisit ? { revisit } : {}),
      ...(carried ? { carried: true as const } : {}),
    });
  }

  interlude(year: number, event: string): void {
    const revisit = this.#seen(`interlude:${year}:${event}`);
    this.note({ kind: 'interlude', year, event, answer: 'interlude', ...(revisit ? { revisit } : {}) });
  }

  end(reason: EndReason): void {
    if (this.#ended) return;
    // The end must always fit, or every gap after the cap loses its censoring.
    // Preserve the terminal reason without inventing a recorded interval
    // after the event cap. Both the last marker and the summary stop there.
    this.events.push({ kind: 'end', reason, at: this.#cappedAt ?? this.now() - this.#origin });
    this.#ended = reason;
  }

  artifact(): ReadingLogArtifact {
    const events = this.events.map((e) => ({ ...e }));
    return {
      format: READING_LOG_FORMAT,
      build: { ...this.build },
      startedAt: this.startedAt,
      notice: READING_LOG_NOTICE,
      caveats: READING_LOG_CAVEATS,
      truncated: this.truncated,
      events,
      summary: summarize(events, this.#cappedAt ?? this.now() - this.#origin, this.truncated),
    };
  }

  #seen(key: string): true | undefined {
    if (this.#shown.has(key)) return true;
    this.#shown.add(key);
    return undefined;
  }
}

function stateKey(event: Untimed<ReadingLogEvent>): [string, string] | null {
  switch (event.kind) {
    case 'visible': return ['visible', String(event.visible)];
    case 'focus': return ['focus', String(event.focused)];
    case 'break': return ['break', String(event.on)];
    case 'pane': return ['pane', event.pane];
    case 'prose': return ['prose', event.mode];
    case 'year': return ['year', String(event.year)];
    case 'run': return ['run', `${event.campaign}:${event.seed}`];
    case 'page': case 'interlude': case 'decision': case 'action': case 'pickup': case 'ended': case 'end':
      return null;
    default: return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled reading-log event: ${JSON.stringify(value)}`);
}

/**
 * Only category enums already validated at collection time enter this read-only
 * projection. The paired action markers make outcomes observable without
 * copying names, order payloads, free text or refusal reasons into the summary.
 */
function tableActionsOf(events: readonly ReadingLogEvent[], stop: number): TableActionSummary {
  const orders = new Map<string, TableActionCounts>();
  const muster = new Map<string, TableActionCounts>();
  const delegation = new Map<string, TableActionCounts>();
  type Terminal = 'accepted' | 'refused' | 'threw' | 'returned';
  const count = (group: Map<string, TableActionCounts>, category: string, status: 'attempted' | Terminal) => {
    let row = group.get(category);
    if (status !== 'attempted') {
      // An interrupted action can finish after an observation-window boundary.
      // Without its attempt in THIS window, a terminal marker proves nothing
      // about this house's accepted/refused work. Never import that result.
      if (!row || row.accepted + row.refused + row.threw + row.returned >= row.attempts) return;
    }
    if (!row) {
      row = { category, attempts: 0, accepted: 0, refused: 0, threw: 0, returned: 0, unfinished: 0 };
      group.set(category, row);
    }
    if (status === 'attempted') row.attempts++;
    else row[status]++;
  };
  for (const event of events) {
    if (event.at > stop || event.kind !== 'action') continue;
    if (event.verb === 'order') count(orders, event.category, event.status);
    else if (event.verb === 'muster') count(muster, event.category, event.status);
    else if (event.verb === 'delegateChoice' || event.verb === 'delegateRecord') {
      count(delegation, `${event.category}:${event.change}`, event.status);
    }
  }
  const rows = (group: Map<string, TableActionCounts>) => [...group.values()]
    .map((row) => ({
      ...row,
      unfinished: Math.max(0, row.attempts - row.accepted - row.refused - row.threw - row.returned),
    }))
    .sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  return { orders: rows(orders), muster: rows(muster), delegation: rows(delegation) };
}


/**
 * A bounded observation window for one house as seen by this device. This is
 * not a "generation": the reading log cannot prove a Head's complete tenure.
 * A Begin or a displayed saved-run pickup ends the prior window, even when
 * both houses use the same seed, year or Chronicle page ids.
 */
export interface TableWorkloadWindow {
  source: 'initial' | 'begin' | 'pickup';
  endedBy: 'begin' | 'pickup' | 'end' | 'open' | 'cap';
  startedAt: number;
  endedAt: number;
  campaign: string | null;
  seed: number | null;
  firstObservedYear: number | null;
  lastObservedYear: number | null;
  /** Difference between observed year markers, NOT years exposed or a complete tenure. */
  observedYearDelta: number | null;
  /** All visible, focused, unbroken time during this window. */
  foregroundMs: number;
  /** Only foreground time while the player had the Table pane selected. */
  tableForegroundMs: number;
  /** Attempts and terminal results for this window only; unfinished is censored. */
  actions: TableActionSummary;
}

/**
 * Re-analyze existing ed-reading-log/12 artifacts without changing their
 * format, events, saved games or export contract (#1992).
 *
 * A start attempt is not a boundary: Begin is logged only after success, and
 * a saved-run pickup only when its first Chronicle window is displayed.
 * Prior Table activity is never silently attributed to the next house.
 */
export function tableWorkloadWindows(
  events: readonly ReadingLogEvent[],
  until: number,
  truncated = false,
): TableWorkloadWindow[] {
  const end = events.find((e) => e.kind === 'end');
  const stop = Math.max(0, Math.min(until, end?.at ?? until));
  const windows: TableWorkloadWindow[] = [];
  let visible = true;
  let focused = true;
  let onBreak = false;
  let pane: string | null = null;
  // A selected pane can remain behind the full-screen frame. Its controls
  // are not exposed while an interlude or the last night is on screen.
  let interlude = false;
  let ended = false;
  let lastAt = 0;
  const newWindow = (source: TableWorkloadWindow['source'], at: number) => ({
    source, startedAt: at, campaign: null as string | null, seed: null as number | null,
    firstYear: null as number | null, lastYear: null as number | null,
    foregroundMs: 0, tableForegroundMs: 0, actions: [] as ReadingLogEvent[],
    hasEvidence: source !== 'initial',
  });
  let current = newWindow('initial', 0);
  // Vue's pre-flush run watcher fires before the Chronicle watcher confirms
  // a saved-run pickup. Hold that run marker until the pickup boundary; a
  // cancelled/refused pickup must not replace the previous house's identity.
  let awaitingPickup = false;
  let pendingRun: { campaign: string; seed: number } | null = null;
  // App.vue emits run -> year -> Chronicle in one Vue flush. A year seen
  // before Chronicle confirms the pickup belongs to the incoming house,
  // not the previous window's last observed year.
  let pendingYear: number | null = null;
  const advance = (at: number) => {
    const to = Math.max(lastAt, Math.min(at, stop));
    const span = to - lastAt;
    if (visible && focused && !onBreak) {
      current.foregroundMs += span;
      if (pane === 'table' && !interlude && !ended) current.tableForegroundMs += span;
    }
    lastAt = to;
  };
  const finish = (at: number, endedBy: TableWorkloadWindow['endedBy']) => {
    // A persisted/stale pane selection can still say "table" on Start.
    // Pane exposure alone is not proof that a house was ever opened; only a
    // successful Begin, displayed pickup, run or actual game action establishes
    // a workload window. Do not manufacture a whole initial house from UI.
    if (!current.hasEvidence) return;
    windows.push({
      source: current.source, endedBy, startedAt: current.startedAt, endedAt: at,
      campaign: current.campaign, seed: current.seed,
      firstObservedYear: current.firstYear, lastObservedYear: current.lastYear,
      observedYearDelta: current.firstYear === null || current.lastYear === null
        ? null : Math.max(0, current.lastYear - current.firstYear),
      foregroundMs: current.foregroundMs, tableForegroundMs: current.tableForegroundMs,
      actions: tableActionsOf(current.actions, at),
    });
  };
  for (const event of events) {
    if (event.at > stop) break;
    advance(event.at);
    if (event.kind === 'pickup') {
      // Reuse the previous run identity when the loaded world has the same
      // public campaign/seed (so Vue emitted no distinct run marker).
      const nextRun = pendingRun ?? (current.campaign === null || current.seed === null
        ? null : { campaign: current.campaign, seed: current.seed });
      finish(event.at, 'pickup');
      current = newWindow('pickup', event.at);
      if (pendingYear !== null) {
        current.firstYear = pendingYear;
        current.lastYear = pendingYear;
      }
      interlude = false;
      ended = false;
      if (nextRun) {
        current.campaign = nextRun.campaign;
        current.seed = nextRun.seed;
      }
      awaitingPickup = false;
      pendingRun = null;
      pendingYear = null;
      continue;
    }
    if (event.kind === 'action' && event.act === 'start'
      && (event.verb === 'begin' || event.verb === 'beginFromShareCode')) {
      finish(event.at, 'begin');
      current = newWindow('begin', event.at);
      interlude = false;
      ended = false;
      awaitingPickup = false;
      pendingRun = null;
      pendingYear = null;
      continue;
    }
    if (event.kind === 'visible') visible = event.visible;
    else if (event.kind === 'focus') focused = event.focused;
    else if (event.kind === 'break') onBreak = event.on;
    else if (event.kind === 'pane') pane = event.pane;
    else if (event.kind === 'run') {
      if (awaitingPickup) pendingRun = { campaign: event.campaign, seed: event.seed };
      else {
        current.hasEvidence = true;
        current.campaign = event.campaign;
        current.seed = event.seed;
      }
    } else if (event.kind === 'year') {
      if (awaitingPickup) {
        pendingYear = event.year;
      } else {
        current.hasEvidence = true;
        if (current.firstYear === null) current.firstYear = event.year;
        current.lastYear = event.year;
      }
    } else if (event.kind === 'action') {
      if (event.act === 'start'
        && (event.verb === 'resume' || event.verb === 'load' || event.verb === 'importSave')) {
        awaitingPickup = true;
        pendingRun = null;
        pendingYear = null;
        // A canceled picker on the title screen says nothing about a house.
        // Preserve an existing window, but wait for actual run evidence or
        // the confirmed pickup before creating one.
      } else current.hasEvidence = true;
      if (event.verb === 'dismissInterlude') interlude = false;
      current.actions.push(event);
    } else if (event.kind === 'page' || event.kind === 'decision' || event.kind === 'interlude') {
      current.hasEvidence = true;
      if (event.kind === 'interlude') interlude = true;
    } else if (event.kind === 'ended') ended = true;
  }
  advance(stop);
  // A capped log has stopped observing, even if Export later appends an
  // 'end' marker at the cap instant. Report that censoring, not a complete end.
  finish(stop, truncated && (!end || end.at <= until) ? 'cap'
    : end && end.at <= until ? 'end' : 'open');
  return windows;
}

/**
 * Fold the events into the three clocks. Exported so a researcher's analysis
 * and the artifact's own summary are the same arithmetic.
 *
 * `until` is where an unfinished log stops counting. Foreground needs all
 * three of visible, focused and not on a declared break; a hidden tab counts
 * as hidden whatever else is true, and a declared break as a break.
 */
export function summarize(events: readonly ReadingLogEvent[], until: number, truncated = false): ReadingLogSummary {
  let visible = true, focused = true, onBreak = false;
  let year: number | null = null;
  let last = 0;
  let foreground = 0, hidden = 0, unfocused = 0, breaks = 0;
  const end = events.find((e) => e.kind === 'end');
  const stop = Math.max(0, Math.min(until, end?.at ?? until));

  const gaps: AnswerGap[] = [];
  const entries: EntryTiming[] = [];
  let entry: { startedAt: number; foregroundAt: number; campaign: string | null;
    foundedAt: number | null; enteredAt: number | null } | null = null;
  const finishEntry = (at: number, firstAcceptedCommand: EntryTiming['firstAcceptedCommand'] = null) => {
    if (!entry) return;
    entries.push({
      startedAt: entry.startedAt, campaign: entry.campaign,
      foundedAt: entry.foundedAt, enteredAt: entry.enteredAt,
      firstAcceptedCommand, wallMs: at - entry.startedAt,
      foregroundMs: foreground - entry.foregroundAt,
      censored: firstAcceptedCommand === null,
    });
    entry = null;
  };
  let open = { at: 0, year: null as number | null, kind: 'start' as AnswerGap['from']['kind'], foreground: 0, decisions: 0 };
  let answers = 0, decisions = 0;
  // A first Begin is not a house-to-house transition: the player may have
  // spent time at the title screen before any house existed.
  let hasHouse = false;
  // A saved-run pickup's run identity is observed before its Chronicle confirms
  // the boundary. Do not assign that tentative run to an unfinished signing,
  // or invent a preceding house when the reader was only on the title screen.
  let pickupPending = false;

  const advance = (to: number) => {
    const span = Math.max(0, Math.min(to, stop) - last);
    if (onBreak) breaks += span;
    else if (!visible) hidden += span;
    else if (!focused) unfocused += span;
    else foreground += span;
    last = Math.max(last, Math.min(to, stop));
  };
  const close = (at: number, to: number | null, kind: AnswerGap['to']['kind'], censored: boolean) => {
    gaps.push({
      from: { at: open.at, year: open.year, kind: open.kind },
      to: { at, year: to, kind },
      wallMs: at - open.at,
      foregroundMs: foreground - open.foreground,
      years: open.year !== null && to !== null ? to - open.year : null,
      decisions: open.decisions,
      censored,
    });
  };

  for (const e of events) {
    if (e.at > stop) break;
    advance(e.at);
    switch (e.kind) {
      case 'visible': visible = e.visible; break;
      case 'focus': focused = e.focused; break;
      case 'break': onBreak = e.on; break;
      case 'year': year = e.year; hasHouse = true; break;
      case 'pickup':
        // A resumed house cannot complete the signing of an earlier new house.
        // Its preceding run marker described the incoming house, not this entry.
        finishEntry(e.at);
        pickupPending = false;
        // A successful saved-run pickup ends the old answer gap. Its carried
        // pages cannot answer a question from the house shown before the load.
        if (hasHouse) {
          close(e.at, year, 'new-run', true);
          open = { at: e.at, year: null, kind: 'start', foreground, decisions: 0 };
        }
        hasHouse = true;
        year = null;
        break;
      case 'decision': hasHouse = true; decisions++; open.decisions++; break;
      case 'page': case 'interlude': {
        hasHouse = true;
        if (!e.answer || e.revisit || ('carried' in e && e.carried)) break;
        answers++;
        close(e.at, e.year, e.answer, false);
        open = { at: e.at, year: e.year, kind: e.answer, foreground, decisions: 0 };
        break;
      }
      case 'action':
        if (e.act === 'start' && PICKUPS.has(e.verb)) pickupPending = true;
        if (e.act === 'start' && (e.verb === 'begin' || e.verb === 'beginFromShareCode')) {
          // An ordinary new house supersedes even a pending/failed pickup.
          pickupPending = false;
          finishEntry(e.at);
          entry = { startedAt: e.at, foregroundAt: foreground, campaign: null,
            // An accepted share code starts a house already founded; the ordinary Begin does not.
            foundedAt: e.verb === 'beginFromShareCode' ? e.at : null, enteredAt: null };
          // Answer-to-answer delays never span different houses. Censor
          // the previous house's unfinished gap and start a new clock.
          // The first Begin does not end a preceding house: foreground
          // time before the first house still belongs to the initial gap.
          if (hasHouse) {
            close(e.at, year, 'new-run', true);
            open = { at: e.at, year: null, kind: 'start', foreground, decisions: 0 };
          }
          hasHouse = true;
          year = null;
        }
        if (entry && e.verb === 'found' && e.status === 'accepted') entry.foundedAt = e.at;
        if (entry && e.verb === 'enter' && e.status === 'returned') entry.enteredAt = e.at;
        if (entry && entry.foundedAt !== null && entry.enteredAt !== null
          && (e.verb === 'choose' || e.verb === 'match' || e.verb === 'order'
            || e.verb === 'muster' || e.verb === 'record')
          && e.status === 'accepted') {
          finishEntry(e.at, { at: e.at, verb: e.verb });
        }
        break;
      case 'run':
        // App.vue can emit the loaded run's campaign/seed *before* Chronicle
        // establishes a successful pickup. Keep the old entry's campaign and
        // title-screen gap intact until that boundary is confirmed.
        if (pickupPending) break;
        hasHouse = true;
        if (entry) entry.campaign = e.campaign;
        break;
      case 'pane': case 'prose': case 'ended': case 'end': break;
      default: assertNever(e);
    }
  }
  advance(stop);
  finishEntry(stop);
  // An end marker later in the artifact cannot terminate an earlier analysis
  // window. The requested cutoff is still open, even in a capped artifact.
  const reason = end && end.at <= until ? end.reason : truncated && !end ? 'cap' : 'open';
  close(stop, year, reason, true);

  const hours = foreground / 3_600_000;
  return {
    entries,
    wallMs: stop,
    foregroundMs: foreground,
    hiddenMs: hidden,
    unfocusedMs: unfocused,
    breakMs: breaks,
    answers,
    decisions,
    tableActions: tableActionsOf(events, stop),
    decisionsPerForegroundHourEstimate: hours > 0 ? decisions / hours : null,
    gaps,
  };
}

/**
 * The store's verbs, each noted and then passed through untouched — same
 * arguments, same `this`, same return. A wrapper that changed anything would
 * make the observed run a different run. It only listens to a pick-up's
 * promise, to hear when it came back without a run.
 */
/**
 * A malformed host payload can expose an accessor or Proxy that throws when
 * inspected. Observing it must never prevent the real verb from running.
 */
function observedActionField(payload: unknown, field: 'kind' | 'op'): unknown {
  try {
    return (payload as Record<'kind' | 'op', unknown> | null | undefined)?.[field];
  } catch {
    return undefined;
  }
}

/** An unreadable result is censored, not an invented refusal or exception. */
function observedTableOutcome(result: unknown): 'accepted' | 'refused' | null {
  try {
    if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return null;
    const ok = (result as { ok?: unknown }).ok;
    return ok === true ? 'accepted' : ok === false ? 'refused' : null;
  } catch {
    return null;
  }
}

export function recordActions<A extends GameActions>(actions: A, log: ReadingLog): A {
  const wrapped = { ...actions };
  for (const verb of Object.keys(RECORDED_VERBS) as RecordedVerb[]) {
    const original = actions[verb] as (...args: unknown[]) => unknown;
    (wrapped as Record<RecordedVerb, unknown>)[verb] = (...args: unknown[]) => {
      // Observe which kind of Record was attempted and whether it took. The
      // third argument is player-entered wording: never copy it into the log.
      // Validate against the schema-owned union so even a malformed caller
      // cannot smuggle arbitrary prose into an exported artifact.
      if (verb === 'record') {
        const mode = parseRecordOption(args[1]);
        // Production decision ids are dec_<base36 counter>. Do not mistake a
        // caller-provided name or prose for an internal identifier.
        const id = args[0];
        const decision = typeof id === 'string' && id.length <= 40 && /^dec_[0-9a-z]+$/.test(id)
          ? id : undefined;
        const event = {
          kind: 'action' as const, verb, act: 'answer' as const,
          mode: mode ?? 'unknown' as const,
          ...(decision ? { decision } : {}),
        };
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args) as ReturnType<GameActions['record']>;
          log.note({ ...event, status: result ? 'accepted' : 'refused' });
          return result;
        } catch (error) {
          log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      // The first consequential family decision is an accepted command, not
      // merely a click. Neither the choice id, card id, cast nor player text
      // belongs in the exported research log. Match returns a result object
      // (or undefined when no run is active); Choose returns a boolean.
      if (verb === 'choose' || verb === 'match') {
        const event = { kind: 'action' as const, verb, act: 'answer' as const };
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args);
          const accepted = verb === 'choose'
            ? result === true
            : (result as { ok?: unknown } | null | undefined)?.ok === true;
          log.note({ ...event, status: accepted ? 'accepted' : 'refused' });
          return result;
        } catch (error) {
          log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      // Founding is atomic, but only its returned result tells the recorder
      // whether the house was actually founded. Never export the founder name,
      // Examination choices, friends, or a free-text refusal reason.
      if (verb === 'found') {
        const event = { kind: 'action' as const, verb, act: 'signing' as const };
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args) as ReturnType<GameActions['found']>;
          log.note({ ...event, status: result.ok ? 'accepted' : 'refused' });
          return result;
        } catch (error) {
          log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      // Enter has no acceptance result. "returned" marks an observed transition
      // invocation, not a verified family action or a newly founded house.
      if (verb === 'enter') {
        const event = { kind: 'action' as const, verb, act: 'signing' as const };
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args);
          log.note({ ...event, status: 'returned' });
          return result;
        } catch (error) {
          log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      // An ordinary Begin is also a transaction boundary: if the new game
      // cannot be built, the old house and its page identities remain current.
      // Vue observes the new view on its next update, after this synchronous
      // action returns, so successful starts still reset before new pages.
      if (verb === 'begin') {
        const result = original.apply(actions, args);
        log.note({ kind: 'action', verb, act: 'start' });
        return result;
      }
      // Share-code starts are atomic. A refused code leaves the old run intact,
      // so it must not clear its page identities or censor its current gap.
      // Never include the pasted code or recipient names in a research log.
      if (verb === 'beginFromShareCode') {
        const result = original.apply(actions, args) as ReturnType<GameActions['beginFromShareCode']>;
        if (result === null) log.note({ kind: 'action', verb, act: 'start' });
        return result;
      }
      // Table and Muster return explicit success/refusal. Keep the attempt
      // even if the call throws, and do not log its free-text refusal reason.
      if (verb === 'order') {
        const category = readingLogTableCategory(observedActionField(args[0], 'kind'));
        const event = { kind: 'action' as const, verb, act: 'table' as const, category };
        const generation = log.startGeneration;
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args) as ReturnType<GameActions['order']>;
          const status = observedTableOutcome(result);
          // A nested Begin or pickup may switch houses before this verb returns.
          // Never credit the old outcome to a new house's attempt.
          if (status && log.startGeneration === generation) log.note({ ...event, status });
          return result;
        } catch (error) {
          if (log.startGeneration === generation) log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      if (verb === 'muster') {
        const category = readingLogMusterCategory(observedActionField(args[0], 'op'));
        const event = { kind: 'action' as const, verb, act: 'muster' as const, category };
        const generation = log.startGeneration;
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args) as ReturnType<GameActions['muster']>;
          const status = observedTableOutcome(result);
          // A nested Begin or pickup may switch houses before this verb returns.
          // Never credit the old outcome to a new house's attempt.
          if (status && log.startGeneration === generation) log.note({ ...event, status });
          return result;
        } catch (error) {
          if (log.startGeneration === generation) log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      if (verb === 'delegateChoice' || verb === 'delegateRecord') {
        const event = {
          kind: 'action' as const, verb, act: 'delegate' as const,
          category: verb === 'delegateChoice' ? 'choice' as const : 'record' as const,
          change: args[1] === null ? 'clear' as const : 'set' as const,
        };
        const generation = log.startGeneration;
        log.note({ ...event, status: 'attempted' });
        try {
          const result = original.apply(actions, args);
          // Neither delegation verb returns a success flag. "returned"
          // means only that the call finished, not that a setting changed.
          if (log.startGeneration === generation) log.note({ ...event, status: 'returned' });
          return result;
        } catch (error) {
          if (log.startGeneration === generation) log.note({ ...event, status: 'threw' });
          throw error;
        }
      }
      log.note({
        kind: 'action', verb, act: RECORDED_VERBS[verb],
        ...(verb === 'advance' && typeof args[0] === 'number' ? { years: args[0] } : {}),
      });
      const pickupGeneration = PICKUPS.has(verb) ? log.startGeneration : null;
      // An unsuccessful pick-up must not turn the next Chronicle window of
      // the still-active house into history. Async refusals already clear the
      // flag below; a synchronous host/store failure must do the same.
      let result: unknown;
      try {
        result = original.apply(actions, args);
      } catch (error) {
        if (pickupGeneration !== null) log.pickUpFailed(pickupGeneration);
        throw error;
      }
      // A native host or embedded same-origin document may return a Promise
      // from another JavaScript realm. `instanceof Promise` rejects those
      // and can leave a refused pickup classified as carried history.
      // Observe any thenable without replacing the original caller's result.
      if (pickupGeneration !== null && result !== null
        && (typeof result === 'object' || typeof result === 'function')
        && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result as PromiseLike<unknown>).then(
          (ok) => { if (ok !== true) log.pickUpFailed(pickupGeneration); },
          () => log.pickUpFailed(pickupGeneration),
        );
      }
      return result;
    };
  }
  return wrapped;
}

/**
 * The document's side: visibility, focus, and the page going away. Returns
 * the detach. The window being hidden and the window losing focus are kept
 * apart because they are different absences — another tab, or another app on
 * top of a page still in view.
 */
interface Listened {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function attachReadingLog(
  log: ReadingLog,
  doc: Listened & { readonly visibilityState: DocumentVisibilityState },
  win: Listened,
  /** Told when the page going away ended the log, so a page restored from the back/forward cache stops saying it is on. */
  onUnloaded: () => void = () => {},
): () => void {
  const onVisibility = () => log.note({ kind: 'visible', visible: doc.visibilityState === 'visible' });
  const onFocus = () => log.note({ kind: 'focus', focused: true });
  const onBlur = () => log.note({ kind: 'focus', focused: false });
  const onHide = () => { log.end('unloaded'); onUnloaded(); };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onFocus);
  win.addEventListener('blur', onBlur);
  win.addEventListener('pagehide', onHide);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', onFocus);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('pagehide', onHide);
  };
}

export function readingLogFilename(log: ReadingLog): string {
  return `eldritch-reading-log-${log.startedAt.replace(/[:.]/g, '-')}.json`;
}
