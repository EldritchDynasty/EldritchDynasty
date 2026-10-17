import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Person } from '@ed/schema';
import {
  bootstrap, buildLocusTable, coupleFertility, deriveVitality, expectedAttribute,
  expressAttributes, fertilityByAge, genomeOf, phenotypeOf, place, runYears, testWorld,
} from '@ed/core';
import type { VitalityInput } from '@ed/core';

const bundle = loadContent();

describe('attribute mechanism witnesses', () => {
  it('applies sexual dimorphism as opposite shifts without touching undeclared attributes', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const table = buildLocusTable(bundle.loci);
    const flat = bundle.attributes.map((def) => ({ ...def, dimorphism: 0 }));
    const male: number[] = [];
    const female: number[] = [];

    for (const person of ctx.world.people.all()) {
      const genome = genomeOf(person, ctx.genetics);
      const shifted = expressAttributes(genome, person.sex, table, bundle.attributes, {
        awakened: person.awakening.awakened,
      });
      const baseline = expressAttributes(genome, person.sex, table, flat, {
        awakened: person.awakening.awakened,
      });
      const delta = (shifted.get('strength') ?? 0) - (baseline.get('strength') ?? 0);
      (person.sex === 'male' ? male : female).push(delta);

      for (const id of ['charm', 'fecundity']) {
        expect(shifted.get(id), `${person.name}/${id}`).toBeCloseTo(baseline.get(id) ?? 0, 8);
      }
    }

    expect(male.some((delta) => delta > 0)).toBe(true);
    expect(female.some((delta) => delta < 0)).toBe(true);
  });

  it('derives the fecundity centre from the locus table', () => {
    const table = buildLocusTable(bundle.loci);
    const ctx = bootstrap(bundle, 1042, 1042);
    expect(ctx.genetics.expected.get('fecundity'))
      .toBeCloseTo(expectedAttribute(table, 'fecundity'), 6);
  });
});

describe('fertility formula witnesses', () => {
  it('keeps the female cliff, male slope, and zero-childhood rule', () => {
    expect(fertilityByAge('female', 22)).toBeCloseTo(1, 2);
    expect(fertilityByAge('female', 42)).toBeLessThan(0.25);
    expect(fertilityByAge('female', 50)).toBe(0);
    expect(fertilityByAge('male', 50)).toBeGreaterThan(0.6);
    expect(fertilityByAge('female', 8)).toBe(0);
    expect(fertilityByAge('male', 8)).toBe(0);
  });

  it('makes couple fertility multiplicative and mother-weighted', () => {
    expect(coupleFertility(0, 140)).toBe(0);
    expect(coupleFertility(140, 0)).toBe(0);
    expect(coupleFertility(100, 100)).toBeCloseTo(1, 5);
    expect(coupleFertility(80, 80)).toBeCloseTo(0.8, 5);
    expect(coupleFertility(60, 100)).toBeLessThan(coupleFertility(100, 60));
  });

  it('does not make women less healthy solely because strength is dimorphic', () => {
    const range = (id: string) => bundle.attributes.find((def) => def.id === id)!.range;
    const body = (over: Partial<VitalityInput>): VitalityInput => ({
      sex: 'female',
      age: 22,
      maxAge: 100,
      strength: 30,
      strengthMean: 30,
      fecundity: 26,
      fecundityMean: 26,
      madness: 0,
      mind: 20,
      curses: 0,
      acquiredHealth: 0,
      acquiredFertility: 0,
      ...over,
    });

    const man = deriveVitality(body({ sex: 'male', strength: 43, strengthMean: 43 }), {
      health: range('health'), fertility: range('fertility'),
    });
    const woman = deriveVitality(body({ sex: 'female', strength: 17, strengthMean: 17 }), {
      health: range('health'), fertility: range('fertility'),
    });

    expect(woman.health).toBeCloseTo(man.health, 5);
  });
});

/**
 * #1641: the genome's own expression is carried between years rather than
 * re-read from every locus each spring. Invariant 6 still holds only if what
 * is carried is exactly what a fresh derivation would produce — so every test
 * here compares the cached phenotype against one built from nothing.
 */

