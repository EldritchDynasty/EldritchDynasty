import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Genome, Person } from '@ed/schema';
import { bootstrap, runYears } from './sim.js';
import { expectHealthyWorld } from './testing.js';

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

function mutatedAt(genome: Genome, locus: string): boolean {
  return genome.mutations.some((m) => String(m.locus) === locus);
}

describe('founding inheritance', () => {
  const founderSeed = bundle.characters.find((s) => s.key === 'founder')!;
  const seededChildren = bundle.characters.filter((s) => s.motherKey && s.fatherKey);
  const foundingDaughters = seededChildren.filter(
    (s) => s.fatherKey === founderSeed.key && s.sex === 'female',
  );

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
          if (mutatedAt(daughter, locus)) continue;
          expect(
            daughter.sex[1]![i],
            `${seed.name}, sample ${sample}, ${locus}: paternal X did not come from ${founderSeed.name}`,
          ).toBe(father.sex[0][i]);
          compared++;
        }
      }
    }

    expect(compared, 'the paternal-X assertion never compared a locus').toBeGreaterThan(100);
  });

  it('builds each seeded child from one maternal and one paternal autosomal allele at every unmutated locus', () => {
    // Child bias deliberately applies after conception. Strip only those
    // child-local nudges here so this test isolates the inheritance mechanism
    // rather than asking an authored post-conception nudge to masquerade as a
    // mutation. The shipped-content test above keeps the real biases and pins
    // the X property that those biases must not overwrite.
    const inheritanceBundle = {
      ...bundle,
      characters: bundle.characters.map((s) => (
        s.motherKey && s.fatherKey ? { ...s, bias: {} } : s
      )),
    };

    let compared = 0;
    for (let sample = 0; sample < 24; sample++) {
      const ctx = bootstrap(inheritanceBundle, 44_300 + sample);

      for (const seed of seededChildren) {
        const child = genomeOf(personNamed(ctx, seed.name));
        const motherSeed = bundle.characters.find((s) => s.key === seed.motherKey)!;
        const fatherSeed = bundle.characters.find((s) => s.key === seed.fatherKey)!;
        const mother = genomeOf(personNamed(ctx, motherSeed.name));
        const father = genomeOf(personNamed(ctx, fatherSeed.name));

        for (let i = 0; i < ctx.genetics.table.autosomal.length; i++) {
          const locus = String(ctx.genetics.table.autosomal[i]!.id);
          if (mutatedAt(child, locus)) continue;

          expect(
            [mother.autosomal[0][i], mother.autosomal[1][i]],
            `${seed.name}, sample ${sample}, ${locus}: maternal allele is not from the mother`,
          ).toContain(child.autosomal[0][i]);
          expect(
            [father.autosomal[0][i], father.autosomal[1][i]],
            `${seed.name}, sample ${sample}, ${locus}: paternal allele is not from the father`,
          ).toContain(child.autosomal[1][i]);
          compared += 2;
        }
      }
    }

    expect(compared, 'the autosomal assertion never compared a locus').toBeGreaterThan(1_000);
  });

  it('keeps a played world internally healthy after seeded inheritance is real', () => {
    // Sampled THROUGH the founding century rather than only at its end: the
    // conceived children marry and breed in its first decades, and a world
    // that goes incoherent there and recovers would pass a tail-only check.
    for (const seed of [344_997, 344_998, 344_999]) {
      const ctx = bootstrap(bundle, seed);
      for (let decade = 0; decade < 10; decade++) {
        runYears(ctx, 10);
        expectHealthyWorld(ctx);
      }
    }
  });
});
