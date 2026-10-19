import type { CampaignId, Condition, Content, ContentBundle, Effect, EventTemplate, Person } from '@ed/schema';
import { assertNever, eventInCampaign, indexContent } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { evalCondition } from '../events/conditions.js';
import { ambientExclusionReason, type SelectionObservation } from '../events/selection.js';
import { framePool, frameReadHolds } from '../events/frame.js';
import { dueArcSteps } from '../events/arcs.js';
import { resolveSlots, type SlotFill } from '../events/slots.js';
import { streamFor } from '../rng.js';
import { outcomeKey } from '../events/reach.js';
import { loadContent } from '@ed/content';
import { bootstrap, runYears } from '../sim.js';
import { canonical, saveGame } from '../save.js';
import { campaignDef, START_YEAR } from '../campaign.js';
import { writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FUNNEL_STAGES = ['premise', 'cast', 'condition', 'not_selected', 'unresolved', 'reached'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export interface FunnelPoint {
  stage: FunnelStage;
  reason: string;
  /** A separate diagnostic stream proves a possible cast, not the actual draw. */
  probeFill?: SlotFill;
}

/** Delegate every supported query to the real store, but detach people on
 * return. Most probes ask only for the household or hot tier; copying every
 * archived ancestor every year would make the instrument the entire cost.
 * Unrecognised methods fail closed, including every mutating operation. */
export function privateFunnelContext(ctx: SimCtx, cloneArcs = true): SimCtx {
  const copies = new Map<string, Person>();
  const copy = (person: Person): Person => {
    let detached = copies.get(person.id);
    if (!detached) {
      detached = structuredClone(person);
      copies.set(person.id, detached);
    }
    return detached;
  };
  const reads = new Set(['get', 'mustGet', 'all', 'living', 'household', 'blood',
    'guardian', 'householdOf', 'children', 'siblings', 'generationOf']);
  const people = new Proxy(ctx.world.people, {
    get(target, key) {
      if (typeof key !== 'string' || !reads.has(key)) {
        throw new Error(`Funnel probes cannot call PersonStore.${String(key)}`);
      }
      const query: unknown = Reflect.get(target, key);
      if (typeof query !== 'function') throw new Error(`Unknown PersonStore query ${key}`);
      return (...args: unknown[]) => {
        const value: unknown = Reflect.apply(query, target, args);
        if (Array.isArray(value)) return value.map(person => copy(person as Person));
        if (value && typeof value === 'object' && 'id' in value) return copy(value as Person);
        return value;
      };
    },
  });
  return {
    ...ctx,
    world: { ...ctx.world, people, arcs: cloneArcs ? structuredClone(ctx.world.arcs) : ctx.world.arcs },
    observeSelection: undefined, observeOutcome: undefined, observeDecision: undefined,
  };
}

const PREMISE_KEYS = ['flag', 'discrepancy', 'chronicled', 'arcFlag', 'arcVisited', 'tale', 'knowledge'] as const;

/** Partial evaluation: non-premise atoms remain unknown. In a mixed OR,
 * a false page is not a necessary missing premise if another arm could pass.
 * All leaf truth still comes from the production condition evaluator. */
function premiseTruth(condition: Condition | undefined, ctx: SimCtx,
  scope?: Parameters<typeof evalCondition>[2]): boolean | undefined {
  if (!condition) return undefined;
  if ('all' in condition || 'any' in condition) {
    const all = 'all' in condition;
    const children = all ? condition.all : condition.any;
    const values = children.map(child => premiseTruth(child, ctx, scope));
    if (!values.length) return undefined;
    if (all) {
      if (values.some(value => value === false)) return false;
      return values.every(value => value === true) ? true : undefined;
    }
    if (values.some(value => value === true)) return true;
    return values.every(value => value === false) ? false : undefined;
  }
  if ('not' in condition) {
    const value = premiseTruth(condition.not, ctx, scope);
    return value === undefined ? undefined : !value;
  }
  return PREMISE_KEYS.some(key => key in condition) ? evalCondition(condition, ctx, scope) : undefined;
}

/** Read one actual pre-selection state on detached diagnostic data. Ordinary
 * events use the production prefilter, frame reads use its own reader, and
 * arc bindings/absence policies go through dueArcSteps on copied instances. */
export function classifyFunnelPoint(ctx: SimCtx, event: EventTemplate): FunnelPoint {
  const probe = privateFunnelContext(ctx, Boolean(event.arc));
  const rng = streamFor(probe.world, 'funnel-trace', String(event.id));
  if (!eventInCampaign(event, probe.world.campaign)) return { stage: 'condition', reason: 'campaign' };

  if (event.tier === 'frame') {
    const missing = event.reads.find(read => !frameReadHolds(probe, read));
    if (missing) return { stage: 'premise', reason: `frame read: ${JSON.stringify(missing)}` };
  }

  if (event.arc) {
    const instances = [...probe.world.arcs.values()].filter(instance => instance.status === 'active'
      && instance.arc === event.arc!.of && instance.node === event.arc!.node);
    if (!instances.length) return { stage: 'premise', reason: `arc node not active: ${event.arc.of}/${event.arc.node}` };
    const possible = instances.filter(arc => premiseTruth(event.conditions, probe, { arc }) !== false);
    if (!possible.length) return { stage: 'premise', reason: 'arc prerequisite condition' };
    const due = possible.filter(arc => (arc.dueYear ?? 0) <= probe.world.year);
    if (!due.length) return { stage: 'condition', reason: 'arc not due' };
    const conditionsHold = new Set(due.filter(arc => evalCondition(event.conditions, probe, { arc })).map(arc => arc.id));
    const steps = dueArcSteps(probe, rng, event.tier === 'frame' ? 'frame' : 'tale');
    const step = steps.find(candidate => due.some(arc => arc.id === candidate.instance.id));
    if (step) return { stage: 'not_selected', reason: 'due arc cast proved on diagnostic stream', probeFill: step.fill };
    if (due.every(arc => arc.status === 'expired')) return { stage: 'condition', reason: 'arc expired' };
    if (due.some(arc => arc.status === 'active') && !conditionsHold.size) return { stage: 'condition', reason: 'arc other condition' };
    return { stage: 'cast', reason: 'due arc cannot retain or resolve its cast' };
  }

  if (event.tier !== 'frame' && premiseTruth(event.conditions, probe) === false) {
    return { stage: 'premise', reason: 'prerequisite condition' };
  }
  const cast = resolveSlots(event, probe, rng);
  if (!cast.ok) return { stage: 'cast', reason: cast.missing ? `slot ${cast.missing}` : 'cast resolution failed' };
  if (event.tier === 'frame') {
    if (!framePool(probe).some(candidate => candidate.id === event.id)) return { stage: 'condition', reason: 'normal frame pool / cooldown', probeFill: cast.fill };
  } else {
    const refusal = ambientExclusionReason(event, probe);
    if (refusal) return { stage: 'condition', reason: refusal, probeFill: cast.fill };
  }
  return { stage: 'not_selected', reason: 'eligible diagnostic cast; actual draw not assumed', probeFill: cast.fill };
}

interface WatchedState {
  event: EventTemplate;
  points: Map<number, FunnelPoint>;
  selected: Set<number>;
  castProved: Set<number>;
  eligible: Set<number>;
  failures: Record<string, number>;
}

export interface TemplateFunnel {
  id: string;
  frequency: EventTemplate['frequency'];
  legendary: boolean;
  sampledYears: number;
  stages: Record<FunnelStage, number>;
  reasons: Record<string, number>;
  castProvedYears: number;
  eligibleYears: number;
  selectedYears: number;
  firedYears: number;
  commits: number;
  branches: Record<string, number>;
  neverResolved: string[];
  actualCastFailures: Record<string, number>;
  conditions: EventTemplate['conditions'];
  reads: EventTemplate['reads'];
  slots: EventTemplate['slots'];
  arc: EventTemplate['arc'];
}

/** One run's instrument, attached to existing outcome/docket listeners and
 * actual selection checkpoints. If several pre-effect points occur in one
 * year, the annual row records the furthest stage actually demonstrated.
 * Speculative casts and real failed casts remain separately labelled. */
export class FunnelObserver {
  private watched = new Map<string, WatchedState>();
  private previous: Pick<SimCtx, 'observeSelection' | 'observeDecision' | 'observeOutcome'>;
  private detached = false;
  readonly frameDue = { true: 0, false: 0 };

  constructor(private ctx: SimCtx, ids: readonly string[]) {
    for (const id of ids) this.watched.set(id, {
      event: ctx.content.mustEvent(id), points: new Map(), selected: new Set(), castProved: new Set(), eligible: new Set(), failures: {},
    });
    this.previous = { observeSelection: ctx.observeSelection, observeDecision: ctx.observeDecision, observeOutcome: ctx.observeOutcome };
    ctx.observeSelection = observation => {
      this.onSelection(observation);
      this.previous.observeSelection?.(observation);
    };
    ctx.observeDecision = observation => {
      if (observation.decision.kind === 'choice') this.selected(observation.decision.event.id, observation.decision.year, true);
      this.previous.observeDecision?.(observation);
    };
    ctx.observeOutcome = observation => {
      this.selected(observation.event.id, ctx.world.year, true);
      this.previous.observeOutcome?.(observation);
    };
  }

  private record(state: WatchedState, year: number, point: FunnelPoint): void {
    if (point.probeFill !== undefined || point.stage === 'reached') state.castProved.add(year);
    if (point.stage === 'not_selected' || point.stage === 'reached') state.eligible.add(year);
    const previous = state.points.get(year);
    if (!previous || FUNNEL_STAGES.indexOf(point.stage) > FUNNEL_STAGES.indexOf(previous.stage)) state.points.set(year, point);
  }

  private selected(id: string, year: number, castProved = false): void {
    const state = this.watched.get(id);
    if (!state) return;
    state.selected.add(year);
    // Ambient/arc candidates resolve before selection; frames choose a name
    // first and may then fail their cast. Selection alone is not cast proof.
    if (castProved) {
      state.castProved.add(year);
      state.eligible.add(year);
    }
    this.record(state, year, { stage: 'unresolved', reason: 'actual selection / accepted decision; commit not yet assumed' });
  }

  private onSelection(observation: SelectionObservation): void {
    switch (observation.kind) {
      case 'before_draw':
        for (const state of this.watched.values()) {
          if (state.event.arc || state.event.tier === 'frame') continue;
          if (observation.forced.includes(state.event.id)) this.selected(state.event.id, observation.year, true);
          else this.record(state, observation.year, classifyFunnelPoint(this.ctx, state.event));
        }
        return;
      case 'before_frame':
        for (const state of this.watched.values()) {
          if (state.event.tier === 'frame' && !state.event.arc) this.record(state, observation.year, classifyFunnelPoint(this.ctx, state.event));
        }
        return;
      case 'before_arc_steps':
        for (const state of this.watched.values()) {
          if (!state.event.arc) continue;
          if (observation.layer === 'tale' && state.event.tier === 'frame') continue;
          if (observation.layer === 'frame' && state.event.tier !== 'frame') continue;
          this.record(state, observation.year, classifyFunnelPoint(this.ctx, state.event));
        }
        return;
      case 'frame_due':
        this.frameDue[observation.due ? 'true' : 'false']++;
        return;
      case 'cast_failure': {
        const state = this.watched.get(observation.event);
        if (state) {
          const key = `${observation.source}:${observation.missing ?? 'unspecified'}`;
          state.failures[key] = (state.failures[key] ?? 0) + 1;
          this.record(state, observation.year, { stage: 'cast', reason: `actual ${key} failure` });
        }
        return;
      }
      case 'selected':
        for (const candidate of observation.candidates) this.selected(candidate.event, observation.year, candidate.source !== 'frame');
        return;
      default: return assertNever(observation);
    }
  }

  finish(): TemplateFunnel[] {
    const reports: TemplateFunnel[] = [];
    for (const state of this.watched.values()) {
      const entries = this.ctx.world.decisionLog.filter(entry => entry.kind === 'outcome' && entry.event === state.event.id);
      const branches: Record<string, number> = {};
      const firedYears = new Set<number>();
      for (const entry of entries) {
        if (entry.kind !== 'outcome') continue;
        const key = outcomeKey(entry.event, entry.choiceId, entry.outcomeId);
        branches[key] = (branches[key] ?? 0) + 1;
        firedYears.add(entry.year);
        state.selected.add(entry.year); // A committed narration/frame was selected too.
        this.record(state, entry.year, { stage: 'reached', reason: 'actual committed outcome in decisionLog' });
      }
      for (const pending of this.ctx.world.pendingDecisions) {
        if (pending.kind === 'choice' && pending.event.id === state.event.id) this.selected(state.event.id, pending.year, true);
      }
      const interaction = state.event.interaction;
      const declared = interaction.kind === 'narration'
        ? interaction.outcomes.map(outcome => outcomeKey(state.event.id, undefined, outcome.id))
        : interaction.choices.flatMap(choice => choice.outcomes.map(outcome => outcomeKey(state.event.id, choice.id, outcome.id)));
      const stages = Object.fromEntries(FUNNEL_STAGES.map(stage => [stage, 0])) as Record<FunnelStage, number>;
      const reasons: Record<string, number> = {};
      for (const point of state.points.values()) {
        stages[point.stage]++;
        reasons[point.reason] = (reasons[point.reason] ?? 0) + 1;
      }
      reports.push({ id: state.event.id, frequency: state.event.frequency, legendary: state.event.frequency === 'mythic',
        sampledYears: state.points.size, stages, reasons,
        castProvedYears: state.castProved.size,
        eligibleYears: state.eligible.size,
        selectedYears: state.selected.size, firedYears: firedYears.size, commits: entries.length,
        branches, neverResolved: declared.filter(key => !branches[key]), actualCastFailures: state.failures,
        conditions: state.event.conditions, reads: state.event.reads, slots: state.event.slots, arc: state.event.arc });
    }
    if (!this.detached) {
      this.ctx.observeSelection = this.previous.observeSelection;
      this.ctx.observeDecision = this.previous.observeDecision;
      this.ctx.observeOutcome = this.previous.observeOutcome;
      this.detached = true;
    }
    return reports;
  }
}

export interface FunnelRun {
  seed: number;
  playedYears: number;
  control: 'exact complete saved-state JSON' | 'not sampled';
  frameDue: { true: number; false: number };
  templates: TemplateFunnel[];
}

export interface FunnelSource {
  reference: string;
  /** Authored writers are possible sources, not evidence that one resolved. */
  writers: string[];
}

/** Concrete authored inputs, including desugared inline launchers. This is a
 * reference index, not a second eligibility evaluator: negative predicates,
 * OR arms and conditional writes retain their original shapes in each row. */
export function funnelSources(source: ContentBundle | Content, id: string): FunnelSource[] {
  const content = indexContent(source);
  const event = content.mustEvent(id);
  const references = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const object = value as Record<string, unknown>;
    if (!('kind' in object)) {
      for (const key of PREMISE_KEYS) {
        if (typeof object[key] === 'string') references.add(`${key}:${object[key]}`);
      }
    }
    Object.values(object).forEach(walk);
  };
  walk(event.conditions);
  walk(event.reads);
  if (event.arc) references.add(`arc:${event.arc.of}`);
  const writers = new Map<string, Set<string>>();
  const add = (reference: string, where: string) => {
    if (!references.has(reference)) return;
    const entries = writers.get(reference) ?? new Set<string>();
    entries.add(where);
    writers.set(reference, entries);
  };
  const effects = (values: readonly Effect[], where: string, arc?: string) => {
    for (const effect of values) {
      if (effect.kind === 'flag') add(`flag:${effect.flag}`, `${where} sets ${JSON.stringify(effect.set)}`);
      if (effect.kind === 'knowledge') add(`knowledge:${effect.flag}`, `${where} ${effect.op}`);
      if (effect.kind === 'arc_flag' && arc === event.arc?.of) add(`arcFlag:${effect.flag}`, `${where} sets ${JSON.stringify(effect.set)}`);
      if (effect.kind === 'discrepancy' && effect.id) add(`discrepancy:${effect.id}`, `${where} ${effect.op}`);
      if (effect.kind === 'arc') add(`arc:${effect.arc}`, `${where} ${effect.op}`);
    }
  };
  for (const template of content.events) {
    add(`chronicled:${template.id}`, `event:${template.id} committed outcome (page survives every Record option)`);
    const branches = template.interaction.kind === 'narration'
      ? template.interaction.outcomes.map(outcome => ({ choice: undefined, outcome }))
      : template.interaction.choices.flatMap(choice => choice.outcomes.map(outcome => ({ choice: choice.id, outcome })));
    for (const { choice, outcome } of branches) {
      const where = outcomeKey(template.id, choice, outcome.id);
      effects(outcome.effects, where, template.arc?.of);
      if (outcome.triggers) add(`arc:${outcome.triggers.arc}`, `${where} ${outcome.triggers.op}`);
    }
    if (template.record) {
      for (const option of ['record', 'omit', 'embellish'] as const) effects(template.record.options[option].effects, `event:${template.id}/Record:${option}`, template.arc?.of);
      const knowledge = template.record.options.record.grantsKnowledge;
      if (knowledge) add(`knowledge:${knowledge}`, `event:${template.id}/Record:record grants`);
      add(`discrepancy:${template.record.options.embellish.discrepancy.id}`, `event:${template.id}/Record:embellish creates`);
    }
  }
  if (event.arc) {
    const arc = content.mustArc(event.arc.of);
    for (const node of arc.nodes) {
      for (const successor of node.successors) {
        if (successor.to === event.arc.node) add(`arc:${arc.id}`,
          `arc:${arc.id}/${node.id} event:${node.event} successor ${JSON.stringify(successor)}`);
      }
      add(`arcVisited:${node.id}`, `arc:${arc.id}/${node.id} event:${node.event} committed outcome`);
    }
  }
  return [...references].sort().map(reference => ({ reference, writers: [...(writers.get(reference) ?? [])].sort() }));
}

export interface FunnelSummary {
  id: string;
  /** Existing authored frequency is the evidence, never a new exemption. */
  legendaryEvidence?: string;
  houses: { sampled: number; castProved: number; eligible: number; selected: number; fired: number };
  stages: Record<FunnelStage, number>;
  branches: Record<string, number>;
  neverResolved: string[];
  actualCastFailures: Record<string, number>;
  sources: FunnelSource[];
}

/** Rank by actual firing households, with legendary rows explicitly labelled.
 * Annual stages and source candidates support the diagnosis; a source listed
 * here is not automatically the cause of a thin result. */
export function summariseFunnel(source: ContentBundle | Content, report: Pick<FunnelReport, 'ids' | 'rows'>): FunnelSummary[] {
  const content = indexContent(source);
  return report.ids.map(id => {
    const rows = report.rows.map(run => run.templates.find(row => row.id === id)).filter((row): row is TemplateFunnel => Boolean(row));
    const sumRecords = (records: Record<string, number>[]) => {
      const sum: Record<string, number> = {};
      for (const record of records) for (const [key, value] of Object.entries(record)) sum[key] = (sum[key] ?? 0) + value;
      return sum;
    };
    const branches = sumRecords(rows.map(row => row.branches));
    const declared = new Set(rows.flatMap(row => [...Object.keys(row.branches), ...row.neverResolved]));
    return {
      id, ...(content.mustEvent(id).frequency === 'mythic' ? { legendaryEvidence: 'Authored frequency: mythic; reported separately, not silently dropped' } : {}),
      houses: { sampled: rows.length, castProved: rows.filter(row => row.castProvedYears > 0).length,
        eligible: rows.filter(row => row.eligibleYears > 0).length,
        selected: rows.filter(row => row.selectedYears > 0).length, fired: rows.filter(row => row.commits > 0).length },
      stages: sumRecords(rows.map(row => row.stages)) as Record<FunnelStage, number>,
      branches, neverResolved: [...declared].filter(key => !branches[key]).sort(),
      actualCastFailures: sumRecords(rows.map(row => row.actualCastFailures)), sources: funnelSources(content, id),
    };
  }).sort((left, right) => Number(Boolean(left.legendaryEvidence)) - Number(Boolean(right.legendaryEvidence))
    || left.houses.fired - right.houses.fired || left.id.localeCompare(right.id));
}

export interface FunnelReport {
  requestedRuns: number;
  years: number;
  campaign: CampaignId;
  seeds: string;
  ids: string[];
  method: string;
  rows: FunnelRun[];
  ranked: FunnelSummary[];
}

/** Batch entry point. The fast tests import stage/observer helpers only. */
export function runFunnel(source: ContentBundle, ids: readonly string[], options: {
  runs?: number; years?: number; campaign?: CampaignId; controls?: number;
  onRun?: (report: FunnelReport) => void;
} = {}): FunnelReport {
  const runs = options.runs ?? 200;
  const years = options.years ?? 500;
  const campaign = options.campaign ?? 'long';
  const controls = Math.min(runs, options.controls ?? 8);
  if (![runs, years].every(value => Number.isInteger(value) && value > 0)
    || !Number.isInteger(controls) || controls < 0) throw new Error('Positive integer runs/years and nonnegative controls required');
  const report: FunnelReport = { requestedRuns: runs, years, campaign, ids: [...new Set(ids)],
    seeds: '5000 + 7*i, i=0..runs-1',
    method: 'Actual pre-effect ambient/frame/arc checkpoints. resolveSlots uses its own funnel-trace stream on detached people and copied arc instances. Annual rows retain the furthest demonstrated stage; actual commits and cast failures are separate. Normal frame-pool eligibility is reported; actual cadence and overdue repeats remain in the real run.',
    rows: [], ranked: [] };
  for (let index = 0; index < runs; index++) {
    const seed = 5000 + 7 * index;
    const ctx = bootstrap(source, seed, START_YEAR, campaign);
    const observer = new FunnelObserver(ctx, report.ids);
    runYears(ctx, years);
    const templates = observer.finish();
    let control: FunnelRun['control'] = 'not sampled';
    if (index < controls) {
      const untraced = bootstrap(source, seed, START_YEAR, campaign);
      runYears(untraced, years);
      if (canonical(saveGame(ctx)) !== canonical(saveGame(untraced))) throw new Error(`Funnel changed the complete saved run ${seed}`);
      control = 'exact complete saved-state JSON';
    }
    report.rows.push({ seed, playedYears: ctx.world.year - START_YEAR, control, frameDue: { ...observer.frameDue }, templates });
    report.ranked = summariseFunnel(ctx.content, report);
    options.onRun?.(report);
  }
  return report;
}

const DEFAULT_IDS = ['the_codex_in_the_eastern_invoice', 'the_marrow_codex_offered', 'the_hall_is_answered',
  'waking_early', 'eight_days_and_then_it_did', 'the_hall_stops_writing',
  'the_north_wind_finds_the_patch', 'the_west_wing_roof', 'what_hangs_in_smoke', 'a_birth_in_the_house',
  'the_hand_the_warden_accepts'];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (key: string) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  const source = loadContent();
  const ids = args.filter(arg => !arg.startsWith('--'));
  const selected = ids.length ? ids : [...DEFAULT_IDS, ...source.events.filter(event => event.tier === 'frame').map(event => String(event.id))];
  const campaign = value('campaign') ?? 'long';
  campaignDef(campaign as CampaignId); // The shared campaign registry validates it.
  const output = value('output');
  const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim());
  const report = runFunnel(source.bundle, selected, {
    runs: Number(value('runs') ?? 200), years: Number(value('years') ?? 500),
    campaign: campaign as CampaignId, controls: Number(value('controls') ?? 8),
    onRun(partial) {
      if (output) {
        writeFileSync(output + '.tmp', JSON.stringify({ sourceRevision, dirty, ...partial }) + '\n');
        renameSync(output + '.tmp', output);
      }
      console.log(`funnel: ${partial.rows.length}/${partial.requestedRuns} houses; seed ${partial.rows.at(-1)!.seed}`);
    },
  });
  if (!output) console.log(JSON.stringify({ sourceRevision, dirty, ...report }, null, 2));
}
