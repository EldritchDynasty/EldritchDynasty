import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  applyRecord, bootstrap, commitOutcome, digestOf, emptyReport, place, present,
  replay, ReplayMismatchError, runYears, testRng, testWorld,
} from '@ed/core';
import { CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();
// 1042, 909 and 5150 replaced: under the corrected blood-membership count
// (issue #42) each of their own lines breaks in the founding century (1136,
// 1074 and 1109), which a batch this small cannot absorb. 910, 912 and 5151
// are confirmed to survive the full Long Line.
const SEEDS = [910, 77, 912, 5151, 8080, 31];

/**
 * THE DECISION LOG AND REPLAY (issue #8, phase 1).
 *
 * `saveGame`/`loadGame` make a run a snapshot; this is the append-only record
 * beside it. The acceptance bar the issue itself sets is not negotiable:
 * "a decision log without [a digest(replay(log)) === digest(original)]
 * assertion is this codebase's canonical dead feature." That is the first
 * test below. The other two are the prerequisite bugs the issue named —
 * fixed here because a replay built on top of either would have surfaced
 * the mismatch as a mystery rather than a known cause.
 */
describe('replay reconstructs a run from its decision log', () => {
  const YEARS = CAMPAIGN_YEARS;

  it('digest(replay(log)) equals digest(original) across the standard seed set', () => {
    let causalPages = 0;
    for (const seed of SEEDS) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, YEARS);

      // Not vacuous: a log nobody ever populated would pass a digest check
      // for the wrong reason. Real decisions have to have happened.
      expect(ctx.world.decisionLog.length, `seed ${seed}: nothing was logged`).toBeGreaterThan(0);

      const original = digestOf(ctx);
      const replayed = replay(bundle, ctx.world.decisionLog, seed, 1042, YEARS);
      expect(digestOf(replayed), `seed ${seed}`).toBe(original);
      const causes = ctx.world.chronicle.map((entry) => ({ id: entry.id, cause: entry.cause }));
      const replayedCauses = replayed.world.chronicle.map((entry) => ({ id: entry.id, cause: entry.cause }));
      expect(replayedCauses, `seed ${seed}: causal Chronicle provenance drifted`).toEqual(causes);
      causalPages += causes.filter((entry) => entry.cause !== undefined).length;
    }
    expect(causalPages, 'the replay corpus never exercised a causal Chronicle page').toBeGreaterThan(0);
  });

  it('throws rather than returning a run that silently does not match the log it was given', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    runYears(ctx, 200);
    const tampered = [...ctx.world.decisionLog, {
      kind: 'name' as const, year: 1042, person: 'nobody', name: 'Nobody',
    }];
    expect(() => replay(bundle, tampered, 1042, 1042, 200)).toThrow(ReplayMismatchError);
  });
});

describe('the two bugs the issue named as prerequisites', () => {
  /**
   * `present`'s auto-resolve branch picked `rng.pick(e.interaction.choices)`
   * with no availability check at all, while `autoResolveDecision` (the
   * docket path) filtered by `choiceAvailability` first — two let-him-decide
   * rules under one name. `the_seal_questioned`'s "strike" choice requires
   * the Head's strength >= 45; give him none of it and the chronicler must
   * never be able to take that choice, exactly as the player could not.
   */
  it('never lets the chronicler take a choice whose requires fail', () => {
    const event = bundle.events.find((e) => e.id === 'the_seal_questioned')!;
    expect(event, 'fixture event missing from content').toBeDefined();

    for (let trial = 0; trial < 40; trial++) {
      const ctx = testWorld(bundle, 1042, 1042);
      const headPerson = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
      headPerson.acquired.strength = -1000; // guaranteed well under the 45 threshold
      const challenger = place(ctx, { sex: 'male', age: 30 });
      const report = emptyReport(ctx.world.year);

      present(ctx, event, { HEAD: headPerson.id, CHALLENGER: challenger.id }, [], testRng('seal', trial), report, true);

      const outcomeId = report.resolved[0]?.outcome.id;
      expect(['struck', 'fell'], `trial ${trial}: took "strike" despite failing requires`).not.toContain(outcomeId);
    }
  });

  /**
   * `applyRecord` used to find "the" chronicle entry for an event by
   * `(eventId, year)` — fine until the same template fired twice in one
   * year, at which point the second Record answer rewrote the FIRST firing's
   * line. Fire the same narration-with-record event twice in the same year
   * by hand and answer each Record independently; each must land on its own
   * entry.
   */
  it('targets its own chronicle entry when a template fires twice in one year', () => {
    const event = bundle.events.find((e) => e.id === 'the_burning_of_the_nine_libraries')!;
    expect(event, 'fixture event missing from content').toBeDefined();
    if (event.interaction.kind !== 'narration') throw new Error('fixture event is no longer narration');

    const ctx = testWorld(bundle, 1042, 1300);
    const headPerson = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    const fill = { HEAD: headPerson.id };
    const outcome = event.interaction.outcomes[0]!;
    const rng = testRng('bug2');

    const first = commitOutcome(ctx, event, outcome, fill, undefined, rng);
    const second = commitOutcome(ctx, event, outcome, fill, undefined, rng);
    expect(first.entryId).not.toBe(second.entryId);

    applyRecord(ctx, event, first.entryId, 'omit');
    applyRecord(ctx, event, second.entryId, 'embellish');

    const entry1 = ctx.world.chronicle.find((c) => c.id === first.entryId);
    const entry2 = ctx.world.chronicle.find((c) => c.id === second.entryId);
    expect(entry1?.text).toBeNull();
    expect(entry1?.record).toBe('omit');
    expect(entry2?.text).toBe(event.record!.options.embellish.chronicle);
    expect(entry2?.record).toBe('embellish');
  });
});
