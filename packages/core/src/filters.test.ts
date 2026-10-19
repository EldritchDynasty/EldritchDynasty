import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Filter } from '@ed/schema';
import { candidatesFor, evalFilter, genomeOf, phenotypeOf, place, resolveSlots, testRng, testWorld } from '@ed/core';
import { executeOutcomeWitness } from './events/reach.js';

const bundle = loadContent();

describe('authored casting keeps unwoken capacity private (#1824)', () => {
  function fixture(expresses: boolean, asHead = false, headSex: 'male' | 'female' = 'male') {
    const ctx = testWorld(bundle, 18240);
    for (const person of ctx.world.people.living()) ctx.world.people.kill(person.id, ctx.world.year, 'before the casting witness');
    for (const person of ctx.world.people.all()) person.castSlots = [];
    const head = place(ctx, { sex: asHead ? headSex : 'female', age: 60, name: 'The Holder', castSlots: ['head'] });
    const subject = asHead ? head : place(ctx, { sex: 'male', age: 30, name: 'An unwoken member' });
    place(ctx, { sex: 'male', age: 45, name: 'An outside witness', house: 'house_marrow' });
    const genome = genomeOf(subject, ctx.genetics);
    for (const index of ctx.genetics.table.fontIndices) {
      const allele = ctx.genetics.table.xAlleles[index]!.findIndex((entry) => expresses ? entry.effect > 0 : entry.effect === 0);
      if (allele < 0) throw new Error('capacity fixture lacks a font allele');
      genome.sex[0][index] = allele;
    }
    subject.phenotype = undefined;
    expect(phenotypeOf(subject, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(expresses);
    expect(subject.awakening.awakened).toBe(false);
    return { ctx, head, subject };
  }

  it.each([
    ['the_horse_that_will_not_pass_the_gate', 'RIDER'],
    ['the_knife_everybody_wears', 'KIN'],
    ['the_unmirrored_eye_offered', 'HEAD'],
    ['the_witness_at_the_wall', 'SEEN'],
    ['the_sickroom_rule', 'SICK'],
  ])('%s casts the same unwoken person without buying knowledge', (id, slot) => {
    const event = bundle.mustEvent(id!);
    const worlds = [false, true].map((capacity) => fixture(capacity, slot === 'HEAD'));
    const casts = worlds.map(({ ctx, head, subject }) => {
      expect(candidatesFor(event.slots[slot!]!, ctx, { HEAD: head.id }).map((person) => person.id)).toContain(subject.id);
      const resolved = resolveSlots(event, ctx, testRng('private-cast'));
      expect(resolved.ok).toBe(true);
      return resolved.fill;
    });
    expect(casts[0]).toEqual(casts[1]);
  });

  it('offers the unmirrored eye to a female Head without claiming she can use it', () => {
    const { ctx, head } = fixture(false, true, 'female');
    const event = bundle.mustEvent('the_unmirrored_eye_offered');
    const resolved = resolveSlots(event, ctx, testRng('eye-regent'));
    expect(resolved.ok).toBe(true);
    expect(resolved.fill.HEAD).toBe(head.id);
  });

  it.each([
    ['iron_will_not_hold_an_edge', 'KIN'], ['a_head_at_the_top_of_it', 'HEAD'],
    ['the_ninth_night_it_answered', 'SAYER'], ['it_does_not_come_when_called', 'TRIER'],
    ['the_ring_that_fits', 'WEARER'], ['ring_the_household_decides', 'WEARER'],
    ['ring_it_fits_again', 'SECOND'],
  ])('%s / %s requires a witnessed waking before a fresh cast', (id, slot) => {
    const event = bundle.mustEvent(id!);
    const { ctx, head, subject } = fixture(true, slot === 'HEAD');
    const fill = { HEAD: head.id, FIRST: head.id };
    const offered = () => candidatesFor(event.slots[slot!]!, ctx, fill).map((person) => person.id);
    expect(offered()).not.toContain(subject.id);
    subject.awakening.awakened = true;
    expect(offered()).toContain(subject.id);
  });

  it.each([
    ['keep_them_together', 'both_at_ardwen'], ['keep_them_together', 'it_holds'],
    ['send_one_out', 'four_miles_off'],
  ])('makes both natural awakenings real through %s / %s', (choiceId, expectedOutcomeId) => {
    const { ctx, subject } = fixture(true);
    subject.born = ctx.world.year - 22;
    subject.phenotype = undefined;
    const second = place(ctx, { sex: 'male', age: 20, name: 'The second to wake' });
    const firstGenome = genomeOf(subject, ctx.genetics);
    const secondGenome = genomeOf(second, ctx.genetics);
    for (const index of ctx.genetics.table.fontIndices) secondGenome.sex[0][index] = firstGenome.sex[0][index]!;
    second.phenotype = undefined;
    const event = bundle.mustEvent('the_year_two_woke');
    const result = executeOutcomeWitness(ctx, event, {
      choiceId, expectedOutcomeId, targetWeightedOutcome: true, rng: testRng('two-wakings'),
    });
    expect(result.ok, result.reason).toBe(true);
    for (const person of [subject, second]) {
      expect(person.awakening.awakened).toBe(true);
      expect(person.awakening.forced).toBe(false);
    }
    expect(resolveSlots(event, ctx, testRng('not-a-second-waking')).ok).toBe(false);
  });

  it('reserves thirty and above for the Late Waking and respects a mundane declaration', () => {
    const { ctx, subject } = fixture(true);
    const pair = bundle.mustEvent('the_year_two_woke');
    const eligible = () => candidatesFor(pair.slots.FIRST!, ctx, {}).map(person => person.id);
    expect(eligible()).not.toContain(subject.id);
    expect(candidatesFor(bundle.mustEvent('the_late_waking').slots.MAN!, ctx, {}).map(person => person.id)).toContain(subject.id);
    subject.born = ctx.world.year - 22;
    subject.phenotype = undefined;
    expect(eligible()).toContain(subject.id);
    subject.awakening.declaredMundane = true;
    expect(eligible()).not.toContain(subject.id);
  });

  it.each([
    ['say_it_aloud', 'woke_late'], ['say_it_aloud', 'all_at_once'],
    ['keep_it_within_the_walls', 'kept_quiet'],
  ])('preserves the real late waking through %s / %s', (choiceId, expectedOutcomeId) => {
    const { ctx, subject } = fixture(true);
    const event = bundle.mustEvent('the_late_waking');
    const result = executeOutcomeWitness(ctx, event, {
      choiceId, expectedOutcomeId, targetWeightedOutcome: true, rng: testRng('late-waking'),
    });
    expect(result.ok, result.reason).toBe(true);
    expect(subject.awakening.awakened).toBe(true);
    expect(subject.awakening.forced).toBe(false);
  });
});

/**
 * ── EVERY FILTER PREDICATE, ASKED A QUESTION IT MUST ANSWER BOTH WAYS ──────
 *
 * `docs/TEST-COVERAGE.md` records this exact survey for CONDITIONS: nine of
 * twenty-five predicates had never been evaluated by a test or by a line of
 * content, and `conditions.test.ts` now asks each of them a question it must
 * answer TRUE and one it must answer FALSE, because "a predicate stuck on
 * `true` gates nothing, and content gated on nothing fires in every run
 * forever".
 *
 * FILTERS ARE THE OTHER HALF OF THAT CHAIN and nobody had done it for them.
 * Conditions gate whether an event fires; filters gate WHO it can be cast on
 * — `sex`, `age`, `status`, `membership`, `career`, `trait`. A filter stuck
 * on `true` does not stop the event; it casts the wrong person into it.
 *
 * This file exists because the mutation probe found it. Inverting the sex
 * filter — `p.sex === f.sex` to `!==`, one character — survived the entire
 * fast lane. A filter that selects the opposite sex would cast daughters into
 * every role written for a son, and 1,653 tests had nothing to say about it.
 *
 * The predicates are still asked one at a time, in the style
 * `conditions.test.ts` established, rather than through a played run: a run
 * exercises whichever filters its content happens to reach, which is how this
 * gap survived in the first place.
 */
function house() {
  const ctx = testWorld(bundle);
  const man = place(ctx, { sex: 'male', age: 40, name: 'A Man' });
  const woman = place(ctx, { sex: 'female', age: 22, name: 'A Woman' });
  return { ctx, man, woman };
}

describe('the filter predicates answer both ways', () => {
  it('descendant_of follows parentage through more than one generation', () => {
    const { ctx, man: elder, woman: daughter } = house();
    const grandchild = place(ctx, { sex: 'male', age: 1, name: 'A Grandchild' });
    const cousin = place(ctx, { sex: 'male', age: 20, name: 'A Cousin' });
    ctx.world.people.setParents(daughter.id, { father: elder.id });
    ctx.world.people.setParents(grandchild.id, { mother: daughter.id });
    const ofElder: Filter = { relation: 'descendant_of', of: 'ELDER' };
    const bound = { ELDER: elder.id };

    expect(evalFilter(ofElder, daughter, ctx, bound)).toBe(true);
    expect(evalFilter(ofElder, grandchild, ctx, bound)).toBe(true);
    expect(evalFilter(ofElder, cousin, ctx, bound)).toBe(false);
    expect(evalFilter(ofElder, elder, ctx, bound)).toBe(false);
  });

  it('sex — the one the mutation probe caught', () => {
    const { ctx, man, woman } = house();
    const male: Filter = { sex: 'male' };
    const female: Filter = { sex: 'female' };

    expect(evalFilter(male, man, ctx, {})).toBe(true);
    expect(evalFilter(male, woman, ctx, {})).toBe(false);
    expect(evalFilter(female, woman, ctx, {})).toBe(true);
    expect(evalFilter(female, man, ctx, {})).toBe(false);
  });

  it('age — a band, at both edges', () => {
    const { ctx, man, woman } = house();
    const grown: Filter = { age: { op: 'gte', value: 30 } };
    expect(evalFilter(grown, man, ctx, {})).toBe(true);
    expect(evalFilter(grown, woman, ctx, {})).toBe(false);
  });

  it('status — the living and the rest', () => {
    const { ctx, man, woman } = house();
    const alive: Filter = { status: ['alive'] };
    expect(evalFilter(alive, man, ctx, {})).toBe(true);

    ctx.world.people.kill(woman.id, ctx.world.year, 'a test');
    expect(evalFilter(alive, woman, ctx, {})).toBe(false);
  });

  it('membership — and it means the OPEN record, not any record', () => {
    const { ctx, man } = house();
    const blood: Filter = { membership: ['blood'] };
    expect(evalFilter(blood, man, ctx, {})).toBe(true);

    // Close it. He was of the house; he is not now, and a filter that reads
    // the record without reading its end would still say yes.
    for (const m of man.membership) m.to = ctx.world.year;
    expect(
      evalFilter(blood, man, ctx, {}),
      'a closed membership record still matched — the filter is not reading `to`',
    ).toBe(false);
  });

  it('tag — a cast role somebody holds', () => {
    const { ctx, man, woman } = house();
    const head: Filter = { tag: 'head', has: true };
    man.castSlots.push('head');
    expect(evalFilter(head, man, ctx, {})).toBe(true);
    expect(evalFilter(head, woman, ctx, {})).toBe(false);
  });

  it('trait — carried and not', () => {
    const { ctx, man, woman } = house();
    const trait = [...bundle.traits][0]?.id;
    if (!trait) throw new Error('no traits in the content to filter on');
    const carries: Filter = { trait, has: true };

    man.traits.add(trait as never);
    expect(evalFilter(carries, man, ctx, {})).toBe(true);
    expect(evalFilter(carries, woman, ctx, {})).toBe(false);
  });

  /**
   * Issue #126: `taught` reads a DURABLE mark set only where a tutor's term
   * completed, never `acquired` — a child boosted by an ordinary event effect
   * must not read as schooled.
   */
  it('taught — a durable mark, not a proxy for a raised attribute', () => {
    const { ctx, man, woman } = house();
    expect(evalFilter({ taught: {} }, man, ctx, {})).toBe(false);

    man.acquired.mind = (man.acquired.mind ?? 0) + 50;
    expect(evalFilter({ taught: {} }, man, ctx, {}), 'an ordinary attribute gain is not a term').toBe(false);

    man.taught.push('mind');
    expect(evalFilter({ taught: {} }, man, ctx, {})).toBe(true);
    expect(evalFilter({ taught: { attr: 'mind' } }, man, ctx, {})).toBe(true);
    expect(evalFilter({ taught: { attr: 'charm' } }, man, ctx, {})).toBe(false);
    expect(evalFilter({ taught: {} }, woman, ctx, {})).toBe(false);
  });

  /**
   * Issue #128: `inTerm` reads `world.tutoring` directly — mid-term, as
   * against `taught`'s "has ever completed one". A person can be neither,
   * either, or (once the term ends) `taught` without still being `inTerm`.
   */
  it('inTerm — mid-term right now, not the same question as taught', () => {
    const { ctx, man } = house();
    expect(evalFilter({ inTerm: true }, man, ctx, {})).toBe(false);
    expect(evalFilter({ inTerm: false }, man, ctx, {})).toBe(true);

    ctx.world.tutoring.push({ person: man.id, attr: 'mind', completes: ctx.world.year + 8 });
    expect(evalFilter({ inTerm: true }, man, ctx, {})).toBe(true);
    expect(evalFilter({ taught: {} }, man, ctx, {}), 'starting a term is not the same as finishing one').toBe(false);
  });

  /**
   * The combinators, because `not` inverting nothing is the same bug one
   * level up: it would make every negated filter pass.
   */
  it('all, any and not combine what they are given', () => {
    const { ctx, man, woman } = house();
    const male: Filter = { sex: 'male' };
    const grown: Filter = { age: { op: 'gte', value: 30 } };

    expect(evalFilter({ all: [male, grown] }, man, ctx, {})).toBe(true);
    expect(evalFilter({ all: [male, grown] }, woman, ctx, {})).toBe(false);
    expect(evalFilter({ any: [male, grown] }, woman, ctx, {})).toBe(false);
    expect(evalFilter({ any: [{ sex: 'female' }, grown] }, woman, ctx, {})).toBe(true);
    expect(evalFilter({ not: male }, woman, ctx, {})).toBe(true);
    expect(evalFilter({ not: male }, man, ctx, {})).toBe(false);
  });
});
