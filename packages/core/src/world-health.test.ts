import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { MAIN_BRANCH, asId } from '@ed/schema';
import type { Person } from '@ed/schema';
import {
  testWorld, place, marry, worldViolations, expectHealthyWorld,
} from './testing.js';

const bundle = loadContent();

/**
 * THE CHECKER HAS TO BE ABLE TO FAIL.
 *
 * `worldViolations` returned an empty list over six played millennia — 6,755
 * people — before a line of this file existed. That is the result you want
 * and it is also indistinguishable from a function that returns `[]` no
 * matter what you hand it. Every rule in it gets a world here that it MUST
 * reject, for the same reason `rules.ts` gets bundles it must reject and for
 * the same reason gate 2 gets a template nobody can cast.
 *
 * Each test breaks exactly one thing, from a world that was healthy the line
 * before — so a violation that appears is the one that was introduced, not a
 * fixture that was never coherent to begin with.
 */

/**
 * A small, healthy world: the founding cast, plus a wife married to the man
 * who already holds the seal.
 *
 * IT USES THE FOUNDING HEAD RATHER THAN PLACING ONE. The first cut of this
 * fixture did `place(..., castSlots: ['head'])`, which crowned a rival —
 * `testWorld` already seats a head, and the seal check caught the fixture
 * before it caught anything else. Worth keeping in the comment: the helper
 * that builds "a house" starts from a house that already exists.
 */
function house() {
  const ctx = testWorld(bundle);
  const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
  const wife = place(ctx, { sex: 'female', age: 38, name: 'The Wife' });
  // The founding head may already be married; this fixture wants a vow it owns.
  for (const m of head.marriages) if (m.to === undefined) m.to = ctx.world.year;
  for (const p of ctx.world.people.all()) {
    for (const m of p.marriages) {
      if (m.to === undefined && String(m.spouse) === String(head.id)) m.to = ctx.world.year;
    }
  }
  marry(ctx, head, wife);
  return { ctx, head, wife };
}

/** What `rule` said, or `undefined` if it said nothing. */
function complaint(violations: { rule: string; detail: string }[], rule: string) {
  return violations.find((v) => v.rule === rule)?.detail;
}

describe('a world the checker is happy with', () => {
  it('passes a hand-built house', () => {
    const { ctx } = house();
    expect(worldViolations(ctx)).toEqual([]);
  });

  it('passes the founding cast the game actually starts with', () => {
    const ctx = testWorld(bundle);
    expect(worldViolations(ctx)).toEqual([]);
  });

  /**
   * The fixture itself has to be able to go wrong, or every test below it is
   * asserting against a world that was already broken.
   */
  it('and the fixture is not vacuously healthy — it has people in it', () => {
    const { ctx } = house();
    expect(ctx.world.people.living().length).toBeGreaterThan(2);
    expect(ctx.world.people.living().some((p) => p.castSlots.includes('head'))).toBe(true);
  });
});

