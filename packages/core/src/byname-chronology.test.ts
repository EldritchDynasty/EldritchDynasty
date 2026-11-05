import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bynameStanding, bynameView, settleBynames } from './byname.js';
import { END_YEAR, digestOf, selectEnding } from '@ed/core';
import { afterimageEvidence } from './afterimage.js';
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

  it('does not show an earned name before the year of its Record grant (#2800)', () => {
    const ctx = testWorld(content, 2800, 1042);
    const relative = place(ctx, { sex: 'female', age: 20 });
    telling(ctx, relative, 'future_written_name', 1044);
    const before = structuredClone(relative.byname);

    for (const year of [1042, 1043]) {
      expect(bynameStanding(relative, year)).toBeUndefined();
      expect(bynameView(relative, year)).toBeUndefined();
    }
    for (const year of [1044, 1045]) {
      expect(bynameStanding(relative, year)).toBe('claimed');
      expect(bynameView(relative, year)).toEqual({
        text: 'the Early-Woken', standing: 'claimed', year: 1044, page: 'future_written_name',
      });
    }
    expect(bynameStanding(relative)).toBe('claimed'); // unbounded historical API
    expect(relative.byname).toEqual(before); // projection is read-only

    const legacy = place(ctx, { sex: 'male', age: 21 });
    legacy.epithet = 'the Elder';
    expect(bynameView(legacy, 1042)).toEqual({ text: 'the Elder', standing: 'unknown' });
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

    // An already-settled page is still visible in its own year.
    relative.byname!.settled = { state: 'proven', year: 1042 };
    expect(bynameView(relative, 1042)).toEqual({
      text: 'the Early-Woken', standing: 'contested',
      year: 1042, page: 'already_written', settledYear: 1042,
    });
    expect(ctx.world.chronicle).toEqual(pagesBefore);
  });
});

// Afterimage chronology regression witnesses (#2657 and #2874).

