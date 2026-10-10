import {
  MAIN_BRANCH,
  assertNever,
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
import { msg } from './messages.js';
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

/** The name and purpose of one ambition, in the reader's setting. `HOUSE_AMBITIONS` keeps the Originals. */
function ambitionProse(ctx: SimCtx, id: HouseAmbitionId): { name: string; purpose: string } {
  switch (id) {
    case 'deepen_blood':
      return {
        name: msg(ctx, 'ambition.name.deepen_blood', 'Deepen the blood'),
        purpose: msg(ctx, 'ambition.purpose.deepen_blood', 'Keep a broad living bloodline from thinning away.'),
      };
    case 'raise_ascendant':
      return {
        name: msg(ctx, 'ambition.name.raise_ascendant', 'Prepare the ascent'),
        purpose: msg(ctx, 'ambition.purpose.raise_ascendant',
          'Build a named line toward the next serious Ascension rung.'),
      };
    case 'restore_ledger':
      return {
        name: msg(ctx, 'ambition.name.restore_ledger', 'Restore the Ledger'),
        purpose: msg(ctx, 'ambition.purpose.restore_ledger', 'Recover the clauses this campaign can still bring home.'),
      };
    case 'secure_branches':
      return {
        name: msg(ctx, 'ambition.name.secure_branches', 'Secure the branches'),
        purpose: msg(ctx, 'ambition.purpose.secure_branches', 'Keep more than the seat alive as viable family halls.'),
      };
    default:
      return assertNever(id, 'house ambition');
  }
}

export function ambitionOptions(ctx: SimCtx, campaign: CampaignId = ctx.world.campaign): HouseAmbitionOption[] {
  return HOUSE_AMBITIONS.filter((a) => a.campaigns.includes(campaign))
    .map((a) => ({ ...a, ...ambitionProse(ctx, a.id), campaigns: [...a.campaigns] }));
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
        reason: msg(ctx, 'ambition.match.thin_line',
          "{NAME}'s watched line is thin; this hand does not simply add resilience because it reaches outward.",
          { NAME: watchedThin.name }),
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
        reason: outward.lineSeen === 1
          ? msg(ctx, 'ambition.match.outward_one',
            '{NAME} brings an outward line with {COUNT} completed life behind the reading.',
            { NAME: outward.name, COUNT: String(outward.lineSeen) })
          : msg(ctx, 'ambition.match.outward_many',
            '{NAME} brings an outward line with {COUNT} completed lives behind the reading.',
            { NAME: outward.name, COUNT: String(outward.lineSeen) }),
      };
    }

    if (cards.every((card) => card.kind === 'household' || card.kinship >= 0.0625)) {
      return {
        surface: 'match',
        effect: 'endanger',
        reason: msg(ctx, 'ambition.match.close_kin',
          'Every open card folds the living blood back into close kin instead of widening the line.'),
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
        reason: msg(ctx, 'ambition.match.cadet_outward',
          'An outward spouse can join this cadet hall instead of drawing another useful relative out of it.'),
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
          reason: msg(ctx, 'ambition.match.cadet_draw_away',
            '{NAME} is carrying a cadet hall; marrying her into the seat would draw one of its living members away.',
            { NAME: partner.name }),
        };
      }
      if (subject.sex === 'female' && partner.sex === 'male' && partnerBranch !== MAIN_BRANCH) {
        return {
          surface: 'match',
          effect: 'advance',
          reason: msg(ctx, 'ambition.match.cadet_new_household',
            '{NAME} stands in a cadet hall; this marriage can put another household into that branch.',
            { NAME: partner.name }),
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
        reason: msg(ctx, 'ambition.match.programme_kin',
          '{NAME} is in the programme, and this hand contains blood the family papers already join to the line.',
          { NAME: decision.subject.name }),
      };
    }
    if (cards.some((card) => card.kind === 'outsider' && card.kinship === 0)) {
      return {
        surface: 'match',
        effect: 'endanger',
        reason: msg(ctx, 'ambition.match.programme_outward',
          '{NAME} is in the programme, and every open line here is outward in the family papers.',
          { NAME: decision.subject.name }),
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
        reason: msg(ctx, 'ambition.record.clause',
          'This page belongs to an event authored to advance a missing Ledger clause.'),
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
        reason: msg(ctx, 'ambition.record.discrepancy',
          'This page is tied to a named disputed part of the family record the Ledger is already carrying.'),
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
    if (recordMentionedIds(decision).some((id) => programme.has(id))) {
      return {
        surface: 'record',
        effect: 'advance',
        reason: msg(ctx, 'ambition.record.programme',
          'This page includes the Scion, his heir, or the man the house can already see foremost on the ladder.'),
      };
    }
  }

  // #327 names no structural Record signal for blood breadth or cadet halls.
  // Keep those pages quiet rather than infer importance from translated prose;
  // irrelevance is represented by silence, not by a generic ambition warning.
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

function recordMentionedIds(decision: PendingRecord): string[] {
  const record = decision.event.record;
  if (!record) return [];

  // Slot markers are structure embedded in the localisable Record surface:
  // translation may replace every surrounding word, but it must keep
  // {ASCENDANT}/{HEIR}/etc. for interpolation. Read only those markers, then
  // map them through this firing's fill; a person cast elsewhere in the scene
  // is not thereby named on the Record page.
  const visible = [
    record.subject,
    record.options.record.chronicle,
    record.options.embellish.chronicle,
  ];
  const slots = new Set<string>();
  for (const text of visible) {
    for (const match of text.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)) {
      if (match[1]) slots.add(match[1]);
    }
  }

  return [...slots].flatMap((slot) => {
    const value = decision.fill[slot];
    if (value === undefined) return [];
    return typeof value === 'string' ? [value] : value;
  });
}

