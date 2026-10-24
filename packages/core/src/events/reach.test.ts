import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { previewPrimordial, rollPrimordial } from './primordial.js';
import { asId, THRESHOLD_AFFINITIES, FREQUENCY_PROFILES, indexContent, isLadderRole, type ActiveAge } from '@ed/schema';
import { makeRng, streamFor, type Rng } from '../rng.js';
import { canonical, loadGame, saveGame } from '../save.js';
import { marry, phase, place, testWorld } from '../testing.js';
import { resolveSlots, renderBody, type SlotFill } from './slots.js';
import { declaredOutcomes, executeFrameOutcomeWitness as executeFrameOutcomeWitnessRaw, executeOutcomeWitness as executeOutcomeWitnessRaw, outcomeKey } from './reach.js';
import { evalCondition } from './conditions.js';
import { dueArcSteps, startArc } from './arcs.js';
import { maintainCast } from '../people/succession.js';
import { queueChoice, queueRecord, resolveChoice, resolveRecord } from './decisions.js';
import {
  EXPRESSER_WAKING_LIFT, genomeOf, LATE_WAKING_AGE, phenotypeOf, rollAwakening,
} from '../people/factory.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { grantHeirloom } from '../people/heirlooms.js';
import { ambientPool, selectEvents } from './selection.js';
import { grantParcel, heldAcres, landIncome, seizeParcel } from '../land.js';
import { TEST_FAMILIES } from '../tools/testFamilies.js';
import { campaignDef } from '../campaign.js';
import { missingPlainEnglish, proseForEventBody, setProseMode, setProseVariants } from '../prose.js';
import { sentimentBetween } from '../people/relationships.js';
import { bootstrap } from '../sim.js';
import { viewOf } from '../session.js';
import { gainSpellbook } from '../people/library.js';
import { attr } from '../people/factory.js';

const content = indexContent(loadContent());

describe('family challenge execution witnesses (#1796)', () => {
  const events = content.events.filter((e) => e.tags.includes('family_challenge'));
  for (const event of events) {
    if (event.interaction.kind === 'narration') continue;
    const decider = event.interaction.decidedBy;
    for (const choice of event.interaction.choices) {
      for (const outcome of choice.outcomes) {
        it(`${event.id}/${choice.id}/${outcome.id} resolves through its real check`, () => {
          const ctx = testWorld(content);
          ctx.world.generation = Math.max(ctx.world.generation, FREQUENCY_PROFILES[event.frequency].minGeneration);
          const success = outcome.id === 'held' || outcome.id === 'clear';
          for (const p of ctx.world.people.all()) p.spellsKnown = [];
          const reader = place(ctx, { sex: 'female', age: 30, awakened: true, name: 'Amice Witness' });
          const man = place(ctx, { sex: 'male', age: 30, awakened: true, name: 'Gyles Witness' });
          const checkId = choice.check ?? (typeof decider === 'object' && 'party' in decider ? decider.party.check : '');
          const check = event.checks.find((c) => c.id === checkId)!;
          const set = (p: typeof reader, key: string, value: number) => {
            p.acquired[key] = (p.acquired[key] ?? 0) + value - attr(p, key, ctx.genetics, ctx.world.year);
            if (p.phenotype) p.phenotype.dirty = true;
          };
          const pool = check?.pool;
          if (pool?.kind === 'family_knows' && success) {
            const p = THRESHOLD_AFFINITIES.some((a) => a === pool.affinity) ? reader : man;
            expect(gainSpellbook(ctx, p, content.spellbook(`lesser_workings_of_${pool.affinity}`)!)).toBe(true);
          } else if (pool?.kind === 'slot') {
            const spec = event.slots[pool.slot]!;
            const known = spec.filters.find((f) => 'knows' in f);
            if (known && 'knows' in known) {
              const p = THRESHOLD_AFFINITIES.some((a) => a === known.knows.affinity) ? reader : man;
              expect(gainSpellbook(ctx, p, content.spellbook(`lesser_workings_of_${known.knows.affinity}`)!)).toBe(true);
            }
            for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
              for (const a of pool.attrs) set(p, a.attr, success ? 100 : 0);
            }
          } else if (pool?.kind === 'family_sum' || pool?.kind === 'family_max' || pool?.kind === 'family_any') {
            if (pool.kind === 'family_sum' && success) {
              for (let i = 0; i < 10; i++) place(ctx, { sex: i % 2 ? 'female' : 'male', age: 30, name: `Family Helper ${i}` });
            }
            for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) set(p, pool.attr, success ? 100 : 0);
          }
          // Eligibility for the bridge is household preparedness, not the
          // chosen participant's skill. Keep it true even for the weak sender.
          if (event.id === 'the_wick_bridge_load') set(man, 'strength', 60);
          const before = ctx.world.treasury;
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id, expectedOutcomeId: outcome.id, rng: makeRng(1796),
            ...(event.id === 'the_wick_bridge_load' ? { cast: { SENT: reader.id } } : {}),
          });
          expect(result.ok, result.reason).toBe(true);
          const cost = outcome.effects.reduce((sum, e) => sum + (e.kind === 'treasury' ? e.delta : 0), 0);
          expect(ctx.world.treasury - before).toBe(cost);
          if (choice.id === 'prepare_next_time') {
            const preparations: Record<string, { book: string; years: number[] }> = {
              the_cawdry_copy: { book: 'lesser_workings_of_darkness', years: [3, 12] },
              the_fever_and_the_vigil: { book: 'lesser_workings_of_death', years: [4] },
              the_wind_under_the_slates: { book: 'lesser_workings_of_terra', years: [4] },
            };
            const preparation = preparations[event.id]!;
            expect(preparation).toBeDefined();
            expect(ctx.world.library.has(preparation.book)).toBe(true);
            expect(ctx.world.studies.some((s) => s.book === preparation.book)).toBe(true);
            expect(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).some((p) => p.spellsKnown.includes(asId(preparation.book)))).toBe(false);
            expect(ctx.world.scheduled.filter((s) => s.event === event.id).map((s) => s.year).sort((a, b) => a - b))
              .toEqual(preparation.years.map((years) => ctx.world.year + years));
          }
          expect(result.key).toBe(outcomeKey(event.id, choice.id, outcome.id));
        });
      }
    }
  }
});

const OUTCOME_WITNESS_MANIFEST = join(
  import.meta.dirname,
  '../../../../tools/outcome-witnesses.json',
);
const declaredOutcomeKeys = new Set(declaredOutcomes(content).keys());
const witnessedOutcomeKeys = new Set<string>();

function executeOutcomeWitness(
  ...args: Parameters<typeof executeOutcomeWitnessRaw>
): ReturnType<typeof executeOutcomeWitnessRaw> {
  const [ctx, event, request] = args;
  const group = event.interaction.kind === 'narration' ? event.interaction.outcomes
    : event.interaction.choices.find(choice => choice.id === request.choiceId)?.outcomes ?? [];
  const normal = group.find(outcome => outcome.id === request.expectedOutcomeId);
  if (!request.expectedFinalOutcomeId && normal?.primordial
    && (normal.site ?? event.site)?.kind === 'hall'
    && ((normal.site ?? event.site) as { hall?: unknown }).hall === 'main') {
    // These are normal-result witnesses. Choose an actual failed emergency
    // stream, preserving the cast and outcome RNG, rather than disabling the
    // feature or crediting a rescued result as its ordinary catastrophe.
    const reading = previewPrimordial(ctx, event, normal, request.cast ?? {});
    if (reading.candidates.length) {
      const occurrence = `chr_${(ctx.world.counters.chronicle + 1).toString(36)}`;
      const initialSeed = ctx.world.seed;
      let found = false;
      for (let offset = 0; offset < 100_000; offset++) {
        const seed = initialSeed + offset;
        if (!rollPrimordial(reading.candidates, streamFor({ seed, year: ctx.world.year }, `primordial:${occurrence}`))) {
          ctx.world.seed = seed;
          found = true; break;
        }
      }
      if (!found) throw new Error(`no normal intervention miss for ${event.id}/${normal.id}`);
    }
  }
  const result = executeOutcomeWitnessRaw(...args);
  if (result.ok && result.key && declaredOutcomeKeys.has(result.key)) {
    witnessedOutcomeKeys.add(result.key);
  }
  return result;
}

