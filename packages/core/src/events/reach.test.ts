import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { asId, FREQUENCY_PROFILES, indexContent, isLadderRole, type ActiveAge } from '@ed/schema';
import { makeRng, type Rng } from '../rng.js';
import { marry, place, testWorld } from '../testing.js';
import { resolveSlots, type SlotFill } from './slots.js';
import { declaredOutcomes, executeOutcomeWitness as executeOutcomeWitnessRaw, outcomeKey } from './reach.js';
import { evalCondition } from './conditions.js';
import { dueArcSteps, startArc } from './arcs.js';
import { queueChoice, resolveChoice } from './decisions.js';
import { genomeOf, phenotypeOf } from '../people/factory.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { grantHeirloom } from '../people/heirlooms.js';
import { ambientPool } from './selection.js';
import { grantParcel, heldAcres, seizeParcel } from '../land.js';
import { TEST_FAMILIES } from '../tools/testFamilies.js';

const content = indexContent(loadContent());

const OUTCOME_WITNESS_MANIFEST = join(
  import.meta.dirname,
  '../../../../tools/outcome-witnesses.json',
);
const declaredOutcomeKeys = new Set(declaredOutcomes(content).keys());
const witnessedOutcomeKeys = new Set<string>();

function executeOutcomeWitness(
  ...args: Parameters<typeof executeOutcomeWitnessRaw>
): ReturnType<typeof executeOutcomeWitnessRaw> {
  const result = executeOutcomeWitnessRaw(...args);
  if (result.ok && result.key && declaredOutcomeKeys.has(result.key)) {
    witnessedOutcomeKeys.add(result.key);
  }
  return result;
}

afterAll(() => {
  const outcomes = [...witnessedOutcomeKeys].sort();
  const generated = { version: 1, outcomes };
  if (process.env.UPDATE_OUTCOME_WITNESSES === '1') {
    writeFileSync(
      OUTCOME_WITNESS_MANIFEST,
      `${JSON.stringify(generated, null, 2)}\n`,
      'utf8',
    );
    return;
  }

  const manifest = JSON.parse(
    readFileSync(OUTCOME_WITNESS_MANIFEST, 'utf8'),
  ) as { version?: unknown; outcomes?: unknown };

  if (
    manifest.version !== 1
    || !Array.isArray(manifest.outcomes)
    || manifest.outcomes.some((key) => typeof key !== 'string')
  ) {
    throw new Error(
      'tools/outcome-witnesses.json has an invalid shape; run npm run gen:witnesses',
    );
  }

  const committed = manifest.outcomes as string[];
  const canonicalCommitted = [...new Set(committed)].sort();
  if (
    committed.length !== canonicalCommitted.length
    || committed.some((key, index) => key !== canonicalCommitted[index])
  ) {
    throw new Error(
      'tools/outcome-witnesses.json must contain unique sorted outcome keys; run npm run gen:witnesses',
    );
  }

  if (
    committed.length !== outcomes.length
    || committed.some((key, index) => key !== outcomes[index])
  ) {
    throw new Error([
      'tools/outcome-witnesses.json drifted from deterministic reach.test.ts execution witnesses.',
      'Run npm run gen:witnesses and commit the generated file.',
      'GENERATED_OUTCOME_WITNESSES_START',
      JSON.stringify(generated, null, 2),
      'GENERATED_OUTCOME_WITNESSES_END',
    ].join('\n'));
  }
});

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

