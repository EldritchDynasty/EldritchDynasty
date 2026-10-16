import { assertNever, type RunLibrary, type SavedGame } from '@ed/schema';
import { coreMessageAddress, defineMessage, type MessageDefinition } from './messages.js';
import { renderProse } from './prose.js';
import type { SimCtx } from './world.js';

/**
 * Stable backend ids for Steam achievements (#323 / #73 Track B).
 *
 * These ids are shared by the evaluator, client delivery and Steam backend.
 * Reader-mode wording must never change an id or an achievement condition.
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

export interface AchievementCatalogEntry {
  title: string;
  description: string;
  /** Frozen launch-calibration note for an ascendant-policy rate outside ~1–90%. */
  calibration?: string;
}

/**
 * Player-facing v1 achievement copy, frozen against #540's 100×4 played batch.
 *
 * Keep backend ids stable. Titles/descriptions may be localized later without
 * changing the evaluator or the Steam-facing id.
 */
const ACHIEVEMENT_COPY = {
  ending_apotheosis: {
    title: defineMessage('achievement.ending_apotheosis.title', 'Apotheosis'),
    description: defineMessage('achievement.ending_apotheosis.description', 'Reach the Apotheosis ending.'),
    calibration: 'rare: 0/100 Long ascendant runs in the #540 launch calibration',
  },
  ending_unmade: {
    title: defineMessage('achievement.ending_unmade.title', 'Unmade'),
    description: defineMessage('achievement.ending_unmade.description', 'Reach the Unmade ending.'),
  },
  ending_broken_line: {
    title: defineMessage('achievement.ending_broken_line.title', 'The Broken Line'),
    description: defineMessage('achievement.ending_broken_line.description', 'Reach the Broken Line ending.'),
  },
  ending_forgotten: {
    title: defineMessage('achievement.ending_forgotten.title', 'Forgotten'),
    description: defineMessage('achievement.ending_forgotten.description', 'Reach the Forgotten ending.'),
  },
  ending_devoured: {
    title: defineMessage('achievement.ending_devoured.title', 'Devoured'),
    description: defineMessage('achievement.ending_devoured.description', 'Reach the Devoured ending.'),
  },
  ending_settled: {
    title: defineMessage('achievement.ending_settled.title', 'Account Settled'),
    description: defineMessage('achievement.ending_settled.description', 'Reach the Settled ending.'),
  },
  ending_all_long: {
    title: defineMessage('achievement.ending_all_long.title', 'Every Long Ending'),
    description: defineMessage('achievement.ending_all_long.description', 'Record all five Long Line endings in the Library of Houses.'),
  },
  ladder_touched: {
    title: defineMessage('achievement.ladder_touched.title', 'First Rung'),
    description: defineMessage('achievement.ladder_touched.description', 'Reach the Touched rung of the ascension ladder.'),
    calibration: 'common: 92/100 Long ascendant runs in the #540 launch calibration',
  },
  ladder_adept: {
    title: defineMessage('achievement.ladder_adept.title', 'Adept'),
    description: defineMessage('achievement.ladder_adept.description', 'Reach the Adept rung of the ascension ladder.'),
  },
  ladder_hierophant: {
    title: defineMessage('achievement.ladder_hierophant.title', 'Hierophant'),
    description: defineMessage('achievement.ladder_hierophant.description', 'Reach the Hierophant rung of the ascension ladder.'),
  },
  ladder_vessel: {
    title: defineMessage('achievement.ladder_vessel.title', 'Vessel'),
    description: defineMessage('achievement.ladder_vessel.description', 'Reach the Vessel rung of the ascension ladder.'),
  },
  ladder_demigod: {
    title: defineMessage('achievement.ladder_demigod.title', 'Demigod'),
    description: defineMessage('achievement.ladder_demigod.description', 'Reach the Demigod rung of the ascension ladder.'),
  },
  ladder_god: {
    title: defineMessage('achievement.ladder_god.title', 'The God Rung'),
    description: defineMessage('achievement.ladder_god.description', 'Reach the God rung of the ascension ladder.'),
    calibration: 'rare: 0/100 Short and 0/100 Long ascendant runs in the #540 launch calibration',
  },
  clauses_3: {
    title: defineMessage('achievement.clauses_3.title', 'Three Clauses'),
    description: defineMessage('achievement.clauses_3.description', 'Recover at least three Ledger clauses in one run.'),
  },
  clauses_5: {
    title: defineMessage('achievement.clauses_5.title', 'Five Clauses'),
    description: defineMessage('achievement.clauses_5.description', 'Recover at least five Ledger clauses in one run.'),
  },
  clauses_7: {
    title: defineMessage('achievement.clauses_7.title', 'Seven Clauses'),
    description: defineMessage('achievement.clauses_7.description', 'Recover at least seven Ledger clauses in one run.'),
  },
  clauses_9: {
    title: defineMessage('achievement.clauses_9.title', 'Nine Clauses'),
    description: defineMessage('achievement.clauses_9.description', 'Recover all nine Ledger clauses in one run.'),
  },
  record_never_embellished: {
    title: defineMessage('achievement.record_never_embellished.title', 'Nothing Embellished'),
    description: defineMessage('achievement.record_never_embellished.description', 'Finish a run with Record choices and never choose Embellish.'),
  },
  record_never_truthful: {
    title: defineMessage('achievement.record_never_truthful.title', 'Nothing Recorded Plainly'),
    description: defineMessage('achievement.record_never_truthful.description', 'Finish a run with Record choices and never choose the plain Record option.'),
  },
  record_never_omitted: {
    title: defineMessage('achievement.record_never_omitted.title', 'Nothing Omitted'),
    description: defineMessage('achievement.record_never_omitted.description', 'Finish a run with Record choices and never choose Omit.'),
  },
  record_all_truthful: {
    title: defineMessage('achievement.record_all_truthful.title', 'Every Page Recorded'),
    description: defineMessage('achievement.record_all_truthful.description', 'Choose Record every time a Record block appears in a finished run.'),
  },
  record_all_embellished: {
    title: defineMessage('achievement.record_all_embellished.title', 'Every Page Embellished'),
    description: defineMessage('achievement.record_all_embellished.description', 'Choose Embellish every time a Record block appears in a finished run.'),
  },
  record_all_omitted: {
    title: defineMessage('achievement.record_all_omitted.title', 'Every Page Omitted'),
    description: defineMessage('achievement.record_all_omitted.description', 'Choose Omit every time a Record block appears in a finished run.'),
  },
  discrepancy_unproven_at_term: {
    title: defineMessage('achievement.discrepancy_unproven_at_term.title', 'Still in Dispute'),
    description: defineMessage('achievement.discrepancy_unproven_at_term.description', 'Finish with at least one discrepancy still open.'),
  },
  regency_survived: {
    title: defineMessage('achievement.regency_survived.title', 'Regency Survived'),
    description: defineMessage('achievement.regency_survived.description', 'See a regency end and the line continue.'),
  },
  cadet_took_seal: {
    title: defineMessage('achievement.cadet_took_seal.title', 'A Cadet Holds the Seal'),
    description: defineMessage('achievement.cadet_took_seal.description', 'See a cadet branch take the seal.'),
    calibration: 'common: 91/100 Long ascendant runs in the #540 launch calibration',
  },
  muster_settled_under_banner: {
    title: defineMessage('achievement.muster_settled_under_banner.title', 'Under the Banner'),
    description: defineMessage('achievement.muster_settled_under_banner.description', 'Settle a Muster commitment after taking a position.'),
  },
  muster_withdrew_every_time: {
    title: defineMessage('achievement.muster_withdrew_every_time.title', 'Every Muster Withdrawn'),
    description: defineMessage('achievement.muster_withdrew_every_time.description', 'Withdraw from every Muster commitment in a finished run.'),
  },
  match_never_refused: {
    title: defineMessage('achievement.match_never_refused.title', 'Every Hand Answered'),
    description: defineMessage('achievement.match_never_refused.description', 'Answer at least one Match without ever refusing a hand.'),
    calibration: 'common: 100/100 Short and 100/100 Long ascendant runs in the #540 launch calibration',
  },
  five_names_returned: {
    title: defineMessage('achievement.five_names_returned.title', 'Five Names Returned'),
    description: defineMessage('achievement.five_names_returned.description', 'Use all five returned names during a finished run.'),
    calibration: 'rare: 0/100 Short and 0/100 Long ascendant runs in the #540 launch calibration',
  },
} as const satisfies Record<AchievementId, {
  title: MessageDefinition;
  description: MessageDefinition;
  calibration?: string;
}>;

