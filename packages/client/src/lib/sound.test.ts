import { describe, expect, it, vi } from 'vitest';
import { loadBundle } from '@ed/content';
import { canonical } from '@ed/core';
import { RegisterS, type Register } from '@ed/schema';
import type { Platform } from '../platform.js';
import { createGame, type GameActions, type Outcome } from './game.js';
import { CUES, PEAK, Sound, cueScore, droneScore, type Cue, type DroneInput, type Score } from './sound';
import { SoundBed, droneFor, outcomeCue, runningRegisters, soundActions } from './sound-bed';

/**
 * Sound fails silently — that is not a pun, it is the whole problem. A cue
 * whose gain is zero, a voice above the range of a laptop speaker, a decay of
 * zero seconds: every one of them is a cue that plays nothing, and nothing is
 * exactly what a working cue that nobody triggered also plays.
 *
 * So the score tests assert the shape of a healthy sound design rather than
 * that the functions returned something. None of them constructs an
 * `AudioContext`; everything worth checking is in the description.
 *
 * Below them, the game's half (#1986): the player over a fake engine, the bed
 * that decides when it may be heard, and a played session that hears the
 * right cue at each committed moment and saves the same bytes loud or silent.
 * One file rather than three because `lanes.test.ts` caps how many test files
 * may go unmeasured, and this one already is.
 */

const peakOf = (s: Score) => s.voices.reduce((a, v) => a + v.gain, 0);
const endOf = (s: Score) => Math.max(...s.voices.map((v) => v.delay + v.attack + v.decay));

describe('every cue makes a sound', () => {
  it.each(CUES)('%s has voices, and all of them are audible', (cue) => {
    const score = cueScore(cue);
    expect(score.voices.length, `${cue} has no voices`).toBeGreaterThan(0);
    for (const v of score.voices) {
      expect(v.gain, `${cue}: a voice at zero gain plays nothing`).toBeGreaterThan(0);
      expect(v.decay, `${cue}: a voice with no decay never sounds`).toBeGreaterThan(0);
      // 40Hz is about where a laptop speaker gives up; 12kHz is where the
      // sound stops being a sound and starts being a complaint.
      expect(v.freq, `${cue}: ${v.freq}Hz is below anything that will play`).toBeGreaterThan(30);
      expect(v.freq, `${cue}: ${v.freq}Hz is too high to be a cue`).toBeLessThan(12000);
    }
  });

  it.each(CUES)('%s stays under the peak', (cue) => {
    expect(peakOf(cueScore(cue)), `${cue} is too loud`).toBeLessThanOrEqual(PEAK);
  });

  /**
   * §24's word is "sparse". A cue that rings for three seconds while the
   * player is holding down "+25 years" is a cue that overlaps itself twelve
   * times, and the bell is the only one allowed any tail at all.
   */
  it.each(CUES)('%s is over quickly', (cue) => {
    const limit = cue === 'bell' ? 3 : 1.2;
    expect(endOf(cueScore(cue)), `${cue} outstays its welcome`).toBeLessThanOrEqual(limit);
  });

  it('no cue sustains — only the drone holds', () => {
    for (const cue of CUES) expect(cueScore(cue).sustain, cue).toBeFalsy();
  });
});

describe('the three valences are three different sounds', () => {
  /**
   * The bug this is written for: `boon` and `blow` returning the same score,
   * which looks completely correct in every view and makes the whole valence
   * system a no-op you cannot hear.
   */
  it('boon, blow and plain are all distinct', () => {
    const [boon, blow, plain] = ['boon', 'blow', 'plain'].map((c) => JSON.stringify(cueScore(c as Cue)));
    expect(boon).not.toBe(blow);
    expect(boon).not.toBe(plain);
    expect(blow).not.toBe(plain);
  });

  /** The mechanism, not a fixed frequency: a boon goes up. */
  it('the boon rises and the blow falls', () => {
    const boon = cueScore('boon').voices;
    const first = boon[0]!;
    const later = boon.find((v) => v.delay > first.delay);
    expect(later, 'the boon has only one note, so it has no direction').toBeDefined();
    expect(later!.freq, 'the boon does not rise').toBeGreaterThan(first.freq);

    for (const v of cueScore('blow').voices) {
      if (v.toFreq !== undefined) expect(v.toFreq, 'the blow does not fall').toBeLessThan(v.freq);
    }
  });

  /**
   * The house takes far more blows than boons over a thousand years. A failure
   * chime louder than the success chime turns the run into a scolding.
   */
  it('the blow is not the louder of the two', () => {
    expect(peakOf(cueScore('blow'))).toBeLessThanOrEqual(peakOf(cueScore('boon')));
  });

  /** The commonest cue in the run, so it has to be the smallest. */
  it('the plain note is the quietest and shortest thing here', () => {
    const plain = cueScore('plain');
    expect(plain.voices).toHaveLength(1);
    for (const cue of CUES) {
      if (cue === 'plain') continue;
      expect(peakOf(plain), `plain is louder than ${cue}`).toBeLessThan(peakOf(cueScore(cue)));
    }
  });
});

describe('the drone shifts by Age', () => {
  const registers = RegisterS.options;

  it('is a real drone: low, held, and swelling rather than struck', () => {
    const score = droneScore({ registers: ['warm'], frame: false })!;
    expect(score.sustain).toBe(true);
    for (const v of score.voices) {
      expect(v.freq, `${v.freq}Hz is not a drone`).toBeLessThan(200);
      expect(v.attack, 'a drone that starts instantly is a bang').toBeGreaterThan(1);
    }
  });

  /**
   * If two registers produce the same voices, the drone does not shift by Age
   * — and nothing anywhere would report that, because it would still hum.
   */
  it('every register sounds different from every other', () => {
    const heard = new Map<string, Register>();
    for (const r of registers) {
      const key = JSON.stringify(droneScore({ registers: [r], frame: false }));
      const clash = heard.get(key);
      expect(clash, `${r} and ${clash} are the same drone`).toBeUndefined();
      heard.set(key, r);
    }
    expect(heard.size).toBe(registers.length);
  });

  it('the root is there with no Age running, and it is only the root', () => {
    const quiet = droneScore({ registers: [], frame: false })!;
    const one = droneScore({ registers: ['cold'], frame: false })!;
    expect(quiet.voices.length).toBeGreaterThan(0);
    expect(one.voices.length, 'an Age adds nothing to the drone')
      .toBeGreaterThan(quiet.voices.length);
  });

  /** Overlapping Ages stack. Three at once should sound like three at once. */
  it('stacks, and each further Age is quieter than the last', () => {
    const three = droneScore({ registers: ['warm', 'cold', 'institutional'], frame: false })!;
    const one = droneScore({ registers: ['warm'], frame: false })!;
    expect(three.voices.length).toBeGreaterThan(one.voices.length);

    const added = three.voices.slice(2).filter((_, i) => i % 2 === 0);
    for (let i = 1; i < added.length; i++) {
      expect(added[i]!.gain, 'a later Age is not quieter').toBeLessThan(added[i - 1]!.gain);
    }
  });

  it('keeps the authored five-Age mix and caps even much larger overlapping stacks', () => {
    const ordinary: Register[] = ['warm', 'cold', 'institutional', 'cold', 'warm'];
    const baseline = droneScore({ registers: ordinary, frame: false })!;
    expect(peakOf(baseline)).toBeLessThanOrEqual(PEAK);
    // Earlier chords must not be silently quietened by the new ceiling.
    expect(baseline.voices[0]!.gain).toBe(0.045);
    expect(baseline.voices[2]!.gain).toBe(0.038);

    // Six is still safe; seven crosses PEAK before attenuation. Longer
    // fictional overlaps must not become louder merely because they are rare.
    for (const count of [6, 7, 32, 100]) {
      const registers = Array.from({ length: count }, (_, i) => ordinary[i % ordinary.length]!);
      const chord = droneScore({ registers, frame: false })!;
      expect(chord.voices).toHaveLength(2 + count * 2);
      expect(peakOf(chord), `${count} simultaneous Ages exceed the volume ceiling`)
        .toBeLessThanOrEqual(PEAK);
      expect(chord.voices.every((voice) => voice.gain > 0)).toBe(true);
      expect(chord.voices[2]!.gain).toBeGreaterThan(chord.voices[4]!.gain);
    }
  });

  /** §24: the frame "kills the drone entirely". Not ducks it. Kills it. */
  it('the frame is silent', () => {
    expect(droneScore({ registers: ['warm', 'cold'], frame: true })).toBeNull();
    expect(droneScore({ registers: [], frame: true })).toBeNull();
  });
});

// ── The player, over a fake engine ──────────────────────────────────────

/** An `AudioParam` that keeps the last value it was sent. */
function param(value = 0) {
  return {
    value,
    setValueAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
    exponentialRampToValueAtTime(v: number) {
      // A real engine refuses this; `sound.ts` ramps to a floor, then to zero.
      if (v <= 0) throw new RangeError('an exponential ramp cannot reach zero');
      this.value = v;
    },
  };
}

class FakeSource {
  disconnected = 0;
  disconnect() { this.disconnected++; }
  started: number | undefined;
  stopped: number | undefined;
  frequency = param();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect<T>(node: T) { return node; }
  /** Dispatch the Web Audio ended event after a scheduled stop has completed. */
  finish() {
    if (this.stopped === undefined) throw new Error('source finished without a stop');
    const listener = this.onended;
    this.onended = null;
    listener?.();
  }
  start(at = 0) { this.started = at; }
  stop(at = 0) {
    // What a real engine does, and what no score test can see: `sound.ts`'s
    // START BEFORE STOP, enforced here so a regression throws in a test.
    if (this.started === undefined) throw new Error('InvalidStateError: stopped before it started');
    this.stopped = at;
  }
}

/**
 * Just enough `AudioContext` for `Sound` to build into. `refuse` is a device
 * that will not open; `reject` is one whose resume/suspend/close all refuse.
 */
function fakeEngine(options: { refuse?: boolean; reject?: boolean; refuseGain?: boolean; throwClose?: boolean } = {}) {
  const made: FakeContext[] = [];
  class FakeContext {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 100;
    destination = {};
    sources: FakeSource[] = [];
    filters: { disconnected: number; disconnect(): void }[] = [];
    gains: { gain: ReturnType<typeof param>; disconnected: number; disconnect(): void }[] = [];
    calls: string[] = [];
    buffers: unknown[] = [];
    constructor() {
      if (options.refuse) throw new Error('NotSupportedError: no audio device');
      made.push(this);
    }
    createGain() {
      if (options.refuseGain) throw new Error('NotSupportedError: output gain unavailable');
      const node = {
        gain: param(1), disconnected: 0,
        connect: <T>(to: T) => to,
        disconnect() { this.disconnected++; },
      };
      this.gains.push(node);
      return node;
    }
    createOscillator() { return this.source(); }
    createBufferSource() { return this.source(); }
    createBuffer(_channels: number, frames: number) {
      const data = new Float32Array(frames);
      const buffer = { getChannelData: () => data };
      this.buffers.push(buffer);
      return buffer;
    }
    createBiquadFilter() {
      const filter = {
        type: '', frequency: param(), Q: param(), disconnected: 0,
        connect: <T>(to: T) => to,
        disconnect() { this.disconnected++; },
      };
      this.filters.push(filter);
      return filter;
    }
    resume() { return this.settle('resume', 'running'); }
    suspend() { return this.settle('suspend', 'suspended'); }
    close() {
      if (options.throwClose) {
        this.calls.push('close');
        throw new Error('InvalidStateError: context already closed');
      }
      return this.settle('close', 'closed');
    }
    private source() {
      const s = new FakeSource();
      this.sources.push(s);
      return s;
    }
    private settle(call: string, state: string) {
      this.calls.push(call);
      if (options.reject) return Promise.reject(new Error(`${call} refused`));
      this.state = state;
      return Promise.resolve();
    }
  }
  return { ctor: FakeContext as unknown as new () => AudioContext, made };
}