function executeFrameOutcomeWitness(
  ...args: Parameters<typeof executeFrameOutcomeWitnessRaw>
): ReturnType<typeof executeFrameOutcomeWitnessRaw> {
  const result = executeFrameOutcomeWitnessRaw(...args);
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

describe('a rivalry ends without a death and the next one remembers it (#1812)', () => {
  const root = content.event('the_second_signature');
  const callback = content.event('the_name_under_the_second_signature');
  if (!root || root.interaction.kind !== 'choice' || !callback || callback.interaction.kind !== 'narration') {
    throw new Error('the authored rival settlement must have a choice and a narrated callback');
  }

  const prepared = (seed: number) => {
    const ctx = fixture(seed);
    // A rival archetype is uncommon; refill is ineligible at generation zero.
    ctx.world.generation = 1;
    for (const person of ctx.world.people.all()) {
      person.castSlots = person.castSlots.filter((slot) => slot !== 'rival');
    }
    const old = place(ctx, { sex: 'male', age: 31, house: 'house_marrow', name: 'A Rival Before Peace', castSlots: ['rival'] });
    return { ctx, old };
  };

  for (const choice of root.interaction.choices) {
    it(`witnesses ${choice.id} through the actual choice/outcome commit`, () => {
      const { ctx, old } = prepared(1812);
      const outcome = choice.outcomes[0]!;
      const result = executeOutcomeWitness(ctx, root, {
        choiceId: choice.id, expectedOutcomeId: outcome.id, rng: makeRng(1812),
      });
      expect(result.ok, result.reason).toBe(true);
      expect(result.key).toBe(`the_second_signature|${choice.id}|${outcome.id}`);
      expect(old.status).toBe('alive');
      expect(old.castSlots.includes('rival')).toBe(choice.id !== 'put_the_seal_to_it');
    });
  }

  it('witnesses the due follow-up with old and newly minted rivals in the same cast', () => {
    const { ctx, old } = prepared(1813);
    const first = executeOutcomeWitness(ctx, root, {
      choiceId: 'put_the_seal_to_it', expectedOutcomeId: 'the_seals_agreed', rng: makeRng(1813),
    });
    expect(first.ok, first.reason).toBe(true);
    const arc = [...ctx.world.arcs.values()].find((instance) =>
      instance.arc === 'inline_the_second_signature__the_seals_agreed');
    expect(arc, 'the settlement did not docket its inline follow-up').toBeDefined();
    expect(arc!.bindings.RIVAL).toBe(old.id);

    // Avoid consuming the uncommon tier by forcing an earlier retainer hire.
    const newRng = { ...makeRng(1813), bool: (chance: number) => chance === 0.5 };
    const newRival = maintainCast(ctx, newRng).find((person) => person.castSlots.includes('rival'));
    expect(newRival, 'no replacement for the dismissed rival').toBeDefined();
    arc!.dueYear = ctx.world.year;
    const due = dueArcSteps(ctx, makeRng(1814))
      .find((step) => step.node.event === callback.id);
    expect(due, 'the new rival could not meet the former rival on the callback').toBeDefined();
    expect(due!.fill.RIVAL).toBe(old.id);
    expect(due!.fill.NEW_RIVAL).toBe(newRival!.id);
    const words = renderBody(callback.body, due!.fill, ctx);
    expect(words).toContain(old.name);
    expect(words).toContain(newRival!.name);

    const result = executeOutcomeWitness(ctx, callback, {
      expectedOutcomeId: 'another_claim', rng: makeRng(1815), arcStep: due!,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.key).toBe('the_name_under_the_second_signature||another_claim');
    expect(arc!.status).toBe('ended');
    expect(old.status).toBe('alive');
  });
});

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

      // The requirement's own reason, naming the attribute as the docket does.
      if (!result.ok && /Mind is/.test(result.reason ?? '')) {
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
      'the_carpenter_is_getting_old',
      'the_inquest_that_sits_for_nine_days',
      'the_muster_is_called',
      'the_wayfolk_have_it_first',
      'the_west_wing_roof',
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
      'the_answer_was_a_refusal',
      'the_codex_in_the_eastern_invoice',
      'the_quire_beside_the_descent',
      'the_business_without_the_seal',
      'the_old_list_reaches_the_cellar',
      'the_ward_answers_cawdry',
      'the_case_book_is_cited',
      'the_daybook_has_a_witness',
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


describe('forcing rites cast either kind of boy and commit every guarded outcome (#1817)', () => {
  const ids = ['the_drowning', 'the_drowning_repeated', 'the_seven_lamp_vigil', 'the_dark_year_fast'];

  function childOfEitherKind(expresses: boolean) {
    const ctx = testWorld(content, 5180);
    ctx.world.generation = 6;
    ctx.world.knowledge.delete('knows_drowning_cost');
    let donor = ctx.world.people.living().find((person) =>
      phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress === expresses);
    for (let i = 0; !donor && i < 100; i++) {
      const person = place(ctx, { sex: 'male', age: 40, name: `Rite donor ${i}` });
      if (phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress === expresses) donor = person;
    }
    if (!donor) throw new Error('no donor for rite witness');
    // The engine must find this boy, rather than a test bypassing its caster.
    for (const person of ctx.world.people.living()) person.born = ctx.world.year - 40;
    const child = place(ctx, { sex: 'male', age: 12, name: 'Forcing Witness' });
    child.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    child.phenotype = undefined;
    return { ctx, child };
  }

  it.each(ids)('%s admits both capacities, keeps the attempt and witnesses every result', (id) => {
    const event = content.events.find((item) => item.id === id)!;
    expect(event.forcing?.slot).toBe('CHILD');
    expect(event.slots.CHILD?.filters).toContainEqual({ forcingTried: false });
    expect(event.slots.CHILD?.filters?.some((filter) => 'canExpress' in filter)).toBe(false);
    const groups = event.interaction.kind === 'narration'
      ? [{ id: undefined, outcomes: event.interaction.outcomes }]
      : event.interaction.choices;
    for (const choice of groups) for (const outcome of choice.outcomes) {
      const capacity = outcome.onlyIf?.filters.find((filter) => 'canExpress' in filter);
      const kinds = capacity && 'canExpress' in capacity ? [capacity.canExpress] : [true, false];
      for (const expresses of kinds) {
        const { ctx, child } = childOfEitherKind(expresses);
        const slots = resolveSlots(event, ctx, makeRng(5181));
        expect(slots.ok).toBe(true);
        if (!slots.ok) throw new Error('rite did not cast');
        expect(slots.fill.CHILD).toBe(child.id);
        expect(ambientPool(ctx).some((candidate) => candidate.id === id)).toBe(true);
        const result = executeOutcomeWitness(ctx, event, {
          choiceId: choice.id, expectedOutcomeId: outcome.id,
          rng: makeRng(5181), targetWeightedOutcome: true,
        });
        expect(result.ok, `${id}/${choice.id}/${outcome.id}: ${result.reason}`).toBe(true);
        expect(child.awakening.forcingTried).toBe(true);
        if (!expresses) {
          expect(child.awakening.awakened).toBe(false);
          expect(child.madness).toBe(0);
        }
        if (outcome.id === 'woke') expect(child.awakening.awakened).toBe(true);
        if (outcome.id === 'died') expect(child.status).toBe('dead');
        if (expresses && outcome.id === 'nothing') {
          expect(child.awakening.awakened).toBe(false);
          expect(child.madness).toBeGreaterThan(0);
          const visible = viewOf(ctx).halls.flatMap((hall) => hall.members).find((person) => person.id === child.id)!;
          expect(visible.madness).toBe(child.madness);
          expect(visible).not.toHaveProperty('expresses');
        }
        const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
        expect(resumed.world.people.get(child.id)!.awakening.forcingTried).toBe(true);
        for (const rite of content.events.filter((candidate) => ids.includes(candidate.id))) {
          expect(resolveSlots(rite, resumed, makeRng(5182)).ok).toBe(false);
        }
      }
    }
  });
});

describe('the Late Waking (§11, #1797)', () => {
  const event = content.events.find((item) => String(item.id) === 'the_late_waking');

  /** A grown man of the line, past thirty, who carries the Power and never woke. */
  function waitingMan(seed: number, age = 34) {
    const ctx = testWorld(content, seed);
    ctx.world.generation = Math.max(ctx.world.generation, FREQUENCY_PROFILES.rare.minGeneration);
    const donor = ctx.world.people.living()
      .find((person) => phenotypeOf(person, ctx.genetics, ctx.world.year).eldritch.canExpress);
    if (!donor) throw new Error('Late Waking witness needs a founding expressing genome');
    // Build the state the test means: he is the only man of the line still
    // waiting. The founding cast can include another, and the slot would be
    // within its rights to take him instead.
    for (const other of ctx.world.people.living()) {
      if (!other.awakening.awakened) other.awakening = { ...other.awakening, awakened: true, year: ctx.world.year };
    }
    const man = place(ctx, { sex: 'male', age, name: 'Late Waking Witness' });
    man.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
    man.phenotype = undefined;
    expect(phenotypeOf(man, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(true);
    expect(man.awakening.awakened).toBe(false);
    return { ctx, man };
  }

  it('is authored as a rare, recorded, natural waking of an unwoken man past the forcing windows', () => {
    expect(event, 'the_late_waking must be authored').toBeDefined();
    if (!event || event.interaction.kind === 'narration') throw new Error('the Late Waking must ask the player');
    expect(event.frequency).toBe('rare');
    expect(event.record).toBeDefined();
    expect(event.accounts.length).toBeGreaterThanOrEqual(2);
    expect(event.slots.MAN?.role).toBe('unwoken');
    expect(event.slots.MAN?.filters).toEqual(expect.arrayContaining([
      { sex: 'male' }, { canExpress: true }, { declaredMundane: false }, { age: { op: 'gte', value: LATE_WAKING_AGE } },
    ]));
    for (const choice of event.interaction.choices) {
      for (const outcome of choice.outcomes) {
        expect(outcome.effects, `${choice.id}/${outcome.id} must wake him naturally`)
          .toContainEqual({ kind: 'awakening', target: { slot: 'MAN' }, forced: false });
      }
    }
  });

  it('witnesses every authored outcome, each a natural waking', () => {
    if (!event || event.interaction.kind === 'narration') throw new Error('the Late Waking must ask the player');
    const declared = event.interaction.choices.flatMap((choice) =>
      choice.outcomes.map((outcome) => outcomeKey('the_late_waking', String(choice.id), String(outcome.id))));
    const witnessed: string[] = [];
    for (const choice of event.interaction.choices) {
      for (const outcome of choice.outcomes) {
        const { ctx, man } = waitingMan(1797);
        const slots = resolveSlots(event, ctx, makeRng(1798));
        expect(slots.ok, 'the Late Waking should cast the waiting man').toBe(true);
        if (!slots.ok) continue;
        expect(slots.fill.MAN).toBe(man.id);
        expect(ambientPool(ctx).some((candidate) => String(candidate.id) === 'the_late_waking')).toBe(true);
        const madnessBefore = man.madness;

        const result = executeOutcomeWitness(ctx, event, {
          choiceId: String(choice.id),
          expectedOutcomeId: String(outcome.id),
          rng: makeRng(1798),
          targetWeightedOutcome: choice.outcomes.length > 1,
        });
        expect(result.ok, `the_late_waking/${choice.id}/${outcome.id}: ${result.reason ?? 'no reason'}`).toBe(true);
        if (result.key) witnessed.push(result.key);

        expect(man.awakening).toMatchObject({ awakened: true, forced: false, age: 34 });
        if (String(outcome.id) === 'all_at_once') expect(man.madness).toBeGreaterThanOrEqual(madnessBefore + 12);
      }
    }
    expect(witnessed.sort()).toEqual(declared.sort());
  });

  it('never casts a man the house has declared mundane', () => {
    if (!event) throw new Error('the Late Waking must be authored');
    const { ctx, man } = waitingMan(1799);
    man.awakening = { ...man.awakening, declaredMundane: true };
    const slots = resolveSlots(event, ctx, makeRng(1800));
    expect(slots.ok && slots.fill.MAN === man.id).toBe(false);
  });

  it('stops the silent yearly roll from waking an expressing man at thirty, and leaves everyone else on the clock', () => {
    // A die that always comes up, counted, so the test also proves the draw is
    // still made: skipping it would move every later roll in the phase.
    let draws = 0;
    const always = { bool: () => { draws += 1; return true; } } as unknown as Rng;

    const { ctx, man } = waitingMan(1801, LATE_WAKING_AGE);
    expect(rollAwakening(man, ctx.world.year, ctx.genetics, always)).toBe(false);
    expect(man.awakening.awakened).toBe(false);
    expect(draws).toBe(1);

    const younger = waitingMan(1802, LATE_WAKING_AGE - 1);
    expect(rollAwakening(younger.man, younger.ctx.world.year, younger.ctx.genetics, always)).toBe(true);
    expect(younger.man.awakening.forced).toBe(false);

    const woman = place(ctx, { sex: 'female', age: 45, name: 'A Late Daughter' });
    woman.genome = { kind: 'materialized', genome: genomeOf(man, ctx.genetics) };
    woman.phenotype = undefined;
    expect(phenotypeOf(woman, ctx.genetics, ctx.world.year).eldritch.carriedFont).toBeGreaterThan(0);
    expect(rollAwakening(woman, ctx.world.year, ctx.genetics, always)).toBe(true);
    expect(draws).toBe(3);
  });

  it('lifts the yearly chance for a man who can express, and only for him, without adding a draw (#1801)', () => {
    // A die that never comes up and records what it was asked, so both people
    // stay unwoken and the same age can be asked twice.
    const asked: number[] = [];
    const never = { bool: (p: number) => { asked.push(p); return false; } } as unknown as Rng;

    const { ctx, man } = waitingMan(1803, 16);
    const woman = place(ctx, { sex: 'female', age: 16, name: 'A Daughter of the Same Blood' });
    woman.genome = { kind: 'materialized', genome: genomeOf(man, ctx.genetics) };
    woman.phenotype = undefined;
    const fontOf = (p: typeof man) => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.carriedFont;
    expect(fontOf(woman), 'the comparison needs one font in both').toBe(fontOf(man));

    expect(rollAwakening(man, ctx.world.year, ctx.genetics, never)).toBe(false);
    expect(rollAwakening(woman, ctx.world.year, ctx.genetics, never)).toBe(false);
    expect(asked).toHaveLength(2);
    expect(asked[0]! / asked[1]!).toBeCloseTo(EXPRESSER_WAKING_LIFT, 9);
    expect(EXPRESSER_WAKING_LIFT).toBeGreaterThan(1);
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
      targetWeightedOutcome: true,
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

function withoutCadets(seed: number) {
  const ctx = fixture(seed);
  ctx.world.branches.clear();
  for (const person of ctx.world.people.all()) {
    const membership = person.membership.find((entry) => entry.to === undefined);
    if (membership?.kind === 'cadet') {
      membership.kind = 'blood';
      membership.branch = 'main';
    }
  }
  return ctx;
}

function pricedCadetFixture(seed: number) {
  const ctx = withoutCadets(seed);
  place(ctx, { sex: 'female', age: 72, name: 'Elder of the Main Hall' });
  const cousin = place(ctx, { sex: 'male', age: 40, name: 'Cadet Recipient', branch: 'priced_hall' });
  const membership = cousin.membership.find((entry) => entry.to === undefined)!;
  membership.kind = 'cadet';
  membership.branch = 'priced_hall';
  ctx.world.branches.set('priced_hall', {
    id: asId('priced_hall'), name: 'The Priced Hall', house: asId(ctx.world.playerHouse),
    founder: cousin.id, splitFrom: 'main', foundedYear: ctx.world.year - 30,
    speaker: cousin.id, grievance: 20,
  });
  return { ctx, cousin };
}

describe('cadet obligations and named prices in the final worklist (#1810)', () => {
  const cadetOffers = [
    { event: 'the_dovecote_and_the_seed', choice: 'send_half_to_the_cadet', outcome: 'birds_sent', grievance: 18 },
    { event: 'the_old_man_at_the_board', choice: 'find_another_board', outcome: 'another_board', grievance: 16 },
  ];

  for (const offer of cadetOffers) {
    it(`${offer.event} keeps its old choices playable without a cadet hall`, () => {
      const ctx = withoutCadets(181040);
      place(ctx, { sex: 'female', age: 72, name: 'Elder of the Main Hall' });
      const event = content.mustEvent(offer.event);
      const cast = resolveSlots(event, ctx, makeRng(181041));
      expect(cast.ok).toBe(true);
      if (!cast.ok) throw new Error('the optional cadet narrowed the parent event');
      const pending = queueChoice(ctx, event, event.body, cast.fill, cast.playerCast);
      expect(pending.choices.find((choice) => choice.id === offer.choice)?.available).toBe(false);
      expect(pending.choices.filter((choice) => choice.id !== offer.choice).every((choice) => choice.available)).toBe(true);
    });

    it(`${offer.event} names the burdened hall and feeds the actual later accounts reader`, () => {
      const { ctx, cousin } = pricedCadetFixture(181042);
      const reader = content.mustEvent('the_accounts_of_the_smaller_house');
      expect(evalCondition(reader.conditions, ctx)).toBe(false);
      const result = executeOutcomeWitness(ctx, content.mustEvent(offer.event), {
        choiceId: offer.choice, expectedOutcomeId: offer.outcome, rng: makeRng(181043),
      });
      expect(result.ok, result.reason).toBe(true);
      expect(ctx.world.branches.get('priced_hall')?.grievance).toBe(20 + offer.grievance);
      expect(ctx.world.chronicle.some((page) => page.text?.includes(cousin.epithet ?? cousin.name))).toBe(true);
      const loaded = loadGame(saveGame(ctx), content);
      expect(evalCondition(reader.conditions, loaded)).toBe(true);
      if (reader.interaction.kind === 'narration') throw new Error('the accounts reader lost its decision');
      const read = executeOutcomeWitnessRaw(loaded, reader, {
        choiceId: 'praise_and_nothing', expectedOutcomeId: 'warmly', rng: makeRng(181044),
      });
      expect(read.ok, read.reason).toBe(true);
    });
  }

  it.each([
    { outcome: 'it_took', damage: 1 }, { outcome: 'it_rotted', damage: 3 },
  ])('wet sowing $outcome damages the saved home holding by its actual price', ({ outcome, damage }) => {
    const ctx = fixture(181045);
    const home = [...ctx.world.parcels.values()].find((parcel) => parcel.defId === 'the_home_demesne')!;
    const before = home.yieldBonus ?? 0;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent('a_wet_seedmonth'), {
      choiceId: 'sow_now', expectedOutcomeId: outcome, targetWeightedOutcome: true, rng: makeRng(181046),
    });
    expect(result.ok, result.reason).toBe(true);
    const loaded = loadGame(saveGame(ctx), content);
    const saved = [...loaded.world.parcels.values()].find((parcel) => parcel.defId === 'the_home_demesne')!;
    expect(saved.yieldBonus).toBe(before - damage);
  });

  it.each(['levy_it', 'refuse_in_writing'])('the old licence certificate is proved when the successor chooses %s', (choiceId) => {
    const ctx = fixture(181047);
    const signed = executeOutcomeWitnessRaw(ctx, content.mustEvent('the_alewife_and_the_licence'), {
      choiceId: 'assert_the_franchise', expectedOutcomeId: 'asserted', rng: makeRng(181048),
    });
    expect(signed.ok, signed.reason).toBe(true);
    const loaded = loadGame(saveGame(ctx), content);
    loaded.world.respect = 'eminent';
    const instance = [...loaded.world.arcs.values()].find((arc) => content.arc(arc.arc)?.nodes.some((node) => node.event === 'the_file_a_clerk_went_looking_for'))!;
    expect(instance.dueYear! - loaded.world.year).toBeGreaterThanOrEqual(70);
    expect(instance.dueYear! - loaded.world.year).toBeLessThanOrEqual(95);
    const oldHead = loaded.world.people.living().find((person) => person.castSlots.includes('head'))!;
    loaded.world.people.kill(oldHead.id, loaded.world.year, 'test successor reads the certificate');
    const successor = place(loaded, { sex: 'female', age: 32, name: 'Successor to the Certificate' });
    successor.castSlots = ['head'];
    loaded.world.year = instance.dueYear!;
    const step = dueArcSteps(loaded, makeRng(181049)).find((candidate) => candidate.instance.id === instance.id)!;
    expect(step.fill.HEAD).toBe(successor.id);
    const result = executeOutcomeWitnessRaw(loaded, content.mustEvent('the_file_a_clerk_went_looking_for'), {
      choiceId, expectedOutcomeId: choiceId === 'levy_it' ? 'levied' : 'refused', rng: makeRng(181050), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(loaded.world.discrepancies.get('the_alewife_franchise_backdated')?.state).toBe('proven');
    expect(loaded.world.respect).toBe('regarded');
  });

  it('lets the hall serve the guests its own rye and leaves the public account', () => {
    const ctx = fixture(181051);
    ctx.world.respect = 'eminent';
    const treasury = ctx.world.treasury;
    const result = executeOutcomeWitness(ctx, content.mustEvent('the_cook_and_the_second_kitchen'), {
      choiceId: 'rye_at_every_table', expectedOutcomeId: 'one_rye_bread', rng: makeRng(181052),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.treasury).toBe(treasury);
    expect(ctx.world.respect).toBe('regarded');
    const loaded = loadGame(saveGame(ctx), content);
    expect(loaded.world.rumours.has('rumour_rye_at_the_high_board')).toBe(true);
  });
});

describe('walking the common boundary has a real personal price (#1810)', () => {
  it('improves the existing holding and leaves the saved false assent open to proof', () => {
    const ctx = fixture(181057);
    const acres = heldAcres(ctx);
    const income = landIncome(ctx);
    const sealed = executeOutcomeWitness(ctx, content.mustEvent('the_hedge_across_the_common'), {
      choiceId: 'hedge_it', expectedOutcomeId: 'hedged', rng: makeRng(181058),
    });
    expect(sealed.ok, sealed.reason).toBe(true);
    const loaded = loadGame(saveGame(ctx), content);
    expect(heldAcres(loaded)).toBe(acres);
    expect(landIncome(loaded)).toBeGreaterThan(income);
    expect(loaded.world.discrepancies.get('the_common_enclosure_assent')?.state).toBe('open');
    loaded.world.knowledge.add('knows_the_third_room');
    loaded.world.respect = 'eminent';
    const read = executeOutcomeWitnessRaw(loaded, content.mustEvent('the_old_list_reaches_the_cellar'), {
      choiceId: 'answer_the_account', expectedOutcomeId: 'answered', rng: makeRng(181059),
    });
    expect(read.ok, read.reason).toBe(true);
    expect(loaded.world.discrepancies.get('the_common_enclosure_assent')?.state).toBe('proven');
    expect(loaded.world.respect).toBe('regarded');
  });
  it.each([false, true])('charges the saved Head even when an earlier common holding is %s', (alreadyHeld) => {
    const ctx = fixture(181055);
    if (alreadyHeld) grantParcel(ctx, 'wick_common');
    else seizeParcel(ctx, 'wick_common');
    const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'))!;
    const health = head.acquired.health ?? 0;
    const treasury = ctx.world.treasury;
    const result = executeOutcomeWitness(ctx, content.mustEvent('the_hedge_across_the_common'), {
      choiceId: 'leave_the_common', expectedOutcomeId: 'left_open', rng: makeRng(181056),
    });
    expect(result.ok, result.reason).toBe(true);
    const saved = loadGame(saveGame(ctx), content);
    expect(saved.world.people.get(head.id)?.acquired.health).toBe(health - 2);
    expect(saved.world.treasury).toBe(treasury);
    expect([...saved.world.parcels.values()].some((parcel) => parcel.defId === 'wick_common')).toBe(alreadyHeld);
  });
});

describe('the tinker reference enters the actual certificate file (#1810)', () => {
  it('preserves the named signature through save/load and is proved by the chapter-house reader', () => {
    const ctx = fixture(181030);
    const treasury = ctx.world.treasury;
    const event = content.mustEvent('the_third_price');
    const signed = executeOutcomeWitness(ctx, event, {
      choiceId: 'sign_the_reference', expectedOutcomeId: 'referenced', rng: makeRng(181031),
    });
    expect(signed.ok, signed.reason).toBe(true);
    expect(ctx.world.treasury).toBe(treasury);
    const outcome = ctx.world.decisionLog.find((row) => row.kind === 'outcome' && row.event === event.id);
    if (!outcome || outcome.kind !== 'outcome' || typeof outcome.fill.BUYER !== 'string') {
      throw new Error('the reference has no actual named signatory');
    }
    const buyer = ctx.world.people.get(outcome.fill.BUYER)!;
    expect(ctx.world.chronicle.some((page) =>
      page.text?.includes(buyer.epithet ?? buyer.name) && page.text.includes('certified three winters'))).toBe(true);
    const loaded = loadGame(saveGame(ctx), content);
    loaded.world.knowledge.add('knows_the_third_room');
    loaded.world.respect = 'eminent';
    const read = executeOutcomeWitnessRaw(loaded, content.mustEvent('the_old_list_reaches_the_cellar'), {
      choiceId: 'answer_the_account', expectedOutcomeId: 'answered', rng: makeRng(181032),
    });
    expect(read.ok, read.reason).toBe(true);
    expect(loaded.world.discrepancies.get('the_tinker_given_three_winters')?.state).toBe('proven');
    expect(loaded.world.respect).toBe('regarded');
  });
});

describe('the empty glove has a dated reader (#1810)', () => {
  const rootId = 'the_merlin_on_the_block';
  const billId = 'the_empty_glove_at_greening';
  function refuseTheBird() {
    const ctx = fixture(181019);
    ctx.world.respect = 'eminent';
    const year = ctx.world.year;
    const treasury = ctx.world.treasury;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'no_bird', expectedOutcomeId: 'no_bird_bought', rng: makeRng(181020),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.respect).toBe('eminent');
    expect(ctx.world.treasury).toBe(treasury);
    const instance = [...ctx.world.arcs.values()].find((arc) => arc.arc === 'arc_the_empty_glove');
    if (!instance) throw new Error('refusing the bird left no dated reader');
    // An authored arc's entry is immediate. In the ordinary year pipeline
    // it runs at the following year's arc phase, before that year's ambient
    // scenes; its next node then waits for the second Greening.
    ctx.world.year += 1;
    const opening = dueArcSteps(ctx, makeRng(1810201)).find((step) => step.instance.id === instance.id)!;
    const firstFair = executeOutcomeWitness(ctx, content.mustEvent('the_glove_kept_for_the_fair'), {
      expectedOutcomeId: 'not_replaced', rng: makeRng(1810202), arcStep: opening,
    });
    expect(firstFair.ok, firstFair.reason).toBe(true);
    expect(instance.dueYear).toBe(year + 2);
    return { ctx, instance };
  }

  it.each([
    { choice: 'buy_the_bird_now', outcome: 'replaced', cost: 14, respect: 'eminent' },
    { choice: 'acknowledge_the_refusal', outcome: 'acknowledged', cost: 0, respect: 'regarded' },
    { choice: 'deny_the_loss', outcome: 'denied', cost: 0, respect: 'eminent' },
  ])('answers the saved fair account through $choice', ({ choice, outcome, cost, respect }) => {
    const { ctx, instance } = refuseTheBird();
    const loaded = loadGame(saveGame(ctx), content);
    const restored = loaded.world.arcs.get(instance.id)!;
    loaded.world.year = restored.dueYear! - 1;
    expect(dueArcSteps(loaded, makeRng(181021)).some((step) => step.instance.id === restored.id)).toBe(false);
    loaded.world.year += 1;
    expect(ambientPool(loaded).some((event) => event.id === billId)).toBe(false);
    const step = dueArcSteps(loaded, makeRng(181022)).find((entry) => entry.instance.id === restored.id)!;
    expect(step.fill.LADY).toBe(restored.bindings.LADY);
    const treasury = loaded.world.treasury;
    const result = executeOutcomeWitness(loaded, content.mustEvent(billId), {
      choiceId: choice, expectedOutcomeId: outcome, rng: makeRng(181023), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(loaded.world.treasury).toBe(treasury - cost);
    expect(loaded.world.respect).toBe(respect);
    expect(loaded.world.discrepancies.has('the_merlin_was_never_lost')).toBe(outcome === 'denied');
    expect(restored.status).toBe('ended');
  });

  it('still asks the successor when the original woman is absent', () => {
    const { ctx, instance } = refuseTheBird();
    ctx.world.people.kill(instance.bindings.LADY!, ctx.world.year, 'test absence');
    const oldHead = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    ctx.world.people.kill(oldHead.id, ctx.world.year, 'test succession');
    const successor = place(ctx, { sex: 'female', age: 32, castSlots: ['head'] });
    ctx.world.year = instance.dueYear!;
    const step = dueArcSteps(ctx, makeRng(181024)).find((entry) => entry.instance.id === instance.id)!;
    expect(step.fill.HEAD).toBe(successor.id);
    expect(step.absent).toBe(true);
    expect(step.fill.LADY).toBe(instance.bindings.LADY);
    expect(ctx.world.people.get(instance.bindings.LADY!)?.status).toBe('dead');
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(billId), {
      choiceId: 'acknowledge_the_refusal', expectedOutcomeId: 'acknowledged', rng: makeRng(181025), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(instance.status).toBe('ended');
  });

  it('starts no empty-glove account when the bird is replaced immediately', () => {
    const ctx = fixture(181026);
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'buy_the_bird', expectedOutcomeId: 'bought', rng: makeRng(181027),
    });
    expect(result.ok, result.reason).toBe(true);
    expect([...ctx.world.arcs.values()].some((arc) => arc.arc === 'arc_the_empty_glove')).toBe(false);
  });

  it('cancels the outstanding fair account if the house buys a replacement before it falls due', () => {
    const { ctx, instance } = refuseTheBird();
    ctx.world.year = instance.dueYear! - 1;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'buy_the_bird', expectedOutcomeId: 'bought', rng: makeRng(181028),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(instance.status).toBe('cancelled');
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, makeRng(181029)).some((step) => step.instance.id === instance.id)).toBe(false);
  });
});

describe('the omitted petition has an institutional reader (#1810)', () => {
  const lie = 'the_fourth_petition_left_out';
  it.each([
    { outcome: 'warmed', state: 'buried', respect: 'eminent' },
    { outcome: 'unmoved', state: 'proven', respect: 'regarded' },
  ])('reads the saved chapel copy through $outcome', ({ outcome, state, respect }) => {
    const ctx = fixture(181013);
    const written = executeOutcomeWitnessRaw(ctx, content.mustEvent('what_the_liturgy_wards_against'), {
      choiceId: 'say_nothing_about_it', expectedOutcomeId: 'nothing_said', rng: makeRng(181014),
    });
    expect(written.ok, written.reason).toBe(true);
    expect(ctx.world.discrepancies.get(lie)?.state).toBe('open');
    const loaded = loadGame(saveGame(ctx), content);
    loaded.world.respect = 'eminent';
    const head = loaded.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const health = head.acquired.health ?? 0;
    const treasury = loaded.world.treasury;
    const read = executeOutcomeWitnessRaw(loaded, content.mustEvent('the_priest_in_the_west_wing'), {
      choiceId: 'house_him_well', expectedOutcomeId: outcome,
      targetWeightedOutcome: true, rng: makeRng(181015),
    });
    expect(read.ok, read.reason).toBe(true);
    expect(loaded.world.discrepancies.get(lie)?.state).toBe(state);
    expect(loaded.world.respect).toBe(respect);
    expect(head.acquired.health).toBe(health - 2);
    expect(loaded.world.treasury).toBe(treasury);
  });

  it('does not invent an omitted line after the honest question', () => {
    const ctx = fixture(181016);
    const asked = executeOutcomeWitnessRaw(ctx, content.mustEvent('what_the_liturgy_wards_against'), {
      choiceId: 'ask_the_keeper', expectedOutcomeId: 'he_answers', rng: makeRng(181017),
    });
    expect(asked.ok, asked.reason).toBe(true);
    expect(ctx.world.discrepancies.has(lie)).toBe(false);
    ctx.world.respect = 'eminent';
    const read = executeOutcomeWitnessRaw(ctx, content.mustEvent('the_priest_in_the_west_wing'), {
      choiceId: 'house_him_well', expectedOutcomeId: 'unmoved',
      targetWeightedOutcome: true, rng: makeRng(181018),
    });
    expect(read.ok, read.reason).toBe(true);
    expect(ctx.world.discrepancies.has(lie)).toBe(false);
    expect(ctx.world.respect).toBe('eminent');
  });
});

describe('the written charcoal rate has a later reader (#1810)', () => {
  const rootId = 'the_smith_wants_the_charcoal_contract';
  const billId = 'the_charcoal_price_returns';

  function signTheRate() {
    const ctx = fixture(181001);
    const treasury = ctx.world.treasury;
    const year = ctx.world.year;
    const signed = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'write_it', expectedOutcomeId: 'written', rng: makeRng(181002),
    });
    expect(signed.ok, signed.reason).toBe(true);
    expect(ctx.world.treasury).toBe(treasury);
    expect(ctx.world.chronicle.some((entry) => entry.text?.includes('twenty-year charcoal rate'))).toBe(true);
    const instance = [...ctx.world.arcs.values()].find((entry) =>
      content.arc(entry.arc)?.nodes.some((node) => node.event === billId));
    if (!instance) throw new Error('the written charcoal rate has no scheduled reader');
    expect(instance.dueYear).toBe(year + 11);
    return { ctx, instance };
  }

  it.each([
    { choice: 'keep_the_rate', outcome: 'kept', cost: 13 },
    { choice: 'change_our_copy', outcome: 'altered', cost: 0 },
  ])('reads the saved promise through $choice under the successor', ({ choice, outcome, cost }) => {
    const { ctx, instance } = signTheRate();
    const loaded = loadGame(saveGame(ctx), content);
    const restored = loaded.world.arcs.get(instance.id)!;
    expect(restored.dueYear).toBe(instance.dueYear);
    expect(ambientPool(loaded).some((event) => event.id === billId)).toBe(false);
    loaded.world.year = restored.dueYear! - 1;
    expect(dueArcSteps(loaded, makeRng(181003)).some((step) => step.instance.id === restored.id)).toBe(false);
    loaded.world.year += 1;
    const oldHead = loaded.world.people.living().find((person) => person.castSlots.includes('head'))!;
    loaded.world.people.kill(oldHead.id, loaded.world.year, 'test succession');
    const successor = place(loaded, { sex: 'male', age: 27, castSlots: ['head'] });
    const step = dueArcSteps(loaded, makeRng(181004)).find((entry) => entry.instance.id === restored.id);
    if (!step) throw new Error('the charcoal contract did not become due');
    expect(step.fill.HEAD).toBe(successor.id);
    const treasury = loaded.world.treasury;
    const result = executeOutcomeWitness(loaded, content.mustEvent(billId), {
      choiceId: choice, expectedOutcomeId: outcome, rng: makeRng(181005), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(loaded.world.treasury).toBe(treasury - cost);
    expect(restored.status).toBe('ended');
    if (outcome === 'kept') {
      expect(loaded.world.discrepancies.has('the_charcoal_rate_rewritten')).toBe(false);
      expect(loaded.world.chronicle.some((entry) => entry.text?.includes('kept the signed charcoal rate'))).toBe(true);
    } else {
      expect(loaded.world.discrepancies.get('the_charcoal_rate_rewritten')).toMatchObject({
        state: 'open', severity: 'major', provableBy: ['commons', 'the_church'],
      });
      expect(loaded.world.chronicle.some((entry) => entry.text?.includes('higher charcoal rate'))).toBe(true);
    }
  });

  it('does not invent a written obligation after the handshake', () => {
    const ctx = fixture(181006);
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'keep_the_handshake', expectedOutcomeId: 'handshake', rng: makeRng(181007),
    });
    expect(result.ok, result.reason).toBe(true);
    expect([...ctx.world.arcs.values()].some((instance) =>
      content.arc(instance.arc)?.nodes.some((node) => node.event === billId))).toBe(false);
  });
});

describe('Wick carpenter consequence witnesses (#1276, #334)', () => {
  const rootId = 'the_carpenter_is_getting_old';
  const billId = 'the_price_of_no_carpenter';

  function buyOutsideTheParish() {
    const ctx = fixture(127601);
    const root = content.mustEvent(rootId);
    const year = ctx.world.year;
    // The source scene needs an actual carpenter before the house buys Bramme labour.
    expect(evalCondition(root.conditions, ctx)).toBe(true);
    expect(ambientPool(ctx).some((event) => event.id === root.id)).toBe(true);
    const result = executeOutcomeWitnessRaw(ctx, root, {
      choiceId: 'pay_bramme_rates', expectedOutcomeId: 'bramme_rates', rng: makeRng(127602),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get('no_carpenter_at_wick')).toBe(true);
    // Having no local carpenter must prevent the same source from reappearing.
    expect(evalCondition(root.conditions, ctx)).toBe(false);
    expect(ambientPool(ctx).some((event) => event.id === root.id)).toBe(false);
    const instance = [...ctx.world.arcs.values()].find((entry) =>
      content.arc(entry.arc)?.nodes.some((node) => node.event === billId));
    if (!instance) throw new Error('buying Bramme work did not schedule its later bill');
    expect(instance.dueYear).toBeGreaterThanOrEqual(year + 40);
    expect(instance.dueYear).toBeLessThanOrEqual(year + 50);
    return { ctx, instance };
  }

  it.each([
    { choice: 'pay_the_bill', outcome: 'paid', cost: 28, restored: false },
    { choice: 'bring_a_carpenter_to_wick', outcome: 'settled', cost: 36, restored: true },
  ])('executes $choice as the earned due step, with the current Head', ({ choice, outcome, cost, restored }) => {
    const { ctx, instance } = buyOutsideTheParish();
    const bill = content.mustEvent(billId);
    expect(ambientPool(ctx).some((event) => event.id === bill.id)).toBe(false);
    expect(dueArcSteps(ctx, makeRng(127603))).toHaveLength(0);
    ctx.world.year = instance.dueYear! - 1;
    expect(dueArcSteps(ctx, makeRng(127604))).toHaveLength(0);
    ctx.world.year += 1;

    const oldHead = ctx.world.people.living().find((person) => person.castSlots.includes('head'))!;
    ctx.world.people.kill(oldHead.id, ctx.world.year, 'test succession');
    const successor = place(ctx, { sex: 'male', age: 27, castSlots: ['head'] });
    const step = dueArcSteps(ctx, makeRng(127605)).find((entry) => entry.instance.id === instance.id);
    if (!step) throw new Error('the carpenter bill never came due');
    expect(step.fill.HEAD).toBe(successor.id);
    const before = ctx.world.treasury;
    const result = executeOutcomeWitness(ctx, bill, {
      choiceId: choice, expectedOutcomeId: outcome, rng: makeRng(127606), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.treasury).toBe(before - cost);
    expect(ctx.world.flags.get('no_carpenter_at_wick')).toBe(!restored);
    // Paying the delayed bill leaves the source blocked; resettling Wick restores it.
    const source = content.mustEvent(rootId);
    expect(evalCondition(source.conditions, ctx)).toBe(restored);
    expect(ambientPool(ctx).some((event) => event.id === source.id)).toBe(restored);
    expect(instance.status).toBe('ended');
    expect(ctx.world.chronicle.some((entry) => entry.eventId === bill.id)).toBe(true);
  });

  it('withholds the bill when the parish no longer lacks a carpenter', () => {
    const { ctx, instance } = buyOutsideTheParish();
    const bill = content.mustEvent(billId);
    ctx.world.year = instance.dueYear!;
    ctx.world.flags.set('no_carpenter_at_wick', false);
    expect(evalCondition(bill.conditions, ctx)).toBe(false);
    expect(dueArcSteps(ctx, makeRng(127607))).toHaveLength(0);
    ctx.world.flags.set('no_carpenter_at_wick', true);
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, makeRng(127608))[0]?.node.event).toBe(bill.id);
  });

  it('preserves the due date through a save and ignores an unkept legacy Head binding (#1285)', () => {
    const { ctx, instance } = buyOutsideTheParish();
    const oldHead = ctx.world.people.living().find((person) => person.castSlots.includes('head'))!;
    instance.bindings.HEAD = oldHead.id;
    const loaded = loadGame(saveGame(ctx), content);
    const restored = loaded.world.arcs.get(instance.id)!;
    expect(restored.dueYear).toBe(instance.dueYear);
    loaded.world.year = restored.dueYear!;
    loaded.world.people.kill(oldHead.id, loaded.world.year, 'test succession');
    const successor = place(loaded, { sex: 'male', age: 27, castSlots: ['head'] });
    const step = dueArcSteps(loaded, makeRng(127611)).find((entry) => entry.instance.id === restored.id);
    expect(step?.fill.HEAD).toBe(successor.id);
  });

  it.each(['apprenticed', 'the_boy_leaves'])('does not schedule the Bramme bill after $0', (outcome) => {
    const ctx = fixture(127609);
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'apprentice_a_boy', expectedOutcomeId: outcome,
      targetWeightedOutcome: true, rng: makeRng(127610),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.arcs.size).toBe(0);
  });
});

describe('#334 Bramme margin consequence witnesses', () => {
  it('executes both answers through the real choice outcome path', () => {
    const event = content.events.find((entry) => String(entry.id) === 'the_bramme_margin_returns');
    if (!event || event.interaction.kind !== 'choice') throw new Error('Bramme follow-up missing');
    const keys: string[] = [];
    for (const choice of event.interaction.choices) {
      const ctx = fixture(33401);
      ctx.world.generation = Math.max(4, FREQUENCY_PROFILES[event.frequency].minGeneration);
      ctx.world.flags.set('bramme_copied_a_book', true);
      expect(evalCondition(event.conditions, ctx)).toBe(true);
      for (const outcome of choice.outcomes) {
        const result = executeOutcomeWitness(ctx, event, {
          choiceId: choice.id,
          expectedOutcomeId: outcome.id,
          rng: makeRng(33402),
        });
        expect(result.ok, result.reason).toBe(true);
        if (result.key) keys.push(result.key);
        expect(ctx.world.flags.get('bramme_copied_a_book')).toBe(false);
        ctx.world.flags.set('bramme_copied_a_book', true);
      }
    }
    expect(keys.sort()).toEqual([
      outcomeKey('the_bramme_margin_returns', 'acknowledge_the_correction', 'bramme_knows'),
      outcomeKey('the_bramme_margin_returns', 'refuse_the_answer', 'silence_recorded'),
    ].sort());
  });
});

describe('#334 Crown reader chain witnesses', () => {
  // Each reader is chained from the one outcome that writes its key, so it is
  // witnessed the way it actually fires: as the due step of that inline arc,
  // with the key it reads set first. The gate is shown shut without the key.
  const readers = [
    { arc: 'inline_the_wardenship_falls_vacant__chosen', event: 'a_page_in_our_own_hand', set: (ctx: ReturnType<typeof fixture>) => ctx.world.flags.set('the_house_held_the_wardenship', true) },
    { arc: 'inline_the_heralds_open_the_descent__they_go_looking', event: 'cousins_from_the_rimefell', set: (ctx: ReturnType<typeof fixture>) => ctx.world.knowledge.add('knows_the_rimefell_entry') },
  ] as const;

  for (const [index, reader] of readers.entries()) {
    it(`${reader.event} reads its key and executes both answers as the due arc step`, () => {
      const event = content.event(reader.event);
      if (!event || event.interaction.kind !== 'choice') throw new Error(`${reader.event} missing`);
      expect(String(event.arc?.of)).toBe(reader.arc);
      const keys: string[] = [];
      for (const choice of event.interaction.choices) {
        const ctx = fixture(33411 + index);
        expect(evalCondition(event.conditions, ctx)).toBe(false);
        reader.set(ctx);
        expect(evalCondition(event.conditions, ctx)).toBe(true);
        const arc = content.arc(reader.arc);
        if (!arc) throw new Error(`${reader.arc} did not compile`);
        const rng = makeRng(33412 + index);
        const instance = startArc(arc, ctx, rng);
        if (!instance) throw new Error(`${reader.arc} did not start`);
        let step = dueArcSteps(ctx, rng).find((candidate) => candidate.instance.id === instance.id);
        for (let wait = 0; !step && wait < 60; wait++) {
          ctx.world.year += 1;
          step = dueArcSteps(ctx, rng).find((candidate) => candidate.instance.id === instance.id);
        }
        if (!step) throw new Error(`${reader.arc} never came due`);
        const result = executeOutcomeWitness(ctx, event, {
          choiceId: choice.id,
          expectedOutcomeId: choice.outcomes[0]!.id,
          rng,
          arcStep: step,
        });
        expect(result.ok, result.reason).toBe(true);
        if (result.key) keys.push(result.key);
      }
      expect(keys.sort()).toEqual(event.interaction.choices
        .map((choice) => outcomeKey(reader.event, choice.id, choice.outcomes[0]!.id)).sort());
    });
  }
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
      // Arc state ladders require their own persistent binding/local-flag
      // witnesses; the late-Long sequence below executes its entire graph.
      if (event.arc || event.interaction.kind === 'narration') return [];
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

    for (const [eventId, affinity, sex] of [
      ['the_fever_and_the_vigil', 'death', 'female'],
      ['the_wind_under_the_slates', 'terra', 'male'],
      ['the_cawdry_copy', 'darkness', 'female'],
    ] as const) {
      for (const outcomeId of ['held', 'lost']) {
        const ctx = fixture(1830);
        for (const person of ctx.world.people.all()) person.spellsKnown = [];
        const event = content.mustEvent(eventId);
        const choiceId = `use_${affinity}`;
        const blocked = executeOutcomeWitness(ctx, event, {
          choiceId, expectedOutcomeId: outcomeId, rng: makeRng(1830),
        });
        expect(blocked.ok).toBe(false);
        const reader = place(ctx, { sex, age: 30, awakened: true, name: 'The Known Working Reader' });
        expect(gainSpellbook(ctx, reader, content.spellbook(`lesser_workings_of_${affinity}`)!)).toBe(true);
        for (const key of [affinity, 'mind']) {
          const value = outcomeId === 'held' ? 100 : key === 'mind' ? 10 : 0;
          reader.acquired[key] = (reader.acquired[key] ?? 0) + value - attr(reader, key, ctx.genetics, ctx.world.year);
          if (reader.phenotype) reader.phenotype.dirty = true;
        }
        const result = executeOutcomeWitness(ctx, event, {
          choiceId, expectedOutcomeId: outcomeId, rng: makeRng(1831),
        });
        expect(result.ok, result.reason).toBe(true);
        if (result.key) witnessed.push(result.key);
      }
    }

    for (const [eventId, sex] of [
      ['the_cawdry_copy', 'female'],
      ['the_fever_and_the_vigil', 'female'],
      ['the_wind_under_the_slates', 'male'],
    ] as const) {
      const ctx = fixture(1796);
      const event = content.mustEvent(eventId);
      for (const p of ctx.world.people.all()) p.awakening.awakened = false;
      const blocked = executeOutcomeWitness(ctx, event, {
        choiceId: 'prepare_next_time', expectedOutcomeId: 'a_reading_begins', rng: makeRng(1796),
      });
      expect(blocked.ok).toBe(false);
      place(ctx, { sex, age: 30, awakened: true, name: 'The New Reader' });
      const result = executeOutcomeWitness(ctx, event, {
        choiceId: 'prepare_next_time', expectedOutcomeId: 'a_reading_begins', rng: makeRng(1796),
      });
      expect(result.ok, result.reason).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    for (const offer of [
      { event: 'the_dovecote_and_the_seed', choice: 'send_half_to_the_cadet', outcome: 'birds_sent' },
      { event: 'the_old_man_at_the_board', choice: 'find_another_board', outcome: 'another_board' },
    ]) {
      const { ctx } = pricedCadetFixture(181053);
      const result = executeOutcomeWitness(ctx, content.mustEvent(offer.event), {
        choiceId: offer.choice, expectedOutcomeId: offer.outcome, rng: makeRng(181054),
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

  it('executes the bonded-servant follow-up through the inline arc created by the real advance', () => {
    const parent = content.event('the_winter_advance');
    const follow = content.event('the_book_is_opened');
    if (!parent || parent.interaction.kind === 'narration' || !follow) {
      throw new Error('bond follow-up fixture changed authored events');
    }

    const family = TEST_FAMILIES.find((candidate) => {
      const ctx = candidate.build(content);
      ctx.world.generation = Math.max(ctx.world.generation, 2);
      ctx.world.treasury = Math.max(ctx.world.treasury, 40);
      const result = executeOutcomeWitnessRaw(ctx, parent, {
        choiceId: 'advance_it',
        expectedOutcomeId: 'bound',
        rng: makeRng(4190),
      });
      if (!result.ok) return false;
      return [...ctx.world.arcs.values()].some((instance) => {
        const arc = content.arc(instance.arc);
        const node = arc?.nodes.find((candidateNode) => candidateNode.id === instance.node);
        return node?.event === follow.id;
      });
    });
    expect(family, 'a shared family should be able to take the winter advance').toBeDefined();
    if (!family) return;

    const followups = [
      ['tear_it_up', 'freed'],
      ['hold_to_it', 'held'],
    ] as const satisfies readonly (readonly [string, string])[];
    for (const [index, [choiceId, outcomeId]] of followups.entries()) {
      const ctx = family.build(content);
      ctx.world.generation = Math.max(ctx.world.generation, 2);
      ctx.world.treasury = Math.max(ctx.world.treasury, 40);
      const parentResult = executeOutcomeWitness(ctx, parent, {
        choiceId: 'advance_it',
        expectedOutcomeId: 'bound',
        rng: makeRng(4200 + index * 10),
      });
      expect(parentResult.ok, parentResult.reason).toBe(true);

      const instance = [...ctx.world.arcs.values()].find((candidate) => {
        const arc = content.arc(candidate.arc);
        const node = arc?.nodes.find((candidateNode) => candidateNode.id === candidate.node);
        return node?.event === follow.id;
      });
      expect(instance, 'the advance should create the_book_is_opened arc').toBeDefined();
      if (!instance) continue;

      ctx.world.year = instance.dueYear ?? ctx.world.year;
      const step = dueArcSteps(ctx, makeRng(4201 + index * 10)).find((candidate) => (
        candidate.instance.id === instance.id && candidate.node.event === follow.id
      ));
      expect(step, 'the bonded-servant follow-up should become due').toBeDefined();
      if (!step) continue;

      const result = executeOutcomeWitness(ctx, follow, {
        choiceId,
        expectedOutcomeId: outcomeId,
        rng: makeRng(4202 + index * 10),
        arcStep: step,
      });
      expect(result.ok, `the_book_is_opened/${choiceId}/${outcomeId}: ${result.reason}`).toBe(true);
      expect(result.key).toBe(outcomeKey('the_book_is_opened', choiceId, outcomeId));
    }
  });

  it('executes the vessel record follow-up through the inline arc created by the real rite', () => {
    const seed = 4230;
    const { ctx, event, cast } = directPlayerFixture(seed, 'the_vessel_rite');
    const parentResult = executeOutcomeWitness(ctx, event, {
      choiceId: 'speak_the_name',
      expectedOutcomeId: 'taken',
      rng: makeRng(seed + 1),
      cast,
    });
    expect(parentResult.ok, parentResult.reason).toBe(true);

    const follow = content.event('the_vessel_remembered');
    if (!follow) throw new Error('the_vessel_remembered fixture changed authored event');

    const step = dueArcSteps(ctx, makeRng(seed + 2)).find((candidate) => (
      candidate.node.event === follow.id
    ));
    expect(step, 'the taken Vessel should schedule its immediate record follow-up').toBeDefined();
    if (!step) return;

    const result = executeOutcomeWitness(ctx, follow, {
      expectedOutcomeId: 'the_page',
      rng: makeRng(seed + 3),
      arcStep: step,
    });
    expect(result.ok, `the_vessel_remembered/the_page: ${result.reason}`).toBe(true);
    expect(result.key).toBe(outcomeKey('the_vessel_remembered', undefined, 'the_page'));
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
      'the_wick_bridge_load',
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

describe('authored record-bearing TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  it('executes ordinary record-bearing player outcomes through a shared family fixture', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        // Capacity-specific forcing outcomes have their two-cast witnesses above.
        event.forcing !== undefined
        || event.tier === 'frame'
        || event.arc !== undefined
        || event.record === undefined
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

        const slots = resolveSlots(event, ctx, makeRng(9201));
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
          const slots = resolveSlots(event, ctx, makeRng(9201));
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
            rng: makeRng(9201),
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

describe('authored age-scoped TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  it('executes simple single-Age player-choice outcomes through a shared family that can really offer them', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.record !== undefined
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
      ) return [];

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      const age = event.ages.only[0]!;
      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
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
        if (!evalCondition(event.conditions, ctx)) return false;

        const slots = resolveSlots(event, ctx, makeRng(9101));
        if (!slots.ok || slots.playerCast.length) return false;

        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });

      return family ? [{ event, choices, family, age }] : [];
    });

    expect(candidates.length).toBeGreaterThan(0);

    const declared = candidates.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];

    for (const { event, choices, family, age } of candidates) {
      const outside = family.build(content);
      outside.world.generation = Math.max(
        outside.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      outside.world.age.active = [];
      expect(
        ambientPool(outside).some((offered) => offered.id === event.id),
        String(event.id) + ' should be excluded outside ' + String(age),
      ).toBe(false);

      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = family.build(content);
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
            evalCondition(event.conditions, ctx),
            String(event.id) + ' should satisfy its authored conditions in '
              + family.id + ' during ' + String(age),
          ).toBe(true);
          const slots = resolveSlots(event, ctx, makeRng(9101));
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
            String(event.id) + ' should be offered by the real ambient selector in '
              + family.id + ' during ' + String(age),
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(9101),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id)
              + ' via ' + family.id + ' during ' + String(age)
              + ': ' + (result.reason ?? 'no reason'),
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


describe('authored age-scoped narration TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  it('executes simple single-Age narration outcomes through a shared family that can really offer them', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.interaction.kind !== 'narration'
      ) return [];

      const age = event.ages.only[0]!;
      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
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
        if (!evalCondition(event.conditions, ctx)) return false;

        const slots = resolveSlots(event, ctx, makeRng(9801));
        if (!slots.ok || slots.playerCast.length) return false;

        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });

      return family ? [{ event, family, age }] : [];
    });

    expect(candidates.length).toBeGreaterThan(0);

    const declared = candidates.flatMap(({ event }) => (
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []
    ));
    const witnessed: string[] = [];

    for (const { event, family, age } of candidates) {
      if (event.interaction.kind !== 'narration') continue;

      const outside = family.build(content);
      outside.world.generation = Math.max(
        outside.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      outside.world.age.active = [];
      expect(
        ambientPool(outside).some((offered) => offered.id === event.id),
        String(event.id) + ' should be excluded outside ' + String(age),
      ).toBe(false);

      for (const outcome of event.interaction.outcomes) {
        const ctx = family.build(content);
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
          evalCondition(event.conditions, ctx),
          String(event.id) + ' should satisfy its authored conditions in '
            + family.id + ' during ' + String(age),
        ).toBe(true);
        const slots = resolveSlots(event, ctx, makeRng(9801));
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
          String(event.id) + ' should be offered by the real ambient selector in '
            + family.id + ' during ' + String(age),
        ).toBe(true);

        const result = executeOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: makeRng(9801),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          String(event.id) + '/' + String(outcome.id)
            + ' via ' + family.id + ' during ' + String(age)
            + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        expect(result.key).toBe(
          outcomeKey(String(event.id), undefined, String(outcome.id)),
        );
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored narration TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  it('executes fillable non-Age ambient narration outcomes through a shared family fixture', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.ages !== undefined
        || event.interaction.kind !== 'narration'
      ) return [];

      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        if (!evalCondition(event.conditions, ctx)) return false;

        const slots = resolveSlots(event, ctx, makeRng(9701));
        if (!slots.ok || slots.playerCast.length) return false;

        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });

      return family ? [{ event, family }] : [];
    });

    expect(candidates.length).toBeGreaterThan(0);

    const declared = candidates.flatMap(({ event }) => (
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []
    ));
    const witnessed: string[] = [];

    for (const { event, family } of candidates) {
      if (event.interaction.kind !== 'narration') continue;

      for (const outcome of event.interaction.outcomes) {
        const ctx = family.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );

        expect(
          evalCondition(event.conditions, ctx),
          String(event.id) + ' should satisfy its authored conditions in ' + family.id,
        ).toBe(true);
        const slots = resolveSlots(event, ctx, makeRng(9701));
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
          expectedOutcomeId: outcome.id,
          rng: makeRng(9701),
          targetWeightedOutcome: event.interaction.outcomes.length > 1,
        });

        expect(
          result.ok,
          String(event.id) + '/' + String(outcome.id)
            + ' via ' + family.id + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        expect(result.key).toBe(
          outcomeKey(String(event.id), undefined, String(outcome.id)),
        );
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});



describe('authored arc-step TEST_FAMILIES fixture-sweep outcome witnesses', () => {
  function buildArcStep(
    arc: (typeof content.arcs)[number],
    node: (typeof content.arcs)[number]['nodes'][number],
    event: (typeof content.events)[number],
    family: (typeof TEST_FAMILIES)[number],
    seed: number,
  ) {
    const ctx = family.build(content);
    const rng = makeRng(seed);

    // Seed only the arc-wide bindings from a real slot resolution. This models
    // the cast an earlier beat would have carried forward without pretending
    // every slot on this later beat persisted across the story.
    const initial = resolveSlots(event, ctx, rng);
    if (!initial.ok || initial.playerCast.length) return undefined;
    const seedBindings: SlotFill = {};
    for (const slotId of arc.bindings) {
      const cast = initial.fill[slotId];
      if (cast !== undefined) seedBindings[slotId] = cast;
    }

    const instance = startArc(arc, ctx, rng, seedBindings);
    if (!instance) return undefined;
    instance.node = node.id;
    instance.dueYear = ctx.world.year;

    const step = dueArcSteps(ctx, rng).find((candidate) => (
      candidate.instance.id === instance.id && candidate.node.id === node.id
    ));
    if (!step || step.playerCast.length) return undefined;
    if (!evalCondition(event.conditions, ctx, { arc: instance })) return undefined;

    return { ctx, rng, instance, step };
  }

  it('executes every arc-node outcome a shared family can satisfy through dueArcSteps and the real commit path', () => {
    type Case = {
      arc: (typeof content.arcs)[number];
      node: (typeof content.arcs)[number]['nodes'][number];
      event: (typeof content.events)[number];
      family: (typeof TEST_FAMILIES)[number];
      seed: number;
      choiceId?: string;
      outcomeId: string;
      targetChanceChoice: boolean;
      targetCheckedOutcome: boolean;
      targetWeightedOutcome: boolean;
    };

    const cases: Case[] = [];
    let seed = 10_000;

    for (const arc of content.arcs) {
      for (const node of arc.nodes) {
        const event = content.event(node.event);
        if (!event) continue;

        const targets = event.interaction.kind === 'narration'
          ? event.interaction.outcomes.map((outcome) => ({
              choiceId: undefined,
              choice: undefined,
              outcome,
            }))
          : event.interaction.choices.flatMap((choice) => (
              choice.outcomes.map((outcome) => ({ choiceId: String(choice.id), choice, outcome }))
            ));

        for (const target of targets) {
          const targetSeed = seed++;
          const targetChanceChoice = (
            event.interaction.kind !== 'narration'
            && event.interaction.decidedBy === 'chance'
          );
          const targetCheckedOutcome = target.choice?.check !== undefined;
          const targetWeightedOutcome = (
            !targetCheckedOutcome
            && (
              event.interaction.kind === 'narration'
                ? event.interaction.outcomes.length > 1
                : target.choice!.outcomes.length > 1
            )
          );

          const family = TEST_FAMILIES.find((candidate) => {
            const built = buildArcStep(arc, node, event, candidate, targetSeed);
            if (!built) return false;

            const result = executeOutcomeWitnessRaw(built.ctx, event, {
              ...(target.choiceId !== undefined ? { choiceId: target.choiceId } : {}),
              expectedOutcomeId: target.outcome.id,
              rng: built.rng,
              arcStep: built.step,
              ...(targetChanceChoice ? { targetChanceChoice: true } : {}),
              ...(targetCheckedOutcome ? { targetCheckedOutcome: true } : {}),
              ...(targetWeightedOutcome ? { targetWeightedOutcome: true } : {}),
            });
            return result.ok;
          });

          if (family) {
            cases.push({
              arc,
              node,
              event,
              family,
              seed: targetSeed,
              ...(target.choiceId !== undefined ? { choiceId: target.choiceId } : {}),
              outcomeId: String(target.outcome.id),
              targetChanceChoice,
              targetCheckedOutcome,
              targetWeightedOutcome,
            });
          }
        }
      }
    }

    expect(cases.length).toBeGreaterThan(0);

    const witnessed: string[] = [];
    for (const testCase of cases) {
      const built = buildArcStep(
        testCase.arc,
        testCase.node,
        testCase.event,
        testCase.family,
        testCase.seed,
      );
      if (!built) {
        throw new Error(
          String(testCase.event.id) + ' stopped building in ' + testCase.family.id,
        );
      }

      const result = executeOutcomeWitness(built.ctx, testCase.event, {
        ...(testCase.choiceId !== undefined ? { choiceId: testCase.choiceId } : {}),
        expectedOutcomeId: testCase.outcomeId,
        rng: built.rng,
        arcStep: built.step,
        ...(testCase.targetChanceChoice ? { targetChanceChoice: true } : {}),
        ...(testCase.targetCheckedOutcome ? { targetCheckedOutcome: true } : {}),
        ...(testCase.targetWeightedOutcome ? { targetWeightedOutcome: true } : {}),
      });

      expect(
        result.ok,
        String(testCase.event.id)
          + (testCase.choiceId ? '/' + testCase.choiceId : '')
          + '/' + testCase.outcomeId
          + ' via ' + testCase.family.id
          + ': ' + (result.reason ?? 'no reason'),
      ).toBe(true);
      if (result.key) witnessed.push(result.key);
    }

    expect(new Set(witnessed).size).toBe(witnessed.length);
  });
});

describe('authored frame narration outcome witnesses', () => {
  function satisfyFrameReads(
    ctx: ReturnType<(typeof TEST_FAMILIES)[number]['build']>,
    event: (typeof content.events)[number],
  ): void {
    let synthetic = 0;
    for (const read of event.reads) {
      if ('discrepancy' in read) {
        ctx.world.discrepancies.set(read.discrepancy, {
          severity: 'major',
          provableBy: [],
          state: read.state ?? 'open',
        });
        continue;
      }
      if ('anyDiscrepancy' in read) {
        for (let i = 0; i < read.anyDiscrepancy.atLeast; i++) {
          ctx.world.discrepancies.set(
            `witness_frame_${event.id}_${synthetic++}`,
            {
              severity: 'major',
              provableBy: [],
              state: read.anyDiscrepancy.state ?? 'open',
            },
          );
        }
        continue;
      }
      if ('recorded' in read) {
        for (let i = 0; i < read.recorded.atLeast; i++) {
          ctx.world.decisionLog.push({
            kind: 'record',
            year: ctx.world.year,
            event: event.id,
            option: 'record',
          });
        }
        continue;
      }
      if ('omitted' in read) {
        for (let i = 0; i < read.omitted.atLeast; i++) {
          ctx.world.decisionLog.push({
            kind: 'record',
            year: ctx.world.year,
            event: event.id,
            option: 'omit',
          });
        }
        continue;
      }
      if ('chronicled' in read) {
        ctx.world.chronicle.push({
          year: ctx.world.year,
          weight: 'page',
          text: 'A deterministic witness page.',
          eventId: read.chronicled,
          named: true,
          record: 'record',
        });
      }
    }
  }

  it('admits every authored frame narration through framePool and commits every named outcome', () => {
    const family = TEST_FAMILIES.find((candidate) => candidate.id === 'storybook_house');
    if (!family) throw new Error('storybook TEST_FAMILY fixture is missing');

    const events = content.events.filter((event) => (
      event.tier === 'frame' && !event.arc && event.interaction.kind === 'narration'
    ));
    expect(events.length).toBeGreaterThan(0);

    const declared = events.flatMap((event) => (
      event.interaction.kind === 'narration'
        ? event.interaction.outcomes.map((outcome) =>
            outcomeKey(String(event.id), undefined, String(outcome.id)))
        : []
    ));
    const witnessed: string[] = [];

    for (const [eventIndex, event] of events.entries()) {
      if (event.interaction.kind !== 'narration') continue;

      for (const [outcomeIndex, outcome] of event.interaction.outcomes.entries()) {
        const ctx = family.build(content);
        satisfyFrameReads(ctx, event);

        const result = executeFrameOutcomeWitness(ctx, event, {
          expectedOutcomeId: outcome.id,
          rng: makeRng(9600 + eventIndex * 20 + outcomeIndex),
        });

        expect(
          result.ok,
          String(event.id) + '/' + String(outcome.id) + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        expect(result.key).toBe(
          outcomeKey(String(event.id), undefined, String(outcome.id)),
        );
        expect(ctx.world.frame.entries.at(-1)).toMatchObject({
          eventId: event.id,
          outcomeId: outcome.id,
        });
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.sort()).toEqual(declared.sort());
  });
});


describe('authored age-scoped record-bearing TEST_FAMILIES outcome witnesses', () => {
  it('executes simple single-Age record choices through a shared family that can really offer them', () => {
    const candidates = content.events.flatMap((event) => {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.record === undefined
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
      ) return [];

      const choices = event.interaction.choices.filter((choice) => (
        choice.requires.length === 0 && choice.check === undefined
      ));
      if (choices.length === 0) return [];

      const age = event.ages.only[0]!;
      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
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
        if (!evalCondition(event.conditions, ctx)) return false;

        const slots = resolveSlots(event, ctx, makeRng(9901));
        if (!slots.ok || slots.playerCast.length) return false;

        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });

      return family ? [{ event, choices, family, age }] : [];
    });

    expect(candidates.length).toBeGreaterThan(0);

    const declared = candidates.flatMap(({ event, choices }) =>
      choices.flatMap((choice) =>
        choice.outcomes.map((outcome) =>
          outcomeKey(String(event.id), String(choice.id), String(outcome.id)))));
    const witnessed: string[] = [];

    for (const { event, choices, family, age } of candidates) {
      const outside = family.build(content);
      outside.world.generation = Math.max(
        outside.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      outside.world.age.active = [];
      expect(
        ambientPool(outside).some((offered) => offered.id === event.id),
        String(event.id) + ' should be excluded outside ' + String(age),
      ).toBe(false);

      for (const choice of choices) {
        for (const outcome of choice.outcomes) {
          const ctx = family.build(content);
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
            evalCondition(event.conditions, ctx),
            String(event.id) + ' should satisfy its authored conditions in '
              + family.id + ' during ' + String(age),
          ).toBe(true);
          const slots = resolveSlots(event, ctx, makeRng(9901));
          expect(
            slots.ok,
            String(event.id) + ' should resolve its authored slots in ' + family.id,
          ).toBe(true);
          if (!slots.ok) continue;
          expect(slots.playerCast).toHaveLength(0);
          expect(
            ambientPool(ctx).some((offered) => offered.id === event.id),
            String(event.id) + ' should be offered by the real ambient selector in '
              + family.id + ' during ' + String(age),
          ).toBe(true);

          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(9901),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });

          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id)
              + ' via ' + family.id + ' during ' + String(age)
              + ': ' + (result.reason ?? 'no reason'),
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


describe('mature-house TEST_FAMILIES fallback outcome witnesses', () => {
  function buildMatureHouse(
    family: (typeof TEST_FAMILIES)[number],
    event: (typeof content.events)[number],
  ) {
    const ctx = family.build(content);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      10,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );
    ctx.world.treasury = Math.max(ctx.world.treasury, 1_000);
    return ctx;
  }

  function offeredByStandardFamily(event: (typeof content.events)[number]): boolean {
    return TEST_FAMILIES.some((family) => {
      const ctx = family.build(content);
      ctx.world.generation = Math.max(
        ctx.world.generation,
        FREQUENCY_PROFILES[event.frequency].minGeneration,
      );
      if (!evalCondition(event.conditions, ctx)) return false;
      const slots = resolveSlots(event, ctx, makeRng(9951));
      if (!slots.ok || slots.playerCast.length) return false;
      return ambientPool(ctx).some((offered) => offered.id === event.id);
    });
  }

  it('executes ordinary late/prosperous outcomes missed by the baseline shared fixtures', () => {
    type Case = {
      event: (typeof content.events)[number];
      family: (typeof TEST_FAMILIES)[number];
    };

    const cases: Case[] = [];
    for (const event of content.events) {
      if (
        // Capacity-specific forcing outcomes have their two-cast witnesses above.
        event.forcing !== undefined
        || event.tier === 'frame'
        || event.arc !== undefined
        || event.ages !== undefined
        || offeredByStandardFamily(event)
      ) continue;

      if (event.interaction.kind !== 'narration') {
        if (event.interaction.decidedBy !== 'player') continue;
        if (!event.interaction.choices.some((choice) => (
          choice.requires.length === 0 && choice.check === undefined
        ))) continue;
      }

      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = buildMatureHouse(candidate, event);
        if (!evalCondition(event.conditions, ctx)) return false;
        const slots = resolveSlots(event, ctx, makeRng(9952));
        if (!slots.ok || slots.playerCast.length) return false;
        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });
      if (family) cases.push({ event, family });
    }

    expect(cases.length).toBeGreaterThan(0);
    const witnessed: string[] = [];

    for (const { event, family } of cases) {
      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) {
          const ctx = buildMatureHouse(family, event);
          const result = executeOutcomeWitness(ctx, event, {
            expectedOutcomeId: outcome.id,
            rng: makeRng(9953),
            targetWeightedOutcome: event.interaction.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(outcome.id)
              + ' via mature ' + family.id + ': ' + (result.reason ?? 'no reason'),
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
        }
        continue;
      }

      for (const choice of event.interaction.choices) {
        if (choice.requires.length !== 0 || choice.check !== undefined) continue;
        for (const outcome of choice.outcomes) {
          const ctx = buildMatureHouse(family, event);
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(9954),
            targetWeightedOutcome: choice.outcomes.length > 1,
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id)
              + ' via mature ' + family.id + ': ' + (result.reason ?? 'no reason'),
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
        }
      }
    }

    expect(new Set(witnessed).size).toBe(witnessed.length);
  });
});


