/**
 * THE EXAMINATION BALANCE TELEMETRY (#343).
 *
 * This module plays whole Short Lines and is therefore scheduled evidence,
 * never a fast-test dependency. The pure judgement lives in signing-verdict.ts
 * so merge CI can prove a lopsided fixture goes red without playing a game.
 */
import { loadContent } from '@ed/content';
import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { rungIndex } from '../ascension.js';
import { campaignDef } from '../campaign.js';
import { hashSeed, makeRng } from '../rng.js';
import { newGame } from '../session.js';
import {
  verdictOver,
  type SigningBalanceLimits,
  type SigningGateResult,
  type SigningSample,
} from './signing-verdict.js';

export {
  SIGNING_BALANCE_LIMITS,
  verdictOver,
  type SigningBalanceLimits,
  type SigningGateResult,
  type SigningSample,
} from './signing-verdict.js';

type Source = ContentBundle | Content;

function answersForSeed(
  content: Content,
  seed: number,
  forcedQuestion: string,
  forcedAnswer: string,
): Record<string, string> {
  const questions = content.prologue?.examination ?? [];
  return Object.fromEntries(questions.map((question) => {
    if (question.id === forcedQuestion) return [question.id, forcedAnswer];
    const rng = makeRng(hashSeed(seed, 'signing-gate', question.id));
    return [question.id, rng.pick(question.answers).id];
  }));
}

function playSample(
  content: Content,
  seed: number,
  question: string,
  answer: string,
  years: number,
): SigningSample {
  const prologue = content.prologue;
  if (!prologue) throw new Error('the shipped bundle has no prologue');
  const heirloom = prologue.heirlooms[0];
  const grudge = prologue.grudges[0];
  if (!heirloom || !grudge) throw new Error('the prologue needs an heirloom and grudge to found a gate run');

  const session = newGame(content, { seed, campaign: 'short', decider: 'chronicler' });
  const answers = answersForSeed(content, seed, question, answer);
  const founded = session.found({
    houseName: 'House Measure',
    heirloom: String(heirloom.heirloom),
    grudge: String(grudge.house),
    answers,
  });
  if (!founded.ok) {
    throw new Error(
      `signing gate could not found seed ${seed} for ${question}/${answer}: ${founded.reason ?? 'refused'}`,
    );
  }

  session.advance(years);
  const world = session.ctx.world;
  const campaign = campaignDef('short');
  return {
    seed,
    question,
    answer,
    reachedTerm: world.year >= campaign.endYear && world.ending ? 1 : 0,
    bestRung: rungIndex(world.ascension.best),
    clauses: world.clausesRecovered.size,
    ...(world.ending ? { ending: world.ending.id } : {}),
  };
}

/**
 * Scheduled/manual paired-seed measurement.
 *
 * 48 seeds means 576 Short-Line answer-runs for the current four-by-three
 * Examination. Registration in scheduled CI belongs to #451's checked
 * evidence inventory; keeping that wiring out of this PR avoids two owners
 * editing the same cadence registry at once.
 */
export function gateSigning(
  source: Source = loadContent(),
  opts: {
    seeds?: readonly number[];
    years?: number;
    limits?: SigningBalanceLimits;
  } = {},
): SigningGateResult {
  const content = indexContent(source);
  const questions = content.prologue?.examination ?? [];
  if (!questions.length) {
    return { ok: false, lines: ['gate signing: FAIL: shipped prologue has no Examination'] };
  }

  const seeds = opts.seeds ?? Array.from({ length: 48 }, (_, index) => 20_000 + index * 17);
  const years = opts.years ?? campaignDef('short').years;
  const samples: SigningSample[] = [];

  try {
    for (const question of questions) {
      for (const answer of question.answers) {
        for (const seed of seeds) {
          samples.push(playSample(content, seed, question.id, answer.id, years));
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      lines: [`gate signing: FAIL: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  return verdictOver(samples, opts.limits);
}
