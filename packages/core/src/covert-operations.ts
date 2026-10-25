import {
  EventTemplateS, OutcomeS, currentMembership, assertNever, CovertPreparationS,
  type CovertOperation, type CovertPreparation, type CovertPurpose, type Effect, type Person,
} from '@ed/schema';
import type { SimCtx } from './world.js';
import type { OrderResult } from './table.js';
import { covertDefenceQuote, covertGuardGap, covertPreparationQuote, observeCovertApproach, resolveCovertAttempt } from './covert.js';
import { covertParticipants, deployedPeople, isCurrentFamily, resolvePresence } from './presence.js';
import { commitDuty, covertSupport, dutyFunds, finishCovertService, noteCovertSupport, noteHouseholdProtection, pauseDutyStudy, quoteDuty, spendForeign } from './mystic.js';
import { addGrudge } from './people/relationships.js';
import { trackKnownRivalHead } from './people/rivals.js';
import { commitOutcome } from './events/decisions.js';
import { DEBT_FLOOR } from './economy.js';
import { streamFor } from './rng.js';
import { msg } from './messages.js';

export const COVERT_OPERATION_COOLDOWN = 12;
const open = (o: CovertOperation) => o.stage !== 'closed';
const active = (ctx: SimCtx, id: string) => ctx.world.covert.operations.find(o => o.plan.id === id && open(o));
const account = (ctx: SimCtx, people: string[], text: string) => ctx.world.chronicle.push({
  year: ctx.world.year, weight: 'paragraph' as const, named: true, people, text,
});

function known(ctx: SimCtx, p: Person): boolean {
  return p.castSlots.includes('rival') || p.castSlots.includes('the_match')
    || ctx.world.chronicle.some(c => c.people?.includes(p.id))
    || ctx.world.covert.threats.some(t => t.observation?.identifiedOperative === p.id);
}

function available(ctx: SimCtx, p: Person): boolean {
  return p.status === 'alive' && !p.becomesGuardian && ctx.world.year - p.born >= 16
    && !p.captivity && currentMembership(p, ctx.world.year)?.kind !== 'hostage'
    && !deployedPeople(ctx).has(p.id) && (p.fieldRecoveryUntil ?? 0) <= ctx.world.year
    && (p.acquired.health ?? 0) > -20
    && (!p.career || ctx.content.career(p.career.career)?.resident === 'home');
}

