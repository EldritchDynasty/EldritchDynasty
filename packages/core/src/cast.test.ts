import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { asId, proseOriginalHash } from '@ed/schema';
import { CAST_MAX, CAST_ROLES, castLabel, castOf, type CastRole } from './cast.js';
import { contentProseAddress, missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { heirApparent } from './people/succession.js';
import { beget, marry, place, testWorld } from './testing.js';
import { coreMessageEntries } from './tools/core-message-audit.js';
import { plainEnglishCoreWorkItems } from './tools/string-audit.js';
import type { SimCtx } from './world.js';

const bundle = loadContent();

/**
 * WHO THIS GENERATION IS ABOUT (issue #44), AND WHY IT IS NOT A ROTA (#86).
 *
 * The failure this guards is not a crash. It is a list that quietly names the
 * same man four times, or names nobody, or names a person who died in 1310 —
 * all of which look like a working panel from outside, which is this
 * codebase's whole failure mode.
 *
 * The second failure it guards is subtler and shipped: a panel that fills
 * every slot it has, every year, with the offices of a household. That one
 * also looks like a working panel from outside. It is checked here by asking
 * whether an ORDINARY fact can be crowded out by an unusual one, and in
 * `cast.slow.test.ts` by measuring how often each role appears across a
 * thousand years.
 */
describe('the cast of a generation', () => {
  const roles = (ctx: SimCtx): CastRole[] => castOf(ctx).map((c) => c.role);

  /** A house with somebody for every role to find. */
  function aFamily(): SimCtx {
    const ctx = testWorld(bundle, 8801);
    const w = ctx.world;

    const head = place(ctx, { sex: 'male', age: 44, name: 'Head', castSlots: ['head'] });
    w.headSince = w.year - 12;
    const son = place(ctx, { sex: 'male', age: 22, name: 'Son' });
    const daughter = place(ctx, { sex: 'female', age: 17, name: 'Daughter' });
    const wife = place(ctx, { sex: 'female', age: 40, name: 'Wife', house: 'house_marrow' });
    // She lives here now: a wife of another house keeps her origin and joins
    // the household, which is exactly why she is easy to stop seeing.
    wife.membership.push({ house: asId(w.playerHouse), kind: 'married_in', from: w.year - 20 });
    marry(ctx, head, wife);
    // Married twenty years ago, not this morning: what puts her on the list is
    // a marriage the house has been counting and she has not answered.
    for (const m of [...head.marriages, ...wife.marriages]) m.from = w.year - 20;

    const cousin = place(ctx, { sex: 'male', age: 38, name: 'Cousin', branch: 'branch_ash' });
    w.branches.set('branch_ash', {
      id: 'branch_ash',
      name: 'Ashfold',
      house: w.playerHouse,
      founder: cousin.id,
      splitFrom: 'main',
      foundedYear: w.year - 60,
      grievance: 64,
    } as never);

    void son;
    void daughter;
    return ctx;
  }

  it('names three to seven people, never seventy', () => {
    const cast = castOf(aFamily());
    expect(cast.length).toBeGreaterThanOrEqual(3);
    expect(cast.length).toBeLessThanOrEqual(CAST_MAX);
  });

  it('names each person once, however many roles they answer to', () => {
    const cast = castOf(aFamily());
    const ids = cast.map((c) => c.person);
    expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
  });

  it('gives every one of them a reason that is only true of them', () => {
    const cast = castOf(aFamily());
    for (const c of cast) {
      expect(c.because.length, `${c.role} has nothing to say`).toBeGreaterThan(12);
    }
    // The reasons are facts about people, not a role label wearing a sentence.
    expect(new Set(cast.map((c) => c.because)).size).toBe(cast.length);
  });

  /**
   * The client used to keep its own role-to-label dictionary, which is a
   * hand-written copy of a closed union — so the day #86 doubled the roles it
   * would have drawn `sole_expresser` at the player in a panel of prose.
   */
  it('carries the wording the engine chose for each role', () => {
    const ctx = aFamily();
    for (const role of CAST_ROLES) {
      expect(castLabel(ctx, role), `${role} has no label`).toBeTruthy();
    }
    for (const c of castOf(ctx)) expect(c.label).toBe(castLabel(ctx, c.role));
  });

  it('finds the hall with the wound, and who speaks for it', () => {
    const cast = castOf(aFamily());
    const wound = cast.find((c) => c.role === 'aggrieved');
    expect(wound, cast.map((c) => c.role).join(',')).toBeTruthy();
    expect(wound!.hall).toBe('Ashfold');
    expect(wound!.because).toMatch(/Ashfold/);
  });

  /**
   * A WOUND HAS TO BE A REAL ONE. A cadet hall acquires a grievance the year
   * it is founded, and any grievance at all used to buy a slot — which is how
   * `aggrieved` came to be on the panel in nine sampled generations in ten
   * while saying nothing in eight of them.
   */
  it('leaves a small grievance off the list', () => {
    const ctx = aFamily();
    const hall = ctx.world.branches.get('branch_ash')!;
    hall.grievance = 6;
    expect(roles(ctx)).not.toContain('aggrieved');
  });

  it('finds a woman who came in from another house', () => {
    const ctx = aFamily();
    const cast = castOf(ctx);
    const outsider = cast.find((c) => c.role === 'married_in');
    expect(outsider, cast.map((c) => c.role).join(',')).toBeTruthy();
    const her = ctx.world.people.get(outsider!.person)!;
    expect(her.houseOfOrigin).not.toBe(ctx.world.playerHouse);
    expect(outsider!.because).toMatch(/married in from/);
  });

  it('only ever names the living of this house', () => {
    const ctx = aFamily();
    const living = new Set<string>(
      ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).map((p) => String(p.id)),
    );
    for (const c of castOf(ctx)) expect(living.has(c.person), `${c.name} is not in the house`).toBe(true);
  });

  /**
   * INVARIANT 6. A cast written into the world would be right for one spring
   * and wrong for four hundred years, and would look exactly like a panel that
   * stopped updating. So: reading it changes nothing, and reading it after the
   * world moves says something else.
   */
  it('is a reading and not storage', () => {
    const ctx = aFamily();
    const w = ctx.world;
    /**
     * What a reading is allowed to change is nothing anybody decided. A lazy
     * genome materialising is not an exception to that — it is the same genome
     * the seed always described, written out because somebody finally looked —
     * and it is why this compares the state the SIMULATION owns rather than
     * the save's bytes.
     *
     * The bug this caught on the way in: asking which hall carried the wound
     * ELECTED a speaker in every branch that did not have one, because
     * `speakerOf` records its answer. `wouldSpeakFor` is the reading now.
     */
    const state = () => JSON.stringify({
      speakers: [...w.branches.values()].map((b) => [b.id, b.speaker]),
      seats: w.people.all().map((p) => [p.id, p.castSlots.join('|'), p.status]),
      headSince: w.headSince,
      chronicle: w.chronicle.length,
      studies: w.studies.length,
      year: w.year,
    });

    const before = state();
    const first = castOf(ctx);
    expect(state(), 'reading the cast changed the world').toBe(before);
    expect(castOf(ctx)).toEqual(first);

    const head = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.castSlots.includes('head'))!;
    ctx.world.people.kill(head.id, ctx.world.year, 'age');
    const after = castOf(ctx);
    expect(after.some((c) => c.person === head.id), 'a dead man is still on the list').toBe(false);
  });

  it('says out loud what the daughter is carrying, when one of them is', () => {
    const ctx = aFamily();
    const her = castOf(ctx).find((c) => c.role === 'carrier');
    // Whether this seed's daughters carry anything is genetics; what is being
    // asserted is that when one does, the list says what she is carrying
    // rather than listing her as a row in a marriage table (#24 item 3).
    if (her) {
      expect(her.sex).toBe('female');
      expect(her.because).toMatch(/carries/);
    }
  });
});

