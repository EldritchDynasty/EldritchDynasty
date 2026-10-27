// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { ProseMode } from '@ed/schema';
import type { SessionView } from '@ed/core';
import Member from './Member.vue';
import Cast from './Cast.vue';
import { ageLabel } from '../lib/age';
import { SHORTCUTS, shortcutFor, shortcutHelp } from '../lib/keys';

describe('reader shortcut explanations (#1708)', () => {
  it('preserves every displayed key and Original explanation', () => {
    expect(shortcutHelp('original')).toEqual(SHORTCUTS);
    expect(shortcutHelp('original').map((x) => x.keys)).toEqual([
      'Space', 'Enter', 'Shift + Enter', '1 – 9', 'Esc', '?',
    ]);
    expect(shortcutHelp('original').map((x) => x.does)).toEqual([
      'turn a year', 'turn a year', 'turn five', 'take that choice, or that card',
      'leave the interlude, shut the card, close this', 'this list',
    ]);
  });

  it('explains all six actions in Plain English and switches live without dispatching', () => {
    const mode = ref<ProseMode>('original');
    const descriptions = computed(() => shortcutHelp(mode.value));
    mode.value = 'plainenglish';
    expect(descriptions.value.map((x) => x.keys)).toEqual(SHORTCUTS.map((x) => x.keys));
    expect(descriptions.value.map((x) => x.does)).toEqual([
      'Advance one year', 'Advance one year', 'Advance five years',
      'Choose a numbered option or match', 'Close the current panel or dialog',
      'Show or hide this help',
    ]);
    for (const [i, original] of SHORTCUTS.entries()) {
      expect(descriptions.value[i]!.does).not.toBe(original.does);
    }
    mode.value = 'original';
    expect(descriptions.value).toEqual(SHORTCUTS);
    expect(shortcutFor({ key: 'Enter', shift: true })).toEqual({ kind: 'advance', years: 5 });
    expect(shortcutFor({ key: 'Escape' })).toEqual({ kind: 'dismiss' });
  });

  it('binds shortcuts to the live reading mode while preserving the marks legend from #1704', () => {
    const app = readFileSync('packages/client/src/App.vue', 'utf8');
    expect(app).toContain('shortcutHelp(accessibility.value.proseMode)');
    expect(app).toContain('v-for="k in readerShortcuts"');
    expect(app).toContain('v-for="m in LEGEND"');
    expect(app).toContain('markSays(m.kind, accessibility.proseMode)');
    expect(app).toContain('@click="helpOpen = !helpOpen"');
  });
});

describe('spoken age and compact visible age (#1709)', () => {
  it('announces each age in years, including 0 and singular 1', () => {
    expect(ageLabel(0)).toBe('0 years old');
    expect(ageLabel(1)).toBe('1 year old');
    expect(ageLabel(34)).toBe('34 years old');
  });

  it('keeps the family card age visible once, announces it with its unit', () => {
    const member = {
      id: 'b', name: 'Bea', sex: 'female', age: 1, status: 'alive',
      head: false, awakened: false, expresses: false, madness: 0, drift: false,
      parents: { mother: null, father: null }, attrs: {},
      record: { attrs: {}, claimed: [], claimedTraits: [], parents: { mother: null, father: null } },
    } as unknown as SessionView['halls'][number]['members'][number];
    const w = mount(Member, { props: { member, names: [], traitNames: [], open: false, proseMode: 'plainenglish' } });
    try {
      expect(w.find('.marks .said-not-shown').text()).toContain('woman');
      expect(w.findAll('.marks .said-not-shown').map((x) => x.text())).toContain('1 year old');
      expect(w.findAll('.marks [aria-hidden="true"]').map((x) => x.text())).toContain('1');
    } finally { w.unmount(); }
  });

  it('announces the same age on the cast list without changing selection behavior', async () => {
    const cast = [{
      person: 'p1', name: 'Bela', sex: 'male', age: 34, hall: 'The Hall',
      label: 'House head', because: 'The family needs a decision.',
    }] as unknown as SessionView['cast'];
    const w = mount(Cast, { props: { cast, selected: null, proseMode: 'original' } });
    try {
      expect(w.findAll('.who .said-not-shown').map((x) => x.text())).toEqual(['man,', '34 years old']);
      expect(w.findAll('.who [aria-hidden="true"]').map((x) => x.text())).toContain('34');
      await w.get('button.row').trigger('click');
      expect(w.emitted('select')?.[0]).toEqual(['p1']);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.findAll('.who .said-not-shown').map((x) => x.text())).toContain('34 years old');
    } finally { w.unmount(); }
  });
});

describe('family-card disclosure relationships (#1751)', () => {
  it('only names an aria-controls target when its detail element is present', async () => {
    const member = {
      id: 'p1', name: 'Alys', sex: 'female', age: 30, status: 'alive',
      head: false, awakened: false, expresses: false, madness: 0, drift: false,
      attrs: {}, parents: {},
      record: { attrs: {}, claimedTraits: [], parents: {}, claimed: [] },
    } as unknown as SessionView['halls'][number]['members'][number];
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
      expect(wrapper.get('#detail-p1').text()).toContain('No attributes or traits are recorded.');

      await wrapper.setProps({ open: false, proseMode: 'original' });
      expect(face().attributes('aria-expanded')).toBe('false');
      expect(face().attributes('aria-controls')).toBeUndefined();
      expect(wrapper.find('#detail-p1').exists()).toBe(false);
      expect(member).toEqual(snapshot);
      expect(wrapper.emitted('select')).toEqual([['p1']]);
    } finally { wrapper.unmount(); }
  });
});
