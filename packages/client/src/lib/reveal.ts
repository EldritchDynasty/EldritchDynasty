import type { SessionView, TableView } from '@ed/core';

export const REVEAL_ELEMENTS = [
  'clock-five',
  'table',
  'assize',
  'ladder',
  'abroad',
  'clock-long',
] as const;

export type RevealElement = typeof REVEAL_ELEMENTS[number];

export interface RevealOptions {
  showEverything: boolean;
  /** Presentation links/cards may name a surface before its ordinary trigger. */
  needed?: readonly RevealElement[];
}

export interface RevealTransition {
  shown: Set<RevealElement>;
  newlyShown: RevealElement[];
}

const REVEAL_STORAGE_PREFIX = 'eldritch-dynasty:reveal';

const FLOOR: Partial<Record<RevealElement, number>> = {
  'clock-five': 5,
  table: 10,
  assize: 20,
  ladder: 25,
  abroad: 30,
  'clock-long': 50,
};

const LABELS: Record<RevealElement, string> = {
  'clock-five': 'The clock can now move five years at a time.',
  table: 'The table is open: this is where the house gives standing orders.',
  assize: 'The Assize is visible: it is how the wider world answers the house.',
  ladder: 'The ladder is visible: it shows how far the blood has climbed.',
  abroad: 'Abroad is open: tales and rumours now have somewhere to be read.',
  'clock-long': 'The longer clock is open: a generation, or on to the term.',
};

function validElement(value: unknown): value is RevealElement {
  return typeof value === 'string' && (REVEAL_ELEMENTS as readonly string[]).includes(value);
}

export function revealNotice(element: RevealElement): string {
  return LABELS[element];
}

/**
 * Reading state belongs to one run, not one profile.
 *
 * A returning reader can choose to show everything on a new house without
 * making a later first-year house permanently expanded. Campaign + start year
 * keep future campaign variants from sharing an accidental namespace.
 */
export function revealStorageKey(view: Pick<SessionView, 'seed' | 'campaign'>): string {
  return [
    REVEAL_STORAGE_PREFIX,
    view.campaign.id,
    view.campaign.startYear,
    view.seed,
  ].join(':');
}

export function loadRevealed(
  storage: Pick<Storage, 'getItem'> | null,
  key: string,
): Set<RevealElement> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(validElement) : []);
  } catch {
    return new Set();
  }
}

export function saveRevealed(
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  shown: ReadonlySet<RevealElement>,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(REVEAL_ELEMENTS.filter((id) => shown.has(id))));
  } catch {
    // Reading convenience must never make a run unavailable.
  }
}

/**
 * The Table's early reveal uses affordances the engine already computed.
 * No price, age or eligibility rule is repeated in the client.
 */
export function tableHasAffordableOrder(table: TableView | null): boolean {
  if (!table) return false;

  if (table.canTutor && table.pupils.length > 0 && table.teachable.length > 0) return true;
  if (table.posts.some((post) => post.canPay && post.eligible.length > 0)) return true;
  if (table.papers.length > 0 && table.pedigreePrices.some((price) => price.canPay)) return true;
  if (table.missingPrimers.some((book) => !book.queued && table.treasury >= book.fee)) return true;
  if (table.ledgerSearch.ready || table.unmaking.ready || table.vesselRite.ready || table.greatRite.ready) return true;

  return false;
}

/**
 * One pure policy for progressive disclosure.
 *
 * The result is monotonic: everything in `prior` stays shown. Ordinary
 * triggers can reveal a surface before its time floor, and `needed` is the
 * safety valve for a visible decision/link that points at a hidden surface.
 */
export function revealTransition(
  view: Pick<SessionView, 'year' | 'campaign' | 'tales' | 'ascension' | 'assize' | 'muster'>,
  table: TableView | null,
  prior: ReadonlySet<RevealElement>,
  options: RevealOptions,
): RevealTransition {
  const shown = new Set(prior);
  const elapsed = Math.max(0, view.year - view.campaign.startYear);

  if (options.showEverything) {
    for (const id of REVEAL_ELEMENTS) shown.add(id);
  } else {
    for (const [id, years] of Object.entries(FLOOR) as [RevealElement, number][]) {
      if (elapsed >= years) shown.add(id);
    }

    if (tableHasAffordableOrder(table) || view.muster) shown.add('table');
    if (view.assize.pressure !== 0) shown.add('assize');
    if (view.ascension.foremost) shown.add('ladder');
    if (view.tales.length > 0) shown.add('abroad');
    for (const id of options.needed ?? []) shown.add(id);
  }

  return {
    shown,
    newlyShown: REVEAL_ELEMENTS.filter((id) => shown.has(id) && !prior.has(id)),
  };
}
