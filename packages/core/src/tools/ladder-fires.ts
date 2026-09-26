import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { bootstrap, clearNamingQueue } from '../sim.js';
import { stepYear } from '../year/step.js';
import { END_YEAR } from '../ending.js';
import { START_YEAR } from '../campaign.js';
import type { SimCtx } from '../world.js';
import { resolveYear } from './ladder-policy.js';

type Source = ContentBundle | Content;

/**
 * Which templates a house that deliberately plays for the ladder ever sees.
 *
 * This is the fire-rate gate's acquittal pass. It lives outside the Node-only
 * ladder CLI so a browser authoring tool can use the same reachability rule.
 */
export function firedUnderClimbing(
  source: Source,
  seeds: number[],
  years: number,
  bid = 900,
  stopWhen?: (fired: ReadonlySet<string>) => boolean,
): Set<string> {
  const fired = new Set<string>();
  const collect = (ctx: SimCtx) => {
    for (const [id, n] of Object.entries(ctx.world.frequency.templateFires)) {
      if (n > 0) fired.add(id);
    }
  };

  for (const seed of seeds) {
    const ctx = playForFires(
      source,
      seed,
      years,
      bid,
      stopWhen
        ? (running) => {
          collect(running);
          return stopWhen(fired);
        }
        : undefined,
    );
    collect(ctx);
    if (stopWhen?.(fired)) break;
  }
  return fired;
}

function playForFires(
  source: Source,
  seed: number,
  years: number,
  bid: number,
  stopWhen?: (ctx: SimCtx) => boolean,
): SimCtx {
  const ctx = bootstrap(indexContent(source), seed, START_YEAR);
  const w = ctx.world;
  w.bidCeiling = bid;
  const tally = { asked: 0, paid: 0 };

  for (let y = 0; y < years; y++) {
    if (w.year >= END_YEAR || w.ending) break;
    stepYear(ctx, false);
    resolveYear(ctx, seed, 'climb', tally);
    clearNamingQueue(ctx);
    if (stopWhen?.(ctx)) break;
  }
  return ctx;
}
