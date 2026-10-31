import { describe, expect, it, vi } from 'vitest';
import { loadBundle } from '@ed/content';
import type { ArcInstance, ContentBundle, EventTemplate, MissingPolicy } from '@ed/schema';
import { asId } from '@ed/schema';
import { dueArcSteps, place, testRng, testWorld } from '@ed/core';
import type { Person } from '@ed/schema';
import { executeOutcomeWitness } from './events/reach.js';
import { queueChoice, resolveChoice } from './events/decisions.js';
import { canonical, loadGame, saveGame } from './save.js';
import type { SimCtx } from './world.js';

/**
 * WHO CARRIES THE THIRD HALL'S LETTER (#1977).
 *
 * `inherit: hall` is the branch's own successor: whoever now speaks for the
 * hall the missing person last lived in, checked against the slot. These
 * witnesses give the Hall's two kept slots explicit policies in the test
 * bundle so the mechanism is pinned whatever the shipped YAML says; the
 * shipped wiring has its own block below.
 */
const base = loadBundle();
const ANSWERED = 'the_hall_is_answered';
const ARC = 'inline_the_hall_that_waited__somebody_reads_it_properly';

function withPolicies(source: ContentBundle, policies: Record<string, MissingPolicy>, inheritedBody?: string): ContentBundle {
  return {
    ...source,
    events: source.events.map((event) => {
      if (event.id !== ANSWERED) return event;
      const slots = Object.fromEntries(Object.entries(event.slots).map(([id, spec]) =>
        [id, policies[id] ? { ...spec, onMissing: policies[id] } : spec]));
      return { ...event, slots, ...(inheritedBody ? { inheritedBody } : {}) } as EventTemplate;
    }),
  };
}

const SUCCESSOR_BODY = 'A different hand carries the old letter: {COUSIN}, to {HEAD}.';

function cadet(ctx: SimCtx, name: string, branch: string, age = 30, sex: 'male' | 'female' = 'male'): Person {
  const p = place(ctx, { sex, age, name, branch });
  p.membership.find((m) => m.to === undefined)!.kind = 'cadet';
  return p;
}

function hall(ctx: SimCtx, id: string, founder: Person): void {
  ctx.world.branches.set(id, {
    id: asId(id), name: `The hall of ${founder.name}`, house: asId(ctx.world.playerHouse), founder: founder.id,
    splitFrom: 'main', foundedYear: ctx.world.year - 10, speaker: founder.id, grievance: 0,
  });
}

/** One letter heard properly, its inline continuation started, due date reached. */
function letter(policies: Record<string, MissingPolicy>, inheritedBody: string | null = SUCCESSOR_BODY) {
  const ctx = testWorld(withPolicies(base, policies, inheritedBody ?? undefined), 1977, 1300);
  ctx.world.discontent = 40;
  // Only the halls this test builds: the founding cast's own cadets would
  // otherwise compete for the opening's COUSIN slot.
  for (const p of ctx.world.people.living()) {
    const current = p.membership.find((m) => m.to === undefined);
    if (current?.kind === 'cadet') current.kind = 'blood';
  }
  const writer = cadet(ctx, 'The letter writer', 'third_hall', 40);
  hall(ctx, 'third_hall', writer);
  const rival = cadet(ctx, 'A fourth-hall cousin', 'fourth_hall', 45);
  hall(ctx, 'fourth_hall', rival);
  const rng = testRng('hall-letter');
  vi.spyOn(rng, 'range').mockImplementation((min) => min);
  // The writer is the only cadet the opening may cast; the rival joins after.
  rival.membership.find((m) => m.to === undefined)!.kind = 'blood';
  const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_that_waited'), {
    expectedOutcomeId: 'somebody_reads_it_properly', targetWeightedOutcome: true, rng,
  });
  expect(result.ok, result.reason).toBe(true);
  rival.membership.find((m) => m.to === undefined)!.kind = 'cadet';
  const instance = [...ctx.world.arcs.values()].find((a) => a.arc === ARC);
  if (!instance) throw new Error('the heard letter started no continuation');
  expect(instance.bindings.COUSIN).toBe(writer.id);
  const head = ctx.world.people.get(instance.bindings.HEAD!)!;
  const page = ctx.world.chronicle.find((entry) => entry.eventId === 'the_hall_that_waited')!;
  return { ctx, instance, writer, rival, head, page };
}

function due(ctx: SimCtx, instance: ArcInstance) {
  ctx.world.year = instance.dueYear!;
  return dueArcSteps(ctx, testRng('due')).filter((step) => step.instance.id === instance.id);
}

