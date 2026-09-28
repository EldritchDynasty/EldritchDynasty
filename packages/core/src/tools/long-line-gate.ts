/**
 * #133 Stage 5 — the 500-year Long Line as a complete game.
 *
 * This is a MEASUREMENT, not a CI threshold. It keeps the five pre-#61
 * questions in one played batch so they are read from the same worlds:
 * 5A Ledger, 5B decisions, 5C frame, 5D land/Muster, 5E system reach,
 * 5F ladder/endings, and 5G the consolidated term state. #61 has landed, so
 * this instrument now reads the upper ladder and every ending too.
 *
 * npm run gate:long -- [runs] [years] [chronicler|commit|climb|ascendant|compare]
 * npm run gate:long -- 40 500 chronicler
 * npm run gate:long -- 80 500 commit
 * npm run gate:long -- 64 500 climb
 * npm run gate:long -- 64 500 ascendant
 * npm run gate:long -- 80 500 compare
 */
import { loadContent } from '@ed/content';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { autoResolveDecision, type PendingChoice } from '../events/decisions.js';
import { hashSeed, makeRng } from '../rng.js';
import { CAMPAIGN_YEARS, START_YEAR } from '../campaign.js';
import { END_YEAR } from '../ending.js';
import { heldAcres } from '../land.js';
import { chapterOf } from '../chapter.js';
import { bearingOf, marketAppetite } from '../bearing.js';
import { closeTheLedger, livingBlood, readTheChronicle } from '../ending.js';
import {
  ALL_ENDINGS, configureAscendant, prepareAscendantYear, resolveAscendantYear,
} from './ending-gate.js';
import { answerWarChoice, type WarPolicy } from './war-gate.js';
import { costsTheClimber, resolveYear as resolveLadderYear, type LadderPolicy } from './ladder-policy.js';
import { foremostOf, rungIndex, RUNGS, LADDER_BLOCKERS, type LadderBlocker } from '../ascension.js';
export { LADDER_BLOCKERS, type LadderBlocker } from '../ascension.js';
import { RESPECT_ORDER, type Content, type EndingId, type RespectTier, type Rung } from '@ed/schema';
import { expectMean } from '../testing.js';
import type { SimCtx } from '../world.js';

export type LongSnapshotPoint = 'early' | 'middle' | 'late';
export type LongLinePolicy =
  | Extract<WarPolicy, 'chronicler' | 'commit'>
  | Extract<LadderPolicy, 'climb' | 'ascendant'>;

/**
 * Compatibility name for the long-line diagnostics. The classifier used to
 * parse English from `Standing.blocked`; #270 moved the fact into ascension
 * itself, so prose can now change without silently changing measurements.
 */
export function ladderBlockerKind(
  blocker: LadderBlocker | undefined,
  hasExpresser = true,
): LadderBlocker {
  if (!hasExpresser) return 'no-expresser';
  return blocker ?? 'clear';
}

interface LadderDiagnostics {
  offers: number;
  accepted: number;
  rises: number;
  drops: number;
  mortalityDrops: number;
  blockerYears: Record<LadderBlocker, number>;
}

function emptyLadderDiagnostics(): LadderDiagnostics {
  return {
    offers: 0,
    accepted: 0,
    rises: 0,
    drops: 0,
    mortalityDrops: 0,
    blockerYears: Object.fromEntries(LADDER_BLOCKERS.map((key) => [key, 0])) as Record<LadderBlocker, number>,
  };
}

export interface LongSnapshot {
  year: number;
  progress: number;
  heldAcres: number;
  parcels: number;
  musterSettled: number;
  musterTide: number;
  bearing: number;
  marketAppetite: number;
  careerHolders: number;
  distinctCareers: number;
  longestCareerTenure: number;
  treasury: number;
  respect: RespectTier;
  discontent: number;
  livingBlood: number;
  rung: Rung;
  best: Rung;
  attested: Rung;
  substantiated: Rung;
  vesselRites: number;
  greatRites: number;
  unmakings: number;
  ladderOffers: number;
  ladderAccepted: number;
  ladderRises: number;
  ladderDrops: number;
  ladderMortalityDrops: number;
  ladderBlockers: Record<LadderBlocker, number>;
  tales: number;
  clauses: number;
}

