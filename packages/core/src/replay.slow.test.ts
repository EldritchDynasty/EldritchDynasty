import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { LibraryRunS } from '@ed/schema';
import {
  applyRecord, bootstrap, commitOutcome, digestOf, emptyReport, foundHouse, heldHeirlooms, place, present,
  replay, ReplayMismatchError, runYears, testRng, testWorld,
  saveGame, loadGame, expectHealthyWorld, setProseMode, setProseVariants,
} from '@ed/core';
import { CAMPAIGNS, CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();
// 1042, 909 and 5150 replaced: under the corrected blood-membership count
// (issue #42) each of their own lines breaks in the founding century (1136,
// 1074 and 1109), which a batch this small cannot absorb. 910, 912 and 5151
// are confirmed to survive the full Long Line.
const SEEDS = [910, 77, 912, 5151, 8080, 31];

describe('the demonstration pays every promised beat (#323)', () => {
  it.each(['original', 'plainenglish'] as const)('completes every beat in every one of 64 fixed seeds in %s', (mode) => {
    for (let i = 0; i < 64; i++) {
      const seed = 5000 + 7 * i;
      let ctx = bootstrap(bundle, seed, 1042, 'demo');
      setProseVariants(ctx, bundle.proseVariants);
      setProseMode(ctx, mode);
      const founding = ctx.world.chronicle[0];
      expect(founding?.year, `seed ${seed}: no signing page`).toBe(1042);
      // Reload in the middle of the authored introduction, not after it is
      // already over, so the appointment and narrator binding must persist.
      runYears(ctx, 2);
      ctx = loadGame(saveGame(ctx), bundle);
      setProseVariants(ctx, bundle.proseVariants);
      setProseMode(ctx, mode);
      runYears(ctx, CAMPAIGNS.demo.years - 2 + 1);
      expect(ctx.world.age.ended.some((age) => age.age === 'the_insurrection' && age.named),
        `seed ${seed}: no complete named opening Age`).toBe(true);
      expect(ctx.world.decisionLog.some((decision) => decision.kind === 'record'
        && decision.event === 'demo_the_last_page'), `seed ${seed}: no forced Record`).toBe(true);
      expect(ctx.world.frame.entries.some((entry) => entry.eventId === 'demo_the_margin_keeps_its_colour'),
        `seed ${seed}: no scheduled interlude`).toBe(true);
      expect(ctx.world.people.get(ctx.world.narrator!)?.status).toBe('guardian');
      expect(ctx.world.ending, `seed ${seed}: no verdict`).toBeDefined();
      expect(CAMPAIGNS.demo.endings).toContain(ctx.world.ending!.id);
      expectHealthyWorld(ctx);
    }
  });
});

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

  it('replays Short Line and Demo logs with the campaign that produced them', () => {
    for (const campaign of ['short', 'demo'] as const) {
      // Use the complete Demo term and a bounded Short Line witness. Both
      // differ from the Long Line envelope before gameplay diverges.
      const years = campaign === 'demo' ? CAMPAIGNS.demo.years : 80;
      const seed = 910;
      const original = bootstrap(bundle, seed, 1042, campaign);
      runYears(original, years);

      const rebuilt = replay(bundle, original.world.decisionLog, seed, 1042, years, campaign);
      expect(rebuilt.world.campaign, `${campaign}: wrong campaign`).toBe(campaign);
      expect(rebuilt.world.year, `${campaign}: wrong year`).toBe(original.world.year);
      expect(CAMPAIGNS[rebuilt.world.campaign].endYear).toBe(CAMPAIGNS[campaign].endYear);
      expect(digestOf(rebuilt), `${campaign}: replay drifted`).toBe(digestOf(original));
    }
  });

  it('replays inherited Library memories using the original prior-run input (#1601)', () => {
    // The installation's Library is external bootstrap input, not a decision
    // reconstructed from the current run. One witnessed historical page is
    // enough to prove the input affects narrative state and its world digest.
    const previous = LibraryRunS.parse({
      id: 'lib_replay_previous_house',
      seed: 431,
      campaign: 'short',
      endedYear: CAMPAIGNS.short.endYear,
      house: 'The House Before',
      ending: { id: 'forgotten', title: 'Forgotten' },
      entries: [{
        id: 'page_before',
        said: 'Iona kept a record of the years the old house survived.',
        year: 1100,
        record: 'record',
        people: { old_iona: 'Iona' },
        claims: [{ kind: 'attr', person: 'old_iona', attr: 'mind', value: 65 }],
      }],
    });
    const priorRunSnapshot = structuredClone(previous);
    const seed = 912;
    const years = 40;
    const original = bootstrap(bundle, seed, 1042, 'short', [previous]);
    const initialMemory = structuredClone(original.world.libraryMemories);
    expect(initialMemory).toHaveLength(1);
    expect(initialMemory[0]).toMatchObject({
      sourceRun: previous.id,
      sourceHouse: previous.house,
      sourceText: previous.entries[0]!.said,
      about: `library:${previous.id}:${previous.entries[0]!.id}`,
    });

    runYears(original, years);
    const rebuilt = replay(bundle, original.world.decisionLog, seed, 1042, years, 'short', [previous]);
    expect(rebuilt.world.libraryMemories).toEqual(original.world.libraryMemories);
    expect(rebuilt.world.libraryMemories[0]?.id).toBe(initialMemory[0]?.id);
    expect(rebuilt.world.libraryMemories[0]?.sourceText).toBe(initialMemory[0]?.sourceText);
    expect(digestOf(rebuilt)).toBe(digestOf(original));
    expect(previous, 'bootstrap/replay mutated its historical Library input').toEqual(priorRunSnapshot);

    // Six-argument callers without an inherited Library still work: no
    // synthetic memory, no changed RNG streams, and an identical digest.
    const withoutLibrary = bootstrap(bundle, seed, 1042, 'short');
    runYears(withoutLibrary, years);
    const compatible = replay(bundle, withoutLibrary.world.decisionLog, seed, 1042, years, 'short');
    expect(compatible.world.libraryMemories).toEqual([]);
    expect(digestOf(compatible)).toBe(digestOf(withoutLibrary));
    expect(digestOf(compatible)).not.toBe(digestOf(original));
  });

  it('replays the founding answer before the first year, including the five-name roster', () => {
    const seed = 910;
    const years = 120;
    const ctx = bootstrap(bundle, seed, 1042);
    const founding = {
      houseName: 'The House of Replay',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      friends: [
        { name: 'Iona Vale', sex: 'female' as const },
        { name: 'Corven Pike', sex: 'male' as const },
        { name: 'Sella Marr', sex: 'female' as const },
        { name: 'Toman Grey', sex: 'male' as const },
        { name: 'Eris Wren', sex: 'female' as const },
      ],
    };
    expect(foundHouse(ctx, founding).ok).toBe(true);
    runYears(ctx, years);

    expect(ctx.world.decisionLog[0]?.kind).toBe('founding');
    const replayed = replay(bundle, ctx.world.decisionLog, seed, 1042, years);

    expect(digestOf(replayed)).toBe(digestOf(ctx));
    expect(replayed.world.founding).toEqual(ctx.world.founding);
    expect(replayed.world.friends).toEqual(ctx.world.friends);
    expect(heldHeirlooms(replayed).map((h) => h.id)).toContain('portion_of_agelessness');
    expect(replayed.world.chronicle.some((entry) => entry.title === 'What Was Asked For')).toBe(true);
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
