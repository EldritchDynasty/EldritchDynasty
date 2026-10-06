import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  activeCommitment, addOfficer, beginCommitment, bootstrap, closeTheLedger, digestOf, emptyReport,
  END_YEAR, expectHealthyWorld, livingBlood, loadGame, outcomeKey, outcomeReach, reinforceCommitment,
  runYears, saveGame, setPosition, streamFor, testRng, tickMuster, YEAR_PHASES,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();

/**
 * ISSUE #95's ACCEPTANCE, PLAYED RATHER THAN ASSERTED IN THE ABSTRACT.
 *
 * `muster.test.ts` proves each function does what its name says in
 * isolation; this file proves two things only a played world can: a live
 * commitment is exactly as save-durable as everything else on `WorldState`
 * (invariant "a field on the world must reach the save format" — the
 * failure mode is a field that resets silently, which looks identical to a
 * working save until a player two centuries in loses the war they were
 * fighting), and a commitment left standing for a full run — the honest
 * state of the world before #97 wires a settlement event to end one — never
 * drives the house negative on men or extinct on people.
 */
describe('a live commitment survives being written down', () => {
  it('round-trips every field a player could have set — men, officers, position, credit, tide', () => {
    const before = bootstrap(bundle, 1042, 1042);
    const officerA = before.world.people.household(before.world.playerHouse, before.world.year)[0]!;

    const c = beginCommitment(before, 5, 'the_wars');
    reinforceCommitment(before, 3, 'branch_a');
    addOfficer(before, officerA.id);
    setPosition(before, 'a_captaincy');
    tickMuster(before, testRng('muster-save')); // moves the tide and accrues credit off zero
    before.world.muster.tide = 63;

    expect(c.men).toBeGreaterThan(0);
    expect(c.credit).toBeGreaterThan(0);

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), bundle);
    const restored = activeCommitment(after);

    expect(restored).toBeDefined();
    expect(restored!.id).toBe(c.id);
    expect(restored!.men).toBe(c.men);
    expect(restored!.officers).toEqual(c.officers);
    expect(restored!.position).toBe(c.position);
    expect(restored!.credit).toBe(c.credit);
    expect(restored!.from).toEqual(c.from);
    expect(after.world.muster.tide).toBe(before.world.muster.tide);
  });

  it('round-trips the tide and lastSettled with no commitment standing, too', () => {
    const before = bootstrap(bundle, 909, 1042);
    before.world.muster.tide = 71;
    beginCommitment(before, 5, 'the_wars');
    const c = activeCommitment(before)!;
    c.status = 'settled';
    before.world.muster.lastSettled = before.world.year;

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), bundle);

    expect(activeCommitment(after)).toBeUndefined();
    expect(after.world.muster.tide).toBe(71);
    expect(after.world.muster.lastSettled).toBe(before.world.year);
    expect(after.world.muster.commitments[0]!.status).toBe('settled');
  });
});

/**
 * A COMMITMENT NOBODY EVER SETTLES IS THE HONEST CASE UNTIL #97.
 *
 * `the_settlement` (`arc_the_muster`'s own docketed event) is what will
 * eventually close one out; wiring it to the `muster` effect is Stage 3, not
 * this issue. So the state this issue actually ships a house into, for the
 * whole of a played run, is a war that never ends — and that has to be safe:
 * men never negative, upkeep never a term that empties the treasury into
 * something else breaking, and officer mortality — small per invariant 2's
 * neighbourly `careerMortality` term, real all the same — never enough on
 * its own to take a house to zero.
 */