describe('campaign-clock TEST_FAMILIES fallback outcome witnesses', () => {
  function buildAtProgress(
    family: (typeof TEST_FAMILIES)[number],
    event: (typeof content.events)[number],
    progress: number,
  ) {
    const ctx = family.build(content);
    const campaign = campaignDef(ctx.world.campaign);
    ctx.world.year = campaign.startYear + Math.floor(campaign.years * progress);
    ctx.world.generation = Math.max(
      ctx.world.generation,
      10,
      FREQUENCY_PROFILES[event.frequency].minGeneration,
    );
    ctx.world.treasury = Math.max(ctx.world.treasury, 1_000);
    return ctx;
  }

  it('executes authored campaign-progress outcomes at real middle/late campaign clocks', () => {
    const progressPoints = [0.5, 0.8] as const;
    const witnessed: string[] = [];

    for (const event of content.events) {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.ages !== undefined
        || !JSON.stringify(event.conditions ?? []).includes('"campaignProgress"')
      ) continue;
      if (
        event.interaction.kind !== 'narration'
        && (
          event.interaction.decidedBy !== 'player'
          || event.interaction.choices.some((choice) => (
            choice.requires.length > 0 || choice.check !== undefined
          ))
        )
      ) continue;

      const match = progressPoints.flatMap((progress) =>
        TEST_FAMILIES.map((family) => ({ family, progress })))
        .find(({ family, progress }) => {
          const ctx = buildAtProgress(family, event, progress);
          if (!evalCondition(event.conditions, ctx)) return false;
          const slots = resolveSlots(event, ctx, makeRng(9961));
          if (!slots.ok || slots.playerCast.length) return false;
          return ambientPool(ctx).some((offered) => offered.id === event.id);
        });
      if (!match) continue;

      const interaction = event.interaction;
      const targets = interaction.kind === 'narration'
        ? interaction.outcomes.map((outcome) => ({
            choiceId: undefined as string | undefined,
            outcome,
            weighted: interaction.outcomes.length > 1,
          }))
        : interaction.choices.flatMap((choice) =>
            choice.outcomes.map((outcome) => ({
              choiceId: String(choice.id),
              outcome,
              weighted: choice.outcomes.length > 1,
            })));

      for (const target of targets) {
        const ctx = buildAtProgress(match.family, event, match.progress);
        const result = executeOutcomeWitness(ctx, event, {
          ...(target.choiceId ? { choiceId: target.choiceId } : {}),
          expectedOutcomeId: target.outcome.id,
          rng: makeRng(9962),
          ...(target.weighted ? { targetWeightedOutcome: true } : {}),
        });
        expect(
          result.ok,
          String(event.id) + '/' + String(target.outcome.id)
            + ' at campaign progress ' + String(match.progress)
            + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.length).toBeGreaterThan(0);
    expect(new Set(witnessed).size).toBe(witnessed.length);
  });
});

describe('mature-lean TEST_FAMILIES fallback outcome witnesses', () => {
  it('executes late-house outcomes whose real authored state needs a lean treasury', () => {
    const witnessed: string[] = [];

    for (const event of content.events) {
      if (
        // Capacity-specific forcing outcomes have their two-cast witnesses above.
        event.forcing !== undefined
        || event.tier === 'frame'
        || event.arc !== undefined
        || event.ages !== undefined
      ) continue;
      if (
        event.interaction.kind !== 'narration'
        && (
          event.interaction.decidedBy !== 'player'
          || event.interaction.choices.some((choice) => (
            choice.requires.length > 0 || choice.check !== undefined
          ))
        )
      ) continue;

      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          10,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.treasury = 100;
        if (!evalCondition(event.conditions, ctx)) return false;
        const slots = resolveSlots(event, ctx, makeRng(9971));
        if (!slots.ok || slots.playerCast.length) return false;
        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });
      if (!family) continue;

      const interaction = event.interaction;
      const targets = interaction.kind === 'narration'
        ? interaction.outcomes.map((outcome) => ({
            choiceId: undefined as string | undefined,
            outcome,
            weighted: interaction.outcomes.length > 1,
          }))
        : interaction.choices.flatMap((choice) =>
            choice.outcomes.map((outcome) => ({
              choiceId: String(choice.id),
              outcome,
              weighted: choice.outcomes.length > 1,
            })));

      for (const target of targets) {
        const ctx = family.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          10,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.treasury = 100;
        const result = executeOutcomeWitness(ctx, event, {
          ...(target.choiceId ? { choiceId: target.choiceId } : {}),
          expectedOutcomeId: target.outcome.id,
          rng: makeRng(9972),
          ...(target.weighted ? { targetWeightedOutcome: true } : {}),
        });
        expect(
          result.ok,
          String(event.id) + '/' + String(target.outcome.id)
            + ' via mature-lean ' + family.id + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.length).toBeGreaterThan(0);
  });
});

describe('late-generation Age TEST_FAMILIES fallback outcome witnesses', () => {
  it('executes simple single-Age outcomes after the shared household has matured', () => {
    const witnessed: string[] = [];

    for (const event of content.events) {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.record !== undefined
        || event.ages?.only?.length !== 1
        || event.ages.never !== undefined
        || event.ages.register !== undefined
        || event.interaction.kind === 'narration'
        || event.interaction.decidedBy !== 'player'
        || event.interaction.choices.some((choice) => (
          choice.requires.length > 0 || choice.check !== undefined
        ))
      ) continue;

      const age = event.ages.only[0]!;
      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          10,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.age.active = [{
          age,
          began: ctx.world.year,
          named: true,
          paid: { standing: false },
        }];
        if (!evalCondition(event.conditions, ctx)) return false;
        const slots = resolveSlots(event, ctx, makeRng(9981));
        if (!slots.ok || slots.playerCast.length) return false;
        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });
      if (!family) continue;

      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) {
          const ctx = family.build(content);
          ctx.world.generation = Math.max(
            ctx.world.generation,
            10,
            FREQUENCY_PROFILES[event.frequency].minGeneration,
          );
          ctx.world.age.active = [{
            age,
            began: ctx.world.year,
            named: true,
            paid: { standing: false },
          }];
          const result = executeOutcomeWitness(ctx, event, {
            choiceId: choice.id,
            expectedOutcomeId: outcome.id,
            rng: makeRng(9982),
            ...(choice.outcomes.length > 1 ? { targetWeightedOutcome: true } : {}),
          });
          expect(
            result.ok,
            String(event.id) + '/' + String(choice.id) + '/' + String(outcome.id)
              + ' via mature Age ' + family.id + ': ' + (result.reason ?? 'no reason'),
          ).toBe(true);
          if (result.key) witnessed.push(result.key);
        }
      }
    }

    expect(witnessed.length).toBeGreaterThan(0);
  });
});

