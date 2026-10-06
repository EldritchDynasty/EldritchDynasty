import type { Check, Content, ContentBundle, EventTemplate } from '@ed/schema';
import { indexContent } from '@ed/schema';
import { bootstrap } from '../sim.js';
import type { SimCtx } from '../world.js';
import { runYears } from '../year/step.js';
import type { Rng } from '../rng.js';
import { resolveSlots, type SlotFill } from './slots.js';
import { decideBranch } from './deciders.js';
import { choiceAvailability } from './availability.js';
import { evalDifficulty, resolveChoiceOutcome } from './checks.js';
import { commitOutcome, queueChoice, resolveChoice } from './decisions.js';
import { pickOutcome } from './effects.js';
import { evalCondition } from './conditions.js';
import { framePool, presentFrame } from './frame.js';
import type { ArcStep } from './arcs.js';

/**
 * WHICH BRANCHES A RUN ACTUALLY REACHES.
 *
 * The frequency ledger counts TEMPLATE fires, which is what gate 4 measures
 * and what `world.frequency.templateFires` exists for. It has nothing to say
 * about the shape underneath a template: an event that fires in 85% of runs
 * can still have a choice nobody has ever been offered, because `requires`
 * reads attributes off the people cast in that particular year, and a check
 * band nobody has ever cleared, because the difficulty sits above what the
 * population produces.
 *
 * Both are invisible to every other instrument in the codebase. They are not
 * statically impossible — `outcomes/weights` is right to pass them — and they
 * do not dent the event's fire rate. The only way to see them is to run the
 * game and look at what was decided, which `world.decisionLog` already records
 * in full because replay (issue #8) needed it to.
 */

/** The identity of one authored branch, stable across runs. */
export function outcomeKey(event: string, choiceId: string | undefined, outcomeId: string): string {
  return `${event}|${choiceId ?? ''}|${outcomeId}`;
}

/** How a branch reads in a gate's output. */
function outcomeLabel(event: string, choiceId: string | undefined, outcomeId: string): string {
  return `${event}${choiceId ? `/${choiceId}` : ''} -> ${outcomeId}`;
}

/** The identity of the CHOICE an outcome sits under, keyed like `firings`. */
export function choiceKey(event: string, choiceId: string | undefined): string {
  return `${event}|${choiceId ?? ''}`;
}

/**
 * WHAT THE CONTENT PROMISES, AND WHAT SHARE OF ITS OWN ROLL EACH PROMISE HAS.
 *
 * The share is the half that was missing (issue #80). An outcome that never
 * resolved is only evidence of anything once you know how many chances it
 * had, and its chances are its parent choice's firings times this — authored
 * weights, read straight off the template, normalised inside the choice.
 */
export interface DeclaredOutcome {
  /** How it reads in a gate's output. */
  label: string;
  /** The choice it sits under. Its firing count is the denominator. */
  choice: string;
  /** Its share of that choice's outcome roll, in 0..1. */
  share: number;
}

/**
 * Every `(event, choice, outcome)` triple the content declares, keyed the same
 * way the decision log will report them. Narration has one implicit branch and
 * no choice id, which is why the key carries an empty segment rather than
 * omitting one — a choice named `''` is not authorable, so the two can never
 * collide.
 */
export function declaredOutcomes(source: ContentBundle | Content): Map<string, DeclaredOutcome> {
  const content = indexContent(source);
  const out = new Map<string, DeclaredOutcome>();

  const add = (
    e: EventTemplate,
    choiceId: string | undefined,
    outcomes: readonly { id: string; weight: number }[],
  ) => {
    // `weight` is authored per outcome and the roll is over their sum, so a
    // choice whose weights are 80/20 and one whose weights are 8/2 are the
    // same choice. Normalising here is what makes the two comparable.
    const total = outcomes.reduce((a, o) => a + o.weight, 0);
    for (const o of outcomes) {
      out.set(outcomeKey(String(e.id), choiceId, o.id), {
        label: outcomeLabel(String(e.id), choiceId, o.id),
        choice: choiceKey(String(e.id), choiceId),
        // A total of zero is not authorable — `outcomes/weights` rejects it —
        // but a share of NaN would silently become an unfailable outcome, and
        // this file is the last place that should invent one.
        share: total > 0 ? o.weight / total : 0,
      });
    }
  };

  for (const e of content.events) {
    if (e.interaction.kind === 'narration') add(e, undefined, e.interaction.outcomes);
    else for (const c of e.interaction.choices) add(e, c.id, c.outcomes);
  }
  return out;
}

