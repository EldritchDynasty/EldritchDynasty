/**
 * IS THE RUN LOSABLE? THE ENDING DISTRIBUTION (issue #42).
 *
 *   npm run gate:endings -- [runs] [years]
 *   npm run gate:endings -- 250 500
 *
 * `assize.ts` has carried the finding this exists to close since it shipped:
 *
 *   > Measured across fourteen thousand-year runs, the shipped game could not
 *   > be lost and could not be won differently: zero houses died out, the
 *   > household never fell below ten people, every player-driven run finished
 *   > with nine of nine Ledger clauses, and standing landed on exalted or
 *   > eminent nearly every time. Five endings are authored (§23) and the
 *   > simulation could not tell them apart.
 *
 * ─── The target, and where it came from ────────────────────────────────────
 *
 * Recorded on the issue before this file existed, so the gate is written
 * against a decision rather than fitted to whatever the batch produced:
 * **about one run in three ends in a loss the player feels as one.** The harsh
 * end of the genre, chosen over "rare and memorable" on the grounds that a
 * collapse one house in ten suffers is a story about luck.
 *
 * #185's corrected instrument showed that pooling the catastrophes was the
 * wrong judgement: saving a bloodline often moves a run from Broken Line to
 * Devoured without changing the pooled total. The owner therefore split the
 * band. Broken Line keeps the recorded 22–45% loss band; Devoured gets the
 * same 45% upper guard, while Forgotten keeps its reachability floor. The old
 * pooled catastrophe total is printed only as diagnostic history.
 *
 * ─── The judgement is split from the playing ───────────────────────────────
 *
 * `verdictOver` is a function over runs, so `ending-gate.test.ts` can hand it
 * a distribution where the run is losable and one where every house arrives
 * at the same place — which is the state this issue was filed about, and the
 * one thing a gate over the real bundle can never demonstrate it would catch.
 *
 * ─── It IS in `npm run gate` ────────────────────────────────────────────────
 *
 * Registered in `GATES` (`tools/gates.ts`) and pinned there by
 * `gates.test.ts`. An earlier draft of this comment said otherwise — written
 * before `endings` was added to the registry and never updated once it was.
 * `gate:endings -- 250 500` is how to run a larger standalone sweep. CI uses
 * the first batch size that can actually judge the one-per-cent floor.
 *
 * ─── The second column: `ascendant` (issue #61, Stage D) ───────────────────
 *
 * `playToTheEnd` is played by the chronicler by design (see its own doc
 * comment) — that answers "what does the shipped game do", and is the
 * column the catastrophe band and the per-ending floors are read against.
 * It cannot answer "is Apotheosis reachable at all", because a house that
 * never plays for the ladder is not the house #22 is describing, and
 * #61's own trail measured this directly: `gate:ladder`'s `climb` and
 * `scion` columns diverge from `chronicler` by design, on exactly the
 * choices that decide whether the top of the ladder is ever reached.
 *
 * `ascendant` is a house pulling every lever the game gives a player for
 * building the ladder, at once: it takes Madness bargains like `climb`
 * (`answer`, `tools/ladder-policy.ts`), names and holds a Scion and Heir via the pair mechanism
 * (`nameScion` / `nameScionHeir`), and marries in like `blood-gate.ts`'s `marry_in`.
 * Unlike `gate:ladder`'s three columns — deliberately one verb apart to
 * isolate a single mechanism — this is the composite on purpose: the
 * question here is whether the top is reachable to a house TRYING, not
 * which lever does the trying.
 *
 * It also gets a bid ceiling (`gate:ladder`'s own default, 600) that the
 * chronicler column has never had: `world.bidCeiling` defaults to 0, so
 * `playToTheEnd`'s chronicler has never bought a book at auction. Books were
 * a binding blocker in every ladder measurement on this issue; a composite
 * column that could not buy one would understate what a trying house can
 * reach for a reason unrelated to the ladder itself.
 *
 * `verdictOver`'s policy denominator is the owner's 8–29% Apotheosis band
 * (#61), read against `ascendant`. An agent working #133 retired the 8% floor
 * on its own reading of Stage 5F; the owner reinstated it on #332
 * (2026-09-29) and ruled that, while the game is pre-production, missing it
 * is REPORTED and does not fail CI. The 29% ceiling is still judged — God must
 * stay rare — and so is #325's check that trying for the ladder beats the
 * chronicler. A game that hands a god to a house that never played for one is
 * still not the game §22 describes.
 */
import { loadContent } from '@ed/content';
import { indexContent, MAIN_BRANCH, type CampaignId, type Content, type ContentBundle, type EndingId, type Rung } from '@ed/schema';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { makeRng, hashSeed } from '../rng.js';
import { autoResolveAll } from '../events/decisions.js';
import { closeTheLedger, livingBlood, readTheChronicle } from '../ending.js';
import { affinitiesFor, booksFor, DEMIGOD_AGEING_STOPPED, GOD_READING_BOOKS, householdAffinities, householdBooks, householdOpposedPairs, MADNESS_FLOOR, POWER_FLOOR, rungIndex, standingOf } from '../ascension.js';
import { CAMPAIGN_YEARS, campaignDef } from '../campaign.js';
import { nameScion, nameScionHeir, resolveYear, unmakingReadyForAscendant, type LadderPolicy } from './ladder-policy.js';
import { candidatesFor, resolveSlots } from '../events/slots.js';
import { ascendantFunnelVerdict } from './ascendant-verdict.js';
import { heldBooks } from '../people/library.js';
import { order } from '../table.js';
import {
  CHILDBEARING, completedFertility, conceptionChance, crowding, pairFecundity, thinBloodFertility,
} from '../people/demography.js';
import { branchOf, hall, softCapFor } from '../people/branches.js';
import { inBreedingPool } from '../people/careers.js';
import type { SimCtx } from '../world.js';
import {
  gatePartitionWorkerCount,
  partitionGateInputs,
  reduceGatePartitions,
  runGatePartitionsInWorkers,
  type GatePartition,
  type GatePartitionResult,
} from './gate-partition.js';

type Source = ContentBundle | Content;

/** Read-only campaign facts exposed by the existing ending-policy player. */
export interface EndingYearVisit {
  year: number;
  clauses: number;
  ending?: EndingId;
  templateFires: Readonly<Record<string, number>>;
}

/**
 * Only two of `LadderPolicy`'s five values apply here. This file never
 * isolates a single lever the way `gate:ladder` does — `chronicler` plays
 * the shipped game, `ascendant` pulls every lever at once. `climb`, `spare`
 * and `scion` are `gate:ladder`'s own vocabulary for isolating one mechanism
 * at a time and have no meaning as a standalone column here.
 */
export type EndingPolicy = Extract<LadderPolicy, 'chronicler' | 'ascendant'>;

/** Above Marrow's 800-crown Death bid, so a house seeking the full circle can contest it. */
const ASCENDANT_BID = 1000;

/**
 * The composite player policy, factored so another diagnostic can play the
 * SAME house rather than re-describing what "ascendant" means.
 *
 * These three helpers are deliberately behavioural, not tunable knobs. #201's
 * normalized-thirds run needs the existing #61/#185 policy byte-for-byte:
 * marry in, fund the missing-affinity shelf, keep a Scion and Heir named,
 * take ladder bargains, call ready rites, and search the Ledger once a
 * Demigod has made that verb available.
 */
