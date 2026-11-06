// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { SessionView } from '@ed/core';
import ResumeRecap from './ResumeRecap.vue';

const view = {
  houseName: 'House Ash',
  year: 1321,
  generation: 7,
  generationArc: { question: 'Whom shall the head protect?' },
  ambition: { name: 'Preserve the line', next: 'Keep the halls safe.' },
} as unknown as SessionView;

describe('saved-run recap landmark (#1985)', () => {
  it.each([
    ['original', 'The house, taken up again'],
    ['plainenglish', 'Back to your game'],
  ] as const)('uses its visible heading as the accessible landmark name (%s)', async (proseMode, expected) => {
    const before = structuredClone(view);
    const wrapper = mount(ResumeRecap, { props: { view, pending: 1, proseMode } });
    try {
      const landmark = wrapper.get('aside');
      const heading = wrapper.get('h2');
      const id = heading.attributes('id');
      expect(id).toBeTruthy();
      expect(landmark.attributes('aria-labelledby')).toBe(id);
      expect(landmark.attributes('aria-label')).toBeUndefined();
      expect(heading.text()).toBe(expected);
      expect(wrapper.get('details').attributes('open')).toBeUndefined();
      expect(wrapper.text()).toContain('Whom shall the head protect?');
      await wrapper.get('button').trigger('click');
      expect(wrapper.emitted('dismiss')).toEqual([[]]);
      expect(view).toEqual(before);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps distinct landmark ids for concurrent recaps and translates the heading in place', async () => {
    const parent = mount(defineComponent({
      props: { proseMode: { type: String, default: 'original' } },
      setup: (props) => () => h('div', [
        h(ResumeRecap, { view, pending: 0, proseMode: props.proseMode as 'original' | 'plainenglish' }),
        h(ResumeRecap, { view, pending: 0, proseMode: 'plainenglish' }),
      ]),
    }));
    try {
      const [first, second] = parent.findAllComponents(ResumeRecap);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      const firstId = first!.get('h2').attributes('id');
      const secondId = second!.get('h2').attributes('id');
      expect(firstId).toBeTruthy();
      expect(secondId).toBeTruthy();
      expect(firstId).not.toBe(secondId);
      await parent.setProps({ proseMode: 'plainenglish' });
      expect(first!.get('h2').attributes('id')).toBe(firstId);
      expect(first!.get('aside').attributes('aria-labelledby')).toBe(firstId);
      expect(first!.get('h2').text()).toBe('Back to your game');
    } finally {
      parent.unmount();
    }
  });
});