/**
 * THE ROLES THAT ARE NOT OFFICES (issue #86).
 *
 * Each of these is rare enough in a played run that a six-seed batch cannot
 * carry a claim about it — `papers` turns up in about one sampled generation
 * in a hundred — so the mechanism is built here, on the state it is about,
 * rather than waited for. *Build the state you mean.*
 */
describe('the situational roles', () => {
  function quiet(): SimCtx {
    const ctx = testWorld(bundle, 4402);
    ctx.world.headSince = ctx.world.year - 20;
    return ctx;
  }

  const roleOf = (ctx: SimCtx, id: string) => castOf(ctx).find((c) => c.person === id);

  it('names the man who has been at court since he was nineteen', () => {
    const ctx = quiet();
    const man = place(ctx, {
      sex: 'male', age: 69, name: 'Emeric', career: { career: 'court', heldYears: 50 },
    });
    const row = roleOf(ctx, String(man.id));
    expect(row?.role).toBe('long_post');
    expect(row?.because).toMatch(/since he was 19/);
  });

  it('names a servant who is owed better than the house has paid', () => {
    const ctx = quiet();
    const him = place(ctx, {
      sex: 'male', age: 46, name: 'Alder',
      contract: {
        role: 'archivist', term: 'yearly', wage: 12, loyalty: 8, boundTo: 'x',
        onEmployerDeath: 'released', debt: 0, knowsSecrets: [asId('secret_one'), asId('secret_two')],
      },
    });
    const row = roleOf(ctx, String(him.id));
    expect(row?.role).toBe('bonded');
    expect(row?.because).toMatch(/2 of its secrets/);
  });

  it('names the one whose papers somebody has already read', () => {
    const ctx = quiet();
    const man = place(ctx, { sex: 'male', age: 33, name: 'Gethen' });
    man.lineageDocuments.push({
      generations: 3, notarisedBy: 'the Bramme chapter house', forged: true, exposed: ctx.world.year - 4,
    });
    const row = roleOf(ctx, String(man.id));
    expect(row?.role).toBe('papers');
    expect(row?.because).toMatch(/parish roll/);
  });

  it('names the one standing on a pedigree the house paid for', () => {
    const ctx = quiet();
    const man = place(ctx, { sex: 'male', age: 33, name: 'Gethen' });
    man.lineageDocuments.push({
      generations: 4, notarisedBy: 'a clerk at Cawdry', forged: true,
    });
    const row = roleOf(ctx, String(man.id));
    expect(row?.role).toBe('papers');
    expect(row?.because).toMatch(/a clerk at Cawdry was paid to write/);
  });

  it('names the woman nobody has asked for', () => {
    const ctx = quiet();
    const her = place(ctx, { sex: 'female', age: 37, name: 'Sable' });
    const row = roleOf(ctx, String(her.id));
    expect(row?.role).toBe('unwed');
    expect(row?.because).toMatch(/37/);
  });

  it('names whoever has actually read the shelf', () => {
    const ctx = quiet();
    const man = place(ctx, { sex: 'male', age: 40, name: 'Reader' });
    man.spellsKnown = ['a', 'b', 'c', 'd'].map((b) => asId<typeof man.spellsKnown[number]>(b));
    const row = roleOf(ctx, String(man.id));
    expect(row?.role).toBe('scholar');
    expect(row?.because).toMatch(/has read 4 of the books/);
  });

  it('names a widow with children still to raise', () => {
    const ctx = quiet();
    const w = ctx.world;
    // Keep this a widow fixture rather than an accidental carrier fixture.
    // Founding inheritance (#344) legitimately moved which women carry the
    // strongest font, and a player-house draw for Nell can now make that louder
    // than one young child. Her origin is outside the blood; only her household
    // membership is here.
    const her = place(ctx, { sex: 'female', age: 34, name: 'Nell', house: 'commons' });
    her.membership = [{ house: asId(w.playerHouse), kind: 'married_in', from: w.year - 10 }];
    const him = place(ctx, { sex: 'male', age: 40, name: 'Gone' });
    marry(ctx, her, him);
    const child = place(ctx, { sex: 'male', age: 6, name: 'Small' });
    beget(ctx, child, her, him);
    w.people.kill(him.id, w.year - 2, 'plague');
    const row = roleOf(ctx, String(her.id));
    expect(row?.role, castOf(ctx).map((c) => `${c.role}:${c.name}`).join(',')).toBe('widow');
    expect(row?.because).toMatch(/1 child under sixteen/);
  });

  it('names the oldest, when nobody else is close', () => {
    const ctx = quiet();
    const old = place(ctx, { sex: 'female', age: 88, name: 'Mother' });
    const row = roleOf(ctx, String(old.id));
    expect(row?.role).toBe('eldest');
    expect(row?.because).toMatch(/is 88/);
  });
});

