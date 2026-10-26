/** #1877/#1878: public-session strategies, paired fixed seeds and inert full-save observers.
 * Run with tsx --tsconfig tsconfig.base.json <this file> [runs=24] [seedBase=187700] [output.json].
 * Descriptive evidence; failed product goals remain findings, never substitute gate passes.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { ALL_AFFINITIES, RESPECT_ORDER, type AffinityName, type Content, type MysticService, type TableOrder } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { livingBlood } from '../ending.js';
import { landCrownsPerYield } from '../land.js';
import { civilianApplication } from '../mystic-civilian.js';
import { hasLearned, liveDuties, mysticTargets, practitionerGap, quoteDuty } from '../mystic.js';
import { outsideServicesView } from '../mystic-contracts.js';
import { GameSession, newGame } from '../session.js';
import { canonical } from '../save.js';
import { expectMean, expectRate } from '../testing.js';
import { attachMysticLedger, emptyMysticLedger, noteMysticOrder, sampleMysticYear } from './mystic-accounting.js';
import { meanEvidence, rateEvidence } from './mystic-baseline.js';

export const REPERTOIRE_POLICIES = ['no_extra', 'narrow', 'broad'] as const;
type Policy = typeof REPERTOIRE_POLICIES[number];
const focusOf = (policy: Policy): readonly AffinityName[] => policy === 'narrow' ? ['death', 'darkness'] : ALL_AFFINITIES;

/** At most one training purchase/order each year. Only public quotes and completed books guide it. */
function train(s: GameSession, content: Content, focus: readonly AffinityName[], elapsed: number, send: (o: TableOrder) => boolean): void {
  const table = s.table(); const offset = elapsed % focus.length;
  const priorities = [...focus.slice(offset), ...focus.slice(0, offset)];
  const lot = table.auction?.items.find(l => l.kind === 'spellbook' && !l.bid && l.reserve * 2 <= table.treasury
    && content.spellbooks.some(b => b.name === l.name && priorities.includes(b.affinity)));
  if (lot && send({ kind: 'lotBid', lot: lot.id, bid: { currency: 'coin', amount: Math.round(lot.reserve * 1.5) } })) return;
  const missing = table.missingPrimers.filter(b => priorities.includes(b.affinity as AffinityName) && !b.queued && b.canPay
    && b.fee + b.reserve * 2 <= table.treasury).sort((a,b) => priorities.indexOf(a.affinity as AffinityName) - priorities.indexOf(b.affinity as AffinityName) || a.book.localeCompare(b.book))[0];
  if (elapsed % 12 === 0 && missing && send({ kind: 'seekBook', book: missing.book })) return;
  const busy = new Set(table.studying.map(r => r.person));
  const next = table.shelf.filter(r => priorities.includes(content.mustSpellbook(r.book).affinity))
    .flatMap(r => r.readers.filter(p => !busy.has(p.person)).map(p => ({ person:p.person, book:r.book, affinity:content.mustSpellbook(r.book).affinity })))
    .sort((a,b) => priorities.indexOf(a.affinity) - priorities.indexOf(b.affinity) || a.book.localeCompare(b.book) || a.person.localeCompare(b.person))[0];
  if (next) send({ kind: 'study', person:next.person, book:next.book });
}

