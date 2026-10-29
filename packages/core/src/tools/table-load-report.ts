/**
 * #1992 step 3: a bot proxy for the house Table's maintenance load.
 * Run with tsx --tsconfig tsconfig.base.json <this file> [runs=24] [seedBase=199200] [output.json].
 *
 * Two columns on the same seeds, both through the public session with the
 * chronicler answering the docket:
 *
 * - `steward` gives no Table order at all. What still happens — readers set to
 *   books, posts filled, terms begun — is the house running itself.
 * - `tending` composes policies already measured elsewhere rather than
 *   inventing new ones: marry in (#41), the #1874 report's `home` column
 *   (a sickroom duty, affordable ransom), its Library training, #1943's
 *   security response and its improvement cadence. Every order is a real
 *   `GameSession.order` attempt.
 *
 * Counts are classified by `table-load.ts`. They estimate activity under one
 * declared policy, not a player's attention, and say nothing about whether the
 * work felt like work — that needs the #1945 recorder and people.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { MAIN_BRANCH, indexContent, type Content, type ContentBundle } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { livingBlood } from '../ending.js';
import { speakerOf } from '../people/branches.js';
import { canonical } from '../save.js';
import { newGame, type GameSession } from '../session.js';
import { COMMAND_LOADS, acceptedCommands, emptyCommandTally, noteCommand, observeOrders, type TableSystem } from '../table-load.js';
import { meanEvidence } from './mystic-baseline.js';
import { applyFieldPolicy, train } from './mystic-muster-report.js';

export const LOAD_POLICIES = ['steward', 'tending'] as const;
export type LoadPolicy = typeof LOAD_POLICIES[number];

/** One year of the composite policy. Each step is the cited report's own rule. */
function tend(s: GameSession, content: Content, elapsed: number): void {
  applyFieldPolicy(s, content, 'home');
  train(s, content, elapsed);
  const table = s.table();
  const response = table.security.threats[0]?.options.filter(o => o.ok && o.price > 0 && o.price + 40 <= table.treasury)
    .sort((a, b) => b.price - a.price)[0];
  if (response) s.order(response.order);
  if (elapsed % 20 === 0) {
    const parcel = s.land().held.find(p => p.canImprove && p.improveCost + 40 <= s.table().treasury);
    if (parcel) s.order({ kind: 'improve', parcel: parcel.parcel });
  }
}

export function playTableLoadCampaign(source: Content | ContentBundle, seed: number, campaign: 'short' | 'long',
  policy: LoadPolicy, observed = true) {
  const content = indexContent(source);
  const s = newGame(content, { seed, campaign, decider: 'chronicler' });
  const tally = emptyCommandTally();
  if (observed) observeOrders(s, tally);
  const automatic = { readersSet: 0, postsFilled: 0, termsBegun: 0 };
  let docketAnswers = 0;
  if (observed) s.ctx.observeDecision = () => { docketAnswers++; };
  let head = speakerOf(s.ctx, MAIN_BRANCH)?.id;
  let completedTenures = 0;
  if (policy === 'tending') s.order({ kind: 'marriages', policy: 'in' });
  for (let elapsed = 0; elapsed < CAMPAIGNS[campaign].years && !s.ctx.world.ending; elapsed++) {
    if (s.pending.length) s.letHimDecide();
    if (policy === 'tending') tend(s, content, elapsed);
    const terms = observed ? new Set(s.table().tutoring.map(t => `${t.person}:${t.attr}`)) : new Set<string>();
    s.advance();
    if (!observed) continue;
    const w = s.ctx.world;
    automatic.readersSet += w.stewardYear.opened.length;
    automatic.postsFilled += w.stewardYear.placed.length;
    // No order is given during `advance`: a term that appears inside it was
    // begun by the steward's diligence or an authored effect.
    automatic.termsBegun += s.table().tutoring.filter(t => !terms.has(`${t.person}:${t.attr}`)).length;
    const now = speakerOf(s.ctx, MAIN_BRANCH)?.id;
    if (now !== head) { if (head !== undefined) completedTenures++; head = now; }
  }
  const w = s.ctx.world;
  const saved = s.save();
  // The save is the authority on acceptance. The observer must agree with it.
  const logged = emptyCommandTally();
  for (const row of acceptedCommands(saved.decisionLog)) noteCommand(logged, row.command, true);
  if (observed) for (const [category, n] of Object.entries(tally.byCategory)) {
    if ((logged.byCategory[category]?.accepted ?? 0) !== n.accepted) {
      throw new Error(`${campaign}/${policy}/${seed}: observed ${n.accepted} accepted ${category}, the save logged ${logged.byCategory[category]?.accepted ?? 0}`);
    }
  }
  return {
    seed, campaign, policy, years: w.year - CAMPAIGNS[campaign].startYear,
    completedTenures, ending: w.ending?.id, blood: livingBlood(w), docketAnswers,
    orders: tally, automatic, treasury: w.treasury,
    fullSaveHash: createHash('sha256').update(canonical({ ...saved, savedAt: '' })).digest('hex'),
  };
}

