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

  it('clears previously requested tree and hall counsel when the world snapshot changes in the same year', async () => {
    const advice = vi.fn((_surface: HelpSurface, _subject: string, _tier: HelpTier) => [line]);
    const wrapper = mount(TreeCounsel, {
      props: { view, selected: 'daughter', actions: { advice } },
    });

    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.findAll('blockquote')).toHaveLength(2);
    expect(advice).toHaveBeenCalledTimes(2);

    // GameSession retakes the view after a verb, including mid-year changes.
    // Neither the selected person nor the hall id has changed.
    const changed = {
      ...view,
      halls: view.halls.map((hall) => hall.isSeat ? hall : { ...hall, grievance: 24 }),
    };
    await wrapper.setProps({ view: changed });

    expect(wrapper.findAll('blockquote')).toHaveLength(0);
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Ask an adviser',
      'Ask an adviser',
    ]);
    expect(advice).toHaveBeenCalledTimes(2); // Advice must remain pull-only.

    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(advice).toHaveBeenNthCalledWith(3, 'tree', 'daughter', 1);
    expect(advice).toHaveBeenNthCalledWith(4, 'branches', 'branch_elm', 1);
    expect(wrapper.findAll('blockquote')).toHaveLength(2);
    wrapper.unmount();
  });
});
