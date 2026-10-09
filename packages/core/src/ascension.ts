import type { Person } from '@ed/schema';
import { MAIN_BRANCH, RESPECT_ORDER, RUNG_ORDER, assertNever } from '@ed/schema';
import type { Rung } from '@ed/schema';
import type { SimCtx } from './world.js';
import { attr, phenotypeOf } from './people/factory.js';
import type { LocusTable } from './genetics/loci.js';
import { hall } from './people/branches.js';
import { heirloomDef, heldHeirlooms } from './people/heirlooms.js';
import { msg } from './messages.js';

/**
 * THE ASCENSION LADDER (concept §22).
 *
 * This was not in the code. Grepping `core` for a tier, a rung or a gate
 * returned comments and test fixtures and nothing else. Six rungs are
 * specified — Touched, Adept, Hierophant, the Vessel, Demigod, God — and they
 * are what a player is supposed to be climbing for forty generations, and the
 * simulation had no idea they existed. The player's only answer to "am I
 * winning?" was a Respect tier that landed on exalted anyway and a clause
 * count that filled itself.
 *
 * ─── The scale problem, and why this file normalises ────────────────────────
 *
 * §22's gates are written on a 0-100 scale: Touched at 10, Adept at 25,
 * Hierophant at 50, Vessel 70, Demigod 85, God 98. The genetics produce
 * nothing of the kind. Measured over eight thousand-year runs, the highest
 * carried font anybody reached was 26.8 and the highest EXPRESSED power was
 * 17.6, because `channelCeiling` binds hard and binds early. On the raw scale
 * the second rung of six was unreachable in principle, and the top four were
 * not merely hard but arithmetically impossible.
 *
 * Two ways out. Move the genetics until the raw numbers happen to line up with
 * a prose document — which is tuning the most load-bearing system in the game
 * to satisfy a scale nobody chose. Or map the genetic quantity onto the real
 * one, which is what invariant 10 already says to do everywhere else:
 * *"anything mapping an attribute onto a real quantity centres on
 * `ctx.genetics.expected`"*, and *"a cap is not an effect: measure whether the
 * ceiling ever binds"*. It binds. Constantly.
 *
 * So `eldritchPower` is expressed power as a percentage of what the LOCUS
 * TABLE — which is content, and regenerable — can actually produce. A man at
 * the genetic maximum reads 100. §22's numbers then mean exactly what they
 * say, the genetics are untouched, and an author who adds a font locus moves
 * the ceiling and the ladder together instead of silently breaking one of them.
 *
 * ─── What is here, and what is not ──────────────────────────────────────────
 *
 * The rungs, their gates, and the house's high-water mark are here, measured
 * every year and readable by a client and by authored content (the `ascension`
 * condition). The RITES are not: the Vessel's named sacrifice, the Great Rite
 * and its Church sanction, and the God rite's unmaking of the elder are player
 * decisions with authored text, and they belong in content rather than in a
 * measurement module. Rungs four and up therefore gate on everything §22 asks
 * for EXCEPT the rite itself, and `rungGate` names the rite as the last
 * requirement so nothing pretends the ladder is finished.
 *
 * ─── Since then: the rites are answerable (issue #43) ───────────────────────
 *
 * Half of that is no longer true and the half that changed is the important
 * one. The three rites are still not measured here — what a rite DOES is in
 * `events/rites.ts`, and whether the house is ever asked is in content, which
 * is where both belong. What is here is that `gateFor` now READS the answer:
 * `Person.rites` records the acts a man has taken, so rungs four to six can
 * be reached instead of merely described. Before it, every one of those three
 * `return`s was unconditional, and the top half of the ladder was a gate with
 * no key — the same shape as §22's forty books asked of a game containing
 * twenty-one, one floor up.
 *
 * The Vessel is built. The Great Rite and the unmaking are declared, refuse
 * with a reason, and are named by their rungs — so what is missing is missing
 * out loud rather than by omission.
 */

/**
 * The rungs themselves live in `@ed/schema` (`rung.ts`), because the save
 * format and the condition union both need them and this codebase keeps no
 * second hand-written copy of a closed union.
 */
export { RUNG_ORDER as RUNGS, type Rung } from '@ed/schema';

/** Ordering, for "at least this rung" comparisons. */
export function rungIndex(r: Rung): number {
  return RUNG_ORDER.indexOf(r);
}

/**
 * Reaching Demigod stops ageing as a life event (§22). Current standing can
 * later fall when Respect, Regalia, or living family readers move; the body
 * must not start ageing again when that derived reading changes.
 */
export const DEMIGOD_AGEING_STOPPED = 'demigod_ageing_stopped';

/**
 * Remember that life event at the instant a caller can prove it happened.
 *
 * This is deliberately separate from the annual house high-water mark. Rites
 * are also player table actions, and a table action can resolve after the
 * year's ascension phase; waiting until next year's reading leaves mortality
 * a chance to run first. standingOf remains the authority on whether the
 * threshold was really reached — callers only choose WHEN to ask.
 */
export function noteDemigodAttainment(ctx: SimCtx, p: Person): boolean {
  const standing = standingOf(ctx, p);
  const attained = p.acquired[DEMIGOD_AGEING_STOPPED] === 1
    || rungIndex(standing.rung) >= rungIndex('demigod');
  if (!attained) return false;

  p.acquired[DEMIGOD_AGEING_STOPPED] = 1;

  // #185: the approved Apotheosis timing is "Demigod first, Ledger later",
  // and the wait has to be visible rather than a hidden immortality flag.
  // A table-ordered Unmaking can create this state after the annual ascension
  // phase and lose Respect in the very next authored effect, so write it at
  // the same boundary that proves the attainment. Dedupe keeps the annual
  // safety-net read from writing it twice.
  //
  // The dedupe is keyed on a page id made from the person's id (issue #276).
  // It used to search the chronicle for the page's own opening words, which
  // carried his name — so a reworded or translated page, or a renamed man,
  // would have been written again every year he waited.
  if (
    p.rites.includes('unmaking')
    && standing.rung === 'demigod'
    && standing.blocker === 'clauses'
  ) {
    const page = `ledger_wait:${p.id}`;
    if (!ctx.world.chronicle.some((entry) => entry.id === page)) {
      ctx.world.chronicle.push({
        id: page,
        year: ctx.world.year,
        weight: 'paragraph',
        title: msg(ctx, 'ascension.ledger_wait_title', 'The Ledger Stayed Open'),
        text: msg(ctx, 'ascension.ledger_wait',
          '{PERSON} stopped growing older before the Ledger was finished. The book remained open on the table. The house waited.',
          { PERSON: p.name }),
        people: [p.id],
        named: false,
        rung: 'demigod',
      });
    }
  }

  return true;
}

