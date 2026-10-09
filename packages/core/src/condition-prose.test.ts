import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { nutrition, place, saveGame, loadGame, setProseMode, setProseVariants, testWorld } from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

const TITLE = 'The Lean Years';
const TEXT = 'The kitchen fires burned low. By spring, the children had stopped asking why.';

/** A house with nothing in the chest, on a year the decade line is written. */
function leanDecade(mode: 'original' | 'plainenglish') {
  const ctx = testWorld(bundle);
  setProseVariants(ctx, [
    { address: coreMessageAddress('condition.lean_years_title'), of: proseOriginalHash(TITLE), plainenglish: 'Hard Times' },
    {
      address: coreMessageAddress('condition.lean_years'),
      of: proseOriginalHash(TEXT),
      plainenglish: 'There was not enough food. By spring, the children no longer asked why.',
    },
  ]);
  setProseMode(ctx, mode);
  place(ctx, { sex: 'female', age: 9, name: 'Wren' });
  ctx.world.treasury = -50;
  ctx.world.year = Math.ceil(ctx.world.year / 10) * 10;
  const from = ctx.world.chronicle.length;
  const target = nutrition(ctx);
  return { ctx, target, pages: ctx.world.chronicle.slice(from) };
}

describe('the Lean Years line speaks the reader\'s setting (#734)', () => {
  it('keeps the Original byte for byte', () => {
    const { target, pages } = leanDecade('original');
    expect(target).toBeLessThanOrEqual(-4);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.title).toBe(TITLE);
    expect(pages[0]!.text).toBe(TEXT);
  });

  it('renders the reviewed Plain English and keeps it after the setting changes and a reload', () => {
    const { ctx, pages } = leanDecade('plainenglish');
    expect(pages).toHaveLength(1);
    expect(pages[0]!.title).toBe('Hard Times');
    expect(pages[0]!.text).toBe('There was not enough food. By spring, the children no longer asked why.');

    setProseMode(ctx, 'original');
    const back = loadGame(saveGame(ctx), bundle);
    expect(back.world.chronicle.at(-1)!.title).toBe('Hard Times');
    expect(back.world.chronicle.at(-1)!.text).toBe(pages[0]!.text);
  });

  it('changes words only: the hunger is the same in both settings', () => {
    const a = leanDecade('original');
    const b = leanDecade('plainenglish');
    expect(b.target).toBe(a.target);
    const fed = (r: ReturnType<typeof leanDecade>) => r.ctx.world.people.living().map((p) => p.acquired);
    expect(fed(b)).toEqual(fed(a));
  });
});
