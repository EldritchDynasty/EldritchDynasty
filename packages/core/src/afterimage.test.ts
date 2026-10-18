import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { digestOf, epilogueOf, place, testWorld } from '@ed/core';
import { afterimageEvidence } from './afterimage.js';
import type { ChronicleEntry } from './world.js';

const content = loadContent();
const page = (over: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
  id: 'page', year: 1200, weight: 'paragraph', named: false, text: 'The written account.', ...over,
});

describe('the house remembered from attributed evidence (#1808)', () => {
  it('selects up to three people from structured pages and choices, with stable ties', () => {
    const ctx = testWorld(content);
    const people = ['Élodie 家', 'Wystan', 'Meriel', 'Unmentioned'].map((name) =>
      place(ctx, { name, sex: 'female', age: 25 }));
    const [a, b, c, d] = people;
    ctx.world.chronicle = [
      page({ id: 'first', people: [a!.id, b!.id, c!.id] }),
      page({ id: 'second', eventId: 'chosen', people: [a!.id] }),
      page({ id: 'third', eventId: 'chosen_again' }),
      page({ id: 'blank', text: null, people: [d!.id] }),
    ];
    ctx.world.decisionLog = [{
      kind: 'outcome', year: 1200, event: 'chosen', choiceId: 'keep', outcomeId: 'kept', fill: { PERSON: [b!.id] },
    }, { kind: 'outcome', year: 1200, event: 'chosen_again', choiceId: 'keep', outcomeId: 'kept', fill: { PERSON: [b!.id] } }];
    const before = digestOf(ctx);
    const first = afterimageEvidence(ctx);
    expect(first.people.map((p) => p.name)).toEqual(['Wystan', 'Élodie 家', 'Meriel']);
    expect(first.people[0]!.sources.some((source) => source.choice === 'keep' && source.page === 'second')).toBe(true);
    expect(afterimageEvidence(ctx)).toEqual(first);
    expect(digestOf(ctx)).toBe(before);
    ctx.world.decisionLog = [];
    expect(afterimageEvidence(ctx).people[0]!.name).toBe('Élodie 家');
    expect(first.people.every((person) => person.sources.every((source) =>
      ctx.world.chronicle.some((entry) => entry.id === source.page && entry.text === source.text)))).toBe(true);
  });

  it('does not turn a blank into people or prose, even when the decision log retains its cast', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { name: 'Hidden by omission', sex: 'male', age: 20 });
    ctx.world.chronicle = [page({ eventId: 'omitted', text: null, title: 'A hidden title', people: [p.id] })];
    ctx.world.decisionLog = [{ kind: 'outcome', event: 'omitted', year: 1200,
      choiceId: 'choose', outcomeId: 'result', fill: { PERSON: [p.id] } }];
    const evidence = afterimageEvidence(ctx);
    expect(evidence.people).toEqual([]);
    expect(evidence.blank?.text).toBeNull();
    expect(evidence.blank?.title).toBeUndefined();
    expect(evidence.spent).toBeUndefined();
  });

  it('requires a successful rite mark and an explicitly named written account', () => {
    const ctx = testWorld(content, 1042, 1200);
    const vessel = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Wystan', sex: 'male', age: 40 });
    ctx.world.chronicle = [page({ eventId: 'the_vessel_rite', people: [vessel.id, ascendant.id],
      text: 'Wystan said Meriel’s name. The book says she walked away.' })];
    ctx.world.decisionLog = [{ kind: 'outcome', event: 'the_vessel_rite', year: 1200,
      choiceId: 'speak_the_name', outcomeId: 'taken', fill: { VESSEL: [vessel.id], ASCENDANT: [ascendant.id] } }];
    expect(afterimageEvidence(ctx).spent).toBeUndefined();
    ctx.world.people.kill(vessel.id, 1200, 'given to the rite', 'vessel_consumed');
    const spent = afterimageEvidence(ctx).spent;
    expect(spent?.name).toBe('Meriel');
    expect(spent?.source.text).toBe('Wystan said Meriel’s name. The book says she walked away.');
    ctx.world.chronicle[0]!.text = null;
    expect(afterimageEvidence(ctx).spent).toBeUndefined();
  });

  it('keeps the oldest open embellishment, excluding proven and buried accounts', () => {
    const ctx = testWorld(content);
    for (const [id, state] of [['caught', 'proven'], ['answered', 'buried'], ['standing', 'open']] as const) {
      ctx.world.discrepancies.set(id, { state, severity: 'minor', provableBy: [] });
    }
    ctx.world.chronicle = [
      page({ year: 1150, record: 'embellish', discrepancyId: 'caught' }),
      page({ year: 1160, record: 'embellish', discrepancyId: 'answered' }),
      page({ year: 1170, record: 'embellish', discrepancyId: 'standing', text: 'The house never lied.' }),
      page({ year: 1180, record: 'embellish', discrepancyId: 'standing' }),
    ];
    expect(afterimageEvidence(ctx).embellishment).toMatchObject({ year: 1170, text: 'The house never lied.' });
  });

  it('reports only a preserved generation count, never reconstructing a lifetime minimum', () => {
    const ctx = testWorld(content);
    ctx.world.succession = [5, 2, 2].map((count, index) => ({
      person: asId('head'), name: 'Head', from: 1100 + index * 20,
      question: { kind: 'thin_line', opened: 1100 + index * 20, baseline: count,
        text: `Only ${count} of the blood are living.`, signature: `thin_line:${index}` },
    }));
    expect(afterimageEvidence(ctx).brush).toEqual({ count: 2,
      source: { year: 1120, text: 'Only 2 of the blood are living.' } });
    ctx.world.succession = [];
    expect(afterimageEvidence(ctx).brush).toBeUndefined();
  });

  it('supplies detached ending evidence and handles an empty or extinct house', () => {
    const ctx = testWorld(content, 1042, 1542);
    ctx.world.chronicle = [];
    ctx.world.succession = [];
    expect(afterimageEvidence(ctx)).toEqual({ people: [] });
    for (const p of ctx.world.people.blood(ctx.world.playerHouse)) {
      ctx.world.people.kill(p.id, 1542, 'the line ended');
    }
    expect(ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive')).toHaveLength(0);
    ctx.world.ending = { id: 'broken_line', year: 1542 };
    ctx.world.chronicle = [page({ text: null })];
    const before = digestOf(ctx);
    const evidence = epilogueOf(ctx)!.afterimage!;
    expect(evidence.blank?.text).toBeNull();
    evidence.blank!.text = 'Cannot write into the save.';
    expect(digestOf(ctx)).toBe(before);
  });
});
