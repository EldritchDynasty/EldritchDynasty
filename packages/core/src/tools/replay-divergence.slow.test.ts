import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { CAMPAIGNS } from '../campaign.js';
import { measureDensity, type ChoiceVisit } from './density-gate.js';
import { shortLineChoices } from './replay-divergence.js';

const bundle = loadContent();

/**
 * ── THE REPLAY GATE READS THE DENSITY PLAYER, AND DISTURBS NOTHING ────────
 *
 * `gate:replay` (#272) takes both its id and its shape columns off
 * `measureDensity` through `onChoice`, on a Short Line. Two things have to be
 * true for that to be a measurement rather than a second instrument:
 *
 *   - the observer is inert — a run measured with it is the run measured
 *     without it, or every density baseline in BALANCE-LOG would move the
 *     day somebody attached one;
 *   - `campaign: 'short'` reaches the game. A 300-year term on the Long Line
 *     looks exactly like a Short Line from the outside, and this gate measured
 *     one for its first day (see `corpus.slow.test.ts`).
 */
describe('the density player, observed', () => {
  const SEED = 901;
  const YEARS = 60;

  it('reports every choice it counts, and changes nothing by reporting it', () => {
    const seen: ChoiceVisit[] = [];
    const observed = measureDensity(bundle, SEED, YEARS, { onChoice: (v) => seen.push(v) });
    const plain = measureDensity(bundle, SEED, YEARS);
    expect(observed).toEqual(plain);
    expect(seen.length).toBe(plain.choices);
    expect(seen.length).toBeGreaterThan(0);
    for (const visit of seen) {
      expect(visit.category).toMatch(/^\[.*\]$/);
      expect(visit.kind).toMatch(/^\[.*\]$/);
    }
    // In the order met.
    expect(seen.map((v) => v.year)).toEqual([...seen.map((v) => v.year)].sort((a, b) => a - b));
  });

  it('plays the campaign it is given: a Short Line stops at its own term', () => {
    // Asked for five hundred. `lived` also counts the turn that closes the term
    // (the ending is written in 1342 without the clock moving on), hence + 1;
    // the Long Line this defaulted to would have played on to 500.
    const run = measureDensity(bundle, SEED, CAMPAIGNS.long.years, { campaign: 'short' });
    expect(run.years).toBeLessThanOrEqual(CAMPAIGNS.short.years + 1);
  });

  it('and the replay stream is that player, on a Short Line, with a shape on every visit', () => {
    const visits = shortLineChoices(bundle, SEED);
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((v) => typeof v.shape === 'string')).toBe(true);
    expect(Math.max(...visits.map((v) => v.year)))
      .toBeLessThanOrEqual(CAMPAIGNS.short.startYear + CAMPAIGNS.short.years);
  });
});
