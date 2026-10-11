// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import { endowParcel, landView, place, tableView, testWorld } from '@ed/core';
import type { GameActions } from '../lib/game';
import Table from './Table.vue';

const bundle = loadContent();

function mountedLand() {
  const ctx = testWorld(bundle, 1219002);
  const founder = place(ctx, { name: 'A Cousin', sex: 'male', age: 30, branch: 'branch_gift' });
  ctx.world.branches.set('branch_gift' as never, {
    id: 'branch_gift', name: 'Gift Hall', house: ctx.world.playerHouse,
    founder: founder.id, splitFrom: 'main', foundedYear: ctx.world.year - 30,
    grievance: 25,
  } as never);
  const actions = { order: vi.fn(() => ({ ok: true })) } as unknown as GameActions;
  const wrapper = mount(Table, {
    props: { table: tableView(ctx), land: landView(ctx), actions, refusal: null, receipt: null },
  });
  return { ctx, actions, wrapper };
}

describe('the cadet land choice is visible on the Table (#1219)', () => {
  it('offers eligible farms, but never the caput, and submits the existing Table order', async () => {
    const { wrapper, actions } = mountedLand();
    const selector = wrapper.get('select[aria-label="Choose a cadet hall for Hallowfield"]');
    expect(selector.element.closest('.panel')?.classList.contains('idle')).toBe(false);
    expect(wrapper.find('select[aria-label="Choose a cadet hall for The Wend Mill"]').exists()).toBe(false);
    const button = wrapper.findAll('button').find((b) => b.text() === 'Endow the hall')!;
    expect(button.attributes('disabled')).toBeDefined();
    await selector.setValue('branch_gift');
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(actions.order).toHaveBeenCalledWith({
      kind: 'endow', parcel: 'hallowfield', branch: 'branch_gift',
    });
    wrapper.unmount();
  });

  it('shows the receiving hall and lets the player recall without a second picker', async () => {
    const { ctx, wrapper, actions } = mountedLand();
    expect(endowParcel(ctx, 'hallowfield', 'branch_gift').ok).toBe(true);
    await wrapper.setProps({ land: landView(ctx) });
    expect(wrapper.text()).toContain('held by Gift Hall');
    expect(wrapper.find('select[aria-label="Choose a cadet hall for Hallowfield"]').exists()).toBe(false);
    const recall = wrapper.findAll('button').find((b) => b.text() === 'Recall to the seat')!;
    await recall.trigger('click');
    expect(actions.order).toHaveBeenCalledWith({
      kind: 'endow', parcel: 'hallowfield', branch: null,
    });
    wrapper.unmount();
  });

  it('has no endowment picker when there is no active cadet hall', () => {
    const { ctx, wrapper } = mountedLand();
    ctx.world.branches.get('branch_gift' as never)!.extinct = ctx.world.year;
    return wrapper.setProps({ land: landView(ctx) }).then(() => {
      expect(wrapper.find('select[aria-label="Choose a cadet hall for Hallowfield"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
