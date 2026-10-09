import { describe, expect, it } from 'vitest';
import { ordinalSuffix, testRng, uniqueName } from '@ed/core';

describe('ordinal bynames', () => {
  it('retains the nine worded ordinals while using correct numeric endings', () => {
    expect(Array.from({ length: 9 }, (_, i) => ordinalSuffix(i + 1))).toEqual([
      'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
      'seventh', 'eighth', 'ninth',
    ]);

    for (const [n, wording] of [
      [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'],
      [20, '20th'], [21, '21st'], [22, '22nd'], [23, '23rd'],
      [101, '101st'], [102, '102nd'], [103, '103rd'],
      [111, '111th'], [112, '112th'], [113, '113th'],
      [121, '121st'], [122, '122nd'], [123, '123rd'],
    ] as const) {
      expect(ordinalSuffix(n), String(n)).toBe(wording);
    }
  });

  it('keeps high collision disambiguations unique and grammatical', () => {
    const seed = testRng('high-ordinal-names');
    // Keep the same base name while exercising the real suffix/shuffle paths.
    // A large village can eventually exhaust all ordinary bynames.
    const rng = { ...seed, pick: <T>(options: readonly T[]): T => options[0]! };
    const taken = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const name = uniqueName('male', taken, rng, { place: 'Hesk' });
      expect(taken.has(name), `duplicate at iteration ${i}`).toBe(false);
      taken.add(name);
    }

    expect(taken.size).toBe(100);
    expect(taken.has('Aldous of Hesk the 21st')).toBe(true);
    expect(taken.has('Aldous of Hesk the 21th')).toBe(false);
  });
});
