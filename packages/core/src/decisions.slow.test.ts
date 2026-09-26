import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  bootstrap, stepYear, runYears, makeRng,
  resolveChoice, resolveRecord, applyRecord, autoResolveAll, autoResolveDecision,
  type PendingChoice, type PendingRecord,
} from '@ed/core';
import { CAMPAIGN_YEARS } from './campaign.js';
import { delegationDensityLines, measureDensity, type DensityRun } from './tools/density-gate.js';

const bundle = loadContent();

/**
 * Play forward until the docket holds the kind of decision we want, letting
 * the chronicler answer everything else. Note that it has to answer them: the
 * year does not turn while a decision stands, so a test that ignores the
 * docket sits on the same year until the loop gives up.
 */
function stepUntilDecision(seed: number, kind: 'choice' | 'record', limit = 800) {
  const ctx = bootstrap(bundle, seed, 1042);
  const rng = makeRng(seed);
  for (let i = 0; i < limit; i++) {
    stepYear(ctx, false);
    let guard = 0;
    while (ctx.world.pendingDecisions.length && guard++ < 50) {
      const found = ctx.world.pendingDecisions.find((d) => d.kind === kind);
      if (found) return { ctx, decision: found };
      autoResolveDecision(ctx, ctx.world.pendingDecisions[0]!, rng);
    }
  }
  return { ctx, decision: undefined };
}

/**
 * PLAYER CHOICE.
 *
 * `stepYear(ctx, autoResolve)` picked a choice at random and moved on, which
 * meant the one verb the design is built around was the one thing the engine
 * did for you. The Record block was authored in a dozen templates and read by
 * nothing at all.
 *
 * The failure mode here is silence in both directions: a docket nothing ever
 * puts anything on, and a docket nothing can ever clear.
 */
describe('the docket', () => {
  it('parks choice events instead of answering them', () => {
    const { decision } = stepUntilDecision(1042, 'choice');
    expect(decision, 'no choice event fired in 600 years').toBeDefined();
    const choice = decision as PendingChoice;
    expect(choice.choices.length).toBeGreaterThan(1);
    expect(choice.body).not.toMatch(/\{[A-Z_]+\}/);   // slots rendered, not raw tokens
  });

  it('does not turn the year while a decision stands', () => {
    const { ctx, decision } = stepUntilDecision(1042, 'choice');
    expect(decision).toBeDefined();
    const year = ctx.world.year;

    const blocked = stepYear(ctx, false);
    expect(blocked.year).toBe(year);
    expect(blocked.blocked?.length).toBeGreaterThan(0);
    expect(ctx.world.year, 'the clock ran past an open decision').toBe(year);

    autoResolveAll(ctx, makeRng(1));
    stepYear(ctx, false);
    expect(ctx.world.year).toBe(year + 1);
  });

  it('applies the choice the player actually made', () => {
    const { ctx, decision } = stepUntilDecision(77, 'choice');
    const pending = decision as PendingChoice;
    expect(pending).toBeDefined();

    const open = pending.choices.find((c) => c.available)!;
    const before = ctx.world.chronicle.length;
    const res = resolveChoice(ctx, pending.id, open.id, makeRng(9));

    expect(res.ok).toBe(true);
    expect(res.resolved?.event.id).toBe(pending.event.id);
    expect(ctx.world.chronicle.length).toBeGreaterThan(before);
    expect(ctx.world.pendingDecisions.some((d) => d.id === pending.id)).toBe(false);
  });

  it('refuses a choice that is not on the card', () => {
    const { ctx, decision } = stepUntilDecision(909, 'choice');
    const pending = decision as PendingChoice;
    const res = resolveChoice(ctx, pending.id, 'no_such_choice', makeRng(3));
    expect(res.ok).toBe(false);
    expect(ctx.world.pendingDecisions.some((d) => d.id === pending.id), 'the decision was dropped anyway').toBe(true);
  });

  /** Spending the ration twice would let one event eat a whole tier. */
  it('spends the frequency ration exactly once', () => {
    const { ctx, decision } = stepUntilDecision(5150, 'choice');
    const pending = decision as PendingChoice;
    const tier = pending.event.frequency;
    const before = ctx.world.frequency.firedThisRun[tier];
    resolveChoice(ctx, pending.id, pending.choices.find((c) => c.available)!.id, makeRng(4));
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);
  });
});

