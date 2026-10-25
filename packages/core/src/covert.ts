import {
  assertNever, CovertAttemptS, CovertDefenceS, CovertDrawsS, CovertGuardCountS, currentMembership,
  type CovertAttempt, type CovertDefence, type CovertDraws, type CovertObservation,
  type CovertPreparation, type CovertRefusal, type CovertResponse, type CovertWarning,
  type Effect, type Person, type StoredSlotFill,
} from '@ed/schema';
import type { SimCtx } from './world.js';
import { resolvePresence } from './presence.js';
import { streamFor } from './rng.js';
import { householdProtection, covertSupport } from './mystic.js';

/**
 * Bounded incident resolution (#1914, part of #1875/#1866).
 *
 * This is a pure engine API, not a session verb or an annual threat generator.
 * It neither spends money nor commits consequences. A threat lifecycle must
 * obtain real payment receipts and explicit attendance before calling it, then
 * read actual paid protection through the shared duty evaluator, and pass the
 * remaining harm through the existing primordial event path. The lifecycle
 * owns custody. No death gate, court reaction, or second whereabouts model
 * lives here.
 */

export function covertPreparationQuote(preparation: CovertPreparation): { crowns: number; years: number } {
  switch (preparation) {
    case 'hasty': return { crowns: 20, years: 1 };
    case 'careful': return { crowns: 45, years: 2 };
    default: return assertNever(preparation, 'covert preparation');
  }
}

export function covertDefenceQuote(guards: number, response: CovertResponse): number {
  CovertGuardCountS.parse(guards);
  switch (response) {
    case 'ordinary': return guards * 8;
    case 'safe_lodging': return guards * 8 + 16;
    case 'escort': return guards * 8 + 12;
    default: return assertNever(response, 'covert response');
  }
}

interface Refused { kind: 'refused'; reason: CovertRefusal }
interface Approach {
  kind: 'approach';
  warning?: CovertWarning;
  support?: string;
}

function freeAdult(ctx: SimCtx, person: Person | undefined): person is Person {
  return person !== undefined && person.status === 'alive'
    && ctx.world.year - person.born >= 16
    && currentMembership(person, ctx.world.year)?.kind !== 'hostage';
}

function mobileAdult(ctx: SimCtx, person: Person | undefined): person is Person {
  return freeAdult(ctx, person) && (person.acquired.health ?? 0) > -20;
}

/** Read the actual CURRENT directed edge; neither the reverse feud nor birth house suffices. */
function hasMotive(ctx: SimCtx, a: CovertAttempt, sponsor: Person, target: Person): boolean {
  const fromHouse = currentMembership(sponsor, ctx.world.year)?.house;
  const toHouse = currentMembership(target, ctx.world.year)?.house;
  return [...ctx.world.relationships.values()].some(r =>
    (r.from === sponsor.id || (fromHouse !== undefined && r.from === fromHouse))
    && (r.to === target.id || (toHouse !== undefined && r.to === toHouse))
    && r.from !== r.to
    && r.grudges.some(g => g.id === a.motive.grudge && g.originYear <= a.preparedAt && g.severity >= 40));
}

/** No draws. A stale actor, stale feud, unpaid preparation or absent party cannot attack. */
function validateAttempt(ctx: SimCtx, a: CovertAttempt, approach = false): CovertRefusal | undefined {
  const w = ctx.world;
  if (w.year !== a.attemptYear && !(approach && w.year === a.attemptYear - 1)) return 'not_due';
  const terms = covertPreparationQuote(a.preparation);
  if (a.attemptYear - a.preparedAt < terms.years) return 'unprepared';
  if (a.paidCrowns < terms.crowns) return 'unpaid';
  const sponsor = w.people.get(a.sponsor);
  const operative = w.people.get(a.operative);
  const target = w.people.get(a.target);
  if (!freeAdult(ctx, sponsor) || a.sponsor === a.target) return 'invalid_sponsor';
  if (!mobileAdult(ctx, operative) || a.operative === a.target
    || currentMembership(operative, w.year)?.house === undefined
    || currentMembership(operative, w.year)?.house !== currentMembership(sponsor, w.year)?.house) return 'invalid_operative';
  if (!target || target.status !== 'alive' || target.becomesGuardian
    || currentMembership(target, w.year)?.kind === 'hostage') return 'invalid_target';
  if (!hasMotive(ctx, a, sponsor, target)) return 'no_motive';
  const attendance = resolvePresence(ctx, a.site, a.bindings).people;
  if (!attendance.includes(target.id) || !attendance.includes(operative.id)) return 'no_opportunity';
  return undefined;
}

