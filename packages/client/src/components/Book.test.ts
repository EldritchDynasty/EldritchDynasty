// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ChronicleCause, ChronicleEntry, EpilogueView, SessionView } from '@ed/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameEntry } from '@ed/schema';
import type { GameActions } from '../lib/game';
import Interlude from './Interlude.vue';
import Book from './Book.vue';
import Entry from './Entry.vue';
import Abroad from './Abroad.vue';
import Chronicle from './Chronicle.vue';
import Ending from './Ending.vue';
import { downloadBlob } from '../lib/download';
import { afterimageName, plateName } from '../lib/book';

// Export tests assert actual download calls without relying on jsdom blob URL support.
vi.mock('../lib/download', () => ({ downloadBlob: vi.fn() }));

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
    advice: () => [],
  };
}

const mountBook = (focus?: string) => mount(Book, {
  props: { book: BOOK, ages: [], houseName: 'Gearithy', close: () => {}, actions: readsOver(BOOK), focus },
  attachTo: document.body,
});

const marked = (w: ReturnType<typeof mountBook>) =>
  w.findAll('[data-entry]').filter((el) => el.classes('marked')).map((el) => el.attributes('data-entry'));

describe('the volume', () => {
  it('switches Chronicle controls to Plain English without changing saved pages or filters (#410)', async () => {
    const saved = structuredClone(BOOK);
    const w = mountBook();
    try {
      expect(w.get('[role="dialog"]').attributes('aria-label')).toBe('the chronicle, whole');
      expect(w.text()).toContain('The whole book');
      expect(w.text()).toContain('Save this as a page');
      expect(w.text()).toContain('The market had not forgotten.');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="dialog"]').attributes('aria-label')).toBe('Full Chronicle');
      expect(w.text()).toContain('All entries');
      expect(w.text()).toContain('Blank entries');
      expect(w.text()).toContain('Changed entries');
      expect(w.text()).toContain('Highlighted entries');
      expect(w.text()).toContain('Save an image');
      expect(w.get('label[for="chronicle-book-search"]').text()).toBe('Search the Chronicle');
      expect(w.get('input[type="search"]').attributes('placeholder')).toBe('Search by name or word');
      expect(w.text()).toContain('The market had not forgotten.');

      await w.get('input[type="search"]').setValue('no such page');
      expect(w.text()).toContain('No Chronicle entries match.');
      await w.get('input[type="search"]').setValue('market');
      expect(w.text()).toContain('The market had not forgotten.');
      expect(w.text()).not.toContain('A dry year.');
      expect(BOOK).toEqual(saved);

      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('The whole book');
      expect(w.text()).toContain('Save this as a page');
      expect(w.text()).toContain('The market had not forgotten.');
      expect(BOOK).toEqual(saved);
    } finally {
      w.unmount();
    }
  });

  it('explains the same export failure in either mode without changing the error state (#410)', async () => {
    const noCanvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const w = mountBook();
    try {
      await w.setProps({ proseMode: 'plainenglish' });
      const save = w.findAll('button').find((button) => button.text() === 'Save an image');
      expect(save).toBeDefined();
      await save!.trigger('click');
      expect(w.get('[role="alert"]').text()).toContain('Could not save the image.');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('[role="alert"]').text()).toContain('The page could not be saved');
    } finally {
      w.unmount();
      noCanvas.mockRestore();
    }
  });

  it('explains an unavailable canvas instead of silently dropping page export (#1327)', async () => {
    const noCanvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const w = mountBook();
    try {
      const save = w.findAll('button').find((button) => button.text() === 'Save this as a page');
      expect(save).toBeDefined();
      await save!.trigger('click');
      await flushPromises();

      expect(w.get('[role="alert"]').text()).toContain('The page could not be saved');
      expect((save!.element as HTMLButtonElement).disabled).toBe(false);
    } finally {
      w.unmount();
      noCanvas.mockRestore();
    }
  });

  it('catches browser canvas exceptions instead of rejecting a save click (#1327)', async () => {
    const brokenCanvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => { throw new Error('Canvas allocation blocked'); });
    const w = mountBook();
    try {
      const save = w.findAll('button').find((button) => button.text() === 'Save this as a page');
      expect(save).toBeDefined();
      await save!.trigger('click');
      await flushPromises();

      expect(w.get('[role="alert"]').text()).toContain('The page could not be saved');
      expect((save!.element as HTMLButtonElement).disabled).toBe(false);
    } finally {
      w.unmount();
      brokenCanvas.mockRestore();
    }
  });

  it('explains PNG encoding failure and returns the save button to usable state (#1327)', async () => {
    const context = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {}, fillText: () => {}, beginPath: () => {},
      moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(null));
    const w = mountBook();
    try {
      const save = w.findAll('button').find((button) => button.text() === 'Save this as a page');
      expect(save).toBeDefined();
      await save!.trigger('click');
      await flushPromises();

      expect(w.get('[role="alert"]').text()).toContain('Try a smaller selection or another browser');
      expect((save!.element as HTMLButtonElement).disabled).toBe(false);
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
    }
  });

  it('keeps the downloaded PNG named for the drawn house when props change during encoding (#1495)', async () => {
    const painted: string[] = [];
    const context = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {},
      fillText: (text: string) => { painted.push(text); },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const callbacks: BlobCallback[] = [];
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { callbacks.push(callback); });
    const download = vi.mocked(downloadBlob);
    download.mockClear();
    const w = mountBook();
    try {
      const save = w.findAll('button').find((button) => button.text() === 'Save this as a page');
      expect(save).toBeDefined();
      await save!.trigger('click');

      // Canvas text was drawn before encoding completed, with the original name.
      expect(painted).toContain('Gearithy');
      expect(callbacks).toHaveLength(1);
      expect(download).not.toHaveBeenCalled();

      // A reused volume can display another house while the first PNG is pending.
      await w.setProps({ houseName: 'Ash' });
      callbacks[0]!(new Blob(['Gearithy page'], { type: 'image/png' }));
      await flushPromises();

      expect(download).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledWith(expect.any(Blob), plateName('Gearithy', BOOK));
      expect(download).not.toHaveBeenCalledWith(expect.any(Blob), plateName('Ash', BOOK));
      expect(save!.attributes('disabled')).toBeUndefined();
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      download.mockClear();
    }
  });

  it('starts only one plate export for two clicks before Vue disables the button (#1478)', async () => {
    const context = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {}, fillText: () => {}, beginPath: () => {},
      moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const callbacks: BlobCallback[] = [];
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { callbacks.push(callback); });
    const download = vi.mocked(downloadBlob);
    download.mockClear();
    const w = mountBook();
    try {
      const save = w.findAll('button').find((button) => button.text() === 'Save this as a page');
      expect(save).toBeDefined();
      const button = save!.element as HTMLButtonElement;

      // Both events run synchronously, before Vue patches :disabled.
      button.click();
      button.click();
      expect(encoding).toHaveBeenCalledTimes(1);
      await flushPromises();
      expect(button.disabled).toBe(true);
      expect(save!.text()).toContain('Setting the plate');
      expect(download).not.toHaveBeenCalled();

      callbacks[0]!(new Blob(['page'], { type: 'image/png' }));
      await flushPromises();
      expect(download).toHaveBeenCalledTimes(1);
      expect(button.disabled).toBe(false);

      // The guard unlocks for a failed attempt, preserving the error.
      button.click();
      expect(encoding).toHaveBeenCalledTimes(2);
      callbacks[1]!(null);
      await flushPromises();
      expect(w.get('[role="alert"]').text()).toContain('The page could not be saved');
      expect(button.disabled).toBe(false);
      expect(download).toHaveBeenCalledTimes(1);

      // Retry also clears the old error and saves a single new page.
      button.click();
      expect(encoding).toHaveBeenCalledTimes(3);
      callbacks[2]!(new Blob(['retry'], { type: 'image/png' }));
      await flushPromises();
      expect(download).toHaveBeenCalledTimes(2);
      expect(download).toHaveBeenLastCalledWith(expect.any(Blob), expect.stringMatching(/\.png$/));
      expect(button.disabled).toBe(false);
      expect(w.find('[role="alert"]').exists()).toBe(false);
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      download.mockClear();
    }
  });

  it('associates the search input with a label without nesting the clear button (#1173)', async () => {
    const w = mountBook();
    try {
      const search = w.get('input[type="search"]').element as HTMLInputElement;
      const label = w.get('label[for="chronicle-book-search"]').element as HTMLLabelElement;
      expect(Array.from(search.labels ?? [])).toContain(label);

      await w.get('input[type="search"]').setValue('market');
      expect(w.find('[data-entry="chr_act"]').exists()).toBe(false);

      const clear = w.get('.find button');
      expect(label.contains(clear.element), 'another interactive control cannot live inside an input label')
        .toBe(false);
      await clear.trigger('click');
      expect(search.value).toBe('');
      expect(w.find('[data-entry="chr_act"]').exists()).toBe(true);
    } finally {
      w.unmount();
    }
  });

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
    const target = w.get('[data-entry="chr_act"]');
    expect(target.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(target.element);
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
    expect(document.activeElement).toBe(w.get('[data-entry="chr_act"]').element);
    w.unmount();
  });

  it('opens at the page it was asked to', async () => {
    const w = mountBook('chr_act');
    await flushPromises();
    expect(marked(w)).toEqual(['chr_act']);
    expect(document.activeElement).toBe(w.get('[data-entry="chr_act"]').element);
    w.unmount();
  });

  it('clears the outstanding page-highlight timeout when the volume closes (#1299)', async () => {
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const w = mountBook('chr_act');
    let unmounted = false;
    try {
      await flushPromises();
      expect(marked(w)).toEqual(['chr_act']);
      const timerIndex = scheduled.mock.calls.findIndex((args) => args[1] === 2400);
      expect(timerIndex, 'the follow highlight must have a timed expiry').toBeGreaterThanOrEqual(0);
      const handle = scheduled.mock.results[timerIndex]!.value;
      w.unmount();
      unmounted = true;
      expect(cleared).toHaveBeenCalledWith(handle);
    } finally {
      if (!unmounted) w.unmount();
      cleared.mockRestore();
      scheduled.mockRestore();
    }
  });

  it('does not scroll to a Chronicle page after its volume was closed mid-follow (#1299)', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const w = mountBook('chr_act');
    let unmounted = false;
    try {
      // onMounted starts follow(), then yields at nextTick before scrolling.
      w.unmount();
      unmounted = true;
      await flushPromises();
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      if (!unmounted) w.unmount();
      scrolled.mockRestore();
    }
  });

  it('follows a changed focus prop without remounting the volume (#1126)', async () => {
    const w = mountBook('chr_act');
    try {
      await flushPromises();
      expect(marked(w)).toEqual(['chr_act']);

      // The new target is hidden by the active search. The prop must use the
      // same widening + focus path as clicking a causal backlink.
      await w.find('input[type="search"]').setValue('market');
      expect(w.find('[data-entry="chr_other"]').exists()).toBe(false);
      await w.setProps({ focus: 'chr_other' });
      await flushPromises();
      expect((w.get('input[type="search"]').element as HTMLInputElement).value).toBe('');
      expect(marked(w)).toEqual(['chr_other']);
      expect(document.activeElement).toBe(w.get('[data-entry="chr_other"]').element);

      // Clearing the optional focus target is not a navigation request.
      await w.setProps({ focus: undefined });
      await flushPromises();
      expect(marked(w)).toEqual(['chr_other']);

      // A later explicit target works after the caller clears the prop.
      await w.setProps({ focus: 'chr_act' });
      await flushPromises();
      expect(marked(w)).toEqual(['chr_act']);
      expect(document.activeElement).toBe(w.get('[data-entry="chr_act"]').element);
    } finally {
      w.unmount();
    }
  });

  it('keeps the last target focused when two cause links fire in one tick', async () => {
    const book = [...BOOK, entry('chr_extra', 1072, 'One more reckoning.', { year: 1050, page: 'chr_other' })];
    const w = mount(Book, {
      props: { book, ages: [], houseName: 'Gearithy', close: () => {}, actions: readsOver(book) },
      attachTo: document.body,
    });
    try {
      (w.get('[data-entry="chr_echo"] button.link').element as HTMLButtonElement).click();
      (w.get('[data-entry="chr_extra"] button.link').element as HTMLButtonElement).click();
      await flushPromises();
      expect(w.get('[data-entry="chr_other"]').attributes('tabindex')).toBe('-1');
      expect(w.get('[data-entry="chr_act"]').attributes('tabindex')).toBeUndefined();
      expect(document.activeElement).toBe(w.get('[data-entry="chr_other"]').element);
    } finally {
      w.unmount();
    }
  });
});

