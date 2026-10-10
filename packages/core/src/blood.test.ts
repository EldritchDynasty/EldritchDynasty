import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import {
  applyBias, bootstrap, buildLocusTable, deleteriousLoad, dragFecundityContribution, heldBooks,
  makeRng, meiosis, randomGenome, testWorld,
} from '@ed/core';
import type { Genome } from '@ed/schema';
import { bloodBundle, panelScore } from './tools/blood-gate.js';
import { beget, place } from './testing.js';
import { emptyPanel, readPanel } from './people/panel.js';
import type { LineCensus, MatchCard } from './people/match.js';
import { loadBundle } from '@ed/content';
import { phenotypeOf } from './people/factory.js';

const content = loadContent();
const bundle = loadBundle();

/**
 * THE THREE LEVERS OF ISSUE #41, each tested where it acts.
 *
 * The measured finding, in one line: an oracle player who always took the card
 * whose person really carried the most font watched the family's blood fall
 * from 31 to 4 inside four generations, and no verb the game offered touched
 * it. `npm run gate:blood` is the instrument and `docs/BALANCE-LOG.md` carries
 * the tables. These are the mechanisms those tables are about — asserted the
 * way this repository asks for, on the mechanism and never on a seed.
 */

/** A woman with one X carrying everything and one carrying nothing. */
function twoXWoman(table: ReturnType<typeof buildLocusTable>, hot: boolean[]): Genome {
  const x0 = new Int16Array(table.x.length);
  const x1 = new Int16Array(table.x.length);
  table.fontIndices.forEach((i, n) => {
    const alleles = table.xAlleles[i]!;
    const burning = alleles.reduce((best, a, idx) => (a.effect > (alleles[best]?.effect ?? -1) ? idx : best), 0);
    const empty = Math.max(0, alleles.findIndex((a) => a.tags.includes('null')));
    x0[i] = hot[n] ? burning : empty;
    x1[i] = empty;
  });
  return {
    autosomal: [new Int16Array(table.autosomal.length), new Int16Array(table.autosomal.length)],
    sex: [x0, x1],
    mutations: [],
  };
}

function transmitted(table: ReturnType<typeof buildLocusTable>, g: Genome, draws: number): number {
  let total = 0;
  for (let i = 0; i < draws; i++) {
    const gamete = meiosis(g, table, 'female', makeRng(1000 + i), 1200);
    for (const idx of table.fontIndices) {
      total += table.xAlleles[idx]![gamete.x![idx]!]?.effect ?? 0;
    }
  }
  return total / draws;
}

describe('the blood is not passed on fairly', () => {
  const hot = [true, true, true, true, true, true];

  it('is a fair coin where no locus declares a drive', () => {
    const table = buildLocusTable(indexContent(bloodBundle(content.bundle, { drive: 0.5 })).loci);
    const mother = twoXWoman(table, hot);

    // Half of everything she carries, which is exactly the decay the batch
    // measured: four generations of this and the founding haplotype is gone.
    const mean = transmitted(table, mother, 400);
    const full = table.fontIndices.reduce((sum, i) => {
      const alleles = table.xAlleles[i]!;
      return sum + Math.max(...alleles.map((a) => a.effect));
    }, 0);

    expect(mean).toBeGreaterThan(full * 0.35);
    expect(mean).toBeLessThan(full * 0.65);
  });

  it('hands on the hotter X more often when the font loci drive', () => {
    const fair = buildLocusTable(indexContent(bloodBundle(content.bundle, { drive: 0.5 })).loci);
    const driven = buildLocusTable(indexContent(bloodBundle(content.bundle, { drive: 0.9 })).loci);

    const evenly = transmitted(fair, twoXWoman(fair, hot), 400);
    const driving = transmitted(driven, twoXWoman(driven, hot), 400);

    expect(driving).toBeGreaterThan(evenly);
  });

  /**
   * The drive is a bias on WHICH X a child is handed, and nothing else. A
   * mother with two identical X's has nothing to be biased about, and a woman
   * whose cold X is the one with more font on it drives toward THAT — the
   * mechanism knows about font and not about the family.
   */
  it('drives toward whichever X carries more, and stays a coin when they match', () => {
    const table = buildLocusTable(indexContent(bloodBundle(content.bundle, { drive: 0.9 })).loci);

    const both = twoXWoman(table, [true, true, true, true, true, true]);
    both.sex[1] = Int16Array.from(both.sex[0]);
    const identical = transmitted(table, both, 200);
    const full = table.fontIndices.reduce((sum, i) => {
      const alleles = table.xAlleles[i]!;
      return sum + Math.max(...alleles.map((a) => a.effect));
    }, 0);
    expect(identical).toBeCloseTo(full, 0);

    // The same genome with the haplotypes swapped drives the other way, and
    // hands on about the same amount. Not exactly the same: the walk starts on
    // the other side of every crossover, so the mosaics differ — what has to
    // hold is that the mechanism reads the font and not the index.
    const one = twoXWoman(table, [true, true, true, false, false, false]);
    const flipped = twoXWoman(table, [true, true, true, false, false, false]);
    [flipped.sex[0], flipped.sex[1]] = [flipped.sex[1]!, flipped.sex[0]];

    const a = transmitted(table, one, 300);
    const b = transmitted(table, flipped, 300);
    expect(Math.abs(a - b) / a).toBeLessThan(0.15);
    // And both are well above the fair-coin half, which is the whole claim.
    expect(Math.min(a, b)).toBeGreaterThan(full * 0.5 * 0.5);
  });
});

