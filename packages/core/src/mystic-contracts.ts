import { currentMembership, type MysticContract, type MysticWorkingDef, type Person, type SceneSite } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { OrderResult } from './table.js';
import { DEBT_FLOOR } from './economy.js';
import { activeAgeIds } from './ages/scheduler.js';
import { mintForRole } from './people/minting.js';
import { addGrudge, relate, sentimentBetween } from './people/relationships.js';
import { trackKnownRivalHead } from './people/rivals.js';
import { isCurrentFamily, resolvePresence } from './presence.js';
import { streamFor } from './rng.js';
import { msg } from './messages.js';
import { proseForContentField } from './prose.js';
import { commitDuty, dutyFunds, dutyTerms, fieldTerms, finishContractService, hasLearned, hasWarrant, knownProfessional,
  liveDuties, markUseful, mysticTargets, practitionerGap, quoteDuty, spendForeign, type MysticOrder } from './mystic.js';

export const MYSTIC_BROKER_FEE = 3;
export const MYSTIC_PROVIDER_FEE = 8;
export const MYSTIC_HIRE_YEARS = 3;
export const MYSTIC_CLIENT_INTERVAL = 12;
export const MYSTIC_BROKER_INTERVAL = 10;
export const MYSTIC_PROMISE_YEARS = 20;
const open = (c: MysticContract) => c.stage !== 'closed';
const account = (ctx: SimCtx, text: string, people: string[] = []) => ctx.world.chronicle.push({
  year: ctx.world.year, weight: 'paragraph' as const, named: true, people, text,
});

function busy(ctx: SimCtx): string | undefined {
  return ctx.world.mystic.contracts.some(open)
    ? msg(ctx, 'mystic.contract.busy', 'one outside service is already committed, including its return journey') : undefined;
}

export function quotePractitionerSearch(ctx: SimCtx) {
  const w = ctx.world;
  const scarce = activeAgeIds(ctx).some(id => id === 'the_wars' || id === 'the_plague');
  const quote = { price: MYSTIC_BROKER_FEE, due: w.year + (scarce ? 3 : 1), scarce };
  const reason = w.mystic.search ? msg(ctx, 'mystic.broker.pending', 'the broker has not yet returned')
    : w.year < (w.mystic.lastSearch ?? -Infinity) + MYSTIC_BROKER_INTERVAL ? msg(ctx, 'mystic.broker.interval', 'the broker will take another search in {YEAR}', { YEAR: String(w.mystic.lastSearch! + MYSTIC_BROKER_INTERVAL) })
      : w.treasury - quote.price < DEBT_FLOOR ? msg(ctx, 'mystic.broker.cost', 'the house cannot pay the broker') : undefined;
  return { ...quote, ok: reason === undefined, reason };
}

export function seekPractitioner(ctx: SimCtx): OrderResult {
  const quote = quotePractitionerSearch(ctx);
  if (!quote.ok) return { ok: false, reason: quote.reason };
  const w = ctx.world;
  w.treasury -= quote.price;
  w.mystic.search = { asked: w.year, due: quote.due, paid: quote.price }; w.mystic.lastSearch = w.year;
  w.mystic.brokerSpent = (w.mystic.brokerSpent ?? 0) + quote.price;
  account(ctx, msg(ctx, 'mystic.broker.sent', 'The broker took {PRICE} crowns to seek a warranted reader. An answer is due in {YEAR}; war and plague lengthen the road, and a search promises no particular affinity.',
    { PRICE: String(quote.price), YEAR: String(quote.due) }));
  return { ok: true };
}

function knownClients(ctx: SimCtx) {
  const w = ctx.world;
  return w.people.living().filter(p => p.castSlots.includes('rival') && w.year - p.born >= 16 && !isCurrentFamily(ctx, p)
    && resolvePresence(ctx, { kind: 'person', person: p.id }, {}).people.includes(p.id))
    .map(p => ({ person: p, house: currentMembership(p, w.year)?.house }))
    .filter((row): row is { person: Person; house: NonNullable<typeof row.house> } => row.house !== undefined && row.house !== w.playerHouse)
    .filter((row, i, all) => all.findIndex(r => r.house === row.house) === i);
}

function providerFee(ctx: SimCtx, p: Person | undefined): number { return p && isCurrentFamily(ctx, p) ? 0 : MYSTIC_PROVIDER_FEE; }