type Run = ReturnType<typeof playTableLoadCampaign>;

export function summariseTableLoad(runs: readonly Run[]) {
  return (['short', 'long'] as const).flatMap(campaign => LOAD_POLICIES.map(policy => {
    const rows = runs.filter(r => r.campaign === campaign && r.policy === policy);
    if (!rows.length) return undefined;
    const estimate = (read: (r: Run) => number) => meanEvidence(rows.map(read));
    const accepted = (r: Run) => COMMAND_LOADS.reduce((sum, load) => sum + r.orders.byLoad[load].accepted, 0);
    const systems = [...new Set(rows.flatMap(r => Object.keys(r.orders.bySystem)))].sort() as TableSystem[];
    const tenured = rows.filter(r => r.completedTenures > 0);
    return {
      campaign, policy, runs: rows.length,
      exposureYears: rows.reduce((sum, r) => sum + r.years, 0),
      // A partial tenure is the one still sitting when the run stops; early
      // extinction shows here as few years and few tenures, not as a low rate.
      completedTenures: estimate(r => r.completedTenures),
      runsWithoutCompletedTenure: rows.length - tenured.length,
      endedEarly: rows.filter(r => r.years < CAMPAIGNS[campaign].years).length,
      endings: Object.fromEntries([...new Set(rows.map(r => r.ending ?? 'none'))].sort()
        .map(id => [id, rows.filter(r => (r.ending ?? 'none') === id).length])),
      ordersPerRun: {
        accepted: estimate(accepted),
        refused: estimate(r => COMMAND_LOADS.reduce((sum, load) => sum + r.orders.byLoad[load].refused, 0)),
        ...Object.fromEntries(COMMAND_LOADS.map(load => [load, estimate(r => r.orders.byLoad[load].accepted)])),
      },
      acceptedPerCentury: estimate(r => r.years ? 100 * accepted(r) / r.years : 0),
      acceptedPerCompletedTenure: meanEvidence(tenured.map(r => accepted(r) / r.completedTenures)),
      bySystem: Object.fromEntries(systems.map(system => [system, {
        accepted: estimate(r => r.orders.bySystem[system]?.accepted ?? 0),
        refused: estimate(r => r.orders.bySystem[system]?.refused ?? 0),
      }])),
      automaticPerRun: {
        readersSet: estimate(r => r.automatic.readersSet),
        postsFilled: estimate(r => r.automatic.postsFilled),
        termsBegun: estimate(r => r.automatic.termsBegun),
      },
      docketAnswersPerRun: estimate(r => r.docketAnswers),
    };
  }).filter(row => row !== undefined));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/table-load-report.ts')) {
  const runs = Number(process.argv[2] ?? 24);
  const seedBase = Number(process.argv[3] ?? 199200);
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) throw new Error('Expected positive runs and integer seed base');
  const content = loadContent();
  const samples: Run[] = [];
  const controls: { seed: number; campaign: string; policy: string; equal: boolean }[] = [];
  for (const campaign of ['short', 'long'] as const) for (const policy of LOAD_POLICIES) for (let i = 0; i < runs; i++) {
    const run = playTableLoadCampaign(content, seedBase + i, campaign, policy);
    samples.push(run);
    if (i === 0) {
      const unobserved = playTableLoadCampaign(content, seedBase + i, campaign, policy, false);
      const equal = unobserved.fullSaveHash === run.fullSaveHash;
      controls.push({ seed: seedBase + i, campaign, policy, equal });
      if (!equal) throw new Error(`Observer changed the full save for ${campaign}/${policy}/${seedBase + i}`);
    }
    if ((i + 1) % 4 === 0) process.stderr.write(`${campaign}/${policy}: ${i + 1}/${runs}\n`);
  }
  const report = { seedBase, runs, controls, summary: summariseTableLoad(samples), samples };
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ seedBase, runs, controls, summary: report.summary }, null, 2));
}
