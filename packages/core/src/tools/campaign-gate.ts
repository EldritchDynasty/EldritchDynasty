import { loadContent } from '@ed/content';
import {
  CampaignIdS, RITE_OF_RUNG, RUNG_ORDER, compare, indexContent,
  type CampaignId, type Condition, type Content, type ContentBundle, type Rung,
} from '@ed/schema';
import { CAMPAIGNS, type CampaignDef } from '../campaign.js';
import { minimumArcYears } from '../events/arc-reach.js';

type Campaigns = Readonly<Record<CampaignId, CampaignDef>>;
type Truths = ReadonlySet<boolean>;

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
  const ids = CampaignIdS.options;
  const endingSets = Object.fromEntries(ids.map((id) => [id, new Set(campaigns[id].endings)]))
    as Record<CampaignId, Set<string>>;

  const possibleEvents = Object.fromEntries(ids.map((id) => [
    id,
    new Set(content.events.filter((event) => canEverFire(event.conditions, campaigns[id], content)).map((event) => String(event.id))),
  ])) as Record<CampaignId, Set<string>>;

  const possibleArcs = Object.fromEntries(ids.map((id) => [
    id,
    // Inventory the authored story catalogue, not synthetic inline-followup
    // arcs produced by indexContent(). `arcCanFinish` above still resolves
    // through the compiled index when a condition actually names one.
    new Set(content.bundle.arcs
      .filter((arc) => minimumArcYears(arc) <= campaigns[id].years)
      .map((arc) => String(arc.id))),
  ])) as Record<CampaignId, Set<string>>;

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
  const report = campaignStaticReport(loadContent());
  for (const line of campaignStaticLines(report)) console.log(line);
}