function fresh(p: Person, ctx: ReturnType<typeof testWorld>) {
  const kept = p.phenotype;
  p.phenotype = undefined;
  const derived = phenotypeOf(p, ctx.genetics, ctx.world.year);
  p.phenotype = kept;
  return { attrs: [...derived.attrs], eldritch: derived.eldritch };
}

function cached(p: Person, ctx: ReturnType<typeof testWorld>) {
  const ph = phenotypeOf(p, ctx.genetics, ctx.world.year);
  return { attrs: [...ph.attrs], eldritch: ph.eldritch };
}

describe('the carried genomic expression (#1641)', () => {
  it('is reused across a new year and a dirty mark, and the life layers still move', () => {
    const ctx = testWorld(bundle, 16410, 1042);
    const p = place(ctx, { sex: 'female', age: 30, name: 'Carried' });
    const first = phenotypeOf(p, ctx.genetics, ctx.world.year).genomic;
    expect(first, 'no genomic expression was carried').toBeDefined();

    ctx.world.year += 1;
    expect(phenotypeOf(p, ctx.genetics, ctx.world.year).genomic).toBe(first);

    const before = phenotypeOf(p, ctx.genetics, ctx.world.year).attrs.get('strength') ?? 0;
    p.acquired = { ...p.acquired, strength: (p.acquired?.strength ?? 0) + 5 };
    p.phenotype!.dirty = true;
    const after = phenotypeOf(p, ctx.genetics, ctx.world.year);
    expect(after.genomic, 'a dirty mark re-read the genome').toBe(first);
    expect(after.attrs.get('strength') ?? 0).not.toBe(before);
    expect(cached(p, ctx)).toEqual(fresh(p, ctx));
  });

  it('is re-read when Awakening changes what the genome expresses', () => {
    const ctx = testWorld(bundle, 16411, 1042);
    const p = place(ctx, { sex: 'male', age: 16, name: 'Waking' });
    const asleep = phenotypeOf(p, ctx.genetics, ctx.world.year);
    const mindAsleep = asleep.attrs.get('mind') ?? 0;

    p.awakening = { ...p.awakening, awakened: true, year: ctx.world.year, age: 16 };
    ctx.world.year += 1;
    const awake = phenotypeOf(p, ctx.genetics, ctx.world.year);
    expect(awake.genomic).not.toBe(asleep.genomic);
    expect(awake.attrs.get('mind') ?? 0).toBeGreaterThanOrEqual(mindAsleep);
    expect(cached(p, ctx)).toEqual(fresh(p, ctx));
  });

  it('is re-read when the cache is dropped after an in-place genome edit', () => {
    const ctx = testWorld(bundle, 16412, 1042);
    const p = place(ctx, { sex: 'male', age: 25, name: 'Edited' });
    const before = phenotypeOf(p, ctx.genetics, ctx.world.year);

    const { table } = ctx.genetics;
    const g = genomeOf(p, ctx.genetics);
    for (const i of table.fontIndices) {
      const alleles = table.xAlleles[i]!;
      g.sex[0][i] = alleles.reduce((best, a, at) => (a.effect > alleles[best]!.effect ? at : best), 0);
    }
    p.phenotype = undefined;

    const after = phenotypeOf(p, ctx.genetics, ctx.world.year);
    expect(after.genomic).not.toBe(before.genomic);
    expect(after.eldritch.carriedFont).toBeGreaterThanOrEqual(before.eldritch.carriedFont);
    expect(cached(p, ctx)).toEqual(fresh(p, ctx));
  });

  it('matches a fresh derivation for every living person through a played century', () => {
    const ctx = bootstrap(bundle, 16413, 1042);
    let checked = 0;
    for (let decade = 0; decade < 10; decade++) {
      runYears(ctx, 10);
      for (const p of ctx.world.people.living()) {
        // Only people the run has already expressed carry anything to check.
        if (!p.phenotype?.genomic) continue;
        expect(cached(p, ctx), `${p.name} in ${ctx.world.year}`).toEqual(fresh(p, ctx));
        checked++;
      }
    }
    expect(checked, 'the run expressed nobody').toBeGreaterThan(100);
  });
});
