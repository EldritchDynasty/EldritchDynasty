import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, runYears } from './sim.js';
import { expectHealthyWorld } from './testing.js';

const bundle = loadContent();

describe('founding inheritance over a played Long Line', () => {
  it('keeps a played world internally healthy after seeded inheritance is real', () => {
    const ctx = bootstrap(bundle, 344_999);
    runYears(ctx, 500);
    expect(() => expectHealthyWorld(ctx)).not.toThrow();
  });
});
