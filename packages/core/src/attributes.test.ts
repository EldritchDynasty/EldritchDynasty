import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  bootstrap, buildLocusTable, coupleFertility, deriveVitality, expectedAttribute,
  expressAttributes, fertilityByAge, genomeOf,
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