export function configureAscendant(ctx: SimCtx): void {
  ctx.world.marriagePolicy = 'in';
  ctx.world.bidCeiling = ASCENDANT_BID;
}

export function prepareAscendantYear(ctx: SimCtx): void {
  const w = ctx.world;
  nameScion(ctx);
  nameScionHeir(ctx);
  if (w.treasury < 600) return;
  const onShelf = new Set(heldBooks(ctx).map((s) => ctx.content.spellbook(s.id)?.affinity));
  const missing = ctx.content.spellbooks.find((b) => b.tier === 'minor'
    && !onShelf.has(b.affinity)
    && !w.auction.upcoming.some((lot) => lot.kind === 'spellbook' && lot.refId === b.id));
  if (missing) order(ctx, { kind: 'seekBook', book: missing.id });
}

export function resolveAscendantYear(
  ctx: SimCtx,
  seed: number,
  tally: { asked: number; paid: number },
): { ledgerSearches: number } {
  const w = ctx.world;
  resolveYear(ctx, seed, 'ascendant', tally);
  for (const kind of ['vesselRite', 'greatRite', 'unmaking'] as const) {
    if (kind === 'unmaking' && (w.ascension.best === 'god' || !unmakingReadyForAscendant(ctx))) continue;
    if (!order(ctx, { kind }).ok) continue;
    resolveYear(ctx, seed, 'ascendant', tally);
    break;
  }
  return { ledgerSearches: order(ctx, { kind: 'seekClause' }).ok ? 1 : 0 };
}

/** The three that are catastrophes. `forgotten` is a loss and is not one of these. */
export const CATASTROPHES: readonly EndingId[] = ['unmade', 'broken_line', 'devoured'];

/** Every ending §23 authored, so a zero is visible rather than absent. */
export const ALL_ENDINGS: readonly EndingId[] = [
  'apotheosis', 'unmade', 'broken_line', 'forgotten', 'devoured',
];

export interface EndingRun {
  seed: number;
  policy: EndingPolicy;
  ending: EndingId;
  /** The highest rung the BOOK attests, which is what the creditor read. */
  attested: Rung;
  /** What the creditor can actually substantiate from that book. */
  substantiated?: Rung;
  /** How many attested rungs the reading refused for lack of support. */
  rungsWithheld?: number;
  clauses: number;
  /** Living members of the house on the last night. */
  survivors: number;
  /**
   * The fewest living members the house ever had, in any year of the run.
   *
   * `survivors` says whether the line reached the term; this says how close it
   * came to not. A batch where nothing dies out AND nothing ever dips is a
   * different problem from one that keeps nearly dying and recovering, and
   * `broken_line` at zero cannot tell them apart on its own.
   */
  householdLow: number;
  /**
   * Living members OF THE BLOOD on the last night, as against everyone living
   * under the roof. `livingBlood` counts the household — retainers, wives
   * married in, wards — and the recurring cast is re-minted forever, so the
   * building never empties whatever happens to the family.
   */
  bloodLeft: number;
  /** The fewest of the blood the house ever had living at once. */
  bloodLow: number;
  /** Years from campaign opening to the ending. Diagnostic only, not a gate threshold. */
  yearsPlayed?: number;
  /** Whether the Assize's visible physician response ever reached this house before it ended. */
  physicianStayed?: boolean;
  /** How many of #132's explicit last-line crisis scenes resolved during the run. */
  bottleneckScenes?: number;
  /** How many of those scenes the chronicler answered with the active recovery choice. */
  bottleneckHelpChoices?: number;
  /** Years that ended with one or two living blood — the actual recovery window. */
  bottleneckYears?: number;
  /** Low-blood years where either authored #132 crisis scene could fill its cast. */
  bottleneckFillableYears?: number;
  /** Years that ended with a priority Match still armed after the recovery decision. */
  bottleneckPriorityYears?: number;
  /** Priority Match hands actually dealt in a later marriage phase. */
  bottleneckPriorityDeals?: number;
  /** Low-blood years where a childbearing couple still had family capacity. */
  bottleneckViableCoupleYears?: number;
  /** Best actual birth-roll chance in each low-blood year with a viable couple. */
  bottleneckConceptionChances?: number[];
  /** Whether a blood child was born after the first viable-couple bottleneck year. */
  bottleneckBirthAfterViable?: boolean;
  /** Low-blood years where a childbearing couple had already reached its family cap. */
  bottleneckFamilyCapYears?: number;
  /** Low-blood years with an unmarried main-hall man above the ordinary Match age ceiling. */
  bottleneckOlderUnwedMaleYears?: number;
  /** Low-blood years whose main-hall blood were all too young for the Match. */
  bottleneckMinorOnlyYears?: number;
  /** Low-blood years where every living blood relation was outside the main hall. */
  bottleneckCadetOnlyYears?: number;
  /** Years an unbought Wardship diverted the estate's land income. */
  wardshipYears?: number;
  /** Low-blood years overlapping that unbought Wardship. */
  bottleneckWardshipYears?: number;
  /** Campaign-shape telemetry reused by the Short-Line acceptance gate. */
  generations?: number;
  agesEnded?: number;
  arcsStarted?: number;
  arcsEnded?: number;
  arcsExpired?: number;
  arcsCancelled?: number;
  arcsActive?: number;
  templateFires?: Record<string, number>;
  /** Diagnostic for the approved two-person Unmaking rule. */
  unmakingElderYears?: number;
  unmakingPairYears?: number;
  unmakingFilterYears?: number[];
  unmakingBestAffinityGap?: number;
  circleAffinityPeak?: number;
  circlePairPeak?: number;
  shelfAffinityPeak?: number;
  lineageAffinityPeak?: number;
  circleBookPeak?: number;
  unmakingTakers?: number;
  unmakingTakerPeak?: { power: number; affinities: number; mind: number; madness: number };
  /** Highest rung any successful Unmaking recipient held during this run. */
  unmakingTakerPeakRung?: Rung;
  /** Recipient-years at Demigod or above after a successful Unmaking. */
  unmakingDemigodYears?: number;
  /** Recipient-years visibly waiting at Demigod on the seven-clause Ledger gate. */
  unmakingLedgerWaitYears?: number;
  /** Successful Unmaking recipients that ever crossed Demigod, even if current standing later fell. */
  unmakingDemigodAttainers?: number;
  /** Run-years with a living Unmaking recipient whose Demigod ageing-stop attainment is latched. */
  unmakingAttainedYears?: number;
  /** Those run-years where every latched recipient is currently below Demigod again. */
  unmakingAttainedBelowDemigodYears?: number;
  /** Player-facing archival searches that actually recovered a missed clause. */
  ledgerSearches?: number;
  unmakingStageEver?: boolean[];
  unmakingGateEver?: boolean[];
}

export interface EndingVerdict {
  ok: boolean;
  lines: string[];
}

