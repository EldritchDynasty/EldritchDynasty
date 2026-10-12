// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import { landView, tableView, testWorld } from '@ed/core';
import type { GameActions } from '../lib/game';
import Table from './Table.vue';

const content = loadContent();
const bookId = 'lesser_workings_of_fluid';

function mountedShelf(condition: number, options: { treasury?: number; restoresAt?: number } = {}) {
  const ctx = testWorld(content, 1293);
  const copy = { id: bookId, acquiredYear: ctx.world.year, condition, ...options.restoresAt === undefined
    ? {} : { restoresAt: options.restoresAt } };
  ctx.world.library.set(bookId, copy);
  ctx.world.treasury = options.treasury ?? 500;
  const action = vi.fn().mockReturnValue({ ok: true });
  const wrapper = mount(Table, {
    props: {
      table: tableView(ctx),
      land: landView(ctx),
      actions: { order: action } as unknown as GameActions,
      refusal: null,
      receipt: null,
    },
  });
  const shelf = wrapper.findAll('.panel').find((p) => p.find('h3 .fold').exists() && p.find('h3 .fold').text() === 'The shelf');
  if (!shelf) throw new Error('Shelf panel not rendered');
  return { wrapper, shelf, action, ctx };
}

describe('mounted shelf binder controls (#1293)', () => {
  it('displays damaged condition, the real quote, and sends the restore order', async () => {
    const { shelf, action, ctx } = mountedShelf(40);
    const quote = tableView(ctx).shelf.find((b) => b.book === bookId)!.restore!;
    expect(shelf.text()).toContain('40%');
    expect(shelf.text()).toContain('frayed');
    const restore = shelf.findAll('button').find((b) => b.text().startsWith('Restore'));
    expect(restore).toBeDefined();
    expect(restore!.text()).toContain(`${quote.fee} crowns, ${quote.years} years`);
    expect(restore!.attributes('disabled')).toBeUndefined();
    await restore!.trigger('click');
    expect(action).toHaveBeenCalledWith({ kind: 'restore', book: bookId });
  });

  it('disables unaffordable work and shows a reason at the control', () => {
    const { shelf, action } = mountedShelf(40, { treasury: -100000 });
    const restore = shelf.findAll('button').find((b) => b.text().startsWith('Restore'));
    expect(restore).toBeDefined();
    expect(restore!.attributes('disabled')).toBeDefined();
    expect(shelf.text()).toContain('cannot raise');
    expect(action).not.toHaveBeenCalled();
  });

  it('shows the binder return year and does not offer another order', () => {
    const { shelf } = mountedShelf(40, { restoresAt: 1250 });
    expect(shelf.text()).toContain('With the binder until 1250');
    expect(shelf.findAll('button').some((b) => b.text().startsWith('Restore'))).toBe(false);
  });
});
