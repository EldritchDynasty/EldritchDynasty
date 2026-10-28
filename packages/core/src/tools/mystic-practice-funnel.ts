/** #1942: observational stages. These counters never guide a practice order. */
import { ALL_AFFINITIES, type AffinityName } from '@ed/schema';
import { hasLearned, mysticTargets, practitionerGap, quoteDuty, targetGap } from '../mystic.js';
import { outsideServicesView } from '../mystic-contracts.js';
import type { SimCtx } from '../world.js';

const counters = () => ({
  bookAccessYears: 0, initialKnownBooks: 0, studyStarts: 0, studyCompletions: 0,
  readerYears: 0, occupiedReaderYears: 0, unavailableReaderYears: 0, freeReaderYears: 0,
  targetYears: 0, freeWithTargetYears: 0, affordableReaderYears: 0, missingCollaboratorYears: 0,
  assignedYears: 0, paidYears: 0, usefulYears: 0,
});
export type PracticeFunnelCounts = ReturnType<typeof counters>;
type Stage = 'readerYears' | 'occupiedReaderYears' | 'unavailableReaderYears' | 'freeReaderYears'
  | 'freeWithTargetYears' | 'affordableReaderYears' | 'missingCollaboratorYears';
const pair = (person: string, book: string) => `${person}/${book}`;

export function createPracticeFunnel(ctx: SimCtx) {
  const family = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
  const byAffinity = Object.fromEntries(ALL_AFFINITIES.map(a => [a, counters()])) as Record<AffinityName, PracticeFunnelCounts>;
  const byWorking = Object.fromEntries(ctx.content.mysticWorkings.map(w => [w.id, counters()]));
  const previousKnown = new Set<string>();
  for (const p of family) for (const id of p.spellsKnown) {
    previousKnown.add(pair(p.id, id));
    const book = ctx.content.spellbook(id);
    if (book) byAffinity[book.affinity].initialKnownBooks++;
    for (const working of ctx.content.mysticWorkings) if (working.books.includes(id)) byWorking[working.id]!.initialKnownBooks++;
  }
  return { years: 0, byAffinity, byWorking, previousKnown,
    previousStudies: new Set(ctx.world.studies.map(s => pair(s.person, s.book))) };
}
export type PracticeFunnel = ReturnType<typeof createPracticeFunnel>;

export function samplePracticeFunnel(ctx: SimCtx, funnel: PracticeFunnel): void {
  const w = ctx.world, family = w.people.household(w.playerHouse, w.year);
  const commissions = outsideServicesView(ctx).commissions;
  const occupied = new Set(w.mystic.assignments.map(a => a.practitioner));
  const sets = Object.fromEntries(ALL_AFFINITIES.map(a => [a, {
    readerYears: new Set<string>(), occupiedReaderYears: new Set<string>(), unavailableReaderYears: new Set<string>(),
    freeReaderYears: new Set<string>(), freeWithTargetYears: new Set<string>(), affordableReaderYears: new Set<string>(),
    missingCollaboratorYears: new Set<string>(),
  }])) as Record<AffinityName, Record<Stage, Set<string>>>;
  const access = new Set<AffinityName>(), targetPresent = new Set<AffinityName>();
  const studies = new Set<string>();
  const noteBook = (bookId: string, stage: 'studyStarts' | 'studyCompletions') => {
    const book = ctx.content.spellbook(bookId);
    if (book) funnel.byAffinity[book.affinity][stage]++;
    for (const working of ctx.content.mysticWorkings) if (working.books.includes(bookId)) funnel.byWorking[working.id]![stage]++;
  };
  for (const study of w.studies) {
    const key = pair(study.person, study.book); studies.add(key);
    if (!funnel.previousStudies.has(key)) noteBook(study.book, 'studyStarts');
  }
  funnel.previousStudies = studies;
  for (const p of family) for (const book of p.spellsKnown) {
    const key = pair(p.id, book);
    if (!funnel.previousKnown.has(key)) { noteBook(book, 'studyCompletions'); funnel.previousKnown.add(key); }
  }
  for (const working of ctx.content.mysticWorkings) {
    const row = funnel.byWorking[working.id]!;
    if (working.books.every(id => w.library.has(id))) { row.bookAccessYears++; access.add(working.affinity); }
    const targets = mysticTargets(ctx, working);
    const commission = working.benefit.kind === 'commission';
    if (targets.length || commission && commissions.some(o => o.order.working === working.id)) {
      row.targetYears++; targetPresent.add(working.affinity);
    }
    const note = (stage: Stage, id: string) => { row[stage]++; sets[working.affinity][stage].add(id); };
    for (const p of family.filter(p => hasLearned(p, working))) {
      note('readerYears', p.id);
      if (occupied.has(p.id)) { note('occupiedReaderYears', p.id); continue; }
      if (practitionerGap(ctx, p, working)) { note('unavailableReaderYears', p.id); continue; }
      note('freeReaderYears', p.id);
      const reachable = targets.filter(t => !targetGap(ctx, working, t.target, t.bindings, w.playerHouse, p));
      const contracts = commission ? commissions.filter(o => o.order.working === working.id && o.order.person === p.id) : [];
      if (reachable.length || contracts.length) {
        note('freeWithTargetYears', p.id);
        if (reachable.some(t => quoteDuty(ctx, { person: p.id, working: working.id, target: t.target, bindings: t.bindings }).ok)
          || contracts.some(o => o.ok)) note('affordableReaderYears', p.id);
      }
      if (working.collaborator) {
        const collaborator = ctx.content.mysticWorking(working.collaborator)!;
        const staffed = w.mystic.assignments.some(a => !a.house && a.working === collaborator.id);
        const freePartner = family.some(other => other.id !== p.id && !occupied.has(other.id)
          && !practitionerGap(ctx, other, collaborator));
        if (!staffed && !freePartner) note('missingCollaboratorYears', p.id);
      }
    }
    const assigned = w.mystic.assignments.filter(a => !a.house && a.working === working.id);
    const paid = assigned.filter(a => a.status === 'serving' && a.paidThrough === w.year);
    const useful = [...w.mystic.services, ...assigned].filter(a => !a.house && a.working === working.id && a.service.lastUseful === w.year);
    row.assignedYears += assigned.length; row.paidYears += paid.length; row.usefulYears += useful.length;
    const affinity = funnel.byAffinity[working.affinity];
    affinity.assignedYears += assigned.length; affinity.paidYears += paid.length; affinity.usefulYears += useful.length;
  }
  for (const affinity of ALL_AFFINITIES) {
    const row = funnel.byAffinity[affinity];
    if (access.has(affinity)) row.bookAccessYears++;
    if (targetPresent.has(affinity)) row.targetYears++;
    for (const stage of Object.keys(sets[affinity]) as Stage[]) row[stage] += sets[affinity][stage].size;
  }
  funnel.years++;
}

/** Internal identity sets are sampling state, not report columns. */
export function practiceFunnelReport(funnel: PracticeFunnel) {
  return { years: funnel.years, byAffinity: funnel.byAffinity, byWorking: funnel.byWorking };
}
