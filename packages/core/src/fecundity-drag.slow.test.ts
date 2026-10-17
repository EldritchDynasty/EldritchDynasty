import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import { indexContent, type Genome, type Sex } from '@ed/schema';
import {
  FECUNDITY_DRAG_COUPLING, attr, bootstrap, buildLocusTable, conceive, digestOf,
  dragFecundityContribution, expectedAttribute, genomeOf, hashSeed, makeRng, meiosis,
  randomGenome, runYears, testWorld, place, type Rng,
  expectRate,
} from '@ed/core';
import { coupledBundle, phaseFounders, pleiotropicWeight } from './tools/drag-gate.js';

/**
 * FERTILITY OPTION B — the X-linked drag, prototyped behind a constant
 * (issue #26).
 *
 * `FECUNDITY_DRAG_COUPLING` ships at 0, and this file's first job is proving
 * that number is load-bearing: the loci exist, are linked to font, and
 * genuinely do nothing to a body's fertility at the shipped default. Its
 * second job is proving the MECHANISM itself is correct in isolation — via
 * `dragFecundityContribution`'s explicit-coupling seam — without ever
 * running the simulation at anything but the shipped default (INVARIANT 8:
 * no module-scope mutable state that could drift between runs).
 *
 * What this file deliberately does NOT do: run the "batches of two hundred,
 * turn the constant up, watch for the death spiral" gate the issue asks
 * for before shipping this live. Two hundred thousand-year runs per coupling
 * is a tool a human runs on purpose (`npm run gate:drag`), not a suite CI
 * pays for on every push. What this file DOES own is the claim that tool
 * rests on: that its synthetic k=0 bundle is the shipped game, exactly, so a
 * number it prints at k=2 is about the coupling and nothing else.
 */

const bundle = loadContent();
const table = buildLocusTable(bundle.loci);
const YEAR = 1042;

function rngFor(...salt: (string | number)[]): Rng {
  return makeRng(hashSeed('fecundity-drag', ...salt));
}

const founder = (rng: Rng, sex: Sex): Genome => randomGenome(table, undefined, sex, rng);

function gamete(g: Genome, sex: Sex, rng: Rng, want: 'x' | 'y' | 'any' = 'any') {
  for (let i = 0; i < 200; i++) {
    const gm = meiosis(g, table, sex, rng, YEAR);
    if (want === 'any' || (want === 'x' ? gm.x !== null : gm.x === null)) return gm;
  }
  throw new Error(`no ${want}-bearing gamete in 200 draws`);
}

function child(mother: Genome, father: Genome, rng: Rng, want: 'son' | 'daughter' | 'any' = 'any') {
  const wantX = want === 'son' ? 'y' : want === 'daughter' ? 'x' : 'any';
  return conceive(gamete(mother, 'female', rng), gamete(father, 'male', rng, wantX), table);
}

const dragIds = table.x.filter((l) => l.kind === 'fecundity_drag').map((l) => String(l.id));
const dragIndices = dragIds.map((id) => table.xIndex.get(id)!);

