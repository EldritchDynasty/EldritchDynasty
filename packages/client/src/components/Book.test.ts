// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ChronicleCause, ChronicleEntry } from '@ed/core';
import Book from './Book.vue';
import Chronicle from './Chronicle.vue';

/**
 * FOLLOWING A LINK SELECTS THE PAGE IT NAMES (issue #269).
 *
 * The engine's half is in `core/src/bearing.test.ts`. What only a component
 * can get wrong is the landing: the target hidden by a search, or past the
 * panel's sixty lines, and a link that silently does nothing.
 */
beforeAll(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = () => {};
});

const entry = (id: string, year: number, text: string | null, cause?: ChronicleEntry['cause']): ChronicleEntry =>
  ({ id, year, weight: 'line', text, named: false, ...(cause ? { cause } : {}) }) as ChronicleEntry;

const BOOK = [
  entry('chr_act', 1042, 'The cousin was taken to the altar at Bramme.'),
  entry('chr_other', 1050, 'A dry year.'),
  entry('chr_echo', 1067, 'The market had not forgotten.', { year: 1042, page: 'chr_act' }),
];

function readsOver(book: ChronicleEntry[]) {
  return {
    causeOf: (id: string): ChronicleCause | undefined => {
      const c = book.find((e) => e.id === id)?.cause;
      return c ? { ...c, blank: false } : undefined;
    },
    answeredBy: (id: string) => book.filter((e) => e.cause?.page === id).map((e) => e.year),
  };
}

const mountBook = (focus?: string) => mount(Book, {
  props: { book: BOOK, ages: [], houseName: 'Gearithy', close: () => {}, actions: readsOver(BOOK), focus },
  attachTo: document.body,
});

const marked = (w: ReturnType<typeof mountBook>) =>
  w.findAll('[data-entry]').filter((el) => el.classes('marked')).map((el) => el.attributes('data-entry'));

describe('the volume', () => {
  it('draws "see {year}" on the echo and "answered in {year}" on the act', () => {
    const w = mountBook();
    expect(w.find('[data-entry="chr_echo"] button.link').text()).toBe('see 1042');
    expect(w.find('[data-entry="chr_act"]').text()).toContain('answered in 1067');
    w.unmount();
  });

  it('selects the target page when the link is followed', async () => {
    const w = mountBook();
    await w.find('[data-entry="chr_echo"] button.link').trigger('click');
    await flushPromises();
    expect(marked(w)).toEqual(['chr_act']);
    w.unmount();
  });

  it('widens a search that hides the target rather than doing nothing', async () => {
    const w = mountBook();
    await w.find('input[type="search"]').setValue('market');
    expect(w.find('[data-entry="chr_act"]').exists()).toBe(false);

    await w.find('[data-entry="chr_echo"] button.link').trigger('click');
    await flushPromises();
    expect(marked(w)).toEqual(['chr_act']);
    expect((w.find('input[type="search"]').element as HTMLInputElement).value).toBe('');
    w.unmount();
  });

  it('opens at the page it was asked to', async () => {
    const w = mountBook('chr_act');
    await flushPromises();
    expect(marked(w)).toEqual(['chr_act']);
    w.unmount();
  });
});

describe('the panel', () => {
  it('opens the volume at a page older than its window', async () => {
    // The panel's window is whatever the view hands it; the act is not in it.
    const window = [BOOK[2]!];
    const w = mount(Chronicle, {
      props: { view: { chronicle: window, campaign: { endYear: 1542 } } as never, frame: [], actions: readsOver(BOOK) },
    });
    await w.find('[data-entry="chr_echo"] button.link').trigger('click');
    await flushPromises();
    expect(w.emitted('open')).toEqual([['chr_act']]);
  });
});
