import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { makeRng, type Rng } from '../rng.js';
import { place, testWorld } from '../testing.js';
import { resolveSlots } from './slots.js';
import { executeOutcomeWitness } from './reach.js';
import { evalCondition } from './conditions.js';
import { dueArcSteps, startArc } from './arcs.js';

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

function alwaysFirstWeighted(seed: number): Rng {
  const base = makeRng(seed);
  return {
    ...base,
    weighted<T>(xs: readonly T[], weight: (x: T) => number): T | undefined {
      // Consume the production draw so this hostile witness RNG has the same
      // cursor cost as a real weighted choice, then deliberately return first.
      base.weighted(xs, weight);
      return xs[0];
    },
  };
}

function alwaysLowNormal(seed: number): Rng {
  const base = makeRng(seed);
  return {
    ...base,
    normal(mean, sd) {
      // Preserve the Box-Muller cursor cost, then force the hostile natural
      // witness into the lowest authored band.
      base.normal(mean, sd);
      return -1_000_000;
    },
  };
}

function checkedChoice(variance: 'narrow' | 'none') {
  const event = structuredClone(singleOutcomeNarration());
  if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
  const original = event.interaction.outcomes[0]!;
  const lowId = `${original.id}_check_low` as typeof original.id;
  const targetId = `${original.id}_check_target` as typeof original.id;
  const choiceId = 'witness_checked_choice';
  const checkId = 'witness_outcome_check';

  event.checks = [{
    id: checkId,
    pool: { kind: 'family_max', attr: 'mind' },
    difficulty: 10_000,
    variance,
    bands: [
      { atLeast: 0, outcome: targetId },
      { atLeast: -2_000_000, outcome: lowId },
    ],
  }];
  event.interaction = {
    kind: 'choice',
    decidedBy: 'player',
    choices: [{
      id: choiceId,
      label: 'Test the check',
      requires: [],
      check: checkId,
      outcomes: [
        { ...structuredClone(original), id: targetId, weight: 1 },
        { ...structuredClone(original), id: lowId, weight: 1 },
      ],
    }],
  };
  return { event, choiceId, lowId, targetId };
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

  it('targets a positive weighted outcome without seed-mining the witness', () => {
    const event = structuredClone(singleOutcomeNarration());
    if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
    const original = event.interaction.outcomes[0]!;
    const naturalId = `${original.id}_natural` as typeof original.id;
    const targetId = `${original.id}_target` as typeof original.id;
    event.interaction.outcomes = [
      { ...structuredClone(original), id: naturalId, weight: 1 },
      { ...structuredClone(original), id: targetId, weight: 1 },
    ];

    const naturalCtx = fixture(1101);
    const natural = executeOutcomeWitness(naturalCtx, event, {
      expectedOutcomeId: targetId,
      rng: alwaysFirstWeighted(11),
    });
    expect(natural.ok).toBe(false);
    expect(natural.reason).toContain(`resolved '${naturalId}', not '${targetId}'`);

    const targetedCtx = fixture(1101);
    const targeted = executeOutcomeWitness(targetedCtx, event, {
      expectedOutcomeId: targetId,
      rng: alwaysFirstWeighted(11),
      targetWeightedOutcome: true,
    });

    expect(targeted.ok, targeted.reason).toBe(true);
    expect(targeted.key).toBe(`${event.id}||${targetId}`);
    expect(targetedCtx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      outcomeId: targetId,
    });
  });

  it('targets a randomised check band through the production evaluator', () => {
    const { event, choiceId, lowId, targetId } = checkedChoice('narrow');

    const naturalCtx = fixture(1101);
    const natural = executeOutcomeWitness(naturalCtx, event, {
      choiceId,
      expectedOutcomeId: targetId,
      rng: alwaysLowNormal(21),
    });
    expect(natural.ok).toBe(false);
    expect(natural.reason).toContain(`resolved '${lowId}', not '${targetId}'`);

    const targetedCtx = fixture(1101);
    const targeted = executeOutcomeWitness(targetedCtx, event, {
      choiceId,
      expectedOutcomeId: targetId,
      rng: alwaysLowNormal(21),
      targetCheckedOutcome: true,
    });

    expect(targeted.ok, targeted.reason).toBe(true);
    expect(targeted.key).toBe(`${event.id}|${choiceId}|${targetId}`);
    expect(targetedCtx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      choiceId,
      outcomeId: targetId,
    });
  });

  it('does not invent a band for a variance-none check', () => {
    const { event, choiceId, lowId, targetId } = checkedChoice('none');
    const ctx = fixture(1101);

    const result = executeOutcomeWitness(ctx, event, {
      choiceId,
      expectedOutcomeId: targetId,
      rng: makeRng(22),
      targetCheckedOutcome: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain(`resolved '${lowId}', not '${targetId}'`);
    expect(ctx.world.decisionLog).toHaveLength(0);
  });

  it('does not invent a weighted witness for a zero-effective-weight target', () => {
    const event = structuredClone(singleOutcomeNarration());
    if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
    const original = event.interaction.outcomes[0]!;
    const naturalId = `${original.id}_natural` as typeof original.id;
    const targetId = `${original.id}_zero` as typeof original.id;
    event.interaction.outcomes = [
      { ...structuredClone(original), id: naturalId, weight: 1 },
      { ...structuredClone(original), id: targetId, weight: 0 },
    ];

    const ctx = fixture(1101);
    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: targetId,
      rng: alwaysFirstWeighted(12),
      targetWeightedOutcome: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain(`resolved '${naturalId}', not '${targetId}'`);
    expect(ctx.world.decisionLog).toHaveLength(0);
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

  it('advances an arc through the production arc-step witness path', () => {
    const ctx = fixture(1106);
    const arc = content.arc('arc_the_formula_on_two_desks');
    if (!arc) throw new Error('formula arc fixture is missing');

    const rng = makeRng(6);
    const instance = startArc(arc, ctx, rng);
    if (!instance) throw new Error('formula arc fixture did not start');
    const step = dueArcSteps(ctx, rng).find((candidate) => candidate.instance.id === instance.id);
    if (!step) throw new Error('formula arc entry did not become due');
    if (step.playerCast.length) throw new Error('formula arc fixture unexpectedly needs player cast');

    const event = content.event(step.node.event);
    if (!event || event.interaction.kind !== 'narration') {
      throw new Error('formula arc entry fixture changed interaction');
    }
    const outcome = event.interaction.outcomes[0]!;

    const missing = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: outcome.id,
      rng: makeRng(7),
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('arc event requires an arc-step witness');

    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: outcome.id,
      rng,
      arcStep: step,
    });

    expect(result.ok, result.reason).toBe(true);
    expect(result.key).toBe(`${event.id}||${outcome.id}`);
    expect(instance.history.at(-1)).toMatchObject({
      node: step.node.id,
      outcome: outcome.id,
      year: ctx.world.year,
    });
    expect(instance.node).toBe('another_house');
  });

  it('routes a supplied player cast through the production docket', () => {
    const search = fixture(1105);
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || sourceEvent.interaction.kind === 'narration'
        || sourceEvent.interaction.decidedBy !== 'player'
        || Object.keys(sourceEvent.slots).length === 0
        || !evalCondition(sourceEvent.conditions, search)
      ) continue;

      const choice = sourceEvent.interaction.choices.find((candidate) => (
        !candidate.check
        && candidate.requires.length === 0
        && candidate.outcomes.length === 1
      ));
      if (!choice) continue;

      const original = resolveSlots(sourceEvent, search, makeRng(5));
      if (!original.ok || original.playerCast.length) continue;
      const slotId = Object.keys(sourceEvent.slots).find((id) => {
        const spec = sourceEvent.slots[id]!;
        return !spec.optional && !spec.count && typeof original.fill[id] === 'string';
      });
      if (!slotId) continue;

      const event = structuredClone(sourceEvent);
      if (event.interaction.kind === 'narration') continue;
      event.slots[slotId]!.castBy = 'player';
      const castId = original.fill[slotId];
      if (typeof castId !== 'string') continue;

      const missingCtx = fixture(1105);
      const missing = executeOutcomeWitness(missingCtx, event, {
        choiceId: choice.id,
        expectedOutcomeId: choice.outcomes[0]!.id,
        rng: makeRng(5),
      });
      expect(missing.ok).toBe(false);
      expect(missing.reason).toMatch(/player cast required/);
      expect(missingCtx.world.decisionLog).toHaveLength(0);

      const ctx = fixture(1105);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: choice.id,
        expectedOutcomeId: choice.outcomes[0]!.id,
        rng: makeRng(5),
        cast: { [slotId]: castId },
      });

      expect(result.ok, result.reason).toBe(true);
      expect(result.key).toBe(`${event.id}|${choice.id}|${choice.outcomes[0]!.id}`);
      expect(ctx.world.pendingDecisions).toHaveLength(0);
      expect(ctx.world.decisionLog.at(-1)).toMatchObject({
        kind: 'outcome',
        event: event.id,
        choiceId: choice.id,
        outcomeId: choice.outcomes[0]!.id,
        fill: { [slotId]: castId },
      });
      return;
    }

    throw new Error('fixture has no deterministic player choice suitable for the player-cast docket mutation');
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
