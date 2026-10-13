// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LandView, SessionView, TableView } from '@ed/core';
import Standing from './Standing.vue';
import Muster from './Muster.vue';
import GameTable from './Table.vue';
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
  it('explains the same resource quantities using direct labels and glossary copy (#1616)', async () => {
    const current = view();
    const snapshot = structuredClone(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: null, saveStatus: 'saved', proseMode: 'original' },
    });
    try {
      const labels = () => wrapper.findAll('.house-ledger dt').map((row) => row.text());
      const values = () => wrapper.findAll('.house-ledger dd').map((row) => row.text());
      const original = wrapper.text();
      const originalValues = values();
      expect(labels()).toEqual(['Treasury', 'Standing', 'Discontent', 'Ledger']);
      expect(wrapper.get('.house-key summary').text()).toBe('What these readings mean');
      expect(wrapper.get('.house-key').text()).toContain('crowns the house can spend.');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(labels()).toEqual(['Money available', 'Reputation', 'Unrest', 'Recovered clauses']);
      expect(wrapper.get('.house-key summary').text()).toBe('What these numbers mean');
      expect(wrapper.findAll('.house-key dt').map((row) => row.text())).toEqual(labels());
      const explanations = wrapper.findAll('.house-key dd').map((row) => row.text());
      expect(explanations).toEqual([
        'Money the family can spend, measured in crowns.',
        'How the wider world regards this family.',
        'How much unrest is building inside the family and on its land.',
        'How many parts of the old bargain the family has found.',
      ]);
      expect(values()).toEqual(originalValues);
      expect(wrapper.get('.save[role="status"]').text()).toBe('saved');
      expect(current).toEqual(snapshot);

      await wrapper.setProps({ proseMode: 'original' });
      expect(labels()).toEqual(['Treasury', 'Standing', 'Discontent', 'Ledger']);
      expect(wrapper.get('.house-key summary').text()).toBe('What these readings mean');
      expect(wrapper.text()).toBe(original);
      expect(current).toEqual(snapshot);
    } finally {
      wrapper.unmount();
    }
  });


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


/** The Muster's view remains the same when the reader switches UI language.
 * Reuse this measured jsdom component suite instead of adding an unmeasured file. */
