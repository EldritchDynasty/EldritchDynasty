import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { OutcomeS, type Outcome, type Person } from '@ed/schema';
import { outcomeAdmits, pickOutcome } from './events/effects.js';
import { phenotypeOf } from './people/factory.js';
import { place, testRng, testWorld } from './testing.js';
import type { SimCtx } from './world.js';

/**
 * AN OUTCOME THAT ASKS SOMETHING OF THE CAST (#1817).
 *
 * The forcing rites cast any boy of the blood and keep the waking for the boys
 * it can happen to. These are the engine's half of that promise: the guard
 * decides which outcomes are in the draw, and taking one out moves nothing
 * else — the same single `weighted` call, on the same stream.
 */
const content = loadContent();

function boy(ctx: SimCtx, expresses: boolean, stem: string): Person {
  for (let i = 0; i < 200; i++) {
    const p = place(ctx, { sex: 'male', age: 10, name: `${stem}${i}` });
    if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress === expresses) return p;
    ctx.world.people.kill(p.id, ctx.world.year, 'not the boy this test needs');
  }
  throw new Error(`no ${expresses ? 'expressing' : 'mundane'} ${stem} in 200 names`);
}

const outcome = (id: string, weight: number, onlyIf?: Outcome['onlyIf']): Outcome =>
  OutcomeS.parse({ id, weight, text: id, ...(onlyIf ? { onlyIf } : {}) });

const expresses = (v: boolean): Outcome['onlyIf'] => ({ slot: 'CHILD', filters: [{ canExpress: v }] });

describe('onlyIf (#1817)', () => {
  it('keeps each kind of boy to his own outcomes, whatever the dice', () => {
    const ctx = testWorld(content);
    const can = boy(ctx, true, 'Ash');
    const cannot = boy(ctx, false, 'Birch');
    const group = [
      outcome('woke', 50, expresses(true)),
      outcome('nothing', 50, expresses(true)),
      outcome('cold', 60, expresses(false)),
      outcome('drowned', 40, expresses(false)),
    ];
    const seen = { [can.id]: new Set<string>(), [cannot.id]: new Set<string>() };
    for (let i = 0; i < 400; i++) {
      for (const p of [can, cannot]) seen[p.id]!.add(pickOutcome(group, testRng('guard', i), ctx, { CHILD: p.id }).id);
    }
    expect([...seen[can.id]!].sort()).toEqual(['nothing', 'woke']);
    expect([...seen[cannot.id]!].sort()).toEqual(['cold', 'drowned']);
  });

  it('takes an outcome out of the draw without moving the draw', () => {
    // Paired seeds: the same group with and without an outcome this cast
    // cannot reach lands on the same outcome every time. A filter that
    // consumed a number, or a renormalisation that drew twice, would not.
    const ctx = testWorld(content);
    const cannot = boy(ctx, false, 'Birch');
    const plain = [outcome('cold', 60), outcome('drowned', 40)];
    const guarded = [outcome('woke', 500, expresses(true)), ...plain];
    for (let i = 0; i < 200; i++) {
      const fill = { CHILD: cannot.id };
      const a = pickOutcome(plain, testRng('pair', i), ctx, fill).id;
      const b = pickOutcome(guarded, testRng('pair', i), ctx, fill).id;
      expect(b, `seed ${i}`).toBe(a);
    }
  });

  it('admits an unguarded outcome for anybody and a guarded one for nobody uncast', () => {
    const ctx = testWorld(content);
    expect(outcomeAdmits(outcome('any', 1), ctx, {})).toBe(true);
    expect(outcomeAdmits(outcome('guarded', 1, expresses(true)), ctx, {})).toBe(false);
  });
});
