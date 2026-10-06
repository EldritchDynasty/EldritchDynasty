/**
 * DOES THE LADDER CHARGE THE MAN WHO IS CLIMBING IT? (issue #41, second half)
 *
 *   npm run gate:ladder -- [runs] [years] [--bid=N]
 *   npm run gate:ladder -- 8 1000
 *
 * `ascension.ts` writes the finding this tool exists to close on the
 * Hierophant gate itself:
 *
 *   > if (p.madness < 20) return 'nothing has been asked of him that cost
 *   > anything';
 *
 * Measured over sixteen played thousand-year runs before this file existed,
 * that line was the last thing standing between the house and the fourth
 * rung — men at power 57 with ten books, eight affinities and Madness ZERO.
 * And it could not be fixed by moving a constant: power is `min(font,
 * ceiling)` and blood-Madness is `(font - ceiling) x 0.85`, the same
 * subtraction with opposite signs, so halving `MADNESS_OVERFLOW_YEARS`
 * doubled the ruin and moved the ladder not one rung in eight of eight runs.
 *
 * A ladder that runs through Madness has to be charged by CONTENT, and until
 * `events/the_ladder.yaml` every one of the game's authored `madness` effects
 * landed on a POSITION — HEAD, BEARER, CHILD, SECOND — while the ladder is
 * climbed by whoever the blood happened to land in.
 *
 * ─── The two columns ────────────────────────────────────────────────────────
 *
 * Like `gate:blood`, this PLAYS: the docket is parked, one policy answers
 * every ladder demand and the chronicler answers everything else, so the
 * difference between two columns is a difference in one verb.
 *
 * `climb` takes the branch that costs the man something, every time.
 * `spare`  refuses it, every time, and is the control.
 *
 * Neither reads a choice id. The policy is a rule over CONTENT — take (or
 * refuse) the branch whose outcomes deal Madness to somebody — so it still
 * means what it says after the next event is authored, and a list of ids
 * would not.
 *
 * ─── What it asserts ────────────────────────────────────────────────────────
 *
 * Two things, and neither of them is a rung. `climb` must end with more
 * Madness on the man standing highest than `spare` does — that is the
 * mechanism, and asserting the mechanism rather than a seed is this repo's
 * own rule. And the Madness floor must stop being the thing that blocks the
 * fourth rung in the climbing column, because that is what the gate text
 * says is wrong.
 *
 * What blocks it INSTEAD is printed rather than judged. When this was
 * written, it was books and power, and that is a library and a genetics
 * question rather than this one.
 *
 * The ceiling each column reaches is printed for the same reason and asserted
 * for none: where one run's ladder stops is a seed, and this repo does not
 * gate on seeds. See the comment beside the line that prints it. The `scion`
 * column (below) is printed on the same reasoning, for the same reason.
 *
 * ─── A third column: `scion` (issue #61) ─────────────────────────────────────
 *
 * `climb` and `spare` differ in one verb — whether Madness bargains are taken.
 * `scion` differs from `spare` in a DIFFERENT one verb: whether the house has
 * named somebody to build the ladder on. It refuses every Madness bargain
 * exactly like `spare` does, so the gap between the two isolates naming a
 * scion rather than mixing it with the cost of climbing.
 *
 * Measured at the point this issue was picked up: seven of eight blockers in
 * the climbing column were the Vessel's power gate, missing by three to
 * fourteen points, and #61's own earlier measurement already priced
 * concentrating a WHOLE HOUSE's marriages at seven points at the ceiling over
 * many hundreds of weddings — almost exactly that gap. `nameScion` plays the
 * oracle a real player approximates: an attentive house always has SOMEBODY
 * named, and holds him for life rather than re-litigating the choice every
 * time a nephew edges ahead, which would spend the bias on a different man
 * every few years and concentrate nothing.
 *
 * `latePower` (see its own doc comment) is printed rather than asserted, and
 * the reason changed shape as the mechanism grew. Stage A (the marriage
 * alone) was small and steady: on twenty seeds outside the default set,
 * `scion` beat `spare` on 2, tied on 16, lost on 2 — a mean move under two
 * points, in a range this batch could not call but that never swung hard
 * either way. Stage B (the longest useful book, a term in mind, no post)
 * and Stage C (the cost, and the vacancy noticed) made the SAME comparison
 * far noisier rather than more decisive: on the same twenty seeds, `scion`
 * beat `spare` on 9, tied on 4, and lost on 7, with individual seeds moving
 * by as much as fifty points in either direction. The mean still edges
 * positive, barely. Concentrating everything onto one man raises the
 * ceiling he can reach when his book and his blood both land, and lowers it
 * when they do not, which is a different claim from Stage A's steadier one
 * and not a smaller one to prove — a bigger batch, not a bigger opinion,
 * is what would settle it. `table.test.ts` proves every piece of the
 * mechanism fires deterministically on its own; what no column here yet
 * shows is whether the variance nets out kindly over enough centuries, and
 * that is a claim for #85's own accumulation work to make, not this gate.
 */
