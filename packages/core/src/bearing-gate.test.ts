import { describe, expect, it } from 'vitest';
import {
  SPREAD_FLOOR, SPREAD_MIN_RUNS, campaignForYears, verdictOver, type BearingRun, type Carriage,
} from './tools/bearing-gate.js';
import { campaignDef } from './campaign.js';

/**
 * ISSUE #45'S ACCEPTANCE, AS A JUDGMENT.
 *
 * `gate:bearing` plays a campaign-sized batch and then makes one reading over
 * it: does the house the world remembers as carrying itself climb higher
 * than the house that kept its head down? Playing that batch is a
 * half-hour instrument, and none of it is what could go wrong with the
 * reading — so the reading is a function over runs, and this hands it two
 * distributions it must tell apart.
 *
 * That split is the whole reason `verdictOver` exists. A gate nobody has
 * watched fail is indistinguishable from a gate that cannot fail, and the
 * ladder gate's trick — hand it a declawed bundle — is not available here:
 * bearing's consequence lives in `marketAppetite`, in the engine, so there is
 * no authored charge to take away.
 */

let n = 0;

/**
 * One synthetic run. Only two of its fields are the subject — how the world
 * came to read the house, and how far up the ladder it got — and the rest are
 * plausible constants, because the reading under test is a comparison of those
 * two across bins and nothing else in the row can move it.
 */
function run(
  carriage: Carriage,
  meanCarriage: number,
  bestRungIndex: number,
  /**
   * What the book could hold up. Defaults to what the house achieved, which
   * is the honest house: for a record nobody has to discount, the ladder and
   * the outcome are the same number.
   */
  substantiatedRungIndex = bestRungIndex,
): BearingRun {
  n += 1;
  return {
    seed: 4000 + n,
    carriage,
    peakCarriage: meanCarriage,
    meanCarriage,
    finalCarriage: meanCarriage,
    handsDealt: 40,
    cardsPerHand: 2.5,
    handsDeclined: 10,
    cousinsTaken: 5,
    bestRung: 'adept',
    bestRungIndex,
    attestedRungIndex: bestRungIndex,
    substantiatedRungIndex,
    rungsWithheld: bestRungIndex - substantiatedRungIndex,
    unsupportable: (bestRungIndex - substantiatedRungIndex) * 18,
    pages: 120,
    recorded: 24,
    embellished: 6,
    ending: substantiatedRungIndex >= 3 ? 'devoured' : 'forgotten',
    warningsHeard: 2,
    warningsWithheld: 2,
    respectTierIndex: 3,
    clausesRecovered: 8,
    householdAtEnd: 60,
    regencyYears: 0,
  };
}

/** Nine runs across the whole bearing range, with the rung set by the caller. */
function batch(rungAt: (meanCarriage: number) => number): BearingRun[] {
  const carriages: Carriage[] = ['unattended', 'modest', 'proud'];
  return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    .map((meanCarriage, i) => run(carriages[i % 3]!, meanCarriage, rungAt(meanCarriage)));
}