describe('the house has been reading since before the signing', () => {
  it('puts the founding library on the shelf', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const home = content.houses.find((h) => h.isPlayerHouse)!;

    expect(home.library.length).toBeGreaterThan(0);
    expect(heldBooks(ctx).map((b) => b.id).sort()).toEqual([...home.library].sort());
  });

  it('is a shelf and not a gift: nobody has read any of it', () => {
    const ctx = bootstrap(content, 1042, 1042);
    for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
      expect(p.spellsKnown).toHaveLength(0);
    }
  });
});

/**
 * THE FOUNDER'S BLOOD IS THE BLOOD HE WAS AUTHORED WITH.
 *
 * `bias: { eldritch_power }` matched nothing for as long as the field existed.
 * `applyBias` walks `table.byAttribute`, which is built from each locus's
 * `contributes` — and the font and channel loci deliberately declare none,
 * because eldritch is not an attribute and shares no code with one
 * (invariant 4). So the key had no entry, the loop ran zero times, and the
 * single most important person in the content directory was rolled at random
 * (invariant 11: a declared field nothing reads is a bug).
 *
 * Asserted against an unbiased control rather than against a number, because
 * the number is a balance decision and this is the mechanism.
 */
describe('the founder is the man his recipe describes', () => {
  const founderOf = (source: Parameters<typeof bootstrap>[0], seed: number) => {
    const ctx = bootstrap(source, seed, 1042);
    const p = ctx.world.people.all().find((q) => q.castSlots.includes('narrator'));
    return p ? { ctx, p } : undefined;
  };

  const unbiased = indexContent({
    ...bundle,
    characters: bundle.characters.map((c) => (c.key === 'founder'
      ? { ...c, bias: Object.fromEntries(Object.entries(c.bias).filter(([k]) => k !== 'eldritch_power')) }
      : c)),
  });

  it('carries more of it than the same man rolled without the bias', () => {
    const font = (source: Parameters<typeof bootstrap>[0]) => {
      let total = 0;
      for (let i = 0; i < 24; i++) {
        const found = founderOf(source, 4000 + i * 13);
        if (!found) continue;
        total += phenotypeOf(found.p, found.ctx.genetics, 1042).eldritch.carriedFont;
      }
      return total / 24;
    };
    // A batch, not a seed: a bias is a nudge toward an intent and not a pin,
    // so any one founder may roll under his own recipe.
    expect(font(content)).toBeGreaterThan(font(unbiased));
  });

  it('is given the channel to use it and not only the font to drown in', () => {
    // Power is `min(font, ceiling)` and Madness is what will not pass, so a
    // bias that reached the font alone would have authored a ruined man
    // rather than a strong one.
    let ceiling = 0;
    for (let i = 0; i < 24; i++) {
      const found = founderOf(content, 4000 + i * 13);
      if (!found) continue;
      ceiling += phenotypeOf(found.p, found.ctx.genetics, 1042).eldritch.ceiling;
    }
    let plain = 0;
    for (let i = 0; i < 24; i++) {
      const found = founderOf(unbiased, 4000 + i * 13);
      if (!found) continue;
      plain += phenotypeOf(found.p, found.ctx.genetics, 1042).eldritch.ceiling;
    }
    expect(ceiling).toBeGreaterThan(plain);
  });

  it('can express it, in every run, because the whole game rests on him', () => {
    for (let i = 0; i < 12; i++) {
      const found = founderOf(content, 4000 + i * 13);
      expect(found, `seed ${4000 + i * 13} has no narrator`).toBeTruthy();
      expect(phenotypeOf(found!.p, found!.ctx.genetics, 1042).eldritch.canExpress).toBe(true);
    }
  });
});

describe('who the house marries when nobody is asked', () => {
  it('leaves the shipped default alone', () => {
    expect(testWorld(content).world.marriagePolicy).toBe('as_it_falls');
  });
});

