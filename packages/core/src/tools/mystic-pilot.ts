/** #1866 B / #1873: npm run gate:mystic-pilot -- [runs=32] [seedBase=187300] [output.json] [campaigns=short,long]
 * Paired measurement of standing Mystic duties. Every seed is played four
 * ways — the #1813 chronicler or broad study policy, each with duties off and
 * with a simple duty-keeping policy on — so a duty's effect is read against
 * the same house without one. Descriptive evidence, not a balance gate.
 */
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import type { Content, MysticAssignment, MysticBenefitKind } from '@ed/schema';
import { livingBlood } from '../ending.js';
import { landCrownsPerYield } from '../land.js';
import { order, tableView } from '../table.js';
import type { SimCtx } from '../world.js';
import { playChallengeRun, type ChallengePolicy } from './challenge-report.js';
import { meanEvidence, rateEvidence } from './mystic-baseline.js';

export type DutyPolicy = 'none' | 'keep';
/** The eligible-years window #1873 asks a duty to show a useful effect within. */
export const USEFUL_WINDOW = 10;

interface DutyRecord {
  kind: MysticBenefitKind;
  working: string;
  servedYears: number;
  usefulYears: number;
  firstUsefulAt?: number;
  livesKept: number;
  yieldKept: number;
  crownsKept: number;
  spent: number;
  ended?: number;
}

export interface PilotLedger {
  /** Household members, at the start of a year, who could take up some working. */
  practitionerYears: number;
  /** ...and of those, the ones actually keeping a duty. */
  dutyHolderYears: number;
  pausedStudyYears: number;
  orders: { given: number; refused: number };
  duties: Record<string, DutyRecord>;
}

function emptyLedger(): PilotLedger {
  return { practitionerYears: 0, dutyHolderYears: 0, pausedStudyYears: 0, orders: { given: 0, refused: 0 }, duties: {} };
}

/**
 * THE DUTY POLICY: what a player who has read the Table would do, using only
 * what it shows. Keep one carer at the seat and one warden on the ground that
 * stands to lose most, prefer readers who are not mid-book, and never pay
 * preparation that would leave less than a few years' upkeep behind.
 */
function keepDuties(ctx: SimCtx, ledger: PilotLedger): void {
  const table = tableView(ctx);
  const held = new Set(table.mystic.duties.map((d) => d.person));
  for (const kind of ['life_care', 'estate_protection'] as const) {
    if (table.mystic.duties.some((d) => ctx.content.mysticWorking(d.working)?.benefit.kind === kind)) continue;
    const offers = table.mystic.offers.filter((o) => o.benefit === kind && o.targets.length)
      .sort((a, b) => b.upkeep - a.upkeep || a.working.localeCompare(b.working));
    for (const offer of offers) {
      const people = offer.practitioners.filter((p) => !held.has(p.person))
        .sort((a, b) => Number(Boolean(a.studying)) - Number(Boolean(b.studying)) || a.person.localeCompare(b.person));
      const who = people[0];
      if (!who || table.treasury < offer.preparation + offer.upkeep * 5) continue;
      const where = kind === 'life_care'
        ? offer.targets.find((t) => t.target.kind === 'hall' && t.target.hall === 'main') ?? offer.targets[0]!
        : [...offer.targets].sort((a, b) => stake(ctx, b.target) - stake(ctx, a.target) || a.name.localeCompare(b.name))[0]!;
      const result = order(ctx, { kind: 'mysticAssign', person: who.person, working: offer.working, target: where.target, bindings: where.bindings });
      if (result.ok) { ledger.orders.given++; held.add(who.person); break; }
      ledger.orders.refused++;
    }
  }
}

/** What a parcel's bad year can cost, from its authored weight: the player can read this off the plat. */
function stake(ctx: SimCtx, site: MysticAssignment['target']): number {
  if (site.kind !== 'parcel') return 0;
  const def = ctx.content.parcel(site.parcel);
  const variance = def?.kind === 'slate_work' ? 1 : def?.kind === 'wetland' ? 0.25 : def?.kind === 'mill' ? 0.1 : 0.07;
  return (def?.baseYield ?? 0) * variance;
}

