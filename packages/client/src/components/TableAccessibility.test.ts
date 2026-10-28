// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { canonical, type LandView, type SessionView, type TableView } from '@ed/core';
import { loadBundle } from '@ed/content';
import type { SavedGame } from '@ed/schema';
import type { GameActions } from '../lib/game';
import * as gameModule from '../lib/game';
import { browserPlatform } from '../platform';
import { ACCESSIBILITY_STORAGE_KEY } from '../lib/accessibility';
import { TABLE_TARGETS, tableTargetAttrs, tableTasksFor } from '../lib/table-nav';
import GameTable from './Table.vue';
import TableTaskLinks from './TableTaskLinks.vue';
import App from '../App.vue';

function fixture(boughtBack = false): TableView {
  return {
    treasury: 100, bidCeiling: 0, tutorFee: 10,
    wardship: { wardName: 'Edren', since: 1109, boughtBack, buyBackCost: 20 },
    auction: null, delegation: [],
    vesselRite: { ready: false, reason: 'Not ready' },
    greatRite: { ready: false, reason: 'Not ready' },
    unmaking: { ready: false, reason: 'Not ready' },
    ledgerSearch: { ready: false, reason: 'Not ready' },
    shelf: [], studying: [], mystic: { duties: [], offers: [], history: [] },
    outsideServices: { search: { ok: true, reason: undefined, price: 3, due: 1043, scarce: false }, hires: [], commissions: [], returns: [], contracts: [], history: [], promises: [], terms: '' }, security: { threats: [], history: [] },
    expeditions: { offers: [], current: [], history: [], cases: [], terms: '' },
    captives: [], missingPrimers: [], pupils: [], teachable: [],
    canTutor: false, tutoring: [], posts: [], marriagePolicy: 'in',
    programmeCandidates: [], scion: null, scionHeir: null,
    scionVacant: false, scionHeirVacant: false, market: [], longWait: [], forcing: [],
    papers: [], pedigreePrices: [], servants: [], maxBond: 20,
  } as unknown as TableView;
}

