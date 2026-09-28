import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { testWorld, place, marry, beget } from './testing.js';
import { readPanel, emptyPanel } from './people/panel.js';
import { dealMatch, type MatchCard, type LineCensus } from './people/match.js';
import { makeRng } from './rng.js';

/**
 * THE MATCHMAKER'S PANEL (issue #68).
 *
 * What is asserted here is the RULE the panel is built on, which is not "the
 * rows are correct" but "no row on it could have come from a genome". A panel
 * that quietly printed a Fecundity would pass every test about row counts and
 * end §7's marriage market in one line, and the failure would look exactly
 * like a working panel.
 *
 * So: every number is traced back to a birth somebody counted, a waking
 * somebody attended, or a sentence somebody wrote down with their name on it —
 * by building a world where the observable and the true DISAGREE, and reading
 * the panel to see which one it printed.
 *
 * The batch half is `packages/core/src/tools/blood-gate.ts`, whose `blind` and
 * `panel` columns play forty runs each and differ in exactly one comparator.
 */

const content = indexContent(loadContent());

/** A card for someone already in the world, with nothing read onto it yet. */
function cardFor(person: { id: string; name: string; sex: 'male' | 'female'; houseOfOrigin: string }): MatchCard {
  return {
    id: 'card_1',
    kind: 'household',
    name: person.name,
    sex: person.sex,
    age: 20,
    house: person.houseOfOrigin,
    houseName: person.houseOfOrigin,
    blurb: '',
    dowry: 0,
    kinship: 0,
    line: 'unknown',
    lineSeen: 0,
    words: '',
    papersAsked: 0,
    papersShown: 0,
    person: person.id,
    available: true,
    panel: emptyPanel(),
  };
}

/**
 * An empty census, for the cases that are about the wakings rather than the
 * issue. `lineCensus` is an implementation detail of dealing a hand, so the
 * one test that needs real issue rows builds the census it means and the case
 * that needs a real hand deals one.
 */
function census(): LineCensus {
  return { borne: new Map(), counted: new Set(), byHouse: new Map(), mean: 0 };
}

