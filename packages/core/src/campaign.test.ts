import { describe, expect, it } from 'vitest';
import {
  CAMPAIGNS,
  CAMPAIGN_YEARS,
  FULL_CAMPAIGN_IDS,
  END_YEAR,
  LATE_PHASE_START,
  START_YEAR,
  campaignDef,
  campaignProgress,
  isLateCampaignYear,
} from './campaign.js';

describe('campaign profiles (#66, #133)', () => {
  it('defines the full campaigns and the demo term from one source', () => {
    expect(campaignDef('short')).toEqual({
      id: 'short',
      name: 'A Short Line',
      startYear: 1042,
      endYear: 1342,
      years: 300,
      clauses: 3,
      endings: ['broken_line', 'settled', 'forgotten', 'devoured'],
    });
    expect(campaignDef('long')).toEqual({
      id: 'long',
      name: 'A Long Line',
      startYear: 1042,
      endYear: 1542,
      years: 500,
      clauses: 9,
      endings: ['apotheosis', 'unmade', 'broken_line', 'forgotten', 'devoured'],
    });
    expect(campaignDef('demo')).toEqual({
      id: 'demo',
      name: 'A Demonstration',
      startYear: 1042,
      endYear: 1075,
      years: 33,
      clauses: 1,
      endings: ['broken_line', 'settled', 'forgotten', 'devoured'],
    });
    expect(FULL_CAMPAIGN_IDS).toEqual(['short', 'long']);
  });

  it('keeps the compatibility constants pointed at Long Line', () => {
    expect(START_YEAR).toBe(CAMPAIGNS.long.startYear);
    expect(END_YEAR).toBe(CAMPAIGNS.long.endYear);
    expect(CAMPAIGN_YEARS).toBe(CAMPAIGNS.long.years);
    expect(LATE_PHASE_START).toBe(1442);
  });

  it('measures progress against the selected campaign', () => {
    expect(campaignProgress(1042, CAMPAIGNS.short)).toBe(0);
    expect(campaignProgress(1192, CAMPAIGNS.short)).toBe(0.5);
    expect(campaignProgress(1342, CAMPAIGNS.short)).toBe(1);

    expect(campaignProgress(1292, CAMPAIGNS.long)).toBe(0.5);
    expect(campaignProgress(1542, CAMPAIGNS.long)).toBe(1);
  });

  it('puts the late phase in the final fifth of either campaign', () => {
    expect(isLateCampaignYear(1282, CAMPAIGNS.short)).toBe(false);
    expect(isLateCampaignYear(1283, CAMPAIGNS.short)).toBe(true);

    expect(isLateCampaignYear(1442, CAMPAIGNS.long)).toBe(false);
    expect(isLateCampaignYear(1443, CAMPAIGNS.long)).toBe(true);
    expect(isLateCampaignYear(1542)).toBe(true);
  });
});
