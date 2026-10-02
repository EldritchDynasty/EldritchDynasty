/**
 * Pure aggregation for #323's achievement earn-rate report.
 *
 * Kept outside tools/ so fast tests can prove the reporting contract without
 * importing a module that also plays campaign batches.
 */
import { ACHIEVEMENT_IDS, type AchievementId } from './achievements.js';

/**
 * #323's acceptance has a ~1% rarity floor. As ending-gate.ts documents for
 * the same statistical question, fewer than 100 runs cannot even represent a
 * one-per-cent event as one observed run. Keep the report's default at the
 * first judgeable batch; callers can always request a larger sample.
 */
export const ACHIEVEMENT_RATE_JUDGEABLE_RUNS = 100;

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