export function rungTitle(r: Rung): string {
  switch (r) {
    case 'none': return 'unwoken';
    case 'touched': return 'Touched';
    case 'adept': return 'Adept';
    case 'hierophant': return 'Hierophant';
    case 'vessel': return 'the Vessel';
    case 'demigod': return 'Demigod';
    case 'god': return 'God';
    default: return assertNever(r);
  }
}

/**
 * The most Eldritch Power the locus table can put into one man, on the raw
 * genetic scale. Every font locus at its strongest allele, throttled by the
 * ceiling the best possible channel allows.
 *
 * Computed off the table, never hardcoded: `gen-loci.mjs` is a tool and
 * `loci.yaml` is generated, so a hardcoded maximum stops being true the first
 * time anybody adds an attribute.
 *
 * Computed ONCE, at bootstrap, and carried on `GeneticsCtx` beside `expected`
 * — which is the same pattern for the same reason. It is a pure function of
 * the locus table, and the table does not change during a run; `eldritchPower`
 * asks for it on every rung of every gate of every person, and the `foremost`
 * slot role asks `standingOf` of the whole household. Walking the table each
 * time cost two and a half million redundant reductions a run.
 */
export function maxPowerOf(t: LocusTable): number {
  const best = (alleles: { effect?: number }[][], indices: number[]) =>
    indices.reduce((sum, i) => {
      const at = alleles[i] ?? [];
      return sum + at.reduce((m, a) => Math.max(m, a.effect ?? 0), 0);
    }, 0);

  const font = best(t.xAlleles, t.fontIndices);
  // A man has ONE X. The font sum is haploid, and doubling it here would put
  // the whole ladder out of reach by exactly a factor of two.
  const channel = best(t.autosomalAlleles, t.channelIndices) * 2;
  return Math.min(font, 4 + channel * 0.8);
}

/** The same number, off a running context. */
export function maxExpressiblePower(ctx: SimCtx): number {
  return ctx.genetics.maxPower;
}

/**
 * HOW MUCH OF THE THEORETICAL MAXIMUM A THOUSAND YEARS CAN ACTUALLY REACH.
 *
 * The first cut of this file normalised against `maxExpressiblePower` itself —
 * every font locus at its best allele, throttled by the best possible channel —
 * and that was the same mistake as §22's raw numbers, wearing better clothes.
 * Measured: the table's theoretical maximum is 66, and across six thousand-year
 * runs the highest carried font anybody reached was 26.8 and the highest
 * EXPRESSED power about 22. A scale whose top is 66 puts an ordinary expresser
 * at 17 and the best man in a run at 33, so the ladder's second rung was still
 * a coin flip and its top four were still unreachable.
 *
 * Invariant 10 is the rule that was being broken both times: *anything mapping
 * an attribute onto a real quantity centres on what the population actually
 * produces*, not on an arithmetic ceiling nobody stands near. So the scale is
 * anchored where forty generations of deliberate concentration can actually
 * reach, and the calibration is a measurement rather than an argument:
 *
 *   ordinary expresser   raw ~11  ->  EP ~37   (Adept's 25 is a real rung)
 *   a well-bred line     raw ~22  ->  EP ~74   (Hierophant's 50 is a goal)
 *   the best ever seen   raw ~27  ->  EP ~90   (Demigod's 85 is a tail)
 *   God's 98                          needs raw ~29, beyond any run measured
 *
 * That is the shape §22 asks for in prose: Adept typical by generation 3-5,
 * Hierophant "where most first runs die", Demigod a target rather than a
 * milestone, and God the terminal outcome a family has to be built for.
 *
 * Still derived from the table, so an author who adds a font locus moves the
 * ladder with it rather than silently breaking it.
 */
const ASCENT_REACH = 0.45;

/**
 * §22's BOOK COUNTS — the second quantity in this file that was prose taken
 * raw, and the one that made the top of the ladder impossible rather than
 * merely hard.
 *
 * §22 asks one man for 3 books at Adept, 8 at Hierophant, 15 at the Vessel,
 * 25 at Demigod and 40 at God. **The game contains twenty-one spellbooks.**
 * Forty of twenty-one is not a difficult gate; it is a gate with no key, and
 * it typechecked for as long as the raw power scale did and for exactly the
 * same reason — an absolute count, written in prose, against content that was
 * authored afterwards to a different size (invariant 11).
 *
 * That is the same shape `ASCENT_REACH` was built to fix, so it takes the same
 * fix, including the mistake that file already records making once. Measured
 * over twelve played thousand-year runs at a bid ceiling of 600:
 *
 *   the catalogue                      21 books, 8 of them at threshold 0
 *   the shelf the house assembles      12.1 of the 21
 *   the best-read man of a run          7.0, and never more than 9
 *
 * So normalising against the catalogue itself — all twenty-one — would be
 * `maxExpressiblePower` all over again: an arithmetic ceiling nobody stands
 * near, wearing better clothes. The scale is anchored where a thousand years
 * can actually put books in ONE MAN'S hands, which is `BOOK_REACH` of what
 * exists, and §22's counts are then read as fractions of its own top of forty:
 *
 *   Adept's 3      ->  1 book    an ordinary reader has it; a rung, cleared early
 *   Hierophant's 8 ->  3 books   a scaled 2, floored by the 3 affinities beside it
 *   the Vessel's 15 -> 4 books   a well-read man is past it; the blood is not
 *   Demigod's 25   ->  7 books   exactly the best-read man of a typical run
 *   God's 40       -> 8 books   a living family library deep enough for the last working
 *
 * What that leaves standing at the top is the blood, which is what §22 says is
 * supposed to stop a house: measured across the same twelve runs, power 50
 * with 3 books happens in 1,899 person-years and power 85 with 3 books in
 * NONE. Books ration the bottom of the ladder and the font rations the top,
 * and before this they both rationed the top and one of them did it with a
 * number no content could satisfy.
 *
 * The lower counts are derived from the catalogue, so adding a spellbook
 * moves those rungs with it. God's final reading remains eight distinct books;
 * the affinity half is calibrated separately as one representative from each
 * of the four opposed pairs.
 */
const SPELLS_OF_22: Record<Rung, number> = {
  none: 0, touched: 0, adept: 3, hierophant: 8, vessel: 15, demigod: 25, god: 40,
};

/** §22's own top, which the counts above are read as fractions of. */
const SPELLS_AT_GOD = 40;

/**
 * HOW MUCH OF THE LIBRARY A THOUSAND YEARS COULD PUT IN ONE MAN.
 *
 * Half of it. The measurement is in the block above: the shelf reaches 12.1 of
 * 21 and the best-read man of a run holds 7, never more than 9. Half of the
 * catalogue is 10.5. This scales the individual lower rungs. The God rite
 * now draws on living family readers. Its final reading remains eight distinct
 * books, while its circle asks the family to represent each opposed pair; the
 * old individual eleven-book target does not describe either half.
 *
 * A number to sweep and re-measure, not to nudge: raising it makes the top of
 * the ladder ask for books that do not exist again, and lowering it hands the
 * Vessel to any man who reads.
 */