function validateGuards(ctx: SimCtx, a: CovertAttempt, guards: string[]): CovertRefusal | undefined {
  if (new Set(guards).size !== guards.length) return 'invalid_guard';
  const attendance = resolvePresence(ctx, a.site, a.bindings).people;
  const targetHouse = currentMembership(ctx.world.people.mustGet(a.target), ctx.world.year)?.house;
  for (const id of guards) {
    const p = ctx.world.people.get(id);
    if (!mobileAdult(ctx, p) || targetHouse === undefined
      || currentMembership(p, ctx.world.year)?.house !== targetHouse || id === a.target
      || id === a.sponsor || id === a.operative || !attendance.includes(id)) return 'invalid_guard';
  }
  return undefined;
}

/** Shared by the paid response quote and the final incident reader. */
export function covertGuardGap(ctx: SimCtx, a: CovertAttempt, guards: string[]): CovertRefusal | undefined {
  return validateGuards(ctx, a, guards);
}

/**
 * One keyed draw per stage. There is no mutable cursor and no dependency on
 * another incident's order, a response, household membership order or a ward.
 */
export function covertDraws(ctx: { world: { seed: number; year: number } }, a: Pick<CovertAttempt, 'id' | 'preparedAt'>): CovertDraws {
  const roll = (stage: keyof CovertDraws) => streamFor(ctx.world, 'covert_attempt', a.id, a.preparedAt, stage).next();
  return {
    warning: roll('warning'), prevention: roll('prevention'), strike: roll('strike'),
    survival: roll('survival'), escape: roll('escape'), evidence: roll('evidence'),
  };
}

function warningFor(ctx: SimCtx, a: CovertAttempt, guards: number, dice: CovertDraws, bonus = 0): CovertWarning | undefined {
  const chance = Math.min(0.9, 0.12 + guards * 0.12 + (a.preparation === 'hasty' ? 0.08 : 0) + bonus);
  if (dice.warning >= chance) return undefined;
  return { occurrence: a.id, year: ctx.world.year, target: a.target, trace: 'observed_approach' };
}

/**
 * Observe before choosing a response. Only a paid, physically present watch
 * contributes. This projection discloses neither the unseen operative nor the
 * sponsor, grievance, probabilities or hidden attendance.
 * Fixed dice are an engine/testing seam, never a player input.
 */
export function observeCovertApproach(
  ctx: SimCtx, attempt: CovertAttempt, watch: Pick<CovertDefence, 'guards' | 'paidCrowns'>,
  draws?: CovertDraws,
): Approach | Refused {
  const pa = CovertAttemptS.safeParse(attempt);
  const pd = CovertDefenceS.safeParse({ ...watch, response: 'ordinary' });
  if (!pa.success || !pd.success) return { kind: 'refused', reason: 'malformed' };
  const a = pa.data;
  const d = pd.data;
  const gap = validateAttempt(ctx, a, true) ?? validateGuards(ctx, a, d.guards);
  if (gap) return { kind: 'refused', reason: gap };
  if (d.paidCrowns < covertDefenceQuote(d.guards.length, 'ordinary')) return { kind: 'refused', reason: 'unpaid' };
  const parsedDraws = CovertDrawsS.safeParse(draws ?? covertDraws(ctx, a));
  if (!parsedDraws.success) return { kind: 'refused', reason: 'malformed' };
  const care = householdProtection(ctx, a.target, a.site, a.bindings).find(c => c.stage === 'warning');
  const warning = warningFor(ctx, a, d.guards.length, parsedDraws.data, care?.bonus);
  return { kind: 'approach', warning,
    ...(warning && care && !warningFor(ctx, a, d.guards.length, parsedDraws.data)
      ? { support: care.assignment.id } : {}) };
}

