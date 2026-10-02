import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { RunLibrary, SavedGame } from '@ed/schema';
import { newGame } from './session.js';
import { ACHIEVEMENT_IDS, earnedAchievements } from './achievements.js';
import { ACHIEVEMENT_RATE_JUDGEABLE_RUNS, achievementRates, renderAchievementRates, type AchievementSample } from './achievement-rates.js';

const content = loadContent();

function finished(): SavedGame {
  const save = newGame(content, { seed: 323, campaign: 'short', decider: 'chronicler' }).save();
  save.ending = { id: 'settled', year: 1342 };
  return save;
}

describe('achievements (issue #323)', () => {
  it('has one stable, duplicate-free catalogue of roughly thirty backend ids', () => {
    expect(ACHIEVEMENT_IDS).toHaveLength(30);
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
    for (const id of ACHIEVEMENT_IDS) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('does not award a live run, and Short Lines do earn finished-run achievements', () => {
    const live = finished();
    delete live.ending;
    expect(earnedAchievements(live)).toEqual([]);

    const short = finished();
    expect(earnedAchievements(short)).toContain('ending_settled');
  });

  it('reads the ladder and clause high-water marks without adding achievement state', () => {
    const save = finished();
    save.campaign = 'long';
    save.ending = { id: 'unmade', year: 1542 };
    save.ascension.best = 'demigod';
    save.ascension.reachedAt = { touched: 1100, adept: 1150, hierophant: 1200, vessel: 1300, demigod: 1400 };
    save.clausesRecovered = Array.from({ length: 7 }, (_, i) => `clause_${i + 1}`);

    expect(earnedAchievements(save)).toEqual(expect.arrayContaining([
      'ending_unmade',
      'ladder_touched',
      'ladder_adept',
      'ladder_hierophant',
      'ladder_vessel',
      'ladder_demigod',
      'clauses_3',
      'clauses_5',
      'clauses_7',
    ]));
    expect(earnedAchievements(save)).not.toContain('ladder_god');
    expect(earnedAchievements(save)).not.toContain('clauses_9');
    expect(save).not.toHaveProperty('achievements');
  });

  it('derives record extremes only after the house has actually answered a Record block', () => {
    const save = finished();
    expect(earnedAchievements(save)).not.toContain('record_never_embellished');

    save.decisionLog.push({
      kind: 'record', year: 1200, event: 'a_page', option: 'record',
    });
    expect(earnedAchievements(save)).toEqual(expect.arrayContaining([
      'record_never_embellished',
      'record_never_omitted',
      'record_all_truthful',
    ]));
    expect(earnedAchievements(save)).not.toContain('record_never_truthful');

    save.decisionLog.push({
      kind: 'record', year: 1201, event: 'another_page', option: 'embellish',
    });
    expect(earnedAchievements(save)).not.toContain('record_never_embellished');
    expect(earnedAchievements(save)).not.toContain('record_all_truthful');
  });

  it('reads regency, cadet, discrepancy, muster, Match and Five Names from persisted facts', () => {
    const save = finished();
    const woman = save.people[0]!;
    woman.sex = 'female';
    save.succession.push({ person: woman.id, name: woman.name, from: 1100, to: 1120 });
    (save.branches as Array<{ heldSeal?: number }>).push({ heldSeal: 1200 });
    save.discrepancies.push(['disc_1', { severity: 'major', provableBy: [], state: 'open' }]);
    save.muster.commitments.push({
      id: 'muster_1', began: 1210, age: 'wars', men: 12, from: { main: 12 },
      officers: [], position: 'standard', credit: 5, status: 'settled',
    });
    save.decisionLog.push({
      kind: 'match', year: 1220, subject: woman.id, card: null, spouse: 'outsider',
    });
    save.friends = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({
      name, sex: i % 2 ? 'female' : 'male', dueFrom: 1042 + i, spentIn: 1100 + i,
    }));

    expect(earnedAchievements(save)).toEqual(expect.arrayContaining([
      'regency_survived',
      'cadet_took_seal',
      'discrepancy_unproven_at_term',
      'muster_settled_under_banner',
      'match_never_refused',
      'five_names_returned',
    ]));
  });

  it('uses the existing Library of Houses for the cross-run all-endings achievement', () => {
    const save = finished();
    save.campaign = 'long';
    save.ending = { id: 'devoured', year: 1542 };
    const ids = ['apotheosis', 'unmade', 'broken_line', 'forgotten'] as const;
    const library: RunLibrary = {
      format: 1,
      runs: ids.map((id, i) => ({
        id: `run_${i}`, seed: i, campaign: 'long', endedYear: 1542,
        house: `House ${i}`, ending: { id, title: id }, entries: [],
      })),
    };

    expect(earnedAchievements(save, library)).toContain('ending_all_long');
  });
});


describe('achievement earn-rate report (#323)', () => {
  it('defaults to the first batch size that can represent the 1% rarity floor', () => {
    expect(ACHIEVEMENT_RATE_JUDGEABLE_RUNS).toBe(100);
  });

  const samples: AchievementSample[] = [
    { campaign: 'short', seed: 1, earned: ['ending_settled', 'ladder_touched', 'ladder_touched'] },
    { campaign: 'short', seed: 2, earned: ['ending_settled'] },
    { campaign: 'long', seed: 1, earned: ['ending_unmade', 'ladder_touched'] },
    { campaign: 'long', seed: 2, earned: ['ending_forgotten'] },
  ];

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

  it('labels smoke-sized samples as unjudgeable for the 1% rarity floor', () => {
    const text = renderAchievementRates(samples);
    expect(text).toContain('sample: Short 2 · Long 2');
    expect(text).toContain('NOT JUDGEABLE for the ~1% rarity floor');

    const judgeable: AchievementSample[] = [
      ...Array.from({ length: ACHIEVEMENT_RATE_JUDGEABLE_RUNS }, (_, i) => ({
        campaign: 'short' as const, seed: i, earned: [] as const,
      })),
      ...Array.from({ length: ACHIEVEMENT_RATE_JUDGEABLE_RUNS }, (_, i) => ({
        campaign: 'long' as const, seed: i, earned: [] as const,
      })),
    ];
    expect(renderAchievementRates(judgeable)).not.toContain('NOT JUDGEABLE');
  });
});
