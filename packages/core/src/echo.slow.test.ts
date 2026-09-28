import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { playedRun } from './corpus.js';
import { echoTally } from './bearing.js';
import { expectMean } from './testing.js';

/**
 * ARE ECHOES COMMON ENOUGH TO TEACH, AND RARE ENOUGH NOT TO NAG? (issue #326)
 *
 * #211 asked for both and measured neither. On `68a69db`, over seeds 901–906,
 * one sentence frame came back 10–12 times in a run: a house that took the
 * cousin card each generation heard "People still spoke of…" at every one of
 * them. Each kind now rotates three lines and echoes at most once a
 * generation (`ECHO_SPACING`); this is the instrument that holds both halves.
 *
 * Both terms, twelve seeds each, read back through the run corpus. The
 * ceiling and floor are recorded in docs/BALANCE-LOG.md with the measurement
 * they were chosen against.
 */
const bundle = loadContent();
const SEEDS = Array.from({ length: 12 }, (_, i) => 901 + i);

/** No sentence frame more than this many times in one run, on average. */
const MAX_COPIES_CEILING = 4;
/** Fewer echoes than this a run and the book stops teaching that acts come back. */
const ECHOES_FLOOR = 2;

describe.each([['short', 300], ['long', 500]] as const)('Bearing echoes on the %s line (issue #326)', (campaign, years) => {
  const tallies = SEEDS.map((seed) => echoTally(playedRun(bundle, seed, years, 1042, campaign).world.bearing.acts));

  it('prints what it measured', () => {
    console.log(`echoes (${campaign}): written ${tallies.map((t) => t.written).join(', ')}`
      + ` · most copies of one line ${tallies.map((t) => t.maxCopies).join(', ')}`);
    expect(tallies).toHaveLength(SEEDS.length);
  });

  it(`never makes the reader hear one line more than ${MAX_COPIES_CEILING} times a run`, () => {
    expectMean({ values: tallies.map((t) => t.maxCopies), ceiling: MAX_COPIES_CEILING, what: `copies of one echo line per ${campaign} run` });
  });

  it(`still echoes at least ${ECHOES_FLOOR} old acts a run`, () => {
    expectMean({ values: tallies.map((t) => t.written), floor: ECHOES_FLOOR, what: `echo lines per ${campaign} run` });
  });
});