describe('higher-ascension TEST_FAMILIES fallback outcome witnesses', () => {
  it('executes authored ascension-gated narration and player outcomes at Hierophant state', () => {
    const witnessed: string[] = [];

    for (const event of content.events) {
      if (
        event.tier === 'frame'
        || event.arc !== undefined
        || event.ages !== undefined
        || !JSON.stringify(event.conditions ?? []).includes('"ascension"')
      ) continue;
      if (
        event.interaction.kind !== 'narration'
        && (
          event.interaction.decidedBy !== 'player'
          || event.interaction.choices.some((choice) => (
            choice.requires.length > 0 || choice.check !== undefined
          ))
        )
      ) continue;

      const family = TEST_FAMILIES.find((candidate) => {
        const ctx = candidate.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          10,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.respect = 'eminent';
        ctx.world.ascension.rung = 'hierophant';
        ctx.world.ascension.best = 'hierophant';
        if (!evalCondition(event.conditions, ctx)) return false;
        const slots = resolveSlots(event, ctx, makeRng(9991));
        if (!slots.ok || slots.playerCast.length) return false;
        return ambientPool(ctx).some((offered) => offered.id === event.id);
      });
      if (!family) continue;

      const interaction = event.interaction;
      const targets = interaction.kind === 'narration'
        ? interaction.outcomes.map((outcome) => ({
            choiceId: undefined as string | undefined,
            outcome,
            weighted: interaction.outcomes.length > 1,
          }))
        : interaction.choices.flatMap((choice) =>
            choice.outcomes.map((outcome) => ({
              choiceId: String(choice.id),
              outcome,
              weighted: choice.outcomes.length > 1,
            })));

      for (const target of targets) {
        const ctx = family.build(content);
        ctx.world.generation = Math.max(
          ctx.world.generation,
          10,
          FREQUENCY_PROFILES[event.frequency].minGeneration,
        );
        ctx.world.respect = 'eminent';
        ctx.world.ascension.rung = 'hierophant';
        ctx.world.ascension.best = 'hierophant';
        const result = executeOutcomeWitness(ctx, event, {
          ...(target.choiceId ? { choiceId: target.choiceId } : {}),
          expectedOutcomeId: target.outcome.id,
          rng: makeRng(9992),
          ...(target.weighted ? { targetWeightedOutcome: true } : {}),
        });
        expect(
          result.ok,
          String(event.id) + '/' + String(target.outcome.id)
            + ' via high-ascension ' + family.id + ': ' + (result.reason ?? 'no reason'),
        ).toBe(true);
        if (result.key) witnessed.push(result.key);
      }
    }

    expect(witnessed.length).toBeGreaterThan(0);
  });
});

