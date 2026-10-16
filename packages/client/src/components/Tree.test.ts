// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import Tree from './Tree.vue';
import Kin from './Kin.vue';
import Standing from './Standing.vue';
import Line from './Line.vue';
import Chronicle from './Chronicle.vue';
import Passage from './Passage.vue';
import type { GameActions, RememberedPassage } from '../lib/game';
import type { MemberView } from '../lib/kin';

type HallView = SessionView['halls'][number];

beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

function person(over: Partial<MemberView> & { id: string; name: string }): MemberView {
  return {
    sex: 'female',
    age: 30,
    status: 'alive',
    head: false,
    awakened: false,
    expresses: false,
    madness: 0,
    attrs: {},
    parents: {},
    record: { attrs: {}, claimedTraits: [], parents: {}, claimed: [] },
    drift: false,
    ...over,
  } as MemberView;
}

/**
 * The measured Long-Line target for #268: one hundred living members in six
 * halls. The fixture has a shallow recorded genealogy in every hall so this
 * exercises the same roots/children walk as the real tree instead of turning
 * the scale assertion into a flat-list test.
 */
function largeView(): SessionView {
  const counts = [17, 17, 17, 17, 16, 16];
  const halls: HallView[] = [];
  let global = 0;

  for (let h = 0; h < counts.length; h += 1) {
    const members: MemberView[] = [];
    for (let i = 0; i < counts[h]!; i += 1) {
      const index = global;
      const id = 'p' + String(index).padStart(3, '0');
      const sex = index % 2 === 0 ? 'male' : 'female';
      const parent = i === 0 ? undefined : members[Math.floor((i - 1) / 3)];
      const parents = parent
        ? (parent.sex === 'male' ? { father: parent.id } : { mother: parent.id })
        : {};

      members.push(person({
        id,
        name: 'Member ' + String(index).padStart(3, '0'),
        sex,
        head: index === 0,
        awakened: index % 6 === 0,
        // p099 deliberately carries the hidden fact without awakening. The
        // succession filter must ignore it and trust MemberView.succession.
        expresses: index === 99,
        parents,
        record: { attrs: {}, claimedTraits: [], parents, claimed: [] },
        ...(index === 1 ? { succession: 'heir' as const } : {}),
        ...(index === 2 ? { succession: 'possible' as const } : {}),
        ...(index % 9 === 0 ? { post: 'a post at court' } : {}),
        ...(index % 4 === 0 ? {
          spouse: {
            id: 'outside-' + id,
            name: 'Spouse of ' + id,
            marriedIn: true,
            house: 'House Elsewhere',
          },
        } : {}),
        ...(index % 7 === 0 ? {
          relevance: [{ reason: index % 14 === 0
            ? 'their hall holds a grievance'
            : 'unmarried, of the blood' }],
        } : {}),
      }));
      global += 1;
    }

    halls.push({
      id: 'hall-' + h,
      name: h === 0 ? 'The Seat' : 'Cadet Hall ' + h,
      isSeat: h === 0,
      grievance: h === 2 ? 3 : 0,
      members,
    } as HallView);
  }

  return {
    halls,
    attributes: [],
    traits: [],
  } as unknown as SessionView;
}

function renderedIds(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.member')
    .map((node) => {
      const id = node.attributes('id');
      if (!id) throw new Error('rendered member card has no stable id');
      return id.replace(/^member-/, '');
    })
    .sort();
}

function allMembers(view: SessionView): { hall: HallView; member: MemberView }[] {
  return view.halls.flatMap((hall) => hall.members.map((member) => ({ hall, member })));
}