const BOOK_REACH = 0.5;

/** Distinct books the living family must still be able to put on the final table. */
export const GOD_READING_BOOKS = 8;

/**
 * §22's AFFINITY COUNTS.
 *
 * The individual rungs still ask three of eight at Hierophant and five at
 * Demigod. The final family circle is different: 500-year calibration showed
 * "all eight alive at once" was the collection bottleneck after the household
 * rite itself became reachable. God therefore asks FOUR pair positions, with
 * one or both sides of every opposed pair represented. It is not "any four".
 */
const AFFINITIES_OF_22: Record<Rung, number> = {
  none: 0, touched: 0, adept: 0, hierophant: 3, vessel: 0, demigod: 5, god: 4,
};

export const GOD_AFFINITY_PAIRS = [
  ['fluid', 'thermal'],
  ['aero', 'terra'],
  ['life', 'death'],
  ['light', 'darkness'],
] as const;

export function affinitiesFor(rung: Rung): number {
  return AFFINITIES_OF_22[rung];
}

/**
 * How many books this rung actually wants, of the ones the game contains.
 *
 * Never fewer than one where §22 asks for any: a rung that asks for no reading
 * at all is not the rung §22 wrote, whatever the arithmetic rounds to.
 *
 * And never fewer than the affinities beside it. A book carries ONE affinity,
 * so a man holding n books covers at most n of them, and §22's own numbers
 * respect that at every rung — 8 books against 3 affinities, 25 against 5, 40
 * against 8. Normalising the books and not the affinities crosses those two
 * lines at Hierophant, where a scaled 2 sits under an unscaled 3, and the
 * declared book count becomes a number no man can ever be stopped by
 * (invariant 11): the affinity gate one line below would already have refused
 * him. The lower bound is not a difficulty choice — measured, Hierophant
 * wanted three books before this and wants three after it. It is the
 * difference between a gate that says what it does and a gate that does not.
 */
export function booksFor(ctx: SimCtx, rung: Rung): number {
  const asked = SPELLS_OF_22[rung];
  if (asked <= 0) return 0;
  // The last working keeps a real library gate separate from its circle:
  // eight distinct learned books, but only one represented affinity from each
  // opposed pair. Collapsing this to four books would let the final reading
  // become easier than Demigod's seven-book prerequisite.
  if (rung === 'god') return GOD_READING_BOOKS;
  const reference = ctx.content.spellbooks.length * BOOK_REACH;
  const scaled = Math.round((asked / SPELLS_AT_GOD) * reference);
  return Math.max(1, affinitiesFor(rung), scaled);
}

/**
 * Eldritch Power on §22's scale: 0 to 100. See `ASCENT_REACH` for what 100
 * means and why it is not the arithmetic maximum.
 */
/** Raw genetic power corresponding to one point on §22's normalised scale. */
export function rawPowerFor(ctx: SimCtx, score: number): number {
  return ctx.genetics.maxPower * ASCENT_REACH * (score / 100);
}

export function eldritchPower(ctx: SimCtx, p: Person): number {
  const raw = phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.expressedPower;
  const reference = rawPowerFor(ctx, 100);
  return reference > 0 ? Math.min(100, (raw / reference) * 100) : 0;
}

/**
 * §22's MIND, and the third quantity in this file that was prose taken raw
 * (issue #61).
 *
 * §22 asks the Vessel for `mind >= 70` and God for a mind that outruns a
 * Madness of 90. Both are read on the 0-100 scale §22 writes everything on,
 * and `attr(p, 'mind')` is not on it. Measured over 1,216 sampled expressers
 * across eight thousand-year runs:
 *
 *   every expresser        p50 19.4   p90 44.3   p99 62.7   max ever 81.0
 *   men holding Adept      p50 34.0   p90 55.0   p99 67.2   max ever 81.0
 *
 * So the Vessel's 70 sat above the 99th percentile of the entire population,
 * and rungs four, five and six had never been held by anybody in any measured
 * run. Same bug as `ASCENT_REACH` and `BOOK_REACH`, third instance, and it
 * typechecked for the same reason all three did: a number in prose, against a
 * scale the simulation was never asked to produce.
 *
 * ── WHY THE ANCHOR IS THE CENTRE AND NOT THE MAXIMUM ──────────────────────
 *
 * `ASCENT_REACH` takes a fraction of the arithmetic maximum. That cannot work
 * here: the table's ceiling for mind is 194.8 while `attributes.yaml` clamps
 * the range at 100, so the arithmetic maximum describes a person the clamp
 * forbids — `maxExpressiblePower` all over again, which is the mistake this
 * file already records making once.
 *
 * Invariant 10 gives the right anchor: anything mapping an attribute onto a
 * real quantity centres on `ctx.genetics.expected`, which is computed against
 * the range and therefore describes the population the CLAMP produces. A
 * thousand years puts 2.06x the expected mind in its 99th percentile and
 * 2.66x in the best man ever measured, so the scale tops out a little over
 * two — which puts §22's numbers where §22 wants them:
 *
 *   the Vessel's 70   ->  raw 47   about the top quarter of men holding Adept
 *   God's 90          ->  raw 60   near the 99th percentile of that same group
 *
 * Derived from the table, so an author who adds a mind locus moves the ladder
 * with it rather than silently breaking it.
 */
const MIND_REACH = 2.2;

/**
 * §22's MIND AND MADNESS FLOORS, on the 0-100 scale above — as data, so the
 * gate that asserts they are clearable reads the same numbers `gateFor` does
 * (issue #61).
 *
 * They were literals inside the switch, which is fine until something has to
 * check them: a gate carrying its own copy of "the Vessel wants 70" is a
 * second place that agrees until somebody tunes one of them, and this file has
 * three normalisations in it precisely because prose numbers drifted from the
 * scales underneath.
 */
