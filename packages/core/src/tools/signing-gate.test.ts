import { describe, expect, it } from 'vitest';
import { verdictOver, type SigningSample } from './signing-verdict.js';

function samples(
  answer: string,
  values: Pick<SigningSample, 'reachedTerm' | 'bestRung' | 'clauses' | 'ending'>,
): SigningSample[] {
  return Array.from({ length: 24 }, (_, seed) => ({
    seed,
    question: 'the_ford',
    answer,
    ...values,
  }));
}

describe('signing balance verdict (#343)', () => {
  it('accepts paired answers with the same practical outcomes', () => {
    const verdict = verdictOver([
      ...samples('own_back', { reachedTerm: 1, bestRung: 2, clauses: 2, ending: 'forgotten' }),
      ...samples('wait_for_water', { reachedTerm: 1, bestRung: 2, clauses: 2, ending: 'forgotten' }),
    ]);
    expect(verdict.ok, verdict.lines.join('\n')).toBe(true);
  });

  it('goes red on a deliberately lopsided answer', () => {
    const verdict = verdictOver([
      ...samples('right_answer', { reachedTerm: 1, bestRung: 3, clauses: 3, ending: 'settled' }),
      ...samples('wrong_answer', { reachedTerm: 0, bestRung: 1, clauses: 0, ending: undefined }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines.join('\n')).toMatch(/FAIL:.*(term reach|best rung|clauses)/);
  });
});
