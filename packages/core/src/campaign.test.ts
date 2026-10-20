import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { EventTemplateS, FREQUENCY_PROFILES, eventInCampaign } from '@ed/schema';
import { bootstrap } from './sim.js';
import { phase, testWorld } from './testing.js';
import { present } from './year/phases.js';
import { emptyReport } from './year/report.js';
import { makeRng } from './rng.js';
import { tickAges } from './ages/scheduler.js';
import { queueChoice, resolveChoice, resolveRecord } from './events/decisions.js';
import { resolveSlots } from './events/slots.js';
import { framePool, presentFrame, selectFrame } from './events/frame.js';
import { dueArcSteps } from './events/arcs.js';
import { ambientExclusionReason, ambientPool, selectEvents, type SelectionObservation } from './events/selection.js';
import { PersonStore } from './people/store.js';
import { genomeOf } from './people/factory.js';
import { classifyFunnelPoint, FunnelObserver, funnelSources, privateFunnelContext, summariseFunnel } from './tools/funnel.js';
import { emptyReach, executeOutcomeWitness, readRun, recordChoiceOffers } from './events/reach.js';
import { choiceExposure } from './tools/outcome-reach-verdict.js';
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

describe('pre-effect selection observations (#1811)', () => {
  const content = loadContent();
  function event(id: string, overrides: Record<string, unknown> = {}) {
    return EventTemplateS.parse({
      id, title: 'A selection witness', tier: 'family', frequency: 'common', repeatable: true,
      purposes: ['establish_magic_rule', 'worldbuild_through_action', 'change_relationship'],
      body: 'A letter waits on the table.', slots: { HEAD: { role: 'head' } },
      interaction: { kind: 'narration', outcomes: [{ id: 'read', weight: 100, text: 'The letter is read.', effects: [] }] },
      ...overrides,
    });
  }
  function fixture() {
    const missing = event('funnel_missing', { slots: { READER: {
      role: 'family_member', filters: [{ age: { op: 'gte', value: 5000 } }],
    } } });
    const ready = event('funnel_ready');
    const ctx = testWorld({ ...content.bundle, events: [missing, ready] }, 18110);
    ctx.world.generation = 6;
    return { ctx, missing, ready };
  }

  it.each([false, true])('reads real available answers without changing a resolved world (headless=%s)', (headless) => {
    const authored = event('offered_answers', { interaction: { kind: 'choice', choices: [
      { id: 'taken', label: 'Read it.', outcomes: [{ id: 'read', weight: 100, text: 'Read.', effects: [] }] },
      { id: 'unselected', label: 'Leave it.', outcomes: [{ id: 'left', weight: 100, text: 'Left.', effects: [] }] },
      { id: 'blocked', label: 'Read the impossible hand.', requires: [{ slot: 'HEAD', attr: 'mind', op: 'gte', value: 1_000_000 }],
        outcomes: [{ id: 'paid', weight: 100, text: 'Paid.', effects: [] }] },
    ] } });
    function run(trace: boolean) {
      const ctx = testWorld({ ...content.bundle, events: [authored] }, 18118);
      const reach = emptyReach();
      const beforeCommits: number[] = [];
      if (trace) ctx.observeSelection = observation => {
        if (observation.kind !== 'choice_offered') return;
        beforeCommits.push(ctx.world.decisionLog.filter(entry => entry.kind === 'outcome').length);
        recordChoiceOffers(reach, observation.event, observation.choices);
      };
      for (let index = 0; index < 6; index++) {
        const rng = makeRng(18118 + index);
        const cast = resolveSlots(authored, ctx, rng);
        expect(cast.ok).toBe(true);
        if (headless) {
          const report = emptyReport(ctx.world.year);
          present(ctx, authored, cast.fill, cast.playerCast, {
            ...rng, pick: choices => { rng.pick(choices); return choices[0]!; },
          }, report, true);
          expect(report.resolved).toHaveLength(1);
        } else {
          const pending = queueChoice(ctx, authored, authored.body, cast.fill, cast.playerCast);
          const result = resolveChoice(ctx, pending.id, 'taken', rng);
          expect(result.ok, result.reason).toBe(true);
        }
      }
      readRun(ctx, reach);
      return { saved: canonical(saveGame(ctx)), reach, beforeCommits };
    }
    const traced = run(true);
    expect(traced.saved).toBe(run(false).saved);
    expect(traced.beforeCommits).toEqual([0, 1, 2, 3, 4, 5]);
    expect(choiceExposure(traced.reach, 'offered_answers|unselected')).toEqual({ offered: 6, expectedSelections: 3 });
    expect(choiceExposure(traced.reach, 'offered_answers|blocked')).toEqual({ offered: 0, expectedSelections: 0 });
    expect(traced.reach.firings.get('offered_answers|taken')).toBe(6);
    expect(traced.reach.firings.get('offered_answers|unselected')).toBeUndefined();
  });

  it.each([
    ['chance', 'chance'],
    ['state', { state: [{ take: 'one' }] }],
  ])('does not give %s branches a uniform player-choice expectation', (name, decidedBy) => {
    const authored = event(`automatic_${name}`, { interaction: { kind: 'choice', decidedBy, choices: [
      { id: 'one', label: 'One.', outcomes: [{ id: 'read', weight: 100, text: 'Read.', effects: [] }] },
      { id: 'two', label: 'Two.', outcomes: [{ id: 'left', weight: 100, text: 'Left.', effects: [] }] },
    ] } });
    for (const headless of [false, true]) {
      const ctx = testWorld({ ...content.bundle, events: [authored] }, 18119);
      const observed: SelectionObservation[] = [];
      ctx.observeSelection = observation => observed.push(observation);
      const rng = makeRng(18119);
      const cast = resolveSlots(authored, ctx, rng);
      expect(cast.ok).toBe(true);
      if (headless) present(ctx, authored, cast.fill, cast.playerCast, rng, emptyReport(ctx.world.year), true);
      else {
        const pending = queueChoice(ctx, authored, authored.body, cast.fill, cast.playerCast);
        expect(resolveChoice(ctx, pending.id, undefined, rng).ok).toBe(true);
      }
      expect(observed.filter(observation => observation.kind === 'choice_offered')).toEqual([]);
      expect(ctx.world.decisionLog.some(entry => entry.kind === 'outcome')).toBe(true);
    }
  });

  it('uses the same first refusals as the production pool and leaves casts unproven', () => {
    const { ctx, missing, ready } = fixture();
    expect(ambientExclusionReason(ready, ctx)).toBeUndefined();
    expect(ambientExclusionReason(missing, ctx)).toBeUndefined();
    expect(ambientPool(ctx).map(template => template.id)).toEqual([missing.id, ready.id]);
    expect(ambientExclusionReason(event('wrong_campaign', { campaigns: ['short'] }), ctx)).toBe('campaign');
    expect(ambientExclusionReason(event('a_frame', { tier: 'frame' }), ctx)).toBe('frame');
    expect(ambientExclusionReason(event('an_arc', { arc: { of: 'funnel_arc', node: 'a_node' } }), ctx)).toBe('arc');
    const capped = event('capped', { frequency: 'uncommon' });
    ctx.world.frequency.templateFires[capped.id] = FREQUENCY_PROFILES.uncommon.maxFiresPerTemplate;
    expect(ambientExclusionReason(capped, ctx)).toBe('tier_cap');
    const once = event('once', { repeatable: false });
    ctx.world.frequency.templateLastFired[once.id] = ctx.world.year;
    expect(ambientExclusionReason(once, ctx)).toBe('template_ration');
    ctx.world.age.active = [];
    expect(ambientExclusionReason(event('wrong_age', { ages: { only: ['the_quickening'] } }), ctx)).toBe('age');
    ctx.world.frequency.lastFiredYear.uncommon = ctx.world.year;
    expect(ambientExclusionReason(event('tier_cooling', { frequency: 'uncommon' }), ctx)).toBe('frequency');
    expect(ambientExclusionReason(event('missing_page', { conditions: { knowledge: 'funnel_unseen', has: true } }), ctx)).toBe('condition');
  });

  it('records actual failed casts and selected sources before any outcome applies', () => {
    const { ctx, missing, ready } = fixture();
    const rows: SelectionObservation[] = [];
    ctx.observeSelection = row => rows.push(row);
    const beforeTreasury = ctx.world.treasury;
    const chosen = selectEvents(ctx, { ...makeRng(18111), weighted: items => items[0] }, 1);
    expect(chosen.map(candidate => candidate.event.id)).toEqual([ready.id]);
    expect(rows).toEqual([
      { kind: 'before_draw', year: ctx.world.year, budget: 1, forced: [] },
      { kind: 'cast_failure', year: ctx.world.year, event: missing.id, source: 'ambient', missing: 'READER' },
      { kind: 'selected', year: ctx.world.year, candidates: [{ event: ready.id, source: 'ambient' }] },
    ]);
    expect(ctx.world.treasury).toBe(beforeTreasury);
    expect(ctx.world.frequency.templateFires[ready.id]).toBeUndefined();
  });

  it('keeps forced selection and exhausted ambient budget distinct', () => {
    const { ctx, ready } = fixture();
    ctx.world.scheduled.push({ event: ready.id, year: ctx.world.year });
    const rows: SelectionObservation[] = [];
    ctx.observeSelection = row => rows.push(row);
    const chosen = selectEvents(ctx, makeRng(18112), 0);
    expect(chosen.map(candidate => candidate.source)).toEqual(['forced']);
    expect(rows).toEqual([
      { kind: 'before_draw', year: ctx.world.year, budget: 0, forced: [ready.id] },
      { kind: 'selected', year: ctx.world.year, candidates: [{ event: ready.id, source: 'forced' }] },
    ]);
  });

  it('preserves the complete saved state and next RNG draw with private diagnostic reads', () => {
    const worlds = [false, true].map(observe => {
      const { ctx } = fixture();
      if (observe) ctx.observeSelection = row => {
        if (row.kind !== 'before_draw') return;
        const people = new PersonStore();
        for (const person of ctx.world.people.all()) people.add(structuredClone(person));
        const probe = { ...ctx, world: { ...ctx.world, people }, observeSelection: undefined };
        for (const person of people.all()) genomeOf(person, probe.genetics);
        for (const template of ctx.content.events) ambientExclusionReason(template, probe);
      };
      const rng = makeRng(18113);
      const selected = selectEvents(ctx, rng, 1);
      return { selected, nextDraw: rng.int(1_000_000), save: canonical(saveGame(ctx)) };
    });
    expect(worlds[1]).toEqual(worlds[0]);
  });

  it('observes the frame and arc entry points without spending another die', () => {
    const rows: SelectionObservation[] = [];
    const worlds = [false, true].map(observe => {
      const { ctx } = fixture();
      if (observe) ctx.observeSelection = row => rows.push(row);
      const rng = makeRng(18114);
      dueArcSteps(ctx, rng, 'tale');
      selectFrame(ctx, rng);
      return { save: canonical(saveGame(ctx)), nextDraw: rng.int(1_000_000) };
    });
    expect(rows.slice(0, 2)).toEqual([
      { kind: 'before_arc_steps', year: START_YEAR, layer: 'tale' },
      { kind: 'before_frame', year: START_YEAR },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ kind: 'frame_due', year: START_YEAR });
    if (rows[2]?.kind !== 'frame_due') throw new Error('frame cadence observation is missing');
    expect(typeof rows[2].due).toBe('boolean');
    expect(worlds[1]).toEqual(worlds[0]);
  });

  it('separates a missing premise, missing cast, other condition and undrawn cast', () => {
    const { ctx, ready, missing } = fixture();
    const before = canonical(saveGame(ctx));
    expect(classifyFunnelPoint(ctx, event('no_page', { conditions: { knowledge: 'unseen_page', has: true } })).stage).toBe('premise');
    expect(classifyFunnelPoint(ctx, missing).stage).toBe('cast');
    expect(classifyFunnelPoint(ctx, event('too_costly', { conditions: { treasury: { op: 'gte', value: 1_000_000 } } })).stage).toBe('condition');
    expect(classifyFunnelPoint(ctx, ready).stage).toBe('not_selected');
    expect(canonical(saveGame(ctx))).toBe(before);
  });

  it('does not turn a mixed OR into a mandatory missing page', () => {
    const { ctx } = fixture();
    const page = { knowledge: 'unseen_page', has: true };
    const money = { treasury: { op: 'gte', value: -1_000_000 } };
    expect(classifyFunnelPoint(ctx, event('either', { conditions: { any: [page, money] } })).stage).toBe('not_selected');
    expect(classifyFunnelPoint(ctx, event('both', { conditions: { all: [page, money] } })).stage).toBe('premise');
  });

  it('delegates person queries to the real store but detaches their results and refuses mutation', () => {
    const { ctx } = fixture();
    const before = canonical(saveGame(ctx));
    const original = ctx.world.people.living()[0]!;
    const probe = privateFunnelContext(ctx);
    const detached = probe.world.people.mustGet(original.id);
    expect(detached).not.toBe(original);
    expect(probe.world.people.living().find(person => person.id === original.id)).toBe(detached);
    detached.name = 'A private diagnostic change';
    detached.castSlots.push('private_probe');
    detached.acquired.mind = 999;
    genomeOf(detached, probe.genetics);
    expect(() => probe.world.people.kill(original.id, ctx.world.year, 'a forbidden probe'))
      .toThrow('Funnel probes cannot call PersonStore.kill');
    expect(canonical(saveGame(ctx))).toBe(before);
  });

  it('reads a frame page through its production reader', () => {
    const framed = event('funnel_frame', { tier: 'frame', reads: [{ chronicled: 'funnel_page' }] });
    const ctx = testWorld({ ...content.bundle, events: [framed] }, 18115);
    expect(classifyFunnelPoint(ctx, framed).stage).toBe('premise');
    ctx.world.chronicle.push({ year: START_YEAR, weight: 'line', text: 'A page survived.', eventId: 'funnel_page', named: true });
    expect(classifyFunnelPoint(ctx, framed).stage).toBe('not_selected');
  });

  it('probes the real chained patch without advancing the live arc', () => {
    const ctx = testWorld(content, 18116);
    const child = content.mustEvent('the_north_wind_finds_the_patch');
    expect(classifyFunnelPoint(ctx, child).stage).toBe('premise');
    const opening = executeOutcomeWitness(ctx, content.mustEvent('the_west_wing_roof'), {
      choiceId: 'patch_it_again', expectedOutcomeId: 'patched', rng: makeRng(18116),
    });
    expect(opening.ok, opening.reason).toBe(true);
    const instance = [...ctx.world.arcs.values()].find(arc => arc.arc === child.arc?.of)!;
    expect(instance).toBeDefined();
    ctx.world.year = instance.dueYear!;
    const before = canonical(saveGame(ctx));
    expect(classifyFunnelPoint(ctx, child).stage).toBe('not_selected');
    expect(canonical(saveGame(ctx))).toBe(before);
    const observations: SelectionObservation[] = [];
    ctx.observeSelection = row => observations.push(row);
    const steps = dueArcSteps(ctx, makeRng(18116), 'tale');
    expect(steps.some(step => step.node.event === child.id)).toBe(true);
    expect(observations).toContainEqual({ kind: 'selected', year: ctx.world.year,
      candidates: [{ event: child.id, source: 'arc' }] });
  });

  it('distinguishes an actual selection from a committed branch', () => {
    const { ctx, ready } = fixture();
    const observer = new FunnelObserver(ctx, [ready.id]);
    selectEvents(ctx, makeRng(18117), 1);
    const row = observer.finish()[0]!;
    expect(row.selectedYears).toBe(1);
    expect(row.commits).toBe(0);
    expect(row.stages.unresolved).toBe(1);
    expect(row.neverResolved).toHaveLength(1);
  });

  it('keeps two traced built states and one untraced state byte-identical', () => {
    const saves = [false, true, true].map(trace => {
      const { ctx, ready, missing } = fixture();
      const observer = trace ? new FunnelObserver(ctx, [ready.id, missing.id]) : undefined;
      selectEvents(ctx, makeRng(18118), 1);
      const result = executeOutcomeWitness(ctx, ready, { expectedOutcomeId: 'read', rng: makeRng(18119) });
      expect(result.ok, result.reason).toBe(true);
      const rows = observer?.finish();
      if (rows) {
        expect(rows.find(row => row.id === ready.id)).toMatchObject({ commits: 1, firedYears: 1, neverResolved: [] });
        expect(rows.find(row => row.id === missing.id)?.stages.cast).toBe(1);
      }
      return canonical(saveGame(ctx));
    });
    expect(saves[1]).toBe(saves[0]);
    expect(saves[2]).toBe(saves[0]);
  });

  it('records a selected frame whose cast cannot be filled without inventing a commit', () => {
    const framed = event('funnel_unfilled_frame', { tier: 'frame', slots: {
      READER: { role: 'family_member', filters: [{ age: { op: 'gte', value: 5000 } }] },
    } });
    const ctx = testWorld({ ...content.bundle, events: [framed] }, 18120);
    ctx.world.assize.openedAt = START_YEAR - 108;
    const observer = new FunnelObserver(ctx, [framed.id]);
    expect(selectFrame(ctx, makeRng(18120))?.id).toBe(framed.id);
    expect(presentFrame(ctx, framed, makeRng(18121))).toBeUndefined();
    expect(observer.finish()[0]).toMatchObject({ selectedYears: 1, castProvedYears: 0, eligibleYears: 0, commits: 0,
      actualCastFailures: { 'frame:READER': 1 }, stages: { unresolved: 1 } });
  });

  it('names the real inline launcher and the Record option that creates a frame premise', () => {
    const patch = funnelSources(content, 'the_north_wind_finds_the_patch');
    expect(patch.some(source => source.reference.startsWith('arc:')
      && source.writers.some(writer => writer.includes('the_west_wing_roof|patch_it_again|patched')))).toBe(true);
    const copy = funnelSources(content, 'frame_the_copy_that_was_short');
    expect(copy.find(source => source.reference === 'discrepancy:the_short_copy_at_cawdry')?.writers)
      .toContain('event:the_hand_the_warden_accepts/Record:embellish creates');
  });

  it('ranks actual household firings and keeps unresolved branches explicit', () => {
    const { ctx, ready, missing } = fixture();
    const observer = new FunnelObserver(ctx, [ready.id, missing.id]);
    selectEvents(ctx, makeRng(18122), 1);
    expect(executeOutcomeWitness(ctx, ready, { expectedOutcomeId: 'read', rng: makeRng(18123) }).ok).toBe(true);
    const templates = observer.finish();
    const rows = [{ seed: 18122, playedYears: 0, control: 'not sampled' as const, frameDue: { true: 0, false: 0 }, templates }];
    const ranked = summariseFunnel(ctx.content, { ids: [ready.id, missing.id], rows });
    expect(ranked.map(row => row.id)).toEqual([missing.id, ready.id]);
    expect(ranked[0]).toMatchObject({ houses: { sampled: 1, castProved: 0, eligible: 0, selected: 0, fired: 0 },
      neverResolved: ['funnel_missing||read'] });
    expect(ranked[1]).toMatchObject({ houses: { sampled: 1, fired: 1 }, neverResolved: [], branches: { 'funnel_ready||read': 1 } });
  });
});

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

  it('refuses an introduction without its narrator instead of casting another family member', () => {
    const modified = structuredClone(content.bundle);
    for (const person of modified.characters) person.becomesGuardian = false;
    expect(() => bootstrap(modified, 323, 1042, 'demo'))
      .toThrow('campaign introduction requires a founding narrator');
  });

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
