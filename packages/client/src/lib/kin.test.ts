import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, runYears, viewOf } from '@ed/core';
import { children, drawnBeside, kinshipPath, partner, roots, type MemberView } from './kin.js';

/**
 * THE TREE, WITH MARRIAGES IN IT (issue #56).
 *
 * A game about a bloodline drew a bloodline with no marriages: the tree nests
 * by parentage, so a woman married in from another house had no parent here,
 * became a root, and sat between two of the house's own children as an
 * unrelated row — joined to her husband by a line of text inside a card
 * nobody had opened.
 *
 * The first test below is the one that matters. Pairing people up means
 * choosing not to draw somebody on a row of their own, and children hang off
 * whichever parent the RECORD names — which may well be the married-in one. Do
 * this carelessly and a woman's descendants leave the tree without a sound,
 * which is this repository's failure mode with a family in it.
 */
function person(over: Partial<MemberView> & { id: string }): MemberView {
  return {
    name: over.id, sex: 'female', age: 30, status: 'alive', head: false,
    awakened: false, expresses: false, madness: 0,
    attrs: {}, parents: {},
    record: { attrs: {}, claimedTraits: [], parents: {}, claimed: [] },
    drift: false,
    ...over,
  } as MemberView;
}

/** A blood son, a wife married in, and a child the record hangs under HER. */
function marriedIn(): MemberView[] {
  return [
    person({ id: 'grand' }),
    person({
      id: 'son',
      sex: 'male',
      record: { attrs: {}, claimedTraits: [], parents: { father: 'grand' }, claimed: [] },
      spouse: { id: 'wife', name: 'Eilwen', marriedIn: true, house: 'House Ilm' },
    }),
    person({
      id: 'wife',
      spouse: { id: 'son', name: 'son', marriedIn: false },
    }),
    // The record names the MOTHER, so this child hangs under the married-in one.
    person({
      id: 'child',
      record: { attrs: {}, claimedTraits: [], parents: { mother: 'wife' }, claimed: [] },
    }),
  ];
}

describe('drawing a couple as a couple', () => {
  /**
   * Every living member of a hall appears exactly once, whatever the pairing
   * does. This is the assertion the feature is dangerous without.
   */
  it('draws everybody, exactly once', () => {
    const hall = marriedIn();
    const seen: string[] = [];
    const walk = (m: MemberView): void => {
      seen.push(m.id);
      const beside = drawnBeside(m, hall);
      if (beside) seen.push(beside.id);
      for (const kid of children(m, hall)) walk(kid);
    };
    for (const r of roots(hall)) walk(r);

    expect([...seen].sort()).toEqual(['child', 'grand', 'son', 'wife']);
    expect(seen.length, 'somebody is drawn twice').toBe(new Set(seen).size);
  });

  it('takes the married-in wife off her own row and puts her beside him', () => {
    const hall = marriedIn();
    expect(roots(hall).map((m) => m.id)).toEqual(['grand']);
    expect(drawnBeside(hall.find((m) => m.id === 'son')!, hall)?.id).toBe('wife');
  });

  /**
   * The trap. The record hangs this child under the MOTHER, who is no longer a
   * row — so the child has to arrive under the couple, or vanish.
   */
  it('keeps a child the record hangs under the attached parent', () => {
    const hall = marriedIn();
    const son = hall.find((m) => m.id === 'son')!;
    expect(children(son, hall).map((m) => m.id)).toContain('child');
  });

  /**
   * Two rootless partners stay two rows. Attaching either to the other means
   * picking one arbitrarily, and the arbitrary pick is the one that reads as a
   * mistake.
   */
  it('leaves a pair with no blood here as two rows', () => {
    const hall = [
      person({ id: 'a', spouse: { id: 'b', name: 'b', marriedIn: true, house: 'House Ilm' } }),
      person({ id: 'b', spouse: { id: 'a', name: 'a', marriedIn: true, house: 'House Ilm' } }),
    ];
    expect(roots(hall).map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(drawnBeside(hall[0]!, hall)).toBeUndefined();
  });

  it('says nothing about a spouse who is in no hall of ours', () => {
    const hall = [person({ id: 'lone', spouse: { id: 'elsewhere', name: 'Far', marriedIn: true } })];
    expect(partner(hall[0]!, hall)).toBeUndefined();
    expect(drawnBeside(hall[0]!, hall)).toBeUndefined();
    expect(roots(hall).map((m) => m.id)).toEqual(['lone']);
  });
});


describe('recorded kinship paths (#268)', () => {
  it('crosses a cadet-hall boundary when the caller supplies both halls', () => {
    const seat = [
      person({ id: 'grand', sex: 'male' }),
      person({
        id: 'father',
        sex: 'male',
        record: { attrs: {}, claimedTraits: [], parents: { father: 'grand' }, claimed: [] },
      }),
    ];
    const cadet = [
      person({
        id: 'daughter',
        record: { attrs: {}, claimedTraits: [], parents: { father: 'father' }, claimed: [] },
      }),
    ];

    const path = kinshipPath('daughter', 'grand', [...seat, ...cadet]);
    expect(path?.map((step) => [step.person.id, step.relation])).toEqual([
      ['father', 'father'],
      ['grand', 'father'],
    ]);
  });

  it('walks through a married-in spouse', () => {
    const hall = marriedIn();
    const path = kinshipPath('grand', 'wife', hall);

    expect(path?.map((step) => [step.person.id, step.relation])).toEqual([
      ['son', 'son'],
      ['wife', 'wife'],
    ]);
  });

  it('follows a forged record rather than the hidden parentage', () => {
    const members = [
      person({ id: 'truth', sex: 'male' }),
      person({ id: 'claimed', sex: 'male' }),
      person({
        id: 'child',
        sex: 'male',
        parents: { father: 'truth' },
        record: { attrs: {}, claimedTraits: [], parents: { father: 'claimed' }, claimed: [] },
      }),
    ];

    expect(kinshipPath('child', 'claimed', members)?.map((step) => step.relation))
      .toEqual(['father']);
    expect(kinshipPath('child', 'truth', members)).toBeUndefined();
  });

  it('returns undefined rather than guessing when the recorded graph is disconnected', () => {
    const members = [person({ id: 'a' }), person({ id: 'b' })];
    expect(kinshipPath('a', 'b', members)).toBeUndefined();
    expect(kinshipPath('a', 'a', members)).toEqual([]);
  });
});

/**
 * And the same claim against real households, because the fixtures above are
 * the shapes I thought of. Four hundred years of a house produces marriages,
 * cadet branches, widows, remarriages and cousin matches, and every living
 * member of every hall still has to be on the tree exactly once.
 */
describe('nobody falls off a real tree', () => {
  it('draws every member of every hall, once, across a played run', () => {
    for (const seed of [1042, 909, 8080]) {
      const ctx = bootstrap(loadContent(), seed, 1042);
      runYears(ctx, 400);

      for (const hall of viewOf(ctx).halls) {
        const members = hall.members as MemberView[];
        const seen: string[] = [];
        const walk = (m: MemberView): void => {
          seen.push(m.id);
          const beside = drawnBeside(m, members);
          if (beside) seen.push(beside.id);
          for (const kid of children(m, members)) walk(kid);
        };
        for (const r of roots(members)) walk(r);

        expect(
          seen.length,
          `seed ${seed}, hall ${hall.id}: somebody is drawn twice`,
        ).toBe(new Set(seen).size);
        expect(
          [...new Set(seen)].sort(),
          `seed ${seed}, hall ${hall.id}: somebody left the tree`,
        ).toEqual(members.map((m) => m.id).sort());
      }
    }
  });
});