/**
 * ONE DETERMINISTIC EXECUTION WITNESS, THROUGH THE REAL EVENT PIPELINE (#442).
 *
 * This is deliberately a mechanism seam, not the final gate. A caller has to
 * construct a world and choose an RNG that make the named branch resolve. The
 * important property is what happens after that setup: slots are resolved by
 * the production caster, automatic branches by the production decider, choice
 * requirements by the production availability check, outcomes by the production
 * resolver, and success is recorded only after the production commit path wrote
 * the exact (event, choice, outcome) triple to the decision log.
 *
 * The old sampled outcome-reach gate remains blocking until #442 supplies a
 * witness setup for every authored mechanism. Keeping this helper separate from
 * the sampled tally lets that migration happen one mechanism at a time without
 * teaching tests a second definition of event semantics.
 */
export interface OutcomeWitnessRequest {
  expectedOutcomeId: string;
  /** Required for player-decided interactions; for automatic deciders this is an assertion. */
  choiceId?: string;
  rng: Rng;
  /**
   * Steer only an ordinary weighted outcome group toward the named outcome.
   *
   * The adapter still asks the underlying RNG to make its normal weighted draw
   * first, so the stream advances exactly as it would in production. It then
   * substitutes the named item only when that item has positive effective
   * weight. Checks are unaffected: they resolve through `evalCheck`, not
   * `Rng.weighted`, and therefore still need a witness world that clears the
   * requested band.
   */
  targetWeightedOutcome?: boolean;
  /**
   * Steer a `decidedBy: chance` interaction toward `choiceId`.
   *
   * The production weighted branch draw is still consumed first, preserving
   * the RNG cursor. State/party/player deciders are deliberately not rewritten
   * by this flag; they need their own witness state rather than pretending to
   * be chance.
   */
  targetChanceChoice?: boolean;
  /**
   * Steer a randomised Choice.check toward the named outcome while still
   * resolving the production score, difficulty and ordered band table.
   *
   * The underlying normal draw is consumed before the adapter substitutes a
   * roll on the target band's threshold, preserving RNG cursor cost. A
   * `variance: none` check has no random draw to steer and is deliberately
   * left alone: its witness world/cast must clear the requested band honestly.
   */
  targetCheckedOutcome?: boolean;
  /**
   * Steer a randomised `decidedBy: party` check toward `choiceId` after the
   * player supplies the cast. The production party pool, dynamic difficulty,
   * band ordering and docket resolution still run unchanged; only that check's
   * first normal draw is placed exactly on the requested branch threshold.
   */
  targetPartyChoice?: boolean;
  /**
   * Supply the exact production arc step for an arc-node event.
   *
   * The witness reuses the step's resolved fill and arc scope and passes the
   * same step into commitOutcome, so success proves the real arc history /
   * successor path rather than treating the node like an ambient event.
   */
  arcStep?: ArcStep;
  /**
   * Cast supplied through the production decision docket for `castBy: player`
   * slots. Weighted player-cast outcomes may use `targetWeightedOutcome`;
   * only the choice's first weighted draw is steered, so weighted mechanics
   * triggered by the committed outcome keep their production RNG. A delegated
   * `party` branch is supported only when its deciding check has
   * `variance: none`, so previewing the production decider cannot consume RNG
   * before `resolveChoice` runs the same decision for the real commit.
   */
  cast?: SlotFill;
}