/**
 * §22's POWER GATES, and the one number in this file that was still above the
 * population it is asked of (issue #61).
 *
 * Three normalisations already live here — `ASCENT_REACH`, `BOOK_REACH`,
 * `MIND_REACH` — each one fixing a §22 prose number that had been taken raw
 * against content of a different size. Every one of them was a LINEAR rescale
 * of the whole ladder, and that is why each opened one rung and left the top
 * shut: **§22's ladder does not fit the population by scaling.**
 *
 * Measured. §22 spans 3.9x from Adept to God (25 to 98). The population spans
 * 2.25x, from an ordinary expresser at raw 11 to the best man in sixteen
 * played runs at raw 24.7. No anchor makes Adept ordinary AND God reachable at
 * once: pulling the scale down until 98 is clearable puts an ordinary
 * expresser at 45, a whisker under Hierophant, which is not the game §22
 * describes. So the fix belongs on the top gate rather than on the shared
 * scale, and the gates become data here so gate 9 reads the same numbers
 * `gateFor` does.
 *
 * ── WHAT THE POPULATION ACTUALLY REACHES ──────────────────────────────────
 *
 * Two policies, because the answer differs and the weaker one is the wrong
 * calibration target — a house that never marries for blood is not the house
 * chasing Apotheosis:
 *
 *   climbing only          16 runs   best power ever 83   run-peak mean 70.8
 *   climbing + marrying in 12 runs   best power ever 90   run-peak mean 73.2
 *
 * Concentrating the blood is worth SEVEN POINTS at the ceiling, and that is
 * the measurement that decides this table. Against it:
 *
 *   hierophant 50   under both run-peak means — most runs get a man here
 *   vessel     70   at the run-peak mean — about half of them
 *   demigod    85   under the concentrating ceiling of 90. A tail, and a
 *                   REACHABLE one, so it is left exactly where §22 put it
 *   god        98   above everything ever measured under any policy
 *
 * So one number moves, and only one: God's. 88 is the top of the measured
 * tail — cleared by the best man of the best concentrating run and by nobody
 * else — which is what §22 means by the terminal outcome a family has to be
 * built for. Lowering it further would make God a rung rather than an ending.
 *
 * The other gates are NOT relaxed and must not be. Power is one of nine
 * things God asks for, and the conjunction is the difficulty; a ladder whose
 * every gate was individually easy would be a ladder with no top.
 */
export const POWER_FLOOR: Record<Rung, number> = {
  none: 0,
  touched: 10,
  adept: 25,
  hierophant: 50,
  vessel: 70,
  demigod: 85,
  god: 88,
};

export const MIND_FLOOR: Partial<Record<Rung, number>> = { vessel: 70 };
export const MADNESS_FLOOR: Partial<Record<Rung, number>> = {
  hierophant: 20, demigod: 60, god: 90,
};

function mindReference(ctx: SimCtx): number {
  return (ctx.genetics.expected.get('mind') ?? 0) * MIND_REACH;
}

/**
 * NOT CLAMPED AT 100, unlike `eldritchPower`, and the difference is the point.
 *
 * Power clamps because the raw quantity is itself ceiling-bounded — a man
 * cannot express more than his channel passes. Mind and Madness are not: mind
 * runs to the attribute's own range and Madness accrues without a bound at
 * all. Clamping them flattens everybody above the reference onto exactly 100,
 * and §22's `mind < madness` — the line that decides whether the ladder
 * destroys the man climbing it — then compares 100 against 100 and never
 * fires. A test built a man charged far past his own mind and watched him stay
 * a candidate.
 *
 * So 100 is where §22's numbers live, not where the scale stops.
 */
export function mindOf(ctx: SimCtx, p: Person): number {
  const raw = attr(p, 'mind', ctx.genetics, ctx.world.year);
  const reference = mindReference(ctx);
  return reference > 0 ? (raw / reference) * 100 : 0;
}

/**
 * §22's MADNESS, on the same scale — and read against the SAME reference as
 * mind, which is not a shortcut but the design saying so (issue #61).
 *
 * `attributes.yaml` defines mind as *"Capacity for Madness, and the ceiling on
 * it."* So the quantity madness is measured against is the quantity that holds
 * it, and normalising the two apart would be inventing a second opinion about
 * a relationship the content already states.
 *
 * It also makes §22's own comparison mean something. `madness > mind` was a
 * raw 0-35 quantity against a raw 0-81 one — a gate almost nobody could fail,
 * on a line §22 writes as the whole tragedy of the upper ladder. On one scale
 * it is the sentence it was written as.
 *
 * Madness is not genetic and has no table maximum to read: §10 is explicit
 * that above Hierophant it is PURCHASED, through forced Awakenings, the Vessel
 * rite and ascension itself. Which means its ceiling is a function of how far
 * up the ladder anybody can get — so measuring it before mind was fixed would
 * have measured the blockage rather than the quantity, and the numbers here
 * were taken after.
 */
export function madnessOf(ctx: SimCtx, p: Person): number {
  const reference = mindReference(ctx);
  return reference > 0 ? (p.madness / reference) * 100 : 0;
}

export type AscensionBlockerKind =
  | 'expression'
  | 'awakening'
  | 'power'
  | 'books'
  | 'affinities'
  | 'respect'
  | 'mind'
  | 'madness'
  | 'rites'
  | 'regalia'
  | 'clauses'
  | 'final_circle';

/**
 * Coarse blocker vocabulary for campaign instruments.
 *
 * This belongs beside the ladder rather than in a tool: prose is presentation,
 * while these values are engine facts. `other` remains as an explicit
 * diagnostic escape hatch, but `standingOf` never emits it for a known gate.
 */
export const LADDER_BLOCKERS = [
  'no-expresser',
  'clear',
  'awakening',
  'power',
  'books',
  'affinities',
  'madness-floor',
  'madness-overflow',
  'mind',
  'respect',
  'rite',
  'regalia',
  'clauses',
  'other',
] as const;
export type LadderBlocker = typeof LADDER_BLOCKERS[number];

/**
 * A player-safe reading of one unmet ladder predicate.
 *
 * The precise threshold stays in `blocked` for tests, tooling and deep
 * inspection. This is the sentence the game can put in the family ledger
 * without turning §22 into a spreadsheet, plus one kind of action the player
 * can take. Neither field contains future RNG or hidden event weights.
 */
export interface AscensionBlocker {
  kind: AscensionBlockerKind;
  text: string;
  hint: string;
}

export interface AscensionDiagnosis {
  target: Rung;
  targetTitle: string;
  /** One dominant blocker today. The gate order decides which one. */
  blockers: AscensionBlocker[];
}

/** What one person has and what the rung above them still wants. */
export interface Standing {
  rung: Rung;
  /** Stable blocker category for tooling; never derived from `blocked` prose. */
  blocker: LadderBlocker;
  /** The precise first failed predicate, retained for tests and deep inspection. */
  blocked?: string;
  /** The same failed predicate translated for a player, without its threshold. */
  diagnosis?: AscensionDiagnosis;
  power: number;
  spells: number;
  affinities: number;
  madness: number;
  mind: number;
}

/**
 * §22's gates, in order, each returning the reason it is NOT met.
 *
 * Written as "why not" rather than "yes" on purpose: the player needs to be
 * told what is in the way, and a boolean cannot say. `blocked` on the house's
 * standing is what a client puts under the rung.
 */
function powerShortfall(power: number, need: number): string {
  return `the blood comes through him at ${Math.round(power)}; the next step asks ${need}`;
}

