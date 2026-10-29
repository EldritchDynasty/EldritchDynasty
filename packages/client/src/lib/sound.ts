import type { Register } from '@ed/schema';

/**
 * THE SOUND, WHICH IS SPARSE ON PURPOSE.
 *
 * The concept brief (§24) allows four sounds: page turn, seal, bell, and an
 * ambient drone that shifts by Age — and says the last-night frame "kills the drone
 * entirely". Three more earn their place because the player needs to know
 * which way an outcome went without reading first: a boon, a blow, and the
 * plain note for the outcome that did neither.
 *
 * That is the whole budget. Seven cues in a Long Line, and six of them
 * are under a second. If you are here to add an eighth, the question to answer
 * first is which of these you are willing to take out.
 *
 * ── Who owns it ───────────────────────────────────────────────────────────
 * The game does (#1986). It was written for the editor and every player build
 * was silent for it; the editor now imports this file from here, and
 * `sound-bed.ts` is what wires it to the game's own moments.
 *
 * ── Why it is synthesised and not sampled ────────────────────────────────
 * Two reasons, and the second is the real one.
 *
 * The built editor ships under a Content Security Policy with `default-src
 * 'self'` (see `packages/editor/vite.config.ts`), so a `data:` audio URI does
 * not load there and a CDN does not either. The game declares no policy, but
 * a described score also gives each of its four hosts nothing to package.
 *
 * And the sigils are procedural for a reason — one artist, infinite
 * characters. The sound is the same bargain: nobody has to record a bell, the
 * bell is described, and describing it means it can be TESTED. A wav file that
 * plays silence is a wav file that plays silence forever. A `Score` with a
 * gain of zero fails `sound.test.ts` in three milliseconds.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 * Everything above `Sound` is pure data. `cueScore` and `droneScore` describe
 * what should be heard; `Sound` is the only thing that touches `AudioContext`,
 * and it is thin enough to read in one sitting. The score tests never
 * construct one; the player's own tests hand it a fake engine.
 */

/**
 * Exhaustiveness without a value import: only the store may import the
 * simulation for anything but a type (`verbs.test.ts`).
 */
function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

/** What the family can hear. A closed union — `cueScore` ends in `assertNever`. */
export type Cue =
  /** The year moved. A page turns. */
  | 'page'
  /** Something was committed: a record written, a hand taken, a clause paid. */
  | 'seal'
  /** A question has arrived on the docket and the clock has stopped. */
  | 'bell'
  /** The outcome favoured the house. */
  | 'boon'
  /** The outcome cost the house. */
  | 'blow'
  /** The outcome did neither, and the house should still hear that it landed. */
  | 'plain';

export const CUES: Cue[] = ['page', 'seal', 'bell', 'boon', 'blow', 'plain'];

export type VoiceType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

export interface Voice {
  type: VoiceType;
  /** Hz at the start of the voice. */
  freq: number;
  /** Glide to this by the end of the decay. Omitted, the pitch holds. */
  toFreq?: number;
  /** Peak linear gain, 0..1. Everything here is quiet; see `PEAK`. */
  gain: number;
  /** Seconds to the peak. Short is percussive; long is a swell. */
  attack: number;
  /** Seconds from the peak to silence. */
  decay: number;
  /** Seconds after the cue starts before this voice does. */
  delay: number;
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; q?: number };
}

export interface Score {
  voices: Voice[];
  /** For the drone: it holds until something replaces it. Cues never loop. */
  sustain?: boolean;
}

/**
 * The loudest any single cue is allowed to peak, summed across its voices.
 * A tool that pings while you work has exactly one chance to be too loud.
 */
export const PEAK = 0.24;

/**
 * D, because the drone is a D and a cue in a different key is a cue that
 * sounds like a mistake. Everything audible in this file is a ratio off here.
 */
const D1 = 36.71;
const D2 = 73.42;
const D3 = 146.83;
const D4 = 293.66;
const A3 = 220.0;
const A4 = 440.0;
/** The tritone off A3 — the interval the ear reads as wrong. `blow` uses it. */
const EB3 = 155.56;

