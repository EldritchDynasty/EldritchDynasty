import { describe, expect, it } from 'vitest';
import type { EndingId } from '@ed/schema';
import { ascendantFunnelVerdict, type FunnelRun } from './ascendant-verdict.js';

/** `n` runs, the first `took` of which had somebody take the Unmaking. */
function batch(n: number, took: number, apotheosis = 0): FunnelRun[] {
  return Array.from({ length: n }, (_, i) => ({
    ending: (i < apotheosis ? 'apotheosis' : 'settled') as EndingId,
    unmakingTakers: i < took ? 1 : 0,
  }));
}

describe('the ladder funnel verdict (issue #325)', () => {
  it('passes the batch CI actually sees: 16 of 100 against the chronicler\'s none', () => {
    const v = ascendantFunnelVerdict(batch(100, 0), batch(100, 16, 1));
    expect(v.failures).toEqual([]);
    expect(v.lines.join('\n')).toMatch(/16\/100 \(16\.0%\) ascendant runs · 0\/100 \(0\.0%\) chronicler/);
  });

  it('rejects a ladder house that reaches the Unmaking no more than the chronicler', () => {
    const v = ascendantFunnelVerdict(batch(100, 10), batch(100, 10));
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toMatch(/does not measurably reach the Unmaking/);
  });

  it('rejects a lead too thin for the batch to carry, and says what would', () => {
    // 3 against 0 in 100 is "more", by 1.7 standard errors — a coin.
    const v = ascendantFunnelVerdict(batch(100, 0), batch(100, 3));
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toMatch(/standard errors/);
  });

  it('no longer turns on one Apotheosis, which is the coin #325 was filed about', () => {
    const lucky = ascendantFunnelVerdict(batch(100, 0), batch(100, 16, 1));
    const unlucky = ascendantFunnelVerdict(batch(100, 0), batch(100, 16, 0));
    expect(unlucky.failures).toEqual(lucky.failures);
    expect(unlucky.lines.join('\n')).toMatch(/apotheosis 0\/100/);
  });

  it('judges nothing when a column is empty', () => {
    expect(ascendantFunnelVerdict([], batch(100, 16))).toEqual({ lines: [], failures: [] });
  });
});
