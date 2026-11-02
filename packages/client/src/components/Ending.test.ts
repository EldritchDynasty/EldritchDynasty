// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { EpilogueView, SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';
import Ending from './Ending.vue';
import { downloadBlob } from '../lib/download';

vi.mock('../lib/download', () => ({ downloadBlob: vi.fn() }));

const actions = {
  restart: vi.fn(),
  shareCode: () => ({ ok: false as const, unavailable: 'not_founded' as const }),
} as unknown as GameActions;

const epilogue = {
  year: 1075, title: 'The verdict', summary: 'The finished account.',
  opening: 'A recorded beginning.', closing: 'A final line.',
  read: [], ring: [],
  reckoning: {
    pages: 1, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
    clauses: 0, clausesTotal: 3, attested: 'none',
    rungsWithheld: 0, livingBlood: 2,
  },
} as unknown as EpilogueView;

function view(campaign: 'demo' | 'short' | 'long'): SessionView {
  return {
    houseName: 'House Ash', seed: 2207,
    campaign: { id: campaign, name: campaign, startYear: 1042, endYear: 1075 },
  } as SessionView;
}

describe('Demonstration verdict guidance (#2207)', () => {
  for (const mode of ['original', 'plainenglish'] as const satisfies readonly ProseMode[]) {
    it(`explains the longer campaigns and no-transfer rule in ${mode}`, () => {
      const wrapper = mount(Ending, { props: { view: view('demo'), epilogue, actions, proseMode: mode } });
      try {
        const note = wrapper.get('.demo-next');
        expect(note.get('h3').text()).toBe(mode === 'original' ? 'Beyond this account' : 'Continue with a full campaign');
        expect(note.attributes('aria-labelledby')).toBe('demo-next-title');
        expect(note.text()).toMatch(/Library of Houses/);
        expect(note.text()).toMatch(/Demonstration/);
        expect(note.text()).toMatch(/Short/);
        expect(note.text()).toMatch(/Long/);
        expect(note.text()).toMatch(/generations/);
        expect(note.text()).toMatch(/Ages/);
        expect(note.text()).toMatch(/Record/);
        expect(note.text()).toMatch(/creditor/);
        expect(note.text()).toMatch(/sav(ed|e)/i);
        expect(note.text()).toMatch(/cannot/);
        expect(note.text()).not.toMatch(/wishlist|Steam|minutes|hours/i);
      } finally {
        wrapper.unmount();
      }
    });

    for (const campaign of ['short', 'long'] as const) {
      it(`leaves the ${campaign} verdict untouched in ${mode}`, () => {
        const wrapper = mount(Ending, { props: { view: view(campaign), epilogue, actions, proseMode: mode } });
        try {
          expect(wrapper.find('.demo-next').exists()).toBe(false);
          expect(wrapper.get('.closing').text()).toBe('A final line.');
          expect(wrapper.get('h1').text()).toBe('The verdict');
        } finally {
          wrapper.unmount();
        }
      });
    }
  }

  it('switches the guidance with the reader mode without changing the recorded ending', async () => {
    const wrapper = mount(Ending, { props: { view: view('demo'), epilogue, actions, proseMode: 'original' } });
    try {
      expect(wrapper.get('.demo-next').text()).toContain('Another house must sign its own beginning.');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.get('.demo-next').text()).toContain('a longer line begins as a new house.');
      expect(wrapper.get('.closing').text()).toBe('A final line.');
      await wrapper.setProps({ view: view('short') });
      expect(wrapper.find('.demo-next').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});


describe('ending share code receipt (#1995)', () => {
  function shareActions(copyText: (text: string) => Promise<boolean>): GameActions {
    return {
      ...actions,
      shareCode: (names: boolean) => ({ ok: true, code: names ? 'ED1-NAMED' : 'ED1-NAMELESS' }),
      copyText,
    } as unknown as GameActions;
  }

  it('keeps names excluded until explicitly requested and copies the visible code', async () => {
    const copyText = vi.fn(async () => true);
    const wrapper = mount(Ending, {
      props: { view: view('short'), epilogue, actions: shareActions(copyText), proseMode: 'plainenglish' },
    });
    try {
      expect((wrapper.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1-NAMELESS');
      await wrapper.get('.share-copy button').trigger('click');
      await flushPromises();
      expect(copyText).toHaveBeenCalledWith('ED1-NAMELESS');
      expect(wrapper.get('[role="status"]').text()).toBe('Copied.');

      await wrapper.get('.share-names input').setValue(true);
      expect((wrapper.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1-NAMED');
      // A receipt for the old code must not claim the new visible code was copied.
      expect(wrapper.get('[role="status"]').text()).toBe('');
      await wrapper.get('.share-copy button').trigger('click');
      await flushPromises();
      expect(copyText).toHaveBeenLastCalledWith('ED1-NAMED');
      expect(wrapper.get('[role="status"]').text()).toBe('Copied.');
    } finally {
      wrapper.unmount();
    }
  });

  for (const mode of ['original', 'plainenglish'] as const satisfies readonly ProseMode[]) {
    it(`reports rejected clipboard actions and permits a retry in ${mode}`, async () => {
      const copyText = vi.fn()
        .mockRejectedValueOnce(new Error('native clipboard refused'))
        .mockResolvedValueOnce(true);
      const wrapper = mount(Ending, {
        props: { view: view('short'), epilogue, actions: shareActions(copyText), proseMode: mode },
      });
      try {
        await wrapper.get('.share-copy button').trigger('click');
        await flushPromises();
        const status = wrapper.get('[role="status"]');
        expect(status.text()).toMatch(/could not copy|copy did not take/i);
        expect(status.text()).toMatch(/select the code/i);
        expect((wrapper.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1-NAMELESS');

        await wrapper.get('.share-copy button').trigger('click');
        await flushPromises();
        expect(status.text()).toBe('Copied.');
      } finally {
        wrapper.unmount();
      }
    });
  }

  it('ignores an older rejected copy after a newer named copy succeeds', async () => {
    let rejectOlder!: (reason: Error) => void;
    const older = new Promise<boolean>((_resolve, reject) => { rejectOlder = reject; });
    const copyText = vi.fn()
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce(true);
    const wrapper = mount(Ending, {
      props: { view: view('long'), epilogue, actions: shareActions(copyText), proseMode: 'plainenglish' },
    });
    try {
      await wrapper.get('.share-copy button').trigger('click');
      await wrapper.get('.share-names input').setValue(true);
      await wrapper.get('.share-copy button').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="status"]').text()).toBe('Copied.');

      rejectOlder(new Error('slow rejected clipboard'));
      await flushPromises();
      expect(wrapper.get('[role="status"]').text()).toBe('Copied.');
      expect(copyText).toHaveBeenNthCalledWith(1, 'ED1-NAMELESS');
      expect(copyText).toHaveBeenNthCalledWith(2, 'ED1-NAMED');
    } finally {
      wrapper.unmount();
    }
  });

  it('exports a nameless Afterimage SVG even when named sharing is selected', async () => {
    const download = vi.mocked(downloadBlob);
    download.mockClear();
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // Exercise the component's real Canvas-unavailable fallback, including
    // measured rows and the accessible standalone SVG description.
    const descriptor = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getComputedTextLength');
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value: function (this: SVGElement) { return (this.textContent ?? '').length * 8; },
    });
    const wrapper = mount(Ending, {
      props: {
        view: view('long'), epilogue, actions: shareActions(async () => true),
        proseMode: 'plainenglish',
      },
    });
    try {
      await wrapper.get('.share-names input').setValue(true);
      expect((wrapper.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1-NAMED');

      await wrapper.get('.ending-actions button:first-child').trigger('click');
      await flushPromises();
      expect(download).toHaveBeenCalledTimes(1);
      const [blob, filename] = download.mock.calls[0]!;
      expect(filename).toMatch(/-afterimage\\.svg$/);
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      expect(svg.querySelector('parsererror')).toBeNull();
      expect(svg.querySelector('desc')?.textContent).toContain('ED1-NAMELESS');
      expect(svg.querySelector('desc')?.textContent).not.toContain('ED1-NAMED');
      expect(Array.from(svg.querySelectorAll('text')).map((node) => node.textContent).join('')).toContain('ED1-NAMELESS');
      expect(source).not.toContain('ED1-NAMED');
      expect(wrapper.find('.afterimage-error').exists()).toBe(false);
    } finally {
      wrapper.unmount();
      canvas.mockRestore();
      if (descriptor) Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', descriptor);
      else Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength');
      download.mockClear();
    }
  });
});