function bookShortfall(read: number, need: number, household = false): string {
  const have = `${read} ${read === 1 ? 'book' : 'books'}`;
  const asks = `${need} ${need === 1 ? 'book' : 'books'}`;
  return `${household ? 'living family readers know' : 'he has read'} ${have}; the next step asks ${asks}`;
}

function affinityShortfall(have: number, need: number, household = false): string {
  const word = have === 1 ? 'affinity' : 'affinities';
  return `${household ? 'living family readers cover' : 'his books reach'} ${have} ${word}; the next step asks ${need}`;
}

interface GateBlocker extends AscensionBlocker {
  /** Stable coarse category for campaign instruments. */
  blocker: LadderBlocker;
  /** Existing exact reason; changing this is a gate/test contract, not UI copy. */
  precise: string;
}

function gateBlocker(
  kind: AscensionBlockerKind,
  blocker: LadderBlocker,
  precise: string,
  text: string,
  hint: string,
): GateBlocker {
  return { kind, blocker, precise, text, hint };
}

function powerBlocker(power: number, need: number, target: string): GateBlocker {
  return gateBlocker(
    'power',
    'power',
    powerShortfall(power, need),
    `The blood comes through him, but not strongly enough for ${target}.`,
    'Seek Matches that strengthen the font; what a child inherits is not promised.',
  );
}

function booksBlocker(read: number, need: number, household: boolean, target: string): GateBlocker {
  return gateBlocker(
    'books',
    'books',
    bookShortfall(read, need, household),
    household
      ? `The living family has not read widely enough for ${target}.`
      : `He has not read widely enough for ${target}.`,
    household
      ? 'Put more useful books in the hands of living family readers.'
      : 'Have him study another spellbook.',
  );
}

function affinitiesBlocker(have: number, need: number, household: boolean, target: string): GateBlocker {
  return gateBlocker(
    'affinities',
    'affinities',
    affinityShortfall(have, need, household),
    household
      ? `The living family does not yet carry enough different arts for ${target}.`
      : `His reading does not yet reach enough different arts for ${target}.`,
    household
      ? 'Spread the missing arts among living family readers.'
      : 'Choose a spellbook from an affinity he has not learned.',
  );
}

function respectBlocker(precise: string, target: string): GateBlocker {
  return gateBlocker(
    'respect',
    'respect',
    precise,
    `The house is not yet held in enough regard for ${target}.`,
    'Raise the house\'s Respect before asking the world to tolerate this step.',
  );
}

function costBlocker(precise: string, target: string): GateBlocker {
  return gateBlocker(
    'madness',
    'madness-floor',
    precise,
    `The blood has not marked him deeply enough for ${target}.`,
    'The upper ladder opens through costly Awakenings and rites, not study alone.',
  );
}

function overborneBlocker(precise: string): GateBlocker {
  return gateBlocker(
    'madness',
    'madness-overflow',
    precise,
    'His mind cannot safely bear what the blood has already done to him.',
    'Do not press him higher until the line can carry more Mind.',
  );
}

function diagnosisFor(target: Rung, blocker: GateBlocker): AscensionDiagnosis {
  return {
    target,
    targetTitle: rungTitle(target),
    blockers: [{ kind: blocker.kind, text: blocker.text, hint: blocker.hint }],
  };
}

/**
 * §22's gates, in order, each returning the first predicate that is NOT met.
 *
 * The order is also the diagnosis priority. Inventing a separate severity
 * score would create a second opinion about the ladder. One failed predicate
 * is enough to answer "what next?" without exposing later thresholds as a
 * checklist.
 */
