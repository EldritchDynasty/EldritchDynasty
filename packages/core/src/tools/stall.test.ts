import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  LADDER_BLOCKERS,
  eldritchPower,
  foremostOf,
  standingOf,
} from '../ascension.js';
import { phenotypeOf } from '../people/factory.js';
import { acquireLibraryCopy, canStudySpellbook } from '../people/library.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { place, testWorld } from '../testing.js';
import type { SimCtx } from '../world.js';
import { blockerActionability, blockerLevers, makeStallClock, sampleStallClock } from './stall.js';

const bundle = loadContent();

function placedExpresser(
  ctx: SimCtx,
  accept: (power: number) => boolean = () => true,
) {
  for (let i = 0; i < 80; i++) {
    const p = place(ctx, {
      sex: 'male',
      age: 20,
      name: `Stall Candidate ${i}`,
      awakened: true,
    });
    const ph = phenotypeOf(p, ctx.genetics, ctx.world.year);
    if (ph.eldritch.canExpress && accept(eldritchPower(ctx, p))) return p;
  }
  throw new Error('fixture could not place an expresser with the requested power');
}

function makeOnlyExpresser(ctx: SimCtx, keep: string): void {
  for (const p of [...ctx.world.people.living()]) {
    if (p.id === keep) continue;
    if (!phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) continue;
    ctx.world.people.kill(p.id, ctx.world.year, 'stall instrument fixture');
  }
}

describe('#270 strategic-stall actionability', () => {
  it('maps every structured blocker without a prose fallback', () => {
    for (const blocker of LADDER_BLOCKERS) {
      expect(() => blockerLevers(blocker)).not.toThrow();
    }
  });

  it('calls a books blocker actionable only when the current climber can actually study a useful book', () => {
    const ctx = testWorld(bundle, 27001);
    const him = placedExpresser(ctx);
    makeOnlyExpresser(ctx, him.id);

    // Put the climber beyond the early power gates while leaving the reading
    // predicate empty. These are the same acquired layers the two rites use;
    // they do not change whether he is an expresser.
    him.acquired[ELDRITCH_GIFT] = 400;
    him.acquired[ELDRITCH_REACH] = 400;
    him.acquired.mind = 300;
    him.spellsKnown = [];
    him.phenotype = undefined;

    const book = ctx.content.spellbooks.find((def) => canStudySpellbook(ctx, him, def).ok);
    expect(book, 'fixture needs one book this awakened man can read').toBeTruthy();
    acquireLibraryCopy(ctx, String(book!.id));

    expect(foremostOf(ctx)?.person.id).toBe(him.id);
    expect(standingOf(ctx, him).blocker).toBe('books');

    const result = blockerActionability(ctx, 'books');
    expect(result.actionable).toBe(true);
    expect(result.verbs).toContain('study');

    const clock = makeStallClock();
    sampleStallClock(ctx, clock, 'books', him.id);
    expect(clock.actionableGap.books).toBe(0);
  });

  it('lets a real power blocker accumulate a gap when no Match or widening rite is offered', () => {
    const ctx = testWorld(bundle, 27002);
    const him = placedExpresser(ctx, (power) => power < 10);
    makeOnlyExpresser(ctx, him.id);
    him.spellsKnown = [];
    him.phenotype = undefined;

    expect(foremostOf(ctx)?.person.id).toBe(him.id);
    expect(standingOf(ctx, him).blocker).toBe('power');
    expect(ctx.world.pendingDecisions.some((d) => d.kind === 'match')).toBe(false);

    const result = blockerActionability(ctx, 'power');
    expect(result).toEqual({ actionable: false, verbs: [] });

    const clock = makeStallClock();
    sampleStallClock(ctx, clock, 'power', him.id);
    sampleStallClock(ctx, clock, 'power', him.id);
    expect(clock.actionableGap.power).toBe(2);
  });
});
