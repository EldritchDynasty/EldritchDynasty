import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bearingWordsIn, indexContent, proseOriginalHash } from '@ed/schema';
import { beget, marry, place, testWorld } from './testing.js';
import { queueChoice } from './events/decisions.js';
import {
  adviceFor,
  adviceForDecision,
  type HelpSurface,
  type HelpTier,
} from './advisers.js';
import type { SimCtx } from './world.js';
import { GameSession } from './session.js';
import { coreMessageAddress, msg } from './messages.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { saveGame } from './save.js';
import { plainEnglishCoreWorkItems } from './tools/string-audit.js';

const contentBundle = indexContent(loadContent());
const HELP_SURFACES: HelpSurface[] = ['tree', 'chronicle', 'branches'];
const HELP_TIERS: HelpTier[] = [1, 2, 3];

function clearLiving(ctx: SimCtx): void {
  for (const person of ctx.world.people.all()) {
    person.status = 'dead';
    person.castSlots = [];
  }
}

function helpWorld() {
  const ctx = testWorld(contentBundle, 273);
  clearLiving(ctx);
  const target = place(ctx, { sex: 'male', age: 21, name: 'Edren' });
  const reader = place(ctx, {
    sex: 'female',
    age: 43,
    name: 'Mara',
    career: { career: 'scholar', heldYears: 8 },
  });
  beget(ctx, target, reader);
  // The target is only the subject of the tree question. Keeping the reader
  // as the sole living adviser makes this fixture test her words rather than
  // whichever lens happens to outrank her on another surface.
  target.status = 'dead';
  return { ctx, target, reader };
}

function helpLines(ctx: SimCtx, target: string) {
  return HELP_SURFACES.flatMap((surface) =>
    HELP_TIERS.flatMap((tier) => adviceFor(
      ctx,
      surface,
      surface === 'tree' ? target : surface === 'chronicle' ? 'the-chronicle' : 'the-main-hall',
      tier,
    )));
}

