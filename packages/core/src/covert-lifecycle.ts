import {
  EventTemplateS, OutcomeS, currentMembership,
  type CovertAttempt, type CovertDefence, type CovertResponse, type HouseholdThreat, type Person,
} from '@ed/schema';
import type { SimCtx } from './world.js';
import type { OrderResult } from './table.js';
import { covertDefenceQuote, covertGuardGap, observeCovertApproach, resolveCovertAttempt } from './covert.js';
import { dutyFunds, householdProtection, noteHouseholdProtection, spendForeign } from './mystic.js';
import { attendsHall, deployedPeople, isCurrentFamily, resolvePresence } from './presence.js';
import { branchOf } from './people/branches.js';
import { captureIntruder, releaseIntruder } from './people/captivity.js';
import { addGrudge } from './people/relationships.js';
import { commitOutcome } from './events/decisions.js';
import { DEBT_FLOOR } from './economy.js';
import { streamFor } from './rng.js';
import { msg } from './messages.js';

/** A rare hostile choice, never a response to owning a ward. One active plot,
 * at least twelve years between preparations, two years' notice, finite coin.
 * Small houses and the sitting Head are outside this first defensive scope. */
export const HOUSEHOLD_THREAT_COOLDOWN = 12;

const open = (t: HouseholdThreat) => t.stage === 'preparing' || t.stage === 'approach';
const active = (ctx: SimCtx, id: string) => ctx.world.covert.threats.find(t => t.plan.id === id && open(t));

function freeAdult(ctx: SimCtx, p: Person): boolean {
  return p.status === 'alive' && ctx.world.year - p.born >= 16
    && currentMembership(p, ctx.world.year)?.kind !== 'hostage'
    && !deployedPeople(ctx).has(p.id)
    && (!p.career || ctx.content.career(p.career.career)?.resident === 'home')
    && (p.acquired.health ?? 0) > -20 && (p.fieldRecoveryUntil ?? 0) <= ctx.world.year;
}

/** Read actors, grievance, population, access and money, never protective strength or books. */
export function householdThreatCandidates(ctx: SimCtx) {
  const w = ctx.world;
  const family = w.people.household(w.playerHouse, w.year).filter(p => isCurrentFamily(ctx, p));
  if (family.length < 4) return [];
  const targets = family.filter(p => !p.becomesGuardian && !p.castSlots.includes('head') && freeAdult(ctx, p)
    && attendsHall(ctx, branchOf(w, p, w.year), p));
  const outsiders = w.people.living().filter(p => !isCurrentFamily(ctx, p) && freeAdult(ctx, p)
    && currentMembership(p, w.year)?.house !== w.playerHouse);
  const out: { sponsor: Person; target: Person; grudge: string; house: string }[] = [];
  for (const r of [...w.relationships.values()].sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))) {
    const grudge = [...r.grudges].filter(g => g.severity >= 60 && g.originYear <= w.year).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!grudge) continue;
    const sponsor = outsiders.filter(p => r.from === p.id || r.from === currentMembership(p, w.year)?.house)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const house = sponsor && currentMembership(sponsor, w.year)?.house;
    if (!sponsor || !house || dutyFunds(ctx, house) < 20) continue;
    for (const target of targets) {
      if (r.to === target.id || r.to === currentMembership(target, w.year)?.house) out.push({ sponsor, target, grudge: grudge.id, house });
    }
  }
  return out;
}

function line(ctx: SimCtx, people: string[], text: string): void {
  ctx.world.chronicle.push({ year: ctx.world.year, weight: 'paragraph', named: true, people, text });
}

