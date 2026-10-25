import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, stepYear } from './sim.js';
import { outcomesOf, type ContentBundle, type Outcome } from '@ed/schema';
import {
  FRAME_ANSWER_GAP_YEARS, FRAME_MAX_GAP_YEARS, FRAME_MIN_GAP_YEARS,
  frameDue, frameOverdue, framePool, lastAnswerYear,
} from './events/frame.js';
import { GLIMPSE_TAG, answerYears, clauseYears, glimpseYears, isGlimpse } from './events/answers.js';
import { proseForClause } from './prose.js';
import { makeRng } from './rng.js';

const bundle = loadContent();

/**
 * THE PAGE, NOT THE LIE (issue #41's coverage failure).
 *
 * A `chronicled` read asks whether one named event left an entry in the
 * chronicle — whatever that entry ended up saying. It exists because
 * `{ discrepancy: regalia_lie }` reaches 5.6% of runs (36 runs measured: the
 * arc gets to `seal_the_regalia_incomplete` in 11, the chronicler embellishes
 * 2) while the page itself is written in all 11, and the frame going quiet is
 * invisible from outside.
 */
describe('a frame read on the record itself', () => {
  const INTERLUDE = 'frame_the_missing_third_returns';
  const SOURCE = 'seal_the_regalia_incomplete';

  const inPool = (ctx: ReturnType<typeof bootstrap>) => framePool(ctx).some((e) => e.id === INTERLUDE);

  it('holds the interlude back until the page exists', () => {
    const ctx = bootstrap(bundle, 4242, 1042);
    expect(inPool(ctx), 'nothing has been written yet').toBe(false);

    ctx.world.chronicle.push({
      year: 1200, weight: 'page', text: 'Two of three, and everyone present saw it.',
      eventId: SOURCE, named: true, record: 'record',
    });
    expect(inPool(ctx)).toBe(true);
  });

  /**
   * The whole reason this is a read on the RECORD and not a flag on the
   * world: an omission is a dated blank line, and the blank is an artefact
   * the guardian reads as readily as a sentence.
   */
  it('counts a dated blank as a page', () => {
    const ctx = bootstrap(bundle, 4242, 1042);
    ctx.world.chronicle.push({
      year: 1200, weight: 'page', text: null, eventId: SOURCE, named: false, record: 'omit',
    });
    expect(inPool(ctx)).toBe(true);
  });

  it('is not satisfied by some other event writing a page', () => {
    const ctx = bootstrap(bundle, 4242, 1042);
    ctx.world.chronicle.push({
      year: 1200, weight: 'page', text: 'Something else entirely.',
      eventId: 'seal_aftermath', named: false, record: 'record',
    });
    expect(inPool(ctx)).toBe(false);
  });
});

/**
 * AN ANSWER IS AN INTERLUDE OR A CLAUSE (#1904, option (a) of #1897).
 *
 * The frame-only ceiling let the run go 104 years with neither, because a
 * clause in between reset nothing and 108 never bound. The answer ceiling
 * counts both, and reads the clause off its own page as `gate:long` does.
 */
