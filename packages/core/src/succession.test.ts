import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadContent } from '@ed/content';
import type { Person, RetainerContract, RetainerRole } from '@ed/schema';
import { asId, contentProseEntries, proseOriginalHash, RetainerRoleS } from '@ed/schema';
import { MAIN_BRANCH } from '@ed/schema';
import {
  beget, bootstrap, buyBackWardship, DEBT_FLOOR, ensureHead, hashSeed, head, heirApparent, inheritPost,
  inRegency, knownSuccession, loadGame, maintainCast, place, releaseContracts, runYears, saveGame, testRng,
  testWorld,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { canonical } from './save.js';

const bundle = loadContent();

describe('prospective wanderer arrival prose (#646)', () => {
  const original = bundle.characterTemplates.find((template) => template.role === 'wanderer' && template.blurb)!;
  const entries = contentProseEntries('characters/templates.yaml', parse(readFileSync(
    new URL('../../content/characters/templates.yaml', import.meta.url), 'utf8',
  )));
  function variant(field: 'title' | 'blurb', plainenglish: string) {
    const entry = entries.find((item) => item.address.endsWith(`[id=${original.id}].${field}`))!;
    expect(entry).toBeDefined();
    return { address: entry.address, of: proseOriginalHash(entry.text), plainenglish };
  }
  function arrival(withBlurb = true) {
    const source = { ...bundle, characterTemplates: [{
      ...original, frequency: 'common' as const, conditions: undefined,
      ...(withBlurb ? {} : { blurb: undefined }),
    }] };
    const ctx = testWorld(source, 646);
    // Isolate the arrival mechanism: hire nobody, keep recurring posts quiet,
    // and admit the one explicitly eligible wanderer without a century batch.
    const rng = { ...testRng(646), bool: (chance: number) => chance === 0.05 };
    return { ctx, source, rng };
  }

  it('selects actual worklist wording at arrival, retains the same person and freezes the Chronicle across reload', () => {
    const control = arrival();
    const plain = arrival();
    setProseVariants(plain.ctx, [
      variant('title', 'An unexpected arrival'),
      variant('blurb', 'A traveller came to the house.'),
    ]);
    setProseMode(plain.ctx, 'plainenglish');
    const originalPeople = maintainCast(control.ctx, control.rng);
    const plainPeople = maintainCast(plain.ctx, plain.rng);
    expect(plainPeople.map((person) => person.id)).toEqual(originalPeople.map((person) => person.id));
    const page = plain.ctx.world.chronicle.find((entry) => entry.title === 'An unexpected arrival')!;
    expect(page).toMatchObject({ text: 'A traveller came to the house.', weight: 'illuminated', named: true });
    expect(control.ctx.world.chronicle.find((entry) => entry.title === original.title)!.text).toBe(original.blurb);
    const expected = saveGame(control.ctx);
    expected.chronicle = expected.chronicle.map((entry) => entry.title === original.title
      ? { ...entry, title: page.title, text: page.text } : entry);
    expect(canonical(saveGame(plain.ctx))).toBe(canonical(expected));
    expect(missingPlainEnglish(plain.ctx)).toEqual([]);
    setProseMode(plain.ctx, 'original');
    const loaded = loadGame(saveGame(plain.ctx), plain.source);
    expect(loaded.world.chronicle).toEqual(plain.ctx.world.chronicle);
    expect(page.text).toBe('A traveller came to the house.');
  });

  it('preserves the generated arrival fallback without reporting a missing optional blurb', () => {
    const { ctx, rng } = arrival(false);
    setProseVariants(ctx, [variant('title', 'An unexpected arrival')]);
    setProseMode(ctx, 'plainenglish');
    const people = maintainCast(ctx, rng);
    const person = people.find((person) => person.mintedFrom === original.id)!;
    expect(person).toBeDefined();
    expect(ctx.world.chronicle.find((entry) => entry.title === 'An unexpected arrival')!.text)
      .toBe(`${person.name} arrived, and nobody had sent for them.`);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});

/**
 * SUCCESSION, AND THE STAFF.
 *
 * Neither of these systems announces a failure. A house that cannot seat a
 * Head has every `head` slot go unfillable, and the event pool collapses to
 * whatever needs nobody — a thousand quiet years that look like a working
 * simulation. A contract system that never lapses looks the same: the steward
 * hired in 1042 is still drawing wages in 2042 and no line of output says so.
 *
 * Everything here builds the household it means and runs the one function.
 */

/** Clear the founding cast out, so the only people in the world are the test's. */
function emptyHouse(seed = 1042): SimCtx {
  const ctx = bootstrap(bundle, seed, 1042);
  for (const p of ctx.world.people.living()) {
    ctx.world.people.kill(p.id, ctx.world.year, 'before the test began');
  }
  for (const p of ctx.world.people.all()) p.castSlots = [];
  ctx.world.headSince = undefined;
  return ctx;
}

/**
 * A mundane son of the house. Every genome drawn from the player house's own
 * pool carries some font, so a man who cannot express has to be built from the
 * commons pool — which is exactly what a mundane line married in looks like.
 */
function mundane(ctx: SimCtx, spec: { age: number; name: string; branch?: string }): Person {
  const p = place(ctx, { sex: 'male', age: spec.age, name: spec.name, ...(spec.branch ? { branch: spec.branch } : {}) });
  p.genome = { kind: 'lazy', pool: 'commons', seed: hashSeed('mundane', spec.name) };
  p.phenotype = undefined;
  return p;
}

const contract = (over: Partial<RetainerContract> = {}): RetainerContract => ({
  role: 'steward',
  term: 'lifetime',
  wage: 40,
  loyalty: 50,
  boundTo: 'nobody',
  onEmployerDeath: 'released',
  debt: 0,
  knowsSecrets: [],
  ...over,
});

describe('known succession', () => {
  it('keeps an unwoken son uncertain instead of leaking what his genome will reveal', () => {
    const ctx = emptyHouse();
    const elder = mundane(ctx, { age: 45, name: 'MundaneSon' });
    elder.awakening = { ...elder.awakening, awakened: true, year: ctx.world.year, age: 45 };
    // Reuse the deterministic expresser fixture already exercised by the
    // Regency tests below; only the family's knowledge of him changes here.
    const younger = place(ctx, { sex: 'male', age: 17, name: 'Son' });

    const before = knownSuccession(ctx);
    expect(before.heir).toBeUndefined();
    expect(before.possible).toEqual([elder.id, younger.id]);
    expect(before.because).toContain('Son');
    expect(before.because).toContain('does not know');

    younger.awakening = { ...younger.awakening, awakened: true, year: ctx.world.year, age: 17 };
    younger.phenotype = undefined;
    const after = knownSuccession(ctx);
    expect(after.heir).toBe(younger.id);
    expect(after.heir).toBe(heirApparent(ctx)?.id);
  });

  it('keeps an equal-age unwoken candidate uncertain when stable order puts him first', () => {
    const ctx = emptyHouse(2684);
    const unknown = place(ctx, { sex: 'male', age: 30, name: 'Unknown' });
    const known = place(ctx, { sex: 'male', age: 30, name: 'Known', awakened: true });

    const before = knownSuccession(ctx);
    expect(before.heir).toBeUndefined();
    expect(before.possible).toEqual([unknown.id, known.id]);

    unknown.awakening = {
      ...unknown.awakening,
      awakened: true,
      year: ctx.world.year,
      age: 30,
    };
    unknown.phenotype = undefined;

    const after = knownSuccession(ctx);
    expect(after.heir).toBe(unknown.id);
    expect(after.heir).toBe(heirApparent(ctx)?.id);
  });

  it('never names a certain heir different from the simulation rule', () => {
    const fixtures = [
      () => {
        const ctx = emptyHouse(2681);
        place(ctx, { sex: 'male', age: 40, name: 'Known', awakened: true });
        return ctx;
      },
      () => {
        const ctx = emptyHouse(2682);
        const man = mundane(ctx, { age: 40, name: 'Mundane' });
        man.awakening = { ...man.awakening, awakened: true, year: ctx.world.year, age: 40 };
        return ctx;
      },
      () => {
        const ctx = emptyHouse(2683);
        const man = mundane(ctx, { age: 40, name: 'Mundane' });
        man.awakening = { ...man.awakening, awakened: true, year: ctx.world.year, age: 40 };
        place(ctx, { sex: 'female', age: 35, name: 'Regent' });
        return ctx;
      },
    ];

    for (const build of fixtures) {
      const ctx = build();
      const known = knownSuccession(ctx);
      if (known.heir) expect(known.heir).toBe(heirApparent(ctx)?.id);
    }
  });
});

describe('succession membership boundary (issue #294)', () => {
  function outsiderMarriedIntoPlayerHouse(ctx: SimCtx): Person {
    const outsider = place(ctx, { sex: 'female', age: 40, name: 'Outsider' });
    const original = outsider.membership[0]!;
    const otherHouse = bundle.houses.find((h) => h.id !== ctx.world.playerHouse)?.id;
    if (!otherHouse) throw new Error('fixture needs a non-player house');

    outsider.membership = [
      {
        ...original,
        house: asId(otherHouse),
        kind: 'blood',
        from: ctx.world.year - 40,
        to: ctx.world.year,
      },
      {
        ...original,
        house: original.house,
        kind: 'married_in',
        from: ctx.world.year,
        to: undefined,
      },
    ];
    return outsider;
  }

  it('does not treat a married-in outsider\'s closed blood membership as the player line', () => {
    const ctx = emptyHouse();
    const outsider = outsiderMarriedIntoPlayerHouse(ctx);

    expect(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).map((p) => p.id))
      .toContain(outsider.id);
    expect(heirApparent(ctx)).toBeUndefined();
    expect(knownSuccession(ctx)).toEqual({ possible: [] });
  });

  it('keeps a current player-house blood member eligible', () => {
    const ctx = emptyHouse();
    const blood = place(ctx, { sex: 'female', age: 35, name: 'Blood' });

    expect(heirApparent(ctx)?.id).toBe(blood.id);
    expect(knownSuccession(ctx)).toEqual({ heir: blood.id, possible: [blood.id] });
  });

  it('keeps a current player-house cadet eligible', () => {
    const ctx = emptyHouse();
    const cadet = place(ctx, { sex: 'female', age: 35, name: 'Cadet' });
    cadet.membership[0]!.kind = 'cadet';
    cadet.membership[0]!.branch = 'br_test_cadet';

    expect(heirApparent(ctx)?.id).toBe(cadet.id);
    expect(knownSuccession(ctx)).toEqual({ heir: cadet.id, possible: [cadet.id] });
  });

  it('keeps heirApparent and knownSuccession on the same membership boundary', () => {
    const ctx = emptyHouse();
    const outsider = outsiderMarriedIntoPlayerHouse(ctx);
    const blood = place(ctx, { sex: 'female', age: 30, name: 'TrueBlood' });

    const rule = heirApparent(ctx);
    const view = knownSuccession(ctx);

    expect(rule?.id).toBe(blood.id);
    expect(view.heir).toBe(rule?.id);
    expect(view.possible).toEqual([blood.id]);
    expect(view.possible).not.toContain(outsider.id);
  });
});

describe('seating a Head', () => {
  it('leaves a sitting Head alone', () => {
    const ctx = emptyHouse();
    const sitting = place(ctx, { sex: 'male', age: 40, name: 'Sitting', castSlots: ['head'] });
    ctx.world.headSince = 1000;

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead).toBeUndefined();
    expect(head(ctx.world)?.id).toBe(sitting.id);
    expect(ctx.world.headSince).toBe(1000);
  });

  it('takes the eldest expressing son of the blood', () => {
    const ctx = emptyHouse();
    const elder = place(ctx, { sex: 'male', age: 50, name: 'Elder' });
    place(ctx, { sex: 'male', age: 30, name: 'Younger' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead?.id).toBe(elder.id);
    expect(result.regency).toBe(false);
    expect(ctx.world.headSince).toBe(ctx.world.year);
  });

  it('will not seat a child', () => {
    const ctx = emptyHouse();
    place(ctx, { sex: 'male', age: 9, name: 'Boy' });

    expect(ensureHead(ctx, testRng('head')).newHead).toBeUndefined();
    expect(head(ctx.world)).toBeUndefined();
  });

  it('clears a stale seal off the dead before it seats anybody', () => {
    const ctx = emptyHouse();
    const dead = place(ctx, { sex: 'male', age: 60, name: 'Dead', castSlots: ['head'] });
    place(ctx, { sex: 'male', age: 40, name: 'Living' });
    ctx.world.people.kill(dead.id, ctx.world.year, 'a winter');

    ensureHead(ctx, testRng('head'));

    expect(dead.castSlots).not.toContain('head');
    expect(ctx.world.people.all().filter((p) => p.castSlots.includes('head')).length).toBe(1);
  });

  it('prefers the main line to a cadet cousin, however senior the cousin', () => {
    const ctx = emptyHouse();
    const cousin = place(ctx, { sex: 'male', age: 60, name: 'Cousin', branch: 'br_hollow' });
    const son = place(ctx, { sex: 'male', age: 25, name: 'Son' });

    expect(ensureHead(ctx, testRng('head')).newHead?.id).toBe(son.id);
    expect(cousin.castSlots).not.toContain('head');
  });

  it('sends for the cadet cousin when the main line is gone, and brings him home', () => {
    const ctx = emptyHouse();
    const cousin = place(ctx, { sex: 'male', age: 60, name: 'Cousin', branch: 'br_hollow' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead?.id).toBe(cousin.id);
    const now = cousin.membership.find((m) => m.to === undefined)!;
    expect(now.branch ?? MAIN_BRANCH).toBe(MAIN_BRANCH);
  });
});

describe('Regency', () => {
  it('seats a woman of the blood when no son wakes, and says so in the chronicle', () => {
    const ctx = emptyHouse();
    mundane(ctx, { age: 45, name: 'MundaneSon' });
    const daughter = place(ctx, { sex: 'female', age: 30, name: 'Daughter' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead?.id).toBe(daughter.id);
    expect(result.regency).toBe(true);
    expect(inRegency(ctx.world)).toBe(true);
    expect(ctx.world.chronicle.some((e) => e.title === 'A Regency')).toBe(true);
  });

  it('yields to any expressing son, of any age over sixteen', () => {
    const ctx = emptyHouse();
    place(ctx, { sex: 'female', age: 60, name: 'Aunt' });
    const son = place(ctx, { sex: 'male', age: 17, name: 'Son' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead?.id).toBe(son.id);
    expect(result.regency).toBe(false);
    expect(inRegency(ctx.world)).toBe(false);
  });

  it('gives the seat to a mundane man only when there is no woman of the blood either', () => {
    const ctx = emptyHouse();
    const man = mundane(ctx, { age: 45, name: 'MundaneOnly' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead?.id).toBe(man.id);
    expect(result.regency).toBe(false);
  });

  it('reports no Regency when there is nobody at all', () => {
    const ctx = emptyHouse();
    expect(ensureHead(ctx, testRng('head'))).toEqual({ regency: false });
    expect(inRegency(ctx.world)).toBe(false);
  });
});

describe('Wardship (issue #91, world "Taxes")', () => {
  it('opens a Wardship on the minor rather than skipping to an available adult cousin', () => {
    const ctx = emptyHouse();
    const cousin = place(ctx, { sex: 'male', age: 40, name: 'Cousin', branch: 'br_hollow' });
    const son = place(ctx, { sex: 'male', age: 9, name: 'Son' });

    const result = ensureHead(ctx, testRng('head'));

    expect(result.newHead).toBeUndefined();
    expect(head(ctx.world)).toBeUndefined();
    expect(ctx.world.wardship?.ward).toBe(son.id);
    expect(ctx.world.wardship?.since).toBe(ctx.world.year);
    expect(cousin.castSlots).not.toContain('head');
    expect(ctx.world.chronicle.some((e) => e.title === 'The Warden takes the roll')).toBe(true);
  });

  it('seats nobody while the ward is still under sixteen, and seats him the year he turns sixteen', () => {
    const ctx = emptyHouse();
    const son = place(ctx, { sex: 'male', age: 9, name: 'Son' });
    ensureHead(ctx, testRng('head'));
    expect(ctx.world.wardship?.ward).toBe(son.id);

    ctx.world.year += 6; // fifteen
    const stillMinor = ensureHead(ctx, testRng('head'));
    expect(stillMinor.newHead).toBeUndefined();
    expect(ctx.world.wardship?.ward).toBe(son.id);

    ctx.world.year += 1; // sixteen
    const result = ensureHead(ctx, testRng('head'));
    expect(result.newHead?.id).toBe(son.id);
    expect(ctx.world.wardship).toBeUndefined();
    expect(head(ctx.world)?.id).toBe(son.id);
    expect(ctx.world.chronicle.some((e) => e.title === 'Come of age')).toBe(true);
  });

  it('falls through to ordinary succession when the ward dies before majority', () => {
    const ctx = emptyHouse();
    const son = place(ctx, { sex: 'male', age: 9, name: 'Son' });
    const cousin = place(ctx, { sex: 'male', age: 40, name: 'Cousin', branch: 'br_hollow' });
    ensureHead(ctx, testRng('head'));
    expect(ctx.world.wardship?.ward).toBe(son.id);

    ctx.world.people.kill(son.id, ctx.world.year, 'a fever');
    const result = ensureHead(ctx, testRng('head'));

    expect(ctx.world.wardship).toBeUndefined();
    expect(result.newHead?.id).toBe(cousin.id);
  });

  it('buys the wardship back without seating the ward early', () => {
    const ctx = emptyHouse();
    const son = place(ctx, { sex: 'male', age: 9, name: 'Son' });
    ensureHead(ctx, testRng('head'));
    ctx.world.treasury = 10000;

    const result = buyBackWardship(ctx);

    expect(result.ok).toBe(true);
    expect(result.spent).toBeGreaterThan(0);
    expect(ctx.world.wardship?.boughtBack).toBe(true);
    expect(ctx.world.wardship?.ward).toBe(son.id);
    expect(head(ctx.world)).toBeUndefined();
  });

  it('refuses to buy back a wardship the house cannot afford', () => {
    const ctx = emptyHouse();
    place(ctx, { sex: 'male', age: 9, name: 'Son' });
    ensureHead(ctx, testRng('head'));
    ctx.world.treasury = DEBT_FLOOR;

    const result = buyBackWardship(ctx);

    expect(result.ok).toBe(false);
    expect(ctx.world.wardship?.boughtBack).toBeFalsy();
  });

  it('refuses to buy back a wardship that is not standing', () => {
    const ctx = emptyHouse();
    place(ctx, { sex: 'male', age: 40, name: 'Adult' });
    ensureHead(ctx, testRng('head'));

    expect(buyBackWardship(ctx).ok).toBe(false);
  });
});

describe('a contract ends with the man who signed it', () => {
  /** A house with a Head, money, and one retainer on the given terms. */
  function staffed(over: Partial<RetainerContract> = {}) {
    const ctx = emptyHouse();
    const employer = place(ctx, { sex: 'male', age: 45, name: 'Employer', castSlots: ['head'] });
    const servant = place(ctx, { sex: 'female', age: 35, name: 'Servant' });
    servant.contract = contract({ boundTo: employer.id, ...over });
    ctx.world.treasury = 500;
    return { ctx, employer, servant };
  }

  it('keeps a servant whose employer is alive and whose wages are paid', () => {
    const { ctx, servant } = staffed();
    expect(releaseContracts(ctx, testRng())).toEqual([]);
    expect(servant.contract).toBeDefined();
  });

  it('passes the servant to the heir when the man who hired them dies', () => {
    const { ctx, employer, servant } = staffed({ onEmployerDeath: 'passes_to_heir' });
    const heir = place(ctx, { sex: 'male', age: 20, name: 'Heir' });
    ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');
    heir.castSlots.push('head');

    expect(releaseContracts(ctx, testRng())).toEqual([]);
    expect(servant.contract?.boundTo).toBe(heir.id);
  });

  it('releases the servant when the contract ends with the employer', () => {
    const { ctx, employer, servant } = staffed({ onEmployerDeath: 'released' });
    ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');

    expect(releaseContracts(ctx, testRng()).map((r) => r.person.id)).toEqual([servant.id]);
    expect(servant.contract).toBeUndefined();
    // NOT in the chronicle (issue #87). An employer dying releases everybody
    // bound to him at once, and one line per servant was 18% of the panel's
    // window. It is a passage — the years doing what the years do — and the
    // report is where the passage log reads it from.
    expect(ctx.world.chronicle.some((e) => e.text?.includes('released from service'))).toBe(false);
  });

  it('never lapses a contract bound to the house itself', () => {
    const { ctx, employer, servant } = staffed({ onEmployerDeath: 'released' });
    servant.contract!.boundTo = ctx.world.playerHouse;
    ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');

    expect(releaseContracts(ctx, testRng())).toEqual([]);
    expect(servant.contract).toBeDefined();
  });

  it('is the first thing an empty treasury costs: the quarter\'s staff go', () => {
    const { ctx, servant } = staffed({ term: 'yearly', wage: 200 });
    ctx.world.treasury = 9; // under wage/20

    expect(releaseContracts(ctx, testRng()).map((r) => r.person.id)).toEqual([servant.id]);
    expect(ctx.world.chronicle.some((e) => e.text?.includes('wages'))).toBe(true);
  });

  it('keeps the short-term staff while the house can still pay them', () => {
    const { ctx, servant } = staffed({ term: 'yearly', wage: 200 });
    ctx.world.treasury = 11; // over wage/20

    expect(releaseContracts(ctx, testRng())).toEqual([]);
    expect(servant.contract).toBeDefined();
  });

  it('loses even the staff it swore to keep once the house is destitute', () => {
    const { ctx, servant } = staffed({ term: 'lifetime' });
    ctx.world.treasury = DEBT_FLOOR;

    expect(releaseContracts(ctx, testRng()).map((r) => r.person.id)).toEqual([servant.id]);
    expect(servant.contract).toBeUndefined();
  });

  it('does not lose the hereditary family, who are bound to the house and not to a wage', () => {
    const { ctx, servant } = staffed({ term: 'hereditary' });
    ctx.world.treasury = DEBT_FLOOR;

    expect(releaseContracts(ctx, testRng())).toEqual([]);
    expect(servant.contract).toBeDefined();
  });
});

describe('servant dynasties', () => {
  /** A dead hereditary archivist with one grown child in the house. */
  function afterTheArchivist(role: RetainerRole = 'archivist') {
    const ctx = emptyHouse();
    const sitting = place(ctx, { sex: 'male', age: 40, name: 'Sitting', castSlots: ['head'] });
    const old = place(ctx, { sex: 'male', age: 70, name: 'OldHand' });
    old.contract = contract({ role, term: 'hereditary', boundTo: sitting.id, knowsSecrets: [] });
    const child = place(ctx, { sex: 'female', age: 25, name: 'YoungHand' });
    beget(ctx, child, undefined, old);
    ctx.world.people.kill(old.id, ctx.world.year, 'age');
    return { ctx, sitting, old, child };
  }

  it('gives the post to the last holder\'s child, bound to the sitting Head', () => {
    const { ctx, sitting, child } = afterTheArchivist();

    expect(inheritPost(ctx, 'archivist')?.id).toBe(child.id);
    expect(child.contract?.role).toBe('archivist');
    expect(child.contract?.term).toBe('hereditary');
    expect(child.contract?.boundTo).toBe(sitting.id);
    expect(ctx.world.chronicle.some((e) => e.text?.includes('took up'))).toBe(true);
  });

  it('binds the post to the house when nobody is sitting', () => {
    const { ctx, sitting, child } = afterTheArchivist();
    sitting.castSlots = [];

    inheritPost(ctx, 'archivist');
    expect(child.contract?.boundTo).toBe(ctx.world.playerHouse);
  });

  it('offers nothing for a post nobody held', () => {
    const { ctx } = afterTheArchivist();
    expect(inheritPost(ctx, 'tutor')).toBeUndefined();
  });

  it('offers nothing when the post was never hereditary', () => {
    const ctx = emptyHouse();
    const sitting = place(ctx, { sex: 'male', age: 40, name: 'Sitting', castSlots: ['head'] });
    const old = place(ctx, { sex: 'male', age: 70, name: 'Hired' });
    old.contract = contract({ role: 'archivist', term: 'lifetime', boundTo: sitting.id });
    const child = place(ctx, { sex: 'female', age: 25, name: 'Child' });
    beget(ctx, child, undefined, old);
    ctx.world.people.kill(old.id, ctx.world.year, 'age');

    expect(inheritPost(ctx, 'archivist')).toBeUndefined();
    expect(child.contract).toBeUndefined();
  });

  it('passes over a child too young to hold it', () => {
    const { ctx, old, child } = afterTheArchivist();
    child.born = ctx.world.year - 10;

    expect(inheritPost(ctx, 'archivist')).toBeUndefined();
    expect(old.contract).toBeDefined(); // the dead man keeps his record of it
  });

  it('passes over a child who is already in service somewhere', () => {
    const { ctx, child } = afterTheArchivist();
    child.contract = contract({ role: 'midwife', term: 'lifetime' });

    expect(inheritPost(ctx, 'archivist')).toBeUndefined();
    expect(child.contract.role).toBe('midwife');
  });

  it('follows the most recent holder when the post has changed hands', () => {
    const { ctx, sitting } = afterTheArchivist();
    const later = place(ctx, { sex: 'male', age: 60, name: 'LaterHand' });
    later.contract = contract({ role: 'archivist', term: 'hereditary', boundTo: sitting.id });
    const laterChild = place(ctx, { sex: 'male', age: 30, name: 'LaterChild' });
    beget(ctx, laterChild, undefined, later);
    ctx.world.year += 10;
    ctx.world.people.kill(later.id, ctx.world.year, 'age');

    expect(inheritPost(ctx, 'archivist')?.id).toBe(laterChild.id);
  });
});

/**
 * THE POSTS THE HOUSE MAY HIRE INTO.
 *
 * `maintainCast` loops over the roles content can fill, and for a year it
 * looped over a hand-written list of five while the union declared eight. That
 * is not a crash and not a failing assertion: it is a house that never once
 * hires a physician across a thousand years, and a `physician` slot no event
 * can ever cast, and nothing anywhere saying so. These two tests are the thing
 * that says so.
 */
describe('the eight posts', () => {
  it('every role the schema declares has a template that can fill it', () => {
    const filled = new Set(
      bundle.characterTemplates
        .filter((t) => t.role === 'retainer' && t.contract)
        .map((t) => t.contract!.role),
    );
    const unfillable = RetainerRoleS.options.filter((r) => !filled.has(r));

    expect(unfillable, 'a RetainerRole no template names is a post no run can occupy').toEqual([]);
  });

  it('hires into every one of them, and never a second of a post already held', () => {
    const ctx = emptyHouse();
    place(ctx, { sex: 'male', age: 44, name: 'Head', castSlots: ['head'] });
    ctx.world.treasury = 4000;
    // Seven of the eight templates are uncommon, and uncommon is rationed:
    // generation 1 at the earliest, and twelve years between any two of the
    // tier. The house cannot staff itself in its first season and is not
    // meant to be able to.
    ctx.world.generation = 4;

    for (let i = 0; i < 300; i++) {
      maintainCast(ctx, testRng(`cast-${i}`));
      ctx.world.year += 1;
    }

    const held = ctx.world.people.living().filter((p) => p.contract).map((p) => p.contract!.role);
    for (const role of RetainerRoleS.options) {
      expect(held.filter((r) => r === role).length, `posts held as '${role}'`).toBe(1);
    }
  });
});
/**
 * THE LINE (issue #56).
 *
 * `ensureHead` strips the seal from everybody the moment it seats somebody
 * new, which is right — one head at a time — and meant that nothing anywhere
 * remembered the fourteen before him. The dead leave the halls by design, so a
 * player at 1400 had fourteen generations of ancestors with no trace on any
 * screen, in a game whose whole subject is generational.
 */
describe('who has held the seal', () => {
  it('writes down every handover, in order, without gaps', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    runYears(ctx, 400);

    const line = ctx.world.succession;
    // At least one handover, which is what the message says. This was `> 3`,
    // a number about how long THIS seed's house lives rather than about the
    // record: #341's content pass re-rolled seed 1042 into a house that dies
    // out after three reigns, with 400-year extinction unchanged across forty
    // seeds (17 against 18), and three reigns still carry two handovers to
    // check the order of.
    expect(line.length, 'four hundred years and nobody took the seal').toBeGreaterThan(1);

    for (let i = 0; i < line.length; i++) {
      const held = line[i]!;
      expect(held.name, 'a reign with nobody in it').toBeTruthy();
      // Closed behind, open in front: exactly one reign is still running, and
      // it is the last. A second open record is two heads at once.
      if (i < line.length - 1) {
        expect(held.to, `reign ${i} never ended`).toBeDefined();
        expect(line[i + 1]!.from).toBeGreaterThanOrEqual(held.to!);
      }
    }
    const open = line.filter((h) => h.to === undefined);
    expect(open.length, 'the house has two sitting heads, or none').toBeLessThanOrEqual(1);
  });

  /**
   * THE FOUNDER IS IN IT.
   *
   * `ensureHead` writes the line, and `ensureHead` never runs for him — he is
   * seated by `bootstrap` from the founding cast. So the record of who has
   * held the seal used to begin with his SUCCESSOR, and the man who signed the
   * thing in 1042 was missing from the one screen that exists to show the line
   * back to the signing.
   *
   * This is the second time that gap has been found in this exact spot: the
   * comment beside it in `sim.ts` records `headSince` having had it, for the
   * same reason, and staying undefined through the founder's whole forty-year
   * reign.
   */
  it('starts at the signing, with the man who signed it', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const first = ctx.world.succession[0];
    expect(first, 'nobody holds the seal in 1042').toBeTruthy();
    expect(first!.from, 'the line begins after the signing').toBe(1042);

    const founder = ctx.world.people.living().find((p) => p.castSlots.includes('head'));
    expect(first!.person).toBe(founder?.id);

    // And he stays first once the house has outlived him several times over.
    runYears(ctx, 400);
    expect(ctx.world.succession[0]).toEqual({ ...first });
  });

  it('names the sitting head as the one still holding it', () => {
    const ctx = bootstrap(bundle, 909, 1042);
    runYears(ctx, 200);

    const sitting = ctx.world.people.living().find((p) => p.castSlots.includes('head'));
    const open = ctx.world.succession.find((h) => h.to === undefined);
    if (sitting) {
      expect(open, 'somebody holds the seal and no reign is open').toBeTruthy();
      expect(open!.person).toBe(sitting.id);
    }
  });

  /**
   * The save half. A field added to the world and not to the save does not
   * fail — it resets silently on load, which looks exactly like a house whose
   * ancestors were never recorded.
   */
  it('carries the line across a save and a load', () => {
    const ctx = bootstrap(bundle, 8080, 1042);
    runYears(ctx, 300);
    expect(ctx.world.succession.length).toBeGreaterThan(1);

    const back = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(back.world.succession).toEqual(ctx.world.succession);
  });
});

/**
 * THE SECOND SHELF LINE (issue #87).
 *
 * An employer dying releases every retainer bound to him at once, and each one
 * wrote its own `line`. Measured on seed 7 after #82 landed, that one sentence
 * was ELEVEN of the sixty entries the chronicle panel draws — 18% of the
 * window, and the largest thing left in it. It is demography, and it is what
 * `year/passage.ts` is for.
 *
 * The distinction is not "servants are boring". It is who did it: the three
 * endings the HOUSE causes stay in the book, because an empty treasury losing
 * you your staff is the first thing an empty treasury actually costs, and a
 * man freeing his servants in his will is his last act.
 */
describe('which endings of service the book keeps', () => {
  function withServant(term: RetainerContract['term'], onEmployerDeath: RetainerContract['onEmployerDeath']) {
    const ctx = testWorld(bundle, 8787, 1200);
    const employer = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const servant = place(ctx, {
      sex: 'male',
      age: 30,
      name: 'A Servant',
      contract: contract({ term, wage: 200, boundTo: employer.id, onEmployerDeath }),
    });
    return { ctx, employer, servant };
  }

  it('leaves the employer\'s death to the passage log, and still reports it', () => {
    const { ctx, employer, servant } = withServant('lifetime', 'released');
    ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');
    const before = ctx.world.chronicle.length;

    const ended = releaseContracts(ctx, testRng());

    // It happened, and the report carries the sentence for the log to draw.
    expect(ended.map((r) => r.person.id)).toEqual([servant.id]);
    expect(ended[0]!.text).toContain('released from service');
    expect(ended[0]!.reason).toBe('employer_died');
    // And the book says nothing, which is the whole change.
    expect(ctx.world.chronicle.length).toBe(before);
  });

  it('writes down the endings the house itself caused', () => {
    for (const [term, treasury, says] of [
      ['yearly', 9, 'wages'],
      ['lifetime', DEBT_FLOOR, 'nothing left to pay them with'],
    ] as const) {
      const { ctx, servant } = withServant(term, 'released');
      ctx.world.treasury = treasury;
      const said = () => ctx.world.chronicle.some((e) => e.text?.includes(says));
      expect(said()).toBe(false);

      // At the debt floor the whole staff goes, not only this one, so the
      // claim is about the sentence rather than about a line count.
      const ended = releaseContracts(ctx, testRng());

      expect(ended.map((r) => r.person.id)).toContain(servant.id);
      expect(said(), `${term} at ${treasury} wrote nothing`).toBe(true);
    }
  });

  it('writes down a man freeing his servants in his will', () => {
    const { ctx, employer } = withServant('lifetime', 'freed');
    ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');
    const before = ctx.world.chronicle.length;

    const ended = releaseContracts(ctx, testRng());

    expect(ended[0]!.reason).toBe('freed');
    expect(ctx.world.chronicle.length).toBe(before + 1);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('freed by the will');
  });
});
