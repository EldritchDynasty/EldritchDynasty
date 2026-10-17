import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Person } from '@ed/schema';
import { bootstrap, genomeOf, phenotypeOf, place, runYears, testWorld } from '@ed/core';

/**
 * #1641: the genome's own expression is carried between years rather than
 * re-read from every locus each spring. Invariant 6 still holds only if what
 * is carried is exactly what a fresh derivation would produce — so every test
 * here compares the cached phenotype against one built from nothing.
 */

const content = loadContent();

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
    const ctx = testWorld(content, 16410, 1042);
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
    const ctx = testWorld(content, 16411, 1042);
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
    const ctx = testWorld(content, 16412, 1042);
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
    const ctx = bootstrap(content, 16413, 1042);
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
