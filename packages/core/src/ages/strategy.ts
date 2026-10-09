import type { SimCtx } from '../world.js';
import { msg } from '../messages.js';

export type AgeMatchPriority = 'blood' | 'standing' | 'continuity' | 'mystery';
export type AgeRecordPriority = 'record' | 'omit' | 'embellish';

export interface AgeStrategy {
  match?: AgeMatchPriority;
  career?: string;
  record?: AgeRecordPriority;
  /** In the reader's setting. One literal key each, so the words have a stable identity. */
  priorities(ctx: SimCtx): readonly [string, string];
}

/**
 * THE STRATEGIC IDENTITY OF AN AGE (issue #216).
 *
 * Ages remain scheduled by the hazard process. This table changes no onset,
 * duration, clause cadence or late-campaign weighting. It only tells systems
 * that already own a decision what becomes unusually valuable while an Age is
 * active. That is deliberately not a catch-all difficulty multiplier.
 *
 * The two short strings are date/name-free diagnostic language: they describe
 * what a player should care about, not what the calendar calls the years.
 */
export const AGE_STRATEGIES: Readonly<Record<string, AgeStrategy>> = {
  the_long_peace: {
    match: 'continuity',
    career: 'merchant',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_long_peace.0', 'large, well-attested families are worth marrying into'),
      msg(ctx, 'age_strategy.the_long_peace.1', 'commercial places are cheaper for the house to obtain'),
    ],
  },
  the_wars: {
    match: 'continuity',
    career: 'military',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_wars.0', 'surviving, proven lines matter more than concentrated blood'),
      msg(ctx, 'age_strategy.the_wars.1', 'military commissions are cheaper for the house to obtain'),
    ],
  },
  the_crusade: {
    match: 'standing',
    record: 'omit',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_crusade.0', 'a house already legible to institutions is safer to marry'),
      msg(ctx, 'age_strategy.the_crusade.1', 'the chronicler is more tempted to leave dangerous truths blank'),
    ],
  },
  the_insurrection: {
    match: 'standing',
    career: 'advocate',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_insurrection.0', 'alliances and public standing matter more at the marriage table'),
      msg(ctx, 'age_strategy.the_insurrection.1', 'advocate places are cheaper while old claims are contested'),
    ],
  },
  the_withering: {
    match: 'blood',
    career: 'scholar',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_withering.0', 'known blood matters more while the gift is thinning'),
      msg(ctx, 'age_strategy.the_withering.1', 'scholars are unusually valuable while books and knowledge disappear'),
    ],
  },
  the_quickening: {
    match: 'blood',
    record: 'embellish',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_quickening.0', 'deep blood becomes unusually attractive at the marriage table'),
      msg(ctx, 'age_strategy.the_quickening.1', 'the chronicler is more tempted to write sudden greatness larger'),
    ],
  },
  the_plague: {
    match: 'continuity',
    career: 'clergy',
    priorities: (ctx) => [
      msg(ctx, 'age_strategy.the_plague.0', 'fertile lines with grown children become unusually attractive'),
      msg(ctx, 'age_strategy.the_plague.1',
        'ordination is cheaper to obtain while the household is under mortal pressure'),
    ],
  },
};

function activeStrategies(ctx: SimCtx): AgeStrategy[] {
  return ctx.world.age.active
    .map((a) => AGE_STRATEGIES[a.age])
    .filter((s): s is AgeStrategy => Boolean(s));
}

/** Match priorities stack when two Ages overlap; the card can say both matter. */
export function activeMatchPriorities(ctx: SimCtx): AgeMatchPriority[] {
  return [...new Set(activeStrategies(ctx).flatMap((s) => s.match ? [s.match] : []))];
}

/** Record pressures stack when Ages overlap, but never remove an option. */
export function activeRecordPriorities(ctx: SimCtx): AgeRecordPriority[] {
  return [...new Set(activeStrategies(ctx).flatMap((s) => s.record ? [s.record] : []))];
}

/**
 * A preferred post is cheaper for the player to commission at the Table.
 * Scholar is the one post with an authored study-speed benefit, so The
 * Withering also amplifies that existing benefit. Neither hook changes
 * autonomous steward placement or annual career income.
 */
export function ageCareerFactor(ctx: SimCtx, career: string): number {
  return activeStrategies(ctx).some((s) => s.career === career) ? 1.5 : 1;
}

/**
 * Date- and name-stripped fixture for playtests and diagnostics. Nothing here
 * contains an Age id, display name, onset year or elapsed duration.
 */
export function strategicPressures(ctx: SimCtx): string[] {
  return [...new Set(activeStrategies(ctx).flatMap((s) => s.priorities(ctx)))];
}
