// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { LandView, TableView } from '@ed/core';
import type { GameActions } from '../lib/game';
import GameTable from './Table.vue';

function fixture(boughtBack = false): TableView {
  return {
    treasury: 100, bidCeiling: 0, tutorFee: 10,
    wardship: { wardName: 'Edren', since: 1109, boughtBack, buyBackCost: 20 },
    auction: null, delegation: [],
    vesselRite: { ready: false, reason: 'Not ready' },
    greatRite: { ready: false, reason: 'Not ready' },
    unmaking: { ready: false, reason: 'Not ready' },
    ledgerSearch: { ready: false, reason: 'Not ready' },
    shelf: [], studying: [], missingPrimers: [], pupils: [], teachable: [],
    canTutor: false, tutoring: [], posts: [], marriagePolicy: 'in',
    programmeCandidates: [], scion: null, scionHeir: null,
    scionVacant: false, scionHeirVacant: false, market: [],
    papers: [], pedigreePrices: [], servants: [], maxBond: 20,
  } as unknown as TableView;
}

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
