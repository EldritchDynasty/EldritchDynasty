import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, isLadderRole, type Rung } from '@ed/schema';
import { bootstrap, clearNamingQueue } from './sim.js';
import { stepYear } from './year/step.js';
import { makeRng, hashSeed } from './rng.js';
import {
  autoResolveAll, resolveChoice, type PendingChoice,
} from './events/decisions.js';
import { RUNGS, rungIndex, standingOf } from './ascension.js';
import { phenotypeOf } from './people/factory.js';
import { soleCast } from './events/fill.js';
import { END_YEAR } from './ending.js';
import { CAMPAIGN_YEARS } from './campaign.js';
import { playToTheEnd } from './tools/ending-gate.js';

/**
 * DOES THE RITE HAPPEN, AND DOES IT BUY THE RUNG? (issue #43)
 *
 * Everything in `rites.test.ts` is about the verb and is built by hand in a
 * millisecond. This file is about the other half of the question, which no
 * hand-built world can answer: whether a house playing a Long Line is
 * ever ASKED, and whether answering moves the ladder.
 *
 * It has to be a played batch. `runYears` lets the chronicler answer, and the
 * chronicler taking the largest decision in the game at random is not the
 * question — the question is what a player who says yes gets that a player who
 * says no does not. So the docket is parked and one policy answers the rite,
 * exactly as `gate:blood` and `gate:ladder` do, and the two columns differ by
 * one verb.
 *
 * The measurement this was written against — the twelve seeds below, and the
 * same shape over twenty:
 *
 *                offered   taken   best >= hierophant   best >= vessel
 *   take (12)       6        6           4 of 12            2 of 12
 *   refuse (12)     9        0           4 of 12            0 of 12
 *   take (20)       7        7           6 of 20            2 of 20
 *   refuse (20)    12        0           6 of 20            0 of 20
 *   take (24)       8        8           7 of 24            1 of 24
 *   refuse (24)     8        0           7 of 24            0 of 24
 *
 * Note the shape rather than the numbers. Six runs in twenty ever stand a man
 * at Hierophant, and the rite was offered in every one of them — the CAST is
 * what rations this event, not its tier, which is the argument written at the
 * top of `events/rites.yaml`. A third of the houses that get that far take the
 * fourth rung, which is §22's "the rung nobody expects" behaving like one.
 *
 * The refusing column is offered the rite MORE often, and that is not noise:
 * a house that takes it gets a man carrying blood he cannot hold, who dies
 * sooner, which is fewer Hierophant-years left to be asked in.
 */

const content = indexContent(loadContent());

/** Twelve seeds, spaced like every other batch in this repo. */
const SEEDS = Array.from({ length: 12 }, (_, i) => 4000 + i * 13);

interface RiteRun {
  offered: number;
  taken: number;
  best: Rung;
  /** Every ascendant the rite was offered to, and where he stood when it was. */
  castAt: Rung[];
  vesselYears: number;
  /** People of the house, living or archived, who took the Vessel rite. */
  riteHolders: number;
}

