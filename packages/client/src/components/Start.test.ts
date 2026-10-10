// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Start from './Start.vue';
import { CAMPAIGN_CHOICES, type GameActions } from '../lib/game';
import type { SaveSummary } from '../platform';
import type { RunLibrary } from '@ed/schema';

/**
 * ── THE FRONT DOOR (issue #67) ────────────────────────────────────────────
 *
 * The acceptance line is "nobody sees the word seed unless they go looking
 * for it", and that is only testable if the field is actually absent from
 * the DOM by default rather than merely styled out of sight — a `v-if`
 * toggle rather than a native `<details>`, because a test has no layout
 * engine to hide it for.
 */

function spyActions(saves: SaveSummary[] = []) {
  return {
    begin: vi.fn(),
    resume: vi.fn(async () => true),
    load: vi.fn(async () => true),
    listSaves: vi.fn(async () => saves),
    importSave: vi.fn(async () => true),
    exportSave: vi.fn(async () => true),
    deleteLibraryRun: vi.fn(async () => undefined),
    clearLibrary: vi.fn(async () => undefined),
  } as unknown as GameActions;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the front door hides the seed behind Advanced', () => {
  it('shows no seed field or word by default', async () => {
    const w = mount(Start, { props: { actions: spyActions(), resumable: false } });
    await flush();

    expect(w.find('#seed').exists(), 'the seed input is in the default DOM').toBe(false);
    expect(w.text().toLowerCase()).not.toContain('seed');
  });

  it('reveals the seed field once Advanced is opened', async () => {
    const w = mount(Start, { props: { actions: spyActions(), resumable: false } });
    await flush();

    const toggle = w.findAll('button').find((b) => b.text() === 'Advanced');
    expect(toggle, 'no control opens the advanced section').toBeTruthy();
    await toggle!.trigger('click');

    expect(w.find('#seed').exists()).toBe(true);
    expect(w.text().toLowerCase()).toContain('seed');
  });

  it('still begins with the seed once it has been changed there', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false } });
    await flush();

    const toggle = w.findAll('button').find((b) => b.text() === 'Advanced');
    await toggle!.trigger('click');
    await w.get('#seed').setValue(77);

    await w.get('button.primary').trigger('click');
    expect(actions.begin).toHaveBeenCalledWith(77, 'short');
  });
});

describe('fresh RNG seeds for a new house (#1013)', () => {
  it('draws a new seed for each start screen, without changing the campaign year', async () => {
    // Control entropy rather than making a probabilistic test that can rarely
    // fail when two legitimate random draws happen to agree.
    let draws = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint32Array) => {
        values[0] = 0xaabb0000 + ++draws;
        return values;
      },
    });
    try {
      const first = spyActions();
      const firstScreen = mount(Start, { props: { actions: first, resumable: false } });
      await flush();
      expect(firstScreen.text()).toContain('In the year 1042');
      await firstScreen.get('button.primary').trigger('click');
      expect(first.begin).toHaveBeenCalledWith(0xaabb0001, 'short');

      // A setting toggle or a switch to Long must not draw a different seed
      // underneath a player who has already seen it in Advanced.
      const advanced = firstScreen.findAll('button').find((b) => b.text() === 'Advanced');
      await advanced!.trigger('click');
      expect((firstScreen.get('#seed').element as HTMLInputElement).value).toBe(String(0xaabb0001));
      const long = firstScreen.findAll('input[type="radio"]')
        .find((input) => input.attributes('value') === 'long');
      await long!.setValue(true);
      await firstScreen.get('button.primary').trigger('click');
      expect(first.begin).toHaveBeenLastCalledWith(0xaabb0001, 'long');
      expect(draws).toBe(1);
      firstScreen.unmount();

      const second = spyActions();
      const secondScreen = mount(Start, { props: { actions: second, resumable: false } });
      await flush();
      await secondScreen.get('button.primary').trigger('click');
      expect(second.begin).toHaveBeenCalledWith(0xaabb0002, 'short');
      expect(draws).toBe(2);
      secondScreen.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('campaign choice (#66)', () => {
  it('defaults to A Short Line and lets the player explicitly choose Long', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false } });
    await flush();

    expect(w.text()).toContain('A Short Line');
    expect(w.text()).toContain('A Long Line');
    expect(w.text()).toContain('three-clause Ledger');

    const short = w.findAll('label.campaign').find((label) => label.find('input').attributes('value') === 'short');
    expect(short, 'the Short Line choice is missing').toBeTruthy();
    const shortEndings = new Set<string>(CAMPAIGN_CHOICES.find((choice) => choice.id === 'short')!.endings);
    const longOnlyEndingTitles = CAMPAIGN_CHOICES
      .find((choice) => choice.id === 'long')!
      .endings
      .filter((ending) => !shortEndings.has(ending))
      .map((ending) => ending.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()));
    for (const title of longOnlyEndingTitles) expect(short!.text()).not.toContain(title);

    const long = w.findAll('input[type="radio"]').find((input) => input.attributes('value') === 'long');
    expect(long, 'the Long Line is not selectable').toBeTruthy();
    await long!.setValue(true);
    await w.get('button.primary').trigger('click');

    expect(actions.begin).toHaveBeenCalledWith(expect.any(Number), 'long');
  });
});