export interface LongRun {
  seed: number;
  policy: LongLinePolicy;
  finalYear: number;
  reachedTerm: boolean;
  generations: number;
  livingBloodEnd: number;
  livingBloodLow: number;
  livingBloodHigh: number;
  clauses: number;
  clauseYears: number[];
  agesEnded: number;
  agesNamed: number;
  namedClauseBearingAges: number;
  missedClauseAges: number;
  archivistYears: number;
  recordKeeperYears: number;
  choices: number;
  matches: number;
  records: number;
  namings: number;
  prompts: number;
  frames: number;
  frameFirst?: number;
  frameLast?: number;
  frameMaxSilence: number;
  chapters: number;
  chaptersNoFrame: number;
  chaptersMultiFrame: number;
  acreageStart: number;
  acreageEnd: number;
  acreageLow: number;
  acreageHigh: number;
  acquisitions: number;
  losses: number;
  improvements: number;
  illuminated: boolean;
  treasuryEnd: number;
  treasuryLow: number;
  respectEnd: RespectTier;
  discontentEnd: number;
  discontentLow: number;
  discontentHigh: number;
  musters: number;
  musterSettled: number;
  musterWithdrawn: number;
  musterPositioned: number;
  musterTideLow: number;
  musterTideHigh: number;
  careerPlacements: number;
  taught: number;
  booksOpened: number;
  spellsKnown: number;
  maxBooksOnePerson: number;
  vesselRites: number;
  greatRites: number;
  unmakings: number;
  arcsStarted: number;
  arcsEnded: number;
  arcsExpired: number;
  arcsCancelled: number;
  arcsActive: number;
  assizeSittings: number;
  rungEnd: Rung;
  rungBest: Rung;
  attested: Rung;
  substantiated: Rung;
  snapshots: Partial<Record<LongSnapshotPoint, LongSnapshot>>;
  peakRungYear?: number;
  peakRungProgress?: number;
  ending?: EndingId;
  templatesSeen: Set<string>;
  repeatedTemplates: number;
  templateFires: Record<string, number>;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function quantile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[at]!;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/**
 * #85's longitudinal claims are PAIRED within one run: late minus early.
 *
 * Forty here means forty usable PAIRS, not forty requested seeds. A bloodline
 * that ends before the early-third snapshot contributes no paired difference
 * and must not silently make the confidence claim thinner. expectMean owns
 * the repository's two-standard-error rule; this wrapper only makes it
 * report-shaped instead of throwing out of a measurement tool.
 */
export const LONGITUDINAL_JUDGEABLE_PAIRS = 40;
export type LongitudinalDirection = 'increase' | 'decrease';

export function judgeLongitudinalDelta(
  label: string,
  values: number[],
  direction: LongitudinalDirection,
): string {
  if (values.length < LONGITUDINAL_JUDGEABLE_PAIRS) {
    return `UNJUDGED ${label}: ${values.length} paired runs; need at least ${LONGITUDINAL_JUDGEABLE_PAIRS}`;
  }

  const what = direction === 'increase'
    ? `${label} rises from early to late`
    : `${label} falls from early to late`;
  try {
    const margin = expectMean(direction === 'increase'
      ? { values, floor: 0, what }
      : { values, ceiling: 0, what });
    return `PASS ${label}: mean late-early ${fmt(mean(values), 2)} across ${values.length} paired runs (${margin.toFixed(1)} SE)`;
  } catch (error) {
    return `FAIL ${error instanceof Error ? error.message : String(error)}`;
  }
}

function summary(xs: number[]): string {
  return 'mean ' + fmt(mean(xs))
    + ' · p25 ' + fmt(quantile(xs, 0.25))
    + ' · median ' + fmt(quantile(xs, 0.5))
    + ' · p75 ' + fmt(quantile(xs, 0.75));
}

/**
 * #201 compares two policies on the SAME seeds. Forty complete paired worlds
 * is the same confidence floor #85 uses for early→late claims: fewer pairs are
 * still printed, but are evidence to gather more rather than a finding.
 */
export const POLICY_JUDGEABLE_PAIRS = 40;

export function judgePolicyDelta(label: string, values: number[]): string {
  if (values.length < POLICY_JUDGEABLE_PAIRS) {
    return `UNJUDGED ${label}: ${values.length} paired runs; need at least ${POLICY_JUDGEABLE_PAIRS}`;
  }
  try {
    const margin = expectMean({ values, floor: 0, what: `${label} is higher under ascendant` });
    return `PASS ${label}: mean ascendant-chronicler ${fmt(mean(values), 2)} across ${values.length} paired runs (${margin.toFixed(1)} SE)`;
  } catch (error) {
    return `FAIL ${error instanceof Error ? error.message : String(error)}`;
  }
}

const SNAPSHOT_POINTS: readonly LongSnapshotPoint[] = ['early', 'middle', 'late'];

function takeSnapshot(ctx: SimCtx, campaignSpan: number, ladder: LadderDiagnostics): LongSnapshot {
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);
  const careerHolders = household.filter((p) => p.career !== undefined);
  const distinctCareers = new Set(careerHolders.map((p) => String(p.career!.career))).size;
  const longestCareerTenure = careerHolders.reduce(
    (longest, p) => Math.max(longest, w.year - p.career!.from),
    0,
  );
  const bearing = bearingOf(ctx);
  const reckoning = readTheChronicle(ctx);
  const allPeople = w.people.all();
  const riteCount = (rite: 'vessel' | 'great_rite' | 'unmaking') =>
    allPeople.filter((p) => p.rites.includes(rite)).length;

  return {
    year: w.year,
    progress: Math.max(0, Math.min(1, (w.year - START_YEAR) / campaignSpan)),
    heldAcres: heldAcres(ctx),
    parcels: w.parcels.size,
    musterSettled: w.muster.commitments.filter((c) => c.status === 'settled').length,
    musterTide: w.muster.tide,
    bearing: bearing.score,
    marketAppetite: marketAppetite(ctx),
    careerHolders: careerHolders.length,
    distinctCareers,
    longestCareerTenure,
    treasury: w.treasury,
    respect: w.respect,
    discontent: w.discontent,
    livingBlood: livingBlood(w),
    rung: w.ascension.rung,
    best: w.ascension.best,
    attested: reckoning.attested,
    substantiated: reckoning.substantiated,
    vesselRites: riteCount('vessel'),
    greatRites: riteCount('great_rite'),
    unmakings: riteCount('unmaking'),
    ladderOffers: ladder.offers,
    ladderAccepted: ladder.accepted,
    ladderRises: ladder.rises,
    ladderDrops: ladder.drops,
    ladderMortalityDrops: ladder.mortalityDrops,
    ladderBlockers: { ...ladder.blockerYears },
    tales: w.tales.size,
    clauses: w.clausesRecovered.size,
  };
}

