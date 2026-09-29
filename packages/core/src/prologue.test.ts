import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  CAMPAIGNS, HOUSE_NAME_MAX, foundHouse, grudgeAgainstUs, heldHeirlooms, loadGame, newGame,
  prologueView, saveGame, testWorld, viewOf,
} from '@ed/core';

const content = loadContent();

const CHOICE = {
  houseName: 'The House of Salt',
  heirloom: 'portion_of_agelessness',
  grudge: 'house_marrow',
};

/**
 * THE SIGNING (concept §3, issue #38).
 *
 * The two choices are not flavour. The founding gift goes into
 * `world.heirlooms`, where the ladder and the auction can both see it; the
 * first grudge is a `Relationship` edge that `grudgeAgainstUs` reads for a
 * thousand years. The failure this file is written against is the one this
 * repository fails by: a prologue that collects two answers, writes them into
 * a field nothing reads, and looks exactly like a prologue that works.
 */
describe('the prologue', () => {
  it('offers the triad, both choices, and the objects behind them', () => {
    const view = prologueView(testWorld(content))!;

    expect(view.triad).toHaveLength(3);
    expect(view.heirlooms.length).toBeGreaterThan(1);
    expect(view.grudges.length).toBeGreaterThan(1);
    // The option carries the object's own name and blurb, so a client never
    // has to look one up and never has to hold its own copy of the list.
    for (const option of view.heirlooms) expect(option.name.length).toBeGreaterThan(0);
    for (const option of view.grudges) expect(option.houseName.length).toBeGreaterThan(0);
    expect(view.thesis.length).toBeGreaterThan(0);
    expect(view.founded).toBeUndefined();
  });

  it('carries the furthest-travelled inherited account without adjudicating it', () => {
    const ctx = testWorld(content);
    ctx.world.libraryMemories = [
      {
        id: 'library_memory_b',
        sourceRun: 'old_b',
        sourceHouse: 'House Salt',
        sourceYear: 1420,
        sourceText: 'The older page.',
        form: 'song',
        teller: 'the household singers of Marrow',
        bias: 'keeping the version Marrow prefers to remember',
        text: 'The singers say the east tower was empty.',
        about: 'library:old_b:page_1',
        since: ctx.world.year,
        mutations: 1,
        people: {},
        sourceClaims: [],
        claims: [],
      },
      {
        id: 'library_memory_a',
        sourceRun: 'old_a',
        sourceHouse: 'House Ash',
        sourceYear: 1510,
        sourceText: 'Another old page.',
        form: 'footnote',
        teller: 'an unnamed annotator in Ilm\'s library',
        bias: 'correcting the old house from the safety of Ilm\'s margin',
        text: 'The margin says the west tower was locked.',
        about: 'library:old_a:page_2',
        since: ctx.world.year,
        mutations: 4,
        people: {},
        sourceClaims: [],
        claims: [],
      },
    ];

    expect(prologueView(ctx)!.inherited).toEqual({
      houseName: 'House Ash',
      teller: 'an unnamed annotator in Ilm\'s library',
      bias: 'correcting the old house from the safety of Ilm\'s margin',
      text: 'The margin says the west tower was locked.',
      line: 'There was an older telling already abroad, out of House Ash, kept now in the voice of an unnamed annotator in Ilm\'s library; it is set down here as that voice gives it, and no hand in this room is made judge of the account.',
    });
  });

  it('breaks equally travelled inherited accounts by id, without a draw', () => {
    const ctx = testWorld(content);
    const memory = (id: string, text: string) => ({
      id,
      sourceRun: 'old',
      sourceHouse: 'House Salt',
      sourceYear: 1400,
      sourceText: 'The page.',
      form: 'rhyme' as const,
      teller: 'the children of a lower hall',
      bias: 'keeping what children remember',
      text,
      about: `library:old:${id}`,
      since: ctx.world.year,
      mutations: 3,
      people: {},
      sourceClaims: [],
      claims: [],
    });
    ctx.world.libraryMemories = [
      memory('library_memory_z', 'The later id.'),
      memory('library_memory_a', 'The earlier id.'),
    ];

    expect(prologueView(ctx)!.inherited?.text).toBe('The earlier id.');
  });

  it('leaves the empty-Library prologue shape exactly as it was', () => {
    const view = prologueView(testWorld(content))!;
    expect('inherited' in view).toBe(false);
    const { inherited: _nothing, ...preFeature } = view;
    expect(view).toStrictEqual(preFeature);
  });

  it('states the selected campaign term and collection year in the signing', () => {
    for (const campaign of Object.values(CAMPAIGNS)) {
      const ctx = testWorld(content);
      ctx.world.campaign = campaign.id;
      const term = prologueView(ctx)!.triad[2]!.owed;

      expect(term, campaign.id).toContain(`${campaign.years} years`);
      expect(term, campaign.id).toContain(String(campaign.endYear));
    }

    const short = testWorld(content);
    short.world.campaign = 'short';
    expect(prologueView(short)!.triad[2]!.owed).not.toContain(`${CAMPAIGNS.long.years} years`);
  });

  it('puts the founding gift in the house and the grudge in the world', () => {
    const ctx = testWorld(content);
    const before = grudgeAgainstUs(ctx.world);

    expect(foundHouse(ctx, CHOICE).ok).toBe(true);

    expect(heldHeirlooms(ctx).map((h) => h.id)).toContain('portion_of_agelessness');
    expect(grudgeAgainstUs(ctx.world)).toBeGreaterThan(before);
    // Held BY somebody of theirs, AGAINST somebody of ours — both ends
    // people, which is what makes it survive `tickRelationships`.
    const edge = [...ctx.world.relationships.values()].find(
      (r) => ctx.world.people.get(r.from)?.houseOfOrigin === 'house_marrow'
        && r.grudges.some((g) => g.originEvent === 'the_signing'),
    );
    expect(edge?.grudges.length).toBeGreaterThan(0);
    expect(ctx.world.people.get(edge!.to)?.houseOfOrigin).toBe(ctx.world.playerHouse);
  });

  it('gives the house the name the player gave it', () => {
    const ctx = testWorld(content);
    foundHouse(ctx, CHOICE);

    expect(ctx.world.founding?.houseName).toBe('The House of Salt');
    expect(viewOf(ctx).houseName).toBe('The House of Salt');
  });

  it('writes what was asked for into the book, where the creditor will read it', () => {
    const ctx = testWorld(content);
    foundHouse(ctx, CHOICE);

    const page = ctx.world.chronicle.at(-1)!;
    expect(page.year).toBe(ctx.world.year);
    expect(page.text).toContain('A Portion of Agelessness');
    expect(page.text).toContain('House Marrow');
  });

  it('refuses anything the prologue did not offer, and says why', () => {
    const ctx = testWorld(content);

    expect(foundHouse(ctx, { ...CHOICE, heirloom: 'the_ninefold_seal' }).ok).toBe(false);
    expect(foundHouse(ctx, { ...CHOICE, grudge: 'commons' }).ok).toBe(false);
    expect(foundHouse(ctx, { ...CHOICE, houseName: '   ' }).ok).toBe(false);
    expect(foundHouse(ctx, { ...CHOICE, houseName: 'x'.repeat(HOUSE_NAME_MAX + 1) }).ok).toBe(false);
    // None of the four refusals put anything in the house.
    expect(ctx.world.founding).toBeUndefined();
    expect(heldHeirlooms(ctx).map((h) => h.id)).not.toContain('portion_of_agelessness');

    const refusal = foundHouse(ctx, { ...CHOICE, heirloom: 'the_ninefold_seal' });
    expect(refusal.reason?.length).toBeGreaterThan(0);
  });

  it('happens once', () => {
    const ctx = testWorld(content);
    expect(foundHouse(ctx, CHOICE).ok).toBe(true);
    expect(foundHouse(ctx, { ...CHOICE, houseName: 'A Second Thought' }).ok).toBe(false);
    expect(ctx.world.founding?.houseName).toBe('The House of Salt');
  });

  /**
   * ISSUE #38'S ACCEPTANCE: "the two choices are readable off the save nine
   * hundred years later". A field the save format forgets resets silently on
   * load, which looks exactly like a subsystem that stopped working two
   * centuries in. The nine hundred years themselves are in
   * `prologue.slow.test.ts`, where a suite that plays a game belongs.
   */
  it('is readable off the save', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    g.found(CHOICE);
    g.advance(200);

    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(g.ctx))), content);

    expect(resumed.world.founding).toEqual({
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      year: 1042,
    });
    expect(prologueView(resumed)!.founded?.houseName).toBe('The House of Salt');
  });
});