describe('record, omit, embellish', () => {
  it('asks about the record after the event that earned one', () => {
    const { decision } = stepUntilDecision(1042, 'record');
    expect(decision, 'no record block was ever offered').toBeDefined();
    const rec = decision as PendingRecord;
    expect(rec.options.map((o) => o.option)).toEqual(['record', 'omit', 'embellish']);
  });

  /**
   * The chronicle is not a log of what happened. It is what the family SAYS
   * happened, and there is only ever one line about a thing — so the record
   * choice rewrites the event's entry rather than adding a second one.
   */
  it('rewrites the event entry rather than appending a second', () => {
    const { ctx, decision } = stepUntilDecision(77, 'record');
    const rec = decision as PendingRecord;
    const before = ctx.world.chronicle.length;
    const mine = ctx.world.chronicle.filter((c) => c.eventId === rec.event.id).length;

    expect(resolveRecord(ctx, rec.id, 'record').ok).toBe(true);
    expect(ctx.world.chronicle.length).toBe(before);
    expect(ctx.world.chronicle.filter((c) => c.eventId === rec.event.id).length).toBe(mine);
  });

  /** An omission is a DATED BLANK LINE, not a missing line. */
  it('leaves a dated blank when the family omits something', () => {
    // 909 stopped reaching a record decision within 800 years once this
    // session's land content (issue #91) re-rolled every draw in the run;
    // 910 is confirmed to reach one, with an `omit` option, against current
    // content.
    const { ctx, decision } = stepUntilDecision(910, 'record');
    const rec = decision as PendingRecord;
    resolveRecord(ctx, rec.id, 'omit');
    const entry = [...ctx.world.chronicle].reverse().find((c) => c.eventId === rec.event.id);
    expect(entry).toBeDefined();
    expect(entry!.text).toBeNull();
    expect(entry!.record).toBe('omit');
    expect(entry!.year).toBe(rec.year);
  });

  it('opens a discrepancy when the family embellishes', () => {
    const { ctx, decision } = stepUntilDecision(5150, 'record');
    const rec = decision as PendingRecord;
    const id = rec.options.find((o) => o.option === 'embellish')!.discrepancy!;
    resolveRecord(ctx, rec.id, 'embellish');
    expect(ctx.world.discrepancies.get(id)?.state).toBe('open');
  });

  it('grants the knowledge an honest record was written for', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const withKnowledge = bundle.events.find((e) => e.record?.options.record.grantsKnowledge);
    expect(withKnowledge, 'no event grants knowledge through its record').toBeDefined();
    applyRecord(ctx, withKnowledge!, 'test-entry', 'record');
    expect(ctx.world.knowledge.has(withKnowledge!.record!.options.record.grantsKnowledge!)).toBe(true);
  });

  /** Nothing read the block at all, so none of its effects had ever run. */
  it('exercises all three options over an auto-resolved run', () => {
    // 1042 breaks its own line at 1129 under the corrected blood count
    // (issue #42), well inside this test's 1000-year window, thinning the
    // variety of record types a shortened run gets to see. 901 is confirmed
    // to reach the full Long Line against the current `main`.
    const ctx = bootstrap(bundle, 901, 1042);
    runYears(ctx, CAMPAIGN_YEARS);
    const written = ctx.world.chronicle.filter((c) => c.record !== undefined);
    expect(written.length, 'no record block resolved in a Long Line').toBeGreaterThan(0);
    expect(new Set(written.map((c) => c.record)).size).toBeGreaterThan(1);
  });
});

