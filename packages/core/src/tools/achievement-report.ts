/**
 * ACHIEVEMENT EARN-RATE REPORT (issue #323).
 *
 * Titles and store rarity should be chosen from played evidence, not guesses.
 * This instrument plays the shipped chronicler policy at both campaign terms
 * and prints every stable backend id in catalogue order.
 */
import { loadContent } from '@ed/content';
import type { CampaignId, Content } from '@ed/schema';
import { type AchievementSample, renderAchievementRates } from '../achievement-rates.js';
import { earnedAchievements } from '../achievements.js';
import { campaignDef } from '../campaign.js';
import { autoResolveAll } from '../events/decisions.js';
import { closeTheLedger } from '../ending.js';
import { makeRng, hashSeed } from '../rng.js';
import { saveGame } from '../save.js';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';

const SHIPPED_CAMPAIGNS = ['short', 'long'] as const satisfies readonly CampaignId[];

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
