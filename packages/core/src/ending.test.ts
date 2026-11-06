import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  CAMPAIGNS, END_YEAR, GOD_RITE_FAILED, closeTheLedger, digestOf, endingSummary, epilogueOf, foundHouse, place, missingPlainEnglish,
  prologueView, readTheChronicle, selectEnding, setProseMode, setProseVariants, stepYear, testWorld,
} from '@ed/core';
import { asId, MAIN_BRANCH, contentProseEntries, ENDING_ORDER, proseOriginalAt, proseOriginalHash, type BranchState, type EndingId, type Rung } from '@ed/schema';
import type { ChronicleEntry, SimCtx } from './world.js';
import { afterimageEvidence } from './afterimage.js';
import { coreMessageAddress } from './messages.js';
import { rungTitle } from './ascension.js';
import { CADET_AGE } from './people/branches.js';

const content = loadContent();

/** A house sitting at the term, with the founding cast in it and nothing written. */
function atTheTerm(seed = 9001): SimCtx {
  return testWorld(content, seed, END_YEAR);
}

/**
 * A page of the book that says the house stood somewhere, AND the standing it
 * is a record of.
 *
 * `tickAscension` writes the two together — the page the year the house first
 * stands somewhere new, and `world.ascension.best` in the same breath — so a
 * fixture that wrote only the page was describing a state the simulation
 * cannot produce. That went unnoticed while `attested` was the only thing read
 * off it; issue #77 made the truth underneath a page load-bearing, because
 * `substantiated` is now capped by it. Use `forge` for a page with nothing
 * under it, which is the whole of what #77 added.
 */
function attest(ctx: SimCtx, rung: Rung, year = ctx.world.year - 40): void {
  forge(ctx, rung, year);
  ctx.world.ascension.best = rung;
}

/** A page claiming a rung the house never stood on. The book, lying. */
function forge(ctx: SimCtx, rung: Rung, year = ctx.world.year - 40): void {
  ctx.world.chronicle.push({
    year,
    weight: 'paragraph',
    title: 'A Rung',
    text: `Somebody stood where nobody of the blood had stood before, and they called it ${rung}.`,
    named: false,
    rung,
  });
}

/**
 * THE CREDITOR READS THE CHRONICLE, NOT THE WORLD.
 *
 * §6 is explicit and it is the whole thesis of the game, and it is exactly the
 * kind of rule that gets implemented as `world.ascension.best` by accident and
 * then passes every test anybody thinks to write — because for a house that
 * wrote everything down the two numbers are the same.
 *
 * So the tests that matter here are the ones where they differ.
 */
describe('the last night reads the book', () => {
  it('ignores what the house became and asks what the book can show', () => {
    const ctx = atTheTerm();
    // The house genuinely made a god. The book does not mention it.
    ctx.world.ascension.best = 'god';
    ctx.world.ascension.rung = 'god';

    expect(readTheChronicle(ctx).attested).toBe('none');
    expect(selectEnding(ctx)).toBe('forgotten');

    // One page, and the same world ends four rungs away.
    attest(ctx, 'god');
    expect(readTheChronicle(ctx).attested).toBe('god');
    expect(selectEnding(ctx)).toBe('apotheosis');
  });

  it('does not offer Apotheosis to A Short Line even when the book substantiates God', () => {
    const ctx = atTheTerm();
    ctx.world.campaign = 'short';
    ctx.world.year = CAMPAIGNS.short.endYear;
    attest(ctx, 'god');

    expect(readTheChronicle(ctx).substantiated).toBe('god');
    expect(selectEnding(ctx)).toBe('devoured');
  });

  it('does not count a page that is known to have existed and gone', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    expect(selectEnding(ctx)).toBe('devoured');

    // Greyed: the entry is still in the book as a thing that WAS (concept §6),
    // and it is no longer evidence of anything.
    ctx.world.chronicle[ctx.world.chronicle.length - 1]!.greyed = true;
    expect(selectEnding(ctx)).toBe('forgotten');
  });

  it('counts the blanks as pages read, and never as evidence', () => {
    const ctx = atTheTerm();
    ctx.world.chronicle.push({ year: 1500, weight: 'paragraph', text: null, named: false, record: 'omit' });

    const r = readTheChronicle(ctx);
    expect(r.blanks).toBe(1);
    expect(r.attested).toBe('none');
  });
});

/**
 * An imported Chronicle may have pages whose dates are beyond the current
 * reading. The creditor must not count or quote testimony not yet written.
 */
describe('a creditor cannot read future Chronicle pages (#2656)', () => {
  it('accepts a same-year God attestation, never a future one', () => {
    const ctx = atTheTerm();
    ctx.world.ascension.best = 'god';
    ctx.world.ascension.rung = 'god';
    forge(ctx, 'god', ctx.world.year + 1);

    expect(readTheChronicle(ctx).attested).toBe('none');
    expect(readTheChronicle(ctx).attestedYear).toBeUndefined();
    expect(selectEnding(ctx)).toBe('forgotten');

    ctx.world.chronicle.at(-1)!.year = ctx.world.year;
    const r = readTheChronicle(ctx);
    expect(r.attested).toBe('god');
    expect(r.attestedYear).toBe(ctx.world.year);
    expect(r.substantiated).toBe('god');
    expect(selectEnding(ctx)).toBe('apotheosis');
  });

  it('ignores future blanks and authored lies, while keeping standing discrepancies visible', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant', ctx.world.year);
    const baseline = readTheChronicle(ctx);
    const id = 'future_embellishment';
    ctx.world.discrepancies.set(id, { severity: 'total', provableBy: [], state: 'open' });
    ctx.world.chronicle.push({
      year: ctx.world.year + 1, weight: 'paragraph', text: 'The house wrote a later claim.',
      named: false, record: 'embellish', discrepancyId: id,
    });
    ctx.world.chronicle.push({
      year: ctx.world.year + 1, weight: 'paragraph', text: null,
      named: false, record: 'omit',
    });

    const earlier = readTheChronicle(ctx);
    expect(earlier.pages).toBe(baseline.pages);
    expect(earlier.blanks).toBe(baseline.blanks);
    expect(earlier.embellished).toBe(baseline.embellished);
    expect(earlier.standingLies).toBe(baseline.standingLies + 1);
    expect(earlier.unsupportable).toBe(0);
    expect(earlier.substantiated).toBe('hierophant');

    for (const page of ctx.world.chronicle.slice(-2)) page.year = ctx.world.year;
    const current = readTheChronicle(ctx);
    expect(current.pages).toBe(baseline.pages + 1);
    expect(current.blanks).toBe(baseline.blanks + 1);
    expect(current.embellished).toBe(baseline.embellished + 1);
    expect(current.unsupportable).toBe(4);
    expect(current.standingLies).toBe(earlier.standingLies);
  });

  it('quotes only dated, eligible pages in order, without changing saved history', () => {
    const ctx = atTheTerm();
    const year = ctx.world.year;
    ctx.world.ending = { id: 'forgotten', year };
    const baseline = epilogueOf(ctx)!;
    ctx.world.chronicle.push(
      { year: year - 1, weight: 'illuminated', text: 'An earlier recovered clause.', named: false },
      { year: year + 1, weight: 'illuminated', text: 'The future clause.', named: false },
      { year, weight: 'paragraph', text: null, named: false, record: 'omit' },
      { year: year + 2, weight: 'paragraph', text: 'A later boast.', named: false, record: 'embellish' },
    );
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;

    expect(view.read.map((page) => [page.year, page.text])).toEqual([
      [year - 1, 'An earlier recovered clause.'],
      ...baseline.read.map((page) => [page.year, page.text]),
      [year, null],
    ]);
    expect(view.read).toHaveLength(baseline.read.length + 2);
    expect(view.reckoning.pages).toBe(baseline.reckoning.pages + 1);
    expect(view.reckoning.blanks).toBe(baseline.reckoning.blanks + 1);
    expect(view.reckoning.embellished).toBe(baseline.reckoning.embellished);
    expect(view.read[0]).not.toBe(ctx.world.chronicle[0]);
    expect(digestOf(ctx), 'reading never writes or changes a save').toBe(before);
  });
});

/**
 * §29.3'S THIRD BITE — THE RECORD READ BACK.
 *
 * §6's closing sentence is the specification: *a house that embellished
 * everything arrives exalted, revered, and unable to prove a single thing it
 * needs to prove.* For four hundred commits the two halves of it were both
 * true and neither was connected — `standingLies` was counted, printed on the
 * ending screen, and read by nothing that decided anything, which is invariant
 * 11 sitting in the one place the game's thesis is supposed to land.
 *
 * The tests that matter are the ones where the book claims more than it can
 * hold up, because for an honest house every number here is the same number.
 */
describe('what the book cannot hold up', () => {
  /** `n` discrepancies of one severity; authored ones leave their Embellish page behind. */
  function lie(
    ctx: SimCtx, n: number, severity = 'total', state = 'open', authored = true,
  ): void {
    for (let i = 0; i < n; i++) {
      const id = `${severity}_${state}_${ctx.world.chronicle.length}_${i}`;
      ctx.world.discrepancies.set(id, { severity, provableBy: [], state: state as never });
      if (authored) {
        ctx.world.chronicle.push({
          year: ctx.world.year - 20 - i,
          weight: 'paragraph',
          text: `The house wrote ${id} larger than it was.`,
          named: false,
          record: 'embellish',
          discrepancyId: id,
        });
      }
    }
  }

  it('takes the book at its word when the book is honest', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');

    const r = readTheChronicle(ctx);
    expect(r.unsupportable).toBe(0);
    expect(r.rungsWithheld).toBe(0);
    expect(r.substantiated).toBe(r.attested);
    expect(selectEnding(ctx)).toBe('devoured');
  });

  it('does not bill an open discrepancy the house did not write larger', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    lie(ctx, 3, 'total', 'open', false); // 12 ambient weight, above Long's authored threshold.

    const r = readTheChronicle(ctx);
    expect(r.standingLies).toBe(3);
    expect(r.unsupportable).toBe(0);
    expect(r.rungsWithheld).toBe(0);
    expect(r.substantiated).toBe('hierophant');
  });

  it('judges the same authored lie density against each campaign term', () => {
    const short = testWorld(content, 9011, CAMPAIGNS.short.endYear);
    short.world.campaign = 'short';
    attest(short, 'hierophant');
    lie(short, 1, 'total'); // 4: below Short's 6-per-rung threshold.
    expect(readTheChronicle(short).rungsWithheld).toBe(0);
    lie(short, 2, 'minor'); // 6: exactly one Short rung.
    expect(readTheChronicle(short).rungsWithheld).toBe(1);

    const long = atTheTerm(9012);
    attest(long, 'hierophant');
    lie(long, 2, 'total'); // 8: below Long's 10-per-rung threshold.
    expect(readTheChronicle(long).rungsWithheld).toBe(0);
    lie(long, 2, 'minor'); // 10: exactly one Long rung.
    expect(readTheChronicle(long).rungsWithheld).toBe(1);
  });

  it('will not take a rung the authored record cannot support', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    lie(ctx, 3); // 12 at Long's 10-per-rung threshold — one rung.

    const r = readTheChronicle(ctx);
    expect(r.unsupportable).toBe(12);
    expect(r.rungsWithheld).toBe(1);
    expect(r.attested).toBe('hierophant');
    expect(r.substantiated).toBe('adept');
    expect(selectEnding(ctx)).toBe('forgotten');
  });

  it('withholds more than one rung when the authored book is bad enough', () => {
    const ctx = atTheTerm();
    attest(ctx, 'god');
    lie(ctx, 5); // 20 — exactly two Long rungs.

    const r = readTheChronicle(ctx);
    expect(r.rungsWithheld).toBe(2);
    expect(r.substantiated).toBe('vessel');
    expect(selectEnding(ctx)).toBe('devoured');
  });

  it('never withholds past the ground', () => {
    const ctx = atTheTerm();
    attest(ctx, 'touched');
    lie(ctx, 40);

    expect(readTheChronicle(ctx).substantiated).toBe('none');
    expect(selectEnding(ctx)).toBe('forgotten');
  });

  it('charges a lie that stands, and not one that was caught or buried', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    lie(ctx, 10, 'total', 'proven');
    lie(ctx, 10, 'total', 'buried');

    const r = readTheChronicle(ctx);
    expect(r.provenLies).toBe(10);
    expect(r.unsupportable).toBe(0);
    expect(selectEnding(ctx)).toBe('devoured');
  });

  it('weighs a severity it does not recognise as the cheapest one', () => {
    const ctx = atTheTerm();
    lie(ctx, 3, 'grave');
    expect(readTheChronicle(ctx).unsupportable).toBe(3);
  });

  it('leaves the reason in the chronicle, where the player can find it', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    lie(ctx, 3);
    expect(closeTheLedger(ctx)).toBe('forgotten');

    const last = ctx.world.chronicle[ctx.world.chronicle.length - 1]!;
    expect(last.text).toContain('Hierophant');
    expect(last.text).toContain('Adept');
    expect(last.rung).toBeUndefined();
  });

  it('says nothing about a reading that took the whole book', () => {
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    closeTheLedger(ctx);
    expect(ctx.world.chronicle.some((e) => e.title === 'What Could Not Be Shown')).toBe(false);
  });

  it('writes both closing pages in the reader\'s setting, and reads the same ending either way (#753)', () => {
    const PAGES: Record<string, [string, string]> = {
      'ending.term_title': ['The Term', 'The End of the Record'],
      'ending.term': [
        'The book was read, from the first page to the last, and the blanks were read too.',
        'The whole record was read, including the missing pages.',
      ],
      'ending.withheld_title': ['What Could Not Be Shown', 'What Could Not Be Proved'],
      'ending.withheld': [
        'The house was written as {ATTESTED} and was read as {SUBSTANTIATED}. {LIES} pages were asked after, and the family had nothing to set beside them but the pages themselves.',
        'The record claimed {ATTESTED}, but it could only support {SUBSTANTIATED}. {LIES} pages were questioned, and the family had no other proof.',
      ],
    };
    const close = (mode: 'original' | 'plainenglish') => {
      const ctx = atTheTerm();
      setProseVariants(ctx, Object.entries(PAGES).map(([key, [original, plain]]) => ({
        address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
      })));
      setProseMode(ctx, mode);
      attest(ctx, 'hierophant');
      lie(ctx, 3);
      const ending = closeTheLedger(ctx);
      return { ctx, ending, pages: ctx.world.chronicle.slice(-2) };
    };
    const original = close('original');
    expect(original.pages.map((e) => [e.title, e.text])).toEqual([
      ['The Term', 'The book was read, from the first page to the last, and the blanks were read too.'],
      ['What Could Not Be Shown', 'The house was written as Hierophant and was read as Adept. 3 pages were asked after, '
        + 'and the family had nothing to set beside them but the pages themselves.'],
    ]);
    const plain = close('plainenglish');
    expect(plain.pages.map((e) => [e.title, e.text])).toEqual([
      ['The End of the Record', 'The whole record was read, including the missing pages.'],
      ['What Could Not Be Proved', 'The record claimed Hierophant, but it could only support Adept. 3 pages were questioned, '
        + 'and the family had no other proof.'],
    ]);
    expect(plain.ending).toBe(original.ending);
    expect(plain.ctx.world.ending).toEqual(original.ctx.world.ending);
    expect(plain.pages.every((e) => e.rung === undefined)).toBe(true);
    setProseMode(plain.ctx, 'original');
    expect(plain.pages[0]!.title).toBe('The End of the Record');
  });

  it('tells the two Forgottens apart', () => {
    const never = atTheTerm();
    closeTheLedger(never);
    const fromBelow = endingSummary(never, 'forgotten', readTheChronicle(never));

    const fell = atTheTerm();
    attest(fell, 'hierophant');
    lie(fell, 3);
    closeTheLedger(fell);
    const fromAbove = endingSummary(fell, 'forgotten', readTheChronicle(fell));

    expect(fromBelow).toContain('never passed');
    expect(fromAbove).not.toContain('never passed');
    expect(fromAbove).toContain('could not hold it up');
  });
});

