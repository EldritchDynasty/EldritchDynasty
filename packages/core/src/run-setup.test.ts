import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap } from './sim.js';
import { assertHarnessCount, bootstrapRun, runSetupFlags, runSetupLabel } from './run-setup.js';

const bundle = loadContent();

/**
 * A MEASURED RUN'S FOUNDING (#1867). The default must be exactly the
 * bootstrap every gate made before, or CI's gates and their fingerprints move
 * for a change that only added a door.
 */
describe('run setup', () => {
  it('founds exactly what every gate founded before when nothing is asked', () => {
    expect(bootstrapRun(bundle, 4000).world).toEqual(bootstrap(bundle, 4000, 1042).world);
  });

  it('founds the configuration it names, on the campaign it names', () => {
    const w = bootstrapRun(bundle, 4000, { campaign: 'short', founding: 'blood_mother' }).world;
    const founder = w.people.get(w.narrator!)!;
    expect([w.campaign, founder.sex, founder.gender]).toEqual(['short', 'female', 'woman']);
  });

  it('reads its flags, refuses a misspelt one, and labels what it measured', () => {
    expect(runSetupFlags(['8', '300', '--campaign=short', '--founding=blood_mother']))
      .toEqual({ campaign: 'short', founding: 'blood_mother' });
    expect(runSetupFlags(['8'])).toEqual({});
    expect(() => runSetupFlags(['--founding=mother'])).toThrow();
    expect(runSetupLabel({})).toBe('long · authored founder');
    expect(runSetupLabel({ campaign: 'short', founding: 'blood_mother' })).toBe('short · blood_mother');
  });
});

describe('measured-run dimension validation (#2735)', () => {
  it('refuses zero, negative, fractional and non-finite batch sizes', () => {
    for (const runs of [0, -1, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertHarnessCount(runs, 'runs', 1), `runs=${runs}`)
        .toThrow('runs must be a positive safe integer');
    }
  });

  it('refuses non-finite, negative, fractional and unsafe year counts', () => {
    for (const years of [-1, 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertHarnessCount(years, 'years', 0), `years=${years}`)
        .toThrow('years must be a non-negative safe integer');
    }
  });

  it('allows a positive batch and the intentional zero-year founding snapshot', () => {
    expect(() => assertHarnessCount(1, 'runs', 1)).not.toThrow();
    expect(() => assertHarnessCount(0, 'years', 0)).not.toThrow();
    expect(() => assertHarnessCount(500, 'years', 0)).not.toThrow();
  });
});
