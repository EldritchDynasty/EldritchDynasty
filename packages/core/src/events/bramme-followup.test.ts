import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { makeRng } from '../rng.js';
import { place, testWorld } from '../testing.js';
import { executeOutcomeWitness } from './reach.js';
import { selectEvents } from './selection.js';

const content = loadContent();
const fairCopy = content.events.find((e) => e.id === 'the_fair_copy');
if (!fairCopy) throw new Error('the_fair_copy is missing from authored content');

const FOLLOW_UP = 'the_bramme_margin_returns';
const DELAY_YEARS = 20;

function sendBookToBramme(outcomeId: 'came_back' | 'read_before_returned') {
  const ctx = testWorld(content, 1093);
  ctx.world.generation = 3;
  place(ctx, { sex: 'female', age: 27, name: 'Copyist for the Bramme witness' });

  const result = executeOutcomeWitness(ctx, fairCopy!, {
    choiceId: 'send_it_to_bramme',
    expectedOutcomeId: outcomeId,
    targetWeightedOutcome: true,
    rng: makeRng(17),
  });
  expect(result.ok, result.reason).toBe(true);
  return ctx;
}

describe('Bramme manuscript callback (#952)', () => {
  it('schedules the corrected-page consequence instead of leaving it to another uncommon draw', () => {
    const ctx = sendBookToBramme('came_back');
    const dueYear = ctx.world.year + DELAY_YEARS;
    expect(ctx.world.flags.get('bramme_copied_a_book')).toBe(true);
    expect(ctx.world.scheduled).toContainEqual({ event: FOLLOW_UP, year: dueYear });

    // A generation later, the scheduled callback has priority over the
    // entire unrelated ambient pool, while retaining its authored identity.
    ctx.world.year = dueYear;
    ctx.world.generation = 4;
    const selected = selectEvents(ctx, makeRng(29), 1);
    expect(selected[0]?.event.id).toBe(FOLLOW_UP);
    expect(selected[0]?.source).toBe('forced');
  });

  it('does not repeat an earlier visit when its delayed schedule becomes due', () => {
    const ctx = sendBookToBramme('came_back');
    const dueYear = ctx.world.year + DELAY_YEARS;
    const margin = content.events.find((e) => e.id === FOLLOW_UP);
    if (!margin) throw new Error('Bramme margin template is missing');

    // The old ambient path can still fire before the scheduled due date.
    // A one-shot story must not appear a second time just because it was
    // promised by an earlier outcome.
    ctx.world.generation = 4;
    const resolved = executeOutcomeWitness(ctx, margin, {
      choiceId: 'acknowledge_the_correction',
      expectedOutcomeId: 'bramme_knows',
      rng: makeRng(31),
    });
    expect(resolved.ok, resolved.reason).toBe(true);
    expect(ctx.world.frequency.templateFires[FOLLOW_UP]).toBeGreaterThan(0);

    ctx.world.year = dueYear;
    const candidates = selectEvents(ctx, makeRng(31), 1);
    expect(candidates.some((c) => c.event.id === FOLLOW_UP)).toBe(false);
    expect(ctx.world.scheduled.some((s) => s.event === FOLLOW_UP)).toBe(false);
  });

  it('deduplicates simultaneous scheduled copies of the same one-shot scene', () => {
    const ctx = sendBookToBramme('came_back');
    const scheduled = ctx.world.scheduled.find((s) => s.event === FOLLOW_UP);
    if (!scheduled) throw new Error('Bramme callback was not scheduled');
    ctx.world.scheduled.push({ ...scheduled });
    ctx.world.year = scheduled.year;
    ctx.world.generation = 4;

    const candidates = selectEvents(ctx, makeRng(47), 1);
    expect(candidates.filter((c) => c.event.id === FOLLOW_UP)).toHaveLength(1);
  });

  it('does not promise a corrected-page visit for the different Bramme outcome', () => {
    const ctx = sendBookToBramme('read_before_returned');
    expect(ctx.world.flags.get('bramme_copied_a_book')).not.toBe(true);
    expect(ctx.world.scheduled.some((s) => s.event === FOLLOW_UP)).toBe(false);
  });
});
