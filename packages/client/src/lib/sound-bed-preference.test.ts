import { describe, expect, it, vi } from 'vitest';
import { SoundBed, type SoundEngine } from './sound-bed';

function fakeSound(): SoundEngine {
  return {
    muted: true,
    volume: 1,
    available: true,
    cue: vi.fn(),
    setDrone: vi.fn(),
    suspend: vi.fn(),
    wake: vi.fn(),
    close: vi.fn(),
  };
}

describe('sound enablement is fail-closed at the runtime boundary (#2221)', () => {
  it.each([
    ['false boolean', false],
    ['false text', 'false'],
    ['true text', 'true'],
    ['numeric truthy', 1],
    ['array', []],
    ['object', {}],
    ['null', null],
  ])('rejects a %s flag without unmuting or playing a cue', (_label, invalid) => {
    const engine = fakeSound();
    const bed = new SoundBed(engine);
    bed.prefer({ on: invalid as boolean, volume: 1 });
    bed.gesture();
    bed.cue('bell');

    expect(bed.audible).toBe(false);
    expect(engine.muted).toBe(true);
    expect(engine.wake).not.toHaveBeenCalled();
    expect(engine.cue).not.toHaveBeenCalled();
    bed.dispose();
  });

  it('allows a previously unlocked player to re-enable sound with literal true', () => {
    const engine = fakeSound();
    const bed = new SoundBed(engine);
    bed.prefer({ on: 'true' as unknown as boolean, volume: 1 });
    bed.gesture();
    expect(bed.audible).toBe(false);

    bed.prefer({ on: true, volume: 0.4 });
    expect(bed.audible).toBe(true);
    expect(engine.muted).toBe(false);
    expect(engine.volume).toBe(0.4);
    bed.cue('seal');
    expect(engine.cue).toHaveBeenCalledTimes(1);
    expect(engine.cue).toHaveBeenCalledWith('seal');
    bed.dispose();
  });

  it.each(['on', 'volume'] as const)(
    'mutes an unlocked bed when a host %s getter throws (#1986)',
    (property) => {
      const engine = fakeSound();
      const bed = new SoundBed(engine);
      bed.prefer({ on: true, volume: 1 });
      bed.gesture();
      bed.cue('bell');
      expect(engine.cue).toHaveBeenCalledTimes(1);

      const hostile = { on: true, volume: 0.25 };
      Object.defineProperty(hostile, property, {
        get() { throw new Error('host preference unavailable'); },
      });
      expect(() => bed.prefer(hostile)).not.toThrow();
      expect(bed.audible).toBe(false);
      expect(engine.muted).toBe(true);
      expect(engine.volume).toBe(0);
      bed.cue('seal');
      expect(engine.cue).toHaveBeenCalledTimes(1);

      // A subsequent valid preference can recover without remounting.
      bed.prefer({ on: true, volume: 0.3 });
      expect(bed.audible).toBe(true);
      bed.cue('seal');
      expect(engine.cue).toHaveBeenCalledTimes(2);
      bed.dispose();
    },
  );

  it.each([
    ['false boolean', false],
    ['false text', 'false'],
    ['true text', 'true'],
    ['numeric truthy', 1],
    ['object', {}],
    ['null', null],
    ['undefined', undefined],
  ])('rejects a %s engine availability value until literal true is restored', (_label, invalid) => {
    const engine = fakeSound();
    let reported: unknown = invalid;
    // An optional native adapter may return malformed runtime data despite
    // its declared boolean property. Do not trust JavaScript truthiness.
    Object.defineProperty(engine, 'available', {
      configurable: true,
      get: () => reported,
    });
    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    bed.cue('bell');

    expect(bed.audible).toBe(false);
    expect(engine.muted).toBe(true);
    expect(engine.wake).not.toHaveBeenCalled();
    expect(engine.cue).not.toHaveBeenCalled();

    // A healthy adapter can recover on the next touch without a remount.
    reported = true;
    bed.gesture();
    expect(bed.audible).toBe(true);
    expect(engine.muted).toBe(false);
    expect(engine.wake).toHaveBeenCalledTimes(1);
    bed.cue('bell');
    expect(engine.cue).toHaveBeenCalledTimes(1);
    bed.dispose();
  });

  it('refuses to forward cues when a native adapter rejects unmute, then recovers on a later gesture', () => {
    const engine = fakeSound();
    let actuallyMuted = true;
    let refuseUnmute = true;
    Object.defineProperty(engine, 'muted', {
      get: () => actuallyMuted,
      set: (next: boolean) => {
        if (!next && refuseUnmute) throw new Error('NotAllowedError: host audio locked');
        actuallyMuted = next;
      },
    });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    expect(bed.audible, 'a refused unmute was treated as successful').toBe(false);
    expect(engine.muted).toBe(true);
    bed.cue('bell');
    expect(engine.cue).not.toHaveBeenCalled();
    expect(engine.wake).not.toHaveBeenCalled();

    refuseUnmute = false;
    bed.gesture();
    expect(bed.audible).toBe(true);
    expect(engine.muted).toBe(false);
    bed.cue('bell');
    expect(engine.cue).toHaveBeenCalledWith('bell');
    bed.dispose();
  });

  it('suspends a previously audible drone if the host refuses mute, and can retry later', () => {
    const engine = fakeSound();
    let actuallyMuted = true;
    let refuseMute = false;
    Object.defineProperty(engine, 'muted', {
      get: () => actuallyMuted,
      set: (next: boolean) => {
        if (next && refuseMute) throw new Error('InvalidStateError: output changed');
        actuallyMuted = next;
      },
    });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    expect(bed.audible).toBe(true);
    expect(engine.muted).toBe(false);

    refuseMute = true;
    bed.prefer({ on: false, volume: 0.5 });
    expect(bed.audible).toBe(false);
    expect(engine.muted, 'the host accepted a mute it was supposed to refuse').toBe(false);
    expect(engine.suspend, 'a refused mute left previously playing sound untouched').toHaveBeenCalledTimes(1);
    bed.cue('seal');
    expect(engine.cue).not.toHaveBeenCalled();

    refuseMute = false;
    bed.prefer({ on: false, volume: 0.5 });
    expect(engine.muted).toBe(true);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    expect(bed.audible).toBe(true);
    bed.cue('seal');
    expect(engine.cue).toHaveBeenCalledWith('seal');
    bed.dispose();
  });


  it('fails closed when a host silently ignores a lower volume, then recovers on retry', () => {
    const engine = fakeSound();
    let actualVolume = 1;
    let ignoreVolume = false;
    Object.defineProperty(engine, 'volume', {
      get: () => actualVolume,
      set: (next: number) => { if (!ignoreVolume) actualVolume = next; },
    });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 1 });
    bed.gesture();
    expect(bed.audible).toBe(true);

    ignoreVolume = true;
    bed.prefer({ on: true, volume: 0.2 });
    expect(engine.volume, 'host did not actually lower the output').toBe(1);
    expect(bed.audible, 'stale louder output was treated as safe').toBe(false);
    expect(engine.muted).toBe(true);
    bed.cue('bell');
    expect(engine.cue).not.toHaveBeenCalled();

    ignoreVolume = false;
    bed.prefer({ on: true, volume: 0.2 });
    expect(engine.volume).toBe(0.2);
    expect(bed.audible).toBe(true);
    bed.cue('seal');
    expect(engine.cue).toHaveBeenCalledWith('seal');
    bed.dispose();
  });

  it('suspends when a host silently ignores muting and retries once the host recovers', () => {
    const engine = fakeSound();
    let actuallyMuted = true;
    let ignoreMute = false;
    Object.defineProperty(engine, 'muted', {
      get: () => actuallyMuted,
      set: (next: boolean) => {
        if (next && ignoreMute) return;
        actuallyMuted = next;
      },
    });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    expect(bed.audible).toBe(true);

    ignoreMute = true;
    bed.prefer({ on: false, volume: 0.5 });
    expect(engine.muted, 'the host silently refused to mute').toBe(false);
    expect(bed.audible).toBe(false);
    expect(engine.suspend, 'the unchanged live output was not suspended').toHaveBeenCalledTimes(1);
    bed.cue('bell');
    expect(engine.cue).not.toHaveBeenCalled();

    ignoreMute = false;
    bed.prefer({ on: false, volume: 0.5 });
    expect(engine.muted).toBe(true);
    bed.prefer({ on: true, volume: 0.5 });
    bed.gesture();
    expect(bed.audible).toBe(true);
    bed.cue('seal');
    expect(engine.cue).toHaveBeenCalledWith('seal');
    bed.dispose();
  });

});

