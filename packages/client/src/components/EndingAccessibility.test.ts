// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { AchievementView, EpilogueView, SessionView, ShareCodeProblem } from '@ed/core';
import type { GameActions } from '../lib/game';
import Ending from './Ending.vue';
import { shareCodeProblem } from '../lib/share-code';
import { copyTextInBrowser } from '../platform';
import { downloadBlob } from '../lib/download';

vi.mock('../lib/download', () => ({ downloadBlob: vi.fn() }));

describe('ending reckoning uses reader-local Plain English (#1669)', () => {
  it('changes explanatory labels without changing the recorded facts or authored ending', async () => {
    const view = {
      houseName: 'House Ash',
      seed: 47,
      campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
    } as SessionView;
    const epilogue = {
      year: 1542,
      title: 'The old reckoning',
      summary: 'The account is unsettled.',
      opening: 'An original opening.',
      closing: 'An original closing.',
      read: [],
      ring: [],
      founding: { heirloomName: 'The Ring', grudgeName: 'An old debt' },
      reckoning: {
        pages: 10, blanks: 2, embellished: 3,
        standingLies: 4, provenLies: 1,
        clauses: 7, clausesTotal: 9,
        attested: 'master', attestedTitle: 'Master', attestedYear: 1510,
        substantiated: 'adept', substantiatedTitle: 'Adept',
        rungsWithheld: 2, livingBlood: 12,
      },
    } as unknown as EpilogueView;
    const originalSnapshot = structuredClone(epilogue);
    const achievements: AchievementView[] = [{ id: 'ending_settled', title: 'Account Settled', description: 'Reach the Settled ending.' }];
    const w = mount(Ending, {
      props: {
        view,
        epilogue,
        achievements,
        actions: { restart: vi.fn(), shareCode: () => ({ ok: false, unavailable: 'not_founded' }) } as unknown as GameActions,
        proseMode: 'original',
      },
    });
    try {
      const labels = () => w.findAll('.tally dt').map((row) => row.text());
      const values = () => w.findAll('.tally dd').map((row) => row.text());
      const originalValues = values();
      expect(labels()).toContain('And could show');
      expect(labels()).toContain('What the book attests');
      expect(w.get('.tally').text()).toContain('4 pages were asked after, and answered with themselves');
      expect(w.get('.achievements summary').text()).toBe('Achievements earned (1)');
      expect(w.get('.achievements strong').text()).toBe('Account Settled');
      expect(w.get('.achievements p').text()).toBe('Reach the Settled ending.');

      await w.get('select').setValue('plainenglish');
      expect(w.emitted('update:proseMode')?.at(-1)).toEqual(['plainenglish']);
      await w.setProps({ proseMode: 'plainenglish', achievements: [{
        id: 'ending_settled', title: 'Debt Settled', description: 'Finish with the Settled ending.',
      }] });
      expect(w.get('.achievements strong').text()).toBe('Debt Settled');
      expect(w.get('.achievements p').text()).toBe('Finish with the Settled ending.');
      expect(labels()).toContain('Highest level supported by evidence');
      expect(labels()).toContain('Highest level claimed in the Chronicle');
      expect(labels()).toContain('Contract clauses recovered');
      expect(labels()).toContain('Entries embellished');
      expect(w.get('.tally').text()).toContain('4 claims were challenged but supported only by their own pages');
      expect(w.get('.tally').text()).toContain('(1 exposed)');
      expect(values()).toEqual(originalValues.map((value) => value
        .replace('4 pages were asked after, and answered with themselves',
          '4 claims were challenged but supported only by their own pages')
        .replace('1 caught', '1 exposed')));
      expect(w.get('h1').text()).toBe('The old reckoning');
      expect(w.get('.summary').text()).toBe('The account is unsettled.');
      expect(w.get('.closing').text()).toBe('An original closing.');
      expect(epilogue).toEqual(originalSnapshot);

      await w.get('select').setValue('original');
      expect(w.emitted('update:proseMode')?.at(-1)).toEqual(['original']);
      await w.setProps({ proseMode: 'original', achievements });
      expect(w.get('.achievements strong').text()).toBe('Account Settled');
      expect(labels()).toContain('And could show');
      expect(values()).toEqual(originalValues);
    } finally {
      w.unmount();
    }
  });
});

