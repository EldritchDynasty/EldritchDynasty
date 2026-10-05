import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { SlotSpecS, type ContentBundle } from '@ed/schema';
import {
  GATES, LANES, gateTimingJson, gatesInLane, laneMatrix,
  gateClauses, gateFireRate, gateLadderScales, gateOutcomeReach, gatePurposes,
  gateVocabularyReach,
  gatePostFillability, gateSlotFillability, judgeZeroReach,
} from './tools/gates.js';
import { firedUnderClimbing } from './tools/ladder-gate.js';
import { runFireRateGate } from './tools/fire-rate-gate.js';
import { distinguishHoldingPortraits, gateLand } from './tools/land-gate.js';
import { bloodGateInputs, gateBlood, marriagePolicyForBloodStrategy } from './tools/blood-gate.js';
import {
  gatePartitionWorkerCount,
  partitionGateInputs,
  reduceGatePartitions,
  runGatePartitionsInWorkers,
} from './tools/gate-partition.js';
import { gateWar, warGateInputs } from './tools/war-gate.js';
import { libraryNeutralityVerdict, type LibraryNeutralityMetrics } from './tools/library-gate.js';
import { judgeLongitudinalDelta, ladderBlockerKind } from './tools/long-line-gate.js';
import { CAMPAIGN_YEARS } from './campaign.js';

const content = loadContent();

/**
 * WHO GUARDS THE GUARDS.
 *
 * Every gate in `tools/gates.ts` has passed on every commit it has ever run
 * on, which is exactly what a gate that cannot fail looks like from outside.
 * These hand each one a bundle it must reject.
 *
 * The two slow gates are run here at a sample size that means nothing about
 * the game — two seeds, five years — and everything about the gate: a run that
 * short cannot possibly recover six clauses or fire every event, so a gate
 * with its teeth in says so, and a gate whose measurement has quietly stopped
 * measuring says it is fine.
 */

const broken = (mutate: (b: ContentBundle) => void): ContentBundle => {
  const b = structuredClone(content.bundle);
  mutate(b);
  return b;
};

describe('the gates pass the shipped game', () => {
  it('gate 2 — every event can cast against at least one test family', () => {
    const { ok, lines } = gateSlotFillability(content);
    expect(ok, lines.join('\n')).toBe(true);
  });

  it('post-fillability — every one of the eight careers has a template gated on holding the post (issue #125)', () => {
    const { ok, lines } = gatePostFillability(content);
    expect(ok, lines.join('\n')).toBe(true);
  });

  it('gate 6 — purposes', () => {
    const { ok, lines } = gatePurposes(content);
    expect(ok, lines.join('\n')).toBe(true);
  });

  it('the Mod Editor and CLI use the same browser-safe fire-rate judgement (#75)', () => {
    const opts = { runs: 2, years: 5, climbRuns: 2 };
    expect(runFireRateGate(content, opts)).toEqual(gateFireRate(content, opts));

    for (const file of ['fire-rate-gate.ts', 'gate-batch.ts', 'ladder-fires.ts']) {
      const source = readFileSync(join(import.meta.dirname, 'tools', file), 'utf8');
      expect(source, `${file} pulled a Node-only loader into the editor`).not.toContain('@ed/content');
      expect(source, `${file} pulled a Node builtin into the editor`).not.toMatch(/from ['"]node:/);
    }
  });

  /**
   * GATE 10 on the shipped content, at a batch small enough to test.
   *
   * The question it answers — "does any content author this Effect kind" — is
   * STATIC, so two runs of five years judges it exactly as well as 250 of a
   * thousand. Only the reached/unreached line depends on the batch, and this
   * gate does not convict on that.
   */
  it('gate 10 — every declared Effect kind is authored, but for the two it owes', () => {
    const { ok, lines } = gateVocabularyReach(content, { runs: 2, years: 5 });
    const out = lines.join('\n');
    expect(ok, out).toBe(true);
    expect(out).toMatch(/owed, and pinned: recast, schedule/);
  });

  // Keep the literal below sorted: the left-hand side is deliberately sorted,
  // so an out-of-order expected entry is a test bug rather than a gate failure.
  it('every gate is addressable by name from the CLI table', () => {
    expect(Object.keys(GATES).sort()).toEqual(
      [
        'blood', 'bottleneck', 'clauses', 'endings', 'fire-rate', 'ladder', 'ladder-scales',
        'land', 'library-neutrality', 'outcome-reach', 'post-fillability', 'purposes', 'short-line', 'slot-fillability',
        'vocabulary-reach', 'war',
      ],
    );
  });
});

/**
 * ── THE CI LANES ARE A PARTITION, AND THE WORKFLOW IS THE OTHER HALF ──────
 *
 * The gates job runs on five runners now. The independently expensive gates
 * have their own lanes; the JSON duration budget is the checked source for
 * their measured costs. `outcome-reach` and `vocabulary-reach` remain beside
 * `fire-rate` because all three read the same memoized batch. Splitting those
 * readers would replay the corpus merely to make the lane names look tidier.
 *
 * `gatesInLane` DERIVES `batch` rather than listing it, so a gate added
 * tomorrow is in CI the moment it exists. That is deliberate, and it is the
 * argument `check.yml` has always made about iterating `GATES` instead of
 * naming gates in a workflow — gate 2 was written for CI and wired into
 * nothing for its whole life under the old hand-kept list.
 *
 * But deriving the default lane protects exactly one direction. Name a gate
 * into a lane of its own and forget to add that lane to the workflow's
 * matrix, and those gates run on NO runner at all while every build stays
 * green — gate 2's history again, wearing a matrix. So the workflow is read
 * rather than trusted, the same way `land.test.ts` reads it for jobs.
 */
describe('the CI gate lanes cover every gate exactly once', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../../../.github/workflows/check.yml'),
    'utf8',
  );

  it('emits machine-readable per-gate timing evidence', () => {
    expect(JSON.parse(gateTimingJson('blood', [
      { gate: 'blood', seconds: 12.345, ok: true },
    ], 12.5))).toEqual({
      version: 1,
      lane: 'blood',
      totalSeconds: 12.5,
      gates: [{ gate: 'blood', seconds: 12.345, ok: true }],
    });
  });

  it('partitions GATES — nothing missed, nothing run twice', () => {
    const assigned = LANES.flatMap(gatesInLane);
    expect(
      [...assigned].sort(),
      'the lanes do not add up to the gate table',
    ).toEqual(Object.keys(GATES).sort());
    expect(new Set(assigned).size, 'a gate is in two lanes and CI pays for it twice')
      .toBe(assigned.length);
  });

  it('names the same lanes check.yml actually runs', () => {
    expect(
      laneMatrix(workflow).sort(),
      'check.yml\'s gates matrix and the lane table disagree — whichever lane is\n'
      + 'missing from the workflow holds gates that run on no runner at all.',
    ).toEqual([...LANES].sort());
  });

  /**
   * The rejection, because a rule nobody has watched fail is indistinguishable
   * from a rule that cannot fail. This is the shape the mistake will actually
   * take: the tool grows a lane, the workflow does not.
   */
  it('catches a lane the workflow forgot, which is a gate nothing runs', () => {
    const dropped = workflow.replace(/^(\s*)lane: \[.*\]$/m, '$1lane: [batch]');
    expect(laneMatrix(dropped)).toEqual(['batch']);
    expect(laneMatrix(dropped)).not.toEqual([...LANES].sort());
  });

  it('reads a workflow with no gates matrix as no lanes at all', () => {
    // The other direction, so the test above is not passing on a parser that
    // reports something whatever it is handed.
    expect(laneMatrix('jobs:\n  gates:\n    steps:\n      - run: npm ci\n')).toEqual([]);
  });

  it('refuses a lane name that is not one', () => {
    // A typo in the workflow must not run zero gates and exit green.
    expect(() => gatesInLane('batches')).toThrow(/unknown gate lane/);
  });
});

