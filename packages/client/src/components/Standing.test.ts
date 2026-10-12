// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionView } from '@ed/core';
import Standing from './Standing.vue';
import Abroad from './Abroad.vue';
import Naming from './Naming.vue';
import Member from './Member.vue';
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

describe('Standing reader-local Plain English (#1439)', () => {
  it('switches current explanations while retaining Original and the supplied world data', async () => {
    const current = view();
    current.assize = { ...current.assize, favour: true, mercy: true, exaction: true,
      measuredAgainst: { name: 'Maren', before: 1091 } };
    current.guardian = { id: 'founder', name: 'Daveed', since: 1063 };
    const before = JSON.stringify(current);
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle' } });
    try {
      const original = wrapper.text();
      expect(original).toContain('The world has noticed you.');
      expect(original).toContain('a favour is owed · a mercy is running · an exaction is being collected');
      expect(original).toContain('Measured against the Maren who came before.');
      expect(original).toContain('Daveed watches, and has since 1063.');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('The wider world is putting pressure on the house.');
      expect(wrapper.text()).toContain('a favour is owed to the house · temporary help is in effect · extra costs are being collected');
      expect(wrapper.get('.namesake').text()).toBe('Compared with the earlier Maren.');
      expect(wrapper.get('.assize-explainer').text()).toBe('The Assize is the wider world helping a struggling house or putting pressure on one that is far ahead.');
      expect(wrapper.get('.gauge-reading').text()).toBe('World pressure: against the house (0.40 of 1).');
      expect(wrapper.text()).toContain('Highest reached · Hierophant, reached in 1114.');
      expect(wrapper.text()).toContain('Daveed has watched over the house since 1063.');
      expect(wrapper.get('.house-ledger').text()).toContain('252 crowns');
      expect(wrapper.get('.ladder-measure').text()).toContain('power 42 of 100 · 3 books');
      expect(JSON.stringify(current)).toBe(before);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
    } finally { wrapper.unmount(); }
  });

  it.each([
    ['resents', 0.4, 'The world has noticed you.', 'The wider world is putting pressure on the house.', 'against the house'],
    ['steadies', -0.4, 'The world is being gentle with you.', 'The wider world is helping the house recover.', 'in its favour'],
    ['indifferent', 0, 'The world is not thinking about you.', 'The wider world is leaving the house alone.', 'neither way'],
  ] as const)('retains the meaning of the %s world arm', async (arm, pressure, original, plain, lean) => {
    const current = view();
    current.assize = { ...current.assize, arm, pressure };
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle' } });
    try {
      expect(wrapper.text()).toContain(original);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain(plain);
      expect(wrapper.get('.gauge-reading').text()).toBe(`World pressure: ${lean} (${pressure.toFixed(2)} of 1).`);
    } finally { wrapper.unmount(); }
  });

  it.each([
    [40, 'against the house', 'against the house'],
    [41, 'holding, for now', 'evenly balanced for now'],
    [59, 'holding, for now', 'evenly balanced for now'],
    [60, "in the house's favour", "in the house's favour"],
  ])('preserves the war reading at tide %i', async (tide, original, plain) => {
    const current = view();
    current.muster = { began: 1126, men: 1, maxMen: 10, officers: [], credit: 0, tide: Number(tide), positions: [] };
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle' } });
    try {
      expect(wrapper.text()).toContain(`1 man in the field, and the tide runs ${original}.`);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain(`1 man is fighting. The war is ${plain}.`);
      await wrapper.setProps({ view: { ...current, muster: { ...current.muster!, men: 3 } } });
      expect(wrapper.text()).toContain(`3 men are fighting. The war is ${plain}.`);
    } finally { wrapper.unmount(); }
  });

  it('preserves progressive reveal and omits unknown dates without changing the view', async () => {
    const current = view();
    current.guardian = { id: 'founder', name: 'Daveed' };
    delete current.ascension.bestAt;
    const wrapper = mount(Standing, { props: {
      view: current, jump: null, saveStatus: 'idle', proseMode: 'plainenglish', showAssize: false, showLadder: false,
    } });
    try {
      expect(wrapper.find('.assize-explainer').exists()).toBe(false);
      expect(wrapper.find('.gauge').exists()).toBe(false);
      expect(wrapper.find('.rung').exists()).toBe(false);
      expect(wrapper.text()).toContain('Daveed watches over the house.');
      expect(wrapper.text()).not.toContain('undefined');
      await wrapper.setProps({ showLadder: true });
      expect(wrapper.text()).toContain('Highest reached · Hierophant, reached earlier.');
      await wrapper.setProps({ view: { ...current, ascension: { ...current.ascension, best: current.ascension.rung } } });
      expect(wrapper.text()).not.toContain('Highest reached');
    } finally { wrapper.unmount(); }
  });

  it('wires the current reader preference into the game header', () => {
    const app = readFileSync(join(process.cwd(), 'packages/client/src/App.vue'), 'utf8');
    const mount = app.match(/<Standing\b[\s\S]*?\/>/)?.[0];
    expect(mount).toContain(':prose-mode="accessibility.proseMode"');
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
  it('keeps a refused first ambition visible across a fresh world snapshot (#1519)', async () => {
    const setAmbition = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(null), actions: { setAmbition } as unknown as GameActions },
    });
    try {
      // Without an ambition, this is the initial selector, not the Change editor.
      expect(wrapper.find('.ambition-head button').exists()).toBe(false);
      await wrapper.get('select').setValue('land');
      await wrapper.get('.ambition-actions button').trigger('click');
      expect(setAmbition).toHaveBeenCalledWith('land');

      // GameStore.setAmbition refreshes the world even when the order fails.
      // An idle selector used to reset both this draft and its refusal here.
      await wrapper.setProps({ view: ambitionView(null) });
      expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('land');
      expect(wrapper.get('[role="alert"]').text()).toContain('could not keep that ambition');

      await wrapper.get('.ambition-actions button').trigger('click');
      expect(setAmbition.mock.calls).toEqual([['land'], ['land']]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      await wrapper.setProps({ view: ambitionView('land') });
      expect(wrapper.text()).toContain('Keep the estate');
      expect(wrapper.find('select').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('preserves a refused choice and allows a successful retry', async () => {
    const setAmbition = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(Ambition, {
      props: { view: ambitionView(), actions: { setAmbition } as unknown as GameActions },
    });

    await wrapper.get('.ambition-head button').trigger('click');
    await wrapper.get('select').setValue('land');
    await wrapper.get('.ambition-actions button').trigger('click');

    expect(setAmbition).toHaveBeenCalledWith('land');
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('land');
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

/**
 * The family tree's closed card must not attribute an outsider's house to
 * the blood-family member who married them (#1147). Kept in the existing
 * measured client legibility suite so the shard duration ledger stays valid.
 */
describe('married-in spouse provenance on family cards (#1147)', () => {
  function member(marriedIn: boolean): SessionView['halls'][number]['members'][number] {
    return {
      id: 'dara', name: 'Dara', sex: 'female', age: 30, status: 'alive',
      head: false, awakened: false, expresses: false, madness: 0, drift: false,
      parents: {}, attrs: {},
      record: { parents: {}, attrs: {}, claimed: [], claimedTraits: [] },
      spouse: { id: 'ren', name: 'Ren', marriedIn, house: 'House Marrow' },
    } as unknown as SessionView['halls'][number]['members'][number];
  }

  it('names the outside spouse and their originating house on a closed card', () => {
    const wrapper = mount(Member, {
      props: { member: member(true), names: [], traitNames: [], open: false },
    });
    expect(wrapper.get('.face').text()).toContain('Dara');
    expect(wrapper.get('.from').text()).toBe('married to Ren, of House Marrow');
    wrapper.unmount();
  });

  it('does not claim an outside-house origin for a spouse from our house', () => {
    const wrapper = mount(Member, {
      props: { member: member(false), names: [], traitNames: [], open: false },
    });
    expect(wrapper.find('.from').exists()).toBe(false);
    wrapper.unmount();
  });
});

/** Keep small client-component regressions in this measured jsdom suite,
 * rather than introducing an unmeasured test shard file. */
function namingView(...people: string[]): SessionView {
  return {
    namesWanted: people.map((person, index) => ({
      person,
      born: 1080,
      sex: index % 2 === 0 ? 'male' : 'female',
      suggested: `Suggested ${index}`,
      because: 'The chronicler has a reason.',
    })),
  } as unknown as SessionView;
}

function namingActions(): GameActions {
  return {
    name: vi.fn(() => true),
    keepSuggestedName: vi.fn(() => true),
    keepSuggestedNames: vi.fn(),
  } as unknown as GameActions;
}

describe('naming draft lifetime (#1319)', () => {
  it('discards drafts after Keep all empties the queue, even if a person id appears again', async () => {
    const game = namingActions();
    const wrapper = mount(Naming, { props: { view: namingView('child-1', 'child-2'), actions: game } });
    try {
      await wrapper.get('.child input').setValue('A name still being considered');

      const keepAll = wrapper.findAll('button')
        .find((button) => button.text() === 'Keep the names he suggests');
      expect(keepAll).toBeTruthy();
      await keepAll!.trigger('click');
      expect(game.keepSuggestedNames).toHaveBeenCalledOnce();

      // The parent publishes the resolved queue after the action.
      await wrapper.setProps({ view: namingView() });
      expect(wrapper.find('.child input').exists()).toBe(false);

      // New sessions may recycle person ids; an old, unsubmitted name must not return.
      await wrapper.setProps({ view: namingView('child-1') });
      expect((wrapper.get('.child input').element as HTMLInputElement).value).toBe('');
    } finally {
      wrapper.unmount();
    }
  });

  it('preserves typed drafts for still-waiting children while removing departed drafts', async () => {
    const wrapper = mount(Naming, { props: { view: namingView('child-1', 'child-2'), actions: namingActions() } });
    try {
      await wrapper.findAll('.child input')[0]!.setValue('First draft');
      await wrapper.findAll('.child input')[1]!.setValue('Second draft');

      await wrapper.setProps({ view: namingView('child-2') });
      expect((wrapper.get('.child input').element as HTMLInputElement).value).toBe('Second draft');

      await wrapper.setProps({ view: namingView('child-1', 'child-2') });
      const inputs = wrapper.findAll('.child input');
      expect((inputs[0]!.element as HTMLInputElement).value).toBe('');
      expect((inputs[1]!.element as HTMLInputElement).value).toBe('Second draft');
    } finally {
      wrapper.unmount();
    }
  });
});

/** A retelling count is reader-facing, not a new interpretation of a tale.
 * Keep these mounted assertions in the existing measured client test suite. */
describe('counter-record prose selection and retelling grammar (#1430)', () => {
  it('formats one and many retellings in both modes and leaves tale evidence untouched', async () => {
    const tales = [
      { id: 'letter', about: 'north_road', form: 'letter',
        text: 'The northern road was closed.', teller: 'Alys',
        since: 1100, mutations: 1, bias: 'A household account' },
      { id: 'song', about: 'south_road', form: 'song',
        text: 'The southern road was open.', teller: 'Ronan',
        since: 1110, mutations: 3, bias: "A traveler's account" },
    ] as unknown as SessionView['tales'];
    const wrapper = mount(Abroad, { props: {
      view: { ...view(), tales }, proseMode: 'original',
    } });
    try {
      expect(wrapper.text()).toContain('letter · told by Alys · since 1100');
      expect(wrapper.text()).toContain('retold 1 time, and it has moved');
      expect(wrapper.text()).toContain('retold 3 times, and it has moved');
      expect(wrapper.text()).not.toContain('retold 1 times');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('Type: letter · Told by: Alys · First shared in 1100');
      expect(wrapper.text()).toContain('Type: song · Told by: Ronan · First shared in 1110');
      expect(wrapper.text()).toContain('retold 1 time; the story has changed');
      expect(wrapper.text()).toContain('retold 3 times; the story has changed');
      expect(wrapper.text()).not.toContain('retold 1 times');

      // The mode must not translate, reorder or adjudicate the actual accounts.
      expect(wrapper.text()).toContain('The northern road was closed.');
      expect(wrapper.text()).toContain('The southern road was open.');
      expect(wrapper.text()).toContain('A household account');
      expect(wrapper.text()).toContain("A traveler's account");
      expect(wrapper.findAll('.account')).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });
});