/**
 * One run, played to the term by `policy` — `chronicler` (the default) or
 * `ascendant`. See the header comment's "the second column" for what
 * `ascendant` pulls and why: this asks what the game does BY DEFAULT versus
 * what it does for a house trying for the top, and those are different and
 * both worth asking, so the policy is a parameter rather than a fixed choice.
 *
 * The chronicler path is untouched from before this file took a policy —
 * same RNG salt (`'ending-batch'`), same loop — so every existing chronicler
 * measurement on this gate stays reproducible. `ascendant` reuses
 * `tools/ladder-policy.ts`'s `resolveYear`/`nameScion`/`nameScionHeir` rather than a second
 * copy of the decision loop `gate:ladder` already has.
 */
export function playToTheEnd(
  source: Source,
  seed: number,
  years: number,
  policy: EndingPolicy = 'chronicler',
  campaign: CampaignId = 'long',
  onYear?: (visit: EndingYearVisit) => void,
): EndingRun {
  const def = campaignDef(campaign);
  const ctx = bootstrap(indexContent(source), seed, def.startYear, campaign);
  const w = ctx.world;
  if (policy === 'ascendant') configureAscendant(ctx);

  let householdLow = Number.POSITIVE_INFINITY;
  let bloodLow = Number.POSITIVE_INFINITY;
  const tally = { asked: 0, paid: 0 };
  const unmaking = policy === 'ascendant'
    ? ctx.content.events.find((e) => e.id === 'the_unmaking') : undefined;
  let unmakingElderYears = 0;
  let unmakingPairYears = 0;
  const unmakingFilterYears = unmaking?.slots.ASCENDANT?.filters.map(() => 0) ?? [];
  let unmakingBestAffinityGap = Number.NEGATIVE_INFINITY;
  let circleAffinityPeak = 0;
  let circlePairPeak = 0;
  let shelfAffinityPeak = 0;
  let lineageAffinityPeak = 0;
  let circleBookPeak = 0;
  const unmakingStageEver = Array.from({ length: 9 }, () => false);
  const unmakingGateEver = Array.from({ length: 8 }, () => false);
  let unmakingTakerPeakRung: Rung = 'none';
  let unmakingDemigodYears = 0;
  let unmakingLedgerWaitYears = 0;
  let unmakingAttainedYears = 0;
  let unmakingAttainedBelowDemigodYears = 0;
  let ledgerSearches = 0;
  const bottleneckEvents = ctx.content.events.filter((e) =>
    e.id === 'the_house_has_one_name_left' || e.id === 'the_marriage_that_cannot_answer');
  let bottleneckYears = 0;
  let bottleneckFillableYears = 0;
  let bottleneckPriorityYears = 0;
  let bottleneckPriorityDeals = 0;
  let bottleneckViableCoupleYears = 0;
  const bottleneckConceptionChances: number[] = [];
  let firstBottleneckViableYear: number | undefined;
  let bottleneckBirthAfterViable = false;
  let bottleneckFamilyCapYears = 0;
  let bottleneckOlderUnwedMaleYears = 0;
  let bottleneckMinorOnlyYears = 0;
  let bottleneckCadetOnlyYears = 0;
  let wardshipYears = 0;
  let bottleneckWardshipYears = 0;
  for (let y = 0; y < years; y++) {
    // THE TERM, OR THE LINE RUNNING OUT BEFORE IT (issue #42). `stepYear`
    // itself now stops turning the year on either — see its own comment —
    // so once `w.ending` is set every further call is a cheap no-op, but a
    // batch loop still has no reason to keep making it 900 times over.
    if (w.year >= def.endYear || w.ending) break;
    const priorityAtYearStart = [...w.priorityMatch];
    if (policy === 'ascendant') prepareAscendantYear(ctx);
    stepYear(ctx, false);

    // #185 diagnostics: #132 already supplied a visible recovery mechanism.
    // Measure the real question before changing balance again: when the blood
    // reaches one or two, is either authored crisis actually castable? This
    // uses its own RNG stream and mutates nothing, so the measurement cannot
    // re-roll the run it is observing.
    const unboughtWardship = Boolean(w.wardship && !w.wardship.boughtBack);
    if (unboughtWardship) wardshipYears++;

    const bloodAfterStep = livingBlood(w);
    if (bloodAfterStep > 0 && bloodAfterStep <= 2) {
      bottleneckYears++;
      const fillable = bottleneckEvents.some((event, i) =>
        resolveSlots(event, ctx, makeRng(hashSeed(seed, 'ending-bottleneck-slots', w.year, i))).ok);
      if (fillable) bottleneckFillableYears++;
      if (unboughtWardship) bottleneckWardshipYears++;

      // #132's two scenes cover only an unmarried 17-45-year-old or a man
      // whose wife is already past childbearing. Name the other states rather
      // than treating "not fillable" as one thing. These are diagnostic reads:
      // no state, RNG stream or decision is changed.
      const mainBlood = w.people.household(w.playerHouse, w.year).filter((p) =>
        p.membership.some((m) => m.house === w.playerHouse
          && m.kind === 'blood'
          && (m.branch ?? MAIN_BRANCH) === MAIN_BRANCH));
      if (!mainBlood.length) bottleneckCadetOnlyYears++;
      if (mainBlood.length && mainBlood.every((p) => w.year - p.born < 17)) bottleneckMinorOnlyYears++;
      if (mainBlood.some((p) => p.sex === 'male'
        && w.year - p.born > 45
        && !p.marriages.some((m) => m.to === undefined)
        && inBreedingPool(ctx, p))) {
        bottleneckOlderUnwedMaleYears++;
      }

      let viableCouple = false;
      let bestConceptionChance = 0;
      let familyCap = false;
      const seen = new Set<string>();
      for (const p of mainBlood) {
        const marriage = p.marriages.find((m) => m.to === undefined);
        if (!marriage) continue;
        const spouse = w.people.get(marriage.spouse);
        if (!spouse || spouse.status !== 'alive') continue;
        const key = [String(p.id), String(spouse.id)].sort().join(':');
        if (seen.has(key)) continue;
        seen.add(key);

        const mother = p.sex === 'female' ? p : spouse.sex === 'female' ? spouse : undefined;
        const father = p.sex === 'male' ? p : spouse.sex === 'male' ? spouse : undefined;
        if (!mother || !father || !inBreedingPool(ctx, mother) || !inBreedingPool(ctx, father)) continue;
        const motherAge = w.year - mother.born;
        if (motherAge < CHILDBEARING.from || motherAge > CHILDBEARING.to) continue;

        const borne = w.people.children(mother.id).length;
        const cap = completedFertility(pairFecundity(mother, father, ctx), mother, father, ctx);
        if (borne >= cap) {
          familyCap = true;
        } else {
          const branch = branchOf(w, mother, w.year);
          const pressure = crowding(hall(w, branch, w.year).length, softCapFor(branch))
            * thinBloodFertility(ctx);
          // Match rollBirths exactly: raw biology is multiplied by hall crowding
          // and the thin-line fertility brake before any RNG is asked. Reporting
          // the raw number here made a 15% body look like a 4% actual roll.
          const chance = conceptionChance(mother, father, ctx) * pressure;
          if (chance > 0) {
            viableCouple = true;
            bestConceptionChance = Math.max(bestConceptionChance, chance);
          }
        }
      }
      if (viableCouple) {
        bottleneckViableCoupleYears++;
        bottleneckConceptionChances.push(bestConceptionChance);
        firstBottleneckViableYear ??= w.year;
      }
      if (familyCap) bottleneckFamilyCapYears++;
    }

    if (firstBottleneckViableYear !== undefined && !bottleneckBirthAfterViable) {
      bottleneckBirthAfterViable = w.people.blood(w.playerHouse)
        .some((person) => person.born > firstBottleneckViableYear!);
    }

    if (policy === 'ascendant') {
      ledgerSearches += resolveAscendantYear(ctx, seed, tally).ledgerSearches;
    } else {
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        autoResolveAll(ctx, makeRng(hashSeed(seed, 'ending-batch', w.year, guard)));
      }
    }

    // A priority set by an ambient crisis cannot be dealt until a later
    // marriage phase (marriage runs before ambient). Count whether that hand
    // actually happened, rather than treating "the choice fired" as recovery.
    for (const id of priorityAtYearStart) {
      if (!w.priorityMatch.includes(id) && w.courted[id] === w.year) bottleneckPriorityDeals++;
    }
    if (w.priorityMatch.length) bottleneckPriorityYears++;

    clearNamingQueue(ctx);
    if (unmaking) {
      circleAffinityPeak = Math.max(circleAffinityPeak, householdAffinities(ctx));
      circlePairPeak = Math.max(circlePairPeak, householdOpposedPairs(ctx));
      circleBookPeak = Math.max(circleBookPeak, householdBooks(ctx));
      const shelf = new Set(heldBooks(ctx).map((b) => ctx.content.spellbook(b.id)?.affinity).filter(Boolean));
      shelfAffinityPeak = Math.max(shelfAffinityPeak, shelf.size);
      const lineage = new Set(w.people.blood(w.playerHouse).flatMap((p) =>
        p.spellsKnown.map((id) => ctx.content.spellbook(id)?.affinity)).filter(Boolean));
      lineageAffinityPeak = Math.max(lineageAffinityPeak, lineage.size);
      let demigodThisYear = false;
      let ledgerWaitThisYear = false;
      let attainedThisYear = false;
      let attainedAtCurrentDemigodThisYear = false;
      for (const p of w.people.living().filter((q) => q.rites.includes('unmaking'))) {
        const standing = standingOf(ctx, p);
        if (p.acquired[DEMIGOD_AGEING_STOPPED] === 1) {
          attainedThisYear = true;
          if (rungIndex(standing.rung) >= rungIndex('demigod')) attainedAtCurrentDemigodThisYear = true;
        }
        if (rungIndex(standing.rung) > rungIndex(unmakingTakerPeakRung)) {
          unmakingTakerPeakRung = standing.rung;
        }
        if (rungIndex(standing.rung) >= rungIndex('demigod')) demigodThisYear = true;
        // The structured blocker (#270), not the prose it is written beside (#276).
        if (standing.rung === 'demigod' && standing.blocker === 'clauses') {
          ledgerWaitThisYear = true;
        }
        const stages = [true, standing.power >= POWER_FLOOR.god,
          householdBooks(ctx) >= booksFor(ctx, 'god'),
          householdAffinities(ctx) >= affinitiesFor('demigod')
            && householdOpposedPairs(ctx) >= affinitiesFor('god'),
          standing.madness >= MADNESS_FLOOR.god!, standing.mind >= standing.madness,
          w.clausesRecovered.size >= 7, w.respect === 'exalted',
          standing.rung === 'god'];
        for (let i = 0; i < stages.length; i++) {
          if (stages.slice(0, i + 1).every(Boolean)) unmakingStageEver[i] = true;
        }
        for (let i = 0; i < unmakingGateEver.length; i++) {
          if (stages[i + 1]) unmakingGateEver[i] = true;
        }
      }
      if (demigodThisYear) unmakingDemigodYears++;
      if (ledgerWaitThisYear) unmakingLedgerWaitYears++;
      if (attainedThisYear) unmakingAttainedYears++;
      if (attainedThisYear && !attainedAtCurrentDemigodThisYear) unmakingAttainedBelowDemigodYears++;
    }
    if (unmaking) {
      const elders = candidatesFor(unmaking.slots.ELDER!, ctx, {});
      if (elders.length) {
        unmakingElderYears++;
        const spec = unmaking.slots.ASCENDANT!;
        const powerIndex = spec.filters.findIndex((f) => 'exceeds' in f && f.exceeds.on === 'power');
        const reached = spec.filters.map(() => false);
        for (const elder of elders) {
          const bound = { ELDER: elder.id };
          for (let i = 0; i < spec.filters.length; i++) {
            const matching = candidatesFor({ ...spec, filters: spec.filters.slice(0, i + 1) }, ctx, bound);
            if (matching.length) reached[i] = true;
            if (i === powerIndex && matching.length) {
              const elderAffinities = standingOf(ctx, elder).affinities;
              unmakingBestAffinityGap = Math.max(unmakingBestAffinityGap,
                ...matching.map((p) => standingOf(ctx, p).affinities - elderAffinities));
            }
          }
        }
        reached.forEach((yes, i) => { if (yes) unmakingFilterYears[i]!++; });
        if (reached.at(-1)) unmakingPairYears++;
      }
    }
    householdLow = Math.min(householdLow, w.people.household(w.playerHouse, w.year).length);
    bloodLow = Math.min(bloodLow, livingBlood(w));

    // Observe this existing policy run rather than replaying it elsewhere.
    // The terminal year is deferred until closeTheLedger below has assigned
    // its ending, so the observer receives exactly one snapshot per played year.
    if (w.year < def.endYear && !w.ending) {
      onYear?.({
        year: w.year,
        clauses: w.clausesRecovered.size,
        templateFires: { ...w.frequency.templateFires },
      });
    }
  }

  // AND THE READING ITSELF. `closeTheLedger` runs INSIDE `stepYear`, on a year
  // that has already reached the term (or emptied the blood) — so a loop that
  // stops the moment either happens never calls it on its own, and the run
  // would finish with no ending at all.
  //
  // The first cut of this file defaulted that to `forgotten`, and the batch
  // came back 100 runs of 100 forgotten with `attested above adept 35` printed
  // underneath it. Thirty-five houses whose book attests a Hierophant are
  // thirty-five `devoured` by `selectEnding`; the two numbers could not both
  // be true, and the one that was lying was the default. A silent fallback in
  // the instrument is worse than one in the game: it reports the finding the
  // issue predicted, in the issue's own words, and is wrong.
  if (w.year >= def.endYear || w.ending) {
    closeTheLedger(ctx);
    onYear?.({
      year: w.year,
      clauses: w.clausesRecovered.size,
      ...(w.ending ? { ending: w.ending.id } : {}),
      templateFires: { ...w.frequency.templateFires },
    });
  }

  const r = readTheChronicle(ctx);
  const bottleneckDecisions = w.decisionLog.filter((d) => d.kind === 'outcome'
    && (d.event === 'the_house_has_one_name_left' || d.event === 'the_marriage_that_cannot_answer'));
  const bottleneckHelpChoices = bottleneckDecisions.filter((d) => d.kind === 'outcome' && (
    (d.event === 'the_house_has_one_name_left' && d.choiceId === 'send_to_a_broker')
    || (d.event === 'the_marriage_that_cannot_answer' && d.choiceId === 'put_it_to_the_church')
  )).length;
  // Counted in BOTH columns (issue #325): the funnel verdict compares the
  // ascendant house's Unmaking rate against the chronicler's, and a column
  // that never counted would be compared against a zero it did not measure.
  const takers = w.people.all().filter((p) => p.rites.includes('unmaking'));
  const unmakingTakerPeak = takers.reduce((peak, p) => {
    const standing = standingOf(ctx, p);
    return {
      power: Math.max(peak.power, standing.power),
      affinities: Math.max(peak.affinities, standing.affinities),
      mind: Math.max(peak.mind, standing.mind),
      madness: Math.max(peak.madness, standing.madness),
    };
  }, { power: 0, affinities: 0, mind: 0, madness: 0 });
  return {
    seed,
    policy,
    // Never defaulted. A run with no ending is a broken measurement and
    // `verdictOver` fails on it rather than counting it as anything.
    ending: w.ending?.id ?? ('none' as EndingId),
    attested: r.attested,
    substantiated: r.substantiated,
    rungsWithheld: r.rungsWithheld,
    clauses: r.clauses,
    survivors: w.people.household(w.playerHouse, w.year).length,
    householdLow: Number.isFinite(householdLow) ? householdLow : 0,
    bloodLeft: livingBlood(w),
    bloodLow: Number.isFinite(bloodLow) ? bloodLow : 0,
    yearsPlayed: (w.ending?.year ?? w.year) - def.startYear,
    physicianStayed: w.assize.fired.the_physician_stays !== undefined,
    bottleneckScenes: bottleneckDecisions.length,
    bottleneckHelpChoices,
    bottleneckYears,
    bottleneckFillableYears,
    bottleneckPriorityYears,
    bottleneckPriorityDeals,
    bottleneckViableCoupleYears,
    bottleneckConceptionChances,
    bottleneckBirthAfterViable,
    bottleneckFamilyCapYears,
    bottleneckOlderUnwedMaleYears,
    bottleneckMinorOnlyYears,
    bottleneckCadetOnlyYears,
    wardshipYears,
    bottleneckWardshipYears,
    generations: w.generation,
    agesEnded: w.age.ended.length,
    arcsStarted: w.arcs.size,
    arcsEnded: [...w.arcs.values()].filter((a) => a.status === 'ended').length,
    arcsExpired: [...w.arcs.values()].filter((a) => a.status === 'expired').length,
    arcsCancelled: [...w.arcs.values()].filter((a) => a.status === 'cancelled').length,
    arcsActive: [...w.arcs.values()].filter((a) => a.status === 'active').length,
    templateFires: { ...w.frequency.templateFires },
    unmakingElderYears,
    unmakingPairYears,
    unmakingFilterYears,
    unmakingBestAffinityGap,
    circleAffinityPeak,
    circlePairPeak,
    shelfAffinityPeak,
    lineageAffinityPeak,
    unmakingTakers: takers.length,
    unmakingTakerPeak,
    unmakingTakerPeakRung,
    unmakingDemigodYears,
    unmakingLedgerWaitYears,
    unmakingDemigodAttainers: takers.filter((p) => p.acquired[DEMIGOD_AGEING_STOPPED] === 1).length,
    unmakingAttainedYears,
    unmakingAttainedBelowDemigodYears,
    ledgerSearches,
    unmakingStageEver,
    unmakingGateEver,
    circleBookPeak,
  };
}

