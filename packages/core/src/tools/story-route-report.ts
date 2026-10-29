/** #1946: distinguish a rare invitation from a promise that was lost. */
import { loadContent } from '@ed/content';
import { indexContent, stillCastable, type Content, type ContentBundle } from '@ed/schema';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeAgeIds } from '../ages/scheduler.js';
import { campaignDef, START_YEAR } from '../campaign.js';
import { autoResolveDecision, resolveChoice, type OutcomeObservation } from '../events/decisions.js';
import { evalCondition } from '../events/conditions.js';
import { minimumArcYears } from '../events/arc-reach.js';
import { outcomeKey } from '../events/reach.js';
import { streamFor } from '../rng.js';
import { canonical, saveGame } from '../save.js';
import { bootstrap, stepYear } from '../sim.js';
import type { SimCtx } from '../world.js';
import { FunnelObserver, privateFunnelContext } from './funnel.js';
import { longestAnswerSilence } from './long-line-gate.js';

export const STORY_ROUTE_IDS = ['the_herald_opens_the_old_question', 'the_hall_is_answered',
  'the_hall_stops_writing', 'the_cellar_shelf_is_found'] as const;
export const GLIMPSE_IDS = ['the_line_carried_forward', 'the_letters_to_the_weighers', 'the_branch_hall_book'] as const;

export interface RouteLauncher {
  target: string;
  event: string;
  choice?: string;
  outcome: string;
  mechanism: { schedule: number } | { arc: string };
}

/** Read the compiled production wiring; do not assume that a schedule and an
 * inline arc have the same lifetime, cast retention or selection rules. */
export function routeLaunchers(content: Content, targets: readonly string[]): RouteLauncher[] {
  const out: RouteLauncher[] = [];
  for (const event of content.events) {
    const branches = event.interaction.kind === 'narration'
      ? [{ choice: undefined, outcomes: event.interaction.outcomes }]
      : event.interaction.choices.map(choice => ({ choice: choice.id, outcomes: choice.outcomes }));
    for (const branch of branches) for (const outcome of branch.outcomes.flatMap(outcome =>
      outcome.primordial ? [outcome, outcome.primordial] : [outcome])) {
      const base = { event: String(event.id), choice: branch.choice, outcome: outcome.id };
      for (const effect of outcome.effects) {
        if (effect.kind === 'schedule' && targets.includes(effect.event)) {
          out.push({ ...base, target: effect.event, mechanism: { schedule: effect.inYears } });
        }
      }
      const arcs = [
        ...outcome.effects.flatMap(effect => effect.kind === 'arc' && effect.op === 'start' ? [effect.arc] : []),
        ...(outcome.triggers?.op === 'start' ? [outcome.triggers.arc] : []),
      ];
      for (const id of new Set(arcs)) {
        const arc = content.mustArc(id);
        const target = arc.nodes.find(node => node.id === arc.entry)?.event;
        if (target && targets.includes(target)) out.push({ ...base, target, mechanism: { arc: id } });
      }
    }
  }
  return out;
}

export interface RoutePromise {
  target: string;
  launcher: string;
  year: number;
  /** The exact committed launch; event/year alone cannot identify a promise. */
  launchPage?: string;
  dueYear?: number;
  originalCast: Record<string, string | string[]>;
  keptCast?: Record<string, string>;
  finalBindings?: Record<string, string>;
  instance?: string;
  queued: boolean;
  status: string;
  waits: { year: number; reason: string }[];
  missing: { slot: string; person: string; status: string; policy: unknown }[];
  deliveredYear?: number;
  deliveryPage?: string;
  cause?: { year: number; page?: string };
}

interface WatchedPromise { promise: RoutePromise; launcher: RouteLauncher; refusal?: string }
export interface SelectionShare { ages: string; tier: string; frequency: string; source: string; selected: number }

export class StoryRouteObserver {
  readonly launchers: RouteLauncher[];
  readonly offers: Record<string, Record<string, number>> = {};
  readonly answers: Record<string, number> = {};
  readonly shares: SelectionShare[] = [];
  private promises: WatchedPromise[] = [];
  private seenInstances = new Set<string>();
  private pendingLaunches = new WeakMap<OutcomeObservation, RoutePromise[]>();
  private previous: Pick<SimCtx, 'observeOutcome' | 'observeAppliedOutcome' | 'observeSelection'>;

