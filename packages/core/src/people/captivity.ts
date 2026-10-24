import { asId, currentMembership, isActiveBranch, MAIN_BRANCH, type Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { DEBT_FLOOR } from '../economy.js';
import { msg } from '../messages.js';
import { proseForContentField } from '../prose.js';
import { isCurrentFamily } from '../presence.js';
import { cancelDecisionArcs } from '../events/arcs.js';

/** Shared by field and covert incidents. Captives stay alive in PersonStore;
 * their foreign hostage membership removes residence, not blood or mortality.
 * This function rolls nothing and never kills, seats a Head or creates a post.
 */
export function captureFamily(ctx: SimCtx, person: string, captor: string, ransom: number): boolean {
  const w = ctx.world;
  const p = w.people.get(person);
  const home = p && currentMembership(p, w.year);
  if (!p || p.status !== 'alive' || p.captivity || !isCurrentFamily(ctx, p)
    || !home || home.to !== undefined || p.membership.filter(m => m.to === undefined).length !== 1
    || captor === w.playerHouse || !ctx.content.house(captor)
    || !Number.isSafeInteger(ransom) || ransom < 0) return false;

  const studies = w.studies.filter(term => term.person === p.id);
  const tutoring = w.tutoring.find(term => term.person === p.id);
  p.captivity = {
    captor: asId(captor), since: w.year, ransom, home: structuredClone(home),
    ...(studies.length ? { studies: studies.map(study => ({
      book: String(study.book), remainingYears: Math.max(1, study.completes - w.year),
    })) } : {}),
    ...(tutoring ? { tutoring: { attr: tutoring.attr, remainingYears: Math.max(1, tutoring.completes - w.year) } } : {}),
  };
  w.studies = w.studies.filter(term => term.person !== p.id);
  w.tutoring = w.tutoring.filter(term => term.person !== p.id);
  if (tutoring) cancelDecisionArcs(ctx, 'tutor', p.id);
  home.to = w.year;
  p.membership.push({ house: asId(captor), kind: 'hostage', from: w.year });
  w.chronicle.push({
    year: w.year, weight: 'paragraph', named: true, people: [p.id],
    text: msg(ctx, 'captivity.taken',
      '{CAPTOR} holds {PERSON}. The price of bringing {PERSON} home is {PRICE} crowns.',
      { CAPTOR: captorName(ctx, captor), PERSON: p.name, PRICE: String(ransom) }),
  });
  return true;
}

function captive(ctx: SimCtx, id: string): Person | undefined {
  const p = ctx.world.people.get(id);
  if (!p || p.status !== 'alive' || !p.captivity || p.captivity.home.house !== ctx.world.playerHouse) return undefined;
  const membership = currentMembership(p, ctx.world.year);
  return membership?.kind === 'hostage' && membership.house === p.captivity.captor
    && p.membership.filter(m => m.to === undefined).length === 1 ? p : undefined;
}

export interface RansomQuote {
  ok: boolean;
  price: number;
  reason?: string;
}

/** Read-only, with the price retained from the incident rather than repriced each year. */
export function quoteRansom(ctx: SimCtx, person: string): RansomQuote {
  const p = captive(ctx, person);
  if (!p) return { ok: false, price: 0, reason: msg(ctx, 'captivity.refuse.not_held', 'no living captive of this house by that name') };
  const price = p.captivity!.ransom;
  if (price > 0 && ctx.world.treasury - price < DEBT_FLOOR) {
    return { ok: false, price, reason: msg(ctx, 'captivity.refuse.cost', 'the house cannot raise {PRICE} crowns', { PRICE: String(price) }) };
  }
  return { ok: true, price };
}

/** A trusted incident may release a captive without payment. The Table uses ransomCaptive. */
export function releaseCaptive(ctx: SimCtx, person: string): boolean {
  const p = captive(ctx, person);
  if (!p) return false;
  const captor = p.captivity!.captor;
  returnHome(ctx, p);
  ctx.world.chronicle.push({
    year: ctx.world.year, weight: 'paragraph', named: true, people: [p.id],
    text: msg(ctx, 'captivity.released', '{CAPTOR} released {PERSON}, and {PERSON} came home.',
      { CAPTOR: captorName(ctx, captor), PERSON: p.name }),
  });
  return true;
}

/** The player's one payment path. A second call cannot pay or reopen a membership. */
export function ransomCaptive(ctx: SimCtx, person: string): RansomQuote {
  const quote = quoteRansom(ctx, person);
  if (!quote.ok) return quote;
  const p = captive(ctx, person)!;
  const captor = p.captivity!.captor;
  ctx.world.treasury -= quote.price;
  returnHome(ctx, p);
  ctx.world.chronicle.push({
    year: ctx.world.year, weight: 'paragraph', named: true, people: [p.id],
    text: msg(ctx, 'captivity.ransomed',
      'The house paid {CAPTOR} {PRICE} crowns for {PERSON}. {PERSON} came home.',
      { CAPTOR: captorName(ctx, captor), PRICE: String(quote.price), PERSON: p.name }),
  });
  return quote;
}

function returnHome(ctx: SimCtx, p: Person): void {
  const w = ctx.world;
  const held = p.captivity!;
  currentMembership(p, w.year)!.to = w.year;
  const { from: _from, to: _to, ...home } = held.home;
  const branch = home.branch && home.branch !== MAIN_BRANCH ? w.branches.get(home.branch) : undefined;
  p.membership.push({ ...home, branch: branch && isActiveBranch(branch) ? branch.id : MAIN_BRANCH, from: w.year });
  // Do not restore cast slots: a successor may have taken the seal while the
  // captive was away. Ordinary succession remains its one owner.
  for (const study of held.studies ?? []) {
    if (p.spellsKnown.some(book => String(book) === study.book)) continue;
    const copy = w.library.get(study.book);
    if (copy && copy.restoresAt === undefined && !w.studies.some(term => term.person === p.id && term.book === study.book)) {
      w.studies.push({ person: p.id, book: study.book, completes: w.year + study.remainingYears });
    } else if (!copy || copy.restoresAt !== undefined) {
      const book = ctx.content.spellbook(study.book);
      w.chronicle.push({
        year: w.year, weight: 'line', named: false, people: [p.id],
        text: msg(ctx, 'captivity.study_unavailable',
          '{PERSON} came back to {BOOK}, but no copy was ready to read. The study could not resume.',
          { PERSON: p.name, BOOK: book ? proseForContentField(ctx, 'spellbooks', book.id, 'name', book.name) : study.book }),
      });
    }
  }
  if (held.tutoring && !w.tutoring.some(term => term.person === p.id)) {
    w.tutoring.push({ person: p.id, attr: held.tutoring.attr, completes: w.year + held.tutoring.remainingYears });
  }
  delete p.captivity;
}

function captorName(ctx: SimCtx, house: string): string {
  const def = ctx.content.house(house);
  return def ? proseForContentField(ctx, 'houses', house, 'name', def.name) : house;
}

export function captivityView(ctx: SimCtx) {
  return ctx.world.people.all().filter(p => p.status === 'alive' && p.captivity?.home.house === ctx.world.playerHouse)
    .map(p => ({ person: String(p.id), name: p.name, captor: captorName(ctx, p.captivity!.captor),
      since: p.captivity!.since, ...quoteRansom(ctx, p.id) }));
}
