import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { CAMPAIGNS } from '../campaign.js';
import { evalCondition } from './conditions.js';
import { dueArcSteps } from './arcs.js';
import { applyEffect } from './effects.js';
import { queueChoice, resolveChoice, resolveRecord } from './decisions.js';
import { candidatesFor, resolveSlots } from './slots.js';
import { edge, sentimentBetween } from '../people/relationships.js';
import { canonical, loadGame, saveGame } from '../save.js';
import { TUTOR_FEE, TUTOR_YEARS } from '../table.js';
import { phase, place, testRng, testWorld } from '../testing.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from '../prose.js';
import type { PendingDecision } from './decisions.js';
import type { Person } from '@ed/schema';
import type { SimCtx } from '../world.js';

/**
 * A RELATIVE'S OWN WISH (#1976). `content/events/the_wish.yaml`.
 *
 * A child of the house asks for a tutor's term. Paying for it leads, ten to
 * twelve years later, to a choice about the house's books that the term made
 * worth having. Refusing it leads to the same request for the next child,
 * with a grudge at stake. These tests build each state on purpose and answer
 * every question through the docket the player uses: `queueChoice` and
 * `resolveChoice` for the asking, the `arcs` year phase for each return, and
 * a save and a load while each return is pending.
 */

const base = loadBundle();
const ASKING = 'a_term_asked_for';
const PAID = 'inline_a_term_asked_for__a_tutor_is_found';
const REFUSED = 'inline_a_term_asked_for__refused';

function house(campaign: 'short' | 'long' = 'long', year = 1200) {
  const ctx = testWorld(base, 1976, year);
  ctx.world.campaign = campaign;
  ctx.world.treasury = 240;
  const asker = place(ctx, { sex: 'female', age: 14, name: 'Wenna' });
  return { ctx, asker };
}

function head(ctx: SimCtx): string {
  const cast = resolveSlots(ctx.content.mustEvent(ASKING), ctx, testRng('head'));
  return String(cast.fill.HEAD);
}

/** The asking, answered through the docket exactly as the player answers it. */
function ask(ctx: SimCtx, asker: Person, choice: 'pay_for_the_term' | 'the_terms_are_for_the_heir') {
  const event = ctx.content.mustEvent(ASKING);
  const cast = resolveSlots(event, ctx, testRng('asking'), { ASKER: asker.id });
  expect(cast.ok).toBe(true);
  const head = String(cast.fill.HEAD);
  const pending = queueChoice(ctx, event, event.body, cast.fill, cast.playerCast);
  expect(resolveChoice(ctx, pending.id, choice, testRng('asking', choice)).ok).toBe(true);
  const page = ctx.world.chronicle.find((entry) => entry.eventId === ASKING)!;
  const arcId = choice === 'pay_for_the_term' ? PAID : REFUSED;
  const instance = [...ctx.world.arcs.values()].find((entry) => entry.arc === arcId);
  return { head, page, instance };
}

/** Save and load, and prove nothing was lost on the way. */
function resume(ctx: SimCtx): SimCtx {
  const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), ctx.content);
  expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
  return resumed;
}

/** Run the `arcs` phase at the due year and take the one docket it raised for `eventId`. */
function returnOf(ctx: SimCtx, dueYear: number, eventId: string) {
  ctx.world.year = dueYear;
  const pending = phase('arcs', ctx, false).pending
    .filter((d): d is Extract<PendingDecision, { kind: 'choice' }> => d.kind === 'choice' && d.event.id === eventId);
  expect(pending).toHaveLength(1);
  return pending[0]!;
}

function finishTerm(ctx: SimCtx, asker: Person) {
  const term = ctx.world.tutoring.find((t) => t.person === asker.id)!;
  ctx.world.year = term.completes;
  phase('table', ctx);
  expect(asker.taught).toContain('mind');
}

