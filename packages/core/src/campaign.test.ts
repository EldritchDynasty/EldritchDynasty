import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { eventInCampaign } from '@ed/schema';
import { bootstrap } from './sim.js';
import { phase } from './testing.js';
import { makeRng } from './rng.js';
import { tickAges } from './ages/scheduler.js';
import { resolveRecord } from './events/decisions.js';
import { framePool } from './events/frame.js';
import { selectEvents } from './events/selection.js';
import { canonical, loadGame, saveGame } from './save.js';
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
  isFullCampaignEvent,
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
      openingAge: { age: 'the_insurrection', maximumYears: 12 },
      openingArc: { arc: 'arc_the_first_account', narratorSlot: 'FOUNDER' },
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

describe('campaign introductions (#323)', () => {
  const content = loadContent();

  it('keeps explicitly scoped scenes out of other campaigns and their balance samples', () => {
    const demo = content.mustEvent('demo_the_empty_chair');
    expect(eventInCampaign(demo, 'demo')).toBe(true);
    expect(eventInCampaign(demo, 'short')).toBe(false);
    expect(eventInCampaign(demo, 'long')).toBe(false);
    expect(isFullCampaignEvent(demo)).toBe(false);
    expect(isFullCampaignEvent({})).toBe(true);
    expect(isFullCampaignEvent({ campaigns: ['short', 'demo'] })).toBe(true);
    for (const campaign of ['short', 'long'] as const) {
      const ctx = bootstrap(content, 323, 1042, campaign);
      expect(ctx.world.arcs.size).toBe(0);
      ctx.world.scheduled.push({ event: demo.id, year: 1042 });
      expect(selectEvents(ctx, makeRng(323), 0)).toEqual([]);
    }
  });

  it('finishes its named opening Age even when every termination roll refuses to end it', () => {
    const ctx = bootstrap(content, 323, 1042, 'demo');
    const rng = { ...makeRng(323), bool: () => false };
    const opening = campaignDef('demo').openingAge!;
    expect(content.ages.some((age) => age.id === opening.age && age.duration.shape === 'front_loaded')).toBe(true);
    for (let elapsed = 1; elapsed <= opening.maximumYears; elapsed++) {
      ctx.world.year = 1042 + elapsed;
      tickAges(ctx, rng);
    }
    expect(ctx.world.age.ended).toContainEqual(expect.objectContaining({
      age: opening.age, began: 1042, ended: 1054, named: true,
    }));
    expect(ctx.world.age.active.some((age) => age.age === opening.age)).toBe(false);
  });

  it.each(['record', 'omit', 'embellish'] as const)(
    'runs the founder, blocked Record and scheduled interlude with the %s answer', (option) => {
      const ctx = bootstrap(content, 323, 1042, 'demo');
      const narrator = ctx.world.narrator!;
      const instance = [...ctx.world.arcs.values()][0]!;
      expect(instance.bindings.FOUNDER).toBe(narrator);
      ctx.world.year = 1043;
      phase('arcs', ctx, false);
      expect(ctx.world.people.get(narrator)?.status).toBe('guardian');
      phase('succession', ctx);
      expect(framePool(ctx).some((event) => event.id === 'demo_the_margin_keeps_its_colour')).toBe(false);
      ctx.world.year = 1044;
      phase('arcs', ctx, false);
      const pending = ctx.world.pendingDecisions.find((decision) => decision.kind === 'record');
      expect(pending?.kind).toBe('record');
      if (!pending) throw new Error('the introduction did not force its Record decision');
      expect(resolveRecord(ctx, pending.id, option).ok).toBe(true);
      ctx.world.year = 1045;
      phase('arcs', ctx);
      expect(ctx.world.frame.entries).toEqual([]);
      phase('frame', ctx);
      expect(ctx.world.frame.entries.at(-1)?.eventId).toBe('demo_the_margin_keeps_its_colour');
      expect(instance.status).toBe('ended');
      expect(ctx.world.chronicle.some((page) => page.eventId === 'demo_the_margin_keeps_its_colour')).toBe(false);
      expect(ctx.world.frequency.templateFires.demo_the_margin_keeps_its_colour).toBeUndefined();
      const saved = saveGame(ctx);
      expect(canonical(saveGame(loadGame(saved, content)))).toBe(canonical(saved));
    },
  );
});
