import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  LADDER_BLOCKERS,
  eldritchPower,
  foremostOf,
  rungIndex,
  standingOf,
} from '../ascension.js';
import { phenotypeOf } from '../people/factory.js';
import { acquireLibraryCopy, canStudySpellbook } from '../people/library.js';
import { grantHeirloom } from '../people/heirlooms.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { place, testWorld } from '../testing.js';
import { order } from '../table.js';
import { digestOf } from '../save.js';
import { head, type SimCtx } from '../world.js';
import { measureDensity, diagnosticPeriod } from './density-gate.js';
import {
  traceDiagnosticIntervals, diagnosticIntervalLines,
  type DiagnosticYear, type DensityRun,
} from './density-report.js';
import {
  blockerActionability, blockerLevers, makeFailureTracker, makeStallClock,
  noteOrderAttempt, observeOrderAttempt, sampleStallClock,
} from './stall.js';
import {
  countNever, emptyStallRun, foldStallYear, readStallYear, type StallYear,
  emptyStallPopulation, observeStallPopulation, populationStats, stallReport,
} from './ladder-stall.js';

const bundle = loadContent();

function placedExpresser(
  ctx: SimCtx,
  accept: (power: number) => boolean = () => true,
) {
  for (let i = 0; i < 80; i++) {
    const p = place(ctx, {
      sex: 'male',
      age: 20,
      name: `Stall Candidate ${i}`,
      awakened: true,
    });
    const ph = phenotypeOf(p, ctx.genetics, ctx.world.year);
    if (ph.eldritch.canExpress && accept(eldritchPower(ctx, p))) return p;
  }
  throw new Error('fixture could not place an expresser with the requested power');
}

function makeOnlyExpresser(ctx: SimCtx, keep: string): void {
  for (const p of [...ctx.world.people.living()]) {
    if (p.id === keep) continue;
    if (!phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) continue;
    ctx.world.people.kill(p.id, ctx.world.year, 'stall instrument fixture');
  }
}