describe('adviser knowledge boundary (#273)', () => {
  it('keeps the adviser module an epistemic cul-de-sac by import allow-list', () => {
    const source = readFileSync(new URL('./advisers.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imports).toEqual([
      '@ed/schema',
      './world.js',
      './people/grammar.js',
      './events/decisions.js',
      './people/match.js',
      './messages.js',
    ]);
    expect(imports.some((path) => /genetics\/|bearing|rng|checks/i.test(path ?? ''))).toBe(false);
    // How a person is referred to (#1867) is a fact the player can see, and
    // the module that decides it reaches nothing else.
    const grammar = readFileSync(new URL('./people/grammar.ts', import.meta.url), 'utf8');
    expect([...grammar.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])).toEqual(['@ed/schema']);
    const renderer = readFileSync(new URL('./messages.ts', import.meta.url), 'utf8');
    expect([...renderer.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])).toEqual([
      '@ed/schema', './prose.js', './world.js',
    ]);
    expect(renderer).not.toContain('ctx.world');
  });

  it('keeps advice templates out of the Bearing vocabulary', () => {
    const source = readFileSync(new URL('./advisers.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The content rule and these code-owned templates share one predicate, so
    // widening prose/bearing cannot leave advice behind with an older copy.
    expect(bearingWordsIn(source)).toEqual([]);
    // The mechanic's own internal names are forbidden here as well.
    expect(source).not.toMatch(/\b(?:bearing|carriage)\b/i);
  });

  it('does not change help when only a hidden attribute changes', () => {
    const a = helpWorld();
    const b = helpWorld();
    const hidden = contentBundle.attributes.find((attribute) => attribute.kind === 'hidden');
    expect(hidden, 'real content needs a hidden attribute for this boundary test').toBeDefined();

    a.reader.acquired[String(hidden!.id)] = 0;
    b.reader.acquired[String(hidden!.id)] = 91;

    expect(helpLines(a.ctx, a.target.id)).toEqual(helpLines(b.ctx, b.target.id));
  });

  it('does not change help when only an unawakened adviser can express', () => {
    const a = helpWorld();
    const b = helpWorld();
    expect(a.reader.awakening.awakened).toBe(false);
    expect(b.reader.awakening.awakened).toBe(false);

    const cache = (canExpress: boolean) => ({
      attrs: new Map<string, number>(),
      eldritch: {
        carriedFont: 0,
        canExpress,
        expressedPower: 0,
        overflowMadness: 0,
        ceiling: 0,
      },
      computedAtYear: a.ctx.world.year,
      dirty: false,
    });
    a.reader.phenotype = cache(false);
    b.reader.phenotype = cache(true);

    expect(helpLines(a.ctx, a.target.id)).toEqual(helpLines(b.ctx, b.target.id));
  });

  it('keeps a renamed rite classified from its structured effect', () => {
    const ctx = testWorld(contentBundle, 274);
    clearLiving(ctx);
    const priest = place(ctx, {
      sex: 'female',
      age: 40,
      name: 'Sister Elian',
      career: { career: 'clergy' },
    });
    const source = ctx.content.event('the_vessel_rite');
    expect(source).toBeDefined();

    const event = { ...source!, id: 'ordinary_page', title: 'A Quiet Question' };
    const pending = queueChoice(ctx, event, event.body, {}, []);
    const advice = adviceForDecision(ctx, pending);

    expect(advice).toHaveLength(1);
    expect(advice[0]?.adviser.id).toBe(priest.id);
    expect(advice[0]?.lens).toBe('priest');
    expect(advice[0]?.position).toContain('With a rite');
  });

  it('uses sex-correct pronouns for a woman adviser at every help tier', () => {
    const { ctx, target, reader } = helpWorld();
    const lines = helpLines(ctx, target.id);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line.adviser.id).toBe(reader.id);
      expect(`${line.cares} ${line.position}`).not.toMatch(/\b(?:he|his|him)\b/i);
    }
  });

  it('keeps every help line attributed and free of numeric oracle text', () => {
    const { ctx, target } = helpWorld();

    for (const surface of HELP_SURFACES) {
      for (const tier of HELP_TIERS) {
        const subject = surface === 'tree'
          ? target.id
          : surface === 'chronicle' ? 'the-chronicle' : 'the-main-hall';
        const lines = adviceFor(ctx, surface, subject, tier);
        expect(lines.length, `${surface} tier ${tier} had no living adviser`).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.adviser.name.length).toBeGreaterThan(0);
          expect(`${line.position} ${line.cares}`).not.toMatch(/\d/);
        }
      }
    }
  });

  it('returns exactly the tier requested rather than preloading a later answer', () => {
    const { ctx, target } = helpWorld();
    const first = adviceFor(ctx, 'tree', target.id, 1);
    const second = adviceFor(ctx, 'tree', target.id, 2);
    const third = adviceFor(ctx, 'tree', target.id, 3);

    expect(first[0]?.position).not.toEqual(second[0]?.position);
    expect(second[0]?.position).not.toEqual(third[0]?.position);
    expect(first[0]?.position).not.toContain('Find somebody by name');
    expect(second[0]?.position).not.toContain('Find somebody by name');
    expect(third[0]?.position).toContain('Find somebody by name');
  });

  it('exposes the same bounded help through GameSession', () => {
    const { ctx, target } = helpWorld();
    const session = new GameSession(ctx);

    expect(session.advice('tree', target.id, 1)).toEqual(adviceFor(ctx, 'tree', target.id, 1));
  });
});

