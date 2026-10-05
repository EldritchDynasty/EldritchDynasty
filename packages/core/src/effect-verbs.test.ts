import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { SlotSpecS, type EventTemplate } from '@ed/schema';
import { applyEffect, bootstrap, phenotypeOf, place } from '@ed/core';

const bundle = loadContent();

/**
 * THE VERBS NOBODY HAS SPOKEN.
 *
 * EffectS is a closed verb set. Some verbs are intentionally engine vocabulary
 * before content adopts them; every such verb still needs direct coverage.
 * awakening is one of those: concept §11 requires a mechanical forced-Awakening
 * path before the serialized ritual content can be wired.
 *
 * Historically rumour and recast were covered by nothing at all —
 * never authored, never tested, never once executed in the history of the
 * project. That is not the same as unused. They are live authoring vocabulary,
 * and the day someone reaches for one is a bad day to find out what it does.
 *
 * `recast` in particular was wrong the whole time. It filtered the literal
 * string `'head'` out of `castSlots` regardless of which slot it was pointed
 * at, so it freed nothing on any slot that was not the Head's, and stripped
 * the seal from a VESSEL who happened to be holding it. See `scope.ts`.
 */

/**
 * A real template, adjusted to the slot shape a test needs. Never a toy bundle,
 * and the slots go through `SlotSpecS` so they carry the same defaults an
 * authored one does rather than a hand-written approximation of them.
 */
function templateWithSlots(roles: Record<string, string>): EventTemplate {
  const e = structuredClone(bundle.events[0]!);
  e.slots = Object.fromEntries(
    Object.entries(roles).map(([slot, role]) => [slot, SlotSpecS.parse({ role })]),
  );
  return e;
}

function placedCarrier(ctx: ReturnType<typeof bootstrap>, sex: 'male' | 'female') {
  for (let i = 0; i < 96; i += 1) {
    const p = place(ctx, { sex, age: 12, name: 'Forced carrier ' + sex + ' ' + i });
    if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.carriedFont > 0) return p;
  }
  throw new Error('test content produced no carried font for a ' + sex + ' across 96 deterministic placements');
}

function placedMundaneMan(ctx: ReturnType<typeof bootstrap>) {
  for (let i = 0; i < 96; i += 1) {
    const p = place(ctx, { sex: 'male', age: 20, name: 'Mundane man ' + i });
    if (!phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) return p;
  }
  throw new Error('test content produced no mundane man across 96 deterministic placements');
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

describe('the recast effect frees the role the slot casts for', () => {
  it('frees the Head from the seal when pointed at a head slot', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const head = place(ctx, { sex: 'male', age: 45, name: 'The Sitting Head', castSlots: ['head'] });
    const event = templateWithSlots({ HEAD: 'head' });

    applyEffect({ kind: 'recast', slot: 'HEAD' }, ctx, { HEAD: head.id }, { event });

    expect(head.castSlots).not.toContain('head');
  });

  /**
   * The bug, stated as a test. A VESSEL is cast `family_member`; before the
   * fix this call removed `'head'` — which the vessel did not have — and left
   * `family_member` exactly where it was, so `maintainCast` never refilled the
   * slot and the effect was a no-op that looked like it had worked.
   */
  it('frees a non-head slot from ITS role, not from the seal', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const vessel = place(ctx, { sex: 'male', age: 20, name: 'The Vessel', castSlots: ['family_member'] });
    const event = templateWithSlots({ VESSEL: 'family_member' });

    applyEffect({ kind: 'recast', slot: 'VESSEL' }, ctx, { VESSEL: vessel.id }, { event });

    expect(vessel.castSlots).not.toContain('family_member');
  });

  /**
   * The other half of the same bug, and the expensive one: a person can hold
   * the seal AND stand in some other slot of the same scene. Recasting that
   * other slot must not take the house's Head off them.
   */
  it('leaves the seal alone when the recast slot is not the head slot', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const both = place(ctx, { sex: 'male', age: 45, name: 'Head And Witness', castSlots: ['head', 'family_member'] });
    const event = templateWithSlots({ WITNESS: 'family_member' });

    applyEffect({ kind: 'recast', slot: 'WITNESS' }, ctx, { WITNESS: both.id }, { event });

    expect(both.castSlots).toContain('head');
    expect(both.castSlots).not.toContain('family_member');
  });

  /**
   * Absent the template there is no role to free, and guessing one is what the
   * old code did. Doing nothing is the same choice `arcFlag` makes when it is
   * asked outside an arc: the permissive default is the expensive one.
   */
  it('does nothing at all with no template in scope, rather than guessing a role', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const head = place(ctx, { sex: 'male', age: 45, name: 'Untouched', castSlots: ['head'] });

    expect(() => applyEffect({ kind: 'recast', slot: 'HEAD' }, ctx, { HEAD: head.id })).not.toThrow();

    expect(head.castSlots).toContain('head');
  });

  it('does nothing when nobody stands in the slot', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const event = templateWithSlots({ HEAD: 'head' });

    expect(() => applyEffect({ kind: 'recast', slot: 'HEAD' }, ctx, {}, { event })).not.toThrow();
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