/**
 * MORE ROLES THAN SLOTS, which is the whole of #86.
 *
 * The panel had seven roles for seven slots, so everything that could be filled
 * was, and *somebody is next* took a slot every year for a thousand years. The
 * two assertions here are the mechanism: an ordinary fact can be crowded out,
 * and an extraordinary one cannot.
 */
describe('a cast, not a rota', () => {
  function household(): SimCtx {
    const ctx = testWorld(bundle, 9903);
    const w = ctx.world;
    w.headSince = w.year - 9;
    const son = place(ctx, { sex: 'male', age: 26, name: 'Son' });
    beget(ctx, son, undefined, seated(ctx));
    return ctx;
  }

  /** Whoever the bootstrap seated. Placing a second head is two heads. */
  function seated(ctx: SimCtx) {
    const w = ctx.world;
    return w.people.household(w.playerHouse, w.year).find((p) => p.castSlots.includes('head'))!;
  }

  /**
   * In the house and not of it. A man of the blood with forty years in post is
   * also a man `heirApparent` can return, and these tests are about what the
   * panel does with the SUCCESSION — so the loud fact and the succession are
   * put on two different people on purpose.
   */
  function inService(ctx: SimCtx, name: string, heldYears: number) {
    const w = ctx.world;
    const p = place(ctx, {
      sex: 'male', age: 19 + heldYears, name, house: 'house_marrow',
      career: { career: 'court', heldYears },
    });
    p.membership.push({ house: asId(w.playerHouse), kind: 'retainer', from: w.year - heldYears });
    return p;
  }

  it('drops the heir when the succession is ordinary and the year is not', () => {
    const ctx = household();
    const w = ctx.world;
    // Four louder facts than "somebody is next".
    inService(ctx, 'Emeric', 50);
    place(ctx, { sex: 'female', age: 39, name: 'Sable' });
    place(ctx, { sex: 'female', age: 90, name: 'Mother' });
    const clerk = place(ctx, {
      sex: 'male', age: 50, name: 'Clerk',
      contract: {
        role: 'chronicler', term: 'yearly', wage: 9, loyalty: 4, boundTo: 'x',
        onEmployerDeath: 'released', debt: 0, knowsSecrets: [asId('secret_one')],
      },
    });
    void clerk;
    void w;
    const cast = castOf(ctx);
    expect(cast.map((c) => c.role)).not.toContain('heir');
    expect(cast.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the heir when the seat is about to fall into a Regency', () => {
    const ctx = household();
    const w = ctx.world;
    const head = seated(ctx);
    // A Regency is news while the man holding the seal is old enough for it to
    // be a real prospect, which is the gate the finder puts on it.
    head.born = w.year - 70;
    // No expressing son left anywhere in the house, which is what a Regency
    // is and is the loudest thing a succession can say.
    for (const p of w.people.household(w.playerHouse, w.year)) {
      if (p.sex === 'male' && p.id !== head.id) w.people.kill(p.id, w.year, 'plague');
    }
    // `heirApparent` returns the OLDEST woman of the blood, so she is the only
    // one here; and she is married, because an unspent font is a louder fact
    // about the same woman and this test is about the succession.
    const girl = place(ctx, { sex: 'female', age: 34, name: 'Sister' });
    beget(ctx, girl, undefined, head);
    for (const p of w.people.household(w.playerHouse, w.year)) {
      if (p.sex === 'female' && p.id !== girl.id) w.people.kill(p.id, w.year, 'plague');
    }
    marry(ctx, girl, place(ctx, { sex: 'male', age: 36, name: 'Husband', house: 'house_marrow' }));
    inService(ctx, 'Emeric', 50);
    const heir = castOf(ctx).find((c) => c.role === 'heir');
    expect(heir?.name, castOf(ctx).map((c) => `${c.role}:${c.name}`).join(',')).toBe('Sister');
    expect(heir?.because).toMatch(/it falls into a Regency/);
  });

  /** Some decades are genuinely about three people. */
  it('is allowed to be short', () => {
    const cast = castOf(household());
    expect(cast.length).toBeLessThan(CAST_MAX);
  });
});

describe('the cast speaks the reader\'s setting (#915)', () => {
  const source = readFileSync(new URL('./cast.ts', import.meta.url), 'utf8');
  // The reasons. Role labels and the seat's hall name are keyed too (#410),
  // and are tested on their own below.
  const keyed = coreMessageEntries(source).filter((entry) => !/#cast\.(label|hall)\./.test(entry.address));
  const ORIGINALS = {
    'cast.head.holds':
      'holds the seal, and answers for the {N} living of the house.',
    'cast.head.long_reign':
      'has held the seal for {REIGN} years, and has outlived nearly everyone who saw him take it.',
    'cast.head.new_reign':
      'took the seal in {SINCE}, and has not yet been obeyed in anything difficult.',
    'cast.head.halls':
      'has held the seal since {SINCE}, and answers for {N} living across {HALLS} halls.',
    'cast.head.since':
      'has held the seal since {SINCE}, and answers for the {N} living of the house.',
    'cast.heir.ward_bought.she':
      'is {AGE}, and the Warden holds the estate until she turns sixteen — bought back, though the seat itself still waits.',
    'cast.heir.ward_bought.he':
      'is {AGE}, and the Warden holds the estate until he turns sixteen — bought back, though the seat itself still waits.',
    'cast.heir.ward.she':
      'is {AGE}, and the Warden holds the estate until she turns sixteen.',
    'cast.heir.ward.he':
      'is {AGE}, and the Warden holds the estate until he turns sixteen.',
    'cast.heir.regency_soon':
      'is what the house has left to inherit, and the man holding it is {HEAD_AGE}: the day it falls to her, it falls into a Regency.',
    'cast.heir.other_hall':
      'waits for the seat in {HALL}, which is not where the seal is kept.',
    'cast.heir.older':
      'is {AGE}, and is waiting on a man ten years younger than himself.',
    'cast.heir.mundane':
      'takes the seat the day it falls vacant, and cannot express a word of it.',
    'cast.heir.not_his':
      'takes the seat the day it falls vacant, and is no child of the man who holds it.',
    'cast.heir.regency':
      'is what the house has left to inherit, which makes the next succession a Regency.',
    'cast.heir.next':
      'takes the seat the day it falls vacant.',
    'cast.at_risk.straining':
      'carries {MADNESS} of it against a mind of {MIND}, and is running out of room.',
    'cast.at_risk.carrying':
      'carries {MADNESS} of it against a mind of {MIND}.',
    'cast.at_risk.unwoken':
      'has the blood and has not woken to it, and he is {AGE}.',
    'cast.carrier.only_unspent':
      'carries the only font left in the house, and has not been spent.',
    'cast.carrier.only_married':
      'carries the only font left in the house, and is already married.',
    'cast.carrier.most_unspent_at':
      'carries more of the blood than any woman living of the house, and is {AGE} and unspent.',
    'cast.carrier.half_again':
      'carries half again what the next woman of this house carries.',
    'cast.carrier.most_unspent':
      'carries more of the blood than any woman living of the house, and has not been spent yet.',
    'cast.carrier.most_married':
      'carries more of the blood than any woman living of the house, and is already married.',
    'cast.aggrieved.held':
      'speaks for {HALL}, which has not held the seal since {SINCE} and is owed {OWED} for it.',
    'cast.aggrieved.impatient':
      'speaks for {HALL}, which has never held the seal, and has stopped asking for it politely.',
    'cast.aggrieved.owed':
      'speaks for {HALL}, which has never held the seal and is owed {OWED} for it.',
    'cast.married_in.grudge':
      'married in from {HOUSE}, and somebody out there is still keeping a grudge about it.',
    'cast.married_in.barren':
      'married in from {HOUSE} {YEARS} years ago, is {AGE}, and has given the house nobody.',
    'cast.married_in.share':
      'married in from {HOUSE}, and {KIDS} of the {LIVING} living of this house are hers.',
    'cast.married_in.font':
      'married in from {HOUSE}, carrying a font this house did not breed.',
    'cast.married_in.kids':
      "married in from {HOUSE}, and {KIDS} of the house's living are hers.",
    'cast.married_in.none_yet':
      'married in from {HOUSE}, and has given the house nobody yet.',
    'cast.foremost.blocked':
      'stands highest of anyone, and {BLOCKED}',
    'cast.foremost.clear':
      'stands highest of anyone the house has, with nothing left in the way.',
    'cast.sole_expresser.old':
      'is the only man living of this house who can express a word of it, and he is {AGE}.',
    'cast.sole_expresser.only':
      'is the only man living of this house who can express a word of it.',
    'cast.unwed.never_asked':
      'is {AGE}, carries a font, and has never been asked for by anybody.',
    'cast.unwed.never_married':
      'is {AGE} and has never been married, and nobody has written down why.',
    'cast.unwed.unspent':
      'is {AGE}, carries a font, and the house has not spent her.',
    'cast.unwed.years':
      'is {AGE} and unmarried, which the house has had {YEARS} years to see to.',
    'cast.long_post':
      'has held his place in {POST} since he was {AT}, which is {YEARS} years of it.',
    'cast.eldest':
      'is {AGE}, and older than anyone else in the house by {GAP} years.',
    'cast.bonded.owed':
      "has kept this house's {ROLE}'s work and {SECRETS} of its secrets, and is owed better than it has paid.",
    'cast.bonded.unpaid':
      'serves as {ROLE} on {TERM} terms, and has stopped believing the house will pay.',
    'cast.bonded.debt':
      'is bonded to this house for {DEBT} marks and cannot leave over it.',
    'cast.bonded.knows':
      'serves as {ROLE}, and knows {SECRETS} things the book does not say.',
    'cast.bonded.wage':
      'serves as {ROLE} on {TERM} terms, for {WAGE} marks a year.',
    'cast.scholar.threshold':
      'has read {N} of the books in this house, and may only ever read four of the eight ways.',
    'cast.scholar.most':
      'has read {N} of the books in this house, which is more than anyone else here has.',
    'cast.widow.child':
      'was widowed in {YEAR}, with {KIDS} child under sixteen still to raise.',
    'cast.widow.children':
      'was widowed in {YEAR}, with {KIDS} children under sixteen still to raise.',
    'cast.papers.exposed':
      'carries papers somebody set beside the parish roll in {YEAR}, and they did not match.',
    'cast.papers.forged':
      'stands on {GENERATIONS} generations of maternal record that {NOTARY} was paid to write.',
  };

  it('keys every reason the panel can give', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual(ORIGINALS);
    // Nothing the panel says is left as a fragile ordinal row, labels included.
    const legacy = plainEnglishCoreWorkItems('cast.ts', source).filter((item) => item.address.includes('#literal['));
    expect(legacy.map((item) => item.text)).toEqual([]);
  });

  /**
   * A head, a wife of Marrow counting twenty childless years, a hall owed
   * sixty-four years of grievance — and a son whose ordinary claim on the
   * seat is crowded off the panel by all of them.
   */
  function crowded(mode: 'original' | 'plainenglish', plain = false): SimCtx {
    const ctx = testWorld(bundle, 8801);
    const w = ctx.world;
    const head = place(ctx, { sex: 'male', age: 44, name: 'Head', castSlots: ['head'] });
    w.headSince = w.year - 12;
    place(ctx, { sex: 'male', age: 22, name: 'Son' });
    const wife = place(ctx, { sex: 'female', age: 40, name: 'Wife', house: 'house_marrow' });
    wife.membership.push({ house: asId(w.playerHouse), kind: 'married_in', from: w.year - 20 });
    marry(ctx, head, wife);
    for (const m of [...head.marriages, ...wife.marriages]) m.from = w.year - 20;
    const cousin = place(ctx, { sex: 'male', age: 38, name: 'Cousin', branch: 'branch_ash' });
    w.branches.set('branch_ash', {
      id: 'branch_ash', name: 'Ashfold', house: w.playerHouse, founder: cousin.id,
      splitFrom: 'main', foundedYear: w.year - 60, grievance: 64,
    } as never);
    if (plain) {
      const marrow = ctx.content.house('house_marrow')!;
      setProseVariants(ctx, [
        ...keyed.map((entry) => ({
          address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
        })),
        {
          address: contentProseAddress(ctx.content.sourceOf('house_marrow')!, 'houses[id=house_marrow].name'),
          of: proseOriginalHash(marrow.name), plainenglish: 'The Plain Marrows',
        },
      ]);
    }
    setProseMode(ctx, mode);
    return ctx;
  }

  it('gives each shown person the reviewed reason, and changes nothing else about the panel', () => {
    const original = castOf(crowded('original'));
    const plain = castOf(crowded('plainenglish', true));
    const marrow = crowded('original').content.house('house_marrow')!.name;
    const wife = original.find((member) => member.role === 'married_in');
    expect(wife?.because).toContain(`married in from ${marrow}`);
    expect(plain).toEqual(original.map((member) => ({
      ...member,
      because: `plain: ${member.because.replace(marrow, 'The Plain Marrows')}`,
    })));
  });

  it('asks only for the reasons the panel actually shows', () => {
    const ctx = crowded('plainenglish');
    const cast = castOf(ctx);
    // The precondition that makes this a test: somebody was a candidate and
    // did not make the panel.
    expect(heirApparent(ctx, cast.find((member) => member.role === 'head')?.person)).toBeDefined();
    expect(cast.map((member) => member.role)).not.toContain('heir');
    const missing = missingPlainEnglish(ctx);
    const reasons = missing.filter((a) => a.startsWith('core:messages#cast.') && !/#cast\.(label|hall)\./.test(a));
    expect(reasons).toHaveLength(cast.length);
    const labels = missing.filter((a) => a.startsWith('core:messages#cast.label.'));
    expect(labels).toHaveLength(new Set(cast.map((member) => member.role)).size);
    expect(castOf(crowded('original'))).toEqual(cast);
  });
});

/**
 * THE LABEL BESIDE THE NAME (#410). #915 keyed every reason and left the role
 * labels and the seat's hall name, so a Plain English panel still headed each
 * row in the Original.
 */
describe('the cast labels each row in the reader\'s setting', () => {
  const source = readFileSync(new URL('./cast.ts', import.meta.url), 'utf8');
  const labels = coreMessageEntries(source).filter((entry) => /#cast\.(label|hall)\./.test(entry.address));

  it('keys a label for every role, and the seat', () => {
    expect(labels.map((entry) => entry.address).sort()).toEqual([
      'core:messages#cast.hall.seat',
      ...CAST_ROLES.map((role) => `core:messages#cast.label.${role}`),
    ].sort());
  });

  it('renders the reviewed label and hall, and changes nothing else', () => {
    function panel(mode: 'original' | 'plainenglish') {
      const ctx = testWorld(bundle, 8802);
      const head = place(ctx, { sex: 'male', age: 50, name: 'Head', castSlots: ['head'] });
      ctx.world.headSince = ctx.world.year - 10;
      const son = place(ctx, { sex: 'male', age: 20, name: 'Son' });
      beget(ctx, son, head);
      setProseVariants(ctx, labels.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `PE ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      return castOf(ctx);
    }
    const original = panel('original');
    const seated = original.find((member) => member.role === 'head');
    expect(seated).toMatchObject({ label: 'the seal', hall: 'the seat' });
    expect(panel('plainenglish')).toEqual(original.map((member) => ({
      ...member,
      label: `PE ${member.label}`,
      hall: member.hall === 'the seat' ? 'PE the seat' : member.hall,
    })));
  });
});
