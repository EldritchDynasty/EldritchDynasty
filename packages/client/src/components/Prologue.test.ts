// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { PrologueView, SessionView } from '@ed/core';
import { hasSeenProse, prologueSeenText, rememberSeenProse, seenProseKey } from '../lib/accessibility';
import { FOUNDER_NAME_MAX, type ChapterBeat, type GameActions } from '../lib/game';
import Prologue from './Prologue.vue';
import Naming from './Naming.vue';
import Chapter from './Chapter.vue';
import Interlude from './Interlude.vue';
import Line from './Line.vue';
import type { FrameEntry } from '@ed/schema';

function prologueView(): PrologueView {
  return {
    id: 'the_signing',
    opening: 'Opening.',
    triad: [
      { given: 'First given.', owed: 'First owed.' },
      { given: 'Second given.', owed: 'Second owed.' },
      { given: 'Third given.', owed: 'Third owed.' },
    ],
    namePrompt: 'What are you called?',
    examination: Array.from({ length: 4 }, (_, questionIndex) => ({
      id: `question_${questionIndex + 1}`,
      situation: `Situation ${questionIndex + 1}`,
      answers: Array.from({ length: 3 }, (_, answerIndex) => ({
        id: `answer_${questionIndex + 1}_${answerIndex + 1}`,
        says: `Answer ${questionIndex + 1}.${answerIndex + 1}`,
        given: `Given ${questionIndex + 1}.${answerIndex + 1}`,
        owed: `Owed ${questionIndex + 1}.${answerIndex + 1}`,
      })),
    })),
    housePrompt: 'Name the house.',
    friendsPrompt: 'Name five.',
    friendsWanted: 0,
    heirlooms: [{
      heirloom: 'seal',
      name: 'The Seal',
      blurb: 'A seal.',
      line: 'He asked for the seal.',
    }],
    grudges: [{
      house: 'house_marrow',
      houseName: 'House Marrow',
      line: 'Marrow paid.',
    }],
    thesis: 'Everything after this was done by people who did not sign it.',
  };
}

function actions() {
  return {
    found: vi.fn(() => ({ ok: false, reason: 'test' })),
    enter: vi.fn(),
  } as unknown as GameActions;
}

async function revealChoices(wrapper: VueWrapper): Promise<void> {
  for (const label of ['The first thing', 'The second thing', 'The third thing']) {
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
    expect(button, `missing "${label}" prologue advance button`).toBeTruthy();
    await button!.trigger('click');
  }
}

