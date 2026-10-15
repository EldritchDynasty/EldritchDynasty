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
      expect(w.get('select[aria-label="Choose a reader for Ash Grammar"]').exists()).toBe(true);
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
      expect(w.get('select[aria-label="Choose a reader for Ash Grammar"]').element.value).toBe('child-1');
      expect(button('Set them reading')).toBeDefined();
      expect(button('Pay the 10')).toBeDefined();
    } finally { w.unmount(); }
  });
});