describe('which of the five', () => {
  it('reads to an empty room when the line is broken', () => {
    const ctx = atTheTerm();
    attest(ctx, 'god');
    for (const p of [...ctx.world.people.living()]) {
      ctx.world.people.kill(p.id, ctx.world.year, 'the overflow');
    }
    expect(readTheChronicle(ctx).livingBlood).toBe(0);
    expect(selectEnding(ctx)).toBe('broken_line');
  });

  it('takes the rite failing at the last step over everything the book says', () => {
    const ctx = atTheTerm();
    attest(ctx, 'god');
    ctx.world.flags.set(GOD_RITE_FAILED, true);
    expect(selectEnding(ctx)).toBe('unmade');
  });

  it('is devoured at Hierophant and above, and forgotten at Adept and below', () => {
    for (const rung of ['hierophant', 'vessel', 'demigod'] as Rung[]) {
      const ctx = atTheTerm();
      attest(ctx, rung);
      expect(selectEnding(ctx), rung).toBe('devoured');
    }
    for (const rung of ['none', 'touched', 'adept'] as Rung[]) {
      const ctx = atTheTerm();
      attest(ctx, rung);
      expect(selectEnding(ctx), rung).toBe('forgotten');
    }
  });

  it('names every one of the five, exhaustively', () => {
    const ctx = atTheTerm();
    const r = readTheChronicle(ctx);
    for (const id of ENDING_ORDER) {
      expect(endingSummary(ctx, id, r).length).toBeGreaterThan(20);
    }
  });
});


describe('fingerprinted Plain English ending summaries (#831)', () => {
  // A complete inventory: editing one Original requires reviewing its translation.
  // Each template is a whole sentence, including formerly concatenated clauses.
  const ORIGINALS: Record<string, string> = {
    'ending.summary.apotheosis': 'A god was made, and the book can show it: {RUNG}, on the page.',
    'ending.summary.unmade': 'The rite failed at the last step, and what was in the blood went out of it.',
    'ending.summary.broken_line': 'Nobody was at the table. The creditor read the chronicle alone.',
    'ending.summary.settled': 'The house recovered all {TOTAL} clauses of its shorter contract. The creditor read the account, found it answered, and closed it.',
    'ending.summary.forgotten_withheld': 'The book attests {RUNG} and could not hold it up. The creditor arrived, read, believed none of the parts that mattered, and did not collect.',
    'ending.summary.forgotten': 'The house survived to the term and never passed {RUNG}. The creditor arrived, read, and did not collect.',
    'ending.summary.devoured': 'The book attests {RUNG}, which was enough to be worth the journey and not enough to argue with.',
    'ending.ledger.complete': 'The Ledger was complete: all {TOTAL} clauses were recovered.',
    'ending.ledger.unresolved': 'The Ledger remained unresolved: {CLAUSES} of {TOTAL} clauses were recovered.',
  };
  const PLAIN: Record<string, string> = {
    'ending.summary.apotheosis': 'The family became a god, and the record proves it reached {RUNG}.',
    'ending.summary.unmade': 'The final rite failed, and the family lost the power in its blood.',
    'ending.summary.broken_line': 'Nobody from the family was left. The creditor read the record alone.',
    'ending.summary.settled': 'The family recovered all {TOTAL} clauses of its shorter agreement. The creditor checked the record and closed the account.',
    'ending.summary.forgotten_withheld': 'The record claims {RUNG}, but there was no proof. The creditor read it, rejected the important claims, and left.',
    'ending.summary.forgotten': 'The family survived to the end but never went beyond {RUNG}. The creditor read the record and left.',
    'ending.summary.devoured': 'The record shows {RUNG}. That made the family worth collecting, but not strong enough to resist.',
    'ending.ledger.complete': 'The family recovered all {TOTAL} Ledger clauses.',
    'ending.ledger.unresolved': 'The family recovered {CLAUSES} out of {TOTAL} Ledger clauses, so the contract is not settled.',
  };
  const render = (template: string, values: Record<string, string>) =>
    template.replace(/\{([A-Z]+)\}/g, (_, token: string) => values[token]!);
  const useVariants = (ctx: SimCtx) => setProseVariants(ctx,
    Object.entries(ORIGINALS).map(([key, original]) => ({
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish: PLAIN[key]!,
    })));

  it('pins every Original and translates all five endings, including both Forgotten paths', () => {
    const ctx = atTheTerm();
    const base = readTheChronicle(ctx);
    const withheld = { ...base, rungsWithheld: 1, attested: 'hierophant' as const, substantiated: 'adept' as const };
    const cases: Array<{
      id: EndingId; key: string; r: typeof base; values: Record<string, string>;
    }> = [
      { id: 'apotheosis', key: 'ending.summary.apotheosis', r: base, values: { RUNG: rungTitle(ctx, base.attested) } },
      { id: 'unmade', key: 'ending.summary.unmade', r: base, values: {} },
      { id: 'broken_line', key: 'ending.summary.broken_line', r: base, values: {} },
      { id: 'settled', key: 'ending.summary.settled', r: base, values: { TOTAL: String(base.clausesTotal) } },
      { id: 'forgotten', key: 'ending.summary.forgotten_withheld', r: withheld, values: { RUNG: rungTitle(ctx, withheld.attested) } },
      { id: 'forgotten', key: 'ending.summary.forgotten', r: base, values: { RUNG: rungTitle(ctx, 'adept') } },
      { id: 'devoured', key: 'ending.summary.devoured', r: base, values: { RUNG: rungTitle(ctx, base.substantiated) } },
    ];
    expect(Object.keys(ORIGINALS).sort()).toEqual(Object.keys(PLAIN).sort());
    expect(cases.map((entry) => entry.key).sort()).toEqual(
      Object.keys(ORIGINALS).filter((key) => key.startsWith('ending.summary.')).sort(),
    );
    for (const entry of cases) {
      expect(endingSummary(ctx, entry.id, entry.r))
        .toBe(render(ORIGINALS[entry.key]!, entry.values));
    }

    useVariants(ctx);
    setProseMode(ctx, 'plainenglish');
    for (const entry of cases) {
      expect(endingSummary(ctx, entry.id, entry.r))
        .toBe(render(PLAIN[entry.key]!, entry.values));
    }
    setProseMode(ctx, 'original');
    for (const entry of cases) {
      expect(endingSummary(ctx, entry.id, entry.r))
        .toBe(render(ORIGINALS[entry.key]!, entry.values));
    }
  });

  it('translates both Ledger lines without changing the ending or the reckoning', () => {
    const original = atTheTerm();
    original.world.ending = { id: 'forgotten', year: original.world.year };
    const before = epilogueOf(original)!;
    useVariants(original);
    setProseMode(original, 'plainenglish');
    const after = epilogueOf(original)!;
    expect(after.summary).toBe(
      render(PLAIN['ending.summary.forgotten']!, { RUNG: rungTitle(original, 'adept') })
      + ' ' + render(PLAIN['ending.ledger.unresolved']!, {
        CLAUSES: String(after.reckoning.clauses), TOTAL: String(after.reckoning.clausesTotal),
      }),
    );
    expect(after.reckoning).toEqual(before.reckoning);
    expect(after.id).toBe(before.id);
    setProseMode(original, 'original');
    expect(epilogueOf(original)!.summary).toBe(before.summary);

    const complete = testWorld(content, 9002, CAMPAIGNS.short.endYear);
    complete.world.campaign = 'short';
    complete.world.ending = { id: 'settled', year: complete.world.year };
    for (const clause of content.clauses.slice(0, CAMPAIGNS.short.clauses)) {
      complete.world.clausesRecovered.add(clause.id);
    }
    const completeBefore = epilogueOf(complete)!;
    useVariants(complete);
    setProseMode(complete, 'plainenglish');
    const completeAfter = epilogueOf(complete)!;
    expect(completeAfter.summary).toContain('The family recovered all 3 Ledger clauses.');
    expect(completeAfter.summary).toContain('The family recovered all 3 clauses of its shorter agreement.');
    expect(completeAfter.reckoning).toEqual(completeBefore.reckoning);
    expect(completeAfter.id).toBe(completeBefore.id);

    // A stale translation must fall back to the exact Original.
    setProseVariants(complete, [{
      address: coreMessageAddress('ending.ledger.complete'),
      of: '0000000000000000',
      plainenglish: PLAIN['ending.ledger.complete']!,
    }]);
    expect(epilogueOf(complete)!.summary).toContain(ORIGINALS['ending.ledger.complete']!.replace('{TOTAL}', '3'));
  });
});

describe('the term', () => {
  it('is the canonical 500-year Long Line, 1042 through 1542', () => {
    expect(END_YEAR).toBe(1542);
  });

  it('lets the collection year happen before the next call closes the ledger', () => {
    const ctx = testWorld(content, 9002, END_YEAR - 1);
    stepYear(ctx);
    expect(ctx.world.year).toBe(END_YEAR);
    expect(ctx.world.ending).toBeUndefined();

    stepYear(ctx);
    expect(ctx.world.year).toBe(END_YEAR);
    expect(ctx.world.ending).toBeDefined();
  });

  it('stops the clock, once, and does not turn another year', () => {
    const ctx = atTheTerm();
    const before = ctx.world.chronicle.length;

    stepYear(ctx);
    expect(ctx.world.year).toBe(END_YEAR);
    expect(ctx.world.ending?.id).toBe('forgotten');
    const after = ctx.world.chronicle.length;
    const decisionsAfter = ctx.world.decisionLog.length;
    const settled = digestOf(ctx);

    // Again, and again. The collection year happens to a house once. The
    // whole digest staying put also proves no hidden phase consumed RNG.
    stepYear(ctx);
    stepYear(ctx);
    expect(ctx.world.year).toBe(END_YEAR);
    expect(ctx.world.chronicle.length).toBe(after);
    expect(ctx.world.decisionLog.length).toBe(decisionsAfter);
    expect(digestOf(ctx)).toBe(settled);
    expect(after).toBe(before + 1);
  });

  it('keeps the ending it chose when the ledger is closed twice', () => {
    const ctx = atTheTerm();
    attest(ctx, 'god');
    expect(closeTheLedger(ctx)).toBe('apotheosis');

    // The house is wiped out afterwards; the run still ended the way it ended.
    for (const p of [...ctx.world.people.living()]) {
      ctx.world.people.kill(p.id, ctx.world.year, 'after the fact');
    }
    expect(closeTheLedger(ctx)).toBe('apotheosis');
  });
});

/**
 * THE RING (concept §23). Same cadence, same three parts, one substitution —
 * and the substitution has to actually land in the text a player reads, which
 * `ending/ring` cannot check because it validates content and this renders it.
 */
describe('A Short Line ending promise (#66)', () => {
  it('does not offer Apotheosis even when a god can be shown', () => {
    const ctx = testWorld(content, 9001, CAMPAIGNS.short.endYear);
    ctx.world.campaign = 'short';
    attest(ctx, 'god');

    expect(readTheChronicle(ctx).substantiated).toBe('god');
    expect(selectEnding(ctx)).toBe('devoured');
  });

  it('states the unresolved three-clause Ledger plainly in the epilogue', () => {
    const ctx = testWorld(content, 9002, CAMPAIGNS.short.endYear);
    ctx.world.campaign = 'short';

    closeTheLedger(ctx);
    const epilogue = epilogueOf(ctx)!;

    expect(epilogue.reckoning.clausesTotal).toBe(3);
    expect(epilogue.summary).toContain('The Ledger remained unresolved:');
    expect(epilogue.summary).toContain(
      `${epilogue.reckoning.clauses} of ${epilogue.reckoning.clausesTotal} clauses were recovered`,
    );
  });

  it('settles a surviving Short house that answers all three clauses', () => {
    const ctx = testWorld(content, 9003, CAMPAIGNS.short.endYear);
    ctx.world.campaign = 'short';
    for (const clause of content.clauses.slice(0, CAMPAIGNS.short.clauses)) {
      ctx.world.clausesRecovered.add(clause.id);
    }

    const reckoning = readTheChronicle(ctx);
    expect(reckoning.clauses).toBe(3);
    expect(reckoning.clausesTotal).toBe(3);
    expect(reckoning.attested).toBe(reckoning.substantiated);
    expect(selectEnding(ctx)).toBe('settled');

    closeTheLedger(ctx);
    const epilogue = epilogueOf(ctx)!;
    expect(epilogue.title).toBe('The Settled Account');
    expect(epilogue.summary).toContain('The Ledger was complete: all 3 clauses were recovered.');
  });

  it('does not call a complete Short contract settled when the book cannot substantiate its claim', () => {
    const ctx = testWorld(content, 9004, CAMPAIGNS.short.endYear);
    ctx.world.campaign = 'short';
    for (const clause of content.clauses.slice(0, CAMPAIGNS.short.clauses)) {
      ctx.world.clausesRecovered.add(clause.id);
    }

    // The house truly reached Adept and then wrote itself one rung higher.
    // The contract is complete; the book is not supportable. §6 says the
    // creditor reads the latter, and #66 explicitly makes proof an ending axis.
    ctx.world.ascension.best = 'adept';
    forge(ctx, 'hierophant');

    const reckoning = readTheChronicle(ctx);
    expect(reckoning.clauses).toBe(reckoning.clausesTotal);
    expect(reckoning.attested).toBe('hierophant');
    expect(reckoning.substantiated).toBe('adept');
    expect(selectEnding(ctx)).toBe('forgotten');
  });
});