function answerButton(wrapper: VueWrapper, question: number, answer = 1) {
  const label = `Answer ${question}.${answer}`;
  const button = wrapper.findAll('.examination button').find((candidate) => candidate.text().includes(label));
  expect(button, `missing "${label}"`).toBeTruthy();
  return button!;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('held Enter in newborn naming (#1471)', () => {
  it('ignores auto-repeated Enter without hiding a deliberate naming submission', async () => {
    const name = vi.fn(() => true);
    const wrapper = mount(Naming, {
      props: {
        view: {
          namesWanted: [{
            person: 'child-1',
            born: 1060,
            sex: 'female',
            suggested: 'Mara',
            because: 'Her kin asked for a name.',
          }],
        } as unknown as SessionView,
        actions: { name } as unknown as GameActions,
      },
    });

    try {
      const input = wrapper.get('input');
      await input.setValue('Alys');
      await input.trigger('keydown', { key: 'Enter', repeat: true });
      expect(name).not.toHaveBeenCalled();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);

      await input.trigger('keydown', { key: 'Enter', repeat: false });
      expect(name).toHaveBeenCalledTimes(1);
      expect(name).toHaveBeenCalledWith('child-1', 'Alys');

      // The old view can remain mounted for another tick after the name is
      // accepted; repeated keydown must neither resubmit nor show a refusal.
      await input.trigger('keydown', { key: 'Enter', repeat: true });
      expect(name).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('founding submit single-flight (#1484)', () => {
  it('discards same-tick clicks and Enter, then permits a deliberate retry after refusal', async () => {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue: prologueView(),
        actions: game,
        refused: null,
        startYear: 1042,
      },
    });

    try {
      await revealChoices(wrapper);
      for (let question = 1; question <= 4; question += 1) {
        await answerButton(wrapper, question).trigger('click');
      }
      await wrapper.findAll('button').find((button) => button.text().includes('The Seal'))!.trigger('click');
      await wrapper.findAll('button').find((button) => button.text().includes('House Marrow'))!.trigger('click');
      const house = wrapper.get('input[aria-label="Name the house"]');
      await house.setValue('House Ash');
      const sign = wrapper.get('button.sign');
      expect(sign.attributes('disabled')).toBeUndefined();

      // Real DOM events, deliberately not Vue Test Utils trigger(): trigger()
      // yields a render tick, which would hide this event-burst race.
      (sign.element as HTMLButtonElement).click();
      (sign.element as HTMLButtonElement).click();
      house.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(game.found).toHaveBeenCalledTimes(1);
      expect(game.found).toHaveBeenCalledWith({
        houseName: 'House Ash',
        heirloom: 'seal',
        grudge: 'house_marrow',
        friends: [],
        founderName: '',
        answers: {
          question_1: 'answer_1_1',
          question_2: 'answer_2_1',
          question_3: 'answer_3_1',
          question_4: 'answer_4_1',
        },
      });

      // The mocked founding was refused, so the same rendered form remains.
      // It must not permanently latch the button against a later retry.
      await nextTick();
      (sign.element as HTMLButtonElement).click();
      expect(game.found).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('The Examination (#343)', () => {
  it('uses the person-name limit, keeps mechanics hidden until selection, and uses native keyboard controls', async () => {
    const wrapper = mount(Prologue, {
      props: {
        prologue: prologueView(),
        actions: actions(),
        refused: null,
        startYear: 1042,
      },
    });
    await revealChoices(wrapper);

    const founder = wrapper.get('input[aria-label="Name the founder"]');
    expect(founder.attributes('maxlength')).toBe(String(FOUNDER_NAME_MAX));

    expect(wrapper.text()).toContain('Situation 1');
    expect(wrapper.text()).toContain('Situation 4');
    expect(wrapper.findAll('.examination button')).toHaveLength(12);
    expect(wrapper.findAll('.examination button').every((button) => button.element.tagName === 'BUTTON')).toBe(true);

    expect(wrapper.text()).not.toContain('Given 1.1');
    expect(wrapper.text()).not.toContain('Owed 1.1');

    await answerButton(wrapper, 1).trigger('click');

    expect(answerButton(wrapper, 1).attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Given 1.1');
    expect(wrapper.text()).toContain('Owed 1.1');
    expect(wrapper.text()).not.toContain('Given 1.2');
  });

  it('fast-forwards seen prose without choosing any Examination answer', () => {
    const prologue = prologueView();
    const replayText = prologueSeenText(prologue.opening, prologue.triad, prologue.thesis);
    rememberSeenProse(window.localStorage, seenProseKey('prologue', replayText));

    const wrapper = mount(Prologue, {
      props: {
        prologue,
        actions: actions(),
        refused: null,
        startYear: 1042,
        skipSeenProse: true,
      },
    });

    expect(wrapper.findAll('.triad li')).toHaveLength(3);
    expect(wrapper.text()).toContain('Situation 1');
    expect(wrapper.text()).toContain('Situation 4');
    expect(wrapper.findAll('.examination button')).toHaveLength(12);
    expect(wrapper.findAll('.examination button').every((button) => button.attributes('aria-pressed') === 'false')).toBe(true);
    expect(wrapper.get('button.sign').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).not.toContain('Given 1.1');
    expect(wrapper.text()).not.toContain('Owed 1.1');
  });

  it('does not bypass disabled signing requirements when Enter is pressed (#1143)', async () => {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue: prologueView(),
        actions: game,
        refused: null,
        startYear: 1042,
      },
    });
    await revealChoices(wrapper);
    const house = wrapper.get('input[aria-label="Name the house"]');
    await house.setValue('House Ash');

    // Enter dispatches the handler even though the Sign button is disabled.
    expect(wrapper.get('button.sign').attributes('disabled')).toBeDefined();
    await house.trigger('keydown', { key: 'Enter' });
    expect(game.found).not.toHaveBeenCalled();

    for (let question = 1; question <= 4; question += 1) {
      await answerButton(wrapper, question).trigger('click');
    }
    await wrapper.findAll('button').find((button) => button.text().includes('The Seal'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('House Marrow'))!.trigger('click');

    expect(wrapper.get('button.sign').attributes('disabled')).toBeUndefined();
    await house.trigger('keydown', { key: 'Enter' });
    expect(game.found).toHaveBeenCalledTimes(1);
    expect(game.found).toHaveBeenCalledWith(expect.objectContaining({
      houseName: 'House Ash',
      heirloom: 'seal',
      grudge: 'house_marrow',
      answers: expect.objectContaining({ question_1: 'answer_1_1' }),
    }));
    wrapper.unmount();
  });

  it('requires every Examination choice and sends founder name plus stable answer ids to found()', async () => {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue: prologueView(),
        actions: game,
        refused: null,
        startYear: 1042,
      },
    });
    await revealChoices(wrapper);

    await wrapper.get('input[aria-label="Name the founder"]').setValue('Alys');
    await wrapper.findAll('button').find((button) => button.text().includes('The Seal'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('House Marrow'))!.trigger('click');
    await wrapper.get('input[aria-label="Name the house"]').setValue('House Ash');

    const sign = wrapper.get('button.sign');
    expect(sign.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('an answer to each Examination question');

    for (let question = 1; question <= 4; question += 1) {
      await answerButton(wrapper, question).trigger('click');
    }

    expect(sign.attributes('disabled')).toBeUndefined();
    await sign.trigger('click');

    expect(game.found).toHaveBeenCalledWith({
      houseName: 'House Ash',
      heirloom: 'seal',
      grudge: 'house_marrow',
      friends: [],
      founderName: 'Alys',
      answers: {
        question_1: 'answer_1_1',
        question_2: 'answer_2_1',
        question_3: 'answer_3_1',
        question_4: 'answer_4_1',
      },
    });
  });
});


describe('live prologue Skip seen preference (#1514)', () => {
  it('reveals a previously read prologue when skipping is enabled in place, and restores the progressive reading when disabled', async () => {
    const prologue = prologueView();
    const text = prologueSeenText(prologue.opening, prologue.triad, prologue.thesis);
    rememberSeenProse(window.localStorage, seenProseKey('prologue', text));
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue,
        actions: game,
        refused: null,
        startYear: 1042,
        skipSeenProse: false,
      },
    });
    try {
      expect(wrapper.findAll('.triad li')).toHaveLength(0);
      expect(wrapper.get('button.on').text()).toBe('The first thing');

      // The preference is changed without remounting or translating the text.
      await wrapper.setProps({ skipSeenProse: true });
      expect(wrapper.findAll('.triad li')).toHaveLength(3);
      expect(wrapper.find('.examination').exists()).toBe(true);
      expect(wrapper.get('button.sign').attributes('disabled')).toBeDefined();
      expect(game.found).not.toHaveBeenCalled();

      await wrapper.setProps({ skipSeenProse: false });
      expect(wrapper.findAll('.triad li')).toHaveLength(0);
      expect(wrapper.get('button.on').text()).toBe('The first thing');
      expect(wrapper.find('.examination').exists()).toBe(false);
      expect(game.found).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });
});

describe('Plain English prologue replay identity (#410)', () => {
  it('restarts an unread translation and remembers the wording actually revealed', async () => {
    const original = prologueView();
    const plain = { ...original, opening: 'A simpler opening for the same signing.' };
    const keyFor = (view: PrologueView) => seenProseKey(
      'prologue', prologueSeenText(view.opening, view.triad, view.thesis),
    );
    const wrapper = mount(Prologue, {
      props: {
        prologue: original,
        actions: actions(),
        refused: null,
        startYear: 1042,
        skipSeenProse: true,
      },
    });

    await wrapper.get('button.on').trigger('click');
    expect(wrapper.findAll('.triad li')).toHaveLength(1);

    // An in-place settings toggle refreshes the read model without remounting
    // this component. Do not carry the partial Original reveal into Plain English.
    await wrapper.setProps({ prologue: plain });
    expect(wrapper.text()).toContain(plain.opening);
    expect(wrapper.findAll('.triad li')).toHaveLength(0);

    await revealChoices(wrapper);
    await answerButton(wrapper, 1).trigger('click');
    await wrapper.get('input[aria-label="Name the house"]').setValue('House Cedar');
    expect(hasSeenProse(window.localStorage, keyFor(plain))).toBe(true);
    expect(hasSeenProse(window.localStorage, keyFor(original))).toBe(false);

    // Only the completed translation is a repeat. Original has not been read.
    // Toggling the words must not discard answers already entered by the player.
    await wrapper.setProps({ prologue: original });
    expect(wrapper.findAll('.triad li')).toHaveLength(0);
    await wrapper.setProps({ prologue: plain });
    expect(wrapper.findAll('.triad li')).toHaveLength(3);
    expect(answerButton(wrapper, 1).attributes('aria-pressed')).toBe('true');
    expect((wrapper.get('input[aria-label="Name the house"]').element as HTMLInputElement).value)
      .toBe('House Cedar');
  });
});

/** A synchronous activation burst cannot consume several queued Age beats. */
describe('Chapter dismissal is single-flight (#1488)', () => {
  const opening = (text: string) => ({ kind: 'opening', opening: { text } } as ChapterBeat);

  it('coalesces button, backdrop and Escape until a successor renders', async () => {
    const dismissChapter = vi.fn();
    const game = { dismissChapter } as unknown as GameActions;
    const wrapper = mount(Chapter, {
      attachTo: document.body,
      props: { beat: opening('First Age.'), actions: game },
    });

    try {
      const goOn = wrapper.get('button.quiet').element as HTMLButtonElement;
      // Deliberately use native events rather than trigger(), which adds a tick.
      goOn.click();
      goOn.click();
      wrapper.get('.scrim').element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }));
      expect(dismissChapter).toHaveBeenCalledTimes(1);

      // App retains the same instance as its next queued beat replaces this one.
      await wrapper.setProps({ beat: opening('Second Age.') });
      expect(wrapper.text()).toContain('Second Age.');
      goOn.click();
      goOn.click();
      expect(dismissChapter).toHaveBeenCalledTimes(2);

      // A refusal/no-op must also be retryable if the queue is not updated.
      await nextTick();
      goOn.click();
      expect(dismissChapter).toHaveBeenCalledTimes(3);
    } finally {
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe('Age opening replay on a reused Chapter dialog (#410)', () => {
  it('records each unseen opening and skips a repeat when the chapter queue advances', async () => {
    window.localStorage.clear();
    const repeated = 'The familiar Age opening.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', repeated));

    const dismissChapter = vi.fn();
    const actions = { dismissChapter } as unknown as GameActions;
    const opening = (text: string) => ({
      kind: 'opening', opening: { text },
    } as ChapterBeat);

    const wrapper = mount(Chapter, {
      props: { beat: opening('A fresh Age.'), actions, skipSeenProse: true },
    });
    expect(hasSeenProse(window.localStorage, seenProseKey('chapter-opening', 'A fresh Age.'))).toBe(true);
    expect(dismissChapter).not.toHaveBeenCalled();

    // App keeps this component instance when dismissChapter shifts its queue.
    // A mount-only replay check would never skip the following repeat.
    await wrapper.setProps({ beat: opening(repeated) });
    expect(dismissChapter).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ beat: opening('A third, unseen Age.') });
    expect(hasSeenProse(window.localStorage, seenProseKey('chapter-opening', 'A third, unseen Age.'))).toBe(true);
    expect(dismissChapter).toHaveBeenCalledTimes(1);

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
  it('keeps Escape and Tab trapping after an initially skipped opening, and removes the listener on unmount', async () => {
    const repeated = 'An opening already read in a previous sitting.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', repeated));

    const dismissChapter = vi.fn();
    const actions = { dismissChapter } as unknown as GameActions;
    const opening = (text: string) => ({
      kind: 'opening', opening: { text },
    } as ChapterBeat);
    const outside = document.createElement('button');
    outside.textContent = 'Outside the dialog';
    document.body.appendChild(outside);

    // App reuses the mounted dialog when dismissing one queued Chapter.
    const wrapper = mount(Chapter, {
      attachTo: document.body,
      props: { beat: opening(repeated), actions, skipSeenProse: true },
    });
    try {
      expect(dismissChapter).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ beat: opening('An unread Age begins.') });
      expect(dismissChapter).toHaveBeenCalledTimes(1);

      // Without the mount-time keydown listener, focus escapes a modal dialog.
      outside.focus();
      expect(document.activeElement).toBe(outside);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(wrapper.get('button').element);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(dismissChapter).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
      outside.remove();
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismissChapter).toHaveBeenCalledTimes(2);
  });

});


