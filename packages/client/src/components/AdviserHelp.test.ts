// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { AdviserAdvice, HelpTier } from '@ed/core';
import AdviserHelp from './AdviserHelp.vue';
import Chronicle from './Chronicle.vue';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';

function line(tier: HelpTier): AdviserAdvice {
  return {
    adviser: { id: 'mara', name: 'Mara' },
    lens: 'reader',
    cares: 'she keeps the house book',
    position: tier === 1
      ? 'Begin with one name.'
      : tier === 2
        ? 'The family record is the rule the tree can show.'
        : 'Use Find somebody by name.',
  };
}

describe('AdviserHelp', () => {
  it('pulls each tier only after the previous tier has been shown', async () => {
    const ask = vi.fn((tier: HelpTier) => [line(tier)]);
    const wrapper = mount(AdviserHelp, { props: { ask, resetKey: 'tree:edren' } });

    expect(ask).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('family record');
    expect(wrapper.text()).not.toContain('Find somebody');

    await wrapper.get('button').trigger('click');
    expect(ask).toHaveBeenLastCalledWith(1);
    expect(wrapper.text()).toContain('Begin with one name.');
    expect(wrapper.text()).not.toContain('family record');
    expect(wrapper.text()).not.toContain('Find somebody');

    await wrapper.get('button').trigger('click');
    expect(ask).toHaveBeenLastCalledWith(2);
    expect(wrapper.text()).toContain('family record');
    expect(wrapper.text()).not.toContain('Find somebody');

    await wrapper.get('button').trigger('click');
    expect(ask).toHaveBeenLastCalledWith(3);
    expect(wrapper.text()).toContain('Find somebody');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('attributes every rendered line to the named adviser', async () => {
    const wrapper = mount(AdviserHelp, {
      props: { ask: (tier: HelpTier) => [line(tier)] },
    });

    await wrapper.get('button').trigger('click');

    expect(wrapper.text()).toContain('Mara');
    expect(wrapper.text()).toContain('she keeps the house book');
    expect(wrapper.find('blockquote').exists()).toBe(true);
  });

  it('resets the escalation when the surrounding subject changes', async () => {
    const ask = vi.fn((tier: HelpTier) => [line(tier)]);
    const wrapper = mount(AdviserHelp, { props: { ask, resetKey: 'tree:edren' } });

    await wrapper.get('button').trigger('click');
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('family record');

    await wrapper.setProps({ resetKey: 'tree:mara' });

    expect(wrapper.text()).not.toContain('Begin with one name.');
    expect(wrapper.text()).not.toContain('family record');
    expect(wrapper.get('button').text()).toBe('Ask an adviser');
  });

  it('does not skip past an unanswered tier', async () => {
    const ask = vi.fn((): AdviserAdvice[] => []);
    const wrapper = mount(AdviserHelp, { props: { ask } });

    await wrapper.get('button').trigger('click');

    expect(ask).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Nobody at the table answers.');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});


describe('Chronicle adviser counsel freshness (#1139)', () => {
  it('resets shown advice for a new world snapshot in the same house and year', async () => {
    const view = (): SessionView => ({
      house: 'House Salt',
      year: 1080,
      chronicle: [],
      chroniclePeople: [],
      halls: [],
      campaign: { endYear: 1542 },
    }) as unknown as SessionView;
    const advice = vi.fn(() => [line(1)]);
    const actions = {
      advice,
      causeOf: vi.fn(() => []),
      answeredBy: vi.fn(() => []),
    } as unknown as Pick<GameActions, 'advice' | 'causeOf' | 'answeredBy'>;
    const wrapper = mount(Chronicle, { props: { view: view(), frame: [], actions } });
    try {
      await wrapper.get('.adviser-help button').trigger('click');
      expect(advice).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('Begin with one name.');

      // The year and house remain unchanged, but an action has replaced
      // the snapshot; old advice must not appear to describe the new state.
      await wrapper.setProps({ view: view() });
      expect(wrapper.text()).not.toContain('Begin with one name.');
      expect(wrapper.get('.adviser-help button').text()).toBe('Ask an adviser');

      await wrapper.get('.adviser-help button').trigger('click');
      expect(advice).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Begin with one name.');
    } finally {
      wrapper.unmount();
    }
  });
});
