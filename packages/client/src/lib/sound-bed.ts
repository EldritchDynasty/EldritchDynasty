import type { Register } from '@ed/schema';
import type { GameActions, Outcome } from './game';
import { droneScore, type Cue, type DroneInput, type Sound } from './sound';

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
  /** Teardown is terminal: late UI/host callbacks must never reopen Web Audio. */
  #disposed = false;
  #preference: SoundPreference = { on: false, volume: 1 };
  /** A refusing host must not leave us unmuted at a stale, louder level. */
  #volumeApplied = false;
  #unlocked = false;
  #away = false;
  /** A gesture may resume a paused host, but must never wake a hidden document. */
  #documentHidden = false;
  /** A pagehide can arrive while visibilityState is still "visible". */
  #pageHidden = false;
  /** A native pause is not undone merely by a new visible document or duplicate DOM event. */
  #hostPaused = false;
  /** Read live visibility at gestures: some WebViews omit visibilitychange. */
  #attachedDocument: { readonly visibilityState: DocumentVisibilityState } | null = null;
  #sceneKey = 'null';
  #detach: () => void = () => undefined;

  constructor(private readonly engine: SoundEngine) {}

  /** True only when a cue could be heard; zero volume must not open the audio device. */
  get audible(): boolean {
    return !this.#disposed && this.#volumeApplied && this.#preference.on && this.#preference.volume > 0
      && this.#unlocked && !this.#away && this.#engineAvailable();
  }

  prefer(preference: SoundPreference): void {
    if (this.#disposed) return;
    // Fail closed on corrupt values before the bed decides whether to open
    // an audio device; the engine's own setter enforces the same limit.
    // A native preference adapter can return malformed data despite its typed
    // interface (including null after a corrupt storage read). Never throw
    // during Start/Reading settings mount or wake audio for such a value.
    const supplied = preference && typeof preference === 'object' ? preference : null;
    let requestedVolume: unknown;
    let requestedOn: unknown;
    try {
      requestedVolume = supplied?.volume;
      requestedOn = supplied?.on;
    } catch {
      // An optional host adapter may expose throwing getters or a revoked
      // proxy. Treat the entire preference as invalid and fail closed.
      requestedVolume = undefined;
      requestedOn = false;
    }
    const volume = typeof requestedVolume === 'number' && Number.isFinite(requestedVolume)
      ? Math.min(1, Math.max(0, requestedVolume)) : 0;
    // Only a literal true with a valid, positive volume may turn sound on.
    this.#preference = { on: requestedOn === true, volume };
    // Volume is set before unmuting. If an optional adapter throws, the old
    // output level may still be loud: mute it rather than accepting that level.
    this.#volumeApplied = false;
    try {
      this.engine.volume = volume;
      this.#volumeApplied = true;
    } catch { /* Host audio is optional; a later valid preference may retry. */ }
    this.#settle();
  }

  /** Where the drone should be. Called on every view; an unchanged scene is left alone. */
  scene(next: DroneInput | null): void {
    if (this.#disposed) return;
    // A view invalidated by a host can be serializable yet no longer contain
    // valid Age registers. Passing that object to Sound would throw during
    // score construction and permanently disable otherwise healthy audio.
    // Snapshot it first: getters and toJSON hooks cannot change the object
    // after validation but before the engine consumes it.
    let scene: DroneInput | null = null;
    let key = 'null';
    try {
      const serialized = JSON.stringify(next);
      if (serialized !== undefined) {
        const value: unknown = JSON.parse(serialized);
        if (value && typeof value === 'object' && !Array.isArray(value)
          && 'registers' in value && Array.isArray(value.registers)
          && value.registers.every((register) => typeof register === 'string')
          && 'frame' in value && typeof value.frame === 'boolean') {
          const candidate: DroneInput = { registers: value.registers as Register[], frame: value.frame };
          // The sound score's exhaustive register switch is the authority for
          // what the device can render. Validate a non-frame snapshot even if
          // the current frame is silent: a hidden invalid Age must not reach
          // Sound later, or import the simulation schema across the client seam.
          droneScore({ registers: candidate.registers, frame: false });
          scene = candidate;
          key = JSON.stringify(scene);
        }
      }
    } catch { /* Cyclic/throwing/invalid scene: silence without failing the game. */ }
    if (key === this.#sceneKey) return;
    this.#sceneKey = key;
    // The engine remembers the latest valid scene while muted, so unmuting
    // cannot resurrect a stale Age or replay an invalid one.
    this.#tryAudio(() => this.engine.setDrone(scene));
  }

  cue(cue: Cue): void {
    if (this.audible) this.#tryAudio(() => this.engine.cue(cue));
  }

  /** The player touched the page: audio is allowed, and they are evidently here. */
  gesture(): void {
    if (this.#disposed) return;
    // WebViews can change visibility without dispatching visibilitychange.
    // Never trust a previously visible snapshot to authorize a hidden gesture,
    // nor refuse a fresh visible gesture because an old hidden snapshot lingered.
    if (this.#attachedDocument) {
      let visible = false;
      try { visible = this.#attachedDocument.visibilityState === 'visible'; }
      catch { /* a refusing host must not unlock audio */ }
      this.#documentHidden = !visible;
      if (!visible) {
        this.hide();
        return;
      }
    } else if (this.#documentHidden) return;
    this.#unlocked = true;
    this.#away = false;
    this.#pageHidden = false;
    this.#hostPaused = false;
    this.#settle();
    if (this.audible) this.#tryAudio(() => this.engine.wake());
  }

  hide(): void {
    if (this.#disposed || this.#away) return;
    this.#away = true;
    this.#settle();
    this.#tryAudio(() => this.engine.suspend());
  }

  show(): void {
    // A host can announce a foreground return while the browser still says
    // this page is hidden. Do not unmute the drone on that stale signal.
    // A raw show() is not proof that a page hidden by pagehide has returned.
    // Only pageshow, a fresh visible-document attachment or a gesture may clear it.
    if (this.#disposed || !this.#away || this.#documentHidden || this.#pageHidden || this.#hostPaused) return;
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
    if (this.#disposed) return () => undefined;
    this.#detach();
    const replacingDocument = this.#attachedDocument !== doc;
    this.#attachedDocument = doc;
    // Replacing an attachment may move a hidden page's audio to an already
    // visible document without another visibilitychange/pageshow event.
    const wasDocumentHidden = this.#documentHidden;
    const wasPageHidden = this.#pageHidden;
    // Ambient: mixes with whatever the player is already listening to, and
    // obeys a phone's silent switch, where the engine supports saying so.
    // `auto` is the only value replaced; a host that chose already chose.
    // Some hosts expose the optional Audio Session API but reject writes (or
    // even throw when reading its property). That must not stop the game from
    // attaching its visibility/gesture listeners or accepting player actions.
    // Audio Session is shared host state, not a preference owned by this bed.
    // Restore our temporary policy on detach, but never erase a choice made
    // independently by the host while this attachment was active.
    let restoreSession: () => void = () => undefined;
    try {
      const session = (nav as { audioSession?: { type?: unknown } } | undefined)?.audioSession;
      if (session?.type === 'auto') {
        session.type = 'ambient';
        if (session.type === 'ambient') {
          restoreSession = () => {
            try {
              if (session.type === 'ambient') session.type = 'auto';
            } catch { /* A refusing host policy must not prevent listener teardown. */ }
          };
        }
      }
    } catch { /* unsupported audio policy: the browser/host retains its default */ }
    // An unsubscribed listener can already be queued by a native host. Only
    // callbacks from the current attachment may act on the current device.
    let active = true;
    const gesture = () => { if (active) this.gesture(); };
    const visibleNow = () => {
      try { return doc.visibilityState === 'visible'; }
      catch { return false; } // an unavailable host state is not foreground evidence
    };
    const visibility = () => {
      if (!active) return;
      // A duplicate 'visible' notification does not prove a native-paused
      // WebView has returned. An actual hidden -> visible transition does.
      const wasHidden = this.#documentHidden;
      this.#documentHidden = !visibleNow();
      if (this.#documentHidden) this.hide();
      else if (wasHidden) {
        this.#pageHidden = false;
        this.#hostPaused = false;
        this.show();
      } else if (!this.#pageHidden && !this.#hostPaused) this.show();
    };
    const hide = () => {
      if (!active) return;
      this.#pageHidden = true;
      this.hide();
    };
    // Unlike a redundant visibilitychange, a real pageshow signals a
    // foreground transition. It still cannot override a hidden document.
    const show = () => {
      if (!active) return;
      if (!visibleNow()) {
        visibility();
        return;
      }
      this.#documentHidden = false;
      this.#pageHidden = false;
      this.#hostPaused = false;
      this.show();
    };
    // Some embedded WebViews refuse a particular DOM listener. A failed
    // registration must not break the game or strand earlier registrations.
    // Keep the rest (especially a surviving gesture) and remove only listeners
    // that actually attached when the component is replaced or disposed.
    const attached: { target: Listened; type: string; listener: () => void; capture: boolean }[] = [];
    const listen = (target: Listened, type: string, listener: () => void, capture = false) => {
      try {
        target.addEventListener(type, listener, capture);
        attached.push({ target, type, listener, capture });
      } catch {
        // Unavailable browser hook: another gesture/host lifecycle path may work.
      }
    };
    for (const type of GESTURES) listen(win, type, gesture, true);
    listen(doc, 'visibilitychange', visibility);
    listen(win, 'pagehide', hide);
    listen(win, 'pageshow', show);
    // Native hosts can refuse an optional pause subscription synchronously.
    // Browser visibility and gesture handling must still attach, and the
    // returned detach must still remove those listeners.
    let unpause: () => void = () => undefined;
    let pausedDuringSubscription = false;
    let subscribing = true;
    try {
      unpause = onPause?.(() => {
        // Native callbacks may already be queued when unsubscribed. Like the
        // browser listeners, an obsolete attachment cannot pause its successor.
        if (!active) return;
        // Only a synchronous host pause can veto the initial visible sample.
        if (subscribing) pausedDuringSubscription = true;
        this.#hostPaused = true;
        hide();
      }) ?? unpause;
    } catch {
      // Treat the unavailable host hook as silence, not a failed game mount.
    }
    subscribing = false;
    // A native host may report a pause synchronously while onPause is being
    // subscribed, even though the webview still reports "visible". Do not
    // mistake the initial visibility sample for a foreground/resume event:
    // that would immediately undo the host's pause and restart the drone.
    // A real visibilitychange, pageshow or a fresh user gesture can resume.
    this.#documentHidden = !visibleNow();
    if (this.#documentHidden) this.hide();
    else {
      // A new visible document may supersede browser pagehide (#2924), but
      // never an unresolved native pause: replacement alone is not a resume.
      const replacedHiddenPage = wasPageHidden && replacingDocument && !this.#hostPaused;
      if ((!wasPageHidden || replacedHiddenPage) && !pausedDuringSubscription && !this.#hostPaused) {
        this.#pageHidden = false;
      }
      if ((wasDocumentHidden || replacedHiddenPage) && !pausedDuringSubscription && !this.#hostPaused) {
        this.show();
      }
    }
    // A former attachment may still have its cleanup callback in a caller.
    // Calling that stale callback must neither tear down nor forget a newer
    // attachment. Each cleanup owns only its own listeners and host pause hook.
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      active = false;
      for (const { target, type, listener, capture } of attached) {
        try { target.removeEventListener(type, listener, capture); }
        catch { /* A broken host unsubscribe must not strand the other listeners. */ }
      }
      try {
        unpause();
      } catch {
        // A refusing native unsubscriber must not block audio shutdown.
      }
      restoreSession();
      if (this.#detach === detach) this.#detach = () => undefined;
    };
    this.#detach = detach;
    return detach;
  }

  /** Let go of the listeners and the audio thread. */
  dispose(): void {
    if (this.#disposed) return;
    // Mark terminal before cleanup: a host unsubscriber may synchronously
    // invoke its old listener, and the sound engine must stay closed.
    this.#disposed = true;
    this.#detach();
    this.#tryAudio(() => this.engine.close());
  }

  /** Even a hostile or invalidated audio adapter must not break the game. */
  #tryAudio(action: () => void): void {
    try { action(); }
    catch { /* Audio is optional presentation; a rejected host becomes silence. */ }
  }

  #engineAvailable(): boolean {
    try { return this.engine.available; }
    catch { return false; }
  }

  #settle(): void {
    const muted = !this.audible;
    this.#tryAudio(() => {
      // A host can refuse the optional mute-state read while still accepting
      // writes. Do not skip a necessary mute just because its getter threw:
      // the old drone could otherwise keep sounding at a stale volume.
      let current: boolean | undefined;
      try { current = this.engine.muted; }
      catch { /* Unknown state: explicitly ask for the safe state below. */ }
      if (current !== muted) this.engine.muted = muted;
    });
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
  // Audio is presentation-only. An invalidated host/device or optional sink
  // must never turn a committed simulation verb into a failure or suppress
  // the next cue. Keep this boundary around the output, not the game action.
  function cueSafely(cue: Cue): void {
    try { bed.cue(cue); }
    catch { /* the player keeps the accepted action; sound falls silent */ }
  }

  // Observing an optional cue is not part of a game action. A stale or
  // invalidated view may throw on either side of a committed verb; in that case
  // skip only the cue whose before/after evidence is unavailable.
  function sample<T>(reader: () => T): { ok: true; value: T } | { ok: false } {
    try { return { ok: true, value: reader() }; }
    catch { return { ok: false }; }
  }

  function answered<T>(answer: () => T): T {
    const before = sample(() => read.outcome());
    const result = answer();
    const after = sample(() => read.outcome());
    if (before.ok && after.ok && after.value && after.value !== before.value) {
      try { cueSafely(outcomeCue(after.value)); }
      catch { /* a malformed optional sound observation cannot undo an answer */ }
    }
    return result;
  }

  return {
    ...actions,
    advance(years, opts) {
      const year = sample(() => read.year());
      const waiting = sample(() => read.docket());
      actions.advance(years, opts);
      const nextYear = sample(() => read.year());
      const nextWaiting = sample(() => read.docket());
      if (year.ok && nextYear.ok && nextYear.value !== year.value) cueSafely('page');
      if (waiting.ok && nextWaiting.ok && nextWaiting.value > waiting.value) cueSafely('bell');
    },
    found(choice) {
      const result = actions.found(choice);
      if (result.ok) cueSafely('seal');
      return result;
    },
    choose: (...args) => answered(() => actions.choose(...args)),
    send: (...args) => answered(() => actions.send(...args)),
    match: (...args) => answered(() => actions.match(...args)),
    record: (...args) => answered(() => actions.record(...args)),
  };
}
