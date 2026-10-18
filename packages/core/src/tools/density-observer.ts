/** Read-only pacing instrumentation shared by the established players (#1814). */
import type { CampaignId, Content, ContentBundle } from '@ed/schema';
import { foremostOf } from '../ascension.js';
import { mustSurface } from '../delegation.js';
import type { DecisionObservation } from '../events/decisions.js';
import { knownToExpress } from '../people/factory.js';
import { PersonStore } from '../people/store.js';
import { canonical } from '../save.js';
import { head, inRegency, type SimCtx } from '../world.js';
import type { YearReport } from '../year/report.js';
import type { PolicyOrderVisit } from './ending-gate.js';
import { playStallRun, type StallObserver, type StallPolicy } from './ladder-stall.js';
import { isPredetermined } from './shapes.js';
import { blockerActionability } from './stall.js';
import { traceDiagnosticIntervals, type DiagnosticPeriod, type DiagnosticYear } from './density-report.js';

/** Actual female Head, or a male Head without a witnessed living expresser. */
export function diagnosticPeriod(ctx: SimCtx): DiagnosticPeriod | undefined {
  const w = ctx.world;
  if (inRegency(w)) return 'regency';
  if (!head(w)) return undefined;
  return w.people.household(w.playerHouse, w.year).some((person) =>
    person.sex === 'male' && person.awakening.awakened
      && knownToExpress(structuredClone(person), ctx.genetics, w.year)) ? undefined : 'unwoken';
}

/** Diagnostic readers may realise genomes/caches. Give them private people,
 * including ancestors needed by kin readers, rather than changing a save's
 * lazy representation merely by observing it. No RNG stream is consumed. */
function readContext(ctx: SimCtx): SimCtx {
  const people = new PersonStore();
  const add = (id: string): void => {
    if (people.get(id)) return;
    const person = ctx.world.people.get(id);
    if (!person) return;
    people.add(structuredClone(person));
    for (const parent of Object.values(person.trueParents)) if (parent) add(parent);
  };
  for (const person of ctx.world.people.living()) add(person.id);
  for (const d of ctx.world.pendingDecisions) {
    if (d.kind === 'match') { add(d.subject.id); continue; }
    for (const ids of Object.values(d.fill)) for (const id of typeof ids === 'string' ? [ids] : ids) add(id);
  }
  return { ...ctx, world: { ...ctx.world, people }, observeDecision: undefined, observeOutcome: undefined };
}

/** Deliberately conservative material situation, excluding the clock, prose,
 * event-frequency bookkeeping, RNG/counters and phenotype/genome caches.
 * A changed fortune, role, life, marriage, learned working, rite, property,
 * resource or remembered fact breaks an exact maintenance repetition. Mere
 * recurrence of a template or an effect shape is not maintenance. */
export function maintenanceSituation(ctx: SimCtx): string {
  const w = ctx.world;
  return canonical({
    treasury: w.treasury, respect: w.respect, discontent: w.discontent,
    scion: w.scion, heir: w.scionHeir,
    people: w.people.household(w.playerHouse, w.year).map((p) => ({
      id: p.id, status: p.status, slots: p.castSlots, acquired: p.acquired,
      awakening: p.awakening, madness: p.madness, rites: p.rites,
      spells: p.spellsKnown, marriages: p.marriages, membership: p.membership,
    })),
    flags: [...w.flags], knowledge: [...w.knowledge], clauses: [...w.clausesRecovered],
    discrepancies: [...w.discrepancies], relationships: [...w.relationships],
    library: [...w.library], regalia: [...w.heirlooms], parcels: [...w.parcels],
    studies: w.studies, tutoring: w.tutoring, withheld: w.withheld,
    rents: w.rentsPolicy, ascension: w.ascension, arcs: [...w.arcs],
  });
}

/** Exact repeated answer in the same material situation; unrelated intervening
 * decisions do not themselves erase a repeat, but their consequences do. */
export class MaintenanceTracker {
  private previous = new Map<string, string>();
  observe(key: string, situation: string): boolean {
    const repeated = this.previous.get(key) === situation;
    this.previous.set(key, situation);
    return repeated;
  }
}

function milestone(ctx: SimCtx): string {
  const w = ctx.world;
  return canonical({
    head: head(w)?.id, clauses: [...w.clausesRecovered], best: w.ascension.best,
    regalia: [...w.heirlooms.keys()],
    // yieldFactor is this year's harvest/risk roll, not a changed holding.
    // Keep permanent improvements/damage, title, contest and holder changes.
    parcels: [...w.parcels].map(([id, { yieldFactor: _annualYield, ...holding }]) => [id, holding]),
    // Ordinary births/deaths are not automatically strategic-spine beats.
    // Count witnessed awakenings and actual rite marks, including a lost bearer.
    people: w.people.household(w.playerHouse, w.year)
      .filter((p) => p.awakening.awakened || p.rites.length)
      .map((p) => [p.id, p.awakening.awakened, p.rites]),
  });
}