function willing(ctx: SimCtx, p: Person): boolean {
  return ![...ctx.world.relationships.values()].some(r => r.from === p.id && r.to === ctx.world.playerHouse && r.grudges.some(g => g.severity >= 60));
}

export function quoteHire(ctx: SimCtx, order: MysticOrder) {
  const p = ctx.world.people.get(order.person);
  const duty = quoteDuty(ctx, { ...order, outside: true });
  const quote = { price: duty.preparation + MYSTIC_PROVIDER_FEE, providerFee: MYSTIC_PROVIDER_FEE,
    workingFee: duty.preparation, upkeep: duty.upkeep, ready: duty.ready, ends: duty.ready + MYSTIC_HIRE_YEARS - 1, returnsAt: duty.ready + MYSTIC_HIRE_YEARS };
  const refuse = (reason: string | undefined) => ({ ...quote, ok: false, reason });
  const occupied = busy(ctx); if (occupied) return refuse(occupied);
  if (!p || isCurrentFamily(ctx, p) || !knownProfessional(ctx, p) || !willing(ctx, p)) return refuse(msg(ctx, 'mystic.hire.person', 'that known warranted reader cannot take this service'));
  const working = ctx.content.mysticWorking(order.working);
  if (!working || working.benefit.kind === 'commission' || working.benefit.kind === 'covert_support') return refuse(msg(ctx, 'mystic.hire.scope', 'this warrant does not cover the proposed service'));
  if (!duty.ok) return refuse(duty.reason);
  if (ctx.world.treasury - quote.price < DEBT_FLOOR) return refuse(msg(ctx, 'mystic.hire.cost', 'the house cannot pay both the reader and the preparation'));
  return { ...quote, ok: true, reason: undefined };
}

export function quoteCommission(ctx: SimCtx, person: string, workingID: string, patron: string, promise?: string) {
  const w = ctx.world;
  const p = w.people.get(person); const working = ctx.content.mysticWorking(workingID);
  const terms = working ? dutyTerms(ctx, working) : { preparation: 0, upkeep: 0, ready: w.year + 1 };
  const b = working?.benefit;
  const years = b?.kind === 'commission' ? b.years : 0;
  const quote = { price: terms.preparation + providerFee(ctx, p), providerFee: providerFee(ctx, p), workingFee: terms.preparation,
    upkeep: terms.upkeep, ready: terms.ready, ends: terms.ready + years - 1, returnsAt: terms.ready + years,
    income: b?.kind === 'commission' && !promise ? b.annualCrowns * years : 0, favour: b?.kind === 'commission' ? b.favour : 0 };
  const refuse = (reason: string | undefined) => ({ ...quote, ok: false, reason });
  const occupied = busy(ctx); if (occupied) return refuse(occupied);
  if (!p || !working || b?.kind !== 'commission' || !hasWarrant(p) || !willing(ctx, p)) return refuse(msg(ctx, 'mystic.commission.reader', 'paid outside work requires an available reader with the actual warrant and books'));
  const gap = practitionerGap(ctx, p, working, { outside: !isCurrentFamily(ctx, p) });
  if (gap || w.mystic.assignments.some(a => a.practitioner === p.id)) return refuse(msg(ctx, 'mystic.commission.unavailable', 'that practitioner is not available for this commission'));
  const client = knownClients(ctx).find(c => c.house === patron);
  const obligation = promise && w.mystic.contracts.find(c => c.id === promise && c.stage === 'closed' && c.result === 'fulfilled'
    && c.patron === patron && c.working === workingID && c.renewBy !== undefined && !c.promiseAnswered);
  if (promise && !obligation) return refuse(msg(ctx, 'mystic.commission.promise_lost', 'that return obligation is no longer open'));
  if (!client && !obligation) return refuse(msg(ctx, 'mystic.commission.client', 'there is no known reachable patron for that work'));
  const previous = w.mystic.contracts.filter(c => c.kind === 'commission' && c.patron === patron).at(-1);
  if (previous && w.year < previous.started + MYSTIC_CLIENT_INTERVAL) return refuse(msg(ctx, 'mystic.commission.interval', 'that house offers no new commission before {YEAR}', { YEAR: String(previous.started + MYSTIC_CLIENT_INTERVAL) }));
  if (dutyFunds(ctx, patron) < quote.income) return refuse(msg(ctx, 'mystic.commission.unfunded', 'that house has not funded this commission'));
  if (w.treasury - quote.price < DEBT_FLOOR) return refuse(msg(ctx, 'mystic.commission.cost', 'the house cannot pay the service preparation'));
  return { ...quote, ok: true, reason: undefined };
}

