import type { RespectTier } from '@ed/schema';
import { assertNever, MAIN_BRANCH, RESPECT_ORDER } from '@ed/schema';
import type { SimCtx } from './world.js';
import { assizeFavour } from './assize.js';
import { attr } from './people/factory.js';
import { isBonded } from './people/bond.js';
import { activeBranches, hall } from './people/branches.js';
import { madnessCoverOf } from './people/careers.js';
import { landIncome } from './land.js';
import { musterUpkeep } from './muster.js';
import { msg } from './messages.js';

/**
 * THE ANNUAL ECONOMY (concept §13).
 *
 * This did not exist. The treasury only ever moved when an event spent it, and
 * every event that touches money spends it — so the house drifted past −1,000
 * crowns by year 1400 and stayed there. Nothing broke, because nothing checks
 * a negative treasury: the only visible symptom was that `maintainCast`
 * silently stopped hiring retainers, so the tutor, the midwife and the
 * archivist quietly vanished from the game around year 1150.
 *
 * Prices are the ones in the brief, and they are small enough to feel.
 * 1 crown = 20 marks = 240 mites.
 */

/**
 * The cost of living as a house of that standing. Not in the brief's price
 * table, and needed: with only per-head upkeep the treasury climbs past
 * 50,000 crowns by 2042 and money stops being a constraint at all — which
 * quietly removes the §13 tension the whole economy exists for ("tutor the
 * child you have, or buy the book his grandchildren might read").
 *
 * Standing is not free. A house at Eminent must be seen to live like one.
 */
const STANDING_COST: Record<RespectTier, number> = {
  unknown: 6,
  known: 20,
  regarded: 44,
  eminent: 84,
  exalted: 146,
};

/**
 * Drop one tier, if there is one to drop.
 *
 * Decay floors at **Known**, and the floor is load-bearing rather than kind. A
 * house with a seal, a hall and eight hundred years of dead is known to exist;
 * Unknown is a thing that has to be DONE to you, and it stays reachable
 * through authored `respect` effects. Without the floor the decay compounds
 * through the economy — Unknown pays 16 a year against a standing cost of 6
 * and twenty mouths, so the house cannot afford an archivist, so it stops
 * recovering clauses, so its endgame is decided by year 1300 by a rule about
 * being boring.
 */
type RespectSlipCause = 'madness' | 'quiet' | 'debt';

/** The string audit inventories literal keys and templates, not computed lookup tables. */
function slipText(ctx: SimCtx, cause: RespectSlipCause, tier: RespectTier): string {
  const values = { TIER: tier };
  switch (cause) {
    case 'madness':
      return msg(ctx, 'respect.slip.madness',
        'The house was {TIER} and then it was not, because of what people had started to say about the son in the east rooms. Nobody announced it. It was simply the case by the following spring.',
        values);
    case 'quiet':
      return msg(ctx, 'respect.slip.quiet',
        'The house was {TIER} and then it was not, because nothing had been done in thirty years worth telling anyone about. Nobody announced it. It was simply the case by the following spring.',
        values);
    case 'debt':
      return msg(ctx, 'respect.slip.debt',
        'The house was {TIER} and then it was not, because the house was visibly broke, and everybody could see it. Nobody announced it. It was simply the case by the following spring.',
        values);
    default:
      return assertNever(cause, 'Respect-slip cause');
  }
}

function slip(ctx: SimCtx, cause: RespectSlipCause, floor = 1): boolean {
  const w = ctx.world;
  const i = RESPECT_ORDER.indexOf(w.respect);
  if (i <= floor) return false;
  w.respect = RESPECT_ORDER[i - 1]!;
  w.respectChanged = w.year;
  w.chronicle.push({
    year: w.year,
    weight: 'paragraph',
    title: msg(ctx, 'respect.slip.title', 'They Were Spoken Of Differently'),
    text: slipText(ctx, cause, RESPECT_ORDER[i]!),
    named: false,
  });
  return true;
}

