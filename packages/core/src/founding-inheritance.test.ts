import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Genome, Person } from '@ed/schema';
import { bootstrap } from './sim.js';
import { conceive, meiosis } from './genetics/meiosis.js';
import { conceptionSeed, makeRng } from './rng.js';

const bundle = loadContent();

function personNamed(ctx: ReturnType<typeof bootstrap>, name: string): Person {
  const person = ctx.world.people.all().find((p) => p.name === name);
  if (!person) throw new Error(`seed person "${name}" was not bootstrapped`);
  return person;
}

function genomeOf(person: Person): Genome {
  if (person.genome.kind !== 'materialized') {
    throw new Error(`seed person ${person.name} has a lazy genome`);
  }
  return person.genome.genome;
}

function mutationExplains(
  genome: Genome,
  locus: string,
  fromAlleles: readonly string[],
  toAllele: string,
): boolean {
  return genome.mutations.some((m) =>
    String(m.locus) === locus
      && fromAlleles.includes(String(m.from))
      && String(m.to) === toAllele
  );
}

describe('founding inheritance', () => {
  const founderSeed = bundle.characters.find((s) => s.key === 'founder')!;
  const seededChildren = bundle.characters.filter((s) => s.motherKey && s.fatherKey);
  const foundingDaughters = seededChildren.filter(
    (s) => s.fatherKey === founderSeed.key && s.sex === 'female',
  );

  it('fails instead of rolling an unrelated genome when a seeded parent cannot resolve', () => {
    const broken = {
      ...bundle,
      characters: bundle.characters.map((seed) => (
        seed.key === 'daughter_elder'
          ? { ...seed, motherKey: 'missing_seed_parent' }
          : seed
      )),
    };

    expect(() => bootstrap(broken, 34_299))
      .toThrow('seed child daughter_elder could not resolve mother missing_seed_parent');
  });

  it('uses the authored child sex to choose the father\'s X or Y', () => {
    for (let sample = 0; sample < 16; sample++) {
      const ctx = bootstrap(bundle, 34_300 + sample);
      for (const seed of seededChildren) {
        const child = genomeOf(personNamed(ctx, seed.name));
        if (seed.sex === 'female') expect(child.sex[1], seed.name).not.toBeNull();
        else expect(child.sex[1], seed.name).toBeNull();
      }
    }
  });

  it('does not restart a seeded conception ordinal when the mother has a different father', () => {
    const changed = {
      ...bundle,
      characters: bundle.characters.map((seed) => (
        seed.key === 'daughter_younger'
          ? { ...seed, fatherKey: 'cadet_brother', bias: {} }
          : seed
      )),
    };
    const childSeed = changed.characters.find((seed) => seed.key === 'daughter_younger')!;
    const motherSeed = changed.characters.find((seed) => seed.key === childSeed.motherKey)!;
    const fatherSeed = changed.characters.find((seed) => seed.key === childSeed.fatherKey)!;

    const runSeed = 64_299;
    const ctx = bootstrap(changed, runSeed);
    const child = genomeOf(personNamed(ctx, childSeed.name));
    const motherPerson = personNamed(ctx, motherSeed.name);
    const fatherPerson = personNamed(ctx, fatherSeed.name);
    const mother = genomeOf(motherPerson);
    const father = genomeOf(fatherPerson);

    // Rhoswen (1029) and Aldous (1031) are already this mother's children.
    // Runtime birth code therefore calls this conception ordinal 3 even
    // though Tamsin's synthetic father differs from theirs.
    const ordinal = 3;
    const rng = makeRng(conceptionSeed(runSeed, String(motherPerson.id), String(fatherPerson.id), ordinal));
    const expected = conceive(
      meiosis(mother, ctx.genetics.table, 'female', rng, childSeed.born),
      meiosis(father, ctx.genetics.table, 'male', rng, childSeed.born, childSeed.sex),
      ctx.genetics.table,
    ).genome;

    expect(Array.from(child.autosomal[0])).toEqual(Array.from(expected.autosomal[0]));
    expect(Array.from(child.autosomal[1])).toEqual(Array.from(expected.autosomal[1]));
    expect(Array.from(child.sex[0])).toEqual(Array.from(expected.sex[0]));
    expect(Array.from(child.sex[1] ?? [])).toEqual(Array.from(expected.sex[1] ?? []));
    expect(child.mutations).toEqual(expected.mutations);
  });

  it('uses the normal conception stream and sibling ordinal for an unbiased seeded child', () => {
    const seed = bundle.characters.find((s) => s.key === 'daughter_elder')!;
    expect(seed.bias).toEqual({});
    const siblings = seededChildren
      .filter((s) => s.motherKey === seed.motherKey && s.fatherKey === seed.fatherKey)
      .sort((a, b) => a.born - b.born || a.key.localeCompare(b.key));
    const ordinal = siblings.findIndex((s) => s.key === seed.key) + 1;
    expect(ordinal).toBeGreaterThan(0);

    for (let sample = 0; sample < 8; sample++) {
      const runSeed = 64_300 + sample;
      const ctx = bootstrap(bundle, runSeed);
      const child = genomeOf(personNamed(ctx, seed.name));
      const motherSeed = bundle.characters.find((s) => s.key === seed.motherKey)!;
      const fatherSeed = bundle.characters.find((s) => s.key === seed.fatherKey)!;
      const motherPerson = personNamed(ctx, motherSeed.name);
      const fatherPerson = personNamed(ctx, fatherSeed.name);
      const mother = genomeOf(motherPerson);
      const father = genomeOf(fatherPerson);
      const rng = makeRng(conceptionSeed(runSeed, String(motherPerson.id), String(fatherPerson.id), ordinal));
      const expected = conceive(
        meiosis(mother, ctx.genetics.table, 'female', rng, seed.born),
        meiosis(father, ctx.genetics.table, 'male', rng, seed.born, seed.sex),
        ctx.genetics.table,
      ).genome;

      expect(Array.from(child.autosomal[0]), `sample ${sample}: maternal autosomes`)
        .toEqual(Array.from(expected.autosomal[0]));
      expect(Array.from(child.autosomal[1]), `sample ${sample}: paternal autosomes`)
        .toEqual(Array.from(expected.autosomal[1]));
      expect(Array.from(child.sex[0]), `sample ${sample}: maternal X`)
        .toEqual(Array.from(expected.sex[0]));
      expect(Array.from(child.sex[1] ?? []), `sample ${sample}: paternal X`)
        .toEqual(Array.from(expected.sex[1] ?? []));
      expect(child.mutations, `sample ${sample}: mutation provenance`).toEqual(expected.mutations);
    }
  });

  it('passes the founder\'s single X intact to every seeded daughter, except recorded mutations', () => {
    let compared = 0;

    for (let sample = 0; sample < 32; sample++) {
      const ctx = bootstrap(bundle, 34_400 + sample);
      const father = genomeOf(personNamed(ctx, founderSeed.name));

      for (const seed of foundingDaughters) {
        const daughter = genomeOf(personNamed(ctx, seed.name));
        expect(daughter.sex[1], `${seed.name} is authored female but has no paternal X`).not.toBeNull();

        for (let i = 0; i < ctx.genetics.table.x.length; i++) {
          const locus = String(ctx.genetics.table.x[i]!.id);
          const actual = daughter.sex[1]![i]!;
          const inherited = father.sex[0][i]!;
          if (actual !== inherited) {
            const alleles = ctx.genetics.table.xAlleles[i]!;
            expect(
              mutationExplains(
                daughter,
                locus,
                [String(alleles[inherited]!.id)],
                String(alleles[actual]!.id),
              ),
              `${seed.name}, sample ${sample}, ${locus}: paternal X is neither `
                + `the founder's allele nor explained by a matching mutation`,
            ).toBe(true);
          }
          compared++;
        }
      }
    }

    expect(compared, 'the paternal-X assertion never compared a locus').toBeGreaterThan(100);
  });

  it('builds each seeded child from one maternal and one paternal autosomal allele at every unmutated locus', () => {
    // Deliberately use the SHIPPED child biases here. The regression is not
    // allowed to make provenance true by deleting the authored tendency that
    // used to rewrite a conceived genome after fertilisation.
    let compared = 0;
    for (let sample = 0; sample < 24; sample++) {
      const ctx = bootstrap(bundle, 44_300 + sample);

      for (const seed of seededChildren) {
        const child = genomeOf(personNamed(ctx, seed.name));
        const motherSeed = bundle.characters.find((s) => s.key === seed.motherKey)!;
        const fatherSeed = bundle.characters.find((s) => s.key === seed.fatherKey)!;
        const mother = genomeOf(personNamed(ctx, motherSeed.name));
        const father = genomeOf(personNamed(ctx, fatherSeed.name));

        for (let i = 0; i < ctx.genetics.table.autosomal.length; i++) {
          const locus = String(ctx.genetics.table.autosomal[i]!.id);
          const alleles = ctx.genetics.table.autosomalAlleles[i]!;

          const assertParentOrMutation = (
            actual: number,
            parentAlleles: readonly number[],
            side: 'maternal' | 'paternal',
          ) => {
            if (parentAlleles.includes(actual)) return;
            expect(
              mutationExplains(
                child,
                locus,
                parentAlleles.map((index) => String(alleles[index]!.id)),
                String(alleles[actual]!.id),
              ),
              `${seed.name}, sample ${sample}, ${locus}: ${side} allele is neither from `
                + `the named parent nor explained by a matching mutation`,
            ).toBe(true);
          };

          assertParentOrMutation(
            child.autosomal[0][i]!,
            [mother.autosomal[0][i]!, mother.autosomal[1][i]!],
            'maternal',
          );
          assertParentOrMutation(
            child.autosomal[1][i]!,
            [father.autosomal[0][i]!, father.autosomal[1][i]!],
            'paternal',
          );
          compared += 2;
        }
      }
    }

    expect(compared, 'the autosomal assertion never compared a locus').toBeGreaterThan(1_000);
  });

  it('keeps two-parent authored bias live without inventing an allele', () => {
    const biasedChildren = seededChildren.filter((s) => Object.keys(s.bias).length > 0);
    expect(biasedChildren.length).toBeGreaterThan(0);

    const unbiasedBundle = {
      ...bundle,
      characters: bundle.characters.map((s) => (
        s.motherKey && s.fatherKey ? { ...s, bias: {} } : s
      )),
    };

    let changedChildren = 0;
    for (let sample = 0; sample < 24; sample++) {
      const seedValue = 54_300 + sample;
      const biased = bootstrap(bundle, seedValue);
      const unbiased = bootstrap(unbiasedBundle, seedValue);

      for (const seed of biasedChildren) {
        const a = genomeOf(personNamed(biased, seed.name));
        const b = genomeOf(personNamed(unbiased, seed.name));
        const differs =
          a.autosomal[0].some((allele, i) => allele !== b.autosomal[0][i])
          || a.autosomal[1].some((allele, i) => allele !== b.autosomal[1][i])
          || a.sex[0].some((allele, i) => allele !== b.sex[0][i])
          || (a.sex[1]?.some((allele, i) => allele !== b.sex[1]?.[i]) ?? false);
        if (differs) changedChildren++;
      }
    }

    // This is not a calibration floor. It only catches the tempting "fix" of
    // satisfying provenance by silently dropping every two-parent child bias.
    expect(changedChildren).toBeGreaterThan(10);
  });

  it('biases inheritance without splicing a chromosome between crossovers', () => {
    const ctx = bootstrap(bundle, 74_300);
    const table = ctx.genetics.table;
    const strength = (table.byAttribute.get('strength') ?? [])
      .filter((x) => x.where === 'autosomal' && x.locus.chromosome === 1);
    expect(strength.length).toBeGreaterThan(2);

    const first = new Int16Array(table.autosomal.length);
    const second = new Int16Array(table.autosomal.length);

    // Alternate which homologue owns the locally best strength allele. With
    // zero crossovers, a real gamete must still carry ONE whole parental
    // chromosome. The old #344 helper failed this shape: it picked the best
    // parental allele independently at every locus, manufacturing an
    // alternating haplotype with no crossover that could have produced it.
    strength.forEach((contribution, ordinal) => {
      const alleles = table.autosomalAlleles[contribution.index]!;
      const ranked = alleles
        .map((allele, index) => ({
          index,
          value: contribution.locus.kind === 'deleterious'
            ? (allele.tags.includes('deleterious') || allele.tags.includes('lethal_homozygous') ? -1 : 0)
            : allele.effect * contribution.weight,
        }))
        .sort((a, b) => b.value - a.value);
      const best = ranked[0]!.index;
      const worst = ranked[ranked.length - 1]!.index;
      if (ordinal % 2 === 0) {
        first[contribution.index] = best;
        second[contribution.index] = worst;
      } else {
        first[contribution.index] = worst;
        second[contribution.index] = best;
      }
    });

    const parent: Genome = {
      autosomal: [first, second],
      sex: [new Int16Array(table.x.length), new Int16Array(table.x.length)],
      mutations: [],
    };

    const base = makeRng(74_301);
    const noCrossover = {
      ...base,
      poisson: () => 0,
      // Bias/start coins (>= 0.5) take the first homologue; tiny mutation
      // probabilities do not fire.
      bool: (p: number) => p >= 0.5,
    };

    const gamete = meiosis(
      parent,
      table,
      'female',
      noCrossover,
      1042,
      undefined,
      { strength: 1 },
    );

    const chromosomeOne = table.autosomal
      .map((locus, index) => ({ locus, index }))
      .filter(({ locus }) => locus.chromosome === 1)
      .map(({ index }) => index);

    expect(chromosomeOne.length).toBeGreaterThan(2);
    const wholeFirst = chromosomeOne.every((index) => gamete.autosomal[index] === first[index]);
    const wholeSecond = chromosomeOne.every((index) => gamete.autosomal[index] === second[index]);
    expect(wholeFirst || wholeSecond).toBe(true);
    expect(gamete.mutations).toEqual([]);
  });
});
