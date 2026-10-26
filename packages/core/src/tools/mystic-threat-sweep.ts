/** #1878: conditional security sweep, separate from ordinary campaign frequency.
 * tsx --tsconfig tsconfig.base.json <this file> [runs=128] [seedBase=187850] [output.json]
 * Built state supplies a named eligible adult and an existing rival's real
 * grievance. The normal annual generator, costs, clock and resolver still
 * decide whether a plot is prepared, reaches its target and changes a life.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { asId, type Content } from '@ed/schema';
import { householdThreatCandidates } from '../covert-lifecycle.js';
import { addGrudge } from '../people/relationships.js';
import { GameSession } from '../session.js';
import { canonical } from '../save.js';
import { expectMean, place, testWorld } from '../testing.js';
import { meanEvidence, rateEvidence } from './mystic-baseline.js';

const SPAN = 10;
const TOOL_HASH = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const POLICIES = ['unassigned', 'life', 'guards', 'life_and_guards'] as const;
type Policy = typeof POLICIES[number];

export function playThreatSweep(content: Content, seed: number, policy: Policy, observed = true) {
  const ctx = testWorld(content, seed);
  ctx.world.treasury = 400;
  const ward = place(ctx, { name: 'Wren of the Hall', sex: 'female', age: 27, awakened: true });
  const reader = place(ctx, { name: 'Maud of the Watch', sex: 'female', age: 32, awakened: true });
  reader.spellsKnown = [asId('lesser_workings_of_life')];
  const rival = ctx.world.people.living().find(p => p.castSlots.includes('rival'))!;
  addGrudge(ctx, rival.id, ward.id, { severity: 75, inheritance: 'house_wide' }, 'conditional_security_fixture');
  const session = new GameSession(ctx, 'chronicler');
  for (const p of [ward, reader]) session.order({ kind: 'withhold', person: p.id, hold: true });
  if (policy === 'life' || policy === 'life_and_guards') {
    const result = session.order({ kind: 'mysticAssign', person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: ward.id } });
    if (!result.ok) throw Error(`Conditional working refused: ${result.reason}`);
  }
  const metrics = { eligibleYears: 0, paidGuardCoin: 0, decisionAnswers: 0, dutyYears: 0, usefulYears: 0, dutySpent: 0 };
  if (observed) ctx.observeDecision = () => { metrics.decisionAnswers++; };
  for (let year = 0; year < SPAN && !ctx.world.ending; year++) {
    if (observed) metrics.eligibleYears += Number(householdThreatCandidates(ctx).some(c => c.target.id === ward.id));
    if (policy === 'guards' || policy === 'life_and_guards') {
      const table = session.table();
      const warning = table.security.threats.find(t => t.options.some(o => o.ok));
      const option = warning?.options.filter(o => o.ok && o.price > 0 && o.price + 30 <= table.treasury)
        .sort((a,b) => b.price - a.price)[0];
      if (option) {
        const before = ctx.world.treasury;
        if (session.order(option.order).ok && observed) metrics.paidGuardCoin += before - ctx.world.treasury;
      }
    }
    session.keepSuggestedNames(); session.advance();
  }
  const services = [...ctx.world.mystic.services, ...ctx.world.mystic.assignments].filter(a => a.practitioner === reader.id);
  if (observed) for (const a of services) {
    metrics.dutyYears += a.service.servedYears; metrics.usefulYears += a.service.usefulYears; metrics.dutySpent += a.service.spent;
  }
  const threats = ctx.world.covert.threats.filter(t => t.plan.target === ward.id);
  const saved = session.save();
  return { seed, policy, years: session.year - 1042, metrics,
    prepared: threats.length, resolved: threats.filter(t => t.stage === 'resolved').length,
    warned: threats.filter(t => t.warned).length, cancelled: threats.filter(t => t.stage === 'cancelled').length,
    prevented: threats.filter(t => t.observation?.result === 'prevented').length,
    attackDeaths: threats.filter(t => t.observation?.result === 'dead').length,
    wounded: threats.filter(t => t.observation?.result === 'wounded').length,
    attributed: threats.filter(t => t.observation?.identifiedOperative).length,
    prisoner: threats.filter(t => t.prisoner).length,
    protections: services.reduce((n,a) => n + (a.service.protections ?? 0), 0),
    actualWard: { person: ward.id, name: ward.name, status: ward.status, died: ward.died },
    receipts: threats.map(t => ({ year: t.closedAt, receipt: t.receipt, result: t.observation?.result })),
    fullSaveHash: createHash('sha256').update(canonical({ ...saved, savedAt: '' })).digest('hex'),
  };
}

type Run = ReturnType<typeof playThreatSweep>;
export function summariseThreatSweep(runs: readonly Run[]) {
  return POLICIES.map(policy => {
    const rows = runs.filter(r => r.policy === policy);
    const controlPolicy = policy === 'life_and_guards' ? 'guards' : 'unassigned';
    const controls = new Map(runs.filter(r => r.policy === controlPolicy).map(r => [r.seed,r]));
    const estimate = (read: (r: Run) => number) => meanEvidence(rows.map(read));
    const differences = rows.map(r => controls.get(r.seed)!.attackDeaths - r.attackDeaths);
    let supported = false; let claim: number | string;
    try { claim = expectMean({ values: differences, floor: 0, what: `additional protection reduces conditional attack deaths: ${policy} vs ${controlPolicy}` }); supported = true; }
    catch (e) { claim = (e as Error).message; }
    return { policy, runs: rows.length, exposedHouses: rateEvidence(rows.filter(r => r.prepared > 0).length,rows.length),
      eligibleYears: estimate(r => r.metrics.eligibleYears), prepared: estimate(r => r.prepared), resolved: estimate(r => r.resolved),
      cancelled: estimate(r => r.cancelled), warnings: estimate(r => r.warned), prevented: estimate(r => r.prevented),
      deaths: estimate(r => r.attackDeaths), wounded: estimate(r => r.wounded), attributed: estimate(r => r.attributed),
      prisoners: estimate(r => r.prisoner), protectionUses: estimate(r => r.protections),
      guardCoin: estimate(r => r.metrics.paidGuardCoin), dutyCoin: estimate(r => r.metrics.dutySpent),
      pairedDeathsAvoided: meanEvidence(differences), claim: { supported, marginOrReason: claim },
    };
  });
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-threat-sweep.ts')) {
  const n = Number(process.argv[2] ?? 128), seedBase = Number(process.argv[3] ?? 187850);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(seedBase)) throw Error('Expected positive runs and integer seed base');
  const content = loadContent(), samples: Run[] = [], controls: { policy: string; seed: number; equal: boolean }[] = [];
  for (const policy of POLICIES) for (let i=0; i<n; i++) {
    const row = playThreatSweep(content,seedBase+i,policy); samples.push(row);
    if (i === 0) {
      const control = playThreatSweep(content,seedBase+i,policy,false); const equal = row.fullSaveHash === control.fullSaveHash;
      controls.push({ policy,seed:seedBase+i,equal }); if (!equal) throw Error(`Observer changed conditional full save: ${policy}`);
    }
    if ((i+1)%32 === 0) process.stderr.write(`${policy}: ${i+1}/${n}\n`);
  }
  const report = { n, seedBase, years: SPAN, toolHash: TOOL_HASH,
    contentHash: createHash('sha256').update(canonical(content.bundle)).digest('hex'), controls,
    method: 'Conditional built-state exposure, not campaign frequency. One named eligible adult, one real rival with severity-75 grievance, one equally learned female Life reader present in every cell. Actual annual 8% preparation, twelve-year cooldown, paid warnings/guards, maintenance, resolver, ordinary mortality and primordial commitment remain intact. Policies vary assignment and affordable public precautions; no roll or result is forced. Independent houses use paired seeds; claims pass through expectMean and misses remain visible.',
    summary: summariseThreatSweep(samples), samples };
  if (process.argv[4]) writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({controls,summary:report.summary},null,2)+'\n');
}
