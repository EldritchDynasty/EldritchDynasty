/**
 * IS BEARING A MORAL OR A TAX? (concept §29, issue #45's acceptance)
 *
 *   npm run gate:bearing -- [runs] [years]
 *   npm run gate:bearing -- 24 500
 *
 * §29's whole design rests on one asymmetry, and the issue states it as the
 * test rather than as a hope:
 *
 *   > Across runs binned by bearing: high-bearing runs reach HIGHER rungs on
 *   > average AND show materially higher variance in outcome. If they are
 *   > simply worse, this is a difficulty setting and players will play around
 *   > it rather than feel it.
 *
 * A tax is a number that goes down. A moral is a bargain that usually pays and
 * occasionally ruins you, and the difference between those two is visible only
 * in a distribution — which is why this is a batch tool and not an assertion
 * about a seed.
 *
 * ─── The three columns ──────────────────────────────────────────────────────
 *
 * Like `gate:blood` and `gate:ladder`, this PLAYS: the docket is parked and one
 * policy answers the two decisions §29 is about — the Match and the Record —
 * while the chronicler answers everything else, so the columns differ by how
 * the house CARRIES itself and by nothing else.
 *
 *   proud       takes the cousin where there is one and refuses the hand where
 *               there is not, holds every carrying daughter off the market, and
 *               writes the family larger at every Record block. All four of
 *               `BearingAct`'s acts, played deliberately.
 *   modest      takes a card every time and takes the outsider, releases
 *               everybody, and records honestly. The house that does the
 *               correct, dilute, well-liked thing for a thousand years.
 *   unattended  the chronicler decides. The control, and the shape of a run
 *               nobody is playing.
 *
 * ─── What it asserts, and what it only prints ───────────────────────────────
 *
 * Asserted: the top bearing bin reaches a higher mean RUNG than the bottom
 * one. That is §29 rule 2 — *pride must usually be CORRECT* — and the shape is
 * a GRADIENT from the bottom bin to the top rather than a strict monotone. Top
 * minus bottom is +0.05 and +0.25 across two seed sets at sixty runs a column,
 * against a standard error near 0.05. Pride climbs.
 *
 * ─── THE COLUMN THIS IS READ OFF, WHICH WAS THE WRONG ONE ───────────────────
 *
 * The acceptance asks for higher variance IN OUTCOME. For three rounds of
 * measurement this gate read that spread off `bestRungIndex` — the ladder, out
 * of `world.ascension`, which is what the house ACHIEVED and which the last
 * night never consults. It reported the spread flat (−0.04, replicated) and
 * two conclusions were published off it: that stage 3's first bite had doubled
 * the gap, and later that warning lanes were not the lever.
 *
 * §29.3's third bite — the record read back — changes what a house can PROVE
 * and by construction leaves what it achieved alone. So that column could not
 * have moved however hard any of it bit. `substantiatedRungIndex` is where the
 * house ARRIVED, and it is what `selectEnding` actually reads.
 *
 * Measured on it, at sixty runs a column on two independent seed sets, with
 * all three bites built: **+0.11 and +0.15**. The top bin is wider in both,
 * where the ladder column was narrower in both. That is the first time the
 * second half of this acceptance has held.
 *
 * It is PRINTED rather than gated even so. Two samples agree on a sign, which
 * is not enough to fix a level, and a floor on a difference a batch can barely
 * see is how a gate stops meaning anything.
 *
 * AND DO NOT READ A RESULT OFF ONE BATCH OF IT. Measured on identical content,
 * a single bin's variance swings by up to 0.10 from nothing but the seeds (the
 * middle bin came out 0.26 and 0.16), which is larger than any movement a
 * content drop has ever produced in it. Quote the top-minus-bottom statistic,
 * across at least two seed sets — `npm run gate:bearing -- 60 1000 9001 17`
 * gives an independent one. This paragraph exists because the first
 * measurement here credited a content drop with doubling a gap whose noise
 * floor is three times the gap, and the mean-outcome column has already caught
 * one more: it read −0.20 on one set and +0.02 on the other, so *the proud
 * house arrives lower* is a sentence one batch supports and two do not.
 *
 * NOT IN `npm run gate`, for the same reason `gate:blood` and `gate:drag` are
 * not: the rung assertion is a two-standard-error effect at eighty-four runs a
 * bin and is meaningless at the dozen a CI budget allows. It is an instrument
 * you point at the question, not a tripwire.
 *
 * Printed and not asserted: standing, clauses and household size at 2042. They
 * are the texture of the distribution rather than its subject, and where any
 * one run lands on them is a seed.
 */