describe('the panel', () => {
  it('clears the panel highlight timer when switching panes (#1299)', async () => {
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const w = mount(Chronicle, {
      props: {
        view: { chronicle: BOOK, campaign: { endYear: 1542 } } as never,
        frame: [],
        actions: readsOver(BOOK),
      },
      attachTo: document.body,
    });
    let unmounted = false;
    try {
      await w.get('[data-entry="chr_echo"] button.link').trigger('click');
      await flushPromises();
      const timerIndex = scheduled.mock.calls.findIndex((args) => args[1] === 2400);
      expect(timerIndex, 'the panel highlight must expire after the follow').toBeGreaterThanOrEqual(0);
      const handle = scheduled.mock.results[timerIndex]!.value;
      w.unmount();
      unmounted = true;
      expect(cleared).toHaveBeenCalledWith(handle);
    } finally {
      if (!unmounted) w.unmount();
      cleared.mockRestore();
      scheduled.mockRestore();
    }
  });

  it('does not focus a panel entry after switching away mid-follow (#1299)', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const w = mount(Chronicle, {
      props: {
        view: { chronicle: BOOK, campaign: { endYear: 1542 } } as never,
        frame: [],
        actions: readsOver(BOOK),
      },
      attachTo: document.body,
    });
    let unmounted = false;
    try {
      (w.get('[data-entry="chr_echo"] button.link').element as HTMLButtonElement).click();
      w.unmount();
      unmounted = true;
      await flushPromises();
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      if (!unmounted) w.unmount();
      scrolled.mockRestore();
    }
  });

  it('dates each frame interlude at its real year instead of the campaign end (#1283)', () => {
    const frame = [
      { eventId: 'the_first_whisper', year: 1108, text: 'The first account was heard.' },
      { eventId: 'the_later_answer', year: 1214, text: 'Another account answered it.' },
    ] as FrameEntry[];
    const w = mount(Chronicle, {
      props: {
        view: { chronicle: [], campaign: { endYear: 1542 } } as never,
        frame,
        actions: readsOver([]),
      },
    });
    try {
      expect(w.get('.frame-label').text()).toBe('The frame');
      const entries = w.findAll('.entry.frame');
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.get('.frame-year').text())).toEqual(['1108', '1214']);
      expect(entries[0]!.text()).toContain('The first account was heard.');
      expect(entries[1]!.text()).toContain('Another account answered it.');
      expect(w.text()).not.toContain('1542');
    } finally {
      w.unmount();
    }
  });

  it('keeps historical cast named without offering an unreachable link (#1077)', async () => {
    const page = { ...entry('chr_dead', 1067, 'Her name remains on the page.'), people: ['per_dead', 'per_alive'] };
    const w = mount(Chronicle, {
      props: {
        view: {
          chronicle: [page],
          chroniclePeople: [
            { id: 'per_dead', name: 'Mara' },
            { id: 'per_alive', name: 'Nora' },
          ],
          halls: [{ members: [{ id: 'per_alive', name: 'Nora' }] }],
          campaign: { endYear: 1542 },
        } as never,
        frame: [],
        actions: readsOver([page]),
      },
    });
    try {
      const historical = w.get('[data-person-history="per_dead"]');
      expect(historical.text()).toContain('Mara');
      expect(historical.text()).toContain('not in a living hall');
      expect(w.find('button[data-person="per_dead"]').exists()).toBe(false);

      const living = w.get('button[data-person="per_alive"]');
      expect(living.text()).toBe('Nora');
      await living.trigger('click');
      expect(w.emitted('person')).toEqual([['per_alive']]);
    } finally {
      w.unmount();
    }
  });

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