export function cueScore(cue: Cue): Score {
  switch (cue) {
    /**
     * Paper, not a click. Two short bursts of filtered noise a breath apart —
     * the sheet lifting and the sheet landing — with the band sweeping down,
     * which is what makes it read as paper rather than as static.
     */
    case 'page':
      return {
        voices: [
          {
            type: 'noise', freq: 2400, toFreq: 900, gain: 0.05,
            attack: 0.004, decay: 0.1, delay: 0,
            filter: { type: 'bandpass', freq: 1800, q: 0.8 },
          },
          {
            type: 'noise', freq: 1500, toFreq: 500, gain: 0.035,
            attack: 0.004, decay: 0.14, delay: 0.075,
            filter: { type: 'bandpass', freq: 1100, q: 0.7 },
          },
        ],
      };

    /** Wax: a soft low press with almost no attack, and a little grain on it. */
    case 'seal':
      return {
        voices: [
          {
            type: 'sine', freq: 96, toFreq: 62, gain: 0.16,
            attack: 0.006, decay: 0.28, delay: 0,
          },
          {
            type: 'noise', freq: 700, toFreq: 300, gain: 0.03,
            attack: 0.002, decay: 0.09, delay: 0,
            filter: { type: 'lowpass', freq: 900 },
          },
        ],
      };

    /**
     * A struck bell, by its actual partials. A bell is inharmonic — the hum,
     * the prime, the minor third, the fifth, the nominal — and those ratios
     * are why it sounds like bronze and a stack of harmonics sounds like an
     * organ. The decays shorten as the partials rise, which is the other half
     * of it: the high ones die first and the hum is what you are left with.
     */
    case 'bell': {
      const f = D4;
      const partials: [number, number, number][] = [
        [0.5, 0.05, 2.6],   // the hum, an octave down
        [1.0, 0.07, 2.0],   // the prime
        [1.2, 0.035, 1.3],  // the minor third — the one that makes it a bell
        [1.5, 0.03, 1.0],
        [2.0, 0.022, 0.7],
        [2.76, 0.014, 0.45],
      ];
      return {
        voices: partials.map(([ratio, gain, decay]) => ({
          type: 'sine' as const, freq: f * ratio, gain,
          attack: 0.002, decay, delay: 0,
        })),
      };
    }

    /**
     * Up a fifth, and warm. Two notes rather than one because a single tone
     * has no direction — the second note is the whole message.
     */
    case 'boon':
      return {
        voices: [
          { type: 'triangle', freq: D4, gain: 0.075, attack: 0.008, decay: 0.34, delay: 0 },
          { type: 'triangle', freq: A4, gain: 0.065, attack: 0.008, decay: 0.42, delay: 0.085 },
          { type: 'sine', freq: D3, gain: 0.04, attack: 0.01, decay: 0.5, delay: 0 },
        ],
      };

    /**
     * Down, and a tritone under it. Lower, longer and softer than the boon:
     * a blow should land in the chest rather than the ear, and it should not
     * be the louder of the two — this house takes a lot of blows.
     */
    case 'blow':
      return {
        voices: [
          { type: 'sine', freq: A3, toFreq: A3 * 0.94, gain: 0.085, attack: 0.012, decay: 0.62, delay: 0 },
          { type: 'sine', freq: EB3, toFreq: EB3 * 0.94, gain: 0.05, attack: 0.02, decay: 0.7, delay: 0.02 },
          { type: 'triangle', freq: D2, gain: 0.045, attack: 0.02, decay: 0.55, delay: 0 },
        ],
      };

    /**
     * It happened, and it did not move the house. One note, on the tonic,
     * gone almost before it arrives — this is the commonest cue in the run by
     * a wide margin and it must never become something you notice.
     */
    case 'plain':
      return {
        voices: [
          { type: 'sine', freq: D4, gain: 0.045, attack: 0.008, decay: 0.2, delay: 0 },
        ],
      };
  }
  return assertNever(cue, 'cue');
}