describe('Afterimage reads only testimony available by the current year (#2657)', () => {
  it('keeps synthetic unfinished-world evidence inspectable but not in a completed Afterimage', () => {
    const ctx = testWorld(content, 265704);
    const person = place(ctx, { name: 'Edda', sex: 'female', age: 30 });
    const futureYear = ctx.world.year + 100;
    ctx.world.chronicle.push({
      id: 'synthetic-future', year: futureYear, weight: 'paragraph',
      named: false, text: 'A later account of Edda.', people: [person.id],
    });

    // Historical unit fixtures and authoring tools may directly inspect an
    // unfinished world's assembled book without advancing the clock.
    expect(afterimageEvidence(ctx).people[0]?.sources[0]?.year).toBe(futureYear);
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    expect(afterimageEvidence(ctx).people).toEqual([]);
    ctx.world.year = futureYear;
    expect(afterimageEvidence(ctx).people[0]?.sources[0]?.year).toBe(futureYear);
  });

  it('does not cite future named, omitted, or embellished pages until their year', () => {
    const ctx = testWorld(content, 265701, END_YEAR);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year }; // the player-facing last-night projection
    const readerYear = w.year;
    const witness = place(ctx, { name: 'Alys', sex: 'female', age: 35 });
    const written = {
      id: 'current-witness', year: readerYear - 2, weight: 'paragraph' as const,
      text: 'Alys was named in the Chronicle.', named: false, people: [witness.id],
    };
    const futureBlank = {
      id: 'future-blank', year: readerYear + 1, weight: 'paragraph' as const,
      text: null, named: false, record: 'omit' as const,
    };
    const futureLie = {
      id: 'future-lie', year: readerYear + 1, weight: 'paragraph' as const,
      text: 'Alys was given a second, larger name.', named: false,
      people: [witness.id], record: 'embellish' as const, discrepancyId: 'future-lie',
    };
    w.chronicle.push(futureLie, written, futureBlank); // deliberately not in year order
    w.discrepancies.set('future-lie', { severity: 'total', provableBy: [], state: 'open' });

    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const current = afterimageEvidence(ctx);
    expect(current.people).toMatchObject([{ person: witness.id, sources: [{
      year: readerYear - 2, page: 'current-witness', text: written.text,
    }] }]);
    expect(current.blank).toBeUndefined();
    expect(current.embellishment).toBeUndefined();
    expect(digestOf(ctx)).toBe(before);
    expect(selectEnding(ctx)).toBe(selected);

    // An admissible page remains an attributed value, not a writable alias.
    current.people[0]!.sources[0]!.text = 'A rewritten history.';
    expect(w.chronicle.find((page) => page.id === written.id)?.text).toBe(written.text);

    // At the actual page year both new kinds of evidence become readable.
    futureBlank.year = readerYear;
    futureLie.year = readerYear;
    const arrived = afterimageEvidence(ctx);
    expect(arrived.people[0]!.sources.map((source) => source.page))
      .toEqual(['current-witness', 'future-lie']);
    expect(arrived.blank).toMatchObject({ page: 'future-blank', year: readerYear, text: null });
    expect(arrived.embellishment).toMatchObject({ page: 'future-lie', year: readerYear });
  });

  it('does not attach a future rite outcome to a person or bloodline sacrifice', () => {
    const ctx = testWorld(content, 265702, END_YEAR);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year }; // the player-facing last-night projection
    const futureYear = w.year + 1;
    const vessel = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 40 });
    w.chronicle.push({
      id: 'future-rite', year: futureYear, eventId: 'the_vessel_rite',
      weight: 'paragraph', text: 'Meriel was given to the rite.', named: false,
      people: [vessel.id, ascendant.id], record: 'record',
    });
    w.decisionLog.push({
      kind: 'outcome', event: 'the_vessel_rite', year: futureYear,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [vessel.id], ASCENDANT: [ascendant.id] },
    });
    w.people.kill(vessel.id, futureYear, 'given to the rite', 'vessel_consumed');

    const earlier = afterimageEvidence(ctx);
    expect(earlier.people).toEqual([]);
    expect(earlier.spent).toBeUndefined();
    expect(earlier.spentBlood).toBeUndefined();

    w.year = futureYear;
    const arrived = afterimageEvidence(ctx);
    expect(arrived.spent).toMatchObject({
      person: vessel.id, source: { page: 'future-rite', year: futureYear },
    });
    expect(arrived.spentBlood?.person).toBe(vessel.id);
    expect(arrived.people.some((person) => person.person === vessel.id)).toBe(true);
  });

  it('keeps same-year rite attribution ambiguous until only one written account remains', () => {
    const ctx = testWorld(content, 265706, END_YEAR);
    const w = ctx.world;
    const year = w.year;
    w.ending = { id: 'forgotten', year };
    const victim = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 40 });
    const first = {
      id: 'rite-first', year, eventId: 'the_vessel_rite', weight: 'paragraph' as const,
      text: 'Meriel was given to the rite.', named: false, people: [victim.id],
      record: 'record' as const,
    };
    w.chronicle.push(first, { ...first, id: 'rite-second' });
    w.decisionLog.push({
      kind: 'outcome', event: 'the_vessel_rite', year,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [victim.id], ASCENDANT: [ascendant.id] },
    });
    w.people.kill(victim.id, year, 'given to the rite', 'vessel_consumed');
    const ambiguous = afterimageEvidence(ctx);
    expect(ambiguous.spent).toBeUndefined();
    expect(ambiguous.spentBlood).toBeUndefined();

    // Legacy omissions can retain their saved text; they supply no witness.
    w.chronicle.find((page) => page.id === 'rite-second')!.record = 'omit';
    const read = afterimageEvidence(ctx);
    expect(read.spent?.source.page).toBe(first.id);
    expect(read.spentBlood?.source.page).toBe(first.id);
    expect(read.people.flatMap((person) => person.sources).some((source) => source.page === 'rite-second'))
      .toBe(false);
  });

  it('ignores future-opened thin-line questions and future heads until those years', () => {
    const ctx = testWorld(content, 265703, END_YEAR);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year }; // the player-facing last-night projection
    const year = w.year;
    const earlier = place(ctx, { name: 'Edrin', sex: 'male', age: 70 });
    const future = place(ctx, { name: 'Brennan', sex: 'male', age: 35 });
    w.succession = [
      { person: earlier.id, name: earlier.name, from: year - 30,
        question: { kind: 'thin_line', opened: year - 10, baseline: 4,
          text: 'Only four remained.', signature: 'earlier' } },
      { person: future.id, name: future.name, from: year + 1,
        question: { kind: 'thin_line', opened: year + 1, baseline: 1,
          text: 'Only one remained.', signature: 'future' } },
    ];
    const today = afterimageEvidence(ctx);
    expect(today.brush).toEqual({
      count: 4, source: { year: year - 10, text: 'Only four remained.' },
    });
    expect(today.line?.[0]?.id).toBe(earlier.id);
    expect(today.line?.[0]?.head).toBe(true);

    w.year = year + 1;
    const tomorrow = afterimageEvidence(ctx);
    expect(tomorrow.brush).toEqual({
      count: 1, source: { year: year + 1, text: 'Only one remained.' },
    });
    expect(tomorrow.line?.[0]?.id).toBe(future.id);
    expect(tomorrow.line?.[0]?.head).toBe(true);
  });

  it('does not borrow an earlier question from a Head whose tenure is still in the future', () => {
    const ctx = testWorld(content, 265705, END_YEAR);
    const w = ctx.world;
    const year = w.year;
    w.ending = { id: 'forgotten', year };
    const current = place(ctx, { name: 'Current', sex: 'female', age: 45 });
    const future = place(ctx, { name: 'Future', sex: 'male', age: 30 });
    w.succession = [
      { person: current.id, name: current.name, from: year - 20,
        question: { kind: 'thin_line', opened: year - 20, baseline: 4,
          text: 'Four remained under the present seal.', signature: 'current' } },
      // A recovered question can predate its saved tenure. Its earlier date
      // must not make a future Head's account available at collection.
      { person: future.id, name: future.name, from: year + 1,
        question: { kind: 'thin_line', opened: year - 1, baseline: 1,
          text: 'One remained under the later seal.', signature: 'future' } },
    ];
    const before = digestOf(ctx);
    const today = afterimageEvidence(ctx);
    expect(today.brush).toEqual({ count: 4, source: {
      year: year - 20, text: 'Four remained under the present seal.',
    } });
    expect(today.line?.[0]?.id).toBe(current.id);
    expect(digestOf(ctx)).toBe(before);

    w.year = year + 1;
    expect(afterimageEvidence(ctx).brush).toEqual({ count: 1, source: {
      year: year - 1, text: 'One remained under the later seal.',
    } });
    w.year = year;
    w.ending = undefined;
    expect(afterimageEvidence(ctx).brush?.count).toBe(1);
  });
});

