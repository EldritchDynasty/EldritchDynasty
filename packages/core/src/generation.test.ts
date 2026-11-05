import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { answerGenerationQuestion, chooseGenerationQuestion, livingBlood } from './generation.js';
import { marry, place, testWorld } from './testing.js';
import { coreMessageAddress } from './messages.js';
import { setProseMode, setProseVariants } from './prose.js';
import { rungTitle } from './ascension.js';
import { campaignDef } from './campaign.js';
import type { GenerationQuestion, SimCtx } from './world.js';

const bundle = loadContent();

describe('one question per generation (issue #213)', () => {
  it('selects a concrete thin-line pressure from the current family', () => {
    const ctx = testWorld(bundle, 21301, 1200);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const living = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
    ctx.world.bloodHighWater = Math.max(30, living * 4);

    const q = chooseGenerationQuestion(ctx);

    expect(q?.kind).toBe('thin_line');
    expect(q?.subject).toBe(head.id);
    expect(q?.text).toContain(head.name);
    expect(q?.text).toContain(String(living));
  });

  it('suppresses the same template/person combination in consecutive generations', () => {
    const ctx = testWorld(bundle, 21302, 1200);
    const living = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
    ctx.world.bloodHighWater = Math.max(30, living * 4);
    const first = chooseGenerationQuestion(ctx)!;

    const second = chooseGenerationQuestion(ctx, first);

    expect(second?.signature).not.toBe(first.signature);
  });

  it('answers from what actually happened, not what the opening predicted', () => {
    const ctx = testWorld(bundle, 21303, 1200);
    const living = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
    ctx.world.bloodHighWater = Math.max(30, living * 4);
    const q = chooseGenerationQuestion(ctx)!;
    expect(q.kind).toBe('thin_line');

    const one = ctx.world.people.blood(ctx.world.playerHouse).find((p) => p.status === 'alive' && !p.castSlots.includes('head'));
    if (one) ctx.world.people.kill(one.id, ctx.world.year, 'a fever');

    const answer = answerGenerationQuestion(ctx, q);
    const now = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
    expect(answer).toContain(String(q.baseline));
    expect(answer).toContain(String(now));
  });
});

describe('the Match verdict remembers a wedding even after widowhood (#2683)', () => {
  it.each([
    { kind: 'outward', house: 'house_marrow', words: 'married outward' },
    { kind: 'within', house: 'house_gearithy', words: 'married within' },
  ])('records the $kind marriage that ended before the generation closed', ({ house, words }) => {
    const ctx = testWorld(bundle, 26831, 1200);
    const daughter = place(ctx, { sex: 'female', age: 22, name: 'Wynn' });
    const spouse = place(ctx, { sex: 'male', age: 24, name: 'Groom', house });
    const q: GenerationQuestion = {
      kind: 'match', subject: daughter.id, subjectName: daughter.name,
      opened: ctx.world.year, baseline: 0, text: '', signature: `match:${daughter.id}`,
    };
    marry(ctx, daughter, spouse);
    expect(ctx.world.people.kill(spouse.id, ctx.world.year, 'illness')).toBe(true);
    expect(daughter.marriages[0]?.to).toBe(ctx.world.year);
    ctx.world.year += 1;

    expect(answerGenerationQuestion(ctx, q)).toContain(words);
  });

  it('does not re-count a marriage that ended before this question opened', () => {
    const ctx = testWorld(bundle, 26832, 1200);
    const daughter = place(ctx, { sex: 'female', age: 22, name: 'Wynn' });
    const spouse = place(ctx, { sex: 'male', age: 24, name: 'Former groom', house: 'house_marrow' });
    marry(ctx, daughter, spouse);
    expect(ctx.world.people.kill(spouse.id, 1200, 'illness')).toBe(true);
    ctx.world.year = 1202;
    const q: GenerationQuestion = {
      kind: 'match', subject: daughter.id, subjectName: daughter.name,
      opened: 1201, baseline: 0, text: '', signature: `match:${daughter.id}`,
    };

    expect(answerGenerationQuestion(ctx, q)).toContain('remained unmarried');
  });
});