describe('authored simple unlock-gated outcome witnesses', () => {
  function unlockOf(condition: NonNullable<(typeof content.events)[number]['conditions']>) {
    if ('unlocked' in condition) return condition.unlocked;
    if (
      'all' in condition
      && condition.all.length === 1
      && condition.all[0]
      && 'unlocked' in condition.all[0]
    ) return condition.all[0].unlocked;
    return undefined;
  }

  function grantingTraits(grant: string) {
    return content.traits.filter((trait) =>
      trait.presence.some((presence) =>
        presence.modifiers.some((modifier) =>
          modifier.kind === 'unlock' && modifier.grants === grant)));
  }

  function unlockFixture(
    seed: number,
    event: (typeof content.events)[number],
    grant: string,
    enabled: boolean,
  ) {
    const ctx = fixture(seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );

    const onlyAge = event.ages?.only;
    if (onlyAge?.length === 1) {
      ctx.world.age.active = [{
        age: onlyAge[0]!,
        began: ctx.world.year,
        named: true,
        paid: { standing: false },
      }];
    }

    const traits = grantingTraits(grant);
    if (traits.length === 0) throw new Error(`no authored trait grants unlock '${grant}'`);

    for (const person of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
      for (const trait of traits) person.traits.delete(trait.id);
    }

    if (enabled) {
      const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'));
      if (!head) throw new Error('unlock witness fixture has no Head');
      const trait = traits[0]!;
      place(ctx, {
        sex: 'male',
        age: 48,
        name: `Witness Unlock Retainer ${grant} ${seed}`,
        traits: [String(trait.id)],
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
      place(ctx, {
        sex: 'female',
        age: 61,
        name: `Witness Matriarch ${grant} ${seed}`,
      });
    }
    return ctx;
  }

  it('grants each simple authored unlock through the real trait modifier before selection and commit', () => {
    const cases = content.events.filter((event) => {
      if (event.tier === 'frame' || event.arc !== undefined || !event.conditions) return false;
      const grant = unlockOf(event.conditions);
      if (!grant) return false;

      if (event.ages !== undefined && event.ages.only?.length !== 1) return false;
      const slots = Object.values(event.slots);
      if (
        slots.length === 0
        || slots.some((slot) => (
          slot.castBy !== 'engine'
          || !['head', 'retainer', 'family_member'].includes(slot.role)
          || slot.filters.some((filter) => (
            Object.keys(filter).some((key) =>
              !['trait', 'has', 'sex', 'age', 'status', 'relation', 'of'].includes(key))
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
      'the_hand_the_warden_accepts',
      'the_registrar_asks_for_the_book',
      'the_rule_of_the_sickroom',
      'the_turn_of_the_stave',
      'what_the_watch_caught',
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
    let seed = 8200;

    for (const event of cases) {
      const grant = unlockOf(event.conditions!);
      if (!grant) throw new Error(`${event.id} lost its simple unlock gate`);

      const before = unlockFixture(seed, event, grant, false);
      expect(
        evalCondition(event.conditions, before),
        `${event.id} should be blocked without unlock '${grant}'`,
      ).toBe(false);

      const selection = unlockFixture(seed, event, grant, true);
      expect(
        evalCondition(event.conditions, selection),
        `${event.id} should pass when a household trait grants '${grant}'`,
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, `${event.id} should resolve its real unlock-dependent slots`).toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, `${event.id} should not require a player cast`).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        `${event.id} should be selectable once its unlock/age/cast state is valid`,
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = unlockFixture(seed, event, grant, true);
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
          const ctx = unlockFixture(seed, event, grant, true);
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


describe('authored cadet-state outcome witnesses', () => {
  type CadetGate = {
    generation?: number;
    grievance?: number;
    flag?: { name: string; passing: boolean; blocked: boolean };
  };

  function gateOf(condition: NonNullable<(typeof content.events)[number]['conditions']>): CadetGate | undefined {
    if (!('all' in condition)) return undefined;

    let hasBranchFloor = false;
    const gate: CadetGate = {};
    for (const leaf of condition.all) {
      if ('cadetBranches' in leaf) {
        if (leaf.cadetBranches.op !== 'gte' || leaf.cadetBranches.value !== 1) return undefined;
        hasBranchFloor = true;
        continue;
      }
      if ('branchGrievance' in leaf) {
        if (leaf.branchGrievance.op !== 'gte') return undefined;
        gate.grievance = leaf.branchGrievance.value;
        continue;
      }
      if ('generation' in leaf) {
        if (leaf.generation.op !== 'gte') return undefined;
        gate.generation = leaf.generation.value;
        continue;
      }
      if ('not' in leaf && 'flag' in leaf.not) {
        const blocked = leaf.not.is !== false;
        gate.flag = { name: leaf.not.flag, passing: !blocked, blocked };
        continue;
      }
      return undefined;
    }
    return hasBranchFloor ? gate : undefined;
  }

  function cadetFixture(
    seed: number,
    event: (typeof content.events)[number],
    gate: CadetGate,
    options: { withBranch?: boolean; grievance?: number; generation?: number; flag?: boolean } = {},
  ) {
    const ctx = fixture(seed);
    ctx.world.generation = options.generation ?? Math.max(
      gate.generation ?? ctx.world.generation,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );
    if (gate.flag) ctx.world.flags.set(gate.flag.name, options.flag ?? gate.flag.passing);

    if (options.withBranch === false) return ctx;

    const branchId = 'witness_cadet_' + seed;
    const cousin = place(ctx, {
      sex: 'male',
      age: 40,
      name: 'Witness Cadet ' + seed,
      branch: branchId,
    });
    const membership = cousin.membership.find((entry) => entry.to === undefined);
    if (!membership) throw new Error('cadet witness has no current house membership');
    membership.kind = 'cadet';
    membership.branch = branchId;

    ctx.world.branches.set(branchId, {
      id: asId(branchId),
      name: cousin.name + "'s line",
      house: asId(ctx.world.playerHouse),
      founder: cousin.id,
      splitFrom: 'main',
      foundedYear: ctx.world.year - 40,
      speaker: cousin.id,
      grievance: options.grievance ?? gate.grievance ?? 0,
    });
    return ctx;
  }

  it('crosses the authored cadet-branch state gates before real cadet casting, selection and commit', () => {
    const cases = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !event.conditions
      ) return [];
      const gate = gateOf(event.conditions);
      if (!gate) return [];

      const slots = Object.values(event.slots);
      if (
        slots.length !== 2
        || !slots.some((slot) => slot.role === 'head')
        || !slots.some((slot) => slot.role === 'cadet')
        || slots.some((slot) => (
          slot.castBy !== 'engine'
          || !['head', 'cadet'].includes(slot.role)
          || slot.filters.some((filter) => (
            Object.keys(filter).some((key) => !['age', 'status'].includes(key))
          ))
        ))
      ) return [];

      if (event.interaction.kind === 'narration' || event.interaction.decidedBy !== 'player') return [];
      if (event.interaction.choices.some((choice) => choice.requires.length || choice.check !== undefined)) return [];
      return [{ event, gate }];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_accounts_of_the_smaller_house',
      'the_cousin_who_woke_four_miles_off',
    ]);

    const declared = cases.flatMap(({ event }) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 8600;

    for (const { event, gate } of cases) {
      const noBranch = cadetFixture(seed, event, gate, { withBranch: false });
      expect(
        evalCondition(event.conditions, noBranch),
        String(event.id) + ' should be blocked with no active cadet branch',
      ).toBe(false);

      if (gate.grievance !== undefined) {
        const lowGrievance = cadetFixture(seed, event, gate, {
          grievance: gate.grievance - 1,
        });
        expect(
          evalCondition(event.conditions, lowGrievance),
          String(event.id) + ' should be blocked below branch grievance ' + gate.grievance,
        ).toBe(false);
      }

      if (gate.generation !== undefined) {
        const early = cadetFixture(seed, event, gate, {
          generation: gate.generation - 1,
        });
        expect(
          evalCondition(event.conditions, early),
          String(event.id) + ' should be blocked before generation >= ' + gate.generation,
        ).toBe(false);
      }

      if (gate.flag) {
        const blockedFlag = cadetFixture(seed, event, gate, { flag: gate.flag.blocked });
        expect(
          evalCondition(event.conditions, blockedFlag),
          String(event.id) + ' should be blocked when ' + gate.flag.name + '=' + gate.flag.blocked,
        ).toBe(false);
      }

      const selection = cadetFixture(seed, event, gate);
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should satisfy its cadet gate',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve the real Head/cadet cast').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, String(event.id) + ' should not require player casting').toHaveLength(0);
      const cousinId = slots.fill.COUSIN;
      expect(typeof cousinId).toBe('string');
      const cousin = typeof cousinId === 'string' ? selection.world.people.get(cousinId) : undefined;
      expect(cousin?.membership.find((entry) => entry.to === undefined)?.kind).toBe('cadet');
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once its cadet state and cast are valid',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = cadetFixture(seed, event, gate);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
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


describe('authored simple ascension-gated outcome witnesses', () => {
  function ascensionFixture(seed: number, event: (typeof content.events)[number], rung: 'none' | 'adept') {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );
    ctx.world.ascension.rung = rung;
    ctx.world.ascension.best = rung;

    const ascendant = event.slots.ASCENDANT;
    for (const filter of ascendant?.filters ?? []) {
      if (!('trait' in filter)) continue;
      for (const person of ctx.world.people.living()) {
        if (!phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress) continue;
        if (filter.has) person.traits.add(asId(filter.trait));
        else person.traits.delete(asId(filter.trait));
      }
    }

    return ctx;
  }

  it('crosses the authored Adept gate, resolves the real foremost cast and executes every ladder outcome', () => {
    const cases = content.events.filter((event) => {
      const condition = event.conditions;
      const slotIds = Object.keys(event.slots);
      const ascendant = event.slots.ASCENDANT;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('ascension' in condition)
        || condition.ascension.atLeast !== 'adept'
        || condition.ascension.best === true
        || slotIds.length !== 1
        || slotIds[0] !== 'ASCENDANT'
        || !ascendant
        || !isLadderRole(ascendant.role)
        || ascendant.castBy !== 'engine'
        || ascendant.filters.some((filter) => !('trait' in filter))
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) return false;
      return true;
    });

    expect(cases.map((event) => String(event.id)).sort()).toEqual([
      'past_what_the_book_says',
      'the_race_silted_through',
      'what_he_wrote_past_it',
      'what_the_province_asks_to_see',
      'wick_asks_for_him_by_name',
    ]);

    const declared = cases.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 7600;

    for (const event of cases) {
      const blocked = ascensionFixture(seed, event, 'none');
      expect(
        evalCondition(event.conditions, blocked),
        String(event.id) + ' should be blocked below Adept',
      ).toBe(false);

      const selection = ascensionFixture(seed, event, 'adept');
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should satisfy ascension >= adept',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored foremost cast').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, String(event.id) + ' should not require a player cast').toHaveLength(0);
      expect(typeof slots.fill.ASCENDANT, String(event.id) + ' should cast one foremost expresser').toBe('string');
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once the ladder gate and trait filter are satisfied',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = ascensionFixture(seed, event, 'adept');
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored post-tenure outcome witnesses', () => {
  function tenureFixture(
    seed: number,
    career: string,
    heldYears: number,
    frequency: (typeof content.events)[number]['frequency'],
  ) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[frequency].minGeneration,
    );
    place(ctx, {
      sex: 'male',
      age: Math.max(30, heldYears + 20),
      name: 'Witness Career Holder ' + seed,
      career: { career, heldYears },
    });
    return ctx;
  }

  it('crosses every authored postHeldFor floor, resolves the real career holder and executes every outcome', () => {
    const cases = content.events.flatMap((event) => {
      const condition = event.conditions;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('postHeldFor' in condition)
        || condition.postHeldFor.op !== 'gte'
        || condition.postHeldFor.years <= 0
      ) return [];

      const slots = Object.entries(event.slots);
      if (
        slots.length !== 1
        || slots[0]![1].role !== 'family_member'
        || slots[0]![1].castBy !== 'engine'
        || !slots[0]![1].filters.some((filter) => (
          'career' in filter && filter.career.includes(condition.postHeldFor.career)
        ))
      ) return [];

      if (event.interaction.kind === 'narration') {
        return [{ event, condition: condition.postHeldFor }];
      }
      if (
        event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) return [];

      return [{ event, condition: condition.postHeldFor }];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_advocates_day',
      'the_berth_becomes_a_share',
      'the_brass_warrant',
      'the_year_without_an_invitation',
    ]);

    const declared = cases.flatMap(({ event }) => {
      if (event.interaction.kind === 'narration') {
        return event.interaction.outcomes.map((outcome) =>
          outcomeKey(String(event.id), undefined, String(outcome.id)));
      }
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 7800;

    for (const { event, condition } of cases) {
      const before = tenureFixture(
        seed,
        condition.career,
        condition.years - 1,
        event.frequency,
      );
      expect(
        evalCondition(event.conditions, before),
        String(event.id) + ' should be blocked before ' + condition.years + ' years in post',
      ).toBe(false);

      const selection = tenureFixture(
        seed,
        condition.career,
        condition.years,
        event.frequency,
      );
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should pass at ' + condition.years + ' years in post',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored career-holder slot').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, String(event.id) + ' should not require a player cast').toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once its tenure gate and cast are valid',
      ).toBe(true);

      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = tenureFixture(seed, condition.career, condition.years, event.frequency);
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });
          expect(result.ok, String(event.id) + '/' + String(outcome.id) + ': ' + result.reason).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
        continue;
      }

      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = tenureFixture(seed, condition.career, condition.years, event.frequency);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored simple held-parcel outcome witnesses', () => {
  function parcelFixture(
    seed: number,
    parcel: string,
    held: boolean,
    frequency: (typeof content.events)[number]['frequency'],
  ) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[frequency].minGeneration,
    );
    seizeParcel(ctx, parcel);
    if (held) grantParcel(ctx, parcel);
    return ctx;
  }

  it('crosses each simple positive holdsParcel gate before executing every Head-only outcome', () => {
    const cases = content.events.flatMap((event) => {
      const condition = event.conditions;
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('holdsParcel' in condition)
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) return [];
      return [{ event, parcel: condition.holdsParcel }];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_common_is_grazed_thin',
      'the_low_ground_floods',
      'what_the_years_wore_down',
    ]);

    const declared = cases.flatMap(({ event }) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 8000;

    for (const { event, parcel } of cases) {
      const before = parcelFixture(seed, parcel, false, event.frequency);
      expect(
        evalCondition(event.conditions, before),
        String(event.id) + ' should be blocked without parcel ' + parcel,
      ).toBe(false);

      const selection = parcelFixture(seed, parcel, true, event.frequency);
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should pass while parcel ' + parcel + ' is held',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored Head slot').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, String(event.id) + ' should not require a player cast').toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once its parcel is held',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = parcelFixture(seed, parcel, true, event.frequency);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored open-discrepancy Head-only outcome witnesses', () => {
  function discrepancyFixture(
    seed: number,
    open: boolean,
    frequency: (typeof content.events)[number]['frequency'],
  ) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES[frequency].minGeneration,
    );
    if (open) {
      ctx.world.discrepancies.set('witness_open_discrepancy', {
        severity: 'major',
        provableBy: ['commons', 'the_church'],
        state: 'open',
      });
    }
    return ctx;
  }

  it('crosses each simple openDiscrepancies floor before executing every Head-only outcome', () => {
    const cases = content.events.filter((event) => {
      const condition = event.conditions;
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) return false;

      const leaf = condition.all[0];
      return Boolean(
        leaf
        && 'openDiscrepancies' in leaf
        && leaf.openDiscrepancies.op === 'gte'
        && leaf.openDiscrepancies.value === 1
      );
    });

    expect(cases.map((event) => String(event.id)).sort()).toEqual([
      'a_second_hand_that_agrees',
      'something_the_church_wants_more',
      'somewhere_quiet_to_be_old',
      'the_cross_reference',
    ]);

    const declared = cases.flatMap((event) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 8200;

    for (const event of cases) {
      const before = discrepancyFixture(seed, false, event.frequency);
      expect(
        evalCondition(event.conditions, before),
        String(event.id) + ' should be blocked with no open discrepancy',
      ).toBe(false);

      const selection = discrepancyFixture(seed, true, event.frequency);
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should pass with one open discrepancy',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored Head slot').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast, String(event.id) + ' should not require a player cast').toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once an open discrepancy exists',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = discrepancyFixture(seed, true, event.frequency);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored compound discrepancy outcome witnesses', () => {
  function archivistDiscrepancyFixture(seed: number, open: boolean) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      6,
      FREQUENCY_PROFILES.uncommon.minGeneration,
    );
    const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'));
    if (!head) throw new Error('compound discrepancy fixture has no Head');

    place(ctx, {
      sex: 'female',
      age: 45,
      name: 'Witness Discrepancy Archivist ' + seed,
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

    if (open) {
      ctx.world.discrepancies.set('witness_archivist_discrepancy', {
        severity: 'minor',
        provableBy: ['the_church'],
        state: 'open',
      });
    }
    return ctx;
  }

  it('crosses the generation plus open-discrepancy gate and executes both archivist outcomes', () => {
    const event = content.event('the_archivist_asks_for_a_word');
    if (!event || event.interaction.kind !== 'narration') {
      throw new Error('archivist discrepancy fixture changed interaction');
    }

    const blocked = archivistDiscrepancyFixture(8300, false);
    expect(evalCondition(event.conditions, blocked)).toBe(false);

    const selection = archivistDiscrepancyFixture(8300, true);
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(8301));
    expect(slots.ok, 'archivist discrepancy event should resolve Head and retainer').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(typeof slots.fill.HEAD).toBe('string');
    expect(typeof slots.fill.ARCHIVIST).toBe('string');
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'archivist discrepancy event should be selectable once both authored gates pass',
    ).toBe(true);

    const witnessed: string[] = [];
    for (const [index, outcome] of event.interaction.outcomes.entries()) {
      const ctx = archivistDiscrepancyFixture(8310 + index, true);
      const result = executeOutcomeWitness(ctx, event, {
        expectedOutcomeId: outcome.id,
        rng: alwaysFirstWeighted(8320 + index),
        targetWeightedOutcome: true,
      });
      expect(result.ok, String(outcome.id) + ': ' + result.reason).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(witnessed.sort()).toEqual(event.interaction.outcomes
      .map((outcome) => outcomeKey(String(event.id), undefined, String(outcome.id)))
      .sort());
  });
});


describe('authored unheard-warning outcome witnesses', () => {
  function unheardFixture(seed: number, count: number) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      10,
      FREQUENCY_PROFILES.rare.minGeneration,
    );
    ctx.world.bearing.unheard = Array.from({ length: count }, (_, index) => ({
      year: ctx.world.year - index,
      event: 'witness_unheard_' + index,
    }));
    return ctx;
  }

  it('crosses the authored unheard-warning floor before executing the Marrow ledger outcome', () => {
    const event = content.event('the_ledger_at_marrow');
    if (!event || event.interaction.kind !== 'narration') {
      throw new Error('unheard-warning fixture changed interaction');
    }

    const before = unheardFixture(8400, 1);
    expect(
      evalCondition(event.conditions, before),
      'Marrow ledger should be blocked below two unheard warnings',
    ).toBe(false);

    const selection = unheardFixture(8400, 2);
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(8401));
    expect(slots.ok, 'Marrow ledger should resolve its authored Head slot').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'Marrow ledger should be selectable once generation and unheard gates pass',
    ).toBe(true);

    const outcome = event.interaction.outcomes[0]!;
    const ctx = unheardFixture(8402, 2);
    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: outcome.id,
      rng: makeRng(8403),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.key).toBe(outcomeKey(String(event.id), undefined, String(outcome.id)));
  });
});


describe('authored simple year-gated outcome witnesses', () => {
  it('crosses each simple authored calendar-year floor before executing its outcome', () => {
    const cases = content.events.flatMap((event) => {
      const condition = event.conditions;
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || event.interaction.kind !== 'narration'
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('year' in leaf) || leaf.year.op !== 'gte') return [];
      return [{ event, year: leaf.year.value }];
    });

    expect(cases.map(({ event }) => String(event.id))).toEqual([
      'the_burning_of_the_nine_libraries',
    ]);

    for (const { event, year } of cases) {
      const before = testWorld(content, 8500, year - 1);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(evalCondition(event.conditions, before)).toBe(false);

      const selection = testWorld(content, 8500, year);
      selection.world.generation = Math.max(
        selection.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      expect(evalCondition(event.conditions, selection)).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(8501));
      expect(slots.ok, String(event.id) + ' should resolve its authored Head slot').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once its calendar-year floor is reached',
      ).toBe(true);

      if (event.interaction.kind !== 'narration') continue;
      const outcome = event.interaction.outcomes[0]!;
      const ctx = testWorld(content, 8502, year);
      ctx.world.generation = Math.max(
        ctx.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      const result = executeOutcomeWitness(ctx, event, {
        expectedOutcomeId: outcome.id,
        rng: makeRng(8503),
      });
      expect(result.ok, result.reason).toBe(true);
      expect(result.key).toBe(outcomeKey(String(event.id), undefined, String(outcome.id)));
    }
  });
});


describe('authored simple positive-knowledge outcome witnesses', () => {
  it('crosses each simple authored knowledge gate before executing every Head-only outcome', () => {
    const cases = content.events.flatMap((event) => {
      const condition = event.conditions;
      const slotIds = Object.keys(event.slots);
      const head = event.slots.HEAD;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('all' in condition)
        || condition.all.length !== 1
        || slotIds.length !== 1
        || slotIds[0] !== 'HEAD'
        || head?.role !== 'head'
        || head.castBy !== 'engine'
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) return [];

      const leaf = condition.all[0];
      if (!leaf || !('knowledge' in leaf) || leaf.has !== true) return [];
      return [{ event, flag: leaf.knowledge }];
    });

    expect(cases.map(({ event }) => String(event.id))).toEqual([
      'what_bramme_calls_a_thin_year',
    ]);

    const witnessed: string[] = [];
    const declared = cases.flatMap(({ event }) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    let seed = 8600;

    for (const { event, flag } of cases) {
      const before = testWorld(content, seed);
      before.world.generation = Math.max(
        before.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      before.world.knowledge.delete(flag);
      expect(evalCondition(event.conditions, before)).toBe(false);

      const selection = testWorld(content, seed);
      selection.world.generation = Math.max(
        selection.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      selection.world.knowledge.add(flag);
      expect(evalCondition(event.conditions, selection)).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored Head slot').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast).toHaveLength(0);
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once its knowledge gate is satisfied',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = testWorld(content, seed);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.knowledge.add(flag);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: alwaysFirstWeighted(seed + 2),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored founding-bottleneck blood-count outcome witnesses', () => {
  type BottleneckKind = 'unwed' | 'spent';

  function bottleneckFixture(seed: number, kind: BottleneckKind, extraBlood = false) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES.common.minGeneration,
    );

    const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'));
    if (!head) throw new Error('bottleneck witness fixture has no Head');

    for (const person of ctx.world.people.blood(ctx.world.playerHouse)) {
      if (person.status === 'alive' && person.id !== head.id) {
        ctx.world.people.kill(person.id, ctx.world.year, 'removed by deterministic bottleneck fixture');
      }
    }

    let heir;
    if (kind === 'unwed') {
      heir = place(ctx, {
        sex: 'female',
        age: 22,
        name: 'Witness Last Unwed Heir ' + seed,
      });
    } else {
      heir = place(ctx, {
        sex: 'male',
        age: 40,
        name: 'Witness Last Spent Heir ' + seed,
      });
      const spouse = place(ctx, {
        sex: 'female',
        age: 55,
        name: 'Witness Married-In Spouse ' + seed,
        house: 'house_ilm',
      });
      spouse.membership = [{
        house: asId(ctx.world.playerHouse),
        kind: 'married_in',
        from: ctx.world.year,
      }];
      marry(ctx, heir, spouse);
    }

    if (extraBlood) {
      place(ctx, {
        sex: 'male',
        age: 19,
        name: 'Witness Extra Blood ' + seed,
      });
    }

    return { ctx, heir };
  }

  it('crosses bloodCount <= 2 and resolves both authored bottleneck slot shapes before committing every outcome', () => {
    const cases = content.events.flatMap<{
      event: (typeof content.events)[number];
      kind: BottleneckKind;
    }>((event) => {
      const condition = event.conditions;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('bloodCount' in condition)
        || condition.bloodCount.op !== 'lte'
        || condition.bloodCount.value !== 2
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
      ) return [];

      if (event.id === 'the_house_has_one_name_left') {
        return [{ event, kind: 'unwed' as const }];
      }
      if (event.id === 'the_marriage_that_cannot_answer') {
        return [{ event, kind: 'spent' as const }];
      }
      return [];
    });

    expect(cases.map(({ event }) => String(event.id)).sort()).toEqual([
      'the_house_has_one_name_left',
      'the_marriage_that_cannot_answer',
    ]);

    const declared = cases.flatMap(({ event }) => {
      if (event.interaction.kind === 'narration') return [];
      return event.interaction.choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    });
    const witnessed: string[] = [];
    let seed = 8700;

    for (const { event, kind } of cases) {
      const blocked = bottleneckFixture(seed, kind, true).ctx;
      expect(
        evalCondition(event.conditions, blocked),
        String(event.id) + ' should be blocked while three living blood remain',
      ).toBe(false);

      const selection = bottleneckFixture(seed, kind, false).ctx;
      expect(
        evalCondition(event.conditions, selection),
        String(event.id) + ' should pass when only two living blood remain',
      ).toBe(true);
      const slots = resolveSlots(event, selection, makeRng(seed + 1));
      expect(slots.ok, String(event.id) + ' should resolve its authored bottleneck cast').toBe(true);
      if (!slots.ok) continue;
      expect(slots.playerCast).toHaveLength(0);
      expect(typeof slots.fill.HEAD).toBe('string');
      expect(typeof slots.fill.SOLE_HEIR).toBe('string');
      if (kind === 'spent') expect(typeof slots.fill.SPOUSE).toBe('string');
      expect(
        ambientPool(selection).some((candidate) => candidate.id === event.id),
        String(event.id) + ' should be selectable once the bottleneck and cast are real',
      ).toBe(true);

      if (event.interaction.kind === 'narration') continue;
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = bottleneckFixture(seed, kind, false).ctx;
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(seed + 2),
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id) + ': ' + result.reason,
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
          seed += 1;
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored negative-knowledge outcome witnesses', () => {
  function forgottenDrowningFixture(seed: number, knowsCost: boolean) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      6,
      FREQUENCY_PROFILES.rare.minGeneration,
    );

    const donor = ctx.world.people.living()
      .find((person) => phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress);
    if (!donor) throw new Error('negative-knowledge fixture has no founding expresser genome');

    const child = place(ctx, {
      sex: 'male',
      age: 12,
      name: 'Witness Forgotten Drowning Child ' + seed,
    });
    child.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    child.phenotype = undefined;

    if (knowsCost) ctx.world.knowledge.add('knows_drowning_cost');
    else ctx.world.knowledge.delete('knows_drowning_cost');
    return ctx;
  }

  it('requires the Drowning cost to be forgotten, then resolves a real unwoken expresser and commits the outcome', () => {
    const cases = content.events.filter((event) => {
      const condition = event.conditions;
      if (
        event.tier === 'frame'
        || event.ages !== undefined
        || event.arc !== undefined
        || !condition
        || !('all' in condition)
      ) return false;

      const negativeKnowledge = condition.all.some((leaf) => (
        'knowledge' in leaf
        && leaf.knowledge === 'knows_drowning_cost'
        && leaf.has === false
      ));
      const generation = condition.all.some((leaf) => (
        'generation' in leaf
        && leaf.generation.op === 'gte'
        && leaf.generation.value === 6
      ));
      return negativeKnowledge && generation;
    });

    expect(cases.map((event) => String(event.id))).toEqual([
      'the_drowning_repeated',
    ]);

    const event = cases[0]!;
    if (event.interaction.kind !== 'narration') {
      throw new Error('forgotten Drowning fixture changed interaction');
    }

    const blocked = forgottenDrowningFixture(8800, true);
    expect(
      evalCondition(event.conditions, blocked),
      'the repeated Drowning should be blocked once the house knows its cost',
    ).toBe(false);

    const selection = forgottenDrowningFixture(8800, false);
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(8801));
    expect(slots.ok, 'repeated Drowning should resolve Head and unwoken expresser').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(typeof slots.fill.HEAD).toBe('string');
    expect(typeof slots.fill.CHILD).toBe('string');
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'repeated Drowning should be selectable while its cost is forgotten',
    ).toBe(true);

    const outcome = event.interaction.outcomes[0]!;
    const ctx = forgottenDrowningFixture(8802, false);
    const result = executeOutcomeWitness(ctx, event, {
      expectedOutcomeId: outcome.id,
      rng: makeRng(8803),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.key).toBe(outcomeKey(String(event.id), undefined, String(outcome.id)));
    expect(ctx.world.knowledge.has('knows_drowning_cost')).toBe(true);
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


describe('authored compound treasury-respect outcome witnesses', () => {
  function courtSeatFixture(seed: number, respect: 'unknown' | 'known') {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES.uncommon.minGeneration,
    );
    ctx.world.treasury = 300;
    ctx.world.respect = respect;
    place(ctx, {
      sex: 'male',
      age: 25,
      name: `Witness Courtier ${seed}`,
    });
    return ctx;
  }

  it('crosses the Seat Near It treasury/respect gate before real casting, selection and every outcome', () => {
    const event = content.event('a_seat_near_it');
    if (!event || event.interaction.kind === 'narration') {
      throw new Error('court-seat fixture changed interaction');
    }

    const blockedTreasury = courtSeatFixture(4300, 'known');
    blockedTreasury.world.treasury = 299;
    expect(
      evalCondition(event.conditions, blockedTreasury),
      'court seat should be blocked below treasury 300',
    ).toBe(false);

    const blockedRespect = courtSeatFixture(4301, 'unknown');
    expect(
      evalCondition(event.conditions, blockedRespect),
      'court seat should be blocked below Respect known',
    ).toBe(false);

    const selection = courtSeatFixture(4302, 'known');
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(4303));
    expect(slots.ok, 'court seat should resolve its real family-member cast').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'court seat should be selectable once both authored gates and cast state are valid',
    ).toBe(true);

    const declared = event.interaction.choices.flatMap((choice) =>
      choice.outcomes.map((outcome) =>
        outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    const witnessed: string[] = [];

    let seed = 4310;
    for (const choice of event.interaction.choices) {
      for (const outcome of choice.outcomes) {
        const ctx = courtSeatFixture(seed, 'known');
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

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored compound acreage outcome witnesses', () => {
  function deedFixture(seed: number, enoughAcreage: boolean) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES.uncommon.minGeneration,
    );
    grantParcel(ctx, 'ashcroft');

    if (!enoughAcreage) {
      for (const parcel of content.parcels) {
        if (String(parcel.id) === 'ashcroft') continue;
        if (heldAcres(ctx) < 600) break;
        seizeParcel(ctx, String(parcel.id));
      }
      if (heldAcres(ctx) >= 600) {
        throw new Error('deed fixture could not reduce held acreage below 600 while retaining Ashcroft');
      }
    }

    return ctx;
  }

  it('crosses the Deed Nobody Can Find parcel/acreage gate before selection and every outcome', () => {
    const event = content.event('the_deed_nobody_can_find');
    if (!event || event.interaction.kind === 'narration') {
      throw new Error('deed fixture changed interaction');
    }

    const missingParcel = deedFixture(4400, true);
    seizeParcel(missingParcel, 'ashcroft');
    expect(
      evalCondition(event.conditions, missingParcel),
      'deed should be blocked without Ashcroft',
    ).toBe(false);

    const tooSmall = deedFixture(4401, false);
    expect(
      evalCondition(event.conditions, tooSmall),
      'deed should be blocked below 600 held acres',
    ).toBe(false);

    const selection = deedFixture(4402, true);
    expect(heldAcres(selection)).toBeGreaterThanOrEqual(600);
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(4403));
    expect(slots.ok, 'deed should resolve its real Head cast').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'deed should be selectable once Ashcroft and the acreage floor are both satisfied',
    ).toBe(true);

    const declared = event.interaction.choices.flatMap((choice) =>
      choice.outcomes.map((outcome) =>
        outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    const witnessed: string[] = [];
    let seed = 4410;

    for (const choice of event.interaction.choices) {
      for (const outcome of choice.outcomes) {
        const ctx = deedFixture(seed, true);
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

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored discontent-and-cadet outcome witnesses', () => {
  function hallFixture(seed: number, discontent: number, withBranch = true) {
    const ctx = fixture(seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES.uncommon.minGeneration,
    );
    ctx.world.discontent = discontent;

    if (!withBranch) return ctx;

    const branchId = 'witness_waiting_hall_' + seed;
    const cousin = place(ctx, {
      sex: 'male',
      age: 40,
      name: 'Witness Waiting Cousin ' + seed,
      branch: branchId,
    });
    const membership = cousin.membership.find((entry) => entry.to === undefined);
    if (!membership) throw new Error('waiting-hall witness has no current house membership');
    membership.kind = 'cadet';
    membership.branch = branchId;

    ctx.world.branches.set(branchId, {
      id: asId(branchId),
      name: cousin.name + "'s line",
      house: asId(ctx.world.playerHouse),
      founder: cousin.id,
      splitFrom: 'main',
      foundedYear: ctx.world.year - 40,
      speaker: cousin.id,
      grievance: 0,
    });
    return ctx;
  }

  it('crosses the Hall That Waited discontent/cadet gate before real casting and every narration outcome', () => {
    const event = content.event('the_hall_that_waited');
    if (!event || event.interaction.kind !== 'narration') {
      throw new Error('waiting-hall fixture changed interaction');
    }

    const noBranch = hallFixture(4500, 40, false);
    expect(
      evalCondition(event.conditions, noBranch),
      'waiting hall should be blocked without an active cadet branch',
    ).toBe(false);

    const lowDiscontent = hallFixture(4501, 39);
    expect(
      evalCondition(event.conditions, lowDiscontent),
      'waiting hall should be blocked below discontent 40',
    ).toBe(false);

    const selection = hallFixture(4502, 40);
    expect(evalCondition(event.conditions, selection)).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(4503));
    expect(slots.ok, 'waiting hall should resolve the real Head/cadet cast').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    const cousinId = slots.fill.COUSIN;
    expect(typeof cousinId).toBe('string');
    const cousin = typeof cousinId === 'string' ? selection.world.people.get(cousinId) : undefined;
    expect(cousin?.membership.find((entry) => entry.to === undefined)?.kind).toBe('cadet');
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'waiting hall should be selectable once discontent and cadet state are valid',
    ).toBe(true);

    const declared = event.interaction.outcomes.map((outcome) =>
      outcomeKey(String(event.id), undefined, String(outcome.id)));
    const witnessed: string[] = [];

    for (const [index, outcome] of event.interaction.outcomes.entries()) {
      const seed = 4510 + index;
      const ctx = hallFixture(seed, 40);
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
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored derived arc-window outcome witnesses', () => {
  function cradlemoorFixture(seed: number) {
    const ctx = fixture(seed);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      FREQUENCY_PROFILES.uncommon.minGeneration,
    );
    seizeParcel(ctx, 'cradlemoor');
    return ctx;
  }

  it('refuses the Cradlemoor start when its arc cannot finish, then executes both start-scene outcomes while time remains', () => {
    const event = content.event('cradlemoor_wants_draining');
    if (!event || event.interaction.kind === 'narration') {
      throw new Error('Cradlemoor start fixture changed interaction');
    }

    const tooLate = cradlemoorFixture(4600);
    tooLate.world.year = 9999;
    expect(
      evalCondition(event.conditions, tooLate),
      'Cradlemoor start should be blocked when no campaign time remains for its arc',
    ).toBe(false);

    const selection = cradlemoorFixture(4601);
    expect(
      evalCondition(event.conditions, selection),
      'Cradlemoor start should pass while its derived arc window is still open',
    ).toBe(true);
    const slots = resolveSlots(event, selection, makeRng(4602));
    expect(slots.ok, 'Cradlemoor start should resolve its real Head cast').toBe(true);
    if (!slots.ok) return;
    expect(slots.playerCast).toHaveLength(0);
    expect(
      ambientPool(selection).some((candidate) => candidate.id === event.id),
      'Cradlemoor start should be selectable while the parcel is unheld and the arc can finish',
    ).toBe(true);

    const declared = event.interaction.choices.flatMap((choice) =>
      choice.outcomes.map((outcome) =>
        outcomeKey(String(event.id), String(choice.id), String(outcome.id))));
    const witnessed: string[] = [];

    for (const [index, choice] of event.interaction.choices.entries()) {
      for (const outcome of choice.outcomes) {
        const seed = 4610 + index;
        const ctx = cradlemoorFixture(seed);
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
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

describe('authored TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  it('executes ordinary fillable player-choice outcomes through the first shared family that can really offer them', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.record !== undefined
        || event.ages !== undefined
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
      ) return [];

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        if (!evalCondition(event.conditions, ctx)) return false;

        const slots = resolveSlots(event, ctx, makeRng(9001));
        if (!slots.ok || slots.playerCast.length) return false;

        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });

      return family ? [{ event, choices, family }] : [];
    });

    expect(candidates.length).toBeGreaterThan(0);

    const declared = candidates.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];
    for (const { event, choices, family } of candidates) {
      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = family.build(content);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );

          expect(
            evalCondition(event.conditions, ctx),
            String(event.id) + ' should satisfy its authored conditions in ' + family.id,
          ).toBe(true);
          const slots = resolveSlots(event, ctx, makeRng(9001));
          expect(
            slots.ok,
            String(event.id) + ' should resolve its authored slots in ' + family.id,
          ).toBe(true);
          if (!slots.ok) continue;
          expect(
            slots.playerCast,
            String(event.id) + ' should not require player casting in ' + family.id,
          ).toHaveLength(0);
          expect(
            ambientPool(ctx).some((offered) => offered.id === event.id),
            String(event.id) + ' should be offered by the real ambient selector in ' + family.id,
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(9001),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id)
              + ' via ' + family.id + ': ' + (result.reason ?? 'no reason'),
          ).toBe(true);
          expect(result.key).toBe(
            outcomeKey(String(event.id), String(choice.id), String(outcome.id)),
          );
          if (result.key) witnessed.push(result.key);
        }
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});

