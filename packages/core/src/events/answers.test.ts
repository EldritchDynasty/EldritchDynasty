import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { outcomesOf, type ContentBundle, type Outcome } from '@ed/schema';
import { bootstrap, stepYear } from '../sim.js';
import { proseForClause } from '../prose.js';
import { FRAME_ANSWER_GAP_YEARS, frameOverdue } from './frame.js';
import { GLIMPSE_TAG, answerYears, clauseYears, glimpseYears, isGlimpse, lastAnswerYear } from './answers.js';

const bundle = loadContent();
const START = 1042;

/** The tutor's four three-year follow-ups, each carrying the first glimpse (#1867 §6). */
const FOLLOW_UPS: Record<string, string> = {
  the_heir_reads_the_tally: 'the_three_sacks',
  the_daughter_at_the_fair: 'the_other_question',
  the_books_about_dying: 'the_carpenters_mother',
  three_names_in_the_day_book: 'everybody_reads_the_bill',
};

/** The shipped bundle with the follow-ups' outcomes tagged, and nothing else changed. */
function tagged(source: ContentBundle): ContentBundle {
  return {
    ...source,
    events: source.events.map((e) => {
      const outcome = FOLLOW_UPS[e.id];
      if (!outcome) return e;
      const tag = (o: Outcome): Outcome => (o.id === outcome ? { ...o, tags: [...o.tags, GLIMPSE_TAG] } : o);
      const i = e.interaction;
      return i.kind === 'narration'
        ? { ...e, interaction: { ...i, outcomes: i.outcomes.map(tag) } }
        : { ...e, interaction: { ...i, choices: i.choices.map((c) => ({ ...c, outcomes: c.outcomes.map(tag) })) } };
    }),
  };
}

const glimpsing = tagged(bundle.bundle);

function world(source: ContentBundle | typeof bundle, year: number) {
  const ctx = bootstrap(source, 4242, START);
  ctx.world.year = year;
  return ctx;
}

/** A logged outcome, as `commitOutcome` writes one. */
function logOutcome(ctx: ReturnType<typeof bootstrap>, year: number, event: string, outcomeId: string) {
  ctx.world.decisionLog.push({ kind: 'outcome', year, event, outcomeId, fill: {} });
}

/**
 * A GLIMPSE IS AN ANSWER (#1897 option (c)).
 *
 * The frame's answer ceiling (#1904) counted interludes and clause pages. An
 * authored glimpse tells the player something new about the bargain as well,
 * and until it carried a mark neither the ceiling nor `gate:long` could see
 * one, so a run the player heard from was measured as silent.
 */
describe('an authored glimpse answers the player', () => {
  it('reads the tag off the outcome, and nothing else', () => {
    const ctx = world(glimpsing, START);
    expect(isGlimpse(ctx, 'the_heir_reads_the_tally', 'the_three_sacks')).toBe(true);
    expect(isGlimpse(ctx, 'the_heir_reads_the_tally', 'no_such_outcome')).toBe(false);
    expect(isGlimpse(ctx, 'no_such_event', 'the_three_sacks')).toBe(false);
    expect(isGlimpse(world(bundle, START), 'the_heir_reads_the_tally', 'the_three_sacks'),
      'the untagged bundle has no glimpse here').toBe(false);
  });

  it('counts a logged glimpse as the last answer, and keeps the frame on its roll', () => {
    const ctx = world(glimpsing, START + FRAME_ANSWER_GAP_YEARS + 10);
    expect(frameOverdue(ctx), 'silent since the signing').toBe(true);
    logOutcome(ctx, START + 30, 'the_heir_reads_the_tally', 'the_three_sacks');
    expect(glimpseYears(ctx)).toEqual([START + 30]);
    expect(lastAnswerYear(ctx)).toBe(START + 30);
    expect(frameOverdue(ctx)).toBe(false);
    ctx.world.year = START + 30 + FRAME_ANSWER_GAP_YEARS;
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('does not take an untagged outcome for one', () => {
    const ctx = world(glimpsing, START + FRAME_ANSWER_GAP_YEARS + 10);
    logOutcome(ctx, START + 30, 'the_heir_reads_the_tally', 'no_such_outcome');
    const untagged = outcomesOf(ctx.content.event('the_tutors_good_years')!)[0]!;
    logOutcome(ctx, START + 31, 'the_tutors_good_years', untagged.id);
    expect(glimpseYears(ctx)).toEqual([]);
    expect(lastAnswerYear(ctx)).toBe(START);
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('measures from an interlude newer than the last glimpse', () => {
    const ctx = world(glimpsing, 1300);
    logOutcome(ctx, 1200, 'the_heir_reads_the_tally', 'the_three_sacks');
    ctx.world.frame.lastFired = 1260;
    expect(lastAnswerYear(ctx)).toBe(1260);
    expect(glimpseYears(ctx, 1260), 'nothing newer than the interlude').toEqual([]);
  });

  it('puts all three kinds of answer on one timeline', () => {
    const ctx = world(glimpsing, 1400);
    const clause = bundle.clauses.find((c) => !c.known)!;
    const prose = proseForClause(ctx, clause);
    ctx.world.clausesRecovered.add(clause.id);
    ctx.world.chronicle.push({ year: 1180, weight: 'illuminated', title: prose.name, text: prose.text, named: true });
    ctx.world.chronicle.push({ year: 1190, weight: 'illuminated', title: prose.name, text: 'Not the clause.', named: true });
    logOutcome(ctx, 1250, 'the_books_about_dying', 'the_carpenters_mother');
    ctx.world.frame.entries.push({ year: 1120, eventId: 'frame_x', outcomeId: 'o', text: 'An interlude.' });
    expect(clauseYears(ctx)).toEqual([1180]);
    expect(answerYears(ctx)).toEqual([1120, 1180, 1250]);
  });

  // Through the real commit path, not a hand-written log line: whatever the
  // auto-resolved opening picks, its follow-up is a glimpse, and the reader
  // finds the year `commitOutcome` logged it in.
  it('sees the glimpse commitOutcome logs when the follow-up resolves', () => {
    const ctx = bootstrap(glimpsing, 4106, START);
    while (ctx.world.year < START + 8) stepYear(ctx);
    const shown = ctx.world.decisionLog.filter((d) => d.kind === 'outcome' && FOLLOW_UPS[d.event] === d.outcomeId);
    expect(shown.length, 'the opening reached its follow-up').toBeGreaterThan(0);
    expect(glimpseYears(ctx)).toEqual(shown.map((d) => d.year));
    expect(lastAnswerYear(ctx)).toBeGreaterThanOrEqual(shown.at(-1)!.year);
  });
});
