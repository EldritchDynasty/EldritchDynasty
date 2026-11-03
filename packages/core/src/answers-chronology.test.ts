import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { digestOf } from '@ed/core';
import { bootstrap } from './sim.js';
import { proseForClause } from './prose.js';
import { answerPages, answers, answerYears, clauseYears, glimpseYears, lastAnswerYear } from './events/answers.js';

const content = loadContent();

/**
 * Imported/inconsistent testimony dated after the current world year must not
 * shorten the frame's silence or decorate a Chronicle page as a prior answer.
 * None of these read-only functions should edit the stored account.
 */
describe('answer chronology (#2671)', () => {
  it('does not recognize a recovered clause page until it has been written', () => {
    const ctx = bootstrap(content, 4242, 1042);
    const clause = content.clauses.find((c) => !c.known)!;
    const prose = proseForClause(ctx, clause);
    ctx.world.clausesRecovered.add(clause.id);
    ctx.world.chronicle.push({
      id: 'chr_future_clause', year: 1043, weight: 'illuminated',
      title: prose.name, text: prose.text, named: true,
    });

    const before = digestOf(ctx);
    expect(clauseYears(ctx)).toEqual([]);
    expect(answers(ctx)).toEqual([]);
    expect(answerPages(ctx).has('chr_future_clause')).toBe(false);
    expect(lastAnswerYear(ctx)).toBe(1042);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = 1043;
    expect(clauseYears(ctx)).toEqual([1043]);
    expect(answers(ctx)).toEqual([{ year: 1043, kind: 'clause', page: 'chr_future_clause' }]);
    expect(answerPages(ctx).get('chr_future_clause')).toBe('clause');
    expect(lastAnswerYear(ctx)).toBe(1043);
  });

  it('does not count or mark a future glimpse until the logged outcome occurs', () => {
    const ctx = bootstrap(content, 4242, 1042);
    const event = 'the_heir_reads_the_tally';
    const outcomeId = 'the_three_sacks';
    ctx.world.chronicle.push({
      id: 'chr_future_glimpse', year: 1043, weight: 'paragraph',
      text: 'The family learned about the debt.', eventId: event, named: false,
    });
    ctx.world.decisionLog.push({
      kind: 'outcome', year: 1043, event, outcomeId, fill: {},
    });

    const before = digestOf(ctx);
    expect(glimpseYears(ctx)).toEqual([]);
    expect(answers(ctx)).toEqual([]);
    expect(answerPages(ctx).has('chr_future_glimpse')).toBe(false);
    expect(lastAnswerYear(ctx)).toBe(1042);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = 1043;
    expect(glimpseYears(ctx)).toEqual([1043]);
    expect(answers(ctx)).toEqual([{
      year: 1043, kind: 'glimpse', event, page: 'chr_future_glimpse',
    }]);
    expect(answerPages(ctx).get('chr_future_glimpse')).toBe('glimpse');
    expect(lastAnswerYear(ctx)).toBe(1043);
  });

  it('excludes future frame interludes while retaining earlier answers and their order', () => {
    const ctx = bootstrap(content, 4242, 1042);
    ctx.world.frame.entries.push(
      { year: 1042, eventId: 'frame_first', outcomeId: 'first', text: 'A prior answer.' },
      { year: 1043, eventId: 'frame_second', outcomeId: 'second', text: 'A future answer.' },
    );

    const before = digestOf(ctx);
    expect(answers(ctx)).toEqual([
      { year: 1042, kind: 'interlude', event: 'frame_first' },
    ]);
    expect(answerYears(ctx)).toEqual([1042]);
    expect(answers(ctx, 1042)).toEqual([]);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = 1043;
    expect(answers(ctx)).toEqual([
      { year: 1042, kind: 'interlude', event: 'frame_first' },
      { year: 1043, kind: 'interlude', event: 'frame_second' },
    ]);
    expect(answers(ctx, 1042)).toEqual([
      { year: 1043, kind: 'interlude', event: 'frame_second' },
    ]);
  });
});
