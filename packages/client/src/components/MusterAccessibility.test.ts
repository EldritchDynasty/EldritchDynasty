// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Muster from './Muster.vue';

describe('war position choices have a readable group name (#1671)', () => {
  it('keeps position identifiers, costs, disabled states, and orders as prose mode changes', async () => {
    const view = { muster: {
      began: 1126, men: 3, maxMen: 12, tide: 64, credit: 4.5,
      officers: [{ name: 'Maren', id: 'maren' }],
      positionName: undefined,
      positions: [
        { id: 'held', name: 'Hold the pass', current: false, canBuy: true, price: 70 },
        { id: 'none', name: 'No declared banner', current: true, canBuy: false },
      ],
    } } as unknown as SessionView;
    const snapshot = structuredClone(view);
    const muster = vi.fn();
    const w = mount(Muster, { props: {
      view, refusal: null, actions: { muster } as unknown as GameActions,
      proseMode: 'original',
    } });
    try {
      const group = () => w.get('.positions[role="group"]');
      const controls = () => group().findAll('button');
      const state = () => controls().map((button) => ({
        text: button.text(),
        disabled: button.attributes('disabled') !== undefined,
      }));
      const initial = state();
      expect(group().attributes('aria-label')).toBe('Buy a position');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(group().attributes('aria-label')).toBe('Choose a war position to purchase');
      expect(state()).toEqual(initial);
      await controls()[0]!.trigger('click');
      expect(muster).toHaveBeenCalledOnce();
      expect(muster).toHaveBeenCalledWith({ op: 'buy', position: 'held' });
      expect(view).toEqual(snapshot);
      await w.setProps({ proseMode: 'original' });
      expect(group().attributes('aria-label')).toBe('Buy a position');
    } finally {
      w.unmount();
    }
  });
});
