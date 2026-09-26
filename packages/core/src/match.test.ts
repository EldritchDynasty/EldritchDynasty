import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Person } from '@ed/schema';
import {
  CARDS_DEALT, dealMatch, declineMatch, matchFuture, matchSubjects, queueMatch, resolveMatch, takeCard,
  beget, bootstrap, genomeOf, hashSeed, loadGame, makeRng, marry, newGame, order, phase, place, runYears,
  saveGame, testRng, testWorld,
} from '@ed/core';
import type { MatchCard, SimCtx } from '@ed/core';

const bundle = loadContent();

/**
 * THE MATCH (concept §5, step 2) — the player draws one partner from three
 * cards.
 *
 * The assertions worth having here are all about the difference between a
 * card and a person. Two of three cards are declined every time this fires,
 * forty times a run, and a declined suitor who quietly became a woman living
 * in House Calder with a rolled genome and a claim on the frequency ration
 * would be invisible in every way that matters until the world was full of
 * people nobody chose.
 */

/** A world with a marriageable daughter of the seat and nobody else new. */
function withDaughter(seed = 4242) {
  const ctx = testWorld(bundle, seed, 1042);
  const her = place(ctx, { sex: 'female', age: 19, name: 'Test Daughter' });
  return { ctx, her };
}

/** A card made only of facts the Match is already allowed to show. */
function visibleCard(patch: Partial<MatchCard> = {}): MatchCard {
  return {
    id: 'card_test',
    kind: 'outsider',
    name: 'Dala',
    sex: 'female',
    age: 20,
    house: 'house_test',
    houseName: 'House Test',
    blurb: '',
    dowry: 40,
    kinship: 0,
    line: 'unknown',
    lineSeen: 0,
    words: '',
    papersAsked: 0,
    papersShown: 0,
    panel: { issue: [], woken: [], said: [], ourBook: [] },
    available: true,
    ...patch,
  };
}

describe('the future on a Match card (issue #214)', () => {
  it('makes blood legible from the family papers and the market\'s own words', () => {
    const reading = matchFuture(visibleCard({
      kind: 'household',
      kinship: 0.0625,
      words: 'close kin · deep blood · an ordinary line',
      line: 'ordinary',
      lineSeen: 3,
    }));

    expect(reading.kind).toBe('blood');
    expect(reading.confidence).toBe('clear');
    expect(reading.reasons.join(' ')).toMatch(/close kin|deep blood/);
  });

  it('makes continuity legible from observed issue rather than Fecundity', () => {
    const reading = matchFuture(visibleCard({
      line: 'fertile',
      lineSeen: 3,
      panel: {
        issue: [{ name: 'Cesse', relation: 'her mother', borne: 5, grown: 4 }],
        woken: [], said: [], ourBook: [],
      },
    }));

    expect(reading.kind).toBe('continuity');
    expect(reading.reasons.join(' ')).toContain('4 of 5 children');
  });

  it('uses social footprint for standing without pretending the accounts are true', () => {
    const reading = matchFuture(visibleCard({
      line: 'thin',
      lineSeen: 3,
      panel: {
        issue: [],
        woken: [],
        said: [
          { tale: 't_1', teller: 'one rival', bias: 'spite', text: 'one account' },
          { tale: 't_2', teller: 'another rival', bias: 'envy', text: 'another account' },
        ],
        ourBook: [{ year: 1180, text: 'an old page', embellished: false }],
      },
    }));

    expect(reading.kind).toBe('standing');
    expect(reading.reasons.join(' ')).toMatch(/circulating|our own book/);
  });

  it('calls a thin record a mystery instead of inventing a forecast', () => {
    const reading = matchFuture(visibleCard());
    expect(reading.kind).toBe('mystery');
    expect(reading.confidence).toBe('uncertain');
    expect(reading.reasons.join(' ')).toMatch(/no completed line|no issue/);
  });

  it('admits when two visible futures are genuinely tied', () => {
    const reading = matchFuture(visibleCard({
      kind: 'household',
      kinship: 0.0625,
      line: 'fertile',
      lineSeen: 3,
    }));
    expect(reading.kind).toBe('blood');
    expect(reading.confidence).toBe('mixed');
    expect(reading.competing).toBe('continuity');
  });

  it('does not manufacture three archetypes when two cards honestly read alike', () => {
    const a = visibleCard({
      id: 'a',
      kind: 'household',
      kinship: 0.0625,
      line: 'ordinary',
      lineSeen: 3,
      words: 'close kin · deep blood · an ordinary line',
    });
    const b = visibleCard({
      id: 'b',
      kind: 'household',
      kinship: 0.0625,
      line: 'ordinary',
      lineSeen: 3,
      words: 'close kin · deep blood · an ordinary line',
    });
    expect(matchFuture(a).kind).toBe('blood');
    expect(matchFuture(b).kind).toBe('blood');
  });

  it('cannot change its reading when only the outsider recipe changes', () => {
    const visible = visibleCard({
      line: 'fertile',
      lineSeen: 4,
      recipe: {
        template: 'suitor_common',
        house: 'house_test',
        sex: 'female',
        age: 20,
        name: 'Dala',
        seed: 1,
      },
    });
    const hiddenChanged: MatchCard = {
      ...visible,
      recipe: { ...visible.recipe!, seed: 987654321 },
    };

    expect(matchFuture(hiddenChanged)).toEqual(matchFuture(visible));
  });
});