describe('#270 strategic-stall actionability', () => {
  it('maps every structured blocker without a prose fallback', () => {
    for (const blocker of LADDER_BLOCKERS) {
      expect(() => blockerLevers(blocker)).not.toThrow();
    }
  });

  it('calls a books blocker actionable only when the current climber can actually study a useful book', () => {
    const ctx = testWorld(bundle, 27001);
    const him = placedExpresser(ctx);
    makeOnlyExpresser(ctx, him.id);

    // Put the climber beyond the early power gates while leaving the reading
    // predicate empty. These are the same acquired layers the two rites use;
    // they do not change whether he is an expresser.
    him.acquired[ELDRITCH_GIFT] = 400;
    him.acquired[ELDRITCH_REACH] = 400;
    him.acquired.mind = 300;
    him.spellsKnown = [];
    him.phenotype = undefined;

    const book = ctx.content.spellbooks.find((def) => canStudySpellbook(ctx, him, def).ok);
    expect(book, 'fixture needs one book this awakened man can read').toBeTruthy();
    acquireLibraryCopy(ctx, String(book!.id));

    expect(foremostOf(ctx)?.person.id).toBe(him.id);
    expect(standingOf(ctx, him).blocker).toBe('books');

    const result = blockerActionability(ctx, 'books');
    expect(result.actionable).toBe(true);
    expect(result.verbs).toContain('study');

    const clock = makeStallClock();
    sampleStallClock(ctx, clock, 'books', him.id);
    expect(clock.actionableGap.books).toBe(0);
  });

  it('switches book actionability from the climber to the household only after Unmaking', () => {
    const ctx = testWorld(bundle, 27003);
    const him = placedExpresser(ctx);

    ctx.world.respect = 'exalted';
    him.acquired[ELDRITCH_GIFT] = 400;
    him.acquired[ELDRITCH_REACH] = 400;
    him.acquired.mind = 400;
    him.madness = 65;
    him.rites.push('vessel', 'great_rite');
    const demigodBookIds = [
      'lesser_workings_of_fluid',
      'lesser_workings_of_thermal',
      'lesser_workings_of_aero',
      'lesser_workings_of_terra',
      'lesser_workings_of_life',
      'lesser_workings_of_death',
      'the_marrow_codex',
    ];
    for (const id of demigodBookIds) {
      const def = ctx.content.spellbook(id);
      expect(def, `fixture is missing ${id}`).toBeTruthy();
      him.spellsKnown.push(def!.id);
    }
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');
    him.phenotype = undefined;

    const duplicate = ctx.content.spellbooks.find((def) =>
      !him.spellsKnown.some((known) => String(known) === String(def.id))
      && canStudySpellbook(ctx, him, def).ok);
    expect(duplicate, 'fixture needs one readable eighth book').toBeTruthy();

    // Someone else already knows the eighth book. Before Unmaking that does
    // NOT satisfy the climber's personal God reading: studying the shelf copy
    // himself moves his exact failed predicate and must count as actionable.
    const reader = place(ctx, { sex: 'male', age: 30, name: 'Another Reader' });
    reader.spellsKnown.push(duplicate!.id);
    ctx.world.library.clear();
    acquireLibraryCopy(ctx, String(duplicate!.id));

    const before = standingOf(ctx, him);
    expect(before.rung).toBe('demigod');
    expect(before.blocker).toBe('books');
    expect(blockerActionability(ctx, 'books', him.id).verbs).toContain('study');

    // Unmaking is the engine's switch to the living-family final circle. The
    // same shelf copy is now redundant because a living reader already knows
    // it, so Study no longer moves the book-count predicate.
    him.rites.push('unmaking');
    expect(blockerActionability(ctx, 'books', him.id).verbs).not.toContain('study');
  });

  it('counts repeated failed table orders for the same person and exact order', () => {
    const ctx = testWorld(bundle, 27004);
    const him = place(ctx, { sex: 'male', age: 20, name: 'Persistent Pupil' });
    const attempt = { kind: 'career', person: him.id, career: 'no_such_post' } as const;
    const tracker = makeFailureTracker();

    for (let i = 0; i < 2; i++) {
      const result = order(ctx, attempt);
      expect(result.ok).toBe(false);
      const observed = observeOrderAttempt(attempt, result);
      expect(observed).toBeTruthy();
      noteOrderAttempt(tracker, observed!);
    }

    expect(tracker.order).toBe(2);
  });

  it('wires real table-policy attempts into DensityRun.repeatedFailure.order', () => {
    let person: string | undefined;
    const run = measureDensity(bundle, 27005, 3, {
      tableOrder: (ctx) => {
        person ??= ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0]?.id;
        return person ? { kind: 'career', person, career: 'no_such_post' } : undefined;
      },
    });

    expect(run.repeatedFailure.campaign.order).toBe(3);
  });

  it('lets a real power blocker accumulate a gap when no Match or widening rite is offered', () => {
    const ctx = testWorld(bundle, 27002);
    const him = placedExpresser(ctx, (power) => power < 50);
    makeOnlyExpresser(ctx, him.id);
    // A normal expresser sits around the thirties on the ladder scale. Give
    // him the reading needed to clear Adept so the next unmet predicate is
    // still power, without depending on a near-zero expresser that the locus
    // table does not actually produce.
    him.spellsKnown = ctx.content.spellbooks.map((book) => book.id);
    him.phenotype = undefined;

    expect(foremostOf(ctx)?.person.id).toBe(him.id);
    expect(standingOf(ctx, him).blocker).toBe('power');
    expect(ctx.world.pendingDecisions.some((d) => d.kind === 'match')).toBe(false);

    const result = blockerActionability(ctx, 'power');
    expect(result).toEqual({ actionable: false, verbs: [] });

    const clock = makeStallClock();
    sampleStallClock(ctx, clock, 'power', him.id);
    sampleStallClock(ctx, clock, 'power', him.id);
    expect(clock.actionableGap.power).toBe(2);
  });
});

