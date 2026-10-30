// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import { RUNG_ORDER } from '@ed/schema';
import LadderPath from './LadderPath.vue';

function ladder(): SessionView['ascension'] {
  return {
    rung: 'adept',
    best: 'adept',
    title: 'Adept',
    bestTitle: 'Adept',
    rungs: RUNG_ORDER.map((id) => ({ id, title: id })),
    foremost: { person: 'p1', name: 'Maren', power: 52, spells: 3 },
    diagnosis: {
      target: 'hierophant',
      targetTitle: 'Hierophant',
      name: 'Maren',
      blockers: [{
        kind: 'books',
        text: 'Maren has not read widely enough.',
        hint: 'Have him study another spellbook.',
      }],
    },
  } as SessionView['ascension'];
}

describe('ladder preparation reads the existing diagnosis (#1978)', () => {
  it.each(['original', 'plainenglish'] as const)('names a first obstacle, not a complete list of gates (%s)', (mode) => {
    const ascension = ladder();
    const before = structuredClone(ascension);
    const wrapper = mount(LadderPath, { props: { ascension, proseMode: mode } });
    try {
      const guide = wrapper.get('[data-rung="hierophant"] .preparation-guide');
      expect(guide.attributes('aria-label')).toBe(mode === 'original'
        ? 'Preparing for the next rung' : 'Preparing for the next level');
      expect(guide.text()).toContain('Maren');
      expect(guide.get('.preparation-note').text()).toContain(mode === 'original'
        ? 'another may stand behind it' : 'may reveal another requirement');
      expect(guide.get('.blocker-fact').text()).toBe('Maren has not read widely enough.');
      expect(guide.get('.blocker-action').text()).toContain('Have him study another spellbook.');
      expect(guide.get('.blocker-action .rubric').text()).toBe(mode === 'original'
        ? 'A way forward ·' : 'What to try ·');
      expect(wrapper.findAll('.ladder-blocker')).toHaveLength(1);
      expect(ascension).toEqual(before);
      expect(wrapper.emitted()).toEqual({});
    } finally { wrapper.unmount(); }
  });

  it('replaces the visible guidance on a new engine reading without retaining old advice', async () => {
    const ascension = ladder();
    const wrapper = mount(LadderPath, { props: { ascension } });
    try {
      const next: SessionView['ascension'] = {
        ...ascension,
        diagnosis: {
          target: 'hierophant', targetTitle: 'Hierophant', name: 'Maren',
          blockers: [{ kind: 'respect', text: 'The house needs more regard.', hint: 'Raise Respect.' }],
        },
      };
      await wrapper.setProps({ ascension: next, proseMode: 'plainenglish' });
      expect(wrapper.get('.blocker-fact').text()).toBe('The house needs more regard.');
      expect(wrapper.get('.blocker-action').text()).toContain('Raise Respect.');
      expect(wrapper.text()).not.toContain('Have him study another spellbook.');
      const withoutDiagnosis = { ...ascension };
      delete withoutDiagnosis.diagnosis;
      await wrapper.setProps({ ascension: withoutDiagnosis });
      expect(wrapper.find('.preparation-guide').exists()).toBe(false);
      expect(wrapper.get('[data-rung="hierophant"] .next-rung').text()).toContain('Hierophant');
    } finally { wrapper.unmount(); }
  });

  it('does not imply a clean route when the engine supplies no blocker', () => {
    const ascension = ladder();
    ascension.diagnosis = {
      target: 'hierophant', targetTitle: 'Hierophant', blockers: [],
    };
    const wrapper = mount(LadderPath, { props: { ascension } });
    try {
      expect(wrapper.get('.preparation-guide').text()).toContain('Hierophant');
      expect(wrapper.find('.preparation-note').exists()).toBe(false);
      expect(wrapper.find('.blocker-action').exists()).toBe(false);
      expect(wrapper.findAll('.ladder-blocker')).toHaveLength(0);
    } finally { wrapper.unmount(); }
  });

  it("keeps the evidence route's existing person and Match actions", async () => {
    const ascension = ladder();
    ascension.diagnosis = {
      ...ascension.diagnosis!,
      route: {
        title: 'The blood in witnessed lives',
        rule: 'A son receives the font through his mother.',
        daughters: [{ person: 'mara', name: 'Mara', evidence: ['Her father woke.'] }],
        cards: [{ decision: 'd1', card: 'c1', name: 'Anwen', label: 'Blood', evidence: ['Her brother woke.'] }],
        alternatives: [],
        caution: 'No child is promised.',
      },
    };
    const wrapper = mount(LadderPath, { props: { ascension } });
    try {
      const route = wrapper.get('.power-route');
      expect(route.get('summary').text()).toBe('The blood in witnessed lives');
      await route.findAll('button')[0]!.trigger('click');
      await route.findAll('button')[1]!.trigger('click');
      expect(wrapper.emitted('look')).toEqual([['mara']]);
      expect(wrapper.emitted('match')).toEqual([['d1', 'c1']]);
    } finally { wrapper.unmount(); }
  });
});
