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
