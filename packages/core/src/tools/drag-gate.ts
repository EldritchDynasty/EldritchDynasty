/**
 * THE DEATH-SPIRAL GATE for fertility option B (issue #26).
 *
 *   npm run gate:drag -- [runs] [years] [coupling ...] [--pleiotropic]
 *   npm run gate:drag -- [runs] [years] [coupling ...] [--phased] [--cm=N]
 *   npm run gate:drag -- 8 500 2 --phased --decay
 *   npm run gate:drag -- 200 500 0 0.5 1 2 4
 *   npm run gate:drag -- 200 500 0 1 2 4 --pleiotropic
 *
 * TWO MECHANISMS, one gate. `--pleiotropic` runs option B respecified: the
 * drag carried on the font loci themselves rather than on a linked group
 * beside them. `coupledBundle` documents why there are two, and k is
 * calibrated so a row of one is comparable to a row of the other.
 *
 * Issue #26 ships `FECUNDITY_DRAG_COUPLING` at zero and names the condition
 * for ever moving it: "turn the constant up in the harness, in batches of two
 * hundred runs, and look for the death spiral before anyone plays it. If a
 * house that concentrates its blood cannot reach 2042 more than half the
 * time, the constant is wrong — not the idea." This file is that batch.
 *
 * HOW IT REACHES A NONZERO COUPLING WITHOUT A DIAL.
 * `FECUNDITY_DRAG_COUPLING` is a `const` on purpose (INVARIANT 8: no
 * module-scope mutable state a second simulation in the same process could
 * see differently), so a sweep cannot turn it up — and an env var read at
 * import time would be worse, because then a saved game would replay
 * differently on a machine whose shell disagreed.
 *
 * So the sweep does not touch the constant at all. It builds a synthetic
 * CONTENT bundle per coupling: every `fecundity_drag` locus is relabelled
 * `additive` — the kind `couplingFor` multiplies by one — and its authored
 * weight is multiplied by k instead. Nothing else about the locus moves:
 * same id, same X, same position, same dominance, same alleles, same
 * frequencies. `drawAllele` and `meiosis` special-case neither kind, so the
 * genome layout and the whole RNG cascade are identical to the shipped run;
 * the only difference reaching the simulation is the number
 * `expressAttributes` multiplies by. That makes k a per-world property of
 * content rather than a global, which is what the invariant actually asks for.
 *
 * `fecundity-drag.slow.test.ts` pins the fidelity claim: the k=0 bundle this
 * file builds must produce a bit-identical run to the shipped content.
 *
 * WHAT IT MEASURES, and why each column is here.
 *  - survive: the gate's own pass/fail line.
 *  - squeeze: children borne by high-font women against low-font women. A
 *    coupling that does not separate those two columns has not implemented
 *    the design, whatever it does to the loci.
 *  - font 1st/last: carried font of the house's first daughters against its
 *    last. The death spiral is not only extinction — a house that reaches
 *    2042 having quietly bred its font away has lost a slower way, and the
 *    survival column cannot see it.
 *  - centre, floored: the two diagnostics the first batch turned out to
 *    need. `centre` is `expectedAttribute('fecundity')`, the theoretical
 *    mean `completedFertility` measures every couple against; `floored` is
 *    the share of real mothers sitting on the attribute's own zero. When
 *    those two disagree — a negative centre and a floored population — every
 *    family in the game reads as ABOVE average and the drag hands out
 *    children instead of taking them.
 */
import { AttributeIdS, indexContent, type Content, type ContentBundle, type LocusDef } from '@ed/schema';
import { loadBundle } from '@ed/content';
import { bootstrap, runYears } from '../sim.js';
import type { SimCtx } from '../world.js';
import { attr, genomeOf, phenotypeOf } from '../people/factory.js';
import { expectedAttribute, expressLocus, mintShareByHouse } from '../genetics/expression.js';
import { buildLocusTable } from '../genetics/loci.js';
import { CAMPAIGN_YEARS } from '../campaign.js';

const FECUNDITY = AttributeIdS.parse('fecundity');

