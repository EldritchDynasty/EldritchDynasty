import {
  MAIN_BRANCH,
  RUNG_ORDER,
  isLadderRole,
  type CampaignId,
  type Effect,
  type HouseAmbitionId,
} from '@ed/schema';
import type { SimCtx } from './world.js';
import { branchOf, halls } from './people/branches.js';
import { measureAscension, rungTitle } from './ascension.js';
import { campaignDef } from './campaign.js';
import type { PendingChoice, PendingDecision, PendingMatch, PendingRecord } from './events/decisions.js';

export type AmbitionSurface = 'choice' | 'match' | 'record';
export interface AmbitionRelevance {
  surface: AmbitionSurface;
  effect: 'advance' | 'endanger';
  reason: string;
}
export interface HouseAmbitionView {
  id: HouseAmbitionId;
  name: string;
  purpose: string;
  progress: { current: number; target: number; label: string };
  status: string;
  next: string;
}
export interface HouseAmbitionOption {
  id: HouseAmbitionId;
  name: string;
  purpose: string;
  campaigns: readonly CampaignId[];
}

const BOTH: readonly CampaignId[] = ['short', 'long'];

export const HOUSE_AMBITIONS: readonly HouseAmbitionOption[] = [
  { id: 'deepen_blood', name: 'Deepen the blood', purpose: 'Keep a broad living bloodline from thinning away.', campaigns: BOTH },
  { id: 'raise_ascendant', name: 'Prepare the ascent', purpose: 'Build a named line toward the next serious Ascension rung.', campaigns: BOTH },
  { id: 'restore_ledger', name: 'Restore the Ledger', purpose: 'Recover the clauses this campaign can still bring home.', campaigns: BOTH },
  { id: 'secure_branches', name: 'Secure the branches', purpose: 'Keep more than the seat alive as viable family halls.', campaigns: BOTH },
];

export function ambitionOptions(campaign: CampaignId): HouseAmbitionOption[] {
  return HOUSE_AMBITIONS.filter((a) => a.campaigns.includes(campaign)).map((a) => ({ ...a, campaigns: [...a.campaigns] }));
}

/**
 * A House Ambition is a reading of the world, never another rules layer.
 *
 * This is the same rule for its moment-to-moment relevance: look only at the
 * pending decision the player can already see and at public household facts.
 * Do not inspect a genome, roll a check, predict an outcome, or award progress.
 */
export function ambitionRelevance(ctx: SimCtx, decision: PendingDecision): AmbitionRelevance | undefined {
  const ambition = ctx.world.houseAmbition;
  if (!ambition) return undefined;

  switch (decision.kind) {
    case 'match':
      return matchRelevance(ctx, ambition, decision);
    case 'record':
      return recordRelevance(ctx, ambition, decision);
    case 'choice':
      return choiceRelevance(ctx, ambition, decision);
  }
}

function matchRelevance(
  ctx: SimCtx,
  ambition: HouseAmbitionId,
  decision: PendingMatch,
): AmbitionRelevance | undefined {
  const cards = decision.cards.filter((card) => card.available);
  if (!cards.length) return undefined;

  if (ambition === 'deepen_blood') {
    const watchedThin = cards.find((card) => card.line === 'thin' && card.lineSeen > 0);
    if (watchedThin) {
      return {
        surface: 'match',
        effect: 'endanger',
        reason: `${watchedThin.name}'s watched line is thin; this hand does not simply add resilience because it reaches outward.`,
      };
    }

    const outward = cards.find((card) =>
      card.kind === 'outsider'
      && card.house !== ctx.world.playerHouse
      && card.kinship < 0.0625
      && card.lineSeen > 0);
    if (outward) {
      return {
        surface: 'match',
        effect: 'advance',
        reason: `${outward.name} brings an outward line with ${outward.lineSeen} completed ${outward.lineSeen === 1 ? 'life' : 'lives'} behind the reading.`,
      };
    }

    if (cards.every((card) => card.kind === 'household' || card.kinship >= 0.0625)) {
      return {
        surface: 'match',
        effect: 'endanger',
        reason: 'Every open card folds the living blood back into close kin instead of widening the line.',
      };
    }
    return undefined;
  }

  if (ambition === 'secure_branches') {
    const subject = ctx.world.people.get(decision.subject.id);
    if (!subject) return undefined;
    const subjectBranch = branchOf(ctx.world, subject, ctx.world.year);

    if (subjectBranch !== MAIN_BRANCH && cards.some((card) => card.kind === 'outsider')) {
      return {
        surface: 'match',
        effect: 'advance',
        reason: 'An outward spouse can join this cadet hall instead of drawing another useful relative out of it.',
      };
    }

    for (const card of cards) {
      if (card.kind !== 'household' || !card.person) continue;
      const partner = ctx.world.people.get(card.person);
      if (!partner) continue;
      const partnerBranch = branchOf(ctx.world, partner, ctx.world.year);
      if (subject.sex === 'male' && partner.sex === 'female' && partnerBranch !== MAIN_BRANCH) {
        return {
          surface: 'match',
          effect: 'endanger',
          reason: `${partner.name} is carrying a cadet hall; marrying her into the seat would draw one of its living members away.`,
        };
      }
      if (subject.sex === 'female' && partner.sex === 'male' && partnerBranch !== MAIN_BRANCH) {
        return {
          surface: 'match',
          effect: 'advance',
          reason: `${partner.name} stands in a cadet hall; this marriage can put another household into that branch.`,
        };
      }
    }
    return undefined;
  }

  if (ambition === 'raise_ascendant') {
    const measured = measureAscension(ctx);
    const named = new Set(
      [ctx.world.scion, ctx.world.scionHeir, measured.foremost?.person]
        .filter((id): id is string => Boolean(id)),
    );
    if (!named.has(decision.subject.id)) return undefined;

    const concentrating = cards.find((card) => card.kind === 'household' || card.kinship > 0);
    if (concentrating) {
      return {
        surface: 'match',
        effect: 'advance',
        reason: `${decision.subject.name} is in the programme, and this hand contains blood the family papers already join to the line.`,
      };
    }
    if (cards.some((card) => card.kind === 'outsider' && card.kinship === 0)) {
      return {
        surface: 'match',
        effect: 'endanger',
        reason: `${decision.subject.name} is in the programme, and every open line here is outward in the family papers.`,
      };
    }
  }

  return undefined;
}

