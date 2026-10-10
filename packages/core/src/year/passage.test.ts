import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coreMessageAddress, msg } from '../messages.js';
import { setProseMode, setProseVariants } from '../prose.js';
import { plainEnglishCoreWorkItems } from '../tools/string-audit.js';
import { beget, phase, place, testWorld } from '../testing.js';
import { beginStudy } from '../people/library.js';
import type { SimCtx } from '../world.js';
import { emptyReport } from './report.js';
import { passageOf } from './passage.js';

const bundle = loadContent();

/**
 * WHAT THE YEARS DID (issue #49).
 *
 * The failure being guarded is not a crash and never was. `stepYear` has
 * reported every birth, death and awakening since it was written, and for the
 * whole life of the client every one of them went into `g.advance(1)` and was
 * dropped on the floor — which looks, from outside, precisely like a family
 * that had a quiet century.
 *
 * So these assert that a year which did something SAYS something, and that
 * what it says is about the people it actually happened to.
 */
describe('a year, as lines', () => {
  it('says nothing about a year that did nothing', () => {
    const ctx = testWorld(bundle, 4401);
    // The quiet is the common case — a thousand-year run is mostly this — and
    // a log with nine hundred empty dated rows in it is a log nobody reads.
    expect(passageOf(ctx, emptyReport(ctx.world.year))).toBeUndefined();
  });

  it('gives a death the age and the cause it was killed with', () => {
    const ctx = testWorld(bundle, 4402);
    const w = ctx.world;
    const p = place(ctx, { sex: 'male', age: 61, name: 'Tamsin' });
    w.people.kill(p.id, w.year, 'the blood, overflowing');

    const report = emptyReport(w.year);
    report.deaths.push(p);

    const passage = passageOf(ctx, report)!;
    expect(passage.year).toBe(w.year);
    expect(passage.lines).toHaveLength(1);
    expect(passage.lines[0]!.kind).toBe('death');
    expect(passage.lines[0]!.text).toBe('Tamsin died at 61 — the blood, overflowing.');
    // The line is about somebody, and says which somebody, so a client can
    // take a click on it back to the person.
    expect(passage.lines[0]!.person).toBe(p.id);
  });

  it('leaves off a cause that says nothing', () => {
    const ctx = testWorld(bundle, 4403);
    const w = ctx.world;
    const p = place(ctx, { sex: 'female', age: 30, name: 'Osla' });
    w.people.kill(p.id, w.year, 'unrecorded');

    const report = emptyReport(w.year);
    report.deaths.push(p);
    expect(passageOf(ctx, report)!.lines[0]!.text).toBe('Osla died at 30.');
  });

  /**
   * THE STALE-NAME GUARD, which is the whole reason a birth names the mother.
   *
   * A newborn arrives carrying the chronicler's suggestion and sits in the
   * naming queue until the player answers it. A line written at birth with
   * the child's name in it would still say Rowan after the player named him
   * Aldous — a permanent, plausible, unfalsifiable wrong fact about a person,
   * in the one panel that is supposed to be the record that cannot lie.
   */
  it('names the mother of a newborn and never the newborn', () => {
    const ctx = testWorld(bundle, 4404);
    const mother = place(ctx, { sex: 'female', age: 28, name: 'Eilwen' });
    const child = place(ctx, { sex: 'female', age: 0, name: 'Rowan' });
    beget(ctx, child, mother);

    const report = emptyReport(ctx.world.year);
    report.births.push(child);

    const text = passageOf(ctx, report)!.lines[0]!.text;
    expect(text).toBe('A daughter born to Eilwen.');
    expect(text).not.toContain('Rowan');
  });

  it('still reports a birth to a mother the house cannot name', () => {
    const ctx = testWorld(bundle, 4405);
    const child = place(ctx, { sex: 'male', age: 0, name: 'Nobody' });

    const report = emptyReport(ctx.world.year);
    report.births.push(child);
    expect(passageOf(ctx, report)!.lines[0]!.text).toBe('A son born.');
  });

  /**
   * The order the phases produced them in — `lifecycle` wakes and kills, and
   * `births` bears afterwards. A log that sorted these would be telling the
   * year differently from the way the year went.
   */
  it('tells the year in the order the year happened', () => {
    const ctx = testWorld(bundle, 4406);
    const w = ctx.world;
    const woken = place(ctx, { sex: 'male', age: 19, name: 'Aldous' });
    const dead = place(ctx, { sex: 'male', age: 70, name: 'Osric' });
    const babe = place(ctx, { sex: 'female', age: 0, name: 'Tamsin' });
    w.people.kill(dead.id, w.year, 'in the ordinary way');

    const report = emptyReport(w.year);
    report.awakenings.push(woken);
    report.deaths.push(dead);
    report.births.push(babe);

    expect(passageOf(ctx, report)!.lines.map((l) => l.kind))
      .toEqual(['awakening', 'death', 'birth']);
    expect(passageOf(ctx, report)!.lines[0]!.text).toBe('Aldous awakened.');
  });

  /**
   * AN AWAKENING IS ONE EVENT AND TWO FACTS (issue #78).
   *
   * §11 times a daughter's Awakening by what she carries rather than by what
   * she can use, so most awakenings in the game are women's — and for the
   * whole life of this log every one of them read "she awakened", which in a
   * game about who expresses is the wrong four words about six people in ten.
   *
   * A woman is the deterministic case and the reason it matters: `canExpress`
   * is false for her at any font, on any seed, so this asserts the branch and
   * not a draw. The line stops at the fact — the houses have no word for the
   * difference (§11) and the log does not get to invent one.
   */
  it('says the second true thing about a waking the Power will not come through', () => {
    const ctx = testWorld(bundle, 4407);
    const her = place(ctx, { sex: 'female', age: 15, name: 'Selwyn' });

    const report = emptyReport(ctx.world.year);
    report.awakenings.push(her);

    expect(passageOf(ctx, report)!.lines[0]!.text)
      .toBe('Selwyn awakened, and it will not come through.');
  });
});

