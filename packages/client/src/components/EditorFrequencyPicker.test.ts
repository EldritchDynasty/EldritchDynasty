// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { FREQUENCY_ORDER } from '@ed/schema';
import FrequencyPicker from '../../../editor/src/components/FrequencyPicker.vue';

/**
 * Mount this editor control in the isolated DOM test project. Vitest's node
 * project compiles Vue SFCs for SSR, so a client renderer cannot mount them.
 */
describe('editor frequency picker selection (#1884)', () => {
  it('exposes a named, single pressed tier and updates on prop changes', async () => {
    const first = FREQUENCY_ORDER[0]!;
    const last = FREQUENCY_ORDER[FREQUENCY_ORDER.length - 1]!;
    const wrapper = mount(FrequencyPicker, { props: { modelValue: first } });
    const buttons = () => wrapper.findAll('.freqpick button');
    try {
      expect(wrapper.get('fieldset legend').text()).toBe('Frequency');
      expect(buttons()).toHaveLength(FREQUENCY_ORDER.length);
      expect(buttons().every((b) => b.attributes('type') === 'button')).toBe(true);
      expect(buttons().map((b) => b.attributes('aria-pressed'))).toEqual(
        FREQUENCY_ORDER.map((f) => String(f === first)),
      );
      expect(wrapper.get('.oblig').text()).toContain('draw weight');

      await buttons()[buttons().length - 1]!.trigger('click');
      expect(wrapper.emitted('update:modelValue')).toEqual([[last]]);
      // The parent owns the model; a click must not mutate its prop.
      expect(buttons()[0]!.attributes('aria-pressed')).toBe('true');

      await wrapper.setProps({ modelValue: last });
      expect(buttons().map((b) => b.attributes('aria-pressed'))).toEqual(
        FREQUENCY_ORDER.map((f) => String(f === last)),
      );
    } finally {
      wrapper.unmount();
    }
  });
});