type FakeContext = ReturnType<typeof fakeEngine>['made'][number];

/** The sources still sounding: started, and never told to stop. Only a drone does that. */
const humming = (ctx: FakeContext) => ctx.sources.filter((s) => s.started !== undefined && s.stopped === undefined);
/** The pitches the drone is holding, rounded for comparison. */
const heldPitches = (ctx: FakeContext) => humming(ctx).map((s) => Math.round(s.frequency.value * 100) / 100).sort((a, b) => a - b);
const pitchesOf = (input: DroneInput) => droneScore(input)!.voices.map((v) => Math.round(v.freq * 100) / 100).sort((a, b) => a - b);

const WARM: DroneInput = { registers: ['warm'], frame: false };
const COLD: DroneInput = { registers: ['cold'], frame: false };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the player, over a fake engine', () => {
  it('survives throwing browser AudioContext getters and still tries the prefixed fallback', () => {
    const fallback = fakeEngine();
    vi.stubGlobal('window', {
      get AudioContext(): never { throw new Error('NotAllowedError: AudioContext getter refused'); },
      get webkitAudioContext() { return fallback.ctor; },
    });
    try {
      const sound = new Sound();
      expect(sound.available).toBe(true);
      expect(fallback.made, 'engine creation must wait for an audible cue').toHaveLength(0);
      sound.muted = false;
      expect(() => sound.cue('page')).not.toThrow();
      expect(fallback.made).toHaveLength(1);

      vi.stubGlobal('window', {
        get AudioContext(): never { throw new Error('AudioContext refused'); },
        get webkitAudioContext(): never { throw new Error('webkitAudioContext refused'); },
      });
      expect(() => new Sound()).not.toThrow();
      const silent = new Sound();
      expect(silent.available).toBe(false);
      silent.muted = false;
      expect(() => silent.cue('seal')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tries prefixed Web Audio when the standard constructor refuses', () => {
    const standard = fakeEngine({ refuse: true });
    const prefixed = fakeEngine();
    vi.stubGlobal('window', { AudioContext: standard.ctor, webkitAudioContext: prefixed.ctor });
    try {
      const sound = new Sound();
      expect(sound.available).toBe(true);
      expect(prefixed.made, 'the fallback was opened before the first cue').toHaveLength(0);
      sound.muted = false;
      expect(() => sound.cue('page')).not.toThrow();
      expect(sound.available).toBe(true);
      expect(standard.made).toHaveLength(0);
      expect(prefixed.made).toHaveLength(1);
      sound.setDrone(WARM);
      expect(heldPitches(prefixed.made[0]!)).toEqual(pitchesOf(WARM));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes a partly initialised standard engine before using the prefixed one', () => {
    const standard = fakeEngine({ refuseGain: true });
    const prefixed = fakeEngine();
    vi.stubGlobal('window', { AudioContext: standard.ctor, webkitAudioContext: prefixed.ctor });
    try {
      const sound = new Sound();
      sound.muted = false;
      expect(() => sound.cue('plain')).not.toThrow();
      expect(standard.made).toHaveLength(1);
      expect(standard.made[0]!.calls).toContain('close');
      expect(standard.made[0]!.state).toBe('closed');
      expect(prefixed.made).toHaveLength(1);
      expect(sound.available).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails silently after both constructors refuse and does not retry them', () => {
    const standard = fakeEngine({ refuse: true });
    const prefixed = fakeEngine({ refuse: true });
    vi.stubGlobal('window', { AudioContext: standard.ctor, webkitAudioContext: prefixed.ctor });
    try {
      const sound = new Sound();
      sound.muted = false;
      expect(() => sound.cue('page')).not.toThrow();
      expect(sound.available).toBe(false);
      expect(() => { sound.cue('seal'); sound.setDrone(WARM); }).not.toThrow();

      // Explicit injection is intentionally a single engine, even if window
      // happens to expose another constructor.
      const injected = new Sound(standard.ctor);
      injected.muted = false;
      expect(() => injected.cue('bell')).not.toThrow();
      expect(injected.available).toBe(false);
      expect(prefixed.made).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('builds nothing while muted, then starts every voice before it stops one', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.cue('bell');
    s.setDrone(WARM);
    expect(e.made, 'a muted player opened an audio context').toHaveLength(0);

    s.muted = false; // brings back the drone it was given while muted
    s.cue('page');
    const ctx = e.made[0]!;
    expect(e.made).toHaveLength(1);
    expect(ctx.calls).toContain('resume');
    expect(ctx.sources).toHaveLength(cueScore('page').voices.length + droneScore(WARM)!.voices.length);
    expect(ctx.sources.every((source) => source.started !== undefined)).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
  });

  it('disconnects every finished cue voice and filter, keeping the shared output alive (#2908)', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page');
    const ctx = e.made[0]!;
    const output = ctx.gains[0]!;
    const page = [...ctx.sources];
    const filters = [...ctx.filters];
    const cueGains = ctx.gains.slice(1);
    expect(page).toHaveLength(2);
    expect(filters).toHaveLength(2);
    expect(cueGains).toHaveLength(2);

    page[0]!.finish();
    expect(page[0]!.disconnected).toBe(1);
    expect(filters[0]!.disconnected).toBe(1);
    expect(cueGains[0]!.disconnected).toBe(1);
    expect(cueGains[1]!.disconnected, 'ending one voice disconnected its sibling').toBe(0);
    page[1]!.finish();
    page[0]!.finish(); // a duplicate ended event must be harmless
    expect(page[0]!.disconnected).toBe(1);
    expect(page[1]!.disconnected).toBe(1);
    expect(filters[1]!.disconnected).toBe(1);
    expect(cueGains[1]!.disconnected).toBe(1);
    expect(output.disconnected, 'a cue disconnected the common output').toBe(0);

    const previous = ctx.sources.length;
    s.cue('bell'); // tonal sources have no filter, but still own per-voice gains
    const bell = ctx.sources.slice(previous);
    expect(bell).toHaveLength(cueScore('bell').voices.length);
    for (const source of bell) source.finish();
    expect(bell.every((source) => source.disconnected === 1)).toBe(true);
    expect(ctx.gains.slice(1 + cueGains.length).every((gain) => gain.disconnected === 1)).toBe(true);
    expect(output.disconnected).toBe(0);
  });

  it('cuts previously scheduled cues before a quick unmute or zero-volume recovery (#2909)', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('bell');
    const ctx = e.made[0]!;
    const old = [...ctx.sources];
    s.muted = true;
    expect(old.every((source) => source.stopped === ctx.currentTime && source.disconnected === 1),
      'muting left bell voices able to reappear').toBe(true);

    s.muted = false;
    expect(old.every((source) => source.stopped === ctx.currentTime)).toBe(true);
    s.cue('boon');
    const newer = ctx.sources.slice(old.length);
    s.volume = 0;
    expect(newer.every((source) => source.stopped === ctx.currentTime && source.disconnected === 1),
      'zero volume left a cue scheduled to ring after the slider rises').toBe(true);
    s.volume = 0.5;
    const before = ctx.sources.length;
    s.cue('plain');
    expect(ctx.sources.length).toBe(before + 1);
    expect(ctx.gains[0]!.disconnected).toBe(0);
  });

  it.each(['mute', 'suspend', 'close'] as const)(
    'stops and disconnects cues on %s when the host audio clock is unreadable',
    (action) => {
      const e = fakeEngine();
      const s = new Sound(e.ctor);
      s.muted = false;
      s.cue('page');
      const ctx = e.made[0]!;
      const sources = [...ctx.sources];

      // A disconnected mobile audio device may invalidate currentTime while
      // previously scheduled one-shots still need immediate retirement.
      Object.defineProperty(ctx, 'currentTime', {
        get() { throw new Error('InvalidStateError: audio clock unavailable'); },
      });

      expect(() => {
        if (action === 'mute') s.muted = true;
        else if (action === 'suspend') s.suspend();
        else s.close();
      }).not.toThrow();
      expect(sources.every((source) => source.stopped === 0 && source.disconnected === 1),
        'an unreadable clock left one-shot sources connected').toBe(true);
      expect(ctx.filters.every((filter) => filter.disconnected === 1)).toBe(true);
      s.close();
    },
  );

  it('cuts fading and active drones when a host loses its audio clock during closure', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const earlierGain = ctx.gains[1]!;
    const laterGainIndex = ctx.gains.length;
    s.setDrone(COLD);
    const laterGain = ctx.gains[laterGainIndex]!;
    const allSources = [...ctx.sources];
    expect(earlierGain.disconnected, 'the earlier Age was supposed to be fading').toBe(0);

    Object.defineProperty(ctx, 'currentTime', {
      get() { throw new Error('InvalidStateError: audio clock unavailable'); },
    });
    expect(() => s.close()).not.toThrow();
    expect(earlierGain.disconnected).toBe(1);
    expect(laterGain.disconnected).toBe(1);
    expect(allSources.every((source) => source.stopped === 0),
      'a sustained or fading drone was left scheduled').toBe(true);
    expect(ctx.calls).toContain('close');
  });

  it('retires one-shot cues before host suspension and closure freeze the audio clock (#2910)', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page');
    const ctx = e.made[0]!;
    const paused = [...ctx.sources];
    s.suspend();
    expect(ctx.calls).toContain('suspend');
    expect(paused.every((source) => source.stopped === ctx.currentTime && source.disconnected === 1),
      'old page sounds were left pending on the suspended audio clock').toBe(true);
    expect(ctx.filters.every((filter) => filter.disconnected === 1)).toBe(true);

    s.wake();
    s.cue('seal');
    const beforeClose = ctx.sources.slice(paused.length);
    s.close();
    expect(ctx.calls).toContain('close');
    expect(beforeClose.every((source) => source.stopped === ctx.currentTime && source.disconnected === 1),
      'close left one-shot sounds connected to a frozen device').toBe(true);
    s.cue('plain');
    expect(e.made).toHaveLength(2);
    expect(e.made[1]).not.toBe(ctx);
  });

  it('ignores invalidated cue graph disconnections and still allows new sounds', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page');
    const ctx = e.made[0]!;
    ctx.sources[0]!.disconnect = () => { throw new Error('InvalidStateError: source released'); };
    ctx.filters[0]!.disconnect = () => { throw new Error('InvalidStateError: filter released'); };
    ctx.gains[1]!.disconnect = () => { throw new Error('InvalidStateError: gain released'); };
    expect(() => s.muted = true).not.toThrow();
    expect(s.available).toBe(true);
    s.muted = false;
    expect(() => s.cue('seal')).not.toThrow();
    expect(ctx.sources).toHaveLength(2 + cueScore('seal').voices.length);
  });

  it('reuses page noise within a context, but makes a new buffer for a replacement context', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page'); // two independently filtered noise bursts
    s.cue('page'); // another turn of the page

    const first = e.made[0]!;
    const noiseSources = first.sources.filter((source) => source.buffer !== null);
    expect(noiseSources.length).toBeGreaterThan(2);
    expect(first.buffers, 'each page burst allocated another noise buffer').toHaveLength(1);
    expect(new Set(noiseSources.map((source) => source.buffer)).size).toBe(1);

    const original = first.buffers[0];
    s.close();
    s.cue('page');
    const replacement = e.made[1]!;
    expect(replacement.buffers).toHaveLength(1);
    expect(replacement.buffers[0], 'a new audio device reused the old context buffer').not.toBe(original);
  });

  it('does not open an audio device at zero volume and restores the latest drone when raised', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.volume = 0;
    s.muted = false;
    s.setDrone(WARM);
    s.cue('page');
    s.wake();
    expect(e.made, 'a silent direct Sound opened an audio device').toHaveLength(0);

    s.volume = 0.25;
    const ctx = e.made[0]!;
    const voices = droneScore(WARM)!.voices.length;
    expect(ctx.sources).toHaveLength(voices);
    expect(ctx.gains[0]!.gain.value).toBe(0.25);

    s.volume = 0;
    expect(ctx.gains[0]!.gain.value).toBe(0);
    expect(ctx.sources.every((source) => source.stopped === ctx.currentTime)).toBe(true);
    s.cue('seal');
    s.setDrone(WARM);
    s.wake();
    expect(ctx.sources, 'zero volume started more inaudible sources').toHaveLength(voices);

    s.volume = 0.4;
    expect(e.made, 'raising volume reopened an existing device').toHaveLength(1);
    expect(ctx.sources, 'restoring volume did not restore the current Age').toHaveLength(voices * 2);
    expect(ctx.gains[0]!.gain.value).toBe(0.4);
    s.close();
  });

  it('turns the whole bed down and never up', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.volume = 0.3;
    s.muted = false;
    s.cue('plain');
    const out = e.made[0]!.gains[0]!;
    expect(out.gain.value).toBe(0.3);
    s.volume = 4;
    expect(out.gain.value).toBe(1);
    s.volume = -1;
    expect(out.gain.value).toBe(0);
    // Bad values (for example from an unreliable host) cannot blast the
    // listener at full volume after they chose a quieter setting.
    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      s.volume = invalid;
      expect(out.gain.value).toBe(0);
    }
  });

  it('treats an invalidated host gain during a volume change as silence, not a settings error', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page');
    const ctx = e.made[0]!;

    // Some devices invalidate their audio output while a page is still open.
    // Their AudioParam setter can throw synchronously on the next preference.
    Object.defineProperty(ctx.gains[0]!.gain, 'value', {
      get: () => 1,
      set: () => { throw new Error('NotSupportedError: output device disappeared'); },
    });

    expect(() => { s.volume = 0.35; }).not.toThrow();
    expect(s.volume).toBe(0.35);
    expect(s.available).toBe(false);
    expect(ctx.calls).toContain('close');
    // A failed device must not stop subsequent settings changes either.
    expect(() => { s.volume = 0.5; }).not.toThrow();
    expect(s.volume).toBe(0.5);
    expect(() => s.cue('seal')).not.toThrow();
    expect(e.made).toHaveLength(1);
  });

  it('retires each old drone gain after its last source ends, without disconnecting the replacement', () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.setDrone(WARM);
    const ctx = e.made[0]!;
    const output = ctx.gains[0]!;
    const firstGain = ctx.gains[1]!;
    const firstSources = [...ctx.sources];
    const nextGainIndex = ctx.gains.length;

    sound.setDrone(COLD); // replaces an Age, preserving the old fade
    const secondGain = ctx.gains[nextGainIndex]!;
    expect(firstSources.every((source) => source.stopped === ctx.currentTime + 1.5)).toBe(true);
    expect(firstGain.disconnected).toBe(0);
    for (const source of firstSources.slice(0, -1)) source.finish();
    expect(firstGain.disconnected, 'one live source still owns the old graph').toBe(0);
    firstSources.at(-1)!.finish();
    expect(firstGain.disconnected).toBe(1);
    expect(secondGain.disconnected, 'retiring an old graph cut off the current Age').toBe(0);
    expect(output.disconnected, 'retiring a drone disconnected the shared output').toBe(0);

    // An immediate mute must clean up even when the audio clock freezes and
    // Web Audio cannot deliver an ended event until a later foreground visit.
    const laterSources = ctx.sources.slice(firstSources.length);
    sound.muted = true;
    expect(secondGain.disconnected).toBe(1);
    for (const source of laterSources) source.finish();
    expect(secondGain.disconnected, 'an ended event disconnected twice').toBe(1);
    expect(output.disconnected).toBe(0);
  });

  it('cuts every older fading Age before the audio clock freezes', () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.setDrone(WARM);
    const ctx = e.made[0]!;
    const first = [...ctx.sources];
    const firstGain = ctx.gains[1]!;

    const secondGainIndex = ctx.gains.length;
    sound.setDrone(COLD);
    const second = ctx.sources.slice(first.length);
    const secondGain = ctx.gains[secondGainIndex]!;
    const currentGainIndex = ctx.gains.length;
    sound.setDrone({ registers: ['institutional'], frame: false });
    const third = ctx.sources.slice(first.length + second.length);
    const currentGain = ctx.gains[currentGainIndex]!;

    expect(firstGain.disconnected).toBe(0);
    expect(secondGain.disconnected).toBe(0);
    expect(first.every((source) => source.stopped === ctx.currentTime + 1.5)).toBe(true);
    expect(second.every((source) => source.stopped === ctx.currentTime + 1.5)).toBe(true);

    // Neither older fade is this.drone any more. Both must be retired before
    // suspend freezes currentTime and later foreground playback resumes.
    sound.suspend();
    expect(ctx.calls).toContain('suspend');
    expect([...first, ...second, ...third].every((source) => source.stopped === ctx.currentTime),
      'an older Age can return after foregrounding').toBe(true);
    expect([firstGain, secondGain, currentGain].map((gain) => gain.disconnected)).toEqual([1, 1, 1]);
    for (const source of [...first, ...second]) source.finish();
    expect([firstGain, secondGain].map((gain) => gain.disconnected),
      'an old ended callback disconnected the same graph twice').toEqual([1, 1]);
    expect(ctx.gains[0]!.disconnected, 'suspending cut the shared output').toBe(0);
  });

  it.each(['mute', 'zero volume', 'suspend', 'close'] as const)(
    'cuts a pending ordinary fade on %s even with no current drone',
    (action) => {
      const e = fakeEngine();
      const sound = new Sound(e.ctor);
      sound.muted = false;
      sound.setDrone(WARM);
      const ctx = e.made[0]!;
      const fading = [...ctx.sources];
      const gain = ctx.gains[1]!;
      sound.setDrone(null); // stops playing, but the old graph is still fading
      expect(fading.every((source) => source.stopped === ctx.currentTime + 1.5)).toBe(true);
      expect(gain.disconnected).toBe(0);

      switch (action) {
        case 'mute': sound.muted = true; break;
        case 'zero volume': sound.volume = 0; break;
        case 'suspend': sound.suspend(); break;
        case 'close': sound.close(); break;
      }
      expect(fading.every((source) => source.stopped === ctx.currentTime),
        'a detached fade remained scheduled after the device was silenced').toBe(true);
      expect(gain.disconnected).toBe(1);
    },
  );

  it.each(['gain ramp', 'source stop'] as const)(
    'cuts the old Age and skips replacement when %s scheduling fails (#3175)',
    (failure) => {
      // An invalidated device can refuse teardown *and* context closure.
      // With no explicit graph cleanup, its old sustained drone remains live.
      const e = fakeEngine({ throwClose: true });
      const sound = new Sound(e.ctor);
      sound.muted = false;
      sound.setDrone(WARM);
      const ctx = e.made[0]!;
      const oldSources = [...ctx.sources];
      const oldGain = ctx.gains[1]!;
      const oldCount = ctx.sources.length;

      if (failure === 'gain ramp') {
        oldGain.gain.linearRampToValueAtTime = () => {
          throw new Error('NotSupportedError: gain schedule unavailable');
        };
      } else {
        const source = oldSources[0]!;
        const original = source.stop.bind(source);
        let refused = false;
        source.stop = (at = 0) => {
          if (!refused) {
            refused = true;
            throw new Error('InvalidStateError: scheduled stop unavailable');
          }
          original(at);
        };
      }

      expect(() => sound.setDrone(COLD)).not.toThrow();
      expect(sound.available, 'an invalidated engine should fail closed').toBe(false);
      expect(oldSources.every((source) => source.stopped === ctx.currentTime),
        'the old sustained Age can remain audible after failed teardown').toBe(true);
      expect(oldGain.disconnected, 'the old drone output was left connected').toBe(1);
      expect(ctx.calls).toContain('close');
      expect(ctx.sources, 'a failed engine built a replacement Age graph').toHaveLength(oldCount);
      expect(() => sound.cue('page')).not.toThrow();
      expect(ctx.sources).toHaveLength(oldCount);
    },
  );

  it('ignores gain-disconnect failure from a host that has already invalidated its output', () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.setDrone(WARM);
    const ctx = e.made[0]!;
    ctx.gains[1]!.disconnect = () => { throw new Error('InvalidStateError: device went away'); };
    sound.muted = true;
    expect(sound.available).toBe(true);
    expect(() => sound.cue('page')).not.toThrow();
  });

  it('leaves an unchanged drone alone, and stops for the frame and for no house at all', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const built = ctx.sources.length;
    s.setDrone({ registers: ['warm'], frame: false });
    expect(ctx.sources, 'an unchanged drone was restarted').toHaveLength(built);

    s.setDrone({ registers: ['warm'], frame: true });
    expect(humming(ctx), 'the frame did not kill the drone').toHaveLength(0);
    s.setDrone(WARM);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    s.setDrone(null);
    expect(humming(ctx)).toHaveLength(0);
  });

  it('silences the frame in milliseconds, while normal exits retain their fade', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const first = [...ctx.sources];

    s.setDrone({ registers: ['warm'], frame: true });
    expect(first.every((source) => source.stopped !== undefined
      && source.stopped <= ctx.currentTime + 0.05),
    'the frame left a long drone tail beneath the interlude').toBe(true);

    s.setDrone(WARM);
    const second = ctx.sources.slice(first.length);
    s.setDrone(null);
    expect(second.every((source) => source.stopped === ctx.currentTime + 1.5),
      'ordinary exits lost their gentle fade').toBe(true);
  });

  it('silences an already-ringing cue and keeps volume changes muted', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('bell');
    const ctx = e.made[0]!;
    const out = ctx.gains[0]!;
    expect(out.gain.value).toBe(1);
    expect(ctx.sources).toHaveLength(cueScore('bell').voices.length);

    // These voices are already scheduled to decay, so muting must silence the
    // common output rather than merely prevent the next cue from starting.
    s.muted = true;
    expect(out.gain.value).toBe(0);
    s.volume = 0.35;
    expect(out.gain.value, 'the volume slider unmuted a ringing bell').toBe(0);

    s.muted = false;
    expect(out.gain.value).toBe(0.35);
    expect(e.made, 'unmuting reopened the existing audio device').toHaveLength(1);
  });

  it('mutes the running drone promptly rather than leaving an audible tail', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const playing = [...ctx.sources];

    s.muted = true;
    // Output gain is already zero. Delaying source.stop() can let the old
    // drone return if the player immediately unmutes before its timer elapses.
    expect(playing.every((source) => source.stopped === ctx.currentTime),
    'mute left old sources scheduled to stop after a quick unmute').toBe(true);
    s.muted = false;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
  });

  it('suspends without forgetting, and wakes into what was playing', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(COLD);
    const ctx = e.made[0]!;
    s.muted = true;
    s.suspend();
    expect(humming(ctx)).toHaveLength(0);
    expect(ctx.calls).toContain('suspend');
    s.muted = false;
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
  });

  it('stops the current drone before suspending the audio clock, even without muting first', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const playing = [...ctx.sources];

    // Suspending freezes currentTime. A normal 1.4-second exit would remain
    // scheduled and could be heard again on resume alongside the next Age.
    s.suspend();
    expect(ctx.calls).toContain('suspend');
    // AudioContext.currentTime freezes at suspension: even a 20ms scheduled
    // stop cannot run while hidden, and could overlap the replacement on wake.
    expect(playing.every((source) => source.stopped === ctx.currentTime),
    'suspension left old sources pending on the frozen audio clock').toBe(true);

    s.wake();
    s.setDrone(COLD);
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
    expect(ctx.sources).toHaveLength(playing.length + droneScore(COLD)!.voices.length);
  });

  it('turns a device that will not open into silence, not an exception', () => {
    const e = fakeEngine({ refuse: true });
    const s = new Sound(e.ctor);
    s.muted = false;
    expect(() => s.cue('bell')).not.toThrow();
    expect(() => s.setDrone(WARM)).not.toThrow();
    expect(() => { s.wake(); s.suspend(); s.close(); }).not.toThrow();
    expect(s.available).toBe(false);
  });

  it('closes a newly opened context if output setup fails', () => {
    const e = fakeEngine({ refuseGain: true });
    const s = new Sound(e.ctor);
    s.muted = false;

    expect(() => s.cue('page')).not.toThrow();
    expect(s.available).toBe(false);
    expect(e.made).toHaveLength(1);
    expect(e.made[0]!.calls).toContain('close');
    expect(e.made[0]!.state).toBe('closed');
    // The failed context is not reused or repeatedly opened by later cues.
    s.cue('bell');
    expect(e.made).toHaveLength(1);
  });

  it('disposes and can restart after a host throws synchronously on close', () => {
    const e = fakeEngine({ throwClose: true });
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('plain');
    expect(() => s.close()).not.toThrow();
    expect(e.made[0]!.calls).toContain('close');
    expect(s.available).toBe(true);
    s.cue('page');
    expect(e.made).toHaveLength(2);
  });

  it('stops and disconnects a drone before closing the clock that drives its fade', () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.setDrone(WARM);
    const ctx = e.made[0]!;
    const sources = [...ctx.sources];
    const droneGain = ctx.gains[1]!;

    // A context's clock can stop as soon as close() starts. Waiting for a
    // 1.4-second fade/onended on that frozen clock leaves the old graph pending.
    s.close();
    expect(ctx.calls).toContain('close');
    expect(sources.every((source) => source.stopped === ctx.currentTime),
      'shutdown scheduled a drone stop beyond the closed audio clock').toBe(true);
    expect(droneGain.disconnected,
      'shutdown left the old drone gain connected until an ended event').toBe(1);

    // A later session is allowed to open a new context, not reuse the closed one.
    s.cue('plain');
    expect(e.made).toHaveLength(2);
    expect(e.made[1]).not.toBe(ctx);
  });

  it('recovers the Age drone after a foreground resume needs another user gesture', async () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    const resume = ctx.resume.bind(ctx);
    let activationRequired = false;
    ctx.resume = () => {
      if (activationRequired) {
        ctx.calls.push('resume:gesture-required');
        return Promise.reject(Object.assign(new Error('activation required'), { name: 'NotAllowedError' }));
      }
      return resume();
    };

    // A pageshow can unmute the saved Age before any fresh user activation.
    page.fire('win:pagehide');
    expect(ctx.state).toBe('suspended');
    activationRequired = true;
    page.fire('win:pageshow');
    await settle();
    expect(ctx.calls).toContain('resume:gesture-required');
    expect(bed.audible, 'temporary autoplay policy refusal disabled the engine').toBe(true);
    expect(e.made, 'temporary autoplay policy refusal discarded the context').toHaveLength(1);

    // The next actual gesture may resume that same context and play new cues.
    activationRequired = false;
    page.fire('win:pointerdown');
    await settle();
    expect(ctx.state).toBe('running');
    const before = ctx.sources.length;
    bed.cue('seal');
    expect(ctx.sources).toHaveLength(before + cueScore('seal').voices.length);
    bed.dispose();
  });

  it('cuts a drone scheduled before async activation denial and restores the latest Age on a gesture', async () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.setDrone(WARM);
    const ctx = e.made[0]!;
    sound.suspend();
    expect(ctx.state).toBe('suspended');

    const resume = ctx.resume.bind(ctx);
    ctx.resume = () => {
      ctx.calls.push('resume:async-denied');
      return Promise.reject(Object.assign(new Error('activation required'), { name: 'NotAllowedError' }));
    };

    // Before the promise settles, setDrone has scheduled the new Age on a
    // frozen audio clock. A later gesture must not start that stale graph.
    const before = ctx.sources.length;
    const beforeGains = ctx.gains.length;
    sound.setDrone(COLD);
    const refusedGain = ctx.gains[beforeGains]!;
    const refused = ctx.sources.slice(before);
    expect(refused).toHaveLength(droneScore(COLD)!.voices.length);
    expect(humming(ctx)).toHaveLength(refused.length);
    await settle();

    expect(sound.available, 'an activation denial is temporary').toBe(true);
    expect(refused.every((source) => source.stopped === ctx.currentTime),
      'async denial left sustained sources waiting for a later unlock').toBe(true);
    expect(humming(ctx)).toHaveLength(0);
    expect(refusedGain.disconnected, 'the rejected drone gain was left connected').toBe(1);

    ctx.resume = resume;
    sound.wake();
    expect(ctx.state).toBe('running');
    expect(heldPitches(ctx), 'the most recent Age was not rebuilt after recovery').toEqual(pitchesOf(COLD));
    expect(e.made).toHaveLength(1);
    sound.close();
  });

  it('does not replay an old cue after a temporary user-activation refusal (#1986)', async () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.cue('plain'); // Open a functioning context before backgrounding.
    const ctx = e.made[0]!;
    sound.suspend();
    expect(ctx.state).toBe('suspended');

    const resume = ctx.resume.bind(ctx);
    ctx.resume = () => {
      ctx.calls.push('resume:gesture-required');
      return Promise.reject(Object.assign(new Error('activation required'), { name: 'NotAllowedError' }));
    };

    // The host rejects this resume asynchronously; the bell was scheduled on
    // a frozen audio clock and could otherwise ring on an unrelated next tap.
    const before = ctx.sources.length;
    sound.cue('bell');
    const rejected = ctx.sources.slice(before);
    expect(rejected).toHaveLength(cueScore('bell').voices.length);
    expect(rejected.some((source) => source.stopped !== ctx.currentTime)).toBe(true);
    await settle();

    expect(sound.available, 'temporary activation denial disabled the device').toBe(true);
    expect(rejected.every((source) => source.stopped === ctx.currentTime && source.disconnected === 1),
      'a stale cue can play when a later gesture unlocks the host').toBe(true);

    ctx.resume = resume;
    sound.wake(); // The next gesture may unlock this same device.
    await settle();
    expect(ctx.state).toBe('running');
    expect(e.made).toHaveLength(1);
    const freshStart = ctx.sources.length;
    sound.cue('seal');
    expect(ctx.sources.slice(freshStart)).toHaveLength(cueScore('seal').voices.length);
    expect(rejected.every((source) => source.disconnected === 1)).toBe(true);
    sound.close();
  });

  it('recovers after a synchronous activation refusal without replaying an old cue (#1986)', () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.setDrone(WARM);
    const ctx = e.made[0]!;
    sound.suspend();
    expect(ctx.state).toBe('suspended');

    const resume = ctx.resume.bind(ctx);
    ctx.resume = () => {
      ctx.calls.push('resume:sync-denied');
      throw Object.assign(new Error('activation required'), { name: 'NotAllowedError' });
    };
    const before = ctx.sources.length;
    // The new Age and the bell arrived before the next permitted gesture.
    // Neither may queue a stale sound on the suspended audio clock.
    expect(() => {
      sound.setDrone(COLD);
      sound.cue('bell');
      sound.wake();
    }).not.toThrow();
    expect(sound.available, 'a temporary synchronous policy denial disabled the device').toBe(true);
    expect(ctx.sources).toHaveLength(before);
    expect(humming(ctx)).toHaveLength(0);

    ctx.resume = resume;
    sound.wake();
    expect(ctx.state).toBe('running');
    expect(heldPitches(ctx), 'the latest Age drone was not restored').toEqual(pitchesOf(COLD));
    const freshStart = ctx.sources.length;
    sound.cue('seal');
    expect(ctx.sources.slice(freshStart)).toHaveLength(cueScore('seal').voices.length);
    expect(e.made, 'a retryable activation refusal reopened the audio device').toHaveLength(1);
    sound.close();
  });

  it('fails closed on asynchronous resume refusals with unreadable error names (#3171)', async () => {
    // Rejection reasons are not guaranteed to be ordinary Error objects.
    // A hostile native adapter may expose a throwing accessor or proxy trap.
    // The rejection handler must not itself create an unhandled rejection.
    const throwingName = Object.defineProperty({}, 'name', {
      get() { throw new Error('native error name unavailable'); },
    });
    const throwingHas = new Proxy({}, {
      has() { throw new Error('native error property lookup unavailable'); },
    });
    const unheard: unknown[] = [];
    const note = (reason: unknown) => unheard.push(reason);
    process.on('unhandledRejection', note);
    try {
      for (const reason of [throwingName, throwingHas]) {
        const e = fakeEngine();
        const sound = new Sound(e.ctor);
        sound.muted = false;
        sound.cue('plain');
        const ctx = e.made[0]!;
        sound.suspend();
        ctx.resume = () => Promise.reject(reason);

        expect(() => sound.cue('bell')).not.toThrow();
        await settle();
        expect(sound.available, 'an unreadable rejection did not silence the failed engine').toBe(false);
        expect(ctx.calls).toContain('close');
        const sources = ctx.sources.length;
        sound.cue('seal');
        expect(ctx.sources).toHaveLength(sources);
      }
      await settle();
      expect(unheard, 'the rejection classifier created another unhandled rejection').toEqual([]);
    } finally {
      process.off('unhandledRejection', note);
    }
  });

  it('fails closed on a synchronous resume refusal with a throwing error name (#3171)', () => {
    const e = fakeEngine();
    const sound = new Sound(e.ctor);
    sound.muted = false;
    sound.cue('plain');
    const ctx = e.made[0]!;
    sound.suspend();
    ctx.resume = () => {
      throw Object.defineProperty({}, 'name', {
        get() { throw new Error('native error name unavailable'); },
      });
    };
    expect(() => sound.cue('seal')).not.toThrow();
    expect(sound.available).toBe(false);
    expect(ctx.calls).toContain('close');
  });

  it('stops scheduling audio after an asynchronous resume refusal', async () => {
    const e = fakeEngine({ reject: true });
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('seal');
    const ctx = e.made[0]!;
    expect(s.available).toBe(true); // The browser's refusal has not settled yet.

    await settle();
    expect(s.available).toBe(false);
    const sources = ctx.sources.length;
    s.cue('page');
    s.setDrone(WARM);
    s.wake();
    expect(ctx.sources).toHaveLength(sources);
    expect(e.made).toHaveLength(1);
  });

  it('fails closed if the host refuses to suspend a running audio context', async () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('page');
    const ctx = e.made[0]!;
    ctx.suspend = () => Promise.reject(new Error('host suspended audio incorrectly'));

    s.suspend();
    await settle();
    expect(s.available).toBe(false);
    expect(() => s.cue('bell')).not.toThrow();
    expect(e.made).toHaveLength(1);
  });

  it('ignores late refusals from a context already disposed', async () => {
    const e = fakeEngine({ reject: true });
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('seal');
    s.close(); // The old context's pending resume can still reject later.
    await settle();
    expect(s.available).toBe(true);
    s.cue('page');
    expect(e.made).toHaveLength(2);
  });

  it('never leaves a refused promise unheard', async () => {
    const unheard: unknown[] = [];
    const note = (reason: unknown) => unheard.push(reason);
    process.on('unhandledRejection', note);
    try {
      const e = fakeEngine({ reject: true });
      const s = new Sound(e.ctor);
      s.muted = false;
      s.cue('seal');
      s.setDrone(WARM);
      s.wake();
      s.suspend();
      s.close();
      await settle();
      await settle();
      expect(e.made[0]!.calls).toEqual(expect.arrayContaining(['resume', 'suspend', 'close']));
      expect(unheard).toEqual([]);
    } finally {
      process.off('unhandledRejection', note);
    }
  });
});

