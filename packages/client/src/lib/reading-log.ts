import type { ChronicleView } from '@ed/core';
import type { GameActions } from './game.js';

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

/** 2: pages already on screen when a saved run is picked up are `carried`, not answers. */
export const READING_LOG_FORMAT = 'ed-reading-log/2';

/** `?reading-log=1` turns it on for this page load, and nothing else does. */
export const READING_LOG_QUERY = 'reading-log';

/** Bounded, so a forgotten switch cannot fill the reader's disk. */
export const READING_LOG_MAX_EVENTS = 20_000;

/** What the notice says, word for word — the switch is not informed consent without it. */
export const READING_LOG_NOTICE =
  'Reading log is on. On this device only, it records which pages and decisions are shown, the in-game year, '
  + 'when this window is in front, which panel is open and which buttons you press. It records no text you type, '
  + 'is not part of your saved game, and leaves this device only if you export it.';

export const READING_LOG_CAVEATS = [
  'foregroundMs counts time the page was visible and focused outside declared breaks: an exposure proxy, not reading time.',
  'Game years are simulation pacing, not elapsed time.',
  'A censored gap ended without a next answer (export, stop, unload or the event cap); it is a lower bound.',
  'The first gap starts at the log, not at an answer, and the first after a resumed save starts at the resume: neither is a whole answer-to-answer interval.',
  'seen marks a decision whose authored scene this device had shown before; revisit marks a page already shown in this log; '
    + 'carried marks a page already in the chronicle when a saved run was picked up. Revisits and carried pages answer nothing.',
] as const;

export function readingLogRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(READING_LOG_QUERY);
  return value !== null && ['', '1', 'on', 'true', 'yes'].includes(value.toLowerCase());
}

export type ReadingAnswerKind = 'interlude' | NonNullable<ChronicleView['answer']>;

/** The verbs worth a line. Reads (`book`, `advice`, …) are not actions. */
const RECORDED_VERBS = {
  begin: 'start',
  resume: 'start',
  load: 'start',
  importSave: 'start',
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
} as const satisfies Partial<Record<keyof GameActions, 'start' | 'advance' | 'answer' | 'dismiss'>>;

export type RecordedVerb = keyof typeof RECORDED_VERBS;

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
  | { at: number; kind: 'year'; year: number }
  | { at: number; kind: 'page'; year: number; page: string; event?: string; answer?: ReadingAnswerKind; revisit?: true; carried?: true }
  | { at: number; kind: 'interlude'; year: number; event: string; answer: 'interlude'; revisit?: true }
  | { at: number; kind: 'decision'; year: number; decision: string; event: string; seen: boolean }
  | { at: number; kind: 'action'; verb: RecordedVerb; act: (typeof RECORDED_VERBS)[RecordedVerb]; years?: number }
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
  to: { at: number; year: number | null; kind: ReadingAnswerKind | EndReason | 'cap' | 'open' };
  wallMs: number;
  foregroundMs: number;
  years: number | null;
  decisions: number;
  censored: boolean;
}

export interface ReadingLogSummary {
  wallMs: number;
  foregroundMs: number;
  hiddenMs: number;
  unfocusedMs: number;
  breakMs: number;
  answers: number;
  decisions: number;
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
  #ended: EndReason | null = null;
  readonly #origin: number;
  readonly #shown = new Set<string>();
  readonly #last = new Map<string, string>();
  /** The chronicle window last seen, so the next one can say what is new in it. */
  #window = new Set<string>();
  /** A saved run is being picked up: its first window is history, not news. */
  #pickingUp = false;

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

  /**
   * Add one event. A state that has not changed is not an event — a second
   * `focus` while focused would otherwise split an interval in two — and an
   * ended or full log takes nothing more.
   */
  note(event: Untimed<ReadingLogEvent>): void {
    if (this.#ended || this.truncated) return;
    if (event.kind === 'action' && event.act === 'start') this.#pickingUp = PICKUPS.has(event.verb);
    const state = stateKey(event);
    if (state) {
      if (this.#last.get(state[0]) === state[1]) return;
      this.#last.set(state[0], state[1]);
    }
    if (this.events.length >= READING_LOG_MAX_EVENTS - 1) {
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
    for (const entry of entries) if (entry.id && !this.#window.has(entry.id)) this.page(entry.year, entry, carried);
    this.#window = new Set(entries.flatMap((entry) => (entry.id ? [entry.id] : [])));
  }

  /**
   * A pick-up that came back without a run — a cancelled picker, an unreadable
   * save — leaves the run on screen as it was, and its next page is news.
   */
  pickUpFailed(): void {
    this.#pickingUp = false;
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
    this.events.push({ kind: 'end', reason, at: this.now() - this.#origin });
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
      summary: summarize(events, this.now() - this.#origin, this.truncated),
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
    case 'page': case 'interlude': case 'decision': case 'action': case 'ended': case 'end':
      return null;
    default: return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled reading-log event: ${JSON.stringify(value)}`);
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
  const stop = end ? end.at : until;

  const gaps: AnswerGap[] = [];
  let open = { at: 0, year: null as number | null, kind: 'start' as AnswerGap['from']['kind'], foreground: 0, decisions: 0 };
  let answers = 0, decisions = 0;

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
      case 'year': year = e.year; break;
      case 'decision': decisions++; open.decisions++; break;
      case 'page': case 'interlude': {
        if (!e.answer || e.revisit || ('carried' in e && e.carried)) break;
        answers++;
        close(e.at, e.year, e.answer, false);
        open = { at: e.at, year: e.year, kind: e.answer, foreground, decisions: 0 };
        break;
      }
      case 'pane': case 'prose': case 'run': case 'action': case 'ended': case 'end': break;
      default: assertNever(e);
    }
  }
  advance(stop);
  close(stop, year, end?.reason ?? (truncated ? 'cap' : 'open'), true);

  const hours = foreground / 3_600_000;
  return {
    wallMs: stop,
    foregroundMs: foreground,
    hiddenMs: hidden,
    unfocusedMs: unfocused,
    breakMs: breaks,
    answers,
    decisions,
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
export function recordActions<A extends GameActions>(actions: A, log: ReadingLog): A {
  const wrapped = { ...actions };
  for (const verb of Object.keys(RECORDED_VERBS) as RecordedVerb[]) {
    const original = actions[verb] as (...args: unknown[]) => unknown;
    (wrapped as Record<RecordedVerb, unknown>)[verb] = (...args: unknown[]) => {
      log.note({
        kind: 'action', verb, act: RECORDED_VERBS[verb],
        ...(verb === 'advance' && typeof args[0] === 'number' ? { years: args[0] } : {}),
      });
      const result = original.apply(actions, args);
      if (PICKUPS.has(verb) && result instanceof Promise) {
        result.then((ok) => { if (ok !== true) log.pickUpFailed(); }, () => log.pickUpFailed());
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
