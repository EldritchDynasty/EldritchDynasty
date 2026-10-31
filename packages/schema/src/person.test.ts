import { describe, expect, it } from 'vitest';
import { RetainerContractS } from './person.js';

const contract = {
  role: 'steward',
  term: 'bonded',
  wage: 6,
  loyalty: 60,
  boundTo: 'house_gearithy',
  debt: 120,
} as const;

describe('bonded service is repaid rather than indefinite (#2186)', () => {
  it.each([
    ['zero', 0],
    ['negative', -3],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s as a bonded yearly wage', (_reason, wage) => {
    const result = RetainerContractS.safeParse({ ...contract, wage });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'wage')).toBe(true);
    }
  });

  it('keeps positive bonded wages valid, with the existing defaults', () => {
    const parsed = RetainerContractS.parse({ ...contract, wage: 3 });
    expect(parsed.term).toBe('bonded');
    expect(parsed.wage).toBe(3);
    expect(parsed.onEmployerDeath).toBe('passes_to_heir');
  });

  it('does not alter the previous zero-wage rule for other contract terms', () => {
    expect(RetainerContractS.safeParse({ ...contract, term: 'yearly', wage: 0 }).success).toBe(true);
  });
});