/**
 * `gate:stall`'s readings (#1801). The batch is a measurement, not a test; what
 * is tested is that each year lands in the bucket its fix lives in, because a
 * grown man waiting and a house with no expresser at all want different levers.
 */
describe('the ladder-stall instrument', () => {
  /** A house with nobody in it but the people a test places. */
  function emptyHouse(seed = 1801): SimCtx {
    const ctx = testWorld(bundle, seed);
    for (const p of ctx.world.people.living()) ctx.world.people.kill(p.id, ctx.world.year, 'before the test began');
    for (const p of ctx.world.people.all()) {
      p.castSlots = [];
      p.awakening = { ...p.awakening, awakened: false };
    }
    return ctx;
  }

  function expresser(ctx: SimCtx, age: number, stem: string, awakened: boolean) {
    for (let i = 0; i < 200; i++) {
      const p = place(ctx, { sex: 'male', age, name: `${stem}${i}`, awakened });
      if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) return p;
      ctx.world.people.kill(p.id, ctx.world.year, 'not the son this test needs');
      p.awakening = { ...p.awakening, awakened: false };
    }
    throw new Error(`no expressing ${stem} in 200 names`);
  }

  it('splits frozen years by what the house is waiting on, and counts each stretch once', () => {
    const run = emptyStallRun(1, 'chronicler');
    const year = (y: Partial<StallYear>): StallYear =>
      ({ expressers: 0, awake: 0, grownWaiting: 0, inWindow: 0, blocker: 'no-expresser', ...y });
    let streak = 0;
    for (const y of [
      year({ expressers: 1, grownWaiting: 1, inWindow: 1, blocker: 'awakening' }),
      year({ expressers: 1, grownWaiting: 1, blocker: 'awakening' }),
      year({}),
      year({ expressers: 1, blocker: 'awakening' }),
      year({ expressers: 1, awake: 1, blocker: 'power', rung: 'adept' }),
      year({}),
    ]) streak = foldStallYear(run, y, streak);

    expect(run).toMatchObject({
      years: 6, frozen: 5, grownWaiting: 2, pastWindow: 1, noExpresser: 2, onlyBoys: 1,
      stretches: 2, longest: 4, best: 'adept', expresserYears: 4, awakeYears: 1,
    });
    expect(run.blockers).toEqual({ awakening: 3, 'no-expresser': 2, power: 1 });
  });

  it('reads a grown man who has not woken as waiting, and a mundane declaration as not', () => {
    const ctx = emptyHouse();
    const him = expresser(ctx, 26, 'Waiting', false);
    expect(readStallYear(ctx)).toMatchObject({ expressers: 1, awake: 0, grownWaiting: 1, inWindow: 1, blocker: 'awakening' });

    him.awakening = { ...him.awakening, declaredMundane: true };
    expect(readStallYear(ctx)).toMatchObject({ expressers: 1, awake: 0, grownWaiting: 0 });

    expresser(ctx, 30, 'Woken', true);
    expect(readStallYear(ctx)).toMatchObject({ expressers: 2, awake: 1 });
  });

  it('counts a man dead past thirty who never woke as Never, and a young death as neither', () => {
    const ctx = emptyHouse();
    // The founding cast died in `emptyHouse`; only what this test adds is read.
    const before = emptyStallRun(1, 'chronicler');
    countNever(ctx, before);
    const old = expresser(ctx, 44, 'Never', false);
    const young = expresser(ctx, 24, 'Young', false);
    const woke = expresser(ctx, 50, 'Woke', true);
    for (const p of [old, young, woke]) ctx.world.people.kill(p.id, ctx.world.year, 'his time');

    const run = emptyStallRun(1, 'chronicler');
    countNever(ctx, run);
    expect(run.diedGrown - before.diedGrown).toBe(2);
    expect(run.diedNeverWoke - before.diedNeverWoke).toBe(1);
  });

  it('separates unwoken capacity, widened power, and household versus expresser reading', () => {
    const ctx = emptyHouse(180201);
    const waiting = expresser(ctx, 25, 'Waiting', false);
    const adept = expresser(ctx, 40, 'Widened', true);
    adept.acquired[ELDRITCH_GIFT] = 400;
    adept.acquired[ELDRITCH_REACH] = 400;
    adept.acquired.mind = 400;
    adept.madness = 65;
    adept.rites.push('vessel', 'great_rite');
    adept.spellsKnown = ctx.content.spellbooks.slice(0, 7).map((b) => b.id);
    adept.phenotype = undefined;
    const reader = place(ctx, { sex: 'female', age: 40, name: 'Household Reader' });
    reader.spellsKnown = ctx.content.spellbooks.map((b) => b.id);
    ctx.world.library.clear();
    acquireLibraryCopy(ctx, String(ctx.content.spellbooks[0]!.id));

    const sample = emptyStallPopulation(ctx);
    const widened = phenotypeOf(adept, ctx.genetics, ctx.world.year).eldritch.expressedPower;
    const unwoken = phenotypeOf(waiting, ctx.genetics, ctx.world.year).eldritch.expressedPower;
    phenotypeOf(reader, ctx.genetics, ctx.world.year);
    expect(rungIndex(standingOf(ctx, adept).rung)).toBeGreaterThanOrEqual(rungIndex('adept'));
    const before = digestOf(ctx);
    observeStallPopulation(ctx, sample);

    expect(sample).toMatchObject({
      campaign: 'long', maxPower: ctx.genetics.maxPower,
      raw: [unwoken, widened], awakeRaw: [widened], preRiteRaw: [unwoken], adeptRaw: [widened],
      shelfPeak: 1, readerPeak: ctx.content.spellbooks.length, expresserReaderPeak: 7,
    });
    expect(digestOf(ctx)).toBe(before);
  });

  it('reports empirical distributions without sorting raw evidence or replacing the saved best', () => {
    const raw = [9, 0, 3, 2, 8];
    expect(populationStats(raw)).toEqual({ n: 5, p50: 3, p90: 9, p99: 9, max: 9 });
    expect(raw).toEqual([9, 0, 3, 2, 8]);
    expect(populationStats([])).toEqual({ n: 0, p50: null, p90: null, p99: null, max: null });
    const ctx = emptyHouse();
    const run = emptyStallRun(1, 'chronicler');
    run.best = 'vessel';
    run.attainedBest = 'hierophant';
    run.population = emptyStallPopulation(ctx);
    const report = stallReport([run]).join('\n');
    expect(report).toContain('best rung: vessel 1');
    expect(report).toContain('saved best at least: {"adept":1,"hierophant":1,"vessel":0');
  });
});