describe('the deck', () => {
  it('deals a hand for blood of the seat', () => {
    const { ctx, her } = withDaughter();
    expect(matchSubjects(ctx).map((p) => p.id)).toContain(her.id);
  });

  it('does not deal for the married, the under-age, or a cadet hall', () => {
    const ctx = testWorld(bundle, 909, 1042);
    const child = place(ctx, { sex: 'female', age: 12, name: 'Too Young' });
    const cadet = place(ctx, { sex: 'male', age: 24, name: 'Of The Branch', branch: 'branch_test' });
    const wed = place(ctx, { sex: 'male', age: 24, name: 'Already Spoken For' });
    marry(ctx, wed, place(ctx, { sex: 'female', age: 23, name: 'His Wife' }));

    const subjects = matchSubjects(ctx).map((p) => p.id);
    expect(subjects, 'a twelve-year-old was offered a hand').not.toContain(child.id);
    expect(subjects, 'a cadet was offered a hand').not.toContain(cadet.id);
    expect(subjects, 'a married man was offered a hand').not.toContain(wed.id);
  });

  it('deals distinct recipes — never the same card three times', () => {
    const { ctx, her } = withDaughter();
    const offer = dealMatch(ctx, her, testRng('deck'));
    expect(offer.cards.length).toBeGreaterThan(1);
    expect(offer.cards.length).toBeLessThanOrEqual(CARDS_DEALT);

    const recipes = offer.cards.filter((c) => c.recipe).map((c) => c.recipe!.template);
    expect(new Set(recipes).size, 'the same recipe was dealt twice in one hand').toBe(recipes.length);
  });

  it('puts a cousin on the table when there is one', () => {
    const ctx = testWorld(bundle, 77, 1042);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Subject' });
    const cousin = place(ctx, { sex: 'male', age: 21, name: 'The Cousin' });

    const offer = dealMatch(ctx, her, testRng('cousin'));
    const household = offer.cards.filter((c) => c.kind === 'household');
    expect(household.length, 'no card from the house at all').toBe(1);
    expect(household[0]!.person).toBe(cousin.id);
    expect(household[0]!.dowry, 'nothing leaves the house for a cousin').toBe(0);
  });

  /**
   * The one that matters. `rollRecipe` reserves a name and nothing else; only
   * `takeCard` spawns anybody.
   */
  it('leaves the declined where they were — which is nowhere', () => {
    const { ctx, her } = withDaughter();
    const before = ctx.world.people.all().length;
    const offer = dealMatch(ctx, her, testRng('declined'));
    expect(ctx.world.people.all().length, 'dealing a hand created people').toBe(before);

    const taken = offer.cards.find((c) => c.kind === 'outsider' && c.available);
    expect(taken, 'no outsider card to take').toBeDefined();
    expect(takeCard(ctx, her.id, taken!).ok).toBe(true);

    const names = new Set(ctx.world.people.all().map((p) => p.name));
    expect(names, 'the taken card did not arrive').toContain(taken!.name);
    for (const c of offer.cards) {
      if (c === taken || c.kind === 'household') continue;
      expect(names, `${c.name} was declined and turned up anyway`).not.toContain(c.name);
    }
    expect(ctx.world.people.all().length, 'more than one person arrived').toBe(before + 1);
  });

  /**
   * REJECTED PEOPLE CAN COME BACK (issue #214), without making declined
   * outsider recipes into phantom people. A household card names somebody who
   * already exists; refusing one hand leaves that person in the world, so a
   * later member of the house can be offered the same named candidate.
   */
  it('can deal a rejected household candidate again to another member of the house', () => {
    const ctx = testWorld(bundle, 214, 1042);
    const first = place(ctx, { sex: 'female', age: 19, name: 'First Daughter' });
    const second = place(ctx, { sex: 'female', age: 20, name: 'Second Daughter' });
    const candidate = place(ctx, { sex: 'male', age: 21, name: 'The Road Not Taken' });

    const firstOffer = dealMatch(ctx, first, testRng('first-road'));
    expect(firstOffer.cards.some((c) => c.person === candidate.id)).toBe(true);
    const pending = queueMatch(ctx, firstOffer);
    expect(declineMatch(ctx, pending.id)).toBe(true);

    expect(ctx.world.people.get(candidate.id)?.name).toBe('The Road Not Taken');
    const laterOffer = dealMatch(ctx, second, testRng('second-road'));
    const returned = laterOffer.cards.find((c) => c.person === candidate.id);
    expect(returned, 'the rejected named candidate could never return').toBeDefined();
    expect(returned!.name).toBe('The Road Not Taken');
  });

  it('mints exactly the person the card promised', () => {
    const { ctx, her } = withDaughter(31);
    const offer = dealMatch(ctx, her, testRng('promise'));
    const card = offer.cards.find((c) => c.kind === 'outsider' && c.available)!;

    const res = takeCard(ctx, her.id, card);
    expect(res.ok).toBe(true);
    const spouse = res.spouse!;
    expect(spouse.name).toBe(card.name);
    expect(spouse.sex).toBe(card.sex);
    expect(spouse.houseOfOrigin).toBe(card.house);
    expect(ctx.world.year - spouse.born).toBe(card.age);
  });

  it('marries them through the one marriage path', () => {
    const { ctx, her } = withDaughter(5150);
    const offer = dealMatch(ctx, her, testRng('wed'));
    const card = offer.cards.find((c) => c.available)!;
    const res = takeCard(ctx, her.id, card);

    expect(res.ok).toBe(true);
    expect(her.marriages.some((m) => m.spouse === res.spouse!.id && !m.to)).toBe(true);
    expect(res.spouse!.marriages.some((m) => m.spouse === her.id && !m.to)).toBe(true);
  });
});