export function tickRespect(ctx: SimCtx): void {
  const w = ctx.world;
  const since = w.respectChanged ?? w.year;

  // Visible Madness burns standing fast. The gate is capability, as ever —
  // only those who can express can overflow, so this can never fire on a
  // household of women and mundane men. Clergy grant Madness cover (issue
  // #16) — a family can hide a great deal behind a cassock.
  const roster = hall(w, MAIN_BRANCH, w.year);
  const worst = roster.reduce((m, p) => Math.max(m, p.madness), 0) - madnessCoverOf(ctx, roster);
  if (worst > VISIBLE_MADNESS && w.year % 5 === 0) {
    if (slip(ctx, 'madness')) return;
  }

  // A quiet generation costs a tier.
  if (w.year - since >= RESPECT_QUIET_YEARS) {
    if (slip(ctx, 'quiet')) return;
    w.respectChanged = w.year;   // already at the floor; stop re-checking yearly
  }
}

/** Standing cost, per living household member, per year. */
const UPKEEP_PER_HEAD = 1;
/** Raising a child, per year, birth to twenty. Doubles the cost of the young. */
const CHILD_SURCHARGE = 1;

/**
 * The reserve one mouth can be said to have, measured against the visible
 * standard the house is obliged to keep. `condition.ts` uses the same prices
 * as the annual tally rather than maintaining a second, drifting economy.
 */
export function standingCostPerHead(respect: RespectTier, livingHeads: number): number {
  return UPKEEP_PER_HEAD + STANDING_COST[respect] / Math.max(1, livingHeads);
}

/**
 * WHAT THE SEAT'S OWN ADULTS BRING IN.
 *
 * Nobody at the main house worked. A cadet cousin in a branch sent up
 * `TITHE_PER_ADULT` and cost `KIN_UPKEEP_PER_HEAD`, netting the house +0.25 a
 * year; the SAME PERSON, living at the seat, produced nothing and cost
 * `UPKEEP_PER_HEAD`, netting −1. Income was a flat function of standing, so
 * the only thing household size could do to the books was drain them.
 *
 * That made wealth a function of how many children happened to live, which is
 * a demographic dice roll rather than a decision. Measured over twelve
 * thousand-year runs: a house whose main hall held twenty-five ran −19 a year
 * at Known and −0.9 even at Eminent, so it pinned to `DEBT_FLOOR` by about
 * 1200 and stayed there; a house that happened to stay small ran +13 at Known
 * and passed 3,000 crowns. Both bands were stable, and neither was chosen.
 *
 * The knock-on was the Ledger. `maintainCast` will not hire below 20 crowns,
 * `revealClause` pays only a house keeping an archivist, and so the pinned
 * houses recovered two or three clauses of nine against the God rung's seven
 * — the endgame decided in the twelfth century by family size. That is the
 * failure `slip`'s own comment already names ("so the house cannot afford an
 * archivist, so it stops recovering clauses"); it was guarded at the Respect
 * floor and left open at the household one.
 *
 * Set just above `UPKEEP_PER_HEAD` so an adult at the seat is, like a branch
 * adult, slightly better than free — and well under the standing costs, so
 * §13's tension survives intact: a big house is no longer doomed, and it is
 * still nowhere near rich.
 */
const LABOUR_PER_ADULT = 0.5;
/** Old enough to bring something in. The same bar the branch tithe uses. */
const WORKING_AGE = 16;

/**
 * What a cadet hall sends the seat each year, per working adult.
 *
 * A branch feeds itself — it is not on the main house's books — and sends up
 * what it can spare. An aggrieved one sends nothing, and stops sending it long
 * before it does anything louder. The tithe is small on purpose: five halls
 * paying is a comfortable house, not a rich one, and the §13 tension ("tutor
 * the child you have, or buy the book his grandchildren might read") survives.
 */
const TITHE_PER_ADULT = 0.75;

