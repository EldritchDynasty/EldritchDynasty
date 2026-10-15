// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Muster from './Muster.vue';

describe('Muster reinforcement wording (#1730)', () => {
  it('calls the levy a standard rather than a ceiling when reinforcements exceed it', async () => {
    // The engine clamps the opening levy but explicitly permits larger
    // reinforced commitments. This is a valid photographed war, not corrupt data.
    const view = {
      muster: {
        began: 1107, men: 80, maxMen: 8, credit: 12.5, tide: 50,
        officers: [], positions: [
          { id: 'none', name: 'No purchased position', current: false, canBuy: true, perYear: 0 },
        ],
      },
    } as unknown as SessionView;
    const before = structuredClone(view);
    const muster = vi.fn();
    const wrapper = mount(Muster, {
      props: {
        view, proseMode: 'original',
        actions: { muster } as unknown as GameActions,
        refusal: null,
      },
    });
    const strength = () => wrapper.get('section.muster > p.small').text().replace(/\s+/g, ' ').trim();
    const button = (label: string) => wrapper.findAll('button').find((candidate) => candidate.text() === label);
    try {
      expect(strength()).toContain('80 men in the field since 1107, of a house that could field 8.');
      expect(button('Send more men')).toBeDefined();

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(strength()).toContain("80 troops serving since 1107, compared with the family's standard levy of 8.");
      expect(strength()).not.toContain('maximum');
      expect(button('Send these troops')).toBeDefined();
      await wrapper.get('input[type="number"]').setValue('3');
      await button('Send these troops')!.trigger('click');
      expect(muster).toHaveBeenCalledTimes(1);
      expect(muster).toHaveBeenCalledWith({ op: 'reinforce', men: 3 });

      await wrapper.setProps({ proseMode: 'original' });
      expect(strength()).toContain('80 men in the field since 1107, of a house that could field 8.');
      expect(button('Send more men')).toBeDefined();
      expect(view).toEqual(before);
    } finally {
      wrapper.unmount();
    }
  });
});