describe('adviser succession chronology (#2760)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'does not award former-Head authority for future or still-open tenures (%s)',
    (mode) => {
      const ctx = testWorld(contentBundle, 2760);
      clearLiving(ctx);
      setProseMode(ctx, mode);
      const candidate = place(ctx, {
        sex: 'male', age: 45, name: 'The Future Head',
        career: { career: 'clergy' },
      });
      const start = ctx.world.year;
      ctx.world.succession.push({
        person: candidate.id, name: candidate.name, from: start + 2, to: start + 4,
      });
      const lens = () => adviceFor(ctx, 'tree', candidate.id, 1)[0]?.lens;

      expect(lens()).toBe('priest');
      ctx.world.year = start + 2;
      expect(lens()).toBe('priest'); // A present tenure has not ended.
      ctx.world.year = start + 4;
      expect(lens()).toBe('old_head');
      ctx.world.year = start + 5;
      expect(lens()).toBe('old_head');
    },
  );

  it.each(['original', 'plainenglish'] as const)(
    'does not call a spouse the widow of a Head whose tenure starts in the future (%s)',
    (mode) => {
      const ctx = testWorld(contentBundle, 2761);
      clearLiving(ctx);
      setProseMode(ctx, mode);
      const widow = place(ctx, {
        sex: 'female', age: 40, name: 'The Witness',
        career: { career: 'clergy' },
      });
      const spouse = place(ctx, { sex: 'male', age: 43, name: 'The Absent Husband' });
      marry(ctx, widow, spouse);
      spouse.status = 'dead';
      const start = ctx.world.year;
      ctx.world.succession.push({
        person: spouse.id, name: spouse.name, from: start + 2, to: start + 4,
      });
      const lens = () => adviceFor(ctx, 'tree', widow.id, 1)[0]?.lens;

      expect(lens()).toBe('priest');
      ctx.world.year = start + 2;
      expect(lens()).toBe('old_head'); // His tenure has begun, despite the imported status.
      ctx.world.year = start + 5;
      expect(lens()).toBe('old_head');
    },
  );

  it('keeps advice from genuinely completed earlier tenures', () => {
    const ctx = testWorld(contentBundle, 2762);
    clearLiving(ctx);
    const formerHead = place(ctx, { sex: 'male', age: 50, name: 'The Former Head' });
    ctx.world.succession.push({
      person: formerHead.id, name: formerHead.name,
      from: ctx.world.year - 12, to: ctx.world.year - 2,
    });
    const advice = adviceFor(ctx, 'tree', formerHead.id, 1);
    expect(advice[0]).toMatchObject({
      adviser: { id: formerHead.id },
      lens: 'old_head',
    });
    expect(advice[0]?.cares).toContain('held the seal before');
  });
});

