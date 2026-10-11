// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Naming from './Naming.vue';

function fixture() {
  const name = vi.fn(() => true);
  const actions = {
    name,
    keepSuggestedName: vi.fn(() => true),
    keepSuggestedNames: vi.fn(() => true),
  } as unknown as GameActions;
  const view = {
    namesWanted: [{
      person: 'child_1',
      born: 1080,
      sex: 'female',
      suggested: 'Mara',
      because: 'The house has to name its heir.',
    }],
  } as unknown as SessionView;
  return { actions, name, view };
}

describe('child naming with an input method (#1286)', () => {
  it('does not accept a name when Enter is used to confirm an IME candidate', async () => {
    const { actions, name, view } = fixture();
    const wrapper = mount(Naming, { props: { actions, view } });
    const input = wrapper.get('input');

    await input.setValue('林');
    await input.trigger('compositionstart');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    await input.trigger('compositionend');
    // A keyup after compositionend must not submit the name either.
    await input.trigger('keyup', { key: 'Enter' });

    expect(name).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('1 child waiting to be named');
    expect((input.element as HTMLInputElement).value).toBe('林');
  });

  it('submits once on an ordinary Enter keydown', async () => {
    const { actions, name, view } = fixture();
    const wrapper = mount(Naming, { props: { actions, view } });
    const input = wrapper.get('input');

    await input.setValue('Mara the Younger');
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    await input.trigger('keyup', { key: 'Enter' });

    expect(name).toHaveBeenCalledTimes(1);
    expect(name).toHaveBeenCalledWith('child_1', 'Mara the Younger');
  });

  it('keeps the Name button path available after composition', async () => {
    const { actions, name, view } = fixture();
    const wrapper = mount(Naming, { props: { actions, view } });

    await wrapper.get('input').setValue('林');
    await wrapper.get('button').trigger('click');

    expect(name).toHaveBeenCalledExactlyOnceWith('child_1', '林');
  });
});