describe('#440 expensive gate partitioning', () => {
  it('partitions every canonical input exactly once for one through four workers', () => {
    const inputs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    for (const workers of [1, 2, 3, 4]) {
      const plan = partitionGateInputs(inputs, workers);
      const flattened = plan.flatMap((partition) => partition.items);

      expect(flattened).toEqual(inputs.map((input, index) => ({ index, input })));
      expect(new Set(flattened.map((item) => item.index)).size).toBe(inputs.length);
      expect(Math.max(...plan.map((partition) => partition.items.length))
        - Math.min(...plan.map((partition) => partition.items.length))).toBeLessThanOrEqual(1);
    }

    expect(() => partitionGateInputs(inputs, 0)).toThrow(/worker count/);
    expect(() => partitionGateInputs(inputs, 5)).toThrow(/worker count/);
  });

  it('reduces out-of-order worker completion into canonical observation order', () => {
    const plan = partitionGateInputs(['a', 'b', 'c', 'd', 'e'], 3);
    const results = plan.map((partition) => ({
      id: partition.id,
      observations: partition.items.map(({ index, input }) => ({
        index,
        value: input.toUpperCase(),
      })),
    })).reverse();

    expect(reduceGatePartitions(plan, results)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('fails closed on missing, duplicate, or malformed worker evidence', () => {
    const plan = partitionGateInputs(['a', 'b', 'c', 'd'], 2);
    const valid = plan.map((partition) => ({
      id: partition.id,
      observations: partition.items.map(({ index, input }) => ({ index, value: input })),
    }));

    expect(() => reduceGatePartitions(plan, valid.slice(0, 1))).toThrow(/result count mismatch/);
    expect(() => reduceGatePartitions(plan, [valid[0]!, valid[0]!])).toThrow(/duplicate gate partition result/);

    const malformed = structuredClone(valid);
    malformed[0]!.observations[0]!.index = 999;
    expect(() => reduceGatePartitions(plan, malformed)).toThrow(/unexpected index/);
  });

  it('preserves the complete historical blood and war input order', () => {
    const seeds = [4000, 4013, 4026];

    expect(bloodGateInputs(seeds)).toEqual([
      { seed: 4000, policy: 'concentrate' },
      { seed: 4013, policy: 'concentrate' },
      { seed: 4026, policy: 'concentrate' },
      { seed: 4000, policy: 'dilute' },
      { seed: 4013, policy: 'dilute' },
      { seed: 4026, policy: 'dilute' },
    ]);
    expect(warGateInputs(seeds)).toEqual([
      { seed: 4000, policy: 'commit' },
      { seed: 4013, policy: 'commit' },
      { seed: 4026, policy: 'commit' },
      { seed: 4000, policy: 'abstain' },
      { seed: 4013, policy: 'abstain' },
      { seed: 4026, policy: 'abstain' },
    ]);
  });

  it('parses the portable worker-count override and rejects wider pools', () => {
    expect(gatePartitionWorkerCount(undefined)).toBe(4);
    expect(gatePartitionWorkerCount('1')).toBe(1);
    expect(gatePartitionWorkerCount('4')).toBe(4);
    expect(() => gatePartitionWorkerCount('0')).toThrow(/ED_GATE_WORKERS/);
    expect(() => gatePartitionWorkerCount('5')).toThrow(/ED_GATE_WORKERS/);
    expect(() => gatePartitionWorkerCount('two')).toThrow(/ED_GATE_WORKERS/);
  });

  it('propagates a worker failure instead of reducing partial evidence', () => {
    const plan = partitionGateInputs(['one', 'two'], 2);
    expect(() => runGatePartitionsInWorkers(plan, {
      moduleUrl: new URL('./tools/gate-partition.ts', import.meta.url).href,
      exportName: 'thereIsNoSuchWorkerExport',
    })).toThrow(/not a function/);
  });

  it('fails closed when a worker exits before returning evidence', () => {
    const plan = partitionGateInputs(['one'], 1);
    expect(() => runGatePartitionsInWorkers(plan, {
      moduleUrl: new URL('./tools/gate-partition-worker-fixture.ts', import.meta.url).href,
      exportName: 'exitWithoutEvidence',
      timeoutMs: 250,
    })).toThrow(/timed out without returning evidence/);
  });

  it('blood and war parallel workers reproduce serial output and repeat bit-for-bit', () => {
    const tiny = { seeds: [4000, 4013], years: 5 };

    const bloodSerial = gateBlood(content, { ...tiny, workers: 1 });
    const bloodParallel = gateBlood(content, { ...tiny, workers: 2 });
    expect(bloodParallel).toEqual(bloodSerial);
    expect(gateBlood(content, { ...tiny, workers: 2 })).toEqual(bloodParallel);

    const warSerial = gateWar(content, { ...tiny, workers: 1 });
    const warParallel = gateWar(content, { ...tiny, workers: 2 });
    expect(warParallel).toEqual(warSerial);
    expect(gateWar(content, { ...tiny, workers: 2 })).toEqual(warParallel);
  });
});

describe('#201 late ladder diagnosis', () => {
  it('reads the engine blocker fact instead of classifying changing English prose', () => {
    for (const blocker of ['power', 'books', 'affinities', 'madness-floor', 'rite', 'regalia', 'clauses'] as const) {
      expect(ladderBlockerKind(blocker)).toBe(blocker);
    }
    expect(ladderBlockerKind(undefined, false)).toBe('no-expresser');
    expect(ladderBlockerKind(undefined, true)).toBe('clear');
  });
});

describe('#85 longitudinal confidence reporting', () => {
  it('does not call a thin paired sample a finding', () => {
    expect(judgeLongitudinalDelta('tenure', Array(39).fill(1), 'increase'))
      .toMatch(/^UNJUDGED tenure: 39 paired runs; need at least 40$/);
  });

  it('uses expectMean in both directions and exposes a sub-two-SE finding', () => {
    expect(judgeLongitudinalDelta('tenure', Array(40).fill(1), 'increase')).toMatch(/^PASS tenure:/);
    expect(judgeLongitudinalDelta('rung', Array(40).fill(-1), 'decrease')).toMatch(/^PASS rung:/);

    const thinPositive = [...Array(21).fill(1), ...Array(19).fill(-1)];
    expect(judgeLongitudinalDelta('acres', thinPositive, 'increase'))
      .toMatch(/^FAIL .*only by .* standard errors/);
  });
});

describe('the gates fail when they should', () => {
  it('the library neutrality gate rejects a material inherited advantage', () => {
    const baseline: LibraryNeutralityMetrics = {
      treasury: 100,
      respect: 2,
      ascension: 1,
      livingBlood: 4,
      acreage: 800,
      ending: 'forgotten',
    };
    const verdict = libraryNeutralityVerdict(
      [baseline, baseline],
      [{ ...baseline, treasury: 125 }, { ...baseline, treasury: 125 }],
    );

    expect(verdict.ok, verdict.lines.join('\n')).toBe(false);
    expect(verdict.lines.join('\n')).toMatch(/FAIL treasury/);
  });

  it('the blood strategies carry their Match policy into automatic marriages', () => {
    expect(marriagePolicyForBloodStrategy('concentrate')).toBe('in');
    expect(marriagePolicyForBloodStrategy('dilute')).toBe('out');
    expect(marriagePolicyForBloodStrategy('marry_in')).toBe('in');
    expect(marriagePolicyForBloodStrategy('marry_out')).toBe('out');
    expect(marriagePolicyForBloodStrategy('chronicler')).toBe('as_it_falls');
    expect(marriagePolicyForBloodStrategy('withhold')).toBe('as_it_falls');
  });

  it('the blood gate rejects a game where the font carries no power at all', () => {
    const bundle = broken((b) => {
      for (const locus of b.loci) {
        if (locus.kind !== 'eldritch_font') continue;
        for (const allele of locus.alleles) allele.effect = 0;
      }
    });

    // Two workers make this a rejection test of the optimized path itself,
    // not only of the serial diagnostic fallback.
    const { ok, lines } = gateBlood(bundle, { seeds: [4000, 4013], years: 5, workers: 2 });
    expect(ok, lines.join('\n')).toBe(false);
    expect(lines.join('\n')).toMatch(/concentrating marriage policy/);
  });
  it('the land gate rejects a bundle missing one of the six risk shapes', () => {
    const bundle = broken((b) => {
      b.parcels = b.parcels.filter((p) => p.kind !== 'sarrow_bottom');
    });
    const { ok, lines } = gateLand(bundle);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/LAND SHAPES missing: sarrow_bottom/);
  });

  it('a blind holding reader orders century three and century eight by the deeds, and says why', () => {
    const centuryThree = {
      acres: 1400, holdings: 15, newestHoldingSince: 1190, latestChange: 1221, names: ['Hallowfield'],
    };
    const centuryEight = {
      acres: 1510, holdings: 17, newestHoldingSince: 1788, latestChange: 1812, names: ['Hallowfield', 'Sowerhay'],
    };
    const read = distinguishHoldingPortraits(centuryEight, centuryThree);
    expect(read.later).toBe(0);
    expect(read.why).toMatch(/latest change in 1812/);
  });

  /**
   * A slot nobody in any of the six households can fill. The role is real and
   * the filter is ordinary — it just demands an age no living person reaches,
   * which is the shape of the starvation this gate exists to catch.
   */
  it('gate 2 catches a template that cannot cast against any household', () => {
    const bundle = broken((b) => {
      const e = b.events.find((x) => !x.arc && Object.keys(x.slots).length)!;
      e.slots.IMPOSSIBLE = SlotSpecS.parse({
        role: 'family_member',
        filters: [{ age: { op: 'gte', value: 900 } }],
      });
    });

    const { ok, lines } = gateSlotFillability(bundle);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/cannot cast against any test family/);
  });

  /**
   * THE SAME QUESTION, ASKED OF A PARTY (issue #90). `SlotSpec.count` was
   * declared and unread, so this gate could only ever ask whether ONE person
   * could be cast — a slot demanding forty men passed it, and would have been
   * starved in every real run for as long as nobody looked.
   *
   * `resolveSlots` enforces `min` now, so the gate asks the right question
   * through the same call it always made. This is the bundle that proves it:
   * a role every household can fill, at a size none of them can.
   *
   * The size is 200 rather than a round 40 because one of the six fixtures is
   * The 40-Member Sprawl and it houses sixty people — a party of forty is
   * genuinely fillable there, which is the fixture set doing its job.
   */
  it('gate 2 catches a party larger than any household can field', () => {
    const bundle = broken((b) => {
      const e = b.events.find((x) => !x.arc && Object.keys(x.slots).length)!;
      e.slots.TOO_MANY = SlotSpecS.parse({
        role: 'family_member',
        count: { min: 200, max: 200 },
      });
    });

    const { ok, lines } = gateSlotFillability(bundle);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/cannot cast against any test family/);
  });

  it('gate 2 passes the same party at a size a household can field', () => {
    const bundle = broken((b) => {
      const e = b.events.find((x) => !x.arc && Object.keys(x.slots).length)!;
      e.slots.A_FEW = SlotSpecS.parse({
        role: 'family_member',
        count: { min: 2, max: 3 },
      });
    });

    expect(gateSlotFillability(bundle).ok).toBe(true);
  });

  /**
   * A career every template can still CAST — gate 2 stays green — but none
   * gates on holding it any more. This is the exact shape the epic measured
   * before `career_lives.yaml`: six of eight posts were bought, held for
   * decades, and caused not one scene from being held.
   */
  it('post-fillability catches a career with no template gated on holding the post', () => {
    const bundle = broken((b) => {
      for (const e of b.events) {
        for (const slot of Object.values(e.slots)) {
          slot.filters = slot.filters.filter((f) => !('career' in f && f.career.includes('military')));
        }
      }
    });

    const { ok, lines } = gatePostFillability(bundle);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/military/);
  });

  it('gate 6 catches a template that does not name three purposes', () => {
    const bundle = broken((b) => { b.events[0]!.purposes = ['change_standing'] as typeof b.events[0]['purposes']; });

    const { ok, lines } = gatePurposes(bundle);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/event\/purposes/);
  });

  /**
   * Five years recovers no clauses at all, so a gate still counting them
   * reports a median of 0 and fails. If this ever passes, the gate has stopped
   * reading `clausesRecovered`.
   */
  it('gate 7 fails a run too short to recover anything', () => {
    const { ok, lines } = gateClauses(content, { seeds: [1000, 1007], years: 5 });
    expect(ok, lines.join('\n')).toBe(false);
    expect(lines.join('\n')).toMatch(/median must be at least/);
  });

  it('gate 4 fails a run too short for the content to fire, and says it tried both policies', () => {
    const { ok, lines } = gateFireRate(content, { runs: 2, years: 5, climbRuns: 2 });
    const out = lines.join('\n');
    expect(ok, out).toBe(false);
    expect(out).toMatch(/fire in under/);
    // The acquittal pass RAN and refused to acquit. Without this the second
    // policy could quietly stop being consulted and every message would read
    // exactly as it does now (issue #64).
    expect(out).toMatch(/played for the ladder/);
  });

  /**
   * THE ACQUITTAL NEEDS SOMETHING TO ACQUIT WITH (issue #64).
   *
   * The chronicler never climbs, so an event cast on a living Hierophant is
   * unreachable to the main batch by design. All three rites were on this
   * issue's original never-fired list for that reason, while being correct
   * events doing a correct thing, and a gate convicting on them would send the
   * next person to loosen a condition that is right.
   *
   * This asserts the half that makes the acquittal worth having: a house that
   * PLAYS for the ladder reaches the rites. Asserted on the helper rather than
   * through the gate, because at a batch small enough to test, which templates
   * the chronicler happened to miss is seed noise as much as policy — and a
   * test whose subject is noise is not a test.
   */
  it('a house that plays for the ladder reaches the rites', () => {
    // Swapped again (issue #91): the land work — several new `uncommon`
    // content templates competing in the same ambient pool, plus the
    // Cradlemoor arc's three nodes — moves which climbing seeds reach the
    // rite, the same shape #132's swap above already describes. Content
    // changing which seed reaches a threshold is expected (CLAUDE.md: never
    // pin a test to a seed reaching a state), so this remains a POOL rather
    // than one magic seed. But the evidence below is monotone: once >100
    // templates and both rites have fired, another century cannot make them
    // unfire. Stop at that point instead of paying for every remaining year
    // of all eight candidates in the fix-and-rerun lane.
    const fired = firedUnderClimbing(
      content,
      [4014, 4021, 4025, 4027, 4029, 4033, 4036, 4037],
      CAMPAIGN_YEARS,
      900,
      (seen) => seen.size > 100
        && seen.has('the_vessel_rite')
        && seen.has('the_great_rite'),
    );
    expect(fired.size, 'the climbing pass played no events at all').toBeGreaterThan(100);
    expect([...fired]).toContain('the_vessel_rite');
    expect([...fired]).toContain('the_great_rite');
  });

  it('gate 8 fails a run too short for the branches to be reached', () => {
    const { ok, lines } = gateOutcomeReach(content, { runs: 2, years: 5 });
    expect(ok, lines.join('\n')).toBe(false);
    expect(lines.join('\n')).toMatch(/never resolve/);
  });

  /**
   * The failure gate 8 exists for, built on purpose: a choice whose `requires`
   * no living person can satisfy. Gate 4 passes this bundle — the event still
   * fires at its usual rate — and `outcomes/weights` passes it too, because
   * nothing about it is statically impossible. Only a run can see it.
   */
  it('gate 8 catches a branch gated behind a threshold nobody reaches', () => {
    const bundle = broken((b) => {
      const e = b.events.find((x) => x.interaction.kind === 'choice')!;
      if (e.interaction.kind === 'narration') throw new Error('picked the wrong event');
      e.interaction.choices[0]!.requires = [{ slot: Object.keys(e.slots)[0] ?? 'HEAD', attr: 'mind', op: 'gte', value: 10_000 }];
    });

    const { ok, lines } = gateOutcomeReach(bundle, { runs: 3, years: 400 });
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/never resolve/);
  });

  /**
   * WHAT A ZERO IS ALLOWED TO MEAN (issue #80).
   *
   * Gate 8 spent its whole life treating `pct === 0` as proof, and the comment
   * above its own run count already knew better: *"a one-in-a-hundred outcome
   * shows zero about one time in twelve."* It failed a build on
   * `the_match_that_never_comes/counter -> opened` — weight 20 of 100, under a
   * choice reached seven times in 250 runs. Seven chances at one in five is a
   * 21% chance of showing zero, and the same outcome reaches 1.2% on the
   * commit before; the only thing between them was 177 lines of unrelated
   * content re-rolling every draw in the game.
   *
   * These are the three readings, given directly as numbers. The middle one is
   * the reason `judgeZeroReach` is exported at all: an outcome with plenty of
   * chances that takes none of them cannot be built out of content, because
   * weights are authored and a choice that fires often lands on everything
   * under it unless the roller is broken. It is a guard against an engine bug,
   * so the only way to watch it fail is to hand it the numbers.
   */
  describe('gate 8 sorts a zero by what it can support', () => {
    it('convicts an outcome whose choice nobody was ever offered', () => {
      const v = judgeZeroReach(0, 0.5, 250);
      expect(v.kind).toBe('dead');
      expect(v.why).toMatch(/never fired/);
    });

    it('convicts an outcome that had the chances and took none of them', () => {
      // 100 firings at one in five is twenty expected. Zero is not a draw.
      const v = judgeZeroReach(100, 0.2, 250);
      expect(v.kind).toBe('dead');
      expect(v.why).toMatch(/expected ~20\.0 of 100 firings/);
    });

    /** The exact shape of the build this gate failed for no reason. */
    it('refuses to convict on seven chances at one in five, and says what would', () => {
      const v = judgeZeroReach(7, 0.2, 250);
      expect(v.kind).toBe('unproven');
      // The prescription, not a shrug: `expectRate`'s contract, which is that
      // a claim the batch cannot carry fails with the batch size that could.
      expect(v.why).toMatch(/would need ~893 runs to prove/);
    });

    /**
     * The boundary is a real edge and not a preference — five expected is
     * under a one per cent chance of a spurious zero, which is what makes
     * 872 simultaneous judgements survivable.
     */
    it('convicts exactly at the proof threshold and not below it', () => {
      expect(judgeZeroReach(10, 0.5, 250).kind).toBe('dead');
      expect(judgeZeroReach(10, 0.49, 250).kind).toBe('unproven');
    });
  });
});