/**
 * THE SCION AND THE HEIR WIN THE SEASON'S ONE DEALT HAND (issue #61, Stages
 * A and E4). `MATCHES_PER_SEASON` is 1 — a real cap, not a formality — so
 * whichever of the pair the tiebreak favours is the ONLY one dealt to this
 * season, and this asserts the priority rather than merely that either can
 * ever win a tie.
 *
 * A GUARANTEED TIE, not a hoped-for one: `matchWeight` gives every expresser
 * the same 100 regardless of how strong, so copying the narrator's own
 * genome — canExpress at bootstrap, every seed this file uses (verified,
 * not assumed) — onto both candidates ties them exactly, without depending
 * on `place`'s own lazy roll landing on an expresser by chance.
 */
describe('the scion and the heir win the tie (issue #61)', () => {
  /** Both candidates canExpress, tied at matchWeight 100, by construction. */
  function tiedExpressers(ctx: SimCtx, nameA: string, nameB: string): [Person, Person] {
    const narrator = ctx.world.people.get(ctx.world.narrator!)!;
    const a = place(ctx, { sex: 'male', age: 24, name: nameA });
    const b = place(ctx, { sex: 'male', age: 24, name: nameB });
    for (const p of [a, b]) {
      p.genome = { kind: 'materialized', genome: genomeOf(narrator, ctx.genetics) };
      p.phenotype = undefined;
    }
    return [a, b];
  }

  it('the heir beats an untied ordinary cousin for the one hand', () => {
    const ctx = testWorld(bundle, 7118, 1042);
    const [heir, cousin] = tiedExpressers(ctx, 'The Heir', 'A Cousin');
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    const dealt = matchSubjects(ctx).map((p) => p.id);
    expect(dealt).toContain(heir.id);
    expect(dealt).not.toContain(cousin.id);
  });

  it('the Scion beats the heir when both are tied for it', () => {
    const ctx = testWorld(bundle, 7119, 1042);
    const [scion, heir] = tiedExpressers(ctx, 'The Scion', 'The Heir');
    expect(order(ctx, { kind: 'scion', person: scion.id }).ok).toBe(true);
    expect(order(ctx, { kind: 'scionHeir', person: heir.id }).ok).toBe(true);

    const dealt = matchSubjects(ctx).map((p) => p.id);
    expect(dealt).toContain(scion.id);
    expect(dealt).not.toContain(heir.id);
  });
});

