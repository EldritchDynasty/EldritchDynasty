// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Naming from './Naming.vue';

function view(...people: string[]): SessionView {
  return {
    namesWanted: people.map((person, index) => ({
      person,
      born: 1080,
      sex: index % 2 === 0 ? 'male' : 'female',
      suggested: `Suggested ${index}`,
      because: 'The chronicler has a reason.',
    })),
  } as unknown as SessionView;
}

function actions(): GameActions {
  return {
    name: vi.fn(() => true),
    keepSuggestedName: vi.fn(() => true),
    keepSuggestedNames: vi.fn(),
  } as unknown as GameActions;
}

describe('naming draft lifetime (#1319)', () => {
  it('discards drafts after Keep all empties the queue, even if a person id appears again', async () => {
    const game = actions();
    const wrapper = mount(Naming, { props: { view: view('child-1', 'child-2'), actions: game } });
    try {
      await wrapper.get('.child input').setValue('A name still being considered');

      const keepAll = wrapper.findAll('button')
        .find((button) => button.text() === 'Keep the names he suggests');
      expect(keepAll).toBeTruthy();
      await keepAll!.trigger('click');
      expect(game.keepSuggestedNames).toHaveBeenCalledOnce();

      // The parent publishes the resolved queue after the action.
      await wrapper.setProps({ view: view() });
      expect(wrapper.find('.child input').exists()).toBe(false);

      // New sessions may recycle person ids; an old, unsubmitted name must not return.
      await wrapper.setProps({ view: view('child-1') });
      expect((wrapper.get('.child input').element as HTMLInputElement).value).toBe('');
    } finally {
      wrapper.unmount();
    }
  });

  it('preserves typed drafts for still-waiting children while removing departed drafts', async () => {
    const wrapper = mount(Naming, { props: { view: view('child-1', 'child-2'), actions: actions() } });
    try {
      await wrapper.findAll('.child input')[0]!.setValue('First draft');
      await wrapper.findAll('.child input')[1]!.setValue('Second draft');

      await wrapper.setProps({ view: view('child-2') });
      expect((wrapper.get('.child input').element as HTMLInputElement).value).toBe('Second draft');

      await wrapper.setProps({ view: view('child-1', 'child-2') });
      const inputs = wrapper.findAll('.child input');
      expect((inputs[0]!.element as HTMLInputElement).value).toBe('');
      expect((inputs[1]!.element as HTMLInputElement).value).toBe('Second draft');
    } finally {
      wrapper.unmount();
    }
  });
});
