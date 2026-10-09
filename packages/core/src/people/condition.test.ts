import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { beget, marry, phase, place, testWorld } from '../testing.js';
import { phenotypeOf } from './factory.js';
import { ACQUIRED_NUTRITION, ACQUIRED_SPACING } from './factory.js';
import { nutrition, spacing, tickCondition } from './condition.js';
import { proseOriginalHash } from '@ed/schema';
import { coreMessageAddress } from '../messages.js';
import { setProseMode, setProseVariants } from '../prose.js';
import { loadGame, saveGame } from '../save.js';

const content = loadContent();

describe('annual bodily condition', () => {
  it('lags the purse by a generation and recovers over two more', () => {
    const ctx = testWorld(content, 27, 1042);
    const person = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]!;
    person.acquired.health = -3;
    ctx.world.treasury = -120;

    const leanTarget = nutrition(ctx);
    expect(leanTarget).toBeLessThan(-4);
    expect(person.acquired[ACQUIRED_NUTRITION], 'one year moved like a switch').toBeGreaterThan(-1);

    for (let year = 1; year < 25; year++) nutrition(ctx);
    expect(person.acquired[ACQUIRED_NUTRITION], 'a lean generation left no bodily trace').toBeLessThan(-4);

    ctx.world.treasury = 10_000;
    for (let year = 0; year < 50; year++) nutrition(ctx);
    expect(person.acquired[ACQUIRED_NUTRITION], 'two fat generations did not undo the lean one').toBeGreaterThan(1);
    expect(person.acquired.health, 'condition decay erased an authored injury').toBe(-3);
  });

  it('makes birth spacing deterministic, bounded and recoverable', () => {
    const build = () => {
      const ctx = testWorld(content, 72, 1042);
      const mother = place(ctx, { sex: 'female', age: 25, name: 'Mother' });
      const father = place(ctx, { sex: 'male', age: 27, name: 'Father' });
      const child = place(ctx, { sex: 'female', age: 1, name: 'Child' });
      marry(ctx, mother, father);
      beget(ctx, child, mother, father);
      mother.acquired.fertility = 34;
      return { ctx, mother };
    };

    const a = build();
    const b = build();
    spacing(a.ctx, a.mother);
    spacing(b.ctx, b.mother);
    expect(a.mother.acquired[ACQUIRED_SPACING]).toBe(b.mother.acquired[ACQUIRED_SPACING]);
    expect(a.mother.acquired[ACQUIRED_SPACING]).toBeGreaterThanOrEqual(-45);
    expect(a.mother.acquired.fertility, 'spacing erased the Portion of Fertility').toBe(34);

    a.ctx.world.year += 5;
    for (let year = 0; year < 8; year++) spacing(a.ctx, a.mother);
    expect(Math.abs(a.mother.acquired[ACQUIRED_SPACING] ?? 0)).toBeLessThan(0.01);
  });

  it('touches neither Madness nor Eldritch expression', () => {
    const ctx = testWorld(content, 127, 1042);
    const before = ctx.world.people.all().map((p) => ({
      id: p.id,
      madness: p.madness,
      eldritch: phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch,
    }));
    ctx.world.treasury = -120;
    tickCondition(ctx);
    const after = ctx.world.people.all().map((p) => ({
      id: p.id,
      madness: p.madness,
      eldritch: phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch,
    }));
    expect(after).toEqual(before);
  });

  it('runs from the existing economy phase', () => {
    const ctx = testWorld(content, 27, 1042);
    const person = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]!;
    expect(person.acquired[ACQUIRED_NUTRITION]).toBeUndefined();
    ctx.world.treasury = -120;
    phase('economy', ctx);
    expect(person.acquired[ACQUIRED_NUTRITION]).toBeLessThan(0);
  });
});

const TITLE = 'The Lean Years';
const TEXT = 'The kitchen fires burned low. By spring, the children had stopped asking why.';

/** A house with nothing in the chest, on a year the decade line is written. */
function leanDecade(mode: 'original' | 'plainenglish') {
  const ctx = testWorld(content);
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
    const back = loadGame(saveGame(ctx), content);
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