describe('the dowry', () => {
  it('comes out of the treasury', () => {
    const { ctx, her } = withDaughter(8080);
    const offer = dealMatch(ctx, her, testRng('paid'));
    const card = offer.cards.find((c) => c.kind === 'outsider' && c.available)!;
    const before = ctx.world.treasury;

    takeCard(ctx, her.id, card);
    expect(ctx.world.treasury).toBeCloseTo(before - card.dowry, 6);
  });

  /**
   * Dealt, priced, and out of reach. A card the house cannot afford is listed
   * with its reason rather than filtered out — visible unavailability is
   * information, and "we could not raise it" is the kind of information this
   * game is about.
   */
  it('closes a card the house cannot raise, without hiding it', () => {
    const { ctx, her } = withDaughter(6060);
    ctx.world.treasury = -119;
    const offer = dealMatch(ctx, her, testRng('broke'));

    const priced = offer.cards.filter((c) => c.dowry > 0);
    expect(priced.length, 'nothing on this hand had a price').toBeGreaterThan(0);
    for (const c of priced) {
      expect(c.available, `${c.name} was affordable on an empty treasury`).toBe(false);
      expect(c.blockedBy).toMatch(/cannot raise/);
    }
    expect(takeCard(ctx, her.id, priced[0]!).ok, 'a closed card was taken anyway').toBe(false);
  });
});

describe('the match on the docket', () => {
  it('stops the clock until it is answered, and the chronicler can answer it', () => {
    const s = newGame(bundle, { seed: 1000, decider: 'ask' });
    let match;
    for (let i = 0; i < 60 && !match; i++) {
      match = s.advance(1).pending.find((d) => d.kind === 'match');
      if (!match && s.pending.length) s.letHimDecide();
    }
    expect(match, 'sixty years and no marriage was ever put to the player').toBeDefined();

    // INVARIANT 9: the docket blocks the clock.
    const stuck = s.year;
    s.advance(3);
    expect(s.year, 'the year turned with a match standing').toBe(stuck);

    const card = match!.kind === 'match' ? match!.cards.find((c) => c.available)! : undefined!;
    expect(s.match(match!.id, card.id).ok).toBe(true);
    expect(s.pending.find((d) => d.id === match!.id), 'the answered match is still standing').toBeUndefined();
    s.advance(1);
    expect(s.year).toBe(stuck + 1);
  });

  it('records the answer in the decision log', () => {
    const s = newGame(bundle, { seed: 1000, decider: 'chronicler' });
    s.advance(60);
    const matches = s.ctx.world.decisionLog.filter((d) => d.kind === 'match');
    expect(matches.length, 'sixty years of marriages and nothing logged').toBeGreaterThan(0);
    for (const m of matches) {
      if (m.kind !== 'match') continue;
      expect(m.subject).toBeTruthy();
      if (m.card) expect(m.spouse, 'a card was taken and no spouse recorded').toBeTruthy();
    }
  });

  it('answers the same way twice for the same seed', () => {
    const spouses = [0, 1].map(() => {
      const s = newGame(bundle, { seed: 4242, decider: 'chronicler' });
      s.advance(80);
      return s.ctx.world.decisionLog.filter((d) => d.kind === 'match').map((d) => JSON.stringify(d)).join('|');
    });
    expect(spouses[0]).toBe(spouses[1]);
    expect(spouses[0]!.length, 'no matches were drafted at all').toBeGreaterThan(0);
  });

  /**
   * A hand is a promise, and a promise has to survive being written down: two
   * of these three people do not exist, so re-dealing on load would answer the
   * player's question with different cards from the ones he was reading.
   */
  it('survives a save and a load with its cards intact', () => {
    const s = newGame(bundle, { seed: 1000, decider: 'ask' });
    let match;
    for (let i = 0; i < 60 && !match; i++) {
      match = s.advance(1).pending.find((d) => d.kind === 'match');
      if (!match && s.pending.length) s.letHimDecide();
    }
    expect(match).toBeDefined();

    const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(s.ctx))), bundle);
    const back = reloaded.world.pendingDecisions.find((d) => d.id === match!.id);
    expect(back).toBeDefined();
    expect(back).toEqual(match);

    // And it is still answerable on the other side.
    const card = back!.kind === 'match' ? back!.cards.find((c) => c.available)! : undefined!;
    const before = reloaded.world.people.all().length;
    expect(takeCard(reloaded, back!.kind === 'match' ? back!.subject.id : '', card).ok).toBe(true);
    if (card.kind === 'outsider') {
      expect(reloaded.world.people.all().length).toBe(before + 1);
    }
  });

  /**
   * A save written before the line read existed still loads, as a hand nobody
   * had a word for — which is exactly what those cards were. A required field
   * here would strand every run in progress on the version that added it.
   */
  it('loads a save written before the cards carried a line', () => {
    const s = newGame(bundle, { seed: 1000, decider: 'ask' });
    let match;
    for (let i = 0; i < 60 && !match; i++) {
      match = s.advance(1).pending.find((d) => d.kind === 'match');
      if (!match && s.pending.length) s.letHimDecide();
    }
    expect(match).toBeDefined();

    const raw = JSON.parse(JSON.stringify(saveGame(s.ctx)));
    const old = raw.pendingDecisions.find((d: { id: string }) => d.id === match!.id);
    for (const c of old.cards) {
      delete c.line;
      delete c.lineSeen;
    }

    const back = loadGame(raw, bundle).world.pendingDecisions
      .find((d) => d.id === match!.id);
    expect(back?.kind).toBe('match');
    for (const c of back!.kind === 'match' ? back!.cards : []) {
      expect(c.line, 'an old card came back claiming a read it never had').toBe('unknown');
      expect(c.lineSeen).toBe(0);
    }
  });
});