import { loadContent } from '@ed/content';
import { ALL_ENDINGS } from './ending-gate.js';
import {
  indexContent, RESPECT_ORDER,
  type CampaignId, type ContentBundle, type Content, type EndingId, type EventTemplate, type Outcome, type Rung,
} from '@ed/schema';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { makeRng, hashSeed } from '../rng.js';
import {
  autoResolveAll, declineMatch, resolveMatch, resolveRecord,
  type PendingMatch, type PendingRecord,
} from '../events/decisions.js';
import { REMEMBERED_AFTER, WARNING_TAG, bearingOf } from '../bearing.js';
import { order } from '../table.js';
import { rungIndex } from '../ascension.js';
import { phenotypeOf } from '../people/factory.js';
import { closeTheLedger, readTheChronicle } from '../ending.js';
import { CAMPAIGNS, CAMPAIGN_YEARS, campaignDef } from '../campaign.js';
import { inRegency, type SimCtx } from '../world.js';

export type Carriage = 'proud' | 'modest' | 'unattended';

/**
 * Select the shipped campaign when a caller names its exact duration. Other
 * diagnostic lengths preserve the historical Long-Line default. This matters
 * because 300 years is not merely a truncated Long Line: Short has its own
 * term, three-clause contract and ending set.
 */
export function campaignForYears(years: number): CampaignId {
  return Object.values(CAMPAIGNS).find((def) => def.years === years)?.id ?? 'long';
}

/**
 * ONE RUN, AND WHAT IT IS BEING ASKED.
 *
 * Every field says what it RETURNS rather than what it is about, and carries
 * its unit, because half of them are per-run totals and half are means over
 * something and the two do not read alike in a table. `warned` and `unheard`
 * were the pair that made this necessary: two bare past participles, one a
 * count of scenes and the other a count of entries in a ledger, sitting next
 * to each other in the same printed row.
 */
// #36 measurement: keep the evidence exposure beside the verdict it calibrates.
export interface BearingRun {
  seed: number;
  carriage: Carriage;

  // ── §29's own quantity, three readings of it ────────────────────────────
  /** The highest `bearingOf().carriage` reached in the run. */
  peakCarriage: number;
  /** Its mean over every year old enough to hold a remembered act. THE BINS USE THIS. */
  meanCarriage: number;
  /** What it read in 2042. */
  finalCarriage: number;

  // ── The Match, and how the policy answered it ───────────────────────────
  /** Hands the player was dealt in the run. */
  handsDealt: number;
  /** Available cards per hand, averaged over those hands. Stage 2's own number. */
  cardsPerHand: number;
  /** Hands answered by declining every card. */
  handsDeclined: number;
  /** Hands answered by taking a household card with an outsider on the table. */
  cousinsTaken: number;

  // ── The ladder, which is what the acceptance is actually about ──────────
  /** The highest rung anybody of the house ever stood on. */
  bestRung: Rung;
  /** The same, as an index, because a mean of six names is not a thing. */
  bestRungIndex: number;

  // ── Stage 3: what the house was and was not told (issue #45) ────────────
  /**
   * Scenes that had a warning on the table and gave it — counted across every
   * lane that carries one, not off a list of ids.
   */
  warningsHeard: number;
  /** Scenes that had one and did not. `world.bearing.unheard`, which is the trace. */
  warningsWithheld: number;