/**
 * Bramme's return must be an earned follow-up, not another improbable
 * ambient encounter. Keep these deterministic checks in the existing reach
 * suite rather than making the CI shard budget track another tiny test file.
 */
describe('the Bramme manuscript follow-up (#952)', () => {
  const fairCopy = content.events.find((e) => e.id === 'the_fair_copy');
  const margin = content.events.find((e) => e.id === 'the_bramme_margin_returns');
  if (!fairCopy || !margin) throw new Error('Bramme templates are missing');

  function sendToBramme(outcomeId: 'came_back' | 'read_before_returned') {
    const ctx = testWorld(content, 1093);
    ctx.world.generation = 3;
    place(ctx, { sex: 'female', age: 27, name: 'Bramme test copyist' });
    const result = executeOutcomeWitnessRaw(ctx, fairCopy!, {
      choiceId: 'send_it_to_bramme',
      expectedOutcomeId: outcomeId,
      targetWeightedOutcome: true,
      rng: makeRng(17),
    });
    expect(result.ok, result.reason).toBe(true);
    return ctx;
  }

  it('schedules the corrected page through the production outcome path', () => {
    const ctx = sendToBramme('came_back');
    const due = ctx.world.year + 20;
    expect(ctx.world.flags.get('bramme_copied_a_book')).toBe(true);
    expect(ctx.world.scheduled).toContainEqual({ event: margin!.id, year: due });

    ctx.world.year = due;
    ctx.world.generation = 4;
    const picked = selectEvents(ctx, makeRng(29), 1);
    expect(picked[0]?.event.id).toBe(margin!.id);
    expect(picked[0]?.source).toBe('forced');
  });

  it('defers the due callback until the authored fourth-generation gate holds', () => {
    const ctx = sendToBramme('came_back');
    const due = ctx.world.year + 20;

    // Twenty years is not necessarily a full generation. A forced callback
    // must not override its own generation requirement when the due year comes.
    ctx.world.year = due;
    ctx.world.generation = 3;
    const early = selectEvents(ctx, makeRng(37), 0);
    expect(early.some((candidate) => candidate.event.id === margin!.id)).toBe(false);
    expect(ctx.world.scheduled).toContainEqual({
      event: margin!.id, year: due + 5, first: due,
    });

    ctx.world.year = due + 5;
    ctx.world.generation = 4;
    const eligible = selectEvents(ctx, makeRng(38), 0);
    expect(eligible.map((candidate) => candidate.event.id)).toEqual([margin!.id]);
    expect(eligible[0]?.source).toBe('forced');
    expect(ctx.world.scheduled.some((s) => s.event === margin!.id)).toBe(false);
  });

  it('retires a due schedule if an earlier ambient draw already resolved the one-shot scene', () => {
    const ctx = sendToBramme('came_back');
    const due = ctx.world.year + 20;
    ctx.world.generation = 4;
    const resolved = executeOutcomeWitnessRaw(ctx, margin!, {
      choiceId: 'acknowledge_the_correction',
      expectedOutcomeId: 'bramme_knows',
      rng: makeRng(31),
    });
    expect(resolved.ok, resolved.reason).toBe(true);
    expect(ctx.world.frequency.templateFires[margin!.id]).toBeGreaterThan(0);

    ctx.world.year = due;
    const chosen = selectEvents(ctx, makeRng(31), 1);
    expect(chosen.some((c) => c.event.id === margin!.id)).toBe(false);
    expect(ctx.world.scheduled.some((e) => e.event === margin!.id)).toBe(false);
  });

  it('does not choose a nonrepeatable scheduled template twice in one year', () => {
    const ctx = sendToBramme('came_back');
    const scheduled = ctx.world.scheduled.find((e) => e.event === margin!.id);
    if (!scheduled) throw new Error('Bramme callback was not scheduled');
    ctx.world.scheduled.push({ ...scheduled });
    ctx.world.year = scheduled.year;
    ctx.world.generation = 4;
    const candidates = selectEvents(ctx, makeRng(47), 1);
    expect(candidates.filter((c) => c.event.id === margin!.id)).toHaveLength(1);
  });

  it('does not schedule a corrected-page visit after the other Bramme outcome', () => {
    const ctx = sendToBramme('read_before_returned');
    expect(ctx.world.flags.get('bramme_copied_a_book')).not.toBe(true);
    expect(ctx.world.scheduled.some((e) => e.event === margin!.id)).toBe(false);
  });
});