describe('war Muster reader-local Plain English (#1447)', () => {
  function activeWar(tide = 64): SessionView {
    return {
      ...view(),
      muster: {
        began: 1126, men: 3, maxMen: 12, tide, credit: 4.5,
        officers: [{ name: 'Maren', id: 'maren' }],
        positionName: undefined,
        positions: [
          { id: 'held', name: 'Hold the pass', current: false, canBuy: true, price: 70 },
          { id: 'none', name: 'No declared banner', current: true, canBuy: false },
        ],
      },
    } as unknown as SessionView;
  }

  it('toggles Original → Plain English → Original while preserving war data, disabled states and orders', async () => {
    const data = activeWar();
    const before = structuredClone(data);
    const muster = vi.fn();
    const wrapper = mount(Muster, {
      props: { view: data, refusal: null, actions: { muster } as unknown as GameActions },
    });
    try {
      const original = wrapper.text();
      const disabled = wrapper.findAll('button').map((button) => button.attributes('disabled') !== undefined);
      expect(original).toContain('The muster');
      expect(original).toContain('No banner bought. Word gets around; it is not in writing.');
      expect(original).toContain("The tide runs in the house's favour.");
      expect(original).toContain('Led by Maren.');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('Troops and war commitments');
      expect(wrapper.text()).toContain('War progress is favouring the house.');
      expect(wrapper.text()).toContain('Commanding officers: Maren.');
      expect(wrapper.text()).toContain('No formal war position has been purchased.');
      expect(wrapper.text()).toContain('Purchase a war position');
      expect(wrapper.findAll('button').map((button) => button.attributes('disabled') !== undefined)).toEqual(disabled);

      await wrapper.get('input').setValue('2');
      await wrapper.findAll('button').find((button) => button.text() === 'Send these troops')!.trigger('click');
      expect(muster).toHaveBeenLastCalledWith({ op: 'reinforce', men: 2 });
      await wrapper.findAll('button').find((button) => button.text().includes('Hold the pass'))!.trigger('click');
      expect(muster).toHaveBeenLastCalledWith({ op: 'buy', position: 'held' });
      await wrapper.findAll('button').find((button) => button.text() === 'Withdraw the troops')!.trigger('click');
      expect(muster).toHaveBeenLastCalledWith({ op: 'withdraw' });

      await wrapper.get('input').setValue('0');
      expect(wrapper.text()).toContain('Enter a whole number of troops greater than zero.');
      expect(wrapper.findAll('button').find((button) => button.text() === 'Send these troops')!.attributes('disabled')).toBeDefined();
      expect(muster).toHaveBeenCalledTimes(3);

      await wrapper.get('input').setValue('1');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(wrapper.findAll('button').map((button) => button.attributes('disabled') !== undefined)).toEqual(disabled);
      expect(data).toEqual(before);
    } finally {
      wrapper.unmount();
    }
  });

  it('shows other war tide values directly while retaining the same thresholds', async () => {
    for (const [tide, original, direct] of [
      [40, 'against the house', 'against the house'],
      [50, 'holding, for now', 'even for now'],
      [60, "in the house's favour", 'favouring the house'],
    ] as const) {
      const wrapper = mount(Muster, {
        props: {
          view: activeWar(tide), refusal: null,
          actions: { muster: vi.fn() } as unknown as GameActions,
        },
      });
      try {
        expect(wrapper.text()).toContain('The tide runs ' + original);
        await wrapper.setProps({ proseMode: 'plainenglish' });
        expect(wrapper.text()).toContain('War progress is ' + direct);
      } finally {
        wrapper.unmount();
      }
    }
  });

  it('dispatches reinforcement only once per rendered view, then allows a later retry (#1547)', async () => {
    const muster = vi.fn().mockReturnValue({ ok: false, reason: 'Not enough men' });
    const wrapper = mount(Muster, {
      props: { view: activeWar(), refusal: null, actions: { muster } as unknown as GameActions },
    });
    try {
      await wrapper.get('input').setValue('2');
      const send = wrapper.findAll('button').find((button) => button.text() === 'Send more men')!;
      // Both clicks land before Vue has drawn the result of the first order.
      await Promise.all([send.trigger('click'), send.trigger('click')]);
      expect(muster).toHaveBeenCalledTimes(1);
      expect(muster).toHaveBeenLastCalledWith({ op: 'reinforce', men: 2 });

      // An unsuccessful action must not keep the controls locked after render.
      await send.trigger('click');
      expect(muster).toHaveBeenCalledTimes(2);
    } finally { wrapper.unmount(); }
  });

  it('does not dispatch a competing war order on the same stale view (#1547)', async () => {
    const muster = vi.fn();
    const wrapper = mount(Muster, {
      props: { view: activeWar(), refusal: null, actions: { muster } as unknown as GameActions },
    });
    try {
      const buy = wrapper.findAll('button').find((button) => button.text().includes('Hold the pass'))!;
      const withdraw = wrapper.findAll('button').find((button) => button.text() === 'Call them home')!;
      await Promise.all([buy.trigger('click'), withdraw.trigger('click')]);
      expect(muster).toHaveBeenCalledTimes(1);
      expect(muster).toHaveBeenCalledWith({ op: 'buy', position: 'held' });

      await withdraw.trigger('click');
      expect(muster).toHaveBeenCalledTimes(2);
      expect(muster).toHaveBeenLastCalledWith({ op: 'withdraw' });
    } finally { wrapper.unmount(); }
  });

  it('wires the active reading preference into the App Muster panel', () => {
    const app = readFileSync(join(process.cwd(), 'packages/client/src/App.vue'), 'utf8');
    expect(app).toContain('<Muster v-if="view.muster" :view="view" :prose-mode="accessibility.proseMode"');
  });
});