function recordRelevance(
  ctx: SimCtx,
  ambition: HouseAmbitionId,
  decision: PendingRecord,
): AmbitionRelevance | undefined {
  // Record prose is localisable player-facing text (#276), so the reader uses
  // the stable structure that authored that page: declared purpose, named
  // Discrepancy gates, and the cast ids rendered into the page. Rewording a
  // subject or Chronicle alternative must never change whether it matters.
  if (ambition === 'restore_ledger') {
    if (decision.event.purposes.includes('advance_clause')) {
      return {
        surface: 'record',
        effect: 'advance',
        reason: 'This page belongs to an event authored to advance a missing Ledger clause.',
      };
    }

    if (
      conditionNamesCarriedDiscrepancy(ctx, decision.event.conditions)
      || decision.options.some((option) =>
        option.discrepancy !== undefined && ctx.world.discrepancies.has(option.discrepancy))
    ) {
      return {
        surface: 'record',
        effect: 'advance',
        reason: 'This page is tied to a named disputed part of the family record the Ledger is already carrying.',
      };
    }
    return undefined;
  }

  if (ambition === 'raise_ascendant') {
    const measured = measureAscension(ctx);
    const programme = new Set(
      [ctx.world.scion, ctx.world.scionHeir, measured.foremost?.person]
        .filter((id): id is string => Boolean(id)),
    );
    if (filledIds(decision).some((id) => programme.has(id))) {
      return {
        surface: 'record',
        effect: 'advance',
        reason: 'This page includes the Scion, his heir, or the man the house can already see foremost on the ladder.',
      };
    }
  }

  // #327 names no structural Record signal for blood breadth or cadet halls.
  // Keep those pages quiet rather than infer importance from translated prose.
  return undefined;
}

type EventCondition = NonNullable<PendingRecord['event']['conditions']>;

function conditionNamesCarriedDiscrepancy(
  ctx: SimCtx,
  condition: EventCondition | undefined,
): boolean {
  if (!condition) return false;
  if ('discrepancy' in condition) return ctx.world.discrepancies.has(condition.discrepancy);
  if ('all' in condition) return condition.all.some((part) => conditionNamesCarriedDiscrepancy(ctx, part));
  if ('any' in condition) return condition.any.some((part) => conditionNamesCarriedDiscrepancy(ctx, part));
  if ('not' in condition) return conditionNamesCarriedDiscrepancy(ctx, condition.not);
  return false;
}

function filledIds(decision: PendingRecord): string[] {
  return Object.values(decision.fill)
    .flatMap((value) => typeof value === 'string' ? [value] : value);
}