describe('who may ask (#1976)', () => {
  it('is a later child of the house, untaught in Mind and not in a term, while the house can pay', () => {
    const { ctx, asker } = house();
    const event = ctx.content.mustEvent(ASKING);
    ctx.world.generation = 2;
    expect(evalCondition(event.conditions, ctx)).toBe(true);
    expect(resolveSlots(event, ctx, testRng(), { ASKER: asker.id }).ok).toBe(true);

    ctx.world.treasury = TUTOR_FEE - 1;
    expect(evalCondition(event.conditions, ctx)).toBe(false);
    ctx.world.treasury = 240;
    ctx.world.generation = 1;
    expect(evalCondition(event.conditions, ctx)).toBe(false);

    // Somebody already taught, or already in a term, has nothing to ask for.
    const taught = place(ctx, { sex: 'male', age: 13, name: 'Already taught' });
    taught.taught.push('mind');
    const inTerm = place(ctx, { sex: 'male', age: 13, name: 'Already in a term' });
    ctx.world.tutoring.push({ person: inTerm.id, attr: 'charm', completes: ctx.world.year + 4 });
    const tooOld = place(ctx, { sex: 'female', age: 17, name: 'Past the age' });
    const pool = candidatesFor(event.slots.ASKER!, ctx, { HEAD: head(ctx) }).map((p) => p.id);
    expect(pool).toContain(asker.id);
    for (const refused of [taught, inTerm, tooOld]) expect(pool).not.toContain(refused.id);
  });
});

describe('paying for the term (#1976)', () => {
  it('begins the term through the Table\'s own gate and keeps the asker and the launching page', () => {
    const { ctx, asker } = house();
    const before = ctx.world.treasury;
    const { head, page, instance } = ask(ctx, asker, 'pay_for_the_term');

    expect(ctx.world.treasury).toBe(before - TUTOR_FEE);
    expect(ctx.world.tutoring).toContainEqual({ person: asker.id, attr: 'mind', completes: 1200 + TUTOR_YEARS });
    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(12);
    expect(ctx.world.rumours.has('rumour_the_child_who_asked_for_a_term')).toBe(true);
    // The authored effect does not open the Table's own term callback: the
    // house tells this term once.
    expect([...ctx.world.arcs.values()].some((a) => a.arc === 'arc_the_term_paid_for')).toBe(false);

    expect(instance?.bindings).toEqual({ ASKER: asker.id });
    expect(instance?.cause).toEqual({ year: page.year, page: page.id });
    expect(instance!.dueYear).toBeGreaterThanOrEqual(1210);
    expect(instance!.dueYear).toBeLessThanOrEqual(1212);
  });

  it('makes the family\'s own hand the better keeper of the books, across a save at each step', () => {
    const { ctx, asker } = house();
    const { head, page, instance } = ask(ctx, asker, 'pay_for_the_term');
    finishTerm(ctx, asker);

    const saved = resume(ctx);
    const pending = returnOf(saved, instance!.dueYear!, 'the_day_book');
    expect(pending.fill.ASKER).toBe(asker.id);
    expect(pending.body).toContain('because Wenna asked');

    const answered = resume(saved);
    const before = answered.world.treasury;
    expect(resolveChoice(answered, pending.id, 'keep_it_in_the_family', testRng()).ok).toBe(true);

    const returned = answered.world.chronicle.filter((entry) => entry.eventId === 'the_day_book');
    expect(returned).toHaveLength(1);
    expect(returned[0]!.text).toContain('Wenna takes the day-book upstairs');
    expect(returned[0]!.cause).toEqual({ year: page.year, page: page.id });
    expect(answered.world.treasury).toBe(before + 45);
    expect(sentimentBetween(answered.world, asker.id, head)).toBe(24);
    expect(answered.world.rumours.has('rumour_the_house_that_reads_its_leases')).toBe(true);
    expect(answered.world.arcs.get(instance!.id)?.status).toBe('ended');
    expect(dueArcSteps(answered, testRng()).some((s) => s.instance.id === instance!.id)).toBe(false);

    // The house still decides what its book says about who kept the books.
    const record = answered.world.pendingDecisions.find((d) => d.kind === 'record' && d.event.id === 'the_day_book');
    expect(record).toBeDefined();
    expect(resolveRecord(answered, record!.id, 'embellish').ok).toBe(true);
    expect(answered.world.discrepancies.get('the_books_the_blood_never_kept')?.state).toBe('open');
  });

  it('passing over a lettered asker costs the asker, not the house', () => {
    const { ctx, asker } = house();
    const { head, instance } = ask(ctx, asker, 'pay_for_the_term');
    finishTerm(ctx, asker);
    const pending = returnOf(ctx, instance!.dueYear!, 'the_day_book');
    const before = ctx.world.treasury;
    expect(resolveChoice(ctx, pending.id, 'send_to_bramme', testRng()).ok).toBe(true);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('Wenna had found the same thing the winter before');
    expect(ctx.world.treasury).toBe(before + 25);
    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(0);
  });

  it('a term that broke off leaves nobody in the family to keep the books', () => {
    const { ctx, asker } = house();
    const { head, instance } = ask(ctx, asker, 'pay_for_the_term');
    applyEffect({ kind: 'tutor', target: { slot: 'ASKER' }, attr: 'mind', op: 'cancel' }, ctx, { ASKER: asker.id });
    expect(ctx.world.tutoring.some((t) => t.person === asker.id)).toBe(false);

    const kept = resume(ctx);
    const pending = returnOf(kept, instance!.dueYear!, 'the_day_book');
    const before = kept.world.treasury;
    expect(resolveChoice(kept, pending.id, 'keep_it_in_the_family', testRng()).ok).toBe(true);
    expect(kept.world.chronicle.at(-1)!.text).toContain('nobody else in the family has the reckoning');
    expect(kept.world.treasury).toBe(before);
    expect(sentimentBetween(kept.world, asker.id, head)).toBe(12);

    const clerk = resume(ctx);
    const again = returnOf(clerk, instance!.dueYear!, 'the_day_book');
    expect(resolveChoice(clerk, again.id, 'send_to_bramme', testRng()).ok).toBe(true);
    expect(clerk.world.chronicle.at(-1)!.text).toContain('He has had thirty years to expect it');
    expect(sentimentBetween(clerk.world, asker.id, head)).toBe(12);
  });

  it('an asker who died is never replaced: the page is the absent one and the dead act on nothing', () => {
    const { ctx, asker } = house();
    const { head, instance } = ask(ctx, asker, 'pay_for_the_term');
    finishTerm(ctx, asker);
    ctx.world.people.kill(asker.id, ctx.world.year, 'before the books changed hands');
    place(ctx, { sex: 'female', age: 24, name: 'A lettered cousin' }).taught.push('mind');

    const pending = returnOf(ctx, instance!.dueYear!, 'the_day_book');
    expect(pending.body).toContain('Wenna is not here to be asked');
    expect(instance!.bindings).toEqual({ ASKER: asker.id });
    expect(resolveChoice(ctx, pending.id, 'keep_it_in_the_family', testRng()).ok).toBe(true);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('Whatever the forty crowns bought is not at the table');
    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(12);
    expect(instance!.status).toBe('ended');
  });

  it('starts no return the campaign cannot reach, and still takes the term', () => {
    const end = CAMPAIGNS.short.endYear;
    const { ctx, asker } = house('short', end - 9);
    const { instance } = ask(ctx, asker, 'pay_for_the_term');
    expect(instance).toBeUndefined();
    expect(ctx.world.tutoring.some((t) => t.person === asker.id)).toBe(true);
  });

  it('brings a late return in before collection rather than past it', () => {
    const end = CAMPAIGNS.long.endYear;
    const { ctx, asker } = house('long', end - 11);
    const { instance } = ask(ctx, asker, 'pay_for_the_term');
    expect(instance!.dueYear).toBeLessThanOrEqual(end);
  });
});