describe('the epilogue rings the prologue', () => {
  it('says nothing at all until there has been a last night', () => {
    const ctx = atTheTerm();
    expect(epilogueOf(ctx)).toBeUndefined();
  });

  it('replays each campaign\'s own signing with exactly one element changed, for every ending', () => {
    const prologue = content.prologue!;

    for (const campaign of Object.values(CAMPAIGNS)) {
      for (const id of ENDING_ORDER) {
        const ctx = testWorld(content, 9001, campaign.endYear);
        ctx.world.campaign = campaign.id;
        const signing = prologueView(ctx)!.triad;
        ctx.world.ending = { id, year: campaign.endYear };
        const epilogue = epilogueOf(ctx)!;

        expect(signing[2]!.owed, campaign.id).toContain(`${campaign.years} years`);
        expect(signing[2]!.owed, campaign.id).toContain(String(campaign.endYear));
        expect(epilogue.ring, `${campaign.id}/${id}`).toHaveLength(signing.length);
        const changed = epilogue.ring.filter((b) => b.changed !== undefined);
        expect(changed, `${campaign.id}/${id} changed ${changed.length} elements`).toHaveLength(1);

        // Every OTHER beat is the exact campaign-specific signing, word for word.
        epilogue.ring.forEach((beat, i) => {
          if (beat.changed) return;
          expect(beat.given).toBe(signing[i]!.given);
          expect(beat.owed).toBe(signing[i]!.owed);
        });
        // And the changed one differs from this campaign's own signing.
        const at = epilogue.ring.findIndex((b) => b.changed);
        const original = signing[at]!;
        const half = epilogue.ring[at]!.changed!;
        expect(epilogue.ring[at]![half]).not.toBe(original[half]);

        expect(epilogue.closing.length).toBeGreaterThan(0);
        expect(epilogue.thesis).toBe(prologue.thesis);
      }
    }
  });

  it('quotes the book back, blanks included, and names what was founded', () => {
    const ctx = atTheTerm();
    foundHouse(ctx, {
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
    });
    ctx.world.chronicle.push({ year: ctx.world.year - 1, weight: 'paragraph', text: null, named: false, record: 'omit' });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'paragraph', text: 'A thing that did not happen.', named: false, record: 'embellish',
    });
    closeTheLedger(ctx);

    const epilogue = epilogueOf(ctx)!;
    expect(epilogue.read.some((e) => e.text === null)).toBe(true);
    expect(epilogue.read.some((e) => e.record === 'embellish')).toBe(true);
    expect(epilogue.founding?.houseName).toBe('The House of Salt');
    expect(epilogue.founding?.heirloomName).toBe('A Portion of Agelessness');
    expect(epilogue.founding?.grudgeName).toBe('House Marrow');
    expect(epilogue.reckoning.blanks).toBeGreaterThan(0);
  });

  it('names the founding heirloom and rival in the same reviewed register as the prologue', () => {
    const ctx = atTheTerm();
    expect(foundHouse(ctx, {
      houseName: 'The House of Salt',
      heirloom: 'portion_of_agelessness',
      grudge: 'house_marrow',
    }).ok).toBe(true);
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    const originalFounding = structuredClone(ctx.world.founding);
    const original = epilogueOf(ctx)!.founding!;

    const heirloomAddress = 'content:heirlooms.yaml#heirlooms[id=portion_of_agelessness].name';
    const grudgeAddress = 'content:houses.yaml#houses[id=house_marrow].name';
    const plainHeirloom = 'A draught that extends a life';
    const plainGrudge = 'The Marrow family';
    setProseVariants(ctx, [
      {
        address: heirloomAddress,
        of: proseOriginalHash(proseOriginalAt(ctx.content, heirloomAddress)!),
        plainenglish: plainHeirloom,
      },
      {
        address: grudgeAddress,
        of: proseOriginalHash(proseOriginalAt(ctx.content, grudgeAddress)!),
        plainenglish: plainGrudge,
      },
    ]);
    setProseMode(ctx, 'plainenglish');

    const selected = epilogueOf(ctx)!.founding!;
    const signing = prologueView(ctx)!;
    expect(selected.heirloomName).toBe(plainHeirloom);
    expect(selected.grudgeName).toBe(plainGrudge);
    expect(selected.heirloomName).toBe(signing.heirlooms.find((h) => h.heirloom === selected.heirloom)?.name);
    expect(selected.grudgeName).toBe(signing.grudges.find((g) => g.house === selected.grudge)?.houseName);
    expect(selected.heirloom).toBe(original.heirloom);
    expect(selected.grudge).toBe(original.grudge);
    expect(ctx.world.founding).toEqual(originalFounding);

    setProseMode(ctx, 'original');
    expect(epilogueOf(ctx)!.founding).toEqual(original);

    setProseMode(ctx, 'plainenglish');
    setProseVariants(ctx, [{
      address: heirloomAddress,
      of: '0000000000000000',
      plainenglish: plainHeirloom,
    }]);
    expect(epilogueOf(ctx)!.founding).toEqual(original);
    expect(ctx.world.founding).toEqual(originalFounding);
  });

  it('reports what the house could and could not prove', () => {
    const ctx = atTheTerm();
    ctx.world.discrepancies.set('a_lie', { severity: 'grave', provableBy: [], state: 'open' });
    ctx.world.discrepancies.set('a_caught_lie', { severity: 'grave', provableBy: [], state: 'proven' });
    closeTheLedger(ctx);

    const r = epilogueOf(ctx)!.reckoning;
    expect(r.standingLies).toBe(1);
    expect(r.provenLies).toBe(1);
    // Whoever holds the seal, described by the rung the BOOK grants them —
    // the creditor is reading about the man, not appraising him.
    const seated = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => p.castSlots.includes('head'));
    expect(r.head?.name).toBe(seated?.name);
    expect(r.head?.rung).toBe(r.attested);
    expect(r.clausesTotal).toBe(content.clauses.length);
  });

  it('renders ending and signing thesis through stable Plain English addresses (#410)', () => {
    const ctx = testWorld(content);
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    const original = epilogueOf(ctx)!;

    setProseVariants(ctx, [
      {
        address: 'content:endings.yaml#endings[id=forgotten].title',
        plainenglish: 'The House Is Forgotten',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].opening',
        plainenglish: 'The creditor read the whole book and collected nothing.',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].ring.owed',
        plainenglish: 'The family kept a page for every year, but that was not enough.',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].closing',
        plainenglish: 'The family continued without the old bargain.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].thesis',
        plainenglish: 'Later generations did not sign the bargain.',
      },
    ].map((variant) => ({
      ...variant,
      of: proseOriginalHash(proseOriginalAt(ctx.content, variant.address)!),
    })));
    setProseMode(ctx, 'plainenglish');

    const plain = epilogueOf(ctx)!;
    expect(plain.title).toBe('The House Is Forgotten');
    expect(plain.opening).toBe('The creditor read the whole book and collected nothing.');
    expect(plain.ring[0]).toMatchObject({
      owed: 'The family kept a page for every year, but that was not enough.',
      changed: 'owed',
    });
    expect(plain.closing).toBe('The family continued without the old bargain.');
    expect(plain.thesis).toBe('Later generations did not sign the bargain.');

    setProseMode(ctx, 'original');
    const restored = epilogueOf(ctx)!;
    expect(restored.title).toBe(original.title);
    expect(restored.opening).toBe(original.opening);
    expect(restored.ring[0]!.owed).toBe(original.ring[0]!.owed);
    expect(restored.closing).toBe(original.closing);
    expect(restored.thesis).toBe(original.thesis);
  });
});

describe('the epilogue returns a detached Chronicle snapshot (#1583)', () => {
  it('cannot rewrite a saved page through text or nested references', () => {
    const ctx = atTheTerm();
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    const page = {
      id: 'epilogue_snapshot',
      year: ctx.world.year - 1,
      weight: 'illuminated' as const,
      named: true,
      title: 'An attested page',
      text: 'The original words remain written.',
      people: ['p_1'],
      cause: { year: ctx.world.year - 2, page: 'prior_page' },
    };
    ctx.world.chronicle.push(page);
    const before = structuredClone(ctx.world.chronicle);
    const first = epilogueOf(ctx)!;
    const quoted = first.read.find((entry) => entry.id === page.id);
    expect(quoted).toBeDefined();

    // The UI may decorate a returned view. Neither top-level edits nor
    // nested edits may change the Chronicle used by save and reckoning.
    quoted!.text = 'Rewritten by the reader';
    quoted!.people!.push('p_2');
    quoted!.cause!.page = 'rewritten_cause';
    expect(ctx.world.chronicle).toEqual(before);

    const second = epilogueOf(ctx)!.read.find((entry) => entry.id === page.id);
    expect(second).toMatchObject({
      text: 'The original words remain written.',
      people: ['p_1'],
      cause: { year: page.cause.year, page: 'prior_page' },
    });

    // Later world changes cannot silently rewrite a view already handed out.
    page.text = 'A later change to the book';
    expect(quoted!.text).toBe('Rewritten by the reader');
    expect(second!.text).toBe('The original words remain written.');
  });
});