/** Original v1 copy remains available to store tooling and compatibility readers. */
export const ACHIEVEMENT_CATALOG = Object.fromEntries(ACHIEVEMENT_IDS.map((id) => {
  const entry = ACHIEVEMENT_COPY[id];
  return [id, {
    title: entry.title.original,
    description: entry.description.original,
    ...('calibration' in entry ? { calibration: entry.calibration } : {}),
  }];
})) as Readonly<Record<AchievementId, Readonly<AchievementCatalogEntry>>>;

export interface AchievementView {
  id: AchievementId;
  title: string;
  description: string;
}

/** Reader-local copy; backend ids, calibration evidence and earned facts stay separate. */
export function achievementView(ctx: SimCtx, id: AchievementId): AchievementView {
  const entry = ACHIEVEMENT_COPY[id];
  return {
    id,
    title: renderProse(ctx, coreMessageAddress(entry.title.key), entry.title.original),
    description: renderProse(ctx, coreMessageAddress(entry.description.key), entry.description.original),
  };
}


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
    default: assertNever(save.ending.id, 'achievement ending');
  }

  // "All long" means all five Long-Line endings, not five ending ids collected
  // across whichever campaign happened to produce them. The current finished
  // Long run is included because evaluation happens before it is necessarily
  // appended to the installation Library; a Short run must never fill that gap.
  const longEndings = new Set([
    ...(library?.runs
      .filter((run) => run.campaign === 'long')
      .map((run) => run.ending.id) ?? []),
    ...(save.campaign === 'long' ? [save.ending.id] : []),
  ]);
  add('ending_all_long', LONG_ENDINGS.every((id) => longEndings.has(id)));

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