function start(ctx: SimCtx, c: MysticContract, target: SceneSite, bindings: Record<string,string> = {}): OrderResult {
  const w = ctx.world; const p = w.people.mustGet(c.practitioner);
  w.mystic.contracts.push(c);
  const result = commitDuty(ctx, { person: p.id, working: c.working, target, bindings, contract: c.id,
    outside: !isCurrentFamily(ctx, p) }, w.playerHouse);
  if (!result.ok) { w.mystic.contracts = w.mystic.contracts.filter(x => x !== c); return result; }
  w.treasury -= c.providerFee;
  if (c.patron && c.escrow) spendForeign(ctx, c.patron, c.escrow);
  if (c.patronActor) trackKnownRivalHead(ctx, c.patronActor);
  account(ctx, msg(ctx, 'mystic.contract.started', '{PERSON} undertook {WORKING}. Preparation and the professional fee are paid; work begins in {YEAR}, and the agreed term includes a return journey.',
    { PERSON: p.name, WORKING: workingName(ctx, ctx.content.mysticWorking(c.working)!), YEAR: String(c.ready) }), [p.id]);
  return { ok: true };
}

export function hirePractitioner(ctx: SimCtx, order: MysticOrder): OrderResult {
  const quote = quoteHire(ctx, order); if (!quote.ok) return { ok: false, reason: quote.reason };
  return start(ctx, { id: `msc_${(ctx.world.counters.mystic + 1).toString(36)}`, kind: 'hire', practitioner: order.person, working: order.working,
    stage: 'preparing', started: ctx.world.year, ready: quote.ready, ends: quote.ends,
    providerFee: quote.providerFee, escrow: 0, worked: 0, payments: [] }, order.target, order.bindings);
}

export function undertakeCommission(ctx: SimCtx, person: string, working: string, patron: string, promise?: string): OrderResult {
  const quote = quoteCommission(ctx, person, working, patron, promise); if (!quote.ok) return { ok: false, reason: quote.reason };
  const previous = promise && ctx.world.mystic.contracts.find(c => c.id === promise);
  const c: MysticContract = { id: `msc_${(ctx.world.counters.mystic + 1).toString(36)}`, kind: 'commission', practitioner: person, working, patron,
    patronActor: knownClients(ctx).find(c => c.house === patron)?.person.id || previous && previous.patronActor || undefined,
    ...(promise ? { satisfiesPromise: promise } : {}),
    stage: 'preparing', started: ctx.world.year, ready: quote.ready, ends: quote.ends,
    providerFee: quote.providerFee, escrow: quote.income, worked: 0, payments: [] };
  return start(ctx, c, { kind: 'service', contract: c.id });
}

export function honourServicePromise(ctx: SimCtx, person: string, promise: string): OrderResult {
  const c = ctx.world.mystic.contracts.find(c => c.id === promise);
  if (!c?.patron) return { ok:false, reason: msg(ctx,'mystic.commission.no_promise','there is no recorded patron for that return') };
  return undertakeCommission(ctx,person,c.working,c.patron,promise);
}

function refund(ctx: SimCtx, c: MysticContract): void {
  if (c.escrow && c.patron) {
    const ledger = ctx.world.mystic.foreignSpent ??= {};
    ledger[c.patron] = Math.max(0, (ledger[c.patron] ?? 0) - c.escrow); c.escrow = 0;
  }
}

