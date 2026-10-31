import { describe, expect, it } from 'vitest';
import { sampleSeedEnd } from './sample-seed-span.js';

describe('sampleSeedEnd (#2196)', () => {
  it('accepts the inclusive high boundary without computing an exclusive end', () => {
    expect(sampleSeedEnd(3, Number.MAX_SAFE_INTEGER - 2)).toBe(Number.MAX_SAFE_INTEGER);
    expect(sampleSeedEnd(1, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts safe negative starting seeds and the low boundary', () => {
    expect(sampleSeedEnd(3, Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER + 2);
    expect(sampleSeedEnd(1, Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
    expect(sampleSeedEnd(24, -100)).toBe(-77);
  });

  it('rejects seed spans that would silently repeat rounded seeds', () => {
    expect(() => sampleSeedEnd(4, Number.MAX_SAFE_INTEGER - 2)).toThrow(/precision/);
    expect(() => sampleSeedEnd(3, Number.MAX_SAFE_INTEGER)).toThrow(/precision/);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, NaN,
    Number.MAX_SAFE_INTEGER + 1])('rejects invalid sample counts: %s', runs => {
    expect(() => sampleSeedEnd(runs, 0)).toThrow(/positive runs/);
  });

  it.each([1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, NaN,
    Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])('rejects unsafe bases: %s', base => {
    expect(() => sampleSeedEnd(1, base)).toThrow(/integer seed base/);
  });
});