describe('Age scene recovery after a refusing host (#1986)', () => {
  it('retries the same Age when the adapter rejected its first delivery', () => {
    const engine = fakeSound();
    const delivery = vi.fn()
      .mockImplementationOnce(() => { throw new Error('InvalidStateError: audio host unavailable'); });
    engine.setDrone = delivery;
    const bed = new SoundBed(engine);
    const warm: Parameters<SoundBed['scene']>[0] = { registers: ['warm'], frame: false };

    expect(() => bed.scene(warm)).not.toThrow();
    expect(delivery).toHaveBeenCalledTimes(1);
    // The next view did not change Age, but the previously rejected request
    // must not be mistaken for one the engine actually accepted.
    expect(() => bed.scene({ registers: ['warm'], frame: false })).not.toThrow();
    expect(delivery).toHaveBeenCalledTimes(2);
    expect(delivery).toHaveBeenLastCalledWith(warm);

    bed.scene(warm);
    expect(delivery, 'a successful unchanged scene restarted the drone').toHaveBeenCalledTimes(2);
    bed.dispose();
  });

  it('retries a failed silence request rather than leaving a stale drone', () => {
    const engine = fakeSound();
    let rejectOneClear = true;
    const delivery = vi.fn((scene: Parameters<SoundEngine['setDrone']>[0]) => {
      if (scene === null && rejectOneClear) {
        rejectOneClear = false;
        throw new Error('InvalidStateError: output moved');
      }
    });
    engine.setDrone = delivery;
    const bed = new SoundBed(engine);
    bed.scene({ registers: ['warm'], frame: false });
    expect(delivery).toHaveBeenCalledTimes(1);

    expect(() => bed.scene(null)).not.toThrow();
    expect(delivery).toHaveBeenCalledTimes(2);
    bed.scene(null);
    expect(delivery).toHaveBeenCalledTimes(3);
    expect(delivery).toHaveBeenLastCalledWith(null);

    bed.scene(null);
    expect(delivery).toHaveBeenCalledTimes(3);
    bed.dispose();
  });
});

