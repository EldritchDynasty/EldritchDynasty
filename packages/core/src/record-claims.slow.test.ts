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

function playForBynames(seed: number, answer: RecordOption | 'automatic'): { ctx: ReturnType<typeof bootstrap>; batch: BynameBatch } {
  const ctx = bootstrap(bundle, seed, 1042);
  const rng = makeRng(seed * 31 + 1990);
  for (let i = 0; i < YEARS; i++) {
    const before = ctx.world.year;
    stepYear(ctx, false);
    let guard = 0;
    while (ctx.world.pendingDecisions.length) {
      if (guard++ > 500) throw new Error('decision queue did not drain');
      const decision = ctx.world.pendingDecisions[0]!;
      if (decision.kind === 'record' && answer !== 'automatic') resolveRecord(ctx, decision.id, answer);
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
    const writing: BynameBatch[] = [];
    for (const pen of ['omit', 'record', 'embellish'] as const) {
      const runs = SEEDS.map((seed) => playForBynames(seed, pen));
      for (const { ctx } of runs) {
        const pages = new Map(ctx.world.chronicle.filter((e) => e.id !== undefined).map((e) => [e.id!, e]));
        for (const person of ctx.world.people.all()) {
          const grant = person.byname;
          if (!grant) continue;
          const source = grant.source;
          if (source.kind === 'reign') {
            expect(source.to).toBe(grant.year);
            expect(source.from).toBeLessThan(source.to);
            expect(source.pages).toBeGreaterThanOrEqual(2);
            expect(bynameStanding(person)).toBe('reign');
            expect(person.epithet).toBeTruthy();
            continue;
          }
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
      // An Omit pen no longer prevents a name at a later reign handover:
      // those are names of the *book's omissions*, not Record claim grants.
      if (pen === 'omit') {
        for (const { ctx } of runs) {
          expect(ctx.world.people.all().every((p) => !p.byname || p.byname.source.kind === 'reign')).toBe(true);
        }
      }
      report.push(`${pen}: heads ${total(batches, 'headsNamed')}/${total(batches, 'heads')}, `
        + `other blood ${total(batches, 'relativesNamed')}/${total(batches, 'relatives')}, `
        + `grants ${total(batches, 'grants')}, contested ${total(batches, 'contested')}`);
      if (pen === 'omit') continue;
      writing.push(...batches);
      expect(total(batches, 'grants'), `${pen} named nobody in ${SEEDS.length} Long Lines`).toBeGreaterThan(0);
      expectRate({
        hits: total(batches, 'relativesNamed'), n: total(batches, 'relatives'), ceiling: 0.03,
        what: `${pen}: blood relatives (not Heads) who earned a byname`,
      });
    }
    // Pooled over both pens that write: a Head is the person the book most
    // often makes a claim about, so Heads clear a floor that other relatives
    // stay under (1 November 2026: 21/110 Heads against 9/1743 relatives).
    expectRate({
      hits: total(writing, 'headsNamed'), n: total(writing, 'heads'), floor: 0.04,
      what: 'Heads who earned a byname under a pen that writes one',
    });
    // The second source is granted by actual completed reigns, even when
    // every Record choice is Omit; no other relatives gain this source.
    const namedHeads = writing.reduce((n, run) => n + run.headsNamed, 0);
    expect(namedHeads).toBeGreaterThan(0);
    console.log(`bynames over ${SEEDS.length} × ${YEARS}-year Long Lines — ${report.join('; ')}`);
  });
});


/**
 * #2287: compare the new reign-ending source against a policy which never
 * writes a person-claim byname. Use the same seeds and game decisions for
 * both policies; only their Record pen choices differ.
 *
 * Report ALL Heads (including the founder and a still-serving final Head),
 * completed Heads (the only ones eligible for a reign-end grant), and other
 * blood relatives separately. These are played-game reach measurements,
 * NOT evidence that readers feel more attached to named people.
 */
const REIGN_REACH_SEEDS = Array.from({ length: 16 }, (_, k) => 1990 + 37 * k);

interface ReignReach {
  heads: number;
  headsNamed: number;
  completedHeads: number;
  completedNamed: number;
  recordHeads: number;
  reignHeads: number;
  otherBlood: number;
  otherNamed: number;
}

function reignReach(ctx: ReturnType<typeof bootstrap>): ReignReach {
  const w = ctx.world;
  const heads = new Set(w.succession.map((reign) => String(reign.person)));
  const completed = new Set(w.succession.filter((reign) => reign.to !== undefined)
    .map((reign) => String(reign.person)));
  const grants = [...heads].map((id) => w.people.get(id)?.byname);
  const blood = w.people.blood(w.playerHouse).filter((person) => !heads.has(String(person.id)));
  return {
    heads: heads.size,
    headsNamed: grants.filter((grant) => grant !== undefined).length,
    completedHeads: completed.size,
    completedNamed: [...completed].filter((id) => w.people.get(id)?.byname !== undefined).length,
    recordHeads: grants.filter((grant) => grant?.source.kind === 'record').length,
    reignHeads: grants.filter((grant) => grant?.source.kind === 'reign').length,
    otherBlood: blood.length,
    otherNamed: blood.filter((person) => person.byname !== undefined).length,
  };
}

function reachTotal(runs: readonly ReignReach[], key: keyof ReignReach): number {
  return runs.reduce((n, row) => n + row[key], 0);
}

/** Wilson 95% interval: no normal approximation to tiny non-Head incidence. */
function reachInterval(hits: number, n: number): string {
  if (!n) return 'not measured (n=0)';
  const z = 1.959963984540054;
  const p = hits / n;
  const d = 1 + z ** 2 / n;
  const centre = (p + z ** 2 / (2 * n)) / d;
  const half = z * Math.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2)) / d;
  return `${(p * 100).toFixed(1)}% [${((centre - half) * 100).toFixed(1)}, ${((centre + half) * 100).toFixed(1)}]`;
}