describe('the phase', () => {
  it('does not pair someone whose hand is standing', () => {
    // The marriage phase runs on years divisible by three.
    const ctx = testWorld(bundle, 1000, 1044);
    expect(ctx.world.year % 3).toBe(0);
    const her = place(ctx, { sex: 'female', age: 19, name: 'Left Standing' });

    phase('marriage', ctx, false);
    const standing = ctx.world.pendingDecisions.find((d) => d.kind === 'match'
      && d.subject.id === her.id);
    expect(standing, 'no hand was dealt for her').toBeDefined();
    expect(her.marriages.length, 'she was married while her own hand was on the table').toBe(0);
  });
});


/**
 * THE LINE'S READ (issue #28) — the only honest thing a marriage market can
 * say about fertility.
 *
 * Fecundity is heritable and weighted seventy-thirty toward the mother, so a
 * hand of cards is a bet on how many children a couple will have. Until this
 * landed, that bet was one the player could only settle by burying people. The
 * card now carries a word about the line, and every assertion here is about
 * the same thing from a different side: the word is read off births the world
 * has already watched, and never off a genome.
 */

/**
 * A wife who lived through the whole childbearing window and bore `kids`.
 *
 * Her children are placed at forty and up, which puts them outside the
 * sixteen-year window `householdCandidates` deals from — so a line can be as
 * full as the test likes without quietly stuffing the deck with cousins.
 */
function wife(ctx: SimCtx, name: string, kids: number, house?: string) {
  const her = place(ctx, { sex: 'female', age: 60, name, ...(house ? { house } : {}) });
  marry(ctx, her, place(ctx, { sex: 'male', age: 62, name: `${name} Husband` }));
  for (let i = 0; i < kids; i++) {
    beget(ctx, place(ctx, { sex: 'female', age: 40 + i, name: `${name} Kid ${i}` }), her);
  }
  return her;
}

/**
 * Twelve wives of three children each, which is the mean everything else on
 * the hand is read against. A fresh 1042 world has no completed lives at all —
 * the founders are alive and none of them is fifty — so without this the
 * honest answer to every card is `unknown`.
 */
function baseline(ctx: SimCtx) {
  for (let i = 0; i < 12; i++) wife(ctx, `Baseline ${i}`, 3);
}