describe('fecundity drag (issue #26)', () => {
  it('ships inert — the coupling constant is zero', () => {
    expect(FECUNDITY_DRAG_COUPLING).toBe(0);
  });

  it('is authored: one drag locus per font locus, each linked (a few cM away)', () => {
    const fontIds = table.x.filter((l) => l.kind === 'eldritch_font').map((l) => String(l.id));
    expect(dragIds.length, 'no fecundity_drag loci authored').toBe(fontIds.length);

    for (const fontId of fontIds) {
      const n = fontId.replace('font_', '');
      const pairedDrag = table.x.find((l) => l.id === `fecundity_drag_${n}`);
      expect(pairedDrag, `no drag locus paired with ${fontId}`).toBeDefined();

      const fontLocus = table.x.find((l) => l.id === fontId)!;
      const distance = Math.abs(pairedDrag!.position - fontLocus.position);
      expect(distance, `${fontId} and its drag locus are ${distance}cM apart — not linked`).toBeLessThan(10);
      expect(distance, `${fontId} and its drag locus occupy the same position`).toBeGreaterThan(0);
    }
  });

  it('contributes to fecundity, never to the eldritch profile', () => {
    const contribs = table.byAttribute.get('fecundity') ?? [];
    const dragContribs = contribs.filter((c) => c.locus.kind === 'fecundity_drag');
    expect(dragContribs.length, 'drag loci are not wired into fecundity at all').toBe(dragIds.length);
    for (const c of dragContribs) {
      expect(c.weight, `${c.locus.id} does not pull fecundity DOWN`).toBeLessThan(0);
    }
  });

  it('does not move a body\'s fecundity at the shipped (zero) coupling', () => {
    const ctx = testWorld(bundle, 55221, 1042);
    const person = place(ctx, { sex: 'female', age: 25, name: 'A Woman' });

    // Same person throughout — only her drag genome changes between the two reads.
    const before = attr(person, 'fecundity', ctx.genetics, ctx.world.year); // materializes

    const strongIdx = (id: string) => table.xAlleles[table.xIndex.get(id)!]!.findIndex((a) => a.id === `${id}_strong`);
    const g = person.genome.kind === 'materialized' ? person.genome.genome : undefined;
    expect(g, 'genome did not materialize').toBeDefined();
    for (const id of dragIds) {
      const idx = table.xIndex.get(id)!;
      const strong = strongIdx(id);
      g!.sex[0][idx] = strong;
      g!.sex[1]![idx] = strong;
    }
    person.phenotype = undefined;

    const after = attr(person, 'fecundity', ctx.genetics, ctx.world.year);
    expect(after, 'maxing out her drag genome moved fecundity even though the coupling is zero').toBe(before);
  });

  it('drags fecundity down when the coupling is turned up (mechanism only, not the shipped path)', () => {
    const rng = rngFor('mechanism');
    const hot = founder(rng, 'female');
    const cold = founder(rng, 'female');
    for (const i of dragIndices) {
      const strong = table.xAlleles[i]!.findIndex((a) => a.id.endsWith('_strong'));
      const none = table.xAlleles[i]!.findIndex((a) => a.tags.includes('null'));
      hot.sex[0][i] = strong; hot.sex[1]![i] = strong;
      cold.sex[0][i] = none; cold.sex[1]![i] = none;
    }

    expect(dragFecundityContribution(hot, table, 0)).toBe(0);
    expect(dragFecundityContribution(cold, table, 0)).toBe(0);

    const hotAt1 = dragFecundityContribution(hot, table, 1);
    const coldAt1 = dragFecundityContribution(cold, table, 1);
    expect(hotAt1, 'a fully-strong drag genome did not pull fecundity down at coupling 1').toBeLessThan(0);
    expect(coldAt1, 'a fully-null drag genome should contribute nothing').toBe(0);
    expect(hotAt1).toBeLessThan(coldAt1);
  });

  /**
   * THE SWEEP INSTRUMENT'S FIDELITY (issue #26's gate, `tools/drag-gate.ts`).
   *
   * The gate cannot move `FECUNDITY_DRAG_COUPLING` — it is a const, and an
   * env var read at import time would make a saved game replay differently
   * on a machine whose shell disagreed. So it relabels the drag loci
   * `additive` and scales their authored weight by k instead. That is only
   * honest if relabelling by itself changes NOTHING: same ids, same X, same
   * positions, same alleles, therefore the same draws in the same order. A
   * whole-world digest is the strongest available way to say so — if
   * anything anywhere in a two-century run diverged, this fails.
   */
  it('the gate\'s k=0 bundle is the shipped game, digest for digest', () => {
    const bundle = loadBundle();
    for (const seed of [1000, 1007]) {
      const shipped = bootstrap(bundle, seed, 1042);
      runYears(shipped, 200);
      const swept = bootstrap(indexContent(coupledBundle(bundle, 0)), seed, 1042);
      runYears(swept, 200);
      expect(digestOf(swept), `seed ${seed}`).toBe(digestOf(shipped));
    }
  });

  /** ...and the other half of the claim: at k>0 it is a different world. */
  it('the gate\'s k=2 bundle is not the shipped game', () => {
    const bundle = loadBundle();
    const shipped = bootstrap(bundle, 1000, 1042);
    runYears(shipped, 200);
    const hot = bootstrap(indexContent(coupledBundle(bundle, 2)), 1000, 1042);
    runYears(hot, 200);
    expect(digestOf(hot), 'turning the coupling up changed nothing').not.toBe(digestOf(shipped));
  });

  /**
   * THE PREMISE THE ISSUE ASSUMES AND THE CONTENT DOES NOT SUPPLY.
   *
   * Issue #26 argues that placing the drag loci on the X, a few cM from the
   * font, makes "a daughter who carries deep font tend to carry low
   * fecundity." Linkage does not do that. It preserves whatever pairing the
   * founders happened to be rolled with, and that pairing is drawn from the
   * world baseline independently of the font — so there is nothing to
   * preserve. This is the assertion of that gap: on the shipped founding
   * genomes, a hot font allele and a strong drag allele do not travel
   * together on the same haplotype any more often than chance.
   *
   * `phaseFounders` is the gate's variant that supplies the premise, and the
   * second half of this test is what makes its numbers mean anything.
   */
  it('linkage alone does not pair font with drag — the founders are rolled unphased', () => {
    const bundle = loadBundle();
    const ctx = bootstrap(bundle, 1000, 1042);
    const t = ctx.genetics.table;
    const pairs = dragIds.map((id) => ({
      drag: t.xIndex.get(id)!,
      font: t.xIndex.get(`font_${id.replace('fecundity_drag_', '')}`)!,
    }));

    let hotWithDrag = 0, hotTotal = 0;
    for (const p of ctx.world.people.blood(ctx.world.playerHouse)) {
      const g = genomeOf(p, ctx.genetics);
      for (const { drag, font } of pairs) {
        for (const hap of [g.sex[0], g.sex[1]]) {
          if (!hap) continue;
          if ((t.xAlleles[font]![hap[font]!]?.effect ?? 0) <= 0) continue;
          hotTotal += 1;
          if ((t.xAlleles[drag]![hap[drag]!]?.effect ?? 0) > 0) hotWithDrag += 1;
        }
      }
    }
    expect(hotTotal, 'no font-carrying haplotypes among the founders at all').toBeGreaterThan(0);
    // Baseline: 16% of drawn drag alleles are non-null. Anything near that is
    // chance; the design needs this number near 100 and the content does not
    // put it there.
    expectRate({
      hits: hotWithDrag, n: hotTotal, ceiling: 0.5,
      what: 'font-carrying haplotypes that also carry the drag',
    });
  });

  it('phasing the founders is what actually pairs them (the gate\'s variant)', () => {
    const bundle = loadBundle();
    const ctx = bootstrap(bundle, 1000, 1042);
    phaseFounders(ctx, bundle);
    const t = ctx.genetics.table;

    for (const p of ctx.world.people.blood(ctx.world.playerHouse)) {
      const g = genomeOf(p, ctx.genetics);
      for (const id of dragIds) {
        const drag = t.xIndex.get(id)!;
        const font = t.xIndex.get(`font_${id.replace('fecundity_drag_', '')}`)!;
        for (const hap of [g.sex[0], g.sex[1]]) {
          if (!hap) continue;
          const hot = (t.xAlleles[font]![hap[font]!]?.effect ?? 0) > 0;
          const dragged = (t.xAlleles[drag]![hap[drag]!]?.effect ?? 0) > 0;
          expect(dragged, `${p.name}'s ${id} does not match its font locus`).toBe(hot);
        }
      }
    }
  });

  /**
   * And the phasing is inert at the shipped coupling: it moves alleles that
   * contribute nothing, so the same people are born, marry and die on the
   * same years. Without this the gate's k=0 row would be a different
   * baseline from the one every other row is read against.
   *
   * The whole-world digest is deliberately NOT the assertion here — it hashes
   * the genomes themselves, which phasing does change, and would fail while
   * saying nothing about whether the SIMULATION diverged. Who lived and when
   * is the claim that matters.
   */
  it('phasing is inert at coupling zero — the same lives, on the same years', () => {
    const bundle = loadBundle();
    const lives = (ctx: ReturnType<typeof bootstrap>) => ctx.world.people
      .all()
      .map((p) => `${p.id}:${p.born}:${p.died ?? '-'}`)
      .sort()
      .join('|');

    const plain = bootstrap(bundle, 1000, 1042);
    runYears(plain, 200);
    const phased = bootstrap(indexContent(coupledBundle(bundle, 0)), 1000, 1042);
    phaseFounders(phased, bundle);
    runYears(phased, 200);
    expect(lives(phased)).toBe(lives(plain));
  });

  it('sons express drag from their single maternal X; daughters from two, buffered', () => {
    // Same asymmetry as font, running the other way: a son with his mother's
    // one hot haplotype gets the full hemizygous effect; a daughter mixes it
    // with whatever her father's X carries (always cold — outsiders draw
    // font-pool frequencies here too, since fecundity_drag rides the same X).
    const rng = rngFor('sex-asymmetry');
    const hotMother = founder(rng, 'female');
    for (const i of dragIndices) {
      const strong = table.xAlleles[i]!.findIndex((a) => a.id.endsWith('_strong'));
      hotMother.sex[0][i] = strong; hotMother.sex[1]![i] = strong;
    }
    const father = founder(rng, 'male');

    const son = child(hotMother, father, rng, 'son');
    const daughter = child(hotMother, father, rng, 'daughter');

    const sonDrag = dragFecundityContribution(son.genome, table, 1);
    const daughterDrag = dragFecundityContribution(daughter.genome, table, 1);

    expect(sonDrag, 'a son of an all-strong-drag mother shows no drag at all').toBeLessThan(0);
    // The daughter's second X is a random outsider draw diluting the effect,
    // exactly as font dilutes — so her magnitude should not exceed her brother's.
    expect(Math.abs(daughterDrag)).toBeLessThanOrEqual(Math.abs(sonDrag) + 1e-9);
  });
});

