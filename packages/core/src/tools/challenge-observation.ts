import { ALL_AFFINITIES, assertNever, canLearn, type AffinityName, type Check, type Person } from '@ed/schema';
import type { OutcomeObservation } from '../events/decisions.js';
import { checkReading } from '../events/checks.js';
import { evalFilter } from '../events/conditions.js';
import { influencedAttr } from '../events/influence.js';
import { resolveTargets } from '../events/effects.js';
import { castPeople, renderBody } from '../events/slots.js';
import { expressAttributes } from '../genetics/expression.js';
import { genomeOf } from '../people/factory.js';
import { knowsAffinity } from '../people/library.js';
import { PersonStore } from '../people/store.js';
import type { MatchCard } from '../people/match.js';
import type { SessionView } from '../session.js';
import type { SimCtx } from '../world.js';

export const CHALLENGE_FAILURES = ['no_eligible_relative', 'insufficient_ability',
  'missing_affinity_breadth', 'missing_learned_knowledge', 'variance', 'other'] as const;
export type ChallengeFailure = (typeof CHALLENGE_FAILURES)[number];

export interface ChallengeObservation {
  year: number;
  event: string;
  choice?: string;
  outcome: string;
  check: string;
  pool: Check['pool']['kind'];
  score: number;
  bonus: number;
  difficulty: number;
  passed: boolean;
  cause?: ChallengeFailure;
  participants: { person: string; name: string }[];
  affinity?: { name: string; inherited: number; capable: number; learned: number; awake: number };
  treasury: number;
  respect: number;
  health: { person: string; name: string; delta: number }[];
  chronicle: string;
}

/** Only the pool's people are copied. Realising a lazy genome or cache on a
 * diagnostic copy must not change even the representation of the saved run. */
function readContext(ctx: SimCtx, observation: OutcomeObservation): SimCtx {
  const people = new PersonStore();
  const selected = new Map(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).map((p) => [p.id, p]));
  for (const ids of Object.values(observation.fill)) {
    for (const id of typeof ids === 'string' ? [ids] : ids) {
      const person = ctx.world.people.get(id);
      if (person) selected.set(person.id, person);
    }
  }
  for (const person of selected.values()) people.add(structuredClone(person));
  return { ...ctx, world: { ...ctx.world, people }, observeOutcome: undefined };
}

function checkFor(observation: OutcomeObservation): { check: Check; key: string } | undefined {
  const { event, choiceId, outcome } = observation;
  if (event.interaction.kind === 'narration') return undefined;
  const choice = event.interaction.choices.find((candidate) => candidate.id === choiceId);
  if (choice?.check) {
    const check = event.checks.find((candidate) => candidate.id === choice.check);
    if (check) return { check, key: outcome.id };
  }
  const decider = event.interaction.decidedBy;
  if (typeof decider === 'object' && 'party' in decider) {
    const check = event.checks.find((candidate) => candidate.id === decider.party.check);
    if (check && choiceId) return { check, key: choiceId };
  }
  return undefined;
}

