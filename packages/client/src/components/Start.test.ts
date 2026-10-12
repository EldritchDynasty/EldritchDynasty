// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Start from './Start.vue';
import Naming from './Naming.vue';
import type { SessionView } from '@ed/core';
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
    retryLibrary: vi.fn(async () => undefined),
    setProseMode: vi.fn(),
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

describe('Begin is single-flight until the Start screen updates (#1482)', () => {
  it('ignores same-tick duplicate clicks but accepts a later intentional Begin', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const begin = w.get('button.primary').element as HTMLButtonElement;
      // Dispatch real DOM clicks without Vue Test Utils yielding a render tick.
      begin.click();
      begin.click();
      begin.click();
      expect(actions.begin).toHaveBeenCalledTimes(1);
      expect(actions.begin).toHaveBeenCalledWith(expect.any(Number), 'short');

      // In production the successful Begin replaces Start with the prologue;
      // here the stub leaves it mounted so a deliberate new campaign works.
      const firstSeed = vi.mocked(actions.begin).mock.calls[0]![0];
      await w.vm.$nextTick();
      const long = w.findAll('input[type="radio"]')
        .find((input) => input.attributes('value') === 'long');
      await long!.setValue(true);
      begin.click();
      expect(actions.begin).toHaveBeenCalledTimes(2);
      expect(actions.begin).toHaveBeenLastCalledWith(firstSeed, 'long');
    } finally {
      w.unmount();
    }
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

describe('Begin and Continue never race on the Start screen (#1493)', () => {
  it('disables Begin while Continue is pending and ignores a stale synthetic click', async () => {
    const actions = spyActions();
    let settle: ((value: boolean) => void) | undefined;
    vi.mocked(actions.resume).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { settle = resolve; }),
    );
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      const beginButton = w.findAll('button').find((b) => b.text() === 'Begin a new signing');
      expect(continueButton).toBeTruthy();
      expect(beginButton).toBeTruthy();

      await continueButton!.trigger('click');
      expect(actions.resume).toHaveBeenCalledTimes(1);
      expect(beginButton!.attributes('disabled')).toBeDefined();
      // An already-queued/programmatic DOM event can bypass the native disabled
      // state. The action handler must independently refuse it.
      beginButton!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(actions.begin).not.toHaveBeenCalled();

      settle!(false);
      await flush();
      expect(beginButton!.attributes('disabled')).toBeUndefined();
      await beginButton!.trigger('click');
      expect(actions.begin).toHaveBeenCalledTimes(1);
    } finally {
      w.unmount();
    }
  });

  it('refuses a same-tick Continue after Begin dispatches', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      const beginButton = w.findAll('button').find((b) => b.text() === 'Begin a new signing');
      expect(continueButton).toBeTruthy();
      expect(beginButton).toBeTruthy();

      // Both actions arrive before the Start screen has rendered the new run.
      beginButton!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      continueButton!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(actions.begin).toHaveBeenCalledTimes(1);
      expect(actions.resume).not.toHaveBeenCalled();

      // If a test host keeps Start mounted, the next deliberate action is valid.
      await flush();
      await continueButton!.trigger('click');
      expect(actions.resume).toHaveBeenCalledTimes(1);
    } finally {
      w.unmount();
    }
  });
});

describe('Continue leads when a run can be resumed', () => {
  it('keeps Continue single-flight and permits retry after refusal (#1360)', async () => {
    const actions = spyActions();
    let settleFirst: ((value: boolean) => void) | undefined;
    vi.mocked(actions.resume).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { settleFirst = resolve; }),
    );
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      expect(continueButton).toBeTruthy();

      await continueButton!.trigger('click');
      expect(continueButton!.attributes('disabled')).toBeDefined();
      expect(continueButton!.text()).toContain('Continuing');
      // Even a second dispatched click while the first host request is pending
      // must not attempt to load the same saved session twice.
      await continueButton!.trigger('click');
      expect(actions.resume).toHaveBeenCalledTimes(1);

      settleFirst!(false);
      await flush();
      expect(w.get('.resume-refusal').text()).toContain('could not be resumed');
      expect(continueButton!.attributes('disabled')).toBeUndefined();

      await continueButton!.trigger('click');
      await flush();
      expect(actions.resume).toHaveBeenCalledTimes(2);
      expect(w.find('.resume-refusal').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

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

  it('explains a refused Continue and clears that feedback on a successful retry (#1081)', async () => {
    const actions = spyActions();
    vi.mocked(actions.resume).mockResolvedValueOnce(false);
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      expect(continueButton).toBeTruthy();

      await continueButton!.trigger('click');
      await flush();
      expect(w.get('.primary-row + .resume-refusal[role="status"]').text()).toContain('last sitting could not be resumed');
      expect(actions.resume).toHaveBeenCalledTimes(1);

      await continueButton!.trigger('click');
      await flush();
      expect(w.find('.resume-refusal[role="status"]').exists()).toBe(false);
      expect(actions.resume).toHaveBeenCalledTimes(2);
      expect(actions.begin).not.toHaveBeenCalled();
    } finally {
      w.unmount();
    }
  });

  it('reports an unexpectedly rejected Continue without an unhandled rejection (#1081)', async () => {
    const actions = spyActions();
    vi.mocked(actions.resume).mockRejectedValueOnce(new Error('host unavailable'));
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      await continueButton!.trigger('click');
      await flush();
      expect(w.get('.primary-row + .resume-refusal[role="status"]').text()).toContain('last sitting could not be resumed');

      await continueButton!.trigger('click');
      await flush();
      expect(w.find('.resume-refusal[role="status"]').exists()).toBe(false);
      expect(actions.resume).toHaveBeenCalledTimes(2);
    } finally {
      w.unmount();
    }
  });

  it('offers only Begin, as the primary action, with nothing to continue', async () => {
    const w = mount(Start, { props: { actions: spyActions(), resumable: false } });
    await flush();

    expect(w.findAll('button').some((b) => b.text() === 'Continue the last sitting')).toBe(false);
    const begin = w.get('button.primary');
    expect(begin.text()).toBe('Begin the signing');
  });
});

