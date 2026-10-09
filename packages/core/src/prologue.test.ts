import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { HouseIdS, proseOriginalAt, proseOriginalHash, type SigningTerm } from '@ed/schema';
import {
  CAMPAIGNS, HOUSE_NAME_MAX, foundHouse, grudgeAgainstUs, heldHeirlooms, loadGame, newGame,
  prologueView, saveGame, setProseMode, setProseVariants, testWorld, viewOf,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const content = loadContent();

const CHOICE = {
  houseName: 'The House of Salt',
  heirloom: 'portion_of_agelessness',
  grudge: 'house_marrow',
};

function examinationBundle(given: SigningTerm[], owed: SigningTerm[]) {
  const prologue = content.prologue!;
  const neutralGiven: SigningTerm = { kind: 'treasury', amount: 20 };
  const neutralOwed: SigningTerm = { kind: 'treasury', amount: -20 };
  const answer = (
    id: string,
    benefit: SigningTerm[],
    cost: SigningTerm[],
    givenLine: string,
    owedLine: string,
  ) => ({
    id,
    says: id,
    given: givenLine,
    owed: owedLine,
    terms: { given: benefit, owed: cost },
  });
  return {
    ...content.bundle,
    prologue: [{
      ...prologue,
      examination: [{
        id: 'test_question',
        situation: 'The signing asks one measurable thing.',
        answers: [
          answer('chosen', given, owed, 'The house took the advantage.', 'The house accepted the cost.'),
          answer('other_one', [neutralGiven], [neutralOwed], 'Another advantage.', 'Another cost.'),
          answer('other_two', [neutralGiven], [neutralOwed], 'A third advantage.', 'A third cost.'),
        ],
      }],
    }],
  };
}

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
    expect(view.namePrompt).toContain('What are you called?');
    expect(view.examination).toHaveLength(4);
    expect(view.examination.every((question) => question.answers.length === 3)).toBe(true);
    expect(view.examination.flatMap((question) => question.answers)
      .every((answer) => !('terms' in answer))).toBe(true);
    expect(view.heirlooms.length).toBeGreaterThan(1);
    expect(view.grudges.length).toBeGreaterThan(1);
    // The option carries the object's own name and blurb, so a client never
    // has to look one up and never has to hold its own copy of the list.
    for (const option of view.heirlooms) expect(option.name.length).toBeGreaterThan(0);
    for (const option of view.grudges) expect(option.houseName.length).toBeGreaterThan(0);
    expect(view.thesis.length).toBeGreaterThan(0);
    expect(view.founded).toBeUndefined();
  });

  it('renders prologue and embedded content through stable Plain English addresses before interpolation', () => {
    const ctx = testWorld(content);
    setProseVariants(ctx, [
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].opening',
        plainenglish: 'A plain opening.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].triad[2].owed.campaignText',
        plainenglish: 'The term is {years} years and ends in {endYear}. {years} years of the line are promised.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].examination[id=the_ford].answers[id=own_back].says',
        plainenglish: 'I pushed the cart myself.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].heirlooms[0].line',
        plainenglish: 'He asked for more time.',
      },
      {
        address: 'content:heirlooms.yaml#heirlooms[id=portion_of_agelessness].name',
        plainenglish: 'More Years',
      },
      {
        address: 'content:heirlooms.yaml#heirlooms[id=portion_of_agelessness].blurb',
        plainenglish: 'It extends one life.',
      },
      {
        address: 'content:houses.yaml#houses[id=house_marrow].name',
        plainenglish: 'The Marrow family',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].grudges[0].line',
        plainenglish: 'Marrow remembers the field.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].thesis',
        plainenglish: 'Later generations did not sign the bargain.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].inheritedLine',
        plainenglish: '{house} is remembered by {teller}.',
      },
    ].map((variant) => ({
      ...variant,
      of: proseOriginalHash(proseOriginalAt(ctx.content, variant.address)!),
    })));
    setProseMode(ctx, 'plainenglish');
    ctx.world.libraryMemories = [{
      id: 'library_memory_plain',
      sourceRun: 'old',
      sourceHouse: 'House Salt',
      sourceYear: 1400,
      sourceText: 'The old page.',
      form: 'rhyme',
      teller: 'the children of the lower hall',
      bias: 'keeping what children remember',
      text: 'The remembered account.',
      about: 'library:old:page_1',
      since: ctx.world.year,
      mutations: 1,
      people: {},
      sourceClaims: [],
      claims: [],
    }];

    const view = prologueView(ctx)!;
    expect(view.opening).toBe('A plain opening.');
    expect(view.triad[2]!.owed).toBe(
      `The term is ${CAMPAIGNS.long.years} years and ends in ${CAMPAIGNS.long.endYear}. ${CAMPAIGNS.long.years} years of the line are promised.`,
    );
    expect(view.examination[0]!.answers[0]!.says).toBe('I pushed the cart myself.');

    const heirloom = view.heirlooms.find((option) => option.heirloom === 'portion_of_agelessness');
    expect(heirloom).toMatchObject({
      name: 'More Years',
      blurb: 'It extends one life.',
      line: 'He asked for more time.',
    });

    const grudge = view.grudges.find((option) => option.house === 'house_marrow');
    expect(grudge).toMatchObject({
      houseName: 'The Marrow family',
      line: 'Marrow remembers the field.',
    });
    expect(view.thesis).toBe('Later generations did not sign the bargain.');
    expect(view.inherited?.line).toBe(
      'House Salt is remembered by the children of the lower hall.',
    );
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
      line: content.prologue!.inheritedLine!
        .replaceAll('{house}', 'House Ash')
        .replaceAll('{teller}', 'an unnamed annotator in Ilm\'s library'),
    });
    const line = prologueView(ctx)!.inherited!.line;
    expect(line).toContain('House Ash');
    expect(line).toContain('an unnamed annotator in Ilm\'s library');
    expect(line).not.toMatch(/\{(house|teller)\}/);
  });

  it('shows no inherited account in no one\'s voice when the bundle authors no wrapper', () => {
    const { inheritedLine: _unwritten, ...unwrapped } = content.prologue!;
    const ctx = testWorld({ ...content.bundle, prologue: [unwrapped] });
    ctx.world.libraryMemories = [{
      id: 'library_memory_a',
      sourceRun: 'old',
      sourceHouse: 'House Salt',
      sourceYear: 1400,
      sourceText: 'The page.',
      form: 'rhyme',
      teller: 'the children of a lower hall',
      bias: 'keeping what children remember',
      text: 'The rhyme.',
      about: 'library:old:page_1',
      since: ctx.world.year,
      mutations: 0,
      people: {},
      sourceClaims: [],
      claims: [],
    }];
    expect('inherited' in prologueView(ctx)!).toBe(false);
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

  it('applies every founding-state Examination term exactly once and writes the answer', () => {
    const ctx = testWorld(examinationBundle(
      [
        { kind: 'treasury', amount: 60 },
        { kind: 'respect', steps: 1 },
        { kind: 'loyalty', retainer: 'tutor', amount: 20 },
        { kind: 'grudge', house: HouseIdS.parse(content.house('house_calder')!.id), severity: 30, inheritance: 'heir_only' },
      ],
      [
        { kind: 'treasury', amount: -40 },
        { kind: 'loyalty', retainer: 'steward', amount: -10 },
        { kind: 'dismiss', retainer: 'midwife' },
      ],
    ));
    const tutor = ctx.world.people.all().find((person) => person.name === 'Osric')!;
    const midwife = ctx.world.people.all().find((person) => person.name === 'Hesper')!;
    const steward = ctx.world.people.all().find((person) => person.name === 'Bertram')!;
    const beforeTreasury = ctx.world.treasury;

    expect(foundHouse(ctx, {
      ...CHOICE,
      answers: { test_question: 'chosen' },
    }).ok).toBe(true);

    expect(ctx.world.treasury).toBe(beforeTreasury + 20);
    expect(ctx.world.respect).toBe('regarded');
    expect(ctx.world.respectChanged).toBe(ctx.world.year);
    expect(tutor.contract?.loyalty).toBe(98);
    expect(steward.contract?.loyalty).toBe(45);
    expect(midwife.contract).toBeUndefined();
    expect(midwife.membership.find((m) => m.kind === 'retainer')?.to).toBe(ctx.world.year);

    const calder = [...ctx.world.relationships.values()].find((relationship) =>
      ctx.world.people.get(relationship.from)?.houseOfOrigin === 'house_calder'
        && relationship.grudges.some((grudge) => grudge.severity === 30 && grudge.inheritance === 'heir_only'),
    );
    expect(calder).toBeDefined();
    const signingPage = ctx.world.chronicle.find((entry) => entry.title === 'What Was Asked For');
    expect(signingPage?.text).toContain(
      'The house took the advantage; The house accepted the cost.',
    );
  });

  it('validates all Examination state references before mutating the founding', () => {
    const ctx = testWorld(examinationBundle(
      [{ kind: 'treasury', amount: 60 }],
      [{ kind: 'dismiss', retainer: 'not_a_retainer' }],
    ));
    const beforeTreasury = ctx.world.treasury;
    const beforeChronicle = ctx.world.chronicle.length;

    const result = foundHouse(ctx, { ...CHOICE, answers: { test_question: 'chosen' } });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not_a_retainer');
    expect(ctx.world.treasury).toBe(beforeTreasury);
    expect(ctx.world.founding).toBeUndefined();
    expect(ctx.world.chronicle).toHaveLength(beforeChronicle);
    expect(heldHeirlooms(ctx).map((h) => h.id)).not.toContain('portion_of_agelessness');
  });

  it('happens once', () => {
    const ctx = testWorld(content);
    expect(foundHouse(ctx, CHOICE).ok).toBe(true);
    expect(foundHouse(ctx, { ...CHOICE, houseName: 'A Second Thought' }).ok).toBe(false);
    expect(ctx.world.founding?.houseName).toBe('The House of Salt');
  });

  it('logs the validated founding answer once, and never logs a refusal', () => {
    const refused = testWorld(content);
    expect(foundHouse(refused, { ...CHOICE, houseName: '   ' }).ok).toBe(false);
    expect(refused.world.decisionLog).toEqual([]);

    const ctx = testWorld(content);
    const choice = {
      ...CHOICE,
      houseName: '  The   House of Salt  ',
      friends: [
        { name: '  Iona  Vale ', sex: 'female' as const },
        { name: 'Corven Pike', sex: 'male' as const },
      ],
    };
    expect(foundHouse(ctx, choice).ok).toBe(true);
    expect(ctx.world.decisionLog).toEqual([{
      kind: 'founding',
      year: 1042,
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      friends: [
        { name: 'Iona Vale', sex: 'female' },
        { name: 'Corven Pike', sex: 'male' },
      ],
    }]);
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
      answers: {},
      year: 1042,
    });
    expect(prologueView(resumed)!.founded?.houseName).toBe('The House of Salt');
  });
});