/** One private preparation receipt. No caller can create a threat merely by assigning protection. */
function prepareThreat(ctx: SimCtx): void {
  const w = ctx.world;
  if (w.covert.threats.some(open)) return;
  const last = w.covert.threats.at(-1)?.plan.preparedAt ?? -Infinity;
  if (w.year - last < HOUSEHOLD_THREAT_COOLDOWN) return;
  const candidates = householdThreatCandidates(ctx);
  if (!candidates.length) return;
  const rng = streamFor(w, 'covert_preparation');
  if (!rng.bool(0.08)) return;
  const { sponsor, target, grudge, house } = rng.pick(candidates);
  const operative = sponsor;
  spendForeign(ctx, house, 20);
  const plan: CovertAttempt = {
    id: `cov_${(w.counters.covert += 1).toString(36)}`,
    sponsor: sponsor.id, operative: operative.id, target: target.id,
    motive: { kind: 'grudge', grudge },
    site: { kind: 'hall', hall: { slot: 'HOME' }, visitors: ['INTRUDER'] },
    bindings: { HOME: target.id, INTRUDER: operative.id },
    preparation: 'hasty', preparedAt: w.year, attemptYear: w.year + 2, paidCrowns: 20,
  };
  w.covert.threats.push({ plan, stage: 'preparing', defence: { guards: [], response: 'ordinary', paidCrowns: 0 }, warned: false });
  line(ctx, [target.id], msg(ctx, 'covert.rumour',
    'A warning reached the house about {PERSON}: someone was asking after the doors and the hours. The Table can arrange guards now. Nothing names the person behind it.',
    { PERSON: target.name }));
}

function effectiveDefence(ctx: SimCtx, t: HouseholdThreat): CovertDefence {
  const guards = t.defence.guards.filter(id => !covertGuardGap(ctx, t.plan, [id]));
  return { ...t.defence, guards,
    response: t.defence.response === 'escort' && !guards.length ? 'ordinary' : t.defence.response };
}

function protectionReceipt(ctx: SimCtx, assignment: string, target: string): void {
  const a = ctx.world.mystic.assignments.find(a => a.id === assignment);
  const p = a && ctx.world.people.get(a.practitioner);
  const ward = ctx.world.people.get(target);
  if (!a || !p || !ward) return;
  noteHouseholdProtection(ctx, a.id);
  line(ctx, [p.id, ward.id], msg(ctx, 'covert.protection_used',
    '{READER} kept the assigned protection for {PERSON}, and it changed what happened. The year of service is entered in the account.',
    { READER: p.name, PERSON: ward.name }));
}

function cancel(ctx: SimCtx, t: HouseholdThreat): void {
  t.stage = 'cancelled'; t.closedAt = ctx.world.year;
  t.receipt = msg(ctx, 'covert.expired', 'The warning about {PERSON} expired without an attack here.',
    { PERSON: ctx.world.people.get(t.plan.target)?.name ?? t.plan.target });
  line(ctx, [t.plan.target], t.receipt);
}