/** Bounded public practice: two family duties, one outside service, and no hidden enemy truth. */
function practise(s: GameSession, content: Content, focus: readonly AffinityName[], elapsed: number, send: (o: TableOrder) => boolean): void {
  let table = s.table();
  for (const captive of table.captives) if (captive.ok && table.treasury >= captive.price + 30) { send({kind:'ransom',person:captive.person}); return; }
  const threat = table.security.threats[0];
  const response = threat?.options.filter(o => o.ok && o.price + 30 <= table.treasury).sort((a,b) => b.price - a.price)[0];
  if (response) { send(response.order); return; }
  // A project team is released after the actual price reduction is committed.
  const finished = table.mystic.duties.find(d => content.mysticWorking(d.working)?.benefit.kind === 'project_support' && d.service.usefulYears > 0);
  if (finished) { send({kind:'mysticRelease',assignment:finished.id}); return; }
  const promise = table.outsideServices.returns.find(o => o.ok && table.treasury >= o.price + o.upkeep * 5 + 30);
  if (promise) { send(promise.order); return; }
  if (elapsed % 12 === 0) {
    const contract = table.outsideServices.commissions.find(o => o.ok && focus.includes(content.mysticWorking(o.order.working)!.affinity)
      && o.income > o.price + o.upkeep * (o.ends - o.ready + 1) && table.treasury >= o.price + 30);
    if (contract) { send(contract.order); return; }
  }
  if (s.view().ages.some(age => age.age === 'the_wars' || age.age === 'the_plague')) {
    const hire = table.outsideServices.hires.find(o => o.ok && focus.includes(content.mysticWorking(o.order.working)!.affinity)
      && ['life_care','field_care','field_supply'].includes(content.mysticWorking(o.order.working)!.benefit.kind)
      && table.treasury >= o.price + o.upkeep * (o.ends - o.ready + 1) + 30);
    if (hire) { send(hire.order); return; }
  }
  if (table.mystic.duties.length < 2) {
    const rank = (kind: string) => kind === 'convalescence' ? 0 : kind === 'project_support' ? 1 : kind === 'life_care' ? 2
      : kind === 'household_provision' ? 3 : kind === 'field_care' ? 4 : kind === 'field_supply' ? 5
        : kind === 'teaching' ? 6 : kind === 'library_care' ? 7 : 8;
    const offers = table.mystic.offers.filter(o => focus.includes(o.affinity as AffinityName) && o.practitioners.length && o.targets.length)
      .sort((a,b) => rank(a.benefit) - rank(b.benefit) || a.preparation + a.upkeep * 5 - b.preparation - b.upkeep * 5 || a.working.localeCompare(b.working));
    for (const offer of offers) {
      if (table.treasury < offer.preparation + offer.upkeep * 5 + 30) continue;
      const working = content.mysticWorking(offer.working)!;
      if (working.benefit.kind === 'project_support' && elapsed % 20 < 16) continue;
      // Do not pay half a collaborative team when the other learned person is absent.
      const partner = working.collaborator ? table.mystic.offers.find(o => o.working === working.collaborator) : undefined;
      const reader = [...offer.practitioners].sort((a,b) => Number(Boolean(a.studying)) - Number(Boolean(b.studying)) || a.person.localeCompare(b.person))[0]!;
      if (working.collaborator && !table.mystic.duties.some(d => d.working === working.collaborator)
        && !partner?.practitioners.some(p => p.person !== reader.person)) continue;
      const target = offer.targets.find(t => t.target.kind === 'hall' && t.target.hall === 'main') ?? offer.targets[0]!;
      if (send({ kind:'mysticAssign',person:reader.person,working:offer.working,target:target.target,bindings:target.bindings })) return;
    }
  }
  table = s.table();
  if (elapsed % 20 === 0 && !table.outsideServices.contracts.length && table.treasury >= 60 && table.outsideServices.search.ok)
    send({kind:'mysticSearch'});
}

type RecordRow = { working: string; practitioner: string; started: number; ended?: number; service: MysticService };
const hashSave = (s: GameSession) => createHash('sha256').update(canonical({...s.save(),savedAt:''})).digest('hex');

