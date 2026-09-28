import type { Person } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { PendingDecision } from './events/decisions.js';
import type { MatchCard } from './people/match.js';

/**
 * A PERSON'S ADVICE, NOT THE ENGINE'S ANSWER (issue #215).
 *
 * This module is deliberately an epistemic cul-de-sac. It receives people,
 * careers, household roles and the already-player-visible decision read model.
 * It does not import genetics, Bearing, RNG, checks, outcome weights or
 * availability internals. If advice needs a fact that is not on those public
 * values, the adviser does not know it.
 */
export type AdviserLens =
  | 'priest' | 'broker' | 'steward' | 'soldier' | 'reader' | 'old_head' | 'close_kin';

export type AdviceSurface = 'match' | 'record' | 'rite' | 'choice';

export interface AdviserAdvice {
  adviser: { id: string; name: string };
  lens: AdviserLens;
  /** Why this person has a stake; drawn beside the name so bias is visible. */
  cares: string;
  /** Concise attributed counsel. A position, never a score or probability. */
  position: string;
}

interface Adviser {
  person: Person;
  lens: AdviserLens;
  cares: string;
  relevance: number;
}

const SURFACE_LENS: Record<AdviceSurface, AdviserLens[]> = {
  match: ['broker', 'steward', 'reader', 'close_kin', 'old_head', 'priest', 'soldier'],
  record: ['reader', 'priest', 'old_head', 'broker', 'steward', 'close_kin', 'soldier'],
  rite: ['priest', 'reader', 'old_head', 'close_kin', 'soldier', 'steward', 'broker'],
  choice: ['old_head', 'close_kin', 'steward', 'reader', 'priest', 'soldier', 'broker'],
};

function eventHasRite(d: Extract<PendingDecision, { kind: 'choice' }>): boolean {
  const interaction = d.event.interaction;
  const outcomes = interaction.kind === 'narration'
    ? interaction.outcomes
    : interaction.choices.flatMap((choice) => choice.outcomes);
  return outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'rite'));
}

function surfaceOf(d: PendingDecision): AdviceSurface {
  if (d.kind === 'match') return 'match';
  if (d.kind === 'record') return 'record';
  return eventHasRite(d) ? 'rite' : 'choice';
}

function lensOf(ctx: SimCtx, p: Person): { lens: AdviserLens; cares: string } | undefined {
  const role = p.contract?.role;
  const subject = p.sex === 'female' ? 'she' : 'he';
  const possessive = p.sex === 'female' ? 'her' : 'his';
  if (p.career?.career === 'clergy') return { lens: 'priest', cares: `the Church is the institution ${subject} serves` };
  if (p.career?.career === 'merchant' || p.career?.career === 'factor' || p.career?.career === 'court') {
    return { lens: 'broker', cares: `${possessive} post is made of bargains, standing and other houses` };
  }
  if (role === 'steward') return { lens: 'steward', cares: `${subject} keeps the house and its accounts` };
  if (p.career?.career === 'military' || role === 'guard') {
    return { lens: 'soldier', cares: `${possessive} work prices risk in bodies` };
  }
  if (p.career?.career === 'scholar' || role === 'archivist' || role === 'chronicler' || role === 'tutor') {
    return { lens: 'reader', cares: `${subject} lives by what can be read, remembered and proved` };
  }
  if (ctx.world.succession.some((held) => held.person === p.id && held.to !== undefined)) {
    return { lens: 'old_head', cares: `${subject} has held the seal before` };
  }
  const member = p.membership.find((m) =>
    m.house === ctx.world.playerHouse && m.from <= ctx.world.year && (m.to === undefined || m.to > ctx.world.year));
  if (member?.kind === 'blood' || member?.kind === 'married_in') {
    return { lens: 'close_kin', cares: `this is ${possessive} own living house` };
  }
  return undefined;
}

function relatedBonus(ctx: SimCtx, p: Person, d: PendingDecision): number {
  if (d.kind !== 'match') return 0;
  if (d.subject.id === p.id) return 6;
  const subject = ctx.world.people.get(d.subject.id);
  if (!subject) return 0;
  if (subject.claimedParents.mother === p.id || subject.claimedParents.father === p.id) return 4;
  if (p.marriages.some((m) => m.spouse === subject.id)) return 4;
  return 0;
}

