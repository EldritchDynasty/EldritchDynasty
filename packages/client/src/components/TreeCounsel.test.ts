// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
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
  year: 1060,
  house: 'house_gearithy',
  ascension: { rung: 'none', best: 'none', title: 'None', bestTitle: 'None' },
  halls: [
    { id: 'main', name: 'the main hall', isSeat: true, grievance: 0, members: [
      { id: 'head', name: 'The Head', head: true, awakened: false },
      { id: 'daughter', name: 'The Daughter', head: false, awakened: false },
    ] },
    { id: 'branch_elm', name: 'Elm Hall', isSeat: false, grievance: 12, members: [] },
  ],
} as unknown as SessionView;

describe('tree and hall counsel', () => {
  it.each(['original', 'plainenglish'] as const)('reuses the selected woman’s waking evidence (%s)', async (mode) => {
    const current: SessionView = {
      ...view,
      ascension: { ...view.ascension, diagnosis: {
        target: 'hierophant', targetTitle: 'Hierophant', blockers: [], route: {
          title: 'Witnessed lives', rule: 'The mother’s line matters.', caution: 'No child is promised.',
          daughters: [{ person: 'daughter', name: 'Mara', evidence: ['Her father woke in 1040.'] }], cards: [], alternatives: [],
        },
      } },
    };
    const wrapper = mount(TreeCounsel, { props: { view: current, selected: 'daughter', actions: { advice: vi.fn(() => []) }, proseMode: mode } });
    try {
      expect(wrapper.get('.family-evidence').text()).toContain('Her father woke in 1040.');
      expect(wrapper.get('.family-evidence').text()).toContain('No child is promised.');
      await wrapper.setProps({ selected: 'head' });
      expect(wrapper.find('.family-evidence').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('passes the current reading preference through the App tree counsel mount (#1630)', () => {
    const appSource = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(appSource).toContain('<TreeCounsel :view="view" :selected="selected" :actions="actions" :prose-mode="accessibility.proseMode" />');
  });


  it('translates family and household advice without changing tiers, evidence or subjects (#1630)', async () => {
    const advice = vi.fn((_surface: HelpSurface, _subject: string, _tier: HelpTier) => [line]);
    const current: SessionView = {
      ...view,
      halls: view.halls.map((hall) => hall.isSeat ? hall : { ...hall, grievance: 0.35 }),
    };
    const originalView = structuredClone(current);
    const wrapper = mount(TreeCounsel, {
      props: { view: current, selected: 'daughter', actions: { advice }, proseMode: 'original' },
    });
    try {
      expect(wrapper.get('.tree-counsel').attributes('aria-label')).toBe('Counsel about the family');
      expect(wrapper.get('.branch-help summary').text()).toBe("Ask about a hall's grievance");
      expect(wrapper.get('.hall-help p').text()).toContain('Elm Hall · grievance less than 1');
      expect(wrapper.findAll('.adviser-help button').map((button) => button.text()))
        .toEqual(['Ask an adviser', 'Ask an adviser']);
      expect(advice).not.toHaveBeenCalled();

      await wrapper.get('.tree-counsel > .adviser-help button').trigger('click');
      await wrapper.get('.hall-help .adviser-help button').trigger('click');
      expect(advice.mock.calls).toEqual([
        ['tree', 'daughter', 1], ['branches', 'branch_elm', 1],
      ]);
      const savedLines = wrapper.findAll('blockquote').map((block) => block.text());
      expect(savedLines).toHaveLength(2);
      expect(savedLines[0]).toContain('Begin with one name.');
      expect(savedLines[1]).toContain('Mara');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.tree-counsel').attributes('aria-label')).toBe('Advice about the family');
      expect(wrapper.get('.branch-help summary').text()).toBe('Ask why a household is unhappy');
      expect(wrapper.get('.hall-help p').text()).toContain('Elm Hall · grievance score under 1');
      expect(wrapper.findAll('.adviser-help').map((el) => el.attributes('aria-label')))
        .toEqual(['Advice from family advisers', 'Advice from family advisers']);
      expect(wrapper.findAll('.adviser-help button').map((button) => button.text()))
        .toEqual(['Ask what the family knows', 'Ask what the family knows']);
      expect(wrapper.findAll('blockquote').map((block) => block.text())).toEqual(savedLines);
      expect(advice).toHaveBeenCalledTimes(2);
      expect(current).toEqual(originalView);

      await wrapper.get('.hall-help .adviser-help button').trigger('click');
      expect(advice).toHaveBeenLastCalledWith('branches', 'branch_elm', 2);
      expect(wrapper.findAll('blockquote')).toHaveLength(3);

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.tree-counsel').attributes('aria-label')).toBe('Counsel about the family');
      expect(wrapper.get('.branch-help summary').text()).toBe("Ask about a hall's grievance");
      expect(wrapper.get('.hall-help p').text()).toContain('Elm Hall · grievance less than 1');
      expect(wrapper.findAll('.adviser-help button').map((button) => button.text()))
        .toEqual(['Ask what the house knows', 'Ask what can be done']);
      expect(wrapper.findAll('blockquote').slice(0, 2).map((block) => block.text()))
        .toEqual(savedLines);
      expect(advice).toHaveBeenCalledTimes(3);
      expect(current).toEqual(originalView);
    } finally {
      wrapper.unmount();
    }
  });
  it('shows a positive subunit grievance without calling it zero (#1473)', async () => {
    const advice = vi.fn((_surface: HelpSurface, _subject: string, _tier: HelpTier) => [line]);
    const withGrievance = (grievance: number): SessionView => ({
      ...view,
      halls: view.halls.map((hall) => hall.isSeat ? hall : { ...hall, grievance }),
    });
    const wrapper = mount(TreeCounsel, {
      props: { view: withGrievance(0.35), selected: null, actions: { advice } },
    });

    try {
      expect(wrapper.text()).toContain('Elm Hall');
      expect(wrapper.text()).toContain('grievance less than 1');
      expect(wrapper.text()).not.toContain('grievance 0');

      await wrapper.get('.branch-help .adviser-help button').trigger('click');
      expect(advice).toHaveBeenCalledWith('branches', 'branch_elm', 1);

      await wrapper.setProps({ view: withGrievance(1.6) });
      expect(wrapper.text()).toContain('grievance 2');

      await wrapper.setProps({ view: withGrievance(0) });
      expect(wrapper.find('.branch-help').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

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
    expect(changed.year).toBe(view.year);
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