function choiceRelevance(
  ctx: SimCtx,
  ambition: HouseAmbitionId,
  decision: PendingChoice,
): AmbitionRelevance | undefined {
  const effects = choiceEffects(ctx, decision);
  const readings = effects
    .map((effect) => effectRelevance(decision, ambition, effect))
    .filter((reading): reading is Omit<AmbitionRelevance, 'surface'> => reading !== undefined);
  if (!readings.length) return undefined;

  // When several open branches touch the ambition, show the risky reading
  // rather than hiding it behind a helpful sibling. A standing delegated answer
  // is narrowed to that exact remembered branch by choiceEffects().
  const reading = readings.find((candidate) => candidate.effect === 'endanger') ?? readings[0]!;
  return { surface: 'choice', ...reading };
}

function choiceEffects(ctx: SimCtx, decision: PendingChoice): Effect[] {
  const interaction = decision.event.interaction;
  if (interaction.kind === 'narration') return [];

  // A first-time open choice has no chosen branch yet. Reading every sibling's
  // outcome here would be an oracle. Delegation is the one place a pending
  // Choice already has a player-authored answer, so only that exact branch may
  // be read — the same branch scope mustSurface has used since #278.
  const remembered = ctx.world.delegation.choices[decision.event.id];
  if (!remembered) return [];
  const choice = interaction.choices.find((candidate) => candidate.id === remembered);
  return choice ? choice.outcomes.flatMap((outcome) => outcome.effects) : [];
}

function effectRelevance(
  decision: PendingChoice,
  ambition: HouseAmbitionId,
  effect: Effect,
): Omit<AmbitionRelevance, 'surface'> | undefined {
  if (ambition === 'restore_ledger') {
    if (effect.kind === 'clause') {
      return { effect: 'advance', reason: 'The branch can recover a clause the Ledger is still missing.' };
    }
    if (effect.kind === 'discrepancy') {
      return {
        effect: effect.op === 'create' ? 'endanger' : 'advance',
        reason: effect.op === 'create'
          ? 'The branch can create a disputed page the Ledger will have to carry.'
          : 'The branch can answer a disputed page already in the Ledger.',
      };
    }
    return undefined;
  }

  if (ambition === 'secure_branches') {
    if (effect.kind === 'branch') {
      return effect.op === 'slight'
        ? { effect: 'endanger', reason: 'The branch would leave a cadet hall with another grievance.' }
        : { effect: 'advance', reason: 'The branch would answer a cadet hall instead of leaving it to the seat.' };
    }
    if (effect.kind === 'status' && effectTargetsRole(decision, effect, (role) => role === 'cadet')) {
      return { effect: 'endanger', reason: 'The branch changes the standing of somebody carrying a cadet hall.' };
    }
    if (
      (effect.kind === 'marriage' || effect.kind === 'priorityMatch')
      && effectTargetsRole(decision, effect, (role) => role === 'cadet')
    ) {
      return { effect: 'advance', reason: 'The branch opens a marriage path for a cadet hall.' };
    }
    return undefined;
  }

  if (ambition === 'deepen_blood') {
    if (effect.kind === 'priorityMatch') {
      return { effect: 'advance', reason: 'The branch sends a living member of the line to the marriage market next.' };
    }
    if (effect.kind === 'marriage') {
      return { effect: 'advance', reason: 'The branch reopens a marriage path for a union that cannot carry the line further.' };
    }
    if (
      effect.kind === 'status'
      && /dead|consumed|gone/i.test(effect.status)
      && effectTargetsRole(decision, effect, isBloodRole)
    ) {
      return { effect: 'endanger', reason: 'The branch removes somebody from the living blood the ambition is trying to keep broad.' };
    }
    if (
      effect.kind === 'rite'
      && effect.subject
      && roleOf(decision, effect.subject) !== undefined
      && isBloodRole(roleOf(decision, effect.subject)!)
    ) {
      return { effect: 'endanger', reason: 'The branch spends a member of the living blood on the rite.' };
    }
    return undefined;
  }

  if (ambition === 'raise_ascendant') {
    if (effect.kind === 'rite') {
      return { effect: 'advance', reason: 'The branch performs one of the acts the upper ladder itself requires.' };
    }
    if (effect.kind === 'spellbook') {
      return effect.op === 'lose' || effect.op === 'degrade'
        ? { effect: 'endanger', reason: 'The branch takes usable learning away from a ladder candidate.' }
        : { effect: 'advance', reason: 'The branch puts another working into a ladder candidate’s reach.' };
    }
    if (effect.kind === 'tutor') {
      return effect.op === 'cancel'
        ? { effect: 'endanger', reason: 'The branch cuts short preparation already being given to a ladder candidate.' }
        : { effect: 'advance', reason: 'The branch begins deliberate preparation for a ladder candidate.' };
    }
    if (
      effect.kind === 'madness'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
    ) {
      return effect.delta > 0
        ? { effect: 'endanger', reason: 'The branch adds Madness to a man already being asked to carry the ascent.' }
        : effect.delta < 0
          ? { effect: 'advance', reason: 'The branch gives a ladder candidate room to carry the ascent.' }
          : undefined;
    }
    if (
      effect.kind === 'attribute'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
      && effect.delta !== 0
    ) {
      return effect.delta > 0
        ? { effect: 'advance', reason: 'The branch strengthens a man the house can already see on the ladder.' }
        : { effect: 'endanger', reason: 'The branch weakens a man the house can already see on the ladder.' };
    }
    if (
      effect.kind === 'status'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
    ) {
      return { effect: 'endanger', reason: 'The branch changes the standing of a man carrying the ascent.' };
    }
  }

  return undefined;
}