describe('all authored endings have live Plain English consumers (#410)', () => {
  it('renders every eligible worklist field in all six endings without changing the reckoning', () => {
    const entries = contentProseEntries('endings.yaml', { endings: content.endings });
    const variants = entries.map(({ address, text }) => ({
      address, of: proseOriginalHash(text), plainenglish: `Plain: ${text}`,
    }));
    const byAddress = new Set(entries.map(({ address }) => address));
    const visited = new Set<string>();
    expect(entries.length).toBeGreaterThan(0);

    for (const def of content.endings) {
      const ctx = atTheTerm();
      ctx.world.ending = { id: def.id, year: ctx.world.year };
      const original = epilogueOf(ctx)!;
      setProseVariants(ctx, variants);
      setProseMode(ctx, 'plainenglish');
      const selected = epilogueOf(ctx)!;
      const base = `content:endings.yaml#endings[id=${encodeURIComponent(def.id)}]`;
      const check = (path: string, actual: string, originalText: string) => {
        const address = `${base}.${path}`;
        if (byAddress.has(address)) {
          visited.add(address);
          expect(actual, address).toBe(`Plain: ${originalText}`);
        } else {
          // A one-word title is deliberately absent from the worklist.
          expect(actual, address).toBe(originalText);
        }
      };

      check('title', selected.title, def.title);
      check('opening', selected.opening, def.opening);
      check('closing', selected.closing, def.closing);
      const changedBeat = selected.ring[def.ring.beat - 1]!;
      if (def.ring.given !== undefined) {
        check('ring.given', changedBeat.given, def.ring.given);
      } else if (def.ring.owed !== undefined) {
        check('ring.owed', changedBeat.owed, def.ring.owed);
      } else {
        throw new Error(`Ending ${def.id} has no replacement ring line`);
      }

      expect(selected.id).toBe(original.id);
      expect(selected.reckoning).toEqual(original.reckoning);
      expect(missingPlainEnglish(ctx).filter((address) => address.startsWith(base))).toEqual([]);
      setProseMode(ctx, 'original');
      expect(epilogueOf(ctx)).toEqual(original);
    }

    // An authored field added to endings.yaml must acquire a runtime consumer,
    // not merely a worklist address: one test guards both sides of the seam.
    expect([...visited].sort()).toEqual([...byAddress].sort());
  });

  it('falls back to Original for a stale given-ring variant and reports its address', () => {
    const ctx = atTheTerm();
    ctx.world.ending = { id: 'unmade', year: ctx.world.year };
    const address = 'content:endings.yaml#endings[id=unmade].ring.given';
    const original = epilogueOf(ctx)!.ring[1]!.given;
    expect(proseOriginalAt(ctx.content, address)).toBe(original);

    setProseVariants(ctx, [{
      address, of: '0000000000000000', plainenglish: `Plain: ${original}`,
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.ring[1]!.given).toBe(original);
    expect(missingPlainEnglish(ctx)).toContain(address);

    setProseVariants(ctx, [{
      address, of: proseOriginalHash(original), plainenglish: `Plain: ${original}`,
    }]);
    expect(epilogueOf(ctx)!.ring[1]!.given).toBe(`Plain: ${original}`);
    expect(missingPlainEnglish(ctx)).not.toContain(address);
  });
});

describe('one-word ending title Plain English eligibility (#1106)', () => {
  it('does not invent a missing translation for Apotheosis while translating eligible text', () => {
    const ctx = atTheTerm();
    ctx.world.ending = { id: 'apotheosis', year: ctx.world.year };
    const titleAddress = 'content:endings.yaml#endings[id=apotheosis].title';
    const openingAddress = 'content:endings.yaml#endings[id=apotheosis].opening';

    // A one-word title has no authored variant address in the migration worklist.
    expect(proseOriginalAt(ctx.content, titleAddress)).toBeUndefined();
    expect(proseOriginalAt(ctx.content, openingAddress)).toBeTruthy();

    setProseMode(ctx, 'plainenglish');
    const original = epilogueOf(ctx)!;
    expect(original.title).toBe('Apotheosis');
    expect(missingPlainEnglish(ctx)).not.toContain(titleAddress);
    expect(missingPlainEnglish(ctx)).toContain(openingAddress);

    const plain = 'The family book was read from beginning to end.';
    setProseVariants(ctx, [{
      address: openingAddress,
      of: proseOriginalHash(original.opening),
      plainenglish: plain,
    }]);
    const translated = epilogueOf(ctx)!;
    expect(translated.title).toBe('Apotheosis');
    expect(translated.opening).toBe(plain);
    expect(missingPlainEnglish(ctx)).not.toContain(titleAddress);
    expect(missingPlainEnglish(ctx)).not.toContain(openingAddress);

    setProseMode(ctx, 'original');
    expect(epilogueOf(ctx)!.opening).toBe(original.opening);
  });
});

describe('the book may say more than the house did (issue #77)', () => {
  /**
   * §6's thesis has two halves, and until #77 the ladder carried only one of
   * them. `entry.rung` was written by `tickAscension` alone and written
   * truthfully, so the book could LOSE a claim and never MAKE one: over 120
   * measured thousand-year runs, across three pens, the number in which the
   * house reached higher than its book attests was zero, and so was the number
   * in which the book claimed more than the house reached.
   *
   * The pen can round up now. What it can never do is make the claim true.
   */
  it('attests a forged rung, and never substantiates it', () => {
    const ctx = atTheTerm();
    ctx.world.ascension.best = 'adept';
    forge(ctx, 'hierophant');

    const r = readTheChronicle(ctx);
    // The gap, running the direction it never ran before.
    expect(r.attested).toBe('hierophant');
    expect(r.substantiated).toBe('adept');
  });

  it('does not substantiate a forgery even when the rest of the book is spotless', () => {
    // THE CASE WITHHOLDING ALONE WOULD MISS. `rungsWithheld` counts what is
    // STANDING, so a house that forged a rung and then cleared every lie —
    // bought the pages, buried them, had them proven and paid for — arrives
    // with nothing outstanding. Without the cap on truth, the forgery is read
    // back to it as fact, which is the bluff working rather than being called.
    const ctx = atTheTerm();
    ctx.world.ascension.best = 'adept';
    forge(ctx, 'hierophant');

    const r = readTheChronicle(ctx);
    expect(r.unsupportable).toBe(0);
    expect(r.rungsWithheld).toBe(0);
    expect(r.substantiated).toBe('adept');
  });

  it('cannot reach Apotheosis with a pen', () => {
    // The ending the game is named for, and #77's own condition on building
    // any of this: Apotheosis fires on a SUBSTANTIATED god, so a forged god
    // must not reach it. Asserted rather than left to follow from a comment.
    const ctx = atTheTerm();
    ctx.world.ascension.best = 'demigod';
    forge(ctx, 'god');

    const r = readTheChronicle(ctx);
    expect(r.attested).toBe('god');
    expect(r.substantiated).not.toBe('god');
    expect(selectEnding(ctx)).not.toBe('apotheosis');

    // The control: the same book, over a house that actually got there.
    const real = atTheTerm();
    attest(real, 'god');
    closeTheLedger(real);
    expect(readTheChronicle(real).substantiated).toBe('god');
  });

  it('still takes an honest book at its word', () => {
    // The case this whole mechanism must not disturb, restated against the
    // cap: a house that stood where it says it stood loses nothing to it.
    const ctx = atTheTerm();
    attest(ctx, 'hierophant');
    const r = readTheChronicle(ctx);
    expect(r.attested).toBe('hierophant');
    expect(r.substantiated).toBe('hierophant');
  });
});

const page = (over: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
  id: 'page', year: 1200, weight: 'paragraph', named: false, text: 'The written account.', ...over,
});

describe('the house remembered from attributed evidence (#1808)', () => {
  it('confines the recovered Afterimage to the founding-to-collection term (#1983)', () => {
    const ctx = atTheTerm(198314);
    const w = ctx.world;
    const beforeFounding = place(ctx, { name: 'Before the founding', sex: 'male', age: 30 });
    const atCollection = place(ctx, { name: 'At the collection', sex: 'female', age: 30 });
    const afterCollection = place(ctx, { name: 'After the collection', sex: 'male', age: 30 });
    w.chronicle = [
      page({ id: 'before-founding', year: CAMPAIGNS.long.startYear - 1, people: [beforeFounding.id] }),
      page({ id: 'at-collection', year: END_YEAR, people: [atCollection.id] }),
      page({ id: 'after-collection', year: END_YEAR + 1, people: [afterCollection.id] }),
      page({ id: 'future-blank', year: END_YEAR + 1, text: null }),
    ];
    w.succession = [
      { person: atCollection.id, name: atCollection.name, from: END_YEAR - 1,
        question: { kind: 'thin_line', opened: END_YEAR - 1, baseline: 3,
          text: 'Three were present.', signature: 'thin_line:at-collection' } },
      { person: afterCollection.id, name: afterCollection.name, from: END_YEAR + 1,
        question: { kind: 'thin_line', opened: END_YEAR + 1, baseline: 1,
          text: 'One came afterwards.', signature: 'thin_line:after-collection' } },
    ];

    // Unfinished authoring inventories deliberately include synthetic future
    // and pre-founding pages. Only a completed last night has book bounds.
    expect(afterimageEvidence(ctx).people.map((person) => person.name)).toContain('Before the founding');
    expect(afterimageEvidence(ctx).people.map((person) => person.name)).toContain('After the collection');

    w.ending = { id: 'forgotten', year: END_YEAR };
    // Recovered state can outlive the saved collection date; the reader must
    // never let the later clock rewrite what was in the ending's book.
    w.year = END_YEAR + 5;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      // The setter changes saved state; only the following read must be pure.
      const before = digestOf(ctx);
      const epilogue = epilogueOf(ctx)!;
      const evidence = epilogue.afterimage!;
      expect(evidence.people.map((person) => person.name)).toEqual(['At the collection']);
      expect(evidence.people[0]!.sources.map((source) => source.page)).toEqual(['at-collection']);
      expect(evidence.blank).toBeUndefined();
      expect(evidence.line?.[0]?.id).toBe(atCollection.id);
      expect(evidence.brush?.source.year).toBe(END_YEAR - 1);
      expect(epilogue.year).toBe(END_YEAR);
      expect(digestOf(ctx), 'reading the ending must not mutate the saved history').toBe(before);
    }
  });

  it('does not quote testimony beyond a rewound recovered clock (#3126)', () => {
    const ctx = atTheTerm(312601);
    const w = ctx.world;
    const earlier = place(ctx, { name: 'Earlier witness', sex: 'female', age: 40 });
    const later = place(ctx, { name: 'Later witness', sex: 'male', age: 30 });
    const earlierYear = END_YEAR - 4;
    const laterYear = END_YEAR - 1;
    w.ending = { id: 'forgotten', year: END_YEAR };
    w.chronicle = [
      page({ id: 'earlier-clock-page', year: earlierYear, people: [earlier.id] }),
      page({ id: 'later-clock-page', year: laterYear, people: [later.id] }),
      page({ id: 'later-clock-blank', year: laterYear, text: null }),
    ];
    w.succession = [
      { person: earlier.id, name: earlier.name, from: earlierYear,
        question: { kind: 'thin_line', opened: earlierYear, baseline: 4,
          text: 'Four remained.', signature: 'thin_line:earlier' } },
      { person: later.id, name: later.name, from: laterYear,
        question: { kind: 'thin_line', opened: laterYear, baseline: 1,
          text: 'One came later.', signature: 'thin_line:later' } },
    ];

    // An inconsistent recovered save may retain a last night dated ahead of
    // its current clock. The Chronicle already withholds those later pages;
    // the accompanying Afterimage must agree on names, head, loss and blanks.
    w.year = END_YEAR - 2;
    const selected = selectEnding(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const before = digestOf(ctx);
      const view = epilogueOf(ctx)!;
      expect(view.reckoning.pages).toBe(1);
      expect(view.afterimage?.people.map((person) => person.name)).toEqual(['Earlier witness']);
      expect(view.afterimage?.line?.[0]?.id).toBe(earlier.id);
      expect(view.afterimage?.brush?.source.year).toBe(earlierYear);
      expect(view.afterimage?.blank).toBeUndefined();
      expect(selectEnding(ctx)).toBe(selected);
      expect(digestOf(ctx)).toBe(before);
    }

    // Once the world catches up, both pages may be read. Moving past the
    // saved ending must not add any new witness or mutate the saved book.
    w.year = END_YEAR;
    const caughtUp = afterimageEvidence(ctx);
    expect(readTheChronicle(ctx).pages).toBe(2);
    expect(caughtUp.people.map((person) => person.name)).toEqual(['Earlier witness', 'Later witness']);
    expect(caughtUp.line?.[0]?.id).toBe(later.id);
    expect(caughtUp.brush?.source.year).toBe(laterYear);
    expect(caughtUp.blank?.year).toBe(laterYear);
    w.year = END_YEAR + 5;
    const before = digestOf(ctx);
    expect(afterimageEvidence(ctx)).toEqual(caughtUp);
    expect(digestOf(ctx)).toBe(before);
  });

  it('selects up to three people from structured pages and choices, with stable ties', () => {
    const ctx = testWorld(content);
    const people = ['Élodie 家', 'Wystan', 'Meriel', 'Unmentioned'].map((name) =>
      place(ctx, { name, sex: 'female', age: 25 }));
    const [a, b, c, d] = people;
    b!.epithet = 'the Witness';
    ctx.world.chronicle = [
      page({ id: 'first', people: [a!.id, b!.id, c!.id] }),
      page({ id: 'second', eventId: 'chosen', people: [a!.id] }),
      page({ id: 'third', eventId: 'chosen_again' }),
      page({ id: 'blank', text: null, people: [d!.id] }),
    ];
    ctx.world.decisionLog = [{
      kind: 'outcome', year: 1200, event: 'chosen', choiceId: 'keep', outcomeId: 'kept', fill: { PERSON: [b!.id] },
    }, { kind: 'outcome', year: 1200, event: 'chosen_again', choiceId: 'keep', outcomeId: 'kept', fill: { PERSON: [b!.id] } }];
    const before = digestOf(ctx);
    const first = afterimageEvidence(ctx);
    expect(first.people.map((p) => p.name)).toEqual(['Wystan', 'Élodie 家', 'Meriel']);
    expect(first.people.map((p) => p.epithet)).toEqual(['the Witness', undefined, undefined]);
    expect(first.people[0]!.sources.some((source) => source.choice === 'keep' && source.page === 'second')).toBe(true);
    expect(afterimageEvidence(ctx)).toEqual(first);
    expect(digestOf(ctx)).toBe(before);
    ctx.world.decisionLog = [];
    expect(afterimageEvidence(ctx).people[0]!.name).toBe('Élodie 家');
    expect(first.people.every((person) => person.sources.every((source) =>
      ctx.world.chronicle.some((entry) => entry.id === source.page && entry.text === source.text)))).toBe(true);
  });

  it('does not turn a blank into people or prose, even when the decision log retains its cast', () => {
    const ctx = testWorld(content);
    const p = place(ctx, { name: 'Hidden by omission', sex: 'male', age: 20 });
    ctx.world.chronicle = [page({ eventId: 'omitted', text: null, title: 'A hidden title', people: [p.id] })];
    ctx.world.decisionLog = [{ kind: 'outcome', event: 'omitted', year: 1200,
      choiceId: 'choose', outcomeId: 'result', fill: { PERSON: [p.id] } }];
    const evidence = afterimageEvidence(ctx);
    expect(evidence.people).toEqual([]);
    expect(evidence.blank?.text).toBeNull();
    expect(evidence.blank?.title).toBeUndefined();
    expect(evidence.spent).toBeUndefined();
    ctx.world.chronicle = [
      page({ id: 'one', eventId: 'omitted', people: [] }),
      page({ id: 'two', eventId: 'omitted', people: [] }),
    ];
    expect(afterimageEvidence(ctx).people).toEqual([]);
  });

  it('does not remember greyed named or chosen pages as surviving Afterimage testimony (#1983)', () => {
    const ctx = atTheTerm(198317);
    const w = ctx.world;
    const relative = place(ctx, { name: 'Alys', sex: 'female', age: 30 });
    const writtenYear = w.year - 3;
    w.ending = { id: 'forgotten', year: w.year };
    w.discrepancies.set('lost-memory', { state: 'open', severity: 'minor', provableBy: [] });
    w.chronicle = [page({
      id: 'lost-memory', year: writtenYear, eventId: 'a_lost_record',
      weight: 'illuminated', named: true, people: [relative.id],
      text: 'The house named Alys.', record: 'embellish',
      discrepancyId: 'lost-memory', greyed: true,
    })];
    w.decisionLog = [{
      kind: 'outcome', event: 'a_lost_record', year: writtenYear,
      choiceId: 'keep', outcomeId: 'kept', fill: { PERSON: [relative.id] },
    }];

    // A lost page's residual text, person ID and logged cast are not surviving
    // testimony, even if a damaged save still calls its discrepancy open.
    const selected = selectEnding(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const before = digestOf(ctx);
      const evidence = epilogueOf(ctx)!.afterimage!;
      expect(evidence.people).toEqual([]);
      expect(evidence.embellishment).toBeUndefined();
      expect(selectEnding(ctx)).toBe(selected);
      expect(digestOf(ctx)).toBe(before);
    }

    // An independent surviving page may still name the same relative, but
    // cannot import the erased decision's choice or missing embellishment.
    w.chronicle.push(page({
      id: 'legible-memory', year: writtenYear + 1, people: [relative.id],
      text: 'Alys remained in the book.',
    }));
    const evidence = afterimageEvidence(ctx);
    expect(evidence.people).toEqual([{
      person: relative.id, name: 'Alys',
      sources: [{ year: writtenYear + 1, page: 'legible-memory', text: 'Alys remained in the book.' }],
    }]);
    expect(evidence.embellishment).toBeUndefined();
    expect(evidence.people[0]!.sources.some((source) => source.choice === 'keep')).toBe(false);
  });

  it('requires a successful rite mark and an explicitly named written account', () => {
    const ctx = testWorld(content, 1042, 1200);
    const vessel = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Wystan', sex: 'male', age: 40 });
    vessel.epithet = 'of the Tides';
    ctx.world.chronicle = [page({ eventId: 'the_vessel_rite', people: [vessel.id, ascendant.id],
      text: 'Wystan said Meriel’s name. The book says she walked away.' })];
    ctx.world.decisionLog = [{ kind: 'outcome', event: 'the_vessel_rite', year: 1200,
      choiceId: 'speak_the_name', outcomeId: 'taken', fill: { VESSEL: [vessel.id], ASCENDANT: [ascendant.id] } }];
    expect(afterimageEvidence(ctx).spent).toBeUndefined();
    ctx.world.people.kill(vessel.id, 1200, 'given to the rite', 'vessel_consumed');
    const spent = afterimageEvidence(ctx).spent;
    expect(spent?.name).toBe('Meriel');
    expect(spent?.epithet).toBe('of the Tides');
    expect(spent?.source.text).toBe('Wystan said Meriel’s name. The book says she walked away.');
    ctx.world.chronicle[0]!.text = null;
    expect(afterimageEvidence(ctx).spent).toBeUndefined();
  });

  it('keeps the oldest open embellishment, excluding proven and buried accounts', () => {
    const ctx = testWorld(content);
    for (const [id, state] of [['caught', 'proven'], ['answered', 'buried'], ['standing', 'open']] as const) {
      ctx.world.discrepancies.set(id, { state, severity: 'minor', provableBy: [] });
    }
    ctx.world.chronicle = [
      page({ year: 1150, record: 'embellish', discrepancyId: 'caught' }),
      page({ year: 1160, record: 'embellish', discrepancyId: 'answered' }),
      page({ year: 1170, record: 'embellish', discrepancyId: 'standing', text: 'The house never lied.' }),
      page({ year: 1180, record: 'embellish', discrepancyId: 'standing' }),
    ];
    expect(afterimageEvidence(ctx).embellishment).toMatchObject({ year: 1170, text: 'The house never lied.' });
  });

  it('reports only a preserved generation count, never reconstructing a lifetime minimum', () => {
    const ctx = testWorld(content);
    ctx.world.succession = [5, 2, 2].map((count, index) => ({
      person: asId('head'), name: 'Head', from: 1100 + index * 20,
      question: { kind: 'thin_line', opened: 1100 + index * 20, baseline: count,
        text: `Only ${count} of the blood are living.`, signature: `thin_line:${index}` },
    }));
    expect(afterimageEvidence(ctx).brush).toEqual({ count: 2,
      source: { year: 1120, text: 'Only 2 of the blood are living.' } });
    ctx.world.succession = [];
    expect(afterimageEvidence(ctx).brush).toBeUndefined();
  });

  it('supplies detached ending evidence and handles an empty or extinct house', () => {
    const ctx = testWorld(content, 1042, 1542);
    ctx.world.chronicle = [];
    ctx.world.succession = [];
    expect(afterimageEvidence(ctx)).toEqual({ people: [] });
    for (const p of ctx.world.people.blood(ctx.world.playerHouse)) {
      ctx.world.people.kill(p.id, 1542, 'the line ended');
    }
    expect(ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive')).toHaveLength(0);
    ctx.world.ending = { id: 'broken_line', year: 1542 };
    ctx.world.chronicle = [page({ text: null })];
    const before = digestOf(ctx);
    const evidence = epilogueOf(ctx)!.afterimage!;
    expect(evidence.blank?.text).toBeNull();
    evidence.blank!.text = 'Cannot write into the save.';
    expect(digestOf(ctx)).toBe(before);
  });

  it('keeps the recorded ancestral silhouette after every member has left the living tree', () => {
    const ctx = testWorld(content, 1042, 1400);
    const parent = place(ctx, { name: 'The recorded mother', sex: 'female', age: 80 });
    const hidden = place(ctx, { name: 'The real mother', sex: 'female', age: 80 });
    const head = place(ctx, { name: 'The last head', sex: 'male', age: 50 });
    head.epithet = 'the Witness';
    parent.epithet = 'of the Tides';
    hidden.epithet = 'the Secret';
    head.trueParents = { mother: hidden.id };
    head.claimedParents = { mother: parent.id };
    ctx.world.succession = [{ person: head.id, name: head.name, from: 1370 }];
    ctx.world.people.kill(head.id, 1400, 'the line ended');
    ctx.world.people.kill(parent.id, 1390, 'old age');
    const before = digestOf(ctx);
    const evidence = afterimageEvidence(ctx);
    expect(evidence.line?.map((person) => person.name)).toEqual(['The last head', 'The recorded mother']);
    expect(evidence.line?.map((person) => person.epithet)).toEqual(['the Witness', 'of the Tides']);
    expect(evidence.line?.[0]?.record.parents.mother).toBe(parent.id);
    expect(JSON.stringify(evidence)).not.toContain('The real mother');
    expect(digestOf(ctx)).toBe(before);
    evidence.line![0]!.record.parents.mother = 'an edit to the photograph';
    expect(head.claimedParents.mother).toBe(parent.id);
  });

  it('rejects an unborn, already dead, or absent last seal-holder in a completed Afterimage (#3131)', () => {
    const ctx = testWorld(content, 3131, 1542);
    const w = ctx.world;
    const earlier = place(ctx, { name: 'The earlier seal', sex: 'male', age: 70 });
    const later = place(ctx, { name: 'The disputed seal', sex: 'male', age: 40 });
    const olderFrom = 1500;
    const laterFrom = 1532;
    w.succession = [
      { person: earlier.id, name: earlier.name, from: olderFrom },
      { person: later.id, name: later.name, from: laterFrom },
    ];
    w.ending = { id: 'forgotten', year: w.year };

    const observedHead = () => [
      afterimageEvidence(ctx).line?.[0]?.id,
      epilogueOf(ctx)!.afterimage?.line?.[0]?.id,
    ];
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const before = digestOf(ctx);
      expect(observedHead()).toEqual([later.id, later.id]);
      expect(digestOf(ctx)).toBe(before);
    }

    // A recovered row with a plausible in-term accession year is still
    // impossible if its supposed Head was not alive when taking the seal.
    const originalBirth = later.born;
    later.born = laterFrom + 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const before = digestOf(ctx);
      expect(observedHead()).toEqual([earlier.id, earlier.id]);
      expect(digestOf(ctx)).toBe(before);
    }
    later.born = originalBirth;
    later.died = laterFrom - 1;
    expect(observedHead()).toEqual([earlier.id, earlier.id]);

    later.died = undefined;
    w.succession[1]!.person = asId('missing-succession-head');
    expect(observedHead()).toEqual([earlier.id, earlier.id]);
    w.succession[1]!.person = later.id;
    expect(observedHead()).toEqual([later.id, later.id]);

    // No censorship of synthetic, unfinished authoring histories.
    w.ending = undefined;
    later.born = laterFrom + 1;
    expect(afterimageEvidence(ctx).line?.[0]?.id).toBe(later.id);
  });
});