  // ── WHERE THE HOUSE ARRIVED, which is not where it got to ───────────────
  /**
   * The highest rung the BOOK claims, as an index.
   *
   * `bestRungIndex` above is what the house ACHIEVED, off `world.ascension`.
   * These two and `substantiatedRungIndex` below are three different numbers
   * and the whole of §6 lives in the gaps between them.
   */
  attestedRungIndex: number;
  /**
   * WHAT THE CREDITOR TOOK — the book's claim after the standing lies are
   * counted against it, and the number `selectEnding` actually reads.
   *
   * The acceptance (§29.7) asks for higher variance IN OUTCOME, and until this
   * field existed the verdict measured `bestRungIndex` — what the house
   * managed, off world state the last night never consults. §29.3's third bite
   * changes what a house can PROVE and by construction leaves what it achieved
   * alone, so an instrument reading `world.ascension` could not have seen it
   * however hard it bit. That is the third time on this issue a column has been
   * incapable of moving in the direction a conclusion was drawn about.
   */
  substantiatedRungIndex: number;
  /** Rungs the reading would not take. Zero for a house with an honest book. */
  rungsWithheld: number;
  /** Weighted standing lies at the term — what the book could not hold up. */
  unsupportable: number;
  /** Surviving written Chronicle pages at the term. */
  pages: number;
  /** Record decisions kept honest. */
  recorded: number;
  /** Record decisions written larger. */
  embellished: number;
  /** Which of §23's five the run landed on. */
  ending: EndingId;

  // ── The texture: where the house ended up ───────────────────────────────
  /** Standing at 2042 as an index into `RESPECT_ORDER`, for the same reason as the rung. */
  respectTierIndex: number;
  /** Ledger clauses recovered by 2042, of nine. */
  clausesRecovered: number;
  /** Living members of the household at 2042. */
  householdAtEnd: number;
  /** Years of the run spent in a Regency. */
  regencyYears: number;
}

/**
 * §7's `withhold` order, played as a rule rather than as a decision: a proud
 * house does not put its carrying daughters on anybody else's market. This is
 * `kept_her_back`, and it is the one act of the four that costs nothing at all
 * on the day it is taken.
 */
function holdTheCarriers(ctx: SimCtx, hold: boolean): void {
  const w = ctx.world;
  for (const p of w.people.household(w.playerHouse, w.year)) {
    if (p.sex !== 'female') continue;
    if (phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont <= 0) continue;
    if (p.marriages.some((m) => m.to === undefined)) continue;
    // THROUGH THE TABLE VERB, not by writing `world.withheld` directly. The
    // first cut of this file did the latter and the act was never written
    // down — `noteBearing('kept_her_back')` lives in `order`, so a batch that
    // reaches past it measures a proud house that the world has no memory of.
    order(ctx, { kind: 'withhold', person: p.name, hold });
  }
}

/**
 * One hand, answered by carriage.
 *
 * The proud house is not simply refusing. §29's causal story is that *the
 * pride that refuses to dilute the blood is what forces the marriage that
 * ruins it*, so a proud house takes the cousin when there is one on the table
 * — `took_the_cousin` — and refuses when there is not. Refusing everything
 * would exercise one of the four acts and would also be a strategy nobody
 * plays.
 */