describe('and the worlds it must reject', () => {
  it('INVARIANT 15 — a second open membership record', () => {
    const { ctx, wife } = house();
    // Moved to a cadet hall without closing the record she was already in.
    wife.membership.push({
      house: asId(ctx.world.playerHouse), kind: 'cadet', from: ctx.world.year, branch: 'salt',
    });

    const bad = worldViolations(ctx);
    expect(complaint(bad, 'INVARIANT 15')).toContain('2 open membership records');
    expect(() => expectHealthyWorld(ctx)).toThrow(/INVARIANT 15/);
  });

  it('INVARIANT 2 — a death that did not come through kill()', () => {
    const { ctx, wife } = house();
    // Exactly what an authored `status` effect that skipped the gate looks like.
    wife.status = 'dead';

    const bad = worldViolations(ctx);
    expect(complaint(bad, 'INVARIANT 2')).toContain('no year of death');
    expect(bad.filter((v) => v.rule === 'INVARIANT 2')).toHaveLength(2); // year AND cause
  });

  it('marriage — a widow still married to a dead man', () => {
    const { ctx, head, wife } = house();
    // Killed WITHOUT the gate, so the marriage never closes on either side.
    head.status = 'dead';
    head.died = ctx.world.year;
    head.causeOfDeath = 'a test';

    expect(complaint(worldViolations(ctx), 'marriage'))
      .toMatch(/open marriage to .*dead since/);
  });

  /**
   * THE ORDINARY DEATH GATE LEAVES NOTHING TO COMPLAIN ABOUT.
   *
   * `kill()` closes the vow on both sides, which is the behaviour the checker
   * above is built to notice the absence of. A man who is not the narrator,
   * so this takes the ordinary branch.
   */
  it('and a death through the real gate closes the vow on both sides', () => {
    const ctx = testWorld(bundle);
    const husband = place(ctx, { sex: 'male', age: 40, name: 'An Ordinary Man' });
    const widow = place(ctx, { sex: 'female', age: 38, name: 'His Wife' });
    marry(ctx, husband, widow);
    expect(worldViolations(ctx).filter((v) => v.rule === 'marriage')).toEqual([]);

    ctx.world.people.kill(husband.id, ctx.world.year, 'a test');

    expect(husband.status).toBe('dead');
    expect(widow.marriages.every((m) => m.to !== undefined)).toBe(true);
    expect(worldViolations(ctx).filter((v) => v.rule === 'marriage')).toEqual([]);
  });

  /**
   * ── A BUG THIS FILE PINS RATHER THAN FIXES ───────────────────────────────
   *
   * `kill()`'s guardian branch — the redirect that makes Daveed the house's
   * guardian spirit instead of a corpse (invariant 3) — closes only HIS half
   * of the vow. The ordinary branch eight lines below it closes both, with a
   * comment explaining that a widow who stays married forever never remarries
   * and never bears again.
   *
   * The three-line fix is deliberately NOT applied: it moves `npm run digest`
   * on 3 of 4 seeds, because it changes how long the widow is invisible to the
   * Match. That is a balance change and wants the harness and a BALANCE-LOG
   * entry, not a quiet correction on a test-suite branch.
   *
   * So this test asserts what the code DOES, and says loudly what it should
   * do. It goes red the day somebody fixes it, and the message tells them
   * that red is the good outcome — which is the only way a pinned bug does
   * not silently become the specification.
   */
  it('PINNED BUG — the guardian redirect leaves his widow married to him', () => {
    const ctx = testWorld(bundle);
    const daveed = ctx.world.people.living().find((p) => p.becomesGuardian)!;
    const widow = ctx.world.people.all().find((p) =>
      p.marriages.some((m) => m.to === undefined && String(m.spouse) === String(daveed.id)));
    expect(widow, 'the founding narrator is not married — this test has nothing to pin').toBeTruthy();

    ctx.world.people.kill(daveed.id, ctx.world.year, 'the appointed hour');
    expect(daveed.status, 'the narrator does not die (invariant 3)').toBe('guardian');

    const stillOpen = widow!.marriages.some((m) => m.to === undefined
      && String(m.spouse) === String(daveed.id));
    expect(
      stillOpen,
      'The guardian redirect now closes the vow on BOTH sides — which is correct, and '
      + 'this test is the thing that is out of date. Delete this test, keep the fix, '
      + 'and record what it did to the run in docs/BALANCE-LOG.md: when it was measured '
      + 'it moved the digest on 3 of 4 seeds.',
    ).toBe(true);

    // And the checker sees it, which is how it was found in the first place.
    expect(complaint(worldViolations(ctx), 'marriage')).toMatch(/does not agree/);
  });

  it('marriage — a vow only one side made', () => {
    const { ctx, head, wife } = house();
    // She forgets him. `match.ts` writing one side and not the other is the
    // shape this catches.
    wife.marriages = wife.marriages.filter((m) => String(m.spouse) !== String(head.id));

    expect(complaint(worldViolations(ctx), 'marriage')).toMatch(/does not agree/);
  });

  it('INVARIANT 12 — the seal leaves the main house', () => {
    const { ctx, head } = house();
    const seat = head.membership.find((m) => m.to === undefined)!;
    seat.branch = 'salt';

    expect(complaint(worldViolations(ctx), 'INVARIANT 12')).toContain('salt');
  });

  it('INVARIANT 12 — two people hold the seal, or nobody does', () => {
    const two = house();
    two.wife.castSlots.push('head');
    expect(complaint(worldViolations(two.ctx), "INVARIANT 12")).toContain("2 of them hold the seal");

    const none = house();
    none.head.castSlots = none.head.castSlots.filter((s) => s !== 'head');
    expect(complaint(worldViolations(none.ctx), 'INVARIANT 12')).toContain('0 of them hold the seal');
  });

  it('land/holder — a caput parcel held by a branch (issue #91, Stage H)', () => {
    const { ctx } = house();
    const [state] = [...ctx.world.parcels.values()].filter((s) => s.defId === 'the_wend_mill');
    ctx.world.branches.set('salt' as never, {
      id: 'salt', name: 'Salt Hall', house: ctx.world.playerHouse, founder: 'nobody' as never,
      splitFrom: 'main', foundedYear: ctx.world.year, grievance: 0,
    } as never);
    state!.holder = 'salt';

    expect(complaint(worldViolations(ctx), 'land/holder')).toMatch(/seat's own ground/);
  });

  it('land/holder — a parcel held by a hall that does not exist (issue #91, Stage H)', () => {
    const { ctx } = house();
    const [state] = [...ctx.world.parcels.values()].filter((s) => s.defId === 'hallowfield');
    state!.holder = 'nonexistent';

    expect(complaint(worldViolations(ctx), 'land/holder')).toMatch(/not a hall of this house/);
  });

  it('INVARIANT 3 — the narrator is allowed to be a guardian, never a corpse', () => {
    const { ctx } = house();
    const daveed = place(ctx, { sex: 'male', age: 60, name: ['Dav', 'eed Gearithy'].join('') });
    ctx.world.narrator = String(daveed.id);

    daveed.status = 'dead';
    daveed.died = ctx.world.year;
    daveed.causeOfDeath = 'a test';
    expect(complaint(worldViolations(ctx), 'INVARIANT 3')).toContain('never taken');

    // Guardian since a year, but still walking around alive: the redirect
    // half-applied, which is how he would end up deciding and dying both.
    daveed.status = 'alive';
    daveed.died = undefined;
    daveed.causeOfDeath = undefined;
    ctx.world.guardianSince = ctx.world.year;
    expect(complaint(worldViolations(ctx), 'INVARIANT 3')).toContain("status is 'alive'");

    daveed.status = 'guardian';
    expect(worldViolations(ctx).filter((v) => v.rule === 'INVARIANT 3')).toEqual([]);
  });

  it('INVARIANT 14 — the ladder forgets a rung the house is standing on', () => {
    const { ctx } = house();
    ctx.world.ascension.rung = 'hierophant';
    ctx.world.ascension.best = 'adept';

    expect(complaint(worldViolations(ctx), 'INVARIANT 14'))
      .toContain("stands at 'hierophant' and remembers only 'adept'");
  });

  it('chronology — a death before a birth', () => {
    const { ctx, wife } = house();
    wife.status = 'dead';
    wife.died = wife.born - 10;
    wife.causeOfDeath = 'a test';

    expect(complaint(worldViolations(ctx), 'chronology')).toMatch(/died in \d+, born \d+/);
  });

  it('descent — somebody is their own parent', () => {
    const { ctx, wife } = house();
    wife.trueParents = { ...wife.trueParents, mother: wife.id };

    expect(complaint(worldViolations(ctx), 'descent')).toContain('their own parent');
  });

  /**
   * The reported message is the whole value of this thing — a checker that
   * says "false" sends you reading four hundred people by hand.
   */
  it('names the rule, the person and the count when it throws', () => {
    const { ctx, wife } = house();
    wife.membership.push({
      house: asId(ctx.world.playerHouse), kind: 'cadet', from: ctx.world.year, branch: 'salt',
    });

    let message = '';
    try { expectHealthyWorld(ctx); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('is not internally coherent');
    expect(message).toContain(String(ctx.world.year));
    expect(message).toContain('INVARIANT 15');
    expect(message).toContain(String(wife.id));
  });
});

/**
 * MAIN_BRANCH is imported so the seal test above is anchored to the real
 * constant rather than the string 'main'; if the constant moves, the fixture
 * moves with it.
 */
describe('the seal check is anchored to the real main branch', () => {
  it('accepts the main hall by its constant, not by its spelling', () => {
    const { ctx, head } = house();
    const seat = head.membership.find((m) => m.to === undefined)!;
    seat.branch = MAIN_BRANCH;
    expect(worldViolations(ctx).filter((v) => v.rule === 'INVARIANT 12')).toEqual([]);
  });
});

/** Belt and braces: the exported type is what the suites will destructure. */
export type _Person = Person;