/** Travel clocks precede the shared reservation; no offer or view mutates the world. */
export function prepareMysticContracts(ctx: SimCtx): void {
  const w = ctx.world; const state = w.mystic;
  if (state.search && state.search.due <= w.year) {
    const p = mintForRole(ctx, 'practitioner', streamFor(w, 'mystic-broker', state.search.asked));
    if (p && hasWarrant(p)) {
      if (!state.contacts.includes(p.id)) state.contacts.push(p.id);
      account(ctx, msg(ctx, 'mystic.broker.found', 'The broker brought a letter naming {PERSON}, a warranted reader. The completed training is entered with the offers; being named is not a promise that the reader is free.', { PERSON: p.name }), [p.id]);
    } else account(ctx, msg(ctx, 'mystic.broker.empty', 'The broker returned without a reader who could take the work. The search fee was spent on the road.'));
    delete state.search;
  }
  for (const c of state.contracts) {
    if (c.stage === 'preparing' && w.year >= c.ready) c.stage = 'working';
    if (c.stage === 'working' && w.year > c.ends) {
      c.stage = 'returning'; c.returnsAt = c.ends + 1;
      c.result ??= 'failed';
    }
    if (c.stage === 'returning' && (c.returnsAt ?? Infinity) <= w.year) {
      c.stage = 'closed'; refund(ctx, c); finishContractService(ctx, c.id);
      const p = w.people.get(c.practitioner);
      c.receipt = msg(ctx, 'mystic.contract.closed', '{PERSON}’s outside service account closed. Those who returned can work again; a person still captive remains held. The paid years and any unfinished books remain on the account.', { PERSON: p?.name ?? c.practitioner });
      account(ctx, c.receipt, p ? [p.id] : []);
      if (c.kind === 'commission' && c.result === 'fulfilled') c.renewBy = w.year + MYSTIC_PROMISE_YEARS;
    }
    if (c.stage === 'closed' && c.renewBy !== undefined && !c.promiseAnswered && c.promiseBrokenAt === undefined && w.year > c.renewBy && c.patron) {
      c.promiseBrokenAt = w.year;
      addGrudge(ctx, c.patron, w.playerHouse, { severity: 15, inheritance: 'house_wide' }, 'mystic_service_promise');
      account(ctx, msg(ctx, 'mystic.contract.promise', 'A letter bearing {HOUSE}’s seal recalled the promised return of a trained reader. The term passed without that service. The promise belonged to the house, rather than to the first worker alone.',
        { HOUSE: w.houses.get(c.patron)?.name ?? c.patron }));
    }
  }
}

/** Completed actual work is credited only through economyReading/tickEconomy. */
export function settleMysticContracts(ctx: SimCtx): void {
  const w = ctx.world;
  const serving = new Set(liveDuties(ctx, 'commission').map(row => row.a.id));
  for (const c of w.mystic.contracts.filter(open)) {
    if (c.stage !== 'working' || w.year < c.ready) continue;
    const a = w.mystic.assignments.find(a => a.contract === c.id);
    const working = ctx.content.mysticWorking(c.working);
    if (a && c.kind === 'hire' && working && c.lastWorked !== w.year
      && liveDuties(ctx, working.benefit.kind).some(row => row.a.id === a.id)) {
      c.worked++; c.lastWorked = w.year;
    }
    if (a && c.kind === 'commission' && serving.has(a.id) && working?.benefit.kind === 'commission'
      && !c.payments.some(p => p.year === w.year)) {
      const amount = c.satisfiesPromise ? 0 : Math.min(c.escrow, working.benefit.annualCrowns);
      c.escrow -= amount; c.payments.push({ year: w.year, amount }); c.worked++;
      if (amount > 0) markUseful(a, w.year);
    }
    if (w.year < c.ends || c.result !== undefined) continue;
    const expected = c.kind === 'hire' ? MYSTIC_HIRE_YEARS : working?.benefit.kind === 'commission' ? working.benefit.years : Infinity;
    c.result = c.worked === expected ? 'fulfilled' : 'failed';
    if (c.kind === 'commission' && c.result === 'fulfilled' && c.patron && working?.benefit.kind === 'commission') {
      const before = sentimentBetween(w, c.patron, w.playerHouse);
      const after = relate(w, c.patron, w.playerHouse, working.benefit.favour).sentiment;
      let honoured = false;
      for (const earlier of w.mystic.contracts) {
        if (earlier === c || earlier.patron !== c.patron || earlier.working !== c.working || earlier.renewBy === undefined || earlier.promiseAnswered) continue;
        if (w.year <= earlier.renewBy || c.satisfiesPromise === earlier.id) {
          earlier.promiseAnswered = true; honoured = true;
        }
      }
      if (a && (after > before || honoured)) markUseful(a, w.year);
    }
  }
}

export function commissionIncome(ctx: SimCtx): number {
  return ctx.world.mystic.contracts.reduce((sum,c) => sum + c.payments.filter(p => p.year === ctx.world.year).reduce((n,p) => n + p.amount, 0), 0);
}