describe('named-save host selection is single-flight (#1502)', () => {
  it('keeps a slow named load from racing Begin, Continue, Import or another slot', async () => {
    const actions = spyActions([
      { slot: 'house-one', year: 1081 },
      { slot: 'house-two', year: 1112 },
    ]);
    let finish: ((success: boolean) => void) | undefined;
    vi.mocked(actions.load).mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { finish = resolve; }));
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      const saved = w.findAll('.saved li > button:first-child');
      expect(saved).toHaveLength(2);
      const buttons = w.findAll('.primary-row button');
      const continueButton = buttons.find((b) => b.text() === 'Continue the last sitting')!;
      const beginButton = buttons.find((b) => b.text() === 'Begin a new signing')!;
      const importButton = w.findAll('button').find((b) => b.text() === 'Bring a run in')!;

      await saved[0]!.trigger('click');
      expect(actions.load).toHaveBeenCalledTimes(1);
      expect(actions.load).toHaveBeenCalledWith('house-one');
      expect(saved[0]!.text()).toContain('Loading');
      for (const button of [saved[0]!, saved[1]!, continueButton, beginButton, importButton]) {
        expect(button.attributes('disabled')).toBeDefined();
        // Synthetic/stale clicks can still dispatch despite native disabled.
        button.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      expect(actions.load).toHaveBeenCalledTimes(1);
      expect(actions.begin).not.toHaveBeenCalled();
      expect(actions.resume).not.toHaveBeenCalled();
      expect(actions.importSave).not.toHaveBeenCalled();

      finish!(false);
      await flush();
      expect(w.get('.save-action-error').text()).toContain('could not be read');
      expect(saved[0]!.attributes('disabled')).toBeUndefined();
      expect(saved[1]!.attributes('disabled')).toBeUndefined();
      expect(continueButton.attributes('disabled')).toBeUndefined();
      expect(beginButton.attributes('disabled')).toBeUndefined();
      expect(importButton.attributes('disabled')).toBeUndefined();

      await saved[1]!.trigger('click');
      expect(actions.load).toHaveBeenLastCalledWith('house-two');
      expect(actions.load).toHaveBeenCalledTimes(2);
      expect(w.find('.save-action-error').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('releases the selection lock after a rejected host read', async () => {
    const actions = spyActions([{ slot: 'unreadable', year: 1072 }]);
    vi.mocked(actions.load).mockRejectedValueOnce(new Error('device unavailable'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      await w.get('.saved li > button:first-child').trigger('click');
      await flush();
      expect(w.get('.save-action-error').text()).toContain('could not be read');
      expect(w.get('.saved li > button:first-child').attributes('disabled')).toBeUndefined();
      await w.get('button.primary').trigger('click');
      expect(actions.begin).toHaveBeenCalledTimes(1);
    } finally {
      w.unmount();
    }
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

  it('reveals the autosave for copying out after Continue refuses, then hides it on retry (#1207)', async () => {
    const actions = spyActions([{ slot: 'autosave', year: 1090 }]);
    vi.mocked(actions.resume).mockResolvedValueOnce(false);
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      expect(w.find('section.saved').exists()).toBe(false);

      const continueButton = w.findAll('button').find((b) => b.text() === 'Continue the last sitting');
      expect(continueButton).toBeTruthy();
      await continueButton!.trigger('click');
      await flush();

      // Continue can fail after a host read succeeds. Retain access to the
      // original bytes via the normal export verb rather than losing the slot.
      expect(w.get('.resume-refusal').text()).toContain('could not be resumed');
      expect(w.get('section.saved').text()).toContain('The last sitting');
      const copyOut = w.get('section.saved').findAll('button').find((b) => b.text() === 'Copy out');
      expect(copyOut).toBeTruthy();
      await copyOut!.trigger('click');
      expect(actions.exportSave).toHaveBeenCalledWith('autosave');

      await continueButton!.trigger('click');
      await flush();
      expect(w.find('.resume-refusal').exists()).toBe(false);
      expect(w.find('section.saved').exists()).toBe(false);
      expect(actions.resume).toHaveBeenCalledTimes(2);
    } finally {
      w.unmount();
    }
  });

  it('still offers the autosave slot from the list when resumable lags behind it', async () => {
    const saves: SaveSummary[] = [{ slot: 'autosave', year: 1090 }];
    const w = mount(Start, { props: { actions: spyActions(saves), resumable: false } });
    await flush();

    expect(w.text()).toContain('The last sitting');
  });
});



describe('saved-run action failures (#1149)', () => {
  const savedRun: SaveSummary = { slot: 'chapter-1-1080', year: 1080 };

  it('explains a rejected named save load, then clears the refusal on retry', async () => {
    const actions = spyActions([savedRun]);
    vi.mocked(actions.load).mockRejectedValueOnce(new Error('host read failed'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const open = w.get('section.saved li > button');
      await open.trigger('click');
      await flush();
      expect(w.get('[role="status"]').text()).toContain('That saved run could not be read.');
      expect(actions.load).toHaveBeenCalledWith(savedRun.slot);

      await open.trigger('click');
      await flush();
      expect(actions.load).toHaveBeenCalledTimes(2);
      expect(w.find('[role="status"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it.each(['refused', 'rejected'] as const)(
    'keeps a later named-save refusal on its own row after the first load is %s (#1462, #1502)',
    async (olderOutcome) => {
      const actions = spyActions([
        { slot: 'chapter-old', year: 1080 },
        { slot: 'chapter-new', year: 1090 },
      ]);
      let resolveOld!: (value: boolean) => void;
      let rejectOld!: (reason: Error) => void;
      const oldLoad = new Promise<boolean>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      vi.mocked(actions.load).mockImplementation((slot) =>
        slot === 'chapter-old' ? oldLoad : Promise.resolve(false));
      const w = mount(Start, { props: { actions, resumable: false } });
      try {
        await flush();
        const rows = w.findAll('section.saved li');
        expect(rows).toHaveLength(2);
        await rows[0]!.find('button').trigger('click');
        // With single-flight selection, a second row cannot supersede the
        // original selection while its host request is still in flight.
        await rows[1]!.find('button').trigger('click');
        await flush();
        expect(actions.load).toHaveBeenCalledTimes(1);
        expect(rows[1]!.find('.save-action-error').exists()).toBe(false);

        if (olderOutcome === 'refused') resolveOld(false);
        else rejectOld(new Error('older host read failed'));
        await flush();
        expect(rows[0]!.get('.save-action-error').text()).toContain('could not be read');
        expect(rows[1]!.find('button').attributes('disabled')).toBeUndefined();

        // The next deliberate selection clears the old refusal, reports its
        // own result and cannot be overwritten by the already-settled read.
        await rows[1]!.find('button').trigger('click');
        await flush();
        expect(actions.load).toHaveBeenCalledTimes(2);
        expect(rows[1]!.get('.save-action-error').text()).toContain('could not be read');
        expect(rows[0]!.find('.save-action-error').exists()).toBe(false);
      } finally {
        w.unmount();
      }
    },
  );

  it('does not reopen a pending Import picker and recovers after dismissal or failure (#1477)', async () => {
    const actions = spyActions();
    let finishPicker!: (result: boolean | 'cancelled') => void;
    vi.mocked(actions.importSave)
      .mockImplementationOnce(() => new Promise<boolean | 'cancelled'>((resolve) => {
        finishPicker = resolve;
      }))
      .mockRejectedValueOnce(new Error('host picker unavailable'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const importButton = w.findAll('button').find((button) => button.text() === 'Bring a run in');
      expect(importButton).toBeDefined();
      await importButton!.trigger('click');
      expect(actions.importSave).toHaveBeenCalledTimes(1);
      expect(importButton!.attributes('disabled')).toBeDefined();
      expect(importButton!.text()).toBe('Importing…');

      // Even a synthetic click on a disabled control must not open another picker.
      await importButton!.trigger('click');
      expect(actions.importSave).toHaveBeenCalledTimes(1);
      finishPicker('cancelled'); // Dismissal is not an invalid save.
      await flush();
      expect(importButton!.attributes('disabled')).toBeUndefined();
      expect(w.find('[role="status"]').exists()).toBe(false);

      await importButton!.trigger('click');
      await flush();
      expect(actions.importSave).toHaveBeenCalledTimes(2);
      expect(w.get('[role="status"]').text()).toContain('That file was not a run this version can read.');
      expect(importButton!.attributes('disabled')).toBeUndefined();

      await importButton!.trigger('click');
      await flush();
      expect(actions.importSave).toHaveBeenCalledTimes(3);
      expect(w.find('[role="status"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('explains a rejected import and recovers when the next import succeeds', async () => {
    const actions = spyActions();
    vi.mocked(actions.importSave).mockRejectedValueOnce(new Error('file picker unavailable'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const bringIn = w.findAll('button').find((button) => button.text() === 'Bring a run in');
      expect(bringIn).toBeDefined();
      await bringIn!.trigger('click');
      await flush();
      expect(w.get('[role="status"]').text()).toContain('That file was not a run this version can read.');

      await bringIn!.trigger('click');
      await flush();
      expect(actions.importSave).toHaveBeenCalledTimes(2);
      expect(w.find('[role="status"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('explains rejected export and allows the same named run to be exported on retry', async () => {
    const actions = spyActions([savedRun]);
    vi.mocked(actions.exportSave).mockRejectedValueOnce(new Error('download blocked'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const copyOut = w.findAll('section.saved li button').find((button) => button.text() === 'Copy out');
      expect(copyOut).toBeDefined();
      await copyOut!.trigger('click');
      await flush();
      expect(w.get('[role="status"]').text()).toContain('That saved run could not be written out.');
      expect(actions.exportSave).toHaveBeenCalledWith(savedRun.slot);

      await copyOut!.trigger('click');
      await flush();
      expect(actions.exportSave).toHaveBeenCalledTimes(2);
      expect(w.find('[role="status"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });
});

describe('named save exports are single-flight per slot (#1510)', () => {
  it('refuses two same-tick clicks, disables the active button and permits a later export', async () => {
    const actions = spyActions([{ slot: 'chapter-1', year: 1080 }]);
    let finish!: (value: boolean) => void;
    vi.mocked(actions.exportSave).mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { finish = resolve; }));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const button = w.get('section.saved li').findAll('button')[1]!.element as HTMLButtonElement;
      // Both clicks use the old DOM before Vue patches its disabled state.
      button.click();
      button.click();
      expect(actions.exportSave).toHaveBeenCalledTimes(1);
      expect(actions.exportSave).toHaveBeenCalledWith('chapter-1');
      await flush();
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Copying out');

      finish(true);
      await flush();
      expect(button.disabled).toBe(false);
      expect(button.textContent).toContain('Copy out');
      button.click();
      await flush();
      expect(actions.exportSave).toHaveBeenCalledTimes(2);
    } finally {
      w.unmount();
    }
  });

  it('allows another slot while a prior export is pending, then unlocks the rejected slot', async () => {
    const actions = spyActions([
      { slot: 'chapter-old', year: 1080 },
      { slot: 'chapter-new', year: 1090 },
    ]);
    let rejectOld!: (error: Error) => void;
    vi.mocked(actions.exportSave).mockImplementationOnce(() =>
      new Promise<boolean>((_resolve, reject) => { rejectOld = reject; }));
    const w = mount(Start, { props: { actions, resumable: false, proseMode: 'plainenglish' } });
    try {
      await flush();
      const rows = w.findAll('section.saved li');
      const oldButton = rows[0]!.findAll('button')[1]!.element as HTMLButtonElement;
      const newButton = rows[1]!.findAll('button')[1]!.element as HTMLButtonElement;
      oldButton.click();
      await flush();
      expect(oldButton.disabled).toBe(true);
      expect(newButton.disabled).toBe(false);

      newButton.click();
      await flush();
      expect(actions.exportSave).toHaveBeenNthCalledWith(1, 'chapter-old');
      expect(actions.exportSave).toHaveBeenNthCalledWith(2, 'chapter-new');
      expect(newButton.disabled).toBe(false);
      expect(oldButton.disabled).toBe(true);

      rejectOld(new Error('host export failed'));
      await flush();
      expect(oldButton.disabled).toBe(false);
      oldButton.click();
      await flush();
      expect(actions.exportSave).toHaveBeenNthCalledWith(3, 'chapter-old');
      expect(oldButton.disabled).toBe(false);
    } finally {
      w.unmount();
    }
  });
});

/** The newest named save action owns the shared refusal row (#1469). */
describe('out-of-order named save actions (#1469)', () => {
  it.each(['refused', 'rejected'] as const)(
    'does not let an older %s export move the newest failed export to another row',
    async (olderOutcome) => {
      const actions = spyActions([
        { slot: 'chapter-old', year: 1080 },
        { slot: 'chapter-new', year: 1090 },
      ]);
      let resolveOld!: (result: boolean) => void;
      let rejectOld!: (error: Error) => void;
      const oldExport = new Promise<boolean>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      vi.mocked(actions.exportSave).mockImplementation((slot) =>
        slot === 'chapter-old' ? oldExport : Promise.resolve(false));
      const w = mount(Start, { props: { actions, resumable: false } });
      try {
        await flush();
        const rows = w.findAll('section.saved li');
        await rows[0]!.findAll('button')[1]!.trigger('click');
        await rows[1]!.findAll('button')[1]!.trigger('click');
        await flush();
        expect(rows[1]!.get('.save-action-error').text()).toContain('could not be written out');
        expect(rows[0]!.find('.save-action-error').exists()).toBe(false);

        if (olderOutcome === 'refused') resolveOld(false);
        else rejectOld(new Error('old export failed'));
        await flush();
        expect(rows[1]!.get('.save-action-error').text()).toContain('could not be written out');
        expect(rows[0]!.find('.save-action-error').exists()).toBe(false);
        expect(actions.exportSave).toHaveBeenNthCalledWith(1, 'chapter-old');
        expect(actions.exportSave).toHaveBeenNthCalledWith(2, 'chapter-new');
      } finally {
        w.unmount();
      }
    },
  );

  it('clears a pending export refusal when a newer load succeeds', async () => {
    const actions = spyActions([
      { slot: 'chapter-old', year: 1080 },
      { slot: 'chapter-new', year: 1090 },
    ]);
    let rejectOld!: (error: Error) => void;
    vi.mocked(actions.exportSave).mockImplementationOnce(
      () => new Promise<boolean>((_resolve, reject) => { rejectOld = reject; }),
    );
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const rows = w.findAll('section.saved li');
      await rows[0]!.findAll('button')[1]!.trigger('click');
      await rows[1]!.find('button').trigger('click');
      await flush();
      expect(w.find('section.saved .save-action-error').exists()).toBe(false);

      rejectOld(new Error('old export failed after newer load'));
      await flush();
      expect(w.find('section.saved .save-action-error').exists()).toBe(false);
      expect(actions.load).toHaveBeenCalledWith('chapter-new');
    } finally {
      w.unmount();
    }
  });

  it('keeps the newest failed export visible after an older load rejects', async () => {
    const actions = spyActions([
      { slot: 'chapter-old', year: 1080 },
      { slot: 'chapter-new', year: 1090 },
    ]);
    let rejectOld!: (error: Error) => void;
    vi.mocked(actions.load).mockImplementationOnce(
      () => new Promise<boolean>((_resolve, reject) => { rejectOld = reject; }),
    );
    vi.mocked(actions.exportSave).mockResolvedValueOnce(false);
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const rows = w.findAll('section.saved li');
      await rows[0]!.find('button').trigger('click');
      await rows[1]!.findAll('button')[1]!.trigger('click');
      await flush();
      expect(rows[1]!.get('.save-action-error').text()).toContain('could not be written out');

      rejectOld(new Error('old load failed'));
      await flush();
      expect(rows[1]!.get('.save-action-error').text()).toContain('could not be written out');
      expect(rows[0]!.find('.save-action-error').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });
});

describe('import feedback stays beside the import picker (#1342)', () => {
  it('keeps a rejected import separate from named-save errors', async () => {
    const actions = spyActions([{ slot: 'chapter-1080', year: 1080 }]);
    vi.mocked(actions.importSave).mockRejectedValueOnce(new Error('picker unavailable'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const bringIn = w.findAll('button').find((button) => button.text() === 'Bring a run in');
      await bringIn!.trigger('click');
      await flush();
      expect(w.get('div.row > [role="status"]').text()).toContain('That file was not a run');
      expect(w.find('section.saved [role="status"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });
});

describe('named-save failures belong to their row (#1342)', () => {
  it('anchors load/export refusal to the affected slot and removes it after a successful retry', async () => {
    const actions = spyActions([
      { slot: 'chapter-1080', year: 1080 },
      { slot: 'chapter-1090', year: 1090 },
    ]);
    vi.mocked(actions.load).mockRejectedValueOnce(new Error('host read refused'));
    vi.mocked(actions.exportSave).mockRejectedValueOnce(new Error('download refused'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const rows = w.findAll('section.saved li');
      expect(rows).toHaveLength(2);

      await rows[1]!.find('button').trigger('click');
      await flush();
      expect(rows[1]!.get('.save-action-error[role="status"]').text()).toContain('could not be read');
      expect(rows[0]!.find('.save-action-error').exists()).toBe(false);
      expect(w.find('div.row > [role="status"]').exists()).toBe(false);

      await rows[0]!.findAll('button')[1]!.trigger('click');
      await flush();
      expect(rows[0]!.get('.save-action-error[role="status"]').text()).toContain('could not be written out');
      expect(rows[1]!.find('.save-action-error').exists()).toBe(false);

      await rows[0]!.findAll('button')[1]!.trigger('click');
      await flush();
      expect(w.find('section.saved [role="status"]').exists()).toBe(false);
      expect(actions.exportSave).toHaveBeenCalledTimes(2);
    } finally {
      w.unmount();
    }
  });
});

describe('save list host failures (#1137)', () => {
  it('keeps saved-game listing Retry single-flight and restores retry after failure (#1475)', async () => {
    const actions = spyActions([{ slot: 'recovered-run', year: 1098 }]);
    let rejectPending!: (error: Error) => void;
    vi.mocked(actions.listSaves)
      .mockRejectedValueOnce(new Error('host offline'))
      .mockImplementationOnce(() => new Promise<SaveSummary[]>((_, reject) => {
        rejectPending = reject;
      }));
    const w = mount(Start, { props: { actions, resumable: false, proseMode: 'plainenglish' } });
    try {
      await flush();
      expect(w.get('.save-list-error[role="alert"]').text()).toContain('Could not list your saved games');
      const retry = w.get('.save-list-error button');
      await retry.trigger('click');
      expect(actions.listSaves).toHaveBeenCalledTimes(2);
      expect(retry.attributes('disabled')).toBeDefined();
      expect(retry.text()).toContain('Retrying');

      // A manually dispatched stale click must not start another host read.
      await retry.trigger('click');
      expect(actions.listSaves).toHaveBeenCalledTimes(2);
      rejectPending(new Error('still offline'));
      await flush();

      expect(retry.attributes('disabled')).toBeUndefined();
      expect(w.get('.save-list-error[role="alert"]').text()).toContain('Could not list your saved games');
      await retry.trigger('click');
      await flush();
      expect(actions.listSaves).toHaveBeenCalledTimes(3);
      expect(w.find('.save-list-error').exists()).toBe(false);
      expect(w.get('section.saved').text()).toContain('recovered-run');
    } finally {
      w.unmount();
    }
  });

  it('explains a rejected listing and restores the actual saves when Retry succeeds', async () => {
    const actions = spyActions([{ slot: 'chapter-1-1080', year: 1080 }]);
    vi.mocked(actions.listSaves).mockRejectedValueOnce(new Error('host unavailable'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      expect(w.get('.save-list-error[role="alert"]').text()).toContain('could not be listed');
      expect(w.find('section.saved').exists()).toBe(false);
      expect(actions.listSaves).toHaveBeenCalledTimes(1);

      await w.get('.save-list-error button').trigger('click');
      await flush();
      expect(actions.listSaves).toHaveBeenCalledTimes(2);
      expect(w.find('.save-list-error[role="alert"]').exists()).toBe(false);
      expect(w.text()).toContain('chapter-1-1080');
    } finally {
      w.unmount();
    }
  });

  it('keeps the retry available after two host failures, then clears the error', async () => {
    const actions = spyActions();
    vi.mocked(actions.listSaves)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'));
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      await w.get('.save-list-error button').trigger('click');
      await flush();
      expect(w.get('.save-list-error[role="alert"]').text()).toContain('could not be listed');
      expect(actions.listSaves).toHaveBeenCalledTimes(2);

      await w.get('.save-list-error button').trigger('click');
      await flush();
      expect(actions.listSaves).toHaveBeenCalledTimes(3);
      expect(w.find('.save-list-error').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });
});


describe('Library recovery retries (#1363)', () => {
  it('keeps the host read single-flight, then permits a retry after failure', async () => {
    const actions = spyActions();
    let rejectFirst: (() => void) | undefined;
    vi.mocked(actions.retryLibrary).mockImplementationOnce(
      () => new Promise<void>((_, reject) => {
        rejectFirst = () => reject(new Error('host still unavailable'));
      }),
    );
    const w = mount(Start, {
      props: { actions, resumable: false, libraryReady: false, libraryReadError: true },
    });
    try {
      await flush();
      const retry = w.findAll('button').find((button) => button.text() === 'Retry reading the Library');
      expect(retry).toBeTruthy();

      await retry!.trigger('click');
      expect(retry!.attributes('disabled')).toBeDefined();
      expect(retry!.text()).toContain('Retrying');
      // Ignore a second click even if it was already dispatched before the
      // disabled control rendered. This must not start a competing read.
      await retry!.trigger('click');
      expect(actions.retryLibrary).toHaveBeenCalledTimes(1);

      rejectFirst!();
      await flush();
      expect(retry!.attributes('disabled')).toBeUndefined();

      await retry!.trigger('click');
      await flush();
      expect(actions.retryLibrary).toHaveBeenCalledTimes(2);
      expect(retry!.attributes('disabled')).toBeUndefined();
    } finally {
      w.unmount();
    }
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
    expect(actions.deleteLibraryRun).not.toHaveBeenCalled();
    expect(w.get('.library-remove-confirm').text()).toContain('House Salt');
    expect(w.get('.library-remove-confirm').text()).toContain('cannot be undone');
    await w.get('button.confirm-remove').trigger('click');
    expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');

    const clear = w.findAll('button').find((button) => button.text() === 'Clear');
    await clear!.trigger('click');
    expect(actions.clearLibrary).not.toHaveBeenCalled();
    expect(w.text()).toContain('cannot be undone');
    await w.get('button.confirm-clear').trigger('click');
    expect(actions.clearLibrary).toHaveBeenCalledTimes(1);
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

  it('cancels a full-Library clear without touching any completed house', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false, library } });
    await flush();

    await w.get('.library-head button').trigger('click');
    expect(w.get('.library-clear-confirm').text()).toContain('cannot be undone');
    expect(actions.clearLibrary).not.toHaveBeenCalled();

    await w.findAll('.library-clear-confirm button')
      .find((button) => button.text() === 'Cancel')!.trigger('click');
    expect(w.find('.library-clear-confirm').exists()).toBe(false);
    expect(w.text()).toContain('House Salt');
    expect(actions.clearLibrary).not.toHaveBeenCalled();
  });

  it('reports a rejected Clear next to the Library and clears the error on retry', async () => {
    const actions = spyActions();
    vi.mocked(actions.clearLibrary).mockRejectedValueOnce(new Error('storage full'));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    await flush();

    await w.get('.library-head button').trigger('click');
    expect(actions.clearLibrary).not.toHaveBeenCalled();
    await w.get('button.confirm-clear').trigger('click');
    await flush();
    expect(w.get('.library [role="alert"]').text()).toContain('could not be cleared');
    expect(w.text()).toContain('House Salt');
    expect(actions.clearLibrary).toHaveBeenCalledTimes(1);

    await w.get('.library-head button').trigger('click');
    expect(actions.clearLibrary).toHaveBeenCalledTimes(1);
    await w.get('button.confirm-clear').trigger('click');
    await flush();
    expect(w.find('.library [role="alert"]').exists()).toBe(false);
    expect(actions.clearLibrary).toHaveBeenCalledTimes(2);
  });

  it('cancels individual removal, and a different house cannot confirm the first', async () => {
    const actions = spyActions();
    const multiple: RunLibrary = {
      ...library,
      runs: [...library.runs, { ...library.runs[0]!, id: 'lib_other', house: 'House Ash' }],
    };
    const w = mount(Start, { props: { actions, resumable: false, library: multiple } });
    try {
      await flush();
      // The Library is drawn newest first: Ash then Salt.
      await w.findAll('.library-run')[0]!.find('button').trigger('click');
      expect(w.get('.library-remove-confirm').text()).toContain('House Ash');
      expect(actions.deleteLibraryRun).not.toHaveBeenCalled();

      await w.findAll('.library-remove-confirm button')
        .find((button) => button.text() === 'Cancel')!.trigger('click');
      expect(w.find('.library-remove-confirm').exists()).toBe(false);
      expect(actions.deleteLibraryRun).not.toHaveBeenCalled();

      await w.findAll('.library-run')[0]!.find('button').trigger('click');
      await w.findAll('.library-run')[1]!.find('button').trigger('click');
      expect(w.findAll('.library-remove-confirm')).toHaveLength(1);
      expect(w.get('.library-remove-confirm').text()).toContain('House Salt');

      await w.get('button.confirm-remove').trigger('click');
      expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(1);
      expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');
    } finally {
      w.unmount();
    }
  });

  it('clearing the Library cancels an unrelated pending single-house removal', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false, library } });
    try {
      await flush();
      await w.get('.library-title button').trigger('click');
      expect(w.find('.library-remove-confirm').exists()).toBe(true);

      await w.get('.library-head button').trigger('click');
      expect(w.find('.library-remove-confirm').exists()).toBe(false);
      expect(actions.deleteLibraryRun).not.toHaveBeenCalled();

      await w.get('button.confirm-clear').trigger('click');
      expect(actions.clearLibrary).toHaveBeenCalledTimes(1);
      expect(actions.deleteLibraryRun).not.toHaveBeenCalled();
    } finally {
      w.unmount();
    }
  });

  it('holds single-house Remove while a full-Library clear is pending and recovers on failure (#1331)', async () => {
    const actions = spyActions();
    let rejectClear: (() => void) | undefined;
    vi.mocked(actions.clearLibrary).mockImplementation(() => new Promise<void>((_, reject) => {
      rejectClear = () => reject(new Error('host storage refused clear'));
    }));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    try {
      await flush();
      await w.get('.library-head button').trigger('click');
      await w.get('button.confirm-clear').trigger('click');
      expect(actions.clearLibrary).toHaveBeenCalledTimes(1);
      expect(w.get('.library-head button').text()).toContain('Clearing');
      expect(w.get('.library-head button').attributes('disabled')).toBeDefined();

      const remove = w.get('.library-title button');
      expect(remove.attributes('disabled')).toBeDefined();
      await remove.trigger('click');
      expect(w.find('.library-remove-confirm').exists()).toBe(false);
      expect(actions.deleteLibraryRun).not.toHaveBeenCalled();

      rejectClear!();
      await flush();
      expect(w.get('.library [role="alert"]').text()).toContain('could not be cleared');
      expect(w.get('.library-head button').attributes('disabled')).toBeUndefined();
      expect(remove.attributes('disabled')).toBeUndefined();
      await remove.trigger('click');
      await w.get('button.confirm-remove').trigger('click');
      expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');
    } finally {
      w.unmount();
    }
  });

  it('holds Clear while a single-house removal is pending (#1331)', async () => {
    const actions = spyActions();
    let finishRemove: (() => void) | undefined;
    vi.mocked(actions.deleteLibraryRun).mockImplementation(() => new Promise<void>((resolve) => {
      finishRemove = resolve;
    }));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    try {
      await flush();
      await w.get('.library-title button').trigger('click');
      await w.get('button.confirm-remove').trigger('click');
      expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(1);
      const clear = w.get('.library-head button');
      expect(clear.attributes('disabled')).toBeDefined();
      await clear.trigger('click');
      expect(w.find('.library-clear-confirm').exists()).toBe(false);
      expect(actions.clearLibrary).not.toHaveBeenCalled();

      finishRemove!();
      await flush();
      expect(clear.attributes('disabled')).toBeUndefined();
      await clear.trigger('click');
      await w.get('button.confirm-clear').trigger('click');
      expect(actions.clearLibrary).toHaveBeenCalledTimes(1);
    } finally {
      w.unmount();
    }
  });

  it('never submits a second deletion while the host is still removing that house', async () => {
    const actions = spyActions();
    let finishDelete: (() => void) | undefined;
    vi.mocked(actions.deleteLibraryRun).mockImplementation(() => new Promise<void>((resolve) => {
      finishDelete = resolve;
    }));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    try {
      await flush();
      await w.get('.library-title button').trigger('click');
      await w.get('button.confirm-remove').trigger('click');
      expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(1);
      expect(w.get('button.confirm-remove').attributes('disabled')).toBeDefined();

      await w.get('button.confirm-remove').trigger('click');
      expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(1);
      finishDelete!();
      await flush();
      expect(w.find('.library-remove-confirm').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('reports a rejected Remove without an unhandled rejection, and lets it retry', async () => {
    const actions = spyActions();
    vi.mocked(actions.deleteLibraryRun).mockRejectedValueOnce(new Error('read-only host'));
    const w = mount(Start, { props: { actions, resumable: false, library } });
    await flush();

    await w.get('.library-title button').trigger('click');
    expect(actions.deleteLibraryRun).not.toHaveBeenCalled();
    await w.get('button.confirm-remove').trigger('click');
    await flush();
    expect(w.get('.library [role="alert"]').text()).toContain('could not be removed');
    expect(w.text()).toContain('House Salt');
    expect(actions.deleteLibraryRun).toHaveBeenCalledWith('lib_old');

    // The rejected host write retains the confirmation so a retry is explicit.
    expect(w.get('.library-remove-confirm').text()).toContain('House Salt');
    await w.get('button.confirm-remove').trigger('click');
    await flush();
    expect(w.find('.library [role="alert"]').exists()).toBe(false);
    expect(actions.deleteLibraryRun).toHaveBeenCalledTimes(2);
    expect(w.find('.library-remove-confirm').exists()).toBe(false);
  });
});

describe('Start routes prose changes through its parent (#1340)', () => {
  it('emits the chosen mode once without dispatching directly to the game store', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false, proseMode: 'original' } });
    try {
      await flush();
      const select = w.get('select[aria-label="Prose style"]');
      expect((select.element as HTMLSelectElement).value).toBe('original');

      await select.setValue('plainenglish');
      expect(w.emitted('update:proseMode')).toEqual([['plainenglish']]);
      // App.vue owns createProseModeSelector and its async catalogue loading.
      // Start must not issue a second setProseMode/refresh behind that owner.
      expect(actions.setProseMode).not.toHaveBeenCalled();

      await w.setProps({ proseMode: 'plainenglish' });
      expect((select.element as HTMLSelectElement).value).toBe('plainenglish');
    } finally {
      w.unmount();
    }
  });
});

describe('advanced seed rejects empty and invalid numbers (#1051)', () => {
  it.each([
    ['', 'cleared'],
    ['-1', 'negative'],
    ['1.5', 'fractional'],
    ['4294967296', 'outside the 32-bit range'],
  ])('refuses a %s (%s) seed without calling begin', async (value) => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      const advanced = w.findAll('button').find((button) => button.text() === 'Advanced');
      await advanced!.trigger('click');
      await w.get('#seed').setValue(value);

      const begin = w.get('button.primary');
      expect(begin.attributes('disabled')).toBeDefined();
      expect(w.get('#seed').attributes('aria-invalid')).toBe('true');
      expect(w.get('#seed-error').text()).toContain('whole number');
      await begin.trigger('click'); // The handler also guards synthetic clicks.
      expect(actions.begin).not.toHaveBeenCalled();
    } finally {
      w.unmount();
    }
  });

  it('accepts zero and the largest unsigned seed, and re-enables Begin after an invalid edit', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: false } });
    try {
      await flush();
      await w.findAll('button').find((button) => button.text() === 'Advanced')!.trigger('click');
      const input = w.get('#seed');
      const begin = w.get('button.primary');

      await input.setValue('');
      expect(begin.attributes('disabled')).toBeDefined();
      await input.setValue('0');
      expect(begin.attributes('disabled')).toBeUndefined();
      expect(input.attributes('aria-invalid')).toBe('false');
      expect(w.find('#seed-error').exists()).toBe(false);
      await begin.trigger('click');
      expect(actions.begin).toHaveBeenLastCalledWith(0, 'short');

      await input.setValue('4294967295');
      expect(begin.attributes('disabled')).toBeUndefined();
      await begin.trigger('click');
      expect(actions.begin).toHaveBeenLastCalledWith(4294967295, 'short');
      expect(actions.begin).toHaveBeenCalledTimes(2);
    } finally {
      w.unmount();
    }
  });

  it('keeps Continue available even when the new-run Advanced seed is invalid', async () => {
    const actions = spyActions();
    const w = mount(Start, { props: { actions, resumable: true } });
    try {
      await flush();
      await w.findAll('button').find((button) => button.text() === 'Advanced')!.trigger('click');
      await w.get('#seed').setValue('');
      const continueButton = w.findAll('button').find((button) => button.text() === 'Continue the last sitting');
      expect(continueButton?.attributes('disabled')).toBeUndefined();
      await continueButton!.trigger('click');
      expect(actions.resume).toHaveBeenCalledTimes(1);
      expect(actions.begin).not.toHaveBeenCalled();
    } finally {
      w.unmount();
    }
  });
});


describe('reader-local Start guidance and actions (#1452)', () => {
  const finished: RunLibrary = {
    format: 1,
    runs: [{
      id: 'house_ending', seed: 9, campaign: 'short', endedYear: 1342,
      house: 'House Salt', ending: { id: 'forgotten', title: 'Forgotten' },
      entries: [{
        id: 'recorded-page', year: 1222,
        said: 'A recorded sentence that must not be translated.',
        people: {}, claims: [],
      }],
    }],
  };

  it('switches Original -> Plain English -> Original without changing begin, import or export', async () => {
    const actions = spyActions([{ slot: 'chapter-one', year: 1120 }]);
    const w = mount(Start, { props: {
      actions, resumable: true, proseMode: 'original', library: finished,
    } });
    try {
      await flush();
      expect(w.text()).toContain('The length of the line');
      expect(w.text()).toContain('Continue the last sitting');
      expect(w.text()).toContain('Bring a run in');
      expect(w.text()).toContain('The Library of Houses');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('Choose the length of your game');
      expect(w.text()).toContain('Continue your last game');
      expect(w.text()).toContain('Start a new game');
      expect(w.text()).toContain('Import a saved game');
      expect(w.text()).toContain('Completed houses');
      expect(w.text()).toContain('300 years');
      expect(w.text()).toContain('1120');
      expect(w.text()).toContain('A recorded sentence that must not be translated.');

      await w.findAll('button').find((b) => b.text() === 'Start a new game')!.trigger('click');
      expect(actions.begin).toHaveBeenCalledWith(expect.any(Number), 'short');
      await w.findAll('.saved button').find((b) => b.text() === 'Export')!.trigger('click');
      expect(actions.exportSave).toHaveBeenCalledWith('chapter-one');
      await w.findAll('button').find((b) => b.text() === 'Import a saved game')!.trigger('click');
      expect(actions.importSave).toHaveBeenCalledTimes(1);

      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('Continue the last sitting');
      expect(w.text()).toContain('Bring a run in');
      expect(w.text()).toContain('The Library of Houses');
      expect(w.text()).not.toContain('Completed houses');
      expect(w.text()).toContain('A recorded sentence that must not be translated.');
      expect(actions.setProseMode).not.toHaveBeenCalled();
    } finally {
      w.unmount();
    }
  });

  it('keeps warning/disabled states and destructive dispatch while translating live errors', async () => {
    const actions = spyActions([{ slot: 'chapter-one', year: 1120 }]);
    vi.mocked(actions.resume).mockResolvedValue(false);
    vi.mocked(actions.exportSave).mockResolvedValue(false);
    const w = mount(Start, { props: {
      actions, resumable: true, proseMode: 'plainenglish', library: finished, libraryReady: true,
    } });
    try {
      await flush();
      await w.findAll('button').find((b) => b.text() === 'Continue your last game')!.trigger('click');
      await flush();
      expect(w.get('.resume-refusal').text()).toContain('Could not continue your last game');

      await w.findAll('.saved button').find((b) => b.text() === 'Export')!.trigger('click');
      await flush();
      expect(w.get('.saved .save-action-error').text()).toContain('Could not export this saved game.');

      const advanced = w.findAll('button').find((b) => b.text() === 'Advanced options')!;
      await advanced.trigger('click');
      await w.get('#seed').setValue('');
      const start = w.findAll('button').find((b) => b.text() === 'Start a new game')!;
      expect(start.attributes('disabled')).toBeDefined();
      expect(w.get('#seed-error').text()).toContain('whole number');
      expect(actions.begin).not.toHaveBeenCalled();

      await w.get('.library-head button').trigger('click');
      expect(w.get('.library-clear-confirm').text()).toContain('cannot be undone');
      expect(actions.clearLibrary).not.toHaveBeenCalled();
      await w.get('button.confirm-clear').trigger('click');
      expect(actions.clearLibrary).toHaveBeenCalledTimes(1);

      await w.setProps({ proseMode: 'original' });
      expect(w.get('.resume-refusal').text()).toContain('The last sitting could not be resumed.');
      expect(w.get('.saved .save-action-error').text()).toContain('That saved run could not be written out.');
      expect(w.text()).toContain('The Library of Houses');
    } finally {
      w.unmount();
    }
  });
});

/** The measured client mounting lane also exercises sibling onboarding orders. */
function namingView(...people: string[]): SessionView {
  return {
    namesWanted: people.map((person, index) => ({
      person,
      born: 1080,
      sex: index % 2 === 0 ? 'male' : 'female',
      suggested: `Suggested ${index}`,
      because: 'The chronicler has a reason.',
    })),
  } as unknown as SessionView;
}

function namingActions(): GameActions {
  return {
    name: vi.fn(() => true),
    keepSuggestedName: vi.fn(() => true),
    keepSuggestedNames: vi.fn(),
  } as unknown as GameActions;
}

describe('newborn naming submit single-flight (#1486)', () => {
  it('blocks same-tick Name, Keep and Enter for one child without blocking another', async () => {
    const game = namingActions();
    const wrapper = mount(Naming, { props: { view: namingView('child-1', 'child-2'), actions: game } });
    try {
      const children = wrapper.findAll('.child');
      await children[0]!.get('input').setValue('Mara');
      await children[1]!.get('input').setValue('Lena');
      const nameFirst = children[0]!.findAll('button')[0]!.element as HTMLButtonElement;
      const keepFirst = children[0]!.findAll('button')[1]!.element as HTMLButtonElement;
      const nameSecond = children[1]!.findAll('button')[0]!.element as HTMLButtonElement;

      // Synchronous DOM events, without the Vue tick introduced by trigger().
      nameFirst.click();
      nameFirst.click(); // The first success already cleared the draft.
      keepFirst.click();
      children[0]!.get('input').element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      nameSecond.click(); // A different child is independent.

      expect(game.name).toHaveBeenCalledTimes(2);
      expect(game.name).toHaveBeenNthCalledWith(1, 'child-1', 'Mara');
      expect(game.name).toHaveBeenNthCalledWith(2, 'child-2', 'Lena');
      expect(game.keepSuggestedName).not.toHaveBeenCalled();
      await nextTick();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('blocks Keep→Name, a duplicate Keep and bulk Keep; a refused order can retry next tick', async () => {
    const game = namingActions();
    const keepSuggestedName = vi.fn(() => false);
    game.keepSuggestedName = keepSuggestedName;
    const wrapper = mount(Naming, { props: { view: namingView('child-1', 'child-2'), actions: game } });
    try {
      await wrapper.get('.child input').setValue('Mara');
      const child = wrapper.get('.child');
      const name = child.findAll('button')[0]!.element as HTMLButtonElement;
      const keep = child.findAll('button')[1]!.element as HTMLButtonElement;
      const keepAll = wrapper.findAll('button')
        .find((button) => button.text() === 'Keep the names he suggests')!.element as HTMLButtonElement;

      keep.click();
      keep.click();
      name.click();
      keepAll.click();

      expect(keepSuggestedName).toHaveBeenCalledOnce();
      expect(keepSuggestedName).toHaveBeenCalledWith('child-1');
      expect(game.name).not.toHaveBeenCalled();
      expect(game.keepSuggestedNames).not.toHaveBeenCalled();

      await nextTick();
      keep.click();
      expect(keepSuggestedName).toHaveBeenCalledTimes(2);
      await nextTick();
      keepAll.click(); // The queue-wide action can run after individual refusal.
      expect(game.keepSuggestedNames).toHaveBeenCalledOnce();
    } finally {
      wrapper.unmount();
    }
  });
});