/** Start-of-year reading, before any phase can move it. Draws nothing and writes nothing. */
function sample(ctx: SimCtx, ledger: PilotLedger): void {
  const w = ctx.world;
  const table = tableView(ctx);
  const practitioners = new Set(table.mystic.offers.flatMap((o) => o.practitioners.map((p) => p.person)));
  for (const d of table.mystic.duties) practitioners.add(d.person);
  ledger.practitionerYears += practitioners.size;
  ledger.dutyHolderYears += table.mystic.duties.length;
  ledger.pausedStudyYears += w.mystic.pauses.length;
}

/** After a year: fold each duty's own service counters in, so one that ended is not lost with it. */
function settle(ctx: SimCtx, ledger: PilotLedger): void {
  const w = ctx.world;
  const scale = landCrownsPerYield(ctx);
  const live = new Set<string>();
  for (const a of w.mystic.assignments) {
    live.add(a.id);
    const kind = ctx.content.mysticWorking(a.working)?.benefit.kind ?? 'life_care';
    const prior = ledger.duties[a.id];
    const record: DutyRecord = prior ?? { kind, working: a.working, servedYears: 0, usefulYears: 0, livesKept: 0, yieldKept: 0, crownsKept: 0, spent: 0 };
    record.crownsKept += (a.service.yieldKept - record.yieldKept) * scale;
    Object.assign(record, {
      servedYears: a.service.servedYears, usefulYears: a.service.usefulYears, livesKept: a.service.livesKept,
      yieldKept: a.service.yieldKept, spent: a.service.spent,
      ...(a.service.firstUsefulAt !== undefined ? { firstUsefulAt: a.service.firstUsefulAt } : {}),
    });
    ledger.duties[a.id] = record;
  }
  for (const [id, record] of Object.entries(ledger.duties)) if (!live.has(id) && record.ended === undefined) record.ended = w.year;
}

export function playMysticPilot(content: Content, seed: number, campaign: 'short' | 'long', policy: ChallengePolicy,
  duty: DutyPolicy, observed = true) {
  const ledger = emptyLedger();
  let finalTreasury = 0;
  let finalBlood = 0;
  const run = playChallengeRun(content, seed, campaign, policy, true, {
    beforeYear: (ctx) => {
      if (livingBlood(ctx.world) === 0) return;
      if (duty === 'keep') keepDuties(ctx, ledger);
      if (observed) sample(ctx, ledger);
    },
    afterYear: (ctx) => {
      if (observed) settle(ctx, ledger);
      finalTreasury = ctx.world.treasury;
      finalBlood = livingBlood(ctx.world);
    },
  });
  return { ...run, duty, ledger, finalTreasury, finalBlood };
}

type Run = ReturnType<typeof playMysticPilot>;

const duties = (r: Run, kind?: MysticBenefitKind) => Object.values(r.ledger.duties).filter((d) => !kind || d.kind === kind);

/**
 * THE PRODUCT QUESTION: did a duty show a useful effect within its first ten
 * served years? A duty that has served fewer than ten and shown nothing yet
 * has not been given the chance, and is left out rather than counted a miss.
 */
export function usefulWithinWindow(records: readonly DutyRecord[]) {
  const judged = records.filter((d) => d.servedYears >= USEFUL_WINDOW || (d.firstUsefulAt ?? Infinity) <= USEFUL_WINDOW);
  const hits = judged.filter((d) => (d.firstUsefulAt ?? Infinity) <= USEFUL_WINDOW).length;
  return { ...rateEvidence(hits, judged.length), unjudged: records.length - judged.length };
}