/**
 * The sweep's whole mechanism: option B's loci, re-weighted by k.
 *
 * `cM` re-places each drag locus that far from the font locus it is paired
 * with, in place of the authored four. Distance is the design's other dial and
 * the one the issue names ("this is choosing a distance") — at four
 * centiMorgans a founding pairing is gone inside a quarter of the run, so a
 * gate that cannot vary it can only ever report that the idea does not hold.
 */
export type DragMode = 'linked' | 'pleiotropic';

/**
 * THE RESPECIFICATION, and why there are two mechanisms in one gate.
 *
 * `linked` is issue #26 as written: a separate locus group on the X, a few
 * centiMorgans from the font. Three batches have now measured it and it does
 * not do the thing it was specified to do, for a reason that is about the
 * shape of the mechanism rather than about the strength of the constant —
 * **linkage preserves a pairing, it cannot create one.** The founders' drag
 * alleles are drawn from the world baseline independently of their font
 * (r = -0.07), every wife married in brings another X drawn the same way, and
 * a haplotype carrying both font and drag is precisely the haplotype that
 * breeds least, so the mechanism eats its own premise. Supplying the premise
 * by hand (`--phased`) produces the intended sign and it is gone inside a
 * quarter of the run, at any linkage distance.
 *
 * `pleiotropic` is the form named in that finding and never measured: the
 * negative `fecundity` contribution sits **on the `eldritch_font` loci
 * themselves**. Then the correlation is structural — it cannot be recombined
 * apart, diluted out or selected away, and it scales with font depth, which is
 * what "the blood you are trying to concentrate is the blood that breeds
 * least" actually claims. It also predicts its way out of the floor that
 * killed the linked form: the great majority of the world carries no font at
 * all — an outsider draws it only at their pool's carrier rate, five percent
 * in the deepest-blooded rival house and under one in most — so almost nobody
 * pays the drag, and only the hot minority is pushed toward zero.
 *
 * That same sentence is also this form's blocker, which is not a coincidence:
 * `expectedAttribute` reads the AUTHORED frequencies and `drawAllele`
 * overrides them for exactly this locus kind, so the centre falls much faster
 * than the population does. Read `borne` beside `centre` in every row. See
 * docs/FAILURES.md, "a locus that is drawn by its own rule".
 *
 * The cost is the jackpot. A crossover can no longer hand anyone deep font
 * without the drag, because there is nothing to cross over. That is the trade
 * this gate exists to price.
 *
 * ONE KNOWN ARTIFACT at k>0, named because it is a real consequence rather
 * than an accident of the tool: making the font loci feed an attribute makes
 * them reachable by `bias`, and one template in the deck biases fecundity —
 * `suitor_widow_with_land`, who would therefore be dealt with her font written
 * as well as her fertility. She is an outsider from `house_calder` or the
 * commons who draws at a carrier rate under 3% and would almost always carry
 * none anyway, so it moves nothing measured here. It would matter a great deal
 * if this ever shipped, and that is the point of writing it down.
 */
export function coupledBundle(
  bundle: ContentBundle,
  coupling: number,
  opts: { cM?: number; mode?: DragMode } = {},
): ContentBundle {
  if ((opts.mode ?? 'linked') === 'pleiotropic') return pleiotropicBundle(bundle, coupling);

  const positions = new Map<string, number>(bundle.loci.map((l) => [String(l.id), l.position]));
  const loci: LocusDef[] = bundle.loci.map((l) => {
    if (l.kind !== 'fecundity_drag') return l;
    const font = positions.get(`font_${l.id.replace('fecundity_drag_', '')}`);
    return {
      ...l,
      kind: 'additive' as const,
      position: opts.cM !== undefined && font !== undefined ? font + opts.cM : l.position,
      contributes: l.contributes.map((c) => ({ ...c, weight: c.weight * coupling })),
    };
  });
  return { ...bundle, loci };
}

