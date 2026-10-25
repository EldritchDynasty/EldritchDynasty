// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LandView, SessionView, StandingDelta, TableView } from '@ed/core';
import { newGame, phenotypeOf } from '@ed/core';
import { loadContent } from '@ed/content';
import Standing from './Standing.vue';
import Muster from './Muster.vue';
import GameTable from './Table.vue';
import Abroad from './Abroad.vue';
import Naming from './Naming.vue';
import Member from './Member.vue';
import Cast from './Cast.vue';
import { LEGEND, MARKS, markSays } from '../lib/marks';
import Ambition from './Ambition.vue';
import type { GameActions } from '../lib/game';
import { RUNG_ORDER, RespectTierS, TaleFormS, type RespectTier, type TaleForm } from '@ed/schema';

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
      rungs: RUNG_ORDER.map((id) => ({
        id,
        title: id.charAt(0).toUpperCase() + id.slice(1),
        ...(id === 'hierophant' ? { reachedAt: 1114 } : {}),
      })),
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

describe('the house learns expression through Awakening (#1820)', () => {
  it.each(['original', 'plainenglish'] as const)('shows the neutral ladder and no Member mark before waking (%s)', async (mode) => {
    const game = newGame(loadContent(), { seed: 1820, proseMode: mode });
    const candidate = game.ctx.world.people.household(game.ctx.world.playerHouse, game.year)
      .find((p) => phenotypeOf(p, game.ctx.genetics, game.year).eldritch.canExpress)!;
    expect(candidate).toBeDefined();
    const before = game.view();
    const member = before.halls.flatMap((hall) => hall.members).find((m) => m.id === candidate.id)!;
    expect(member).not.toHaveProperty('expresses');
    const standing = mount(Standing, { props: { view: before, jump: null, saveStatus: 'idle', proseMode: mode } });
    const cast = mount(Cast, { props: { cast: before.cast, selected: null, proseMode: mode } });
    const card = mount(Member, { props: { member, names: before.attributes, traitNames: before.traits, open: false, proseMode: mode } });
    try {
      expect(standing.get('.ladder-blocker').text()).toContain(mode === 'original'
        ? 'No living man is known to express the blood.' : "No living man is known to express the blood's power.");
      expect(standing.find('.ladder-measure').exists()).toBe(false);
      expect(card.find('.marks .expresses').exists()).toBe(false);
      expect(cast.text()).not.toContain('has the blood and has not woken');
      expect(cast.text()).not.toContain('cannot express a word');
      candidate.awakening.awakened = true;
      candidate.phenotype = undefined;
      const after = game.view();
      await standing.setProps({ view: after });
      await card.setProps({ member: after.halls.flatMap((hall) => hall.members).find((m) => m.id === candidate.id)! });
      expect(standing.get('.ladder-measure').text()).toMatch(/(?:power|Power) \d+/);
      expect(card.find('.marks .expresses').exists()).toBe(true);
    } finally { standing.unmount(); cast.unmount(); card.unmount(); }
  });
});