function answerMatch(
  ctx: SimCtx,
  pending: PendingMatch,
  carriage: Carriage,
  tally: { hands: number; cards: number; declined: number; kin: number },
): void {
  const open = pending.cards.filter((c) => c.available);
  tally.hands += 1;
  tally.cards += open.length;

  if (!open.length) {
    declineMatch(ctx, pending.id);
    tally.declined += 1;
    return;
  }

  // `household` is the card drawn from the house's own people: the cousin. It
  // only counts as the act while an outsider card is also on the table, which
  // is the one moment anybody can tell the two apart.
  const kin = open.filter((c) => c.kind === 'household');
  if (carriage === 'proud') {
    const cousin = [...kin].sort((a, b) => b.kinship - a.kinship)[0];
    if (!cousin) {
      declineMatch(ctx, pending.id);
      tally.declined += 1;
      return;
    }
    if (resolveMatch(ctx, pending.id, cousin.id).ok) tally.kin += 1;
    else { declineMatch(ctx, pending.id); tally.declined += 1; }
    return;
  }

  // Modest: the outsider, and the one who shares the least blood.
  const outward = [...open].sort((a, b) => (a.kinship - b.kinship) || (a.id < b.id ? -1 : 1))[0]!;
  if (!resolveMatch(ctx, pending.id, outward.id).ok) {
    declineMatch(ctx, pending.id);
    tally.declined += 1;
  } else if (outward.person) tally.kin += 1;
}

