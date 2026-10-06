/**
 * ACHIEVEMENT EARN-RATE REPORT (issue #323).
 *
 * Titles and store rarity should be chosen from played evidence, not guesses.
 * This instrument plays both the shipped chronicler and the canonical
 * ladder-seeking ascendant policy at both campaign terms, on paired seeds, and
 * prints every stable backend id in catalogue order.
 */
import { loadContent } from '@ed/content';
import type { CampaignId, Content } from '@ed/schema';
import {
  ACHIEVEMENT_POLICIES,
  ACHIEVEMENT_RATE_JUDGEABLE_RUNS,
  type AchievementPolicy,
  type AchievementSample,
  renderAchievementRates,
} from '../achievement-rates.js';
import { earnedAchievements } from '../achievements.js';
import { campaignDef } from '../campaign.js';
import { autoResolveAll } from '../events/decisions.js';
import { closeTheLedger } from '../ending.js';
import { makeRng, hashSeed } from '../rng.js';
import { saveGame } from '../save.js';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { configureAscendant, prepareAscendantYear, resolveAscendantYear } from './ending-gate.js';

const SHIPPED_CAMPAIGNS = ['short', 'long'] as const satisfies readonly CampaignId[];

/**
 * Play one shipped campaign under either the ordinary chronicler or the exact
 * composite ascendant policy already used by the endings lane. Keeping those
 * helpers shared is deliberate: achievement rarity must describe the player
 * who is actually trying for the ladder, not a second hand-written imitation.
 *
 * Policies use the same seed, so their rate columns are paired rather than
 * being confounded by separate random samples.
 */
export function playAchievementRun(
  content: Content,
  seed: number,
  campaign: 'short' | 'long',
  policy: AchievementPolicy = 'chronicler',
): AchievementSample {
  const def = campaignDef(campaign);
  const ctx = bootstrap(content, seed, def.startYear, campaign);
  const w = ctx.world;
  const tally = { asked: 0, paid: 0 };

  if (policy === 'ascendant') configureAscendant(ctx);

  for (let i = 0; i < def.years; i++) {
    if (w.year >= def.endYear || w.ending) break;
    if (policy === 'ascendant') prepareAscendantYear(ctx);
    stepYear(ctx, false);

    if (policy === 'ascendant') {
      resolveAscendantYear(ctx, seed, tally);
    } else {
      let guard = 0;
      while (w.pendingDecisions.length && guard++ < 200) {
        autoResolveAll(ctx, makeRng(hashSeed(seed, 'achievement-rate', w.year, guard)));
      }
      if (w.pendingDecisions.length) {
        throw new Error(`achievement report could not resolve the docket for seed ${seed} in ${w.year}`);
      }
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
    policy,
    seed,
    earned: earnedAchievements(save),
  };
}

export function measureAchievementRates(
  content: Content = loadContent(),
  runs = ACHIEVEMENT_RATE_JUDGEABLE_RUNS,
  seedBase = 32300,
): AchievementSample[] {
  if (!Number.isInteger(runs) || runs <= 0) throw new Error('runs must be a positive integer');

  const samples: AchievementSample[] = [];
  for (const campaign of SHIPPED_CAMPAIGNS) {
    for (const policy of ACHIEVEMENT_POLICIES) {
      for (let i = 0; i < runs; i++) {
        samples.push(playAchievementRun(content, seedBase + i, campaign, policy));
      }
    }
  }
  return samples;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('achievement-report.ts');
if (isMain) {
  const runs = Number(process.argv[2] ?? ACHIEVEMENT_RATE_JUDGEABLE_RUNS);
  process.stdout.write(renderAchievementRates(measureAchievementRates(loadContent(), runs)));
}