function runOne(bundle: Content, seed: number, years: number, policy: LongLinePolicy): LongRun {
  const ctx = bootstrap(bundle, seed, START_YEAR);
  const w = ctx.world;
  if (policy === 'ascendant') configureAscendant(ctx);
  const ladder = emptyLadderDiagnostics();
  const initialForemost = foremostOf(ctx);
  let previousForemost = initialForemost
    ? { person: initialForemost.person.id, rung: initialForemost.standing.rung }
    : undefined;

  const foundingParcels = w.parcels.size;
  const acreageStart = heldAcres(ctx);
  let acreageLow = acreageStart;
  let acreageHigh = acreageStart;
  let treasuryLow = w.treasury;
  let discontentLow = w.discontent;
  let discontentHigh = w.discontent;
  let livingBloodLow = livingBlood(w);
  let livingBloodHigh = livingBloodLow;
  let improvements = 0;
  const parcelBonus = new Map<string, number>(
    [...w.parcels].map(([id, p]) => [id, p.yieldBonus ?? 0]),
  );

  let namingPrompts = 0;
  let archivistYears = 0;
  let recordKeeperYears = 0;
  let taught = 0;
  let booksOpened = 0;
  let assizeSittings = 0;
  let lastAssize = w.assize.lastSitting;
  let musterTideLow = w.muster.tide;
  let musterTideHigh = w.muster.tide;
  const campaignSpan = Math.max(1, Math.min(years, END_YEAR - START_YEAR));
  const snapshots: Partial<Record<LongSnapshotPoint, LongSnapshot>> = {};
  const snapshotTargets: Record<Exclude<LongSnapshotPoint, 'late'>, number> = {
    early: START_YEAR + campaignSpan / 3,
    middle: START_YEAR + (campaignSpan * 2) / 3,
  };
  const captureDueSnapshots = () => {
    for (const point of ['early', 'middle'] as const) {
      if (snapshots[point] === undefined && w.year >= snapshotTargets[point]) {
        snapshots[point] = takeSnapshot(ctx, campaignSpan, ladder);
      }
    }
  };

  for (let i = 0; i < years; i++) {
    if (w.year >= END_YEAR || w.ending) break;

    if (policy === 'ascendant') prepareAscendantYear(ctx);
    stepYear(ctx, false);

    namingPrompts += w.pendingNames.length;
    if (w.people.living().some((p) => p.contract?.role === 'archivist')) archivistYears += 1;
    if (w.people.living().some((p) =>
      p.contract?.role === 'archivist' || p.contract?.role === 'chronicler')) recordKeeperYears += 1;
    taught += w.stewardYear.taught.length;
    booksOpened += w.stewardYear.opened.length;

    if (w.assize.lastSitting !== lastAssize) {
      assizeSittings += 1;
      lastAssize = w.assize.lastSitting;
    }

    const acres = heldAcres(ctx);
    acreageLow = Math.min(acreageLow, acres);
    acreageHigh = Math.max(acreageHigh, acres);
    treasuryLow = Math.min(treasuryLow, w.treasury);
    discontentLow = Math.min(discontentLow, w.discontent);
    discontentHigh = Math.max(discontentHigh, w.discontent);
    const blood = livingBlood(w);
    livingBloodLow = Math.min(livingBloodLow, blood);
    livingBloodHigh = Math.max(livingBloodHigh, blood);
    musterTideLow = Math.min(musterTideLow, w.muster.tide);
    musterTideHigh = Math.max(musterTideHigh, w.muster.tide);

    for (const [id, parcel] of w.parcels) {
      const before = parcelBonus.get(id) ?? 0;
      const now = parcel.yieldBonus ?? 0;
      if (now > before) improvements += Math.round((now - before) / 2);
      parcelBonus.set(id, now);
    }

    // Observe EVERY ladder bargain before the policy answers it, including
    // decisions queued by resolving an earlier docket item in the same year.
    // The chronicler path therefore uses the existing one-decision resolver in
    // the same loop/order as autoResolveAll, with the same RNG object; observing
    // draws no dice and does not alter the baseline.
    const offeredChoices = new Map<string, number>();
    const observedDecisionIds = new Set<string>();
    const observeChoice = (pending: PendingChoice) => {
      if (observedDecisionIds.has(pending.id)) return;
      observedDecisionIds.add(pending.id);
      if (!pending.choicesAreOpen) return;
      const costly = pending.choices.filter((choice) =>
        choice.available && costsTheClimber(pending, choice.id));
      if (!costly.length) return;
      ladder.offers += 1;
      for (const choice of costly) {
        const key = `${pending.event.id}\0${choice.id}`;
        offeredChoices.set(key, (offeredChoices.get(key) ?? 0) + 1);
      }
    };
    const autoResolveObserved = (rng: ReturnType<typeof makeRng>) => {
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        const pending = w.pendingDecisions[0]!;
        if (pending.kind === 'choice') observeChoice(pending);
        autoResolveDecision(ctx, pending, rng);
      }
    };
    const logStart = w.decisionLog.length;
    let climbTally: { asked: number; paid: number } | undefined;

    if (policy === 'chronicler') {
      autoResolveObserved(makeRng(hashSeed(seed, 'long-line-stage5', w.year)));
    } else if (policy === 'commit') {
      // Reuse gate:war's one-verb policy: commit to every Muster bargain,
      // buy the best affordable position, never withdraw; leave every other
      // decision to the chronicler. No second definition of "engaged".
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        const rng = makeRng(hashSeed(seed, 'long-line-stage5-commit', w.year, guard));
        const choice = w.pendingDecisions.find((d): d is PendingChoice => d.kind === 'choice');
        if (choice) observeChoice(choice);
        if (choice && answerWarChoice(ctx, choice, 'commit', rng)) continue;
        autoResolveObserved(rng);
      }
    } else {
      // #201 reuses the EXISTING ladder policies rather than inventing another.
      // `climb` is the one-verb ambient bargain policy. `ascendant` is the
      // composite #61/#185 policy factored from ending-gate: it also names the
      // Scion/Heir, funds the shelf and calls ready rites deliberately.
      climbTally = { asked: 0, paid: 0 };
      if (policy === 'ascendant') resolveAscendantYear(ctx, seed, climbTally);
      else resolveLadderYear(ctx, seed, 'climb', climbTally);
      ladder.offers += climbTally.asked;
      ladder.accepted += climbTally.paid;
    }

    if (policy !== 'climb' && policy !== 'ascendant') {
      // Which observed costly choices were actually taken? DecisionLog is the
      // common commit path for chronicler and Muster-commit play.
      for (const logged of w.decisionLog.slice(logStart)) {
        if (logged.kind !== 'outcome' || logged.choiceId === undefined) continue;
        const key = `${logged.event}\0${logged.choiceId}`;
        const remaining = offeredChoices.get(key) ?? 0;
        if (remaining <= 0) continue;
        ladder.accepted += 1;
        offeredChoices.set(key, remaining - 1);
      }
    }

    clearNamingQueue(ctx);

    // Read the live ladder AFTER the year's choices. A fall is attributed to
    // mortality only when the man who held the previous reading is now dead;
    // otherwise it is evidence that a supporting precondition moved.
    const top = foremostOf(ctx);
    const current = top?.standing.rung ?? 'none';
    const previous = previousForemost?.rung ?? 'none';
    if (rungIndex(current) > rungIndex(previous)) ladder.rises += 1;
    if (rungIndex(current) < rungIndex(previous)) {
      ladder.drops += 1;
      const previousPerson = previousForemost ? w.people.get(previousForemost.person) : undefined;
      if (!previousPerson || previousPerson.status !== 'alive') ladder.mortalityDrops += 1;
    }
    const blocker = ladderBlockerKind(top?.standing.blocker, top !== undefined);
    ladder.blockerYears[blocker] += 1;
    previousForemost = top ? { person: top.person.id, rung: top.standing.rung } : undefined;

    captureDueSnapshots();
  }

  snapshots.late = takeSnapshot(ctx, campaignSpan, ladder);
  const peakRungYear = w.ascension.best === 'none' ? undefined : w.ascension.reachedAt[w.ascension.best];
  const peakRungProgress = peakRungYear === undefined
    ? undefined
    : Math.max(0, Math.min(1, (peakRungYear - START_YEAR) / campaignSpan));

  // The decision log sees decisions created while the chronicler is resolving
  // an earlier docket item in the same year (especially Record blocks). A
  // one-shot sample of pendingDecisions does not. #88's session test remains
  // the canonical player-attention guard; these are the complete resolved
  // counts for the same 40 worlds.
  const choices = w.decisionLog.filter((d) => d.kind === 'outcome' && d.choiceId !== undefined).length;
  const matches = w.decisionLog.filter((d) => d.kind === 'match').length;
  const records = w.decisionLog.filter((d) => d.kind === 'record').length;

  const clauseEntries = w.chronicle.filter((entry) =>
    ctx.content.clauses.some((c) => c.name === entry.title && c.text === entry.text),
  );
  const clauseYears = clauseEntries.map((e) => e.year);
  const namedClauseBearingAges = w.age.ended.filter((age) =>
    age.named && ctx.content.age(age.age)?.clauseBearing === true
  ).length;
  const missedClauseAges = w.chronicle.filter((entry) =>
    entry.text === 'Whatever those years had to say about the debt, nobody in the house was writing it down.'
  ).length;

  const frameYears = w.frame.entries.map((e) => e.year).sort((a, b) => a - b);
  const frameEdges = [START_YEAR, ...frameYears, Math.min(END_YEAR, w.year)];
  let frameMaxSilence = 0;
  for (let i = 1; i < frameEdges.length; i++) {
    frameMaxSilence = Math.max(frameMaxSilence, frameEdges[i]! - frameEdges[i - 1]!);
  }

  const chapters = w.age.ended
    .map((ended) => chapterOf(ctx, ended))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  let chaptersNoFrame = 0;
  let chaptersMultiFrame = 0;
  for (const chapter of chapters) {
    const count = frameYears.filter((year) => year > chapter.from && year <= chapter.to).length;
    if (count === 0) chaptersNoFrame += 1;
    if (count > 1) chaptersMultiFrame += 1;
  }

  const arcs = [...w.arcs.values()];
  const fires = { ...w.frequency.templateFires };
  const templatesSeen = new Set(Object.entries(fires).filter(([, count]) => count > 0).map(([id]) => id));
  const repeatedTemplates = Object.values(fires).filter((count) => count > 1).length;

  const allPeople = w.people.all();
  const spellsKnown = allPeople.reduce((n, p) => n + p.spellsKnown.length, 0);
  const maxBooksOnePerson = allPeople.reduce((n, p) => Math.max(n, p.spellsKnown.length), 0);
  const riteCount = (rite: 'vessel' | 'great_rite' | 'unmaking') =>
    allPeople.filter((p) => p.rites.includes(rite)).length;

  const commitments = w.muster.commitments;
  if (w.year >= END_YEAR || w.ending) closeTheLedger(ctx);
  const reckoning = readTheChronicle(ctx);

  return {
    seed,
    policy,
    finalYear: w.year,
    reachedTerm: w.year >= END_YEAR,
    generations: w.generation,
    livingBloodEnd: livingBlood(w),
    livingBloodLow,
    livingBloodHigh,
    clauses: w.clausesRecovered.size,
    clauseYears,
    agesEnded: w.age.ended.length,
    agesNamed: w.age.ended.filter((a) => a.named).length,
    namedClauseBearingAges,
    missedClauseAges,
    archivistYears,
    recordKeeperYears,
    choices,
    matches,
    records,
    namings: namingPrompts,
    prompts: choices + matches + records + namingPrompts,
    frames: frameYears.length,
    ...(frameYears[0] !== undefined ? { frameFirst: frameYears[0] } : {}),
    ...(frameYears.at(-1) !== undefined ? { frameLast: frameYears.at(-1) } : {}),
    frameMaxSilence,
    chapters: chapters.length,
    chaptersNoFrame,
    chaptersMultiFrame,
    acreageStart,
    acreageEnd: heldAcres(ctx),
    acreageLow,
    acreageHigh,
    acquisitions: Math.max(0, w.counters.parcel - foundingParcels),
    losses: w.lostParcels.length,
    improvements,
    illuminated: w.platIlluminated,
    treasuryEnd: w.treasury,
    treasuryLow,
    respectEnd: w.respect,
    discontentEnd: w.discontent,
    discontentLow,
    discontentHigh,
    musters: commitments.length,
    musterSettled: commitments.filter((c) => c.status === 'settled').length,
    musterWithdrawn: commitments.filter((c) => c.status === 'withdrawn').length,
    musterPositioned: commitments.filter((c) => c.position !== undefined && c.position !== 'none').length,
    musterTideLow,
    musterTideHigh,
    careerPlacements: allPeople.filter((p) => p.career !== undefined).length,
    taught,
    booksOpened,
    spellsKnown,
    maxBooksOnePerson,
    vesselRites: riteCount('vessel'),
    greatRites: riteCount('great_rite'),
    unmakings: riteCount('unmaking'),
    arcsStarted: arcs.length,
    arcsEnded: arcs.filter((a) => a.status === 'ended').length,
    arcsExpired: arcs.filter((a) => a.status === 'expired').length,
    arcsCancelled: arcs.filter((a) => a.status === 'cancelled').length,
    arcsActive: arcs.filter((a) => a.status === 'active').length,
    assizeSittings,
    rungEnd: w.ascension.rung,
    rungBest: w.ascension.best,
    attested: reckoning.attested,
    substantiated: reckoning.substantiated,
    snapshots,
    ...(peakRungYear !== undefined ? { peakRungYear, peakRungProgress } : {}),
    ...(w.ending ? { ending: w.ending.id } : {}),
    templatesSeen,
    repeatedTemplates,
    templateFires: fires,
  };
}

