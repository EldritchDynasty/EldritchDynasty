import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { makeRng } from '../rng.js';
import { place, testWorld } from '../testing.js';
import { resolveSlots } from './slots.js';
import { executeOutcomeWitness } from './reach.js';
import { evalCondition } from './conditions.js';

const content = indexContent(loadContent());

function fixture(seed = 1042) {
  const ctx = testWorld(content, seed);
  // A small, deterministic spread of ordinary household members gives the
  // witness tests casting options without playing years to manufacture state.
  place(ctx, { sex: 'male', age: 22, name: `Witness Young Man ${seed}` });
  place(ctx, { sex: 'male', age: 41, name: `Witness Older Man ${seed}` });
  place(ctx, { sex: 'female', age: 27, name: `Witness Woman ${seed}` });
  return ctx;
}

function singleOutcomeNarration() {
  const ctx = fixture(1101);
  for (const event of content.events) {
    if (event.arc || event.interaction.kind !== 'narration' || event.interaction.outcomes.length !== 1) continue;
    const slots = resolveSlots(event, ctx, makeRng(1));
    if (evalCondition(event.conditions, ctx) && slots.ok && slots.playerCast.length === 0) return event;
  }
  throw new Error('fixture has no fillable single-outcome narration');
}

describe('deterministic outcome execution witnesses', () => {
  it('records a witnessed outcome only after the real commit path resolves it', () => {
    const event = singleOutcomeNarration();
    if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
    const outcome = event.interaction.outcomes[0]!;
    const ctx = fixture(1101);

    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: outcome.id,
      rng: makeRng(1),
    });

    expect(result.ok, result.reason).toBe(true);
    expect(result.key).toBe(`${event.id}||${outcome.id}`);
    const logged = ctx.world.decisionLog.at(-1);
    expect(logged).toMatchObject({
      kind: 'outcome',
      event: event.id,
      outcomeId: outcome.id,
    });
  });

  it('rejects an impossible choice requirement deterministically before commit', () => {
    const search = fixture(1102);
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || sourceEvent.interaction.kind === 'narration'
        || sourceEvent.interaction.decidedBy !== 'player'
        || Object.keys(sourceEvent.slots).length === 0
        || Object.values(sourceEvent.slots).some((slot) => slot.castBy === 'player')
        || !evalCondition(sourceEvent.conditions, search)
      ) continue;

      const slot = Object.keys(sourceEvent.slots)[0]!;
      const original = resolveSlots(sourceEvent, search, makeRng(2));
      if (!original.ok || original.playerCast.length) continue;

      const event = structuredClone(sourceEvent);
      if (event.interaction.kind === 'narration') continue;
      const choice = event.interaction.choices[0]!;
      choice.requires = [{ slot, attr: 'mind', op: 'gte', value: 10_000 }];

      const ctx = fixture(1102);
      const before = ctx.world.decisionLog.length;
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: choice.id,
        expectedOutcomeId: choice.outcomes[0]!.id,
        rng: makeRng(2),
      });

      if (!result.ok && /mind is/.test(result.reason ?? '')) {
        expect(ctx.world.decisionLog).toHaveLength(before);
        return;
      }
    }

    throw new Error('fixture has no player choice whose ordinary slots can be filled');
  });

  it('rejects a fixture whose required slot was made impossible to fill', () => {
    const search = fixture(1103);
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || Object.keys(sourceEvent.slots).length === 0
        || Object.values(sourceEvent.slots).some((slot) => slot.castBy === 'player')
        || !evalCondition(sourceEvent.conditions, search)
      ) continue;

      const slotId = Object.keys(sourceEvent.slots)
        .find((id) => !sourceEvent.slots[id]!.optional);
      if (!slotId) continue;

      const original = resolveSlots(sourceEvent, search, makeRng(3));
      if (!original.ok || original.playerCast.length) continue;

      const event = structuredClone(sourceEvent);
      event.slots[slotId]!.filters.push({ attr: 'mind', op: 'gte', value: 10_000 });
      const ctx = fixture(1103);
      const firstChoice = event.interaction.kind === 'narration'
        ? undefined
        : event.interaction.choices[0];
      const expectedOutcomeId = event.interaction.kind === 'narration'
        ? event.interaction.outcomes[0]!.id
        : firstChoice!.outcomes[0]!.id;

      const result = executeOutcomeWitness(ctx, event, {
        ...(event.interaction.kind !== 'narration' && event.interaction.decidedBy === 'player'
          ? { choiceId: firstChoice!.id }
          : {}),
        expectedOutcomeId,
        rng: makeRng(3),
      });

      if (!result.ok && result.reason === `slot '${slotId}' cannot be filled`) {
        expect(ctx.world.decisionLog).toHaveLength(0);
        return;
      }
    }

    throw new Error('fixture has no ordinary required slot suitable for the mutation');
  });

  it('can witness an automatically decided branch through the production decider', () => {
    const search = fixture(1104);
    for (const event of content.events) {
      if (
        event.arc
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy === 'player'
        || !evalCondition(event.conditions, search)
      ) continue;

      const original = resolveSlots(event, search, makeRng(4));
      if (!original.ok || original.playerCast.length) continue;

      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = fixture(1104);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(4),
          });
          if (result.ok) {
            expect(result.key).toBe(`${event.id}|${choice.id}|${outcome.id}`);
            return;
          }
        }
      }
    }

    throw new Error('fixture has no automatically decided branch reachable by the test world');
  });

  it('refuses a player-cast slot until a production docket fixture supplies the cast', () => {
    const search = fixture(1105);
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || sourceEvent.interaction.kind === 'narration'
        || Object.keys(sourceEvent.slots).length === 0
        || !evalCondition(sourceEvent.conditions, search)
      ) continue;

      const original = resolveSlots(sourceEvent, search, makeRng(5));
      if (!original.ok || original.playerCast.length) continue;
      const slotId = Object.keys(sourceEvent.slots)
        .find((id) => !sourceEvent.slots[id]!.optional);
      if (!slotId) continue;

      const event = structuredClone(sourceEvent);
      if (event.interaction.kind === 'narration') continue;
      event.slots[slotId]!.castBy = 'player';
      const ctx = fixture(1105);
      const choice = event.interaction.choices[0]!;
      const result = executeOutcomeWitness(ctx, event, {
        ...(event.interaction.decidedBy === 'player' ? { choiceId: choice.id } : {}),
        expectedOutcomeId: choice.outcomes[0]!.id,
        rng: makeRng(5),
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/player cast required/);
      expect(ctx.world.decisionLog).toHaveLength(0);
      return;
    }

    throw new Error('fixture has no ordinary choice event suitable for the player-cast mutation');
  });

  it('does not commit when the named outcome is not the one resolved', () => {
    const event = singleOutcomeNarration();
    const ctx = fixture(1101);
    const before = ctx.world.decisionLog.length;

    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: '__not_an_authored_outcome__',
      rng: makeRng(1),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/resolved .* not/);
    expect(ctx.world.decisionLog).toHaveLength(before);
  });
});