/**
 * A BIAS IS A DIRECTION, AND IT WAS POINTING THE WRONG WAY AT HALF THE LOCI.
 *
 * `applyBias` ranked a locus's alleles by the allele's own `effect` and wrote
 * the best one. A locus contributes `effect * weight`, and a weight can be
 * negative — so at every negative contributor the rule was exactly inverted,
 * and the game had one: `fecundity_drag` feeds `fecundity` at -1.8.
 *
 * The template it bit is the one the whole mechanism is about.
 * `suitor_widow_with_land` — *"worth every one of them if what you want is a
 * house full"* — is authored `bias: { fecundity: 0.6 }`, and was dealt with the
 * STRONGEST fertility-drag allele the content offers on her X, every time.
 * Inert at issue #26's shipped coupling of zero, which is why nothing caught
 * it, and passed to every daughter she has.
 *
 * Asserted through `dragFecundityContribution` rather than by reading allele
 * indices, because the claim is about what the genome DOES, not about which
 * index a sort happened to return.
 *
 * The deleterious loci are ranked by their TAG rather than by this arithmetic,
 * and the third case below is why: they are authored `effect: -7` against
 * `weight: -0.5`, so by contribution alone each of the game's five named curses
 * makes a body stronger and a strength bias would buy them. That sign error is
 * live and is issue #112; this rule holds whichever way it is resolved.
 */
describe('a fecundity bias asks for children, at every locus that feeds it', () => {
  const table = buildLocusTable(bundle.loci);

  const drag = (bias: Record<string, number> | undefined, n = 24) => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const rng = makeRng(9_000 + i * 31);
      const g = randomGenome(table, undefined, 'female', rng);
      if (bias) applyBias(g, bias, table, rng);
      total += dragFecundityContribution(g, table, 1);
    }
    return total / n;
  };

  const plain = drag(undefined);

  it('does not hand the fertility card the strongest fertility drag in the game', () => {
    // Six loci at -1.8 with a strongest allele of effect 8 is about -86 of
    // drag if every one of them is maxed, which is what the old rule bought.
    const asked = drag({ fecundity: 0.6 });
    expect(asked, 'a positive fecundity bias made the drag WORSE').toBeGreaterThan(plain);
    expect(asked).toBeGreaterThan(-10);
  });

  it('and a negative one still asks for a thin line, which is the other half of the claim', () => {
    const thin = drag({ fecundity: -0.6 });
    expect(thin, 'a negative fecundity bias did not reach for the drag').toBeLessThan(plain);
  });

  it('never buys a strong body with a named curse (issue #112)', () => {
    // Five deleterious loci contribute to strength at -0.5 against an effect
    // of -7, which is +3.5 apiece by the arithmetic. Ranking on that would
    // make `bias: { strength: 0.7 }` — eight templates carry one — the fastest
    // way in the game to acquire the Ashen mark.
    const cursed = (bias: Record<string, number>) => {
      let n = 0;
      for (let i = 0; i < 24; i++) {
        const rng = makeRng(11_000 + i * 31);
        const g = randomGenome(table, undefined, 'male', rng);
        applyBias(g, bias, table, rng);
        n += deleteriousLoad(g, table).count;
      }
      return n;
    };
    expect(cursed({ strength: 0.7 }), 'a strength bias handed out curses').toBe(0);
  });
});

/**
 * THE `panel` COMPARATOR READS KIN, NOT WORDS (#1005). It matched the printed
 * relation, `'her father'`, so from the day the panel learned to say `his
 * father` every suitor dealt to a daughter of the seat scored 0. A brother and
 * sister with the same woken father must read the same.
 */
describe('the panel comparator', () => {
  function cardFor(p: { id: string; name: string; sex: 'male' | 'female'; houseOfOrigin: string }): MatchCard {
    return {
      id: 'card_1', kind: 'household', name: p.name, sex: p.sex, age: 20, house: p.houseOfOrigin,
      houseName: p.houseOfOrigin, blurb: '', dowry: 0, kinship: 0, line: 'unknown', lineSeen: 0,
      words: '', papersAsked: 0, papersShown: 0, person: p.id, available: true, panel: emptyPanel(),
    };
  }

  it('scores a man\'s card exactly as a woman\'s, and never off the printed words', () => {
    const ctx = testWorld(content, 9662, 1200);
    const mother = place(ctx, { sex: 'female', age: 60, name: 'Eira' });
    const father = place(ctx, { sex: 'male', age: 62, name: 'Aldric', awakened: true });
    const son = place(ctx, { sex: 'male', age: 20, name: 'Roland' });
    const daughter = place(ctx, { sex: 'female', age: 21, name: 'Dala' });
    beget(ctx, son, mother, father);
    beget(ctx, daughter, mother, father);
    const cen: LineCensus = { borne: new Map(), counted: new Set(), byHouse: new Map(), mean: 0 };
    const [sonCard, daughterCard] = [cardFor(son), cardFor(daughter)];
    readPanel(ctx, sonCard, cen);
    readPanel(ctx, daughterCard, cen);
    const score = (card: MatchCard) => panelScore(card as Parameters<typeof panelScore>[0]);

    expect(score(daughterCard)).toBeGreaterThan(0);
    expect(score(sonCard)).toBe(score(daughterCard));
    for (const row of sonCard.panel.woken) row.relation = 'a word the gate must not read';
    expect(score(sonCard)).toBe(score(daughterCard));
  });
});