/**
 * Both Chapter and Interlude now delegate global Escape handling to useModal.
 * This mounted regression proves the IME/repeat behavior survived the move,
 * rather than trusting a source-level import alone.
 */
describe('standalone dialog Escape while composing an IME candidate (#1290)', () => {
  function escapeKey(composing = false, legacyKeyCode?: number, repeat = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true, repeat,
    });
    Object.defineProperty(event, 'isComposing', { value: composing });
    if (legacyKeyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: legacyKeyCode });
    }
    return event;
  }

  it.each(['Chapter', 'Interlude'] as const)(
    '%s preserves composing Escape and only dismisses on an ordinary Escape',
    (kind) => {
      const dismissChapter = vi.fn();
      const dismissInterlude = vi.fn();
      const game = { dismissChapter, dismissInterlude } as unknown as GameActions;
      const wrapper = kind === 'Chapter'
        ? mount(Chapter, {
          attachTo: document.body,
          props: {
            beat: { kind: 'opening', opening: { text: 'A new Age opens.' } } as ChapterBeat,
            actions: game,
          },
        })
        : mount(Interlude, {
          attachTo: document.body,
          props: {
            entry: { eventId: 'a_frame', year: 1092, text: 'A voice outside the record.' } as FrameEntry,
            actions: game,
          },
        });
      const dismiss = kind === 'Chapter' ? dismissChapter : dismissInterlude;

      try {
        expect(wrapper.find('[role="dialog"][aria-modal="true"]').exists()).toBe(true);

        const composing = escapeKey(true);
        window.dispatchEvent(composing);
        expect(composing.defaultPrevented).toBe(false);
        expect(dismiss).not.toHaveBeenCalled();

        // Some browsers use 229 for a process key even after isComposing turns false.
        const legacy = escapeKey(false, 229);
        window.dispatchEvent(legacy);
        expect(legacy.defaultPrevented).toBe(false);
        expect(dismiss).not.toHaveBeenCalled();

        const normal = escapeKey();
        window.dispatchEvent(normal);
        expect(normal.defaultPrevented).toBe(true);
        expect(dismiss).toHaveBeenCalledTimes(1);

        window.dispatchEvent(escapeKey(false, undefined, true));
        expect(dismiss).toHaveBeenCalledTimes(1);
      } finally {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
        wrapper.unmount();
        vi.unstubAllGlobals();
      }

      // The detached dialog may not intercept any subsequent key.
      window.dispatchEvent(escapeKey());
      expect(dismiss).toHaveBeenCalledTimes(1);
    },
  );
});