// ── The bed: when the game may be heard ─────────────────────────────────

/** A document and window that only keep their listeners. */
function fakePage(hidden = false) {
  const listeners = new Map<string, Set<() => void>>();
  const target = (prefix: string) => ({
    addEventListener(type: string, listener: () => void) {
      const key = prefix + type;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(prefix + type)?.delete(listener);
    },
  });
  const doc = { ...target('doc:'), visibilityState: (hidden ? 'hidden' : 'visible') as DocumentVisibilityState };
  const win = target('win:');
  const fire = (key: string) => { for (const listener of [...(listeners.get(key) ?? [])]) listener(); };
  const count = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  const snapshot = (key: string) => [...(listeners.get(key) ?? [])];
  return { doc, win, fire, count, snapshot };
}

/** A bed over a fake engine, on a fake page, wanting the board's drone. */
function bedOnBoard(scene: DroneInput = WARM) {
  const e = fakeEngine();
  const page = fakePage();
  const bed = new SoundBed(new Sound(e.ctor));
  let paused: (() => void) | undefined;
  bed.attach(page.doc, page.win, (listener) => { paused = listener; return () => { paused = undefined; }; });
  bed.prefer({ on: true, volume: 1 });
  bed.scene(scene);
  return { e, page, bed, pause: () => paused?.() };
}