/** Modal focus regression reuses a measured component suite: adding a new
 * suite would exceed the checked unmeasured-duration budget (lanes.test.ts). */
describe('Interlude keyboard focus (#937)', () => {
  it('brings forward and reverse Tab back inside when focus escapes the modal', () => {
    // Model a keyboard/extension focus move to the board behind the scrim.
    const outside = document.createElement('button');
    outside.textContent = 'board action';
    document.body.appendChild(outside);

    // The component restores focus on an animation frame during unmount.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const dismissInterlude = vi.fn();
    const wrapper = mount(Interlude, {
      attachTo: document.body,
      props: {
        entry: { text: 'The book opens.' } as unknown as FrameEntry,
        actions: { dismissInterlude } as unknown as GameActions,
      },
    });
    try {
      const goOn = wrapper.get('.interlude button').element as HTMLButtonElement;
      expect(document.activeElement).toBe(goOn);

      for (const shiftKey of [false, true]) {
        outside.focus();
        expect(document.activeElement).toBe(outside);

        const key = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(key);

        expect(key.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(goOn);
      }
      expect(dismissInterlude).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      outside.remove();
      vi.unstubAllGlobals();
    }
  });
});


/** Keep the export-failure UI regression in this measured component suite. */
describe('house afterimage export failure (#1141)', () => {
  function mountEnding() {
    return mount(Ending, {
      props: {
        view: {
          houseName: 'House Salt', seed: 123,
          campaign: { name: 'A Long Line', startYear: 1042 },
        } as never,
        epilogue: {
          year: 1542,
          title: 'The last account',
          summary: 'The house reached the table.',
          opening: 'One final reading.',
          read: [],
          ring: [],
          closing: 'The book was shut.',
          reckoning: {
            pages: 0, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
            clauses: 0, clausesTotal: 9, attested: 'none', livingBlood: 0,
            rungsWithheld: 0,
          },
        } as never,
        actions: { restart: vi.fn() } as unknown as GameActions,
      },
    });
  }

  it('reports an unavailable canvas instead of silently doing nothing, and permits retry', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const wrapper = mountEnding();
    try {
      const save = wrapper.get('.ending-actions button');
      await save.trigger('click');
      await flushPromises();
      expect(wrapper.get('.afterimage-error[role="alert"]').text()).toContain('could not be saved');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.afterimage-error[role="alert"]').text()).toBe('Could not save the ending image. Try again.');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.get('.afterimage-error[role="alert"]').text()).toContain('could not be saved');
      expect(save.attributes('disabled')).toBeUndefined();
      await save.trigger('click');
      await flushPromises();
      expect(canvas).toHaveBeenCalledTimes(2);
      expect(wrapper.get('.afterimage-error[role="alert"]').text()).toContain('could not be saved');
    } finally {
      wrapper.unmount();
      canvas.mockRestore();
    }
  });

  it('catches a canvas exception without an unhandled rejection', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('rendering unavailable');
    });
    const wrapper = mountEnding();
    try {
      await wrapper.get('.ending-actions button').trigger('click');
      await flushPromises();
      expect(wrapper.get('.afterimage-error[role="alert"]').text()).toContain('could not be saved');
      expect(wrapper.get('.ending-actions button').attributes('disabled')).toBeUndefined();
    } finally {
      wrapper.unmount();
      canvas.mockRestore();
    }
  });
});