function workingName(ctx: SimCtx, w: MysticWorkingDef): string { return proseForContentField(ctx, 'mysticWorkings', w.id, 'name', w.name); }

export function outsideServicesView(ctx: SimCtx) {
  const w = ctx.world; const occupied = w.mystic.contracts.some(open);
  const professionals = w.mystic.contacts.map(id => w.people.get(id)).filter((p): p is Person => p !== undefined && p.status === 'alive');
  const hires = occupied ? [] : professionals.flatMap(p => ctx.content.mysticWorkings.filter(d => hasLearned(p,d) && d.benefit.kind !== 'commission' && d.benefit.kind !== 'covert_support')
    .flatMap(d => mysticTargets(ctx,d).map(target => {
      const order = { kind: 'mysticHire' as const, person: p.id, working: d.id, target: target.target, bindings: target.bindings };
      return { order, ...quoteHire(ctx, order), person: p.name, working: workingName(ctx,d), place: target.name,
        description: proseForContentField(ctx, 'mysticWorkings', d.id, 'description', d.description), fieldTerms: fieldTerms(ctx,d) };
    })));
  const workers = [...new Map([...w.people.household(w.playerHouse,w.year), ...professionals].map(p => [p.id,p])).values()].filter(p => hasWarrant(p));
  const commissions = occupied ? [] : workers.flatMap(p => ctx.content.mysticWorkings.filter(d => d.benefit.kind === 'commission' && hasLearned(p,d))
    .flatMap(d => knownClients(ctx).map(client => ({ order: { kind: 'mysticCommission' as const, person: p.id, working: d.id, patron: client.house },
      ...quoteCommission(ctx,p.id,d.id,client.house), person: p.name, working: workingName(ctx,d), patron: w.houses.get(client.house)?.name ?? client.house }))));
  const returns = occupied ? [] : w.mystic.contracts.filter(c=>c.renewBy!==undefined&&!c.promiseAnswered&&c.patron).flatMap(c=>
    workers.filter(p=>{const d=ctx.content.mysticWorking(c.working);return d&&hasLearned(p,d);}).map(p=>({
      order:{kind:'mysticReturn' as const,person:p.id,promise:c.id},...quoteCommission(ctx,p.id,c.working,c.patron!,c.id),
      person:p.name,working:workingName(ctx,ctx.content.mysticWorking(c.working)!),patron:w.houses.get(c.patron!)?.name??c.patron! })));
  return { search: quotePractitionerSearch(ctx), hires, commissions, returns,
    contracts: w.mystic.contracts.filter(c => c.stage !== 'closed').map(c => ({ id: c.id, person: w.people.get(c.practitioner)?.name ?? c.practitioner,
      ready: c.ready, ends: c.ends, returnsAt: c.returnsAt ?? c.ends + 1, stage: c.stage, result: c.result, receipt: c.receipt, paid: c.providerFee +
        (w.mystic.assignments.find(a => a.contract === c.id)?.service.spent ?? w.mystic.services.find(a => a.contract === c.id)?.service.spent ?? 0),
      earned: c.payments.reduce((sum,p) => sum + p.amount,0) })),
    history: w.mystic.contracts.filter(c => c.stage === 'closed').slice(-6).reverse().map(c => ({ id:c.id, receipt:c.receipt, ended:c.returnsAt,
      earned:c.payments.reduce((sum,p) => sum + p.amount,0), result:c.result })),
    promises: w.mystic.contracts.filter(c => c.renewBy !== undefined && !c.promiseAnswered).map(c => ({ id:c.id, due:c.renewBy!, overdue:c.promiseBrokenAt!==undefined,
      patron:w.houses.get(c.patron!)?.name ?? c.patron! })),
    terms: msg(ctx, 'mystic.contract.terms', 'A broker search costs {BROKER} crowns and promises no affinity. An outside reader charges {FEE} crowns besides the working’s quoted preparation and upkeep. One outside service can be open at a time. A hire covers {TERM} working years; a commission states its funded pay and term. Travel and return occupy the named person. Their book waits by its remaining term. A completed commission promises a trained reader’s return within {PROMISE} years; that obligation belongs to the house, even after the first worker dies.',
      { BROKER:String(MYSTIC_BROKER_FEE), FEE:String(MYSTIC_PROVIDER_FEE), TERM:String(MYSTIC_HIRE_YEARS), PROMISE:String(MYSTIC_PROMISE_YEARS) }),
  };
}
