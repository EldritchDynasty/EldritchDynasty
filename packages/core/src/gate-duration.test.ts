import { describe, expect, it } from 'vitest';
import { checkGateDuration } from '../../../tools/gate-duration.mjs';

const config = {
  measured: '2026-09-28',
  maxFactor: 1.25,
  lanes: {
    batch: { seconds: 100, evidence: 'fixture' },
    war: { seconds: 50, evidence: 'fixture' },
  },
};

describe('gate duration guard', () => {
  it('accepts a measurement inside the stated factor', () => {
    expect(checkGateDuration('batch', 124, config).ok).toBe(true);
  });

  it('rejects a stale committed figure beyond the stated factor', () => {
    const result = checkGateDuration('batch', 126, config);
    expect(result.ok).toBe(false);
    expect(result.factor).toBeCloseTo(1.26);
    expect(result.limitSeconds).toBe(125);
  });

  it('fails closed when CI adds a lane with no committed duration', () => {
    expect(() => checkGateDuration('endings', 10, config)).toThrow(/no committed duration/);
  });

  it('rejects invalid elapsed time instead of treating it as fast', () => {
    expect(() => checkGateDuration('batch', Number.NaN, config)).toThrow(/invalid elapsed/);
  });
});