import { loadContent } from '@ed/content';
import { BLOCKING_GATE_CONFIG } from './gate-registry.js';
import { indexContent, type Content, type ContentBundle, type Rung } from '@ed/schema';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { POWER_FLOOR, foremostOf, rungIndex, standingOf } from '../ascension.js';
import { genomeOf, phenotypeOf } from '../people/factory.js';
import { eldritch } from '../genetics/expression.js';
import { END_YEAR } from '../ending.js';
import { CAMPAIGN_YEARS, START_YEAR } from '../campaign.js';
import type { SimCtx } from '../world.js';
import {
  nameScion, nameScionHeir, resolveYear, type LadderPolicy,
} from './ladder-policy.js';

export type { LadderPolicy };

type Source = ContentBundle | Content;

export interface LadderRun {
  seed: number;
  policy: LadderPolicy;
  /** The best anyone of the house ever stood, and the man who did it. */
  best: Rung;
  name: string;
  atYear: number;
  power: number;
  books: number;
  affinities: number;
  /** His Madness at his own high-water mark, and the deepest anyone reached. */
  madness: number;
  mind: number;
  madnessPeak: number;
  /** What was between him and the next rung. */
  blocked: string;
  /** Ladder demands seen, and how many were paid for. */
  asked: number;
  paid: number;
  /** Person-years spent standing at Adept or above, with a rung still in front. */
  adeptYears: number;
  /** Of those, the ones where the man had already paid the Hierophant floor. */
  floorPaid: number;
  /**
   * The deepest Madness ever carried BY A MAN ON THE LADDER — not by anyone,
   * which is a different and much easier number: the house's most ruined man
   * is usually somebody the blood overflowed in his twenties who never read a
   * book. This is the one the issue is about.
   */
  climberMadness: number;
  /**
   * THE BEST POWER SEEN FROM `LATE_WARMUP_YEAR` ON (issue #61, Stage A) —
   * deliberately NOT the same number as `power`, and the difference is the
   * whole reason this field exists.
   *
   * `power` is the best power at the house's ALL-TIME peak rung, and issue
   * #85 already measured where that peak sits: inside the first 8% of the
   * game, set by the founding generation's already-fixed marriages, before
   * the house has a second generation of cousins for ANY marriage policy to
   * concentrate onto. Measured while building this column: `scion` and
   * `spare` produced BYTE-IDENTICAL `power` on all eight default seeds — not
   * close, identical to four decimal places — because the formative marriage
   * in a two-generation-old house usually has no household card on offer at
   * all, so a bias toward household cards has nothing to bias. That is not
   * the mechanism failing; it is `power` measuring a year the mechanism
   * cannot yet have touched.
   *
   * So this tracks the same peak, but only from the point a family the size
   * of a real dynasty could plausibly have grown a bench of cousins to marry
   * — §22's own Hierophant timing (generation 10-15) is the reference.
   */
  latePower: number;
  /**
   * THE SECOND MAN'S OWN BEST POWER (issue #61, Stage E4) — the highest
   * power the SECOND-highest-power living expresser in the house ever
   * reached, sampled the same way `latePower` is, every year of the run.
   * `power` and `latePower` both describe the man standing highest;
   * `pair`'s whole claim is about the man standing NEXT to him, which
   * neither could ever answer. Zero where fewer than two expressers were
   * ever alive at once — a sample with no second man is a sample where
   * the pair the God rung asks for could not have existed.
   */
  secondPower: number;
  /** Genetic channel, measured once per distinct person seen during the run. */
  householdChannel: number;
  expresserChannel: number;
  /** Sums/counts let the batch report a true person-weighted mean. */
  riteChannelSum: number;
  riteTakers: number;
  vesselChannelSum: number;
  vesselTakers: number;
  greatChannelSum: number;
  greatTakers: number;
  /** Distinct people who completed BOTH rites, and whether two coexisted. */
  bothRiteTakers: number;
  bothRitePairYears: number;
  /** Best second-highest power among living people who had completed both rites. */
  secondBothRitePower: number;
  /** The E5 pair route itself, so silence is not mistaken for a weak constant. */
  secondNameFires: number;
  secondWideningFires: number;
}