  constructor(private ctx: SimCtx, targets: readonly string[] = STORY_ROUTE_IDS) {
    this.launchers = routeLaunchers(ctx.content, targets);
    this.previous = { observeOutcome: ctx.observeOutcome, observeAppliedOutcome: ctx.observeAppliedOutcome,
      observeSelection: ctx.observeSelection };
    ctx.observeOutcome = observation => {
      this.onOutcome(observation);
      this.previous.observeOutcome?.(observation);
    };
    ctx.observeAppliedOutcome = (observation, entryId) => {
      for (const promise of this.pendingLaunches.get(observation) ?? []) {
        promise.launchPage = entryId;
        promise.queued = ctx.world.scheduled.some(schedule => schedule.event === promise.target
          && schedule.cause?.page === entryId && schedule.cause.year === promise.year);
      }
      this.pendingLaunches.delete(observation);
      this.previous.observeAppliedOutcome?.(observation, entryId);
    };
    ctx.observeSelection = observation => {
      if (observation.kind === 'choice_offered' && this.launchers.some(launcher => launcher.event === observation.event)) {
        const offers = this.offers[observation.event] ??= {};
        for (const id of observation.choices) offers[id] = (offers[id] ?? 0) + 1;
      }
      if (observation.kind === 'selected') for (const candidate of observation.candidates) {
        const event = ctx.content.mustEvent(candidate.event);
        const ages = [...activeAgeIds(ctx)].sort().join('+') || '(no Age)';
        let share = this.shares.find(row => row.ages === ages && row.tier === event.tier
          && row.frequency === event.frequency && row.source === candidate.source);
        if (!share) this.shares.push(share = { ages, tier: event.tier, frequency: event.frequency, source: candidate.source, selected: 0 });
        share.selected++;
      }
      if (observation.kind === 'before_arc_steps') this.beforeArcSteps();
      this.previous.observeSelection?.(observation);
    };
  }

  private onOutcome(observation: OutcomeObservation): void {
    const w = this.ctx.world;
    const key = outcomeKey(observation.event.id, observation.choiceId, observation.outcome.id);
    if (this.launchers.some(launcher => launcher.event === observation.event.id)) {
      this.answers[key] = (this.answers[key] ?? 0) + 1;
    }
    for (const launcher of this.launchers) {
      if (key !== outcomeKey(launcher.event, launcher.choice, launcher.outcome)) continue;
      let refusal: string | undefined;
      if ('arc' in launcher.mechanism) {
        const arc = this.ctx.content.mustArc(launcher.mechanism.arc);
        if (w.year + minimumArcYears(arc) > campaignDef(w.campaign).endYear) refusal = 'start_refused_term_window';
        else if ([...w.arcs.values()].filter(instance => instance.arc === arc.id && instance.status === 'active').length >= arc.maxConcurrentInstances) refusal = 'start_refused_concurrency';
      }
      const promise: RoutePromise = {
        target: launcher.target, launcher: key, year: w.year, originalCast: structuredClone(observation.fill),
        ...('schedule' in launcher.mechanism ? { dueYear: w.year + launcher.mechanism.schedule } : {}),
        queued: false, status: 'not_yet_observed', waits: [], missing: [],
      };
      this.promises.push({ launcher, refusal, promise });
      const launches = this.pendingLaunches.get(observation) ?? [];
      launches.push(promise);
      this.pendingLaunches.set(observation, launches);
    }
  }

