import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_IDS } from '../achievements.js';
import { achievementRates, renderAchievementRates, type AchievementSample } from './achievement-report.js';

const samples: AchievementSample[] = [
  { campaign: 'short', seed: 1, earned: ['ending_settled', 'ladder_touched', 'ladder_touched'] },
  { campaign: 'short', seed: 2, earned: ['ending_settled'] },
  { campaign: 'long', seed: 1, earned: ['ending_unmade', 'ladder_touched'] },
  { campaign: 'long', seed: 2, earned: ['ending_forgotten'] },
];

describe('achievement earn-rate report (#323)', () => {
  it('prints every stable id in catalogue order and counts at most once per run', () => {
    const rows = achievementRates(samples);
    expect(rows.map((row) => row.id)).toEqual([...ACHIEVEMENT_IDS]);

    expect(rows.find((row) => row.id === 'ending_settled')).toMatchObject({
      scope: 'run',
      short: { earned: 2, runs: 2, pct: 100 },
      long: { earned: 0, runs: 2, pct: 0 },
    });
    expect(rows.find((row) => row.id === 'ladder_touched')).toMatchObject({
      short: { earned: 1, runs: 2, pct: 50 },
      long: { earned: 1, runs: 2, pct: 50 },
    });
  });

  it('does not misreport the cross-run Library achievement as an isolated-run zero', () => {
    expect(achievementRates(samples).find((row) => row.id === 'ending_all_long')).toEqual({
      id: 'ending_all_long',
      scope: 'library',
      short: null,
      long: null,
    });

    const text = renderAchievementRates(samples);
    expect(text).toContain('ending_all_long');
    expect(text).toContain('Library = cross-run condition');
  });
});
