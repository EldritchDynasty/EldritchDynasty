import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { chapterOf, MIN_CHAPTER_YEARS } from './chapter.js';
import { place, testWorld } from './testing.js';
import { saveGame, loadGame } from './save.js';
import { runYears } from './year/step.js';
import { GameSession } from './session.js';
import type { SimCtx } from './world.js';
import type { EndedAge } from '@ed/schema';
import { proseOriginalHash } from '@ed/schema';
import { canonical } from './save.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

describe('chapter fallback prose (#919)', () => {
  const messages = coreMessageEntries(readFileSync(new URL('./chapter.ts', import.meta.url), 'utf8'));
  const variants = messages.map((entry) => ({
    address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `Plain: ${entry.text}`,
  }));

  function fixture(births = 0) {
    const ctx = testWorld(bundle);
    ctx.world.chronicle = [];
    ctx.world.year = 1060;
    const ended = close(ctx, 'the_wars', 1042, 1060, false);
    for (let i = 0; i < births; i++) place(ctx, { sex: 'female', age: 2, name: `Child ${i}` });
    setProseVariants(ctx, variants);
    return { ctx, ended };
  }

  it('keys every fallback and preserves Original words, facts and saved pages', () => {
    expect(messages).toHaveLength(7);
    const { ctx, ended } = fixture(2);
    const heir = place(ctx, { sex: 'male', age: 30, name: 'Rowan' });
    ctx.world.succession.push({ person: heir.id, name: heir.name, from: 1050 });
    const dead = place(ctx, { sex: 'female', age: 50, name: 'Mara' });
    ctx.world.people.kill(dead.id, 1055, 'fixture');
    ctx.world.chronicle.push({ year: 1051, weight: 'page', text: 'The words we wrote then.', named: false });
    const before = canonical(saveGame(ctx));
    const original = chapterOf(ctx, ended)!;
    expect(original.verdict.map((line) => line.text)).toEqual([
      'The words we wrote then.', 'Rowan took the seal.', 'Mara died.', '2 children were born to the house.',
    ]);
    setProseMode(ctx, 'plainenglish');
    expect(chapterOf(ctx, ended)!.verdict.map((line) => line.text)).toEqual([
      'The words we wrote then.', 'Plain: Rowan took the seal.', 'Plain: Mara died.',
      'Plain: 2 children were born to the house.',
    ]);
    expect(original.verdict[1]!.text).toBe('Rowan took the seal.');
    expect(canonical(saveGame(ctx))).toBe(before);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });

  it('selects singular births and all three quiet-window facts', () => {
    for (const births of [0, 1]) {
      const { ctx, ended } = fixture(births);
      const original = chapterOf(ctx, ended)!;
      if (births === 1) expect(original.verdict[0]!.text).toBe('1 child was born to the house.');
      else expect(original.verdict[2]!.text).toBe(`The treasury held ${Math.round(ctx.world.treasury)} crowns.`);
      setProseMode(ctx, 'plainenglish');
      expect(chapterOf(ctx, ended)!.verdict).toEqual(original.verdict.map(({ text }) => ({ text: `Plain: ${text}` })));
      expect(missingPlainEnglish(ctx)).toEqual([]);
    }
  });

  it.each(['missing', 'stale', 'tokens'] as const)('falls back and reports %s variants', (failure) => {
    const { ctx, ended } = fixture();
    const original = chapterOf(ctx, ended);
    setProseVariants(ctx, failure === 'missing' ? [] : variants.map((variant) => ({
      ...variant,
      ...(failure === 'stale' ? { of: proseOriginalHash('older wording') } : { plainenglish: 'Missing the fact.' }),
    })));
    setProseMode(ctx, 'plainenglish');
    expect(chapterOf(ctx, ended)).toEqual(original);
    expect(missingPlainEnglish(ctx)).toEqual([
      'core:messages#chapter.living', 'core:messages#chapter.standing', 'core:messages#chapter.treasury',
    ]);
  });
});

/** A closed Age at `began`..`ended`, appended to `ctx.world.age.ended` directly. */
function close(ctx: SimCtx, age: string, began: number, ended: number, named = true): EndedAge {
  const entry: EndedAge = { age, began, ended, named, ...(named ? { namedAt: began + 1 } : {}) };
  ctx.world.age.ended.push(entry);
  return entry;
}

