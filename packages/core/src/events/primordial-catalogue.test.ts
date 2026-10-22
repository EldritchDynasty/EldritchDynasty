import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { potentialHarms, RESPECT_ORDER, type EventTemplate, type Outcome } from '@ed/schema';
import { assessHarm, mitigates } from './harm.js';
import { testWorld, place } from '../testing.js';
import { resolveTargets } from './effects.js';
import { outcomeTextAddress } from '../prose.js';
import { declaredInterventions } from './reach.js';

const content = loadContent();
describe('authored emergency bundles (#1868)', () => {
  it('inventories each committed rescue separately from its normal branch', () => {
    const declarations = declaredInterventions(content);
    const outcomes = content.events.flatMap(e => e.interaction.kind === 'narration' ? e.interaction.outcomes : e.interaction.choices.flatMap(c => c.outcomes));
    expect(declarations).toHaveLength(outcomes.filter(o => o.primordial).length);
    expect(declarations.every(row => row.key !== row.normalKey)).toBe(true);
    expect(new Set(declarations.map(row => row.key)).size).toBe(declarations.length);
  });
  for (const event of content.events) {
    const groups = event.interaction.kind === 'narration' ? [{ id: '_', outcomes: event.interaction.outcomes }] : event.interaction.choices;
    for (const choice of groups) for (const normal of choice.outcomes) {
      if (!normal.primordial) continue;
      const final = normal.primordial;
      it(`${event.id}/${choice.id}/${normal.id}: assessed material reduction`, () => {
        const ctx = testWorld(content);
        ctx.world.treasury = .5;
        ctx.world.respect = RESPECT_ORDER.at(-1)!;
        // Bundle witnesses exercise the actual effect algebra. Cast/selection
        // witnesses remain the production reach suite; these are not claims
        // that a distant, empty incident site can ever supply an actor.
        for (const p of ctx.world.people.all()) p.castSlots = p.castSlots.filter(role => role !== 'head');
        const fill: Record<string, string> = {};
        for (const [slot, spec] of Object.entries(event.slots)) {
          const p = place(ctx, { name: `Witness ${slot}`, sex: 'male', age: 30, castSlots: spec.role === 'head' ? ['head'] : [] });
          fill[slot] = p.id;
        }
        for (const effect of normal.effects) {
          if (effect.kind === 'land') {
            const state = [...ctx.world.parcels.values()].find(s => s.defId === effect.parcel);
            if (state) state.yieldBonus = (effect.magnitude ?? 2) * .75 - (ctx.content.parcel(effect.parcel)?.baseYield ?? 0);
          }
          if (effect.kind === 'spellbook') {
            const copy = { id: effect.book, acquiredYear: ctx.world.year, condition: 10 };
            ctx.world.library.set(effect.book, copy);
            if (effect.op === 'lose') for (const p of resolveTargets(effect.target, ctx, fill)) p.spellsKnown.push(effect.book as never);
          }
        }
        const landTargets = new Set(normal.effects.flatMap(e => e.kind === 'land' ? [e.parcel] : []));
        if (landTargets.size) for (const [key, state] of ctx.world.parcels) if (!landTargets.has(state.defId ?? '')) ctx.world.parcels.delete(key);
        const libraryTargets = new Set(normal.effects.flatMap(e => e.kind === 'spellbook' ? [e.book] : []));
        if (libraryTargets.size) for (const key of ctx.world.library.keys()) if (!libraryTargets.has(key)) ctx.world.library.delete(key);
        const before = assessHarm(ctx, normal, fill);
        const after = assessHarm(ctx, final, fill);
        if (before.categories.length) expect(mitigates(before, after)).toBe(true);
        // Conservative potential inventory may also include minor physical
        // wear: an ordinary ruined copy remains readable and is not a loss.
        else expect(potentialHarms(normal)).toContain('inheritance');
        if (before.categories.includes('political')) for (const tier of RESPECT_ORDER) {
          ctx.world.respect = tier;
          const clamped = assessHarm(ctx, normal, fill);
          if (clamped.categories.includes('political')) expect(mitigates(clamped, assessHarm(ctx, final, fill)), tier).toBe(true);
        }
        expect(final.text).toContain('{PRIMORDIAL_ACTOR}');
        const address = outcomeTextAddress(ctx, event, normal, choice.id === '_' ? undefined : choice.id)?.replace(/\.text$/, '.primordial.text');
        expect(content.proseVariants.find(row => row.address === address)?.plainenglish).toContain('{PRIMORDIAL_ACTOR}');
      });
    }
  }
});
