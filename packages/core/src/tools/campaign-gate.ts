import { loadContent } from '@ed/content';
import {
  RITE_OF_RUNG, RUNG_ORDER, compare, indexContent,
  type CampaignId, type Condition, type Content, type ContentBundle, type Rung,
} from '@ed/schema';
import {
  CAMPAIGNS, FULL_CAMPAIGN_IDS, isLateCampaignYear,
  type CampaignDef, type FullCampaignId,
} from '../campaign.js';
import { minimumArcYears } from '../events/arc-reach.js';
import { measureDensity, type ChoiceVisit } from './density-gate.js';

type Campaigns = Readonly<Record<FullCampaignId, CampaignDef>>;
type Truths = ReadonlySet<boolean>;
export type CampaignPolicy = 'chronicler' | 'ascendant';

export interface CampaignPlayedSourceRun {
  seed: number;
  ending: string;
  clauses: number;
  templateFires?: Record<string, number>;
}

export interface CampaignStaticView {
  id: CampaignId;
  name: string;
  years: number;
  clauseCapacity: number;
  authoredClauses: string[];
  endings: string[];
  exclusiveEndings: string[];
  rungs: Rung[];
  rites: { rung: 'vessel' | 'demigod' | 'god'; rite: string }[];
  exclusiveEvents: string[];
  exclusiveArcs: string[];
}

export interface CampaignStaticReport {
  campaigns: CampaignStaticView[];
}

export interface CampaignPlayedRun {
  seed: number;
  campaign: CampaignId;
  policy: CampaignPolicy;
  ending: string;
  clauses: number;
  exclusiveEvents: string[];
  exclusiveEnding?: string;
  beyondShortClauses: number;
  /** Distinct campaign-only things this run actually reached. */
  exclusiveItems: number;
  /** First year this policy run reached structurally campaign-exclusive material. */
  firstExclusiveYear?: number;
}

export interface CampaignYearVisit {
  year: number;
  clauses: number;
  ending?: string;
  templateFires: Readonly<Record<string, number>>;
}

export interface CampaignDivergenceRun {
  seed: number;
  sharedPrefix: number;
  divergenceYear?: number;
  sameYearOverlap: number;
  comparedBeforeShortTerm: number;
  /** Choice presentations in the Long Line's final fifth. */
  lateLongChoices: number;
  /** Those late choices whose canonical #271 category shape never appeared in Short. */
  lateLongUniqueShapeChoices: number;
  lateLongUniqueShapeShare: number;
}

export interface CampaignPlayedReport {
  runs: CampaignPlayedRun[];
  divergence: CampaignDivergenceRun[];
}

/**
 * WHAT CAN THIS CONDITION SAY DURING THIS CAMPAIGN?
 *
 * Unknown simulation state is deliberately BOTH true and false: this report is
 * an inventory, not a second event selector. It only rules content out where
 * the campaign itself makes a predicate impossible.
 */
export function conditionTruths(
  condition: Condition,
  campaign: CampaignDef,
  content: Content,
): Truths {
  if ('all' in condition) {
    const xs = condition.all.map((c) => conditionTruths(c, campaign, content));
    return truths(xs.every((x) => x.has(true)), xs.some((x) => x.has(false)));
  }
  if ('any' in condition) {
    const xs = condition.any.map((c) => conditionTruths(c, campaign, content));
    return truths(xs.some((x) => x.has(true)), xs.every((x) => x.has(false)));
  }
  if ('not' in condition) {
    const x = conditionTruths(condition.not, campaign, content);
    return truths(x.has(false), x.has(true));
  }

  if ('campaignProgress' in condition) {
    const values = Array.from(
      { length: campaign.years + 1 },
      (_, i) => campaign.years === 0 ? 1 : i / campaign.years,
    );
    return comparedTruths(values, condition.campaignProgress.op, condition.campaignProgress.value);
  }

  if ('year' in condition) {
    const values = Array.from(
      { length: campaign.years + 1 },
      (_, i) => campaign.startYear + i,
    );
    return comparedTruths(values, condition.year.op, condition.year.value);
  }

  if ('clausesRecovered' in condition) {
    const max = Math.max(0, Math.min(campaign.clauses, content.clauses.length));
    const values = Array.from({ length: max + 1 }, (_, i) => i);
    return comparedTruths(values, condition.clausesRecovered.op, condition.clausesRecovered.value);
  }

  if ('arcCanFinish' in condition) {
    const arc = content.arc(condition.arcCanFinish);
    if (!arc) return new Set([false]);
    const minimum = minimumArcYears(arc);
    const values = Array.from({ length: campaign.years + 1 }, (_, i) => campaign.years - i);
    const answers = values.map((remaining) => remaining >= minimum);
    return new Set(answers);
  }

  return new Set([true, false]);
}