function gateFor(ctx: SimCtx, p: Person, rung: Rung): GateBlocker | undefined {
  const w = ctx.world;
  const inherited = p.rites.includes('unmaking');
  const power = eldritchPower(ctx, p);
  const spells = p.spellsKnown.length;
  const reading = inherited ? householdBooks(ctx) : spells;
  const books = booksFor(ctx, rung);
  const affinityNeed = affinitiesFor(rung);
  const affinities = affinityCount(ctx, p);
  const arts = inherited ? householdAffinities(ctx) : affinities;
  // On §22's 0-100 scale, like `power`, and for the same reason (issue #61).
  // `madness > mind` compared a 0-35 quantity against a 0-81 one and was a
  // gate almost nobody could fail; both are on one scale now, so the
  // comparison says what §22 means by it.
  const mind = mindOf(ctx, p);
  const madness = madnessOf(ctx, p);
  const respect = RESPECT_ORDER.indexOf(w.respect);
  const regalia = heldHeirlooms(ctx)
    .filter((h) => heirloomDef(ctx, h.id)?.kind === 'regalia').length;
  const target = rungTitle(rung);

  switch (rung) {
    case 'none':
      return undefined;

    case 'touched':
      if (!p.awakening.awakened) {
        return gateBlocker(
          'awakening',
          'awakening',
          'he has not awakened',
          'The blood is in him, but it has not awakened.',
          'Keep him in view for an Awakening; study cannot supply this step.',
        );
      }
      if (power < POWER_FLOOR.touched) return powerBlocker(power, POWER_FLOOR.touched, target);
      return undefined;

    case 'adept':
      if (power < POWER_FLOOR.adept) return powerBlocker(power, POWER_FLOOR.adept, target);
      if (reading < books) return booksBlocker(reading, books, inherited, target);
      if (madness > mind) {
        return overborneBlocker('what the blood has done to him is already more than his mind can bear');
      }
      return undefined;

    case 'hierophant':
      if (power < POWER_FLOOR.hierophant) return powerBlocker(power, POWER_FLOOR.hierophant, target);
      if (reading < books) return booksBlocker(reading, books, inherited, target);
      if (arts < affinityNeed) return affinitiesBlocker(arts, affinityNeed, inherited, target);
      // The Madness FLOOR. From here up a placid mind cannot ascend, which is
      // the whole shape of the design: the ladder runs through the thing that
      // destroys the family.
      if (madness < MADNESS_FLOOR.hierophant!) return costBlocker('the blood has not cost him enough yet', target);
      if (madness > mind) {
        return overborneBlocker('what the blood has done to him is already more than his mind can bear');
      }
      if (respect < RESPECT_ORDER.indexOf('regarded')) {
        return respectBlocker('the house is not yet regarded', target);
      }
      return undefined;

    case 'vessel':
      if (power < POWER_FLOOR.vessel) return powerBlocker(power, POWER_FLOOR.vessel, target);
      if (reading < books) return booksBlocker(reading, books, inherited, target);
      if (mind < MIND_FLOOR.vessel!) {
        return gateBlocker(
          'mind',
          'mind',
          'his mind is not yet wide enough for what the Vessel would put into it',
          'His mind is not yet wide enough for what the Vessel would put into it.',
          'Strengthen Mind in the bloodline before committing him to this step.',
        );
      }
      if (respect < RESPECT_ORDER.indexOf('eminent')) {
        return respectBlocker('the house is not yet eminent', target);
      }
      // THE RITE, and it is a thing that happened rather than a quantity that
      // accumulated (issue #43). This line used to return unconditionally,
      // which made rung four unreachable in principle and said so honestly —
      // `events/rites.ts` is what finally lets it be answered.
      if (!p.rites.includes('vessel') && !p.rites.includes('unmaking')) {
        return gateBlocker(
          'rites',
          'rite',
          'the Vessel is unpaid: a living member of the blood, willingly given',
          'The Vessel\'s price has not been paid.',
          'Call the Vessel rite when the house is ready to give a willing member of the blood.',
        );
      }
      return undefined;

    case 'demigod':
      if (power < POWER_FLOOR.demigod) return powerBlocker(power, POWER_FLOOR.demigod, target);
      if (reading < books) return booksBlocker(reading, books, inherited, target);
      if (arts < affinityNeed) return affinitiesBlocker(arts, affinityNeed, inherited, target);
      if (respect < RESPECT_ORDER.indexOf('eminent')) {
        return respectBlocker('the house is not yet eminent', target);
      }
      if (madness < MADNESS_FLOOR.demigod!) {
        return costBlocker('the blood has not hurt him deeply enough yet', target);
      }
      if (madness > mind) {
        return overborneBlocker('what the blood has done to him is already more than his mind can bear');
      }
      // Most runs have lost at least one of the three, which §22 says is
      // often the real gate. `regalia.slow.test.ts` exists because of it.
      if (regalia < REGALIA_COMPLETE) {
        return gateBlocker(
          'regalia',
          'regalia',
          `the Regalia are still divided — ${regalia} of ${REGALIA_COMPLETE} held`,
          'The Regalia are still divided.',
          'Recover the missing Regalia before attempting the next rite.',
        );
      }
      // Rung five's rite IS built, and is taken: measured over eight played
      // runs, `the_great_rite` was offered three times and taken in three
      // (issue #61).
      if (!p.rites.includes('great_rite') && !p.rites.includes('unmaking')) {
        return gateBlocker(
          'rites',
          'rite',
          'the Great Rite remains undone — sanctioned or defied',
          `The Great Rite still stands between him and ${target}.`,
          'Call the Great Rite, sanctioned or defied, when its other costs are ready.',
        );
      }
      return undefined;

    case 'god': {
      if (power < POWER_FLOOR.god) return powerBlocker(power, POWER_FLOOR.god, target);
      if (reading < books) {
        return gateBlocker(
          'final_circle',
          'books',
          `living family readers know ${reading} books; the last working asks ${books}`,
          'The living family has not read enough of the library for the final circle.',
          'Put more books into the hands of living family readers.',
        );
      }
      const circlePairs = householdOpposedPairs(ctx);
      if (circlePairs < affinityNeed) {
        return gateBlocker(
          'final_circle',
          'affinities',
          `living family readers cover ${circlePairs} of the ${affinityNeed} opposed pairs; the last working asks one affinity from each`,
          'The living family cannot yet carry every opposed pair into the final circle.',
          'Spread the missing affinities across living family readers.',
        );
      }
      if (respect < RESPECT_ORDER.indexOf('exalted')) {
        return respectBlocker('the house is not yet exalted', target);
      }
      if (madness < MADNESS_FLOOR.god!) {
        return gateBlocker(
          'madness',
          'madness-floor',
          'the blood has not brought him close enough to ruin',
          `The blood has not brought him close enough to ruin for ${target}.`,
          'The upper ladder opens through costly Awakenings and rites, not study alone.',
        );
      }
      if (mind < madness) {
        return gateBlocker(
          'mind',
          'madness-overflow',
          'what the blood has done to him is more than his mind can bear',
          'His mind cannot safely bear what the final working would ask of him.',
          'Do not attempt the final step until Mind can bear what the blood has done.',
        );
      }
      if (w.clausesRecovered.size < GOD_CLAUSES) {
        return gateBlocker(
          'clauses',
          'clauses',
          `the book holds ${w.clausesRecovered.size} of the ${GOD_CLAUSES} clauses the last step requires`,
          'The Ledger is not complete enough for the last working.',
          'Recover more Ledger clauses before attempting the final step.',
        );
      }
      // THE TERMINAL IRONY (§22). A dynasty that concentrates everything into
      // one perfect patriarch cannot ascend: raising him past the top rung
      // costs a SEPARATE two-rite Hierophant, spent to raise a blood
      // descendant. Living readers across the family supply every opposed pair.
      //
      // The unmaking event checks both men while the elder is alive; this gate
      // checks only that the completed act has happened, never that the
      // sacrificed man somehow remains alive afterwards (issue #61).
      if (!p.rites.includes('unmaking')) {
        return gateBlocker(
          'final_circle',
          'rite',
          'no two-rite elder has yet been unmade for him',
          'The final circle still lacks the elder it must spend.',
          'Prepare a separate two-rite elder, then call the Unmaking for this ascendant.',
        );
      }
      return undefined;
    }

    default:
      return assertNever(rung);
  }
}

/** All three founding heirlooms, held at once. */
const REGALIA_COMPLETE = 3;
/** Seven of the nine, per §22's God gate. */
export const GOD_CLAUSES = 7;

/**
 * How far up one person is, and what is stopping them going further.
 *
 * A rung is held only if every rung below it is: the ladder is a ladder.
 */
export function standingOf(ctx: SimCtx, p: Person): Standing {
  const ph = phenotypeOf(p, ctx.genetics, ctx.world.year);
  const base: Omit<Standing, 'rung' | 'blocked' | 'blocker'> = {
    power: Math.round(eldritchPower(ctx, p) * 10) / 10,
    spells: p.spellsKnown.length,
    affinities: affinityCount(ctx, p),
    // On §22's scale, like `power` beside them, because the gates now read
    // them that way and a report that answered in raw units would have the
    // client printing "mind 30" against a gate of 70 the man had cleared.
    madness: Math.round(madnessOf(ctx, p)),
    mind: Math.round(mindOf(ctx, p)),
  };

  // INVARIANT 1: no rung above `none` without the capability gate, and the
  // capability gate is `canExpress` and nothing else.
  if (!ph.eldritch.canExpress) {
    const blocker: AscensionBlocker = {
      kind: 'expression',
      text: 'The blood does not answer through him.',
      hint: 'The house must look to another living man of the blood.',
    };
    return {
      rung: 'none',
      blocker: 'no-expresser',
      blocked: 'he cannot express it',
      diagnosis: { target: 'touched', targetTitle: rungTitle('touched'), blockers: [blocker] },
      ...base,
    };
  }

  let held: Rung = 'none';
  for (const rung of RUNG_ORDER.slice(1)) {
    const why = gateFor(ctx, p, rung);
    if (why) {
      return {
        rung: held,
        blocker: why.blocker,
        blocked: why.precise,
        diagnosis: diagnosisFor(rung, why),
        ...base,
      };
    }
    held = rung;
  }
  return { rung: held, blocker: 'clear', ...base };
}