export function summariseMysticPilot(runs: readonly Run[]) {
  const columns = [];
  for (const campaign of ['short', 'long'] as const) for (const policy of ['chronicler', 'broad'] as const) {
    const on = runs.filter((r) => r.campaign === campaign && r.policy === policy && r.duty === 'keep');
    const off = new Map(runs.filter((r) => r.campaign === campaign && r.policy === policy && r.duty === 'none').map((r) => [r.seed, r]));
    if (!on.length) continue;
    const perKind = (kind: MysticBenefitKind) => {
      const records = on.flatMap((r) => duties(r, kind));
      const est = (read: (d: DutyRecord[]) => number) => meanEvidence(on.map((r) => read(duties(r, kind))));
      const sum = (d: DutyRecord[], read: (x: DutyRecord) => number) => d.reduce((t, x) => t + read(x), 0);
      return {
        assignments: records.length,
        housesWithDuty: on.filter((r) => duties(r, kind).length).length,
        usefulWithin10: usefulWithinWindow(records),
        servedYears: est((d) => sum(d, (x) => x.servedYears)),
        usefulYears: est((d) => sum(d, (x) => x.usefulYears)),
        livesKept: est((d) => sum(d, (x) => x.livesKept)),
        crownsKept: est((d) => sum(d, (x) => x.crownsKept)),
        spent: est((d) => sum(d, (x) => x.spent)),
        netCoin: est((d) => sum(d, (x) => x.crownsKept - x.spent)),
      };
    };
    const pairs = on.map((run) => {
      const control = off.get(run.seed);
      if (!control) throw new Error(`Missing paired control ${campaign}/${policy}/${run.seed}`);
      return { run, control };
    });
    const diff = (read: (r: Run) => number) => meanEvidence(pairs.map(({ run, control }) => read(run) - read(control)));
    columns.push({
      campaign, policy, runs: on.length,
      practitionerYears: meanEvidence(on.map((r) => r.ledger.practitionerYears)),
      controlPractitionerYears: meanEvidence(pairs.map(({ control }) => control.ledger.practitionerYears)),
      dutyHolderYears: meanEvidence(on.map((r) => r.ledger.dutyHolderYears)),
      pausedStudyYears: meanEvidence(on.map((r) => r.ledger.pausedStudyYears)),
      orders: { given: on.reduce((t, r) => t + r.ledger.orders.given, 0), refused: on.reduce((t, r) => t + r.ledger.orders.refused, 0) },
      life: perKind('life_care'),
      estate: perKind('estate_protection'),
      paired: {
        finalTreasury: diff((r) => r.finalTreasury),
        finalLivingBlood: diff((r) => r.finalBlood),
        livedYears: diff((r) => r.years),
        endingChanged: rateEvidence(pairs.filter(({ run, control }) => run.ending !== control.ending).length, pairs.length),
      },
    });
  }
  return columns;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-pilot.ts')) {
  const runs = Number(process.argv[2] ?? 32);
  const seedBase = Number(process.argv[3] ?? 187300);
  const campaigns = (process.argv[5] ?? 'short,long').split(',') as ('short' | 'long')[];
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) throw new Error('Expected positive runs and integer seed base');
  const content = loadContent();
  const samples: Run[] = [];
  const controls: { seed: number; campaign: string; policy: string; duty: string; fullSaveEqual: boolean }[] = [];
  for (const campaign of campaigns) for (const policy of ['chronicler', 'broad'] as const) for (const duty of ['none', 'keep'] as const) {
    for (let i = 0; i < runs; i++) {
      const sample = playMysticPilot(content, seedBase + i, campaign, policy, duty);
      samples.push(sample);
      // The observer must not move the run: the first seed of every column again, unobserved.
      if (i === 0) {
        const plain = playMysticPilot(content, seedBase + i, campaign, policy, duty, false);
        const equal = plain.completeSaveHash === sample.completeSaveHash;
        controls.push({ seed: seedBase + i, campaign, policy, duty, fullSaveEqual: equal });
        if (!equal) throw new Error(`Observer changed saved run: ${campaign}/${policy}/${duty}/${seedBase + i}`);
      }
      if ((i + 1) % 8 === 0) process.stderr.write(`${campaign}/${policy}/${duty}: ${i + 1}/${runs}\n`);
    }
  }
  const report = {
    seedBase, runsPerColumn: runs, usefulWindow: USEFUL_WINDOW,
    method: {
      policy: '#1813 playChallengeRun (chronicler or broad), unchanged; duties keep one seat carer and one warden on the highest-stake reachable parcel, using only TableView, never releasing',
      useful: 'a duty is useful in a year it kept a life, held a bad harvest up, or reduced damage; judged within its first ten SERVED (paid, available) years; duties that served fewer and showed nothing are unjudged',
      coin: 'crownsKept = yield units kept x the respect-tier land scale at that year (charm and rent policy excluded); spent = preparation + reserved upkeep; lives are not priced',
      paired: 'same seed and base policy with duties off; final treasury, living blood, lived years and ending',
      controls: 'first seed of each column replayed without the observer; SHA256 over the complete save with savedAt blanked',
    },
    summary: summariseMysticPilot(samples), controls,
    samples: samples.map(({ checks: _checks, ...rest }) => rest),
  };
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ summary: report.summary, controls }, null, 2) + '\n');
}