describe('ending image uses the selected reader mode (#1717)', () => {
  it('paints each mode from one snapshot while preserving facts, quote and filename across async encoding', async () => {
    const painted: string[] = [];
    const context = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {}, fillText: (text: string) => { painted.push(text); },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const encodings: BlobCallback[] = [];
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { encodings.push(callback); });
    const view = {
      houseName: 'House Ash', seed: 47,
      campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
    } as SessionView;
    const epilogue = {
      year: 1542, title: 'The old reckoning', summary: 'The account is unsettled.',
      opening: 'An original opening.', closing: 'An original closing.', ring: [],
      read: [{ year: 1500, weight: 'illuminated', text: 'A saved Chronicle sentence.', title: 'The remembered night' }],
      afterimage: {
        people: [{ person: 'meriel', name: 'Meriel 家', sources: [{ year: 1200, page: 'the-rite', title: 'The rite account', text: 'Meriel 家 was named in the cold room.' }] }],
        spent: { person: 'meriel', name: 'Meriel 家', source: { year: 1200, page: 'the-rite', title: 'The rite account', text: 'Meriel 家 was named in the cold room.' } },
        brush: { count: 2, source: { year: 1150, text: 'Only two of the blood were living.' } },
        embellishment: { year: 1180, text: 'The book claimed the door was never opened.' },
        blank: { year: 1100, text: null, title: 'The unspoken contents' },
      },
      reckoning: {
        pages: 10, blanks: 2, embellished: 3, standingLies: 4, provenLies: 1,
        clauses: 7, clausesTotal: 9, attested: 'none', livingBlood: 12, rungsWithheld: 0,
      },
    } as unknown as EpilogueView;
    const before = structuredClone(epilogue);
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode: () => ({ ok: false, unavailable: 'not_founded' }) } as unknown as GameActions } });
    try {
      const dimensions: number[][] = [];
      for (const [index, mode] of (['original', 'plainenglish', 'original'] as const).entries()) {
        await w.setProps({ proseMode: mode });
        painted.length = 0;
        await w.get('.ending-actions button').trigger('click');
        expect(painted).toContain(mode === 'plainenglish' ? 'Entries embellished' : 'Improved');
        expect(painted).toContain(mode === 'plainenglish' ? '4 · 1 exposed' : '4 · 1 caught');
        expect(painted).toContain(mode === 'plainenglish' ? 'No level claimed' : 'nothing at all');
        expect(painted).toContain(mode === 'plainenglish'
          ? 'CHRONICLE EXCERPT · 1500 · The remembered night'
          : 'FROM THE CHRONICLE · 1500 · The remembered night');
        expect(painted).toContain(mode === 'plainenglish' ? 'Eldritch Dynasty · Ending image' : 'Eldritch Dynasty · House Afterimage');
        for (const memory of w.findAll('.memory')) {
          expect(painted).toContain(memory.get('h4').text());
          if (memory.find('.memory-name').exists()) expect(painted).toContain(memory.get('.memory-name').text());
          if (memory.find('blockquote').exists()) expect(painted).toContain(memory.get('blockquote').text());
        }
        expect(w.findAll('.memory-blank')).toHaveLength(1);
        expect(painted).not.toContain('The unspoken contents');
        expect(w.get('.house-memory').text()).not.toContain('The unspoken contents');
        for (const text of ['House Ash', 'A Long Line · 1542 · seed 47', 'The old reckoning',
          'The account is unsettled.', 'A saved Chronicle sentence.', '7 of 9 clauses', '12']) {
          expect(painted).toContain(text);
        }
        const image = encoding.mock.instances[index]! as HTMLCanvasElement;
        dimensions.push([image.width, image.height]);
        const snapshot = [...painted];
        await w.setProps({ proseMode: mode === 'original' ? 'plainenglish' : 'original' });
        expect(downloadBlob).toHaveBeenCalledTimes(index);
        encodings[index]!(new Blob(['image'], { type: 'image/png' }));
        await flushPromises();
        expect(painted).toEqual(snapshot);
        expect(downloadBlob).toHaveBeenLastCalledWith(expect.any(Blob), 'house-ash-1542-seed-47-afterimage.png');
      }
      expect(dimensions[1]).toEqual(dimensions[0]);
      expect(dimensions[2]).toEqual(dimensions[0]);
      expect(epilogue).toEqual(before);
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      vi.mocked(downloadBlob).mockClear();
    }
  });
});

