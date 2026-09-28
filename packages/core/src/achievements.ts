import type { RunLibrary, SavedGame } from '@ed/schema';

/**
 * Stable backend ids for Steam achievements (#323 / #73 Track B).
 *
 * These are deliberately NOT player-facing titles yet. #73 requires the earn
 * rates to be measured at both shipped campaign terms before titles/rarity are
 * committed to a store backend. Keeping ids here lets the evaluator, client
 * seam and batch instrumentation agree without turning calibration into prose.
 */
export const ACHIEVEMENT_IDS = [
  'ending_apotheosis',
  'ending_unmade',
  'ending_broken_line',
  'ending_forgotten',
  'ending_devoured',
  'ending_settled',
  'ending_all_long',
  'ladder_touched',
  'ladder_adept',
  'ladder_hierophant',
  'ladder_vessel',
  'ladder_demigod',
  'ladder_god',
  'clauses_3',
  'clauses_5',
  'clauses_7',
  'clauses_9',
  'record_never_embellished',
  'record_never_truthful',
  'record_never_omitted',
  'record_all_truthful',
  'record_all_embellished',
  'record_all_omitted',
  'discrepancy_unproven_at_term',
  'regency_survived',
  'cadet_took_seal',
  'muster_settled_under_banner',
  'muster_withdrew_every_time',
  'match_never_refused',
  'five_names_returned',
] as const;

export type AchievementId = typeof ACHIEVEMENT_IDS[number];

const LONG_ENDINGS = ['apotheosis', 'unmade', 'broken_line', 'forgotten', 'devoured'] as const;
const RUNGS = ['none', 'touched', 'adept', 'hierophant', 'vessel', 'demigod', 'god'] as const;

/**
 * Evaluate only facts a finished run already persisted.
 *
 * No achievement state belongs in WorldState. Cross-run "all endings" uses the
 * existing installation Library of Houses, which is already the product's
 * durable record of completed runs.
 *
 * Short Lines intentionally earn achievements. Conditions that a Short Line
 * cannot satisfy simply do not fire; the default campaign does not become an
 * achievement-free version of the game.
 */
export function earnedAchievements(save: SavedGame, library?: RunLibrary): AchievementId[] {
  if (!save.ending) return [];

  const earned = new Set<AchievementId>();
  const add = (id: AchievementId, yes = true) => { if (yes) earned.add(id); };

  switch (save.ending.id) {
    case 'apotheosis': add('ending_apotheosis'); break;
    case 'unmade': add('ending_unmade'); break;
    case 'broken_line': add('ending_broken_line'); break;
    case 'forgotten': add('ending_forgotten'); break;
    case 'devoured': add('ending_devoured'); break;
    case 'settled': add('ending_settled'); break;
  }

  const endings = new Set([
    ...library?.runs.map((run) => run.ending.id) ?? [],
    save.ending.id,
  ]);
  add('ending_all_long', LONG_ENDINGS.every((id) => endings.has(id)));

  const best = RUNGS.indexOf(save.ascension.best);
  for (const [rung, id] of [
    ['touched', 'ladder_touched'],
    ['adept', 'ladder_adept'],
    ['hierophant', 'ladder_hierophant'],
    ['vessel', 'ladder_vessel'],
    ['demigod', 'ladder_demigod'],
    ['god', 'ladder_god'],
  ] as const) {
    add(id, best >= RUNGS.indexOf(rung));
  }

  const clauses = new Set(save.clausesRecovered).size;
  add('clauses_3', clauses >= 3);
  add('clauses_5', clauses >= 5);
  add('clauses_7', clauses >= 7);
  add('clauses_9', clauses >= 9);

  const records = save.decisionLog.filter((entry) => entry.kind === 'record');
  if (records.length) {
    add('record_never_embellished', records.every((entry) => entry.option !== 'embellish'));
    add('record_never_truthful', records.every((entry) => entry.option !== 'record'));
    add('record_never_omitted', records.every((entry) => entry.option !== 'omit'));
    add('record_all_truthful', records.every((entry) => entry.option === 'record'));
    add('record_all_embellished', records.every((entry) => entry.option === 'embellish'));
    add('record_all_omitted', records.every((entry) => entry.option === 'omit'));
  }

  add(
    'discrepancy_unproven_at_term',
    save.discrepancies.some(([, discrepancy]) => discrepancy.state === 'open'),
  );

  const sex = new Map(save.people.map((person) => [person.id, person.sex]));
  add(
    'regency_survived',
    save.succession.some((reign) => sex.get(reign.person) === 'female' && reign.to !== undefined),
  );
  add('cadet_took_seal', save.branches.some((branch) => branch.heldSeal !== undefined));

  add(
    'muster_settled_under_banner',
    save.muster.commitments.some((commitment) => commitment.status === 'settled' && commitment.position !== undefined),
  );
  add(
    'muster_withdrew_every_time',
    save.muster.commitments.length > 0
      && save.muster.commitments.every((commitment) => commitment.status === 'withdrawn'),
  );

  const answeredMatch = save.decisionLog.some((entry) => entry.kind === 'match');
  add(
    'match_never_refused',
    answeredMatch && !save.bearing.acts.some((act) => act.kind === 'refused_a_hand'),
  );

  add(
    'five_names_returned',
    save.friends.length === 5 && save.friends.every((friend) => friend.spentIn !== undefined),
  );

  return ACHIEVEMENT_IDS.filter((id) => earned.has(id));
}