describe('Standing legibility (#356)', () => {
  it.each(['original', 'plainenglish'] as const)('links witnessed family and contrasting Match evidence with native controls (%s)', async (mode) => {
    const current = view();
    current.ascension.diagnosis = {
      target: 'hierophant', targetTitle: 'Hierophant', blockers: [{ kind: 'power', text: 'The power is short.', hint: 'Read the family.' }],
      route: {
        title: mode === 'original' ? 'The blood, in witnessed lives' : 'Evidence about inherited power',
        rule: 'A son inherits through his mother.', caution: 'No child is promised.',
        daughters: [{ person: 'mara', name: 'Mara', evidence: ['Her father woke in 1100.'] }],
        cards: [{ decision: 'match', card: 'anwen', name: 'Anwen', label: 'Blood', evidence: ['Her brother woke.'] }],
        alternatives: [{ decision: 'match', card: 'cesse', name: 'Cesse', label: 'Continuity', evidence: ['Five children grew up in that line.'] }],
      },
    };
    const wrapper = mount(Standing, { attachTo: document.body, props: { view: current, jump: null, saveStatus: 'idle', proseMode: mode } });
    try {
      const route = wrapper.get('.power-route');
      expect(route.element.tagName).toBe('DETAILS');
      expect(route.get('summary').text()).toBe(current.ascension.diagnosis.route!.title);
      const buttons = route.findAll('button');
      expect(buttons.map((button) => button.text())).toEqual(['Mara', 'Anwen · Blood', 'Cesse · Continuity']);
      for (const button of buttons) {
        (button.element as HTMLButtonElement).focus();
        expect(document.activeElement).toBe(button.element);
        await button.trigger('click');
      }
      expect(wrapper.emitted('look')).toEqual([['mara']]);
      expect(wrapper.emitted('match')).toEqual([['match', 'anwen'], ['match', 'cesse']]);
      current.ascension.diagnosis.route!.cards = [];
      current.ascension.diagnosis.route!.none = 'No current Match shows that evidence.';
      await wrapper.setProps({ view: { ...current } });
      expect(wrapper.text()).toContain('No current Match shows that evidence.');
    } finally { wrapper.unmount(); }
  });

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

describe('save status in reader-local Plain English (#1651)', () => {
  it('announces saving, saved and failure correctly without changing the world or status', async () => {
    const current = view();
    const savedWorld = structuredClone(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: null, saveStatus: 'idle', proseMode: 'original' },
    });
    try {
      const status = () => wrapper.get('.save[role="status"]');
      expect(status().text()).toBe('');
      await wrapper.setProps({ saveStatus: 'saving' });
      expect(status().text()).toBe('saving…');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(status().text()).toBe('Saving this game…');
      await wrapper.setProps({ saveStatus: 'saved' });
      expect(status().text()).toBe('Game saved.');
      await wrapper.setProps({ saveStatus: 'error' });
      expect(status().text()).toBe('Game not saved. The latest changes could not be saved.');
      expect(status().classes()).toContain('warn');
      await wrapper.setProps({ proseMode: 'original' });
      expect(status().text()).toBe('not saved — could not save this run');
      await wrapper.setProps({ saveStatus: 'idle', proseMode: 'plainenglish' });
      expect(status().text()).toBe('');
      expect(current).toEqual(savedWorld);
      expect(wrapper.props('saveStatus')).toBe('idle');
    } finally {
      wrapper.unmount();
    }
  });
});

