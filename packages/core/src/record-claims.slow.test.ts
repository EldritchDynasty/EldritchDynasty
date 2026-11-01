import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  autoResolveDecision, bootstrap, bynameStanding, expectRate, makeRng, resolveRecord, stepYear,
  type RecordOption,
} from '@ed/core';

const bundle = loadContent();
const YEARS = 500;
const SEEDS = [1380, 1518, 1656, 1794];

interface ReadStats {
  entriesWithClaims: number;
  cards: number;
  cardsWithOurBook: number;
  truthfulPages: number;
  embellishedPages: number;
}

/**
 * Play with the docket OPEN so Match cards can be inspected before the
 * decision consumes them. Everything except the Record answer still goes
 * through the engine's ordinary auto resolver.
 */
function play(seed: number, answer: RecordOption): ReadStats {
  const ctx = bootstrap(bundle, seed, 1042);
  const rng = makeRng(seed * 17 + 138);
  let cards = 0;
  let cardsWithOurBook = 0;
  let truthfulPages = 0;
  let embellishedPages = 0;

  for (let i = 0; i < YEARS; i++) {
    const before = ctx.world.year;
    stepYear(ctx, false);

    let guard = 0;
    while (ctx.world.pendingDecisions.length) {
      if (guard++ > 500) throw new Error('decision queue did not drain');
      const decision = ctx.world.pendingDecisions[0]!;

      if (decision.kind === 'match') {
        cards += decision.cards.length;
        for (const card of decision.cards) {
          const pages = card.panel?.ourBook ?? [];
          if (pages.length) cardsWithOurBook += 1;
          for (const page of pages) {
            if (page.embellished) embellishedPages += 1;
            else truthfulPages += 1;
          }
        }
      }

      if (decision.kind === 'record') resolveRecord(ctx, decision.id, answer);
      else autoResolveDecision(ctx, decision, rng);
    }

    // Broken line or campaign term: the clock has deliberately stopped.
    if (ctx.world.year === before) break;
  }

  return {
    entriesWithClaims: ctx.world.chronicle.filter((e) => (e.claims?.length ?? 0) > 0).length,
    cards,
    cardsWithOurBook,
    truthfulPages,
    embellishedPages,
  };
}

const sum = (xs: ReadStats[], key: keyof ReadStats) => xs.reduce((n, x) => n + x[key], 0);

describe('truthful claims reach the Match panel over played runs (issue #138)', () => {
  it('four always-Record 500-year runs produce claimed pages and ourBook rows', () => {
    const runs = SEEDS.map((seed) => play(seed, 'record'));
    expect(sum(runs, 'entriesWithClaims')).toBeGreaterThan(0);
    expect(sum(runs, 'cards')).toBeGreaterThan(0);
    expect(sum(runs, 'cardsWithOurBook')).toBeGreaterThan(0);
    expect(sum(runs, 'truthfulPages')).toBeGreaterThan(0);
  });

  it('PanelPage.embellished has both reachable values across the two record policies', () => {
    const honest = SEEDS.map((seed) => play(seed, 'record'));
    const forged = SEEDS.map((seed) => play(seed, 'embellish'));
    expect(sum(honest, 'truthfulPages')).toBeGreaterThan(0);
    expect(sum(forged, 'embellishedPages')).toBeGreaterThan(0);
  });
});

/**
 * EARNED BYNAMES OVER PLAYED RUNS (#1990).
 *
 * Mechanism, not tuning: the same four seeds and 500-year Long Lines as the
 * claims above, played with the docket open and one pen held for every
 * Record answer. Omit must name nobody; Record names only on its own pages
 * and attests; Embellish names only on its own pages and ties the name to
 * the lie it opened. The incidence the batch reports (Heads against other
 * blood relatives) is printed with its denominators for the balance log and
 * held to the contract's provisional shape — a minority of relatives, Heads
 * far more often — rather than to any one seed's count.
 */