/** A subject, one eligible cousin, and a mother for him with `kids` children. */
function withLine(kids: number, motherAge = 60) {
  const ctx = testWorld(bundle, 77, 1042);
  baseline(ctx);
  const her = place(ctx, { sex: 'female', age: 19, name: 'The Subject' });
  const cousin = place(ctx, { sex: 'male', age: 21, name: 'The Cousin' });

  const mother = place(ctx, { sex: 'female', age: motherAge, name: 'His Mother' });
  marry(ctx, mother, place(ctx, { sex: 'male', age: motherAge + 2, name: 'His Father' }));
  for (let i = 1; i < kids; i++) {
    beget(ctx, place(ctx, { sex: 'female', age: 40 + i, name: `His Sister ${i}` }), mother);
  }
  beget(ctx, cousin, mother);

  const offer = dealMatch(ctx, her, testRng('line'));
  const card = offer.cards.find((c) => c.kind === 'household');
  expect(card, 'no cousin was dealt, so there is no line to read').toBeDefined();
  expect(card!.person, 'the cousin dealt was not the one this test built').toBe(cousin.id);
  return { ctx, her, cousin, mother, card: card! };
}

describe('the line', () => {
  it('says nothing about a line the house has never watched', () => {
    const ctx = testWorld(bundle, 4242, 1042);
    baseline(ctx);
    const her = place(ctx, { sex: 'female', age: 19, name: 'A Daughter' });

    const strangers = dealMatch(ctx, her, testRng('strangers')).cards
      .filter((c) => c.kind === 'outsider');
    expect(strangers.length, 'no stranger on the hand at all').toBeGreaterThan(0);
    for (const c of strangers) {
      expect(c.line, `${c.name} came off a farm with a reputation`).toBe('unknown');
      expect(c.lineSeen, 'a read was built on nobody').toBe(0);
    }
  });

  it('reads a full line off a mother who bore many, and a thin one off a mother who bore few', () => {
    expect(withLine(8).card.line, 'eight children read as nothing special').toBe('fertile');
    expect(withLine(3).card.line, 'the population mean read as remarkable').toBe('ordinary');
    expect(withLine(1).card.line, 'one child read as an ordinary line').toBe('thin');
  });

  /**
   * A mother of forty may yet bear four more. Counting her now would call
   * every line thin for as long as the woman it was read off is still young
   * enough to disprove it.
   */
  it('counts only the lives that finished', () => {
    const young = withLine(1, 40);
    expect(young.card.lineSeen, 'a woman still of childbearing age was counted').toBe(0);
    expect(young.card.line).toBe('unknown');
  });

  /** Said out loud on the card, because one life is a rumour and eight are evidence. */
  it('says how many lives the word rests on', () => {
    expect(withLine(8).card.lineSeen, 'her mother alone, and the card should admit it').toBe(1);

    // Give him two sisters who finished their own childbearing, and the read
    // is built on three women instead of one.
    const ctx = testWorld(bundle, 77, 1042);
    baseline(ctx);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Subject' });
    const cousin = place(ctx, { sex: 'male', age: 21, name: 'The Cousin' });
    const mother = wife(ctx, 'His Mother', 0);
    beget(ctx, cousin, mother);
    for (let i = 0; i < 2; i++) {
      const sister = wife(ctx, `His Sister ${i}`, 6);
      beget(ctx, sister, mother);
    }

    const card = dealMatch(ctx, her, testRng('line')).cards.find((c) => c.kind === 'household')!;
    expect(card.person).toBe(cousin.id);
    expect(card.lineSeen, 'his married, finished sisters were not read').toBe(3);
  });

  /**
   * The card reads the documents everywhere else — `kinship` is `matchF`, which
   * a forged pedigree moves exactly as far as the forgery says. The line is the
   * same claim about the same world, so a bought mother buys her reputation too.
   */
  it('reads the record and not the blood', () => {
    const { ctx, her, cousin, card } = withLine(1);
    expect(card.line, 'the honest read was not thin to begin with').toBe('thin');

    const bought = wife(ctx, 'A Bought Mother', 8);
    cousin.claimedParents = { mother: bought.id };

    const forged = dealMatch(ctx, her, testRng('line')).cards.find((c) => c.kind === 'household')!;
    expect(forged.person).toBe(cousin.id);
    expect(forged.line, 'the forgery moved the papers and not the market').toBe('fertile');
  });

  /** Dealing a hand reads the world. It must not write to it. */
  it('costs the world nothing to read', () => {
    const ctx = testWorld(bundle, 77, 1042);
    baseline(ctx);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Subject' });
    place(ctx, { sex: 'male', age: 21, name: 'The Cousin' });
    const before = JSON.stringify(ctx.world.people.all().map((p) => [p.id, p.claimedParents]));

    dealMatch(ctx, her, testRng('line'));
    expect(JSON.stringify(ctx.world.people.all().map((p) => [p.id, p.claimedParents])))
      .toBe(before);
  });
});