/** §22's Hierophant Madness floor, from `gateFor`. */
const HIEROPHANT_FLOOR = 20;

/**
 * WHEN A MARRIAGE POLICY HAS SOMETHING TO WORK WITH (issue #61, Stage A).
 * §22 targets Hierophant at generation 10-15, roughly 250-375 years past
 * 1042 at this world's marriage age — 300 splits that band. `latePower`
 * is measured only from here, so a founding-generation marriage neither
 * column could have influenced does not stand in for the mechanism.
 */
const LATE_WARMUP_YEARS = 300;

function geneticChannelOf(ctx: SimCtx, p: ReturnType<SimCtx['world']['people']['get']> extends infer T ? Exclude<T, undefined> : never): number {
  const base = eldritch(genomeOf(p, ctx.genetics), p.sex, ctx.genetics.table);
  return Math.max(0, (base.ceiling - 4) / 0.8);
}

export function playOnce(bundle: Source, seed: number, years: number, policy: LadderPolicy, bid: number): LadderRun {
  const content = indexContent(bundle);
  const ctx = bootstrap(content, seed, START_YEAR);
  const w = ctx.world;
  // The one standing order both columns share, so the shelf is the same size
  // in each. Without it the auction never spends and the books axis, not the
  // Madness axis, is what separates the columns.
  w.bidCeiling = bid;

  const startYear = w.year;
  const tally = { asked: 0, paid: 0 };
  let peak: LadderRun | undefined;
  let madnessPeak = 0;
  let adeptYears = 0;
  let floorPaid = 0;
  let climberMadness = 0;
  let latePower = 0;
  let secondPower = 0;
  let bothRitePairYears = 0;
  let secondBothRitePower = 0;
  const bothRitePeople = new Set<string>();
  const householdChannels = new Map<string, number>();
  const expresserChannels = new Map<string, number>();
  const riteChannels = new Map<string, number>();
  const vesselChannels = new Map<string, number>();
  const greatChannels = new Map<string, number>();

  for (let y = 0; y < years; y++) {
    // The term, or the line running out before it (issue #42) — either stops
    // `stepYear` from turning the year on its own; this loop has no reason to
    // keep calling it once that has happened.
    if (w.year >= END_YEAR || w.ending) break;
    if (policy === 'scion' || policy === 'pair' || policy === 'pair_climb') nameScion(ctx);
    if (policy === 'pair' || policy === 'pair_climb') nameScionHeir(ctx);
    stepYear(ctx, false);
    resolveYear(ctx, seed, policy, tally);
    clearNamingQueue(ctx);

    // COLLECTED PER YEAR, NOT PUSHED STRAIGHT INTO `madnessPeak` (issue
    // #61, Stage E4): the second man is a fact about THIS year's expressers
    // relative to each other, and `secondPower` needs their powers held
    // together for exactly as long as it takes to find the second-highest,
    // the same reasoning gate 9's own `secondPowers` sample uses.
    const yearPowers: number[] = [];
    for (const p of w.people.household(w.playerHouse, w.year)) {
      const ph = phenotypeOf(p, ctx.genetics, w.year).eldritch;
      const channel = geneticChannelOf(ctx, p);
      householdChannels.set(p.id, channel);
      if (!ph.canExpress) continue;
      expresserChannels.set(p.id, channel);
      if (p.rites.includes('vessel') || p.rites.includes('great_rite')) riteChannels.set(p.id, channel);
      if (p.rites.includes('vessel')) vesselChannels.set(p.id, channel);
      if (p.rites.includes('great_rite')) greatChannels.set(p.id, channel);
      const st = standingOf(ctx, p);
      yearPowers.push(st.power);
      madnessPeak = Math.max(madnessPeak, st.madness);
      if (rungIndex(st.rung) >= rungIndex('adept')) {
        adeptYears += 1;
        climberMadness = Math.max(climberMadness, st.madness);
        if (st.madness >= HIEROPHANT_FLOOR) floorPaid += 1;
      }
    }
    yearPowers.sort((a, b) => b - a);
    secondPower = Math.max(secondPower, yearPowers[1] ?? 0);

    const bothRitePowers = w.people.household(w.playerHouse, w.year)
      .filter((p) => p.rites.includes('vessel') && p.rites.includes('great_rite'))
      .map((p) => {
        bothRitePeople.add(p.id);
        return standingOf(ctx, p).power;
      })
      .sort((a, b) => b - a);
    if (bothRitePowers.length >= 2) bothRitePairYears += 1;
    secondBothRitePower = Math.max(secondBothRitePower, bothRitePowers[1] ?? 0);

    const top = foremostOf(ctx);
    if (!top) continue;
    const st = top.standing;
    if (w.year - startYear >= LATE_WARMUP_YEARS) {
      latePower = Math.max(latePower, st.power);
    }
    const better = !peak
      || rungIndex(st.rung) > rungIndex(peak.best)
      || (rungIndex(st.rung) === rungIndex(peak.best) && st.power > peak.power);
    if (better) {
      peak = {
        seed, policy, best: st.rung, name: top.person.name, atYear: w.year,
        power: st.power, books: st.spells, affinities: st.affinities,
        madness: st.madness, mind: st.mind, madnessPeak: 0, blocked: st.blocked ?? '',
        asked: 0, paid: 0, adeptYears: 0, floorPaid: 0, climberMadness: 0, latePower: 0, secondPower: 0,
        householdChannel: 0, expresserChannel: 0,
        riteChannelSum: 0, riteTakers: 0,
        vesselChannelSum: 0, vesselTakers: 0,
        greatChannelSum: 0, greatTakers: 0,
        bothRiteTakers: 0, bothRitePairYears: 0, secondBothRitePower: 0,
        secondNameFires: 0, secondWideningFires: 0,
      };
    }
  }

  const base: LadderRun = peak ?? {
    seed, policy, best: 'none', name: '-', atYear: w.year, power: 0, books: 0,
    affinities: 0, madness: 0, mind: 0, madnessPeak: 0, blocked: 'nobody of the house can express it',
    asked: 0, paid: 0, adeptYears: 0, floorPaid: 0, climberMadness: 0, latePower: 0, secondPower: 0,
        householdChannel: 0, expresserChannel: 0,
        riteChannelSum: 0, riteTakers: 0,
        vesselChannelSum: 0, vesselTakers: 0,
        greatChannelSum: 0, greatTakers: 0,
        bothRiteTakers: 0, bothRitePairYears: 0, secondBothRitePower: 0,
        secondNameFires: 0, secondWideningFires: 0,
  };
  const valuesOf = (m: Map<string, number>) => [...m.values()];
  const sumMap = (m: Map<string, number>) => valuesOf(m).reduce((a, b) => a + b, 0);
  const meanMap = (m: Map<string, number>) => m.size ? sumMap(m) / m.size : 0;
  return {
    ...base, madnessPeak, adeptYears, floorPaid, climberMadness, latePower, secondPower,
    householdChannel: meanMap(householdChannels),
    expresserChannel: meanMap(expresserChannels),
    riteChannelSum: sumMap(riteChannels),
    riteTakers: riteChannels.size,
    vesselChannelSum: sumMap(vesselChannels),
    vesselTakers: vesselChannels.size,
    greatChannelSum: sumMap(greatChannels),
    greatTakers: greatChannels.size,
    bothRiteTakers: bothRitePeople.size,
    bothRitePairYears,
    secondBothRitePower,
    secondNameFires: w.frequency.templateFires['the_second_name'] ?? 0,
    secondWideningFires: w.frequency.templateFires['the_second_widening'] ?? 0,
    asked: tally.asked, paid: tally.paid,
  };
}

