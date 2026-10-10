// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import Standing from './Standing.vue';
import Ambition from './Ambition.vue';
import type { GameActions } from '../lib/game';

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

  it('keeps the run seed out of sight until the player asks for it', async () => {
    const wrapper = mount(Standing, {
      props: { view: view(), jump: null, saveStatus: 'idle' },
    });
    const control = wrapper.get('.run-number button');

    expect(wrapper.text().toLowerCase()).not.toContain('seed');
    expect(wrapper.text()).not.toContain('47');
    expect(control.attributes('aria-expanded')).toBe('false');

    await control.trigger('click');

    expect(wrapper.text()).toContain('seed #47');
    expect(control.attributes('aria-expanded')).toBe('true');
  });

  it('can hide the diagnostic run number again', async () => {
    const wrapper = mount(Standing, {
      props: { view: view(), jump: null, saveStatus: 'idle' },
    });
    const control = wrapper.get('.run-number button');

    await control.trigger('click');
    await control.trigger('click');

    expect(wrapper.text()).not.toContain('seed #47');
    expect(control.attributes('aria-expanded')).toBe('false');
  });
});

function ambitionView(id: string | null = 'blood'): SessionView {
  return {
    ...view(),
    ambition: id ? {
      id, name: id === 'blood' ? 'Keep the bloodline' : 'Keep the estate',
      purpose: 'Keep a plan in sight.',
      progress: { label: 'The house has begun.' },
      status: 'Ongoing',
      next: 'Continue the work.',
    } : null,
    ambitionOptions: [
      { id: 'blood', name: 'Keep the bloodline', purpose: 'Remember the children.' },
      { id: 'land', name: 'Keep the estate', purpose: 'Hold what the family owns.' },
    ],
  } as unknown as SessionView;
}

describe('House ambition refusal and selection (#1069)', () => {
  it('preserves a refused choice and allows a successful retry', async () => {
    const setAmbition = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(), actions: { setAmbition } as unknown as GameActions },
    });

    await wrapper.get('.ambition-head button').trigger('click');
    await wrapper.get('select').setValue('land');
    await wrapper.get('.ambition-actions button').trigger('click');

    expect(setAmbition).toHaveBeenCalledWith('land');
    expect(wrapper.get('select').element.value).toBe('land');
    expect(wrapper.get('[role="alert"]').text()).toContain('could not keep');
    expect(wrapper.find('select').exists()).toBe(true);

    await wrapper.get('.ambition-actions button').trigger('click');
    expect(setAmbition).toHaveBeenCalledTimes(2);
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not dismiss the edit when clearing an ambition is refused', async () => {
    const setAmbition = vi.fn().mockReturnValue(false);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(), actions: { setAmbition } as unknown as GameActions },
    });

    await wrapper.get('.ambition-head button').trigger('click');
    await wrapper.findAll('.ambition-actions button')[1]!.trigger('click');

    expect(setAmbition).toHaveBeenCalledWith(null);
    expect(wrapper.find('select').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not clear');

    await wrapper.findAll('.ambition-actions button')[2]!.trigger('click');
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('opens Change on the ambition from the latest view', async () => {
    const setAmbition = vi.fn().mockReturnValue(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView('blood'), actions: { setAmbition } as unknown as GameActions },
    });

    await wrapper.setProps({ view: ambitionView('land') });
    await wrapper.get('.ambition-head button').trigger('click');

    expect(wrapper.get('select').element.value).toBe('land');
    await wrapper.get('.ambition-actions button').trigger('click');
    expect(setAmbition).toHaveBeenCalledWith('land');
  });

  it('refuses to submit a draft that disappeared from the current options', async () => {
    const setAmbition = vi.fn().mockReturnValue(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(), actions: { setAmbition } as unknown as GameActions },
    });

    await wrapper.get('.ambition-head button').trigger('click');
    await wrapper.get('select').setValue('land');
    const changed = {
      ...ambitionView(),
      ambitionOptions: [{ id: 'blood', name: 'Keep the bloodline', purpose: 'Remember the children.' }],
    } as unknown as SessionView;
    await wrapper.setProps({ view: changed });

    expect(wrapper.get('[role="alert"]').text()).toContain('no longer available');
    expect(wrapper.get('.ambition-actions button').attributes('disabled')).toBeDefined();
    expect(setAmbition).not.toHaveBeenCalled();
  });
});