describe('the bed decides when the house may be heard', () => {
  it('silences a malformed scene without throwing or retaining the former drone (#1986)', () => {
    const setDrone = vi.fn();
    const engine = {
      muted: true, volume: 1, available: true,
      cue: vi.fn(), setDrone, suspend: vi.fn(), wake: vi.fn(), close: vi.fn(),
    };
    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 1 });
    bed.gesture();
    bed.scene(WARM);
    expect(setDrone).toHaveBeenLastCalledWith(WARM);

    // The frame silences audio before score construction. Validation must
    // still reject a hidden unknown Age, not pass it through to Sound.
    const invalidInFrame = { registers: ['future-register'], frame: true } as unknown as DroneInput;
    expect(() => bed.scene(invalidInFrame)).not.toThrow();
    expect(setDrone).toHaveBeenLastCalledWith(null);

    // An invalidated view/adapter can supply a cyclic object or a throwing
    // getter even though the TypeScript seam promises a plain scene.
    const cyclic = { ...WARM, self: undefined as unknown };
    cyclic.self = cyclic;
    expect(() => bed.scene(cyclic)).not.toThrow();
    expect(setDrone).toHaveBeenLastCalledWith(null);

    const invalidated = {
      get registers(): Register[] { throw new Error('view was invalidated'); },
      frame: false,
    };
    expect(() => bed.scene(invalidated)).not.toThrow();
    expect(() => bed.scene(undefined as unknown as DroneInput)).not.toThrow();
    expect(setDrone).toHaveBeenCalledTimes(2); // repeated silence does not restart audio

    // A later valid public view restores the new Age rather than the stale one.
    const recovered: DroneInput = { registers: ['cold'], frame: false };
    bed.scene(recovered);
    expect(setDrone).toHaveBeenLastCalledWith(recovered);
    bed.dispose();
  });

  it('ignores a serializable invalid Age instead of disabling a healthy audio device (#1986)', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    // Unlike a cycle or throwing getter, this scene has a valid JSON key.
    // Previously Sound tried to build its score, assertNever rejected the
    // unknown register, and the audio engine became permanently unavailable.
    const bad = { registers: ['future-register'], frame: false } as unknown as DroneInput;
    expect(() => bed.scene(bad)).not.toThrow();
    expect(bed.audible, 'bad presentation data disabled a working sound engine').toBe(true);

    // The next ordinary Age must recover the drone and accept new cues on
    // the original device, without replaying the malformed scene.
    bed.scene(COLD);
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
    const before = ctx.sources.length;
    bed.cue('seal');
    expect(ctx.sources).toHaveLength(before + cueScore('seal').voices.length);
    expect(e.made).toHaveLength(1);
    bed.dispose();
  });

  it('keeps settings, scene changes and teardown safe when an optional audio adapter throws (#1986)', () => {
    const broken = {
      get available(): boolean { throw new Error('device status unavailable'); },
      get muted(): boolean { throw new Error('mute state unavailable'); },
      set muted(_value: boolean) { throw new Error('mute control unavailable'); },
      get volume(): number { return 1; },
      set volume(_value: number) { throw new Error('volume control unavailable'); },
      cue(): void { throw new Error('cue unavailable'); },
      setDrone(): void { throw new Error('drone unavailable'); },
      suspend(): void { throw new Error('suspend unavailable'); },
      wake(): void { throw new Error('wake unavailable'); },
      close(): void { throw new Error('close unavailable'); },
    };
    const bed = new SoundBed(broken);
    expect(() => {
      bed.prefer({ on: true, volume: 0.4 });
      bed.scene(WARM);
      bed.gesture();
      expect(bed.audible).toBe(false);
      bed.cue('page');
      bed.hide();
      bed.show();
      bed.dispose();
      bed.dispose();
    }).not.toThrow();
    expect(bed.audible).toBe(false);
  });

  it('mutes a previously audible host if its volume adapter refuses a quieter level (#1986)', () => {
    let level = 1;
    let muted = true;
    let rejectVolume = false;
    const cue = vi.fn();
    const engine = {
      available: true,
      get volume() { return level; },
      set volume(value: number) {
        if (rejectVolume) throw new Error('host volume setter unavailable');
        level = value;
      },
      get muted() { return muted; },
      set muted(value: boolean) { muted = value; },
      cue,
      setDrone: vi.fn(),
      suspend: vi.fn(),
      wake: vi.fn(),
      close: vi.fn(),
    };
    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 1 });
    bed.gesture();
    expect(bed.audible).toBe(true);
    expect(engine.muted).toBe(false);

    // The host kept its full-volume output when Reading requested a lower
    // level. The bed must not leave an old drone or new cues at that level.
    rejectVolume = true;
    bed.prefer({ on: true, volume: 0.25 });
    expect(engine.volume).toBe(1);
    expect(engine.muted).toBe(true);
    expect(bed.audible).toBe(false);
    bed.cue('bell');
    expect(cue).not.toHaveBeenCalled();

    // A later successful preference application can restore normal playback.
    rejectVolume = false;
    bed.prefer({ on: true, volume: 0.25 });
    expect(engine.volume).toBe(0.25);
    expect(engine.muted).toBe(false);
    expect(bed.audible).toBe(true);
    bed.cue('bell');
    expect(cue).toHaveBeenCalledExactlyOnceWith('bell');
    bed.dispose();
  });

  it('requests mute when a host mute getter throws but its setter still works (#1986)', () => {
    let level = 1;
    let audibleOutput = false;
    let refuseVolume = false;
    const engine = {
      available: true,
      get muted(): boolean { throw new Error('host mute state unavailable'); },
      set muted(value: boolean) { audibleOutput = !value; },
      get volume() { return level; },
      set volume(value: number) {
        if (refuseVolume) throw new Error('host rejected the new volume');
        level = value;
      },
      cue: vi.fn(),
      setDrone: vi.fn(),
      suspend: vi.fn(),
      wake: vi.fn(),
      close: vi.fn(),
    };
    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 1 });
    bed.gesture();
    expect(audibleOutput).toBe(true);

    refuseVolume = true;
    bed.prefer({ on: true, volume: 0.2 });
    expect(level).toBe(1);
    expect(bed.audible).toBe(false);
    expect(audibleOutput, 'getter rejection skipped the safety mute').toBe(false);
    bed.cue('page');
    expect(engine.cue).not.toHaveBeenCalled();
    bed.dispose();
  });

  it('contains throwing host effects and silences a denied wake (#1986)', () => {
    const engine = {
      muted: true,
      volume: 1,
      available: true,
      cue: vi.fn(() => { throw new Error('cue graph invalidated'); }),
      setDrone: vi.fn(() => { throw new Error('drone graph invalidated'); }),
      suspend: vi.fn(() => { throw new Error('device suspend refused'); }),
      wake: vi.fn(() => { throw new Error('device resume refused'); }),
      close: vi.fn(() => { throw new Error('device close refused'); }),
    };
    const bed = new SoundBed(engine);
    expect(() => {
      bed.prefer({ on: true, volume: 0.5 });
      bed.scene(WARM);
      bed.gesture();
      // A failed native wake cannot authorize later cues, even if the adapter
      // still reports available. Muting/suspending may also refuse safely.
      expect(bed.audible).toBe(false);
      bed.cue('page');
      bed.hide();
      bed.show();
      bed.dispose();
    }).not.toThrow();
    expect(engine.setDrone).toHaveBeenCalledWith(WARM);
    expect(engine.wake).toHaveBeenCalledOnce();
    expect(engine.cue).not.toHaveBeenCalled();
    // One best-effort suspension follows the denied wake, another pagehide.
    expect(engine.suspend).toHaveBeenCalledTimes(2);
    expect(engine.close).toHaveBeenCalledOnce();
    expect(bed.audible).toBe(false);
  });

  it('is silent until the first touch, then hums for the board', () => {
    const { e, page, bed } = bedOnBoard();
    bed.cue('page');
    expect(bed.audible).toBe(false);
    expect(e.made, 'an audio context opened before any gesture').toHaveLength(0);

    page.fire('win:pointerdown');
    expect(bed.audible).toBe(true);
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    const before = ctx.sources.length;
    bed.cue('page');
    expect(ctx.sources).toHaveLength(before + cueScore('page').voices.length);
  });

  it('does not resume a running context on every gesture or cue, but recovers after suspension (#2595)', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    const resumes = () => ctx.calls.filter((call) => call === 'resume').length;
    const initial = resumes();
    expect(initial).toBeGreaterThan(0);

    // One player action can dispatch pointerdown, pointerup and click.
    // Later accepted cues must not add unnecessary host resume requests either.
    for (const gesture of ['pointerup', 'click', 'keydown', 'touchend']) {
      page.fire(`win:${gesture}`);
    }
    bed.cue('page');
    bed.cue('seal');
    expect(resumes(), 'a running context was resumed for every player interaction').toBe(initial);

    page.fire('win:pagehide');
    expect(ctx.state).toBe('suspended');
    page.fire('win:pointerdown'); // some hosts offer no explicit foreground event
    expect(ctx.state).toBe('running');
    expect(resumes(), 'a suspended context did not resume on a new gesture').toBe(initial + 1);

    // iOS can report interrupted instead of suspended; this still needs resume.
    ctx.state = 'interrupted';
    page.fire('win:keydown');
    expect(ctx.state).toBe('running');
    expect(resumes()).toBe(initial + 2);
    bed.dispose();
  });

  it('coalesces in-flight resumes across cues and gestures, then retries after an activation refusal', async () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('seal');
    const ctx = e.made[0]!;
    await settle(); // the initial context creation has finished its own resume
    ctx.state = 'suspended';

    // Real hosts need not change state until their resume promise settles.
    // The old eager fake did, hiding duplicate requests from rapid gestures.
    const pending: { resolve(): void; reject(reason: unknown): void }[] = [];
    ctx.resume = () => {
      ctx.calls.push('resume:pending');
      return new Promise<void>((resolve, reject) => pending.push({
        resolve: () => { ctx.state = 'running'; resolve(); },
        reject,
      }));
    };
    const calls = () => ctx.calls.filter((call) => call === 'resume:pending').length;
    s.cue('page');
    s.wake();
    s.setDrone(WARM);
    s.cue('plain');
    expect(calls(), 'multiple resume requests on one unsettled context').toBe(1);

    // A temporary autoplay-policy refusal must allow a later gesture to try.
    pending[0]!.reject(Object.assign(new Error('activation required'), { name: 'NotAllowedError' }));
    await settle();
    expect(s.available).toBe(true);
    s.wake();
    expect(calls(), 'a settled refusal permanently blocked a retry').toBe(2);
    s.cue('seal');
    expect(calls(), 'a second in-flight resume was duplicated').toBe(2);
    pending[1]!.resolve();
    await settle();
    s.wake();
    expect(calls(), 'a running context requested another resume').toBe(2);
    s.close();
  });

  it('does not let an unresolved resume from a closed context block its replacement', async () => {
    const e = fakeEngine();
    const s = new Sound(e.ctor);
    s.muted = false;
    s.cue('seal');
    const old = e.made[0]!;
    await settle();
    old.state = 'interrupted';
    old.resume = () => {
      old.calls.push('resume:never-settles');
      return new Promise<void>(() => undefined);
    };
    s.wake();
    expect(old.calls).toContain('resume:never-settles');
    s.close();
    s.cue('plain');
    expect(e.made).toHaveLength(2);
    expect(e.made[1]!.calls, 'a stale in-flight resume blocked the fresh audio device').toContain('resume');
    s.close();
  });

  it('obeys the switch in Reading settings, and brings back the drone the screen wants now', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:keydown');
    const ctx = e.made[0]!;
    bed.prefer({ on: false, volume: 1 });
    expect(humming(ctx)).toHaveLength(0);
    const before = ctx.sources.length;
    bed.cue('bell');
    expect(ctx.sources, 'a cue played with sound switched off').toHaveLength(before);

    bed.scene(COLD); // an Age turned while the sound was off
    bed.prefer({ on: true, volume: 0.5 });
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
    expect(ctx.gains[0]!.gain.value).toBe(0.5);
  });

  it('fails closed on malformed persisted sound preferences from native hosts (#1986)', () => {
    const { e, page, bed } = bedOnBoard();
    // Storage bridges can return JSON values that violate their TypeScript seam.
    // None may throw while Start mounts or open a device after the first gesture.
    const malformed: unknown[] = [
      null, undefined, false, 1, 'on', [], {},
      { on: true }, { on: true, volume: '1' },
      { on: true, volume: Number.NaN },
    ];
    for (const value of malformed) {
      expect(() => bed.prefer(value as Parameters<SoundBed['prefer']>[0])).not.toThrow();
      page.fire('win:pointerdown');
      bed.cue('bell');
      expect(bed.audible).toBe(false);
      expect(e.made, 'an invalid preference opened an audio device').toHaveLength(0);
    }

    // A later valid setting can recover the current Age without remounting.
    bed.prefer({ on: true, volume: 0.25 });
    expect(bed.audible).toBe(true);
    expect(e.made).toHaveLength(1);
    expect(heldPitches(e.made[0]!)).toEqual(pitchesOf(WARM));
    expect(e.made[0]!.gains[0]!.gain.value).toBe(0.25);
    bed.dispose();
  });

  it('treats zero volume as mute without opening a silent audio device', () => {
    const { e, page, bed } = bedOnBoard();
    bed.prefer({ on: true, volume: 0 });
    page.fire('win:pointerdown');
    bed.cue('bell');
    expect(bed.audible).toBe(false);
    expect(e.made, 'zero volume opened an audio context').toHaveLength(0);

    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      bed.prefer({ on: true, volume: invalid });
      bed.cue('bell');
      expect(bed.audible, `${invalid} unexpectedly made audio audible`).toBe(false);
      expect(e.made, `${invalid} opened an audio device`).toHaveLength(0);
    }

    // The Age may change while silent; only the latest drone should return.
    bed.scene(COLD);
    bed.prefer({ on: true, volume: 0.35 });
    expect(bed.audible).toBe(true);
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
    expect(ctx.gains[0]!.gain.value).toBe(0.35);

    // Setting the slider to zero again must stop the drone and new cues.
    bed.prefer({ on: true, volume: 0 });
    expect(humming(ctx)).toHaveLength(0);
    const before = ctx.sources.length;
    bed.cue('page');
    expect(ctx.sources).toHaveLength(before);

    bed.prefer({ on: true, volume: 0.7 });
    expect(heldPitches(ctx)).toEqual(pitchesOf(COLD));
    expect(ctx.gains[0]!.gain.value).toBe(0.7);
    expect(e.made).toHaveLength(1);
  });

  it('goes quiet out of sight and comes back to the current scene', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:click');
    const ctx = e.made[0]!;
    page.doc.visibilityState = 'hidden';
    page.fire('doc:visibilitychange');
    expect(humming(ctx)).toHaveLength(0);
    expect(ctx.calls).toContain('suspend');
    const before = ctx.sources.length;
    bed.cue('page');
    expect(ctx.sources).toHaveLength(before);

    bed.scene({ registers: ['institutional'], frame: false });
    page.doc.visibilityState = 'visible';
    page.fire('doc:visibilitychange');
    expect(heldPitches(ctx)).toEqual(pitchesOf({ registers: ['institutional'], frame: false }));
  });

  it('hides on the host\'s pause and on pagehide, and the next touch brings it back', () => {
    const { e, page, bed, pause } = bedOnBoard();
    page.fire('win:pointerup');
    const ctx = e.made[0]!;
    pause();
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    const resumes = ctx.calls.filter((c) => c === 'resume').length;
    page.fire('win:touchend'); // a host that says nothing on return
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    expect(ctx.calls.filter((c) => c === 'resume').length).toBeGreaterThan(resumes);

    page.fire('win:pagehide');
    expect(humming(ctx)).toHaveLength(0);
    page.fire('win:pageshow');
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
  });

  it('ignores pageshow and gestures while the document is still hidden', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    page.doc.visibilityState = 'hidden';
    page.fire('doc:visibilitychange');
    expect(humming(ctx)).toHaveLength(0);
    const before = ctx.sources.length;

    // Browser lifecycle events can race when a tab is restored in the
    // background. Neither event may wake its old drone or sound a new cue.
    page.fire('win:pageshow');
    page.fire('win:keydown');
    bed.gesture();
    bed.cue('bell');
    expect(bed.audible).toBe(false);
    expect(ctx.sources).toHaveLength(before);

    // Native foreground callbacks can race the browser's visibility state.
    // Even an explicit show must not unmute a hidden page or rebuild its drone.
    bed.show();
    expect(bed.audible).toBe(false);
    expect(ctx.sources).toHaveLength(before);

    page.doc.visibilityState = 'visible';
    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
  });

  it('does not treat a bare show() as a pageshow after pagehide (#1986)', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    page.fire('win:pagehide');
    expect(bed.audible).toBe(false);
    const before = ctx.sources.length;

    // The document still reports visible while the page is leaving. A host
    // callback invoking show() is not evidence of an actual foreground return.
    bed.show();
    expect(bed.audible).toBe(false);
    expect(ctx.sources).toHaveLength(before);

    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
  });

  it('a duplicate visible event does not override a native pause (#2951)', () => {
    const { e, page, bed, pause } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    pause();
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);

    // Some webviews remain "visible" throughout a native background pause.
    // A redundant visibilitychange cannot stand in for a foreground event.
    page.fire('doc:visibilitychange');
    expect(bed.audible, 'duplicate visible event revived native-paused audio').toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
  });

  it('a new visible document does not bypass an unresolved native pause (#2952)', () => {
    const { e, page: oldPage, bed, pause } = bedOnBoard();
    oldPage.fire('win:pointerdown');
    const ctx = e.made[0]!;
    pause();
    expect(humming(ctx)).toHaveLength(0);

    // A native webview can replace its document without a corresponding
    // foreground notification. Unlike plain pagehide (#2924), native pause
    // must survive even when the replacement document is already visible.
    const replacement = fakePage();
    bed.attach(replacement.doc, replacement.win);
    expect(oldPage.count()).toBe(0);
    expect(bed.audible, 'document replacement revived native-paused audio').toBe(false);
    replacement.fire('doc:visibilitychange'); // redundant visible signal
    expect(bed.audible).toBe(false);
    const before = ctx.sources.length;
    bed.cue('bell');
    expect(ctx.sources).toHaveLength(before);

    replacement.fire('win:pointerdown'); // actual player return
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
    expect(replacement.count()).toBe(0);
  });

  it('samples live visibility for gestures when webview events go missing (#2953)', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;

    // Visibility silently changed: a queued event must not play in a hidden
    // tab merely because no visibilitychange event arrived.
    page.doc.visibilityState = 'hidden';
    page.fire('win:click');
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    const before = ctx.sources.length;
    bed.cue('page');
    expect(ctx.sources).toHaveLength(before);

    // A fresh real gesture also recovers the live visible document without
    // requiring the webview to dispatch a missed pageshow.
    page.doc.visibilityState = 'visible';
    page.fire('win:click');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();

    const faultyPage = fakePage();
    Object.defineProperty(faultyPage.doc, 'visibilityState', {
      get() { throw new Error('visibility inaccessible'); },
    });
    const silent = new SoundBed(new Sound(e.ctor));
    silent.attach(faultyPage.doc, faultyPage.win);
    silent.prefer({ on: true, volume: 1 });
    silent.scene(WARM);
    expect(() => faultyPage.fire('win:click')).not.toThrow();
    expect(silent.audible, 'throwing visibility getter unlocked audio').toBe(false);
    expect(e.made, 'throwing visibility getter opened a second audio device').toHaveLength(1);
    silent.dispose();
  });

  it('lets the frame kill the drone, and closing it restores the Ages', () => {
    const { e, page, bed } = bedOnBoard();
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    bed.scene(droneFor({ board: true, frame: true, registers: ['warm'] }));
    expect(humming(ctx)).toHaveLength(0);
    bed.scene(droneFor({ board: true, frame: false, registers: ['warm', 'cold'] }));
    expect(heldPitches(ctx)).toEqual(pitchesOf({ registers: ['warm', 'cold'], frame: false }));
    bed.scene(droneFor({ board: false, frame: false, registers: ['warm'] }));
    expect(humming(ctx), 'the front door hummed').toHaveLength(0);
  });

  it('keeps prerendered and unknown-visibility documents silent until explicitly visible', () => {
    const e = fakeEngine();
    const page = fakePage();
    // Hosts can expose a prerender/extension visibility value even when the
    // usual DOM typing only advertises 'hidden' and 'visible'.
    page.doc.visibilityState = 'prerender' as DocumentVisibilityState;
    const bed = new SoundBed(new Sound(e.ctor));
    bed.attach(page.doc, page.win);
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    page.fire('win:pointerdown');
    bed.gesture();
    expect(bed.audible, 'a prerendered page unlocked the sound bed').toBe(false);
    expect(e.made, 'a prerendered page created an audio context').toHaveLength(0);

    page.doc.visibilityState = 'visible';
    page.fire('doc:visibilitychange');
    expect(bed.audible, 'a gesture from prerender must not count').toBe(false);
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    page.doc.visibilityState = 'prerender' as DocumentVisibilityState;
    page.fire('doc:visibilitychange');
    const before = ctx.sources.length;
    page.fire('win:pageshow');
    page.fire('win:click');
    bed.cue('bell');
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    expect(ctx.sources, 'a non-visible page scheduled more sound').toHaveLength(before);

    page.doc.visibilityState = 'visible';
    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
    expect(page.count()).toBe(0);
  });

  it('starts hidden on a hidden page, and lets go of every listener and the engine', () => {
    const e = fakeEngine();
    const page = fakePage(true);
    const bed = new SoundBed(new Sound(e.ctor));
    bed.attach(page.doc, page.win);
    bed.attach(page.doc, page.win); // twice is still once
    const attached = page.count();
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    bed.gesture(); // a hidden document must not accept even a direct wake
    expect(attached).toBeGreaterThan(0);
    expect(bed.audible).toBe(false);
    expect(e.made).toHaveLength(0);
    page.doc.visibilityState = 'visible';
    page.fire('doc:visibilitychange');
    expect(bed.audible).toBe(false); // the hidden gesture did not unlock audio
    page.fire('win:keydown');
    expect(bed.audible).toBe(true);
    bed.dispose();
    expect(page.count()).toBe(0);
    expect(e.made[0]!.calls).toContain('close');
  });

  it('restores unlocked sound when reattached to an already-visible document', () => {
    const e = fakeEngine();
    const oldPage = fakePage();
    const newPage = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    bed.attach(oldPage.doc, oldPage.win);
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    oldPage.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    oldPage.doc.visibilityState = 'hidden';
    oldPage.fire('doc:visibilitychange');
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);

    // The replacement page was visible before the new listeners were added.
    // It will not emit a visibilitychange or pageshow just for our attach().
    bed.attach(newPage.doc, newPage.win);
    expect(oldPage.count(), 'listeners leaked on the old page').toBe(0);
    expect(bed.audible, 'an already visible new document remained muted').toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    newPage.doc.visibilityState = 'hidden';
    newPage.fire('doc:visibilitychange');
    const pausedPage = fakePage();
    bed.attach(pausedPage.doc, pausedPage.win, (pause) => {
      pause(); // The host refuses foreground playback during registration.
      return () => undefined;
    });
    expect(bed.audible, 'document visibility overrode the native pause').toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    pausedPage.fire('win:pointerdown');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    bed.dispose();
    expect(newPage.count()).toBe(0);
    expect(pausedPage.count()).toBe(0);
  });

  it('restores an unlocked Age after pagehide reattaches to an already-visible page (#2924)', () => {
    const { e, page: oldPage, bed } = bedOnBoard();
    oldPage.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    // A pagehide can arrive before visibilityState changes. The replacement
    // may already be visible before attaching and emit no pageshow event.
    oldPage.fire('win:pagehide');
    expect(oldPage.doc.visibilityState).toBe('visible');
    expect(bed.audible).toBe(false);
    expect(humming(ctx)).toHaveLength(0);

    // Re-subscribing on that *same* still-visible page is not a return.
    bed.attach(oldPage.doc, oldPage.win);
    expect(bed.audible, 'same-page reattachment unmuted a background page').toBe(false);
    expect(humming(ctx)).toHaveLength(0);

    const replacement = fakePage();
    bed.attach(replacement.doc, replacement.win);
    expect(oldPage.count(), 'replacing the page leaked old listeners').toBe(0);
    expect(bed.audible, 'a visible replacement stayed pagehide-muted').toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    expect(e.made, 'restoring on attachment opened a second audio device').toHaveLength(1);
    bed.dispose();
    expect(replacement.count()).toBe(0);
  });

  it('lets a synchronous native pause veto pagehide replacement recovery (#2924)', () => {
    const { e, page: oldPage, bed } = bedOnBoard();
    oldPage.fire('win:pointerdown');
    const ctx = e.made[0]!;
    oldPage.fire('win:pagehide');

    const replacement = fakePage();
    bed.attach(replacement.doc, replacement.win, (pause) => {
      pause(); // The new host is not in the foreground yet.
      return () => undefined;
    });
    expect(bed.audible, 'page replacement overrode a native pause').toBe(false);
    expect(humming(ctx)).toHaveLength(0);

    // A later replacement is not a foreground notification either.
    const nextPage = fakePage();
    bed.attach(nextPage.doc, nextPage.win);
    expect(bed.audible, 'a stale pagehide flag overrode the native pause').toBe(false);
    expect(humming(ctx)).toHaveLength(0);
    nextPage.fire('win:pointerdown'); // Host with no resume hook: gesture fallback.
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
    expect(oldPage.count()).toBe(0);
    expect(replacement.count()).toBe(0);
    expect(nextPage.count()).toBe(0);
  });

  it('honours a native pause delivered synchronously while registering listeners (#1986)', () => {
    const e = fakeEngine();
    const page = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    bed.attach(page.doc, page.win);
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    // A native host may call its pause listener immediately during subscribe
    // while document.visibilityState still says "visible". Initial listener
    // setup is not evidence that the host has foregrounded the app.
    bed.attach(page.doc, page.win, (pause) => {
      pause();
      return () => undefined;
    });
    expect(bed.audible, 'the initial visible sample undid the native pause').toBe(false);
    expect(humming(ctx), 'the paused host resumed its drone').toHaveLength(0);
    expect(ctx.calls).toContain('suspend');
    const before = ctx.sources.length;
    bed.cue('bell');
    expect(ctx.sources, 'a cue played after a native pause').toHaveLength(before);

    // With no native resume callback, a new actual gesture is the fallback
    // for returning to a host whose document never changed visibility.
    page.fire('win:pointerdown');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    bed.dispose();
    expect(page.count()).toBe(0);
  });

  it('keeps browser audio and cleanup working when a host pause hook refuses registration', () => {
    const e = fakeEngine();
    const page = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    expect(() => bed.attach(page.doc, page.win, () => {
      throw new Error('native pause hook is unavailable');
    })).not.toThrow();
    expect(page.count(), 'host refusal prevented browser listeners').toBeGreaterThan(0);

    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    page.doc.visibilityState = 'hidden';
    page.fire('doc:visibilitychange');
    expect(humming(ctx)).toHaveLength(0);
    bed.dispose();
    expect(page.count(), 'host refusal leaked browser listeners').toBe(0);
  });

  it('keeps working when an embedded WebView refuses individual DOM listeners', () => {
    const e = fakeEngine();
    const page = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    const doc = {
      get visibilityState() { return page.doc.visibilityState; },
      addEventListener(type: string, listener: () => void) {
        if (type === 'visibilitychange') throw new Error('visibility hook not supported');
        page.doc.addEventListener(type, listener);
      },
      removeEventListener(type: string, listener: () => void) {
        page.doc.removeEventListener(type, listener);
      },
    };
    const win = {
      addEventListener(type: string, listener: () => void) {
        if (type === 'pointerdown') throw new Error('pointer hook not supported');
        page.win.addEventListener(type, listener);
      },
      removeEventListener(type: string, listener: () => void) {
        page.win.removeEventListener(type, listener);
        if (type === 'touchend') throw new Error('host refuses removal');
      },
    };
    expect(() => bed.attach(doc, win)).not.toThrow();
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    page.fire('win:click');
    expect(bed.audible, 'a surviving gesture should still unlock sound').toBe(true);
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    page.fire('win:pagehide');
    expect(bed.audible).toBe(false);
    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(() => bed.dispose()).not.toThrow();
    expect(page.count(), 'a failed unsubscribe prevented cleanup of later listeners').toBe(0);
    expect(ctx.calls).toContain('close');
  });

  it('closes audio and removes browser listeners when host pause unsubscribe throws', () => {
    const e = fakeEngine();
    const page = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    bed.attach(page.doc, page.win, () => () => {
      throw new Error('native unsubscribe refused');
    });
    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    page.fire('win:pointerdown');
    const ctx = e.made[0]!;
    expect(ctx).toBeDefined();
    expect(() => bed.dispose()).not.toThrow();
    expect(page.count(), 'unsubscriber prevented browser listener cleanup').toBe(0);
    expect(ctx.calls, 'unsubscriber prevented audio context close').toContain('close');
  });

  it('ignores queued browser and host callbacks from a replaced attachment (#1986)', () => {
    const e = fakeEngine();
    const page = fakePage();
    const bed = new SoundBed(new Sound(e.ctor));
    let stalePause: () => void = () => undefined;
    bed.attach(page.doc, page.win, (listener) => {
      stalePause = listener;
      return () => undefined; // Unsubscribing cannot cancel a queued callback.
    });
    const staleGesture = page.snapshot('win:pointerdown')[0]!;
    const staleVisibility = page.snapshot('doc:visibilitychange')[0]!;
    const stalePagehide = page.snapshot('win:pagehide')[0]!;
    const stalePageshow = page.snapshot('win:pageshow')[0]!;

    bed.prefer({ on: true, volume: 1 });
    bed.scene(WARM);
    bed.attach(page.doc, page.win); // replaces the first attachment

    staleGesture(); // must not unlock the new attachment
    expect(bed.audible).toBe(false);
    expect(e.made).toHaveLength(0);

    page.fire('win:pointerdown'); // only the current attachment may unlock
    const ctx = e.made[0]!;
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
    stalePause();
    stalePagehide();
    staleVisibility();
    stalePageshow();
    expect(bed.audible, 'an obsolete callback muted the active page').toBe(true);
    expect(ctx.calls, 'an obsolete callback suspended the active device')
      .not.toContain('suspend');
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));

    // A stale native callback must not leave a hidden hostPaused flag behind.
    // An ordinary hide/show of the current attachment must still recover.
    bed.hide();
    expect(bed.audible).toBe(false);
    bed.show();
    expect(bed.audible, 'stale native pause prevented the active attachment resuming').toBe(true);

    page.fire('win:pagehide'); // the current attachment must still work
    expect(bed.audible).toBe(false);
    expect(ctx.calls).toContain('suspend');
    bed.dispose();
    expect(page.count()).toBe(0);
  });

  it('asks for an ambient session, and leaves a host\'s own choice alone', () => {
    const page = fakePage();
    const auto = { audioSession: { type: 'auto' } };
    new SoundBed(new Sound(null)).attach(page.doc, page.win, undefined, auto);
    expect(auto.audioSession.type).toBe('ambient');
    const chosen = { audioSession: { type: 'playback' } };
    new SoundBed(new Sound(null)).attach(page.doc, page.win, undefined, chosen);
    expect(chosen.audioSession.type).toBe('playback');
  });

  it('restores temporary ambient policy on detach and disposal, including replacement (#3128)', () => {
    const page = fakePage();
    const nav = { audioSession: { type: 'auto' } };
    const bed = new SoundBed(new Sound(null));

    const previous = bed.attach(page.doc, page.win, undefined, nav);
    expect(nav.audioSession.type).toBe('ambient');

    const current = bed.attach(page.doc, page.win, undefined, nav);
    expect(nav.audioSession.type).toBe('ambient');
    previous(); // A stale cleanup must not reset the active attachment.
    expect(nav.audioSession.type).toBe('ambient');

    current();
    expect(nav.audioSession.type).toBe('auto');
    expect(page.count()).toBe(0);

    bed.attach(page.doc, page.win, undefined, nav);
    expect(nav.audioSession.type).toBe('ambient');
    bed.dispose();
    expect(nav.audioSession.type).toBe('auto');
    expect(page.count()).toBe(0);
  });

  it('does not replace a host-selected Audio Session mode during teardown (#3128)', () => {
    const page = fakePage();
    const nav = { audioSession: { type: 'auto' } };
    const bed = new SoundBed(new Sound(null));
    const detach = bed.attach(page.doc, page.win, undefined, nav);
    expect(nav.audioSession.type).toBe('ambient');

    nav.audioSession.type = 'playback';
    expect(() => detach()).not.toThrow();
    expect(nav.audioSession.type).toBe('playback');
    expect(page.count()).toBe(0);
    bed.dispose();
  });

  it('still releases its listeners if the Audio Session policy refuses restoration (#3128)', () => {
    const page = fakePage();
    let currentMode = 'auto';
    let denyRestoration = false;
    const nav = { audioSession: {
      get type() {
        if (denyRestoration) throw new Error('audio session detached');
        return currentMode;
      },
      set type(mode: string) { currentMode = mode; },
    } };
    const bed = new SoundBed(new Sound(null));
    const detach = bed.attach(page.doc, page.win, undefined, nav);
    expect(currentMode).toBe('ambient');

    denyRestoration = true;
    expect(() => detach()).not.toThrow();
    expect(page.count()).toBe(0);
    expect(() => bed.dispose()).not.toThrow();
  });

  it('keeps the game usable when optional Audio Session policy cannot be read or set', () => {
    const forbidden = [
      { audioSession: {
        get type() { return 'auto'; },
        set type(_mode: string) { throw new TypeError('ambient is read-only on this host'); },
      } },
      { get audioSession(): never { throw new Error('audio policy API unavailable'); } },
    ];
    for (const nav of forbidden) {
      const page = fakePage();
      const bed = new SoundBed(new Sound(null));
      expect(() => bed.attach(page.doc, page.win, undefined, nav)).not.toThrow();
      expect(page.count(), 'audio-policy refusal prevented game listeners').toBeGreaterThan(0);
      bed.dispose();
      expect(page.count(), 'audio-policy refusal leaked listeners').toBe(0);
    }
  });

  it('treats no engine at all as silence', () => {
    const bed = new SoundBed(new Sound(null));
    expect(() => {
      bed.prefer({ on: true, volume: 1 });
      bed.scene(WARM);
      bed.gesture();
      bed.cue('bell');
      bed.dispose();
    }).not.toThrow();
    expect(bed.audible).toBe(false);
  });

  it('reads the running Ages off the view, oldest first, and no others', () => {
    expect(runningRegisters([
      { register: 'cold', ended: 1100 },
      { register: 'warm' },
      { register: 'institutional' },
    ])).toEqual(['warm', 'institutional']);
    expect(runningRegisters([])).toEqual([]);
  });
});