function truths(canTrue: boolean, canFalse: boolean): Truths {
  const out = new Set<boolean>();
  if (canTrue) out.add(true);
  if (canFalse) out.add(false);
  return out;
}

function comparedTruths(values: number[], op: Parameters<typeof compare>[1], target: number): Truths {
  const answers = values.map((value) => compare(value, op, target));
  return new Set(answers);
}

function canEverFire(condition: Condition | undefined, campaign: CampaignDef, content: Content): boolean {
  return condition === undefined || conditionTruths(condition, campaign, content).has(true);
}

/**
 * STATIC DIFFERENCE BETWEEN PRODUCT SHAPES (#274).
 *
 * This is intentionally conservative. An event is called exclusive only when
 * the campaign clock, clause ceiling, or derived arc duration makes its
 * condition impossible in the other campaign. Age draws, family state and
 * random outcomes remain possible rather than being guessed at here.
 */
export function campaignStaticReport(
  source: ContentBundle | Content,
  campaigns: Campaigns = CAMPAIGNS,
): CampaignStaticReport {
  const content = indexContent(source);
  const ids = FULL_CAMPAIGN_IDS;
  const endingSets = Object.fromEntries(ids.map((id) => [id, new Set(campaigns[id].endings)])) as Record<FullCampaignId, Set<string>>;

  const possibleEvents = Object.fromEntries(ids.map((id) => [
    id,
    new Set(content.events.filter((event) => canEverFire(event.conditions, campaigns[id], content)).map((event) => String(event.id))),
  ])) as Record<FullCampaignId, Set<string>>;

  const possibleArcs = Object.fromEntries(ids.map((id) => [
    id,
    // Inventory the authored story catalogue, not synthetic inline-followup
    // arcs produced by indexContent(). `arcCanFinish` above still resolves
    // through the compiled index when a condition actually names one.
    new Set(content.bundle.arcs
      .filter((arc) => minimumArcYears(arc) <= campaigns[id].years)
      .map((arc) => String(arc.id))),
  ])) as Record<FullCampaignId, Set<string>>;

  const rites = Object.entries(RITE_OF_RUNG)
    .map(([rung, rite]) => ({ rung: rung as 'vessel' | 'demigod' | 'god', rite: String(rite) }));

  return {
    campaigns: ids.map((id) => {
      const others = ids.filter((other) => other !== id);
      const exclusiveEndings = [...endingSets[id]]
        .filter((ending) => others.every((other) => !endingSets[other].has(ending)))
        .sort();
      const exclusiveEvents = [...possibleEvents[id]]
        .filter((event) => others.every((other) => !possibleEvents[other].has(event)))
        .sort();
      const exclusiveArcs = [...possibleArcs[id]]
        .filter((arc) => others.every((other) => !possibleArcs[other].has(arc)))
        .sort();

      return {
        id,
        name: campaigns[id].name,
        years: campaigns[id].years,
        clauseCapacity: Math.min(campaigns[id].clauses, content.clauses.length),
        authoredClauses: content.clauses.map((clause) => String(clause.id)).sort(),
        endings: [...campaigns[id].endings].map(String).sort(),
        exclusiveEndings,
        rungs: [...RUNG_ORDER],
        rites,
        exclusiveEvents,
        exclusiveArcs,
      };
    }),
  };
}

