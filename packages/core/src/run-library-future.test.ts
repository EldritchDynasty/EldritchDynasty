import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { libraryRunOf, loadGame, newGame, saveGame, seedLibraryMemories } from '@ed/core';

const bundle = loadContent();

describe('the Library stops at the completed house\'s term (#2705)', () => {
  it('does not export or inherit future testimony, but retains a page dated at the ending', () => {
    const term = 1342;
    const source = newGame(bundle, { seed: 2705, campaign: 'short', decider: 'chronicler' });
    const w = source.ctx.world;
    w.chronicle.length = 0;
    w.ending = { id: 'forgotten', year: term };

    const person = w.people.household(w.playerHouse, source.year)[0]!;
    const trait = bundle.trait('reads_the_signs')!;
    const survivingText = 'The house left this account before collection.';
    const futureText = 'This later testimony was not yet written.';
    w.chronicle.push({
      id: 'surviving_term_leaf', year: term, weight: 'line', named: true,
      record: 'record', text: survivingText,
    });
    const baseline = libraryRunOf(source.ctx)!;
    expect(baseline.entries.map((entry) => entry.id)).toEqual(['surviving_term_leaf']);

    // An inconsistent imported Chronicle can carry a future, high-scoring
    // embellished claim. It cannot alter the final archive or its stable id.
    w.chronicle.push({
      id: 'future_term_leaf', year: term + 1, weight: 'illuminated', named: true,
      record: 'embellish', text: futureText,
      claims: [{ kind: 'trait', person: person.id, trait: trait.id, has: true }],
    });
    expect(libraryRunOf(source.ctx)).toEqual(baseline);
    expect(libraryRunOf(loadGame(saveGame(source.ctx), bundle))).toEqual(baseline);

    const follower = newGame(bundle, { seed: 2706, campaign: 'short', decider: 'chronicler' });
    const memories = seedLibraryMemories(follower.ctx, [libraryRunOf(source.ctx)!]);
    expect(memories.map((memory) => memory.sourceText)).toEqual([survivingText]);

    // A page dated exactly at the final term is legitimate evidence, and its
    // claim is eligible for a later house to encounter in inherited testimony.
    w.chronicle.at(-1)!.year = term;
    const withFinalPage = libraryRunOf(source.ctx)!;
    expect(withFinalPage.entries).toHaveLength(2);
    expect(withFinalPage.entries.map((entry) => entry.id))
      .toEqual(['future_term_leaf', 'surviving_term_leaf']);
    expect(withFinalPage.id).not.toBe(baseline.id);
    const secondFollower = newGame(bundle, { seed: 2706, campaign: 'short', decider: 'chronicler' });
    const inherited = seedLibraryMemories(secondFollower.ctx, [withFinalPage]);
    expect(inherited.some((memory) => memory.sourceText === futureText)).toBe(true);
  });
});