describe('earned bynames cannot leak into an earlier last-night Afterimage (#2874)', () => {
  it('hides future-earned names across people, rite costs and the recorded line until their year', () => {
    const ctx = testWorld(content, 2874, END_YEAR);
    const w = ctx.world;
    const night = w.year;
    w.ending = { id: 'forgotten', year: night };
    const victim = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const head = place(ctx, { name: 'Edric', sex: 'male', age: 45 });

    for (const p of [victim, head]) {
      p.epithet = 'the Foretold';
      p.byname = {
        source: { kind: 'record', event: 'the_vessel_rite', pen: 'record', page: 'current-rite' },
        year: night + 1,
      };
    }
    // A past page and rite are already attested; only their later names are not.
    w.succession = [{ person: head.id, name: head.name, from: night - 20 }];
    w.chronicle.push({
      id: 'current-rite', year: night - 1, eventId: 'the_vessel_rite',
      weight: 'paragraph', text: 'Meriel was given to the rite.', named: false,
      people: [victim.id, head.id], record: 'record',
    });
    w.decisionLog.push({
      kind: 'outcome', event: 'the_vessel_rite', year: night - 1,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [victim.id], ASCENDANT: [head.id] },
    });
    w.people.kill(victim.id, night - 1, 'given to the rite', 'vessel_consumed');
    const savedName = victim.epithet;
    const before = digestOf(ctx);

    const today = afterimageEvidence(ctx);
    expect(today.people.find((p) => p.person === victim.id)?.epithet).toBeUndefined();
    expect(today.people.find((p) => p.person === head.id)?.epithet).toBeUndefined();
    expect(today.spent).toMatchObject({ person: victim.id, source: { page: 'current-rite' } });
    expect(today.spent?.epithet).toBeUndefined();
    expect(today.spentBlood?.epithet).toBeUndefined();
    expect(today.line?.find((p) => p.id === head.id)?.epithet).toBeUndefined();
    expect(digestOf(ctx)).toBe(before);
    expect(victim.epithet).toBe(savedName); // view cannot edit the stored earned name

    w.year = night + 1;
    const earned = afterimageEvidence(ctx);
    expect(earned.people.find((p) => p.person === victim.id)?.epithet).toBe(savedName);
    expect(earned.spent?.epithet).toBe(savedName);
    expect(earned.spentBlood?.epithet).toBe(savedName);
    expect(earned.line?.find((p) => p.id === head.id)?.epithet).toBe(savedName);

    // Unfinished diagnostic worlds intentionally have no historical cutoff.
    w.year = night;
    w.ending = undefined;
    expect(afterimageEvidence(ctx).spent?.epithet).toBe(savedName);
    expect(afterimageEvidence(ctx).line?.[0]?.epithet).toBe(savedName);
  });

  it('keeps an authored or legacy epithet without a dated grant in the historical reading', () => {
    const ctx = testWorld(content, 287401, END_YEAR);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year };
    const elder = place(ctx, { name: 'The Elder', sex: 'female', age: 55 });
    elder.epithet = 'the Once-Named';
    // Seeded/legacy epithets have no Record grant date and must not disappear.
    expect(elder.byname).toBeUndefined();
    w.chronicle.push({
      id: 'elder-witness', year: w.year - 20, weight: 'paragraph',
      named: false, text: 'The elder gave a true account.', people: [elder.id],
    });
    w.succession = [{ person: elder.id, name: elder.name, from: w.year - 30 }];

    const read = afterimageEvidence(ctx);
    expect(read.people[0]?.epithet).toBe('the Once-Named');
    expect(read.line?.[0]?.epithet).toBe('the Once-Named');
  });
});