/**
 * Standing against standing: higher rung first, then more power.
 *
 * The rung is a step and the power is where on the step he is, so two Adepts
 * are not the same man to a ladder that is about to ask one of them for
 * something. Ties past both fall to household order, which is stable per
 * world — this reading may not draw dice.
 */
function outranks(a: Standing, b: Standing): boolean {
  const step = rungIndex(a.rung) - rungIndex(b.rung);
  return step !== 0 ? step > 0 : a.power > b.power;
}

/**
 * THE MAN WHO IS CLIMBING (issue #41).
 *
 * The house's foremost EXPRESSER — not its foremost person, which is a
 * different and emptier question. Everyone who cannot express stands at rung
 * `none` forever (invariant 1), so ranking the whole household ranked seventy
 * people who were all tied at the bottom and handed back whichever of them the
 * store listed first. That man was then printed on the cast panel as *stands
 * highest of anyone*, with `he cannot express it` after it.
 *
 * Restricting the pool to `canExpress` is also what makes the `foremost` slot
 * role structurally safe to deal Madness to: invariant 1 says Madness follows
 * capability and nothing else, and here the capability is the pool rather
 * than a filter an author has to remember to write.
 *
 * Derived, recomputed, stored nowhere (invariant 6).
 */
export function foremostOf(ctx: SimCtx): { person: Person; standing: Standing } | undefined {
  return rankedExpressers(ctx)[0];
}

/**
 * THE SECOND MAN ON THE LADDER (§22's terminal irony, issue #61, Stage E5).
 *
 * `foremostOf` one place down, and `undefined` whenever the house has fewer
 * than two living expressers — which is most years of most runs.
 *
 * **Why this is a reading and not a stored name.** God asks for a living
 * two-rite Hierophant standing beside the man who ascends. The only writes to a living
 * man's power anywhere in the engine are the three rite functions in
 * `events/rites.ts`, and every rite template cast its ascendant `foremost`,
 * whose pool is exactly one person. So the second man was unreachable by
 * construction rather than by rationing: no table order, no bias and no
 * policy could hand him a rite, because no slot role could name him. Stage
 * E4 proved that the hard way — it built the Heir and moved `secondPower`
 * by 0.5 of a point in the wrong direction, because books, tutors and
 * marriages do not touch power.
 *
 * Reading it off the same ranking `foremostOf` uses is what keeps the pair
 * honest: the two can never disagree about who is first, and a man who
 * overtakes the foremost stops being castable here the same year he starts
 * being castable there. Derived, recomputed, stored nowhere (invariant 6).
 */
export function secondForemostOf(ctx: SimCtx): { person: Person; standing: Standing } | undefined {
  return rankedExpressers(ctx)[1];
}

/**
 * The house's expressers, best first. ONE ranking, so `foremostOf` and
 * `secondForemostOf` cannot drift into disagreeing about which man is which
 * — two sorts with the same comment above them is how the cast panel and
 * `world.ascension` would end up naming different people.
 *
 * The seat first, then the branches: a Hierophant in a cadet hall is still
 * the family's Hierophant (§16 — a hall is not a house). Restricting the
 * pool to `canExpress` is what makes both roles structurally safe to deal
 * Madness to (invariant 1) — the capability is the pool rather than a filter
 * an author has to remember to write.
 *
 * Draws no dice: the ladder is a measurement, and `outranks` falls to
 * household order past rung and power, which is stable per world.
 */
function rankedExpressers(ctx: SimCtx): { person: Person; standing: Standing }[] {
  const w = ctx.world;
  const ranked: { person: Person; standing: Standing }[] = [];
  for (const p of w.people.household(w.playerHouse, w.year)) {
    if (!phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress) continue;
    ranked.push({ person: p, standing: standingOf(ctx, p) });
  }
  // `outranks` is a strict better-than, so a stable sort leaves ties in
  // household order — the same tie-break `foremostOf`'s scan produced when
  // it kept the first man it met and only replaced him on a strict win.
  ranked.sort((a, b) => (outranks(a.standing, b.standing) ? -1 : outranks(b.standing, a.standing) ? 1 : 0));
  return ranked;
}

export interface HouseAscension {
  /** The highest rung anybody of the house stands on this year. */
  rung: Rung;
  /** The highest ever reached. Falls to nobody when the man dies; this does not. */
  best: Rung;
  /** Who is highest, and what is in their way. */
  foremost?: { person: string; name: string; standing: Standing };
}

/**
 * Where the house stands. Measured every year by the `ascension` phase, which
 * writes `world.ascension` — so a client, an authored condition and the year
 * that acted all read one number rather than three recomputations of it.
 */
export function measureAscension(ctx: SimCtx): HouseAscension {
  const w = ctx.world;
  const top = foremostOf(ctx);
  const foremost: HouseAscension['foremost'] = top
    ? { person: top.person.id, name: top.person.name, standing: top.standing }
    : undefined;
  const best: Rung = foremost ? foremost.standing.rung : 'none';

  const highWater = rungIndex(best) >= rungIndex(w.ascension.best) ? best : w.ascension.best;
  return { rung: best, best: highWater, ...(foremost ? { foremost } : {}) };
}

export interface HouseAscensionDiagnosis extends AscensionDiagnosis {
  /** Absent only when the house has no living expresser to diagnose. */
  person?: string;
  name?: string;
}

/**
 * The next useful ladder reading for a player.
 *
 * A house with no living expresser still gets an answer: the problem is the
 * bloodline, not an empty widget. A God gets no diagnosis because there is no
 * next rung. This is derived and deterministic; it neither rolls nor stores.
 */
export function diagnoseHouseAscension(
  measured: HouseAscension,
): HouseAscensionDiagnosis | undefined {
  const top = measured.foremost;
  if (!top) {
    return {
      target: 'touched',
      targetTitle: rungTitle('touched'),
      blockers: [{
        kind: 'expression',
        text: 'No living man of the house can express the blood.',
        hint: 'Seek a Match that could carry the font back into the line; no child is promised.',
      }],
    };
  }

  const diagnosis = top.standing.diagnosis;
  if (!diagnosis) return undefined;
  return {
    person: top.person,
    name: top.name,
    target: diagnosis.target,
    targetTitle: diagnosis.targetTitle,
    blockers: diagnosis.blockers.map((blocker) => ({ ...blocker })),
  };
}

