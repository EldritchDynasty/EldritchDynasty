import type { Gamete, GenePool, Genome, MutationRecord, Sex } from '@ed/schema';
import type { Rng } from '../rng.js';
import { drawAllele, type LocusTable } from './loci.js';

const CM_PER_CROSSOVER = 100;
const MUTATION_RATE = 0.0004;
/** Font loci mutate up more often than down: "rare upward mutation in progeny". */
const FONT_UPWARD_BIAS = 0.75;

/**
 * Build a gamete. Per chromosome: draw a crossover count from a Poisson over
 * the map length, place crossovers uniformly in cM space, then walk the loci
 * emitting from alternating haplotypes.
 *
 * Linkage is not decoration. It means nearby loci travel together, so a strong
 * font allele placed next to a deleterious recessive produces a haplotype that
 * is a genuine bargain — the blessing arrives chained to the curse, and
 * separating them needs a specific crossover a family may wait generations for.
 */
export function meiosis(
  g: Genome,
  table: LocusTable,
  sex: Sex,
  rng: Rng,
  year: number,
  offspringSex?: Sex,
): Gamete {
  const mutations: MutationRecord[] = [];
  const autosomal = recombine(g.autosomal[0], g.autosomal[1], table.autosomal, rng);

  let x: Int16Array | null;
  if (sex === 'female') {
    // Her two X's recombine. A daughter's X is a mosaic of her mother's pair —
    // but not a fair one. See `driveToward`.
    x = recombine(g.sex[0], g.sex[1] ?? g.sex[0], table.x, rng, driveToward(g, table));
  } else {
    // A man gives either his single X (-> daughter) or a Y (-> son).
    // Consequence: a son's font comes ONLY from his mother, and a father
    // passes his single X INTACT to every daughter. Both are real biology and
    // both are the reason cousin marriage is the mechanism, not a mechanism.
    // Founding children already have an authored sex. Let bootstrap ask for
    // the corresponding paternal gamete directly rather than drawing and
    // discarding gametes until one happens to match: the conception stream is
    // still one stream, and ordinary births keep the fair coin.
    const passesX = offspringSex === undefined ? rng.bool(0.5) : offspringSex === 'female';
    x = passesX ? Int16Array.from(g.sex[0]) : null;
  }

  mutate(autosomal, table, 'autosomal', rng, year, mutations);
  if (x) mutate(x, table, 'x', rng, year, mutations);

  return { autosomal, x, mutations };
}

/**
 * MEIOTIC DRIVE, AND WHY THE X HAS ONE (issue #41).
 *
 * A son's font comes only from his mother, and on a fair coin a mother with
 * one hot X and one cold one hands over an even mosaic of the two. Measured
 * over three thousand-year runs before this existed: the founding haplotype
 * halves every generation, the deepest blood in the house falls from 31 to 4
 * inside four generations, and from there the family is carried by mutation
 * rather than by inheritance. Every strategy the game offers — the Match, the
 * standing order, withholding a daughter — was measured against that decay and
 * none of them touched it, because none of them can: they choose WHO marries,
 * and the loss happens inside the meiosis afterwards.
 *
 * So the blood is not transmitted fairly. The haplotype carrying more font is
 * the one a female meiosis is likelier to start from, at the rate the font
 * loci themselves declare (`LocusDef.drive`). It is invisible, it is never
 * certain, and it changes nothing about whether a given X does anything —
 * which is what keeps invariant 4 intact: a gift that is likelier to be handed
 * on is not a gift that can be scheduled.
 *
 * Returned as a probability that the walk starts on haplotype 0, so a locus
 * table with no drive authored anywhere returns exactly 0.5 and the whole
 * mechanism is a fair coin again.
 */
function driveToward(g: Genome, table: LocusTable): number {
  let drive = 0.5;
  let a = 0;
  let b = 0;
  for (const i of table.fontIndices) {
    drive = Math.max(drive, table.x[i]?.drive ?? 0.5);
    const alleles = table.xAlleles[i]!;
    a += alleles[g.sex[0][i]!]?.effect ?? 0;
    b += g.sex[1] ? (alleles[g.sex[1][i]!]?.effect ?? 0) : 0;
  }
  if (drive === 0.5 || a === b) return 0.5;
  return a > b ? drive : 1 - drive;
}

function recombine(
  a: Int16Array,
  b: Int16Array,
  loci: { chromosome: unknown; position: number }[],
  rng: Rng,
  startOnFirst = 0.5,
): Int16Array {
  const out = new Int16Array(a.length);
  if (a.length === 0) return out;

  // Group by chromosome so crossovers do not leak across them.
  let start = 0;
  while (start < loci.length) {
    let end = start;
    const chrom = loci[start]!.chromosome;
    while (end < loci.length && loci[end]!.chromosome === chrom) end++;

    const span = loci[end - 1]!.position - loci[start]!.position;
    const nCross = rng.poisson(Math.max(0.5, span / CM_PER_CROSSOVER));
    const points: number[] = [];
    for (let i = 0; i < nCross; i++) points.push(rng.range(loci[start]!.position, loci[end - 1]!.position));
    points.sort((x, y) => x - y);

    let current = rng.bool(startOnFirst) ? 0 : 1;
    let nextPoint = 0;
    for (let i = start; i < end; i++) {
      while (nextPoint < points.length && loci[i]!.position >= points[nextPoint]!) {
        current ^= 1;
        nextPoint++;
      }
      out[i] = current === 0 ? a[i]! : b[i]!;
    }
    start = end;
  }
  return out;
}

