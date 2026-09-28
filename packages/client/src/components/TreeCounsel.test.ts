// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { AdviserAdvice, HelpSurface, HelpTier, SessionView } from '@ed/core';
import TreeCounsel from './TreeCounsel.vue';

const line: AdviserAdvice = {
  adviser: { id: 'mara', name: 'Mara' },
  lens: 'reader',
  cares: 'she keeps the house book',
  position: 'Begin with one name.',
};

const view = {
  house: 'house_gearithy',
  halls: [
    { id: 'main', name: 'the main hall', isSeat: true, grievance: 0, members: [{ id: 'head', head: true }] },
    { id: 'branch_elm', name: 'Elm Hall', isSeat: false, grievance: 12, members: [] },
  ],
} as unknown as SessionView;

describe('tree and hall counsel', () => {
  it('keeps both surfaces pull-only and sends their visible subject through the client seam', async () => {
    const advice = vi.fn((_surface: HelpSurface, _subject: string, _tier: HelpTier) => [line]);
    const wrapper = mount(TreeCounsel, {
      props: { view, selected: 'daughter', actions: { advice } },
    });

    expect(advice).not.toHaveBeenCalled();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);

    await buttons[0]!.trigger('click');
    expect(advice).toHaveBeenLastCalledWith('tree', 'daughter', 1);

    await buttons[1]!.trigger('click');
    expect(advice).toHaveBeenLastCalledWith('branches', 'branch_elm', 1);
    expect(advice).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 2);
  });
});
