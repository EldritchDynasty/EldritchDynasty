// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import NewItem from './NewItem.vue';

const h = vi.hoisted(() => ({
  createItem: vi.fn(),
  filesHolding: vi.fn(),
}));

vi.mock('../lib/store', () => ({
  createItem: h.createItem,
  filesHolding: h.filesHolding,
}));

beforeEach(() => {
  vi.resetAllMocks();
  h.filesHolding.mockReturnValue(['events/fixtures.yaml']);
});

async function openWithName(name: string) {
  const wrapper = mount(NewItem, {
    props: { collectionKey: 'events', seed: (id: string) => ({ id }) },
  });
  await wrapper.get('button').trigger('click');
  await wrapper.get('input').setValue(name);
  return wrapper;
}

describe('new editor item selection (#1309)', () => {
  it('emits the submitted normalized ID after a successful asynchronous save', async () => {
    h.createItem.mockResolvedValue({ ok: true });
    const wrapper = await openWithName('  North-Keep  ');

    await wrapper.findAll('button').find((b) => b.text() === 'create')!.trigger('click');
    await flushPromises();

    expect(h.createItem).toHaveBeenCalledOnce();
    expect(h.createItem).toHaveBeenCalledWith(
      'events', 'events/fixtures.yaml', { id: 'north_keep' },
    );
    // The parent editors select precisely this ID; emitting the cleared
    // computed cleanId here silently deselects the newly created item.
    expect(wrapper.emitted('created')).toEqual([['north_keep']]);
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('keeps a failed submission editable and emits only after retry succeeds', async () => {
    h.createItem.mockResolvedValueOnce({ ok: false, error: 'disk refused' })
      .mockResolvedValueOnce({ ok: true });
    const wrapper = await openWithName('Retry-This');

    await wrapper.findAll('button').find((b) => b.text() === 'create')!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('created')).toBeUndefined();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Retry-This');
    expect(wrapper.text()).toContain('disk refused');

    await wrapper.findAll('button').find((b) => b.text() === 'create')!.trigger('click');
    await flushPromises();

    expect(h.createItem).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('created')).toEqual([['retry_this']]);
  });
});
