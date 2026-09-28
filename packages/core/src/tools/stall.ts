import { assertNever } from '@ed/schema';
import {
  GOD_AFFINITY_PAIRS,
  foremostOf,
  type LadderBlocker,
} from '../ascension.js';
import { tableView, type RiteAssembly } from '../table.js';
import type { PendingChoice, PendingDecision, PendingRecord } from '../events/decisions.js';
import { evalCheck } from '../events/checks.js';
import { streamFor } from '../rng.js';
import type { SimCtx } from '../world.js';

/**
 * THE PLAYER VERB BEHIND EACH LADDER BLOCKER (#270).
 *
 * This is a design claim, not a tuning table. A blocker is only "actionable"
 * when a verb currently on the player's surface can move the exact failed
 * predicate. In particular, a generic Study is not enough for a God waiting
 * on the final circle, and a generic auction is not enough for missing Regalia.
 */
export type StallVerb =
  | 'match'
  | 'study'
  | 'seek-book'
  | 'tutor-mind'
  | 'career'
  | 'record-respect'
  | 'choice-respect'
  | 'choice-madness'
  | 'choice-clause'
  | 'vessel-rite'
  | 'great-rite'
  | 'unmaking'
  | 'bid-regalia'
  | 'ledger-search';

export interface BlockerLever {
  verb: StallVerb;
  /** A Match changes the next generation, not the man currently blocked. */
  timing: 'now' | 'next-generation';
  owner: 'match' | 'table' | 'docket';
}

export function blockerLevers(blocker: LadderBlocker): readonly BlockerLever[] {
  switch (blocker) {
    case 'no-expresser':
    case 'awakening':
      return [{ verb: 'match', timing: 'next-generation', owner: 'match' }];

    case 'power':
      return [
        { verb: 'great-rite', timing: 'now', owner: 'table' },
        { verb: 'match', timing: 'next-generation', owner: 'match' },
      ];

    case 'books':
      return [
        { verb: 'study', timing: 'now', owner: 'table' },
        { verb: 'seek-book', timing: 'now', owner: 'table' },
      ];

    case 'affinities':
      return [
        { verb: 'study', timing: 'now', owner: 'table' },
        { verb: 'seek-book', timing: 'now', owner: 'table' },
      ];

    case 'madness-floor':
      return [
        { verb: 'choice-madness', timing: 'now', owner: 'docket' },
        { verb: 'vessel-rite', timing: 'now', owner: 'table' },
        { verb: 'great-rite', timing: 'now', owner: 'table' },
        { verb: 'unmaking', timing: 'now', owner: 'table' },
      ];

    case 'madness-overflow':
    case 'mind':
      return [{ verb: 'tutor-mind', timing: 'now', owner: 'table' }];

    case 'respect':
      return [
        { verb: 'career', timing: 'now', owner: 'table' },
        { verb: 'record-respect', timing: 'now', owner: 'docket' },
        { verb: 'choice-respect', timing: 'now', owner: 'docket' },
      ];

    case 'rite':
      return [
        { verb: 'vessel-rite', timing: 'now', owner: 'table' },
        { verb: 'great-rite', timing: 'now', owner: 'table' },
        { verb: 'unmaking', timing: 'now', owner: 'table' },
      ];

    case 'regalia':
      return [{ verb: 'bid-regalia', timing: 'now', owner: 'table' }];

    case 'clauses':
      return [
        { verb: 'ledger-search', timing: 'now', owner: 'table' },
        { verb: 'choice-clause', timing: 'now', owner: 'docket' },
      ];

    case 'clear':
    case 'other':
      return [];

    default:
      return assertNever(blocker);
  }
}

export interface CheckAttemptObservation {
  /** Authored check identity; stable across repeated firings of the event. */
  check: string;
  person: string;
  /** Passing the authored difficulty is the check's success boundary. */
  ok: boolean;
}