describe('ending image export failures', () => {
  const view = {
    houseName: 'House Ash', seed: 47,
    campaign: { id: 'short', name: 'A Short Line', startYear: 1042, endYear: 1342 },
  } as SessionView;
  const makeEnding = (summary = 'An unsettled account.') => ({
    year: 1342, title: 'The last night', summary, opening: '', closing: '', ring: [], read: [],
    reckoning: {
      pages: 0, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
      clauses: 0, clausesTotal: 3, attested: 'none', livingBlood: 1, rungsWithheld: 0,
    },
  }) as unknown as EpilogueView;
  const actions = {
    restart: vi.fn(),
    shareCode: () => ({ ok: true as const, code: 'ED1.abc.123' }),
  } as unknown as GameActions;

  for (const mode of ['original', 'plainenglish'] as const) {
    it('exports a vector Afterimage with the full nameless code despite the names opt-in (' + mode + ') #2369', async () => {
      const anonymousCode = 'ED1.anonymous-founding.123';
      const personallyNamedCode = 'ED1.private-names.456';
      const shareCode = vi.fn((includeNames: boolean) => ({
        ok: true as const, code: includeNames ? personallyNamedCode : anonymousCode,
      }));
      const gauge = { measureText: (text: string) => ({ width: text.length * 7 }) } as CanvasRenderingContext2D;
      const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValueOnce(gauge).mockReturnValueOnce(null);
      const w = mount(Ending, {
        props: {
          view, epilogue: makeEnding(), proseMode: mode,
          actions: { restart: vi.fn(), shareCode } as unknown as GameActions,
        },
      });
      try {
        // The ending may show a personally named code, but exported images travel
        // without consent from everyone named in the original run.
        await w.get('.share-names input').setValue(true);
        expect((w.get('#share-code').element as HTMLTextAreaElement).value).toBe(personallyNamedCode);

        await w.get('.ending-actions button').trigger('click');
        await flushPromises();
        expect(canvas).toHaveBeenCalledTimes(2);
        expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(
          expect.any(Blob), 'house-ash-1342-seed-47-afterimage.svg',
        );
        const blob = vi.mocked(downloadBlob).mock.calls[0]![0];
        expect(blob.type).toContain('image/svg+xml');
        const source = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(blob);
        });
        const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
        expect(svg.querySelector('parsererror')).toBeNull();
        // The visible code must match the complete, selectable assistive text.
        const visible = [...svg.querySelectorAll('text')].map((node) => node.textContent);
        const description = svg.querySelector('desc')?.textContent ?? '';
        expect(visible).toContain(anonymousCode);
        expect(description).toContain('Share code: ' + anonymousCode);
        expect(visible).not.toContain(personallyNamedCode);
        expect(description).not.toContain(personallyNamedCode);
        expect(w.find('[role="alert"]').exists()).toBe(false);
        expect(shareCode).toHaveBeenCalledWith(false);
      } finally {
        w.unmount();
        canvas.mockRestore();
        vi.mocked(downloadBlob).mockClear();
      }
    });
  }

  it('exports SVG if PNG encoding returns null, instead of losing the image', async () => {
    const ink = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: () => {}, fillText: () => {},
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ink);
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { callback(null); });
    const w = mount(Ending, { props: { view, epilogue: makeEnding(), actions } });
    try {
      await w.get('.ending-actions button').trigger('click');
      await flushPromises();
      expect(encoding).toHaveBeenCalledTimes(1);
      expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(
        expect.any(Blob), 'house-ash-1342-seed-47-afterimage.svg',
      );
      expect(w.find('[role="alert"]').exists()).toBe(false);
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      vi.mocked(downloadBlob).mockClear();
    }
  });

  it('exports SVG directly for a tall Afterimage without requesting a final bitmap', async () => {
    const gauge = { measureText: (text: string) => ({ width: text.length * 7 }) } as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gauge);
    const encoding = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const w = mount(Ending, { props: { view, epilogue: makeEnding('A remembered debt. '.repeat(1500)), actions } });
    try {
      await w.get('.ending-actions button').trigger('click');
      await flushPromises();
      expect(canvas).toHaveBeenCalledTimes(1);
      expect(encoding).not.toHaveBeenCalled();
      expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(
        expect.any(Blob), 'house-ash-1342-seed-47-afterimage.svg',
      );
    } finally {
      w.unmount();
      encoding.mockRestore();
      canvas.mockRestore();
      vi.mocked(downloadBlob).mockClear();
    }
  });

  it('reports a failed canvas allocation and leaves the export available for retry', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const view = { houseName: '家', seed: 1, campaign: { name: 'A Short Line' } } as SessionView;
    const epilogue = { year: 1342, title: 'An ending', summary: '', opening: '', closing: '', ring: [], read: [],
      reckoning: { pages: 0, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0,
        clauses: 0, clausesTotal: 3, attested: 'none', livingBlood: 0, rungsWithheld: 0 } } as unknown as EpilogueView;
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode: () => ({ ok: false, unavailable: 'not_founded' }) } as unknown as GameActions } });
    try {
      await w.get('.ending-actions button').trigger('click');
      await flushPromises();
      expect(w.get('[role="alert"]').text()).toContain('could not be saved');
      expect(w.get('.ending-actions button').attributes('disabled')).toBeUndefined();
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toBe('Could not save the ending image. Try again.');
    } finally { w.unmount(); canvas.mockRestore(); }
  });
});

