import { describe, expect, it } from 'vitest';
import type { Content } from '@ed/schema';
import { measureAchievementRates } from './achievement-report.js';
import { sampleSeedEnd } from './sample-seed-span.js';

// Invalid requests must fail before the report ever touches simulation data.
// Valid boundaries use the exact shared validator rather than launching
// four full campaigns in the fast-test lane.
const unusedContent = null as unknown as Content;

describe('achievement report seed integrity (#2198)', () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid sample count %s before sampling', runs => {
    expect(() => measureAchievementRates(unusedContent, runs, 32300)).toThrow(/positive runs/);
  });

  it.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5,
    Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    'rejects invalid starting seed %s before sampling', seedBase => {
      expect(() => measureAchievementRates(unusedContent, 1, seedBase)).toThrow(/integer seed base/);
    },
  );

  it.each([
    [3, Number.MAX_SAFE_INTEGER],
    [4, Number.MAX_SAFE_INTEGER - 2],
    [2, Number.MAX_SAFE_INTEGER],
  ])('rejects a %i-run span beginning at %i that loses precision', (runs, seedBase) => {
    expect(() => measureAchievementRates(unusedContent, runs, seedBase)).toThrow(/precision/);
  });

  it('preserves the existing default, safe negative bases and exact inclusive boundary', () => {
    expect(sampleSeedEnd(1, 32300)).toBe(32300);
    expect(sampleSeedEnd(3, -100)).toBe(-98);
    expect(sampleSeedEnd(3, Number.MAX_SAFE_INTEGER - 2)).toBe(Number.MAX_SAFE_INTEGER);
    expect(sampleSeedEnd(1, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