/**
 * Observe the EXACT check the ordinary GameSession.choose path is about to
 * roll, without advancing shared RNG or mutating the world.
 *
 * GameSession.choose derives a fresh stream from (world, "decision", id) on
 * every resolution. Reconstructing that fresh stream here is deterministic and
 * non-mutating, so the later real resolution sees the same roll. We refuse
 * player-cast decisions because this instrument does not invent a cast merely
 * to obtain a number: if the actual density policy cannot supply the required
 * person, there was no check attempt to count.
 */
export function observeChoiceCheck(
  ctx: SimCtx,
  d: PendingChoice,
  choiceId: string,
): CheckAttemptObservation | undefined {
  if (d.cast.some((request) => !request.optional)) return undefined;
  if (d.event.interaction.kind === 'narration') return undefined;
  if (!d.choices.find((choice) => choice.id === choiceId)?.available) return undefined;

  const choice = d.event.interaction.choices.find((candidate) => candidate.id === choiceId);
  if (!choice?.check) return undefined;
  const check = d.event.checks.find((candidate) => candidate.id === choice.check);
  if (!check) return undefined;

  const person = checkPerson(check.pool, d.fill);
  if (!person) return undefined;

  const result = evalCheck(
    ctx,
    check,
    d.event,
    d.fill,
    streamFor(ctx.world, 'decision', d.id),
  );
  return {
    check: `${d.event.id}/${check.id}`,
    person,
    ok: result.roll >= result.difficulty,
  };
}

export function observePartyCheck(
  ctx: SimCtx,
  d: PendingChoice,
): CheckAttemptObservation | undefined {
  if (d.choicesAreOpen) return undefined;
  // The density player sends an empty cast. A required player-cast slot means
  // that attempt will be refused and handed to the chronicler instead, so
  // there is no player check attempt to count.
  if (d.cast.some((request) => !request.optional)) return undefined;
  if (d.event.interaction.kind === 'narration') return undefined;

  const decider = d.event.interaction.decidedBy;
  if (typeof decider !== 'object' || !('party' in decider)) return undefined;
  const check = d.event.checks.find((candidate) => candidate.id === decider.party.check);
  if (!check) return undefined;

  const person = checkPerson(check.pool, d.fill);
  if (!person) return undefined;

  const result = evalCheck(
    ctx,
    check,
    d.event,
    d.fill,
    streamFor(ctx.world, 'decision', d.id),
  );
  return {
    check: `${d.event.id}/${check.id}`,
    person,
    ok: result.roll >= result.difficulty,
  };
}

function checkPerson(
  pool: { kind: string; slot?: string; slots?: string[] },
  fill: PendingChoice['fill'],
): string | undefined {
  if (pool.kind === 'slot' && pool.slot) {
    const cast = fill[pool.slot];
    return typeof cast === 'string' ? cast : undefined;
  }
  if (pool.kind === 'party_sum' && pool.slots) {
    const people = pool.slots.flatMap((slot) => {
      const cast = fill[slot];
      return typeof cast === 'string' ? [cast] : Array.isArray(cast) ? cast : [];
    });
    const unique = [...new Set(people)];
    return unique.length === 1 ? unique[0] : undefined;
  }
  // Family/record pools are deliberately not attributed to a person. #270 is
  // specifically asking whether the same PERSON keeps failing the same check.
  return undefined;
}

export interface BlockerActionability {
  actionable: boolean;
  verbs: StallVerb[];
}

/**
 * Read only CURRENT surfaces. This never predicts that an event will arrive.
 * A future Match is a real lever only in a year where a Match hand is actually
 * on the docket; otherwise a genetic blocker is exactly the waiting #270 means
 * to expose.
 */
