import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { AUTHORED_FOUNDER, FounderIdentityError, type FounderAnswer } from '@ed/schema';
import { describeDecision, digestOf, newGame, replay, resumeGame } from '@ed/core';
import { bootstrap } from './sim.js';
import { renderBody } from './events/slots.js';
import { ensureHead } from './people/succession.js';
import { loadGame, saveGame } from './save.js';
import { makeRng } from './rng.js';
import { inRegency, isRegent } from './world.js';
import { place } from './testing.js';

const bundle = loadContent();
const founderSeed = bundle.characters.find((s) => s.becomesGuardian)!;
const spouseKey = bundle.characters.find((s) => s.fatherKey === founderSeed.key)!.motherKey!;
const spouseSeed = bundle.characters.find((s) => s.key === spouseKey)!;

function founded(founder?: FounderAnswer, seed = 4242) {
  const ctx = bootstrap(bundle, seed, 1042, 'long', [], founder ? { founder } : undefined);
  const w = ctx.world;
  const founderPerson = w.people.get(w.narrator!)!;
  const children = w.people.all().filter((p) =>
    p.trueParents.mother === founderPerson.id || p.trueParents.father === founderPerson.id);
  const spouse = w.people.get(founderPerson.marriages[0]!.spouse)!;
  return { ctx, w, founder: founderPerson, children, spouse };
}

/**
 * THE FOUNDER IS THE PLAYER (#1867, step 1). Name, gender and founding
 * configuration are three answers, and only the configuration touches a
 * body. These assert each one does what it says and nothing it does not.
 */