interface BynameBatch {
  heads: number;
  headsNamed: number;
  relatives: number;
  relativesNamed: number;
  grants: number;
  contested: number;
}

function playForBynames(seed: number, answer: RecordOption): { ctx: ReturnType<typeof bootstrap>; batch: BynameBatch } {
  const ctx = bootstrap(bundle, seed, 1042);
  const rng = makeRng(seed * 31 + 1990);
  for (let i = 0; i < YEARS; i++) {
    const before = ctx.world.year;
    stepYear(ctx, false);
    let guard = 0;
    while (ctx.world.pendingDecisions.length) {
      if (guard++ > 500) throw new Error('decision queue did not drain');
      const decision = ctx.world.pendingDecisions[0]!;
      if (decision.kind === 'record') resolveRecord(ctx, decision.id, answer);
      else autoResolveDecision(ctx, decision, rng);
    }
    if (ctx.world.year === before) break;
  }
  const w = ctx.world;
  const heads = new Set(w.succession.map((held) => String(held.person)));
  const blood = w.people.blood(w.playerHouse);
  const named = blood.filter((p) => p.byname !== undefined);
  return {
    ctx,
    batch: {
      heads: heads.size,
      headsNamed: [...heads].filter((id) => w.people.get(id)?.byname !== undefined).length,
      relatives: blood.filter((p) => !heads.has(String(p.id))).length,
      relativesNamed: named.filter((p) => !heads.has(String(p.id))).length,
      grants: w.people.all().filter((p) => p.byname !== undefined).length,
      contested: w.people.all().filter((p) => bynameStanding(p) === 'contested').length,
    },
  };
}

const total = (xs: BynameBatch[], key: keyof BynameBatch) => xs.reduce((n, x) => n + x[key], 0);

describe('earned bynames over played runs (#1990)', () => {
  it('Omit names nobody, Record attests on its own page, Embellish ties the name to its lie', () => {
    const report: string[] = [];
    for (const pen of ['omit', 'record', 'embellish'] as const) {
      const runs = SEEDS.map((seed) => playForBynames(seed, pen));
      for (const { ctx } of runs) {
        const pages = new Map(ctx.world.chronicle.filter((e) => e.id !== undefined).map((e) => [e.id!, e]));
        for (const person of ctx.world.people.all()) {
          const grant = person.byname;
          if (!grant) continue;
          const source = grant.source;
          expect(source.kind).toBe('record');
          expect(source.pen).toBe(pen);
          const page = pages.get(source.page);
          expect(page, `${person.id}'s byname cites a page the book does not have`).toBeDefined();
          expect(page!.record).toBe(pen);
          expect(page!.eventId).toBe(source.event);
          expect(page!.claims?.some((claim) => claim.person === person.id)).toBe(true);
          expect(person.epithet).toBeTruthy();
          if (pen === 'embellish') expect(source.discrepancy).toBe(page!.discrepancyId);
          else expect(source.discrepancy).toBeUndefined();
        }
      }
      const batches = runs.map((run) => run.batch);
      if (pen === 'omit') expect(total(batches, 'grants')).toBe(0);
      report.push(`${pen}: heads ${total(batches, 'headsNamed')}/${total(batches, 'heads')}, `
        + `other blood ${total(batches, 'relativesNamed')}/${total(batches, 'relatives')}, `
        + `grants ${total(batches, 'grants')}, contested ${total(batches, 'contested')}`);
      if (pen === 'omit') continue;
      expect(total(batches, 'grants'), `${pen} named nobody in ${SEEDS.length} Long Lines`).toBeGreaterThan(0);
      expectRate({
        hits: total(batches, 'relativesNamed'), n: total(batches, 'relatives'), ceiling: 0.1,
        what: `${pen}: blood relatives (not Heads) who earned a byname`,
      });
    }
    console.log(`bynames over ${SEEDS.length} × ${YEARS}-year Long Lines — ${report.join('; ')}`);
  });
});
