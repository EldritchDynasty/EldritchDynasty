import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { readRunLibrary, SAVE_FORMAT, SavedGameS } from '@ed/schema';
import { CURRENT_SAVE_FIXTURE_GZIP_BASE64 } from './fixtures/current-save.fixture';
import {
  END_YEAR, LIBRARY_VOICE_FORMS, addGrudge, bootstrap, closeTheLedger, digest, digestOf, foundHouse, libraryClaimsContradict, libraryRunOf, loadGame, place, runYears,
  saveGame, SaveFormatError, stepYear, viewOf,
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

  it('round-trips the selected campaign instead of silently restoring Long', () => {
    const before = bootstrap(content, 1042, 1042, 'short');
    const saved = JSON.parse(JSON.stringify(saveGame(before)));

    expect(saved.campaign).toBe('short');
    const after = loadGame(saved, content);
    expect(after.world.campaign).toBe('short');
  });

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
