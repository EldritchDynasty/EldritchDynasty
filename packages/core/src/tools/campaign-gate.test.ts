import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, type CampaignId } from '@ed/schema';
import { CAMPAIGNS, type CampaignDef } from '../campaign.js';
import { campaignPlayedLines, campaignReachOf, campaignStaticLines, campaignStaticReport, conditionTruths, type CampaignPlayedSourceRun } from './campaign-gate.js';

describe('static campaign difference report', () => {
  const content = indexContent(loadContent());

  it('derives the shipped ending split from campaign definitions', () => {
    const report = campaignStaticReport(content);
    const short = report.campaigns.find((row) => row.id === 'short');
    const long = report.campaigns.find((row) => row.id === 'long');

    expect(short?.exclusiveEndings).toEqual(['settled']);
    expect(long?.exclusiveEndings).toEqual(['apotheosis', 'unmade']);
    expect(short?.clauseCapacity).toBe(3);
    expect(long?.clauseCapacity).toBe(9);

    // Closed vocabularies are read from schema, not copied into this tool.
    expect(short?.rungs).toEqual(long?.rungs);
    expect(short?.rites).toEqual(long?.rites);
    expect(short?.rites).toEqual([
      { rung: 'vessel', rite: 'vessel' },
      { rung: 'demigod', rite: 'great_rite' },
      { rung: 'god', rite: 'unmaking' },
    ]);
  });

  it('reads fixture campaign definitions rather than a hand-written ending answer', () => {
    const fixtures: Readonly<Record<CampaignId, CampaignDef>> = {
      short: {
        ...CAMPAIGNS.short,
        endings: ['forgotten', 'unmade'],
      },
      long: {
        ...CAMPAIGNS.long,
        endings: ['forgotten', 'settled'],
      },
    };

    const report = campaignStaticReport(content, fixtures);
    const short = report.campaigns.find((row) => row.id === 'short');
    const long = report.campaigns.find((row) => row.id === 'long');

    expect(short?.exclusiveEndings).toEqual(['unmade']);
    expect(long?.exclusiveEndings).toEqual(['settled']);
  });

  it('distinguishes campaign limits from relative campaign progress', () => {
    const progress = { campaignProgress: { op: 'gte' as const, value: 0.8 } };
    const fourthClause = { clausesRecovered: { op: 'gte' as const, value: 4 } };
    const afterShortTerm = { year: { op: 'gt' as const, value: CAMPAIGNS.short.endYear } };

    // Eighty per cent exists in both products because progress is RELATIVE.
    expect(conditionTruths(progress, CAMPAIGNS.short, content).has(true)).toBe(true);
    expect(conditionTruths(progress, CAMPAIGNS.long, content).has(true)).toBe(true);

    // Four recovered clauses and a year after 1342 are structurally impossible
    // inside the Short product, but possible in the Long one.
    expect(conditionTruths(fourthClause, CAMPAIGNS.short, content)).toEqual(new Set([false]));
    expect(conditionTruths(fourthClause, CAMPAIGNS.long, content).has(true)).toBe(true);
    expect(conditionTruths(afterShortTerm, CAMPAIGNS.short, content)).toEqual(new Set([false]));
    expect(conditionTruths(afterShortTerm, CAMPAIGNS.long, content).has(true)).toBe(true);
  });

  it('prints deterministic headings and the exclusive endings', () => {
    const lines = campaignStaticLines(campaignStaticReport(content));
    const text = lines.join('\n');

    expect(text).toContain('A Short Line (300 years)');
    expect(text).toContain('exclusive endings: settled');
    expect(text).toContain('A Long Line (500 years)');
    expect(text).toContain('exclusive endings: apotheosis, unmade');
    expect(text).toContain('clauses: up to 3 of 9 authored');
  });
  it('counts only campaign-exclusive material a played run actually reaches', () => {
    const staticReport = {
      campaigns: [
        { id: 'short', name: 'A Short Line', years: 300, clauseCapacity: 3, authoredClauses: [], endings: ['settled'], exclusiveEndings: ['settled'], rungs: [], rites: [], exclusiveEvents: ['short_only'], exclusiveArcs: [] },
        { id: 'long', name: 'A Long Line', years: 500, clauseCapacity: 9, authoredClauses: [], endings: ['apotheosis'], exclusiveEndings: ['apotheosis'], rungs: [], rites: [], exclusiveEvents: ['late_long', 'never_seen'], exclusiveArcs: [] },
      ],
    } as ReturnType<typeof campaignStaticReport>;
    const run = {
      seed: 901, policy: 'ascendant', ending: 'apotheosis', attested: 'none', clauses: 5,
      survivors: 1, householdLow: 1, bloodLeft: 1, bloodLow: 1,
      templateFires: { late_long: 2, ordinary: 10 },
    } as CampaignPlayedSourceRun;

    expect(campaignReachOf(run, 'long', 'ascendant', staticReport)).toMatchObject({
      exclusiveEvents: ['late_long'],
      exclusiveEnding: 'apotheosis',
      beyondShortClauses: 2,
      exclusiveItems: 4,
    });
  });

  it('summarises played reach without turning the baseline into a threshold', () => {
    const lines = campaignPlayedLines({ runs: [
      { seed: 1, campaign: 'long', policy: 'ascendant', ending: 'forgotten', clauses: 3, exclusiveEvents: [], beyondShortClauses: 0, exclusiveItems: 0 },
      { seed: 2, campaign: 'long', policy: 'ascendant', ending: 'apotheosis', clauses: 5, exclusiveEvents: ['late_long'], exclusiveEnding: 'apotheosis', beyondShortClauses: 2, exclusiveItems: 4 },
    ] });
    const text = lines.join('\n');
    expect(text).toContain('A Long Line / ascendant: 2 runs');
    expect(text).toContain('reached campaign-exclusive material: 1/2');
    expect(text).toContain('exclusive endings: apotheosis 1/2');
    expect(text).toContain("beyond Short's clause capacity: 1/2");
  });
});