describe('second byname source: paired Long Line reach (#2287)', () => {
  it('measures ordinary chronicler against a paired always-Omit policy', () => {
    const ordinary: ReignReach[] = [];
    const omitted: ReignReach[] = [];

    for (const seed of REIGN_REACH_SEEDS) {
      const normal = playForBynames(seed, 'automatic');
      const allOmit = playForBynames(seed, 'omit');
      ordinary.push(reignReach(normal.ctx));
      omitted.push(reignReach(allOmit.ctx));

      // Omit creates no claim-bearing byname. The reign source can name a
      // completed Head for the house's omitted pages, but never a relative
      // who did not hold the seal.
      for (const person of allOmit.ctx.world.people.all()) {
        expect(person.byname?.source.kind).not.toBe('record');
      }
    }

    for (const [label, runs] of [['ordinary', ordinary], ['always-Omit', omitted]] as const) {
      const heads = reachTotal(runs, 'heads');
      const headsNamed = reachTotal(runs, 'headsNamed');
      const closed = reachTotal(runs, 'completedHeads');
      const closedNamed = reachTotal(runs, 'completedNamed');
      const relatives = reachTotal(runs, 'otherBlood');
      const relativesNamed = reachTotal(runs, 'otherNamed');
      expect(heads).toBeGreaterThan(0);
      expect(closed).toBeGreaterThan(0);
      expect(headsNamed).toBeGreaterThanOrEqual(reachTotal(runs, 'reignHeads'));
      expect(headsNamed).toBeGreaterThanOrEqual(reachTotal(runs, 'recordHeads'));
      console.log(
        `#2287 ${label}: Heads ${headsNamed}/${heads} = ${reachInterval(headsNamed, heads)}; `
        + `completed Heads ${closedNamed}/${closed} = ${reachInterval(closedNamed, closed)}; `
        + `source record=${reachTotal(runs, 'recordHeads')}, reign=${reachTotal(runs, 'reignHeads')}; `
        + `other blood ${relativesNamed}/${relatives} = ${reachInterval(relativesNamed, relatives)}`,
      );
    }
    expect(reachTotal(omitted, 'recordHeads')).toBe(0);
    expect(reachTotal(omitted, 'otherNamed')).toBe(0);
  });
});