export interface OutcomeWitnessResult {
  ok: boolean;
  key?: string;
  reason?: string;
}

/**
 * A witness may need to prove a rare weighted branch without seed-mining for
 * the one draw that happens to land on it. This adapter does not reimplement
 * outcome weighting: `pickOutcome` still computes the production weight
 * function and calls `weighted` with it. We consume the underlying weighted
 * draw first, preserving the stream position, then choose the named positive-
 * weight item. Any other RNG operation is passed straight through.
 */
function targetWeightedIdRng(base: Rng, targetId: string): Rng {
  const wrap = (rng: Rng): Rng => ({
    next: () => rng.next(),
    int: (max) => rng.int(max),
    range: (min, max) => rng.range(min, max),
    bool: (p) => rng.bool(p),
    pick: <T>(xs: readonly T[]) => rng.pick(xs),
    weighted<T>(xs: readonly T[], weight: (x: T) => number): T | undefined {
      const natural = rng.weighted(xs, weight);
      const target = xs.find((x) => (
        typeof x === 'object'
        && x !== null
        && 'id' in x
        && String((x as { id?: unknown }).id) === targetId
      ));
      return target !== undefined && weight(target) > 0 ? target : natural;
    },
    normal: (mean, sd) => rng.normal(mean, sd),
    poisson: (lambda) => rng.poisson(lambda),
    fork: (salt) => wrap(rng.fork(salt)),
  });
  return wrap(base);
}

/**
 * The docket owns outcome resolution and commit as one operation, so a witness
 * cannot resolve a weighted player-cast outcome first and then commit it
 * separately without bypassing production. Target exactly the FIRST matching
 * weighted draw instead. Later weighted operations (including effects reached
 * by the outcome) delegate to the untouched RNG.
 */
function targetWeightedIdOnceRng(base: Rng, targetId: string): Rng {
  let targeted = false;
  const wrap = (rng: Rng): Rng => ({
    next: () => rng.next(),
    int: (max) => rng.int(max),
    range: (min, max) => rng.range(min, max),
    bool: (p) => rng.bool(p),
    pick: <T>(xs: readonly T[]) => rng.pick(xs),
    weighted<T>(xs: readonly T[], weight: (x: T) => number): T | undefined {
      const natural = rng.weighted(xs, weight);
      if (targeted) return natural;
      const target = xs.find((x) => (
        typeof x === 'object'
        && x !== null
        && 'id' in x
        && String((x as { id?: unknown }).id) === targetId
      ));
      if (target !== undefined && weight(target) > 0) {
        targeted = true;
        return target;
      }
      return natural;
    },
    normal: (mean, sd) => rng.normal(mean, sd),
    poisson: (lambda) => rng.poisson(lambda),
    fork: (salt) => wrap(rng.fork(salt)),
  });
  return wrap(base);
}

/**
 * Put one randomised check exactly on the threshold of the band that names the
 * requested outcome. The production evaluator still computes pool, bonuses,
 * dynamic difficulty, sorts the authored bands and decides which one clears.
 *
 * As with weighted targeting, consume the real RNG operation first so later
 * draws see the same stream position. Checks with no variance intentionally
 * expose no RNG operation, so this adapter cannot manufacture a success for
 * them.
 */
function targetCheckedOutcomeRng(
  base: Rng,
  ctx: SimCtx,
  check: Check,
  outcomeId: string,
): Rng {
  const band = check.bands.find((candidate) => candidate.outcome === outcomeId);
  if (!band || check.variance === 'none') return base;

  const forcedRoll = evalDifficulty(ctx, check.difficulty) + band.atLeast;
  const wrap = (rng: Rng): Rng => ({
    next: () => rng.next(),
    int: (max) => rng.int(max),
    range: (min, max) => rng.range(min, max),
    bool: (p) => rng.bool(p),
    pick: <T>(xs: readonly T[]) => rng.pick(xs),
    weighted: <T>(xs: readonly T[], weight: (x: T) => number) => rng.weighted(xs, weight),
    normal(mean, sd) {
      rng.normal(mean, sd);
      return forcedRoll;
    },
    poisson: (lambda) => rng.poisson(lambda),
    fork: (salt) => wrap(rng.fork(salt)),
  });
  return wrap(base);
}

