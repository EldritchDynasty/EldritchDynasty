import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { createWorld } from './world.js';

const bundle = loadContent();

describe('world houses own their mutable state (#980)', () => {
  it('copies authored house definitions deeply instead of sharing them between runs', () => {
    const original = bundle.houses.find((h) => h.id === 'house_marrow')!;
    expect(original).toBeDefined();
    const authoredSnapshot = structuredClone(original);

    const firstWorld = createWorld(bundle, 980, 1042);
    const secondWorld = createWorld(bundle, 981, 1042);
    const first = firstWorld.houses.get(original.id)!;
    const second = secondWorld.houses.get(original.id)!;

    // Before a world changes anything, its rules are exactly the authored
    // ones. Ownership of the values — not the values themselves — differs.
    expect(first).toEqual(original);
    expect(second).toEqual(original);
    expect(first).not.toBe(original);
    expect(first).not.toBe(second);
    expect(first.motives).not.toBe(original.motives);
    expect(first.motives[0]).not.toBe(original.motives[0]);
    expect(first.motives[0]?.wants).not.toBe(original.motives[0]?.wants);
    expect(first.genePool).not.toBe(original.genePool);
    expect(first.genePool.frequencies['death_1']).not.toBe(original.genePool.frequencies['death_1']);
    expect(first.genePool.frequencies['death_1']?.[0])
      .not.toBe(original.genePool.frequencies['death_1']?.[0]);

    first.name = 'A house renamed inside one world';
    first.motives[0]!.wants.push('unreviewed_preference');
    first.genePool.frequencies['death_1']![0]!.p = 0.99;

    // The source still satisfies its original fingerprints, and a second
    // seed cannot inherit another world's changed name, motive or blood.
    expect(bundle.houses.find((h) => h.id === original.id)).toEqual(authoredSnapshot);
    expect(second).toEqual(authoredSnapshot);
    expect(second.name).toBe('House Marrow');
  });
});
