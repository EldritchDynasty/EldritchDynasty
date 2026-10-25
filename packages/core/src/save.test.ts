import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash, readRunLibrary, SAVE_FORMAT, SavedGameS } from '@ed/schema';
import { createProseRuntime } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';
import { CURRENT_SAVE_FIXTURE_GZIP_BASE64 } from './fixtures/current-save.fixture';
import {
  CAMPAIGNS, END_YEAR, LIBRARY_VOICE_FORMS, addGrudge, beget, bootstrap, closeTheLedger, digest, digestOf, foundHouse, libraryClaimsContradict, libraryRunOf, loadGame, place, replay, runYears,
  saveGame, SaveFormatError, stepYear, viewOf, order, resolveChoice, resolveRecord, testRng,
} from '@ed/core';

const content = loadContent();

/**
 * A PLAYTHROUGH IS TEN HOURS AND HAD NO SAVE.
 *
 * These tests are about the thing that makes one possible: the world being a
 * value. The failure mode they exist for is not a crash — it is a field that
 * quietly does not persist, so a house loads with its grudges forgotten, its
 * frequency ration reset, or its docket empty, and plays on looking perfectly
 * healthy.
 */
describe('a run survives being written down', () => {
  /**
   * The saved format is a contract, not merely a number. This fixture makes a
   * version bump deliberate: `SAVE_FORMAT` can move only alongside a save
   * regenerated at the new version.
   */
  it('loads the checked-in save at the current format', () => {
    const raw = JSON.parse(gunzipSync(Buffer.from(CURRENT_SAVE_FIXTURE_GZIP_BASE64, 'base64')).toString('utf8'));

    expect(raw.format).toBe(SAVE_FORMAT);
    expect(() => loadGame(raw, content)).not.toThrow();
  });

  it('round-trips a fresh world exactly', () => {
    const before = bootstrap(content, 1042, 1042);
    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(digestOf(after)).toBe(digestOf(before));
  });

  it('reads format 37 without inventing field service, foreign spending or injuries', () => {
    const before = bootstrap(content, 1874, 1042);
    const legacy = { ...saveGame(before), format: 37 };
    const original = structuredClone(legacy);
    const after = loadGame(legacy, content);
    expect(after.world.mystic.foreignSpent).toBeUndefined();
    expect(after.world.people.all().every(p => p.fieldRecoveryUntil === undefined)).toBe(true);
    expect(after.world.muster.commitments).toEqual([]);
    expect(saveGame(after).format).toBe(SAVE_FORMAT);
    expect(legacy).toEqual(original);
  });

  it('reads format 35 without inventing captives or changing the input', () => {
    const before = bootstrap(content, 1042, 1042);
    const legacy = { ...saveGame(before), format: 35 };
    const original = structuredClone(legacy);
    const after = loadGame(legacy, content);
    expect(saveGame(after).format).toBe(SAVE_FORMAT);
    expect(after.world.people.all().some(person => person.captivity)).toBe(false);
    expect(digestOf(after)).toBe(digestOf(before));
    expect(legacy).toEqual(original);
  });

  it('reads format 36 without inventing historical session inputs', () => {
    const before = bootstrap(content, 1042, 1042);
    const legacy = { ...saveGame(before), format: 36 };
    const original = structuredClone(legacy);
    const after = loadGame(legacy, content);
    expect(saveGame(after).format).toBe(SAVE_FORMAT);
    expect(after.world.decisionLog.some(row => row.kind === 'command')).toBe(false);
    expect(digestOf(after)).toBe(digestOf(before));
    expect(legacy).toEqual(original);
  });

  it('reads format 31 without inventing an unrecorded forcing attempt', () => {
    const before = bootstrap(content, 1042, 1042);
    const legacy = { ...saveGame(before), format: 31 };
    for (const person of legacy.people) delete person.awakening.forcingTried;
    const after = loadGame(JSON.parse(JSON.stringify(legacy)), content);
    expect(saveGame(after).format).toBe(SAVE_FORMAT);
    expect(digestOf(after)).toBe(digestOf(before));
    expect(after.world.people.all().some((person) => person.awakening.forcingTried)).toBe(false);
    expect(legacy.format).toBe(31);
  });

  it.each([false, true])('recovers a completed format-31 rite only when its cast was saved (%s)', (hasCast) => {
    const ctx = bootstrap(content, 18170, 1042);
    const boy = place(ctx, { sex: 'male', age: 12 });
    expect(order(ctx, { kind: 'forcingRite', rite: 'the_seven_lamp_vigil', person: boy.id }).ok).toBe(true);
    const choice = ctx.world.pendingDecisions.find((decision) => decision.kind === 'choice')!;
    expect(resolveChoice(ctx, choice.id, 'put_out_the_lamps', testRng('legacy-completed')).ok).toBe(true);
    const record = ctx.world.pendingDecisions.find((decision) => decision.kind === 'record')!;
    expect(resolveRecord(ctx, record.id, 'omit').ok).toBe(true);
    expect(ctx.world.pendingDecisions).toHaveLength(0);
    const legacy = JSON.parse(JSON.stringify(saveGame(ctx)));
    legacy.format = 31;
    delete legacy.people.find((person: { id: string }) => person.id === boy.id).awakening.forcingTried;
    const result = legacy.decisionLog.find((entry: { kind: string; event?: string }) =>
      entry.kind === 'outcome' && entry.event === 'the_seven_lamp_vigil');
    expect(result.fill.CHILD).toBe(boy.id);
    if (!hasCast) result.fill = {};
    const resumed = loadGame(legacy, content);
    expect(resumed.world.people.get(boy.id)!.awakening.forcingTried).toBe(hasCast ? true : undefined);
    expect(order(resumed, { kind: 'forcingRite', rite: 'the_dark_year_fast', person: boy.id }).ok).toBe(!hasCast);
  });

  it.each(['choice', 'record'] as const)('keeps a format-31 Vigil %s and its promised odds', (kind) => {
    const ctx = bootstrap(content, 1817, 1042);
    const boy = place(ctx, { sex: 'male', age: 12 });
    const event = structuredClone(content.events.find((entry) => entry.id === 'the_seven_lamp_vigil')!);
    if (event.interaction.kind !== 'choice') throw new Error('Vigil is not a choice');
    delete event.forcing;
    const full = event.interaction.choices[0]!;
    full.outcomes = full.outcomes.filter((outcome) => ['woke', 'died'].includes(outcome.id));
    for (const outcome of full.outcomes) {
      delete outcome.onlyIf;
      outcome.weight = outcome.id === 'woke' ? 68 : 32;
    }
    const legacy = JSON.parse(JSON.stringify(saveGame(ctx)));
    legacy.format = 31;
    legacy.pendingDecisions = [kind === 'choice' ? {
      kind, id: 'old_vigil', year: ctx.world.year, event,
      body: 'The old question already shown.', fill: { CHILD: boy.id },
      choices: [], cast: [],
    } : {
      kind, id: 'old_vigil', year: ctx.world.year, event,
      subject: 'The old Record already shown.', options: [], entryId: 'old_page',
      fill: { CHILD: boy.id },
    }];
    const resumed = loadGame(legacy, content);
    const pending = resumed.world.pendingDecisions[0]!;
    if (pending.kind === 'match') throw new Error('wrong docket');
    expect(pending.event).toEqual({ ...event, forcing: { slot: 'CHILD', called: true } });
    expect(resumed.world.people.get(boy.id)!.awakening.forcingTried).toBe(kind === 'record' ? true : undefined);
    if (pending.kind === 'choice') {
      expect(pending.body).toBe('The old question already shown.');
      expect(resolveChoice(resumed, pending.id, 'put_out_the_lamps', testRng('old-vigil')).ok).toBe(true);
      expect(resumed.world.people.get(boy.id)!.awakening.forcingTried).toBe(true);
    } else expect(pending.subject).toBe('The old Record already shown.');
    expect(legacy.pendingDecisions[0].event.forcing).toBeUndefined();
  });

  it('keeps conception ordinals after a loss and isolates their saved copies (#1581)', () => {
    const before = bootstrap(content, 1581, 1042);
    const mother = place(before, { sex: 'female', age: 25, name: 'Mother of the lost child' });
    before.world.conceptionOrdinals[mother.id] = 3;
    const saved = saveGame(before);
    const after = loadGame(JSON.parse(JSON.stringify(saved)), content);
    expect(after.world.conceptionOrdinals[mother.id]).toBe(3);
    expect(digestOf(after)).toBe(digestOf(before));

    after.world.conceptionOrdinals[mother.id] = 4;
    expect(before.world.conceptionOrdinals[mother.id]).toBe(3);
    expect(saved.conceptionOrdinals[mother.id]).toBe(3);
    expect(digestOf(after)).not.toBe(digestOf(before));
    saved.conceptionOrdinals[mother.id] = 5;
    expect(before.world.conceptionOrdinals[mother.id]).toBe(3);
    expect(after.world.conceptionOrdinals[mother.id]).toBe(4);

    const missing = JSON.parse(JSON.stringify(saved));
    delete missing.conceptionOrdinals;
    expect(() => loadGame(missing, content)).toThrow(/conceptionOrdinals/);
  });

  it('keeps a counter derived entirely from living children out of the fingerprint (#1581)', () => {
    const ctx = bootstrap(content, 1582, 1042);
    const mother = place(ctx, { sex: 'female', age: 25 });
    beget(ctx, place(ctx, { sex: 'female', age: 2 }), mother);
    beget(ctx, place(ctx, { sex: 'male', age: 1 }), mother);
    const original = digestOf(ctx);
    for (const alreadyRepresented of [0, 1, 2]) {
      ctx.world.conceptionOrdinals[mother.id] = alreadyRepresented;
      expect(digestOf(ctx)).toBe(original);
    }
    ctx.world.conceptionOrdinals[mother.id] = 3;
    expect(digestOf(ctx)).not.toBe(original);
  });

  it('repairs a pre-#391 founded save with the founding decision needed for replay', () => {
    const before = bootstrap(content, 391, 1042);
    const choice = {
      houseName: 'The House Before the Log',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
      friends: [
        { name: 'Alys', sex: 'female' as const },
        { name: 'Bennet', sex: 'male' as const },
      ],
    };
    expect(foundHouse(before, choice).ok).toBe(true);

    // Migrate a save from a run that has actually moved on, rather than only
    // the untouched 1042 founding state. This makes the compatibility proof
    // cover replay after the friend windows and ordinary decision log have
    // had time to evolve.
    const years = 120;
    runYears(before, years);

    // Model a current-format save written before #391: all durable founding
    // state exists, but the new external-answer entry does not.
    const legacy = JSON.parse(JSON.stringify(saveGame(before)));
    legacy.decisionLog = legacy.decisionLog.filter((decision: { kind: string }) => decision.kind !== 'founding');

    const loaded = loadGame(legacy, content);
    expect(loaded.world.decisionLog[0]).toEqual({
      kind: 'founding',
      year: 1042,
      houseName: choice.houseName,
      heirloom: choice.heirloom,
      grudge: choice.grudge,
      friends: choice.friends,
    });
    expect(loaded.world.decisionLog.filter((decision) => decision.kind === 'founding')).toHaveLength(1);

    const rebuilt = replay(content, loaded.world.decisionLog, loaded.world.seed, 1042, years);
    expect(digestOf(rebuilt)).toBe(digestOf(loaded));
  });

  it('round-trips non-empty delegation preferences and their Chronicle audit trail', () => {
    const before = bootstrap(content, 219, 1042);
    before.world.delegation.choices.routine_choice = 'pay';
    before.world.delegation.records.routine_record = 'record';
    before.world.chronicle.push({
      year: before.world.year,
      weight: 'paragraph',
      text: 'The house paid, and later wrote it plainly.',
      eventId: 'routine_choice',
      named: false,
      delegated: 'choice:pay|record:record',
    });

    const saved = JSON.parse(JSON.stringify(saveGame(before)));
    expect(saved.delegation).toEqual({
      choices: { routine_choice: 'pay' },
      records: { routine_record: 'record' },
    });
    expect(saved.chronicle.at(-1)?.delegated).toBe('choice:pay|record:record');

    const after = loadGame(saved, content);
    expect(after.world.delegation).toEqual(before.world.delegation);
    expect(after.world.chronicle.at(-1)?.delegated).toBe('choice:pay|record:record');
  });

  it('round-trips Chronicle causes, Bearing pages, and grudge origin pages', () => {
    const before = bootstrap(content, 269, 1042);
    const ours = before.world.people.household(before.world.playerHouse, before.world.year)[0]!;
    const theirs = place(before, { sex: 'male', age: 40, name: 'Witness', house: 'house_marrow' });

    before.world.chronicle.push({
      id: 'chr_origin',
      year: 1042,
      weight: 'paragraph',
      text: null,
      named: false,
      record: 'omit',
    }, {
      id: 'chr_answer',
      year: 1067,
      weight: 'line',
      text: 'Years later, the omitted thing returned.',
      named: false,
      cause: { year: 1042, page: 'chr_origin' },
    });
    before.world.bearing.acts.push({
      year: 1042,
      kind: 'wrote_it_larger',
      about: 'the omitted account',
      page: 'chr_origin',
      echoed: true,
    });
    addGrudge(before, theirs.id, ours.id, {
      severity: 40,
      inheritance: 'house_wide',
    }, 'an_old_claim', 'chr_origin');

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(after.world.chronicle.find((entry) => entry.id === 'chr_answer')?.cause)
      .toEqual({ year: 1042, page: 'chr_origin' });
    expect(after.world.bearing.acts[0]?.page).toBe('chr_origin');
    expect([...after.world.relationships.values()][0]?.grudges[0]?.originPage).toBe('chr_origin');
  });

  it('round-trips Chronicle cast links for family-to-book navigation', () => {
    const before = bootstrap(content, 268, 1042);
    const person = before.world.people.household(before.world.playerHouse, before.world.year)[0]!;
    before.world.chronicle.push({
      id: 'chr_people_roundtrip',
      year: before.world.year,
      weight: 'paragraph',
      text: person.name + ' was named on this page.',
      named: false,
      people: [person.id],
    });

    const saved = JSON.parse(JSON.stringify(saveGame(before)));
    expect(saved.format).toBe(SAVE_FORMAT);
    expect(saved.chronicle.at(-1)?.people).toEqual([person.id]);

    const after = loadGame(saved, content);
    expect(after.world.chronicle.at(-1)?.people).toEqual([person.id]);
  });

  it.each(['short', 'demo'] as const)(
    'round-trips the selected %s campaign instead of silently restoring Long',
    (campaign) => {
      const before = bootstrap(content, 1042, 1042, campaign);
      const saved = JSON.parse(JSON.stringify(saveGame(before)));

      expect(saved.campaign).toBe(campaign);
      const after = loadGame(saved, content);
      expect(after.world.campaign).toBe(campaign);
    },
  );

  it('round-trips a run four hundred years in', () => {
    const before = bootstrap(content, 909, 1042);
    runYears(before, 400);
    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(digestOf(after)).toBe(digestOf(before));
  });

  /**
   * The one that matters. A save that restores every FIELD but not the
   * generative state — id counters, the taken-name set, the frequency ledgers —
   * reloads into a world that looks right and then diverges, which is the same
   * class of bug as the module-level id counter in invariant 8.
   */
  it('continues identically after loading', () => {
    const original = bootstrap(content, 5150, 1042);
    runYears(original, 300);

    const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(original))), content);
    runYears(original, 120);
    runYears(reloaded, 120);

    expect(digestOf(reloaded)).toBe(digestOf(original));
  });

  /**
   * A rite is an ACT, recorded on the man who took it (issue #43), and rungs
   * four to six read it as their last requirement. A field that does not
   * persist would reload a Vessel as a Hierophant with no way to become one
   * again — the ladder falling a rung on a load, silently, centuries in.
   */
  it('carries the rites a man has taken', () => {
    const before = bootstrap(content, 4242, 1042);
    const him = before.world.people.living().find((p) => p.castSlots.includes('head'))!;
    him.rites.push('vessel');

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(after.world.people.get(him.id)?.rites).toEqual(['vessel']);
  });

  /**
   * Issue #126: `taught` is the durable mark a tutor's term leaves, distinct
   * from `acquired` — a save that dropped it would reload a schooled child as
   * an unschooled one with no way to tell the two apart again.
   */
  it('carries which attributes a term has actually completed on', () => {
    const before = bootstrap(content, 4242, 1042);
    const her = before.world.people.living()[0]!;
    her.taught.push('mind');

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(after.world.people.get(her.id)?.taught).toEqual(['mind']);
  });

  it('carries the rent term and this year\'s parcel risk across a save', () => {
    const before = bootstrap(content, 4242, 1042);
    before.world.rentsPolicy = 'rack';
    const parcel = [...before.world.parcels.values()][0]!;
    parcel.yieldFactor = 0.37;

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(after.world.rentsPolicy).toBe('rack');
    expect(after.world.parcels.get(parcel.id)?.yieldFactor).toBe(0.37);
  });

  it('keeps the pedigree walkable after a load', () => {
    const before = bootstrap(content, 77, 1042);
    runYears(before, 250);
    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);

    // The kin index is rebuilt on load, not saved, so this is the assertion
    // that the rebuild actually happens.
    for (const p of before.world.people.all()) {
      const kids = before.world.people.children(p.id).length;
      expect(after.world.people.children(p.id).length, `${p.name}'s children`).toBe(kids);
    }
    const anyParent = before.world.people.all().find((p) => before.world.people.children(p.id).length > 1);
    expect(anyParent, 'nobody in 250 years had two children').toBeDefined();
  });

  it('carries an open docket across the save', () => {
    const ctx = bootstrap(content, 1042, 1042);
    // Ask rather than auto-resolve, until something is actually standing open.
    for (let i = 0; i < 400 && !ctx.world.pendingDecisions.length; i++) stepYear(ctx, false);
    expect(ctx.world.pendingDecisions.length, 'no decision was ever raised').toBeGreaterThan(0);

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(after.world.pendingDecisions.map((d) => d.id))
      .toEqual(ctx.world.pendingDecisions.map((d) => d.id));

    // And it still blocks the clock on the other side.
    const year = after.world.year;
    const report = stepYear(after, false);
    expect(report.blocked?.length).toBeGreaterThan(0);
    expect(after.world.year).toBe(year);
  });

  it('preserves every queued choice decider and openness through schema parse and load (#1380)', () => {
    const original = bootstrap(content, 1380, 1042);
    const base = JSON.parse(JSON.stringify(saveGame(original)));
    const authored = content.events.find((event) => event.interaction.kind === 'choice');
    if (!authored || authored.interaction.kind !== 'choice') throw new Error('no authored choice template');

    const deciders = [
      'player',
      'chance',
      { party: { check: 'an_authored_check' } },
      { state: [{ take: authored.interaction.choices[0]!.id }] },
    ] as const;

    for (const decidedBy of deciders) {
      const saved = structuredClone(base);
      const event = JSON.parse(JSON.stringify(authored));
      event.interaction.decidedBy = decidedBy;
      saved.pendingDecisions = [{
        kind: 'choice',
        id: 'dec_pending_save',
        year: original.world.year,
        event,
        body: 'The question remains unanswered.',
        fill: {},
        choices: [],
        cast: [],
        decidedBy,
        // Preserve the exact queued flag, even when it differs from the
        // derived fallback for a historically missing field.
        choicesAreOpen: false,
      }];
      const parsed = SavedGameS.parse(saved);
      expect(parsed.pendingDecisions[0]).toMatchObject({
        kind: 'choice', decidedBy, choicesAreOpen: false,
      });
      const loaded = loadGame(saved, content);
      expect(loaded.world.pendingDecisions[0]).toMatchObject({
        kind: 'choice', decidedBy, choicesAreOpen: false,
      });
      expect(saveGame(loaded).pendingDecisions[0]).toMatchObject({
        kind: 'choice', decidedBy, choicesAreOpen: false,
      });
    }
  });

  it('recovers pre-#1380 choice fields from the saved event, never assuming party means player', () => {
    const original = bootstrap(content, 1381, 1042);
    const base = JSON.parse(JSON.stringify(saveGame(original)));
    const authored = content.events.find((event) => event.interaction.kind === 'choice');
    if (!authored || authored.interaction.kind !== 'choice') throw new Error('no authored choice template');

    for (const [decidedBy, expectedOpen] of [
      ['player', true],
      ['chance', false],
      [{ party: { check: 'an_authored_check' } }, false],
      [{ state: [{ take: authored.interaction.choices[0]!.id }] }, false],
    ] as const) {
      const saved = structuredClone(base);
      const event = JSON.parse(JSON.stringify(authored));
      event.interaction.decidedBy = decidedBy;
      saved.pendingDecisions = [{
        kind: 'choice', id: 'dec_legacy', year: original.world.year, event,
        body: 'An old unanswered question.', fill: {}, choices: [], cast: [],
      }];
      const parsed = SavedGameS.parse(saved).pendingDecisions[0];
      expect(parsed).toMatchObject({ kind: 'choice', decidedBy, choicesAreOpen: expectedOpen });
      const restored = loadGame(saved, content);
      expect(restored.world.pendingDecisions[0]).toMatchObject({
        kind: 'choice', decidedBy, choicesAreOpen: expectedOpen,
      });
    }

    // A narration historically has only the chance branch.
    const narration = content.events.find((event) => event.interaction.kind === 'narration');
    if (!narration) throw new Error('no authored narration template');
    const legacy = structuredClone(base);
    legacy.pendingDecisions = [{
      kind: 'choice', id: 'dec_narration', year: original.world.year,
      event: structuredClone(narration), body: 'One result.',
      fill: {}, choices: [], cast: [],
    }];
    expect(SavedGameS.parse(legacy).pendingDecisions[0]).toMatchObject({
      kind: 'choice', decidedBy: 'chance', choicesAreOpen: false,
    });
    expect(loadGame(legacy, content).world.pendingDecisions[0]).toMatchObject({
      kind: 'choice', decidedBy: 'chance', choicesAreOpen: false,
    });

    // Never guess a player decider from a malformed or unknown saved interaction.
    legacy.pendingDecisions[0].event.interaction = { kind: 'missing_decider' };
    expect(SavedGameS.safeParse(legacy).success).toBe(false);
    expect(() => loadGame(legacy, content)).toThrow(SaveFormatError);
  });

  it('validates against its own schema', () => {
    const ctx = bootstrap(content, 31, 1042);
    runYears(ctx, 150);
    expect(() => SavedGameS.parse(JSON.parse(JSON.stringify(saveGame(ctx))))).not.toThrow();
  });

  it('loads a current-format save at the new term and closes it normally', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    save.year = END_YEAR;
    save.ending = undefined;

    const resumed = loadGame(save, content);
    expect(resumed.world.year).toBe(END_YEAR);
    expect(resumed.world.ending).toBeUndefined();

    stepYear(resumed);
    expect(resumed.world.year).toBe(END_YEAR);
    expect(resumed.world.ending).toBeDefined();
  });

  it('refuses a structurally current save that is already beyond the new term', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    save.year = END_YEAR + 1;

    expect(() => loadGame(save, content))
      .toThrow(new SaveFormatError(`save year ${END_YEAR + 1} is beyond the long campaign term ${END_YEAR}`));
  });

  it('refuses a demo save beyond the demonstration term', () => {
    const ctx = bootstrap(content, 323, CAMPAIGNS.demo.startYear, 'demo');
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    save.year = CAMPAIGNS.demo.endYear + 1;

    expect(() => loadGame(save, content)).toThrow(
      new SaveFormatError(
        `save year ${CAMPAIGNS.demo.endYear + 1} is beyond the demo campaign term ${CAMPAIGNS.demo.endYear}`,
      ),
    );
  });

  it('refuses an ended save whose ending is beyond the new term', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    save.ending = { id: 'forgotten', year: END_YEAR + 1 };

    expect(() => loadGame(save, content))
      .toThrow(new SaveFormatError(`save ending year ${END_YEAR + 1} is beyond the long campaign term ${END_YEAR}`));
  });

  it('refuses a save when referenced authored content disappeared, and names its former file', () => {
    const ctx = bootstrap(content, 1042, 1042);
    // Frequency ledgers keep event ids as OBJECT KEYS. This is the easy class
    // of reference for a generic value walker to miss while every ordinary
    // array/string test stays green.
    ctx.world.frequency.templateFires.the_drowning = 1;
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));

    expect(save.contentSources).toContainEqual(['the_drowning', 'events/rites.yaml']);

    const withoutDrowning = {
      ...content.bundle,
      events: content.bundle.events.filter((event) => event.id !== 'the_drowning'),
    };
    expect(() => loadGame(save, withoutDrowning)).toThrow(
      new SaveFormatError("save references missing content 'the_drowning' (formerly events/rites.yaml)"),
    );
  });

  it('records provenance for compiled inline arcs that can be active in a save', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const inline = content.arcs.find((arc) => arc.inline);
    expect(inline, 'the content bundle has no compiled inline arc to exercise').toBeDefined();

    ctx.world.arcs.set('provenance-inline', {
      id: 'provenance-inline',
      arc: inline!.id,
      node: inline!.entry,
      bindings: {},
      localFlags: {},
      startedYear: ctx.world.year,
      history: [],
      status: 'active',
    });

    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    const formerFile = content.sourceOf(inline!.id);
    expect(formerFile, 'a compiled inline arc lost the YAML provenance of its root event').toBeDefined();
    expect(save.contentSources).toContainEqual([inline!.id, formerFile]);

    const root = content.events.find((event) => {
      const outcomes = event.interaction.kind === 'narration'
        ? event.interaction.outcomes
        : event.interaction.choices.flatMap((choice) => choice.outcomes);
      return outcomes.some((outcome) => outcome.triggers?.arc === inline!.id);
    });
    expect(root, 'could not find the authored root that compiled this inline arc').toBeDefined();

    const withoutRoot = {
      ...content.bundle,
      events: content.bundle.events.filter((event) => event.id !== root!.id),
    };
    expect(() => loadGame(save, withoutRoot)).toThrow(
      new SaveFormatError(`save references missing content '${inline!.id}' (formerly ${formerFile!})`),
    );
  });

  it('does not make an old save depend on authored content it never referenced', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));
    const referenced = new Set<string>(save.contentSources.map(([id]: [string, string]) => id));
    const unused = content.bundle.events.find((event) => !referenced.has(event.id));
    expect(unused, 'a fresh save somehow references every authored event').toBeDefined();

    const withoutUnused = {
      ...content.bundle,
      events: content.bundle.events.filter((event) => event.id !== unused!.id),
    };
    expect(() => loadGame(save, withoutUnused)).not.toThrow();
  });

  it('loads pre-provenance format-24 saves without inventing former files', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const { contentSources: _contentSources, ...oldSave } = saveGame(ctx);

    const loaded = loadGame(JSON.parse(JSON.stringify(oldSave)), content);
    expect(loaded.world.year).toBe(ctx.world.year);
  });

  it('refuses a save it cannot read, and says which field', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const save = JSON.parse(JSON.stringify(saveGame(ctx)));

    expect(() => loadGame({ ...save, format: 99 }, content))
      .toThrow(new SaveFormatError(`save format 99, expected ${SAVE_FORMAT}`));

    delete save.counters;
    expect(() => loadGame(save, content)).toThrow(/counters/);
  });

  /**
   * Issue #8's own warning about itself: "decisionLog goes into SavedGameS.
   * Omitting it does not fail; it resets silently on load." The digest tests
   * above would catch that too, but an aggregate hash mismatch does not say
   * WHICH field reset — this does.
   */
  it('round-trips the decision log', () => {
    const before = bootstrap(content, 1042, 1042);
    runYears(before, 300);
    expect(before.world.decisionLog.length, 'nothing was logged in 300 years').toBeGreaterThan(0);

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), content);
    expect(after.world.decisionLog).toEqual(before.world.decisionLog);
  });

  /**
   * THE ONE THE DIGEST CANNOT SEE.
   *
   * Every test above compares two digests, and `digest` is computed from
   * `saveGame`'s output — so it covers "every field the format knows about",
   * exactly as its own comment says. That is the whole hole. Add a field to
   * `WorldState` and to `createWorld`, and forget `SavedGameS`/`saveGame`, and
   * the field is not in the format, so it is not in the digest, so every
   * round-trip test above still passes — while the field silently resets to
   * its starting value on load. CLAUDE.md names this failure by name ("it
   * makes the field reset silently on load, which looks exactly like a
   * subsystem that stopped working two centuries in") and nothing tested it.
   *
   * So this compares the world against the save by KEY rather than by value,
   * on a world old enough to have set its optional fields. It is a tripwire,
   * not a proof: it fires when someone adds state to the world and does not
   * carry it across the boundary, and the fix is either to save the field or
   * to add it to `DERIVED` below with a reason.
   */
  describe('every field on the world crosses the boundary', () => {
    /**
     * Fields that live on the world and are deliberately NOT saved, because
     * they are rebuilt from content on load. Invariant 6's rule at the save
     * boundary: derived state is not storage, and a save carrying it could
     * disagree with the content it was loaded against.
     */
    const DERIVED: Record<string, string> = {
      houses: 'rebuilt from `content.houses` by createWorld — authored data, not run state',
    };

    /** On the save and not on the world: the envelope, and state that lives on `SimCtx`. */
    const SAVE_ONLY: Record<string, string> = {
      format: 'the format version — the envelope, not the world',
      savedAt: 'a timestamp — the envelope, not the world',
      takenNames: 'lives on SimCtx beside the world, not on it',
      contentSources: 'load-safety provenance derived from the serialized save and authored bundle',
      replayOrigin: 'initial archived rendering provenance on SimCtx, superseded by the first input',
    };

    /** Old enough that `narrator`, `guardianSince`, `headSince` and `respectChanged` are all set. */
    function agedWorld() {
      const ctx = bootstrap(content, 1042, 1042);
      runYears(ctx, 400);
      return ctx;
    }

    it('persists every key the world carries, or declares why not', () => {
      const ctx = agedWorld();
      const saved = new Set(Object.keys(saveGame(ctx)));

      const unsaved = Object.keys(ctx.world).filter((k) => !saved.has(k) && !(k in DERIVED));
      expect(
        unsaved,
        'these fields are on the world and in no save: they will reset to their starting '
          + 'value on load, silently, and the run will look healthy while they do. Add them to '
          + '`SavedGameS` and `saveGame`/`loadGame`, or to DERIVED above with a reason.',
      ).toEqual([]);
    });

    it('carries nothing in the save that is neither world state nor envelope', () => {
      const ctx = agedWorld();
      const onWorld = new Set(Object.keys(ctx.world));

      const stray = Object.keys(saveGame(ctx)).filter((k) => !onWorld.has(k) && !(k in SAVE_ONLY));
      expect(stray, 'the save carries a key that is not on the world — it will load into nothing')
        .toEqual([]);
    });

    it('holds the derived list to its word: it really is rebuilt, not restored', () => {
      const ctx = agedWorld();
      const after = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);

      for (const key of Object.keys(DERIVED)) {
        expect(after.world[key as keyof typeof after.world], `${key} came back empty from a load`)
          .toBeDefined();
      }
      // `houses` specifically: same houses, rebuilt from the content passed in.
      expect([...after.world.houses.keys()].sort()).toEqual([...ctx.world.houses.keys()].sort());
    });

    /**
     * The optional fields are the half a key comparison can miss: one that is
     * never set is simply absent from the object, so nothing notices it is
     * also absent from the save. This pins the sample the tripwire runs on —
     * if a future change stops setting one of these in four hundred years,
     * this fails and says the guard above went blind rather than green.
     */
    it('runs on a world that has actually set its optional fields', () => {
      const w = agedWorld().world as unknown as Record<string, unknown>;
      for (const key of ['narrator', 'guardianSince', 'headSince', 'respectChanged']) {
        expect(key in w, `${key} was never set in 400 years — the guard above no longer covers it`)
          .toBe(true);
      }
    });

    /**
     * The two ends of the run are optional for the same reason and covered by
     * nothing above: a world nobody founded never sets `founding`, and a world
     * that has not reached 2042 never sets `ending`, so four hundred years of
     * ordinary simulation leaves the tripwire blind to both. This is the
     * sample that has them — and issue #38's acceptance is precisely that they
     * are still there when the save comes back.
     */
    it('carries the two ends of the run across the boundary', () => {
      const ctx = bootstrap(content, 1042, 1042);
      foundHouse(ctx, {
        houseName: 'The House of Salt',
        heirloom: 'portion_of_agelessness',
        grudge: 'house_marrow',
      });
      ctx.world.year = END_YEAR;
      closeTheLedger(ctx);

      const after = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);

      expect(after.world.founding).toEqual(ctx.world.founding);
      expect(after.world.ending).toEqual(ctx.world.ending);
      expect(after.world.ending?.year).toBe(END_YEAR);
    });
  });

  it('keeps the Long-Line digest byte-compatible when campaign identity is explicit', () => {
    const ctx = bootstrap(content, 1042, 1042, 'long');
    const current = saveGame(ctx);
    const { campaign: _campaign, ...legacy } = current;

    // A format-22 save written before #66 has no campaign field and means Long.
    // The explicit default must not change its fingerprint.
    expect(digest(current)).toBe(digest(legacy as unknown as typeof current));
  });

  it('keeps an unsigned format-28 save byte-compatible with format 27', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const beforeFounding = saveGame(ctx);
    expect(digest(beforeFounding)).toBe(digest({
      ...beforeFounding,
      format: 27,
    } as unknown as typeof beforeFounding));

    foundHouse(ctx, {
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
    });
    const current = saveGame(ctx);
    const { answers: _answers, ...legacyFounding } = current.founding!;
    expect(digest(current)).toBe(digest({
      ...current,
      format: 27,
      founding: legacyFounding,
    } as unknown as typeof current));
  });

  it('keeps content provenance out of the deterministic digest', () => {
    const ctx = bootstrap(content, 1042, 1042);
    ctx.world.frequency.templateFires.the_drowning = 1;
    const saved = saveGame(ctx);
    expect(saved.contentSources.length).toBeGreaterThan(0);

    expect(digest(saved)).toBe(digest({ ...saved, contentSources: [] }));
  });

  it('gives different runs different digests', () => {
    const a = bootstrap(content, 1042, 1042);
    const b = bootstrap(content, 1043, 1042);
    runYears(a, 60);
    runYears(b, 60);
    expect(digest(saveGame(a))).not.toBe(digest(saveGame(b)));
  });
});


