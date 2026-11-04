import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyEffect, beginStudy, bootstrap, effectiveStudyYears, loadGame, phase, place,
  runYears, saveGame, spellbookDef, knowsAffinity,
} from '@ed/core';
import { asId } from '@ed/schema';

const content = loadContent();

/**
 * THE WAIT, AND THE PIPELINE UNDER IT.
 *
 * The auction has bought books since the auction existed. Nothing read one:
 * `gainSpellbook` was reachable only through a `spellbook` effect no content
 * authored, so a thousand-year run ended with sixty-odd volumes on the shelf,
 * degrading, and `Person.spellsKnown` empty in every house that ever lived.
 * Eleven books carried `studyYears` and the Scholar carried `studySpeed: 0.7`,
 * and both measured a wait nobody was having. `effectiveStudyYears` had zero
 * callers.
 *
 * `op: study` is the door in, and these are the mechanics under it: the years
 * are spent when the book comes down, not when it goes back.
 */

const LIFE = 'lesser_workings_of_life';
const book = (ctx: Parameters<typeof spellbookDef>[0]) => spellbookDef(ctx, LIFE)!;

/**
 * THIS reader's study, and never the whole list. The house opens holding two
 * books now (issue #41), so the steward has somebody on one of them from the
 * first year — `world.studies` is no longer a list of one thing a test put
 * there, and a length assertion on it stopped being about the mechanism.
 */
const studyOf = (ctx: { world: { studies: { person: string; completes: number }[] } }, id: string) =>
  ctx.world.studies.filter((x) => x.person === id);

describe('a book takes the years it says it takes', () => {
  it('study delivers nothing now and the knowledge later', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const reader = place(ctx, { sex: 'female', age: 20, name: 'A Reader', awakened: true });
    const def = book(ctx);

    expect(beginStudy(ctx, reader, def)).toBe(true);
    expect(reader.spellsKnown).toHaveLength(0);
    expect(studyOf(ctx, reader.id)).toHaveLength(1);
    expect(studyOf(ctx, reader.id)[0]!.completes).toBe(1042 + def.studyYears);

    runYears(ctx, def.studyYears);

    expect(reader.spellsKnown.map(String)).toContain(LIFE);
    expect(studyOf(ctx, reader.id)).toHaveLength(0);
  });

  it('and not a year before', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const reader = place(ctx, { sex: 'female', age: 20, name: 'Not Yet', awakened: true });
    const def = book(ctx);
    beginStudy(ctx, reader, def);

    runYears(ctx, def.studyYears - 1);

    expect(reader.spellsKnown).toHaveLength(0);
    expect(studyOf(ctx, reader.id)).toHaveLength(1);
  });

  /** The Scholar's entire perk, and the reason `effectiveStudyYears` exists. */
  it('a Scholar reads it faster, and the years are fixed when the book comes down', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const def = book(ctx);
    const plain = place(ctx, { sex: 'female', age: 20, name: 'Plain Reader', awakened: true });
    const scholar = place(ctx, { sex: 'female', age: 20, name: 'The Scholar', awakened: true });
    scholar.career = { career: asId('scholar'), from: 1042 };

    expect(effectiveStudyYears(ctx, scholar, def))
      .toBeLessThan(effectiveStudyYears(ctx, plain, def));

    beginStudy(ctx, plain, def);
    beginStudy(ctx, scholar, def);

    const wait = (p: { id: string }) => ctx.world.studies.find((s) => s.person === p.id)!.completes;
    expect(wait(scholar)).toBeLessThan(wait(plain));
  });

  it('never rounds a study down to nothing, however fast the reader', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Very Quick', awakened: true });
    p.career = { career: asId('scholar'), from: 1042 };

    for (const def of content.spellbooks) {
      expect(effectiveStudyYears(ctx, p, def), String(def.id)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('who may begin, and who may not', () => {
  /** INVARIANT 4: the Mystic restriction. Women study the Threshold four only. */
  it('refuses a woman an elemental book, and allows her a Threshold one', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const her = place(ctx, { sex: 'female', age: 25, name: 'She Who Reads', awakened: true });

    expect(beginStudy(ctx, her, spellbookDef(ctx, 'lesser_workings_of_fluid')!)).toBe(false);
    expect(beginStudy(ctx, her, book(ctx))).toBe(true);
  });

  /**
   * Asked at the START, not on completion. A man who cannot learn a thing does
   * not spend six years failing to.
   */
  it('refuses on the spot rather than quietly in 1183', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const her = place(ctx, { sex: 'female', age: 25, name: 'Refused', awakened: true });

    beginStudy(ctx, her, spellbookDef(ctx, 'lesser_workings_of_fluid')!);

    expect(ctx.world.studies).toHaveLength(0);
  });

  it('picking the same book up twice is one study, not two', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Halfway Through', awakened: true });

    expect(beginStudy(ctx, p, book(ctx))).toBe(true);
    expect(beginStudy(ctx, p, book(ctx))).toBe(false);
    expect(ctx.world.studies).toHaveLength(1);
  });

  it('refuses a book the reader already knows', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Knows It', awakened: true });
    beginStudy(ctx, p, book(ctx));
    runYears(ctx, book(ctx).studyYears);

    expect(beginStudy(ctx, p, book(ctx))).toBe(false);
  });

  /** Six years is long enough that this happens. The entry leaves the list either way. */
  it('a reader who dies mid-book drops out without stalling the queue', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const doomed = place(ctx, { sex: 'female', age: 20, name: 'Dies Reading', awakened: true });
    const def = book(ctx);
    beginStudy(ctx, doomed, def);

    ctx.world.people.kill(doomed.id, 1043, 'a fever');
    runYears(ctx, def.studyYears + 1);

    expect(studyOf(ctx, doomed.id)).toHaveLength(0);
    expect(doomed.spellsKnown).toHaveLength(0);
  });
});