describe('asynchronous host audio refusals (#1986)', () => {
  it('contains late cue, wake, suspend and close rejections without interrupting play', async () => {
    const engine = fakeSound();
    engine.cue = vi.fn(async () => { throw new Error('cue rejected after return'); });
    engine.wake = vi.fn(async () => { throw new Error('wake rejected after return'); });
    engine.suspend = vi.fn(async () => { throw new Error('suspend rejected after return'); });
    engine.close = vi.fn(async () => { throw new Error('close rejected after return'); });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.5 });
    expect(() => { bed.gesture(); bed.cue('bell'); bed.hide(); bed.dispose(); }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.wake).toHaveBeenCalledTimes(1);
    expect(engine.cue).toHaveBeenCalledWith('bell');
    expect(engine.suspend).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('retries an unchanged Age after a late rejected scene delivery', async () => {
    const engine = fakeSound();
    engine.setDrone = vi.fn()
      .mockRejectedValueOnce(new Error('scene rejected after return'))
      .mockResolvedValue(undefined);
    const bed = new SoundBed(engine);
    const warm = { registers: ['warm'] as const, frame: false };

    expect(() => bed.scene({ registers: [...warm.registers], frame: warm.frame })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    bed.scene({ registers: [...warm.registers], frame: warm.frame });
    expect(engine.setDrone).toHaveBeenCalledTimes(2);
    expect(engine.setDrone).toHaveBeenLastCalledWith({ registers: ['warm'], frame: false });
    bed.scene({ registers: ['warm'], frame: false });
    expect(engine.setDrone, 'accepted identical scene restarted the drone').toHaveBeenCalledTimes(2);
    bed.dispose();
  });

  it('does not let a late refusal of an older scene invalidate a newer accepted Age', async () => {
    let refuseOld!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      refuseOld = reject;
    });
    const engine = fakeSound();
    engine.setDrone = vi.fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(undefined);
    const bed = new SoundBed(engine);

    bed.scene({ registers: ['warm'], frame: false });
    bed.scene({ registers: ['cold'], frame: false });
    refuseOld(new Error('old warm device closed'));
    await Promise.resolve();
    await Promise.resolve();
    bed.scene({ registers: ['cold'], frame: false });
    expect(engine.setDrone, 'older refusal evicted the accepted cold scene').toHaveBeenCalledTimes(2);
    bed.dispose();
  });

  it('retries after a newer synchronous refusal while an older delivery is still pending', async () => {
    let refuseOld!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      refuseOld = reject;
    });
    const engine = fakeSound();
    engine.setDrone = vi.fn()
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(() => { throw new Error('new Age unavailable'); })
      .mockResolvedValue(undefined);
    const bed = new SoundBed(engine);

    bed.scene({ registers: ['warm'], frame: false });
    // The attempted cold scene is refused synchronously while warm is pending.
    bed.scene({ registers: ['cold'], frame: false });
    refuseOld(new Error('warm also refused after return'));
    await Promise.resolve();
    await Promise.resolve();
    bed.scene({ registers: ['warm'], frame: false });
    expect(engine.setDrone, 'a refused newer scene left the older key cached').toHaveBeenCalledTimes(3);
    expect(engine.setDrone).toHaveBeenLastCalledWith({ registers: ['warm'], frame: false });
    bed.dispose();
  });
  it('suspends a partially unmuted host after its setter throws, then recovers on another gesture', () => {
    const engine = fakeSound();
    let actuallyMuted = true;
    let refuseUnmute = true;
    Object.defineProperty(engine, 'muted', {
      get: () => actuallyMuted,
      set: (next: boolean) => {
        // A native bridge may change its output before reporting an error.
        actuallyMuted = next;
        if (!next && refuseUnmute) throw new Error('host lost mute acknowledgement');
      },
    });

    const bed = new SoundBed(engine);
    bed.prefer({ on: true, volume: 0.4 });
    bed.gesture();

    expect(engine.muted, 'the host did partially unmute').toBe(false);
    expect(bed.audible, 'a failed unmute cannot authorize cues').toBe(false);
    expect(engine.suspend, 'the partially opened output must be silenced').toHaveBeenCalledTimes(1);
    expect(engine.wake).not.toHaveBeenCalled();
    bed.cue('bell');
    expect(engine.cue).not.toHaveBeenCalled();

    refuseUnmute = false;
    bed.gesture();
    expect(bed.audible).toBe(true);
    expect(engine.wake).toHaveBeenCalledTimes(1);
    bed.cue('seal');
    expect(engine.cue).toHaveBeenCalledWith('seal');
    bed.dispose();
  });

});