describe('stable adviser prose (#641)', () => {
  const source = readFileSync(new URL('./advisers.ts', import.meta.url), 'utf8');
  const entries = plainEnglishCoreWorkItems('advisers.ts', source);

  function variant(key: string, plainenglish: string) {
    const address = coreMessageAddress(key);
    const entry = entries.find((item) => item.address === address);
    expect(entry, `missing worklist identity for ${key}`).toBeDefined();
    return { address, of: proseOriginalHash(entry!.text), plainenglish };
  }

  it('inventories every adviser line with a unique stable key and its template tokens', () => {
    expect(entries).toHaveLength(56);
    expect(new Set(entries.map((item) => item.address)).size).toBe(entries.length);
    expect(entries.every((item) => item.address.startsWith('core:messages#adviser.'))).toBe(true);
    expect(plainEnglishCoreWorkItems('moved/advisers.ts', `const unrelated = 'An unrelated new sentence.';\n${source}`)
      .filter((item) => item.address.startsWith('core:messages#'))).toEqual(entries.map((item) => ({
        ...item, file: 'moved/advisers.ts',
      })));
    expect(entries.find((item) => item.address === coreMessageAddress('adviser.match.dowry')))
      .toMatchObject({ interpolations: ['{NAME}'] });
  });

  it('switches live help and pronouns through GameSession without changing the world', () => {
    const { ctx, target } = helpWorld();
    const session = new GameSession(ctx);
    const original = session.advice('tree', target.id, 1);
    const saved = saveGame(ctx);
    setProseVariants(ctx, [
      variant('adviser.cares.reader', '{SUBJECT} reads the house records.'),
      variant('adviser.help.reader.tree', 'Start with a name, then follow their family.'),
    ]);
    setProseMode(ctx, 'plainenglish');
    expect(session.advice('tree', target.id, 1)).toEqual([{
      ...original[0],
      cares: 'she reads the house records.',
      position: 'Start with a name, then follow their family.',
    }]);
    expect(missingPlainEnglish(ctx)).toEqual([]);
    setProseMode(ctx, 'original');
    expect(session.advice('tree', target.id, 1)).toEqual(original);
    expect({ ...saveGame(ctx), savedAt: saved.savedAt }).toEqual(saved);
  });

  it('selects the same rite advice and inserts the already-visible choice label', () => {
    const ctx = testWorld(contentBundle, 641);
    clearLiving(ctx);
    place(ctx, { sex: 'male', age: 40, name: 'Elian', career: { career: 'clergy' } });
    const event = ctx.content.mustEvent('the_vessel_rite');
    const pending = queueChoice(ctx, event, event.body, {}, []);
    const original = adviceForDecision(ctx, pending);
    const label = pending.choices.find((choice) => choice.available)!.label;
    setProseVariants(ctx, [
      variant('adviser.cares.priest', '{SUBJECT} serves the Church.'),
      variant('adviser.rite.priest', 'I would choose “{LABEL}”. We can only control our caution.'),
    ]);
    setProseMode(ctx, 'plainenglish');
    expect(adviceForDecision(ctx, pending)).toEqual([{
      ...original[0],
      cares: 'he serves the Church.',
      position: `I would choose “${label}”. We can only control our caution.`,
    }]);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });

  it('reports missing and stale templates while retaining the Original advice', () => {
    const { ctx, target } = helpWorld();
    const original = adviceFor(ctx, 'tree', target.id, 1);
    // An unselected relative must not add a migration miss for unseen counsel.
    place(ctx, { sex: 'male', age: 30, name: 'Edren' });
    setProseVariants(ctx, [{
      ...variant('adviser.help.reader.tree', 'Start with a name.'),
      of: proseOriginalHash('An obsolete Original.'),
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(adviceFor(ctx, 'tree', target.id, 1)).toEqual(original);
    expect(missingPlainEnglish(ctx)).toEqual([
      coreMessageAddress('adviser.cares.reader'),
      coreMessageAddress('adviser.help.reader.tree'),
    ].sort());
  });

  it('rejects invalid interpolation multisets and never reinterprets an inserted name', () => {
    const { ctx } = helpWorld();
    const key = 'adviser.match.dowry';
    const entry = entries.find((item) => item.address === coreMessageAddress(key))!;
    setProseVariants(ctx, [variant(key, 'I would choose somebody else.')]);
    setProseMode(ctx, 'plainenglish');
    const name = 'Edren {LABEL}';
    expect(msg(ctx, key, entry.text, { NAME: name })).toBe(entry.text.replace('{NAME}', name));
    expect(missingPlainEnglish(ctx)).toEqual([coreMessageAddress(key)]);
    setProseVariants(ctx, [variant(key, 'Choose {NAME}, then choose {NAME} again.')]);
    expect(msg(ctx, key, entry.text, { NAME: name })).toBe(entry.text.replace('{NAME}', name));
    expect(() => msg(ctx, key, entry.text)).toThrow('Missing {NAME}');
  });
});

describe('adviser recovered-record chronology (#2934, #2935, #2936)', () => {
  it.each([
    ['clergy', 'priest'],
    ['merchant', 'broker'],
    ['scholar', 'reader'],
    ['military', 'soldier'],
  ] as const)('does not treat a future %s career as a current %s (#2934)', (career, lens) => {
    const ctx = testWorld(contentBundle, 2934);
    clearLiving(ctx);
    const adviser = place(ctx, {
      sex: 'male', age: 40, name: 'An Unappointed Relative', career: { career },
    });
    const today = ctx.world.year;
    adviser.career!.from = today + 2;

    const currentLens = () => adviceFor(ctx, 'tree', adviser.id, 1)[0]?.lens;
    expect(currentLens()).toBe('close_kin');
    ctx.world.year = today + 1;
    expect(currentLens()).toBe('close_kin');
    ctx.world.year = today + 2;
    expect(currentLens()).toBe(lens);
  });

  it.each(['original', 'plainenglish'] as const)(
    'offers no counsel from a recorded death, but retains it before death (%s, #2935)',
    (mode) => {
      const ctx = testWorld(contentBundle, 2935);
      clearLiving(ctx);
      setProseMode(ctx, mode);
      const person = place(ctx, {
        sex: 'male', age: 40, name: 'A Household Reader', career: { career: 'scholar' },
      });
      const now = ctx.world.year;
      const who = () => adviceFor(ctx, 'tree', person.id, 1).map((a) => a.adviser.id);

      person.died = now + 1;
      expect(who()).toEqual([person.id]); // A recovered future death is not a death yet.
      person.died = now;
      expect(who()).toEqual([]); // Status may still incorrectly say 'alive'.
      person.died = now - 2;
      expect(who()).toEqual([]);
      person.died = undefined;
      person.born = now + 1;
      expect(who()).toEqual([]); // Even an inconsistent hot membership cannot advise unborn.
    },
  );

  it('recognises a widow only after her marriage and her spouse’s effective death (#2936)', () => {
    const ctx = testWorld(contentBundle, 2936);
    clearLiving(ctx);
    const widow = place(ctx, {
      sex: 'female', age: 43, name: 'A Prospective Widow', career: { career: 'clergy' },
    });
    const spouse = place(ctx, { sex: 'male', age: 46, name: 'The Former Head' });
    marry(ctx, widow, spouse);
    const today = ctx.world.year;
    ctx.world.succession.push({
      person: spouse.id, name: spouse.name, from: today - 10, to: today - 3,
    });
    spouse.status = 'dead';
    const lens = () => adviceFor(ctx, 'tree', widow.id, 1)[0]?.lens;

    spouse.died = today + 2;
    expect(lens()).toBe('priest');
    ctx.world.year = today + 2;
    expect(lens()).toBe('old_head');

    ctx.world.year = today;
    spouse.died = undefined; // Legacy records may omit the death year.
    const marriage = widow.marriages.find((m) => m.spouse === spouse.id)!;
    marriage.from = today + 3;
    expect(lens()).toBe('priest');
    ctx.world.year = today + 3;
    expect(lens()).toBe('old_head');

    ctx.world.year = today;
    marriage.from = today;
    spouse.died = today - 1; // A marriage recorded after his death cannot make a widow.
    expect(lens()).toBe('priest');
    marriage.from = today - 10;
    expect(lens()).toBe('old_head');

    marriage.to = today - 3; // The marriage ended before the death.
    spouse.died = today - 1;
    expect(lens()).toBe('priest');

    // A corrupt later office must not turn an earlier death into a Head's widow.
    marriage.from = today - 15;
    marriage.to = undefined;
    spouse.died = today - 5;
    const held = ctx.world.succession.find((record) => record.person === spouse.id)!;
    held.from = today - 2;
    held.to = today - 1;
    expect(lens()).toBe('priest');
  });

  it('does not favour an adviser for a marriage that has not started (#2936)', () => {
    const ctx = testWorld(contentBundle, 2936);
    clearLiving(ctx);
    const target = place(ctx, { sex: 'male', age: 23, name: 'The Subject' });
    const older = place(ctx, {
      sex: 'male', age: 48, name: 'Future Spouse', career: { career: 'scholar' },
    });
    const younger = place(ctx, {
      sex: 'male', age: 44, name: 'Unrelated Reader', career: { career: 'scholar' },
    });
    const today = ctx.world.year;
    older.marriages.push({ spouse: target.id, from: today + 3 });
    const first = () => adviceFor(ctx, 'tree', target.id, 1)[0]?.adviser.id;

    expect(first()).toBe(younger.id); // Equal reader lenses: the younger speaks.
    ctx.world.year = today + 3;
    expect(first()).toBe(older.id); // Now the spouse's interest has actually begun.
  });
});