  /** Read only bindings whose real step is about to be considered. A later
   * death must not be described as the reason an earlier step was cancelled. */
  private beforeArcSteps(): void {
    this.afterYear(); // Also discovers an arc started earlier in this year.
    for (const watched of this.promises) {
      const { promise } = watched;
      const instance = promise.instance && this.ctx.world.arcs.get(promise.instance);
      if (!instance || instance.status !== 'active' || (instance.dueYear ?? 0) > this.ctx.world.year) continue;
      const arc = this.ctx.content.mustArc(instance.arc);
      const node = arc.nodes.find(node => node.id === instance.node);
      if (!node) continue;
      const event = this.ctx.content.mustEvent(node.event);
      promise.missing = arc.bindings.flatMap(slot => {
        const id = instance.bindings[slot];
        const person = id && this.ctx.world.people.get(id);
        return id && event.slots[slot] && (!person || !stillCastable(person))
          ? [{ slot, person: id, status: person ? person.status : 'unknown', policy: event.slots[slot]!.onMissing ?? 'cancel_arc' }] : [];
      });
      if (!evalCondition(event.conditions, privateFunnelContext(this.ctx), { arc: structuredClone(instance) })) {
        if (!promise.waits.some(wait => wait.year === this.ctx.world.year)) promise.waits.push({ year: this.ctx.world.year, reason: 'condition_false_at_due_checkpoint' });
      }
    }
  }

  /** Called after the real clock/answers. It never advances, repairs or
   * resolves a promise itself. Histories identify delivery of an exact arc. */
  afterYear(): void {
    const w = this.ctx.world;
    for (const watched of this.promises) {
      const { promise, launcher } = watched;
      if (!promise.launchPage) { promise.status = 'launch_provenance_unknown'; continue; }
      const causedByLaunch = (cause: { year: number; page?: string } | undefined) =>
        cause !== undefined && cause.page === promise.launchPage && cause.year === promise.year;
      const page = w.chronicle.find(page => page.eventId === promise.target && causedByLaunch(page.cause));
      if ('arc' in launcher.mechanism) {
        if (!promise.instance) {
          const id = launcher.mechanism.arc;
          const instance = [...w.arcs.values()].find(instance => instance.arc === id
            && causedByLaunch(instance.cause) && !this.seenInstances.has(instance.id));
          if (instance) {
            this.seenInstances.add(instance.id);
            promise.instance = instance.id;
            promise.dueYear = instance.dueYear;
            promise.keptCast = { ...instance.bindings };
            promise.queued = true;
          }
        }
        const instance = promise.instance && w.arcs.get(promise.instance);
        if (!instance) { promise.status = watched.refusal ?? 'not_started_or_provenance_unknown'; continue; }
        const arc = this.ctx.content.mustArc(instance.arc);
        promise.finalBindings = { ...instance.bindings };
        const delivery = instance.history.find(visit => arc.nodes.find(node => node.id === visit.node)?.event === promise.target);
        if (delivery) {
          promise.status = page ? 'delivered' : 'delivered_without_page_provenance';
          promise.deliveredYear = delivery.year;
        }
        else if (instance.status === 'cancelled') promise.status = promise.missing.some(slot => slot.policy === 'cancel_arc')
          ? 'cancelled_missing_kept_person' : 'cancelled_other_or_unknown';
        else promise.status = instance.status;
      } else {
        // A launch can author several schedules for one target. Their saved
        // cause identifies the page, not the effect, so do not claim to know
        // which one delivered in that genuinely ambiguous case.
        const sameSource = this.promises.filter(other => other.promise.target === promise.target
          && other.promise.launchPage === promise.launchPage && 'schedule' in other.launcher.mechanism);
        if (sameSource.length > 1) { promise.status = 'ambiguous_launch_provenance'; continue; }
        if (page) { promise.status = 'delivered'; promise.deliveredYear = page.year; promise.queued = true; }
        else {
          const schedule = w.scheduled.find(schedule => schedule.event === promise.target && causedByLaunch(schedule.cause));
          const pending = w.pendingDecisions.some(decision => decision.kind === 'choice'
            && decision.event.id === promise.target && causedByLaunch(decision.cause));
          if (schedule) { promise.queued = true; promise.status = 'active'; }
          else if (pending) { promise.queued = true; promise.status = 'awaiting_decision'; }
          else if (w.scheduled.some(schedule => schedule.event === promise.target && !schedule.cause?.page)) {
            promise.status = 'schedule_provenance_unknown';
          } else if (w.pendingDecisions.some(decision => decision.kind === 'choice'
            && decision.event.id === promise.target && decision.year >= promise.year && !decision.cause?.page)) {
            promise.status = 'decision_provenance_unknown';
          } else if (w.year >= promise.dueYear!) {
            promise.status = w.chronicle.some(page => page.eventId === promise.target && page.year >= promise.year && !page.cause?.page)
              ? 'delivery_provenance_unknown' : 'retired_without_delivery';
          }
        }
      }
      if (promise.deliveredYear !== undefined && page) {
        promise.deliveryPage = page.id;
        if (page.cause) promise.cause = structuredClone(page.cause);
      }
    }
  }