describe('the generation\'s question and answer speak the reader\'s setting (#758)', () => {
  /** Every Original, keyed; the Plain English is the key itself plus its tokens, so a miss is unmistakable. */
  const ORIGINALS: Record<string, string> = {
    'generation.question.thin_line': 'Only {COUNT} of the blood are living. Can {HEAD} leave the line stronger than it was found?',
    'generation.question.ledger_one': 'The Ledger is one clause from complete. Does {HEAD} fund the reading, or the house that must survive it?',
    'generation.question.ledger': 'The Ledger is {COUNT} clauses from complete. Does {HEAD} fund the reading, or the house that must survive it?',
    'generation.question.record': 'The chronicle carries {COUNT} open contradictions. Does {HEAD} protect the legend, or leave something the house can prove?',
    'generation.answer.heir_died': '{HEIR} did not live to take the seal.',
    'generation.answer.heir_died_unnamed': 'The heir did not live to take the seal.',
    'generation.answer.heir_sealed': '{HEIR} took the seal. His Madness now stands at {MADNESS}, against {BASELINE} when the question opened.',
    'generation.answer.heir_passed_over': '{HEIR} lived through the generation but did not take the seal; his Madness now stands at {MADNESS}.',
    'generation.answer.blood_grew': 'The living blood grew: {BASELINE} when the generation opened, {NOW} when it closed.',
    'generation.answer.blood_thinned': 'The living blood thinned: {BASELINE} when the generation opened, {NOW} when it closed.',
    'generation.answer.blood_held': 'The living blood held: {BASELINE} when the generation opened, {NOW} when it closed.',
    'generation.answer.record': 'The book closed the generation with {NOW} open contradictions; {PROVED} had been proven by then.',
    'generation.answer.ledger_one': 'The house recovered {GAINED} Ledger clause during the generation, bringing the total to {NOW}.',
    'generation.answer.ledger': 'The house recovered {GAINED} Ledger clauses during the generation, bringing the total to {NOW}.',
    'generation.answer.branch_gone': '{BRANCH} did not remain a standing cadet hall.',
    'generation.answer.branch_gone_unnamed': 'The troubled hall did not remain a standing cadet hall.',
    'generation.answer.branch': "{BRANCH}'s grievance stands at {GRIEVANCE}, against {BASELINE} when the generation opened.",
    'generation.answer.daughter_died': '{DAUGHTER} did not live to make that marriage.',
    'generation.answer.daughter_died_unnamed': 'The daughter did not live to make that marriage.',
    'generation.answer.unmarried': '{DAUGHTER} remained unmarried when the generation closed.',
    'generation.answer.married_out': '{DAUGHTER} married outward, into {HOUSE}.',
    'generation.answer.married_in': "{DAUGHTER} married within the house's own blood.",
    'generation.answer.ascension': 'The house closes the generation at {RUNG}; its high-water mark is {BEST}.',
  };
  const tokens = (t: string) => (t.match(/\{[A-Z]+\}/g) ?? []).join(' ');
  const plainOf = (key: string) => `[${key}] ${tokens(ORIGINALS[key]!)}`.trim();
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{([A-Z]+)\}/g, (_, k: string) => v[k]!);
  const say = (mode: 'original' | 'plainenglish', key: string, v: Record<string, string> = {}) =>
    fill(mode === 'original' ? ORIGINALS[key]! : plainOf(key), v);

  function world(mode: 'original' | 'plainenglish', seed = 21304): SimCtx {
    const ctx = testWorld(bundle, seed, 1200);
    setProseVariants(ctx, Object.entries(ORIGINALS).map(([key, original]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plainOf(key),
    })));
    setProseMode(ctx, mode);
    return ctx;
  }
  const q = (over: Partial<GenerationQuestion> & Pick<GenerationQuestion, 'kind'>): GenerationQuestion =>
    ({ opened: 1180, baseline: 0, signature: `${over.kind}:-`, text: '', ...over });

  for (const mode of ['original', 'plainenglish'] as const) {
    it(`asks the chosen question in ${mode}, and only renders the one it chose`, () => {
      const ctx = world(mode);
      const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
      const living = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
      ctx.world.bloodHighWater = Math.max(30, living * 4);
      const thin = chooseGenerationQuestion(ctx)!;
      expect(thin.text).toBe(say(mode, 'generation.question.thin_line', { COUNT: String(living), HEAD: head.name }));
      expect(Object.keys(thin)).toEqual(['kind', 'text', 'opened', 'baseline', 'signature', 'subject', 'subjectName']);

      // Enough living blood that the line is no longer the strongest pressure.
      ctx.world.bloodHighWater = 0;
      for (let i = 0; i < 6; i++) place(ctx, { sex: 'male', age: 30 + i, name: `Kin${i}` });
      const clauses = campaignDef(ctx.world.campaign).clauses;
      for (const [left, key] of [[1, 'generation.question.ledger_one'], [2, 'generation.question.ledger']] as const) {
        ctx.world.clausesRecovered = new Set(Array.from({ length: clauses - left }, (_, i) => `clause_${i}`));
        const ledger = chooseGenerationQuestion(ctx)!;
        expect(ledger.kind).toBe('ledger');
        expect(ledger.text).toBe(say(mode, key, { COUNT: String(left), HEAD: head.name }));
      }
      ctx.world.discrepancies.set('a', { severity: 'minor', provableBy: [], state: 'open' });
      ctx.world.discrepancies.set('b', { severity: 'minor', provableBy: [], state: 'open' });
      const record = chooseGenerationQuestion(ctx)!;
      expect(record.text).toBe(say(mode, 'generation.question.record', { COUNT: '2', HEAD: head.name }));
      // The ledger and match pressures lost to the record, and were never rendered.
      expect([...ctx.prose.missing]).toEqual([]);
    });

    it(`answers every shape in ${mode}`, () => {
      const ctx = world(mode);
      const w = ctx.world;
      const heir = place(ctx, { sex: 'male', age: 30, name: 'Hugh' });
      heir.madness = 41.6;
      const answer = (question: GenerationQuestion) => answerGenerationQuestion(ctx, question);

      expect(answer(q({ kind: 'unstable_heir', subject: heir.id, subjectName: 'Hugh', baseline: 30.2 })))
        .toBe(say(mode, 'generation.answer.heir_passed_over', { HEIR: 'Hugh', MADNESS: '42' }));
      heir.castSlots.push('head');
      expect(answer(q({ kind: 'unstable_heir', subject: heir.id, subjectName: 'Hugh', baseline: 30.2 })))
        .toBe(say(mode, 'generation.answer.heir_sealed', { HEIR: 'Hugh', MADNESS: '42', BASELINE: '30' }));
      expect(answer(q({ kind: 'unstable_heir', subject: 'gone', subjectName: 'Hugh' })))
        .toBe(say(mode, 'generation.answer.heir_died', { HEIR: 'Hugh' }));
      expect(answer(q({ kind: 'unstable_heir' }))).toBe(say(mode, 'generation.answer.heir_died_unnamed'));

      const now = String(w.people.blood(w.playerHouse).filter((p) => p.status === 'alive').length);
      for (const [baseline, key] of [[0, 'grew'], [999, 'thinned'], [Number(now), 'held']] as const) {
        expect(answer(q({ kind: 'thin_line', baseline })))
          .toBe(say(mode, `generation.answer.blood_${key}`, { BASELINE: String(baseline), NOW: now }));
      }

      w.discrepancies.set('open_one', { severity: 'minor', provableBy: [], state: 'open' });
      w.discrepancies.set('proven_one', { severity: 'minor', provableBy: [], state: 'proven' });
      expect(answer(q({ kind: 'record' }))).toBe(say(mode, 'generation.answer.record', { NOW: '1', PROVED: '1' }));

      const total = w.clausesRecovered.size;
      expect(answer(q({ kind: 'ledger', baseline: total - 1 })))
        .toBe(say(mode, 'generation.answer.ledger_one', { GAINED: '1', NOW: String(total) }));
      expect(answer(q({ kind: 'ledger', baseline: total })))
        .toBe(say(mode, 'generation.answer.ledger', { GAINED: '0', NOW: String(total) }));

      w.branches.set('br_q', {
        id: 'br_q' as never, name: "Osric's hall", house: w.playerHouse as never, founder: heir.id,
        splitFrom: 'main', foundedYear: 1150, grievance: 71.4,
      });
      expect(answer(q({ kind: 'branch', subject: 'br_q', baseline: 60.4 })))
        .toBe(say(mode, 'generation.answer.branch', { BRANCH: "Osric's hall", GRIEVANCE: '71', BASELINE: '60' }));
      expect(answer(q({ kind: 'branch', subject: 'br_none', subjectName: "Osric's hall" })))
        .toBe(say(mode, 'generation.answer.branch_gone', { BRANCH: "Osric's hall" }));
      expect(answer(q({ kind: 'branch' }))).toBe(say(mode, 'generation.answer.branch_gone_unnamed'));

      const daughter = place(ctx, { sex: 'female', age: 20, name: 'Wynn' });
      const match = q({ kind: 'match', subject: daughter.id, subjectName: 'Wynn' });
      expect(answer(match)).toBe(say(mode, 'generation.answer.unmarried', { DAUGHTER: 'Wynn' }));
      const cousin = place(ctx, { sex: 'male', age: 22, name: 'Cousin' });
      marry(ctx, daughter, cousin);
      expect(answer(match)).toBe(say(mode, 'generation.answer.married_in', { DAUGHTER: 'Wynn' }));
      daughter.marriages = [];
      const stranger = place(ctx, { sex: 'male', age: 22, name: 'Stranger', house: 'house_marrow' });
      marry(ctx, daughter, stranger);
      expect(answer(match))
        .toBe(say(mode, 'generation.answer.married_out', { DAUGHTER: 'Wynn', HOUSE: ctx.content.house('house_marrow')!.name }));
      expect(answer(q({ kind: 'match', subject: 'gone', subjectName: 'Wynn' })))
        .toBe(say(mode, 'generation.answer.daughter_died', { DAUGHTER: 'Wynn' }));
      expect(answer(q({ kind: 'match' }))).toBe(say(mode, 'generation.answer.daughter_died_unnamed'));

      expect(answer(q({ kind: 'ascension' }))).toBe(say(mode, 'generation.answer.ascension', {
        RUNG: rungTitle(ctx, w.ascension.rung), BEST: rungTitle(ctx, w.ascension.best),
      }));
    });
  }

  it('chooses the same question either way; only its words differ', () => {
    const pick = (mode: 'original' | 'plainenglish') => {
      const ctx = world(mode, 21305);
      const living = ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive').length;
      ctx.world.bloodHighWater = Math.max(30, living * 4);
      const { text: _text, ...rest } = chooseGenerationQuestion(ctx)!;
      return rest;
    };
    expect(pick('plainenglish')).toEqual(pick('original'));
  });
});


