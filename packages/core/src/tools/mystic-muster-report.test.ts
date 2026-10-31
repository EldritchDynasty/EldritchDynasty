import { describe, expect, it } from 'vitest';
import { assertMysticFieldSampleRange } from './mystic-muster-report.js';

describe('Mystic field report sample seed ranges (#2175)', () => {
  it('accepts normal and exactly bounded safe sample ranges', () => {
    expect(() => assertMysticFieldSampleRange(24, 187400)).not.toThrow();
    expect(() => assertMysticFieldSampleRange(1, Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(() => assertMysticFieldSampleRange(3, Number.MAX_SAFE_INTEGER - 2)).not.toThrow();
    expect(() => assertMysticFieldSampleRange(1, Number.MIN_SAFE_INTEGER)).not.toThrow();
    expect(() => assertMysticFieldSampleRange(2, -2)).not.toThrow();
  });

  it('refuses spans that would count two rounded seeds as independent houses', () => {
    expect(Number.MAX_SAFE_INTEGER + 1).toBe(Number.MAX_SAFE_INTEGER + 2);
    for (const [runs, base] of [
      [2, Number.MAX_SAFE_INTEGER],
      [3, Number.MAX_SAFE_INTEGER - 1],
      [3, Number.MAX_SAFE_INTEGER],
    ] as const) {
      expect(() => assertMysticFieldSampleRange(runs, base)).toThrow(/safe integer seed limit/);
    }
  });

  it('preserves invalid input handling before running any campaign', () => {
    for (const runs of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertMysticFieldSampleRange(runs, 187400)).toThrow(/Expected positive runs and integer seed base/);
    }
    for (const base of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertMysticFieldSampleRange(1, base)).toThrow(/Expected positive runs and integer seed base/);
    }
  });
});