function roleOf(decision: PendingChoice, slot: string): string | undefined {
  return decision.event.slots[slot]?.role;
}

function effectTargetsRole(
  decision: PendingChoice,
  effect: Effect,
  predicate: (role: string) => boolean,
): boolean {
  if (!('target' in effect)) return false;
  const target = effect.target;
  if (typeof target === 'string') {
    if (target === 'all_blood' || target === 'children_of_head') return predicate('family_member');
    if (target === 'head') return predicate('head');
    if (target === 'household') return predicate('family_member');
    return false;
  }
  const slot = 'slot' in target ? target.slot : target.all;
  const role = roleOf(decision, slot);
  return role !== undefined && predicate(role);
}

function isBloodRole(role: string): boolean {
  return [
    'head',
    'family_member',
    'spouse',
    'child',
    'sibling',
    'cadet',
    'heirloom',
    'foremost',
    'second_foremost',
    'sole_heir_unwed',
    'sole_heir_spent',
    'listener_blood',
  ].includes(role);
}

export function ambitionView(ctx: SimCtx): HouseAmbitionView | undefined {
  const id = ctx.world.houseAmbition;
  if (!id) return undefined;
  const def = HOUSE_AMBITIONS.find((a) => a.id === id);
  if (!def || !def.campaigns.includes(ctx.world.campaign)) return undefined;

  const w = ctx.world;
  if (id === 'restore_ledger') {
    const target = campaignDef(w.campaign).clauses;
    const current = Math.min(w.clausesRecovered.size, target);
    return {
      ...def,
      progress: { current, target, label: `${current} of ${target} clauses recovered` },
      status: current >= target ? 'The campaign’s recoverable Ledger is whole.' : `${target - current} clause${target - current === 1 ? '' : 's'} still missing.`,
      next: 'Follow choices that expose, preserve, or honestly record Ledger evidence.',
    };
  }

  if (id === 'secure_branches') {
    const viable = [...halls(w, w.year)].filter(([hall, people]) => hall !== MAIN_BRANCH && people.length >= 2).length;
    const target = w.campaign === 'short' ? 1 : 2;
    return {
      ...def,
      progress: { current: viable, target, label: `${viable} of ${target} viable cadet halls` },
      status: viable >= target ? 'The line has somewhere else to continue.' : 'The seat is carrying too much of the family alone.',
      next: 'Protect cadet households and avoid spending every useful marriage on the seat.',
    };
  }

  if (id === 'deepen_blood') {
    const livingBlood = w.people.living().filter((p) => p.houseOfOrigin === w.playerHouse).length;
    const target = w.campaign === 'short' ? 10 : 14;
    return {
      ...def,
      progress: { current: livingBlood, target, label: `${livingBlood} living of the blood; ${target} is a resilient line` },
      status: livingBlood >= target ? 'The bloodline has room to survive a bad generation.' : 'The living blood is still narrow enough that one loss can matter.',
      next: 'Use marriages and standing orders to keep useful blood in the family without collapsing it into one household.',
    };
  }

  const measured = measureAscension(ctx);
  const targetRung = w.campaign === 'short' ? 'hierophant' : 'god';
  const current = Math.max(0, RUNG_ORDER.indexOf(w.ascension.rung));
  const target = RUNG_ORDER.indexOf(targetRung);
  const foremost = measured.foremost;
  const highWater = w.ascension.best === w.ascension.rung
    ? ''
    : `; ${rungTitle(w.ascension.best)} was reached before`;
  return {
    ...def,
    progress: {
      current,
      target,
      label: `${rungTitle(w.ascension.rung)} held now${highWater}; ${rungTitle(targetRung)} is the campaign horizon`,
    },
    status: foremost ? `${foremost.name} is the foremost candidate.` : 'No living candidate is carrying the ascent.',
    next: foremost
      ? `Keep ${foremost.name} alive, read, and supplied while answering the blockers shown on the ladder.`
      : 'Name and prepare a Scion or heir rather than letting the programme choose itself.',
  };
}