// A restored succession log is not guaranteed to be stored in tenure order.
describe('Afterimage chooses the most recent eligible Head (#2938)', () => {
  it('selects the latest past tenure, not the final imported row', () => {
    const ctx = testWorld(content, 2938, END_YEAR);
    const w = ctx.world;
    const year = w.year;
    w.ending = { id: 'forgotten', year };
    const previous = place(ctx, { name: 'Previous', sex: 'male', age: 75 });
    const current = place(ctx, { name: 'Current', sex: 'female', age: 45 });
    const future = place(ctx, { name: 'Future', sex: 'male', age: 30 });
    const ancestor = place(ctx, { name: 'Ancestor', sex: 'female', age: 95 });
    current.claimedParents = { father: previous.id, mother: ancestor.id };
    previous.claimedParents = { mother: ancestor.id };
    ancestor.claimedParents = { father: current.id }; // restored cycle must terminate
    // The old row is appended after the current one; a future row is also present.
    w.succession = [
      { person: current.id, name: current.name, from: year - 5 },
      { person: future.id, name: future.name, from: year + 1 },
      { person: previous.id, name: previous.name, from: year - 40 },
    ];
    const before = digestOf(ctx);
    const today = afterimageEvidence(ctx);
    expect(today.line?.[0]).toMatchObject({ id: current.id, head: true });
    expect(today.line?.map((person) => [person.id, person.head])).toEqual([
      [current.id, true], [previous.id, false], [ancestor.id, false],
    ]);
    expect(digestOf(ctx)).toBe(before);

    today.line![0]!.record.parents.father = future.id;
    expect(current.claimedParents.father).toBe(previous.id);
    expect(digestOf(ctx)).toBe(before);

    w.year = year + 1;
    expect(afterimageEvidence(ctx).line?.[0]).toMatchObject({ id: future.id, head: true });
    w.ending = undefined;
    expect(afterimageEvidence(ctx).line?.[0]).toMatchObject({ id: future.id, head: true });
  });
});

describe('Afterimage resolves tied eligible tenures (#2938)', () => {
  it('retains the later stored Head when two restored tenures start in the same year', () => {
    const ctx = testWorld(content, 293801, END_YEAR);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year };
    const first = place(ctx, { name: 'First', sex: 'male', age: 67 });
    const later = place(ctx, { name: 'Later', sex: 'female', age: 43 });
    const from = w.year - 12;
    w.succession = [
      { person: first.id, name: first.name, from },
      { person: later.id, name: later.name, from },
    ];
    const before = digestOf(ctx);
    expect(afterimageEvidence(ctx).line?.[0]).toMatchObject({ id: later.id, head: true });
    expect(digestOf(ctx)).toBe(before);
  });
});