describe('Table wardship buy-back single-flight (#1559)', () => {
  function wardshipTable(boughtBack = false): TableView {
    return {
      treasury: 100,
      bidCeiling: 0,
      tutorFee: 10,
      wardship: { wardName: 'Edren', since: 1109, boughtBack, buyBackCost: 20 },
      auction: null,
      delegation: [],
      vesselRite: { ready: false, reason: 'Not ready' },
      greatRite: { ready: false, reason: 'Not ready' },
      unmaking: { ready: false, reason: 'Not ready' },
      ledgerSearch: { ready: false, reason: 'Not ready' },
      shelf: [],
      studying: [],
      missingPrimers: [],
      pupils: [],
      teachable: [],
      canTutor: false,
      tutoring: [],
      posts: [],
      marriagePolicy: 'in',
      programmeCandidates: [],
      scion: null,
      scionHeir: null,
      scionVacant: false,
      scionHeirVacant: false,
      market: [],
      papers: [],
      pedigreePrices: [],
      servants: [],
      maxBond: 20,
    } as unknown as TableView;
  }

  const emptyLand = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;

  it('dispatches only one buy-back order before the successful purchase is repainted', async () => {
    const order = vi.fn().mockReturnValue({ ok: true, spent: 20, left: 80 });
    const wrapper = mount(GameTable, {
      props: {
        table: wardshipTable(), land: emptyLand,
        actions: { order } as unknown as GameActions,
        refusal: null, receipt: null,
      },
    });
    try {
      const buy = wrapper.get('.wardship button').element as HTMLButtonElement;
      buy.click();
      buy.click(); // The old DOM is still clickable despite the synchronous purchase.
      expect(order).toHaveBeenCalledTimes(1);
      expect(order).toHaveBeenCalledWith({ kind: 'buyBackWardship' });

      // The host refresh removes the buy-back button once the state is changed.
      await wrapper.setProps({ table: wardshipTable(true) });
      expect(wrapper.find('.wardship button').exists()).toBe(false);
      expect(order).toHaveBeenCalledTimes(1);
    } finally { wrapper.unmount(); }
  });

  it('unlocks a refused buy-back on the next render for a deliberate retry', async () => {
    const order = vi.fn().mockReturnValue({ ok: false, reason: 'Host refused' });
    const wrapper = mount(GameTable, {
      props: {
        table: wardshipTable(), land: emptyLand,
        actions: { order } as unknown as GameActions,
        refusal: null, receipt: null,
      },
    });
    try {
      const buy = wrapper.get('.wardship button').element as HTMLButtonElement;
      buy.click();
      buy.click();
      expect(order).toHaveBeenCalledTimes(1);
      await wrapper.vm.$nextTick();
      buy.click();
      expect(order).toHaveBeenCalledTimes(2);
      expect(order).toHaveBeenLastCalledWith({ kind: 'buyBackWardship' });
    } finally { wrapper.unmount(); }
  });

  it('rejects invalid bond marks without consuming the per-servant latch (#1571)', async () => {
    const table = { ...wardshipTable(), servants: [
      { person: 'ren', name: 'Ren', role: 'keeper', wage: 5, bonded: false, loyalty: 'steady' },
    ] } as unknown as TableView;
    const order = vi.fn().mockReturnValue({ ok: true });
    const wrapper = mount(GameTable, {
      props: { table, land: emptyLand, actions: { order } as unknown as GameActions, refusal: null, receipt: null },
    });
    try {
      const marks = wrapper.get('input[aria-label^="Marks to advance"]');
      const advance = wrapper.findAll('button').find((button) => button.text() === 'Advance it against the years')!;
      for (const invalid of ['0', '1.5', '21']) {
        await marks.setValue(invalid);
        expect(marks.attributes('aria-invalid')).toBe('true');
        expect(advance.attributes('disabled')).toBeDefined();
        (advance.element as HTMLButtonElement).click();
        expect(order).not.toHaveBeenCalled();
      }
      await marks.setValue('5');
      expect(advance.attributes('disabled')).toBeUndefined();
      const button = advance.element as HTMLButtonElement;
      button.click();
      button.click();
      expect(order).toHaveBeenCalledOnce();
      expect(order).toHaveBeenCalledWith({ kind: 'bond', person: 'ren', op: 'bind', marks: 5 });
    } finally { wrapper.unmount(); }
  });

  it('submits one bond per servant in a render without blocking another servant (#1571)', async () => {
    const table = { ...wardshipTable(), servants: [
      { person: 'ren', name: 'Ren', role: 'keeper', wage: 5, bonded: false, loyalty: 'steady' },
      { person: 'hal', name: 'Hal', role: 'scribe', wage: 6, bonded: false, loyalty: 'doubtful' },
    ] } as unknown as TableView;
    const order = vi.fn().mockReturnValue({ ok: true });
    const wrapper = mount(GameTable, {
      props: { table, land: emptyLand, actions: { order } as unknown as GameActions, refusal: null, receipt: null },
    });
    try {
      const marks = wrapper.findAll('input[aria-label^="Marks to advance"]');
      expect(marks).toHaveLength(2);
      await marks[0]!.setValue('5');
      await marks[1]!.setValue('6');
      const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Advance it against the years');
      expect(buttons).toHaveLength(2);
      const ren = buttons[0]!.element as HTMLButtonElement;
      const hal = buttons[1]!.element as HTMLButtonElement;
      ren.click();
      ren.click(); // Old button is still clickable until Vue repaints.
      hal.click(); // Another servant remains independent.
      expect(order).toHaveBeenCalledTimes(2);
      expect(order).toHaveBeenNthCalledWith(1, { kind: 'bond', person: 'ren', op: 'bind', marks: 5 });
      expect(order).toHaveBeenNthCalledWith(2, { kind: 'bond', person: 'hal', op: 'bind', marks: 6 });
      await wrapper.vm.$nextTick();
      ren.click();
      expect(order).toHaveBeenCalledTimes(3);
      expect(order).toHaveBeenLastCalledWith({ kind: 'bond', person: 'ren', op: 'bind', marks: 5 });
    } finally { wrapper.unmount(); }
  });

  it('ignores a duplicate release before repaint and permits a later retry (#1571)', async () => {
    const table = { ...wardshipTable(), servants: [
      { person: 'ren', name: 'Ren', role: 'keeper', wage: 0, bonded: true, debt: 8, loyalty: 'wary' },
    ] } as unknown as TableView;
    const order = vi.fn().mockReturnValue({ ok: false, reason: 'not released' });
    const wrapper = mount(GameTable, {
      props: { table, land: emptyLand, actions: { order } as unknown as GameActions, refusal: null, receipt: null },
    });
    try {
      const release = wrapper.findAll('button').find((button) => button.text() === 'Tear it up')!.element as HTMLButtonElement;
      release.click();
      release.click();
      expect(order).toHaveBeenCalledOnce();
      expect(order).toHaveBeenCalledWith({ kind: 'bond', person: 'ren', op: 'free' });
      await wrapper.vm.$nextTick();
      release.click();
      expect(order).toHaveBeenCalledTimes(2);
    } finally { wrapper.unmount(); }
  });

});