function play(seed: number, policy: 'take' | 'refuse'): RiteRun {
  const ctx = bootstrap(content, seed, 1042);
  const w = ctx.world;
  // The one standing order both columns share: without it the auction never
  // spends and the columns separate on the shelf rather than on the rite.
  w.bidCeiling = 600;

  const out: RiteRun = { offered: 0, taken: 0, best: 'none', castAt: [], vesselYears: 0, riteHolders: 0 };
  /** The best rung each man of the house has ever stood on. See the loop below. */
  const highWater = new Map<string, number>();

  for (let y = 0; y < CAMPAIGN_YEARS; y++) {
    if (w.year >= END_YEAR) break;
    stepYear(ctx, false);

    // THE HIGH-WATER OF EVERY MAN OF THE HOUSE, kept year by year, because the
    // rung a man stands on is not stable across a single year and the cast is.
    //
    // This used to read his rung at the moment the Vessel docket was ANSWERED,
    // which was the same instant as the offer until the Great Rite existed.
    // That rite charges its toll to the same `foremost` man, and a toll that
    // pushes him past his own `mind` costs him a rung — so a man cast as a
    // Hierophant could be read, later in the same year, as the Adept the rite
    // had supposedly been offered to. Reading it earlier in the loop does not
    // fix it either: an auto-resolving ladder scene can charge him inside
    // `stepYear`, before anything here gets to look at all.
    //
    // So what is asserted is what the sentence in the test's name actually
    // means, and what the ration in `rites.yaml` actually does: the rite is
    // offered to a man WHO HAS CLIMBED to Hierophant. That still fails loudly
    // on the regression this exists for — the old mythic version cast men who
    // had never been anything, at rung `none` with power 6.7 — and it no
    // longer fails on a man being charged for one rite while holding another.
    for (const p of w.people.household(w.playerHouse, w.year)) {
      const now = rungIndex(standingOf(ctx, p).rung);
      if (now > (highWater.get(p.id) ?? -1)) highWater.set(p.id, now);
    }

    for (const d of w.pendingDecisions) {
      if (d.kind !== 'choice' || d.event.id !== 'the_vessel_rite') continue;
      const asked = w.people.get(soleCast(d.fill, 'ASCENDANT') ?? '');
      if (!asked) continue;
      const peak = Math.max(highWater.get(asked.id) ?? -1, rungIndex(standingOf(ctx, asked).rung));
      out.castAt.push(RUNGS[peak] ?? 'none');
    }

    let guard = 0;
    while (w.pendingDecisions.length && guard++ < 200) {
      const rng = makeRng(hashSeed(seed, 'rite-batch', w.year, guard));
      // A door to the rite is answered FIRST, whatever else is on the docket.
      // Taking whichever choice happened to be first meant a year with two
      // decisions sent the Vessel to `autoResolveAll` below, which took it at
      // random — and the refusing column carried the rite it had refused
      // (#1834: seed 4000, `the_second_name` in 1188, behind a second scene).
      const choices = w.pendingDecisions.filter((d): d is PendingChoice => d.kind === 'choice');
      const pending = choices.find(offersTheVessel) ?? choices[0];

      if (pending && offersTheVessel(pending)) {
        out.offered += 1;

        // §22: named, chosen by the player from the tree. A player chasing the
        // rung names the deepest carrier standing in front of him, which is
        // also the family's vault — that is the bargain, not an oversight.
        let named: string | undefined;
        let deepest = -1;
        for (const c of pending.cast.find((r) => r.slot === 'VESSEL')?.candidates ?? []) {
          const q = w.people.get(c.id);
          if (!q) continue;
          const font = phenotypeOf(q, ctx.genetics, w.year).eldritch.carriedFont;
          if (font > deepest) { deepest = font; named = c.id; }
        }

        // BY EFFECT, NOT BY ID. `the_vessel_rite` was the only door to
        // `rite: vessel` when this was written; `the_second_name` is a second
        // one (issue #61, Stage E5), and naming choice ids meant the refusing
        // column refused one door and wandered through the other. What the
        // test's own name claims is about the RITE, so the policy is too.
        const doors = grantingChoices(pending);
        const wanted = policy === 'take'
          ? doors[0]
          : pending.choices.find((c) => c.available && !doors.includes(c.id))?.id;
        const res = wanted
          ? resolveChoice(ctx, pending.id, wanted, rng, named ? { VESSEL: named } : {})
          : { ok: false };
        if (res.ok && policy === 'take') out.taken += 1;
        if (res.ok) continue;
      }

      // The climbing policy for everything else, so both columns arrive at the
      // Hierophant gate the same way: `gate:ladder`'s own rule, which is what
      // gets a man high enough to be asked at all.
      if (pending?.choicesAreOpen) {
        const costly = pending.choices.filter((c) => c.available && charges(pending, c.id));
        if (costly[0] && resolveChoice(ctx, pending.id, costly[0].id, rng).ok) continue;
      }
      autoResolveAll(ctx, rng);
    }
    clearNamingQueue(ctx);

    if (rungIndex(w.ascension.rung) >= rungIndex('vessel')) out.vesselYears += 1;
  }

  out.best = w.ascension.best;
  out.riteHolders = w.people.all().filter((p) => p.rites.includes('vessel')).length;
  return out;
}

