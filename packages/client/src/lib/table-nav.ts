import type { SessionView, TableView } from '@ed/core';
import type { HouseAmbitionId, ProseMode } from '@ed/schema';
import type { RevealElement } from './reveal';

/** UI destinations, not orders. The catalogue also owns their anchor names. */
const TARGETS = {
  purse: ['The purse', 'Money and auctions'],
  preferences: ['Standing preferences', 'Saved decisions'],
  greatWork: ['The Great Work', 'Major rites and record search'],
  land: ['The land', 'Land holdings'],
  security: ['Warnings at the door', 'Household security'],
  expeditions: ['Covert expeditions', 'Covert operations'],
  shelf: ['The shelf', 'Family library'],
  duties: ['Standing duties', 'Mystic duties'],
  outsideServices: ['Readers on the road', 'Outside Mystic services'],
  captives: ['Held away', 'Captive family'],
  tutoring: ['A term of tutoring', 'Tutoring'],
  posts: ['Places', 'Career positions'],
  marriages: ['Who the house marries', 'Marriage preferences'],
  programme: ['The programme', 'Family advancement plan'],
  market: ['The market', 'Marriage market'],
  longWait: ['The long wait', 'Men who have not awakened'],
  forcing: ['The forcing rites', 'Rites to force an awakening'],
  papers: ['The papers', 'Marriage papers'],
  servants: ["The house's people", 'Servants and debt contracts'],
} as const;

export type TableTarget = keyof typeof TARGETS;
export const TABLE_TARGETS: readonly TableTarget[] = Object.keys(TARGETS) as TableTarget[];
export type OpenedTablePanels = Partial<Record<TableTarget, boolean>>;
export interface TableReveal { target: TableTarget; token: number }

export function tableTargetLabel(target: TableTarget, mode: ProseMode = 'original'): string {
  return TARGETS[target][mode === 'plainenglish' ? 1 : 0];
}

export function tableTargetAttrs(target: TableTarget) {
  return { id: `table-${target}`, 'data-table-target': target };
}

const TASKS = {
  heir: { title: ['Prepare an heir', 'Prepare an heir'], targets: ['programme', 'tutoring', 'market', 'papers', 'marriages'] },
  reader: { title: ['A reader for the house', 'Train a reader'], targets: ['shelf', 'tutoring', 'duties', 'outsideServices'] },
  protection: { title: ['Protect a relative', 'Protect a family member'], targets: ['security', 'captives', 'expeditions'] },
  rite: { title: ['Prepare a rite', 'Prepare a rite'], targets: ['programme', 'forcing', 'longWait', 'shelf', 'greatWork'] },
} as const satisfies Record<string, { title: readonly [string, string]; targets: readonly TableTarget[] }>;

/** Explicit cross-references cover the whole ambition, including Regency preparation. */
const AMBITIONS: Record<HouseAmbitionId, readonly TableTarget[]> = {
  deepen_blood: ['market', 'papers', 'marriages', 'programme'],
  raise_ascendant: ['programme', 'shelf', 'tutoring', 'duties', 'forcing', 'longWait', 'greatWork'],
  restore_ledger: ['greatWork', 'shelf', 'preferences'],
  secure_branches: ['programme', 'marriages', 'market', 'security', 'land'],
};

export interface TableTask {
  id: keyof typeof TASKS | HouseAmbitionId;
  title: string;
  targets: readonly TableTarget[];
  revealed: boolean;
  offer?: { label: string; reason: string };
}

export interface TableNavigationOptions {
  revealed: ReadonlySet<RevealElement>;
  showEverything?: boolean;
  proseMode?: ProseMode;
}

/** Match only the existing panels' public presence; affordability never hides a route. */
function knownTarget(target: TableTarget, table: TableView, all: boolean): boolean {
  if (all) return true;
  const conditional: Partial<Record<TableTarget, boolean>> = {
    preferences: table.delegation.length > 0,
    forcing: (table.forcing?.length ?? 0) > 0,
    security: table.security.threats.length > 0 || table.security.history.length > 0,
    expeditions: table.expeditions.offers.length > 0 || table.expeditions.current.length > 0
      || table.expeditions.history.length > 0 || table.expeditions.cases.length > 0,
  };
  return conditional[target] !== false;
}

/** Quotes are photographs already supplied by core, never new eligibility rules. */
function currentOffer(id: TableTask['id'], table: TableView, mode: ProseMode): TableTask['offer'] {
  if (id === 'restore_ledger' && !table.ledgerSearch.ready && table.ledgerSearch.reason) {
    return { label: mode === 'plainenglish' ? 'Record search' : 'The old papers', reason: table.ledgerSearch.reason };
  }
  if ((id === 'rite' || id === 'raise_ascendant') && !table.vesselRite.ready && table.vesselRite.reason) {
    return { label: mode === 'plainenglish' ? 'Vessel rite' : 'The Vessel', reason: table.vesselRite.reason };
  }
  if (id === 'reader' && !table.outsideServices.search.ok && table.outsideServices.search.reason) {
    return { label: tableTargetLabel('outsideServices', mode), reason: table.outsideServices.search.reason };
  }
  return undefined;
}

export function tableTasksFor(view: SessionView, table: TableView, options: TableNavigationOptions): TableTask[] {
  const mode = options.proseMode ?? 'original';
  const shown = options.showEverything === true || options.revealed.has('table');
  const make = (id: TableTask['id'], title: string, targets: readonly TableTarget[]): TableTask => ({
    id, title,
    targets: shown ? targets.filter(target => knownTarget(target, table, options.showEverything === true)) : [],
    revealed: shown,
    ...(shown ? { offer: currentOffer(id, table, mode) } : {}),
  });
  const tasks = Object.entries(TASKS).map(([id, task]) => make(id as keyof typeof TASKS,
    task.title[mode === 'plainenglish' ? 1 : 0], task.targets));
  if (view.ambition) tasks.unshift(make(view.ambition.id, view.ambition.name, AMBITIONS[view.ambition.id]));
  return tasks;
}