describe('collection returns to where the run began (#1867 §6)', () => {
  const page = (year: number, eventId: string, text: string | null, extra: Partial<ChronicleEntry> = {}): ChronicleEntry =>
    ({ year, weight: 'paragraph', text, eventId, named: false, ...extra });

  it('names the founder, quotes the opening arc as the book holds it, and reads the ambition kept in view', () => {
    const ctx = atTheTerm();
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year };
    w.guardianSince = 1090;
    w.houseAmbition = 'deepen_blood';
    w.chronicle.push(
      page(1043, 'the_tutors_good_years', null, { record: 'omit' }),
      page(1044, 'the_alewife_and_the_licence', 'Four crowns to the magistrate.'),
      page(1046, 'three_names_in_the_day_book', 'The children have signed the autumn page.', { record: 'embellish' }),
    );

    const beginning = epilogueOf(ctx)!.beginning!;
    expect(beginning.founder).toBe(w.people.get(w.narrator!)!.name);
    expect(beginning.guardianSince).toBe(1090);
    // Only the opening arc's own pages, in the order written — and an omitted
    // page is still a blank at the reckoning, an improved one still improved.
    expect(beginning.pages.map((e) => [e.eventId, e.text, e.record])).toEqual([
      ['the_tutors_good_years', null, 'omit'],
      ['three_names_in_the_day_book', 'The children have signed the autumn page.', 'embellish'],
    ]);
    expect(beginning.ambition).toMatchObject({ name: 'Deepen the blood' });
    expect(beginning.ambition!.progress).toMatch(/living of the blood/);

    // A reader gets copies, never the saved book.
    beginning.pages[1]!.text = 'rewritten';
    expect(w.chronicle.at(-1)!.text).toBe('The children have signed the autumn page.');
  });

  it('quotes opening-arc pages only after their year, retaining dated blanks', () => {
    const ctx = atTheTerm();
    const year = ctx.world.year;
    ctx.world.ending = { id: 'forgotten', year };
    ctx.world.chronicle.push(
      page(year, 'the_tutors_good_years', null, { record: 'omit' }),
      page(year + 1, 'three_names_in_the_day_book', 'A future claim.', { record: 'embellish' }),
    );

    const before = digestOf(ctx);
    expect(epilogueOf(ctx)!.beginning?.pages.map((e) => [e.eventId, e.text])).toEqual([
      ['the_tutors_good_years', null],
    ]);
    expect(digestOf(ctx), 'a reader never changes the saved account').toBe(before);

    ctx.world.chronicle.at(-1)!.year = year;
    expect(epilogueOf(ctx)!.beginning?.pages.map((e) => [e.eventId, e.text])).toEqual([
      ['the_tutors_good_years', null],
      ['three_names_in_the_day_book', 'A future claim.'],
    ]);
  });

  it('says nothing it did not see: no ambition tracked, no crossing, no opening pages', () => {
    const ctx = atTheTerm();
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    const beginning = epilogueOf(ctx)!.beginning!;
    expect(beginning.pages).toEqual([]);
    expect(beginning.ambition).toBeUndefined();
    expect(beginning.guardianSince).toBeUndefined();
  });
});

describe('a named cost beside the Long Line bloodline purpose (#1983)', () => {
  function accountedRite() {
    const ctx = atTheTerm();
    const w = ctx.world;
    w.campaign = 'long';
    w.ending = { id: 'forgotten', year: w.year };
    w.houseAmbition = 'deepen_blood';
    const vessel = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Wystan', sex: 'male', age: 40 });
    vessel.epithet = 'of the Tides';
    w.chronicle = [page({
      id: 'rite-page', year: w.year, eventId: 'the_vessel_rite',
      text: 'The house wrote that Meriel walked away.',
      people: [vessel.id, ascendant.id], record: 'record',
    })];
    w.decisionLog = [{
      kind: 'outcome', event: 'the_vessel_rite', year: w.year,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [vessel.id], ASCENDANT: [ascendant.id] },
    }];
    w.people.kill(vessel.id, w.year, 'given to the rite', 'vessel_consumed');
    return ctx;
  }

  it('reads a named, written rite cost beside the tracked aim without choosing another ending', () => {
    const ctx = accountedRite();
    const selectedEnding = selectEnding(ctx);
    const before = digestOf(ctx);
    const original = epilogueOf(ctx)!;
    expect(original.id).toBe('forgotten');
    expect(original.purpose).toEqual({
      kind: 'blood_spent',
      person: 'Meriel of the Tides',
      year: ctx.world.year,
      text: 'The house wrote that Meriel walked away.',
      embellished: false,
    });
    expect(original.beginning?.ambition?.name).toBe('Deepen the blood');
    expect(selectEnding(ctx)).toBe(selectedEnding);
    expect(digestOf(ctx)).toBe(before);
    // The epilogue gives the client only detached strings, not a writable page.
    if (original.purpose?.kind !== 'blood_spent') throw new Error('expected a named rite cost');
    original.purpose.text = 'A rewritten account.';
    expect(ctx.world.chronicle[0]!.text).toBe('The house wrote that Meriel walked away.');
    setProseMode(ctx, 'plainenglish');
    const plainPurpose = epilogueOf(ctx)!.purpose;
    expect(plainPurpose).toMatchObject({ text: 'The house wrote that Meriel walked away.' });
    if (plainPurpose?.kind !== 'blood_spent') throw new Error('expected a named rite cost');
    expect(plainPurpose.person).toBe('Meriel of the Tides');
    expect(epilogueOf(ctx)!.id).toBe(original.id);
  });

  it('does not disclose a blood relative’s future-earned byname in the last-night purpose', () => {
    const ctx = accountedRite();
    const victim = ctx.world.people.get(ctx.world.chronicle[0]!.people![0]!)!;
    const year = ctx.world.year;
    victim.byname = {
      source: { kind: 'record', event: 'later_account', pen: 'record', page: 'later-page' },
      year: year + 1,
    };
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'blood_spent', person: 'Meriel',
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);

    victim.byname.year = year;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Meriel of the Tides',
    });
    victim.byname = undefined;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Meriel of the Tides',
    });
  });


  it('does not repeat an already-suffixed epithet in a recorded blood-relative cost', () => {
    const ctx = accountedRite();
    const victim = ctx.world.people.get(ctx.world.chronicle[0]!.people![0]!)!;
    victim.name = 'Meriel of the Tides';
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'blood_spent', person: victim.name });
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'blood_spent', person: victim.name });
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
  });

  it('does not let an earlier outsider rite hide a later documented blood-relative cost', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const relative = w.chronicle[0]!.people![0]!;
    const ascendant = w.chronicle[0]!.people![1]!;
    const outsider = place(ctx, { name: 'Rowena', sex: 'female', age: 40 });
    outsider.houseOfOrigin = asId('another-house');
    w.people.kill(outsider.id, w.year - 1, 'given to the earlier rite', 'vessel_consumed');
    w.chronicle.unshift(page({
      id: 'earlier-outsider-rite', year: w.year - 1, eventId: 'the_vessel_rite',
      text: 'The house wrote that Rowena was offered.', people: [outsider.id, ascendant], record: 'record',
    }));
    w.decisionLog.unshift({
      kind: 'outcome', event: 'the_vessel_rite', year: w.year - 1,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [outsider.id], ASCENDANT: [ascendant] },
    });

    // Read the ending first, as the test above does: that warms derived
    // phenotype caches, so the digest compares stored state, not a cold cache.
    expect(selectEnding(ctx)).toBe('forgotten');
    const before = digestOf(ctx);
    const evidence = afterimageEvidence(ctx);
    // The shared Afterimage still chooses the earliest recorded sacrifice.
    expect(evidence.spent?.person).toBe(outsider.id);
    // But the bloodline reading must not lose the later named relative.
    expect(evidence.spentBlood?.person).toBe(relative);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Meriel of the Tides',
      year: w.year, text: 'The house wrote that Meriel walked away.',
    });
    expect(digestOf(ctx)).toBe(before);
    expect(selectEnding(ctx)).toBe('forgotten');

    // With the relative's written page omitted, the outsider cannot serve
    // as substitute evidence of what this family spent.
    w.chronicle[1]!.text = null;
    expect(afterimageEvidence(ctx).spentBlood).toBeUndefined();
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('does not count another house’s rite victim as a cost to this bloodline', () => {
    const ctx = accountedRite();
    const vesselId = ctx.world.chronicle[0]!.people![0]!;
    const vessel = ctx.world.people.get(vesselId)!;
    vessel.houseOfOrigin = asId('another-house');
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('refuses an impossible pre-birth witness in both the Afterimage and the bloodline purpose', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const victimId = w.chronicle[0]!.people![0]!;
    const victim = w.people.get(victimId)!;
    const originalBirth = victim.born;
    const ending = selectEnding(ctx);

    // A recovered save may have a valid-looking dated page and matching outcome,
    // but a person born after that page cannot have appeared in its rite.
    victim.born = w.year + 1;
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const evidence = afterimageEvidence(ctx);
      expect(evidence.people.some((person) => person.person === victimId)).toBe(false);
      expect(evidence.spent).toBeUndefined();
      expect(evidence.spentBlood).toBeUndefined();
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
      expect(selectEnding(ctx)).toBe(ending);
    }
    expect(digestOf(ctx)).toBe(before);

    // The same page and outcome are admissible when the identity's dated
    // lifetime agrees with the record; no testimony or state was rewritten.
    victim.born = originalBirth;
    expect(afterimageEvidence(ctx).people.some((person) => person.person === victimId)).toBe(true);
    expect(afterimageEvidence(ctx).spent?.person).toBe(victimId);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'blood_spent', person: 'Meriel of the Tides' });
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('does not treat retained text on a legacy omitted rite page as written evidence', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const ritePage = w.chronicle[0]!;
    const victimId = ritePage.people![0]!;
    const selectedEnding = selectEnding(ctx);

    // The attributed rite is real and has an ordinary, surviving written page.
    expect(afterimageEvidence(ctx).spent?.person).toBe(victimId);
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(victimId);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');

    // Old/imported saves can retain the old words while the Record explicitly
    // says the page was omitted. Neither general person provenance nor a rite
    // may quote that hidden text as a surviving written account.
    ritePage.record = 'omit';
    expect(ritePage.text).toBe('The house wrote that Meriel walked away.');
    const omitted = digestOf(ctx);
    const evidence = afterimageEvidence(ctx);
    expect(evidence.spent).toBeUndefined();
    expect(evidence.spentBlood).toBeUndefined();
    expect(evidence.people.some((p) => p.person === victimId)).toBe(false);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(selectedEnding);
    expect(digestOf(ctx)).toBe(omitted);

    // Restoring an actual written Record page restores the same testimony.
    ritePage.record = 'record';
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(victimId);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');
  });

  it('keeps an embellished page disputed, and never reconstructs an omitted one', () => {
    const ctx = accountedRite();
    ctx.world.chronicle[0]!.record = 'embellish';
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ embellished: true });
    ctx.world.chronicle[0]!.text = null;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('does not cite a lost rite page as surviving evidence of a bloodline cost', () => {
    const ctx = accountedRite();
    const selectedEnding = selectEnding(ctx);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');

    // The Afterimage's broad inventory still sees written text, but a page
    // marked as lost must not be quoted as surviving testimony at collection.
    ctx.world.chronicle[0]!.greyed = true;
    const before = digestOf(ctx);
    // The broad Afterimage may still show the lost page, but the reckoning's
    // surviving-blood witness must not cite it.
    expect(afterimageEvidence(ctx).spent).toBeDefined();
    expect(afterimageEvidence(ctx).spentBlood).toBeUndefined();
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(selectedEnding);
    expect(digestOf(ctx)).toBe(before);
  });

  it('does not cite a rite page dated after the Long Line has ended', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const recorded = w.chronicle[0]!;
    const decision = w.decisionLog[0]!;
    if (decision.kind !== 'outcome') throw new Error('expected an attributed rite');

    const ending = selectEnding(ctx);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');

    // An imported or inconsistent record can pair a future page with a future
    // outcome. The creditor must reject it at this year's reading, regardless
    // of the separate Afterimage projection's chronology rules (#2657).
    const victim = w.people.get(recorded.people![0]!)!;
    recorded.year = w.year + 1;
    decision.year = recorded.year;
    // The attributed rite also checks the person's actual death year.
    // Keep all three witnesses consistent so the purpose date guard, not
    // a missing rite attribution, is the only reason to refuse the page.
    victim.died = recorded.year;
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
      expect(selectEnding(ctx)).toBe(ending);
    }
    expect(digestOf(ctx)).toBe(before);

    // Once the page and decision belong to the completed term, the same
    // recorded, named cost is available without changing the ending.
    recorded.year = w.year;
    decision.year = w.year;
    victim.died = w.year;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'blood_spent', person: 'Meriel of the Tides', year: w.year,
      });
      expect(selectEnding(ctx)).toBe(ending);
    }
  });

  it('reads a later surviving blood rite when the earlier written testimony was lost', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const later = w.chronicle[0]!;
    const ascendant = later.people![1]!;
    const earlier = place(ctx, { name: 'Alys', sex: 'female', age: 40 });
    w.people.kill(earlier.id, w.year - 1, 'given to the earlier rite', 'vessel_consumed');
    w.chronicle.unshift(page({
      id: 'lost-earlier-rite', year: w.year - 1, eventId: 'the_vessel_rite',
      text: 'Alys was offered in an earlier generation.',
      people: [earlier.id, ascendant], record: 'record', greyed: true,
    }));
    w.decisionLog.unshift({
      kind: 'outcome', event: 'the_vessel_rite', year: w.year - 1,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [earlier.id], ASCENDANT: [ascendant] },
    });

    const ending = selectEnding(ctx);
    const before = digestOf(ctx);
    // The Afterimage's earliest rite remains historically attributable,
    // but lost testimony must not hide a later surviving bloodline cost.
    expect(afterimageEvidence(ctx).spent?.person).toBe(earlier.id);
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(later.people![0]);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Meriel of the Tides',
      year: w.year, text: 'The house wrote that Meriel walked away.',
    });
    expect(selectEnding(ctx)).toBe(ending);
    expect(digestOf(ctx)).toBe(before);

    // If the earlier page survives too, the first attested blood cost wins.
    w.chronicle[0]!.greyed = false;
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(earlier.id);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Alys', year: w.year - 1,
      text: 'Alys was offered in an earlier generation.',
    });
  });

  it('indexes an exact event and year, ignoring other events while refusing duplicate rite pages (#2607)', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    const victim = w.chronicle[0]!.people![0]!;
    // An unrelated event in the same year is not a second account of this rite.
    w.chronicle.push(page({
      id: 'another-event-page', year: w.year, eventId: 'unrelated_event',
      text: 'A different event also entered the Chronicle this year.',
    }));
    const selectedEnding = selectEnding(ctx);
    const before = digestOf(ctx);
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(victim);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'blood_spent', person: 'Meriel of the Tides',
      text: 'The house wrote that Meriel walked away.',
    });
    expect(selectEnding(ctx)).toBe(selectedEnding);
    expect(digestOf(ctx)).toBe(before);

    // The old decision log has no page ID. Even an otherwise identical
    // second page for the same event and year makes attribution impossible.
    w.chronicle.push({ ...w.chronicle[0]!, id: 'second-rite-page' });
    const ambiguous = digestOf(ctx);
    expect(afterimageEvidence(ctx).spentBlood).toBeUndefined();
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(selectedEnding);
    expect(digestOf(ctx)).toBe(ambiguous);
  });

  it('does not infer pursuit from selecting an ambition, an unsupported rite, or an ambiguous page', () => {
    const ctx = accountedRite();
    const w = ctx.world;
    w.decisionLog = [];
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.decisionLog = [{
      kind: 'outcome', event: 'the_vessel_rite', year: w.year,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [w.chronicle[0]!.people![0]!], ASCENDANT: [w.chronicle[0]!.people![1]!] },
    }];
    w.chronicle.push({ ...w.chronicle[0]!, id: 'other-page' });
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.chronicle.pop();
    w.houseAmbition = 'restore_ledger';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.houseAmbition = 'deepen_blood';
    w.campaign = 'short';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });
});


