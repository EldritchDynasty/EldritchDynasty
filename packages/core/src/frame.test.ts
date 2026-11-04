import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, stepYear } from './sim.js';
import { outcomesOf, type ContentBundle, type Outcome } from '@ed/schema';
import {
  FRAME_ANSWER_GAP_YEARS, FRAME_MAX_GAP_YEARS, FRAME_MIN_GAP_YEARS,
  frameDue, frameOverdue, framePool, frameReadHolds, inline, lastAnswerYear, pageToCite, presentFrame,
} from './events/frame.js';
import { applyRecord } from './events/decisions.js';
import { GLIMPSE_TAG, answerPages, answerYears, answers, clauseYears, glimpseYears, isGlimpse } from './events/answers.js';
import { GameSession, newGame, viewOf } from './session.js';
import { canonical, loadGame, saveGame } from './save.js';
import { missingPlainEnglish, proseForClause } from './prose.js';
import { makeRng } from './rng.js';
import { evalCondition } from './events/conditions.js';
import { resolveSlots } from './events/slots.js';
import { place, testWorld } from './testing.js';

const bundle = loadContent();

/**
 * A recovered Record decision may be dated later than the current world year.
 * The frame cannot quote a decision the house has yet to make (#2741).
 * Both pool selection and direct presentation share the same read predicate.
 */
describe('frame Record reads exclude future decisions (#2741)', () => {
  const events = {
    record: 'frame_the_grates_and_the_hour',
    omit: 'frame_the_page_he_does_not_turn',
  } as const;

  for (const mode of ['original', 'plainenglish'] as const) {
    for (const option of ['record', 'omit'] as const) {
      it(`${mode}: ${option} becomes evidence only in its recorded year`, () => {
        const ctx = newGame(bundle, { seed: 2741, proseMode: mode }).ctx;
        const year = ctx.world.year;
        const later = year + 3;
        const id = events[option];
        const real = ctx.content.events.find((e) => e.id === id)!;
        if (real.interaction.kind !== 'narration') throw new Error(`${id} is no longer narration`);

        // Use the shipped gate and event, but a slot-free rendering fixture:
        // eligibility, rather than a randomly available listener, is tested.
        const scene = {
          ...real,
          slots: {},
          body: 'The page is read.',
          interaction: {
            kind: 'narration' as const,
            outcomes: real.interaction.outcomes.map((outcome) => ({
              ...outcome, text: 'The reading is heard.',
            })),
          },
        };
        const read = option === 'record'
          ? { recorded: { atLeast: 1 } }
          : { omitted: { atLeast: 1 } };
        const inPool = () => framePool(ctx).some((e) => e.id === id);
        ctx.world.decisionLog.push({
          kind: 'record', year: later, event: 'the_letters_to_the_weighers', option,
        });

        expect(frameReadHolds(ctx, read)).toBe(false);
        expect(inPool()).toBe(false);
        expect(presentFrame(ctx, scene, makeRng(2741))).toBeUndefined();
        expect(ctx.world.frame.entries).toEqual([]);

        ctx.world.year = later - 1;
        expect(frameReadHolds(ctx, read)).toBe(false);
        expect(inPool()).toBe(false);

        ctx.world.year = later;
        expect(frameReadHolds(ctx, read)).toBe(true);
        expect(inPool()).toBe(true);
        expect(presentFrame(ctx, scene, makeRng(2741))?.year).toBe(later);

        // The same dated decision continues to count after its year.
        ctx.world.year = later + 1;
        expect(frameReadHolds(ctx, read)).toBe(true);

        const current = newGame(bundle, { seed: 2742, proseMode: mode }).ctx;
        current.world.decisionLog.push({
          kind: 'record', year: current.world.year, event: 'the_letters_to_the_weighers', option,
        });
        expect(frameReadHolds(current, read)).toBe(true);
      });
    }
  }
});


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
 * THE SCENE, THEN ITS LINE (#2615).
 *
 * `proseForOutcome` falls back to the body only when an outcome has no text,
 * and every frame outcome has text, so every interlude ever shown was its
 * punchline alone. The template's own cast is cleared here, and one omitted
 * page is written for its read to bind, so the test is about presentation,
 * not eligibility; the event id is kept, so the reviewed Plain English rows
 * still resolve against it.
 */
describe('an interlude shows its scene, then its line', () => {
  const ID = 'frame_the_page_he_does_not_turn';
  const present = (mode: 'original' | 'plainenglish', outcomes?: (o: Outcome) => Outcome) => {
    const game = newGame(bundle, { seed: 2615, proseMode: mode });
    // Since #1987 this scene names the blank it reads, so give it one to name.
    game.ctx.world.chronicle.push({
      id: 'chr_blank', year: 1077, weight: 'paragraph', text: null, eventId: 'the_letters_to_the_weighers',
      named: false, record: 'omit', subject: 'the letters',
    });
    game.ctx.world.decisionLog.push({ kind: 'record', year: 1077, event: 'the_letters_to_the_weighers', option: 'omit' });
    const real = game.ctx.content.events.find((e) => e.id === ID)!;
    if (real.interaction.kind !== 'narration') throw new Error(`${ID} is no longer narration`);
    const interaction = outcomes
      ? { ...real.interaction, outcomes: real.interaction.outcomes.map(outcomes) }
      : real.interaction;
    const entry = presentFrame(game.ctx, { ...real, slots: {}, interaction }, makeRng(2615));
    return { game, real, entry: entry! };
  };

  it('keeps the body the outcome line pays off, rendered, in each prose mode', () => {
    const original = present('original');
    expect(original.entry.body).toMatch(/^There is a page the guardian turns past/);
    expect(original.entry.text).toMatch(/^Whether the disagreement is in the accounts/);
    for (const field of [original.entry.body!, original.entry.text]) expect(field).not.toMatch(/[{}]/);

    const plain = present('plainenglish');
    expect(missingPlainEnglish(plain.game.ctx), 'a reviewed row was not used').toEqual([]);
    expect(plain.entry.body).not.toBe(original.entry.body);
    expect(plain.entry.text).not.toBe(original.entry.text);
    expect(plain.entry.body).not.toMatch(/[{}]/);
  });

  it('reaches the view and survives a save', () => {
    const { game, entry } = present('original');
    expect(viewOf(game.ctx).frame.at(-1)).toEqual(entry);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(game.ctx))), bundle);
    expect(resumed.world.frame.entries.at(-1)).toEqual(entry);
  });

  it('does not print the body twice when the outcome has no line of its own', () => {
    const { entry } = present('original', (o) => ({ ...o, text: '' }));
    expect(entry.body).toBeUndefined();
    expect(entry.text).toMatch(/^There is a page the guardian turns past/);
  });
});