function sample(year: number, overrides: Partial<DiagnosticYear> = {}): DiagnosticYear {
  return {
    year, period: 'unwoken', blocker: 'no-expresser', actionable: false,
    spine: false, choices: 0, matches: 0, records: 0, auctions: 0,
    orders: 0, routine: 0, ...overrides,
  };
}

describe('Regency and unwoken pacing (#1814)', () => {
  it('reads actual Regency from the seated woman, never from no-expresser alone', () => {
    const ctx = testWorld(loadContent().bundle);
    const incumbent = head(ctx.world);
    expect(incumbent).toBeDefined();
    incumbent!.castSlots = incumbent!.castSlots.filter((slot) => slot !== 'head');
    const regent = place(ctx, { sex: 'female', age: 36, castSlots: ['head'] });
    expect(diagnosticPeriod(ctx)).toBe('regency');

    // Removing the female Head leaves a vacancy, not a Regency or a Long Wait.
    regent.castSlots = [];
    expect(diagnosticPeriod(ctx)).toBeUndefined();
    incumbent!.castSlots.push('head');
  });

  it('distinguishes a non-regent Long Wait from an observed awakening', () => {
    const ctx = testWorld(loadContent().bundle);
    const incumbent = head(ctx.world);
    expect(incumbent).toBeDefined();
    expect(incumbent?.sex).toBe('male');
    const blood = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    for (const p of blood) p.awakening = { ...p.awakening, awakened: false };
    expect(diagnosticPeriod(ctx)).toBe('unwoken');

    // Witnessing a genuine expresser ends the diagnostic interval. The test
    // uses engine genetics only to construct its fixture, never to label an
    // unawakened person in the player-facing report.
    const expresser = blood.find((p) => p.sex === 'male'
      && phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress);
    expect(expresser).toBeDefined();
    expresser!.awakening = { ...expresser!.awakening, awakened: true };
    if (expresser!.phenotype) expresser!.phenotype.dirty = true;
    expect(diagnosticPeriod(ctx)).toBeUndefined();
  });

  it('sees a real offered Match as an interruption route, not an invented Table order', () => {
    const ctx = testWorld(loadContent().bundle);
    expect(blockerActionability(ctx, 'no-expresser').verbs).not.toContain('study');
    // This is a built-state offered docket: only the kind is inspected when
    // checking the no-expresser lever. There is no guessed future Match.
    ctx.world.pendingDecisions.push({ kind: 'match' } as typeof ctx.world.pendingDecisions[number]);
    const offered = blockerActionability(ctx, 'no-expresser');
    expect(offered).toMatchObject({ actionable: true, verbs: ['match'] });
  });

  it('counts dated consecutive spans, meaningful interruptions, and routine repeats', () => {
    const intervals = traceDiagnosticIntervals([
      sample(1100, { routine: 2 }),
      sample(1101, { actionable: true, spine: true, matches: 1 }),
      sample(1102, { routine: 3, blocker: 'awakening' }),
      sample(1103, { period: 'regency', spine: true, choices: 1, records: 1 }),
      sample(1104, { period: 'regency', routine: 2 }),
      sample(1105, { period: undefined }),
      sample(1106, { period: 'unwoken', auctions: 1, orders: 1, spine: true }),
    ]);
    expect(intervals).toHaveLength(3);
    expect(intervals[0]).toMatchObject({
      period: 'unwoken', from: 1100, to: 1102, years: 3,
      longestQuiet: 1, matches: 1, routine: 5,
      actionableYears: 1, blockedYears: 2,
      blockers: { 'no-expresser': 2, awakening: 1 },
    });
    expect(intervals[1]).toMatchObject({
      period: 'regency', from: 1103, to: 1104, years: 2,
      longestQuiet: 1, choices: 1, records: 1, routine: 2,
    });
    expect(intervals[2]).toMatchObject({
      period: 'unwoken', from: 1106, to: 1106, years: 1,
      longestQuiet: 0, auctions: 1, orders: 1,
    });
  });

  it('does not connect gaps in sampled years or count automatic and naming offers', () => {
    const intervals = traceDiagnosticIntervals([
      sample(1190, { spine: false }),
      sample(1192, { spine: false }),
      sample(1193, { period: undefined }),
    ]);
    expect(intervals.map((span) => [span.from, span.to, span.years])).toEqual([
      [1190, 1190, 1], [1192, 1192, 1],
    ]);
    const text = diagnosticIntervalLines([{
      term: 300, runs: [{
        seed: 5100, diagnosticIntervals: intervals,
      } as DensityRun],
    }]).join('\n');
    expect(text).toContain('REGENCY /');
    // Explanatory header rules out treating forms or automatic resolutions as player decisions.
    expect(text).toContain('automatic resolutions excluded');
    expect(text).toContain('5100');
    expect(text).toContain('1192');
  });
});
