import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import Standing from './Standing.vue';

function view(): SessionView {
  return {
    year: 1127,
    campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
    generation: 4,
    house: 'house_gearithy',
    houseName: 'House Ash',
    ambitionOptions: [],
    attributes: [],
    traits: [],
    seed: 47,
    treasury: 252,
    respect: 'regarded',
    discontent: 7,
    clausesRecovered: 3,
    clausesTotal: 9,
    ages: [],
    agePressures: [],
    ageMatchPriorities: [],
    ageRecordPriorities: [],
    halls: [],
    chronicle: [],
    frame: [],
    docket: [],
    namesWanted: [],
    looseSecrets: [],
    tales: [],
    marriagePromises: [],
    ascension: {
      rung: 'adept',
      best: 'hierophant',
      title: 'Adept',
      bestTitle: 'Hierophant',
      bestAt: 1114,
      foremost: { person: 'p1', name: 'Maren', power: 42, spells: 3 },
    },
    cast: [],
    assize: {
      pressure: 0.4,
      arm: 'resents',
      favour: false,
      mercy: false,
      exaction: false,
    },
  } as unknown as SessionView;
}

describe('Standing legibility (#356)', () => {
  it('gives each household reading its own labelled row', () => {
    const wrapper = mount(Standing, {
      props: { view: view(), jump: null, saveStatus: 'idle' },
    });

    const rows = wrapper.findAll('.house-ledger > div');
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.find('dt').text())).toEqual([
      'Treasury',
      'Standing',
      'Discontent',
      'Ledger',
    ]);
    expect(rows.map((row) => row.find('dd').text())).toEqual([
      '252 crowns',
      'regarded',
      '7',
      '3/9 clauses recovered',
    ]);
  });

  it('provides visible, non-hover explanations for the readings and the Assize', () => {
    const wrapper = mount(Standing, {
      props: { view: view(), jump: null, saveStatus: 'idle' },
    });

    const key = wrapper.get('.house-key');
    expect(key.get('summary').text()).toBe('What these readings mean');
    expect(key.text()).toContain('crowns the house can spend');
    expect(key.text()).toContain('the regard the wider world gives the house');
    expect(key.text()).toContain('how much strain is building');
    expect(key.text()).toContain('how much of the old bargain the family has recovered');

    expect(wrapper.get('.assize-explainer').text()).toContain(
      'The Assize is how the wider world answers a house',
    );
  });

  it('names the ladder high-water mark instead of leaving “highest” implicit', () => {
    const wrapper = mount(Standing, {
      props: { view: view(), jump: null, saveStatus: 'idle' },
    });

    expect(wrapper.text()).toContain('Highest reached · Hierophant, once, in 1114.');
  });
});
