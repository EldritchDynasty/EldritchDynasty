// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import { PendingDecisionS } from '@ed/schema';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Docket from './Docket.vue';

function fixture(): SessionView['docket'][number] {
  // Use a real authored event and the save schema, rather than inventing an
  // impossible kind of decision just to test the presentation.
  const event = loadContent().bundle.events.find((candidate) =>
    candidate.interaction.kind === 'choice' && candidate.interaction.choices.length > 0);
  if (!event) throw new Error('expected at least one authored choice event');
  const persisted = PendingDecisionS.parse({
    kind: 'choice', id: 'decision-reader', year: 1100, event,
    body: 'Authored scene text stays exactly as it was.', fill: {},
    cast: [
      { slot: 'WHO', optional: false, candidates: [{ id: 'person-1', name: 'Alys', age: 21 }] },
      { slot: 'ESCORT_GROUP', optional: true, count: { min: 1, max: 2 },
        candidates: [{ id: 'person-2', name: 'Beren', age: 26 }] },
    ],
    choices: [{ id: 'accept', label: 'Accept the offer', available: true }],
  });
  return {
    ...persisted,
    decidedBy: 'player',
    choicesAreOpen: true,
    arcStep: { instance: { arc: 'arc_the_muster' }, absent: true },
  } as unknown as SessionView['docket'][number];
}

describe('reader-only decision identifiers (#1736, #1737)', () => {
  it('names cast controls in both reading modes but submits the exact authored slot keys (#1736)', async () => {
    const decision = fixture();
    const snapshot = structuredClone(decision);
    const choose = vi.fn(() => true);
    const wrapper = mount(Docket, {
      props: { decision, proseMode: 'original', actions: { choose } as unknown as GameActions },
    });
    try {
      expect(wrapper.get('select[aria-label="Choose WHO"]').exists()).toBe(true);
      expect(wrapper.get('fieldset[aria-label="Name people for ESCORT_GROUP"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('WHO');
      expect(wrapper.text()).toContain('ESCORT_GROUP');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      const single = wrapper.get('select[aria-label="Select a person for who"]');
      const party = wrapper.get('fieldset[aria-label="Select people for escort group"]');
      expect(single.exists()).toBe(true);
      expect(party.exists()).toBe(true);
      expect(wrapper.text()).not.toContain('ESCORT_GROUP');
      await single.setValue('person-1');
      await party.get('input[type="checkbox"]').setValue(true);
      await wrapper.get('.choices button').trigger('click');
      expect(choose).toHaveBeenCalledTimes(1);
      expect(choose).toHaveBeenCalledWith('decision-reader', 'accept', {
        WHO: 'person-1', ESCORT_GROUP: ['person-2'],
      }, 'Accept the offer');

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('select[aria-label="Choose WHO"]').exists()).toBe(true);
      expect(wrapper.get('fieldset[aria-label="Name people for ESCORT_GROUP"]').exists()).toBe(true);
      expect(decision).toEqual(snapshot);
    } finally { wrapper.unmount(); }
  });

  it('formats an arc ID only in Plain English and retains the absent-person fact (#1737)', async () => {
    const decision = fixture();
    const wrapper = mount(Docket, {
      props: { decision, proseMode: 'original', actions: {} as GameActions },
    });
    try {
      const arc = () => wrapper.get('.arc').text().replace(/\s+/g, ' ').trim();
      expect(arc()).toBe('part of arc_the_muster — and one of them is gone');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(arc()).toBe('Part of the story: the muster — one person is absent');
      await wrapper.setProps({ proseMode: 'original' });
      expect(arc()).toBe('part of arc_the_muster — and one of them is gone');
    } finally { wrapper.unmount(); }
  });
});
