import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { testWorld, place } from '../testing.js';
import { head } from '../world.js';
import { phenotypeOf } from '../people/factory.js';
import { blockerActionability } from './stall.js';
import { diagnosticPeriod } from './density-gate.js';
import {
  traceDiagnosticIntervals, diagnosticIntervalLines,
  type DiagnosticYear, type DensityRun,
} from './density-report.js';

function sample(year: number, overrides: Partial<DiagnosticYear> = {}): DiagnosticYear {
  return {
    year, period: 'unwoken', blocker: 'no-expresser', actionable: false,
    spine: false, choices: 0, matches: 0, records: 0, auctions: 0,
    orders: 0, routine: 0, ...overrides,
  };
}

describe('Regency and unwoken pacing (#1814)', () => {
  it('reads actual Regency from the seated woman, never from no-expresser alone', () => {
    const ctx = testWorld(loadContent().bundle);
    const incumbent = head(ctx.world);
    expect(incumbent).toBeDefined();
    incumbent!.castSlots = incumbent!.castSlots.filter((slot) => slot !== 'head');
    const regent = place(ctx, { sex: 'female', age: 36, castSlots: ['head'] });
    expect(diagnosticPeriod(ctx)).toBe('regency');

    // Removing the female Head leaves a vacancy, not a Regency or a Long Wait.
    regent.castSlots = [];
    expect(diagnosticPeriod(ctx)).toBeUndefined();
    incumbent!.castSlots.push('head');
  });

  it('distinguishes a non-regent Long Wait from an observed awakening', () => {
    const ctx = testWorld(loadContent().bundle);
    const incumbent = head(ctx.world);
    expect(incumbent).toBeDefined();
    expect(incumbent?.sex).toBe('male');
    const blood = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    for (const p of blood) p.awakening = { ...p.awakening, awakened: false };
    expect(diagnosticPeriod(ctx)).toBe('unwoken');

    // Witnessing a genuine expresser ends the diagnostic interval. The test
    // uses engine genetics only to construct its fixture, never to label an
    // unawakened person in the player-facing report.
    const expresser = blood.find((p) => p.sex === 'male'
      && phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress);
    expect(expresser).toBeDefined();
    expresser!.awakening = { ...expresser!.awakening, awakened: true };
    if (expresser!.phenotype) expresser!.phenotype.dirty = true;
    expect(diagnosticPeriod(ctx)).toBeUndefined();
  });

  it('sees a real offered Match as an interruption route, not an invented Table order', () => {
    const ctx = testWorld(loadContent().bundle);
    expect(blockerActionability(ctx, 'no-expresser').verbs).not.toContain('study');
    // This is a built-state offered docket: only the kind is inspected when
    // checking the no-expresser lever. There is no guessed future Match.
    ctx.world.pendingDecisions.push({ kind: 'match' } as typeof ctx.world.pendingDecisions[number]);
    const offered = blockerActionability(ctx, 'no-expresser');
    expect(offered).toMatchObject({ actionable: true, verbs: ['match'] });
  });

  it('counts dated consecutive spans, meaningful interruptions, and routine repeats', () => {
    const intervals = traceDiagnosticIntervals([
      sample(1100, { routine: 2 }),
      sample(1101, { actionable: true, spine: true, matches: 1 }),
      sample(1102, { routine: 3, blocker: 'awakening' }),
      sample(1103, { period: 'regency', spine: true, choices: 1, records: 1 }),
      sample(1104, { period: 'regency', routine: 2 }),
      sample(1105, { period: undefined }),
      sample(1106, { period: 'unwoken', auctions: 1, orders: 1, spine: true }),
    ]);
    expect(intervals).toHaveLength(3);
    expect(intervals[0]).toMatchObject({
      period: 'unwoken', from: 1100, to: 1102, years: 3,
      longestQuiet: 1, matches: 1, routine: 5,
      actionableYears: 1, blockedYears: 2,
      blockers: { 'no-expresser': 2, awakening: 1 },
    });
    expect(intervals[1]).toMatchObject({
      period: 'regency', from: 1103, to: 1104, years: 2,
      longestQuiet: 1, choices: 1, records: 1, routine: 2,
    });
    expect(intervals[2]).toMatchObject({
      period: 'unwoken', from: 1106, to: 1106, years: 1,
      longestQuiet: 0, auctions: 1, orders: 1,
    });
  });

  it('does not connect gaps in sampled years or count automatic and naming offers', () => {
    const intervals = traceDiagnosticIntervals([
      sample(1190, { spine: false }),
      sample(1192, { spine: false }),
      sample(1193, { period: undefined }),
    ]);
    expect(intervals.map((span) => [span.from, span.to, span.years])).toEqual([
      [1190, 1190, 1], [1192, 1192, 1],
    ]);
    const text = diagnosticIntervalLines([{
      term: 300, runs: [{
        seed: 5100, diagnosticIntervals: intervals,
      } as DensityRun],
    }]).join('\n');
    expect(text).toContain('Regency /');
    // Explanatory header rules out treating forms or automatic resolutions as player decisions.
    expect(text).toContain('automatic resolutions excluded');
    expect(text).toContain('5100');
    expect(text).toContain('1192');
  });
});