function mutate(
  hap: Int16Array,
  table: LocusTable,
  where: 'autosomal' | 'x',
  rng: Rng,
  year: number,
  sink: MutationRecord[],
): void {
  const loci = where === 'autosomal' ? table.autosomal : table.x;
  const alleles = where === 'autosomal' ? table.autosomalAlleles : table.xAlleles;
  for (let i = 0; i < hap.length; i++) {
    const locus = loci[i]!;
    const isFont = locus.kind === 'eldritch_font';
    const rate = isFont ? MUTATION_RATE * 3 : MUTATION_RATE;
    if (!rng.bool(rate)) continue;

    const pool = alleles[i]!;
    const currentEffect = pool[hap[i]!]?.effect ?? 0;
    let candidates = pool.map((a, idx) => ({ a, idx }));
    if (isFont) {
      const up = candidates.filter((c) => c.a.effect > currentEffect);
      const down = candidates.filter((c) => c.a.effect < currentEffect);
      const useUp = up.length > 0 && (down.length === 0 || rng.bool(FONT_UPWARD_BIAS));
      candidates = useUp ? up : (down.length ? down : candidates);
    }
    if (!candidates.length) continue;
    const chosen = rng.pick(candidates);
    sink.push({
      locus: locus.id,
      from: (pool[hap[i]!]?.id) ?? '?',
      to: chosen.a.id,
      year,
    });
    hap[i] = chosen.idx;
  }
}

/** Fertilise. The father's gamete decides the child's sex. */
export function conceive(
  motherGamete: Gamete,
  fatherGamete: Gamete,
  table: LocusTable,
): { genome: Genome; sex: Sex } {
  const sex: Sex = fatherGamete.x === null ? 'male' : 'female';
  const genome: Genome = {
    autosomal: [motherGamete.autosomal, fatherGamete.autosomal],
    sex: sex === 'female'
      ? [motherGamete.x!, fatherGamete.x!]
      : [motherGamete.x!, null],
    // Something new entered the blood. It belongs to the child, not the parent,
    // and the chronicle should be able to say which child it was.
    mutations: [...motherGamete.mutations, ...fatherGamete.mutations],
  };
  void table;
  return { genome, sex };
}

/** Roll a fresh genome for an outsider from a house's allele pool. */
/**
 * NUDGE A ROLLED GENOME TOWARD AN AUTHORED INTENT, without pinning it.
 *
 * `strength` is the chance per contributing locus that the best allele for
 * that attribute is placed — 0.9 is "formidable and everyone knows it", 0.4
 * is "she takes after her mother". Negative strength reaches for the worst
 * allele instead, which is how a template says "thin blood" without saying a
 * number.
 *
 * It lived in `sim.ts` and applied to the founding cast alone, so every
 * `bias` block on a CHARACTER TEMPLATE — the scholar's daughter's mind, the
 * Marrow girl's death affinity, the rival's charm — was authored, validated,
 * saved, and read by nothing. Four templates advertised a person the world
 * then rolled at random. That matters more now than it did: the Match puts
 * those templates in front of the player as cards, and a card that promises
 * a scholar's daughter has to deal one.
 */
