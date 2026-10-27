import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVEAL_ELEMENTS, revealNotice, revealStorageKey, loadRevealed, saveRevealed, revealTransition } from './reveal';
import type { SessionView, TableView } from '@ed/core';
import type { HouseAmbitionId } from '@ed/schema';
import { tableTasksFor } from './table-nav';

const ORIGINAL = [
  'The clock can now move five years at a time.',
  'The table is open: this is where the house gives standing orders.',
  'The Assize is visible: it is how the wider world answers the house.',
  'The ladder is visible: it shows how far the blood has climbed.',
  'Abroad is open: tales and rumours now have somewhere to be read.',
  'The longer clock is open: a generation, or on to the term.',
];

const PLAIN = [
  'You can now move forward five years at once.',
  'Family orders are now available. Use the Table to manage resources and make plans.',
  'You can now see how the wider world is responding to your family.',
  "You can now see the family's progress toward greater power.",
  'You can now read stories and rumours about the family from outside the house.',
  'You can now move forward a generation or to the end of the game.',
];

describe('progressive reveal notices in both reading modes (#1700)', () => {
  it('retains every Original literal and has distinct Plain English wording for each ID', () => {
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id))).toEqual(ORIGINAL);
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id, 'original'))).toEqual(ORIGINAL);
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id, 'plainenglish'))).toEqual(PLAIN);
    expect(new Set(PLAIN).size).toBe(REVEAL_ELEMENTS.length);
  });

  it('changes the words both ways without changing the recorded reveal IDs', () => {
    const seen = new Set([REVEAL_ELEMENTS[0]!, REVEAL_ELEMENTS[3]!]);
    const saved: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => { saved[key] = value; },
    };
    const key = revealStorageKey({
      seed: 17,
      campaign: { id: 'short', startYear: 1200 },
      houseName: 'The House',
    } as Parameters<typeof revealStorageKey>[0]);

    saveRevealed(storage, key, seen);
    const restored = loadRevealed(storage, key);
    const ids = [...restored];
    expect(ids).toEqual([...seen]);
    expect(ids.map((id) => revealNotice(id, 'original'))).toEqual([
      ORIGINAL[0], ORIGINAL[3],
    ]);
    expect(ids.map((id) => revealNotice(id, 'plainenglish'))).toEqual([
      PLAIN[0], PLAIN[3],
    ]);
    expect(ids.map((id) => revealNotice(id, 'original'))).toEqual([
      ORIGINAL[0], ORIGINAL[3],
    ]);
    expect([...restored]).toEqual(ids);
    expect(saved[key]).toBe(JSON.stringify(ids));
  });

  it('renders a visible App notice by stable ID and current reader preference', () => {
    const source = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');
    expect(source).toContain('ref<RevealElement[]>([])');
    expect(source).toContain('...transition.newlyShown,');
    expect(source).toContain('revealNotice(notice, accessibility.proseMode)');
    expect(source).toContain('dismissReveal(notice)');
    expect(source).not.toContain('text: revealNotice(id)');
    expect(source).not.toContain('notice.text');
  });
});

describe('Table task disclosure (#1941)', () => {
  const table = {
    delegation: [], forcing: [], security: { threats: [], history: [] },
    shelf: [], posts: [], papers: [], missingPrimers: [], unmaking: { ready: false }, greatRite: { ready: false },
    expeditions: { offers: [], current: [], history: [], cases: [] },
    ledgerSearch: { ready: false, reason: 'The old contract has not been found.' },
    vesselRite: { ready: false, reason: 'There is no reader.' },
    outsideServices: { search: { ok: false, reason: 'The fee is 3 crowns.' } },
  } as unknown as TableView;
  const viewFor = (id: HouseAmbitionId) => ({ ambition: { id, name: `Goal: ${id}` } }) as SessionView;
  const routes = {
    deepen_blood: ['market', 'papers', 'marriages', 'programme'],
    raise_ascendant: ['programme', 'shelf', 'tutoring', 'duties', 'forcing', 'longWait', 'greatWork'],
    restore_ledger: ['greatWork', 'shelf', 'preferences'],
    secure_branches: ['programme', 'marriages', 'market', 'security', 'land'],
  } as const;

  it.each(['original', 'plainenglish'] as const)('offers explanation and no hidden routes for a fresh house in %s', (proseMode) => {
    const view = { ...viewFor('restore_ledger'), year: 1200, campaign: { startYear: 1200 },
      tales: [], ascension: { foremost: null }, assize: { pressure: 0 }, muster: null,
    } as unknown as SessionView;
    const disclosure = revealTransition(view, table, new Set(), { showEverything: false });
    expect(disclosure.shown.has('table')).toBe(false);
    const tasks = tableTasksFor(view, table, { revealed: disclosure.shown, proseMode });
    expect(tasks.map(task => task.id)).toEqual(['restore_ledger', 'heir', 'reader', 'protection', 'rite']);
    expect(tasks.every(task => !task.revealed && task.targets.length === 0 && !task.offer)).toBe(true);
  });

  it.each(Object.keys(routes) as HouseAmbitionId[])('routes %s through public destinations and the explicit reveal override', (id) => {
    const view = viewFor(id);
    const publicTask = tableTasksFor(view, table, { revealed: new Set(['table']) })[0]!;
    expect(publicTask.targets).toEqual(routes[id].filter(target => !['preferences', 'forcing', 'security'].includes(target)));
    const all = tableTasksFor(view, table, { revealed: new Set(), showEverything: true });
    expect(all[0]!.targets).toEqual(routes[id]);
    expect(all.every(task => task.revealed && task.targets.length > 0)).toBe(true);
  });

  it('keeps unavailable public quotes visible without treating affordability as a navigation gate', () => {
    const tasks = tableTasksFor(viewFor('restore_ledger'), table, { revealed: new Set(['table']) });
    expect(tasks[0]!.offer?.reason).toBe(table.ledgerSearch.reason);
    expect(tasks.find(task => task.id === 'reader')!.offer?.reason).toBe(table.outsideServices.search.reason);
    expect(tasks.find(task => task.id === 'rite')!.offer?.reason).toBe(table.vesselRite.reason);
    expect(tasks.find(task => task.id === 'protection')!.targets).toEqual(['captives']);
    const withWarnings: TableView = { ...table, security: { threats: [{
      id: 'warning', target: 'relative', name: 'Ada', due: 1230, warned: true, spent: 0, watch: [], options: [],
    }], history: [] } };
    expect(tableTasksFor(viewFor('secure_branches'), withWarnings, { revealed: new Set(['table']) })[0]!.targets).toContain('security');
  });
});
