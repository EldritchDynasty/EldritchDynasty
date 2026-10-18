import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyEffect,
  beget,
  bootstrap,
  canStudySpellbook,
  mindOf,
  phenotypeOf,
  place,
  standingOf,
  testWorld,
} from '@ed/core';

const bundle = loadContent();

function placedCarrier(ctx: ReturnType<typeof bootstrap>, sex: 'male' | 'female') {
  for (let i = 0; i < 96; i += 1) {
    const p = place(ctx, { sex, age: 12, name: 'Forced carrier ' + sex + ' ' + i });
    if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.carriedFont > 0) return p;
  }
  throw new Error('test content produced no carried font for a ' + sex + ' across 96 deterministic placements');
}

function placedMundaneMan(ctx: ReturnType<typeof bootstrap>) {
  // The Church's shipped pool has fontCarrierRate: 0. Unlike the player's
  // founding pool (rate 1), this gives the test a deterministic incapable man
  // without seed-mining a population state.
  const p = place(ctx, { sex: 'male', age: 20, house: 'the_church', name: 'Mundane man' });
  expect(phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
  return p;
}

function carrierTwinName(ctx: ReturnType<typeof testWorld>): string {
  for (let i = 0; i < 96; i += 1) {
    const name = `Forced-awakening twin ${i}`;
    const probe = place(ctx, { sex: 'male', age: 12, name });
    if (phenotypeOf(probe, ctx.genetics, ctx.world.year).eldritch.canExpress) return name;
  }
  throw new Error('test content produced no male expresser across 96 deterministic placements');
}

describe('the Madness effect is gated by expression', () => {
  it('refuses Madness to a woman and to a mundane man even when called directly', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const woman = place(ctx, { sex: 'female', age: 30, name: 'Incapable woman' });
    const mundane = placedMundaneMan(ctx);

    applyEffect({ kind: 'madness', target: { slot: 'TARGET' }, delta: 40 }, ctx, { TARGET: woman.id });
    applyEffect({ kind: 'madness', target: { slot: 'TARGET' }, delta: 40 }, ctx, { TARGET: mundane.id });

    expect(phenotypeOf(woman, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
    expect(phenotypeOf(mundane, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
    expect(woman.madness).toBe(0);
    expect(mundane.madness).toBe(0);
  });
});

describe('the forced-Awakening effect verb', () => {
  it('records one forced historical Awakening and invalidates derived attributes', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = placedCarrier(ctx, 'male');
    const before = phenotypeOf(child, ctx.genetics, ctx.world.year);
    expect(before.dirty).toBe(false);

    applyEffect({ kind: 'awakening', target: { slot: 'CHILD' } }, ctx, { CHILD: child.id });

    expect(child.awakening).toEqual({
      awakened: true,
      year: ctx.world.year,
      age: 12,
      forced: true,
      declaredMundane: false,
    });
    expect(child.phenotype?.dirty).toBe(true);

    const first = { ...child.awakening };
    ctx.world.year += 7;
    applyEffect({ kind: 'awakening', target: { slot: 'CHILD' } }, ctx, { CHILD: child.id });
    expect(child.awakening).toEqual(first);
  });

  it('can wake a female carrier without inventing expression or Madness', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = placedCarrier(ctx, 'female');
    expect(phenotypeOf(child, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
    expect(child.madness).toBe(0);

    applyEffect({ kind: 'awakening', target: { slot: 'CHILD' } }, ctx, { CHILD: child.id });

    expect(child.awakening.awakened).toBe(true);
    expect(child.awakening.forced).toBe(true);
    expect(phenotypeOf(child, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
    expect(child.madness).toBe(0);
  });

  it('does nothing to a dead carrier', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = placedCarrier(ctx, 'male');
    child.status = 'dead';

    applyEffect({ kind: 'awakening', target: { slot: 'CHILD' } }, ctx, { CHILD: child.id });

    expect(child.awakening.awakened).toBe(false);
    expect(child.awakening.forced).toBe(false);
  });
});

describe('forced Awakening downstream participation', () => {
  it('joins the same Mind, Library and ascension rules as natural Awakening immediately', () => {
    const ctx = testWorld(bundle, 1042, 1042);
    const mother = place(ctx, { sex: 'female', age: 34, name: 'Twin mother' });
    const father = place(ctx, { sex: 'male', age: 36, name: 'Twin father' });

    const name = carrierTwinName(ctx);
    const forced = place(ctx, { sex: 'male', age: 12, name });
    const natural = place(ctx, { sex: 'male', age: 12, name, awakened: true });
    beget(ctx, forced, mother, father);
    beget(ctx, natural, mother, father);

    // Same deterministic placement seed means the twins carry the same genome;
    // the only mechanical distinction under test is how Awakening was reached.
    expect(phenotypeOf(forced, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(true);
    expect(phenotypeOf(natural, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(true);
    expect(forced.awakening.awakened).toBe(false);
    expect(natural.awakening.awakened).toBe(true);
    expect(natural.awakening.forced).toBe(false);

    const book = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    expect(canStudySpellbook(ctx, forced, book)).toEqual({ ok: false, reason: 'not woken' });
    expect(standingOf(ctx, forced).blocker).toBe('awakening');

    applyEffect({ kind: 'awakening', target: { slot: 'CHILD' } }, ctx, { CHILD: forced.id });

    expect(forced.awakening.awakened).toBe(true);
    expect(forced.awakening.forced).toBe(true);

    // Awakening provenance is historical metadata, not a second rules path.
    expect(mindOf(ctx, forced)).toBe(mindOf(ctx, natural));
    expect(canStudySpellbook(ctx, forced, book)).toEqual(canStudySpellbook(ctx, natural, book));

    const forcedStanding = standingOf(ctx, forced);
    const naturalStanding = standingOf(ctx, natural);
    expect(forcedStanding.rung).toBe(naturalStanding.rung);
    expect(forcedStanding.blocker).toBe(naturalStanding.blocker);
    expect(forcedStanding.blocker).not.toBe('awakening');
  });
});

/**
 * Content seeds rumours through the declarative event-level `rumour:` block,
 * which is a different code path (`applyOutcome`). The EFFECT verb is the one
 * an author reaches for to feed or retract a rumour mid-scene, and `correct`
 * is the only path in the engine that takes one back out of the world.
 */
describe('the rumour effect verb', () => {
  it('seeds one, at the accuracy it was given', () => {
    const ctx = bootstrap(bundle, 1042, 1042);

    applyEffect({ kind: 'rumour', op: 'seed', id: 'rumour_of_the_test', accuracy: 0.25 }, ctx, {});

    const r = ctx.world.rumours.get('rumour_of_the_test');
    expect(r).toBeDefined();
    expect(r!.accuracy).toBe(0.25);
    expect(r!.spread).toBe(1);
    expect(r!.seededYear).toBe(ctx.world.year);
  });

  it('seeds at even odds when no accuracy is named', () => {
    const ctx = bootstrap(bundle, 1042, 1042);

    applyEffect({ kind: 'rumour', op: 'seed', id: 'rumour_of_the_test' }, ctx, {});

    expect(ctx.world.rumours.get('rumour_of_the_test')!.accuracy).toBe(0.5);
  });

  it('feeding one spreads it further, and feeding one nobody has told does nothing', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    applyEffect({ kind: 'rumour', op: 'seed', id: 'rumour_of_the_test' }, ctx, {});

    applyEffect({ kind: 'rumour', op: 'feed', id: 'rumour_of_the_test' }, ctx, {});
    applyEffect({ kind: 'rumour', op: 'feed', id: 'rumour_of_the_test' }, ctx, {});

    expect(ctx.world.rumours.get('rumour_of_the_test')!.spread).toBe(3);

    expect(() => applyEffect({ kind: 'rumour', op: 'feed', id: 'never_told' }, ctx, {})).not.toThrow();
    expect(ctx.world.rumours.has('never_told')).toBe(false);
  });

  it('correcting one takes it back out of the world', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    applyEffect({ kind: 'rumour', op: 'seed', id: 'rumour_of_the_test' }, ctx, {});

    applyEffect({ kind: 'rumour', op: 'correct', id: 'rumour_of_the_test' }, ctx, {});

    expect(ctx.world.rumours.has('rumour_of_the_test')).toBe(false);
  });
});