/** Keep the asynchronous naming regression in the measured export component suite. */
describe('house afterimage filename snapshot (#1508)', () => {
  it('names the encoded PNG for the house actually painted, even if view props change mid-export', async () => {
    const painted: string[] = [];
    const context = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {},
      fillText: (text: string) => { painted.push(text); },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const encodings: BlobCallback[] = [];
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { encodings.push(callback); });
    const download = vi.mocked(downloadBlob);
    download.mockClear();
    const w = mount(Ending, {
      props: {
        view: {
          houseName: 'House Salt', seed: 123,
          campaign: { name: 'A Long Line', startYear: 1042 },
        } as never,
        epilogue: {
          year: 1542, title: 'The last account', summary: 'The house reached the table.',
          opening: 'One final reading.', read: [], ring: [], closing: 'The book was shut.',
          reckoning: {
            pages: 0, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
            clauses: 0, clausesTotal: 9, attested: 'none', livingBlood: 0,
            rungsWithheld: 0,
          },
        } as never,
        actions: { restart: vi.fn() } as unknown as GameActions,
      },
    });
    try {
      const save = w.get('.ending-actions button');
      await save.trigger('click');
      expect(painted).toContain('House Salt');
      expect(encodings).toHaveLength(1);
      expect(download).not.toHaveBeenCalled();

      // The old PNG is still encoding when another house replaces the view.
      await w.setProps({
        view: {
          houseName: 'House Ash', seed: 456,
          campaign: { name: 'A Long Line', startYear: 1042 },
        } as never,
      });
      encodings[0]!(new Blob(['House Salt image'], { type: 'image/png' }));
      await flushPromises();

      expect(download).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledWith(expect.any(Blob), afterimageName('House Salt', 123, 1542));
      expect(download).not.toHaveBeenCalledWith(expect.any(Blob), afterimageName('House Ash', 456, 1542));
      expect(save.attributes('disabled')).toBeUndefined();
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      download.mockClear();
    }
  });
});