/**
 * Option B as pleiotropy: the drag is a second job the font loci do.
 *
 * The `fecundity_drag` loci are left exactly where they are and exactly as
 * they are — kind `fecundity_drag`, which `couplingFor` multiplies by the
 * shipped constant of zero. They stay in the genome, they stay inert, and the
 * RNG cascade is therefore identical to the shipped run at every coupling, the
 * same fidelity property the linked sweep has. What changes is one line of
 * arithmetic: every `eldritch_font` locus gains a `fecundity` contribution.
 */
function pleiotropicBundle(bundle: ContentBundle, coupling: number): ContentBundle {
  // ABSENT AT k=0, NOT PRESENT AT WEIGHT ZERO, and the difference is not
  // pedantry — it is a bug this gate's own baseline row caught.
  //
  // A zero-weight contribution still enters `byAttribute`, and `applyBias`
  // iterates that list and spends an RNG draw per entry before it looks at any
  // weight. So a k=0 bundle carrying six weightless contributions is a
  // DIFFERENT WORLD from the shipped one — identical for two centuries, then
  // visibly apart — and a sweep whose baseline is not the game measures
  // nothing. The linked sweep does not have this problem because its loci are
  // in `byAttribute` in the shipped game too.
  if (coupling === 0) return bundle;
  const w = pleiotropicWeight(bundle) * coupling;
  const loci: LocusDef[] = bundle.loci.map((l) => (
    l.kind === 'eldritch_font'
      ? { ...l, contributes: [...l.contributes, { attr: FECUNDITY, weight: -w }] }
      : l
  ));
  return { ...bundle, loci };
}

/**
 * THE CALIBRATION, so that k means the same thing in both columns.
 *
 * The two mechanisms are authored in different units — the drag loci carry
 * their own alleles at their own frequencies, the font loci carry the font's —
 * so the same k would otherwise buy wildly different amounts of drag and the
 * sweep would be comparing strengths rather than shapes. This returns the
 * per-font-locus weight at which **the pleiotropic form costs the population
 * the same mean fecundity as the authored linked form does at k = 1.**
 *
 * Same average tax, differently distributed, which is the whole question: the
 * linked form spreads it over everybody and the pleiotropic form bills the
 * women the design says should pay it.
 *
 * Measured against the UNCLAMPED mean on purpose. Expression is linear in the
 * weights until the clamp fires, so the ratio is exact; the clamped centre is
 * what the sweep then prints per row, because that is what the simulation
 * measures couples against and it is where the previous batch found its bug.
 */
export function pleiotropicWeight(bundle: ContentBundle): number {
  const centre = (loci: LocusDef[]) => expectedAttribute(buildLocusTable(loci), 'fecundity');
  const base = centre(bundle.loci);
  const authoredDrag = centre(coupledBundle(bundle, 1, { mode: 'linked' }).loci) - base;
  const perUnit = centre(
    bundle.loci.map((l) => (
      l.kind === 'eldritch_font'
        ? { ...l, contributes: [...l.contributes, { attr: FECUNDITY, weight: -1 }] }
        : l
    )),
  ) - base;
  return perUnit === 0 ? 0 : authoredDrag / perUnit;
}

/**
 * PHASE THE FOUNDERS — the variant the first batch proved this gate needs.
 *
 * Issue #26 reasons that putting the drag loci on the X, linked to the font,
 * makes "a daughter who carries deep font tend to carry low fecundity."
 * Linkage does not do that. Linkage PRESERVES a pairing; it cannot create
 * one, and the pairing the founders were rolled with is random — measured at
 * r = -0.07 between carried font and drag load, which is nothing. Sharing a
 * chromosome makes two loci travel together; it says nothing about which
 * alleles set out together in the first place.
 *
 * So this is the same experiment with the missing premise supplied: on every
 * founding genome of the player's house, each drag locus is set to match the
 * font locus it is paired with, on the SAME haplotype — a hot X carries the
 * drag, a cold X does not. From there the simulation is untouched: meiosis
 * splits the pair at whatever rate the authored centiMorgans allow, and the
 * jackpot the issue describes (deep font, split loose from the drag) is a
 * thing recombination has to hand you rather than a thing set up in advance.
 *
 * It is deliberately a property of THIS TOOL and not of `bootstrap`. Shipping
 * it would mean authoring the founder's haplotypes in content, which is a
 * design decision the gate exists to inform, not one it should pre-empt.
 */