describe('a commitment left standing for a whole run', () => {
  const SEEDS = [1042, 2201, 3311, 4455, 5566];

  it('never runs men negative, and leaves the world internally coherent at the Long-Line term', () => {
    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      const founders = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
      const c = beginCommitment(ctx, 10, 'the_wars');
      for (const p of founders.slice(0, 2)) addOfficer(ctx, p.id);

      let minMen = c.men;
      // THE TERM, OR THE LINE RUNNING OUT BEFORE IT (issue #42). A war left
      // standing forever is real pressure on the house, so this policy can
      // now legitimately end the line before the term — `ctx.world.ending` stops
      // the loop the same way it already stops `stepYear` itself, rather
      // than spinning on a year that will never move again.
      while (ctx.world.year < END_YEAR && !ctx.world.ending) {
        runYears(ctx, 1);
        minMen = Math.min(minMen, c.men);
      }

      expect(minMen, `seed ${seed}: men went negative`).toBeGreaterThanOrEqual(0);
      // Reached the term, or the line broke first and the book closed —
      // either is a coherent way for the loop to have stopped.
      expect(ctx.world.year === END_YEAR || Boolean(ctx.world.ending),
        `seed ${seed}: stopped at ${ctx.world.year} with no ending set`).toBe(true);
      expectHealthyWorld(ctx);
    }
  });

  it('does not, on its own, take the player house extinct', () => {
    let alive = 0;
    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      const founders = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
      beginCommitment(ctx, 10, 'the_wars');
      for (const p of founders.slice(0, 2)) addOfficer(ctx, p.id);

      runYears(ctx, END_YEAR - ctx.world.year);

      if (ctx.world.people.household(ctx.world.playerHouse, END_YEAR).length > 0) alive += 1;
    }
    expect(alive, `houses alive at ${END_YEAR} out of ${SEEDS.length}`).toBeGreaterThan(SEEDS.length / 2);
  });
});

/**
 * ISSUE #97's OWN ACCEPTANCE, THROUGH CONTENT RATHER THAN THROUGH THE BARE
 * FUNCTIONS: "harness shows all four positions actually bought across a
 * batch — including `none`, which is a choice and not an absence" and "a
 * settlement with no position and a settlement with a banner produce
 * visibly different Record blocks."
 *
 * `outcomeReach` is the existing instrument for exactly this question — the
 * same one `gateVocabularyReach`/gate 8 use — read off `world.decisionLog`
 * over a real played batch, not asserted by calling `buyPosition` directly.
 *
 * The two requires-gated position choices are no longer proved by hoping they
 * occur in a finite campaign sample. #442 gives both `buy_the_captaincy` and
 * `buy_the_banner` deterministic execution witnesses through the real Muster
 * arc, cast, requirement and commit paths. That is the right reachability
 * evidence for rare gated branches.
 *
 * Keep this played batch for the two ungated choices and the settlement fork:
 * they are common occurrence evidence at the original 80-run scale, not a
 * substitute for the deterministic witness seam.
 */
describe('the content reaches its positions, and both settlements', () => {
  const POSITION_RUNS = 80;
  const SETTLEMENT_RUNS = 80;
  const YEARS = CAMPAIGN_YEARS;

  it('the ungated position choices resolve across a played batch', () => {
    const reach = outcomeReach(bundle, POSITION_RUNS, YEARS);
    const choices: [string, string][] = [
      ['buy_the_serjeanty', 'bought_serjeanty'],
      ['buy_nothing', 'bought_nothing'],
    ];
    const unreached = choices.filter(([choiceId, outcomeId]) => (
      !reach.runs.has(outcomeKey('the_position_offered', choiceId, outcomeId))
    ));
    expect(unreached, `never bought in ${POSITION_RUNS} runs x ${YEARS}y: ${unreached.map((c) => c[0]).join(', ')}`)
      .toEqual([]);
  });

  it('both the honest settlement and the with-a-banner settlement resolve', () => {
    const reach = outcomeReach(bundle, SETTLEMENT_RUNS, YEARS);
    const noBanner = reach.runs.has(outcomeKey('the_settlement', 'count_the_cost', 'counted'))
      || reach.runs.has(outcomeKey('the_settlement', 'take_what_is_owed', 'taken'));
    const withBanner = reach.runs.has(outcomeKey('the_settlement_with_banner', 'write_it_plain', 'written_plain'))
      || reach.runs.has(outcomeKey('the_settlement_with_banner', 'make_it_noticed', 'made_noticed'));
    expect(noBanner, 'the_settlement (no position bought) never resolved').toBe(true);
    expect(withBanner, 'the_settlement_with_banner (a position bought) never resolved').toBe(true);
  });
});