function advisers(ctx: SimCtx, d: PendingDecision): Adviser[] {
  const surface = surfaceOf(d);
  const order = SURFACE_LENS[surface];
  return ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .filter((p) => p.status === 'alive' && ctx.world.year - p.born >= 15)
    .flatMap((person) => {
      const found = lensOf(ctx, person);
      if (!found) return [];
      const domain = Math.max(0, order.length - order.indexOf(found.lens));
      return [{ person, ...found, relevance: domain + relatedBonus(ctx, person, d) }];
    })
    .sort((a, b) => b.relevance - a.relevance || b.person.born - a.person.born || a.person.id.localeCompare(b.person.id));
}

function evidenceCount(card: MatchCard): number {
  return card.lineSeen + card.panel.issue.length + card.panel.woken.length
    + card.panel.said.length + card.panel.ourBook.length;
}

function matchPosition(lens: AdviserLens, cards: MatchCard[]): string {
  const open = cards.filter((c) => c.available);
  if (!open.length) return 'None of these names is still a marriage the house can make.';
  let card = open[0]!;
  if (lens === 'steward' || lens === 'broker') {
    card = [...open].sort((a, b) => a.dowry - b.dowry || evidenceCount(b) - evidenceCount(a))[0]!;
    return `I would take ${card.name}. ${card.dowry} crowns is the part of this bargain the account book can prove today.`;
  }
  if (lens === 'reader') {
    card = [...open].sort((a, b) => evidenceCount(b) - evidenceCount(a) || b.lineSeen - a.lineSeen)[0]!;
    return `I would take ${card.name}. There is more written and witnessed around that line than the others.`;
  }
  if (lens === 'priest') {
    card = [...open].sort((a, b) => a.kinship - b.kinship || a.dowry - b.dowry)[0]!;
    return `I would take ${card.name}. Of these matches, the family papers put the greatest distance between the two lines there.`;
  }
  if (lens === 'soldier') {
    const grown = (c: MatchCard) => c.panel.issue.reduce((n, r) => n + r.grown, 0);
    card = [...open].sort((a, b) => grown(b) - grown(a) || b.lineSeen - a.lineSeen)[0]!;
    return `I would take ${card.name}. The lives we have actually watched in that line are the evidence I trust.`;
  }
  card = [...open].sort((a, b) => b.kinship - a.kinship || evidenceCount(b) - evidenceCount(a))[0]!;
  return `I would take ${card.name}. The papers keep that blood nearest the house, and I would not pretend that is a neutral reason.`;
}

function recordPosition(lens: AdviserLens, d: Extract<PendingDecision, { kind: 'record' }>): string {
  const offered = new Set(d.options.map((o) => o.option));
  if (lens === 'reader' && offered.has('record')) return 'Write it as it happened. A page we can rely on later is worth more to me than a cleaner one now.';
  if ((lens === 'broker' || lens === 'old_head') && offered.has('embellish')) return 'Improve it. Other houses deal with the name they have heard, not the private truth behind it.';
  if (lens === 'priest' && offered.has('omit')) return 'Leave it out. Not every true thing belongs in a book another institution may one day read.';
  if (offered.has('record')) return 'Write it plainly. I would rather the house remember what it chose.';
  return 'Use the least boastful version the chronicler is offering.';
}

function choicePosition(lens: AdviserLens, d: Extract<PendingDecision, { kind: 'choice' }>, surface: AdviceSurface): string {
  const open = d.choices.filter((c) => c.available);
  if (!open.length) return 'I see no course on this page the house can actually take.';
  const first = open[0]!;
  const last = open[open.length - 1]!;
  if (surface === 'rite') {
    if (lens === 'priest') return `I would choose “${first.label}”. With a rite, caution is not ignorance; it is the only part we control.`;
    if (lens === 'reader') return `I would choose “${last.label}”. I am weighing the words and precedents we have, not what the rite may secretly do.`;
  }
  if (lens === 'steward' || lens === 'old_head') return `I favour “${first.label}”. It is the course I can defend from what is on the table now.`;
  if (lens === 'reader') return `I favour “${last.label}”. The written case for it is the one I would want left in the book.`;
  return `I favour “${first.label}”. That is my interest speaking; I know no more than this page says.`;
}

/** Build one or two current, named, deliberately biased advisers for a decision. */
export function adviceForDecision(ctx: SimCtx, d: PendingDecision): AdviserAdvice[] {
  const surface = surfaceOf(d);
  const picked = advisers(ctx, d).slice(0, 2);
  return picked.map(({ person, lens, cares }) => ({
    adviser: { id: person.id, name: person.name },
    lens,
    cares,
    position: d.kind === 'match'
      ? matchPosition(lens, d.cards)
      : d.kind === 'record'
        ? recordPosition(lens, d)
        : choicePosition(lens, d, surface),
  }));
}
