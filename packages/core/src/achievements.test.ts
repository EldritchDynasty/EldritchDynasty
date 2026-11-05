import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bearingWordsIn, proseOriginalHash, type RunLibrary, type SavedGame } from '@ed/schema';
import { newGame, resumeGame } from './session.js';
import { coreMessageAddress } from './messages.js';
import { ACHIEVEMENT_CATALOG, ACHIEVEMENT_IDS, achievementView, earnedAchievements } from './achievements.js';
import { ACHIEVEMENT_RATE_JUDGEABLE_RUNS, achievementRates, renderAchievementRates, type AchievementSample } from './achievement-rates.js';

const content = loadContent();

function finished(): SavedGame {
  const save = newGame(content, { seed: 323, campaign: 'short', decider: 'chronicler' }).save();
  save.ending = { id: 'settled', year: 1342 };
  return save;
}

describe('achievements (issue #323)', () => {
  it('renders all 60 shipped catalogue counterparts through the reader path (#1779)', () => {
    const original = newGame(content, { seed: 1779 });
    const plain = newGame(content, { seed: 1779, proseMode: 'plainenglish' });
    const variants = new Map(content.proseVariants.map((variant) => [variant.address, variant]));
    for (const id of ACHIEVEMENT_IDS) {
      const originalView = achievementView(original.ctx, id);
      const plainView = achievementView(plain.ctx, id);
      expect(originalView.id).toBe(id);
      expect(plainView.id).toBe(id);
      for (const field of ['title', 'description'] as const) {
        const counterpart = variants.get(coreMessageAddress(`achievement.${id}.${field}`));
        expect(counterpart, `${id}.${field}`).toBeDefined();
        expect(originalView[field]).toBe(ACHIEVEMENT_CATALOG[id][field]);
        expect(plainView[field]).toBe(counterpart!.plainenglish);
        expect(plainView[field]).not.toBe(originalView[field]);
      }
    }
    expect([...plain.ctx.prose.missing]).toEqual([]);
  });

  it('reads earned achievement copy in the selected mode without changing saved facts (#1779)', () => {
    expect(newGame(content, { seed: 1779 }).achievements()).toEqual([]);
    const saved = finished();
    const inputSnapshot = structuredClone(saved);
    const original = ACHIEVEMENT_CATALOG.ending_settled;
    const game = resumeGame(saved, content, { proseVariants: [
      { address: coreMessageAddress('achievement.ending_settled.title'), of: proseOriginalHash(original.title), plainenglish: 'Debt Settled' },
      { address: coreMessageAddress('achievement.ending_settled.description'), of: proseOriginalHash(original.description), plainenglish: 'Finish with the Settled ending.' },
    ] });
    const { savedAt: _beforeTime, ...before } = game.save();
    const originalCopy = game.achievements();
    expect(originalCopy).toContainEqual({ id: 'ending_settled', title: original.title, description: original.description });
    game.setProseMode('plainenglish');
    expect(game.achievements()).toContainEqual({ id: 'ending_settled', title: 'Debt Settled', description: 'Finish with the Settled ending.' });
    expect(game.achievements().map((entry) => entry.id)).toEqual(earnedAchievements(saved));
    game.setProseMode('original');
    expect(game.achievements()).toEqual(originalCopy);
    const { savedAt: _afterTime, ...after } = game.save();
    expect(after).toEqual(before);
    expect(saved).toEqual(inputSnapshot);
  });

  it.each(['missing', 'stale', 'invalid tokens'] as const)('falls back safely for %s achievement copy (#1779)', (kind) => {
    const original = ACHIEVEMENT_CATALOG.ending_settled;
    const game = resumeGame(finished(), content, {
      proseMode: 'plainenglish',
      proseVariants: kind === 'missing' ? [] : [{
        address: coreMessageAddress('achievement.ending_settled.description'),
        of: proseOriginalHash(kind === 'stale' ? 'Old achievement requirement.' : original.description),
        plainenglish: kind === 'invalid tokens' ? 'Finish with {UNKNOWN}.' : 'Finish with an outdated requirement.',
      }],
    });
    expect(game.achievements()).toContainEqual({ id: 'ending_settled', title: original.title, description: original.description });
    expect(game.ctx.prose.missing.has(coreMessageAddress('achievement.ending_settled.description'))).toBe(true);
  });

  it('has one stable, duplicate-free catalogue of roughly thirty backend ids', () => {
    expect(ACHIEVEMENT_IDS).toHaveLength(30);
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
    for (const id of ACHIEVEMENT_IDS) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('freezes unique plain-register v1 copy and measured band exceptions for every backend id', () => {
    expect(Object.keys(ACHIEVEMENT_CATALOG)).toEqual([...ACHIEVEMENT_IDS]);

    const titles = ACHIEVEMENT_IDS.map((id) => ACHIEVEMENT_CATALOG[id].title);
    expect(new Set(titles).size).toBe(titles.length);

    for (const id of ACHIEVEMENT_IDS) {
      const entry = ACHIEVEMENT_CATALOG[id];
      expect(entry.title.trim()).toBe(entry.title);
      expect(entry.description.trim()).toBe(entry.description);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(bearingWordsIn(`${entry.title} ${entry.description}`)).toEqual([]);
    }

    expect(
      ACHIEVEMENT_IDS.filter((id) => 'calibration' in ACHIEVEMENT_CATALOG[id]),
    ).toEqual([
      'ending_apotheosis',
      'ladder_touched',
      'ladder_god',
      'cadet_took_seal',
      'match_never_refused',
      'five_names_returned',
    ]);
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

  it('does not use decisions dated after the run ends to award or revoke achievements (#2695)', () => {
    const save = finished();
    const endingYear = save.ending!.year;
    const subject = save.people[0]!.id;
    save.decisionLog.push(
      { kind: 'record', year: endingYear + 1, event: 'a_future_record', option: 'record' },
      { kind: 'match', year: endingYear + 1, subject, card: null, spouse: 'outsider' },
    );

    const futureOnly = earnedAchievements(save);
    expect(futureOnly.filter((id) => id.startsWith('record_'))).toEqual([]);
    expect(futureOnly).not.toContain('match_never_refused');

    // Same-year decisions are real, and a contradictory future Record does not
    // invalidate the completed run's actually truthful pages.
    save.decisionLog.push(
      { kind: 'record', year: endingYear, event: 'the_final_record', option: 'record' },
      { kind: 'record', year: endingYear + 2, event: 'a_future_omission', option: 'omit' },
    );
    expect(earnedAchievements(save)).toContain('record_all_truthful');
    expect(earnedAchievements(save)).toContain('record_never_omitted');

    save.decisionLog.push({ kind: 'match', year: endingYear, subject, card: null, spouse: 'outsider' });
    expect(earnedAchievements(save)).toContain('match_never_refused');
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

  it('recognizes regency and cadet seal dates only through the actual term (#2939)', () => {
    const save = finished();
    const term = save.ending!.year;
    const woman = save.people[0]!;
    woman.sex = 'female';
    save.succession.push({
      person: woman.id, name: woman.name, from: term + 1, to: term + 2,
    });
    // Use the same minimal recovered-branch fixture as the persisted-facts test.
    (save.branches as Array<{ heldSeal?: number }>).push({ heldSeal: term + 1 });

    const before = structuredClone(save);
    const future = earnedAchievements(save);
    expect(future).not.toContain('regency_survived');
    expect(future).not.toContain('cadet_took_seal');
    expect(save).toEqual(before);

    // Same-year evidence is real, and a regency is only survived if it ended.
    const reign = save.succession.at(-1)!;
    reign.from = term - 1;
    reign.to = term;
    save.branches.at(-1)!.heldSeal = term;
    const atTerm = earnedAchievements(save);
    expect(atTerm).toContain('regency_survived');
    expect(atTerm).toContain('cadet_took_seal');

    // An imported inverted tenure must not award a completed regency.
    reign.from = term;
    reign.to = term - 1;
    expect(earnedAchievements(save)).not.toContain('regency_survived');
    expect(earnedAchievements(save)).toContain('cadet_took_seal');
  });

  it('ignores not-yet-begun Musters when awarding settled and withdrawn achievements (#2940)', () => {
    const save = finished();
    const term = save.ending!.year;
    save.muster.commitments.push({
      id: 'future_muster', began: term + 1, age: 'wars', men: 12, from: { main: 12 },
      officers: [], position: 'standard', credit: 5, status: 'settled',
    });
    expect(earnedAchievements(save)).not.toContain('muster_settled_under_banner');
    expect(earnedAchievements(save)).not.toContain('muster_withdrew_every_time');

    const commitment = save.muster.commitments[0]!;
    commitment.began = term;
    expect(earnedAchievements(save)).toContain('muster_settled_under_banner');
    commitment.status = 'withdrawn';
    expect(earnedAchievements(save)).toContain('muster_withdrew_every_time');
    expect(earnedAchievements(save)).not.toContain('muster_settled_under_banner');

    // A future settled engagement cannot revoke a record of withdrawing from
    // every commitment that actually existed by this ending.
    save.muster.commitments.push({
      id: 'another_future_muster', began: term + 1, age: 'wars', men: 5,
      from: { main: 5 }, officers: [], position: 'standard', credit: 2, status: 'settled',
    });
    expect(earnedAchievements(save)).toContain('muster_withdrew_every_time');
    expect(earnedAchievements(save)).not.toContain('muster_settled_under_banner');

    save.muster.commitments[1]!.began = term;
    expect(earnedAchievements(save)).not.toContain('muster_withdrew_every_time');
    expect(earnedAchievements(save)).toContain('muster_settled_under_banner');
  });

  it('requires each of the five returned names to have been spent by the ending (#2940)', () => {
    const save = finished();
    const term = save.ending!.year;
    save.friends = Array.from({ length: 5 }, (_, i) => ({
      name: 'Friend ' + (i + 1), sex: 'female' as const,
      dueFrom: 1042 + i, spentIn: term,
    }));
    expect(earnedAchievements(save)).toContain('five_names_returned');

    save.friends[0]!.spentIn = term + 1;
    expect(earnedAchievements(save)).not.toContain('five_names_returned');
    save.friends[0]!.spentIn = term;
    delete save.friends[1]!.spentIn;
    expect(earnedAchievements(save)).not.toContain('five_names_returned');
  });

  it('does not let a post-term refusal revoke a completed Match achievement (#2941)', () => {
    const save = finished();
    const term = save.ending!.year;
    save.decisionLog.push({
      kind: 'match', year: term, subject: save.people[0]!.id, card: null, spouse: 'outsider',
    });
    save.bearing.acts.push({ kind: 'refused_a_hand', year: term + 1 });
    const before = structuredClone(save);
    expect(earnedAchievements(save)).toContain('match_never_refused');
    expect(save).toEqual(before);

    save.bearing.acts[0]!.year = term;
    expect(earnedAchievements(save)).not.toContain('match_never_refused');
    save.bearing.acts[0]!.year = term - 1;
    expect(earnedAchievements(save)).not.toContain('match_never_refused');
    save.bearing.acts[0]!.kind = 'kept_her_back';
    expect(earnedAchievements(save)).toContain('match_never_refused');
  });

  it('reconstructs earned ladder rungs at the ending instead of using future high-water progress (#2986)', () => {
    const save = finished();
    const term = save.ending!.year;
    save.ascension.best = 'god';
    save.ascension.reachedAt = {
      touched: term - 2,
      adept: term - 1,
      god: term + 1,
    };
    const before = structuredClone(save);
    const earned = earnedAchievements(save);
    expect(earned).toContain('ladder_touched');
    expect(earned).toContain('ladder_adept');
    expect(earned).not.toContain('ladder_hierophant');
    expect(earned).not.toContain('ladder_god');
    expect(save).toEqual(before);

    // The same year is part of the completed run; the next year is not.
    save.ascension.reachedAt.god = term;
    expect(earnedAchievements(save)).toContain('ladder_god');

    save.ascension.reachedAt.god = term + 1;
    delete save.ascension.reachedAt.touched;
    delete save.ascension.reachedAt.adept;
    expect(earnedAchievements(save)).not.toContain('ladder_touched');

    // Old saves may have a high-water rung without a matching timestamp.
    delete save.ascension.reachedAt.god;
    expect(earnedAchievements(save)).toContain('ladder_god');

    // An inconsistent higher past stamp must not exceed the saved best rung.
    save.ascension.best = 'adept';
    save.ascension.reachedAt = { adept: term + 1, hierophant: term - 1 };
    expect(earnedAchievements(save)).not.toContain('ladder_hierophant');
    expect(earnedAchievements(save)).not.toContain('ladder_adept');
  });

  it('rejects recovered regencies before birth or after the regent died (#2987)', () => {
    const save = finished();
    const regent = save.people[0]!;
    regent.sex = 'female';
    const from = save.ending!.year - 40;
    const to = from + 20;
    save.succession.push({ person: regent.id, name: regent.name, from, to });

    regent.born = from + 1;
    expect(earnedAchievements(save)).not.toContain('regency_survived');

    regent.born = from;
    regent.died = to - 1;
    expect(earnedAchievements(save)).not.toContain('regency_survived');

    // Death in the closing year can itself end a legitimate regency.
    regent.died = to;
    expect(earnedAchievements(save)).toContain('regency_survived');
    regent.died = to + 1;
    expect(earnedAchievements(save)).toContain('regency_survived');
    delete regent.died;
    expect(earnedAchievements(save)).toContain('regency_survived');
  });

  it('credits five returned names only after every name became eligible (#2988)', () => {
    const save = finished();
    const term = save.ending!.year;
    save.friends = Array.from({ length: 5 }, (_, i) => ({
      name: `Friend ${i + 1}`, sex: 'female' as const,
      dueFrom: term - 10 + i, spentIn: term - 10 + i,
    }));
    expect(earnedAchievements(save)).toContain('five_names_returned');

    // This spend is in the past but before the window opened.
    save.friends[0]!.dueFrom = term + 1;
    expect(earnedAchievements(save)).not.toContain('five_names_returned');
    save.friends[0]!.dueFrom = term - 10;
    expect(earnedAchievements(save)).toContain('five_names_returned');

    save.friends[0]!.spentIn = term + 1;
    expect(earnedAchievements(save)).not.toContain('five_names_returned');
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
    expect(resumeGame(save, content).achievements(library).map((entry) => entry.id)).toContain('ending_all_long');
  });

  it('does not let Short-Line Library runs fill the all-Long-endings achievement', () => {
    const save = finished();
    save.campaign = 'short';
    save.ending = { id: 'devoured', year: 1342 };
    const longIds = ['apotheosis', 'unmade', 'broken_line', 'forgotten'] as const;
    const library: RunLibrary = {
      format: 1,
      runs: [
        ...longIds.map((id, i) => ({
          id: `long_${i}`, seed: i, campaign: 'long' as const, endedYear: 1542,
          house: `Long House ${i}`, ending: { id, title: id }, entries: [],
        })),
        {
          id: 'short_devoured', seed: 99, campaign: 'short', endedYear: 1342,
          house: 'Short House', ending: { id: 'devoured', title: 'devoured' }, entries: [],
        },
      ],
    };

    expect(earnedAchievements(save, library)).not.toContain('ending_all_long');
    expect(resumeGame(save, content).achievements(library).map((entry) => entry.id)).not.toContain('ending_all_long');

    // The current Long run may supply the fifth ending before it has been
    // appended to the Library.
    save.campaign = 'long';
    save.ending = { id: 'devoured', year: 1542 };
    expect(earnedAchievements(save, library)).toContain('ending_all_long');
  });
});


describe('achievement earn-rate report (#323)', () => {
  it('defaults to the first batch size that can represent the 1% rarity floor', () => {
    expect(ACHIEVEMENT_RATE_JUDGEABLE_RUNS).toBe(100);
  });

  const samples: AchievementSample[] = [
    { campaign: 'short', policy: 'chronicler', seed: 1, earned: ['ending_settled', 'ladder_touched', 'ladder_touched'] },
    { campaign: 'short', policy: 'chronicler', seed: 2, earned: ['ending_settled'] },
    { campaign: 'short', policy: 'ascendant', seed: 1, earned: ['ending_settled', 'ladder_touched'] },
    { campaign: 'short', policy: 'ascendant', seed: 2, earned: ['ladder_touched'] },
    { campaign: 'long', policy: 'chronicler', seed: 1, earned: ['ending_unmade', 'ladder_touched'] },
    { campaign: 'long', policy: 'chronicler', seed: 2, earned: ['ending_forgotten'] },
    { campaign: 'long', policy: 'ascendant', seed: 1, earned: ['ending_unmade', 'ladder_touched', 'ladder_adept'] },
    { campaign: 'long', policy: 'ascendant', seed: 2, earned: ['ending_unmade', 'ladder_touched'] },
  ];

  it('prints every stable id in catalogue order and counts at most once per run', () => {
    const rows = achievementRates(samples);
    expect(rows.map((row) => row.id)).toEqual([...ACHIEVEMENT_IDS]);

    expect(rows.find((row) => row.id === 'ending_settled')).toMatchObject({
      scope: 'run',
      short: {
        chronicler: { earned: 2, runs: 2, pct: 100 },
        ascendant: { earned: 1, runs: 2, pct: 50 },
      },
      long: {
        chronicler: { earned: 0, runs: 2, pct: 0 },
        ascendant: { earned: 0, runs: 2, pct: 0 },
      },
    });
    expect(rows.find((row) => row.id === 'ladder_touched')).toMatchObject({
      short: {
        chronicler: { earned: 1, runs: 2, pct: 50 },
        ascendant: { earned: 2, runs: 2, pct: 100 },
      },
      long: {
        chronicler: { earned: 1, runs: 2, pct: 50 },
        ascendant: { earned: 2, runs: 2, pct: 100 },
      },
    });
  });

  it('rejects duplicate seeds within a cohort instead of inflating the rarity denominator', () => {
    // Matching seeds in different campaigns or policies are intentionally paired:
    // the shared samples above already exercise that valid case.
    const duplicate: AchievementSample[] = [
      ...samples,
      { ...samples[0]! },
    ];
    expect(() => achievementRates(duplicate)).toThrow(
      'Duplicate achievement sample: short/chronicler seed 1',
    );
    expect(() => renderAchievementRates(duplicate)).toThrow(
      'Duplicate achievement sample: short/chronicler seed 1',
    );

    // Replaying one sample a hundred times must not make a statistically
    // unjudgeable two-seed report appear to meet the 100-run rarity floor.
    const padded: AchievementSample[] = Array.from({ length: 100 }, () => ({ ...samples[0]! }));
    expect(() => renderAchievementRates(padded)).toThrow('Duplicate achievement sample');
  });

  it('rejects invalid seeds that cannot identify an independent deterministic run', () => {
    expect(() => achievementRates([
      { ...samples[0]!, seed: Number.NaN },
    ])).toThrow('Invalid achievement sample seed');
    expect(() => achievementRates([
      { ...samples[0]!, seed: 1.5 },
    ])).toThrow('Invalid achievement sample seed');
  });

  it('rejects out-of-cohort evidence instead of silently excluding it from all rates', () => {
    const badCampaign = { ...samples[0]!, campaign: 'demo' } as unknown as AchievementSample;
    const badPolicy = { ...samples[0]!, policy: 'automated' } as unknown as AchievementSample;
    expect(() => achievementRates([badCampaign])).toThrow('Invalid achievement sample campaign: demo');
    expect(() => renderAchievementRates([badPolicy])).toThrow('Invalid achievement sample policy: automated');
  });

  it('rejects malformed earned IDs before treating a typo as an unearned achievement', () => {
    const unknownId = {
      ...samples[0]!, earned: ['ending_settled_typo'],
    } as unknown as AchievementSample;
    const nonArray = {
      ...samples[0]!, earned: 'ending_settled',
    } as unknown as AchievementSample;
    const wrongType = {
      ...samples[0]!, earned: [123],
    } as unknown as AchievementSample;

    expect(() => achievementRates([unknownId])).toThrow(
      'Invalid achievement sample achievement ID: ending_settled_typo',
    );
    expect(() => renderAchievementRates([nonArray])).toThrow(
      'Invalid achievement sample earned IDs: expected an array',
    );
    expect(() => achievementRates([wrongType])).toThrow(
      'Invalid achievement sample achievement ID: 123',
    );
    // Deliberate repeated *known* IDs remain legal and count only once per run.
    expect(achievementRates([samples[0]!]).find((row) => row.id === 'ladder_touched'))
      .toMatchObject({ short: { chronicler: { earned: 1, runs: 1, pct: 100 } } });
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
    expect(text).toContain('sample: Short chronicler 2 · ascendant 2 · Long chronicler 2 · ascendant 2');
    expect(text).toContain('NOT JUDGEABLE for the ~1% rarity floor');

    const judgeable: AchievementSample[] = [
      ...(['short', 'long'] as const).flatMap((campaign) =>
        (['chronicler', 'ascendant'] as const).flatMap((policy) =>
          Array.from({ length: ACHIEVEMENT_RATE_JUDGEABLE_RUNS }, (_, i) => ({
            campaign, policy, seed: i, earned: [] as const,
          })),
        ),
      ),
    ];
    expect(renderAchievementRates(judgeable)).not.toContain('NOT JUDGEABLE');
  });
});
