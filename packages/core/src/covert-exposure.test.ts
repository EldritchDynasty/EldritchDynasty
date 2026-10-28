import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Grudge } from '@ed/schema';
import { place, testWorld } from './testing.js';
import { addGrudge } from './people/relationships.js';
import { canonical, saveGame } from './save.js';
import { householdThreatCandidates } from './covert-lifecycle.js';
import { covertOpportunities } from './covert-operations.js';
import { createCovertExposure, directionOf, grudgeWriter, sampleCovertExposure } from './covert-exposure.js';

const content = loadContent();

function scene() {
  const ctx = testWorld(content, 1);
  ctx.world.relationships.clear();
  const founder = ctx.world.people.living().find(p => p.becomesGuardian)!;
  const nella = place(ctx, { name: 'Nella', sex: 'female', age: 25 });
  const enemy = place(ctx, { name: 'Hostile neighbour', sex: 'male', age: 40, house: 'house_marrow' });
  return { ctx, founder, nella, enemy };
}

describe('covert exposure funnel (#1943)', () => {
  it('names the writer of every grudge the engine writes', () => {
    const ctx = testWorld(content, 1);
    const g = (originEvent: string) => ({ originEvent }) as Grudge;
    expect(grudgeWriter(ctx, g(String(content.prologue!.id)))).toBe('prologue');
    expect(grudgeWriter(ctx, g('rents_rack'))).toBe('rent');
    expect(grudgeWriter(ctx, g('an_older_claim'))).toBe('assize');
    expect(grudgeWriter(ctx, g('grievance'))).toBe('hall_quarrel');
    expect(grudgeWriter(ctx, g('mystic_service_promise'))).toBe('service_promise');
    expect(grudgeWriter(ctx, g('auction_marriage_pledge'))).toBe('marriage_pledge');
    expect(grudgeWriter(ctx, g('covert_household_attempt'))).toBe('answer_attack');
    expect(grudgeWriter(ctx, g('covert_operation_attempt'))).toBe('operation_exposed');
    expect(grudgeWriter(ctx, g('the_seal_is_contested'))).toBe('authored');
  });

  it('stages incoming grudges with the production predicates, not a copy of them', () => {
    const { ctx, founder, nella, enemy } = scene();
    addGrudge(ctx, enemy.id, founder.id, { severity: 70, inheritance: 'house_wide' }, 'the_seal_is_contested');
    const other = place(ctx, { name: 'Lesser neighbour', sex: 'male', age: 35, house: 'house_calder' });
    addGrudge(ctx, other.id, nella.id, { severity: 30, inheritance: 'heir_only' });
    const f = createCovertExposure();
    sampleCovertExposure(ctx, f);
    expect(f.incoming.stages).toEqual({ candidate: 1, below_threshold: 1 });
    expect(f.incoming.candidateYears).toBe(householdThreatCandidates(ctx).length ? 1 : 0);
    expect(f.incoming.rollYears).toBe(1);
    expect(f.grudges['authored:incoming:head']).toEqual({ grudgeYears: 1, incomingLive: 1, outgoingLive: 1, peak: 70 });
    expect(f.grudges['authored:incoming:family']).toMatchObject({ grudgeYears: 1, incomingLive: 0, peak: 30 });
  });

  it('says a seat grudge missed because the hall held nobody eligible', () => {
    const { ctx, founder, enemy } = scene();
    addGrudge(ctx, enemy.id, founder.id, { severity: 70, inheritance: 'house_wide' });
    for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year))
      if (p.id !== founder.id) p.born = ctx.world.year - 10;
    const f = createCovertExposure();
    sampleCovertExposure(ctx, f);
    expect(f.incoming.stages).toEqual({ no_target: 1 });
    expect(f.incoming.noTarget).toEqual({ 'seat:nobody_eligible': 1 });
  });

  it('explains an outgoing miss by the rule its target fails', () => {
    const { ctx, enemy } = scene();
    addGrudge(ctx, ctx.world.playerHouse, enemy.id, { severity: 50, inheritance: 'house_wide' });
    const f = createCovertExposure();
    sampleCovertExposure(ctx, f);
    expect(f.outgoing.stages).toEqual({ no_target: 1 });
    expect(f.outgoing.noTarget).toEqual({ unknown: 1 });

    const rival = ctx.world.people.living().find(p => p.castSlots.includes('rival'))!;
    addGrudge(ctx, ctx.world.playerHouse, rival.id, { severity: 50, inheritance: 'house_wide' });
    const g = createCovertExposure();
    sampleCovertExposure(ctx, g);
    expect(g.outgoing.stages.opportunity).toBe(covertOpportunities(ctx).length ? 1 : undefined);
    expect(g.outgoing.opportunityYears).toBe(covertOpportunities(ctx).length ? 1 : 0);
  });

  it('reads the direction of an edge from this house’s side', () => {
    const { ctx, founder, nella, enemy } = scene();
    const edge = (from: string, to: string) => ({ from, to, sentiment: 0, kinds: [], grudges: [] });
    expect(directionOf(ctx, edge(enemy.id, founder.id))).toBe('incoming');
    expect(directionOf(ctx, edge(ctx.world.playerHouse, enemy.id))).toBe('outgoing');
    expect(directionOf(ctx, edge(nella.id, founder.id))).toBe('internal');
    expect(directionOf(ctx, edge(enemy.id, 'house_calder'))).toBe('elsewhere');
  });

  it('never changes the world it watches', () => {
    const { ctx, founder, enemy } = scene();
    addGrudge(ctx, enemy.id, founder.id, { severity: 70, inheritance: 'house_wide' });
    addGrudge(ctx, ctx.world.playerHouse, enemy.id, { severity: 50, inheritance: 'house_wide' });
    const before = canonical({ ...saveGame(ctx), savedAt: '' });
    sampleCovertExposure(ctx, createCovertExposure());
    expect(canonical({ ...saveGame(ctx), savedAt: '' })).toBe(before);
  });
});