/**
 * THE BLANK, BY NAME (#1987).
 *
 * The owner's target is that a house's first Omit comes back as that
 * omission, identifiably. These build the book by hand: a scene that reads
 * the blanks binds the earliest one no interlude has named, says its year and
 * what the docket asked about it, and records the citation only when its
 * words actually printed one.
 */
describe('a scene that reads the blanks names one', () => {
  const ID = 'frame_the_page_he_does_not_turn';
  const blank = (ctx: ReturnType<typeof bootstrap>, id: string, year: number, subject?: string) => {
    ctx.world.chronicle.push({
      id, year, weight: 'paragraph', text: null, eventId: 'the_letters_to_the_weighers', named: false, record: 'omit',
      ...(subject ? { subject } : {}),
    });
    ctx.world.decisionLog.push({ kind: 'record', year, event: 'the_letters_to_the_weighers', option: 'omit' });
  };
  const scene = (ctx: ReturnType<typeof bootstrap>, body: string) => {
    const real = ctx.content.events.find((e) => e.id === ID)!;
    return { ...real, slots: {}, body };
  };
  const NAMING = 'The page of {PAGE_YEAR} says nothing about {PAGE_SUBJECT}.';

  it('binds the earliest unnamed blank, then the next, then the newest once all are named', () => {
    const ctx = bootstrap(bundle, 1987, 1042);
    blank(ctx, 'chr_a', 1077, 'the letters');
    blank(ctx, 'chr_b', 1102, 'the second drowning');
    const e = scene(ctx, NAMING);

    const first = presentFrame(ctx, e, makeRng(1))!;
    expect(first.body).toBe('The page of 1077 says nothing about the letters.');
    expect(first.cites).toEqual({ page: 'chr_a', year: 1077 });
    expect(pageToCite(ctx, e)?.id).toBe('chr_b');
    expect(presentFrame(ctx, e, makeRng(2))!.cites?.page).toBe('chr_b');
    expect(pageToCite(ctx, e)?.id, 'every blank named: the newest').toBe('chr_b');
  });

  it('cites nothing when its words name no page, and binds nothing for a count read', () => {
    const ctx = bootstrap(bundle, 1987, 1042);
    blank(ctx, 'chr_a', 1077, 'the letters');
    const quiet = presentFrame(ctx, scene(ctx, 'There is a page the guardian turns past.'), makeRng(1))!;
    expect(quiet.cites).toBeUndefined();
    const counting = { ...scene(ctx, NAMING), reads: [{ recorded: { atLeast: 0 } }] };
    expect(pageToCite(ctx, counting)).toBeUndefined();
  });

  it('shows nothing rather than a raw token when there is no blank to name', () => {
    const ctx = bootstrap(bundle, 1987, 1042);
    // The read holds on the docket's log, but no page in the book carries an id.
    ctx.world.decisionLog.push({ kind: 'record', year: 1077, event: 'the_letters_to_the_weighers', option: 'omit' });
    expect(presentFrame(ctx, scene(ctx, NAMING), makeRng(1))).toBeUndefined();
    expect(ctx.world.frame.entries).toEqual([]);
  });

  it('keeps the docket\'s subject on the blank at the commit, and survives a save', () => {
    const ctx = bootstrap(bundle, 1987, 1042);
    const source = ctx.content.events.find((e) => e.record && !/[{}]/.test(e.record.subject))!;
    ctx.world.year = 1077;
    applyRecord(ctx, source, 'chr_src', 'omit');
    const page = ctx.world.chronicle.find((c) => c.id === 'chr_src')!;
    expect(page.text, 'the blank stays blank').toBeNull();
    expect(page.subject).toBe(source.record!.subject.trim());

    const entry = presentFrame(ctx, scene(ctx, NAMING), makeRng(1))!;
    expect(entry.body).toBe(`The page of 1077 says nothing about ${inline(page.subject!)}.`);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(resumed.world.chronicle.find((c) => c.id === 'chr_src')?.subject).toBe(page.subject);
    expect(resumed.world.frame.entries.at(-1)).toEqual(entry);
  });

  it('names an older blank by its Record block or its title', () => {
    const ctx = bootstrap(bundle, 1987, 1042);
    blank(ctx, 'chr_old', 1077); // saved before the subject was kept
    const source = ctx.content.event('the_letters_to_the_weighers')!;
    const words = presentFrame(ctx, scene(ctx, '{PAGE_SUBJECT}'), makeRng(1))!.body;
    expect(words).toBeTruthy();
    expect(words).not.toMatch(/[{}]/);
    expect([inline(source.record?.subject ?? ''), source.title]).toContain(words);
  });

  it.each(['original', 'plainenglish'] as const)('ships an omission scene that names the first blank (%s)', (mode) => {
    const game = newGame(bundle, { seed: 1987, proseMode: mode });
    blank(game.ctx, 'chr_first', 1077, 'the list out of Caster');
    const shipped = game.ctx.content.events.find((e) => e.id === ID)!;
    const entry = presentFrame(game.ctx, { ...shipped, slots: {} }, makeRng(1))!;
    expect(entry.cites).toEqual({ page: 'chr_first', year: 1077 });
    expect(entry.body).toContain('1077');
    expect(entry.body).toContain('the list out of Caster');
    expect(entry.body).not.toMatch(/[{}]/);
    expect(missingPlainEnglish(game.ctx)).toEqual([]);
  });

  it('sets a subject written as its own sentence inside the scene\'s', () => {
    expect(inline('The account of Aldous at the incident.')).toBe('the account of Aldous at the incident');
    expect(inline('the list out of Caster')).toBe('the list out of Caster');
    expect(inline('Cradlemoor, drained')).toBe('Cradlemoor, drained');
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

/**
 * The shipped bundle with every glimpse tag taken off, and nothing else
 * changed: the control. The shipped bundle itself carries the tags (#1897's
 * content half), so it is the one the glimpse tests read.
 */
function untagged(source: ContentBundle): ContentBundle {
  const strip = (o: Outcome): Outcome => ({ ...o, tags: o.tags.filter((t) => t !== GLIMPSE_TAG) });
  return {
    ...source,
    events: source.events.map((e) => {
      const i = e.interaction;
      return i.kind === 'narration'
        ? { ...e, interaction: { ...i, outcomes: i.outcomes.map(strip) } }
        : { ...e, interaction: { ...i, choices: i.choices.map((c) => ({ ...c, outcomes: c.outcomes.map(strip) })) } };
    }),
  };
}

const glimpsing = bundle.bundle;

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
    expect(isGlimpse(glimpseWorld(untagged(bundle.bundle), SIGNING), 'the_heir_reads_the_tally', 'the_three_sacks'),
      'the untagged bundle has no glimpse here').toBe(false);
  });

  it('ships every tutor follow-up tagged, whichever the opening picks', () => {
    const ctx = glimpseWorld(glimpsing, SIGNING);
    for (const [event, outcome] of Object.entries(FOLLOW_UPS)) {
      expect(isGlimpse(ctx, event, outcome), `${event}#${outcome}`).toBe(true);
    }
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

/**
 * WHICH PAGE AN ANSWER IS ON (#1945).
 *
 * `answerYears` said when; a reading-time measurement needs to know which page
 * the player was looking at when the run answered them. `answers()` is the one
 * definition and the years are only its dates, so the frame's ceiling and
 * `gate:long` cannot drift from what a client is told.
 */
describe('an answer names its page', () => {
  /** A page as `applyOutcome` writes one, and the decision `commitOutcome` logs after it. */
  function fire(ctx: ReturnType<typeof bootstrap>, year: number, event: string, outcomeId: string, id: string) {
    ctx.world.chronicle.push({ id, year, weight: 'paragraph', text: `${event} ${outcomeId}`, eventId: event, named: false });
    logOutcome(ctx, year, event, outcomeId);
  }

  it('classifies all three kinds, and the years are only its dates', () => {
    const ctx = glimpseWorld(glimpsing, 1400);
    const clause = bundle.clauses.find((c) => !c.known)!;
    const prose = proseForClause(ctx, clause);
    ctx.world.clausesRecovered.add(clause.id);
    ctx.world.chronicle.push({ year: 1180, weight: 'illuminated', title: prose.name, text: prose.text, named: true });
    fire(ctx, 1250, 'the_books_about_dying', 'the_carpenters_mother', 'chr_glimpse');
    ctx.world.frame.entries.push({ year: 1120, eventId: 'frame_x', outcomeId: 'o', text: 'An interlude.' });

    const clausePage = `legacy-chronicle:${ctx.world.chronicle.findIndex((e) => e.year === 1180)}`;
    expect(answers(ctx)).toEqual([
      { year: 1120, kind: 'interlude', event: 'frame_x' },
      { year: 1180, kind: 'clause', page: clausePage },
      { year: 1250, kind: 'glimpse', event: 'the_books_about_dying', page: 'chr_glimpse' },
    ]);
    expect(answerYears(ctx)).toEqual(answers(ctx).map((a) => a.year));
    expect(answers(ctx, 1180).map((a) => a.kind), 'only what is newer').toEqual(['glimpse']);
    expect([...answerPages(ctx)]).toEqual([[clausePage, 'clause'], ['chr_glimpse', 'glimpse']]);
  });

  // One template firing twice in a year writes two pages under one event id;
  // the decision log keeps no page. The k-th outcome is the k-th page.
  it('pairs the k-th outcome of an event in a year with its k-th page', () => {
    const ctx = glimpseWorld(glimpsing, 1300);
    const untagged = outcomesOf(ctx.content.event('the_heir_reads_the_tally')!, true).find((o) => !o.tags.includes(GLIMPSE_TAG));
    fire(ctx, 1200, 'the_heir_reads_the_tally', untagged?.id ?? 'no_such_outcome', 'chr_first');
    fire(ctx, 1200, 'the_heir_reads_the_tally', 'the_three_sacks', 'chr_second');
    expect(answers(ctx).map((a) => a.page)).toEqual(['chr_second']);
  });

  it('gives a glimpse with no page of its own no page, rather than a neighbour\'s', () => {
    const ctx = glimpseWorld(glimpsing, 1300);
    logOutcome(ctx, 1200, 'the_heir_reads_the_tally', 'the_three_sacks');
    ctx.world.chronicle.push({ id: 'chr_other', year: 1200, weight: 'line', text: 'Elsewhere.', eventId: 'something_else', named: false });
    expect(answers(ctx)).toEqual([{ year: 1200, kind: 'glimpse', event: 'the_heir_reads_the_tally' }]);
  });

  // The real commit path, and the real seam: the page a client is handed
  // says it is an answer, and reading it changes nothing that is saved.
  it('marks the page the client reads, and saves nothing', () => {
    const ctx = bootstrap(glimpsing, 4106, SIGNING);
    while (ctx.world.year < SIGNING + 8) stepYear(ctx);
    const shown = answers(ctx).filter((a) => a.kind === 'glimpse');
    expect(shown.length, 'the opening reached its follow-up').toBeGreaterThan(0);
    for (const a of shown) {
      expect(ctx.world.chronicle.find((e) => e.id === a.page)?.eventId, 'the page is the glimpse\'s own').toBe(a.event);
    }

    const saved = () => canonical({ ...saveGame(ctx), savedAt: '' });
    const before = saved();
    const session = new GameSession(ctx);
    const marked = (entries: { id?: string; answer?: string }[]) =>
      entries.filter((e) => e.answer).map((e) => [e.id, e.answer]);
    const expected = shown.map((a) => [a.page, 'glimpse']);
    expect(marked(session.book())).toEqual(expected);
    expect(marked(viewOf(ctx).chronicle)).toEqual(expected);
    expect(marked(session.book({ from: shown[0]!.year, to: shown[0]!.year }))).toEqual([expected[0]]);
    expect(ctx.world.chronicle.some((e) => 'answer' in e), 'the saved book is not decorated').toBe(false);
    expect(saved(), 'reading is not writing').toBe(before);
  });
});

/**
 * THE GLIMPSE CHAIN (#1897 option (c), option 2).
 *
 * Three one-shot scenes, each tagged, each waiting on the flag the one before
 * sets, so they arrive in order and never twice. Built state, not a played
 * run: whether they REACH ordinary play is the fire-rate gate's question, and
 * whether they shorten the silence is `gate:long`'s (docs/BALANCE-LOG.md).
 */
describe('the glimpse chain', () => {
  const CHAIN = ['the_line_carried_forward', 'the_letters_to_the_weighers', 'the_branch_hall_book'];
  const due = (ctx: ReturnType<typeof testWorld>, id: string) => evalCondition(ctx.content.event(id)!.conditions, ctx);

  it('is three one-shot scenes whose every outcome is a glimpse', () => {
    const ctx = testWorld(bundle);
    for (const id of CHAIN) {
      const e = ctx.content.event(id)!;
      expect(e, id).toBeDefined();
      expect(e.repeatable, id).toBe(false);
      for (const o of outcomesOf(e, true)) expect(isGlimpse(ctx, id, o.id), `${id}#${o.id}`).toBe(true);
    }
  });

  it('arrives in order, once each', () => {
    const ctx = testWorld(bundle, 1042, 1080);
    const flags = ctx.world.flags;
    expect(CHAIN.map((id) => due(ctx, id)), 'nothing shown yet').toEqual([true, false, false]);
    flags.set('glimpse_line_carried', true);
    expect(CHAIN.map((id) => due(ctx, id)), 'the steward has seen it').toEqual([false, true, false]);
    flags.set('glimpse_weighers_asked', true);
    ctx.world.year = 1200;
    expect(due(ctx, CHAIN[2]!), 'no branch hall, no branch book').toBe(false);

    const cadet = place(ctx, { sex: 'female', age: 30, name: 'A Cousin', branch: 'branch_glimpse' });
    ctx.world.branches.set('branch_glimpse' as never, {
      id: 'branch_glimpse', name: 'Glimpse Hall', house: ctx.world.playerHouse, founder: cadet.id,
      splitFrom: 'main', foundedYear: 1180, grievance: 0,
    } as never);
    expect(CHAIN.map((id) => due(ctx, id)), 'a branch hall keeps its own book').toEqual([false, false, true]);
    expect(resolveSlots(ctx.content.event(CHAIN[2]!)!, ctx, makeRng(1)).ok, 'a cousin of the branch is there to bring it').toBe(true);
    flags.set('glimpse_branch_book', true);
    expect(due(ctx, CHAIN[2]!), 'once').toBe(false);
  });

  // The ambient draw cannot carry a one-shot through a fifty-year window: with
  // only conditions, all three fired in 0 of 24 Long Lines. Each link is
  // therefore scheduled by the one before, starting from every tutor
  // follow-up, and a broken link would silently strand the rest.
  it('is scheduled link by link, from every tutor follow-up', () => {
    const ctx = testWorld(bundle);
    const schedules = (event: string, outcome: string) => outcomesOf(ctx.content.event(event)!, true)
      .find((o) => o.id === outcome)!.effects.flatMap((e) => (e.kind === 'schedule' ? [e.event] : []));
    for (const [event, outcome] of Object.entries(FOLLOW_UPS)) {
      expect(schedules(event, outcome), `${event}#${outcome}`).toContain(CHAIN[0]);
    }
    expect(schedules(CHAIN[0]!, 'carried')).toEqual([CHAIN[1]]);
    expect(schedules(CHAIN[1]!, 'nobody_holds_it')).toEqual([CHAIN[2]]);
  });

  it('answers the frame through the same reader as the tutor\'s glimpse', () => {
    const ctx = glimpseWorld(glimpsing, 1130);
    logOutcome(ctx, 1095, 'the_letters_to_the_weighers', 'nobody_holds_it');
    expect(glimpseYears(ctx)).toEqual([1095]);
    expect(lastAnswerYear(ctx)).toBe(1095);
  });
});
