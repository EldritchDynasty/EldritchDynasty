/** #1942: fixed-seed policy ablations. Never a replacement gate or an optimized oracle.
 * tsx --tsconfig tsconfig.base.json <file> runs seedBase output.json ordinary|hostile variant[,variant...] [historical.json]
 * `historical` repeats all original columns with the additional inert funnel.
 * A single original policy (`no_extra`, `narrow`, `broad`) can be funnelled separately.
 * `observer_controls` repeats every original scenario without observers; requires historical.json.
 * --summarise historical.json output.json columns.json [...] reduces completed matched columns.
 * Optional eighth argument for experimental columns: checkpoint.json (use - for no historical input).
 * Experimental columns collect the existing service/working metrics; --funnel adds the full annual supply funnel.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadContent } from '@ed/content';
import { canonical, saveGame } from '../save.js';
import { replay } from '../replay.js';
import { expectMean } from '../testing.js';
import { meanEvidence } from './mystic-baseline.js';
import { usefulDomainsPerGeneration } from './mystic-accounting.js';
import { createPracticePolicy, PRACTICE_VARIANTS, type PracticeVariant } from './mystic-practice-policy.js';
import { playRepertoireCampaign, REPERTOIRE_POLICIES } from './mystic-repertoire-report.js';

type Run = ReturnType<typeof playRepertoireCampaign>;
export type PracticeRun = Run & { variant: PracticeVariant | typeof REPERTOIRE_POLICIES[number]; sourceHashes?: Record<string, string> };

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

/** Reduce completed columns without replaying them or silently changing a denominator. */
function reduceReports(historicalPath: string, output: string, paths: string[]): void {
  if (!historicalPath || !output || !paths.length) throw Error('Expected --summarise historical.json output.json columns.json [...]');
  const historical = JSON.parse(readFileSync(historicalPath, 'utf8')) as { samples: Run[]; runsPerColumn: number; seedBase: number; scenario: string; contentHash: string };
  const samples: PracticeRun[] = [];
  const controls: unknown[] = [], sources = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const bytes = readFileSync(path, 'utf8');
    const report = JSON.parse(bytes) as { complete: boolean; samples: PracticeRun[]; controls: unknown[];
      seedBase: number; runsPerColumn: number; scenario: string; contentHash: string; hashes: Record<string, string> };
    if (!report.complete) throw Error(`Incomplete column: ${path}`);
    if (report.seedBase !== historical.seedBase || report.runsPerColumn !== historical.runsPerColumn
      || report.scenario !== historical.scenario || report.contentHash !== historical.contentHash) throw Error(`Unmatched protocol/content: ${path}`);
    for (const variant of new Set(report.samples.map(r => r.variant))) for (const campaign of ['short', 'long'] as const) {
      const seeds = report.samples.filter(r => r.variant === variant && r.campaign === campaign).map(r => r.seed).sort((a, b) => a - b);
      if (seeds.length !== report.runsPerColumn || seeds.some((seed, i) => seed !== historical.seedBase + i)) throw Error(`Wrong seed denominator: ${path}/${campaign}/${variant}`);
    }
    for (const row of report.samples) {
      const key = `${row.campaign}/${row.variant}/${row.seed}`;
      if (seen.has(key)) throw Error(`Duplicate sample: ${key}`);
      seen.add(key); samples.push(row);
    }
    controls.push(...report.controls);
    sources.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), hashes: report.hashes });
  }
  const result = { seedBase: historical.seedBase, runsPerColumn: historical.runsPerColumn, scenario: historical.scenario,
    contentHash: historical.contentHash, historical: historicalPath, sources, controls,
    method: 'Paired independent houses; early endings and zero-use cases retained. Four ablations versus budgeted_broad; primary improvement versus historical broad. Original two-SE bar and separate two-domain goal.',
    summary: comparePractice(samples, historical.samples) };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result.summary, null, 2) + '\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-practice-report.ts') && process.argv[2] === '--summarise') {
  reduceReports(process.argv[3]!, process.argv[4]!, process.argv.slice(5));
} else if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-practice-report.ts')) {
  const args = process.argv.filter(arg => arg !== '--funnel');
  const n = Number(args[2] ?? 24), seedBase = Number(args[3] ?? 187700);
  const output = args[4], scenario = args[5] ?? 'ordinary', requested = args[6] ?? 'demand_aware';
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(seedBase) || !output) throw Error('Expected runs, integer seed and output path');
  if (scenario !== 'ordinary' && scenario !== 'hostile') throw Error('Expected ordinary or hostile');
  const historical: Run[] = args[7] && args[7] !== '-' ? JSON.parse(readFileSync(args[7], 'utf8')).samples : [];
  const variants = requested === 'historical' || requested === 'observer_controls' ? REPERTOIRE_POLICIES : requested.split(',').map(name => {
    const variant = PRACTICE_VARIANTS.find(v => v === name) ?? REPERTOIRE_POLICIES.find(v => v === name);
    if (!variant) throw Error(`Unknown practice variant: ${name}`);
    return variant;
  });
  const content = loadContent(), samples: PracticeRun[] = [];
  const controls: { campaign: string; variant: string; seed: number; observerEqual?: boolean;
    continuation?: Run['continuation']; replayEqual?: boolean }[] = [];
  const hashes = Object.fromEntries(['mystic-practice-report.ts', 'mystic-practice-policy.ts', 'mystic-practice-funnel.ts', 'mystic-repertoire-report.ts', 'mystic-accounting.ts']
    .map(file => [file, createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')]));
  const contentHash = createHash('sha256').update(canonical(content.bundle)).digest('hex');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const nodeVersion = process.version;
  const changedRuntime = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'packages/core/src', 'packages/schema/src', 'packages/content/src'],
    { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('/tools/'));
  if (changedRuntime.length) throw Error(`Commit gameplay changes before measuring: ${changedRuntime.join(', ')}`);
  if (args[8]) {
    const checkpoint = JSON.parse(readFileSync(args[8], 'utf8')) as { seedBase: number; runsPerColumn: number;
      scenario: string; contentHash: string; sourceRevision: string; nodeVersion: string;
      hashes: Record<string, string>; samples: PracticeRun[]; controls: typeof controls };
    if (checkpoint.seedBase !== seedBase || checkpoint.runsPerColumn !== n || checkpoint.scenario !== scenario
      || checkpoint.contentHash !== contentHash || checkpoint.sourceRevision !== sourceRevision || checkpoint.nodeVersion !== nodeVersion
      || !Array.isArray(checkpoint.samples) || !Array.isArray(checkpoint.controls)
      || ['mystic-practice-policy.ts', 'mystic-repertoire-report.ts'].some(file => checkpoint.hashes[file] !== hashes[file]))
      throw Error('Checkpoint protocol, content or gameplay policy changed');
    const seen = new Set<string>();
    for (const row of checkpoint.samples) {
      const key = `${row.campaign}/${row.variant}/${row.seed}`;
      if (!variants.some(v => v === row.variant) || !['short', 'long'].includes(row.campaign) || !Number.isSafeInteger(row.seed)
        || row.seed < seedBase || row.seed >= seedBase + n || seen.has(key)) throw Error(`Invalid checkpoint row: ${key}`);
      seen.add(key); samples.push({ ...row, sourceHashes: row.sourceHashes ?? checkpoint.hashes });
    }
    controls.push(...checkpoint.controls);
  }
  if (requested === 'observer_controls' && historical.length !== n * REPERTOIRE_POLICIES.length * 2)
    throw Error('Observer controls require the complete historical scenario sample');
  const persist = () => {
    writeFileSync(`${output}.tmp`, JSON.stringify({ seedBase, runsPerColumn: n, scenario, hashes, contentHash, sourceRevision, nodeVersion,
      complete: samples.length === n * variants.length * 2, controls, summary: comparePractice(samples, historical), samples }, null, 2) + '\n');
    renameSync(`${output}.tmp`, output);
  };
  for (const campaign of ['short', 'long'] as const) for (const variant of variants) for (let i = 0; i < n; i++) {
    if (samples.some(row => row.campaign === campaign && row.variant === variant && row.seed === seedBase + i)) continue;
    const experimental = PRACTICE_VARIANTS.find(v => v === variant);
    const policy = REPERTOIRE_POLICIES.find(p => p === variant) ?? 'broad';
    if (requested === 'observer_controls') {
      const run = playRepertoireCampaign(content, seedBase + i, campaign, policy, false, scenario);
      const old = historical.find(r => r.seed === run.seed && r.campaign === campaign && r.policy === policy && r.scenario === scenario);
      if (!old || old.fullSaveHash !== run.fullSaveHash) throw Error(`Observer changed historical save: ${campaign}/${policy}/${run.seed}`);
      controls.push({ campaign, variant, seed: run.seed, observerEqual: true });
      writeFileSync(output, JSON.stringify({ seedBase, runsPerColumn: n, scenario, hashes, contentHash, sourceRevision, nodeVersion,
        complete: controls.length === historical.length, controls }, null, 2) + '\n');
      process.stderr.write(`${scenario}/${campaign}/${policy} observer: ${i + 1}/${n}\n`);
      continue;
    }
    const options = () => ({ funnel: !experimental || process.argv.includes('--funnel'), strictBudget: Boolean(experimental),
      practice: experimental ? createPracticePolicy(experimental) : undefined,
      retainSave: i === 0, verifyContinuation: i === 0 });
    const run = playRepertoireCampaign(content, seedBase + i, campaign, policy, true, scenario, options());
    const old = historical.find(r => r.seed === run.seed && r.campaign === campaign && r.policy === policy);
    if (!experimental && old && run.fullSaveHash !== old.fullSaveHash) throw Error(`Additional funnel changed historical save: ${campaign}/${variant}/${run.seed}`);
    if (i === 0 || variant === 'demand_aware' || variant === 'quoted_demand') {
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
    samples.push({ ...run, variant, sourceHashes: hashes }); persist();
    process.stderr.write(`${scenario}/${campaign}/${variant}: ${i + 1}/${n}\n`);
  }
  if (requested !== 'observer_controls') persist();
  process.stdout.write(JSON.stringify({ contentHash, controls, summary: comparePractice(samples, historical) }, null, 2) + '\n');
}