/**
 * THE DILEMMA. `match.ts` has always carried a comment saying "the treasury is
 * the reason the answer is not always take the best card". Measured across one
 * run it was not true: 362 of 480 cards were priced at 20 crowns, 108 at
 * nothing, and cousins — which §7 calls *the mechanism*, not a temptation —
 * were on 12% of cards. Every hand was a stat comparison with nothing at stake
 * on either side of it.
 */
describe('the hand is a decision, not a comparison', () => {
  const content = loadContent();

  it('offers the house its own blood before it offers a stranger', () => {
    // Built rather than simulated. A cousin who exists is a fact; how often
    // one exists across six hands of a live run is a sample, and a threshold
    // asserted on a sample reports the sample (`record.slow.test.ts`, three
    // times over).
    const ctx = testWorld(bundle, 909);
    const grandfather = place(ctx, { sex: 'male', age: 70, name: 'Old Edric' });
    const uncleA = place(ctx, { sex: 'male', age: 45, name: 'Uncle A' });
    const uncleB = place(ctx, { sex: 'male', age: 44, name: 'Uncle B' });
    beget(ctx, uncleA, undefined, grandfather);
    beget(ctx, uncleB, undefined, grandfather);

    const subject = place(ctx, { sex: 'male', age: 20, name: 'The Heir' });
    const cousin = place(ctx, { sex: 'female', age: 19, name: 'The Cousin' });
    beget(ctx, subject, undefined, uncleA);
    beget(ctx, cousin, undefined, uncleB);

    const offer = dealMatch(ctx, subject, makeRng(4));
    const names = offer.cards.map((c) => c.name);
    expect(names, `the hand was ${names.join(', ')}`).toContain('The Cousin');
    expect(offer.cards.find((c) => c.name === 'The Cousin')!.kinship).toBeGreaterThan(0);
  });

  it('leads with the closest blood when there is more than one cousin', () => {
    const ctx = testWorld(bundle, 910);
    const grandfather = place(ctx, { sex: 'male', age: 74, name: 'Old Edric' });
    const great = place(ctx, { sex: 'male', age: 76, name: 'Old Osric' });
    const father = place(ctx, { sex: 'male', age: 48, name: 'Father' });
    const uncle = place(ctx, { sex: 'male', age: 46, name: 'Uncle' });
    const distant = place(ctx, { sex: 'male', age: 47, name: 'Distant' });
    beget(ctx, father, undefined, grandfather);
    beget(ctx, uncle, undefined, grandfather);
    beget(ctx, distant, undefined, great);

    const subject = place(ctx, { sex: 'male', age: 21, name: 'The Heir' });
    const first = place(ctx, { sex: 'female', age: 20, name: 'First Cousin' });
    const far = place(ctx, { sex: 'female', age: 20, name: 'Far Cousin' });
    beget(ctx, subject, undefined, father);
    beget(ctx, first, undefined, uncle);
    beget(ctx, far, undefined, distant);

    const offer = dealMatch(ctx, subject, makeRng(5));
    const kin = offer.cards.filter((c) => c.kind === 'household');
    expect(kin.length).toBeGreaterThan(0);
    // §7: the path to godhood runs through the thing that produces Madness,
    // and the house should be able to see how far down that path a card is.
    expect(kin[0]!.name).toBe('First Cousin');
  });

  it('charges a rich house like a rich house', () => {
    const poor = bootstrap(content, 733);
    runYears(poor, 60);
    const rich = bootstrap(content, 733);
    runYears(rich, 60);
    rich.world.treasury = 40_000;

    const subject = matchSubjects(poor)[0] ?? matchSubjects(rich)[0];
    if (!subject) return;
    const cheap = dealMatch(poor, subject, makeRng(1));
    const dear = dealMatch(rich, rich.world.people.mustGet(subject.id), makeRng(1));

    const ask = (o: { cards: { dowry: number }[] }) =>
      Math.max(0, ...o.cards.map((c) => c.dowry));
    // A treasury of forty thousand crowns must not make the marriage question
    // go away, which is exactly what a flat 20-crown dowry did.
    expect(ask(dear)).toBeGreaterThan(ask(cheap));
  });

  it('says what a broker would say, on every card', () => {
    const ctx = bootstrap(content, 515);
    runYears(ctx, 90);
    const subject = matchSubjects(ctx)[0];
    if (!subject) return;
    const offer = dealMatch(ctx, subject, makeRng(7));
    for (const card of offer.cards) {
      // §7's vocabulary is "never explained in text, learned from use", which
      // requires it to be somewhere a player can read it. It was nowhere.
      expect(card.words, `${card.name} came with nothing said about her`).not.toBe('');
    }
  });

  it('never deals a hand with no way out of the family', () => {
    const ctx = bootstrap(content, 616);
    runYears(ctx, 150);
    for (const subject of matchSubjects(ctx)) {
      const offer = dealMatch(ctx, subject, makeRng(3));
      if (offer.cards.length < 2) continue;
      const kin = offer.cards.filter((c) => c.kind === 'household').length;
      expect(kin).toBeLessThan(offer.cards.length);
    }
  });
});