// ── A played session: the right cue at each committed moment ────────────

function memoryPlatform(): Platform & { saves: Map<string, unknown> } {
  const saves = new Map<string, unknown>();
  let library: unknown | null = null;
  return {
    saves,
    listSaves: async () => [],
    readSave: async (slot) => saves.get(slot) ?? null,
    writeSave: async (slot, save) => { saves.set(slot, structuredClone(save)); },
    deleteSave: async (slot) => { saves.delete(slot); },
    readLibrary: async () => library,
    writeLibrary: async (next) => { library = next; },
    readUserContent: async () => ({}),
    exportSave: async () => undefined, importSave: async () => null,
    onPause: () => () => undefined, onBack: () => () => undefined,
  };
}

const bundle = loadBundle();

/**
 * Play `years` of a Short Line the way a reader does — one decision at a time,
 * answering choices, cards and Record blocks themselves — and hand every
 * verb's cues to `check` as they happen.
 */
function playSession(
  game: ReturnType<typeof createGame>,
  actions: GameActions,
  heard: Cue[],
  years: number,
  check: (verb: string, cues: Cue[], before: { year?: number; docket: number }) => void = () => undefined,
) {
  const end = game.view.value!.year + years;
  for (let guard = 0; guard < 4000 && !game.ended.value && game.view.value!.year < end; guard++) {
    const before = { year: game.view.value?.year, docket: game.docket.value.length };
    const from = heard.length;
    let verb = '';
    if (game.outcome.value) { actions.dismissOutcome(); continue; }
    if (game.interlude.value) { actions.dismissInterlude(); continue; }
    if (game.chapter.value) { actions.dismissChapter(); continue; }
    const d = game.docket.value[0];
    if (!d) {
      if (game.view.value?.namesWanted.length) { actions.keepSuggestedNames(); continue; }
      verb = 'advance';
      actions.advance(1);
    } else if (d.kind === 'record') {
      verb = 'record';
      actions.record(d.id, 'record', 'Write it as it happened');
    } else if (d.kind === 'match') {
      const card = d.cards.find((c) => c.available);
      verb = card ? 'match' : 'declineHand';
      if (card) actions.match(d.id, card.id, card.name);
      else actions.declineHand(d.id);
    } else {
      const open = d.choicesAreOpen && !d.cast.some((r) => !r.optional) ? d.choices.find((c) => c.available) : undefined;
      verb = open ? 'choose' : 'letHimDecide';
      if (open) actions.choose(d.id, open.id, {}, open.label);
      else actions.letHimDecide();
    }
    check(verb, heard.slice(from), before);
  }
}