describe('Table destinations and read-only navigation (#1941)', () => {
  const land = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;

  it.each(['original', 'plainenglish'] as const)('shows a quoted reader/place and forgone study beside the existing assignment controls in %s (#1942)', async (proseMode) => {
    const table = fixture();
    const target = { target: { kind: 'book' as const, book: 'second' }, bindings: {}, name: 'The second book' };
    const offer: TableView['mystic']['offers'][number] = { working: 'book-care', name: 'Book care', description: 'Keep a physical book.', affinity: 'light',
      benefit: 'library_care', preparation: 3, preparationYears: 1, upkeep: 0.2, known: true, books: ['The completed primer'],
      practitioners: [{ person: 'free', name: 'Alys', studying: { book: 'unfinished', remainingYears: 3 } }],
      targets: [{ ...target, name: 'The covered book', target: { kind: 'book', book: 'first' } }, target], assignable: { person: 'free', target: 1 } };
    table.mystic.offers = [offer];
    const order = vi.fn();
    const w = mount(GameTable, { props: { table, land, proseMode, actions: { order } as unknown as GameActions, refusal: null, receipt: null } });
    try {
      const quoted = w.get('.available-duty');
      expect(quoted.text()).toContain('Alys'); expect(quoted.text()).toContain('The second book');
      expect(quoted.text()).toContain('3 years');
      expect(w.get('#table-duties').text()).toContain(proseMode === 'original' ? '3 crowns to make ready' : '3 crowns to prepare');
      expect(order).not.toHaveBeenCalled();
      const selects = w.get('#table-duties').findAll('select');
      await selects[0]!.setValue('free'); await selects[1]!.setValue('1');
      const assign = w.get('#table-duties').findAll('button').find(b => b.text() === (proseMode === 'original' ? 'Set them to it' : 'Assign'))!;
      await assign.trigger('click');
      expect(order).toHaveBeenCalledExactlyOnceWith({ kind: 'mysticAssign', person: 'free', working: 'book-care', target: target.target, bindings: {} });
      await w.setProps({ table: { ...table, mystic: { ...table.mystic, offers: [{ ...offer, assignable: undefined }] } } });
      expect(w.find('.available-duty').exists()).toBe(false);
    } finally { w.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('shows useful years, last use, cost and paused study beside a reachable release in %s (#1942)', async (proseMode) => {
    const table = fixture();
    const duty = { id: 'duty-1', person: 'reader', name: 'Alys', working: 'sickroom_watch', workingName: 'The Sickroom Watch',
      place: 'The main hall', status: 'serving' as const, ready: 1100, upkeep: 4,
      paused: { book: 'next-book', name: 'The next book', remainingYears: 3 },
      service: { servedYears: 5, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: 32 } };
    table.mystic.duties = [duty];
    const order = vi.fn();
    const w = mount(GameTable, { props: { table, land, proseMode, actions: { order } as unknown as GameActions, refusal: null, receipt: null } });
    try {
      const panel = w.get('#table-duties');
      expect(panel.text()).toContain('0 useful years');
      expect(panel.text()).toContain('no useful year recorded');
      expect(panel.text()).toContain('4 crowns');
      expect(panel.text()).toContain('32 crowns');
      expect(panel.text()).toContain('The next book, 3 years');
      const release = panel.get(`button[aria-label="${proseMode === 'plainenglish' ? 'End duty' : 'Release'} Alys"]`);
      expect(release.attributes('disabled')).toBeUndefined();
      await release.trigger('click');
      expect(order).toHaveBeenCalledExactlyOnceWith({ kind: 'mysticRelease', assignment: 'duty-1' });
      await w.setProps({ table: { ...table, mystic: { ...table.mystic, duties: [{ ...duty,
        service: { ...duty.service, usefulYears: 2, lastUseful: 1107 } }] } } });
      expect(panel.text()).toContain('2 useful years');
      expect(panel.text()).toContain('last useful in 1107');
      expect(panel.text()).not.toContain('no useful year recorded');
    } finally { w.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('opens the same recorded source beside a rite candidate without confirming an order (%s, #1944)', async (proseMode) => {
    const table = fixture();
    table.vesselRite = { ready: true, assembly: {
      rite: 'vessel', title: 'The Vessel rite', actors: [], preparations: [], irreversible: ['A named relative will be spent.'],
      atRisk: [{ slot: 'VESSEL', candidates: [{ person: 'relative', name: 'Alys', remembered: 'Alys, child of Osric. The book last named her in 1100.' }] }],
    } };
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table, land, proseMode, actions: { order } as unknown as GameActions, refusal: null, receipt: null,
      milestones: () => [{ entryId: 'life-source', year: 1100, source: 'deed', label: 'returned from service' }],
    } });
    try {
      const review = w.findAll('button').find((button) => button.text() === (proseMode === 'plainenglish' ? 'Begin the Vessel rite' : 'Call the Vessel'));
      expect(review).toBeDefined();
      await review!.trigger('click');
      const history = w.get('.candidate-life');
      (history.element as HTMLDetailsElement).open = true;
      expect(history.text()).toContain('returned from service');
      await history.get('[data-milestone="life-source"]').trigger('click');
      expect(w.emitted('book')).toEqual([['life-source']]);
      expect(w.get('.rite-assembly').text()).toContain('A named relative will be spent.');
      expect(order).not.toHaveBeenCalled();
    } finally { w.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('explains an unrevealed Table without exposing destinations in %s', (proseMode) => {
    const task = tableTasksFor({} as SessionView, fixture(), { revealed: new Set(), proseMode })[0]!;
    const w = mount(TableTaskLinks, { props: { task, proseMode } });
    try {
      expect(w.findAll('button')).toHaveLength(0);
      expect(w.text()).toContain(proseMode === 'original' ? 'The Table will open' : 'Family orders will open');
      expect(w.find('[data-table-go]').exists()).toBe(false);
    } finally { w.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('gives every destination exactly one rendered anchor in %s', (proseMode) => {
    const w = mount(GameTable, { props: {
      table: fixture(), land, actions: { order: vi.fn() } as unknown as GameActions,
      refusal: null, receipt: null, showEverything: true, proseMode,
    } });
    try {
      const anchors = w.findAll('[data-table-target]');
      expect(anchors.map(a => a.attributes('data-table-target')).sort()).toEqual([...TABLE_TARGETS].sort());
      for (const target of TABLE_TARGETS) {
        expect(w.get(`#${tableTargetAttrs(target).id}`).attributes('data-table-target')).toBe(target);
      }
    } finally { w.unmount(); }
  });

  it('reopens idle sections, refocuses repeated requests and keeps a vanished offer reachable', async () => {
    const order = vi.fn();
    const w = mount(GameTable, { attachTo: document.body, props: {
      table: fixture(), land, actions: { order } as unknown as GameActions,
      refusal: null, receipt: null,
    } });
    try {
      await w.setProps({ reveal: { target: 'shelf', token: 1 } });
      await nextTick();
      const fold = w.get('#table-shelf h3 button');
      expect(fold.attributes('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(fold.element);
      (w.get('#table-purse input').element as HTMLElement).focus();
      await w.setProps({ reveal: { target: 'shelf', token: 2 } });
      await nextTick();
      expect(document.activeElement).toBe(fold.element);
      expect(w.emitted('revealed')).toEqual([[1], [2]]);
      // The quote disappeared after the link was drawn. Open only today's empty panel.
      await w.setProps({ reveal: { target: 'security', token: 3 } });
      await nextTick();
      expect(document.activeElement).toBe(w.get('#table-security h3').element);
      expect(w.get('#table-security').text()).toContain('No warnings are outstanding.');
      expect(order).not.toHaveBeenCalled();
    } finally { w.unmount(); }
  });

  it('honours a rendered link after its conditional public offer disappears', async () => {
    const table: TableView = { ...fixture(), security: { threats: [{
      id: 'warning', target: 'relative', name: 'Ada', due: 1230, warned: true, spent: 0, watch: [], options: [],
    }], history: [] } };
    const tasks = tableTasksFor({} as SessionView, table, { revealed: new Set(['table']) });
    const w = mount(GameTable, { props: {
      table, tasks, land, actions: { order: vi.fn() } as unknown as GameActions, refusal: null, receipt: null,
    } });
    try {
      const oldLink = w.get('[data-table-go="security"]');
      const next = fixture();
      const render = w.setProps({ table: next, tasks: tableTasksFor({} as SessionView, next, { revealed: new Set(['table']) }) });
      // Click before Vue replaces the rendered quote: navigation still has only a section name.
      (oldLink.element as HTMLButtonElement).click();
      await render;
      expect(w.emitted('navigate')).toEqual([['security']]);
      await w.setProps({ reveal: { target: 'security', token: 1 } });
      await nextTick();
      expect(w.get('#table-security').text()).toContain('No warnings are outstanding.');
    } finally { w.unmount(); }
  });

  it('keeps unaffordable prices and verbatim refusal text beside the reachable controls', async () => {
    const table = fixture();
    table.outsideServices.search = { ...table.outsideServices.search, ok: false, price: 37, reason: 'The purse cannot meet 37 crowns.' };
    const tasks = tableTasksFor({} as SessionView, table, { revealed: new Set(['table']) });
    const order = vi.fn();
    const w = mount(GameTable, { attachTo: document.body, props: {
      table, land, tasks, actions: { order } as unknown as GameActions, refusal: null, receipt: null,
    } });
    try {
      const reader = w.get('details:nth-of-type(2)');
      (reader.element as HTMLDetailsElement).open = true;
      await nextTick();
      expect(reader.text()).toContain('The purse cannot meet 37 crowns.');
      const route = reader.get('[data-table-go="outsideServices"]');
      expect(route.attributes('disabled')).toBeUndefined();
      await route.trigger('click');
      expect(w.emitted('navigate')).toEqual([['outsideServices']]);
      await w.setProps({ reveal: { target: 'outsideServices', token: 1 } });
      await nextTick();
      const panel = w.get('#table-outsideServices');
      expect(panel.text()).toContain('37');
      expect(panel.text()).toContain('The purse cannot meet 37 crowns.');
      expect(panel.findAll('button').some(button => button.attributes('disabled') !== undefined)).toBe(true);
      expect(panel.element.contains(document.activeElement)).toBe(true);
      expect(order).not.toHaveBeenCalled();
    } finally { w.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('returns to an ambition, retains opened panels and preserves the complete save in %s', async (proseMode) => {
    localStorage.clear();
    localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify({ proseMode, showEverythingFromStart: true }));
    let pause = () => {};
    let exported: SavedGame | undefined;
    const host = { ...browserPlatform(),
      onPause: (listener: () => void) => { pause = listener; return () => {}; },
      exportSave: async (save: unknown) => { exported = save as SavedGame; },
    };
    const game = gameModule.createGame(loadBundle(), host);
    game.actions.begin(1941);
    const signing = game.prologue.value!;
    expect(game.actions.found({
      houseName: 'House Navigation', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
      answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
    }).ok).toBe(true);
    game.actions.enter();
    expect(game.actions.setAmbition('restore_ledger')).toBe(true);
    const create = vi.spyOn(gameModule, 'createGame').mockReturnValue(game);
    const w = mount(App, { attachTo: document.body });
    try {
      await flushPromises();
      pause();
      await game.actions.exportSave('autosave');
      const before = structuredClone(exported!);
      expect(before.decisionLog.some(row => row.kind === 'command')).toBe(true);
      const route = w.get('.ambition [data-table-go="shelf"]');
      (w.get('.ambition-routes').element as HTMLDetailsElement).open = true;
      for (let attempt = 0; attempt < 2; attempt++) {
        await route.trigger('click');
        await nextTick();
        const shelf = w.get('#table-shelf h3 button');
        expect(shelf.attributes('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(shelf.element);
        await w.get('.return-goal').trigger('click');
        expect(document.activeElement).toBe(route.element);
        expect(w.find('.table').exists()).toBe(false);
      }
      // Ordinary pane switches retain overrides without replaying an old focus request.
      const tableTab = w.findAll('.panes button').find(button => button.text() === (proseMode === 'plainenglish' ? 'Family orders' : 'The table'));
      expect(tableTab).toBeDefined();
      await tableTab!.trigger('click');
      expect(w.get('#table-shelf h3 button').attributes('aria-expanded')).toBe('true');
      pause();
      await game.actions.exportSave('autosave');
      expect(canonical({ ...exported, savedAt: '' })).toBe(canonical({ ...before, savedAt: '' }));
      expect(exported!.decisionLog).toEqual(before.decisionLog);
      // An ambition can be cleared while its Table destination remains open.
      await route.trigger('click');
      game.actions.setAmbition(null);
      await nextTick();
      await w.get('.return-goal').trigger('click');
      expect(document.activeElement).toBe(w.get('#ambition-heading').element);
    } finally { w.unmount(); create.mockRestore(); localStorage.clear(); }
  });
});

describe('Table captive return (#1908)', () => {
  it('names captor and fixed price, preserves refusals and sends the same ransom order in both readings', async () => {
    const table: TableView = { ...fixture(), captives: [
      { person: 'linn', name: 'Linn', captor: 'House Marrow', since: 1100, ok: true, price: 37 },
      { person: 'maud', name: 'Maud', captor: 'House Wick', since: 1101, ok: false, price: 90, reason: 'The family cannot afford 90 crowns.' },
    ] };
    const before = structuredClone(table);
    const order = vi.fn();
    const wrapper = mount(GameTable, { props: {
      table, land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions, refusal: null, receipt: null, proseMode: 'original',
    } });
    try {
      for (const proseMode of ['original', 'plainenglish', 'original'] as const) {
        await wrapper.setProps({ proseMode });
        const rows = wrapper.get('.captives').findAll('.line');
        expect(rows[0]!.text()).toContain('Linn');
        expect(rows[0]!.text()).toContain('House Marrow');
        expect(rows[0]!.text()).toContain('1100');
        const enabled = rows[0]!.get('button');
        expect(enabled.attributes('aria-label')).toContain('Linn — 37 crowns');
        expect(enabled.attributes('disabled')).toBeUndefined();
        const disabled = rows[1]!.get('button');
        expect(disabled.attributes('disabled')).toBeDefined();
        expect(disabled.attributes('aria-describedby')).toBe('ransom-maud');
        expect(wrapper.get('#ransom-maud').text()).toBe('The family cannot afford 90 crowns.');
        await disabled.trigger('click');
        const calls = order.mock.calls.length;
        await enabled.trigger('click');
        expect(order).toHaveBeenCalledTimes(calls + 1);
        expect(order).toHaveBeenLastCalledWith({ kind: 'ransom', person: 'linn' });
        expect(table).toEqual(before);
      }
      expect(order).toHaveBeenCalledTimes(3);
    } finally { wrapper.unmount(); }
  });
});

describe('Plain English treasury debt reading (#1755)', () => {
  it.each([-40, 0, 100])('describes a signed treasury balance of %i without claiming debt is spendable', async (treasury) => {
    const table = { ...fixture(), treasury } as TableView;
    const original = structuredClone(table);
    const order = vi.fn();
    const wrapper = mount(GameTable, { props: {
      table,
      land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    try {
      const summary = () => wrapper.get('.panel > p.small').text();
      expect(summary()).toBe(`${treasury} crowns. A term of tutoring is 10.`);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(summary()).toBe(
        `Money balance: ${treasury} crowns${treasury < 0 ? ` (the house owes ${-treasury} crowns)` : ''}. A tutoring term costs 10.`,
      );
      expect(summary()).not.toContain('crowns available');
      expect(table).toEqual(original);
      expect(order).not.toHaveBeenCalled();
      await wrapper.setProps({ proseMode: 'original' });
      expect(summary()).toBe(`${treasury} crowns. A term of tutoring is 10.`);
      expect(table).toEqual(original);
    } finally { wrapper.unmount(); }
  });
});

describe('Table marriage and paper labels in Plain English (#1735)', () => {
  it('preserves marriage policy, paper view, eligibility and exact orders across reading modes', async () => {
    const table = { ...fixture(),
      market: [{ person: 'anwen', name: 'Anwen', age: 23, held: false }],
      papers: [{ person: 'anwen', name: 'Anwen', shows: 1, forged: 1, exposed: 1 }],
      pedigreePrices: [
        { grade: 'caster', price: 20, covers: 2, canPay: true },
        { grade: 'bramme', price: 150, covers: 3, canPay: false },
      ],
    } as unknown as TableView;
    const before = structuredClone(table);
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table, land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    const button = (label: string) => w.findAll('button').find((b) => b.text() === label)!;
    const paper = () => w.findAll('.panel').find((p) => p.text().includes('Caster — 20 crowns, 2 generations'))!;
    const selected = () => w.findAll('button[aria-pressed="true"]').map((b) => b.text());
    try {
      expect(w.text()).toContain('Who the house marries');
      expect(button('The market').attributes('aria-expanded')).toBe('true');
      expect(paper().text()).toContain('1 bought');
      expect(paper().text()).toContain('1 questioned');
      expect(paper().text()).toContain('the house cannot raise 150');
      const originalPolicy = selected();
      expect(button('The papers').attributes('aria-expanded')).toBe('true');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('Marriage preferences');
      expect(button('Marriage market').attributes('aria-expanded')).toBe('true');
      expect(button('Marriage papers').attributes('aria-expanded')).toBe('true');
      expect(selected()).toContain('Marry within the family');
      expect(paper().text()).toContain('1 purchased generations');
      expect(paper().text()).toContain('1 disputed generations');
      expect(paper().text()).toContain('The family cannot afford 150');
      expect(button('Bramme — 150 crowns, 3 generations').attributes('disabled')).toBeDefined();
      expect(button('Caster — 20 crowns, 2 generations').attributes('disabled')).toBeUndefined();
      await button('Marry within the family').trigger('click');
      await button('Anwen, 23 — available for marriage').trigger('click');
      await button('Caster — 20 crowns, 2 generations').trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'marriages', policy: 'in' },
        { kind: 'withhold', person: 'anwen', hold: true },
        { kind: 'pedigree', person: 'anwen', grade: 'caster' },
      ]);

      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('Who the house marries');
      expect(button('The market').attributes('aria-expanded')).toBe('true');
      expect(button('The papers').attributes('aria-expanded')).toBe('true');
      expect(selected()).toEqual(originalPolicy);
      expect(paper().text()).toContain('1 bought');
      expect(paper().text()).toContain('1 questioned');
      expect(paper().text()).toContain('the house cannot raise 150');
      expect(table).toEqual(before);
    } finally { w.unmount(); }
  });
});

describe('Table marriage pledge controls (#1184)', () => {
  it('explains each lot, respects eligibility, and preserves pledge and withdrawal orders across modes', async () => {
    const table = { ...fixture(), auction: {
      year: 1100, lots: 2, lowestReserve: 400, heirlooms: [],
      items: [
        { id: 'book-lot', kind: 'spellbook', name: 'Ash Grammar', seller: 'House Marrow',
          saleYear: 1100, reserve: 400, bid: { currency: 'marriage_promise' },
          marriagePromise: { available: true, signer: 'Daveed', term: 40 } },
        { id: 'ring-lot', kind: 'heirloom', name: 'The Iron Ring', seller: 'House Wick',
          saleYear: 1100, reserve: 500,
          marriagePromise: { available: false, reason: 'the house has already promised a granddaughter', term: 40 } },
      ],
    } } as unknown as TableView;
    const snapshot = structuredClone(table);
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table, land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    try {
      const lots = w.findAll('.lot');
      const original = () => w.get('button[aria-label="Pledge a granddaughter for Ash Grammar from House Marrow"]');
      expect(original().text()).toBe('Pledge a granddaughter');
      expect(original().attributes('aria-describedby')).toBe('pledge-terms-book-lot');
      expect(w.get('#pledge-terms-book-lot').text()).toContain('Daveed may pledge a future granddaughter to House Marrow.');
      expect(w.get('#pledge-terms-book-lot').text()).toContain('40 years of the sale.');
      expect(lots[0]!.text()).toContain('the hand of a future granddaughter');
      expect(w.text()).toContain('The house has set no ceiling; its named bids below still stand.');
      expect(lots[1]!.get('button[aria-label*="Pledge a granddaughter"]').attributes('disabled')).toBeDefined();
      await lots[1]!.get('button[aria-label*="Pledge a granddaughter"]').trigger('click');
      expect(order).not.toHaveBeenCalled();

      await w.setProps({ proseMode: 'plainenglish' });
      const pledge = w.get('button[aria-label="Offer a future granddaughter in marriage for Ash Grammar from House Marrow"]');
      expect(pledge.text()).toBe('Offer a future granddaughter in marriage');
      expect(w.get('#pledge-terms-book-lot').text()).toContain('40 years of the auction.');
      expect(w.get('#pledge-terms-book-lot').text()).toContain('one reputation level');
      expect(lots[0]!.text()).toContain('a future granddaughter in marriage');
      expect(w.text()).toContain('Your bids for individual lots still apply.');
      expect(lots[1]!.get('button[aria-label*="Offer a future granddaughter"]').attributes('disabled')).toBeDefined();
      await pledge.trigger('click');
      expect(order).toHaveBeenCalledExactlyOnceWith({ kind: 'lotBid', lot: 'book-lot', bid: { currency: 'marriage_promise' } });

      await w.setProps({ proseMode: 'original' });
      expect(original().text()).toBe('Pledge a granddaughter');
      await lots[0]!.findAll('button').find((b) => b.text() === 'Withdraw')!.trigger('click');
      expect(order.mock.calls[1]).toEqual([{ kind: 'lotBid', lot: 'book-lot', bid: null }]);
      expect(table).toEqual(snapshot);
    } finally { w.unmount(); }
  });
});

describe('Table accessible region names (#1670)', () => {
  it.each([false, true])('switches names for wardship boughtBack=%s without mutating or ordering', async (boughtBack) => {
    const table = fixture(boughtBack);
    const snapshot = structuredClone(table);
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table,
      land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    try {
      const names = () => [w.get('section.table').attributes('aria-label'),
        w.get('section.wardship').attributes('aria-label')];
      expect(names()).toEqual(["The house's standing orders", 'Wardship']);
      const hasBuyBack = w.find('.wardship button').exists();
      expect(hasBuyBack).toBe(!boughtBack);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(names()).toEqual(['Family orders and resources', 'Guardianship and land income']);
      expect(w.find('.wardship button').exists()).toBe(hasBuyBack);
      expect(table).toEqual(snapshot);
      expect(order).not.toHaveBeenCalled();
      await w.setProps({ proseMode: 'original' });
      expect(names()).toEqual(["The house's standing orders", 'Wardship']);
    } finally {
      w.unmount();
    }
  });
});


describe('Table reader-local action labels (#1683–#1685)', () => {
  function mountTable(table: TableView, land: LandView, order = vi.fn()) {
    const wrapper = mount(GameTable, { props: {
      table, land, actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    return { wrapper, order };
  }

  it('changes rite and review controls without changing the order or cancelling into an order (#1683)', async () => {
    const table = {
      ...fixture(),
      vesselRite: { ready: true, reason: '', assembly: {
        title: 'Vessel assembly', actors: [], atRisk: [], preparations: [], irreversible: [],
      } },
      ledgerSearch: { ready: true, reason: '', fee: 42 },
    } as unknown as TableView;
    const land = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;
    const { wrapper: w, order } = mountTable(table, land);
    const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label));
    try {
      expect(w.text()).toContain('The Great Work');
      expect(button('Call the Vessel')).toBeDefined();
      await button('Call the Vessel')!.trigger('click');
      expect(w.get('section.rite-assembly').attributes('aria-label')).toBe('Rite assembly');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('Major rites');
      expect(button('Begin the Vessel rite')).toBeDefined();
      expect(button('Begin the Great Rite')).toBeDefined();
      expect(button('Begin the Unmaking rite')).toBeDefined();
      expect(w.get('section.rite-assembly').attributes('aria-label')).toBe('Review the rite');
      await button('Cancel')!.trigger('click');
      expect(order).not.toHaveBeenCalled();
      await button('Begin the Vessel rite')!.trigger('click');
      await button('Confirm and begin the rite')!.trigger('click');
      await button('Search old records')!.trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'vesselRite' }, { kind: 'seekClause' },
      ]);
      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('The Great Work');
      expect(button('Call the Vessel')).toBeDefined();
      expect(button('Search the old papers')).toBeDefined();
    } finally { w.unmount(); }
  });

  it('preserves land policy identifiers, pressed states and parcel actions across modes (#1684)', async () => {
    const land = {
      rentsPolicy: 'customary',
      market: [{ parcel: 'lot-1', name: 'Moss Farm', place: 'Brugh', price: 30,
        closesYear: 1225, reason: 'neighbour_short', canBuy: true }],
      held: [{ parcel: 'held-1', name: 'Our Farm', place: 'Brugh',
        baseYield: 10, yieldBonus: 0, yieldFactor: 1,
        sellable: true, sellPrice: 40, canImprove: true, improveCost: 12 }],
    } as unknown as LandView;
    const { wrapper: w, order } = mountTable(fixture(), land);
    const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label));
    try {
      expect(button('The land')).toBeDefined();
      expect(button('Customary')!.attributes('aria-pressed')).toBe('true');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(button('Land holdings')).toBeDefined();
      expect(button('View land map')).toBeDefined();
      expect(button('Usual rent')!.attributes('aria-pressed')).toBe('true');
      await button('Buy this land')!.trigger('click');
      await button('Higher rent')!.trigger('click');
      await button('Sell this land')!.trigger('click');
      await button('Improve this land')!.trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'buy', parcel: 'lot-1' }, { kind: 'rents', policy: 'hard' },
        { kind: 'sell', parcel: 'held-1' }, { kind: 'improve', parcel: 'held-1' },
      ]);
      await w.setProps({ proseMode: 'original' });
      expect(button('The land')).toBeDefined();
      expect(button('Rack')).toBeDefined();
      expect(button('Customary')!.attributes('aria-pressed')).toBe('true');
    } finally { w.unmount(); }
  });

  it('retains book, reader and tutor identities while switching shelf and lesson controls (#1685)', async () => {
    const table = {
      ...fixture(),
      shelf: [{
        book: 'primer-1', name: 'Ash Grammar', years: 4, condition: 100,
        conditionLabel: 'New', readers: [{ person: 'child-1', name: 'Ada', years: 3 }],
        restore: { canPay: true, fee: 9, years: 2 },
      }],
      pupils: [{ person: 'child-1', name: 'Ada', age: 12 }],
      teachable: [{ attr: 'wit', name: 'Wit' }],
      canTutor: true,
    } as unknown as TableView;
    const land = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;
    const { wrapper: w, order } = mountTable(table, land);
    const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label));
    try {
      expect(w.text()).toContain('The shelf');
      expect(w.find('select[aria-label="Choose a reader for Ash Grammar"]').exists()).toBe(true);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('Family library');
      expect(w.text()).toContain('Tutoring');
      expect(button('Repair book')).toBeDefined();
      await button('Repair book')!.trigger('click');
      await w.get('select[aria-label="Choose who reads Ash Grammar"]').setValue('child-1');
      await button('Start reading')!.trigger('click');
      await w.get('select[aria-label="Choose a child for tutoring"]').setValue('child-1');
      await w.get('select[aria-label="Choose tutoring subject"]').setValue('wit');
      await button('Pay tutoring fee')!.trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'restore', book: 'primer-1' },
        { kind: 'study', person: 'child-1', book: 'primer-1' },
        { kind: 'tutor', person: 'child-1', attr: 'wit' },
      ]);
      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('The shelf');
      expect((w.get('select[aria-label="Choose a reader for Ash Grammar"]').element as HTMLSelectElement).value).toBe('child-1');
      expect(button('Set them reading')).toBeDefined();
      expect(button('Pay the 10')).toBeDefined();
    } finally { w.unmount(); }
  });
});


describe('Table career, programme and bond controls in Plain English (#1689–#1691)', () => {
  const land = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;
  function mounted(table: TableView) {
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table, land, actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    return { w, order };
  }

  it('preserves the selected career and exact appointment order across reading modes (#1689)', async () => {
    const table = { ...fixture(), posts: [
      { career: 'herald', name: 'Royal Herald', fee: 12, respectYield: 3,
        eligible: [{ person: 'ada', name: 'Ada', age: 27 }],
        holders: [], canPay: true },
      { career: 'scribe', name: 'Court Scribe', fee: 99, respectYield: 1,
        eligible: [{ person: 'ada', name: 'Ada', age: 27 }],
        holders: [], canPay: false },
    ] } as unknown as TableView;
    const before = structuredClone(table);
    const { w, order } = mounted(table);
    try {
      const posts = () => w.findAll('.panel').find((p) => p.find('select[aria-label*="Royal Herald"]').exists())!;
      expect(posts().get('.fold').text()).toBe('Places');
      expect(posts().text()).toContain('standing 3');
      expect(posts().text()).toContain('the house cannot raise 99');
      const selection = w.get('select[aria-label="Choose someone for Royal Herald"]');
      await selection.setValue('ada');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(posts().get('.fold').text()).toBe('Career positions');
      expect(posts().text()).toContain('reputation gained 3');
      expect(posts().text()).toContain('Not enough money to pay 99');
      expect((w.get('select[aria-label="Choose a family member for Royal Herald"]').element as HTMLSelectElement).value).toBe('ada');
      expect(w.findAll('button').some((button) => button.text() === 'Buy this position')).toBe(true);
      await w.get('select[aria-label="Choose a family member for Royal Herald"]').element.closest('.row')!.querySelector('button')!.click();
      expect(order).toHaveBeenCalledWith({ kind: 'career', person: 'ada', career: 'herald' });
      await w.setProps({ proseMode: 'original' });
      expect(posts().get('.fold').text()).toBe('Places');
      expect((w.get('select[aria-label="Choose someone for Royal Herald"]').element as HTMLSelectElement).value).toBe('ada');
      expect(table).toEqual(before);
    } finally { w.unmount(); }
  });

  it('keeps main and supporting candidate selections, restrictions and exact orders (#1690)', async () => {
    const table = { ...fixture(),
      programmeCandidates: [
        { person: 'ada', name: 'Ada', age: 31 },
        { person: 'ben', name: 'Ben', age: 29 },
        { person: 'cor', name: 'Cor', age: 25 },
      ],
      scion: { person: 'ada', name: 'Ada' },
      scionHeir: { person: 'ben', name: 'Ben' },
    } as unknown as TableView;
    const before = structuredClone(table);
    const { w, order } = mounted(table);
    try {
      const programme = () => w.findAll('.panel').find((p) => p.find('select[aria-label*="Scion"]').exists()
        || p.find('select[aria-label="Choose main candidate"]').exists())!;
      expect(programme().get('.fold').text()).toBe('The programme');
      expect(programme().text()).toContain('Heir to the programme');
      await w.get('select[aria-label="Choose the Scion"]').setValue('cor');
      await w.get('select[aria-label="Choose the heir to the programme"]').setValue('ben');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(programme().get('.fold').text()).toBe('Family advancement plan');
      expect(programme().text()).toContain('Main candidate');
      expect(programme().text()).toContain('Supporting candidate');
      expect((w.get('select[aria-label="Choose main candidate"]').element as HTMLSelectElement).value).toBe('cor');
      expect((w.get('select[aria-label="Choose supporting candidate"]').element as HTMLSelectElement).value).toBe('ben');
      expect(w.get('select[aria-label="Choose supporting candidate"] option[value="ada"]').attributes('disabled')).toBeDefined();
      const buttons = () => programme().findAll('button');
      await buttons().find((btn) => btn.text() === 'Set main candidate')!.trigger('click');
      await buttons().find((btn) => btn.text() === 'Set supporting candidate')!.trigger('click');
      await buttons().filter((btn) => btn.text() === 'Clear this position')[0]!.trigger('click');
      await buttons().filter((btn) => btn.text() === 'Clear this position')[1]!.trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'scion', person: 'cor' },
        { kind: 'scionHeir', person: 'ben' },
        { kind: 'scion', person: null },
        { kind: 'scionHeir', person: null },
      ]);
      await w.setProps({ proseMode: 'original' });
      expect(programme().get('.fold').text()).toBe('The programme');
      expect((w.get('select[aria-label="Choose the Scion"]').element as HTMLSelectElement).value).toBe('cor');
      expect(table).toEqual(before);
    } finally { w.unmount(); }
  });

  it('retains a debt amount, validation feedback and exact bind/free orders (#1691)', async () => {
    const table = { ...fixture(), maxBond: 20, servants: [
      { person: 'ada', name: 'Ada', role: 'housekeeper', wage: 3, bonded: false, debt: 0, loyalty: 'carefully' },
      { person: 'ben', name: 'Ben', role: 'gardener', wage: 2, bonded: true, debt: 8, loyalty: 'uneasily' },
    ] } as unknown as TableView;
    const before = structuredClone(table);
    const { w, order } = mounted(table);
    try {
      const servants = () => w.findAll('.panel').find((p) => p.find('input[aria-label*="Ada"]').exists())!;
      expect(servants().get('.fold').text()).toBe("The house's people");
      expect(servants().text()).toContain('owes 8');
      expect(servants().text()).toContain('they think of you');
      await w.get('input[aria-label="Marks to advance to Ada"]').setValue('21');
      expect(w.get('[role="alert"]').text()).toBe('Enter a whole number of marks from 1 to 20.');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(servants().get('.fold').text()).toBe('Servants and debt contracts');
      expect(servants().text()).toContain('debt: 8');
      expect(servants().text()).toContain('loyalty:');
      expect(w.get('input[aria-label="Debt advance in marks for Ada"]').attributes('placeholder')).toBe('Enter 1 to 20 marks');
      expect((w.get('input[aria-label="Debt advance in marks for Ada"]').element as HTMLInputElement).value).toBe('21');
      expect(w.get('[role="alert"]').text()).toBe('Enter a whole-number advance between 1 and 20 marks.');
      await w.get('input[aria-label="Debt advance in marks for Ada"]').setValue('7');
      await servants().findAll('button').find((btn) => btn.text() === 'Give a debt advance')!.trigger('click');
      await servants().findAll('button').find((btn) => btn.text() === 'Cancel debt bond')!.trigger('click');
      expect(order.mock.calls.map(([payload]) => payload)).toEqual([
        { kind: 'bond', person: 'ada', op: 'bind', marks: 7 },
        { kind: 'bond', person: 'ben', op: 'free' },
      ]);
      await w.setProps({ proseMode: 'original' });
      expect(servants().get('.fold').text()).toBe("The house's people");
      expect((w.get('input[aria-label="Marks to advance to Ada"]').element as HTMLInputElement).value).toBe('7');
      expect(table).toEqual(before);
    } finally { w.unmount(); }
  });
});