/**
 * And what they cost. Kin are cheaper than mouths at your own table and they
 * are not free: dowries, funerals, the standing of the name they share.
 *
 * The two numbers are set so a loyal branch roughly pays for itself and an
 * aggrieved one is a straight drain. That is the whole economic argument for
 * noticing the wound before it becomes an Insurrection.
 */
const KIN_UPKEEP_PER_HEAD = 0.5;

/**
 * The borrowing limit. A house pinned here is not having a bad year — it has
 * run out of credit and is still short. Two subsystems have to agree on what
 * that means, and a bare -120 in each is how they stop agreeing.
 */
export const DEBT_FLOOR = -120;

export interface EconomyReport {
  income: number;
  upkeep: number;
  wages: number;
  tithe: number;
  /** What the seat's own working adults bring in — the main hall's counterpart to `tithe`. */
  labour: number;
  /** `resource` modifiers (issue #11) — per-year income or drain attached to a person, not a contract. */
  resource: number;
  /** `musterUpkeep` (issue #89, Stage 2 — #95) — zero with no commitment standing. */
  war: number;
  net: number;
}

/**
 * RESPECT DECAYS (concept §17).
 *
 * It did not. Respect moved only when an authored effect moved it, so a house
 * that had a good century at 1300 was still Eminent in 2042 having done
 * nothing since — and two of four measured runs simply sat at Exalted from the
 * moment they got there. Which means the endgame squeeze the whole last act is
 * built on ("you need enormous Madness to ascend, Respect to be allowed to,
 * and Madness destroys Respect") had one of its three jaws missing.
 *
 * Three pressures, all annual, all slow enough to be a generation's problem
 * rather than a year's:
 *
 *   QUIET      a generation that does nothing loses a tier. Standing is a
 *              performance, and nobody remembers a house that stopped.
 *   MADNESS    visible Madness burns it fast. Concealment is what the last two
 *              centuries are FOR.
 *   DEBT       being visibly broke is how a great house stops being one.
 *              Already present; now it costs standing rather than a counter.
 */
const RESPECT_QUIET_YEARS = 45;
/** Household Madness above this is visible, whatever the family says. */
const VISIBLE_MADNESS = 45;

/** What an exaction adds to everything the house buys, while it is in force. */
const EXACTION_SURCHARGE = 1.35;

/**
 * What a house spends every year for being visibly worth what it is worth.
 *
 * Tuned so the treasury settles in the low thousands rather than the low tens
 * of thousands: at a surplus of sixty crowns a year the equilibrium is about
 * two thousand, which is a house that can buy a minor spellbook and think
 * hard about a foreign one — §13's own tension, at every century of the run.
 */
const LIVING_UP = 0.03;