  finish(): RoutePromise[] {
    this.afterYear();
    for (const { promise } of this.promises) if (promise.status === 'active' || promise.status === 'not_yet_observed') {
      promise.status = this.ctx.world.ending ? `pending_at_${this.ctx.world.ending.id}` : 'pending_at_observation_end';
    }
    this.ctx.observeOutcome = this.previous.observeOutcome;
    this.ctx.observeAppliedOutcome = this.previous.observeAppliedOutcome;
    this.ctx.observeSelection = this.previous.observeSelection;
    return this.promises.map(({ promise }) => promise);
  }
}

export type StoryRoutePolicy = 'canonical' | 'short-descent';

/** Diagnostic counterfactual only. Keep all event identities/references and
 * production rations intact; make the three glimpse premises impossible. */
export function withoutGlimpses(source: Content | ContentBundle): Content {
  const bundle = structuredClone('bundle' in source ? source.bundle : source);
  for (const event of bundle.events) if (GLIMPSE_IDS.includes(event.id as typeof GLIMPSE_IDS[number])) {
    event.conditions = { all: [event.conditions ?? { year: { op: 'gte', value: START_YEAR } }, { year: { op: 'lt', value: START_YEAR } }] };
  }
  return indexContent(bundle);
}

export function playStoryRouteRun(source: Content | ContentBundle, seed: number, options: {
  years?: number; policy?: StoryRoutePolicy; targets?: readonly string[]; funnel?: boolean; observe?: boolean;
} = {}) {
  const ctx = bootstrap(source, seed, START_YEAR, 'long');
  const policy = options.policy ?? 'canonical';
  const observer = options.observe === false ? undefined : new StoryRouteObserver(ctx, options.targets);
  const ids = options.targets ?? STORY_ROUTE_IDS;
  const funnel = options.funnel && observer ? new FunnelObserver(ctx, [...new Set([...ids, ...observer.launchers.map(launcher => launcher.event)])]) : undefined;
  for (let i = 0; i < (options.years ?? 500); i++) {
    stepYear(ctx, policy === 'canonical');
    if (policy === 'short-descent') {
      const rng = streamFor(ctx.world, 'chronicler');
      let guard = 0;
      while (ctx.world.pendingDecisions.length) {
        if (++guard > 200) throw new Error('Story-route docket did not drain');
        const decision = ctx.world.pendingDecisions[0]!;
        if (decision.kind === 'choice' && decision.event.id === 'the_heralds_visitation'
          && decision.choices.some(choice => choice.id === 'the_short_descent' && choice.available)) {
          const result = resolveChoice(ctx, decision.id, 'the_short_descent', rng);
          if (!result.ok) throw new Error(result.reason);
        } else autoResolveDecision(ctx, decision, rng);
      }
    }
    observer?.afterYear();
  }
  const templates = funnel?.finish(); // Detach the outer listener first.
  const promises = observer?.finish();
  const choices = ctx.world.decisionLog.flatMap(entry => entry.kind === 'outcome' && entry.choiceId !== undefined ? [entry] : []);
  return { ctx, row: { seed, policy, playedYears: ctx.world.year - START_YEAR, ending: ctx.world.ending?.id,
    templateFires: { ...ctx.world.frequency.templateFires }, offers: observer?.offers, answers: observer?.answers,
    promises, shares: observer?.shares, templates, longestAnswerSilence: longestAnswerSilence(ctx),
    choices: choices.length, repeatedChoices: choices.length - new Set(choices.map(entry => entry.event)).size,
    pagesWithCause: ctx.world.chronicle.filter(page => page.cause !== undefined).length } };
}

