// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionView } from '@ed/core';
import Abroad from './Abroad.vue';

function abroadView(): SessionView {
  return {
    tales: [
      {
        id: 'first', about: 'one-night', text: 'One witness saw the open gate.',
        form: 'letter', teller: 'Ada', since: 1180, mutations: 2,
        bias: 'Favourable to the house',
      },
      {
        id: 'second', about: 'one-night', text: 'Another witness says the gate was shut.',
        form: 'rumour', teller: 'Bea', since: 1181, mutations: 0,
        bias: 'Hostile to the house',
      },
    ],
    looseSecrets: [
      { secret: 'gate', carrier: 'Cora', houseName: 'House Ash', since: 1182 },
      { secret: 'letter', carrier: 'Dora', houseName: 'House Birch', since: 1183, told: 1186 },
    ],
    marriagePromises: [
      { year: 1190, houseName: 'House Elm', lotName: 'A Book of Hours' },
    ],
  } as unknown as SessionView;
}

describe('Abroad counter-record in the reader\'s prose mode (#1313)', () => {
  it('keeps the existing Original register and all of the two-account evidence', () => {
    const wrapper = mount(Abroad, { props: { view: abroadView() } });
    const text = wrapper.text();

    expect(text).toContain('What else is being said');
    expect(text).toContain('Two accounts of the same thing. Neither of them is the record.');
    expect(text).toContain('retold 2 times, and it has moved');
    expect(text).toContain('Cora walked out with it in 1182, and House Ash have had it since.');
    expect(text).toContain('It is still only theirs.');
    expect(text).toContain('Told, in 1186. It is a thing that can be proved now.');
    expect(text).toContain('A daughter of this house, unborn in 1190, promised to House Elm for A Book of Hours.');
    expect(wrapper.findAll('.tale')).toHaveLength(2);
    expect(wrapper.findAll('.account')).toHaveLength(1);
    expect(wrapper.findAll('.tale').map((tale) => tale.find('.text').text())).toEqual([
      'One witness saw the open gate.',
      'Another witness says the gate was shut.',
    ]);
    wrapper.unmount();
  });

  it('switches live to Plain English without changing either account or its order', async () => {
    const view = abroadView();
    const wrapper = mount(Abroad, { props: { view, proseMode: 'original' } });
    await wrapper.setProps({ proseMode: 'plainenglish' });
    const text = wrapper.text();

    expect(text).toContain('What other people say');
    expect(text).toContain('Two accounts describe the same event. Neither is the official record.');
    expect(text).toContain('retold 2 times; the story has changed');
    expect(text).toContain('Cora took this secret to House Ash in 1182.');
    expect(text).toContain('Only that house has the secret so far.');
    expect(text).toContain('Shared in 1186. It can now be proved.');
    expect(text).toContain('In 1190, the house promised a future daughter to House Elm in exchange for A Book of Hours.');
    expect(text).not.toContain('Nothing about this family has got far enough to be repeated.');
    expect(wrapper.findAll('.tale').map((tale) => tale.find('.text').text())).toEqual(view.tales.map((tale) => tale.text));
    expect(wrapper.findAll('.account')).toHaveLength(1);

    await wrapper.setProps({ proseMode: 'original' });
    expect(wrapper.text()).toContain('What else is being said');
    wrapper.unmount();
  });

  it('provides plain empty-state explanations with no invented tales or pledges', () => {
    const view = { ...abroadView(), tales: [], looseSecrets: [], marriagePromises: [] };
    const wrapper = mount(Abroad, { props: { view, proseMode: 'plainenglish' } });

    expect(wrapper.text()).toContain('Nobody has shared a story about this family yet.');
    expect(wrapper.text()).toContain('No secrets are known to have left the house.');
    expect(wrapper.text()).toContain('No future daughters have been promised in marriage.');
    expect(wrapper.findAll('.tale')).toHaveLength(0);
    expect(wrapper.findAll('.promise')).toHaveLength(0);
    wrapper.unmount();
  });

  it('receives the reader-local preference from App rather than from the saved world', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/src/App.vue'), 'utf8');
    expect(source).toContain('<Abroad v-else-if="middle === \'abroad\'" :view="view" :prose-mode="accessibility.proseMode" />');
  });
});