export function blockerActionability(
  ctx: SimCtx,
  blocker: LadderBlocker,
  personId = foremostOf(ctx)?.person.id,
): BlockerActionability {
  if (blocker === 'clear') return { actionable: true, verbs: [] };
  if (!personId && blocker !== 'no-expresser') return { actionable: false, verbs: [] };

  const verbs: StallVerb[] = [];
  const offered = ctx.world.pendingDecisions;
  const table = tableView(ctx);

  const add = (verb: StallVerb, yes: boolean) => {
    if (yes && !verbs.includes(verb)) verbs.push(verb);
  };

  add('match', offered.some((d) => d.kind === 'match'));

  if (personId) {
    add('study', studyCanMove(ctx, table, blocker, personId));
    add('seek-book', seekBookCanMove(ctx, table, blocker, personId));
    add('tutor-mind', (blocker === 'mind' || blocker === 'madness-overflow')
      && table.canTutor
      && table.teachable.some((a) => a.attr === 'mind')
      && table.pupils.some((p) => p.person === personId));

    add('great-rite', riteCanMove(table.greatRite, personId)
      && (blocker === 'power' || blocker === 'madness-floor' || blocker === 'rite'));
    add('vessel-rite', riteCanMove(table.vesselRite, personId)
      && (blocker === 'madness-floor' || blocker === 'rite'));
    add('unmaking', riteCanMove(table.unmaking, personId)
      && (blocker === 'madness-floor' || blocker === 'rite'));

    add('choice-madness', blocker === 'madness-floor'
      && offered.some((d) => d.kind === 'choice'
        && decisionEffects(d).some((e) => positivePersonEffect(ctx, d, e, personId, 'madness'))));
  }

  add('career', blocker === 'respect'
    && table.posts.some((p) => p.respectYield !== 'none' && p.canPay && p.eligible.length > 0));
  add('record-respect', blocker === 'respect'
    && offered.some((d) => d.kind === 'record' && recordEffects(d).some(positiveRespect)));
  add('choice-respect', blocker === 'respect'
    && offered.some((d) => d.kind === 'choice' && decisionEffects(d).some(positiveRespect)));

  add('bid-regalia', blocker === 'regalia' && ctx.world.auction.upcoming.some((lot) =>
    lot.saleYear >= ctx.world.year
    && lot.kind === 'heirloom'
    && ctx.content.heirloom(lot.refId)?.kind === 'regalia'
    && !ctx.world.heirlooms.has(lot.refId)));

  add('ledger-search', blocker === 'clauses' && table.ledgerSearch.ready);
  add('choice-clause', blocker === 'clauses'
    && offered.some((d) => d.kind === 'choice' && decisionEffects(d).some((e) => e.kind === 'clause')));

  // Do not accidentally count a verb that belongs to some other blocker.
  const allowed = new Set(blockerLevers(blocker).map((l) => l.verb));
  const exact = verbs.filter((v) => allowed.has(v));
  return { actionable: exact.length > 0, verbs: exact };
}

function riteCanMove(
  offer: { ready: boolean; assembly?: RiteAssembly },
  personId: string,
): boolean {
  if (!offer.ready || !offer.assembly) return false;
  return offer.assembly.actors.some((actor) => actor.person === personId);
}

function livingHouseholdKnows(ctx: SimCtx, book: string): boolean {
  return ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .some((p) => p.status === 'alive' && p.spellsKnown.some((known) => String(known) === book));
}

function knownAffinities(ctx: SimCtx, personId: string): Set<string> {
  const p = ctx.world.people.get(personId);
  const out = new Set<string>();
  for (const id of p?.spellsKnown ?? []) {
    const book = ctx.content.spellbook(id);
    if (book) out.add(String(book.affinity));
  }
  return out;
}

function householdAffinities(ctx: SimCtx): Set<string> {
  const out = new Set<string>();
  for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) {
    if (p.status !== 'alive') continue;
    for (const id of p.spellsKnown) {
      const book = ctx.content.spellbook(id);
      if (book) out.add(String(book.affinity));
    }
  }
  return out;
}

