import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type SpellbookId } from '@ed/schema';
import {
  beginStudy, bootstrap, canStudySpellbook, canUseHeirloom, digestOf,
  eligibleBearers, gainSpellbook, grantHeirloom, order, place, useHeirloom,
} from '@ed/core';

/**
 * Recovered worlds retain historical and even inconsistent source rows.
 * The presence of a world-owned object or a scheduled occupation must not
 * make tomorrow's person or duty available today. Keep the boundaries in
 * the public verbs rather than only hiding them in a Table projection.
 */
const content = loadContent();

describe('future-born book readers (#2832)', () => {
  it('refuses both starting and completing a book until the reader exists', () => {
    const ctx = bootstrap(content, 2832, 1042);
    const reader = place(ctx, { sex: 'female', age: 24, name: 'A future reader', awakened: true });
    const book = ctx.content.mustSpellbook('lesser_workings_of_life');
    expect(canStudySpellbook(ctx, reader, book).ok).toBe(true);

    // An imported person can remain marked alive and world-owned while their
    // recorded birth date has moved ahead of the current campaign year.
    const born = ctx.world.year + 3;
    reader.born = born;
    const before = digestOf(ctx);
    expect(canStudySpellbook(ctx, reader, book).ok).toBe(false);
    expect(beginStudy(ctx, reader, book)).toBe(false);
    expect(gainSpellbook(ctx, reader, book)).toBe(false);
    expect(ctx.world.studies.some(s => s.person === reader.id)).toBe(false);
    expect(reader.spellsKnown.some(id => String(id) === book.id)).toBe(false);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = born - 1;
    expect(canStudySpellbook(ctx, reader, book).ok).toBe(false);
    ctx.world.year = born;
    expect(canStudySpellbook(ctx, reader, book).ok).toBe(true);
    expect(beginStudy(ctx, reader, book)).toBe(true);
    expect(ctx.world.studies.some(s => s.person === reader.id && s.book === book.id)).toBe(true);
  });
});

describe('future-started Mystic assignments and the library (#2833)', () => {
  it('does not occupy a reader before the standing duty starts', () => {
    const ctx = bootstrap(content, 2833, 1042);
    ctx.world.treasury = 10_000;
    const keeper = place(ctx, { sex: 'female', age: 30, name: 'The keeper', awakened: true });
    const working = content.mysticWorking('the_still_binding')!;
    expect(working.benefit.kind).toBe('library_care');
    keeper.spellsKnown = working.books.map(book => asId<SpellbookId>(book));
    const keptBook = working.books[0]!;
    ctx.world.library.set(keptBook, { id: keptBook, acquiredYear: ctx.world.year, condition: 70 });
    const lifeBook = ctx.content.mustSpellbook('lesser_workings_of_life');
    expect(canStudySpellbook(ctx, keeper, lifeBook).ok).toBe(true);

    expect(order(ctx, {
      kind: 'mysticAssign',
      person: keeper.id,
      working: working.id,
      target: { kind: 'book', book: keptBook },
    }).ok).toBe(true);
    const duty = ctx.world.mystic.assignments.find(a => a.practitioner === keeper.id)!;
    expect(duty).toBeDefined();
    expect(canStudySpellbook(ctx, keeper, lifeBook).ok).toBe(false);

    // Keep the assignment, but import its actual start from a later year.
    // The normal occupied-reader check must not mistake its row for work today.
    duty.started = ctx.world.year + 3;
    expect(canStudySpellbook(ctx, keeper, lifeBook).ok).toBe(true);
    expect(beginStudy(ctx, keeper, lifeBook)).toBe(true);
    expect(ctx.world.studies.some(s => s.person === keeper.id && s.book === lifeBook.id)).toBe(true);

    ctx.world.year = duty.started - 1;
    expect(canStudySpellbook(ctx, keeper, lifeBook).ok).toBe(true);
    ctx.world.year = duty.started;
    expect(canStudySpellbook(ctx, keeper, lifeBook).ok).toBe(false);
  });
});

describe('future-born heirloom bearers (#2834)', () => {
  it('does not offer or spend a held object before the bearer is born', () => {
    const ctx = bootstrap(content, 2834, 1042);
    const year = ctx.world.year;
    const bearer = ctx.world.people.household(ctx.world.playerHouse, year)
      .find(p => year - p.born >= 20 && year - p.born <= 40)!;
    expect(bearer).toBeDefined();
    const id = 'portion_of_agelessness';
    const heirloom = grantHeirloom(ctx, id)!;
    expect(canUseHeirloom(ctx, id, bearer).ok).toBe(true);

    // An inconsistent restored membership may predate the recorded birth.
    // Even then, world-owned identity and current membership alone are not
    // enough to spend a charge against somebody not yet alive this year.
    const born = year + 2;
    bearer.born = born;
    const before = digestOf(ctx);
    expect(canUseHeirloom(ctx, id, bearer).ok).toBe(false);
    expect(eligibleBearers(ctx, id)).not.toContain(bearer);
    expect(useHeirloom(ctx, id, bearer).ok).toBe(false);
    expect(heirloom.spent).toBe(false);
    expect(heirloom.usedOn).toHaveLength(0);
    expect(digestOf(ctx)).toBe(before);

    ctx.world.year = born - 1;
    expect(canUseHeirloom(ctx, id, bearer).ok).toBe(false);
    ctx.world.year = born;
    expect(canUseHeirloom(ctx, id, bearer).ok).toBe(true);
  });
});
