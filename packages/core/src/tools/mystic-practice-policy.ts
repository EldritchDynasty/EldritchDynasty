/** #1942: bounded experiments using current and previously seen public photographs only. */
import type { AffinityName, Content, TableOrder } from '@ed/schema';
import type { GameSession } from '../session.js';
import type { TableView } from '../table.js';

export const PRACTICE_VARIANTS = ['budgeted_broad', 'release_idle', 'uncapped', 'observed_rank', 'projects_yearly', 'demand_aware'] as const;
export type PracticeVariant = typeof PRACTICE_VARIANTS[number];
export type Practice = (s: GameSession, content: Content, focus: readonly AffinityName[], elapsed: number,
  send: (order: TableOrder) => boolean) => void;
type Changes = { releaseIdle: boolean; uncapped: boolean; observedRank: boolean; projectsYearly: boolean };

export function practiceChanges(variant: PracticeVariant): Changes {
  return {
    releaseIdle: variant === 'release_idle' || variant === 'demand_aware',
    uncapped: variant === 'uncapped' || variant === 'demand_aware',
    observedRank: variant === 'observed_rank' || variant === 'demand_aware',
    projectsYearly: variant === 'projects_yearly' || variant === 'demand_aware',
  };
}

const rank = (kind: string) => kind === 'convalescence' ? 0 : kind === 'project_support' ? 1 : kind === 'life_care' ? 2
  : kind === 'household_provision' ? 3 : kind === 'field_care' ? 4 : kind === 'field_supply' ? 5
    : kind === 'teaching' ? 6 : kind === 'library_care' ? 7 : 8;

/** One instance per campaign. Remember observed accounts after the six-row history rolls over. */
export function createPracticePolicy(variant: PracticeVariant): Practice {
  const changes = practiceChanges(variant);
  const accounts = new Map<string, { working: string; service: TableView['mystic']['duties'][number]['service'] }>();
  return (s, content, focus, elapsed, send) => {
    const table = s.table();
    for (const duty of table.mystic.duties) accounts.set(duty.id, { working: duty.working, service: { ...duty.service } });
    for (const row of table.mystic.history) {
      const previous = accounts.get(row.id);
      if (previous) accounts.set(row.id, { working: previous.working, service: { ...row.service } });
    }
    const usefulness = (working: string) => {
      const observed = [...accounts.values()].filter(a => a.working === working);
      const paid = observed.reduce((n, a) => n + a.service.servedYears, 0);
      const useful = observed.reduce((n, a) => n + a.service.usefulYears, 0);
      // An untried working gets a trial; no unseen effect or future incident is read.
      return paid === 0 ? 1 : (useful + 1) / (paid + 2);
    };
    for (const captive of table.captives) if (captive.ok && table.treasury >= captive.price + 30) {
      send({ kind: 'ransom', person: captive.person }); return;
    }
    const response = table.security.threats[0]?.options.filter(o => o.ok && o.price + 30 <= table.treasury)
      .sort((a, b) => b.price - a.price)[0];
    if (response) { send(response.order); return; }
    const finished = table.mystic.duties.find(d => content.mysticWorking(d.working)?.benefit.kind === 'project_support'
      && d.service.usefulYears > 0);
    if (finished) { send({ kind: 'mysticRelease', assignment: finished.id }); return; }
    if (changes.releaseIdle) {
      const idle = table.mystic.duties.find(d => d.service.servedYears >= 5 && d.service.usefulYears === 0);
      if (idle) { send({ kind: 'mysticRelease', assignment: idle.id }); return; }
    }
    const promise = table.outsideServices.returns.find(o => o.ok && table.treasury >= o.price + o.upkeep * 5 + 30);
    if (promise) { send(promise.order); return; }
    if (elapsed % 12 === 0) {
      const contract = table.outsideServices.commissions.find(o => o.ok && focus.includes(content.mysticWorking(o.order.working)!.affinity)
        && o.income > o.price + o.upkeep * (o.ends - o.ready + 1) && table.treasury >= o.price + 30);
      if (contract) { send(contract.order); return; }
    }
    if (s.view().ages.some(age => age.age === 'the_wars' || age.age === 'the_plague')) {
      const hire = table.outsideServices.hires.find(o => o.ok && focus.includes(content.mysticWorking(o.order.working)!.affinity)
        && ['life_care', 'field_care', 'field_supply'].includes(content.mysticWorking(o.order.working)!.benefit.kind)
        && table.treasury >= o.price + o.upkeep * (o.ends - o.ready + 1) + 30);
      if (hire) { send(hire.order); return; }
    }
    if (changes.uncapped || table.mystic.duties.length < 2) {
      const offers = table.mystic.offers.filter(o => focus.includes(o.affinity as AffinityName) && o.practitioners.length && o.targets.length)
        .sort((a, b) => (changes.observedRank ? usefulness(b.working) - usefulness(a.working) : rank(a.benefit) - rank(b.benefit))
          || a.preparation + a.upkeep * 5 - b.preparation - b.upkeep * 5 || a.working.localeCompare(b.working));
      for (const offer of offers) {
        if (table.treasury < offer.preparation + offer.upkeep * 5 + 30) continue;
        const working = content.mysticWorking(offer.working)!;
        if (working.benefit.kind === 'project_support' && !changes.projectsYearly && elapsed % 20 < 16) continue;
        const partner = working.collaborator ? table.mystic.offers.find(o => o.working === working.collaborator) : undefined;
        const reader = [...offer.practitioners].sort((a, b) => Number(Boolean(a.studying)) - Number(Boolean(b.studying))
          || a.person.localeCompare(b.person))[0]!;
        if (working.collaborator && !table.mystic.duties.some(d => d.working === working.collaborator)
          && !partner?.practitioners.some(p => p.person !== reader.person)) continue;
        const target = offer.targets.find(t => t.target.kind === 'hall' && t.target.hall === 'main') ?? offer.targets[0]!;
        send({ kind: 'mysticAssign', person: reader.person, working: offer.working, target: target.target, bindings: target.bindings });
        return;
      }
    }
    if (elapsed % 20 === 0 && !table.outsideServices.contracts.length && table.treasury >= 60 && table.outsideServices.search.ok)
      send({ kind: 'mysticSearch' });
  };
}
