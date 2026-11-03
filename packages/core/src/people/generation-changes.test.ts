import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { newGame, place } from '@ed/core';
import { asId, type PersonId } from '@ed/schema';
import { setProseMode } from '../prose.js';
import { generationChangesOf } from './generation-changes.js';

const content = loadContent();

describe('future succession tenures stay outside the generation reader (#2747)', () => {
  it('shows the present generation until a later tenure actually starts', () => {
    const game = newGame(content, { seed: 274701 });
    const ctx = game.ctx;
    const w = ctx.world;
    w.year = 1100;
    const first = w.succession[0]!;
    const future = { person: asId<PersonId>('p_future_head'), name: 'A Later Head', from: 1101 };
    w.succession = [first, future];
    const unchanged = structuredClone(w.succession);

    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(generationChangesOf(ctx)).toMatchObject({
        count: 1, index: 0, tenure: { person: first.person, name: first.name, from: first.from },
        through: 1100,
      });
      // The future tenure also cannot be chosen by requesting its saved index.
      expect(generationChangesOf(ctx, 1).tenure?.person).toBe(first.person);
      expect(w.succession).toEqual(unchanged);
    }

    w.year = 1101;
    expect(generationChangesOf(ctx)).toMatchObject({
      count: 2, index: 1, tenure: { person: future.person, name: future.name, from: 1101 },
      through: 1101,
    });
    expect(generationChangesOf(ctx, 0).tenure?.person).toBe(first.person);
    expect(w.succession).toEqual(unchanged);
  });

  it('does not create a generation out of an entirely future-dated history', () => {
    const game = newGame(content, { seed: 274702 });
    game.ctx.world.year = 1100;
    const future = { person: asId<PersonId>('p_future_head'), name: 'A Later Head', from: 1101 };
    game.ctx.world.succession = [future];
    expect(generationChangesOf(game.ctx)).toEqual({
      index: 0, count: 0, through: 1100, changes: [], more: 0,
    });
    expect(game.ctx.world.succession).toEqual([future]);
  });
});

function deathInCurrentGeneration(seed: number) {
  const session = newGame(content, { seed });
  const ctx = session.ctx;
  const w = ctx.world;
  w.year = 1100;
  w.chronicle = [];
  const person = place(ctx, { sex: 'male', age: 45, name: 'Relative in the book' });
  person.membership[0]!.from = person.born;
  w.people.kill(person.id, 1093, 'the years');
  const readDeath = () => generationChangesOf(ctx).changes
    .find((row) => row.kind === 'death' && row.person === person.id);
  return { w, person, readDeath };
}

describe('generation changes use testimony available by the current year (#2685)', () => {
  it('does not link to an imported future death claim until that page can be read', () => {
    const { w, person, readDeath } = deathInCurrentGeneration(268501);
    w.chronicle.push({
      id: 'later-account', year: 1105, weight: 'paragraph',
      text: 'A later chronicler rewrote the death.', named: false, people: [person.id],
      record: 'embellish',
      claims: [{ kind: 'death', person: person.id, year: 1096, cause: 'the later version' }],
    });

    expect(readDeath()).toMatchObject({ kind: 'death', person: person.id, year: 1093 });
    expect(readDeath()?.pageId).toBeUndefined();

    w.year = 1105;
    expect(readDeath()).toMatchObject({
      kind: 'death', person: person.id, year: 1096, pageId: 'later-account',
    });
  });

  it('preserves full-book legacy ids when a future page precedes a dated claim', () => {
    const { w, person, readDeath } = deathInCurrentGeneration(268502);
    w.chronicle.push({
      year: 1105, weight: 'paragraph', text: 'A page not yet written.', named: false,
    });
    w.chronicle.push({
      year: 1096, weight: 'paragraph', text: 'An account already written.', named: false,
      people: [person.id], record: 'embellish',
      claims: [{ kind: 'death', person: person.id, year: 1095, cause: 'the account' }],
    });

    expect(readDeath()).toMatchObject({
      kind: 'death', person: person.id, year: 1095, pageId: 'legacy-chronicle:1',
    });
    // The future entry still occupies index zero in the saved Chronicle;
    // read-only generation projections must not renumber its neighbour.
    expect(w.chronicle.every((page) => page.id === undefined)).toBe(true);
  });
});
