import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { COLLATERAL_KEPT, KEEP_YEARS, collateralKept, digest, newGame, resumeGame } from '@ed/core';

const bundle = loadContent();

/**
 * THE COLLATERAL KEPT, INSIDE A PLAYED RUN (#1993).
 *
 * `collateral.test.ts` builds each state the rule tells apart. This plays one
 * Short Line where the shipped chronicler reaches the keeping, and asks the two
 * questions only a played run can answer. Does it happen before the first
 * interlude, through the ordinary year? Does a save taken just before, on, or
 * just after the firing year resume into exactly the house an unbroken run
 * reaches?
 *
 * The seed is a witness, not a rate. It is the first seed at or after
 * `FROM` whose chronicler run reaches the keeping. The search is bounded, so a
 * rule change that stops the keeping from firing anywhere fails loudly here
 * instead of passing on a run that never reached it. The rate the rule buys is
 * `npm run gate:line-breaks`, recorded in `docs/BALANCE-LOG.md` under #1993.
 */
const FROM = 1993;
const SEARCH = 60;

/** The first year the keeping fired in this seed's Short Line, if it did before the frame. */
function firingYear(seed: number): number | undefined {
  const g = newGame(bundle, { seed, decider: 'chronicler', campaign: 'short' });
  for (let y = 0; y < 300; y++) {
    if (g.ctx.world.ending || g.ctx.world.frame.entries.length) return undefined;
    if (g.advance(1).years[0]?.assize?.kept) return g.ctx.world.year;
  }
  return undefined;
}

function witness(): { seed: number; at: number } {
  for (let seed = FROM; seed < FROM + SEARCH; seed++) {
    const at = firingYear(seed);
    if (at !== undefined) return { seed, at };
  }
  throw new Error(`no chronicler Short Line in seeds ${FROM}–${FROM + SEARCH - 1} reached the keeping`);
}

describe('the collateral kept, in a played Short Line', () => {
  const { seed, at } = witness();
  const after = at + KEEP_YEARS + 2;

  /** Play to `year`, through the session the client uses. */
  function playTo(year: number) {
    const g = newGame(bundle, { seed, decider: 'chronicler', campaign: 'short' });
    g.advance(year - g.ctx.world.year);
    return g;
  }

  it('fires once, before any interlude, and writes its page', () => {
    const g = playTo(after);
    const w = g.ctx.world;
    expect(w.assize.fired[COLLATERAL_KEPT]).toBe(at);
    const firstInterlude = w.frame.entries[0]?.year;
    if (firstInterlude !== undefined) expect(firstInterlude).toBeGreaterThan(at);
    expect(w.chronicle.filter((page) => page.year === at && page.text?.includes('weighers'))).toHaveLength(1);
  });

  it.each([-1, 0, 1])('resumes a save taken %i years from the firing into the same house', (offset) => {
    const unbroken = playTo(after);
    const stopped = playTo(at + offset);
    const resumed = resumeGame(JSON.parse(JSON.stringify(stopped.save())), bundle);
    if (offset >= 1) expect(collateralKept(resumed.ctx)).toBe(true);
    resumed.advance(after - resumed.ctx.world.year);
    expect(resumed.ctx.world.year).toBe(unbroken.ctx.world.year);
    expect(digest(resumed.save())).toBe(digest(unbroken.save()));
  });
});
