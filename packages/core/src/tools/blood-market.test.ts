import { describe, expect, it } from 'vitest';
import { saidScore } from './blood-market.js';

describe('blood gate market signal', () => {
  it('does not change when the broker sentence is reworded', () => {
    const english = {
      line: 'fertile' as const,
      fontCarrierRate: 0.05,
      words: 'deep blood · a full line',
    };
    const reworded = {
      ...english,
      words: 'old blood in the house · many children',
    };

    expect(saidScore(english)).toBe(6);
    expect(saidScore(reworded)).toBe(6);
  });

  it('reads the same structured carrier-rate bands the market uses', () => {
    expect(saidScore({ line: 'ordinary', fontCarrierRate: 0 })).toBe(0);
    expect(saidScore({ line: 'ordinary', fontCarrierRate: 0.001 })).toBe(1);
    expect(saidScore({ line: 'ordinary', fontCarrierRate: 0.04 })).toBe(4);
  });

  it('keeps the fertility line contribution structured too', () => {
    expect(saidScore({ line: 'fertile', fontCarrierRate: 0 })).toBe(2);
    expect(saidScore({ line: 'ordinary', fontCarrierRate: 0 })).toBe(0);
    expect(saidScore({ line: 'thin', fontCarrierRate: 0 })).toBe(-2);
    expect(saidScore({ line: 'unknown', fontCarrierRate: 0 })).toBe(0);
  });
});
