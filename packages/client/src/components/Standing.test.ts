// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import { newGame } from '@ed/core';
import Standing from './Standing.vue';

/**
 * THE RUN'S NUMBER IS THERE WHEN ASKED FOR, AND NOT BEFORE (#356, #59).
 *
 * A playtester read `seed #1042` beside the house name as clutter, which it is
 * to anyone not replaying or reporting a run. #59 put it there because a run
 * nobody can name cannot be replayed or reported. Both hold: it leaves the
 * panel's face and comes back behind one control, a click rather than a hover
 * (#275). Assert the DOM, not the styling: a test lays nothing out.
 */
const view = () => newGame(loadContent(), { seed: 4242 }).view();

const mountStanding = () => mount(Standing, {
  props: { view: view(), jump: null, saveStatus: 'idle' },
});

describe('the standing panel keeps the seed out of sight until asked', () => {
  it('shows neither the word nor the number by default', () => {
    const w = mountStanding();
    expect(w.text().toLowerCase()).not.toContain('seed');
    expect(w.text()).not.toContain('4242');
  });

  it('shows the run number once the control is pressed, and hides it again', async () => {
    const w = mountStanding();
    const control = w.get('.run-number button');
    expect(control.attributes('aria-expanded')).toBe('false');

    await control.trigger('click');
    expect(w.text()).toContain('seed #4242');
    expect(control.attributes('aria-expanded')).toBe('true');

    await control.trigger('click');
    expect(w.text()).not.toContain('4242');
  });
});