describe('inherit: hall passes a branch demand to the same hall (#1977)', () => {
  it('gives the dead writer\'s slot to whoever now speaks for his hall, never a cousin of another hall', () => {
    const { ctx, instance, writer, rival } = letter({ COUSIN: { inherit: 'hall' } });
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    const son = place(ctx, { sex: 'male', age: 26, name: 'The writer\'s son', branch: 'third_hall' });
    const [step] = due(ctx, instance);
    expect(step, 'the continuation should survive the writer').toBeDefined();
    expect(step!.inherited).toBe(true);
    expect(step!.absent).toBe(false);
    expect(instance.bindings.COUSIN).toBe(son.id);
    expect(step!.fill.COUSIN).toBe(son.id);
    expect(instance.bindings.COUSIN).not.toBe(rival.id);
    expect(instance.status).toBe('active');
  });

  it('ends the story when the hall has nobody left to speak, rather than reaching into another hall or the house', () => {
    const { ctx, instance, writer } = letter({ COUSIN: { inherit: 'hall' } });
    ctx.world.people.kill(writer.id, ctx.world.year, 'the last of his hall');
    place(ctx, { sex: 'male', age: 40, name: 'A main-hall cousin' });
    expect(due(ctx, instance)).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
    expect(instance.bindings.COUSIN).toBe(writer.id);
  });

  it('ends the story when the hall itself is extinct on the books', () => {
    const { ctx, instance, writer } = letter({ COUSIN: { inherit: 'hall' } });
    place(ctx, { sex: 'male', age: 26, name: 'The writer\'s son', branch: 'third_hall' });
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    ctx.world.branches.get('third_hall')!.extinct = ctx.world.year;
    expect(due(ctx, instance)).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
  });

  it('refuses a speaker who fails the slot\'s own filters', () => {
    const { ctx, instance, writer } = letter({ COUSIN: { inherit: 'hall' } });
    const filtered = ctx.content.mustEvent(ANSWERED);
    filtered.slots.COUSIN!.filters = [...filtered.slots.COUSIN!.filters, { age: { op: 'gte', value: 30 } }];
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    place(ctx, { sex: 'male', age: 19, name: 'A boy who speaks for the hall', branch: 'third_hall' });
    expect(due(ctx, instance)).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
  });

  it('refuses a speaker who already stands in another binding of the story', () => {
    const { ctx, instance, writer, head } = letter({ COUSIN: { inherit: 'hall' } });
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    // The Head himself living in that hall is not a thing succession allows;
    // the binding check is what stops it reading as a letter to himself.
    head.membership.find((m) => m.to === undefined)!.branch = 'third_hall';
    expect(due(ctx, instance)).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
  });

  it('passes again when the successor dies before the page, and records no second page', () => {
    const { ctx, instance, writer } = letter({ COUSIN: { inherit: 'hall' } });
    const son = place(ctx, { sex: 'male', age: 30, name: 'The elder son', branch: 'third_hall' });
    const younger = place(ctx, { sex: 'male', age: 26, name: 'The younger son', branch: 'third_hall' });
    ctx.world.people.kill(writer.id, ctx.world.year, 'first');
    ctx.world.year = instance.dueYear!;
    // Hold the page back a turn: a premise the hall cannot yet meet.
    const steps = dueArcSteps(ctx, testRng('first'));
    expect(steps.map((s) => s.instance.id)).toContain(instance.id);
    expect(instance.bindings.COUSIN).toBe(son.id);
    ctx.world.people.kill(son.id, ctx.world.year, 'second');
    const [again] = dueArcSteps(ctx, testRng('second')).filter((s) => s.instance.id === instance.id);
    expect(again?.inherited).toBe(true);
    expect(instance.bindings.COUSIN).toBe(younger.id);
  });

  it('recasts the Head as the office when the founder who read the letter becomes the guardian', () => {
    const { ctx, instance, head } = letter({ HEAD: 'recast' });
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    const next = place(ctx, { sex: 'male', age: 35, name: 'The new Head', castSlots: ['head'] });
    ctx.world.people.kill(head.id, ctx.world.year, 'the long reign ends');
    expect(head.status).toBe('guardian');
    const [step] = due(ctx, instance);
    expect(step?.inherited).toBe(true);
    expect(instance.bindings.HEAD).toBe(next.id);
    expect(step!.fill.HEAD).toBe(next.id);
  });

  it('recasts the Head as the office when a mortal Head dies, and keeps the writer', () => {
    const { ctx, instance, head, writer } = letter({ HEAD: 'recast' });
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    const old = place(ctx, { sex: 'male', age: 70, name: 'The long-reigning Head' });
    instance.bindings.HEAD = old.id;
    const next = place(ctx, { sex: 'male', age: 35, name: 'The new Head', castSlots: ['head'] });
    ctx.world.people.kill(old.id, ctx.world.year, 'the long reign ends');
    const [step] = due(ctx, instance);
    expect(step?.inherited).toBe(true);
    expect(instance.bindings.HEAD).toBe(next.id);
    expect(instance.bindings.COUSIN).toBe(writer.id);
  });

  it('cancels when both have gone and only the office can pass', () => {
    const { ctx, instance, head, writer } = letter({ HEAD: 'recast' });
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    place(ctx, { sex: 'male', age: 35, name: 'The new Head', castSlots: ['head'] });
    ctx.world.people.kill(head.id, ctx.world.year, 'the long reign ends');
    ctx.world.people.kill(writer.id, ctx.world.year, 'and the writer');
    expect(due(ctx, instance)).toHaveLength(0);
    expect(instance.status).toBe('cancelled');
  });

  it('passes both when the office and the hall each have a successor', () => {
    const { ctx, instance, head, writer } = letter({ HEAD: 'recast', COUSIN: { inherit: 'hall' } });
    head.castSlots = head.castSlots.filter((slot) => slot !== 'head');
    const next = place(ctx, { sex: 'male', age: 35, name: 'The new Head', castSlots: ['head'] });
    const son = place(ctx, { sex: 'male', age: 26, name: 'The writer\'s son', branch: 'third_hall' });
    ctx.world.people.kill(head.id, ctx.world.year, 'the long reign ends');
    ctx.world.people.kill(writer.id, ctx.world.year, 'and the writer');
    const [step] = due(ctx, instance);
    expect(step?.inherited).toBe(true);
    expect(step!.fill).toMatchObject({ HEAD: next.id, COUSIN: son.id });
  });

  it('does not mark an unchanged cast inherited', () => {
    const { ctx, instance } = letter({ COUSIN: { inherit: 'hall' }, HEAD: 'recast' });
    const [step] = due(ctx, instance);
    expect(step).toBeDefined();
    expect(step!.inherited).toBeUndefined();
  });
});