/** Abroad's prose selector shares this mounted counter-record test lane. */
function abroadView(): SessionView {
  return {
    tales: [
      {
        id: 'first', about: 'one-night', text: 'One witness saw the open gate.',
        form: 'letter', teller: 'Ada', since: 1180, mutations: 2,
        bias: 'Favourable to the house',
      },
      {
        id: 'second', about: 'one-night', text: 'Another witness says the gate was shut.',
        form: 'rumour', teller: 'Bea', since: 1181, mutations: 0,
        bias: 'Hostile to the house',
      },
    ],
    looseSecrets: [
      { secret: 'gate', carrier: 'Cora', houseName: 'House Ash', since: 1182 },
      { secret: 'letter', carrier: 'Dora', houseName: 'House Birch', since: 1183, told: 1186 },
    ],
    marriagePromises: [
      { year: 1190, houseName: 'House Elm', lotName: 'A Book of Hours' },
    ],
  } as unknown as SessionView;
}

describe('Abroad counter-record in the reader\'s prose mode (#1313)', () => {
  it('keeps the existing Original register and all of the two-account evidence', () => {
    const wrapper = mount(Abroad, { props: { view: abroadView() } });
    const text = wrapper.text();

    expect(text).toContain('What else is being said');
    expect(text).toContain('Two accounts of the same thing. Neither of them is the record.');
    expect(text).toContain('retold 2 times, and it has moved');
    expect(text).toContain('Cora walked out with it in 1182, and House Ash have had it since.');
    expect(text).toContain('It is still only theirs.');
    expect(text).toContain('Told, in 1186. It is a thing that can be proved now.');
    expect(text).toContain('A daughter of this house, unborn in 1190, promised to House Elm for A Book of Hours.');
    expect(wrapper.findAll('.tale')).toHaveLength(2);
    expect(wrapper.findAll('.account')).toHaveLength(1);
    expect(wrapper.findAll('.tale').map((tale) => tale.find('.text').text())).toEqual([
      'One witness saw the open gate.',
      'Another witness says the gate was shut.',
    ]);
    wrapper.unmount();
  });

  it('switches live to Plain English without changing either account or its order', async () => {
    const view = abroadView();
    const wrapper = mount(Abroad, { props: { view, proseMode: 'original' } });
    await wrapper.setProps({ proseMode: 'plainenglish' });
    const text = wrapper.text();

    expect(text).toContain('What other people say');
    expect(text).toContain('Two accounts describe the same event. Neither is the official record.');
    expect(text).toContain('retold 2 times; the story has changed');
    expect(text).toContain('Cora took this secret to House Ash in 1182.');
    expect(text).toContain('Only that house has the secret so far.');
    expect(text).toContain('Shared in 1186. It can now be proved.');
    expect(text).toContain('In 1190, the house promised a future daughter to House Elm in exchange for A Book of Hours.');
    expect(text).not.toContain('Nothing about this family has got far enough to be repeated.');
    expect(wrapper.findAll('.tale').map((tale) => tale.find('.text').text())).toEqual(view.tales.map((tale) => tale.text));
    expect(wrapper.findAll('.account')).toHaveLength(1);

    await wrapper.setProps({ proseMode: 'original' });
    expect(wrapper.text()).toContain('What else is being said');
    wrapper.unmount();
  });

  it('provides plain empty-state explanations with no invented tales or pledges', () => {
    const view = { ...abroadView(), tales: [], looseSecrets: [], marriagePromises: [] };
    const wrapper = mount(Abroad, { props: { view, proseMode: 'plainenglish' } });

    expect(wrapper.text()).toContain('Nobody has shared a story about this family yet.');
    expect(wrapper.text()).toContain('No secrets are known to have left the house.');
    expect(wrapper.text()).toContain('No future daughters have been promised in marriage.');
    expect(wrapper.findAll('.tale')).toHaveLength(0);
    expect(wrapper.findAll('.promise')).toHaveLength(0);
    wrapper.unmount();
  });

  it('receives the reader-local preference from App rather than from the saved world', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/src/App.vue'), 'utf8');
    expect(source).toContain('<Abroad v-else-if="middle === \'abroad\'" :view="view" :prose-mode="accessibility.proseMode" />');
  });
});