export function phaseFounders(ctx: SimCtx, bundle: ContentBundle): void {
  const table = ctx.genetics.table;
  const pairs: { drag: number; font: number }[] = [];
  // Matched by id rather than by kind: the sweep's own bundle has relabelled
  // these loci `additive`, and the pristine one has not. The pairing is the
  // same either way.
  for (const l of bundle.loci) {
    if (!l.id.startsWith('fecundity_drag_')) continue;
    const n = l.id.replace('fecundity_drag_', '');
    const drag = table.xIndex.get(l.id);
    const font = table.xIndex.get(`font_${n}`);
    if (drag !== undefined && font !== undefined) pairs.push({ drag, font });
  }

  for (const p of ctx.world.people.blood(ctx.world.playerHouse)) {
    const g = genomeOf(p, ctx.genetics);
    for (const { drag, font } of pairs) {
      const fontAlleles = table.xAlleles[font]!;
      const dragAlleles = table.xAlleles[drag]!;
      const strong = dragAlleles.reduce(
        (best: number, a, i) => (a.effect > (dragAlleles[best]?.effect ?? -Infinity) ? i : best),
        0,
      );
      const none = dragAlleles.findIndex((a) => a.tags.includes('null'));
      for (const hap of [g.sex[0], g.sex[1]]) {
        if (!hap) continue;
        const carries = (fontAlleles[hap[font]!]?.effect ?? 0) > 0;
        hap[drag] = carries ? strong : (none >= 0 ? none : 0);
      }
    }
    p.phenotype = undefined;
  }
}

interface DragRun {
  seed: number;
  survived: boolean;
  living: number;
  births: number;
  generations: number;
  /** Carried font of the house's first and last cohorts of blood women. */
  fontEarly: number;
  fontLate: number;
  /** Completed families, split by the mother's own carried font. */
  hotMothers: number;
  hotChildren: number;
  coldMothers: number;
  coldChildren: number;
  /** The same split by whether she carries any font at all, not by rank. */
  carrierMothers: number;
  carrierChildren: number;
  nullMothers: number;
  nullChildren: number;
  /** Mothers sitting on the fecundity attribute's own floor of zero. */
  mothers: number;
  floored: number;
  /** What those mothers actually carried, summed — against `centre`, which claims to predict it. */
  fecundity: number;
}

const COMPLETED_AT = 45;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