/**
 * Chapter's keyboard semantics are shared with every full-screen modal.
 * Mount real cards to guard the wiring, not just the source import.
 */
describe('Chapter canonical modal keyboard and focus (#1325)', () => {
  const opening = (text: string) => ({ kind: 'opening', opening: { text } } as ChapterBeat);

  it('tabs to the actual usable control instead of disabled, hidden or negative-tabindex stops', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const game = { dismissChapter: vi.fn() } as unknown as GameActions;
    const wrapper = mount(Chapter, {
      attachTo: document.body,
      props: { beat: opening('The chapter begins.'), actions: game },
    });

    try {
      const dialog = wrapper.get('[role="dialog"]').element;
      dialog.insertAdjacentHTML('afterbegin', `
        <a href="#outside" tabindex="-1">Not tabbable</a>
        <select disabled><option>Disabled</option></select>
        <textarea disabled>Disabled</textarea>
        <button hidden>Hidden</button>
        <span style="display:none"><button>CSS hidden</button></span>
      `);
      outside.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(wrapper.get('button.quiet').element);

    } finally {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => cb(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
      outside.remove();
    }
  });

  it('returns focus to a still-open parent when a nested dialog closes (#1496)', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const actions = { dismissChapter: vi.fn() } as unknown as GameActions;
    const parent = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('Parent.'), actions },
    });
    const parentButton = parent.get('button.quiet').element;
    const child = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('Child.'), actions },
    });
    let childUnmounted = false;

    try {
      expect(document.activeElement).toBe(child.get('button.quiet').element);
      child.unmount();
      childUnmounted = true;
      expect(callbacks).toHaveLength(1);

      // The parent is still the topmost modal. Unlike a newly opened
      // successor, its button is exactly where this child began.
      callbacks.shift()!(0);
      expect(document.activeElement).toBe(parentButton);
    } finally {
      if (!childUnmounted) child.unmount();
      parent.unmount();
      while (callbacks.length) callbacks.shift()!(0);
      vi.unstubAllGlobals();
      outside.remove();
    }
  });

  it('keeps fallback focus in the parent when the return target is disabled (#1526)', () => {
    const board = document.createElement('div');
    board.className = 'board';
    const boardButton = document.createElement('button');
    board.appendChild(boardButton);
    document.body.appendChild(board);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const actions = { dismissChapter: vi.fn() } as unknown as GameActions;
    const parent = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('Parent.'), actions },
    });
    const originalButton = parent.get('button.quiet').element as HTMLButtonElement;
    const fallback = document.createElement('button');
    fallback.textContent = 'Another usable parent action';
    parent.get('[role="dialog"]').element.appendChild(fallback);
    const child = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('Child.'), actions },
    });
    let childUnmounted = false;

    try {
      expect(document.activeElement).toBe(child.get('button.quiet').element);
      // The button that opened the child is no longer available when it closes.
      originalButton.disabled = true;
      child.unmount();
      childUnmounted = true;
      expect(callbacks).toHaveLength(1);
      callbacks.shift()!(0);

      expect(document.activeElement).toBe(fallback);
      expect(parent.get('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(boardButton);
    } finally {
      if (!childUnmounted) child.unmount();
      parent.unmount();
      while (callbacks.length) callbacks.shift()!(0);
      vi.unstubAllGlobals();
      board.remove();
    }
  });

  it('does not restore a dismissed chapter over a successor modal', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const actions = { dismissChapter: vi.fn() } as unknown as GameActions;
    const first = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('First.'), actions },
    });
    const second = mount(Chapter, {
      attachTo: document.body, props: { beat: opening('Second.'), actions },
    });
    let firstUnmounted = false;

    try {
      const successorFocus = document.activeElement;
      expect(second.element.contains(successorFocus)).toBe(true);
      first.unmount();
      firstUnmounted = true;
      expect(callbacks).toHaveLength(1);
      callbacks.shift()!(0);
      expect(document.activeElement).toBe(successorFocus);

      await second.setProps({ beat: opening('Next beat, same dialog.') });
      expect(document.activeElement).toBe(second.get('button.quiet').element);
    } finally {
      if (!firstUnmounted) first.unmount();
      second.unmount();
      while (callbacks.length) callbacks.shift()!(0);
      vi.unstubAllGlobals();
      outside.remove();
    }
  });
});