describe('Continue leads when a run can be resumed', () => {
  it('offers Continue first and calls resume, not begin, when pressed', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: true } });
    await flush();

    const continueBtn = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
    expect(continueBtn, 'no Continue control when a run is resumable').toBeTruthy();
    await continueBtn!.trigger('click');
    expect(actions.resume).toHaveBeenCalled();
    expect(actions.begin).not.toHaveBeenCalled();
  });

  it('offers only Begin, as the primary action, with nothing to continue', async () => {
    const w = mount(Start, { props: { actions: spyActions(), resumable: false } });
    await flush();

    expect(w.findAll('button').some((b) => b.text() === 'Continue the last sitting')).toBe(false);
    const begin = w.get('button.primary');
    expect(begin.text()).toBe('Begin the signing');
  });
});

describe('named saves', () => {
  it('lists a written-down run and exports it on request', async () => {
    const saves: SaveSummary[] = [{ slot: 'chapter-1-1080', year: 1080 }];
    const actions = spyActions(saves);
    const w = mount(Start, { props: { actions, resumable: false } });
    await flush();

    expect(w.text()).toContain('chapter-1-1080');
    const copyOut = w.findAll('button').find((b) => b.text() === 'Copy out');
    await copyOut!.trigger('click');
    expect(actions.exportSave).toHaveBeenCalledWith('chapter-1-1080');
  });

  it('does not duplicate the autosave slot once Continue already offers it', async () => {
    const saves: SaveSummary[] = [{ slot: 'autosave', year: 1090 }];
    const w = mount(Start, { props: { actions: spyActions(saves), resumable: true } });
    await flush();

    expect(w.find('section.saved').exists(), 'autosave listed twice').toBe(false);
  });

  it('still offers the autosave slot from the list when resumable lags behind it', async () => {
    const saves: SaveSummary[] = [{ slot: 'autosave', year: 1090 }];
    const w = mount(Start, { props: { actions: spyActions(saves), resumable: false } });
    await flush();

    expect(w.text()).toContain('The last sitting');
  });
});


describe('the Library of Houses', () => {
  it('shows a completed house, one surviving page, and removal controls', async () => {
    const actions = spyActions();
    const library: RunLibrary = {
      format: 1,
      runs: [{
        id: 'lib_old',
        seed: 77,
        campaign: 'short',
        endedYear: 1342,
        house: 'House Salt',
        ending: { id: 'forgotten', title: 'Forgotten' },
        entries: [{
          id: 'page_1',
          said: 'The old book said the child came through untouched.',
          year: 1201,
          people: {},
          claims: [{ kind: 'attr', person: 'p_1', attr: 'madness', value: 0 }],
        }],
      }],
    };
    const w = mount(Start, {
      props: { actions, resumable: false, library, libraryReady: true },
    });
    await flush();

    expect(w.text()).toContain('The Library of Houses');
    expect(w.text()).toContain('House Salt');
    expect(w.text()).toContain('Forgotten');
    expect(w.text()).toContain('The old book said the child came through untouched.');

    const remove = w.findAll('button').find((button) => button.text() === 'Remove');
    await remove!.trigger('click');
    expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');

    const clear = w.findAll('button').find((button) => button.text() === 'Clear');
    await clear!.trigger('click');
    expect(actions.clearLibrary).toHaveBeenCalled();
  });
});

describe('Library write failures are visible and retryable (#1034)', () => {
  const library: RunLibrary = {
    format: 1,
    runs: [{
      id: 'lib_old',
      seed: 77,
      campaign: 'short',
      endedYear: 1342,
      house: 'House Salt',
      ending: { id: 'forgotten', title: 'Forgotten' },
      entries: [],
    }],
  };

  it('reports a rejected Clear next to the Library and clears the error on retry', async () => {
    const actions = spyActions();
    vi.mocked(actions.clearLibrary).mockRejectedValueOnce(new Error('storage full'));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    await flush();

    await w.get('.library-head button').trigger('click');
    await flush();
    expect(w.get('.library [role="alert"]').text()).toContain('could not be cleared');
    expect(w.text()).toContain('House Salt');
    expect(actions.clearLibrary).toHaveBeenCalledTimes(1);

    await w.get('.library-head button').trigger('click');
    await flush();
    expect(w.find('.library [role="alert"]').exists()).toBe(false);
    expect(actions.clearLibrary).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected Remove without an unhandled rejection, and lets it retry', async () => {
    const actions = spyActions();
    vi.mocked(actions.deleteLibraryRun).mockRejectedValueOnce(new Error('read-only host'));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    await flush();

    await w.get('.library-title button').trigger('click');
    await flush();
    expect(w.get('.library [role="alert"]').text()).toContain('could not be removed');
    expect(w.text()).toContain('House Salt');
    expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');

    await w.get('.library-title button').trigger('click');
    await flush();
    expect(w.find('.library [role="alert"]').exists()).toBe(false);
    expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(2);
  });
});