function missingGodAffinities(ctx: SimCtx): Set<string> {
  const held = householdAffinities(ctx);
  const missing = new Set<string>();
  for (const pair of GOD_AFFINITY_PAIRS) {
    if (pair.some((affinity) => held.has(String(affinity)))) continue;
    for (const affinity of pair) missing.add(String(affinity));
  }
  return missing;
}

function studyCanMove(
  ctx: SimCtx,
  table: ReturnType<typeof tableView>,
  blocker: LadderBlocker,
  personId: string,
): boolean {
  if (blocker !== 'books' && blocker !== 'affinities') return false;
  const p = ctx.world.people.get(personId);
  if (!p) return false;
  const householdGate = p.rites.includes('unmaking');

  for (const row of table.shelf) {
    const def = ctx.content.spellbook(row.book);
    if (!def) continue;
    const affinity = String(def.affinity);

    if (!householdGate) {
      if (!row.readers.some((r) => r.person === personId)) continue;
      if (blocker === 'books') return true;
      if (!knownAffinities(ctx, personId).has(affinity)) return true;
      continue;
    }

    if (!row.readers.length) continue;
    if (blocker === 'books' && !livingHouseholdKnows(ctx, row.book)) return true;
    if (blocker === 'affinities' && missingGodAffinities(ctx).has(affinity)) return true;
  }
  return false;
}

function seekBookCanMove(
  ctx: SimCtx,
  table: ReturnType<typeof tableView>,
  blocker: LadderBlocker,
  personId: string,
): boolean {
  if (blocker !== 'books' && blocker !== 'affinities') return false;
  const p = ctx.world.people.get(personId);
  if (!p) return false;
  const householdGate = p.rites.includes('unmaking');
  const personAffinities = knownAffinities(ctx, personId);
  const godMissing = householdGate ? missingGodAffinities(ctx) : undefined;

  return table.missingPrimers.some((book) => {
    if (book.queued) return false;
    if (blocker === 'books') return true;
    return householdGate ? godMissing!.has(book.affinity) : !personAffinities.has(book.affinity);
  });
}

type LooseEffect = { kind?: string; delta?: number; attr?: string; target?: unknown };

function decisionEffects(d: PendingChoice): LooseEffect[] {
  if (d.event.interaction.kind === 'narration') return [];
  const available = new Set(d.choices.filter((c) => c.available).map((c) => c.id));
  return d.event.interaction.choices
    .filter((choice) => available.has(choice.id))
    .flatMap((choice) => choice.outcomes.flatMap((outcome) => outcome.effects as LooseEffect[]));
}

function recordEffects(d: PendingRecord): LooseEffect[] {
  if (!d.event.record) return [];
  return d.options.flatMap(({ option }) =>
    d.event.record!.options[option].effects as LooseEffect[]);
}

function positiveRespect(effect: LooseEffect): boolean {
  return effect.kind === 'respect' && (effect.delta ?? 0) > 0;
}

function positivePersonEffect(
  ctx: SimCtx,
  d: PendingDecision,
  effect: LooseEffect,
  personId: string,
  kind: 'madness',
): boolean {
  return effect.kind === kind && (effect.delta ?? 0) > 0 && targetIncludes(ctx, d, effect.target, personId);
}

function targetIncludes(
  ctx: SimCtx,
  d: PendingDecision,
  target: unknown,
  personId: string,
): boolean {
  if (typeof target === 'object' && target !== null && 'slot' in target) {
    if (d.kind !== 'choice' && d.kind !== 'record') return false;
    const slot = String((target as { slot: unknown }).slot);
    const cast = d.fill[slot];
    return Array.isArray(cast) ? cast.includes(personId) : cast === personId;
  }
  if (target === 'head') return ctx.world.people.get(personId)?.castSlots.includes('head') ?? false;
  if (target === 'household' || target === 'all_blood') {
    return ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).some((p) => p.id === personId);
  }
  // A target shape we cannot prove names this man is not actionable evidence.
  return false;
}