describe('the frame is overdue after too long without an answer', () => {
  const START = 1042;
  const clause = bundle.clauses.find((c) => !c.known)!;

  const world = (year: number) => {
    const ctx = bootstrap(bundle, 4242, START);
    ctx.world.year = year;
    return ctx;
  };
  const writeClause = (ctx: ReturnType<typeof bootstrap>, year: number, text?: string) => {
    const prose = proseForClause(ctx, clause);
    ctx.world.clausesRecovered.add(clause.id);
    ctx.world.chronicle.push({ year, weight: 'illuminated', title: prose.name, text: text ?? prose.text, named: true });
  };

  it('cuts once the signing is the last answer and the ceiling has passed', () => {
    expect(frameOverdue(world(START + FRAME_ANSWER_GAP_YEARS - 1))).toBe(false);
    const ctx = world(START + FRAME_ANSWER_GAP_YEARS);
    expect(frameOverdue(ctx)).toBe(true);
    expect(frameDue(ctx, makeRng(1))).toBe(true);
  });

  it('counts a recovered clause as an answer', () => {
    const ctx = world(START + FRAME_ANSWER_GAP_YEARS + 10);
    writeClause(ctx, START + 20);
    expect(lastAnswerYear(ctx)).toBe(START + 20);
    expect(frameOverdue(ctx)).toBe(false);
  });

  it('measures from an interlude newer than the last clause', () => {
    const ctx = world(1300);
    writeClause(ctx, 1200);
    ctx.world.frame.lastFired = 1260;
    expect(lastAnswerYear(ctx)).toBe(1260);
    expect(frameOverdue(ctx)).toBe(false);
    ctx.world.year = 1260 + FRAME_ANSWER_GAP_YEARS;
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('does not take another illuminated page for the clause', () => {
    const ctx = world(START + FRAME_ANSWER_GAP_YEARS + 10);
    writeClause(ctx, START + 20, 'Not what the contract says.');
    expect(lastAnswerYear(ctx)).toBe(START);
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('still honours the minimum gap between interludes', () => {
    const ctx = world(1300);
    ctx.world.frame.lastFired = 1300 - FRAME_MIN_GAP_YEARS + 1;
    expect(frameDue(ctx, makeRng(1))).toBe(false);
  });

  it('keeps the frame-only ceiling when clauses keep arriving', () => {
    const ctx = world(1300);
    ctx.world.frame.lastFired = 1300 - FRAME_MAX_GAP_YEARS;
    writeClause(ctx, 1295);
    expect(frameOverdue(ctx)).toBe(true);
  });
});

const SIGNING = 1042;

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

function glimpseWorld(source: ContentBundle | typeof bundle, year: number) {
  const ctx = bootstrap(source, 4242, SIGNING);
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
    const ctx = glimpseWorld(glimpsing, SIGNING);
    expect(isGlimpse(ctx, 'the_heir_reads_the_tally', 'the_three_sacks')).toBe(true);
    expect(isGlimpse(ctx, 'the_heir_reads_the_tally', 'no_such_outcome')).toBe(false);
    expect(isGlimpse(ctx, 'no_such_event', 'the_three_sacks')).toBe(false);
    expect(isGlimpse(glimpseWorld(bundle, SIGNING), 'the_heir_reads_the_tally', 'the_three_sacks'),
      'the untagged bundle has no glimpse here').toBe(false);
  });

  it('counts a logged glimpse as the last answer, and keeps the frame on its roll', () => {
    const ctx = glimpseWorld(glimpsing, SIGNING + FRAME_ANSWER_GAP_YEARS + 10);
    expect(frameOverdue(ctx), 'silent since the signing').toBe(true);
    logOutcome(ctx, SIGNING + 30, 'the_heir_reads_the_tally', 'the_three_sacks');
    expect(glimpseYears(ctx)).toEqual([SIGNING + 30]);
    expect(lastAnswerYear(ctx)).toBe(SIGNING + 30);
    expect(frameOverdue(ctx)).toBe(false);
    ctx.world.year = SIGNING + 30 + FRAME_ANSWER_GAP_YEARS;
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('does not take an untagged outcome for one', () => {
    const ctx = glimpseWorld(glimpsing, SIGNING + FRAME_ANSWER_GAP_YEARS + 10);
    logOutcome(ctx, SIGNING + 30, 'the_heir_reads_the_tally', 'no_such_outcome');
    const untagged = outcomesOf(ctx.content.event('the_tutors_good_years')!)[0]!;
    logOutcome(ctx, SIGNING + 31, 'the_tutors_good_years', untagged.id);
    expect(glimpseYears(ctx)).toEqual([]);
    expect(lastAnswerYear(ctx)).toBe(SIGNING);
    expect(frameOverdue(ctx)).toBe(true);
  });

  it('measures from an interlude newer than the last glimpse', () => {
    const ctx = glimpseWorld(glimpsing, 1300);
    logOutcome(ctx, 1200, 'the_heir_reads_the_tally', 'the_three_sacks');
    ctx.world.frame.lastFired = 1260;
    expect(lastAnswerYear(ctx)).toBe(1260);
    expect(glimpseYears(ctx, 1260), 'nothing newer than the interlude').toEqual([]);
  });

  it('puts all three kinds of answer on one timeline', () => {
    const ctx = glimpseWorld(glimpsing, 1400);
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
    const ctx = bootstrap(glimpsing, 4106, SIGNING);
    while (ctx.world.year < SIGNING + 8) stepYear(ctx);
    const shown = ctx.world.decisionLog.filter((d) => d.kind === 'outcome' && FOLLOW_UPS[d.event] === d.outcomeId);
    expect(shown.length, 'the opening reached its follow-up').toBeGreaterThan(0);
    expect(glimpseYears(ctx)).toEqual(shown.map((d) => d.year));
    expect(lastAnswerYear(ctx)).toBeGreaterThanOrEqual(shown.at(-1)!.year);
  });
});