describe('a viable cadet hall beside the Long Line branch purpose (#1983)', () => {
  function foundedHall() {
    const ctx = atTheTerm();
    const w = ctx.world;
    w.houseAmbition = 'secure_branches';
    w.ending = { id: 'forgotten', year: w.year };
    const branch = 'br_the_other_roof';
    const founder = place(ctx, { name: 'Edrin', sex: 'male', age: 70, branch });
    const relative = place(ctx, { name: 'Leora', sex: 'female', age: 35, branch });
    const cousin = place(ctx, { name: 'Brenna', sex: 'female', age: 30, branch });
    relative.epithet = 'of the Orchard';
    w.branches.set(asId(branch), {
      id: asId(branch), house: asId(w.playerHouse), name: 'The Orchard Hall',
      founder: founder.id, splitFrom: MAIN_BRANCH, foundedYear: w.year - 30,
      grievance: 0,
    });
    // Founders can die without extinguishing the still-viable family hall.
    w.people.kill(founder.id, w.year - 1, 'old age');
    return { ctx, branch, founder, relative, cousin };
  }

  it('names a documented founding and a living relative, not a conjectured rescue', () => {
    const { ctx } = foundedHall();
    // The first chronicle reading may materialize a lazily stored genome; that
    // is existing save representation, not this purpose. Settle it, then prove
    // that reading the branch purpose changes nothing.
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;
    expect(view.purpose).toEqual({
      kind: 'branch_kept', founder: 'Edrin', branch: 'The Orchard Hall',
      year: ctx.world.year - 30, person: 'Leora of the Orchard',
    });
    expect(view.beginning?.ambition?.name).toBe('Secure the branches');
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose).toEqual(view.purpose);
  });

  it('records a different lost hall without assigning it an unproven cause', () => {
    const { ctx } = foundedHall();
    const w = ctx.world;
    const lostBranch = 'br_ash_hall';
    const lostFounder = place(ctx, { name: 'Orrin', sex: 'male', age: 68, branch: lostBranch });
    const lost: BranchState = {
      id: asId(lostBranch), house: asId(w.playerHouse), name: 'The Ash Hall',
      founder: lostFounder.id, splitFrom: MAIN_BRANCH,
      foundedYear: w.year - 30, extinct: w.year - 7, grievance: 0,
    };
    w.branches.set(lostBranch, lost);
    w.people.kill(lostFounder.id, w.year - 7, 'old age');
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const expected = { name: 'The Ash Hall', year: w.year - 7 };
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'branch_kept', branch: 'The Orchard Hall', lostHall: expected,
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);

    // The collected book cannot credit losses in a fractional year,
    // in the future, or before the charter was signed.
    lost.extinct = w.year - 6.5;
    expect(epilogueOf(ctx)!.purpose).not.toHaveProperty('lostHall');
    lost.extinct = w.year + 2;
    expect(epilogueOf(ctx)!.purpose).not.toHaveProperty('lostHall');
    lost.extinct = lost.foundedYear - 1;
    expect(epilogueOf(ctx)!.purpose).not.toHaveProperty('lostHall');
    lost.extinct = w.year - 7;
    lost.foundedYear = w.year + 1;
    expect(epilogueOf(ctx)!.purpose).not.toHaveProperty('lostHall');
    lost.foundedYear = w.year - 30;
    lost.house = asId('another-house');
    expect(epilogueOf(ctx)!.purpose).not.toHaveProperty('lostHall');

    // The ending year, rather than a later save's current year, is the boundary.
    lost.house = asId(w.playerHouse);
    w.year += 5;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'branch_kept', lostHall: expected,
    });
  });

  it('rejects an impossible fractional extinction when crediting a surviving hall', () => {
    const { ctx, branch } = foundedHall();
    const hall = ctx.world.branches.get(asId(branch))!;
    hall.extinct = ctx.world.year + 0.5;
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);
    hall.extinct = ctx.world.year + 1;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('branch_kept');
  });

  it('shows only bynames earned by collection for branch founders and survivors', () => {
    const { ctx, founder, relative } = foundedHall();
    const year = ctx.world.year;
    founder.epithet = 'the Patient';
    founder.byname = {
      source: { kind: 'record', event: 'later_founder_account', pen: 'record', page: 'later-founder' },
      year: year + 1,
    };
    relative.byname = {
      source: { kind: 'record', event: 'later_relative_account', pen: 'record', page: 'later-relative' },
      year: year + 1,
    };
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'branch_kept', founder: 'Edrin', person: 'Leora',
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);

    founder.byname.year = year;
    relative.byname.year = year;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'branch_kept', founder: 'Edrin the Patient', person: 'Leora of the Orchard',
    });
    // A legacy epithet without an award year has always been visible.
    founder.byname = undefined;
    relative.byname = undefined;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'branch_kept', founder: 'Edrin the Patient', person: 'Leora of the Orchard',
    });
  });


  it('does not repeat an epithet already included in either named branch relative', () => {
    const { ctx, founder, relative } = foundedHall();
    founder.name = 'Edrin the Patient';
    founder.epithet = 'the Patient';
    relative.name = 'Leora of the Orchard';
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const expected = { kind: 'branch_kept', founder: 'Edrin the Patient', person: 'Leora of the Orchard' };
    expect(epilogueOf(ctx)!.purpose).toMatchObject(expected);
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose).toMatchObject(expected);
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
  });

  it('excludes future-born occupants from a viable hall on the last night', () => {
    const { ctx, relative, cousin } = foundedHall();
    const w = ctx.world;
    const selected = selectEnding(ctx);
    const witnessed = epilogueOf(ctx)!.purpose;
    expect(witnessed?.kind).toBe('branch_kept');

    // Recovered membership rows can wrongly place someone in a hall years
    // before birth. One actual relative plus a future child is not a family.
    cousin.born = w.year + 1;
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);

    // Nor can two future-born persons together keep that hall.
    relative.born = w.year + 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();

    // When both are born by collection, the actual founding remains eligible.
    cousin.born = w.year - 30;
    relative.born = w.year - 35;
    expect(epilogueOf(ctx)!.purpose).toEqual(witnessed);
  });

  it('does not infer a surviving household from ambition selection, an extinct branch or one survivor', () => {
    const { ctx, branch, relative, cousin } = foundedHall();
    const w = ctx.world;
    w.branches.get(asId(branch))!.extinct = w.year - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.branches.get(asId(branch))!.extinct = undefined;
    w.people.kill(cousin.id, w.year, 'old age');
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(relative.status).toBe('alive');
  });

  it('keeps a last-night branch witness despite deaths and extinction after collection', () => {
    const { ctx, branch, relative, cousin } = foundedHall();
    const w = ctx.world;
    const atCollection = w.ending!.year;
    const witnessed = epilogueOf(ctx)!.purpose;
    expect(witnessed).toMatchObject({ kind: 'branch_kept', person: 'Leora of the Orchard' });

    // This recovered world has moved five years past its stored ending. Both
    // relatives have since died and the branch has closed, but they and its
    // founding were present in the book at collection.
    w.year = atCollection + 5;
    w.people.kill(relative.id, atCollection + 2, 'old age');
    w.people.kill(cousin.id, atCollection + 3, 'old age');
    w.branches.get(asId(branch))!.extinct = atCollection + 4;
    expect(relative.status).toBe('dead');
    expect(cousin.status).toBe('dead');
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toEqual(witnessed);
      expect(epilogueOf(ctx)!.id).toBe('forgotten');
    }
    expect(digestOf(ctx)).toBe(before);

    // The same record must not invent survival if either person or the hall
    // was already gone on the actual last night.
    relative.died = atCollection;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    relative.died = atCollection + 2;
    w.branches.get(asId(branch))!.extinct = atCollection;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.branches.get(asId(branch))!.extinct = atCollection + 4;
    expect(epilogueOf(ctx)!.purpose).toEqual(witnessed);
  });

  it('excludes outside houses, unsupported founders, other ambitions and shorter campaigns', () => {
    const { ctx, branch, founder } = foundedHall();
    const w = ctx.world;
    const b = w.branches.get(asId(branch))!;
    b.house = asId('some-other-house');
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    b.house = asId(w.playerHouse);
    founder.houseOfOrigin = asId('some-other-house');
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    founder.houseOfOrigin = asId(w.playerHouse);
    w.houseAmbition = 'restore_ledger';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.houseAmbition = 'secure_branches';
    w.campaign = 'short';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });
});

describe('a witnessed Ledger clause beside the Long Line purpose (#1983)', () => {
  const clause = content.clauses.find((candidate) => !candidate.known)!;

  function witnessedLedger() {
    const ctx = atTheTerm();
    const w = ctx.world;
    w.houseAmbition = 'restore_ledger';
    w.ending = { id: 'forgotten', year: w.year };
    w.clausesRecovered.add(clause.id);
    const page: ChronicleEntry = {
      year: w.year - 41, weight: 'illuminated', named: true,
      title: clause.name, text: clause.text,
    };
    w.chronicle.push(page);
    return { ctx, page };
  }

  it('quotes one actually recovered, surviving contract page without changing the ending or world', () => {
    const { ctx, page } = witnessedLedger();
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;
    expect(view.purpose).toEqual({
      kind: 'ledger_witness', clause: clause.name, year: page.year, text: clause.text,
    });
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
    setProseMode(ctx, 'plainenglish');
    // The words written into the book do not change when the reader changes modes.
    expect(epilogueOf(ctx)!.purpose).toEqual(view.purpose);
  });

  it('recognizes words frozen in Plain English even after switching the reading mode', () => {
    const { ctx, page } = witnessedLedger();
    const file = ctx.content.sourceOf(clause.id)!;
    const plainText = 'The contract says a promise may not be discarded.';
    setProseVariants(ctx, [{
      address: `content:${file}#clauses[id=${encodeURIComponent(clause.id)}].text`,
      of: proseOriginalHash(clause.text),
      plainenglish: plainText,
    }]);
    page.text = plainText;
    setProseMode(ctx, 'original');
    expect(epilogueOf(ctx)!.purpose).toEqual({
      kind: 'ledger_witness', clause: clause.name, year: page.year, text: plainText,
    });
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ledger_witness');
  });

  it('does not read a recovered clause from a future-dated Chronicle page', () => {
    const { ctx, page } = witnessedLedger();
    const ending = selectEnding(ctx);

    // A correctly named, unique page cannot be testimony before its year.
    page.year = ctx.world.year + 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
      expect(selectEnding(ctx)).toBe(ending);
    }
    // Its actual place in the Chronicle still qualifies; no changed ending.
    page.year = ctx.world.year;
    expect(epilogueOf(ctx)!.purpose).toEqual({
      kind: 'ledger_witness', clause: clause.name, year: ctx.world.year, text: clause.text,
    });
    expect(selectEnding(ctx)).toBe(ending);
    const witnessed = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ledger_witness');
    // The evidence reader is a value-only projection, not a mutation.
    expect(digestOf(ctx)).toBe(witnessed);
  });

  it('does not treat the ambition, an inherited clause, or a count without a page as an act', () => {
    const { ctx, page } = witnessedLedger();
    ctx.world.chronicle = ctx.world.chronicle.filter((entry) => entry !== page);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    ctx.world.chronicle.push(page);
    ctx.world.clausesRecovered.delete(clause.id);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('rejects greyed, omitted, embellished, altered and ambiguous testimony', () => {
    const { ctx, page } = witnessedLedger();
    page.greyed = true;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.greyed = false;
    page.text = null;
    page.record = 'omit';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.text = clause.text;
    page.record = 'embellish';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.record = undefined;
    page.text = 'A different account of the debt.';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.text = clause.text;
    ctx.world.chronicle.push({ ...page });
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('leaves unrelated ambitions and the shorter campaign without this Long Line passage', () => {
    const { ctx } = witnessedLedger();
    ctx.world.houseAmbition = 'secure_branches';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    ctx.world.houseAmbition = 'restore_ledger';
    ctx.world.campaign = 'short';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });
});


describe('a witnessed ascendant waiting on the Ledger at the Long Line reckoning (#2486)', () => {
  function accountedWait() {
    const ctx = atTheTerm();
    const w = ctx.world;
    w.houseAmbition = 'raise_ascendant';
    w.ending = { id: 'forgotten', year: w.year };
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 55 });
    ascendant.epithet = 'the Unwearied';
    const page: ChronicleEntry = {
      id: `ledger_wait:${ascendant.id}`,
      year: w.year - 18,
      weight: 'paragraph',
      title: 'The Ledger Stayed Open',
      text: 'Edric stopped growing older, but the house had not finished the Ledger.',
      people: [ascendant.id],
      named: false,
      rung: 'demigod',
    };
    w.chronicle = [page];
    return { ctx, page, ascendant };
  }

  it('quotes a named, surviving wait without moving the ending or changing saved evidence', () => {
    const { ctx } = accountedWait();
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;
    expect(view.purpose).toEqual({
      kind: 'ascendant_wait',
      person: 'Edric the Unwearied',
      year: ctx.world.year - 18,
      text: 'Edric stopped growing older, but the house had not finished the Ledger.',
    });
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose).toEqual(view.purpose);

    if (view.purpose?.kind !== 'ascendant_wait') throw new Error('missing wait evidence');
    view.purpose.text = 'A rewritten history.';
    expect(ctx.world.chronicle[0]!.text).toBe('Edric stopped growing older, but the house had not finished the Ledger.');
  });

  it('does not backdate the named ascendant’s byname to an earlier last night', () => {
    const { ctx, ascendant } = accountedWait();
    const year = ctx.world.year;
    ascendant.byname = {
      source: { kind: 'reign', from: year - 20, to: year + 1, pen: 'record', pages: 4 },
      year: year + 1,
    };
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'ascendant_wait', person: 'Edric',
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);

    ascendant.byname.year = year;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'ascendant_wait', person: 'Edric the Unwearied',
    });
  });


  it('does not repeat an already-suffixed ascendant epithet in the witnessed wait', () => {
    const { ctx, ascendant } = accountedWait();
    ascendant.name = 'Edric the Unwearied';
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'ascendant_wait', person: ascendant.name });
    setProseMode(ctx, 'plainenglish');
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'ascendant_wait', person: ascendant.name });
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
  });

  it('requires a pursued ambition, a Long Line and an unlost account', () => {
    const { ctx, page } = accountedWait();
    ctx.world.houseAmbition = 'restore_ledger';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    ctx.world.houseAmbition = 'raise_ascendant';
    ctx.world.campaign = 'short';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    ctx.world.campaign = 'long';
    page.greyed = true;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.greyed = false;
    page.text = null;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });

  it('does not treat altered Record testimony as an automatic ledger-wait witness (#2583)', () => {
    const { ctx, page } = accountedWait();
    const ending = selectEnding(ctx);
    const intact = epilogueOf(ctx)!.purpose;
    expect(intact?.kind).toBe('ascendant_wait');

    // The generated wait is a paragraph outside the player's Record choices.
    // Neither a written lie, a blank, a Record page nor a reclassified page
    // is admissible as the original untouched witness.
    for (const record of ['embellish', 'omit', 'record'] as const) {
      page.record = record;
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    }
    page.record = undefined;
    page.weight = 'illuminated';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.weight = 'paragraph';
    page.named = true;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();

    page.named = false;
    expect(epilogueOf(ctx)!.purpose).toEqual(intact);
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('refuses ambiguous, misattributed, unlinked or future testimony', () => {
    const { ctx, page, ascendant } = accountedWait();
    const w = ctx.world;
    w.chronicle.push({ ...page });
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.chronicle.pop();

    page.people = [];
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.people = [ascendant.id];
    page.id = 'ledger_wait:another-person';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.id = `ledger_wait:${ascendant.id}`;
    page.rung = 'adept';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.rung = 'demigod';
    page.year = w.year + 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    page.year = w.year - 18;
    ascendant.houseOfOrigin = asId('unrelated_house');
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });
});


