import type { Person } from '@ed/schema';
import type { ChronicleEntry, SimCtx } from '../world.js';
import { visibleRecordView } from '../record.js';
import { campaignDef } from '../campaign.js';
import { PersonStore } from './store.js';
import { branchFoundingTitle, branchRecallTitle } from './branches.js';

export type GenerationChangeKind = 'birth' | 'death' | 'marriage' | 'succession' | 'branch' | 'rite_loss' | 'blank';
export interface GenerationChange {
  id: string;
  year: number;
  kind: GenerationChangeKind;
  /** An omission carries neither a name nor a reconstruction of its cast. */
  person?: string;
  name?: string;
  related?: { person: string; name: string; role: 'mother' | 'father' | 'spouse' }[];
  inTree?: boolean;
  pageId?: string;
}
export interface GenerationChanges {
  index: number;
  count: number;
  tenure?: { person: string; name: string; from: number; to?: number };
  through: number;
  changes: GenerationChange[];
  more: number;
}

/**
 * Older system pages have no saved identity. Give those existing pages a
 * deterministic reading identity, shared by the history links and book().
 * Nothing is appended, allocated from world counters, or written to a save.
 * This internal metadata projection is shallow; public readers detach their
 * selected pages afterwards, so a sixty-page window does not clone the book.
 */
export function chronicleReading(entries: readonly ChronicleEntry[]): ChronicleEntry[] {
  const reserved = new Set(entries.flatMap((entry) => entry.id ? [entry.id] : []));
  return entries.map((entry, index) => {
    const copy = { ...entry };
    if (!copy.id) {
      let id = `legacy-chronicle:${index}`;
      while (reserved.has(id)) id += ':';
      copy.id = id;
      reserved.add(id);
    }
    return copy;
  });
}

/** Read a record without materialising an archived person's genome in the save. */
function recordedDeath(ctx: SimCtx, person: Person, roster: Person[]) {
  const people = new PersonStore();
  people.add(structuredClone(person));
  return visibleRecordView({ ...ctx, world: { ...ctx.world, people,
    chronicle: ctx.world.chronicle.filter((page) => page.text !== null && page.record !== 'omit'),
  } }, person.id, roster).claimedDeath;
}

function titleReadings(ctx: SimCtx, read: (ctx: SimCtx) => string): Set<string> {
  return new Set((['original', 'plainenglish'] as const).map((mode) => read({
    ...ctx, prose: { ...ctx.prose, mode, missing: new Set() },
  })));
}