/**
 * Enter confirms an IME candidate as well as signing the founding, and the
 * keyup can arrive after `compositionend` (#1296). Only a deliberate keydown
 * signs; the Sign button and the #1143 requirements stay exactly as they were.
 */
describe('signing the founding with an input method (#1296)', () => {
  function enterKey(composing: boolean, legacyKeyCode?: number, repeat = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat });
    Object.defineProperty(event, 'isComposing', { value: composing });
    if (legacyKeyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: legacyKeyCode });
    return event;
  }

  async function completedFounding() {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: { prologue: prologueView(), actions: game, refused: null, startYear: 1042 },
    });
    await revealChoices(wrapper);
    for (let question = 1; question <= 4; question += 1) {
      await answerButton(wrapper, question).trigger('click');
    }
    await wrapper.findAll('button').find((button) => button.text().includes('The Seal'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('House Marrow'))!.trigger('click');
    const house = wrapper.get('input[aria-label="Name the house"]');
    await house.setValue('林家');
    expect(wrapper.get('button.sign').attributes('disabled')).toBeUndefined();
    return { game, wrapper, house };
  }

  it('does not found the house when Enter confirms a candidate, nor on the late keyup', async () => {
    const { game, wrapper, house } = await completedFounding();

    await house.trigger('compositionstart');
    house.element.dispatchEvent(enterKey(true));
    // Some browsers report the process key as 229 even once isComposing is false.
    house.element.dispatchEvent(enterKey(false, 229));
    await house.trigger('compositionend');
    await house.trigger('keyup', { key: 'Enter' });
    await wrapper.vm.$nextTick();

    expect(game.found).not.toHaveBeenCalled();
    expect((house.element as HTMLInputElement).value).toBe('林家');
    wrapper.unmount();
  });

  it('founds once on an ordinary Enter, and a held Enter does not repeat it', async () => {
    const { game, wrapper, house } = await completedFounding();

    house.element.dispatchEvent(enterKey(false));
    house.element.dispatchEvent(enterKey(false, undefined, true));
    await house.trigger('keyup', { key: 'Enter' });

    expect(game.found).toHaveBeenCalledTimes(1);
    expect(game.found).toHaveBeenCalledWith(expect.objectContaining({ houseName: '林家', heirloom: 'seal' }));
    wrapper.unmount();
  });

  it('still signs from the explicit Sign button after a composition', async () => {
    const { game, wrapper, house } = await completedFounding();

    await house.trigger('compositionstart');
    house.element.dispatchEvent(enterKey(true));
    await house.trigger('compositionend');
    await wrapper.get('button.sign').trigger('click');

    expect(game.found).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('still refuses an ordinary Enter while the founding is incomplete', async () => {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: { prologue: prologueView(), actions: game, refused: null, startYear: 1042 },
    });
    await revealChoices(wrapper);
    const house = wrapper.get('input[aria-label="Name the house"]');
    await house.setValue('House Ash');

    house.element.dispatchEvent(enterKey(false));
    expect(game.found).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

/** The seal's history keeps unknown years unknown, without broken prose (#1466). */
describe('seal-history partial dates (#1466)', () => {
  it('renders missing guardian/birth years without undefined in both reading modes', async () => {
    const line = [
      { person: 'g0', name: 'Undated guardian', from: 1042, guardian: true },
      { person: 'g1', name: 'Birth only', from: 1050, born: 1009, guardian: true },
      { person: 'g2', name: 'Year only', from: 1060, died: 1080, guardian: true },
      { person: 'g3', name: 'Full guardian', from: 1070, born: 1010, died: 1090, guardian: true },
      { person: 'd0', name: 'Unknown birth', from: 1090, to: 1120, died: 1120 },
      { person: 'd1', name: 'Known birth', from: 1120, to: 1150, born: 1070, died: 1150 },
    ] as unknown as ReturnType<GameActions['line']>;
    const wrapper = mount(Line, {
      attachTo: document.body,
      props: { line, close: () => {}, proseMode: 'original' },
    });
    const rows = () => wrapper.findAll('.held li').map((row) => row.text());
    try {
      expect(rows()[0]).toContain('did not die — he has watched the house');
      expect(rows()[1]).toContain('born 1009 · did not die — he has watched the house');
      expect(rows()[2]).toContain('did not die — he has watched the house since 1080');
      expect(rows()[3]).toContain('born 1010 · did not die — he has watched the house since 1090');
      expect(rows()[4]).toContain('died 1120');
      expect(rows()[5]).toContain('born 1070, died 1150');
      expect(wrapper.text()).not.toContain('undefined');

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(rows()[0]).toContain("Became the family's guardian spirit.");
      expect(rows()[1]).toContain("Born in 1009. Became the family's guardian spirit.");
      expect(rows()[2]).toContain("Became the family's guardian spirit in 1080.");
      expect(rows()[3]).toContain("Born in 1010. Became the family's guardian spirit in 1090.");
      expect(rows()[4]).toContain('Died in 1120.');
      expect(rows()[5]).toContain('Born in 1070; died in 1150.');
      expect(wrapper.text()).not.toContain('undefined');
    } finally {
      wrapper.unmount();
    }
  });
});
