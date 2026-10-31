import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { answeredBy, causeOf } from './cause.js';
import { testWorld } from './testing.js';

const content = loadContent();

function repeatedRecordWitness() {
  const ctx = testWorld(content, 1990, 1042);
  const discrepancyId = 'the_early_waking_lie';
  const first = 'waking_first_child';
  const second = 'waking_second_child';
  const answer = 'waking_later_proof';

  // Both pages claim a different incident, but share the same authored
  // Discrepancy id. Their *page* identities remain unique.
  for (const page of [first, second]) {
    ctx.world.chronicle.push({
      id: page, year: 1042, weight: 'paragraph', text: 'The child woke early.',
      named: false, record: 'embellish', discrepancyId,
    });
  }
  ctx.world.chronicle.push({
    id: answer, year: 1045, weight: 'line', text: 'A later witness answered the claim.',
    named: false, discrepancyId,
  });
  ctx.world.discrepancies.set(discrepancyId, {
    severity: 'minor', provableBy: ['the_church'], state: 'proven',
  });
  return { ctx, discrepancyId, first, second, answer };
}

describe('Chronicle cause provenance for repeated authored Discrepancies (#1990)', () => {
  it('links a proved unique authored id back to its sole recorded origin', () => {
    const { ctx, discrepancyId, first, second, answer } = repeatedRecordWitness();
    ctx.world.chronicle = ctx.world.chronicle.filter((page) => page.id !== second);
    const cause = { year: 1042, page: first, blank: false };

    expect(causeOf(ctx, discrepancyId)).toEqual(cause);
    expect(causeOf(ctx, answer)).toEqual(cause);
    expect(answeredBy(ctx, first)).toEqual([1045]);

    ctx.world.discrepancies.get(discrepancyId)!.state = 'open';
    expect(causeOf(ctx, answer)).toBeUndefined();
    expect(answeredBy(ctx, first)).toEqual([]);
  });

  it('does not invent an origin when two embellished pages share the authored id', () => {
    const { ctx, discrepancyId, first, second, answer } = repeatedRecordWitness();

    expect(causeOf(ctx, discrepancyId)).toBeUndefined();
    expect(causeOf(ctx, second)).toBeUndefined();
    expect(causeOf(ctx, answer)).toBeUndefined();
    expect(answeredBy(ctx, first)).toEqual([]);
    expect(answeredBy(ctx, second)).toEqual([]);

    // Burying changes the state but does not resolve which occurrence it
    // belonged to. An explicitly saved page-to-page cause remains reliable.
    ctx.world.discrepancies.get(discrepancyId)!.state = 'buried';
    expect(causeOf(ctx, answer)).toBeUndefined();
    ctx.world.chronicle.find((page) => page.id === answer)!.cause = {
      year: 1042, page: second,
    };
    expect(causeOf(ctx, answer)).toEqual({ year: 1042, page: second, blank: false });
    expect(answeredBy(ctx, second)).toEqual([1045]);
    expect(answeredBy(ctx, first)).toEqual([]);
  });
});