describe('refusing the term (#1976)', () => {
  it('turns the same request toward the next child, carried by the person refused', () => {
    const { ctx, asker } = house();
    const before = ctx.world.treasury;
    const { head, page, instance } = ask(ctx, asker, 'the_terms_are_for_the_heir');
    expect(ctx.world.treasury).toBe(before);
    expect(ctx.world.tutoring.some((t) => t.person === asker.id)).toBe(false);
    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(-10);
    expect(instance?.bindings).toEqual({ ASKER: asker.id });

    ctx.world.year = instance!.dueYear!;
    const child = place(ctx, { sex: 'male', age: 12, name: 'Osric' });
    const saved = resume(ctx);
    const pending = returnOf(saved, instance!.dueYear!, 'asked_again');
    expect(pending.fill.ASKER).toBe(asker.id);
    expect(pending.fill.CHILD).toBe(child.id);
    expect(pending.body).toContain('It is for Osric');

    const answered = resume(saved);
    const paid = answered.world.treasury;
    expect(resolveChoice(answered, pending.id, 'pay_for_this_one', testRng()).ok).toBe(true);
    expect(answered.world.tutoring.some((t) => t.person === child.id && t.attr === 'mind')).toBe(true);
    expect(answered.world.treasury).toBe(paid - TUTOR_FEE);
    expect(sentimentBetween(answered.world, asker.id, head)).toBe(5);
    const returned = answered.world.chronicle.find((entry) => entry.eventId === 'asked_again')!;
    expect(returned.cause).toEqual({ year: page.year, page: page.id });
    expect(answered.world.arcs.get(instance!.id)?.status).toBe('ended');

    // What the house writes about whom it educates is its own record of itself.
    const record = answered.world.pendingDecisions.find((d) => d.kind === 'record' && d.event.id === 'asked_again');
    expect(record).toBeDefined();
    expect(resolveRecord(answered, record!.id, 'embellish').ok).toBe(true);
    expect(answered.world.discrepancies.get('the_term_the_house_always_paid')?.state).toBe('open');
  });

  it('refusing twice is a grudge the asker holds against the head, and a story in the yard', () => {
    const { ctx, asker } = house();
    const { head, instance } = ask(ctx, asker, 'the_terms_are_for_the_heir');
    ctx.world.year = instance!.dueYear!;
    place(ctx, { sex: 'female', age: 11, name: 'Isolde' });
    const pending = returnOf(ctx, instance!.dueYear!, 'asked_again');
    expect(resolveChoice(ctx, pending.id, 'no_again', testRng()).ok).toBe(true);

    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(-25);
    const held = edge(ctx.world, asker.id, head)!.grudges;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ severity: 25, inheritance: 'heir_only', originEvent: 'asked_again' });
    expect(edge(ctx.world, head, asker.id)?.grudges ?? []).toHaveLength(0);
    expect(ctx.world.rumours.has('rumour_who_the_house_keeps_its_money_for')).toBe(true);
  });

  it('with no untaught child in the house, the return waits rather than casting someone else', () => {
    const { ctx, asker } = house();
    const { instance } = ask(ctx, asker, 'the_terms_are_for_the_heir');
    const due = instance!.dueYear!;
    ctx.world.year = due;
    for (const p of ctx.world.people.household(ctx.world.playerHouse, due)) {
      if (due - p.born < 20) p.taught.push('mind');
    }
    expect(phase('arcs', ctx, false).pending.some((d) => d.kind === 'choice' && d.event.id === 'asked_again')).toBe(false);
    expect(instance!.status).toBe('active');
    expect(instance!.dueYear).toBe(due + 5);
    expect(instance!.bindings).toEqual({ ASKER: asker.id });
  });

  it('an asker who died is not replaced: nobody asks again, and the refusal is the last word', () => {
    const { ctx, asker } = house();
    const { head, page, instance } = ask(ctx, asker, 'the_terms_are_for_the_heir');
    ctx.world.year = instance!.dueYear!;
    ctx.world.people.kill(asker.id, ctx.world.year, 'before asking again');
    place(ctx, { sex: 'male', age: 13, name: 'Tamsin' });
    place(ctx, { sex: 'female', age: 30, name: 'A cousin who was also refused once' });

    expect(phase('arcs', ctx, false).pending.some((d) => d.kind === 'choice' && d.event.id === 'asked_again')).toBe(false);
    expect(instance!.status).toBe('cancelled');
    expect(instance!.bindings).toEqual({ ASKER: asker.id });
    expect(ctx.world.chronicle.filter((entry) => entry.eventId === 'asked_again')).toHaveLength(0);
    expect(ctx.world.chronicle.find((entry) => entry.eventId === ASKING)?.id).toBe(page.id);
    expect(sentimentBetween(ctx.world, asker.id, head)).toBe(-10);
    expect(edge(ctx.world, asker.id, head)?.grudges ?? []).toHaveLength(0);
  });

  it('reads the absent day-book page in Plain English with no missing variant', () => {
    const { ctx, asker } = house();
    const { instance } = ask(ctx, asker, 'pay_for_the_term');
    ctx.world.people.kill(asker.id, ctx.world.year, 'before the books changed hands');
    setProseVariants(ctx, base.proseVariants);
    setProseMode(ctx, 'plainenglish');
    const pending = returnOf(ctx, instance!.dueYear!, 'the_day_book');
    expect(pending.body).toContain('but Wenna is not here to be asked');
    expect(missingPlainEnglish(ctx).filter((address) => address.includes('the_wish.yaml'))).toEqual([]);
  });
});
