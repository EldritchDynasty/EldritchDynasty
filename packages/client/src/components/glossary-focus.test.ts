// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import GlossaryText from './GlossaryText.vue';
import { glossaryOpener } from '../lib/glossary-focus';
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

  it('recognizes a real glossary opener from another document realm', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    try {
      const embedded = iframe.contentDocument!;
      const button = embedded.createElement('button');
      const text = embedded.createElement('span');
      embedded.body.append(button, text);

      // The global button constructor belongs to the outer page, not this
      // document. This was the check that lost Escape focus restoration.
      expect(button instanceof HTMLButtonElement).toBe(false);
      expect(glossaryOpener(button)).toBe(button);
      expect(glossaryOpener(text)).toBeNull();
      const svgButton = embedded.createElementNS('http://www.w3.org/2000/svg', 'button');
      expect(glossaryOpener(svgButton)).toBeNull();
      expect(glossaryOpener(new EventTarget())).toBeNull();
      expect(glossaryOpener(null)).toBeNull();

      button.focus();
      expect(embedded.activeElement).toBe(button);
      glossaryOpener(button)?.focus();
      expect(embedded.activeElement).toBe(button);
    } finally {
      iframe.remove();
    }
  });
  it('keeps primary keyboard focus when a new passage removes its glossary term', async () => {
    const wrapper = render('Standing was questioned.');
    const first = wrapper.get('button');
    (first.element as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(first.element);

    // A collapsed definition still owns keyboard focus. Replacing the
    // passage destroys its button, so the non-tabbable text host must receive
    // that focus instead of silently dropping it to document.body.
    await wrapper.setProps({ text: 'There is no matching term here.' });
    await nextTick();
    const host = wrapper.get('.glossary-text');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(host.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(host.element);

    // The same failure can occur while the primary opener is expanded.
    await wrapper.setProps({ text: 'Standing was restored.' });
    const primary = wrapper.get('button');
    (primary.element as HTMLButtonElement).focus();
    await primary.trigger('click');
    expect(wrapper.find('[role="note"]').exists()).toBe(true);
    await wrapper.setProps({ text: 'The page was turned.' });
    await nextTick();
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(document.activeElement).toBe(host.element);

    // If the new text still has an alias, keep focus on its surviving button.
    await wrapper.setProps({ text: 'Standing was restored.' });
    const restored = wrapper.get('button');
    (restored.element as HTMLButtonElement).focus();
    await wrapper.setProps({ text: 'Reputation recovered.', proseMode: 'plainenglish' });
    await nextTick();
    expect(wrapper.get('button').text()).toBe('Reputation');
    expect(document.activeElement).toBe(wrapper.get('button').element);
  });

  it('restores focus inside the embedded document that owns a changing passage', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const embedded = iframe.contentDocument!;
    const host = embedded.createElement('div');
    embedded.body.appendChild(host);
    const wrapper = mount(GlossaryText, {
      attachTo: host, props: { text: 'Standing was questioned.', proseMode: 'original' },
    });
    try {
      const first = wrapper.get('button.glossary-term');
      (first.element as HTMLButtonElement).focus();
      expect(embedded.activeElement).toBe(first.element);
      // The outer document sees only the iframe, not its focused descendant.
      expect(document.activeElement).not.toBe(first.element);

      await wrapper.setProps({ text: 'A passage without a glossary term.' });
      await nextTick();
      expect(wrapper.find('button.glossary-term').exists()).toBe(false);
      expect(embedded.activeElement).toBe(wrapper.get('.glossary-text').element);

      await wrapper.setProps({ text: 'Standing was questioned.' });
      const primary = wrapper.get('button.glossary-term');
      await primary.trigger('click');
      const note = wrapper.get('[role="note"]');
      (note.element as HTMLElement).focus();
      expect(embedded.activeElement).toBe(note.element);
      await wrapper.setProps({ text: 'Standing was challenged.' });
      await nextTick();
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(embedded.activeElement).toBe(wrapper.get('button.glossary-term').element);

      // Changing another control should never pull focus back into this passage.
      const other = embedded.createElement('button');
      embedded.body.appendChild(other);
      other.focus();
      await wrapper.setProps({ text: 'Standing was restored.' });
      await nextTick();
      expect(embedded.activeElement).toBe(other);
    } finally {
      wrapper.unmount();
      iframe.remove();
    }
  });

  it('restores changing-passage focus through an open shadow root (#2650)', async () => {
    const outer = document.createElement('div');
    const shadow = outer.attachShadow({ mode: 'open' });
    const host = document.createElement('div');
    shadow.append(host);
    document.body.append(outer);
    const wrapper = mount(GlossaryText, {
      attachTo: host, props: { text: 'Standing was questioned.', proseMode: 'original' },
    });
    try {
      const primary = wrapper.get('button.glossary-term');
      (primary.element as HTMLButtonElement).focus();
      // The owning document exposes the shadow HOST, not the focused button.
      expect(document.activeElement).toBe(outer);
      expect(shadow.activeElement).toBe(primary.element);

      // Removing a collapsed glossary button still needs a reachable
      // programmatic focus destination, not a reset to the shadow host.
      await wrapper.setProps({ text: 'A passage without a matching term.' });
      await nextTick();
      const passage = wrapper.get('.glossary-text');
      expect(wrapper.find('button.glossary-term').exists()).toBe(false);
      expect(shadow.activeElement).toBe(passage.element);

      // Removing an expanded note must return focus to the primary button
      // still present in the updated passage.
      await wrapper.setProps({ text: 'Standing was restored.' });
      await wrapper.get('button.glossary-term').trigger('click');
      const note = wrapper.get('[role="note"]');
      (note.element as HTMLElement).focus();
      expect(shadow.activeElement).toBe(note.element);
      await wrapper.setProps({ text: 'Standing was challenged.' });
      await nextTick();
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(shadow.activeElement).toBe(wrapper.get('button.glossary-term').element);

      // Changing a different control's reading preference must not steal
      // focus from that control back into an unrelated glossary passage.
      const other = document.createElement('button');
      shadow.append(other);
      other.focus();
      expect(shadow.activeElement).toBe(other);
      await wrapper.setProps({ text: 'Standing recovered.' });
      await nextTick();
      expect(shadow.activeElement).toBe(other);
    } finally {
      wrapper.unmount();
      outer.remove();
    }
  });

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

      // Changing the live language removes the nested button that currently
      // owns keyboard focus. Restore the primary term, not document.body.
      await first.trigger('click');
      const related = wrapper.findAll('button').find((button) => button.text() === 'Ledger')!;
      await related.trigger('click');
      (related.element as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(related.element);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      // The watcher restores focus after its own DOM-flush tick.
      await nextTick();
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(first.attributes('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(first.element);

      // No alias in the replacement passage: retain a programmatic focus
      // destination without adding a second keyboard Tab stop.
      await first.trigger('click');
      const plainRelated = wrapper.findAll('button').find((button) => button.text() === 'Book of debts')!;
      await plainRelated.trigger('click');
      (plainRelated.element as HTMLButtonElement).focus();
      await wrapper.setProps({ text: 'There is no matching term here.' });
      await nextTick();
      expect(wrapper.find('button').exists()).toBe(false);
      const textRoot = wrapper.get('.glossary-text');
      expect(textRoot.attributes('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(textRoot.element);

      // A reader who changed their preference elsewhere keeps focus there.
      const external = document.createElement('button');
      document.body.append(external);
      try {
        external.focus();
        await wrapper.setProps({ text: 'Standing was restored.' });
        await nextTick();
        expect(document.activeElement).toBe(external);
      } finally {
        external.remove();
      }
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

describe('authored Discrepancy disclosure and Standing relation (#2603)', () => {
  it('follows a related term in both reading modes, then returns keyboard focus on Escape', async () => {
    for (const proseMode of ['original', 'plainenglish'] as const) {
      const label = proseMode === 'original' ? 'Discrepancy' : 'Disputed account';
      const relatedName = proseMode === 'original' ? 'Standing' : 'Reputation';
      const text = label + ' was questioned.';
      const wrapper = render(text, proseMode);
      const first = wrapper.get('button.glossary-term');
      expect(first.text()).toBe(label);
      await first.trigger('click');
      expect(wrapper.findAll('[role="note"]')).toHaveLength(1);
      const related = wrapper.findAll('button.glossary-term')
        .find(button => button.text() === relatedName);
      expect(related).toBeDefined();
      await related!.trigger('click');
      expect(wrapper.findAll('[role="note"]')).toHaveLength(2);
      expect(wrapper.findAll('button.glossary-term')).toHaveLength(2);
      const nested = wrapper.findAll('[role="note"]')[1]!;
      expect(nested.text()).toContain(
        proseMode === 'original'
          ? 'the regard the wider world gives the house.'
          : 'How the wider world regards this family.',
      );
      (nested.element as HTMLElement).focus();
      await nested.trigger('keydown', { key: 'Escape' });
      expect(wrapper.findAll('[role="note"]')).toHaveLength(1);
      expect(document.activeElement).toBe(related!.element);
      await first.trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('[role="note"]').exists()).toBe(false);
      expect(document.activeElement).toBe(first.element);
      expect(wrapper.text()).toBe(text);
    }
  });
});
