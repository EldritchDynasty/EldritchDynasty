import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  bootstrap, loadGame, newGame, place, renameChild, saveGame, setProseMode,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const content = loadContent();
const TITLE = 'A Debt of Three Parts';
const NAMED = 'In the year 1042 {FOUNDER} signed something, and the house has been paying for it ever since.';
const UNNAMED = 'In the year 1042 the head of the house signed something, and the house has been paying for it ever since.';
const CHILD = '{NAME} was born, and named.';
const translated = {
  'founding.debt.title': [TITLE, 'The Three-Part Debt'],
  'founding.debt.named': [NAMED, 'In 1042, {FOUNDER} signed an agreement. The family has paid for it ever since.'],
  'founding.debt.unnamed': [UNNAMED, 'In 1042, the head of the family signed an agreement. The family has paid for it ever since.'],
  'founding.child_named': [CHILD, '{NAME} was born and received a name.'],
} as const;

const variants = Object.entries(translated).map(([key, [original, plainenglish]]) => ({
  address: coreMessageAddress(key),
  of: proseOriginalHash(original),
  plainenglish,
}));

type TestCtx = ReturnType<typeof bootstrap>;
function foundingPage(ctx: TestCtx) {
  const page = ctx.world.chronicle.find((entry) =>
    entry.title === TITLE || entry.title === translated['founding.debt.title'][1]);
  expect(page, 'bootstrap must write the founding page').toBeDefined();
  return page!;
}

describe('founding and naming Chronicle prose (#751)', () => {
  it('keeps the existing named Original byte-for-byte', () => {
    const ctx = bootstrap(content);
    const founder = ctx.world.people.all().find((p) => p.becomesGuardian)!;
    expect(foundingPage(ctx)).toMatchObject({
      title: TITLE,
      text: NAMED.replace('{FOUNDER}', founder.name),
      weight: 'illuminated',
      named: true,
    });
  });

  it('uses Plain English for the very first founding page, not just future pages', () => {
    const game = newGame(content, { proseMode: 'plainenglish', proseVariants: variants });
    const founder = game.ctx.world.people.all().find((p) => p.becomesGuardian)!;
    const page = foundingPage(game.ctx);
    expect(page.title).toBe('The Three-Part Debt');
    expect(page.text).toBe(translated['founding.debt.named'][1].replace('{FOUNDER}', founder.name));
    const written = { ...page };

    game.setProseMode('original');
    expect(foundingPage(game.ctx)).toEqual(written);

    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(game.ctx))), content);
    setProseMode(loaded, 'original');
    expect(foundingPage(loaded)).toEqual(written);
  });

  it('preserves Original and translates the fallback when there is no founder', () => {
    const noFounder = {
      ...content.bundle,
      characters: content.bundle.characters.map((character) => ({
        ...character, becomesGuardian: false,
      })),
    };
    const original = bootstrap(noFounder);
    const plain = bootstrap(noFounder, 1042, 1042, 'long', [], undefined, {
      mode: 'plainenglish', variants,
    });

    expect(foundingPage(original).text).toBe(UNNAMED);
    expect(foundingPage(plain).text).toBe(translated['founding.debt.unnamed'][1]);
    expect(foundingPage(plain).title).toBe('The Three-Part Debt');
    expect(plain.world.narrator).toBeUndefined();
    expect(original.world.narrator).toBeUndefined();
    expect(plain.world.succession).toEqual(original.world.succession);
  });

  it('takes the live reader settings into a signing rebuild before writing history', () => {
    const game = newGame(content);
    const before = foundingPage(game.ctx).text;
    game.setProseVariants(variants);
    game.setProseMode('plainenglish');
    const result = game.found({
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      founderName: 'Marek',
    });
    expect(result.ok).toBe(true);
    expect(foundingPage(game.ctx).text)
      .toBe(translated['founding.debt.named'][1].replace('{FOUNDER}', 'Marek'));
    expect(foundingPage(game.ctx).text).not.toBe(before);
    expect(game.ctx.prose.mode).toBe('plainenglish');
    const written = { ...foundingPage(game.ctx) };
    game.setProseMode('original');
    expect(foundingPage(game.ctx)).toEqual(written);
    expect(foundingPage(loadGame(JSON.parse(JSON.stringify(saveGame(game.ctx))), content)))
      .toEqual(written);
  });

  it('renders naming prose without changing the named child, queue or decision log', () => {
    const makeChild = (mode: 'original' | 'plainenglish') => {
      const ctx = bootstrap(content, 1042, 1042, 'long', [], undefined, { mode, variants });
      const child = place(ctx, { name: 'Offered Child', sex: 'female', age: 0 });
      ctx.world.pendingNames.push({
        person: child.id,
        born: ctx.world.year,
        suggested: child.name,
        sex: child.sex,
        because: 'a pending name for the test',
      });
      expect(renameChild(ctx, child.id, 'Sorrel')).toBe(true);
      return { ctx, child, page: ctx.world.chronicle.at(-1)! };
    };

    const original = makeChild('original');
    const plain = makeChild('plainenglish');
    expect(original.page).toMatchObject({ text: 'Sorrel was born, and named.', named: false, weight: 'line' });
    expect(plain.page).toMatchObject({
      text: 'Sorrel was born and received a name.', named: false, weight: 'line',
    });
    expect(plain.child).toEqual(original.child);
    expect(plain.ctx.world.pendingNames).toEqual(original.ctx.world.pendingNames);
    expect(plain.ctx.world.decisionLog).toEqual(original.ctx.world.decisionLog);
    expect(plain.ctx.takenNames).toEqual(original.ctx.takenNames);

    setProseMode(plain.ctx, 'original');
    expect(plain.ctx.world.chronicle.at(-1)).toEqual(plain.page);
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(plain.ctx))), content);
    expect(loaded.world.chronicle.at(-1)?.text).toBe('Sorrel was born and received a name.');
  });
});