describe('the chapter is the closing, not the Age (issue #65)', () => {
  it('windows from the founding year when there is no prior closing', () => {
    const ctx = testWorld(bundle, 4200, 1042);
    const ended = close(ctx, 'the_wars', 1050, 1080);
    const view = chapterOf(ctx, ended)!;
    expect(view.from).toBe(1042);
    expect(view.to).toBe(1080);
  });

  it('windows from the previous closing, not from the Age\'s own began — the disjoint-partition finding', () => {
    const ctx = testWorld(bundle, 4201, 1042);
    close(ctx, 'the_long_peace', 1042, 1100);
    // A second Age began at 1070, overlapping the first, and closed later —
    // measured, this is 49.4% of all years. Its chapter must not restate 1070-1100.
    const second = close(ctx, 'the_wars', 1070, 1140);
    const view = chapterOf(ctx, second)!;
    expect(view.from).toBe(1100);
    expect(view.to).toBe(1140);
  });

  it('is a boundary at and above MIN_CHAPTER_YEARS, and not below it', () => {
    const ctx = testWorld(bundle, 4202, 1042);
    const short = close(ctx, 'the_plague', 1042, 1042 + MIN_CHAPTER_YEARS - 1);
    expect(chapterOf(ctx, short)!.boundary).toBe(false);
    const ctx2 = testWorld(bundle, 4203, 1042);
    const long = close(ctx2, 'the_plague', 1042, 1042 + MIN_CHAPTER_YEARS);
    expect(chapterOf(ctx2, long)!.boundary).toBe(true);
  });

  it('withholds the name until the chronicle named it (§20 r1) — never invents a word the family never had', () => {
    const ctx = testWorld(bundle, 4204, 1042);
    const unnamed = close(ctx, 'the_insurrection', 1042, 1060, false);
    const view = chapterOf(ctx, unnamed)!;
    expect(view.name).toBeUndefined();
    expect(view.age).toBe('the_insurrection');
  });

  it('is undefined for an Age the content bundle no longer defines', () => {
    const ctx = testWorld(bundle, 4205, 1042);
    const ended = close(ctx, 'no_such_age', 1042, 1060);
    expect(chapterOf(ctx, ended)).toBeUndefined();
  });

  it('never falls short of three verdict lines, even on a quiet window with an empty chronicle', () => {
    const ctx = testWorld(bundle, 4206, 1042);
    ctx.world.chronicle = [];
    const ended = close(ctx, 'the_withering', 1042, 1042 + MIN_CHAPTER_YEARS);
    const view = chapterOf(ctx, ended)!;
    expect(view.verdict.length).toBeGreaterThanOrEqual(3);
  });

  it('draws its verdict from the chronicle when there is one, ranked page over paragraph', () => {
    const ctx = testWorld(bundle, 4207, 1042);
    ctx.world.chronicle.push(
      { year: 1050, weight: 'paragraph', text: 'A quiet fact.', named: false },
      { year: 1055, weight: 'page', title: 'The Wars', text: 'They began to call it The Wars.', named: true },
      { year: 1042, weight: 'paragraph', text: 'Before the window — must not appear.', named: false },
    );
    const ended = close(ctx, 'the_wars', 1042, 1060);
    const view = chapterOf(ctx, ended)!;
    expect(view.verdict[0]!.text).toBe('They began to call it The Wars.');
    expect(view.verdict.some((l) => l.text.includes('Before the window'))).toBe(false);
  });

  it('excludes line-weight chronicle entries and null (dated-blank) text from the verdict', () => {
    const ctx = testWorld(bundle, 4208, 1042);
    ctx.world.chronicle.push(
      { year: 1050, weight: 'line', text: 'Too small to be a verdict fact.', named: false },
      { year: 1051, weight: 'paragraph', text: null, named: false, record: 'omit' },
    );
    const ended = close(ctx, 'the_wars', 1042, 1060);
    const view = chapterOf(ctx, ended)!;
    expect(view.verdict.some((l) => l.text.includes('Too small'))).toBe(false);
  });
});

describe('a played run: every closing carries a verdict, and a save round-trips it (issue #65)', () => {
  const seeds = [4300, 4301, 4302, 4303, 4305, 4306, 4307, 4308];

  it('every closing across eight played 400-year runs yields at least three lines', () => {
    let closings = 0;
    for (const seed of seeds) {
      const ctx = testWorld(bundle, seed, 1042);
      runYears(ctx, 400);
      for (const ended of ctx.world.age.ended) {
        closings++;
        const view = chapterOf(ctx, ended);
        expect(view, `seed ${seed}, ${ended.age} closing at ${ended.ended}`).toBeDefined();
        expect(view!.verdict.length).toBeGreaterThanOrEqual(3);
      }
    }
    // A batch that closed nothing would pass every assertion above vacuously
    // and prove nothing — this is the check that it actually exercised the
    // thing being claimed.
    expect(closings).toBeGreaterThan(0);
  });

  it('reconstructs the same chapter after a save/load round-trip', () => {
    // Any seed in the batch above will do — this asserts the round-trip, not
    // a particular seed's history — so the first one that actually closed an
    // Age within the window is used rather than one picked in advance.
    let ctx: SimCtx | undefined;
    for (const seed of seeds) {
      const candidate = testWorld(bundle, seed, 1042);
      runYears(candidate, 400);
      if (candidate.world.age.ended.length) { ctx = candidate; break; }
    }
    if (!ctx) throw new Error('none of the seeds above closed an Age in 400 years — widen the batch');
    const ended = ctx.world.age.ended[0]!;
    const before = chapterOf(ctx, ended);
    const reloaded = loadGame(saveGame(ctx), bundle);
    const after = chapterOf(reloaded, reloaded.world.age.ended[0]!);
    expect(after).toEqual(before);
  });

  it('advance() folds a chapter into AdvanceResult exactly on the years a closing happened, in both the ordinary and the docket-blocked return', () => {
    const session = new GameSession(testWorld(bundle, 4301, 1042), 'chronicler');
    let sawAny = false;
    for (let i = 0; i < 400; i++) {
      const turned = session.advance(1);
      if (turned.chapters.length) {
        sawAny = true;
        for (const view of turned.chapters) expect(view.verdict.length).toBeGreaterThanOrEqual(3);
      }
      if (turned.stoppedBy === 'decision') break;
    }
    expect(sawAny).toBe(true);
  });
});
