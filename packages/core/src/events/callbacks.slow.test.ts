import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { playedRun } from '../corpus.js';
import { causeOf } from '../cause.js';
import { expectRate } from '../testing.js';
import type { SimCtx } from '../world.js';

/**
 * #1898, MEASURED: later generations' Matches, terms and wakings come back.
 *
 * First measurement (24 Long Lines, seeds 20000 + 37i, 30-year cooldowns):
 * a callback page reached the second, third and fourth Heads' reigns in 21,
 * 21 and 20 runs of 24. The misses were reigns a few years long. The floor
 * below is set under that with the margin `expectRate` asks for.
 *
 * `callbacks.test.ts` holds each door and the link on built state; this file
 * asks whether the played game actually reaches them.
 */
const bundle = loadContent();
const RUNS = 24;
const SEEDS = Array.from({ length: RUNS }, (_, i) => 20000 + 37 * i);
const runs = (() => {
  let cached: SimCtx[] | undefined;
  return () => (cached ??= SEEDS.map((seed) => playedRun(bundle, seed, 500)));
})();

/** Each callback's opening event, its return, and the arc that pairs them. */
const CALLBACKS = [
  { arc: 'arc_the_match_come_to_something', opens: 'the_match_made', returns: 'the_match_returned' },
  { arc: 'arc_the_term_paid_for', opens: 'the_term_bought', returns: 'the_term_shows' },
  { arc: 'arc_the_waking_kept', opens: 'the_waking_noticed', returns: 'the_waking_shows' },
] as const;
const PAGES: ReadonlySet<string> = new Set(CALLBACKS.flatMap((c) => [c.opens, c.returns]));

describe('decision callbacks across a played Long Line (#1898)', () => {
  it.each([2, 3, 4])('reach the docket or the chronicle in generation %i in most runs', (generation) => {
    let reigned = 0;
    let reached = 0;
    for (const ctx of runs()) {
      const reign = ctx.world.succession[generation - 1];
      if (!reign) continue;
      reigned += 1;
      const to = reign.to ?? ctx.world.year + 1;
      if (ctx.world.chronicle.some((c) => c.eventId && PAGES.has(c.eventId) && c.year >= reign.from && c.year < to)) {
        reached += 1;
      }
    }
    expectRate({ hits: reached, n: reigned, floor: 0.6, what: `Heads' reigns in generation ${generation} with a callback page` });
  });

  it('every return cites its own opening page', () => {
    let returns = 0;
    for (const ctx of runs()) {
      const book = ctx.world.chronicle;
      for (const { opens, returns: back } of CALLBACKS) {
        for (const page of book.filter((c) => c.eventId === back)) {
          returns += 1;
          const cause = causeOf(ctx, page.id!);
          const source = book.find((c) => c.id === cause?.page);
          expect(source?.eventId, `${back} in ${page.year} cites ${JSON.stringify(cause)}`).toBe(opens);
          expect(source!.year).toBeLessThan(page.year);
        }
      }
    }
    expect(returns).toBeGreaterThan(RUNS * CALLBACKS.length);
  });

  it('every story opens in the year of the decision that started it, about the person it was', () => {
    let opened = 0;
    for (const ctx of runs()) {
      const w = ctx.world;
      for (const instance of w.arcs.values()) {
        const callback = CALLBACKS.find((c) => c.arc === instance.arc);
        const first = instance.history[0];
        if (!callback || !first) continue;
        opened += 1;
        const at = `${instance.arc} started ${instance.startedYear} (seed ${w.seed})`;
        // The chronicler answers a Match inside the year; a player answers it
        // on the docket after the year's arcs have run, and its page lands the
        // following spring. The others open the year they happen.
        const lag = first.year - instance.startedYear;
        if (callback.opens === 'the_match_made') expect([0, 1], at).toContain(lag);
        else expect(lag, at).toBe(0);
        if (callback.opens === 'the_match_made') {
          const subject = w.people.get(instance.bindings.SUBJECT!)!;
          expect(subject.marriages.some((m) => m.spouse === instance.bindings.SPOUSE && m.from === instance.startedYear), at).toBe(true);
        } else if (callback.opens === 'the_waking_noticed') {
          expect(w.people.get(instance.bindings.WOKEN!)!.awakening.year, at).toBe(instance.startedYear);
        } else {
          // The term was bought that year: a living pupil has been taught by
          // the time the return is due, through the one completion loop.
          const back = instance.history[1];
          const pupil = w.people.get(instance.bindings.PUPIL!)!;
          if (back) expect(pupil.taught.length, at).toBeGreaterThan(0);
        }
      }
    }
    expect(opened).toBeGreaterThan(RUNS * CALLBACKS.length);
  });
});