/** One actual directed grievance and presently reachable person, never a shadow house head. */
export function covertOpportunities(ctx: SimCtx) {
  const w = ctx.world;
  const used = new Set(w.covert.operations.map(o => o.opportunity));
  const targets = w.people.living().filter(p => known(ctx, p) && available(ctx, p) && !isCurrentFamily(ctx, p)
    && currentMembership(p, w.year)?.house !== w.playerHouse
    && resolvePresence(ctx, { kind: 'person', person: p.id }, {}).people.includes(p.id));
  const out: { id: string; target: Person; sponsor: Person; grudge: string; purposes: CovertPurpose[] }[] = [];
  for (const r of w.relationships.values()) {
    const holder = w.people.get(r.from);
    if (r.from !== w.playerHouse && (!holder || !isCurrentFamily(ctx, holder) || holder.status !== 'alive' || w.year - holder.born < 16)) continue;
    const sponsor = holder ?? w.people.household(w.playerHouse, w.year).find(p => available(ctx, p));
    if (!sponsor) continue;
    for (const g of r.grudges.filter(g => g.severity >= 40 && g.originYear <= w.year)) for (const target of targets) {
      const membership = currentMembership(target, w.year)!;
      if (r.to !== target.id && r.to !== membership.house) continue;
      const id = `${g.id}:${target.id}:${membership.from}`;
      if (used.has(id) || out.some(o => o.id === id)) continue;
      const attacked = w.covert.threats.some(t => t.observation?.identifiedOperative === target.id);
      out.push({ id, target, sponsor, grudge: g.id, purposes: attacked ? ['answer_attack', 'settle_grudge'] : ['settle_grudge'] });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

type PreparationOrder = { opportunity: string; operative: string; purpose: CovertPurpose; preparation: CovertPreparation };

function quotePreparation(ctx: SimCtx, order: PreparationOrder, opportunity: ReturnType<typeof covertOpportunities>[number] | undefined) {
  const w = ctx.world;
  const terms = covertPreparationQuote(order.preparation);
  const quote = { price: terms.crowns, ready: w.year + Math.max(2, terms.years), returnYear: w.year + Math.max(2, terms.years) + 1 };
  const refuse = (reason: string) => ({ ...quote, ok: false, reason });
  if (w.covert.operations.some(open)) return refuse(msg(ctx, 'operation.refuse.busy', 'an expedition is already committed'));
  const last = w.covert.operations.at(-1)?.plan.preparedAt ?? -Infinity;
  if (w.year - last < COVERT_OPERATION_COOLDOWN) return refuse(msg(ctx, 'operation.refuse.interval', 'the house has not recovered from its last expedition'));
  if (!opportunity || !opportunity.purposes.includes(order.purpose)) return refuse(msg(ctx, 'operation.refuse.opportunity', 'that purpose has no current opportunity against this person'));
  const p = w.people.get(order.operative);
  if (!p || !isCurrentFamily(ctx, p) || !available(ctx, p) || w.mystic.assignments.some(a => a.practitioner === p.id)) {
    return refuse(msg(ctx, 'operation.refuse.person', 'that person cannot leave on this expedition'));
  }
  const againstUs = [...w.relationships.values()].some(r => r.from === p.id
    && (r.to === w.playerHouse || w.people.get(r.to)?.castSlots.includes('head')) && r.grudges.some(g => g.severity >= 60));
  if (againstUs || p.contract && p.contract.loyalty < 40) return refuse(msg(ctx, 'operation.refuse.willingness', 'they will not undertake this purpose for the house'));
  if (w.treasury - quote.price < DEBT_FLOOR) return refuse(msg(ctx, 'operation.refuse.cost', 'the house cannot pay for this preparation'));
  return { ...quote, ok: true, reason: undefined };
}

export function quoteCovertOperation(ctx: SimCtx, order: PreparationOrder) {
  return quotePreparation(ctx, order, covertOpportunities(ctx).find(o => o.id === order.opportunity));
}

export function prepareCovertOperation(ctx: SimCtx, order: PreparationOrder): OrderResult {
  const quote = quoteCovertOperation(ctx, order);
  if (!quote.ok) return quote;
  const w = ctx.world;
  const opportunity = covertOpportunities(ctx).find(o => o.id === order.opportunity)!;
  const operative = w.people.mustGet(order.operative);
  const id = `cop_${(w.counters.covert += 1).toString(36)}`;
  w.treasury -= quote.price;
  w.covert.operations.push({
    opportunity: opportunity.id, purpose: order.purpose,
    targetHouse: currentMembership(opportunity.target, w.year)!.house,
    targetMembershipFrom: currentMembership(opportunity.target, w.year)!.from,
    plan: { id, sponsor: opportunity.sponsor.id, operative: operative.id, target: opportunity.target.id,
      motive: { kind: 'grudge', grudge: opportunity.grudge }, site: { kind: 'covert', operation: id }, bindings: {},
      preparation: order.preparation, preparedAt: w.year, attemptYear: quote.ready, paidCrowns: quote.price },
    stage: 'preparing', defence: { guards: [], response: 'ordinary', paidCrowns: 0 }, enemyWarned: false,
    crew: [], supportService: [],
  });
  pauseDutyStudy(ctx, operative.id, id);
  trackKnownRivalHead(ctx, opportunity.target.id);
  account(ctx, [operative.id, opportunity.target.id], msg(ctx, 'operation.prepared',
    '{PERSON} undertook the expedition concerning {TARGET}. The house paid {PRICE} crowns to prepare. The attempt is due in {YEAR}; any survivors must still make the return journey. Learned support can be assigned before then.',
    { PERSON: operative.name, TARGET: opportunity.target.name, PRICE: String(quote.price), YEAR: String(quote.ready) }));
  return { ok: true };
}

function returnJourney(ctx: SimCtx, o: CovertOperation, result: NonNullable<CovertOperation['result']>, receipt: string): void {
  o.stage = 'returning'; o.result = result; o.resolvedAt = ctx.world.year; o.returnsAt = ctx.world.year + 1; o.receipt = receipt;
  account(ctx, [...covertParticipants(ctx, o.plan.id), o.plan.target], receipt);
}

export function withdrawCovertOperation(ctx: SimCtx, id: string): OrderResult {
  const o = active(ctx, id);
  if (!o || o.stage === 'returning' || ctx.world.year >= o.plan.attemptYear) return {
    ok: false, reason: msg(ctx, 'operation.refuse.withdraw', 'that expedition can no longer be withdrawn before its attempt'),
  };
  returnJourney(ctx, o, 'withdrawn', msg(ctx, 'operation.withdrawn',
    'The house recalled the expedition concerning {TARGET}. The preparation was already spent, and the opportunity is used. The people and their unfinished studies wait for the return journey.',
    { TARGET: ctx.world.people.mustGet(o.plan.target).name }));
  return { ok: true };
}

function prepareDefence(ctx: SimCtx, o: CovertOperation): void {
  const w = ctx.world;
  const target = w.people.get(o.plan.target);
  const house = target && currentMembership(target, w.year)?.house;
  if (!house || target?.status !== 'alive' || !resolvePresence(ctx, o.plan.site, {}).people.includes(target.id)) return;
  const guards = resolvePresence(ctx, o.plan.site, {}).people.filter(id => !covertGuardGap(ctx, o.plan, [id])).sort().slice(0, 3);
  while (guards.length && dutyFunds(ctx, house) < covertDefenceQuote(guards.length, 'ordinary')) guards.pop();
  const price = covertDefenceQuote(guards.length, 'ordinary');
  if (price) spendForeign(ctx, house, price);
  o.defence = { guards, response: 'ordinary', paidCrowns: price };
  const seen = observeCovertApproach(ctx, o.plan, o.defence);
  o.enemyWarned = seen.kind === 'approach' && seen.warning !== undefined;
  if (seen.kind === 'approach' && seen.support) noteHouseholdProtection(ctx, seen.support);
  if (o.enemyWarned) {
    const response = guards.length ? 'escort' : 'safe_lodging';
    const extra = covertDefenceQuote(guards.length, response) - price;
    if (dutyFunds(ctx, house) >= extra) {
      spendForeign(ctx, house, extra);
      o.defence = { guards, response, paidCrowns: price + extra };
    }
    // React to a real warning with books the house's actual residents already
    // know. This neither mints a defender nor reads the player's repertoire.
    const rank = { survival: 0, prevention: 1, warning: 2 };
    const workings = ctx.content.mysticWorkings.filter(d => d.benefit.kind === 'household_protection')
      .sort((a, b) => a.benefit.kind === 'household_protection' && b.benefit.kind === 'household_protection'
        ? rank[a.benefit.stage] - rank[b.benefit.stage] : 0);
    for (const working of workings) {
      const benefit = working.benefit;
      if (benefit.kind !== 'household_protection') continue;
      const target = benefit.scope === 'person' ? { kind: 'person' as const, person: o.plan.target }
        : { kind: 'hall' as const, hall: { slot: 'HOME' } };
      const bindings: Record<string, string> = benefit.scope === 'person' ? {} : { HOME: o.plan.target };
      for (const p of [...w.people.household(house, w.year)].sort((a, b) => a.id.localeCompare(b.id))) {
        const order = { person: p.id, working: working.id, target, bindings };
        if (quoteDuty(ctx, order, house).ok) { commitDuty(ctx, order, house); break; }
      }
    }
  }
}

/** A real copied account of the participant's identity; never proof of an unseen patron. */
function retainExposure(ctx: SimCtx, o: CovertOperation, actor: string, witnesses: string[], basis: 'capture' | 'testimony'): void {
  if (o.exposure) return;
  const house = o.targetHouse;
  if (!house || !ctx.world.people.get(actor)) return;
  o.exposure = { year: ctx.world.year, actor, witnesses: [...witnesses], basis };
  addGrudge(ctx, house, ctx.world.playerHouse,
    { severity: o.result === 'success' ? 75 : 55, inheritance: 'house_wide' }, 'covert_operation_attempt', o.page);
}

function resolveOperation(ctx: SimCtx, o: CovertOperation): void {
  const w = ctx.world;
  const defence = { ...o.defence, guards: o.defence.guards.filter(id => !covertGuardGap(ctx, o.plan, [id])) };
  if (defence.response === 'escort' && !defence.guards.length) defence.response = 'ordinary';
  const result = resolveCovertAttempt(ctx, o.plan, defence, 'attempt', undefined, { forewarned: o.enemyWarned });
  const target = w.people.get(o.plan.target);
  const operative = w.people.get(o.plan.operative);
  const membership = target && currentMembership(target, w.year);
  if (result.kind === 'refused' || !target || !operative || !isCurrentFamily(ctx, operative)
    || (operative.fieldRecoveryUntil ?? 0) > w.year
    || operative.career && ctx.content.career(operative.career.career)?.resident !== 'home'
    || membership?.house !== o.targetHouse || membership.from !== o.targetMembershipFrom) {
    returnJourney(ctx, o, 'cancelled', msg(ctx, 'operation.cancelled',
      'The opportunity concerning {TARGET} was gone before the attempt. The preparation was spent. Any survivors must still return.',
      { TARGET: target?.name ?? o.plan.target }));
    return;
  }
  const specialists = covertSupport(ctx, o.plan.site);
  const carer = specialists.find(s => s.role === 'recovery');
  const injuryDraw = streamFor(w, 'covert_recovery', o.plan.id).next();
  const injuryChance = defence.guards.length ? .12 + defence.guards.length * .04 : 0;
  const injured = result.operative !== 'captured' && injuryDraw < Math.max(0, injuryChance - (carer?.bonus ?? 0));
  const effects: Effect[] = result.normal.effects.map(e => e.kind === 'status'
    ? { ...e, cause: msg(ctx, 'operation.death_cause', 'an attack') } : e);
  if (result.operative === 'captured') effects.push({ kind: 'status', status: 'missing', target: { slot: 'OPERATIVE' },
    captivity: { captor: currentMembership(target, w.year)!.house, ransom: 60 } });
  if (injured) effects.push({ kind: 'attribute', target: { slot: 'OPERATIVE' }, attr: 'health', delta: -12 });
  const normalText = result.target === 'dead'
    ? msg(ctx, 'operation.result.dead', '{TARGET} died before the expedition returned. The account names {PERSON}, and leaves the house to reckon with the years after.', { TARGET: target.name, PERSON: operative.name })
    : result.target === 'wounded'
      ? msg(ctx, 'operation.result.wounded', '{TARGET} survived with an injury. The expedition concerning that life is entered under {PERSON}’s name.', { TARGET: target.name, PERSON: operative.name })
      : msg(ctx, 'operation.result.failed', 'The expedition did not reach {TARGET}. {PERSON}’s preparation was spent, and the opportunity is used.', { TARGET: target.name, PERSON: operative.name });
  const normal = OutcomeS.parse({ id: result.target, text: normalText, effects,
    primordial: { id: 'liberty_kept', record: null,
      // The victim's already resolved harm remains. This emergency answers
      // the family's proposed captivity, not a promise to revive its enemy.
      effects: effects.filter(e => e.kind !== 'status' || !e.captivity),
      text: msg(ctx, 'operation.result.rescued', 'The expedition concerning {TARGET} ended with {PERSON} still free. The room changed before the guards could keep that life there.',
        { TARGET: target.name, PERSON: operative.name }),
    },
  });
  const event = EventTemplateS.parse({ id: 'covert_operation_attempt', title: msg(ctx, 'operation.title', 'An expedition entered in the account'),
    tier: 'family', frequency: 'uncommon', purposes: ['change_relationship', 'test_magic_rule', 'worldbuild_through_action'],
    site: o.plan.site, body: '', interaction: { kind: 'narration', outcomes: [normal] },
  });
  const committed = commitOutcome(ctx, event, normal, { COVERT_TARGET: target.id, OPERATIVE: operative.id }, undefined,
    streamFor(w, 'covert_operation_commit', o.plan.id), undefined, 'incident');
  o.page = committed.entryId;
  o.observation = committed.primordial ? {
    occurrence: o.plan.id, year: w.year, target: target.id,
    result: target.status === 'dead' ? 'dead' : result.target === 'wounded' ? 'wounded' : 'prevented', witnesses: [],
  } : result.observation ? structuredClone(result.observation) : {
    occurrence: o.plan.id, year: w.year, target: target.id, result: 'prevented', witnesses: [],
  };
  o.result = target.status === 'dead' ? 'success' : result.target === 'wounded' ? 'partial' : 'failed';
  o.operativeFate = committed.primordial ? 'rescued' : operative.captivity ? 'captured' : injured ? 'injured' : 'escaped';
  if (injured) operative.fieldRecoveryUntil = w.year + 2;
  for (const id of result.offensiveSupport ?? []) noteCovertSupport(ctx, id);
  if (carer && !injured && result.operative !== 'captured' && injuryDraw < injuryChance) noteCovertSupport(ctx, carer.assignment.id);
  for (const use of result.support ?? []) noteHouseholdProtection(ctx, use.assignment);
  if (!committed.primordial && o.observation.identifiedOperative) {
    const actor = o.observation.witnesses[0];
    if (actor) retainExposure(ctx, o, actor, o.observation.witnesses, operative.captivity ? 'capture' : 'testimony');
  }
  o.stage = 'returning'; o.resolvedAt = w.year; o.returnsAt = w.year + 1; o.receipt = committed.text;
  account(ctx, [operative.id], operative.captivity
    ? msg(ctx, 'operation.captured', '{PERSON} is held after the expedition. The fixed ransom and the real home to return to are entered with the other captives.', { PERSON: operative.name })
    : msg(ctx, 'operation.returning', '{PERSON} began the return journey. The house cannot put the same person to work at home before it ends.', { PERSON: operative.name }));
}

/** The operation owns its clock. No player-supplied plan, payment or odds enter the resolver. */
export function tickCovertOperations(ctx: SimCtx): void {
  const w = ctx.world;
  for (const o of w.covert.operations.filter(open)) {
    if (o.stage === 'returning') {
      if ((o.returnsAt ?? Infinity) > w.year) continue;
      const people = covertParticipants(ctx, o.plan.id);
      o.stage = 'closed';
      finishCovertService(ctx, o.plan.id, w.year - 1);
      account(ctx, people, msg(ctx, 'operation.account_closed', 'The expedition’s service account closed. Those who returned can take up work and the remaining terms of their books; anyone still captive remains held.'));
      continue;
    }
    if (w.year === o.plan.attemptYear - 1 && o.stage === 'preparing') {
      prepareDefence(ctx, o); o.stage = 'approach';
      account(ctx, [o.plan.operative], msg(ctx, 'operation.approach', 'The expedition reached its approach. The house can still recall it before the attempt; no report names every watcher behind the doors.'));
    }
    if (w.year === o.plan.attemptYear) resolveOperation(ctx, o);
    else if (w.year > o.plan.attemptYear) returnJourney(ctx, o, 'cancelled', msg(ctx, 'operation.missed_window', 'The expedition missed its window. Its people must return, and the spent opportunity cannot be tried again.'));
  }
}

function purposeName(ctx: SimCtx, purpose: CovertPurpose): string {
  switch (purpose) {
    case 'answer_attack': return msg(ctx, 'operation.purpose.attack', 'Answer the earlier attack');
    case 'settle_grudge': return msg(ctx, 'operation.purpose.grudge', 'Settle the recorded grudge');
    default: return assertNever(purpose, 'operation purpose');
  }
}

function stageName(ctx: SimCtx, stage: CovertOperation['stage']): string {
  switch (stage) {
    case 'preparing': return msg(ctx, 'operation.stage.preparing', 'Preparing');
    case 'approach': return msg(ctx, 'operation.stage.approach', 'At the approach');
    case 'returning': return msg(ctx, 'operation.stage.returning', 'Returning');
    case 'closed': return msg(ctx, 'operation.stage.closed', 'Account closed');
    default: return assertNever(stage, 'operation stage');
  }
}

function resultName(ctx: SimCtx, result: CovertOperation['result']): string {
  switch (result) {
    case 'success': return msg(ctx, 'operation.result_label.success', 'The intended life ended');
    case 'partial': return msg(ctx, 'operation.result_label.partial', 'The intended person survived injured');
    case 'failed': return msg(ctx, 'operation.result_label.failed', 'The attempt failed');
    case 'withdrawn': return msg(ctx, 'operation.result_label.withdrawn', 'Recalled before the attempt');
    case 'cancelled': return msg(ctx, 'operation.result_label.cancelled', 'The opportunity expired');
    case undefined: return '';
    default: return assertNever(result, 'operation result');
  }
}

function fateName(ctx: SimCtx, fate: CovertOperation['operativeFate']): string {
  switch (fate) {
    case 'escaped': return msg(ctx, 'operation.fate.escaped', 'The operative got away');
    case 'captured': return msg(ctx, 'operation.fate.captured', 'The operative was captured');
    case 'rescued': return msg(ctx, 'operation.fate.rescued', 'The operative’s liberty was kept');
    case 'injured': return msg(ctx, 'operation.fate.injured', 'The operative was injured');
    case undefined: return '';
    default: return assertNever(fate, 'operative fate');
  }
}

function preparationName(ctx: SimCtx, preparation: CovertPreparation): string {
  switch (preparation) {
    case 'hasty': return msg(ctx, 'operation.preparation.hasty', 'A short preparation');
    case 'careful': return msg(ctx, 'operation.preparation.careful', 'A careful preparation');
    default: return assertNever(preparation, 'operation preparation');
  }
}

/** The house's orders and received accounts only: no hidden guard, ward,
 * warning roll, true enemy capability or undiscovered testimony is projected. */
export function covertOperationsView(ctx: SimCtx) {
  const w = ctx.world;
  const current = w.covert.operations.filter(open);
  const opportunities = current.length ? [] : covertOpportunities(ctx);
  const people = opportunities.length ? w.people.household(w.playerHouse, w.year).filter(p => isCurrentFamily(ctx, p) && available(ctx, p)) : [];
  const offers = opportunities.flatMap(o => people.flatMap(p => o.purposes.flatMap(purpose => CovertPreparationS.options.map(preparation => {
    const order = { kind: 'covertPrepare' as const, opportunity: o.id, operative: p.id, purpose, preparation };
    const quote = quotePreparation(ctx, order, o);
    return { order, ...quote, target: o.target.id, targetName: o.target.name,
      house: w.houses.get(currentMembership(o.target, w.year)!.house)?.name ?? '', operativeName: p.name,
      purpose: purposeName(ctx, purpose),
      preparation: preparationName(ctx, preparation) };
  }))));
  const record = (o: CovertOperation) => {
    const duty = w.mystic.assignments.filter(a => a.target.kind === 'covert' && a.target.operation === o.plan.id);
    return { id: o.plan.id, target: o.plan.target, name: w.people.get(o.plan.target)?.name ?? '',
      operative: w.people.get(o.plan.operative)?.name ?? '', stage: o.stage, stageName: stageName(ctx, o.stage),
      attemptYear: o.plan.attemptYear, returnsAt: o.returnsAt, result: resultName(ctx, o.result), fate: fateName(ctx, o.operativeFate),
      paid: o.plan.paidCrowns + o.supportService.reduce((sum, s) => sum + s.service.spent, 0) + duty.reduce((sum, a) => sum + a.service.spent, 0),
      crew: [...new Set([o.plan.operative, ...o.crew])].map(id => w.people.get(id)?.name ?? ''),
      receipt: o.receipt, page: o.page,
      canWithdraw: o.stage !== 'closed' && o.stage !== 'returning' && w.year < o.plan.attemptYear,
    };
  };
  return { offers, current: current.map(record), history: w.covert.operations.filter(o => !open(o)).slice(-6).reverse().map(record),
    cases: w.covert.operations.filter(o => o.exposure?.heardAt !== undefined).map(o => ({ id: o.plan.id,
      year: o.exposure!.heardAt!, receipt: o.exposure!.receipt })),
    terms: msg(ctx, 'operation.terms',
      'This expedition is sent against one named enemy’s life. Only one can be committed at a time. Preparation is paid now and is not returned. Preparing and reaching the attempt take two years; survivors need another year to return. The attempt can fail or leave its operative injured or captive. Learned support has its own quoted fee and upkeep, and stays away until that return. Capture carries a fixed ransom of 60 crowns. A failed or recalled expedition consumes its opportunity. A known participant can leave copied testimony and an inherited quarrel, without proving who privately sent them.'),
  };
}
