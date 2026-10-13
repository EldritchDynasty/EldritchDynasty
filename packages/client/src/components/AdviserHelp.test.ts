// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { AdviserAdvice, HelpTier } from '@ed/core';
import AdviserHelp from './AdviserHelp.vue';
import Ambition from './Ambition.vue';
import ReadingSettings from './ReadingSettings.vue';
import Chronicle from './Chronicle.vue';
import TreeCounsel from './TreeCounsel.vue';
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

  it('requires a newly rendered button before revealing another advice tier (#1480)', async () => {
    const ask = vi.fn((tier: HelpTier) => [line(tier)]);
    const wrapper = mount(AdviserHelp, { props: { ask } });
    try {
      const button = wrapper.get('button').element as HTMLButtonElement;
      // These clicks all target the same tier-one label before Vue repaints.
      button.click();
      button.click();
      button.click();
      expect(ask.mock.calls.map(([tier]) => tier)).toEqual([1]);

      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('Begin with one name.');
      expect(wrapper.text()).not.toContain('family record');
      expect(wrapper.get('button').text()).toBe('Ask what the house knows');

      // Once the next label is visible, one more tier is intentional.
      button.click();
      button.click();
      expect(ask.mock.calls.map(([tier]) => tier)).toEqual([1, 2]);
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('family record');
      expect(wrapper.text()).not.toContain('Find somebody');

      await wrapper.get('button').trigger('click');
      expect(ask.mock.calls.map(([tier]) => tier)).toEqual([1, 2, 3]);
      expect(wrapper.text()).toContain('Find somebody');
      expect(wrapper.find('button').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('does not repeat an unanswered advice request in the same tick (#1480)', async () => {
    const ask = vi.fn((): AdviserAdvice[] => []);
    const wrapper = mount(AdviserHelp, { props: { ask, resetKey: 'first' } });
    try {
      const button = wrapper.get('button').element as HTMLButtonElement;
      button.click();
      button.click();
      expect(ask).toHaveBeenCalledTimes(1);
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('Nobody at the table answers.');
      expect(wrapper.find('button').exists()).toBe(false);

      await wrapper.setProps({ resetKey: 'second' });
      expect(wrapper.get('button').text()).toBe('Ask an adviser');
      await wrapper.get('button').trigger('click');
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
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


describe('tree counsel ignores a departed selection (#1504)', () => {
  const photograph = (people: { id: string; head: boolean }[]): SessionView => ({
    house: 'House Salt',
    halls: [{
      id: 'seat', name: 'The Seat', isSeat: true, grievance: 0,
      members: people.map((person) => ({ ...person, name: person.id })),
    }],
  }) as unknown as SessionView;

  it('retargets fresh advice to the sitting Head when the old selected person leaves', async () => {
    const advice = vi.fn((_surface: string, _person: string, tier: HelpTier) => [line(tier)]);
    const wrapper = mount(TreeCounsel, {
      props: {
        view: photograph([{ id: 'former', head: false }, { id: 'head-1', head: true }]),
        selected: 'former',
        actions: { advice } as unknown as Pick<GameActions, 'advice'>,
      },
    });
    try {
      await wrapper.get('.adviser-help button').trigger('click');
      expect(advice).toHaveBeenLastCalledWith('tree', 'former', 1);
      expect(wrapper.text()).toContain('Begin with one name.');

      // A world photograph can replace the living roster without changing
      // App's selected id. The old person's counsel must not survive.
      await wrapper.setProps({
        view: photograph([{ id: 'head-2', head: true }, { id: 'other', head: false }]),
      });
      expect(wrapper.text()).not.toContain('Begin with one name.');
      await wrapper.get('.adviser-help button').trigger('click');
      expect(advice).toHaveBeenLastCalledWith('tree', 'head-2', 1);

      // A fresh, visible selection still takes precedence over the Head.
      await wrapper.setProps({ selected: 'other' });
      expect(wrapper.get('.adviser-help button').text()).toBe('Ask an adviser');
      await wrapper.get('.adviser-help button').trigger('click');
      expect(advice).toHaveBeenLastCalledWith('tree', 'other', 1);
      expect(advice).toHaveBeenCalledTimes(3);
    } finally {
      wrapper.unmount();
    }
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

describe('reader-local ReadingSettings copy (#1454)', () => {
  const preferences = {
    textScale: 'standard' as const,
    readingFont: 'book' as const,
    proseMode: 'original' as const,
    skipSeenProse: false,
    reduceMotion: false,
    showEverythingFromStart: false,
    showProgressiveRevealOption: false,
  };

  it('changes only its local wording on Original → Plain English → Original', async () => {
    const wrapper = mount(ReadingSettings, { props: preferences });
    try {
      const original = wrapper.text();
      expect(original).toContain('Text size');
      expect(original).toContain('Typeface');
      expect(original).toContain('Skip reading I\'ve already done');
      expect(original).toContain('pages already written in the Chronicle keep the words');
      expect(wrapper.get('select[aria-label="Prose style"]').element).toBeTruthy();

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('How big the text is');
      expect(wrapper.text()).toContain('Book-style letters');
      expect(wrapper.text()).toContain('Skip passages I have read before');
      expect(wrapper.text()).toContain('Use fewer animations');
      expect(wrapper.text()).toContain('Your reading choices do not change the game rules.');
      expect(wrapper.text()).not.toContain('pages already written in the Chronicle keep the words');
      expect(wrapper.get('select[aria-label="Writing style"]').element).toBeTruthy();
      expect(wrapper.findAll('select')).toHaveLength(3);
      expect(wrapper.get('option[value="original"]').text()).toBe('Original');
      expect(wrapper.get('option[value="plainenglish"]').text()).toBe('Plain English');

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(wrapper.get('select[aria-label="Prose style"]').element).toBeTruthy();
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps every settings value and update event unchanged in both modes', async () => {
    const wrapper = mount(ReadingSettings, { props: { ...preferences, proseMode: 'plainenglish' } });
    try {
      const selects = wrapper.findAll('select');
      expect(selects[0]!.element.value).toBe('standard');
      expect(selects[1]!.element.value).toBe('book');
      expect(selects[2]!.element.value).toBe('plainenglish');
      await selects[0]!.setValue('largest');
      await selects[1]!.setValue('readable');
      await selects[2]!.setValue('original');
      expect(wrapper.emitted('update:textScale')).toEqual([['largest']]);
      expect(wrapper.emitted('update:readingFont')).toEqual([['readable']]);
      expect(wrapper.emitted('update:proseMode')).toEqual([['original']]);

      const checks = wrapper.findAll('input[type="checkbox"]');
      expect(checks).toHaveLength(2);
      await checks[0]!.setValue(true);
      await checks[1]!.setValue(true);
      expect(wrapper.emitted('update:skipSeenProse')).toEqual([[true]]);
      expect(wrapper.emitted('update:reduceMotion')).toEqual([[true]]);

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.findAll('select')[0]!.element.value).toBe('standard');
      await wrapper.findAll('select')[0]!.setValue('large');
      expect(wrapper.emitted('update:textScale')).toEqual([['largest'], ['large']]);
    } finally {
      wrapper.unmount();
    }
  });

  it('shows the progressive reveal setting only when requested, with the same event', async () => {
    const wrapper = mount(ReadingSettings, { props: { ...preferences, proseMode: 'plainenglish' } });
    try {
      expect(wrapper.text()).not.toContain('Show all options right away');
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2);
      await wrapper.setProps({ showProgressiveRevealOption: true });
      expect(wrapper.text()).toContain('Show all options right away');
      const controls = wrapper.findAll('input[type="checkbox"]');
      expect(controls).toHaveLength(3);
      await controls[2]!.setValue(true);
      expect(wrapper.emitted('update:showEverythingFromStart')).toEqual([[true]]);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toContain('Show everything from the start');
      await wrapper.setProps({ showProgressiveRevealOption: false });
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });
});

/** A first house plan starts outside the Change editor, but a refusal must
 * survive the same fresh world photograph every order publishes. (#1519) */
describe('first house ambition refusal after view refresh (#1519)', () => {
  function ambitionView(id: string | null = null): SessionView {
    return {
      ambition: id ? {
        id, name: id === 'land' ? 'Keep the estate' : 'Keep the bloodline',
        purpose: 'Keep a plan in sight.',
        progress: { label: 'The house has begun.' },
        status: 'Ongoing', next: 'Continue the work.',
      } : null,
      ambitionOptions: [
        { id: 'blood', name: 'Keep the bloodline', purpose: 'Remember the children.' },
        { id: 'land', name: 'Keep the estate', purpose: 'Hold what the family owns.' },
      ],
    } as unknown as SessionView;
  }

  it('holds the refused first draft across a refreshed world and allows retry', async () => {
    const setAmbition = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(), actions: { setAmbition } as unknown as GameActions },
    });
    try {
      expect(wrapper.find('.ambition-head button').exists()).toBe(false);
      await wrapper.get('select').setValue('land');
      await wrapper.get('.ambition-actions button').trigger('click');
      expect(setAmbition).toHaveBeenCalledWith('land');

      // GameStore.setAmbition publishes a fresh world even after refusal.
      await wrapper.setProps({ view: ambitionView() });
      expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('land');
      expect(wrapper.get('[role="alert"]').text()).toContain('could not keep that ambition');

      await wrapper.get('.ambition-actions button').trigger('click');
      expect(setAmbition.mock.calls).toEqual([['land'], ['land']]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      await wrapper.setProps({ view: ambitionView('land') });
      expect(wrapper.text()).toContain('Keep the estate');
      expect(wrapper.find('select').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
  it('dispatches only the first ambition order from competing same-render controls (#1555)', async () => {
    const setAmbition = vi.fn(() => true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView('blood'), actions: { setAmbition } as unknown as GameActions },
    });
    try {
      await wrapper.get('.ambition-head button').trigger('click');
      await wrapper.get('select').setValue('land');
      const buttons = wrapper.findAll('.ambition-actions button');
      expect(buttons).toHaveLength(3);
      // Keep and Clear are both on the old DOM until Vue processes the result.
      const keep = buttons[0]!.element as HTMLButtonElement;
      const clear = buttons[1]!.element as HTMLButtonElement;
      keep.click();
      clear.click();
      keep.click();
      expect(setAmbition.mock.calls).toEqual([['land']]);

      // A new rendering allows a fresh, deliberately requested Clear.
      await wrapper.vm.$nextTick();
      await wrapper.get('.ambition-head button').trigger('click');
      await wrapper.findAll('.ambition-actions button')[1]!.trigger('click');
      expect(setAmbition.mock.calls).toEqual([['land'], [null]]);
    } finally {
      wrapper.unmount();
    }
  });

  it('re-enables a refused ambition order on the next render without taking a stale Clear (#1555)', async () => {
    const setAmbition = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView('blood'), actions: { setAmbition } as unknown as GameActions },
    });
    try {
      await wrapper.get('.ambition-head button').trigger('click');
      const buttons = wrapper.findAll('.ambition-actions button');
      (buttons[0]!.element as HTMLButtonElement).click();
      (buttons[1]!.element as HTMLButtonElement).click();
      expect(setAmbition.mock.calls).toEqual([['blood']]);
      await wrapper.vm.$nextTick();
      expect(wrapper.get('[role="alert"]').text()).toContain('could not keep that ambition');

      await wrapper.get('.ambition-actions button').trigger('click');
      expect(setAmbition.mock.calls).toEqual([['blood'], ['blood']]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

});
