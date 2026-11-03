// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ReadingSettings from './ReadingSettings.vue';

describe('sound volume slider (#2641)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'represents 25 percent and permits an exact one-percent adjustment in %s',
    async (proseMode) => {
      const wrapper = mount(ReadingSettings, {
        props: {
          textScale: 'standard',
          readingFont: 'book',
          proseMode,
          skipSeenProse: false,
          reduceMotion: false,
          sound: true,
          soundVolume: 0.25,
          showSoundOption: true,
        },
      });
      try {
        const slider = wrapper.get('input[type="range"]');
        expect(slider.attributes('min')).toBe('0');
        expect(slider.attributes('max')).toBe('100');
        expect(slider.attributes('step')).toBe('1');
        expect((slider.element as HTMLInputElement).value).toBe('25');
        expect(slider.attributes('aria-valuetext')).toBe('25%');

        await slider.setValue('26');
        expect(wrapper.emitted('update:soundVolume')).toEqual([[0.26]]);
      } finally {
        wrapper.unmount();
      }
    },
  );
});