/**
 * THE FLOOR EACH ENDING IS HELD TO.
 *
 * A share rather than a count, so the gate means the same thing at 250 runs
 * and at 1,000. `apotheosis` is deliberately absent from the floors: §22's God
 * is the terminal outcome a family has to be built for, and a floor under it
 * would be a gate demanding the rarest thing in the design happen on schedule.
 * It is printed, and a zero there is a finding rather than a failure.
 */
const ENDING_FLOOR = 0.01;

/** The owner-approved #185 split: bloodline extinction keeps the recorded loss band. */
const BROKEN_LINE_BAND = { low: 0.22, high: 0.45 };

/** Partial ascent is separate now; it may be common, but not dominate the chronicler. */
const DEVOURED_CEILING = 0.45;

/**
 * THE UPPER BOUND ON A HOUSE DELIBERATELY PLAYING FOR GOD.
 *
 * The owner's band is 8–29% (#61, 2026-09-20). The 29% ceiling is judged: it
 * guards against concentration so strong that God stops being a terminal
 * outcome a family has to be built for.
 */
const APOTHEOSIS_CEILING = 0.29;

/**
 * THE OWNER'S FLOOR, REPORTED AND NOT JUDGED (#332, 2026-09-29).
 *
 * "Keep the 8 percent floor", and "the floor being missed shouldn't block CI
 * landing, as this is all preprod". So every run of this gate prints the
 * ascendant rate against it and says plainly when it falls short. Raising the
 * rate toward it is #332's balance work. Turning this into a failing claim is
 * the owner's later call, and at 100 runs it would need the ascendant rate
 * near 15% to clear two standard errors (`expectRate`).
 */
