// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import Tree from './Tree.vue';
import type { MemberView } from '../lib/kin';

type HallView = SessionView['halls'][number];

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

  it('narrows every planning filter to exactly the visible fact it names', async () => {
    const view = largeView();
    const wrapper = mount(Tree, { props: { view, selected: null } });
    const rows = allMembers(view);

    const cases: [string, (row: { hall: HallView; member: MemberView }) => boolean][] = [
      ['head', ({ member }) => member.head],
      ['succession', ({ member }) => member.succession !== undefined],
      ['married', ({ member }) => member.spouse !== undefined],
      ['unmarried', ({ member }) => member.spouse === undefined],
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
});