/**
 * Which of this decision's choices actually grant `rite: vessel`. Read off
 * the effects rather than off ids, so a third template granting the rite is
 * covered the day it is authored rather than the day this test goes red.
 */
function grantingChoices(pending: PendingChoice): string[] {
  const e = pending.event;
  if (e.interaction.kind === 'narration') return [];
  const open = new Set(pending.choices.filter((c) => c.available).map((c) => c.id));
  return e.interaction.choices
    .filter((c) => open.has(c.id) && c.outcomes.some(
      (o) => o.effects.some((f) => f.kind === 'rite' && f.rite === 'vessel'),
    ))
    .map((c) => c.id);
}

/** Is this decision a door to the Vessel rite at all? */
function offersTheVessel(pending: PendingChoice): boolean {
  return grantingChoices(pending).length > 0;
}

/** `gate:ladder`'s rule for a branch that costs the climbing man his mind. */
function charges(pending: PendingChoice, choiceId: string): boolean {
  const e = pending.event;
  if (e.interaction.kind === 'narration') return false;
  const choice = e.interaction.choices.find((c) => c.id === choiceId);
  if (!choice) return false;
  // EVERY ladder role, from the one list. This was a fifth hand-written copy
  // of `role === 'foremost'` (issue #61, Stage E5) and it went stale the day
  // `second_foremost` arrived: the second man's Vessel read as a FREE option,
  // so the refusing column fell through to `autoResolveAll` and took it at
  // random — a house that had refused the rite ended up carrying it.
  const ladder = new Set(
    Object.entries(e.slots).filter(([, s]) => isLadderRole(s.role)).map(([id]) => id),
  );
  if (!ladder.size) return false;
  return choice.outcomes.some((o) => o.effects.some(
    (f) => (f.kind === 'madness' && f.delta > 0
      && typeof f.target === 'object' && 'slot' in f.target && ladder.has(f.target.slot))
      || (f.kind === 'rite' && ladder.has(f.ascendant)),
  ));
}