/**
 * THE DORMANCY GUARD, AS A STANDING ASSERTION (issue #89's closing item 3).
 *
 * The `muster` phase's own comment in `year/phases.ts` states the mechanism:
 * fully dormant with no commitment standing — no draw, no write, no
 * chronicle line — "the free regression test: a run that never musters must
 * digest bit-identical to one that never had this phase at all." Until now
 * that claim was only ever checked by hand, once, with `npm run digest`
 * against a git revert (`docs/BALANCE-LOG.md`, Muster stage 2). A revert is
 * not a regression test — it proves the claim held on one day, against one
 * tree, and nothing runs it again.
 *
 * `stepYearExcluding` below is `year/step.ts`'s own four-line `stepYear`,
 * copied rather than imported, with one phase filtered out of the loop. It
 * is deliberately NOT a production code change — `stepYear` stays hardcoded
 * to `YEAR_PHASES`, per that file's own comment that a year's shape lives in
 * `phases.ts` as a table, not behind a parameter every caller has to thread
 * through. This is the test-only mirror `war-gate.test.ts` and
 * `bearing-gate.test.ts` already use for the same reason: the real work
 * (`phase.run`) is the game's own code, unmodified; only the loop that walks
 * the table is duplicated, here, once.
 */
function stepYearExcluding(ctx: SimCtx, exclude: ReadonlySet<string>): void {
  const w = ctx.world;
  if (w.pendingDecisions.length) return;
  if (w.year >= END_YEAR || livingBlood(w) === 0) {
    closeTheLedger(ctx);
    return;
  }
  w.year += 1;
  const report = emptyReport(w.year);
  for (const p of YEAR_PHASES) {
    if (exclude.has(p.name)) continue;
    p.run({
      ctx, rng: streamFor(w, p.name), report, autoResolve: true,
    });
  }
}

function runYearsExcluding(ctx: SimCtx, n: number, exclude: ReadonlySet<string>): void {
  for (let i = 0; i < n; i++) stepYearExcluding(ctx, exclude);
}

describe('the dormancy guard, played rather than reverted', () => {
  /**
   * The invariant is about a dormant PHASE, not about preserving a lucky set
   * of campaign seeds. #344 already re-rolled two hand-picked peacetime seeds;
   * #519 re-rolled another. Re-seed-mining would only reset that clock.
   *
   * `the_muster_is_called` documents itself as the front door to the whole
   * system. Remove exactly that event from an otherwise shipped content bundle,
   * then play the same 400-year worlds through every ordinary phase. The first
   * assertion proves the fixture really remained commitment-free; the second
   * compares those played worlds with only the yearly `muster` phase omitted.
   * Any write or RNG consumption by a supposedly dormant phase still changes
   * the digest, but unrelated content can no longer invalidate the fixture.
   */
  const DORMANT_BUNDLE = {
    ...bundle,
    events: bundle.events.filter((event) => String(event.id) !== 'the_muster_is_called'),
  };
  const DORMANCY_SEEDS = Array.from({ length: 8 }, (_, i) => 6000 + i * 7);
  const YEARS = 400;

  it('never begins a commitment when the Muster front door is disabled', () => {
    for (const seed of DORMANCY_SEEDS) {
      const ctx = bootstrap(DORMANT_BUNDLE, seed, 1042);
      runYears(ctx, YEARS);
      expect(ctx.world.muster.commitments.length, `seed ${seed}: dormant fixture began a commitment`).toBe(0);
    }
  });

  it('digests bit-identical with the dormant muster phase present or removed entirely', () => {
    for (const seed of DORMANCY_SEEDS) {
      const withMuster = bootstrap(DORMANT_BUNDLE, seed, 1042);
      runYears(withMuster, YEARS);

      const withoutMuster = bootstrap(DORMANT_BUNDLE, seed, 1042);
      runYearsExcluding(withoutMuster, YEARS, new Set(['muster']));

      expect(digestOf(withoutMuster), `seed ${seed}: removing the dormant muster phase changed the run`)
        .toBe(digestOf(withMuster));
    }
  });
});
