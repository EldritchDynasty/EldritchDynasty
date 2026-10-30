import type { Register } from '@ed/schema';
import type { GameActions, Outcome } from './game';
import type { Cue, DroneInput, Sound } from './sound';

/**
 * THE GAME'S EARS (#1986): when each of `sound.ts`'s cues plays, and when the
 * drone may hum.
 *
 * `sound.ts` says what the house sounds like; this file says when. It adds no
 * cue and changes no score. Every sound here follows a COMMITTED transition —
 * a verb that took — and never a render, a resumed save or a page of the Book
 * opened again:
 *
 * | Cue    | Moment                                                     |
 * |--------|------------------------------------------------------------|
 * | page   | `advance` moved the year. One per press, however many years |
 * | bell   | that turn stopped on a new question on the docket          |
 * | seal   | the signing took; a Match card or a Record answer took     |
 * | boon / blow / plain | a choice took, by `valence.ts` on its effects |
 *
 * The drone follows the screen rather than a verb: only the board has a house
 * to hum for, overlapping Ages stack by their authored registers, and an
 * interlude or the last night silences it (§24: the frame "kills the drone
 * entirely"). Closing the interlude brings back whatever the Ages say now.
 *
 * Nothing here reaches the world. Sound reads the store's own values after a
 * verb returns and writes nothing anywhere, so a run played loud and a run
 * played silent save the same bytes — `sound.test.ts` compares them.
 */

/**
 * Exhaustiveness without a value import: only the store may import the
 * simulation for anything but a type (`verbs.test.ts`).
 */
function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

/** The player's choice, kept beside the reading preferences in `accessibility.ts`. */
export interface SoundPreference {
  on: boolean;
  /** 0..1, over cues and drone together. */
  volume: number;
}

/** What is on screen, as far as the drone cares. */
export interface SoundScene {
  /** A run is open and the years have started: not the front door, not the signing. */
  board: boolean;
  /** An interlude is held on screen, or the last night has come. */
  frame: boolean;
  /** One per Age the view says is running, oldest first. */
  registers: Register[];
}

export function droneFor(scene: SoundScene): DroneInput | null {
  return scene.board ? { registers: scene.registers, frame: scene.frame } : null;
}

/** The running Ages off the public view: the ones with no `ended`, in the view's own order. */
export function runningRegisters(ages: readonly { register: Register; ended?: number }[]): Register[] {
  return ages.filter((age) => age.ended === undefined).map((age) => age.register);
}

/** Which cue an accepted answer earns. */
export function outcomeCue(outcome: Outcome): Cue {
  switch (outcome.kind) {
    // Written, whichever of the three it was. An omission is sealed too —
    // that is what makes the dated blank a decision rather than an absence.
    case 'record':
      return 'seal';
    // A hand taken.
    case 'match':
      return 'seal';
    case 'choice':
      return outcome.valence ?? 'plain';
  }
  return assertNever(outcome.kind, 'outcome kind');
}

/** The part of `Sound` the bed drives. A test hands it a real `Sound` over a fake engine. */
export type SoundEngine = Pick<Sound, 'muted' | 'volume' | 'available' | 'cue' | 'setDrone' | 'suspend' | 'wake' | 'close'>;

/**
 * One `Sound`, and the three things besides the player's preference that may
 * keep it quiet: no gesture yet, the page out of sight, and no engine.
 *
 * - **No gesture yet.** Browsers and webviews refuse audio before the player
 *   has touched the page, and a context made too early is one that never
 *   starts. Nothing is built, resumed or played until `gesture()`. A restored
 *   "on" preference is therefore silent until the first press, by design.
 * - **Out of sight.** Hidden, backgrounded or paused by the host: the drone
 *   stops and the device is let go. Coming back — the page visible again, or
 *   simply the next touch where a host says nothing on return — restores the
 *   drone the screen asks for then, not the one that was playing before.
 * - **No engine.** `Sound` turns its own failures into silence. The bed still
 *   tracks the scene so a working engine would know where it is.
 */
export class SoundBed {
  #preference: SoundPreference = { on: false, volume: 1 };
  #unlocked = false;
  #away = false;
  /** A gesture may resume a paused host, but must never wake a hidden document. */
  #documentHidden = false;
  #scene: DroneInput | null = null;
  #sceneKey = 'null';
  #detach: () => void = () => undefined;

  constructor(private readonly engine: SoundEngine) {}

  /** True only when a cue could be heard; zero volume must not open the audio device. */
  get audible(): boolean {
    return this.#preference.on && this.#preference.volume > 0
      && this.#unlocked && !this.#away && this.engine.available;
  }

  prefer(preference: SoundPreference): void {
    this.#preference = { on: preference.on, volume: preference.volume };
    this.engine.volume = preference.volume;
    this.#settle();
  }

