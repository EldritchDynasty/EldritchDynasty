/** #1866 A: npm run gate:mystic -- [runs=64] [seedBase=186600] [output.json]
 * Reuses #1813's actual playable policies and #1830's learned-check observer.
 * Descriptive baseline, not a new balance gate or a simulation policy.
 */
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import type { Content } from '@ed/schema';
import { livingBlood } from '../ending.js';
import { playChallengeRun, type ChallengePolicy } from './challenge-report.js';
import { attachMysticLedger, emptyMysticLedger, mysticPayback, noteMysticOrder, sampleMysticYear } from './mystic-accounting.js';

export function playMysticBaseline(content: Content, seed: number, campaign: 'short' | 'long', policy: ChallengePolicy,
  observed = true) {
  const ledger = emptyMysticLedger();
  const run = playChallengeRun(content, seed, campaign, policy, observed, {
    start: ctx => attachMysticLedger(ctx, ledger),
    beforeYear: ctx => { if (livingBlood(ctx.world) > 0) sampleMysticYear(ctx, ledger); },
    order: (_ctx, action, result, spent) => noteMysticOrder(ledger, action, result, spent),
  });
  return { ...run, ledger, payback: mysticPayback(ledger) };
}

/** Independent-house uncertainty, never treating repeated visits as trials. */
export function meanEvidence(values: readonly number[]) {
  const n = values.length;
  if (!n) return { n, mean: null, standardError: null, min: null, max: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : null;
  return { n, mean, standardError: variance === null ? null : Math.sqrt(variance / n),
    min: Math.min(...values), max: Math.max(...values) };
}

type Run = ReturnType<typeof playMysticBaseline>;
export function summariseMysticBaseline(runs: readonly Run[]) {
  return (['short', 'long'] as const).flatMap(campaign => (['chronicler', 'narrow', 'broad'] as const).map(policy => {
    const rows = runs.filter(r => r.campaign === campaign && r.policy === policy);
    const sum = (read: (r: Run) => number) => rows.reduce((total, row) => total + read(row), 0);
    const estimate = (read: (r: Run) => number) => meanEvidence(rows.map(read));
    return {
      campaign, policy, runs: rows.length,
      livedYears: sum(r => r.years),
      exposedHouses: sum(r => Number(r.ledger.challengeVisits > 0)),
      trainedHouses: sum(r => Number(r.ledger.trainedHouseYears > 0)),
      successfulLearnedHouses: sum(r => Number(r.ledger.learnedSuccesses > 0)),
      exposedHouseFraction: estimate(r => Number(r.ledger.challengeVisits > 0)),
      trainedHouseFraction: estimate(r => Number(r.ledger.trainedHouseYears > 0)),
      learnedSuccessHouseFraction: estimate(r => Number(r.ledger.learnedSuccesses > 0)),
      learnedAttempts: sum(r => r.ledger.learnedAttempts),
      learnedSuccesses: sum(r => r.ledger.learnedSuccesses),
      intervenedLearnedAttempts: sum(r => r.ledger.intervenedLearnedAttempts),
      estimates: {
        visits: estimate(r => r.ledger.challengeVisits),
        practitionerYears: estimate(r => r.ledger.practitionerYears),
        trainedHouseYears: estimate(r => r.ledger.trainedHouseYears),
        studyPersonYears: estimate(r => r.ledger.studyingPersonYears),
        normalCheckAvoidedLoss: estimate(r => r.ledger.normalCheckAvoidedLoss),
        unintervenedAvoidedLoss: estimate(r => r.ledger.unintervenedAvoidedLoss),
        pricedCoinCosts: estimate(r => r.payback.pricedCoinCosts),
        normalCheckNetCoin: estimate(r => r.payback.normalCheckNetCoin),
        unintervenedCheckNetCoin: estimate(r => r.payback.unintervenedCheckNetCoin),
        challengeTreasury: estimate(r => r.ledger.challengeTreasury),
        primordialCoinDifference: estimate(r => r.ledger.primordialCoinDifference),
      },
      costs: Object.fromEntries(Object.keys(emptyMysticLedger().costs).map(key => [key,
        estimate(r => r.ledger.costs[key as keyof Run['ledger']['costs']])])),
      nonCoinPurchases: sum(r => r.ledger.nonCoinPurchases),
      unpricedSuccessfulChecks: sum(r => r.ledger.unpricedSuccessfulChecks),
    };
  })).filter(column => column.runs);
}

export function pairedMysticBaseline(runs: readonly Run[]) {
  return (['short', 'long'] as const).flatMap(campaign => (['narrow', 'broad'] as const).map(policy => {
    const controls = new Map(runs.filter(r => r.campaign === campaign && r.policy === 'chronicler').map(r => [r.seed, r]));
    const pairs = runs.filter(r => r.campaign === campaign && r.policy === policy).map(run => {
      const control = controls.get(run.seed);
      if (!control) throw new Error(`Missing paired control ${campaign}/${run.seed}`);
      return { run, control };
    });
    return { campaign, policy, pairs: pairs.length,
      normalCheckNetCoinDifference: meanEvidence(pairs.map(({ run, control }) => run.payback.normalCheckNetCoin - control.payback.normalCheckNetCoin)),
      studyPersonYearsDifference: meanEvidence(pairs.map(({ run, control }) => run.ledger.studyingPersonYears - control.ledger.studyingPersonYears)),
      visitsDifference: meanEvidence(pairs.map(({ run, control }) => run.ledger.challengeVisits - control.ledger.challengeVisits)),
    };
  }));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-baseline.ts')) {
  const runs = Number(process.argv[2] ?? 64);
  const seedBase = Number(process.argv[3] ?? 186600);
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) throw new Error('Expected positive runs and integer seed base');
  const content = loadContent();
  const samples: Run[] = [];
  const controls: { seed: number; campaign: string; policy: string; fullSaveEqual: boolean; hash: string }[] = [];
  for (const campaign of ['short', 'long'] as const) {
    for (const policy of ['chronicler', 'narrow', 'broad'] as const) {
      for (let i = 0; i < runs; i++) {
        const sample = playMysticBaseline(content, seedBase + i, campaign, policy);
        samples.push(sample);
        // Two fixed controls per column, declared before inspecting results.
        if (i < Math.min(2, runs)) {
          const plain = playMysticBaseline(content, seedBase + i, campaign, policy, false);
          const equal = sample.completeSaveHash === plain.completeSaveHash;
          controls.push({ seed: seedBase + i, campaign, policy, fullSaveEqual: equal, hash: sample.completeSaveHash });
          if (!equal) throw new Error(`Observer changed saved run: ${campaign}/${policy}/${seedBase + i}`);
        }
        if ((i + 1) % 8 === 0) process.stderr.write(`${campaign}/${policy}: ${i + 1}/${runs}\n`);
      }
    }
  }
  const report = { seedBase, runsPerColumn: runs,
    method: {
      policy: '#1813 playChallengeRun, unchanged marriage/study/broker/bid decisions; all columns retain ordinary automatic study',
      years: 'actual Short300 and Long500, stopping on real endings; early endings and zero-exposure houses retained',
      readerYears: 'living household readers at start of each actual year; knowledge only, not assignment or availability',
      cash: 'actual successful auction payments (including automatic bids), successful broker/binder orders, negative cash bundles that acquire/study a book, and paid challenge preparation counted once',
      payback: 'same selected learned check versus its authored failure band, before primordial response, less priced costs; unintervened column excludes all intervened successes',
      limits: 'not total Library ROI or causal final treasury; all Library acquisition costs charged to this narrow use, other book benefits excluded; noncoin prices and study opportunity years unpriced; no passive effects, wards or duties shipped in this baseline',
      uncertainty: 'means and standard errors across independent houses; paired differences on identical seeds, not independent-visit binomial intervals',
      controls: 'first two seeds of every column replayed without any observers; SHA256 over the complete SavedGame with only savedAt blanked',
    },
    summary: summariseMysticBaseline(samples), paired: pairedMysticBaseline(samples), controls, samples,
  };
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ summary: report.summary, paired: report.paired, controls }, null, 2) + '\n');
}
