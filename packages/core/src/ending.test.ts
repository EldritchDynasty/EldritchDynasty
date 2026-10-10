import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  CAMPAIGNS, END_YEAR, GOD_RITE_FAILED, closeTheLedger, digestOf, endingSummary, epilogueOf, foundHouse,
  prologueView, readTheChronicle, selectEnding, setProseMode, setProseVariants, stepYear, testWorld,
} from '@ed/core';
import { ENDING_ORDER, proseOriginalAt, proseOriginalHash, type EndingId, type Rung } from '@ed/schema';
import type { SimCtx } from './world.js';
import { coreMessageAddress } from './messages.js';
import { rungTitle } from './ascension.js';

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
      { id: 'apotheosis', key: 'ending.summary.apotheosis', r: base, values: { RUNG: rungTitle(base.attested) } },
      { id: 'unmade', key: 'ending.summary.unmade', r: base, values: {} },
      { id: 'broken_line', key: 'ending.summary.broken_line', r: base, values: {} },
      { id: 'settled', key: 'ending.summary.settled', r: base, values: { TOTAL: String(base.clausesTotal) } },
      { id: 'forgotten', key: 'ending.summary.forgotten_withheld', r: withheld, values: { RUNG: rungTitle(withheld.attested) } },
      { id: 'forgotten', key: 'ending.summary.forgotten', r: base, values: { RUNG: rungTitle('adept') } },
      { id: 'devoured', key: 'ending.summary.devoured', r: base, values: { RUNG: rungTitle(base.substantiated) } },
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
      render(PLAIN['ending.summary.forgotten']!, { RUNG: rungTitle('adept') })
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
    ctx.world.chronicle.push({ year: 1700, weight: 'paragraph', text: null, named: false, record: 'omit' });
    ctx.world.chronicle.push({
      year: 1701, weight: 'paragraph', text: 'A thing that did not happen.', named: false, record: 'embellish',
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