describe('the matchmaker’s panel', () => {
  /**
   * THE ONE THAT MATTERS. A woman whose father woke and a woman whose father
   * did not, with everything else about them identical. The panel separates
   * them; nothing on the card ever could, because both cards say the same
   * house, the same age and the same word.
   */
  it('names the kin the world watched wake, and only those', () => {
    const ctx = testWorld(content, 900, 1200);
    const woken = place(ctx, { sex: 'male', age: 60, name: 'Aldric' });
    woken.awakening = { awakened: true, year: 1170, age: 30, forced: false, declaredMundane: false };
    const quiet = place(ctx, { sex: 'male', age: 60, name: 'Bertran' });
    const mother = place(ctx, { sex: 'female', age: 55, name: 'Cesse' });

    const lit = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, lit, mother, woken);
    const dark = place(ctx, { sex: 'female', age: 20, name: 'Enna' });
    beget(ctx, dark, mother, quiet);

    const a = cardFor(lit);
    readPanel(ctx, a, census());
    const b = cardFor(dark);
    readPanel(ctx, b, census());

    expect(a.panel.woken.map((r) => [r.name, r.relation])).toContainEqual(['Aldric', 'her father']);
    // Enna's father never woke, and her half-sister's father waking tells the
    // market nothing about her — the row is on the sister's panel, not hers.
    expect(b.panel.woken.some((r) => r.name === 'Aldric')).toBe(false);
  });

  /**
   * A WAKING IS NOT AN EXPRESSION. `expressed` is Madness on a man the house
   * has watched — never `canExpress`, which is a fact about his X and exactly
   * the kind of thing this panel may not read.
   */
  it('marks a man the house has watched pay for it, and not one who merely could', () => {
    const ctx = testWorld(content, 901, 1200);
    const father = place(ctx, { sex: 'male', age: 60, name: 'Aldric' });
    father.awakening = { awakened: true, year: 1170, age: 30, forced: false, declaredMundane: false };
    const daughter = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, daughter, undefined, father);

    const before = cardFor(daughter);
    readPanel(ctx, before, census());
    expect(before.panel.woken.find((r) => r.name === 'Aldric')?.expressed).toBe(false);

    father.madness = 12;
    const after = cardFor(daughter);
    readPanel(ctx, after, census());
    expect(after.panel.woken.find((r) => r.name === 'Aldric')?.expressed).toBe(true);
  });

  /**
   * THE PEDIGREE IS THE CLAIMED ONE, exactly as `kinship` and `LineRead` are.
   * A house that bought a grandmother into a branch the Power has shown in
   * moved what the market believes about her, and is the last house entitled
   * to complain about it.
   */
  it('reads the documents, not the blood', () => {
    const ctx = testWorld(content, 902, 1200);
    const real = place(ctx, { sex: 'male', age: 60, name: 'Bertran' });
    const claimed = place(ctx, { sex: 'male', age: 60, name: 'Aldric' });
    claimed.awakening = { awakened: true, year: 1170, age: 30, forced: false, declaredMundane: false };
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, girl, undefined, real);
    girl.claimedParents = { father: claimed.id };

    const card = cardFor(girl);
    readPanel(ctx, card, census());
    expect(card.panel.woken.map((r) => r.name)).toContain('Aldric');
    expect(card.panel.woken.map((r) => r.name)).not.toContain('Bertran');
  });

  /**
   * OUT TO FIRST COUSINS, and no further. The branch is the unit a market
   * reads — "it has shown twice in that line" is a sentence somebody says —
   * and the first cut of this stopped at siblings, which came up empty on 84
   * of 118 household cards measured.
   */
  it('reaches a cousin, and stops there', () => {
    const ctx = testWorld(content, 903, 1200);
    const grandfather = place(ctx, { sex: 'male', age: 80, name: 'Gorm' });
    const uncle = place(ctx, { sex: 'male', age: 55, name: 'Uther' });
    beget(ctx, uncle, undefined, grandfather);
    const cousin = place(ctx, { sex: 'male', age: 30, name: 'Corin' });
    beget(ctx, cousin, undefined, uncle);
    cousin.awakening = { awakened: true, year: 1190, age: 20, forced: false, declaredMundane: false };

    const father = place(ctx, { sex: 'male', age: 55, name: 'Faro' });
    beget(ctx, father, undefined, grandfather);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, girl, undefined, father);

    // A second cousin: one more step out, and the panel does not know him.
    const greatUncleChild = place(ctx, { sex: 'male', age: 30, name: 'Far' });
    greatUncleChild.awakening = { awakened: true, year: 1191, age: 20, forced: false, declaredMundane: false };

    const card = cardFor(girl);
    readPanel(ctx, card, census());
    expect(card.panel.woken.map((r) => [r.name, r.relation])).toContainEqual(['Corin', 'her cousin']);
    expect(card.panel.woken.map((r) => r.name)).not.toContain('Far');
  });

  /**
   * NEAREST FIRST, because the list is cut to four and a father who woke and a
   * cousin who woke are not the same news. A panel that dropped the father to
   * make room for three cousins would read as working.
   */
  it('keeps the nearest kin when the list is cut', () => {
    const ctx = testWorld(content, 904, 1200);
    const grandfather = place(ctx, { sex: 'male', age: 85, name: 'Gorm' });
    const father = place(ctx, { sex: 'male', age: 55, name: 'Faro' });
    beget(ctx, father, undefined, grandfather);
    father.awakening = { awakened: true, year: 1180, age: 35, forced: false, declaredMundane: false };
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, girl, undefined, father);

    for (let i = 0; i < 6; i++) {
      const uncle = place(ctx, { sex: 'male', age: 50, name: `Uncle${i}` });
      beget(ctx, uncle, undefined, grandfather);
      const cousin = place(ctx, { sex: 'male', age: 25, name: `Cousin${i}` });
      beget(ctx, cousin, undefined, uncle);
      cousin.awakening = { awakened: true, year: 1195, age: 20, forced: false, declaredMundane: false };
    }

    const card = cardFor(girl);
    readPanel(ctx, card, census());
    expect(card.panel.woken.length).toBe(4);
    expect(card.panel.woken.map((r) => r.name)).toContain('Faro');
  });

  /**
   * A HAND DEALT BY THE GAME CARRIES ONE, which is the half no scaffolded card
   * can prove: `dealMatch` is the only place a card is made, and a panel read
   * anywhere else is a panel the player never sees.
   */
  it('is read onto every card of a real hand', () => {
    const ctx = testWorld(content, 905, 1200);
    const head = place(ctx, { sex: 'male', age: 45, castSlots: ['head'] });
    const subject = place(ctx, { sex: 'female', age: 20, name: 'Ysolde' });
    beget(ctx, subject, undefined, head);

    const offer = dealMatch(ctx, subject, makeRng(7));
    expect(offer.cards.length).toBeGreaterThan(0);
    for (const c of offer.cards) {
      expect(c.panel).toBeDefined();
      expect(Array.isArray(c.panel.issue)).toBe(true);
      expect(Array.isArray(c.panel.woken)).toBe(true);
      expect(Array.isArray(c.panel.said)).toBe(true);
      expect(Array.isArray(c.panel.ourBook)).toBe(true);
    }
  });

  /**
   * AT LEAST ONE LINE ON THIS PANEL CAN BE WRONG, AND THE PANEL DOES NOT SAY
   * WHICH.
   *
   * `marrow_chronicle_fragment_1188` is authored at accuracy 0.5 — half of it
   * is untrue — and it reaches a player marrying a Marrow with its teller and
   * its bias attached and nothing else. That is deliberate and it is the rule
   * the whole tale layer is built on: the game does not adjudicate between two
   * contradicting accounts in its own voice. A panel that carried `accuracy`
   * would let a client sort the accounts by truth, which is the one reading
   * this layer exists to refuse.
   */
  it('repeats what is said of a house without saying whether it is true', () => {
    const ctx = testWorld(content, 907, 1200);
    const tale = content.tale('marrow_chronicle_fragment_1188');
    expect(tale, 'the fixture tale is gone from content').toBeDefined();
    expect(tale!.accuracy).toBeLessThan(1);
    ctx.world.tales.set(tale!.id, {
      bornYear: 1188, circulatesFrom: 1193, circulating: true, mutations: 0,
    });

    const girl = place(ctx, { sex: 'female', age: 20, name: 'Marra', house: 'house_marrow' });
    const card = cardFor(girl);
    card.house = 'house_marrow';
    readPanel(ctx, card, census());

    const row = card.panel.said.find((r) => r.tale === tale!.id);
    expect(row, 'a circulating tale naming her house never reached the panel').toBeDefined();
    expect(row!.teller).toBe(tale!.teller);
    expect(row!.bias).toBe(tale!.bias);
    expect(Object.keys(row!)).not.toContain('accuracy');
  });

  it('keeps house relevance when the tale no longer names the house in English', () => {
    const b = structuredClone(content.bundle);
    const tale = b.tales.find((t) => t.id === 'marrow_chronicle_fragment_1188')!;
    expect(tale.houses).toContain('house_marrow');
    tale.teller = 'the red-bound clerks';
    tale.text = 'A hostile account survives in a red book, with no family name in the wording.';

    const reworded = indexContent(b);
    const ctx = testWorld(reworded, 907, 1200);
    ctx.world.tales.set(tale.id, {
      bornYear: 1188, circulatesFrom: 1193, circulating: true, mutations: 0,
    });

    const girl = place(ctx, { sex: 'female', age: 20, name: 'Marra', house: 'house_marrow' });
    const card = cardFor(girl);
    card.house = 'house_marrow';
    readPanel(ctx, card, census());

    expect(card.panel.said.find((r) => r.tale === tale.id)).toBeDefined();
  });

  it('does not invent house relevance because free prose happens to name a house', () => {
    const b = structuredClone(content.bundle);
    const tale = b.tales.find((t) => t.id === 'ballad_of_the_thumb_sized_bottle')!;
    expect(tale.houses).toEqual([]);
    tale.teller = 'House Marrow';
    tale.text = 'House Marrow is named here only to prove that wording is not a rule.';

    const reworded = indexContent(b);
    const ctx = testWorld(reworded, 907, 1200);
    ctx.world.tales.set(tale.id, {
      bornYear: 1188, circulatesFrom: 1193, circulating: true, mutations: 0,
    });

    const girl = place(ctx, { sex: 'female', age: 20, name: 'Marra', house: 'house_marrow' });
    const card = cardFor(girl);
    card.house = 'house_marrow';
    readPanel(ctx, card, census());

    expect(card.panel.said.find((r) => r.tale === tale.id)).toBeUndefined();
  });

  /**
   * AND A TALE NOBODY HAS HEARD YET IS NOT SOMETHING A MATCHMAKER CAN REPEAT.
   * `circulating` is the whole of the difference between a tale whose event
   * has fired and a tale in the world.
   */
  it('will not repeat a tale that has not started circulating', () => {
    const ctx = testWorld(content, 908, 1200);
    const tale = content.tale('marrow_chronicle_fragment_1188')!;
    ctx.world.tales.set(tale.id, {
      bornYear: 1188, circulatesFrom: 1300, circulating: false, mutations: 0,
    });

    const girl = place(ctx, { sex: 'female', age: 20, name: 'Marra', house: 'house_marrow' });
    const card = cardFor(girl);
    card.house = 'house_marrow';
    readPanel(ctx, card, census());
    expect(card.panel.said).toEqual([]);
  });

  /**
   * AND THE ISSUE ROWS COUNT SURVIVAL, which `LineRead` does not. A line that
   * bore six and buried six reads `fertile` on the card, and that is not a bug
   * in the card — one adjective cannot carry two numbers. It is the reason the
   * panel gives both.
   */
  it('says how many of the children grew up, not only how many were born', () => {
    const ctx = testWorld(content, 906, 1200);
    const mother = place(ctx, { sex: 'female', age: 60, name: 'Cesse' });
    const father = place(ctx, { sex: 'male', age: 62, name: 'Faro' });
    marry(ctx, mother, father);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, girl, mother, father);

    const kids = [3, 40, 2, 35].map((age, i) => {
      const k = place(ctx, { sex: i % 2 ? 'male' : 'female', age, name: `Kid${i}` });
      beget(ctx, k, mother, father);
      return k;
    });
    expect(kids.length).toBe(4);

    const cen: LineCensus = {
      borne: new Map([[mother.id, ctx.world.people.all().filter((p) => p.claimedParents.mother === mother.id)]]),
      counted: new Set([mother.id]),
      byHouse: new Map(),
      mean: 3,
    };
    const card = cardFor(girl);
    readPanel(ctx, card, cen);
    const row = card.panel.issue.find((r) => r.name === 'Cesse');
    expect(row, 'her mother is a completed life and belongs on the panel').toBeDefined();
    // Five children counted (Dala and the four), three of them past fifteen.
    expect(row!.borne).toBe(5);
    expect(row!.grown).toBe(3);
    expect(row!.relation).toBe('her mother');
  });
});

