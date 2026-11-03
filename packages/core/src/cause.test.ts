import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { answeredBy, causeOf } from './cause.js';
import { addGrudge } from './people/relationships.js';
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

    expect(causeOf(ctx, answer)).toBeUndefined();
    expect(answeredBy(ctx, first)).toEqual([]);
    ctx.world.year = 1045;
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
    ctx.world.year = 1045;
    ctx.world.chronicle.find((page) => page.id === answer)!.cause = {
      year: 1042, page: second,
    };
    expect(causeOf(ctx, answer)).toEqual({ year: 1042, page: second, blank: false });
    expect(answeredBy(ctx, second)).toEqual([1045]);
    expect(answeredBy(ctx, first)).toEqual([]);
  });
  it('ignores a future duplicate until it makes the present discrepancy ambiguous', () => {
    const ctx = testWorld(content, 2675, 1042);
    const discrepancy = 'the_early_waking_lie';
    ctx.world.chronicle.push(
      {
        id: 'present_origin', year: 1042, weight: 'paragraph', text: 'The first account.',
        named: false, record: 'embellish', discrepancyId: discrepancy,
      },
      {
        id: 'present_answer', year: 1042, weight: 'line', text: 'The proof arrived.',
        named: false, discrepancyId: discrepancy,
      },
      {
        id: 'future_duplicate', year: 1043, weight: 'paragraph', text: 'A later account.',
        named: false, record: 'embellish', discrepancyId: discrepancy,
      },
    );
    ctx.world.discrepancies.set(discrepancy, {
      severity: 'minor', provableBy: ['the_church'], state: 'proven',
    });
    const before = structuredClone(ctx.world.chronicle);
    const cause = { year: 1042, page: 'present_origin', blank: false };

    expect(causeOf(ctx, discrepancy)).toEqual(cause);
    expect(causeOf(ctx, 'present_answer')).toEqual(cause);
    expect(causeOf(ctx, 'future_duplicate')).toBeUndefined();
    expect(answeredBy(ctx, 'present_origin')).toEqual([1042]);

    ctx.world.year = 1043;
    expect(causeOf(ctx, discrepancy)).toBeUndefined();
    expect(causeOf(ctx, 'present_answer')).toBeUndefined();
    expect(answeredBy(ctx, 'present_origin')).toEqual([]);
    expect(ctx.world.chronicle).toEqual(before);
  });

});


describe('Chronicle cause chronology (#2710)', () => {
  it('does not read an explicit cause dated after its consequence, even once that year arrives', () => {
    const ctx = testWorld(content, 2710, 1042);
    ctx.world.chronicle.push(
      {
        id: 'early_consequence', year: 1042, weight: 'line',
        text: 'A consequence written before its cause.', named: false,
        cause: { year: 1048, page: 'late_source' },
      },
      {
        id: 'late_source', year: 1048, weight: 'line',
        text: 'A later source.', named: false,
      },
    );
    const before = structuredClone(ctx.world.chronicle);

    expect(causeOf(ctx, 'early_consequence')).toBeUndefined();
    expect(answeredBy(ctx, 'late_source')).toEqual([]);
    ctx.world.year = 1048;
    expect(causeOf(ctx, 'early_consequence')).toBeUndefined();
    expect(answeredBy(ctx, 'late_source')).toEqual([]);
    expect(ctx.world.chronicle).toEqual(before);
  });

  it('does not surface a future grudge origin until its recorded year', () => {
    const ctx = testWorld(content, 2711, 1042);
    ctx.world.chronicle.push({
      id: 'late_quarrel', year: 1048, weight: 'paragraph',
      text: 'The quarrel was written in a later year.', named: false,
    });
    const grudge = addGrudge(ctx, 'a_rival_house', ctx.world.playerHouse,
      { severity: 60, inheritance: 'house_wide' }, 'unrecorded', 'late_quarrel');
    grudge.originYear = 1048; // A recovered/imported entry dated after the restored clock.
    const before = structuredClone([...ctx.world.relationships.values()]);

    expect(causeOf(ctx, grudge.id)).toBeUndefined();
    ctx.world.year = 1048;
    expect(causeOf(ctx, grudge.id))
      .toEqual({ year: 1048, page: 'late_quarrel', blank: false });
    expect([...ctx.world.relationships.values()]).toEqual(before);
  });
});