describe('#334 butts clause reader witnesses', () => {
  // The writer promises "nine years, and then there is a war". The reader is
  // its chained follow-up: due nine years on, and held by its own condition
  // until The Wars is the running Age.
  const rootId = 'the_butts_have_rotted';
  const readerId = 'the_clause_about_the_butts';
  const war = (ctx: ReturnType<typeof fixture>): ActiveAge => (
    { age: 'the_wars', began: ctx.world.year, named: true, paid: { standing: false } }
  );

  function leaveTheHawthorn(seed: number) {
    const ctx = fixture(seed);
    const year = ctx.world.year;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'leave_the_hawthorn', expectedOutcomeId: 'noted', rng: makeRng(seed + 1),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get('butts_at_wick_unkept')).toBe(true);
    const instance = [...ctx.world.arcs.values()].find((entry) =>
      content.arc(entry.arc)?.nodes.some((node) => node.event === readerId));
    if (!instance) throw new Error('leaving the butts did not schedule the clause');
    expect(instance.dueYear).toBe(year + 9);
    return { ctx, instance };
  }

  it('waits past its due year until a war is running', () => {
    const { ctx, instance } = leaveTheHawthorn(33450);
    ctx.world.age.active = [];
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, makeRng(33452))).toHaveLength(0);
    expect(instance.dueYear).toBeGreaterThan(ctx.world.year);
    ctx.world.year = instance.dueYear!;
    ctx.world.age.active = [war(ctx)];
    expect(dueArcSteps(ctx, makeRng(33453))[0]?.node.event).toBe(readerId);
  });

  it.each([
    { choice: 'pay_in_coin', outcome: 'paid_in_coin', cost: 30, unkept: false },
    { choice: 'send_them_as_they_are', outcome: 'sent_as_they_are', cost: 0, unkept: true },
  ])('executes $choice as the due arc step inside The Wars', ({ choice, outcome, cost, unkept }) => {
    const { ctx, instance } = leaveTheHawthorn(33460);
    const reader = content.mustEvent(readerId);
    ctx.world.year = instance.dueYear!;
    ctx.world.age.active = [war(ctx)];
    const step = dueArcSteps(ctx, makeRng(33461)).find((entry) => entry.instance.id === instance.id);
    if (!step) throw new Error('the clause never came due');
    const before = ctx.world.treasury;
    const result = executeOutcomeWitness(ctx, reader, {
      choiceId: choice, expectedOutcomeId: outcome, rng: makeRng(33462), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.treasury).toBe(before - cost);
    expect(ctx.world.flags.get('butts_at_wick_unkept')).toBe(unkept);
    expect(instance.status).toBe('ended');
  });

  it('is never scheduled by putting the butts right', () => {
    const ctx = fixture(33470);
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'put_them_right', expectedOutcomeId: 'shooting_again', rng: makeRng(33471),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.arcs.size).toBe(0);
  });
});

