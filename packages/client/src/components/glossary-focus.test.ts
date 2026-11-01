// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import GlossaryText from './GlossaryText.vue';
import { loadBundle } from '../lib/content';
import Entry from './Entry.vue';
import type { ChronicleEntry } from '@ed/core';

const mounted: Array<{ wrapper: VueWrapper; host: HTMLElement }> = [];
function render(text: string, proseMode: 'original' | 'plainenglish' = 'original'): VueWrapper {
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(GlossaryText, { attachTo: host, props: { text, proseMode } });
  mounted.push({ wrapper, host });
  return wrapper;
}
afterEach(() => {
  for (const { wrapper, host } of mounted.splice(0)) {
    wrapper.unmount();
    host.remove();
  }
});

describe('in-place Standing disclosure', () => {
  it('opens by activation and returns focus on Escape without modifying prose', async () => {
    const text = 'Standing declined, then Standing recovered.';
    const wrapper = render(text);
    expect(wrapper.findAll('button')).toHaveLength(1);
    const button = wrapper.get('button');
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).toBe(text);
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('true');
    const note = wrapper.get('[role="note"]');
    expect(note.attributes('id')).toBe(button.attributes('aria-controls'));
    (note.element as HTMLElement).focus();
    expect(document.activeElement).toBe(note.element);
    await note.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.text()).toBe(text);
  });

  it('starts each new line and prose mode with its own collapsed disclosure', async () => {
    const wrapper = render('Standing was raised.');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[role="note"]').exists()).toBe(true);

    // The same component instance may render another passage or Chronicle line.
    await wrapper.setProps({ text: 'Standing was challenged.' });
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('Standing was challenged.');

    // A missing term must not leave a hidden open state for a later line.
    await wrapper.get('button').trigger('click');
    await wrapper.setProps({ text: 'No glossary term here.' });
    expect(wrapper.find('button').exists()).toBe(false);
    await wrapper.setProps({ text: 'Standing was restored.' });
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="note"]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    await wrapper.setProps({ proseMode: 'plainenglish' });
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="note"]').exists()).toBe(false);

    // The new line can still be opened normally with the new definition.
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('[role="note"]').text())
      .toBe('How the wider world regards this family.');
  });

  it('uses the Plain English definition and leaves text with no term alone', async () => {
    const wrapper = render('Reputation is known.', 'plainenglish');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('[role="note"]').text()).toBe('How the wider world regards this family.');
    const historical = render('Standing was challenged.', 'plainenglish');
    await historical.get('button').trigger('click');
    expect(historical.get('[role="note"]').text()).toBe('How the wider world regards this family.');
    const plain = render('An unrelated chronicle line.', 'plainenglish');
    expect(plain.find('button').exists()).toBe(false);
    expect(plain.text()).toBe('An unrelated chronicle line.');
  });

  it('navigates related terms up to the depth cap, avoids cycles and restores each opener on Escape', async () => {
    // The shipped collection currently has one entry. Add a temporary valid
    // fixture to exercise related links before any additional authoring lands.
    const glossary = loadBundle().glossary;
    const previous = [...glossary];
    const standing = previous.find((entry) => entry.id === 'standing')!;
    const ledger = {
      ...standing,
      id: 'ledger',
      names: { original: 'Ledger', plainenglish: 'Book of debts' },
      aliases: { original: ['Ledger'], plainenglish: ['Book of debts'] },
      definition: { original: 'The book in which debts are kept.', plainenglish: 'A record of debts.' },
      related: ['discrepancy', 'standing'],
    };
    const discrepancy = {
      ...standing,
      id: 'discrepancy',
      names: { original: 'Discrepancy', plainenglish: 'Difference' },
      aliases: { original: ['Discrepancy'], plainenglish: ['Difference'] },
      definition: { original: 'Where testimony and the record differ.', plainenglish: 'When accounts do not agree.' },
      related: ['ledger', 'standing'],
    };
    glossary.splice(0, glossary.length, { ...standing, related: ['ledger'] }, ledger, discrepancy);
    try {
      const wrapper = render('Standing was questioned.');
      const first = wrapper.get('button');
      await first.trigger('click');
      expect(wrapper.findAll('[role="note"]')).toHaveLength(1);
      const ledgerOpener = wrapper.findAll('button').find((button) => button.text() === 'Ledger')!;
      expect(ledgerOpener.attributes('aria-expanded')).toBe('false');
      await ledgerOpener.trigger('click');
      expect(ledgerOpener.attributes('aria-expanded')).toBe('true');
      expect(wrapper.findAll('[role="note"]')).toHaveLength(2);
      const discrepancyOpener = wrapper.findAll('button').find((button) => button.text() === 'Discrepancy')!;
      // Returning to Standing would make a cycle; it is not offered.
      expect(wrapper.findAll('button').filter((button) => button.text() === 'Standing')).toHaveLength(1);
      await discrepancyOpener.trigger('click');
      expect(wrapper.findAll('[role="note"]')).toHaveLength(3);
      // No fourth level, even though Discrepancy declares more relations.
      expect(wrapper.findAll('button')).toHaveLength(3);

      const innermost = wrapper.findAll('[role="note"]')[2]!;
      (innermost.element as HTMLElement).focus();
      await innermost.trigger('keydown', { key: 'Escape' });
      expect(wrapper.findAll('[role="note"]')).toHaveLength(2);
      expect(document.activeElement).toBe(discrepancyOpener.element);

      const middle = wrapper.findAll('[role="note"]')[1]!;
      (middle.element as HTMLElement).focus();
      await middle.trigger('keydown', { key: 'Escape' });
      expect(wrapper.findAll('[role="note"]')).toHaveLength(1);
      expect(document.activeElement).toBe(ledgerOpener.element);

      await wrapper.get('[role="note"]').trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(document.activeElement).toBe(first.element);
      expect(wrapper.text()).toBe('Standing was questioned.');

      // A change of language closes all levels, including related disclosures.
      await first.trigger('click');
      await wrapper.findAll('button').find((button) => button.text() === 'Ledger')!.trigger('click');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(first.attributes('aria-expanded')).toBe('false');
    } finally {
      glossary.splice(0, glossary.length, ...previous);
    }
  });

  it('marks only ordinary Chronicle entries, not the creditor reading or omitted pages', () => {
    const entry = {
      id: 'page-test',
      year: 1045,
      text: 'Standing was questioned.',
      title: 'A ledger line',
      record: 'record',
      weight: 'line',
      claims: [],
    } as unknown as ChronicleEntry;
    const chronicle = mount(Entry, { props: { entry, proseMode: 'original' } });
    expect(chronicle.findAll('p button')).toHaveLength(1);
    chronicle.unmount();
    const creditor = mount(Entry, { props: { entry, proseMode: 'original', read: true } });
    expect(creditor.findAll('p button')).toHaveLength(0);
    expect(creditor.text()).toContain(entry.text);
    creditor.unmount();
    const omitted = mount(Entry, {
      props: { entry: { ...entry, record: 'omit', text: null }, proseMode: 'original' },
    });
    expect(omitted.findAll('p button')).toHaveLength(0);
    omitted.unmount();
  });

});