describe('the Long Wait asks twice before it gives up on a man (#1794)', () => {
  it('confirms, cancels without an order, and names each choice for a screen reader in both modes', async () => {
    const table = { ...fixture(),
      longWait: [{ person: 'oren', name: 'Oren', age: 27, inLine: true }, { person: 'tam', name: 'Tam', age: 21, inLine: false }],
    } as unknown as TableView;
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table, land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    const button = (label: string) => w.findAll('button').find((b) => b.text() === label);
    try {
      expect(button('The long wait')?.attributes('aria-expanded')).toBe('true');
      const oren = w.findAll('button').find((b) => b.attributes('aria-label') === 'Stop waiting for Oren, 27 years old, who stands before the seal')!;
      expect(oren.text()).toBe('Oren, 27 · stands before the seal');

      await oren.trigger('click');
      expect(w.text()).toContain('This cannot be taken back.');
      await button('Keep waiting')!.trigger('click');
      expect(order).not.toHaveBeenCalled();

      await oren.trigger('click');
      await button('Stop waiting for him')!.trigger('click');
      expect(order).toHaveBeenCalledTimes(1);
      expect(order).toHaveBeenCalledWith({ kind: 'declareMundane', person: 'oren' });

      await w.setProps({ proseMode: 'plainenglish' });
      expect(button('Men who have not awakened')).toBeDefined();
      expect(w.findAll('button').some((b) => b.attributes('aria-label') === 'Declare Tam, 21 years old, mundane')).toBe(true);
    } finally { w.unmount(); }
  });

  it('folds, without hiding, when nobody listed stands before the seal', async () => {
    const table = { ...fixture(), longWait: [{ person: 'cole', name: 'Cole', age: 40, inLine: false }] } as unknown as TableView;
    const w = mount(GameTable, { props: {
      table, land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order: vi.fn() } as unknown as GameActions,
      refusal: null, receipt: null, proseMode: 'original',
    } });
    try {
      const fold = w.findAll('button').find((b) => b.text() === 'The long wait')!;
      expect(fold.attributes('aria-expanded')).toBe('false');
      await fold.trigger('click');
      expect(fold.attributes('aria-expanded')).toBe('true');
      expect(w.findAll('button').some((b) => b.attributes('aria-label') === 'Stop waiting for Cole, 40 years old')).toBe(true);
    } finally { w.unmount(); }
  });

  it('refuses in place, beside the control that asked', () => {
    const w = mount(GameTable, { props: {
      table: fixture(), land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order: vi.fn() } as unknown as GameActions,
      refusal: { kind: 'declareMundane', reason: 'he has already woken' }, receipt: null, proseMode: 'original',
    } });
    try {
      const panel = w.findAll('.panel').find((p) => p.text().includes('The long wait'))!;
      expect(panel.text()).toContain('Nobody of the line is old enough to be given up on.');
      expect(panel.text()).toContain('he has already woken');
    } finally { w.unmount(); }
  });
});