export function observeFamilyChallenge(ctx: SimCtx, observation: OutcomeObservation): ChallengeObservation | undefined {
  if (!observation.event.tags.includes('family_challenge')) return undefined;
  const checked = checkFor(observation);
  if (!checked) return undefined; // The purchased preparation branch is not a check.
  const { check, key } = checked;
  const band = check.bands.find((candidate) => candidate.outcome === key);
  if (!band) throw new Error(`No observed check band for ${observation.event.id}/${check.id}/${key}`);
  const probe = readContext(ctx, observation);
  const family = probe.world.people.household(probe.world.playerHouse, probe.world.year);
  const pool = check.pool;
  const { score, bonus, difficulty } = checkReading(probe, check, observation.event, observation.fill);
  const passed = band.atLeast >= 0;
  let participants: Person[];
  let affinityName: string | undefined;
  let candidates = family;
  switch (pool.kind) {
    case 'family_knows':
      affinityName = pool.affinity;
      participants = family.filter((p) => knowsAffinity(probe, p, pool.affinity));
      break;
    case 'slot': {
      participants = castPeople(observation.fill, pool.slot, probe);
      const slot = observation.event.slots[pool.slot];
      const knowledge = slot?.filters.find((filter) => 'knows' in filter);
      if (knowledge && 'knows' in knowledge) {
        affinityName = knowledge.knows.affinity;
        candidates = family.filter((p) => slot!.filters.filter((filter) => !('knows' in filter))
          .every((filter) => evalFilter(filter, p, probe, observation.fill)));
      }
      break;
    }
    case 'party_sum': participants = pool.slots.flatMap((slot) => castPeople(observation.fill, slot, probe)); break;
    case 'family_sum':
    case 'family_max': participants = family; break;
    case 'family_any':
      participants = family;
      if ((ALL_AFFINITIES as readonly string[]).includes(pool.attr)) affinityName = pool.attr;
      break;
    case 'record': participants = []; break;
    default: return assertNever(pool);
  }

  let affinity: ChallengeObservation['affinity'];
  if (affinityName) {
    const name = affinityName;
    const books = probe.content.spellbooks.filter((book) => book.affinity === name);
    const eligible = candidates.filter((p) => canLearn(p.sex, name));
    const capable = eligible.filter((p) => books.some((book) =>
      influencedAttr(probe, p, name) >= book.threshold));
    affinity = {
      name,
      inherited: eligible.filter((p) => (expressAttributes(genomeOf(p, probe.genetics), p.sex,
        probe.genetics.table, probe.content.attributes, { awakened: p.awakening.awakened }).get(name) ?? 0) > 0).length,
      capable: capable.length,
      learned: candidates.filter((p) => knowsAffinity(probe, p, name)).length,
      awake: capable.filter((p) => p.awakening.awakened).length,
    };
  }
  let cause: ChallengeFailure | undefined;
  if (!passed) {
    if (affinity && !participants.length) {
      if (!candidates.some((p) => canLearn(p.sex, affinity!.name))) cause = 'no_eligible_relative';
      else if (!affinity.capable) cause = 'missing_affinity_breadth';
      else if (!affinity.learned) cause = 'missing_learned_knowledge';
      else cause = 'other';
    } else if (!participants.length && pool.kind !== 'record') cause = 'no_eligible_relative';
    else if (score + bonus >= difficulty) cause = 'variance';
    else cause = pool.kind === 'record' ? 'other' : 'insufficient_ability';
  }
  const health = observation.outcome.effects.flatMap((effect) => effect.kind === 'attribute' && effect.attr === 'health'
    ? resolveTargets(effect.target, probe, observation.fill).map((person) => ({ person: person.id, name: person.name, delta: effect.delta })) : []);
  return {
    year: ctx.world.year, event: observation.event.id,
    ...(observation.choiceId ? { choice: observation.choiceId } : {}), outcome: observation.outcome.id,
    check: check.id, pool: pool.kind, score, bonus, difficulty, passed,
    ...(cause ? { cause } : {}),
    participants: participants.map((p) => ({ person: p.id, name: p.name })),
    ...(affinity ? { affinity } : {}),
    treasury: observation.outcome.effects.reduce((sum, effect) => sum + (effect.kind === 'treasury' ? effect.delta : 0), 0),
    respect: observation.outcome.effects.reduce((sum, effect) => sum + (effect.kind === 'respect' ? effect.delta : 0), 0),
    health,
    chronicle: renderBody(observation.outcome.text, observation.fill, probe),
  };
}

/** A measurement policy sees only what the family's recorded tree shows.
 * Outsider recipes and unclaimed attribute values are deliberately unread. */
export function recordedAffinityScore(view: Pick<SessionView, 'halls'>, card: Pick<MatchCard, 'person'>, focus: readonly AffinityName[]): number {
  const members = view.halls.flatMap((hall) => hall.members);
  const subject = members.find((member) => member.id === card.person);
  if (!subject) return 0;
  const parents = Object.values(subject.record.parents).filter((parent) => parent !== undefined);
  const line = members.filter((member) => member.id === subject.id || parents.includes(member.id)
    || Object.values(member.record.parents).some((parent) => parents.includes(parent)));
  return line.reduce((sum, member) => sum + focus.reduce((score, affinity) => score
    + (member.record.claimed.includes(affinity) ? Math.max(0, member.record.attrs[affinity] ?? 0) : 0), 0), 0);
}