/**
 * Reduce one played run to the product-shape facts #274 cares about.
 *
 * templateFires is already collected by ending-gate, so this stays a report
 * over existing telemetry rather than a second simulation instrument.
 */
export function campaignReachOf(
  run: CampaignPlayedSourceRun,
  campaign: CampaignId,
  policy: CampaignPolicy,
  report: CampaignStaticReport,
  firstExclusiveYear?: number,
): CampaignPlayedRun {
  const row = report.campaigns.find((x) => x.id === campaign);
  if (!row) throw new Error(`campaign report is missing ${campaign}`);
  const short = report.campaigns.find((x) => x.id === 'short');
  if (!short) throw new Error('campaign report is missing short');

  const fires = run.templateFires ?? {};
  const exclusiveEvents = row.exclusiveEvents
    .filter((id) => (fires[id] ?? 0) > 0)
    .sort();
  const exclusiveEnding = row.exclusiveEndings.includes(run.ending)
    ? String(run.ending) : undefined;
  const beyondShortClauses = campaign === 'long'
    ? Math.max(0, run.clauses - short.clauseCapacity)
    : 0;

  return {
    seed: run.seed,
    campaign,
    policy,
    ending: String(run.ending),
    clauses: run.clauses,
    exclusiveEvents,
    exclusiveEnding,
    beyondShortClauses,
    exclusiveItems: exclusiveEvents.length + (exclusiveEnding ? 1 : 0) + beyondShortClauses,
    ...(firstExclusiveYear !== undefined ? { firstExclusiveYear } : {}),
  };
}

/**
 * Date the first structurally campaign-exclusive thing reached by one existing
 * chronicler/ascendant policy run.
 *
 * `templateFires` is cumulative, so the first yearly snapshot containing an
 * exclusive event is the first year that event fired. Clause capacity and an
 * exclusive ending are read from that same run; no second policy simulator is
 * involved. #272's measured-choice observer remains separate and authoritative
 * for the category-shape comparison below.
 */
export function campaignFirstExclusiveYear(
  years: readonly CampaignYearVisit[],
  campaign: CampaignId,
  report: CampaignStaticReport,
): number | undefined {
  const row = report.campaigns.find((x) => x.id === campaign);
  if (!row) throw new Error(`campaign report is missing ${campaign}`);
  const short = report.campaigns.find((x) => x.id === 'short');
  if (!short) throw new Error('campaign report is missing short');

  for (const visit of years) {
    const exclusiveEvent = row.exclusiveEvents.some((id) => (visit.templateFires[id] ?? 0) > 0);
    const exclusiveEnding = visit.ending !== undefined && row.exclusiveEndings.includes(visit.ending);
    const beyondShortClauses = campaign === 'long' && visit.clauses > short.clauseCapacity;
    if (exclusiveEvent || exclusiveEnding || beyondShortClauses) return visit.year;
  }
  return undefined;
}

