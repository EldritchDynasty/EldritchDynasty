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
import { grantHeirloom } from '../people/heirlooms.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { place, testWorld } from '../testing.js';
import { order } from '../table.js';
import type { SimCtx } from '../world.js';
import { measureDensity } from './density-gate.js';
import {
  blockerActionability, blockerLevers, makeFailureTracker, makeStallClock,
  noteOrderAttempt, observeOrderAttempt, sampleStallClock,
} from './stall.js';

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

  it('switches book actionability from the climber to the household only after Unmaking', () => {
    const ctx = testWorld(bundle, 27003);
    const him = placedExpresser(ctx);

    ctx.world.respect = 'exalted';
    him.acquired[ELDRITCH_GIFT] = 400;
    him.acquired[ELDRITCH_REACH] = 400;
    him.acquired.mind = 400;
    him.madness = 65;
    him.rites.push('vessel', 'great_rite');
    const demigodBookIds = [
      'lesser_workings_of_fluid',
      'lesser_workings_of_thermal',
      'lesser_workings_of_aero',
      'lesser_workings_of_terra',
      'lesser_workings_of_life',
      'lesser_workings_of_death',
      'the_marrow_codex',
    ];
    for (const id of demigodBookIds) {
      const def = ctx.content.spellbook(id);
      expect(def, `fixture is missing ${id}`).toBeTruthy();
      him.spellsKnown.push(def!.id);
    }
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');
    him.phenotype = undefined;

    const duplicate = ctx.content.spellbooks.find((def) =>
      !him.spellsKnown.some((known) => String(known) === String(def.id))
      && canStudySpellbook(ctx, him, def).ok);
    expect(duplicate, 'fixture needs one readable eighth book').toBeTruthy();

    // Someone else already knows the eighth book. Before Unmaking that does
    // NOT satisfy the climber's personal God reading: studying the shelf copy
    // himself moves his exact failed predicate and must count as actionable.
    const reader = place(ctx, { sex: 'male', age: 30, name: 'Another Reader' });
    reader.spellsKnown.push(duplicate!.id);
    ctx.world.library.clear();
    acquireLibraryCopy(ctx, String(duplicate!.id));

    const before = standingOf(ctx, him);
    expect(before.rung).toBe('demigod');
    expect(before.blocker).toBe('books');
    expect(blockerActionability(ctx, 'books', him.id).verbs).toContain('study');

    // Unmaking is the engine's switch to the living-family final circle. The
    // same shelf copy is now redundant because a living reader already knows
    // it, so Study no longer moves the book-count predicate.
    him.rites.push('unmaking');
    expect(blockerActionability(ctx, 'books', him.id).verbs).not.toContain('study');
  });

  it('counts repeated failed table orders for the same person and exact order', () => {
    const ctx = testWorld(bundle, 27004);
    const him = place(ctx, { sex: 'male', age: 20, name: 'Persistent Pupil' });
    const attempt = { kind: 'career', person: him.id, career: 'no_such_post' } as const;
    const tracker = makeFailureTracker();

    for (let i = 0; i < 2; i++) {
      const result = order(ctx, attempt);
      expect(result.ok).toBe(false);
      const observed = observeOrderAttempt(attempt, result);
      expect(observed).toBeTruthy();
      noteOrderAttempt(tracker, observed!);
    }

    expect(tracker.order).toBe(2);
  });

  it('wires real table-policy attempts into DensityRun.repeatedFailure.order', () => {
    let person: string | undefined;
    const run = measureDensity(bundle, 27005, 3, {
      tableOrder: (ctx) => {
        person ??= ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]?.id;
        return person ? { kind: 'career', person, career: 'no_such_post' } : undefined;
      },
    });

    expect(run.repeatedFailure.campaign.order).toBe(3);
  });

  it('lets a real power blocker accumulate a gap when no Match or widening rite is offered', () => {
    const ctx = testWorld(bundle, 27002);
    const him = placedExpresser(ctx, (power) => power < 50);
    makeOnlyExpresser(ctx, him.id);
    // A normal expresser sits around the thirties on the ladder scale. Give
    // him the reading needed to clear Adept so the next unmet predicate is
    // still power, without depending on a near-zero expresser that the locus
    // table does not actually produce.
    him.spellsKnown = ctx.content.spellbooks.map((book) => book.id);
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
