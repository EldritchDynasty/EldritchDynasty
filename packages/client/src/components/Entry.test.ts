// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChronicleEntry } from '@ed/core';
import Entry from './Entry.vue';
import * as authoredContent from '../lib/content';

const makeEntry = (text: string | null, claimTexts: string[]): ChronicleEntry => ({
  id: 'chronicle-standing-evidence',
  year: 1099,
  weight: 'line',
  named: false,
  text,
  claims: claimTexts.map((deed) => ({ kind: 'deed' as const, person: 'heir', text: deed })),
}) as ChronicleEntry;

describe('Chronicle evidence glossary (#2089)', () => {
  it.each(['original', 'plainenglish'] as const)(
    'explains only the first matching claim in %s without rewriting evidence or navigation',
    async (proseMode) => {
      const entry = makeEntry('The court remembered the trial.', [
        'Standing was questioned at the assize.',
        'Reputation followed the heir into the market.',
      ]);
      const before = structuredClone(entry);
      const w = mount(Entry, {
        attachTo: document.body,
        props: { entry, proseMode, people: [{ id: 'heir', name: 'The heir' }] },
      });
      try {
        expect(w.find('p .glossary-term').exists()).toBe(false);
        expect(w.findAll('.claims .glossary-term')).toHaveLength(1);
        expect(w.findAll('.claims li').map((li) => li.text())).toEqual([
          entry.claims?.[0]?.kind === 'deed' ? entry.claims[0].text : '',
          entry.claims?.[1]?.kind === 'deed' ? entry.claims[1].text : '',
        ]);
        const button = w.get('.claims .glossary-term');
        expect(button.text()).toBe('Standing');
        expect(button.attributes('aria-expanded')).toBe('false');
        await button.trigger('click');
        expect(button.attributes('aria-expanded')).toBe('true');
        expect(w.get('.glossary-definition').text()).toContain(
          proseMode === 'plainenglish' ? 'How the wider world regards' : 'the regard the wider world',
        );
        (button.element as HTMLButtonElement).focus();
        await button.trigger('keydown', { key: 'Escape' });
        expect(w.find('.glossary-definition').exists()).toBe(false);
        expect(document.activeElement).toBe(button.element);
        await w.get('[data-person="heir"]').trigger('click');
        expect(w.emitted('person')).toEqual([['heir']]);
        expect(entry).toEqual(before);
      } finally {
        w.unmount();
      }
    },
  );

  it.each(['original', 'plainenglish'] as const)(
    'does not duplicate a term in claims when the %s main sentence already contains one',
    async (proseMode) => {
      const entry = makeEntry('Standing was recorded in the first sentence.', [
        'Reputation was contested by another witness.',
        'Standing was restored.',
      ]);
      const w = mount(Entry, { props: { entry, proseMode } });
      try {
        expect(w.findAll('p .glossary-term')).toHaveLength(1);
        expect(w.find('.claims .glossary-term').exists()).toBe(false);
        expect(w.findAll('.claims li').map((li) => li.text())).toEqual([
          entry.claims?.[0]?.kind === 'deed' ? entry.claims[0].text : '',
          entry.claims?.[1]?.kind === 'deed' ? entry.claims[1].text : '',
        ]);
        await w.setProps({ read: true });
        expect(w.find('.glossary-term').exists()).toBe(false);
        expect(w.findAll('.claims li').map((li) => li.text())).toEqual([
          entry.claims?.[0]?.kind === 'deed' ? entry.claims[0].text : '',
          entry.claims?.[1]?.kind === 'deed' ? entry.claims[1].text : '',
        ]);
      } finally { w.unmount(); }
    },
  );

  it('does not disclose an omitted claim or match a longer word', () => {
    const omitted = makeEntry(null, ['Standing was never written.']);
    const w = mount(Entry, { props: { entry: omitted } });
    try {
      expect(w.find('.claims').exists()).toBe(false);
      expect(w.find('.glossary-term').exists()).toBe(false);
    } finally { w.unmount(); }

    const entry = makeEntry('Outstanding accounts remain.', ['Reputation is the first actual term.']);
    const other = mount(Entry, { props: { entry } });
    try {
      expect(other.findAll('.glossary-term')).toHaveLength(1);
      expect(other.get('.glossary-term').text()).toBe('Reputation');
    } finally { other.unmount(); }
  });
});

describe('authored glossary terms beyond Standing (#2229)', () => {
  it('discloses the first available authored term and keeps later claim terms as plain evidence', async () => {
    const bundle = authoredContent.loadBundle();
    const example = bundle.glossary[0]!;
    const additionalTerm = {
      ...example,
      id: 'ledger',
      names: { original: 'Ledger', plainenglish: 'Recovered clauses' },
      aliases: { original: ['Ledger'], plainenglish: ['Recovered clauses', 'Ledger'] },
      definition: { original: 'the clauses the house has found.', plainenglish: 'The clauses the family has found.' },
      related: [],
    };
    // Test the renderer with a second valid-shaped term without changing the
    // authored YAML or competing for the exclusive content claim.
    const source = vi.spyOn(authoredContent, 'loadBundle').mockReturnValue({
      ...bundle,
      glossary: [...bundle.glossary, additionalTerm],
    });
    const entry = makeEntry('Ledger unsettled the house. Standing remained.', [
      'Standing was questioned.',
      'Ledger was found again.',
    ]);
    const before = structuredClone(entry);
    const wrapper = mount(Entry, { props: { entry, proseMode: 'plainenglish' }, attachTo: document.body });
    try {
      expect(wrapper.findAll('.glossary-term')).toHaveLength(1);
      const button = wrapper.get('.glossary-term');
      expect(button.text()).toBe('Ledger');
      await button.trigger('click');
      expect(wrapper.get('.glossary-definition').text()).toBe('The clauses the family has found.');
      expect(wrapper.find('.claims .glossary-term').exists()).toBe(false);
      (button.element as HTMLButtonElement).focus();
      await button.trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('.glossary-definition').exists()).toBe(false);
      expect(document.activeElement).toBe(button.element);
      await wrapper.setProps({ read: true });
      expect(wrapper.find('.glossary-term').exists()).toBe(false);
      expect(entry).toEqual(before);
    } finally {
      wrapper.unmount();
      source.mockRestore();
    }
  });
});
