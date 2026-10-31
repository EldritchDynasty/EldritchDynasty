// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import type { RememberedPassage } from '../lib/game';
import Passage from './Passage.vue';

describe('in-place glossary on non-navigable factual passage lines (#2087)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'keeps the %s account and person navigation intact while explaining a term',
    async (proseMode) => {
      const passages = [{
        year: 1100,
        lines: [
          { kind: 'birth', person: 'living', text: 'Standing improved for the child.' },
          { kind: 'marriage', person: 'departed', text: 'Reputation changed. Reputation changed again.' },
          {
            kind: 'death', person: 'departed', text: 'The last of the line died.',
            remembered: { label: 'the last heir', because: 'they held the seal' },
          },
        ],
      }] as unknown as RememberedPassage[];
      const halls = [{ members: [{ id: 'living' }] }] as unknown as SessionView['halls'];
      const snapshot = structuredClone(passages);
      const wrapper = mount(Passage, {
        attachTo: document.body,
        props: { passages, halls, proseMode },
      });
      try {
        // A living person's navigable text must remain one button, never a
        // glossary button nested in another button.
        expect(wrapper.findAll('li > button')).toHaveLength(1);
        expect(wrapper.get('li > button').text()).toBe('Standing improved for the child.');
        expect(wrapper.find('li > button .glossary-term').exists()).toBe(false);

        const marked = wrapper.findAll('li .glossary-term');
        expect(marked).toHaveLength(1);
        expect(marked[0]!.text()).toBe('Reputation');
        expect(wrapper.get('li.marriage').text()).toContain('Reputation changed again.');
        (marked[0]!.element as HTMLButtonElement).focus();
        await marked[0]!.trigger('click');
        expect(marked[0]!.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('.glossary-definition').text()).toBe(
          proseMode === 'original'
            ? 'the regard the wider world gives the house.'
            : 'How the wider world regards this family.',
        );

        // A mode change may collapse a previously opened definition. Finish
        // this disclosure, then deliberately open the next mode's definition:
        // both modes must still be accessible, without requiring stale state.
        await marked[0]!.trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.glossary-definition').exists()).toBe(false);
        expect(document.activeElement).toBe(marked[0]!.element);

        await wrapper.setProps({
          proseMode: proseMode === 'original' ? 'plainenglish' : 'original',
        });
        expect(marked[0]!.attributes('aria-expanded')).toBe('false');
        await marked[0]!.trigger('click');
        expect(marked[0]!.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('.glossary-definition').text()).toBe(
          proseMode === 'original'
            ? 'How the wider world regards this family.'
            : 'the regard the wider world gives the house.',
        );
        await marked[0]!.trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.glossary-definition').exists()).toBe(false);
        expect(document.activeElement).toBe(marked[0]!.element);

        await wrapper.get('li > button').trigger('click');
        expect(wrapper.emitted('select')).toEqual([['living']]);
        expect(wrapper.get('li.death').text()).toContain('they held the seal');
        expect(passages).toEqual(snapshot);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('cannot insert glossary controls into a frame when no factual passage exists', () => {
    // The 1542 frame is handled by Interlude, not by this factual-year panel.
    const wrapper = mount(Passage, { props: { passages: [], halls: [] } });
    try {
      expect(wrapper.find('.passage').exists()).toBe(false);
      expect(wrapper.find('.glossary-term').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
