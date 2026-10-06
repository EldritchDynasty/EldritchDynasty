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

export const ACHIEVEMENT_POLICIES = ['chronicler', 'ascendant'] as const;
export type AchievementPolicy = typeof ACHIEVEMENT_POLICIES[number];

const LIBRARY_SCOPED = new Set<AchievementId>(['ending_all_long']);

export interface AchievementSample {
  campaign: 'short' | 'long';
  policy: AchievementPolicy;
  seed: number;
  earned: readonly AchievementId[];
}

export interface AchievementRate {
  earned: number;
  runs: number;
  pct: number;
}

export interface AchievementPolicyRates {
  chronicler: AchievementRate;
  ascendant: AchievementRate;
}

export interface AchievementRateRow {
  id: AchievementId;
  scope: 'run' | 'library';
  short: AchievementPolicyRates | null;
  long: AchievementPolicyRates | null;
}

function rate(
  samples: readonly AchievementSample[],
  campaign: 'short' | 'long',
  policy: AchievementPolicy,
  id: AchievementId,
): AchievementRate {
  const runs = samples.filter((sample) => sample.campaign === campaign && sample.policy === policy);
  const earned = runs.filter((sample) => new Set(sample.earned).has(id)).length;
  return {
    earned,
    runs: runs.length,
    pct: runs.length ? (100 * earned) / runs.length : 0,
  };
}

function campaignRates(
  samples: readonly AchievementSample[],
  campaign: 'short' | 'long',
  id: AchievementId,
): AchievementPolicyRates {
  return {
    chronicler: rate(samples, campaign, 'chronicler', id),
    ascendant: rate(samples, campaign, 'ascendant', id),
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
      short: campaignRates(samples, 'short', id),
      long: campaignRates(samples, 'long', id),
    };
  });
}

function cell(value: AchievementRate | null): string {
  if (!value) return 'Library';
  return `${String(value.earned).padStart(3)}/${String(value.runs).padEnd(3)} ${value.pct.toFixed(1).padStart(5)}%`;
}

function sampleCount(
  samples: readonly AchievementSample[],
  campaign: 'short' | 'long',
  policy: AchievementPolicy,
): number {
  return samples.filter((sample) => sample.campaign === campaign && sample.policy === policy).length;
}

export function renderAchievementRates(samples: readonly AchievementSample[]): string {
  const rows = achievementRates(samples);
  const counts = {
    shortChronicler: sampleCount(samples, 'short', 'chronicler'),
    shortAscendant: sampleCount(samples, 'short', 'ascendant'),
    longChronicler: sampleCount(samples, 'long', 'chronicler'),
    longAscendant: sampleCount(samples, 'long', 'ascendant'),
  };
  const judgeable = Object.values(counts).every((runs) => runs >= ACHIEVEMENT_RATE_JUDGEABLE_RUNS);
  const out = [
    'ACHIEVEMENT EARN RATES (#323) — shipped chronicler vs canonical ascendant policy',
    `  sample: Short chronicler ${counts.shortChronicler} · ascendant ${counts.shortAscendant} · Long chronicler ${counts.longChronicler} · ascendant ${counts.longAscendant}`,
    ...(judgeable ? [] : [
      `  NOT JUDGEABLE for the ~1% rarity floor — use at least ${ACHIEVEMENT_RATE_JUDGEABLE_RUNS} runs per campaign and policy.`,
    ]),
    '  id                              Short chronicler   Short ascendant    Long chronicler    Long ascendant',
  ];
  for (const row of rows) {
    if (!row.short || !row.long) {
      out.push(`  ${row.id.padEnd(31)} ${'Library'.padEnd(18)} ${'Library'.padEnd(18)} ${'Library'.padEnd(18)} Library`);
      continue;
    }
    out.push(
      `  ${row.id.padEnd(31)} ${cell(row.short.chronicler).padEnd(18)} ${cell(row.short.ascendant).padEnd(18)} ${cell(row.long.chronicler).padEnd(18)} ${cell(row.long.ascendant)}`,
    );
  }
  out.push('');
  out.push('  Library = cross-run condition; measure from the installation Library, not isolated runs.');
  return out.join('\n') + '\n';
}