describe('Standing reader-local Plain English (#1439)', () => {
  it('explains every current and previous reputation rank without changing their values (#1720)', async () => {
    const labels: Record<RespectTier, string> = {
      unknown: 'Not known', known: 'Known', regarded: 'Well regarded',
      eminent: 'Highly respected', exalted: 'Held in the highest esteem',
    };
    for (const [index, tier] of RespectTierS.options.entries()) {
      const previous = RespectTierS.options[(index + 1) % RespectTierS.options.length]!;
      const current = { ...view(), respect: tier };
      const jump: StandingDelta = { treasury: 0, discontent: 0, clauses: 0,
        respect: { from: previous, to: tier } };
      const snapshot = structuredClone({ current, jump });
      const wrapper = mount(Standing, { props: { view: current, jump, saveStatus: 'idle' } });
      try {
        const rank = () => wrapper.findAll('.house-ledger dd')[1]!.text();
        const original = wrapper.text();
        expect(rank()).toBe(`${tier} (was ${previous})`);
        await wrapper.setProps({ proseMode: 'plainenglish' });
        expect(rank()).toBe(`${labels[tier]} (was ${labels[previous]})`);
        await wrapper.setProps({ proseMode: 'original' });
        expect(wrapper.text()).toBe(original);
        expect({ current, jump }).toEqual(snapshot);
        expect(wrapper.emitted()).toEqual({});
      } finally { wrapper.unmount(); }
    }
  });

  it.each([0, 1, 3])('identifies %i learned spells without claiming physical books (#1721)', async (spells) => {
    const current = view();
    current.ascension.foremost = { ...current.ascension.foremost!, spells, power: 42.4 };
    const snapshot = structuredClone(current);
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle' } });
    try {
      const original = `power 42 of 100 · ${spells} ${spells === 1 ? 'book' : 'books'}`;
      expect(wrapper.get('.ladder-measure').text()).toBe(original);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.ladder-measure').text()).toBe(
        `Power 42 out of 100 · ${spells} learned ${spells === 1 ? 'spell' : 'spells'}`,
      );
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.ladder-measure').text()).toBe(original);
      await wrapper.setProps({ proseMode: 'plainenglish', showLadder: false });
      expect(wrapper.find('.ladder-measure').exists()).toBe(false);
      await wrapper.setProps({ showLadder: true,
        view: { ...current, ascension: { ...current.ascension, foremost: undefined } } });
      expect(wrapper.find('.ladder-measure').exists()).toBe(false);
      expect(current).toEqual(snapshot);
    } finally { wrapper.unmount(); }
  });

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
      expect(labels()).toEqual(['Money balance', 'Reputation', 'Unrest', 'Recovered clauses']);
      expect(wrapper.get('.house-key summary').text()).toBe('What these numbers mean');
      expect(wrapper.findAll('.house-key dt').map((row) => row.text())).toEqual(labels());
      const explanations = wrapper.findAll('.house-key dd').map((row) => row.text());
      expect(explanations).toEqual([
        'The family’s money in crowns. A negative balance means the family owes money.',
        'How the wider world regards this family.',
        'How much unrest is building inside the family and on its land.',
        'How many parts of the old bargain the family has found.',
      ]);
      expect(values()).toEqual([originalValues[0], 'Well regarded', ...originalValues.slice(2)]);
      expect(wrapper.get('.save[role="status"]').text()).toBe('Game saved.');
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
      expect(wrapper.text()).toContain('Highest level reached · Hierophant, reached in 1114.');
      expect(wrapper.text()).toContain('Daveed has watched over the house since 1063.');
      expect(wrapper.get('.house-ledger').text()).toContain('252 crowns');
      expect(wrapper.get('.ladder-measure').text()).toContain('Power 42 out of 100 · 3 learned spells');
      expect(JSON.stringify(current)).toBe(before);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
    } finally { wrapper.unmount(); }
  });

  it('changes remaining ladder, Age and run controls without changing facts or visibility (#1622)', async () => {
    const current = view();
    current.ages = [{ age: 'long_peace', name: 'Long Peace', began: 1103, register: 'warm' }] as unknown as SessionView['ages'];
    const originalView = structuredClone(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: null, saveStatus: 'saved', proseMode: 'original' },
    });
    try {
      const originalClosed = wrapper.text();
      expect(originalClosed).toContain('generation 4');
      expect(wrapper.get('.age .name').text()).toBe('Long Peace · since 1103');
      expect(wrapper.get('.ladder-measure').text()).toBe('power 42 of 100 · 3 books');
      expect(wrapper.get('.rung').text()).toContain('Maren — nothing stands in the way.');
      expect(wrapper.get('.run-number button').text()).toBe('run number');
      expect(wrapper.find('.seed').exists()).toBe(false);

      await wrapper.get('.run-number button').trigger('click');
      expect(wrapper.get('.seed').text()).toBe('seed #47');
      expect(wrapper.get('.run-number button').attributes('aria-expanded')).toBe('true');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.year').text()).toContain('Generation 4');
      expect(wrapper.get('.age .name').text()).toBe('Long Peace · since 1103');
      expect(wrapper.get('.ladder-measure').text()).toBe('Power 42 out of 100 · 3 learned spells');
      expect(wrapper.get('.rung').text()).toContain('Maren — can advance to the next level.');
      expect(wrapper.get('.rung').text()).toContain('Highest level reached · Hierophant, reached in 1114.');
      expect(wrapper.get('.run-number button').text()).toBe('Hide run number');
      expect(wrapper.get('.seed').text()).toBe('Run seed #47');
      expect(wrapper.get('.run-number button').attributes('aria-expanded')).toBe('true');
      expect(current).toEqual(originalView);

      await wrapper.get('.run-number button').trigger('click');
      expect(wrapper.get('.run-number button').text()).toBe('Show run number');
      expect(wrapper.find('.seed').exists()).toBe(false);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(originalClosed);
      expect(current).toEqual(originalView);
    } finally { wrapper.unmount(); }
  });

  it('keeps diagnostic targets and change readings unchanged across prose modes (#1622)', async () => {
    const baseline = view();
    const current = {
      ...baseline,
      ascension: {
        ...baseline.ascension,
        diagnosis: { targetTitle: 'Seer', name: 'A difficult rite', blockers: [] },
      },
    } as unknown as SessionView;
    const movement = { arm: true } as unknown as StandingDelta;
    const originalView = structuredClone(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: movement, saveStatus: 'idle', proseMode: 'original' },
    });
    try {
      expect(wrapper.get('.next-rung').text()).toContain('Next rung · Seer');
      expect(wrapper.get('.next-rung').text()).toContain('A difficult rite');
      expect(wrapper.get('.world .delta').text()).toBe('That is new.');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.next-rung').text()).toContain('Next level · Seer');
      expect(wrapper.get('.next-rung').text()).toContain('A difficult rite');
      expect(wrapper.get('.world .delta').text()).toBe('This changed this year.');
      expect(current).toEqual(originalView);

      const empty = {
        ...current,
        ascension: { ...current.ascension, diagnosis: undefined, foremost: undefined },
      } as SessionView;
      await wrapper.setProps({ view: empty });
      expect(wrapper.get('.rung').text()).toContain('No family member is on the ladder.');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.rung').text()).toContain('nobody of the house is on the ladder');
      expect(wrapper.get('.world .delta').text()).toBe('That is new.');
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
      expect(wrapper.text()).toContain('Highest level reached · Hierophant, reached earlier.');
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
describe('the recommended ambition (#1867 §4)', () => {
  const recommending = (id: string | null, recommended: string) => ({
    ...ambitionView(id),
    ambitionRecommendation: {
      id: recommended,
      name: recommended === 'blood' ? 'Keep the bloodline' : 'Keep the estate',
      reason: 'Only 4 of the blood are living.',
    },
  }) as unknown as SessionView;

  it('pre-selects the recommendation for a first ambition, says why, and still offers the rest', async () => {
    const setAmbition = vi.fn().mockReturnValue(true);
    const wrapper = mount(Ambition, {
      props: { view: recommending(null, 'land'), actions: { setAmbition } as unknown as GameActions },
    });

    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('land');
    expect(wrapper.findAll('option').map((o) => o.text())).toEqual(['Keep the bloodline', 'Keep the estate (recommended)']);
    expect(wrapper.get('.recommendation').text()).toContain('Only 4 of the blood are living.');

    await wrapper.get('select').setValue('blood');
    await wrapper.get('.ambition-actions button').trigger('click');
    expect(setAmbition).toHaveBeenCalledWith('blood');
  });

  it('says when the situation points away from the tracked ambition, and opens that plan on request', async () => {
    const wrapper = mount(Ambition, {
      props: { view: recommending('blood', 'land'), actions: { setAmbition: vi.fn() } as unknown as GameActions },
    });
    expect(wrapper.get('.pressing').text()).toContain('Keep the estate');

    await wrapper.get('.pressing button').trigger('click');
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('land');

    const settled = mount(Ambition, {
      props: { view: recommending('blood', 'blood'), actions: { setAmbition: vi.fn() } as unknown as GameActions },
    });
    expect(settled.find('.pressing').exists()).toBe(false);
  });
});

describe('the ascent ambition looks ahead (#1867 §6)', () => {
  it('shows what the last step will ask only when the view carries it', () => {
    const base = ambitionView('blood');
    const ahead = { ...base, ambition: { ...base.ambition!, ahead: 'Aldren has taken both rites.' } } as SessionView;
    const shown = mount(Ambition, { props: { view: ahead, actions: { setAmbition: vi.fn() } as unknown as GameActions } });
    expect(shown.get('.ahead').text()).toBe('Ahead: Aldren has taken both rites.');
    const quiet = mount(Ambition, { props: { view: base, actions: { setAmbition: vi.fn() } as unknown as GameActions } });
    expect(quiet.find('.ahead').exists()).toBe(false);
  });
});

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
  it('labels every tale form while preserving contradictory accounts in both modes (#1719)', async () => {
    const labels: Record<TaleForm, string> = {
      song: 'song', doctrine: 'teachings', rival_chronicle: "rival house's Chronicle",
      rhyme: 'rhyme', play: 'play', footnote: 'footnote', charm: 'charm',
    };
    const current = { ...view(), tales: TaleFormS.options.map((form, index) => ({
      id: 'tale-' + form, about: 'one-event', form, teller: 'Teller ' + index,
      text: index % 2 ? 'The northern road was open.' : 'The northern road was closed.',
      bias: 'Account ' + index, since: 1100 + index, mutations: index,
    })) };
    const snapshot = structuredClone(current);
    const wrapper = mount(Abroad, { props: { view: current, proseMode: 'original' } });
    try {
      const evidence = () => wrapper.findAll('.tale').map((tale) =>
        [tale.get('.text').text(), tale.get('.bias').text()]);
      const original = wrapper.text();
      const originalEvidence = evidence();
      expect(wrapper.findAll('.account')).toHaveLength(1);
      expect(wrapper.get('.contested').text()).toBe('Two accounts of the same thing. Neither of them is the record.');
      for (const tale of current.tales) {
        expect(original).toContain(`${tale.form} · told by ${tale.teller} · since ${tale.since}`);
      }
      await wrapper.setProps({ proseMode: 'plainenglish' });
      for (const tale of current.tales) {
        expect(wrapper.text()).toContain(`Type: ${labels[tale.form]} · Told by: ${tale.teller} · First shared in ${tale.since}`);
      }
      expect(wrapper.text()).not.toContain('rival_chronicle');
      expect(wrapper.text()).toContain('retold 1 time; the story has changed');
      expect(wrapper.text()).toContain('retold 6 times; the story has changed');
      expect(wrapper.get('.contested').text()).toBe('Two accounts describe the same event. Neither is the official record.');
      expect(evidence()).toEqual(originalEvidence);
      expect(wrapper.findAll('.account')).toHaveLength(1);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(current).toEqual(snapshot);
      expect(wrapper.emitted()).toEqual({});
    } finally { wrapper.unmount(); }
  });

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

  it.each([1, 3] as const)('keeps Original troop counts but uses direct war nouns for %i troops', async (men) => {
    const data = activeWar();
    data.muster!.men = men;
    const muster = vi.fn();
    const wrapper = mount(Muster, {
      props: { view: data, refusal: null, actions: { muster } as unknown as GameActions },
    });
    try {
      expect(wrapper.text()).toContain(`${men} ${men === 1 ? 'man' : 'men'} in the field since 1126`);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain(`${men} ${men === 1 ? 'troop' : 'troops'} serving since 1126`);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toContain(`${men} ${men === 1 ? 'man' : 'men'} in the field since 1126`);
      expect(data.muster!.men).toBe(men);
      expect(muster).not.toHaveBeenCalled();
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
      mystic: { duties: [], offers: [] },
      security: { threats: [], history: [] },
      expeditions: { offers: [], current: [], history: [], cases: [], terms: '' },
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
      longWait: [],
      papers: [],
      pedigreePrices: [],
      servants: [],
      maxBond: 20,
    } as unknown as TableView;
  }

  const emptyLand = { market: [], held: [], rentsPolicy: 'customary' } as unknown as LandView;

  it('keeps auction bids and validation unchanged while its controls switch register (#1635)', async () => {
    const table = {
      ...wardshipTable(),
      auction: {
        year: 1140,
        lots: 1,
        lowestReserve: 20,
        items: [{
          id: 'book-lot', kind: 'heirloom', name: 'Silver Cup',
          seller: 'House Ash', saleYear: 1140, reserve: 20,
          bid: { currency: 'coin', amount: 25 },
        }],
        heirlooms: [{ id: 'ring', name: 'Old Ring' }],
      },
    } as unknown as TableView;
    const before = structuredClone(table);
    const order = vi.fn(() => ({ ok: true }));
    const wrapper = mount(GameTable, {
      props: {
        table, land: emptyLand, actions: { order } as unknown as GameActions,
        refusal: null, receipt: null, proseMode: 'original',
      },
    });
    try {
      const ceiling = wrapper.get('input[aria-label="Maximum auction bid in crowns"]');
      expect(wrapper.get('.panel h3').text()).toBe('The purse');
      expect(wrapper.get('.lot').text()).toContain('sold in 1140 · reserved at 20');
      expect(wrapper.get('.lot input').attributes('aria-label')).toBe('Bid in crowns for Silver Cup');
      expect(wrapper.get('.lot select').attributes('aria-label')).toBe('Heirloom to trade for Silver Cup');
      expect(wrapper.get('.lot select option[value=""]').text()).toBe('an heirloom…');
      expect(wrapper.get('.lot').text()).toContain('Bid crowns');
      expect(wrapper.get('.lot').text()).toContain('Trade it');
      expect(wrapper.get('.lot').text()).toContain('Withdraw');

      await ceiling.setValue('1.5');
      expect(ceiling.attributes('aria-invalid')).toBe('true');
      expect(wrapper.get('#bid-ceiling-error').text())
        .toBe('Enter zero or a whole number of crowns within the safe counting range.');
      const setMaximum = wrapper.findAll('button').find((button) => button.text() === 'Set the ceiling')!;
      expect(setMaximum.attributes('disabled')).toBeDefined();

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.panel h3').text()).toBe('Money and auctions');
      expect(ceiling.attributes('aria-label')).toBe('Maximum amount to bid at auction (crowns)');
      expect((ceiling.element as HTMLInputElement).value).toBe('1.5');
      expect(wrapper.get('#bid-ceiling-error').text())
        .toBe('Enter zero or a positive whole number of crowns within the allowed range.');
      expect(wrapper.get('.lot').text()).toContain('sale year 1140 · starting price 20');
      expect(wrapper.get('.lot input').attributes('aria-label')).toBe('Offer crowns for Silver Cup');
      expect(wrapper.get('.lot select').attributes('aria-label')).toBe('Choose an heirloom to offer for Silver Cup');
      expect(wrapper.get('.lot select option[value=""]').text()).toBe('Choose an heirloom…');
      expect(wrapper.get('.lot').text()).toContain('Place money bid');
      expect(wrapper.get('.lot').text()).toContain('Offer heirloom');
      expect(wrapper.get('.lot').text()).toContain('Withdraw bid');

      await ceiling.setValue('45');
      expect(ceiling.attributes('aria-invalid')).toBe('false');
      const maximum = wrapper.findAll('button').find((button) => button.text() === 'Set maximum bid')!;
      await maximum.trigger('click');
      expect(order).toHaveBeenLastCalledWith({ kind: 'bid', ceiling: 45 });
      await wrapper.get('.lot input').setValue('32');
      const cash = wrapper.findAll('.lot button').find((button) => button.text() === 'Place money bid')!;
      await cash.trigger('click');
      expect(order).toHaveBeenLastCalledWith({
        kind: 'lotBid', lot: 'book-lot', bid: { currency: 'coin', amount: 32 },
      });
      await wrapper.get('.lot select').setValue('ring');
      const heirloom = wrapper.findAll('.lot button').find((button) => button.text() === 'Offer heirloom')!;
      await heirloom.trigger('click');
      expect(order).toHaveBeenLastCalledWith({
        kind: 'lotBid', lot: 'book-lot', bid: { currency: 'heirloom', heirloom: 'ring' },
      });
      expect(table).toEqual(before);

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.panel h3').text()).toBe('The purse');
      expect(wrapper.get('.lot').text()).toContain('sold in 1140 · reserved at 20');
      expect(wrapper.get('.lot input').attributes('aria-label')).toBe('Bid in crowns for Silver Cup');
      expect((ceiling.element as HTMLInputElement).value).toBe('45');
      expect((wrapper.get('.lot select').element as HTMLSelectElement).value).toBe('ring');
      expect(table).toEqual(before);
    } finally { wrapper.unmount(); }
  });

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


describe('Plain English family-tree mark explanations (#1704)', () => {
  it('keeps the six Original meanings and glyphs while supplying reader-local plain labels', () => {
    const ids = LEGEND.map((mark) => mark.kind);
    expect(ids).toEqual(['seal', 'expresses', 'carries', 'madness', 'drift', 'given']);
    expect(LEGEND.map((mark) => markSays(mark.kind, 'original')))
      .toEqual(LEGEND.map((mark) => mark.says));
    expect(LEGEND.map((mark) => markSays(mark.kind, 'plainenglish'))).toEqual([
      'Leads the family',
      'Awakened: this person can use the Power',
      'Awakened: this person carries the Power but cannot use it',
      'How strongly the Power has affected this person',
      'The written record differs from this person',
      'Was sacrificed in a rite',
    ]);
    expect(markSays('madness', 'original', 26.7)).toBe('madness 27');
    expect(markSays('madness', 'plainenglish', 26.7)).toBe("Power's effects: 27");
    expect(MARKS.madness.says).toBe('how far the Power has taken them');
    expect(LEGEND.map((mark) => mark.glyph)).toEqual(['✦', '◈', '◇', '☾', '✎', '⊘']);
  });

  it('switches card accessible names both ways and keeps the same person and marks', async () => {
    const member = {
      id: 'cerin', name: 'Cerin', sex: 'female', age: 48,
      status: 'vessel_consumed', head: true,
      awakened: true, expresses: false, madness: 26.7, drift: true,
      parents: {}, attrs: {},
      record: { parents: {}, attrs: {}, claimed: [], claimedTraits: [] },
    } as unknown as SessionView['halls'][number]['members'][number];
    const original = structuredClone(member);
    const wrapper = mount(Member, { props: {
      member, names: [], traitNames: [], open: false, proseMode: 'original',
    } });
    try {
      const glyphs = () => wrapper.findAll('[role="img"]')
        .map((mark) => ({ glyph: mark.text(), label: mark.attributes('aria-label') }));
      const before = glyphs();
      expect(before.map((mark) => mark.label)).toEqual([
        'holds the seal',
        'awakened — they carry it and will not express it',
        'madness 27',
        'the record and the person do not agree',
        'given to the rite',
      ]);

      await wrapper.setProps({ proseMode: 'plainenglish' });
      const plain = glyphs();
      expect(plain.map((mark) => mark.glyph)).toEqual(before.map((mark) => mark.glyph));
      expect(plain.map((mark) => mark.label)).toEqual([
        'Leads the family',
        'Awakened: this person carries the Power but cannot use it',
        "Power's effects: 27",
        'The written record differs from this person',
        'Was sacrificed in a rite',
      ]);
      expect(member).toEqual(original);
      await wrapper.setProps({ proseMode: 'original' });
      expect(glyphs()).toEqual(before);
      expect(member).toEqual(original);
    } finally { wrapper.unmount(); }
  });

  it('has the Help legend use the very same mode-aware lookup as the card', () => {
    const source = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');
    expect(source).toContain('markSays(m.kind, accessibility.proseMode)');
    expect(source).not.toContain('{{ m.says }}');
    const memberSource = readFileSync(join(import.meta.dirname, './Member.vue'), 'utf8');
    expect(memberSource).toContain("markSays(mark.kind, proseMode, mark.kind === 'madness' ? member.madness : undefined)");
  });
});


describe('Standing debt-safe Plain English (#1749)', () => {
  it('describes negative treasury as a balance rather than spendable money, without changing numeric facts', async () => {
    const current = view();
    current.treasury = -40;
    const snapshot = structuredClone(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: null, saveStatus: 'idle', proseMode: 'original' },
    });
    try {
      const balance = () => wrapper.get('.house-ledger > div');
      const heading = () => balance().get('dt').text();
      const amount = () => balance().get('dd').text();
      const explanation = () => wrapper.get('.house-key dd').text();

      const original = wrapper.text();
      expect(heading()).toBe('Treasury');
      expect(amount()).toBe('-40 crowns');
      expect(explanation()).toBe('crowns the house can spend.');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(heading()).toBe('Money balance');
      expect(amount()).toBe('-40 crowns');
      expect(explanation()).toBe('The family’s money in crowns. A negative balance means the family owes money.');
      expect(wrapper.get('.house-key dt').text()).toBe('Money balance');

      const positive = { ...current, treasury: 252 };
      await wrapper.setProps({ view: positive });
      expect(heading()).toBe('Money balance');
      expect(amount()).toBe('252 crowns');
      expect(explanation()).toContain('A negative balance means the family owes money.');

      await wrapper.setProps({ view: current, proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(current).toEqual(snapshot);
      expect(wrapper.emitted()).toEqual({});
    } finally {
      wrapper.unmount();
    }
  });
});

describe('Ascension path accessibility (#1806)', () => {
  it('uses the canonical engine rung order and public names, not copied UI constants', () => {
    const game = newGame(loadContent(), { seed: 1806 });
    const ascension = game.view().ascension;
    expect(ascension.rungs.map((step) => step.id)).toEqual(RUNG_ORDER);
    expect(ascension.rungs.find((step) => step.id === ascension.rung)?.title).toBe(ascension.title);
    expect(ascension.rungs.find((step) => step.id === ascension.best)?.title).toBe(ascension.bestTitle);
    expect(ascension.rungs[0]?.reachedAt).toBeUndefined();
  });

  it.each(['original', 'plainenglish'] as const)('reads the ordered ladder and a lost former rung (%s)', async (mode) => {
    const current = view();
    const before = structuredClone(current);
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle', proseMode: mode } });
    try {
      const list = wrapper.get('ol.ladder-path');
      expect(list.findAll(':scope > li')).toHaveLength(RUNG_ORDER.length);
      expect(list.findAll(':scope > li').map((li) => li.attributes('data-rung'))).toEqual(RUNG_ORDER);
      expect(list.get('[data-rung="adept"]').attributes('aria-current')).toBe('step');
      expect(list.get('[data-rung="hierophant"]').attributes('data-state')).toBe('once');
      expect(list.get('[data-rung="hierophant"]').text()).toContain('1114');
      expect(list.get('[data-rung="hierophant"]').text()).toContain(mode === 'original' ? 'none holds it now' : 'no one holds it now');
      expect(list.get('[data-rung="demigod"]').text()).not.toMatch(/power|threshold|\d+ of 100/i);
      expect(wrapper.text()).toContain(mode === 'original' ? 'Highest reached' : 'Highest level reached');
      expect(current).toEqual(before);
    } finally { wrapper.unmount(); }
  });

  it('shows the ground when no family member has reached a rung', () => {
    const current = view();
    current.ascension = {
      ...current.ascension, rung: 'none', best: 'none', title: 'None', bestTitle: 'None',
      bestAt: undefined, foremost: undefined, diagnosis: undefined,
      rungs: current.ascension.rungs.map((r) => ({ id: r.id, title: r.title })),
    };
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle', proseMode: 'plainenglish' } });
    try {
      expect(wrapper.get('[data-rung="none"]').attributes('aria-current')).toBe('step');
      expect(wrapper.get('[data-rung="none"]').text()).toContain('Not yet on the ladder');
      expect(wrapper.get('.rung').text()).toContain('No family member is on the ladder.');
      expect(wrapper.find('[data-state="once"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.each(['original', 'plainenglish'] as const)('shows multiple blockers only under the next rung (%s)', async (mode) => {
    const current = view();
    current.ascension.diagnosis = {
      target: 'hierophant', targetTitle: 'Hierophant', name: 'Maren',
      blockers: [
        { kind: 'power', text: 'The power is short.', hint: 'Look to the family.' },
        { kind: 'books', text: 'The reading is short.', hint: 'Read more books.' },
      ] as NonNullable<SessionView['ascension']['diagnosis']>['blockers'],
    };
    const wrapper = mount(Standing, { props: { view: current, jump: null, saveStatus: 'idle', proseMode: mode } });
    try {
      const next = wrapper.get('[data-rung="hierophant"]');
      expect(next.findAll('.ladder-blocker')).toHaveLength(2);
      expect(wrapper.findAll('.ladder-blocker')).toHaveLength(2);
      expect(next.text()).toContain('The power is short.');
      expect(next.text()).toContain('Read more books.');
      expect(next.get('.next-rung').text()).toContain(mode === 'original' ? 'Next rung' : 'Next level');
      expect(wrapper.get('.ladder-measure').text()).toContain(mode === 'original' ? 'power 42 of 100' : 'Power 42 out of 100');
    } finally { wrapper.unmount(); }
  });

  it('marks a clear next rung without inventing blockers, and keeps the existing action links keyboard-operable', async () => {
    const current = view();
    current.ascension = {
      ...current.ascension, rung: 'touched', best: 'touched', title: 'Touched', bestTitle: 'Touched',
      diagnosis: undefined, rungs: current.ascension.rungs.map((r) => ({ id: r.id, title: r.title })),
    };
    const wrapper = mount(Standing, { attachTo: document.body, props: { view: current, jump: null, saveStatus: 'idle' } });
    try {
      expect(wrapper.get('[data-rung="adept"]').attributes('data-state')).toBe('next');
      expect(wrapper.get('[data-rung="adept"] .next-rung').text()).toContain('Adept');
      expect(wrapper.find('.ladder-blocker').exists()).toBe(false);
      expect(wrapper.text()).toContain('Maren — nothing stands in the way.');

      current.ascension.diagnosis = {
        target: 'adept', targetTitle: 'Adept',
        blockers: [{ kind: 'power', text: 'Find the blood.', hint: 'Read the family.' }],
        route: { title: 'The blood', rule: 'Read the family.', caution: 'No child is promised.',
          daughters: [{ person: 'mara', name: 'Mara', evidence: [] }], cards: [], alternatives: [] },
      };
      await wrapper.setProps({ view: { ...current } });
      const button = wrapper.get('.power-route button');
      (button.element as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(button.element);
      await button.trigger('click');
      expect(wrapper.emitted('look')).toEqual([['mara']]);
    } finally { wrapper.unmount(); }
  });

  it('provides a stacked narrow viewport path without concealing status text', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/src/components/LadderPath.vue'), 'utf8');
    expect(source).toContain('@media (max-width: 680px)');
    expect(source).toContain('.ladder-path { display: block;');
    const wrapper = mount(Standing, { props: { view: view(), jump: null, saveStatus: 'idle' } });
    try {
      for (const li of wrapper.findAll('ol.ladder-path > li')) {
        expect(li.get('.ladder-step-head .soft').text().length).toBeGreaterThan(0);
      }
    } finally { wrapper.unmount(); }
  });
});
