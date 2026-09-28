import { assertNever, type Person } from '@ed/schema';
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
  | 'priest' | 'broker' | 'steward' | 'soldier' | 'reader'
  | 'mother' | 'midwife' | 'old_head' | 'close_kin';

export type AdviceSurface = 'match' | 'record' | 'rite' | 'choice';
export type HelpSurface = 'tree' | 'chronicle' | 'branches';
export type HelpTier = 1 | 2 | 3;
type AdviserSurface = AdviceSurface | HelpSurface;

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

const SURFACE_LENS: Record<AdviserSurface, AdviserLens[]> = {
  match: ['mother', 'midwife', 'broker', 'steward', 'reader', 'close_kin', 'old_head', 'priest', 'soldier'],
  record: ['reader', 'priest', 'old_head', 'broker', 'steward', 'close_kin', 'soldier', 'midwife', 'mother'],
  rite: ['priest', 'reader', 'old_head', 'close_kin', 'soldier', 'steward', 'broker', 'midwife', 'mother'],
  choice: ['old_head', 'close_kin', 'steward', 'reader', 'priest', 'soldier', 'broker', 'midwife', 'mother'],
  tree: ['reader', 'old_head', 'close_kin', 'steward', 'priest', 'broker', 'soldier', 'midwife', 'mother'],
  chronicle: ['reader', 'old_head', 'priest', 'broker', 'close_kin', 'steward', 'soldier', 'midwife', 'mother'],
  branches: ['old_head', 'steward', 'broker', 'close_kin', 'reader', 'priest', 'soldier', 'midwife', 'mother'],
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

function widowOfHead(ctx: SimCtx, p: Person): boolean {
  return p.marriages.some((marriage) => {
    const spouse = ctx.world.people.get(marriage.spouse);
    return spouse?.status === 'dead'
      && ctx.world.succession.some((held) => held.person === spouse.id);
  });
}

function lensOf(
  ctx: SimCtx,
  p: Person,
  d?: PendingDecision,
): { lens: AdviserLens; cares: string } | undefined {
  const role = p.contract?.role;
  const subject = p.sex === 'female' ? 'she' : 'he';
  const possessive = p.sex === 'female' ? 'her' : 'his';

  if (d?.kind === 'match') {
    const matched = ctx.world.people.get(d.subject.id);
    if (matched?.claimedParents.mother === p.id) {
      return { lens: 'mother', cares: 'her child is the one who must live inside this bargain' };
    }
    if (role === 'midwife') {
      return { lens: 'midwife', cares: `${subject} has watched this house count births, losses and grown children` };
    }
  }

  const heldSeal = ctx.world.succession.some((held) => held.person === p.id && held.to !== undefined);
  const regent = p.sex === 'female' && p.castSlots.includes('head');
  if (heldSeal || regent || widowOfHead(ctx, p)) {
    const cares = heldSeal
      ? `${subject} has held the seal before`
      : regent
        ? 'she holds the seal because the house has no waking son to hold it'
        : 'her husband held the seal, and she lived through what it cost the household';
    return { lens: 'old_head', cares };
  }

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

  const member = p.membership.find((m) =>
    m.house === ctx.world.playerHouse && m.from <= ctx.world.year && (m.to === undefined || m.to > ctx.world.year));
  if (member?.kind === 'blood' || member?.kind === 'married_in') {
    return { lens: 'close_kin', cares: `this is ${possessive} own living house` };
  }
  return undefined;
}

function relatedBonus(ctx: SimCtx, p: Person, d?: PendingDecision): number {
  if (d?.kind !== 'match') return 0;
  if (d.subject.id === p.id) return 6;
  const subject = ctx.world.people.get(d.subject.id);
  if (!subject) return 0;
  if (subject.claimedParents.mother === p.id || subject.claimedParents.father === p.id) return 4;
  if (p.marriages.some((m) => m.spouse === subject.id)) return 4;
  return 0;
}

function helpSubjectBonus(ctx: SimCtx, p: Person, surface: AdviserSurface, subject?: string): number {
  if (surface !== 'tree' || !subject) return 0;
  const target = ctx.world.people.get(subject);
  if (!target) return 0;
  if (target.claimedParents.mother === p.id || target.claimedParents.father === p.id) return 4;
  if (p.marriages.some((m) => m.spouse === target.id)) return 4;
  return 0;
}

function advisers(
  ctx: SimCtx,
  surface: AdviserSurface,
  d?: PendingDecision,
  subject?: string,
): Adviser[] {
  const order = SURFACE_LENS[surface];
  return ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .filter((p) => p.status === 'alive' && ctx.world.year - p.born >= 15)
    .flatMap((person) => {
      const found = lensOf(ctx, person, d);
      if (!found) return [];
      const rank = order.indexOf(found.lens);
      const domain = rank < 0 ? 0 : order.length - rank;
      return [{
        person,
        ...found,
        relevance: domain + relatedBonus(ctx, person, d) + helpSubjectBonus(ctx, person, surface, subject),
      }];
    })
    .sort((a, b) => b.relevance - a.relevance || b.person.born - a.person.born || a.person.id.localeCompare(b.person.id));
}

function evidenceCount(card: MatchCard): number {
  return card.lineSeen + card.panel.issue.length + card.panel.woken.length
    + card.panel.said.length + card.panel.ourBook.length;
}

function matchPosition(
  lens: AdviserLens,
  d: Extract<PendingDecision, { kind: 'match' }>,
): string {
  const open = d.cards.filter((c) => c.available);
  if (!open.length) return 'None of these names is still a marriage the house can make.';

  switch (lens) {
    case 'steward':
    case 'broker': {
      const card = [...open].sort((a, b) => a.dowry - b.dowry || evidenceCount(b) - evidenceCount(a))[0]!;
      return `I would take ${card.name}. ${card.dowry} crowns is the part of this bargain the account book can prove today.`;
    }
    case 'reader': {
      const card = [...open].sort((a, b) => evidenceCount(b) - evidenceCount(a) || b.lineSeen - a.lineSeen)[0]!;
      return `I would take ${card.name}. There is more written and witnessed around that line than the others.`;
    }
    case 'priest': {
      const card = [...open].sort((a, b) => a.kinship - b.kinship || a.dowry - b.dowry)[0]!;
      return `I would take ${card.name}. Of these matches, the family papers put the greatest distance between the two lines there.`;
    }
    case 'soldier': {
      const grown = (c: MatchCard) => c.panel.issue.reduce((n, r) => n + r.grown, 0);
      const card = [...open].sort((a, b) => grown(b) - grown(a) || b.lineSeen - a.lineSeen)[0]!;
      return `I would take ${card.name}. The lives we have actually watched in that line are the evidence I trust.`;
    }
    case 'mother': {
      const card = [...open].sort((a, b) =>
        Math.abs(a.age - d.subject.age) - Math.abs(b.age - d.subject.age)
        || evidenceCount(b) - evidenceCount(a))[0]!;
      return `I would take ${card.name}. Of these names, that one is nearest my child's age. I am thinking about the years after the bargain.`;
    }
    case 'midwife': {
      const issue = (c: MatchCard) => c.panel.issue.reduce((n, r) => n + r.borne + r.grown, 0);
      const card = [...open].sort((a, b) => issue(b) - issue(a) || b.lineSeen - a.lineSeen)[0]!;
      return `I would take ${card.name}. That line has the strongest witnessed birth history behind it. I trust the lives we have counted more than a market word.`;
    }
    case 'old_head':
    case 'close_kin': {
      const card = [...open].sort((a, b) => b.kinship - a.kinship || evidenceCount(b) - evidenceCount(a))[0]!;
      return `I would take ${card.name}. The papers keep that blood nearest the house, and I would not pretend that is a neutral reason.`;
    }
    default:
      return assertNever(lens, 'adviser lens');
  }
}

function recordPosition(lens: AdviserLens, d: Extract<PendingDecision, { kind: 'record' }>): string {
  const offered = new Set(d.options.map((o) => o.option));
  switch (lens) {
    case 'reader':
      if (offered.has('record')) return 'Write it as it happened. A page we can rely on later is worth more to me than a cleaner one now.';
      break;
    case 'broker':
    case 'old_head':
      if (offered.has('embellish')) return 'Improve it. Other houses deal with the name they have heard, not the private truth behind it.';
      break;
    case 'priest':
      if (offered.has('omit')) return 'Leave it out. Not every true thing belongs in a book another institution may one day read.';
      break;
    case 'steward':
    case 'soldier':
    case 'mother':
    case 'midwife':
    case 'close_kin':
      break;
    default:
      return assertNever(lens, 'adviser lens');
  }
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

  switch (lens) {
    case 'steward':
    case 'old_head':
      return `I favour “${first.label}”. It is the course I can defend from what is on the table now.`;
    case 'reader':
      return `I favour “${last.label}”. The written case for it is the one I would want left in the book.`;
    case 'priest':
    case 'broker':
    case 'soldier':
    case 'mother':
    case 'midwife':
    case 'close_kin':
      return `I favour “${first.label}”. That is my interest speaking; I know no more than this page says.`;
    default:
      return assertNever(lens, 'adviser lens');
  }
}

/**
 * HELP THAT HAS TO BE ASKED FOR (issue #273).
 *
 * These three surfaces are not decisions, so they cannot reuse a docket's
 * visible cards or choices. They stay inside the same epistemic cul-de-sac:
 * the tree advice names only rules the tree itself draws, Chronicle advice
 * names only what a written record is, and branch advice reads only the
 * grievance value already printed beside that hall.
 *
 * Tier one nudges. Tier two says the rule as the household knows it. Tier
 * three points at an existing control or screen and never chooses for the
 * player. Nothing here predicts an outcome.
 */
function nudgeFor(lens: AdviserLens, surface: HelpSurface, grievance: boolean): string {
  switch (lens) {
    case 'reader':
      if (surface === 'chronicle') return 'I would read one page beside the pages around it. A lone sentence makes a poor history.';
      if (surface === 'tree') return 'I would begin with one name. A whole tree is easier to read one branch at a time.';
      return grievance
        ? 'I would read who lives in this hall before I read its grievance. A quarrel belongs to people.'
        : 'I would begin with the people in this hall. Quiet does not make a branch unimportant.';
    case 'old_head':
      if (surface === 'chronicle') return 'Begin with the page that names the act you care about. Then see what answered it later.';
      if (surface === 'tree') return 'Find the person nearest the question you are asking. The rest of the line can wait.';
      return grievance
        ? 'This hall has not settled something. I would look at who is carrying it before I looked at the grievance.'
        : 'This hall is quiet for now. I would still know who sits in it.';
    case 'close_kin':
    case 'mother':
    case 'midwife':
      if (surface === 'tree') return 'Start with one of us, not with the whole hall. Follow the family from there.';
      if (surface === 'chronicle') return 'Start with the page nearest the person you care about. Then read what came before and after it.';
      return grievance
        ? 'This hall is carrying something. Read the family here before you read the grievance.'
        : 'Start with the family in this hall. The branch is more than its grievance.';
    case 'steward':
    case 'broker':
      if (surface === 'branches') return grievance
        ? 'I would look at who lives in this hall before I looked at its grievance. The account makes more sense beside the household.'
        : 'I would start with who lives here. An empty grievance line is not an empty hall.';
      if (surface === 'chronicle') return 'Read the page beside what followed it. A record matters when somebody later has to act on it.';
      return 'Start with one name and one hall. The whole house is too much to price at once.';
    case 'priest':
    case 'soldier':
      if (surface === 'chronicle') return 'Read one page at a time, and remember who wrote it. A book is still made by people.';
      if (surface === 'tree') return 'Start with one person. Follow the line around them before you judge the whole house.';
      return grievance
        ? 'Read the people in this hall first. A grievance without faces is only a mark on a page.'
        : 'Read who lives here first. The hall matters even when its grievance is quiet.';
    default:
      return assertNever(lens, 'adviser lens');
  }
}

function helpPosition(
  ctx: SimCtx,
  lens: AdviserLens,
  surface: HelpSurface,
  subject: string,
  tier: HelpTier,
): string {
  const grievance = surface === 'branches' && (ctx.world.branches.get(subject)?.grievance ?? 0) > 0;

  switch (tier) {
    case 1:
      return nudgeFor(lens, surface, grievance);
    case 2:
      switch (surface) {
        case 'tree':
          return 'The tree shows the living house through its own record. The dead go to the Chronicle, and the seal has its own line.';
        case 'chronicle':
          return 'The Chronicle is what this house chose to keep, not a voice from outside it. A mistake or a boast can stay on the page.';
        case 'branches':
          return 'A cadet hall is still this house. Its grievance is kept here because the pressure belongs to this branch, not every hall at once.';
        default:
          return assertNever(surface, 'help surface');
      }
    case 3:
      switch (surface) {
        case 'tree':
          return 'Use Find somebody by name, choose a hall, or follow Only this branch. For former Heads, open the seal\'s line.';
        case 'chronicle':
          return 'Use Read it whole. Where a page points backward or forward, follow that thread before you judge it.';
        case 'branches':
          return 'Choose this hall, then open one of its people or follow Only this branch. Read the quarrel beside the family carrying it.';
        default:
          return assertNever(surface, 'help surface');
      }
    default:
      return assertNever(tier, 'help tier');
  }
}

/**
 * Pull-only help for a non-docket surface. The subject is deliberately opaque
 * except for a branch id (to read its already-visible grievance) and a person
 * id on the tree (to prefer close family as the speaker).
 */
export function adviceFor(
  ctx: SimCtx,
  surface: HelpSurface,
  subject: string,
  tier: HelpTier,
): AdviserAdvice[] {
  return advisers(ctx, surface, undefined, subject).slice(0, 2).map(({ person, lens, cares }) => ({
    adviser: { id: person.id, name: person.name },
    lens,
    cares,
    position: helpPosition(ctx, lens, surface, subject, tier),
  }));
}

/** Build one or two current, named, deliberately biased advisers for a decision. */
export function adviceForDecision(ctx: SimCtx, d: PendingDecision): AdviserAdvice[] {
  const surface = surfaceOf(d);
  const picked = advisers(ctx, surface, d).slice(0, 2);
  return picked.map(({ person, lens, cares }) => ({
    adviser: { id: person.id, name: person.name },
    lens,
    cares,
    position: d.kind === 'match'
      ? matchPosition(lens, d)
      : d.kind === 'record'
        ? recordPosition(lens, d)
        : choicePosition(lens, d, surface),
  }));
}