export function playOnce(
  source: ContentBundle | Content,
  seed: number,
  years: number,
  carriage: Carriage,
  campaign: CampaignId = campaignForYears(years),
): BearingRun {
  const def = campaignDef(campaign);
  const ctx = bootstrap(source, seed, def.startYear, campaign);
  const w = ctx.world;
  // The standing order a house of this carriage gives once and never revisits.
  if (carriage === 'modest') w.marriagePolicy = 'out';
  if (carriage === 'proud') w.marriagePolicy = 'in';

  const tally = { hands: 0, cards: 0, declined: 0, kin: 0 };
  let peakCarriage = 0;
  let carriageSum = 0;
  let sampledYears = 0;
  let regencyYears = 0;

  for (let i = 0; i < years; i++) {
    // The term, or the line running out before it (issue #42).
    if (w.year >= def.endYear || w.ending) break;
    if (carriage !== 'unattended') holdTheCarriers(ctx, carriage === 'proud');
    stepYear(ctx, carriage === 'unattended');

    let guard = 0;
    while (w.pendingDecisions.length && guard++ < 200) {
      const rng = makeRng(hashSeed(seed, 'bearing-batch', w.year, guard));

      const match = w.pendingDecisions.find((d): d is PendingMatch => d.kind === 'match');
      if (match) { answerMatch(ctx, match, carriage, tally); continue; }

      // The Embellish is the loudest of the four acts and the only one the
      // player takes with a pen. A modest house never reaches for it.
      const record = w.pendingDecisions.find((d): d is PendingRecord => d.kind === 'record');
      if (record) { resolveRecord(ctx, record.id, carriage === 'proud' ? 'embellish' : 'record'); continue; }

      autoResolveAll(ctx, rng);
    }
    clearNamingQueue(ctx);

    const read = bearingOf(ctx).carriage;
    peakCarriage = Math.max(peakCarriage, read);
    // The MEAN reading, and it is what the bins are built on. `carriage` is
    // acts per century of the run so far, so its peak is dominated by the
    // first century — one act at year 1100 divides by a single century and
    // reads as a house that has been doing this for eight hundred years. The
    // mean is what the world actually lived with.
    if (w.year > w.assize.openedAt + REMEMBERED_AFTER) { carriageSum += read; sampledYears += 1; }
    if (inRegency(w)) regencyYears += 1;
  }

  // AND THE READING ITSELF, which `stepYear` runs on a year that has already
  // reached the term (or emptied the blood) — so a loop breaking the moment
  // either happens never calls it on its own. `gate:endings` records what
  // that cost it once: a hundred runs with no ending at all, defaulted to
  // `forgotten`, reported as a hundred confirmations of the very finding the
  // batch was measuring for.
  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  const reckoning = readTheChronicle(ctx);

  return {
    seed,
    carriage,
    peakCarriage,
    meanCarriage: sampledYears ? carriageSum / sampledYears : 0,
    finalCarriage: bearingOf(ctx).carriage,
    handsDealt: tally.hands,
    cardsPerHand: tally.hands ? tally.cards / tally.hands : 0,
    handsDeclined: tally.declined,
    cousinsTaken: tally.kin,
    bestRung: w.ascension.best,
    bestRungIndex: rungIndex(w.ascension.best),
    attestedRungIndex: rungIndex(reckoning.attested),
    substantiatedRungIndex: rungIndex(reckoning.substantiated),
    rungsWithheld: reckoning.rungsWithheld,
    unsupportable: reckoning.unsupportable,
    pages: reckoning.pages,
    recorded: reckoning.recorded,
    embellished: reckoning.embellished,
    // Never defaulted: a run that reaches the term without an ending is a
    // broken measurement, not a `forgotten`.
    ending: w.ending?.id ?? ('none' as EndingId),
    // WARNINGS THE HOUSE ACTUALLY GOT, across every lane that carries one.
    //
    // This counted firings of ONE event — `the_letter_comes_and_is_expected`,
    // the successor of the first lane written — so the two lanes added later
    // were invisible to it by construction, and the column could not move
    // however many scenes the library gained. A conclusion was drawn off it
    // (*"more scenes are not the lever"*) that the instrument was incapable of
    // supporting either way.
    //
    // Counted exactly instead: every firing of a scene that HAD a warning on
    // the table either took it or wrote `noteUnheard`, so the two sum to the
    // number of such firings and the difference is what was heard.
    warningsHeard: warningScenesFired(ctx) - w.bearing.unheard.length,
    warningsWithheld: w.bearing.unheard.length,
    respectTierIndex: RESPECT_ORDER.indexOf(w.respect),
    clausesRecovered: w.clausesRecovered.size,
    householdAtEnd: w.people.household(w.playerHouse, w.year).length,
    regencyYears,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Population variance. A distribution's width is the whole subject here. */
const variance = (xs: number[]) => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};

/**
 * THE FLOOR UNDER §29.7'S SECOND CLAUSE (issue #76), AND WHY IT IS ZERO.
 *
 * The clause asks high-bearing runs to reach higher rungs on average AND to
 * arrive more VARIOUSLY. The first half has been judged since this gate was
 * written. The second was printed for three rounds because two seed sets agree
 * on a sign and do not fix a level, and this repo carries five tests that broke
 * on thresholds set just under a measurement.
 *
 * Four independent seed sets, 60 runs a column, 720 played thousand-year runs,
 * measured on the game as it stands:
 *
 *     4000+13i   +0.06
 *     9001+17i   +0.13
 *    20011+29i   +0.12
 *    31013+37i   +0.03
 *
 *    mean +0.085 · sd of one batch 0.048 · se of the four-batch mean 0.024
 *
 * Positive in four of four, and the mean stands 3.5 standard errors above
 * zero. The effect is real.
 *
 * THE FLOOR IS STILL ZERO, AND THE ARITHMETIC IS THE POINT. Two standard
 * errors below the mean is +0.037 if you use the se of the MEAN — and that is
 * the wrong dispersion, because this gate judges ONE batch and not the average
 * of four. What a single 60-a-column batch scatters by is 0.048, and two of
 * those below +0.085 is NEGATIVE. No positive floor is carryable at that size,
 * and +0.037 would have failed the 31013 set on the very measurement that
 * justified it.
 *
 * So the floor is the failure §29.7 actually names — the top bin no wider than
 * the bottom — tested STRICTLY, since equal width is no wider. And the batch is
 * required to be large enough to say it: 0.085 over 0.048 is 1.8 sd at 60 a
 * column, and 76 a column brings that past two. Rounded to 80, which is
 * `SPREAD_MIN_RUNS / 3`.
 *
 * WHAT WOULD RAISE IT. Not a bigger batch — that buys margin, not level. The
 * level moves when the third bite bites harder, and the number to watch is the
 * BOTTOM bin's `withheld`: it ran 0.02-0.08 across these four sets, and a
 * mechanism that starts discounting the quiet house too narrows this gap
 * without the proud house changing at all.
 *
 * Re-measuring costs four commands and about 45 minutes at four in parallel on
 * a four-core container:
 *
 *   npm run gate:bearing -- 60 1000 4000 13
 *   npm run gate:bearing -- 60 1000 9001 17
 *   npm run gate:bearing -- 60 1000 20011 29
 *   npm run gate:bearing -- 60 1000 31013 37
 */
export const SPREAD_FLOOR = 0;

/**
 * Below this the spread is printed and NOT judged, which is #76's own argument
 * turned into a guard: a distribution statistic is meaningless at the dozen
 * runs a CI budget allows. It also keeps `bearing-gate.test.ts`'s rule-2
 * fixtures honest — nine synthetic runs whose bins have no internal variance
 * at all report +0.00 and are not making a claim about width.
 */
export const SPREAD_MIN_RUNS = 240;

export interface BearingVerdict { ok: boolean; lines: string[] }

/**
 * The acceptance asks for runs BINNED BY BEARING rather than for a policy
 * comparison, and the difference is not pedantic. A column is a strategy and
 * carries everything else that strategy does — a proud column that also
 * withholds is carrying `BALANCE-LOG`'s own measured trap, and a verdict read
 * off it is a verdict about withholding.
 *
 * So the columns exist to SPREAD the reading, and the verdict is read off the
 * pooled runs, sorted by how the world came to read the house and cut in
 * three. Which policy produced a given run is not part of the question.
 */
function bins(runs: BearingRun[]): { label: string; runs: BearingRun[] }[] {
  const sorted = [...runs].sort((a, b) => a.meanCarriage - b.meanCarriage);
  const third = Math.max(1, Math.floor(sorted.length / 3));
  return [
    { label: 'kept its head down', runs: sorted.slice(0, third) },
    { label: 'the middle', runs: sorted.slice(third, sorted.length - third) },
    { label: 'carried itself', runs: sorted.slice(sorted.length - third) },
  ];
}

/**
 * THE JUDGMENT, over runs somebody else played.
 *
 * Split out from the playing for the reason every gate in this repo is a
 * function rather than a script: a gate nobody has watched fail is
 * indistinguishable from a gate that cannot fail. The ladder gate can be
 * handed a declawed BUNDLE because what it measures is authored; bearing's
 * consequence is in `marketAppetite`, in the engine, so there is no content to
 * take away. What can be handed to a test is the distribution itself — one
 * where the house that carried itself climbed higher, and one where it did
 * not — and that is exactly the reading this function makes.
 */
/**
 * How many times a scene with a `warning` outcome on the table fired at all.
 *
 * Read off the CONTENT rather than a list of ids, so it still means what it
 * says after the next warning lane is authored — which is the same reason
 * `gate:ladder` recognises a ladder bargain by its effects rather than by name.
 */
function warningScenesFired(ctx: SimCtx): number {
  const carriers = new Set(
    ctx.content.events
      .filter((e) => allOutcomesOf(e).some((o) => o.tags.includes(WARNING_TAG)))
      .map((e) => e.id),
  );
  return ctx.world.chronicle.filter((c) => c.eventId !== undefined && carriers.has(c.eventId)).length;
}

/** Every outcome of a template, whichever interaction shape it uses. */
function allOutcomesOf(e: { interaction: EventTemplate['interaction'] }): Outcome[] {
  return e.interaction.kind === 'narration'
    ? e.interaction.outcomes
    : e.interaction.choices.flatMap((c) => c.outcomes);
}

export function verdictOver(runs: BearingRun[]): BearingVerdict {
  const lines: string[] = [];
  const byCarriage = new Map<Carriage, BearingRun[]>();
  for (const r of runs) byCarriage.set(r.carriage, [...(byCarriage.get(r.carriage) ?? []), r]);
  for (const [carriage, rs] of byCarriage) {
    lines.push(
      `  ${carriage.padEnd(10)} carriage ${mean(rs.map((r) => r.meanCarriage)).toFixed(2)}`
      + ` (peak ${mean(rs.map((r) => r.peakCarriage)).toFixed(2)})`
      + `  cards/hand ${mean(rs.map((r) => r.cardsPerHand)).toFixed(2)}`
      + `  hands ${mean(rs.map((r) => r.handsDealt)).toFixed(0)}`
      + `  declined ${mean(rs.map((r) => r.handsDeclined)).toFixed(0)}`
      + `  cousins ${mean(rs.map((r) => r.cousinsTaken)).toFixed(0)}`
      + `  warnings heard ${mean(rs.map((r) => r.warningsHeard)).toFixed(1)}`
      + `  withheld ${mean(rs.map((r) => r.warningsWithheld)).toFixed(1)}`,
    );
  }

  lines.push(`  --- ${runs.length} runs, pooled and cut in three by how the world reads the house ---`);
  const cut = bins(runs);
  for (const b of cut) {
    const rungs = b.runs.map((r) => r.bestRungIndex);
    const got = b.runs.map((r) => r.substantiatedRungIndex);
    lines.push(
      `  ${b.label.padEnd(18)} n ${String(b.runs.length).padStart(2)}`
      + `  carriage ${mean(b.runs.map((r) => r.meanCarriage)).toFixed(2)}`
      + `  reached ${mean(rungs).toFixed(2)} (var ${variance(rungs).toFixed(2)})`
      + `  PROVED ${mean(got).toFixed(2)} (var ${variance(got).toFixed(2)})`
      + `  withheld ${mean(b.runs.map((r) => r.rungsWithheld)).toFixed(2)}`
      + `  unsupportable ${mean(b.runs.map((r) => r.unsupportable)).toFixed(1)}`
      + `  book ${mean(b.runs.map((r) => r.pages)).toFixed(0)}p/`
      + `${mean(b.runs.map((r) => r.recorded + r.embellished)).toFixed(1)} records`
      + `  debt/record ${mean(b.runs.map((r) => r.unsupportable / Math.max(1, r.recorded + r.embellished))).toFixed(2)}`
      + `  warnings heard ${mean(b.runs.map((r) => r.warningsHeard)).toFixed(1)}`
      + `  standing ${mean(b.runs.map((r) => r.respectTierIndex)).toFixed(2)}`
      + `  clauses ${mean(b.runs.map((r) => r.clausesRecovered)).toFixed(1)}`
      + `  household ${mean(b.runs.map((r) => r.householdAtEnd)).toFixed(1)}`
      + `  rungs ${[...new Set(b.runs.map((r) => r.bestRung))].join('/')}`,
    );
  }
  const share = (rs: BearingRun[], id: EndingId) =>
    (100 * rs.filter((r) => r.ending === id).length) / (rs.length || 1);
  for (const b of cut) {
    lines.push(`  ${b.label.padEnd(18)} endings  `
      + ALL_ENDINGS.map((e) => `${e} ${share(b.runs, e).toFixed(0)}%`).join('  '));
  }

  const low = cut[0]!.runs.map((r) => r.bestRungIndex);
  const high = cut[2]!.runs.map((r) => r.bestRungIndex);
  const higher = mean(high) > mean(low);

  if (!higher) {
    lines.push('  FAIL: the house that carried itself does not reach higher rungs than the one that'
      + ' kept its head down — §29 rule 2 says pride must usually be CORRECT, and a carriage that'
      + ' only costs is a tax players optimise away inside an hour');
  }

  // THE SECOND HALF OF THE ACCEPTANCE, AND WHAT IT IS NOW MEASURED ON.
  //
  // §29.7 asks for higher variance IN OUTCOME. This read `bestRungIndex` —
  // what the house achieved, off `world.ascension` — and reported the spread
  // flat through three warning lanes and two rounds of conclusions drawn from
  // it. §29.3's third bite changes what a house can PROVE and by construction
  // never touches what it achieved, so that column could not have moved
  // however hard the mechanism bit.
  //
  // Both are printed. `reached` is the ladder and is what rule 2 is judged on;
  // `PROVED` is where the house arrived and is what the spread clause is
  // about. Never quote a per-bin variance from one batch — a single bin's
  // variance swings by up to 0.10 from nothing but the seed set, which is
  // three times the gap the first measurement here credited to a content drop.
  const lowGot = cut[0]!.runs.map((r) => r.substantiatedRungIndex);
  const highGot = cut[2]!.runs.map((r) => r.substantiatedRungIndex);
  const spread = variance(highGot) - variance(lowGot);
  const judged = runs.length >= SPREAD_MIN_RUNS;
  // STRICTLY above. "No wider than the bottom" is the failure §29.7 names, so
  // equal width is a failure and not a pass on a technicality.
  const spreadOk = !judged || spread > SPREAD_FLOOR;

  lines.push(`  spread IN OUTCOME: the top bin carries ${spread >= 0 ? '+' : ''}${spread.toFixed(2)}`
    + ` of variance over the bottom, against a floor of ${SPREAD_FLOOR.toFixed(2)}`
    + (judged ? ' — JUDGED' : ` — printed, NOT judged: ${runs.length} runs is under the `
      + `${SPREAD_MIN_RUNS} this claim needs. Run \`gate:bearing -- 80 1000\``));

  if (!spreadOk) {
    lines.push('  FAIL: the house the world reads as carrying itself arrives no more VARIOUSLY than'
      + ' the house that kept its head down — §29.7 asks for materially higher variance in outcome,'
      + ' and a bearing that only shifts the average is a modifier rather than a moral');
  }

  return { ok: higher && spreadOk, lines };
}

export function gateBearing(
  source: ContentBundle | Content = loadContent(),
  opts: { seeds?: number[]; years?: number; campaign?: CampaignId } = {},
): BearingVerdict {
  const bundle = indexContent(source);
  const seeds = opts.seeds ?? Array.from({ length: 12 }, (_, i) => 4000 + i * 13);
  const years = opts.years ?? CAMPAIGN_YEARS;
  const campaign = opts.campaign ?? campaignForYears(years);

  const runs = (['proud', 'modest', 'unattended'] as const)
    .flatMap((carriage) => seeds.map((s) => playOnce(bundle, s, years, carriage, campaign)));

  const verdict = verdictOver(runs);
  return {
    ok: verdict.ok,
    lines: [`gate (bearing): ${seeds.length} played runs x ${years} years, per carriage (${campaign})`, ...verdict.lines],
  };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('bearing-gate.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? 12);
  const years = Number(process.argv[3] ?? CAMPAIGN_YEARS);
  // THE SEED SET, because this gate's own header now requires two of them.
  //
  //   npm run gate:bearing -- 60 500             # 4000 + 13i
  //   npm run gate:bearing -- 60 500 9001 17     # an independent set
  //
  // A per-bin variance swings by up to 0.10 from nothing but the seeds, which
  // is three times the gap the first measurement on this issue credited to a
  // content drop. Telling somebody to run two sets and then hard-coding one
  // formula is an instruction nobody can follow without editing the gate.
  const base = Number(process.argv[4] ?? 4000);
  const step = Number(process.argv[5] ?? 13);
  const seeds = Array.from({ length: runs }, (_, i) => base + i * step);
  const { ok, lines } = gateBearing(loadContent(), { seeds, years });
  console.log(`  seeds: ${base} + ${step}i`);
  for (const l of lines) console.log(l);
  process.exit(ok ? 0 : 1);
}
