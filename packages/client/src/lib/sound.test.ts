import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { canonical } from '@ed/core';
import { RegisterS, type Register } from '@ed/schema';
import type { Platform } from '../platform.js';
import { createGame, type GameActions } from './game.js';
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

  it('stays under the peak however many Ages are running', () => {
    const many: Register[] = ['warm', 'cold', 'institutional', 'cold', 'warm'];
    expect(peakOf(droneScore({ registers: many, frame: false })!)).toBeLessThanOrEqual(PEAK);
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
  started: number | undefined;
  stopped: number | undefined;
  frequency = param();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect<T>(node: T) { return node; }
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
function fakeEngine(options: { refuse?: boolean; reject?: boolean } = {}) {
  const made: FakeContext[] = [];
  class FakeContext {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 100;
    destination = {};
    sources: FakeSource[] = [];
    gains: { gain: ReturnType<typeof param> }[] = [];
    calls: string[] = [];
    constructor() {
      if (options.refuse) throw new Error('NotSupportedError: no audio device');
      made.push(this);
    }
    createGain() {
      const node = { gain: param(1), connect: <T>(to: T) => to };
      this.gains.push(node);
      return node;
    }
    createOscillator() { return this.source(); }
    createBufferSource() { return this.source(); }
    createBuffer(_channels: number, frames: number) {
      const data = new Float32Array(frames);
      return { getChannelData: () => data };
    }
    createBiquadFilter() { return { type: '', frequency: param(), Q: param(), connect: <T>(to: T) => to }; }
    resume() { return this.settle('resume', 'running'); }
    suspend() { return this.settle('suspend', 'suspended'); }
    close() { return this.settle('close', 'closed'); }
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
    s.volume = Number.NaN;
    expect(out.gain.value).toBe(1);
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

  it('turns a device that will not open into silence, not an exception', () => {
    const e = fakeEngine({ refuse: true });
    const s = new Sound(e.ctor);
    s.muted = false;
    expect(() => s.cue('bell')).not.toThrow();
    expect(() => s.setDrone(WARM)).not.toThrow();
    expect(() => { s.wake(); s.suspend(); s.close(); }).not.toThrow();
    expect(s.available).toBe(false);
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
  return { doc, win, fire, count };
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

  it('treats zero volume as mute without opening a silent audio device', () => {
    const { e, page, bed } = bedOnBoard();
    bed.prefer({ on: true, volume: 0 });
    page.fire('win:pointerdown');
    bed.cue('bell');
    expect(bed.audible).toBe(false);
    expect(e.made, 'zero volume opened an audio context').toHaveLength(0);

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

    page.doc.visibilityState = 'visible';
    page.fire('win:pageshow');
    expect(bed.audible).toBe(true);
    expect(heldPitches(ctx)).toEqual(pitchesOf(WARM));
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

  it('asks for an ambient session, and leaves a host\'s own choice alone', () => {
    const page = fakePage();
    const auto = { audioSession: { type: 'auto' } };
    new SoundBed(new Sound(null)).attach(page.doc, page.win, undefined, auto);
    expect(auto.audioSession.type).toBe('ambient');
    const chosen = { audioSession: { type: 'playback' } };
    new SoundBed(new Sound(null)).attach(page.doc, page.win, undefined, chosen);
    expect(chosen.audioSession.type).toBe('playback');
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