describe('the founding configuration', () => {
  it('leaves the authored cast exactly as it was when nothing turns it around', () => {
    const unsigned = founded();
    expect(unsigned.founder.gender).toBeUndefined();
    // Any answer about who signed records the resolved gender, and nothing
    // else moves: the same body, the same family, the same draws.
    for (const answer of [{ gender: 'man' }, { configuration: 'blood_father' }, { name: '' }] as const) {
      const signed = founded(answer);
      expect(signed.founder.gender).toBe('man');
      delete signed.founder.gender;
      expect(signed.w).toEqual(unsigned.w);
    }
  });

  it('makes a blood mother: she carries the font and bears the children, a married-in husband fathers them', () => {
    const { founder, children, spouse, w } = founded({ gender: 'woman' });
    expect(founder.sex).toBe('female');
    expect(founder.gender).toBe('woman');
    expect(founder.name).toBe(founderSeed.name);
    expect(spouse.sex).toBe('male');
    expect(spouse.name).not.toBe(spouseSeed.name);
    expect(String(spouse.houseOfOrigin)).toBe(spouseSeed.house);
    expect(spouse.marriages.map((m) => m.spouse)).toEqual([founder.id]);
    expect(children.length).toBe(bundle.characters.filter((s) => s.fatherKey === founderSeed.key).length);
    for (const child of children) {
      expect(child.trueParents).toEqual({ mother: founder.id, father: spouse.id });
      expect(child.claimedParents).toEqual(child.trueParents);
    }
    // Every authored child is still there, still the authored sex.
    for (const s of bundle.characters.filter((c) => c.fatherKey === founderSeed.key)) {
      expect(children.find((c) => c.name === s.name)?.sex).toBe(s.sex);
    }
    expect(w.succession[0]?.person).toBe(founder.id);
  });

  it('keeps gender and configuration independent in both directions', () => {
    expect(founded({ gender: 'woman', configuration: 'blood_father' }).founder.sex).toBe('male');
    expect(founded({ gender: 'man', configuration: 'blood_mother' }).founder.sex).toBe('female');
    expect(founded({ gender: 'nonbinary', configuration: 'blood_father' }).founder.sex).toBe('male');
    expect(founded({ gender: 'nonbinary', configuration: 'blood_mother' }).founder.sex).toBe('female');
  });

  it('refuses a nonbinary founder who has not chosen, rather than guessing a body', () => {
    expect(() => founded({ gender: 'nonbinary' })).toThrow(FounderIdentityError);
  });

  it('is deterministic per run, and the husband\'s name comes from the run\'s own stream', () => {
    expect(founded({ gender: 'woman' }, 77).w).toEqual(founded({ gender: 'woman' }, 77).w);
    const names = new Set([1, 2, 3, 4, 5, 6].map((seed) => founded({ gender: 'woman' }, seed).spouse.name));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('the founder\'s charter', () => {
  it('lets a blood mother hold the seal in her own right — no Regency', () => {
    const { w, founder } = founded({ gender: 'woman' });
    expect(founder.castSlots).toContain('head');
    expect(isRegent(w, founder)).toBe(false);
    expect(inRegency(w)).toBe(false);
  });

  it('still makes any other woman holding the seal a Regent', () => {
    const { ctx, w } = founded({ gender: 'woman' });
    const daughter = place(ctx, { sex: 'female', age: 30 });
    expect(isRegent(w, daughter)).toBe(true);
  });

  it('hands the seal on through ordinary succession when she crosses over', () => {
    const { ctx, w, founder } = founded({ gender: 'woman' });
    w.year = 1060;
    w.people.kill(founder.id, w.year, 'test');
    expect(founder.status).toBe('guardian');
    const result = ensureHead(ctx, makeRng(1));
    expect(result.newHead?.id).not.toBe(founder.id);
    expect(result.newHead?.castSlots).toContain('head');
  });
});

describe('the founder\'s grammar', () => {
  it('refers to the founder as the player said, whatever the body', () => {
    for (const [answer, expected] of [
      [{ gender: 'woman' }, 'she keeps her own counsel'],
      [{ gender: 'man', configuration: 'blood_mother' }, 'he keeps his own counsel'],
      [{ gender: 'nonbinary', configuration: 'blood_mother' }, 'they keep their own counsel'],
    ] as const) {
      const { ctx, founder } = founded(answer);
      expect(renderBody('{F.they} keep{F.s} {F.their} own counsel', { F: founder.id }, ctx)).toBe(expected);
    }
  });
});

describe('{NARRATOR}', () => {
  it('names the founder in any scene without a slot, and a declared slot of that name wins', () => {
    const { ctx, founder } = founded({ name: 'Ysolt Gearithy', gender: 'woman' });
    expect(renderBody('{NARRATOR} counts on {NARRATOR.their} fingers.', {}, ctx))
      .toBe('Ysolt Gearithy counts on her fingers.');
    const other = place(ctx, { sex: 'male', age: 50, name: 'Corr' });
    expect(renderBody('{NARRATOR.They} {NARRATOR.is} late.', { NARRATOR: other.id }, ctx)).toBe('He is late.');
  });

  it('renders every frame line with the founder\'s forms, and leaves no token behind', () => {
    const { ctx } = founded({ name: 'Ash Gearithy', gender: 'nonbinary', configuration: 'blood_mother' });
    const frame = bundle.events.filter((e) => e.tier === 'frame');
    const texts = frame.flatMap((e) => [e.body, ...(e.interaction.kind === 'narration'
      ? e.interaction.outcomes.map((o) => o.text) : [])]);
    const narrated = texts.filter((t) => t.includes('{NARRATOR'));
    expect(narrated.length).toBeGreaterThan(10);
    for (const text of narrated) {
      const line = renderBody(text, {}, ctx);
      expect(line, text).not.toMatch(/\{NARRATOR/);
      expect(line, text).not.toMatch(/\b(he|him|his|himself)\b/i);
    }
  });
});

describe('a Head\'s forms', () => {
  // A Regent holds the seal in every run, and a blood mother holds it in the
  // first generation: Head prose follows whoever is seated.
  it('refers to a woman holding the seal as herself', () => {
    const { ctx, founder } = founded();
    const regent = place(ctx, { sex: 'female', age: 44, name: 'Maren' });
    const scene = bundle.events.find((e) => e.id === 'the_guardian_disagrees')!;
    const body = renderBody(scene.body, { HEAD: regent.id, GUARDIAN: founder.id }, ctx);
    expect(body).toContain('Maren has made up her mind');
    expect(body).toContain('until she has changed her mind');
    expect(body).not.toMatch(/\b(he|him|his)\b/i);
  });

  it('leaves no Head form unrendered anywhere in the bundle', () => {
    const { ctx } = founded();
    const regent = place(ctx, { sex: 'female', age: 44, name: 'Maren' });
    const withForms = bundle.events.flatMap((e) => [e.body, ...(e.interaction.kind === 'narration'
      ? e.interaction.outcomes : e.interaction.choices.flatMap((c) => c.outcomes)).map((o) => o.text)])
      .filter((t) => t.includes('{HEAD.'));
    expect(withForms.length).toBeGreaterThan(5);
    for (const text of withForms) expect(renderBody(text, { HEAD: regent.id }, ctx), text).not.toMatch(/\{HEAD\./);
  });
});

describe('who signed, persisted', () => {
  // The chronicler answers every docket, so a played year logs what replay
  // will answer too, and the two logs are comparable.
  const choice = (founder: FounderAnswer) => {
    const g = newGame(bundle, { seed: 31_337, decider: 'chronicler' });
    const p = g.prologue()!;
    const result = g.found({
      houseName: 'The House of Salt', heirloom: p.heirlooms[0]!.heirloom, grudge: p.grudges[0]!.house, founder,
    });
    return { g, result };
  };

  it('rebuilds the founding from a gender alone, and logs the resolved identity', () => {
    const { g, result } = choice({ gender: 'woman' });
    expect(result.ok).toBe(true);
    const w = g.ctx.world;
    expect(w.people.get(w.narrator!)?.sex).toBe('female');
    const signing = w.decisionLog[0]!;
    expect(signing).toMatchObject({ kind: 'signing', founder: { gender: 'woman', configuration: 'blood_mother' } });
    expect(describeDecision(signing)).toContain('woman, blood_mother');
  });

  it('refuses an unfinished identity without touching the run', () => {
    const g = newGame(bundle, { seed: 31_338 });
    const before = g.ctx;
    const p = g.prologue()!;
    const result = g.found({
      houseName: 'The House of Salt', heirloom: p.heirlooms[0]!.heirloom, grudge: p.grudges[0]!.house,
      founder: { gender: 'nonbinary' },
    });
    expect(result).toEqual({ ok: false, reason: 'choose whether the founder is the blood father or the blood mother' });
    expect(g.ctx).toBe(before);
    expect(g.ctx.world.founding).toBeUndefined();
  });

  it('survives save, resume and replay', () => {
    const { g } = choice({ name: 'Ysolt Gearithy', gender: 'nonbinary', configuration: 'blood_mother' });
    g.advance(3);
    const resumed = resumeGame(g.save(), bundle);
    const narrator = resumed.ctx.world.people.get(resumed.ctx.world.narrator!)!;
    expect([narrator.name, narrator.sex, narrator.gender]).toEqual(['Ysolt Gearithy', 'female', 'nonbinary']);
    const replayed = replay(bundle, g.ctx.world.decisionLog, 31_337, 1042, g.ctx.world.year - 1042);
    expect(digestOf(replayed)).toBe(digestOf(g.ctx));
  });

  it.each([33, 34])('upgrades a format-%i signing to the authored founder under the recorded name', (format) => {
    const { g } = choice({ name: 'Arlen Gearithy' });
    const save = saveGame(g.ctx);
    const legacy = structuredClone(save) as unknown as Record<string, unknown>;
    legacy.format = format;
    const log = legacy.decisionLog as Record<string, unknown>[];
    const { founder: _founder, ...row } = log[0]!;
    log[0] = { ...row, founderName: 'Arlen Gearithy' };
    const loaded = loadGame(legacy, bundle);
    expect(loaded.world.decisionLog[0]).toMatchObject({
      kind: 'signing', founder: { name: 'Arlen Gearithy', ...AUTHORED_FOUNDER },
    });
  });
});