describe('the founding readback speaks the reader\'s language (#772)', () => {
  const base = '{OBJECT} was asked for by name, and given. {HOUSE} paid for part of that night and has not been paid back, and the house has known it the whole time.';
  const examined = base + ' {EXAMINATION}';
  const plainBase = '{OBJECT} was requested by name and given. {HOUSE} paid part of the price that night and has never been repaid. The family has always known this.';
  const plainExamined = plainBase + ' {EXAMINATION}';
  const variants = [
    { address: coreMessageAddress('founding.readback_title'),
      of: proseOriginalHash('What Was Asked For'), plainenglish: 'What the Family Was Asked to Give' },
    { address: coreMessageAddress('founding.readback'),
      of: proseOriginalHash(base), plainenglish: plainBase },
    { address: coreMessageAddress('founding.readback_with_examination'),
      of: proseOriginalHash(examined), plainenglish: plainExamined },
  ];

  function found(mode: 'original' | 'plainenglish', withExamination: boolean) {
    const source = withExamination
      ? examinationBundle([{ kind: 'treasury', amount: 60 }], [{ kind: 'treasury', amount: -40 }])
      : content;
    const ctx = testWorld(source, 7720);
    setProseVariants(ctx, variants);
    setProseMode(ctx, mode);
    const choice = withExamination
      ? { ...CHOICE, answers: { test_question: 'chosen' } }
      : CHOICE;
    expect(foundHouse(ctx, choice).ok).toBe(true);
    const page = ctx.world.chronicle.find((entry) =>
      entry.weight === 'page' && (entry.title === 'What Was Asked For' || entry.title === 'What the Family Was Asked to Give'));
    expect(page, 'a successful founding must write its readback').toBeDefined();
    return { ctx, page: page! };
  }

  for (const hasAnswers of [false, true]) {
    it(`preserves the whole Original and translates the ${hasAnswers ? 'Examination' : 'ordinary'} readback without moving choices`, () => {
      const original = found('original', hasAnswers);
      const plain = found('plainenglish', hasAnswers);
      expect(original.page.title).toBe('What Was Asked For');
      expect(plain.page.title).toBe('What the Family Was Asked to Give');
      const m = original.page.text!.match(/^(.*?) was asked for by name, and given\. (.*?) paid for part of that night and has not been paid back, and the house has known it the whole time\./);
      expect(m, 'Original founding copy changed').toBeTruthy();
      const suffix = hasAnswers ? ' The house took the advantage; The house accepted the cost.' : '';
      expect(original.page.text).toBe(`${m![1]} was asked for by name, and given. ${m![2]} paid for part of that night and has not been paid back, and the house has known it the whole time.${suffix}`);
      expect(plain.page.text).toBe(`${m![1]} was requested by name and given. ${m![2]} paid part of the price that night and has never been repaid. The family has always known this.${suffix}`);
      expect(plain.ctx.world.founding).toEqual(original.ctx.world.founding);
      expect(plain.ctx.world.decisionLog).toEqual(original.ctx.world.decisionLog);
      expect(plain.ctx.world.treasury).toEqual(original.ctx.world.treasury);
      const frozen = plain.page.text;
      setProseMode(plain.ctx, 'original');
      expect(plain.page.text).toBe(frozen);
      const loaded = loadGame(saveGame(plain.ctx), hasAnswers ? examinationBundle([{ kind: 'treasury', amount: 60 }], [{ kind: 'treasury', amount: -40 }]) : content);
      expect(loaded.world.chronicle.find((entry) => entry.weight === 'page' && entry.title === plain.page.title)?.text).toBe(frozen);
    });
  }
});