/**
 * A delegated party decision is resolved inside `resolveChoice`, after the
 * player cast has been validated. Target its production check without also
 * steering any later normal draws reached by the committed outcome.
 */
function targetCheckBandOnceRng(
  base: Rng,
  ctx: SimCtx,
  check: Check,
  branchId: string,
): Rng {
  const band = check.bands.find((candidate) => candidate.outcome === branchId);
  if (!band || check.variance === 'none') return base;

  const forcedRoll = evalDifficulty(ctx, check.difficulty) + band.atLeast;
  let targeted = false;
  const wrap = (rng: Rng): Rng => ({
    next: () => rng.next(),
    int: (max) => rng.int(max),
    range: (min, max) => rng.range(min, max),
    bool: (p) => rng.bool(p),
    pick: <T>(xs: readonly T[]) => rng.pick(xs),
    weighted: <T>(xs: readonly T[], weight: (x: T) => number) => rng.weighted(xs, weight),
    normal(mean, sd) {
      const natural = rng.normal(mean, sd);
      if (targeted) return natural;
      targeted = true;
      return forcedRoll;
    },
    poisson: (lambda) => rng.poisson(lambda),
    fork: (salt) => wrap(rng.fork(salt)),
  });
  return wrap(base);
}


export interface FrameOutcomeWitnessRequest {
  expectedOutcomeId: string;
  rng: Rng;
}

/**
 * One deterministic frame-narration witness through the real frame pool,
 * caster, outcome picker and frame-entry commit path.
 *
 * Frame templates are deliberately outside ambientPool, so treating them as
 * ordinary events would prove the wrong eligibility semantics. The caller
 * builds the record/discrepancy state named by \`reads\`; this seam verifies
 * that the real frame pool admits the template before presenting it.
 */