describe('#334 west wing roof witnesses', () => {
  // Patching promises to hold "until the wind comes round to the north": its
  // chained reader tests the patch. Slating is "a thing that stops happening":
  // the roof scene reads west_wing_slated and does not recur.
  const rootId = 'the_west_wing_roof';
  const readerId = 'the_north_wind_finds_the_patch';

  function patchIt(seed: number) {
    const ctx = fixture(seed);
    const year = ctx.world.year;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(rootId), {
      choiceId: 'patch_it_again', expectedOutcomeId: 'patched', rng: makeRng(seed + 1),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get('west_wing_patched_again')).toBe(true);
    const instance = [...ctx.world.arcs.values()].find((entry) =>
      content.arc(entry.arc)?.nodes.some((node) => node.event === readerId));
    if (!instance) throw new Error('patching the roof did not schedule the north wind');
    expect(instance.dueYear).toBeGreaterThanOrEqual(year + 3);
    expect(instance.dueYear).toBeLessThanOrEqual(year + 8);
    return { ctx, instance };
  }

  it.each([
    { choice: 'slate_it_now', outcome: 'slated_at_last', cost: 110, patched: false, slated: true },
    { choice: 'patch_it_once_more', outcome: 'patched_once_more', cost: 12, patched: true, slated: undefined },
  ])('executes $choice as the due arc step', ({ choice, outcome, cost, patched, slated }) => {
    const { ctx, instance } = patchIt(33480);
    ctx.world.year = instance.dueYear!;
    const step = dueArcSteps(ctx, makeRng(33482)).find((entry) => entry.instance.id === instance.id);
    if (!step) throw new Error('the north wind never came');
    const before = ctx.world.treasury;
    const result = executeOutcomeWitness(ctx, content.mustEvent(readerId), {
      choiceId: choice, expectedOutcomeId: outcome, rng: makeRng(33483), arcStep: step,
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.treasury).toBe(before - cost);
    expect(ctx.world.flags.get('west_wing_patched_again')).toBe(patched);
    expect(ctx.world.flags.get('west_wing_slated')).toBe(slated);
    expect(instance.status).toBe('ended');
  });

  it('withholds the north wind from a roof slated in the meantime', () => {
    const { ctx, instance } = patchIt(33490);
    ctx.world.flags.set('west_wing_slated', true);
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, makeRng(33491))).toHaveLength(0);
  });

  it('stops the roof scene recurring once the west wing is slated', () => {
    const ctx = fixture(33495);
    const root = content.mustEvent(rootId);
    expect(evalCondition(root.conditions, ctx)).toBe(true);
    const result = executeOutcomeWitnessRaw(ctx, root, {
      choiceId: 'hesk_properly', expectedOutcomeId: 'slated', rng: makeRng(33496),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get('west_wing_slated')).toBe(true);
    expect(ctx.world.arcs.size).toBe(0);
    expect(evalCondition(root.conditions, ctx)).toBe(false);
  });
});

