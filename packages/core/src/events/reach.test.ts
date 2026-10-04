import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { makeRng } from '../rng.js';
import { TEST_FAMILIES } from '../tools/testFamilies.js';
import { resolveSlots } from './slots.js';
import { executeOutcomeWitness } from './reach.js';
import { evalCondition } from './conditions.js';

const content = indexContent(loadContent());

function singleOutcomeNarration() {
  for (const event of content.events) {
    if (event.arc || event.interaction.kind !== 'narration' || event.interaction.outcomes.length !== 1) continue;
    for (const family of TEST_FAMILIES) {
      const ctx = family.build(content);
      const slots = resolveSlots(event, ctx, makeRng(1));
      if (evalCondition(event.conditions, ctx) && slots.ok && slots.playerCast.length === 0) return { event, family };
    }
  }
  throw new Error('fixture corpus has no fillable single-outcome narration');
}

describe('deterministic outcome execution witnesses', () => {
  it('records a witnessed outcome only after the real commit path resolves it', () => {
    const { event, family } = singleOutcomeNarration();
    if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
    const outcome = event.interaction.outcomes[0]!;
    const ctx = family.build(content);

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
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || sourceEvent.interaction.kind === 'narration'
        || sourceEvent.interaction.decidedBy !== 'player'
        || Object.keys(sourceEvent.slots).length === 0
        || Object.values(sourceEvent.slots).some((slot) => slot.castBy === 'player')
      ) continue;

      const slot = Object.keys(sourceEvent.slots)[0]!;
      const event = structuredClone(sourceEvent);
      if (event.interaction.kind === 'narration') continue;
      const choice = event.interaction.choices[0]!;
      choice.requires = [{ slot, attr: 'mind', op: 'gte', value: 10_000 }];

      for (const family of TEST_FAMILIES) {
        const ctx = family.build(content);
        if (!evalCondition(event.conditions, ctx)) continue;
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
    }

    throw new Error('fixture corpus has no player choice whose ordinary slots can be filled');
  });

  it('rejects a fixture whose required slot was made impossible to fill', () => {
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || Object.keys(sourceEvent.slots).length === 0
        || Object.values(sourceEvent.slots).some((slot) => slot.castBy === 'player')
      ) continue;

      const slotId = Object.keys(sourceEvent.slots)
        .find((id) => !sourceEvent.slots[id]!.optional);
      if (!slotId) continue;

      for (const family of TEST_FAMILIES) {
        const baseCtx = family.build(content);
        if (!evalCondition(sourceEvent.conditions, baseCtx)) continue;
        const original = resolveSlots(sourceEvent, baseCtx, makeRng(3));
        if (!original.ok || original.playerCast.length) continue;

        const event = structuredClone(sourceEvent);
        event.slots[slotId]!.filters.push({ attr: 'mind', op: 'gte', value: 10_000 });
        const ctx = family.build(content);
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
    }

    throw new Error('fixture corpus has no ordinary required slot suitable for the mutation');
  });

  it('can witness an automatically decided branch through the production decider', () => {
    for (const event of content.events) {
      if (event.arc || event.interaction.kind === 'narration' || event.interaction.decidedBy === 'player') continue;

      for (const family of TEST_FAMILIES) {
        for (const choice of event.interaction.choices) {
          for (const outcome of choice.outcomes) {
            const ctx = family.build(content);
            if (!evalCondition(event.conditions, ctx)) continue;
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
    }

    throw new Error('fixture corpus has no automatically decided branch reachable by the test families');
  });

  it('does not mutate the world when the named outcome is not the one resolved', () => {
    const { event, family } = singleOutcomeNarration();
    const ctx = family.build(content);
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