export const APOTHEOSIS_TARGET_FLOOR = 0.08;

/**
 * Below this the batch cannot see a five-way distribution and says so.
 *
 * A floor of 1% needs at least a hundred runs to be judged at all: at sixty it
 * is 0.6 of a run, so an ending that fires in one run of sixty — which is
 * ABOVE the floor — reads as below it whenever the next batch happens to
 * contain none. That failed a batch on `unmade` while the same content was
 * resolving fine in gate 8's 250 runs, which is a gate reporting sampling
 * noise as a defect.
 */
export const ENDING_JUDGEABLE_BATCH = 100;

/**
 * The CI/default batch is larger than the minimum judgeable batch. On #344's
 * honest-inheritance head, a fresh 100-pair diagnostic saw 2 Unmaking takers
 * and correctly refused to call that 1.4-SE result stable. The shipped 160-pair
 * batch saw 4 takers against 0 chronicler runs and cleared the same guard.
 * #668's later main nightly again measured only 2 taker runs in those 160,
 * at 1.4 SE, and prescribed about 380. Keep the historical prefix and extend
 * the complete paired sample to 512 instead of weakening any comparison.
 */
export const ENDING_DEFAULT_BATCH = 512;

/** Canonical paired inputs, shared by the gate and its retained-batch contract. */
export function endingGateInputs(runs = ENDING_DEFAULT_BATCH): Pick<EndingRun, 'seed' | 'policy'>[] {
  const inputs: Pick<EndingRun, 'seed' | 'policy'>[] = [];
  for (let i = 0; i < runs; i++) {
    inputs.push({ seed: 5100 + i, policy: 'chronicler' });
    inputs.push({ seed: 5100 + i, policy: 'ascendant' });
  }
  return inputs;
}