/**
 * Recovered saves can carry records that make an impossible historical claim:
 * the house may have a named page for someone who was not even born when it
 * was written. The last night cannot promote such a page to an attributed
 * family accomplishment or a credible cost (#2803, child of #1983).
 */
describe('chronological last-night purpose witnesses (#2803)', () => {
  it('will not credit a cadet founding to an as-yet unborn or already dead founder', () => {
    const ctx = atTheTerm(280301);
    const w = ctx.world;
    w.houseAmbition = 'secure_branches';
    w.ending = { id: 'forgotten', year: w.year };
    const branch = 'br_premature_charter';
    const founder = place(ctx, { name: 'Edrin', sex: 'male', age: 70, branch });
    place(ctx, { name: 'Leora', sex: 'female', age: 32, branch });
    place(ctx, { name: 'Brenna', sex: 'female', age: 28, branch });
    const foundedYear = w.year - 30;
    w.branches.set(asId(branch), {
      id: asId(branch), house: asId(w.playerHouse), name: 'The Orchard Hall',
      founder: founder.id, splitFrom: MAIN_BRANCH, foundedYear, grievance: 0,
    });

    const ending = selectEnding(ctx);
    const start = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'branch_kept', founder: 'Edrin', year: foundedYear,
    });
    expect(digestOf(ctx)).toBe(start);

    founder.born = foundedYear + 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    }
    // A cadet charter requires the same minimum age as a real departure.
    founder.born = foundedYear - CADET_AGE;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('branch_kept');

    // Death before the charter is no more credible than a future birth.
    founder.died = foundedYear - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    founder.died = undefined;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('branch_kept');
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('refuses an ascendant-wait page dated before its named person existed', () => {
    const ctx = atTheTerm(280302);
    const w = ctx.world;
    w.houseAmbition = 'raise_ascendant';
    w.ending = { id: 'forgotten', year: w.year };
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 55 });
    const recorded = w.year - 18;
    w.chronicle = [{
      id: 'ledger_wait:' + ascendant.id, year: recorded, weight: 'paragraph',
      title: 'The Ledger Stayed Open',
      text: 'Edric stopped growing older, but the Ledger remained.',
      people: [ascendant.id], named: false, rung: 'demigod',
    }];

    const ending = selectEnding(ctx);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'ascendant_wait', person: 'Edric', year: recorded,
    });
    ascendant.born = recorded + 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    }
    ascendant.born = recorded;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ascendant_wait');
    ascendant.died = recorded - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    ascendant.died = undefined;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ascendant_wait');

    // A late surviving page cannot enter a book collected a year earlier,
    // even if an inconsistent imported save has advanced world.year.
    w.ending.year = recorded - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.ending.year = recorded;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ascendant_wait');
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('refuses a sacrifice from before the named blood relative was born', () => {
    const ctx = atTheTerm(280303);
    const w = ctx.world;
    w.houseAmbition = 'deepen_blood';
    w.ending = { id: 'forgotten', year: w.year };
    const vessel = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Wystan', sex: 'male', age: 40 });
    w.chronicle = [{
      id: 'rite-born-later', year: w.year, weight: 'paragraph',
      eventId: 'the_vessel_rite', text: 'The house gave Meriel to the rite.',
      people: [vessel.id, ascendant.id], named: false, record: 'record',
    }];
    w.decisionLog = [{
      kind: 'outcome', event: 'the_vessel_rite', year: w.year,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [vessel.id], ASCENDANT: [ascendant.id] },
    }];
    w.people.kill(vessel.id, w.year, 'given to the rite', 'vessel_consumed');
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(vessel.id);
    expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'blood_spent', person: 'Meriel' });
    const ending = selectEnding(ctx);

    // A legacy death mark and a matching page/outcome are not enough if the
    // subject was unborn when this supposed sacrifice occurred.
    vessel.born = w.year + 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    }
    vessel.born = w.year;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');
    w.ending.year = w.year - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    w.ending.year = w.year;
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('blood_spent');
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('does not recognize Ledger testimony written after the actual ending', () => {
    const ctx = atTheTerm(280304);
    const w = ctx.world;
    w.houseAmbition = 'restore_ledger';
    w.ending = { id: 'forgotten', year: w.year };
    const clause = content.clauses.find((c) => !c.known)!;
    w.clausesRecovered.add(clause.id);
    const recorded = w.year - 3;
    w.chronicle = [{
      id: 'clause-after-term', year: recorded, weight: 'illuminated',
      title: clause.name, text: clause.text, named: true,
    }];
    const ending = selectEnding(ctx);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ledger_witness');

    w.ending.year = recorded - 1;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const before = digestOf(ctx);
      const view = epilogueOf(ctx)!;
      expect(view.purpose).toBeUndefined();
      expect(view.read).toEqual([]);
      expect(view.reckoning.pages).toBe(0);
      expect(digestOf(ctx)).toBe(before);
    }
    w.ending.year = recorded;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'ledger_witness', year: recorded, text: clause.text,
    });
    expect(epilogueOf(ctx)!.reckoning.pages).toBe(1);
    expect(selectEnding(ctx)).toBe(ending);
  });

  it('keeps future opening pages and a future guardian crossing out of the completed reading', () => {
    const ctx = atTheTerm(280305);
    const w = ctx.world;
    const term = w.year - 4;
    w.ending = { id: 'forgotten', year: term };
    w.guardianSince = term + 1;
    w.chronicle = [{
      id: 'late-opening-page', year: term + 1, weight: 'illuminated',
      eventId: 'the_tutors_good_years', named: true,
      text: 'A page written after collection.',
    }];
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const view = epilogueOf(ctx)!;
      expect(view.beginning?.guardianSince).toBeUndefined();
      expect(view.beginning?.pages).toEqual([]);
      expect(view.read).toEqual([]);
      expect(view.reckoning.pages).toBe(0);
    }

    w.ending.year = term + 1;
    const view = epilogueOf(ctx)!;
    expect(view.beginning?.guardianSince).toBe(term + 1);
    expect(view.beginning?.pages).toHaveLength(1);
    expect(view.read.map((p) => p.id)).toEqual(['late-opening-page']);
    expect(view.reckoning.pages).toBe(1);
  });
});


describe('Chronicle chronology in last-night projections (#2842, #2843, #2844)', () => {
  it('quotes the latest thirty dated pages, not the final thirty storage positions (#2842)', () => {
    const ctx = atTheTerm(284201);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year };
    const pages: ChronicleEntry[] = Array.from({ length: 34 }, (_, i) => ({
      year: 1400 + i,
      weight: 'illuminated',
      text: 'Page ' + i,
      named: false,
    }));
    // The newest page was imported first, while an unwritten page follows the lot.
    w.chronicle = [pages[33]!, ...pages.slice(0, 33), {
      year: w.year + 1, weight: 'illuminated', text: 'Not yet written', named: false,
    }];
    const ending = selectEnding(ctx);
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;

    expect(view.read.map((p) => p.text)).toEqual(pages.slice(-30).map((p) => p.text));
    expect(view.read.map((p) => p.year)).toEqual(pages.slice(-30).map((p) => p.year));
    expect(view.reckoning.pages).toBe(pages.length);
    expect(selectEnding(ctx)).toBe(ending);
    expect(digestOf(ctx)).toBe(before);
    view.read[0]!.text = 'A rewritten copy';
    expect(digestOf(ctx)).toBe(before);
  });

  it('reads saved opening-arc testimony in year order, retaining same-year page order (#2843)', () => {
    const ctx = atTheTerm(284301);
    const w = ctx.world;
    w.ending = { id: 'forgotten', year: w.year };
    const earlier: ChronicleEntry = {
      id: 'opening-early', year: 1043, eventId: 'the_tutors_good_years',
      weight: 'paragraph', text: null, named: false, record: 'omit',
    };
    const later: ChronicleEntry = {
      id: 'opening-late', year: 1046, eventId: 'three_names_in_the_day_book',
      weight: 'paragraph', text: 'The late page.', named: false, record: 'embellish',
    };
    const sameYear: ChronicleEntry = {
      id: 'opening-same-year', year: 1046, eventId: 'the_tutors_good_years',
      weight: 'paragraph', text: 'Another page from the same year.', named: false,
    };
    w.chronicle = [later, sameYear, earlier];
    const ending = selectEnding(ctx);
    const before = digestOf(ctx);
    const view = epilogueOf(ctx)!;

    expect(view.beginning?.pages.map((p) => p.id)).toEqual([
      'opening-early', 'opening-late', 'opening-same-year',
    ]);
    expect(view.beginning?.pages[0]!.text).toBeNull();
    expect(view.beginning?.pages[1]!.record).toBe('embellish');
    expect(selectEnding(ctx)).toBe(ending);
    expect(digestOf(ctx)).toBe(before);
    view.beginning!.pages[0]!.text = 'A new claim';
    expect(w.chronicle[2]!.text).toBeNull();
  });

  it('dates the first highest-rung testimony, regardless of storage order (#2844)', () => {
    const ctx = atTheTerm(284401);
    const w = ctx.world;
    w.chronicle = [];
    forge(ctx, 'hierophant', 1530);
    forge(ctx, 'hierophant', 1510);
    forge(ctx, 'adept', 1500);
    w.ascension.best = 'hierophant';
    const ending = selectEnding(ctx);
    const before = digestOf(ctx);
    const reading = readTheChronicle(ctx);

    expect(reading.attested).toBe('hierophant');
    expect(reading.attestedYear).toBe(1510);
    expect(reading.substantiated).toBe('hierophant');
    expect(selectEnding(ctx)).toBe(ending);
    expect(digestOf(ctx)).toBe(before);
    expect(w.chronicle.map((entry) => entry.year)).toEqual([1530, 1510, 1500]);
  });
});


describe('future duplicates cannot erase earlier ascendant testimony (#2846)', () => {
  it('ignores future copies but still rejects two present-year copies of one wait', () => {
    const ctx = atTheTerm(284601);
    const w = ctx.world;
    w.houseAmbition = 'raise_ascendant';
    w.ending = { id: 'forgotten', year: w.year };
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 55 });
    const page: ChronicleEntry = {
      id: 'ledger_wait:' + ascendant.id,
      year: w.year - 10,
      weight: 'paragraph',
      title: 'The Ledger Stayed Open',
      text: 'Edric was ageless, but the Ledger remained unfinished.',
      named: false,
      rung: 'demigod',
      people: [ascendant.id],
    };
    w.chronicle = [page, { ...page, year: w.year + 1 }];
    const ending = selectEnding(ctx);
    const before = digestOf(ctx);

    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'ascendant_wait',
      person: 'Edric',
      year: page.year,
    });
    expect(selectEnding(ctx)).toBe(ending);
    expect(digestOf(ctx)).toBe(before);

    // Both rows now exist at collection, so their shared ID is ambiguous.
    w.chronicle[1]!.year = w.year;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(ending);
  });
});


describe('pre-founding duplicates cannot erase a Long Line wait witness (#1983)', () => {
  it('ignores a matching ID from before founding but still rejects a second in-term page', () => {
    const ctx = atTheTerm(198301);
    const w = ctx.world;
    w.houseAmbition = 'raise_ascendant';
    w.ending = { id: 'forgotten', year: w.year };
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 55 });
    const page: ChronicleEntry = {
      id: 'ledger_wait:' + ascendant.id,
      year: w.year - 10,
      weight: 'paragraph',
      title: 'The Ledger Stayed Open',
      text: 'Edric was ageless, but the Ledger remained unfinished.',
      named: false,
      rung: 'demigod',
      people: [ascendant.id],
    };
    w.chronicle = [page, { ...page, year: CAMPAIGNS.long.startYear - 1 }];
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);

    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'ascendant_wait', person: 'Edric', year: page.year,
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);
    expect(w.chronicle[1]!.year).toBe(CAMPAIGNS.long.startYear - 1);

    // A second page within this house's term does make the ID ambiguous.
    w.chronicle[1]!.year = w.year;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
  });
});

describe('the completed Chronicle starts with the founding (#2930)', () => {
  it('excludes pre-founding pages, blanks, false attestation and embellished proof debt', () => {
    const ctx = atTheTerm(293001);
    const w = ctx.world;
    const start = CAMPAIGNS.long.startYear;
    w.ending = { id: 'forgotten', year: w.year };
    w.ascension.best = 'god';
    const real: ChronicleEntry = {
      year: start, weight: 'illuminated', text: 'The first genuine page.', named: false,
    };
    w.chronicle = [real];
    const selected = selectEnding(ctx);
    w.discrepancies.set('forged_before_founding', { severity: 'total', state: 'open', provableBy: [] });
    w.chronicle = [
      { year: start - 1, weight: 'paragraph', named: false, rung: 'god',
        text: 'A claimed apotheosis before the house existed.' },
      { year: start - 1, weight: 'illuminated', named: false, record: 'embellish',
        text: 'An embellished accusation before the house existed.',
        discrepancyId: 'forged_before_founding' },
      { year: start - 1, weight: 'paragraph', text: null, named: false,
        record: 'omit', eventId: 'the_tutors_good_years' },
      real,
    ];
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      const reckoning = readTheChronicle(ctx);
      expect(reckoning).toMatchObject({
        pages: 1, blanks: 0, recorded: 0, embellished: 0,
        attested: 'none', unsupportable: 0,
      });
      const view = epilogueOf(ctx)!;
      expect(view.read.map((page) => page.text)).toEqual(['The first genuine page.']);
      expect(view.beginning?.pages).toEqual([]);
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);
    expect(w.chronicle).toHaveLength(4);
  });
});

describe('Long Line family-purpose witnesses begin with the house (#2931)', () => {
  it('refuses pre-founding recovered Ledger testimony but admits the founding year', () => {
    const ctx = atTheTerm(293101);
    const w = ctx.world;
    const start = CAMPAIGNS.long.startYear;
    const clause = content.clauses.find((item) => !item.known)!;
    w.houseAmbition = 'restore_ledger';
    w.ending = { id: 'forgotten', year: w.year };
    w.clausesRecovered.add(clause.id);
    const page: ChronicleEntry = {
      year: start - 1, weight: 'illuminated', named: true,
      title: clause.name, text: clause.text,
    };
    w.chronicle = [page];
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    }
    page.year = start;
    expect(epilogueOf(ctx)!.purpose).toMatchObject({
      kind: 'ledger_witness', year: start, clause: clause.name,
    });
    expect(w.chronicle[0]).toBe(page);
    expect(digestOf(ctx)).not.toBe(before); // Only our deliberate date edit changed the save.
    const accepted = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose?.kind).toBe('ledger_witness');
    expect(digestOf(ctx)).toBe(accepted);
  });

  it('refuses a purported demigod wait dated before the founding', () => {
    const ctx = atTheTerm(293102);
    const w = ctx.world;
    const start = CAMPAIGNS.long.startYear;
    w.houseAmbition = 'raise_ascendant';
    w.ending = { id: 'forgotten', year: w.year };
    const ascendant = place(ctx, { name: 'Edric', sex: 'male', age: 55 });
    ascendant.born = start - 40; // The witness is old enough; the book is still too early.
    const page: ChronicleEntry = {
      id: `ledger_wait:${ascendant.id}`, year: start - 1,
      weight: 'paragraph', named: false, rung: 'demigod',
      text: 'Edric waited at the Ledger before the house was signed.',
      people: [ascendant.id],
    };
    w.chronicle = [page];
    // Settle the ordinary first-read genome materialization before measuring
    // whether the new purpose projection changes the saved account.
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
    page.year = start;
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'ascendant_wait', person: 'Edric', year: start,
      });
    }
  });

  it('refuses an otherwise attributable blood rite before the campaign begins', () => {
    const ctx = atTheTerm(293103);
    const w = ctx.world;
    const start = CAMPAIGNS.long.startYear;
    w.houseAmbition = 'deepen_blood';
    w.ending = { id: 'forgotten', year: w.year };
    const victim = place(ctx, { name: 'Meriel', sex: 'female', age: 40 });
    const ascendant = place(ctx, { name: 'Wystan', sex: 'male', age: 40 });
    w.people.kill(victim.id, w.year, 'given to a rite', 'vessel_consumed');
    victim.born = start - 30;
    ascendant.born = start - 30; // Every named actor existed by the claimed rite.
    victim.died = start - 1;
    const page: ChronicleEntry = {
      id: 'pre-founding-vessel', year: start - 1, weight: 'paragraph',
      eventId: 'the_vessel_rite', text: 'Meriel was offered at the rite.',
      people: [victim.id, ascendant.id], named: false, record: 'record',
    };
    w.chronicle = [page];
    w.decisionLog = [{
      kind: 'outcome', event: 'the_vessel_rite', year: start - 1,
      choiceId: 'speak_the_name', outcomeId: 'taken',
      fill: { VESSEL: [victim.id], ASCENDANT: [ascendant.id] },
    }];
    const outcome = w.decisionLog[0]!;
    if (outcome.kind !== 'outcome') throw new Error('expected attributed rite');
    // Completed Afterimages exclude pre-founding pages even when a rite
    // elsewhere in the world state could otherwise be attributed.
    expect(afterimageEvidence(ctx).spentBlood).toBeUndefined();
    // As above, the general reckoning may materialize the ascendant's genome.
    const selected = selectEnding(ctx);
    const before = digestOf(ctx);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    expect(selectEnding(ctx)).toBe(selected);
    expect(digestOf(ctx)).toBe(before);
    page.year = start;
    outcome.year = start;
    victim.died = start;
    expect(afterimageEvidence(ctx).spentBlood?.person).toBe(victim.id);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'blood_spent', person: 'Meriel', year: start,
      });
    }
  });
});

