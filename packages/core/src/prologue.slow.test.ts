import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { heldHeirlooms, loadGame, newGame, prologueView, saveGame, END_YEAR } from '@ed/core';

const content = loadContent();

const CHOICE = {
  houseName: 'The House of Salt',
  heirloom: 'portion_of_agelessness',
  grudge: 'house_marrow',
};

/**
 * THE TWO CHOICES, CENTURIES LATER — issue #38's acceptance, run rather than
 * asserted.
 *
 * Both are supposed to be simulation inputs and not flavour, and both fail
 * silently if they are not: an heirloom that quietly leaves the house and a
 * grudge whose last holder dies without a successor each look exactly like a
 * working system, for centuries, from the outside. Every feud in this game
 * used to die that way — measured, live grudges at 2042: zero.
 */
describe('the signing, centuries on', () => {
  // 1042's own line breaks in 1132 under the corrected blood count (issue
  // #42), inside this file's 900-year window. 910 survived that fix but
  // broke its own line at 1133 once issue #27's fortune-shaped fertility
  // landed on `main`; 901 is confirmed to clear the full thousand years
  // against the current `main`.
  const g = newGame(content, { seed: 901, decider: 'chronicler' });
  g.found(CHOICE);

  g.advance(300);
  const atThree = [...g.ctx.world.relationships.values()]
    .filter((r) => r.grudges.some((x) => x.originEvent === 'the_signing'));

  g.advance(END_YEAR - g.year);

  it('is still holding the thing the man asked for', () => {
    expect(g.year).toBe(END_YEAR);
    expect(heldHeirlooms(g.ctx).map((h) => h.id)).toContain('portion_of_agelessness');
  });

  /**
   * Three centuries is four or five generations, and the rival's side of this
   * has changed hands every one of them — which is the half that silently did
   * not work for every feud in the game until `tickRelationships` learned to
   * re-point a dead holder, and the reason the founding grudge is authored
   * `house_wide`: any narrower policy is deleted the first year that house has
   * nobody minted and alive.
   *
   * It is deliberately not "still live in 1942". `addGrudge` decays severity
   * on purpose, and a founding slight that never faded would make every later
   * feud in the game weightless.
   *
   * OUR side does not change hands, and that is not a bug: the grudge is
   * against the man who signed, and the man who signed is the guardian and
   * does not die (invariant 3). It is the one edge in the world with a
   * permanent target.
   */
  it('changed hands on the rival side, and never on ours', () => {
    expect(atThree.length, 'the first grudge did not survive three centuries').toBeGreaterThan(0);

    for (const edge of atThree) {
      const holder = g.ctx.world.people.get(edge.from);
      const against = g.ctx.world.people.get(edge.to);
      expect(holder?.born ?? 0, 'nobody alive is holding it').toBeGreaterThan(1042);
      expect(against?.houseOfOrigin).toBe(g.ctx.world.playerHouse);
      expect(against?.status === 'alive' || against?.status === 'guardian').toBe(true);
    }
  });

  it('is readable off the save at the Long-Line term', () => {
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(g.ctx))), content);

    expect(resumed.world.year).toBe(END_YEAR);
    expect(prologueView(resumed)!.founded).toEqual({ ...CHOICE, year: 1042 });
    expect(resumed.world.founding?.houseName).toBe('The House of Salt');
  });
});