export function tickEconomy(ctx: SimCtx): EconomyReport {
  const w = ctx.world;
  const roster = hall(w, MAIN_BRANCH, w.year);

  // Income derives from holdings, modified by the Head's Charm and standing
  // (issue #93, `land.ts`) — this comment used to describe a system that was
  // never built, over a flat lookup on the Respect tier alone.
  const head = roster.find((p) => p.castSlots.includes('head'));
  const charm = head ? attr(head, 'charm', ctx.genetics, w.year) : 0;
  // WARDSHIP (world "Taxes"): "the Warden may take the estate's management
  // until majority and keep the profits." `head` is undefined for exactly as
  // long as `w.wardship` is set and unbought — nobody of the house holds the
  // seal — so the Charm bonus above is already zero; this line is what
  // "keep the profits" means for the treasury. `boughtBack` restores it
  // without ending the minority itself: buying the wardship back is the
  // house resuming the estate's management, not the ward turning sixteen.
  const income = w.wardship && !w.wardship.boughtBack ? 0 : landIncome(ctx) * (1 + charm / 220);

  let upkeep = STANDING_COST[w.respect];
  let wages = 0;
  let labour = 0;
  for (const p of roster) {
    if (p.contract) {
      // A servant's yearly wage is quoted in marks; twenty to the crown.
      //
      // EXCEPT A BONDED ONE, WHO IS NOT PAID (world §12, `people/bond.ts`).
      // Their wage services the debt instead, and `serviceBonds` already takes
      // it off what is owed — so charging it here as well had the house paying
      // the same marks twice, once into a debt that fell and once out of a
      // treasury that did not. Two systems that each believed they owned the
      // wage, which is the shape of nearly every bug in this file's history.
      if (!isBonded(p)) wages += p.contract.wage / 20;
      continue;
    }
    upkeep += UPKEEP_PER_HEAD;
    if (w.year - p.born < 20) upkeep += CHILD_SURCHARGE;
    if (w.year - p.born >= WORKING_AGE) labour += LABOUR_PER_ADULT;
  }

  // The branches keep their own books and send up a tithe (concept §16).
  let tithe = 0;
  for (const b of activeBranches(w)) {
    const members = hall(w, b.id, w.year);
    const working = members.filter((p) => w.year - p.born >= 16 && !p.contract).length;
    tithe += working * TITHE_PER_ADULT * Math.max(0, 1 - b.grievance / 100);
    upkeep += members.length * KIN_UPKEEP_PER_HEAD;
  }

  // `resource` (issue #11) — a trait's own per-year income or drain, tied to
  // whoever holds it rather than to a contract wage. Separate term, same
  // treasury: the one place money moves is still `w.treasury`.
  let resource = 0;
  for (const p of roster) {
    for (const tid of p.traits) {
      const trait = ctx.content.trait(tid);
      if (!trait) continue;
      for (const pres of trait.presence) {
        for (const m of pres.modifiers) {
          if (m.kind === 'resource') resource += m.perYear;
        }
      }
    }
  }

  // A HOUSE LIVES AS RICH AS IT IS.
  //
  // `STANDING_COST` is per tier and fixed, and its own comment says why it
  // exists: without it "the treasury climbs past 50,000 crowns by 2042 and
  // money stops being a constraint at all". A fixed cost only postpones that.
  // Any persistent surplus — and careers, once the steward actually filled
  // posts, made one — integrates over a thousand years into exactly the same
  // number, and it did: fifteen to twenty-two thousand crowns by 2042, with
  // §13's price table (40 crowns to tutor, 60-200 for a minor book) rendered
  // meaningless all over again.
  //
  // A proportional term is the only thing that bounds it, and it is what the
  // standing cost was always reaching for. A great house does not sit on a
  // strongbox: it keeps more horses, more glass, more people at the table, and
  // it does so in proportion to what everybody can see it has. The treasury
  // settles where income and outgo meet instead of climbing forever, and every
  // price in the brief keeps meaning something in 1900 that it meant in 1042.
  upkeep += Math.max(0, w.treasury) * LIVING_UP;

  // THE ASSIZE'S EXACTION (`assize.ts`). Rivals have agreed among themselves
  // what the house pays for things, and the house pays it. Applied to the
  // upkeep rather than the income because that is what it is: everything the
  // house buys costs more, and nothing it sells fetches less.
  if (assizeFavour(ctx, 'exaction')) upkeep *= EXACTION_SURCHARGE;

  // THE WAR (issue #89, Stage 2 — #95). Money moves in one place: `musterUpkeep`
  // only reads `world.muster`, it never touches `w.treasury` itself, exactly
  // the discipline `resource` and the bonded wage above already keep — two
  // systems that each believe they own a cost is how the house pays it twice.
  const war = musterUpkeep(ctx);

  const net = income + tithe + labour + resource - upkeep - wages - war;
  w.treasury += net;

  // A house cannot borrow forever. Debt bites standing rather than stopping
  // the clock — being visibly broke is how a great house stops being one.
  if (w.treasury < DEBT_FLOOR) {
    w.treasury = DEBT_FLOOR;
    w.discontent = Math.min(100, w.discontent + 1);
    slip(ctx, 'debt');
  }

  tickRespect(ctx);
  return { income, upkeep, wages, tithe, labour, resource, war, net };
}