describe('the effect verb, and the year phase', () => {
  it('the study op begins one through the normal effect path', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Through The Effect', awakened: true });

    applyEffect({ kind: 'spellbook', op: 'study', target: { slot: 'R' }, book: LIFE }, ctx, { R: p.id });

    expect(ctx.world.studies).toHaveLength(1);
    expect(p.spellsKnown).toHaveLength(0);
  });

  it('the library phase finishes it and says so in the report', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Finishes This Year', awakened: true });
    beginStudy(ctx, p, book(ctx));
    ctx.world.year = ctx.world.studies[0]!.completes;

    const report = phase('library', ctx);

    expect(report.studiesFinished).toHaveLength(1);
    expect(report.studiesFinished[0]!.person).toBe(p.id);
    expect(report.studiesFinished[0]!.name).toBe('Finishes This Year');
  });

  /**
   * ISSUE #82. The first reading is the one a chronicler writes down; every
   * copy after it is what the house does with its afternoons, and belongs to
   * `passage.ts`. Both halves are asserted, because writing NEITHER line
   * would pass a test that only checked the second.
   */
  it('the first reading of a book reaches the chronicle and the second does not', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const b = book(ctx);

    const first = place(ctx, { sex: 'female', age: 20, name: 'Read It First', awakened: true });
    beginStudy(ctx, first, b);
    ctx.world.year = ctx.world.studies[0]!.completes;
    phase('library', ctx);

    expect(ctx.world.chronicle.filter((c) => c.text?.includes('Read It First'))).toHaveLength(1);

    const second = place(ctx, { sex: 'female', age: 20, name: 'Read It After', awakened: true });
    beginStudy(ctx, second, b);
    ctx.world.year = ctx.world.studies[0]!.completes;
    const report = phase('library', ctx);

    // The reading happened — it is simply not the chronicler's business.
    expect(report.studiesFinished.map((s) => s.name)).toContain('Read It After');
    expect(ctx.world.chronicle.some((c) => c.text?.includes('Read It After'))).toBe(false);
  });

  /**
   * Two readers finishing the same book in the same year. Without a per-year
   * guard each sees the other as a prior reader and NEITHER line is written —
   * a correct-looking rule that silently writes nothing, which is the shape of
   * bug this repository is least able to detect.
   */
  it('two readers finishing the same book in one year still yield one first reading', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const b = book(ctx);
    const a = place(ctx, { sex: 'female', age: 20, name: 'Alba Twin', awakened: true });
    const c = place(ctx, { sex: 'female', age: 20, name: 'Bryn Twin', awakened: true });
    beginStudy(ctx, a, b);
    beginStudy(ctx, c, b);
    ctx.world.year = Math.max(...ctx.world.studies.map((s) => s.completes));

    const report = phase('library', ctx);

    expect(report.studiesFinished).toHaveLength(2);
    expect(ctx.world.chronicle.filter((e) => e.text?.includes('Nobody in the house'))).toHaveLength(1);
  });

  it('a study in flight survives a save', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 20, name: 'Mid Book', awakened: true });
    beginStudy(ctx, p, book(ctx));

    const resumed = loadGame(saveGame(ctx), content);

    expect(resumed.world.studies).toHaveLength(1);
    expect(resumed.world.studies[0]!.book).toBe(LIFE);
    expect(resumed.world.studies[0]!.completes).toBe(ctx.world.studies[0]!.completes);

    runYears(resumed, book(ctx).studyYears);
    expect(resumed.world.people.get(p.id)!.spellsKnown.map(String)).toContain(LIFE);
  });
});