describe('reader-local Chronicle annotations (#1434)', () => {
  const retainedPage: ChronicleEntry = {
    id: 'chr_retained', year: 1174, weight: 'page', named: true,
    title: 'The words once written', text: 'The gate stood open through the winter.',
    claims: [{ kind: 'attr', person: 'p_claim', attr: 'physical_strength', value: 52 }],
    delegated: 'record:record',
  };

  it('changes annotations in the Chronicle panel without changing its saved page or frame', async () => {
    const page = structuredClone(retainedPage);
    const saved = structuredClone(page);
    const wrapper = mount(Chronicle, {
      props: {
        view: { chronicle: [page], campaign: { endYear: 1542 } } as SessionView,
        frame: [{ eventId: 'the_first_whisper', year: 1180, text: 'The first account was heard.' }] as FrameEntry[],
        actions: readsOver([page]),
      },
    });
    try {
      const original = wrapper.text();
      expect(original).toContain('that their physical strength stood at 52');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('The record says their physical strength was 52.');
      expect(wrapper.text()).toContain('usual choice: write down what happened');
      expect(wrapper.text()).toContain(page.title);
      expect(wrapper.text()).toContain(page.text);
      expect(wrapper.text()).toContain('The first account was heard.');
      expect(page).toEqual(saved);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
    } finally {
      wrapper.unmount();
    }
  });

  it('uses the current reader mode for the last-night reading without rewriting the epilogue', async () => {
    const epilogue: EpilogueView = {
      id: 'broken_line', year: 1542, title: 'The last account', summary: 'The house reached the table.',
      opening: 'One final reading.', read: [structuredClone(retainedPage)], ring: [],
      thesis: 'The record remains.', closing: 'The book was shut.',
      reckoning: {
        pages: 1, blanks: 0, recorded: 1, embellished: 0, standingLies: 0, provenLies: 0,
        clauses: 0, clausesTotal: 9, attested: 'none', attestedTitle: 'None', livingBlood: 0,
        unsupportable: 0, rungsWithheld: 0, substantiated: 'none', substantiatedTitle: 'None',
      },
    };
    const saved = structuredClone(epilogue);
    const restart = vi.fn();
    const wrapper = mount(Ending, {
      props: {
        view: { houseName: 'House Salt', seed: 123, campaign: { name: 'A Long Line', startYear: 1042 } } as SessionView,
        epilogue, actions: { restart } as unknown as GameActions,
      },
    });
    try {
      const original = wrapper.text();
      expect(original).toContain('that their physical strength stood at 52');
      expect(wrapper.get('.read .top button').text()).toBe('Read it whole');
      expect(wrapper.get('.tally h3').text()).toBe('The reckoning');
      expect(wrapper.get('.ring h3').text()).toBe('A debt of three parts');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.read').text()).toContain('The record says their physical strength was 52.');
      expect(wrapper.get('.read').text()).toContain(retainedPage.title);
      expect(wrapper.get('.read').text()).toContain(retainedPage.text);
      expect(wrapper.text()).not.toContain('usual choice:');
      expect(wrapper.get('.read .top span').text()).toBe('Chronicle excerpts');
      expect(wrapper.get('.read .top button').text()).toBe('Read full Chronicle');
      expect(wrapper.get('.tally h3').text()).toBe('Ending summary');
      expect(wrapper.get('.ring h3').text()).toBe('Three promises');
      expect(wrapper.findAll('.ending-actions button')[0]!.text()).toBe('Save ending image');
      expect(wrapper.findAll('.ending-actions button')[1]!.text()).toBe('Start another house');
      expect(wrapper.text()).toContain('The house reached the table.');
      expect(wrapper.text()).toContain('The book was shut.');
      await wrapper.get('.read .top button').trigger('click');
      expect(wrapper.emitted('open')).toEqual([[]]);
      await wrapper.findAll('.ending-actions button')[1]!.trigger('click');
      expect(restart).toHaveBeenCalledOnce();
      expect(epilogue).toEqual(saved);
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
    } finally {
      wrapper.unmount();
    }
  });

  it('switches only the explanation, keeping saved pages and deed claims intact', async () => {
    const page: ChronicleEntry = {
      id: 'chr_claim', year: 1174, weight: 'page',
      named: true,
      title: 'A fixed title', text: 'These are the words written in the book.',
      delegated: 'record:record|choice:keep_the_book|unexpected',
      claims: [
        { kind: 'death', person: 'p_claim', year: 1173, cause: 'the winter fever' },
        { kind: 'trait', person: 'p_claim', trait: 'steadfast', has: false },
        { kind: 'attr', person: 'p_claim', attr: 'physical_strength', value: 52 },
        { kind: 'deed', person: 'p_claim', text: 'She held the gate until dawn.' },
      ],
    };
    const saved = structuredClone(page);
    const wrapper = mount(Entry, { props: { entry: page, proseMode: 'original' } });
    try {
      expect(wrapper.text()).toContain('that they died in 1173, the winter fever');
      expect(wrapper.text()).toContain('that their physical strength stood at 52');
      expect(wrapper.text()).toContain('standing preference: write it as it happened');
      expect(wrapper.text()).toContain('answered by standing preference');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('The record says they died in 1173 from the winter fever.');
      expect(wrapper.text()).toContain('The record says they were not steadfast.');
      expect(wrapper.text()).toContain('The record says their physical strength was 52.');
      expect(wrapper.text()).toContain('usual choice: write down what happened');
      expect(wrapper.text()).toContain('usual choice: keep the book');
      expect(wrapper.text()).toContain('answered using the usual choice');
      expect(wrapper.text()).not.toContain('stood at 52');
      expect(wrapper.text()).toContain('These are the words written in the book.');
      expect(wrapper.text()).toContain('She held the gate until dawn.');
      expect(page.text).toBe('These are the words written in the book.');
      expect(page).toEqual(saved);

      // Epilogue uses the same entry component but hides the delegated badges.
      await wrapper.setProps({ read: true });
      expect(wrapper.text()).toContain('The record says they died in 1173 from the winter fever.');
      expect(wrapper.text()).not.toContain('usual choice:');
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toContain('that they died in 1173, the winter fever');
    } finally {
      wrapper.unmount();
    }
  });

  it('passes the mode through the existing volume, keeping the book page unchanged', async () => {
    const page: ChronicleEntry = {
      id: 'chr_claim', year: 1174, weight: 'page', text: 'This page stays as written.',
      named: true, claims: [{ kind: 'trait', person: 'p_claim', trait: 'loyal', has: true }],
    };
    const wrapper = mount(Book, {
      props: {
        book: [page], ages: [], houseName: 'Gearithy', close: vi.fn(),
        actions: readsOver([page]), proseMode: 'original',
      },
    });
    try {
      expect(wrapper.text()).toContain('that they were loyal');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('The record says they were loyal.');
      expect(wrapper.text()).toContain('This page stays as written.');
    } finally {
      wrapper.unmount();
    }
  });
  it('connects all four Chronicle reader mounts to the active preference', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/src/App.vue'), 'utf8');
    for (const name of ['Ending', 'Chronicle']) {
      const mounts = [...source.matchAll(new RegExp('<' + name + '\\b[^>]*>', 'g'))];
      expect(mounts).toHaveLength(1);
      expect(mounts[0]?.[0]).toContain(':prose-mode="accessibility.proseMode"');
    }
    const bookMounts = [...source.matchAll(/<Book\b[^>]*>/g)];
    expect(bookMounts).toHaveLength(2);
    for (const mount of bookMounts) {
      expect(mount[0]).toContain(':prose-mode="accessibility.proseMode"');
    }
  });

});
