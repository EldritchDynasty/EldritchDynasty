import type { Gamete, GenePool, Genome, LocusDef, MutationRecord, Sex } from '@ed/schema';
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
  inheritedBias: Record<string, number> = {},
): Gamete {
  const mutations: MutationRecord[] = [];
  const autosomal = recombine(
    g.autosomal[0],
    g.autosomal[1],
    table.autosomal,
    rng,
    (chromosome) => biasedStartProbability(g, table, 'autosomal', chromosome, 0.5, inheritedBias),
  );

  let x: Int16Array | null;
  if (sex === 'female') {
    // Her two X's recombine. A daughter's X is a mosaic of her mother's pair —
    // but not a fair one. See `driveToward`. A seeded-child bias may lean the
    // SAME chromosome-start coin further toward one of her actual X haplotypes;
    // it never splices a locus after the crossover walk has happened.
    const driven = driveToward(g, table);
    x = recombine(
      g.sex[0],
      g.sex[1] ?? g.sex[0],
      table.x,
      rng,
      (chromosome) => biasedStartProbability(g, table, 'x', chromosome, driven, inheritedBias),
    );
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
  startOnFirst: number | ((chromosome: unknown) => number) = 0.5,
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

    const firstProbability = typeof startOnFirst === 'function'
      ? startOnFirst(chrom)
      : startOnFirst;
    let current = rng.bool(firstProbability) ? 0 : 1;
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

/** Rank one allele by what this locus actually contributes to an authored bias. */
function contributionRank(
  allele: { effect: number; tags: string[] },
  locus: LocusDef,
  weight: number,
): number {
  return locus.kind === 'deleterious'
    ? (allele.tags.includes('deleterious') || allele.tags.includes('lethal_homozygous') ? -1 : 0)
    : allele.effect * weight;
}

/**
 * Bias a REAL meiosis without manufacturing a recombinant haplotype.
 *
 * #344 originally selected a "better" parental allele after recombination at
 * each biased locus. Every selected allele had a parent, so provenance looked
 * correct, but linkage did not: two nearby loci could be switched between the
 * parent's homologues with no crossover between them. The top of this file is
 * explicit that linkage is load-bearing.
 *
 * A seeded-child bias therefore changes only the existing chromosome-start
 * choice. Crossovers are still drawn normally and the walk still alternates
 * whole parental haplotypes only at those crossover points. Positive bias
 * leans toward the homologue whose relevant loci contribute more; negative
 * bias leans toward the one that contributes less. Multiple authored biases
 * on one chromosome vote through their signed contribution differences.
 *
 * `base` preserves any mechanism already acting on that coin. Autosomes start
 * at 0.5. The X starts at `driveToward`, so a child bias can lean meiotic
 * drive but cannot replace it.
 */
function biasedStartProbability(
  genome: Genome,
  table: LocusTable,
  where: 'autosomal' | 'x',
  chromosome: unknown,
  base: number,
  bias: Record<string, number>,
): number {
  if (!Object.keys(bias).length) return base;

  let signal = 0;
  let influence = 0;

  const consider = (
    index: number,
    strength: number,
    score: (allele: number) => number,
  ) => {
    const first = where === 'autosomal' ? genome.autosomal[0][index]! : genome.sex[0][index]!;
    const second = where === 'autosomal'
      ? genome.autosomal[1][index]!
      : (genome.sex[1]?.[index] ?? genome.sex[0][index]!);
    signal += (score(first) - score(second)) * strength;
    influence = Math.max(influence, Math.min(0.95, Math.abs(strength)));
  };

  for (const [attrKey, strength] of Object.entries(bias)) {
    if (strength === 0) continue;

    if (attrKey === ELDRITCH_BIAS) {
      const indices = where === 'x' ? table.fontIndices : table.channelIndices;
      const loci = where === 'x' ? table.x : table.autosomal;
      const alleleSets = where === 'x' ? table.xAlleles : table.autosomalAlleles;
      for (const index of indices) {
        const locus = loci[index]!;
        if (locus.chromosome !== chromosome) continue;
        const alleles = alleleSets[index]!;
        consider(index, strength, (allele) => alleles[allele]?.effect ?? 0);
      }
      continue;
    }

    for (const contribution of table.byAttribute.get(attrKey) ?? []) {
      if (contribution.where !== where || contribution.locus.chromosome !== chromosome) continue;
      const alleles = where === 'x'
        ? table.xAlleles[contribution.index]!
        : table.autosomalAlleles[contribution.index]!;
      consider(
        contribution.index,
        strength,
        (allele) => contributionRank(
          alleles[allele]!,
          contribution.locus,
          contribution.weight,
        ),
      );
    }
  }

  if (signal === 0 || influence === 0) return base;
  return signal > 0
    ? base + (1 - base) * influence
    : base * (1 - influence);
}

/**
 * NUDGE A ROLLED GENOME TOWARD AN AUTHORED INTENT, without pinning it.
 *
 * `strength` is the chance per contributing locus that the best allele for
 * that attribute is placed — 0.9 is "formidable and everyone knows it", 0.4
 * is "she takes after her mother". Negative strength reaches for the worst
 * allele instead, which is how a template says "thin blood" without saying a
 * number.
 *
 * This remains the path for founders, rivals and minted templates that do not
 * name two seeded parents. Two-parent seeded children never come through here:
 * their bias is folded into real meiosis above so linkage and provenance both
 * survive.
 *
 * Ranking is by the locus's actual contribution, including the sign of its
 * weight. Deleterious loci are the exception: a positive bias prefers the
 * clean tagged allele regardless of arithmetic, so a "strong" template can
 * never buy a named curse merely because a content weight changed sign.
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
    // empty. It therefore keeps its explicit path.
    if (attrKey === ELDRITCH_BIAS) {
      biasEldritch(genome, strength, table, rng);
      continue;
    }

    for (const contribution of table.byAttribute.get(attrKey) ?? []) {
      if (!rng.bool(Math.min(0.95, Math.abs(strength)))) continue;
      const alleles = contribution.where === 'autosomal'
        ? table.autosomalAlleles[contribution.index]!
        : table.xAlleles[contribution.index]!;
      const best = alleles
        .map((allele, index) => ({
          value: contributionRank(
            allele,
            contribution.locus,
            contribution.weight,
          ),
          index,
        }))
        .sort((a, b) => (
          strength >= 0 ? b.value - a.value : a.value - b.value
        ))[0];
      if (!best) continue;

      if (contribution.where === 'autosomal') {
        genome.autosomal[rng.int(2)]![contribution.index] = best.index;
      } else {
        genome.sex[0][contribution.index] = best.index;
      }
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