/** Counts successful policy answers, not every rendered panel. Automatic
 * narration/implicit Record/delegation are the non-name log entries remaining
 * after those answers are subtracted. Birth/death/name forms do not pad it. */
export class DensityObserver implements StallObserver {
  readonly years: DiagnosticYear[] = [];
  private current?: DiagnosticYear;
  private startLog = 0;
  private answers = 0;
  private before = '';
  private maintenance = new MaintenanceTracker();

  beforeYear(ctx: SimCtx): void {
    this.current = undefined;
    this.startLog = ctx.world.decisionLog.length;
    this.answers = 0;
    this.before = milestone(ctx);
  }

  afterStep(ctx: SimCtx, report: YearReport, reading?: Pick<DiagnosticYear, 'period' | 'blocker' | 'actionable'>): void {
    if (report.blocked) return;
    const period = reading ? reading.period : diagnosticPeriod(ctx);
    // Only these two periods are reported. Do not pay for another Table and
    // private pedigree reading during the rest of a five-century campaign.
    if (!reading && period) {
      const probe = readContext(ctx);
      const top = foremostOf(probe);
      const blocker = top?.standing.blocker ?? 'no-expresser';
      reading = { period, blocker, actionable: blockerActionability(probe, blocker, top?.person.id).actionable };
    }
    const holder = head(ctx.world);
    this.current = {
      year: ctx.world.year, head: holder?.id, headName: holder?.name,
      period, blocker: reading?.blocker ?? 'clear', actionable: reading?.actionable ?? false,
      spine: Boolean(report.agesBegan.length || report.agesEnded.length),
      choices: 0, matches: 0, records: 0, auctions: 0, orders: 0, routine: 0,
      automatic: 0, maintenance: 0,
    };
    this.years.push(this.current);
  }

  decision(ctx: SimCtx, observation: DecisionObservation): void {
    const sample = this.current;
    if (!sample) return; // The step's automatic resolutions are not player answers.
    const d = observation.decision;
    this.answers += 1;
    if (!sample.period) return;
    if (d.kind === 'match') {
      sample.matches += 1;
      sample.spine = true;
      return; // Marriage has already committed; never claim a pre-effect snapshot.
    }
    const probe = readContext(ctx);
    // Honest Record can be routine; omission/embellishment retain their actual
    // moral choice. Never change the live delegation policy to ask the guard.
    if (d.kind === 'record' && observation.answer === 'record') probe.world = { ...probe.world, delegation: {
      ...probe.world.delegation, records: { ...probe.world.delegation.records, [d.event.id]: 'record' },
    } };
    const meaningful = Boolean(mustSurface(probe, d))
      && (d.kind === 'record' || !isPredetermined(probe, d));
    if (meaningful) {
      if (d.kind === 'record') sample.records += 1;
      else sample.choices += 1;
      sample.spine = true;
    } else sample.routine += 1;
    const key = canonical({ kind: d.kind, template: d.event.id, targets: d.fill, answer: observation.answer });
    if (this.maintenance.observe(key, maintenanceSituation(ctx))) sample.maintenance! += 1;
  }

  order(_ctx: SimCtx, visit: PolicyOrderVisit): void {
    if (!visit.ok) return;
    // Preparation can issue an order BEFORE the next year turns. Attribute it
    // to its real date, not the next year's Regency/Head. Opening setup before
    // the first played year is outside the sampled intervals.
    const sample = this.years[this.years.length - 1];
    if (!sample || sample.year !== visit.year) return;
    sample.orders += 1;
    if (visit.command.kind === 'bid' || visit.command.kind === 'lotBid') sample.auctions += 1;
    sample.spine = true;
  }

  afterYear(ctx: SimCtx): void {
    if (!this.current) return;
    const resolutions = ctx.world.decisionLog.slice(this.startLog)
      .filter((entry) => entry.kind === 'outcome' || entry.kind === 'record' || entry.kind === 'match').length;
    this.current.automatic = Math.max(0, resolutions - this.answers);
    this.current.spine ||= this.before !== milestone(ctx);
    this.current = undefined;
  }

  get intervals() { return traceDiagnosticIntervals(this.years); }
}

/** Uses the actual G1/ending policy and its original salts, never a shadow
 * copy of the player loop or GameSession's differently seeded answer path. */
export function measurePolicyDensity(
  source: ContentBundle | Content, seed: number, years: number,
  policy: StallPolicy, campaign: CampaignId = 'long',
) {
  const observer = new DensityObserver();
  const run = playStallRun(source, seed, years, policy, campaign, false, observer);
  return { seed, campaign, policy, years: run.years, ending: run.ending,
    diagnosticIntervals: observer.intervals };
}