describe('dated branch concerns (#2786)', () => {
  it('asks about a standing hall rather than a future or extinct one', () => {
    const ctx = testWorld(bundle, 2786001, 1200);
    const w = ctx.world;
    w.bloodHighWater = 0;
    for (let i = 0; i < 8; i++) {
      place(ctx, { sex: 'male', age: 30 + i, name: `Broad kin ${i}` });
    }
    w.discrepancies.clear();
    w.clausesRecovered.clear();
    for (const person of w.people.living()) person.madness = 0;
    const founder = w.people.living()[0]!;
    const currentId = 'standing_hall' as never;
    const futureId = 'unbuilt_hall' as never;
    const extinctId = 'extinct_hall' as never;
    const futureYear = w.year + 4;
    w.branches.set(currentId, {
      id: currentId, name: 'Standing Hall', house: w.playerHouse, founder: founder.id,
      splitFrom: 'main', foundedYear: w.year - 20, grievance: 65,
    } as never);
    w.branches.set(futureId, {
      id: futureId, name: 'Unbuilt Hall', house: w.playerHouse, founder: founder.id,
      splitFrom: 'main', foundedYear: futureYear, grievance: 85,
    } as never);
    w.branches.set(extinctId, {
      id: extinctId, name: 'Extinct Hall', house: w.playerHouse, founder: founder.id,
      splitFrom: 'main', foundedYear: w.year - 50, extinct: w.year - 1, grievance: 95,
    } as never);

    expect(chooseGenerationQuestion(ctx)).toMatchObject({
      kind: 'branch', subject: currentId, subjectName: 'Standing Hall', baseline: 65,
    });
    w.branches.get(currentId)!.extinct = w.year;
    expect(chooseGenerationQuestion(ctx)?.kind).not.toBe('branch');

    w.year = futureYear;
    expect(chooseGenerationQuestion(ctx)).toMatchObject({
      kind: 'branch', subject: futureId, subjectName: 'Unbuilt Hall', baseline: 85,
    });
  });
});

