/** #1943: where ordinary campaigns lose their covert conflict, counted with the production predicates.
 * Run with tsx --tsconfig tsconfig.base.json <this file> [runs=24] [seedBase=187700] [output.json] [ordinary|hostile].
 * Plays the #1878 report's `no_extra` column order for order, so the same seeds are the same houses.
 * Descriptive evidence; a funnel explains a rate, it never substitutes for one.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import type { Content, TableOrder } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { createCovertExposure, sampleCovertExposure, type CovertExposure } from '../covert-exposure.js';
import { newGame, type GameSession } from '../session.js';
import { canonical } from '../save.js';
import { expectMean } from '../testing.js';

type Scenario = 'ordinary' | 'hostile';
const hashSave = (s: GameSession) => createHash('sha256').update(canonical({ ...s.save(), savedAt: '' })).digest('hex');

export function playExposureCampaign(content: Content, seed: number, campaign: 'short' | 'long', scenario: Scenario, observed = true) {
  const s = newGame(content, { seed, campaign, decider: 'chronicler' });
  if (scenario === 'hostile') {
    const prologue = s.prologue()!;
    const founded = s.found({ houseName: 'The Eldritch House', heirloom: prologue.heirlooms[0]!.heirloom, grudge: prologue.grudges[0]!.house });
    if (!founded.ok) throw Error(`Public founding refused: ${founded.reason}`);
  }
  const funnel = createCovertExposure();
  let decisions = 0;
  if (observed) s.ctx.observeDecision = () => { decisions++; };
  const send = (o: TableOrder) => s.order(o).ok;
  for (let elapsed = 0; elapsed < CAMPAIGNS[campaign].years && !s.ctx.world.ending; elapsed++) {
    if (s.pending.length) s.letHimDecide();
    if (scenario === 'hostile') {
      const table = s.table();
      for (const captive of table.captives) if (captive.ok && table.treasury >= captive.price + 40) send({ kind: 'ransom', person: captive.person });
      const response = table.security.threats[0]?.options.filter(o => o.ok && o.price > 0 && o.price + 40 <= table.treasury).sort((a, b) => b.price - a.price)[0];
      if (response) send(response.order);
      if (elapsed % 25 === 0) {
        const offer = table.expeditions.offers.filter(o => o.ok && o.order.preparation === 'hasty' && o.price + 100 <= table.treasury)
          .sort((a, b) => a.targetName.localeCompare(b.targetName) || a.operativeName.localeCompare(b.operativeName))[0];
        if (offer) send(offer.order);
      }
    }
    if (elapsed % 20 === 0) {
      const parcel = s.land().held.find(p => p.canImprove && p.improveCost + 40 <= s.table().treasury);
      if (parcel) send({ kind: 'improve', parcel: parcel.parcel });
    }
    s.keepSuggestedNames();
    s.advance();
    if (observed) sampleCovertExposure(s.ctx, funnel);
  }
  const w = s.ctx.world;
  return {
    seed, campaign, scenario, years: w.year - CAMPAIGNS[campaign].startYear, ending: w.ending?.id, hash: hashSave(s),
    decisions, funnel,
    threats: w.covert.threats.map(t => ({ preparedAt: t.plan.preparedAt, stage: t.stage, result: t.observation?.result,
      identified: Boolean(t.observation?.identifiedOperative), warned: t.warned, defencePaid: t.defence.paidCrowns,
      target: w.people.get(t.plan.target)?.name })),
    operations: w.covert.operations.map(o => ({ preparedAt: o.plan.preparedAt, result: o.result, exposed: Boolean(o.exposure) })),
  };
}

function add(into: CovertExposure, f: CovertExposure): void {
  into.years += f.years;
  for (const [k, r] of Object.entries(f.grudges)) {
    const row = into.grudges[k] ??= { grudgeYears: 0, incomingLive: 0, outgoingLive: 0, peak: 0 };
    row.grudgeYears += r.grudgeYears; row.incomingLive += r.incomingLive; row.outgoingLive += r.outgoingLive;
    row.peak = Math.max(row.peak, r.peak);
  }
  for (const side of ['incoming', 'outgoing'] as const) {
    const a = into[side] as Record<string, unknown>, b = f[side] as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === 'number') a[k] = (a[k] as number) + v;
      else for (const [kk, n] of Object.entries(v as Record<string, number>)) {
        const t = a[k] as Record<string, number>; t[kk] = (t[kk] ?? 0) + n;
      }
    }
  }
}

/** The bounds #1943 declared before the change was measured. A verdict, never a gate. */
function verdict(what: string, values: number[], claim: { floor: number } | { ceiling: number }) {
  try {
    const margin = expectMean({ what, values, ...claim });
    return { what, pass: true, margin: Number.isFinite(margin) ? +margin.toFixed(2) : 'unbounded: every run equal' };
  }
  catch (e) { return { what, pass: false, reason: String((e as Error).message).split('\n')[0] }; }
}

