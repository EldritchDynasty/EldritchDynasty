import type { CampaignId, EndingId } from '@ed/schema';

/**
 * THE CAMPAIGN CLOCK (issues #66 and #133).
 *
 * A campaign is a product shape, not a global. Long remains the compatibility
 * default while #66 threads the selected profile through world/save/session
 * state. Keeping the definitions here means that work can replace reads of the
 * old module constants without creating a second source of truth.
 */
export const FULL_CAMPAIGN_IDS = ['short', 'long'] as const satisfies readonly CampaignId[];
export type FullCampaignId = (typeof FULL_CAMPAIGN_IDS)[number];

export interface CampaignDef {
  id: CampaignId;
  name: string;
  startYear: number;
  endYear: number;
  years: number;
  /** How many clauses make this campaign's Ledger contract complete. */
  clauses: number;
  /** The last-night outcomes this product profile promises. */
  endings: readonly EndingId[];
}


export const CAMPAIGNS: Readonly<Record<CampaignId, CampaignDef>> = {
  short: {
    id: 'short',
    name: 'A Short Line',
    startYear: 1042,
    endYear: 1342,
    years: 300,
    clauses: 3,
    endings: ['broken_line', 'settled', 'forgotten', 'devoured'],
  },
  long: {
    id: 'long',
    name: 'A Long Line',
    startYear: 1042,
    endYear: 1542,
    years: 500,
    clauses: 9,
    endings: ['apotheosis', 'unmade', 'broken_line', 'forgotten', 'devoured'],
  },
  /**
   * Track C of #323: the same game in miniature, not a second mode.
   *
   * The profile owns only the clock/contract/ending envelope. Guaranteed demo
   * beats (one complete Age, a Record decision, an interlude and its verdict)
   * are structural work layered on the normal machinery rather than flags
   * spread through the simulation.
   */
  demo: {
    id: 'demo',
    name: 'A Demonstration',
    startYear: 1042,
    endYear: 1075,
    years: 33,
    clauses: 1,
    endings: ['broken_line', 'settled', 'forgotten', 'devoured'],
  },
};

export function campaignDef(id: CampaignId): CampaignDef {
  return CAMPAIGNS[id];
}

/**
 * Compatibility aliases for code that still means "the current shipped Long
 * Line". #66 should remove gameplay dependence on these as campaign identity is
 * threaded through WorldState; keeping them meanwhile makes this first change
 * inert for existing Long-Line runs.
 */
export const START_YEAR = CAMPAIGNS.long.startYear;
export const END_YEAR = CAMPAIGNS.long.endYear;
export const CAMPAIGN_YEARS = CAMPAIGNS.long.years;

/** The old 1,000-year curve became harsher in its final 20% (after 1842). */
export const LATE_PHASE_FRACTION = 0.2;
export const LATE_PHASE_START = END_YEAR - CAMPAIGN_YEARS * LATE_PHASE_FRACTION;

/**
 * Preserve the old boundary convention: the threshold year itself is ordinary,
 * and the following year begins the late-game weighting.
 */
export function isLateCampaignYear(year: number, campaign: CampaignDef = CAMPAIGNS.long): boolean {
  const latePhaseStart = campaign.endYear - campaign.years * LATE_PHASE_FRACTION;
  return year > latePhaseStart;
}

/** A campaign-relative clock for authored early/middle/late conditions. */
export function campaignProgress(year: number, campaign: CampaignDef = CAMPAIGNS.long): number {
  return Math.max(0, Math.min(1, (year - campaign.startYear) / campaign.years));
}