function finishedLibraryHouse() {
  const ctx = bootstrap(content, 7001, 1042, 'short');
  const person = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]!;
  ctx.world.founding = {
    houseName: 'The House That Wrote It Larger',
    heirloom: 'portion_of_agelessness',
    grudge: 'house_marrow',
    answers: {},
    year: 1042,
  };
  ctx.world.discrepancies.set('old_lie', {
    severity: 'major',
    provableBy: ['the_church'],
    state: 'buried',
  });
  ctx.world.chronicle.push({
    id: 'old_page',
    year: 1201,
    weight: 'paragraph',
    title: 'The Untroubled Son',
    text: `${person.name} came through the old rite untouched, and there was no madness in him.`,
    named: true,
    record: 'embellish',
    discrepancyId: 'old_lie',
    claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 0 }],
  });
  ctx.world.ending = { id: 'forgotten', year: 1342 };
  return { ctx, person };
}

describe('the Library of Houses', () => {
  it('has one authored voice for each of the seven tale forms', () => {
    expect(LIBRARY_VOICE_FORMS).toEqual([
      'song', 'doctrine', 'rival_chronicle', 'rhyme', 'play', 'footnote', 'charm',
    ]);
    expect(new Set(LIBRARY_VOICE_FORMS).size).toBe(7);
  });

  it('mints imported memory ids from the world-local library counter', () => {
    const { ctx } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;
    const second = bootstrap(content, 7004, 1042, 'short', [run]);

    expect(second.world.counters.library).toBe(second.world.libraryMemories.length);
    expect(second.world.libraryMemories.map((memory) => memory.id)).toEqual(
      second.world.libraryMemories.map((_, index) => `library_memory_${(index + 1).toString(36)}`),
    );
  });

  it('extracts only what the finished family book exposed', () => {
    const { ctx, person } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;

    expect(run.house).toBe('The House That Wrote It Larger');
    const oldPage = run.entries.find((entry) => entry.id === 'old_page');
    expect(oldPage, 'the deliberately embellished page was not archived').toBeDefined();
    expect(oldPage!.people[person.id]).toBe(person.name);
    expect(oldPage!.discrepancy).toEqual({ id: 'old_lie', state: 'buried' });

    const wire = JSON.stringify(run);
    expect(wire).not.toContain('trueParents');
    expect(wire).not.toContain('genome');
    expect(wire).not.toContain('treasury');
  });

  it('seeds a later account that contradicts the old claim field-for-field', () => {
    const { ctx } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;
    const second = bootstrap(content, 7001, 1042, 'short', [run]);

    const memory = second.world.libraryMemories[0];
    expect(memory, 'the old house left no account in the second run').toBeDefined();
    expect(memory!.sourceHouse).toBe(run.house);
    expect(memory!.text).toContain(memory!.sourceText);

    const contradicts = memory!.sourceClaims.some((oldClaim) =>
      memory!.claims.some((newClaim) => libraryClaimsContradict(oldClaim, newClaim)));
    expect(contradicts, 'the retelling changed words without contradicting a closed claim').toBe(true);

    const heard = viewOf(second).tales.find((tale) => tale.id === memory!.id);
    expect(heard, 'the imported account never reached the ordinary tales surface').toBeDefined();
    expect(heard!.source?.house).toBe(run.house);
    expect(heard!.claims).toEqual(memory!.claims);
  });

  it('changes the digest on the same seed only when something was inherited', () => {
    const { ctx } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;
    const empty = bootstrap(content, 7003, 1042, 'short', []);
    const seeded = bootstrap(content, 7003, 1042, 'short', [run]);

    expect(seeded.world.libraryMemories.length).toBeGreaterThan(0);
    expect(digestOf(seeded)).not.toBe(digestOf(empty));
    expect(viewOf(seeded).tales.some((tale) => tale.source?.house === run.house)).toBe(true);
  });

  it('saves the chosen snapshot so later library changes cannot rewrite the run', () => {
    const { ctx } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;
    const second = bootstrap(content, 7002, 1042, 'short', [run]);
    const before = second.world.libraryMemories.map((memory) => ({ ...memory }));

    const resumed = loadGame(saveGame(second), content);
    expect(resumed.world.libraryMemories).toEqual(before);
  });

  it('drops malformed historical entries instead of failing a new run', () => {
    const parsed = readRunLibrary({
      format: 1,
      runs: [{
        id: 'good-run',
        seed: 1,
        campaign: 'short',
        endedYear: 1342,
        house: 'House Good',
        ending: { id: 'forgotten', title: 'Forgotten' },
        entries: [
          {
            id: 'good',
            said: 'A line remained.',
            year: 1200,
            claims: [{ kind: 'trait', person: 'p_1', trait: 'marked', has: true }],
          },
          { id: 'bad', said: '', year: 'not a year', claims: [] },
        ],
      }, {
        id: 4,
        seed: 'wrong',
        entries: [],
      }],
    });

    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]!.entries).toHaveLength(1);
    expect(parsed.runs[0]!.entries[0]!.id).toBe('good');
  });

  it('does not move the historical digest when the installation library is empty', () => {
    const empty = bootstrap(content, 8118, 1042, 'long', []);
    // digest() normalizes format 23 + an empty additive field back to the
    // format-22 fingerprint. Existing golden digest tests therefore remain
    // the independent guard that this value really is today's behaviour.
    expect(empty.world.libraryMemories).toEqual([]);
    expect(digestOf(empty)).toBe(digestOf(bootstrap(content, 8118, 1042, 'long')));
  });
});

