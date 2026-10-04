import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { makeRng } from '../rng.js';
import { TEST_FAMILIES } from '../tools/testFamilies.js';
import { resolveSlots } from './slots.js';
import { executeOutcomeWitness } from './reach.js';

const content = indexContent(loadContent());

function singleOutcomeNarration() {
  for (const event of content.events) {
    if (event.arc || event.interaction.kind !== 'narration' || event.interaction.outcomes.length !== 1) continue;
    for (const family of TEST_FAMILIES) {
      const ctx = family.build(content);
      const slots = resolveSlots(event, ctx, makeRng(1));
      if (slots.ok && slots.playerCast.length === 0) return { event, family };
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