export function measureLongLine(
  runs: number,
  years = CAMPAIGN_YEARS,
  policy: LongLinePolicy = 'chronicler',
): LongRun[] {
  const seeds = Array.from({ length: runs }, (_, i) => 20_000 + i * 37);
  const bundle = loadContent();
  return seeds.map((seed) => runOne(bundle, seed, years, policy));
}

export function reportLadderPolicyComparison(
  chronicler: LongRun[],
  ascendant: LongRun[],
): string {
  const engagedBySeed = new Map(ascendant.map((run) => [run.seed, run]));
  const allPairs = chronicler.flatMap((control) => {
    const engaged = engagedBySeed.get(control.seed);
    return engaged ? [[control, engaged] as const] : [];
  });
  const completePairs = allPairs.filter(([control, engaged]) =>
    control.snapshots.early !== undefined
    && control.snapshots.middle !== undefined
    && engaged.snapshots.early !== undefined
    && engaged.snapshots.middle !== undefined);
  const late = (
    pick: (snapshot: LongSnapshot) => number,
  ): number[] => completePairs.map(([control, engaged]) =>
    pick(engaged.snapshots.late!) - pick(control.snapshots.late!));
  const lateInterval = (
    pick: (snapshot: LongSnapshot) => number,
  ): number[] => completePairs.map(([control, engaged]) =>
    (pick(engaged.snapshots.late!) - pick(engaged.snapshots.middle!))
    - (pick(control.snapshots.late!) - pick(control.snapshots.middle!)));
  const peakTiming = allPairs.flatMap(([control, engaged]) =>
    control.peakRungProgress === undefined || engaged.peakRungProgress === undefined
      ? []
      : [engaged.peakRungProgress - control.peakRungProgress]);

  const lines = [
    `201 Paired policy comparison — chronicler → ascendant · same seeds ${allPairs.length} · complete normalized-third pairs ${completePairs.length}`,
    '  ' + judgePolicyDelta('late current rung', late((s) => rungIndex(s.rung))),
    '  ' + judgePolicyDelta('late best rung', late((s) => rungIndex(s.best))),
    '  ' + judgePolicyDelta('late attested rung', late((s) => rungIndex(s.attested))),
    '  ' + judgePolicyDelta('late substantiated rung', late((s) => rungIndex(s.substantiated))),
    '  ' + judgePolicyDelta('peak-rung campaign progress', peakTiming),
    '  ' + judgePolicyDelta('late-third ladder rises', lateInterval((s) => s.ladderRises)),
    '  ' + judgePolicyDelta('late-third costly choices taken', lateInterval((s) => s.ladderAccepted)),
    '  ' + judgePolicyDelta('late-third Vessel rites', lateInterval((s) => s.vesselRites)),
    '  ' + judgePolicyDelta('late-third Great Rites', lateInterval((s) => s.greatRites)),
  ];
  return lines.join('\n');
}

