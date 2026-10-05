import type { Choice, EventTemplate } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { evalCondition } from './conditions.js';
import { evalCheck } from './checks.js';
import type { SlotFill } from './slots.js';
import type { EvalScope } from './scope.js';
import { choiceAvailability } from './availability.js';

/**
 * WHO TAKES THE BRANCH — the evaluator for `schema/src/decider.ts`.
 *
 * There is one function, and both the player's path and the chronicler's go
 * through it, for the same reason `commitOutcome` is the only place an outcome
 * is applied (invariant 9). Two evaluators would be two sets of rules, and the
 * one that ran less often would be the one that was wrong.
 *
 * It does not apply anything. It answers one question — which branch — and
 * hands back the reason with it, because the reason is worth as much as the
 * answer. The editor draws it in the branch trace, and a player who watched his
 * house sell the north field without being asked is owed a sentence saying the
 * treasury was empty and that is what this house does when the treasury is
 * empty.
 *
 * EVERY PATH RESOLVES. A ladder no rung of which holds, a check naming a branch
 * that is not there, a `party` decider whose check was never declared — all of
 * them fall through to a weighted draw rather than returning nothing. A
 * decision with no legal answer still has to be answered or the year never
 * turns over, and invariant 9 means an unanswered decision stops the clock for
 * good.
 */

export interface BranchDecision {
  /** The branch taken. Undefined only when the decision belongs to the player. */
  choice?: Choice;
  /**
   * Does this have to go on the docket? True for `player`, and true for `party`
   * until the player has named the party — casting IS his decision there.
   */
  asks: boolean;
  /** One sentence, in plain language. Shown in the editor and on the docket. */
  why: string;
}

/** Does this event want the player to cast anybody before it can resolve? */
export function wantsPlayerCast(e: EventTemplate): boolean {
  return Object.values(e.slots).some((s) => s.castBy === 'player');
}

export interface DecideOpts {
  /** True once the player has sent his cast, so a `party` decider can roll. */
  castReady?: boolean;
  scope?: EvalScope;
}

export function decideBranch(
  ctx: SimCtx,
  e: EventTemplate,
  fill: SlotFill,
  rng: Rng,
  opts: DecideOpts = {},
): BranchDecision {
  if (e.interaction.kind === 'narration') {
    return { asks: false, why: 'narration — nothing is being decided' };
  }

  const choices = e.interaction.choices;
  const decider = e.interaction.decidedBy;
  const scope = opts.scope ?? {};
  const open = choices.filter((c) => choiceAvailability(c, ctx, fill, e).available);
  const fallback = (why: string): BranchDecision => ({
    choice: byWeight(open.length ? open : choices, rng),
    asks: false,
    why,
  });

  if (decider === 'player') return { asks: true, why: 'the house decides' };
  if (decider === 'chance') return fallback('as it fell out');

  if ('state' in decider) {
    for (const rung of decider.state) {
      if (!evalCondition(rung.when, ctx, scope)) continue;
      // A rung naming a choice whose `requires` fail is a rung that cannot be
      // taken. Skipping to the next is right: the ladder says what the house
      // WOULD do, and it cannot do what it is not able to do.
      const found = open.find((c) => c.id === rung.take);
      if (!found) continue;
      return { choice: found, asks: false, why: rung.because ?? `the house's condition: ${found.label}` };
    }
    return fallback('no rung of the ladder held');
  }

  // The player's decision here is WHO GOES, and until he has made it there is
  // nothing to pool. This is the whole of a delegated decision: he picks the
  // party, and what those people are between them picks the rest.
  if (!opts.castReady && wantsPlayerCast(e)) {
    return { asks: true, why: 'the house names who goes; what they are between them decides the rest' };
  }

  const check = e.checks.find((c) => c.id === decider.party.check);
  // `decider/wiring` fails the build on a missing check. If one reaches here
  // anyway, resolve — but do not pretend the check passed.
  if (!check) return fallback(`check '${decider.party.check}' is not declared`);

  const result = evalCheck(ctx, check, e, fill, rng);
  // A `party` check's bands name CHOICE ids, not outcome ids; `CheckResult`
  // calls the field `outcomeId` because that is what it means in the other,
  // older use. `checks/wiring` validates which is which.
  //
  // A real branch can still be closed by Choice.requires. State deciders
  // already skip such a rung; party checks must obey the same availability
  // contract rather than letting the check bypass a requirement.
  const named = open.find((c) => c.id === result.outcomeId);
  if (!named) {
    const exists = choices.some((c) => c.id === result.outcomeId);
    return fallback(exists
      ? `the check named '${result.outcomeId}', but that branch is unavailable`
      : `the check named '${result.outcomeId}', which is not one of the branches`);
  }

  return {
    choice: named,
    asks: false,
    why: `${Math.round(result.roll)} against ${Math.round(result.difficulty)} — ${named.label}`,
  };
}

/**
 * The weighted draw over BRANCHES.
 *
 * A `Choice` carries no weight of its own — weights live on outcomes — so a
 * branch is worth what its outcomes are worth in total. An author who wants one
 * branch taken twice as often as another says so by weighting its outcomes,
 * which is the knob they already reach for.
 */
function byWeight(choices: Choice[], rng: Rng): Choice {
  return rng.weighted(choices, (c) => c.outcomes.reduce((s, o) => s + o.weight, 0) || 1) ?? choices[0]!;
}
