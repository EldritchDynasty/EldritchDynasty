import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap } from './sim.js';
import { bootstrapRun, runSetupFlags, runSetupLabel } from './run-setup.js';

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