describe('the family tree as a planning board (#268)', () => {

  it('restores keyboard focus after selecting a search result that is removed from the DOM (#1753)', async () => {
    const current = largeView();
    const original = structuredClone(current);
    const wrapper = mount(Tree, {
      props: { view: current, selected: null, proseMode: 'original' },
      attachTo: document.body,
    });
    try {
      const search = wrapper.get('.find input');
      await search.setValue('Member 001');
      const result = wrapper.get('.matches button');
      (result.element as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(result.element);

      await result.trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('select')).toEqual([['p001']]);
      expect(wrapper.find('.matches button').exists()).toBe(false);
      expect((search.element as HTMLInputElement).value).toBe('');
      const face = wrapper.get('#member-p001 button.face');
      expect(document.activeElement).toBe(face.element);

      // The parent owns selection; when it opens the person, the focus stays
      // on their real disclosure button in either reader register.
      await wrapper.setProps({ selected: 'p001', proseMode: 'plainenglish' });
      expect(wrapper.get('#member-p001').classes()).toContain('open');
      expect(document.activeElement).toBe(wrapper.get('#member-p001 button.face').element);
      expect(current).toEqual(original);
      expect(wrapper.emitted('select')).toEqual([['p001']]);
    } finally {
      wrapper.unmount();
    }
  });


  it.each([0, 0.2, 0.99, 1, 3.6])('reports grievance %s honestly without resetting the tree (#1722)', async (grievance) => {
    const current = largeView();
    current.halls[1]!.grievance = grievance;
    // One person matches the selected hall and filter; a second remains in the data.
    current.halls[1]!.members = [person({ id: 'candidate', name: 'Candidate', head: true }),
      person({ id: 'other', name: 'Other' })];
    const snapshot = structuredClone(current);
    const wrapper = mount(Tree, { props: { view: current, selected: 'candidate' } });
    try {
      await wrapper.get('.filters [data-filter="head"]').trigger('click');
      await wrapper.findAll('.halls button')[2]!.trigger('click');
      expect(renderedIds(wrapper)).toEqual(['candidate']);
      const heading = () => wrapper.get('.hall h3').text();
      const value = grievance < 1 ? 'less than 1' : String(Math.round(grievance));
      if (grievance > 0) expect(heading()).toContain('grievance ' + value);
      else expect(heading()).not.toContain('grievance');
      const original = wrapper.text();
      const emitted = JSON.stringify(wrapper.emitted());
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(heading()).toContain('1 person shown');
      if (grievance > 0) {
        expect(heading()).toContain('unresolved complaints: ' + (grievance < 1 ? 'under 1' : value));
      } else expect(heading()).not.toContain('unresolved complaints:');
      expect(renderedIds(wrapper)).toEqual(['candidate']);
      expect(wrapper.get('[data-filter="head"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.findAll('.halls button')[2]!.attributes('aria-pressed')).toBe('true');
      expect(wrapper.get('#member-candidate').classes()).toContain('open');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(current).toEqual(snapshot);
      expect(JSON.stringify(wrapper.emitted())).toBe(emitted);
      await wrapper.get('[data-filter="all"]').trigger('click');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(heading()).toContain('2 people shown');
    } finally { wrapper.unmount(); }
  });

  it('switches tree navigation to Plain English without resetting search, filters or people (#1618)', async () => {
    const current = largeView();
    const saved = structuredClone(current);
    const wrapper = mount(Tree, { props: { view: current, selected: null, proseMode: 'original' } });
    try {
      const originalIds = renderedIds(wrapper);
      expect(wrapper.get('.tree').attributes('aria-label')).toBe('The living family tree');
      expect(wrapper.get('.find input').attributes('placeholder')).toBe('find somebody by name');
      expect(wrapper.get('.filters [data-filter="succession"]').text()).toBe('Heir / possible');
      expect(wrapper.get('.planning-label').text()).toBe('Read the house by');
      expect(wrapper.get('.halls button').text()).toBe('All halls');
      expect(originalIds).toHaveLength(100);

      await wrapper.get('.filters [data-filter="head"]').trigger('click');
      const filteredIds = renderedIds(wrapper);
      expect(wrapper.get('.filters [data-filter="head"]').attributes('aria-pressed')).toBe('true');
      await wrapper.get('.find input').setValue('does not exist');
      expect(wrapper.text()).toContain('Nobody of the house answers to that.');
      const originalFiltered = wrapper.text();

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.tree').attributes('aria-label')).toBe('Living family tree');
      expect(wrapper.get('.find input').attributes('placeholder')).toBe('Find a family member');
      expect(wrapper.get('.planning-label').text()).toBe('Show family members by');
      expect(wrapper.get('.filters [data-filter="head"]').text()).toBe('House leader');
      expect(wrapper.get('.filters [data-filter="succession"]').text()).toBe('Next in line or possible successor');
      expect(wrapper.get('.filters [data-filter="head"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.get('.halls button').text()).toBe('All households');
      expect(wrapper.get('[data-direct-line]').text()).toBe('Main family line');
      expect(wrapper.text()).toContain('No family member matches that name.');
      expect((wrapper.get('.find input').element as HTMLInputElement).value).toBe('does not exist');
      expect(renderedIds(wrapper)).toEqual(filteredIds);
      expect(current).toEqual(saved);

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(originalFiltered);
      expect(renderedIds(wrapper)).toEqual(filteredIds);
      expect(current).toEqual(saved);
    } finally {
      wrapper.unmount();
    }
  });


  it('changes the recursive branch focus label without changing the tree or its action (#1628)', async () => {
    const current = largeView();
    const saved = structuredClone(current);
    const wrapper = mount(Tree, { props: { view: current, selected: null, proseMode: 'original' } });
    try {
      const originalIds = renderedIds(wrapper);
      expect(wrapper.get('.root').text()).toBe('Only this branch ▸');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.root').text()).toBe('Show only this family branch ▸');
      expect(renderedIds(wrapper)).toEqual(originalIds);

      await wrapper.get('.root').trigger('click');
      expect(wrapper.get('.branch').text()).toContain('Only this family branch is shown.');
      expect(renderedIds(wrapper).length).toBeLessThan(originalIds.length);

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.root').text()).toBe('Only this branch ▸');
      expect(wrapper.get('.branch').text()).toContain('Showing one branch.');
      expect(current).toEqual(saved);
    } finally {
      wrapper.unmount();
    }
  });

  it('explains a hall grievance under Plain English without changing scores or tree navigation (#1652)', async () => {
    const current = largeView();
    const before = structuredClone(current);
    const wrapper = mount(Tree, {
      props: { view: current, selected: null, proseMode: 'original' },
    });
    try {
      const originalIds = renderedIds(wrapper);
      const hall = () => wrapper.findAll('.hall').find((node) => node.get('h3').text().includes('Cadet Hall 2'))!;
      expect(hall().get('h3').text()).toContain('grievance 3');
      expect(hall().get('h3').text()).not.toContain('unresolved complaints');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(hall().get('h3').text()).toContain('unresolved complaints: 3');
      expect(renderedIds(wrapper)).toEqual(originalIds);
      expect(current.halls[2]!.grievance).toBe(3);
      await wrapper.findAll('.halls button')[3]!.trigger('click');
      expect(renderedIds(wrapper)).toEqual(current.halls[2]!.members.map((member) => member.id).sort());

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.hall h3').text()).toContain('grievance 3');
      expect(current).toEqual(before);
    } finally {
      wrapper.unmount();
    }
  });

  it('renders a 100-member, 6-hall house exactly once', () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: null } });

    const expected = allMembers(view).map(({ member }) => member.id).sort();
    const rendered = renderedIds(wrapper);

    expect(view.halls).toHaveLength(6);
    expect(expected).toHaveLength(100);
    expect(rendered).toEqual(expected);
    expect(new Set(rendered).size).toBe(100);
    wrapper.unmount();
  });

  it('restores the seat after a selected cadet hall disappears between years (#1464)', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: null } });
    try {
      // The reader is deliberately narrowed to a living cadet branch.
      await wrapper.findAll('.halls button')[3]!.trigger('click'); // Cadet Hall 2
      const cadetIds = view.halls[2]!.members.map((member) => member.id).sort();
      expect(renderedIds(wrapper)).toEqual(cadetIds);

      // Replacing the world photograph must NOT discard a still-valid selection.
      const refreshed = {
        ...view,
        halls: view.halls.map((hall) => ({ ...hall, members: [...hall.members] })),
      };
      await wrapper.setProps({ view: refreshed });
      expect(renderedIds(wrapper)).toEqual(cadetIds);
      expect(wrapper.findAll('.hall')).toHaveLength(1);

      // If that hall vanishes, the seat must reappear even when the single-hall
      // picker is no longer rendered and cannot be used to recover manually.
      await wrapper.get('.root').trigger('click');
      expect(wrapper.find('.branch').exists()).toBe(true);
      const seatOnly = { ...refreshed, halls: [refreshed.halls[0]!] };
      await wrapper.setProps({ view: seatOnly });
      expect(wrapper.find('.halls').exists()).toBe(false);
      expect(wrapper.find('.branch').exists()).toBe(false);
      expect(wrapper.find('.no-match').exists()).toBe(false);
      expect(renderedIds(wrapper))
        .toEqual(seatOnly.halls[0]!.members.map((member) => member.id).sort());
      expect(wrapper.get('.hall h3').text()).toContain('The Seat');
    } finally {
      wrapper.unmount();
    }
  });

  it('narrows every planning filter to exactly the visible fact it names', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: null } });
    const rows = allMembers(view);

    const cases: [string, (row: { hall: HallView; member: MemberView }) => boolean][] = [
      ['head', ({ member }) => member.head],
      ['succession', ({ member }) => member.succession !== undefined],
      ['married', ({ member }) => member.spouse !== undefined],
      ['unmarried', ({ member }) => member.spouse === undefined],
      ['post', ({ member }) => member.post !== undefined],
      ['cadet', ({ hall }) => !hall.isSeat],
      ['awakened', ({ member }) => member.awakened],
    ];

    for (const [filter, keep] of cases) {
      await wrapper.get('[data-filter="' + filter + '"]').trigger('click');
      const expected = rows.filter(keep).map(({ member }) => member.id).sort();
      const rendered = renderedIds(wrapper);

      expect(expected.length, filter + ' fixture should exercise a real subset').toBeGreaterThan(0);
      expect(expected.length, filter + ' should actually narrow the 100-member tree').toBeLessThan(100);
      expect(rendered, filter).toEqual(expected);
    }

    // p099 says expresses=true but is unwoken and has no known succession mark.
    // A client filter that read the hidden field would leak it here.
    await wrapper.get('[data-filter="succession"]').trigger('click');
    expect(renderedIds(wrapper)).not.toContain('p099');
    wrapper.unmount();
  });

  it('draws only direct-line people, not off-line children of the same ancestor (#1301)', async () => {
    const view = largeView();
    // p000 -> p001 -> p004 is a recorded spine. Siblings p002/p003 and
    // p004's descendants are deliberately absent; p018 belongs to another
    // hall, with its parent p017 outside the requested line.
    const line = [
      { person: 'p000' },
      { person: 'p001' },
      { person: 'p004' },
      { person: 'p018' },
    ];
    const wrapper = mount(Tree, { props: { view, selected: null, line } });

    await wrapper.get('[data-direct-line]').trigger('click');
    expect(wrapper.get('[data-direct-line]').attributes('aria-pressed')).toBe('true');
    expect(renderedIds(wrapper)).toEqual(['p000', 'p001', 'p004', 'p018']);
    expect(wrapper.find('#member-p002').exists()).toBe(false);
    expect(wrapper.find('#member-p005').exists()).toBe(false);
    expect(wrapper.findAll('.hall')).toHaveLength(2);
    expect(wrapper.findAll('.hall h3').map((heading) => heading.text()))
      .toEqual([expect.stringContaining('3 shown'), expect.stringContaining('1 shown')]);

    // The narrowing is a reading mode, not a mutation of the hall roster.
    await wrapper.get('[data-direct-line]').trigger('click');
    expect(wrapper.get('[data-direct-line]').attributes('aria-pressed')).toBe('false');
    expect(renderedIds(wrapper))
      .toEqual(allMembers(view).map(({ member }) => member.id).sort());
    expect(wrapper.findAll('.hall')).toHaveLength(6);
    wrapper.unmount();
  });

  it('reveals an externally navigated person hidden by hall, branch, or filter state', async () => {
    const view = largeView();
    const wrapper = mount(Tree, {
      props: { view, selected: null, reveal: null },
    });

    // Put the player in a different hall and then inside one focused branch.
    const hallButtons = wrapper.findAll('.halls button');
    await hallButtons[3]!.trigger('click'); // Cadet Hall 2
    await wrapper.get('.root').trigger('click');
    expect(wrapper.find('#member-p001').exists()).toBe(false);

    // The Chronicle/passages path selects the person in App and supplies a
    // separate reveal request. The tree must discard its private narrowing.
    await wrapper.setProps({
      selected: 'p001',
      reveal: { id: 'p001', token: 1 },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('#member-p001').classes()).toContain('open');
    expect(wrapper.find('.branch').exists()).toBe(false);
    expect(wrapper.get('[data-filter="all"]').attributes('aria-pressed')).toBe('true');

    // A repeated link to the same selected person is still navigation. Hide
    // them behind a filter, then change only the reveal token.
    await wrapper.get('[data-filter="awakened"]').trigger('click');
    expect(wrapper.find('#member-p001').exists()).toBe(false);
    await wrapper.setProps({ reveal: { id: 'p001', token: 2 } });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('#member-p001').classes()).toContain('open');
    expect(wrapper.get('[data-filter="all"]').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  it('links an open member back to dated Chronicle pages', async () => {
    const view = largeView();
    const wrapper = mount(Tree, {
      props: {
        view,
        selected: 'p000',
        mentions: (person: string) => person === 'p000'
          ? [{ id: 'entry-a', year: 1104 }, { id: 'entry-b', year: 1129 }]
          : [],
      },
    });

    const links = wrapper.findAll('[data-mention]');
    expect(links.map((link) => link.text())).toEqual(['1104', '1129']);
    await links[1]!.trigger('click');
    expect(wrapper.emitted('book')).toEqual([['entry-b']]);
    wrapper.unmount();
  });

  it('renders the recorded relationship path and makes every person on it clickable', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: 'p001' } });

    await wrapper.get('#member-p001 [data-relationship]').trigger('click');
    expect(wrapper.text()).toContain('Tracing from Member 001');

    await wrapper.setProps({ selected: 'p002' });
    await wrapper.get('#member-p002 [data-relationship]').trigger('click');

    const path = wrapper.findAll('[data-relation-person]');
    expect(path.map((node) => node.attributes('data-relation-person')))
      .toEqual(['p001', 'p000', 'p002']);
    expect(wrapper.text()).toContain('father');
    expect(wrapper.text()).toContain('son');

    await path[1]!.trigger('click');
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['p000']);
    wrapper.unmount();
  });

  it('releases a stale relationship anchor when the family view changes (#1145)', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: 'p001' } });

    await wrapper.get('#member-p001 [data-relationship]').trigger('click');
    expect(wrapper.text()).toContain('Tracing from Member 001');

    // A year can remove the anchor from the current halls while Tree stays mounted.
    const withoutAnchor = {
      ...view,
      halls: view.halls.map((hall) => ({
        ...hall,
        members: hall.members.filter((member) => member.id !== 'p001'),
      })),
    };
    await wrapper.setProps({ view: withoutAnchor });
    expect(wrapper.find('.relationship').exists()).toBe(false);

    // The next click must start a new trace, not secretly target the departed anchor.
    // Relationship controls are present only on the card currently open in App.
    await wrapper.setProps({ selected: 'p002' });
    await wrapper.get('#member-p002 [data-relationship]').trigger('click');
    expect(wrapper.text()).toContain('Tracing from Member 002');
    await wrapper.setProps({ selected: 'p003' });
    await wrapper.get('#member-p003 [data-relationship]').trigger('click');
    expect(wrapper.text()).toContain('Recorded relationship:');

    // If only the target leaves, retain the still-visible anchor for the next choice.
    const withoutTarget = {
      ...withoutAnchor,
      halls: withoutAnchor.halls.map((hall) => ({
        ...hall,
        members: hall.members.filter((member) => member.id !== 'p003'),
      })),
    };
    await wrapper.setProps({ view: withoutTarget });
    expect(wrapper.text()).toContain('Tracing from Member 002');
    wrapper.unmount();
  });

  it('highlights only relevant people and prints every reason in visible text', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: null } });
    const relevant = allMembers(view).filter(({ member }) => member.relevance?.length);

    expect(wrapper.findAll('.member.relevant')).toHaveLength(0);
    await wrapper.get('[data-relevance-toggle]').trigger('click');

    const highlighted = wrapper.findAll('.member.relevant');
    expect(highlighted).toHaveLength(relevant.length);

    for (const { member } of relevant) {
      const card = wrapper.get('#member-' + member.id);
      for (const item of member.relevance ?? []) {
        expect(card.text()).toContain(item.reason);
      }
      expect(card.attributes('title')).toBeUndefined();
    }

    wrapper.unmount();
  });

  it('links Chronicle cast by recorded person id rather than prose names', async () => {
    const base = largeView();
    const view = {
      ...base,
      house: 'house_test',
      campaign: { id: 'long', name: 'Long Line', startYear: 1042, endYear: 1542 },
      chronicle: [{
        id: 'entry-cast',
        year: 1188,
        weight: 'paragraph',
        text: 'The page deliberately does not name the person in its prose.',
        named: false,
        people: ['p001', 'somebody-no-longer-living'],
      }, {
        id: 'entry-blank',
        year: 1187,
        weight: 'line',
        text: null,
        named: false,
        people: ['p001'],
      }],
      chroniclePeople: [
        { id: 'p001', name: 'Member 001' },
        { id: 'somebody-no-longer-living', name: 'Former member' },
      ],
    } as unknown as SessionView;

    const wrapper = mount(Chronicle, {
      props: {
        view,
        frame: [],
        actions: {
          causeOf: () => undefined,
          answeredBy: () => [],
          advice: () => [],
        },
      },
    });

    const people = wrapper.findAll('[data-person="p001"]');
    expect(people).toHaveLength(1);
    const person = people[0]!;
    expect(person.text()).toBe('Member 001');
    expect(wrapper.find('[data-person="somebody-no-longer-living"]').exists()).toBe(false);
    expect(wrapper.get('[data-person-history="somebody-no-longer-living"]').text()).toContain('Former member');
    expect(wrapper.get('[data-entry="entry-blank"]').find('[data-person]').exists()).toBe(false);

    await person.trigger('click');
    expect(wrapper.emitted('person')).toEqual([['p001']]);
    wrapper.unmount();
  });

  it('transfers keyboard focus to a Chronicle cause and retains the latest rapid navigation (#1043)', async () => {
    const view = {
      ...largeView(),
      house: 'house_test',
      campaign: { id: 'long', name: 'Long Line', startYear: 1042, endYear: 1542 },
      chronicle: [
        { id: 'older', year: 1042, weight: 'line', text: 'The first page.', named: false },
        { id: 'middle', year: 1100, weight: 'line', text: 'The next page.', named: false },
        { id: 'later', year: 1120, weight: 'line', text: 'A later consequence.', named: false },
      ],
    } as unknown as SessionView;
    const wrapper = mount(Chronicle, {
      attachTo: document.body,
      props: {
        view,
        frame: [],
        actions: {
          causeOf: (id: string) => id === 'later'
            ? { year: 1100, page: 'middle', blank: false }
            : id === 'middle' ? { year: 1042, page: 'older', blank: false } : undefined,
          answeredBy: () => [],
          advice: () => [],
        },
      },
    });

    try {
      const middle = wrapper.get('[data-entry="middle"]');
      const older = wrapper.get('[data-entry="older"]');
      expect(middle.attributes('tabindex')).toBeUndefined();

      await wrapper.get('[data-entry="later"] button.link').trigger('click');
      await wrapper.vm.$nextTick();
      expect(middle.attributes('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(middle.element);

      // Two links in the same task must not let an earlier async follow()
      // steal focus from the later destination after Vue renders.
      (wrapper.get('[data-entry="later"] button.link').element as HTMLButtonElement).click();
      (wrapper.get('[data-entry="middle"] button.link').element as HTMLButtonElement).click();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      expect(older.attributes('tabindex')).toBe('-1');
      expect(middle.attributes('tabindex')).toBeUndefined();
      expect(document.activeElement).toBe(older.element);
    } finally {
      wrapper.unmount();
    }
  });

});