/**
 * THE OTHER HALF OF THE DEAD FEATURE.
 *
 * `world.scheduled` is written only by the `schedule` effect and read only by
 * `forcedCandidates`. No content used the effect, so the reader's loop body had
 * never executed — including `SCHEDULE_PATIENCE` and the five-year requeue, and
 * including the remove-before-resolve fix that `selection.ts` documents as a
 * bug this project already shipped once. A scene that was scheduled and never
 * arrived is the exact silence this codebase specialises in.
 */
describe('a scheduled event actually arrives', () => {
  const anAmbientEvent = () => content.events.find((e) => e.tier !== 'frame' && !e.arc)!;

  it('the schedule effect puts it on the calendar for the year it names', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const target = anAmbientEvent();

    applyEffect({ kind: 'schedule', event: String(target.id), inYears: 7 }, ctx, {});

    expect(ctx.world.scheduled).toEqual([{ event: String(target.id), year: 1049 }]);
  });

  for (const { event, floor } of [
    { event: 'the_fourth_yssene_clause', floor: 1291 },
    { event: 'the_mason_reaches_the_turn', floor: 1330 },
  ]) {
    it(`keeps the early ${event} promise until its authored date, including after save/resume (#2627)`, () => {
      const ctx = bootstrap(content, 1042, 1542);
      // Older saves can already have spent years trying an impossible early
      // promise. The first calendar read must repair its patience anchor.
      ctx.world.year = 1127;
      ctx.world.scheduled.push({
        event, year: 1127, first: 1127, cause: { year: 1126, page: 'the_original_account' },
      });

      phase('ambient', ctx);
      expect(ctx.world.scheduled.find((s) => s.event === event)).toEqual({
        event, year: floor, cause: { year: 1126, page: 'the_original_account' },
      });

      const resumed = loadGame(saveGame(ctx), content);
      resumed.world.year = floor - 1;
      phase('ambient', resumed);
      expect(resumed.world.scheduled.find((s) => s.event === event)?.year).toBe(floor);

      // The knowledge/flag is deliberately absent: even at the calendar
      // opening the scene still has to satisfy its ordinary conditions.
      resumed.world.year = floor;
      phase('ambient', resumed);
      expect(resumed.world.scheduled.find((s) => s.event === event)).toMatchObject({
        event, year: floor + 5, first: floor,
        cause: { year: 1126, page: 'the_original_account' },
      });
    });
  }

  it('it does not fire early, and it is off the calendar once it has', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const target = anAmbientEvent();
    applyEffect({ kind: 'schedule', event: String(target.id), inYears: 3 }, ctx, {});

    runYears(ctx, 2);
    expect(ctx.world.scheduled.some((s) => s.event === String(target.id))).toBe(true);

    runYears(ctx, 6);
    // Either it fired, or it could not be cast and was requeued — never simply
    // dropped, which is the failure the patience counter exists to prevent.
    const stillWaiting = ctx.world.scheduled.filter((s) => s.event === String(target.id));
    const fired = ctx.world.decisionLog.some((d) => d.kind === 'outcome' && d.event === String(target.id));
    expect(fired || stillWaiting.length === 1).toBe(true);
  });

  /**
   * A scheduled event that cannot be cast waits rather than vanishing, and
   * gives up after `SCHEDULE_PATIENCE` rather than waiting forever. Both halves
   * matter: the first is the bug, the second is the loop it would otherwise be.
   */
  it('one that can never cast requeues, then gives up instead of looping forever', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const uncastable = content.events.find((e) => Object.keys(e.slots).length && !e.arc)!;
    ctx.world.scheduled.push({ event: String(uncastable.id), year: 1043 });

    // Empty the house: nobody left to cast anything.
    for (const p of ctx.world.people.living()) ctx.world.people.kill(p.id, 1042, 'the test');

    // `runYears` goes through `stepYear`, which now ends the run the moment
    // living blood reaches zero (issue #42) — correct for a real run, and
    // exactly the mechanism this test does not want: it is about
    // `SCHEDULE_PATIENCE`, one phase in isolation, not about `broken_line`.
    // Driving the `ambient` phase directly — where `forcedCandidates` lives —
    // is the tool `testing.ts` builds for exactly this ("run the one phase
    // you are testing"), and it never asks whether anyone is left to hold
    // the seal.
    const years = (n: number) => {
      for (let i = 0; i < n; i++) { ctx.world.year += 1; phase('ambient', ctx); }
    };

    years(20);
    const waiting = ctx.world.scheduled.filter((s) => s.event === String(uncastable.id));
    expect(waiting.length, 'still waiting, with its original due year remembered').toBe(1);
    expect(waiting[0]!.first).toBe(1043);

    years(60);
    expect(
      ctx.world.scheduled.some((s) => s.event === String(uncastable.id)),
      'past SCHEDULE_PATIENCE it stops asking',
    ).toBe(false);
  });
});

