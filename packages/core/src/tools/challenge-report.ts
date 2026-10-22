/** Paired, playable family-challenge strategies (#1813).
 *
 * npm run gate:challenges -- [runs=64] [seedBase=181300] [output.json]
 *
 * The two deliberate houses use the same inward marriage order and at most
 * one extra Table order per year. Narrow favours Death/Darkness; broad rotates
 * all affinities. Choices use recorded evidence only. Inherited affinities
 * are measured afterwards on private copies, never used to choose a spouse.
 * Automatic study remains enabled in every column.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadContent } from '@ed/content';
import { ALL_AFFINITIES, type AffinityName, type Content } from '@ed/schema';
import { campaignDef } from '../campaign.js';
import { closeTheLedger } from '../ending.js';
import { autoResolveDecision, resolveMatch } from '../events/decisions.js';
import { autoTakeCard } from '../people/match.js';
import { streamFor } from '../rng.js';
import { digest, saveGame } from '../save.js';
import { viewOf } from '../session.js';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { order, tableView, type TableOrder, type OrderResult } from '../table.js';
import type { SimCtx } from '../world.js';
import { stepYear } from '../year/step.js';
import { CHALLENGE_FAILURES, observeFamilyChallenge, recordedAffinityScore, type ChallengeObservation } from './challenge-observation.js';

export type ChallengePolicy = 'chronicler' | 'narrow' | 'broad';
type Policy = ChallengePolicy;
export interface ChallengeRunObserver {
  start?: (ctx: SimCtx) => void;
  beforeYear?: (ctx: SimCtx) => void;
  afterYear?: (ctx: SimCtx) => void;
  order?: (ctx: SimCtx, order: TableOrder, result: OrderResult, spent: number) => void;
}
const POLICIES: readonly Policy[] = ['chronicler', 'narrow', 'broad'];
const NARROW: readonly AffinityName[] = ['death', 'darkness'];
export function playChallengeRun(content: Content, seed: number, campaign: 'short' | 'long', policy: Policy,
  observe = true, observer?: ChallengeRunObserver) {
  const def = campaignDef(campaign);
  const ctx = bootstrap(content, seed, def.startYear, campaign);
  const w = ctx.world;
  const checks: ChallengeObservation[] = [];
  const exposure: Record<string, number> = {};
  const exposureYears = new Set<number>();
  const treatment = { studyOrders: 0, studyByAffinity: {} as Record<string, number>,
    studyYearsWithoutReader: 0, studyYearsWithoutShelf: 0,
    bookSearches: 0, bookBids: 0,
    matchHands: 0, evidenceHands: 0, changedMatches: 0, refusedMatches: 0 };
  if (observe) ctx.observeOutcome = (observation) => {
    if (!observation.event.tags.includes('family_challenge')) return;
    exposureYears.add(w.year);
    exposure[observation.event.id] = (exposure[observation.event.id] ?? 0) + 1;
    const checked = observeFamilyChallenge(ctx, observation);
    if (checked) checks.push(checked);
  };
  if (observe) observer?.start?.(ctx);
  const send = (action: TableOrder) => {
    const before = w.treasury;
    const result = order(ctx, action);
    if (observe) observer?.order?.(ctx, action, result, before - w.treasury);
    return result;
  };
  if (policy !== 'chronicler') send({ kind: 'marriages', policy: 'in' });

  for (let elapsed = 0; elapsed < def.years && !w.ending && w.year < def.endYear; elapsed++) {
    if (policy !== 'chronicler') {
      const table = tableView(ctx);
      const focus = policy === 'narrow' ? NARROW : ALL_AFFINITIES;
      const offset = elapsed % focus.length;
      const priorities = [...focus.slice(offset), ...focus.slice(0, offset)];
      // Use the paid broker and auction. Only bid when twice the reserve
      // fits the current treasury; the house bids at most 1.5 times reserve.
      const wantedLot = table.auction?.items.find((lot) => lot.kind === 'spellbook' && !lot.bid
        && content.spellbooks.some((book) => book.name === lot.name && priorities.includes(book.affinity))
        && lot.reserve * 2 <= table.treasury);
      const missing = table.missingPrimers.filter((book) => priorities.includes(book.affinity as AffinityName)
        && !book.queued && book.canPay && book.fee + book.reserve * 2 <= table.treasury)
        .sort((a, b) => priorities.indexOf(a.affinity as AffinityName) - priorities.indexOf(b.affinity as AffinityName))[0];
      let usedOrder = false;
      if (wantedLot && send({ kind: 'lotBid', lot: wantedLot.id,
        bid: { currency: 'coin', amount: Math.round(wantedLot.reserve * 1.5) } }).ok) {
        treatment.bookBids++;
        usedOrder = true;
      } else if (elapsed % 12 === 0 && missing && send({ kind: 'seekBook', book: missing.book }).ok) {
        treatment.bookSearches++;
        usedOrder = true;
      }
      const busy = new Set(table.studying.map((study) => study.person));
      const shelves = table.shelf.filter((shelf) => priorities.includes(content.spellbook(shelf.book)!.affinity));
      const options = shelves.flatMap((shelf) => shelf.readers.filter((reader) => !busy.has(reader.person))
        .map((reader) => ({ book: shelf.book, person: reader.person, affinity: content.spellbook(shelf.book)!.affinity })));
      options.sort((a, b) => priorities.indexOf(a.affinity) - priorities.indexOf(b.affinity)
        || a.book.localeCompare(b.book) || a.person.localeCompare(b.person));
      const next = options[0];
      if (!usedOrder && next && send({ kind: 'study', person: next.person, book: next.book }).ok) {
        treatment.studyOrders++;
        treatment.studyByAffinity[next.affinity] = (treatment.studyByAffinity[next.affinity] ?? 0) + 1;
      } else if (!usedOrder && !shelves.length) treatment.studyYearsWithoutShelf++;
      else if (!usedOrder) treatment.studyYearsWithoutReader++;
    }
    if (observe) observer?.beforeYear?.(ctx);
    stepYear(ctx, false);
    const rng = streamFor(w, 'chronicler');
    let guard = 0;
    while (w.pendingDecisions.length && guard++ < 200) {
      const decision = w.pendingDecisions[0]!;
      if (decision.kind === 'match' && policy !== 'chronicler') {
        treatment.matchHands++;
        const visible = viewOf(ctx, 0);
        const focus = policy === 'narrow' ? NARROW : ALL_AFFINITIES;
        const ranked = decision.cards.filter((card) => card.available)
          .map((card) => ({ card, score: recordedAffinityScore(visible, card, focus) }))
          .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
        const best = ranked[0];
        if (best && best.score > 0) {
          treatment.evidenceHands++;
          const isScion = w.scion === decision.subject.id || w.scionHeir === decision.subject.id;
          const automatic = autoTakeCard(decision.cards, decision.id, decision.year, w.treasury, isScion);
          // Preserve the chronicler's tie-break whenever it shares the top score.
          const chosen = ranked.find((row) => row.card.id === automatic?.id && row.score === best.score)?.card ?? best.card;
          if (resolveMatch(ctx, decision.id, chosen.id).ok) {
            if (chosen.id !== automatic?.id) treatment.changedMatches++;
            continue;
          }
          treatment.refusedMatches++;
        }
      }
      autoResolveDecision(ctx, decision, rng);
    }
    if (w.pendingDecisions.length) throw new Error(`Unresolved docket: ${seed}/${campaign}/${policy}/${w.year}`);
    clearNamingQueue(ctx);
    if (observe) observer?.afterYear?.(ctx);
  }
  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  const saved = saveGame(ctx);
  return { seed, campaign, policy, years: w.year - def.startYear, ending: w.ending?.id,
    fingerprint: digest(saved),
    completeSaveHash: createHash('sha256').update(JSON.stringify({ ...saved, savedAt: '' })).digest('hex'),
    treatment, exposure, exposureYears: [...exposureYears], checks };
}

type Run = ReturnType<typeof playChallengeRun>;
export function summariseChallengeRuns(runs: Run[]) {
  return (['short', 'long'] as const).flatMap((campaign) => POLICIES.map((policy) => {
    const column = runs.filter((run) => run.campaign === campaign && run.policy === policy);
    const checks = column.flatMap((run) => run.checks);
    const failure = checks.filter((check) => !check.passed);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort()
      .map((key) => [key, values.filter((value) => value === key).length]));
    const effects = (rows: ChallengeObservation[]) => ({ treasury: sum(rows.map((row) => row.treasury)),
      respect: sum(rows.map((row) => row.respect)), health: sum(rows.flatMap((row) => row.health.map((effect) => effect.delta))) });
    return { campaign, policy, runs: column.length, seeds: column.map((run) => run.seed),
      years: sum(column.map((run) => run.years)), exposure: sum(column.flatMap((run) => Object.values(run.exposure))),
      runsExposed: column.filter((run) => run.exposureYears.length > 0).length,
      yearsExposed: sum(column.map((run) => run.exposureYears.length)),
      checks: checks.length, passed: checks.length - failure.length, failures: failure.length,
      causes: count(failure.map((row) => row.cause!)),
      consequencesByCause: Object.fromEntries(CHALLENGE_FAILURES.map((cause) => {
        const rows = failure.filter((row) => row.cause === cause);
        return [cause, { failures: rows.length, shareOfChecks: checks.length ? rows.length / checks.length : 0,
          shareOfFailures: failure.length ? rows.length / failure.length : 0, effects: effects(rows) }];
      })),
      failureEffects: effects(failure), allEffects: effects(checks),
      studyOrders: sum(column.map((run) => run.treatment.studyOrders)),
      bookSearches: sum(column.map((run) => run.treatment.bookSearches)),
      bookBids: sum(column.map((run) => run.treatment.bookBids)),
      studyByAffinity: Object.fromEntries(ALL_AFFINITIES.map((affinity) => [affinity,
        sum(column.map((run) => run.treatment.studyByAffinity[affinity] ?? 0))])),
      studyYearsWithoutReader: sum(column.map((run) => run.treatment.studyYearsWithoutReader)),
      studyYearsWithoutShelf: sum(column.map((run) => run.treatment.studyYearsWithoutShelf)),
      matchHands: sum(column.map((run) => run.treatment.matchHands)),
      evidenceHands: sum(column.map((run) => run.treatment.evidenceHands)),
      changedMatches: sum(column.map((run) => run.treatment.changedMatches)),
      checksByEvent: Object.fromEntries([...new Set(checks.map((row) => `${row.event}/${row.check}`))].sort().map((key) => {
        const rows = checks.filter((row) => `${row.event}/${row.check}` === key);
        const lost = rows.filter((row) => !row.passed);
        return [key, { checks: rows.length, passed: rows.length - lost.length,
          causes: count(lost.map((row) => row.cause!)), failureEffects: effects(lost),
          inheritedAtExposure: sum(rows.map((row) => row.affinity?.inherited ?? 0)),
          capableAtExposure: sum(rows.map((row) => row.affinity?.capable ?? 0)),
          awakeAtExposure: sum(rows.map((row) => row.affinity?.awake ?? 0)),
          learnedAtExposure: sum(rows.map((row) => row.affinity?.learned ?? 0)) }];
      })),
    };
  }));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/challenge-report.ts')) {
  const runs = Number(process.argv[2] ?? 64);
  const seedBase = Number(process.argv[3] ?? 181300);
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) throw new Error('Expected positive runs and integer seed base');
  const content = loadContent();
  const samples: Run[] = [];
  for (const campaign of ['short', 'long'] as const) {
    for (const policy of POLICIES) {
      for (let i = 0; i < runs; i++) {
        samples.push(playChallengeRun(content, seedBase + i, campaign, policy));
        if ((i + 1) % 8 === 0) process.stderr.write(`${campaign}/${policy}: ${i + 1}/${runs}\n`);
      }
    }
  }
  const report = { seedBase, runsPerColumn: runs,
    method: { campaigns: '300/500 years, stopping at the actual ending; same seeds across columns',
      ordinary: 'chronicler chooses actual branches and parties; normal automatic study remains enabled',
      deliberate: 'inward marriage order; one extra Table order/year; paid searches; bids of 1.5 reserves only when two reserves fit current treasury',
      narrow: 'Death/Darkness study and Match ranking', broad: 'rotate all eight study affinities; favour total recorded affinity',
      causes: 'observed before effects; a missing basic working is knowledge, a weak compound/core pool is ability; current-attribute book thresholds and inherited affinity are separate',
      consequences: 'authored signed treasury/Respect/Health deltas, actual cast names and rendered chronicle; preparation purchases are exposures without a check' },
    summary: summariseChallengeRuns(samples).filter((column) => column.runs), samples };
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report.summary, null, 2) + '\n');
}
