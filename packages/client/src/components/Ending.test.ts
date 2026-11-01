// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { EpilogueView, SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';
import Ending from './Ending.vue';

const actions = {
  restart: vi.fn(),
  shareCode: () => ({ ok: false as const, unavailable: 'not_founded' as const }),
} as unknown as GameActions;

const epilogue = {
  year: 1075, title: 'The verdict', summary: 'The finished account.',
  opening: 'A recorded beginning.', closing: 'A final line.',
  read: [], ring: [],
  reckoning: {
    pages: 1, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
    clauses: 0, clausesTotal: 3, attested: 'none',
    rungsWithheld: 0, livingBlood: 2,
  },
} as unknown as EpilogueView;

function view(campaign: 'demo' | 'short' | 'long'): SessionView {
  return {
    houseName: 'House Ash', seed: 2207,
    campaign: { id: campaign, name: campaign, startYear: 1042, endYear: 1075 },
  } as SessionView;
}

describe('Demonstration verdict guidance (#2207)', () => {
  for (const mode of ['original', 'plainenglish'] as const satisfies readonly ProseMode[]) {
    it(`explains the longer campaigns and no-transfer rule in ${mode}`, () => {
      const wrapper = mount(Ending, { props: { view: view('demo'), epilogue, actions, proseMode: mode } });
      try {
        const note = wrapper.get('.demo-next');
        expect(note.get('h3').text()).toBe(mode === 'original' ? 'Beyond this account' : 'Continue with a full campaign');
        expect(note.attributes('aria-labelledby')).toBe('demo-next-title');
        expect(note.text()).toMatch(/Library of Houses/);
        expect(note.text()).toMatch(/Demonstration/);
        expect(note.text()).toMatch(/Short/);
        expect(note.text()).toMatch(/Long/);
        expect(note.text()).toMatch(/generations/);
        expect(note.text()).toMatch(/Ages/);
        expect(note.text()).toMatch(/Record/);
        expect(note.text()).toMatch(/creditor/);
        expect(note.text()).toMatch(/sav(ed|e)/i);
        expect(note.text()).toMatch(/cannot/);
        expect(note.text()).not.toMatch(/wishlist|Steam|minutes|hours/i);
      } finally {
        wrapper.unmount();
      }
    });

    for (const campaign of ['short', 'long'] as const) {
      it(`leaves the ${campaign} verdict untouched in ${mode}`, () => {
        const wrapper = mount(Ending, { props: { view: view(campaign), epilogue, actions, proseMode: mode } });
        try {
          expect(wrapper.find('.demo-next').exists()).toBe(false);
          expect(wrapper.get('.closing').text()).toBe('A final line.');
          expect(wrapper.get('h1').text()).toBe('The verdict');
        } finally {
          wrapper.unmount();
        }
      });
    }
  }

  it('switches the guidance with the reader mode without changing the recorded ending', async () => {
    const wrapper = mount(Ending, { props: { view: view('demo'), epilogue, actions, proseMode: 'original' } });
    try {
      expect(wrapper.get('.demo-next').text()).toContain('Another house must sign its own beginning.');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.demo-next').text()).toContain('a longer line begins as a new house.');
      expect(wrapper.get('.closing').text()).toBe('A final line.');
      await wrapper.setProps({ view: view('short') });
      expect(wrapper.find('.demo-next').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