export function reportLongLine(runs: LongRun[], years: number): string {
  const bundle = loadContent();
  const lines: string[] = [];
  const countRuns = runs.length;
  const percent = (hits: number, den = countRuns) => den ? (100 * hits) / den : 0;
  const nums = (pick: (r: LongRun) => number) => runs.map(pick);
  const distribution = <T extends string>(order: readonly T[], pick: (run: LongRun) => T | undefined) =>
    order.map((value) => `${value} ${runs.filter((run) => pick(run) === value).length}`).join(' · ');
  const pointRuns = (point: LongSnapshotPoint): LongSnapshot[] =>
    runs.flatMap((run) => run.snapshots[point] === undefined ? [] : [run.snapshots[point]!]);
  const pointNums = (point: LongSnapshotPoint, pick: (snapshot: LongSnapshot) => number): number[] =>
    pointRuns(point).map(pick);
  const pairedDelta = (pick: (snapshot: LongSnapshot) => number): number[] => runs.flatMap((run) => {
    const early = run.snapshots.early;
    const late = run.snapshots.late;
    return early === undefined || late === undefined ? [] : [pick(late) - pick(early)];
  });
  const longitudinal = (pick: (snapshot: LongSnapshot) => number): string =>
    SNAPSHOT_POINTS.map((point) => `${point} ${summary(pointNums(point, pick))}`).join(' · ')
    + ' · late-early Δ ' + fmt(mean(pairedDelta(pick)));
  const snapshotDistribution = <T extends string>(
    point: LongSnapshotPoint,
    order: readonly T[],
    pick: (snapshot: LongSnapshot) => T,
  ): string => order.map((value) =>
    `${value} ${pointRuns(point).filter((snapshot) => pick(snapshot) === value).length}`
  ).join(' · ');
  const completeRuns = runs.filter((run) =>
    run.snapshots.early !== undefined && run.snapshots.middle !== undefined && run.snapshots.late !== undefined);
  const intervalValues = (
    point: LongSnapshotPoint,
    pick: (snapshot: LongSnapshot) => number,
  ): number[] => completeRuns.map((run) => {
    const now = run.snapshots[point]!;
    if (point === 'early') return pick(now);
    const before = point === 'middle' ? run.snapshots.early! : run.snapshots.middle!;
    return pick(now) - pick(before);
  });
  const intervalLine = (pick: (snapshot: LongSnapshot) => number): string =>
    SNAPSHOT_POINTS.map((point) => `${point} ${summary(intervalValues(point, pick))}`).join(' · ');
  const blockerIntervals = (point: LongSnapshotPoint, blocker: LadderBlocker): number[] =>
    completeRuns.map((run) => {
      const now = run.snapshots[point]!.ladderBlockers[blocker];
      if (point === 'early') return now;
      const before = point === 'middle' ? run.snapshots.early! : run.snapshots.middle!;
      return now - before.ladderBlockers[blocker];
    });

  const policies = [...new Set(runs.map((run) => run.policy))];
  const policyLabel = policies.length === 1 ? policies[0] : policies.join(',');
  lines.push('#133 Stage 5A-G — ' + countRuns + ' runs x ' + years + ' years · policy ' + policyLabel);
  lines.push('term reached: ' + runs.filter((r) => r.reachedTerm).length + '/' + countRuns
    + ' · final year: ' + summary(nums((r) => r.finalYear)));
  lines.push('living blood at end: ' + summary(nums((r) => r.livingBloodEnd))
    + ' · low-water ' + summary(nums((r) => r.livingBloodLow))
    + ' · high-water ' + summary(nums((r) => r.livingBloodHigh)));
  lines.push('generations: ' + summary(nums((r) => r.generations)));

  lines.push('');
  lines.push('5A Ledger');
  lines.push('  clauses: ' + summary(nums((r) => r.clauses)));
  lines.push('  all 9: ' + runs.filter((r) => r.clauses === 9).length + '/' + countRuns
    + ' · >=7: ' + runs.filter((r) => r.clauses >= 7).length + '/' + countRuns
    + ' · <=4: ' + runs.filter((r) => r.clauses <= 4).length + '/' + countRuns);
  const reveals = runs.flatMap((r) => r.clauseYears);
  lines.push('  reveal years (new clauses only): ' + (reveals.length ? summary(reveals) : 'NONE'));
  const bands = [0, 0, 0, 0, 0];
  for (const year of reveals) {
    const at = Math.min(4, Math.max(0, Math.floor(((year - START_YEAR) / Math.max(1, years)) * 5)));
    bands[at] = (bands[at] ?? 0) + 1;
  }
  lines.push('  reveals by fifth: ' + bands.join(' / '));
  lines.push('  ended Ages: ' + summary(nums((r) => r.agesEnded))
    + ' · named Ages: ' + summary(nums((r) => r.agesNamed)));
  lines.push('  named clause-bearing Ages: ' + summary(nums((r) => r.namedClauseBearingAges))
    + ' · named Ages ending unpaid: ' + summary(nums((r) => r.missedClauseAges))
    + ' · archivist coverage: ' + fmt(100 * mean(runs.map((r) => r.archivistYears / Math.max(1, r.finalYear - START_YEAR)))) + '%'
    + ' · record-keeper coverage: ' + fmt(100 * mean(runs.map((r) => r.recordKeeperYears / Math.max(1, r.finalYear - START_YEAR)))) + '% of played years');

  lines.push('');
  lines.push('5B Decision density');
  lines.push('  choices: ' + summary(nums((r) => r.choices)));
  lines.push('  Match:   ' + summary(nums((r) => r.matches)));
  lines.push('  Record:  ' + summary(nums((r) => r.records)));
  lines.push('  naming:  ' + summary(nums((r) => r.namings)));
  lines.push('  total prompts: ' + summary(nums((r) => r.prompts))
    + ' · per generation mean ' + fmt(mean(runs.map((r) => r.prompts / Math.max(1, r.generations))), 2)
    + ' · per ended Age mean ' + fmt(mean(runs.map((r) => r.prompts / Math.max(1, r.agesEnded))), 2));
  const promptTotal = Math.max(1, runs.reduce((sum, r) => sum + r.prompts, 0));
  lines.push('  prompt share — choice ' + fmt(100 * runs.reduce((sum, r) => sum + r.choices, 0) / promptTotal) + '%'
    + ' · Match ' + fmt(100 * runs.reduce((sum, r) => sum + r.matches, 0) / promptTotal) + '%'
    + ' · Record ' + fmt(100 * runs.reduce((sum, r) => sum + r.records, 0) / promptTotal) + '%'
    + ' · naming ' + fmt(100 * runs.reduce((sum, r) => sum + r.namings, 0) / promptTotal) + '%');
  lines.push('  templates repeated in a run: ' + summary(nums((r) => r.repeatedTemplates)));

  lines.push('');
  lines.push('5C Frame cadence');
  lines.push('  frames: ' + summary(nums((r) => r.frames)));
  lines.push('  first frame: ' + summary(runs.flatMap((r) => r.frameFirst === undefined ? [] : [r.frameFirst])));
  lines.push('  last frame:  ' + summary(runs.flatMap((r) => r.frameLast === undefined ? [] : [r.frameLast])));
  lines.push('  max silence incl. campaign edges: ' + summary(nums((r) => r.frameMaxSilence)));
  const chapterCount = runs.reduce((a, r) => a + r.chapters, 0);
  const noFrame = runs.reduce((a, r) => a + r.chaptersNoFrame, 0);
  const multiFrame = runs.reduce((a, r) => a + r.chaptersMultiFrame, 0);
  lines.push('  chapter windows: ' + chapterCount
    + ' · no frame ' + fmt(percent(noFrame, chapterCount)) + '%'
    + ' · multiple frames ' + fmt(percent(multiFrame, chapterCount)) + '%');

  lines.push('');
  lines.push('5D Land / Muster');
  lines.push('  acreage start ' + fmt(mean(nums((r) => r.acreageStart)))
    + ' · end ' + summary(nums((r) => r.acreageEnd)));
  lines.push('  acreage low ' + summary(nums((r) => r.acreageLow))
    + ' · high ' + summary(nums((r) => r.acreageHigh)));
  lines.push('  acquisitions ' + summary(nums((r) => r.acquisitions))
    + ' · losses ' + summary(nums((r) => r.losses))
    + ' · improvements ' + summary(nums((r) => r.improvements)));
  lines.push('  plat illuminated ' + runs.filter((r) => r.illuminated).length + '/' + countRuns
    + ' · treasury end ' + summary(nums((r) => r.treasuryEnd))
    + ' · low ' + summary(nums((r) => r.treasuryLow)));
  lines.push('  Muster commitments ' + summary(nums((r) => r.musters))
    + ' · settled ' + summary(nums((r) => r.musterSettled))
    + ' · withdrawn ' + summary(nums((r) => r.musterWithdrawn)));
  lines.push('  positioned commitments ' + summary(nums((r) => r.musterPositioned))
    + ' · tide low ' + summary(nums((r) => r.musterTideLow))
    + ' · high ' + summary(nums((r) => r.musterTideHigh)));

  lines.push('');
  lines.push('5E Careers / study / rites / arcs / reach');
  lines.push('  career placements ' + summary(nums((r) => r.careerPlacements))
    + ' · tutor completions ' + summary(nums((r) => r.taught))
    + ' · books opened ' + summary(nums((r) => r.booksOpened)));
  lines.push('  spells known total ' + summary(nums((r) => r.spellsKnown))
    + ' · max one person ' + summary(nums((r) => r.maxBooksOnePerson)));
  lines.push('  rites — Vessel ' + runs.reduce((a, r) => a + r.vesselRites, 0)
    + ' · Great ' + runs.reduce((a, r) => a + r.greatRites, 0)
    + ' · Unmaking ' + runs.reduce((a, r) => a + r.unmakings, 0)
    + ' (reported here; Stage 5F owns the reach diagnosis)');
  lines.push('  arcs started ' + summary(nums((r) => r.arcsStarted))
    + ' · ended ' + summary(nums((r) => r.arcsEnded))
    + ' · expired ' + summary(nums((r) => r.arcsExpired))
    + ' · active at term ' + summary(nums((r) => r.arcsActive)));
  lines.push('  Assize sittings ' + summary(nums((r) => r.assizeSittings)));

  const seenRuns = new Map<string, number>();
  const fires = new Map<string, number>();
  for (const run of runs) {
    for (const id of run.templatesSeen) seenRuns.set(id, (seenRuns.get(id) ?? 0) + 1);
    for (const [id, count] of Object.entries(run.templateFires)) {
      fires.set(id, (fires.get(id) ?? 0) + count);
    }
  }
  // Frame has its own cadence and is measured in 5C. Do not call a frame
  // template "rare content starvation" merely because its frequency metadata
  // also says rare/mythic.
  const nonFrame = bundle.events.filter((e) => e.tier !== 'frame');
  const rare = nonFrame.filter((e) => e.frequency === 'rare' || e.frequency === 'mythic');
  const never = rare.filter((e) => !(seenRuns.get(String(e.id)) ?? 0));
  const neverAny = nonFrame.filter((e) => !(seenRuns.get(String(e.id)) ?? 0));
  const rareReach = rare.length
    ? mean(rare.map((e) => (seenRuns.get(String(e.id)) ?? 0) / countRuns))
    : 0;
  lines.push('  rare/mythic templates seen per template/run: ' + fmt(100 * rareReach) + '%'
    + ' · never seen in batch ' + never.length + '/' + rare.length);
  if (never.length) lines.push('  rare/mythic never: ' + never.map((e) => e.id).join(', '));
  lines.push('  all non-frame templates never seen in batch: ' + neverAny.length + '/' + nonFrame.length);

  const most = [...fires].sort((a, b) => b[1] - a[1]).slice(0, 8);
  lines.push('  most-fired templates: ' + most.map(([id, count]) => id + ' ' + count).join(' · '));

  lines.push('');
  lines.push('5F Ladder / readings / endings');
  lines.push('  current rung:       ' + distribution(RUNGS, (r) => r.rungEnd));
  lines.push('  best rung:          ' + distribution(RUNGS, (r) => r.rungBest));
  lines.push('  chronicle attests:  ' + distribution(RUNGS, (r) => r.attested));
  lines.push('  creditor reads:     ' + distribution(RUNGS, (r) => r.substantiated));
  lines.push('  endings:            ' + distribution(ALL_ENDINGS, (r) => r.ending));
  lines.push('  ending settled: ' + runs.filter((r) => r.ending !== undefined).length + '/' + countRuns);

  lines.push('');
  lines.push('5G Consolidated term state');
  lines.push('  respect: ' + distribution(RESPECT_ORDER, (r) => r.respectEnd));
  lines.push('  discontent end ' + summary(nums((r) => r.discontentEnd))
    + ' · low ' + summary(nums((r) => r.discontentLow))
    + ' · high ' + summary(nums((r) => r.discontentHigh)));
  lines.push('  treasury end ' + summary(nums((r) => r.treasuryEnd))
    + ' · low ' + summary(nums((r) => r.treasuryLow)));

  lines.push('');
  lines.push('85 Longitudinal progression');
  lines.push('  snapshot coverage — ' + SNAPSHOT_POINTS.map((point) =>
    `${point} ${pointRuns(point).length}/${countRuns}`
  ).join(' · '));
  lines.push('  held acres: ' + longitudinal((s) => s.heldAcres));
  lines.push('  parcels held: ' + longitudinal((s) => s.parcels));
  lines.push('  Muster settled: ' + longitudinal((s) => s.musterSettled));
  lines.push('  Muster tide: ' + longitudinal((s) => s.musterTide));
  lines.push('  bearing: ' + longitudinal((s) => s.bearing));
  lines.push('  market appetite: ' + longitudinal((s) => s.marketAppetite));
  lines.push('  career holders: ' + longitudinal((s) => s.careerHolders));
  lines.push('  distinct careers held: ' + longitudinal((s) => s.distinctCareers));
  lines.push('  longest live career tenure: ' + longitudinal((s) => s.longestCareerTenure));
  lines.push('  treasury: ' + longitudinal((s) => s.treasury));
  lines.push('  discontent: ' + longitudinal((s) => s.discontent));
  lines.push('  living blood: ' + longitudinal((s) => s.livingBlood));
  lines.push('  tales (monotone control): ' + longitudinal((s) => s.tales));
  lines.push('  clauses (monotone control): ' + longitudinal((s) => s.clauses));
  lines.push('  respect index: ' + longitudinal((s) => RESPECT_ORDER.indexOf(s.respect)));
  lines.push('  current rung index: ' + longitudinal((s) => RUNGS.indexOf(s.rung)));
  lines.push('  best rung index: ' + longitudinal((s) => RUNGS.indexOf(s.best)));
  lines.push('  attested rung index: ' + longitudinal((s) => RUNGS.indexOf(s.attested)));
  lines.push('  substantiated rung index: ' + longitudinal((s) => RUNGS.indexOf(s.substantiated)));
  lines.push('  paired early→late confidence — predeclared from the 12-run scout; 40 usable pairs minimum:');
  lines.push('    ' + judgeLongitudinalDelta(
    'longest live career tenure',
    pairedDelta((s) => s.longestCareerTenure),
    'increase',
  ));
  lines.push('    ' + judgeLongitudinalDelta(
    'discontent',
    pairedDelta((s) => s.discontent),
    'increase',
  ));
  lines.push('    ' + judgeLongitudinalDelta(
    'held acres',
    pairedDelta((s) => s.heldAcres),
    'increase',
  ));
  lines.push('    ' + judgeLongitudinalDelta(
    'current rung index',
    pairedDelta((s) => RUNGS.indexOf(s.rung)),
    'decrease',
  ));
  if (policies.length === 1 && policies[0] === 'commit') {
    lines.push('    ' + judgeLongitudinalDelta(
      'Muster settled under commit policy',
      pairedDelta((s) => s.musterSettled),
      'increase',
    ));
  }
  for (const point of SNAPSHOT_POINTS) {
    lines.push(`  ${point} respect: ` + snapshotDistribution(point, RESPECT_ORDER, (s) => s.respect));
    lines.push(`  ${point} rung current: ` + snapshotDistribution(point, RUNGS, (s) => s.rung));
    lines.push(`  ${point} rung best: ` + snapshotDistribution(point, RUNGS, (s) => s.best));
    lines.push(`  ${point} rung attested: ` + snapshotDistribution(point, RUNGS, (s) => s.attested));
    lines.push(`  ${point} rung substantiated: ` + snapshotDistribution(point, RUNGS, (s) => s.substantiated));
  }
  const peakYears = runs.flatMap((r) => r.peakRungYear === undefined ? [] : [r.peakRungYear]);
  const peakProgress = runs.flatMap((r) => r.peakRungProgress === undefined ? [] : [r.peakRungProgress]);
  lines.push('  best rung last improved — year ' + (peakYears.length ? summary(peakYears) : 'NONE')
    + ' · campaign progress ' + (peakProgress.length ? summary(peakProgress) : 'NONE'));

  lines.push('');
  lines.push('201 Ladder diagnosis — normalized thirds; complete paired runs ' + completeRuns.length + '/' + countRuns);
  lines.push('  ladder bargains offered: ' + intervalLine((s) => s.ladderOffers));
  lines.push('  costly ladder choices taken: ' + intervalLine((s) => s.ladderAccepted));
  lines.push('  rites completed — Vessel: ' + intervalLine((s) => s.vesselRites));
  lines.push('  rites completed — Great: ' + intervalLine((s) => s.greatRites));
  lines.push('  rites completed — Unmaking: ' + intervalLine((s) => s.unmakings));
  lines.push('  live rung rises: ' + intervalLine((s) => s.ladderRises));
  lines.push('  live rung falls: ' + intervalLine((s) => s.ladderDrops));
  lines.push('  falls where the prior climber died: ' + intervalLine((s) => s.ladderMortalityDrops));
  const lateBlockers = LADDER_BLOCKERS
    .map((blocker) => ({ blocker, years: blockerIntervals('late', blocker).reduce((a, b) => a + b, 0) }))
    .filter((entry) => entry.years > 0)
    .sort((a, b) => b.years - a.years);
  const lateBlockerYears = lateBlockers.reduce((sum, entry) => sum + entry.years, 0);
  lines.push('  late-third foremost blocker-years: ' + (lateBlockers.length
    ? lateBlockers.map(({ blocker, years: n }) =>
      `${blocker} ${n} (${fmt(100 * n / Math.max(1, lateBlockerYears))}%)`).join(' · ')
    : 'NONE'));

  return lines.join('\n');
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('long-line-gate.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? 40);
  const years = Number(process.argv[3] ?? CAMPAIGN_YEARS);
  const rawPolicy = process.argv[4] ?? 'chronicler';
  if (rawPolicy === 'compare') {
    const chronicler = measureLongLine(runs, years, 'chronicler');
    const ascendant = measureLongLine(runs, years, 'ascendant');
    console.log(reportLadderPolicyComparison(chronicler, ascendant));
  } else {
    if (rawPolicy !== 'chronicler' && rawPolicy !== 'commit' && rawPolicy !== 'climb' && rawPolicy !== 'ascendant') {
      throw new Error(`gate:long policy must be chronicler, commit, climb, ascendant or compare, got '${rawPolicy}'`);
    }
    const measured = measureLongLine(runs, years, rawPolicy);
    console.log(reportLongLine(measured, years));
  }
}