function choiceRelevance(
  ctx: SimCtx,
  ambition: HouseAmbitionId,
  decision: PendingChoice,
): AmbitionRelevance | undefined {
  const effects = choiceEffects(ctx, decision);
  const readings = effects
    .map((effect) => effectRelevance(ctx, decision, ambition, effect))
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
  ctx: SimCtx,
  decision: PendingChoice,
  ambition: HouseAmbitionId,
  effect: Effect,
): Omit<AmbitionRelevance, 'surface'> | undefined {
  if (ambition === 'restore_ledger') {
    if (effect.kind === 'clause') {
      return { effect: 'advance', reason: msg(ctx, 'ambition.branch.clause',
        'The branch can recover a clause the Ledger is still missing.') };
    }
    if (effect.kind === 'discrepancy') {
      return {
        effect: effect.op === 'create' ? 'endanger' : 'advance',
        reason: effect.op === 'create'
          ? msg(ctx, 'ambition.branch.discrepancy_create',
            'The branch can create a disputed page the Ledger will have to carry.')
          : msg(ctx, 'ambition.branch.discrepancy_answer',
            'The branch can answer a disputed page already in the Ledger.'),
      };
    }
    return undefined;
  }

  if (ambition === 'secure_branches') {
    if (effect.kind === 'branch') {
      return effect.op === 'slight'
        ? { effect: 'endanger', reason: msg(ctx, 'ambition.branch.branch_slight',
          'The branch would leave a cadet hall with another grievance.') }
        : { effect: 'advance', reason: msg(ctx, 'ambition.branch.branch_answer',
          'The branch would answer a cadet hall instead of leaving it to the seat.') };
    }
    if (effect.kind === 'status' && effectTargetsRole(decision, effect, (role) => role === 'cadet')) {
      return { effect: 'endanger', reason: msg(ctx, 'ambition.branch.cadet_status',
        'The branch changes the standing of somebody carrying a cadet hall.') };
    }
    if (
      (effect.kind === 'marriage' || effect.kind === 'priorityMatch')
      && effectTargetsRole(decision, effect, (role) => role === 'cadet')
    ) {
      return { effect: 'advance', reason: msg(ctx, 'ambition.branch.cadet_marriage',
        'The branch opens a marriage path for a cadet hall.') };
    }
    return undefined;
  }

  if (ambition === 'deepen_blood') {
    if (effect.kind === 'priorityMatch') {
      return { effect: 'advance', reason: msg(ctx, 'ambition.branch.priority_match',
        'The branch sends a living member of the line to the marriage market next.') };
    }
    if (effect.kind === 'marriage') {
      return { effect: 'advance', reason: msg(ctx, 'ambition.branch.marriage',
        'The branch reopens a marriage path for a union that cannot carry the line further.') };
    }
    if (
      effect.kind === 'status'
      && /dead|consumed|gone/i.test(effect.status)
      && effectTargetsRole(decision, effect, isBloodRole)
    ) {
      return { effect: 'endanger', reason: msg(ctx, 'ambition.branch.blood_status',
        'The branch removes somebody from the living blood the ambition is trying to keep broad.') };
    }
    if (
      effect.kind === 'rite'
      && effect.subject
      && roleOf(decision, effect.subject) !== undefined
      && isBloodRole(roleOf(decision, effect.subject)!)
    ) {
      return { effect: 'endanger', reason: msg(ctx, 'ambition.branch.blood_rite',
        'The branch spends a member of the living blood on the rite.') };
    }
    return undefined;
  }

  if (ambition === 'raise_ascendant') {
    if (effect.kind === 'rite') {
      return { effect: 'advance', reason: msg(ctx, 'ambition.branch.ladder_rite',
        'The branch performs one of the acts the upper ladder itself requires.') };
    }
    if (effect.kind === 'spellbook') {
      return effect.op === 'lose' || effect.op === 'degrade'
        ? { effect: 'endanger', reason: msg(ctx, 'ambition.branch.spellbook_lose',
          'The branch takes usable learning away from a ladder candidate.') }
        : { effect: 'advance', reason: msg(ctx, 'ambition.branch.spellbook_gain',
          'The branch puts another working into a ladder candidate’s reach.') };
    }
    if (effect.kind === 'tutor') {
      return effect.op === 'cancel'
        ? { effect: 'endanger', reason: msg(ctx, 'ambition.branch.tutor_cancel',
          'The branch cuts short preparation already being given to a ladder candidate.') }
        : { effect: 'advance', reason: msg(ctx, 'ambition.branch.tutor_begin',
          'The branch begins deliberate preparation for a ladder candidate.') };
    }
    if (
      effect.kind === 'madness'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
    ) {
      return effect.delta > 0
        ? { effect: 'endanger', reason: msg(ctx, 'ambition.branch.madness_up',
          'The branch adds Madness to a man already being asked to carry the ascent.') }
        : effect.delta < 0
          ? { effect: 'advance', reason: msg(ctx, 'ambition.branch.madness_down',
            'The branch gives a ladder candidate room to carry the ascent.') }
          : undefined;
    }
    if (
      effect.kind === 'attribute'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
      && effect.delta !== 0
    ) {
      return effect.delta > 0
        ? { effect: 'advance', reason: msg(ctx, 'ambition.branch.attribute_up',
          'The branch strengthens a man the house can already see on the ladder.') }
        : { effect: 'endanger', reason: msg(ctx, 'ambition.branch.attribute_down',
          'The branch weakens a man the house can already see on the ladder.') };
    }
    if (
      effect.kind === 'status'
      && effectTargetsRole(decision, effect, (role) => isLadderRole(role))
    ) {
      return { effect: 'endanger', reason: msg(ctx, 'ambition.branch.ladder_status',
        'The branch changes the standing of a man carrying the ascent.') };
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
  const shown = { ...def, ...ambitionProse(ctx, id) };
  if (id === 'restore_ledger') {
    const target = campaignDef(w.campaign).clauses;
    const current = Math.min(w.clausesRecovered.size, target);
    const missing = { COUNT: String(target - current) };
    return {
      ...shown,
      progress: {
        current, target,
        label: msg(ctx, 'ambition.view.ledger_progress', '{CURRENT} of {TARGET} clauses recovered',
          { CURRENT: String(current), TARGET: String(target) }),
      },
      status: current >= target
        ? msg(ctx, 'ambition.view.ledger_whole', 'The campaign’s recoverable Ledger is whole.')
        : target - current === 1
          ? msg(ctx, 'ambition.view.ledger_missing_one', '{COUNT} clause still missing.', missing)
          : msg(ctx, 'ambition.view.ledger_missing_many', '{COUNT} clauses still missing.', missing),
      next: msg(ctx, 'ambition.view.ledger_next',
        'Follow choices that expose, preserve, or honestly record Ledger evidence.'),
    };
  }

  if (id === 'secure_branches') {
    const viable = [...halls(w, w.year)].filter(([hall, people]) => hall !== MAIN_BRANCH && people.length >= 2).length;
    const target = w.campaign === 'short' ? 1 : 2;
    return {
      ...shown,
      progress: {
        current: viable, target,
        label: msg(ctx, 'ambition.view.branches_progress', '{CURRENT} of {TARGET} viable cadet halls',
          { CURRENT: String(viable), TARGET: String(target) }),
      },
      status: viable >= target
        ? msg(ctx, 'ambition.view.branches_secure', 'The line has somewhere else to continue.')
        : msg(ctx, 'ambition.view.branches_thin', 'The seat is carrying too much of the family alone.'),
      next: msg(ctx, 'ambition.view.branches_next',
        'Protect cadet households and avoid spending every useful marriage on the seat.'),
    };
  }

  if (id === 'deepen_blood') {
    const livingBlood = w.people.living().filter((p) => p.houseOfOrigin === w.playerHouse).length;
    const target = w.campaign === 'short' ? 10 : 14;
    return {
      ...shown,
      progress: {
        current: livingBlood, target,
        label: msg(ctx, 'ambition.view.blood_progress', '{CURRENT} living of the blood; {TARGET} is a resilient line',
          { CURRENT: String(livingBlood), TARGET: String(target) }),
      },
      status: livingBlood >= target
        ? msg(ctx, 'ambition.view.blood_broad', 'The bloodline has room to survive a bad generation.')
        : msg(ctx, 'ambition.view.blood_narrow', 'The living blood is still narrow enough that one loss can matter.'),
      next: msg(
        ctx, 'ambition.view.blood_next',
        'Use marriages and standing orders to keep useful blood in the family without collapsing it into one household.',
      ),
    };
  }

  const measured = measureAscension(ctx);
  const targetRung = w.campaign === 'short' ? 'hierophant' : 'god';
  const current = Math.max(0, RUNG_ORDER.indexOf(w.ascension.rung));
  const target = RUNG_ORDER.indexOf(targetRung);
  const foremost = measured.foremost;
  const rungs = {
    HELD: rungTitle(w.ascension.rung), BEST: rungTitle(w.ascension.best), HORIZON: rungTitle(targetRung),
  };
  return {
    ...shown,
    progress: {
      current,
      target,
      label: w.ascension.best === w.ascension.rung
        ? msg(ctx, 'ambition.view.ascent_progress', '{HELD} held now; {HORIZON} is the campaign horizon', rungs)
        : msg(ctx, 'ambition.view.ascent_progress_fallen',
          '{HELD} held now; {BEST} was reached before; {HORIZON} is the campaign horizon', rungs),
    },
    status: foremost
      ? msg(ctx, 'ambition.view.ascent_foremost', '{NAME} is the foremost candidate.', { NAME: foremost.name })
      : msg(ctx, 'ambition.view.ascent_none', 'No living candidate is carrying the ascent.'),
    next: foremost
      ? msg(ctx, 'ambition.view.ascent_next',
        'Keep {NAME} alive, read, and supplied while answering the blockers shown on the ladder.',
        { NAME: foremost.name })
      : msg(ctx, 'ambition.view.ascent_next_none',
        'Name and prepare a Scion or heir rather than letting the programme choose itself.'),
  };
}
