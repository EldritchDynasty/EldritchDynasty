import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { EndingId } from '@ed/schema';
import {
  ALL_ENDINGS, ENDING_JUDGEABLE_BATCH, verdictOver, type EndingPolicy, type EndingRun,
} from './tools/ending-gate.js';
import { recordOptionForPolicy, unmakingReadyForAscendant } from './tools/ladder-policy.js';
import { testWorld } from './testing.js';

/**
 * THE GATE THAT GRADES THE ENDINGS (issue #42, and issue #61's Stage D).
 *
 * A gate nobody has ever seen fail is indistinguishable from a gate that
 * cannot fail, and this one can never be shown its own failing case by the
 * real bundle: the state it exists to catch is *the shipped game could not be
 * lost*, which is a property of a distribution rather than of any content it
 * could be handed. So the judgement is a pure function over runs, and these
 * hand it both worlds.
 */

function run(ending: EndingId, seed: number, policy: EndingPolicy = 'chronicler'): EndingRun {
  return {
    seed, policy, ending, attested: 'adept', clauses: 8, survivors: 22, householdLow: 11, bloodLeft: 14, bloodLow: 6,
  };
}

/**
 * A batch shaped like #185's owner-approved split: Broken Line sits inside its
 * 22–45% band and Devoured below its 45% ceiling. Their historical pooled
 * catastrophe total is deliberately above 45%, proving that total is no
 * longer the thing the gate grades.
 */
function losable(n = 100): EndingRun[] {
  const out: EndingRun[] = [];
  const broken = Math.round(n * 0.30);
  const devoured = Math.round(n * 0.20);
  const unmade = Math.max(1, Math.round(n * 0.01));
  const apotheosis = Math.max(1, Math.round(n * 0.01));
  for (let i = 0; i < n; i++) {
    const id: EndingId = i < broken ? 'broken_line'
      : i < broken + devoured ? 'devoured'
        : i < broken + devoured + unmade ? 'unmade'
          : i < broken + devoured + unmade + apotheosis ? 'apotheosis'
            : 'forgotten';
    out.push(run(id, i));
  }
  return out;
}

/**
 * An `ascendant` batch with explicit intentional reach for God and Unmaking.
 * `takerShare` is the runs in which somebody took the Unmaking — the funnel
 * step #325 judges — and defaults to the 16% the CI batch measured.
 */
function ascendant(apotheosisShare: number, n = 100, unmadeShare = 0.01, takerShare = 0.16): EndingRun[] {
  const apo = Math.round(apotheosisShare * n);
  const unmade = Math.round(unmadeShare * n);
  const takers = Math.round(takerShare * n);
  return Array.from({ length: n }, (_, i) => ({
    ...run(i < apo ? 'apotheosis' : i < apo + unmade ? 'unmade' : 'forgotten', 9000 + i, 'ascendant'),
    unmakingTakers: i < takers ? 1 : 0,
  }));
}


describe('the ascendant composite policy', () => {
  it('spends the Record only at the final Respect wall', () => {
    const bundle = loadContent();
    const ctx = testWorld(bundle, 8132);

    // Before Eminent, the ordinary chronicler still owns the pen. The
    // ascendant policy only takes over where an embellishment can buy the
    // final tier the God gate needs.
    expect(recordOptionForPolicy(ctx, 'ascendant')).toBeUndefined();
    ctx.world.respect = 'regarded';
    expect(recordOptionForPolicy(ctx, 'ascendant')).toBeUndefined();
    ctx.world.respect = 'eminent';
    expect(recordOptionForPolicy(ctx, 'ascendant')).toBe('embellish');
    ctx.world.respect = 'exalted';
    expect(recordOptionForPolicy(ctx, 'ascendant')).toBe('record');

    // A successful Unmaking costs two Respect tiers before its Record block.
    // The composite policy deliberately does NOT force an embellishment from
    // Regarded: the measured version that did so created a total standing lie,
    // did not add a world-state God, and caused the creditor to withhold the
    // one God rung the 100-run batch had previously substantiated.
    const recipient = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.status === 'alive')!;
    recipient.rites.push('unmaking');
    ctx.world.respect = 'regarded';
    expect(recordOptionForPolicy(ctx, 'ascendant')).toBeUndefined();

    for (const policy of ['chronicler', 'climb', 'spare', 'scion', 'pair', 'pair_climb'] as const) {
      expect(recordOptionForPolicy(ctx, policy), policy).toBeUndefined();
    }
  });

  it('spends the Unmaking elder only after the fragile household working and standing are assembled', () => {
    const bundle = loadContent();
    const ctx = testWorld(bundle, 8133);
    const reader = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]!;
    reader.spellsKnown.push(...bundle.spellbooks.map((book) => book.id));

    // Reading alone is not preparation: the family's public standing is a
    // gate the rite itself will spend. The persistent Ledger is deliberately
    // NOT a precondition — the calibration policy preserves the living reading
    // circle first, then lets the book continue paying while a viable
    // post-Unmaking recipient can stand at Demigod without ageing.
    // The standing asked is the rite's own Eminent gate, not one above it
    // (#332: an Exalted pre-condition never met a ready circle in 100 runs).
    ctx.world.respect = 'regarded';
    expect(unmakingReadyForAscendant(ctx)).toBe(false);
    const clausesBefore = ctx.world.clausesRecovered.size;
    ctx.world.respect = 'eminent';
    expect(unmakingReadyForAscendant(ctx)).toBe(true);
    ctx.world.respect = 'exalted';
    expect(unmakingReadyForAscendant(ctx)).toBe(true);
    expect(ctx.world.clausesRecovered.size).toBe(clausesBefore);
  });
});