/**
 * What sits above the root while an Age runs.
 *
 * The interval is read off the Age's own authored `register`, so a new Age
 * written next year gets a drone with no code change here and gets the RIGHT
 * one — the author already declared how it should feel when they wrote
 * `register: cold`. That is invariant 10's rule applied to sound: the thing
 * that varies is data, and the engine only knows how to read it.
 */
function intervalFor(register: Register): number {
  switch (register) {
    /** A fifth. Open, and the only consonance in the set. */
    case 'warm': return 1.5;
    /** A minor sixth. Unresolved, and it will not resolve. */
    case 'cold': return 1.6;
    /** A fourth. Stacked, plain, and slightly too official to be pleasant. */
    case 'institutional': return 4 / 3;
  }
  return assertNever(register, 'register');
}

export interface DroneInput {
  /** One per Age currently running. Ages overlap, and so do their drones. */
  registers: Register[];
  /**
   * A last-night interlude is on screen. §24: the frame "drops to two colours, kills
   * the drone entirely, and slows the text reveal. The player should feel the
   * temperature change before they read a word." Silence is that feeling.
   */
  frame: boolean;
}

/**
 * The drone, or `null` for silence. Silence is a real answer here, twice: in
 * the frame, and in a world where nothing in particular is happening.
 *
 * Note what stacking does. Two Ages at once is two intervals over one root,
 * and three is a chord nobody chose — which is exactly what three overlapping
 * Ages are. The sound gets crowded because the century is.
 */
export function droneScore(input: DroneInput): Score | null {
  if (input.frame) return null;

  const voices: Voice[] = [
    // The root is the house, and it is there whether anything is happening or
    // not. Two of them a few cents apart, because one is a test tone and two
    // is a room: the beating between them is the whole difference.
    { type: 'sine', freq: D1, gain: 0.045, attack: 2.4, decay: 0, delay: 0 },
    { type: 'sine', freq: D1 * 1.0035, gain: 0.04, attack: 2.4, decay: 0, delay: 0 },
  ];

  for (const [i, register] of input.registers.entries()) {
    const freq = D2 * intervalFor(register);
    // Each further Age is much quieter than the last, and the falloff is
    // steep on purpose: at a gentler one, five overlapping Ages summed past
    // `PEAK` — which `sound.test.ts` caught and which nothing else would
    // have, because a drone creeping upward over a century is a drone.
    const gain = 0.038 / (1 + i * 1.4);
    voices.push(
      { type: 'triangle', freq, gain, attack: 3.2, decay: 0, delay: 0, filter: { type: 'lowpass', freq: 420 } },
      { type: 'triangle', freq: freq * 1.004, gain: gain * 0.85, attack: 3.6, decay: 0, delay: 0, filter: { type: 'lowpass', freq: 420 } },
    );
  }

  return { voices, sustain: true };
}

// ── The only part that touches the browser ───────────────────────────────

type Ctor = new () => AudioContext;