export function verdictOver(runs: EndingRun[]): EndingVerdict {
  const lines: string[] = [];
  // THE TWO COLUMNS (issue #61, Stage D). Everything below that existed
  // before this split — the per-ending shares, the chronicler loss guards, the
  // low-water lines — reads the CHRONICLER column only, unchanged in
  // meaning: it is still "what does the shipped game do". A caller that
  // supplies chronicler-only runs (every test predating this split did)
  // gets byte-identical behaviour, because `ascendant` is simply empty.
  const chronicler = runs.filter((r) => r.policy === 'chronicler');
  const ascendant = runs.filter((r) => r.policy === 'ascendant');
  const n = chronicler.length;
  const count = (id: EndingId) => chronicler.filter((r) => r.ending === id).length;

  for (const id of ALL_ENDINGS) {
    const c = count(id);
    lines.push(`  ${id.padEnd(12)} ${String(c).padStart(4)}  ${n ? (100 * c / n).toFixed(1) : '0.0'}%`);
  }

  const brokenLine = count('broken_line');
  const devoured = count('devoured');
  const brokenShare = n ? brokenLine / n : 0;
  const devouredShare = n ? devoured / n : 0;
  const catastrophes = CATASTROPHES.reduce((a, id) => a + count(id), 0);
  const pooledShare = n ? catastrophes / n : 0;
  lines.push(
    `  --- ${n} runs · broken_line ${brokenLine} (${(100 * brokenShare).toFixed(1)}%)`
    + ` target ${(100 * BROKEN_LINE_BAND.low).toFixed(0)}-${(100 * BROKEN_LINE_BAND.high).toFixed(0)}%`
    + ` · devoured ${devoured} (${(100 * devouredShare).toFixed(1)}%)`
    + ` ceiling ${(100 * DEVOURED_CEILING).toFixed(0)}%`,
  );
  lines.push(
    `  pooled catastrophes ${catastrophes} (${(100 * pooledShare).toFixed(1)}%) — diagnostic only; #185 split the band`,
  );
  if (n) {
    lines.push(
      `  survivors ${(chronicler.reduce((a, r) => a + r.survivors, 0) / n).toFixed(1)}`
      + `  clauses ${(chronicler.reduce((a, r) => a + r.clauses, 0) / n).toFixed(2)}`
      + `  attested above adept ${chronicler.filter((r) => rungIndex(r.attested) > rungIndex('adept')).length}`,
    );
    // HOW CLOSE THE TAIL GETS. A house that never dips is a different problem
    // from one that keeps nearly dying, and `broken_line` at zero looks the
    // same either way.
    const lows = chronicler.map((r) => r.householdLow).sort((a, b) => a - b);
    const bloods = chronicler.map((r) => r.bloodLow).sort((a, b) => a - b);
    lines.push(
      `  low-water household: min ${lows[0]}  p05 ${lows[Math.floor(n * 0.05)]}`
      + `  median ${lows[Math.floor(n * 0.5)]}  under 5: ${lows.filter((v) => v < 5).length}`,
    );
    lines.push(
      `  low-water BLOOD:     min ${bloods[0]}  p05 ${bloods[Math.floor(n * 0.05)]}`
      + `  median ${bloods[Math.floor(n * 0.5)]}  at zero: ${bloods.filter((v) => v === 0).length}`
      + `  blood alive at term: ${(chronicler.reduce((a, r) => a + r.bloodLeft, 0) / n).toFixed(1)}`,
    );

    // #185: `broken_line` and `devoured` make the same catastrophe total for
    // entirely different reasons. Before tuning either, say WHEN the line
    // breaks and whether the Assize's explicit, chronicled mortality help had
    // reached it. This is telemetry only; no threshold is fitted to one batch.
    const broken = chronicler.filter((r) => r.ending === 'broken_line' && r.yearsPlayed !== undefined);
    if (broken.length) {
      const years = broken.map((r) => r.yearsPlayed!).sort((a, b) => a - b);
      const early = years.filter((year) => year <= 150).length;
      const physicians = broken.filter((r) => r.physicianStayed).length;
      lines.push(
        `  broken_line timing: ${early}/${broken.length} inside first 150 years`
        + ` · median ${years[Math.floor(years.length * 0.5)]}y`
        + ` · physician ever reached ${physicians}/${broken.length}`,
      );
      const sceneRuns = broken.filter((r) => (r.bottleneckScenes ?? 0) > 0).length;
      const helpRuns = broken.filter((r) => (r.bottleneckHelpChoices ?? 0) > 0).length;
      const allSceneRuns = chronicler.filter((r) => (r.bottleneckScenes ?? 0) > 0).length;
      const allHelpRuns = chronicler.filter((r) => (r.bottleneckHelpChoices ?? 0) > 0).length;
      lines.push(
        `  thin-line recovery scenes: reached ${allSceneRuns}/${n} runs · active help chosen ${allHelpRuns}/${n}`
        + ` · among broken ${sceneRuns}/${broken.length} reached, ${helpRuns}/${broken.length} chose help`,
      );

      const entered = broken.filter((r) => (r.bottleneckYears ?? 0) > 0).length;
      const fillable = broken.filter((r) => (r.bottleneckFillableYears ?? 0) > 0).length;
      const armed = broken.filter((r) => (r.bottleneckPriorityYears ?? 0) > 0).length;
      const dealt = broken.filter((r) => (r.bottleneckPriorityDeals ?? 0) > 0).length;
      const lowYears = broken.reduce((sum, r) => sum + (r.bottleneckYears ?? 0), 0);
      const fillableYears = broken.reduce((sum, r) => sum + (r.bottleneckFillableYears ?? 0), 0);
      lines.push(
        `  thin-line state among broken: ${entered}/${broken.length} entered 1-2 blood (${lowYears}y)`
        + ` · ${fillable}/${broken.length} had a fillable recovery cast (${fillableYears}y)`
        + ` · priority armed ${armed}/${broken.length} · priority hand dealt ${dealt}/${broken.length}`,
      );

      const viable = broken.filter((r) => (r.bottleneckViableCoupleYears ?? 0) > 0).length;
      const capped = broken.filter((r) => (r.bottleneckFamilyCapYears ?? 0) > 0).length;
      const older = broken.filter((r) => (r.bottleneckOlderUnwedMaleYears ?? 0) > 0).length;
      const minors = broken.filter((r) => (r.bottleneckMinorOnlyYears ?? 0) > 0).length;
      const cadets = broken.filter((r) => (r.bottleneckCadetOnlyYears ?? 0) > 0).length;
      lines.push(
        `  thin-line alternatives among broken: viable couple ${viable}/${broken.length}`
        + ` · family cap reached ${capped}/${broken.length}`
        + ` · older unwed man ${older}/${broken.length}`
        + ` · minors only ${minors}/${broken.length}`
        + ` · cadet-only blood ${cadets}/${broken.length}`,
      );

      const viableRuns = broken.filter((r) => (r.bottleneckConceptionChances?.length ?? 0) > 0);
      const viableYears = broken.reduce((sum, r) => sum + (r.bottleneckViableCoupleYears ?? 0), 0);
      const chances = broken.flatMap((r) => r.bottleneckConceptionChances ?? []).sort((a, b) => a - b);
      if (chances.length) {
        const mean = chances.reduce((sum, chance) => sum + chance, 0) / chances.length;
        const middle = Math.floor(chances.length / 2);
        const median = chances.length % 2
          ? chances[middle]!
          : (chances[middle - 1]! + chances[middle]!) / 2;
        const births = viableRuns.filter((r) => r.bottleneckBirthAfterViable).length;
        lines.push(
          `  viable-couple exposure among broken: ${viableYears}y across ${viableRuns.length}/${broken.length} runs`
          + ` · effective conception chance mean ${(100 * mean).toFixed(1)}% median ${(100 * median).toFixed(1)}%`
          + ` range ${(100 * chances[0]!).toFixed(1)}-${(100 * chances[chances.length - 1]!).toFixed(1)}%`
          + ` · later blood birth ${births}/${viableRuns.length}`,
        );
      }

      const allWardship = chronicler.filter((r) => (r.wardshipYears ?? 0) > 0).length;
      const brokenWardship = broken.filter((r) => (r.wardshipYears ?? 0) > 0).length;
      const overlapWardship = broken.filter((r) => (r.bottleneckWardshipYears ?? 0) > 0).length;
      lines.push(
        `  unbought wardship: ${allWardship}/${n} chronicler runs`
        + ` · ${brokenWardship}/${broken.length} broken lines`
        + ` · overlapped 1-2 blood in ${overlapWardship}/${broken.length}`,
      );
    }
  }

  // THE ASCENDANT COLUMN. Printed even at zero runs, so a caller who forgot
  // to supply it sees why the checks below never ran rather than a silently
  // skipped one.
  const aN = ascendant.length;
  const aCount = (id: EndingId) => ascendant.filter((r) => r.ending === id).length;
  const aApo = aCount('apotheosis');
  const aUnmade = aCount('unmade');
  const aShare = aN ? aApo / aN : 0;
  const aUnmadeShare = aN ? aUnmade / aN : 0;
  lines.push(
    `  ascendant (playing for the ladder): ${aN} runs`
    + (aN
      ? `  apotheosis ${aApo} (${(100 * aShare).toFixed(1)}%) · unmade ${aUnmade} (${(100 * aUnmadeShare).toFixed(1)}%)`
      : ' — none supplied'),
  );
  if (aN && ascendant.some((r) => r.templateFires)) {
    const offered = ascendant.reduce((n, r) => n + (r.templateFires?.the_unmaking ?? 0), 0);
    const elderYears = ascendant.reduce((n, r) => n + (r.unmakingElderYears ?? 0), 0);
    const pairYears = ascendant.reduce((n, r) => n + (r.unmakingPairYears ?? 0), 0);
    lines.push(`  ascendant Unmaking: elder ${elderYears} years · pair ${pairYears} years · offers ${offered}`);
    const circle = ascendant.filter((r) => (r.circlePairPeak ?? 0) >= affinitiesFor('god')).length;
    const circlePairPeak = Math.max(...ascendant.map((r) => r.circlePairPeak ?? 0));
    const circlePeak = Math.max(...ascendant.map((r) => r.circleAffinityPeak ?? 0));
    const circleMean = ascendant.reduce((n, r) => n + (r.circleAffinityPeak ?? 0), 0) / aN;
    const shelfEight = ascendant.filter((r) => (r.shelfAffinityPeak ?? 0) === 8).length;
    const lineageEight = ascendant.filter((r) => (r.lineageAffinityPeak ?? 0) === 8).length;
    const shelfPeak = Math.max(...ascendant.map((r) => r.shelfAffinityPeak ?? 0));
    const lineagePeak = Math.max(...ascendant.map((r) => r.lineageAffinityPeak ?? 0));
    const takers = ascendant.reduce((n, r) => n + (r.unmakingTakers ?? 0), 0);
    const peak = ascendant.reduce((max, r) => ({
      power: Math.max(max.power, r.unmakingTakerPeak?.power ?? 0),
      affinities: Math.max(max.affinities, r.unmakingTakerPeak?.affinities ?? 0),
      mind: Math.max(max.mind, r.unmakingTakerPeak?.mind ?? 0),
      madness: Math.max(max.madness, r.unmakingTakerPeak?.madness ?? 0),
    }), { power: 0, affinities: 0, mind: 0, madness: 0 });
    lines.push(`  ascendant circle: all four opposed pairs in ${circle}/${aN} runs; pair peak ${circlePairPeak}; raw affinity peak ${circlePeak}, mean peak ${circleMean.toFixed(1)}; Unmaking takers ${takers}`);
    lines.push(`  ascendant shelf: eight affinities in ${shelfEight}/${aN} runs (peak ${shelfPeak}); lineage ever taught eight in ${lineageEight}/${aN} (peak ${lineagePeak})`);
    const godBooks = GOD_READING_BOOKS;
    lines.push(`  ascendant living book peak: ${Math.max(...ascendant.map((r) => r.circleBookPeak ?? 0))}; ${godBooks} books in ${ascendant.filter((r) => (r.circleBookPeak ?? 0) >= godBooks).length}/${aN} runs`);
    if (takers) lines.push(`  ascendant taker peaks: power ${peak.power.toFixed(1)} · personal affinities ${peak.affinities} · mind ${peak.mind.toFixed(1)} · madness ${peak.madness.toFixed(1)}`);
    const demigodRuns = ascendant.filter((r) => (r.unmakingDemigodYears ?? 0) > 0).length;
    const waitRuns = ascendant.filter((r) => (r.unmakingLedgerWaitYears ?? 0) > 0).length;
    const demigodYears = ascendant.reduce((n, r) => n + (r.unmakingDemigodYears ?? 0), 0);
    const waitYears = ascendant.reduce((n, r) => n + (r.unmakingLedgerWaitYears ?? 0), 0);
    const peakRungs = ascendant.reduce((counts, r) => {
      const rung = r.unmakingTakerPeakRung ?? 'none';
      counts.set(rung, (counts.get(rung) ?? 0) + 1);
      return counts;
    }, new Map<Rung, number>());
    lines.push(`  ascendant recipient timing: Demigod+ in ${demigodRuns}/${aN} runs (${demigodYears}y) · waiting on Ledger in ${waitRuns}/${aN} (${waitYears}y)`);
    const attainers = ascendant.reduce((n, r) => n + (r.unmakingDemigodAttainers ?? 0), 0);
    const attainedRuns = ascendant.filter((r) => (r.unmakingAttainedYears ?? 0) > 0).length;
    const attainedYears = ascendant.reduce((n, r) => n + (r.unmakingAttainedYears ?? 0), 0);
    const belowRuns = ascendant.filter((r) => (r.unmakingAttainedBelowDemigodYears ?? 0) > 0).length;
    const belowYears = ascendant.reduce((n, r) => n + (r.unmakingAttainedBelowDemigodYears ?? 0), 0);
    lines.push(`  ascendant recipient persistence: ${attainers}/${takers} takers attained Demigod · alive after attainment in ${attainedRuns}/${aN} runs (${attainedYears}y) · below current Demigod afterwards in ${belowRuns}/${aN} (${belowYears}y)`);
    const searches = ascendant.reduce((n, r) => n + (r.ledgerSearches ?? 0), 0);
    lines.push(`  ascendant Ledger searches: ${searches} successful archival recoveries`);
    lines.push(`  ascendant recipient peak rung: ${[...peakRungs.entries()].map(([rung, count]) => `${rung} ${count}`).join(' · ')}`);
    const stages = ascendant[0]?.unmakingStageEver?.map((_, i) =>
      ascendant.filter((r) => r.unmakingStageEver?.[i]).length) ?? [];
    lines.push(`  ascendant taker joint gates (alive / power / books / circle / madness / mind / clauses / respect / God): ${stages.join(' / ')}`);
    const atomic = ascendant[0]?.unmakingGateEver?.map((_, i) =>
      ascendant.filter((r) => r.unmakingGateEver?.[i]).length) ?? [];
    lines.push(`  ascendant taker independent gates (power / books / circle / madness / mind / clauses / respect / God): ${atomic.join(' / ')}`);
    if (elderYears) {
      const totals = ascendant[0]?.unmakingFilterYears?.map((_, i) =>
        ascendant.reduce((n, r) => n + (r.unmakingFilterYears?.[i] ?? 0), 0)) ?? [];
      lines.push(`  ascendant pair filter-years: ${totals.join(' / ')}`);
      const gap = Math.max(...ascendant.map((r) => r.unmakingBestAffinityGap ?? Number.NEGATIVE_INFINITY));
      if (Number.isFinite(gap)) lines.push(`  best affinity gap after power comparison: ${gap}`);
    }
  }

  // VALIDITY FIRST, and at every sample size, over BOTH columns — a run that
  // reached the term with no ending is a broken measurement whichever policy
  // played it, and counting it as `forgotten` is how this file spent its
  // first batch confirming the issue's premise with a number it had invented.
  const bad = runs.filter((r) => !ALL_ENDINGS.includes(r.ending));
  if (bad.length) {
    lines.push(`  FAIL: ${bad.length} run(s) reached the term without an ending`);
    return { ok: false, lines };
  }

  const chronJudgeable = n >= ENDING_JUDGEABLE_BATCH;
  const ascJudgeable = aN >= ENDING_JUDGEABLE_BATCH;
  if (!chronJudgeable) {
    lines.push(`  (${n} chronicler runs cannot see a five-way distribution; nothing asserted but validity)`);
  }
  if (aN > 0 && !ascJudgeable) {
    lines.push(`  (${aN} ascendant runs cannot see whether apotheosis is reachable or the Unmade floor; nothing asserted)`);
  }
  if (!chronJudgeable) {
    return { ok: true, lines };
  }

  const failures: string[] = [];

  // The premise this issue was filed about: every house arriving at the same
  // place. One ending taking nearly everything is that state, whichever it is.
  for (const id of ALL_ENDINGS) {
    // God and Unmaking are intentional ladder outcomes. The chronicler column
    // grades the ordinary endings; their reach belongs to the ascendant column.
    if (id === 'apotheosis' || id === 'unmade') continue;
    if (count(id) / n < ENDING_FLOOR) {
      failures.push(`  FAIL: ${id} is below the floor (${count(id)} of ${n}, floor ${(100 * ENDING_FLOOR).toFixed(0)}%)`);
    }
  }

  if (brokenShare < BROKEN_LINE_BAND.low) {
    failures.push(
      `  FAIL: broken_line is too rare (${(100 * brokenShare).toFixed(1)}%, band opens at ${(100 * BROKEN_LINE_BAND.low).toFixed(0)}%)`,
    );
  }
  if (brokenShare > BROKEN_LINE_BAND.high) {
    failures.push(
      `  FAIL: broken_line is too common (${(100 * brokenShare).toFixed(1)}%, ceiling ${(100 * BROKEN_LINE_BAND.high).toFixed(0)}%)`,
    );
  }
  if (devouredShare > DEVOURED_CEILING) {
    failures.push(
      `  FAIL: devoured is too common (${(100 * devouredShare).toFixed(1)}%, ceiling ${(100 * DEVOURED_CEILING).toFixed(0)}%)`,
    );
  }

  // The owner's 8–29% band (#61, #332). The ceiling is judged; the 8% floor is
  // reported every run and never fails CI while the game is pre-production
  // (#332). Trying for the ladder must still beat the chronicler (#325).
  if (ascJudgeable) {
    lines.push(aShare >= APOTHEOSIS_TARGET_FLOOR
      ? `  apotheosis target (owner, #332): ${(100 * aShare).toFixed(1)}% is inside the 8–29% band`
      : `  apotheosis target (owner, #332): ${(100 * aShare).toFixed(1)}% is BELOW the 8% floor — reported, not judged, while pre-production`);
    if (aUnmadeShare < ENDING_FLOOR) {
      failures.push(`  FAIL: unmade is below the ascendant floor (${aUnmade} of ${aN}, floor ${(100 * ENDING_FLOOR).toFixed(0)}%)`);
    }
    if (aShare > APOTHEOSIS_CEILING) {
      failures.push(`  FAIL: apotheosis is above the ascendant ceiling (${(100 * aShare).toFixed(1)}%, ceiling ${(100 * APOTHEOSIS_CEILING).toFixed(0)}%)`);
    }
    // THE STATE THIS HALF OF THE ISSUE WAS FILED ABOUT: playing for the
    // ladder buying nothing. Judged on the Unmaking, not on Apotheosis, which
    // at 1 run in 100 no batch CI runs can carry (#325, owner's choice (c));
    // Apotheosis against the chronicler is printed beside it.
    const funnel = ascendantFunnelVerdict(chronicler, ascendant);
    lines.push(...funnel.lines);
    failures.push(...funnel.failures);
  }

  lines.push(...failures);
  return { ok: failures.length === 0, lines };
}