/** Convenience for callers that have not already measured the house. */
export function diagnoseAscension(ctx: SimCtx): HouseAscensionDiagnosis | undefined {
  return diagnoseHouseAscension(measureAscension(ctx));
}

/**
 * One reading, written to the world. Draws no dice — the ladder is a
 * measurement, and a measurement that moved the RNG would make every phase
 * after it depend on how many spells somebody happened to know.
 */
export function tickAscension(ctx: SimCtx): HouseAscension {
  const now = measureAscension(ctx);
  const w = ctx.world;
  const climbed = rungIndex(now.best) > rungIndex(w.ascension.best);

  w.ascension.rung = now.rung;
  w.ascension.best = now.best;

  // A rung is a current reading; stopped ageing is an attainment. Latch it in
  // the same phase that observes the rung, before a later year can lose a
  // supporting reader or public standing and make the current reading fall.
  // Rite entry points also call the same helper because those table actions
  // can resolve after this phase has already run.
  for (const p of w.people.living()) {
    if (!p.rites.includes('great_rite') && !p.rites.includes('unmaking')) continue;
    noteDemigodAttainment(ctx, p);
  }

  if (climbed) {
    w.ascension.reachedAt[now.best] = w.year;
    w.chronicle.push({
      year: w.year,
      weight: 'paragraph',
      title: now.best === 'vessel' ? 'The Vessel' : rungTitle(now.best),
      text: msg(ctx, 'ascension.rung_reached',
        '{PERSON} went farther into the blood than anyone of the line before him. The book called him {RUNG}.',
        { PERSON: now.foremost?.name ?? 'Somebody of the house', RUNG: rungTitle(now.best) }),
      named: false,
      // What the BOOK will be able to show in 2042. The ending reads the
      // chronicle rather than `world.ascension` (§6), and this is the page it
      // reads: a house that climbed and a house that can prove it climbed are
      // two different houses on the last night.
      rung: now.best,
    });
  }
  chargeForStagnation(ctx, now);
  return now;
}

/**
 * STAGNATION (§22, issue #43).
 *
 * > Demigod Stagnation: a Discontent counter rising while he stays Head,
 * > seeding Insurrection events inside the family.
 *
 * A man near the top of the ladder does not die on schedule and does not let
 * go, and the house below him fills up with people whose turn was supposed to
 * have come. `headSince` has measured tenure rather than age since it shipped,
 * *for exactly this*, and nothing read it for this until now.
 *
 * ─── Why it is not gated on `demigod`, which is what §22 names ──────────────
 *
 * Because rung five is not reached in forty played runs, and content gated on
 * a rung nothing reaches is content that is not in the game — the mistake this
 * issue's own Depends-on warned about, and the one the Great Rite made once
 * already by gating itself behind the Vessel.
 *
 * So it is gated on the ladder's TOP HALF and the pressure SCALES with the
 * rung: a man at the Vessel who will not get out of the chair is already the
 * thing §22 is describing, and a Demigod who does it is worse by exactly the
 * factor the rungs differ by. The day rung five is reachable this bites harder
 * with no line rewritten, which is the property `booksFor` has and the raw
 * numbers did not.
 *
 * ─── What it is NOT ────────────────────────────────────────────────────────
 *
 * Not a rubber band. Invariant 13 reserves that for `assize.ts`, which is
 * explicit, announces itself, and reacts to how the house is doing. This is
 * the opposite: a fixed consequence of one fact about one man, and it does not
 * care whether the house is winning. It draws no dice, like everything else in
 * this file, and it writes one quantity that content can already read.
 */
function chargeForStagnation(ctx: SimCtx, now: HouseAscension): void {
  const w = ctx.world;
  const rung = rungIndex(now.rung);
  if (rung < rungIndex('vessel')) return;

  // The man the ladder is about has to be the man in the chair. A Vessel in a
  // cadet hall is not stagnation — he is just somebody the family avoids.
  const him = now.foremost ? w.people.get(now.foremost.person) : undefined;
  if (!him || !him.castSlots.includes('head')) return;

  // And he has to have been there long enough for it to be his fault. A
  // generation, measured the way `branches.ts` measures a long reign.
  const held = w.headSince === undefined ? 0 : w.year - w.headSince;
  if (held < STAGNATION_TENURE) return;

  const steps = rung - rungIndex('vessel') + 1;
  w.discontent = Math.min(100, w.discontent + STAGNATION_PER_YEAR * steps);
}

/** How long a man must have held the seal before staying is a grievance. */
const STAGNATION_TENURE = 30;

/**
 * Discontent a year, per rung above the Vessel.
 *
 * Swept against what the counter already carries: `economy.ts` adds 1 a year
 * when the house is short and the Assize moves it 5 to 9 at a stroke, so a
 * quarter-point a year is a pressure that takes a decade to be worth noticing
 * and cannot be mistaken for a bad harvest. A Demigod pays double it.
 */
const STAGNATION_PER_YEAR = 0.25;

/** How many distinct affinities this person's books cover. */
function affinityCount(ctx: SimCtx, p: Person): number {
  const seen = new Set<string>();
  for (const id of p.spellsKnown) {
    const def = ctx.content.spellbook(id);
    if (def) seen.add(String(def.affinity));
  }
  return seen.size;
}

function householdAffinitySet(ctx: SimCtx): Set<string> {
  const seen = new Set<string>();
  for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
    if (p.status !== 'alive') continue;
    for (const id of p.spellsKnown) {
      const def = ctx.content.spellbook(id);
      if (def) seen.add(String(def.affinity));
    }
  }
  return seen;
}

/** The distinct affinities living members of every family hall can bring. */
export function householdAffinities(ctx: SimCtx): number {
  return householdAffinitySet(ctx).size;
}

/**
 * How many of the four opposed pairs have at least one living family reader.
 * The God circle asks for one representative from EACH pair, not any four arts.
 */
export function householdOpposedPairs(ctx: SimCtx): number {
  const seen = householdAffinitySet(ctx);
  return GOD_AFFINITY_PAIRS.filter((pair) => pair.some((affinity) => seen.has(affinity))).length;
}

/** Distinct books living family members have learned, across every hall. */
export function householdBooks(ctx: SimCtx): number {
  const seen = new Set<string>();
  for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
    if (p.status !== 'alive') continue;
    for (const id of p.spellsKnown) if (ctx.content.spellbook(id)) seen.add(String(id));
  }
  return seen.size;
}

/**
 * Whether the seat has anybody Touched. §22: "No Touched male = Regency" — the
 * one place the ladder was always load-bearing, and the one place the rest of
 * the code already agreed with it.
 */
export function seatHasTouched(ctx: SimCtx): boolean {
  const w = ctx.world;
  return hall(w, MAIN_BRANCH, w.year)
    .some((p) => rungIndex(standingOf(ctx, p).rung) >= rungIndex('touched'));
}