export interface CovertResolved {
  kind: 'resolved';
  /** Internal facts. Only the explicit observation below belongs in a client view. */
  target: 'unharmed' | 'wounded' | 'dead';
  operative: 'withdrawn' | 'escaped' | 'captured';
  prevented: boolean;
  warned: boolean;
  /**
   * The target's complete NORMAL harm, still uncommitted. D must offer it to
   * primordial assessment before applying it. A captured operative separately
   * needs a custody transition (captureFamily for a family operative); no
   * status string imitates custody.
   */
  normal: { effects: Effect[]; bindings: StoredSlotFill };
  /** Absent when nobody can know a withdrawal or a failed approach occurred. */
  observation?: CovertObservation;
  /** Actual maintainers whose bounded intervention changed a stage's result. */
  support?: { stage: 'warning' | 'prevention' | 'survival'; assignment: string }[];
  offensiveSupport?: string[];
}

/**
 * Resolve a single already-prepared incident. Warning, prevention, a strike,
 * survival, escape and observed identity use independent stage draws. Success
 * does not imply concealment and failure does not imply exposure.
 * `withdraw` belongs to the sponsor's policy, never the defender's response.
 */
export function resolveCovertAttempt(
  ctx: SimCtx, attempt: CovertAttempt, defence: CovertDefence,
  disposition: 'attempt' | 'withdraw' = 'attempt', draws?: CovertDraws,
  knowledge: { forewarned?: boolean } = {},
): CovertResolved | Refused {
  const pa = CovertAttemptS.safeParse(attempt);
  const pd = CovertDefenceS.safeParse(defence);
  if (!pa.success || !pd.success || (disposition !== 'attempt' && disposition !== 'withdraw')) {
    return { kind: 'refused', reason: 'malformed' };
  }
  const a = pa.data;
  const d = pd.data;
  const normal: CovertResolved['normal'] = { effects: [], bindings: { COVERT_TARGET: a.target } };
  // A sponsor may cancel before travelling, or after the opportunity has gone.
  // Cancellation does not buy a warning or knowledge of the unseen defence.
  if (disposition === 'withdraw') {
    return { kind: 'resolved', target: 'unharmed', operative: 'withdrawn', prevented: false, warned: false, normal };
  }
  const gap = validateAttempt(ctx, a) ?? validateGuards(ctx, a, d.guards);
  if (gap) return { kind: 'refused', reason: gap };
  if (d.paidCrowns < covertDefenceQuote(d.guards.length, d.response)) return { kind: 'refused', reason: 'unpaid' };
  const parsedDraws = CovertDrawsS.safeParse(draws ?? covertDraws(ctx, a));
  if (!parsedDraws.success) return { kind: 'refused', reason: 'malformed' };
  const dice = parsedDraws.data;
  const care = householdProtection(ctx, a.target, a.site, a.bindings);
  const bonus = (stage: 'warning' | 'prevention' | 'survival') => care.find(c => c.stage === stage)?.bonus ?? 0;
  const warned = knowledge.forewarned === true || warningFor(ctx, a, d.guards.length, dice, bonus('warning')) !== undefined;
  if (d.response !== 'ordinary' && !warned) return { kind: 'refused', reason: 'no_warning' };
  if (d.response === 'safe_lodging' && !resolvePresence(ctx, a.site, a.bindings).hall) return { kind: 'refused', reason: 'wrong_place' };
  if (d.response === 'escort' && !d.guards.length) return { kind: 'refused', reason: 'invalid_guard' };
  const guards = d.guards.length;
  const shelter = d.response === 'safe_lodging';
  const escort = d.response === 'escort';
  const specialists = covertSupport(ctx, a.site);
  const aid = (role: (typeof specialists)[number]['role']) => specialists.find(c => c.role === role)?.bonus ?? 0;
  const ordinaryPrevention = 0.08 + guards * 0.16 + (shelter ? 0.28 : 0) + (escort ? 0.12 : 0);
  const defendedPrevention = Math.min(0.9, ordinaryPrevention + bonus('prevention'));
  const prevented = dice.prevention < Math.max(0.02, defendedPrevention - aid('breach'));
  const ordinaryStrike = 0.55 + (a.preparation === 'careful' ? 0.1 : 0) - guards * 0.04;
  const struck = !prevented && dice.strike < Math.min(.9, ordinaryStrike + aid('approach') + aid('hostile'));
  const ordinarySurvival = 0.65 + (escort ? 0.08 : 0) - (a.preparation === 'careful' ? 0.06 : 0);
  const defendedSurvival = Math.min(0.95, ordinarySurvival + bonus('survival'));
  const survives = dice.survival < Math.max(.3, defendedSurvival - aid('hostile'));
  const target = !struck ? 'unharmed' : survives ? 'wounded' : 'dead';
  // No guard, no captor. An unobserved retreat cannot create a phantom hostage.
  const ordinaryEscape = 0.75 - guards * 0.14 - (warned ? 0.1 : 0) + (a.preparation === 'careful' ? 0.06 : 0);
  const captured = guards > 0 && dice.escape >= Math.min(.98, ordinaryEscape + aid('escape'));

  if (target === 'dead') normal.effects.push({ kind: 'status', target: { slot: 'COVERT_TARGET' }, status: 'dead', cause: 'covert_attack' });
  if (target === 'wounded') normal.effects.push({ kind: 'attribute', target: { slot: 'COVERT_TARGET' }, attr: 'health', delta: -8 });
  const observation: CovertObservation = {
    occurrence: a.id, year: ctx.world.year, target: a.target,
    result: prevented ? 'prevented' : !struck ? 'missed' : target === 'dead' ? 'dead' : 'wounded', witnesses: [],
  };
  // Traces do not identify a patron. Even custody gives only the operative's
  // identity; later testimony needs an actual evidence source, not this roll.
  const witnesses = [...d.guards, ...(!prevented && target !== 'dead' ? [a.target] : [])].sort();
  const ordinaryEvidence = 0.15 + (warned ? 0.15 : 0) + guards * 0.08;
  if (captured || (witnesses.length > 0 && dice.evidence < Math.max(.02, ordinaryEvidence - aid('approach')))) {
    observation.identifiedOperative = a.operative;
    observation.witnesses = witnesses;
  }
  if (captured) observation.capturedOperative = a.operative;
  const support = care.filter(c => c.stage === 'warning'
    ? !knowledge.forewarned && warned && !warningFor(ctx, a, guards, dice)
    : c.stage === 'prevention' ? prevented && dice.prevention >= Math.max(.02, ordinaryPrevention - aid('breach'))
      && dice.strike < Math.min(.9, ordinaryStrike + aid('approach') + aid('hostile'))
      : struck && survives && dice.survival >= Math.max(.3, ordinarySurvival - aid('hostile')))
    .map(c => ({ stage: c.stage, assignment: c.assignment.id }));
  const offensiveSupport = specialists.filter(c => {
    switch (c.role) {
      case 'breach': return struck && dice.prevention < defendedPrevention;
      case 'escape': return !captured && guards > 0 && dice.escape >= ordinaryEscape;
      case 'hostile': return struck && (dice.strike >= Math.min(.9, ordinaryStrike + aid('approach')) || !survives && dice.survival < defendedSurvival);
      case 'approach': return struck && dice.strike >= Math.min(.9, ordinaryStrike + aid('hostile'))
        || !captured && witnesses.length > 0 && !observation.identifiedOperative && dice.evidence < ordinaryEvidence;
      case 'recovery': return false; // Injury is assessed separately from the victim's fate.
      default: return assertNever(c.role, 'covert support');
    }
  }).map(c => c.assignment.id);
  return {
    kind: 'resolved', target, operative: captured ? 'captured' : 'escaped', prevented, warned, normal,
    // A barrier stopping an unseen approach is not knowledge of an attack.
    observation: warned || !prevented || guards > 0 ? observation : undefined,
    ...(support.length ? { support } : {}),
    ...(offensiveSupport.length ? { offensiveSupport } : {}),
  };
}
