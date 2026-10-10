import type { Person } from '@ed/schema';
import { asId, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { hashSeed, type Rng } from '../rng.js';
import { attr, conceiveChild, genomeOf, phenotypeOf } from './factory.js';
import { baseName } from './names.js';
import { assizeFavour } from '../assize.js';
import { DEMIGOD_AGEING_STOPPED, standingOf } from '../ascension.js';
import { BASELINE_MAX_AGE, coupleFertility, MOTHER_SHARE } from './vitality.js';
import { branchOf, halls, softCapFor } from './branches.js';
import { mintForRole } from './minting.js';
import { onTheMarket } from '../table.js';
import { careerMortality, inBreedingPool } from './careers.js';
import { deleteriousLoad } from '../genetics/expression.js';
import { musterMortality } from '../muster.js';
import { acquiredFamilySize } from './condition.js';
import { msg } from '../messages.js';

/**
 * WHO DIES, WHO MARRIES, WHO IS BORN.
 *
 * The three population processes, in one file, because they share their brakes
 * and their constants and were tuned against each other. They used to sit in
 * the middle of `sim.ts` between the year loop and the player's verbs, which
 * meant every change to the shape of a year read like a change to fertility.
 */

// ── Death ─────────────────────────────────────────────────────────────────

// INVARIANT 1 + 2: Madness overflow reads canExpress; every death goes through kill().
/** What a physician staying in the house is worth against ordinary mortality. */
const MERCY_HAZARD = 0.72;

export function rollDeath(p: Person, ctx: SimCtx, rng: Rng): boolean {
  const w = ctx.world;
  const age = w.year - p.born;
  const strength = attr(p, 'strength', ctx.genetics, w.year);
  const ph = phenotypeOf(p, ctx.genetics, w.year).eldritch;
  const mind = attr(p, 'mind', ctx.genetics, w.year);
  const madnessHazard = ph.canExpress && p.madness > mind
    ? Math.min(0.2, (p.madness - mind) / 260)
    : 0;
  const violenceHazard = careerMortality(ctx, p) + musterMortality(ctx, p);

  // §22's Demigod effect is literal: ageing stops. A man who has reached
  // Demigod is no longer exposed to the ordinary age curve, the max-age wall,
  // plague multipliers or the thin-line mortality amplifier. The two things
  // the brief still permits to kill him remain live: military violence and
  // Madness overflow. This is especially load-bearing after the Unmaking,
  // where a successful recipient may have to wait for the Ledger to finish.
  // Avoid a full ladder reading for the overwhelming majority of people:
  // nobody can be Demigod without the Great Rite (or an Unmaking that carries
  // it forward), so rites are the cheap structural prefilter.
  const mightBeDemigod = p.rites.includes('great_rite') || p.rites.includes('unmaking');
  const rung = mightBeDemigod ? standingOf(ctx, p).rung : 'none';
  const reachedDemigod = p.acquired[DEMIGOD_AGEING_STOPPED] === 1
    || rung === 'demigod'
    || rung === 'god';
  if (reachedDemigod) {
    // Once reached, the effect survives later movement in current standing.
    p.acquired[DEMIGOD_AGEING_STOPPED] = 1;
    const hazard = violenceHazard + madnessHazard;
    if (!rng.bool(hazard)) return false;
    return w.people.kill(
      p.id,
      w.year,
      madnessHazard > 0 ? madnessCause(ctx) : msg(ctx, 'demography.cause.violence', 'by violence'),
    );
  }

  // `Math.max(0, (age - 45) ** 2)` was the bug that emptied every house: the
  // square is ALWAYS positive, so the clamp did nothing and the curve ran
  // backwards — a one-year-old carried a 12% annual hazard and almost no child
  // reached seventeen. The clamp belongs INSIDE the square.
  //
  // Everything below reads age as a FRACTION of this body's own ceiling, so a
  // body built for a hundred and thirty starts dying later and on the same
  // shape.
  const maxAge = attr(p, 'max_age', ctx.genetics, w.year) || BASELINE_MAX_AGE;
  const spent = age / maxAge;

  // MAX AGE IS A CEILING, NOT A CENTRE. It was neither for a while: the curve
  // was merely scaled by it and nothing enforced it, so a man built for a
  // hundred and thirty-seven died at a hundred and forty-three and the number
  // was quietly an average. Nobody ordinary outlives their maximum.
  if (age >= maxAge) {
    return w.people.kill(p.id, w.year, msg(ctx, 'demography.cause.old_age', 'of the years, all of them having been used'));
  }

  // And the wall is approached rather than hit. Without the terminal term the
  // hazard at the ceiling is about 18% a year, so a fifth of every cohort
  // would pile up and die exactly ON their maxAge — the same cliff the
  // fertility curve was rewritten to avoid, in the other direction.
  let hazard = 0.004 + 0.6 * Math.max(0, spent - 0.45) ** 2;
  if (spent > 0.8) hazard += 0.5 * ((spent - 0.8) / 0.2) ** 3;

  // Deliberate infant mortality, tapering to nothing by five. Period-correct,
  // and it gives the physician's presence effect something to actually suppress.
  if (age < 5) hazard += 0.03 * (1 - age / 5);

  hazard *= 1 - Math.min(0.5, strength / 220);

  // Military: kills people. A career's own extra hazard plus the muster hazard
  // are the violence term Demigods retain above.
  hazard += violenceHazard;

  // Madness overflow takes people. Only ever those who could express.
  hazard += madnessHazard;

  // A PHYSICIAN IN THE HOUSE (`assize.ts`). When the world has decided the
  // family is worth steadying, somebody competent is in the building and
  // fewer people die of the ordinary things.
  if (assizeFavour(ctx, 'mercy')) hazard *= MERCY_HAZARD;

  // THE AGE THE HOUSE IS LIVING THROUGH (issue #42). Multiplicative across
  // stacked Ages, because two catastrophes at once are worse than either — and
  // `world.age.active` is a list precisely because they stack.
  hazard *= ageMortality(ctx);

  hazard *= thinBloodMortality(ctx, p);

  if (!rng.bool(hazard)) return false;

  // kill() returns false for the Narrator: his death is redirected, not
  // applied, so he never appears in the year's death list.
  return w.people.kill(
    p.id,
    w.year,
    madnessHazard > 0 ? madnessCause(ctx) : msg(ctx, 'demography.cause.ordinary', 'in the ordinary way'),
  );
}

/**
 * A cause of death is rendered in the reader's prose mode at the moment of
 * death and stored as those words, like every other saved page (#276, #410).
 * `passage.ts` quotes it inside its own keyed line, so an unkeyed cause left a
 * Plain English reader with a translated sentence around an Original phrase.
 */
function madnessCause(ctx: SimCtx): string {
  return msg(ctx, 'demography.cause.madness', 'the blood, overflowing');
}

/**
 * What the Ages currently running do to the chance of dying.
 *
 * The product over active Ages, so a Plague inside a Wars is worse than
 * either alone. Most Ages return 1 and cost nothing.
 */
export function ageMortality(ctx: SimCtx): number {
  let m = 1;
  for (const a of ctx.world.age.active) {
    m *= ctx.content.age(a.age)?.mortalityMultiplier ?? 1;
  }
  return m;
}

/**
 * A SMALL LINE HAS NO BUFFER (issue #42, recalibrated issue #132).
 *
 * `broken_line` is one of §23's five endings. It fired in **0 of 60** runs
 * back when every newborn defaulted to `kind: 'blood'` regardless of
 * parentage (the bug #42's first commit, `436a8a7`, fixed) — the line was
 * inexhaustible, so nothing here was ever exercised against a real one. Once
 * blood became finite, `broken_line` fired in **33–39% of runs**, the median
 * one breaking **76 years after founding**, and it was a cliff: measured over
 * 60 seeds, **0 of 37 surviving runs ever passed through 1 or 2 living
 * blood** — a line either kept its founding few or went to zero, nothing in
 * between (issue #132).
 *
 * The mechanism below is not new; its CALIBRATION was stale by thirteen days.
 * It reacted to the house's own high-water mark, capped at
 * `MORTALITY_BUFFER_LINE` — so a house that peaked at four was measured
 * against four — and that graduated reading is exactly what let a founding
 * house's very first ordinary death engage real hazard: dropping from four
 * to three against a threshold of four is already a quarter short, squared
 * by the coefficient below into a real multiplier on the next death, and
 * every further loss compounded it before the house had a chance to grow
 * past its own tiny peak. A large family absorbs a bad year; a family of
 * four, thinned once, never got the chance to prove it wasn't ending.
 *
 * So the mechanism now asks a harder question first: has this house ever
 * actually reached the scale it is measured against? Below
 * `MORTALITY_BUFFER_LINE`, a house's current smallness IS its established
 * norm, not a decline from one — there is nothing yet to have fallen from.
 * The curve only engages once a house has proven it can hold the full
 * ten, which is also the population that supplied the ORIGINAL "one run in
 * twenty" reading this coefficient was swept against (`docs/BALANCE-LOG.md`,
 * "A line with nobody left to lose") — a mature house that grew past ten and
 * then crashes, typically under the Plague Age's own `mortalityMultiplier`.
 * That lever is untouched by this change.
 *
 * It reads the BLOOD, alive, for the same reason `livingBlood` and
 * `measureFortune` now do: a household full of servants is not a family, and
 * counting them made every reading of "is this line ending" impossible to
 * fail.
 *
 * It is not a rubber band (invariant 13). The Assize's arms react to how the
 * house is *doing* and announce themselves in the chronicle; this reacts to
 * one fact about the family and pushes only downward. The deaths it causes are
 * ordinary deaths and are chronicled as such, which is what #42 asks for: the
 * chain from decision to collapse has to be readable from the book alone.
 *
 * `broken_line` stays reachable — this does not remove the mechanism, only
 * the regime it was never actually tested against. Full measurement,
 * before/after, in `docs/BALANCE-LOG.md`.
 */
export function thinBloodMortality(ctx: SimCtx, p: Person): number {
  const w = ctx.world;
  // Only the blood carries the line. A retainer dying is a sad thing that
  // happens to a household, not a thing that can end a family.
  if (!p.membership.some((m) => m.house === w.playerHouse && m.kind === 'blood')) return 1;

  const line = w.people.blood(w.playerHouse).filter((q) => q.status === 'alive').length;
  // A house that has never reached the buffer scale has nothing to have
  // declined FROM — see the header. Below the cap, this is a no-op, and the
  // threshold is therefore always the cap itself once it applies at all.
  if (w.bloodHighWater < MORTALITY_BUFFER_LINE || line >= MORTALITY_BUFFER_LINE) return 1;

  // SUPERLINEAR, because the buffer does not run out linearly. A house of six
  // is barely touched and a house of two has nobody at all: squaring the
  // shortfall is what puts almost all of the effect in the last three people,
  // which is where the design wants it — a line of six that loses one is
  // unlucky, a line of two that loses one is over.
  return 1 + MORTALITY_NO_BUFFER * ((MORTALITY_BUFFER_LINE - line) / MORTALITY_BUFFER_LINE) ** 2;
}

/**
 * A line this size has somebody else to marry, bear and inherit — the size at
 * which a house still has a BUFFER, which is the whole concept both of these
 * thresholds are about.
 *
 * The two were `FRAGILE_LINE` and `THIN_LINE_AT`: near-synonyms at different
 * values governing different systems, which is a pair of names that cannot
 * tell a reader which is which. They say the system now.
 */
const MORTALITY_BUFFER_LINE = 10;

/**
 * How much harder the last of a line dies, at the limit of one person left.
 *
 * SWEPT against issue #42's target of about one run in twenty ending with
 * nobody at the table — see `docs/BALANCE-LOG.md`. The median run never enters
 * the regime at all, so this buys a tail without moving the middle.
 */
const MORTALITY_NO_BUFFER = 22.0;

// ── Births ────────────────────────────────────────────────────────────────

/**
 * A house is not a population. Left alone, every adult marrying and breeding
 * for twenty-seven years doubles the household every generation and the tree
 * becomes unreadable by year 1200. Two brakes, both deterministic:
 *
 *   COMPLETED FERTILITY  each couple has a target number of children, derived
 *                        from their inherited fecundity and their ids, so it is
 *                        stable across save and load.
 *   HOUSEHOLD PRESSURE   past a soft cap, births and marriages fall away. A
 *                        great house with sixty mouths and one seal is a house
 *                        with a succession problem, not a bigger house.
 *
 * Pressure is measured PER HALL, not per house. That is the whole demographic
 * consequence of cadet branches: the crowding brake used to be the only thing
 * standing between the family and forty people in one room, so it had to be
 * brutal, and the family stayed tiny for a thousand years as a result. Split
 * the roof and each hall has its own headroom — the house grows sideways,
 * which is how real ones did it.
 *
 * COMPLETED FERTILITY IS INHERITED. It was `2 + hash(seed, mother, father) % 4`
 * — stable across save and load, and inherited by nothing. Every marriage
 * decision in the game was a bet on WHAT a couple's children would be and never
 * on HOW MANY, so a house that married a famously fruitful line got precisely
 * nothing for it, and the only demographic dial we had was a constant the
 * player could not see. Three details worth keeping:
 *
 *   THE MOTHER CARRIES IT.  Seventy-thirty, not fifty-fifty. A man of a thin
 *   line is a mild disappointment; a woman of one is the whole marriage. This
 *   is what puts fertility into the same economy as the font — you are reading
 *   a bride's mother and her sisters for two different things at once — and it
 *   is why a daughter married outward costs the house twice. The ratio lives in
 *   `people/vitality.ts` and is used twice: as a weight on the inherited cap
 *   here, and as an exponent on the pair's fertility there. One rule about
 *   whose fertility it mostly is, not two constants that drift.
 *
 *   CENTRED, NOT HARDCODED.  The mapping is relative to the attribute's
 *   population mean, computed from the locus table at bootstrap. Retune
 *   `LOCI_PER_CORE` and family sizes stay where they are instead of drifting.
 *
 *   STILL JITTERED.  A couple keeps a small id-derived wobble, so two
 *   brothers who married two sisters do not complete identical families.
 */

/**
 * A CEILING IS NOT ENOUGH, which the first cut of this got wrong.
 *
 * Completed fertility is a cap on a couple's children, and measured over four
 * hundred years most couples never reach theirs — crowding, a husband dead at
 * fifty, and a 16% annual chance get there first. So making the cap heritable
 * changed almost nothing about who actually had children: the top third of
 * mothers by fecundity bore very slightly FEWER than the bottom third, which
 * is noise, which is the same as saying the attribute was decorative.
 *
 * Fecundity therefore drives the annual chance as well. That is also what the
 * word means: not how many you may have, but how readily they come.
 *
 * It drives it through FERTILITY now rather than directly — the same inherited
 * number, read through the body carrying it. See `people/vitality.ts`. The
 * constant below is what a REFERENCE couple gets: mean fecundity, sound health,
 * both at the peak of their curves. Everyone else is a fraction of it, and that
 * fraction is why this number is higher than the flat 0.16 it replaced without
 * the house being any larger — a curve averaging about seven tenths over a
 * fertile lifetime has to be paid for at the peak.
 *
 * TUNED AGAINST THE TREASURY, not the household. Twenty seeds to 2042: the
 * house lands at 66 living against 64 before the change, which is noise, and
 * the two numbers downstream of it are not. A house one child larger per
 * generation is a house that spends its surplus on kin upkeep, stops being able
 * to keep an archivist, and stops recovering the Ledger — 0.23 cost eight
 * points of staffed years and a clause per run, all of it invisible from the
 * demography. Anyone retuning this measures `years with staff` and `clauses
 * recovered`, not just how many Gearithys are standing in 2042.
 */
export const CONCEPTION_PEAK = 0.22;

/**
 * The biological window, wide on purpose. What actually ends a woman's
 * childbearing is the curve going to zero at fifty, not this — a hard cutoff at
 * forty-four made thirteen percent of all births happen in the four years
 * before it and then none at all, which is a cliff no population has.
 */
export const CHILDBEARING = { from: 15, to: 50 };

/**
 * 3.1, not 3.5. The old hash produced a flat 2–5, and matching its MEAN
 * overshot the house by a sixth — `Math.round` sends every .5 upward, so a
 * symmetric jitter around 3.5 completes families of 3.67. Tuned instead
 * against the household at 600 years (~63 living, six halls), which is the
 * number that has to stay put: heritable fertility was meant to change what
 * family size MEANS, not how big the house is on the day it lands.
 */
export const FERTILITY_BASE = 3.1;
/** Children per point of fecundity. One standard deviation ≈ one child. */
export const FERTILITY_SLOPE = 0.09;
export const FERTILITY_MAX = 9;

/**
 * Fertility option D (issue #25): a named recessive rather than a gradient.
 * `del_hollow_year` is harmless carried and near-sterile homozygous — this is
 * the whole implementation, because fecundity already exists as an attribute
 * with something to clamp. Below the population's observed floor (0, see
 * `demography.slow.test.ts`), so whichever parent carries it drags the pair
 * down regardless of what the other parent's own fecundity would have been.
 */
const HOLLOW_YEAR = 'the hollow year';
const HOLLOW_YEAR_FLOOR = -5;

function isHollowYearHomozygote(p: Person, ctx: SimCtx): boolean {
  return deleteriousLoad(genomeOf(p, ctx.genetics), ctx.genetics.table).names.includes(HOLLOW_YEAR);
}

/** The couple's inherited fecundity, weighted toward the mother. */
export function pairFecundity(mother: Person, father: Person, ctx: SimCtx): number {
  const y = ctx.world.year;
  const combined = attr(mother, 'fecundity', ctx.genetics, y) * MOTHER_SHARE
    + attr(father, 'fecundity', ctx.genetics, y) * (1 - MOTHER_SHARE);
  if (isHollowYearHomozygote(mother, ctx) || isHollowYearHomozygote(father, ctx)) {
    return Math.min(combined, HOLLOW_YEAR_FLOOR);
  }
  return combined;
}

/**
 * The annual chance, from what the two bodies can do THIS year. Fertility is
 * fecundity read through age, sex and condition; `coupleFertility` combines the
 * pair multiplicatively, so either one of them being finished finishes both.
 */
export function conceptionChance(mother: Person, father: Person, ctx: SimCtx): number {
  const y = ctx.world.year;
  return CONCEPTION_PEAK * coupleFertility(
    attr(mother, 'fertility', ctx.genetics, y),
    attr(father, 'fertility', ctx.genetics, y),
  );
}

export function completedFertility(pair: number, mother: Person, father: Person, ctx: SimCtx): number {
  const w = ctx.world;
  const centre = ctx.genetics.expected.get('fecundity') ?? 0;
  const jitter = (hashSeed(w.seed, 'fertility', String(mother.id), String(father.id)) % 3) / 2 - 0.5;
  const target = FERTILITY_BASE + (pair - centre) * FERTILITY_SLOPE + jitter
    + acquiredFamilySize(mother, father);
  return Math.max(0, Math.min(FERTILITY_MAX, Math.round(target)));
}

export function crowding(size: number, cap: number): number {
  if (size <= cap) return 1;
  return Math.max(0.05, 1 - (size - cap) / cap);
}

export interface Conception {
  birth: ReturnType<typeof conceiveChild>;
  branch: string;
  /** Two contracted parents: a servant family, of the household but not the blood. */
  servants: boolean;
}

/**
 * How much of its ordinary fertility a house this thin still gets.
 *
 * 1 for any line with a buffer, so the median run — which is past the
 * threshold within its first century and never returns — is untouched. It is
 * the same reading `fragility` takes, for the same reason, and the two
 * together are what make `broken_line` reachable at all: killing the last of a
 * line does nothing if the last of a line breeds back at full rate.
 */
export function thinBloodFertility(ctx: SimCtx): number {
  const w = ctx.world;
  const line = w.people.blood(w.playerHouse).filter((q) => q.status === 'alive').length;
  // Against the house's own history, like `fragility`: a founding house of
  // three is not a house the market has decided against.
  const at = Math.min(FERTILITY_BUFFER_LINE, w.bloodHighWater);
  if (line >= at || at <= 0) return 1;
  return Math.max(FERTILITY_NO_BUFFER_FLOOR, line / at);
}

/**
 * The line size below which the market notices.
 *
 * Deliberately LOWER than `MORTALITY_BUFFER_LINE`, and the first cut had them equal at
 * ten — which throttled every house's founding century, because the blood's
 * low-water mark is 3 or 4 in every run and it is passed on the way UP. The
 * measured cost of that was the middle of the distribution rather than the
 * tail: `devoured` fell from 25% to 12.5% and the runs attesting above Adept
 * halved, because houses were being held down before they ever had a chance to
 * climb. A tail must not be bought with the median.
 */
const FERTILITY_BUFFER_LINE = 4;

/** What is left of a house's fertility when it is down to its last one or two. */
const FERTILITY_NO_BUFFER_FLOOR = 0.16;

export function rollBirths(ctx: SimCtx, rng: Rng): Conception[] {
  // Lazy: most years the house has no birth at all, and this walks everyone
  // who has ever lived.
  let dynasty: ((base: string) => number) | undefined;

  const w = ctx.world;
  const results: Conception[] = [];

  // A THIN LINE IS ALSO A POOR MATCH (issue #42). The other half of the
  // buffer: a house visibly ending is not one the market is eager to marry
  // into, and the men and women it does still have are older, fewer and
  // spoken about. Without this the mortality term alone could take a line down
  // to one and watch it breed straight back — measured, low-water reached 1 in
  // 40 runs and zero of them ended.
  const bufferFertility = thinBloodFertility(ctx);

  for (const [branch, members] of halls(w, w.year)) {
    const pressure = crowding(members.length, softCapFor(branch)) * bufferFertility;

    for (const mother of members) {
      if (mother.sex !== 'female') continue;
      const age = w.year - mother.born;
      if (age < CHILDBEARING.from || age > CHILDBEARING.to) continue;
      const marriage = mother.marriages.find((m) => !m.to);
      if (!marriage) continue;
      const father = w.people.get(marriage.spouse);
      if (!father || father.status !== 'alive') continue;

      // Clergy: removed from the breeding pool entirely (issue #16).
      if (!inBreedingPool(ctx, mother) || !inBreedingPool(ctx, father)) continue;

      const pair = pairFecundity(mother, father, ctx);
      const borne = w.people.children(mother.id).length;
      if (borne >= completedFertility(pair, mother, father, ctx)) continue;

      if (!rng.bool(conceptionChance(mother, father, ctx) * pressure)) continue;

      const ordinal = borne + 1;
      const household = w.people.householdOf(mother.id, w.year) ?? w.playerHouse;
      // Children of the house are named dynastically; everyone else gets a
      // byname. Built once per year rather than once per birth.
      const dynastic = household === w.playerHouse ? (dynasty ??= dynasticNames(ctx)) : undefined;
      results.push({
        birth: conceiveChild(
          mother, father, ordinal, w.year, ctx.genetics, ctx.takenNames, dynastic, household, w,
          { friends: w.friends },
        ),
        branch,
        servants: Boolean(mother.contract && father.contract),
      });
    }
  }
  return results;
}

/**
 * How many people born into the house have ever borne each given name. The
 * dynastic ordinal (`NameOrigin.borne`) counts the dead as well as the living,
 * which is the whole difference between `Edric the fourth` and a name that
 * happens to be free this decade.
 */
function dynasticNames(ctx: SimCtx): (base: string) => number {
  const counts = new Map<string, number>();
  for (const p of ctx.world.people.all()) {
    if (p.houseOfOrigin !== ctx.world.playerHouse) continue;
    const base = baseName(p.name);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return (base) => counts.get(base) ?? 0;
}

// ── Marriage ──────────────────────────────────────────────────────────────

/**
 * Of age, alive, unspoken for, and allowed to marry at all.
 *
 * Exported because the draft (`match.ts`) and the pairing below have to agree
 * about this exactly. They used to be one predicate inside one function, and
 * the moment the player was allowed to choose, "who can marry" became a
 * question two files ask — which is how a bride ends up on a card that the
 * marriage code will not accept.
 */
export function eligibleToMarry(ctx: SimCtx, p: Person): boolean {
  const w = ctx.world;
  return p.status === 'alive'
    && !p.marriages.some((m) => !m.to)
    && !p.castSlots.includes('the_match')   // she can never actually be drafted
    && inBreedingPool(ctx, p)                // Clergy do not marry (issue #16)
    && w.year - p.born >= 17
    && w.year - p.born <= 45;
}

/**
 * PAIRING FOR EVERYONE THE PLAYER IS NOT ASKED ABOUT.
 *
 * The seat's own marriages are drafted from cards now — see `match.ts`, and
 * `matchSubjects` for exactly who that covers. This is the rest of the world:
 * cadet halls, retainers, the married-in. It has to keep growing a real
 * pedigree so the genetics has something to act on, and it has to keep
 * diluting the font when the house marries outward, because that is the
 * pressure the whole design turns on.
 */
export function autoMarry(ctx: SimCtx, rng: Rng, skip: ReadonlySet<string> = new Set()): void {
  const w = ctx.world;
  // A DAUGHTER HELD BACK IS HELD BACK FROM ALL OF IT.
  //
  // `matchSubjects` already declines to deal a hand for anybody the `withhold`
  // order has taken off the market. This did not ask, so the house married her
  // the same spring — as an initiator, or, less visibly, as somebody else's
  // partner — and the order came out doing the exact opposite of what it says:
  // it stopped the PLAYER being asked and let the house answer. §7's whole
  // point is that a daughter kept back is a match the house does not make.
  //
  // Asked here rather than filtered by the caller because "who may be married"
  // is the question this predicate exists to answer once, for both sides of a
  // pairing — the same reason `eligibleToMarry` was pulled out of it.
  const eligible = (p: Person) => eligibleToMarry(ctx, p) && onTheMarket(ctx, p);

  const byHall = halls(w, w.year);
  const pressureOf = new Map<string, number>();
  for (const [branch, members] of byHall) {
    pressureOf.set(branch, crowding(members.length, softCapFor(branch)));
  }
  const household = [...byHall].flatMap(([branch, members]) =>
    members.filter(eligible).map((p) => ({ p, branch })));

  for (const { p, branch } of household) {
    if (p.marriages.some((m) => !m.to)) continue;
    // Somebody whose match is standing on the docket. Pairing them here would
    // answer a question the player has already been asked.
    if (skip.has(p.id)) continue;
    // A crowded hall does not find matches for everyone. Younger sons go
    // unmarried, take careers, or leave — and leaving is now a real place to
    // go, so a full house pushes people into the branches rather than nowhere.
    const pressure = pressureOf.get(branch) ?? 1;
    if (pressure < 1 && !rng.bool(pressure)) continue;

    // Prefer somebody who already exists — cousins included, since cousin
    // marriage is the mechanism rather than a temptation.
    const inWorld = w.people.living().filter(
      (q) => eligible(q)
        && q.sex !== p.sex
        && q.id !== p.id
        && Math.abs(q.born - p.born) < 16
        && !(q.trueParents.mother && q.trueParents.mother === p.trueParents.mother)
        && !q.marriages.some((m) => !m.to),
    );

    // THE HOUSE'S STANDING ORDER ON MARRIAGE (issue #41).
    //
    // Untouched, this line takes whoever the person store happens to hold
    // first, which is arbitrary with respect to the one thing the design says
    // marriage is FOR. Measured over three thousand-year runs: of 767 people
    // born to the house, five had two parents who both carried. The pairing
    // §7 calls "the mechanism" was happening by accident, at the rate chance
    // allows, in a house whose entire identity is the blood.
    //
    // The player's own hands cannot fix that. The Match is one chapter beat a
    // generation — about 46 hands against 547 marriages — so choosing
    // perfectly on eight percent of them is swamped by the ninety-two the
    // house makes on its own. What reaches all of them is a standing order,
    // which is what the table is for (§13).
    //
    // `as_it_falls` is the default and is byte-identical to the arbitrary
    // line it replaces, which `npm run digest` is the check on.
    let partner = preferred(ctx, p, inWorld);

    // Otherwise mint one from a character template. Their house decides their
    // gene pool, and therefore whether they carry anything at all — which is
    // why marrying out is a gamble on a hidden allele rather than a known loss.
    //
    // Note a GROOM is minted for a daughter too. A house whose living blood is
    // all female must practise matrilineal marriage or end, and a family whose
    // power runs through its women would obviously have invented it. Everyone
    // else finds it scandalous, which is content.
    if (!partner) {
      const household = w.people.householdOf(p.id, w.year) ?? w.playerHouse;
      partner = mintForRole(ctx, p.sex === 'male' ? 'suitor' : 'groom', rng, {
        household,
        membership: 'married_in',
      });
    }

    if (!partner) continue;
    wed(ctx, p, partner);
  }
}

/**
 * MARRY TWO PEOPLE. The one place a marriage is made — the draft and the
 * automatic pairing both come through here, so what marrying MEANS is written
 * once and neither path can drift from the other.
 */
export function wed(ctx: SimCtx, p: Person, partner: Person): void {
  const w = ctx.world;
  p.marriages.push({ spouse: partner.id, from: w.year });
  partner.marriages.push({ spouse: p.id, from: w.year });

  // Whoever married IN moves household. Ordinarily that is the wife; in a
  // matrilineal match it is the husband, and the difference is exactly what
  // decides whether the next generation belongs to this house or leaves it.
  //
  // The sitting Head is never the mover, whichever side of the pair she is.
  // `ensureHead` recalls a new head to the main hall the day she is seated;
  // without this guard, a REIGNING head marrying a cousin who already lives
  // in a cadet branch got physically relocated to his hall by this same
  // pass — silently, since nothing here knew or cared that `p` held the
  // seal. A Head who rules from the smaller house is a Head whose own hall
  // is somebody else's, the same failure `recallToMain` exists to prevent.
  const mover = p.castSlots.includes('head')
    ? partner
    : partner.castSlots.includes('head')
      ? p
      : (p.sex === 'female' && partner.houseOfOrigin !== w.playerHouse)
        ? partner            // he joins her — matrilineal
        : (p.sex === 'male' ? partner : p);
  const stayer = mover === p ? partner : p;
  const destination = w.people.householdOf(stayer.id, w.year);
  if (!destination) return;

  // And into the right HALL. A bride marrying a cadet joins his branch, not
  // the seat — otherwise every marriage quietly refilled the main house and
  // the branches never grew a second generation.
  const destBranch = destination === w.playerHouse ? branchOf(w, stayer, w.year) : MAIN_BRANCH;

  const current = mover.membership.find((m) => m.to === undefined);
  const sameHall = current
    && current.house === destination
    && (current.branch ?? MAIN_BRANCH) === destBranch;
  if (!sameHall) {
    if (current) current.to = w.year;
    const record: Person['membership'][number] = {
      house: asId(destination),
      kind: 'married_in',
      from: w.year,
    };
    if (destination === w.playerHouse && destBranch !== MAIN_BRANCH) record.branch = destBranch;
    mover.membership.push(record);
  }
}

/**
 * Order the candidates by the house's standing order.
 *
 * `in` is the concentrating play: somebody of the blood first, and among them
 * whoever carries the most — which is the closest a house can come to acting
 * on §7 without the player being asked about every wedding. `out` is its
 * opposite, and it is a real strategy rather than a null one: marrying outward
 * buys money, standing and allies, and spends the only thing that cannot be
 * bought back.
 *
 * `as_it_falls` returns the list untouched. That is the shipped default and
 * the reason this function has a branch that does nothing: the order is a
 * decision the player makes, and a house given no orders keeps doing exactly
 * what it did before this existed.
 *
 * THE SCION (issue #61, Stage A) OVERRIDES ALL OF IT, ahead of every other
 * check including `as_it_falls`. `marriagePolicy` is a policy for the whole
 * house; the scion is a decision about ONE MAN, and a house that named him
 * and then let his own wedding fall to the house-wide policy would not have
 * named him for anything. He always marries the deepest blood on offer.
 *
 * THE HEIR GETS THE SAME OVERRIDE (issue #61, Stage E4) — a separate
 * branch rather than folding him into the Scion's, because this function
 * answers for ONE candidate's own wedding at a time and the two never
 * compete for the same call: whichever of them `p` is, he picks the
 * deepest blood on offer from HIS OWN candidates exactly as the Scion does.
 */
function preferred(ctx: SimCtx, p: Person, candidates: Person[]): Person | undefined {
  const w = ctx.world;
  if (candidates.length < 2) return candidates[0];

  const ours = (q: Person) => q.houseOfOrigin === w.playerHouse;
  const font = (q: Person) => phenotypeOf(q, ctx.genetics, w.year).eldritch.carriedFont;
  const deepestBlood = (pool: Person[]) => [...pool].sort((a, b) =>
    ((ours(b) ? 1000 : 0) + font(b)) - ((ours(a) ? 1000 : 0) + font(a))
    || (a.id < b.id ? -1 : 1))[0];

  if (w.scion && p.id === w.scion) return deepestBlood(candidates);
  if (w.scionHeir && p.id === w.scionHeir) return deepestBlood(candidates);

  if (w.marriagePolicy === 'as_it_falls') return candidates[0];

  // Only the player's house is under the player's orders. Everybody else's
  // marriages are their own business, and pairing the whole world by our
  // policy would make the Marrow concentrate their blood too.
  if (!ours(p)) return candidates[0];

  const rank = (q: Person): number => (w.marriagePolicy === 'in'
    ? (ours(q) ? 1000 : 0) + font(q)
    : (ours(q) ? 0 : 1000) - font(q));

  return [...candidates].sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : 1))[0];
}
