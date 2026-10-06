// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { PrologueView } from '@ed/core';
import { prologueSeenText, rememberSeenProse, seenProseKey } from '../lib/accessibility';
import { FOUNDER_NAME_MAX, type GameActions } from '../lib/game';
import Prologue from './Prologue.vue';

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