  /** Where the drone should be. Called on every view; an unchanged scene is left alone. */
  scene(next: DroneInput | null): void {
    const key = JSON.stringify(next);
    if (key === this.#sceneKey) return;
    this.#scene = next;
    this.#sceneKey = key;
    // `Sound` remembers it while muted, so unmuting plays this and not a stale one.
    this.engine.setDrone(next);
  }

  cue(cue: Cue): void {
    if (this.audible) this.engine.cue(cue);
  }

  /** The player touched the page: audio is allowed, and they are evidently here. */
  gesture(): void {
    if (this.#documentHidden) return;
    this.#unlocked = true;
    this.#away = false;
    this.#settle();
    if (this.audible) this.engine.wake();
  }

  hide(): void {
    if (this.#away) return;
    this.#away = true;
    this.#settle();
    this.engine.suspend();
  }

  show(): void {
    if (!this.#away) return;
    this.#away = false;
    this.#settle();
  }

  /**
   * Listen to the page and the host. `onPause` is the platform seam's own
   * "about to background" (`platform.ts`), which some hosts send where the
   * webview's visibility never changes. Returns the detach; `dispose` calls it
   * too.
   */
  attach(
    doc: Listened & { readonly visibilityState: DocumentVisibilityState },
    win: Listened,
    onPause?: (listener: () => void) => () => void,
    /** `navigator`, for the Audio Session API where an engine has one. */
    nav?: object,
  ): () => void {
    this.#detach();
    // Ambient: mixes with whatever the player is already listening to, and
    // obeys a phone's silent switch, where the engine supports saying so.
    // `auto` is the only value replaced; a host that chose already chose.
    const session = (nav as { audioSession?: { type?: unknown } } | undefined)?.audioSession;
    if (session?.type === 'auto') session.type = 'ambient';
    const gesture = () => this.gesture();
    const visibility = () => {
      this.#documentHidden = doc.visibilityState === 'hidden';
      if (this.#documentHidden) this.hide();
      else this.show();
    };
    const hide = () => this.hide();
    // A pageshow can arrive before visibilitychange while the page remains
    // hidden (for example when a tab is restored in the background).
    const show = () => visibility();
    for (const type of GESTURES) win.addEventListener(type, gesture, true);
    doc.addEventListener('visibilitychange', visibility);
    win.addEventListener('pagehide', hide);
    win.addEventListener('pageshow', show);
    const unpause = onPause?.(hide) ?? (() => undefined);
    visibility();
    this.#detach = () => {
      for (const type of GESTURES) win.removeEventListener(type, gesture, true);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('pagehide', hide);
      win.removeEventListener('pageshow', show);
      unpause();
      this.#detach = () => undefined;
    };
    return this.#detach;
  }

  /** Let go of the listeners and the audio thread. */
  dispose(): void {
    this.#detach();
    this.engine.close();
  }

  #settle(): void {
    const muted = !this.audible;
    if (this.engine.muted !== muted) this.engine.muted = muted;
  }
}

interface Listened {
  addEventListener(type: string, listener: () => void, capture?: boolean): void;
  removeEventListener(type: string, listener: () => void, capture?: boolean): void;
}

/**
 * Every event an engine might count as the gesture. Some accept the press and
 * some only the release, so the bed listens to both and is unlocked by
 * whichever comes first; the rest are cheap no-ops after that.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

/** The cues a verb earns once it has taken. */
export interface SoundReads {
  year(): number | undefined;
  docket(): number;
  outcome(): Outcome | null;
}

/**
 * The verbs, passed straight through, with a cue after the ones that took.
 * Same shape as `recordActions` in `reading-log.ts`: nothing here changes an
 * argument or a result.
 */
export function soundActions<A extends GameActions>(
  actions: A,
  bed: Pick<SoundBed, 'cue'>,
  read: SoundReads,
): A {
  function answered<T>(answer: () => T): T {
    const before = read.outcome();
    const result = answer();
    const after = read.outcome();
    if (after && after !== before) bed.cue(outcomeCue(after));
    return result;
  }

  return {
    ...actions,
    advance(years, opts) {
      const year = read.year();
      const waiting = read.docket();
      actions.advance(years, opts);
      if (read.year() !== year) bed.cue('page');
      if (read.docket() > waiting) bed.cue('bell');
    },
    found(choice) {
      const result = actions.found(choice);
      if (result.ok) bed.cue('seal');
      return result;
    },
    choose: (...args) => answered(() => actions.choose(...args)),
    send: (...args) => answered(() => actions.send(...args)),
    match: (...args) => answered(() => actions.match(...args)),
    record: (...args) => answered(() => actions.record(...args)),
  };
}