describe('a played session hears the committed moments, and only those', () => {
  it('keeps committed verbs and subsequent cues when an optional audio sink throws (#1986)', () => {
    const game = createGame(bundle, memoryPlatform());
    let year = 1042;
    let pending = 0;
    let chose = false;
    const attempted: Cue[] = [];
    const wrapped = soundActions({
      ...game.actions,
      advance: () => { year++; pending++; },
      choose: () => {
        chose = true;
        return true;
      },
    } as GameActions, {
      cue: (cue) => {
        attempted.push(cue);
        throw new Error('AudioContext output disappeared');
      },
    }, {
      year: () => year,
      docket: () => pending,
      outcome: () => chose ? { kind: 'choice', valence: 'boon' } as Outcome : null,
    });

    // The wrapped simulation actions must finish even if each sound fails.
    expect(() => wrapped.advance(1)).not.toThrow();
    expect(year).toBe(1043);
    expect(pending).toBe(1);
    expect(attempted).toEqual(['page', 'bell']);

    game.actions.begin(1986, 'short');
    const signing = game.prologue.value!;
    expect(wrapped.found({
      houseName: 'House Audible',
      heirloom: signing.heirlooms[0]!.heirloom,
      grudge: signing.grudges[0]!.house,
    }).ok).toBe(true);
    expect(attempted).toEqual(['page', 'bell', 'seal']);
  });

  it('commits turns when optional year or docket reads fail before or after the action (#1986)', () => {
    const game = createGame(bundle, memoryPlatform());
    let year = 1042;
    let docket = 0;
    let yearReads = 0;
    let docketReads = 0;
    let failYearAt: number | null = 1;
    let failDocketAt: number | null = 2;
    const heard: Cue[] = [];
    const actions = soundActions({
      ...game.actions,
      advance: () => { year++; docket++; },
    } as GameActions, { cue: (cue) => heard.push(cue) }, {
      year: () => {
        if (++yearReads === failYearAt) throw new Error('year observer unavailable');
        return year;
      },
      docket: () => {
        if (++docketReads === failDocketAt) throw new Error('docket observer unavailable');
        return docket;
      },
      outcome: () => null,
    });

    // The before-year and after-docket snapshots fail independently.
    expect(() => actions.advance(1)).not.toThrow();
    expect(year).toBe(1043);
    expect(docket).toBe(1);
    expect(heard).toEqual([]);

    // Reverse the failures: neither missing snapshot may fabricate a cue.
    yearReads = docketReads = 0;
    failYearAt = 2;
    failDocketAt = 1;
    expect(() => actions.advance(1)).not.toThrow();
    expect(year).toBe(1044);
    expect(docket).toBe(2);
    expect(heard).toEqual([]);

    // An observer working again must not be permanently silenced.
    yearReads = docketReads = 0;
    failYearAt = failDocketAt = null;
    expect(() => actions.advance(1)).not.toThrow();
    expect(year).toBe(1045);
    expect(docket).toBe(3);
    expect(heard).toEqual(['page', 'bell']);
  });

  it('preserves committed answers when an optional outcome observation fails (#1986)', () => {
    const game = createGame(bundle, memoryPlatform());
    let outcome: Outcome | null = null;
    let outcomeReads = 0;
    let failAt: number | null = 1;
    let accepted = 0;
    let rejectAction = false;
    const heard: Cue[] = [];
    const actions = soundActions({
      ...game.actions,
      choose: () => {
        if (rejectAction) throw new Error('game action rejected');
        accepted++;
        outcome = { kind: 'choice', valence: 'boon', said: 'Answer', text: 'A boon.' };
        return true;
      },
    } as GameActions, { cue: (cue) => heard.push(cue) }, {
      year: () => 1042,
      docket: () => 0,
      outcome: () => {
        if (++outcomeReads === failAt) throw new Error('outcome observer unavailable');
        return outcome;
      },
    });

    expect(() => actions.choose('event', 'answer', {}, 'answer')).not.toThrow();
    expect(accepted).toBe(1);
    expect(heard).toEqual([]);

    outcomeReads = 0;
    failAt = 2;
    expect(() => actions.choose('event', 'answer', {}, 'answer')).not.toThrow();
    expect(accepted).toBe(2);
    expect(heard).toEqual([]);

    outcomeReads = 0;
    failAt = null;
    expect(actions.choose('event', 'answer', {}, 'answer')).toBe(true);
    expect(accepted).toBe(3);
    expect(heard).toEqual(['boon']);

    // Genuine simulation errors are not sound errors and still propagate.
    rejectAction = true;
    expect(() => actions.choose('event', 'answer', {}, 'answer')).toThrow('game action rejected');
    expect(accepted).toBe(3);
  });

  it('pages, bells and seals where §24 puts them, and chimes each choice by its valence', () => {
    const game = createGame(bundle, memoryPlatform());
    const heard: Cue[] = [];
    const actions = soundActions(game.actions, { cue: (cue) => heard.push(cue) }, {
      year: () => game.view.value?.year,
      docket: () => game.docket.value.length,
      outcome: () => game.outcome.value,
    });

    actions.begin(1986, 'short');
    expect(actions.found({ houseName: 'House Ear', heirloom: 'not_a_real_heirloom', grudge: 'house_marrow' }).ok).toBe(false);
    expect(heard, 'a refused signing was sealed').toEqual([]);
    const signing = game.prologue.value!;
    expect(actions.found({ houseName: 'House Ear', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house }).ok).toBe(true);
    expect(heard).toEqual(['seal']);
    actions.enter();
    heard.length = 0;

    const tally: Record<string, number> = {};
    playSession(game, actions, heard, 60, (verb, cues, before) => {
      const outcome = game.outcome.value;
      if (verb === 'advance') {
        const wanted: Cue[] = [];
        if (game.view.value!.year !== before.year) wanted.push('page');
        if (game.docket.value.length > before.docket) wanted.push('bell');
        expect(cues, `turning from ${before.year}`).toEqual(wanted);
      } else if (verb === 'choose' || verb === 'match' || verb === 'record') {
        expect(outcome, `${verb} was not accepted`).not.toBeNull();
        expect(cues, verb).toEqual([outcomeCue(outcome!)]);
        if (verb === 'choose') expect(['boon', 'blow', 'plain']).toContain(outcome!.valence);
        else expect(outcome!.valence, `${verb} carries a valence`).toBeUndefined();
      } else {
        expect(cues, `${verb} made a sound`).toEqual([]);
      }
      for (const cue of cues) tally[cue] = (tally[cue] ?? 0) + 1;
      tally[verb] = (tally[verb] ?? 0) + 1;
    });

    expect(tally.page, 'sixty years turned without a page').toBeGreaterThan(0);
    expect(tally.bell, 'sixty years and the docket never rang').toBeGreaterThan(0);
    expect(tally.choose, 'sixty years and no choice was taken').toBeGreaterThan(0);
  });

  it('plays nothing on resume, then pages on the first turn', async () => {
    const platform = memoryPlatform();
    const first = createGame(bundle, platform);
    first.actions.begin(1987, 'short');
    if (first.prologue.value) first.actions.enter();
    playSession(first, first.actions, [], 12);
    await settle();

    const second = createGame(bundle, platform);
    await settle();
    const heard: Cue[] = [];
    const actions = soundActions(second.actions, { cue: (cue) => heard.push(cue) }, {
      year: () => second.view.value?.year,
      docket: () => second.docket.value.length,
      outcome: () => second.outcome.value,
    });
    expect(await actions.resume()).toBe(true);
    expect(heard, 'a resumed save made a sound').toEqual([]);
    if (second.docket.value.length) actions.letHimDecide();
    while (second.view.value?.namesWanted.length) actions.keepSuggestedNames();
    actions.advance(1);
    expect(heard[0]).toBe('page');
  });

  /** The same commands, once silent and once through a live bed over a fake engine. */
  async function savedAfter(loud: boolean) {
    const platform = memoryPlatform();
    const game = createGame(bundle, platform);
    const e = fakeEngine();
    const bed = new SoundBed(new Sound(loud ? e.ctor : null));
    bed.prefer({ on: loud, volume: 1 });
    if (loud) bed.gesture();
    const actions = soundActions(game.actions, bed, {
      year: () => game.view.value?.year,
      docket: () => game.docket.value.length,
      outcome: () => game.outcome.value,
    });
    actions.begin(1945, 'short');
    if (game.prologue.value) actions.enter();
    playSession(game, actions, [], 40, () => {
      const view = game.view.value;
      if (view) bed.scene(droneFor({ board: true, frame: game.interlude.value !== null, registers: runningRegisters(view.ages) }));
    });
    await settle();
    const save = platform.saves.get('autosave') as Record<string, unknown> | undefined;
    expect(save, 'the run autosaved').toBeDefined();
    return { save: canonical({ ...save, savedAt: '' }), played: e.made[0]?.sources.length ?? 0 };
  }

  // The save carries the RNG state and the command log, so one identical
  // canonical save is all three — and an identical log replays identically.
  it('saves the same bytes with the sound on and off', async () => {
    const silent = await savedAfter(false);
    const loud = await savedAfter(true);
    expect(loud.played, 'the loud run never reached the engine').toBeGreaterThan(0);
    expect(loud.save).toBe(silent.save);
  });
});
