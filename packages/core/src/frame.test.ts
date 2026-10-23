import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap } from './sim.js';
import {
  FRAME_ANSWER_GAP_YEARS, FRAME_MAX_GAP_YEARS, FRAME_MIN_GAP_YEARS,
  frameDue, frameOverdue, framePool, lastAnswerYear,
} from './events/frame.js';
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