describe('a forcing rite asks twice, and names no boy apart from the others (#1817)', () => {
  const rite = {
    rite: 'the_drowning', title: 'The Drowning', from: 7, to: 15, ready: true,
    boys: [{ person: 'ash', name: 'Ash', age: 12 }, { person: 'birch', name: 'Birch', age: 9 }],
  };
  const mountWith = (forcing: unknown[], refusal: { kind: string; reason: string } | null = null) => {
    const order = vi.fn();
    const w = mount(GameTable, { props: {
      table: { ...fixture(), forcing } as unknown as TableView,
      land: { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView,
      actions: { order } as unknown as GameActions,
      refusal, receipt: null, proseMode: 'original',
    } });
    return { w, order };
  };

  it('confirms, cancels without an order, and names each boy for a screen reader in both modes', async () => {
    const { w, order } = mountWith([rite]);
    const button = (label: string) => w.findAll('button').find((b) => b.text() === label);
    try {
      expect(button('The forcing rites')?.attributes('aria-expanded')).toBe('true');
      const ash = w.findAll('button').find((b) => b.attributes('aria-label') === 'Put Ash, 12 years old, through The Drowning')!;
      expect(ash.element.tagName).toBe('BUTTON');
      expect(ash.text()).toBe('Ash, 12');

      await ash.trigger('click');
      expect(w.text()).toContain('He will not be offered another.');
      await button('Not him')!.trigger('click');
      expect(order).not.toHaveBeenCalled();

      await ash.trigger('click');
      await button('Put him through it')!.trigger('click');
      expect(order).toHaveBeenCalledTimes(1);
      expect(order).toHaveBeenCalledWith({ kind: 'forcingRite', rite: 'the_drowning', person: 'ash' });

      await w.setProps({ proseMode: 'plainenglish' });
      expect(button('Rites to force an awakening')).toBeDefined();
      expect(w.findAll('button').some((b) => b.attributes('aria-label') === 'Start The Drowning for Birch, age 9')).toBe(true);
    } finally { w.unmount(); }
  });

  it('folds with the reason when no boy can be tried, and refuses in place', async () => {
    const { w } = mountWith(
      [{ ...rite, ready: false, reason: 'no boy of the line is of the age the book asks', boys: [] }],
      { kind: 'forcingRite', reason: 'he has been put through a forcing rite already' },
    );
    try {
      const fold = w.findAll('button').find((b) => b.text() === 'The forcing rites')!;
      expect(fold.attributes('aria-expanded')).toBe('false');
      await fold.trigger('click');
      expect(w.text()).toContain('no boy of the line is of the age the book asks');
      expect(w.text()).toContain('he has been put through a forcing rite already');
    } finally { w.unmount(); }
  });

  it('is absent when the content has no rite the house can call', () => {
    const { w } = mountWith([]);
    try {
      expect(w.findAll('button').some((b) => b.text() === 'The forcing rites')).toBe(false);
    } finally { w.unmount(); }
  });
});
