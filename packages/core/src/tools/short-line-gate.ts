/**
 * A SHORT LINE — acceptance instrument for issue #66.
 *
 * This is deliberately separate from the Long-Line ending gate. Short omits
 * Apotheosis by product definition and has its own acceptance: over a
 * judgeable batch (>=100 runs), every promised ending must occur and no single
 * ending may exceed 40%.
 *
 * The registered default is 100 runs so CI enforces the distribution claim,
 * rather than merely proving that every run ended in a valid Short outcome.
 */
import { loadContent } from '@ed/content';
import { indexContent, type Content, type ContentBundle, type EndingId } from '@ed/schema';
import { campaignDef } from '../campaign.js';
import { playToTheEnd, type EndingRun } from './ending-gate.js';
import { BLOCKING_GATE_CONFIG } from './gate-registry.js';

type Source = ContentBundle | Content;

export const SHORT_ENDINGS: readonly EndingId[] = campaignDef('short').endings;

const JUDGEABLE_BATCH = 100;
const MAX_ENDING_SHARE = 0.40;

export interface ShortLineVerdict {
  ok: boolean;
  lines: string[];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function shortLineVerdictOver(
  runs: EndingRun[],
  clausesTotal?: number,
  authoredEvents: readonly string[] = [],
): ShortLineVerdict {
  const lines: string[] = [];
  const n = runs.length;
  const count = (id: EndingId) => runs.filter((r) => r.ending === id).length;

  for (const id of SHORT_ENDINGS) {
    const c = count(id);
    lines.push(`  ${id.padEnd(12)} ${String(c).padStart(4)}  ${n ? (100 * c / n).toFixed(1) : '0.0'}%`);
  }

  const apo = count('apotheosis');
  const invalid = runs.filter((r) => !SHORT_ENDINGS.includes(r.ending));
  const clauseCounts = runs.map((r) => r.clauses);
  const clauseMean = n ? clauseCounts.reduce((sum, value) => sum + value, 0) / n : 0;
  const clauseMin = n ? Math.min(...clauseCounts) : 0;
  const clauseMax = n ? Math.max(...clauseCounts) : 0;
  const completed = clausesTotal === undefined ? undefined : clauseCounts.filter((value) => value >= clausesTotal).length;
  lines.push(
    `  --- ${n} Short-Line runs · clauses mean ${clauseMean.toFixed(2)} · range ${clauseMin}-${clauseMax}`
    + (completed === undefined ? '' : ` · complete ${completed}/${n}`)
    + ` · apotheosis ${apo}`,
  );

  lines.push(
    `  shape: generations mean ${mean(runs.map((r) => r.generations ?? 0)).toFixed(1)}`
    + ` · Ages mean ${mean(runs.map((r) => r.agesEnded ?? 0)).toFixed(1)}`,
  );

  // #66: when the distribution moves, report which proof state moved it.
  // This is deliberately derived from the played runs rather than a second
  // ending table, so the diagnostic follows the selector instead of drifting.
  for (const id of SHORT_ENDINGS) {
    const proof = new Map<string, number>();
    for (const run of runs.filter((candidate) => candidate.ending === id)) {
      const rung = run.substantiated ?? run.attested;
      const withheld = run.rungsWithheld ?? 0;
      const key = withheld > 0 ? `${rung}(-${withheld})` : rung;
      proof.set(key, (proof.get(key) ?? 0) + 1);
    }
    if (proof.size) {
      const detail = [...proof.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key} ${value}`)
        .join(' · ');
      lines.push(`  proof ${id}: ${detail}`);
    }
  }

  const arcsStarted = runs.reduce((sum, r) => sum + (r.arcsStarted ?? 0), 0);
  const arcsEnded = runs.reduce((sum, r) => sum + (r.arcsEnded ?? 0), 0);
  const arcsExpired = runs.reduce((sum, r) => sum + (r.arcsExpired ?? 0), 0);
  const arcsCancelled = runs.reduce((sum, r) => sum + (r.arcsCancelled ?? 0), 0);
  const arcsActive = runs.reduce((sum, r) => sum + (r.arcsActive ?? 0), 0);
  lines.push(
    `  arcs: started ${arcsStarted} · ended ${arcsEnded} · expired ${arcsExpired}`
    + ` · cancelled ${arcsCancelled} · active at term ${arcsActive}`,
  );

  if (authoredEvents.length) {
    const seen = new Set<string>();
    for (const run of runs) {
      for (const [id, count] of Object.entries(run.templateFires ?? {})) {
        if (count > 0) seen.add(id);
      }
    }
    const never = authoredEvents.filter((id) => !seen.has(id));
    lines.push(`  content reach: ${authoredEvents.length - never.length}/${authoredEvents.length} non-frame templates seen in batch`);
    if (never.length) lines.push(`  never seen: ${never.join(', ')}`);
  }

  if (invalid.length) {
    lines.push(`  FAIL: ${invalid.length} run(s) produced an ending outside the Short-Line promise`);
    return { ok: false, lines };
  }

  if (n < JUDGEABLE_BATCH) {
    lines.push(`  (${n} runs cannot judge the 40% distribution ceiling; validity only)`);
    return { ok: true, lines };
  }

  const failures: string[] = [];
  for (const id of SHORT_ENDINGS) {
    const c = count(id);
    if (c === 0) failures.push(`  FAIL: ${id} did not occur in ${n} Short-Line runs`);
    const share = c / n;
    if (share > MAX_ENDING_SHARE) {
      failures.push(`  FAIL: ${id} dominates Short Line at ${(100 * share).toFixed(1)}% (ceiling 40%)`);
    }
  }

  lines.push(...failures);
  return { ok: failures.length === 0, lines };
}

export function gateShortLine(
  source: Source = loadContent(),
  runs = BLOCKING_GATE_CONFIG['short-line'].runs,
): ShortLineVerdict {
  const config = BLOCKING_GATE_CONFIG['short-line'];
  const content = indexContent(source);
  const def = campaignDef(config.campaign);
  const played = Array.from({ length: runs }, (_, i) =>
    playToTheEnd(
      content,
      config.seedStart + i * config.seedStep,
      config.years,
      config.decider,
      config.campaign,
    ));

  const authoredEvents = content.events.filter((event) => event.tier !== 'frame').map((event) => String(event.id));
  const verdict = shortLineVerdictOver(played, def.clauses, authoredEvents);
  return {
    ok: verdict.ok,
    lines: [`gate (short-line): ${runs} played runs x ${def.years} years`, ...verdict.lines],
  };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('short-line-gate.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? BLOCKING_GATE_CONFIG['short-line'].runs);
  const verdict = gateShortLine(loadContent(), runs);
  for (const line of verdict.lines) console.log(line);
  process.exit(verdict.ok ? 0 : 1);
}