export function campaignStreamDifference(
  seed: number,
  short: readonly ChoiceVisit[],
  long: readonly ChoiceVisit[],
  shortEndYear: number,
): CampaignDivergenceRun {
  const shared = Math.min(short.length, long.length);
  let sharedPrefix = 0;
  while (
    sharedPrefix < shared
    && short[sharedPrefix]!.id === long[sharedPrefix]!.id
    && short[sharedPrefix]!.year === long[sharedPrefix]!.year
  ) {
    sharedPrefix += 1;
  }
  const firstDifferent = short[sharedPrefix] ?? long[sharedPrefix];

  const shortSameYear = new Set(short.map((decision) => `${decision.year}\u0000${decision.id}`));
  const beforeTerm = long.filter((decision) => decision.year <= shortEndYear);
  const sameYear = beforeTerm.filter((decision) =>
    shortSameYear.has(`${decision.year}\u0000${decision.id}`)).length;

  // This is #271's category shape as observed by #272's live-choice hook.
  // Nothing in this file projects effects into a second shape vocabulary.
  const shortShapes = new Set(short.map((decision) => decision.category));
  const lateLong = long.filter((decision) => isLateCampaignYear(decision.year, CAMPAIGNS.long));
  const uniqueLate = lateLong.filter((decision) => !shortShapes.has(decision.category)).length;

  return {
    seed,
    sharedPrefix,
    ...(firstDifferent ? { divergenceYear: firstDifferent.year } : {}),
    sameYearOverlap: beforeTerm.length ? sameYear / beforeTerm.length : 0,
    comparedBeforeShortTerm: beforeTerm.length,
    lateLongChoices: lateLong.length,
    lateLongUniqueShapeChoices: uniqueLate,
    lateLongUniqueShapeShare: lateLong.length ? uniqueLate / lateLong.length : 0,
  };
}

interface CampaignObservedRun {
  choices: ChoiceVisit[];
}

function campaignObservedRun(
  source: ContentBundle | Content,
  seed: number,
  campaign: CampaignId,
): CampaignObservedRun {
  const choices: ChoiceVisit[] = [];
  measureDensity(source, seed, CAMPAIGNS[campaign].years, {
    campaign,
    onChoice: (visit) => choices.push(visit),
  });
  return { choices };
}

/** Play the same seeds in both products, under ordinary and intentional ladder play. */
export async function campaignPlayedReport(
  source: ContentBundle | Content,
  seeds: readonly number[],
): Promise<CampaignPlayedReport> {
  // Keep the whole-game runner off the import graph of this module's fast
  // tests. The played report is a CLI/diagnostic path; the reducer above is
  // what belongs in the fast lane.
  const { playToTheEnd } = await import('./ending-gate.js');
  const statics = campaignStaticReport(source);
  const runs: CampaignPlayedRun[] = [];
  for (const campaign of FULL_CAMPAIGN_IDS) {
    const years = CAMPAIGNS[campaign].years;
    for (const policy of ['chronicler', 'ascendant'] as const) {
      for (const seed of seeds) {
        const timeline: CampaignYearVisit[] = [];
        const played = playToTheEnd(
          source,
          seed,
          years,
          policy,
          campaign,
          (visit) => timeline.push(visit),
        );
        const firstExclusiveYear = campaignFirstExclusiveYear(timeline, campaign, statics);
        runs.push(campaignReachOf(
          played,
          campaign,
          policy,
          statics,
          firstExclusiveYear,
        ));
      }
    }
  }
  const divergence = seeds.map((seed) => {
    const short = campaignObservedRun(source, seed, 'short');
    const long = campaignObservedRun(source, seed, 'long');
    return campaignStreamDifference(
      seed,
      short.choices,
      long.choices,
      CAMPAIGNS.short.endYear,
    );
  });
  return { runs, divergence };
}

