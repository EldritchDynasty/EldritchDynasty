import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { CAMPAIGN_YEARS } from '../campaign.js';
import { playGateBatch } from './gate-batch.js';
import { firedUnderClimbing } from './ladder-fires.js';

type Source = ContentBundle | Content;

export interface FireRateGateOptions {
  runs?: number;
  years?: number;
  floorPct?: number;
  climbRuns?: number;
}

export interface FireRateGateResult {
  ok: boolean;
  lines: string[];
}

/** How many deliberate ladder-playing runs an accused template gets. */
const CLIMB_ACQUIT_RUNS = 12;

/**
 * Gate 4, without the Node-only default content loader.
 *
 * This is the one judgement used by CI and by the packaged Mod Editor. A
 * caller may lower the sample size for an interactive diagnostic, but the
 * seeds, rate calculation, floor and ladder-only acquittal are identical.
 */
export function runFireRateGate(
  source: Source,
  opts: FireRateGateOptions = {},
): FireRateGateResult {
  const bundle = indexContent(source);
  const runs = opts.runs ?? 800;
  const years = opts.years ?? CAMPAIGN_YEARS;
  const floorPct = opts.floorPct ?? 0.5;

  const seenIn = playGateBatch(source, runs, years).templateRuns;

  const rates = bundle.events
    .filter((e) => e.tier !== 'frame')
    .map((e) => ({ id: String(e.id), pct: (100 * (seenIn.get(String(e.id)) ?? 0)) / runs }))
    .sort((a, b) => a.pct - b.pct);

  const suspect = rates.filter((r) => r.pct < floorPct);
  const lines = [`gate 4 (fire rate): ${runs} runs x ${years}y — rarest of ${rates.length} non-frame events:`];
  for (const r of rates.slice(0, 5)) lines.push(`    ${r.id.padEnd(34)} ${r.pct}%`);

  const failing: { id: string; pct: number }[] = [];
  const acquitted: string[] = [];
  if (suspect.length) {
    const climbRuns = opts.climbRuns ?? CLIMB_ACQUIT_RUNS;
    const climbSeeds = Array.from({ length: climbRuns }, (_, i) => 4000 + i * 13);
    const climbed = firedUnderClimbing(source, climbSeeds, years);
    for (const f of suspect) {
      if (climbed.has(f.id)) acquitted.push(f.id);
      else failing.push(f);
    }
  }

  if (acquitted.length) {
    lines.push(`  ${acquitted.length} reached only by a house that plays for the ladder, which counts as reachable:`);
    for (const id of acquitted) lines.push(`    ${id}`);
  }

  // Paid debts are removed. Keeping the empty ratchet makes the next owed
  // event a deliberate, named addition rather than a permissive exception.
  const OWED_FIRE_RATE: string[] = [];
  const newlyFailing = failing.filter((f) => !OWED_FIRE_RATE.includes(f.id));
  const owedStill = failing.filter((f) => OWED_FIRE_RATE.includes(f.id));
  const paidOff = OWED_FIRE_RATE.filter((id) => !failing.some((f) => f.id === id));

  if (owedStill.length) {
    lines.push(`  owed, and pinned (issue #61, Stage E4): ${owedStill.map((f) => f.id).join(', ')} — `
      + 'correctly gated on a cast the population cannot yet field');
  }
  if (newlyFailing.length) {
    lines.push(`  FAIL: ${newlyFailing.length} event(s) fire in under ${floorPct}% of runs, under the chronicler`);
    lines.push(`        AND in ${opts.climbRuns ?? CLIMB_ACQUIT_RUNS} runs played for the ladder:`);
    for (const f of newlyFailing) lines.push(`    ${f.id}: ${f.pct}%`);
  }
  if (paidOff.length) {
    lines.push(`  FAIL: ${paidOff.join(', ')} now clears the floor. Remove it from OWED_FIRE_RATE — `
      + 'a pin nobody prunes is a comment that lies about the game.');
  }
  return { ok: newlyFailing.length === 0 && paidOff.length === 0, lines };
}
