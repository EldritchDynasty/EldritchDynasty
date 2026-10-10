import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { AttributeId, ContentBundle, Outcome, TraitDef, TraitId } from '@ed/schema';
import { asId, proseOriginalHash } from '@ed/schema';
import {
  choiceAvailability, evalCheck, evalCondition, evalFilter, influencedAttr,
  pickOutcome, place, setProseMode, setProseVariants, testRng, testWorld, tickEconomy,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const content = loadContent();
const bundle = content.bundle;

/**
 * THE INFLUENCE MODIFIERS (issue #11). `ModifierS` declared eight kinds;
 * selection consumed two (`event_weight`, `suppress`); the other six sat in
 * the schema, authored in `traits.yaml`, read by nothing. This covers the
 * five given a consumer this issue — `check_bonus` (the mechanism is also
 * exercised in `checks.test.ts`; the real-content pairing is verified below),
 * `outcome_weight`, `unlock`, `resource`, and `attribute`. `reveal_signs`
 * stays unbuilt on purpose (no consumer until the record layer exists).
 */

/**
 * Synthetic traits, layered onto the real bundle, for the two `attribute`
 * targets `traits.yaml` does not currently author (`self`, `slot`) —
 * `the_tutors_aphorisms` already covers `children` with real content, and
 * `household` shares its code path with `children`.
 */
const selfBoost: TraitDef = {
  id: asId<TraitId>('test_self_boost'),
  name: 'Test Self Boost',
  tags: [],
  acquisition: { kind: 'assigned' },
  presence: [{ scope: 'household', modifiers: [{ kind: 'attribute', attr: asId<AttributeId>('charm'), delta: 50, target: 'self' }] }],
  dispatch: [],
};
const slotBoost: TraitDef = {
  id: asId<TraitId>('test_slot_boost'),
  name: 'Test Slot Boost',
  tags: [],
  acquisition: { kind: 'assigned' },
  presence: [],
  dispatch: [{ whenCastAs: ['head'], modifiers: [{ kind: 'attribute', attr: asId<AttributeId>('strength'), delta: 50, target: 'slot' }] }],
};
const withSynthetic: ContentBundle = { ...bundle, traits: [...bundle.traits, selfBoost, slotBoost] };

describe('influencedAttr', () => {
  it('self: boosts only the holder, not a housemate with the same genome', () => {
    const ctx = testWorld(withSynthetic);
    const holder = place(ctx, { sex: 'male', age: 30, traits: ['test_self_boost'], name: 'holder_test' });
    const housemate = place(ctx, { sex: 'male', age: 30, name: 'housemate_test' });

    const baseline = testWorld(withSynthetic);
    const holderTwin = place(baseline, { sex: 'male', age: 30, name: 'holder_test' });
    const housemateTwin = place(baseline, { sex: 'male', age: 30, name: 'housemate_test' });

    expect(influencedAttr(ctx, holder, 'charm')).toBe(influencedAttr(baseline, holderTwin, 'charm') + 50);
    expect(influencedAttr(ctx, housemate, 'charm')).toBe(influencedAttr(baseline, housemateTwin, 'charm'));
  });

  it('children: the tutor\'s aphorisms lift a household child\'s mind, not an adult\'s', () => {
    const baseline = testWorld(content);
    const baselineChild = place(baseline, { sex: 'male', age: 10, name: 'child_test' });
    const baselineAdult = place(baseline, { sex: 'male', age: 30, name: 'adult_test' });

    const ctx = testWorld(content);
    place(ctx, { sex: 'male', age: 45, traits: ['the_tutors_aphorisms'], name: 'tutor_test' });
    const child = place(ctx, { sex: 'male', age: 10, name: 'child_test' });
    const adult = place(ctx, { sex: 'male', age: 30, name: 'adult_test' });

    expect(influencedAttr(ctx, child, 'mind')).toBe(influencedAttr(baseline, baselineChild, 'mind') + 3);
    // Same tutor, same household — but an adult is not one of "the children he teaches".
    expect(influencedAttr(ctx, adult, 'mind')).toBe(influencedAttr(baseline, baselineAdult, 'mind'));
  });

  it('slot: applies only once the holder is cast into a whenCastAs role', () => {
    const ctx = testWorld(withSynthetic);
    const p = place(ctx, { sex: 'male', age: 30, traits: ['test_slot_boost'] });
    const uncast = influencedAttr(ctx, p, 'strength');
    expect(influencedAttr(ctx, p, 'strength', 'head')).toBe(uncast + 50);
    expect(influencedAttr(ctx, p, 'strength', 'retainer')).toBe(uncast);
  });
});

describe('evalCondition: unlocked', () => {
  it('is false until a household trait grants the string, true after', () => {
    const ctx = testWorld(content);
    expect(evalCondition({ unlocked: 'gate_watch' }, ctx)).toBe(false);
    place(ctx, { sex: 'male', age: 40, traits: ['keeps_a_night_watch'] });
    expect(evalCondition({ unlocked: 'gate_watch' }, ctx)).toBe(true);
    expect(evalCondition({ unlocked: 'something_else' }, ctx)).toBe(false);
  });
});

describe('evalFilter: attr honours a role-scoped attribute modifier', () => {
  it('only counts the slot bonus when the candidate is being evaluated for that role', () => {
    const ctx = testWorld(withSynthetic);
    const p = place(ctx, { sex: 'male', age: 30, traits: ['test_slot_boost'] });
    const base = influencedAttr(ctx, p, 'strength');
    expect(evalFilter({ attr: 'strength', op: 'gte', value: base + 40 }, p, ctx, {})).toBe(false);
    expect(evalFilter({ attr: 'strength', op: 'gte', value: base + 40 }, p, ctx, {}, 'retainer')).toBe(false);
    expect(evalFilter({ attr: 'strength', op: 'gte', value: base + 40 }, p, ctx, {}, 'head')).toBe(true);
  });
});

describe('choiceAvailability: Choice.requires reads the influenced attribute', () => {
  it('the_seal_questioned\'s strike choice opens once a slot-cast bonus clears the bar', () => {
    const ctx = testWorld(withSynthetic);
    const event = ctx.content.mustEvent('the_seal_questioned');
    if (event.interaction.kind === 'narration') throw new Error('unreachable');
    const strike = event.interaction.choices.find((c) => c.id === 'strike')!;

    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    const base = influencedAttr(ctx, head, 'strength', 'head');
    head.acquired.strength = 44 - base; // lands exactly one point under the choice's 45 threshold
    if (head.phenotype) head.phenotype.dirty = true;

    const withoutTrait = choiceAvailability(strike, ctx, { HEAD: head.id }, event);
    expect(withoutTrait.available).toBe(false);

    head.traits.add('test_slot_boost' as never); // +50 strength, once cast as `head`
    if (head.phenotype) head.phenotype.dirty = true;
    const withTrait = choiceAvailability(strike, ctx, { HEAD: head.id }, event);
    expect(withTrait.available).toBe(true);
  });
});

/**
 * WHY A CHOICE IS CLOSED is shown under it on the docket (#410). It printed the
 * attribute's content id and never switched with the prose setting.
 */
describe('choiceAvailability: the reason a choice is closed', () => {
  function closed(mode: 'original' | 'plainenglish') {
    const ctx = testWorld(withSynthetic);
    setProseVariants(ctx, [
      {
        address: coreMessageAddress('choice.blocked.attribute'),
        of: proseOriginalHash("{PERSON}'s {ATTRIBUTE} is {VALUE}"),
        plainenglish: '{PERSON} has {ATTRIBUTE} {VALUE}',
      },
      {
        address: coreMessageAddress('choice.blocked.uncast'),
        of: proseOriginalHash('nobody stands as {SLOT}'),
        plainenglish: 'no one is in the {SLOT} role',
      },
    ]);
    setProseMode(ctx, mode);
    const event = ctx.content.mustEvent('the_seal_questioned');
    if (event.interaction.kind === 'narration') throw new Error('unreachable');
    const strike = event.interaction.choices.find((c) => c.id === 'strike')!;
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'], name: 'Osric' });
    head.acquired.strength = 44 - influencedAttr(ctx, head, 'strength', 'head');
    if (head.phenotype) head.phenotype.dirty = true;
    return {
      short: choiceAvailability(strike, ctx, { HEAD: head.id }, event).blockedBy,
      uncast: choiceAvailability(strike, ctx, {}, event).blockedBy,
    };
  }

  it('names the attribute as the player sees it, not by its id', () => {
    expect(closed('original')).toEqual({ short: "Osric's Strength is 44", uncast: 'nobody stands as HEAD' });
  });

  it('switches with the prose setting', () => {
    expect(closed('plainenglish')).toEqual({ short: 'Osric has Strength 44', uncast: 'no one is in the HEAD role' });
  });
});

describe('pickOutcome: outcome_weight reweights matching outcomes', () => {
  it('a household trait matching an outcome\'s tag shifts the draw toward it', () => {
    const outcomes: Outcome[] = [
      { id: 'plain', weight: 100, text: 't', tags: [], effects: [] },
      { id: 'watchful', weight: 100, text: 't', tags: ['vigilance'], effects: [] },
    ];
    const N = 400;

    const baseline = testWorld(content);
    let watchfulBase = 0;
    for (let i = 0; i < N; i++) {
      if (pickOutcome(outcomes, testRng('base', i), baseline).id === 'watchful') watchfulBase += 1;
    }

    const withTrait = testWorld(content);
    place(withTrait, { sex: 'male', age: 40, traits: ['keeps_a_night_watch'] });
    let watchfulWith = 0;
    for (let i = 0; i < N; i++) {
      if (pickOutcome(outcomes, testRng('with', i), withTrait).id === 'watchful') watchfulWith += 1;
    }

    // Even weights draw roughly 50/50 unmodified; the trait's 1.8x should push
    // the modified proportion up by a wide, non-flaky margin.
    expect(watchfulBase / N).toBeGreaterThan(0.35);
    expect(watchfulBase / N).toBeLessThan(0.65);
    expect(watchfulWith / N).toBeGreaterThan(watchfulBase / N + 0.08);
  });
});

describe('tickEconomy: resource', () => {
  it('a per-year resource modifier lands in the report and in the treasury, on top of income and tithe', () => {
    // Same headcount in both worlds — an identically-named (so identically
    // genomed) retainer either way — so the only difference reaching `net`
    // is the resource modifier itself, not one extra mouth's upkeep.
    const without = testWorld(content);
    place(without, { sex: 'male', age: 40, name: 'gatekeeper_test' });
    const reportWithout = tickEconomy(without);
    expect(reportWithout.resource).toBe(0);

    const withTrait = testWorld(content);
    place(withTrait, { sex: 'male', age: 40, traits: ['keeps_the_tollgate'], name: 'gatekeeper_test' });
    const reportWith = tickEconomy(withTrait);
    expect(reportWith.resource).toBe(4);
    expect(reportWith.net).toBeCloseTo(reportWithout.net + 4, 5);
  });
});

describe('check_bonus: hard_hands pairs with the real gate_stand check', () => {
  /**
   * `hard_hands` acquires via a strength threshold the engine does not
   * actually enforce (no acquisition pipeline reads `threshold` — traits only
   * ever attach via a character template's `traits:` list, a founding
   * character, or a `trait` effect, and none of those name `hard_hands`). A
   * real blood Head holding it by the time `what_came_up_the_river_road`
   * fires is not reachable without a content-population effort well past
   * this issue's scope, so this is DIRECT CONSTRUCTION against the real trait
   * and the real authored check — the same "faithful shortcut"
   * `discrepancies.slow.test.ts` uses for the PRESSURE pass, not a bypass of
   * the mechanism.
   */
  it('adds its declared delta to a HEAD cast into a violence-tagged check', () => {
    const ctx = testWorld(content);
    const event = ctx.content.mustEvent('what_came_up_the_river_road');
    const check = event.checks.find((c) => c.id === 'gate_stand')!;

    const plainHead = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    const plain = evalCheck(ctx, check, event, { HEAD: plainHead.id }, testRng('x'));
    expect(plain.bonus).toBe(0);

    const armedCtx = testWorld(content);
    const head = place(armedCtx, { sex: 'male', age: 40, castSlots: ['head'], traits: ['hard_hands'] });
    const armed = evalCheck(armedCtx, check, event, { HEAD: head.id }, testRng('x'));
    expect(armed.bonus).toBe(12);
  });
});
