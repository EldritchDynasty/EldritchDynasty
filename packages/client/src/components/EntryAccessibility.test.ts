// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChronicleEntry } from '@ed/core';
import Entry from './Entry.vue';

const page = {
  id: 'chronicle-later',
  year: 1092,
  weight: 'line',
  title: 'The family remembers',
  text: 'The words already saved in the Chronicle remain unchanged.',
  named: false,
} as ChronicleEntry;

describe('Chronicle causal-link reader wording (#1701)', () => {
  it('toggles a real backlink and several answer years without changing navigation or saved prose', async () => {
    const source = structuredClone(page);
    const links = { cause: { year: 1042, page: 'chr_7', blank: false }, answered: [1103, 1128] };
    const w = mount(Entry, { props: {
      entry: page, links, proseMode: 'original',
    } });
    try {
      expect(w.get('button.link').text()).toBe('see 1042');
      expect(w.text()).toContain('answered in 1103 and 1128');
      expect(w.text()).toContain(source.text!);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('button.link').text()).toBe('See the Chronicle entry from 1042');
      expect(w.text()).toContain('Later responses were recorded in 1103 and 1128.');
      expect(w.text()).toContain(source.text!);
      await w.get('button.link').trigger('click');
      expect(w.emitted('follow')).toEqual([['chr_7']]);
      await w.setProps({ proseMode: 'original' });
      expect(w.get('button.link').text()).toBe('see 1042');
      expect(w.text()).toContain('answered in 1103 and 1128');
      expect(page).toEqual(source);
      expect(w.emitted('follow')).toEqual([['chr_7']]);
    } finally { w.unmount(); }
  });

  it('rewords an unwritten cause without inventing a navigable page', async () => {
    const links = { cause: { year: 1042, blank: false }, answered: [1110] };
    const w = mount(Entry, { props: { entry: page, links, proseMode: 'original' } });
    try {
      expect(w.text()).toContain('1042; the book has no page for it');
      expect(w.find('button.link').exists()).toBe(false);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('No Chronicle entry was written for 1042.');
      expect(w.text()).toContain('Later responses were recorded in 1110.');
      expect(w.find('button.link').exists()).toBe(false);
      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('1042; the book has no page for it');
      expect(w.emitted('follow')).toBeUndefined();
    } finally { w.unmount(); }
  });
});