/**
 * The yearly report is a view, not saved history. A reader may switch wording
 * before asking for the next report without changing the people it records.
 */
describe('year-passage prose identities (#710)', () => {
  it('uses stable authored keys for every passage sentence', () => {
    const source = readFileSync(join(import.meta.dirname, 'passage.ts'), 'utf8');
    const keys = plainEnglishCoreWorkItems('year/passage.ts', source)
      .map((entry) => entry.address)
      .filter((address) => address.startsWith('core:messages#passage.'));
    expect(keys).toEqual(expect.arrayContaining([
      coreMessageAddress('passage.study.finished'),
      coreMessageAddress('passage.awakening.expressing'),
      coreMessageAddress('passage.awakening.unexpressed'),
      coreMessageAddress('passage.death.cause'),
      coreMessageAddress('passage.death.plain'),
      coreMessageAddress('passage.birth.daughter.named'),
      coreMessageAddress('passage.birth.son.named'),
      coreMessageAddress('passage.birth.daughter.unknown'),
      coreMessageAddress('passage.birth.son.unknown'),
    ]));
    expect(keys).toHaveLength(9);
    // New preceding literals may move old ordinal positions, but cannot
    // renumber a reviewed core:messages key.
    const inserted = plainEnglishCoreWorkItems(
      'year/passage.ts',
      'const earlier = "A new sentence before the passage."\n' + source,
    ).map((entry) => entry.address).filter((address) => address.startsWith('core:messages#passage.'));
    expect(inserted).toEqual(keys);
  });

  it('switches death wording prospectively and restores unchanged Original', () => {
    const ctx = testWorld(bundle, 4410);
    const w = ctx.world;
    const person = place(ctx, { sex: 'female', age: 35, name: 'Mara' });
    w.people.kill(person.id, w.year, 'unrecorded');
    const report = emptyReport(w.year);
    report.deaths.push(person);

    const original = passageOf(ctx, report)!;
    expect(original.lines[0]!.text).toBe('Mara died at 35.');

    setProseVariants(ctx, [{
      address: coreMessageAddress('passage.death.plain'),
      of: proseOriginalHash('{NAME} died at {AGE}.'),
      plainenglish: 'At age {AGE}, {NAME} died.',
    }]);
    setProseMode(ctx, 'plainenglish');
    const alternative = passageOf(ctx, report)!;
    expect(alternative.lines[0]!.text).toBe('At age 35, Mara died.');
    expect(alternative.lines[0]!.person).toBe(person.id);
    expect(alternative.lines[0]!.kind).toBe('death');
    // Switching cannot rewrite a line already handed to the player.
    expect(original.lines[0]!.text).toBe('Mara died at 35.');

    setProseMode(ctx, 'original');
    expect(passageOf(ctx, report)).toEqual(original);
  });

  it('falls back to Original if the supplied alternative loses a token', () => {
    const ctx = testWorld(bundle, 4411);
    const person = place(ctx, { sex: 'female', age: 20, name: 'Mara' });
    const report = emptyReport(ctx.world.year);
    report.awakenings.push(person);
    setProseVariants(ctx, [{
      address: coreMessageAddress('passage.awakening.unexpressed'),
      of: proseOriginalHash('{NAME} awakened, and it will not come through.'),
      plainenglish: 'The power does not pass through.',
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(passageOf(ctx, report)!.lines[0]!.text)
      .toBe('Mara awakened, and it will not come through.');
  });
});

describe('the year-phase pages speak the reader\'s setting (#752)', () => {
  const PAGES: Record<string, [string, string]> = {
    'age.named_fallback': ['They began to call it {AGE}.', 'People started calling this time {AGE}.'],
    'guardian.crossed_title': ['The House Does Not Empty', 'He Did Not Leave'],
    'guardian.crossed': [
      'They buried {NARRATOR} in the spring and the house did not feel emptier for it, which everyone noticed and nobody said. The fires were laid before anyone laid them. The accounts stayed balanced through a year in which nobody balanced them. He had not gone anywhere. He had only stopped being someone they had to feed.',
      'They buried {NARRATOR} in the spring, but the house did not feel emptier. Fires were lit and accounts were kept with no one doing it. He had not gone; he simply no longer needed feeding.',
    ],
    'library.first_reading': [
      '{PERSON} finished {BOOK}. Nobody in the house had read it before.',
      '{PERSON} finished reading {BOOK}, the first in the family to do so.',
    ],
  };
  type Mode = 'original' | 'plainenglish';
  const say = (mode: Mode, key: string, v: Record<string, string> = {}) =>
    PAGES[key]![mode === 'original' ? 0 : 1].replace(/\{([A-Z]+)\}/g, (_, k: string) => v[k]!);
  function speak(ctx: SimCtx, mode: Mode): SimCtx {
    setProseVariants(ctx, Object.entries(PAGES).map(([key, [original, plain]]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
    })));
    setProseMode(ctx, mode);
    return ctx;
  }

  // Every authored Age carries an `opening`; the fallback is for one that does not.
  const raw = loadBundle();
  const unopened = {
    ...raw,
    ages: raw.ages.map((a, i) => {
      if (i !== 0) return a;
      const { opening: _dropped, ...rest } = a;
      return rest as typeof a;
    }),
  };

  for (const mode of ['original', 'plainenglish'] as const) {
    it(`names an Age with no opening of its own in ${mode}`, () => {
      const ctx = speak(testWorld(unopened), mode);
      const age = unopened.ages[0]!;
      ctx.world.age.active = [{ age: age.id, began: ctx.world.year - age.namedAfterYears, named: false, paid: { standing: false } }];
      phase('ages', ctx);
      const page = ctx.world.chronicle.find((e) => e.weight === 'page' && e.title === age.name)!;
      expect(page.text).toBe(say(mode, 'age.named_fallback', { AGE: age.name }));
    });

    it(`writes the Narrator's crossing in ${mode}`, () => {
      const ctx = speak(testWorld(bundle), mode);
      const narrator = ctx.world.people.living().find((p) => bundle.characters.some((c) => c.becomesGuardian && c.name === p.name))!;
      ctx.world.people.kill(narrator.id, ctx.world.year, 'test');
      phase('guardian', ctx);
      const page = ctx.world.chronicle.at(-1)!;
      expect(page.title).toBe(say(mode, 'guardian.crossed_title'));
      expect(page.text).toBe(say(mode, 'guardian.crossed', { NARRATOR: narrator.name }));
      expect(ctx.world.guardianSince).toBe(ctx.world.year);
      setProseMode(ctx, mode === 'original' ? 'plainenglish' : 'original');
      expect(page.text).toBe(say(mode, 'guardian.crossed', { NARRATOR: narrator.name }));
    });

    it(`writes the house's first reading of a book in ${mode}`, () => {
      const ctx = speak(testWorld(bundle), mode);
      const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
      const reader = place(ctx, { sex: 'male', age: 30, name: 'Ivo', awakened: true });
      expect(beginStudy(ctx, reader, def)).toBe(true);
      ctx.world.year = ctx.world.studies.find((st) => st.person === reader.id)!.completes;
      phase('library', ctx);
      expect(ctx.world.chronicle.map((e) => e.text)).toContain(say(mode, 'library.first_reading', { PERSON: 'Ivo', BOOK: def.name }));
    });
  }
});

describe('core message interpolation', () => {
  it('rejects inherited prototype properties as missing placeholder values (#861)', () => {
    const ctx = testWorld(loadBundle());
    for (const name of ['constructor', 'toString', '__proto__']) {
      const original = `A message about {${name}}.`;
      expect(() => msg(ctx, 'test.own-values', original, {}))
        .toThrow(`Missing {${name}} in core message test.own-values`);
    }
  });

  it('still substitutes explicitly supplied values with prototype-like names', () => {
    const ctx = testWorld(loadBundle());
    expect(msg(ctx, 'test.constructor', 'The {constructor} replied.', { constructor: 'court' }))
      .toBe('The court replied.');

    const values: Record<string, string> = Object.create(null);
    Object.defineProperty(values, '__proto__', { value: 'family', enumerable: true });
    Object.defineProperty(values, 'toString', { value: 'chronicle', enumerable: true });
    expect(msg(ctx, 'test.null-prototype', 'The {__proto__} read the {toString}.', values))
      .toBe('The family read the chronicle.');
  });
});
