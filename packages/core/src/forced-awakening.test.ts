import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyEffect,
  beget,
  canStudySpellbook,
  mindOf,
  phenotypeOf,
  place,
  standingOf,
  testWorld,
} from '@ed/core';

const bundle = loadContent();

function carrierTwinName(ctx: ReturnType<typeof testWorld>): string {
  for (let i = 0; i < 96; i += 1) {
    const name = `Forced-awakening twin ${i}`;
    const probe = place(ctx, { sex: 'male', age: 12, name });
    if (phenotypeOf(probe, ctx.genetics, ctx.world.year).eldritch.canExpress) return name;
  }
  throw new Error('test content produced no male expresser across 96 deterministic placements');
}

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
