import { describe, expect, it } from 'vitest';
import { assertSafeThreatSweepSeedSpan } from './mystic-threat-sweep.js';

describe('Mystic conditional threat sweep seed spans (#2177)', () => {
  it('accepts the default report range and both inclusive safe-integer boundaries', () => {
    expect(() => assertSafeThreatSweepSeedSpan(128, 187850)).not.toThrow();
    expect(() => assertSafeThreatSweepSeedSpan(2, Number.MAX_SAFE_INTEGER - 1)).not.toThrow();
    expect(() => assertSafeThreatSweepSeedSpan(1, Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(() => assertSafeThreatSweepSeedSpan(1, Number.MIN_SAFE_INTEGER)).not.toThrow();
  });

  it('rejects spans whose last requested seed is not safely representable', () => {
    expect(() => assertSafeThreatSweepSeedSpan(2, Number.MAX_SAFE_INTEGER)).toThrow(/safe integer seed span/);
    expect(() => assertSafeThreatSweepSeedSpan(3, Number.MAX_SAFE_INTEGER - 1)).toThrow(/safe integer seed span/);
    expect(() => assertSafeThreatSweepSeedSpan(2, Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer seed span/);
  });

  it('rejects invalid run counts and seed bases before sampling', () => {
    for (const runs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertSafeThreatSweepSeedSpan(runs, 187850)).toThrow(/positive runs/);
    }
    for (const seed of [0.5, Number.NEGATIVE_INFINITY, Number.NaN, Number.MIN_SAFE_INTEGER - 1]) {
      expect(() => assertSafeThreatSweepSeedSpan(1, seed)).toThrow(/safe integer seed span/);
    }
  });
});
