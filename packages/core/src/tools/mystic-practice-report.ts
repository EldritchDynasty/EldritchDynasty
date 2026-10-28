/** #1942: fixed-seed policy ablations. Never a replacement gate or an optimized oracle.
 * tsx --tsconfig tsconfig.base.json <file> runs seedBase output.json ordinary|hostile variant[,variant...] [historical.json]
 * `historical` repeats all original columns with the additional inert funnel.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { canonical, saveGame } from '../save.js';
import { replay } from '../replay.js';
import { expectMean } from '../testing.js';
import { meanEvidence } from './mystic-baseline.js';
import { createPracticePolicy, PRACTICE_VARIANTS, type PracticeVariant } from './mystic-practice-policy.js';
import { playRepertoireCampaign, REPERTOIRE_POLICIES } from './mystic-repertoire-report.js';

type Run = ReturnType<typeof playRepertoireCampaign>;
export type PracticeRun = Run & { variant: PracticeVariant | typeof REPERTOIRE_POLICIES[number] };

export function usefulDomainsPerGeneration(run: Pick<Run, 'metrics'>): number {
  const generations = run.metrics.trainedGenerations;
  if (!generations.length) return 0;
  return generations.reduce((n, generation) => n + new Set((run.metrics.usefulDomains[generation] ?? [])
    .map(d => d.startsWith('estate:') ? 'estate_protection' : d)).size, 0) / generations.length;
}

export function comparePractice(runs: readonly PracticeRun[], historical: readonly Run[]) {
  return (['short', 'long'] as const).flatMap(campaign => [...new Set(runs.map(r => r.variant))].map(variant => {
    const rows = runs.filter(r => r.campaign === campaign && r.variant === variant);
    if (!rows.length) return undefined;
    const controls = new Map(historical.filter(r => r.campaign === campaign && r.policy === 'broad').map(r => [r.seed, r]));
    const budgeted = new Map(runs.filter(r => r.campaign === campaign && r.variant === 'budgeted_broad').map(r => [r.seed, r]));
    const paired = (control: Map<number, Run>, read: (r: Run) => number) => rows.map(row => {
      const other = control.get(row.seed);
      if (!other) throw Error(`Missing paired ${campaign}/${row.seed} control`);
      return read(row) - read(other);
    });
    const differences = controls.size ? paired(controls, usefulDomainsPerGeneration) : [];
    const bar = (values: number[], floor: number) => {
      try { return { supported: true, marginSE: expectMean({ values, floor, what: '#1942 declared useful domains per trained generation' }) }; }
      catch (error) { return { supported: false, reason: (error as Error).message }; }
    };
    const estimate = (read: (r: Run) => number) => meanEvidence(rows.map(read));
    const records = rows.flatMap(r => Object.values(r.metrics.records));
    return { campaign, variant, n: rows.length,
      usefulDomainsPerTrainedGeneration: estimate(usefulDomainsPerGeneration),
      noTrainedGeneration: rows.filter(r => !r.metrics.trainedGenerations.length).length,
      pairedHistoricalBroad: meanEvidence(differences), improvement: bar(differences, 0),
      pairedBudgetedBroad: budgeted.size ? meanEvidence(paired(budgeted, usefulDomainsPerGeneration)) : undefined,
      twoDomainGoal: bar(rows.filter(r => r.metrics.trainedGenerations.length).map(usefulDomainsPerGeneration), 2),
      firstUse: { duties: records.length, observed: records.filter(d => d.service.firstUsefulAt !== undefined).length,
        censoredBefore10: records.filter(d => d.service.firstUsefulAt === undefined && d.service.servedYears < 10).length,
        noUseAfter10: records.filter(d => d.service.firstUsefulAt === undefined && d.service.servedYears >= 10).length,
        observedPaidYears: meanEvidence(records.flatMap(d => d.service.firstUsefulAt === undefined ? [] : [d.service.firstUsefulAt])) },
      paidDutyYears: estimate(r => r.metrics.paidDutyYears), pausedStudyYears: estimate(r => r.metrics.pausedStudyYears),
      studyPersonYears: estimate(r => r.ledger.studyingPersonYears), directSavings: estimate(r => r.coin.directSavings),
      yieldCoinEstimate: estimate(r => r.coin.yieldEstimate), serviceSpent: estimate(r => r.coin.serviceSpent),
      acquisition: estimate(r => r.coin.acquisition), outsideFees: estimate(r => r.coin.externalFees),
      commissionIncome: estimate(r => r.coin.commissionIncome), attributedCoin: estimate(r => r.coin.netAttributed),
      livesKept: estimate(r => r.livesKept), menKept: estimate(r => r.menKept), studyYearsKept: estimate(r => r.studyYearsKept),
      promisesBroken: estimate(r => r.contracts.broken), promisesHonoured: estimate(r => r.contracts.honoured),
      blood: estimate(r => r.blood), treasury: estimate(r => r.treasury), population: estimate(r => r.population),
      pairedTreasury: controls.size ? meanEvidence(paired(controls, r => r.treasury)) : undefined,
      pairedBlood: controls.size ? meanEvidence(paired(controls, r => r.blood)) : undefined,
      endings: rows.map(r => ({ seed: r.seed, ending: r.ending, ascension: r.ascension })),
      decisionsPer25Years: estimate(r => r.decisionLoad.total / Math.max(1, r.years) * 25),
      refused: estimate(r => r.metrics.refused), budgets: rows.map(r => ({ seed: r.seed, ...r.budget })),
    };
  })).filter(r => r !== undefined);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-practice-report.ts')) {
  const n = Number(process.argv[2] ?? 24), seedBase = Number(process.argv[3] ?? 187700);
  const output = process.argv[4], scenario = process.argv[5] ?? 'ordinary', requested = process.argv[6] ?? 'demand_aware';
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(seedBase) || !output) throw Error('Expected runs, integer seed and output path');
  if (scenario !== 'ordinary' && scenario !== 'hostile') throw Error('Expected ordinary or hostile');
  const historical: Run[] = process.argv[7] ? JSON.parse(readFileSync(process.argv[7], 'utf8')).samples : [];
  const variants = requested === 'historical' ? REPERTOIRE_POLICIES : requested.split(',').map(name => {
    const variant = PRACTICE_VARIANTS.find(v => v === name);
    if (!variant) throw Error(`Unknown practice variant: ${name}`);
    return variant;
  });
  const content = loadContent(), samples: PracticeRun[] = [];
  const controls: { campaign: string; variant: string; seed: number; observerEqual?: boolean;
    continuation?: Run['continuation']; replayEqual?: boolean }[] = [];
  const hashes = Object.fromEntries(['mystic-practice-report.ts', 'mystic-practice-policy.ts', 'mystic-practice-funnel.ts', 'mystic-repertoire-report.ts']
    .map(file => [file, createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')]));
  const contentHash = createHash('sha256').update(canonical(content.bundle)).digest('hex');
  const persist = () => writeFileSync(output, JSON.stringify({ seedBase, runsPerColumn: n, scenario, hashes, contentHash,
    complete: samples.length === n * variants.length * 2, controls, summary: comparePractice(samples, historical), samples }, null, 2) + '\n');
  for (const campaign of ['short', 'long'] as const) for (const variant of variants) for (let i = 0; i < n; i++) {
    const experimental = PRACTICE_VARIANTS.find(v => v === variant);
    const policy = REPERTOIRE_POLICIES.find(p => p === variant) ?? 'broad';
    const options = () => ({ funnel: true, strictBudget: Boolean(experimental),
      practice: experimental ? createPracticePolicy(experimental) : undefined,
      retainSave: i === 0, verifyContinuation: i === 0 });
    const run = playRepertoireCampaign(content, seedBase + i, campaign, policy, true, scenario, options());
    const old = historical.find(r => r.seed === run.seed && r.campaign === campaign && r.policy === policy);
    if (!experimental && old && run.fullSaveHash !== old.fullSaveHash) throw Error(`Additional funnel changed historical save: ${campaign}/${variant}/${run.seed}`);
    if (i === 0 || variant === 'demand_aware') {
      const unobserved = playRepertoireCampaign(content, run.seed, campaign, policy, false, scenario, options());
      const equal = run.fullSaveHash === unobserved.fullSaveHash;
      controls.push({ campaign, variant, seed: run.seed, observerEqual: equal, continuation: run.continuation });
      if (!equal) throw Error(`Observer changed full save: ${campaign}/${variant}/${run.seed}`);
    }
    if (run.saved) {
      const rebuilt = replay(content, run.saved.decisionLog, run.seed, 1042, run.years, campaign, [], { origin: run.saved.replayOrigin });
      const equal = canonical({ ...saveGame(rebuilt), savedAt: '' }) === canonical({ ...run.saved, savedAt: '' });
      controls.push({ campaign, variant, seed: run.seed, replayEqual: equal });
      if (!equal) throw Error(`Replay changed full save: ${campaign}/${variant}/${run.seed}`);
      delete run.saved;
    }
    samples.push({ ...run, variant }); persist();
    process.stderr.write(`${scenario}/${campaign}/${variant}: ${i + 1}/${n}\n`);
  }
  persist();
  process.stdout.write(JSON.stringify({ contentHash, controls, summary: comparePractice(samples, historical) }, null, 2) + '\n');
}