/**
 * THE RULE, AS A BUILD FAILURE (issue #68, acceptance bullet 2).
 *
 * Every test above builds a world where the observable and the true disagree
 * and checks which one a row printed. That proves the rows written so far are
 * honest. It cannot prove the rule, because the rule is about the row nobody
 * has written yet — and the way this panel dies is not a wrong row, it is a
 * helpful one: somebody two years from now adds a Fecundity column because a
 * playtester said the cards were hard to read, every existing test stays
 * green, and §7's marriage market is over in one line.
 *
 * So the rule is asserted against the SOURCE. `panel.ts` may not name a
 * genome reader at all, and the forbidden set is DERIVED from what
 * `genetics/` actually exports rather than hand-listed — a hand-kept copy of
 * a list is the failure `docs/FAILURES.md` records seven times over, and it
 * would answer "no" about the reader added next week.
 */
describe('the panel may not read a genome', () => {
  const GENETICS = join(import.meta.dirname, 'genetics');
  const PANEL = join(import.meta.dirname, 'people/panel.ts');

  /**
   * Comments are stripped first. This file's own header talks at length about
   * phenotypes and loci — it has to, since explaining what the panel refuses
   * to read means naming it — and a scanner that could not tell prose from
   * code would make the rule unwritable.
   */
  function codeOf(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
  }

  /** Everything `genetics/` exports, plus the four genome doors on the factory. */
  function genomeReaders(): string[] {
    const fromGenetics = readdirSync(GENETICS)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .flatMap((f) => [...codeOf(join(GENETICS, f)).matchAll(/export (?:function|const|class) ([A-Za-z0-9_]+)/g)]
        .map((m) => m[1]!));
    return [...new Set([...fromGenetics, 'genomeOf', 'phenotypeOf', 'materialize', 'attr'])];
  }

  function readersNamedIn(file: string): string[] {
    const code = codeOf(file);
    return genomeReaders().filter((n) => new RegExp(`\\b${n}\\b`).test(code));
  }

  it('names no genome reader, and no genome-shaped property', () => {
    expect(readersNamedIn(PANEL)).toEqual([]);
    // The property route, which an import guard alone would miss: a `SimCtx`
    // is in scope here and a person hangs off it, so `p.genome` needs no
    // import at all.
    const code = codeOf(PANEL);
    for (const prop of ['genome', 'alleles', 'loci', 'phenotype']) {
      expect(code, `panel.ts reaches for .${prop}`).not.toMatch(new RegExp(`\\.${prop}\\b`));
    }
  });

  /**
   * AND THE SCANNER HAS TEETH. A guard nobody has watched fail is
   * indistinguishable from one that cannot fail (AGENTS.md), and this one
   * fails open in two different ways: an empty forbidden set, and a regexp
   * that matches nothing. `blood-gate.ts` is the natural control — it reads
   * genomes on purpose, and says so at length, because `concentrate` is an
   * oracle that cheats.
   */
  it('finds the readers in a file that does read them', () => {
    expect(genomeReaders().length).toBeGreaterThan(10);
    const cheats = readersNamedIn(join(import.meta.dirname, 'tools/blood-gate.ts'));
    expect(cheats).toContain('phenotypeOf');
    expect(cheats.length).toBeGreaterThan(1);
  });
});