function detectEngine(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Plays a `Score`. Everything interesting already happened above this line.
 *
 * Three things here are not obvious and all three are load-bearing:
 *
 *  - **The context starts suspended.** Browsers refuse to start audio before a
 *    gesture, and a context created on page load is a context that is dead by
 *    the time anybody clicks anything. `resume()` on every cue is the fix, and
 *    it is a no-op once it has worked.
 *  - **Nothing is created until the first cue.** A tool that opens an
 *    `AudioContext` on load spins the audio thread for people who never turn
 *    the sound on.
 *  - **Muting stops the drone.** A mute that only gags the cues leaves a hum
 *    running for the rest of the session, which is the single most annoying
 *    thing this file could possibly do.
 *
 * And one rule over all of it: **nothing here throws, and nothing here
 * rejects unheard.** A cue rides on a player's answer, and an audio device
 * that has gone away must not take the answer with it. A failed engine stops
 * being `available` and the run goes on in silence.
 */
export class Sound {
  private context: AudioContext | null = null;
  private out: GainNode | null = null;
  private drone: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
  private lastDrone: DroneInput | null = null;
  /** What the playing drone was built from, so an unchanged one is left alone. */
  private droneKey = '';
  private readonly ctor: Ctor | null;

  #muted = true;
  #volume = 1;
  /** The engine refused to start or to play. Silence from here on, not a retry per cue. */
  #failed = false;

  /**
   * Omit `ctor` to find the browser's engine; pass `null` to say there is not
   * one and mean it. The distinction matters because `??` does not make it:
   * `null ?? window.AudioContext` picks up the window, so an explicit "be
   * silent" would have quietly become "be loud".
   */
  constructor(ctor?: Ctor | null) {
    this.ctor = ctor === undefined ? detectEngine() : ctor;
  }

  /** Off until asked for. §24's sound is sparse; zero is sparser. */
  get muted() { return this.#muted; }

  set muted(value: boolean) {
    this.#muted = value;
    if (value) this.stopDrone();
    else if (this.lastDrone) this.setDrone(this.lastDrone);
  }

  /**
   * The level of the whole bed, 0..1. The scores keep their own `PEAK`; this
   * only ever turns them down. A voice (#1994) would get its own bus beside
   * `out` rather than sharing this one.
   */
  get volume() { return this.#volume; }

  set volume(value: number) {
    this.#volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    if (this.out) this.out.gain.value = this.#volume;
  }

  /**
   * True where there is an audio engine that works — false in node, in tests,
   * and once a real one has refused to start or to play.
   */
  get available() { return this.ctor !== null && !this.#failed; }

  private engine(): { context: AudioContext; out: GainNode } | null {
    if (!this.ctor || this.#failed) return null;
    if (!this.context || !this.out) {
      const ctx = new this.ctor();
      const out = ctx.createGain();
      out.gain.value = this.#volume;
      out.connect(ctx.destination);
      this.context = ctx;
      this.out = out;
    }
    // Suspended until a gesture. Harmless to call when it is already running.
    quietly(this.context.resume?.());
    return { context: this.context, out: this.out };
  }

  cue(name: Cue) {
    if (this.#muted) return;
    this.attempt(() => {
      const e = this.engine();
      if (e) this.play(e.context, e.out, cueScore(name), e.context.currentTime);
    });
  }

  /**
   * Put the drone where the world is. Cheap to call every time the year moves:
   * an unchanged drone is left alone, because restarting it would retrigger a
   * three-second swell every single year. `null` is no drone at all — no
   * house to hum for, which is not the frame's silence but sounds the same.
   */
  setDrone(input: DroneInput | null) {
    this.lastDrone = input;
    if (this.#muted) return;
    if (!input) return this.stopDrone();
    this.attempt(() => {
      const wanted = droneScore(input);
      if (!wanted) return this.stopDrone();

      const key = JSON.stringify(wanted);
      if (this.drone && key === this.droneKey) return;
      const e = this.engine();
      if (!e) return;
      this.stopDrone();
      this.droneKey = key;

      const gain = e.context.createGain();
      gain.gain.value = 1;
      gain.connect(e.out);
      const nodes = this.play(e.context, gain, wanted, e.context.currentTime);
      this.drone = { nodes, gain };
    });
  }

  stopDrone() {
    const d = this.drone;
    if (!d || !this.context) return;
    this.drone = null;
    this.droneKey = '';
    const ctx = this.context;
    this.attempt(() => {
      const now = ctx.currentTime;
      // Faded, not cut. A drone that stops instantly is a click.
      d.gain.gain.setValueAtTime(d.gain.gain.value, now);
      d.gain.gain.linearRampToValueAtTime(0, now + 1.4);
      // Every node here is a source this class started, so stopping is safe.
      for (const n of d.nodes) n.stop(now + 1.5);
    });
  }

  /**
   * Hidden or backgrounded: stop the drone and let go of the device, while
   * remembering what was playing. Unmuting brings back exactly that.
   */
  suspend() {
    this.stopDrone();
    quietly(this.context?.suspend?.());
  }

  /**
   * Ask a suspended engine to run again. Called from inside a gesture, where
   * the strictest engines insist it happen — a drone restored on return from
   * the background can otherwise sit scheduled on a context nobody resumed.
   */
  wake() {
    if (!this.#muted) quietly(this.context?.resume?.());
  }

  /** Let go of the audio thread entirely. */
  close() {
    this.stopDrone();
    quietly(this.context?.close?.());
    this.context = null;
    this.out = null;
  }

  /**
   * Run one piece of engine work, and turn a throw into silence. The context
   * goes too, so a half-built graph is never played into again.
   */
  private attempt(work: () => void) {
    if (this.#failed) return;
    try {
      work();
    } catch {
      this.#failed = true;
      this.drone = null;
      this.droneKey = '';
      try { quietly(this.context?.close?.()); } catch { /* already gone */ }
      this.context = null;
      this.out = null;
    }
  }

  private play(ctx: AudioContext, dest: AudioNode, score: Score, at: number): AudioScheduledSourceNode[] {
    const made: AudioScheduledSourceNode[] = [];
    for (const v of score.voices) {
      const t0 = at + v.delay;
      const source = v.type === 'noise' ? noise(ctx) : tone(ctx, v, t0);
      const gain = ctx.createGain();

      // Graph first, so nothing is ever started into nowhere.
      let node: AudioNode = source;
      if (v.filter) {
        const f = ctx.createBiquadFilter();
        f.type = v.filter.type;
        f.frequency.setValueAtTime(v.filter.freq, t0);
        if (v.filter.q !== undefined) f.Q.setValueAtTime(v.filter.q, t0);
        // Noise has no pitch of its own, so a `toFreq` on a noise voice is a
        // sweep of whatever is SHAPING it — the band, here. That is what makes
        // the page turn read as paper rather than as a burst of static.
        if (v.toFreq !== undefined && v.type === 'noise') {
          f.frequency.exponentialRampToValueAtTime(
            Math.max(v.toFreq, 20), t0 + v.attack + v.decay,
          );
        }
        node.connect(f);
        node = f;
      }
      node.connect(gain);
      gain.connect(dest);

      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(v.gain, t0 + v.attack);

      /**
       * START BEFORE STOP, always.
       *
       * `stop()` on a source that has not been started throws
       * `InvalidStateError`, and it throws at the FIRST cue — which is the one
       * moment the player has just asked for sound and gets an exception
       * instead. The scores are pure data and the tests are thorough, and
       * neither of them can see this: it is a property of the call order, and
       * only a real `AudioContext` has an opinion about it.
       */
      source.start(t0);
      if (!score.sustain) {
        // Exponential to a floor, then a hard zero: `exponentialRampToValueAtTime`
        // cannot reach 0, and a ramp that never arrives leaves the voice ringing.
        const end = t0 + v.attack + v.decay;
        gain.gain.exponentialRampToValueAtTime(Math.max(v.gain * 0.001, 1e-4), end);
        gain.gain.linearRampToValueAtTime(0, end + 0.01);
        source.stop(end + 0.02);
      }

      made.push(source);
    }
    return made;
  }
}

/**
 * `resume`, `suspend` and `close` all return promises an engine may reject —
 * a device unplugged, a policy refusal, a context already closed. `void` only
 * silences the linter; the rejection still arrives, unhandled.
 */
function quietly(pending: Promise<unknown> | undefined): void {
  pending?.catch(() => undefined);
}

function tone(ctx: AudioContext, v: Voice, t0: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = v.type === 'noise' ? 'sine' : v.type;
  o.frequency.setValueAtTime(v.freq, t0);
  if (v.toFreq !== undefined) {
    o.frequency.exponentialRampToValueAtTime(
      Math.max(v.toFreq, 1), t0 + v.attack + v.decay,
    );
  }
  return o;
}

/**
 * A second of white noise on a loop. One buffer per context would be tidier;
 * one per burst is two hundred bytes and a garbage collection, and the page
 * turn happens once a year.
 */
function noise(ctx: AudioContext): AudioBufferSourceNode {
  const frames = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}
