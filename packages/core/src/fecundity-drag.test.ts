import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import {
  FECUNDITY_DRAG_COUPLING, attr, bootstrap, buildLocusTable,
  dragFecundityContribution, expectedAttribute, genomeOf, place, testWorld,
} from '@ed/core';
import { coupledBundle, phaseFounders, pleiotropicWeight } from './tools/drag-gate.js';

// DRIVES_A_BATCH: drag-gate helpers phase and replay whole campaign batches; keep this suite in the fast lane because these assertions exercise only structural setup and expected-value calibration, not the sampled gate loop.

const contentBundle = loadContent();
const table = buildLocusTable(contentBundle.loci);
const dragLoci = table.x.filter((l) => l.kind === 'fecundity_drag');
const dragIds = dragLoci.map((l) => String(l.id));

describe('fecundity drag, shipped mechanism', () => {
  it('ships inert while retaining one linked negative drag locus per font locus', () => {
    expect(FECUNDITY_DRAG_COUPLING).toBe(0);

    const fonts = table.x.filter((l) => l.kind === 'eldritch_font');
    expect(dragLoci.length, 'no fecundity-drag loci authored').toBe(fonts.length);

    for (const font of fonts) {
      const id = String(font.id);
      const drag = table.x.find((l) => l.id === `fecundity_drag_${id.replace('font_', '')}`);
      expect(drag, `no drag locus paired with ${id}`).toBeDefined();
      const distance = Math.abs(drag!.position - font.position);
      expect(distance, `${id} and its drag locus are not linked`).toBeLessThan(10);
      expect(distance, `${id} and its drag locus occupy the same position`).toBeGreaterThan(0);
    }

    const contributors = table.byAttribute.get('fecundity') ?? [];
    const viaDrag = contributors.filter((c) => c.locus.kind === 'fecundity_drag');
    expect(viaDrag).toHaveLength(dragLoci.length);
    for (const contribution of viaDrag) expect(contribution.weight).toBeLessThan(0);
  });

  it('cannot move production fecundity at the shipped zero coupling', () => {
    const ctx = testWorld(contentBundle, 55221, 1042);
    const person = place(ctx, { sex: 'female', age: 25, name: 'A Woman' });
    const before = attr(person, 'fecundity', ctx.genetics, ctx.world.year);

    const genome = person.genome.kind === 'materialized' ? person.genome.genome : undefined;
    expect(genome, 'genome did not materialize').toBeDefined();

    for (const id of dragIds) {
      const idx = table.xIndex.get(id)!;
      const strong = table.xAlleles[idx]!.findIndex((a) => a.id === `${id}_strong`);
      expect(strong, `no strong allele for ${id}`).toBeGreaterThanOrEqual(0);
      genome!.sex[0][idx] = strong;
      genome!.sex[1]![idx] = strong;
    }
    person.phenotype!.dirty = true;

    expect(attr(person, 'fecundity', ctx.genetics, ctx.world.year)).toBe(before);
    expect(dragFecundityContribution(genome!, table, 0)).toBe(0);
    expect(dragFecundityContribution(genome!, table, 1)).toBeLessThan(0);
  });

  it('the gate phasing variant makes font and drag travel on the same founding haplotypes', () => {
    const bundle = loadBundle();
    const ctx = bootstrap(bundle, 1000, 1042);
    phaseFounders(ctx, bundle);
    const t = ctx.genetics.table;

    for (const person of ctx.world.people.blood(ctx.world.playerHouse)) {
      const genome = genomeOf(person, ctx.genetics);
      for (const id of dragIds) {
        const drag = t.xIndex.get(id)!;
        const font = t.xIndex.get(`font_${id.replace('fecundity_drag_', '')}`)!;
        for (const hap of [genome.sex[0], genome.sex[1]]) {
          if (!hap) continue;
          const hot = (t.xAlleles[font]![hap[font]!]?.effect ?? 0) > 0;
          const dragged = (t.xAlleles[drag]![hap[drag]!]?.effect ?? 0) > 0;
          expect(dragged, `${person.name}'s ${id} is out of phase with its font`).toBe(hot);
        }
      }
    }
  });
});

describe('fecundity drag, pleiotropic gate variant', () => {
  it('does not exist in shipped content and becomes structural when enabled by the gate', () => {
    const base = loadBundle();
    const shippedFonts = base.loci.filter((l) => l.kind === 'eldritch_font');
    expect(shippedFonts.length).toBeGreaterThan(0);
    for (const locus of shippedFonts) expect(locus.contributes, String(locus.id)).toEqual([]);

    const hot = coupledBundle(base, 2, { mode: 'pleiotropic' });
    const hotFonts = hot.loci.filter((l) => l.kind === 'eldritch_font');
    for (const locus of hotFonts) {
      const fecundity = locus.contributes.filter((c) => String(c.attr) === 'fecundity');
      expect(fecundity, String(locus.id)).toHaveLength(1);
      expect(fecundity[0]!.weight, String(locus.id)).toBeLessThan(0);
    }

    expect(hot.loci.filter((l) => l.kind === 'fecundity_drag'))
      .toEqual(base.loci.filter((l) => l.kind === 'fecundity_drag'));
  });

  it('calibrates pleiotropic k=1 to the same population tax as linked k=1', () => {
    const base = loadBundle();
    const centre = (b: { loci: typeof base.loci }) =>
      expectedAttribute(buildLocusTable(b.loci), 'fecundity');

    const shipped = centre(base);
    const linked = centre(coupledBundle(base, 1, { mode: 'linked' }));
    const pleiotropic = centre(coupledBundle(base, 1, { mode: 'pleiotropic' }));

    expect(linked).toBeLessThan(shipped);
    expect(pleiotropic).toBeCloseTo(linked, 4);
    expect(pleiotropicWeight(base)).toBeGreaterThan(0);
  });
});