describe('recovered future appointments and future-born Mystic readers (#2850, #2871)', () => {
  it('uses ordinary study speed until a saved Scholar post begins, including its Age bonus', () => {
    const ctx = bootstrap(content, 2850, 1042);
    const def = book(ctx);
    const plain = place(ctx, { sex: 'female', age: 20, name: 'Plain Reader', awakened: true });
    const futureScholar = place(ctx, { sex: 'female', age: 20, name: 'Future Scholar', awakened: true });
    const now = ctx.world.year;
    futureScholar.career = { career: asId('scholar'), from: now + 4 };

    const ordinaryYears = effectiveStudyYears(ctx, plain, def);
    expect(effectiveStudyYears(ctx, futureScholar, def)).toBe(ordinaryYears);
    expect(beginStudy(ctx, futureScholar, def)).toBe(true);
    expect(studyOf(ctx, futureScholar.id)[0]!.completes).toBe(now + ordinaryYears);

    ctx.world.year = now + 4;
    expect(effectiveStudyYears(ctx, futureScholar, def))
      .toBeLessThan(effectiveStudyYears(ctx, plain, def));
    // The already-quoted in-flight study retains its original completion date.
    expect(studyOf(ctx, futureScholar.id)[0]!.completes).toBe(now + ordinaryYears);
  });

  it('excludes a future-born spell holder from present Mystic proof and first-reading precedent', () => {
    const ctx = bootstrap(content, 2871, 1042);
    const def = book(ctx);
    const futureReader = place(ctx, { sex: 'female', age: 20, name: 'Future Reader', awakened: true });
    const presentReader = place(ctx, { sex: 'female', age: 20, name: 'Present Reader', awakened: true });
    futureReader.spellsKnown.push(asId(LIFE));
    futureReader.born = ctx.world.year + def.studyYears + 9;

    expect(knowsAffinity(ctx, futureReader, 'life')).toBe(false);
    expect(beginStudy(ctx, presentReader, def)).toBe(true);
    ctx.world.year = studyOf(ctx, presentReader.id)[0]!.completes;
    const report = phase('library', ctx);
    expect(report.studiesFinished.map((s) => s.name)).toContain('Present Reader');
    expect(ctx.world.chronicle.filter((entry) => entry.text?.includes('Nobody in the house')))
      .toHaveLength(1);

    ctx.world.year = futureReader.born;
    expect(knowsAffinity(ctx, futureReader, 'life')).toBe(true);
  });
});
