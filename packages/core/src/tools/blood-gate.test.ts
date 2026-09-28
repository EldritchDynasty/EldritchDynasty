import { describe, expect, it } from 'vitest';
import { saidScore } from './blood-gate.js';

describe('blood gate market signal', () => {
  it('does not change when the broker sentence is reworded', () => {
    const english = { line: 'fertile' as const, words: 'deep blood · a full line' };
    const reworded = { line: 'fertile' as const, words: 'old blood in the house · many children' };

    expect(saidScore(english, 0.05)).toBe(6);
    expect(saidScore(reworded, 0.05)).toBe(6);
  });

  it('reads the same structured carrier-rate bands the market uses', () => {
    const card = { line: 'ordinary' as const };

    expect(saidScore(card, 0)).toBe(0);
    expect(saidScore(card, 0.001)).toBe(1);
    expect(saidScore(card, 0.04)).toBe(4);
  });

  it('keeps the fertility line contribution structured too', () => {
    expect(saidScore({ line: 'fertile' }, 0)).toBe(2);
    expect(saidScore({ line: 'ordinary' }, 0)).toBe(0);
    expect(saidScore({ line: 'thin' }, 0)).toBe(-2);
    expect(saidScore({ line: 'unknown' }, 0)).toBe(0);
  });
});