describe('#334 timed-promise reader witnesses', () => {
  // Each writer outcome names when its consequence comes due. Each reader is
  // that outcome's chained beat, so it is witnessed the way it fires: the
  // writer resolved through the real outcome path, the beat scheduled inside
  // the promised window, shut without its key, and both answers executed as
  // the due arc step with their exact treasury and flag effects.
  const readers = [
    {
      writer: 'the_brewing_goes_wrong', choice: 'drink_the_water', outcome: 'nothing_happens', weighted: true,
      reader: 'the_water_was_fine_last_time', flag: 'the_house_drank_the_water', min: 35, max: 45,
      answers: [{ choice: 'buy_in_this_time', outcome: 'bought_in_this_time', cost: 14, kept: false },
        { choice: 'drink_the_well_again', outcome: 'the_flux_this_time', cost: 0, kept: true }],
    },
    {
      writer: 'a_man_who_drinks_standing', choice: 'let_him_stand', outcome: 'counted', weighted: false,
      reader: 'said_at_the_wrong_assize', flag: 'the_man_who_drank_standing', min: 28, max: 32,
      answers: [{ choice: 'answer_it', outcome: 'answered_at_the_assize', cost: 15, kept: false },
        { choice: 'let_it_stand', outcome: 'it_stood', cost: 0, kept: true }],
    },
    {
      writer: 'the_book_they_never_returned', choice: 'leave_it_on_their_shelf', outcome: 'left', weighted: false,
      reader: 'a_letter_to_cawdry_about_a_book', flag: 'the_lent_book_left_alone', min: 85, max: 95,
      answers: [{ choice: 'let_the_letter_go', outcome: 'the_letter_went', cost: 0, kept: false },
        { choice: 'send_a_rider', outcome: 'recalled', cost: 2, kept: true }],
    },
    {
      writer: 'the_relief_on_inheritance', choice: 'declare_short', outcome: 'short_return', weighted: false,
      reader: 'both_books_open', flag: 'the_short_return', min: 25, max: 35,
      answers: [{ choice: 'make_it_good', outcome: 'made_good', cost: 87, kept: false },
        { choice: 'declare_short_again', outcome: 'short_again', cost: 44, kept: true }],
    },
    {
      writer: 'the_visitation_of_the_archdeacon', choice: 'answer_all_eleven', outcome: 'the_ninth_question', weighted: true,
      reader: 'the_archdeacon_comes_back_early', flag: 'the_visitation_comes_back_early', min: 4, max: 4,
      answers: [{ choice: 'give_him_the_list', outcome: 'listed', cost: 0, kept: false },
        { choice: 'say_they_were_lent', outcome: 'said_lent', cost: 0, kept: true }],
    },
    {
      writer: 'the_visitation_of_the_archdeacon', choice: 'decline_the_ninth', outcome: 'declined_one', weighted: false,
      reader: 'the_archdeacon_comes_back_early', flag: 'the_visitation_comes_back_early', min: 4, max: 4,
      answers: [{ choice: 'give_him_the_list', outcome: 'listed', cost: 0, kept: false },
        { choice: 'say_they_were_lent', outcome: 'said_lent', cost: 0, kept: true }],
    },
    {
      writer: 'the_name_said_aloud', choice: 'it_is_a_skipping_rhyme', outcome: 'stood_ground', weighted: false,
      reader: 'a_different_office_asks', flag: 'the_rhyme_in_the_chapter_yard', min: 19, max: 19,
      answers: [{ choice: 'send_an_account', outcome: 'accounted', cost: 6, kept: false },
        { choice: 'let_the_entry_speak', outcome: 'entry_alone', cost: 0, kept: true }],
    },
    {
      writer: 'the_long_argument', choice: 'let_it_run', outcome: 'ran', weighted: false,
      reader: 'the_argument_nobody_told_him_about', flag: 'the_argument_went_underground', min: 20, max: 31,
      answers: [{ choice: 'hear_it_out', outcome: 'heard_out', cost: 0, kept: false },
        { choice: 'leave_it_buried', outcome: 'buried_again', cost: 0, kept: true }],
    },
  ] as const;

  function scheduled(entry: (typeof readers)[number], seed: number) {
    const ctx = fixture(seed);
    const year = ctx.world.year;
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent(entry.writer), {
      choiceId: entry.choice, expectedOutcomeId: entry.outcome,
      ...(entry.weighted ? { targetWeightedOutcome: true } : {}), rng: makeRng(seed + 1),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get(entry.flag)).toBe(true);
    const instance = [...ctx.world.arcs.values()].find((arc) =>
      content.arc(arc.arc)?.nodes.some((node) => node.event === entry.reader));
    if (!instance) throw new Error(`${entry.writer}/${entry.outcome} did not schedule ${entry.reader}`);
    expect(instance.dueYear).toBeGreaterThanOrEqual(year + entry.min);
    expect(instance.dueYear).toBeLessThanOrEqual(year + entry.max);
    return { ctx, instance };
  }

  for (const [index, entry] of readers.entries()) {
    it(`${entry.reader} from ${entry.writer}/${entry.outcome} is shut without ${entry.flag}`, () => {
      const ctx = fixture(33600 + index);
      expect(evalCondition(content.mustEvent(entry.reader).conditions, ctx)).toBe(false);
      ctx.world.flags.set(entry.flag, true);
      expect(evalCondition(content.mustEvent(entry.reader).conditions, ctx)).toBe(true);
    });

    for (const answer of entry.answers) {
      it(`${entry.reader} executes ${answer.choice} as the due step of ${entry.writer}/${entry.outcome}`, () => {
        const { ctx, instance } = scheduled(entry, 33620 + index * 10);
        ctx.world.year = instance.dueYear!;
        const step = dueArcSteps(ctx, makeRng(33700 + index)).find((due) => due.instance.id === instance.id);
        if (!step) throw new Error(`${entry.reader} never came due`);
        const before = ctx.world.treasury;
        const result = executeOutcomeWitness(ctx, content.mustEvent(entry.reader), {
          choiceId: answer.choice, expectedOutcomeId: answer.outcome, rng: makeRng(33710 + index), arcStep: step,
        });
        expect(result.ok, result.reason).toBe(true);
        expect(ctx.world.treasury).toBe(before - answer.cost);
        expect(ctx.world.flags.get(entry.flag)).toBe(answer.kept);
        expect(instance.status).toBe('ended');
      });
    }
  }

  for (const entry of readers.filter(row => row.writer === 'the_visitation_of_the_archdeacon')) {
    it(`${entry.choice}/${entry.outcome} preserves the four-year return across save/reload (#1906)`, () => {
      const { ctx, instance } = scheduled(entry, 190610);
      const restored = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      const pending = restored.world.arcs.get(instance.id)!;
      expect(pending.arc).toBe(instance.arc);
      expect(pending.dueYear).toBe(instance.dueYear);
      expect(restored.world.flags.get(entry.flag)).toBe(true);
      restored.world.year = pending.dueYear!;
      const step = dueArcSteps(restored, makeRng(190611)).find(due => due.instance.id === instance.id);
      expect(step?.node.event).toBe(entry.reader);
      const result = executeOutcomeWitnessRaw(restored, content.mustEvent(entry.reader), {
        choiceId: 'give_him_the_list', expectedOutcomeId: 'listed', arcStep: step, rng: makeRng(190612),
      });
      expect(result.ok, result.reason).toBe(true);
      expect(restored.world.flags.get(entry.flag)).toBe(false);
      expect(pending.status).toBe('ended');
    });
  }

  it('a satisfactory ninth answer leaves no early visitation pending (#1906)', () => {
    const ctx = fixture(190600);
    const result = executeOutcomeWitnessRaw(ctx, content.mustEvent('the_visitation_of_the_archdeacon'), {
      choiceId: 'answer_all_eleven', expectedOutcomeId: 'answered', targetWeightedOutcome: true, rng: makeRng(190601),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.flags.get('the_visitation_comes_back_early')).not.toBe(true);
    expect([...ctx.world.arcs.values()].some(arc => arc.status === 'active' &&
      content.arc(arc.arc)?.nodes.some(node => node.event === 'the_archdeacon_comes_back_early'))).toBe(false);
  });
});

describe('#334 reserved account execution witnesses', () => {
  const readers = [
    ['flag', 'a_late_entry_on_the_roll', 'the_two_days_of_birth'],
    ['flag', 'church_holds_a_copy', 'the_copy_comes_back_open'],
    ['flag', 'church_hostile', 'the_chapter_house_closes_its_door'],
    ['flag', 'the_church_sanctioned_the_rite', 'the_permission_is_read_back'],
    ['knowledge', 'knows_the_church_refused', 'the_answer_was_a_refusal'],
    ['flag', 'looted_library', 'the_three_volumes_are_sorted'],
    ['flag', 'married_without_paper', 'the_herald_asks_for_her_mother'],
    ['flag', 'paid_bracc_whole', 'the_factor_remembers_the_receipt'],
    ['flag', 'seal_held_sideways', 'the_sideways_seal_on_the_lease'],
    ['flag', 'steward_left_bitter', 'the_stewards_list_of_doors'],
    ['flag', 'the_archivist_was_refused', 'the_index_has_our_page'],
    ['flag', 'the_burgesses_have_a_grievance', 'the_grievance_reaches_the_assembly'],
    ['flag', 'the_customary_terms_were_written', 'the_son_brings_the_written_terms'],
    ['flag', 'the_elder_descent_not_produced', 'the_herald_opens_the_old_question'],
    ['flag', 'the_nine_libraries_burned', 'the_price_after_the_fires'],
    ['flag', 'the_second_cellar_shelf', 'the_cellar_shelf_is_found'],
    ['flag', 'the_stair_below_the_turn_bricked', 'the_mason_reaches_the_turn'],
    ['knowledge', 'knows_the_codex_went_east', 'the_codex_in_the_eastern_invoice'],
    ['knowledge', 'knows_the_quire_was_kept', 'the_quire_beside_the_descent'],
    ['knowledge', 'knows_the_seal_is_gone', 'the_business_without_the_seal'],
    ['knowledge', 'knows_the_third_room', 'the_old_list_reaches_the_cellar'],
    ['knowledge', 'knows_the_ward_was_married_in', 'the_ward_answers_cawdry'],
    ['knowledge', 'knows_what_the_case_book_holds', 'the_case_book_is_cited'],
    ['knowledge', 'knows_what_the_yssene_terms_were', 'the_fourth_yssene_clause'],
    ['knowledge', 'knows_what_was_never_said', 'the_daybook_has_a_witness'],
  ] as const;

  for (const [index, [kind, key, id]] of readers.entries()) {
    it(`${id} requires its reserved memory, including in an existing save`, () => {
      const ctx = fixture(34000 + index);
      ctx.world.year = 1330;
      ctx.world.generation = 10;
      const event = content.mustEvent(id);
      expect(evalCondition(event.conditions, ctx)).toBe(false);
      if (kind === 'flag') ctx.world.flags.set(key, true);
      else ctx.world.knowledge.add(key);
      const loaded = loadGame(saveGame(ctx), content);
      expect(evalCondition(event.conditions, loaded)).toBe(true);
      expect(ambientPool(loaded).some((candidate) => candidate.id === id)).toBe(true);
      if (kind === 'flag') loaded.world.flags.set(key, false);
      else loaded.world.knowledge.delete(key);
      expect(evalCondition(event.conditions, loaded)).toBe(false);
    });

    for (const mode of ['original', 'plainenglish'] as const) {
      for (const [choiceId, outcomeId] of [['answer_the_account', 'answered'], ['keep_our_terms', 'stood']] as const) {
        it(`${id}/${choiceId} executes and survives reload in ${mode}`, () => {
          const ctx = fixture(34100 + index);
          ctx.world.year = 1330;
          if (kind === 'flag') ctx.world.flags.set(key, true);
          else ctx.world.knowledge.add(key);
          setProseVariants(ctx, content.proseVariants);
          setProseMode(ctx, mode);
          ctx.world.scheduled.push({ event: id, year: ctx.world.year });
          expect(selectEvents(ctx, makeRng(34200 + index), 0).some((candidate) =>
            candidate.source === 'forced' && candidate.event.id === id)).toBe(true);
          const result = executeOutcomeWitness(ctx, content.mustEvent(id), {
            choiceId, expectedOutcomeId: outcomeId, rng: makeRng(34300 + index),
          });
          expect(result.ok, result.reason).toBe(true);
          expect(missingPlainEnglish(ctx)).toEqual([]);
          const saved = saveGame(ctx);
          const loaded = loadGame(saved, content);
          expect(canonical(saveGame(loaded))).toBe(canonical(saved));
          // A scheduled duplicate cannot repeat this one-shot consequence.
          loaded.world.scheduled.push({ event: id, year: loaded.world.year });
          expect(selectEvents(loaded, makeRng(34400 + index), 0).some((candidate) =>
            candidate.event.id === id)).toBe(false);
        });
      }
    }
  }

  it('keeps the dated wall and foreign-contract readings behind their promised years', () => {
    for (const [id, key, year, kind] of [
      ['the_mason_reaches_the_turn', 'the_stair_below_the_turn_bricked', 1330, 'flag'],
      ['the_fourth_yssene_clause', 'knows_what_the_yssene_terms_were', 1291, 'knowledge'],
    ] as const) {
      const ctx = fixture();
      if (kind === 'flag') ctx.world.flags.set(key, true);
      else ctx.world.knowledge.add(key);
      ctx.world.year = year - 1;
      expect(evalCondition(content.mustEvent(id).conditions, ctx)).toBe(false);
      ctx.world.year = year;
      expect(evalCondition(content.mustEvent(id).conditions, ctx)).toBe(true);
    }
  });
});

describe('#323 introduction execution witnesses', () => {
  it('commits both tale appointments and its own frame appointment through their production paths', () => {
    const ctx = bootstrap(content, 323, 1042, 'demo');
    const instance = [...ctx.world.arcs.values()][0]!;
    for (const [year, eventId, outcomeId] of [
      [1043, 'demo_the_empty_chair', 'the_hand_remains'],
      [1044, 'demo_the_last_page', 'the_page_is_offered'],
      [1045, 'demo_the_margin_keeps_its_colour', 'the_page_is_not_turned'],
    ] as const) {
      ctx.world.year = year;
      // The next year's normal succession phase refills the head after the
      // founder's authored crossing. No second death or succession model.
      if (year === 1044) phase('succession', ctx);
      const step = dueArcSteps(ctx, makeRng(year)).find((candidate) => candidate.instance.id === instance.id);
      expect(step?.node.event).toBe(eventId);
      if (!step) throw new Error('the introduction missed a dated appointment');
      const event = content.mustEvent(eventId);
      const request = { expectedOutcomeId: outcomeId, rng: makeRng(year + 1), arcStep: step };
      const result = event.tier === 'frame'
        ? executeFrameOutcomeWitness(ctx, event, request)
        : executeOutcomeWitness(ctx, event, request);
      expect(result.ok, result.reason).toBe(true);
    }
    expect(instance.status).toBe('ended');
    expect(ctx.world.people.get(ctx.world.narrator!)?.status).toBe('guardian');
    expect(ctx.world.frame.entries.at(-1)?.eventId).toBe('demo_the_margin_keeps_its_colour');
  });
});

describe('the late Long branch account (#1807)', () => {
  const launcher = content.mustEvent('the_old_branch_account');
  const arcId = 'arc_the_old_branch_account';
  const discrepancy = 'the_names_in_the_old_account';
  const branchId = 'late_long_cadet';

  function household(campaign: 'long' | 'short' | 'demo' = 'long', clauses = 4) {
    const ctx = bootstrap(content, 180700, 1042, campaign);
    const w = ctx.world;
    // Build the late house directly; no population or mortality batch is
    // needed to ask what a four-clause comparison unlocks.
    w.year = 1350;
    w.generation = 15;
    for (const p of w.people.living()) {
      p.castSlots = p.castSlots.filter((s) => s !== 'head');
      for (const membership of p.membership) if (membership.to === undefined && membership.kind === 'cadet') {
        membership.kind = 'blood';
        membership.branch = 'main';
      }
    }
    w.branches.clear();
    const head = place(ctx, { sex: 'female', age: 45, name: 'Maud of the Seat', castSlots: ['head'] });
    const cousin = place(ctx, { sex: 'male', age: 35, name: 'Alan of the Branch', branch: branchId });
    cousin.membership[0]!.kind = 'cadet';
    w.branches.set(branchId, {
      id: asId(branchId), house: asId(w.playerHouse), name: 'The Older Branch',
      founder: cousin.id, speaker: cousin.id, splitFrom: 'main', foundedYear: 1250, grievance: 40,
    });
    w.clausesRecovered.clear();
    for (const clause of content.clauses.slice(0, clauses)) w.clausesRecovered.add(clause.id);
    w.respect = 'eminent';
    setProseVariants(ctx, content.proseVariants);
    return { ctx, head, cousin };
  }

  it('requires Long, the post-Short centuries, four clauses and a castable adult branch member', () => {
    for (const campaign of ['short', 'demo'] as const) {
      const { ctx } = household(campaign);
      expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(false);
      for (const event of content.events.filter((e) => e.tags.includes('late_long'))) {
        const unavailable = executeOutcomeWitness(ctx, event, {
          choiceId: 'share_the_account', expectedOutcomeId: 'shared', rng: makeRng(1807),
        });
        expect(unavailable.ok).toBe(false);
        expect(unavailable.reason).toBe('event is outside this campaign');
      }
    }
    const { ctx, cousin } = household('long', 3);
    expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(false);
    ctx.world.clausesRecovered.add(content.clauses[3]!.id);
    ctx.world.year = 1342;
    expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(false);
    ctx.world.year = 1343;
    expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(true);
    expect(resolveSlots(launcher, ctx, makeRng(1807)).ok).toBe(true);
    cousin.born = ctx.world.year - 17;
    expect(resolveSlots(launcher, ctx, makeRng(1807)).ok).toBe(false);
    cousin.born = ctx.world.year - 35;
    ctx.world.branches.clear();
    expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(false);
    ctx.world.year = 1519;
    expect(evalCondition(launcher.conditions, ctx)).toBe(false);
  });

  for (const mode of ['original', 'plainenglish'] as const) {
    for (const share of [false, true]) for (const publish of [false, true]) for (const absent of [false, true])
      for (const pen of ['record', 'omit', 'embellish'] as const) {
      it(`remembers share=${share}, publish=${publish}, absent=${absent}, pen=${pen} in ${mode}`, () => {
        const { ctx, head, cousin } = household();
        setProseMode(ctx, mode);
        const first = executeOutcomeWitness(ctx, launcher, {
          choiceId: share ? 'share_the_account' : 'keep_the_seats_account',
          expectedOutcomeId: share ? 'shared' : 'withheld', rng: makeRng(180700),
        });
        expect(first.ok, first.reason).toBe(true);
        const instance = [...ctx.world.arcs.values()].find((a) => a.arc === arcId)!;
        expect(instance.bindings.KIN).toBe(cousin.id);
        expect(ctx.world.branches.get(branchId)?.grievance).toBe(share ? 22 : 58);
        expect(ctx.world.flags.get('late_long_account_shared')).toBe(share);
        expect(ambientPool(ctx).some((e) => e.id === launcher.id)).toBe(false);

        if (absent) {
          ctx.world.people.kill(cousin.id, ctx.world.year, 'before the next letter');
          const replacement = place(ctx, { sex: 'female', age: 30, name: 'Another Branch Cousin', branch: branchId });
          replacement.membership[0]!.kind = 'cadet';
        }
        function beat(year: number, eventId: string, choiceId: string, outcomeId: string) {
          ctx.world.year = year;
          const step = dueArcSteps(ctx, makeRng(180701)).find((s) => s.instance.id === instance.id)!;
          expect(step?.node.event).toBe(eventId);
          expect(step.absent).toBe(absent);
          // continue_absent preserves the historical binding. It must never
          // substitute the new cousin or apply a living-person consequence.
          expect(step.fill.KIN).toBe(cousin.id);
          const event = content.mustEvent(eventId);
          const body = renderBody(proseForEventBody(ctx, event, step.absent ? event.absentBody! : event.body), step.fill, ctx);
          expect(body).not.toMatch(/\{[A-Z_]+\}/);
          if (!absent) expect(body).toContain(cousin.name);
          else expect(body).toContain('cousin');
          const result = executeOutcomeWitness(ctx, event, {
            choiceId, expectedOutcomeId: outcomeId, arcStep: step, rng: makeRng(180702),
          });
          expect(result.ok, result.reason).toBe(true);
          if (event.record) {
            const page = [...ctx.world.chronicle].reverse().find((p) => p.eventId === eventId)!;
            const pending = queueRecord(ctx, event, page.id!, step.fill, choiceId, outcomeId)!;
            expect(resolveRecord(ctx, pending.id, pen).ok).toBe(true);
            expect(page.record).toBe(pen);
            if (pen === 'omit') expect(page.text).toBeNull();
            else expect(page.text).not.toMatch(/\{[A-Z_]+\}/);
          }
        }
        // The launcher commits after the annual arc phase, so entry is the
        // following year's tick. The next waits are seven and eleven years.
        beat(1351, 'the_other_hand_on_the_roll', share ? 'the_copies_were_shared' : 'the_copy_was_kept',
          share ? 'acknowledged' : 'compared_without_us');
        expect(instance.dueYear).toBe(1358);
        ctx.world.year = 1357;
        expect(dueArcSteps(ctx, makeRng(180701))).toEqual([]);
        const coins = ctx.world.treasury;
        beat(1358, 'the_packet_at_bramme', publish ? 'enter_the_names' : 'close_the_packet', publish ? 'entered' : 'closed');
        expect(ctx.world.treasury - coins).toBe(publish ? 0 : -90);
        expect(instance.localFlags.account_published).toBe(publish);
        expect(ctx.world.discrepancies.get(discrepancy)?.state).toBe(publish ? 'proven' : 'buried');
        expect(sentimentBetween(ctx.world, cousin.id, head.id)).toBe(0);
        expect(instance.dueYear).toBe(1369);
        const saved = saveGame(ctx);
        const loaded = loadGame(saved, content);
        setProseVariants(loaded, content.proseVariants);
        setProseMode(loaded, mode);
        expect(canonical(saveGame(loaded))).toBe(canonical(saved));

        beat(1369, 'the_account_nineteen_years_later', publish ? 'read_the_entry' : 'open_the_packet',
          publish ? 'the_entry_held' : 'the_other_copy_held');
        expect(instance.status).toBe('ended');
        expect(instance.history).toHaveLength(3);
        expect(ctx.world.discrepancies.get(discrepancy)?.state).toBe('proven');
        expect(ctx.world.branches.get(branchId)?.grievance).toBe(share ? 22 : 58);
        expect(sentimentBetween(ctx.world, cousin.id, head.id)).toBe(0);
        expect(ctx.world.chronicle.filter((p) => p.eventId && content.mustEvent(p.eventId).tags.includes('late_long'))
          .every((p) => !/\{[A-Z_]+\}/.test(p.text ?? ''))).toBe(true);
        loaded.world.year = 1369;
        const step = dueArcSteps(loaded, makeRng(180701)).find((s) => s.instance.id === instance.id)!;
        const last = executeOutcomeWitness(loaded, content.mustEvent('the_account_nineteen_years_later'), {
          choiceId: publish ? 'read_the_entry' : 'open_the_packet',
          expectedOutcomeId: publish ? 'the_entry_held' : 'the_other_copy_held', arcStep: step, rng: makeRng(180702),
        });
        expect(last.ok, last.reason).toBe(true);
        const lastPage = [...loaded.world.chronicle].reverse().find((p) => p.eventId === 'the_account_nineteen_years_later')!;
        const pending = queueRecord(loaded, content.mustEvent('the_account_nineteen_years_later'), lastPage.id!, step.fill,
          publish ? 'read_the_entry' : 'open_the_packet', publish ? 'the_entry_held' : 'the_other_copy_held')!;
        expect(resolveRecord(loaded, pending.id, pen).ok).toBe(true);
        expect(canonical(saveGame(loaded))).toBe(canonical(saveGame(ctx)));
        expect(missingPlainEnglish(ctx)).toEqual([]);
        expect(missingPlainEnglish(loaded)).toEqual([]);
      });
    }
  }
});

describe('the opening concern, witnessed through its own arc (#1867)', () => {
  const entry = content.mustEvent('the_tutors_good_years');
  it.each([
    { choice: 'teach_the_heir', taught: 'the_heir_is_taught', event: 'the_heir_reads_the_tally', outcome: 'the_three_sacks' },
    { choice: 'teach_the_waker', taught: 'the_waker_is_taught', event: 'the_daughter_at_the_fair', outcome: 'the_other_question' },
    { choice: 'teach_the_threshold', taught: 'the_threshold_is_taught', event: 'the_books_about_dying', outcome: 'the_carpenters_mother' },
    { choice: 'share_the_hours', taught: 'the_hours_are_shared', event: 'three_names_in_the_day_book', outcome: 'everybody_reads_the_bill' },
  ])('$choice, and three years on, $event', ({ choice, taught, event, outcome }) => {
    // The campaign's own bootstrap, not `testWorld`: the arc is started there.
    const ctx = bootstrap(content, 1867, 1042, 'long');
    const instance = [...ctx.world.arcs.values()].find((arc) => arc.arc === 'arc_the_tutors_good_years');
    if (!instance) throw new Error('the long campaign did not open on its concern');
    ctx.world.year += 1;
    const opening = dueArcSteps(ctx, makeRng(18670)).find((step) => step.instance.id === instance.id)!;
    const first = executeOutcomeWitness(ctx, entry, {
      choiceId: choice, expectedOutcomeId: taught, rng: makeRng(18671), arcStep: opening,
    });
    expect(first.ok, first.reason).toBe(true);
    expect(instance.dueYear).toBe(ctx.world.year + 3);
    ctx.world.year = instance.dueYear!;
    const step = dueArcSteps(ctx, makeRng(18672)).find((s) => s.instance.id === instance.id)!;
    expect(step.node.event).toBe(event);
    const second = executeOutcomeWitness(ctx, content.mustEvent(event), {
      expectedOutcomeId: outcome, rng: makeRng(18673), arcStep: step,
    });
    expect(second.ok, second.reason).toBe(true);
  });
});