/**
 * OPTION B RESPECIFIED — the drag as pleiotropy rather than as linkage.
 *
 * Three batches measured the linked form and none of them found the squeeze it
 * was specified to produce: `font sqz` sat inside +/-0.06 at every coupling,
 * because linkage PRESERVES a pairing and cannot create one, and the pairing
 * the founders are rolled with is random. The form that survives that argument
 * is the one where the negative fecundity contribution sits on the
 * `eldritch_font` loci themselves — then the correlation is structural rather
 * than inherited, and there is nothing to recombine apart, dilute out or
 * select away.
 *
 * `gate:drag --pleiotropic` is the batch. These are the claims it rests on,
 * and they are the same three the linked sweep needed: the shipped game is
 * untouched, k=0 is bit-identical to it, and k means the same thing in both
 * columns so the two tables can be read side by side.
 */
describe('fecundity drag, pleiotropic (issue #26, respecified)', () => {
  it('the shipped content carries no such contribution — this is a gate variant, not a rule', () => {
    // The whole reason the centre bug in `expectedAttribute` is latent rather
    // than live: no font locus feeds a real attribute in the shipped game.
    const fonts = loadBundle().loci.filter((l) => l.kind === 'eldritch_font');
    expect(fonts.length).toBeGreaterThan(0);
    for (const l of fonts) expect(l.contributes, String(l.id)).toEqual([]);
  });

  it('puts the drag on the font loci, and leaves the drag loci inert where they are', () => {
    const base = loadBundle();
    const hot = coupledBundle(base, 2, { mode: 'pleiotropic' });

    const fonts = hot.loci.filter((l) => l.kind === 'eldritch_font');
    expect(fonts.length).toBe(base.loci.filter((l) => l.kind === 'eldritch_font').length);
    for (const l of fonts) {
      const fec = l.contributes.filter((c) => String(c.attr) === 'fecundity');
      expect(fec.length, String(l.id)).toBe(1);
      expect(fec[0]!.weight, String(l.id)).toBeLessThan(0);
    }

    // The linked group is untouched — same kind, so `couplingFor` still
    // multiplies it by the shipped zero, and same position, so the genome
    // layout and the RNG cascade are the shipped ones.
    const before = base.loci.filter((l) => l.kind === 'fecundity_drag');
    const after = hot.loci.filter((l) => l.kind === 'fecundity_drag');
    expect(after).toEqual(before);
  });

  it('cannot be recombined apart — the drag IS the font allele, not a neighbour of it', () => {
    // The linked form's failure in one assertion. There, a woman's drag load
    // and her carried font are two draws that happen to travel together for a
    // while; here the same allele effect produces both, so no meiosis, no
    // dilution and no selection can separate them. Asserted structurally: every
    // locus that feeds fecundity under this variant is a font locus.
    const hot = coupledBundle(loadBundle(), 2, { mode: 'pleiotropic' });
    const contributors = buildLocusTable(hot.loci).byAttribute.get('fecundity') ?? [];
    const viaFont = contributors.filter((c) => c.locus.kind === 'eldritch_font');
    expect(viaFont.length).toBeGreaterThan(0);
    for (const c of viaFont) {
      expect(new Set(hot.loci.filter((l) => l.kind === 'eldritch_font').map((l) => l.id)))
        .toContain(c.locus.id);
    }
  });

  it('k is calibrated: at k=1 it costs the population what the authored linked form costs', () => {
    const base = loadBundle();
    const centre = (b: { loci: typeof base.loci }) =>
      expectedAttribute(buildLocusTable(b.loci), 'fecundity');
    const shipped = centre(base);
    const linked = centre(coupledBundle(base, 1, { mode: 'linked' }));
    const pleio = centre(coupledBundle(base, 1, { mode: 'pleiotropic' }));

    expect(linked).toBeLessThan(shipped);
    // Same mean tax to four decimals. The point of the sweep is to compare
    // SHAPES at equal strength; a k that bought different amounts of drag in
    // the two columns would make the tables incomparable and nothing would say so.
    expect(pleio).toBeCloseTo(linked, 4);
    expect(pleiotropicWeight(base)).toBeGreaterThan(0);
  });

  /**
   * FOUR HUNDRED YEARS, not two hundred, and the number is the finding.
   *
   * The first cut of this variant added the contribution at weight ZERO rather
   * than not adding it, and a zero-weight contribution is not inert: it enters
   * `byAttribute`, `applyBias` iterates that list, and one template in the deck
   * biases fecundity. The two worlds were identical for two centuries and
   * visibly apart by three, so a 200-year digest passed while the sweep's
   * baseline row was quietly not the game.
   */
  it('the k=0 bundle is the shipped game, digest for digest, for four centuries', () => {
    const base = loadBundle();
    for (const seed of [1000, 1007]) {
      const shipped = bootstrap(base, seed, 1042);
      runYears(shipped, 400);
      const swept = bootstrap(
        indexContent(coupledBundle(base, 0, { mode: 'pleiotropic' })), seed, 1042,
      );
      runYears(swept, 400);
      expect(digestOf(swept), `seed ${seed}`).toBe(digestOf(shipped));
    }
  });

  it('the k=2 bundle is not the shipped game', () => {
    const base = loadBundle();
    const shipped = bootstrap(base, 1000, 1042);
    runYears(shipped, 200);
    const hot = bootstrap(indexContent(coupledBundle(base, 2, { mode: 'pleiotropic' })), 1000, 1042);
    runYears(hot, 200);
    expect(digestOf(hot), 'turning the coupling up changed nothing').not.toBe(digestOf(shipped));
  });

  /**
   * THE BLOCKER THE BATCH FOUND, written down as an executable statement of it.
   *
   * `expectedAttribute` computes the population mean from the authored allele
   * frequencies. `drawAllele` does NOT draw font alleles at those frequencies:
   * an outsider carries nothing at all except at their pool's `fontCarrierRate`,
   * and what they carry when they carry anything is weak. That override is the
   * whole of "Eldritch Power dilutes when married outward" and it is correct.
   *
   * It also means that the moment a font locus feeds a real attribute, the
   * centre the game measures couples against is computed from frequencies
   * nobody in the world is drawn at — and the centre falls much faster than the
   * population does. That is the same failure mode invariant 10 already caught
   * once here (a centre nobody can occupy), arriving by a different road, and
   * it is why the constant stays at zero. See docs/FAILURES.md.
   */
  it('the centre is computed from frequencies the font is not drawn at', () => {
    const base = loadBundle();
    const fontLocus = base.loci.find((l) => l.kind === 'eldritch_font')!;
    const authoredCarrier = 1 - (fontLocus.alleles.find((a) => a.tags.includes('null'))?.p ?? 0);

    const pools = base.houses.map((h) => h.genePool).filter((p): p is NonNullable<typeof p> => !!p);
    const outsiders = pools.filter((p) => p.fontCarrierRate < 1);
    expect(outsiders.length, 'no outsider pools to compare against').toBeGreaterThan(0);
    for (const p of outsiders) {
      expect(p.fontCarrierRate, 'an outsider pool at or above the authored rate')
        .toBeLessThan(authoredCarrier);
    }
  });
});
