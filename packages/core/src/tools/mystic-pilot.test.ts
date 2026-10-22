import { describe, expect, it } from 'vitest';
import { USEFUL_WINDOW, usefulWithinWindow } from './mystic-pilot.js';

/** #1873's product question, judged only where a duty was given the chance to answer it. */
describe('a duty is judged on its first ten served years', () => {
  const duty = (servedYears: number, firstUsefulAt?: number) => ({
    kind: 'life_care' as const, working: 'sickroom_watch', servedYears, usefulYears: firstUsefulAt ? 1 : 0,
    ...(firstUsefulAt !== undefined ? { firstUsefulAt } : {}),
    livesKept: 0, yieldKept: 0, crownsKept: 0, spent: 0,
  });

  it('counts an early effect as a hit even if the duty then ended, and a quiet decade as a miss', () => {
    const verdict = usefulWithinWindow([duty(3, 2), duty(USEFUL_WINDOW), duty(40, USEFUL_WINDOW + 1), duty(12, USEFUL_WINDOW)]);
    expect(verdict).toMatchObject({ hits: 2, n: 4, unjudged: 0 });
  });

  it('leaves out a duty that served fewer than ten years and showed nothing yet', () => {
    expect(usefulWithinWindow([duty(USEFUL_WINDOW - 1), duty(0)])).toMatchObject({ hits: 0, n: 0, unjudged: 2, rate: null });
  });
});