/**
 * WHICH TEMPLATES A HOUSE THAT PLAYS FOR THE LADDER EVER SEES (issue #64).
 *
 * The fire-rate gate plays the chronicler, and the chronicler never climbs. So
 * an event cast on a living Hierophant — the rites, most obviously — is
 * unreachable to that batch BY DESIGN, and a gate that convicted on it would
 * send the next person to loosen conditions that are correct. Measured when
 * the issue was filed: `the_vessel_rite`, `the_vessel_remembered` and
 * `the_unmaking` were all on the never-fired list, and all three fire fine
 * under a policy that climbs.
 *
 * This is the acquittal pass. It is deliberately NOT part of the main batch —
 * playing 250 runs by policy costs what `gate:ladder` costs and buys nothing
 * in the healthy case, because nothing is failing. It runs only over the
 * templates the chronicler batch could not reach, which is normally none.
 */
export { firedUnderClimbing } from './ladder-fires.js';

export interface LadderVerdict { ok: boolean; lines: string[] }

export function gateLadder(
  source: Source = loadContent(),
  opts: { seeds?: number[]; years?: number; bid?: number } = {},
): LadderVerdict {
  const config = BLOCKING_GATE_CONFIG.ladder;
  const bundle = indexContent(source);
  const seeds = opts.seeds ?? [...config.seeds];
  const years = opts.years ?? config.years;
  const bid = opts.bid ?? config.bid;

  const columns = config.policies.map((policy) => ({
    policy,
    runs: seeds.map((s) => playOnce(bundle, s, years, policy, bid)),
  }));

  const mean = (rs: LadderRun[], f: (r: LadderRun) => number) => rs.reduce((a, r) => a + f(r), 0) / (rs.length || 1);
  const lines: string[] = [`gate (ladder): ${seeds.length} played runs x ${years} years, per policy`];
  const share = (rs: LadderRun[]) => mean(rs, (r) => r.floorPaid) / Math.max(1, mean(rs, (r) => r.adeptYears));
  for (const c of columns) {
    lines.push(
      `  ${c.policy.padEnd(6)} deepest Madness on a man ON THE LADDER ${mean(c.runs, (r) => r.climberMadness).toFixed(1).padStart(5)}`
      + `  ladder-years past the floor ${(100 * share(c.runs)).toFixed(0).padStart(3)}%`
      + `  bargains offered ${mean(c.runs, (r) => r.asked).toFixed(1).padStart(5)}`
      + `  best power ${mean(c.runs, (r) => r.power).toFixed(1).padStart(5)}`
      + `  late power ${mean(c.runs, (r) => r.latePower).toFixed(1).padStart(5)}`
      + `  books ${mean(c.runs, (r) => r.books).toFixed(1).padStart(4)}`,
    );
  }

  // THE CEILING, PRINTED AND NOT ASSERTED. #41's acceptance is "Adept is not
  // the modal ceiling", and where a run's ceiling lands is a seed: measured
  // over twenty played thousand-year runs the climbing column reaches
  // Hierophant in six and the sparing column in two, so at this gate's six
  // default seeds a floor on that share would be a coin. This repo does not
  // gate on seeds. What made the top of the ladder unreachable was arithmetic
  // — forty books asked of a game containing twenty-one — and arithmetic is
  // asserted in `ascension.test.ts`, deterministically, where it cannot flake.
  // This line is here so that a human reading a sweep can see the ceiling move.
  for (const c of columns) {
    const total = (pick: (r: LadderRun) => number) => c.runs.reduce((n, r) => n + pick(r), 0);
    const weighted = (sum: (r: LadderRun) => number, count: (r: LadderRun) => number) => {
      const n = total(count);
      return n ? total(sum) / n : 0;
    };
    lines.push(
      `  ${c.policy.padEnd(10)} genetic channel — household ${mean(c.runs, (r) => r.householdChannel).toFixed(2)}`
      + `  expressers ${mean(c.runs, (r) => r.expresserChannel).toFixed(2)}`
      + `  rite-takers ${weighted((r) => r.riteChannelSum, (r) => r.riteTakers).toFixed(2)}`
      + ` (${total((r) => r.riteTakers)})`
      + `  vessel ${weighted((r) => r.vesselChannelSum, (r) => r.vesselTakers).toFixed(2)}`
      + ` (${total((r) => r.vesselTakers)})`
      + `  great ${weighted((r) => r.greatChannelSum, (r) => r.greatTakers).toFixed(2)}`
      + ` (${total((r) => r.greatTakers)})`,
    );
    const tally = new Map<Rung, number>();
    for (const r of c.runs) tally.set(r.best, (tally.get(r.best) ?? 0) + 1);
    lines.push(`  ${c.policy.padEnd(6)} best rung reached: `
      + [...tally].sort((a, b) => rungIndex(b[0]) - rungIndex(a[0]))
        .map(([r, n]) => `${r} ${n}`).join('  '));
  }

  const climb = columns[0]!.runs;
  const spare = columns[1]!.runs;
  const scion = columns[2]!.runs;
  const pair = columns[3]!.runs;
  const pairClimb = columns[4]!.runs;
  const separates = mean(climb, (r) => r.climberMadness) > mean(spare, (r) => r.climberMadness);
  const paid = share(climb);
  const floorReached = paid >= FLOOR_SHARE_FLOOR;

  if (!separates) {
    lines.push('  FAIL: climbing and sparing leave the same Madness on the men standing on the ladder —'
      + ' the decision does not reach it');
  }
  if (!floorReached) {
    lines.push(`  FAIL: only ${(100 * paid).toFixed(0)}% of ladder-years in the climbing column have paid`
      + ` §22's Hierophant floor of ${HIEROPHANT_FLOOR} (floor ${(100 * FLOOR_SHARE_FLOOR).toFixed(0)}%)`);
  }
  // NAMING A SCION, PRINTED AND NOT ASSERTED — the same choice this file
  // already makes for the ceiling each column reaches, and for the same
  // reason. See the header comment above for the fuller measurement: the
  // full mechanism (marriage, books, mind, no post, the cost) is noisier
  // than Stage A's marriage-only cut was, not steadier — on twenty seeds
  // outside the default set, `scion` beat `spare` on `latePower` by 9 of
  // 20, tied on 4, lost on 7, with single seeds moving fifty points either
  // way. Concentrating everything the house has onto one man raises what he
  // can reach when it lands and lowers it when it does not; `table.test.ts`
  // proves every piece fires deterministically, so what is uncertain is
  // whether the variance nets out kindly over enough centuries — a question
  // for a much larger batch, not for whether the mechanism exists.
  lines.push(`  scion  best power from year ${LATE_WARMUP_YEARS} on: `
    + `${mean(scion, (r) => r.latePower).toFixed(1)} vs spare's ${mean(spare, (r) => r.latePower).toFixed(1)}`
    + ' (not asserted — see the comment above this line)');
  // THE PAIR COLUMN, PRINTED AND NOT ASSERTED, same reason as `scion`
  // above and not yet even measured once: this is the first run this
  // column has ever played (issue #61, Stage E4). `secondPower` is the
  // claim `pair` exists to move — the second man's own best power, not the
  // house's foremost man's — so it is compared here rather than folded
  // into `latePower`, which answers a different question about the SAME
  // man `power` already describes.
  lines.push(`  pair   second man's best power: ${mean(pair, (r) => r.secondPower).toFixed(1)}`
    + ` vs scion's ${mean(scion, (r) => r.secondPower).toFixed(1)}`
    + ' (not asserted — see the comment above this line)');
  // THE SECOND MAN'S RITES (issue #61, Stage E5), and the only comparison in
  // this gate that can see them. `pair` refuses every ladder bargain, so the
  // scenes `second_foremost` casts are offered and declined in that column;
  // `pair_climb` is `pair` with `climb`'s answer, so the gap between it and
  // `climb` is rite ACCESS for the second man and nothing else. Printed and
  // not asserted, the same as the two lines above: what is under test is
  // whether the number moves at population scale, and this repo does not gate
  // on seeds.
  lines.push(`  pair+  second man's best power: ${mean(pairClimb, (r) => r.secondPower).toFixed(1)}`
    + ` vs climb's ${mean(climb, (r) => r.secondPower).toFixed(1)}`
    + `  (Hierophant pair-power proxy ${POWER_FLOOR.hierophant}: `
    + `${pairClimb.filter((r) => r.secondPower >= POWER_FLOOR.hierophant).length}/${pairClimb.length} runs)`);
  lines.push(
    `  pair+  both rites: ${pairClimb.reduce((n, r) => n + r.bothRiteTakers, 0)} people`
    + ` · years with two fully-rited men ${pairClimb.reduce((n, r) => n + r.bothRitePairYears, 0)}`
    + ` · best second fully-rited power ${Math.max(0, ...pairClimb.map((r) => r.secondBothRitePower)).toFixed(1)}`
    + ` · second-name/widening fires ${pairClimb.reduce((n, r) => n + r.secondNameFires, 0)}/${pairClimb.reduce((n, r) => n + r.secondWideningFires, 0)}`,
  );
  lines.push(`  what stops the climbing column instead: ${[...new Set(climb.map((r) => r.blocked))].join(' | ')}`);
  lines.push(`  what stops the scion column instead: ${[...new Set(scion.map((r) => r.blocked))].join(' | ')}`);
  lines.push(`  what stops the pair column instead: ${[...new Set(pair.map((r) => r.blocked))].join(' | ')}`);
  return { ok: separates && floorReached, lines };
}

