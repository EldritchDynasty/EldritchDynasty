/**
 * Temporary measurement for issue #344. Removed before landing.
 *
 * The founder's authored eldritch bias was calibrated before his children
 * actually inherited his blood. This prints the founder and first generation
 * across the same candidate strengths so the content comment can be re-based
 * on the mechanism that now exists.
 */
import { loadContent } from '@ed/content';
import { bootstrap, phenotypeOf } from '@ed/core';

const strengths = [0, 0.1, 0.2, 0.35];
const RUNS = 40;
const SEED0 = 344_000;

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / (xs.length || 1);
}

for (const strength of strengths) {
  const bundle = structuredClone(loadContent());
  const founderSeed = bundle.characters.find((s) => s.key === 'founder');
  if (!founderSeed) throw new Error('no founder seed');
  founderSeed.bias = { ...founderSeed.bias, eldritch_power: strength };

  const founderFont: number[] = [];
  const founderPower: number[] = [];
  const daughterFont: number[] = [];
  const sonFont: number[] = [];
  const sonPower: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const ctx = bootstrap(bundle, SEED0 + i);
    const byName = new Map(ctx.world.people.all().map((p) => [p.name, p]));
    const profile = (name: string) => {
      const person = byName.get(name);
      if (!person) throw new Error(`missing ${name}`);
      return phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch;
    };

    const founder = profile('Daveed Gearithy');
    const rhoswen = profile('Rhoswen');
    const tamsin = profile('Tamsin');
    const aldous = profile('Aldous');

    founderFont.push(founder.carriedFont);
    founderPower.push(founder.expressedPower);
    daughterFont.push(rhoswen.carriedFont, tamsin.carriedFont);
    sonFont.push(aldous.carriedFont);
    sonPower.push(aldous.expressedPower);
  }

  console.log(
    [
      `bias ${strength.toFixed(2)}`,
      `founder font ${mean(founderFont).toFixed(1)}`,
      `power ${mean(founderPower).toFixed(1)}`,
      `daughters font ${mean(daughterFont).toFixed(1)}`,
      `Aldous font ${mean(sonFont).toFixed(1)}`,
      `power ${mean(sonPower).toFixed(1)}`,
    ].join(' | '),
  );
}