/** Existing public dates, the recorded pedigree, and pages the family kept. */
export function generationChangesOf(ctx: SimCtx, index?: number): GenerationChanges {
  const w = ctx.world;
  const count = w.succession.length;
  const at = Number.isInteger(index) ? Math.max(0, Math.min(count - 1, index!)) : count - 1;
  const held = w.succession[at];
  if (!held) return { index: 0, count, through: w.year, changes: [], more: 0 };
  const through = Math.min(held.to ?? w.year, w.year);
  const opening = campaignDef(w.campaign).startYear;
  const within = (year: number) => year >= held.from && year <= through;
  const pages = chronicleReading(w.chronicle);
  const roster = w.people.household(w.playerHouse, w.year);
  const inTree = new Set(roster.map((p) => String(p.id)));
  for (const person of w.people.all()) if (person.status === 'vessel_consumed') inTree.add(person.id);
  const family = w.people.all().filter((p) => p.membership.some((m) => m.house === w.playerHouse
    && m.from <= through && (m.kind === 'blood' || m.kind === 'cadet' || m.kind === 'married_in')));
  const familyIds = new Set(family.map((p) => String(p.id)));
  const changes = new Map<string, GenerationChange>();
  const deaths = new Map<string, number | undefined>();
  const deathClaims = new Map<string, ChronicleEntry>();
  for (const page of pages) {
    if (page.text === null || page.record === 'omit') continue;
    for (const claim of page.claims ?? []) if (claim.kind === 'death') deathClaims.set(claim.person, page);
  }
  const addBlank = (page: ChronicleEntry) => {
    if (!within(page.year)) return;
    changes.set(`blank:${page.id}`, { id: `blank:${page.id}`, year: page.year, kind: 'blank', pageId: page.id });
  };
  const omitted = (people: string[], year: number) => pages.find((page) => page.year === year
    && (page.text === null || page.record === 'omit') && people.every((id) => page.people?.includes(id)));
  const add = (kind: Exclude<GenerationChangeKind, 'blank'>, person: Person, year: number,
    page?: ChronicleEntry, related?: GenerationChange['related'], key = `${kind}:${person.id}:${year}`) => {
    if (!within(year)) return;
    const blank = page?.text === null || page?.record === 'omit' ? page : omitted([person.id], year);
    if (blank) { addBlank(blank); return; }
    changes.set(key, { id: key, year, kind, person: person.id, name: person.name,
      inTree: inTree.has(person.id), ...(page?.id ? { pageId: page.id } : {}),
      ...(related?.length ? { related } : {}) });
  };

  for (const p of family) {
    const claimPage = deathClaims.get(p.id);
    // Most people have no death claim; the public life dates need no genome.
    const death = claimPage ? recordedDeath(ctx, p, roster)?.year ?? p.died : p.died;
    deaths.set(p.id, death);
    if (p.born > opening && within(p.born)) {
      const parents = (['mother', 'father'] as const).flatMap((role) => {
        const id = p.claimedParents[role];
        const parent = id ? w.people.get(id) : undefined;
        return parent ? [{ person: String(parent.id), name: parent.name, role }] : [];
      });
      add('birth', p, p.born, undefined, parents);
    }
    if (death !== undefined && p.status !== 'guardian') add('death', p, death, claimPage);
    for (const marriage of p.marriages) {
      // The founding cast's existing marriages are dated to bootstrap. They
      // are the opening household, not changes made during its first tenure.
      if (marriage.from <= opening || !within(marriage.from)) continue;
      const spouse = w.people.get(marriage.spouse);
      if (!spouse) continue;
      const pair = [String(p.id), String(spouse.id)].sort();
      const key = `marriage:${pair.join(':')}:${marriage.from}`;
      if (changes.has(key)) continue;
      const source = pages.find((page) => page.year === marriage.from && pair.every((id) => page.people?.includes(id))
        && page.eventId && ctx.content.event(page.eventId)?.tags.some((tag) => ['marriage', 'wedding', 'match'].includes(tag)));
      const blank = omitted(pair, marriage.from);
      if (blank) { addBlank(blank); continue; }
      add('marriage', p, marriage.from, source, [{ person: spouse.id, name: spouse.name, role: 'spouse' }], key);
    }
  }

  // The first founder's opening is the baseline, not a change every new game
  // has already made. Later handovers are the existing succession history.
  for (const [tenureIndex, tenure] of w.succession.entries()) {
    if (tenureIndex === 0 || !within(tenure.from)) continue;
    const person = w.people.get(tenure.person);
    if (person) {
      add('succession', person, tenure.from);
      const entry = changes.get(`succession:${person.id}:${tenure.from}`);
      if (entry) entry.name = tenure.name;
    }
  }
  const foundedTitles = titleReadings(ctx, branchFoundingTitle);
  const recalledTitles = titleReadings(ctx, branchRecallTitle);
  const uniquePage = (year: number, titles: Set<string>) => {
    const matches = pages.filter((page) => page.year === year && page.title && titles.has(page.title));
    return matches.length === 1 ? matches[0] : undefined;
  };
  for (const branch of w.branches.values()) {
    const founder = w.people.get(branch.founder);
    if (founder && familyIds.has(founder.id)) add('branch', founder, branch.foundedYear, uniquePage(branch.foundedYear, foundedTitles));
  }
  for (const p of family) for (let i = 1; i < p.membership.length; i++) {
    const previous = p.membership[i - 1]!;
    const current = p.membership[i]!;
    if (previous.house === w.playerHouse && previous.branch && previous.branch !== 'main'
      && current.house === w.playerHouse && (!current.branch || current.branch === 'main')) {
      add('branch', p, current.from, uniquePage(current.from, recalledTitles));
    }
  }
  for (const page of pages) {
    if (!within(page.year) || !page.eventId) continue;
    const event = ctx.content.event(page.eventId);
    if (!event) continue;
    const outcomes = event.interaction.kind === 'narration' ? event.interaction.outcomes
      : event.interaction.choices.flatMap((choice) => choice.outcomes);
    if (!outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'rite'
      || (effect.kind === 'awakening' && effect.forced)))) continue;
    if (page.text === null || page.record === 'omit') { addBlank(page); continue; }
    for (const id of page.people ?? []) {
      if (!familyIds.has(id) || deaths.get(id) !== page.year) continue;
      const person = w.people.get(id)!;
      // The public death claim can survive an embellished page. Its private
      // rite effect cannot tell this reading what the book says caused it.
      if (page.record === 'embellish') continue;
      changes.delete(`death:${id}:${page.year}`);
      add('rite_loss', person, page.year, page);
    }
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const ordered = [...changes.values()].sort((a, b) => b.year - a.year || compare(a.kind, b.kind) || compare(a.id, b.id));
  return {
    index: at, count, tenure: { person: held.person, name: held.name, from: held.from,
      ...(held.to !== undefined ? { to: held.to } : {}) },
    through, changes: ordered.slice(0, 12), more: Math.max(0, ordered.length - 12),
  };
}