describe('the ending returns to where the run began (#1867 §6)', () => {
  const view = {
    houseName: 'House Ash',
    seed: 47,
    campaign: { id: 'long', name: 'A Long Line', startYear: 1042, endYear: 1542 },
  } as SessionView;
  const epilogue = (beginning?: unknown) => ({
    year: 1542, title: 'T', summary: 'S', opening: 'O', closing: 'C', read: [], ring: [],
    reckoning: {
      pages: 1, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0, clauses: 1, clausesTotal: 9,
      attested: 'none', substantiated: 'none', rungsWithheld: 0, livingBlood: 3,
    },
    ...(beginning ? { beginning } : {}),
  }) as unknown as EpilogueView;
  const mountWith = (e: EpilogueView, proseMode: 'original' | 'plainenglish' = 'original') => mount(Ending, {
    props: { view, epilogue: e, actions: { restart: vi.fn(), shareCode: () => ({ ok: false, unavailable: 'not_founded' }) } as unknown as GameActions, proseMode },
  });

  it('names the founder, quotes the opening pages, blanks included, and the ambition kept in view', async () => {
    const w = mountWith(epilogue({
      founder: 'Ana Vell',
      guardianSince: 1090,
      pages: [
        { id: 'chr_1', year: 1043, weight: 'paragraph', text: null, record: 'omit', named: false },
        { id: 'chr_2', year: 1046, weight: 'line', text: 'The children signed the day-book.', named: false },
      ],
      ambition: { name: 'Deepen the blood', progress: '14 living of the blood', status: 'The line is broad' },
    }));
    const section = w.get('.beginning');
    expect(section.text()).toContain('Ana Vell signed in 1042, and kept the house as its guardian from 1090.');
    expect(section.text()).toContain('The children signed the day-book.');
    expect(section.get('.beginning-ambition').text()).toBe(
      'The house set out to: Deepen the blood. 14 living of the blood. The line is broad',
    );

    await w.setProps({ proseMode: 'plainenglish' });
    expect(w.get('.beginning').text()).toContain('Ana Vell signed the agreement in 1042, and guided the family as its guardian from 1090.');
    expect(w.get('.beginning-ambition').text()).toContain('Family goal:');
  });

  it('draws nothing for a run with no founder, and no crossing or goal it did not see', () => {
    expect(mountWith(epilogue()).find('.beginning').exists()).toBe(false);
    const quiet = mountWith(epilogue({ founder: 'Ana Vell', pages: [] }));
    expect(quiet.get('.beginning').text()).toContain('Ana Vell signed in 1042.');
    expect(quiet.find('.beginning-ambition').exists()).toBe(false);
  });
});

