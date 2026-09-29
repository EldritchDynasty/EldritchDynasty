/**
 * Temporary diagnostics for issue #344. Removed before landing.
 */
import { loadContent } from '@ed/content';
import { bootstrap, phenotypeOf, runYears } from '@ed/core';
import { stepYear } from '../year/step.js';
import { gateEndings } from './ending-gate.js';

const mode = process.argv[2] ?? 'calibration';
const bundle = loadContent();
const founderSeed = bundle.characters.find((s) => s.key === 'founder');
if (!founderSeed) throw new Error('no founder seed');
const authoredBias = { ...founderSeed.bias };

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / (xs.length || 1);
}

function livingPlayerBlood(ctx: ReturnType<typeof bootstrap>): number {
  return ctx.world.people.all().filter((p) =>
    p.died === undefined
    && p.membership.some((m) =>
      m.house === ctx.world.playerHouse && (m.kind === 'blood' || m.kind === 'cadet')
    )
  ).length;
}

if (mode === 'calibration') {
  const strengths = [0, 0.1, 0.2, 0.35];
  const RUNS = 40;
  const SEED0 = 344_000;

  for (const strength of strengths) {
    founderSeed.bias = { ...authoredBias, eldritch_power: strength };

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
  founderSeed.bias = authoredBias;
}

if (mode === 'fixtures') {
  // The long suites deliberately carry survivor/peacetime fixtures. Real
  // inheritance re-rolls whole histories, so print replacement candidates
  // rather than guessing which old seed still means what the test says.
  const survivorCandidates = Array.from({ length: 80 }, (_, i) => 900 + i);
  const survivors: string[] = [];
  for (const seed of survivorCandidates) {
    const ctx = bootstrap(bundle, seed, 1042);
    let dead = 0;
    let maxDead = 0;
    for (let i = 0; i < 500; i++) {
      stepYear(ctx);
      if (ctx.world.age.active.length === 0) {
        dead++;
        maxDead = Math.max(maxDead, dead);
      } else dead = 0;
    }
    if (livingPlayerBlood(ctx) > 0 && maxDead <= 250 && ctx.world.frame.entries.length > 0) {
      survivors.push(`${seed}(frame=${ctx.world.frame.entries.length},gap=${maxDead},blood=${livingPlayerBlood(ctx)})`);
    }
  }
  console.log('SURVIVOR CANDIDATES', survivors.slice(0, 30).join(' '));

  const peacetime: number[] = [];
  for (let i = 0; i < 50; i++) {
    const seed = 6000 + i * 7;
    const ctx = bootstrap(bundle, seed, 1042);
    runYears(ctx, 400);
    if (ctx.world.muster.commitments.length === 0) peacetime.push(seed);
  }
  console.log('PEACETIME CANDIDATES', peacetime.slice(0, 20).join(','));

  const wideSeeds = [
    902, 904, 905, 916, 918, 919, 920, 921, 924, 927, 928,
    930, 931, 932, 934, 940, 941, 942, 943, 950,
  ];
  for (const seed of wideSeeds) {
    const ctx = bootstrap(bundle, seed, 1042);
    runYears(ctx, 500);
    const count = ctx.world.people.all().filter(
      (p) => p.sex === 'female'
        && (p.died ?? ctx.world.year) - p.born > 45
        && p.marriages[0] !== undefined
        && ctx.world.people.get(p.marriages[0]!.spouse) !== undefined
    ).length;
    if (count <= 60) console.log(`THIN COUPLE FIXTURE ${seed}: ${count}`);
  }

  const farEnd = 'eight_days_and_then_it_did';
  const hits: number[] = [];
  for (let i = 0; i < 240; i++) {
    const seed = 5000 + i * 7;
    const ctx = bootstrap(bundle, seed, 1042);
    runYears(ctx, 500);
    if ((ctx.world.frequency.templateFires[farEnd] ?? 0) > 0) hits.push(seed);
  }
  console.log('EIGHT-DAYS FAR-END HITS', hits.join(',') || '(none)');
}

if (mode === 'endings') {
  const strength = Number(process.argv[3]);
  if (!Number.isFinite(strength)) throw new Error('endings mode needs a numeric founder bias');
  founderSeed.bias = { ...authoredBias, eldritch_power: strength };
  console.log(`=== ENDINGS WITH FOUNDER BIAS ${strength} ===`);
  const verdict = gateEndings(bundle, 100, 500);
  console.log(verdict.lines.join('\n'));
  founderSeed.bias = authoredBias;
}