export function playRepertoireCampaign(content: Content, seed: number, campaign: 'short'|'long', policy: Policy, observed = true) {
  const s = newGame(content,{seed,campaign,decider:'chronicler'}); const ledger=emptyMysticLedger();
  const metrics = { orders:0, refused:0, orderSpending:{} as Record<string,number>, decisionAnswers:0,
    availablePersonYears:0, trainedUnassignedPersonYears:0, dutyYears:0, paidDutyYears:0, pausedStudyYears:0,
    homeCoverageLostYears:0, fieldYears:0, outsideYears:0, enemyPaidDutyYears:0, yieldCoinEstimate:0,
    byWorking:{} as Record<string,{availableYears:number;selectedYears:number;paidYears:number}>, records:{} as Record<string,RecordRow>,
    trainedGenerations:[] as number[], usefulDomains:{} as Record<string,string[]> };
  if(observed){attachMysticLedger(s.ctx,ledger);s.ctx.observeDecision=()=>{metrics.decisionAnswers++;};}
  const send=(o:TableOrder)=>{
    const before=s.ctx.world.treasury;const result=s.order(o);
    if(observed){metrics.orders++;if(!result.ok)metrics.refused++;else metrics.orderSpending[o.kind]=(metrics.orderSpending[o.kind]??0)+before-s.ctx.world.treasury;
      noteMysticOrder(ledger,o,result,before-s.ctx.world.treasury);}
    return result.ok;
  };
  const previousYield = new Map<string,number>();
  const sample=()=>{
    const ctx=s.ctx,w=ctx.world;sampleMysticYear(ctx,ledger);
    const family=w.people.household(w.playerHouse,w.year);const available=new Set<string>();
    const assigned=new Set(w.mystic.assignments.filter(a=>!a.house).map(a=>a.practitioner));
    const commissions=outsideServicesView(ctx).commissions;
    for(const working of content.mysticWorkings){
      const row=metrics.byWorking[working.id]??={availableYears:0,selectedYears:0,paidYears:0};
      const targets=mysticTargets(ctx,working);
      const eligible=family.filter(p=>hasLearned(p,working)&&!practitionerGap(ctx,p,working)&&!assigned.has(p.id)
        && (working.benefit.kind==='commission' ? commissions.some(o=>o.ok&&o.order.person===p.id&&o.order.working===working.id)
          : targets.some(t=>quoteDuty(ctx,{person:p.id,working:working.id,target:t.target,bindings:t.bindings}).ok)));
      row.availableYears+=eligible.length;for(const p of eligible)available.add(p.id);
      const selected=w.mystic.assignments.filter(a=>!a.house&&a.working===working.id);row.selectedYears+=selected.length;
      row.paidYears+=liveDuties(ctx,working.benefit.kind).filter(d=>!d.a.house&&d.working.id===working.id).length;
    }
    metrics.availablePersonYears+=available.size;
    metrics.trainedUnassignedPersonYears+=family.filter(p=>p.spellsKnown.length&&!assigned.has(p.id)).length;
    const own=w.mystic.assignments.filter(a=>!a.house);metrics.dutyYears+=own.length;
    metrics.paidDutyYears+=own.filter(a=>a.status==='serving'&&a.paidThrough===w.year).length;
    metrics.pausedStudyYears+=w.mystic.pauses.length;
    const away=own.filter(a=>['muster','covert','service'].includes(a.target.kind));
    metrics.fieldYears+=own.filter(a=>a.target.kind==='muster').length;
    metrics.outsideYears+=w.mystic.contracts.filter(c=>c.stage!=='closed').length;
    metrics.homeCoverageLostYears+=Number(away.length>0&&!own.some(a=>['hall','person','book'].includes(a.target.kind)&&a.status==='serving'));
    metrics.enemyPaidDutyYears+=w.mystic.assignments.filter(a=>a.house&&a.status==='serving'&&a.paidThrough===w.year).length;
    const generation=Math.floor((w.year-CAMPAIGNS[campaign].startYear)/25);
    if(family.some(p=>p.spellsKnown.length)&&!metrics.trainedGenerations.includes(generation))metrics.trainedGenerations.push(generation);
    for(const a of [...w.mystic.services,...w.mystic.assignments].filter(a=>!a.house)){
      const ended='ended' in a&&typeof a.ended==='number'?a.ended:undefined;
      metrics.records[a.id]={working:a.working,practitioner:a.practitioner,started:a.started,ended,service:structuredClone(a.service)};
      const last=previousYield.get(a.id)??0;const now=a.service.yieldKept;
      metrics.yieldCoinEstimate+=Math.max(0,now-last)*landCrownsPerYield(ctx);previousYield.set(a.id,now);
      if(a.service.lastUseful===w.year){
        const domain=civilianApplication(content.mysticWorking(a.working)!)??'conflict';
        const domains=metrics.usefulDomains[generation]??=[];if(!domains.includes(domain))domains.push(domain);
      }
    }
  };
  for(let elapsed=0;elapsed<CAMPAIGNS[campaign].years&&!s.ctx.world.ending;elapsed++){
    if(s.pending.length)s.letHimDecide();
    if(policy!=='no_extra'){practise(s,content,focusOf(policy),elapsed,send);train(s,content,focusOf(policy),elapsed,send);}
    // Identical nonmagical project policy in every column; a real quote pays for every project.
    if(elapsed%20===0){const parcel=s.land().held.find(p=>p.canImprove&&p.improveCost+40<=s.table().treasury);if(parcel)send({kind:'improve',parcel:parcel.parcel});}
    s.keepSuggestedNames();s.advance();if(observed)sample();
  }
  const w=s.ctx.world,records=Object.values(metrics.records),contracts=w.mystic.contracts;
  const sum=(read:(service:MysticService)=>number)=>records.reduce((n,r)=>n+read(r.service),0);
  const externalFees=(w.mystic.brokerSpent??0)+contracts.reduce((n,c)=>n+c.providerFee,0);
  const commissionIncome=contracts.reduce((n,c)=>n+c.payments.reduce((p,r)=>p+r.amount,0),0);
  const acquisition=Object.values(ledger.costs).reduce((a,b)=>a+b,0);
  return {seed,campaign,policy,years:s.year-CAMPAIGNS[campaign].startYear,fullSaveHash:hashSave(s),metrics,ledger,
    treasury:w.treasury,blood:livingBlood(w),population:w.people.household(w.playerHouse,w.year).length,
    standing:RESPECT_ORDER.indexOf(w.respect),ascension:w.ascension.best,ending:w.ending?.id,
    livesKept:sum(s=>s.livesKept),menKept:sum(s=>s.menKept??0),healthRestored:sum(s=>s.healthRestored??0),
    bookWearKept:sum(s=>s.bookWearKept??0),studyYearsKept:sum(s=>s.studyYearsKept??0),
    coin:{directSavings:sum(s=>s.crownsKept??0),yieldEstimate:metrics.yieldCoinEstimate,commissionIncome,serviceSpent:sum(s=>s.spent),externalFees,acquisition,
      netAttributed:sum(s=>(s.crownsKept??0)-s.spent)+metrics.yieldCoinEstimate+commissionIncome-externalFees-acquisition},
    contracts:{started:contracts.length,fulfilled:contracts.filter(c=>c.result==='fulfilled').length,promises:contracts.filter(c=>c.renewBy!==undefined).length,
      broken:contracts.filter(c=>c.promiseBrokenAt!==undefined).length,honoured:contracts.filter(c=>c.promiseAnswered).length},
    threats:{attempts:w.covert.threats.length,warned:w.covert.threats.filter(t=>t.warned).length,
      prevented:w.covert.threats.filter(t=>t.observation?.result==='prevented').length,
      dead:w.covert.threats.filter(t=>t.observation?.result==='dead').length,wounded:w.covert.threats.filter(t=>t.observation?.result==='wounded').length,
      attributed:w.covert.threats.filter(t=>t.observation?.identifiedOperative).length,
      operations:w.covert.operations.length,exposed:w.covert.operations.filter(o=>o.exposure).length,court:w.covert.operations.filter(o=>o.exposure?.heardAt).length,
      inheritedGrudges:[...w.relationships.values()].flatMap(r=>r.grudges).filter(g=>g.originEvent==='covert_operation_attempt'&&g.inheritance==='house_wide').length},
    readerDeathsDuringService:new Set(records.filter(r=>{const died=w.people.get(r.practitioner)?.died;
      return died!==undefined&&died>=r.started&&(r.ended===undefined||died<=r.ended);}).map(r=>r.practitioner)).size,
    capturedReaders:new Set(records.filter(r=>w.people.get(r.practitioner)?.captivity).map(r=>r.practitioner)).size,
  };
}