/** Prepare, observe, then resolve. Called after maintenance/field/economy and before succession. */
export function tickHouseholdThreats(ctx: SimCtx): void {
  const w = ctx.world;
  for (const t of w.covert.threats.filter(open)) {
    const defence = effectiveDefence(ctx, t);
    if (w.year === t.plan.attemptYear - 1 && t.stage === 'preparing') {
      const seen = observeCovertApproach(ctx, t.plan, defence);
      if (seen.kind === 'refused') { cancel(ctx, t); continue; }
      t.stage = 'approach';
      t.warned = seen.warning !== undefined;
      if (seen.support) protectionReceipt(ctx, seen.support, t.plan.target);
      if (t.warned) line(ctx, [t.plan.target], msg(ctx, 'covert.approach_seen',
        'An approach to {PERSON} was seen in time. Safe lodging or an escort can still be paid for at the Table. The watcher saw an approach, not a patron.',
        { PERSON: w.people.get(t.plan.target)?.name ?? t.plan.target }));
    }
    if (w.year < t.plan.attemptYear) continue;
    if (w.year > t.plan.attemptYear) { cancel(ctx, t); continue; }
    const result = resolveCovertAttempt(ctx, t.plan, defence, 'attempt', undefined, { forewarned: t.warned });
    if (result.kind === 'refused') { cancel(ctx, t); continue; }
    t.warned ||= result.warned;
    if (!result.observation) {
      // A barrier may spoil an unseen approach. Closing the known warning
      // must not invent witnesses, an attack page or public proof of a plot.
      t.stage = 'resolved'; t.closedAt = w.year;
      t.receipt = msg(ctx, 'covert.expired', 'The warning about {PERSON} expired without an attack here.',
        { PERSON: w.people.mustGet(t.plan.target).name });
      line(ctx, [t.plan.target], t.receipt);
      continue;
    }
    for (const use of result.support ?? []) protectionReceipt(ctx, use.assignment, t.plan.target);
    const victim = w.people.mustGet(t.plan.target);
    const normalText = result.target === 'dead'
      ? msg(ctx, 'covert.result.dead', '{PERSON} died in the attack. The house must go on without that life.', { PERSON: victim.name })
      : result.target === 'wounded'
        ? msg(ctx, 'covert.result.wounded', '{PERSON} survived the attack with an injury. Recovery will take its own time.', { PERSON: victim.name })
        : msg(ctx, 'covert.result.safe', 'The attack did not reach {PERSON}. The precautions held for this encounter.', { PERSON: victim.name });
    const normal = OutcomeS.parse({ id: result.target, text: normalText,
      effects: result.normal.effects.map(e => e.kind === 'status' ? { ...e, cause: msg(ctx, 'covert.death_cause', 'an attack') } : e),
      primordial: { id: 'intervened', record: null, effects: [],
        text: msg(ctx, 'covert.result.intervened',
          'The room changed before the blow reached {PERSON}. The danger passed through the house and left the intended life in it.', { PERSON: victim.name }) },
    });
    // This template exists only for this incident, never in an ambient draw.
    // Core prose is selected now, then saved as the permanent Chronicle page.
    const event = EventTemplateS.parse({
      id: 'covert_household_attempt', title: msg(ctx, 'covert.title', 'An approach at the hall'),
      tier: 'family', frequency: 'uncommon', purposes: ['change_relationship', 'test_magic_rule', 'worldbuild_through_action'],
      site: { kind: 'hall', hall: { slot: 'COVERT_TARGET' } },
      body: '', interaction: { kind: 'narration', outcomes: [normal] },
    });
    // Secret visitors establish private approach eligibility, not public cast
    // credit. The public scene keeps the same victim's home-hall anchor, without
    // the secret visitor binding. Local expressers still attend that real hall.
    const committed = commitOutcome(ctx, event, normal, { COVERT_TARGET: victim.id }, undefined,
      streamFor(w, 'covert_commit', t.plan.id), undefined, 'incident');
    t.stage = 'resolved'; t.closedAt = w.year; t.page = committed.entryId; t.receipt = committed.text;
    t.observation = structuredClone(result.observation);
    if (committed.primordial) t.observation = {
      occurrence: t.plan.id, year: w.year, target: victim.id,
      result: victim.status === 'alive' ? 'prevented' : 'dead', witnesses: [],
    };
    if (!committed.primordial && result.operative === 'captured' && captureIntruder(ctx, t.plan.operative)) {
      t.prisoner = t.plan.operative;
      line(ctx, [t.plan.operative], msg(ctx, 'covert.intruder_held',
        '{PERSON} was caught and is held by the house. Capturing an operative does not establish who sent them.',
        { PERSON: w.people.mustGet(t.plan.operative).name }));
    }
    if (t.observation.identifiedOperative) {
      addGrudge(ctx, w.playerHouse, t.observation.identifiedOperative,
        { severity: result.target === 'dead' && !committed.primordial ? 70 : 45, inheritance: 'house_wide' },
        'covert_household_attempt', committed.entryId);
    }
  }
  prepareThreat(ctx);
}

type DefenceOrder = { threat: string; guards: string[]; response: CovertResponse };
export function quoteThreatResponse(ctx: SimCtx, order: DefenceOrder) {
  const t = active(ctx, order.threat);
  const refuse = (reason: string) => ({ ok: false, price: 0, reason });
  if (!t || t.plan.attemptYear <= ctx.world.year) return refuse(msg(ctx, 'covert.refuse.closed', 'that warning can no longer be answered'));
  if (order.guards.length > 3 || covertGuardGap(ctx, t.plan, order.guards)) return refuse(msg(ctx, 'covert.refuse.guards', 'those guards cannot attend this place'));
  if (order.response !== 'ordinary' && !t.warned) return refuse(msg(ctx, 'covert.refuse.no_trace', 'an approach must be seen before arranging that response'));
  if (order.response === 'escort' && !order.guards.length) return refuse(msg(ctx, 'covert.refuse.escort', 'an escort needs a named person'));
  const price = Math.max(0, covertDefenceQuote(order.guards.length, order.response) - t.defence.paidCrowns);
  if (ctx.world.treasury - price < DEBT_FLOOR) return refuse(msg(ctx, 'covert.refuse.cost', 'the house cannot pay for those precautions'));
  return { ok: true, price, reason: undefined };
}