/**
 * A GATE THAT RUNS NOWHERE IS NOT A GATE.
 *
 * Gate 2 (slot fillability) was written for CI and never wired into it, so for
 * its whole existence it ran on nobody's machine — it passed every test in
 * `gates.test.ts` the entire time, because those call the function directly.
 * The workflow named its gates one at a time, and the list was maintained by
 * remembering.
 *
 * It runs `npm run gate` now, which runs everything in `GATES`. This checks
 * that it still does, because the failure is silent in both directions.
 */
/**
 * ONE BATCH, TWO GATES (issue #64).
 *
 * Gate 4 and gate 8 bootstrapped the SAME seeds — `5000 + i * 7` — for the
 * same thousand years and each threw away everything the other wanted. Gate 4
 * alone measured 342 seconds.
 *
 * The sharing is a cache, and a cache that returns the wrong batch is a gate
 * answering about content it was not given — which would pass, silently, on
 * exactly the bundle it was supposed to reject.
 */
/**
 * GATE 9 — A LADDER GATE WITH NO KEY (issue #61).
 *
 * §22's mind and Madness floors were prose on a 0-100 scale, compared against
 * raw attributes topping out near 81 and 35. Nought per cent of 1,273 sampled
 * expressers cleared the Vessel's `mind >= 70`; the Demigod's and God's
 * Madness floors were above anything the simulation had ever produced. Rungs
 * four, five and six had never been held, so Apotheosis — the ending on the
 * box — had never once fired, and it all typechecked.
 */
