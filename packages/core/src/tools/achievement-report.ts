/**
 * ACHIEVEMENT EARN-RATE REPORT (issue #323).
 *
 * Titles and store rarity should be chosen from played evidence, not guesses.
 * This instrument plays the shipped chronicler policy at both campaign terms
 * and prints every stable backend id in catalogue order.
 *
 * `ending_all_long` is deliberately marked as Library-scoped instead of
 * reported as 0%: an isolated run cannot satisfy a cross-run condition.
 */
import { loadContent } from '@ed/content';
import type { CampaignId, Content } from '@ed/schema';
import { ACHIEVEMENT_IDS, earnedAchievements, type AchievementId } from '../achievements.js';
import { campaignDef } from '../campaign.js';
import { autoResolveAll } from '../events/decisions.js';
import { closeTheLedger } from '../ending.js';
import { makeRng, hashSeed } from '../rng.js';
import { saveGame } from '../save.js';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';

const SHIPPED_CAMPAIGNS = ['short', 'long'] as const satisfies readonly CampaignId[];
const LIBRARY_SCOPED = new Set<AchievementId>(['ending_all_long']);

export interface AchievementSample {
  campaign: 'short' | 'long';
  seed: number;
  earned: readonly AchievementId[];
}

export interface AchievementRate {
  earned: number;
  runs: number;
  pct: number;
}

export interface AchievementRateRow {
  id: AchievementId;
  scope: 'run' | 'library';
  short: AchievementRate | null;
  long: AchievementRate | null;
}

function rate(samples: readonly AchievementSample[], campaign: 'short' | 'long', id: AchievementId): AchievementRate {
  const runs = samples.filter((sample) => sample.campaign === campaign);
  const earned = runs.filter((sample) => new Set(sample.earned).has(id)).length;
  return {
    earned,
    runs: runs.length,
    pct: runs.length ? (100 * earned) / runs.length : 0,
  };
}

/** Pure summary, kept separate so the fast test never plays a campaign. */
export function achievementRates(samples: readonly AchievementSample[]): AchievementRateRow[] {
  return ACHIEVEMENT_IDS.map((id) => {
    if (LIBRARY_SCOPED.has(id)) {
      return { id, scope: 'library', short: null, long: null };
    }
    return {
      id,
      scope: 'run',
      short: rate(samples, 'short', id),
      long: rate(samples, 'long', id),
    };
  });
}

function cell(value: AchievementRate | null): string {
  if (!value) return 'Library';
  return `${String(value.earned).padStart(3)}/${String(value.runs).padEnd(3)} ${value.pct.toFixed(1).padStart(5)}%`;
}

export function renderAchievementRates(samples: readonly AchievementSample[]): string {
  const rows = achievementRates(samples);
  const out = [
    'ACHIEVEMENT EARN RATES (#323) — chronicler policy, isolated finished runs',
    '  id                              Short             Long',
  ];
  for (const row of rows) {
    out.push(`  ${row.id.padEnd(31)} ${cell(row.short).padEnd(17)} ${cell(row.long)}`);
  }
  out.push('');
  out.push('  Library = cross-run condition; measure from the installation Library, not isolated runs.');
  return out.join('\n') + '\n';
}

/**
 * Play exactly the same chronicler shape used by the ending gate: year step,
 * deterministic auto-resolution, naming queue cleared, then the canonical
 * Ledger close at term.
 */
export function playAchievementRun(content: Content, seed: number, campaign: 'short' | 'long'): AchievementSample {
  const def = campaignDef(campaign);
  const ctx = bootstrap(content, seed, def.startYear, campaign);
  const w = ctx.world;

  for (let i = 0; i < def.years; i++) {
    if (w.year >= def.endYear || w.ending) break;
    stepYear(ctx, false);

    let guard = 0;
    while (w.pendingDecisions.length && guard++ < 200) {
      autoResolveAll(ctx, makeRng(hashSeed(seed, 'achievement-rate', w.year, guard)));
    }
    if (w.pendingDecisions.length) {
      throw new Error(`achievement report could not resolve the docket for seed ${seed} in ${w.year}`);
    }
    clearNamingQueue(ctx);
  }

  if (w.year >= def.endYear || w.ending) closeTheLedger(ctx);
  const save = saveGame(ctx);
  if (!save.ending) {
    throw new Error(`achievement report ended seed ${seed} without an ending`);
  }

  return {
    campaign,
    seed,
    earned: earnedAchievements(save),
  };
}

export function measureAchievementRates(content: Content = loadContent(), runs = 24, seedBase = 32300): AchievementSample[] {
  if (!Number.isInteger(runs) || runs <= 0) throw new Error('runs must be a positive integer');

  const samples: AchievementSample[] = [];
  for (const campaign of SHIPPED_CAMPAIGNS) {
    for (let i = 0; i < runs; i++) {
      samples.push(playAchievementRun(content, seedBase + i, campaign));
    }
  }
  return samples;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('achievement-report.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? 24);
  process.stdout.write(renderAchievementRates(measureAchievementRates(loadContent(), runs)));
}