export function applyBias(
  genome: Genome,
  bias: Record<string, number>,
  table: LocusTable,
  rng: Rng,
): void {
  for (const [attrKey, strength] of Object.entries(bias)) {
    // ELDRITCH IS NOT AN ATTRIBUTE (invariant 4), and `byAttribute` is built
    // from `contributes`, which the font and channel loci deliberately leave
    // empty — so `bias: { eldritch_power: 0.9 }` matched zero loci and did
    // nothing at all. It is authored on Daveed Gearithy, who is the founder,
    // the Narrator and the guardian, and it was the strongest statement of
    // intent in the whole content directory (invariant 11).
    if (attrKey === ELDRITCH_BIAS) { biasEldritch(genome, strength, table, rng); continue; }
    for (const c of table.byAttribute.get(attrKey) ?? []) {
      if (!rng.bool(Math.min(0.95, Math.abs(strength)))) continue;
      const alleles = c.where === 'autosomal' ? table.autosomalAlleles[c.index]! : table.xAlleles[c.index]!;
      // RANK BY THE CONTRIBUTION, NOT BY THE ALLELE'S OWN EFFECT.
      //
      // A locus contributes `effect * weight`, and a weight can be negative.
      // Ranking on `effect` alone is therefore backwards at every negative
      // contributor, and it was: `suitor_widow_with_land` — "worth every one
      // of them if what you want is a house full" — carries
      // `bias: { fecundity: 0.6 }`, and `fecundity_drag` contributes to
      // fecundity at -1.8, so the fertility card in the deck was rolled with
      // the STRONGEST available fertility-drag allele on her X, once per
      // locus, every time she was dealt.
      //
      // Inert at issue #26's shipped coupling of zero, which is exactly why
      // nothing caught it — she is dealt, her genome says the opposite of her
      // blurb, it is passed to her daughters, and the day anyone turns that
      // constant up she becomes the thinnest woman in the market. Invariant 11
      // one layer along: the field is read, and read with the sign inverted.
      //
      // A DELETERIOUS LOCUS RANKS BY ITS TAG AND NOT BY ITS ARITHMETIC.
      //
      // It was written against a live sign error: the five named curses were
      // authored `effect: -7` against `weight: -0.5`, and a negative times a
      // negative is +3.5, so by the arithmetic alone the Ashen mark and the
      // thin bone each made a body STRONGER — and ranking on it would have had
      // a template asking for a strong man buy him five curses to get there.
      // The prediction made here at the time was that ranking by the tag is
      // right whichever way issue #112 resolves, and that it leaves what a
      // bias does at these loci exactly where it already was.
      //
      // #112 IS FIXED NOW — `weight: 0.5`, `dominance: 1`, a carrier pays
      // nothing and a homozygote pays -3.5 — and the prediction held. The two
      // rankings were measured against each other at all five loci in both
      // bias directions and they agree on every one, so nothing a bias does
      // moved. The exception stays: it is the cheaper guarantee. Ranking a
      // thing the content calls a curse by the sign of an authored weight is
      // how this went wrong the first time, and a tag cannot be inverted by a
      // typo in a number.
      const rank = (a: { effect: number; tags: string[] }) => (
        c.locus.kind === 'deleterious'
          ? (a.tags.includes('deleterious') || a.tags.includes('lethal_homozygous') ? -1 : 0)
          : a.effect * c.weight
      );
      const best = alleles
        .map((a, i) => ({ v: rank(a), i }))
        .sort((x, y) => (strength >= 0 ? y.v - x.v : x.v - y.v))[0];
      if (!best) continue;
      if (c.where === 'autosomal') genome.autosomal[rng.int(2)]![c.index] = best.i;
      else genome.sex[0][c.index] = best.i;
    }
  }
}

/**
 * The one bias key that names the Power rather than an attribute.
 *
 * It matches `attributes.yaml`'s own id for it, so an author writes the same
 * word in both places, and it is a constant here so the two cannot drift.
 */
const ELDRITCH_BIAS = 'eldritch_power';

/**
 * Make somebody's blood what the author said it was.
 *
 * BOTH GROUPS, and that is the whole of why this is not one line. Expressed
 * power is `min(font, ceiling)` and the ceiling comes off the AUTOSOMAL
 * channel loci, so biasing the font alone does not produce a powerful man —
 * it produces a man carrying more than he can pass, which is the definition
 * of Madness (`eldritch()`). An author asking for `eldritch_power` is asking
 * for a man who can use it, not one it destroys.
 *
 * Writes the X haplotype and one autosomal haplotype, exactly as the
 * attribute path above does, so a bias is a nudge toward an intent rather
 * than a pin: `p` is the strength, and at 0.9 one locus in ten still rolls
 * whatever the house pool gave it.
 */
function biasEldritch(genome: Genome, strength: number, table: LocusTable, rng: Rng): void {
  const p = Math.min(0.95, Math.abs(strength));
  const pick = (alleles: { effect: number }[]) => alleles
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (strength >= 0 ? y.a.effect - x.a.effect : x.a.effect - y.a.effect))[0];

  for (const index of table.fontIndices) {
    if (!rng.bool(p)) continue;
    const best = pick(table.xAlleles[index] ?? []);
    if (best) genome.sex[0][index] = best.i;
  }
  for (const index of table.channelIndices) {
    if (!rng.bool(p)) continue;
    const best = pick(table.autosomalAlleles[index] ?? []);
    if (best) genome.autosomal[rng.int(2)]![index] = best.i;
  }
}

export function randomGenome(table: LocusTable, pool: GenePool | undefined, sex: Sex, rng: Rng): Genome {
  const auto0 = new Int16Array(table.autosomal.length);
  const auto1 = new Int16Array(table.autosomal.length);
  for (let i = 0; i < table.autosomal.length; i++) {
    auto0[i] = drawAllele(table.autosomalAlleles[i]!, table.autosomal[i]!, pool, rng);
    auto1[i] = drawAllele(table.autosomalAlleles[i]!, table.autosomal[i]!, pool, rng);
  }
  const x0 = new Int16Array(table.x.length);
  for (let i = 0; i < table.x.length; i++) {
    x0[i] = drawAllele(table.xAlleles[i]!, table.x[i]!, pool, rng);
  }
  let x1: Int16Array | null = null;
  if (sex === 'female') {
    x1 = new Int16Array(table.x.length);
    for (let i = 0; i < table.x.length; i++) {
      x1[i] = drawAllele(table.xAlleles[i]!, table.x[i]!, pool, rng);
    }
  }
  return { autosomal: [auto0, auto1], sex: [x0, x1], mutations: [] };
}
