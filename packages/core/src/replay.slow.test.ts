import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { LibraryRunS } from '@ed/schema';
import {
  applyRecord, bootstrap, commitOutcome, digestOf, emptyReport, foundHouse, heldHeirlooms, place, present,
  replay, ReplayMismatchError, runYears, testRng, testWorld, newGame, activeCommitment,
  saveGame, loadGame, expectHealthyWorld, setProseMode, setProseVariants,
} from '@ed/core';
import type { SlotFill } from './events/slots.js';
import { assertNever } from '@ed/schema';
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

  it('bounds a large requested span by the actual campaign ending (#1910)', () => {
    const s = newGame(bundle, { seed: 1910, campaign: 'demo', decider: 'chronicler' });
    const result = s.advance(Number.MAX_SAFE_INTEGER);
    expect(s.ctx.world.ending).toBeDefined();
    expect(result.years.length).toBeLessThanOrEqual(CAMPAIGNS.demo.years + 1);
    const rebuilt = replay(bundle, s.ctx.world.decisionLog, 1910, 1042, s.year - 1042, 'demo', [], {
      expectedDigest: digestOf(s.ctx),
    });
    expect(digestOf(rebuilt)).toBe(digestOf(s.ctx));
  });

  it('rebuilds a real played session with manual answers, names, party casts and Muster orders (#1910)', () => {
    let witnessed = false;
    const tried: unknown[] = [];
    for (const seed of SEEDS) {
      const s = newGame(bundle, { seed });
      let mustered = false;
      for (let turn = 0; turn < YEARS && !s.ctx.world.ending; turn += 1) {
        while (s.pending.length) {
          const d = s.pending[0]!;
          switch (d.kind) {
            case 'choice': {
              const cast: SlotFill = {};
              const used = new Set<string>();
              for (const request of d.cast) {
                const count = request.count?.min ?? (request.optional ? 0 : 1);
                if (!count) continue;
                const ids = request.candidates.filter(c => !used.has(c.id)).slice(0, count).map(c => c.id);
                for (const id of ids) used.add(id);
                if (ids.length) cast[request.slot] = request.count ? ids : ids[0]!;
              }
              const choice = d.event.id === 'the_muster_is_called'
                ? d.choices.find(c => c.id === 'send_them' && c.available)
                : d.choices.filter(c => c.available).at(-1);
              const result = d.choicesAreOpen && choice ? s.choose(d.id, choice.id, cast) : s.send(d.id, cast);
              if (!result.ok) s.letHimDecide();
              break;
            }
            case 'record':
              expect(s.record(d.id, d.options.some(o => o.option === 'embellish') ? 'embellish' : 'record').ok).toBe(true);
              break;
            case 'match': {
              let accepted = false;
              for (const card of d.cards) {
                if (s.match(d.id, card.id).ok) { accepted = true; break; }
              }
              if (!accepted) expect(s.declineHand(d.id)).toBe(true);
              break;
            }
            default: assertNever(d, 'played replay docket');
          }
          if (s.pending[0]?.id === d.id) throw new Error(`The real docket ${d.id} could not be answered`);
        }
        const names = [...s.ctx.world.pendingNames];
        if (names[0]) expect(s.name(names[0].person, `Wren ${names[0].person}`)).toBe(true);
        if (names[1]) expect(s.keepSuggestedName(names[1].person)).toBe(true);
        s.keepSuggestedNames();
        if (!mustered && activeCommitment(s.ctx)) {
          s.muster({ op: 'reinforce', men: 1 }); // capacity may already be full
          expect(s.muster({ op: 'buy', position: 'none' }).ok).toBe(true);
          expect(s.muster({ op: 'withdraw' }).ok).toBe(true);
          mustered = true;
        }
        const kinds = new Set(s.ctx.world.decisionLog.flatMap(row => row.kind === 'command' ? [row.command.kind] : []));
        const needed = ['choose', 'send', 'record', 'match', 'name'] as const;
        if (mustered && needed.every(kind => kinds.has(kind))) {
          const saved = saveGame(s.ctx);
          const rebuilt = replay(bundle, saved.decisionLog, seed, 1042, s.year - 1042, 'long', [], {
            expectedDigest: digestOf(s.ctx),
          });
          expect(digestOf(rebuilt)).toBe(digestOf(s.ctx));
          expect(rebuilt.world.muster).toEqual(s.ctx.world.muster);
          expect(rebuilt.world.pendingNames).toEqual(s.ctx.world.pendingNames);
          expect(rebuilt.world.pendingDecisions).toEqual(s.ctx.world.pendingDecisions);
          expectHealthyWorld(rebuilt);
          witnessed = true;
          break;
        }
        s.advance();
      }
      tried.push({ seed, year: s.year, mustered, kinds: [...new Set(s.ctx.world.decisionLog
        .flatMap(row => row.kind === 'command' ? [row.command.kind] : []))] });
      if (witnessed) break;
    }
    expect(witnessed, `the real seed set supplied no complete player-input/Muster witness: ${JSON.stringify(tried)}`).toBe(true);
  });

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

  it('rebuilds successful interventions, preserves their saved words and rejects changed facts (#1868)', () => {
    // The witness is the first seed in a fixed range whose ordinary campaign
    // reaches an intervention with a local actor; nothing is injected into the
    // replay's bootstrap inputs. A range rather than one seed (#1867): adding
    // the opening concern re-rolled every run, and the seed this test was
    // pinned to stopped reaching one. About one Short Line in twelve does by
    // 175 years, so a hundred seeds leaves no realistic chance of finding none.
    const years = 175;
    const witness = (() => {
      for (let seed = 186800; seed < 186900; seed++) {
        const ctx = bootstrap(bundle, seed, 1042, 'short');
        runYears(ctx, years);
        if (ctx.world.decisionLog.some(row => row.kind === 'outcome' && row.primordial)) return { seed, ctx };
      }
      return undefined;
    })();
    if (!witness) throw Error('no campaign in the witness range exercised an intervention');
    const { seed, ctx: original } = witness;
    const intervention = original.world.decisionLog.find(row => row.kind === 'outcome' && row.primordial);
    if (intervention?.kind !== 'outcome' || !intervention.primordial) throw Error('campaign did not exercise an intervention');
    intervention.primordial.receipt = 'The words retained in the earlier private account.';
    intervention.primordial.manifestation = 'The manifestation as it was first written.';
    const rebuilt = replay(bundle, original.world.decisionLog, seed, 1042, years, 'short');
    expect(digestOf(rebuilt)).toBe(digestOf(original));
    const altered = structuredClone(original.world.decisionLog);
    const row = altered.find(row => row.kind === 'outcome' && row.primordial);
    if (row?.kind !== 'outcome' || !row.primordial) throw Error('missing copied intervention');
    row.primordial.actor = 'a_person_who_was_not_there';
    expect(() => replay(bundle, altered, seed, 1042, years, 'short')).toThrow(ReplayMismatchError);
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