describe('auto-resolve is the same path', () => {
  /**
   * Two code paths for "answer this event" is two places for the rules to
   * drift. Auto-resolve and the player both go through `commitOutcome`, and
   * the cheapest proof of that is that a run answered by the chronicler and a
   * run answered by nobody both reach the term with a chronicle.
   */
  it('reaches the end of the run either way', () => {
    const auto = bootstrap(bundle, 8080, 1042);
    runYears(auto, 400);

    const asked = bootstrap(bundle, 8080, 1042);
    for (let i = 0; i < 400; i++) {
      stepYear(asked, false);
      autoResolveAll(asked, makeRng(asked.world.year));
    }

    // EITHER PATH CAN NOW BREAK THE LINE FIRST (issue #42). The two paths
    // resolve decisions through genuinely different RNG streams — this
    // test's own hand-rolled `autoResolveAll` seeding versus `stepYear`'s
    // internal one — so they were always free to diverge demographically;
    // it just never showed, because nothing could stop either clock before
    // year 1442. Now one can legitimately reach `broken_line` while the
    // other does not, and a divergence explained by an ending on one side
    // is not a bug in either commit path — it is what "both go through
    // commitOutcome" predicts once the outcomes themselves can differ.
    expect(
      asked.world.year === auto.world.year || Boolean(asked.world.ending) || Boolean(auto.world.ending),
      `asked stopped at ${asked.world.year}, auto at ${auto.world.year}, with no ending set on either`,
    ).toBe(true);
    expect(asked.world.chronicle.length).toBeGreaterThan(0);
    expect(asked.world.pendingDecisions).toHaveLength(0);
  });

  it('leaves the docket empty in auto mode', () => {
    const ctx = bootstrap(bundle, 31, 1042);
    runYears(ctx, 500);
    expect(ctx.world.pendingDecisions).toHaveLength(0);
  });
});

const DELEGATION_SEEDS = [901, 902] as const;
const DELEGATION_TERMS = [500, 300] as const;


function sumDelegation(runs: DensityRun[], pick: (run: DensityRun) => number): number {
  return runs.reduce((total, run) => total + pick(run), 0);
}

/**
 * ISSUE #219'S PAIRED MEASUREMENT.
 *
 * Same seeds, same first-choice/plain-Record player, same term. The delegated
 * column differs in one thing only: after the player answers an ordinary event
 * once, that exact answer becomes a standing preference. Important repeats are
 * still surfaced by mustSurface(), so their count must not move.
 *
 * Reproduce the printed table directly with:
 *   npm run gate:density -- --delegation --seeds=901,902 500 300
 */
describe('delegation reduces routine interruption without thinning the meaningful stream (#219)', () => {
  const content = loadContent().bundle;
  let rows: {
    term: number;
    before: DensityRun[];
    after: DensityRun[];
  }[] = [];

  beforeAll(() => {
    rows = DELEGATION_TERMS.map((term) => ({
      term,
      before: DELEGATION_SEEDS.map((seed) => measureDensity(content, seed, term)),
      after: DELEGATION_SEEDS.map((seed) => measureDensity(content, seed, term, { delegateRoutine: true })),
    }));
    // Measurement evidence belongs in the CI log as numbers, not only as an
    // assertion whose pass/fail hides how much changed.
    for (const line of delegationDensityLines(rows)) console.log(`[delegation-density] ${line}`);
  }, 900_000);

  for (const term of DELEGATION_TERMS) {
    it(`delegates repeated low-stakes choices across the ${term}-year line`, () => {
      const row = rows.find((candidate) => candidate.term === term)!;
      const before = sumDelegation(row.before, (run) => run.choices);
      const after = sumDelegation(row.after, (run) => run.choices);
      expect(after, `${term}y surfaced ${after} choices after delegation vs ${before} before`)
        .toBeLessThan(before);
    });

    it(`delegates repeated plain Record prompts across the ${term}-year line`, () => {
      const row = rows.find((candidate) => candidate.term === term)!;
      const before = sumDelegation(row.before, (run) => run.records);
      const after = sumDelegation(row.after, (run) => run.records);
      expect(after, `${term}y surfaced ${after} Record prompts after delegation vs ${before} before`)
        .toBeLessThan(before);
    });

    it(`keeps every consequential choice and Record interruption across the ${term}-year line`, () => {
      const row = rows.find((candidate) => candidate.term === term)!;
      expect(sumDelegation(row.after, (run) => run.meaningfulChoices))
        .toBe(sumDelegation(row.before, (run) => run.meaningfulChoices));
      expect(sumDelegation(row.after, (run) => run.meaningfulRecords))
        .toBe(sumDelegation(row.before, (run) => run.meaningfulRecords));
    });
  }
});