/** Raw evidence for one deterministic slice of the canonical paired endings sweep.
 * Workers compile the shared authored bundle once each, never once per run.
 * The partition identity and input indices let the reducer restore the exact
 * chronicler/ascendant order before the one aggregate verdict is evaluated.
 */
export function runEndingGatePartition(
  source: ContentBundle,
  partition: GatePartition<Pick<EndingRun, 'seed' | 'policy'>>,
  years: number,
): GatePartitionResult<EndingRun> {
  const content = indexContent(source);
  return {
    id: partition.id,
    observations: partition.items.map(({ index, input }) => ({
      index,
      value: playToTheEnd(content, input.seed, years, input.policy),
    })),
  };
}

export function gateEndings(
  source: Source = loadContent(),
  runs = ENDING_DEFAULT_BATCH,
  years = CAMPAIGN_YEARS,
  opts: { workers?: number } = {},
): EndingVerdict {
  const bundle = indexContent(source).bundle;
  // Fast fixture calls stay serial; the 512-pair nightly batch benefits from
  // the same bounded workers already exercised by blood and war gates.
  const workers = opts.workers ?? (runs >= 8 ? gatePartitionWorkerCount() : 1);
  const plan = partitionGateInputs(endingGateInputs(runs), workers);
  const results = plan.length === 1
    ? plan.map((partition) => runEndingGatePartition(bundle, partition, years))
    : runGatePartitionsInWorkers<Pick<EndingRun, 'seed' | 'policy'>, EndingRun>(plan, {
      moduleUrl: import.meta.url,
      exportName: 'runEndingGatePartition',
      argsBefore: [bundle],
      argsAfter: [years],
    });
  const played = reduceGatePartitions(plan, results);
  const v = verdictOver(played);
  return { ok: v.ok, lines: [`gate (endings): ${runs} played runs x ${years} years, per policy`, ...v.lines] };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('ending-gate.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? ENDING_DEFAULT_BATCH);
  const years = Number(process.argv[3] ?? CAMPAIGN_YEARS);
  const { ok, lines } = gateEndings(loadContent(), runs, years);
  console.log(lines.join('\n'));
  process.exit(ok ? 0 : 1);
}
