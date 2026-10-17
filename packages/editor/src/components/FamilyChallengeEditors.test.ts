// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { EventTemplateS, FilterS } from '@ed/schema';
import FilterBuilder from './FilterBuilder.vue';
import SlotEditor from './SlotEditor.vue';
import CheckEditor from './CheckEditor.vue';

const fixture = () => reactive(EventTemplateS.parse({
  id: 'editor_family_challenge', title: 'Family challenge', tier: 'family', frequency: 'common', body: 'A task.',
  purposes: ['test_magic_rule', 'establish_magic_rule', 'worldbuild_through_action'],
  slots: { READER: { role: 'family_member', select: { bestBy: 'life' } } },
  checks: [{ id: 'read', pool: { kind: 'family_max', attr: 'mind' }, difficulty: 50, bands: [{ atLeast: 0, outcome: 'done' }] }],
  interaction: { kind: 'choice', choices: [{ id: 'act', label: 'Act.', check: 'read', outcomes: [{ id: 'done', text: 'Done.' }] }, { id: 'wait', label: 'Wait.', outcomes: [{ id: 'waited', text: 'Waited.' }] }] },
}));

describe('family challenge authoring controls (#1796)', () => {
  it('creates and edits a knowledge filter that parses back through the schema', async () => {
    const wrapper = mount(FilterBuilder, { props: { modelValue: { knows: { affinity: 'life' } } } });
    await wrapper.get('[aria-label="Known affinity"]').setValue('darkness');
    const emitted = wrapper.emitted('update:modelValue')!.at(-1)![0];
    expect(FilterS.parse(emitted)).toEqual({ knows: { affinity: 'darkness' } });
    wrapper.unmount();
  });

  it('changes to a binary family knowledge pool, edits its affinity, and round-trips the event', async () => {
    const event = fixture();
    const wrapper = mount(CheckEditor, { props: { event } });
    const pool = wrapper.findAll('select').find((select) => select.findAll('option').some((option) => option.element.value === 'family_knows'))!;
    await pool.setValue('family_knows');
    expect(event.checks[0]!.pool).toEqual({ kind: 'family_knows', affinity: 'life' });
    expect(event.checks[0]!.variance).toBe('none');
    expect(event.checks[0]!.difficulty).toBe(1);
    await wrapper.get('[aria-label="Family known affinity"]').setValue('light');
    expect(EventTemplateS.parse(event).checks[0]!.pool).toEqual({ kind: 'family_knows', affinity: 'light' });
    await pool.setValue('family_max');
    expect(EventTemplateS.parse(event).checks[0]!.pool).toEqual({ kind: 'family_max', attr: 'strength' });
    wrapper.unmount();
  });

  it('edits the specialist selector and clears it when switching to player casting or a different role', async () => {
    const event = fixture();
    const wrapper = mount(SlotEditor, { props: { event, slots: event.slots } });
    await wrapper.get('[aria-label="Best member attribute"]').setValue('mind');
    expect(EventTemplateS.parse(event).slots.READER!.select).toEqual({ bestBy: 'mind' });
    const casting = wrapper.findAll('select').find((select) => select.findAll('option').some((option) => option.element.value === 'player'))!;
    await casting.setValue('player');
    expect(event.slots.READER!.select).toBeUndefined();
    expect(wrapper.find('[aria-label="Best member attribute"]').exists()).toBe(false);
    await casting.setValue('engine');
    await wrapper.get('[aria-label="Best member attribute"]').setValue('strength');
    const role = wrapper.findAll('select').find((select) => select.findAll('option').some((option) => option.element.value === 'head'))!;
    await role.setValue('head');
    expect(event.slots.READER!.select).toBeUndefined();
    wrapper.unmount();
  });
});