export function binomialInterval(hits: number, n: number): { hits: number; n: number; rate: number | null; lower: number | null; upper: number | null } {
  if (!Number.isSafeInteger(hits) || !Number.isSafeInteger(n) || hits < 0 || n < 0 || hits > n) throw new Error('Invalid binomial counts');
  if (!n) return { hits, n, rate: null, lower: null, upper: null };
  const p = hits / n, z2 = 1.96 ** 2, denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return { hits, n, rate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

export function summariseStoryRoutes(rows: readonly ReturnType<typeof playStoryRouteRun>['row'][], targets: readonly string[]) {
  return targets.map(target => {
    const initiated = rows.filter(row => row.promises?.some(promise => promise.target === target));
    const promises = initiated.flatMap(row => row.promises!.filter(promise => promise.target === target));
    const losses: Record<string, number> = {};
    for (const promise of promises) losses[promise.status] = (losses[promise.status] ?? 0) + 1;
    return { target, housesFired: binomialInterval(rows.filter(row => (row.templateFires[target] ?? 0) > 0).length, rows.length),
      housesPromised: initiated.length,
      housesDeliveringEveryPromise: binomialInterval(initiated.filter(row => row.promises!
        .filter(promise => promise.target === target).every(promise => promise.status === 'delivered')).length, initiated.length),
      promises: promises.length, statuses: losses,
      deliveredWithoutCause: promises.filter(promise => promise.deliveredYear !== undefined && !promise.cause).length,
      deliveredWithChangedKeptCast: promises.filter(promise => promise.deliveredYear !== undefined
        && canonical(promise.keptCast) !== canonical(promise.finalBindings)).length };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const runs = Number(value('runs') ?? 800), start = Number(value('seed-start') ?? 5000), step = Number(value('seed-step') ?? 7);
  const controls = Number(value('controls') ?? 8), years = Number(value('years') ?? 500);
  const policy = value('policy') ?? 'canonical';
  if (policy !== 'canonical' && policy !== 'short-descent') throw new Error('Unknown story-route policy');
  if (![runs, start, step, controls, years].every(Number.isSafeInteger) || runs < 1 || controls < 0 || years < 1 || step < 1) throw new Error('Invalid integer batch options');
  const targets = args.filter(arg => !arg.startsWith('--'));
  const options: Parameters<typeof playStoryRouteRun>[2] = { policy, targets: targets.length ? targets : STORY_ROUTE_IDS, years, funnel: args.includes('--funnel') };
  const output = value('output');
  const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const source = args.includes('--without-glimpses') ? withoutGlimpses(loadContent()) : loadContent();
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const report = { sourceRevision: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')),
    sourceDiffHash: hash(git('diff', 'HEAD', '--', 'packages/core', 'packages/schema', 'packages/content')),
    contentHash: hash(canonical(source.bundle)), policyHash: hash(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
    node: process.version, runs, start, step, controls, options, withoutGlimpses: args.includes('--without-glimpses'),
    method: 'Canonical uses stepYear auto-resolution, identical to the fire-rate batch. Short-descent uses the player docket and always takes that available answer; all other docket answers use autoResolveDecision. These policies have different streams. Glimpse ablation disables only those three premises and is not a shipped rules change. Promise delivery requires the exact launching page; missing or shared provenance remains unknown or ambiguous. Wilson 95% intervals use independent houses, not repeated promises.',
    rows: [] as ReturnType<typeof playStoryRouteRun>['row'][] };
  console.log(JSON.stringify({ ...report, rows: undefined }));
  for (let i = 0; i < runs; i++) {
    const seed = start + i * step;
    const { ctx, row } = playStoryRouteRun(source, seed, options);
    if (i < controls) {
      const control = playStoryRouteRun(source, seed, { ...options, observe: false }).ctx;
      if (canonical(saveGame(ctx)) !== canonical(saveGame(control))) throw new Error(`Observer changed complete save ${seed}`);
    }
    report.rows.push(row);
    if (output) { writeFileSync(output + '.tmp', JSON.stringify({ ...report,
      summary: summariseStoryRoutes(report.rows, options.targets ?? STORY_ROUTE_IDS) }) + '\n'); renameSync(output + '.tmp', output); }
    console.log(`story routes: ${i + 1}/${runs}; seed ${seed}`);
  }
  console.log(JSON.stringify(summariseStoryRoutes(report.rows, options.targets ?? STORY_ROUTE_IDS), null, 2));
  if (!output) console.log(JSON.stringify(report));
}