describe('the successor\'s page is the inherited body, and it survives a save (#1977)', () => {
  function inheritedPending() {
    const fixture = letter({ COUSIN: { inherit: 'hall' }, HEAD: 'recast' });
    const { ctx, instance, writer } = fixture;
    const son = place(ctx, { sex: 'male', age: 26, name: 'Corwen of the third hall', branch: 'third_hall' });
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    const [step] = due(ctx, instance);
    const event = ctx.content.mustEvent(step!.node.event);
    const body = step!.inherited && event.inheritedBody ? event.inheritedBody : event.body;
    const pending = queueChoice(ctx, { ...event, body }, body, step!.fill, step!.playerCast, step);
    return { ...fixture, son, pending };
  }

  it('renders the successor wording and names the successor', () => {
    const { pending, son, head } = inheritedPending();
    expect(pending.body).toBe(`A different hand carries the old letter: ${son.name}, to ${head.name}.`);
    expect(pending.arcStep?.inherited).toBe(true);
  });

  it('keeps the inherited page, cast and launching cause across save and resume, and answers once', () => {
    const { ctx, pending, son, page, instance } = inheritedPending();
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), ctx.content);
    expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
    const saved = resumed.world.pendingDecisions.find((d) => d.id === pending.id);
    expect(saved?.kind === 'choice' && saved.body).toBe(pending.body);
    expect(saved?.kind === 'choice' && saved.arcStep?.inherited).toBe(true);
    expect(resolveChoice(resumed, pending.id, 'give_them_something_real', testRng()).ok).toBe(true);
    const answered = resumed.world.chronicle.filter((entry) => entry.eventId === ANSWERED);
    expect(answered).toHaveLength(1);
    expect(answered[0]!.cause).toEqual({ year: page.year, page: page.id });
    expect(answered[0]!.text).toContain(son.name);
    expect(resumed.world.arcs.get(instance.id)?.status).toBe('ended');
    expect(dueArcSteps(resumed, testRng())).toHaveLength(0);
  });

  it('falls back to the ordinary body when the event declares no inherited wording', () => {
    const { ctx, instance, writer } = letter({ COUSIN: { inherit: 'hall' } }, null);
    place(ctx, { sex: 'male', age: 26, name: 'The writer\'s son', branch: 'third_hall' });
    ctx.world.people.kill(writer.id, ctx.world.year, 'before the promised return');
    const [step] = due(ctx, instance);
    const event = ctx.content.mustEvent(step!.node.event);
    expect(step!.inherited).toBe(true);
    expect(event.inheritedBody).toBeUndefined();
  });
});