type Run=ReturnType<typeof playRepertoireCampaign>;
export function summariseRepertoire(runs:readonly Run[]){
  return (['short','long'] as const).flatMap(campaign=>REPERTOIRE_POLICIES.map(policy=>{
    const rows=runs.filter(r=>r.campaign===campaign&&r.policy===policy);if(!rows.length)return undefined;
    const controls=new Map(runs.filter(r=>r.campaign===campaign&&r.policy==='no_extra').map(r=>[r.seed,r]));
    const estimate=(read:(r:Run)=>number)=>meanEvidence(rows.map(read));
    const paired=(read:(r:Run)=>number)=>meanEvidence(rows.map(r=>read(r)-read(controls.get(r.seed)!)));
    const eligible=rows.filter(r=>Object.values(r.metrics.records).some(d=>d.service.servedYears>=10||d.service.firstUsefulAt!==undefined));
    const within=(r:Run)=>{const duties=Object.values(r.metrics.records).filter(d=>d.service.servedYears>=10||d.service.firstUsefulAt!==undefined);
      return duties.filter(d=>d.service.firstUsefulAt!==undefined&&d.service.firstUsefulAt<=10).length>duties.length/2;};
    const trained=rows.filter(r=>r.metrics.trainedGenerations.length);
    const domains=(r:Run)=>r.metrics.trainedGenerations.reduce((n,g)=>n+(r.metrics.usefulDomains[g]?.filter(d=>d!=='conflict').length??0),0)/r.metrics.trainedGenerations.length;
    const goal=(evaluate:()=>number)=>{try{return {supported:true,marginSE:evaluate()};}catch(e){return {supported:false,reason:(e as Error).message};}};
    return {campaign,policy,runs:rows.length,years:rows.reduce((n,r)=>n+r.years,0),
      trainedHouseFraction:rateEvidence(trained.length,rows.length),availablePersonYears:estimate(r=>r.metrics.availablePersonYears),
      trainedUnassignedPersonYears:estimate(r=>r.metrics.trainedUnassignedPersonYears),dutyYears:estimate(r=>r.metrics.dutyYears),
      paidDutyYears:estimate(r=>r.metrics.paidDutyYears),pausedStudyYears:estimate(r=>r.metrics.pausedStudyYears),
      homeCoverageLostYears:estimate(r=>r.metrics.homeCoverageLostYears),netAttributedCoin:estimate(r=>r.coin.netAttributed),
      directSavings:estimate(r=>r.coin.directSavings),commissionIncome:estimate(r=>r.coin.commissionIncome),externalFees:estimate(r=>r.coin.externalFees),
      livesKept:estimate(r=>r.livesKept),menKept:estimate(r=>r.menKept),studyYearsKept:estimate(r=>r.studyYearsKept),
      decisionsPer25Years:estimate(r=>r.metrics.decisionAnswers/Math.max(1,r.years)*25),
      goals:{usefulWithin10:goal(()=>expectRate({hits:eligible.filter(within).length,n:eligible.length,floor:.5,what:'majority of eligible houses have a majority of duties useful within ten paid years'})),
        civilianDomainsPerTrainedGeneration:goal(()=>expectMean({values:trained.map(domains),floor:2,what:'two actual civilian domains per trained generation'}))},
      paired:{treasury:paired(r=>r.treasury),blood:paired(r=>r.blood),population:paired(r=>r.population),standing:paired(r=>r.standing),
        extinct:rateEvidence(rows.filter(r=>r.blood===0).length,rows.length),endingChanged:rateEvidence(rows.filter(r=>r.ending!==controls.get(r.seed)!.ending).length,rows.length)},
    };
  })).filter(row=>row!==undefined);
}

