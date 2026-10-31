import { describe, expect, it } from 'vitest';
import { assertTableLoadSampleRange } from './table-load-report.js';

describe('Table-load report sample range (#2173)', () => {
  it('accepts a normal range and an exact upper-boundary range', () => {
    expect(() => assertTableLoadSampleRange(24, 199200)).not.toThrow();
    expect(() => assertTableLoadSampleRange(3, Number.MAX_SAFE_INTEGER - 2)).not.toThrow();
    expect(() => assertTableLoadSampleRange(1, Number.MAX_SAFE_INTEGER)).not.toThrow();
    // Preserve the pre-existing allowance for negative, but safe, seed bases.
    expect(() => assertTableLoadSampleRange(2, -2)).not.toThrow();
  });

  it('rejects seed spans whose final integer cannot be represented exactly', () => {
    // At this boundary, two distinct intended seeds already collapse to one
    // JavaScript Number: the report would count duplicate observations.
    expect(Number.MAX_SAFE_INTEGER + 1).toBe(Number.MAX_SAFE_INTEGER + 2);
    expect(() => assertTableLoadSampleRange(3, Number.MAX_SAFE_INTEGER))
      .toThrow(/safe integer seed limit/);
    expect(() => assertTableLoadSampleRange(3, Number.MAX_SAFE_INTEGER - 1))
      .toThrow(/safe integer seed limit/);
    expect(() => assertTableLoadSampleRange(2, Number.MAX_SAFE_INTEGER))
      .toThrow(/safe integer seed limit/);
  });

  it('retains the existing invalid-count and invalid-base refusals', () => {
    for (const runs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertTableLoadSampleRange(runs, 199200)).toThrow(/Expected positive runs and integer seed base/);
    }
    for (const seed of [1.5, Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertTableLoadSampleRange(1, seed)).toThrow(/Expected positive runs and integer seed base/);
    }
  });
});