export function exposureBounds(runs: ReturnType<typeof playExposureCampaign>[], scenario: Scenario) {
  const long = runs.filter(r => r.campaign === 'long').map(r => r.threats.length);
  if (long.length < 2) return [];
  if (scenario === 'ordinary') return [verdict('ordinary household attacks per Long Line < 0.5', long, { ceiling: 0.5 })];
  return [
    verdict('hostile household attacks per Long Line > 0.25', long, { floor: 0.25 }),
    verdict('hostile household attacks per Long Line < 4', long, { ceiling: 4 }),
    { what: 'no hostile Long Line above 8 attacks', pass: Math.max(...long) <= 8, max: Math.max(...long) },
  ];
}

export function exposureReport(runs: ReturnType<typeof playExposureCampaign>[]) {
  return (['short', 'long'] as const).map(campaign => {
    const rows = runs.filter(r => r.campaign === campaign);
    if (!rows.length) return undefined;
    const total = createCovertExposure();
    for (const r of rows) add(total, r.funnel);
    const per = (n: number) => +(n / rows.length).toFixed(2);
    return {
      campaign, runs: rows.length, years: total.years,
      threatsPerRun: per(rows.reduce((n, r) => n + r.threats.length, 0)),
      operationsPerRun: per(rows.reduce((n, r) => n + r.operations.length, 0)),
      runsWithThreat: rows.filter(r => r.threats.length).length,
      runsWithOperation: rows.filter(r => r.operations.length).length,
      threatResults: rows.flatMap(r => r.threats.map(t => t.result ?? t.stage)).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}),
      warned: rows.reduce((n, r) => n + r.threats.filter(t => t.warned).length, 0),
      identified: rows.reduce((n, r) => n + r.threats.filter(t => t.identified).length, 0),
      defencePaid: rows.reduce((n, r) => n + r.threats.reduce((m, t) => m + t.defencePaid, 0), 0),
      exposedOperations: rows.reduce((n, r) => n + r.operations.filter(o => o.exposed).length, 0),
      firstThreatYears: rows.flatMap(r => r.threats.slice(0, 1).map(t => t.preparedAt)).sort((a, b) => a - b),
      decisionsPer25Years: +(rows.reduce((n, r) => n + r.decisions, 0) / total.years * 25).toFixed(2),
      endings: rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.ending ?? 'none']: (a[r.ending ?? 'none'] ?? 0) + 1 }), {}),
      incoming: total.incoming, outgoing: total.outgoing,
      grudges: Object.fromEntries(Object.entries(total.grudges).sort(([a], [b]) => a.localeCompare(b))),
    };
  }).filter(Boolean);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/covert-exposure-report.ts')) {
  const n = Number(process.argv[2] ?? 24), seedBase = Number(process.argv[3] ?? 187700);
  const scenario = (process.argv[5] ?? 'ordinary') as Scenario;
  if (scenario !== 'ordinary' && scenario !== 'hostile') throw Error('Expected ordinary or hostile scenario');
  const content = loadContent();
  const runs = Array.from({ length: n }, (_, i) => seedBase + i)
    .flatMap(seed => (['short', 'long'] as const).map(campaign => playExposureCampaign(content, seed, campaign, scenario)));
  // Observer neutrality: the same house, unwatched, ends on the same complete save.
  const control = playExposureCampaign(content, seedBase, 'short', scenario, false);
  const watched = runs.find(r => r.seed === seedBase && r.campaign === 'short')!;
  if (control.hash !== watched.hash) throw Error('The covert exposure funnel changed the save it observed');
  const report = { issue: 1943, scenario, seeds: [seedBase, seedBase + n - 1], observerNeutral: true,
    bounds: exposureBounds(runs, scenario), summary: exposureReport(runs),
    runs: runs.map(({ funnel: _f, ...r }) => r) };
  console.log(JSON.stringify({ bounds: report.bounds, summary: report.summary }, null, 2));
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
}
