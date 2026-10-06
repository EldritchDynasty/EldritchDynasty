/**
 * LIBRARY OF HOUSES — THE INHERITED BOOK MAY CHANGE THE STORY, NOT THE HOUSE.
 * (issue #70)
 *
 * The feature's dangerous failure mode is a roguelite bonus wearing narrative
 * clothes. A remembered page is allowed to change what a later house BELIEVES;
 * it is not allowed to move money, standing, blood, land, the ladder, or the
 * ending distribution.
 *
 * This gate plays paired Short Lines on identical seeds, with and without one
 * fixed inherited house. Every headline quantity is compared as an ABSOLUTE
 * paired difference and judged through `expectMean`, as #70 requires. Today
 * the stronger invariant is exact identity, so healthy batches have zero
 * variance and zero mean difference. The tiny ceiling is deliberately not a
 * gameplay tolerance: it merely gives `expectMean` a strict "below" claim
 * while zero remains the only sensible result for these integer / deterministic
 * quantities.
 */
import { loadContent } from '@ed/content';
import {
  RESPECT_ORDER, RUNG_ORDER, type Content, type ContentBundle,
} from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { livingBlood } from '../ending.js';
import { heldParcels } from '../land.js';
import { libraryRunOf } from '../run-library.js';
import { newGame } from '../session.js';
import { expectMean } from '../testing.js';
import type { SimCtx } from '../world.js';
import { BLOCKING_GATE_CONFIG } from './gate-registry.js';

type Source = ContentBundle | Content;

const ZERO_CEILING = 0.001;

export interface LibraryNeutralityMetrics {
  treasury: number;
  respect: number;
  ascension: number;
  livingBlood: number;
  acreage: number;
  ending: string;
}

export interface LibraryNeutralityVerdict {
  ok: boolean;
  lines: string[];
}

function acreage(ctx: SimCtx): number {
  return heldParcels(ctx).reduce((sum, state) => {
    const def = state.defId ? ctx.content.parcel(state.defId) : undefined;
    return sum + (def?.acres ?? 0);
  }, 0);
}

function metrics(ctx: SimCtx): LibraryNeutralityMetrics {
  const w = ctx.world;
  return {
    treasury: w.treasury,
    respect: RESPECT_ORDER.indexOf(w.respect),
    ascension: RUNG_ORDER.indexOf(w.ascension.best),
    livingBlood: livingBlood(w),
    acreage: acreage(ctx),
    ending: w.ending?.id ?? 'none',
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/**
 * The statistical judgement is exported separately so a fast test can hand it
 * an intentionally non-neutral batch and prove the gate has teeth without
 * simulating centuries.
 */
export function libraryNeutralityVerdict(
  empty: readonly LibraryNeutralityMetrics[],
  seeded: readonly LibraryNeutralityMetrics[],
): LibraryNeutralityVerdict {
  if (empty.length !== seeded.length || empty.length < 2) {
    return {
      ok: false,
      lines: [
        `FAIL: neutrality needs equal paired batches of at least two runs; got ${empty.length} and ${seeded.length}`,
      ],
    };
  }

  const paired = <K extends Exclude<keyof LibraryNeutralityMetrics, 'ending'>>(key: K) =>
    empty.map((base, i) => Math.abs(base[key] - seeded[i]![key]));

  const claims: Array<{ label: string; values: number[] }> = [
    { label: 'treasury', values: paired('treasury') },
    { label: 'respect tier', values: paired('respect') },
    { label: 'ascension.best', values: paired('ascension') },
    { label: 'living blood', values: paired('livingBlood') },
    { label: 'acreage', values: paired('acreage') },
    {
      label: 'ending distribution',
      values: empty.map((base, i) => Number(base.ending !== seeded[i]!.ending)),
    },
  ];

  const lines: string[] = [];
  let ok = true;
  for (const claim of claims) {
    try {
      const margin = expectMean({
        values: claim.values,
        ceiling: ZERO_CEILING,
        what: `Library of Houses paired ${claim.label} difference`,
      });
      lines.push(
        `  ${claim.label}: mean |Δ| ${mean(claim.values).toFixed(3)} (${margin === Infinity ? 'exact' : `${margin.toFixed(1)} SE`})`,
      );
    } catch (error) {
      ok = false;
      lines.push(`  FAIL ${claim.label}: ${(error as Error).message}`);
    }
  }

  return { ok, lines };
}

function fixedLibraryRun(source: Source) {
  const config = BLOCKING_GATE_CONFIG['library-neutrality'];
  const old = newGame(source, { seed: config.fixedLibrarySeed, campaign: config.campaign, decider: config.decider });
  const person = old.ctx.world.people.household(old.ctx.world.playerHouse, old.year)[0]!;
  old.ctx.world.chronicle.push({
    id: 'library_gate_page',
    year: 1200,
    weight: 'paragraph',
    text: `${person.name} was entered in the book as untouched by the rite.`,
    named: true,
    record: 'embellish',
    claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 0 }],
  });
  old.ctx.world.ending = { id: 'forgotten', year: CAMPAIGNS[config.campaign].endYear };
  const run = libraryRunOf(old.ctx);
  if (!run) throw new Error('the fixed Library of Houses corpus produced no finished run');
  return run;
}

export function gateLibraryNeutrality(
  source: Source = loadContent(),
  opts: { seeds?: number[] } = {},
): LibraryNeutralityVerdict {
  const config = BLOCKING_GATE_CONFIG['library-neutrality'];
  const seeds = opts.seeds ?? [...config.seeds];
  const oldHouse = fixedLibraryRun(source);
  const empty: LibraryNeutralityMetrics[] = [];
  const seeded: LibraryNeutralityMetrics[] = [];
  const lines = [`gate (library-neutrality): ${seeds.length} paired Short Lines`];

  for (const seed of seeds) {
    const base = newGame(source, { seed, campaign: config.campaign, decider: config.decider, libraryRuns: [] });
    const withLibrary = newGame(source, {
      seed,
      campaign: config.campaign,
      decider: config.decider,
      libraryRuns: [oldHouse],
    });

    base.advance(config.advanceYears);
    withLibrary.advance(config.advanceYears);

    if (!withLibrary.ctx.world.libraryMemories.length) {
      return {
        ok: false,
        lines: [...lines, `  FAIL seed ${seed}: the fixed library imported no memory`],
      };
    }

    empty.push(metrics(base.ctx));
    seeded.push(metrics(withLibrary.ctx));
  }

  const verdict = libraryNeutralityVerdict(empty, seeded);
  return { ok: verdict.ok, lines: [...lines, ...verdict.lines] };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('library-gate.ts');
if (isMain) {
  const config = BLOCKING_GATE_CONFIG['library-neutrality'];
  const runs = Number(process.argv[2] ?? config.seeds.length);
  const seeds = runs <= config.seeds.length
    ? [...config.seeds].slice(0, runs)
    : Array.from({ length: runs }, (_, i) => config.seeds[0] + i * 101);
  const verdict = gateLibraryNeutrality(loadContent(), { seeds });
  for (const line of verdict.lines) console.log(line);
  process.exit(verdict.ok ? 0 : 1);
}
