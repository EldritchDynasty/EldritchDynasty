import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, runYears, worldViolations, expectHealthyWorld, END_YEAR } from '@ed/core';

const bundle = loadContent();

/**
 * IS THE WORLD STILL A WORLD AFTER A THOUSAND YEARS?
 *
 * Forty-three suites play millennia and each checks its own subsystem — did
 * the ladder move, did the record drift, did the branches grieve. Between
 * them they own no answer to "are these people internally consistent",
 * because it belongs to none of them. `docs/FAILURES.md` is largely a list of
 * times that gap shipped: children in the wrong household, widows still
 * married to dead men, cast slots never refilled, the seal out of the main
 * house twice. Every one of those is a predicate over a single world.
 *
 * The rules live in `worldViolations` (`core/src/testing.ts`) and are proven
 * able to fail in `world-health.test.ts` — hand-built worlds, one broken
 * thing each. This file asks the same questions of worlds nobody built by
 * hand, which is where the answers can surprise you.
 *
 * SAMPLED THROUGH THE RUN, NOT ONLY AT THE END. A world can be incoherent in
 * 1300 and coherent again by 2042 — the widow gets swept up, the seal gets
 * refilled — and "fine at the end" is exactly the reading that misses a
 * subsystem that stopped working for two centuries. Checking every fifty
 * years costs nothing measurable next to the years themselves.
 */
const SEEDS = Array.from({ length: 8 }, (_, i) => 2200 + i * 97);
const EVERY = 50;
const END = END_YEAR;

describe('a played world stays internally coherent', () => {
  /**
   * One pass, eight runs, every rule at every checkpoint. Reported as a
   * tally rather than a first failure: one broken person is a bad effect and
   * four hundred is a bad gate, and the difference is the whole diagnosis.
   */
  it('across eight millennia, sampled every fifty years', () => {
    const tally = new Map<string, { n: number; first: string; when: number }>();
    let checkpoints = 0;

    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      for (let year = 1042; year < END; year += EVERY) {
        runYears(ctx, Math.min(EVERY, END - year));
        checkpoints += 1;
        for (const v of worldViolations(ctx)) {
          const seen = tally.get(v.rule);
          if (seen) seen.n += 1;
          else tally.set(v.rule, { n: 1, first: v.detail, when: ctx.world.year });
        }
      }
    }

    // The scan has to have actually looked at something.
    expect(checkpoints).toBe(SEEDS.length * Math.ceil((END - 1042) / EVERY));

    const report = [...tally.entries()]
      .map(([rule, { n, first, when }]) => `  ${rule} × ${n} — first in ${when}: ${first}`)
      .join('\n');
    expect([...tally.keys()], `the world came apart across ${checkpoints} checkpoints:\n${report}`)
      .toEqual([]);

  });

  /**
   * THE TERM CHECK IS ABOUT SURVIVING WORLDS, NOT LUCKY SEED IDENTITIES.
   *
   * This used to name three seeds and require all three to reach the term.
   * Rival-house descent (#149) legitimately changed one deterministic
   * trajectory: seed 2200 now runs out in 1170. That did not make a world
   * health rule false; it exposed a seed-reach assertion wearing the clothes
   * of a mechanism assertion.
   *
   * Use the same eight-run cohort as the sampled scan instead. Every world
   * that reaches the term must be non-empty and pass `expectHealthyWorld`,
   * and a majority of the cohort must still reach the term. Population
   * collapse therefore still fails this suite; adding any feature no longer
   * requires finding a replacement seed merely to preserve three identities.
   */
  it('and every surviving Long-Line world is coherent at the term', () => {
    const finished: number[] = [];
    const endedEarly: string[] = [];

    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, END - 1042);

      if (ctx.world.year !== END) {
        endedEarly.push(`${seed}→${ctx.world.year}`);
        continue;
      }

      const household = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
      expect(household.length, `seed ${seed} reached ${END} with an empty household`)
        .toBeGreaterThan(0);
      expectHealthyWorld(ctx);
      finished.push(seed);
    }

    expect(
      finished.length,
      `full-term seeds: [${finished.join(', ')}]; ended early: [${endedEarly.join(', ')}]`,
    ).toBeGreaterThan(SEEDS.length / 2);
  });
});