describe('recovered generation-question dates (#2977, #2978, #2979)', () => {
  /** Remove unrelated pressures so each question tests the intended mechanism. */
  function quietQuestionWorld(seed: number): SimCtx {
    const ctx = testWorld(bundle, seed, 1200);
    const w = ctx.world;
    w.bloodHighWater = 0;
    for (let i = 0; i < 8; i++) place(ctx, { sex: 'male', age: 30 + i, name: `Additional kin ${i}` });
    w.discrepancies.clear();
    w.clausesRecovered.clear();
    for (const person of w.people.living()) person.madness = 0;
    return ctx;
  }

  it('counts only people alive at the reading year in both thin-line readings (#2977)', () => {
    const ctx = testWorld(bundle, 2977001, 1200);
    const w = ctx.world;
    const before = livingBlood(ctx).length;
    const unborn = place(ctx, { sex: 'male', age: -4, name: 'Future blood' });
    const deceased = place(ctx, { sex: 'female', age: 30, name: 'Earlier death' });
    deceased.died = w.year - 1; // Inconsistent imported status deliberately remains alive.
    const later = place(ctx, { sex: 'male', age: 25, name: 'Later death' });
    later.died = w.year + 2;

    expect(livingBlood(ctx)).toHaveLength(before + 1);
    expect(livingBlood(ctx)).not.toContain(unborn);
    expect(livingBlood(ctx)).not.toContain(deceased);
    expect(livingBlood(ctx)).toContain(later);

    w.bloodHighWater = 100;
    const question = chooseGenerationQuestion(ctx)!;
    expect(question.kind).toBe('thin_line');
    expect(question.baseline).toBe(before + 1);

    w.year += 3;
    expect(livingBlood(ctx)).toHaveLength(before);
    expect(answerGenerationQuestion(ctx, question)).toContain('The living blood thinned');
    w.year += 2;
    expect(livingBlood(ctx)).toContain(unborn);
    expect(livingBlood(ctx)).not.toContain(later);
  });

  it('does not begin a question under a future-born or effectively dead Head (#2977)', () => {
    const ctx = testWorld(bundle, 2977002, 1200);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const born = head.born;

    head.born = ctx.world.year + 1;
    expect(chooseGenerationQuestion(ctx)).toBeUndefined();

    head.born = born;
    head.died = ctx.world.year;
    expect(chooseGenerationQuestion(ctx)).toBeUndefined();

    head.died = ctx.world.year + 1;
    ctx.world.bloodHighWater = 100;
    expect(chooseGenerationQuestion(ctx)?.subject).toBe(head.id);
  });

  it('asks about a troubled hall until, not before, its saved extinction (#2978)', () => {
    const ctx = quietQuestionWorld(2978001);
    const w = ctx.world;
    const id = 'future_extinction_hall' as never;
    w.branches.set(id, {
      id, name: 'The troubled hall', house: w.playerHouse,
      founder: w.people.living()[0]!.id, splitFrom: 'main',
      foundedYear: w.year - 20, extinct: w.year + 2, grievance: 80,
    } as never);

    const question = chooseGenerationQuestion(ctx)!;
    expect(question).toMatchObject({ kind: 'branch', subject: id });
    expect(answerGenerationQuestion(ctx, question)).toContain('grievance stands at 80');

    w.year += 2;
    expect(chooseGenerationQuestion(ctx)?.kind).not.toBe('branch');
    expect(answerGenerationQuestion(ctx, question)).toContain('did not remain a standing cadet hall');
  });

  it('keeps a future wedding out of the Match question and verdict until its year (#2979)', () => {
    const ctx = quietQuestionWorld(2979001);
    const w = ctx.world;
    const daughter = place(ctx, { sex: 'female', age: 22, name: 'Future bride' });
    const spouse = place(ctx, { sex: 'male', age: 24, name: 'Foreign groom', house: 'house_marrow' });
    // Any pre-existing eligible daughter is already married; this one is not.
    for (const person of w.people.blood(w.playerHouse)) {
      if (person.id !== daughter.id && person.sex === 'female'
        && w.year - person.born >= 16 && w.year - person.born <= 38) {
        person.marriages.push({ spouse: spouse.id, from: w.year - 1 });
      }
    }
    daughter.marriages.push({ spouse: spouse.id, from: w.year + 3 });

    const question = chooseGenerationQuestion(ctx)!;
    expect(question).toMatchObject({ kind: 'match', subject: daughter.id });
    expect(answerGenerationQuestion(ctx, question)).toContain('remained unmarried');

    daughter.died = w.year;
    expect(answerGenerationQuestion(ctx, question)).toContain('did not live to make that marriage');
    daughter.died = w.year + 4;
    expect(answerGenerationQuestion(ctx, question)).toContain('remained unmarried');

    w.year += 3;
    expect(answerGenerationQuestion(ctx, question)).toContain('married outward');
  });

  it('does not let an already-recorded death pass as a living heir verdict (#2979)', () => {
    const ctx = testWorld(bundle, 2979002, 1200);
    const heir = place(ctx, { sex: 'male', age: 25, name: 'Recorded heir' });
    const question: GenerationQuestion = {
      kind: 'unstable_heir', subject: heir.id, subjectName: heir.name,
      opened: ctx.world.year, baseline: 30, text: '', signature: `unstable_heir:${heir.id}`,
    };

    heir.died = ctx.world.year;
    expect(answerGenerationQuestion(ctx, question)).toContain('did not live to take the seal');
    heir.died = ctx.world.year + 1;
    expect(answerGenerationQuestion(ctx, question)).toContain('lived through the generation');
  });
});