describe('the ending distribution gate', () => {
  it('passes a batch where the run is genuinely losable', () => {
    const v = verdictOver(losable());
    expect(v.ok, v.lines.join('\n')).toBe(true);
  });

  /**
   * THE STATE THIS ISSUE WAS FILED ABOUT, and the one the shipped game was in:
   * *"zero houses died out... every player-driven run finished with nine of
   * nine clauses... the simulation could not tell them apart."* Every house
   * arriving at the same place is the failure, whichever place it is.
   */
  it('fails a batch where every house arrives at the same place', () => {
    const v = verdictOver(Array.from({ length: 100 }, (_, i) => run('forgotten', i)));
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/below the floor/);
  });

  it('fails when Broken Line falls below its own loss band', () => {
    const runs = Array.from({ length: 200 }, (_, i): EndingRun => (
      i < 20 ? run('broken_line', i)
        : i < 60 ? run('devoured', i)
          : i === 60 ? run('apotheosis', i)
            : run('forgotten', i)
    ));
    const v = verdictOver(runs);
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/broken_line is too rare/);
  });

  it('fails when Broken Line rises above its own ceiling', () => {
    const runs = Array.from({ length: 100 }, (_, i): EndingRun => (
      i < 50 ? run('broken_line', i)
        : i < 70 ? run('devoured', i)
          : i === 70 ? run('apotheosis', i)
            : run('forgotten', i)
    ));
    const v = verdictOver(runs);
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/broken_line is too common/);
  });

  it('fails when Devoured dominates the chronicler column', () => {
    const runs = Array.from({ length: 100 }, (_, i): EndingRun => (
      i < 25 ? run('broken_line', i)
        : i < 71 ? run('devoured', i)
          : i === 71 ? run('apotheosis', i)
            : run('forgotten', i)
    ));
    const v = verdictOver(runs);
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/devoured is too common/);
  });

  it('does not fail merely because the old pooled catastrophe total is above 45%', () => {
    const v = verdictOver(losable());
    expect(v.ok, v.lines.join('\n')).toBe(true);
    expect(v.lines.join('\n')).toMatch(/pooled catastrophes .*diagnostic only/);
  });

  /**
   * §29's acceptance clause, which is why `forgotten` is counted separately
   * from the three catastrophes at all: the modest house has to lose too, and
   * differently. A gate that pooled them could not see this batch is wrong.
   */
  it('fails when the Forgotten stops being reachable', () => {
    // Hold both split loss guards inside their bands so Forgotten is the only
    // ordinary chronicler ending this fixture removes.
    const runs = Array.from({ length: 200 }, (_, i): EndingRun => (
      i < 60 ? run('broken_line', i)
        : i < 140 ? run('devoured', i)
          : run('apotheosis', i)
    ));
    const v = verdictOver(runs);
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/forgotten is below the floor/);
  });

  /**
   * A floor under God would be a gate demanding the rarest thing in the design
   * happen on schedule. §22 calls it the terminal outcome a family has to be
   * built for; a zero there is a finding, and this file is where that is said.
   */
  it('does not demand an apotheosis', () => {
    const runs = losable().map((r) => (r.ending === 'apotheosis' ? run('forgotten', r.seed) : r));
    const v = verdictOver(runs);
    expect(v.ok, v.lines.join('\n')).toBe(true);
    expect(v.lines.join('\n')).toMatch(/apotheosis\s+0/);
  });

  it('does not demand Unmade from the chronicler policy', () => {
    // Keep both split chronicler guards in range so this test isolates WHICH
    // intentional ending owns a floor.
    const runs = losable().map((r) => (r.ending === 'unmade' ? run('broken_line', r.seed) : r));
    const v = verdictOver(runs);
    expect(v.ok, v.lines.join('\n')).toBe(true);
    expect(v.lines.join('\n')).toMatch(/unmade\s+0/);
  });

  it('asserts nothing but validity on a batch too small to see a distribution', () => {
    const v = verdictOver(Array.from({ length: 12 }, (_, i) => run('forgotten', i)));
    expect(v.ok, 'a sub-judgeable batch must not pretend to grade a five-way split').toBe(true);
    expect(v.lines.join('\n')).toMatch(/cannot see a five-way distribution/);
  });

  it('starts judging at the same 100-run boundary CI uses', () => {
    const oneShort = verdictOver(
      Array.from({ length: ENDING_JUDGEABLE_BATCH - 1 }, (_, i) => run('forgotten', i)),
    );
    expect(oneShort.ok, oneShort.lines.join('\n')).toBe(true);
    expect(oneShort.lines.join('\n')).toMatch(/cannot see a five-way distribution/);

    const boundary = verdictOver(
      Array.from({ length: ENDING_JUDGEABLE_BATCH }, (_, i) => run('forgotten', i)),
    );
    expect(boundary.ok, 'the first judgeable batch must expose a collapsed ending distribution').toBe(false);
    expect(boundary.lines.join('\n')).toMatch(/below the floor|broken_line is too rare/);
  });

  it('reports when broken lines ended without turning the diagnostic into a rule', () => {
    let brokenIndex = 0;
    const runs = losable().map((r) => {
      if (r.ending !== 'broken_line') return r;
      const index = brokenIndex++;
      return {
        ...r,
        yearsPlayed: index % 2 === 0 ? 80 : 240,
        physicianStayed: index % 3 === 0,
        bottleneckYears: 3,
        bottleneckFillableYears: index % 2 === 0 ? 1 : 0,
        bottleneckPriorityYears: index % 4 === 0 ? 1 : 0,
        bottleneckPriorityDeals: index % 5 === 0 ? 1 : 0,
        bottleneckViableCoupleYears: index % 2 === 0 ? 2 : 0,
        bottleneckConceptionChances: index % 2 === 0 ? [0.1, 0.3] : [],
        bottleneckBirthAfterViable: index % 4 === 0,
        bottleneckFamilyCapYears: index % 3 === 0 ? 2 : 0,
        bottleneckOlderUnwedMaleYears: index % 4 === 0 ? 2 : 0,
        bottleneckMinorOnlyYears: index % 5 === 0 ? 2 : 0,
        bottleneckCadetOnlyYears: index % 6 === 0 ? 2 : 0,
        wardshipYears: index % 2 === 0 ? 4 : 0,
        bottleneckWardshipYears: index % 3 === 0 ? 1 : 0,
      };
    });
    const v = verdictOver(runs);
    expect(v.ok, v.lines.join('\n')).toBe(true);
    expect(v.lines.join('\n')).toMatch(/broken_line timing: 15\/30 inside first 150 years · median 240y/);
    expect(v.lines.join('\n')).toMatch(/physician ever reached 10\/30/);
    expect(v.lines.join('\n')).toMatch(
      /thin-line state among broken: 30\/30 entered 1-2 blood \(90y\).*15\/30 had a fillable recovery cast \(15y\).*priority armed 8\/30.*priority hand dealt 6\/30/,
    );
    expect(v.lines.join('\n')).toMatch(
      /thin-line alternatives among broken: viable couple 15\/30.*family cap reached 10\/30.*older unwed man 8\/30.*minors only 6\/30.*cadet-only blood 5\/30/,
    );
    expect(v.lines.join('\n')).toMatch(
      /viable-couple exposure among broken: 30y across 15\/30 runs.*mean 20\.0% median 20\.0% range 10\.0-30\.0%.*later blood birth 8\/15/,
    );
    expect(v.lines.join('\n')).toMatch(
      /unbought wardship: 15\/100 chronicler runs.*15\/30 broken lines.*overlapped 1-2 blood in 10\/30/,
    );
  });

  /**
   * #61 established the ascendant denominator and the owner's 29% ceiling.
   * #133 then halved the complete campaign and explicitly changed Stage 5F's
   * lower acceptance to non-zero intentional reach. The relative comparison
   * against the chronicler is the lower guard: it rejects zero without fitting
   * a new tiny percentage threshold to one noisy 500-year batch.
   */
  describe('the ascendant column (issues #61 and #133)', () => {
    it('passes when intentional play reaches the Unmaking measurably more than the chronicler', () => {
      const chronicler = losable().map((r) =>
        r.ending === 'apotheosis' ? run('forgotten', r.seed) : r);
      const v = verdictOver([...chronicler, ...ascendant(0.01)]);
      expect(v.ok, v.lines.join('\n')).toBe(true);
      expect(v.lines.join('\n')).toMatch(/ascendant .*100 runs.*apotheosis 1 \(1\.0%\)/);
      expect(v.lines.join('\n')).toMatch(/ladder funnel: a house took the Unmaking in 16\/100/);
    });

    /**
     * #325, the owner's choice (c). Zero Apotheoses in 100 used to fail the
     * gate, and at a true rate near 1% a re-rolled batch shows zero about a
     * third of the time. The claim is carried by the Unmaking now; Apotheosis
     * against the chronicler is printed and not judged.
     */
    it('no longer turns on one Apotheosis: zero of them passes when the funnel carries the claim', () => {
      const chronicler = losable().map((r) =>
        r.ending === 'apotheosis' ? run('forgotten', r.seed) : r);
      const v = verdictOver([...chronicler, ...ascendant(0)]);
      expect(v.ok, v.lines.join('\n')).toBe(true);
      expect(v.lines.join('\n')).toMatch(/ladder diagnostic \(not judged, #325\): apotheosis 0\/100/);
    });

    /**
     * The owner's 8% floor (#332) is reported, never judged, while the game is
     * pre-production: a batch below it passes, and says so.
     */
    it('reports the owner\'s 8% floor without failing on it', () => {
      const chronicler = losable().map((r) =>
        r.ending === 'apotheosis' ? run('forgotten', r.seed) : r);
      const below = verdictOver([...chronicler, ...ascendant(0.01)]);
      expect(below.ok, below.lines.join('\n')).toBe(true);
      expect(below.lines.join('\n')).toMatch(/1\.0% is BELOW the 8% floor — reported, not judged/);
      const inside = verdictOver([...chronicler, ...ascendant(0.12)]);
      expect(inside.ok, inside.lines.join('\n')).toBe(true);
      expect(inside.lines.join('\n')).toMatch(/12\.0% is inside the 8–29% band/);
    });

    it('fails when intentional play never reaches Unmade', () => {
      const chronicler = losable().map((r) =>
        r.ending === 'apotheosis' ? run('forgotten', r.seed) : r);
      const v = verdictOver([...chronicler, ...ascendant(0.01, 100, 0)]);
      expect(v.ok).toBe(false);
      expect(v.lines.join('\n')).toMatch(/unmade is below the ascendant floor/);
    });

    it('fails when ascendant clears the 29% ceiling', () => {
      const v = verdictOver([...losable(), ...ascendant(0.35)]);
      expect(v.ok).toBe(false);
      expect(v.lines.join('\n')).toMatch(/apotheosis is above the ascendant ceiling/);
    });

    /**
     * THE STATE THIS HALF OF THE ISSUE WAS FILED ABOUT: a house that never
     * tries for the ladder getting as far as one that does, which would mean
     * the whole Scion/marriage/library mechanism buys nothing. Judged at the
     * Unmaking since #325; an ascendant column that reaches it no more often
     * than the chronicler fails, whatever its Apotheosis count.
     */
    it('fails when intentional play reaches the Unmaking no more often than the chronicler', () => {
      const chronicler = losable().map((r) => ({ ...r, unmakingTakers: r.seed < 16 ? 1 : 0 }));
      const v = verdictOver([...chronicler, ...ascendant(0.05)]);
      expect(v.ok).toBe(false);
      expect(v.lines.join('\n')).toMatch(/trying for the ladder does not measurably reach the Unmaking/);
    });

    it('fails when intentional play never takes the Unmaking at all', () => {
      const v = verdictOver([...losable(), ...ascendant(0.01, 100, 0.01, 0)]);
      expect(v.ok).toBe(false);
      expect(v.lines.join('\n')).toMatch(/does not measurably reach the Unmaking/);
    });

    it('asserts nothing about apotheosis when the ascendant batch is too small', () => {
      const v = verdictOver([...losable(), ...ascendant(0.01, 12)]);
      expect(v.ok, v.lines.join('\n')).toBe(true);
      expect(v.lines.join('\n')).toMatch(/ascendant runs cannot see whether apotheosis is reachable/);
    });

    it('reports zero ascendant runs rather than silently skipping the check', () => {
      const v = verdictOver(losable());
      expect(v.lines.join('\n')).toMatch(/ascendant \(playing for the ladder\): 0 runs — none supplied/);
    });
  });

  it('prints every authored ending, so a zero is visible rather than absent', () => {
    const text = verdictOver(losable()).lines.join('\n');
    for (const id of ALL_ENDINGS) expect(text).toContain(id);
  });
});
