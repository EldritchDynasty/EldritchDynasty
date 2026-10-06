import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { bootstrap, runYears } from '../sim.js';
import { START_YEAR } from '../campaign.js';
import { emptyReach, readRun, type Reach } from '../events/reach.js';
import { GATE_BATCH_SEED_START, GATE_BATCH_SEED_STEP } from './gate-registry.js';

export type GateSource = ContentBundle | Content;

export interface GateBatch {
  runs: number;
  /** Runs in which each template fired at least once. */
  templateRuns: Map<string, number>;
  /** Runs in which each outcome resolved, and firings per choice. */
  reach: Reach;
}

/**
 * The shared simulation batch behind fire-rate and outcome-reach.
 *
 * Kept browser-safe so the Mod Editor can run the exact fire-rate judgement
 * CI uses without importing the Node-only content loader. The CLI gates still
 * share this cache, so extracting the function does not double their work.
 */
let lastBatch: { source: GateSource; runs: number; years: number; batch: GateBatch } | null = null;

export function playGateBatch(source: GateSource, runs: number, years: number): GateBatch {
  if (lastBatch
    && lastBatch.source === source
    && lastBatch.runs === runs
    && lastBatch.years === years) {
    return lastBatch.batch;
  }

  const content = indexContent(source);
  const batch: GateBatch = { runs, templateRuns: new Map(), reach: emptyReach() };
  for (let i = 0; i < runs; i++) {
    const ctx = bootstrap(content, GATE_BATCH_SEED_START + i * GATE_BATCH_SEED_STEP, START_YEAR);
    runYears(ctx, years);
    for (const [id, n] of Object.entries(ctx.world.frequency.templateFires)) {
      if (n > 0) batch.templateRuns.set(id, (batch.templateRuns.get(id) ?? 0) + 1);
    }
    readRun(ctx, batch.reach);
  }

  lastBatch = { source, runs, years, batch };
  return batch;
}
