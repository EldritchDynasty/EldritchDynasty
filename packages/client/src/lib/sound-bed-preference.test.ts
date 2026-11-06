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

});
