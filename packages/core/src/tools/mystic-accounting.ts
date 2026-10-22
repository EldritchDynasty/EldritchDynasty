/** Read-only cash/time ledger for #1866 A. No prices inferred from prose. */
import { ALL_AFFINITIES, canLearn, type AffinityName } from '@ed/schema';
import type { OutcomeObservation } from '../events/decisions.js';
import type { SimCtx } from '../world.js';
import type { TableOrder, OrderResult } from '../table.js';
import { observeFamilyChallenge } from './challenge-observation.js';

export function emptyMysticLedger() {
  return {
    sampledYears: 0, trainedHouseYears: 0, practitionerYears: 0,
    practitionerYearsByAffinity: Object.fromEntries(ALL_AFFINITIES.map(a => [a, 0])) as Record<AffinityName, number>,
    studyCommitmentYears: 0, studyingPersonYears: 0,
    challengeVisits: 0, learnedAttempts: 0, learnedSuccesses: 0, intervenedLearnedAttempts: 0,
    challengeTreasury: 0, normalChallengeTreasury: 0, primordialCoinDifference: 0,
    normalCheckAvoidedLoss: 0, unintervenedAvoidedLoss: 0, unpricedSuccessfulChecks: 0,
    costs: { auctionCoin: 0, eventBookCoin: 0, preparationCoin: 0, brokerCoin: 0, restorationCoin: 0 },
    bookPurchases: [] as { year: number; book: string; lot: string; coin: number; currency: string }[],
    nonCoinPurchases: 0,
  };
}
export type MysticLedger = ReturnType<typeof emptyMysticLedger>;

const treasury = (effects: OutcomeObservation['outcome']['effects']) => effects.reduce((total, effect) =>
  total + (effect.kind === 'treasury' ? effect.delta : 0), 0);

/** Count exposure at the start of an actual year, without realising genomes. */
export function sampleMysticYear(ctx: SimCtx, ledger: MysticLedger): void {
  const w = ctx.world;
  const family = w.people.household(w.playerHouse, w.year);
  let trained = 0;
  for (const p of family) {
    if (p.status !== 'alive') continue;
    const known = new Set(p.spellsKnown.flatMap(id => {
      const book = ctx.content.spellbook(id);
      return book && canLearn(p.sex, book.affinity) ? [book.affinity] : [];
    }));
    if (known.size) trained++;
    for (const affinity of known) ledger.practitionerYearsByAffinity[affinity]++;
  }
  ledger.sampledYears++;
  ledger.practitionerYears += trained;
  if (trained) ledger.trainedHouseYears++;
  const live = new Set(family.filter(p => p.status === 'alive').map(p => String(p.id)));
  const studies = w.studies.filter(s => live.has(s.person));
  ledger.studyCommitmentYears += studies.length;
  ledger.studyingPersonYears += new Set(studies.map(s => s.person)).size;
}

export function noteMysticOrder(ledger: MysticLedger, action: TableOrder, result: OrderResult, spent: number): void {
  if (!result.ok) return;
  if (action.kind === 'seekBook') ledger.costs.brokerCoin += spent;
  if (action.kind === 'restore') ledger.costs.restorationCoin += spent;
  // A bid is a promise, not payment. Auction receipts account for actual wins.
}

export function noteMysticOutcome(ctx: SimCtx, ledger: MysticLedger, observation: OutcomeObservation): void {
  const { event, outcome, selectedOutcome } = observation;
  const coin = treasury(outcome.effects);
  const familyChallenge = event.tags.includes('family_challenge');
  const row = familyChallenge ? observeFamilyChallenge(ctx, observation) : undefined;
  if (familyChallenge) {
    ledger.challengeVisits++;
    ledger.challengeTreasury += coin;
    ledger.normalChallengeTreasury += treasury(selectedOutcome.effects);
    ledger.primordialCoinDifference += coin - treasury(selectedOutcome.effects);
    // Paid preparation has no check; count its whole cash price once, even
    // when the same outcome also acquires the primer and begins its study.
    if (!row) ledger.costs.preparationCoin += Math.max(0, -coin);
  }
  if (!(familyChallenge && !row) && outcome.effects.some(e => e.kind === 'spellbook'
    && (e.op === 'acquire_copy' || e.op === 'gain' || e.op === 'study'))) {
    ledger.costs.eventBookCoin += Math.max(0, -coin);
  }
  if (!row?.affinity || (row.pool !== 'family_knows' && row.pool !== 'slot')) return;
  ledger.learnedAttempts++;
  if (row.intervened) ledger.intervenedLearnedAttempts++;
  if (!row.passed) return;
  ledger.learnedSuccesses++;
  // Bounded comparison: the SAME authored choice's lowest check band, not
  // a second campaign and not an assertion about its downstream treasury.
  const check = event.checks.find(c => c.id === row.check);
  const failedBand = check?.bands.filter(b => b.atLeast < 0).sort((a, b) => a.atLeast - b.atLeast)[0];
  const choice = event.interaction.kind === 'narration' ? undefined
    : event.interaction.choices.find(c => c.id === observation.choiceId);
  const failure = failedBand && choice?.outcomes.find(o => o.id === failedBand.outcome);
  if (!failure) { ledger.unpricedSuccessfulChecks++; return; }
  const avoided = treasury(selectedOutcome.effects) - treasury(failure.effects);
  ledger.normalCheckAvoidedLoss += avoided;
  if (!row.intervened) ledger.unintervenedAvoidedLoss += avoided;
}

export function attachMysticLedger(ctx: SimCtx, ledger: MysticLedger): void {
  const previous = ctx.observeOutcome;
  ctx.observeOutcome = observation => {
    previous?.(observation);
    noteMysticOutcome(ctx, ledger, observation);
  };
  const previousPurchase = ctx.observeBookPurchase;
  ctx.observeBookPurchase = purchase => {
    previousPurchase?.(purchase);
    ledger.costs.auctionCoin += purchase.coin;
    if (purchase.currency !== 'coin') ledger.nonCoinPurchases++;
    ledger.bookPurchases.push({ year: ctx.world.year, ...purchase });
  };
}

export function mysticPayback(ledger: MysticLedger) {
  const cost = Object.values(ledger.costs).reduce((a, b) => a + b, 0);
  return {
    pricedCoinCosts: cost,
    normalCheckNetCoin: ledger.normalCheckAvoidedLoss - cost,
    unintervenedCheckNetCoin: ledger.unintervenedAvoidedLoss - cost,
    // This is a coin ledger, never a net present value of the whole Library.
    unpricedStudyPersonYears: ledger.studyingPersonYears,
    unpricedNonCoinPurchases: ledger.nonCoinPurchases,
  };
}