describe('cadet founding is an actual adult son leaving the seat (#2932)', () => {
  it('rejects female, minor and pre-campaign founders while admitting age 24', () => {
    const ctx = atTheTerm(293201);
    const w = ctx.world;
    w.houseAmbition = 'secure_branches';
    w.ending = { id: 'forgotten', year: w.year };
    const id = 'br_charter_integrity';
    const founder = place(ctx, { name: 'Edrin', sex: 'male', age: 70, branch: id });
    place(ctx, { name: 'Leora', sex: 'female', age: 35, branch: id });
    place(ctx, { name: 'Brenna', sex: 'female', age: 30, branch: id });
    const foundedYear = w.year - 30;
    w.branches.set(asId(id), {
      id: asId(id), house: asId(w.playerHouse), name: 'The Orchard Hall',
      founder: founder.id, splitFrom: MAIN_BRANCH, foundedYear, grievance: 0,
    });
    const branch = w.branches.get(asId(id))!;
    const selected = selectEnding(ctx);
    const original = epilogueOf(ctx)!.purpose;
    expect(original).toMatchObject({ kind: 'branch_kept', founder: 'Edrin' });

    founder.sex = 'female';
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    founder.sex = 'male';
    founder.born = foundedYear - (CADET_AGE - 1);
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    founder.born = foundedYear - CADET_AGE;
    expect(epilogueOf(ctx)!.purpose).toEqual(original);

    const start = CAMPAIGNS.long.startYear;
    branch.foundedYear = start - 1;
    founder.born = start - CADET_AGE - 1;
    expect(epilogueOf(ctx)!.purpose).toBeUndefined();
    branch.foundedYear = start;
    founder.born = start - CADET_AGE;
    const before = digestOf(ctx);
    for (const mode of ['original', 'plainenglish'] as const) {
      setProseMode(ctx, mode);
      expect(epilogueOf(ctx)!.purpose).toMatchObject({
        kind: 'branch_kept', founder: 'Edrin', year: start,
      });
      expect(selectEnding(ctx)).toBe(selected);
    }
    expect(digestOf(ctx)).toBe(before);
  });
});

describe('the credited cadet charter matches surviving founder membership evidence (#1983)', () => {
  it('rejects a documented different hall, house or membership kind without inventing a new ending', () => {
    const ctx = atTheTerm(198312);
    const w = ctx.world;
    const branch = 'br_charter_testimony';
    const foundedYear = w.year - 30;
    w.houseAmbition = 'secure_branches';
    w.ending = { id: 'forgotten', year: w.year };
    const founder = place(ctx, { name: 'Edrin', sex: 'male', age: 70, branch });
    place(ctx, { name: 'Leora', sex: 'female', age: 35, branch });
    place(ctx, { name: 'Brenna', sex: 'female', age: 30, branch });
    w.branches.set(asId(branch), {
      id: asId(branch), house: asId(w.playerHouse), name: 'The Orchard Hall',
      founder: founder.id, splitFrom: MAIN_BRANCH, foundedYear, grievance: 0,
    });

    const ending = selectEnding(ctx);
    const legacy = epilogueOf(ctx)!.purpose;
    // Old saves lacking dated founder membership can still use the saved charter.
    expect(legacy).toMatchObject({ kind: 'branch_kept', founder: 'Edrin' });

    const open = founder.membership.find((membership) => membership.to === undefined)!;
    founder.membership = [{ ...open, from: foundedYear, branch: 'br_unrelated' }];
    const recorded = founder.membership[0]!;
    const rejects = () => {
      for (const mode of ['original', 'plainenglish'] as const) {
        setProseMode(ctx, mode);
        const before = digestOf(ctx);
        expect(epilogueOf(ctx)!.purpose).toBeUndefined();
        expect(selectEnding(ctx)).toBe(ending);
        expect(digestOf(ctx)).toBe(before);
      }
    };

    rejects(); // The charter's purported author lived in another hall.
    recorded.branch = branch;
    expect(epilogueOf(ctx)!.purpose).toEqual(legacy);
    recorded.kind = 'ward';
    rejects(); // Residence alone did not permit a cadet charter.
    recorded.kind = 'blood';
    recorded.house = asId('other-house');
    rejects(); // Another house cannot found this player's branch.
    recorded.house = asId(w.playerHouse);
    expect(epilogueOf(ctx)!.purpose).toEqual(legacy);
    expect(selectEnding(ctx)).toBe(ending);
  });
  it('does not credit a charter or survivor from conflicting same-year memberships', () => {
    const ctx = atTheTerm(198313);
    const w = ctx.world;
    const branch = 'br_conflicting_memberships';
    const foundedYear = w.year - 30;
    w.houseAmbition = 'secure_branches';
    w.ending = { id: 'forgotten', year: w.year };
    const founder = place(ctx, { name: 'Edrin', sex: 'male', age: 70, branch });
    const relative = place(ctx, { name: 'Leora', sex: 'female', age: 35, branch });
    place(ctx, { name: 'Brenna', sex: 'female', age: 30, branch });
    w.branches.set(asId(branch), {
      id: asId(branch), house: asId(w.playerHouse), name: 'The Orchard Hall',
      founder: founder.id, splitFrom: MAIN_BRANCH, foundedYear, grievance: 0,
    });
    w.people.kill(founder.id, w.year - 1, 'old age');
    const selected = selectEnding(ctx);
    const expected = epilogueOf(ctx)!.purpose;
    expect(expected).toMatchObject({ kind: 'branch_kept', person: 'Leora' });

    const assertAmbiguous = () => {
      for (const mode of ['original', 'plainenglish'] as const) {
        setProseMode(ctx, mode);
        const before = digestOf(ctx);
        expect(epilogueOf(ctx)!.purpose).toBeUndefined();
        expect(selectEnding(ctx)).toBe(selected);
        expect(digestOf(ctx)).toBe(before);
      }
    };

    // The charter has both a plausible branch membership and a competing
    // historical placement. Neither row may be chosen just by array order.
    const historical = founder.membership[0]!;
    const documented = { ...historical, from: foundedYear, branch };
    const contradictory = { ...historical, from: foundedYear, branch: 'br_other_roof' };
    founder.membership = [documented, contradictory];
    assertAmbiguous();
    founder.membership.reverse();
    assertAmbiguous();
    founder.membership = [documented];
    expect(epilogueOf(ctx)!.purpose).toEqual(expected);

    // Two living relatives made the hall viable. One with conflicting
    // collection-year memberships cannot count as a certain resident.
    const resident = relative.membership.find((m) => m.to === undefined)!;
    const originalMemberships = [...relative.membership];
    relative.membership.push({ ...resident, from: w.year - 1, branch: 'br_other_roof' });
    assertAmbiguous();
    relative.membership.reverse();
    assertAmbiguous();
    relative.membership = originalMemberships;
    expect(epilogueOf(ctx)!.purpose).toEqual(expected);
  });

});


describe('completed family-purpose evidence requires whole, dated years (#1983)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'refuses fractional Chronicle testimony but still reads a genuine wait (%s)',
    (mode) => {
      const ctx = atTheTerm(198318);
      const w = ctx.world;
      setProseMode(ctx, mode);
      const ascendant = place(ctx, { name: 'Edran', sex: 'male', age: 40 });
      w.ending = { id: 'forgotten', year: w.year };
      w.houseAmbition = 'raise_ascendant';
      w.chronicle = [{
        id: `ledger_wait:${ascendant.id}`,
        year: w.year - 0.5, weight: 'paragraph', named: false,
        rung: 'demigod', text: 'The book says Edran waited.',
        people: [ascendant.id],
      }];
      const before = digestOf(ctx);
      const invalid = epilogueOf(ctx)!;
      expect(invalid.purpose).toBeUndefined();
      expect(invalid.reckoning.pages).toBe(0);
      expect(invalid.read).toEqual([]);
      expect(invalid.afterimage?.people).toEqual([]);
      expect(digestOf(ctx)).toBe(before);

      // The same uniquely attributed account is eligible when it really
      // belongs to the last night, in either supported prose mode.
      w.chronicle[0]!.year = w.year - 1;
      const valid = epilogueOf(ctx)!;
      expect(valid.purpose).toMatchObject({
        kind: 'ascendant_wait', person: 'Edran', year: w.year - 1,
      });
      expect(valid.afterimage?.people.some((p) => p.person === ascendant.id)).toBe(true);
      // An invalid duplicate is not another admissible witness of the deed.
      w.chronicle.push({ ...w.chronicle[0]!, year: w.year - 0.5 });
      expect(epilogueOf(ctx)!.purpose).toMatchObject({ kind: 'ascendant_wait' });
    },
  );

  it('ignores fractional succession and thin-line dates in the completed Afterimage', () => {
    const ctx = atTheTerm(198319);
    const w = ctx.world;
    const earlier = place(ctx, { name: 'Earlier Head', sex: 'male', age: 70 });
    const later = place(ctx, { name: 'Later Head', sex: 'male', age: 40 });
    w.ending = { id: 'forgotten', year: w.year };
    w.succession = [
      { person: earlier.id, name: earlier.name, from: w.year - 10,
        question: { kind: 'thin_line', opened: w.year - 10, baseline: 3,
          text: 'Three remain.', signature: 'three-remaining' } },
      { person: later.id, name: later.name, from: w.year - 0.5,
        question: { kind: 'thin_line', opened: w.year - 0.5, baseline: 1,
          text: 'One remains.', signature: 'one-remaining' } },
    ];
    const before = digestOf(ctx);
    const invalid = epilogueOf(ctx)!.afterimage!;
    expect(invalid.line?.[0]?.id).toBe(earlier.id);
    expect(invalid.brush?.count).toBe(3);
    expect(digestOf(ctx)).toBe(before);

    // A valid accession does not make a corrupt question date truthful.
    w.succession[1] = {
      person: later.id, name: later.name, from: w.year - 1,
      question: { kind: 'thin_line', opened: w.year - 0.5, baseline: 1,
        text: 'One remains.', signature: 'one-remaining' },
    };
    const mixed = afterimageEvidence(ctx);
    expect(mixed.line?.[0]?.id).toBe(later.id);
    expect(mixed.brush?.count).toBe(3);
    // Restore the question's real year; its lower count can now be read.
    w.succession[1] = {
      person: later.id, name: later.name, from: w.year - 1,
      question: { kind: 'thin_line', opened: w.year - 1, baseline: 1,
        text: 'One remains.', signature: 'one-remaining' },
    };
    expect(afterimageEvidence(ctx).brush?.count).toBe(1);
  });
  it.each(['original', 'plainenglish'] as const)(
    'ignores corrupt thin-line headcounts in the completed Afterimage (%s)',
    (mode) => {
      const ctx = atTheTerm(198320);
      const w = ctx.world;
      setProseMode(ctx, mode);
      const earlier = place(ctx, { name: 'Earlier Head', sex: 'male', age: 75 });
      const later = place(ctx, { name: 'Later Head', sex: 'male', age: 40 });
      w.ending = { id: 'forgotten', year: w.year };
      const first = {
        person: earlier.id, name: earlier.name, from: w.year - 10,
        question: { kind: 'thin_line' as const, opened: w.year - 10,
          baseline: 4, text: 'Four remained.', signature: 'four-remained' },
      };
      const second = (baseline: number) => ({
        person: later.id, name: later.name, from: w.year - 1,
        question: { kind: 'thin_line' as const, opened: w.year - 1,
          baseline, text: 'The later count.', signature: 'later-count' },
      });

      for (const invalid of [-2, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        w.succession = [first, second(invalid)];
        const before = digestOf(ctx);
        const reading = epilogueOf(ctx)!.afterimage!;
        expect(reading.brush).toMatchObject({
          count: 4, source: { text: 'Four remained.' },
        });
        expect(digestOf(ctx)).toBe(before);
      }

      // Whole non-negative counts still retain their ordinary ordering.
      w.succession = [first, second(2)];
      expect(epilogueOf(ctx)!.afterimage?.brush?.count).toBe(2);
      w.succession = [first, second(0)];
      expect(afterimageEvidence(ctx).brush?.count).toBe(0);
    },
  );

});

describe('completed Afterimage thin-line counts require a credible Head and tenure (#1983)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'rejects an impossible Head or question date without losing a valid count (%s)',
    (mode) => {
      const ctx = atTheTerm(198321);
      const w = ctx.world;
      const earlier = place(ctx, { name: 'Earlier Head', sex: 'male', age: 75 });
      const later = place(ctx, { name: 'Disputed Head', sex: 'male', age: 40 });
      const earlierYear = w.year - 10;
      const laterYear = w.year - 2;
      w.ending = { id: 'forgotten', year: w.year };
      setProseMode(ctx, mode);
      const credited = {
        person: earlier.id, name: earlier.name, from: earlierYear,
        question: { kind: 'thin_line' as const, opened: earlierYear,
          baseline: 4, text: 'Four were in the house.', signature: 'four-in-house' },
      };
      const disputed = {
        person: later.id, name: later.name, from: laterYear, to: w.year - 1,
        question: { kind: 'thin_line' as const, opened: laterYear,
          baseline: 1, text: 'One was in the house.', signature: 'one-in-house' },
      };
      w.succession = [credited, disputed];
      const selected = selectEnding(ctx);
      const count = () => epilogueOf(ctx)!.afterimage?.brush?.count;
      expect(count()).toBe(1);

      // An invented last Head must not give the book a smaller family.
      disputed.person = asId('absent-afterimage-head');
      expect(count()).toBe(4);
      disputed.person = later.id;
      const birth = later.born;
      later.born = laterYear + 1;
      expect(count()).toBe(4);
      later.born = birth;
      later.died = laterYear - 1;
      expect(count()).toBe(4);
      later.died = undefined;

      // Even a real Head cannot remember a generation before taking the
      // seal, or a question added after that reign had already ended.
      disputed.question.opened = laterYear - 1;
      expect(count()).toBe(4);
      disputed.question.opened = w.year;
      expect(count()).toBe(4);
      disputed.question.opened = laterYear;
      disputed.to = laterYear + 0.5;
      expect(count()).toBe(4);
      disputed.to = w.year - 1;

      const before = digestOf(ctx);
      expect(count()).toBe(1);
      expect(selectEnding(ctx)).toBe(selected);
      expect(digestOf(ctx)).toBe(before);
    },
  );
});
