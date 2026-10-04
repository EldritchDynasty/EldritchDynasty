import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, FREQUENCY_PROFILES, indexContent, type ActiveAge } from '@ed/schema';
import { makeRng, type Rng } from '../rng.js';
import { place, testWorld } from '../testing.js';
import { resolveSlots, type SlotFill } from './slots.js';
import { executeOutcomeWitness, outcomeKey } from './reach.js';
import { evalCondition } from './conditions.js';
import { dueArcSteps, startArc } from './arcs.js';
import { queueChoice, resolveChoice } from './decisions.js';
import { genomeOf, phenotypeOf } from '../people/factory.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { grantHeirloom } from '../people/heirlooms.js';
import { ambientPool } from './selection.js';

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

  it('targets a chance-decided branch without seed-mining the branch draw', () => {
    const event = structuredClone(singleOutcomeNarration());
    if (event.interaction.kind !== 'narration') throw new Error('fixture changed kind');
    const original = event.interaction.outcomes[0]!;
    const naturalChoice = 'witness_chance_natural';
    const targetChoice = 'witness_chance_target';
    const naturalOutcome = `${original.id}_chance_natural` as typeof original.id;
    const targetOutcome = `${original.id}_chance_target` as typeof original.id;
    event.interaction = {
      kind: 'choice',
      decidedBy: 'chance',
      choices: [
        {
          id: naturalChoice,
          label: 'Natural branch',
          requires: [],
          outcomes: [{ ...structuredClone(original), id: naturalOutcome, weight: 1 }],
        },
        {
          id: targetChoice,
          label: 'Target branch',
          requires: [],
          outcomes: [{ ...structuredClone(original), id: targetOutcome, weight: 1 }],
        },
      ],
    };

    const naturalCtx = fixture(1108);
    const natural = executeOutcomeWitness(naturalCtx, event, {
      choiceId: targetChoice,
      expectedOutcomeId: targetOutcome,
      rng: alwaysFirstWeighted(31),
    });
    expect(natural.ok).toBe(false);
    expect(natural.reason).toContain(`automatic decider chose '${naturalChoice}'`);
    expect(naturalCtx.world.decisionLog).toHaveLength(0);

    const targetedCtx = fixture(1108);
    const targeted = executeOutcomeWitness(targetedCtx, event, {
      choiceId: targetChoice,
      expectedOutcomeId: targetOutcome,
      rng: alwaysFirstWeighted(31),
      targetChanceChoice: true,
    });

    expect(targeted.ok, targeted.reason).toBe(true);
    expect(targeted.key).toBe(`${event.id}|${targetChoice}|${targetOutcome}`);
    expect(targetedCtx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      choiceId: targetChoice,
      outcomeId: targetOutcome,
    });

    const zeroWeight = structuredClone(event);
    if (zeroWeight.interaction.kind === 'narration') throw new Error('fixture changed kind');
    zeroWeight.interaction.choices[1]!.outcomes[0]!.weight = 0;
    const zeroCtx = fixture(1108);
    const zero = executeOutcomeWitness(zeroCtx, zeroWeight, {
      choiceId: targetChoice,
      expectedOutcomeId: targetOutcome,
      rng: alwaysFirstWeighted(31),
      targetChanceChoice: true,
    });
    // Production branch weighting deliberately floors an empty outcome sum
    // to 1 so every decision can still resolve. The targeting adapter must
    // follow that effective weight instead of inventing a stricter rule.
    expect(zero.ok, zero.reason).toBe(true);
    expect(zero.key).toBe(`${event.id}|${targetChoice}|${targetOutcome}`);
    expect(zeroCtx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      choiceId: targetChoice,
      outcomeId: targetOutcome,
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
        || sourceEvent.record
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

  it('lets the player cast decide a delegated party branch through the production docket', () => {
    const search = fixture(1107);
    for (const sourceEvent of content.events) {
      if (
        sourceEvent.arc
        || sourceEvent.record
        || sourceEvent.interaction.kind === 'narration'
        || sourceEvent.interaction.decidedBy !== 'player'
        || sourceEvent.interaction.choices.length < 2
        || Object.keys(sourceEvent.slots).length === 0
        || !evalCondition(sourceEvent.conditions, search)
      ) continue;

      const deterministicChoices = sourceEvent.interaction.choices.filter((candidate) => (
        !candidate.check
        && candidate.requires.length === 0
        && candidate.outcomes.length === 1
      ));
      const [target, fallback] = deterministicChoices;
      if (!target || !fallback) continue;

      const original = resolveSlots(sourceEvent, search, makeRng(7));
      if (!original.ok || original.playerCast.length) continue;
      const slotId = Object.keys(sourceEvent.slots).find((id) => {
        const spec = sourceEvent.slots[id]!;
        return !spec.optional && !spec.count && typeof original.fill[id] === 'string';
      });
      if (!slotId) continue;
      const castId = original.fill[slotId];
      if (typeof castId !== 'string') continue;

      const event = structuredClone(sourceEvent);
      if (event.interaction.kind === 'narration') continue;
      event.slots[slotId]!.castBy = 'player';
      const checkId = 'witness_party_decider';
      event.checks.push({
        id: checkId,
        pool: { kind: 'party_sum', slots: [slotId], attr: 'strength' },
        difficulty: 0,
        variance: 'none',
        bands: [
          { atLeast: -1_000_000, outcome: target.id },
          { atLeast: -2_000_000, outcome: fallback.id },
        ],
      });
      event.interaction.decidedBy = { party: { check: checkId } };

      const wrongCtx = fixture(1107);
      const wrong = executeOutcomeWitness(wrongCtx, event, {
        choiceId: fallback.id,
        expectedOutcomeId: fallback.outcomes[0]!.id,
        rng: makeRng(7),
        cast: { [slotId]: castId },
      });
      expect(wrong.ok).toBe(false);
      expect(wrong.reason).toContain(`party decider chose '${target.id}'`);
      expect(wrongCtx.world.decisionLog).toHaveLength(0);

      const ctx = fixture(1107);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: target.id,
        expectedOutcomeId: target.outcomes[0]!.id,
        rng: makeRng(7),
        cast: { [slotId]: castId },
      });

      expect(result.ok, result.reason).toBe(true);
      expect(result.key).toBe(`${event.id}|${target.id}|${target.outcomes[0]!.id}`);
      expect(ctx.world.pendingDecisions).toHaveLength(0);
      expect(ctx.world.decisionLog.at(-1)).toMatchObject({
        kind: 'outcome',
        event: event.id,
        choiceId: target.id,
        outcomeId: target.outcomes[0]!.id,
        fill: { [slotId]: castId },
      });
      return;
    }

    throw new Error('fixture has no deterministic choice suitable for a delegated party-cast mutation');
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


describe('authored head-cast narration outcome witnesses', () => {
  it('executes every unscoped conditionless narration outcome with only the engine-cast Head', () => {
    const events = content.events.filter((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      return event.interaction.kind === 'narration'
        && event.tier !== 'frame'
        && event.conditions === undefined
        && event.ages === undefined
        && event.arc === undefined
        && slotIds.length === 1
        && slotIds[0] === 'HEAD'
        && head?.role === 'head'
        && head.castBy === 'engine';
    });

    const declared = events.flatMap((event) =>
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []);
    const witnessed: string[] = [];

    expect(declared.length).toBeGreaterThan(0);

    let seed = 4050;
    for (const event of events) {
      if (event.interaction.kind !== 'narration') continue;
      for (const outcome of event.interaction.outcomes) {
        const ctx = testWorld(content, seed);
        const result = executeOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: alwaysFirstWeighted(seed + 1),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          `${event.id}/${outcome.id}: ${result.reason}`,
        ).toBe(true);
        expect(result.key).toBe(outcomeKey(String(event.id), undefined, String(outcome.id)));
        if (result.key) witnessed.push(result.key);
        seed += 1;
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});



describe('authored age-scoped head-cast narration outcome witnesses', () => {
  it('proves the active Age admits every conditionless Head-only narration outcome before executing it', () => {
    const events = content.events.filter((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      return event.interaction.kind === 'narration'
        && event.tier !== 'frame'
        && event.conditions === undefined
        && event.ages?.only?.length === 1
        && event.ages.never === undefined
        && event.ages.register === undefined
        && event.arc === undefined
        && slotIds.length === 1
        && slotIds[0] === 'HEAD'
        && head?.role === 'head'
        && head.castBy === 'engine';
    });

    const declared = events.flatMap((event) =>
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []);
    const witnessed: string[] = [];

    expect(declared.length).toBeGreaterThan(0);

    let seed = 4300;
    for (const event of events) {
      if (event.interaction.kind !== 'narration') continue;
      const age = event.ages?.only?.[0];
      if (!age) throw new Error(`${event.id} lost its exclusive Age scope`);

      const outside = testWorld(content, seed);
      outside.world.generation = Math.max(
        outside.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      outside.world.age.active = [];
      expect(
        ambientPool(outside).some((candidate) => candidate.id === event.id),
        `${event.id} should be excluded outside ${age}`,
      ).toBe(false);

      for (const outcome of event.interaction.outcomes) {
        const ctx = testWorld(content, seed);
        ctx.world.age.active = [{
          age,
          began: ctx.world.year,
          named: true,
          paid: { standing: false },
        }];

        expect(
          ambientPool(ctx).some((candidate) => candidate.id === event.id),
          `${event.id} should be selectable during ${age}`,
        ).toBe(true);

        const result = executeOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: alwaysFirstWeighted(seed + 1),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          `${event.id}/${outcome.id}: ${result.reason}`,
        ).toBe(true);
        expect(result.key).toBe(outcomeKey(String(event.id), undefined, String(outcome.id)));
        if (result.key) witnessed.push(result.key);
        seed += 1;
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored age-elapsed head-cast narration outcome witnesses', () => {
  it('crosses each authored ageElapsed floor through the production ambient selector before executing outcomes', () => {
    const cases = content.events.flatMap((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      if (
        event.interaction.kind !== 'narration'
        || event.tier === 'frame'
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.arc !== undefined
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('ageElapsed' in leaf) || leaf.ageElapsed.op !== 'gte' || leaf.ageElapsed.years <= 0) {
        return [];
      }
      return [{ event, age: event.ages.only[0]!, years: leaf.ageElapsed.years }];
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.flatMap(({ event }) =>
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []);
    const witnessed: string[] = [];

    for (const [index, { event, age, years }] of cases.entries()) {
      const before = testWorld(content, 4600 + index);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.age.active = [{
        age,
        began: before.world.year - (years - 1),
        named: true,
        paid: { standing: false },
      }];
      expect(
        ambientPool(before).some((candidate) => candidate.id === event.id),
        `${event.id} should be blocked one year before ageElapsed >= ${years}`,
      ).toBe(false);

      if (event.interaction.kind !== 'narration') continue;
      for (const outcome of event.interaction.outcomes) {
        const ctx = testWorld(content, 5600 + index);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.age.active = [{
          age,
          began: ctx.world.year - years,
          named: true,
          paid: { standing: false },
        }];

        expect(
          ambientPool(ctx).some((candidate) => candidate.id === event.id),
          `${event.id} should be selectable at ageElapsed >= ${years}`,
        ).toBe(true);

        const result = executeOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: alwaysFirstWeighted(6600 + index),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          `${event.id}/${outcome.id}: ${result.reason}`,
        ).toBe(true);
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});
describe('authored age-elapsed optional-slot narration outcome witnesses', () => {
  it('executes ageElapsed narration when every non-Head slot is an optional engine cast', () => {
    const cases = content.events.flatMap((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      const optionalSlots = slotIds
        .filter((slotId) => slotId !== 'HEAD')
        .map((slotId) => event.slots[slotId]!);

      if (
        event.interaction.kind !== 'narration'
        || event.tier === 'frame'
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.arc !== undefined
        || slotIds.length <= 1
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || head.optional === true
        || optionalSlots.some((slot) => slot.castBy !== 'engine' || slot.optional !== true)
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('ageElapsed' in leaf) || leaf.ageElapsed.op !== 'gte' || leaf.ageElapsed.years <= 0) {
        return [];
      }

      return [{ event, age: event.ages.only[0]!, years: leaf.ageElapsed.years }];
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.flatMap(({ event }) =>
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []);
    const witnessed: string[] = [];
    let seed = 4800;

    for (const { event, age, years } of cases) {
      const before = testWorld(content, seed);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.age.active = [{
        age,
        began: before.world.year - (years - 1),
        named: true,
        paid: { standing: false },
      }];
      expect(
        ambientPool(before).some((candidate) => candidate.id === event.id),
        `${event.id} should be blocked one year before ageElapsed >= ${years}`,
      ).toBe(false);

      if (event.interaction.kind !== 'narration') continue;
      for (const outcome of event.interaction.outcomes) {
        const ctx = testWorld(content, seed);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.age.active = [{
          age,
          began: ctx.world.year - years,
          named: true,
          paid: { standing: false },
        }];

        expect(
          ambientPool(ctx).some((candidate) => candidate.id === event.id),
          `${event.id} should be selectable at ageElapsed >= ${years}`,
        ).toBe(true);

        const result = executeOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: alwaysFirstWeighted(seed + 1),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          `${event.id}/${outcome.id}: ${result.reason}`,
        ).toBe(true);
        expect(result.key).toBe(
          outcomeKey(String(event.id), undefined, String(outcome.id)),
        );
        if (result.key) witnessed.push(result.key);
        seed += 1;
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored age-elapsed head-cast player-choice outcome witnesses', () => {
  it('crosses each authored ageElapsed floor through the production ambient selector before executing simple player outcomes', () => {
    const cases = content.events.flatMap((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      if (
        event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.tier === 'frame'
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.arc !== undefined
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('ageElapsed' in leaf) || leaf.ageElapsed.op !== 'gte' || leaf.ageElapsed.years <= 0) {
        return [];
      }

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      return [{ event, age: event.ages.only[0]!, years: leaf.ageElapsed.years, choices }];
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];
    let seed = 4700;

    for (const { event, age, years, choices } of cases) {
      const before = testWorld(content, seed);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.age.active = [{
        age,
        began: before.world.year - (years - 1),
        named: true,
        paid: { standing: false },
      }];
      expect(
        ambientPool(before).some((candidate) => candidate.id === event.id),
        `${event.id} should be blocked one year before ageElapsed >= ${years}`,
      ).toBe(false);

      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.age.active = [{
            age,
            began: ctx.world.year - years,
            named: true,
            paid: { standing: false },
          }];

          expect(
            ambientPool(ctx).some((candidate) => candidate.id === event.id),
            `${event.id} should be selectable at ageElapsed >= ${years}`,
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored age-elapsed optional-slot player-choice outcome witnesses', () => {
  it('executes simple ageElapsed player outcomes when every non-Head slot is an optional engine cast', () => {
    const cases = content.events.flatMap((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      const optionalSlots = slotIds
        .filter((slotId) => slotId !== 'HEAD')
        .map((slotId) => event.slots[slotId]!);

      if (
        event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.tier === 'frame'
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.arc !== undefined
        || slotIds.length <= 1
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || head.optional === true
        || optionalSlots.some((slot) => slot.castBy !== 'engine' || slot.optional !== true)
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('ageElapsed' in leaf) || leaf.ageElapsed.op !== 'gte' || leaf.ageElapsed.years <= 0) {
        return [];
      }

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      return [{ event, age: event.ages.only[0]!, years: leaf.ageElapsed.years, choices }];
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];
    let seed = 4900;

    for (const { event, age, years, choices } of cases) {
      const before = testWorld(content, seed);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.age.active = [{
        age,
        began: before.world.year - (years - 1),
        named: true,
        paid: { standing: false },
      }];
      expect(
        ambientPool(before).some((candidate) => candidate.id === event.id),
        `${event.id} should be blocked one year before ageElapsed >= ${years}`,
      ).toBe(false);

      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.age.active = [{
            age,
            began: ctx.world.year - years,
            named: true,
            paid: { standing: false },
          }];

          expect(
            ambientPool(ctx).some((candidate) => candidate.id === event.id),
            `${event.id} should be selectable at ageElapsed >= ${years}`,
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored age-elapsed required-slot player-choice outcome witnesses', () => {
  function prepareRequiredSlots(
    ctx: ReturnType<typeof fixture>,
    eventId: string,
    seed: number,
  ): void {
    switch (eventId) {
      case 'the_shelf_that_has_to_go':
        place(ctx, {
          sex: 'female',
          age: 38,
          name: `Witness Archivist ${seed}`,
          contract: {
            role: 'archivist',
            term: 'yearly',
            wage: 1,
            loyalty: 50,
            boundTo: 'witness-house',
            onEmployerDeath: 'passes_to_heir',
            debt: 0,
            knowsSecrets: [],
          },
        });
        return;
      case 'who_gets_the_physician':
        // fixture() already carries three ordinary adult household members.
        return;
      case 'the_boy_they_send_us':
        place(ctx, {
          sex: 'male',
          age: 35,
          name: `Witness Envoy ${seed}`,
          house: 'house_ilm',
        });
        return;
      case 'the_youngest_asks':
        place(ctx, {
          sex: 'female',
          age: 12,
          name: `Witness Youngest ${seed}`,
        });
        return;
      default:
        throw new Error(`no required-slot fixture for ${eventId}`);
    }
  }

  it('executes every simple ageElapsed player outcome whose extra slots are required engine casts', () => {
    const cases = content.events.flatMap((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      const extraSlots = slotIds
        .filter((slotId) => slotId !== 'HEAD')
        .map((slotId) => event.slots[slotId]!);

      if (
        event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.tier === 'frame'
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.arc !== undefined
        || extraSlots.length === 0
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || head.optional === true
        || extraSlots.some((slot) => slot.castBy !== 'engine')
        || !extraSlots.some((slot) => slot.optional !== true)
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('ageElapsed' in leaf) || leaf.ageElapsed.op !== 'gte' || leaf.ageElapsed.years <= 0) {
        return [];
      }

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      return [{ event, age: event.ages.only[0]!, years: leaf.ageElapsed.years, choices }];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_boy_they_send_us',
      'the_shelf_that_has_to_go',
      'the_youngest_asks',
      'who_gets_the_physician',
    ]);

    const declared = cases.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];
    let seed = 5000;

    for (const { event, age, years, choices } of cases) {
      const before = fixture(seed);
      prepareRequiredSlots(before, String(event.id), seed);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.age.active = [{
        age,
        began: before.world.year - (years - 1),
        named: true,
        paid: { standing: false },
      }];
      expect(
        ambientPool(before).some((candidate) => candidate.id === event.id),
        `${event.id} should be blocked one year before ageElapsed >= ${years}`,
      ).toBe(false);

      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = fixture(seed);
          prepareRequiredSlots(ctx, String(event.id), seed);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.age.active = [{
            age,
            began: ctx.world.year - years,
            named: true,
            paid: { standing: false },
          }];

          expect(
            ambientPool(ctx).some((candidate) => candidate.id === event.id),
            `${event.id} should be selectable at ageElapsed >= ${years}`,
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

type AuthoredEvent = (typeof content.events)[number];
type AuthoredChoice = Extract<AuthoredEvent['interaction'], { kind: 'choice' }>['choices'][number];
type GenerationWitnessCase = {
  event: AuthoredEvent;
  generation: number;
  choices: AuthoredChoice[] | undefined;
};

describe('authored simple flag-gated outcome witnesses', () => {
  function gateOf(condition: NonNullable<(typeof content.events)[number]['conditions']>) {
    if ('flag' in condition) {
      const passing = condition.is !== false;
      return { flag: condition.flag, passing, blocked: !passing };
    }
    if ('not' in condition && 'flag' in condition.not) {
      const inner = condition.not;
      const blocked = inner.is !== false;
      return { flag: inner.flag, passing: !blocked, blocked };
    }
    return undefined;
  }

  function flagFixture(seed: number, event: (typeof content.events)[number], flag: string, value: boolean) {
    const ctx = fixture(seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );
    ctx.world.flags.set(flag, value);

    const onlyAge = event.ages?.only;
    if (onlyAge?.length === 1) {
      ctx.world.age.active = [{
        age: onlyAge[0]!,
        began: ctx.world.year,
        named: true,
        paid: { standing: false },
      }];
    }
    return ctx;
  }

  it('crosses each simple flag gate before production slot resolution, selection and outcome commit', () => {
    const cases = content.events.filter((event) => {
      if (event.tier === 'frame' || event.arc !== undefined || !event.conditions) return false;
      const gate = gateOf(event.conditions);
      if (!gate) return false;

      const slots = Object.values(event.slots);
      if (
        slots.length === 0
        || slots.some((slot) => (
          slot.castBy !== 'engine'
          || !['head', 'family_member'].includes(slot.role)
          || slot.filters.some((filter) => (
            Object.keys(filter).some((key) => !['sex', 'age', 'status', 'relation', 'of'].includes(key))
          ))
        ))
      ) return false;

      if (event.ages !== undefined && event.ages.only?.length !== 1) return false;
      if (event.interaction.kind === 'narration') return true;
      return event.interaction.decidedBy === 'player'
        && event.interaction.choices.every((choice) => (
          choice.requires.length === 0 && choice.check === undefined
        ));
    });

    expect(cases.map((event) => String(event.id)).sort()).toEqual([
      'the_inquest_that_sits_for_nine_days',
      'the_muster_is_called',
      'the_wayfolk_have_it_first',
    ]);

    const declared = cases.flatMap((event) => {
      if (event.interaction.kind === 'narration') {
        return event.interaction.outcomes.map((outcome) =>
          outcomeKey(String(event.id), undefined, String(outcome.id)));
      }
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 7600;

    for (const event of cases) {
      const gate = gateOf(event.conditions!);
      if (!gate) throw new Error(`${event.id} lost its simple flag gate`);

      const before = flagFixture(seed, event, gate.flag, gate.blocked);
      expect(
        evalCondition(event.conditions, before),
        `${event.id} should be blocked when ${gate.flag}=${gate.blocked}`,
      ).toBe(false);

      const selection = flagFixture(seed, event, gate.flag, gate.passing);
      expect(
        evalCondition(event.conditions, selection),
        `${event.id} should pass when ${gate.flag}=${gate.passing}`,
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, `${event.id} should resolve its authored slots`).toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, `${event.id} should not require a player cast`).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable once its flag/age/cast state is valid`,
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = flagFixture(seed, event, gate.flag, gate.passing);
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });
          expect(result.ok, `${event.id}/${outcome.id}: ${result.reason}`).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
        continue;
      }

      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = flagFixture(seed, event, gate.flag, gate.passing);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored Assize-gated outcome witnesses', () => {
  function assizeFixture(seed: number, pressure: number) {
    const ctx = testWorld(content, seed);
    const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'));
    if (!head) throw new Error('Assize witness fixture has no Head');

    place(ctx, {
      sex: 'male',
      age: 44,
      name: `Witness Steward ${seed}`,
      contract: {
        role: 'steward',
        term: 'yearly',
        wage: 8,
        loyalty: 60,
        boundTo: head.id,
        onEmployerDeath: 'passes_to_heir',
        debt: 0,
        knowsSecrets: [],
      },
    });
    ctx.world.assize.pressure = pressure;
    return ctx;
  }

  function crossing(op: 'lt' | 'lte' | 'eq' | 'gte' | 'gt' | 'ne', value: number) {
    const step = 0.01;
    switch (op) {
      case 'lt': return { blocked: value, passing: value - step };
      case 'lte': return { blocked: value + step, passing: value };
      case 'eq': return { blocked: value + step, passing: value };
      case 'gte': return { blocked: value - step, passing: value };
      case 'gt': return { blocked: value, passing: value + step };
      case 'ne': return { blocked: value, passing: value + step };
    }
  }

  it('crosses every authored Assize gate before resolving real Head/retainer casts and committing outcomes', () => {
    const cases = content.events.filter((event) => {
      const condition = event.conditions;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('assize' in condition)
      ) return false;

      const slots = Object.values(event.slots);
      if (
        slots.length === 0
        || slots.some((slot) => (
          slot.castBy !== 'engine'
          || !['head', 'retainer'].includes(slot.role)
          || slot.filters.some((filter) => (
            Object.keys(filter).some((key) => !['status'].includes(key))
          ))
        ))
      ) return false;

      if (event.interaction.kind === 'narration') return true;
      return event.interaction.decidedBy === 'player'
        && event.interaction.choices.every((choice) => (
          choice.requires.length === 0 && choice.check === undefined
        ));
    });

    expect(cases.map((event) => String(event.id)).sort()).toEqual([
      'the_assessor_at_the_door',
      'the_cart_from_the_chapter_house',
      'the_offer_in_another_room',
      'the_price_at_the_mill',
    ]);

    const declared = cases.flatMap((event) => {
      if (event.interaction.kind === 'narration') {
        return event.interaction.outcomes.map((outcome) =>
          outcomeKey(String(event.id), undefined, String(outcome.id)));
      }
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 7100;

    for (const event of cases) {
      const condition = event.conditions;
      if (!condition || !('assize' in condition)) {
        throw new Error(`${event.id} lost its Assize gate`);
      }
      const { blocked, passing } = crossing(condition.assize.op, condition.assize.value);

      const before = assizeFixture(seed, blocked);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(
        evalCondition(event.conditions, before),
        `${event.id} should be blocked at Assize pressure ${blocked}`,
      ).toBe(false);

      const selection = assizeFixture(seed, passing);
      selection.world.generation = Math.max(
        selection.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(
        evalCondition(event.conditions, selection),
        `${event.id} should pass at Assize pressure ${passing}`,
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, `${event.id} should resolve its authored Head/retainer slots`).toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, `${event.id} should not require a player cast`).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable once its Assize gate and cast state are valid`,
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = assizeFixture(seed, passing);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });
          expect(result.ok, `${event.id}/${outcome.id}: ${result.reason}`).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
        continue;
      }

      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = assizeFixture(seed, passing);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored generation-gated Head-only outcome witnesses', () => {
  it('crosses each simple generation floor through the production condition evaluator before executing outcomes', () => {
    const cases = content.events.flatMap<GenerationWitnessCase>((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      const condition = event.conditions;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
      ) return [];

      const leaf = condition.all[0];
      if (
        !leaf
        || !('generation' in leaf)
        || leaf.generation.op !== 'gte'
        || leaf.generation.value <= 0
      ) return [];

      if (event.interaction.kind === 'narration') {
        return [{
          event,
          generation: leaf.generation.value,
          choices: undefined,
        }];
      }
      if (event.interaction.decidedBy !== 'player') return [];

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      return [{
        event,
        generation: leaf.generation.value,
        choices,
      }];
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.flatMap(({ event, choices }) => {
      if (event.interaction.kind === 'narration') {
        return event.interaction.outcomes.map((outcome) =>
          outcomeKey(String(event.id), undefined, String(outcome.id)));
      }
      return (choices ?? []).flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 5100;

    for (const { event, generation, choices } of cases) {
      const before = testWorld(content, seed);
      before.world.generation = generation - 1;
      expect(
        evalCondition(event.conditions, before),
        `${event.id} should be blocked before generation >= ${generation}`,
      ).toBe(false);

      const selection = testWorld(content, seed);
      selection.world.generation = Math.max(
        generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(
        evalCondition(event.conditions, selection),
        `${event.id} should satisfy generation >= ${generation}`,
      ).toBe(true);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable once its generation and frequency floors are met`,
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
        continue;
      }

      for (const choice of choices ?? []) {
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored generation-gated ordinary-family outcome witnesses', () => {
  it('executes simple generation-gated outcomes after resolving their real household casts', () => {
    const ordinaryFilterKeys = new Set(['sex', 'age', 'status', 'relation', 'of']);
    const cases = content.events.flatMap<GenerationWitnessCase>((event) => {
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
      ) return [];

      const condition = event.conditions;
      if (!condition || !('all' in condition) || condition.all.length !== 1) return [];
      const leaf = condition.all[0];
      if (
        !leaf
        || !('generation' in leaf)
        || leaf.generation.op !== 'gte'
        || leaf.generation.value <= 0
      ) return [];

      const slots = Object.values(event.slots);
      if (
        slots.length === 0
        || !slots.some((slot) => slot.role !== 'head')
        || slots.some((slot) => (
          slot.castBy !== 'engine'
          || !['head', 'family_member', 'unwoken'].includes(slot.role)
          || slot.filters.some((filter) => (
            Object.keys(filter).some((key) => !ordinaryFilterKeys.has(key))
          ))
        ))
      ) return [];

      if (event.interaction.kind === 'narration') {
        return [{
          event,
          generation: leaf.generation.value,
          choices: undefined,
        }];
      }
      if (event.interaction.decidedBy !== 'player') return [];

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      return [{
        event,
        generation: leaf.generation.value,
        choices,
      }];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_advocate_on_retainer',
      'the_book_comes_down',
      'the_book_that_is_wrong',
      'the_book_that_needs_a_reader',
      'the_box_under_the_leases',
      'the_fair_copy',
      'the_ordination',
      'the_seal_questioned',
      'the_stipend_refused',
    ]);

    const declared = cases.flatMap(({ event, choices }) => {
      if (event.interaction.kind === 'narration') {
        return event.interaction.outcomes.map((outcome) =>
          outcomeKey(String(event.id), undefined, String(outcome.id)));
      }
      return (choices ?? []).flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 6100;

    for (const { event, generation, choices } of cases) {
      const before = fixture(seed);
      before.world.generation = generation - 1;
      expect(
        evalCondition(event.conditions, before),
        `${event.id} should be blocked before generation >= ${generation}`,
      ).toBe(false);

      const selection = fixture(seed);
      selection.world.generation = Math.max(
        generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(
        evalCondition(event.conditions, selection),
        `${event.id} should satisfy generation >= ${generation}`,
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, `${event.id} should resolve its authored household slots`).toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, `${event.id} should not require a player cast`).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable once generation and cast state are valid`,
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = fixture(seed);
          ctx.world.generation = Math.max(
            generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });
          expect(result.ok, `${event.id}/${outcome.id}: ${result.reason}`).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
        continue;
      }

      for (const choice of choices ?? []) {
        for (const outcome of choice.outcomes) {
          const ctx = fixture(seed);
          ctx.world.generation = Math.max(
            generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored head-cast player-choice outcome witnesses', () => {
  it('executes every unscoped conditionless unchecked player outcome with only the engine-cast Head', () => {
    const events = content.events.filter((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      return event.interaction.kind !== 'narration'
        && event.interaction.decidedBy === 'player'
        && event.tier !== 'frame'
        && event.conditions === undefined
        && event.ages === undefined
        && event.arc === undefined
        && slotIds.length === 1
        && slotIds[0] === 'HEAD'
        && head?.role === 'head'
        && head.castBy === 'engine';
    });

    const declared = events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) => (
        choice.requires.length === 0 && choice.check === undefined
          ? choice.outcomes.map((outcome) =>
              outcomeKey(String(event.id), String(choice.id), String(outcome.id)))
          : []
      ));
    });
    const witnessed: string[] = [];

    expect(declared.length).toBeGreaterThan(0);

    let seed = 4200;
    for (const event of events) {
      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        if (choice.requires.length || choice.check !== undefined) continue;
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored age-scoped head-cast player-choice outcome witnesses', () => {
  it('proves the active Age admits every conditionless unchecked Head-only player outcome before executing it', () => {
    const events = content.events.filter((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      return event.interaction.kind !== 'narration'
        && event.interaction.decidedBy === 'player'
        && event.tier !== 'frame'
        && event.conditions === undefined
        && event.ages?.only?.length === 1
        && event.ages.never === undefined
        && event.ages.register === undefined
        && event.arc === undefined
        && slotIds.length === 1
        && slotIds[0] === 'HEAD'
        && head?.role === 'head'
        && head.castBy === 'engine';
    });

    const declared = events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) => (
        choice.requires.length === 0 && choice.check === undefined
          ? choice.outcomes.map((outcome) =>
              outcomeKey(String(event.id), String(choice.id), String(outcome.id)))
          : []
      ));
    });
    const witnessed: string[] = [];

    expect(declared.length).toBeGreaterThan(0);

    let seed = 4400;
    for (const event of events) {
      if (event.interaction.kind === 'narration') continue;
      const age = event.ages?.only?.[0];
      if (!age) throw new Error(`${event.id} lost its exclusive Age scope`);

      const outside = testWorld(content, seed);
      outside.world.generation = Math.max(
        outside.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      outside.world.age.active = [];
      expect(
        ambientPool(outside).some((candidate) => candidate.id === event.id),
        `${event.id} should be excluded outside ${age}`,
      ).toBe(false);

      const eligibleChoices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));

      for (const choice of eligibleChoices) {
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.age.active = [{
            age,
            began: ctx.world.year,
            named: true,
            paid: { standing: false },
          }];

          expect(
            ambientPool(ctx).some((candidate) => candidate.id === event.id),
            `${event.id} should be selectable during ${age}`,
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 1),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored age-scoped checked player-choice outcome witnesses', () => {
  it('executes every conditionless randomised checked Head-only player outcome in its active Age', () => {
    const events = content.events.filter((event) => {
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      return event.interaction.kind !== 'narration'
        && event.interaction.decidedBy === 'player'
        && event.tier !== 'frame'
        && event.conditions === undefined
        && event.ages?.only?.length === 1
        && event.ages.never === undefined
        && event.ages.register === undefined
        && event.arc === undefined
        && slotIds.length === 1
        && slotIds[0] === 'HEAD'
        && head?.role === 'head'
        && head.castBy === 'engine';
    });

    const cases = events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) => {
        if (choice.requires.length || !choice.check) return [];
        const check = event.checks.find((candidate) => candidate.id === choice.check);
        if (!check || check.variance === 'none') return [];
        return choice.outcomes.map((outcome) => ({ event, choice, check, outcome }));
      });
    });

    expect(cases.length).toBeGreaterThan(0);

    const declared = cases.map(({ event, choice, outcome }) =>
      outcomeKey(String(event.id), String(choice.id), String(outcome.id)));
    const witnessed: string[] = [];

    for (const [index, { event, choice, check, outcome }] of cases.entries()) {
      const age = event.ages?.only?.[0];
      if (!age) throw new Error(`${event.id} lost its exclusive Age scope`);
      expect(
        check.bands.some((band) => band.outcome === outcome.id),
        `${event.id}/${choice.id}/${outcome.id} is not named by ${check.id}`,
      ).toBe(true);

      const ctx = testWorld(content, 4500 + index);
      ctx.world.generation = Math.max(
        ctx.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      ctx.world.age.active = [{
        age,
        began: ctx.world.year,
        named: true,
        paid: { standing: false },
      }];

      expect(
        ambientPool(ctx).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable during ${age}`,
      ).toBe(true);

      const result = executeOutcomeWitness(ctx, event, {
        choiceId: choice.id,
        expectedOutcomeId: outcome.id,
        rng: makeRng(5500 + index),
        targetCheckedOutcome: true,
      });

      expect(
        result.ok,
        `${event.id}/${choice.id}/${outcome.id}: ${result.reason}`,
      ).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});
describe('authored state-decider outcome witnesses', () => {
  type StateWitnessCase = {
    eventId: string;
    choiceId: string;
    outcomeId: string;
    prepare: (ctx: ReturnType<typeof fixture>) => void;
    targetWeightedOutcome?: boolean;
  };

  const cases: StateWitnessCase[] = [
    {
      eventId: 'the_hiring_at_bramme_fair',
      choiceId: 'take_the_lag_man',
      outcomeId: 'lag_man',
      prepare: (ctx) => { ctx.world.treasury = 119; },
    },
    {
      eventId: 'the_hiring_at_bramme_fair',
      choiceId: 'take_the_reeves_daughter',
      outcomeId: 'reeves_girl',
      prepare: (ctx) => { ctx.world.treasury = 120; },
    },
    {
      eventId: 'the_cook_and_the_new_maid',
      choiceId: 'the_head_settles_it',
      outcomeId: 'settled_from_above',
      prepare: (ctx) => { ctx.world.respect = 'known'; },
    },
    {
      eventId: 'the_cook_and_the_new_maid',
      choiceId: 'let_her_settle_it',
      outcomeId: 'she_settles_it',
      prepare: (ctx) => { ctx.world.respect = 'regarded'; },
    },
    {
      eventId: 'the_invitation_from_cawdry',
      choiceId: 'write_the_regrets',
      outcomeId: 'regrets',
      prepare: (ctx) => { ctx.world.treasury = 89; },
    },
    {
      eventId: 'the_invitation_from_cawdry',
      choiceId: 'go_to_cawdry',
      outcomeId: 'went',
      prepare: (ctx) => { ctx.world.treasury = 90; },
    },
    {
      eventId: 'what_hangs_in_smoke',
      choiceId: 'find_out_who',
      outcomeId: 'it_was_the_yard_man',
      prepare: (ctx) => { ctx.world.treasury = 139; },
      targetWeightedOutcome: true,
    },
    {
      eventId: 'what_hangs_in_smoke',
      choiceId: 'find_out_who',
      outcomeId: 'nobody_admits_it',
      prepare: (ctx) => { ctx.world.treasury = 139; },
      targetWeightedOutcome: true,
    },
    {
      eventId: 'what_hangs_in_smoke',
      choiceId: 'buy_the_difference',
      outcomeId: 'bought_and_locked',
      prepare: (ctx) => { ctx.world.treasury = 140; },
    },
    {
      eventId: 'the_reeve_at_ingathering',
      choiceId: 'take_it_whole',
      outcomeId: 'taken_whole',
      prepare: (ctx) => {
        ctx.world.treasury = 149;
        ctx.world.discontent = 100;
      },
    },
    {
      eventId: 'the_reeve_at_ingathering',
      choiceId: 'forgive',
      outcomeId: 'forgiven',
      prepare: (ctx) => {
        ctx.world.treasury = 150;
        ctx.world.discontent = 25;
      },
    },
    {
      eventId: 'the_reeve_at_ingathering',
      choiceId: 'take_in_kind',
      outcomeId: 'taken_in_kind',
      prepare: (ctx) => {
        ctx.world.treasury = 150;
        ctx.world.discontent = 24;
      },
    },
  ];

  it('executes every authored state-decided outcome from an explicit witness world', () => {
    const authored = content.events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      const decider = event.interaction.decidedBy;
      if (typeof decider !== 'object' || !('state' in decider)) return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) => outcomeKey(String(event.id), choice.id, outcome.id)),
      );
    }).sort();

    const witnessed: string[] = [];
    for (const [index, witness] of cases.entries()) {
      const event = content.events.find((candidate) => String(candidate.id) === witness.eventId);
      expect(event, 'missing authored state event ' + witness.eventId).toBeDefined();
      if (!event) continue;

      const ctx = fixture(1300 + index);
      witness.prepare(ctx);
      const result = executeOutcomeWitness(ctx, event, {
        expectedOutcomeId: witness.outcomeId,
        choiceId: witness.choiceId,
        rng: alwaysFirstWeighted(2300 + index),
        targetWeightedOutcome: witness.targetWeightedOutcome,
      });

      expect(
        result.ok,
        witness.eventId + '/' + witness.choiceId + ' -> ' + witness.outcomeId + ': ' + (result.reason ?? 'no reason'),
      ).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(witnessed.sort()).toEqual(authored);
  });
});

describe('authored choice-requirement witnesses', () => {
  function setCastAttribute(
    ctx: ReturnType<typeof fixture>,
    fill: SlotFill,
    slot: string,
    attr: 'charm' | 'strength',
    acquired: number,
  ): void {
    const id = fill[slot];
    if (typeof id !== 'string') throw new Error('expected a single cast for ' + slot);
    const person = ctx.world.people.get(id);
    if (!person) throw new Error('missing cast person ' + id);
    person.acquired[attr] = acquired;
    if (person.phenotype) person.phenotype.dirty = true;
  }

  function activeAge(age: string, began: number): ActiveAge {
    return { age, began, named: true, paid: { standing: false } };
  }

  function musterPosition(seed: number) {
    const ctx = fixture(seed);
    ctx.world.age.active = [activeAge('the_wars', ctx.world.year)];

    const arc = content.arc('arc_the_muster');
    if (!arc) throw new Error('muster arc fixture is missing');
    const rng = makeRng(seed + 100);
    const instance = startArc(arc, ctx, rng);
    if (!instance) throw new Error('muster arc fixture did not start');

    const leaders = dueArcSteps(ctx, rng).find((candidate) => candidate.instance.id === instance.id);
    if (!leaders || leaders.node.id !== 'leaders') {
      throw new Error('muster leaders entry did not become due');
    }
    const leadersEvent = content.event(leaders.node.event);
    if (!leadersEvent || leadersEvent.interaction.kind === 'narration') {
      throw new Error('muster leaders fixture changed interaction');
    }

    const officer = ctx.world.people.living().find((person) => person.name === 'Witness Older Man ' + seed);
    const sent = ctx.world.people.living().find((person) => person.name === 'Witness Young Man ' + seed);
    if (!officer || !sent) throw new Error('muster cast fixture is missing');

    const pending = queueChoice(
      ctx,
      leadersEvent,
      leadersEvent.body,
      leaders.fill,
      leaders.playerCast,
      leaders,
    );
    const resolved = resolveChoice(ctx, pending.id, undefined, rng, {
      OFFICER: officer.id,
      SENT: [sent.id],
    });
    if (!resolved.ok) throw new Error(resolved.reason ?? 'muster leaders cast did not resolve');

    for (let year = 0; year <= 5; year++) {
      const position = dueArcSteps(ctx, rng).find((candidate) => (
        candidate.instance.id === instance.id && candidate.node.id === 'position'
      ));
      if (position) {
        const event = content.event(position.node.event);
        if (!event || event.interaction.kind === 'narration') {
          throw new Error('muster position fixture changed interaction');
        }
        if (position.playerCast.length) {
          throw new Error('muster position unexpectedly still needs player cast');
        }
        return { ctx, event, position };
      }
      ctx.world.year += 1;
    }

    throw new Error('muster position did not become due');
  }

  it('executes every authored requires-gated outcome from an explicit satisfiable cast', () => {
    const authored = content.events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) => (
        choice.requires.length
          ? choice.outcomes.map((outcome) => outcomeKey(String(event.id), choice.id, outcome.id))
          : []
      ));
    }).sort();

    const witnessed: string[] = [];

    for (const [index, witness] of [
      { choiceId: 'buy_the_captaincy', outcomeId: 'bought_captaincy' },
      { choiceId: 'buy_the_banner', outcomeId: 'bought_banner' },
    ].entries()) {
      const { ctx, event, position } = musterPosition(1400 + index);

      setCastAttribute(ctx, position.fill, 'HEAD', 'charm', -10_000);
      const blocked = executeOutcomeWitness(ctx, event, {
        choiceId: witness.choiceId,
        expectedOutcomeId: witness.outcomeId,
        rng: makeRng(3400 + index),
        arcStep: position,
      });
      expect(blocked.ok).toBe(false);
      expect(ctx.world.decisionLog.some((entry) => (
        entry.kind === 'outcome' && entry.event === event.id
      ))).toBe(false);

      setCastAttribute(ctx, position.fill, 'HEAD', 'charm', 10_000);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: witness.choiceId,
        expectedOutcomeId: witness.outcomeId,
        rng: makeRng(3400 + index),
        arcStep: position,
      });
      expect(result.ok, result.reason).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    for (const [index, outcomeId] of ['struck', 'fell'].entries()) {
      const ctx = fixture(1500 + index);
      ctx.world.generation = 4;
      const event = content.event('the_seal_questioned');
      if (!event || event.interaction.kind === 'narration') {
        throw new Error('seal requirement fixture changed interaction');
      }
      const slots = resolveSlots(event, ctx, makeRng(3500 + index));
      if (!slots.ok || slots.playerCast.length) {
        throw new Error('seal requirement fixture cannot resolve its cast');
      }

      setCastAttribute(ctx, slots.fill, 'HEAD', 'strength', -10_000);
      const blocked = executeOutcomeWitness(ctx, event, {
        choiceId: 'strike',
        expectedOutcomeId: outcomeId,
        rng: makeRng(3500 + index),
        targetWeightedOutcome: true,
      });
      expect(blocked.ok).toBe(false);
      expect(ctx.world.decisionLog).toHaveLength(0);

      setCastAttribute(ctx, slots.fill, 'HEAD', 'strength', 10_000);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: 'strike',
        expectedOutcomeId: outcomeId,
        rng: makeRng(3500 + index),
        targetWeightedOutcome: true,
      });
      expect(result.ok, result.reason).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(witnessed.sort()).toEqual(authored);
  });
});



describe('authored weighted player-cast outcome witnesses', () => {
  function unmakingFixture() {
    const ctx = testWorld(content, 3599);
    const donor = ctx.world.people.living()
      .find((person) => phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress);
    if (!donor) throw new Error('Unmaking fixture has no founding expresser genome');

    const elder = place(ctx, {
      sex: 'male',
      age: 70,
      name: 'Witness Unmaking Elder',
      castSlots: ['head'],
    });
    elder.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    elder.phenotype = undefined;
    elder.awakening.awakened = true;
    elder.acquired[ELDRITCH_GIFT] = 26;
    elder.acquired.mind = 90;
    elder.madness = 60;
    elder.rites.push('vessel', 'great_rite');
    elder.traits.add(asId('asked_for_in_wick'));
    elder.traits.add(asId('went_past_the_book'));
    const elderBooks = new Set([
      'lesser_workings_of_fluid', 'lesser_workings_of_thermal', 'lesser_workings_of_aero',
      'lesser_workings_of_terra', 'lesser_workings_of_life', 'lesser_workings_of_death',
      'the_marrow_codex',
    ]);
    for (const book of content.spellbooks) {
      if (elderBooks.has(String(book.id))) elder.spellsKnown.push(book.id);
    }
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');

    const ascendant = place(ctx, {
      sex: 'male',
      age: 40,
      name: 'Witness Unmaking Descendant',
    });
    ctx.world.people.setParents(ascendant.id, { father: elder.id });
    ascendant.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    ascendant.phenotype = undefined;
    ascendant.awakening.awakened = true;
    ascendant.acquired[ELDRITCH_GIFT] = 60;
    ascendant.acquired[ELDRITCH_REACH] = 6;
    ascendant.acquired.mind = 200;
    for (const book of content.spellbooks.slice(0, 8)) ascendant.spellsKnown.push(book.id);

    ctx.world.respect = 'eminent';
    // Authored event conditions read the annual house measurement, while slot
    // filters below read live standingOf(). This fixture intentionally sets
    // both sides of that production distinction without playing a year.
    ctx.world.ascension.rung = 'hierophant';
    ctx.world.ascension.best = 'hierophant';

    const event = content.event('the_unmaking');
    if (!event || event.interaction.kind === 'narration') {
      throw new Error('Unmaking fixture changed interaction');
    }
    return { ctx, event, ascendant };
  }

  it('executes both authored Unmaking outcomes through the production player-cast docket', () => {
    const witnessed: string[] = [];

    for (const [index, outcomeId] of ['taken', 'failed_at_the_last_step'].entries()) {
      const { ctx, event, ascendant } = unmakingFixture();
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: 'go_through_with_it',
        expectedOutcomeId: outcomeId,
        rng: alwaysFirstWeighted(3600 + index),
        cast: { ASCENDANT: ascendant.id },
        targetWeightedOutcome: true,
      });

      expect(result.ok, result.reason).toBe(true);
      if (result.key) witnessed.push(result.key);
      expect(ctx.world.decisionLog.some((entry) => (
        entry.kind === 'outcome'
        && entry.event === event.id
        && entry.choiceId === 'go_through_with_it'
        && entry.outcomeId === outcomeId
      ))).toBe(true);
    }

    expect(witnessed.sort()).toEqual([
      outcomeKey('the_unmaking', 'go_through_with_it', 'failed_at_the_last_step'),
      outcomeKey('the_unmaking', 'go_through_with_it', 'taken'),
    ].sort());
  });

  it('refuses an unweighted multi-outcome docket witness before committing', () => {
    const { ctx, event, ascendant } = unmakingFixture();
    const result = executeOutcomeWitness(ctx, event, {
      choiceId: 'go_through_with_it',
      expectedOutcomeId: 'failed_at_the_last_step',
      rng: alwaysFirstWeighted(3700),
      cast: { ASCENDANT: ascendant.id },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('multi-outcome player-cast witness requires targetWeightedOutcome');
    expect(ctx.world.decisionLog.some((entry) => (
      entry.kind === 'outcome' && entry.event === event.id
    ))).toBe(false);
  });

  it('does not invent a player-cast witness for a zero-weight outcome', () => {
    const { ctx, event, ascendant } = unmakingFixture();
    const mutated = structuredClone(event);
    if (mutated.interaction.kind === 'narration') throw new Error('Unmaking fixture changed interaction');
    const choice = mutated.interaction.choices.find((candidate) => candidate.id === 'go_through_with_it');
    const outcome = choice?.outcomes.find((candidate) => candidate.id === 'failed_at_the_last_step');
    if (!outcome) throw new Error('Unmaking failure outcome is missing');
    outcome.weight = 0;

    const result = executeOutcomeWitness(ctx, mutated, {
      choiceId: 'go_through_with_it',
      expectedOutcomeId: 'failed_at_the_last_step',
      rng: alwaysFirstWeighted(3701),
      cast: { ASCENDANT: ascendant.id },
      targetWeightedOutcome: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("outcome 'failed_at_the_last_step' has no authored weight to target");
    expect(ctx.world.decisionLog).toHaveLength(0);
  });
});


describe('authored direct player-cast outcome witnesses', () => {
  type DirectPlayerEvent = 'the_vessel_rite' | 'the_unmaking' | 'the_second_name';

  function directPlayerFixture(seed: number, eventId: DirectPlayerEvent) {
    const ctx = testWorld(content, seed);
    const donor = ctx.world.people.living()
      .find((person) => phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress);
    if (!donor) throw new Error('direct player-cast fixture has no founding expresser genome');

    // The foremost man is a real Hierophant-shaped body, using the same
    // production ladder inputs as the weighted Unmaking witness above.
    const elder = place(ctx, {
      sex: 'male',
      age: 70,
      name: `Witness Direct Elder ${seed}`,
      castSlots: ['head'],
    });
    elder.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    elder.phenotype = undefined;
    elder.awakening.awakened = true;
    elder.acquired[ELDRITCH_GIFT] = 26;
    elder.acquired.mind = 90;
    elder.madness = 60;
    elder.traits.add(asId('asked_for_in_wick'));
    elder.traits.add(asId('went_past_the_book'));
    const elderBooks = new Set([
      'lesser_workings_of_fluid', 'lesser_workings_of_thermal', 'lesser_workings_of_aero',
      'lesser_workings_of_terra', 'lesser_workings_of_life', 'lesser_workings_of_death',
      'the_marrow_codex',
    ]);
    for (const book of content.spellbooks) {
      if (elderBooks.has(String(book.id))) elder.spellsKnown.push(book.id);
    }
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');

    let selected: ReturnType<typeof place>;
    if (eventId === 'the_vessel_rite') {
      // The Vessel need only be living blood. Keep this person ordinary so
      // the engine's foremost slot still names the elder who takes the rite.
      selected = place(ctx, {
        sex: 'female',
        age: 30,
        name: `Witness Vessel Subject ${seed}`,
      });
      ctx.world.people.setParents(selected.id, { father: elder.id });
    } else {
      // Unmaking and Second Name need a second actual expresser. Give him the
      // measured high-end fixture shape rather than bypassing slot filters.
      elder.rites.push('vessel', 'great_rite');
      selected = place(ctx, {
        sex: 'male',
        age: 40,
        name: `Witness Direct Ascendant ${seed}`,
      });
      ctx.world.people.setParents(selected.id, { father: elder.id });
      selected.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
      selected.phenotype = undefined;
      selected.awakening.awakened = true;
      selected.acquired[ELDRITCH_GIFT] = 60;
      selected.acquired[ELDRITCH_REACH] = 6;
      selected.acquired.mind = 200;
      for (const book of content.spellbooks.slice(0, 8)) selected.spellsKnown.push(book.id);
    }

    let vessel = selected;
    if (eventId === 'the_second_name') {
      // The second man is the ascendant; the player names a third blood
      // relative to spend on him.
      vessel = place(ctx, {
        sex: 'female',
        age: 18,
        name: `Witness Second Vessel ${seed}`,
      });
      ctx.world.people.setParents(vessel.id, { father: selected.id });
    }

    ctx.world.respect = 'eminent';
    // Event conditions read the annual house measurement; slot filters read
    // live standing. Pin only the former, exactly as the Unmaking fixture does.
    ctx.world.ascension.rung = 'hierophant';
    ctx.world.ascension.best = 'hierophant';

    const event = content.event(eventId);
    if (!event || event.interaction.kind === 'narration') {
      throw new Error(`${eventId} direct player-cast fixture changed interaction`);
    }

    const cast: SlotFill = eventId === 'the_unmaking'
      ? { ASCENDANT: selected.id }
      : { VESSEL: vessel.id };

    return { ctx, event, cast };
  }

  it('keeps the authored direct player-cast outcome inventory explicit', () => {
    const authored = content.events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      if (event.interaction.decidedBy !== 'player') return [];
      if (!Object.values(event.slots).some((slot) => slot.castBy === 'player')) return [];

      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    }).sort();

    expect(authored).toEqual([
      outcomeKey('the_vessel_rite', 'speak_the_name', 'taken'),
      outcomeKey('the_vessel_rite', 'send_them_out_of_the_room', 'spared'),
      outcomeKey('the_unmaking', 'go_through_with_it', 'taken'),
      outcomeKey('the_unmaking', 'go_through_with_it', 'failed_at_the_last_step'),
      outcomeKey('the_unmaking', 'let_him_be', 'left'),
      outcomeKey('the_second_name', 'name_the_second', 'raised'),
      outcomeKey('the_second_name', 'one_is_enough', 'refused'),
    ].sort());
  });

  it('executes every authored direct player-cast outcome through the real docket', () => {
    const cases = [
      ['the_vessel_rite', 'speak_the_name', 'taken'],
      ['the_vessel_rite', 'send_them_out_of_the_room', 'spared'],
      ['the_unmaking', 'go_through_with_it', 'taken'],
      ['the_unmaking', 'go_through_with_it', 'failed_at_the_last_step'],
      ['the_unmaking', 'let_him_be', 'left'],
      ['the_second_name', 'name_the_second', 'raised'],
      ['the_second_name', 'one_is_enough', 'refused'],
    ] as const satisfies readonly (readonly [DirectPlayerEvent, string, string])[];

    const witnessed: string[] = [];
    for (const [index, [eventId, choiceId, outcomeId]] of cases.entries()) {
      const seed = 4100 + index;
      const { ctx, event, cast } = directPlayerFixture(seed, eventId);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId,
        expectedOutcomeId: outcomeId,
        rng: alwaysFirstWeighted(seed + 50),
        cast,
        targetWeightedOutcome: eventId === 'the_unmaking'
          && choiceId === 'go_through_with_it',
      });

      expect(result.ok, `${eventId}/${choiceId}/${outcomeId}: ${result.reason}`).toBe(true);
      expect(result.key).toBe(outcomeKey(eventId, choiceId, outcomeId));
      expect(ctx.world.decisionLog.some((entry) => (
        entry.kind === 'outcome'
        && entry.event === event.id
        && entry.choiceId === choiceId
        && entry.outcomeId === outcomeId
      ))).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(witnessed.sort()).toEqual(cases
      .map(([eventId, choiceId, outcomeId]) => outcomeKey(eventId, choiceId, outcomeId))
      .sort());
  });
});

describe('authored randomised party-decider witnesses', () => {
  function namedAdults(ctx: ReturnType<typeof fixture>, seed: number) {
    const young = ctx.world.people.living().find((person) => person.name === `Witness Young Man ${seed}`);
    const older = ctx.world.people.living().find((person) => person.name === `Witness Older Man ${seed}`);
    const woman = ctx.world.people.living().find((person) => person.name === `Witness Woman ${seed}`);
    if (!young || !older || !woman) throw new Error('party witness fixture is missing its adults');
    return { young, older, woman };
  }

  it('keeps the authored party-decider inventory explicit', () => {
    const authored = content.events.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      const decider = event.interaction.decidedBy;
      return typeof decider === 'object' && 'party' in decider ? [String(event.id)] : [];
    }).sort();

    expect(authored).toEqual([
      'riding_the_rents',
      'the_wheel_stops',
      'who_leads_them',
    ].sort());
  });

  it('executes every branch of the two ambient randomised party dispatches', () => {
    const cases = [
      {
        eventId: 'riding_the_rents',
        slots: ['RIDER_A', 'RIDER_B', 'RIDER_C'] as const,
        branches: [
          ['they_come_back_with_it', 'all_four'],
          ['they_come_back_with_half', 'half'],
          ['two_holdings_stand_empty', 'empty'],
        ] as const,
      },
      {
        eventId: 'the_wheel_stops',
        slots: ['SENT_A', 'SENT_B', 'SENT_C'] as const,
        branches: [
          ['they_clear_it', 'cleared'],
          ['they_clear_it_hard', 'cleared_hard'],
          ['they_come_back_wet', 'not_shifted'],
        ] as const,
      },
    ];

    let seed = 3800;
    for (const testCase of cases) {
      for (const [choiceId, outcomeId] of testCase.branches) {
        const ctx = fixture(seed);
        const { young, older, woman } = namedAdults(ctx, seed);
        const event = content.event(testCase.eventId);
        if (!event || event.interaction.kind === 'narration') {
          throw new Error(`${testCase.eventId} party fixture changed interaction`);
        }
        const [a, b, c] = testCase.slots;
        const result = executeOutcomeWitness(ctx, event, {
          choiceId,
          expectedOutcomeId: outcomeId,
          rng: alwaysLowNormal(seed + 50),
          cast: { [a]: older.id, [b]: young.id, [c]: woman.id },
          targetPartyChoice: true,
        });

        expect(result.ok, `${testCase.eventId}/${choiceId}: ${result.reason}`).toBe(true);
        expect(result.key).toBe(outcomeKey(testCase.eventId, choiceId, outcomeId));
        seed += 1;
      }
    }
  });

  it('executes every authored Muster leaders branch through its real arc step and docket', () => {
    const branches = [
      ['they_are_a_company', 'a_company'],
      ['they_are_a_levy', 'a_levy'],
      ['they_are_a_list', 'a_list'],
    ] as const;

    for (const [index, [choiceId, outcomeId]] of branches.entries()) {
      const seed = 3900 + index;
      const ctx = fixture(seed);
      ctx.world.age.active = [{
        age: 'the_wars',
        began: ctx.world.year,
        named: true,
        paid: { standing: false },
      }];

      const arc = content.arc('arc_the_muster');
      if (!arc) throw new Error('muster arc fixture is missing');
      const setupRng = makeRng(seed + 20);
      const instance = startArc(arc, ctx, setupRng);
      if (!instance) throw new Error('muster arc fixture did not start');
      const step = dueArcSteps(ctx, setupRng)
        .find((candidate) => candidate.instance.id === instance.id && candidate.node.id === 'leaders');
      if (!step) throw new Error('muster leaders entry did not become due');

      const event = content.event(step.node.event);
      if (!event || event.interaction.kind === 'narration') {
        throw new Error('muster leaders fixture changed interaction');
      }
      const { young, older } = namedAdults(ctx, seed);
      const result = executeOutcomeWitness(ctx, event, {
        choiceId,
        expectedOutcomeId: outcomeId,
        rng: alwaysLowNormal(seed + 60),
        cast: { OFFICER: older.id, SENT: [young.id] },
        arcStep: step,
        targetPartyChoice: true,
      });

      expect(result.ok, `muster/${choiceId}: ${result.reason}`).toBe(true);
      expect(result.key).toBe(outcomeKey('who_leads_them', choiceId, outcomeId));
      expect(instance.history.at(-1)).toMatchObject({
        node: 'leaders',
        choice: choiceId,
        outcome: outcomeId,
      });
    }
  });

  it('refuses to guess a randomised party branch without explicit targeting', () => {
    const seed = 4000;
    const ctx = fixture(seed);
    const { young, older, woman } = namedAdults(ctx, seed);
    const event = content.event('riding_the_rents');
    if (!event || event.interaction.kind === 'narration') throw new Error('rents fixture changed interaction');

    const result = executeOutcomeWitness(ctx, event, {
      choiceId: 'they_come_back_with_it',
      expectedOutcomeId: 'all_four',
      rng: alwaysLowNormal(seed + 50),
      cast: { RIDER_A: older.id, RIDER_B: young.id, RIDER_C: woman.id },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('randomised party-cast docket witness requires targetPartyChoice');
    expect(ctx.world.decisionLog).toHaveLength(0);
  });

  it('does not invent a party branch when the production check has no matching band', () => {
    const seed = 4001;
    const ctx = fixture(seed);
    const { young, older, woman } = namedAdults(ctx, seed);
    const source = content.event('riding_the_rents');
    if (!source || source.interaction.kind === 'narration') throw new Error('rents fixture changed interaction');
    const event = structuredClone(source);
    const check = event.checks.find((candidate) => candidate.id === 'the_four_doors');
    const band = check?.bands.find((candidate) => candidate.outcome === 'they_come_back_with_it');
    if (!check || !band) throw new Error('rents party check fixture is missing');
    band.outcome = '__missing_party_branch__';

    const result = executeOutcomeWitness(ctx, event, {
      choiceId: 'they_come_back_with_it',
      expectedOutcomeId: 'all_four',
      rng: alwaysLowNormal(seed + 50),
      cast: { RIDER_A: older.id, RIDER_B: young.id, RIDER_C: woman.id },
      targetPartyChoice: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("party check 'the_four_doors' has no band for 'they_come_back_with_it'");
    expect(ctx.world.decisionLog).toHaveLength(0);
  });
});