if(process.argv[1]?.replace(/\\/g,'/').endsWith('/mystic-repertoire-report.ts')){
  const n=Number(process.argv[2]??24),seedBase=Number(process.argv[3]??187700);
  if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(seedBase))throw Error('Expected positive runs and integer seed base');
  const content=loadContent(),samples:Run[]=[],controls:{campaign:string;policy:string;seed:number;equal:boolean}[]=[];
  for(const campaign of ['short','long'] as const)for(const policy of REPERTOIRE_POLICIES)for(let i=0;i<n;i++){
    const run=playRepertoireCampaign(content,seedBase+i,campaign,policy);samples.push(run);
    if(i===0){const unobserved=playRepertoireCampaign(content,seedBase+i,campaign,policy,false);const equal=unobserved.fullSaveHash===run.fullSaveHash;
      controls.push({campaign,policy,seed:seedBase+i,equal});if(!equal)throw Error(`Observer changed full save: ${campaign}/${policy}/${seedBase+i}`);}
    process.stderr.write(`${campaign}/${policy}: ${i+1}/${n}\n`);
  }
  const report={seedBase,runsPerColumn:n,controls,method:{
    policies:'No extra Mystic orders versus Death/Darkness study/practice versus rotating all eight. Same chronicler, ordinary automatic study, naming and 20-year affordable land-project policy. One training and one practice order/year, with real quotes. No hidden rival data.',
    accounting:'Actual service accounts, finite contract payments and fees. Book acquisition includes authored and auction purchases. Yield savings use the current respect-tier land scale without Charm/rent modifiers; report that estimate separately. Lives, physical book wear and study opportunity are not priced as coin.',
    uncertainty:'One independent house per seed; paired differences and standard errors. Product goals pass through expectRate/expectMean; a miss is retained as a finding. No new historical gate is invented.',
    controls:'First seed of every campaign/policy repeated without any instrumentation; SHA256 of the complete canonical save with savedAt blanked.',
  },inventory:ALL_AFFINITIES.map(affinity=>({affinity,workings:content.mysticWorkings.filter(w=>w.affinity===affinity).map(w=>({id:w.id,application:civilianApplication(w)??'conflict',reader:w.benefit.kind,books:w.books,collaborator:w.collaborator}))})),summary:summariseRepertoire(samples),samples};
  if(process.argv[4])writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({controls,summary:report.summary},null,2)+'\n');
}