describe('gate 9 asks whether anybody can clear the ladder', () => {
  const cheap = { runs: 2, years: 300, every: 50 } as const;

  it('passes the shipped ladder, and says what share clears each floor', () => {
    const { ok, lines } = gateLadderScales(content, cheap);
    const out = lines.join('\n');
    expect(ok, out).toBe(true);
    expect(out).toMatch(/wants mind 70/);
    expect(out).toMatch(/#378 diagnostic — sampled Madness by progression route/);
    expect(out).toMatch(/none\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/vessel\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/great_rite\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/unmaking\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/#378 diagnostic — resolved Madness-progression decisions across batch/);
    for (const event of [
      'the_drowning',
      'the_vessel_rite',
      'the_great_rite',
      'the_second_name',
      'the_second_widening',
      'the_unmaking',
    ]) {
      expect(out).toMatch(new RegExp(`${event}\\s+resolved\\s+\\d+ ·`));
    }
    expect(out).toMatch(/#378 diagnostic — top distinct sampled Madness holders per run/);

    // The diagnostic must not let one long-lived man occupy all three rows
    // merely because the 25/50-year sampler saw him repeatedly.
    for (const seed of [5000, 5007]) {
      const rows = lines.filter((line) => line.includes(`seed ${seed} #`));
      const ids = rows.map((line) => /\bid ([^ ]+)/.exec(line)?.[1]);
      expect(rows.length, `no Madness provenance rows for seed ${seed}`).toBeGreaterThan(0);
      expect(ids.every(Boolean), `seed ${seed} emitted a provenance row without a person id`).toBe(true);
      expect(new Set(ids).size, `seed ${seed} repeated one holder in its top rows`).toBe(ids.length);
    }
  });

  /**
   * The rejection. Normalising made the real floors scale-INVARIANT — which is
   * the point of them, and also means no edit to `attributes.yaml` can produce
   * this failure, because `expected` moves with the population. So the floors
   * are the thing handed in, and the judgement is the thing under test.
   */
  it('refuses a floor nobody in the population can reach', () => {
    const { ok, lines } = gateLadderScales(content, { ...cheap, mindFloor: { hierophant: 10_000 } });
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/cleared by nobody/);
  });

  /**
   * AND IT JUDGES POWER, which it did not (issue #61).
   *
   * The revised acceptance asks that every gate be cleared by a non-zero share
   * of the population reaching the rung below — and power was the quantity
   * that actually had a gate above the population: God asked 98 of a
   * population whose best man over sixteen played runs reached 90, under the
   * strongest policy anyone can drive. Mind and madness were watched here and
   * power was not, which is how it sat unnoticed while three normalisations
   * went in around it.
   */
  it('refuses a POWER floor nobody in the population can reach', () => {
    const { ok, lines } = gateLadderScales(content, { ...cheap, powerFloor: { hierophant: 10_000 } });
    expect(ok, lines.join('\n')).toBe(false);
    expect(lines.join('\n')).toMatch(/power >= 10000 is cleared by nobody/);
  });

  it('reports the real power floors it is judging', () => {
    const { lines } = gateLadderScales(content, cheap);
    expect(lines.join('\n')).toMatch(/wants power 50/);
  });

  /**
   * And does NOT convict a floor the ladder never got far enough to test. The
   * chain matters: Madness above Hierophant is purchased (§10) through rites
   * the upper rungs themselves unlock, so an untested floor is starved rather
   * than wrong — and failing on it would send the next person to loosen a
   * number that is right.
   */
  it('holds its tongue about a floor above a rung nobody reached', () => {
    const { ok, lines } = gateLadderScales(content, { ...cheap, madnessFloor: { god: 10_000 } });
    expect(ok, 'convicted a floor above an unreached rung').toBe(true);
    expect(lines.join('\n')).toMatch(/never got far enough to test/);
  });
});

describe('gate 10 can fail, in both directions', () => {
  /**
   * A NEW UNAUTHORED KIND IS THE BUG IT EXISTS FOR. Strip every use of a kind
   * out of the content and the gate has to convict — that is invariant 11
   * stated as a build failure: the case in `applyEffect` does the work, or the
   * case does not exist.
   *
   * `respect` is the one to strip because it is the most-authored kind in the
   * game (503 uses). If the gate can miss THAT going dark, it can miss
   * anything.
   */
  it('convicts a declared kind that no content authors any more', () => {
    const bundle = broken((b) => {
      for (const e of b.events) {
        const strip = (o: { effects?: { kind: string }[] }) => {
          if (o.effects) o.effects = o.effects.filter((x) => x.kind !== 'respect');
        };
        if (e.interaction.kind === 'narration') e.interaction.outcomes.forEach(strip);
        else for (const c of e.interaction.choices) c.outcomes.forEach(strip);
      }
    });

    const { ok, lines } = gateVocabularyReach(bundle, { runs: 2, years: 5 });
    const out = lines.join('\n');
    expect(ok, out).toBe(false);
    expect(out).toMatch(/respect: the case in applyEffect exists/);
    expect(out).toMatch(/invariant 11/);
  });

  /**
   * AND THE PIN PRUNES ITSELF. The day somebody authors a `recast` scene, this
   * gate must say so rather than quietly carrying a comment about a debt the
   * game has paid. Simulated by pointing an existing outcome at the verb.
   */
  it('convicts a pinned debt that has been paid off and not un-pinned', () => {
    const bundle = broken((b) => {
      const e = b.events.find((x) => x.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('picked the wrong event');
      const o = e.interaction.outcomes[0]!;
      o.effects = [...(o.effects ?? []), { kind: 'recast', slot: 'HEAD' }] as typeof o.effects;
    });

    const { ok, lines } = gateVocabularyReach(bundle, { runs: 2, years: 5 });
    const out = lines.join('\n');
    expect(ok, out).toBe(false);
    expect(out).toMatch(/recast is authored now/);
  });
});

describe('the shared batch answers about the content it was handed', () => {
  it('does not carry one bundle\'s verdict over to another', () => {
    const tiny = { runs: 2, years: 5 };
    // A bundle that must FAIL, then the shipped one, then the broken one
    // again. If the cache keyed on anything but the source, the second and
    // third answers would be the first one.
    const broke = broken((b) => {
      const e = b.events.find((x) => x.interaction.kind === 'choice')!;
      if (e.interaction.kind === 'narration') throw new Error('picked the wrong event');
      e.interaction.choices[0]!.requires = [
        { slot: Object.keys(e.slots)[0] ?? 'HEAD', attr: 'mind', op: 'gte', value: 10_000 },
      ];
    });

    const first = gateOutcomeReach(broke, tiny);
    const between = gateFireRate(content, tiny);
    const again = gateOutcomeReach(broke, tiny);

    expect(again.ok, 'the second look at the same bundle disagreed with the first').toBe(first.ok);
    expect(again.lines).toEqual(first.lines);
    // And the shipped content in the middle was judged on its own terms.
    expect(between.lines.join('\n')).toContain('gate 4');
  });

  /**
   * Both gates reading one batch must still each read their OWN half of it: a
   * fire-rate answer built from outcome counts, or the reverse, would be a
   * gate that always passes.
   */
  it('gives each gate the half of the batch it asked for', () => {
    const fire = gateFireRate(content, { runs: 2, years: 5 });
    const reach = gateOutcomeReach(content, { runs: 2, years: 5 });
    expect(fire.lines[0]).toContain('non-frame events');
    expect(reach.lines[0]).toContain('authored outcomes');
    expect(fire.lines[0]).not.toEqual(reach.lines[0]);
  });

  /**
   * GATE 9 SHARES A BATCH TOO, and a memo nobody has watched go stale is a
   * memo that will.
   *
   * Gate 9's five calls in this file play one batch between them now, keyed on
   * the source object and the batch shape. That is a real cache with a real
   * way to be wrong: hand it a different bundle and get the last one's
   * population back, and every floor in the game would be judged against
   * content nobody shipped — silently, because the verdict would still look
   * like a verdict.
   *
   * Two different questions of the same memo, with a third in between, and the
   * answers have to belong to what was asked.
   */
  it('gate 9 judges the bundle it was handed, not the one before it', () => {
    const cheap = { runs: 2, years: 300, every: 50 } as const;

    // Same batch, different floors: the population is shared, the verdict is not.
    const shipped = gateLadderScales(content, cheap);
    /**
     * `hierophant`, not a higher rung: gate 9 convicts a floor nobody clears
     * only where the rung BENEATH it was actually stood on, and at two runs of
     * three hundred years the only populated rungs are `adept` and below. A
     * floor on `vessel` comes back "untested" rather than dead — which is the
     * gate being right, and would make this a test of nothing.
     */
    const impossible = gateLadderScales(content, { ...cheap, mindFloor: { hierophant: 10_000 } });
    expect(shipped.ok, shipped.lines.join('\n')).toBe(true);
    expect(impossible.ok, 'a floor of 10,000 was cleared by somebody').toBe(false);

    // A different bundle in the middle must not be answered from the memo,
    // and the shipped one must not be answered from ITS memo afterwards.
    const other = broken((b) => { b.events = b.events.slice(0, Math.max(1, b.events.length - 1)); });
    const elsewhere = gateLadderScales(other, cheap);
    const back = gateLadderScales(content, cheap);

    expect(back.lines).toEqual(shipped.lines);
    expect(elsewhere.lines[0]).toContain('gate 9');
  });
});

describe('the gates are actually run', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../../../.github/workflows/check.yml'),
    'utf8',
  );

  it('has CI run the gate table, without naming gates one at a time', () => {
    expect(workflow, 'the workflow does not run the gates at all').toMatch(/npm run gates\b/);
  });

  /**
   * THE RULE IS ABOUT GATE NAMES, AND IT SAYS SO NOW.
   *
   * This matched ANY argument after `npm run gates --`, which was the same
   * thing as a gate name while the only argument was a gate name. The gates
   * job runs with lane arguments now, and those tripped it — a guard firing
   * on the mechanism rather than on the thing it was protecting.
   *
   * What it protects is unchanged and is the reason gate 2 ran on nobody's
   * machine for its whole life: a hand-kept list of GATE NAMES in the
   * workflow, which goes stale the moment somebody adds a gate and forgets
   * this file. A LANE is not that. `batch` is DERIVED as every gate not
   * spoken for, so a new gate is in CI the moment it exists — the property
   * the old rule existed to defend, defended by construction rather than by
   * a regex.
   *
   * So the check is now what it always meant: no argument CI passes may be
   * the name of a gate. `npm run gates -- fire-rate` still fails this.
   */
  it('does not let a per-gate step drift back in', () => {
    const args = [...workflow.matchAll(/npm run gates\s+--\s+(\S+)/g)].map((m) => m[1]!);
    const named = args.filter((a) => Object.keys(GATES).includes(a));
    expect(
      named,
      `CI names the gate(s) ${named.join(', ')}. That is a list kept by hand, and\n`
      + 'the next gate added will not be on it. Use a lane — `--lane batch` runs\n'
      + 'every gate that is not spoken for, including one added tomorrow.',
    ).toEqual([]);
  });

  /**
   * The rejection, because the rule above was just rewritten and a rewritten
   * rule nobody has watched fail is a rule that might no longer catch
   * anything. This is the exact workflow line it exists to refuse.
   */
  it('catches a workflow that has gone back to naming a gate', () => {
    const named = 'jobs:\n  gates:\n    steps:\n      - run: npm run gates -- fire-rate\n';
    const args = [...named.matchAll(/npm run gates\s+--\s+(\S+)/g)].map((m) => m[1]!);
    expect(args.filter((a) => Object.keys(GATES).includes(a))).toEqual(['fire-rate']);
  });
});
