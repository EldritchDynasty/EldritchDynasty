import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bynameStanding, bynameView, settleBynames } from './byname.js';
import { place, testWorld } from './testing.js';

const content = loadContent();
const LIE = 'the_early_waking_lie';

function telling(
  ctx: ReturnType<typeof testWorld>,
  person: ReturnType<typeof place>,
  page: string,
  year: number,
  discrepancy = LIE,
): void {
  person.epithet = 'the Early-Woken';
  person.byname = {
    source: { kind: 'record', event: 'waking_early', pen: 'embellish', page, discrepancy },
    year,
  };
  ctx.world.chronicle.push({
    id: page, year, weight: 'paragraph', named: false,
    text: 'The house wrote a flattering account.',
    record: 'embellish', discrepancyId: discrepancy,
    claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 1 }],
  });
}

describe('byname settlement respects the present Chronicle year (#2673)', () => {
  it('settles only the latest eligible telling and preserves earlier settlements', () => {
    const ctx = testWorld(content, 2673, 1042);
    const earlier = place(ctx, { sex: 'male', age: 25 });
    const current = place(ctx, { sex: 'male', age: 24 });
    const future = place(ctx, { sex: 'male', age: 23 });
    const unrelated = place(ctx, { sex: 'female', age: 22 });

    telling(ctx, earlier, 'past_telling', 1041);
    telling(ctx, current, 'current_telling', 1042);
    telling(ctx, future, 'future_telling', 1043);
    telling(ctx, unrelated, 'other_telling', 1042, 'another_lie');

    const pagesBefore = structuredClone(ctx.world.chronicle);
    const decisionsBefore = structuredClone(ctx.world.decisionLog);
    settleBynames(ctx, LIE, 'proven');

    expect(bynameStanding(earlier)).toBe('claimed');
    expect(current.byname?.settled).toEqual({ state: 'proven', year: 1042 });
    expect(bynameStanding(current)).toBe('contested');
    expect(bynameStanding(future)).toBe('claimed');
    expect(bynameStanding(unrelated)).toBe('claimed');

    // The imported future page becomes admissible in its own year, without
    // retroactively changing the settlement of the preceding telling.
    ctx.world.year = 1043;
    settleBynames(ctx, LIE, 'buried');
    expect(future.byname?.settled).toEqual({ state: 'buried', year: 1043 });
    expect(bynameStanding(future)).toBe('buried');
    expect(current.byname?.settled).toEqual({ state: 'proven', year: 1042 });
    expect(earlier.byname?.settled).toBeUndefined();
    expect(unrelated.byname?.settled).toBeUndefined();
    expect(ctx.world.chronicle).toEqual(pagesBefore);
    expect(ctx.world.decisionLog).toEqual(decisionsBefore);
  });

  it('does not settle a future-only telling before it has happened', () => {
    const ctx = testWorld(content, 2674, 1042);
    const child = place(ctx, { sex: 'female', age: 9 });
    telling(ctx, child, 'only_future_telling', 1043);
    settleBynames(ctx, LIE, 'proven');
    expect(child.byname?.settled).toBeUndefined();

    ctx.world.year = 1043;
    settleBynames(ctx, LIE, 'proven');
    expect(child.byname?.settled).toEqual({ state: 'proven', year: 1043 });
  });
  it('does not reveal a future settlement in current-year byname views (#2715)', () => {
    const ctx = testWorld(content, 2715, 1042);
    const relative = place(ctx, { sex: 'male', age: 25 });
    telling(ctx, relative, 'already_written', 1042);
    const pagesBefore = structuredClone(ctx.world.chronicle);

    for (const [state, eventualStanding] of [
      ['proven', 'contested'], ['buried', 'buried'],
    ] as const) {
      relative.byname!.settled = { state, year: 1043 };
      const grantBefore = structuredClone(relative.byname);

      expect(bynameStanding(relative, 1042)).toBe('claimed');
      expect(bynameView(relative, 1042)).toEqual({
        text: 'the Early-Woken', standing: 'claimed', year: 1042, page: 'already_written',
      });
      // Callers requiring an unbounded historical reading retain the old API.
      expect(bynameStanding(relative)).toBe(eventualStanding);
      expect(bynameView(relative, 1043)).toEqual({
        text: 'the Early-Woken', standing: eventualStanding,
        year: 1042, page: 'already_written', settledYear: 1043,
      });
      expect(relative.byname).toEqual(grantBefore);
    }

    expect(ctx.world.chronicle).toEqual(pagesBefore);
  });

});