/**
 * AT LEAST ONE LINE ON THIS PANEL CAN BE WRONG (issue #68, acceptance
 * bullet 3) — AND THE PANEL SETS THE TWO ACCOUNTS SIDE BY SIDE WITHOUT
 * SAYING WHICH.
 *
 * The case above it proves a tale reaches the panel carrying its teller and
 * its bias and no `accuracy`. That is the mechanism. This is the SCENE the
 * mechanism exists for, and it is the one a design claim has to be exhibited
 * in rather than restated: two accounts of the same house, in the same
 * player's hands, on the same card, disagreeing — one somebody else's, told
 * by a rival with a named motive, and one THIS FAMILY'S OWN, on a page it
 * embellished itself two centuries ago.
 *
 * `let the game adjudicate between two contradicting accounts in its own
 * voice` is on AGENTS.md's Do-not list, and there is no narrator who knows
 * the truth — there is only Daveed, and he is not neutral. So what is
 * asserted is an ABSENCE as much as a presence: both rows are there, neither
 * carries a mark, and nothing on the panel orders them by truth.
 */
describe('two accounts of one house, and the panel picks neither', () => {
  it('shows the rival’s tale and the family’s own lie about the same house', () => {
    const ctx = testWorld(content, 909, 1400);
    const w = ctx.world;

    // SOMEBODY ELSE'S ACCOUNT: House Marrow's own death-clerks, gloating, at
    // an authored accuracy of 0.5 — half of it is untrue and the content does
    // not say which half.
    const tale = content.tale('marrow_chronicle_fragment_1188')!;
    expect(tale.accuracy).toBeLessThan(1);
    w.tales.set(tale.id, { bornYear: 1188, circulatesFrom: 1196, circulating: true, mutations: 0 });

    const marrow = place(ctx, { sex: 'male', age: 40, name: 'Oswin', house: 'house_marrow' });

    // AND OURS, ABOUT THE SAME HOUSE, SAYING THE OPPOSITE — and it is a page
    // this family Embellished, so the lie on the shelf is its own. A house
    // that lied about the Marrows two centuries ago has to act on its own
    // lie; that is the record layer finally charging somebody.
    w.discrepancies.set('disc_marrow_test', {
      severity: 'grave',
      provableBy: ['house_marrow'],
      state: 'open',
    });
    w.chronicle.push({
      year: 1204,
      weight: 'page',
      named: false,
      record: 'embellish',
      discrepancyId: 'disc_marrow_test',
      text: 'The Marrow boy took no rite from us, and no debt was ever taken out in his name.',
      claims: [{ kind: 'deed', person: marrow.id, text: 'took no rite' }],
    });

    const girl = place(ctx, { sex: 'female', age: 20, name: 'Marra', house: 'house_marrow' });
    const card = cardFor(girl);
    card.house = 'house_marrow';
    readPanel(ctx, card, census());

    // BOTH ARE THERE.
    const said = card.panel.said.find((r) => r.tale === tale.id);
    expect(said, 'the rival account never reached the panel').toBeDefined();
    const ours = card.panel.ourBook.find((p) => p.year === 1204);
    expect(ours, 'our own page about that house never reached the panel').toBeDefined();

    // AND THEY DISAGREE. The clerks record a debt taken out against the boy;
    // our book says no debt was ever taken out. The player is holding both.
    expect(said!.text).toMatch(/debt/i);
    expect(ours!.text).toMatch(/no debt/i);

    // AND NOTHING ADJUDICATES. No accuracy anywhere on the panel, and the one
    // row the panel does mark is marked as OURS-AND-EMBELLISHED — which is
    // provenance, not a verdict: it says who wrote it and how, never whether
    // it is true.
    expect(JSON.stringify(card.panel)).not.toContain('accuracy');
    expect(ours!.embellished).toBe(true);
    expect(ours!.record).toBe('embellish');
    // The rival's row carries its teller and its motive and nothing else.
    expect(said!.teller).toBe(tale.teller);
    expect(said!.bias).toBe(tale.bias);
    expect(Object.keys(said!).sort()).toEqual(['bias', 'tale', 'teller', 'text']);
  });
});