describe('the Vessel rite, over a played batch', () => {
  const taking = SEEDS.map((s) => play(s, 'take'));
  const refusing = SEEDS.map((s) => play(s, 'refuse'));

  it('is offered at all — an event that never fires is not in the game', () => {
    const offers = taking.reduce((a, r) => a + r.offered, 0);
    expect(offers, 'no house in the Long-Line batch was ever asked for a Vessel').toBeGreaterThan(0);
  });

  /**
   * The cast is the ration (`events/rites.yaml`). If this ever goes red the
   * event has come loose from the ladder and is being offered to houses that
   * have no use for it, which is how it read before issue #43 — measured, the
   * old mythic version cast men standing at rung `none` with power 6.7.
   */
  it('is only ever offered to a man who is already standing at Hierophant', () => {
    const cast = [...taking, ...refusing].flatMap((r) => r.castAt);
    expect(cast.length).toBeGreaterThan(0);
    for (const rung of cast) {
      expect(rungIndex(rung), `offered to a man at ${rung}`).toBeGreaterThanOrEqual(rungIndex('hierophant'));
    }
  });

  /**
   * THE MECHANISM, NOT THE TAIL. The first cut of this asserted that at least
   * one run in the batch reached rung four, which was measured at 2 of 12 the
   * day it was written and at 1 of 24 one content drop later — a floor with a
   * one-in-three chance of going red on content that is working perfectly.
   * This repo's own rule: *assert the mechanism, never a seed*.
   *
   * So what is asserted is the half that cannot be a coin. A house that takes
   * the rite has men who took it; a house that refuses has none and CANNOT
   * stand on rung four, because the rite is that rung's last requirement and
   * there is no other way to answer it. `rites.test.ts` holds the rung itself,
   * deterministically, where it cannot flake.
   *
   * The tail is measured rather than gated. Across the columns above the
   * Vessel is reached in roughly one run in twelve to twenty-four — about one
   * in seven of the runs that ever stand a man at Hierophant, which is the
   * quantity actually driving it, and which is issue #41's remaining half
   * rather than this one's.
   */
  it('is what buys rung four, and refusing it never does', () => {
    expect(taking.reduce((a, r) => a + r.riteHolders, 0),
      'no house in twelve played runs has a man who took the rite').toBeGreaterThan(0);
    expect(refusing.reduce((a, r) => a + r.riteHolders, 0),
      'a house that refused the rite has somebody carrying it anyway').toBe(0);

    const reached = (rs: RiteRun[]) => rs.filter((r) => rungIndex(r.best) >= rungIndex('vessel')).length;
    expect(reached(refusing), 'a house that refused the rite still became the Vessel').toBe(0);
    expect(refusing.every((r) => r.vesselYears === 0)).toBe(true);
    // And taking never costs a rung: the columns are level below four.
    expect(reached(taking)).toBeGreaterThanOrEqual(reached(refusing));
  });

  /**
   * Both columns climb the same way and are asked the same question, so a
   * house that says no is not being punished for saying no — it simply stops
   * where §22 says it stops. Keeping the two columns level up to Hierophant is
   * what makes the line above mean the rite rather than the policy.
   */
  it('leaves the two columns level everywhere below the rung it buys', () => {
    const hierophants = (rs: RiteRun[]) => rs.filter((r) => rungIndex(r.best) >= rungIndex('hierophant')).length;
    expect(hierophants(refusing)).toBe(hierophants(taking));
  });
});


/**
 * TEMPORARY #133 MEASUREMENT — remove after CI prints the result.
 * Kept inside an already-measured slow file so the shard-duration guard is not
 * perturbed by introducing a brand-new test path.
 */
describe('#133 delayed-Unmaking probe', () => {
  it('prints the 100 x 500 ascendant funnel for the current policy', () => {
    const source = loadContent();
    const runs = Array.from({ length: 100 }, (_, i) =>
      playToTheEnd(source, 5100 + i, CAMPAIGN_YEARS, 'ascendant'));

    const endings = new Map<string, number>();
    for (const r of runs) endings.set(r.ending, (endings.get(r.ending) ?? 0) + 1);
    const width = Math.max(...runs.map((r) => r.unmakingStageEver?.length ?? 0));
    const stages = Array.from({ length: width }, (_, i) =>
      runs.filter((r) => r.unmakingStageEver?.[i]).length);
    const atomicWidth = Math.max(...runs.map((r) => r.unmakingGateEver?.length ?? 0));
    const atomic = Array.from({ length: atomicWidth }, (_, i) =>
      runs.filter((r) => r.unmakingGateEver?.[i]).length);

    console.log('ISSUE133_DELAYED_PROBE ' + JSON.stringify({
      endings: Object.fromEntries(endings),
      offers: runs.reduce((n, r) => n + (r.templateFires?.the_unmaking ?? 0), 0),
      takers: runs.reduce((n, r) => n + (r.unmakingTakers ?? 0), 0),
      stages,
      atomic,
      godReads: runs.filter((r) => r.unmakingGateEver?.[7]).map((r) => ({
        seed: r.seed,
        ending: r.ending,
        attested: r.attested,
        substantiated: r.substantiated,
        rungsWithheld: r.rungsWithheld,
      })),
    }));
    expect(runs).toHaveLength(100);
  });
});