export function campaignPlayedLines(report: CampaignPlayedReport): string[] {
  const out: string[] = [];
  for (const campaign of FULL_CAMPAIGN_IDS) {
    for (const policy of ['chronicler', 'ascendant'] as const) {
      const rows = report.runs.filter((r) => r.campaign === campaign && r.policy === policy);
      if (!rows.length) continue;
      const reached = rows.filter((r) => r.exclusiveItems > 0).length;
      const firstYears = rows
        .map((r) => r.firstExclusiveYear)
        .filter((year): year is number => year !== undefined);
      const eventCounts = new Map<string, number>();
      const endingCounts = new Map<string, number>();
      let clauseRuns = 0;
      let items = 0;
      for (const row of rows) {
        items += row.exclusiveItems;
        if (row.beyondShortClauses > 0) clauseRuns += 1;
        for (const id of row.exclusiveEvents) eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1);
        if (row.exclusiveEnding) endingCounts.set(row.exclusiveEnding, (endingCounts.get(row.exclusiveEnding) ?? 0) + 1);
      }
      const list = (counts: Map<string, number>) => [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id, count]) => `${id} ${count}/${rows.length}`)
        .join(', ') || 'none';
      out.push(
        `${CAMPAIGNS[campaign].name} / ${policy}: ${rows.length} runs`,
        `  reached campaign-exclusive material: ${reached}/${rows.length}`,
        `  first campaign-exclusive reach: ${firstYears.length ? `${Math.min(...firstYears)}–${Math.max(...firstYears)}` : 'none'}`,
        `  mean exclusive items: ${(items / rows.length).toFixed(2)}`,
        `  exclusive endings: ${list(endingCounts)}`,
        `  exclusive events: ${list(eventCounts)}`,
        `  beyond Short's clause capacity: ${clauseRuns}/${rows.length}`,
      );
    }
  }
  if (report.divergence.length) {
    const prefixes = report.divergence.map((row) => row.sharedPrefix);
    const years = report.divergence
      .map((row) => row.divergenceYear)
      .filter((year): year is number => year !== undefined);
    const overlap = report.divergence.reduce((sum, row) => sum + row.sameYearOverlap, 0)
      / report.divergence.length;
    const lateChoices = report.divergence.reduce((sum, row) => sum + row.lateLongChoices, 0);
    const lateUnique = report.divergence.reduce(
      (sum, row) => sum + row.lateLongUniqueShapeChoices, 0,
    );
    out.push(
      'same-seed Short → Long measured-choice stream:',
      `  shared opening prefix: mean ${(prefixes.reduce((a, b) => a + b, 0) / prefixes.length).toFixed(1)}, range ${Math.min(...prefixes)}–${Math.max(...prefixes)} choices`,
      `  first divergence year: ${years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'none'}`,
      `  Long pre-${CAMPAIGNS.short.endYear} choices also in Short in the same year: ${(100 * overlap).toFixed(1)}%`,
      `  late-Long choices with a #271 category shape absent from Short: ${lateUnique}/${lateChoices} (${(100 * (lateChoices ? lateUnique / lateChoices : 0)).toFixed(1)}%)`,
    );
  }
  return out;
}

export function campaignStaticLines(report: CampaignStaticReport): string[] {
  const out: string[] = [];
  for (const row of report.campaigns) {
    out.push(
      `${row.name} (${row.years} years)`,
      `  endings: ${row.endings.join(', ') || 'none'}`,
      `  exclusive endings: ${row.exclusiveEndings.join(', ') || 'none'}`,
      `  clauses: up to ${row.clauseCapacity} of ${row.authoredClauses.length} authored`,
      `  rungs: ${row.rungs.join(' → ')}`,
      `  rites: ${row.rites.map((x) => `${x.rung}=${x.rite}`).join(', ') || 'none'}`,
      `  exclusive events: ${row.exclusiveEvents.join(', ') || 'none'}`,
      `  exclusive arcs: ${row.exclusiveArcs.join(', ') || 'none'}`,
    );
  }
  return out;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('campaign-gate.ts');
if (isMain) {
  const source = loadContent();
  const report = campaignStaticReport(source);
  for (const line of campaignStaticLines(report)) console.log(line);

  const argv = process.argv.slice(2);
  if (!argv.includes('--static')) {
    const runs = Number(argv.find((a) => !a.startsWith('--')) ?? 12);
    const seeds = Array.from({ length: Math.max(1, runs) }, (_, i) => 901 + i);
    console.log('');
    console.log(`played reach, ${seeds.length} shared seeds per campaign/policy`);
    for (const line of campaignPlayedLines(await campaignPlayedReport(source, seeds))) console.log(line);
  }
}
