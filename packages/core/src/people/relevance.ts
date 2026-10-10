import { assertNever, MAIN_BRANCH, type PersonId } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { measureAscension } from '../ascension.js';
import { halls } from './branches.js';
import { knownSuccession } from './succession.js';
import { msg } from '../messages.js';

function add(out: Map<PersonId, string[]>, person: PersonId, reason: string): void {
  const reasons = out.get(person) ?? [];
  if (!reasons.includes(reason)) reasons.push(reason);
  out.set(person, reasons);
}

function currentBlood(ctx: SimCtx) {
  const w = ctx.world;
  return w.people.household(w.playerHouse, w.year).filter((p) =>
    p.membership.some(
      (m) => m.from <= w.year
        && (m.to === undefined || m.to > w.year)
        && (m.kind === 'blood' || m.kind === 'cadet'),
    ));
}

/**
 * People the current plan or visible house state gives the player a reason to
 * inspect. Every reason is derived from facts already exposed by the session
 * view; this must never become a second door into genomes or future rolls.
 */
export function relevantPeople(ctx: SimCtx): Map<PersonId, string[]> {
  const out = new Map<PersonId, string[]>();
  const w = ctx.world;

  const succession = knownSuccession(ctx);
  if (succession.heir) add(out, succession.heir as PersonId, msg(ctx, 'relevance.heir', 'next to hold the seal'));
  else {
    for (const id of succession.possible) {
      add(out, id as PersonId, msg(ctx, 'relevance.possible_heir', 'may hold the seal'));
    }
  }

  for (const [hall, members] of halls(w, w.year)) {
    const branch = w.branches.get(hall);
    if ((branch?.grievance ?? 0) > 0) {
      for (const person of members) {
        add(out, person.id, msg(ctx, 'relevance.hall_grievance', 'their hall holds a grievance'));
      }
    }
  }

  const ambition = w.houseAmbition;
  if (!ambition) return out;

  switch (ambition) {
    case 'raise_ascendant': {
      const foremost = measureAscension(ctx).foremost;
      if (foremost) {
        add(out, foremost.person as PersonId,
          foremost.standing.blocked ?? msg(ctx, 'relevance.ascent_candidate', 'foremost candidate for the ascent'));
      }
      break;
    }
    case 'deepen_blood':
      for (const person of currentBlood(ctx)) {
        const age = w.year - person.born;
        if (
          person.status === 'alive'
          && age >= 17
          && age <= 45
          && !person.marriages.some((m) => m.to === undefined)
        ) add(out, person.id, msg(ctx, 'relevance.unmarried_blood', 'unmarried, of the blood'));
      }
      break;
    case 'secure_branches':
      for (const [hall, members] of halls(w, w.year)) {
        if (hall === MAIN_BRANCH || members.length >= 2) continue;
        for (const person of members) {
          add(out, person.id, msg(ctx, 'relevance.thin_hall', 'keeps a thin cadet hall alive'));
        }
      }
      break;
    case 'restore_ledger':
      for (const person of w.people.household(w.playerHouse, w.year)) {
        const role = person.contract?.role;
        if (role === 'archivist' || role === 'chronicler') {
          add(out, person.id, msg(ctx, 'relevance.ledger_reader', "the house's reader of the Ledger"));
        }
      }
      break;
    default:
      assertNever(ambition);
  }

  return out;
}
