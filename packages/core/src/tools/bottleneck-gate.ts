/**
 * IS THE FOUNDING BOTTLENECK'S RECOVERY POSSIBLE? (issue #132, Stage 2)
 *
 *   npm run gate:bottleneck -- [runs] [years]
 *   npm run gate:bottleneck -- 150 500
 *
 * Stage 1 recalibrated `thinBloodMortality`/`thinBloodFertility` so a
 * founding house's own first ordinary death stops spiraling into extinction
 * on its own — measured, `broken_line` fell from 33-39% of runs to roughly
 * half that. What it did not do, and never claimed to: give a thinned line
 * anything to do about it. Measured on the recalibrated code, before Stage 2
 * existed: **0 of 37 surviving runs, then 0 of 45, then 0 of 60** — three
 * re-measurements across this issue's own trail, each one naming a different
 * reason a line down to one or two could never climb back. `descentKind`
 * makes recovery from EXACTLY zero blood structurally impossible (the run
 * ends the year it happens, issue #42) — this gate is not about that. It is
 * about the runs that touch one or two and do not have to end there.
 *
 * ─── What Stage 2 built, and what actually blocked it three times over ────
 *
 * Two content events (`marriage.yaml`), cast on the crisis and gated on a
 * new `bloodCount` condition; a `marriage: end` effect and a `priorityMatch`
 * effect the player's choice can reach for. Three separate bugs sat between
 * "the mechanism exists" and "it does anything", found only by playing real
 * batches and tracing a seed at a time — none visible from the code alone:
 *
 *   1. `bloodCount` was not a recognised PRESSURE signal (`selection.ts`), so
 *      the crisis scene competed in the whole common-tier ambient pool
 *      instead of the small pool a real emergency draws from. Fired in 2 of
 *      14 windows where it was eligible and a candidate existed to cast.
 *   2. `matchSubjects` waived the marriageable age ceiling for a
 *      priority-flagged person; `takeCard` — the function that actually
 *      marries them — did not, and refused the very hand the priority exists
 *      to win. The same failure `eligibleToMarry`'s own comment already
 *      documents once: two files asking the same question and disagreeing.
 *   3. `sole_heir_spent` cast a CADET as readily as the seat's own blood,
 *      because `w.people.blood` answers a lineage question and the Match
 *      only ever deals hands to the main hall. A priority nothing downstream
 *      could act on — the house went to market for one for eleven years.
 *
 * Fixed, all three are needed together before recovery happens at all:
 * measured post-fix at 150 seeds, **3 of 46 runs that touched 1 or 2 living
 * blood reached the term anyway — 6.5%, non-zero, where it had been 0 of 60
 * across three separate measurements.** Full trail in `docs/BALANCE-LOG.md`.
 *
 * ─── Why this is a gate and not only a `.slow.test.ts` claim ──────────────
 *
 * `gates.ts`'s own rule: a gate nobody has seen fail is indistinguishable
 * from a gate that cannot fail. `verdictOver` is a pure function over played
 * runs, so `bottleneck-gate.test.ts` can hand it a batch that touched the
 * bottleneck forty times and recovered not once — the exact shape of every
 * measurement on this trail before the three bugs above were found.
 */
import { loadContent } from '@ed/content';
import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { bootstrap } from '../sim.js';
import { stepYear } from '../year/step.js';
import { livingBlood, END_YEAR } from '../ending.js';
import { START_YEAR } from '../campaign.js';
import { BLOCKING_GATE_CONFIG } from './gate-registry.js';

type Source = ContentBundle | Content;

export interface FoundingRun {
  seed: number;
  /** Living blood dropped to 1 or 2 at some point during the run. */
  touched2: boolean;
  /** `touched2`, AND the run still reached the term rather than breaking. */
  recovered: boolean;
}

export interface FoundingVerdict {
  ok: boolean;
  lines: string[];
}

/** One played run. `stepYear` itself halts at the term or at zero blood (issue #42). */
export function playFoundingCase(source: Source, seed: number, years: number): FoundingRun {
  const ctx = bootstrap(indexContent(source), seed, START_YEAR);
  const endYear = Math.min(END_YEAR, START_YEAR + years);
  let touched2 = false;
  while (ctx.world.year < endYear && !ctx.world.ending) {
    stepYear(ctx, true);
    const blood = livingBlood(ctx.world);
    if (blood > 0 && blood <= 2) touched2 = true;
  }
  return { seed, touched2, recovered: touched2 && livingBlood(ctx.world) > 0 };
}

/**
 * How many runs must have TOUCHED the bottleneck before a zero recovery
 * count means anything. Measured at 6.5% (3 of 46, see the header), a batch
 * of 30 touching runs still has a 15% chance of seeing zero by pure chance —
 * `0.935^30`. 40 brings that under 9%, which is where `gateEndings`'s own
 * `JUDGEABLE_BATCH` sits relative to its rarest asserted floor.
 */
const JUDGEABLE_TOUCHED2 = 40;

export function verdictOver(runs: FoundingRun[]): FoundingVerdict {
  const touched = runs.filter((r) => r.touched2);
  const recovered = touched.filter((r) => r.recovered);
  const lines = [
    `gate (founding recovery): ${runs.length} played runs`
    + ` · ${touched.length} touched 1-2 living blood`
    + ` · ${recovered.length} recovered`,
  ];

  if (touched.length < JUDGEABLE_TOUCHED2) {
    lines.push(
      `  (${touched.length} runs touching the bottleneck cannot see whether recovery is`
      + ' reachable; nothing asserted but validity)',
    );
    return { ok: true, lines };
  }

  if (recovered.length === 0) {
    lines.push(
      `  FAIL: 0 of ${touched.length} runs that touched 1 or 2 living blood ever recovered —`
      + ' the founding bottleneck (issue #132) has no working path back, which is the exact'
      + ' shape of the bug three separate fixes closed',
    );
    return { ok: false, lines };
  }

  lines.push(
    `  recovery rate ${(100 * recovered.length / touched.length).toFixed(1)}% — non-zero,`
    + ' which is the whole claim (issue #132\'s acceptance; not a target rate)',
  );
  return { ok: true, lines };
}

/**
 * CI's own call, through the `GATES` registry (`tools/gates.ts`) — cheap on
 * purpose, the same trade `gateEndings` makes at its own default of 24: too
 * few touched-the-bottleneck runs to judge, so it reports validity only. The
 * real current-term measurement is `npm run gate:bottleneck -- 150 500`.
 */
export function gateFoundingRecovery(
  source: Source = loadContent(),
  runs: number = BLOCKING_GATE_CONFIG.bottleneck.runs,
  years: number = BLOCKING_GATE_CONFIG.bottleneck.years,
): FoundingVerdict {
  const out: FoundingRun[] = [];
  const config = BLOCKING_GATE_CONFIG.bottleneck;
  for (let i = 0; i < runs; i++) out.push(playFoundingCase(source, config.seedStart + i * config.seedStep, years));
  return verdictOver(out);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('bottleneck-gate.ts');
if (isMain) {
  const config = BLOCKING_GATE_CONFIG.bottleneck;
  const runs = Number(process.argv[2]) || config.runs;
  const years = Number(process.argv[3]) || config.years;
  const v = gateFoundingRecovery(loadContent(), runs, years);
  for (const l of v.lines) console.log(l);
  process.exit(v.ok ? 0 : 1);
}
