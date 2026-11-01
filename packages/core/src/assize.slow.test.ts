import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  ASSIZE_RESPONSES, COLLATERAL_KEPT, KEEP_YEARS, armOf, assizeFavour, assizePressure, collateralKept,
  digest, measureFortune, newGame, phase, place, resumeGame, testWorld,
} from '@ed/core';
import { CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();
/**
 * THE ASSIZE, MEASURED OVER WHOLE RUNS.
 *
 * Whether the world acts about once a generation, and from its whole range,
 * is only answerable by running one. How it reads a house and what it does
 * about it are answerable against a built world, and stay in `assize.test.ts`.
 */
describe('across a whole run', () => {
  it('acts about once a generation, from the whole range of what it can do', () => {
    const g = newGame(loadContent(), { seed: 3000, decider: 'chronicler' });
    let sittings = 0;
    const used = new Set<string>();
    for (let y = 0; y < CAMPAIGN_YEARS; y++) {
      const acted = g.advance(1).years[0]?.assize?.acted;
      if (!acted) continue;
      sittings += 1;
      used.add(acted.id);
    }
    // A world that acts twice in a Long Line is not reacting to anything.
    expect(sittings).toBeGreaterThan(15);
    // A world with three moves is one the player has read by the fourth century.
    expect(used.size).toBeGreaterThan(7);
  });

  it('survives the round trip, cooldowns and all', () => {
    const g = newGame(loadContent(), { seed: 3003, decider: 'chronicler' });
    g.advance(400);
    const save = g.save();
    expect(save.assize.fired).toEqual(g.ctx.world.assize.fired);
    expect(save.assize.openedAt).toBe(1042);

    // A load that forgot the cooldowns would let a reloaded run be assessed
    // twice in one decade, and would drop any physician still in the house.
    const back = resumeGame(save, loadContent());
    expect(back.ctx.world.assize).toEqual(g.ctx.world.assize);
  });
});

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

  /**
   * Play to `year`, a year at a time, through the session the client uses.
   * A year at a time on both sides because the decision log records each
   * `advance` command as it was given: `advance(40)` and forty `advance(1)`
   * reach the same world and different logs, so their digests differ.
   */
  function playTo(year: number) {
    const g = newGame(bundle, { seed, decider: 'chronicler', campaign: 'short' });
    while (g.year < year && !g.ctx.world.ending) g.advance(1);
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
    const resumed = resumeGame(JSON.parse(JSON.stringify(stopped.save())), bundle, { decider: 'chronicler' });
    if (offset >= 1) expect(collateralKept(resumed.ctx)).toBe(true);
    while (resumed.year < unbroken.year && !resumed.ctx.world.ending) resumed.advance(1);
    expect(resumed.year).toBe(unbroken.year);
    expect(digest(resumed.save())).toBe(digest(unbroken.save()));
  });
});