describe('the bearing gate', () => {
  it('uses the real shipped campaign profile at each shipped term', () => {
    expect(campaignForYears(campaignDef('short').years)).toBe('short');
    expect(campaignForYears(campaignDef('long').years)).toBe('long');
    expect(campaignForYears(123), 'an arbitrary diagnostic length keeps the historical default').toBe('long');
  });

  /**
   * THE COLUMN THE SPREAD CLAUSE IS READ OFF.
   *
   * §29.7 asks for higher variance IN OUTCOME, and this gate reported that
   * spread off `bestRungIndex` — the ladder, out of `world.ascension`, which
   * the last night never consults. §29.3's third bite moves what a house can
   * PROVE and by construction leaves what it achieved alone, so the column was
   * incapable of moving however hard the mechanism bit. Two conclusions were
   * published off it before anybody noticed.
   *
   * So: two batches that agree on every rung the houses reached and differ
   * only in what their books could hold up. An instrument reading the ladder
   * prints the same line twice.
   *
   * The discounted batch is shaped as a TAIL rather than as a uniform drop,
   * because that is the shape the mechanism actually has — it charges a rung
   * to some proud houses and not to others — and because a bin whose runs all
   * carry the same number has no variance to report either way. The first cut
   * of this test dropped the whole top bin to the same rung and printed
   * +0.00 twice, which is a fixture that cannot fail rather than a gate that
   * cannot see.
   */
  it('reads the spread off what the house could prove, not off what it reached', () => {
    const carriages: Carriage[] = ['unattended', 'modest', 'proud'];
    // Twelve runs, four to a bin, every one of them reaching the third rung.
    const make = (proved: (i: number) => number) =>
      Array.from({ length: 12 }, (_, i) => run(carriages[i % 3]!, 0.05 * (i + 1), 3, proved(i)));

    const honest = verdictOver(make(() => 3));
    // The top bin is indices 8-11: two houses show it and two cannot.
    const discounted = verdictOver(make((i) => (i >= 10 ? 1 : 3)));

    const spreadOf = (v: { lines: string[] }) => v.lines.find((l) => l.includes('spread IN OUTCOME'));
    expect(spreadOf(honest), 'the spread in outcome is not reported at all').toBeTruthy();
    expect(
      spreadOf(discounted),
      'the same ladder with a different reading printed the same spread — the column the'
      + ' acceptance is judged on cannot see what the last night does',
    ).not.toBe(spreadOf(honest));

    // And the ladder half is untouched in both, which is the point: rule 2 is
    // judged on what the house climbed, and it climbed the same either way.
    expect(honest.ok).toBe(discounted.ok);
  });

  it('passes a game where the house that carried itself climbed higher', () => {
    // §29 rule 2: pride must usually be CORRECT. Two rungs at the bottom of
    // the range, three at the top.
    const { ok, lines } = verdictOver(batch((c) => (c > 0.6 ? 3 : 2)));
    expect(ok, lines.join('\n')).toBe(true);
  });

  it('fails a game where carrying itself only ever costs the house', () => {
    // The failure the issue names in as many words: *if they are simply
    // worse, this is a difficulty setting and players will play around it
    // rather than feel it.*
    const { ok, lines } = verdictOver(batch((c) => (c > 0.6 ? 1 : 3)));
    expect(ok, `the gate passed a game where pride is a tax:\n${lines.join('\n')}`).toBe(false);
  });

  it('fails a game where the carriage changes nothing at all', () => {
    // Flat is not a moral either. It is a system the player cannot feel, which
    // is what §29 was written to avoid.
    const { ok } = verdictOver(batch(() => 2));
    expect(ok).toBe(false);
  });

  /**
   * THE SPREAD IS NOW JUDGED (issue #76), AND THE ASSERTION THAT SAID
   * OTHERWISE IS RETIRED RATHER THAN REWORDED.
   *
   * This test used to end by proving the verdict IGNORED the spread — a batch
   * whose proud houses could not show a thing passed, because the verdict was
   * rule 2 and rule 2 is about the ladder. That was correct for as long as two
   * seed sets were all anybody had. Closing #76 is exactly the event it was
   * describing, so it goes; an assertion kept alive past the thing it was
   * about is how a test starts describing a game nobody is playing.
   *
   * What survives is the half that is still true and still load-bearing: below
   * `SPREAD_MIN_RUNS` the line is printed and says it is not judged, because a
   * distribution statistic at a dozen runs is noise wearing a threshold.
   */
  it('prints the spread unjudged on a batch too small to carry the claim', () => {
    const climbs = (c: number) => (c > 0.6 ? 3 : 2);
    const small = batch(climbs);
    expect(small.length).toBeLessThan(SPREAD_MIN_RUNS);

    const { ok, lines } = verdictOver(small);
    const line = lines.find((l) => l.includes('spread IN OUTCOME'));
    expect(line, 'the second half of the acceptance is not reported at all').toBeTruthy();
    expect(line, 'a nine-run batch is presented as if it had judged something')
      .toMatch(/NOT judged/);
    // Nine runs, both bins flat, spread exactly +0.00 — and it still passes,
    // because at this size the number is not a claim.
    expect(ok, lines.join('\n')).toBe(true);
  });

  /**
   * AND THE DISTRIBUTION IT MUST REJECT. A gate nobody has watched fail is
   * indistinguishable from a gate that cannot fail, and this is the one #76
   * names: a game where the house that carried itself arrives no more
   * variously than the house that kept its head down.
   *
   * Both games climb identically — the proud houses reach the third rung in
   * each — so rule 2 passes in both and the only thing separating them is
   * width. That isolation is the point: it fails on the spread or it fails on
   * nothing.
   */
  describe(`the spread floor, at ${SPREAD_MIN_RUNS} runs`, () => {
    const carriages: Carriage[] = ['unattended', 'modest', 'proud'];

    /**
     * A batch big enough to be judged, with the top bin's width in the
     * caller's hands.
     *
     * RULE 2 IS SATISFIED IN EVERY ONE OF THESE ON PURPOSE — the proud houses
     * reach a rung the quiet ones do not — so the verdict turns on width and
     * nothing else. The first cut gave every run the same rung and all three
     * cases failed identically, on the average rather than the spread, which
     * is a fixture that cannot tell you what it caught.
     */
    const sized = (proved: (i: number, top: boolean) => number) =>
      Array.from({ length: SPREAD_MIN_RUNS }, (_, i) => {
        const top = i >= SPREAD_MIN_RUNS - SPREAD_MIN_RUNS / 3;
        return run(carriages[i % 3]!, (i + 1) / (SPREAD_MIN_RUNS + 1), top ? 3 : 2, proved(i, top));
      });

    it('fails a game where the top bin is no wider than the bottom', () => {
      // Every house proves exactly what it reached, everywhere. Both bins are
      // flat, so the spread is exactly 0.00 against a floor of 0.00 — which
      // turns on the comparison being STRICT. It was written `>=` first and
      // this case passed: "no wider than the bottom" is the failure §29.7
      // names, and equal width is no wider.
      const flat = sized((_i, top) => (top ? 3 : 2));
      const { ok, lines } = verdictOver(flat);
      expect(ok, `the gate passed a game with no spread at all:\n${lines.join('\n')}`).toBe(false);
      expect(lines.some((l) => l.includes('no more VARIOUSLY'))).toBe(true);
    });

    it('fails a game where the QUIET house is the various one', () => {
      // The inversion, which a floor of zero has to catch and an "is it
      // positive" eyeball does not: the bottom bin is the one that cannot
      // prove what it reached.
      const inverted = sized((i, top) => (!top && i % 4 === 0 ? 0 : top ? 3 : 2));
      expect(verdictOver(inverted).ok).toBe(false);
    });

    it('passes a game where the proud house arrives more variously', () => {
      // The shape the mechanism actually has: a TAIL on the proud house — it
      // charges a rung to some of them and not others — rather than a uniform
      // drop, which would move the mean and leave the width alone.
      const tail = sized((i, top) => (top && i % 4 === 0 ? 0 : top ? 3 : 2));
      const { ok, lines } = verdictOver(tail);
      expect(ok, lines.join('\n')).toBe(true);
      expect(lines.some((l) => l.includes('JUDGED')), 'a full-size batch was not judged').toBe(true);
    });

    /**
     * And the floor is the one the constant names. A test that hard-coded 0
     * would keep passing after somebody raised `SPREAD_FLOOR` and stop meaning
     * anything, which is how the last four thresholds in this repo went bad.
     */
    it('is the floor the constant declares', () => {
      expect(SPREAD_FLOOR).toBeGreaterThanOrEqual(0);
      expect(SPREAD_MIN_RUNS % 3, 'the bins are thirds; a batch that does not divide is a ragged bin')
        .toBe(0);
    });
  });
});