/**
 * The Line is a second overlay opened from the family surface. The shared
 * useModal helper must not let one held Escape dismiss another overlay too.
 * Keep this mounted regression in an already measured DOM component suite.
 */
describe('the Line modal keyboard dismissal (#941)', () => {
  it('ignores repeated Escape events but closes on a fresh Escape press', () => {
    const close = vi.fn();
    const wrapper = mount(Line, { attachTo: document.body, props: { line: [], close } });
    try {
      const button = wrapper.get('.spine button').element as HTMLButtonElement;
      expect(document.activeElement).toBe(button);

      const held = new KeyboardEvent('keydown', {
        key: 'Escape',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(held);
      expect(held.defaultPrevented).toBe(true);
      expect(close).not.toHaveBeenCalled();

      const fresh = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(fresh);
      expect(fresh.defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      wrapper.unmount();
    }
  });
});


describe('Cast navigation reveals a person hidden by the planning board (#1060)', () => {
  it('routes Cast clicks through the reveal token while tree clicks retain their filters', () => {
    const app = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(app).toMatch(/<Cast\b[^>]*@select="selectFromCast"/);
    expect(app).toMatch(/<Tree\b[\s\S]*?@select="select"/);
    expect(app).toMatch(/function selectFromCast\(id: string\): void \{[\s\S]*?selected\.value = opening \? id : null;[\s\S]*?if \(opening\) treeReveal\.value = \{ id, token: \+\+treeRevealToken \};/);
  });

  it('shows why ordinary selection is insufficient and an explicit Cast reveal finds the card', async () => {
    const wrapper = mount(Tree, { props: { view: largeView(), selected: null, reveal: null } });
    try {
      // The player is planning with only awakened members in another hall.
      await wrapper.get('[data-filter="awakened"]').trigger('click');
      await wrapper.findAll('.halls button')[3]!.trigger('click');
      await wrapper.get('[data-filter="awakened"]').trigger('click');
      expect(wrapper.find('#member-p001').exists()).toBe(false);

      // A selection change by itself does not discard deliberately chosen filters.
      await wrapper.setProps({ selected: 'p001' });
      expect(wrapper.find('#member-p001').exists()).toBe(false);

      // Cast now supplies this navigation token when opening someone.
      await wrapper.setProps({ reveal: { id: 'p001', token: 1 } });
      await wrapper.vm.$nextTick();
      expect(wrapper.get('#member-p001').classes()).toContain('open');
      expect(wrapper.get('[data-filter="all"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.find('.branch').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});


describe('Passage navigation only offers currently drawable family cards (#1085)', () => {
  it('keeps departed history readable without a dead-end navigation control', async () => {
    const passages = [{
      year: 1100,
      lines: [
        { kind: 'birth', person: 'p001', text: 'A child of the hall was born.' },
        { kind: 'marriage', person: 'p-departed', text: 'A person later lost was married.' },
        {
          kind: 'death', person: 'p-departed', text: 'The person died.',
          remembered: { label: 'the last heir', because: 'they had held the seal' },
        },
      ],
    }] as unknown as RememberedPassage[];
    const wrapper = mount(Passage, {
      props: { passages, halls: largeView().halls },
    });
    try {
      expect(wrapper.text()).toContain('A person later lost was married.');
      expect(wrapper.text()).toContain('The person died.');
      expect(wrapper.text()).toContain('the last heir');
      const buttons = wrapper.findAll('.year li button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.text()).toContain('A child of the hall was born.');
      await buttons[0]!.trigger('click');
      expect(wrapper.emitted('select')).toEqual([['p001']]);

      // Removing a person from the current halls disables navigation even
      // if their earlier line stays visible in the last turn's log.
      await wrapper.setProps({ halls: [] });
      expect(wrapper.findAll('.year li button')).toHaveLength(0);
      expect(wrapper.text()).toContain('A child of the hall was born.');
    } finally {
      wrapper.unmount();
    }
  });

  it('connects Passage navigation to the same current halls that draw the family tree', () => {
    const app = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(app).toMatch(/<PassageLog\s+:passages="passages"\s+:halls="view\.halls"\s+@select="look"/);
  });
});


function imeEscapeKey(composing: boolean, keyCode?: number): KeyboardEvent {
  const key = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(key, 'isComposing', { value: composing });
  if (keyCode !== undefined) Object.defineProperty(key, 'keyCode', { value: keyCode });
  return key;
}

describe('shared modal Escape during input-method composition (#1288)', () => {
  it('leaves the modal open when Escape cancels an IME candidate', () => {
    const close = vi.fn();
    const wrapper = mount(Line, {
      attachTo: document.body,
      props: { line: [], close },
    });
    try {
      const composing = imeEscapeKey(true);
      window.dispatchEvent(composing);
      expect(close).not.toHaveBeenCalled();
      expect(composing.defaultPrevented).toBe(false);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

      const normal = imeEscapeKey(false);
      window.dispatchEvent(normal);
      expect(normal.defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      wrapper.unmount();
    }
  });

  it('ignores the legacy IME process keycode even when isComposing is false', () => {
    const close = vi.fn();
    const wrapper = mount(Line, {
      attachTo: document.body,
      props: { line: [], close },
    });
    try {
      const ime = imeEscapeKey(false, 229);
      window.dispatchEvent(ime);
      expect(close).not.toHaveBeenCalled();
      expect(ime.defaultPrevented).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});



/** The seal history is live UI prose. A reading preference changes the words,
 * not the historical years or the Chronicle's separate persisted entries. */
describe('Plain English seal history (#410)', () => {
  it('switches guardian, death, succession and empty copy without changing their facts', async () => {
    const line = [
      { person: 'daveed', name: 'Daveed', from: 1042, to: 1080, born: 1009, died: 1080, guardian: true },
      { person: 'maren', name: 'Maren', from: 1080, to: 1110, born: 1050,
        claimedDeath: { year: 1110, cause: 'fever' } },
      { person: 'aldric', name: 'Aldric', from: 1110, born: 1085 },
    ] as unknown as ReturnType<GameActions['line']>;
    const wrapper = mount(Line, { props: { line, close: vi.fn() } });
    try {
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('who has held the seal');
      expect(wrapper.text()).toContain('born 1009 · did not die');
      expect(wrapper.text()).toContain('the book has him dying in 1110, of fever');
      expect(wrapper.text()).toContain('1110 — and holds it still');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('History of the heads of the house');
      expect(wrapper.text()).toContain('3 leaders since the house began.');
      expect(wrapper.text()).toContain("Born in 1009. Became the family's guardian spirit in 1080.");
      expect(wrapper.text()).toContain('The book says this leader died in 1110 from fever.');
      expect(wrapper.text()).toContain('Led from 1080 to 1110 (30 years).');
      expect(wrapper.text()).toContain('Leader since 1110 (still serving).');
      expect(wrapper.text()).not.toContain('and holds it still');

      await wrapper.setProps({ line: [] });
      expect(wrapper.text()).toContain('No one has led the house since it began.');
    } finally {
      wrapper.unmount();
    }
  });
});


/** A reading mode is presentation-only; it must reach descendants without
 * translating names, changing known claims, or revealing hidden attributes. */
describe('Plain English family member cards (#410)', () => {
  it('updates recursive cards and their controls when the reader changes mode', async () => {
    const founder = person({
      id: 'founder', name: 'Daveed', sex: 'male', head: true,
      spouse: { id: 'partner', name: 'Alys', marriedIn: true, house: 'House Cawdry' },
      contract: 'scribe', post: 'court adviser',
      record: {
        attrs: {}, claimedTraits: [], claimed: [], parents: {},
        claimedDeath: { year: 1100, cause: 'fever' },
      },
    });
    const heir = person({
      id: 'heir', name: 'Ronan', sex: 'female', succession: 'heir',
      parents: { father: 'founder' },
      attrs: { Resolve: 11 },
      record: {
        attrs: { Resolve: 7 }, claimed: ['Resolve'],
        claimedTraits: ['steady'], parents: { father: 'founder' },
      },
    });
    const view = {
      ...largeView(),
      attributes: [{ attr: 'Resolve', name: 'Resolve' }],
      traits: [{ trait: 'steady', name: 'Steady' }],
      halls: [{
        id: 'seat', name: 'The Seat', isSeat: true, grievance: 0,
        members: [founder, heir],
      }],
    } as unknown as SessionView;
    const wrapper = mount(Tree, {
      props: {
        view, selected: 'founder', proseMode: 'original',
        mentions: () => [{ id: 'page-1', year: 1100 }],
      },
    });
    try {
      expect(wrapper.findAll('.member')).toHaveLength(2);
      expect(wrapper.text()).toContain('married to Alys, of House Cawdry');
      expect(wrapper.text()).toContain('the book has them dying in 1100, of fever');
      expect(wrapper.text()).toContain('next to hold the seal');
      expect(wrapper.text()).toContain('Who has held the seal');
      expect(wrapper.text()).toContain('Trace a relationship from here');
      expect(wrapper.text()).toContain('holds a contract as scribe');

      await wrapper.setProps({ proseMode: 'plainenglish', selected: 'heir' });
      expect(wrapper.findAll('.member')).toHaveLength(2);
      expect(wrapper.text()).toContain('Married to Alys (from House Cawdry).');
      expect(wrapper.text()).toContain('next to lead the house');
      expect(wrapper.text()).toContain('Recorded traits: Steady');
      expect(wrapper.text()).toContain('Attribute');
      expect(wrapper.text()).toContain('Recorded');
      expect(wrapper.text()).toContain('Actual');
      expect(wrapper.get('#member-heir').text()).toContain('Resolve 7');
      expect(wrapper.get('#member-heir').text()).toContain('11');
      expect(wrapper.text()).not.toContain('next to hold the seal');

      await wrapper.setProps({ selected: 'founder' });
      expect(wrapper.text()).toContain('The book says they died in 1100 from fever.');
      expect(wrapper.text()).toContain('History of family leaders');
      expect(wrapper.text()).toContain('Show family relationships from here');
      expect(wrapper.text()).toContain('Contract: scribe');
      expect(wrapper.text()).toContain('Position: court adviser');
      expect(wrapper.text()).toContain('Chronicle pages:');
      expect(wrapper.findAll('.member')).toHaveLength(2);
      expect(wrapper.get('#member-founder').text()).toContain('Daveed');
    } finally {
      wrapper.unmount();
    }
  });

  it('shows trait-only claims without contradicting the Chronicle in either reading mode (#1468)', async () => {
    const traitOnly = person({
      id: 'trait-only', name: 'Beren',
      record: { attrs: {}, claimed: [], claimedTraits: ['steady'], parents: {} },
    });
    const undescribed = person({ id: 'undescribed', name: 'Mara' });
    const attributeOnly = person({
      id: 'attribute-only', name: 'Gavin',
      attrs: { Resolve: 11 },
      record: { attrs: { Resolve: 7 }, claimed: ['Resolve'], claimedTraits: [], parents: {} },
    });
    const view = {
      ...largeView(),
      attributes: [{ attr: 'Resolve', name: 'Resolve' }],
      traits: [{ trait: 'steady', name: 'Steady' }],
      halls: [{
        id: 'seat', name: 'The Seat', isSeat: true, grievance: 0,
        members: [traitOnly, undescribed, attributeOnly],
      }],
    } as unknown as SessionView;
    const wrapper = mount(Tree, {
      props: { view, selected: 'trait-only', proseMode: 'original' },
    });
    try {
      for (const proseMode of ['original', 'plainenglish'] as const) {
        const unknown = proseMode === 'original'
          ? 'The book has never said a word about what they were like.'
          : 'The book has not described this person.';
        await wrapper.setProps({ proseMode, selected: 'trait-only' });
        const traitCard = wrapper.get('#member-trait-only .detail');
        expect(traitCard.text()).toContain(proseMode === 'original'
          ? 'said to be Steady' : 'Recorded traits: Steady');
        expect(traitCard.text()).not.toContain(unknown);
        expect(traitCard.find('table.attrs').exists()).toBe(false);

        await wrapper.setProps({ selected: 'undescribed' });
        const blankCard = wrapper.get('#member-undescribed .detail');
        expect(blankCard.text()).toContain(unknown);
        expect(blankCard.find('table.attrs').exists()).toBe(false);

        await wrapper.setProps({ selected: 'attribute-only' });
        const attributeCard = wrapper.get('#member-attribute-only .detail');
        expect(attributeCard.get('table.attrs').text()).toContain('Resolve');
        expect(attributeCard.get('table.attrs').text()).toContain('7');
        expect(attributeCard.get('table.attrs').text()).toContain('11');
        expect(attributeCard.text()).not.toContain(unknown);
      }
    } finally {
      wrapper.unmount();
    }
  });

  it('connects the saved reader preference through App into Tree', () => {
    const app = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(app).toMatch(/<Tree\s+:view="view"\s+:selected="selected"\s+:prose-mode="accessibility\.proseMode"/);
  });
});


/**
 * The same family read model feeds the Tree and the header. The Age's
 * register is an in-world sensation, but its name and start year may be
 * withheld until the household has a name for it (#1580).
 *
 * Kept in this existing measured DOM test file while the Table's own
 * in-flight claim owns Standing.test.ts; no source or test path overlaps.
 */
describe('known Age mood and generation-question onset (#1580)', () => {
  function household(ages: SessionView['ages']): SessionView {
    return {
      year: 1127,
      campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
      generation: 4,
      house: 'house_ash',
      houseName: 'House Ash',
      seed: 47,
      treasury: 252,
      respect: 'regarded',
      discontent: 7,
      clausesRecovered: 3,
      clausesTotal: 9,
      ages,
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
      cast: [],
      attributes: [],
      traits: [],
      ambitionOptions: [],
      ascension: {
        rung: 'adept', best: 'adept', title: 'Adept', bestTitle: 'Adept',
        foremost: null,
      },
      assize: {
        pressure: 0, arm: 'indifferent', favour: false, mercy: false,
        exaction: false,
      },
    } as unknown as SessionView;
  }

  it('reads active register even when the Age name is hidden, without leaking counts or dates', async () => {
    const current = household([
      { age: 'unrevealed-a', began: 1093, register: 'cold' },
      { age: 'unrevealed-b', began: 1111, register: 'cold' },
      { age: 'named', name: 'The Painted Years', began: 1104, register: 'warm' },
      { age: 'finished', name: 'The Former Age', began: 1055, ended: 1063, register: 'institutional' },
    ]);
    const originalBytes = JSON.stringify(current);
    const wrapper = mount(Standing, {
      props: { view: current, jump: null, saveStatus: 'idle' },
    });
    try {
      const header = wrapper.get('.age');
      expect(header.get('.name').text()).toContain('The Painted Years · since 1104');
      expect(header.findAll('.age-mood').map((row) => row.text())).toEqual([
        'A coldness settles over the years.',
        'There is warmth in the years.',
      ]);
      expect(header.text()).not.toContain('unrevealed');
      expect(header.text()).not.toContain('The Former Age');
      expect(header.text()).not.toContain('1055');
      expect(header.text()).not.toContain('1093');
      expect(header.text()).not.toContain('1111');
      expect(header.text()).not.toContain('institutional');
      expect(header.text()).not.toContain('2 cold');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.findAll('.age-mood').map((row) => row.text())).toEqual([
        'These years feel cold and uncertain.',
        'These years feel warm and open.',
      ]);
      expect(header.get('.name').text()).toBe('The Painted Years · since 1104');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.findAll('.age-mood').map((row) => row.text())).toEqual([
        'A coldness settles over the years.',
        'There is warmth in the years.',
      ]);
      expect(JSON.stringify(current)).toBe(originalBytes);
    } finally {
      wrapper.unmount();
    }
  });

  it('does not reveal an ended mood and gives unnamed active Ages a reader-facing sentence', () => {
    const wrapper = mount(Standing, {
      props: {
        view: household([
          { age: 'ended', name: 'Never Show', began: 1088, ended: 1101, register: 'cold' },
          { age: 'unrevealed', began: 1119, register: 'institutional' },
        ]),
        jump: null,
        saveStatus: 'idle',
        proseMode: 'plainenglish',
      },
    });
    try {
      expect(wrapper.find('.age .name').exists()).toBe(false);
      expect(wrapper.findAll('.age-mood').map((row) => row.text())).toEqual([
        'Institutions shape these years.',
      ]);
      expect(wrapper.get('.age').text()).not.toContain('Never Show');
      expect(wrapper.get('.age').text()).not.toContain('1119');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders the public opening year on the generation question without a new engine lookup', () => {
    const app = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(app).toMatch(/v-if="view\.generationArc"[\s\S]*?\{\{ shellCopy\.generationSince \}\} \{\{ view\.generationArc\.opened \}\}/);
    expect(app).toContain('{{ view.generationArc.question }}');
  });
});


describe('person-specific branch focus accessible names (#1731)', () => {
  it('distinguishes the ancestors in both reading modes and preserves root event ids', async () => {
    const anwen = person({ id: 'anwen', name: 'Anwen' });
    const bryn = person({ id: 'bryn', name: 'Bryn',
      record: { attrs: {}, claimedTraits: [], parents: { mother: 'anwen' }, claimed: [] },
    });
    const hall = [
      anwen, bryn,
      person({ id: 'bryn-child', name: 'Bryn child',
        record: { attrs: {}, claimedTraits: [], parents: { mother: 'bryn' }, claimed: [] },
      }),
    ];
    const base = { hall, names: [], traitNames: [], selected: null, proseMode: 'original' as const };
    const first = mount(Kin, { props: { ...base, member: anwen } });
    const buttons = () => first.findAll('button.root');
    try {
      expect(first.get('button.root').text()).toBe('Only this branch ▸');
      expect(buttons().map((b) => b.text())).toEqual(['Only this branch ▸', 'Only this branch ▸']);
      expect(first.get('button.root').attributes('aria-label')).toBe('Only the branch from Anwen');
      expect(buttons()[1]!.attributes('aria-label')).toBe('Only the branch from Bryn');

      await first.setProps({ proseMode: 'plainenglish' });
      expect(first.get('button.root').text()).toBe('Show only this family branch ▸');
      expect(first.get('button.root').attributes('aria-label')).toBe("Show only Anwen's family branch");
      expect(buttons()[1]!.text()).toBe('Show only this family branch ▸');
      expect(buttons()[1]!.attributes('aria-label')).toBe("Show only Bryn's family branch");
      await first.get('button.root').trigger('click');
      await buttons()[1]!.trigger('click');
      expect(first.emitted('root')).toEqual([['anwen'], ['bryn']]);

      await first.setProps({ proseMode: 'original' });
      expect(first.get('button.root').attributes('aria-label')).toBe('Only the branch from Anwen');
      expect(buttons()[1]!.attributes('aria-label')).toBe('Only the branch from Bryn');
      expect(buttons().map((b) => b.text())).toEqual(['Only this branch ▸', 'Only this branch ▸']);
    } finally {
      first.unmount();
    }
  });
});