describe('the last night shows the code', () => {
  const view = { houseName: 'Salt', campaign: { name: 'A Short Line', startYear: 1042 }, seed: 1, halls: [] } as unknown as SessionView;
  const epilogue = {
    year: 1342, title: 'T', summary: 'S', frame: '', closing: 'C', ring: [], read: [], afterimage: [],
    reckoning: {
      pages: 0, blanks: 0, embellished: 0, standingLies: 0, provenLies: 0, clauses: 0, clausesTotal: 3,
      attested: 'none', attestedTitle: '', substantiated: 'none', substantiatedTitle: '', rungsWithheld: 0, livingBlood: 1,
    },
  } as unknown as EpilogueView;

  it('leaves the names out until the reader asks for them', async () => {
    const shareCode = vi.fn((names: boolean) => ({ ok: true as const, code: names ? 'ED1.named.x' : 'ED1.plain.x' }));
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode } as unknown as GameActions } });
    expect((w.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1.plain.x');
    expect(shareCode).toHaveBeenLastCalledWith(false);
    await w.get('.share-names input').setValue(true);
    expect((w.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1.named.x');
  });

  it('copies the code shown, says so, and forgets the receipt once the code changes', async () => {
    const shareCode = (names: boolean) => ({ ok: true as const, code: names ? 'ED1.named.x' : 'ED1.plain.x' });
    const copyText = vi.fn(async () => true);
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode, copyText } as unknown as GameActions } });
    const status = w.get('.share-copy [role="status"]');
    expect(status.text()).toBe('');
    await w.get('.share-copy button').trigger('click');
    await flushPromises();
    expect(copyText).toHaveBeenCalledExactlyOnceWith('ED1.plain.x');
    expect(status.text()).toBe('Copied.');
    // The receipt was for the nameless code; the named one has not been copied.
    await w.get('.share-names input').setValue(true);
    expect(status.text()).toBe('');
    await w.get('.share-copy button').trigger('click');
    await flushPromises();
    expect(copyText).toHaveBeenLastCalledWith('ED1.named.x');
    expect(status.text()).toBe('Copied.');
  });

  it('ignores an older copy failure that finishes after the newest success', async () => {
    const shareCode = () => ({ ok: true as const, code: 'ED1.plain.x' });
    const finish: Array<(ok: boolean) => void> = [];
    const copyText = vi.fn(() => new Promise<boolean>((resolve) => { finish.push(resolve); }));
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode, copyText } as unknown as GameActions } });
    try {
      const button = w.get('.share-copy button');
      const status = w.get('.share-copy [role="status"]');
      await button.trigger('click');
      await button.trigger('click');
      expect(copyText).toHaveBeenCalledTimes(2);
      finish[1]!(true);
      await flushPromises();
      expect(status.text()).toBe('Copied.');
      finish[0]!(false);
      await flushPromises();
      expect(status.text()).toBe('Copied.');

      // A third attempt clears the previous receipt while it is pending.
      await button.trigger('click');
      expect(status.text()).toBe('');
      finish[2]!(false);
      await flushPromises();
      expect(status.text()).toContain('The copy did not take.');
    } finally {
      w.unmount();
    }
  });

  it('does not let an old nameless copy replace a newer named-code failure', async () => {
    const shareCode = (names: boolean) => ({ ok: true as const, code: names ? 'ED1.named.x' : 'ED1.plain.x' });
    const finish: Array<(ok: boolean) => void> = [];
    const copyText = vi.fn(() => new Promise<boolean>((resolve) => { finish.push(resolve); }));
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode, copyText } as unknown as GameActions } });
    try {
      const status = w.get('.share-copy [role="status"]');
      await w.get('.share-copy button').trigger('click');
      await w.get('.share-names input').setValue(true);
      await w.get('.share-copy button').trigger('click');
      expect(copyText).toHaveBeenNthCalledWith(1, 'ED1.plain.x');
      expect(copyText).toHaveBeenNthCalledWith(2, 'ED1.named.x');
      finish[1]!(false);
      await flushPromises();
      expect(status.text()).toContain('The copy did not take.');
      finish[0]!(true);
      await flushPromises();
      expect(status.text()).toContain('The copy did not take.');
    } finally {
      w.unmount();
    }
  });

  it.each([
    ['original', 'Copy the code', 'The copy did not take. Select the code and copy it by hand.'],
    ['plainenglish', 'Copy code', 'Could not copy. Select the code and copy it yourself.'],
  ] as const)('says when the copy failed, in %s', async (proseMode, label, failed) => {
    const shareCode = () => ({ ok: true as const, code: 'ED1.plain.x' });
    const copyText = vi.fn(async () => false);
    const w = mount(Ending, { props: { view, epilogue, proseMode, actions: { restart: vi.fn(), shareCode, copyText } as unknown as GameActions } });
    const button = w.get('.share-copy button');
    expect(button.text()).toBe(label);
    await button.trigger('click');
    await flushPromises();
    expect(w.get('.share-copy [role="status"]').text()).toBe(failed);
    // The code is still there to select by hand.
    expect((w.get('#share-code').element as HTMLTextAreaElement).value).toBe('ED1.plain.x');
  });

  it('draws no code for a run that has none to give', () => {
    const shareCode = () => ({ ok: false as const, unavailable: 'demonstration' as const });
    const w = mount(Ending, { props: { view, epilogue, actions: { restart: vi.fn(), shareCode } as unknown as GameActions } });
    expect(w.find('#share-code').exists()).toBe(false);
  });
});