/**
 * A FLOOR AND NOT A TARGET, set the way gate 4's fire-rate floor was: far
 * enough below where the content stands that it never argues with an author,
 * close enough to matter before somebody quietly removes the last bargain.
 * Measured over twelve played thousand-year runs at the time of writing:
 *
 *     climb  deepest Madness on a man on the ladder 40.8   ladder-years past the floor 21%
 *     spare  deepest Madness on a man on the ladder  9.4   ladder-years past the floor  2%
 *
 * Five per cent is a quarter of where the climbing column stands and more
 * than twice where the sparing one does, which is the gap this is here to
 * keep open.
 *
 * Asserted of the climbing column only. A house whose player refuses every
 * bargain SHOULD arrive at the gate with a whole man and no Madness — that is
 * the bargain being real, and it is the control this gate is built around.
 */
const FLOOR_SHARE_FLOOR = 0.05;

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('ladder-gate.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const config = BLOCKING_GATE_CONFIG.ladder;
  const runs = Number(args[0] ?? config.seeds.length);
  const years = Number(args[1] ?? config.years);
  const bid = Number(args.find((a) => a.startsWith('--bid='))?.split('=')[1] ?? config.bid);
  const seeds = runs <= config.seeds.length
    ? [...config.seeds].slice(0, runs)
    : Array.from({ length: runs }, (_, i) => config.seeds[0] + i * 13);
  const { ok, lines } = gateLadder(loadContent(), { seeds, years, bid });
  for (const l of lines) console.log(l);
  process.exit(ok ? 0 : 1);
}