export function executeFrameOutcomeWitness(
  ctx: SimCtx,
  e: EventTemplate,
  request: FrameOutcomeWitnessRequest,
): OutcomeWitnessResult {
  if (e.tier !== 'frame') {
    return { ok: false, reason: 'frame witness requires a frame-tier event' };
  }
  if (e.interaction.kind !== 'narration') {
    return { ok: false, reason: 'frame witness currently supports narration only' };
  }
  if (!framePool(ctx).some((candidate) => candidate.id === e.id)) {
    return { ok: false, reason: 'frame reads are not satisfied by this witness world' };
  }

  const beforeLog = ctx.world.decisionLog.length;
  const entry = presentFrame(
    ctx,
    e,
    targetWeightedIdRng(request.rng, request.expectedOutcomeId),
  );
  if (!entry) {
    return { ok: false, reason: 'frame cast could not be resolved' };
  }
  if (String(entry.outcomeId) !== request.expectedOutcomeId) {
    return {
      ok: false,
      reason: \`resolved '\${entry.outcomeId}', not '\${request.expectedOutcomeId}'\`,
    };
  }

  const committed = ctx.world.decisionLog.slice(beforeLog).some((row) => (
    row.kind === 'outcome'
    && row.event === e.id
    && row.outcomeId === request.expectedOutcomeId
  ));
  if (!committed) {
    return { ok: false, reason: 'frame outcome was not committed to the decision log' };
  }

  return {
    ok: true,
    key: outcomeKey(String(e.id), undefined, request.expectedOutcomeId),
  };
}

export function executeOutcomeWitness(
  ctx: SimCtx,
  e: EventTemplate,
  request: OutcomeWitnessRequest,
): OutcomeWitnessResult {
  const arcStep = request.arcStep;
  if (e.arc) {
    if (!arcStep) return { ok: false, reason: 'arc event requires an arc-step witness' };
    if (
      String(arcStep.instance.arc) !== String(e.arc.of)
      || String(arcStep.node.id) !== String(e.arc.node)
      || String(arcStep.node.event) !== String(e.id)
    ) {
      return { ok: false, reason: `arc step does not match event '${e.id}'` };
    }
  } else if (arcStep) {
    return { ok: false, reason: 'ambient event cannot use an arc-step witness' };
  }

  if (!evalCondition(e.conditions, ctx, { arc: arcStep?.instance })) {
    return { ok: false, reason: 'event conditions are not satisfied by this witness world' };
  }

  let fill: SlotFill;
  let playerCast: string[];
  if (arcStep) {
    // dueArcSteps already ran the production binding repair and slot resolver.
    // Re-resolving here could cast different people and would no longer prove
    // the same arc step that the game actually offered.
    fill = arcStep.fill;
    playerCast = arcStep.playerCast;
  } else {
    const slots = resolveSlots(e, ctx, request.rng);
    if (!slots.ok) {
      return { ok: false, reason: `slot '${slots.missing ?? '?'}' cannot be filled` };
    }
    fill = slots.fill;
    playerCast = slots.playerCast;
  }

  if (playerCast.length) {
    if (!request.cast) {
      return {
        ok: false,
        reason: `player cast required for ${playerCast.join(', ')}; supply cast through the production docket witness`,
      };
    }
    if (e.interaction.kind === 'narration') {
      return { ok: false, reason: 'player-cast narration has no choice docket to resolve' };
    }
    if (request.choiceId === undefined) {
      return { ok: false, reason: 'player-cast witness requires choiceId' };
    }

    const decider = e.interaction.decidedBy;
    const party = typeof decider === 'object' && 'party' in decider ? decider.party : undefined;
    if (decider !== 'player' && !party) {
      return { ok: false, reason: 'only player and party deciders put a player cast on the decision docket' };
    }
    if (request.targetPartyChoice && !party) {
      return { ok: false, reason: 'targetPartyChoice requires a party decider' };
    }

    const choice = e.interaction.choices.find((candidate) => candidate.id === request.choiceId);
    if (!choice) return { ok: false, reason: `no choice '${request.choiceId}'` };
    const expected = choice.outcomes.find((candidate) => candidate.id === request.expectedOutcomeId);
    if (!expected) return { ok: false, reason: `choice '${choice.id}' has no outcome '${request.expectedOutcomeId}'` };
    if (choice.check || request.targetChanceChoice || request.targetCheckedOutcome) {
      return {
        ok: false,
        reason: 'player-cast docket witness does not support checked or branch-targeted choices',
      };
    }
    if (request.targetWeightedOutcome) {
      if (expected.weight <= 0) {
        return { ok: false, reason: `outcome '${expected.id}' has no authored weight to target` };
      }
    } else if (choice.outcomes.length !== 1 || choice.outcomes[0]?.id !== request.expectedOutcomeId) {
      return {
        ok: false,
        reason: 'multi-outcome player-cast witness requires targetWeightedOutcome',
      };
    }

    let partyCheck: Check | undefined;
    if (party) {
      partyCheck = e.checks.find((candidate) => candidate.id === party.check);
      if (!partyCheck) {
        return { ok: false, reason: `party decider names missing check '${party.check}'` };
      }
      const castFill: SlotFill = { ...fill };
      for (const slot of playerCast) {
        const supplied = request.cast[slot];
        if (supplied !== undefined) castFill[slot] = supplied;
      }
      const availability = choiceAvailability(choice, ctx, castFill, e);
      if (!availability.available) {
        return { ok: false, reason: availability.blockedBy ?? `choice '${choice.id}' is unavailable` };
      }

      if (request.targetPartyChoice) {
        if (partyCheck.variance === 'none') {
          return { ok: false, reason: 'targetPartyChoice requires a randomised party check' };
        }
        if (!partyCheck.bands.some((band) => band.outcome === request.choiceId)) {
          return {
            ok: false,
            reason: `party check '${partyCheck.id}' has no band for '${request.choiceId}'`,
          };
        }
      } else {
        if (partyCheck.variance !== 'none') {
          return {
            ok: false,
            reason: 'randomised party-cast docket witness requires targetPartyChoice',
          };
        }
        const preview = decideBranch(ctx, e, castFill, request.rng, {
          castReady: true,
          scope: { arc: arcStep?.instance },
        });
        if (preview.choice?.id !== request.choiceId) {
          return {
            ok: false,
            reason: preview.choice
              ? `party decider chose '${preview.choice.id}', not '${request.choiceId}'`
              : preview.why,
          };
        }
      }
    }

    const before = ctx.world.decisionLog.length;
    const pending = queueChoice(ctx, e, e.body, fill, playerCast, arcStep);
    const submittedChoice = decider === 'player' ? request.choiceId : undefined;
    let docketRng = partyCheck && request.targetPartyChoice
      ? targetCheckBandOnceRng(request.rng, ctx, partyCheck, request.choiceId)
      : request.rng;
    if (request.targetWeightedOutcome) {
      docketRng = targetWeightedIdOnceRng(docketRng, request.expectedOutcomeId);
    }
    const resolved = resolveChoice(ctx, pending.id, submittedChoice, docketRng, request.cast);
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason ?? 'production docket refused the witness cast' };
    }
    const logged = ctx.world.decisionLog[ctx.world.decisionLog.length - 1];
    const key = outcomeKey(String(e.id), request.choiceId, request.expectedOutcomeId);
    if (
      ctx.world.decisionLog.length !== before + 1
      || logged?.kind !== 'outcome'
      || outcomeKey(logged.event, logged.choiceId, logged.outcomeId) !== key
    ) {
      return { ok: false, reason: `docket commit path did not record ${key}` };
    }
    return { ok: true, key };
  }

  let choiceId: string | undefined;
  let outcome;
  let outcomeRng = request.targetWeightedOutcome
    ? targetWeightedIdRng(request.rng, request.expectedOutcomeId)
    : request.rng;

  if (e.interaction.kind === 'narration') {
    if (request.targetChanceChoice) {
      return { ok: false, reason: 'narration has no chance branch to target' };
    }
    if (request.choiceId !== undefined) {
      return { ok: false, reason: 'narration has no choice' };
    }
    if (request.targetCheckedOutcome) {
      return { ok: false, reason: 'narration has no checked choice to target' };
    }
    outcome = pickOutcome(e.interaction.outcomes, outcomeRng, ctx, e);
  } else {
    let choice;
    if (e.interaction.decidedBy === 'player') {
      if (request.targetChanceChoice) {
        return { ok: false, reason: 'targetChanceChoice cannot override a player decider' };
      }
      if (request.choiceId === undefined) {
        return { ok: false, reason: 'player-decided witness requires choiceId' };
      }
      choice = e.interaction.choices.find((c) => c.id === request.choiceId);
      if (!choice) return { ok: false, reason: `no choice '${request.choiceId}'` };
    } else {
      let branchRng = request.rng;
      if (request.targetChanceChoice) {
        if (e.interaction.decidedBy !== 'chance') {
          return { ok: false, reason: 'targetChanceChoice requires a chance decider' };
        }
        if (request.choiceId === undefined) {
          return { ok: false, reason: 'targetChanceChoice requires choiceId' };
        }
        branchRng = targetWeightedIdRng(request.rng, request.choiceId);
      }
      const decided = decideBranch(ctx, e, fill, branchRng, { castReady: true, scope: { arc: arcStep?.instance } });
      choice = decided.choice;
      if (!choice) return { ok: false, reason: decided.why };
      if (request.choiceId !== undefined && request.choiceId !== choice.id) {
        return {
          ok: false,
          reason: `automatic decider chose '${choice.id}', not '${request.choiceId}'`,
        };
      }
    }

    const availability = choiceAvailability(choice, ctx, fill, e);
    if (!availability.available) {
      return { ok: false, reason: availability.blockedBy ?? `choice '${choice.id}' is unavailable` };
    }

    choiceId = choice.id;
    if (request.targetCheckedOutcome) {
      if (!choice.check) {
        return { ok: false, reason: `choice '${choice.id}' has no check to target` };
      }
      const check = e.checks.find((candidate) => candidate.id === choice.check);
      if (!check) {
        return { ok: false, reason: `choice '${choice.id}' names missing check '${choice.check}'` };
      }
      if (!check.bands.some((band) => band.outcome === request.expectedOutcomeId)) {
        return {
          ok: false,
          reason: `check '${check.id}' has no band for '${request.expectedOutcomeId}'`,
        };
      }
      outcomeRng = targetCheckedOutcomeRng(outcomeRng, ctx, check, request.expectedOutcomeId);
    }
    outcome = resolveChoiceOutcome(ctx, e, choice, fill, outcomeRng);
  }

  if (outcome.id !== request.expectedOutcomeId) {
    return {
      ok: false,
      reason: `resolved '${outcome.id}', not '${request.expectedOutcomeId}'`,
    };
  }

  const before = ctx.world.decisionLog.length;
  commitOutcome(ctx, e, outcome, fill, choiceId, request.rng, arcStep);
  const logged = ctx.world.decisionLog[ctx.world.decisionLog.length - 1];
  const key = outcomeKey(String(e.id), choiceId, outcome.id);
  if (
    ctx.world.decisionLog.length !== before + 1
    || logged?.kind !== 'outcome'
    || outcomeKey(logged.event, logged.choiceId, logged.outcomeId) !== key
  ) {
    return { ok: false, reason: `commit path did not record ${key}` };
  }

  return { ok: true, key };
}

/**
 * How many of `runs` seeded runs reached each branch at least once.
 *
 * Counted per RUN, not per firing, so a repeatable event that resolves the
 * same way forty times in one run contributes one — the same convention gate 4
 * uses, and the one that makes the number mean "how many players see this".
 */
export interface Reach {
  /** Runs in which each outcome resolved at least once. */
  runs: Map<string, number>;
  /**
   * How many times each CHOICE resolved at all, summed over every run — not
   * per run, because this is the number of CHANCES an outcome under it had,
   * and two firings in one run are two chances (issue #80).
   */
  firings: Map<string, number>;
}

/**
 * Read one finished run's decision log into a running tally.
 *
 * Separated from the batch loop so the batch can be played ONCE and read by
 * more than one gate (issue #64). Gate 4 and gate 8 were bootstrapping the
 * same seeds for the same thousand years and throwing away everything the
 * other one wanted.
 */
export function readRun(ctx: SimCtx, into: Reach): void {
  const here = new Set<string>();
  for (const d of ctx.world.decisionLog) {
    if (d.kind !== 'outcome') continue;
    here.add(outcomeKey(d.event, d.choiceId, d.outcomeId));
    // Every firing, not every run: an event that fires forty times in one
    // run gave its rare outcome forty chances to show, and a denominator
    // that counted that as one would call a healthy branch unprovable.
    const ck = choiceKey(d.event, d.choiceId);
    into.firings.set(ck, (into.firings.get(ck) ?? 0) + 1);
  }
  for (const key of here) into.runs.set(key, (into.runs.get(key) ?? 0) + 1);
}

export function emptyReach(): Reach {
  return { runs: new Map(), firings: new Map() };
}

export function outcomeReach(
  source: ContentBundle | Content,
  runs: number,
  years: number,
): Reach {
  const content = indexContent(source);
  const out = emptyReach();
  for (let i = 0; i < runs; i++) {
    const ctx = bootstrap(content, 5000 + i * 7, 1042);
    runYears(ctx, years);
    readRun(ctx, out);
  }
  return out;
}