describe('every refusal is worded in both modes', () => {
  const problems: ShareCodeProblem[] = [
    { kind: 'empty' }, { kind: 'too_long', max: 2400 }, { kind: 'not_a_code' },
    { kind: 'unsupported_version', version: '2' }, { kind: 'damaged' },
    { kind: 'other_edition', differs: ['content', 'build'] }, { kind: 'demonstration' },
    { kind: 'names_needed', missing: ['house', 'friends'] },
  ];
  it.each(problems)('$kind', (problem) => {
    const original = shareCodeProblem(problem, 'original');
    const plain = shareCodeProblem(problem, 'plainenglish');
    expect(original).not.toBe('');
    expect(plain).not.toBe(original);
  });

  it.each([
    {
      missing: ['house'],
      original: "The code left a name out. Give the house's name.",
      plain: 'Enter the missing name: the family name.',
    },
    {
      missing: ['house', 'friends'],
      original: "The code left names out. Give the house's name and each friend's name.",
      plain: "Enter the missing names: the family name and each friend's name.",
    },
    {
      missing: ['founder', 'house', 'friends'],
      original: "The code left names out. Give the founder's name, the house's name, and each friend's name.",
      plain: "Enter the missing names: the founder's name, the family name, and each friend's name.",
    },
  ] satisfies Array<{
    missing: Extract<ShareCodeProblem, { kind: 'names_needed' }>['missing'];
    original: string;
    plain: string;
  }>)('names omitted from a share code in both modes (case %#)', ({ missing, original, plain }) => {
    const problem: ShareCodeProblem = { kind: 'names_needed', missing };
    expect(shareCodeProblem(problem, 'original')).toBe(original);
    expect(shareCodeProblem(problem, 'plainenglish')).toBe(plain);
  });

  it('passes the signing\'s own refusal through untouched', () => {
    expect(shareCodeProblem({ kind: 'refused', reason: 'that name is taken' }, 'plainenglish')).toBe('that name is taken');
  });
});

/** The browser's half of the copy seam (#1995): every shipped WebView runs it. */
describe('copying in a browser', () => {
  afterEach(() => {
    // Own properties over jsdom's: deleting them restores what was there.
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });
  function stubClipboard(writeText?: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  }
  function stubExecCommand(result: boolean | Error): { copied: string[] } {
    const copied: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        if (result instanceof Error) throw result;
        const area = document.activeElement;
        if (area instanceof HTMLTextAreaElement) copied.push(area.value.slice(area.selectionStart, area.selectionEnd));
        return result;
      }),
    });
    return { copied };
  }

  it('uses the Clipboard API where it is granted', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const exec = stubExecCommand(true);
    await copyTextInBrowser('ED1.a.b');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('ED1.a.b');
    expect(exec.copied).toEqual([]);
  });

  it('falls back to a selected textarea where the API is refused, and leaves focus where it was', async () => {
    stubClipboard(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    const exec = stubExecCommand(true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    try {
      await copyTextInBrowser('ED1.a.b');
      expect(exec.copied).toEqual(['ED1.a.b']);
      expect(document.querySelector('textarea')).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it.each([
    ['refuses', false],
    ['throws', new Error('no clipboard')],
  ] as const)('rejects when the fallback %s too, so nobody is told it copied', async (_what, result) => {
    stubClipboard(undefined);
    stubExecCommand(result);
    await expect(copyTextInBrowser('ED1.a.b')).rejects.toThrow();
    expect(document.querySelector('textarea')).toBeNull();
  });
});
