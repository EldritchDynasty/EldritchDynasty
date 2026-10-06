import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { CAMPAIGN_YEARS } from '../campaign.js';
import { declaredOutcomes } from '../events/reach.js';
import { playGateBatch } from './gate-batch.js';
import { scopedOutcomeReachVerdict } from './outcome-reach-verdict.js';

type Source = ContentBundle | Content;

interface OutcomeWitnessManifest {
  version: 1;
  outcomes: string[];
}

const MANIFEST_URL = new URL('../../../../tools/outcome-witnesses.json', import.meta.url);

function readOutcomeWitnessManifest(): OutcomeWitnessManifest {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('version' in parsed)
    || parsed.version !== 1
    || !('outcomes' in parsed)
    || !Array.isArray(parsed.outcomes)
    || !parsed.outcomes.every((key) => typeof key === 'string')
  ) {
    throw new Error('tools/outcome-witnesses.json is not a version-1 outcome witness manifest');
  }
  return parsed as OutcomeWitnessManifest;
}

/**
 * MERGE-BLOCKING OUTCOME REACH, SCOPED TO WHAT DETERMINISTIC WITNESSES DO NOT
 * YET PROVE (#502).
 *
 * The weekly gate keeps the full all-outcome distribution report. Merge CI has
 * a different job: catch an authored branch that has no deterministic witness
 * and also cannot be seen in the canonical played sample. A deterministically
 * witnessed outcome can miss a finite sample without making the build red;
 * every other declared outcome remains sampled until #442 grows the manifest.
 *
 * The manifest is generated from real executeOutcomeWitness successes in
 * reach.test.ts. Loading it here, rather than copying its keys into code, makes
 * new authored outcomes fail safe: absent a generated witness, they land in
 * the blocking set automatically.
 */
export function gateUnwitnessedOutcomeReach(
  source: Source = loadContent(),
  opts: { runs?: number; years?: number } = {},
): { ok: boolean; lines: string[] } {
  const runs = opts.runs ?? 800;
  const years = opts.years ?? CAMPAIGN_YEARS;
  const manifest = readOutcomeWitnessManifest();
  const declared = declaredOutcomes(indexContent(source));
  const reach = playGateBatch(source, runs, years).reach;
  const verdict = scopedOutcomeReachVerdict(
    declared,
    reach,
    new Set(manifest.outcomes),
    runs,
  );

  return {
    ok: verdict.ok,
    lines: [
      `merge outcome reach: ${runs} runs x ${years}y — deterministic witnesses remove sampled false reds only`,
      ...verdict.lines,
    ],
  };
}