/**
 * ISSUE #83 — A CARD DRAWN TAKEABLE IS A CARD `takeCard` WILL ACCEPT.
 *
 * Measured on seed 7 to 1400 before the fix: fifteen hands taken and sixteen
 * refusals of cards the client had drawn `available: true`. In five of those
 * hands every card refused, and the only control on the panel that did
 * anything was *Take none of them*.
 *
 * These assert the mechanism at each of the three moments the window opens,
 * because closing one of them looks exactly like closing all three from
 * outside: the panel is never wrong, the button simply does nothing.
 */
describe('a card drawn takeable is takeable', () => {
  /**
   * A daughter of the seat, a cousin she could marry, and the hand between
   * them — with every card forced open.
   *
   * A house founded in 1042 has no dead women and therefore no maternal
   * record, so `priceIn` shuts the whole hand on the papers before any of
   * this can be asked. That rule has its own tests; these are about what
   * happens to an OPEN card when the world moves under it.
   */
  function withCousin(seed = 8383) {
    const ctx = testWorld(bundle, seed, 1042);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Subject' });
    const him = place(ctx, { sex: 'male', age: 21, name: 'The Cousin' });
    const offer = dealMatch(ctx, her, makeRng(1));
    for (const c of offer.cards) {
      c.available = true;
      c.blockedBy = undefined;
      c.dowry = 0;
    }
    return { ctx, her, him, offer };
  }

  it('closes a card whose person married somebody else after the deal', () => {
    const { ctx, her, him, offer } = withCousin();
    const card = offer.cards.find((c) => c.person === him.id);
    if (!card) return;
    expect(card.available).toBe(true);

    // Behind the panel's back, exactly as `autoMarry` used to.
    const other = place(ctx, { sex: 'female', age: 20, name: 'Somebody Else' });
    marry(ctx, him, other);

    const pending = queueMatch(ctx, offer);
    phase('docket', ctx);

    expect(card.available).toBe(false);
    expect(card.blockedBy).toContain('The Cousin');
    // And the hand still stands, because the outsiders on it are unaffected.
    expect(ctx.world.pendingDecisions.map((d) => d.id)).toContain(pending.id);
  });

  it('withdraws a hand whose subject can no longer marry', () => {
    const { ctx, her, offer } = withCousin();
    const pending = queueMatch(ctx, offer);

    const someone = place(ctx, { sex: 'male', age: 25, name: 'Married Her First' });
    marry(ctx, her, someone);
    phase('docket', ctx);

    // Not "a hand of three shut cards and a working Decline" — no hand. The
    // docket blocks the clock, and stopping it to ask a question with one
    // legal answer is the thing this costs the player.
    expect(ctx.world.pendingDecisions.map((d) => d.id)).not.toContain(pending.id);
  });

  it('re-reads the rest of the docket when one hand spends another hand\'s subject', () => {
    const { ctx, him, offer } = withCousin(8384);

    // Two hands standing at once, which is the ordinary case: `matchSubjects`
    // deals every eligible member of the seat in the same phase, and the
    // cousin on one card is frequently the subject of the next.
    const hers = queueMatch(ctx, offer);
    const hisOffer = dealMatch(ctx, him, makeRng(2));
    const his = queueMatch(ctx, hisOffer);
    const card = hers.cards.find((c) => c.person === him.id);
    if (!card) return;

    expect(resolveMatch(ctx, hers.id, card.id).ok).toBe(true);

    // He is married now, so his own hand is not the hand it was — every card
    // in it would have refused with "On Both Hands cannot marry", and the
    // only working control on the panel would have been Decline.
    expect(ctx.world.pendingDecisions.map((d) => d.id)).not.toContain(his.id);
  });
});
