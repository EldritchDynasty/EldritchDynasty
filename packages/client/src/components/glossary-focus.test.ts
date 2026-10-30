// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import GlossaryText from './GlossaryText.vue';

const mounted: Array<{ wrapper: VueWrapper; host: HTMLElement }> = [];
function render(text: string, proseMode: 'original' | 'plainenglish' = 'original'): VueWrapper {
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(GlossaryText, { attachTo: host, props: { text, proseMode } });
  mounted.push({ wrapper, host });
  return wrapper;
}
afterEach(() => {
  for (const { wrapper, host } of mounted.splice(0)) {
    wrapper.unmount();
    host.remove();
  }
});

describe('in-place Standing disclosure', () => {
  it('opens by activation and returns focus on Escape without modifying prose', async () => {
    const text = 'Standing declined, then Standing recovered.';
    const wrapper = render(text);
    expect(wrapper.findAll('button')).toHaveLength(1);
    const button = wrapper.get('button');
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).toBe(text);
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('true');
    const note = wrapper.get('[role="note"]');
    expect(note.attributes('id')).toBe(button.attributes('aria-controls'));
    (note.element as HTMLElement).focus();
    expect(document.activeElement).toBe(note.element);
    await note.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.text()).toBe(text);
  });

  it('uses the Plain English definition and leaves text with no term alone', async () => {
    const wrapper = render('Reputation is known.', 'plainenglish');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('[role="note"]').text()).toBe('How the wider world regards this family.');
    const plain = render('An unrelated chronicle line.', 'plainenglish');
    expect(plain.find('button').exists()).toBe(false);
    expect(plain.text()).toBe('An unrelated chronicle line.');
  });
});