function runOnce(
  content: Content,
  seed: number,
  years: number,
  startYear: number,
  phase: ContentBundle | undefined,
): DragRun {
  const ctx = bootstrap(content, seed, startYear);
  if (phase) phaseFounders(ctx, phase);
  runYears(ctx, years);
  const w = ctx.world;

  // Every woman of the blood whose childbearing is over, with what she
  // carried and what she bore. Women who died young are excluded on both
  // sides: they measure mortality, not fertility.
  const mothers: { font: number; children: number; born: number; fecundity: number }[] = [];
  let births = 0;
  for (const p of w.people.blood(w.playerHouse)) {
    if (p.born > startYear) births += 1;
    if (p.sex !== 'female') continue;
    const end = p.died ?? w.year;
    if (end - p.born < COMPLETED_AT) continue;
    mothers.push({
      font: phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont,
      children: w.people.children(p.id).length,
      born: p.born,
      fecundity: attr(p, 'fecundity', ctx.genetics, w.year),
    });
  }

  // The squeeze, twice, because the two splits stop agreeing late in a run.
  //
  // By RANK: the top third of the house's women by carried font against the
  // bottom third. Reads well early; by the third century most of the house
  // carries nothing, so both thirds are full of zeroes and the number decays
  // into noise rather than into a finding.
  //
  // By CARRIAGE: every woman with any font at all against every woman with
  // none. Fewer women on the hot side and a smaller sample, but it is the
  // question the design is actually asking, and it stays the same question
  // however thin the blood gets.
  const byFont = [...mothers].sort((a, b) => a.font - b.font);
  const third = Math.floor(byFont.length / 3);
  const cold = byFont.slice(0, third);
  const hot = byFont.slice(byFont.length - third);

  // The trajectory: the first and last quarter of the house's daughters by
  // birth year. Erosion shows up here long before it shows up in extinction.
  const carriers = mothers.filter((m) => m.font > 0);
  const nulls = mothers.filter((m) => m.font <= 0);

  const byBirth = [...mothers].sort((a, b) => a.born - b.born);
  const quarter = Math.max(1, Math.floor(byBirth.length / 4));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    seed,
    survived: w.people.household(w.playerHouse, w.year).length > 0,
    living: w.people.living().length,
    births,
    generations: w.generation,
    fontEarly: mean(byBirth.slice(0, quarter).map((m) => m.font)),
    fontLate: mean(byBirth.slice(byBirth.length - quarter).map((m) => m.font)),
    hotMothers: hot.length,
    hotChildren: hot.reduce((a, m) => a + m.children, 0),
    coldMothers: cold.length,
    coldChildren: cold.reduce((a, m) => a + m.children, 0),
    carrierMothers: carriers.length,
    carrierChildren: carriers.reduce((a, m) => a + m.children, 0),
    nullMothers: nulls.length,
    nullChildren: nulls.reduce((a, m) => a + m.children, 0),
    mothers: mothers.length,
    floored: mothers.filter((m) => m.fecundity <= 0).length,
    fecundity: mothers.reduce((a, m) => a + m.fecundity, 0),
  };
}

/**
 * DOES THE PAIRING SURVIVE? — `--decay`.
 *
 * The sweep answers what the drag does to a house. This answers the question
 * underneath it: whether a font-and-drag pairing set at the founding is still
 * there two centuries later, measured as the correlation between a woman's
 * carried font and the drag her X carries, by the quarter-millennium she was
 * born in.
 *
 * Run it against `--cm` to separate the two things that could be erasing the
 * pairing. If shortening the linkage distance holds the correlation up, it is
 * recombination. If it does not, it is dilution — every wife married in brings
 * an X drawn at the world baseline, and the font itself thins out — and no
 * choice of distance will save the mechanism.
 */