export function defendHousehold(ctx: SimCtx, order: DefenceOrder): OrderResult {
  const quote = quoteThreatResponse(ctx, order);
  if (!quote.ok) return quote;
  const t = active(ctx, order.threat)!;
  if (t.defence.response === order.response && t.defence.guards.length === order.guards.length
    && order.guards.every(id => t.defence.guards.includes(id))) return { ok: true };
  ctx.world.treasury -= quote.price;
  t.defence = { guards: [...order.guards], response: order.response, paidCrowns: t.defence.paidCrowns + quote.price };
  line(ctx, [t.plan.target, ...order.guards], msg(ctx, 'covert.precautions_paid',
    'The house paid {PRICE} crowns for precautions around {PERSON}. The named watch has one encounter to keep.',
    { PRICE: String(quote.price), PERSON: ctx.world.people.mustGet(t.plan.target).name }));
  return { ok: true };
}

export function releaseThreatPrisoner(ctx: SimCtx, id: string): OrderResult {
  const t = ctx.world.covert.threats.find(t => t.plan.id === id);
  if (!t?.prisoner || !releaseIntruder(ctx, t.prisoner)) return {
    ok: false, reason: msg(ctx, 'covert.refuse.prisoner', 'no such intruder is held here'),
  };
  line(ctx, [t.prisoner], msg(ctx, 'covert.intruder_released', '{PERSON} was released from the house and returned home.',
    { PERSON: ctx.world.people.mustGet(t.prisoner).name }));
  delete t.prisoner;
  return { ok: true };
}

function responseName(ctx: SimCtx, response: CovertResponse): string {
  switch (response) {
    case 'ordinary': return msg(ctx, 'covert.response.ordinary', 'Keep this watch');
    case 'safe_lodging': return msg(ctx, 'covert.response.lodging', 'Arrange safe lodging');
    case 'escort': return msg(ctx, 'covert.response.escort', 'Arrange an escort');
  }
}

/** Photograph of known warning and testimony only. No plan, sponsor, hidden attendance or odds. */
export function householdSecurityView(ctx: SimCtx) {
  const w = ctx.world;
  return {
    threats: w.covert.threats.filter(open).map(t => {
      const people = resolvePresence(ctx, t.plan.site, t.plan.bindings).people;
      const guards = people.filter(id => !covertGuardGap(ctx, t.plan, [id])).sort().slice(0, 3);
      const groups = [[], ...guards.map(id => [id]), ...(guards.length > 1 ? [guards] : [])];
      const options = groups.flatMap(group => (['ordinary', 'safe_lodging', 'escort'] as const).flatMap(response => {
        if (response !== 'ordinary' && !t.warned || response === 'escort' && !group.length) return [];
        const order = { kind: 'covertDefend' as const, threat: t.plan.id, guards: group, response };
        const quote = quoteThreatResponse(ctx, order);
        return [{ order, ...quote, label: responseName(ctx, response), guards: group.map(id => w.people.mustGet(id).name) }];
      }));
      return { id: t.plan.id, target: t.plan.target, name: w.people.get(t.plan.target)?.name ?? '',
        due: t.plan.attemptYear, warned: t.warned, spent: t.defence.paidCrowns,
        watch: effectiveDefence(ctx, t).guards.map(id => w.people.mustGet(id).name), options };
    }),
    history: w.covert.threats.filter(t => !open(t)).slice(-6).reverse().map(t => {
      const prisoner = t.prisoner ? w.people.get(t.prisoner) : undefined;
      return { id: t.plan.id, year: t.closedAt, receipt: t.receipt, page: t.page,
        ...(prisoner?.status === 'alive' && prisoner.captivity?.captor === w.playerHouse
          ? { prisoner: { person: prisoner.id, name: prisoner.name } } : {}) };
    }),
  };
}
