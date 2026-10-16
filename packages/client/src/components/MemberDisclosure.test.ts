// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SessionView } from '@ed/core';
import Member from './Member.vue';

type MemberView = SessionView['halls'][number]['members'][number];

describe('family-card disclosure relationships (#1751)', () => {
  it('only names an aria-controls target when its detail element is present', async () => {
    const member = {
      id: 'p1', name: 'Alys', sex: 'female', age: 30, status: 'alive',
      head: false, awakened: false, expresses: false, madness: 0, drift: false,
      attrs: {}, parents: {},
      record: { attrs: {}, claimedTraits: [], parents: {}, claimed: [] },
    } as unknown as MemberView;
    const snapshot = structuredClone(member);
    const wrapper = mount(Member, {
      props: { member, names: [], traitNames: [], open: false, proseMode: 'original' },
    });
    const face = () => wrapper.get('button.face');
    try {
      expect(face().attributes('aria-expanded')).toBe('false');
      expect(face().attributes('aria-controls')).toBeUndefined();
      expect(wrapper.find('#detail-p1').exists()).toBe(false);

      await face().trigger('click');
      expect(wrapper.emitted('select')).toEqual([['p1']]);
      // Selection is owned by Tree/App; the emitted event alone does not
      // fabricate the controlled detail until the parent supplies open=true.
      expect(wrapper.find('#detail-p1').exists()).toBe(false);

      await wrapper.setProps({ open: true });
      expect(face().attributes('aria-expanded')).toBe('true');
      expect(face().attributes('aria-controls')).toBe('detail-p1');
      expect(wrapper.find('#detail-p1').exists()).toBe(true);

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(face().attributes('aria-controls')).toBe('detail-p1');
      expect(wrapper.get('#detail-p1').text()).toContain('The book has not described this person.');

      await wrapper.setProps({ open: false, proseMode: 'original' });
      expect(face().attributes('aria-expanded')).toBe('false');
      expect(face().attributes('aria-controls')).toBeUndefined();
      expect(wrapper.find('#detail-p1').exists()).toBe(false);
      expect(member).toEqual(snapshot);
      expect(wrapper.emitted('select')).toEqual([['p1']]);
    } finally { wrapper.unmount(); }
  });
});