describe('the Library of Houses retells in the reader\'s setting (#846)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./run-library.ts', import.meta.url), 'utf8'));

  it('keys one whole sentence per voice and reading, plus each teller, bias and fallback', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual({
      'library.subject_unknown': 'the person named there',
      'library.song.teller': 'the household singers of {RIVAL}',
      'library.song.bias': 'keeping the version {RIVAL} has found pleasant to remember',
      'library.song.kept':
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, the old words are kept entire. The first singer's name is gone.",
      'library.song.attr':
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON}'s {QUALITY} is entered as {VALUE}. The first singer's name is gone.",
      'library.song.trait_with':
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON} is entered with {TRAIT}. The first singer's name is gone.",
      'library.song.trait_without':
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON} is entered without {TRAIT}. The first singer's name is gone.",
      'library.song.death':
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON}'s death is entered in {YEAR}. The first singer's name is gone.",
      'library.doctrine.teller': "the chaplain who keeps {RIVAL}'s old books",
      'library.doctrine.bias': "making the inherited account sit obediently inside {RIVAL}'s doctrine",
      'library.doctrine.kept':
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: the old words are kept entire. No earlier hand is named.',
      'library.doctrine.attr':
        "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON}'s {QUALITY} is entered as {VALUE}. No earlier hand is named.",
      'library.doctrine.trait_with':
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON} is entered with {TRAIT}. No earlier hand is named.',
      'library.doctrine.trait_without':
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON} is entered without {TRAIT}. No earlier hand is named.',
      'library.doctrine.death':
        "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON}'s death is entered in {YEAR}. No earlier hand is named.",
      'library.rival_chronicle.teller': 'the archivist of {RIVAL}',
      'library.rival_chronicle.bias': "keeping {RIVAL}'s inherited account of the old house",
      'library.rival_chronicle.kept':
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where the old words are kept entire; and leaves the disagreement without apology.",
      'library.rival_chronicle.attr':
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON}'s {QUALITY} is entered as {VALUE}; and leaves the disagreement without apology.",
      'library.rival_chronicle.trait_with':
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON} is entered with {TRAIT}; and leaves the disagreement without apology.",
      'library.rival_chronicle.trait_without':
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON} is entered without {TRAIT}; and leaves the disagreement without apology.",
      'library.rival_chronicle.death':
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON}'s death is entered in {YEAR}; and leaves the disagreement without apology.",
      'library.rhyme.teller': "the children of {RIVAL}'s lower hall",
      'library.rhyme.bias': "keeping only what {RIVAL}'s children can carry from one winter to the next",
      'library.rhyme.kept':
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: the old words are kept entire. They do not know whose book taught them.",
      'library.rhyme.attr':
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON}'s {QUALITY} is entered as {VALUE}. They do not know whose book taught them.",
      'library.rhyme.trait_with':
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON} is entered with {TRAIT}. They do not know whose book taught them.",
      'library.rhyme.trait_without':
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON} is entered without {TRAIT}. They do not know whose book taught them.",
      'library.rhyme.death':
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON}'s death is entered in {YEAR}. They do not know whose book taught them.",
      'library.play.teller': "the players retained for {RIVAL}'s winter feast",
      'library.play.bias': "turning an old house's dignity into the version {RIVAL} will applaud",
      'library.play.kept':
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that the old words are kept entire. The audience laughs at a quarrel older than the script.",
      'library.play.attr':
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON}'s {QUALITY} is entered as {VALUE}. The audience laughs at a quarrel older than the script.",
      'library.play.trait_with':
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON} is entered with {TRAIT}. The audience laughs at a quarrel older than the script.",
      'library.play.trait_without':
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON} is entered without {TRAIT}. The audience laughs at a quarrel older than the script.",
      'library.play.death':
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON}'s death is entered in {YEAR}. The audience laughs at a quarrel older than the script.",
      'library.footnote.teller': "an unnamed annotator in {RIVAL}'s library",
      'library.footnote.bias': "correcting the old house from the safety of {RIVAL}'s margin",
      'library.footnote.kept':
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: the old words are kept entire. The ink is younger than the page and older than any living witness.",
      'library.footnote.attr':
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON}'s {QUALITY} is entered as {VALUE}. The ink is younger than the page and older than any living witness.",
      'library.footnote.trait_with':
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON} is entered with {TRAIT}. The ink is younger than the page and older than any living witness.",
      'library.footnote.trait_without':
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON} is entered without {TRAIT}. The ink is younger than the page and older than any living witness.",
      'library.footnote.death':
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON}'s death is entered in {YEAR}. The ink is younger than the page and older than any living witness.",
      'library.charm.teller': 'the nurses of {RIVAL}, from one nursery to the next',
      'library.charm.bias': "keeping the inherited warning useful to {RIVAL}'s children",
      'library.charm.kept':
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: the old words are kept entire. None remembers when the last line entered the charm.',
      'library.charm.attr':
        "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON}'s {QUALITY} is entered as {VALUE}. None remembers when the last line entered the charm.",
      'library.charm.trait_with':
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON} is entered with {TRAIT}. None remembers when the last line entered the charm.',
      'library.charm.trait_without':
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON} is entered without {TRAIT}. None remembers when the last line entered the charm.',
      'library.charm.death':
        "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON}'s death is entered in {YEAR}. None remembers when the last line entered the charm.",
      'library.rival_unknown': 'a rival house',
    });
  });

  it('seeds the same memories in Plain English, with only the words changed', () => {
    const { ctx } = finishedLibraryHouse();
    const run = libraryRunOf(ctx)!;
    const plain = createProseRuntime('plainenglish', keyed.map((entry) => ({
      address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
    })));
    const original = bootstrap(content, 7001, 1042, 'short', [run]).world.libraryMemories;
    const read = bootstrap(content, 7001, 1042, 'short', [run], undefined, plain).world.libraryMemories;

    expect(original.length).toBeGreaterThan(0);
    expect(read).toEqual(original.map((memory) => ({
      ...memory,
      text: `plain: ${memory.text}`,
      teller: `plain: ${memory.teller}`,
      bias: `plain: ${memory.bias}`,
    })));
  });
});