export function decay(
  runs: number,
  years: number,
  coupling: number,
  opts: { phased?: boolean; cM?: number; startYear?: number } = {},
): void {
  const startYear = opts.startYear ?? 1042;
  const bundle = loadBundle();
  // Linked only, and deliberately: `--decay` asks whether a pairing SURVIVES,
  // and the pleiotropic form has no pairing to lose. Its correlation is one,
  // by construction, in every cohort of every run.
  const coupled = coupledBundle(bundle, coupling, { cM: opts.cM, mode: 'linked' });
  const content = indexContent(coupled);
  const dragIds = bundle.loci.filter((l) => l.kind === 'fecundity_drag').map((l) => String(l.id));

  const cohorts = new Map<number, { font: number[]; drag: number[] }>();
  for (let i = 0; i < runs; i++) {
    const ctx = bootstrap(content, 1000 + i * 7, startYear);
    if (opts.phased) phaseFounders(ctx, bundle);
    runYears(ctx, years);
    const w = ctx.world;
    const t = ctx.genetics.table;
    const idx = dragIds.map((id) => t.xIndex.get(id)!);

    for (const p of w.people.blood(w.playerHouse)) {
      if (p.sex !== 'female') continue;
      const g = genomeOf(p, ctx.genetics);
      let load = 0;
      for (const i of idx) {
        const alleles = t.xAlleles[i]!;
        const a = alleles[g.sex[0][i]!]?.effect ?? 0;
        const b = g.sex[1] ? (alleles[g.sex[1][i]!]?.effect ?? 0) : null;
        load += expressLocus(a, b, t.x[i]!.dominance);
      }
      const era = Math.floor((p.born - startYear) / 250);
      const c = cohorts.get(era) ?? { font: [], drag: [] };
      c.font.push(phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont);
      c.drag.push(load);
      cohorts.set(era, c);
    }
  }

  console.log(`coupling ${coupling}, ${opts.phased ? 'PHASED' : 'as authored'}, `
    + `${opts.cM !== undefined ? `${opts.cM}cM` : 'the authored distance'} apart; `
    + `${runs} runs x ${years} years\n`);
  console.log('  born                 n    corr(font, drag)   mean font');
  for (const [era, c] of [...cohorts].sort((a, b) => a[0] - b[0])) {
    if (c.font.length < 20) continue;
    const from = startYear + era * 250;
    const meanFont = c.font.reduce((a, b) => a + b, 0) / c.font.length;
    console.log(`  ${from}-${from + 249}  ${String(c.font.length).padStart(6)}`
      + `${correlation(c.font, c.drag).toFixed(3).padStart(18)}`
      + `${meanFont.toFixed(2).padStart(12)}`);
  }
  console.log('\n  A positive correlation is the design: deep font, heavy drag, on the same X.');
  console.log('  Watch how long it lasts, and whether --cm changes how long.');
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

export function sweep(
  runs: number,
  years: number,
  couplings: number[],
  opts: { startYear?: number; phased?: boolean; cM?: number; mode?: DragMode } = {},
): void {
  const startYear = opts.startYear ?? 1042;
  const mode = opts.mode ?? 'linked';
  const bundle = loadBundle();
  const drag = bundle.loci.filter((l) => l.kind === 'fecundity_drag');
  const font = bundle.loci.filter((l) => l.kind === 'eldritch_font');
  if (mode === 'pleiotropic') {
    const w = pleiotropicWeight(bundle);
    console.log(`fecundity drag, PLEIOTROPIC: carried on the ${font.length} eldritch_font loci `
      + `themselves, ${round4(-w)}/locus at k=1 — the weight at which this costs the `
      + `population the same mean fecundity the authored linked form does.`);
    console.log('the fecundity_drag loci are untouched and still inert; nothing to phase, '
      + 'nothing to recombine apart.');
  } else {
    console.log(`fecundity drag, LINKED: ${drag.length} loci, authored weight `
      + `${drag[0]?.contributes[0]?.weight ?? 0}/locus`
      + `${opts.phased ? ', PHASED onto the founders\' font haplotypes' : ', as authored (founder phase random)'}`
      + `${opts.cM !== undefined ? `, re-placed ${opts.cM}cM from their font locus` : ''}`);
  }
  console.log(`${runs} runs x ${years} years per coupling; seeds ${startYear === 1042 ? '1000, 1007, ...' : 'as given'}\n`);

  const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)]! : 0;
  };

  const head = ['coupling', 'survive', 'living', 'births', 'gens', 'kids/hot', 'kids/cold',
    'rank sqz', 'kids/font+', 'kids/font0', 'font sqz', 'font 1st', 'font last',
    'centre', 'borne', 'floored'];
  console.log(head.map((h, i) => (i ? h.padStart(11) : h.padEnd(11))).join(''));

  for (const k of couplings) {
    const coupled = coupledBundle(bundle, k, { cM: opts.cM, mode });
    const content = indexContent(coupled);
    const all: DragRun[] = [];
    for (let i = 0; i < runs; i++) {
      all.push(runOnce(
        content, 1000 + i * 7, years, startYear,
        opts.phased && mode === 'linked' ? bundle : undefined,
      ));
    }

    const survived = all.filter((r) => r.survived).length;
    const sum = (f: (r: DragRun) => number) => all.reduce((a, r) => a + f(r), 0);
    const hotKids = sum((r) => r.hotChildren) / Math.max(1, sum((r) => r.hotMothers));
    const coldKids = sum((r) => r.coldChildren) / Math.max(1, sum((r) => r.coldMothers));
    const carrierKids = sum((r) => r.carrierChildren) / Math.max(1, sum((r) => r.carrierMothers));
    const nullKids = sum((r) => r.nullChildren) / Math.max(1, sum((r) => r.nullMothers));
    // The RANGE is passed, so this column prints the centre the simulation
    // actually measures couples against. It printed the unclamped one for the
    // batch that found the inversion, which is why the two diagnostics beside
    // it were needed to see the bug at all (issue #26). The POOL MIX is
    // passed too (issue #113) for the same reason: `makeGeneticsCtx` blends
    // across houses now, and a gate reading the old unpooled number would
    // keep reporting the gap this fix closes.
    const fecundity = coupled.attributes.find((a) => String(a.id) === 'fecundity');
    const centre = expectedAttribute(
      buildLocusTable(coupled.loci), 'fecundity', fecundity?.range, mintShareByHouse(content),
    );

    const cells = [
      round(k).toString().padEnd(11),
      `${Math.round((100 * survived) / all.length)}%`.padStart(11),
      round(mean(all.map((r) => r.living)), 1).toString().padStart(11),
      round(mean(all.map((r) => r.births)), 1).toString().padStart(11),
      round(median(all.map((r) => r.generations)), 1).toString().padStart(11),
      round(hotKids).toString().padStart(11),
      round(coldKids).toString().padStart(11),
      round(hotKids - coldKids).toString().padStart(11),
      round(carrierKids).toString().padStart(11),
      round(nullKids).toString().padStart(11),
      round(carrierKids - nullKids).toString().padStart(11),
      round(mean(all.map((r) => r.fontEarly)), 1).toString().padStart(11),
      round(mean(all.map((r) => r.fontLate)), 1).toString().padStart(11),
      round(centre, 1).toString().padStart(11),
      round(sum((r) => r.fecundity) / Math.max(1, sum((r) => r.mothers)), 1).toString().padStart(11),
      `${Math.round((100 * sum((r) => r.floored)) / Math.max(1, sum((r) => r.mothers)))}%`.padStart(11),
    ];
    console.log(cells.join(''));
  }

  console.log('\n  survive   the gate: a coupling under 50% is wrong, per issue #26.');
  console.log('  rank sqz  children per completed mother, top third of the house by carried');
  console.log('            font minus the bottom third. Negative is the design working:');
  console.log('            the blood you concentrate is the blood that breeds least.');
  console.log('  font sqz  the same difference, but every woman carrying any font at all');
  console.log('            against every woman carrying none. The honest one late in a');
  console.log('            run, when both thirds of the rank split are full of zeroes.');
  console.log('  font      carried font of the first quarter of the house\'s daughters');
  console.log('            against the last. Falling is the slow half of the spiral.');
  console.log('  centre    expectedAttribute(fecundity) — the mean completedFertility');
  console.log('            measures a couple against. floored: mothers on the attribute\'s');
  console.log('            own zero. A negative centre with a floored population means');
  console.log('            every family reads as above average and the drag pays out.');
  console.log('  borne     what the house\'s completed mothers ACTUALLY carried. This is the');
  console.log('            column `centre` claims to predict, and the two coming apart is');
  console.log('            the whole bug, twice now: centre below borne and every family in');
  console.log('            the game is above average, so a drag hands out children. Read the');
  console.log('            two together or neither of them means anything.');
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('drag-gate.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const phased = args.includes('--phased');
  const cmArg = args.find((a) => a.startsWith('--cm='));
  const cM = cmArg ? Number(cmArg.slice(5)) : undefined;
  const mode: DragMode = args.includes('--pleiotropic') ? 'pleiotropic' : 'linked';
  const [runsArg, yearsArg, ...ks] = args.filter((a) => !a.startsWith('--'));
  const runs = Number(runsArg ?? 200);
  const years = Number(yearsArg ?? CAMPAIGN_YEARS);
  if (args.includes('--decay')) decay(runs, years, Number(ks[0] ?? 2), { phased, cM });
  else sweep(runs, years, ks.length ? ks.map(Number) : [0, 0.5, 1, 2, 4], { phased, cM, mode });
}
