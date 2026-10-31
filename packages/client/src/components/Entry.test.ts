// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChronicleEntry } from '@ed/core';
import Entry from './Entry.vue';

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
