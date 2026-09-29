import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { phase, testWorld } from '../testing.js';
import { landRiskRoutes } from './land-routes.js';

const bundle = loadContent();

describe('the land gate\'s engine-tick routes (issue #276)', () => {
  it('reads each route once, whatever the year struck', () => {
    expect(landRiskRoutes({})).toEqual([]);
    expect(landRiskRoutes({
      landRisks: {
        villageHarvest: 1,
        sarrowSank: true,
        struck: [
          { route: 'blight', parcel: 'ardwen_wood' },
          { route: 'sarrow_sink', parcel: 'sarrow_bottom' },
          { route: 'blight', parcel: 'some_other_wood' },
        ],
      },
    })).toEqual(['blight', 'sarrow_sink']);
  });

  it('does not change when the chronicle\'s sentence is reworded', () => {
    // The land phase on its own real stream, year after year, until the one
    // woodland the house starts with takes blight: 3% a year, deterministic
    // per (seed, year, phase), so this is a fixed walk and not a coin.
    const ctx = testWorld(bundle);
    let report = phase('land', ctx);
    for (let tries = 0; tries < 400 && !report.landRisks?.struck.length; tries++) {
      ctx.world.year++;
      report = phase('land', ctx);
    }
    expect(report.landRisks?.struck.length, 'no blight in 400 land ticks').toBeGreaterThan(0);

    const before = landRiskRoutes(report);
    expect(before).toContain('blight');
    // The gate used to search this very text for 'Blight took hold in'.
    for (const entry of ctx.world.chronicle) {
      if (entry.year === ctx.world.year) entry.text = 'The timber failed. (reworded)';
    }
    expect(landRiskRoutes(report)).toEqual(before);
  });
});
