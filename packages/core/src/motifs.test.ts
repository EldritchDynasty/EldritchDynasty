import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap } from './sim.js';
import { evalCondition } from './events/conditions.js';

const bundle = loadContent();
const reading = (id: string) => bundle.events.find((event) => event.id === id)!;

describe('the long gallery motif structure', () => {
  it('assigns its three tale readings to ordered campaign thirds', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const ids = ['the_gallery_is_begun', 'no_room_on_the_wall', 'somebody_taken_down'];

    const eligibleAt = (year: number) => {
      ctx.world.year = year;
      return ids.map((id) => evalCondition(reading(id).conditions, ctx));
    };

    expect(eligibleAt(1100)).toEqual([true, false, false]);
    expect(eligibleAt(1300)).toEqual([false, true, false]);
    expect(eligibleAt(1450)).toEqual([false, false, true]);
  });

  it('makes the frame close read the third Chronicle page', () => {
    const frame = reading('frame_the_long_gallery');
    expect(frame.tier).toBe('frame');
    expect(frame.reads).toContainEqual({ chronicled: 'somebody_taken_down' });
  });
});
