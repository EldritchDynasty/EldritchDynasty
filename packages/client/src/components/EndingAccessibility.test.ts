// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { EpilogueView, SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Ending from './Ending.vue';

describe('ending reckoning uses reader-local Plain English (#1669)', () => {
  it('changes explanatory labels without changing the recorded facts or authored ending', async () => {
    const view = {
      houseName: 'House Ash',
      seed: 47,
      campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
    } as SessionView;
    const epilogue = {
      year: 1542,
      title: 'The old reckoning',
      summary: 'The account is unsettled.',
      opening: 'An original opening.',
      closing: 'An original closing.',
      read: [],
      ring: [],
      founding: { heirloomName: 'The Ring', grudgeName: 'An old debt' },
      reckoning: {
        pages: 10, blanks: 2, embellished: 3,
        standingLies: 4, provenLies: 1,
        clauses: 7, clausesTotal: 9,
        attested: 'master', attestedTitle: 'Master', attestedYear: 1510,
        substantiated: 'adept', substantiatedTitle: 'Adept',
        rungsWithheld: 2, livingBlood: 12,
      },
    } as unknown as EpilogueView;
    const originalSnapshot = structuredClone(epilogue);
    const w = mount(Ending, {
      props: {
        view,
        epilogue,
        actions: { restart: vi.fn() } as unknown as GameActions,
        proseMode: 'original',
      },
    });
    try {
      const labels = () => w.findAll('.tally dt').map((row) => row.text());
      const values = () => w.findAll('.tally dd').map((row) => row.text());
      const originalValues = values();
      expect(labels()).toContain('And could show');
      expect(labels()).toContain('What the book attests');
      expect(w.get('.tally').text()).toContain('4 pages were asked after, and answered with themselves');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(labels()).toContain('Highest level supported by evidence');
      expect(labels()).toContain('Highest level claimed in the Chronicle');
      expect(labels()).toContain('Contract clauses recovered');
      expect(labels()).toContain('Entries embellished');
      expect(w.get('.tally').text()).toContain('4 claims were challenged but supported only by their own pages');
      expect(w.get('.tally').text()).toContain('(1 exposed)');
      expect(values()).toEqual(originalValues.map((value) => value
        .replace('4 pages were asked after, and answered with themselves',
          '4 claims were challenged but supported only by their own pages')
        .replace('1 caught', '1 exposed')));
      expect(w.get('h1').text()).toBe('The old reckoning');
      expect(w.get('.summary').text()).toBe('The account is unsettled.');
      expect(w.get('.closing').text()).toBe('An original closing.');
      expect(epilogue).toEqual(originalSnapshot);

      await w.setProps({ proseMode: 'original' });
      expect(labels()).toContain('And could show');
      expect(values()).toEqual(originalValues);
    } finally {
      w.unmount();
    }
  });
});
